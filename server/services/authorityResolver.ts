/**
 * Who is responsible for the road at a point (docs/LEAN_PLAN.md, Phase 3).
 *
 * The legal road status (nasional / provinsi / kabupaten-kota / tol) decides the authority. No
 * open dataset of legal status covers the pilot, so it is approximated from OpenStreetMap:
 *   - Nominatim reverse (jsonv2): province, city / regency, city district (DKI kota administrasi)
 *   - Overpass: nearest way tagged highway=* within 25 m: class, ref, operator
 * motorway -> toll operator (HIGH); trunk or a national route ref -> BBPJN (MEDIUM); other roads
 * -> provincial or city/regency service by road class and area (LOW). Every result carries its
 * basis and confidence, and a Koordinator can transfer the report (disposisi).
 * Data © OpenStreetMap contributors (ODbL).
 */
import fs from "node:fs";
import path from "node:path";

export type AuthorityLevel = "NASIONAL" | "TOL" | "PROVINSI" | "KOTA" | "KABUPATEN";

export interface AgencyRecord {
  id: string;
  level: AuthorityLevel;
  name: string;
  parent: string;
  region: string[];
}

export interface ResolvedAuthority {
  agencyId: string;
  level: AuthorityLevel;
  name: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  basis: string;
  area: { province: string | null; city: string | null; road: string | null; highway: string | null; ref: string | null };
}

export interface PlaceFacts {
  province: string | null;
  city: string | null; // regency or city (Kabupaten Karawang, Jakarta Timur)
  road: string | null;
  highway: string | null; // OSM highway class
  ref: string | null;
  operator: string | null;
}

const REGISTRY_FILE = path.join(process.cwd(), "config", "authorities", "pilot.json");
export const AGENCIES: AgencyRecord[] = fs.existsSync(REGISTRY_FILE) ? JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8")).agencies : [];
export const agencyById = (id: string) => AGENCIES.find((a) => a.id === id) ?? null;

const JAKARTA_CITIES = ["Jakarta Timur", "Jakarta Pusat", "Jakarta Barat", "Jakarta Selatan", "Jakarta Utara"];
const MAJOR = new Set(["primary", "primary_link", "secondary", "secondary_link"]);

function pick(id: string, confidence: ResolvedAuthority["confidence"], basis: string, f: PlaceFacts): ResolvedAuthority {
  const a = agencyById(id);
  return {
    agencyId: id,
    level: a?.level ?? "KABUPATEN",
    name: a?.name ?? id,
    confidence,
    basis,
    area: { province: f.province, city: f.city, road: f.road, highway: f.highway, ref: f.ref }
  };
}

/** Pure mapping from place facts to the responsible agency (unit-tested). */
export function classify(f: PlaceFacts): ResolvedAuthority | null {
  const inDki = !!f.province && /jakarta/i.test(f.province);
  const inJabar = !!f.province && /jawa barat/i.test(f.province);
  if (!inDki && !inJabar) return null;
  if (f.highway === "motorway" || f.highway === "motorway_link") {
    return pick("bujt", "HIGH", `Jalan tol (OSM highway=motorway${f.operator ? `, operator ${f.operator}` : ""}).`, f);
  }
  if (f.highway === "trunk" || f.highway === "trunk_link" || (f.ref && /^\d{1,3}$/.test(f.ref.trim()))) {
    return pick("bbpjn-jabar-dki", "MEDIUM", `Kemungkinan jalan nasional (OSM ${f.highway ?? "ref " + f.ref}).`, f);
  }
  if (inDki) {
    const city = JAKARTA_CITIES.find((c) => f.city && f.city.includes(c.replace("Jakarta ", "")) && /jakarta/i.test(f.city));
    if (f.highway && MAJOR.has(f.highway)) return pick("dbm-dki", "LOW", `Jalan arteri/kolektor di DKI Jakarta (OSM ${f.highway}).`, f);
    if (city) return pick(`sudin-bm-${{ "Jakarta Timur": "jaktim", "Jakarta Pusat": "jakpus", "Jakarta Barat": "jakbar", "Jakarta Selatan": "jaksel", "Jakarta Utara": "jakut" }[city]}`, "LOW", `Jalan lokal di ${city}.`, f);
    return pick("dbm-dki", "LOW", "Jalan di DKI Jakarta.", f);
  }
  // Jawa Barat
  if (f.highway === "primary" || f.highway === "primary_link") return pick("dbmpr-jabar", "LOW", "Kemungkinan jalan provinsi (OSM primary).", f);
  if (f.city && /karawang/i.test(f.city)) return pick("dpupr-karawang", "LOW", `Jalan kabupaten di ${f.city}${f.highway ? ` (OSM ${f.highway})` : ""}.`, f);
  return pick("dbmpr-jabar", "LOW", "Jawa Barat, di luar wilayah kabupaten pilot.", f);
}

