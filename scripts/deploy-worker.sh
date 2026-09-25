#!/usr/bin/env bash
# Deploys the worker to the Oracle Cloud VM: copies only what the image
# needs, builds it on the VM (natively on its ARM CPU), and replaces the
# running container. Safe to re-run for every update.
#
#   KOYA_WORKER_HOST=<public ip> scripts/deploy-worker.sh
#
# The worker's settings live on the VM in ~/koya/worker.env (mode 600),
# written once by scripts/write-worker-env.sh - never copied from here.
set -euo pipefail

HOST="${KOYA_WORKER_HOST:?set KOYA_WORKER_HOST to the public IP of the VM}"
USER_AT="${KOYA_WORKER_USER:-ubuntu}@${HOST}"
KEY="${KOYA_WORKER_KEY:-$HOME/.ssh/koya_oracle}"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$USER_AT")
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Copying the worker's sources to $HOST..."
rsync -az --delete -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" \
  --exclude node_modules --exclude '.env*' --exclude '*.tmp.ts' \
  --relative \
  "$APP_DIR/./package.json" "$APP_DIR/./pnpm-lock.yaml" "$APP_DIR/./pnpm-workspace.yaml" \
  "$APP_DIR/./packages/core" "$APP_DIR/./worker" "$APP_DIR/./web/package.json" \
  "$USER_AT:koya/app/"

echo "Building the image and restarting the worker..."
"${SSH[@]}" bash -s <<'REMOTE'
set -euo pipefail
cd ~/koya/app
test -f ~/koya/worker.env || { echo "~/koya/worker.env is missing - run scripts/write-worker-env.sh first." >&2; exit 1; }
sudo docker build -f worker/Dockerfile -t koya-worker:latest .
sudo docker rm -f koya-worker >/dev/null 2>&1 || true
# SIGTERM lets the worker finish its current tool call and requeue the run (service.ts); give it time.
sudo docker run -d --name koya-worker --restart unless-stopped --stop-timeout 120 \
  --env-file ~/koya/worker.env --memory 4g koya-worker:latest
sleep 5
sudo docker ps --filter name=koya-worker --format '{{.Names}}: {{.Status}}'
sudo docker logs --tail 20 koya-worker
sudo docker image prune -f >/dev/null
REMOTE
