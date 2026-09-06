#!/usr/bin/env python3
import json
import os
import pathlib
import secrets
import signal
from urllib.parse import quote, urlsplit

SHARED_DIR = pathlib.Path(os.environ.get("RUNTIME_SHARED_DIR") or "/run/shared")
OPENAI_DIR = pathlib.Path(os.environ.get("RUNTIME_OPENAI_DIR") or "/run/openai")
INTEGRATION_ENV = pathlib.Path(os.environ.get("INTEGRATION_ENV_FILE") or "/run/integration/bureau.env")


def atomic_write(path: pathlib.Path, value: str, mode: int = 0o444) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(value, encoding="utf-8")
    temporary.chmod(mode)
    temporary.replace(path)
    path.chmod(mode)


def ensure_secret(directory: pathlib.Path, name: str, length_bytes: int = 32) -> None:
    path = directory / name
    if path.exists() and path.stat().st_size > 0:
        return
    atomic_write(path, secrets.token_hex(length_bytes) + "\n")


def parse_env_file(path: pathlib.Path) -> dict[str, str]:
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


def first(values: dict[str, str], *names: str) -> tuple[str, str]:
    for name in names:
        value = (values.get(name) or "").strip()
        if value:
            return value, name
    return "", ""


def normalized_scheme(raw: str) -> str:
    protocol = (raw or "http").strip().lower()
    if protocol in {"socks", "socks5"}:
        return "socks5h"
    if protocol not in {"http", "https", "socks4", "socks4a", "socks5", "socks5h"}:
        return "http"
    return protocol


def proxy_auth(user: str, password: str) -> str:
    if not user:
        return ""
    auth = quote(user, safe="")
    if password:
        auth += ":" + quote(password, safe="")
    return auth + "@"


def build_split_proxy(values: dict[str, str]) -> tuple[str, str]:
    prefixes = ("OPENAI_PROXY", "BN_OPENAI_PROXY", "PROXY", "OUTBOUND_PROXY")
    for prefix in prefixes:
        address = (
            values.get(f"{prefix}_HOST")
            or values.get(f"{prefix}_ADDRESS")
            or values.get(f"{prefix}_IP")
            or ""
        ).strip()
        port = (values.get(f"{prefix}_PORT") or "").strip()
        if not address:
            continue

        scheme = normalized_scheme(
            values.get(f"{prefix}_SCHEME")
            or values.get(f"{prefix}_TYPE")
            or values.get(f"{prefix}_PROTOCOL")
            or "http"
        )
        user = (
            values.get(f"{prefix}_USER")
            or values.get(f"{prefix}_USERNAME")
            or values.get(f"{prefix}_LOGIN")
            or values.get("PROXY_USER")
            or values.get("PROXY_USERNAME")
            or values.get("PROXY_LOGIN")
            or ""
        ).strip()
        password = (
            values.get(f"{prefix}_PASSWORD")
            or values.get(f"{prefix}_PASS")
            or values.get("PROXY_PASSWORD")
            or values.get("PROXY_PASS")
            or ""
        ).strip()

        source_host = "ADDRESS" if values.get(f"{prefix}_ADDRESS") else "HOST" if values.get(f"{prefix}_HOST") else "IP"

        if "://" in address:
            parsed = urlsplit(address)
            host = parsed.hostname or ""
            effective_port = str(parsed.port or port or "")
            effective_scheme = normalized_scheme(parsed.scheme or scheme)
            embedded_user = parsed.username or ""
            embedded_password = parsed.password or ""
            if host and effective_port:
                auth = proxy_auth(user or embedded_user, password or embedded_password)
                return f"{effective_scheme}://{auth}{host}:{effective_port}", f"{prefix}_{source_host}_URL"

        if not port and address.count(":") == 1:
            candidate_host, candidate_port = address.rsplit(":", 1)
            if candidate_host and candidate_port.isdigit():
                address, port = candidate_host, candidate_port

        if not port:
            continue

        auth = proxy_auth(user, password)
        return f"{scheme}://{auth}{address}:{port}", f"{prefix}_{source_host}+PORT"
    return "", ""


