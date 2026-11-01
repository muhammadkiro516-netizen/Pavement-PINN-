/**
 * Agency workspaces and how their staff sign in (docs/v6/V6_UPDATE_TWO_PORTALS.md §2.1-2.2, §6).
 * Codes are kept only as keyed hashes and PINs as scrypt hashes, so a code can be shown once and never again.
 */
import { createHmac, randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { V5Actor } from '../../src/domain/v5/model';
import { V6_DUTIES, isWeakPin, type V6Role } from '../../src/domain/v6/roles';

export interface Agency {
  id: string;
  name: string;
  kind: 'NASIONAL' | 'PROVINSI' | 'KABUPATEN' | 'KOTA' | 'DESA' | 'TOL';
  /** Authority ids from routing whose cases belong here. */
  authorityIds: string[];
  region: string;
  /** Uploaded by the agency itself; the app never draws an emblem. */
  logoUri: string | null;
  contact: string;
  slaDays: number;
  sessionHours: number;
}

export interface Jurisdiction {
  agencyId: string;
  adminArea: string;
  roadStatus: string;
  decreeRefs: string[];
  priority: number;
}

export interface StaffMember {
  id: string;
  personId: string;
  agencyId: string;
  name: string;
  title: string;
  role: V6Role;
  pinHash: string | null;
  status: 'ACTIVE' | 'REVOKED';
  /** Raised on revoke and renew: every older session and remembered device stops working. */
  epoch: number;
  failedPins: number;
  lockedUntil: string | null;
  lastSeen: string | null;
  /** Contractors only: the one case their code opens. */
  caseId: string | null;
}

export interface AccessCode {
  id: string;
  memberId: string;
  tokenHash: string;
  type: 'STAFF' | 'CONTRACTOR_GUEST';
  /** The agency id, or the case id on a guest code. */
  scope: string;
  issuedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export type LoginResult = 'OK' | 'BAD_CODE' | 'BAD_PIN' | 'LOCKED' | 'PIN_SET' | 'LOCKED_BY_USER' | 'PIN_CHECK_OK' | 'PIN_CHECK_BAD';

export interface LoginEntry {
  at: string;
  agencyId: string | null;
  memberId: string | null;
  result: LoginResult;
  device: string;
}

interface Snapshot {
  agencies: Agency[];
  jurisdictions: Jurisdiction[];
  members: StaffMember[];
  codes: AccessCode[];
  log: LoginEntry[];
  /** Locked sessions, kept until they would have expired anyway. */
  revokedSessions: Record<string, number>;
}

export const MAX_PIN_TRIES = 5;
const LOCK_MINUTES = 15;
const GUEST_DAYS = 180;
const LOG_LIMIT = 5000;

/** No 0/O or 1/I, so a code read aloud or from a print stays right. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newAccessCode(): string {
  const pick = (n: number) => Array.from({ length: n }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  return `${pick(3)}-${pick(3)}-${pick(4)}`;
}

export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

function hashPin(pin: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(pin, salt, 32).toString('hex')}`;
}

function pinMatches(pin: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  return timingSafeEqual(scryptSync(pin, Buffer.from(saltHex, 'hex'), expected.length), expected);
}

export type PinOutcome = 'OK' | 'WRONG' | 'LOCKED' | 'NO_PIN';

export class Workspaces {
  private readonly file: string;
  private readonly pepper: Buffer;
  private data: Snapshot = { agencies: [], jurisdictions: [], members: [], codes: [], log: [], revokedSessions: {} };

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'workspaces.json');
    const keyFile = path.join(dir, 'code-pepper');
    if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, randomBytes(32).toString('hex'), { mode: 0o600 });
    this.pepper = Buffer.from(fs.readFileSync(keyFile, 'utf8'), 'hex');
    if (fs.existsSync(this.file)) this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }

  private save(): void {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  private hashCode(code: string): string {
    return createHmac('sha256', this.pepper).update(normalizeCode(code)).digest('hex');
  }

  // ---- Agencies ---------------------------------------------------------------------------------
  /** Made once by the platform team (§2.1). Running it again updates the same workspace. */
  upsertAgency(agency: Agency, jurisdictions: Omit<Jurisdiction, 'agencyId'>[] = []): Agency {
    const at = this.data.agencies.findIndex((a) => a.id === agency.id);
    if (at >= 0) this.data.agencies[at] = agency;
    else this.data.agencies.push(agency);
    this.data.jurisdictions = [...this.data.jurisdictions.filter((j) => j.agencyId !== agency.id), ...jurisdictions.map((j) => ({ ...j, agencyId: agency.id }))];
    this.save();
    return agency;
  }

  agency(id: string): Agency | null {
    return this.data.agencies.find((a) => a.id === id) ?? null;
  }

  agencies(): Agency[] {
    return this.data.agencies;
  }

  /**
   * Which workspace's inbox gets a report (§1): the road's status and area against each agency's
   * jurisdictions, most specific rule first. Null means the responsible agency is not connected.
   */
  routeAgency(decision: { status: string; area: { region: string | null; kota: string | null } }): Agency | null {
    const area = `${decision.area.kota ?? ''} ${decision.area.region ?? ''}`.toLowerCase();
    const match = this.data.jurisdictions
      .filter((j) => (j.roadStatus === '*' || j.roadStatus === decision.status) && (j.adminArea === '*' || area.includes(j.adminArea.toLowerCase())))
      .sort((a, b) => b.priority - a.priority)[0];
    return match ? this.agency(match.agencyId) : null;
  }

  jurisdictions(agencyId?: string): Jurisdiction[] {
    return agencyId ? this.data.jurisdictions.filter((j) => j.agencyId === agencyId) : this.data.jurisdictions;
  }

  setSessionHours(agencyId: string, hours: number): void {
    const a = this.agency(agencyId);
    if (!a) return;
    a.sessionHours = hours;
    this.save();
  }

  // ---- Staff and codes --------------------------------------------------------------------------
  member(id: string): StaffMember | null {
    return this.data.members.find((m) => m.id === id) ?? null;
  }

  members(agencyId: string): StaffMember[] {
    return this.data.members.filter((m) => m.agencyId === agencyId);
  }

  /** Adds a person and returns their code. This is the only time the code exists in plain form. */
  addMember(input: { agencyId: string; name: string; title: string; role: V6Role; id?: string; personId?: string; caseId?: string | null }, now: string): { member: StaffMember; code: string } {
    const id = input.id ?? `MEM-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const member: StaffMember = {
      id,
      personId: input.personId ?? `PER-${id}`,
      agencyId: input.agencyId,
      name: input.name,
      title: input.title,
      role: input.role,
      pinHash: null,
      status: 'ACTIVE',
      epoch: 0,
      failedPins: 0,
      lockedUntil: null,
      lastSeen: null,
      caseId: input.caseId ?? null
    };
    this.data.members = [...this.data.members.filter((m) => m.id !== id), member];
    const code = this.issueCode(member, now);
    return { member, code };
  }

  private issueCode(member: StaffMember, now: string): string {
    const code = newAccessCode();
    const guest = member.role === 'CONTRACTOR';
    this.data.codes = this.data.codes.map((c) => (c.memberId === member.id && !c.revokedAt ? { ...c, revokedAt: now } : c));
    this.data.codes.push({
      id: `CODE-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      memberId: member.id,
      tokenHash: this.hashCode(code),
      type: guest ? 'CONTRACTOR_GUEST' : 'STAFF',
      scope: guest ? member.caseId! : member.agencyId,
      issuedAt: now,
      expiresAt: guest ? new Date(Date.parse(now) + GUEST_DAYS * 86_400_000).toISOString() : null,
      revokedAt: null
    });
    this.save();
    return code;
  }

  /** A new code replaces the old one and signs the person out everywhere. The PIN stays theirs. */
  renewCode(memberId: string, now: string): string | null {
    const m = this.member(memberId);
    if (!m || m.status !== 'ACTIVE') return null;
    m.epoch += 1;
    m.failedPins = 0;
    m.lockedUntil = null;
    return this.issueCode(m, now);
  }

  revoke(memberId: string, now: string): boolean {
    const m = this.member(memberId);
    if (!m) return false;
    m.status = 'REVOKED';
    m.epoch += 1;
    this.data.codes = this.data.codes.map((c) => (c.memberId === memberId && !c.revokedAt ? { ...c, revokedAt: now } : c));
    this.save();
    return true;
  }

  /** A guest code ends once the repair is verified (§2.2). */
  revokeGuests(caseId: string, now: string): number {
    const guests = this.data.members.filter((m) => m.role === 'CONTRACTOR' && m.caseId === caseId && m.status === 'ACTIVE');
    for (const g of guests) this.revoke(g.id, now);
    return guests.length;
  }

  private activeCode(memberId: string, now: string): AccessCode | null {
    return this.data.codes.find((c) => c.memberId === memberId && !c.revokedAt && (!c.expiresAt || c.expiresAt > now)) ?? null;
  }

  codeStatus(memberId: string, now: string): 'ACTIVE' | 'NONE' {
    return this.activeCode(memberId, now) ? 'ACTIVE' : 'NONE';
  }

  /** The person behind a code, or null. An ended code counts as no code. */
  findByCode(code: string, now: string): StaffMember | null {
    const hash = Buffer.from(this.hashCode(code), 'hex');
    const row = this.data.codes.find((c) => !c.revokedAt && (!c.expiresAt || c.expiresAt > now) && timingSafeEqual(Buffer.from(c.tokenHash, 'hex'), hash));
    const member = row ? this.member(row.memberId) : null;
    return member?.status === 'ACTIVE' ? member : null;
  }

  // ---- PIN --------------------------------------------------------------------------------------
  setPin(memberId: string, pin: string): boolean {
    const m = this.member(memberId);
    if (!m || isWeakPin(pin)) return false;
    m.pinHash = hashPin(pin);
    this.save();
    return true;
  }

  checkPin(memberId: string, pin: string, now: string): PinOutcome {
    const m = this.member(memberId);
    if (!m || !m.pinHash) return 'NO_PIN';
    if (m.lockedUntil && m.lockedUntil > now) return 'LOCKED';
    if (pinMatches(pin, m.pinHash)) {
      m.failedPins = 0;
      m.lockedUntil = null;
      this.save();
      return 'OK';
    }
    m.failedPins += 1;
    if (m.failedPins >= MAX_PIN_TRIES) {
      m.failedPins = 0;
      m.lockedUntil = new Date(Date.parse(now) + LOCK_MINUTES * 60_000).toISOString();
    }
    this.save();
    return m.lockedUntil && m.lockedUntil > now ? 'LOCKED' : 'WRONG';
  }

  // ---- Sessions and the login log ---------------------------------------------------------------
  touch(memberId: string, now: string): void {
    const m = this.member(memberId);
    if (m) m.lastSeen = now;
    this.save();
  }

  revokeSession(sid: string, expiresAtMs: number): void {
    const nowMs = Date.now();
    this.data.revokedSessions = Object.fromEntries(Object.entries(this.data.revokedSessions).filter(([, exp]) => exp > nowMs));
    this.data.revokedSessions[sid] = expiresAtMs;
    this.save();
  }

  sessionValid(member: StaffMember, sid: string | undefined, epoch: number | undefined, now: string): boolean {
    if (member.status !== 'ACTIVE' || member.epoch !== epoch) return false;
    if (sid && this.data.revokedSessions[sid]) return false;
    return !!this.activeCode(member.id, now);
  }

  log(entry: LoginEntry): void {
    this.data.log.push(entry);
    if (this.data.log.length > LOG_LIMIT) this.data.log = this.data.log.slice(-LOG_LIMIT);
    this.save();
  }

  logFor(agencyId: string, limit = 100): LoginEntry[] {
    return this.data.log.filter((l) => l.agencyId === agencyId).slice(-limit).reverse();
  }

  // ---- The actor the state machine sees ---------------------------------------------------------
  actorFor(member: StaffMember, now: string): V5Actor {
    const agency = this.agency(member.agencyId);
    const peers = this.members(member.agencyId).filter((m) => m.status === 'ACTIVE' && m.role === member.role && this.activeCode(m.id, now));
    return {
      kind: 'PERSON',
      accountId: member.id,
      personId: member.personId,
      role: V6_DUTIES[member.role][0],
      duties: V6_DUTIES[member.role],
      v6Role: member.role,
      agencyId: member.agencyId,
      soleInRole: new Set(peers.map((m) => m.personId)).size <= 1,
      // A contractor's firm is never the agency's own organisation (SOD-1, SOD-3).
      orgId: member.role === 'CONTRACTOR' ? `ORG-${member.id}` : member.agencyId,
      scope: agency?.authorityIds ?? [],
      onlyCaseId: member.role === 'CONTRACTOR' ? member.caseId : null
    };
  }
}
