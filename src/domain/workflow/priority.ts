/**
 * Explainable priority for the Koordinator's queue (human-in-the-loop Loop 3): the AI ranks,
 * the Koordinator decides and may act in any order. Built only from recorded facts:
 *
 * - damage: the engineer's measured severity when inspected, else the model's class weighted by
 *   its confidence (server-verified OpenVINO result), else the citizen's own estimate (halved);
 * - citizen support: upvotes, capped so busy areas cannot outrank severe damage elsewhere;
 * - waiting time: older reports rise, so none is forgotten.
 */
import type { ReportCase } from './model';

export interface Priority {
  score: number;
  reasons: string[];
}

const INSPECTED: Record<string, number> = { CRITICAL: 50, SEVERE: 38, MODERATE: 22, LIGHT: 8 };
const MODEL_CLASS: Record<string, number> = { POTHOLE: 40, ALLIGATOR_CRACK: 32, EDGE_CRACK: 20, BLOCK_CRACK: 18, LONGITUDINAL_CRACK: 16, TRANSVERSE_CRACK: 16, OTHER_ROAD_DAMAGE: 14 };
const CITIZEN: Record<string, number> = { CRITICAL: 40, HIGH: 30, SEVERE: 30, MEDIUM: 18, MODERATE: 18, LOW: 8, LIGHT: 8 };
const LABEL: Record<string, string> = { CRITICAL: 'kritis', SEVERE: 'berat', MODERATE: 'sedang', LIGHT: 'ringan' };

export const SUPPORT_CAP = 20;
export const WAIT_CAP = 20;
const DAY = 86_400_000;

export function priorityOf(c: ReportCase, now: number = Date.now()): Priority {
  const reasons: string[] = [];
  let damage = 0;
  if (c.inspection?.verdict === 'CONFIRMED') {
    damage = INSPECTED[c.inspection.severity] ?? 0;
    reasons.push(`petugas: kerusakan ${LABEL[c.inspection.severity] ?? c.inspection.severity}`);
  } else if (c.screening?.modelStatus === 'REAL' && c.screening.detectedClass && c.screening.confidence !== null) {
    damage = Math.round((MODEL_CLASS[c.screening.detectedClass] ?? 14) * c.screening.confidence);
    reasons.push(`AI: ${c.report.aiAnalysis?.label ?? c.screening.detectedClass} (${Math.round(c.screening.confidence * 100)}%)`);
  } else {
    damage = Math.round((CITIZEN[c.report.severity] ?? 10) / 2);
    reasons.push('perkiraan pelapor');
  }

  const supporters = c.report.upvotesCount ?? 0;
  const support = Math.min(SUPPORT_CAP, supporters * 2);
  if (supporters > 0) reasons.push(`${supporters} warga mendukung`);

  const days = Math.max(0, (now - Date.parse(c.createdAt)) / DAY);
  const wait = Math.min(WAIT_CAP, Math.floor(days));
  if (days >= 3) reasons.push(`menunggu ${Math.floor(days)} hari`);

  return { score: damage + support + wait, reasons };
}

/** Highest priority first; ties keep the most recently updated first. */
export function byPriority(a: ReportCase, b: ReportCase, now: number = Date.now()): number {
  return priorityOf(b, now).score - priorityOf(a, now).score || Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}
