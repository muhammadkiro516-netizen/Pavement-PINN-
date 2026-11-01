import { blankCase, type EvidenceRef, type V5Actor, type V5Case, type V5Role, type V5State } from '../../src/domain/v5/model';
import type { V5Action, V5Command } from '../../src/domain/v5/stateMachine';
import { PERMANENT_HARD_STAGES } from '../../src/domain/v5/stateMachine';

export const NOW = '2026-11-01T03:00:00.000Z';
export const AUTH = 'AUTH-JKT-PROV';

export function person(role: V5Role | 'SYSTEM', id: string, extra: Partial<V5Actor> = {}): V5Actor {
  return { kind: role === 'SYSTEM' ? 'SYSTEM' : role === 'CITIZEN' ? 'DEVICE' : 'PERSON', accountId: `ACC-${id}`, personId: role === 'CITIZEN' || role === 'SYSTEM' ? null : `P-${id}`, role, scope: '*', orgId: `ORG-${id}`, ...extra };
}

export const ACTORS = {
  citizen: person('CITIZEN', 'CIT'),
  system: person('SYSTEM', 'SYS'),
  inspector: person('FIELD_INSPECTOR', 'INS'),
  coordinator: person('COORDINATOR', 'COO'),
  approver: person('APPROVER', 'APP'),
  crew: person('REPAIR_CREW', 'CRE'),
  supervisor: person('SUPERVISOR', 'SUP'),
  auditor: person('AUDITOR', 'AUD'),
  head: person('AGENCY_HEAD', 'HEA'),
  admin: person('ADMIN', 'ADM')
};

export const ev = (kind: EvidenceRef['kind'], stage: string | null = null): EvidenceRef => ({ id: `EV-${kind}-${stage ?? ''}`, sha256: `${kind}${stage ?? ''}`.padEnd(64, '0'), kind, stage, captureTrust: 'DEMO', demoSource: 'SAMPLE:test' });

const ROUTING = { segmentId: 'SEG-1', segmentName: 'Jl. Contoh', roadStatus: 'PROVINSI', authorityId: AUTH, authorityName: 'Dinas Bina Marga DKI', authorityLevel: 'PROVINSI', officeId: null, officeName: null, confidence: 'HIGH' as const, basis: 'test' };

const INSPECTION = { inspectorPersonId: 'P-INS', inspectorAccountId: 'ACC-INS', dueAt: NOW, instructions: '', submittedAt: NOW, verdict: 'CONFIRMED' as const, classConfirmed: 'POTHOLE', lengthMm: 800, widthMm: 600, areaCm2: 4800, areaStatus: 'MEASURED' as const, depthMmTyped: 70, rulerCheck: 'MATCH' as const };
const PLAN = { proposerPersonId: 'P-INS', repairType: 'HOT_MIX_PATCH', category: 'PERMANENT' as const, areaCm2: 16800, thicknessMm: 70, volumeCm3: 117600, costEstimateId: 'COST-1', pinnRunId: 'PINN-1', urgency: 'PRIORITY' as const, rationale: 'Deep pothole in a wheel path' };
const WORK_ORDER = { type: 'SWAKELOLA' as const, crewPersonId: 'P-CRE', crewAccountId: 'ACC-CRE', crewOrgId: 'ORG-CRE', supervisorPersonId: 'P-SUP', supervisorAccountId: 'ACC-SUP', supervisorOrgId: 'ORG-SUP', packageId: null, providerOrgId: null, targetDate: NOW, category: 'PERMANENT' as const };
const FOLLOW_UP = { id: 'FU-1', milestone: 'M1' as const, dueAt: NOW, windowDays: 7, trigger: 't', assigneeRole: 'CITIZEN' as const, result: null, source: null, recordedAt: null };

