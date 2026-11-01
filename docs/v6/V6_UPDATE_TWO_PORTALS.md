# PAVEMENT-PINN v6: Dua Portal, Satu Instansi Satu Workspace, AI yang Terlihat Bekerja

> **Untuk Claude Code.** Taruh di repo sebagai `docs/v6/V6_UPDATE_TWO_PORTALS.md`. File ini **menggantikan model 9 peran** di docs/v5 untuk struktur peran dan navigasi. Semua aturan lain di docs/v5 tetap berlaku: kejujuran angka, pemisahan tugas, rantai audit, bahasa netral, dan tanpa kop pemerintah.
> **Gaya visual:** tetap memakai UI asli yang sudah dipulihkan (gelap, aksen kuning-oranye, Pavi, efek deteksi, kartu melayang). Desainnya **disempurnakan, bukan diganti**.

---

## 0. Ringkasan perubahan

| Sebelum (v5) | Sesudah (v6) |
|---|---|
| 9 peran, masing-masing punya layar dan login sendiri | **2 portal:** (1) **Portal Warga** dan (2) **Workspace Instansi** |
| Staf login dengan akun masing-masing | Staf masuk dengan **kode akses pribadi atau QR** yang diterbitkan Operations Manager instansinya |
| Peran tersebar | **1 instansi = 1 dashboard**. Semua staf instansi bekerja di dashboard yang sama; menu dan tombol yang terlihat ditentukan oleh perannya |
| AI ada, tapi kurang terlihat manfaatnya | **12 fitur AI yang terlihat**, masing-masing menunjukkan apa yang dihemat atau dicegah, dan tetap diputuskan manusia |
| Biaya hanya untuk aspal | **Katalog material lengkap:** aspal (beberapa jenis), beton semen/rigid, cold mix, paving. **Harga per wilayah**, dan perbandingan **biaya per tahun umur layanan** |

---

## 1. Portal 1: Warga (tanpa login)

**Tujuan:** melapor dalam waktu kurang dari 60 detik, dan tahu siapa yang menangani laporannya.

### Layar
1. **Beranda.** Tombol besar "Laporkan jalan rusak", peta sekitar dengan laporan lain, dan "Laporanku" (disimpan di perangkat).
2. **Lapor (3 langkah).**
   1. Pilih *Lubang/titik* atau *Kerusakan panjang*.
   2. Kamera langsung dengan kotak AI.
   3. Kirim.
3. **Terkirim.** Kode lacak, ditambah kartu **"Ditangani oleh: Suku Dinas Bina Marga Jakarta Timur"**: ikon kantor, alamat, dan alasannya ("Jl. X berstatus jalan provinsi, wilayah Kota Jakarta Timur").
4. **Lacak.** Linimasa publik: diterima → dicek petugas → disetujui → diperbaiki → dipantau. Juga hitungan "menunggu N hari", alasan penundaan resmi, dan eskalasi.
5. **Notifikasi.** "Petugas menuju lokasi", "Jalanmu sudah diperbaiki", dan "Apakah perbaikannya masih bagus?" pada 1/3/6 bulan.
6. **Kontribusi (opsional).** Misi, lencana, dan sertifikat. Nama hanya diminta saat klaim sertifikat.

### Routing otomatis (wajib)
- Begitu laporan dikirim, server menempelkan titik GPS ke segmen jalan terdekat, lalu menentukan statusnya (nasional/provinsi/kab-kota/desa/tol), lalu **wilayah yurisdiksi**, lalu **workspace instansi** yang terdaftar untuk wilayah dan status itu. Laporan **langsung muncul di Inbox instansi tersebut**, tanpa operator di tengah.
- **Kalau instansinya belum memakai PAVEMENT-PINN:** laporan tetap publik di peta, warga melihat "Instansi penanggung jawab: [nama], belum terhubung", dan disediakan draf aduan siap kirim ke SP4N-LAPOR!. Kasusnya tetap dihitung di rapor publik.
- **Keyakinan RENDAH** (jalan tak dikenal, perbatasan wilayah): kasus masuk ke Inbox instansi kandidat dengan label "Konfirmasi kepemilikan". OM mengonfirmasi atau mengalihkan, dengan SK wajib disebut.
- **Pengalihan antar-instansi:** kasus pindah workspace; riwayat dan bukti ikut, dan tercatat di rantai audit.

