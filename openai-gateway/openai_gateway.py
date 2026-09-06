#!/usr/bin/env python3
import json
import os
import pathlib
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OPENAI_ORIGIN = "https://api.openai.com"
MAX_BODY_BYTES = 12_000_000
OPENAI_DIR = pathlib.Path(os.environ.get("RUNTIME_OPENAI_DIR") or "/run/openai")
SHARED_DIR = pathlib.Path(os.environ.get("RUNTIME_SHARED_DIR") or "/run/shared")
STATE_LOCK = threading.Lock()
UPSTREAM_STATE: dict[str, object] = {
    "ready": False,
    "checking": False,
    "checkedAt": 0.0,
    "status": "not_checked",
}


def env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def file_value(path: pathlib.Path) -> str:
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def api_key() -> str:
    return env("OPENAI_API_KEY") or file_value(pathlib.Path(env("OPENAI_API_KEY_FILE") or OPENAI_DIR / "api_key"))


def proxy_configuration() -> tuple[str, str]:
    dedicated = env("OPENAI_PROXY_URL")
    if dedicated:
        return dedicated, "OPENAI_PROXY_URL"

    extracted = file_value(pathlib.Path(env("OPENAI_PROXY_URL_FILE") or OPENAI_DIR / "proxy_url"))
    if extracted:
        status = config_status()
        return extracted, str(status.get("proxySource") or "runtime-file")

    for name in ("HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "HTTP_PROXY", "http_proxy"):
        value = env(name)
        if value:
            return value, f"container-env:{name}"
    return "", "missing"


def proxy_url() -> str:
    return proxy_configuration()[0]


def proxy_source() -> str:
    return proxy_configuration()[1]


def network_transport() -> str:
    source = proxy_source()
    if source.startswith("container-env:"):
        return "container-proxy"
    return "explicit-proxy" if proxy_url() else "direct-network"


def gateway_token() -> str:
    return env("OPENAI_GATEWAY_TOKEN") or file_value(pathlib.Path(env("OPENAI_GATEWAY_TOKEN_FILE") or SHARED_DIR / "openai_gateway_token"))


def model() -> str:
    return env("OPENAI_VISION_MODEL") or file_value(pathlib.Path(env("OPENAI_MODEL_FILE") or OPENAI_DIR / "model")) or "gpt-5.6-luna"


def config_status() -> dict[str, object]:
    path = pathlib.Path(env("OPENAI_CONFIG_STATUS_FILE") or SHARED_DIR / "openai_config_status.json")
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def local_status() -> dict[str, object]:
    extracted = config_status()
    proxy, source = proxy_configuration()
    return {
        "apiKeyConfigured": bool(api_key()),
        "proxyConfigured": bool(proxy),
        "networkTransport": network_transport(),
        "gatewayTokenConfigured": bool(gateway_token()),
        "modelConfigured": bool(model()),
        "apiKeySource": extracted.get("apiKeySource", "runtime-file" if api_key() else "missing"),
        "proxySource": source,
        "modelSource": extracted.get("modelSource", "runtime-file" if model() else "missing"),
        "candidateProxyKeys": extracted.get("candidateProxyKeys", []),
        "proxyComponentPresence": extracted.get("proxyComponentPresence", {}),
        "proxyComponentShapes": extracted.get("proxyComponentShapes", {}),
        "extractorError": extracted.get("extractorError"),
    }


def curl_request(method: str, path: str, body: bytes | None = None, timeout_seconds: int = 95):
    key = api_key()
    proxy = proxy_url()
    if not key:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    if not path.startswith("/v1/") or ".." in path:
        raise RuntimeError("unsupported OpenAI path")

    args = [
        "curl", "--silent", "--show-error", "--connect-timeout", "12", "--max-time", str(timeout_seconds),
    ]
    if proxy:
        args.extend(["--proxy", proxy, "--noproxy", ""])
    else:
        args.extend(["--proxy", ""])
    args.extend([
        "--request", method, f"{OPENAI_ORIGIN}{path}",
        "--header", f"Authorization: Bearer {key}", "--header", "Content-Type: application/json",
        "--write-out", "\n__OPENAI_HTTP_STATUS__:%{http_code}",
    ])
    if body is not None:
        args.extend(["--data-binary", "@-"])

    completed = subprocess.run(args, input=body, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout_seconds + 5, check=False)
    output = completed.stdout
    marker = b"\n__OPENAI_HTTP_STATUS__:"
    if marker not in output:
        detail = completed.stderr.decode("utf-8", "replace").lower()
        prefix = "proxy" if proxy else "direct"
        if "timed out" in detail:
            raise RuntimeError(f"{prefix}_timeout")
        if "could not resolve" in detail:
            raise RuntimeError(f"{prefix}_dns_error")
        if "connection refused" in detail or "failed to connect" in detail:
            raise RuntimeError(f"{prefix}_connection_error")
        raise RuntimeError(f"{prefix}_transport_error")
    payload, status_text = output.rsplit(marker, 1)
    try:
        status = int(status_text.strip())
    except ValueError as exc:
        raise RuntimeError("invalid_upstream_status") from exc
    return status, payload


def set_state(payload: dict[str, object]) -> None:
    with STATE_LOCK:
        UPSTREAM_STATE.clear()
        UPSTREAM_STATE.update(payload)


def probe_upstream() -> None:
    local = local_status()
    set_state({**local, "ready": False, "checking": True, "checkedAt": time.time(), "status": "checking"})
    if not local["apiKeyConfigured"] or not local["gatewayTokenConfigured"] or not local["modelConfigured"]:
        set_state({**local, "ready": False, "checking": False, "checkedAt": time.time(), "status": "configuration_missing"})
        return
    try:
        request_body = json.dumps({"model": model(), "input": "Reply only with OK.", "max_output_tokens": 16}, separators=(",", ":")).encode("utf-8")
        status, payload = curl_request("POST", "/v1/responses", body=request_body, timeout_seconds=30)
        parsed = json.loads(payload or b"{}") if payload else {}
        if status == 200 and isinstance(parsed, dict) and parsed.get("id"):
            set_state({**local, "ready": True, "checking": False, "checkedAt": time.time(), "status": "ready", "httpStatus": 200})
            print(f"OpenAI upstream ready via {network_transport()} using {model()}", flush=True)
            return
        error = parsed.get("error") if isinstance(parsed, dict) else None
        error_code = error.get("code") if isinstance(error, dict) else None
        error_type = error.get("type") if isinstance(error, dict) else None
        set_state({**local, "ready": False, "checking": False, "checkedAt": time.time(), "status": "upstream_http_error", "httpStatus": status, "errorType": error_type or "unknown", "errorCode": error_code or "unknown"})
    except Exception as exc:
        set_state({**local, "ready": False, "checking": False, "checkedAt": time.time(), "status": str(exc)[:80] or type(exc).__name__})


def start_probe_if_needed(force: bool = False) -> None:
    with STATE_LOCK:
        checking = bool(UPSTREAM_STATE.get("checking"))
        checked_at = float(UPSTREAM_STATE.get("checkedAt") or 0)
    if checking:
        return
    if not force and time.time() - checked_at < 60:
        return
    threading.Thread(target=probe_upstream, name="openai-upstream-probe", daemon=True).start()


def readiness_payload() -> dict[str, object]:
    start_probe_if_needed(False)
    with STATE_LOCK:
        return dict(UPSTREAM_STATE)


class Handler(BaseHTTPRequestHandler):
    server_version = "BuyerAgentOpenAIGateway/1.7"

    def log_message(self, fmt, *args):
        sys.stdout.write("openai-gateway " + (fmt % args) + "\n")
        sys.stdout.flush()

    def _json(self, status: int, payload: dict[str, object]):
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
            state = readiness_payload()
            self._json(200, {"ok": True, **local_status(), "upstreamReady": bool(state.get("ready")), "upstreamStatus": state.get("status", "not_checked")})
            return
        if self.path == "/ready":
            state = readiness_payload()
            self._json(200 if state.get("ready") else 503, {"ok": bool(state.get("ready")), **state})
            return
        self._json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/v1/responses":
            self._json(404, {"error": "not_found"})
            return
        if not self._authorized():
            self._json(401, {"error": "gateway_auth_required"})
            return
        body = b""
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY_BYTES:
                self._json(413 if length > MAX_BODY_BYTES else 400, {"error": "invalid_body_size"})
                return
            body = self.rfile.read(length)
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
        except Exception:
            start_probe_if_needed(True)
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
    print("OpenAI gateway config: " + json.dumps(local_status(), ensure_ascii=False, separators=(",", ":")), flush=True)
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"OpenAI gateway listening on {host}:{port}", flush=True)
    start_probe_if_needed(True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    if "--check-upstream" in sys.argv:
        probe_upstream()
        raise SystemExit(0 if readiness_payload().get("ready") else 1)
    raise SystemExit(serve())
