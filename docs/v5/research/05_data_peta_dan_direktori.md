# Map data and agency directory for coloring Indonesian (and Jakarta) roads by responsible authority (PAVEMENT-PINN)

> Research notes as of 2026-11-01. Method: WebSearch, WebFetch, and direct visits to official sites in a Chrome session. Limits that shaped coverage:
> - The shared web-search budget ran out partway through, so several items could not be searched and are listed under Gaps.
> - Outbound `curl` from the sandbox was blocked by the proxy (HTTP 403 on CONNECT) for every portal tested, including sigi.pu.go.id, tanahair.indonesia.go.id, jakartasatu.jakarta.go.id, satudata.jakarta.go.id, bpjt.pu.go.id, data.go.id and geoboundaries.org.
> - binamarga.pu.go.id blocks automated fetchers in robots.txt, so it was read in a browser instead.
> - tanahair.indonesia.go.id and wiki.openstreetmap.org could not be opened in the browser session. They were read through WebFetch only.
> - No office coordinates were found in any source. All lat/lon fields are left blank on purpose.

## 1. Official road-status lists and geometry (national, provincial/DKI, kabupaten/kota) and where to download them

### Takeaway
The national road list currently in force is **Kepmen PUPR No. 1688/KPTS/M/2022**, not 430/KPTS/M/2022. Kepmen 430/2022 assigns road *function* (JAP/JKP-1). Kepmen 1688 is published only as a 51.58 MB PDF lampiran. I found no confirmed public vector (SHP/GeoJSON) or working ArcGIS REST service for national road status. Bina Marga publishes only raster maps and PDF reports. Jakarta's open data gives tabular road-status summaries without geometry, and Jakarta Satu's ArcGIS server was down when tested. In practice, road-status geometry has to be built by joining the official ruas lists (PDF/tables) onto OSM or BIG geometry.

