#!/usr/bin/env python3
import json
import os
import pathlib
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote

OPENAI_ORIGIN = "https://api.openai.com"
MAX_BODY_BYTES = 12_000_000


def env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def integration_env_file() -> pathlib.Path:
    return pathlib.Path(env("INTEGRATION_ENV_FILE") or "/run/integration/bureau.env")


def parse_env_file() -> dict[str, str]:
    path = integration_env_file()
    if not path.is_file():
        return {}
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().rstrip("\r")
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        if key:
            values[key] = value
    return values


def first_value(*names: str) -> str:
    for name in names:
        value = env(name)
        if value:
            return value
    values = parse_env_file()
    for name in names:
        value = (values.get(name) or "").strip()
        if value:
            return value
    return ""


def secret_file_value(env_name: str, default_path: str) -> str:
    direct = env(env_name.removesuffix("_FILE"))
    if direct:
        return direct
    path = pathlib.Path(env(env_name) or default_path)
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def api_key() -> str:
    return first_value("OPENAI_API_KEY", "BN_OPENAI_API_KEY")


def gateway_token() -> str:
    return secret_file_value("OPENAI_GATEWAY_TOKEN_FILE", "/run/runtime/openai_gateway_token")


def model() -> str:
    return first_value("OPENAI_VISION_MODEL", "BN_OPENAI_MODEL") or "gpt-5.6-luna"


def build_split_proxy(values: dict[str, str]) -> str:
    prefixes = ("OPENAI_PROXY", "BN_OPENAI_PROXY", "PROXY", "OUTBOUND_PROXY")
    for prefix in prefixes:
        host = (values.get(f"{prefix}_HOST") or values.get(f"{prefix}_IP") or "").strip()
        port = (values.get(f"{prefix}_PORT") or "").strip()
        if not host or not port:
            continue
        protocol = (values.get(f"{prefix}_SCHEME") or values.get(f"{prefix}_TYPE") or values.get(f"{prefix}_PROTOCOL") or "http").strip().lower()
        if protocol in {"socks", "socks5"}:
            protocol = "socks5h"
        if protocol not in {"http", "https", "socks4", "socks4a", "socks5", "socks5h"}:
            protocol = "http"
        user = (values.get(f"{prefix}_USER") or values.get(f"{prefix}_USERNAME") or values.get("PROXY_USER") or values.get("PROXY_USERNAME") or "").strip()
        password = (values.get(f"{prefix}_PASSWORD") or values.get(f"{prefix}_PASS") or values.get("PROXY_PASSWORD") or values.get("PROXY_PASS") or "").strip()
        auth = ""
        if user:
            auth = quote(user, safe="")
            if password:
                auth += ":" + quote(password, safe="")
            auth += "@"
        return f"{protocol}://{auth}{host}:{port}"
    return ""


def proxy_url() -> str:
    names = (
        "OPENAI_PROXY_URL", "BN_OPENAI_PROXY_URL", "OPENAI_PROXY", "OPENAI_HTTPS_PROXY",
        "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "HTTP_PROXY", "http_proxy",
        "PROXY_URL", "PROXY", "OUTBOUND_PROXY_URL", "OUTBOUND_PROXY",
    )
    direct = first_value(*names)
    if direct:
        return direct
    return build_split_proxy(parse_env_file())


def curl_request(method: str, path: str, body: bytes | None = None, timeout_seconds: int = 95):
    key = api_key()
    proxy = proxy_url()
    if not key:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    if not proxy:
        raise RuntimeError("OpenAI proxy is not configured")
    if not path.startswith("/v1/") or ".." in path:
        raise RuntimeError("unsupported OpenAI path")

    args = [
        "curl", "--silent", "--show-error", "--connect-timeout", "15", "--max-time", str(timeout_seconds),
        "--proxy", proxy, "--noproxy", "", "--request", method, f"{OPENAI_ORIGIN}{path}",
        "--header", f"Authorization: Bearer {key}", "--header", "Content-Type: application/json",
        "--write-out", "\n__OPENAI_HTTP_STATUS__:%{http_code}",
    ]
    if body is not None:
        args.extend(["--data-binary", "@-"])

    completed = subprocess.run(args, input=body, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout_seconds + 10, check=False)
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
        request_body = json.dumps({"model": model(), "input": "Reply only with OK.", "max_output_tokens": 16}, separators=(",", ":")).encode("utf-8")
        status, payload = curl_request("POST", "/v1/responses", body=request_body, timeout_seconds=60)
        parsed = json.loads(payload or b"{}") if payload else {}
        if status != 200 or not isinstance(parsed, dict) or not parsed.get("id"):
            error = parsed.get("error") if isinstance(parsed, dict) else None
            error_code = error.get("code") if isinstance(error, dict) else None
            error_type = error.get("type") if isinstance(error, dict) else None
            print(f"OpenAI upstream check failed with HTTP {status}; type={error_type or 'unknown'} code={error_code or 'unknown'}", file=sys.stderr)
            return 1
        print(f"OpenAI upstream check: OK via configured proxy using {model()}", flush=True)
        return 0
    except Exception as exc:
        print(f"OpenAI upstream check failed: {exc}", file=sys.stderr, flush=True)
        return 1


class Handler(BaseHTTPRequestHandler):
    server_version = "BuyerAgentOpenAIGateway/1.3"

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
            request_payload = json.loads(body)
            if not isinstance(request_payload, dict):
                raise ValueError("request must be an object")
            request_payload["model"] = model()
            body = json.dumps(request_payload, separators=(",", ":")).encode("utf-8")
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
        "apiKeyConfigured": bool(api_key()), "proxyConfigured": bool(proxy_url()),
        "gatewayTokenConfigured": bool(gateway_token()), "model": model(),
    }, separators=(",", ":")), flush=True)
    require_upstream = (env("GATEWAY_REQUIRE_UPSTREAM") or "true").lower() not in {"0", "false", "no"}
    if require_upstream and check_upstream() != 0:
        return 78
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"OpenAI gateway listening on {host}:{port}", flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    if "--check-upstream" in sys.argv:
        raise SystemExit(check_upstream())
    raise SystemExit(serve())
