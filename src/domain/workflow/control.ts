/**
 * Koordinator "Pusat Kendali": what needs attention now and how well the agency responds,
 * computed only from recorded history. The response target (first staff action within 2x24 h)
 * is an internal service target set here, not a legal deadline; the screen says so.
 */
import type { ReportCase } from './model';

export const FIRST_RESPONSE_TARGET_H = 48;
const HOUR = 3_600_000;
const OPEN = new Set(['NEEDS_REVIEW', 'VERIFIED', 'FIELD_INSPECTION_REQUESTED', 'INSPECTED', 'INSPECTION_VERIFIED', 'ACTION_RECOMMENDED', 'ACTION_APPROVED', 'IN_PROGRESS']);
const HEAVY = new Set(['SEVERE', 'CRITICAL']);

export interface ControlSummary {
  open: number;
  /** Open reports nobody on staff has acted on yet, and how many of them are past the target. */
  awaitingFirstResponse: number;
  pastResponseTarget: number;
  overdueInspections: number;
  /** Work orders past their target date and not completed. */
  overdueWork: number;
  /** Heavy damage (inspected, or the citizen's estimate before inspection) with no warning sign yet. */
  needsSign: number;
  /** Share of reports that got a first staff action within the target; null without data. */
  onTimePct: number | null;
  medianFirstResponseH: number | null;
  medianResolveDays: number | null;
  byAgency: Array<{ name: string; open: number; lowConfidence: number }>;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function firstStaffAction(c: ReportCase): number | null {
  const h = c.history.find((x) => x.action !== 'SUBMIT' && x.action !== 'SEED_IMPORT');
  return h ? Date.parse(h.at) : null;
}

export function controlSummary(cases: ReportCase[], now: number = Date.now()): ControlSummary {
  const real = cases.filter((c) => c.dataStatus !== 'SYNTHETIC');
  const open = real.filter((c) => OPEN.has(c.state));
  const waiting = open.filter((c) => firstStaffAction(c) === null);
  const responses: number[] = [];
  let onTime = 0;
  for (const c of real) {
    const first = firstStaffAction(c);
    if (first === null) continue;
    const h = (first - Date.parse(c.createdAt)) / HOUR;
    responses.push(h);
    if (h <= FIRST_RESPONSE_TARGET_H) onTime += 1;
  }
  const resolved = real
    .map((c) => ({ c, r: c.history.find((h) => h.action === 'RESOLVE') }))
    .filter((x) => x.r)
    .map((x) => (Date.parse(x.r!.at) - Date.parse(x.c.createdAt)) / (24 * HOUR));

  const agencies = new Map<string, { open: number; lowConfidence: number }>();
  for (const c of open) {
    const name = c.authority?.name ?? 'Instansi belum ditentukan';
    const row = agencies.get(name) ?? { open: 0, lowConfidence: 0 };
    row.open += 1;
    if (!c.authority || c.authority.confidence === 'LOW') row.lowConfidence += 1;
    agencies.set(name, row);
  }

  return {
    open: open.length,
    awaitingFirstResponse: waiting.length,
    pastResponseTarget: waiting.filter((c) => now - Date.parse(c.createdAt) > FIRST_RESPONSE_TARGET_H * HOUR).length,
    overdueInspections: open.filter((c) => c.state === 'FIELD_INSPECTION_REQUESTED' && c.assignment && Date.parse(c.assignment.dueAt) < now).length,
    overdueWork: open.filter((c) => c.workOrder?.targetDate && c.workOrder.status !== 'COMPLETED' && Date.parse(c.workOrder.targetDate) < now).length,
    needsSign: open.filter((c) => !c.hazard && c.state !== 'NEEDS_REVIEW' && HEAVY.has(c.inspection?.severity ?? c.report.severity)).length,
    onTimePct: responses.length ? Math.round((onTime / responses.length) * 100) : null,
    medianFirstResponseH: median(responses),
    medianResolveDays: median(resolved),
    byAgency: [...agencies.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.open - a.open)
  };
}
