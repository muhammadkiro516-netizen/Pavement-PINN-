# 11 — Intel Evidence Plan (Metric 3: Use of Intel Technologies, 30 pts incl. IDR 3)

> Goal: every Intel claim in the deck, the app's Evidence page (`/bukti/`) and the Q&A is backed by a file in `measurements/` or `docs/evidence/` that names the **exact device** (`FULL_DEVICE_NAME`) and **software versions**.
> Today (2026-11-01) **all** benchmark files say `hostLabel: HOST_NON_INTEL` (AMD Ryzen 7 5800HS, OpenVINO 2026.4.1 on CPU; AMD iGPU numbers are not Intel GPU evidence). Nothing below may be claimed until re-run on Intel hardware.
> Facts about OpenVINO/Intel hardware come from research note 09 (Phoronix, newreleases.io, PyTorch docs, Intel pages). Items marked UNVERIFIED must be checked on the official docs page before quoting.

---

## 0. Status words (use exactly these in deck, UI and Q&A)

| Word | Meaning | Example |
|---|---|---|
| **Configured** | Code path exists and is selectable, never run on that device | "NPU path configured" |
| **Tested** | Ran on the named Intel device, result file committed | "Tested on Core Ultra 7 155H NPU: `slm_NPU.json`" |
| **Piloting** | Used by real users in a time-boxed pilot, with logs | "Piloting with 12 citizens in Matraman" |
| **Operational** | Used by an agency in daily work | (not yet — never claim) |

---

## 1. Lifecycle map (what Intel tech is used where, and why)

| Stage | Intel tech | Why it is needed (link to a real requirement) | Evidence file | Status now |
|---|---|---|---|---|
| 1. Data generation | Intel Core/Xeon CPU (multi-thread PyMastic), optional sklearnex | 19,894 layered-elastic solves for surrogate training | `measurements/datagen_<host>.json` (time, threads, CPU name) | Done once on an Intel Core i5-12450H (per model card) but not logged by script — see note |
| 2. Training | PyTorch XPU on Intel Arc / Core Ultra iGPU, or Intel Tiber AI Cloud | Fine-tune detector/segmenter and surrogate without a discrete NVIDIA GPU | `measurements/train_detector_<id>.json` with `torch.xpu.get_device_name()` | Not done |
| 3. Optimization | NNCF PTQ INT8 (CV, CLIP); NNCF/Optimum Intel INT4 weight compression (SLM) | Model size + latency on low-power devices; LLM must fit laptop RAM/NPU | `measurements/quant_delta.json` (size, accuracy, latency FP32 vs INT8/INT4) | INT8 done for detector/surrogate on non-Intel; accuracy delta not measured on labelled data |
| 4. Evaluation | OpenVINO Runtime on Intel CPU/GPU/NPU; `benchmark_app` | Reproducible latency on the device that will run the demo | `measurements/bench_<host>.json`, `measurements/benchmark_app/<model>_<device>_<precision>.json` | Non-Intel only |
| 5. Server deployment | Intel Xeon VM (AMX if gen-4+) + OpenVINO CPU | Public HTTPS service for citizens; CPU-only inference is cheaper than GPU servers | `measurements/bench_<xeon-host>.json` incl. `amxTile` | Not done |
| 6. Edge / field deployment | Intel Core Ultra laptop: CPU (YOLO), iGPU (seg / batch Monte Carlo), **NPU (SLM via OpenVINO GenAI)** | Inspector works offline at the roadside; NPU runs the text model while CPU/GPU stay free for vision; low power | `measurements/slm_NPU.json`, `measurements/bench_<coreultra-host>.json`, offline demo video | Configured only |
| 7. Monitoring/profiling (P2) | VTune ITT profiling of NPU (new in OpenVINO 2026.4) | Explain where time goes | screenshot | — |

> Note: the surrogate model card says the PyMastic dataset was generated on an **i5-12450H** (an Intel Core CPU) in 70 s on 12 threads. That is an Intel CPU, but it was not logged by script. Re-run `gen_mlet_dataset.py` under `env_report` logging to turn it into evidence.

---

## 2. Hardware access options (human task — Claude Code prepares scripts, never creates accounts)

