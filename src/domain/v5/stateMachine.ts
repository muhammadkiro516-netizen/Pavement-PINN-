/**
 * The one legal v5 case workflow (02_SPEC_v5.md §3.3). Every change goes through `applyCommand`,
 * which checks the role, state, assignment, authority scope, separation of duties and payload,
 * then returns the next case plus the event to chain. It never mutates its input.
 * AI never appears here as an actor: only SYSTEM screening steps move a case on their own.
 */
import { bannedWordsIn } from './wording';
import { checkSod, hasDecree } from './sod';
import { followUpSchedule } from './followUps';
import { OPEN_STATES, V5_STATE_LABELS, type EvidenceRef, type V5Actor, type V5Case, type V5Role, type V5State } from './model';

export const MIN_REASON_CHARS = 10;
const MAX_TEXT = 1000;

/** Damage classes that cannot be sized without a ruler photo and a typed depth (FI-2.1). */
const DEPTH_REQUIRED_CLASSES = ['POTHOLE', 'RUTTING_DEPRESSION'];

/** Hard gates of the patching checklist (08 §2.1). */
export const PERMANENT_HARD_STAGES = ['BEFORE', 'CUT_EDGES', 'CLEAN_DRY', 'TACK_COAT', 'DELIVERY_TICKET', 'MIX_TEMP_TRUCK', 'MIX_TEMP_MAT', 'COMPACTION', 'AFTER'] as const;
/** Hard gates of a temporary cold-mix patch (08 §2.2). */
export const TEMPORARY_HARD_STAGES = ['BEFORE', 'CLEAN_DRY', 'COMPACTION', 'AFTER'] as const;
/** Stages that must exist before `START_WORK`. */
export const START_WORK_STAGES = ['BEFORE', 'CUT_EDGES'] as const;

type ActorRole = V5Role | 'SYSTEM';

export interface TransitionRule {
  from: readonly (V5State | null)[];
  to: V5State | 'SAME';
  roles: readonly ActorRole[];
  reasonRequired: boolean;
  eventType: string;
}

const OPEN_AND_ON: readonly V5State[] = ['ACCEPTED', 'INSPECTION_ASSIGNED', 'INSPECTED', 'INSPECTION_VERIFIED', 'PLAN_PROPOSED', 'PLAN_APPROVED', 'WORK_ORDERED'];
const ALL_STATES = Object.keys(V5_STATE_LABELS) as V5State[];

