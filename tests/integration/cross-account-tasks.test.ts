/**
 * Cross-account hand-off R.E → M.O → F.E → D.M as each account's screens derive it:
 * one report id travels through real HTTP sessions (fresh login per step), and for every
 * role the task list ("Tugas Saya"), the sidebar badge and the notification bell are
 * computed from what that account's own session reads back from the server.
 * The server-side golden path, permissions, restart persistence and failed writes are
 * covered in workflow-api.test.ts; this file covers what the client builds on top.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../../server/app';
import { createWorkflowRuntime } from '../../server/services/workflowRuntime';
import { FileCaseStore } from '../../server/repositories/fileCaseStore';
import { INITIAL_COMMUNITY_REPORTS } from '../../src/data/mock/communityReports';
import { INDONESIAN_ROAD_SEGMENTS } from '../../src/data/reference/indonesianRoads';
import { KARAWANG_PILOT_SEGMENTS } from '../../src/data/reference/karawangPilot';

const ROAD_SEGMENTS = [...KARAWANG_PILOT_SEGMENTS, ...INDONESIAN_ROAD_SEGMENTS];
import { demoLoginFor } from '../../src/data/reference/demoCredentials';
import { fieldTasks, tasksDue } from '../../src/features/work-orders/fieldTasks';
import { workflowNotifications } from '../../src/features/workflow/notifications';
import { OfflineWorkflowGateway, type ReportView } from '../../src/services/api/workflowClient';
import { bodyWithSession } from '../helpers/sessionCookie';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const DUE = new Date(Date.now() + 4 * 86400000).toISOString();

const dataDir = mkdtempSync(path.join(tmpdir(), 'pinn-handoff-'));
let server: Server;
let base = '';

before(async () => {
  const store = new FileCaseStore(dataDir);
  const workflow = createWorkflowRuntime({ store, storeKind: 'file', storeLocation: store.location, sessionSecret: 'y'.repeat(40) });
  await workflow.ready;
  await new Promise<void>((resolve) => {
    server = createApp({ workflow }).listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dataDir, { recursive: true, force: true });
});

async function call(method: string, p: string, body?: unknown, token?: string) {
  const res = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await bodyWithSession(res) };
}

/**
 * One server session per account (the login endpoint allows 20 attempts a minute); every read
 * still goes back to the server. A forced re-login at the end proves nothing lives in the client.
 */
const tokens = new Map<string, string>();
const login = async (accountId: string, fresh = false) => {
  if (fresh || !tokens.has(accountId)) {
    const r = await call('POST', '/api/auth/login', demoLoginFor(accountId));
    assert.equal(r.status, 200, `login ${accountId}: ${JSON.stringify(r.body)}`);
    tokens.set(accountId, r.body.token);
  }
  return tokens.get(accountId)!;
};
/** What this account's screens would load: its own server read of all reports. */
const viewsOf = async (accountId: string): Promise<ReportView[]> => (await call('GET', '/api/workflow/reports', undefined, await login(accountId))).body.items;

const RE = 'USR-004';
const MO = 'USR-008';
const FE = 'USR-006';
/** Same person as FE (classic-portal account); another engineer is covered in tests/unit/people.test.ts. */
const FE_CLASSIC = 'USR-001';
const DM = 'USR-007';

