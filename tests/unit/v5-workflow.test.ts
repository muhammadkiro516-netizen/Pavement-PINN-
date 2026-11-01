import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ACTORS, AUTH, NOW, ROWS, caseAt, ev, person } from '../helpers/v5Fixtures';
import { V5_ACTIONS, V5_TRANSITIONS, applyCommand, isV5Failure, type V5Action, type V5Command } from '../../src/domain/v5/stateMachine';
import { V5_ROLES, V5_STATES, LEGACY_ROLE_ALIASES, LEGACY_STATE_MAP, type V5Actor, type V5Case } from '../../src/domain/v5/model';
import { checkRoleAssignment, citizenDisputeTriggersInspection } from '../../src/domain/v5/sod';
import { bannedWordsIn } from '../../src/domain/v5/wording';
import { ladderStatus } from '../../src/domain/v5/escalation';
import { followUpIsOverdue, followUpSchedule } from '../../src/domain/v5/followUps';

const roles = JSON.parse(readFileSync('docs/v5/data/roles.json', 'utf8'));
const REASON = 'Checked against the photos and the road registry.';

function run(c: V5Case, action: V5Action, actor: V5Actor, cmd: Omit<V5Command, 'action'> = {}, now = NOW) {
  return applyCommand(c, { ...cmd, action } as V5Command, { actor, now, expectedVersion: c.version });
}

function expectFailure(result: ReturnType<typeof run>, code: string, rule?: string) {
  assert.ok(isV5Failure(result), `expected ${code}, got success`);
  if (isV5Failure(result)) {
    assert.equal(result.code, code, result.message);
    if (rule) assert.equal(result.rule, rule);
  }
}

// One test per transition row (02 §3.3).
for (const row of ROWS) {
  test(`transition ${row.action}: ${row.from ?? 'new'} -> ${row.to}`, () => {
    const c = caseAt(row.from, row.setup);
    const before = JSON.stringify(c);
    const result = run(c, row.action, row.actor, row.cmd);
    assert.ok(!isV5Failure(result), isV5Failure(result) ? `${result.code}: ${result.message}` : '');
    if (isV5Failure(result)) return;
    assert.equal(result.next.state, row.to === 'SAME' ? row.from : row.to);
    assert.equal(result.event.type, row.event);
    assert.equal(result.event.prevState, row.from);
    assert.equal(result.next.version, c.version + 1);
    assert.equal(JSON.stringify(c), before, 'input case is not mutated');
  });
}

test('every action in the table except the seed has a transition test', () => {
  const tested = new Set(ROWS.map((r) => r.action));
  assert.deepEqual(V5_ACTIONS.filter((a) => !tested.has(a) && a !== 'SEED_IMPORT'), []);
});

test('an action outside its from-states is INVALID_TRANSITION', () => {
  const wrongState = V5_STATES.find((s) => !(V5_TRANSITIONS.ACCEPT.from as readonly string[]).includes(s))!;
  expectFailure(run(caseAt(wrongState), 'ACCEPT', ACTORS.coordinator, { reason: REASON, damageClass: 'POTHOLE' }), 'INVALID_TRANSITION');
});

test('a stale version is rejected', () => {
  const c = caseAt('TRIAGE');
  const r = applyCommand(c, { action: 'ACCEPT', reason: REASON, damageClass: 'POTHOLE' }, { actor: ACTORS.coordinator, now: NOW, expectedVersion: c.version - 1 });
  expectFailure(r, 'VERSION_CONFLICT');
});

test('human decisions need a reason of at least 10 characters', () => {
  expectFailure(run(caseAt('TRIAGE'), 'ACCEPT', ACTORS.coordinator, { reason: 'ok', damageClass: 'POTHOLE' }), 'VALIDATION');
});

