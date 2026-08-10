#!/usr/bin/env bash
set -Eeuo pipefail

port="${PORT:-8788}"
state_dir="${WRANGLER_STATE_DIR:-/app/.wrangler/state}"
config="${WRANGLER_CONFIG:-/app/dist/server/wrangler.json}"
runtime_config="${WRANGLER_RUNTIME_CONFIG:-/app/dist/server/wrangler.runtime.json}"

if [[ ! "$port" =~ ^[0-9]+$ ]] || (( port < 1 || port > 65535 )); then
  echo "PORT must be a number between 1 and 65535" >&2
  exit 64
fi

if [[ ! -f "$config" ]]; then
  echo "Built Worker configuration is missing: $config" >&2
  echo "Run npm run build before starting the server." >&2
  exit 66
fi

mkdir -p "$state_dir" /app/.wrangler/logs
node /app/scripts/create-runtime-wrangler-config.mjs "$config" "$runtime_config"

# The regular `vinext start` Node adapter does not provide Cloudflare bindings.
# Running the built Worker in the local workerd runtime supplies a persistent D1
# database while keeping the same Worker code that is deployed to Sites.
exec /app/node_modules/.bin/wrangler dev \
  --config "$runtime_config" \
  --local \
  --ip 0.0.0.0 \
  --port "$port" \
  --persist-to "$state_dir" \
  --log-level info \
  --show-interactive-dev-session false
