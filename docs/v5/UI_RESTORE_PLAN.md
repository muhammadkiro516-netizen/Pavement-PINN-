# PAVEMENT-PINN: rencana memulihkan UI lama dan menambahkan fitur v5

## Prinsip

1. Tampilan lama adalah dasarnya. Layout, animasi, efek deteksi, peta per peran, karakter Pavi, warna, dan bahasa yang mudah dipahami dipertahankan.
2. Fitur v5 ditambahkan ke layar lama, bukan dibuatkan aplikasi baru.
3. Dikerjakan dalam dua tahap:
   - **Tahap 1, UI:** semua layar kembali ke desain lama, lalu fitur baru ditempatkan dengan rapi.
   - **Tahap 2, data nyata:** semua mode demo dihapus, setiap fitur tersambung ke server, dan semuanya diuji.
4. Kode backend v5 yang sudah dikerjakan Claude Code (peran, state machine, rantai hash, routing, biaya, audit) tidak dibuang. Yang dikembalikan hanya lapisan tampilan.

## Bukti tampilan lama di repo

- **Git history:** commit terakhir sebelum Claude Code mulai mengerjakan docs/v5.
- **`pitchdeck-visuals/screenshots_mentah/simulasi_A` dan `simulasi_B`:** 23 screenshot layar lama per peran. Bandingkan nama di dalam kurung dengan isi folder:
  - Warga: peta sekitar, kamera AI langsung, foto dipilih, hasil AI, foto 3 sisi, laporan terkirim, kawal selesai, notifikasi.
  - Koordinator: pusat kendali, ringkasan kasus, ringkasan cuaca, SPK terbit, verifikasi perbaikan.
  - Petugas: tugas saya, inspeksi 3 sisi + AI, ukur di foto atas, ukur kedalaman foto samping, ukuran & catatan, analisis (overview, structure, PINN, keputusan).
- **`pitchdeck-visuals/videos/`:** rekaman alur lama (warga melapor, petugas inspeksi, deteksi). Ini acuan untuk animasi dan efek.

## Pemetaan fitur v5 ke layar lama

| Fitur v5 | Ditaruh di layar lama |
|---|---|
| Kamera langsung + kode sekali pakai + cek GPS | Warga → Kamera AI langsung (efek kotak deteksi tetap) |
| Mode kerusakan panjang (jejak GPS mulai–selesai) | Warga → sebelum kamera: pilihan "Lubang/titik" atau "Kerusakan panjang", lalu tampil di Peta sekitar |
| Routing ke instansi pemilik jalan | Warga → Hasil AI dan Laporan terkirim ("Dikirim ke: Dinas Bina Marga …"). Peta: warna jalan per instansi + ikon kantor |
| Kode lacak + linimasa publik + eskalasi H+2/7/14/30 | Warga → Kawal + Notifikasi |
| Konfirmasi "masih bagus / rusak lagi" (1/3/6 bulan) | Warga → Kawal selesai + Notifikasi |
| Antrian prioritas + alasan + alih instansi (wajib sebut SK) | Koordinator → Pusat kendali + Ringkasan kasus |
| Ukur dengan kartu penanda + penggaris kedalaman | Petugas → Ukur di foto atas + Ukur kedalaman foto samping (diperkuat, bukan diganti) |
| PINN + rentang umur + biaya wajar berlabel | Petugas → Analisis (tab PINN/Keputusan) + tab baru "Biaya" dengan gaya yang sama |
| Persetujuan PPK (bukan orang yang sama) | Koordinator → SPK terbit (tombol Setujui hanya untuk peran Approver) |
| Bukti perbaikan kontraktor/regu | Layar baru "Tugas perbaikan", dibangun dari komponen Tugas saya + Inspeksi 3 sisi |
| Cek pengawas + jadwal tindak lanjut | Koordinator → Verifikasi perbaikan (diperluas) |
| Auditor + PDF laporan + /verify | Layar baru "Audit" (hanya baca), memakai kartu dan tabel dari Ringkasan kasus |
| Pemilih peran | Tombol/selector peran yang lama (bukan header baru) |
| /why dan /tour | Halaman baru dengan gaya landing/beranda lama |

## Bahasa

- Pengguna tidak boleh melihat istilah teknis. Contoh terjemahannya: "εt/εv" → "regangan aspal (indikator retak)"; "P10–P90" → "perkiraan umur: 2–4 tahun"; "AHSP" → "harga resmi pemerintah"; "hash" → "kode bukti"; "MEASURED/ASSUMED" → ikon kecil + "terukur / perkiraan".
- Istilah teknis hanya boleh muncul di tooltip "Detail teknis" untuk petugas dan auditor.

---

## PROMPT 1: kembalikan UI lama (tempel dulu)

