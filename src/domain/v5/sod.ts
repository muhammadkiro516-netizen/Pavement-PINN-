/**
 * Separation-of-duties rules (03_ROLES_RBAC.md §4). Pure: called inside `applyCommand` before a
 * transition, on the server. Identity is the person, so one person with two accounts is caught.
 * Messages are plain English and shown as-is in the UI.
 */
import type { V5Actor, V5Case, V5Role } from './model';

export type SodResult = { ok: true; overlapBasis: string | null } | { ok: false; rule: string; message: string };

const deny = (rule: string, message: string): SodResult => ({ ok: false, rule, message });

/** Roles that hold no operational power on any case (SOD-8). */
const NON_OPERATING: readonly (V5Role | 'SYSTEM')[] = ['AUDITOR', 'ADMIN'];

/** Staff roles checked for a link to the package provider (SOD-3). The crew is the provider's side. */
const PROVIDER_CHECKED: readonly (V5Role | 'SYSTEM')[] = ['FIELD_INSPECTOR', 'COORDINATOR', 'APPROVER', 'SUPERVISOR', 'AUDITOR', 'AGENCY_HEAD'];

/** Follow-up milestones the crew and the supervisor may not record themselves (SOD-4). */
const INDEPENDENT_MILESTONES = ['M3', 'HEAVY_RAIN', 'EVERY_6M'];

/** Consecutive delay reasons a coordinator may set before the Agency Head must take over (SOD-13). */
export const MAX_COORDINATOR_PENDING = 3;

const SUB_TYPE_OVERLAP_BASIS: Readonly<Record<string, string>> = {
  KPA_AS_PPK: 'Perpres 12/2021 Pasal 10(5)',
  PPTK_AS_PPK: 'Perpres 12/2021 Pasal 11(3)-(4)'
};

function overlapBasisFor(actor: V5Actor): string | null {
  if (actor.overlapBasis) return actor.overlapBasis;
  if (actor.subType && SUB_TYPE_OVERLAP_BASIS[actor.subType]) return SUB_TYPE_OVERLAP_BASIS[actor.subType];
  if ((actor.heldRoles?.length ?? 0) > 1) return `Holds ${actor.heldRoles!.join(' + ')} in this authority`;
  return null;
}

