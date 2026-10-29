# Modul inti, dijelaskan sederhana (SPEC §9)

Untuk setiap anggota tim: apa masukannya, rumusnya, alasannya, batasannya, dan tiga pertanyaan juri beserta jawabannya.

---

## 1. PINN-2: diagnosis ruas (`inference/app/diagnose.py`)

- **Masukan:**
  - lalu lintas (ESAL per tahun, diisi manusia), bulan basah, porsi ODOL;
  - struktur lapisan dari data proyek terverifikasi, atau struktur khas kelas jalan berlabel ASUMSI;
  - observasi: retak buaya dan umur sejak lapis terakhir, perbaikan yang rusak lagi < 90 hari.
- **Cara kerja:**
  1. Ambil 2.000 kemungkinan struktur di sekitar prior.
  2. Hitung regangan tiap struktur dengan surrogate fisika di OpenVINO. Sampel di luar domain dihitung PyMastic.
  3. Ubah regangan ke jumlah beban yang diizinkan (Asphalt Institute) dan gabungkan musim kering/basah dengan rumus Miner: `N = 1 / ((1−f)/N_kering + f/N_basah)`.
  4. Beri bobot tiap struktur menurut seberapa cocok ia menjelaskan observasi. Contoh: P(retak | D) = logistik(ln D / 0,5), dengan D = kerusakan yang sudah terpakai.
  5. Sisa umur P10/P50/P90 berbobot → 🔴 (P50 < 2 th) / 🟡 (< 5 th) / 🟢.
- **Alasan:** struktur di bawah aspal hampir tidak pernah diketahui. Daripada menebak satu angka, kami menghitung semua kemungkinan dan membiarkan data lapangan mempersempitnya.
- **Batasan:**
  - fungsi kemungkinan (logistik) adalah ASUMSI;
  - lalu lintas sangat menentukan hasil;
  - surrogate terbukti akurat (εt 0,67%, εv 0,49% vs PyMastic), tetapi model fisika berlapis sendiri adalah penyederhanaan.

**Juri bertanya:**
1. *"Dari mana Anda tahu struktur jalannya?"* — Kami tidak tahu pasti. Prior berlabel ASUMSI melebar ±30–45%. Data proyek atau core yang diverifikasi mempersempitnya, dan rentang P10–P90 menunjukkan ketidakpastiannya secara terbuka.
2. *"Apa bedanya dengan hitung manual?"* — Manual menghitung satu struktur dalam ±33 ms. Surrogate OpenVINO menghitung 2.000 struktur sekaligus (±15 µs per struktur), sehingga ketidakpastian bisa ditampilkan secara real time.
3. *"Siapa yang memutuskan?"* — Koordinator: setuju atau timpa dengan alasan wajib, lalu tersimpan untuk kalibrasi. AI tidak mengubah status laporan.

## 2. PINN-1: medan regangan (`inference/pinn1/core.py`), riset

- **Masukan:** tebal dan modulus lapisan, tekanan ban 0,55 MPa, radius kontak dari beban roda.
- **Rumus:**
  - jaringan saraf u(r,z), w(r,z) per lapisan;
  - loss = residu dua persamaan keseimbangan Navier aksisimetris + tekanan ban di permukaan + geser permukaan nol + kontinuitas u, w, σzz, τrz antar lapisan + 40 titik data PyMastic;
  - mode invers: modulus menjadi parameter yang dilatih dari cekungan lendutan.
- **Alasan:** kalau berhasil, PINN bisa menebak modulus dari lendutan lapangan (Benkelman/FWD) tanpa uji bor.
- **Batasan:**
  - Hasil jujur di struktur pilot: error w 28%, εzz 92% vs PyMastic. Target < 10% belum tercapai.
  - Mode invers belum berhasil.
  - Karena itu PINN-1 tidak dipakai untuk keputusan.

**Juri bertanya:**
1. *"Apakah physics loss membantu?"* — Ya, terukur. Tanpa physics loss errornya 1,5–3× lebih besar dan residunya 13× lebih besar (`measurements/pinn1_ablation.json`).
2. *"Kenapa belum akurat?"* — Lapis aspal tipis (0,46 × radius kontak) dengan kontras kekakuan 60×. Perlu pelatihan lebih lama dengan L-BFGS dan skala per lapis.
3. *"Kenapa tetap ditampilkan?"* — Karena kami menampilkan apa yang sudah dan belum berhasil. Keputusan memakai PINN-2 + PyMastic yang sudah tervalidasi.

