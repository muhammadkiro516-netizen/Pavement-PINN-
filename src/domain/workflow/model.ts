/**
 * Canonical cross-role workflow model (spec v2.2 §24, "State Machine Laporan").
 *
 * One report case links the citizen report to the inspection assignment, the field
 * inspection, the engineering assessment, the maintenance recommendation, its human
 * approval and the work order. Every role reads and changes the same record through the
 * transitions in `stateMachine.ts`; nothing here is UI state.
 *
 * Pure and isomorphic: used by the Express API (authoritative) and by the browser's
 * offline demo store. No I/O, no clock, no randomness — callers pass `now` and ids.
 */
import type { DamageReport, UserRole } from '../../types';
import type { AssessmentSnapshot } from '../intelligence/assessment';

/** Report lifecycle, verbatim from the spec (§24). */
export const WORKFLOW_STATES = [
  'SUBMITTED',
  'AI_SCREENING',
  'NEEDS_REVIEW',
  'VERIFIED',
  'FIELD_INSPECTION_REQUESTED',
  'INSPECTED',
  /** M.O verified the F.E inspection (independent of approving any treatment). */
  'INSPECTION_VERIFIED',
  'ACTION_RECOMMENDED',
  'ACTION_APPROVED',
  'IN_PROGRESS',
  'RESOLVED',
  'CLOSED'
] as const;
export type WorkflowState = (typeof WORKFLOW_STATES)[number];

/** Who acted. `SYSTEM` is the automated screening step; it never makes human decisions. */
/** `ACCOUNT` = a registered account (server account store); `DEMO_ACCOUNT` = test fixtures only. */
export type ActorKind = 'ACCOUNT' | 'DEMO_ACCOUNT' | 'ANONYMOUS' | 'SYSTEM';
export interface Actor {
  id: string;
  role: UserRole | 'SYSTEM';
  kind: ActorKind;
}

export const SYSTEM_ACTOR: Actor = { id: 'system:screening', role: 'SYSTEM', kind: 'SYSTEM' };

/** Data status labels (spec §28 + execution brief §P). */
export type DataStatus =
  | 'PUBLIC_ARCHIVE'
  | 'OBSERVED'
  | 'USER_GENERATED'
  | 'PUBLIC'
  | 'INFERRED'
  | 'ESTIMATED'
  | 'SYNTHETIC'
  | 'SIMULATED'
  | 'ILLUSTRATIVE'
  | 'RULE_BASED'
  | 'DEMO'
  | 'MODEL_UNAVAILABLE';

/** Outcome of the automated screening step. Never a human verification. */
export interface ScreeningResult {
  /** `REAL` only when a trained model actually ran; the demo classifier is `DEMO`. */
  modelStatus: 'REAL' | 'DEMO' | 'MODEL_UNAVAILABLE';
  modelVersion: string | null;
  detectedClass: string | null;
  /** 0..1, null when no model output exists. */
  confidence: number | null;
  passed: boolean;
  reasons: string[];
  at: string;
}

export interface InspectionAssignment {
  id: string;
  engineerId: string;
  assignedBy: string;
  assignedAt: string;
  dueAt: string;
  instructions: string;
}

/** Structured field record written by the assigned engineer (human verification). */
export interface InspectionRecord {
  id: string;
  engineerId: string;
  inspectedAt: string;
  /** Did the engineer confirm damage at the reported location? */
  verdict: 'CONFIRMED' | 'NOT_CONFIRMED';
  /** Engineer's review of the citizen/CV class: accepted as-is or corrected. */
  cvReview: { accepted: boolean; correctedClass: string | null };
  measuredDepthCm: number | null;
  measuredAreaM2: number | null;
  severity: 'LIGHT' | 'MODERATE' | 'SEVERE' | 'CRITICAL';
  notes: string;
  /** Field photo taken by the engineer (data URL in the demo store). Optional: older records have none. */
  evidencePhotoUrl?: string | null;
  /** Provenance of the measurements: observed in the field by a person. */
  dataStatus: 'OBSERVED';
}

export interface MaintenanceRecommendation {
  id: string;
  recommendedBy: string;
  recommendedAt: string;
  treatment: string;
  urgency: 'ROUTINE' | 'PRIORITY' | 'URGENT';
  rationale: string;
  /** Engineering assessment the recommendation is based on (PINN or labelled fallback). */
  assessmentId: string | null;
  /** Snapshot of that assessment, so its engine, version and validation status travel with the decision. */
  assessment: AssessmentSnapshot | null;
}

/** M.O's verification of an F.E inspection, audited separately from treatment approvals. */
export interface InspectionReviewRecord {
  id: string;
  inspectionId: string | null;
  decidedBy: string;
  decidedAt: string;
  decision: 'VERIFIED' | 'REINSPECTION_REQUESTED';
  reason: string;
}

export interface ApprovalRecord {
  id: string;
  decidedBy: string;
  decidedAt: string;
  decision: 'APPROVED' | 'REJECTED';
  reason: string;
}

export type WorkOrderStatus = 'ISSUED' | 'IN_PROGRESS' | 'COMPLETED';