/** Without the network: pilot bounding boxes only. */
export function offlineFacts(lat: number, lng: number): PlaceFacts {
  const dki = lat >= -6.38 && lat <= -6.08 && lng >= 106.68 && lng <= 106.98;
  const krw = lat >= -6.55 && lat <= -5.9 && lng >= 107.0 && lng <= 107.7;
  return { province: dki ? "DKI Jakarta" : krw ? "Jawa Barat" : null, city: krw ? "Kabupaten Karawang" : null, road: null, highway: null, ref: null, operator: null };
}

// ---------------------------------------------------------------- network lookup (cached)

export const UA = "PAVEMENT-PINN/1.0 (road damage reporting pilot; contact: pavement-pinn@users.noreply.github.com)";
const CACHE_FILE = path.join(process.env.DATA_DIR || ".data", "geocode-cache.json");
let cache: Record<string, { at: number; facts: PlaceFacts }> = {};
try {
  cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
} catch {
  cache = {};
}
let lastCall = 0;

async function politely<T>(fn: () => Promise<T>): Promise<T> {
  const wait = Math.max(0, lastCall + 1100 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  return fn();
}

async function fetchJson(url: string, init: RequestInit, ms: number): Promise<any> {
  const res = await fetch(url, { ...init, headers: { "User-Agent": UA, Accept: "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function lookup(lat: number, lng: number): Promise<PlaceFacts> {
  const rev = await politely(() =>
    fetchJson(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1&accept-language=id`, {}, 2500)
  );
  const a = rev?.address ?? {};
  const facts: PlaceFacts = {
    province: a.state ?? a.province ?? null,
    city: a.city ?? a.county ?? a.regency ?? null,
    road: a.road ?? null,
    highway: rev?.category === "highway" ? rev.type : null,
    ref: null,
    operator: null
  };
  try {
    const q = `[out:json][timeout:3];way(around:25,${lat},${lng})[highway~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified|service|living_street)$"];out tags center 5;`;
    const ov = await fetchJson("https://overpass-api.de/api/interpreter", { method: "POST", body: new URLSearchParams({ data: q }) }, 3500);
    const rank = ["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service"];
    const ways = (ov?.elements ?? []) as Array<{ tags?: Record<string, string> }>;
    const best = ways.map((w) => w.tags ?? {}).sort((x, y) => rank.indexOf(x.highway?.replace("_link", "") ?? "") - rank.indexOf(y.highway?.replace("_link", "") ?? ""))[0];
    if (best) {
      facts.highway = best.highway ?? facts.highway;
      facts.ref = best.ref ?? null;
      facts.operator = best.operator ?? null;
      facts.road = best.name ?? facts.road;
    }
  } catch {
    // Overpass busy: keep the Nominatim class
  }
  return facts;
}

/** Responsible agency for a point; never throws (falls back to the pilot boxes). */
export async function resolveAuthority(lat: number, lng: number, opts: { offline?: boolean } = {}): Promise<ResolvedAuthority | null> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  let facts = cache[key] && Date.now() - cache[key].at < 30 * 86400_000 ? cache[key].facts : null;
  // Tests stay hermetic (no OpenStreetMap calls) under the node test runner.
  const online = process.env.AUTHORITY_LOOKUP !== "off" && !process.env.NODE_TEST_CONTEXT;
  if (!facts && !opts.offline && online) {
    try {
      facts = await lookup(lat, lng);
      cache[key] = { at: Date.now(), facts };
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
    } catch {
      facts = null;
    }
  }
  const resolved = classify(facts ?? offlineFacts(lat, lng));
  if (resolved && !facts) resolved.basis += " (tanpa data peta daring: perkiraan wilayah)";
  return resolved;
}
