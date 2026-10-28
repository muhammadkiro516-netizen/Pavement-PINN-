/**
 * Impact and AI-quality numbers for the Koordinator, computed from the workflow records only
 * (no constants, no samples). Field accuracy comes from Loop 2: the engineer's review of the
 * model output at inspection (`inspection.cvReview`).
 */
import type { ReportCase } from './model';

export interface ImpactStats {
  total: number;
  open: number;
  resolved: number;
  /** Median days from report to verified repair; null without resolved cases. */
  medianDaysToResolve: number | null;
  /** Reports the model screened with a real result. */
  aiScreened: number;
  /** Of those, how many passed automatically (no human triage needed). */
  aiAutoPassed: number;
  /** Inspections where the engineer reviewed a real model result. */
  fieldReviewed: number;
  /** Of those, how many the engineer accepted unchanged. */
  fieldAccepted: number;
  /** Per detected class: [accepted, reviewed]. */
  perClass: Record<string, [number, number]>;
  /** Human decisions that went against the AI route (manual accept of a flagged report, rejection of a passed one). */
  overrides: number;
  /** Reports reopened after a repair was submitted (rework). */
  reworks: number;
}

const DAY = 86_400_000;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function impactStats(cases: ReportCase[]): ImpactStats {
  const resolvedDays: number[] = [];
  const perClass: Record<string, [number, number]> = {};
  let aiScreened = 0, aiAutoPassed = 0, fieldReviewed = 0, fieldAccepted = 0, overrides = 0, reworks = 0, resolved = 0;

  for (const c of cases) {
    const resolve = c.history.find((h) => h.action === 'RESOLVE');
    if (resolve || c.state === 'RESOLVED') resolved++;
    if (resolve) resolvedDays.push((Date.parse(resolve.at) - Date.parse(c.createdAt)) / DAY);

    const real = c.screening?.modelStatus === 'REAL' && c.screening.detectedClass;
    if (real) {
      aiScreened++;
      if (c.screening!.passed) aiAutoPassed++;
      if (c.history.some((h) => h.action === 'CLOSE_INVALID') && c.screening!.passed) overrides++;
    }
    if (c.history.some((h) => h.action === 'REVIEW_ACCEPT')) overrides += real && !c.screening!.passed ? 1 : 0;
    reworks += c.history.filter((h) => h.action === 'REQUEST_REWORK').length;

    if (real && c.inspection) {
      const cls = c.screening!.detectedClass as string;
      const ok = c.inspection.cvReview.accepted && !c.inspection.cvReview.correctedClass;
      fieldReviewed++;
      if (ok) fieldAccepted++;
      const row = (perClass[cls] ??= [0, 0]);
      row[1]++;
      if (ok) row[0]++;
    }
  }

  return {
    total: cases.length,
    open: cases.filter((c) => c.state !== 'CLOSED' && c.state !== 'RESOLVED').length,
    resolved,
    medianDaysToResolve: median(resolvedDays),
    aiScreened,
    aiAutoPassed,
    fieldReviewed,
    fieldAccepted,
    perClass,
    overrides,
    reworks
  };
}