export const V5_TRANSITIONS = {
  SUBMIT: { from: [null], to: 'SUBMITTED', roles: ['CITIZEN', 'FIELD_INSPECTOR', 'COORDINATOR'], reasonRequired: false, eventType: 'case.submitted' },
  BEGIN_SCREENING: { from: ['SUBMITTED'], to: 'SCREENING', roles: ['SYSTEM'], reasonRequired: false, eventType: 'case.screening_started' },
  SCREENING_DONE: { from: ['SCREENING'], to: 'TRIAGE', roles: ['SYSTEM'], reasonRequired: false, eventType: 'case.screened' },
  AUTO_MERGE_SUGGEST: { from: ['SCREENING'], to: 'TRIAGE', roles: ['SYSTEM'], reasonRequired: false, eventType: 'case.duplicate_suggested' },
  ACCEPT: { from: ['TRIAGE'], to: 'ACCEPTED', roles: ['COORDINATOR'], reasonRequired: true, eventType: 'case.accepted' },
  MERGE: { from: ['TRIAGE', 'ACCEPTED'], to: 'MERGED', roles: ['COORDINATOR'], reasonRequired: true, eventType: 'case.merged' },
  TRANSFER_AUTHORITY: { from: ['TRIAGE', 'ACCEPTED'], to: 'SAME', roles: ['COORDINATOR'], reasonRequired: true, eventType: 'case.transfer_requested' },
  CONFIRM_TRANSFER: { from: ['TRIAGE', 'ACCEPTED'], to: 'TRIAGE', roles: ['COORDINATOR', 'ADMIN'], reasonRequired: true, eventType: 'case.transfer_confirmed' },
  REFER_EXTERNAL: { from: ['TRIAGE', 'ACCEPTED'], to: 'REFERRED_EXTERNAL', roles: ['COORDINATOR', 'SYSTEM'], reasonRequired: false, eventType: 'case.referred' },
  CLOSE_INVALID: { from: ['TRIAGE', 'ACCEPTED'], to: 'CLOSED', roles: ['COORDINATOR'], reasonRequired: true, eventType: 'case.closed' },
  ASSIGN_INSPECTION: { from: ['ACCEPTED', 'REOPENED'], to: 'INSPECTION_ASSIGNED', roles: ['COORDINATOR'], reasonRequired: false, eventType: 'inspection.assigned' },
  SUBMIT_INSPECTION: { from: ['INSPECTION_ASSIGNED'], to: 'INSPECTED', roles: ['FIELD_INSPECTOR'], reasonRequired: false, eventType: 'inspection.submitted' },
  REQUEST_REINSPECTION: { from: ['INSPECTED'], to: 'INSPECTION_ASSIGNED', roles: ['COORDINATOR'], reasonRequired: true, eventType: 'inspection.reinspection_requested' },
  VERIFY_INSPECTION: { from: ['INSPECTED'], to: 'INSPECTION_VERIFIED', roles: ['COORDINATOR'], reasonRequired: true, eventType: 'inspection.verified' },
  CLOSE_NO_ACTION: { from: ['INSPECTION_VERIFIED'], to: 'CLOSED', roles: ['COORDINATOR'], reasonRequired: true, eventType: 'case.closed' },
  PROPOSE_PLAN: { from: ['INSPECTION_VERIFIED'], to: 'PLAN_PROPOSED', roles: ['FIELD_INSPECTOR'], reasonRequired: false, eventType: 'plan.proposed' },
  RETURN_PLAN: { from: ['PLAN_PROPOSED'], to: 'INSPECTION_VERIFIED', roles: ['APPROVER', 'COORDINATOR'], reasonRequired: true, eventType: 'plan.returned' },
  APPROVE_PLAN: { from: ['PLAN_PROPOSED'], to: 'PLAN_APPROVED', roles: ['APPROVER'], reasonRequired: true, eventType: 'plan.approved' },
  ISSUE_WORK_ORDER: { from: ['PLAN_APPROVED'], to: 'WORK_ORDERED', roles: ['COORDINATOR'], reasonRequired: false, eventType: 'work_order.issued' },
  START_WORK: { from: ['WORK_ORDERED'], to: 'IN_PROGRESS', roles: ['REPAIR_CREW'], reasonRequired: false, eventType: 'work.started' },
  SUBMIT_WORK_EVIDENCE: { from: ['IN_PROGRESS'], to: 'WORK_SUBMITTED', roles: ['REPAIR_CREW'], reasonRequired: false, eventType: 'work.submitted' },
  REJECT_WORK: { from: ['WORK_SUBMITTED'], to: 'IN_PROGRESS', roles: ['SUPERVISOR'], reasonRequired: true, eventType: 'work.rejected' },
  VERIFY_WORK: { from: ['WORK_SUBMITTED'], to: 'WORK_VERIFIED', roles: ['SUPERVISOR'], reasonRequired: false, eventType: 'work.verified' },
  ACCEPT_WORK: { from: ['WORK_VERIFIED'], to: 'MONITORING', roles: ['APPROVER', 'COORDINATOR'], reasonRequired: true, eventType: 'work.accepted' },
  PROMOTE_TO_PERMANENT: { from: ['REPAIRED_TEMPORARY'], to: 'PLAN_PROPOSED', roles: ['FIELD_INSPECTOR', 'COORDINATOR'], reasonRequired: false, eventType: 'plan.proposed' },
  RECORD_FOLLOW_UP: { from: ['MONITORING', 'REPAIRED_TEMPORARY'], to: 'SAME', roles: ['FIELD_INSPECTOR', 'CITIZEN', 'SUPERVISOR'], reasonRequired: false, eventType: 'follow_up.recorded' },
  REOPEN: { from: ['MONITORING', 'REPAIRED_TEMPORARY', 'CLOSED'], to: 'REOPENED', roles: ['SYSTEM', 'COORDINATOR'], reasonRequired: true, eventType: 'case.reopened' },
  CLOSE_MONITORING: { from: ['MONITORING'], to: 'CLOSED', roles: ['COORDINATOR', 'SYSTEM'], reasonRequired: true, eventType: 'case.closed' },
  SUPERSEDE: { from: OPEN_STATES, to: 'CLOSED', roles: ['COORDINATOR'], reasonRequired: true, eventType: 'case.closed' },
  SET_PENDING: { from: [...OPEN_AND_ON, 'REPAIRED_TEMPORARY'], to: 'SAME', roles: ['COORDINATOR', 'AGENCY_HEAD'], reasonRequired: true, eventType: 'case.pending_set' },
  MARK_HAZARD: { from: [...OPEN_AND_ON, 'IN_PROGRESS', 'REOPENED'], to: 'SAME', roles: ['FIELD_INSPECTOR', 'COORDINATOR', 'REPAIR_CREW'], reasonRequired: false, eventType: 'case.hazard_marked' },
  ADD_RESPONSE: { from: ALL_STATES, to: 'SAME', roles: ['COORDINATOR', 'AGENCY_HEAD', 'APPROVER', 'REPAIR_CREW'], reasonRequired: false, eventType: 'response.added' },
  CORRECT: { from: ALL_STATES, to: 'SAME', roles: ['FIELD_INSPECTOR', 'COORDINATOR', 'APPROVER', 'REPAIR_CREW', 'SUPERVISOR', 'AGENCY_HEAD'], reasonRequired: true, eventType: 'correction.recorded' },
  SEED_IMPORT: { from: [null], to: 'SAME', roles: [], reasonRequired: false, eventType: 'demo.seeded' }
} as const satisfies Record<string, TransitionRule>;

export type V5Action = keyof typeof V5_TRANSITIONS;
export const V5_ACTIONS = Object.keys(V5_TRANSITIONS) as V5Action[];