/** A case as it stands in `state`, with the records earlier steps would have created. */
export function caseAt(state: V5State | null, overrides: Partial<V5Case> = {}): V5Case {
  const base = blankCase({ id: 'CASE-1', publicCode: 'JKT-TEST', isDemo: true, createdAt: NOW, createdBy: { kind: 'DEVICE', ref: 'dev:x', personId: null }, mode: 'SINGLE', location: { latE6: -6200000, lonE6: 106800000, accuracyM: 8 }, captureTrust: 'DEMO' });
  const order: V5State[] = ['TRIAGE', 'ACCEPTED', 'INSPECTION_ASSIGNED', 'INSPECTED', 'INSPECTION_VERIFIED', 'PLAN_PROPOSED', 'PLAN_APPROVED', 'WORK_ORDERED', 'IN_PROGRESS', 'WORK_SUBMITTED', 'WORK_VERIFIED', 'MONITORING'];
  const at = order.indexOf(state as V5State);
  const c: V5Case = { ...base, state, version: 3, damageClass: 'POTHOLE' };
  if (at >= 0 || state === 'REPAIRED_TEMPORARY' || state === 'REOPENED' || state === 'CLOSED') {
    c.routing = ROUTING;
    c.authorityId = AUTH;
  }
  if (at >= 2) c.inspection = at >= 3 ? INSPECTION : { inspectorPersonId: 'P-INS', inspectorAccountId: 'ACC-INS', dueAt: NOW, instructions: '' };
  if (at >= 5) c.plan = at >= 6 ? { ...PLAN, approverPersonId: 'P-APP', budgetSource: 'APBD' } : PLAN;
  if (at >= 7) c.workOrder = WORK_ORDER;
  if (at >= 10) c.workOrder = { ...WORK_ORDER, verifiedByRole: 'SUPERVISOR', verifiedAt: NOW };
  if (at >= 11) c.followUps = [FOLLOW_UP, { ...FOLLOW_UP, id: 'FU-6', milestone: 'M6' }];
  if (state === 'REPAIRED_TEMPORARY') {
    c.followUps = [FOLLOW_UP];
    c.workOrder = { ...WORK_ORDER, category: 'TEMPORARY', verifiedByRole: 'SUPERVISOR' };
    c.plan = PLAN;
    c.inspection = INSPECTION;
  }
  return { ...c, ...overrides };
}

const REASON = 'Checked against the photos and the road registry.';
const hardStages = PERMANENT_HARD_STAGES.map((s) => ev('WORK_STAGE', s));

