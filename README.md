# PAVEMENT-PINN

**Potret jalan rusak. AI dan petugas menanganinya sampai tuntas.**

Warga memotret kerusakan jalan. AI (OpenVINO) mengenali jenis kerusakannya. Petugas lapangan memeriksa dan
mengoreksi hasil AI di lokasi. **PINN** (Physics-Informed Neural Network surrogate dari solver perkerasan berlapis
MLET) menjawab: rusak di permukaan atau di struktur, seberapa besar dampak truk kelebihan muatan dan musim hujan,
dan penanganan mana yang tidak sia-sia. Koordinator instansi memutuskan, dan warga ikut memastikan perbaikannya
benar terjadi. Setiap keputusan manusia tercatat dan dipakai untuk mengukur dan memperbaiki AI (human-in-the-loop).

Rencana dan keputusan produk: [docs/LEAN_PLAN.md](docs/LEAN_PLAN.md). Sitasi: [docs/CITATIONS.md](docs/CITATIONS.md).
Pengungkapan GenAI: [docs/GENAI_DISCLOSURE.md](docs/GENAI_DISCLOSURE.md).

## Tiga peran

| Peran | Yang dikerjakan |
|---|---|
| **Warga** (daftar sendiri) | Lapor dengan kamera, lihat hasil AI, pantau status di Laporanku, terima notifikasi |
| **Petugas Lapangan** (dibuat Koordinator) | Tugas inspeksi, konfirmasi/koreksi hasil AI, ukur di lokasi, analisis PINN, bukti perbaikan |
| **Koordinator** (dibuat Koordinator) | Antrian, penugasan, keputusan, verifikasi perbaikan, tim, statistik dampak & akurasi AI |

Semua halaman memerlukan login, kecuali `/login`, `/lacak/<kode>`, dan `/bukti` (transparansi AI).

## Mesin AI (semuanya benar-benar berjalan)

| Mesin | Teknologi | Status |
|---|---|---|
| Deteksi kerusakan | YOLOv8n (RDD) · OpenVINO | berjalan; hasil < 0,6 keyakinan selalu ditinjau petugas |
| Segmentasi retak | YOLOv8s-seg · OpenVINO | berjalan |
| PINN surrogate | MLP physics-informed, 19.894 solusi PyMastic · OpenVINO FP32/FP16/INT8 (NNCF) | berjalan; MAPE εt 1,16 % vs solver |
| Solver MLET | PyMastic | berjalan; rujukan dan peta regangan |
| Kuantisasi | NNCF INT8 (surrogate dan detector) | detector INT8 1,76× lebih cepat, kesesuaian 77 % → produksi tetap FP32 |

Angka di atas diukur oleh `inference/scripts/benchmark.py` dan tampil di halaman **/bukti**.

## Menjalankan

Satu perintah (Windows, PowerShell): build, layanan AI, server, dan **link publik HTTPS gratis** (Cloudflare quick
tunnel, tanpa akun):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\go-live.ps1
```

Koordinator pertama (sekali saja, di terminal lain):

```powershell
$env:PINN_PASSWORD="kata-sandi-anda"; npm run create-coordinator -- email@instansi.go.id "Nama" "Nama Instansi"
```

Pengembangan:

| Perintah | Fungsi |
|---|---|
| `npm run dev` | server + Vite di `http://localhost:3000/PavementPinn/` |
| `inference\.venv\Scripts\python -m uvicorn app.main:app --port 8100` (dari `inference/`) | layanan AI |
| `npm run lint` · `npm test` | typecheck · tes Node |
| `inference\.venv\Scripts\python -m pytest -q` (dari `inference/`) | tes Python |
| `inference\.venv\Scripts\python -I inference\scripts\benchmark.py` | NNCF + benchmark → `/bukti` |

## Batasan yang diakui

- Kedalaman lubang tidak bisa diukur dari satu foto; petugas mengukurnya di lokasi.
- Detector dilatih dengan dataset internasional; akurasi di jalan Indonesia diukur dari koreksi petugas (Statistik).
- Hasil PINN bergantung pada tebal lapisan dan beban yang diisi petugas; indikatif, bukan desain.
- Penyimpanan: file JSON di satu server (`.data/`); salin folder itu sebagai backup.
