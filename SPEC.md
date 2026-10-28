# SPEC.md — PAVEMENT-PINN v4 FINAL (sekali tembak untuk Claude Code)
> Simpan di root repo. File ini **menggantikan** AGENTS.md dan V4_SPEC.md bila berbeda. Baca SEKALI, lalu rujuk per ID.
> Basis: branch `lean-real` (React 19 + Vite + Tailwind PWA · Express TS · store `.data/` · FastAPI + OpenVINO :8100 · 327 tes Node + 51 pytest). **Bangun di atas yang ada, jangan tulis ulang.**
> Tujuan: aplikasi yang **berfungsi penuh, bisa dicoba di HP lewat HTTPS**, dan **menghasilkan bukti terukur** untuk setiap poin rubrik Intel AI Global Impact Festival 2026 Stage 3 (90 poin).

---
## 0. Aturan wajib
1. **Tanpa angka palsu.** Tidak ada `Math.random`, konstanta, atau data contoh yang tampil sebagai hasil. Belum ada data → tampilkan "–"/"belum diukur". Data contoh selalu berlabel `CONTOH`.
2. **Human-in-the-loop.** AI hanya mengusulkan. Setiap keputusan staf punya alasan wajib dan tercatat di audit log. AI tidak pernah mengubah status kasus.
3. **Setiap angka membawa label sumber:** `TERUKUR` | `DARI_INPUT` | `ASUMSI` | `AI_PERKIRAAN` | `CONTOH`, plus versi model atau tanggal/sumber harga.
4. **Bahasa netral.** Dilarang menulis "korupsi", "mark-up", "nakal", "lalai", atau nama orang. Pakai "perlu klarifikasi", "rusak lebih cepat dari perkiraan fisika", "rekomendasi uji teknis".
5. **Privasi.** EXIF dihapus. Wajah dan pelat dikaburkan sebelum foto disimpan dan sebelum dibagikan. Halaman publik tanpa data pribadi; nama perusahaan pelaksana hanya internal.
6. **Keselamatan.** Kamera lapor terkunci bila kecepatan GPS > 10 km/jam.
7. Jangan hapus atau melemahkan tes lama. Setiap fitur punya tes. `npm test` + `pytest` hijau di akhir setiap fase.
8. **Hemat token.** Grep sebelum membaca, edit kecil, jangan cetak file besar. Laporan fase ≤ 8 baris. Perbarui `PROGRESS.md` (≤ 30 baris) setiap fase.
9. **Commit yang dibantu AI** diberi trailer `Assisted-by: Claude Code` (untuk pengungkapan GenAI yang jujur, §9).

## 1. Konsep (satu benang merah)
**"Lapor · Kawal · Audit — jalan yang sama tidak boleh melukai orang dua kali."**

Masalah nyata yang dijawab (kutip di app dan pitch; simpan sumbernya di `docs/evidence/sources.md`):
- **Jakarta, Jan 2026:** Dinas Bina Marga DKI menangani hampir **6.000 lubang** akibat hujan. Gubernur menyebut semuanya **"perbaikan sementara"**, perbaikan permanen menunggu musim hujan usai (JawaPos, 31 Jan 2026). Artinya, tambalan yang diulang adalah pola yang diakui resmi, tetapi umur tambalan tidak pernah diukur.
- **Karawang, Mar 2025:** viral tambalan jalan nasional Pantura yang dipadatkan dengan **diinjak kaki**, bukan alat pemadat. Gubernur Jabar menjelaskan itu kewenangan Kementerian PU, bukan provinsi (CNN Indonesia, 27 Mar 2025). Ini bukti dua masalah sekaligus: **mutu perbaikan** dan **kebingungan kewenangan**.
- **Karawang, Feb 2025:** Dinas PUPR memperbaiki 50 titik jalan rusak (ANTARA, 21 Feb 2025).
- **Nasional:** jalan nasional tidak mantap naik dari 2.227,5 km (2024) ke 3.021,5 km (Sem. I 2025). 74% kecelakaan melibatkan roda dua (Korlantas 2024). WHO: 1,16 juta kematian lalu lintas per tahun, 92% di negara berpendapatan rendah-menengah.

