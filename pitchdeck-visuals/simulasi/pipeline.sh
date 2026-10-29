#!/usr/bin/env bash
# Sequential pitch-deck pipeline (one heavy job at a time).
set -u
cd "C:/Users/Salma/Documents/Pavement-PINN"
SP="C:/Users/Salma/AppData/Local/Temp/claude/c--Users-Salma-Documents-Pavement-PINN/d57bb801-8853-45f8-832c-d4fd27c7fbfa/scratchpad"
T="$SP/e2e-data"
PY="inference/.venv/Scripts/python"
step() { echo "### $(date +%H:%M:%S) $*"; }

step build
MSYS_NO_PATHCONV=1 VITE_BASE_PATH=/ npx vite build 2>&1 | grep -E "built in|rror"
npx esbuild server/index.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs 2>&1 | tail -1

step simulations
rm -rf "$T" "$SP/journey/sim-${SIMS:-X}"; mkdir -p "$T"
cp -r .data/workflow.json .data/accounts.json .data/session-secret .data/cv-analyses "$T"/
[ -d .data/workspaces ] && cp -r .data/workspaces "$T"/
NODE_ENV=production PORT=3200 VITE_BASE_PATH=/ DATA_DIR="$T" AUTHORITY_LOOKUP=off node dist/server.cjs > "$T/server.log" 2>&1 &
SRV=$!
for i in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:3200/ && break; sleep 2; done
for S in ${SIMS:-A B}; do
  step "sim $S"
  timeout 900 node .e2e-tmp/journey.mjs "$SP/journey" $S 2>&1 | grep -v "^\s*at \|^shot"
done
kill $SRV

step charts
if [ "${SKIP_CHARTS:-0}" != 1 ]; then
rm -rf pitchdeck-visuals/17_screenshot_aplikasi pitchdeck-visuals/11_cv_deteksi pitchdeck-visuals/*.png
(cd inference && PYTHONPATH=. MLET_WORKERS=1 .venv/Scripts/python ../pitchdeck-visuals/make_visuals.py 2>&1 | grep -E "^wrote|skipped|Error|mape|viol" )

fi
step videos
$PY pitchdeck-visuals/make_videos.py "$SP/journey" 2>&1 | tail -20

step slides
$PY pitchdeck-visuals/compose_slides.py "$SP/journey" 2>&1 | tail -3
step PIPELINE_DONE
