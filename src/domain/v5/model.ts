/**
 * PAVEMENT-PINN v5 case model (docs/v5/02_SPEC_v5.md §3, §7). Lives beside the v4 workflow
 * (src/domain/workflow) so the v4 pages and their tests keep working during the migration.
 */

export const V5_ROLES = [
  'CITIZEN',
  'FIELD_INSPECTOR',
  'COORDINATOR',
  'APPROVER',
  'REPAIR_CREW',
  'SUPERVISOR',
  'AUDITOR',
  'AGENCY_HEAD',
  'ADMIN'
] as const;
export type V5Role = (typeof V5_ROLES)[number];

export const V5_ROLE_NAMES: Readonly<Record<V5Role, { en: string; id: string }>> = {
  CITIZEN: { en: 'Citizen', id: 'Warga' },
  FIELD_INSPECTOR: { en: 'Field Inspector', id: 'Petugas Inspeksi' },
  COORDINATOR: { en: 'Maintenance Coordinator', id: 'Koordinator Pemeliharaan' },
  APPROVER: { en: 'Approving Officer', id: 'Pejabat Penyetuju (PPK)' },
  REPAIR_CREW: { en: 'Repair Crew', id: 'Pelaksana Perbaikan' },
  SUPERVISOR: { en: 'Works Supervisor', id: 'Pengawas Pekerjaan' },
  AUDITOR: { en: 'Auditor', id: 'Auditor' },
  AGENCY_HEAD: { en: 'Agency Head', id: 'Pimpinan Instansi' },
  ADMIN: { en: 'Region Admin', id: 'Admin Wilayah' }
};

export const LEGACY_ROLE_ALIASES: Readonly<Record<string, V5Role | null>> = {
  PUBLIC_REPORTER: 'CITIZEN',
  PUBLIC_VIEWER: null,
  FIELD_ENGINEER: 'FIELD_INSPECTOR',
  OPERATIONS_MANAGER: 'COORDINATOR',
  POLICY_MAKER: 'AGENCY_HEAD'
};

export const V5_STATES = [
  'SUBMITTED',
  'SCREENING',
  'TRIAGE',
  'ACCEPTED',
  'INSPECTION_ASSIGNED',
  'INSPECTED',
  'INSPECTION_VERIFIED',
  'PLAN_PROPOSED',
  'PLAN_APPROVED',
  'WORK_ORDERED',
  'IN_PROGRESS',
  'WORK_SUBMITTED',
  'WORK_VERIFIED',
  'REPAIRED_TEMPORARY',
  'MONITORING',
  'REOPENED',
  'REFERRED_EXTERNAL',
  'MERGED',
  'CLOSED'
] as const;
export type V5State = (typeof V5_STATES)[number];

/** Public labels (02 §3.2). English labels are the plain UI copy; Indonesian is the legal record. */
export const V5_STATE_LABELS: Readonly<Record<V5State, { en: string; id: string; open: boolean }>> = {
  SUBMITTED: { en: 'Report received', id: 'Laporan diterima', open: true },
  SCREENING: { en: 'Automatic screening', id: 'Disaring otomatis', open: true },
  TRIAGE: { en: 'Waiting for a coordinator', id: 'Menunggu pemeriksaan petugas', open: true },
  ACCEPTED: { en: 'Accepted by the agency', id: 'Diterima instansi', open: true },
  INSPECTION_ASSIGNED: { en: 'Inspection scheduled', id: 'Inspeksi dijadwalkan', open: true },
  INSPECTED: { en: 'Inspection done', id: 'Inspeksi selesai', open: true },
  INSPECTION_VERIFIED: { en: 'Inspection checked', id: 'Hasil inspeksi diperiksa', open: true },
  PLAN_PROPOSED: { en: 'Repair plan proposed', id: 'Usulan penanganan disusun', open: true },
  PLAN_APPROVED: { en: 'Repair plan approved', id: 'Penanganan disetujui', open: true },
  WORK_ORDERED: { en: 'Repair scheduled', id: 'Pekerjaan dijadwalkan', open: true },
  IN_PROGRESS: { en: 'Being repaired', id: 'Sedang diperbaiki', open: true },
  WORK_SUBMITTED: { en: 'Waiting for repair check', id: 'Menunggu pemeriksaan hasil', open: true },
  WORK_VERIFIED: { en: 'Repair checked by supervisor', id: 'Hasil diperiksa pengawas', open: true },
  REPAIRED_TEMPORARY: { en: 'Temporary patch', id: 'Ditambal sementara', open: true },
  MONITORING: { en: 'Repaired — under watch', id: 'Diperbaiki — dipantau', open: false },
  REOPENED: { en: 'Broke again', id: 'Rusak lagi', open: true },
  REFERRED_EXTERNAL: { en: 'Sent to official channel', id: 'Diteruskan ke kanal resmi', open: true },
  MERGED: { en: 'Merged with another report', id: 'Digabung ke laporan lain', open: false },
  CLOSED: { en: 'Closed', id: 'Selesai', open: false }
};