Tiga lapis:
1. **Lapor:** AI mengenali kerusakan, lalu laporan dirutekan ke instansi berwenang. Ini sudah ada; diperkuat.
2. **Kawal:** laporan tidak bisa terbengkalai diam-diam. Ada jam pasir, eskalasi, alasan tertunda publik, dan kartu story 9:16.
3. **Audit:** sistem mencatat umur nyata setiap perbaikan, lalu PINN menghitung umur seharusnya. Kalkulator Kewajaran menghitung biaya wajar. **Pelacak Masa Pemeliharaan** menandai kerusakan yang masih menjadi tanggungan pelaksana.

**Lingkaran belajar (HITL):** koreksi petugas, konfirmasi warga 1-3-6 bulan, dan uji DCP/lendutan mengkalibrasi CV dan PINN.

## 2. Peran
| Peran | Inti | Baru? |
|---|---|---|
| Warga | lapor, share story, kawal, konfirmasi perbaikan, quest ringan | perluas |
| Petugas Lapangan | inspeksi, koreksi AI, **metode + material + tebal perbaikan**, uji DCP, data proyek | perluas |
| Koordinator | triase, disposisi, **alasan tertunda**, Ruas & diagnosis PINN, audit flag, SPK internal, verifikasi | perluas |
| **Pimpinan Instansi** | terima eskalasi, setujui usulan ruas, lihat rapor & flag audit | **baru** |
| Admin | katalog material/harga, wilayah/instansi, quest, moderasi | perluas |

Aturan konsistensi: setiap fitur warga harus punya pasangan tindakan staf. Fitur tanpa pasangan tidak dibuat.

## 3. Lingkup FOKUS (dikerjakan) vs TIDAK (jangan dikerjakan)
**Dikerjakan:** M1–M10 di §4.

**Tidak dikerjakan, cukup ditulis sebagai roadmap di `docs/ROADMAP.md`:**
- SfM/3D damage, workspace 9 tahap (disembunyikan dari UI);
- deteksi jembatan terlatih penuh;
- OCR papan proyek otomatis (pakai form manual + foto);
- hadiah mitra/voucher, papan peringkat publik, RAG pedoman;
- tekanan air pori, deteksi rutting dari foto.

## 4. Fitur (ID · prioritas · kriteria lulus)

### M1. Lapor + AI (perkuat yang ada) — P0
- **M1.1 Taksonomi.** `JALAN` (lubang, retak_memanjang, retak_melintang, retak_buaya, amblas_bergelombang, genangan, rusak_total) memakai pipeline YOLO + segmentasi + CLIP yang sudah ada.
- **M1.2 Triase aset lain** dengan CLIP zero-shot: `JEMBATAN`, `TROTOAR`, `DRAINASE` (termasuk tutup saluran hilang), `PERLENGKAPAN` (rambu, guardrail). Hasilnya selalu `PERLU_VERIFIKASI` (antrian manusia), label UI "AI menduga". Routing per aset di `config/authorities/pilot.json`, dapat dikonfigurasi. Metrik akurasi CLIP disimpan di `measurements/cv_clip_assets.json`.
- **M1.3 Hemat kuota.** Live scan tiap 400 ms dimatikan default. Cek kualitas jalan di perangkat; deteksi server dijalankan saat foto diambil. "Bantu bidik" opsional, tiap 1 detik.
- **M1.4 Kunci kecepatan** (§0.6).
- Lulus: tes pipeline; tidak ada keyakinan tanpa versi model.

