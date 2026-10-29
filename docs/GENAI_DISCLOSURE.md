# Pengungkapan penggunaan GenAI (dibuat otomatis, SPEC §9)

Dibuat 2026-10-29 dari riwayat git (2026-08-24 s.d. 2026-10-29) oleh `scripts/genai-disclosure.ts`.

## Alat
| Alat | Dipakai untuk |
|---|---|
| Claude / Claude Code (Anthropic) | menulis dan merevisi kode, tes dan dokumen atas arahan tim; setiap commit yang dibantu diberi trailer |
| Qwen2.5-1.5B-Instruct (lokal, OpenVINO GenAI) | fitur aplikasi: draf kalimat Usulan Penanganan (angka diisi kode, wajib disetujui manusia) |
| (alat lain yang dipakai tim — isi manual) | |

## Angka dari riwayat git
- Total commit (tanpa merge): **62**
- Commit dengan trailer bantuan AI: **20 (32.3%)**
- Commit tanpa trailer: 42 (ditulis tim atau sebelum trailer dipakai; trailer baru konsisten sejak fase v4)

## Wajib dilengkapi tim sebelum interview
Dokumen lama menyebut `AGENTS.md` dan keputusan "HD-08 commit trailer (Assisted-by)", tanda bahwa tool AI lain juga pernah dipakai. Rubrik: tidak mengungkapkan = 0 poin; tulis semuanya dengan jujur.

| Tool | Dipakai untuk | Siapa |
|---|---|---|
| _(contoh: ChatGPT / Codex / Copilot / Gemini / Midjourney)_ | | |

## Peran manusia (tim)
- Ide masalah, konsep human-in-the-loop, pilihan role dan alur, keputusan produk.
- Memilih model (YOLO, MLET/PyMastic, PINN surrogate) dan memeriksa hasilnya.
- Uji coba aplikasi, pengumpulan data dan masukan pengguna, verifikasi sumber berita.

## Kalimat untuk interview
"Kami memakai asisten coding AI, terutama Claude Code, untuk mempercepat penulisan kode dan tes; setiap commit yang dibantu diberi tanda. Ide, alur human-in-the-loop dan keputusan produk berasal dari tim, dan kami memeriksa hasilnya. Di dalam aplikasi, satu-satunya GenAI adalah model bahasa kecil yang berjalan lokal di OpenVINO untuk draf usulan; angkanya diisi kode dan draf wajib disetujui pejabat."

## Ditulis atau ditinjau manusia (isi oleh tim)
| Modul | Penulis/peninjau | Catatan |
|---|---|---|
| Rumus PINN-2 & asumsi (inference/app/diagnose.py, decide.py) | | |
| Kalkulator kewajaran & buku harga (config/prices) | | |
| Data instansi (config/authorities) | | |
| Teks publik & caption | | |

Catatan: persentase commit bukan ukuran kontribusi intelektual; keputusan desain, data lapangan, wawancara dan verifikasi sumber dilakukan tim.