test('one report id travels R.E → M.O → F.E → D.M with consistent tasks, badges and notifications', async () => {
  // R.E submits a report and receives its id.
  const { id: _id, status: _s, creatorAccountId: _c, creatorRole: _r, origin: _o, createdAt: _t, ...content } = INITIAL_COMMUNITY_REPORTS[0];
  void _id; void _s; void _c; void _r; void _o; void _t;
  const created = await call('POST', '/api/workflow/reports', { report: { ...content, coordinates: [-6.3672, 107.4011], photoUrl: PNG, description: 'Uji alur lintas akun' } }, await login(RE));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.report.case.id as string;

  // M.O sees the same id in its queue and gets a notification about it.
  let mo = await viewsOf(MO);
  const moCase = mo.find((v) => v.case.id === id)!;
  assert.equal(moCase.audience, 'STAFF');
  assert.equal(moCase.case.state, 'NEEDS_REVIEW');
  assert.ok(workflowNotifications(mo, { id: MO, role: 'OPERATIONS_MANAGER' }).some((n) => n.caseId === id && n.kind === 'REVIEW'));

  let version = moCase.case.version;
  const act = async (accountId: string, command: object) => {
    const r = await call('POST', `/api/workflow/reports/${id}/transitions`, { command, expectedVersion: version }, await login(accountId));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    version = r.body.report.case.version;
  };

  await act(MO, { action: 'REVIEW_ACCEPT', reason: 'Bukti cukup.' });
  await act(MO, { action: 'REQUEST_INSPECTION', reason: 'Koridor pilot', engineerId: FE, dueAt: DUE, instructions: 'Ukur kedalaman.' });

  // F.E: the assignment is a task with "Mulai Tugas", the badge counts it, the bell announces it.
  let fe = await viewsOf(FE);
  let tasks = fieldTasks(fe, FE);
  const task = tasks.find((t) => t.c.id === id)!;
  assert.ok(task, 'assigned case appears in Tugas Saya of the assigned engineer');
  assert.deepEqual(task.cta, { action: 'SUBMIT_INSPECTION', label: 'Mulai Tugas' });
  assert.equal(task.c.report.description, 'Uji alur lintas akun', 'task carries the original report context');
  assert.equal(task.c.assignment!.assignedBy, MO);
  assert.equal(tasksDue(tasks), 1);
  assert.ok(workflowNotifications(fe, { id: FE, role: 'FIELD_ENGINEER' }).some((n) => n.caseId === id && n.kind === 'ASSIGNED'));

  // The same engineer on the classic portal sees the same task and notification (one person, two accounts).
  const classic = await viewsOf(FE_CLASSIC);
  assert.equal(fieldTasks(classic, FE_CLASSIC).some((t) => t.c.id === id), true);
  assert.ok(workflowNotifications(classic, { id: FE_CLASSIC, role: 'FIELD_ENGINEER' }).some((n) => n.caseId === id));


  // Only M.O decides; a reason is mandatory for every M.O decision.
  const refuse = async (action: string) => {
    const noReason = await call('POST', `/api/workflow/reports/${id}/transitions`, { command: { action, reason: '' }, expectedVersion: version }, await login(MO));
    assert.ok(noReason.status >= 400 && noReason.status < 500, `${action} without a reason is refused`);
    for (const outsider of [RE, FE, FE_CLASSIC, DM]) {
      const r = await call('POST', `/api/workflow/reports/${id}/transitions`, { command: { action, reason: 'x' }, expectedVersion: version }, await login(outsider));
      assert.ok(r.status === 403 || r.status === 404, `${outsider} may not ${action} (got ${r.status})`);
    }
  };

  // 1) F.E submits the inspection → it waits on M.O verification (no recommendation yet).
  await act(FE, { action: 'SUBMIT_INSPECTION', verdict: 'CONFIRMED', cvReview: { accepted: true, correctedClass: null }, measuredDepthCm: 9, measuredAreaM2: 2, severity: 'SEVERE', notes: 'Terkonfirmasi.' });
  tasks = fieldTasks(await viewsOf(FE), FE);
  assert.equal(tasks.find((t) => t.c.id === id)!.title, 'Menunggu Verifikasi M.O');
  assert.equal(tasksDue(tasks), 0);
  assert.ok(workflowNotifications(await viewsOf(MO), { id: MO, role: 'OPERATIONS_MANAGER' }).some((n) => n.caseId === id && n.title === 'Hasil inspeksi F.E menunggu verifikasi Anda'));
  const early = await call('POST', `/api/workflow/reports/${id}/transitions`, { command: { action: 'RECOMMEND_ACTION', treatment: 'x', urgency: 'ROUTINE', rationale: 'x', assessmentId: null }, expectedVersion: version }, await login(FE));
  assert.ok(early.status >= 400, 'no recommendation before the inspection is verified');

  // 2) M.O asks for a re-inspection: back to the same F.E with the reason.
  await refuse('REQUEST_REINSPECTION');
  await act(MO, { action: 'REQUEST_REINSPECTION', reason: 'Foto kurang jelas; ukur ulang luas kerusakan.' });
  tasks = fieldTasks(await viewsOf(FE), FE);
  let back = tasks.find((t) => t.c.id === id)!;
  assert.equal(back.c.state, 'FIELD_INSPECTION_REQUESTED');
  assert.equal(back.title, 'Inspeksi ulang diminta M.O');
  assert.equal(back.returned?.reason, 'Foto kurang jelas; ukur ulang luas kerusakan.');
  assert.deepEqual(back.cta, { action: 'SUBMIT_INSPECTION', label: 'Perbaiki Inspeksi' });
  assert.equal(tasksDue(tasks), 1);

  // 3) F.E re-inspects; M.O verifies the inspection (its own audited decision).
  await act(FE, { action: 'SUBMIT_INSPECTION', verdict: 'CONFIRMED', cvReview: { accepted: true, correctedClass: null }, measuredDepthCm: 9, measuredAreaM2: 2.4, severity: 'SEVERE', notes: 'Diukur ulang, foto jarak dekat.' });
  await refuse('VERIFY_INSPECTION');
  await act(MO, { action: 'VERIFY_INSPECTION', reason: 'Ukuran dan foto sesuai.' });
  tasks = fieldTasks(await viewsOf(FE), FE);
  assert.deepEqual(tasks.find((t) => t.c.id === id)!.cta, { action: 'RECOMMEND_ACTION', label: 'Ajukan Penanganan' });

  // 4) F.E recommends; M.O and D.M read the same verified inspection and recommendation.
  await act(FE, { action: 'RECOMMEND_ACTION', treatment: 'Patching', urgency: 'PRIORITY', rationale: 'Lajur berat.', assessmentId: null });
  tasks = fieldTasks(await viewsOf(FE), FE);
  assert.equal(tasks.find((t) => t.c.id === id)!.title, 'Menunggu persetujuan penanganan');
  assert.equal(tasksDue(tasks), 0, 'badge clears when it is not the engineer’s turn');
  mo = await viewsOf(MO);
  const dm = await viewsOf(DM);
  for (const views of [mo, dm]) {
    const c = views.find((v) => v.case.id === id)!.case as any;
    assert.equal(c.state, 'ACTION_RECOMMENDED');
    assert.equal(c.inspection.measuredAreaM2, 2.4);
    assert.equal(c.recommendation.treatment, 'Patching');
    assert.equal(c.recommendation.assessment.engine, 'EVIDENCE');
  }
  assert.ok(workflowNotifications(mo, { id: MO, role: 'OPERATIONS_MANAGER' }).some((n) => n.caseId === id && n.title === 'Rekomendasi menunggu persetujuan Anda'));
  assert.ok(workflowNotifications(dm, { id: DM, role: 'POLICY_MAKER' }).some((n) => n.caseId === id && n.title === 'Rekomendasi penanganan baru'));
  assert.deepEqual(dm.find((v) => v.case.id === id)!.availableActions, [], 'D.M reviews priority; approval stays with M.O');

  // 5) M.O returns the recommendation; the inspection stays verified.
  await refuse('REJECT_ACTION');
  await act(MO, { action: 'REJECT_ACTION', reason: 'Tambahkan opsi overlay.' });
  tasks = fieldTasks(await viewsOf(FE), FE);
  back = tasks.find((t) => t.c.id === id)!;
  assert.equal(back.c.state, 'INSPECTION_VERIFIED');
  assert.equal(back.title, 'Rekomendasi dikembalikan M.O');
  assert.equal(back.returned?.reason, 'Tambahkan opsi overlay.');
  assert.deepEqual(back.cta, { action: 'RECOMMEND_ACTION', label: 'Ajukan Ulang Penanganan' });

  // 6) F.E resubmits; M.O approves the operational treatment.
  await act(FE, { action: 'RECOMMEND_ACTION', treatment: 'Patching + overlay', urgency: 'PRIORITY', rationale: 'Lajur berat; opsi overlay ditambahkan.', assessmentId: null });
  await refuse('APPROVE_ACTION');
  await act(MO, { action: 'APPROVE_ACTION', reason: 'Sesuai prioritas.' });
  fe = await viewsOf(FE);
  assert.ok(workflowNotifications(fe, { id: FE, role: 'FIELD_ENGINEER' }).some((n) => n.caseId === id && n.title.includes('disetujui')));
  assert.ok(workflowNotifications(await viewsOf(DM), { id: DM, role: 'POLICY_MAKER' }).some((n) => n.caseId === id && n.title === 'Penanganan disetujui M.O'));

  // R.E sees the status of their own report with public notes only, and is notified.
  const re = await viewsOf(RE);
  const mine = re.find((v) => v.case.id === id)!;
  assert.equal(mine.audience, 'PUBLIC');
  assert.equal(mine.case.state, 'ACTION_APPROVED');
  assert.doesNotMatch(JSON.stringify(mine), /Lajur berat|Ukur kedalaman|USR-00[0-35-9]/, 'no staff notes or staff ids');
  assert.equal((mine.case.report as any).repairDetails, undefined, 'client-sent repair evidence is not stored');
  assert.equal(mine.case.report.upvotesCount, 0);
  assert.ok(workflowNotifications(re, { id: RE, role: 'PUBLIC_REPORTER' }).some((n) => n.caseId === id));

  // Log in again as each role: the state, history and decision reasons are still there.
  for (const acc of [MO, FE, DM]) {
    const again = (await call('GET', '/api/workflow/reports', undefined, await login(acc, true))).body.items as ReportView[];
    const c = again.find((v) => v.case.id === id)!.case as any;
    assert.equal(c.state, 'ACTION_APPROVED');
    const actions = c.history.map((h: any) => h.action);
    assert.deepEqual(actions.slice(-8), ['SUBMIT_INSPECTION', 'REQUEST_REINSPECTION', 'SUBMIT_INSPECTION', 'VERIFY_INSPECTION', 'RECOMMEND_ACTION', 'REJECT_ACTION', 'RECOMMEND_ACTION', 'APPROVE_ACTION']);
    // The two M.O decisions are audited independently, each with actor, time and reason.
    assert.deepEqual(c.inspectionReviews.map((r: any) => [r.decision, r.decidedBy, r.reason]), [['REINSPECTION_REQUESTED', MO, 'Foto kurang jelas; ukur ulang luas kerusakan.'], ['VERIFIED', MO, 'Ukuran dan foto sesuai.']]);
    assert.deepEqual(c.approvals.map((a: any) => [a.decision, a.decidedBy, a.reason]), [['REJECTED', MO, 'Tambahkan opsi overlay.'], ['APPROVED', MO, 'Sesuai prioritas.']]);
    for (const r of [...c.inspectionReviews, ...c.approvals]) assert.ok(Date.parse(r.decidedAt) > 0);
  }
});

