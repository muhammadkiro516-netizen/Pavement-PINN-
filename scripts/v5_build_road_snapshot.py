"""Builds config/v5/roads_snapshot.json: major roads and admin boundaries for the v5 routing.

Geometry comes from OpenStreetMap through Overpass (data (c) OpenStreetMap contributors, ODbL).
OSM holds road classes, not legal status, so the status is decided later by the rules in
docs/v5/data/road_status_rules.json and carries their confidence (04_AUTHORITY_ROUTING.md §4).

    python scripts/v5_build_road_snapshot.py
"""
from __future__ import annotations

import hashlib
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

MIRRORS = ["https://lz4.overpass-api.de/api/interpreter", "https://z.overpass-api.de/api/interpreter", "https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
CACHE = Path(__file__).resolve().parent.parent / ".data" / "osm-tiles"
OUT = Path(__file__).resolve().parent.parent / "config" / "v5" / "roads_snapshot.json"

# Jakarta plus the Karawang corridor.
BOXES = {"jakarta": (-6.38, 106.68, -6.08, 107.0), "karawang": (-6.48, 107.05, -6.18, 107.55)}
CLASSES = "motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link"
USER_AGENT = "PAVEMENT-PINN/1.0 (road damage reporting pilot)"


def overpass(query: str) -> dict:
    """Answers are cached by query, so a failed run resumes where it stopped."""
    CACHE.mkdir(parents=True, exist_ok=True)
    cached = CACHE / f"{hashlib.sha256(query.encode()).hexdigest()[:20]}.json"
    if cached.exists():
        return json.loads(cached.read_text(encoding="utf8"))
    data = fetch(query)
    cached.write_text(json.dumps(data), encoding="utf8")
    return data


def fetch(query: str) -> dict:
    last: Exception | None = None
    for attempt in range(8):
        for url in MIRRORS:
            try:
                req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": query}).encode(), headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=70) as resp:
                    return json.load(resp)
            except Exception as exc:  # noqa: BLE001 - try the next mirror
                print(f"  {url} failed: {exc}", file=sys.stderr, flush=True)
                last = exc
        time.sleep(15 * (attempt + 1))
    raise SystemExit(f"All Overpass mirrors failed: {last}")


def simplify(points: list[list[float]], tol: float) -> list[list[float]]:
    """Douglas-Peucker in degrees; tol 0.00005 is about 5 m."""
    if len(points) < 3:
        return points
    (ax, ay), (bx, by) = points[0], points[-1]
    dx, dy = bx - ax, by - ay
    norm = dx * dx + dy * dy or 1e-18
    best, index = 0.0, 0
    for i in range(1, len(points) - 1):
        px, py = points[i]
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / norm))
        d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
        if d > best:
            best, index = d, i
    if best <= tol * tol:
        return [points[0], points[-1]]
    return simplify(points[: index + 1], tol)[:-1] + simplify(points[index:], tol)


def tiles(step: float = 0.1):
    """Small tiles keep each query light enough for a busy public server."""
    for name, (s, w, n, e) in BOXES.items():
        lat = s
        while lat < n:
            lon = w
            while lon < e:
                yield name, round(lat, 3), round(lon, 3), round(min(lat + step, n), 3), round(min(lon + step, e), 3)
                lon += step
            lat += step


def roads() -> list[dict]:
    seen: dict[int, dict] = {}
    for name, s, w, n, e in tiles():
        print(f"roads: {name} {s:.2f},{w:.2f}", flush=True)
        data = overpass(f'[out:json][timeout:80];way["highway"~"^({CLASSES})$"]({s},{w},{n},{e});out tags geom;')
        for el in data["elements"]:
            tags = el.get("tags", {})
            pts = [[round(p["lat"], 6), round(p["lon"], 6)] for p in el.get("geometry", [])]
            if len(pts) < 2:
                continue
            seen[el["id"]] = {
                "id": f"osm-{el['id']}",
                "name": tags.get("name"),
                "highway": tags["highway"],
                "toll": tags.get("toll") == "yes",
                "ref": tags.get("ref"),
                "operator": tags.get("operator"),
                "pts": simplify(pts, 0.00003),
            }
        time.sleep(1)
    return list(seen.values())


