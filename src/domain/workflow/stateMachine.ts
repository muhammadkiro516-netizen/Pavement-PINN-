/**
 * The one legal report workflow. Every role changes a report case only through
 * `applyCommand`, which checks the transition table, the actor's role and assignment,
 * the payload and the expected version, and returns the next case plus the audit record.
 * It never mutates its input, so a failed persistence step leaves the stored case intact.
 *
 * Decisions (docs/DECISION_LOG.md, D-010..D-014):
 * - AI screening and human verification are separate. The SYSTEM may only move a report
 *   to VERIFIED when a real trained model ran with sufficient confidence; the demo
 *   classifier and an unavailable model always route to NEEDS_REVIEW.
 * - Human verification of damage is the Field Engineer's inspection (INSPECTED).
 * - HD-WS-1 (MVP): the Operations Manager first verifies the inspection
 *   (VERIFY_INSPECTION / REQUEST_REINSPECTION -> INSPECTION_VERIFIED or back to the same
 *   engineer), then separately approves the operational treatment (APPROVE_ACTION /
 *   REJECT_ACTION). Each decision has its own state and audit record (inspectionReviews,
 *   approvals). The Policy Maker reviews policy priority and budget and has no workflow
 *   transitions; the engineer who recommended an action cannot approve it.
 * - The work order is an internal record, explicitly not an official SPK document.
 */
import type { UserRole } from '../../types';
import { samePerson } from '../identity/people';
import type { AssessmentSnapshot } from '../intelligence/assessment';
import {
  Actor,
  ApprovalRecord,
  InspectionRecord,
  ReportCase,
  ScreeningResult,
  TransitionRecord,
  WorkflowAction,
  WorkflowState,
  type WorkOrder,
  type CaseAuthority,
  type RepairCheck
} from './model';

export const SCREENING_CONFIDENCE_THRESHOLD = 0.6;
const MAX_TEXT = 1000;

type ActorRole = UserRole | 'SYSTEM';

interface TransitionRule {
  from: readonly (WorkflowState | null)[];
  to: WorkflowState | 'SAME';
  roles: readonly ActorRole[];
  /** Human decisions must carry a reason. */
  reasonRequired: boolean;
  publicNote: string;
}

const CITIZEN_OR_STAFF: readonly ActorRole[] = ['PUBLIC_REPORTER', 'PUBLIC_VIEWER', 'FIELD_ENGINEER', 'OPERATIONS_MANAGER', 'POLICY_MAKER'];