test('an assignment to the classic-portal account of an engineer reaches the same person on the modern app', async () => {
  // Reproduces the bug seen on localhost:3001: M.O picked USR-001, field.ahmad logs in as USR-006.
  const engineers = (await call('GET', '/api/workflow/engineers', undefined, await login(MO))).body.items as Array<{ id: string; name: string }>;
  assert.deepEqual(engineers.map((e) => e.id), [FE], 'one entry per person (canonical account)');
  const { id: _i, status: _s, creatorAccountId: _c, creatorRole: _r, origin: _o, createdAt: _t, ...content } = INITIAL_COMMUNITY_REPORTS[1];
  void _i; void _s; void _c; void _r; void _o; void _t;
  const created = await call('POST', '/api/workflow/reports', { report: { ...content, photoUrl: PNG, description: 'Penugasan ke akun klasik' } }, await login(RE));
  const caseId = created.body.report.case.id as string;
  let version = created.body.report.case.version;
  const act = async (accountId: string, command: object) => {
    const r = await call('POST', `/api/workflow/reports/${caseId}/transitions`, { command, expectedVersion: version }, await login(accountId));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    version = r.body.report.case.version;
  };
  await act(MO, { action: 'REVIEW_ACCEPT', reason: 'ok' });
  await act(MO, { action: 'REQUEST_INSPECTION', reason: 'ok', engineerId: FE_CLASSIC, dueAt: DUE, instructions: '' });
  const task = fieldTasks(await viewsOf(FE), FE).find((t) => t.c.id === caseId);
  assert.ok(task, 'USR-006 sees the task assigned to USR-001');
  assert.equal(task!.cta?.action, 'SUBMIT_INSPECTION');
  // Evidence photo: fake image bytes are refused by the server; a real image is stored with the inspection.
  const fake = await call('POST', `/api/workflow/reports/${caseId}/transitions`, { command: { action: 'SUBMIT_INSPECTION', verdict: 'CONFIRMED', cvReview: { accepted: true, correctedClass: null }, measuredDepthCm: 3, measuredAreaM2: 1, severity: 'MODERATE', notes: 'ok', evidencePhotoUrl: 'data:image/png;base64,QUFBQQ==' }, expectedVersion: version }, await login(FE));
  assert.equal(fake.status, 400, JSON.stringify(fake.body));
  await act(FE, { action: 'SUBMIT_INSPECTION', verdict: 'CONFIRMED', cvReview: { accepted: true, correctedClass: null }, measuredDepthCm: 3, measuredAreaM2: 1, severity: 'MODERATE', notes: 'ok', evidencePhotoUrl: PNG });
  const mo = (await call('GET', `/api/workflow/reports/${caseId}`, undefined, await login(MO))).body.report.case;
  assert.equal(mo.state, 'INSPECTED');
  assert.equal(mo.inspection.evidencePhotoUrl, PNG, 'M.O reads the same evidence photo');
});