def stitch(members: list[dict]) -> list[list[list[float]]]:
    """Joins relation way members into closed rings."""
    open_ways = [[[round(p["lat"], 5), round(p["lon"], 5)] for p in m.get("geometry", [])] for m in members if m.get("type") == "way" and m.get("role") in ("outer", "")]
    open_ways = [w for w in open_ways if len(w) >= 2]
    rings: list[list[list[float]]] = []
    while open_ways:
        ring = open_ways.pop()
        changed = True
        while changed and ring[0] != ring[-1]:
            changed = False
            for i, way in enumerate(open_ways):
                if way[0] == ring[-1]:
                    ring += way[1:]
                elif way[-1] == ring[-1]:
                    ring += way[-2::-1]
                elif way[-1] == ring[0]:
                    ring = way[:-1] + ring
                elif way[0] == ring[0]:
                    ring = way[:0:-1] + ring
                else:
                    continue
                open_ways.pop(i)
                changed = True
                break
        if len(ring) >= 4:
            rings.append(simplify(ring, 0.0003))
    return rings


def in_rings(rings: list[list[list[float]]], lat: float, lon: float) -> bool:
    for ring in rings:
        inside = False
        j = len(ring) - 1
        for i in range(len(ring)):
            (ay, ax), (by, bx) = ring[i], ring[j]
            if (ay > lat) != (by > lat) and lon < (bx - ax) * (lat - ay) / (by - ay) + ax:
                inside = not inside
            j = i
        if inside:
            return True
    return False


def admin() -> list[dict]:
    """Level 5 = kota administrasi / kabupaten, level 6 = kecamatan, kept when inside a chosen level 5."""
    wanted = {"jakarta": ["Jakarta Pusat", "Jakarta Utara", "Jakarta Barat", "Jakarta Selatan", "Jakarta Timur"], "karawang": ["Karawang"]}
    top: list[dict] = []
    for region, (s, w, n, e) in BOXES.items():
        print(f"admin level 5: {region}", flush=True)
        data = overpass(f'[out:json][timeout:85];relation["boundary"="administrative"]["admin_level"="5"]({s},{w},{n},{e});out geom;')
        for el in data["elements"]:
            name = el["tags"].get("name", "")
            if any(k in name for k in wanted[region]):
                rings = stitch(el.get("members", []))
                if rings:
                    top.append({"name": name, "level": 5, "region": region, "rings": rings})
    out = list(top)
    for region, (s, w, n, e) in BOXES.items():
        print(f"admin level 6: {region}", flush=True)
        data = overpass(f'[out:json][timeout:85];relation["boundary"="administrative"]["admin_level"="6"]({s},{w},{n},{e});out geom;')
        parents = [t for t in top if t["region"] == region]
        for el in data["elements"]:
            rings = stitch(el.get("members", []))
            if not rings:
                continue
            pts = max(rings, key=len)
            lat = sum(x[0] for x in pts) / len(pts)
            lon = sum(x[1] for x in pts) / len(pts)
            if any(in_rings(t["rings"], lat, lon) for t in parents):
                out.append({"name": el["tags"].get("name"), "level": 6, "region": region, "rings": rings})
    return out


def main() -> None:
    result = {
        "source": "OpenStreetMap via Overpass. Data (c) OpenStreetMap contributors, ODbL.",
        "builtOn": date.today().isoformat(),
        "note": "Road class and geometry only. OSM does not hold legal status; see road_status_rules.json.",
        "roads": roads(),
        "admin": admin(),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf8")
    print(f"{OUT}: {len(result['roads'])} roads, {len(result['admin'])} areas, {OUT.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