---

## 2. Portal 2: Workspace Instansi

### 2.1 Konsep tenant
- **Satu instansi pemilik jalan = satu workspace**, dengan nama, logo instansi (diunggah instansi sendiri; aplikasi tidak membuat lambang), wilayah yurisdiksi, dan daftar ruas/status yang ditanganinya.
  - Contoh: *Suku Dinas Bina Marga Jakarta Timur*, *Dinas PUPR Kab. Karawang*, *BBPJN DKI Jakarta–Jawa Barat*, *Jasa Marga (ruas tol X)*.
- Workspace dibuat oleh admin platform (tim PAVEMENT-PINN) **satu kali**. Setelah itu semuanya diurus Operations Manager instansi.

### 2.2 Masuk dengan kode atau QR (tanpa username/password)
- **Penerbitan:** OM menambah staf (nama, jabatan, peran), dan sistem menerbitkan:
  - **Kode akses pribadi** 10 karakter, mudah dibaca. Contoh: `JT7-K4P-9QX`; huruf yang membingungkan (0/O, 1/I) tidak dipakai.
  - **QR badge** yang bisa dicetak atau disimpan di HP, berisi token yang sama.
  - **PIN 6 digit** yang dibuat staf sendiri saat pertama kali masuk.
- **Masuk:** pilih "Masuk Instansi" → scan QR atau ketik kode → masukkan PIN → masuk ke workspace dengan menu sesuai perannya. Perangkat bisa diingat (sesi 12 jam, bisa diatur OM).
- **Aksi sensitif minta PIN ulang:** menyetujui rencana/anggaran, menutup kasus, menerbitkan laporan audit, mengubah harga, dan mengelola kode.
- **Keamanan:**
  - Kode dan PIN disimpan sebagai hash; ada batas percobaan dan kunci sementara.
  - Setiap masuk dan aksi tercatat (siapa, kapan, dari perangkat apa).
  - OM bisa mencabut atau memperbarui kode kapan saja.
  - Satu kode untuk satu orang; akun bersama tidak dipakai.
  - **Kode tamu kontraktor** hanya berlaku untuk perintah kerja tertentu dan kedaluwarsa otomatis setelah kasus diverifikasi.

### 2.3 Peran di dalam workspace (disederhanakan dari 9 menjadi 3 + 1 tamu)

| Peran v6 | Padanan nyata | Gabungan dari peran v5 | Inti tugas |
|---|---|---|---|
| **Operations Manager (OM)** | Kepala Seksi Pemeliharaan / Kasudin / Kepala UPTD / PPK | Coordinator + Approver + Agency Head + Region Admin | Triase, menugaskan, **menyetujui** rencana dan anggaran, alasan penundaan publik, mengelola staf, kode, dan buku harga |
| **Field Engineer (FE)** | Petugas inspeksi / pengawas lapangan / Satpel | Field Inspector + Works Supervisor | Inspeksi, ukur, PINN, usulan perbaikan dan biaya; setelah perbaikan, **memverifikasi** hasil kontraktor |
| **Auditor** | Inspektorat/APIP, atau auditor internal instansi | Auditor | Hanya baca: rantai bukti, anomali biaya, rapor, ekspor laporan audit |
| **Contractor (kode tamu)** | Penyedia jasa / regu swakelola | Repair Crew | Hanya melihat perintah kerjanya sendiri; mengunggah bukti sebelum/saat/sesudah |

**Pemisahan tugas tetap dipaksa server:**
- FE yang mengusulkan tidak boleh menyetujui. Yang menyetujui harus OM lain atau OM yang bukan pengusul. Kalau instansi kecil hanya punya satu OM yang juga pengusul, persetujuan butuh OM kedua atau tercatat sebagai pengecualian yang terlihat auditor.
- FE yang memverifikasi perbaikan **tidak boleh** FE yang sama dengan pengusul, kalau di instansi ada lebih dari satu FE. Kalau hanya satu, tercatat sebagai pengecualian.
- Kontraktor tidak pernah bisa menutup kasus.
- Auditor tidak bisa mengubah apa pun.