/** One valid example per row of 02 §3.3: from state, actor, command, expected result. */
export const ROWS: { action: V5Action; from: V5State | null; actor: V5Actor; cmd: Omit<V5Command, 'action'>; to: V5State | 'SAME'; event: string; setup?: Partial<V5Case> }[] = [
  { action: 'SUBMIT', from: null, actor: ACTORS.citizen, cmd: { evidence: [ev('OVERVIEW')], classGuess: 'POTHOLE', sizeBand: '0.1-0.5' }, to: 'SUBMITTED', event: 'case.submitted' },
  { action: 'BEGIN_SCREENING', from: 'SUBMITTED', actor: ACTORS.system, cmd: {}, to: 'SCREENING', event: 'case.screening_started' },
  { action: 'SCREENING_DONE', from: 'SCREENING', actor: ACTORS.system, cmd: { screening: { status: 'MODEL_UNAVAILABLE', modelId: null, label: null, score: null }, routing: ROUTING }, to: 'TRIAGE', event: 'case.screened' },
  { action: 'AUTO_MERGE_SUGGEST', from: 'SCREENING', actor: ACTORS.system, cmd: { screening: { status: 'REAL', modelId: 'rdd', label: 'pothole', score: 0.5 }, routing: ROUTING, duplicates: ['CASE-2'] }, to: 'TRIAGE', event: 'case.duplicate_suggested' },
  { action: 'ACCEPT', from: 'TRIAGE', actor: ACTORS.coordinator, cmd: { reason: REASON, damageClass: 'POTHOLE' }, to: 'ACCEPTED', event: 'case.accepted' },
  { action: 'MERGE', from: 'TRIAGE', actor: ACTORS.coordinator, cmd: { reason: REASON, intoCaseId: 'CASE-2' }, to: 'MERGED', event: 'case.merged' },
  { action: 'TRANSFER_AUTHORITY', from: 'TRIAGE', actor: ACTORS.coordinator, cmd: { reason: REASON, target: { authorityId: 'AUTH-2', authorityName: 'Other Dinas', level: 'PROVINSI' }, decreeRef: { number: 'SK 1', date: '2022-01-01' } }, to: 'TRIAGE', event: 'case.transfer_requested' },
  { action: 'CONFIRM_TRANSFER', from: 'TRIAGE', actor: person('COORDINATOR', 'CO2'), cmd: { reason: REASON }, to: 'TRIAGE', event: 'case.transfer_confirmed', setup: { transferPending: { toAuthorityId: 'AUTH-N', toAuthorityName: 'BBPJN', toLevel: 'NASIONAL', decreeRef: 'Kepmen 1688', requestedByPersonId: 'P-COO' } } },
  { action: 'REFER_EXTERNAL', from: 'TRIAGE', actor: ACTORS.coordinator, cmd: { channel: 'JAKI', bundleSha256: 'a'.repeat(64) }, to: 'REFERRED_EXTERNAL', event: 'case.referred' },
  { action: 'CLOSE_INVALID', from: 'TRIAGE', actor: ACTORS.coordinator, cmd: { reason: REASON, closureReason: 'INVALID' }, to: 'CLOSED', event: 'case.closed' },
  { action: 'ASSIGN_INSPECTION', from: 'ACCEPTED', actor: ACTORS.coordinator, cmd: { inspectorPersonId: 'P-INS', inspectorAccountId: 'ACC-INS', dueAt: '2026-11-08T00:00:00.000Z' }, to: 'INSPECTION_ASSIGNED', event: 'inspection.assigned' },
  { action: 'SUBMIT_INSPECTION', from: 'INSPECTION_ASSIGNED', actor: ACTORS.inspector, cmd: { verdict: 'CONFIRMED', depthMmTyped: 70, lengthMm: 800, widthMm: 600, evidence: [ev('OVERVIEW'), ev('MARKER_NADIR'), ev('DEPTH_RULER')] }, to: 'INSPECTED', event: 'inspection.submitted' },
  { action: 'REQUEST_REINSPECTION', from: 'INSPECTED', actor: ACTORS.coordinator, cmd: { reason: REASON }, to: 'INSPECTION_ASSIGNED', event: 'inspection.reinspection_requested' },
  { action: 'VERIFY_INSPECTION', from: 'INSPECTED', actor: ACTORS.coordinator, cmd: { reason: REASON }, to: 'INSPECTION_VERIFIED', event: 'inspection.verified' },
  { action: 'CLOSE_NO_ACTION', from: 'INSPECTION_VERIFIED', actor: ACTORS.coordinator, cmd: { reason: REASON }, to: 'CLOSED', event: 'case.closed' },
  { action: 'PROPOSE_PLAN', from: 'INSPECTION_VERIFIED', actor: ACTORS.inspector, cmd: { repairType: 'HOT_MIX_PATCH', category: 'PERMANENT', urgency: 'PRIORITY', rationale: 'Deep pothole in a wheel path', areaCm2: 16800, thicknessMm: 70, volumeCm3: 117600, costEstimateId: 'COST-1', pinnRunId: 'PINN-1' }, to: 'PLAN_PROPOSED', event: 'plan.proposed' },
  { action: 'RETURN_PLAN', from: 'PLAN_PROPOSED', actor: ACTORS.approver, cmd: { reason: REASON }, to: 'INSPECTION_VERIFIED', event: 'plan.returned' },
  { action: 'APPROVE_PLAN', from: 'PLAN_PROPOSED', actor: ACTORS.approver, cmd: { reason: REASON, budgetSource: 'APBD' }, to: 'PLAN_APPROVED', event: 'plan.approved' },
  { action: 'ISSUE_WORK_ORDER', from: 'PLAN_APPROVED', actor: ACTORS.coordinator, cmd: { type: 'SWAKELOLA', crewPersonId: 'P-CRE', crewAccountId: 'ACC-CRE', crewOrgId: 'ORG-CRE', supervisorPersonId: 'P-SUP', supervisorAccountId: 'ACC-SUP', supervisorOrgId: 'ORG-SUP', targetDate: '2026-11-20T00:00:00.000Z' }, to: 'WORK_ORDERED', event: 'work_order.issued' },
  { action: 'START_WORK', from: 'WORK_ORDERED', actor: ACTORS.crew, cmd: { evidence: [ev('WORK_STAGE', 'BEFORE'), ev('WORK_STAGE', 'CUT_EDGES')] }, to: 'IN_PROGRESS', event: 'work.started' },
  { action: 'SUBMIT_WORK_EVIDENCE', from: 'IN_PROGRESS', actor: ACTORS.crew, cmd: { evidence: hardStages }, to: 'WORK_SUBMITTED', event: 'work.submitted' },
  { action: 'REJECT_WORK', from: 'WORK_SUBMITTED', actor: ACTORS.supervisor, cmd: { reason: REASON, failedStages: ['TACK_COAT'] }, to: 'IN_PROGRESS', event: 'work.rejected' },
  { action: 'VERIFY_WORK', from: 'WORK_SUBMITTED', actor: ACTORS.supervisor, cmd: { evidence: [ev('WORK_STAGE', 'SUPERVISOR_AFTER')] }, to: 'WORK_VERIFIED', event: 'work.verified' },
  { action: 'ACCEPT_WORK', from: 'WORK_VERIFIED', actor: ACTORS.approver, cmd: { reason: REASON }, to: 'MONITORING', event: 'work.accepted' },
  { action: 'PROMOTE_TO_PERMANENT', from: 'REPAIRED_TEMPORARY', actor: ACTORS.inspector, cmd: { repairType: 'HOT_MIX_PATCH', category: 'PERMANENT', urgency: 'ROUTINE', rationale: 'Permanent repair still owed', areaCm2: 16800, thicknessMm: 70, volumeCm3: 117600 }, to: 'PLAN_PROPOSED', event: 'plan.proposed' },
  { action: 'RECORD_FOLLOW_UP', from: 'MONITORING', actor: ACTORS.citizen, cmd: { milestone: 'M1', result: 'OK' }, to: 'SAME', event: 'follow_up.recorded' },
  { action: 'REOPEN', from: 'MONITORING', actor: ACTORS.coordinator, cmd: { reason: REASON }, to: 'REOPENED', event: 'case.reopened' },
  { action: 'CLOSE_MONITORING', from: 'MONITORING', actor: ACTORS.coordinator, cmd: { reason: REASON }, to: 'CLOSED', event: 'case.closed', setup: { followUps: [{ id: 'FU', milestone: 'M6', dueAt: NOW, windowDays: 14, trigger: 't', assigneeRole: 'CITIZEN', result: 'OK', source: 'INSPECTOR', recordedAt: NOW }] } },
  { action: 'SUPERSEDE', from: 'ACCEPTED', actor: ACTORS.coordinator, cmd: { reason: REASON, packageId: 'PKG-1' }, to: 'CLOSED', event: 'case.closed' },
  { action: 'SET_PENDING', from: 'ACCEPTED', actor: ACTORS.coordinator, cmd: { reason: REASON, code: 'AWAITING_BUDGET', until: '2026-12-01T00:00:00.000Z' }, to: 'SAME', event: 'case.pending_set' },
  { action: 'MARK_HAZARD', from: 'ACCEPTED', actor: ACTORS.coordinator, cmd: { evidence: [ev('HAZARD_SIGN')] }, to: 'SAME', event: 'case.hazard_marked' },
  { action: 'ADD_RESPONSE', from: 'MONITORING', actor: ACTORS.coordinator, cmd: { text: 'The agency scheduled a core test.', type: 'SCHEDULE_TEST' }, to: 'SAME', event: 'response.added' },
  { action: 'CORRECT', from: 'INSPECTED', actor: ACTORS.coordinator, cmd: { reason: REASON, correctsEventHash: 'b'.repeat(64), fieldPath: 'depth_mm', newValue: 72 }, to: 'SAME', event: 'correction.recorded' }
];
