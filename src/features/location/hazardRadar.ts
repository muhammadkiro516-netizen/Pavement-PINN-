/**
 * SPEC M9 "Radar Bahaya": warn (vibration + short tone) within RADIUS_M of a verified hazard.
 * Only staff-verified, still-open reports count; the weight rises for standing water, at night
 * and when no warning sign is recorded. One alert per hazard per COOLDOWN_MS.
 */
import { distanceMeters } from '../../domain/workflow/screening';

export const RADIUS_M = 150;
export const COOLDOWN_MS = 5 * 60_000;
const VERIFIED_OPEN = new Set(['VERIFIED', 'FIELD_INSPECTION_REQUESTED', 'INSPECTED', 'INSPECTION_VERIFIED', 'ACTION_RECOMMENDED', 'ACTION_APPROVED', 'IN_PROGRESS']);
const HEAVY = new Set(['SEVERE', 'CRITICAL']);

export interface RadarCase {
  id: string;
  state: string;
  hazard?: unknown;
  report: { coordinates: [number, number]; severity?: string; damageTypeLabel: string; cvAssessment?: { hazards?: string[] } | null };
}

export interface RadarHit {
  id: string;
  label: string;
  distanceM: number;
  weight: number;
  reasons: string[];
}

export function hazardsNear(cases: RadarCase[], at: [number, number], now: Date = new Date()): RadarHit[] {
  const night = now.getHours() >= 18 || now.getHours() < 6;
  return cases
    .filter((c) => VERIFIED_OPEN.has(c.state))
    .map((c) => ({ c, d: distanceMeters(at, c.report.coordinates) }))
    .filter(({ d }) => d <= RADIUS_M)
    .map(({ c, d }) => {
      const water = !!c.report.cvAssessment?.hazards?.includes('GENANGAN');
      const reasons: string[] = [];
      let w = HEAVY.has(c.report.severity ?? '') ? 2 : 1;
      if (water) { w += 1; reasons.push('genangan menutupi lubang'); }
      if (night) { w += 1; reasons.push('malam hari'); }
      if (!c.hazard) { w += 1; reasons.push('belum ada rambu'); }
      return { id: c.id, label: c.report.damageTypeLabel, distanceM: Math.round(d), weight: w, reasons };
    })
    .sort((a, b) => b.weight - a.weight || a.distanceM - b.distanceM);
}

/** Vibration pattern and tone length grow with the weight. */
export function alertPattern(weight: number): number[] {
  return weight >= 4 ? [300, 120, 300, 120, 300] : weight >= 3 ? [250, 120, 250] : [200];
}