export interface WorkSubmission {
  photoUrl: string;
  note: string;
  by: string;
  at: string;
  /** Set when M.O decides on this submission. */
  decision?: 'VERIFIED' | 'REWORK_REQUESTED';
  decidedBy?: string;
  decidedAt?: string;
  reason?: string;
}
/** SPEC M2.1: what was actually done, recorded by the engineer with the repair evidence. */
export const REPAIR_METHODS = ['TAMBAL_DINGIN', 'TAMBAL_PANAS', 'PATCHING_DALAM', 'OVERLAY', 'REKONSTRUKSI'] as const;
export type RepairMethod = (typeof REPAIR_METHODS)[number];
export const COMPACTORS = ['STAMPER', 'ROLLER', 'TIDAK_ADA'] as const;
export type Compactor = (typeof COMPACTORS)[number];
export interface RepairRecord {
  method: RepairMethod;
  /** Id from config/materials.json (checked by the server). */
  materialId: string;
  thicknessCm: number;
  areaM2: number;
  compactor: Compactor;
  category: 'SEMENTARA' | 'PERMANEN';
  /** Rupiah, optional; DARI_INPUT. */
  valueIdr: number | null;
}

/** CV run on the repair photo. `ran: false` says why, so a missing check is never read as "clean". */
export interface RepairCheck {
  ran: boolean;
  at: string;
  reason: string | null;
  indexBefore: number | null;
  indexAfter: number | null;
  damageStillDetected: boolean | null;
  detections: number;
  isRoad: boolean | null;
  modelId: string | null;
}

export interface WorkOrder {
  id: string;
  issuedBy: string;
  issuedAt: string;
  status: WorkOrderStatus;
  contractorNote: string;
  contractor?: string | null;
  contractValueIdr?: number | null;
  targetDate?: string | null;
  supervisor?: string | null;
  /** Contract maintenance period (masa pemeliharaan) in months; null when not stated. */
  maintenanceMonths?: number | null;
  /** SPEC M2.1: method/material/thickness of the latest repair evidence. */
  repair?: RepairRecord | null;
  completedAt: string | null;
  /** Repair evidence from the assigned F.E (latest submission); verified by M.O via RESOLVE. */
  completionPhotoUrl?: string | null;
  completionNote?: string | null;
  completedBy?: string | null;
  /** Every evidence submission, kept when M.O asks for rework (never overwritten). */
  submissions?: WorkSubmission[];
  /** AI second opinion on the latest repair photo (server-computed; advisory only). */
  repairCheck?: RepairCheck | null;
  /** This is an internal demo work order, not an official government SPK document. */
  isOfficialDocument: false;
}

/** One state change, as recorded in the audit log. */
export interface TransitionRecord {
  id: string;
  at: string;
  action: WorkflowAction;
  from: WorkflowState | null;
  to: WorkflowState;
  actor: Actor;
  reason: string;
  /** Short text the citizen may see for this step (no names, no staff notes). */
  publicNote: string;
}

/** The canonical report case. `report` keeps the citizen-facing content as before. */
export interface ReportCase {
  id: string;
  /** Optimistic-concurrency token: every accepted transition increments it. */
  version: number;
  state: WorkflowState;
  segmentId: string;
  report: DamageReport;
  createdBy: Actor;
  createdAt: string;
  updatedAt: string;
  /** SHA-256 of the anonymous claim token, when an anonymous visitor created the report. */
  claimTokenHash: string | null;
  dataStatus: DataStatus;
  screening: ScreeningResult | null;
  assignment: InspectionAssignment | null;
  inspection: InspectionRecord | null;
  recommendation: MaintenanceRecommendation | null;
  approvals: ApprovalRecord[];
  /** Optional so cases stored before HD-WS-1 still load; read with `?? []`. */
  inspectionReviews?: InspectionReviewRecord[];
  workOrder: WorkOrder | null;
  history: TransitionRecord[];
  /** Agency responsible for the road (resolved on submit; Koordinator can transfer). */
  authority?: CaseAuthority | null;
  authorityHistory?: AuthorityChange[];
  /** Temporary warning sign placed at the damage (UU 22/2009 Ps. 24 ayat 2). */
  hazard?: HazardSign | null;
}

export interface CaseAuthority {
  agencyId: string;
  level: 'NASIONAL' | 'TOL' | 'PROVINSI' | 'KOTA' | 'KABUPATEN';
  name: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  basis: string;
  area?: { province: string | null; city: string | null; road: string | null; highway: string | null; ref: string | null };
}

export interface AuthorityChange {
  at: string;
  by: string;
  from: string | null;
  to: string;
  reason: string;
}

export interface HazardSign {
  at: string;
  by: string;
  photoUrl: string;
  note: string;
}

export const WORKFLOW_ACTIONS = [
  'SUBMIT',
  'BEGIN_SCREENING',
  'SCREENING_PASSED',
  'SCREENING_NEEDS_REVIEW',
  'REVIEW_ACCEPT',
  'CLOSE_INVALID',
  'REQUEST_INSPECTION',
  'SUBMIT_INSPECTION',
  'VERIFY_INSPECTION',
  'REQUEST_REINSPECTION',
  'RECOMMEND_ACTION',
  'CLOSE_NO_ACTION',
  'APPROVE_ACTION',
  'REJECT_ACTION',
  'START_WORK',
  'COMPLETE_WORK_ORDER',
  'REQUEST_REWORK',
  'RESOLVE',
  'CLOSE_RESOLVED',
  'TRANSFER_AUTHORITY',
  'MARK_HAZARD',
  /** Bundled demo report imported into the store with its existing state; never user-triggered. */
  'SEED_IMPORT'
] as const;
export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number];
