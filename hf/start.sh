#!/usr/bin/env bash
# Hugging Face Space entrypoint: restore data, start the AI service, keep data backed up, serve the app.
set -uo pipefail
cd /home/user/app
mkdir -p "$DATA_DIR"

# Free Spaces have no persistent disk: data lives in a private dataset repo (DATA_REPO) and is
# restored on start and backed up every few minutes. Without HF_TOKEN/DATA_REPO it runs without backup.
python hf/data_sync.py restore || echo "data restore skipped"

(cd inference && python -m uvicorn app.main:app --host 127.0.0.1 --port 8100 >/tmp/inference.log 2>&1) &

# Restart the AI service if it ever stops.
(
  while true; do
    sleep 30
    if ! curl -fs -m 5 http://127.0.0.1:8100/v1/cv/health >/dev/null; then
      echo "$(date -u) restarting inference" >&2
      (cd inference && python -m uvicorn app.main:app --host 127.0.0.1 --port 8100 >>/tmp/inference.log 2>&1) &
    fi
  done
) &

python hf/data_sync.py loop &

exec node dist/server.cjs
