import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { UserRole } from "../../src/types";

/**
 * Real user accounts (docs/LEAN_PLAN.md): citizens register themselves, staff accounts are
 * created by a Koordinator, the first Koordinator by `npm run create-coordinator`.
 * Passwords are stored as scrypt hashes with a per-account salt; nothing else is secret.
 * Kept in one JSON file next to the workflow store (or in memory for tests).
 */
/** POLICY_MAKER is the "Pimpinan Instansi" (SPEC §2): receives escalations, reads the report card. */
export type AccountRole = Extract<UserRole, "PUBLIC_REPORTER" | "FIELD_ENGINEER" | "OPERATIONS_MANAGER" | "POLICY_MAKER">;
export const ACCOUNT_ROLES: readonly AccountRole[] = ["PUBLIC_REPORTER", "FIELD_ENGINEER", "OPERATIONS_MANAGER", "POLICY_MAKER"];

export interface AccountRecord {
  id: string;
  email: string;
  name: string;
  role: AccountRole;
  /** Agency of a staff account (e.g. "Dinas BMBK Provinsi Lampung"); null for citizens. */
  agency: string | null;
  /** Registry id of the agency (config/authorities); null for citizens. */
  agencyId?: string | null;
  passwordHash: string;
  createdAt: string;
  createdBy: string | null;
  active: boolean;
}

/** What the API and the browser may see of an account. */
export type AccountProfile = Omit<AccountRecord, "passwordHash">;

export class AccountError extends Error {
  constructor(readonly code: "VALIDATION" | "CONFLICT" | "NOT_FOUND", message: string) {
    super(message);
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD = 8;

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 32).toString("hex")}`;
}

function passwordMatches(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  return timingSafeEqual(scryptSync(password, Buffer.from(saltHex, "hex"), expected.length), expected);
}
/** Compared against when the email is unknown, so both failures cost the same. */
const UNKNOWN_HASH = hashPassword(randomUUID());

export const toProfile = ({ passwordHash: _hash, ...profile }: AccountRecord): AccountProfile => profile;

export class AccountStore {
  private accounts: AccountRecord[];

  private loadedMtime = 0;

  constructor(private readonly file: string | null = null) {
    this.accounts = [];
    this.refresh();
  }

  /** Re-read the file when another process (e.g. scripts/seed-agencies.ts) changed it. */
  private refresh(): void {
    if (!this.file || !fs.existsSync(this.file)) return;
    const mtime = fs.statSync(this.file).mtimeMs;
    if (mtime === this.loadedMtime) return;
    this.accounts = JSON.parse(fs.readFileSync(this.file, "utf8")) as AccountRecord[];
    this.loadedMtime = mtime;
  }

  private persist(): void {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.accounts, null, 2));
    fs.renameSync(tmp, this.file);
    this.loadedMtime = fs.statSync(this.file).mtimeMs;
  }

  get(id: string): AccountRecord | null {
    this.refresh();
    return this.accounts.find((a) => a.id === id) ?? null;
  }

  roleOf(id: string): AccountRole | null {
    const a = this.get(id);
    return a && a.active ? a.role : null;
  }

  list(role?: AccountRole): AccountProfile[] {
    this.refresh();
    return this.accounts.filter((a) => !role || a.role === role).map(toProfile);
  }

  create(input: { email: unknown; name: unknown; password: unknown; role: AccountRole; agency?: unknown; agencyId?: string | null; createdBy?: string | null }): AccountProfile {
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    const name = typeof input.name === "string" ? input.name.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 80) : "";
    const agency = typeof input.agency === "string" && input.agency.trim() ? input.agency.trim().slice(0, 120) : null;
    if (!EMAIL.test(email) || email.length > 254) throw new AccountError("VALIDATION", "Email tidak valid.");
    if (name.length < 2) throw new AccountError("VALIDATION", "Nama minimal 2 huruf.");
    if (typeof input.password !== "string" || input.password.length < MIN_PASSWORD || input.password.length > 256) {
      throw new AccountError("VALIDATION", `Kata sandi minimal ${MIN_PASSWORD} karakter.`);
    }
    if (!ACCOUNT_ROLES.includes(input.role)) throw new AccountError("VALIDATION", "Peran tidak dikenal.");
    this.refresh();
    if (input.role !== "PUBLIC_REPORTER" && !agency) throw new AccountError("VALIDATION", "Akun petugas wajib mencantumkan instansi.");
    if (this.accounts.some((a) => a.email === email)) throw new AccountError("CONFLICT", "Email sudah terdaftar.");
    const record: AccountRecord = {
      id: `USR-${randomUUID().slice(0, 8).toUpperCase()}`,
      email,
      name,
      role: input.role,
      agency: input.role === "PUBLIC_REPORTER" ? null : agency,
      agencyId: input.role === "PUBLIC_REPORTER" ? null : input.agencyId ?? null,
      passwordHash: hashPassword(input.password),
      createdAt: new Date().toISOString(),
      createdBy: input.createdBy ?? null,
      active: true
    };
    this.accounts.push(record);
    this.persist();
    return toProfile(record);
  }

  /** The account for an email and password, or null; unknown emails cost the same as wrong passwords. */
  verify(email: unknown, password: unknown): AccountProfile | null {
    this.refresh();
    if (typeof email !== "string" || typeof password !== "string" || password.length > 256) return null;
    const account = this.accounts.find((a) => a.email === email.trim().toLowerCase());
    const ok = passwordMatches(password, account?.passwordHash ?? UNKNOWN_HASH);
    return account && account.active && ok ? toProfile(account) : null;
  }

  setActive(id: string, active: boolean): AccountProfile {
    const account = this.get(id);
    if (!account) throw new AccountError("NOT_FOUND", "Akun tidak ditemukan.");
    account.active = active;
    this.persist();
    return toProfile(account);
  }
}