test('AI never changes a case: no AI actor exists, and only SYSTEM may run screening', () => {
  for (const action of ['BEGIN_SCREENING', 'SCREENING_DONE'] as const) assert.deepEqual([...V5_TRANSITIONS[action].roles], ['SYSTEM']);
  for (const action of V5_ACTIONS) {
    const allowed = V5_TRANSITIONS[action].roles as readonly string[];
    if (allowed.includes('SYSTEM')) assert.ok(['BEGIN_SCREENING', 'SCREENING_DONE', 'AUTO_MERGE_SUGGEST', 'REFER_EXTERNAL', 'REOPEN', 'CLOSE_MONITORING'].includes(action), `${action} must not run automatically`);
  }
  // SYS-3: screening ends in TRIAGE, never ACCEPTED, whatever the score.
  const r = run(caseAt('SCREENING'), 'SCREENING_DONE', ACTORS.system, { screening: { status: 'REAL', modelId: 'rdd', label: 'pothole', score: 0.99 }, routing: ROWS[2].cmd.routing });
  assert.ok(!isV5Failure(r));
  if (!isV5Failure(r)) assert.equal(r.next.state, 'TRIAGE');
});

// Permission matrix generated from data/roles.json (V5-3).
const MATRIX: Record<string, V5Action> = {
  'case.accept': 'ACCEPT',
  'case.close_invalid': 'CLOSE_INVALID',
  'case.merge': 'MERGE',
  'case.transfer': 'TRANSFER_AUTHORITY',
  'case.transfer_confirm': 'CONFIRM_TRANSFER',
  'case.refer_external': 'REFER_EXTERNAL',
  'inspection.assign': 'ASSIGN_INSPECTION',
  'inspection.submit': 'SUBMIT_INSPECTION',
  'inspection.verify': 'VERIFY_INSPECTION',
  'inspection.request_reinspection': 'REQUEST_REINSPECTION',
  'plan.propose': 'PROPOSE_PLAN',
  'plan.return': 'RETURN_PLAN',
  'plan.approve': 'APPROVE_PLAN',
  'work_order.issue': 'ISSUE_WORK_ORDER',
  'work.start': 'START_WORK',
  'work.submit_evidence': 'SUBMIT_WORK_EVIDENCE',
  'work.verify': 'VERIFY_WORK',
  'work.reject': 'REJECT_WORK',
  'work.accept': 'ACCEPT_WORK',
  'case.set_pending': 'SET_PENDING',
  'case.mark_hazard': 'MARK_HAZARD',
  'followup.citizen_confirm': 'RECORD_FOLLOW_UP',
  'followup.record': 'RECORD_FOLLOW_UP',
  'case.reopen': 'REOPEN',
  'case.close_monitoring': 'CLOSE_MONITORING'
};

for (const [permission, action] of Object.entries(MATRIX)) {
  test(`roles.json matrix ${permission} matches ${action}`, () => {
    const row = roles.permissions[permission];
    assert.ok(row, `${permission} is in roles.json`);
    const allowed = V5_TRANSITIONS[action].roles as readonly string[];
    for (const role of V5_ROLES) {
      const cell = row[role];
      // C4: the Agency Head acts only through a separate APPROVER assignment, logged as an overlap.
      const mayAct = cell !== '-' && cell !== 'C4';
      if (mayAct) assert.ok(allowed.includes(role), `${role} (${cell}) may ${action}`);
      else if (permission !== 'followup.record' && permission !== 'followup.citizen_confirm') assert.ok(!allowed.includes(role), `${role} may not ${action}`);
    }
  });
}

test('roles.json lists the nine roles the code knows', () => {
  assert.deepEqual(roles.roles.map((r: { key: string }) => r.key).sort(), [...V5_ROLES].sort());
});

test('legacy aliases map every v4 role and state', () => {
  assert.deepEqual(LEGACY_ROLE_ALIASES, roles.legacy_role_aliases);
  for (const s of Object.values(LEGACY_STATE_MAP)) assert.ok(V5_STATES.includes(s));
});

