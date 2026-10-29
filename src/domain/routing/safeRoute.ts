/**
 * "Rute Aman" and "Pantau Area Saya": pure functions over staff-verified cases.
 * Only verified, still-open reports count as hazards (same rule as Radar Bahaya); repaired cases
 * are reported as good news in a watched area.
 */
export const VERIFIED_OPEN = new Set(['VERIFIED', 'FIELD_INSPECTION_REQUESTED', 'INSPECTED', 'INSPECTION_VERIFIED', 'ACTION_RECOMMENDED', 'ACTION_APPROVED', 'IN_PROGRESS']);
export const REPAIRED = new Set(['COMPLETED', 'CLOSED']);
export const ROUTE_BUFFER_M = 30;

export interface HazardCase {
  id: string;
  state: string;
  updatedAt?: string;
  hazard?: unknown;
  report: { coordinates: [number, number]; severity?: string; damageType?: string; damageTypeLabel: string; cvAssessment?: { hazards?: string[] } | null };
}

export interface RouteHazard {
  id: string;
  label: string;
  at: [number, number];
  water: boolean;
  heavy: boolean;
  signed: boolean;
}

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Metres from point p to segment a-b ([lat, lng]); equirectangular, accurate at city scale. */
function toSegmentM(p: [number, number], a: [number, number], b: [number, number]): number {
  const k = Math.cos(rad(p[0]));
  const ax = rad(a[1]) * k * R, ay = rad(a[0]) * R;
  const bx = rad(b[1]) * k * R, by = rad(b[0]) * R;
  const px = rad(p[1]) * k * R, py = rad(p[0]) * R;
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function distanceToLineM(p: [number, number], line: Array<[number, number]>): number {
  if (line.length === 1) return toSegmentM(p, line[0], line[0]);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, toSegmentM(p, line[i - 1], line[i]));
  return best;
}

function toHazard(c: HazardCase): RouteHazard {
  return {
    id: c.id,
    label: c.report.damageTypeLabel,
    at: c.report.coordinates,
    water: c.report.damageType === 'FLOODING' || !!c.report.cvAssessment?.hazards?.includes('GENANGAN'),
    heavy: c.report.severity === 'SEVERE' || c.report.severity === 'CRITICAL',
    signed: !!c.hazard
  };
}

/** Weight of one hazard for a rider: heavy +1, standing water +1, no warning sign +1. */
export const hazardWeight = (h: RouteHazard) => 1 + (h.heavy ? 1 : 0) + (h.water ? 1 : 0) + (h.signed ? 0 : 1);

export function hazardsAlongRoute(cases: HazardCase[], line: Array<[number, number]>, bufferM = ROUTE_BUFFER_M): RouteHazard[] {
  return cases.filter((c) => VERIFIED_OPEN.has(c.state) && distanceToLineM(c.report.coordinates, line) <= bufferM).map(toHazard);
}

export interface RouteOption {
  distanceM: number;
  durationS: number;
  line: Array<[number, number]>;
}

export interface RankedRoute extends RouteOption {
  hazards: RouteHazard[];
  score: number;
  recommended: boolean;
}

/** Lowest hazard score wins; ties go to the faster route. */
export function rankRoutes(cases: HazardCase[], routes: RouteOption[]): RankedRoute[] {
  const ranked = routes.map((r) => {
    const hazards = hazardsAlongRoute(cases, r.line);
    return { ...r, hazards, score: hazards.reduce((s, h) => s + hazardWeight(h), 0), recommended: false };
  });
  const best = [...ranked].sort((a, b) => a.score - b.score || a.durationS - b.durationS)[0];
  if (best) best.recommended = true;
  return ranked;
}

export interface WatchArea {
  id: string;
  name: string;
  center: [number, number];
  radiusM: number;
}

export interface AreaAlert {
  areaId: string;
  areaName: string;
  caseId: string;
  kind: 'HAZARD' | 'REPAIRED';
  label: string;
  distanceM: number;
  at: string;
  fresh: boolean;
}

/** Verified hazards and finished repairs inside each watched area; `fresh` = changed after `seenAt`. */
export function areaAlerts(cases: HazardCase[], areas: WatchArea[], seenAt: string | null): AreaAlert[] {
  const out: AreaAlert[] = [];
  for (const a of areas) {
    for (const c of cases) {
      const hazard = VERIFIED_OPEN.has(c.state);
      if (!hazard && !REPAIRED.has(c.state)) continue;
      const d = distanceToLineM(c.report.coordinates, [a.center]);
      if (d > a.radiusM) continue;
      const at = c.updatedAt ?? '';
      out.push({ areaId: a.id, areaName: a.name, caseId: c.id, kind: hazard ? 'HAZARD' : 'REPAIRED', label: c.report.damageTypeLabel, distanceM: Math.round(d), at, fresh: !!at && (!seenAt || at > seenAt) });
    }
  }
  return out.sort((x, y) => (y.at > x.at ? 1 : y.at < x.at ? -1 : 0));
}
