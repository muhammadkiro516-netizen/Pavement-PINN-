/**
 * Demo staff for the role switcher (02 §9 D-7): one account per role, plus the accounts that make
 * the SoD rules visible. "Demo Inspector (acting as Approver)" is the same person as the inspector,
 * so approving their own plan is refused by the server (SOD-2). No real names, ever.
 */
import type { V5Actor, V5Role } from '../../src/domain/v5/model';

export interface DemoAccount {
  accountId: string;
  personId: string;
  role: V5Role;
  displayName: string;
  orgId: string;
  subType?: string;
  note?: string;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { accountId: 'ACC-COORD', personId: 'P-COORD', role: 'COORDINATOR', displayName: 'Demo Maintenance Coordinator', orgId: 'ORG-AGENCY' },
  { accountId: 'ACC-COORD-2', personId: 'P-COORD-2', role: 'COORDINATOR', displayName: 'Demo Coordinator (second agency)', orgId: 'ORG-AGENCY-2', note: 'Confirms a transfer between government levels.' },
  { accountId: 'ACC-INSPECT', personId: 'P-INSPECT', role: 'FIELD_INSPECTOR', displayName: 'Demo Field Inspector', orgId: 'ORG-AGENCY' },
  { accountId: 'ACC-APPROVE', personId: 'P-APPROVE', role: 'APPROVER', displayName: 'Demo Approving Officer', orgId: 'ORG-AGENCY', subType: 'PPK' },
  { accountId: 'ACC-INSPECT-AS-APPROVER', personId: 'P-INSPECT', role: 'APPROVER', displayName: 'Demo Inspector (acting as Approver)', orgId: 'ORG-AGENCY', subType: 'PPK', note: 'Same person as the Field Inspector. The server blocks this person from approving their own plan.' },
  { accountId: 'ACC-CREW', personId: 'P-CREW', role: 'REPAIR_CREW', displayName: 'Demo Repair Crew', orgId: 'ORG-CREW', subType: 'SWAKELOLA_TEAM' },
  { accountId: 'ACC-SUPERVISE', personId: 'P-SUPERVISE', role: 'SUPERVISOR', displayName: 'Demo Works Supervisor', orgId: 'ORG-SUPERVISION', subType: 'TIM_PENGAWAS_SWAKELOLA' },
  { accountId: 'ACC-AUDIT', personId: 'P-AUDIT', role: 'AUDITOR', displayName: 'Demo Auditor', orgId: 'ORG-AUDIT', subType: 'INDEPENDENT' },
  { accountId: 'ACC-HEAD', personId: 'P-HEAD', role: 'AGENCY_HEAD', displayName: 'Demo Agency Head', orgId: 'ORG-AGENCY' },
  { accountId: 'ACC-ADMIN', personId: 'P-ADMIN', role: 'ADMIN', displayName: 'Demo Region Admin', orgId: 'ORG-OPERATOR' }
];

export const findDemoAccount = (accountId: string) => DEMO_ACCOUNTS.find((a) => a.accountId === accountId) ?? null;

export function actorFor(account: DemoAccount): V5Actor {
  return {
    kind: 'PERSON',
    accountId: account.accountId,
    personId: account.personId,
    role: account.role,
    subType: account.subType ?? null,
    orgId: account.orgId,
    // Demo accounts cover the seeded regions, so one Coordinator can show both Jakarta and Karawang.
    scope: '*'
  };
}

export function deviceActor(deviceId: string): V5Actor {
  return { kind: 'DEVICE', accountId: deviceId, personId: null, role: 'CITIZEN', scope: [] };
}
