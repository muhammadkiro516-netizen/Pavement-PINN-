# PROGRESS — PAVEMENT-PINN v4 (rujuk SPEC.md per ID)

Branch `v4` (dari `lean-real` 3165218). Tes dasar: 327 Node + 51 pytest.
Riwayat lama: `git show 3165218:PROGRESS.md`. Sengaja tidak di-commit: `docs/POST_STRUCTURE_AUDIT.md`, `docs/CLAUDE_PROJECT_STATUS_HANDOFF.md`.

## Status fase
| Fase | Status |
|---|---|
| F0 | sebagian: tab 3D/Validation + pipeline T0–T8 disembunyikan (flag `VITE_SHOW_3D=1`), PROGRESS.md; **tunnel HTTPS belum hidup** (lihat Blocker) |
| F1–F9 | belum |

## Keputusan (yang tidak dijawab spec)
- F0: Overview diringkas menjadi 3 langkah **Konfirmasi (T3) → Struktur (T7) → Usulan**. Spec menyebut "Ruas"; halaman Ruas baru dibangun di F1, jadi langkah ke-2 sementara menampilkan T7.
- F0: kode 3D/Validation tidak dihapus, hanya disembunyikan (e2e lama perlu `VITE_SHOW_3D=1`).
- Trailer commit: `Assisted-by: Claude Code` (§0.9).

## Blocker (perlu manusia)
- **Tunnel HTTPS:** `cloudflared` sudah diunduh ke `~/bin/cloudflared.exe` (v2026.10.5), tetapi membuka tunnel publik ke laptop ditolak oleh pengaman otomatis agent. Pengguna menjalankan sendiri:
  `~/bin/cloudflared.exe tunnel --no-autoupdate --url http://localhost:3100`
  atau mengizinkan agent menjalankannya.
- §7: VM Xeon / Intel AI PC Cloud / laptop Core Ultra, foto uji lokal, data proyek, wawancara, SUS.

## Langkah berikutnya
1. Hidupkan tunnel dan cetak URL.
2. F1 (M2): field perbaikan wajib di COMPLETE_WORK_ORDER (metode, material, tebal, luas, pemadat, kategori, nilai), halaman Ruas + umur perbaikan nyata, konfirmasi 1-3-6 bulan, masa pemeliharaan, `measurements/recurrence.json`.
