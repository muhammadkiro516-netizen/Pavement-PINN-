# PROGRESS — PAVEMENT-PINN v4 (rujuk SPEC.md per ID)

Branch `v4` (dari `lean-real` 3165218). Tes dasar: 327 Node + 51 pytest.
Riwayat lama: `git show 3165218:PROGRESS.md`. Sengaja tidak di-commit: `docs/POST_STRUCTURE_AUDIT.md`, `docs/CLAUDE_PROJECT_STATUS_HANDOFF.md`.

## Status fase
| Fase | Status |
|---|---|
| F0 | SELESAI 788d179: 3D/Validation + T0–T8 disembunyikan (`VITE_SHOW_3D=1`), quick tunnel hidup (URL berganti tiap restart; lihat `.data/tunnel.log`) |
| F1 | SELESAI 02d2c97: M2.1 data perbaikan wajib (+ katalog `config/materials.json`), M2.2 umur perbaikan nyata + riwayat di Ruas/Statistik, M2.3 konfirmasi 1-3-6 bln (Notifikasi), M2.4 flag masa pemeliharaan (internal), job harian → `measurements/recurrence.json` |
| F2 | SELESAI: M3.1 jam pasir, M3.2 tangga H+2/7/14/30 + draf pengaduan teks/PDF, M3.3 `SET_PENDING` (publik, menghentikan eskalasi), M3.4 "Saya juga melihat ini" tersimpan di server, M3.5 Rapor Instansi, peran Pimpinan (tab Eskalasi/Rapor) |
| F3–F9 | belum |

## Keputusan (yang tidak dijawab spec)
- F0: Overview diringkas menjadi 3 langkah **Konfirmasi (T3) → Struktur (T7) → Usulan**. Spec menyebut "Ruas"; halaman Ruas baru dibangun di F1, jadi langkah ke-2 sementara menampilkan T7.
- F0: kode 3D/Validation tidak dihapus, hanya disembunyikan (e2e lama perlu `VITE_SHOW_3D=1`).
- F1: "job terjadwal" = job harian yang menulis metrik recurrence; pertanyaan 1-3-6 bulan dihitung saat diminta (`dueConfirmations`), tanpa push notification. Radius 300 m memakai posisi terakhir perangkat (dikirim klien).
- F1: tombol "foto sampel hasil perbaikan" dihapus (§0.1).
- F2: Pimpinan = role `POLICY_MAKER` yang sudah ada (identifier RBAC tidak diganti). Eskalasi dihitung murni dari case saat dibaca (tanpa state tersimpan). Setelah tanggal alasan tertunda lewat, hitungan tangga dimulai ulang dari tanggal itu.
- F2: tombol "Dukung" lama hanya menghitung di browser; diganti witness tersimpan di server.
- Trailer commit: `Assisted-by: Claude Code` (§0.9).

## Blocker (perlu manusia)
- Tunnel quick (izin pengguna): `~/bin/cloudflared.exe tunnel --no-autoupdate --url http://localhost:3100`; URL tetap butuh VM/domain (F9).
- §7: VM Xeon / Intel AI PC Cloud / laptop Core Ultra, foto uji lokal, data proyek, wawancara, SUS.

## Langkah berikutnya
1. F3: M5.1 PINN-2 diagnosis probabilistik (🔴🟡🟢, P10–P90, setuju/timpa beralasan) + M6 Audit (katalog lengkap, harga berlabel, Kalkulator Kewajaran, umur seharusnya vs nyata, alur HITL, form data proyek).