// Separation of duties (03 §4), one test per rule.
test('SOD-1: crew and supervisor must be different people and, on contracts, different organisations', () => {
  const issue = { type: 'SWAKELOLA', crewPersonId: 'P-X', crewAccountId: 'A', supervisorPersonId: 'P-X', supervisorAccountId: 'B', targetDate: NOW };
  expectFailure(run(caseAt('PLAN_APPROVED'), 'ISSUE_WORK_ORDER', ACTORS.coordinator, issue), 'FORBIDDEN', 'SOD-1');
  const contract = { ...issue, type: 'CONTRACT', packageId: 'PKG', supervisorPersonId: 'P-Y', crewOrgId: 'ORG-1', supervisorOrgId: 'ORG-1' };
  expectFailure(run(caseAt('PLAN_APPROVED'), 'ISSUE_WORK_ORDER', ACTORS.coordinator, contract), 'FORBIDDEN', 'SOD-1');
  const proposerAsCrew = { ...issue, crewPersonId: 'P-INS', supervisorPersonId: 'P-Y' };
  expectFailure(run(caseAt('PLAN_APPROVED'), 'ISSUE_WORK_ORDER', ACTORS.coordinator, proposerAsCrew), 'FORBIDDEN', 'SOD-1');
  const crewAsSupervisor = person('SUPERVISOR', 'CRE', { accountId: 'ACC-SUP' });
  expectFailure(run(caseAt('WORK_SUBMITTED'), 'VERIFY_WORK', crewAsSupervisor, { evidence: [ev('WORK_STAGE', 'SUPERVISOR_AFTER')] }), 'FORBIDDEN', 'SOD-1');
});

test('SOD-2: the person who recommended a plan cannot approve it, on any account', () => {
  const samePerson = person('APPROVER', 'INS', { accountId: 'ACC-OTHER' });
  expectFailure(run(caseAt('PLAN_PROPOSED'), 'APPROVE_PLAN', samePerson, { reason: REASON, budgetSource: 'APBD' }), 'FORBIDDEN', 'SOD-2');
  expectFailure(run(caseAt('WORK_VERIFIED'), 'ACCEPT_WORK', samePerson, { reason: REASON }), 'FORBIDDEN', 'SOD-2');
});

test('SOD-3: an official linked to the provider cannot act', () => {
  const linked = person('APPROVER', 'APP', { conflictOrgs: ['ORG-PROVIDER'] });
  const c = caseAt('WORK_VERIFIED', { workOrder: { ...caseAt('WORK_VERIFIED').workOrder!, providerOrgId: 'ORG-PROVIDER' } });
  expectFailure(run(c, 'ACCEPT_WORK', linked, { reason: REASON }), 'FORBIDDEN', 'SOD-3');
});

test('SOD-4: crew and supervisor cannot record the independent follow-ups', () => {
  const wo = caseAt('MONITORING').workOrder!;
  const c = caseAt('MONITORING', { followUps: [{ id: 'F', milestone: 'M3', dueAt: NOW, windowDays: 10, trigger: 't', assigneeRole: 'FIELD_INSPECTOR', result: null, source: null, recordedAt: null }], workOrder: { ...wo, supervisorPersonId: 'P-SUP' } });
  expectFailure(run(c, 'RECORD_FOLLOW_UP', ACTORS.supervisor, { milestone: 'M3', result: 'OK', evidence: [ev('FOLLOW_UP')] }), 'FORBIDDEN', 'SOD-4');
  const ok = run(c, 'RECORD_FOLLOW_UP', ACTORS.inspector, { milestone: 'M3', result: 'OK', evidence: [ev('FOLLOW_UP')] });
  assert.ok(!isV5Failure(ok));
});

test('SOD-5: acceptance needs a supervisor check first', () => {
  const unverified = caseAt('WORK_VERIFIED', { workOrder: { ...caseAt('WORK_VERIFIED').workOrder!, verifiedByRole: undefined } });
  expectFailure(run(unverified, 'ACCEPT_WORK', ACTORS.approver, { reason: REASON }), 'FORBIDDEN', 'SOD-5');
  // AP-3.1: before the verify step the state itself refuses.
  expectFailure(run(caseAt('WORK_SUBMITTED'), 'ACCEPT_WORK', ACTORS.approver, { reason: REASON }), 'INVALID_TRANSITION');
});