| Option | What you get | How | Effort | Use for |
|---|---|---|---|---|
| **A. Borrowed Intel Core Ultra laptop** (best) | CPU + Arc iGPU + NPU in one machine; demo runs on it live | Ask campus lab, lecturer, Intel Indonesia contacts via festival organizer, friends; any Core Ultra Series 1 (Meteor Lake, e.g. 155H), Series 2 (Lunar Lake 200V, NPU up to 48 TOPS), Series 3 (Panther Lake, NPU 5 up to 50 TOPS) | 1–2 days to get, 3 h to set up | Stages 2, 4, 6 + live demo |
| **B. Intel Tiber AI Cloud** (console.cloud.intel.com) | "Learning node" quick start, free training via Learning services; preview hardware | Sign up; ask in Intel Community thread "Request for Student Credits…" (title only seen; credits UNVERIFIED) | ½ day | Stage 2 (training), 4 (Xeon/GPU benches) |
| **C. Cloud Xeon VM** (gen-4 Sapphire Rapids or newer for AMX) | Server CPU benchmark + public deployment | Any provider; check `lscpu \| grep amx` | 2 h | Stage 5 + public HTTPS URL |
| **D. Ask the festival organizer** | Possible Intel-provided access for finalists | Email (template in §10) | — | All |

Minimum for full Metric-3 story: **A (or B with a Core Ultra node) + C**. If only one: A.

---

## 3. Software install on the Intel machine (pin versions)

Python ≥ 3.11 (OpenVINO drops Python 3.10 in 2026.5). Use `import openvino as ov` (the `openvino.runtime` namespace was removed in 2026.0). Use `nncf.quantize` / `nncf.compress_weights` (`create_compressed_model()` removed).

```bash
# Linux / WSL2 (Ubuntu 24.04) or Windows PowerShell equivalents
python3.11 -m venv inference/.venv && source inference/.venv/bin/activate
pip install -r inference/requirements.lock            # already pins openvino 2026.4.1
pip install "openvino-genai==2026.4.1.0" "openvino-tokenizers==2026.4.1.0" "optimum-intel[openvino]" nncf
# PyTorch XPU for training on Intel GPU (PyTorch 2.15 docs):
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/xpu
python -c "import torch; print(torch.__version__, torch.xpu.is_available(), torch.xpu.get_device_name() if torch.xpu.is_available() else '-')"
```
Drivers:
- **GPU:** Windows — latest Intel Arc & Iris Xe graphics driver; Linux — Intel compute-runtime (OpenCL/Level Zero) packages.
- **NPU:** Windows — Intel NPU driver (Device Manager → "Neural processors"); Linux — `intel/linux-npu-driver` release matching the kernel. OpenVINO 2026.x ships the NPU compiler inside the plugin, so OEM driver age matters less, but the kernel driver is still required.
- Note: OpenVINO 2026.4 CPU plugin requires AVX2.

Verify (save output):
```bash
python - <<'PY'
import openvino as ov, json
c = ov.Core()
print(ov.get_version())
for d in c.available_devices:
    print(d, "|", c.get_property(d, "FULL_DEVICE_NAME"))
PY
```

---

## 4. `bench/env_report.py` (NEW, P0) → `measurements/env_<host>.json`

Collects, in one JSON (and is imported by every other bench/eval script for the common header):
- `ov.get_version()`, `ov.Core().available_devices`, `FULL_DEVICE_NAME` for each device, NPU/GPU driver version where queryable (`DEVICE_ARCHITECTURE`, `GPU_DEVICE_TOTAL_MEM_SIZE`, `NPU_DRIVER_VERSION` if the property exists — wrap in try/except, record "unavailable").
- `nncf`, `openvino_genai`, `optimum-intel`, `torch`, `ultralytics`, `transformers` versions.
- `torch.xpu.is_available()` and `get_device_name()`.
- CPU model (`lscpu` / `platform.processor()` / Windows `wmic cpu get name`), core count, RAM, OS, AMX flag (`amx_tile` in `/proc/cpuinfo`).
- `hostLabel`: `HOST_INTEL` iff CPU vendor is GenuineIntel **and** device names contain "Intel"; separate flags `intelCPU`, `intelGPU`, `intelNPU`.
- Git commit, timestamp.

UI rule: `/bukti/` shows an "Intel device" badge only for files with `hostLabel = HOST_INTEL`; others show "Measured on non-Intel dev laptop" in grey.

---

## 5. Benchmarks with `benchmark_app` (per model × device × precision)

Static shapes for NPU. Save both stdout and JSON stats. Flags below follow OpenVINO `benchmark_app`; confirm with `benchmark_app -h` on 2026.4 and adjust names if they changed. Wrapper script `bench/ov_bench.sh` (NEW P0) loops over the matrix and writes `measurements/benchmark_app/<model>_<device>_<precision>_<hint>.{txt,json}` plus a summary table `measurements/benchmark_app/summary_<host>.json`.

