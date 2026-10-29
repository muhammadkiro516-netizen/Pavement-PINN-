/**
 * SPEC M3.5: Rapor Instansi — operational metrics per responsible agency, computed from
 * recorded history. Not an official assessment; published only when an agency has at least
 * PUBLIC_MIN_REPORTS reports so small numbers do not mislead.
 */
import type { ReportCase } from './model';
import { escalationOf } from './escalation';
import { distanceMeters } from './screening';
import { recurrence, repairLives, RECUR_RADIUS_M, type RepairConfirmation } from '../roads/recurrence';

export const PUBLIC_MIN_REPORTS = 10;
const HOUR = 3_600_000;

export interface ReportCard {
  agency: string;
  reports: number;
  /** % first staff action within 2x24 h, over reports that got one. */
  respondedIn48hPct: number | null;
  medianResolveDays: number | null;
  /** % of open reports waiting more than 14 days. */
  openOver14Pct: number | null;
  /** % repairs that held 3 / 6 months, over repairs observed that long. */
  held3mPct: number | null;
  held6mPct: number | null;
  /** % temporary repairs followed by a permanent repair at the same spot. */
  temporaryMadePermanentPct: number | null;
  publishable: boolean;
  label: string;
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function reportCards(cases: ReportCase[], confirmations: RepairConfirmation[], now: number = Date.now()): ReportCard[] {
  const real = cases.filter((c) => c.dataStatus !== 'SYNTHETIC' && c.dataStatus !== 'PUBLIC_ARCHIVE');
  const groups = new Map<string, ReportCase[]>();
  for (const c of real) {
    const k = c.authority?.name ?? 'Instansi belum ditentukan';
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  return [...groups.entries()].map(([agency, cs]) => {
    const firsts = cs
      .map((c) => ({ c, f: c.history.find((h) => h.action !== 'SUBMIT' && h.action !== 'SEED_IMPORT' && h.action !== 'BEGIN_SCREENING' && !h.action.startsWith('SCREENING')) }))
      .filter((x) => x.f);
    const onTime = firsts.filter((x) => Date.parse(x.f!.at) - Date.parse(x.c.createdAt) <= 48 * HOUR).length;
    const resolveDays = cs
      .map((c) => ({ c, r: c.history.find((h) => h.action === 'RESOLVE') }))
      .filter((x) => x.r)
      .map((x) => (Date.parse(x.r!.at) - Date.parse(x.c.createdAt)) / (24 * HOUR));
    const open = cs.map((c) => escalationOf(c, now)).filter((e) => e.open);
    const lives = repairLives(cs, confirmations, now);
    const r3 = recurrence(lives, 3);
    const r6 = recurrence(lives, 6);
    const temps = cs.filter((c) => c.workOrder?.repair?.category === 'SEMENTARA' && c.history.some((h) => h.action === 'RESOLVE'));
    const madePermanent = temps.filter((t) => {
      const at = Date.parse(t.history.find((h) => h.action === 'RESOLVE')!.at);
      return cs.some((o) => o.id !== t.id && o.workOrder?.repair?.category === 'PERMANEN' && o.history.some((h) => h.action === 'RESOLVE' && Date.parse(h.at) > at) && distanceMeters(o.report.coordinates, t.report.coordinates) <= RECUR_RADIUS_M);
    }).length;
    return {
      agency,
      reports: cs.length,
      respondedIn48hPct: pct(onTime, firsts.length),
      medianResolveDays: median(resolveDays),
      openOver14Pct: pct(open.filter((e) => e.waitingDays > 14).length, open.length),
      held3mPct: r3.observed ? 100 - (r3.pct ?? 0) : null,
      held6mPct: r6.observed ? 100 - (r6.pct ?? 0) : null,
      temporaryMadePermanentPct: pct(madePermanent, temps.length),
      publishable: cs.length >= PUBLIC_MIN_REPORTS,
      label: 'Metrik operasional, bukan penilaian resmi'
    };
  }).sort((a, b) => b.reports - a.reports);
}
