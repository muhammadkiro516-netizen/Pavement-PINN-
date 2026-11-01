#!/usr/bin/env python3
"""
PAVEMENT-PINN - build the road-status registry for DKI Jakarta and route a report point.

Two sub-commands:

  build  : OSM ways (Overpass JSON) + kota/kecamatan polygons + BPJT toll list
           [+ parsed Kepmen 1688 ruas list] [+ Satu Data Jakarta status table]
           -> build/road_segments.gpkg, build/segment_ruas_match.csv, build/qa_report.json

  route  : one report point (lat, lon, GPS accuracy, toll toggle, bearing)
           -> JSON routing decision (status, authority, office, confidence, candidates)
           This is the reference implementation of 04_AUTHORITY_ROUTING.md §4. The
           production service (TypeScript + PostGIS) must give the same answers on the
           fixtures in tests (TODO: write tests/routing_fixtures.json).

Inputs marked TODO must be produced first - see scripts/build_road_registry.md.

  --osm         build/osm_jakarta_roads.json    Overpass output of scripts/overpass_jakarta_roads.ql
  --kota        build/kota_boundaries.geojson   TODO: BIG batas wilayah or OSM admin relations;
                                                needs a name field (default "name")
  --kecamatan   build/kecamatan.geojson         TODO (optional): for Satpel routing
  --toll        data/toll_operators_jakarta.csv BPJT list extract (VERIFIED, 2026-11-01)
  --rules       data/road_status_rules.json
  --ruas        build/ruas_official_dki.csv     TODO (optional): Kepmen PUPR 1688/KPTS/M/2022
                                                lampiran rows for DKI, columns:
                                                no_ruas,nama_ruas,panjang_km,province,legal_basis,page_ref
  --satudata    build/satudata_status_2025.csv  TODO (optional): Satu Data Jakarta table
                                                (PERIODE_DATA,WILAYAH,JENIS_JALAN,PANJANG_JALAN,
                                                LUAS_JALAN,STATUS_JALAN) for QA only

Dependencies: Python >= 3.10, geopandas >= 0.14, shapely >= 2, pyproj, pandas
(pip install geopandas). Pure-logic helpers use only the standard library so they can be
unit-tested without GIS packages (python3 build_road_registry.py selftest).

Data (c) OpenStreetMap contributors, ODbL 1.0. Output that merges OSM geometry is an ODbL
derivative database.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
import unicodedata
from dataclasses import dataclass, field, asdict
from difflib import SequenceMatcher
from pathlib import Path

# ----------------------------------------------------------------------------- constants

PUBLIC_CLASSES = {
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
    "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified",
    "residential", "living_street", "service",
}
DROPPED_SERVICE = {"parking_aisle", "driveway", "drive-through"}
TOLL_CLASSES = {"motorway", "motorway_link"}
CONF_RANK = {"HIGH": 3, "MEDIUM": 2, "LOW": 1}

# Kota administrasi name -> slug used in authorities_jakarta.csv (sudin-bm-<slug>).
# Matching is done on normalised names, so "KOTA ADM. JAKARTA PUSAT", "Jakarta Pusat" and
# "Kota Administrasi Jakarta Pusat" all resolve.
KOTA_SLUGS = {
    "jakarta pusat": "jakpus",
    "jakarta utara": "jakut",
    "jakarta barat": "jakbar",
    "jakarta selatan": "jaksel",
    "jakarta timur": "jaktim",
    "kepulauan seribu": "kepseribu",
}

# ----------------------------------------------------------------------------- pure helpers


def norm(text: str | None) -> str:
    """Lower-case, strip accents/punctuation and common Indonesian road/admin prefixes."""
    if not text:
        return ""
    t = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    t = re.sub(r"[^a-z0-9 ]+", " ", t)
    t = re.sub(r"\b(jalan|jl|jln|tol|ruas|kota|kab|kabupaten|adm|administrasi|pt|persero|tbk)\b", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def similarity(a: str | None, b: str | None) -> float:
    """0..1 string similarity on normalised names (token-sorted, then SequenceMatcher)."""
    na, nb = norm(a), norm(b)
    if not na or not nb:
        return 0.0
    sa, sb = " ".join(sorted(na.split())), " ".join(sorted(nb.split()))
    direct = SequenceMatcher(None, na, nb).ratio()
    sorted_ = SequenceMatcher(None, sa, sb).ratio()
    contained = 0.9 if (na in nb or nb in na) and min(len(na), len(nb)) >= 6 else 0.0
    return max(direct, sorted_, contained)


def kota_slug(name: str | None) -> str | None:
    n = norm(name)
    for key, slug in KOTA_SLUGS.items():
        if key in n:
            return slug
    return None


def search_radius_m(snap_max_m: float, hard_cap_m: float, gps_accuracy_m: float | None) -> float:
    """r = max(snap_max, min(gps_accuracy, hard_cap)) - see road_status_rules.json routing_params."""
    if gps_accuracy_m is None or gps_accuracy_m <= 0:
        return snap_max_m
    return max(snap_max_m, min(gps_accuracy_m, hard_cap_m))


def cap_confidence(conf: str, cap: str) -> str:
    return conf if CONF_RANK[conf] <= CONF_RANK[cap] else cap


def bearing_diff_deg(a: float, b: float) -> float:
    """Smallest angle between two bearings, ignoring direction of travel (0..90)."""
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d)


def parse_overpass_ways(payload: dict) -> list[dict]:
    """Overpass `out tags geom` JSON -> [{osm_way_id, tags, coords[(lon,lat),...]}]."""
    ways = []
    for el in payload.get("elements", []):
        if el.get("type") != "way" or "geometry" not in el:
            continue
        tags = el.get("tags", {})
        hw = tags.get("highway")
        if hw not in PUBLIC_CLASSES and tags.get("toll") != "yes":
            continue
        if hw == "service" and tags.get("service") in DROPPED_SERVICE:
            continue
        coords = [(p["lon"], p["lat"]) for p in el["geometry"] if p]
        if len(coords) >= 2:
            ways.append({"osm_way_id": el["id"], "tags": tags, "coords": coords})
    return ways


def heuristic_status(tags: dict, province: str | None, rules: dict) -> tuple[str, str, str]:
    """(status, confidence, rule_id) from OSM tags, with DKI overrides. No official data used."""
    hw = (tags.get("highway") or "")
    in_dki = bool(province) and "jakarta" in norm(province)
    if hw in TOLL_CLASSES or tags.get("toll") == "yes":
        return "TOL", "HIGH", "OSM-TOLL"
    if in_dki:
        if hw in {"service", "track"}:
            return "KHUSUS", "LOW", "OSM-SERVICE"
        if hw in {"trunk", "trunk_link"}:
            # DKI: national non-toll ruas unknown -> provincial, LOW, flag POSSIBLE_NATIONAL
            return "PROVINSI", "LOW", "DKI-TRUNK-NO-SK"
        conf = rules["jakarta_overrides"]["default_non_toll_public_road"]["confidence"]
        return "PROVINSI", conf, "DKI-DEFAULT-PROVINSI"
    for rule in rules["osm_heuristics"]["rules"]:
        if rule["id"] == "OSM-TOLL":
            continue
        if hw in rule["match"].get("highway", []):
            return rule["status"], rule["confidence"], rule["id"]
    return "UNKNOWN", "LOW", "NO-RULE"


@dataclass
class Candidate:
    segment_id: str
    distance_m: float
    status: str
    confidence: str
    authority_id: str | None
    office_id: str | None
    is_toll: bool
    layer: int = 0
    bearing_deg: float | None = None
    name: str | None = None
    source: str | None = None
    legal_basis: str | None = None


@dataclass
class RoutingDecision:
    status: str
    confidence: str
    authority_id: str | None
    office_id: str | None
    office_chain: list[str]
    basis: str
    rule_ids: list[str]
    search_radius_m: float
    snapped_segment_id: str | None = None
    snapped_distance_m: float | None = None
    ask_citizen: str | None = None
    coordinator_prompt: str | None = None
    candidates: list[dict] = field(default_factory=list)


def choose_candidate(cands: list[Candidate], *, toll_toggle: str, bearing: float | None,
                     ambiguity_delta_m: float, bearing_tol_deg: float) -> tuple[Candidate, bool, bool, list[str]]:
    """Pick one candidate.

    Returns (chosen, multi, needs_citizen, rule_ids): multi = more than one candidate within
    ambiguity_delta_m of the nearest (confidence is then capped at MEDIUM); needs_citizen =
    the citizen's toll toggle did not settle it, so the app asks. cands must be non-empty."""
    rules_used: list[str] = []
    cands = sorted(cands, key=lambda c: c.distance_m)
    near = [c for c in cands if c.distance_m - cands[0].distance_m <= ambiguity_delta_m]
    if len(near) == 1:
        return near[0], False, False, ["SNAP-NEAREST"]
    by_toggle = False
    # 1. citizen's toll / non-toll toggle
    if toll_toggle in {"yes", "no"}:
        want = toll_toggle == "yes"
        filtered = [c for c in near if c.is_toll == want]
        if filtered:
            near = filtered
            by_toggle = len(near) == 1
            rules_used.append("SNAP-TOLL-TOGGLE")
    # 2. bearing of travel
    if bearing is not None and len(near) > 1:
        aligned = [c for c in near if c.bearing_deg is not None and bearing_diff_deg(c.bearing_deg, bearing) <= bearing_tol_deg]
        if aligned:
            near = aligned
            rules_used.append("SNAP-BEARING")
    if len(near) == 1:
        return near[0], True, not by_toggle, rules_used
    # 3. higher-confidence segment, then nearest - still unresolved
    near.sort(key=lambda c: (-CONF_RANK[c.confidence], c.distance_m))
    rules_used.append("SNAP-CONFIDENCE-TIEBREAK")
    return near[0], True, True, rules_used