### M2. Data perbaikan & Ruas (fondasi Audit dan PINN) — P0
- **M2.1** Saat mengirim bukti perbaikan, petugas **wajib** mengisi:
  - metode: `TAMBAL_DINGIN` (cold mix/TCM), `TAMBAL_PANAS` (hot mix), `PATCHING_DALAM` (potong-bongkar-padat), `OVERLAY`, `REKONSTRUKSI`;
  - material (dari katalog M6.1);
  - tebal (cm), luas (m²);
  - alat pemadat (`STAMPER`, `ROLLER`, `TIDAK_ADA`);
  - kategori `SEMENTARA`/`PERMANEN`;
  - nilai pekerjaan (opsional).
- **M2.2 Halaman Ruas** (segmen OSM): laporan + riwayat perbaikan pada garis waktu, kepadatan retak buaya, dan **umur perbaikan nyata** (RESOLVED → laporan baru ≤ 10 m atau konfirmasi "berlubang lagi").
  - Statistik ruas: median umur tambalan per metode, % berulang < 3 bulan.
  - Ringkasan lintas ruas: "**X dari Y perbaikan berulang dalam Z bulan**" = metrik bukti masalah lokal.
- **M2.3 Konfirmasi 1-3-6 bulan.** Setelah RESOLVED, pelapor dan warga radius 300 m diminta menjawab: masih baik / berlubang lagi (+foto opsional). Job terjadwal dites dengan fake timers.
- **M2.4 Pelacak Masa Pemeliharaan.** Bila data proyek/SPK memuat tanggal selesai dan masa pemeliharaan (isian; default kosong, petunjuk "sesuai kontrak"), lalu kerusakan muncul lagi di dalam masa itu → flag internal **"Masih dalam masa pemeliharaan, minta pelaksana memperbaiki"**. Netral, tanpa nama di publik.
- Lulus: umur perbaikan dihitung dari peristiwa nyata; tes per metode.

### M3. Kawal (anti laporan terbengkalai) — P0
- **M3.1 Jam pasir** di setiap laporan: "Menunggu N hari" (target internal dapat disunting admin).
- **M3.2 Tangga eskalasi** (job):
  - H+2 → pengingat Koordinator;
  - H+7 → **Pimpinan**;
  - H+14 → label publik "Belum ditangani > 14 hari" + ajakan share;
  - H+30 → warga dapat mengunduh **Draf Surat Pengaduan** (teks + PDF untuk SP4N-LAPOR!/kanal resmi; tidak dikirim otomatis).
- **M3.3 Alasan tertunda** (Koordinator): kode menunggu_anggaran / jadwal / cuaca_musim_hujan / kewenangan_lain / lainnya + perkiraan tanggal. Tampil publik, menghentikan eskalasi sampai tanggal itu. Contoh nyata DKI: "permanen setelah musim hujan".
- **M3.4** "Saya juga melihat ini": 1 per perangkat, foto opsional (menambah konfirmasi independen).
- **M3.5 Rapor Instansi** (internal + publik bila n ≥ 10):
  - % ditanggapi ≤ 2×24 jam;
  - median waktu perbaikan;
  - % > 14 hari;
  - **% perbaikan bertahan ≥ 3/6 bulan**;
  - % perbaikan sementara yang sudah dipermanenkan.

  Label: "metrik operasional, bukan penilaian resmi".
- Lulus: tes eskalasi + tes penghentian oleh alasan tertunda.

### M4. Kartu Story 9:16 + halaman publik — P0
- **M4.1** Ukuran 1080×1920, dibuat di klien (`html-to-image`/canvas). Isi kartu:
  - foto **kabur** + kotak/mask AI;
  - chip jenis/keparahan;
  - alamat;
  - instansi;
  - status + "Hari ke-N";
  - QR + short link `/r/:code`;
  - avatar Pavi (opsional);
  - catatan "Dianalisis AI · diverifikasi petugas" (sesuai status).

  Template: **Laporan Baru**, **Belum Ditangani (hari ke-N)**, **Sudah Diperbaiki (sebelum/sesudah)**, **Siaga Hujan**, **Kartu Dampakku**.
