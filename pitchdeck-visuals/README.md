# Visual Pitch Deck: PAVEMENT-PINN

Semua visual di folder ini **dibuat dari proses dan data asli**, bisa dibuat ulang kapan saja di depan juri:

```
cd inference
PYTHONPATH=. MLET_WORKERS=2 .venv/Scripts/python training/gen_mlet_dataset.py --n 20000 --seed 42 --out ../pitchdeck-visuals/_work/mlet_dual_v1.npz
PYTHONPATH=. MLET_WORKERS=1 .venv/Scripts/python ../pitchdeck-visuals/make_visuals.py
cd .. && PP_KOOR=email:sandi PP_PETUGAS=email:sandi node pitchdeck-visuals/screenshots.mjs   # aplikasi & AI harus menyala
```

| File | Isi | Angka kunci (asli) |
|---|---|---|
| 01_dataset_distribusi_input.png | Distribusi 8 parameter struktur perkerasan | 19.894 struktur, Latin Hypercube seed 42 |
| 02_dataset_label_regangan.png | Label regangan dari solver fisika MLET (PyMastic) | εt & εv, roda ganda |
| 03_dataset_contoh_baris.png | 8 baris contoh dataset | input → output |
| 04_training_terminal_log.png | Log terminal training | 6000 step, 61 s di CPU |
| 05_training_loss_curve.png | Kurva loss train / validasi / fisika | val MSE 0,54 → 0,00086 |
| 06_training_ablation_physics.png | PINN vs MLP biasa | akurasi setara; pelanggaran fisika 0,25% vs 0,64% (≈2,6× lebih patuh) |
| 07_evaluasi_parity_plot.png | Prediksi vs ground truth, 3.979 struktur uji | MAPE εt 1,16% · εv 0,62% |
| 08_evaluasi_distribusi_galat.png | Histogram galat data uji | p95 εt 3,0% · εv 1,8% |
| 09_kecepatan_pinn_vs_solver.png | Waktu per struktur: PINN vs solver fisika | ≈2.100× lebih cepat (0,016 ms vs 33 ms) |
| 10_openvino_latensi_presisi.png | Latensi FP32 / FP16 / INT8 per model (OpenVINO) | YOLOv8n INT8 19,6 ms (51 fps) vs FP32 34,4 ms |
| 11_cv_deteksi/*.jpg | Hasil deteksi AI pada foto jalan nyata | kotak deteksi + jenis dari model scene + genangan |
| 12_cv_scene_probabilitas.png | Probabilitas 11 jenis kerusakan (CLIP INT8) | per foto |
| 13_cv_pipeline_waktu.png | Waktu tiap tahap pipeline AI per foto | ±0,23–0,67 s per foto, termasuk pemuatan pertama |
| 14_arsitektur_sistem.png | Arsitektur sistem | — |
| 15_alur_laporan.png | Alur 7 langkah satu laporan | — |
| 16_peran_pengguna.png | 4 peran pengguna | — |
| 17_screenshot_aplikasi/ | Tangkapan layar aplikasi berjalan (HP 390×844 & desktop 1440×900) | — |

Catatan untuk presenter:
- Grafik 01–08 berasal dari training ulang PI-surrogate di laptop tim dengan kode & hyper-parameter yang sama dengan model produksi (`models/pi-surrogate-v1`); angkanya sedikit berbeda dari run asli karena dataset dibuat ulang (MAPE run produksi tercatat di `measurements/pinn2.json`: εt 0,67%, εv 0,49%).
- Grafik 09–10 diambil dari `measurements/*.json` (benchmark OpenVINO di laptop tim).
- `_work/` berisi dataset, log, dan ringkasan run, sebagai bukti bila juri bertanya.
