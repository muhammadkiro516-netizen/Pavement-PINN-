# Pengungkapan penggunaan GenAI (Metric 02-C)

Rubrik: tim harus mencantumkan **semua** tool GenAI yang dipakai selama pengembangan. Tidak mengungkapkan = 0
poin; mengungkapkan dengan jujur selalu lebih baik.

## Tool yang terbukti dipakai (dari riwayat git)

| Tool | Dipakai untuk | Bukti |
|---|---|---|
| Claude (Anthropic) lewat Claude Code | penulisan dan refactor kode, tes, dokumentasi, audit, rencana produk | 5 dari 47 commit memuat `Co-Authored-By: Claude` (dihitung 2026-10-28), ditambah seluruh branch `lean-real` |

## Wajib dilengkapi tim sebelum interview

Dokumen lama menyebut `AGENTS.md` dan keputusan "HD-08 commit trailer (Assisted-by)", yang menandakan tool AI lain
juga dipakai sebelumnya. Tulis semuanya di sini dengan jujur:

| Tool | Dipakai untuk | Siapa |
|---|---|---|
| _(contoh: ChatGPT / Codex / Copilot / Gemini / Midjourney)_ | | |

## Peran manusia (tim)

- Ide masalah, konsep human-in-the-loop, pilihan role dan alur, keputusan produk.
- Memilih model (YOLO, MLET/PyMastic, PINN surrogate) dan memeriksa hasilnya.
- Uji coba aplikasi, pengumpulan data dan masukan pengguna.

## Kalimat untuk interview

"Kami memakai asisten coding AI, terutama Claude Code, untuk mempercepat penulisan kode dan tes. Seluruh ide,
alur human-in-the-loop, dan keputusan produk berasal dari tim, dan kami memeriksa setiap hasilnya. Aplikasi yang
berjalan sendiri tidak memanggil layanan GenAI apa pun; semua AI-nya berjalan lokal di OpenVINO."