export function checkSod(action: string, payload: Record<string, any>, c: V5Case, actor: V5Actor): SodResult {
  const person = actor.personId;
  const wo = c.workOrder;

  // SOD-8: auditors and admins never operate. An ADMIN may only confirm a cross-level transfer.
  if (NON_OPERATING.includes(actor.role) && !(actor.role === 'ADMIN' && action === 'CONFIRM_TRANSFER')) {
    return deny('SOD-8', 'Auditors and admins cannot change a case.');
  }

  // SOD-9: a toll regulator can flag, never operate.
  if (actor.subType === 'TOLL_REGULATOR') return deny('SOD-9', 'A toll regulator can only add flags.');

  // SOD-3: no official linked to the provider of this package.
  const providerOrg = payload.providerOrgId ?? wo?.providerOrgId ?? null;
  if (providerOrg && PROVIDER_CHECKED.includes(actor.role)) {
    if (actor.conflictOrgs?.includes(providerOrg) || actor.orgId === providerOrg) {
      return deny('SOD-3', 'You are linked to the provider of this package, so you cannot act on it.');
    }
  }

  switch (action) {
    case 'ACCEPT':
      // SOD-11: a staff member cannot accept a report they created.
      if (c.createdBy.kind === 'STAFF' && c.createdBy.personId && c.createdBy.personId === person) {
        return deny('SOD-11', 'You created this report, so someone else must accept it.');
      }
      break;
    case 'CONFIRM_TRANSFER':
      // SOD-7: a cross-level transfer needs a second person.
      if (c.transferPending && c.transferPending.requestedByPersonId === person) {
        return deny('SOD-7', 'You asked for this transfer, so someone at the target agency must confirm it.');
      }
      break;
    case 'APPROVE_PLAN':
      // SOD-2: the person who recommended a plan cannot approve it.
      if (person && person === c.plan?.proposerPersonId) return deny('SOD-2', 'You proposed this plan, so you cannot approve it.');
      if (person && person === c.inspection?.inspectorPersonId) return deny('SOD-2', 'You inspected this case, so you cannot approve its plan.');
      break;
    case 'ISSUE_WORK_ORDER': {
      // SOD-1: the crew and the supervisor must be different people (and firms, on contracts).
      if (payload.crewPersonId === payload.supervisorPersonId) return deny('SOD-1', 'The crew and the supervisor must be different people.');
      if (payload.type === 'CONTRACT' && payload.crewOrgId && payload.crewOrgId === payload.supervisorOrgId) {
        return deny('SOD-1', 'On a contract, the supervisor cannot come from the crew\'s organisation.');
      }
      const decided = [c.plan?.proposerPersonId, c.plan?.approverPersonId];
      if (decided.includes(payload.crewPersonId) || decided.includes(payload.supervisorPersonId)) {
        return deny('SOD-1', 'The crew and the supervisor cannot be the person who proposed or approved the plan.');
      }
      break;
    }
    case 'VERIFY_WORK':
    case 'REJECT_WORK':
      if (person && person === wo?.crewPersonId) return deny('SOD-1', 'You did this repair, so you cannot check it.');
      if (wo?.type === 'CONTRACT' && actor.orgId && actor.orgId === wo.crewOrgId) {
        return deny('SOD-1', 'You work for the crew\'s organisation, so you cannot check this repair.');
      }
      if (person && person === c.plan?.proposerPersonId) return deny('SOD-1', 'You proposed this plan, so you cannot check its repair.');
      break;
    case 'ACCEPT_WORK':
      // SOD-5: acceptance needs an independent supervisor's verification first.
      if (wo?.verifiedByRole !== 'SUPERVISOR') return deny('SOD-5', 'A supervisor must check the repair before it can be accepted.');
      if (person && (person === c.plan?.proposerPersonId || person === c.inspection?.inspectorPersonId)) {
        return deny('SOD-2', 'You recommended this repair, so you cannot accept it.');
      }
      if (person && (person === wo?.crewPersonId || person === wo?.supervisorPersonId)) {
        return deny('SOD-1', 'You worked on or checked this repair, so you cannot accept it.');
      }
      break;
    case 'RECORD_FOLLOW_UP':
      // SOD-4: the post-repair check must be independent of the crew and the supervisor.
      if (actor.kind === 'PERSON' && INDEPENDENT_MILESTONES.includes(payload.milestone) && person && (person === wo?.crewPersonId || person === wo?.supervisorPersonId)) {
        return deny('SOD-4', 'You worked on or checked this repair, so someone else must record this follow-up.');
      }
      break;
    case 'SET_PENDING':
      // SOD-13: after three consecutive delay reasons, the Agency Head decides.
      if ((c.pending?.consecutive ?? 0) >= MAX_COORDINATOR_PENDING && actor.role !== 'AGENCY_HEAD') {
        return deny('SOD-13', 'Agency Head must approve this extension.');
      }
      break;
  }

  return { ok: true, overlapBasis: overlapBasisFor(actor) };
}

export function hasDecree(ref: unknown): boolean {
  if (!ref || typeof ref !== 'object') return false;
  const d = ref as Record<string, unknown>;
  if (typeof d.decreeId === 'string' && d.decreeId.trim() !== '') return true;
  return typeof d.number === 'string' && d.number.trim() !== '' && typeof d.date === 'string' && d.date.trim() !== '';
}

/**
 * SOD-12: nobody grants themselves a role, and an APPROVER assignment needs an appointment
 * reference. SOD-8: one person cannot be an auditor and an operator in the same authority.
 */
export function checkRoleAssignment(grant: { createdByAccountId: string; accountId: string; role: V5Role; appointmentRef?: string | null; existingRoles?: readonly V5Role[] }): SodResult {
  if (grant.createdByAccountId === grant.accountId) return deny('SOD-12', 'You cannot give yourself a role.');
  if (grant.role === 'APPROVER' && !grant.appointmentRef?.trim()) return deny('SOD-12', 'An Approving Officer needs an appointment reference.');
  const holdsAuditor = grant.existingRoles?.includes('AUDITOR');
  const holdsOperational = grant.existingRoles?.some((r) => r !== 'AUDITOR' && r !== 'ADMIN' && r !== 'CITIZEN');
  if ((grant.role === 'AUDITOR' && holdsOperational) || (holdsAuditor && grant.role !== 'AUDITOR')) {
    return deny('SOD-8', 'One person cannot audit and operate in the same authority.');
  }
  return { ok: true, overlapBasis: null };
}

/**
 * SOD-10: two independent "damaged again" answers, or one with a photo from a phone-verified
 * device, create an inspector task. Citizen answers alone never mark a repair as failed.
 */
export function citizenDisputeTriggersInspection(answers: readonly { result: string; deviceRef: string; withPhoto: boolean; trustTier?: number }[]): boolean {
  const damaged = answers.filter((a) => a.result === 'DAMAGED');
  if (new Set(damaged.map((a) => a.deviceRef)).size >= 2) return true;
  return damaged.some((a) => a.withPhoto && (a.trustTier ?? 0) >= 1);
}
