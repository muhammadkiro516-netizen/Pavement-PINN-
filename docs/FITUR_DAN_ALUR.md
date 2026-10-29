   # PAVEMENT-PINN — Fitur, Alur per Role, dan Sistem

   Status per 29 Oktober 2026, branch `lean-real`. Dokumen ini hanya mencatat yang **sudah ada dan sudah diuji**. Bagian yang belum berfungsi ditulis terang-terangan di bagian 7.

   ---

   ## 1. Ringkasan

   PAVEMENT-PINN adalah aplikasi pelaporan dan penanganan jalan rusak:

   - **Warga** memotret jalan rusak di lokasinya. AI mengenali kerusakannya sejak kamera dibuka.
   - Laporan **otomatis diarahkan ke instansi yang berwenang** (BBPJN, Dinas Provinsi, Sudin/Dinas PUPR Kab/Kota, atau operator tol).
   - **Koordinator** instansi memeriksa, mengalihkan (disposisi), menugaskan petugas, menyetujui penanganan, dan memverifikasi perbaikan.
   - **Petugas Lapangan** menginspeksi, mengisi data lapisan jalan, dan menjalankan analisis struktur **PINN/MLET**: regangan, umur sisa, serta opsi tambal, overlay, atau rekonstruksi.
   - Setiap keputusan penting tetap diambil **manusia** (human-in-the-loop), tercatat dengan alasan, dan bisa diaudit.

   Wilayah pilot: **DKI Jakarta** dan **Kabupaten Karawang**.

   ---

   ## 2. Role dan aksesnya

   | Role | Cara masuk | Fungsi utama |
   |---|---|---|
   | **Warga (Pelapor)** | Tanpa login; akun perangkat dibuat otomatis | Melapor, memantau laporan sendiri, berkomentar, mendukung laporan, mendapat poin |
   | **Petugas Lapangan** (Field Engineer) | Email + kata sandi dari Koordinator | Inspeksi, pasang rambu, rekomendasi penanganan, kirim bukti perbaikan, workspace Analisis |
   | **Koordinator** (Operations Manager) | Email + kata sandi | Pusat Kendali, tinjau laporan, disposisi, tugaskan petugas, setujui penanganan, terbitkan SPK, verifikasi perbaikan, kelola tim, statistik |

   Akun staf per instansi pilot dibuat dengan `scripts/seed-agencies.ts`. Daftar email dan kata sandinya ada di `.data/pilot-accounts.txt`. File itu lokal dan tidak masuk git.

   | Instansi | Akun |
   |---|---|
   | BBPJN Jawa Barat – DKI Jakarta | 1 Koordinator + 1 Pengawas Lapangan |
   | Dinas Bina Marga Prov. DKI Jakarta | 1 Koordinator + 1 Pengawas Lapangan |
   | Sudin Bina Marga Jakarta Timur | 1 Koordinator + 1 Pengawas Lapangan |
   | Dinas BMPR Prov. Jawa Barat | 1 Koordinator + 1 Pengawas Lapangan |
   | Dinas PUPR Kabupaten Karawang | 1 Koordinator + 1 Pengawas Lapangan |

   Ada juga akun umum `koordinator@pavement-pinn.id` dan `petugas@pavement-pinn.id`.

   ---

   ## 3. Fitur per role dan alur penggunaannya

   ### 3.1 Warga

   **Alur melapor**

   1. Buka aplikasi. Animasi pembuka diputar sekitar 2 detik dan bisa dilewati dengan sekali ketuk.
   2. Peta meminta izin lokasi, lalu terbang ke posisi Anda. Posisi Anda ditandai **Pavi**, maskot kerucut-robot, dengan warna helm yang bisa dipilih.
   3. Tekan tombol kamera oranye **Lapor**.
   4. **Deteksi AI langsung sebelum memotret:**
      - Kamera mengirim frame kecil setiap ±400 ms.
      - Kotak sudut mengunci area kerusakan.
      - Label (Lubang, Retak, Genangan, Rusak total, Bukan jalan) disertai persentase keyakinan.
      - HP bergetar saat kerusakan terkunci.
   5. Ambil foto. Foto lalu dianalisis penuh di server:
      - kualitas foto (blur, gelap);
      - deteksi objek YOLOv8;
      - segmentasi retak;
      - klasifikasi kondisi permukaan (CLIP);
      - indeks kerusakan visual 0–100.
   6. **Laporan wajib dibuat di lokasi:**
      - Posisi GPS kamera dibandingkan dengan titik laporan.
      - Data EXIF foto dihapus demi privasi, tetapi GPS EXIF dicek lebih dulu.
   7. Kirim. Sistem menentukan instansi penanggung jawab dari lokasi (lihat bagian 4.4).

   **Peta**

   - Heatmap laporan di zoom jauh, pin foto di zoom dekat.
   - Filter: Semua · Lubang · Retak · Genangan · Ada rambu · Sudah diperbaiki.
   - Baris **"Sekitar Anda"** berisi laporan terdekat. Warna cincinnya menunjukkan status.
   - Badge pada pin hanya menampilkan fakta: ✓ sudah diperbaiki, ! rambu terpasang, ~ genangan.
   - Ketuk pin untuk membuka kartu laporan: foto, status, timeline, dan **komentar asli**.
   - Tidak ada komentar contoh atau bot.
   - Nama warga disamarkan menjadi "Warga · XXXX".
   - Satu komentar maksimal 500 karakter.

   **Laporanku**

   - Setiap laporan punya progress ala story: **Diterima → Diperiksa → Dikerjakan → Selesai**.
   - Kartu laporan menampilkan nama instansi penanggung jawab, label AI, dan tanda Genangan atau Rambu terpasang.
   - **Kartu dampak (gamifikasi profesional):**
   - **Poin Jalan Aman:** +10 per laporan yang dibenarkan petugas, +5 per laporan yang sudah diperbaiki. Laporan tidak valid tidak dapat poin, dan poin tidak pernah minus.
   - **Level:** Pengamat (0) → Pelapor (10) → Penjaga Jalan (50) → Mitra Jalan (150).
   - **Badge:** Laporan pertama · Pelapor tepercaya (5 terverifikasi) · Penjaga genangan · Saksi perbaikan.
   - Total m² jalan yang ikut diperbaiki, dihitung dari luas hasil inspeksi.
   - Poin dihitung di server dari catatan workflow (`/api/me/impact`), tidak bisa diketik atau diubah sendiri.

   **Lainnya:** Notifikasi status laporan, Profil (pilih warna helm Pavi), dan PWA yang bisa dipasang seperti aplikasi.

   ### 3.2 Koordinator

   **Pusat Kendali** (di atas Antrian). Semua angka dihitung dari riwayat nyata; data contoh tidak ikut dihitung.

   - **Skor Respons:**
   - % laporan yang ditanggapi dalam 2×24 jam, ditampilkan sebagai cincin.
   - Median waktu tanggapan dan median waktu perbaikan.
   - 2×24 jam adalah target internal, bukan batas hukum.
   - Jumlah laporan yang **belum ditanggapi**, dan berapa yang sudah lewat target.
   - Inspeksi atau pekerjaan yang **lewat tenggat**.
   - **Kerusakan berat tanpa rambu** (UU 22/2009 Ps. 24 ayat 2).
   - **Laporan terbuka per instansi**, dengan tanda "perlu dicek" untuk penentuan instansi berkeyakinan rendah.

   **Antrian (urut prioritas yang bisa dijelaskan).** Skor prioritas dibentuk dari:

   - tingkat kerusakan: hasil inspeksi lebih dulu, lalu hasil AI, lalu perkiraan pelapor;
   - jumlah dukungan warga (dibatasi);
   - lama menunggu.

   Alasan skornya ditampilkan.

   **Alur keputusan Koordinator**

   1. **Tinjau** laporan baru: terima, atau tutup sebagai tidak valid. Alasan wajib.
   2. **Disposisi** bila jalan itu bukan kewenangannya. Instansi tujuan dipilih dari daftar resmi di server, alasan wajib, dan warga melihat "dialihkan ke …".
   3. **Tugaskan inspeksi** ke petugas, dengan batas waktu dan instruksi.
   4. **Verifikasi hasil inspeksi** petugas, atau minta inspeksi ulang.
   5. **Setujui atau kembalikan** rekomendasi penanganan.
      - Orang yang merekomendasikan tidak boleh menyetujui rekomendasinya sendiri.
   6. **Terbitkan perintah kerja (SPK)**: pelaksana, pengawas, nilai pekerjaan, target selesai, catatan.
   7. **Verifikasi perbaikan**:
      - Bandingkan foto sebelum dan sesudah dengan slider.
      - Isi checklist mutu.
      - **Cek AI foto perbaikan:** AI menjalankan ulang pipeline CV pada foto sesudah. Hasilnya berupa kerusakan masih terlihat atau tidak, indeks sebelum → sesudah, dan apakah fotonya memang permukaan jalan. Ini saran saja; Koordinator yang memutuskan.
   8. **Tutup** laporan.
   9. **Pasang rambu sementara**: foto rambu dan alasan wajib. Rambu tampil di peta publik.

   **Statistik:**

   - laporan masuk, masih ditangani, sudah diperbaiki, median waktu perbaikan;
   - **kualitas AI:** % lolos otomatis, akurasi lapangan (AI dibenarkan petugas), keputusan yang berbeda dari AI, perbaikan diulang;
   - akurasi per jenis kerusakan.

   **Tim:** membuat dan menonaktifkan akun petugas atau koordinator. Akun baru otomatis masuk instansi Koordinator yang membuatnya.

   ### 3.3 Petugas Lapangan

   **Tugas:** daftar inspeksi yang ditugaskan, rekomendasi yang perlu disusun, pekerjaan yang menunggu bukti.

   **Alur petugas**

   1. Buka tugas, lalu navigasi ke lokasi.
   2. **Kirim inspeksi:**
      - kerusakan terkonfirmasi atau tidak;
      - benarkan atau koreksi kelas dari AI;
      - kedalaman (cm) dan luas (m²) terukur;
      - tingkat keparahan, catatan, foto bukti.
      - Draf tersimpan otomatis di HP.
   3. **Pasang rambu** bila kerusakan membahayakan. Hanya petugas yang ditugaskan di lokasi itu yang bisa.
   4. **Susun rekomendasi** penanganan dan urgensi. Penilaian ruas dilampirkan otomatis oleh server.
   5. **Kirim bukti perbaikan** berupa foto sesudah. Foto ini harus foto baru, tidak boleh foto laporan warga.

   **Workspace Analisis** (tab Overview · Camera Scan · 3D Damage · Structure · PINN · Validation)

   - **Overview:** status 9 tahap pipeline (T0–T8), daftar objek, permintaan foto, dan pengajuan versi.
   - **Camera Scan:** hasil deteksi AI per objek. Petugas bisa menandai salah deteksi, mengubah kelas, menyunting mask, serta menggabungkan atau memisahkan objek. Semua koreksi wajib beralasan dan tercatat.
   - **Structure:**
   - Isi data lapisan dari core, DCP, FWD, atau as-built: tebal, modulus E, Poisson untuk AC, Base, Subbase, dan Subgrade.
   - Setiap perubahan otomatis menjalankan ulang **T7 (MLET)**, dan run lama ditandai kedaluwarsa.
   - **PINN:**
   - Hasil MLET: **εt di bawah AC** (retak lelah) dan **εv di atas subgrade** (alur).
   - Peta regangan dan tegangan (εxx, εzz, σzz) dari solver.
   - **Skenario kendaraan** (motor, mobil, truk 3 sumbu, dan lainnya): dihitung per sumbu.
   - **Kartu keputusan PINN** (`/api/engine/decide`), muncul begitu lapisan lengkap:
      - preset lalu lintas dan bagian ODOL;
      - % retak buaya, tingkat keparahan, bulan basah, target umur;
      - umur sisa P10/P50/P90;
      - faktor ODOL;
      - opsi **Rutin / Overlay (tebal perkiraan) / Rekonstruksi**, disertai apakah opsi itu memenuhi target umur.
   - **Versi laporan:** petugas mengajukan versi, Koordinator menyetujui atau menolak. Petugas tidak bisa menyetujui sendiri.

   ---

   ## 4. Sistem

   ### 4.1 Arsitektur

   ```
   HP / Browser (React 19 + Vite + Tailwind, PWA)
         │  HTTPS, cookie sesi bertanda tangan
         ▼
   Server Express (TypeScript) ── penyimpanan file .data/ (workflow.json, accounts.json, analisis CV)
         │  HTTP lokal
         ▼
   Layanan AI Python (FastAPI + OpenVINO 2026.4) port 8100
      ├─ YOLOv8n RDD (deteksi kerusakan)      ├─ YOLOv8s (segmentasi retak)
      ├─ CLIP ViT-B/32 INT8 (kondisi permukaan, genangan, bukan jalan)
      ├─ MLET PyMastic (regangan multilapis)  └─ PI-surrogate (umur Monte Carlo)
         │
   OpenStreetMap (Nominatim + Overpass) untuk penentuan instansi, di-cache
   ```

   ### 4.2 Mesin AI / Computer Vision

   | Tahap | Model / metode | Keluaran |
   |---|---|---|
   | Live kamera | YOLOv8n + CLIP pada frame ≤300 KB | Kotak, label, keyakinan, peringatan kualitas (±185–300 ms per frame di CPU) |
   | Analisis foto | Kualitas → YOLOv8n → segmentasi retak YOLOv8s → CLIP | Jenis kerusakan, keparahan, peta retak, indeks kerusakan 0–100 |
   | Scene CLIP (zero-shot) | 3 kepala: jalan/bukan jalan · baik/retak/berlubang/hancur/tak beraspal · tergenang/kering | `GENANGAN`, `RUSAK_TOTAL` (indeks ≥60 dan P(hancur) ≥0,5), atau *bukan jalan* sehingga tidak lolos otomatis |
   | Cek perbaikan | Pipeline yang sama pada foto sesudah | Saran untuk Koordinator |

   Semua model berjalan di **OpenVINO**, dan CLIP sudah dikompresi ke INT8 dengan NNCF. Hasil AI hanya memberi saran dan prioritas. Laporan yang kelasnya meragukan, atau yang bukan foto jalan, tetap diperiksa manusia.

   ### 4.3 Mesin struktur (PINN / MLET / keputusan)

   Modul `inference/app/decide.py`, diuji dengan pytest:

   1. **Modulus aspal yang rusak:** koefisien lapis AASHTO 1993 Tabel 5.2, rasio E = (a/0,375)³.
   2. **Lalu lintas:** VDF pangkat empat per kelompok sumbu dengan beban standar STRT 5,4 · STRG 8,16 · SDRG 13,76 · STrRG 18,45 t; tabel kelas kendaraan Bina Marga; ESAL per hari.
   3. **Musim hujan (Miner):** N = 1 / ((1−f)/N_kering + f/N_basah), dengan f = bulan basah / 12.
   4. **ODOL:** faktor dari regangan MLET dengan tekanan ban 0,70 MPa, dibandingkan dengan pangkat empat.
   5. **Overlay:** pemindaian tebal dan verifikasi MLET 3 lapis. Hasilnya diberi label *perkiraan indikatif, bukan desain resmi*.
   6. **Rekonstruksi:** pemindaian kandidat susunan lapis.
   7. **Peringkat opsi:** Rutin / Berkala (overlay) / Rekonstruksi, beserta umur dan pemenuhan target.

   Setiap angka diberi label sumber: terukur, dari input, atau asumsi.

   ### 4.4 Penentuan instansi penanggung jawab

   - Data instansi ada di `config/authorities/pilot.json`. Dasar hukumnya UU 38/2004 jo. UU 2/2022 dan PP 34/2006.
   - Dari koordinat laporan: wilayah administrasi diambil dari Nominatim, kelas, nomor, dan operator jalan dari Overpass.
   - jalan tol → BUJT (keyakinan tinggi);
   - jalan nasional (trunk, ref nasional) → BBPJN (sedang);
   - jalan lain → Dinas Provinsi, Sudin, atau Dinas PUPR Kab/Kota (rendah).
   - Hasil di-cache, permintaan dibatasi 1 per 1,1 detik, dan ada cadangan kotak wilayah saat offline.
   - Keyakinan selalu ditampilkan, dan Koordinator bisa melakukan disposisi.

   ### 4.5 Workflow (state machine)

   ```
   NEEDS_REVIEW → VERIFIED → FIELD_INSPECTION_REQUESTED → INSPECTED → INSPECTION_VERIFIED
   → ACTION_RECOMMENDED → ACTION_APPROVED → IN_PROGRESS → RESOLVED → CLOSED
   ```

   - Aksi yang tidak mengubah status: **TRANSFER_AUTHORITY** (disposisi) dan **MARK_HAZARD** (rambu).
   - Setiap transisi punya aturan: role yang boleh, status asal, dan wajib-alasan untuk keputusan staf.
   - Setiap perubahan dicatat di audit log dengan versi (kunci optimistik), sehingga dua orang tidak bisa menimpa perubahan satu sama lain.

   ### 4.6 Keamanan dan kejujuran data

   - Sesi bertanda tangan. Rate limit dihitung per akun, bukan per IP, karena jaringan seluler Indonesia memakai CGNAT.
   - Foto dicek per byte (harus JPEG, PNG, atau WebP asli, maksimal 5 MB), dan metadata EXIF dihapus.
   - Hasil AI yang menempel di laporan diambil dari server, bukan dikirim klien. Hash foto harus cocok dengan foto yang dianalisis.
   - **Tidak ada data dummy:**
   - komentar contoh dan angka palsu sudah dihapus;
   - contoh laporan memakai foto publik asli dan diberi label **"Arsip foto publik"**;
   - statistik menampilkan "–" kalau belum ada data.

   ---

   ## 5. Cara menjalankan (lokal)

   ```bash
   # Layanan AI
   cd inference && .venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8100

   # Aplikasi (build lalu jalankan)
   MSYS_NO_PATHCONV=1 VITE_BASE_PATH=/ npx vite build
   npx esbuild server/index.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs
   MSYS_NO_PATHCONV=1 NODE_ENV=production PORT=3100 VITE_BASE_PATH=/ node dist/server.cjs
   ```

   Buka `http://localhost:3100`. Kamera dan GPS di HP butuh HTTPS atau localhost.

   **Tes:**

   - `npx tsx --test --test-concurrency=2 "tests/**/*.test.ts"` (±327 tes Node)
   - `cd inference && .venv/Scripts/python -m pytest -q` (51 tes)

   ---

   ## 6. Alur demo singkat (±5 menit)

   1. **Warga:** buka peta (Pavi + heatmap), tekan Lapor, arahkan ke foto lubang. Kotak AI terkunci sebelum dipotret. Kirim, lalu lihat instansi yang dituju dan progress di Laporanku.
   2. **Koordinator instansi tersebut:**
      - lihat Pusat Kendali (laporan baru masuk);
      - terima laporan, lalu tugaskan petugas;
      - opsional: disposisi ke instansi lain, atau pasang rambu.
   3. **Petugas:**
      - kirim inspeksi;
      - di Analisis → Structure, isi data lapis (contoh: AC 50 mm/3000 MPa, Base 200/300, Subbase 250/150, Subgrade 50 MPa);
      - di PINN, lihat regangan, skenario truk, dan opsi penanganan beserta umurnya;
      - susun rekomendasi.
   4. **Koordinator:** setujui, terbitkan SPK, lalu verifikasi foto sesudah dengan cek AI perbaikan, kemudian tutup.
   5. **Warga:** progress menjadi "Selesai" dan poin serta badge "Saksi perbaikan" bertambah.

   ---

   ## 7. Yang BELUM berfungsi

   | Bagian | Status |
   |---|---|
   | Tab **3D Damage** dan **Validation** (T1, T2, T4, T5, T6) untuk laporan asli | *Blocked*: unggah sekuens 15–30 foto untuk rekonstruksi 3D (SfM) belum disambungkan, jadi kedalaman, luas, dan volume dari 3D belum terukur |
   | **Minta foto** di workspace | Hanya tercatat di audit; belum ada notifikasi ke petugas |
   | Umur sisa di run T7 | Kosong sampai data lalu lintas diisi; kartu keputusan PINN sudah menyediakan isian lalu lintas |
   | Biaya per opsi (HSPK) | Belum dimasukkan |
   | Rencana Ruas + PDF Usulan Penanganan | Belum dibuat |
   | Bukti perangkat keras Intel | Laptop pengembangan AMD Ryzen; benchmark OpenVINO berjalan di CPU AMD, jadi itu bukti perangkat lunak OpenVINO, belum bukti performa perangkat keras Intel |