```bash
M=models/cv/rdd-yolov8n-v1
for DEV in CPU GPU NPU; do
 for X in rdd_yolov8.xml rdd_yolov8_int8.xml; do
  for HINT in latency throughput; do
   benchmark_app -m $M/$X -d $DEV -hint $HINT -t 30 -shape "[1,3,640,640]" \
     -report_type average_counters -report_folder measurements/benchmark_app/$(basename $X .xml)_${DEV}_${HINT} \
     -json_stats | tee measurements/benchmark_app/$(basename $X .xml)_${DEV}_${HINT}.txt
  done; done; done
```

| Model (IR) | Shape | Devices | Precisions | Hints |
|---|---|---|---|---|
| Detector (ours, after training) `models/cv/<id>/*.xml` | `[1,3,640,640]` | CPU, GPU, NPU | FP32, FP16 (GPU), INT8 | latency, throughput |
| Current detector `rdd-yolov8n-v1` | same | CPU, GPU, NPU | FP32, INT8 | latency |
| Segmenter (pothole-seg / crack-seg) | `[1,3,640,640]` | CPU, GPU, NPU | FP32, INT8 | latency |
| CLIP image encoder | `[1,3,224,224]` | CPU, GPU, NPU | INT8 | latency |
| PI surrogate | `[256,5]` and `[2000,5]` | CPU, GPU (NPU optional) | FP32, FP16 | latency, throughput |

End-to-end (more meaningful than raw model latency) via `bench/run_all.py` (exists; extend with `--device` loop and the env header):
- `cv_full_pipeline_ms` (gate + blur + detect + seg) per device.
- `pinn2_diagnose_2000_samples_ms` (Monte Carlo) per device, and the same with PyMastic only (to show the ~2,100× gap on Intel).
- `slm` tokens/s, TTFT, peak RAM per device.
- Report p50/p95/p99, n, warmup, and power mode (plugged in, "Best performance").

---

## 6. NNCF INT8 / INT4 steps

**INT8 PTQ (detector, segmenter, CLIP):** `bench/quantize_cv.py` (extend existing).
```python
import nncf, openvino as ov
model = ov.Core().read_model("models/cv/<id>/model.xml")
calib = nncf.Dataset(calib_loader, transform_fn)          # ~300 train images, same preprocessing as serving
q = nncf.quantize(model, calib, preset=nncf.QuantizationPreset.MIXED, subset_size=300)
ov.save_model(q, "models/cv/<id>/model_int8.xml")
```
- If accuracy drop > 1 mAP point: `nncf.quantize_with_accuracy_control(model, calib, val_dataset, validation_fn, max_drop=0.01)`; record which layers stayed FP.
- Write `measurements/quant_delta.json`: per model {FP32 size MB, INT8 size MB, mAP50/F1 FP32 vs INT8 on the same test set, latency per device}.
- PI surrogate: keep FP32 served (model card: INT8 deviation 10.9 %, amplified by fatigue/rutting exponents 3.3–7). Say so — it shows judgment.

**INT4 weights (SLM):**
```bash
# CPU/GPU export
optimum-cli export openvino --model Qwen/Qwen2.5-1.5B-Instruct --weight-format int4 models/slm/qwen2.5-1.5b-int4-ov
# NPU-oriented export (UNVERIFIED recipe — confirm on docs "OpenVINO GenAI on NPU" before use)
optimum-cli export openvino --model Qwen/Qwen2.5-1.5B-Instruct --weight-format int4 --sym --group-size -1 --ratio 1.0 models/slm/qwen2.5-1.5b-int4-npu
```
Record the exact command, model revision (HF commit), and output size in `measurements/slm_export.json`.

---

## 7. OpenVINO GenAI on NPU (the key Intel "AI-specific hardware" proof)

Facts (note 09): OpenVINO 2026.0 added NPU support for models listed as "Qwen2.5-1B-Instruct" and "Qwen-2.5-coder-0.5B" (Phoronix wording; Qwen2.5 is published as 0.5B/1.5B/3B, so check the official supported-models list), speculative decoding on NPU, and integrated the NPU compiler into the plugin.

