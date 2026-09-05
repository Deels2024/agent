#!/usr/bin/env python3
import json
import os
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OPENAI_ORIGIN = "https://api.openai.com"
MAX_BODY_BYTES = 12_000_000


def env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def proxy_url() -> str:
    return env("OPENAI_PROXY_URL")


def gateway_token() -> str:
    return env("OPENAI_GATEWAY_TOKEN")


def api_key() -> str:
    return env("OPENAI_API_KEY")


def model() -> str:
    return env("OPENAI_VISION_MODEL") or "gpt-5.6-luna"


def curl_request(method: str, path: str, body: bytes | None = None, timeout_seconds: int = 95):
    key = api_key()
    proxy = proxy_url()
    if not key:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    if not proxy:
        raise RuntimeError("OPENAI_PROXY_URL is not configured")
    if not path.startswith("/v1/") or ".." in path:
        raise RuntimeError("unsupported OpenAI path")

    args = [
        "curl",
        "--silent",
        "--show-error",
        "--connect-timeout", "15",
        "--max-time", str(timeout_seconds),
        "--proxy", proxy,
        "--noproxy", "",
        "--request", method,
        f"{OPENAI_ORIGIN}{path}",
        "--header", f"Authorization: Bearer {key}",
        "--header", "Content-Type: application/json",
        "--write-out", "\n__OPENAI_HTTP_STATUS__:%{http_code}",
    ]
    if body is not None:
        args.extend(["--data-binary", "@-"])

    completed = subprocess.run(
        args,
        input=body,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout_seconds + 10,
        check=False,
    )
    output = completed.stdout
    marker = b"\n__OPENAI_HTTP_STATUS__:"
    if marker not in output:
        detail = completed.stderr.decode("utf-8", "replace")[-600:]
        raise RuntimeError(f"OpenAI proxy request failed: {detail or 'no HTTP status'}")
    payload, status_text = output.rsplit(marker, 1)
    try:
        status = int(status_text.strip())
    except ValueError as exc:
        raise RuntimeError("OpenAI proxy returned an invalid HTTP status") from exc
    return status, payload


def check_upstream() -> int:
    try:
        request_body = json.dumps({
            "model": model(),
            "input": "Reply only with OK.",
            "max_output_tokens": 16,
        }, separators=(",", ":")).encode("utf-8")
        status, payload = curl_request("POST", "/v1/responses", body=request_body, timeout_seconds=60)
        parsed = json.loads(payload or b"{}") if payload else {}
        if status != 200 or not isinstance(parsed, dict) or not parsed.get("id"):
            error = parsed.get("error") if isinstance(parsed, dict) else None
            error_code = error.get("code") if isinstance(error, dict) else None
            error_type = error.get("type") if isinstance(error, dict) else None
            print(f"OpenAI upstream check failed with HTTP {status}; type={error_type or 'unknown'} code={error_code or 'unknown'}", file=sys.stderr)
            return 1
        print(f"OpenAI upstream check: OK via configured proxy using {model()}")
        return 0
    except Exception as exc:
        print(f"OpenAI upstream check failed: {exc}", file=sys.stderr)
        return 1


class Handler(BaseHTTPRequestHandler):
    server_version = "BuyerAgentOpenAIGateway/1.1"

    def log_message(self, fmt, *args):
        sys.stdout.write("openai-gateway " + (fmt % args) + "\n")
        sys.stdout.flush()

    def _json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        expected = gateway_token()
        provided = self.headers.get("X-OpenAI-Gateway-Token", "")
        return bool(expected) and provided == expected

    def do_GET(self):
        if self.path == "/health":
            configured = bool(api_key()) and bool(proxy_url()) and bool(gateway_token())
            self._json(200 if configured else 503, {
                "ok": configured,
                "apiKeyConfigured": bool(api_key()),
                "proxyConfigured": bool(proxy_url()),
                "gatewayTokenConfigured": bool(gateway_token()),
                "modelConfigured": bool(model()),
            })
            return
        self._json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/v1/responses":
            self._json(404, {"error": "not_found"})
            return
        if not self._authorized():
            self._json(401, {"error": "gateway_auth_required"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._json(400, {"error": "invalid_content_length"})
            return
        if length <= 0 or length > MAX_BODY_BYTES:
            self._json(413 if length > MAX_BODY_BYTES else 400, {"error": "invalid_body_size"})
            return
        body = self.rfile.read(length)
        try:
            json.loads(body)
        except Exception:
            self._json(400, {"error": "invalid_json"})
            return
        try:
            status, payload = curl_request("POST", "/v1/responses", body=body)
        except Exception as exc:
            self.log_message("upstream error: %s", str(exc)[:400])
            self._json(502, {"error": "openai_upstream_unavailable"})
            return

        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)


def serve() -> int:
    host = env("GATEWAY_HOST") or "0.0.0.0"
    port = int(env("GATEWAY_PORT") or "8080")
    print("OpenAI gateway config: " + json.dumps({
        "apiKeyConfigured": bool(api_key()),
        "proxyConfigured": bool(proxy_url()),
        "gatewayTokenConfigured": bool(gateway_token()),
        "model": model(),
    }, separators=(",", ":")), flush=True)
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"OpenAI gateway listening on {host}:{port}", flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    if "--check-upstream" in sys.argv:
        raise SystemExit(check_upstream())
    raise SystemExit(serve())