def decide(cands: list[Candidate], *, gps_accuracy_m: float | None, toll_toggle: str,
           bearing: float | None, params: dict, fallback: dict | None) -> RoutingDecision:
    """Routing decision from candidates already within the search radius (pure function)."""
    snap_max = params["snap_max_m"]["value"]
    radius = search_radius_m(snap_max, params["snap_hard_cap_m"]["value"], gps_accuracy_m)
    if not cands:
        fb = fallback or {}
        return RoutingDecision(
            status=fb.get("status", "UNKNOWN"), confidence="LOW",
            authority_id=fb.get("authority_id"), office_id=fb.get("office_id"),
            office_chain=fb.get("office_chain", []),
            basis=f"No road segment within {radius:.0f} m; admin-boundary default ({fb.get('area', 'unknown area')}).",
            rule_ids=["FALLBACK-ADMIN-BOUNDARY"], search_radius_m=radius,
            ask_citizen="Please confirm the road name.",
            coordinator_prompt="Please confirm the responsible office.")
    chosen, multi, needs_citizen, rule_ids = choose_candidate(
        cands, toll_toggle=toll_toggle, bearing=bearing,
        ambiguity_delta_m=params["ambiguity_delta_m"]["value"],
        bearing_tol_deg=params["bearing_tolerance_deg"]["value"])
    conf = chosen.confidence
    ask = None
    if multi:
        conf = cap_confidence(conf, "MEDIUM")
        rule_ids.append("CAP-AMBIGUOUS")
    if needs_citizen:
        ask = "Is this on the toll road? / Apakah ini di jalan tol?"
    if gps_accuracy_m is not None and gps_accuracy_m > snap_max:
        conf = cap_confidence(conf, "MEDIUM")
        ask = ask or "GPS is imprecise here. Please confirm the road."
        rule_ids.append("CAP-GPS-ACCURACY")
    prompt = None
    if conf == "LOW":
        prompt = "Please confirm the responsible office before acknowledging."
    if chosen.source == "DKI-TRUNK-NO-SK":
        prompt = "This may be a national road. Check the Kepmen PUPR 1688/KPTS/M/2022 DKI list before sending."
    return RoutingDecision(
        status=chosen.status, confidence=conf, authority_id=chosen.authority_id,
        office_id=chosen.office_id, office_chain=[x for x in [chosen.office_id] if x],
        basis=f"Snapped to {chosen.name or chosen.segment_id} ({chosen.distance_m:.1f} m); status from {chosen.source}"
              + (f", {chosen.legal_basis}" if chosen.legal_basis else "") + ".",
        rule_ids=rule_ids, search_radius_m=radius, snapped_segment_id=chosen.segment_id,
        snapped_distance_m=round(chosen.distance_m, 2), ask_citizen=ask, coordinator_prompt=prompt,
        candidates=[asdict(c) for c in sorted(cands, key=lambda c: c.distance_m)[:5]])


