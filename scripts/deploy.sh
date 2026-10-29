#!/usr/bin/env bash
# SPEC §6: deploy / update on the VM, plus a daily backup of the data volume.
# First time:  bash scripts/deploy.sh --install-cron
# Update:      bash scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Missing .env (copy .env.example; set DOMAIN and SESSION_SECRET)"; exit 1; }
grep -q '^SESSION_SECRET=.\{32,\}' .env || { echo "SESSION_SECRET must be set (>= 32 chars) in .env"; exit 1; }
mkdir -p data models measurements backups

if [ ! -f models/slm/qwen2.5-1.5b-instruct-int4-ov/openvino_model.xml ]; then
  echo "Fetching CLIP and SLM models into ./models (one time)..."
  docker compose run --rm inference sh -c "python scripts/fetch_clip.py && python scripts/build_clip_scenes.py && python scripts/fetch_slm.py"
fi

git pull --ff-only
docker compose up -d --build
docker compose ps

if [ "${1:-}" = "--install-cron" ]; then
  # Daily 02:30 backup of ./data, keep 14 days.
  line="30 2 * * * cd $(pwd) && tar czf backups/data-\$(date +\%F).tgz data && find backups -name 'data-*.tgz' -mtime +14 -delete"
  (crontab -l 2>/dev/null | grep -v 'backups/data-'; echo "$line") | crontab -
  echo "Backup cron installed."
fi
