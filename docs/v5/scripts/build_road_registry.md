# Build the road-status registry (Jakarta first)

This builds the segment-level layer that says **whose road it is**: status (NASIONAL / TOL / PROVINSI / KABUPATEN / KOTA / DESA / KHUSUS / UNKNOWN), the legal authority, the office that gets the report, the source and the confidence. The routing rules live in `data/road_status_rules.json`. The design is in `04_AUTHORITY_ROUTING.md`.

**Honest status of this pipeline (2026-11-01)**

| Part | State |
|---|---|
| `overpass_jakarta_roads.ql` | Written, **not run** (Overpass returned HTTP 406 to the researcher's browser). |
| `build_road_registry.py selftest` | **Runs and passes** (stdlib only: name matching, snapping rules, confidence caps, Overpass parsing). |
| `build_road_registry.py build` / `route` | Written against geopandas ≥ 0.14 / shapely 2. **Not executed**: the authoring sandbox had no PyPI access. First run must be on a dev machine, then fix anything that breaks. |
| Kepmen 1688 DKI ruas list | **Not obtained.** Until it is, no non-toll segment in DKI is marked NASIONAL. |
| Kota / kecamatan polygons | **Not obtained** (BIG and Jakarta Satu were unreachable). OSM admin relations are the fallback. |

---

## 0. Prerequisites

- Python 3.10+ and `pip install geopandas pyogrio` (brings shapely 2, pyproj, pandas).
- Run from the dev-pack root so the default paths (`data/…`) resolve.
- A `build/` folder (git-ignored). Large files never go in the repo.

```bash
python3 scripts/build_road_registry.py selftest      # should print "selftest OK"
```

## 1. Get OSM road geometry for DKI

```bash
mkdir -p build
curl -sS -X POST https://overpass-api.de/api/interpreter \
  -H "User-Agent: PAVEMENT-PINN/1.0 (road registry build)" \
  --data-urlencode data@scripts/overpass_jakarta_roads.ql \
  -o build/osm_jakarta_roads.json
```

- Check that the file is JSON with an `elements` array. If the server times out, retry later or use a mirror.
- More robust option for the full network: a Geofabrik Indonesia `.osm.pbf` clipped to the DKI polygon with `osmium extract`, then `osmium export` to GeoJSON. In that case adapt `parse_overpass_ways()` to read GeoJSON features. The Geofabrik file name/URL is TODO_VERIFY.
- Keep the download date. It becomes `valid_from` and goes in the QA report.

## 2. Get kota administrasi (and kecamatan) polygons

Preferred: **BIG batas wilayah**, keyed by Kemendagri `kode_wilayah`. The download URL, scale and licence are TODO_VERIFY (tanahair.indonesia.go.id was unreachable). The current Kemendagri kode-wilayah decree is also TODO_VERIFY.

Fallback: OSM boundary relations (companion query (B) in `overpass_jakarta_roads.ql`). `admin_level=5` for kota and `6` for kecamatan are **assumptions**. Inspect the result, then convert to GeoJSON (for example with `osmtogeojson`) as `build/kota_boundaries.geojson` and `build/kecamatan.geojson`.

The six areas must map to the Sudin slugs used in `data/authorities_jakarta.csv`: `jakpus`, `jakut`, `jakbar`, `jaksel`, `jaktim`, `kepseribu`. The script maps names such as "KOTA ADM. JAKARTA PUSAT" automatically and warns about any it cannot map.

Do not use geoBoundaries ADM1 (OSM 2017, 34 provinces) for anything that needs the 38-province set. It is acceptable for DKI.

## 3. Toll list (already in the pack)

`data/toll_operators_jakarta.csv` is the Jakarta-area extract of the BPJT list "Daftar Ruas Jalan Tol dan BUJT Sedang Beroperasi" (read 2026-11-01): 23 ruas with BUJT name, address and call center.

Before the first build, add the OSM `operator=` spellings you see in `build/osm_jakarta_roads.json` (toll ways) to `osm_operator_aliases`. Separate them with `|`. Example already present: `Jasa Marga|PT Jasa Marga (Persero) Tbk|Jasamarga Metropolitan Tollroad`.

## 4. National ruas list (Kepmen PUPR 1688/KPTS/M/2022), when available

1. Download the lampiran from the Bina Marga NSPK page (51.58 MB PDF; MD5 `4776c9c4158abea64ee1fde3a10538a1`). Check the MD5.
   <https://binamarga.pu.go.id/index.php/nspk/detail/keputusan-menteri-pupr-nomor-430kptsm2022-tentang-penetapan-ruas-jalan-menurut-statusnya-sebagai-jalan-nasional>
   The URL slug says "430" but the page holds 1688/2022. Kepmen 430/KPTS/M/2022 is about road **function** (JAP/JKP-1), not status. Do not use it for routing.
2. Extract the DKI table (and Jawa Barat if Karawang/Bekasi are in scope). The column layout is unknown until the PDF is opened. Use `pdfplumber` or `camelot`, then check by hand.
3. Save it as `build/ruas_official_dki.csv` with the columns `no_ruas,nama_ruas,panjang_km,province,legal_basis,page_ref`. Set `legal_basis` = `Kepmen PUPR 1688/KPTS/M/2022` and `page_ref` = the lampiran page.
4. Before trusting the list, confirm on the NSPK page that 1688/2022 is still "Berlaku" and has not been superseded by a newer Kementerian PU decree.

Matching rule (in the script): for each ruas, take OSM ways classed trunk / primary / secondary whose name similarity is ≥ 0.80. Accept the match only if their summed length is within ±10 % of `panjang_km`. Both thresholds are **design assumptions** and have not been validated. Every attempt is written to `build/segment_ruas_match.csv` with accepted = true/false. A person must review every row before the result is published.

Known traps:
- One ruas may run along both carriageways (dual road), so OSM length can be about 2× the SK length. If OSM shows two one-way ways, compare per direction.
- One ruas can cross kota boundaries. The script splits ways at boundaries first, so sum across kota.
- Names in SKs are often endpoint pairs ("A – B"), not street names. Name matching will miss them. Fall back to endpoint geocoding plus a shortest path on trunk/primary ways (TODO; not implemented).

## 5. Satu Data Jakarta status table (QA only)

Download the CSV of "Panjang, Luas, dan Status Jalan Menurut Jenisnya di Provinsi DKI Jakarta" (period 2025, Dinas Bina Marga) and save it as `build/satudata_status_2025.csv`.
<https://satudata.jakarta.go.id/open-data/detail?kategori=dataset&page_url=panjang-luas-dan-status-jalan-menurut-jenisnya-di-provinsi-dki-jakarta&data_no=1>

The table has no geometry. It is used to compare km per kota. Known values for comparison: Jakarta Pusat 693,379 m and Jakarta Utara 1,103,252 m, all with STATUS_JALAN = PROVINSI. Confirm that the other kota rows also say PROVINSI.

## 6. Run the build

```bash
python3 scripts/build_road_registry.py build \
  --osm build/osm_jakarta_roads.json \
  --kota build/kota_boundaries.geojson --kota-name-field name \
  --kecamatan build/kecamatan.geojson --kecamatan-name-field name \
  --toll data/toll_operators_jakarta.csv \
  --rules data/road_status_rules.json \
  --ruas build/ruas_official_dki.csv \
  --satudata build/satudata_status_2025.csv \
  --valid-from 2026-11-01 --out build
```

`--kecamatan`, `--ruas` and `--satudata` are optional.

Order of precedence applied (lowest first; later steps overwrite):
1. OSM heuristic, with the DKI override: every non-toll public road in DKI → PROVINSI, MEDIUM. DKI trunk → PROVINSI, LOW, flagged `DKI-TRUNK-NO-SK`.
2. BPJT toll match → TOL with the BUJT and its routing office, HIGH. Toll ways with no match → `bujt-unmatched`, office `bpjt`, MEDIUM.
3. Kepmen 1688 match → NASIONAL, office `bbpjn-jabar-dki`, HIGH.
4. Accepted user corrections (applied in the database, not in this script).

Outputs:
- `build/road_segments.gpkg`: layer `road_segments` (EPSG:4326 LineStrings) and layer `kota`.
- `build/segment_ruas_match.csv`: every official-list match attempt.
- `build/qa_report.json`: km by kota × status, unmatched toll km, flagged DKI trunk km, and the Satu Data comparison.

## 7. QA gates (block publishing if any fails)

| Gate | Rule |
|---|---|
| Kota mapping | All six slugs present; zero unmapped kota names. |
| Toll coverage | `toll_unmatched_km` reviewed. Each unmatched toll way gets an alias or a manual BUJT assignment. |
| DKI trunk | Every `DKI-TRUNK-NO-SK` segment is listed for the coordinator until the Kepmen 1688 list is loaded. |
| Satu Data ratio | Registry PROVINSI km ÷ Satu Data km per kota is reviewed. A ratio far from 1 (dual carriageways count twice in OSM) needs an explanation in the QA note. No pass/fail threshold is set yet. |
| Official matches | 100 % of `accepted=true` rows in `segment_ruas_match.csv` checked by a person. |
| Spot check | Route 30 known points (Matraman Raya, Jl. Letjen S. Parman under the Grogol flyover, a toll gate, a gang in each kota) and compare the result with what Dinas Bina Marga confirms. |

## 8. Load into PostGIS

Load the tables in `04_AUTHORITY_ROUTING.md` §3 (`road_segment`, `authority`, `office`, `sk_reference`, `ruas_official`, `segment_ruas_match`, `status_correction`).

```bash
ogr2ogr -f PostgreSQL "PG:dbname=pavement" build/road_segments.gpkg road_segments \
  -nln road_segment_staging -lco GEOMETRY_NAME=geom -t_srs EPSG:4326
```

Then upsert into `road_segment` as **new versions**. Close the old row (`valid_to = now()`) and insert the new one. Never update a row in place. Load the authority/office CSVs in `data/` into `authority` and `office`. Rows with `status = TODO_VERIFY` are loaded but flagged in the admin UI.

## 9. Refresh cadence

| Trigger | Action |
|---|---|
| New Kepmen / Kepgub on road status (watch the Bina Marga NSPK list and JDIH DKI) | Re-parse, re-match, publish a new version. |
| BPJT list changes (new ruas operating) | Re-extract the Jakarta rows. |
| OSM | Monthly re-pull. Diff by `osm_way_id`. Re-run only the changed ways. |
| Accepted corrections | Applied immediately as new versions. Exported monthly (see §10). |

## 10. Licence and give-back

- OSM data is ODbL. The merged registry (OSM geometry + status) is a derivative database. Publish the status attribute layer openly under ODbL with attribution "© OpenStreetMap contributors".
- Do **not** push status into OSM `highway=*`. The Indonesian community has not agreed on that (OSM community thread 145030, July 2026). If anything is contributed, use a separate tag after community discussion.
- Accepted corrections can also go to Jakarta Satu "Urun Data" or straight to Dinas Bina Marga.
