/**
 * SPEC M2.2-M2.4: how long repairs really last, computed only from recorded events.
 *
 * - A repair starts at its verified RESOLVE.
 * - It fails at the first later sign of damage at the same spot: a new report within
 *   RECUR_RADIUS_M (not closed as invalid), or a citizen confirmation "berlubang lagi".
 * - A repair that has not failed is right-censored: we only know it lasted at least its age.
 *   Shares are therefore computed over repairs observed for the whole window (or failed in it),
 *   never over younger repairs that could still fail.
 */
import type { ReportCase, RepairMethod } from '../workflow/model';
import { distanceMeters } from '../workflow/screening';

export const RECUR_RADIUS_M = 10;
export const CONFIRM_MILESTONES_MONTHS = [1, 3, 6] as const;
export const CONFIRM_RADIUS_M = 300;
const DAY = 86_400_000;
const MONTH_DAYS = 30.4375;

export interface RepairConfirmation {
  id: string;
  caseId: string;
  at: string;
  by: string;
  milestone: (typeof CONFIRM_MILESTONES_MONTHS)[number];
  result: 'OK' | 'BROKEN';
  photoUrl: string | null;
}

export interface RepairLife {
  caseId: string;
  segmentId: string;
  method: RepairMethod | null;
  category: 'SEMENTARA' | 'PERMANEN' | null;
  repairedAt: string;
  failedAt: string | null;
  failedBy: { kind: 'NEW_REPORT'; caseId: string } | { kind: 'CONFIRMATION'; id: string } | null;
  /** Days until failure, or days observed so far when it has not failed. */
  days: number;
  censored: boolean;
  /** Failure happened inside the stated contract maintenance period. */
  inMaintenance: boolean;
  maintenanceEndsAt: string | null;
}

const repairedAt = (c: ReportCase) => c.history.find((h) => h.action === 'RESOLVE')?.at ?? null;
const invalid = (c: ReportCase) => c.history.some((h) => h.action === 'CLOSE_INVALID');

function addMonths(iso: string, months: number): string {
  return new Date(Date.parse(iso) + months * MONTH_DAYS * DAY).toISOString();
}

export function repairLives(cases: ReportCase[], confirmations: RepairConfirmation[], now: number = Date.now()): RepairLife[] {
  const real = cases.filter((c) => c.dataStatus !== 'SYNTHETIC');
  const out: RepairLife[] = [];
  for (const c of real) {
    const at = repairedAt(c);
    if (!at) continue;
    const t0 = Date.parse(at);
    const reports = real
      .filter((o) => o.id !== c.id && !invalid(o) && Date.parse(o.createdAt) > t0 && distanceMeters(o.report.coordinates, c.report.coordinates) <= RECUR_RADIUS_M)
      .map((o) => ({ t: Date.parse(o.createdAt), by: { kind: 'NEW_REPORT' as const, caseId: o.id } }));
    const broken = confirmations
      .filter((f) => f.caseId === c.id && f.result === 'BROKEN' && Date.parse(f.at) > t0)
      .map((f) => ({ t: Date.parse(f.at), by: { kind: 'CONFIRMATION' as const, id: f.id } }));
    const first = [...reports, ...broken].sort((a, b) => a.t - b.t)[0] ?? null;
    const wo = c.workOrder;
    const months = wo?.maintenanceMonths ?? null;
    const maintenanceEndsAt = months && wo?.completedAt ? addMonths(wo.completedAt, months) : null;
    out.push({
      caseId: c.id,
      segmentId: c.segmentId,
      method: wo?.repair?.method ?? null,
      category: wo?.repair?.category ?? null,
      repairedAt: at,
      failedAt: first ? new Date(first.t).toISOString() : null,
      failedBy: first?.by ?? null,
      days: Math.max(0, ((first ? first.t : now) - t0) / DAY),
      censored: !first,
      inMaintenance: !!(first && maintenanceEndsAt && first.t <= Date.parse(maintenanceEndsAt)),
      maintenanceEndsAt
    });
  }
  return out;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface RecurrenceSummary {
  windowMonths: number;
  /** Repairs that failed within the window. */
  recurred: number;
  /** Repairs observed for the whole window or failed inside it (the honest denominator). */
  observed: number;
  /** Younger repairs, not counted yet. */
  tooRecent: number;
  pct: number | null;
}

export function recurrence(lives: RepairLife[], windowMonths = 3): RecurrenceSummary {
  const w = windowMonths * MONTH_DAYS;
  const recurred = lives.filter((l) => !l.censored && l.days <= w).length;
  const observed = lives.filter((l) => (!l.censored && l.days <= w) || l.days >= w).length;
  return { windowMonths, recurred, observed, tooRecent: lives.length - observed, pct: observed ? Math.round((recurred / observed) * 100) : null };
}

export interface MethodStats {
  method: RepairMethod | 'TIDAK_DICATAT';
  repairs: number;
  failed: number;
  /** Median days to failure among failed repairs; null if none failed. */
  medianFailDays: number | null;
  /** Share failed within 3 months, over repairs observed that long. */
  recurred3m: RecurrenceSummary;
}

export function statsByMethod(lives: RepairLife[]): MethodStats[] {
  const groups = new Map<string, RepairLife[]>();
  for (const l of lives) {
    const k = l.method ?? 'TIDAK_DICATAT';
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  return [...groups.entries()]
    .map(([method, ls]) => ({
      method: method as MethodStats['method'],
      repairs: ls.length,
      failed: ls.filter((l) => !l.censored).length,
      medianFailDays: median(ls.filter((l) => !l.censored).map((l) => l.days)),
      recurred3m: recurrence(ls, 3)
    }))
    .sort((a, b) => b.repairs - a.repairs);
}

export interface DueConfirmation {
  caseId: string;
  milestone: (typeof CONFIRM_MILESTONES_MONTHS)[number];
  dueAt: string;
}

/**
 * SPEC M2.3: which 1/3/6-month questions are open for one account. A milestone opens when its
 * time has come and stays open until the next one; each account answers each milestone once.
 * Distance (reporter, or within CONFIRM_RADIUS_M of `near`) is checked by the caller's filter.
 */
export function dueConfirmations(
  cases: ReportCase[],
  confirmations: RepairConfirmation[],
  accountId: string,
  now: number = Date.now(),
  near?: [number, number] | null
): DueConfirmation[] {
  const out: DueConfirmation[] = [];
  for (const c of cases) {
    const at = repairedAt(c);
    if (!at || c.dataStatus === 'SYNTHETIC') continue;
    const mine = c.createdBy.id === accountId;
    const close = !!near && distanceMeters(near, c.report.coordinates) <= CONFIRM_RADIUS_M;
    if (!mine && !close) continue;
    const ms = CONFIRM_MILESTONES_MONTHS;
    for (let i = ms.length - 1; i >= 0; i--) {
      const due = Date.parse(addMonths(at, ms[i]));
      if (due > now) continue;
      const answered = confirmations.some((f) => f.caseId === c.id && f.by === accountId && f.milestone === ms[i]);
      if (!answered) out.push({ caseId: c.id, milestone: ms[i], dueAt: new Date(due).toISOString() });
      break; // only the latest reached milestone is open
    }
  }
  return out;
}