### 2.4 Navigasi workspace (UI asli yang dirapikan)
- **Desktop:** sidebar kiri dengan ikon dan label. **HP:** tab bawah dengan maksimal 5 ikon.
- **Top bar:** logo dan nama instansi, badge peran (warna per peran), indikator "Sesi aman" + tombol Kunci (kembali ke PIN), dan pencarian kode kasus.

| Modul | OM | FE | Auditor | Kontraktor |
|---|---|---|---|---|
| **Hari Ini** (ringkasan + briefing AI) | ✓ | ✓ (tugasku) | ✓ (temuan) | ✓ (perintah kerjaku) |
| **Inbox & Peta** (kasus masuk) | ✓ semua | ✓ yang ditugaskan + sekitar | ✓ baca | ✗ |
| **Kasus** (detail + linimasa) | ✓ | ✓ | ✓ baca | hanya kasus miliknya |
| **Lapangan** (mode inspeksi HP) | ✗ | ✓ | ✗ | ✗ |
| **Perintah Kerja** (SPK/WO) | ✓ buat & setujui | ✓ usul & verifikasi | ✓ baca | ✓ kerjakan & unggah bukti |
| **Biaya & Material** | ✓ ubah buku harga | ✓ hitung | ✓ baca + anomali | ✗ |
| **Pantau** (tindak lanjut 1/3/6 bln, garansi) | ✓ | ✓ | ✓ | ✗ |
| **Rapor & Peringkat** | ✓ | ✓ (milik sendiri) | ✓ | ✗ |
| **Audit** (rantai bukti, ekspor, temuan) | ✓ baca | ✗ | ✓ | ✗ |
| **Tim & Kode** | ✓ | ✗ | ✓ baca log | ✗ |
| **Pengaturan** (yurisdiksi, SLA, buku harga) | ✓ | ✗ | ✓ baca | ✗ |

### 2.5 Isi tiap modul

**Hari Ini (beranda workspace)**
- 4 angka besar: *Kasus baru*, *Lewat tenggat*, *Sedang diperbaiki*, *Gagal dalam masa pemeliharaan*.
- **Briefing AI** (3–5 kalimat dari GenAI lokal, angka dari kode). Contoh: "Ada 6 kasus baru, 2 di dekat sekolah. Besok diprediksi hujan lebat di Jatinegara; 4 lubang berisiko tergenang. 1 perbaikan di Jl. X rusak lagi dalam 40 hari."
- Daftar "Perlu tindakan kamu" sesuai peran.

**Inbox & Peta**
- Peta wilayah instansi dengan batas yurisdiksi, laporan sebagai pin berwarna keparahan, dan cluster duplikat ("12 warga melaporkan lubang ini").
- Daftar berurut **Skor Prioritas AI** dengan alasan dalam bahasa biasa. Contoh: "Lubang dalam · jalan ramai motor · dekat SD · hujan besok · sudah menunggu 5 hari".
- Aksi OM: tugaskan FE, gabungkan duplikat, alihkan instansi (wajib SK), tolak dengan alasan (foto bukan jalan, sudah diperbaiki).

**Kasus (detail)**
- Header: kode, alamat, status jalan, keparahan, umur kasus, dan SLA.
- Kartu **"Ringkasan AI"**: jenis, ukuran perkiraan, kepercayaan foto, risiko, dan saran langkah berikutnya.
- Linimasa lengkap (setiap peristiwa punya ikon gembok rantai bukti), foto, dan diskusi internal.

**Lapangan (FE, HP)**
- Tugasku (rute urut dengan peta) → Inspeksi 3 sisi → Ukur (kartu penanda + penggaris) → Analisis PINN → **Bandingkan opsi perbaikan** → Usulkan.
- Mode offline: antrian unggah ketika sinyal hilang.

**Perintah Kerja**
- Dari usulan FE: OM menyetujui (PIN), lalu memilih pelaksana (swakelola atau kontraktor). Kode tamu terbit otomatis.
- Status: Disetujui → Dikerjakan → Bukti masuk → Diverifikasi FE → Dipantau.

**Biaya & Material**: lihat bagian 4.

**Pantau**
- Kalender tindak lanjut: 1 bulan, setelah hujan lebat pertama (dari prakiraan Open-Meteo), 3 bulan, 6 bulan/akhir masa pemeliharaan.
- Konfirmasi warga dan FE. Gagal di dalam masa pemeliharaan → **Tanda garansi** ke kontraktor.