export const CLOSURE_REASONS = ['INVALID', 'NO_ACTION_NEEDED', 'OUT_OF_SCOPE', 'MONITORING_COMPLETE', 'SUPERSEDED_BY_WORKS', 'LEGACY_RESOLVED'] as const;
export type ClosureReason = (typeof CLOSURE_REASONS)[number];

/** v4 state → v5 state (02 §4.1). `VERIFIED` and `RESOLVED` depend on data handled by the migration. */
export const LEGACY_STATE_MAP: Readonly<Record<string, V5State>> = {
  SUBMITTED: 'SUBMITTED',
  AI_SCREENING: 'SCREENING',
  NEEDS_REVIEW: 'TRIAGE',
  VERIFIED: 'ACCEPTED',
  FIELD_INSPECTION_REQUESTED: 'INSPECTION_ASSIGNED',
  INSPECTED: 'INSPECTED',
  INSPECTION_VERIFIED: 'INSPECTION_VERIFIED',
  ACTION_RECOMMENDED: 'PLAN_PROPOSED',
  ACTION_APPROVED: 'PLAN_APPROVED',
  IN_PROGRESS: 'IN_PROGRESS',
  RESOLVED: 'MONITORING',
  CLOSED: 'CLOSED'
};

/** The person behind an account. SoD compares people, not accounts (03 §4). */
export interface V5Actor {
  kind: 'PERSON' | 'DEVICE' | 'SYSTEM';
  accountId: string;
  personId: string | null;
  role: V5Role | 'SYSTEM';
  subType?: string | null;
  orgId?: string | null;
  /** Authority ids this actor may act on. '*' only for demo accounts and SYSTEM. */
  scope: '*' | readonly string[];
  /** Every role this person holds in the authority; two or more is an overlap to log (SOD-6). */
  heldRoles?: readonly V5Role[];
  /** Provider organisations this person declared a link to (SOD-3). */
  conflictOrgs?: readonly string[];
  /** Legal basis for a permitted overlap, e.g. "Perpres 12/2021 Pasal 10(5)". */
  overlapBasis?: string | null;
}

export type CaptureTrust = 'LIVE_NONCE' | 'POOL_NONCE' | 'OFFLINE_UNVERIFIED_TIME';

