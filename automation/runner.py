#!/usr/bin/env python3
import json
import os
import time
import urllib.error
import urllib.request

BASE_URL = (os.environ.get("APP_INTERNAL_URL") or "http://app:8788").rstrip("/")
CRON_SECRET = (os.environ.get("CRON_SECRET") or "").strip()


def request_json(path: str, method: str = "GET", timeout: int = 45):
    headers = {"Accept": "application/json"}
    if method != "GET":
        headers["Authorization"] = f"Bearer {CRON_SECRET}"
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        BASE_URL + path,
        data=b"{}" if method != "GET" else None,
        headers=headers,
        method=method,
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        raw = response.read(256_000)
        return response.status, json.loads(raw or b"{}")


def safe_call(path: str):
    try:
        status, payload = request_json(path, "POST")
        print(f"automation {path}: HTTP {status} {json.dumps(payload, ensure_ascii=False)[:500]}", flush=True)
    except urllib.error.HTTPError as exc:
        detail = exc.read(1000).decode("utf-8", "replace")
        print(f"automation {path}: HTTP {exc.code} {detail[:500]}", flush=True)
    except Exception as exc:
        print(f"automation {path}: unavailable ({type(exc).__name__})", flush=True)


def health():
    try:
        status, payload = request_json("/api/health", "GET", timeout=10)
        return payload if status == 200 and payload.get("ok") else None
    except Exception:
        return None


def main():
    if not CRON_SECRET:
        raise SystemExit("CRON_SECRET is required")

    next_price = 0.0
    next_delivery = 0.0
    next_notifications = 0.0
    while True:
        now = time.monotonic()
        state = health()
        if not state:
            time.sleep(10)
            continue

        capabilities = state.get("capabilities") or {}
        if now >= next_price:
            safe_call("/api/jobs/price-alerts")
            next_price = now + 300
        if capabilities.get("deliveryNetwork") and now >= next_delivery:
            safe_call("/api/jobs/deliveries")
            next_delivery = now + 600
        if capabilities.get("notifications") and now >= next_notifications:
            safe_call("/api/jobs/notifications")
            next_notifications = now + 60

        time.sleep(15)


if __name__ == "__main__":
    main()
