# PROGRESS — PAVEMENT-PINN v4 (rujuk SPEC.md per ID)

Branch `v4` dari `lean-real` 3165218. Riwayat lama: `git show 3165218:PROGRESS.md`. Tidak di-commit: `docs/POST_STRUCTURE_AUDIT.md`, `docs/CLAUDE_PROJECT_STATUS_HANDOFF.md`.

## Status fase
| Fase | Status |
|---|---|
| F0 | 788d179: 3D/Validation + T0–T8 disembunyikan (`VITE_SHOW_3D=1`); quick tunnel |
| F1 | 02d2c97: data perbaikan wajib + katalog, umur perbaikan nyata, konfirmasi 1-3-6 bln, flag pemeliharaan, `measurements/recurrence.json` |
| F2 | 12150d8: jam pasir, eskalasi H+2/7/14/30 + draf pengaduan, `SET_PENDING`, witness server, Rapor Instansi, Pimpinan |
| F3 | d2ec705: PINN-2 `/v1/diagnose` + setuju/timpa; Audit (harga berlabel, kewajaran, flag + tanggapan, data proyek) |
| F4 | 86e7861, target BELUM: PINN-1 L2 vs PyMastic w 28%, εzz 92% (ablasi 41%/181%); invers CONTOH gagal. Perlu L-BFGS + iterasi |
| F5 | 821e716: kartu story 9:16, share, caption + checker, `/r/:code` OG + kunjungan unik |
| F6 | 0becd36: SLM Qwen2.5-1.5B INT4 OpenVINO GenAI (CPU; GPU AMD crash), angka dari kode, PDF DRAF, persetujuan |
| F7 | harness: `eval/` (pinn1, pinn2, slm, cv, clip), `bench/run_all.py` + `remote_setup.sh`, `/api/public/measurements` → /bukti, SUS in-app, `scripts/export-measurements.ts`, docs Intel + `docs/evidence/` |
| F8 | sebagian: kunci kamera > 10 km/jam, "Bantu bidik" opt-in 1 dtk, Radar Bahaya, onboarding 3 layar, quests + XP cap + e-sertifikat QR, tab "Kawal". Belum: tema terang, avatar builder, triase aset CLIP (M1.2) |
| F9 | sebagian: Dockerfile ×2, compose, Caddy, deploy.sh + backup, `.env.example`, GENAI_DISCLOSURE (otomatis), CORE_EXPLAINED, ROADMAP. Belum: VM/domain (butuh pengguna) |

## Keputusan
- Overview 3 langkah; kode 3D disimpan. Pimpinan = `POLICY_MAKER`. Eskalasi & 1-3-6 bln dihitung saat dibaca. Dihapus: foto sampel, "Dukung" lokal.
- Umur seharusnya tambalan = umur nyata metode sama (min. 5); ESAL diisi manusia. PINN-2 akurat (εt 0,67%, εv 0,49%, ±2.100× PyMastic).
- SLM (10 kasus, CPU AMD): SLM 40%, templat 60%, 10 tok/dtk. CV/CLIP lokal BELUM_DIUKUR. Nav warga 5 tab (Notifikasi dipertahankan).
- Docker belum diuji di mesin ini. Tes `session-lifecycle` flaky saat CPU penuh. Disk C ±3 GB.

## Alamat publik
- https://avlfelo.tail8b73d2.ts.net (Tailscale Funnel → laptop :3100; hidup selama laptop menyala). Start: `powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1`. Server permanen: `scripts/deploy_vm.sh` (butuh VM).

## Blocker (manusia)
- Tunnel sementara: `~/bin/cloudflared.exe tunnel --url http://localhost:3100`. §7: VM Xeon/Core Ultra, foto lokal, data proyek, wawancara, SUS.

## Langkah berikutnya
1. Manusia: VM Intel Xeon + domain → `bash scripts/deploy.sh --install-cron`; jalankan `bench/remote_setup.sh` di mesin Intel.
2. Isi `eval/local_test/` (≥100 foto) → `eval/cv_eval.py`, `eval/clip_eval.py`; isi `docs/evidence/*.md`.
3. PINN-1: L-BFGS + iterasi lebih banyak; M1.2 triase aset; tema terang; avatar builder.