def match_toll(osm_name: str | None, osm_operator: str | None, toll_rows: list[dict], min_score: float) -> tuple[dict | None, float]:
    """Best BPJT ruas for an OSM toll way by ruas name and BUJT/operator alias."""
    best, best_score = None, 0.0
    for row in toll_rows:
        s_name = similarity(osm_name, row["ruas_name"])
        aliases = [a for a in (row.get("osm_operator_aliases") or "").split("|") if a]
        s_op = max([similarity(osm_operator, a) for a in aliases] + [similarity(osm_operator, row["bujt_name"])])
        score = 0.7 * s_name + 0.3 * s_op if osm_operator else s_name
        if score > best_score:
            best, best_score = row, score
    return (best, best_score) if best_score >= min_score else (None, best_score)


# ----------------------------------------------------------------------------- GIS parts


def _geo():
    try:
        import geopandas as gpd  # noqa: F401
        import pandas as pd  # noqa: F401
        from shapely.geometry import LineString, Point  # noqa: F401
    except ImportError as exc:  # pragma: no cover
        sys.exit(f"geopandas/shapely/pandas required for this command ({exc}). pip install geopandas")
    import geopandas as gpd
    import pandas as pd
    from shapely.geometry import LineString, Point
    return gpd, pd, LineString, Point


