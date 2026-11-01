# 04 · Authority Routing: who owns this road?

**Goal:** a citizen's verified report reaches the office that is **legally responsible** for that road, with the legal basis shown and an honest confidence level. The app never asks the citizen whose road it is.

**Rule zero:** status comes from the **decree (SK)**, not from the road's name, its size or its OSM tag. OSM is only a fallback, and it is always shown as such.

Status words used in this document and in `data/*`:

| Label | Meaning |
|---|---|
| **VERIFIED** | Read from an official or primary source on the stated date. |
| **TODO_VERIFY** | Not confirmed. The source to fetch is named. Do not present it as fact. |
| **DESIGN** | A product choice (threshold, colour, UX). Not a legal fact. Configurable. |

Companion files:
- `data/road_status_rules.json`: status enum, authority mapping, heuristics, Jakarta overrides, legend.
- `data/authorities_national_balai.csv`: 33 BBPJN/BPJN offices.
- `data/authorities_provincial_dinas.csv`: 38 provincial Dinas.
- `data/authorities_jakarta.csv`: the full Jakarta chain.
- `data/toll_operators_jakarta.csv`: 23 Jakarta-area toll ruas and their BUJT.
- `scripts/overpass_jakarta_roads.ql`, `scripts/build_road_registry.py`, `scripts/build_road_registry.md`: the data pipeline.

---

## 1. The law in one page