**Rapor & Peringkat**
- **Rapor instansi:** waktu respons median, % ditindaklanjuti ≤ SLA, % perbaikan masih bagus di 3 dan 6 bulan, kasus lewat tenggat, dan biaya rata-rata per m² dibanding acuan wilayah.
- **Peringkat internal:** per unit/kecamatan (Satpel) dan per pelaksana/kontraktor, berdasarkan **ketahanan perbaikan**, bukan kecepatan saja.
- **Peringkat publik antar-instansi** (opsional, di portal warga): hanya metrik layanan, tanpa nama orang.

**Audit (Auditor)**
- Status rantai bukti (utuh/rusak) dan daftar **anomali** dari AI (bagian 3).
- Ekspor dua dokumen (lihat docs/v5/07): Laporan Audit Perbaikan Independen dan Draf untuk instansi.
- Filter: kasus dengan selisih biaya >20%, gagal dalam masa pemeliharaan, foto ditandai AI, atau pengecualian pemisahan tugas.

**Tim & Kode (OM)**
- Daftar staf, peran, status kode, dan terakhir aktif. Tombol: tambah, cetak QR badge, cabut, perbarui.
- Log masuk per perangkat.

---

## 3. AI yang dimaksimalkan (12 fitur yang terlihat bekerja)

Setiap fitur menampilkan tiga hal:
- **Apa yang AI lakukan**, dalam satu kalimat bahasa biasa.
- **Manfaatnya**: waktu dihemat, risiko dicegah, atau uang dijaga.
- **Siapa yang memutuskan**: manusia.

Pop-up kecil "Bagaimana AI tahu?" membuka detail teknis.

| # | Fitur AI | Di mana | Yang dilakukan | Manfaat yang ditampilkan | Teknologi |
|---|---|---|---|---|---|
| 1 | **Deteksi langsung + keparahan** | Kamera warga | Mengunci lubang/retak, memberi jenis dan kisaran ukuran | Laporan langsung jelas tanpa formulir | YOLOv8n INT8 (OpenVINO) + segmentasi |
| 2 | **Cek keaslian foto** | Saat kirim (warga & kontraktor) | Mendeteksi foto layar, editan AI/manipulasi, foto daur ulang (sidik gambar), blur/gelap | Skor kepercayaan foto; mencegah kasus "foto perbaikan editan AI" seperti di JAKI | Klasifikasi + perceptual hash + metadata server |
| 3 | **Penggabung duplikat** | Inbox | Mengelompokkan laporan lubang yang sama (lokasi + kemiripan gambar) | "12 warga, 1 kasus", sehingga petugas tidak datang 12 kali | Embedding gambar CLIP + jarak GPS |
| 4 | **Skor prioritas yang menjelaskan** | Inbox | Menghitung risiko celaka: kedalaman, kelas jalan, kepadatan motor, dekat sekolah/RS (OSM), hujan, lama menunggu | Urutan kerja yang bisa dipertanggungjawabkan | Model skor + penjelasan per faktor |
| 5 | **Peringatan hujan** | Hari Ini, Peta | Menandai lubang yang akan tergenang (jadi tak terlihat) sebelum hujan lebat | "Tambal 4 lubang ini sebelum hujan Kamis" | Prakiraan Open-Meteo + data lubang |
| 6 | **Ukur dibantu AI** | Lapangan | Menghitung luas dari kartu penanda; membaca angka penggaris sebagai cek silang | Ukuran cepat dan sulit dimanipulasi | Segmentasi + deteksi marker + OCR penggaris |
| 7 | **PINN: umur & opsi perbaikan** | Lapangan, Kasus | 2.000 skenario fisika per ruas → perkiraan umur tiap opsi (tambal / lapis ulang / rekonstruksi / rigid) | "Tambal tipis tahan ±4 bulan, lapis ulang ±3 tahun" | PINN surrogate (OpenVINO) + Monte Carlo |
| 8 | **Biaya per tahun umur layanan** | Biaya | Menggabungkan biaya wajar per material dengan umur dari PINN | Memilih yang **termurah per tahun**, bukan termurah hari ini; mencegah tambal-ulang | Mesin biaya + PINN |
| 9 | **Deteksi anomali biaya** | Audit, Biaya | Membandingkan nilai yang diajukan dengan rentang wajar wilayah dan riwayat; menandai harga satuan, volume, atau frekuensi tambal yang janggal | Tanda "perlu klarifikasi" otomatis untuk auditor | Aturan + statistik outlier |
| 10 | **Verifikasi sebelum/sesudah** | Verifikasi FE | Mencocokkan lokasi dan sudut, menghitung apakah tambalan menutupi seluruh area rusak, mendeteksi celah tepi/genangan | Perbaikan "setengah" ketahuan sebelum kasus ditutup | Pencocokan gambar + segmentasi |
| 11 | **Prediksi rusak dini** | Pantau, Rapor | Belajar dari konfirmasi warga dan FE; memberi peringatan bila pola mirip perbaikan yang dulu cepat gagal | Pemeriksaan ulang tepat waktu; bahan untuk garansi | Model survival sederhana + PINN |
| 12 | **Kopilot instansi (GenAI lokal)** | Hari Ini, Kasus, Perintah Kerja | Briefing harian, draf perintah kerja, pesan status untuk warga dalam bahasa biasa, ringkasan audit | Menghemat waktu menulis; warga mendapat kabar jelas | Qwen2.5 INT4 via OpenVINO GenAI. **Angka diisi kode**, label "Disusun AI, perlu persetujuan" |

