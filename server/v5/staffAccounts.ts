/**
 * Staff accounts for the v5 roles. Passwords are stored as scrypt hashes. Separation of duties compares
 * the person behind an account, so a person who holds two roles still counts as one person (03 §4).
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { V5Actor, V5Role } from '../../src/domain/v5/model';

export interface StaffAccount {
  accountId: string;
  personId: string;
  role: V5Role;
  email: string;
  displayName: string;
  orgId: string;
  subType?: string;
  passwordHash: string;
}

export type PublicStaff = Pick<StaffAccount, 'accountId' | 'role' | 'displayName' | 'subType'>;

/** Accounts of the pilot agency. Created by scripts/v5-create-accounts.ts. */
export const PILOT_ROSTER: readonly Omit<StaffAccount, 'passwordHash'>[] = [
  { accountId: 'ACC-COORD', personId: 'P-COORD', role: 'COORDINATOR', email: 'koordinator@pavement-pinn.example', displayName: 'Koordinator', orgId: 'ORG-AGENCY' },
  { accountId: 'ACC-COORD-2', personId: 'P-COORD-2', role: 'COORDINATOR', email: 'koordinator2@pavement-pinn.example', displayName: 'Koordinator instansi tujuan', orgId: 'ORG-AGENCY-2' },
  { accountId: 'ACC-INSPECT', personId: 'P-INSPECT', role: 'FIELD_INSPECTOR', email: 'petugas@pavement-pinn.example', displayName: 'Petugas Inspeksi', orgId: 'ORG-AGENCY' },
  { accountId: 'ACC-APPROVE', personId: 'P-APPROVE', role: 'APPROVER', email: 'penyetuju@pavement-pinn.example', displayName: 'Pejabat Penyetuju', orgId: 'ORG-AGENCY', subType: 'PPK' },
  // The inspector also holds an approver post: the server still refuses their own plan (SOD-2).
  { accountId: 'ACC-INSPECT-AS-APPROVER', personId: 'P-INSPECT', role: 'APPROVER', email: 'petugas.penyetuju@pavement-pinn.example', displayName: 'Petugas rangkap penyetuju', orgId: 'ORG-AGENCY', subType: 'PPK' },
  { accountId: 'ACC-CREW', personId: 'P-CREW', role: 'REPAIR_CREW', email: 'regu@pavement-pinn.example', displayName: 'Regu Perbaikan', orgId: 'ORG-CREW', subType: 'SWAKELOLA_TEAM' },
  { accountId: 'ACC-SUPERVISE', personId: 'P-SUPERVISE', role: 'SUPERVISOR', email: 'pengawas@pavement-pinn.example', displayName: 'Pengawas', orgId: 'ORG-SUPERVISION', subType: 'TIM_PENGAWAS_SWAKELOLA' },
  { accountId: 'ACC-AUDIT', personId: 'P-AUDIT', role: 'AUDITOR', email: 'auditor@pavement-pinn.example', displayName: 'Auditor', orgId: 'ORG-AUDIT', subType: 'INDEPENDENT' },
  { accountId: 'ACC-HEAD', personId: 'P-HEAD', role: 'AGENCY_HEAD', email: 'pimpinan@pavement-pinn.example', displayName: 'Pimpinan Instansi', orgId: 'ORG-AGENCY' },
  { accountId: 'ACC-ADMIN', personId: 'P-ADMIN', role: 'ADMIN', email: 'admin@pavement-pinn.example', displayName: 'Admin Wilayah', orgId: 'ORG-OPERATOR' }
];

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 32).toString('hex')}`;
}

function passwordMatches(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  return timingSafeEqual(scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length), expected);
}

export class StaffAccounts {
  private readonly file: string;
  private accounts: StaffAccount[] = [];

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'staff-accounts.json');
    if (fs.existsSync(this.file)) this.accounts = JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }

  /** Sets the password when the account exists, so a script can be run again. */
  upsert(account: Omit<StaffAccount, 'passwordHash'>, password: string): void {
    const next = { ...account, passwordHash: hashPassword(password) };
    const at = this.accounts.findIndex((a) => a.accountId === account.accountId);
    if (at >= 0) this.accounts[at] = next;
    else this.accounts.push(next);
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.accounts));
    fs.renameSync(tmp, this.file);
  }

  verify(email: string, password: string): StaffAccount | null {
    const account = this.accounts.find((a) => a.email === email.trim().toLowerCase());
    // A hash always runs, so an unknown email costs the same time as a wrong password.
    const ok = passwordMatches(password, account?.passwordHash ?? `scrypt$00$${'00'.repeat(32)}`);
    return account && ok ? account : null;
  }

  get(accountId: string): StaffAccount | null {
    return this.accounts.find((a) => a.accountId === accountId) ?? null;
  }

  list(): PublicStaff[] {
    return this.accounts.map(({ accountId, role, displayName, subType }) => ({ accountId, role, displayName, subType }));
  }
}

export function actorFor(account: Omit<StaffAccount, 'passwordHash'>): V5Actor {
  return {
    kind: 'PERSON',
    accountId: account.accountId,
    personId: account.personId,
    role: account.role,
    subType: account.subType ?? null,
    orgId: account.orgId,
    // The pilot has one coordinating team across its two regions until agencies join one by one.
    scope: '*'
  };
}

export function deviceActor(deviceId: string): V5Actor {
  return { kind: 'DEVICE', accountId: deviceId, personId: null, role: 'CITIZEN', scope: [] };
}
