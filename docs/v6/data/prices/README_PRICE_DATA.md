# PAVEMENT-PINN v6: Data Harga Material, Upah, Alat, dan Uji Mutu (TA 2026)

> Letakkan seluruh folder ini di repo sebagai `docs/v6/data/prices/`. Data ini dipakai oleh mesin biaya v6 (`docs/v6/V6_UPDATE_TWO_PORTALS.md`, bagian 4).

## 1. Prinsip validitas

- Semua harga **diambil langsung dari dokumen standar harga resmi pemerintah daerah TA 2026**, yang teksnya dibaca dari PDF di JDIH BPK. Setiap baris mencantumkan dokumen, URL, dan halaman.
- **Nama item, satuan, dan angka ditulis persis seperti di dokumen** (`*_as_written`). Kolom `item_name_en` hanya terjemahan untuk UI.
- **Status:**
  - `OFFICIAL`: angka ada di peraturan daerah.
  - `SOURCE`: angka dari berita atau daftar harga yang bersumber.
  - `TODO_VERIFY`: ada kejanggalan satuan atau konteks; cek PDF dulu sebelum dipakai.
- **Tidak ada angka yang dikarang.** Wilayah yang belum punya data tercantum di `price_book_todo_regions.csv` beserta dokumen yang harus dimuat.
- Ini **Standar Harga Satuan (SSH)**, yaitu harga acuan belanja pemerintah daerah. SSH bukan harga pasar harian, dan bukan harga satuan pekerjaan (HSPK/AHSP) yang sudah termasuk upah dan alat. Mesin biaya menyusun harga satuan pekerjaan dari bahan + upah + alat (struktur AHSP).

## 2. Isi file

| File | Isi | Wilayah | Sumber |
|---|---|---|---|
| `price_book_regional_2026.csv` | 59 item: aspal (AC-WC, AC-BC, AC-Base/ATB, hotmix, aspal curah, pen 60/70, modifikasi, asbuton, emulsi/tack coat), beton ready-mix K-250 sampai K-400 (dengan/tanpa fly ash), beton cepat kering (fast track ≤24 jam/≤3 hari), semen (portland 50 kg/zak, per kg, grout), pasir, agregat kelas A/B, batu pecah, besi beton, paving block | Kab. Karawang, Kab. Tangerang | Perbup Karawang 28/2025; Perbup Kab. Tangerang 32/2025 |
| `wages_daily_2026.csv` | Upah harian: pekerja, tukang, kepala tukang, mandor, operator | Kab. Karawang | Perbup Karawang 28/2025 hal. 230 |
| `equipment_rental_2026.csv` | Sewa alat per jam: asphalt finisher, sprayer, distributor, cold milling, cutter, baby roller, rig core drill | Kab. Karawang | Perbup Karawang 28/2025 hal. 240–241 |
| `qa_test_prices_2026.csv` | Harga uji mutu: core drill, Marshall, ekstraksi kadar aspal, sand cone, DCP, CBR lapangan, hammer test, penetrasi | Prov. Sulawesi Tenggara | Pergub Sultra 41/2025 hal. ±99–103 |
| `market_price_signals_2026.csv` | Sinyal harga pasar: semen di Sumbawa naik ke Rp100.000/sak (normal Rp83.000, Okt 2026), harga aspal Pertamina, IHPB semen BPS | Nasional/daerah | SuaraNTB, TimesIndonesia, BPS via Databoks |
| `price_book_todo_regions.csv` | Wilayah prioritas yang dokumennya masih harus dimuat: DKI Jakarta (HSPK/e-HSPK 2026), Prov. Lampung, Kota Bandar Lampung, Kab. Tangerang (Perbup 68/2025 perubahan) | — | — |

Data pendukung yang sudah ada di paket v5 (`docs/v5/data/`): `ump_2026.csv` (38 provinsi), `umk_2026.csv`, `ikk_2025.csv` (indeks kemahalan konstruksi BPS untuk pengali wilayah), `material_prices.csv`, `ahsp_items.json`.

## 3. Kejanggalan yang wajib ditangani (jangan disembunyikan)