**Aturan AI:**
- AI tidak pernah mengubah status kasus.
- Setiap saran AI punya tombol *Terima / Ubah / Tolak* + alasan, dan semuanya tercatat. Koreksi petugas menjadi data latih.
- Tampilkan "Belum diukur" bila model belum dievaluasi, misalnya akurasi pada foto lokal.

---

## 4. Mesin biaya v6: banyak material, harga per wilayah

### 4.1 Katalog material (dapat diperluas OM)

| Kelompok | Item (contoh, kode AHSP jika ada) | Satuan |
|---|---|---|
| Aspal panas | AC-WC (7.3.(5a)), AC-BC (7.3.(6a)), HRS-WC, perbaikan campuran aspal panas/tambal (11.1.(9)) | ton / m³ |
| Aspal dingin | Cold mix kemasan, CPHMA/asbuton (11.1.(11), 7.6.(1)) | sak / m³ |
| Lapis perekat | Tack coat 7.1.(2a), prime coat 7.1.(1) | liter |
| Perkerasan kaku (rigid) | Beton semen fc' 30 MPa (±K-350), **semen** per sak 40/50 kg (jenis PCC / OPC Tipe I), agregat, besi dowel/tie bar | m³ / sak / kg |
| Lain-lain | Paving block, lapis pondasi agregat kelas A/B (6.1.(1)/(2)), galian perkerasan, upah per kategori | m² / m³ / OH |

### 4.2 Buku harga per wilayah
- **Tabel:** `PriceBook(region_code, item_code, unit, price, source, valid_from, status)`, dengan status RESMI (HSPK/SSH instansi) / SUMBER (berita, Pertamina, vendor) / ASUMSI / PERLU-VERIFIKASI.
- **Sumber nilai, berurutan dari yang diutamakan:**
  1. HSPK/SSH daerah yang diunggah OM (CSV).
  2. Data nasional di `docs/v5/data/` (harga aspal Pertamina per titik suplai, UMP/UMK 2026, IKK BPS 2025 sebagai pengali wilayah).
  3. Nilai acuan berlabel ASUMSI.
- **Harga semen dan beton per daerah:** belum ada data terverifikasi di paket. **Jangan dikarang.** Sediakan import CSV dan isian manual, ditandai PERLU-VERIFIKASI sampai instansi mengunggah HSPK-nya.
- Upah: UMP/UMK daerah, 25 hari × 7 jam. Overhead 10% (maks 15%); PPN efektif 11%.

### 4.3 Yang ditampilkan
- Kalkulator per kasus: ukuran terukur, pilihan material (bisa membandingkan 2–3 opsi berdampingan), lalu **rentang biaya**, **perkiraan umur (PINN)**, dan **biaya per tahun umur layanan**.
- Setiap angka menampilkan sumber dan statusnya.
- Bila ada nilai yang diajukan kontraktor/SPK: selisih >20%, tanda "perlu klarifikasi", dan kasus masuk ke daftar Auditor.

---

## 5. Gaya UI dan user journey