- **M4.2** Share lewat `navigator.canShare({files})` → `navigator.share({files,text,url})` (WA, Instagram Story, dll lewat lembar share OS). Fallback: unduh PNG + salin caption.
- **M4.3** Caption: templat per kondisi × 3 nada (Informatif / Mendesak-sopan / Apresiasi) + hashtag lokal, wajib lolos checker kata terlarang (§0.4).
- **M4.4** Halaman publik `/r/:code`: foto kabur, timeline, instansi, alasan tertunda, jumlah pengawal, tombol "Saya juga melihat ini", meta Open Graph + gambar OG, penghitung kunjungan unik.

### M5. PINN (inti ilmiah, dua jaringan nyata) — P0
- **M5.1 PINN-2 Diagnosis Ruas** (surrogate berbasis fisika; perluas `/api/engine/decide` + Monte Carlo yang ada):
  1. Fisika masuk lewat input/target tanpa dimensi: hukum kesebangunan elastis pasti + regangan selalu positif.
  2. Loss monotonisitas dihitung dengan autograd di titik kolokasi. Hanya arah yang lolos cek perturbasi PyMastic 100%.
  3. Pengaman: di luar domain atau selisih uji silang > 10% → pakai PyMastic.
  4. **Inferensi probabilistik:** 2.000 sampel struktur. Prior = data proyek (M6) atau struktur khas kelas jalan berlabel ASUMSI. Bobot sampel = kecocokan dengan observasi (ada/tidak retak buaya, umur sejak overlay, umur tambalan nyata per metode, bulan basah). Keluaran: posterior umur sisa P10/P50/P90.
  5. Keluaran untuk awam: 🔴 Perlu lapis ulang / 🟡 Pantau / 🟢 Tambal cukup, keyakinan rendah/sedang/tinggi, faktor dominan (lelah aspal / tanah dasar basah / beban berlebih), "tambalan berikutnya diperkirakan bertahan ±a–b bulan", dan alasan dalam bahasa awam.
  6. Koordinator **setuju/timpa beralasan** → tersimpan untuk kalibrasi.
- **M5.2 PINN-1 Medan** (PyTorch):
  - jaringan u(r,z), w(r,z) aksisimetris, sub-network per lapisan, variabel tanpa dimensi;
  - loss = residu Navier (2 persamaan aksisimetris) + syarat batas (tekanan ban r ≤ a dengan transisi halus, geser permukaan 0, kontinuitas u, w, σzz, τrz antar lapisan, meluruh di batas domain) + data loss PyMastic;
  - mode invers: modulus lapisan sebagai parameter terlatih yang dicocokkan dengan cekungan lendutan (Benkelman/FWD) bila ada; demo dengan cekungan sintetis berlabel CONTOH;
  - evaluasi: error L2 relatif vs PyMastic, peta residu, ablasi tanpa physics loss → `measurements/pinn1_*.json`;
  - visual di Ruas: penampang regangan PINN-1 berdampingan dengan PyMastic.
- **M5.3 "Uji di sini"** (P1): pilih titik uji DCP yang paling mengurangi varians posterior. Input DCP → CBR (rumus disitasi, label ASUMSI) → diagnosis diperbarui langsung.
- Lulus: PINN-1 error < 10% vs PyMastic pada struktur pilot; diagnosis deterministik; P10 ≤ P50 ≤ P90.