export const TRANSITIONS: Readonly<Record<WorkflowAction, TransitionRule>> = {
  SUBMIT: { from: [null], to: 'SUBMITTED', roles: CITIZEN_OR_STAFF, reasonRequired: false, publicNote: 'Laporan diterima' },
  BEGIN_SCREENING: { from: ['SUBMITTED'], to: 'AI_SCREENING', roles: ['SYSTEM'], reasonRequired: false, publicNote: 'Penyaringan otomatis dimulai' },
  SCREENING_PASSED: { from: ['AI_SCREENING'], to: 'VERIFIED', roles: ['SYSTEM'], reasonRequired: false, publicNote: 'Lolos penyaringan otomatis, menunggu tindak lanjut' },
  SCREENING_NEEDS_REVIEW: { from: ['AI_SCREENING'], to: 'NEEDS_REVIEW', roles: ['SYSTEM'], reasonRequired: false, publicNote: 'Menunggu peninjauan petugas' },
  REVIEW_ACCEPT: { from: ['NEEDS_REVIEW'], to: 'VERIFIED', roles: ['OPERATIONS_MANAGER'], reasonRequired: true, publicNote: 'Laporan diterima petugas untuk ditindaklanjuti' },
  CLOSE_INVALID: { from: ['NEEDS_REVIEW', 'VERIFIED'], to: 'CLOSED', roles: ['OPERATIONS_MANAGER'], reasonRequired: true, publicNote: 'Laporan ditutup: tidak dapat ditindaklanjuti' },
  REQUEST_INSPECTION: { from: ['VERIFIED'], to: 'FIELD_INSPECTION_REQUESTED', roles: ['OPERATIONS_MANAGER'], reasonRequired: true, publicNote: 'Inspeksi lapangan dijadwalkan' },
  SUBMIT_INSPECTION: { from: ['FIELD_INSPECTION_REQUESTED'], to: 'INSPECTED', roles: ['FIELD_ENGINEER'], reasonRequired: false, publicNote: 'Inspeksi lapangan selesai' },
  VERIFY_INSPECTION: { from: ['INSPECTED'], to: 'INSPECTION_VERIFIED', roles: ['OPERATIONS_MANAGER'], reasonRequired: true, publicNote: 'Hasil inspeksi diverifikasi petugas' },
  REQUEST_REINSPECTION: { from: ['INSPECTED'], to: 'FIELD_INSPECTION_REQUESTED', roles: ['OPERATIONS_MANAGER'], reasonRequired: true, publicNote: 'Inspeksi lapangan diulang' },
  RECOMMEND_ACTION: { from: ['INSPECTION_VERIFIED'], to: 'ACTION_RECOMMENDED', roles: ['FIELD_ENGINEER'], reasonRequired: false, publicNote: 'Rekomendasi penanganan disusun' },
  CLOSE_NO_ACTION: { from: ['INSPECTION_VERIFIED'], to: 'CLOSED', roles: ['OPERATIONS_MANAGER'], reasonRequired: true, publicNote: 'Ditutup: tidak memerlukan penanganan' },
  APPROVE_ACTION: { from: ['ACTION_RECOMMENDED'], to: 'ACTION_APPROVED', roles: ['OPERATIONS_MANAGER'], reasonRequired: true, publicNote: 'Penanganan disetujui' },
  REJECT_ACTION: { from: ['ACTION_RECOMMENDED'], to: 'INSPECTION_VERIFIED', roles: ['OPERATIONS_MANAGER'], reasonRequired: true, publicNote: 'Rekomendasi dikaji ulang' },
  START_WORK: { from: ['ACTION_APPROVED'], to: 'IN_PROGRESS', roles: ['OPERATIONS_MANAGER'], reasonRequired: true, publicNote: 'Pekerjaan perbaikan dimulai' },
  // F.E sends repair evidence; M.O verifies it (RESOLVE) or asks for rework. Same state until verified.
  COMPLETE_WORK_ORDER: { from: ['IN_PROGRESS', 'FIELD_INSPECTION_REQUESTED', 'INSPECTED'], to: 'IN_PROGRESS', roles: ['FIELD_ENGINEER'], reasonRequired: true, publicNote: 'Pekerjaan lapangan selesai, menunggu verifikasi' },
  REQUEST_REWORK: { from: ['IN_PROGRESS', 'INSPECTED'], to: 'IN_PROGRESS', roles: ['OPERATIONS_MANAGER'], reasonRequired: true, publicNote: 'Perbaikan perlu diulang' },
  RESOLVE: { from: ['IN_PROGRESS', 'INSPECTED'], to: 'RESOLVED', roles: ['OPERATIONS_MANAGER'], reasonRequired: true, publicNote: 'Perbaikan terverifikasi petugas' },
  CLOSE_RESOLVED: { from: ['RESOLVED'], to: 'CLOSED', roles: ['OPERATIONS_MANAGER'], reasonRequired: true, publicNote: 'Laporan ditutup' },
  TRANSFER_AUTHORITY: { from: ['NEEDS_REVIEW', 'VERIFIED'], to: 'SAME', roles: ['OPERATIONS_MANAGER'], reasonRequired: true, publicNote: 'Laporan dialihkan ke instansi yang berwenang' },
  MARK_HAZARD: { from: ['VERIFIED', 'FIELD_INSPECTION_REQUESTED', 'INSPECTED', 'INSPECTION_VERIFIED', 'ACTION_RECOMMENDED', 'ACTION_APPROVED', 'IN_PROGRESS'], to: 'SAME', roles: ['FIELD_ENGINEER', 'OPERATIONS_MANAGER'], reasonRequired: true, publicNote: 'Rambu peringatan sementara dipasang di lokasi' },
  SEED_IMPORT: { from: [null], to: 'SAME', roles: [], reasonRequired: false, publicNote: 'Data contoh (DEMO) dimuat ke sistem' }
};

