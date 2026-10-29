/** SPEC M6: fair cost from labelled prices, neutral audit flags, public review status. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fairCost, type PriceBook } from '../../src/domain/audit/fairness';
import { auditFlags, underReview } from '../../src/domain/audit/flags';
import type { ReportCase } from '../../src/domain/workflow/model';

const book: PriceBook = JSON.parse(fs.readFileSync('config/prices/jabodetabek.json', 'utf8'));
const DAY = 86_400_000;
const T0 = Date.parse('2026-01-01T00:00:00Z');
const iso = (d: number) => new Date(T0 + d * DAY).toISOString();

test('fair cost: tonnage x price + tack coat, x work factor; every line keeps its label and source', () => {
  const r = fairCost({ materialId: 'AC-WC', thicknessCm: 4, areaM2: 100, valueIdr: 30_000_000 }, book);
  assert.equal(r.volumeM3, 4);
  assert.equal(r.tonnage, 9.2);
  assert.equal(r.fairCostIdr, Math.round((9.2 * 1_850_000 + 100 * 0.25 * 11_565) * 1.15));
  assert.equal(r.status, 'PERLU_KLARIFIKASI');
  assert.ok(r.diffPct! > 20);
  assert.ok(r.breakdown.every((b) => b.label && b.source));
  assert.equal(fairCost({ materialId: 'AC-WC', thicknessCm: 4, areaM2: 100, valueIdr: 20_000_000 }, book).status, 'OK');
  assert.equal(fairCost({ materialId: 'COLD-MIX', thicknessCm: 4, areaM2: 1, valueIdr: 1 }, book).status, 'TIDAK_DAPAT_DIHITUNG', 'no price, no number');
  assert.equal(fairCost({ materialId: 'AC-WC', thicknessCm: 4, areaM2: 1, valueIdr: null }, book).diffPct, null);
});

const repaired = (id: string, day: number, coords: [number, number], extra: Record<string, unknown> = {}) =>
  ({
    id, segmentId: 'S1', dataStatus: 'USER_GENERATED', state: 'CLOSED', createdAt: iso(day - 5), createdBy: { id: 'c' }, report: { coordinates: coords },
    history: [{ action: 'SUBMIT', at: iso(day - 5) }, { action: 'RESOLVE', at: iso(day) }],
    workOrder: { completedAt: iso(day), maintenanceMonths: null, repair: { method: 'TAMBAL_DINGIN', materialId: 'AC-WC', thicknessCm: 4, areaM2: 2, compactor: 'TIDAK_ADA', category: 'SEMENTARA', valueIdr: null } },
    ...extra
  }) as unknown as ReportCase;
const newReport = (id: string, day: number, coords: [number, number]) =>
  ({ id, segmentId: 'S1', dataStatus: 'USER_GENERATED', state: 'NEEDS_REVIEW', createdAt: iso(day), createdBy: { id: 'x' }, report: { coordinates: coords }, history: [] }) as unknown as ReportCase;

test('flags are neutral, cite measured peers, and the public only sees "under review"', () => {
  const spots = Array.from({ length: 7 }, (_, i) => [-6.2 - i * 0.01, 106.8] as [number, number]);
  const cases: ReportCase[] = [];
  // six peers fail after 60-110 days, the seventh after 5 days
  spots.forEach((p, i) => {
    cases.push(repaired(`R${i}`, 0, p));
    cases.push(newReport(`N${i}`, i === 6 ? 5 : 60 + i * 10, [p[0] + 0.00003, p[1]]));
  });
  cases.push(repaired('COST', 0, [-7, 107], { workOrder: { completedAt: iso(0), repair: { method: 'OVERLAY', materialId: 'AC-WC', thicknessCm: 4, areaM2: 100, compactor: 'ROLLER', category: 'PERMANEN', valueIdr: 40_000_000 } } }));
  const flags = auditFlags(cases, [], book, [], { 'AC-WC': 4 }, T0 + 200 * DAY);
  const early = flags.filter((f) => f.kind === 'RUSAK_CEPAT');
  assert.deepEqual(early.map((f) => f.caseId), ['R6']);
  assert.ok(early[0].possibleCauses.includes('tanpa alat pemadat (tercatat)'));
  assert.ok(flags.some((f) => f.kind === 'BIAYA' && f.caseId === 'COST'));
  for (const f of flags) for (const word of [/korupsi/i, /mark-?up/i, /nakal/i, /lalai/i]) assert.doesNotMatch(`${f.title} ${f.detail}`, word);
  assert.deepEqual(underReview(flags).sort(), ['COST', 'R6']);
  const answered = auditFlags(cases, [], book, [{ flagId: 'BIAYA:COST', response: 'JELASKAN', reason: 'Termasuk pekerjaan drainase', by: 'OPS', at: iso(201) }], { 'AC-WC': 4 }, T0 + 200 * DAY);
  assert.deepEqual(underReview(answered), ['R6'], 'an explained flag is no longer "under review"');
});
