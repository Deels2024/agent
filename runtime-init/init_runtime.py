#!/usr/bin/env python3
import json
import os
import pathlib
import secrets
import time
from urllib.parse import quote

RUNTIME_DIR = pathlib.Path(os.environ.get("RUNTIME_SECRET_DIR") or "/run/runtime")
INTEGRATION_ENV = pathlib.Path(os.environ.get("INTEGRATION_ENV_FILE") or "/run/integration/bureau.env")
REFRESH_SECONDS = max(10, int(os.environ.get("INTEGRATION_REFRESH_SECONDS") or "30"))


def parse_env_file(path: pathlib.Path = INTEGRATION_ENV) -> dict[str, str]:
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


def first_value(values: dict[str, str], *names: str) -> str:
    for name in names:
        value = (values.get(name) or "").strip()
        if value:
            return value
    return ""


def split_proxy(values: dict[str, str]) -> str:
    prefixes = ("OPENAI_PROXY", "BN_OPENAI_PROXY", "PROXY", "OUTBOUND_PROXY")
    for prefix in prefixes:
        host = first_value(values, f"{prefix}_HOST", f"{prefix}_IP")
        port = first_value(values, f"{prefix}_PORT")
        if not host or not port:
            continue
        protocol = first_value(values, f"{prefix}_SCHEME", f"{prefix}_TYPE", f"{prefix}_PROTOCOL") or "http"
        protocol = protocol.lower()
        if protocol in {"socks", "socks5"}:
            protocol = "socks5h"
        if protocol not in {"http", "https", "socks4", "socks4a", "socks5", "socks5h"}:
            protocol = "http"
        user = first_value(values, f"{prefix}_USER", f"{prefix}_USERNAME", "PROXY_USER", "PROXY_USERNAME")
        password = first_value(values, f"{prefix}_PASSWORD", f"{prefix}_PASS", "PROXY_PASSWORD", "PROXY_PASS")
        auth = ""
        if user:
            auth = quote(user, safe="")
            if password:
                auth += ":" + quote(password, safe="")
            auth += "@"
        return f"{protocol}://{auth}{host}:{port}"
    return ""


def proxy_url(values: dict[str, str]) -> str:
    direct = first_value(
        values,
        "OPENAI_PROXY_URL", "BN_OPENAI_PROXY_URL", "OPENAI_PROXY", "OPENAI_HTTPS_PROXY",
        "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "HTTP_PROXY", "http_proxy",
        "PROXY_URL", "PROXY", "OUTBOUND_PROXY_URL", "OUTBOUND_PROXY",
    )
    return direct or split_proxy(values)


def write_value(name: str, value: str) -> None:
    path = RUNTIME_DIR / name
    normalized = value.strip() + "\n"
    try:
        if path.read_text(encoding="utf-8") == normalized:
            return
    except OSError:
        pass
    temporary = path.with_suffix(".tmp")
    temporary.write_text(normalized, encoding="utf-8")
    temporary.chmod(0o444)
    temporary.replace(path)
    path.chmod(0o444)


def ensure_generated_secret(name: str, length_bytes: int = 32) -> None:
    path = RUNTIME_DIR / name
    if path.exists() and path.stat().st_size > 0:
        return
    write_value(name, secrets.token_hex(length_bytes))


def integration_values() -> tuple[str, str, str]:
    values = parse_env_file()
    api_key = first_value(values, "OPENAI_API_KEY", "BN_OPENAI_API_KEY")
    proxy = proxy_url(values)
    model = first_value(values, "OPENAI_VISION_MODEL", "BN_OPENAI_MODEL") or "gpt-5.6-luna"
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is missing from the integration env")
    if not proxy:
        proxy_keys = sorted(key for key in values if "PROXY" in key.upper() or "TUNNEL" in key.upper())
        raise RuntimeError("OpenAI proxy is missing; available proxy variable names: " + ",".join(proxy_keys))
    return api_key, proxy, model


def refresh_integration() -> str:
    api_key, proxy, model = integration_values()
    write_value("openai_api_key", api_key)
    write_value("openai_proxy_url", proxy)
    write_value("openai_model", model)
    return model


def main() -> int:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    ensure_generated_secret("openai_gateway_token")
    ensure_generated_secret("cron_secret")
    try:
        model = refresh_integration()
    except Exception as exc:
        print(f"Runtime integration failed: {exc}", flush=True)
        return 78
    write_value("ready", "ready")
    print("Runtime integration ready: " + json.dumps({"apiKeyConfigured": True, "proxyConfigured": True, "model": model}, separators=(",", ":")), flush=True)

    while True:
        time.sleep(REFRESH_SECONDS)
        try:
            refresh_integration()
        except Exception as exc:
            # Keep the last known-good narrow runtime files during a transient edit.
            print(f"Runtime integration refresh skipped: {exc}", flush=True)


if __name__ == "__main__":
    raise SystemExit(main())
