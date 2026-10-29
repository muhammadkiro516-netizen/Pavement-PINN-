# Foto uji lokal (diisi tim, SPEC §7.2)

Foto di sini dipakai untuk mengukur akurasi AI pada jalan Indonesia, bukan untuk melatih model.

- `images/*.jpg` + `labels/*.txt` (format YOLO: `kelas cx cy w h`, nilai 0–1; indeks kelas sesuai `models/cv/cv_registry.json`). Minimal **100 foto lokal**, ±30% saat basah/malam. Label bisa dibuat dari halaman koreksi petugas atau alat anotasi (mis. CVAT, Label Studio).
- `scenes/<kelas>/*.jpg` untuk CLIP, kelas: `bukan_jalan`, `genangan`, `good`, `cracked`, `potholed`, `broken`, `unpaved` (minimal 20 per kelas).

Privasi: kaburkan wajah dan pelat sebelum menyimpan foto di sini. Foto tidak di-commit (lihat `.gitignore`).

Jalankan: `inference/.venv/Scripts/python eval/cv_eval.py` dan `eval/clip_eval.py`. Sebelum folder terisi, hasilnya `BELUM_DIUKUR`.