export type WorkflowCommand =
  | { action: 'BEGIN_SCREENING' }
  | { action: 'SCREENING_PASSED' | 'SCREENING_NEEDS_REVIEW'; screening: ScreeningResult }
  | { action: 'REVIEW_ACCEPT' | 'CLOSE_INVALID' | 'VERIFY_INSPECTION' | 'REQUEST_REINSPECTION' | 'CLOSE_NO_ACTION' | 'APPROVE_ACTION' | 'REJECT_ACTION' | 'REQUEST_REWORK' | 'RESOLVE' | 'CLOSE_RESOLVED'; reason: string }
  | { action: 'COMPLETE_WORK_ORDER'; reason: string; completionPhotoUrl: string; repairCheck?: RepairCheck | null }
  | { action: 'REQUEST_INSPECTION'; reason: string; engineerId: string; dueAt: string; instructions: string }
  | {
      action: 'SUBMIT_INSPECTION';
      verdict: InspectionRecord['verdict'];
      cvReview: InspectionRecord['cvReview'];
      measuredDepthCm: number | null;
      measuredAreaM2: number | null;
      severity: InspectionRecord['severity'];
      notes: string;
      /** Optional field photo; the server checks the image bytes (photoValidation.ts). */
      evidencePhotoUrl?: string | null;
    }
  | { action: 'RECOMMEND_ACTION'; treatment: string; urgency: 'ROUTINE' | 'PRIORITY' | 'URGENT'; rationale: string; assessmentId: string | null; assessment?: AssessmentSnapshot | null }
  | { action: 'START_WORK'; reason: string; contractorNote: string; contractor?: string; contractValueIdr?: number | null; targetDate?: string | null; supervisor?: string }
  | { action: 'TRANSFER_AUTHORITY'; reason: string; agencyId: string; agencyName: string; level: CaseAuthority['level'] }
  | { action: 'MARK_HAZARD'; reason: string; photoUrl: string; note: string };

export interface CommandContext {
  actor: Actor;
  /** ISO timestamp supplied by the caller (the server clock). */
  now: string;
  newId: (prefix: string) => string;
  /** Version the client last saw; a mismatch is a concurrent change and is rejected. */
  expectedVersion: number;
  /** Role lookup for ids referenced in a command (e.g. the engineer being assigned). */
  roleOf: (accountId: string) => UserRole | null;
}

export type WorkflowErrorCode = 'INVALID_TRANSITION' | 'FORBIDDEN' | 'VERSION_CONFLICT' | 'VALIDATION';
export type CommandResult =
  | { ok: true; next: ReportCase; record: TransitionRecord }
  | { ok: false; code: WorkflowErrorCode; message: string };

export type CommandFailure = Extract<CommandResult, { ok: false }>;
/** Type guard (the project compiles without strictNullChecks, so `!r.ok` does not narrow). */
export const isFailure = (r: CommandResult): r is CommandFailure => r.ok === false;

const fail = (code: WorkflowErrorCode, message: string): CommandResult => ({ ok: false, code, message });

function cleanText(value: unknown, field: string, required: boolean): string | CommandResult {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') return fail('VALIDATION', `${field} must be text.`);
  const text = value.trim();
  if (required && text === '') return fail('VALIDATION', `${field} is required.`);
  if (text.length > MAX_TEXT) return fail('VALIDATION', `${field} is longer than ${MAX_TEXT} characters.`);
  return text;
}

function validSnapshot(a: unknown): a is AssessmentSnapshot {
  if (!a || typeof a !== 'object') return false;
  const s = a as AssessmentSnapshot;
  return (
    typeof s.id === 'string' &&
    (s.engine === 'PINN' || s.engine === 'EVIDENCE' || (s.engine as string) === 'RULE_BASED') &&
    typeof s.modelVersion === 'string' &&
    ['HIGH', 'WATCH', 'MODERATE', 'GOOD'].includes(s.risk) &&
    s.validationStatus === 'VALIDATION_REQUIRED'
  );
}

const isResult = (v: unknown): v is CommandResult => typeof v === 'object' && v !== null && 'ok' in v;

function optionalMeasure(value: unknown, field: string): number | null | CommandResult {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10000) {
    return fail('VALIDATION', `${field} must be a non-negative number.`);
  }
  return value;
}