### 5.1 Gaya
- Tetap UI asli: latar gelap, aksen kuning #FFC72C dan oranye, Pavi, kartu melayang, efek kotak deteksi, peta gelap.
- **Penyempurnaan:**
  - Grid konsisten 8px, sudut 16px.
  - Satu tombol utama per layar.
  - Angka besar dengan label pendek.
  - Badge peran berwarna: OM kuning, FE cyan, Auditor ungu, Kontraktor oranye.
  - Animasi mikro singkat (150–250 ms), dengan fallback reduced-motion.
- **Bahasa:** sehari-hari. Istilah teknis (εt, P10–P90, AHSP, hash) hanya di balik "Detail teknis".
- Pavi muncul dengan topi/variasi berbeda sesuai portal: warga oranye, instansi kuning.

### 5.2 Sketsa layar kunci

```
WORKSPACE · Hari Ini (desktop)
┌───────────────┬──────────────────────────────────────────────────────┐
│ [logo] Sudin  │  Selamat pagi, Rina  · [OM]           🔒 Kunci  🔍   │
│ BM Jaktim     ├──────────────────────────────────────────────────────┤
│               │  [6 Baru] [2 Lewat tenggat] [5 Diperbaiki] [1 Gagal] │
│ ◉ Hari Ini    │  ┌─ Briefing AI ───────────────────────────────────┐ │
│ ○ Inbox&Peta  │  │ 2 lubang dekat SD · hujan Kamis di Jatinegara ·  │ │
│ ○ Perintah    │  │ 1 perbaikan rusak lagi (40 hari) [Lihat]         │ │
│ ○ Biaya       │  └──────────────────────────────────────────────────┘ │
│ ○ Pantau      │  Perlu tindakan kamu                                  │
│ ○ Rapor       │  • Setujui usulan JKT-4F2 (Lapis ulang, Rp 18–22 jt) │
│ ○ Audit       │  • Konfirmasi kepemilikan JKT-9A1 (keyakinan rendah) │
│ ○ Tim & Kode  │  • 3 kasus belum ditugaskan                          │
└───────────────┴──────────────────────────────────────────────────────┘

MASUK INSTANSI (HP)
┌──────────────────────┐
│  [Pavi kuning]       │
│  Masuk Instansi      │
│  [ Scan QR badge ]   │
│  atau ketik kode     │
│  [JT7-K4P-9QX     ]  │
│  PIN  ● ● ● ● ○ ○    │
│  [   Masuk   ]       │
└──────────────────────┘
```

### 5.3 User journey ringkas
- **Warga:** buka → Laporkan → kamera AI → Kirim → "Ditangani oleh Sudin BM Jaktim" → notifikasi bertahap → konfirmasi 1/3/6 bulan.
- **OM pagi hari:** scan QR → Hari Ini (briefing AI) → Inbox urut prioritas → gabungkan duplikat → tugaskan FE → setujui usulan kemarin (PIN) → terbitkan perintah kerja + kode tamu kontraktor.
- **FE di lapangan:** masuk dengan kode → Tugasku (rute) → inspeksi + ukur → PINN + bandingkan opsi biaya per tahun → usulkan. Setelah kontraktor selesai: verifikasi sebelum/sesudah dengan AI.
- **Kontraktor:** scan kode tamu dari OM → lihat 1 perintah kerja → unggah bukti langsung (suhu, ketebalan, tack coat) → selesai. Tidak bisa menutup kasus.
- **Auditor:** masuk → Audit → rantai bukti utuh ✓ → daftar anomali (selisih biaya, gagal dini, foto ditandai) → ekspor laporan.

---

## 6. Perubahan data (ringkas)

- **`Agency`** (workspace): nama, logo (unggahan), jenis (nasional/provinsi/kab-kota/desa/tol), wilayah, kontak, SLA.
- **`Jurisdiction`**: agency_id, admin_area (kode wilayah), road_status, daftar segmen/SK referensi, prioritas aturan.
- **`StaffMember`**: agency_id, nama, jabatan, role (OM/FE/AUDITOR), code_hash, pin_hash, status, last_seen.
- **`AccessCode`**: token (hash), tipe (STAFF/CONTRACTOR_GUEST), scope (agency / work_order_id), expires_at, revoked_at.
- **`WorkOrder`**: case_id, proposed_by (FE), approved_by (OM), executor (SWAKELOLA/CONTRACTOR), guest_code_id, status, evidence[].
- **`PriceBook`** + **`MaterialCatalog`**: lihat 4.2.
- **`AiSuggestion`**: tipe, input ringkas, output, keyakinan, keputusan manusia (accept/edit/reject), alasan.
- Peran v5 dipetakan ke peran v6 (tabel 2.3). Tes RBAC dan pemisahan tugas diperbarui, bukan dihapus.