test('offline demo gateway attaches the segment assessment to a recommendation, like the server', async () => {
  const gw = new OfflineWorkflowGateway(
    INITIAL_COMMUNITY_REPORTS,
    (id) => (id === 'USR-008' ? 'OPERATIONS_MANAGER' : id === 'USR-006' ? 'FIELD_ENGINEER' : null),
    [],
    ROAD_SEGMENTS,
    async (c) => (c.username === 'ops' ? 'USR-008' : c.username === 'eng' ? 'USR-006' : null)
  );
  await gw.login({ username: 'ops', password: 'x' });
  const target = (await gw.listReports()).find((v) => v.case.state === 'NEEDS_REVIEW' && ROAD_SEGMENTS.some((s) => s.id === v.case.segmentId))!;
  let v = await gw.transition(target.case.id, { action: 'REVIEW_ACCEPT', reason: 'ok' }, target.case.version);
  v = await gw.transition(target.case.id, { action: 'REQUEST_INSPECTION', reason: 'ok', engineerId: 'USR-006', dueAt: DUE, instructions: '' }, v.case.version);
  await gw.login({ username: 'eng', password: 'x' });
  v = await gw.transition(target.case.id, { action: 'SUBMIT_INSPECTION', verdict: 'CONFIRMED', cvReview: { accepted: true, correctedClass: null }, measuredDepthCm: 5, measuredAreaM2: 1, severity: 'MODERATE', notes: 'ok' }, v.case.version);
  await gw.login({ username: 'ops', password: 'x' });
  v = await gw.transition(target.case.id, { action: 'VERIFY_INSPECTION', reason: 'ok' }, v.case.version);
  await gw.login({ username: 'eng', password: 'x' });
  v = await gw.transition(target.case.id, { action: 'RECOMMEND_ACTION', treatment: 'Patching', urgency: 'ROUTINE', rationale: 'ok', assessmentId: null }, v.case.version);
  const rec = (v.case as any).recommendation;
  assert.equal(rec.assessment.engine, 'EVIDENCE');
  assert.equal(typeof rec.assessmentId, 'string');
});
