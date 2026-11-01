/**
 * v6 roles (docs/v6/V6_UPDATE_TWO_PORTALS.md §2.3). The v5 state machine and its separation-of-duties
 * rules stay as they are; each v6 role holds the v5 duties it merges, and the duty is picked per action.
 */
import type { V5Role, V5State } from '../v5/model';

export const V6_ROLES = ['OM', 'FE', 'AUDITOR', 'CONTRACTOR'] as const;
export type V6Role = (typeof V6_ROLES)[number];

export const V6_DUTIES: Readonly<Record<V6Role, readonly V5Role[]>> = {
  OM: ['COORDINATOR', 'APPROVER', 'AGENCY_HEAD', 'ADMIN'],
  FE: ['FIELD_INSPECTOR', 'SUPERVISOR'],
  AUDITOR: ['AUDITOR'],
  CONTRACTOR: ['REPAIR_CREW']
};

export const V6_ROLE_NAMES: Readonly<Record<V6Role, { id: string; short: string; color: string }>> = {
  OM: { id: 'Operations Manager', short: 'OM', color: '#FFC72C' },
  FE: { id: 'Field Engineer', short: 'FE', color: '#22D3EE' },
  AUDITOR: { id: 'Auditor', short: 'Auditor', color: '#A78BFA' },
  CONTRACTOR: { id: 'Kontraktor', short: 'Kontraktor', color: '#FF6B2C' }
};

/** These ask for the PIN again (§2.2). Issuing a report, changing prices and managing codes ask in their own routes. */
export const PIN_ACTIONS: readonly string[] = ['APPROVE_PLAN', 'CLOSE_INVALID', 'CLOSE_NO_ACTION', 'CLOSE_MONITORING', 'SUPERSEDE'];

/** Which duty's panel a case shows now, so one person never has to switch hats by hand. */
export function panelDuty(role: V6Role, state: V5State | null): V5Role {
  if (role === 'OM') return state === 'PLAN_PROPOSED' || state === 'WORK_VERIFIED' ? 'APPROVER' : 'COORDINATOR';
  if (role === 'FE') return state === 'WORK_SUBMITTED' ? 'SUPERVISOR' : 'FIELD_INSPECTOR';
  return V6_DUTIES[role][0];
}

/** A PIN anyone could guess is refused: one digit repeated, or a straight run. */
export function isWeakPin(pin: string): boolean {
  if (!/^\d{6}$/.test(pin)) return true;
  if (/^(\d)\1{5}$/.test(pin)) return true;
  return '0123456789'.includes(pin) || '9876543210'.includes(pin);
}