test('SOD-6: a permitted overlap succeeds and is logged on the event', () => {
  const kpa = person('APPROVER', 'KPA', { subType: 'KPA_AS_PPK' });
  const r = run(caseAt('PLAN_PROPOSED'), 'APPROVE_PLAN', kpa, { reason: REASON, budgetSource: 'APBD' });
  assert.ok(!isV5Failure(r));
  if (!isV5Failure(r)) assert.equal(r.event.overlapBasis, 'Perpres 12/2021 Pasal 10(5)');
  const plain = run(caseAt('PLAN_PROPOSED'), 'APPROVE_PLAN', ACTORS.approver, { reason: REASON, budgetSource: 'APBD' });
  if (!isV5Failure(plain)) assert.equal(plain.event.overlapBasis, null);
});

test('SOD-7: a transfer cites the decree; a cross-level one needs a second person at the target', () => {
  const target = { authorityId: 'AUTH-N', authorityName: 'BBPJN', level: 'NASIONAL' };
  expectFailure(run(caseAt('TRIAGE'), 'TRANSFER_AUTHORITY', ACTORS.coordinator, { reason: REASON, target }), 'VALIDATION', 'SOD-7');
  const asked = run(caseAt('TRIAGE'), 'TRANSFER_AUTHORITY', ACTORS.coordinator, { reason: REASON, target, decreeRef: { decreeId: 'Kepmen PUPR 1688/KPTS/M/2022' } });
  assert.ok(!isV5Failure(asked));
  if (isV5Failure(asked)) return;
  assert.equal(asked.next.authorityId, AUTH, 'the case stays until confirmed');
  assert.ok(asked.next.transferPending);
  expectFailure(run(asked.next, 'CONFIRM_TRANSFER', ACTORS.coordinator, { reason: REASON }), 'FORBIDDEN', 'SOD-7');
  const wrongAgency = person('COORDINATOR', 'CO3', { scope: ['AUTH-OTHER'] });
  expectFailure(run(asked.next, 'CONFIRM_TRANSFER', wrongAgency, { reason: REASON }), 'FORBIDDEN', 'SOD-7');
  const confirmed = run(asked.next, 'CONFIRM_TRANSFER', person('COORDINATOR', 'CO2', { scope: ['AUTH-N'] }), { reason: REASON });
  assert.ok(!isV5Failure(confirmed));
  if (!isV5Failure(confirmed)) assert.equal(confirmed.next.authorityId, 'AUTH-N');
});

test('SOD-8: auditors and admins can never change a case', () => {
  for (const row of ROWS) {
    expectFailure(run(caseAt(row.from, row.setup), row.action, ACTORS.auditor, row.cmd), 'FORBIDDEN', 'SOD-8');
    if (row.action !== 'CONFIRM_TRANSFER') expectFailure(run(caseAt(row.from, row.setup), row.action, ACTORS.admin, row.cmd), 'FORBIDDEN', 'SOD-8');
  }
  assert.equal(checkRoleAssignment({ createdByAccountId: 'A', accountId: 'B', role: 'AUDITOR', existingRoles: ['COORDINATOR'] }).ok, false);
});

test('SOD-9: a toll regulator may not operate', () => {
  const regulator = person('COORDINATOR', 'BPJT', { subType: 'TOLL_REGULATOR' });
  expectFailure(run(caseAt('TRIAGE'), 'ACCEPT', regulator, { reason: REASON, damageClass: 'POTHOLE' }), 'FORBIDDEN', 'SOD-9');
});

