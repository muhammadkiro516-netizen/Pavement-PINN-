#!/usr/bin/env bash
# Deploy PavementPINN to any Ubuntu VM (Azure for Students, Oracle, local VPS) from this laptop (Git Bash).
#   SSH_USER=azureuser bash scripts/deploy_vm.sh <PUBLIC_IP> [--with-data]
# Uses the key ~/.ssh/pavement_oracle (its .pub was added to the VM at creation). SSH_USER defaults to ubuntu.
# URL: https://pavement-pinn.<ip-with-dashes>.sslip.io  (HTTPS by Caddy + Let's Encrypt; no domain needed)
set -euo pipefail
IP="${1:?usage: deploy_vm.sh <PUBLIC_IP> [--with-data]}"
WITH_DATA="${2:-}"
KEY="$HOME/.ssh/pavement_oracle"
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new ${SSH_USER:-ubuntu}@$IP"
cd "$(dirname "$0")/.."
DOMAIN="pavement-pinn.${IP//./-}.sslip.io"

echo "== 1/5 VM setup (Docker, firewall)"
$SSH 'bash -s' < scripts/vm_setup.sh

echo "== 2/5 code (git HEAD)"
git archive --format=tar HEAD | $SSH 'mkdir -p ~/pavement-pinn && tar -x -C ~/pavement-pinn'

echo "== 3/5 models not in git (CLIP INT8, SLM INT4)"
tar -cf - models/cv/clip/clip_vision_int8.xml models/cv/clip/clip_vision_int8.bin models/cv/clip/tokenizer.json \
  models/cv/clip/preprocessor_config.json models/cv/clip/SOURCE.json models/slm | $SSH 'tar -x -C ~/pavement-pinn'

if [ "$WITH_DATA" = "--with-data" ]; then
  echo "== 3b data (reports, accounts with hashed passwords, CV analyses; no plaintext passwords)"
  (cd .data && tar -cf - --ignore-failed-read accounts.json workflow.json share-visits.json geocode-cache.json cv-analyses workspaces share-og 2>/dev/null) \
    | $SSH 'mkdir -p ~/pavement-pinn/data && tar -x -C ~/pavement-pinn/data'
fi

echo "== 4/5 .env (once)"
$SSH "cd ~/pavement-pinn && [ -f .env ] || printf 'DOMAIN=%s\nSESSION_SECRET=%s\nDEMO_AUTH=false\n' '$DOMAIN' \"\$(openssl rand -hex 32)\" > .env && cat .env | sed 's/SESSION_SECRET=.*/SESSION_SECRET=(set)/'"

echo "== 5/5 build and start (first build ~10-20 min on ARM)"
$SSH "cd ~/pavement-pinn && sudo docker compose up -d --build && sudo docker compose ps"
echo
echo "URL permanen: https://$DOMAIN"