1. **Karawang punya dua baris AC-WC:** "Aspal AC Wearing" Rp2.741.700/ton dan "Material Aspal Beton (Ac-Wc)" Rp1.273.100/ton. Cakupan keduanya kemungkinan berbeda (material saja vs. terpasang/lainnya). Tampilkan keduanya dan biarkan OM memilih; jangan dirata-rata.
2. **Satuan semen Kab. Tangerang:** "Semen Portland 50 kg" tertulis satuan **Kg** dengan nilai Rp73.300. Angka ini cocok untuk harga per sak 50 kg, bukan per kg. "Semen / PC (kg)" Rp56.300 juga tidak masuk akal per kg. Status `TODO_VERIFY`; cek PDF asli.
3. **Upah operator alat berat Karawang (Rp100.000/OH)** lebih rendah dari pekerja (Rp138.000/OH). Angkanya memang tertulis begitu di dokumen; tampilkan apa adanya, dengan peringatan untuk admin.
4. **Harga beton K-series tidak selalu naik sesuai mutu** (misalnya K-350 Tangerang lebih mahal dari K-400). Tampilkan apa adanya. Anomali seperti ini justru bahan untuk fitur "deteksi anomali harga" (AI #9), sebagai catatan untuk instansi dan bukan tuduhan.
5. **Perbup Kab. Tangerang 32/2025 sudah diubah oleh Perbup 68/2025.** Nilai Tangerang perlu dicek ulang ke perubahannya.
6. **Konversi K ke fc'** (misalnya K-350 ≈ fc' 29–30 MPa) adalah perkiraan umum, bukan nilai dari dokumen. Tampilkan sebagai "≈".
7. **Harga uji mutu berasal dari Sulawesi Tenggara** dan dipakai sebagai acuan contoh untuk rekomendasi uji ke instansi. Pengali IKK boleh dipakai, tetapi diberi label ASSUMED.

## 4. Cara mesin biaya memakainya

1. **Pilih wilayah kasus** (kode BPS dari routing).
2. **Ambil harga dengan urutan prioritas:**
   1. Buku harga instansi yang diunggah OM.
   2. `price_book_regional_2026.csv` untuk kode wilayah yang sama.
   3. Wilayah lain + pengali IKK 2025 (status ASSUMED).
   4. Kalau tidak ada sama sekali, tampilkan "harga belum tersedia" dan jangan menghitung.
3. **Upah:** ambil dari `wages_daily_2026.csv` untuk wilayah itu. Kalau tidak ada, pakai UMP/UMK daerah ÷ 25 hari (status COMPUTED).
4. **Alat:** ambil dari `equipment_rental_2026.csv` untuk wilayah itu. Kalau tidak ada, beri status TODO_VERIFY.
5. **Susun harga satuan pekerjaan** sesuai struktur AHSP (koefisien dari `ahsp_items.json`; yang belum resmi tetap TODO_VERIFY). Tambahkan overhead 10% dan PPN efektif 11%.
6. **Bandingkan opsi material** berdampingan:
   - Tambal hotmix (AC-WC).
   - Tambal cold mix/emulsi.
   - Beton fast track (rigid).
   - Overlay AC-WC.
   
   Dengan umur dari PINN, hasil akhirnya adalah **biaya per tahun umur layanan**.
7. **Setiap angka di layar** menampilkan sumber, halaman, dan status. Tombol "Lihat dokumen" membuka `source_url`.

## 5. Cara menambah wilayah baru (untuk OM atau admin)

- Unduh SSH/HSPK TA berjalan dari JDIH daerah atau JDIH BPK.
- Isi template CSV dengan kolom yang sama dengan `price_book_regional_2026.csv`, lalu impor di menu **Biaya & Material → Buku Harga → Impor CSV**.
- Sistem memvalidasi:
  - Kolom wajib terisi.
  - Satuan dikenal.
  - Angka > 0.
  - Ada sumber.
  - Perbandingan dengan wilayah lain (peringatan bila lebih dari 3× atau kurang dari 0,3× median).
- Setiap impor tercatat di rantai audit (siapa, kapan, file apa).