```
Stop feature work. Visual-design correction before anything else.

The UI built from docs/v5/09_UI_UX_SPEC.md replaced our original design. That was wrong. Our ORIGINAL UI (screens, layout, animations, AI detection effects, per-role maps, Pavi mascot, colors, fonts, plain-language copy) is the design to keep. Keep all v5 BACKEND/LOGIC work (roles, state machine, SoD, hash chain, routing, cost engine, audit, APIs, tests).

Step 1, find the baseline:
- Run `git log --oneline -- src/` and identify the last commit BEFORE the v5 UI work. Tag it `ui-baseline`.
- Show me the list of UI files changed since `ui-baseline` (git diff --stat ui-baseline -- src/ public/ index.html tailwind/styles).
- Use pitchdeck-visuals/screenshots_mentah/simulasi_A and simulasi_B (23 screenshots) and pitchdeck-visuals/videos/ as the visual ground truth of the original design.

Step 2, restore on a new branch `ui-restore`:
- Restore the original UI layer (components, pages, styles, theme, Pavi, map views, camera/detection animations) from `ui-baseline`.
- Do NOT touch server/, inference/, migrations, v5 domain logic, or tests, except UI tests that must follow the restored screens.
- Remove the /v5/ duplicate shell and its new design tokens. Keep any v5 UI pieces only if they are rebuilt with the original components.
- The app must build and run with the original look. Existing v5 APIs stay available.

Step 3, report:
- Screens restored (match each to a screenshot file name).
- v5 features that are now NOT visible in the UI (we add them in Prompt 2).
- Expose over HTTPS and print the URL.
Do not start Prompt 2 work until I confirm the restored look is correct.
```

## PROMPT 2: tambahkan fitur v5 ke UI lama (tahap 1, UI saja)

```
Now integrate every v5 feature into the ORIGINAL UI, following docs/v5/UI_RESTORE_PLAN.md ("Pemetaan fitur v5 ke layar lama" and "Bahasa").

Rules:
- Reuse the original components, spacing, colors, fonts, animations and detection effects. New screens (Repair Crew tasks, Audit, /why, /tour) must be built only from existing components so they look like the same app.
- Every role keeps its own simple map with the same style; add road-owner colours and agency office icons as a layer and legend.
- Plain everyday English (and Bahasa where the original had it). No technical words on main screens. Technical details only behind a "Technical details" toggle for inspector/auditor.
- Each screen shows at most one primary action. Keep the original navigation per role.
- In this phase, data may come from the existing API or from fixtures, but every fixture is listed in a file `UI_FIXTURES.md` so we can remove it in phase 2. No new "DEMO" banners in the design.
- Add a Storybook-like page /ui-check (dev only) listing every screen per role so I can review them quickly.

Deliver role by role in this order, with a screenshot of each screen after finishing it: Citizen → Field Inspector → Coordinator → Approver → Repair Crew → Supervisor → Auditor → Agency Head → Region Admin.
After each role: run tests, commit, keep the HTTPS URL running, and wait for my "OK" before the next role if any screen looks different from the original style.
```

## PROMPT 3: hapus demo dan sambungkan semuanya (tahap 2, setelah UI disetujui)

```
Phase 2: make everything real. No demo anywhere.

- Remove DEMO MODE, sample photos, fixtures listed in UI_FIXTURES.md, fast-forward time, and seed "demo" labels. Replace each with the real API call.
- Camera: live capture only (getUserMedia + server nonce + server time + GPS accuracy). No gallery upload.
- Every screen reads and writes through the real API with the state machine, RBAC and SoD enforced on the server.
- Escalation timers run on real time (server job). Follow-ups are scheduled real dates.
- Auditor PDF and /verify work from the real hash-chained log. A tamper test must fail verification.
- Seed only real configuration data (agencies, road-status rules, prices with their status labels), never fake cases.
- Add a Playwright golden path on the HTTPS URL that uses real accounts per role: report → route → assign → inspect/measure/PINN/cost → approve → repair evidence → supervise → citizen confirm → audit PDF → verify.
- Final: all tests green, a list of every real account/role for testing, the HTTPS URL, and a 2-minute click-by-click script for recording the demo video.
Stop and ask if anything needs a legal decision, a missing official coefficient, or a schema change outside docs/v5.
```

## Checklist sebelum lanjut ke tahap berikutnya

- [ ] Setelah Prompt 1: tampilan identik dengan screenshot simulasi_A dan simulasi_B (warna, font, Pavi, peta, efek kotak deteksi).
- [ ] Setelah Prompt 2: setiap fitur v5 terlihat di layar lama yang sesuai tabel; tidak ada istilah teknis di layar utama; /ui-check sudah dicek per peran.
- [ ] Setelah Prompt 3: tidak ada kata "demo" di mana pun; alur lengkap berjalan di HP lewat HTTPS dengan akun sungguhan per peran.
