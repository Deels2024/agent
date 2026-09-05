#!/usr/bin/env python3
import os
import pathlib
import secrets
import signal

RUNTIME_DIR = pathlib.Path(os.environ.get("RUNTIME_SECRET_DIR") or "/run/runtime")


def ensure_secret(name: str, length_bytes: int = 32) -> None:
    path = RUNTIME_DIR / name
    if path.exists() and path.stat().st_size > 0:
        return
    temporary = path.with_suffix(".tmp")
    temporary.write_text(secrets.token_hex(length_bytes) + "\n", encoding="utf-8")
    temporary.chmod(0o444)
    temporary.replace(path)
    path.chmod(0o444)


def main() -> int:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    ensure_secret("openai_gateway_token")
    ensure_secret("cron_secret")
    ready = RUNTIME_DIR / "ready"
    ready.write_text("ready\n", encoding="utf-8")
    ready.chmod(0o444)
    print("Runtime secrets ready", flush=True)
    signal.pause()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