### M6. Audit Kewajaran — P0
- **M6.1 Katalog** `config/materials.json` (admin dapat menyunting; setiap baris punya sumber + tanggal + label):
  - **Pengikat:** aspal keras Pen 60/70, aspal modifikasi polimer (PG70/76), Asbuton (BGA/LGA), aspal emulsi (CRS/CSS), aspal cair (MC/RC), cold mix kemasan/TCM, CPHMA.
  - **Campuran:** AC-WC, AC-BC, AC-Base, HRS-WC/Base, SMA, Latasir, Lapen, Burtu/Burda, slurry/micro surfacing.
  - **Field:**
    - tebal minimum (default dari Spesifikasi Umum Bina Marga, VERIFIKASI: AC-WC 4, AC-BC 6, AC-Base 7,5, HRS-WC 3 cm);
    - berat isi (±2,3 t/m³, ASUMSI);
    - modulus tipikal (ASUMSI, cocokkan dengan MDP 2017);
    - umur rencana tipikal;
    - kecocokan (truk berat, genangan, darurat).
- **M6.2 Harga** `config/prices/<wilayah>.json`. Nilai awal berlabel ASUMSI + sumber + tanggal, diganti admin dengan HSPK/SSH daerah atau AHSP Permen PUPR 1/2022:
  - aspal curah Pertamina Rp11.565/kg (Cilacap, Apr 2026, TimesIndonesia);
  - aspal drum Rp13.600/kg;
  - AC-WC terhampar ±Rp1.850.000/ton;
  - AC-WC 4 cm ±Rp215.000/m² (harga vendor, Okt 2026, indikatif).
- **M6.3 Kalkulator Kewajaran:**
  - volume = luas × tebal → tonase × berat isi → biaya = tonase × harga + lapis perekat + faktor pekerjaan (ASUMSI);
  - bandingkan dengan nilai SPK/kontrak → selisih %;
  - |selisih| > ambang (±20%, dapat disunting) → flag "Perlu klarifikasi biaya".
  - Konteks: studi lapangan menemukan harga kontrak AC-WC ±21% di atas analisis lapangan (Jurnal Yudharta).
- **M6.4 Umur Seharusnya vs Nyata:**
  - PINN-2 menghitung umur seharusnya untuk metode/material/tebal/lalu lintas/kondisi basah tersebut (P10–P90);
  - umur nyata dari M2;
  - umur nyata < P10 → flag "Rusak lebih cepat dari perkiraan fisika" + penyebab yang mungkin (beban berlebih / drainase / tebal di bawah spesifikasi / pemadatan tidak memadai / input salah) + rekomendasi uji (core tebal, DCP, cek drainase);
  - kartu awam: garis waktu "seharusnya ±X" vs "nyata Y".
- **M6.5 Alur audit HITL:** flag → Koordinator wajib menanggapi (jelaskan / jadwalkan uji / tolak beralasan) → Pimpinan melihat ringkasan. Hasil core/DCP dapat diinput dan memperbarui flag. Publik hanya melihat "Sedang dalam pemeriksaan teknis".
- **M6.6 Data proyek** (form manual + foto papan proyek; tanpa OCR otomatis): nama kegiatan, ruas, tahun, campuran, tebal, panjang/luas, nilai, masa pemeliharaan, sumber (papan proyek / SIRUP-LPSE / Dinas). Petugas/Koordinator memverifikasi.

### M7. Usulan Penanganan Ruas — SLM lokal di NPU — P0 (wajib untuk poin Intel)
- Draf dari Ruas + Audit: kondisi, diagnosis PINN, opsi + biaya kewajaran, rekomendasi uji, lampiran foto.
- OpenVINO GenAI `LLMPipeline` (Qwen2.5-1.5B-Instruct INT4 via `optimum-cli export openvino --weight-format int4`, atau model kecil lain yang tervalidasi NPU di versi terpasang).
- SLM hanya menerima fakta kualitatif + placeholder; angka diisi kode; checker wajib lolos (gagal 2× → templat).
- Perangkat: `NPU → GPU → CPU` (catat di dokumen). Ekspor PDF dengan penafian "draf". Pimpinan/Koordinator menyetujui.
- Juga dipakai untuk variasi caption M4.3 (lolos checker).

