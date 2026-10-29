#!/usr/bin/env bash
# Local laptop watchdog (Git Bash on Windows): keeps the AI service (8100), the app (3100) and the
# temporary Cloudflare tunnel alive, and writes the current public URL to .data/tunnel-url.txt.
# Start:  nohup bash scripts/watchdog.sh > .data/watchdog.log 2>&1 &
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1
ok() { curl -fs -m 5 -o /dev/null "$1"; }

while true; do
  if ! ok http://127.0.0.1:8100/v1/cv/health; then
    echo "$(date) restart inference"
    (cd inference && nohup .venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8100 >> ../.data/inference.log 2>&1 &)
    sleep 40
  fi
  if ! ok http://127.0.0.1:3100/; then
    echo "$(date) restart app"
    (NODE_ENV=production PORT=3100 VITE_BASE_PATH=/ nohup node dist/server.cjs >> .data/server-3100.log 2>&1 &)
    sleep 8
  fi
  url=$(grep -o "https://[a-z0-9-]*\.trycloudflare\.com" .data/tunnel.log 2>/dev/null | head -1)
  if [ -z "$url" ] || ! curl -fs -m 15 --doh-url https://1.1.1.1/dns-query -o /dev/null "$url/"; then
    echo "$(date) restart tunnel"
    taskkill //F //IM cloudflared.exe >/dev/null 2>&1
    (nohup ~/bin/cloudflared.exe tunnel --no-autoupdate --url http://localhost:3100 > .data/tunnel.log 2>&1 &)
    for i in $(seq 1 30); do url=$(grep -o "https://[a-z0-9-]*\.trycloudflare\.com" .data/tunnel.log | head -1); [ -n "$url" ] && break; sleep 2; done
    echo "$url" > .data/tunnel-url.txt
    echo "$(date) tunnel $url"
    sleep 30
  fi
  sleep 30
done