### Cited Findings
**National status and function decrees**
- The Bina Marga NSPK detail page whose URL slug says "430" actually contains "Keputusan Menteri PUPR Nomor 1688/KPTS/M/2022 tentang Penetapan Ruas Jalan Menurut Statusnya sebagai Jalan Nasional". Details: category Keputusan Menteri, year 2022, published 03 Apr 2023, status "Berlaku", file "Download (51.58 MB)", MD5 4776c9c4158abea64ee1fde3a10538a1. Its legal basis is Pasal 62(1) PP 34/2006 tentang Jalan. — [Bina Marga NSPK (Kepmen 1688/2022)](https://binamarga.pu.go.id/index.php/nspk/detail/keputusan-menteri-pupr-nomor-430kptsm2022-tentang-penetapan-ruas-jalan-menurut-statusnya-sebagai-jalan-nasional)
- Kepmen 430/KPTS/M/2022 is a separate decree: "Penetapan Ruas Jalan Dalam Jaringan Jalan Primer Menurut Fungsinya Sebagai Jalan Arteri Primer (JAP) dan Jalan Kolektor Primer-1 (JKP-1)". It covers function, not status. — [Bina Marga NSPK list of Keputusan Menteri](https://binamarga.pu.go.id/index.php/nspk/keputusan-menteri); [NSPK Kepmen 430/2022 detail](https://binamarga.pu.go.id/index.php/nspk/detail/keputusan-menteri-pupr-nomor-430kptsm2022-tentang-penetapan-ruas-jalan-dalam-jaringan-jalan-primer-menurut-fungsinya-sebagai-jalan-arteri-primer-jap-dan-jalan-kolektor-primer-1-jkp-1)
- The same NSPK list also includes "Kepmen PUPR Nomor 367/KPTS/M/2023 tentang Rencana Umum Jaringan Jalan Nasional 2020-2040". — [Bina Marga NSPK list](https://binamarga.pu.go.id/index.php/nspk/keputusan-menteri)
- According to an Ombudsman article, Kepmen 1688/KPTS/M/2022 replaced Kepmen 290/KPTS/M/2015. — [Ombudsman RI article](https://ombudsman.go.id/artikel/r/pwkinternal--implikasi-kontroversi-kepmen-pupr-nomor-1688kptsm2022-tentang-penetapan-ruas-jalan-)
- The same article describes knock-on effects of the 2022 decree:
  - Kepulauan Riau has 429.66 km of national roads.
  - Batam has had no national roads since 2022.
  - Kepgub Kepri No. 485 (3 April 2023) reclassified provincial roads the same way, leaving Batam with no provincial roads.
  - Provincial SKs therefore follow, and depend on, the national SK.
  — [Ombudsman RI article](https://ombudsman.go.id/artikel/r/pwkinternal--implikasi-kontroversi-kepmen-pupr-nomor-1688kptsm2022-tentang-penetapan-ruas-jalan-)

**National road totals and data system**
- National road length is 47,604.34 km non-toll and 2,841.12 km toll. The report cites Kepmen PUPR 1688/KPTS/M/2022 and Kepmen 367/KPTS/M/2023. — [Buku Kondisi Jalan Nasional 2025 Semester 1 (data.pu.go.id PDF)](https://data.pu.go.id/sites/default/files/Buku%20Kondisi%20Jalan%20Nasional%202025%20S-1.pdf)
- The report's data comes from the **IRMS database** kept by each Balai/Balai Besar and validated by Direktorat Preservasi Jalan. It has no separate row for DKI Jakarta: DKI is reported together with Jawa Barat under BBPJN DKI Jakarta–Jawa Barat (1,782.59 km, 97.88% mantap). It does not say how to get ruas-level data. — [Buku Kondisi Jalan Nasional 2025 S-1](https://data.pu.go.id/sites/default/files/Buku%20Kondisi%20Jalan%20Nasional%202025%20S-1.pdf)
- Semester condition books from earlier periods are also posted on data.pu.go.id, e.g. 2024 S1 and 2024 S2. — [2024 S1 PDF](https://data.pu.go.id/sites/default/files/Buku%20Kondisi%20Jalan%20Nasional%202024%20S1_ttd.pdf); [2024 S2 PDF](https://data.pu.go.id/sites/default/files/Buku%20Kondisi%20Jalan%20Nasional%202024%20S-2%20TTD.pdf)

**Bina Marga maps**
- The BBPJN DKI Jakarta–Jawa Barat "Peta Ruas Jalan Nasional" page has no vector download. Its only map is a JPG named "Wilayah Kerja 2026 Revisi 1" (`.../balai-dki-jabar/assets/js/vendor/ckeditor/uploads/Wilayah%20Kerja%202026%20Revisi%201%20(1)_1.jpg`). — [BBPJN DKI–Jabar Peta Ruas Jalan Nasional](https://binamarga.pu.go.id/balai-dki-jabar/konten/profil/peta-ruas-jalan-nasional)

**Ina-Geoportal and Satu Data Indonesia records**
- Ina-Geoportal (tanahair) record "JALAN_LN_250K":
  - It covers Papua roads only and was published by BAPPEDA Papua.
  - It has a status attribute (nasional/provinsi), a function attribute (arteri/kolektor) and EPSG:4326 geometry.
  - It lists no download/service URL and has an empty licence field.
  - It shows that Ina-Geoportal records can hold road status, but often as metadata only.
  — [tanahair.indonesia.go.id/sdi/dataset/jalan_ln_250k](https://tanahair.indonesia.go.id/sdi/dataset/jalan_ln_250k)
- Satu Data Indonesia catalog "Peta Jaringan Jalan RBI" is metadata only, harvested from Pemkab Pangandaran CSW. It has no resources, no licence and no attribute schema. — [katalog.satudata.go.id/dataset/peta-jaringan-jalan-rbi](https://katalog.satudata.go.id/dataset/peta-jaringan-jalan-rbi)

**Jakarta (Satu Data Jakarta and Jakarta Satu)**
- Satu Data Jakarta dataset "Panjang, Luas, dan Status Jalan Menurut Jenisnya di Provinsi DKI Jakarta":
  - Source: Dinas Bina Marga. Metadata created 13 Apr 2026, updated 18 May 2026, file updated 30 Apr 2026, data period 2025.
  - It is tabular with 25 rows (kota administrasi × jenis jalan). Columns: PERIODE_DATA, WILAYAH, JENIS_JALAN (ARTERI PRIMER / KOLEKTOR PRIMER / ARTERI SEKUNDER / KOLEKTOR SEKUNDER / LOKAL), PANJANG_JALAN (m), LUAS_JALAN (m²), STATUS_JALAN.
  - The first 10 rows (Jakarta Pusat and Jakarta Utara) all have STATUS_JALAN = PROVINSI. Lengths: Jakarta Pusat 693,379 m, Jakarta Utara 1,103,252 m.
  - It has "Lihat JSON" and "Unduh Sekarang" options.
  — [Satu Data Jakarta dataset page](https://satudata.jakarta.go.id/open-data/detail?kategori=dataset&page_url=panjang-luas-dan-status-jalan-menurut-jenisnya-di-provinsi-dki-jakarta&data_no=1)
- Jakarta Satu has a geoportal at jakartasatu.jakarta.go.id/geoportal, with menus for Peta 2D, Peta 3D, Berbagi Pakai, Simpul Jaringan and Urun Data. — [Jakarta Satu geoportal](https://jakartasatu.jakarta.go.id/)
- Its ArcGIS Web Adaptor at `https://jakartasatu.jakarta.go.id/server/rest/services` returned "Could not access any server machines. Please contact your system administrator." on 2026-11-01. The portal search endpoint `/portal/sharing/rest/search` returned HTTP 500. — [Jakarta Satu ArcGIS REST](https://jakartasatu.jakarta.go.id/server/rest/services)

**Provincial and kabupaten/kota examples found (titles from search results; content not opened)**
- Bali provincial SK: "SK Gubernur Bali Nomor 2023 Tentang Ruas Jalan Menurut Statusnya Sebagai Jalan Provinsi di Provinsi Bali". — [dishub.baliprov.go.id PDF](https://dishub.baliprov.go.id/wp-content/uploads/2024/06/SK-Gubernur-Bali-Nomor-2023-Tentang-Ruas-Jalan-Menurut-Statusnya-Sebagai-Jalan-Provinsi-di-Provinsi-Bali.pdf)
- Jawa Tengah: "Informasi Data Jalan Provinsi" PDF from DPU Bina Marga Cipta Karya Jateng. — [ppid.dpubinmarcipka.jatengprov.go.id PDF](https://ppid.dpubinmarcipka.jatengprov.go.id/dt-bmck/uploads/Informasi-Data-Jalan-Provinsi.pdf). A Jateng Kepgub "SK 622-2 th 2023" also appeared in results for this topic. — [jdih.jatengprov.go.id](https://jdih.jatengprov.go.id/produk_hukum/kepgub/sk_622-2_th_2023.pdf)
- Kabupaten-level SK example: "SK RUAS JALAN 2024 FIX" — [ppid.kaboki.go.id PDF](https://ppid.kaboki.go.id/wp-content/uploads/2025/06/SK-RUAS-JALAN-2024-FIX.pdf). Kota-level CKAN open data example: "Data Panjang dan Status Jalan di Kota Denpasar". — [satudata.denpasarkota.go.id](https://satudata.denpasarkota.go.id/en/dataset/data-panjang-dan-status-jalan-di-kota-denpasar/resource/8cc8ecd2-c735-4d14-a61e-9fe9e8315316)

### Inferences
- For national roads, the authoritative join key is the ruas number and name in the Kepmen 1688/2022 lampiran (and in IRMS). The practical route is:
  1. Download the PDF.
  2. Extract the ruas tables per province.
  3. Match each ruas to OSM or RBI geometry by name, `ref`, endpoints and province.
- Without geometry, the result is a "status list" rather than a "status map". Expect manual QA, especially where one ruas is split across kota boundaries.
- Regional SKs (Kepgub/Kepbup/Kepwal) chain off the national SK. After any national SK change (as in Kepri), provincial and kabupaten layers can go stale. Store `legal_basis` and `valid_from` per segment.
- Jakarta's open data gives totals by status and kota, which are useful for **validating** a generated map (km per status per kota) but not for drawing it.

### Gaps
- Could not test **sigi.pu.go.id / Geoportal PUPR** (curl blocked; search budget exhausted). It is unknown whether a public ArcGIS REST layer of jalan nasional exists, and what its layer names or attributes (no_ruas, nama_ruas, status, panjang, kondisi) would be. Treat as **unverified**.
- The Kepmen 1688/2022 lampiran was not opened (51.58 MB), so its columns and the exact DKI ruas list are unconfirmed.
- No **Kepgub DKI on ruas jalan provinsi** was confirmed. JDIH Jakarta returned many full-text links but none was opened. Number and date unknown.
- Could not confirm whether a newer national-status Kepmen (2024–2026, under the renamed Kementerian PU) has superseded 1688/2022. The NSPK page still showed it as "Berlaku" on 2026-11-01.
- BIG RBI road layer: format, scale, attributes and licence on Ina-Geoportal were not verified (tanahair not reachable via browser or curl).

## 2. OpenStreetMap: how Indonesian roads are tagged, coverage, Overpass, and inferring status heuristically

### Takeaway
OSM Indonesia guidance loosely maps toll → `highway=motorway`, national → `highway=trunk` (+`ref`), provincial → `primary`, kabupaten → `secondary`. Since at least July 2026 the community has been actively disputing whether class follows government status or real-world function. There is no consensus, and the Data Working Group (DWG) has blocked editors in an edit war. So `highway=*` is a weak proxy for authority. Use it only as a low-confidence fallback.

### Cited Findings
- Wiki page "Indonesia:Tags/Highway":
  - Toll roads (Jalan Tol): `highway=motorway`, no `ref`, named with `name=*`.
  - National roads: `highway=trunk` with a `ref` (national number). Don't use `motorroad=*`, since national roads have at-grade junctions.
  - `primary` and `secondary` carry provincial or regency/city refs.
  - Urban arterials: `tertiary`.
  - Unnumbered roads: `unclassified`/`residential`.
  - The page does not cover `operator=`, `toll=yes` or desa roads.
  — [OSM wiki Indonesia:Tags/Highway](https://wiki.openstreetmap.org/wiki/Indonesia:Tags/Highway)
- Archived Indonesian Tagging Guidelines:
  - motorway = "Jalan Tol"; trunk = "Jalan Nasional".
  - primary = "Jalan antar kota provinsi, Jalan Arteri Primer, Jalan Provinsi".
  - secondary = "Jalan antar kota kabupaten, Jalan Kolektor, Jalan Kabupaten".
  - tertiary = "Jalan antar kecamatan".
  - residential = "Jalan perumahan, Jalan Lingkungan dalam kota".
  - No guidance on `ref`, `operator` or `toll`.
  — [OSM wiki Indonesian Tagging Guidelines/Archived](https://wiki.openstreetmap.org/wiki/Indonesian_Tagging_Guidelines/Archived)
- Indonesian page for `highway=trunk`:
  - In Indonesia it is used for roads with Arteri Primer (JAP) function linking the national capital, and for JKP-1 roads.
  - These roads "masuk ke dalam kewenangan jalan nasional".
  - Example: Rute Nasional 1 (Pantura).
  — [OSM wiki Id:Tag:highway=trunk](https://wiki.openstreetmap.org/Id:Tag:highway=trunk)
- OSM Community thread "Road Classification in Indonesia" (opened 2 July 2026):
  - One proposal: classify by current conditions and use separate designation tags for provincial/regency/city authority.
  - Another proposal: treat government designations "as a framework, not the sole basis".
  - The DWG (Woodpeck) required broad consensus, blocked two editors for a week over an edit war, and reverted highway edits.
  - No consensus in visible posts.
  — [community.openstreetmap.org thread 145030](https://community.openstreetmap.org/t/road-classification-in-indonesia/145030)
- A JOSM preset "Access Mapping Indonesia" exists. It was not reviewed. — [JOSM wiki](https://josm.openstreetmap.de/wiki/Presets/Access_Mapping_Indonesia?version=28)

### Inferences
- **Heuristic status inference when no official geometry exists.** Assign confidence levels:

  | OSM tags | Inferred status | Confidence |
  |---|---|---|
  | `highway=motorway` or `toll=yes` | tol (BUJT / BPJT) | high |
  | `highway=trunk` | nasional | medium |
  | `primary` | provinsi | low |
  | `secondary` | kabupaten/kota | low |
  | `tertiary` / `residential` / `unclassified` | kabupaten/kota (or desa in rural kabupaten) | low |
  | `service` / `track` | private / none | — |

  In Jakarta specifically, there is no kabupaten/kota road authority. The 5 kota administrasi plus 1 kabupaten administrasi are not autonomous, so non-toll public roads default to **Pemprov DKI (Dinas Bina Marga)**. The exceptions are the few ruas listed as national in Kepmen 1688 and, for routing, the six administrative areas each with a Suku Dinas.
- Function and status are different axes in Indonesian law (e.g. Kepmen 430 = function, Kepmen 1688 = status), and OSM editors mix them. Expect `primary` to include provincial roads in some areas and kabupaten roads in others.
- **Overpass query for Jakarta roads (not tested).** Live tests failed: overpass-api.de returned HTTP 406 to the browser, and the kumi.systems mirror could not be opened. Suggested query:
  ```
  [out:json][timeout:180];
  area["ISO3166-2"="ID-JK"]->.jk;
  ( way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service)$"](area.jk); );
  out tags geom;
  ```
  For toll operators, use `way["highway"]["toll"="yes"](area.jk); out tags geom;` and read `operator`, `name`, `ref`. For a kota boundary, use `rel["boundary"="administrative"]["admin_level"="5"](area.jk);`. That admin_level value is an assumption; verify it in OSM.
- Licence: OSM data is ODbL. If PAVEMENT-PINN publishes a merged database (OSM geometry + official status), the merged database likely becomes a derivative database subject to share-alike. Plan to publish the status-attribute layer openly.

### Gaps
- OSM coverage quality was not measured: share of Jakarta trunk/primary with `ref`, `operator` on tolls, presence of `designation`. Overpass could not be reached.
- Did not confirm whether OSM Indonesia uses `ref` prefixes like "N"/"P"/"K" consistently, or uses `designation=*` for status.

## 3. Toll road geometry and operators (BPJT, BUJT, OSM)

### Takeaway
BPJT publishes an official list of operating toll ruas with the BUJT (operator), its address and call centres: 77 operating ruas and 55 BUJT. This is the best source for toll `authority` records. Toll **geometry** is not published by BPJT as vector data as far as I could find. Use OSM `highway=motorway` / `toll=yes` lines and join them to BPJT ruas names.

### Cited Findings
- The BPJT homepage shows "77 Total jalan Tol yang beroperasi", "5 … dalam masa konstruksi" and "55 Total Badan Usaha Jalan Tol (BUJT) Ruas Beroperasi". BPJT contact: Gd. Binamarga Lt. 2-3, Jl. Pattimura No. 20 Kebayoran Baru Jakarta Selatan 12110; informasibpjt@pu.go.id; 0813-8600-0653. — [bpjt.pu.go.id](https://bpjt.pu.go.id/)
- The BPJT list has columns "Ruas | BUJT | Alamat BUJT | Call Center BUJT | Call Center Ruas". Jakarta-area entries extracted on 2026-11-01:

  | Ruas | BUJT | BUJT address | Call center |
  |---|---|---|---|
  | 6 Ruas Tol DKI (Semanan–Sunter dan Sunter–Pulogebang) | PT Jakarta Tollroad Development | Jl. Sultan Syahrir No.8 CBD Bintaro, Tangerang Selatan 15220 | 0811 137 5711 |
  | Akses Tanjung Priok | PT Hutama Karya (Persero) | HK Tower, Jl Letjen MT Haryono Kav. 8, Cawang, Jakarta Timur | 02122408913 |
  | Bekasi–Cawang–Kampung Melayu | PT Kresna Kusuma Dyandra Marga | Graha KKDM, Jl. Inspeksi Saluran Kalimalang No.1, Cipinang Besar Selatan, Jatinegara, Jakarta Timur 13410 | (021) 223 25 224 |
  | Cawang–Tj. Priok–Ancol Timur–Jembatan Tiga/Pluit | PT Citra Marga Nusaphala Persada Tbk | Gedung Citra Marga, Jl. Yos Sudarso Kav. 28, Jakarta Utara 14350 | (021) 65306930 |
  | Cawang–Tomang–Pluit | PT Jasa Marga (Persero) Tbk | Plaza Tol Taman Mini Indonesia Indah, Jakarta 13550 | 14080 |
  | Prof. Dr. Ir. Soedijatmo | PT Jasa Marga (Persero) Tbk | Plaza Tol TMII, Jakarta 13550 | 14080 |
  | Jakarta–Bogor–Ciawi | PT Jasa Marga (Persero) Tbk | Plaza Tol TMII, Jakarta 13550 | 14080 |
  | Jakarta–Tangerang | PT Jasa Marga (Persero) Tbk | Plaza Tol TMII, Jakarta 13550 | 14080 |
  | JORR Non S | PT Jasa Marga (Persero) Tbk | Plaza Tol TMII, Jakarta 13550 | 14080 |
  | Pondok Aren–Bintaro Viaduct–Ulujami | PT Jasa Marga (Persero) Tbk | Plaza Tol TMII, Jakarta 13550 | 14080 |
  | JORR S (Pondok Pinang–TMII) | PT Hutama Karya (Persero) | HK Tower, Jl Letjen MT Haryono Kav. 8, Cawang | — |
  | JORR W1 (Kebon Jeruk–Penjaringan) | PT Jakarta Lingkar Baratsatu | Bangun Tjipta Building lt. 3, Jl. Gatot Subroto No. 54, Petamburan, Tanah Abang, Jakarta Pusat 10260 | (021) 570 9091 |
  | JORR W2 Utara | PT Marga Lingkar Jakarta | Plaza Tol Meruya Utara No.1, Meruya Utara, Jakarta Barat 11620 | 021-7453105 |
  | Jakarta–Cikampek | PT Jasamarga Transjawa Tol | Jl. Teuku Umar, Sepanjang Jaya, Rawa Lumbu, Bekasi 17114 | 14080 |
  | Jakarta–Cikampek II Elevated | PT Jasamarga Jalanlayang Cikampek | Jl. Teuku Umar No.1, Sepanjang Jaya, Rawalumbu, Kota Bekasi 17114 | 0218413526 |
  | Cibitung–Cilincing | PT Cibitung Tanjung Priok Port Tollways | Taman Sari Hive Office, Jl. D.I. Panjaitan Kav 2, Jakarta Timur | (+62)21 89229717 |
  | Depok–Antasari | PT Citra Waspphutowa | Jl. Andara No.12C, Pd. Labu, Cilandak, Jakarta Selatan 12450 | (021) 65306930 |
  | Cengkareng–Batu Ceper–Kunciran | PT Jasamarga Kunciran Cengkareng | Ruko Business Park Tangerang City No. A.19 | 14080 |
  | Cinere–Jagorawi | PT Translingkar Kita Jaya | Jl. Gas Alam, Pedurenan Harjamukti, Cimanggis, Depok 16954 | 021-8775 0111 |
  | Serpong–Cinere | PT Cinere Serpong Jaya | Plaza Tol Pamulang, Jl. RE Martadinata, Ciputat, Tangerang Selatan 15411 | 14080 |
  | Kunciran–Serpong | PT Marga Trans Nusantara | Plaza Tol Parigi, Jl. H. Rasam, Perigi Baru, Pondok Aren, Tangerang Selatan | 081291497112 |
  | Pondok Aren–Serpong | PT Bintaro Serpong Damai | Intermark Associate Tower lt. 16, Jl. Lingkar Timur, BSD, Tangerang Selatan 15310 | — |
  | Serpong–Balaraja | PT Trans Bumi Serbaraja | Green Office Park 9 Wing A lt. 3, BSD City, Tangerang 15345 | 021-50502300 |

  — [BPJT Daftar Ruas Jalan Tol dan BUJT Sedang Beroperasi](https://bpjt.pu.go.id/daftar-ruas-jalan-tol-dan-bujt/)
- BPJT also has a list of ruas under construction, and a news item says Harbour Road II is at 47.41% progress, targeted to be functional in Q1 2028. — [BPJT ruas dalam konstruksi](https://bpjt.pu.go.id/daftar-ruas-jalan-tol-dan-bujt-sedang-dalam-konstruksi/); [bpjt.pu.go.id](https://bpjt.pu.go.id/)
- Jasa Marga offices:
  - Jasa Marga says it holds a 45% market share of operating commercial toll length (±1,286 km) and manages 36 concessions totalling 1,736 km.
  - The **Jasamarga Metropolitan Tollroad Regional Division** (Jabodetabek network) is headquartered at **Plaza Tol Cililitan, Jln Cililitan Besar, Jakarta 13510**.
  - The holding's address in BPJT's list is Plaza Tol Taman Mini Indonesia Indah, Jakarta 13550.
  — [jasamarga.com](https://www.jasamarga.com/); [BPJT list](https://bpjt.pu.go.id/daftar-ruas-jalan-tol-dan-bujt/)
- Satu Data Jakarta "Data Jaringan Jalan Toll Provinsi DKI Jakarta":
  - Source: Dinas Bina Marga. Metadata 17 Oct 2023. Data period **2015**.
  - Columns: PERIODE_DATA, KOTA_ADMINISTRASI, SUFFIX, NAMA_JALAN, PANJANG_JALAN, LEBAR_JALAN, SISTEM, FUNGSI, STATUS, NOMOR_JALAN.
  - Example rows: "Toll Pelabuhan" (Jakarta Utara, 14,300, Toll, Nasional); "Toll Bandara (Prof. Sedyatmo)" (10,270).
  - Tabular only, no geometry.
  — [Satu Data Jakarta toll dataset](https://satudata.jakarta.go.id/open-data/detail?kategori=dataset&page_url=data-jaringan-jalan-toll-provinsi-dki-jakarta&data_no=1)
- The old data.jakarta.go.id URL for this dataset (`data.jakarta.go.id/dataset/jaringan-jalan-toll-provinsi-dki-jakarta`, still referenced by TUMI's data hub) showed a browser error page on 2026-11-01. — [TUMI data hub record](https://hub.tumidata.org/dataset/dki_jakarta_province_toll_road_network_data_jakarta/resource/6fd55e64-1a86-e4e4-2449-1d0b026308d9)

### Inferences
- Toll segments: set `status = tol` and `authority = BUJT` (the operator, which handles maintenance and complaints), with `regulator = BPJT`. On the map, show both, e.g. "Dikelola oleh PT X (BUJT), diawasi BPJT".
- Jasa Marga ruas in Jabodetabek should route to the Metropolitan Tollroad Regional Division (Cililitan) rather than the HQ.
- BUJT names must be matched to OSM `operator=` values with an alias table (e.g. "Jasa Marga", "PT Jasa Marga (Persero) Tbk", "Jasamarga Metropolitan Tollroad").

### Gaps
- No official vector toll geometry (BPJT or Jasa Marga) was found. OSM is the de-facto source.
- Jasa Marga branch-level addresses (per ruas) and Hutama Karya regional offices were not collected.

## 4. Jakarta: national vs provincial roads, kota/kecamatan/kelurahan boundaries, and responsible offices

### Takeaway
In DKI Jakarta, the non-toll network appears to be almost entirely provincial and maintained by Dinas Bina Marga through its Suku Dinas per kota administrasi. National status in Jakarta appears to be mostly toll roads. However, the exact list of non-toll national ruas in Jakarta (from Kepmen 1688/2022) could not be confirmed. Office addresses for Dinas Bina Marga, BBPJN DKI–Jabar, BPJT and Jasa Marga are confirmed. Suku Dinas addresses and all coordinates were not found.

### Cited Findings
**What sources say about status in Jakarta**
- Satu Data Jakarta's 2025 status table shows STATUS_JALAN = PROVINSI for all classes in Jakarta Pusat and Jakarta Utara. That includes arteri primer (Jakarta Utara 12,299 m), arteri sekunder, kolektor sekunder and lokal. — [Satu Data Jakarta status table](https://satudata.jakarta.go.id/open-data/detail?kategori=dataset&page_url=panjang-luas-dan-status-jalan-menurut-jenisnya-di-provinsi-dki-jakarta&data_no=1)
- The Satu Data Jakarta toll table (2015) labels Jakarta toll roads STATUS = "Nasional". — [Satu Data Jakarta toll dataset](https://satudata.jakarta.go.id/open-data/detail?kategori=dataset&page_url=data-jaringan-jalan-toll-provinsi-dki-jakarta&data_no=1)
- Headlines from search results (articles not opened):
  - A 2016 bisnis.com headline: "89,33 km Jalan Nasional Beralih Jadi Jalan Provinsi DKI". — [Bisnis.com, 2 Jul 2016](https://ekonomi.bisnis.com/read/20160702/45/563382/8933-km-jalan-nasional-beralih-jadi-jalan-provinsi-dki). The fetch failed, so only the headline is confirmed.
  - A Kontan headline: "Basuki: 4 ruas tol dalam kota tetap jadi jalan tol". — [Kontan](https://nasional.kontan.co.id/news/basuki-4-ruas-tol-dalam-kota-tetap-jadi-jalan-tol)
- Buku Kondisi Jalan Nasional 2025 S-1 has no DKI row. DKI is reported within BBPJN DKI Jakarta–Jawa Barat. — [Buku Kondisi Jalan Nasional 2025 S-1](https://data.pu.go.id/sites/default/files/Buku%20Kondisi%20Jalan%20Nasional%202025%20S-1.pdf)

**Dinas Bina Marga DKI and its Suku Dinas**
- **Dinas Bina Marga Provinsi DKI Jakarta**: Jl. Taman Jatibaru No 1, Gedung Dinas Teknis Jatibaru, Jakarta. Phone 021 384 4444. Email binamargadki@jakarta.go.id. Coordinates not published. — [binamarga.jakarta.go.id footer](https://binamarga.jakarta.go.id/)
- Its mandate is "urusan pemerintahan bidang pekerjaan umum dan penataan ruang pada suburusan bidang jalan dan penyelenggaraan penerangan jalan umum". It was split from Dinas PU DKI in 2015. — [binamarga.jakarta.go.id/profil/tentang-kami](https://binamarga.jakarta.go.id/profil/tentang-kami)
- **LKIP 2023 (Dinas Bina Marga DKI)**:
  - Each Suku Dinas Bina Marga Kota has Subbagian Tata Usaha; Seksi Perencanaan; Seksi Jalan, Jembatan, dan Kelengkapan Jalan; and Seksi Prasarana dan Sarana Utilitas Kota dan PJU.
  - Its program table names Sudin Bina Marga Jakarta Pusat, Utara, Selatan and Timur. Jakarta Barat and Kepulauan Seribu are not named there.
  - It gives no street addresses.
  - It cites Pergub 57/2022 (organisation) and Pergub 57/2023 (Unit Pelaksana).
  — [LKIP 2023 PDF](https://binamarga.jakarta.go.id/uploads/laporan_kip/LKIP%202023.pdf)

**National-level offices covering Jakarta**
- **BBPJN DKI Jakarta–Jawa Barat**:
  - Address: Jalan A.H Nasution No. 264, Sindanglaya, Kota Bandung 40294. The office is in Bandung, not Jakarta.
  - It handles national roads in DKI Jakarta and Jawa Barat through 8 Satuan Kerja. All are labelled "Provinsi Jawa Barat" on the page: PJN Wilayah I–V, Perencanaan dan Pengawasan, SKPD Dinas Bina Marga Prov. Jabar, and Jalan Bebas Hambatan.
  - No DKI-specific satker is named.
  — [Bina Marga balai directory](https://binamarga.pu.go.id/index.php/konten/en/profil/lokasi-dan-kontak-balai); [BBPJN DKI–Jabar Satuan Kerja](https://binamarga.pu.go.id/balai-dki-jabar/konten/organisasi/satuan-kerja)
- **Ditjen Bina Marga HQ**: Jl. Pattimura No. 20 Kebayoran Baru, Jakarta Selatan 12110, (021) 7203165. — [Bina Marga balai directory](https://binamarga.pu.go.id/index.php/konten/en/profil/lokasi-dan-kontak-balai)
- BPJT and Jasa Marga addresses are listed in Section 3.

**Data contacts and naming**
- Satu Data Jakarta contact (Diskominfotik, Bidang Data dan Statistik): Jl. Medan Merdeka Selatan, Jakarta Pusat. Help desk 0813 4000 3614. Email data.statistik@jakarta.go.id. — [satudata.jakarta.go.id](https://satudata.jakarta.go.id/search?q=jalan)
- Kota names used in DKI open data: "KOTA ADM. JAKARTA PUSAT", "KOTA ADM. JAKARTA UTARA", etc. — [Satu Data Jakarta status table](https://satudata.jakarta.go.id/open-data/detail?kategori=dataset&page_url=panjang-luas-dan-status-jalan-menurut-jenisnya-di-provinsi-dki-jakarta&data_no=1)

### Inferences
- **Routing rule for Jakarta (default):**
  - Toll → BUJT (+BPJT).
  - Ruas listed in Kepmen 1688 for DKI, if any non-toll → BBPJN DKI–Jabar.
  - Everything else public → Dinas Bina Marga DKI, routed to the Suku Dinas Bina Marga of the kota administrasi containing the point. The six administrative areas are Jakarta Pusat, Utara, Barat, Selatan, Timur and Kepulauan Seribu.
  - Private/estate roads (e.g. inside housing developments) → developer/pengelola, shown as "non-public".
- Lingkungan/gang roads in Jakarta may in practice be handled by kelurahan/kecamatan channels or by other dinas. The 2025 table shows "LOKAL" roads as PROVINSI status. Confirm with Dinas Bina Marga whether all LOKAL roads are Sudin-maintained.

### Gaps
- **List of national (non-toll) ruas in Jakarta** under Kepmen 1688/2022: not obtained. Neither "Jl. Jend. Sudirman is national" nor "is provincial" could be verified. Leave it unresolved until the lampiran is read.
- **Kepgub DKI on ruas jalan provinsi**: number, date and lampiran not found.
- **Addresses of the 6 Suku Dinas Bina Marga**: not found on binamarga.jakarta.go.id or in LKIP 2023. No addresses invented. Suggested source: the Pergub on Sudin organisation, the Sudin pages on each kota administrasi website, or a direct request to Dinas Bina Marga/PPID.
- **Coordinates** for every Jakarta office: none published in the sources visited. Left blank.
- **Kecamatan/kelurahan boundaries for Jakarta** (BIG, Dukcapil, Jakarta Satu): not verified, because Jakarta Satu's ArcGIS server was down and tanahair was unreachable.

## 5. National directory: BBPJN/BPJN offices, provincial Dinas, and an approach for 500+ kabupaten/kota

### Takeaway
Bina Marga publishes an up-to-date directory (dated 24 Feb 2025) of all 33 BBPJN/BPJN with addresses, and some phone numbers. The Buku Kondisi Jalan Nasional 2025 maps each province to its balai. A 2020 Bina Marga page lists addresses of about 30 provincial Dinas PU/Bina Marga. It is dated, and it is missing DKI, Aceh, Sulbar, Sultra and the four new Papua provinces. For kabupaten/kota there is no single directory. A seeded scrape-and-verify pipeline is needed.

### Cited Findings
**BBPJN/BPJN directory**

Addresses come from the [Bina Marga "Location and Contact of central Official and Balai" page (24 Feb 2025)](https://binamarga.pu.go.id/index.php/konten/en/profil/lokasi-dan-kontak-balai). Province coverage comes from [Buku Kondisi Jalan Nasional 2025 S-1](https://data.pu.go.id/sites/default/files/Buku%20Kondisi%20Jalan%20Nasional%202025%20S-1.pdf). No email, website or coordinates are given on the directory page; each balai has a sub-site at binamarga.pu.go.id/balai-<slug>/ (e.g. balai-dki-jabar, balai-jateng-diy, balai-jatim-bali, balai-banten, balai-kalbar, balai-kepri).

| Balai (as named) | Provinces (Buku 2025) | Address / phone (directory) |
|---|---|---|
| BBPJN Sumatera Selatan | Sumatera Selatan | Jl. Kol. H.M Noerdin Pandji No. 78 RT/RW 03/01 Km. 7 [Palembang] / (0711) 410754 |
| BBPJN DKI Jakarta – Jawa Barat | DKI Jakarta, Jawa Barat | Jalan A.H Nasution No. 264, Sindanglaya, Kota Bandung 40294 |
| BBPJN Sumatera Utara | Sumatera Utara | Jalan Sakti Lubis No. 1 Medan 20219 / (061) 7865103 |
| BBPJN Jawa Timur – Bali | Jawa Timur, Bali | Jl. Waru No. 20, Sidoarjo 61256 / (031) 8540196 |
| BBPJN Sulawesi Selatan | Sulawesi Selatan | Jl. Batara Bira No 14 Km 16 Baddoka, Makassar |
| BBPJN Kalimantan Timur | Kalimantan Timur | Jl. Syarifuddin Yoes, Komp. Perumahan Sepinggan Pratama Blok B No 7, Kec. Balikpapan Selatan 76115 |
| BBPJN Jawa Tengah – DIY | Jawa Tengah, DI Yogyakarta | Jl. Soekarno-Hatta Km 26 Karangjati, Kab. Semarang 50552 / (0298) 6023033 |
| BPJN Aceh | Aceh | Jalan Jenderal Sudirman No. 59, Banda Aceh 23239 |
| BPJN Riau | Riau | Jalan Sekolah No 41 Kubang Jaya, Siak Hulu, Kab. Kampar |
| BPJN Kepulauan Riau | Kepulauan Riau | Kompleks Perkantoran Terpadu Kementerian PUPR, Jl. Letjen S. Parman Blok R2 No 1-11, Tg. Piayu, Batam 29437 |
| BPJN Sumatera Barat | Sumatera Barat | Jl. Jati No 109, Kota Padang |
| BPJN Jambi | Jambi | Jalan R.B Siagian No. 01, Kel. Pasir Putih, Kota Jambi 36139 |
| BPJN Bengkulu | Bengkulu | Jalan Ir. Rutandi Sugianto Km 12, Pulau Baai, Bengkulu |
| BPJN Bangka Belitung | Kep. Bangka Belitung | Jalan Manunggal No. 5A Rt. 11, Desa Beluluk, Kec. Pangkalan Baru, Pangkalpinang |
| BPJN Lampung | Lampung | Jl. WR. Monginsidi No. 220, Teluk Betung Utara, Bandar Lampung 35211 |
| BPJN Banten | Banten | Jl. Raya Jakarta No. 4 Panancangan, Kec. Cipocok Jaya, Kota Serang |
| BPJN Nusa Tenggara Barat | NTB | Jl. Dr. Sudjono No. 106, Mataram |
| BPJN Nusa Tenggara Timur | NTT | Jl. Timor Raya Km. 18, Desa Tanah Merah, Kec. Kupang Tengah, Kupang |
| BPJN Kalimantan Barat | Kalimantan Barat | Jl. Veteran No. 1, Kota Pontianak 78121 |
| BPJN Kalimantan Selatan | Kalimantan Selatan | Jl. Brigjend. H. Hasan Basry, Komplek Bina Marga No. 13, Banjarmasin 70123 |
| BPJN Kalimantan Utara | Kalimantan Utara | Jl. Jendral Sudirman No. 84 RT04 RW04, Tanjung Selor 77212 |
| BPJN Kalimantan Tengah | Kalimantan Tengah | Jl. Tjilik Riwut Km. 3 No. 14, Palangka Raya 73111 |
| BPJN Sulawesi Utara | Sulawesi Utara | Jalan Raya Manado–Bitung Km 14, Suwaan, Kec. Kalawat, Kab. Minahasa Utara 95378 |
| BPJN Gorontalo | Gorontalo | Jln. Tinaloga, Desa Permata, Kec. Tilongkabila, Kab. Bone Bolango |
| BPJN Sulawesi Tengah | Sulawesi Tengah | Jl. MT. Haryono No. 10, Kel. Besusu Tengah, Kec. Palu Timur, Kota Palu 94118 |
| BPJN Sulawesi Tenggara | Sulawesi Tenggara | Jl. H. Latama Bunggulawa No. 11, Kel. Punggolaka, Kec. Puuwatu, Kota Kendari 93115 |
| BPJN Sulawesi Barat | Sulawesi Barat | Jl. Badau No 14 A, Mamuju |
| BPJN Maluku | Maluku | Jln. Ir. M. Putuhena, Wailela, Ambon |
| BPJN Maluku Utara | Maluku Utara | Jln. Jenderal Ahmad Yani No. 41, Kel. Tanah Raja, Kota Ternate Tengah |
| BPJN "Papua and Papua Mountains" (BPJN Jayapura) | Papua, Papua Pegunungan (Buku: "BBPJN Papua – Papua Pegunungan") | Kompleks Bina Marga Tanah Hitam, Jl. Abepantai, Abepura, Jayapura 99351 |
| BPJN Papua Selatan (BPJN Merauke) | Papua Selatan | Jl. RE Martadinata, Kompleks Bina Marga, Kec. Merauke, Kab. Merauke 99608 |
| BPJN Papua Barat | Papua Barat, Papua Barat Daya (Buku: "BBPJN Papua Barat – Papua Barat Daya") | Jl. Swapen, Manokwari Barat, Manokwari 98312 |
| BPJN Papua Tengah (BPJN Wamena) | Papua Tengah | Jl. Hom-hom No. 91, Wamena |

- The two sources disagree on Papua naming and grade (BPJN vs BBPJN) and on which balai covers Papua Pegunungan/Papua Tengah. The Buku's map panels list Papua, Papua Pegunungan, Papua Selatan and Papua Tengah together on a "Jayapura panel". Flag these as needing confirmation. — [balai directory](https://binamarga.pu.go.id/index.php/konten/en/profil/lokasi-dan-kontak-balai); [Buku 2025 S-1](https://data.pu.go.id/sites/default/files/Buku%20Kondisi%20Jalan%20Nasional%202025%20S-1.pdf)

**Provincial Dinas PU/Bina Marga**

Source: Bina Marga "Lokasi dan Kontak SNVT/SKPD", dated 30 Juli 2020. Names and addresses may be outdated, and the phone column in the source is malformed, so phones are omitted. — [binamarga.pu.go.id/index.php/konten/profil/lokasi-dan-kontak](https://binamarga.pu.go.id/index.php/konten/profil/lokasi-dan-kontak)

| Province | Dinas (2020 name) | Address |
|---|---|---|
| NTB | Dinas PU Prov. NTB | Jalan Majapahit No. 8, Mataram |
| Bali | Dinas PU Prov. Bali | Jalan Beliton No. 2, Denpasar |
| Jawa Tengah | Dinas PU Bina Marga dan Cipta Karya | Jl. Madukoro Blok AA–BB, Semarang |
| Kep. Bangka Belitung | Dinas PU | Jalan Pulau Bangka, Komplek Perkantoran Gubernur |
| Maluku | Dinas PU | Jln. D.I. Panjaitan No. 02, Ambon |
| Sulawesi Utara | Dinas PU | Jln. Tikala Ares No. 80 [Manado] |
| DI Yogyakarta | Dinas PU, Perumahan dan ESDM | Jl. Gowongan Kidul 61, Yogyakarta |
| Riau | Dinas PU dan Penataan Ruang | Jl. SM. Amin No. 92 [Pekanbaru] |
| Papua Barat | Dinas PU | Jl. Swapen [Manokwari] |
| Sumatera Selatan | Dinas PU Bina Marga | Jl. Letnan Kasnariansyah No. 14 Km. 4.5, Palembang |
| Kalimantan Utara | Dinas PU, Penataan Ruang, Perumahan dan Kawasan Permukiman | Jl. Agathis No. 001, Tanjung Selor |
| Kalimantan Selatan | Dinas PU | Jalan Dharma Praja, Kawasan Perkantoran Pemerintah Prov. Kalsel |
| Kalimantan Barat | Dinas PU dan Penataan Ruang | Jalan M. Hambal No. 01, Pontianak |
| Maluku Utara | Dinas PU | Jalan Raya Km 40, Kel. Balbar, Sofifi |
| Lampung | Dinas PU dan Penataan Ruang | Jl. Zainal Abidin Pagar Alam Km. 11 |
| Jawa Timur | Dinas Bina Marga | Jl. Raya Waru No. 20, Sidoarjo |
| Jambi | Dinas PU | Jl. H. Agus Salim No. 2, Kota Baru, Jambi |
| NTT | Dinas PU | Jl. Basuki Rahmat Gedung A No. I, Kupang |
| Banten | Dinas Bina Marga dan Tata Ruang | Jalan K.H. Abdul Fatah Hasan No. 25, Serang |
| Sulawesi Selatan | Dinas PU | Andi Pangerang Pettarani No. 90 [Makassar] |
| Sumatera Barat | Dinas Prasarana Jalan | Jalan Taman Siswa No. 1, Padang (skpd.prasjal.sumbar@gmail.com) |
| Kalimantan Tengah | Dinas PU | Jalan S. Parman No. 03, Palangka Raya |
| Kepulauan Riau | Dinas PU | Pulau Dompak, Gedung C-2 |
| Sumatera Utara | Dinas Bina Marga dan Bina Konstruksi | Jl. Busi No. 7 D, Kel. Sitirejo 1, Medan Kota |
| Kalimantan Timur | Dinas PU, Penataan Ruang, dan Perumahan Rakyat | Jl. Tengkawang No. 01, Samarinda |
| Papua | Dinas PU | Jl. Sumatera No. 15, Jayapura |
| Sulawesi Tengah | Dinas Permukiman dan Prasarana Wilayah | Jln. Yojokodi No. 03, Palu |
| Bengkulu | Dinas PU | Jl. Prof. Dr. Hazairin SH No. 901, Bengkulu |
| Gorontalo | Dinas PU | Jl. Prof. Dr. Aloei Saboe No. 92 |
| Jawa Barat | Dinas Bina Marga | Jl. Laswi No 1, Bandung |
| DKI Jakarta (from own site, 2026) | Dinas Bina Marga | Jl. Taman Jatibaru No 1, Gedung Dinas Teknis Jatibaru, Jakarta; 021 384 4444; binamargadki@jakarta.go.id |

Sources: [Bina Marga SNVT/SKPD list](https://binamarga.pu.go.id/index.php/konten/profil/lokasi-dan-kontak); [binamarga.jakarta.go.id](https://binamarga.jakarta.go.id/)

- The BBPJN DKI–Jabar satker list includes "Satuan Kerja Perangkat Daerah Dinas Bina Marga Provinsi Jawa Barat". This suggests provincial Dinas are also registered as SKPD/satker contacts in Bina Marga systems. — [BBPJN DKI–Jabar Satuan Kerja](https://binamarga.pu.go.id/balai-dki-jabar/konten/organisasi/satuan-kerja)

### Inferences
- **Approach for the 38 provinces:**
  1. Seed from the 2020 Bina Marga list (30 provinces) plus DKI.
  2. Add Aceh, Sulawesi Barat, Sulawesi Tenggara, Papua Selatan, Papua Tengah, Papua Pegunungan and Papua Barat Daya.
  3. Verify each against the province's own website (typically `pu.<prov>prov.go.id`, `dinaspupr.<prov>prov.go.id` or `binamarga.<prov>prov.go.id`) and the JDIH SOTK Pergub. Many provinces renamed or merged dinas after 2020 SOTK changes.
  4. Store `source_url`, `verified_at` and `verified_by` per record.
- **Approach for 514+ kabupaten/kota:**
  1. Take the official list of kabupaten/kota and their codes from the Kemendagri kode wilayah decree (see Section 6).
  2. Derive candidate domains (`<nama>kab.go.id` / `<nama>kota.go.id`) and crawl "kontak"/"alamat" pages of the Dinas PUPR/PU/Bina Marga.
  3. Cross-check against JDIH/SOTK and PPID pages. Satu Data CKAN portals (e.g. Denpasar) sometimes publish road status tables.
  4. Allow admin and crowd corrections with moderation.
  5. Until verified, route to the Pemkab/Pemkot main address or the LAPOR!/SP4N channel rather than inventing a dinas address.
- Keep the head-of-office names on the balai page out of the routing table, since they change often. Keep only office-level records.

### Gaps
- Phone/email/website per balai is not given for most balai on the directory page. It would need each balai sub-site.
- Provincial Dinas data for Aceh, Sulbar, Sultra and the new Papua provinces is missing. All 2020 entries need re-verification.
- Did not find SIPD or Kemendagri endpoints listing kabupaten/kota dinas addresses (search budget exhausted).

## 6. Administrative boundaries datasets for routing (BIG, GADM, geoBoundaries, Kemendagri codes)

### Takeaway
geoBoundaries gbOpen for Indonesia is usable but dated. ADM1 comes from OSM 2017 with 34 provinces, so it predates the 2022 Papua split to 38. ADM2 has 519 units from BPS/OCHA 2020. There is no ADM3/ADM4. For current boundaries and codes, use BIG (Ina-Geoportal) batas wilayah and the latest Kemendagri kode wilayah decree. Neither could be verified in this session.

### Cited Findings
- geoBoundaries API (gbOpen/IDN/ALL), as returned on 2026-11-01. Source data update date for all levels: 19 Jan 2023.

  | Level | Source | Licence | Year | Units | Download |
  |---|---|---|---|---|---|
  | ADM0 | OpenStreetMap / Wambacher | ODbL 1.0 | 2017 | 1 | `github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IDN/ADM0/geoBoundaries-IDN-ADM0.geojson` |
  | ADM1 | OpenStreetMap / Wambacher | ODbL 1.0 | 2017 | 34 | `github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IDN/ADM1/geoBoundaries-IDN-ADM1.geojson` |
  | ADM2 | BPS, WFP, OCHA ROAP | CC BY 3.0 IGO | 2020 | 519 | `github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IDN/ADM2/geoBoundaries-IDN-ADM2.geojson` |

  No ADM3/ADM4 were returned. — [geoBoundaries API IDN](https://www.geoboundaries.org/api/current/gbOpen/IDN/ALL/)
- The Buku Kondisi Jalan Nasional 2025 already uses the post-2022 provinces (Papua Selatan, Papua Tengah, Papua Pegunungan, Papua Barat Daya). Province boundaries must therefore reflect 38 provinces for balai routing. — [Buku 2025 S-1](https://data.pu.go.id/sites/default/files/Buku%20Kondisi%20Jalan%20Nasional%202025%20S-1.pdf)
- The Jakarta Satu geoportal is the DKI spatial node ("Simpul Jaringan"), but its ArcGIS server was unavailable when tested. — [Jakarta Satu](https://jakartasatu.jakarta.go.id/); [ArcGIS REST](https://jakartasatu.jakarta.go.id/server/rest/services)

### Inferences
- For a 2026 build:
  - Use BIG batas wilayah (desa/kelurahan level, if downloadable from tanahair) as the primary geometry.
  - Key every polygon by the Kemendagri `kode_wilayah` (2-digit province, 4-digit kab/kota, 6-digit kecamatan, 10-digit desa/kelurahan).
  - Fall back to geoBoundaries ADM2 (CC BY 3.0 IGO) and OSM `boundary=administrative` relations for kecamatan/kelurahan.
  - Patch the 2022 Papua split with OSM or BIG.
- For Jakarta, the kota administrasi polygon (for Suku Dinas routing) can be dissolved from kelurahan polygons by the first 4 digits of the code (31.71–31.75, 31.01 Kep. Seribu). This code pattern is from background knowledge and needs verification against the decree.
- GADM licences are typically non-commercial only (background knowledge, not verified here). Prefer geoBoundaries, BIG or OSM for an app that may be redistributed.

### Gaps
- **Kemendagri kode wilayah**: the latest decree (believed to be a 2025 Kepmendagri replacing Kepmendagri 100.1.1-6117/2022) could not be confirmed, because the search budget was exhausted. Its number, date and data download (e.g. a CSV from Kemendagri/Dukcapil) need verification. Note: the coordinator's suggested "Permendagri 100/2023" was not verified.
- **BIG batas wilayah** download URL, scale and licence on tanahair.indonesia.go.id: not verified (unreachable).
- GADM version and licence for IDN: not checked.

## 7. Recommended data model, pipeline, routing algorithm, map confidence display, and correction workflow

### Takeaway
Build a segment-level status layer by joining several sources in a fixed precedence order (official SK > Bina Marga/BPJT lists > regional open data > OSM tags heuristic > admin-boundary default). Store source and confidence for every segment. Route reports by snapping to the nearest segment, with an admin-boundary fallback. Show confidence visually on the map and let users and admins submit status corrections with evidence (SK citation).

### Cited Findings
- Official status sources are lists rather than geometry: Kepmen 1688/2022 PDF; Satu Data Jakarta tables; BPJT ruas list. — [NSPK 1688](https://binamarga.pu.go.id/index.php/nspk/detail/keputusan-menteri-pupr-nomor-430kptsm2022-tentang-penetapan-ruas-jalan-menurut-statusnya-sebagai-jalan-nasional); [Satu Data Jakarta](https://satudata.jakarta.go.id/open-data/detail?kategori=dataset&page_url=panjang-luas-dan-status-jalan-menurut-jenisnya-di-provinsi-dki-jakarta&data_no=1); [BPJT](https://bpjt.pu.go.id/daftar-ruas-jalan-tol-dan-bujt/)
- OSM highway class is contested in Indonesia, and one proposal is a separate authority/designation tag. — [OSM Community thread](https://community.openstreetmap.org/t/road-classification-in-indonesia/145030)
- Regional status can shift after national SK changes (Kepri/Batam example). — [Ombudsman](https://ombudsman.go.id/artikel/r/pwkinternal--implikasi-kontroversi-kepmen-pupr-nomor-1688kptsm2022-tentang-penetapan-ruas-jalan-)
- Jakarta Satu has an "Urun Data" (crowd data contribution) service. This is a possible channel for pushing verified corrections back to the province. — [Jakarta Satu](https://jakartasatu.jakarta.go.id/)

### Inferences
**Data model** (PostgreSQL/PostGIS)

- `authority`
  - Fields: `id`, `level` (enum: `kementerian`, `balai_nasional`, `bpjt`, `bujt`, `provinsi_dinas`, `provinsi_sudin` [DKI only], `kabkota_dinas`, `desa`, `private`), `name`, `parent_id` (e.g. Sudin → Dinas Bina Marga DKI; BBPJN → Ditjen Bina Marga; BUJT → BPJT), `kode_wilayah` (coverage), `address`, `lat`, `lon` (nullable, never guessed), `phone`, `email`, `website`, `complaint_channel`, `source_url`, `verified_at`.
  - Also `coverage` (MultiPolygon or list of kode_wilayah) for authorities defined by area (balai, Sudin, kab/kota dinas).
- `road_segment`
  - Geometry and identity: `id`, `geom` (LineString, EPSG:4326), `osm_way_id` (nullable), `name`, `ref`.
  - Status and authority: `status` (enum: `nasional`, `tol`, `provinsi`, `kabupaten`, `kota`, `desa`, `khusus`/`private`, `unknown`), `authority_id`, `function` (JAP/JKP/JKS/lokal, optional).
  - Provenance: `no_ruas` (official ruas number when matched), `legal_basis` (e.g. "Kepmen PUPR 1688/KPTS/M/2022"), `source` (enum: `sk_official`, `bina_marga_list`, `bpjt_list`, `regional_open_data`, `osm_tag_heuristic`, `admin_default`, `user_correction`).
  - Quality: `confidence` (0–1 or enum high/medium/low), `valid_from`, `valid_to`, `last_reviewed_at`.
- `ruas_official`: one row per official ruas from each SK — `no_ruas`, `nama_ruas`, `panjang_km`, `status`, `province_code`, `kabkota_code`, `legal_basis`, `page_ref`. It joins to `road_segment` through a `segment_ruas_match` table with `match_method` and `match_score`.
- `status_correction`: `id`, `segment_id`, `proposed_status`, `proposed_authority_id`, `evidence_url` / `evidence_file` (SK page, photo of signboard), `submitted_by`, `role` (citizen/official/admin), `state` (pending/accepted/rejected), `reviewer`, `reviewed_at`, `note`.

**Pipeline**

1. **Geometry**: extract OSM Indonesia (Geofabrik PBF or Overpass per province). Keep drivable `highway=*` ways and split them at kota/kab boundaries.
2. **Toll**: match `highway=motorway|motorway_link` or `toll=yes` to BPJT ruas by name/ref/operator alias. Set `status=tol`, `authority=BUJT`, confidence high.
3. **National**:
   - Parse the Kepmen 1688/2022 lampiran into `ruas_official`.
   - Match to OSM trunk/primary ways by name and ref within the province, using endpoint towns and lengths. Check that summed matched length is within about ±10% of `panjang`.
   - Matched segments get `status=nasional`, authority = the balai covering that province (Section 5 table), confidence high or medium depending on match score.
4. **Provincial**: parse each Kepgub lampiran similarly. For DKI, if no Kepgub ruas list is obtained, use the default (all non-toll, non-national public roads → Dinas Bina Marga DKI → Sudin by kota polygon) at medium confidence. This rests on the 2025 Satu Data Jakarta table showing PROVINSI status. Validate km totals per kota against that table.
5. **Kab/kota**: parse SK Bupati/Walikota where available. Otherwise use the heuristic from OSM class (Section 2) plus admin boundary at low confidence.
6. **QA**: compare km by status per province/kota against official totals (Buku Kondisi for national; Satu Data/BPS for regional). Flag gaps.

**Routing algorithm for a report point**

1. Snap to the nearest `road_segment` within N metres. Suggested values: 15–25 m in dense urban Jakarta, 50 m in rural areas. Use the report's GPS accuracy and choose the larger.
2. If several candidates are within N (overpasses, toll vs arterial below, parallel service roads):
   - Prefer the one matching the reported "jalan tol / bukan tol" toggle and the bearing of travel.
   - Otherwise prefer the higher-confidence segment and ask the user to confirm ("Apakah ini di jalan tol?").
3. If nothing is within N: use the admin-boundary fallback. Find the kelurahan via point-in-polygon, assign the default authority for that area (DKI → Sudin of the kota; elsewhere → kab/kota Dinas), and mark `confidence=low`.
4. Return the authority chain, e.g. Sudin → Dinas Bina Marga DKI, or BUJT → BPJT, or BPJN → Ditjen Bina Marga. Include contact and complaint channel.

**Showing confidence on the map**

- Colour by authority level, e.g. nasional / tol / provinsi / kab-kota / desa / unknown, with a colour-blind-safe palette.
- Encode confidence with line style: solid = SK-matched (high), dashed = list/heuristic (medium), dotted/translucent = admin default (low).
- Add a legend toggle "tampilkan hanya data terverifikasi".
- The segment popup shows `status`, `authority`, `legal_basis`, `source`, `last_reviewed_at`, and a "Laporkan kesalahan status" button.

**Correction workflow**

- Citizens propose a status/authority change with evidence (SK page reference, signboard photo, official reply letter).
- Verified officials (by `@*.go.id` email or invite) and admins review.
- Accepted corrections create a new segment version (`valid_from`) rather than overwriting, so there is an audit trail.
- Periodically export accepted corrections to OSM (respecting community norms; status would go in a separate tag, not `highway=*`) and to Jakarta Satu "Urun Data" or the relevant dinas.
- Re-run SK parsing when a new Kepmen/Kepgub appears. Watch the Bina Marga NSPK list and JDIH.

### Gaps
- No public example was found of an Indonesian agency publishing segment-level status geometry, so the match thresholds (±10% length, N metres) are design assumptions, not validated values.
- I could not test the Overpass query or measure OSM name/ref completeness in Jakarta, which determines how well the SK-to-OSM join would work.
