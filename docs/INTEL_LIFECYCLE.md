# Intel di seluruh siklus hidup AI — PAVEMENT-PINN (SPEC §5)

Status jujur per 29 Oktober 2026: semua angka yang sudah ada diukur di laptop **AMD Ryzen 7 5800HS** (label `HOST_NON_INTEL`). Itu bukti perangkat lunak Intel (OpenVINO, NNCF, OpenVINO GenAI), **bukan** bukti perangkat keras Intel. Baris "Rencana Intel" diisi setelah tim menjalankan `bench/remote_setup.sh` di Intel AI PC Cloud / laptop Core Ultra / VM Xeon (SPEC §5 A–C).

| Tahap | Alat Intel | Perangkat (sekarang → rencana) | Bukti |
|---|---|---|---|
| Eksplorasi data | OpenVINO (CV), PyMastic untuk data fisika | CPU AMD → CPU Intel Core Ultra | `measurements/benchmark-*.json` |
| Pelatihan surrogate PINN-2 | PyTorch → ekspor OpenVINO IR | CPU → **Xeon gen-4+ (AMX bf16)** | `models/pi-surrogate-v1_metrics.json` |
| Pelatihan PINN-1 | PyTorch (CPU) | CPU AMD → Xeon AMX / Arc iGPU (XPU) | `measurements/pinn1_*.json` |
| Optimasi | **NNCF** INT8 (YOLO, surrogate, CLIP weight compression) | CPU | `int8Agreement` di `benchmark-*.json` |
| Evaluasi | `eval/pinn2_eval.py`, `eval/slm_eval.py`, `eval/cv_eval.py`, `eval/clip_eval.py` | CPU → CPU/GPU/NPU Core Ultra | `measurements/pinn2.json`, `slm.json`, `cv_local.json`, `clip_scene.json` |
| GenAI | **OpenVINO GenAI** `LLMPipeline`, Qwen2.5-1.5B INT4 | CPU (iGPU AMD crash, dilewati) → **NPU Core Ultra** | `measurements/slm.json` |
| Deployment | OpenVINO Runtime di FastAPI | laptop → **VM Intel Xeon** (F9) + lapangan Core Ultra | `measurements/bench_<host>.json` |

## Yang tercatat otomatis di setiap file bukti
`measuredAt`, `commit`, nama CPU, `available_devices` beserta nama lengkapnya, versi OpenVINO, flag `amx_tile` (Linux), dan `hostLabel`.

## Cara mengisi baris "rencana"
1. Sediakan mesin Intel (SPEC §7.1; agent tidak membuat akun).
2. `bash bench/remote_setup.sh` → salin `measurements/bench_<host>.json`, `pinn2.json`, `slm.json` ke repo dan commit.
3. Halaman `/bukti` langsung menampilkan hasilnya beserta perangkatnya.