export interface V5Command {
  action: V5Action;
  reason?: string;
  [field: string]: unknown;
}

export interface CommandContext {
  actor: V5Actor;
  now: string;
  expectedVersion: number;
  /** Authority lookup for routing rules that depend on the government level. */
  authorityLevel?: (authorityId: string) => string | null;
  /** Merge target lookup: must be open and on the same segment or within 25 m. */
  mergeTargetOk?: (caseId: string) => boolean;
  /** Region config (03 matrix note 5): who accepts swakelola routine work. Default APPROVER. */
  swakelolaAcceptRole?: 'APPROVER' | 'COORDINATOR';
}

/** A chained event, ready for `appendEvent`. Payload numbers must be integers (07 §2.1). */
export interface V5EventDraft {
  type: string;
  payload: Record<string, unknown>;
  evidenceSha256: string[];
  prevState: V5State | null;
  nextState: V5State | null;
  overlapBasis: string | null;
}

export type V5ErrorCode = 'INVALID_TRANSITION' | 'FORBIDDEN' | 'VERSION_CONFLICT' | 'VALIDATION';
export type V5Result = { ok: true; next: V5Case; event: V5EventDraft } | { ok: false; code: V5ErrorCode; rule?: string; message: string };
export type V5Failure = Extract<V5Result, { ok: false }>;
export const isV5Failure = (r: V5Result): r is V5Failure => r.ok === false;

const fail = (code: V5ErrorCode, message: string, rule?: string): V5Failure => ({ ok: false, code, message, ...(rule ? { rule } : {}) });

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const isPosInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const isNonNegInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const isIsoDate = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

function checkText(value: unknown, field: string): V5Failure | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return fail('VALIDATION', `${field} must be text.`);
  if (value.length > MAX_TEXT) return fail('VALIDATION', `${field} is longer than ${MAX_TEXT} characters.`);
  const banned = bannedWordsIn(value);
  if (banned.length > 0) return fail('VALIDATION', `Please use neutral wording in ${field}. Avoid: ${banned.join(', ')}. Try "needs clarification".`);
  return null;
}

function evidenceOf(cmd: V5Command): EvidenceRef[] {
  return Array.isArray(cmd.evidence) ? (cmd.evidence as EvidenceRef[]) : [];
}

/** Adds evidence, keeping one copy of a photo that was already saved stage by stage. */
function mergeEvidence(existing: readonly EvidenceRef[], added: readonly EvidenceRef[]): EvidenceRef[] {
  const ids = new Set(existing.map((e) => e.id));
  return [...existing, ...added.filter((e) => !ids.has(e.id))];
}

function stagesOf(items: readonly EvidenceRef[]): Set<string> {
  return new Set(items.filter((e) => e.kind === 'WORK_STAGE' && e.stage).map((e) => e.stage as string));
}

