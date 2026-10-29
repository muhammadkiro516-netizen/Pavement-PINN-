# Roadmap (SPEC §3: sengaja belum dikerjakan, atau belum selesai)

## Belum dikerjakan (di luar lingkup v4)
- **3D damage (SfM) dan workspace 9 tahap**: kode ada, tetapi disembunyikan (`VITE_SHOW_3D=1`); unggah sekuens foto ke server inference belum disambungkan.
- **Deteksi jembatan terlatih penuh**; triase aset lain (jembatan, trotoar, drainase, perlengkapan) dengan CLIP (M1.2) belum dibuat.
- **OCR papan proyek**: memakai form manual + foto.
- **Hadiah mitra/voucher, papan peringkat publik, RAG pedoman.**
- **Tekanan air pori, deteksi rutting dari foto.**

## Sebagian / belum selesai di v4 (jujur)
- **PINN-1** (M5.2): error vs PyMastic belum < 10%; invers belum berhasil. Rencana: L-BFGS setelah Adam, skala variabel per lapis, titik kolokasi adaptif di dekat beban.
- **M5.3 "Uji di sini"** (titik DCP yang paling mengurangi varians): belum.
- **M1.3/M1.4**: live scan masih aktif sebagai default; kunci kamera > 10 km/jam belum (F8).
- **M8 gamifikasi**: XP, level dan badge dari peristiwa terverifikasi sudah ada; quest, e-sertifikat dan avatar builder belum.
- **M9**: Radar Bahaya, onboarding 3 layar, dan tema terang belum.
- **SLM**: lolos pemeriksa di sebagian kecil kasus pada CPU (lihat `measurements/slm.json`); sisanya memakai templat. Coba model lain/lebih besar di NPU Core Ultra.
- **Bukti perangkat keras Intel**: semua pengukuran saat ini di AMD (`HOST_NON_INTEL`).
- **Hosting tetap**: Docker/Caddy siap, butuh VM dan domain.
