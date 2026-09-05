#!/usr/bin/env bash
set -Eeuo pipefail

host="${DEPLOY_HOST:-5.183.191.139}"
user="${DEPLOY_USER:-root}"

verify_health_log() {
  local log_file="$1"
  python3 - "$log_file" <<'PY'
import json
import pathlib
import sys

health = None
for line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace").splitlines():
    line = line.strip()
    if not line.startswith("{"):
        continue
    try:
        candidate = json.loads(line)
    except json.JSONDecodeError:
        continue
    if candidate.get("service") == "buyer-agent-backend":
        health = candidate

if health is None:
    print("Deployment completed but final backend health payload was not found", file=sys.stderr)
    raise SystemExit(1)

print("Verified health:", json.dumps(health, ensure_ascii=False, separators=(",", ":")))
errors = []
if health.get("runtime", {}).get("database") != "ready":
    errors.append("Production database is not ready")
if health.get("capabilities", {}).get("backgroundAutomation") is not True:
    errors.append("Background automation is not production-ready")
if health.get("capabilities", {}).get("photoRecognition") is not True:
    diagnostic = health.get("runtime", {}).get("aiDiagnostic")
    errors.append("OpenAI photo recognition is not production-ready; aiDiagnostic=" + json.dumps(diagnostic, ensure_ascii=False))
if errors:
    print("\n".join(errors), file=sys.stderr)
    raise SystemExit(1)
PY
}

for attempt in 1 2; do
  log_file="$(mktemp)"
  set +e
  ssh -T \
    -o BatchMode=yes \
    -o IdentitiesOnly=yes \
    -o ConnectTimeout=20 \
    -o ConnectionAttempts=3 \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=20 \
    "${user}@${host}" 2>&1 | tee "$log_file"
  ssh_status="${PIPESTATUS[0]}"
  set -e

  if [[ "$ssh_status" -eq 0 ]]; then
    verify_health_log "$log_file"
    rm -f "$log_file"
    exit 0
  fi

  rm -f "$log_file"
  if [[ "$attempt" -eq 2 ]]; then
    echo "Deployment failed after $attempt attempts" >&2
    exit 1
  fi
  echo "SSH deployment attempt $attempt failed; retrying in 20 seconds" >&2
  sleep 20
done
