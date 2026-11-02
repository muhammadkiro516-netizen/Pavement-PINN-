/**
 * Schools and hospitals near a point, from an OpenStreetMap extract (config/v6/poi_near.json, made by
 * scripts/v6-fetch-poi.py; data © OpenStreetMap contributors, ODbL). Works without network.
 */
import fs from 'node:fs';
import path from 'node:path';

export const NEAR_M = 300;
interface Place { lat: number; lon: number; name: string }
export interface NearPlace { name: string; distanceM: number }

let loaded: { schools: Place[]; hospitals: Place[] } | null = null;
const data = () => {
  if (loaded) return loaded;
  const file = path.join(process.cwd(), 'config', 'v6', 'poi_near.json');
  loaded = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { schools: [], hospitals: [] };
  return loaded!;
};

function closest(list: Place[], lat: number, lon: number): NearPlace | null {
  let best: NearPlace | null = null;
  const cos = Math.cos((lat * Math.PI) / 180);
  for (const p of list) {
    const d = Math.hypot((p.lat - lat) * 111_320, (p.lon - lon) * 111_320 * cos);
    if (d <= NEAR_M && (!best || d < best.distanceM)) best = { name: p.name, distanceM: Math.round(d) };
  }
  return best;
}

export function nearestPlaces(lat: number, lon: number): { school: NearPlace | null; hospital: NearPlace | null } {
  const { schools, hospitals } = data();
  return { school: closest(schools, lat, lon), hospital: closest(hospitals, lat, lon) };
}
