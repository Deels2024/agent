#!/usr/bin/env bash
set -Eeuo pipefail

port="${PORT:-8788}"
state_dir="${WRANGLER_STATE_DIR:-/app/.wrangler/state}"
config="${WRANGLER_CONFIG:-/app/dist/server/wrangler.json}"
runtime_config="${WRANGLER_RUNTIME_CONFIG:-/app/dist/server/wrangler.runtime.json}"
runtime_secret_dir="${RUNTIME_SECRET_DIR:-/run/runtime}"
gateway_token_file="${OPENAI_GATEWAY_TOKEN_FILE:-$runtime_secret_dir/openai_gateway_token}"
cron_secret_file="${CRON_SECRET_FILE:-$runtime_secret_dir/cron_secret}"

if [[ ! "$port" =~ ^[0-9]+$ ]] || (( port < 1 || port > 65535 )); then
  echo "PORT must be a number between 1 and 65535" >&2
  exit 64
fi

if [[ ! -f "$config" ]]; then
  echo "Built Worker configuration is missing: $config" >&2
  echo "Run npm run build before starting the server." >&2
  exit 66
fi

for secret_file in "$gateway_token_file" "$cron_secret_file"; do
  if [[ ! -s "$secret_file" ]]; then
    echo "Required runtime secret is missing: $secret_file" >&2
    exit 78
  fi
done

export OPENAI_BASE_URL="${OPENAI_BASE_URL:-http://openai-gateway:8080}"
export OPENAI_GATEWAY_TOKEN="$(tr -d '\r\n' < "$gateway_token_file")"
export CRON_SECRET="$(tr -d '\r\n' < "$cron_secret_file")"

if [[ -z "$OPENAI_GATEWAY_TOKEN" || -z "$CRON_SECRET" ]]; then
  echo "Runtime secrets are empty" >&2
  exit 78
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
