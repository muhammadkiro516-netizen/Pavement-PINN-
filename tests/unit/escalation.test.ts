/** SPEC M3: hourglass, escalation ladder, pause by a pending reason, complaint draft, report card. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { complaintDraft, escalationOf, reached } from '../../src/domain/workflow/escalation';
import { applyCommand } from '../../src/domain/workflow/stateMachine';
import { reportCards } from '../../src/domain/workflow/reportCard';
import { MemoryCaseStore, WorkflowService } from '../../src/domain/workflow/service';
import type { ReportCase } from '../../src/domain/workflow/model';

const DAY = 86_400_000;
const T0 = Date.parse('2026-01-01T00:00:00Z');
const iso = (d: number) => new Date(T0 + d * DAY).toISOString();
const open = (extra: Record<string, unknown> = {}) => ({ state: 'NEEDS_REVIEW' as const, createdAt: iso(0), ...extra });

test('the ladder rises at H+2 (Koordinator), H+7 (Pimpinan), H+14 (public), H+30 (complaint)', () => {
  const at = (d: number) => escalationOf(open(), T0 + d * DAY + 1000).level;
  assert.deepEqual([at(1), at(2), at(6), at(7), at(13), at(14), at(29), at(30)], ['NONE', 'KOORDINATOR', 'KOORDINATOR', 'PIMPINAN', 'PIMPINAN', 'PUBLIK', 'PUBLIK', 'PENGADUAN']);
  assert.equal(escalationOf(open(), T0 + 9 * DAY).waitingDays, 9);
  assert.equal(escalationOf({ state: 'CLOSED', createdAt: iso(0) }, T0 + 40 * DAY).level, 'NONE', 'closed reports never escalate');
});

test('a pending reason pauses the ladder until its date, then the clock restarts from that date', () => {
  const pending = { code: 'CUACA_MUSIM_HUJAN' as const, until: iso(60), note: 'permanen setelah musim hujan', by: 'OPS', at: iso(20) };
  const paused = escalationOf(open({ pending }), T0 + 40 * DAY);
  assert.equal(paused.paused, true);
  assert.equal(paused.level, 'NONE');
  assert.equal(paused.waitingDays, 40, 'the hourglass still shows the real wait');
  const after = escalationOf(open({ pending }), T0 + 68 * DAY);
  assert.equal(after.paused, false);
  assert.equal(after.ladderDays, 8);
  assert.equal(after.level, 'PIMPINAN');
  assert.ok(reached(after, 'KOORDINATOR') && !reached(after, 'PUBLIK'));
});

test('SET_PENDING: Koordinator only, reason and a date within 12 months required; state unchanged', () => {
  const c = { id: 'R', version: 1, state: 'VERIFIED', history: [], approvals: [], report: {}, createdAt: iso(0) } as unknown as ReportCase;
  const ctx = (role: string) => ({ actor: { id: 'U', role: role as never, kind: 'ACCOUNT' as const }, now: iso(5), newId: (p: string) => `${p}-1`, expectedVersion: 1, roleOf: () => null });
  const cmd = { action: 'SET_PENDING' as const, reason: 'Anggaran perubahan Juni', code: 'MENUNGGU_ANGGARAN' as const, until: iso(90) };
  assert.equal((applyCommand(c, cmd, ctx('FIELD_ENGINEER')) as { ok: boolean }).ok, false);
  assert.equal((applyCommand(c, { ...cmd, reason: ' ' }, ctx('OPERATIONS_MANAGER')) as { ok: boolean }).ok, false);
  assert.equal((applyCommand(c, { ...cmd, until: iso(500) }, ctx('OPERATIONS_MANAGER')) as { ok: boolean }).ok, false);
  const r = applyCommand(c, cmd, ctx('OPERATIONS_MANAGER')) as { ok: true; next: ReportCase };
  assert.equal(r.ok, true);
  assert.equal(r.next.state, 'VERIFIED');
  assert.equal(r.next.pending?.code, 'MENUNGGU_ANGGARAN');
});

test('the complaint draft states facts only: no accusations, no names, never sent automatically', () => {
  const text = complaintDraft({ caseId: 'REP-1', damage: 'Lubang', location: 'Jl. Raya Klari', coordinates: [-6.3, 107.3], createdAt: iso(0), agency: 'Dinas PUPR Kabupaten Karawang', waitingDays: 31, statusLabel: 'Perlu ditinjau' });
  assert.match(text, /31 hari/);
  assert.match(text, /SP4N-LAPOR!/);
  assert.match(text, /tidak dikirim oleh aplikasi/);
  for (const banned of [/korupsi/i, /mark-?up/i, /nakal/i, /lalai/i]) assert.doesNotMatch(text, banned);
});

test('"Saya juga melihat ini": one per account, not by the reporter, and it becomes the support count', async () => {
  const store = new MemoryCaseStore();
  let n = 0;
  const service = new WorkflowService(store, { now: () => iso(1), newId: (p: string) => `${p}-${++n}` } as never);
  const snap = await store.load();
  await store.commit({ ...snap, revision: snap.revision + 1, cases: [{ id: 'R1', createdBy: { id: 'OWNER' }, report: { upvotesCount: 0 } } as unknown as ReportCase] });
  assert.equal((await service.addWitness({ caseId: 'R1', by: 'OWNER', photoUrl: null })).ok, false);
  assert.equal((await service.addWitness({ caseId: 'R1', by: 'A', photoUrl: null })).ok, true);
  assert.equal((await service.addWitness({ caseId: 'R1', by: 'A', photoUrl: null })).ok, false, 'once per account');
  await service.addWitness({ caseId: 'R1', by: 'B', photoUrl: null });
  assert.equal((await service.getCase('R1'))!.report.upvotesCount, 2);
  assert.deepEqual(await service.witnessedBy('A'), ['R1']);
});

test('report card: response within 48 h, open > 14 days, publishable only from 10 reports', () => {
  const mk = (id: string, created: number, first: number | null, state = 'VERIFIED') =>
    ({ id, dataStatus: 'USER_GENERATED', state, createdAt: iso(created), authority: { name: 'Sudin BM Jaktim' }, report: { coordinates: [-6.2, 106.9] }, history: [{ action: 'SUBMIT', at: iso(created) }, ...(first === null ? [] : [{ action: 'REVIEW_ACCEPT', at: iso(first) }])] }) as unknown as ReportCase;
  const cases = [mk('a', 0, 1), mk('b', 0, 5), mk('c', 10, null, 'NEEDS_REVIEW')];
  const [card] = reportCards(cases, [], T0 + 30 * DAY);
  assert.equal(card.respondedIn48hPct, 50);
  assert.equal(card.openOver14Pct, 100);
  assert.equal(card.publishable, false);
  assert.equal(card.held3mPct, null, 'no repairs yet: no number');
  assert.equal(reportCards(Array.from({ length: 10 }, (_, i) => mk(`x${i}`, 0, 1)), [], T0 + DAY * 30)[0].publishable, true);
});