### M8. Gamifikasi ringan + avatar — P1
- XP hanya dari peristiwa terverifikasi server. Batas 100 XP/hari, tidak pernah minus. Trust score tersembunyi.
- Quest (`config/quests.json`):
  - Laporan Pertama (20)
  - Mata Elang, 5 terverifikasi (50)
  - Saksi Perbaikan (15)
  - **Penjaga Janji**, konfirmasi 3/6 bulan (25)
  - Pengawal Story, share 1×/hari (5)
  - Suara Bergaung, ≥ 20 kunjungan unik (30)
  - Siaga Hujan, 3 genangan Nov–Mar (40)
  - Pencatat Proyek, data proyek terverifikasi (40)
- Hadiah:
  - item avatar per level/quest;
  - badge;
  - **e-Sertifikat "Relawan Pengawal Jalan"** ber-QR verifikasi (level 4);
  - Hall of Impact (m² diperbaiki).
- Avatar Pavi: builder SVG berlapis (helm, rompi, ekspresi, aksesori, latar), **opsional** (tombol Lewati), default acak dari id perangkat.

### M9. UI/UX v4 — P0 (kerangka) / P1 (poles)
- Navigasi warga: **Peta · Lapor (FAB) · Kawal · Profil**. Staf: menu per peran + **Pimpinan**.
- Motion (`motion`): shared-element pin → kartu, bottom sheet, animasi "AI memindai", konfeti saat terverifikasi/naik level, count-up angka, pin berdenyut sesuai urgensi, garis waktu "seharusnya vs nyata" beranimasi, penampang regangan dari data nyata.
- Halaman **Radar Bahaya** sederhana (getar/suara ≤ 150 m dari bahaya terverifikasi; bobot naik saat genangan/malam/tanpa rambu).
- Hormati `prefers-reduced-motion`. LCP < 2,5 s di HP menengah; bundle per rute < 250 KB gz. Kontras AA, target sentuh ≥ 44 px, mode gelap/terang, empty state berilustrasi Pavi.
- Onboarding 3 layar (bisa dilewati). Sembunyikan tab 3D/Validation dan T0–T8 (ringkas menjadi: Konfirmasi → Ruas → Usulan).

### M10. Halaman Bukti + harness evaluasi — P0
Halaman Bukti hanya membaca `measurements/*.json`. Skrip `bench/` dan `eval/`:

| Bukti | Skrip | Keluaran |
|---|---|---|
| CV jalan pada set uji lokal (≥ 100 foto; folder `eval/local_test/` diisi tim) + RDD2022 subset | `eval/cv_eval.py` | mAP@0,5, per kelas, FP32 vs INT8 |
| CLIP aset (≥ 20 foto/aset) | `eval/clip_eval.py` | akurasi, confusion |
| Akurasi lapangan (AI dibenarkan petugas) | sudah ada di Statistik → ekspor | `measurements/field_accuracy.json` |
| PINN-1 vs PyMastic | `eval/pinn1_eval.py` | L2 error, residu, ablasi |
| PINN-2 | `eval/pinn2_eval.py` | MAPE, p95, OOD, uji kesebangunan |
| SLM | `eval/slm_eval.py` (50 kasus) | % lolos checker, token/s, TTFT |
| Latensi per perangkat | `bench/run_all.py` | p50/p95/p99, throughput, `available_devices`, nama perangkat, versi OpenVINO |
| Pengguna | **SUS 10 butir** in-app (muncul setelah penggunaan ke-3, opsional) + analitik pilot | `measurements/sus.json`, `measurements/pilot.json` (laporan nyata, perangkat unik, terverifikasi, umur perbaikan) |
| Masalah lokal | dari M2.2 | `measurements/recurrence.json` |

Setiap file mencatat tanggal, commit, perangkat. Hasil dari CPU non-Intel diberi label `HOST_NON_INTEL`.