export const EVIDENCE_KINDS = ['OVERVIEW', 'CLOSEUP', 'TRACE_POINT', 'MARKER_NADIR', 'DEPTH_RULER', 'CROSS_WIDTH', 'WORK_STAGE', 'FOLLOW_UP', 'HAZARD_SIGN'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface EvidenceRef {
  id: string;
  sha256: string;
  kind: EvidenceKind;
  stage?: string | null;
  captureTrust: CaptureTrust;
  /** Typed with a work stage: temperature, thickness, ticket, passes. */
  values?: Record<string, unknown> | null;
}

/** Neutral flag on a case. Never on a person (07 §13). `text` comes from the wording library. */
export interface V5Flag {
  id: string;
  code: string;
  wordingId: string;
  text: string;
  note: string;
  createdByRole: string;
  createdAt: string;
  state: 'OPEN' | 'RESPONDED' | 'WITHDRAWN';
}

export interface V5PinnRun {
  id: string;
  status: 'COMPUTED' | 'PINN_UNAVAILABLE';
  reason?: string;
  esalYear?: number;
  roadClass?: string;
  lifeMonths?: { p10: number; p50: number; p90: number };
  verdict?: string;
  title?: string;
  confidence?: string;
  samples?: number;
  solver?: string;
  device?: string;
  hostLabel?: string;
  repairOptions?: string[];
  ranAt?: string;
}

export type RoutingConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface RoutingResult {
  segmentId: string | null;
  segmentName: string | null;
  roadStatus: string | null;
  authorityId: string;
  authorityName: string;
  authorityLevel: string;
  officeId: string | null;
  officeName: string | null;
  confidence: RoutingConfidence;
  basis: string;
  /** Plain words shown beside LOW confidence. */
  note?: string | null;
}

export interface V5Inspection {
  inspectorPersonId: string;
  inspectorAccountId: string;
  dueAt: string;
  instructions: string;
  submittedAt?: string;
  verdict?: 'CONFIRMED' | 'NOT_FOUND' | 'DIFFERENT_CLASS';
  classConfirmed?: string;
  /** Integers in the smallest unit (07 §2.1). */
  lengthMm?: number;
  widthMm?: number;
  areaCm2?: number;
  areaStatus?: 'MEASURED' | 'AI_ESTIMATE';
  depthMmTyped?: number | null;
  rulerCheck?: 'MATCH' | 'MISMATCH' | 'AI_UNREADABLE' | null;
  rulerMismatchAcknowledged?: boolean;
  notes?: string;
}

export interface V5Plan {
  proposerPersonId: string;
  repairType: string;
  category: 'TEMPORARY' | 'PERMANENT';
  areaCm2: number;
  thicknessMm: number;
  volumeCm3: number;
  costEstimateId: string | null;
  pinnRunId: string | null;
  urgency: 'ROUTINE' | 'PRIORITY' | 'URGENT';
  rationale: string;
  approverPersonId?: string;
  budgetSource?: string;
}

export interface V5WorkOrder {
  type: 'SWAKELOLA' | 'CONTRACT';
  crewPersonId: string;
  crewAccountId: string;
  crewOrgId: string | null;
  supervisorPersonId: string;
  supervisorAccountId: string;
  supervisorOrgId: string | null;
  packageId: string | null;
  providerOrgId: string | null;
  targetDate: string;
  category: 'TEMPORARY' | 'PERMANENT';
  submittedAt?: string;
  verifiedByRole?: string;
  verifiedAt?: string;
  acceptedAt?: string;
  phoDate?: string | null;
  maintenanceMonths?: number | null;
}

export const FOLLOW_UP_MILESTONES = ['M1', 'M3', 'M6', 'HEAVY_RAIN', 'PRE_FHO', 'EVERY_6M'] as const;
export type FollowUpMilestone = (typeof FOLLOW_UP_MILESTONES)[number];

export interface V5FollowUp {
  id: string;
  milestone: FollowUpMilestone;
  /** Null until the trigger happens (first heavy rain). */
  dueAt: string | null;
  windowDays: number;
  trigger: string;
  assigneeRole: 'FIELD_INSPECTOR' | 'CITIZEN' | 'INSPECTOR_AND_SUPERVISOR';
  result: 'OK' | 'DEFECT' | null;
  source: 'INSPECTOR' | 'SUPERVISOR' | 'CITIZEN' | null;
  recordedAt: string | null;
}

export interface V5Case {
  id: string;
  publicCode: string;
  version: number;
  state: V5State | null;
  closureReason: ClosureReason | null;
  chainId: 'prod';
  createdAt: string;
  /** Oldest report date; merges and transfers never reset it (02 §3.5). */
  ladderStartAt: string;
  /** Acknowledgement time is immutable once set (02 §3.2). */
  acceptedAt: string | null;
  createdBy: { kind: 'DEVICE' | 'STAFF' | 'SYSTEM'; ref: string; personId: string | null };
  mode: 'SINGLE' | 'TRACE';
  location: { latE6: number; lonE6: number; accuracyM: number };
  captureTrust: CaptureTrust;
  damageClass: string | null;
  sizeBand: string | null;
  trace: { lengthM: number; quality: 'HIGH' | 'MEDIUM' | 'LOW'; points: number } | null;
  evidence: EvidenceRef[];
  screening: { status: 'REAL' | 'MODEL_UNAVAILABLE' | 'DEMO'; modelId: string | null; label: string | null; score: number | null } | null;
  routing: RoutingResult | null;
  authorityId: string | null;
  witnesses: number;
  inspection: V5Inspection | null;
  plan: V5Plan | null;
  workOrder: V5WorkOrder | null;
  followUps: V5FollowUp[];
  citizenConfirmations: { milestone: string; result: 'OK' | 'DAMAGED'; deviceRef: string; at: string; withPhoto: boolean }[];
  // Overlays, not states (02 §3.1).
  pending: { code: string; until: string; note: string; consecutive: number } | null;
  hazard: boolean;
  transferPending: { toAuthorityId: string; toAuthorityName: string; toLevel: string; decreeRef: string; requestedByPersonId: string } | null;
  underTechnicalReview: boolean;
  mergedIntoCaseId: string | null;
  warrantyFlag: boolean;
  note: string | null;
  flags: V5Flag[];
  pinnRun: V5PinnRun | null;
  /** Latest fair-cost output (06 §9). Every run is also an event; older runs stay in the log. */
  costRun: Record<string, any> | null;
  /** Declared by the crew: never trusted, compared with measurements. */
  declared: { areaCm2: number | null; thicknessMm: number | null; tonnageKg: number | null; reportedSpendIdr: number | null } | null;
}

export const OPEN_STATES: readonly V5State[] = V5_STATES.filter((s) => V5_STATE_LABELS[s].open);

/** Fresh case before SUBMIT. */
export function blankCase(fields: Pick<V5Case, 'id' | 'publicCode' | 'createdAt' | 'createdBy' | 'mode' | 'location' | 'captureTrust'>): V5Case {
  return {
    ...fields,
    version: 0,
    state: null,
    closureReason: null,
    chainId: 'prod',
    ladderStartAt: fields.createdAt,
    acceptedAt: null,
    damageClass: null,
    sizeBand: null,
    trace: null,
    evidence: [],
    screening: null,
    routing: null,
    authorityId: null,
    witnesses: 0,
    inspection: null,
    plan: null,
    workOrder: null,
    followUps: [],
    citizenConfirmations: [],
    pending: null,
    hazard: false,
    transferPending: null,
    underTechnicalReview: false,
    mergedIntoCaseId: null,
    warrantyFlag: false,
    note: null,
    flags: [],
    pinnRun: null,
    costRun: null,
    declared: null
  };
}