Plan (`eval/slm_eval.py --device NPU`):
```python
import openvino_genai as ov_genai
pipe = ov_genai.LLMPipeline("models/slm/qwen2.5-1.5b-int4-npu", "NPU")   # optional NPU config keys
# UNVERIFIED keys from docs: MAX_PROMPT_LEN (≈1024 default), MIN_RESPONSE_LEN (≈128 default) — confirm, then pass as kwargs
cfg = ov_genai.GenerationConfig(); cfg.max_new_tokens = 200; cfg.do_sample = False
out = pipe.generate(prompt, cfg)
```
Do **not** use deprecated `start_chat()/finish_chat()`.

Order of attempts, each logged in `measurements/slm_NPU.json` (`status`, `error` text if any):
1. Qwen2.5-1.5B-Instruct INT4 (NPU recipe) on NPU.
2. If compile/run fails: Qwen2.5-0.5B-Instruct INT4 on NPU.
3. Always also run the same 50 cases on CPU and GPU → `slm_CPU.json`, `slm_GPU.json` for comparison (tokens/s, TTFT, checker pass rate, peak RAM).
Claim in the deck only what `status: "MEASURED"` says. If NPU failed: "NPU path configured; on our device the 1.5B model failed to compile (error recorded). We run it on the iGPU." — honest beats points lost in Q&A.

Optional P2: local RAG "Ask the guideline" with OpenVINO GenAI (embedding model e.g. Qwen3-Embedding-0.6B, which 2026.0 lists as NPU-supported) over Bina Marga manuals — only if time allows.

---

## 8. PyTorch vs OpenVINO on the same device (rubric: "measured comparison")

`bench/torch_vs_ov.py` (NEW P0) → `measurements/torch_vs_ov_<host>.json`:

| Pair | Device | Metric |
|---|---|---|
| Detector: PyTorch (Ultralytics `.pt`, CPU) vs OpenVINO FP32 CPU vs OpenVINO INT8 CPU vs OpenVINO GPU vs NPU | same laptop | p50/p95 ms, FPS, RAM |
| Detector: PyTorch XPU (`model.to('xpu')`) vs OpenVINO GPU | same iGPU | p50 ms |
| Surrogate: PyTorch CPU vs OpenVINO CPU FP32 (batch 256 and 2000) | same | ms |
| Monte Carlo 2000: PyMastic (CPU) vs surrogate OpenVINO (CPU/GPU) | same | total ms |
| SLM: HF Transformers PyTorch CPU (FP32/BF16) vs OpenVINO GenAI INT4 CPU/GPU/NPU | same | tokens/s, TTFT, RAM |
| sklearnex vs stock scikit-learn (random-forest baseline fit) | same CPU | seconds (model card shows no speed-up on non-Intel: 1.54 s vs 1.49 s — report the Intel result whatever it is) |

Same inputs, same warmup (5) and runs (≥ 50), same power mode. Accuracy parity check: detector outputs FP32 PyTorch vs OpenVINO (box IoU ≥ 0.9 agreement %).

---

## 9. Screenshots and recordings to capture (save to `docs/evidence/screens/`)

| File | What it shows |
|---|---|
| `01_env_report.png` | Terminal output of §3 verify script: version + CPU/GPU/NPU `FULL_DEVICE_NAME` |
| `02_device_manager_npu.png` | Windows Device Manager "Neural processors" (or `lspci`/`dmesg` NPU line on Linux) |
| `03_benchmark_app_cpu_gpu_npu.png` | Three benchmark_app runs side by side (detector INT8) |
| `04_taskmanager_npu_busy.png` | Task Manager NPU graph (if shown by the driver/OS) or `intel_gpu_top` for GPU, while the SLM/vision runs |
| `05_xpu_training_log.png` | Training log with `torch.xpu.get_device_name()` |
| `06_bukti_page_intel.png` | `/bukti/` Evidence page with `HOST_INTEL` badges |
| `07_offline_demo.mp4` (≤ 60 s) | Wi-Fi off → inspector analysis + SLM draft on the Core Ultra laptop |
| `08_xeon_amx.png` | `lscpu` on the Xeon VM showing `amx_tile` + bench summary |
| `09_vtune_npu.png` (P2) | VTune ITT NPU timeline |

Each screenshot is listed in `docs/evidence/INTEL_EVIDENCE_INDEX.md` with date, device, commit, and which JSON it matches.

---

## 10. Intel Digital Readiness (IDR, 3 pts — scored 0 or 3)

Known (note 09): Intel's newsroom describes the AI Global Impact Festival alongside Intel Digital Readiness programs (> 8 million people trained, 29 governments, 27,000 institutions). The page is undated, and the official list of DR programs was not verified.

