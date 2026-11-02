"""Named schools and hospitals in the example regions, from OpenStreetMap (ODbL), to config/v6/poi_near.json."""
import json
import os
import urllib.parse
import urllib.request

BOXES = {"karawang": (-6.60, 107.05, -6.00, 107.65), "jakarta": (-6.40, 106.65, -6.05, 107.00)}
HOSTS = ["https://lz4.overpass-api.de/api/interpreter", "https://overpass-api.de/api/interpreter"]


def fetch(box):
    s, w, n, e = box
    query = f'[out:json][timeout:120];(nwr["amenity"~"^(school|hospital)$"]["name"]({s},{w},{n},{e}););out center tags;'
    body = urllib.parse.urlencode({"data": query}).encode()
    for host in HOSTS:
        try:
            req = urllib.request.Request(host, data=body, headers={"User-Agent": "pavement-pinn/1.0"})
            return json.load(urllib.request.urlopen(req, timeout=180))["elements"]
        except Exception as exc:  # next mirror
            print(host, exc)
    raise SystemExit("Overpass unavailable")


places = {"schools": {}, "hospitals": {}}
for box in BOXES.values():
    for el in fetch(box):
        lat = el.get("lat") or el.get("center", {}).get("lat")
        lon = el.get("lon") or el.get("center", {}).get("lon")
        if lat is None:
            continue
        kind = "schools" if el["tags"]["amenity"] == "school" else "hospitals"
        places[kind][el["id"]] = {"lat": round(lat, 6), "lon": round(lon, 6), "name": el["tags"]["name"][:60]}
out = {k: list(v.values()) for k, v in places.items()}
os.makedirs("config/v6", exist_ok=True)
json.dump({"source": "OpenStreetMap contributors (ODbL), via Overpass", **out}, open("config/v6/poi_near.json", "w", encoding="utf8"), ensure_ascii=False)
print({k: len(v) for k, v in out.items()})