/** Action-specific rules that need the state or evidence. Returns the fields changed on the case. */
function applyPayload(c: V5Case, cmd: V5Command, ctx: CommandContext): { patch: Partial<V5Case>; to?: V5State; payload: Record<string, unknown> } | V5Failure {
  const { actor, now } = ctx;
  const evidence = evidenceOf(cmd);
  switch (cmd.action) {
    case 'SUBMIT': {
      const need = c.mode === 'TRACE' ? 3 : 1;
      if (evidence.length < need) return fail('VALIDATION', c.mode === 'TRACE' ? 'A long-damage report needs at least 3 photos.' : 'A report needs at least one photo.');
      return {
        patch: { evidence: [...c.evidence, ...evidence], damageClass: (cmd.classGuess as string) ?? null, sizeBand: (cmd.sizeBand as string) ?? null, trace: (cmd.trace as V5Case['trace']) ?? null },
        payload: { mode: c.mode, lat_e6: c.location.latE6, lon_e6: c.location.lonE6, accuracy_m: Math.round(c.location.accuracyM), capture_trust: c.captureTrust, class_guess: cmd.classGuess ?? null, size_band: cmd.sizeBand ?? null, trace_length_m: c.mode === 'TRACE' ? Math.round((cmd.trace as V5Case['trace'])?.lengthM ?? 0) : null }
      };
    }
    case 'BEGIN_SCREENING':
      return { patch: {}, payload: {} };
    case 'SCREENING_DONE':
    case 'AUTO_MERGE_SUGGEST': {
      const screening = cmd.screening as V5Case['screening'];
      const routing = cmd.routing as V5Case['routing'];
      if (!screening || !routing) return fail('VALIDATION', 'Screening needs a detection result and a routing result.');
      return {
        patch: { screening, routing, authorityId: routing.authorityId },
        payload: {
          detection_status: screening.status,
          model_id: screening.modelId,
          detection_label: screening.label,
          // Score in basis points (07 §2.1: no floats in the log).
          detection_score_bp: screening.score === null ? null : Math.round(screening.score * 10000),
          authority_id: routing.authorityId,
          segment_id: routing.segmentId,
          routing_confidence: routing.confidence,
          routing_basis: routing.basis,
          duplicate_case_ids: (cmd.duplicates as string[]) ?? []
        }
      };
    }
    case 'ACCEPT':
      if (!isText(cmd.damageClass)) return fail('VALIDATION', 'Confirm the damage class before accepting.');
      if (c.transferPending) return fail('VALIDATION', 'This case has a transfer waiting for confirmation.');
      return { patch: { damageClass: cmd.damageClass, acceptedAt: c.acceptedAt ?? now }, payload: { damage_class: cmd.damageClass, authority_id: c.authorityId } };
    case 'MERGE':
      if (!isText(cmd.intoCaseId)) return fail('VALIDATION', 'Choose the case to merge into.');
      if (cmd.intoCaseId === c.id) return fail('VALIDATION', 'A case cannot merge into itself.');
      if (ctx.mergeTargetOk && !ctx.mergeTargetOk(cmd.intoCaseId)) return fail('VALIDATION', 'The target must be an open case on the same road or within 25 m.');
      return { patch: { mergedIntoCaseId: cmd.intoCaseId }, payload: { into_case_id: cmd.intoCaseId } };
    case 'TRANSFER_AUTHORITY': {
      const target = cmd.target as { authorityId: string; authorityName: string; level: string } | undefined;
      if (!target?.authorityId || !target.authorityName || !target.level) return fail('VALIDATION', 'Choose the agency to transfer to.');
      const decree = cmd.decreeRef as Record<string, string>;
      const decreeText = decree.decreeId ?? `${decree.number} (${decree.date})`;
      const crossLevel = c.routing ? c.routing.authorityLevel !== target.level : true;
      if (crossLevel) {
        return {
          patch: { transferPending: { toAuthorityId: target.authorityId, toAuthorityName: target.authorityName, toLevel: target.level, decreeRef: decreeText, requestedByPersonId: actor.personId! } },
          payload: { to_authority_id: target.authorityId, decree_ref: decreeText, needs_confirmation: true }
        };
      }
      return {
        patch: { authorityId: target.authorityId, routing: { ...c.routing!, authorityId: target.authorityId, authorityName: target.authorityName, authorityLevel: target.level, basis: decreeText, confidence: 'HIGH', note: null } },
        to: 'TRIAGE',
        payload: { to_authority_id: target.authorityId, decree_ref: decreeText, needs_confirmation: false }
      };
    }
    case 'CONFIRM_TRANSFER': {
      const t = c.transferPending;
      if (!t) return fail('INVALID_TRANSITION', 'No transfer is waiting for confirmation.');
      if (actor.scope !== '*' && !actor.scope.includes(t.toAuthorityId)) return fail('FORBIDDEN', 'Only the target agency can confirm this transfer.', 'SOD-7');
      return {
        patch: { authorityId: t.toAuthorityId, transferPending: null, routing: { ...c.routing!, authorityId: t.toAuthorityId, authorityName: t.toAuthorityName, authorityLevel: t.toLevel, basis: t.decreeRef, confidence: 'HIGH', note: null } },
        payload: { to_authority_id: t.toAuthorityId, decree_ref: t.decreeRef }
      };
    }
    case 'REFER_EXTERNAL':
      if (!['SP4N_LAPOR', 'JAKI', 'OTHER'].includes(cmd.channel as string)) return fail('VALIDATION', 'Choose the channel: SP4N-LAPOR!, JAKI or other.');
      if (!isText(cmd.bundleSha256)) return fail('VALIDATION', 'The referral needs an export bundle hash.');
      return { patch: {}, payload: { channel: cmd.channel, bundle_sha256: cmd.bundleSha256, external_ticket_id: cmd.externalTicketId ?? null } };
    case 'CLOSE_INVALID':
      if (!['INVALID', 'OUT_OF_SCOPE'].includes(cmd.closureReason as string)) return fail('VALIDATION', 'Choose why the report is closed.');
      return { patch: { closureReason: cmd.closureReason as V5Case['closureReason'] }, payload: { closure_reason: cmd.closureReason } };
    case 'ASSIGN_INSPECTION':
      if (!isText(cmd.inspectorPersonId) || !isText(cmd.inspectorAccountId)) return fail('VALIDATION', 'Choose an inspector.');
      if (!isIsoDate(cmd.dueAt)) return fail('VALIDATION', 'Set a due date.');
      return {
        patch: { inspection: { inspectorPersonId: cmd.inspectorPersonId, inspectorAccountId: cmd.inspectorAccountId, dueAt: new Date(cmd.dueAt).toISOString(), instructions: (cmd.instructions as string) ?? '' } },
        payload: { due_at: new Date(cmd.dueAt).toISOString() }
      };
    case 'SUBMIT_INSPECTION': {
      if (!['CONFIRMED', 'NOT_FOUND', 'DIFFERENT_CLASS'].includes(cmd.verdict as string)) return fail('VALIDATION', 'Choose a verdict.');
      const cls = (cmd.classConfirmed as string) ?? c.damageClass;
      if (!evidence.some((e) => e.kind === 'OVERVIEW')) return fail('VALIDATION', 'Add an overview photo.');
      const depthNeeded = cmd.verdict !== 'NOT_FOUND' && DEPTH_REQUIRED_CLASSES.includes(cls as string);
      if (depthNeeded) {
        if (!evidence.some((e) => e.kind === 'DEPTH_RULER')) return fail('VALIDATION', 'A ruler-at-deepest-point photo is required for this damage.');
        if (!isPosInt(cmd.depthMmTyped)) return fail('VALIDATION', 'Type the depth in mm, as read from the ruler.');
      }
      if (cmd.verdict !== 'NOT_FOUND' && (!isPosInt(cmd.lengthMm) || !isPosInt(cmd.widthMm))) return fail('VALIDATION', 'Enter the length and width in mm.');
      // The server sets markerDetected from the photo itself; a photo with no card gives no scale.
      const hasMarker = evidence.some((e) => e.kind === 'MARKER_NADIR') && cmd.markerDetected !== false;
      const lengthMm = cmd.lengthMm as number;
      const widthMm = cmd.widthMm as number;
      const areaCm2 = cmd.verdict === 'NOT_FOUND' ? 0 : Math.round((lengthMm * widthMm) / 100);
      const areaStatus = hasMarker ? 'MEASURED' as const : 'AI_ESTIMATE' as const;
      const rulerCheck = (cmd.rulerCheck as V5Case['inspection']['rulerCheck']) ?? 'AI_UNREADABLE';
      return {
        patch: {
          evidence: [...c.evidence, ...evidence],
          damageClass: cls,
          inspection: { ...c.inspection!, submittedAt: now, verdict: cmd.verdict as V5Case['inspection']['verdict'], classConfirmed: cls, lengthMm, widthMm, areaCm2, areaStatus, depthMmTyped: (cmd.depthMmTyped as number) ?? null, rulerCheck, rulerMismatchAcknowledged: false, notes: (cmd.notes as string) ?? '' }
        },
        payload: { verdict: cmd.verdict, class_confirmed: cls, length_mm: lengthMm ?? null, width_mm: widthMm ?? null, area_cm2: areaCm2, area_status: areaStatus, depth_mm: (cmd.depthMmTyped as number) ?? null, ruler_check: rulerCheck }
      };
    }
    case 'REQUEST_REINSPECTION':
      return { patch: { inspection: { ...c.inspection!, submittedAt: undefined, verdict: undefined } }, payload: {} };
    case 'VERIFY_INSPECTION':
      if (c.inspection?.rulerCheck === 'MISMATCH' && cmd.acknowledgeRulerMismatch !== true) return fail('VALIDATION', 'The AI ruler reading differs from the typed depth. Acknowledge this first.');
      return { patch: { inspection: { ...c.inspection!, rulerMismatchAcknowledged: c.inspection?.rulerCheck === 'MISMATCH' } }, payload: { ruler_mismatch_acknowledged: c.inspection?.rulerCheck === 'MISMATCH' } };
    case 'CLOSE_NO_ACTION':
      return { patch: { closureReason: 'NO_ACTION_NEEDED' }, payload: { closure_reason: 'NO_ACTION_NEEDED' } };
    case 'PROPOSE_PLAN':
    case 'PROMOTE_TO_PERMANENT': {
      const areaCm2 = cmd.areaCm2;
      const thicknessMm = cmd.thicknessMm;
      const volumeCm3 = cmd.volumeCm3;
      if (!isText(cmd.repairType)) return fail('VALIDATION', 'Choose a repair type.');
      if (!['TEMPORARY', 'PERMANENT'].includes(cmd.category as string)) return fail('VALIDATION', 'Choose temporary or permanent.');
      if (!['ROUTINE', 'PRIORITY', 'URGENT'].includes(cmd.urgency as string)) return fail('VALIDATION', 'Choose an urgency.');
      if (!isText(cmd.rationale)) return fail('VALIDATION', 'Write a short reason for this plan.');
      if (!isPosInt(areaCm2) || !isPosInt(thicknessMm) || !isPosInt(volumeCm3)) return fail('VALIDATION', 'Plan quantities must come from the measurements.');
      // FI-7.1: quantities are recomputed on the server; more than 1% off is rejected.
      const expected = (areaCm2 * thicknessMm) / 10;
      if (Math.abs(volumeCm3 - expected) > expected * 0.01) return fail('VALIDATION', 'Volume must equal area × thickness (within 1%).');
      const costEstimateId = (cmd.costEstimateId as string) ?? null;
      const pinnRunId = (cmd.pinnRunId as string) ?? null;
      return {
        patch: {
          plan: { proposerPersonId: actor.personId!, repairType: cmd.repairType, category: cmd.category as 'TEMPORARY' | 'PERMANENT', areaCm2, thicknessMm, volumeCm3, costEstimateId, pinnRunId, urgency: cmd.urgency as V5Case['plan']['urgency'], rationale: cmd.rationale }
        },
        payload: { repair_type: cmd.repairType, category: cmd.category, area_cm2: areaCm2, thickness_mm: thicknessMm, volume_cm3: volumeCm3, cost_estimate_id: costEstimateId, pinn_run_id: pinnRunId ?? 'PINN_UNAVAILABLE', urgency: cmd.urgency, rationale: cmd.rationale }
      };
    }
    case 'RETURN_PLAN':
      return { patch: { plan: null }, payload: {} };
    case 'APPROVE_PLAN':
      if (!['APBN', 'APBD', 'DANA_DESA', 'BUJT', 'OTHER'].includes(cmd.budgetSource as string)) return fail('VALIDATION', 'Choose the budget source.');
      return { patch: { plan: { ...c.plan!, approverPersonId: actor.personId!, budgetSource: cmd.budgetSource as string } }, payload: { budget_source: cmd.budgetSource } };
    case 'ISSUE_WORK_ORDER': {
      if (!['SWAKELOLA', 'CONTRACT'].includes(cmd.type as string)) return fail('VALIDATION', 'Choose swakelola or contract.');
      if (!isText(cmd.crewPersonId) || !isText(cmd.crewAccountId)) return fail('VALIDATION', 'Choose a crew.');
      if (!isText(cmd.supervisorPersonId) || !isText(cmd.supervisorAccountId)) return fail('VALIDATION', 'Choose a supervisor.');
      if (cmd.type === 'CONTRACT' && !isText(cmd.packageId)) return fail('VALIDATION', 'A contract work order needs a package.');
      if (!isIsoDate(cmd.targetDate)) return fail('VALIDATION', 'Set a target date.');
      const category = (cmd.category as 'TEMPORARY' | 'PERMANENT') ?? c.plan?.category ?? 'PERMANENT';
      return {
        patch: {
          workOrder: {
            type: cmd.type as 'SWAKELOLA' | 'CONTRACT',
            crewPersonId: cmd.crewPersonId,
            crewAccountId: cmd.crewAccountId,
            crewOrgId: (cmd.crewOrgId as string) ?? null,
            supervisorPersonId: cmd.supervisorPersonId,
            supervisorAccountId: cmd.supervisorAccountId,
            supervisorOrgId: (cmd.supervisorOrgId as string) ?? null,
            packageId: (cmd.packageId as string) ?? null,
            providerOrgId: (cmd.providerOrgId as string) ?? null,
            targetDate: new Date(cmd.targetDate).toISOString(),
            category
          }
        },
        payload: { type: cmd.type, package_id: cmd.packageId ?? null, category, target_date: new Date(cmd.targetDate).toISOString() }
      };
    }
    case 'START_WORK': {
      const stages = stagesOf(evidence);
      const missing = START_WORK_STAGES.filter((s) => !stages.has(s));
      if (missing.length > 0) return fail('VALIDATION', `Add these photos first: ${missing.join(', ')}.`);
      return { patch: { evidence: mergeEvidence(c.evidence, evidence) }, payload: { stages: [...stages] } };
    }
    case 'SUBMIT_WORK_EVIDENCE': {
      const all = mergeEvidence(c.evidence, evidence);
      const stages = stagesOf(all);
      const required = c.workOrder?.category === 'TEMPORARY' ? TEMPORARY_HARD_STAGES : PERMANENT_HARD_STAGES;
      const missing = required.filter((s) => !stages.has(s));
      if (missing.length > 0) return fail('VALIDATION', `Checklist is not complete. Missing: ${missing.join(', ')}.`);
      return { patch: { evidence: all, workOrder: { ...c.workOrder!, submittedAt: now } }, payload: { stages: [...stages] } };
    }
    case 'REJECT_WORK':
      return { patch: { workOrder: { ...c.workOrder!, submittedAt: undefined } }, payload: { failed_stages: (cmd.failedStages as string[]) ?? [] } };
    case 'VERIFY_WORK': {
      // SV-1.1: the supervisor's own after-photo, taken after the crew submitted.
      if (!evidence.some((e) => e.kind === 'WORK_STAGE' && e.stage === 'SUPERVISOR_AFTER')) return fail('VALIDATION', 'Take your own after-photo with the straightedge on site.');
      // SV-1.3: any failed item blocks verification unless an override reason is recorded.
      const failed = (cmd.failedStages as string[]) ?? [];
      if (failed.length > 0 && !isText(cmd.overrideReason)) return fail('VALIDATION', 'An item failed. Reject the work, or record an override reason.');
      return {
        patch: { evidence: [...c.evidence, ...evidence], workOrder: { ...c.workOrder!, verifiedByRole: actor.role as string, verifiedAt: now } },
        payload: { failed_stages: failed, override_reason: (cmd.overrideReason as string) ?? null }
      };
    }
    case 'ACCEPT_WORK': {
      const wo = c.workOrder!;
      if (actor.role === 'COORDINATOR' && (wo.type !== 'SWAKELOLA' || ctx.swakelolaAcceptRole !== 'COORDINATOR')) return fail('FORBIDDEN', 'A coordinator can only accept swakelola work, when the region allows it.');
      if (wo.type === 'CONTRACT' && !isIsoDate(cmd.phoDate)) return fail('VALIDATION', 'Enter the PHO date from the handover record.');
      const maintenanceMonths = (cmd.maintenanceMonths as number) ?? null;
      if (maintenanceMonths !== null && !isNonNegInt(maintenanceMonths)) return fail('VALIDATION', 'Maintenance months must be a whole number.');
      const phoDate = isIsoDate(cmd.phoDate) ? new Date(cmd.phoDate).toISOString() : null;
      const t0 = phoDate ?? now;
      const followUps = followUpSchedule(c.id, t0, wo.category, maintenanceMonths);
      return {
        to: wo.category === 'TEMPORARY' ? 'REPAIRED_TEMPORARY' : 'MONITORING',
        patch: { workOrder: { ...wo, acceptedAt: now, phoDate, maintenanceMonths }, followUps },
        payload: { pho_date: phoDate, maintenance_months: maintenanceMonths, follow_ups: followUps.map((f) => ({ milestone: f.milestone, due_at: f.dueAt })) }
      };
    }
    case 'RECORD_FOLLOW_UP': {
      if (!isText(cmd.milestone) || !c.followUps.some((f) => f.milestone === cmd.milestone)) return fail('VALIDATION', 'This follow-up is not on the schedule.');
      if (actor.role === 'CITIZEN') {
        if (!['OK', 'DAMAGED'].includes(cmd.result as string)) return fail('VALIDATION', 'Choose "Still fixed" or "Broke again".');
        return {
          patch: { citizenConfirmations: [...c.citizenConfirmations, { milestone: cmd.milestone, result: cmd.result as 'OK' | 'DAMAGED', deviceRef: actor.accountId, at: now, withPhoto: evidence.length > 0 }], evidence: [...c.evidence, ...evidence] },
          payload: { milestone: cmd.milestone, result: cmd.result, source: 'CITIZEN' }
        };
      }
      if (!['OK', 'DEFECT'].includes(cmd.result as string)) return fail('VALIDATION', 'Choose OK or defect.');
      if (evidence.length === 0) return fail('VALIDATION', 'A follow-up needs a photo.');
      const source = actor.role === 'SUPERVISOR' ? 'SUPERVISOR' as const : 'INSPECTOR' as const;
      return {
        patch: {
          evidence: [...c.evidence, ...evidence],
          followUps: c.followUps.map((f) => (f.milestone === cmd.milestone ? { ...f, result: cmd.result as 'OK' | 'DEFECT', source, recordedAt: now } : f))
        },
        payload: { milestone: cmd.milestone, result: cmd.result, source, failure_modes: (cmd.failureModes as string[]) ?? [] }
      };
    }
    case 'REOPEN': {
      if (c.state === 'CLOSED' && c.closureReason !== 'MONITORING_COMPLETE') return fail('INVALID_TRANSITION', 'Only a case closed after monitoring can reopen.');
      const wo = c.workOrder;
      const maintenanceEnd = wo?.phoDate && wo.maintenanceMonths ? addMonthsIso(wo.phoDate, wo.maintenanceMonths) : null;
      const warrantyFlag = maintenanceEnd !== null && now <= maintenanceEnd;
      return { patch: { closureReason: null, warrantyFlag: c.warrantyFlag || warrantyFlag }, payload: { warranty_flag: warrantyFlag } };
    }
    case 'CLOSE_MONITORING': {
      const preFho = c.followUps.find((f) => f.milestone === 'PRE_FHO');
      const ok = preFho ? preFho.result === 'OK' : c.followUps.some((f) => f.milestone === 'M6' && f.result === 'OK');
      if (!ok) return fail('VALIDATION', 'Finish the required follow-ups before closing monitoring.');
      return { patch: { closureReason: 'MONITORING_COMPLETE' }, payload: { closure_reason: 'MONITORING_COMPLETE' } };
    }
    case 'SUPERSEDE':
      if (!isText(cmd.packageId)) return fail('VALIDATION', 'Name the package that covers this site.');
      return { patch: { closureReason: 'SUPERSEDED_BY_WORKS' }, payload: { closure_reason: 'SUPERSEDED_BY_WORKS', package_id: cmd.packageId } };
    case 'SET_PENDING':
      if (!isText(cmd.code)) return fail('VALIDATION', 'Choose a delay reason.');
      if (!isIsoDate(cmd.until) || new Date(cmd.until).toISOString() <= now) return fail('VALIDATION', 'The expected date must be in the future.');
      return {
        patch: { pending: { code: cmd.code, until: new Date(cmd.until).toISOString(), note: (cmd.note as string) ?? '', consecutive: (c.pending?.consecutive ?? 0) + 1 } },
        payload: { code: cmd.code, until: new Date(cmd.until).toISOString(), consecutive: (c.pending?.consecutive ?? 0) + 1 }
      };
    case 'MARK_HAZARD':
      if (!evidence.some((e) => e.kind === 'HAZARD_SIGN')) return fail('VALIDATION', 'Add a photo of the warning sign.');
      return { patch: { hazard: true, evidence: [...c.evidence, ...evidence] }, payload: {} };
    case 'ADD_RESPONSE':
      if (!isText(cmd.text)) return fail('VALIDATION', 'Write the response.');
      return { patch: {}, payload: { type: cmd.type ?? 'EXPLAIN', text: cmd.text } };
    case 'CORRECT':
      if (!isText(cmd.correctsEventHash) || !isText(cmd.fieldPath)) return fail('VALIDATION', 'Name the event and field being corrected.');
      return { patch: {}, payload: { corrects_event_hash: cmd.correctsEventHash, field_path: cmd.fieldPath, new_value: cmd.newValue ?? null } };
    default:
      return fail('INVALID_TRANSITION', `${cmd.action} is not available here.`);
  }
}