test('SOD-10: citizen dispute needs two devices, or one with a photo on a verified phone', () => {
  assert.equal(citizenDisputeTriggersInspection([{ result: 'DAMAGED', deviceRef: 'a', withPhoto: false }]), false);
  assert.equal(citizenDisputeTriggersInspection([{ result: 'DAMAGED', deviceRef: 'a', withPhoto: false }, { result: 'DAMAGED', deviceRef: 'a', withPhoto: false }]), false);
  assert.equal(citizenDisputeTriggersInspection([{ result: 'DAMAGED', deviceRef: 'a', withPhoto: false }, { result: 'DAMAGED', deviceRef: 'b', withPhoto: false }]), true);
  assert.equal(citizenDisputeTriggersInspection([{ result: 'DAMAGED', deviceRef: 'a', withPhoto: true, trustTier: 1 }]), true);
});

test('SOD-11: staff cannot accept a report they created', () => {
  const c = caseAt('TRIAGE', { createdBy: { kind: 'STAFF', ref: 'staff:x', personId: 'P-COO' } });
  expectFailure(run(c, 'ACCEPT', ACTORS.coordinator, { reason: REASON, damageClass: 'POTHOLE' }), 'FORBIDDEN', 'SOD-11');
});

test('SOD-12: nobody grants themselves a role; an approver needs an appointment reference', () => {
  assert.equal(checkRoleAssignment({ createdByAccountId: 'A', accountId: 'A', role: 'COORDINATOR' }).ok, false);
  assert.equal(checkRoleAssignment({ createdByAccountId: 'A', accountId: 'B', role: 'APPROVER' }).ok, false);
  assert.equal(checkRoleAssignment({ createdByAccountId: 'A', accountId: 'B', role: 'APPROVER', appointmentRef: 'SK PPK 12/2026' }).ok, true);
});

test('SOD-13: the fourth consecutive delay needs the Agency Head', () => {
  const c = caseAt('ACCEPTED', { pending: { code: 'AWAITING_BUDGET', until: '2026-11-10T00:00:00.000Z', note: '', consecutive: 3 } });
  const cmd = { reason: REASON, code: 'AWAITING_BUDGET', until: '2026-12-01T00:00:00.000Z' };
  expectFailure(run(c, 'SET_PENDING', ACTORS.coordinator, cmd), 'FORBIDDEN', 'SOD-13');
  assert.ok(!isV5Failure(run(c, 'SET_PENDING', ACTORS.head, cmd)));
});

test('the crew cannot verify, accept or close (RC-2.3)', () => {
  expectFailure(run(caseAt('WORK_SUBMITTED'), 'VERIFY_WORK', ACTORS.crew, { evidence: [ev('WORK_STAGE', 'SUPERVISOR_AFTER')] }), 'FORBIDDEN');
  expectFailure(run(caseAt('WORK_VERIFIED'), 'ACCEPT_WORK', ACTORS.crew, { reason: REASON }), 'FORBIDDEN');
  expectFailure(run(caseAt('TRIAGE'), 'CLOSE_INVALID', ACTORS.crew, { reason: REASON, closureReason: 'INVALID' }), 'FORBIDDEN');
});

test('assignment: only the assigned inspector, crew and supervisor may act', () => {
  const other = (role: Parameters<typeof person>[0]) => person(role, 'OTHER');
  expectFailure(run(caseAt('INSPECTION_ASSIGNED'), 'SUBMIT_INSPECTION', other('FIELD_INSPECTOR'), {}), 'FORBIDDEN');
  expectFailure(run(caseAt('WORK_ORDERED'), 'START_WORK', other('REPAIR_CREW'), {}), 'FORBIDDEN');
  expectFailure(run(caseAt('WORK_SUBMITTED'), 'VERIFY_WORK', other('SUPERVISOR'), {}), 'FORBIDDEN');
});

test('scope: staff cannot act on another agency\'s case', () => {
  const outsider = person('COORDINATOR', 'FAR', { scope: ['AUTH-ELSEWHERE'] });
  expectFailure(run(caseAt('TRIAGE'), 'ACCEPT', outsider, { reason: REASON, damageClass: 'POTHOLE' }), 'FORBIDDEN');
});

