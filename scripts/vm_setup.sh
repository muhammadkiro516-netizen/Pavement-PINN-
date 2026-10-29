#!/usr/bin/env bash
# Runs ON the VM (Ubuntu 22.04/24.04, x86 or ARM): Docker + open ports 80/443.
# Called by scripts/deploy_vm.sh; safe to run more than once.
set -euo pipefail
if ! command -v docker >/dev/null; then
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi
# Some images (Oracle) block everything except SSH in iptables; open HTTP/HTTPS for Caddy.
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport "$port" -j ACCEPT
done
sudo apt-get install -y iptables-persistent >/dev/null 2>&1 || true
sudo netfilter-persistent save >/dev/null 2>&1 || true
mkdir -p ~/pavement-pinn
echo "VM ready: $(uname -m), $(docker --version 2>/dev/null || echo docker pending relogin)"
