/**
 * Who owns this road (04_AUTHORITY_ROUTING.md §4). Snaps to the local OSM snapshot, then applies
 * data/road_status_rules.json. OSM holds road classes, not legal status, so nothing here reaches
 * HIGH except a toll tag: the SK lists are TODO_VERIFY. LOW results ask the coordinator to confirm.
 * Works without network: the snapshot and the admin polygons ship with the repo.
 */
import fs from 'node:fs';
import path from 'node:path';

export type RoadStatus = 'NASIONAL' | 'TOL' | 'PROVINSI' | 'KABUPATEN' | 'KOTA' | 'DESA' | 'KHUSUS' | 'UNKNOWN';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface RoutingDecision {
  status: RoadStatus;
  statusLabel: string;
  confidence: Confidence;
  authorityId: string;
  authorityName: string;
  officeId: string;
  officeName: string;
  officeChain: string[];
  watcherIds: string[];
  segment: { id: string; name: string | null; highway: string; distanceM: number } | null;
  legalBasis: string;
  source: 'bpjt_list' | 'regional_open_data' | 'osm_tag_heuristic' | 'admin_default';
  ruleIds: string[];
  basis: string;
  askCitizen: string | null;
  coordinatorPrompt: string | null;
  officeVerifyStatus: 'VERIFIED' | 'TODO_VERIFY';
  area: { region: 'jakarta' | 'karawang' | null; kota: string | null; kecamatan: string | null };
  candidates: { segmentId: string; distanceM: number; status: RoadStatus }[];
  registryVersion: string;
}

interface Road { id: string; name: string | null; highway: string; toll: boolean; ref: string | null; operator: string | null; pts: [number, number][] }
interface Area { name: string; level: number; region: 'jakarta' | 'karawang'; rings: [number, number][][]; bbox: [number, number, number, number] }

const DESIGN = { snapMaxM: 25, snapCapM: 50, ambiguityM: 8 };
const CELL = 0.005;
const M_PER_DEG_LAT = 111_320;

export const STATUS_LABEL: Record<RoadStatus, string> = {
  NASIONAL: 'National road', TOL: 'Toll road', PROVINSI: 'Provincial road', KABUPATEN: 'Regency road', KOTA: 'City road', DESA: 'Village road', KHUSUS: 'Private road', UNKNOWN: 'Status unknown'
};