| Instrument | What it decides for routing | Key articles | Source | Status |
|---|---|---|---|---|
| **UU 38/2004 jo. UU 2/2022** (Jalan) | Five public road classes: nasional, provinsi, kabupaten, kota, desa. Toll roads are part of national roads. Each level of government runs its own class. The government must set status by decree. Desa roads belong to the Pemerintah Desa. Jalan khusus are run by their owner. Every penyelenggara must do preservasi. The public has a right to give input and get information. | Ps 9(1)–(10), 9(2); 14(1); 15(1); 16(1)–(2); 16A(1); 35G(2); 57A–57D; 62(1) | [UU 2/2022 PDF](https://peraturan.go.id/files/uu2-2022.pdf); [BPK JDIH](https://peraturan.bpk.go.id/Details/195878/uu-no-2-tahun-2022) | VERIFIED |
| **PP 34/2006** (Jalan) | Who signs each status decree: Menteri (nasional), Gubernur (provinsi), Bupati (kabupaten **and desa**), Walikota (kota). Saluran tepi jalan and trotoar are part of the road. Maintenance is the "prioritas tertinggi". Citizens may report misuse of road space. A jalan khusus becomes a kab/kota road only after handover and designation. | Ps 62(1)–(6); 33–37; 34(4); 97; 120; 123–124 | [PP 34/2006 PDF](https://peraturan.go.id/files/pp34-2006.pdf) | VERIFIED. No replacing PP found despite UU 2/2022 Ps 67A (TODO_VERIFY on JDIH). |
| **Kepmen PUPR 1688/KPTS/M/2022** | **The list of national road ruas currently in force.** Non-toll national roads total 47,604.34 km and toll 2,841.12 km. It replaced Kepmen 290/KPTS/M/2015. Published 03 Apr 2023, status "Berlaku", one PDF of 51.58 MB (MD5 4776c9c4158abea64ee1fde3a10538a1). | whole lampiran | [Bina Marga NSPK page](https://binamarga.pu.go.id/index.php/nspk/detail/keputusan-menteri-pupr-nomor-430kptsm2022-tentang-penetapan-ruas-jalan-menurut-statusnya-sebagai-jalan-nasional); [Buku Kondisi Jalan Nasional 2025 S-1](https://data.pu.go.id/sites/default/files/Buku%20Kondisi%20Jalan%20Nasional%202025%20S-1.pdf); [Ombudsman Kepri](https://ombudsman.go.id/artikel/r/pwkinternal--implikasi-kontroversi-kepmen-pupr-nomor-1688kptsm2022-tentang-penetapan-ruas-jalan-) | VERIFIED as the decree. **Lampiran not opened**, so the DKI ruas list is TODO_VERIFY. |
| Kepmen PUPR 430/KPTS/M/2022 | **Not a status decree.** It sets road *function* (JAP / JKP-1). The NSPK URL slug says "430" but the page holds 1688. Never route on 430. | — | [NSPK list](https://binamarga.pu.go.id/index.php/nspk/keputusan-menteri) | VERIFIED |
| Kepmen PUPR 367/KPTS/M/2023 | Rencana Umum Jaringan Jalan Nasional 2020–2040. Planning, not routing. | — | NSPK list | VERIFIED |
| **Perpres 170/2024** | Kementerian PU (split from PUPR on 5 Nov 2024). Ditjen Bina Marga runs national roads. The Inspektorat Jenderal is its APIP. | Ps 5, 7, 15–16, 41–42 | [pasal.id](https://pasal.id/peraturan/perpres/perpres-no-170-tahun-2024) | VERIFIED |
| **Permen PU 1/2025** (UPT organisation) | Bina Marga field units: **7 BBPJN Tipe A, 2 BBPJN Tipe B, 24 BPJN, 4 Balai Teknik**. Each balai has Bagian Umum & TU, Bidang Keterpaduan, Bidang Pembangunan and **Bidang Preservasi**. The 33 units match the Buku Kondisi Jalan names. | lampiran | [Renstra BKJTK 2025–2029](https://binamarga.pu.go.id/balai-kjtk/silat/uploads/documents/1786331203000-renstra-bkjtk-2025-2029-final.pdf); [Buku 2024 S-2](https://data.pu.go.id/sites/default/files/Buku%20Kondisi%20Jalan%20Nasional%202024%20S-2%20TTD.pdf) | Counts VERIFIED (secondary). **Lampiran (seats, which two are Tipe B, Papua coverage) TODO_VERIFY.** |
| **Permen PU 2/2025** (Wewenang Penyelenggaraan Jalan Tol, 17 Oct 2025) | Splits toll authority. **BUJT**: preservasi, meeting SPM, self-evaluation. **BPJT**: under the Minister; supervises concessions and SPM compliance. **DJBM**: laik fungsi certificate. **No provision on user complaints.** Revokes Permen PUPR 20/2020. | Ps 1 angka 7; 6(2); Lampiran C.1 items 9–15; D.3 | [Permen PU 2/2025](https://jdih.kemenkoinfra.go.id/cfind/source/files/permen-pu/2025pmpu2.pdf) | VERIFIED |
| Permen PU 16/PRT/M/2014 (SPM Jalan Tol) | 8 substansi; BUJT must comply; BPJT supervises; no sanctions. Lampiran I (pothole thresholds and times) not retrieved. A 2026 replacement (3 parameters, 64 indicators, fines) targeted mid-Oct 2026; enactment not verified. | Ps 3, 5, 6 | [BPK](https://peraturan.bpk.go.id/Download/119238/PermenPU16-2014.pdf); [detikFinance 9 Jul 2026](https://finance.detik.com/infrastruktur/d-8567118/aturan-spm-tol-dikebut-bujt-melanggar-siap-siap-didenda) | Body VERIFIED; pothole SLA TODO_VERIFY (see §4.6) |
| **Pergub DKI 153/2019** (Dinas Bina Marga) | Dinas Bina Marga DKI covers roads, bridges, road furniture, city utilities **and PJU**. It works through a **Suku Dinas per kota administrasi** (coordinated by the Walikota) and a non-structural **Satuan Pelaksana Bina Marga Kecamatan** (coordinated by the Camat). | Ps 3, 4, 31–38 | [pasal.id](https://pasal.id/peraturan/pergub/pergub-prov-dki-jakarta-no-153-tahun-2019) | VERIFIED as "Berlaku". LKIP 2023 also cites Pergub 57/2022 and 57/2023, and DKI is now "Daerah Khusus Jakarta" (UU 2/2024). Whether 153/2019 has been amended is TODO_VERIFY. |
| UU 22/2009 (LLAJ) | The penyelenggara must repair road damage that can cause accidents "segera dan patut". If it cannot yet, it must put up signs. Criminal sanctions apply (up to 5 years if someone dies). | Ps 24(1)–(2); 273 | [Hukumonline 18 Feb 2026](https://www.hukumonline.com/berita/a/mengulik-tanggung-jawab-hukum-jalan-berlubang-lt699592a17b4f9?page=2) | VERIFIED (secondary) |

**Why the registry must be versioned.** Status changes by decree. Under Kepmen 1688/2022, Kota Batam lost all its national segments. After Kepgub Kepri 485 (3 Apr 2023), it had no provincial segments either, so Pemkot Batam now handles all its roads ([Ombudsman Kepri](https://ombudsman.go.id/artikel/r/pwkinternal--implikasi-kontroversi-kepmen-pupr-nomor-1688kptsm2022-tentang-penetapan-ruas-jalan-)). Every segment therefore stores its SK and `valid_from`, and old versions are kept.

**Construction vs maintenance.** A higher level may *take over construction* of a lower-level road (UU 2/2022 Ps 15(3), 16(4), 16A(3)). That does **not** change status. Model assisted or taken-over projects as an overlay on the segment, not a status change.

---

## 2. Status → authority → office

| Status | Legal authority (penyelenggara) | Office that receives the report | Watcher / oversight |
|---|---|---|---|
| **TOL** | BUJT holding the PPJT concession | BUJT operator desk, or its regional office where known (e.g. Jasamarga Metropolitan Tollroad, Cililitan) | **BPJT**: read, flag, escalate. **Never closes BUJT jobs.** KPK (2023) found five BPJT officials sitting as BUJT commissioners. |
| **NASIONAL** | Kementerian PU, Ditjen Bina Marga | BBPJN/BPJN covering the province → (Satker PJN → PPK ruas, TODO_VERIFY) | Itjen Kementerian PU; Ombudsman |
| **PROVINSI** | Pemerintah Provinsi | Provincial Dinas PU/Bina Marga → UPTD (TODO_VERIFY per province). **DKI: Dinas Bina Marga → Sudin [kota] → Satpel [kecamatan].** | Inspektorat Provinsi; Ombudsman Perwakilan |
| **KABUPATEN / KOTA** | Pemkab / Pemkot | Dinas PU/PUPR/Bina Marga of the kab/kota (directory TODO_VERIFY). If the dinas is not yet verified, send to the Pemkab/Pemkot main office or via SP4N-LAPOR!. Never use an invented dinas address. | Inspektorat Kab/Kota |
| **DESA** | Pemerintah Desa (UU 2/2022 Ps 16A) | Kepala Desa / Pemerintah Desa, with a copy to the Dinas PU kabupaten (guidance role) | Inspektorat Kabupaten |
| **KHUSUS** | Owner (BUMN/BUMD/company/community) | None. The citizen sees: "This looks like a private road. The owner maintains it." | — |
| **UNKNOWN** | — | Admin-boundary default (§4.4), LOW | — |

**Defect-type overrides** (they change the unit, not the status):
- **PJU (street lights) in DKI:** Dinas Bina Marga (Bidang Penerangan Jalan dan Sarana Umum / Sudin Seksi PJU). Pergub 153/2019. VERIFIED.
- **PJU, rambu, marka, APILL outside DKI:** often Dishub or Perkim. TODO_VERIFY.
- **Saluran tepi jalan / trotoar:** the road authority by default, because both are part of the ruang manfaat jalan (PP 34/2006 Ps 34). In DKI, the roles of Dinas SDA and PPSU kelurahan are TODO_VERIFY.

---

## 3. Data model (PostgreSQL + PostGIS)

`authority` is the **legal entity** responsible by status (e.g. Pemprov DKI, Kementerian PU, a BUJT). `office` is the **routable unit** that receives the case (Sudin, Satpel, BBPJN, Satker, BUJT regional office). This split lets one authority have many offices, and a Satpel move between Sudin without touching legal data.

```sql
CREATE TYPE road_status AS ENUM ('NASIONAL','TOL','PROVINSI','KABUPATEN','KOTA','DESA','KHUSUS','UNKNOWN');
CREATE TYPE confidence  AS ENUM ('HIGH','MEDIUM','LOW');
CREATE TYPE verify_status AS ENUM ('VERIFIED','TODO_VERIFY');
CREATE TYPE status_source AS ENUM ('user_correction','sk_official','bpjt_list','bina_marga_list',
                                   'regional_open_data','osm_tag_heuristic','admin_default');

CREATE TABLE sk_reference (                     -- every legal or list source we route on
  id               text PRIMARY KEY,            -- e.g. 'kepmen-pupr-1688-2022'
  instrument_type  text NOT NULL,               -- KEPMEN|KEPGUB|KEPBUP|KEPWAL|PERMEN|PERGUB|BPJT_LIST|OPEN_DATA
  number           text,                        -- '1688/KPTS/M/2022'
  title            text NOT NULL,
  issuer           text,                        -- 'Menteri PUPR'
  date_signed      date,
  valid_from       date,
  valid_to         date,                        -- null = in force
  in_force_status  text NOT NULL DEFAULT 'UNKNOWN', -- IN_FORCE|SUPERSEDED|UNKNOWN
  supersedes_id    text REFERENCES sk_reference(id),
  url              text,
  file_hash        text,                        -- 'md5:4776c9c4...' or 'sha256:...'
  checked_at       date NOT NULL,
  verify_status    verify_status NOT NULL,
  notes            text
);

CREATE TABLE authority (                        -- legal road authority (penyelenggara)
  id               text PRIMARY KEY,            -- 'pemprov-dki', 'kementerian-pu', 'jm-holding'
  name             text NOT NULL,
  serves_status    road_status[] NOT NULL,
  parent_id        text REFERENCES authority(id),
  regulator_id     text REFERENCES authority(id), -- BUJT -> 'bpjt'
  jurisdiction     text[],                      -- Kemendagri kode_wilayah list
  legal_basis      text,
  source_url       text, source_date date,
  verify_status    verify_status NOT NULL
);

CREATE TABLE office (                           -- routable unit; rows come from data/authorities_*.csv
  id               text PRIMARY KEY,            -- 'sudin-bm-jaktim', 'bbpjn-jabar-dki', 'jm-metro'
  authority_id     text REFERENCES authority(id),
  parent_office_id text REFERENCES office(id),
  office_type      text NOT NULL,               -- BBPJN|BPJN|SATKER|DINAS_PROVINSI|SUKU_DINAS|SATPEL_KECAMATAN|UPTD|DINAS_KABKOTA|BUJT|BUJT_REGIONAL_OFFICE|REGULATOR_TOL|DESA
  name             text NOT NULL,
  coverage_geom    geometry(MultiPolygon,4326), -- area-defined offices (Sudin, Satpel, balai by province)
  coverage_codes   text[],                      -- or kode_wilayah list
  address text, phone text, email text, website text,
  complaint_channel text,
  lat double precision, lon double precision,   -- NULL unless published; never geocoded silently
  legal_basis      text,
  source_url       text NOT NULL, source_date date NOT NULL,
  verify_status    verify_status NOT NULL,
  verified_at      timestamptz, verified_by text,
  active           boolean NOT NULL DEFAULT true
);

CREATE TABLE road_segment (                     -- versioned; never updated in place
  id               text NOT NULL,
  version          int  NOT NULL,
  geom             geometry(LineString,4326) NOT NULL,
  osm_way_id       bigint,
  name text, ref text, highway text, layer int DEFAULT 0, bridge text,
  kode_wilayah     text,                        -- kecamatan/kelurahan code where the segment lies
  kota_slug        text,                        -- DKI only: jakpus|jakut|jakbar|jaksel|jaktim|kepseribu
  status           road_status NOT NULL,
  function         text,                        -- JAP/JKP/JKS/lokal (optional; NOT status)
  authority_id     text REFERENCES authority(id),
  office_id        text REFERENCES office(id),  -- default office; Satpel resolved at routing time
  sk_reference_id  text REFERENCES sk_reference(id),
  no_ruas          text,
  source           status_source NOT NULL,
  rule_id          text,                        -- e.g. 'DKI-DEFAULT-PROVINSI', 'SK-MATCH'
  confidence       confidence NOT NULL,
  match_score      real,
  valid_from       date NOT NULL,
  valid_to         date,
  last_reviewed_at timestamptz,
  PRIMARY KEY (id, version)
);
CREATE INDEX road_segment_geom_live ON road_segment USING gist (geom) WHERE valid_to IS NULL;

CREATE TABLE ruas_official (                    -- one row per ruas in an SK lampiran
  id text PRIMARY KEY, sk_reference_id text REFERENCES sk_reference(id),
  no_ruas text, nama_ruas text, panjang_km numeric, status road_status,
  province_code text, kabkota_code text, page_ref text
);
CREATE TABLE segment_ruas_match (
  segment_id text, segment_version int, ruas_id text REFERENCES ruas_official(id),
  match_method text, match_score real, accepted boolean, reviewed_by text, reviewed_at timestamptz
);

CREATE TABLE status_correction (
  id text PRIMARY KEY, segment_id text NOT NULL, segment_version int NOT NULL,
  proposed_status road_status, proposed_authority_id text, proposed_office_id text,
  sk_reference_id text,                          -- required to ACCEPT
  evidence_files text[],                         -- SK page photo, signboard, official reply letter
  submitted_by text, submitter_role text,        -- CITIZEN|COORDINATOR|ADMIN|AGENCY_HEAD
  state text NOT NULL DEFAULT 'PENDING',         -- PENDING|NEEDS_SECOND_CONFIRM|ACCEPTED|REJECTED
  reviewer_1 text, reviewer_2 text, reviewed_at timestamptz, note text
);

CREATE TABLE routing_decision (                  -- one per report; also hashed into the audit log
  report_id text PRIMARY KEY, decided_at timestamptz NOT NULL,
  inputs jsonb NOT NULL,                         -- lat, lon, gps_accuracy_m, toll_toggle, bearing, defect_type
  registry_version text NOT NULL,
  candidates jsonb NOT NULL,                     -- top 5 with distances
  segment_id text, segment_version int,
  status road_status, authority_id text, office_id text, office_chain text[],
  confidence confidence NOT NULL, rule_ids text[] NOT NULL, basis text NOT NULL
);
```

**Migration from the current code.** Today `server/services/authorityResolver.ts` reads `config/authorities/pilot.json` and calls Nominatim and Overpass live. Changes:
1. Load `data/authorities_*.csv` into `office` / `authority`. Create one BUJT `authority` + `office` row per distinct `bujt_id` in `data/toll_operators_jakarta.csv` (name, address, call center). Add a sentinel authority `bujt-unmatched` for toll ways that match no BPJT ruas; these route to the `bpjt` queue. The ids `bbpjn-jabar-dki`, `dbm-dki`, `sudin-bm-*` and `dbmpr-jabar` are kept, so existing cases still resolve.
2. Replace the live Overpass call with a PostGIS query on `road_segment`. Keep live OSM only as a dev fallback.
3. Extend `ResolvedAuthority` (shown in §4.5).
4. **Behaviour change:** in DKI, `highway=trunk` no longer routes to BBPJN at MEDIUM. It becomes PROVINSI, LOW, flagged `POSSIBLE_NATIONAL`, until the Kepmen 1688 DKI list is loaded (§9).

---

## 4. Routing algorithm

### 4.1 Inputs
`lat`, `lon` and `gps_accuracy_m` come from the live capture. The citizen answers one optional toggle, "Are you on a toll road? yes / no / not sure" (asked only when a toll road is within the search radius). `bearing_deg` comes from device motion if available. `defect_type` comes from CV and the citizen (pothole, crack, drainage, PJU…). For long-damage mode, the walked trace is used: route by the trace's midpoint and check that ≥ 80 % of the trace snaps to the same segment status (DESIGN).

### 4.2 Steps

```
r = max(snap_max_m, min(gps_accuracy_m, snap_hard_cap_m))      # default 25 m, cap 50 m
C = live road_segment rows within r of the point (PostGIS ST_DWithin on geography)

if C is empty:                                                  # 4.4 fallback
    area = point-in-polygon(kecamatan/kota/kab)                 # kode_wilayah
    office = default office for area (DKI -> sudin-bm-<kota> -> satpel; elsewhere -> kab/kota dinas or Pemda)
    return {status: area default or UNKNOWN, confidence: LOW, ask_citizen: "confirm road", coordinator: "confirm office"}

near = {c in C : dist(c) - min dist <= ambiguity_delta_m (8 m)}  # overpass/underpass, toll above arterial
if |near| > 1:
    if toll_toggle in {yes,no}: keep candidates matching it           (rule SNAP-TOLL-TOGGLE)
    if still > 1 and bearing known: keep candidates within 30° of travel (SNAP-BEARING)
    if still > 1: pick highest confidence, then nearest; ask citizen   (SNAP-CONFIDENCE-TIEBREAK)
    cap confidence at MEDIUM                                           (CAP-AMBIGUOUS)
seg = chosen candidate
conf = seg.confidence
if gps_accuracy_m > snap_max_m: cap conf at MEDIUM; ask citizen to confirm road   (CAP-GPS-ACCURACY)

office = seg.office_id
if province = DKI and seg.status = PROVINSI and kecamatan known: office = satpel-bm-<kota>-<kecamatan>; chain = [satpel, sudin, dbm-dki]
if seg.status = TOL: watcher = bpjt
apply defect_type override (PJU in DKI -> Seksi PJU of the Sudin)
if seg.rule_id = DKI-TRUNK-NO-SK: coordinator_prompt = "This may be a national road. Check Kepmen PUPR 1688/KPTS/M/2022 DKI list."
persist routing_decision (inputs, candidates, rule_ids, registry_version) -> hash into audit log
```

The Python reference implementation is `decide()` in `scripts/build_road_registry.py`. Its self-test covers the toll-over-arterial case, the GPS-accuracy cap and the admin fallback. The TypeScript service must give the same answers on a shared fixture file (TODO: `tests/routing_fixtures.json`).

### 4.3 Confidence levels

| Level | When | What the citizen sees | What the coordinator must do |
|---|---|---|---|
| **HIGH** | Segment matched to an official list (SK lampiran or BPJT list) with score ≥ 0.80, or an OSM toll tag. **And** the snap is unambiguous **and** GPS accuracy ≤ 25 m. | "Sent to Suku Dinas Bina Marga Jakarta Timur." | Nothing. May still transfer, with an SK citation. |
| **MEDIUM** | Regional open-data default (DKI non-toll → PROVINSI), an official match below threshold, OSM trunk outside DKI, an ambiguous snap settled by the toll toggle, or any HIGH case with poor GPS. | "Probably Suku Dinas … We will confirm." | Sees "check status". Confirms or transfers. |
| **LOW** | OSM class only, DKI trunk without an SK match, or no segment within the radius (admin-boundary fallback). | "We think this is … Please confirm the road." | **Must** confirm or transfer before the case counts as acknowledged. |

The thresholds (25 m, 50 m, 8 m, 30°, 0.80, ±10 %) are **DESIGN** values. No Indonesian agency publishes segment-level status geometry, so they have not been validated. They are configurable in `data/road_status_rules.json`.

### 4.4 Fallbacks, in order

1. **Ambiguous snap:** use the toll toggle, then bearing, then confidence. Ask the citizen.
2. **No segment within r:** use point-in-polygon on the admin boundary. In DKI this gives the Sudin of the kota (then the Satpel of the kecamatan). Elsewhere it gives the kab/kota Dinas, or the Pemda main office if the Dinas is not yet verified. LOW.
3. **Office record TODO_VERIFY** (e.g. a Sudin address unknown): still route to that office id. The case UI shows "contact details not yet verified". The coordinator queue is the delivery channel, so no address is needed to deliver.
4. **Outside every configured region:** status UNKNOWN. Send via SP4N-LAPOR! referral, LOW. This matches the "feed existing channels" positioning.

### 4.5 Output (extends `ResolvedAuthority`)

```ts
export type RoadStatus = "NASIONAL" | "TOL" | "PROVINSI" | "KABUPATEN" | "KOTA" | "DESA" | "KHUSUS" | "UNKNOWN";
export interface RoutingDecision {
  status: RoadStatus;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  authorityId: string | null;            // legal entity, e.g. "pemprov-dki"
  officeId: string | null;               // receiving unit, e.g. "satpel-bm-jaktim-matraman"
  officeChain: string[];                 // ["satpel-…", "sudin-bm-jaktim", "dbm-dki"]
  watcherIds: string[];                  // ["bpjt"] for toll
  segment: { id: string; version: number; name: string | null; distanceM: number } | null;
  legalBasis: { skReferenceId: string | null; text: string | null };  // "Kepmen PUPR 1688/KPTS/M/2022, ruas 012"
  source: "user_correction" | "sk_official" | "bpjt_list" | "bina_marga_list" | "regional_open_data" | "osm_tag_heuristic" | "admin_default";
  ruleIds: string[];                     // ["DKI-DEFAULT-PROVINSI", "CAP-GPS-ACCURACY"]
  basis: string;                         // one plain-English sentence for the UI
  askCitizen: string | null;             // "Is this on the toll road?"
  coordinatorPrompt: string | null;      // "This may be a national road…"
  officeVerifyStatus: "VERIFIED" | "TODO_VERIFY";
  registryVersion: string;
  candidates: Array<{ segmentId: string; distanceM: number; status: RoadStatus; confidence: string }>;
}
```

### 4.6 SLA hooks (configurable, cited)

There is no single legal pothole deadline for regional roads. UU 22/2009 Ps 24 says "segera dan patut", plus a duty to put up signs if repair must wait. The app shows a public clock using a configured, cited target per authority:

| Hook | Value | Source | Status |
|---|---|---|---|
| UU 22/2009 Ps 24 | no number; signage duty | Hukumonline 18 Feb 2026 | VERIFIED |
| Toll pothole (SPM) | 2×24 h claimed | Hukumonline op-ed. detikOto (2021) says no deadline is stated. Lampiran I not retrieved. New SPM 2026 not verified. | **TODO_VERIFY** |
| JAKI response (DKI) | 6 days, then flag + pay cut | INP Polri 29 May 2025 | VERIFIED (response, not repair) |
| SP4N-LAPOR! | verify 3 working days; field cases 60 working days | KemenPANRB Monev 2023 | VERIFIED |
| Jawa Tengah provincial potholes | 24 h follow-up | Antara Jateng 2019 | VERIFIED |
| Surabaya | 1×24 h follow-up | Suara Surabaya 20 Feb 2026 | VERIFIED |

---

## 5. Map colouring legend

The base map is light. Colour means **who owns the road**. Line style means **how sure we are**. Hazard red is reserved for damage, never an owner.

| Status | Colour | Swatch name | Notes |
|---|---|---|---|
| NASIONAL | `#0068B5` | Intel blue | |
| TOL | `#0D1015` | Asphalt ink | wider line (5 px) |
| PROVINSI | `#FF7A1A` | Cone orange | most of Jakarta |
| KABUPATEN / KOTA | `#0A9CC2` | Physics cyan | the two never overlap in one area |
| DESA | `#12A06A` | Green | |
| KHUSUS | `#8B8C8E` | ink at 45 % | thin, labelled "private" |
| UNKNOWN | hollow | white core + ink casing | |
| *(reserved)* | `#E5391A` | Hazard red | damage pins and SLA breaches only |
| *(reserved)* | `#FFC72C` | Signal yellow | selection / highlight only |

| Confidence | Line style |
|---|---|
| HIGH | solid |
| MEDIUM | dashed (6-4) |
| LOW | dotted (1-4), 60 % opacity |

- Every line has a 1.5 px ink casing at 55 % opacity. Cone orange alone is 2.61:1 on white, below the WCAG 2.2 non-text minimum of 3:1. The casing carries the contrast.
- A Machado-2009 colour-vision simulation of the six owner colours gives minimum pairwise ΔE76 of 34.5 (normal), 16.4 (deuteranopia), 24.2 (protanopia) and 9.1 (tritanopia, cyan vs green). Orange and yellow were rejected as a pair: ΔE was 3.4 under deuteranopia.
- Colour is never the only cue. The legend has text, and the popup shows the status in words.
- Toggle: **"Show verified data only"** hides everything that is not HIGH.
- Segment popup: status · authority · office · legal basis (SK number and date) · source · confidence · last reviewed · button **"Report a status error"**.

---

## 6. Correction workflow

```
PENDING ──(reviewer 1 accepts, same level)──────────────────────────► ACCEPTED ──► new segment version
   │                                                                    ▲
   └─(change crosses government levels, e.g. PROVINSI→NASIONAL)──► NEEDS_SECOND_CONFIRM ─(reviewer 2)─┘
   └─(no SK / evidence insufficient)──► REJECTED (reason shown to submitter)
```

- **Who may propose:** anyone. A citizen proposes from the segment popup. A COORDINATOR proposes while transferring a case.
- **Evidence:** required to *accept* (not to propose). It must be an `sk_reference` (SK number and page), plus optional supporting files: an SK page photo, a ruas signboard, an official reply letter.
- **Who reviews:** COORDINATOR or ADMIN of the *receiving* authority. A cross-level change needs a second confirmation by another COORDINATOR or ADMIN. This is SoD-7: the status is legally set by SK, and the Batam case shows how status shifts.
- **Accept** closes the old segment version (`valid_to`) and inserts a new one with `source = user_correction`. It never edits. An audit event is appended (hash-chained, see 08 Audit). Open cases on that segment are offered for transfer. They are not moved silently.
- **Case transfer** (disposisi) without changing the segment: allowed for a COORDINATOR, but it must cite an SK and is logged. Repeated transfers of the same segment raise an admin task: "registry may be wrong here".
- **Give-back:** accepted corrections are exported monthly to the agency (and Jakarta Satu "Urun Data"). They do not go into OSM `highway=*` (no community consensus; thread 145030, July 2026).

---

## 7. Data acquisition pipeline (step by step)

Full commands are in `scripts/build_road_registry.md`. Summary:

1. **OSM geometry:** run `scripts/overpass_jakarta_roads.ql`, a POST to Overpass with area `ISO3166-2=ID-JK`. It returns motorway → living_street, service roads minus parking aisles and driveways, and any `toll=yes` way, all with `out tags geom`. Untested: Overpass returned 406 to the researcher's browser. Geofabrik + osmium is the robust alternative.
2. **Admin polygons:** use BIG batas wilayah keyed by kode wilayah (URL and licence TODO_VERIFY). The fallback is OSM `boundary=administrative`, admin_level 5/6 (**assumption**). Map to the six Sudin slugs.
3. **Split** ways at kota (and kecamatan) boundaries.
4. **Toll:** match OSM motorway / `toll=yes` ways to the BPJT list (`data/toll_operators_jakarta.csv`) by ruas name and operator alias. Result: TOL, BUJT, routing office, BPJT watcher, HIGH. Unmatched toll ways → BPJT queue, MEDIUM.
5. **National:** download the Kepmen 1688 lampiran (check the MD5), extract the DKI ruas, and match by name within DKI on trunk/primary/secondary. Accept only if the summed length is within ±10 %. Matches → NASIONAL, `bbpjn-jabar-dki`, HIGH, with a human review of every match. *Blocked until the lampiran is parsed.*
6. **Provincial DKI default:** every remaining public road → PROVINSI, Pemprov DKI → Sudin of the kota, MEDIUM. Basis: Satu Data Jakarta 2025 shows STATUS_JALAN = PROVINSI for all classes in Jakarta Pusat and Utara.
7. **QA:** km per kota × status against the Satu Data table, unmatched toll km, flagged trunk km, and a 30-point field spot check with Dinas Bina Marga.
8. **Load** to PostGIS as new versions. Publish the status layer under ODbL.

**Outside Jakarta** (next regions): the same steps, plus the provincial Kepgub (for example the Bali and Jateng leads in `authorities_provincial_dinas.csv`) and SK Bupati/Walikota (for example the "SK RUAS JALAN 2024" PDF on ppid.kaboki.go.id cited in note 05). Where no SK is parsed, the OSM heuristic applies at LOW.

---

## 8. Jakarta specifics

- **There is no kabupaten/kota road authority in DKI.** The 5 kota administrasi and 1 kabupaten administrasi are not autonomous. Non-toll public roads default to **Pemprov DKI via Dinas Bina Marga**. Satu Data Jakarta 2025: Jakarta Pusat 693,379 m and Jakarta Utara 1,103,252 m, all PROVINSI, including arteri primer (Jakarta Utara 12,299 m). The other kota rows are not yet read (TODO_VERIFY).
- **Chain:** report → Pusdatin/Posko Bina Marga (dispatcher) → **Suku Dinas Bina Marga [kota]** → **Satpel Bina Marga Kecamatan** → PJLP "pasukan kuning" crew. About 750 PJLP in Feb 2026; the Governor called this insufficient. The Walikota coordinates the Sudin and the Camat coordinates the Satpel, but **neither is the line authority**. Give them observer visibility, not approval rights.
- **National roads in DKI:** **BBPJN DKI Jakarta–Jawa Barat**, office in **Bandung** (Jl. A.H. Nasution No. 264). Its 8 Satker are all labelled "Provinsi Jawa Barat" and none is named for DKI. Buku Kondisi 2025 S-1 does not report DKI separately. Which non-toll ruas in DKI are still national is **unknown**. A 2016 headline says 89.33 km moved from national to provincial (article not opened). Until the Kepmen 1688 DKI list is parsed, DKI trunk roads are routed to the Sudin at LOW with a "possible national road" prompt.
- **Toll:** 23 Jakarta-area ruas from the BPJT list. Jasa Marga ruas route to the **Jasamarga Metropolitan Tollroad Regional Division**, Plaza Tol Cililitan (call center 14080). That routing is an inference to confirm with Jasa Marga. BPJT watches all toll cases. The Satu Data Jakarta toll table (period 2015, status "Nasional") is useful only to cross-check names.
- **Kepulauan Seribu:** whether a Bina Marga Sudin exists for the kabupaten administrasi is **not confirmed** (Pergub text says "Suku Dinas Kota"; LKIP 2023 names only Pusat, Utara, Selatan and Timur). Fallback: `dbm-dki`.
- **Channels to feed, not replace:** JAKI/CRM (14 channels; roads are the #1 category, about 20 % of reports in Nov 2025) and the Posko Bina Marga at **021-3844444** (phone and WhatsApp). Push the routed case with its segment, SK and evidence hash.
- **PJU** goes to Bina Marga in DKI, not Dishub.
- **Sudin addresses and all office coordinates** are not published in any source visited. They are left blank on purpose. Ask the PPID of Dinas Bina Marga.

---

## 9. What is verified vs TODO

| Item | Status | Evidence / source to fetch |
|---|---|---|
| Five road classes + toll + khusus; who sets status | VERIFIED | UU 2/2022 Ps 9; PP 34/2006 Ps 62 |
| National status decree = Kepmen PUPR 1688/KPTS/M/2022 (not 430) | VERIFIED | Bina Marga NSPK page (03 Apr 2023, "Berlaku" on 2026-11-01) |
| National totals 47,604.34 km non-toll / 2,841.12 km toll | VERIFIED | Buku Kondisi Jalan Nasional 2024 S-2 / 2025 S-1 |
| **List of national non-toll ruas inside DKI** | **TODO_VERIFY** | Kepmen 1688 lampiran (51.58 MB PDF) |
| Whether a newer status Kepmen supersedes 1688/2022 | TODO_VERIFY | NSPK list, JDIH PU |
| 33 BBPJN/BPJN names and addresses | VERIFIED | Bina Marga balai directory (24 Feb 2025) |
| Papua balai grade and coverage (Papua Pegunungan vs Papua Tengah) | TODO_VERIFY | Permen PU 1/2025 lampiran |
| Satker PJN / PPK per ruas | TODO_VERIFY | balai sub-sites; Satker org charts |
| Balai phone (only 4 of 33), email (0), coordinates (0) | TODO_VERIFY | each balai sub-site |
| Provincial Dinas: DKI current | VERIFIED | binamarga.jakarta.go.id |
| Provincial Dinas: 30 provinces (2020 list, names and addresses may be stale) | TODO_VERIFY | each province site + JDIH SOTK Pergub |
| Provincial Dinas: Aceh, Sulbar, Sultra, 4 new Papua provinces | TODO_VERIFY (not found) | each province site |
| Kab/kota Dinas directory (514+) | TODO_VERIFY | seeded crawl + JDIH (note 05 §5) |
| Dinas Bina Marga DKI address, phone, email; Pergub 153/2019 structure | VERIFIED | binamarga.jakarta.go.id; pasal.id |
| Pergub 153/2019 still governing (vs Pergub 57/2022, 57/2023; UU 2/2024) | TODO_VERIFY | JDIH DKI |
| 6 Sudin addresses, phones; Sudin Kepulauan Seribu existence; exact names of Jakbar/Kep. Seribu | TODO_VERIFY | kota adm. websites; PPID Dinas Bina Marga |
| Kecamatan list and boundaries for Satpel routing | TODO_VERIFY | BIG / Kemendagri kode wilayah / Jakarta Satu |
| Kepgub DKI on ruas jalan provinsi | TODO_VERIFY | JDIH DKI |
| Satu Data DKI: all roads PROVINSI (Pusat, Utara read) | VERIFIED (2 of 6 kota) | Satu Data Jakarta 2025 table |
| BPJT address, email, phone; 77 ruas / 55 BUJT | VERIFIED | bpjt.pu.go.id |
| 23 Jakarta-area toll ruas, BUJT, address, call center | VERIFIED | BPJT list (2026-11-01) |
| Ruas-level toll call centers; Jasa Marga per-ruas division | TODO_VERIFY | BPJT list column "Call Center Ruas"; Jasa Marga |
| Official toll geometry | not published | OSM is the de-facto source |
| Toll pothole repair deadline (SPM) | TODO_VERIFY | Permen PU 16/2014 Lampiran I; new 2026 SPM Permen |
| OSM tagging conventions (motorway/trunk/primary/secondary) | VERIFIED (weak proxy) | OSM wiki; contested, see thread 145030 |
| OSM `ref` prefix conventions; `designation=*` use | TODO_VERIFY | Overpass sample |
| OSM admin_level for kota (5) / kecamatan (6) | TODO_VERIFY (assumption) | Overpass sample |
| Overpass query runs | TODO_VERIFY (not run) | `scripts/overpass_jakarta_roads.ql` |
| Snap 25 m, cap 50 m, ambiguity 8 m, bearing 30°, match ≥ 0.80, length ±10 % | DESIGN | configurable; validate with field spot checks |
| PJU in DKI = Bina Marga | VERIFIED | Pergub 153/2019 |
| PJU / rambu / marka outside DKI | TODO_VERIFY | regional SOTK |
| Dinas SDA / PPSU role vs Bina Marga (drainage, gang) in DKI | TODO_VERIFY | Dinas Bina Marga |
| Kemendagri kode wilayah decree (current) | TODO_VERIFY | Kemendagri |
