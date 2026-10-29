/**
 * P1: canonical report workflow (src/domain/workflow). Exercises the state machine and
 * the service against an in-memory store — the same code the API runs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCaseStore, WorkflowService } from '../../src/domain/workflow/service';
import { availableActions, SCREENING_CONFIDENCE_THRESHOLD, TRANSITIONS } from '../../src/domain/workflow/stateMachine';
import { CvScreeningProvider, DEMO_CV_PROVIDER, screenReport } from '../../src/domain/workflow/screening';
import { legacyStatusFor, toPublicView } from '../../src/domain/workflow/projections';
import type { Actor, ReportCase } from '../../src/domain/workflow/model';
import type { ReportDraft } from '../../src/domain/reports/reportFactory';
import { INITIAL_COMMUNITY_REPORTS } from '../../src/data/mock/communityReports';
import type { UserRole } from '../../src/types';

const CITIZEN: Actor = { id: 'USR-004', role: 'PUBLIC_REPORTER', kind: 'DEMO_ACCOUNT' };
const ANON: Actor = { id: 'anon-1f2e', role: 'PUBLIC_VIEWER', kind: 'ANONYMOUS' };
const OPS: Actor = { id: 'USR-008', role: 'OPERATIONS_MANAGER', kind: 'DEMO_ACCOUNT' };
const OPS2: Actor = { id: 'USR-002', role: 'OPERATIONS_MANAGER', kind: 'DEMO_ACCOUNT' };
const ENG: Actor = { id: 'USR-006', role: 'FIELD_ENGINEER', kind: 'DEMO_ACCOUNT' };
// A different engineer (person). USR-001 is the same person as USR-006 (classic portal), see domain/identity/people.ts.
const ENG_OTHER: Actor = { id: 'USR-099', role: 'FIELD_ENGINEER', kind: 'DEMO_ACCOUNT' };
const POLICY: Actor = { id: 'USR-007', role: 'POLICY_MAKER', kind: 'DEMO_ACCOUNT' };

const ROLES: Record<string, UserRole> = { 'USR-004': 'PUBLIC_REPORTER', 'USR-008': 'OPERATIONS_MANAGER', 'USR-002': 'OPERATIONS_MANAGER', 'USR-006': 'FIELD_ENGINEER', 'USR-001': 'FIELD_ENGINEER', 'USR-007': 'POLICY_MAKER' };

function draft(overrides: Partial<ReportDraft> = {}): ReportDraft {
  const { id, status, creatorAccountId, creatorRole, origin, createdAt, workflowState, caseVersion, ...content } = INITIAL_COMMUNITY_REPORTS[0];
  void id; void status; void creatorAccountId; void creatorRole; void origin; void createdAt; void workflowState; void caseVersion;
  return { ...content, ...overrides };
}

function setup(cv: CvScreeningProvider = DEMO_CV_PROVIDER) {
  let clock = Date.parse('2026-10-14T03:00:00.000Z');
  let seq = 0;
  const store = new MemoryCaseStore();
  const service = new WorkflowService(store, {
    now: () => new Date((clock += 1000)).toISOString(),
    newId: (prefix) => `${prefix}-${++seq}`,
    roleOf: (id) => ROLES[id] ?? null,
    cv
  });
  return { store, service };
}

const ok = <T>(r: { ok: true; value: T } | { ok: false; code: string; message: string }): T => {
  if (!r.ok) { const f = r as { code: string; message: string }; throw new Error(`${f.code}: ${f.message}`); }
  return r.value;
};

const codeOf = (r: { ok: boolean }) => (r.ok ? null : (r as unknown as { code: string }).code);

const DUE = '2026-10-20T00:00:00.000Z';

async function submitted(service: WorkflowService, actor: Actor = CITIZEN) {
  return ok(await service.submitReport(draft(), actor, null));
}

test('a submitted report is screened; the DEMO classifier always routes to human review', async () => {
  const { service } = setup();
  const c = await submitted(service);
  assert.equal(c.state, 'NEEDS_REVIEW');
  assert.deepEqual(c.history.map((h) => h.action), ['SUBMIT', 'BEGIN_SCREENING', 'SCREENING_NEEDS_REVIEW']);
  assert.equal(c.screening?.modelStatus, 'DEMO');
  assert.equal(c.screening?.passed, false);
  assert.match(c.screening!.reasons.join(' '), /DEMO/);
  assert.equal(c.report.creatorAccountId, 'USR-004');
  assert.equal(c.report.status, 'PENDING');
  assert.equal(c.report.workflowState, 'NEEDS_REVIEW');
});

test('server identity wins: client-sent ids and creator fields are discarded', async () => {
  const { service } = setup();
  const forged = { ...draft(), id: 'REP-FORGED', creatorAccountId: 'USR-008', creatorRole: 'OPERATIONS_MANAGER', status: 'REPAIRED' } as unknown as ReportDraft;
  const c = ok(await service.submitReport(forged, ANON, 'hash'));
  assert.notEqual(c.id, 'REP-FORGED');
  assert.equal(c.report.creatorAccountId, ANON.id);
  assert.equal(c.report.creatorRole, 'PUBLIC_VIEWER');
  assert.equal(c.claimTokenHash, 'hash');
  assert.equal(c.state, 'NEEDS_REVIEW');

  // A well-formed, unused factory id is kept (UI selection); a reused one is replaced.
  const kept = ok(await service.submitReport({ ...draft(), id: 'REP-00112233AABBCCDD' } as unknown as ReportDraft, CITIZEN, null));
  assert.equal(kept.id, 'REP-00112233AABBCCDD');
  const reused = ok(await service.submitReport({ ...draft(), id: 'REP-00112233AABBCCDD' } as unknown as ReportDraft, CITIZEN, null));
  assert.notEqual(reused.id, 'REP-00112233AABBCCDD');
});

test('only a REAL model with enough confidence passes screening automatically', () => {
  const real = (confidence: number): CvScreeningProvider => ({ status: 'REAL', modelVersion: 'yolov8n-seg@test', classify: () => ({ detectedClass: 'pothole', confidence }) });
  const report = { ...INITIAL_COMMUNITY_REPORTS[0], id: 'X', coordinates: [-6.36, 107.4] as [number, number] };
  assert.equal(screenReport(report, '2026-10-14T00:00:00Z', [], real(SCREENING_CONFIDENCE_THRESHOLD + 0.1)).passed, true);
  assert.equal(screenReport(report, '2026-10-14T00:00:00Z', [], real(SCREENING_CONFIDENCE_THRESHOLD - 0.1)).passed, false);
  assert.equal(screenReport(report, '2026-10-14T00:00:00Z', [], DEMO_CV_PROVIDER).passed, false);
  const unavailable: CvScreeningProvider = { status: 'MODEL_UNAVAILABLE', modelVersion: null, classify: () => null };
  const r = screenReport(report, '2026-10-14T00:00:00Z', [], unavailable);
  assert.equal(r.passed, false);
  assert.equal(r.confidence, null);
  assert.equal(r.detectedClass, null);
  const outside = screenReport({ ...report, coordinates: [51.5, -0.12] }, '2026-10-14T00:00:00Z', [], real(0.99));
  assert.equal(outside.passed, false);
});

test('a nearby open report of the same type is flagged as a possible duplicate', async () => {
  const real: CvScreeningProvider = { status: 'REAL', modelVersion: 'test', classify: () => ({ detectedClass: 'pothole', confidence: 0.95 }) };
  const { service } = setup(real);
  const first = await submitted(service);
  assert.equal(first.state, 'VERIFIED');
  const second = await submitted(service);
  assert.equal(second.state, 'NEEDS_REVIEW');
  assert.match(second.screening!.reasons.join(' '), new RegExp(`duplikat dari ${first.id}`));
});

test('cross-role golden path: review → assign → inspect → recommend → approve → work → resolve → close', async () => {
  const { service } = setup();
  let c = await submitted(service);
  const step = async (actor: Actor, command: Parameters<WorkflowService['transition']>[1]) => {
    c = ok(await service.transition(c.id, command, actor, c.version));
    return c;
  };
  await step(OPS, { action: 'REVIEW_ACCEPT', reason: 'Foto jelas, lokasi di koridor pilot.' });
  assert.equal(c.state, 'VERIFIED');
  await step(OPS, { action: 'REQUEST_INSPECTION', reason: 'Prioritas tinggi', engineerId: ENG.id, dueAt: DUE, instructions: 'Ukur kedalaman.' });
  assert.equal(c.assignment?.engineerId, ENG.id);
  await step(ENG, { action: 'SUBMIT_INSPECTION', verdict: 'CONFIRMED', cvReview: { accepted: false, correctedClass: 'ALLIGATOR_CRACK' }, measuredDepthCm: 9, measuredAreaM2: 3.2, severity: 'SEVERE', notes: 'Retak buaya meluas di lajur kiri.' });
  assert.equal(c.inspection?.dataStatus, 'OBSERVED');
  assert.equal(c.report.status, 'VERIFIED_BY_ENGINEER');
  assert.equal(c.state, 'INSPECTED');
  await step(OPS, { action: 'VERIFY_INSPECTION', reason: 'Temuan dan foto sesuai.' });
  assert.equal(c.state, 'INSPECTION_VERIFIED');
  assert.equal(c.inspectionReviews?.[0].decision, 'VERIFIED');
  await step(ENG, { action: 'RECOMMEND_ACTION', treatment: 'Patching + overlay AC-WC', urgency: 'PRIORITY', rationale: 'Inspeksi mengonfirmasi kerusakan struktural.', assessmentId: 'ASM-1' });
  await step(OPS, { action: 'APPROVE_ACTION', reason: 'Sesuai prioritas koridor.' });
  assert.equal(c.report.status, 'SCHEDULED_FOR_REPAIR');
  await step(OPS, { action: 'START_WORK', reason: 'Tim pemeliharaan tersedia', contractorNote: 'Tim swakelola BBPJN' });
  assert.equal(c.workOrder?.isOfficialDocument, false);
  // Repair evidence comes from the assigned F.E; M.O verifies it (spec 2026-10-17, D-041).
  const AFTER = 'data:image/png;base64,QUZURVI=';
  const tryAs = (actor: Actor, command: Parameters<WorkflowService['transition']>[1]) => service.transition(c.id, command, actor, c.version);
  assert.equal(((await tryAs(OPS, { action: 'COMPLETE_WORK_ORDER', reason: 'x', completionPhotoUrl: AFTER, repair: { method: 'TAMBAL_PANAS', materialId: 'AC-WC', thicknessCm: 5, areaM2: 1.2, compactor: 'STAMPER', category: 'PERMANEN', valueIdr: null } })) as any).code, 'FORBIDDEN', 'M.O cannot send the F.E evidence');
  assert.equal(((await tryAs(OPS, { action: 'RESOLVE', reason: 'x' })) as any).code, 'FORBIDDEN', 'no verification before evidence exists');
  assert.equal(((await tryAs(ENG, { action: 'COMPLETE_WORK_ORDER', reason: 'x', completionPhotoUrl: c.report.photoUrl, repair: { method: 'TAMBAL_PANAS', materialId: 'AC-WC', thicknessCm: 5, areaM2: 1.2, compactor: 'STAMPER', category: 'PERMANEN', valueIdr: null } })) as any).code, 'VALIDATION', 'the citizen photo is not repair evidence');
  await step(ENG, { action: 'COMPLETE_WORK_ORDER', reason: 'Patching selesai, dipadatkan.', completionPhotoUrl: AFTER, repair: { method: 'TAMBAL_PANAS', materialId: 'AC-WC', thicknessCm: 5, areaM2: 1.2, compactor: 'STAMPER', category: 'PERMANEN', valueIdr: null } });
  assert.equal(c.state, 'IN_PROGRESS');
  assert.equal(c.workOrder?.completionPhotoUrl, AFTER);
  assert.equal(((await tryAs(ENG, { action: 'RESOLVE', reason: 'x' })) as any).code, 'FORBIDDEN', 'F.E cannot verify its own repair');
  assert.equal(((await tryAs(OPS, { action: 'REQUEST_REWORK', reason: '' })) as any).code, 'VALIDATION', 'rework needs a reason');
  await step(OPS, { action: 'REQUEST_REWORK', reason: 'Tepi tambalan belum rata.' });
  assert.equal(c.workOrder?.status, 'IN_PROGRESS');
  await step(ENG, { action: 'COMPLETE_WORK_ORDER', reason: 'Tepi diratakan ulang.', completionPhotoUrl: 'data:image/png;base64,QUZURVIy', repair: { method: 'TAMBAL_PANAS', materialId: 'AC-WC', thicknessCm: 5, areaM2: 1.2, compactor: 'STAMPER', category: 'PERMANEN', valueIdr: null } });
  assert.deepEqual(c.workOrder?.submissions?.map((s) => s.decision ?? 'PENDING'), ['REWORK_REQUESTED', 'PENDING'], 'earlier evidence is kept');
  await step(OPS, { action: 'RESOLVE', reason: 'Perbaikan dicek, rata.' });
  assert.equal(c.workOrder?.submissions?.at(-1)?.decision, 'VERIFIED');
  assert.equal(c.report.status, 'REPAIRED');
  await step(OPS, { action: 'CLOSE_RESOLVED', reason: 'Selesai.' });
  assert.equal(c.state, 'CLOSED');
  assert.equal(legacyStatusFor(c), 'REPAIRED');

  const audit = await service.listAudit({ entityId: c.id, limit: 100, offset: 0 });
  assert.equal(audit.total, c.history.length);
  for (const e of audit.items) {
    assert.ok(e.actor.id && e.at && e.action && e.reason, JSON.stringify(e));
  }
  assert.equal(c.version, c.history.length);
});

test('invalid transitions are rejected and leave the case unchanged', async () => {
  const { service } = setup();
  const c = await submitted(service);
  const r = await service.transition(c.id, { action: 'APPROVE_ACTION', reason: 'x' }, OPS, c.version);
  assert.equal(r.ok, false);
  assert.equal(codeOf(r), 'INVALID_TRANSITION');
  assert.deepEqual(await service.getCase(c.id), c);
});

test('wrong role, wrong assignee and self-approval are forbidden', async () => {
  const { service } = setup();
  let c = await submitted(service);
  const asCitizen = await service.transition(c.id, { action: 'REVIEW_ACCEPT', reason: 'x' }, CITIZEN, c.version);
  assert.equal(codeOf(asCitizen), 'FORBIDDEN');
  const asPolicy = await service.transition(c.id, { action: 'REVIEW_ACCEPT', reason: 'x' }, POLICY, c.version);
  assert.equal(codeOf(asPolicy), 'FORBIDDEN');

  c = ok(await service.transition(c.id, { action: 'REVIEW_ACCEPT', reason: 'ok' }, OPS, c.version));
  const assignToOps = await service.transition(c.id, { action: 'REQUEST_INSPECTION', reason: 'x', engineerId: OPS.id, dueAt: DUE, instructions: '' }, OPS, c.version);
  assert.equal(codeOf(assignToOps), 'VALIDATION');
  const pastDue = await service.transition(c.id, { action: 'REQUEST_INSPECTION', reason: 'x', engineerId: ENG.id, dueAt: '2020-01-01', instructions: '' }, OPS, c.version);
  assert.equal(codeOf(pastDue), 'VALIDATION');
  c = ok(await service.transition(c.id, { action: 'REQUEST_INSPECTION', reason: 'ok', engineerId: ENG.id, dueAt: DUE, instructions: '' }, OPS, c.version));

  const otherEngineer = await service.transition(c.id, { action: 'SUBMIT_INSPECTION', verdict: 'CONFIRMED', cvReview: { accepted: true, correctedClass: null }, measuredDepthCm: 5, measuredAreaM2: 1, severity: 'MODERATE', notes: 'x' }, ENG_OTHER, c.version);
  assert.equal(codeOf(otherEngineer), 'FORBIDDEN');
  assert.deepEqual(availableActions(c, ENG_OTHER), []);
  // the assigned engineer on site may also record a temporary warning sign (UU 22/2009 Ps. 24)
  assert.deepEqual(availableActions(c, ENG), ['SUBMIT_INSPECTION', 'MARK_HAZARD']);
});

test('the recommending engineer cannot approve; an operations manager must', async () => {
  const { service } = setup();
  let c = await submitted(service);
  c = ok(await service.transition(c.id, { action: 'REVIEW_ACCEPT', reason: 'ok' }, OPS, c.version));
  c = ok(await service.transition(c.id, { action: 'REQUEST_INSPECTION', reason: 'ok', engineerId: ENG.id, dueAt: DUE, instructions: '' }, OPS, c.version));
  c = ok(await service.transition(c.id, { action: 'SUBMIT_INSPECTION', verdict: 'CONFIRMED', cvReview: { accepted: true, correctedClass: null }, measuredDepthCm: 5, measuredAreaM2: 1, severity: 'MODERATE', notes: 'Lubang aktif' }, ENG, c.version));
  c = ok(await service.transition(c.id, { action: 'VERIFY_INSPECTION', reason: 'ok' }, OPS, c.version));
  c = ok(await service.transition(c.id, { action: 'RECOMMEND_ACTION', treatment: 'Patching', urgency: 'ROUTINE', rationale: 'Lubang lokal', assessmentId: null }, ENG, c.version));
  const engApproves = await service.transition(c.id, { action: 'APPROVE_ACTION', reason: 'x' }, ENG, c.version);
  assert.equal(codeOf(engApproves), 'FORBIDDEN');
  const reject = ok(await service.transition(c.id, { action: 'REJECT_ACTION', reason: 'Perlu opsi overlay' }, OPS2, c.version));
  assert.equal(reject.state, 'INSPECTION_VERIFIED', 'returning a recommendation keeps the inspection verified');
  assert.equal(reject.recommendation, null);
  assert.equal(reject.approvals[0].decision, 'REJECTED');
});

test('a not-confirmed inspection cannot get a maintenance recommendation; ops closes it', async () => {
  const { service } = setup();
  let c = await submitted(service);
  c = ok(await service.transition(c.id, { action: 'REVIEW_ACCEPT', reason: 'ok' }, OPS, c.version));
  c = ok(await service.transition(c.id, { action: 'REQUEST_INSPECTION', reason: 'ok', engineerId: ENG.id, dueAt: DUE, instructions: '' }, OPS, c.version));
  c = ok(await service.transition(c.id, { action: 'SUBMIT_INSPECTION', verdict: 'NOT_CONFIRMED', cvReview: { accepted: false, correctedClass: 'NONE' }, measuredDepthCm: null, measuredAreaM2: null, severity: 'LIGHT', notes: 'Tidak ditemukan kerusakan di titik laporan.' }, ENG, c.version));
  c = ok(await service.transition(c.id, { action: 'VERIFY_INSPECTION', reason: 'ok' }, OPS, c.version));
  const rec = await service.transition(c.id, { action: 'RECOMMEND_ACTION', treatment: 'x', urgency: 'ROUTINE', rationale: 'x', assessmentId: null }, ENG, c.version);
  assert.equal(codeOf(rec), 'FORBIDDEN');
  c = ok(await service.transition(c.id, { action: 'CLOSE_NO_ACTION', reason: 'Tidak terkonfirmasi' }, OPS, c.version));
  assert.equal(c.state, 'CLOSED');
  assert.equal(legacyStatusFor(c), 'CLOSED');
});

test('repair cannot be verified before the work order is completed', async () => {
  const { service } = setup();
  let c = await submitted(service);
  for (const [actor, cmd] of [
    [OPS, { action: 'REVIEW_ACCEPT', reason: 'ok' }],
    [OPS, { action: 'REQUEST_INSPECTION', reason: 'ok', engineerId: ENG.id, dueAt: DUE, instructions: '' }],
    [ENG, { action: 'SUBMIT_INSPECTION', verdict: 'CONFIRMED', cvReview: { accepted: true, correctedClass: null }, measuredDepthCm: 5, measuredAreaM2: 1, severity: 'MODERATE', notes: 'ok' }],
    [OPS, { action: 'VERIFY_INSPECTION', reason: 'ok' }],
    [ENG, { action: 'RECOMMEND_ACTION', treatment: 'Patching', urgency: 'ROUTINE', rationale: 'ok', assessmentId: null }],
    [OPS, { action: 'APPROVE_ACTION', reason: 'ok' }],
    [OPS, { action: 'START_WORK', reason: 'ok', contractorNote: '' }]
  ] as const) {
    c = ok(await service.transition(c.id, cmd as never, actor, c.version));
  }
  const early = await service.transition(c.id, { action: 'RESOLVE', reason: 'x' }, ENG, c.version);
  assert.equal(codeOf(early), 'FORBIDDEN');
});

test('stale versions are rejected instead of overwriting newer data', async () => {
  const { service } = setup();
  const c = await submitted(service);
  ok(await service.transition(c.id, { action: 'REVIEW_ACCEPT', reason: 'first' }, OPS, c.version));
  const stale = await service.transition(c.id, { action: 'CLOSE_INVALID', reason: 'second, based on old view' }, OPS2, c.version);
  assert.equal(codeOf(stale), 'VERSION_CONFLICT');
  assert.equal((await service.getCase(c.id))!.state, 'VERIFIED');
});

test('concurrent transitions are serialized: exactly one of two racing writers wins', async () => {
  const { service } = setup();
  const c = await submitted(service);
  const [a, b] = await Promise.all([
    service.transition(c.id, { action: 'REVIEW_ACCEPT', reason: 'a' }, OPS, c.version),
    service.transition(c.id, { action: 'CLOSE_INVALID', reason: 'b' }, OPS2, c.version)
  ]);
  assert.equal([a.ok, b.ok].filter(Boolean).length, 1);
  const loser = a.ok ? b : a;
  assert.equal(codeOf(loser), 'VERSION_CONFLICT');
});

test('a failed write reports an error and leaves the stored state and audit intact', async () => {
  const { service, store } = setup();
  const c = await submitted(service);
  const auditBefore = await service.listAudit({ limit: 1000, offset: 0 });
  store.failNextCommit = true;
  const r = await service.transition(c.id, { action: 'REVIEW_ACCEPT', reason: 'x' }, OPS, c.version);
  assert.equal(codeOf(r), 'STORAGE');
  assert.deepEqual(await service.getCase(c.id), c);
  assert.deepEqual(await service.listAudit({ limit: 1000, offset: 0 }), auditBefore);
});

test('every transition rule names roles, and staff decisions require a reason', async () => {
  for (const [action, rule] of Object.entries(TRANSITIONS)) {
    if (action === 'SEED_IMPORT') continue;
    assert.ok(rule.roles.length > 0, action);
    if (action === 'SUBMIT') continue; // anyone, staff included, may file a report without a reason
    if (rule.roles.includes('OPERATIONS_MANAGER')) assert.equal(rule.reasonRequired, true, action);
  }
  const { service } = setup();
  const c = await submitted(service);
  const r = await service.transition(c.id, { action: 'REVIEW_ACCEPT', reason: '   ' }, OPS, c.version);
  assert.equal(codeOf(r), 'VALIDATION');
});

test('content edits follow canEditReport and freeze once staff acted', async () => {
  const { service } = setup();
  let c = await submitted(service);
  const byOther = await service.editContent(c.id, { description: 'x' }, { ...CITIZEN, id: 'USR-104' }, c.version);
  assert.equal(codeOf(byOther), 'FORBIDDEN');
  const byAnon = await service.editContent(c.id, { description: 'x' }, ANON, c.version);
  assert.equal(codeOf(byAnon), 'FORBIDDEN');
  c = ok(await service.editContent(c.id, { description: 'Lebih dalam dari dugaan', creatorAccountId: 'USR-999' } as never, CITIZEN, c.version));
  assert.equal(c.report.description, 'Lebih dalam dari dugaan');
  assert.equal(c.report.creatorAccountId, 'USR-004');
  c = ok(await service.transition(c.id, { action: 'REVIEW_ACCEPT', reason: 'ok' }, OPS, c.version));
  const frozen = await service.editContent(c.id, { description: 'y' }, CITIZEN, c.version);
  assert.equal(codeOf(frozen), 'FORBIDDEN');
  const audit = await service.listAudit({ entityId: c.id, limit: 100, offset: 0 });
  assert.ok(audit.items.some((e) => e.action === 'CONTENT_EDIT'));
});

test('seed import is honest: one SEED_IMPORT record per demo report, no invented steps', async () => {
  const { service } = setup();
  const n = await service.ensureSeeded(INITIAL_COMMUNITY_REPORTS);
  assert.equal(n, INITIAL_COMMUNITY_REPORTS.length);
  assert.equal(await service.ensureSeeded(INITIAL_COMMUNITY_REPORTS), 0, 'second call is a no-op');
  for (const c of await service.listCases()) {
    assert.equal(c.history.length, 1);
    assert.equal(c.history[0].action, 'SEED_IMPORT');
    assert.equal(c.dataStatus, 'SYNTHETIC');
    assert.equal(c.screening, null);
    assert.match(c.history[0].reason, /SYNTHETIC/);
  }
  const repaired = (await service.listCases()).find((c) => c.report.status === 'REPAIRED')!;
  assert.equal(repaired.state, 'RESOLVED');
});

test('public view hides staff identities, reasons and notes', async () => {
  const { service } = setup();
  let c: ReportCase = await submitted(service);
  c = ok(await service.transition(c.id, { action: 'REVIEW_ACCEPT', reason: 'catatan internal rahasia' }, OPS, c.version));
  c = ok(await service.transition(c.id, { action: 'REQUEST_INSPECTION', reason: 'internal', engineerId: ENG.id, dueAt: DUE, instructions: 'instruksi internal' }, OPS, c.version));
  const view = toPublicView(c);
  const json = JSON.stringify(view);
  assert.doesNotMatch(json, /catatan internal rahasia|instruksi internal|USR-008|USR-006/);
  assert.deepEqual(view.timeline.map((t) => t.state), ['SUBMITTED', 'AI_SCREENING', 'NEEDS_REVIEW', 'VERIFIED', 'FIELD_INSPECTION_REQUESTED']);
  assert.equal(view.report.repairDetails?.engineerNote, undefined);
});

test('What-If runs are persisted as SIMULATED records with an audit event', async () => {
  const { service, store } = setup();
  const saved = ok(await service.recordSimulation({ segmentId: 'KRW-002', requestedBy: ENG, summary: 'thicker asphalt', result: { label: 'SIMULATION' } }));
  assert.equal(saved.dataStatus, 'SIMULATED');
  assert.deepEqual((await service.listSimulations('KRW-002')).map((s) => s.id), [saved.id]);
  assert.equal((await service.getSimulation(saved.id))?.summary, 'thicker asphalt');
  const audit = await service.listAudit({ entityId: saved.id, limit: 10, offset: 0 });
  assert.equal(audit.items[0].action, 'SIMULATION_RUN');
  assert.equal(audit.items[0].entityType, 'SIMULATION');
  store.failNextCommit = true;
  const failed = await service.recordSimulation({ segmentId: 'KRW-002', requestedBy: ENG, summary: 'x', result: null });
  assert.equal(codeOf(failed), 'STORAGE');
  assert.equal((await service.listSimulations()).length, 1);
});