def load_rules(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_csv(path: str | None) -> list[dict]:
    if not path:
        return []
    with open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def line_bearing(geom) -> float | None:
    coords = list(geom.coords)
    if len(coords) < 2:
        return None
    (x1, y1), (x2, y2) = coords[0], coords[-1]
    return (math.degrees(math.atan2(x2 - x1, y2 - y1)) + 360.0) % 360.0


def build(args) -> None:
    gpd, pd, LineString, Point = _geo()
    rules = load_rules(args.rules)
    params = rules["routing_params"]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    # 1. OSM ways -> GeoDataFrame
    with open(args.osm, encoding="utf-8") as f:
        ways = parse_overpass_ways(json.load(f))
    if not ways:
        sys.exit("No usable ways in the Overpass file.")
    roads = gpd.GeoDataFrame(
        {
            "osm_way_id": [w["osm_way_id"] for w in ways],
            "name": [w["tags"].get("name") for w in ways],
            "ref": [w["tags"].get("ref") for w in ways],
            "highway": [w["tags"].get("highway") for w in ways],
            "toll": [w["tags"].get("toll") for w in ways],
            "operator": [w["tags"].get("operator") for w in ways],
            "layer": [int(w["tags"].get("layer", 0) or 0) if str(w["tags"].get("layer", "0")).lstrip("-").isdigit() else 0 for w in ways],
            "bridge": [w["tags"].get("bridge") for w in ways],
        },
        geometry=[LineString(w["coords"]) for w in ways], crs="EPSG:4326")

    # 2. split at kota boundaries; attach kota (and kecamatan if given)
    kota = gpd.read_file(args.kota)[[args.kota_name_field, "geometry"]].rename(columns={args.kota_name_field: "kota_name"}).to_crs(4326)
    kota["kota_slug"] = kota["kota_name"].map(kota_slug)
    unknown = kota[kota["kota_slug"].isna()]["kota_name"].tolist()
    if unknown:
        print(f"WARNING: kota names not mapped to a Sudin slug: {unknown}", file=sys.stderr)
    segs = gpd.overlay(roads, kota, how="intersection", keep_geom_type=True).explode(index_parts=False)
    segs = segs[segs.geometry.length > 0].reset_index(drop=True)
    if args.kecamatan:
        kec = gpd.read_file(args.kecamatan)[[args.kecamatan_name_field, "geometry"]].rename(columns={args.kecamatan_name_field: "kecamatan_name"}).to_crs(4326)
        segs = gpd.overlay(segs, kec, how="intersection", keep_geom_type=True).explode(index_parts=False).reset_index(drop=True)
    else:
        segs["kecamatan_name"] = None
    segs["province"] = "DKI Jakarta"

    metric = segs.estimate_utm_crs()
    segs_m = segs.to_crs(metric)
    segs["length_m"] = segs_m.geometry.length.round(2)
    segs["bearing_deg"] = segs_m.geometry.map(line_bearing)

    # 3. heuristic status (lowest precedence) for every segment
    st = segs.apply(lambda r: heuristic_status({"highway": r["highway"], "toll": r["toll"]}, r["province"], rules), axis=1)
    segs["status"] = [s[0] for s in st]
    segs["confidence"] = [s[1] for s in st]
    segs["source"] = ["regional_open_data" if s[2] == "DKI-DEFAULT-PROVINSI" else "osm_tag_heuristic" for s in st]
    segs["rule_id"] = [s[2] for s in st]
    segs["authority_id"] = None
    segs["office_id"] = None
    segs["legal_basis"] = None
    segs["no_ruas"] = None
    segs["match_score"] = None

    # DKI default chain: provincial -> Sudin of the kota (Satpel resolved at routing time)
    prov = segs["status"] == "PROVINSI"
    segs.loc[prov, "authority_id"] = "pemprov-dki"
    segs.loc[prov, "office_id"] = "sudin-bm-" + segs.loc[prov, "kota_slug"].fillna("UNKNOWN")
    segs.loc[segs["kota_slug"].isna() & prov, "office_id"] = "dbm-dki"

    # 4. toll: match to BPJT ruas list
    toll_rows = load_csv(args.toll)
    min_score = params["official_match_min_score"]["value"]
    is_toll = segs["status"] == "TOL"
    for idx in segs.index[is_toll]:
        row, score = match_toll(segs.at[idx, "name"], segs.at[idx, "operator"], toll_rows, min_score)
        segs.at[idx, "match_score"] = round(score, 3)
        if row:
            segs.at[idx, "authority_id"] = row["bujt_id"]
            segs.at[idx, "office_id"] = row["route_to_office_id"]
            segs.at[idx, "source"] = "bpjt_list"
            segs.at[idx, "legal_basis"] = f"BPJT ruas list ({row['source_date']}): {row['ruas_name']}"
            segs.at[idx, "confidence"] = "HIGH"
        else:
            segs.at[idx, "authority_id"] = "bujt-unmatched"
            segs.at[idx, "office_id"] = "bpjt"  # BPJT watcher queue until the operator is known
            segs.at[idx, "confidence"] = "MEDIUM"

    # 5. national: Kepmen 1688 ruas list (optional until the lampiran is parsed)
    matches = []
    ruas_rows = load_csv(args.ruas)
    tol = params["official_length_tolerance"]["value"]
    cand_mask = segs["highway"].isin(["trunk", "trunk_link", "primary", "primary_link", "secondary"]) & (segs["status"] != "TOL")
    for r in ruas_rows:
        target_m = float(r["panjang_km"]) * 1000.0
        scores = segs.loc[cand_mask, "name"].map(lambda n: similarity(n, r["nama_ruas"]))
        hit = scores[scores >= min_score]
        total = float(segs.loc[hit.index, "length_m"].sum()) if len(hit) else 0.0
        ok = bool(len(hit)) and abs(total - target_m) <= tol * target_m
        matches.append({"no_ruas": r["no_ruas"], "nama_ruas": r["nama_ruas"], "panjang_m_sk": round(target_m, 1),
                        "matched_m": round(total, 1), "n_segments": int(len(hit)), "accepted": ok,
                        "match_method": "name_similarity+length", "legal_basis": r.get("legal_basis"), "page_ref": r.get("page_ref")})
        if ok:
            segs.loc[hit.index, ["status", "authority_id", "office_id", "source", "legal_basis", "no_ruas", "confidence", "rule_id"]] = [
                "NASIONAL", "kementerian-pu", "bbpjn-jabar-dki", "sk_official",
                r.get("legal_basis") or "Kepmen PUPR 1688/KPTS/M/2022", r["no_ruas"], "HIGH", "SK-MATCH"]
            segs.loc[hit.index, "match_score"] = hit.round(3)
    pd.DataFrame(matches).to_csv(out / "segment_ruas_match.csv", index=False)

    # 6. KHUSUS segments carry no office
    segs.loc[segs["status"] == "KHUSUS", ["authority_id", "office_id"]] = [None, None]

    # 7. identifiers + provenance
    segs["segment_id"] = ["dki-" + str(w) + "-" + str(i) for i, w in zip(segs.index, segs["osm_way_id"])]
    segs["valid_from"] = args.valid_from
    segs["registry_version"] = rules["version"]

    # 8. QA: km by status per kota; compare with Satu Data Jakarta totals when given
    qa = {"registry_version": rules["version"], "segments": int(len(segs)),
          "km_by_kota_status": segs.groupby(["kota_slug", "status"])["length_m"].sum().div(1000).round(2).unstack(fill_value=0).to_dict(orient="index"),
          "toll_unmatched_km": round(float(segs.loc[segs["authority_id"] == "bujt-unmatched", "length_m"].sum()) / 1000, 2),
          "dki_trunk_flagged_km": round(float(segs.loc[segs["rule_id"] == "DKI-TRUNK-NO-SK", "length_m"].sum()) / 1000, 2),
          "ruas_official_loaded": len(ruas_rows), "ruas_accepted": sum(1 for m in matches if m["accepted"]),
          "notes": []}
    if not ruas_rows:
        qa["notes"].append("No Kepmen 1688 ruas list loaded: no NASIONAL non-toll segments in DKI; trunk flagged POSSIBLE_NATIONAL.")
    sd = load_csv(args.satudata)
    if sd:
        official = {}
        for r in sd:
            slug = kota_slug(r.get("WILAYAH"))
            if slug:
                official[slug] = official.get(slug, 0.0) + float(r["PANJANG_JALAN"]) / 1000.0
        built = segs[segs["status"] == "PROVINSI"].groupby("kota_slug")["length_m"].sum().div(1000)
        qa["satudata_compare_km"] = {k: {"satudata": round(v, 2), "registry_provinsi": round(float(built.get(k, 0.0)), 2),
                                         "ratio": round(float(built.get(k, 0.0)) / v, 3) if v else None} for k, v in official.items()}
        qa["notes"].append("OSM length counts each carriageway of dual roads; Satu Data PANJANG_JALAN basis unknown - compare ratios, not absolutes.")
    (out / "qa_report.json").write_text(json.dumps(qa, indent=2, ensure_ascii=False), encoding="utf-8")

    cols = ["segment_id", "osm_way_id", "name", "ref", "highway", "toll", "operator", "layer", "bridge", "province",
            "kota_name", "kota_slug", "kecamatan_name", "status", "authority_id", "office_id", "source", "rule_id",
            "confidence", "match_score", "no_ruas", "legal_basis", "length_m", "bearing_deg", "valid_from",
            "registry_version", "geometry"]
    segs[cols].to_file(out / "road_segments.gpkg", layer="road_segments", driver="GPKG")
    kota.to_file(out / "road_segments.gpkg", layer="kota", driver="GPKG")
    print(json.dumps({k: qa[k] for k in ("segments", "toll_unmatched_km", "dki_trunk_flagged_km", "ruas_accepted")}))


def route(args) -> None:
    gpd, pd, LineString, Point = _geo()
    rules = load_rules(args.rules)
    params = rules["routing_params"]
    segs = gpd.read_file(args.registry, layer="road_segments")
    kota = gpd.read_file(args.registry, layer="kota")
    metric = segs.estimate_utm_crs()
    segs_m = segs.to_crs(metric)
    pt = gpd.GeoSeries([Point(args.lon, args.lat)], crs=4326).to_crs(metric).iloc[0]
    radius = search_radius_m(params["snap_max_m"]["value"], params["snap_hard_cap_m"]["value"], args.gps_accuracy)
    idx = segs_m.sindex.query(pt.buffer(radius), predicate="intersects")
    cands = []
    for i in idx:
        row = segs.iloc[i]
        cands.append(Candidate(
            segment_id=row["segment_id"], distance_m=float(segs_m.geometry.iloc[i].distance(pt)),
            status=row["status"], confidence=row["confidence"], authority_id=row["authority_id"],
            office_id=row["office_id"], is_toll=row["status"] == "TOL", layer=int(row["layer"] or 0),
            bearing_deg=row["bearing_deg"], name=row["name"], source=row["rule_id"], legal_basis=row["legal_basis"]))
    cands = [c for c in cands if c.distance_m <= radius]
    fallback = None
    if not cands:
        hit = kota[kota.contains(Point(args.lon, args.lat))]
        if len(hit):
            slug = hit.iloc[0]["kota_slug"]
            fallback = {"status": "PROVINSI", "authority_id": "pemprov-dki",
                        "office_id": f"sudin-bm-{slug}" if slug else "dbm-dki",
                        "office_chain": [f"sudin-bm-{slug}" if slug else "dbm-dki", "dbm-dki"],
                        "area": hit.iloc[0]["kota_name"]}
    decision = decide(cands, gps_accuracy_m=args.gps_accuracy, toll_toggle=args.toll_toggle,
                      bearing=args.bearing, params=params, fallback=fallback)
    print(json.dumps(asdict(decision), indent=2, ensure_ascii=False, default=str))


# ----------------------------------------------------------------------------- self-test (stdlib only)


def selftest() -> None:
    rules = load_rules(str(Path(__file__).resolve().parent.parent / "data" / "road_status_rules.json"))
    p = rules["routing_params"]
    assert search_radius_m(25, 50, None) == 25
    assert search_radius_m(25, 50, 12) == 25
    assert search_radius_m(25, 50, 40) == 40
    assert search_radius_m(25, 50, 120) == 50
    assert kota_slug("KOTA ADM. JAKARTA PUSAT") == "jakpus"
    assert kota_slug("Kabupaten Administrasi Kepulauan Seribu") == "kepseribu"
    assert similarity("Jalan Tol Jakarta-Cikampek", "Jakarta-Cikampek") > 0.85
    assert similarity("Jalan Sudirman", "Jakarta-Cikampek") < 0.5
    assert heuristic_status({"highway": "motorway"}, "DKI Jakarta", rules)[:2] == ("TOL", "HIGH")
    assert heuristic_status({"highway": "trunk"}, "DKI Jakarta", rules) == ("PROVINSI", "LOW", "DKI-TRUNK-NO-SK")
    assert heuristic_status({"highway": "residential"}, "DKI Jakarta", rules)[:2] == ("PROVINSI", "MEDIUM")
    assert heuristic_status({"highway": "trunk"}, "Jawa Barat", rules)[:2] == ("NASIONAL", "MEDIUM")
    assert heuristic_status({"highway": "primary"}, "Jawa Barat", rules)[:2] == ("PROVINSI", "LOW")
    ways = parse_overpass_ways({"elements": [
        {"type": "way", "id": 1, "tags": {"highway": "service", "service": "parking_aisle"}, "geometry": [{"lat": -6.2, "lon": 106.8}, {"lat": -6.21, "lon": 106.81}]},
        {"type": "way", "id": 2, "tags": {"highway": "primary", "name": "Jalan X"}, "geometry": [{"lat": -6.2, "lon": 106.8}, {"lat": -6.21, "lon": 106.81}]},
        {"type": "way", "id": 3, "tags": {"highway": "footway"}, "geometry": [{"lat": -6.2, "lon": 106.8}, {"lat": -6.21, "lon": 106.81}]},
    ]})
    assert [w["osm_way_id"] for w in ways] == [2]
    toll_rows = [{"ruas_name": "Jakarta-Cikampek", "bujt_name": "PT Jasamarga Transjawa Tol", "osm_operator_aliases": "PT Jasamarga Transjawa Tol"},
                 {"ruas_name": "Cawang-Tomang-Pluit", "bujt_name": "PT Jasa Marga (Persero) Tbk", "osm_operator_aliases": "Jasa Marga|PT Jasa Marga (Persero) Tbk"}]
    row, score = match_toll("Jalan Tol Cawang-Tomang-Pluit", "Jasa Marga", toll_rows, 0.8)
    assert row and row["ruas_name"] == "Cawang-Tomang-Pluit", score
    # toll viaduct above an arterial, 3 m apart: toggle decides, ambiguity not flagged when toggle used
    toll = Candidate("t1", 4.0, "TOL", "HIGH", "jm-holding", "jm-metro", True, 1, 90.0, "Tol", "OSM-TOLL")
    art = Candidate("a1", 7.0, "PROVINSI", "MEDIUM", "pemprov-dki", "sudin-bm-jakbar", False, 0, 90.0, "Jl. S. Parman", "DKI-DEFAULT-PROVINSI")
    d = decide([toll, art], gps_accuracy_m=10, toll_toggle="no", bearing=None, params=p, fallback=None)
    assert d.office_id == "sudin-bm-jakbar" and d.confidence == "MEDIUM" and d.ask_citizen is None, d
    d = decide([toll, art], gps_accuracy_m=10, toll_toggle="yes", bearing=None, params=p, fallback=None)
    assert d.status == "TOL" and d.confidence == "MEDIUM" and d.ask_citizen is None, d  # toggle-resolved -> MEDIUM
    d = decide([toll], gps_accuracy_m=10, toll_toggle="unknown", bearing=None, params=p, fallback=None)
    assert d.confidence == "HIGH" and d.ask_citizen is None, d
    d = decide([toll, art], gps_accuracy_m=10, toll_toggle="unknown", bearing=None, params=p, fallback=None)
    assert d.status == "TOL" and d.confidence == "MEDIUM" and d.ask_citizen, d
    d = decide([toll], gps_accuracy_m=40, toll_toggle="unknown", bearing=None, params=p, fallback=None)
    assert d.confidence == "MEDIUM" and "CAP-GPS-ACCURACY" in d.rule_ids, d
    d = decide([], gps_accuracy_m=10, toll_toggle="unknown", bearing=None, params=p,
               fallback={"status": "PROVINSI", "authority_id": "pemprov-dki", "office_id": "sudin-bm-jaktim", "area": "Jakarta Timur"})
    assert d.confidence == "LOW" and d.office_id == "sudin-bm-jaktim", d
    print("selftest OK")


# ----------------------------------------------------------------------------- CLI


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--osm", required=True)
    b.add_argument("--kota", required=True)
    b.add_argument("--kota-name-field", default="name")
    b.add_argument("--kecamatan")
    b.add_argument("--kecamatan-name-field", default="name")
    b.add_argument("--toll", default="data/toll_operators_jakarta.csv")
    b.add_argument("--rules", default="data/road_status_rules.json")
    b.add_argument("--ruas")
    b.add_argument("--satudata")
    b.add_argument("--valid-from", default="2026-11-01")
    b.add_argument("--out", default="build")
    r = sub.add_parser("route")
    r.add_argument("--registry", default="build/road_segments.gpkg")
    r.add_argument("--rules", default="data/road_status_rules.json")
    r.add_argument("--lat", type=float, required=True)
    r.add_argument("--lon", type=float, required=True)
    r.add_argument("--gps-accuracy", type=float)
    r.add_argument("--toll-toggle", choices=["yes", "no", "unknown"], default="unknown")
    r.add_argument("--bearing", type=float)
    sub.add_parser("selftest")
    args = ap.parse_args(argv)
    {"build": build, "route": route, "selftest": lambda _a: selftest()}[args.cmd](args)


if __name__ == "__main__":
    main()
