/** SPEC M2.1-M2.4: repair life from recorded events, honest denominators, maintenance flags. */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dueConfirmations, recurrence, repairLives, statsByMethod, type RepairConfirmation } from '../../src/domain/roads/recurrence';
import { validRepair } from '../../src/domain/workflow/stateMachine';
import { startRecurrenceJob } from '../../server/jobs/recurrenceJob';
import type { ReportCase } from '../../src/domain/workflow/model';

const DAY = 86_400_000;
const T0 = Date.parse('2026-01-01T00:00:00Z');
const iso = (d: number) => new Date(T0 + d * DAY).toISOString();
const SPOT: [number, number] = [-6.2, 106.85];
const NEAR: [number, number] = [-6.20005, 106.85]; // ~5.6 m away
const FAR: [number, number] = [-6.21, 106.85]; // ~1.1 km away

function repaired(id: string, day: number, method: string, extra: Record<string, unknown> = {}): ReportCase {
  return {
    id, segmentId: 'SEG-1', dataStatus: 'USER_GENERATED', state: 'CLOSED', createdAt: iso(day - 10), createdBy: { id: 'ME' },
    report: { coordinates: SPOT }, history: [{ action: 'SUBMIT', at: iso(day - 10) }, { action: 'RESOLVE', at: iso(day) }],
    workOrder: { completedAt: iso(day - 1), maintenanceMonths: null, repair: { method, category: 'SEMENTARA' } }, ...extra
  } as unknown as ReportCase;
}
const report = (id: string, day: number, at: [number, number], history: Array<{ action: string; at: string }> = []) =>
  ({ id, segmentId: 'SEG-1', dataStatus: 'USER_GENERATED', state: 'NEEDS_REVIEW', createdAt: iso(day), createdBy: { id: 'X' }, report: { coordinates: at }, history }) as unknown as ReportCase;

test('a repair fails at the first new report within 10 m; far or invalid reports do not count', () => {
  const cases = [
    repaired('A', 0, 'TAMBAL_DINGIN'),
    report('far', 5, FAR),
    report('invalid', 10, NEAR, [{ action: 'CLOSE_INVALID', at: iso(11) }]),
    report('B', 40, NEAR)
  ];
  const [life] = repairLives(cases, [], T0 + 200 * DAY);
  assert.equal(life.caseId, 'A');
  assert.equal(life.censored, false);
  assert.equal(Math.round(life.days), 40);
  assert.deepEqual(life.failedBy, { kind: 'NEW_REPORT', caseId: 'B' });
});

test('a citizen "berlubang lagi" confirmation also ends the repair life', () => {
  const conf: RepairConfirmation = { id: 'C1', caseId: 'A', at: iso(31), by: 'ME', milestone: 1, result: 'BROKEN', photoUrl: null };
  const [life] = repairLives([repaired('A', 0, 'TAMBAL_DINGIN')], [conf], T0 + 200 * DAY);
  assert.equal(Math.round(life.days), 31);
  assert.equal(life.failedBy?.kind, 'CONFIRMATION');
});

test('recurrence counts only repairs observed for the whole window (no young-repair bias)', () => {
  const now = T0 + 100 * DAY;
  const cases = [
    repaired('A', 0, 'TAMBAL_DINGIN'), report('A2', 20, NEAR), // failed at 20 d
    { ...repaired('B', 0, 'TAMBAL_PANAS'), report: { coordinates: FAR } } as ReportCase, // survived 100 d
    { ...repaired('C', 90, 'TAMBAL_PANAS'), report: { coordinates: [-6.3, 106.9] } } as ReportCase // only 10 d old
  ];
  const lives = repairLives(cases, [], now);
  const r = recurrence(lives, 3);
  assert.deepEqual([r.recurred, r.observed, r.tooRecent, r.pct], [1, 2, 1, 50]);
  const byMethod = statsByMethod(lives);
  const cold = byMethod.find((m) => m.method === 'TAMBAL_DINGIN')!;
  assert.deepEqual([cold.repairs, cold.failed, Math.round(cold.medianFailDays!)], [1, 1, 20]);
  assert.equal(byMethod.find((m) => m.method === 'TAMBAL_PANAS')!.failed, 0);
});

test('damage inside the stated maintenance period is flagged; without a period there is no flag', () => {
  const withPeriod = repaired('A', 0, 'OVERLAY', { workOrder: { completedAt: iso(-1), maintenanceMonths: 6, repair: { method: 'OVERLAY', category: 'PERMANEN' } } });
  const [flagged] = repairLives([withPeriod, report('B', 60, NEAR)], [], T0 + 300 * DAY);
  assert.equal(flagged.inMaintenance, true);
  const [plain] = repairLives([repaired('A', 0, 'OVERLAY'), report('B', 60, NEAR)], [], T0 + 300 * DAY);
  assert.equal(plain.inMaintenance, false);
  assert.equal(plain.maintenanceEndsAt, null);
});

test('1/3/6-month confirmations: only the latest reached milestone is open, once per account, reporter or within 300 m', () => {
  const cases = [repaired('A', 0, 'TAMBAL_PANAS')];
  assert.deepEqual(dueConfirmations(cases, [], 'ME', T0 + 20 * DAY), []);
  assert.deepEqual(dueConfirmations(cases, [], 'ME', T0 + 40 * DAY).map((d) => d.milestone), [1]);
  assert.deepEqual(dueConfirmations(cases, [], 'ME', T0 + 100 * DAY).map((d) => d.milestone), [3]);
  const answered: RepairConfirmation = { id: 'C', caseId: 'A', at: iso(100), by: 'ME', milestone: 3, result: 'OK', photoUrl: null };
  assert.deepEqual(dueConfirmations(cases, [answered], 'ME', T0 + 120 * DAY), []);
  assert.deepEqual(dueConfirmations(cases, [], 'NEIGHBOUR', T0 + 40 * DAY), [], 'not the reporter and no position');
  assert.equal(dueConfirmations(cases, [], 'NEIGHBOUR', T0 + 40 * DAY, NEAR).length, 1);
  assert.equal(dueConfirmations(cases, [], 'NEIGHBOUR', T0 + 40 * DAY, FAR).length, 0);
});

test('repair evidence must name method, material, thickness, area, compaction and category', () => {
  const ok = { method: 'TAMBAL_PANAS', materialId: 'AC-WC', thicknessCm: 5, areaM2: 2, compactor: 'ROLLER', category: 'PERMANEN', valueIdr: '' };
  assert.equal(typeof validRepair(ok), 'object');
  assert.equal((validRepair(ok) as { valueIdr: unknown }).valueIdr, null);
  for (const bad of [{ ...ok, method: 'X' }, { ...ok, materialId: '' }, { ...ok, thicknessCm: 0 }, { ...ok, areaM2: -1 }, { ...ok, compactor: 'KAKI' }, { ...ok, category: 'X' }, undefined]) {
    assert.equal(typeof validRepair(bad), 'string');
  }
});

test('the recurrence job writes measurements at start and then on its interval', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  const file = path.join(dir, 'recurrence.json');
  let calls = 0;
  const src = { listCases: async () => { calls += 1; return [repaired('A', 0, 'TAMBAL_DINGIN'), report('B', 30, NEAR)]; }, listRepairConfirmations: async () => [] };
  const stop = startRecurrenceJob(src, file, 1000);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1);
  mock.timers.tick(1000);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 2);
  stop();
  mock.timers.reset();
  const out = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(out.label, 'TERUKUR');
  assert.equal(out.repairs, 1);
  assert.equal(out.recurrence3m.recurred, 1);
});
