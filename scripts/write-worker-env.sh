#!/usr/bin/env bash
# Writes the worker's production settings to ~/koya/worker.env on the VM
# (mode 600), taking the values from this machine's .env.local. Prints
# only the names it wrote, never a value. Re-run after changing a key.
#
#   KOYA_WORKER_HOST=<public ip> APP_URL=https://<app>.vercel.app scripts/write-worker-env.sh
set -euo pipefail

HOST="${KOYA_WORKER_HOST:?set KOYA_WORKER_HOST to the public IP of the VM}"
: "${APP_URL:?set APP_URL to the address of the deployed web app (used for links in Discord)}"
USER_AT="${KOYA_WORKER_USER:-ubuntu}@${HOST}"
KEY="${KOYA_WORKER_KEY:-$HOME/.ssh/koya_oracle}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# The worker's keys only - not the Gemini key or anything web-only.
NAMES=(NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY ANTHROPIC_API_KEY APIFY_API_KEY FIRECRAWL_API_KEY DISCORD_RUNS_WEBHOOK_URL DISCORD_ALERTS_WEBHOOK_URL)

env_file="$(mktemp)"
trap 'rm -f "$env_file"' EXIT
for name in "${NAMES[@]}"; do
  line="$(grep -E "^${name}=" "$APP_DIR/.env.local" | tail -1 || true)"
  [ -n "$line" ] || { echo "$name is missing from .env.local" >&2; exit 1; }
  echo "$line" >> "$env_file"
done
cat >> "$env_file" <<EOF
APP_ENV=production
REPLAY_MODE=false
ANTHROPIC_MODEL=claude-sonnet-5
ANTHROPIC_CHEAP_MODEL=claude-haiku-4-5
APP_URL=${APP_URL}
WORKER_ID=oracle-worker
EOF

ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$USER_AT" 'mkdir -p ~/koya && umask 077 && cat > ~/koya/worker.env && chmod 600 ~/koya/worker.env' < "$env_file"
echo "Wrote ~/koya/worker.env on $HOST with: ${NAMES[*]} APP_ENV REPLAY_MODE ANTHROPIC_MODEL ANTHROPIC_CHEAP_MODEL APP_URL WORKER_ID"
