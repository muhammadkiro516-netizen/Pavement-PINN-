/**
 * Read models of a report case for different audiences.
 *
 * - Staff (official roles) see the full case.
 * - The public (citizens, anonymous visitors) see the citizen report, the current state
 *   and a timeline of public notes. They never see actor identities, staff reasons,
 *   inspection notes, recommendation rationale, approvals or work-order notes.
 *
 * The legacy `DamageReport.status` used by the existing screens is derived from the
 * workflow state so those screens keep working on the canonical record.
 */
import type { DamageReport, ReportStatus } from '../../types';
import type { ReportCase, WorkflowState } from './model';

export function legacyStatusFor(c: Pick<ReportCase, 'state' | 'history'>): ReportStatus {
  switch (c.state) {
    case 'INSPECTED':
    case 'INSPECTION_VERIFIED':
    case 'ACTION_RECOMMENDED':
      return 'VERIFIED_BY_ENGINEER';
    case 'ACTION_APPROVED':
    case 'IN_PROGRESS':
      return 'SCHEDULED_FOR_REPAIR';
    case 'RESOLVED':
      return 'REPAIRED';
    case 'CLOSED':
      return c.history.some((h) => h.action === 'RESOLVE') ? 'REPAIRED' : 'CLOSED';
    default:
      return 'PENDING';
  }
}

/** Short Indonesian label for each workflow state (UI). */
export const WORKFLOW_STATE_LABEL: Record<WorkflowState, string> = {
  SUBMITTED: 'Diterima',
  AI_SCREENING: 'Penyaringan otomatis',
  NEEDS_REVIEW: 'Menunggu peninjauan',
  VERIFIED: 'Siap ditindaklanjuti',
  FIELD_INSPECTION_REQUESTED: 'Inspeksi dijadwalkan',
  INSPECTED: 'Inspeksi menunggu verifikasi M.O',
  INSPECTION_VERIFIED: 'Inspeksi terverifikasi',
  ACTION_RECOMMENDED: 'Menunggu persetujuan penanganan',
  ACTION_APPROVED: 'Penanganan disetujui',
  IN_PROGRESS: 'Sedang dikerjakan',
  RESOLVED: 'Perbaikan terverifikasi',
  CLOSED: 'Ditutup'
};

export interface PublicTimelineEntry {
  at: string;
  state: WorkflowState;
  note: string;
}

export interface PublicReportView {
  id: string;
  version: number;
  state: WorkflowState;
  segmentId: string;
  report: DamageReport;
  timeline: PublicTimelineEntry[];
  /** Which agency is responsible, and how sure the routing is (shown, never hidden). */
  authority: { name: string; level: string; confidence: string } | null;
  /** A temporary warning sign is on site (UU 22/2009 Ps. 24 ayat 2). */
  hazard: { at: string; note: string } | null;
  /** SPEC M3.3: public reason for waiting (no staff identity). */
  pending: { code: string; until: string; note: string } | null;
  createdAt: string;
  updatedAt: string;
}

/** The citizen-facing report: workflow-derived status, no staff-only repair notes. */
export function reportForDisplay(c: ReportCase): DamageReport {
  const status = legacyStatusFor(c);
  const { engineerNote: _hidden, ...publicRepair } = c.report.repairDetails ?? ({} as NonNullable<DamageReport['repairDetails']>);
  void _hidden;
  return {
    ...c.report,
    status,
    workflowState: c.state,
    caseVersion: c.version,
    repairDetails: repairFor(c, c.report.repairDetails ? (publicRepair as DamageReport['repairDetails']) : undefined)
  };
}

/**
 * The "after" photo of a real case is the repair evidence the assigned F.E sent — nothing
 * else (no stock or sample image). Sample cases keep their labelled illustrative details.
 */
function repairFor(c: ReportCase, sample: DamageReport['repairDetails']): DamageReport['repairDetails'] {
  // Sample cases: an illustrative "after" only for samples that are repaired; never a verification claim.
  if (c.dataStatus === 'SYNTHETIC') {
    const repaired = c.state === 'RESOLVED' || c.state === 'CLOSED';
    return repaired && sample ? { ...sample, verified: undefined, illustrative: true } : undefined;
  }
  const wo = c.workOrder;
  if (!wo?.completionPhotoUrl) return undefined;
  return {
    afterPhotoUrl: wo.completionPhotoUrl,
    repairDate: wo.completedAt ?? undefined,
    repairMethod: c.recommendation?.treatment,
    verified: c.state === 'RESOLVED' || c.state === 'CLOSED'
  };
}

export function toPublicView(c: ReportCase): PublicReportView {
  return {
    id: c.id,
    version: c.version,
    state: c.state,
    segmentId: c.segmentId,
    // Citizens see the repair photo only after M.O verified it.
    report: ((r) => (r.repairDetails && r.repairDetails.verified === false ? { ...r, repairDetails: undefined } : r))(reportForDisplay(c)),
    timeline: c.history.map((h) => ({ at: h.at, state: h.to, note: h.publicNote })),
    authority: c.authority ? { name: c.authority.name, level: c.authority.level, confidence: c.authority.confidence } : null,
    hazard: c.hazard ? { at: c.hazard.at, note: c.hazard.note } : null,
    pending: c.pending ? { code: c.pending.code, until: c.pending.until, note: c.pending.note } : null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt
  };
}