const PHOTO_REF = new RegExp("^(data:image/(jpeg|png|webp);base64,|https?://)", "i");

/** Which actions this actor could take on this case right now (drives the UI buttons). */
export function availableActions(c: ReportCase, actor: Actor): WorkflowAction[] {
  return (Object.keys(TRANSITIONS) as WorkflowAction[]).filter((action) => {
    if (action === 'SUBMIT' || action === 'SEED_IMPORT') return false;
    const rule = TRANSITIONS[action];
    if (!rule.from.includes(c.state) || !rule.roles.includes(actor.role)) return false;
    return assignmentGuard(action, c, actor) === null;
  });
}

/** Rules that depend on who is assigned/recommended, beyond the role check. */
function assignmentGuard(action: WorkflowAction, c: ReportCase, actor: Actor): string | null {
  switch (action) {
    case 'SUBMIT_INSPECTION':
    case 'RECOMMEND_ACTION':
      if (!c.assignment || !samePerson(c.assignment.engineerId, actor.id)) return 'Only the assigned field engineer may do this.';
      if (action === 'RECOMMEND_ACTION' && c.inspection?.verdict !== 'CONFIRMED') return 'An action can only be recommended after damage is confirmed.';
      return null;
    case 'MARK_HAZARD':
      if (c.hazard) return 'A warning sign is already recorded for this report.';
      if (actor.role === 'FIELD_ENGINEER' && (!c.assignment || !samePerson(c.assignment.engineerId, actor.id))) return 'Only the assigned field engineer may do this.';
      return null;
    case 'APPROVE_ACTION':
      if (c.recommendation && samePerson(c.recommendation.recommendedBy, actor.id)) return 'The person who recommended an action cannot approve it.';
      return null;
    case 'RESOLVE':
    case 'REQUEST_REWORK':
      if (!c.workOrder?.completionPhotoUrl && !c.inspection?.evidencePhotoUrl) return 'The assigned engineer has not sent repair evidence yet.';
      return null;
    case 'COMPLETE_WORK_ORDER':
      if (c.state === 'FIELD_INSPECTION_REQUESTED' && !c.workOrder) return 'There is no open work order.';
      if (c.workOrder && c.workOrder.status === 'COMPLETED') return 'There is no open work order.';
      if (!c.assignment || !samePerson(c.assignment.engineerId, actor.id)) return 'Only the assigned field engineer may do this.';
      return null;
    default:
      return null;
  }
}