test('evidence gates: inspection needs a ruler photo and typed depth (FI-2.1)', () => {
  const noRuler = { verdict: 'CONFIRMED', depthMmTyped: 70, lengthMm: 800, widthMm: 600, evidence: [ev('OVERVIEW')] };
  expectFailure(run(caseAt('INSPECTION_ASSIGNED'), 'SUBMIT_INSPECTION', ACTORS.inspector, noRuler), 'VALIDATION');
  const noDepth = { verdict: 'CONFIRMED', lengthMm: 800, widthMm: 600, evidence: [ev('OVERVIEW'), ev('DEPTH_RULER')] };
  expectFailure(run(caseAt('INSPECTION_ASSIGNED'), 'SUBMIT_INSPECTION', ACTORS.inspector, noDepth), 'VALIDATION');
});

test('area is MEASURED only with a marker card; without one it is an AI estimate (FI-2.2)', () => {
  const noMarker = run(caseAt('INSPECTION_ASSIGNED'), 'SUBMIT_INSPECTION', ACTORS.inspector, { verdict: 'CONFIRMED', depthMmTyped: 70, lengthMm: 800, widthMm: 600, evidence: [ev('OVERVIEW'), ev('DEPTH_RULER')] });
  assert.ok(!isV5Failure(noMarker));
  if (!isV5Failure(noMarker)) assert.equal(noMarker.next.inspection!.areaStatus, 'AI_ESTIMATE');
});

test('a ruler mismatch must be acknowledged before verification (FI-3.1)', () => {
  const c = caseAt('INSPECTED', { inspection: { ...caseAt('INSPECTED').inspection!, rulerCheck: 'MISMATCH' } });
  expectFailure(run(c, 'VERIFY_INSPECTION', ACTORS.coordinator, { reason: REASON }), 'VALIDATION');
  assert.ok(!isV5Failure(run(c, 'VERIFY_INSPECTION', ACTORS.coordinator, { reason: REASON, acknowledgeRulerMismatch: true })));
});

test('plan volume is recomputed on the server (FI-7.1)', () => {
  const row = ROWS.find((r) => r.action === 'PROPOSE_PLAN')!;
  expectFailure(run(caseAt('INSPECTION_VERIFIED'), 'PROPOSE_PLAN', ACTORS.inspector, { ...row.cmd, volumeCm3: 150000 }), 'VALIDATION');
});

test('a work checklist with a missing stage cannot be submitted', () => {
  const partial = { evidence: [ev('WORK_STAGE', 'BEFORE'), ev('WORK_STAGE', 'CUT_EDGES')] };
  expectFailure(run(caseAt('IN_PROGRESS'), 'SUBMIT_WORK_EVIDENCE', ACTORS.crew, partial), 'VALIDATION');
});

test('verifying needs the supervisor\'s own after-photo; a failed item needs an override (SV-1.1, SV-1.3)', () => {
  expectFailure(run(caseAt('WORK_SUBMITTED'), 'VERIFY_WORK', ACTORS.supervisor, {}), 'VALIDATION');
  expectFailure(run(caseAt('WORK_SUBMITTED'), 'VERIFY_WORK', ACTORS.supervisor, { evidence: [ev('WORK_STAGE', 'SUPERVISOR_AFTER')], failedStages: ['TACK_COAT'] }), 'VALIDATION');
});

test('a temporary repair ends in REPAIRED_TEMPORARY with M1 and heavy rain only', () => {
  const wo = caseAt('WORK_VERIFIED').workOrder!;
  const r = run(caseAt('WORK_VERIFIED', { workOrder: { ...wo, category: 'TEMPORARY' } }), 'ACCEPT_WORK', ACTORS.approver, { reason: REASON });
  assert.ok(!isV5Failure(r));
  if (isV5Failure(r)) return;
  assert.equal(r.next.state, 'REPAIRED_TEMPORARY');
  assert.deepEqual(r.next.followUps.map((f) => f.milestone), ['M1', 'HEAVY_RAIN']);
});

