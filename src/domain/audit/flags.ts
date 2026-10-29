/**
 * SPEC M6.4-M6.5: audit flags for the Koordinator. Neutral wording only (SPEC 0.4): a flag asks
 * for clarification or a technical test; it never names a person or alleges wrongdoing.
 *
 * - BIAYA: stated value differs from the fair-cost estimate by more than the threshold.
 * - RUSAK_CEPAT: the repair failed earlier than the 10th percentile of repairs of the same
 *   method in the data (needs >= MIN_PEER failed repairs of that method; TERUKUR, no model).
 * - PEMELIHARAAN: damage returned inside the stated maintenance period (SPEC M2.4).
 */
import type { ReportCase } from '../workflow/model';
import { repairLives, type RepairConfirmation } from '../roads/recurrence';
import { fairCost, type FairnessResult, type PriceBook } from './fairness';

export const MIN_PEER = 5;

export type FlagKind = 'BIAYA' | 'RUSAK_CEPAT' | 'PEMELIHARAAN';
export const RESPONSES = ['JELASKAN', 'JADWALKAN_UJI', 'TOLAK'] as const;
export type FlagResponse = (typeof RESPONSES)[number];

export interface AuditFlag {
  id: string;
  kind: FlagKind;
  caseId: string;
  segmentId: string;
  title: string;
  detail: string;
  possibleCauses: string[];
  recommendedTests: string[];
  fairness?: FairnessResult;
  response: { response: FlagResponse; reason: string; by: string; at: string; testResult?: string | null } | null;
}

interface ResponseRecord {
  flagId: string;
  response: FlagResponse;
  reason: string;
  by: string;
  at: string;
  testResult?: string | null;
}

function pct10(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.floor(0.1 * (s.length - 1)))];
}

export function auditFlags(cases: ReportCase[], confirmations: RepairConfirmation[], book: PriceBook, responses: ResponseRecord[], minThicknessCm: Record<string, number | null> = {}, now = Date.now()): AuditFlag[] {
  const latest = new Map<string, ResponseRecord>();
  for (const r of responses) latest.set(r.flagId, r);
  const flags: AuditFlag[] = [];
  const byId = new Map(cases.map((c) => [c.id, c]));
  const lives = repairLives(cases, confirmations, now);

  for (const c of cases) {
    const rep = c.workOrder?.repair;
    if (!rep || !c.history.some((h) => h.action === 'RESOLVE')) continue;
    const f = fairCost({ materialId: rep.materialId, thicknessCm: rep.thicknessCm, areaM2: rep.areaM2, valueIdr: rep.valueIdr }, book);
    if (f.status === 'PERLU_KLARIFIKASI') {
      flags.push({ id: `BIAYA:${c.id}`, kind: 'BIAYA', caseId: c.id, segmentId: c.segmentId, title: 'Perlu klarifikasi biaya', detail: f.reason!, possibleCauses: ['volume atau tebal tercatat berbeda dengan pekerjaan', 'harga satuan daerah berbeda dari buku harga', 'pekerjaan tambahan yang tidak tercatat'], recommendedTests: ['cocokkan dengan dokumen kontrak / back-up volume', 'perbarui buku harga dengan HSPK daerah'], fairness: f, response: null });
    }
  }

  for (const l of lives) {
    const c = byId.get(l.caseId);
    if (!c || l.censored) continue;
    const peers = lives.filter((p) => !p.censored && p.method === l.method && p.caseId !== l.caseId).map((p) => p.days);
    const rep = c.workOrder?.repair;
    const thin = rep && minThicknessCm[rep.materialId] ? rep.thicknessCm < (minThicknessCm[rep.materialId] as number) : false;
    const causes = ['beban berlebih (ODOL)', 'drainase buruk / genangan', thin ? 'tebal di bawah spesifikasi (tercatat)' : 'tebal di bawah spesifikasi', rep?.compactor === 'TIDAK_ADA' ? 'tanpa alat pemadat (tercatat)' : 'pemadatan tidak memadai', 'data input salah'];
    const tests = ['core untuk tebal lapisan', 'uji DCP tanah dasar', 'cek drainase dan genangan'];
    if (peers.length >= MIN_PEER && l.days < pct10(peers)) {
      flags.push({ id: `RUSAK_CEPAT:${c.id}`, kind: 'RUSAK_CEPAT', caseId: c.id, segmentId: c.segmentId, title: 'Rusak lebih cepat dari perbaikan sejenis', detail: `Rusak lagi setelah ${Math.round(l.days)} hari; 90% perbaikan dengan metode yang sama bertahan lebih dari ${Math.round(pct10(peers))} hari (n=${peers.length}).`, possibleCauses: causes, recommendedTests: tests, response: null });
    }
    if (l.inMaintenance) {
      flags.push({ id: `PEMELIHARAAN:${c.id}`, kind: 'PEMELIHARAAN', caseId: c.id, segmentId: c.segmentId, title: 'Masih dalam masa pemeliharaan', detail: `Kerusakan muncul lagi sebelum masa pemeliharaan berakhir (${new Date(l.maintenanceEndsAt!).toLocaleDateString('id-ID')}). Minta pelaksana memperbaiki sesuai kontrak.`, possibleCauses: causes, recommendedTests: tests, response: null });
    }
  }

  return flags.map((f) => {
    const r = latest.get(f.id);
    return r ? { ...f, response: { response: r.response, reason: r.reason, by: r.by, at: r.at, testResult: r.testResult ?? null } } : f;
  });
}

/** Cases the public sees as "Sedang dalam pemeriksaan teknis": open flags or a scheduled test. */
export function underReview(flags: AuditFlag[]): string[] {
  return [...new Set(flags.filter((f) => !f.response || f.response.response === 'JADWALKAN_UJI').map((f) => f.caseId))];
}