export function applyCommand(c: ReportCase, command: WorkflowCommand, ctx: CommandContext): CommandResult {
  const rule = TRANSITIONS[command.action as WorkflowAction];
  if (!rule || command.action === ('SUBMIT' as string) || command.action === ('SEED_IMPORT' as string)) {
    return fail('INVALID_TRANSITION', 'Unknown workflow action.');
  }
  if (!ctx.actor || !ctx.actor.id) return fail('FORBIDDEN', 'No actor.');
  if (ctx.expectedVersion !== c.version) {
    return fail('VERSION_CONFLICT', `The report changed since it was loaded (version ${c.version}, expected ${ctx.expectedVersion}). Reload and try again.`);
  }
  if (!rule.from.includes(c.state)) {
    return fail('INVALID_TRANSITION', `${command.action} is not allowed from ${c.state}.`);
  }
  if (!rule.roles.includes(ctx.actor.role)) return fail('FORBIDDEN', `${ctx.actor.role} may not ${command.action}.`);
  const guard = assignmentGuard(command.action, c, ctx.actor);
  if (guard) return fail('FORBIDDEN', guard);

  const reasonInput = 'reason' in command ? command.reason : '';
  const reason = cleanText(reasonInput, 'reason', rule.reasonRequired);
  if (isResult(reason)) return reason;

  const next: ReportCase = {
    ...c,
    approvals: [...c.approvals],
    inspectionReviews: [...(c.inspectionReviews ?? [])],
    history: [...c.history]
  };
  let autoReason = '';

  switch (command.action) {
    case 'BEGIN_SCREENING':
      autoReason = 'Penyaringan otomatis dimulai.';
      break;
    case 'SCREENING_PASSED':
    case 'SCREENING_NEEDS_REVIEW': {
      const s = command.screening;
      if (!s || !['REAL', 'DEMO', 'MODEL_UNAVAILABLE'].includes(s.modelStatus)) return fail('VALIDATION', 'Screening result is missing.');
      if (command.action === 'SCREENING_PASSED') {
        const confident = s.modelStatus === 'REAL' && typeof s.confidence === 'number' && s.confidence >= SCREENING_CONFIDENCE_THRESHOLD && s.passed;
        if (!confident) return fail('VALIDATION', 'Only a real model result with sufficient confidence can pass screening automatically.');
      }
      next.screening = { ...s, reasons: [...s.reasons] };
      autoReason = s.reasons.join(' ') || command.action;
      break;
    }
    case 'REQUEST_INSPECTION': {
      if (ctx.roleOf(command.engineerId) !== 'FIELD_ENGINEER') return fail('VALIDATION', 'The assignee must be a field engineer account.');
      if (Number.isNaN(Date.parse(command.dueAt)) || Date.parse(command.dueAt) <= Date.parse(ctx.now)) {
        return fail('VALIDATION', 'The inspection deadline must be a future date.');
      }
      const instructions = cleanText(command.instructions, 'instructions', false);
      if (isResult(instructions)) return instructions;
      next.assignment = {
        id: ctx.newId('ASG'),
        engineerId: command.engineerId,
        assignedBy: ctx.actor.id,
        assignedAt: ctx.now,
        dueAt: new Date(command.dueAt).toISOString(),
        instructions
      };
      break;
    }
    case 'SUBMIT_INSPECTION': {
      if (!['CONFIRMED', 'NOT_CONFIRMED'].includes(command.verdict)) return fail('VALIDATION', 'verdict must be CONFIRMED or NOT_CONFIRMED.');
      if (!['LIGHT', 'MODERATE', 'SEVERE', 'CRITICAL'].includes(command.severity)) return fail('VALIDATION', 'severity is invalid.');
      const depth = optionalMeasure(command.measuredDepthCm, 'measuredDepthCm');
      if (isResult(depth)) return depth;
      const area = optionalMeasure(command.measuredAreaM2, 'measuredAreaM2');
      if (isResult(area)) return area;
      const notes = cleanText(command.notes, 'notes', true);
      if (isResult(notes)) return notes;
      const evidence = command.evidencePhotoUrl ?? null;
      if (evidence !== null && (typeof evidence !== 'string' || !/^(data:image\/(jpeg|png|webp);base64,|https?:\/\/)/i.test(evidence))) {
        return fail('VALIDATION', 'evidencePhotoUrl must be a JPEG, PNG or WebP image.');
      }
      const review = command.cvReview ?? { accepted: true, correctedClass: null };
      const corrected = review.accepted ? null : cleanText(review.correctedClass, 'correctedClass', true);
      if (isResult(corrected)) return corrected;
      next.inspection = {
        id: ctx.newId('INS'),
        engineerId: ctx.actor.id,
        inspectedAt: ctx.now,
        verdict: command.verdict,
        cvReview: { accepted: !!review.accepted, correctedClass: corrected },
        measuredDepthCm: depth,
        measuredAreaM2: area,
        severity: command.severity,
        notes,
        evidencePhotoUrl: evidence,
        dataStatus: 'OBSERVED'
      };
      autoReason = command.verdict === 'CONFIRMED' ? 'Hasil inspeksi: kerusakan terkonfirmasi.' : 'Hasil inspeksi: kerusakan tidak terkonfirmasi.';
      break;
    }
    case 'RECOMMEND_ACTION': {
      const treatment = cleanText(command.treatment, 'treatment', true);
      if (isResult(treatment)) return treatment;
      const rationale = cleanText(command.rationale, 'rationale', true);
      if (isResult(rationale)) return rationale;
      if (!['ROUTINE', 'PRIORITY', 'URGENT'].includes(command.urgency)) return fail('VALIDATION', 'urgency is invalid.');
      next.recommendation = {
        id: ctx.newId('REC'),
        recommendedBy: ctx.actor.id,
        recommendedAt: ctx.now,
        treatment,
        urgency: command.urgency,
        rationale,
        assessmentId: typeof command.assessmentId === 'string' ? command.assessmentId : null,
        assessment: validSnapshot(command.assessment) ? { ...command.assessment! } : null
      };
      autoReason = `Dikirim untuk verifikasi M.O: rekomendasi ${treatment}.`;
      break;
    }
    case 'VERIFY_INSPECTION':
    case 'REQUEST_REINSPECTION': {
      next.inspectionReviews!.push({
        id: ctx.newId('IRV'),
        inspectionId: next.inspection?.id ?? null,
        decidedBy: ctx.actor.id,
        decidedAt: ctx.now,
        decision: command.action === 'VERIFY_INSPECTION' ? 'VERIFIED' : 'REINSPECTION_REQUESTED',
        reason: reason as string
      });
      break;
    }
    case 'APPROVE_ACTION':
    case 'REJECT_ACTION': {
      const approval: ApprovalRecord = {
        id: ctx.newId('APR'),
        decidedBy: ctx.actor.id,
        decidedAt: ctx.now,
        decision: command.action === 'APPROVE_ACTION' ? 'APPROVED' : 'REJECTED',
        reason: reason as string
      };
      next.approvals.push(approval);
      if (command.action === 'REJECT_ACTION') next.recommendation = null;
      break;
    }
    case 'START_WORK': {
      const contractorNote = cleanText(command.contractorNote, 'contractorNote', false);
      if (isResult(contractorNote)) return contractorNote;
      const contractor = cleanText(command.contractor ?? '', 'contractor', false);
      if (isResult(contractor)) return contractor;
      const supervisor = cleanText(command.supervisor ?? '', 'supervisor', false);
      if (isResult(supervisor)) return supervisor;
      const value = command.contractValueIdr;
      if (value != null && (!Number.isFinite(value) || value < 0 || value > 1e13)) return fail('VALIDATION', 'contractValueIdr must be a positive amount in rupiah.');
      const target = command.targetDate ?? null;
      if (target !== null && (Number.isNaN(Date.parse(target)) || Date.parse(target) < Date.parse(ctx.now) - 86400000)) return fail('VALIDATION', 'targetDate must be today or later.');
      next.workOrder = {
        id: ctx.newId('WO'),
        issuedBy: ctx.actor.id,
        issuedAt: ctx.now,
        status: 'ISSUED',
        contractorNote,
        contractor: contractor || null,
        contractValueIdr: value ?? null,
        targetDate: target,
        supervisor: supervisor || null,
        completedAt: null,
        isOfficialDocument: false
      };
      break;
    }
    case 'TRANSFER_AUTHORITY': {
      if (!command.agencyId || !command.agencyName) return fail('VALIDATION', 'Choose the agency to transfer to.');
      if (c.authority?.agencyId === command.agencyId) return fail('VALIDATION', 'The report is already with this agency.');
      next.authorityHistory = [...(c.authorityHistory ?? []), { at: ctx.now, by: ctx.actor.id, from: c.authority?.agencyId ?? null, to: command.agencyId, reason: reason as string }];
      next.authority = { agencyId: command.agencyId, level: command.level, name: command.agencyName, confidence: 'HIGH', basis: `Didisposisikan Koordinator: ${reason as string}` };
      autoReason = `Dialihkan ke ${command.agencyName}.`;
      break;
    }
    case 'MARK_HAZARD': {
      if (typeof command.photoUrl !== 'string' || !PHOTO_REF.test(command.photoUrl)) return fail('VALIDATION', 'A photo of the warning sign is required.');
      const note = cleanText(command.note ?? '', 'note', false);
      if (isResult(note)) return note;
      next.hazard = { at: ctx.now, by: ctx.actor.id, photoUrl: command.photoUrl, note };
      autoReason = 'Rambu peringatan sementara dipasang.';
      break;
    }
    case 'COMPLETE_WORK_ORDER': {
      const photo = command.completionPhotoUrl;
      if (typeof photo !== 'string' || !PHOTO_REF.test(photo)) {
        return fail('VALIDATION', 'completionPhotoUrl must be a JPEG, PNG or WebP image of the finished repair.');
      }
      if (photo === c.report.photoUrl) return fail('VALIDATION', 'The repair photo must be a new photo, not the citizen report photo.');
      const submission = { photoUrl: photo, note: reason as string, by: ctx.actor.id, at: ctx.now };
      const currentWo: WorkOrder = c.workOrder ?? {
        id: ctx.newId('WO'),
        issuedBy: c.assignment?.assignedBy ?? ctx.actor.id,
        issuedAt: c.assignment?.assignedAt ?? ctx.now,
        status: 'ISSUED',
        contractorNote: c.assignment?.instructions ?? 'Perintah kerja perbaikan',
        completedAt: null,
        submissions: [],
        isOfficialDocument: false
      };
      next.workOrder = {
        ...currentWo,
        status: 'COMPLETED',
        completedAt: ctx.now,
        completionPhotoUrl: photo,
        completionNote: reason as string,
        completedBy: ctx.actor.id,
        submissions: [...(currentWo.submissions ?? []), submission],
        repairCheck: command.repairCheck ?? null
      };
      break;
    }
    case 'REQUEST_REWORK':
    case 'RESOLVE': {
      const decided = { decision: command.action === 'RESOLVE' ? ('VERIFIED' as const) : ('REWORK_REQUESTED' as const), decidedBy: ctx.actor.id, decidedAt: ctx.now, reason: reason as string };
      const currentWo: WorkOrder = c.workOrder ?? {
        id: ctx.newId('WO'),
        issuedBy: c.assignment?.assignedBy ?? ctx.actor.id,
        issuedAt: c.assignment?.assignedAt ?? ctx.now,
        status: 'ISSUED',
        contractorNote: c.assignment?.instructions ?? 'Perintah kerja perbaikan',
        completedAt: null,
        submissions: [],
        isOfficialDocument: false
      };
      const subs = [...(currentWo.submissions ?? [])];
      if (subs.length) subs[subs.length - 1] = { ...subs[subs.length - 1], ...decided };
      // Rework reopens the order; the earlier evidence stays in submissions.
      next.workOrder = command.action === 'RESOLVE'
        ? {
            ...currentWo,
            status: 'COMPLETED',
            completionPhotoUrl: currentWo.completionPhotoUrl || c.inspection?.evidencePhotoUrl || c.report.photoUrl,
            completedAt: currentWo.completedAt || ctx.now,
            completedBy: currentWo.completedBy || ctx.actor.id,
            submissions: subs
          }
        : { ...currentWo, status: 'IN_PROGRESS', completedAt: null, submissions: subs };
      break;
    }
    default:
      break;
  }

  const to = rule.to === 'SAME' ? c.state : rule.to;
  const record: TransitionRecord = {
    id: ctx.newId('TRN'),
    at: ctx.now,
    action: command.action,
    from: c.state,
    to,
    actor: { ...ctx.actor },
    reason: (reason as string) || autoReason,
    publicNote: rule.publicNote
  };
  next.state = to;
  next.version = c.version + 1;
  next.updatedAt = ctx.now;
  next.history.push(record);
  return { ok: true, next, record };
}

