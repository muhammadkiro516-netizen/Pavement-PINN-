#!/usr/bin/env bash
# SPEC §5 (akses hardware A/C): run the benchmark on an Intel machine (Intel AI PC Cloud with a
# Core Ultra NPU, a borrowed Core Ultra laptop under WSL/Linux, or a Xeon gen-4+ VM with AMX)
# and copy the result back. Nothing here creates accounts; the person provides the machine.
#
#   git clone <repo> && cd Pavement-PINN && bash bench/remote_setup.sh
#   then copy measurements/bench_<host>.json back into the repo and commit it.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== CPU =="
lscpu | grep -E "Model name|Flags" | sed 's/Flags:.*\(amx_tile\).*/Flags: ... amx_tile .../' || true
grep -q amx_tile /proc/cpuinfo && echo "Intel AMX: available" || echo "Intel AMX: not reported"

python3 -m venv inference/.venv
inference/.venv/bin/pip install --quiet -r inference/requirements.lock
inference/.venv/bin/pip install --quiet "openvino-genai==2026.4.1.0" "openvino-tokenizers==2026.4.1.0" huggingface_hub
# NPU on Core Ultra under Linux also needs the Intel NPU driver (intel/linux-npu-driver releases).

# Models: CV + surrogate are in models/ (git); CLIP and the SLM are fetched at pinned revisions.
inference/.venv/bin/python inference/scripts/fetch_clip.py
inference/.venv/bin/python inference/scripts/build_clip_scenes.py
inference/.venv/bin/python inference/scripts/fetch_slm.py

inference/.venv/bin/python bench/run_all.py --runs 50
inference/.venv/bin/python eval/pinn2_eval.py
inference/.venv/bin/python eval/slm_eval.py --n 50
echo "Done. Copy measurements/bench_$(hostname | tr 'A-Z' 'a-z').json, pinn2.json and slm.json back to the repo."
