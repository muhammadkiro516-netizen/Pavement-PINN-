/*
  PAVEMENT-PINN - Overpass QL: drivable road network of DKI Jakarta (geometry + tags)

  Status: UNTESTED. During research (2026-11-01) overpass-api.de returned HTTP 406 to a
  browser and the kumi.systems mirror could not be opened, so this query has not been run.
  Base query from research note 05 §2; toll union and service filter added.

  How to run (POST, not GET; send a real User-Agent):
    curl -sS -X POST https://overpass-api.de/api/interpreter \
         -H "User-Agent: PAVEMENT-PINN/1.0 (road registry build)" \
         --data-urlencode data@scripts/overpass_jakarta_roads.ql \
         -o build/osm_jakarta_roads.json
  For the whole network a Geofabrik Indonesia .osm.pbf clipped with osmium to the DKI
  polygon is more reliable than a public Overpass server (file name/URL: TODO_VERIFY).

  Area filter: ISO3166-2 = ID-JK (DKI Jakarta). Confirm the relation still carries this tag.

  Output: every way with full tags (name, ref, highway, toll, operator, oneway, bridge,
  layer, surface, service) and its node geometry. Layer/bridge are needed to separate
  toll viaducts from the arterial below during snapping.

  Licence: OpenStreetMap data (c) OpenStreetMap contributors, ODbL 1.0. A merged database
  (OSM geometry + official status) is likely a derivative database -> publish the status
  attribute layer under ODbL (see 04_AUTHORITY_ROUTING.md §8).
*/
[out:json][timeout:300];

area["ISO3166-2"="ID-JK"]->.jk;

(
  // Public road classes used for routing
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street)$"](area.jk);

  // Service roads, minus parking aisles / driveways / drive-throughs (dropped as non-public)
  way["highway"="service"]["service"!~"^(parking_aisle|driveway|drive-through)$"](area.jk);

  // Any way tagged as toll, whatever its highway class (catches mis-classed toll links)
  way["highway"]["toll"="yes"](area.jk);
);

out tags geom;

/*
  ---------------------------------------------------------------------------------------
  Companion queries (run separately; same POST method)

  (A) Toll ways only, to build the operator alias table (read operator, name, ref):
      [out:json][timeout:180];
      area["ISO3166-2"="ID-JK"]->.jk;
      (
        way["highway"~"^(motorway|motorway_link)$"](area.jk);
        way["highway"]["toll"="yes"](area.jk);
      );
      out tags geom;

  (B) Kota administrasi boundaries for Suku Dinas routing.
      admin_level=5 is an ASSUMPTION (note 05 §2) - inspect the result and adjust.
      Kecamatan level (for Satpel) is likely admin_level=6 - also an ASSUMPTION.
      [out:json][timeout:180];
      area["ISO3166-2"="ID-JK"]->.jk;
      rel["boundary"="administrative"]["admin_level"~"^(5|6)$"](area.jk);
      out tags geom;

  Prefer BIG batas wilayah keyed by Kemendagri kode wilayah when it can be downloaded
  (tanahair.indonesia.go.id; licence and URL TODO_VERIFY). OSM boundaries are the fallback.
  ---------------------------------------------------------------------------------------
*/