/** Build a new case from a validated citizen report (the SUBMIT transition). */
export function createReportCase(
  report: ReportCase['report'],
  actor: Actor,
  ctx: { now: string; newId: (prefix: string) => string; claimTokenHash?: string | null; dataStatus?: ReportCase['dataStatus'] }
): { next: ReportCase; record: TransitionRecord } {
  const rule = TRANSITIONS.SUBMIT;
  const record: TransitionRecord = {
    id: ctx.newId('TRN'),
    at: ctx.now,
    action: 'SUBMIT',
    from: null,
    to: 'SUBMITTED',
    actor: { ...actor },
    reason: 'Laporan warga dikirim.',
    publicNote: rule.publicNote
  };
  const next: ReportCase = {
    id: report.id,
    version: 1,
    state: 'SUBMITTED',
    segmentId: report.segmentId,
    report,
    createdBy: { ...actor },
    createdAt: ctx.now,
    updatedAt: ctx.now,
    claimTokenHash: ctx.claimTokenHash ?? null,
    dataStatus: ctx.dataStatus ?? 'USER_GENERATED',
    screening: null,
    assignment: null,
    inspection: null,
    recommendation: null,
    approvals: [],
    inspectionReviews: [],
    workOrder: null,
    history: [record]
  };
  return { next, record };
}
