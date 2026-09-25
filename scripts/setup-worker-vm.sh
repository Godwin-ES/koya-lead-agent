#!/usr/bin/env bash
# One-time setup of a fresh Oracle Cloud Ubuntu VM for the worker: Docker,
# rsync, automatic security updates, and a small swap file as headroom.
# The worker only makes outbound calls, so no inbound port is opened.
#
#   KOYA_WORKER_HOST=<public ip> scripts/setup-worker-vm.sh
set -euo pipefail

HOST="${KOYA_WORKER_HOST:?set KOYA_WORKER_HOST to the public IP of the VM}"
USER_AT="${KOYA_WORKER_USER:-ubuntu}@${HOST}"
KEY="${KOYA_WORKER_KEY:-$HOME/.ssh/koya_oracle}"

ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$USER_AT" bash -s <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -y
sudo apt-get install -y docker.io rsync unattended-upgrades
sudo systemctl enable --now docker
sudo dpkg-reconfigure -f noninteractive unattended-upgrades
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
mkdir -p ~/koya/app
echo "Docker $(sudo docker --version | cut -d' ' -f3 | tr -d ,) ready on $(uname -m)."
REMOTE