Steps (human):
1. **Email the organizer** asking (a) written confirmation that the festival counts as an Intel Digital Readiness program for the rubric, (b) whether Intel DR courses (e.g. AI for Youth / AI for Workforce — names to confirm on intel.com/digitalreadiness) are expected.
   Template: "Dear organizers, we are Stage 3 finalist team PAVEMENT-PINN (Indonesia). For the rubric item 'Participation in Intel Digital Readiness programs', could you confirm in writing that participation in the Intel AI Global Impact Festival 2026 counts, and list any Intel Digital Readiness courses finalists may complete before the interview? Thank you. — {name}, {email}"
2. Each member completes any **free Intel DR / Intel AI course actually available** and saves the certificate PDF.
3. Record honestly in `docs/evidence/intel_program.md` (table exists: activity, date, member, proof link) and store PDFs in `docs/evidence/idr/`.
4. In Q&A, say only what is in that file.

---

## 11. Rubric Metric 3 checklist → evidence file

| Sub-criterion (max) | What judges need | Evidence file(s) | Status now | Target after plan |
|---|---|---|---|---|
| Intel resources across lifecycle (3) | Map with proof per stage | §1 table in `docs/INTEL_LIFECYCLE.md` (update) + files per row | Map exists; proof non-Intel | Each row links a HOST_INTEL file → 3 |
| Rationale for choice (4) | Why Intel, tied to needs, with own benchmark | `docs/INTEL_RATIONALE.md` + `torch_vs_ov_<host>.json` | Rationale text; no same-device comparison on Intel | Same-device PyTorch vs OpenVINO table → 3.5–4 |
| HW benefit / vital (3) | Numbers: Monte Carlo time per segment; tokens/s on NPU | `bench_<coreultra>.json` (`pinn2_diagnose_2000_samples_ms`), `slm_NPU.json` | Non-Intel only | Measured on Core Ultra → 2.5–3 |
| HW types (3) | General (CPU, iGPU, Xeon) + AI-specific (NPU) | `env_<host>.json` for laptop + Xeon | None Intel | CPU+GPU+NPU+Xeon logged → 3 |
| HW coverage (4) | Data gen, training (XPU log), eval, deployment | `datagen_<host>.json`, `train_detector_<id>.json` (XPU), `cv_eval_*` on Intel, `bench_<xeon>.json` | None | 3–4 (training on Intel GPU is the hard part) |
| SW benefit / vital (3) | OpenVINO + NNCF define latency/size; GenAI local | `quant_delta.json`, `benchmark_app/summary_<host>.json` | INT8 latency non-Intel | Intel numbers → 3 |
| SW types (3) | OpenVINO, NNCF, OpenVINO GenAI, Optimum Intel, PyTorch XPU, sklearnex | `env_<host>.json` versions + usage in code | Most configured | → 3 |
| SW coverage (4) | Used in ≥ 5 stages; GenAI workload on OpenVINO GenAI | lifecycle table + `slm_*.json` | GenAI on CPU (AMD) | 3.5; RAG (P2) → 4 |
| IDR participation (3) | Organizer confirmation + proof | `docs/evidence/intel_program.md`, `docs/evidence/idr/*.pdf` | Empty | 0 or 3 — depends on human step §10 |

Deck rule: the Intel slide shows **one table generated from `benchmark_app/summary_<host>.json`** with the device name in the title ("Measured on Intel Core Ultra 7 155H, OpenVINO 2026.4.1, commit abc1234"). Nothing hand-typed.

---

## 12. Definition of Done (Intel)
- [ ] `env_<host>.json` for the Core Ultra laptop (CPU/GPU/NPU names) and the Xeon VM (AMX flag).
- [ ] `benchmark_app/summary_<host>.json` for detector/seg/CLIP/surrogate × CPU/GPU/NPU × FP32/INT8.
- [ ] `torch_vs_ov_<host>.json` same-device comparison.
- [ ] `quant_delta.json` with accuracy on a labelled test set.
- [ ] `slm_NPU.json` (MEASURED or NOT_SUPPORTED with error), `slm_CPU.json`, `slm_GPU.json`.
- [ ] At least one training run on Intel GPU (XPU) or Tiber cloud logged.
- [ ] `/bukti/` shows HOST_INTEL badges; non-Intel files clearly greyed.
- [ ] Screenshots §9 + `INTEL_EVIDENCE_INDEX.md`.
- [ ] `intel_program.md` filled honestly (IDR).
