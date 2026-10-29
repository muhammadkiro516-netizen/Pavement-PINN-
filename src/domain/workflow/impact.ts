/**
 * Citizen impact and recognition, computed only from workflow records (never typed in, never
 * negative). Professional, not a game: points reward reports that officers verified and roads
 * that got repaired, so the incentive is accurate reporting, not volume.
 */
import type { ReportCase } from './model';

export interface Badge {
  id: string;
  title: string;
  description: string;
  earned: boolean;
}

export interface Impact {
  points: number;
  level: { index: number; name: string; next: string | null; from: number; to: number | null };
  reports: number;
  verified: number;
  repaired: number;
  repairedAreaM2: number;
  waterReports: number;
  badges: Badge[];
}

export const LEVELS = [
  { name: 'Pengamat', from: 0 },
  { name: 'Pelapor', from: 10 },
  { name: 'Penjaga Jalan', from: 50 },
  { name: 'Mitra Jalan', from: 150 }
] as const;

const PAST_SCREENING = new Set(['VERIFIED', 'FIELD_INSPECTION_REQUESTED', 'INSPECTED', 'INSPECTION_VERIFIED', 'ACTION_RECOMMENDED', 'ACTION_APPROVED', 'IN_PROGRESS', 'RESOLVED']);

export function citizenImpact(cases: ReportCase[], accountId: string): Impact {
  const mine = cases.filter((c) => c.createdBy.id === accountId);
  const invalid = (c: ReportCase) => c.history.some((h) => h.action === 'CLOSE_INVALID');
  const verified = mine.filter((c) => !invalid(c) && (PAST_SCREENING.has(c.state) || (c.state === 'CLOSED' && c.history.some((h) => h.action === 'RESOLVE'))));
  const repaired = mine.filter((c) => c.history.some((h) => h.action === 'RESOLVE'));
  const area = repaired.reduce((sum, c) => sum + (c.inspection?.measuredAreaM2 ?? 0), 0);
  const water = mine.filter((c) => !invalid(c) && c.report.cvAssessment?.hazards?.includes('GENANGAN'));
  const points = verified.length * 10 + repaired.length * 5;

  let index = 0;
  LEVELS.forEach((l, i) => {
    if (points >= l.from) index = i;
  });
  const next = LEVELS[index + 1];
  return {
    points,
    level: { index, name: LEVELS[index].name, next: next?.name ?? null, from: LEVELS[index].from, to: next?.from ?? null },
    reports: mine.length,
    verified: verified.length,
    repaired: repaired.length,
    repairedAreaM2: Math.round(area * 10) / 10,
    waterReports: water.length,
    badges: [
      { id: 'first', title: 'Laporan pertama', description: 'Mengirim laporan pertama.', earned: mine.length >= 1 },
      { id: 'verified5', title: 'Pelapor tepercaya', description: '5 laporan dibenarkan petugas.', earned: verified.length >= 5 },
      { id: 'water', title: 'Penjaga genangan', description: 'Melaporkan jalan tergenang.', earned: water.length >= 1 },
      { id: 'witness', title: 'Saksi perbaikan', description: 'Laporanmu sudah diperbaiki.', earned: repaired.length >= 1 }
    ]
  };
}

/** SPEC M8: quests from server-verified events only; XP capped per day, never negative. */
export interface QuestDef { id: string; title: string; description: string; xp: number; rule: string; target: number }
export interface QuestProgress { id: string; title: string; description: string; xp: number; progress: number; target: number; done: boolean; doneAt: string | null }
export interface QuestEvents {
  /** ISO dates of the account's reports first accepted by staff. */
  verifiedAt: string[];
  repairedAt: string[];
  /** 3- or 6-month repair confirmations answered by the account. */
  confirmation36At: string[];
  /** Unique visitors of the account's share links (highest single report). */
  visits: number;
  /** Verified water (GENANGAN) reports filed November-March. */
  rainyWaterAt: string[];
  projectVerifiedAt: string[];
}

export function quests(defs: QuestDef[], ev: QuestEvents, dailyCap: number, now: Date = new Date()): { items: QuestProgress[]; xp: number } {
  const series: Record<string, string[]> = { verified: ev.verifiedAt, repaired: ev.repairedAt, confirmation36: ev.confirmation36At, rainyWater: ev.rainyWaterAt, projectVerified: ev.projectVerifiedAt };
  const items = defs.map((q) => {
    if (q.rule === 'visits') {
      const done = ev.visits >= q.target;
      return { ...q, progress: Math.min(ev.visits, q.target), done, doneAt: done ? now.toISOString() : null };
    }
    const dates = [...(series[q.rule] ?? [])].sort();
    const done = dates.length >= q.target;
    return { id: q.id, title: q.title, description: q.description, xp: q.xp, target: q.target, progress: Math.min(dates.length, q.target), done, doneAt: done ? dates[q.target - 1] : null };
  });
  const perDay = new Map<string, number>();
  for (const q of items) if (q.done && q.doneAt) perDay.set(q.doneAt.slice(0, 10), (perDay.get(q.doneAt.slice(0, 10)) ?? 0) + q.xp);
  const xp = [...perDay.values()].reduce((s, v) => s + Math.min(dailyCap, Math.max(0, v)), 0);
  return { items, xp };
}