def safe_component_shape(key: str, value: str) -> str:
    value = (value or "").strip()
    if not value:
        return "empty"
    upper = key.upper()
    if upper.endswith(("_PASSWORD", "_PASS", "_LOGIN", "_USER", "_USERNAME")):
        return "set"
    if upper.endswith("_PORT"):
        return "numeric" if value.isdigit() else "non_numeric"
    if upper.endswith(("_SCHEME", "_TYPE", "_PROTOCOL")):
        return "known" if value.lower() in {"http", "https", "socks", "socks4", "socks4a", "socks5", "socks5h"} else "unknown"
    if upper.endswith(("_ADDRESS", "_HOST", "_IP")):
        if "://" in value:
            return "url"
        if value.count(":") == 1 and value.rsplit(":", 1)[1].isdigit():
            return "host_port"
        if value.startswith("$") or "${" in value:
            return "variable_reference"
        if any(ch.isspace() for ch in value):
            return "contains_whitespace"
        return "host"
    return "set"


def extract_openai_transport_configuration() -> dict[str, object]:
    values = parse_env_file(INTEGRATION_ENV)
    proxy, proxy_source = first(
        values,
        "OPENAI_PROXY_URL", "BN_OPENAI_PROXY_URL", "OPENAI_PROXY", "OPENAI_HTTPS_PROXY",
        "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "HTTP_PROXY", "http_proxy",
        "PROXY_URL", "PROXY", "OUTBOUND_PROXY_URL", "OUTBOUND_PROXY",
    )
    if not proxy:
        proxy, proxy_source = build_split_proxy(values)
    model, model_source = first(values, "OPENAI_VISION_MODEL", "BN_OPENAI_MODEL")
    model = model or "gpt-5.6-luna"
    model_source = model_source or "default"

    atomic_write(OPENAI_DIR / "proxy_url", proxy + ("\n" if proxy else ""))
    atomic_write(OPENAI_DIR / "model", model + "\n")

    candidate_keys = sorted(key for key in values if "PROXY" in key.upper() or "TUNNEL" in key.upper())[:30]
    relevant_suffixes = ("_ADDRESS", "_HOST", "_IP", "_PORT", "_SCHEME", "_TYPE", "_PROTOCOL", "_LOGIN", "_USER", "_USERNAME", "_PASSWORD", "_PASS")
    component_presence = {
        key: bool((values.get(key) or "").strip())
        for key in candidate_keys
        if key.upper().endswith(relevant_suffixes)
    }
    component_shapes = {
        key: safe_component_shape(key, values.get(key) or "")
        for key in candidate_keys
        if key.upper().endswith(relevant_suffixes)
    }
    status = {
        "apiKeySource": "bureau-nakhodok_openai_secret/openai_api_key",
        "proxyConfigured": bool(proxy),
        "proxySource": proxy_source or "missing",
        "modelConfigured": bool(model),
        "modelSource": model_source,
        "candidateProxyKeys": candidate_keys,
        "proxyComponentPresence": component_presence,
        "proxyComponentShapes": component_shapes,
    }
    atomic_write(SHARED_DIR / "openai_config_status.json", json.dumps(status, ensure_ascii=False, separators=(",", ":")) + "\n")
    return status


def main() -> int:
    SHARED_DIR.mkdir(parents=True, exist_ok=True)
    OPENAI_DIR.mkdir(parents=True, exist_ok=True)
    ensure_secret(SHARED_DIR, "openai_gateway_token")
    ensure_secret(SHARED_DIR, "cron_secret")

    status: dict[str, object]
    try:
        status = extract_openai_transport_configuration()
    except Exception as exc:
        status = {
            "apiKeySource": "bureau-nakhodok_openai_secret/openai_api_key",
            "proxyConfigured": False,
            "modelConfigured": False,
            "extractorError": type(exc).__name__,
        }
        atomic_write(SHARED_DIR / "openai_config_status.json", json.dumps(status, separators=(",", ":")) + "\n")

    atomic_write(SHARED_DIR / "ready", "ready\n")
    print("Runtime transport ready: " + json.dumps(status, ensure_ascii=False, separators=(",", ":")), flush=True)
    signal.pause()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