/** Minimal CSV parser for the pack's data files (quoted fields, commas inside quotes). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((cells) => Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ''])));
}

const KOTA_SLUG: Record<string, string> = { 'Jakarta Pusat': 'jakpus', 'Jakarta Utara': 'jakut', 'Jakarta Barat': 'jakbar', 'Jakarta Selatan': 'jaksel', 'Jakarta Timur': 'jaktim', 'Kepulauan Seribu': 'kepseribu' };
const slug = (s: string) => s.toLowerCase().replace(/^kecamatan\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function kotaOf(name: string | null): string | null {
  if (!name) return null;
  return Object.keys(KOTA_SLUG).find((k) => name.includes(k)) ?? null;
}

export class RoadRegistry {
  private roads: Road[] = [];
  private areas: Area[] = [];
  private grid = new Map<string, number[]>();
  private offices = new Map<string, Record<string, string>>();
  private tolls: Record<string, string>[] = [];
  readonly version: string;
  readonly available: boolean;

  constructor(root: string = process.cwd()) {
    const file = path.join(root, 'config', 'v5', 'roads_snapshot.json');
    this.available = fs.existsSync(file);
    const snapshot = this.available ? JSON.parse(fs.readFileSync(file, 'utf8')) : { roads: [], admin: [], builtOn: 'none' };
    this.version = `osm-${snapshot.builtOn}`;
    this.roads = snapshot.roads;
    this.roads.forEach((road, index) => {
      const cells = new Set<string>();
      for (let i = 0; i < road.pts.length - 1; i++) {
        const [aLat, aLon] = road.pts[i];
        const [bLat, bLon] = road.pts[i + 1];
        const steps = Math.ceil(Math.max(Math.abs(bLat - aLat), Math.abs(bLon - aLon)) / CELL) + 1;
        for (let s = 0; s <= steps; s++) cells.add(this.cell(aLat + ((bLat - aLat) * s) / steps, aLon + ((bLon - aLon) * s) / steps));
      }
      for (const key of cells) {
        const list = this.grid.get(key);
        if (list) list.push(index);
        else this.grid.set(key, [index]);
      }
    });
    this.areas = snapshot.admin.map((a: Omit<Area, 'bbox'>) => {
      const flat = a.rings.flat();
      return { ...a, bbox: [Math.min(...flat.map((p) => p[0])), Math.min(...flat.map((p) => p[1])), Math.max(...flat.map((p) => p[0])), Math.max(...flat.map((p) => p[1]))] };
    });
    const data = path.join(root, 'docs', 'v5', 'data');
    for (const name of ['authorities_jakarta.csv', 'authorities_national_balai.csv']) {
      for (const row of parseCsv(fs.readFileSync(path.join(data, name), 'utf8'))) this.offices.set(row.id, row);
    }
    this.tolls = parseCsv(fs.readFileSync(path.join(data, 'toll_operators_jakarta.csv'), 'utf8'));
  }

  private cell(lat: number, lon: number): string {
    return `${Math.floor(lat / CELL)}:${Math.floor(lon / CELL)}`;
  }

  /** Metres from a point to a polyline, with a local flat-earth projection. */
  private distanceTo(road: Road, lat: number, lon: number): number {
    const mLon = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
    let best = Infinity;
    for (let i = 0; i < road.pts.length - 1; i++) {
      const ax = (road.pts[i][1] - lon) * mLon;
      const ay = (road.pts[i][0] - lat) * M_PER_DEG_LAT;
      const bx = (road.pts[i + 1][1] - lon) * mLon;
      const by = (road.pts[i + 1][0] - lat) * M_PER_DEG_LAT;
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
    return best;
  }

  private near(lat: number, lon: number, radiusM: number): { road: Road; distanceM: number }[] {
    const reach = Math.ceil(radiusM / (CELL * M_PER_DEG_LAT)) + 1;
    const cLat = Math.floor(lat / CELL);
    const cLon = Math.floor(lon / CELL);
    const seen = new Set<number>();
    const out: { road: Road; distanceM: number }[] = [];
    for (let i = -reach; i <= reach; i++) {
      for (let j = -reach; j <= reach; j++) {
        for (const index of this.grid.get(`${cLat + i}:${cLon + j}`) ?? []) {
          if (seen.has(index)) continue;
          seen.add(index);
          const distanceM = this.distanceTo(this.roads[index], lat, lon);
          if (distanceM <= radiusM) out.push({ road: this.roads[index], distanceM });
        }
      }
    }
    return out.sort((a, b) => a.distanceM - b.distanceM);
  }

  private areaOf(lat: number, lon: number): RoutingDecision['area'] {
    const inside = (a: Area) => lat >= a.bbox[0] && lat <= a.bbox[2] && lon >= a.bbox[1] && lon <= a.bbox[3] && a.rings.some((ring) => pointInRing(ring, lat, lon));
    const hits = this.areas.filter(inside);
    const top = hits.find((a) => a.level === 5) ?? null;
    const sub = hits.find((a) => a.level === 6) ?? null;
    return { region: top?.region ?? sub?.region ?? null, kota: top?.name ?? null, kecamatan: sub?.name ?? null };
  }

  private office(id: string): { name: string; status: 'VERIFIED' | 'TODO_VERIFY' } {
    const row = this.offices.get(id);
    return { name: row?.name || id, status: row?.status === 'VERIFIED' ? 'VERIFIED' : 'TODO_VERIFY' };
  }

  private jakartaOffice(area: RoutingDecision['area']): { officeId: string; officeName: string; chain: string[]; verify: 'VERIFIED' | 'TODO_VERIFY' } {
    const kota = kotaOf(area.kota);
    if (!kota) return { officeId: 'dbm-dki', officeName: this.office('dbm-dki').name, chain: ['dbm-dki'], verify: 'VERIFIED' };
    const code = KOTA_SLUG[kota];
    const sudin = code === 'kepseribu' ? 'dbm-dki' : `sudin-bm-${code}`;
    if (area.kecamatan && code !== 'kepseribu') {
      const name = area.kecamatan.replace(/^Kecamatan\s+/i, '');
      return { officeId: `satpel-bm-${code}-${slug(name)}`, officeName: `Satuan Pelaksana Bina Marga Kecamatan ${name}`, chain: [`satpel-bm-${code}-${slug(name)}`, sudin, 'dbm-dki'], verify: 'TODO_VERIFY' };
    }
    return { officeId: sudin, officeName: this.office(sudin).name, chain: [sudin, 'dbm-dki'], verify: this.office(sudin).status };
  }

  private tollOperator(road: Road): Record<string, string> | null {
    const hay = `${road.name ?? ''} ${road.operator ?? ''}`.toLowerCase();
    if (!hay.trim()) return null;
    return this.tolls.find((t) => {
      const aliases = (t.osm_operator_aliases || t.bujt_name || '').split(/[;|]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      return aliases.some((alias) => hay.includes(alias)) || (t.ruas_name && hay.includes(t.ruas_name.toLowerCase()));
    }) ?? null;
  }

  decide(lat: number, lon: number, accuracyM: number, tollToggle?: 'yes' | 'no' | null): RoutingDecision {
    const radius = Math.max(DESIGN.snapMaxM, Math.min(accuracyM, DESIGN.snapCapM));
    let candidates = this.near(lat, lon, radius);
    const area = this.areaOf(lat, lon);
    const ruleIds: string[] = [];
    let askCitizen: string | null = null;
    const statusOf = (road: Road): RoadStatus => statusForRoad(road, area.region);
    const candidateList = candidates.slice(0, 5).map((c) => ({ segmentId: c.road.id, distanceM: Math.round(c.distanceM), status: statusOf(c.road) }));

    let capMedium = false;
    if (candidates.length > 0) {
      const closest = candidates[0].distanceM;
      const nearby = candidates.filter((c) => c.distanceM - closest <= DESIGN.ambiguityM);
      const owners = new Set(nearby.map((c) => statusOf(c.road)));
      if (owners.size > 1) {
        ruleIds.push('CAP-AMBIGUOUS');
        capMedium = true;
        const isToll = (c: { road: Road }) => c.road.toll || c.road.highway.startsWith('motorway');
        if (tollToggle) {
          const kept = nearby.filter((c) => (tollToggle === 'yes' ? isToll(c) : !isToll(c)));
          if (kept.length > 0) { candidates = kept; ruleIds.push('SNAP-TOLL-TOGGLE'); }
        } else if (nearby.some(isToll)) {
          askCitizen = 'Are you on the toll road?';
        }
      }
    }
    if (accuracyM > DESIGN.snapMaxM) {
      capMedium = true;
      ruleIds.push('CAP-GPS-ACCURACY');
      askCitizen ??= 'GPS is not exact here. Please confirm the road.';
    }

    const hit = candidates[0] ?? null;
    const base = { area, candidates: candidateList, registryVersion: this.version, watcherIds: [] as string[], askCitizen, ruleIds };
    const segment = hit ? { id: hit.road.id, name: hit.road.name, highway: hit.road.highway, distanceM: Math.round(hit.distanceM) } : null;
    const cap = (c: Confidence): Confidence => (capMedium && c === 'HIGH' ? 'MEDIUM' : c);

    if (hit && (hit.road.toll || hit.road.highway.startsWith('motorway'))) {
      ruleIds.push('OSM-TOLL');
      const toll = this.tollOperator(hit.road);
      return {
        ...base,
        status: 'TOL',
        statusLabel: STATUS_LABEL.TOL,
        confidence: toll ? cap('HIGH') : 'MEDIUM',
        authorityId: toll?.bujt_id ?? 'bpjt',
        authorityName: toll?.bujt_name ?? 'Badan Pengatur Jalan Tol (BPJT)',
        officeId: toll?.route_to_office_id ?? 'bpjt',
        officeName: toll?.bujt_name ?? 'BPJT watcher queue: toll operator not matched',
        officeChain: toll ? [toll.route_to_office_id, toll.bujt_id] : ['bpjt'],
        watcherIds: ['bpjt'],
        segment,
        legalBasis: 'UU 2/2022 Pasal 9(6), 51A; operator per BPJT list',
        source: toll ? 'bpjt_list' : 'osm_tag_heuristic',
        basis: toll ? `Toll road tag on the map; operator from the BPJT list.` : 'Toll road tag on the map; the operator is not matched yet.',
        coordinatorPrompt: toll ? null : 'Confirm the toll operator for this road.',
        officeVerifyStatus: toll?.status === 'VERIFIED' ? 'VERIFIED' : 'TODO_VERIFY'
      };
    }

    if (area.region === 'jakarta') {
      const office = this.jakartaOffice(area);
      const shared = { ...base, status: 'PROVINSI' as const, statusLabel: STATUS_LABEL.PROVINSI, authorityId: 'pemprov-dki', authorityName: this.office('pemprov-dki').name, officeId: office.officeId, officeName: office.officeName, officeChain: office.chain, segment, officeVerifyStatus: office.verify };
      if (hit && hit.road.highway.startsWith('trunk')) {
        ruleIds.push('DKI-TRUNK-NO-SK');
        return { ...shared, confidence: 'LOW', legalBasis: 'Kepmen PUPR 1688/KPTS/M/2022: DKI list TODO_VERIFY', source: 'osm_tag_heuristic', basis: 'Major road in Jakarta. It may be national; the decree list is not loaded yet.', coordinatorPrompt: 'This may be a national road. Check the Kepmen PUPR 1688/KPTS/M/2022 DKI list before sending.' };
      }
      if (hit) {
        ruleIds.push('DKI-DEFAULT-PROVINSI');
        return { ...shared, confidence: cap('MEDIUM'), legalBasis: 'Satu Data Jakarta 2025: non-toll public roads are provincial', source: 'regional_open_data', basis: 'Non-toll public road in Jakarta. Satu Data Jakarta lists these as provincial.', coordinatorPrompt: null };
      }
      ruleIds.push('ADMIN-FALLBACK');
      return { ...shared, confidence: 'LOW', legalBasis: 'Admin boundary only; road not in the registry', source: 'admin_default', basis: 'Road not in our registry. Office chosen from the area.', askCitizen: askCitizen ?? 'Please confirm the road.', coordinatorPrompt: 'Road not in the registry. Confirm the road and the office.' };
    }

    if (area.region === 'karawang') {
      const national = { authorityId: 'kementerian-pu', authorityName: 'Kementerian Pekerjaan Umum', officeId: 'bbpjn-jabar-dki', officeName: this.office('bbpjn-jabar-dki').name, officeChain: ['bbpjn-jabar-dki'] };
      const province = { authorityId: 'pemprov-jabar', authorityName: 'Pemerintah Provinsi Jawa Barat', officeId: 'dbmpr-jabar', officeName: 'Dinas Bina Marga Provinsi Jawa Barat', officeChain: ['dbmpr-jabar'] };
      const regency = { authorityId: 'pemkab-karawang', authorityName: 'Pemerintah Kabupaten Karawang', officeId: 'dpupr-karawang', officeName: 'Dinas PUPR Kabupaten Karawang', officeChain: ['dpupr-karawang'] };
      if (hit && hit.road.highway.startsWith('trunk')) {
        ruleIds.push('OSM-TRUNK');
        return { ...base, ...national, status: 'NASIONAL', statusLabel: STATUS_LABEL.NASIONAL, confidence: 'MEDIUM', segment, legalBasis: 'Kepmen PUPR 1688/KPTS/M/2022: segment match TODO_VERIFY', source: 'osm_tag_heuristic', basis: 'Trunk road on the map; trunk roads are usually national. Not yet matched to the decree.', coordinatorPrompt: 'Check status against the Kepmen PUPR 1688/KPTS/M/2022 list.', officeVerifyStatus: this.office('bbpjn-jabar-dki').status };
      }
      if (hit && hit.road.highway.startsWith('primary')) {
        ruleIds.push('OSM-PRIMARY');
        return { ...base, ...province, status: 'PROVINSI', statusLabel: STATUS_LABEL.PROVINSI, confidence: 'LOW', segment, legalBasis: 'Road class on the map only; Kepgub list TODO_VERIFY', source: 'osm_tag_heuristic', basis: 'Estimated from the road class on the map.', coordinatorPrompt: 'Road class only. Confirm or transfer, citing the decree.', officeVerifyStatus: 'TODO_VERIFY' };
      }
      ruleIds.push(hit ? 'OSM-SECONDARY' : 'ADMIN-FALLBACK');
      return { ...base, ...regency, status: 'KABUPATEN', statusLabel: STATUS_LABEL.KABUPATEN, confidence: 'LOW', segment, legalBasis: hit ? 'Road class on the map only; SK Bupati TODO_VERIFY' : 'Admin boundary only; road not in the registry', source: hit ? 'osm_tag_heuristic' : 'admin_default', basis: hit ? 'Estimated from the road class on the map.' : 'Road not in our registry. Office chosen from the area.', askCitizen: hit ? askCitizen : askCitizen ?? 'Please confirm the road.', coordinatorPrompt: 'Confirm the road and the office, or transfer citing the decree.', officeVerifyStatus: 'TODO_VERIFY' };
    }

    ruleIds.push('OUTSIDE-REGIONS');
    return { ...base, status: 'UNKNOWN', statusLabel: STATUS_LABEL.UNKNOWN, confidence: 'LOW', authorityId: 'unrouted', authorityName: 'Not in a pilot region', officeId: 'sp4n-lapor', officeName: 'SP4N-LAPOR! referral', officeChain: ['sp4n-lapor'], segment, legalBasis: 'Outside the pilot regions', source: 'admin_default', basis: 'This place is outside Jakarta and Karawang. The report goes to a coordinator for referral to SP4N-LAPOR!.', coordinatorPrompt: 'Outside the pilot regions. Refer to SP4N-LAPOR!.', officeVerifyStatus: 'TODO_VERIFY' };
  }

  /** Map layer, coloured by owner and styled by confidence (04 §5). */
  segmentsInBox(s: number, w: number, n: number, e: number, limit = 2000) {
    const features: unknown[] = [];
    for (const road of this.roads) {
      if (features.length >= limit) break;
      if (!road.pts.some(([lat, lon]) => lat >= s && lat <= n && lon >= w && lon <= e)) continue;
      const [lat, lon] = road.pts[Math.floor(road.pts.length / 2)];
      const region = this.areaOf(lat, lon).region;
      const status = statusForRoad(road, region);
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: road.pts.map(([a, b]) => [b, a]) }, properties: { id: road.id, name: road.name, status, statusLabel: STATUS_LABEL[status], confidence: confidenceForRoad(road, region) } });
    }
    return { type: 'FeatureCollection', features, attribution: 'Road geometry © OpenStreetMap contributors (ODbL). Road class is not legal status.' };
  }
}

function pointInRing(ring: [number, number][], lat: number, lon: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [aLat, aLon] = ring[i];
    const [bLat, bLon] = ring[j];
    if (aLat > lat !== bLat > lat && lon < ((bLon - aLon) * (lat - aLat)) / (bLat - aLat) + aLon) inside = !inside;
  }
  return inside;
}

function statusForRoad(road: Road, region: string | null): RoadStatus {
  if (road.toll || road.highway.startsWith('motorway')) return 'TOL';
  if (region === 'jakarta') return 'PROVINSI';
  if (region === 'karawang') {
    if (road.highway.startsWith('trunk')) return 'NASIONAL';
    if (road.highway.startsWith('primary')) return 'PROVINSI';
    return 'KABUPATEN';
  }
  return 'UNKNOWN';
}

function confidenceForRoad(road: Road, region: string | null): Confidence {
  if (road.toll || road.highway.startsWith('motorway')) return 'HIGH';
  if (region === 'jakarta') return road.highway.startsWith('trunk') ? 'LOW' : 'MEDIUM';
  if (region === 'karawang' && road.highway.startsWith('trunk')) return 'MEDIUM';
  return 'LOW';
}
