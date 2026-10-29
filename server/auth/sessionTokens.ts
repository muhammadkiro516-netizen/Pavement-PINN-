import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Actor } from "../../src/domain/workflow/model";

/**
 * Server-issued session tokens (HMAC-SHA256 over a small JSON payload).
 *
 * What this is: the server decides the actor for every workflow request from a token it
 * signed itself, so a browser cannot claim another role by editing a request body or
 * sessionStorage.
 *
 * What this is NOT: authentication. In demo mode anyone may ask for a token for any demo
 * account (that is the account picker). Production needs a real identity provider
 * (Supabase Auth is the planned one, docs/DECISION_LOG.md D-021) whose verified JWT
 * replaces `/api/auth/demo-session`; set DEMO_AUTH=false to switch the picker off.
 *
 * Lifetime: absolute. `exp` is fixed at issue (`iat` + max age) and no call re-issues or
 * extends a token, so refreshing, navigating or opening tabs never moves the deadline; only
 * a new login starts a new two-hour window. Logout revokes the token id (`jti`).
 */
export interface SessionPayload {
  sub: string;
  role: Actor["role"];
  kind: Actor["kind"];
  /** Issued at, seconds since epoch (start of the session). */
  iat: number;
  /** Expiry, seconds since epoch: iat + max age, never moved. */
  exp: number;
  /** Token id, for revocation on logout. */
  jti: string;
}

/** Maximum session age: 2 hours. */
export const SESSION_MAX_AGE_SECONDS = 2 * 60 * 60;

export type VerifyResult =
  | { ok: true; actor: Actor; payload: SessionPayload }
  | { ok: false; reason: "MISSING" | "INVALID" | "EXPIRED" | "REVOKED" };

const b64url = (buf: Buffer) => buf.toString("base64url");

/**
 * Signing key: SESSION_SECRET when set; otherwise a key kept in the runtime's data directory,
 * so a restart of the development server does not sign everyone out. Without a data
 * directory (tests, in-memory runs) the key lives only as long as the process.
 */
export function resolveSessionSecret(secret: string | undefined, dataDir: string | null): string | undefined {
  if (secret && secret.length >= 32) return secret;
  if (!dataDir) return undefined;
  const file = path.join(dataDir, "session-secret");
  try {
    if (existsSync(file)) {
      const stored = readFileSync(file, "utf8").trim();
      if (stored.length >= 32) return stored;
    }
    mkdirSync(dataDir, { recursive: true });
    const fresh = randomBytes(48).toString("base64url");
    writeFileSync(file, fresh, { mode: 0o600 });
    return fresh;
  } catch {
    return undefined;
  }
}

export class SessionSigner {
  private readonly key: Buffer;
  /** Revoked token ids → their expiry (ms); pruned once expired. */
  private readonly revoked = new Map<string, number>();

  constructor(
    secret: string | undefined,
    private readonly ttlSeconds = SESSION_MAX_AGE_SECONDS,
    private readonly revocationFile: string | null = null
  ) {
    // Without a configured secret, tokens are valid only for this server process.
    this.key = secret && secret.length >= 32 ? Buffer.from(secret, "utf8") : randomBytes(32);
    if (revocationFile) {
      try {
        const saved = JSON.parse(readFileSync(revocationFile, "utf8")) as Record<string, number>;
        for (const [jti, exp] of Object.entries(saved)) this.revoked.set(jti, exp);
      } catch {
        /* none yet */
      }
    }
  }

  /** Keyed digest for public, non-secret codes (e.g. certificate verification). */
  mac(text: string): string {
    return createHmac("sha256", this.key).update(text).digest("hex");
  }

  get maxAgeSeconds(): number {
    return this.ttlSeconds;
  }

  issue(actor: Actor, nowMs = Date.now()): { token: string; expiresAt: string; issuedAt: string } {
    const iat = Math.floor(nowMs / 1000);
    const payload: SessionPayload = { sub: actor.id, role: actor.role, kind: actor.kind, iat, exp: iat + this.ttlSeconds, jti: randomBytes(12).toString("base64url") };
    const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
    const sig = b64url(createHmac("sha256", this.key).update(body).digest());
    return { token: `${body}.${sig}`, expiresAt: new Date(payload.exp * 1000).toISOString(), issuedAt: new Date(iat * 1000).toISOString() };
  }

  /** Why a token is or is not usable (never throws). */
  check(token: string | undefined | null, nowMs = Date.now()): VerifyResult {
    if (!token) return { ok: false, reason: "MISSING" };
    if (typeof token !== "string" || token.length > 2048) return { ok: false, reason: "INVALID" };
    const [body, sig] = token.split(".");
    if (!body || !sig) return { ok: false, reason: "INVALID" };
    const expected = createHmac("sha256", this.key).update(body).digest();
    let given: Buffer;
    try {
      given = Buffer.from(sig, "base64url");
    } catch {
      return { ok: false, reason: "INVALID" };
    }
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "INVALID" };
    let payload: SessionPayload;
    try {
      payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    } catch {
      return { ok: false, reason: "INVALID" };
    }
    if (!payload || typeof payload.sub !== "string" || typeof payload.exp !== "number") return { ok: false, reason: "INVALID" };
    // Never honour a lifetime longer than the maximum, whatever the token says.
    const deadline = typeof payload.iat === "number" ? Math.min(payload.exp, payload.iat + this.ttlSeconds) : payload.exp;
    if (deadline * 1000 <= nowMs) return { ok: false, reason: "EXPIRED" };
    if (payload.jti && this.revoked.has(payload.jti)) return { ok: false, reason: "REVOKED" };
    return { ok: true, actor: { id: payload.sub, role: payload.role, kind: payload.kind }, payload };
  }

  /** Returns the actor for a valid, unexpired, unrevoked token; null otherwise (never throws). */
  verify(token: string | undefined | null, nowMs = Date.now()): Actor | null {
    const result = this.check(token, nowMs);
    return result.ok ? result.actor : null;
  }

  /** Ends a session before its expiry (logout). Unknown or invalid tokens are ignored. */
  revoke(token: string | undefined | null, nowMs = Date.now()): void {
    const result = this.check(token, nowMs);
    if (!result.ok || !result.payload.jti) return;
    this.revoked.set(result.payload.jti, result.payload.exp * 1000);
    for (const [jti, exp] of this.revoked) if (exp <= nowMs) this.revoked.delete(jti);
    if (this.revocationFile) {
      try {
        writeFileSync(this.revocationFile, JSON.stringify(Object.fromEntries(this.revoked)));
      } catch {
        /* revocation still holds for this process */
      }
    }
  }
}

/** Opaque claim token handed once to an anonymous reporter; only its hash is stored. */
export function newClaimToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: hashClaimToken(token) };
}

export function hashClaimToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