## 5. Rencana Intel (setiap parameter Metrik 3 punya bukti)
| Parameter rubrik | Yang dibangun | Bukti |
|---|---|---|
| Sumber daya Intel di seluruh siklus (3) | lihat baris-baris di bawah | `docs/INTEL_LIFECYCLE.md` (tabel tahap → tool → perangkat → file bukti) |
| Alasan pemilihan (4) | dokumen alasan: satu runtime CPU/iGPU/NPU, NNCF untuk akurasi terkendali, GenAI lokal di NPU (data tidak keluar perangkat, offline), AMX Xeon untuk server | `docs/INTEL_RATIONALE.md` + benchmark PyTorch vs OpenVINO |
| HW manfaat/vital (3) | Monte Carlo PINN real time + SLM offline di NPU | waktu MC per ruas, token/s NPU |
| Jenis HW (3) | umum: CPU Core Ultra, Arc iGPU, **Xeon**; khusus AI: **NPU** (Core Ultra) + **Intel AMX** (Xeon gen-4+) | `bench/run_all.py` mencatat perangkat + flag `amx_tile` dari `lscpu` |
| Cakupan HW (4) | data PyMastic di CPU Intel → latih PINN di Xeon (AMX bf16) atau iGPU (XPU) → evaluasi CPU/GPU/NPU → deploy Xeon + lapangan Core Ultra | log per tahap |
| SW manfaat/vital (3) | OpenVINO (YOLO, seg, CLIP, PINN-2), NNCF, OpenVINO GenAI | tabel akurasi/latensi |
| Jenis SW (3) | OpenVINO 2026, NNCF, OpenVINO GenAI, Optimum Intel, **Intel Extension for Scikit-learn** (linear probe CLIP + analitik), PyTorch XPU/AMX | `requirements.txt` + kode |
| Cakupan SW (4) | dipakai di eksplorasi, pelatihan, optimasi, evaluasi, deployment; OpenVINO GenAI untuk GenAI | `docs/INTEL_LIFECYCLE.md` |
| IDR (3) | AI Global Impact Festival tercantum sebagai program Intel Digital Readiness; materi Intel yang diikuti | `docs/evidence/intel_program.md` (diisi tim) |

**Akses hardware (diisi manusia; agent menyiapkan skrip):**
- **A.** Intel AI PC Cloud (Core Ultra Series 2/3 dengan NPU), daftar dengan **email universitas**. Agent menyiapkan `bench/remote_setup.sh` (instal + jalankan `bench/run_all.py` + salin hasil).
- **B.** Pinjam laptop Core Ultra.
- **C.** VM Xeon gen-4+ (AMX) untuk server dan pelatihan: Intel Tiber AI Cloud atau VM cloud ber-Sapphire Rapids. Verifikasi `lscpu | grep amx`.

Server produksi (M11) di VM Intel Xeon menjadi bukti deployment.

## 6. Hosting — wajib
- **F0:** jalankan lokal + `cloudflared tunnel --url http://localhost:3100` → URL HTTPS dicetak ke pengguna. Ulangi setiap akhir fase.
- **Tetap:**
  - `Dockerfile` (node), `inference/Dockerfile` (python+openvino), `docker-compose.yml`, `Caddyfile` (HTTPS otomatis), `.env.example`, `scripts/deploy.sh`;
  - volume `.data/` + backup harian;
  - target: VM Linux **Intel Xeon** ≥ 4 vCPU/8 GB.
  - **Minta akses VM/domain ke pengguna; jangan membuat akun.**
- Uji akhir: kamera, GPS, share, PWA install di Android Chrome dan iOS Safari via HTTPS.