## 3. Kalkulator kewajaran (`src/domain/audit/fairness.ts`)

- **Masukan:** material (katalog), tebal, luas, nilai SPK; buku harga `config/prices/jabodetabek.json`. Semua barisnya berlabel ASUMSI, bersumber, dan bertanggal.
- **Rumus:**
  - volume = luas × tebal; tonase = volume × berat isi (2,3 t/m³, ASUMSI);
  - biaya = tonase × harga + lapis perekat (0,25 kg/m² × harga aspal), lalu dikali faktor pekerjaan 1,15 (ASUMSI);
  - selisih = (nilai SPK − biaya) / biaya; |selisih| > 20% → "Perlu klarifikasi biaya".
- **Alasan:** memberi titik awal pertanyaan yang objektif tanpa menuduh.
- **Batasan:** harga indikatif. Wajib diganti HSPK/SSH daerah atau AHSP Permen PUPR 1/2022 sebelum dipakai resmi.

**Juri bertanya:**
1. *"Apakah ini menuduh korupsi?"* — Tidak. Bahasanya dikunci netral ("perlu klarifikasi"); Koordinator wajib menanggapi dengan penjelasan, uji, atau penolakan beralasan; publik hanya melihat "Sedang dalam pemeriksaan teknis".
2. *"Kenapa ambang 20%?"* — Ambang bisa disunting admin. Angka ini mengikuti konteks studi lapangan (selisih ±21% kontrak AC-WC, Jurnal Yudharta; sumber perlu diverifikasi).
3. *"Bagaimana bila harga tidak ada?"* — Statusnya "tidak dapat dihitung" dan tidak keluar angka apa pun.

## 4. Eskalasi (`src/domain/workflow/escalation.ts`)

- **Masukan:** status laporan, tanggal laporan, alasan tertunda (kode + tanggal).
- **Aturan:**
  - H+2 pengingat Koordinator, H+7 Pimpinan, H+14 label publik "Belum ditangani > 14 hari", H+30 draf surat pengaduan (warga mengirim sendiri lewat SP4N-LAPOR!);
  - alasan tertunda menghentikan tangga eskalasi sampai tanggal yang dijanjikan, lalu hitungan dimulai lagi dari tanggal itu.
- **Alasan:** laporan tidak bisa hilang diam-diam, sementara instansi tetap bisa menjelaskan penundaan yang wajar, misalnya "permanen setelah musim hujan".
- **Batasan:** target hari adalah target internal, bukan batas hukum. Eskalasi dihitung saat data dibaca; belum ada notifikasi push.

**Juri bertanya:**
1. *"Bagaimana kalau Dinas memang menunggu anggaran?"* — Pilih "menunggu anggaran" beserta tanggal. Alasannya tampil publik dan eskalasi berhenti.
2. *"Apakah aplikasi mengirim pengaduan otomatis?"* — Tidak. Draf hanya diunduh warga.
3. *"Kenapa 14 hari?"* — Target internal yang bisa disunting. Rapor Instansi menampilkan % laporan di atas 14 hari sebagai metrik operasional.

## 5. Skor prioritas antrian (`src/domain/workflow/priority.ts`)

- **Masukan:** keparahan (hasil inspeksi; jika belum ada, hasil AI × keyakinan; jika belum ada juga, perkiraan pelapor dibagi dua), jumlah "saya juga melihat ini" (maks. 20 poin), lama menunggu (maks. 20 poin).
- **Rumus:** skor = kerusakan + dukungan + menunggu. Alasan setiap komponen ditampilkan di antrian.
- **Alasan:** yang paling berbahaya didahulukan, tetapi laporan lama dan yang dikawal banyak warga tidak tenggelam.
- **Batasan:** bobotnya pilihan desain, belum dikalibrasi dengan data kecelakaan.

**Juri bertanya:**
1. *"Bisakah warga memanipulasi lewat dukungan?"* — Dukungan dibatasi 20 poin, satu per akun, dan pelapor tidak bisa mendukung laporannya sendiri.
2. *"Apakah AI menentukan urutan kerja?"* — AI hanya mengurutkan usulan. Koordinator boleh mengerjakan dalam urutan apa pun.
3. *"Bagaimana dengan laporan tanpa foto yang jelas?"* — AI yang tidak yakin tidak lolos otomatis. Bobot kerusakannya memakai perkiraan pelapor dibagi dua sampai diinspeksi.