---

## 7. Dampak ke video demo

Storyboard di `docs/v5/DEMO_VIDEO_PLAN.md` diperbarui menjadi dua portal:
- **0:00–0:20 Portal Warga.** Lapor + kartu "Ditangani oleh…".
- **0:20–1:20 Workspace Instansi**, dengan satu kali scan QR lalu berganti badge peran (OM → FE → Kontraktor (kode tamu) → FE verifikasi → Auditor). Pop-up AI: deteksi, keaslian foto, duplikat, prioritas, peringatan hujan, PINN, biaya per tahun, anomali, verifikasi sebelum/sesudah.
- **1:20–1:30 Warga konfirmasi + penutup.**

---

## 8. PROMPT untuk Claude Code

```
Read docs/v6/V6_UPDATE_TWO_PORTALS.md fully. It replaces the 9-role structure and navigation from docs/v5; all other docs/v5 rules stay (honest numbers, value labels, separation of duties, hash-chained audit, neutral wording, no government letterhead, original UI style restored on branch ui-restore).

Goal: two portals.
(1) Citizen portal: no login; report → automatic routing to the responsible agency workspace; "Handled by" card; public tracking; notifications; follow-up confirmations.
(2) Agency workspace: one workspace per road-owning agency; staff sign in with a personal access code or QR badge + 6-digit PIN; roles inside: Operations Manager, Field Engineer, Auditor, plus Contractor guest codes scoped to one work order. One shared dashboard; modules and actions shown by role per the matrix in section 2.4.

Keep the ORIGINAL UI style (dark, yellow/orange accents, Pavi, detection effects, floating cards). Refine it: consistent spacing, one primary action per screen, role badges, plain everyday words, technical details behind a toggle. Do not introduce a new design system.

Work in phases on a new branch v6-portals (from ui-restore). After each phase: tests green, commit with "Assisted-by: Claude Code", HTTPS URL running, screenshots.
P1 Data & access: Agency, Jurisdiction, StaffMember, AccessCode (hashed), PIN, sessions, rate limits, re-PIN for sensitive actions, login log, contractor guest codes. Map v5 roles → v6 roles; update RBAC/SoD tests (never delete them).
P2 Auto-routing to workspaces: report → road segment → status → jurisdiction → agency inbox; LOW confidence → "confirm ownership"; not-onboarded agency → public case + LAPOR! draft; transfers with decree citation, logged in the chain.
P3 Workspace shell + modules: Today, Inbox & Map, Case, Field (mobile), Work Orders, Monitor, Report Card & Rankings, Audit, Team & Codes, Settings, following sections 2.4–2.5 and 5.2.
P4 AI features 1–12 (section 3), each with "what it does / benefit / Accept-Edit-Reject" and logged AiSuggestion. Use existing OpenVINO models and services; where a model is not trained or evaluated yet, implement the pipeline + UI and show "not measured yet" — never fake outputs.
P5 Cost engine v6 (section 4): material catalog incl. asphalt types, cold mix, rigid concrete/cement, paving; regional PriceBook with CSV import and status labels; side-by-side options with PINN life → cost per service-year; >20% anomaly flag to Auditor. Do not invent cement/concrete prices: mark TODO_VERIFY until an agency uploads its HSPK.
P6 Citizen portal polish + full real end-to-end test: citizen report in Jakarta auto-appears in the correct agency inbox; OM assigns; FE inspects/proposes; OM approves (PIN); contractor guest uploads evidence; a different FE verifies; follow-ups scheduled; auditor exports report; /verify passes; citizen sees every step. No demo mode anywhere.
Before finishing: list real test workspaces, staff codes/QR (local file, not committed), the URL, and a short click-by-click demo path for both portals.
Stop and ask me if a decision affects law/legal wording, missing official prices, or schema beyond this file.
```
