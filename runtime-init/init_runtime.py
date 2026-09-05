#!/usr/bin/env python3
import json
import os
import pathlib
import secrets
import signal
from urllib.parse import quote

SHARED_DIR = pathlib.Path(os.environ.get("RUNTIME_SHARED_DIR") or "/run/shared")
OPENAI_DIR = pathlib.Path(os.environ.get("RUNTIME_OPENAI_DIR") or "/run/openai")
INTEGRATION_ENV = pathlib.Path(os.environ.get("INTEGRATION_ENV_FILE") or "/run/integration/bureau.env")
BURO_OPENAI_KEY_FILE = pathlib.Path(os.environ.get("BURO_OPENAI_KEY_FILE") or "/run/bureau-openai/openai_api_key")


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


def read_secret(path: pathlib.Path) -> str:
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def build_split_proxy(values: dict[str, str]) -> tuple[str, str]:
    prefixes = ("OPENAI_PROXY", "BN_OPENAI_PROXY", "PROXY", "OUTBOUND_PROXY")
    for prefix in prefixes:
        host = (
            values.get(f"{prefix}_HOST")
            or values.get(f"{prefix}_ADDRESS")
            or values.get(f"{prefix}_IP")
            or ""
        ).strip()
        port = (values.get(f"{prefix}_PORT") or "").strip()
        if not host or not port:
            continue
        protocol = (
            values.get(f"{prefix}_SCHEME")
            or values.get(f"{prefix}_TYPE")
            or values.get(f"{prefix}_PROTOCOL")
            or "http"
        ).strip().lower()
        if protocol in {"socks", "socks5"}:
            protocol = "socks5h"
        if protocol not in {"http", "https", "socks4", "socks4a", "socks5", "socks5h"}:
            protocol = "http"
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
        auth = ""
        if user:
            auth = quote(user, safe="")
            if password:
                auth += ":" + quote(password, safe="")
            auth += "@"
        source_host = "ADDRESS" if values.get(f"{prefix}_ADDRESS") else "HOST" if values.get(f"{prefix}_HOST") else "IP"
        return f"{protocol}://{auth}{host}:{port}", f"{prefix}_{source_host}+PORT"
    return "", ""


def extract_openai_configuration() -> dict[str, object]:
    values = parse_env_file(INTEGRATION_ENV)
    api_key, key_source = first(values, "OPENAI_API_KEY", "BN_OPENAI_API_KEY")
    if not api_key:
        api_key = read_secret(BURO_OPENAI_KEY_FILE)
        if api_key:
            key_source = "bureau-nakhodok_openai_secret/openai_api_key"

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

    atomic_write(OPENAI_DIR / "api_key", api_key + ("\n" if api_key else ""))
    atomic_write(OPENAI_DIR / "proxy_url", proxy + ("\n" if proxy else ""))
    atomic_write(OPENAI_DIR / "model", model + "\n")

    status = {
        "apiKeyConfigured": bool(api_key),
        "apiKeySource": key_source or "missing",
        "proxyConfigured": bool(proxy),
        "proxySource": proxy_source or "missing",
        "modelConfigured": bool(model),
        "modelSource": model_source,
        "candidateProxyKeys": sorted(key for key in values if "PROXY" in key.upper() or "TUNNEL" in key.upper())[:30],
        "buroSecretFilePresent": BURO_OPENAI_KEY_FILE.is_file(),
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
        status = extract_openai_configuration()
    except Exception as exc:
        status = {
            "apiKeyConfigured": False,
            "proxyConfigured": False,
            "modelConfigured": False,
            "extractorError": type(exc).__name__,
            "buroSecretFilePresent": BURO_OPENAI_KEY_FILE.is_file(),
        }
        atomic_write(SHARED_DIR / "openai_config_status.json", json.dumps(status, separators=(",", ":")) + "\n")

    atomic_write(SHARED_DIR / "ready", "ready\n")
    print("Runtime secrets ready: " + json.dumps(status, ensure_ascii=False, separators=(",", ":")), flush=True)
    signal.pause()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