function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

/** Assignment checks (02 §3.3 server rules). */
function assignmentError(c: V5Case, cmd: V5Command, actor: V5Actor): V5Failure | null {
  const self = actor.accountId;
  switch (cmd.action) {
    case 'SUBMIT_INSPECTION':
    case 'PROPOSE_PLAN':
      if (c.inspection?.inspectorAccountId !== self) return fail('FORBIDDEN', 'This inspection is assigned to someone else.');
      break;
    case 'START_WORK':
    case 'SUBMIT_WORK_EVIDENCE':
      if (c.workOrder?.crewAccountId !== self) return fail('FORBIDDEN', 'This work order is assigned to another crew.');
      break;
    case 'VERIFY_WORK':
    case 'REJECT_WORK':
      if (c.workOrder?.supervisorAccountId !== self) return fail('FORBIDDEN', 'This repair is assigned to another supervisor.');
      break;
  }
  return null;
}

function inScope(c: V5Case, actor: V5Actor): boolean {
  if (actor.scope === '*' || c.authorityId === null) return true;
  return actor.scope.includes(c.authorityId);
}

export function applyCommand(c: V5Case, cmd: V5Command, ctx: CommandContext): V5Result {
  const rule: TransitionRule | undefined = V5_TRANSITIONS[cmd.action];
  if (!rule) return fail('INVALID_TRANSITION', 'Unknown action.');
  if (ctx.expectedVersion !== c.version) return fail('VERSION_CONFLICT', 'This case changed. Reload and try again.');

  const { actor } = ctx;
  const sodEarly = actor.role === 'AUDITOR' || (actor.role === 'ADMIN' && cmd.action !== 'CONFIRM_TRANSFER');
  if (sodEarly) return fail('FORBIDDEN', 'Auditors and admins cannot change a case.', 'SOD-8');
  if (!rule.roles.includes(actor.role as ActorRole)) return fail('FORBIDDEN', 'Your role cannot do this.');
  if (!rule.from.includes(c.state)) return fail('INVALID_TRANSITION', `This step is not available while the case is "${c.state ? V5_STATE_LABELS[c.state].en : 'new'}".`);
  if (cmd.action !== 'SUBMIT' && !(actor.kind === 'DEVICE' && cmd.action === 'RECORD_FOLLOW_UP') && actor.kind !== 'SYSTEM') {
    if (!inScope(c, actor) && cmd.action !== 'CONFIRM_TRANSFER') return fail('FORBIDDEN', 'This case belongs to another agency.');
  }
  const assigned = assignmentError(c, cmd, actor);
  if (assigned) return assigned;

  // CO-3.1: a transfer without a decree is a validation error, reported under its SoD rule.
  if (cmd.action === 'TRANSFER_AUTHORITY' && !hasDecree(cmd.decreeRef)) return fail('VALIDATION', 'SK citation required: give the decree number and date.', 'SOD-7');

  const sod = checkSod(cmd.action, cmd, c, actor);
  if (sod.ok === false) return fail('FORBIDDEN', sod.message, sod.rule);

  const needsReason = rule.reasonRequired && actor.kind !== 'SYSTEM';
  if (needsReason && (typeof cmd.reason !== 'string' || cmd.reason.trim().length < MIN_REASON_CHARS)) {
    return fail('VALIDATION', `Give a reason of at least ${MIN_REASON_CHARS} characters.`);
  }
  for (const field of ['reason', 'rationale', 'notes', 'note', 'instructions', 'text', 'overrideReason'] as const) {
    const bad = checkText(cmd[field], field);
    if (bad) return bad;
  }

  const applied = applyPayload(c, cmd, ctx);
  if ('ok' in applied) return applied;

  const nextState: V5State | null = applied.to ?? (rule.to === 'SAME' ? c.state : rule.to);
  const next: V5Case = { ...c, ...applied.patch, state: nextState, version: c.version + 1 };
  // A delay reason ends when the case moves on to a new state.
  if (nextState !== c.state) next.pending = null;

  const evidenceSha256 = evidenceOf(cmd).map((e) => e.sha256);
  const reason = typeof cmd.reason === 'string' && cmd.reason.trim() !== '' ? cmd.reason.trim() : undefined;
  return {
    ok: true,
    next,
    event: {
      type: rule.eventType,
      payload: { ...applied.payload, ...(reason ? { reason } : {}) },
      evidenceSha256,
      prevState: c.state,
      nextState,
      overlapBasis: sod.overlapBasis
    }
  };
}

export const SYSTEM_ACTOR: V5Actor = { kind: 'SYSTEM', accountId: 'system:screening', personId: null, role: 'SYSTEM', scope: '*' };