test('follow-up schedule: 1/3/6 months and heavy rain; close milestones merge keeping the stricter', () => {
  const plain = followUpSchedule('C', '2026-01-31T00:00:00.000Z', 'PERMANENT');
  assert.deepEqual(plain.map((f) => f.milestone), ['M1', 'M3', 'M6', 'HEAVY_RAIN']);
  assert.equal(plain[0].dueAt, '2026-02-28T00:00:00.000Z');
  assert.equal(plain[3].dueAt, null, 'heavy rain waits for the rain');
  // A 6-month maintenance period puts PRE_FHO 21 days before M6's date: kept as separate tasks.
  assert.deepEqual(followUpSchedule('C', '2026-01-01T00:00:00.000Z', 'PERMANENT', 6).map((f) => f.milestone), ['M1', 'M3', 'PRE_FHO', 'M6', 'HEAVY_RAIN']);
  // A 4-month period lands PRE_FHO 9 days after M3: merged into the stricter joint inspection.
  assert.deepEqual(followUpSchedule('C', '2026-01-01T00:00:00.000Z', 'PERMANENT', 4).map((f) => f.milestone), ['M1', 'PRE_FHO', 'M6', 'HEAVY_RAIN']);
  assert.equal(followUpIsOverdue(plain[0], '2026-03-20T00:00:00.000Z'), true);
  assert.equal(followUpIsOverdue(plain[0], '2026-03-01T00:00:00.000Z'), false);
});

test('reopening inside the maintenance period raises the warranty flag', () => {
  const wo = caseAt('MONITORING').workOrder!;
  const c = caseAt('MONITORING', { workOrder: { ...wo, phoDate: '2026-09-01T00:00:00.000Z', maintenanceMonths: 6 } });
  const inside = run(c, 'REOPEN', ACTORS.coordinator, { reason: REASON }, '2026-11-01T00:00:00.000Z');
  assert.ok(!isV5Failure(inside));
  if (!isV5Failure(inside)) assert.equal(inside.next.warrantyFlag, true);
  const after = run(c, 'REOPEN', ACTORS.coordinator, { reason: REASON }, '2027-06-01T00:00:00.000Z');
  if (!isV5Failure(after)) assert.equal(after.next.warrantyFlag, false);
});

test('accusing words are refused in free text; neutral wording passes', () => {
  for (const word of ['korupsi', 'corruption', 'fraud', 'mark-up', 'markup', 'nakal']) assert.ok(bannedWordsIn(`ada ${word} di sini`).length > 0, word);
  assert.deepEqual(bannedWordsIn('Needs clarification; perlu klarifikasi oleh instansi'), []);
  assert.deepEqual(bannedWordsIn('kepastian jadwal'), [], 'matches whole words only');
  expectFailure(run(caseAt('TRIAGE'), 'ACCEPT', ACTORS.coordinator, { reason: 'This looks like fraud by the crew', damageClass: 'POTHOLE' }), 'VALIDATION');
});

test('escalation ladder: 2/7/14/30 days, paused by a delay reason, restarted after it, frozen once repaired', () => {
  const start = '2026-10-01T00:00:00.000Z';
  const at = (days: number) => new Date(new Date(start).getTime() + days * 86_400_000).toISOString();
  const open = { state: 'TRIAGE' as const, ladderStartAt: start, pending: null };
  assert.equal(ladderStatus(open, at(1)).level, null);
  assert.equal(ladderStatus(open, at(2)).level, 'COORDINATOR');
  assert.equal(ladderStatus(open, at(7)).level, 'AGENCY_HEAD');
  assert.equal(ladderStatus(open, at(14)).level, 'PUBLIC');
  assert.equal(ladderStatus(open, at(30)).level, 'COMPLAINT');
  const delayed = { ...open, pending: { code: 'AWAITING_BUDGET', until: at(40), note: '', consecutive: 1 } };
  assert.equal(ladderStatus(delayed, at(35)).paused, true);
  assert.equal(ladderStatus(delayed, at(35)).level, null);
  assert.equal(ladderStatus(delayed, at(42)).level, 'COORDINATOR', 'restarts from the end of the delay');
  assert.equal(ladderStatus({ ...open, state: 'MONITORING' }, at(40)).level, null);
});