## 7. Tugas yang HANYA bisa dikerjakan manusia (agent menyiapkan alat/formulirnya)
1. Daftar Intel AI PC Cloud / pinjam laptop Core Ultra / sediakan VM Xeon.
2. Ambil ≥ 100 foto lokal (30% basah/malam) + label via halaman koreksi petugas; ≥ 20 foto per aset non-jalan.
3. Isi data proyek 1–2 ruas pilot (papan proyek / SIRUP-LPSE / tanya Dinas) lewat form M6.6.
4. Wawancara 1–2 petugas/Dinas. Agent menyiapkan `docs/evidence/interview_guide.md` (10 pertanyaan: tambalan berulang, data lapisan, masa pemeliharaan, cara prioritas) dan form transkrip.
5. Rekrut 10+ warga untuk mencoba (SUS) dan 2–3 insinyur/dosen untuk peringkat buta 15 titik (form `eval/blind_rank`).
6. Isi `docs/evidence/intel_program.md` dan lembar pengungkapan GenAI dengan jujur.

## 8. Fase (berurutan; setiap fase: rencana ≤ 15 baris → kode → tes → PROGRESS.md → commit → URL tunnel)
| Fase | Isi |
|---|---|
| F0 | rencana ringkas, tunnel HTTPS, PROGRESS.md, sembunyikan 3D/Validation/T0–T8 |
| F1 | M2 data perbaikan + Ruas + konfirmasi + masa pemeliharaan; metrik recurrence |
| F2 | M3 Kawal + peran Pimpinan |
| F3 | M5.1 PINN-2 diagnosis probabilistik + M6 Audit (katalog, harga, kalkulator, seharusnya vs nyata, alur HITL, data proyek) |
| F4 | M5.2 PINN-1 medan + invers + eval |
| F5 | M4 kartu story + halaman publik + OG |
| F6 | M7 SLM Usulan di NPU + caption |
| F7 | M10 harness evaluasi + Halaman Bukti + SUS + analitik pilot + `bench/run_all.py` + `remote_setup.sh` + dokumen Intel §5 |
| F8 | M9 UI/UX v4 + Radar + M1.2/M1.3/M1.4 + M8 gamifikasi & avatar |
| F9 | hosting tetap (§6), `docs/GENAI_DISCLOSURE.md` dari trailer commit, `docs/CORE_EXPLAINED.md` (penjelasan sederhana tiap modul inti agar setiap anggota tim dapat menjelaskannya), ROADMAP.md, perapihan |

Bila limit/waktu menipis: prioritaskan F0–F3 + F6 + F7 + hosting. **Sebelum berhenti, pastikan build jalan, URL HTTPS hidup, dan PROGRESS.md berisi langkah berikutnya.**

## 9. Pengungkapan GenAI (jujur)
- `docs/GENAI_DISCLOSURE.md` dibuat otomatis: daftar alat (Claude/Claude Code, alat lain yang dipakai tim), persentase commit ber-trailer `Assisted-by`, modul yang ditulis/ditinjau manusia.
- `docs/CORE_EXPLAINED.md` berisi untuk setiap modul inti (PINN-1, PINN-2, kalkulator, eskalasi, skor prioritas): input, rumus, alasan, batasan dalam bahasa sederhana, plus 3 pertanyaan juri dan jawabannya.

## 10. Definition of Done
- [ ] Dari HP via HTTPS: lapor → AI → instansi → kartu story terbagi ke WA/IG.
- [ ] Laporan > 14 hari: eskalasi ke Pimpinan + alasan tertunda tampil publik.
- [ ] Ruas: umur perbaikan nyata per metode + "X dari Y berulang dalam Z bulan".
- [ ] PINN-2: diagnosis 🔴🟡🟢 + P10–P90 + timpa beralasan. PINN-1: error vs PyMastic + residu tampil di Bukti.
- [ ] Audit: seharusnya vs nyata + kalkulator kewajaran bersumber harga + flag masa pemeliharaan + alur tanggapan.
- [ ] SLM Usulan berjalan (NPU bila tersedia, perangkat tercatat).
- [ ] Halaman Bukti terisi dari `measurements/*.json`; dokumen Intel §5 lengkap.
- [ ] Semua tes hijau; tidak ada angka tanpa sumber; GENAI_DISCLOSURE.md + CORE_EXPLAINED.md ada.
