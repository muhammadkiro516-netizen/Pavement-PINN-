/**
 * v5 API (02 §6), under /api/v5 so the v4 paths and their tests stay as they are. Roles, state and
 * separation of duties are decided here on the server from a signed session, never by the client.
 */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response, Router } from 'express';
import { V5_ACTIONS, type V5Action, type V5Command } from '../../src/domain/v5/stateMachine';
import { V5_STATE_LABELS, type V5Actor, type V5Case } from '../../src/domain/v5/model';
import { ladderStatus } from '../../src/domain/v5/escalation';
import { DEMO_ACCOUNTS, actorFor, deviceActor, findDemoAccount } from './demoPeople';
import type { ChainId } from './chain';
import { V5Store } from './store';

const SESSION_HOURS = 8;

export interface V5Options {
  dataDir: string;
  demoMode: boolean;
}

/** Roles allowed to read the whole case and its event chain (03 matrix: case.read_full). */
const FULL_READ_ROLES = ['FIELD_INSPECTOR', 'COORDINATOR', 'APPROVER', 'REPAIR_CREW', 'SUPERVISOR', 'AUDITOR', 'AGENCY_HEAD'];

interface SessionClaims {
  kind: 'STAFF' | 'DEVICE';
  id: string;
  exp: number;
}

class Sessions {
  private readonly key: Buffer;

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'session-key');
    if (!fs.existsSync(file)) fs.writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o400 });
    this.key = Buffer.from(fs.readFileSync(file, 'utf8'), 'hex');
  }

  issue(kind: SessionClaims['kind'], id: string): string {
    const body = Buffer.from(JSON.stringify({ kind, id, exp: Date.now() + SESSION_HOURS * 3_600_000 })).toString('base64url');
    return `${body}.${createHmac('sha256', this.key).update(body).digest('base64url')}`;
  }

  read(token: string | undefined): SessionClaims | null {
    if (!token) return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = createHmac('sha256', this.key).update(body).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionClaims;
    return claims.exp > Date.now() ? claims : null;
  }
}

/** What anyone can see: no reporter, staff or provider data (02 §8.1 P-11). */
export function publicCaseView(c: V5Case, now: string) {
  const { isDemo, publicCode, state, closureReason, createdAt, mode, damageClass, sizeBand, routing, pending, hazard, underTechnicalReview, followUps, captureTrust, witnesses } = c;
  return {
    publicCode,
    state,
    stateLabel: state ? V5_STATE_LABELS[state].en : null,
    closureReason,
    createdAt,
    mode,
    damageClass,
    sizeBand,
    routing,
    pending,
    hazard,
    underTechnicalReview,
    captureTrust,
    witnesses,
    isDemo,
    followUps: followUps.map(({ milestone, dueAt, trigger, result, recordedAt }) => ({ milestone, dueAt, trigger, result, recordedAt })),
    ladder: ladderStatus(c, now)
  };
}

export function registerV5Routes(router: Router, options: V5Options): V5Store {
  const dir = path.join(options.dataDir, 'v5');
  const store = new V5Store(dir);
  const sessions = new Sessions(dir);

  const sendFail = (res: Response, status: number, code: string, message: string, rule?: string) =>
    res.status(status).json({ success: false, error: { code, message, ...(rule ? { rule } : {}) } });

  const actorOf = (req: Request): V5Actor | null => {
    const claims = sessions.read(req.get('x-v5-session') ?? undefined);
    if (!claims) return null;
    if (claims.kind === 'DEVICE') return deviceActor(claims.id);
    const account = findDemoAccount(claims.id);
    return account && options.demoMode ? actorFor(account) : null;
  };

  router.get('/api/v5/config', (_req, res) => {
    res.json({ success: true, data: { demoMode: options.demoMode, actions: V5_ACTIONS } });
  });

  // Role switcher (02 §9 D-7). Exists only in DEMO MODE: production needs real staff accounts.
  router.get('/api/v5/demo/accounts', (_req, res) => {
    if (!options.demoMode) return sendFail(res, 404, 'NOT_FOUND', 'Demo accounts are off.');
    res.json({ success: true, data: DEMO_ACCOUNTS });
  });

  router.post('/api/v5/session', (req, res) => {
    if (!options.demoMode) return sendFail(res, 404, 'NOT_FOUND', 'Demo accounts are off.');
    const account = findDemoAccount(String(req.body?.accountId ?? ''));
    if (!account) return sendFail(res, 400, 'VALIDATION', 'Unknown demo account.');
    res.json({ success: true, data: { token: sessions.issue('STAFF', account.accountId), account } });
  });

  // Citizens have no login: a pseudonymous device identity only (02 C-1).
  router.post('/api/v5/session/device', (_req, res) => {
    const deviceId = `DEV-${randomUUID()}`;
    res.json({ success: true, data: { token: sessions.issue('DEVICE', deviceId), pseudonym: `Warga-${deviceId.slice(4, 8).toUpperCase()}` } });
  });

  router.get('/api/v5/me', (req, res) => {
    const actor = actorOf(req);
    if (!actor) return sendFail(res, 401, 'UNAUTHENTICATED', 'Choose a role first.');
    res.json({ success: true, data: { role: actor.role, kind: actor.kind, accountId: actor.accountId, displayName: findDemoAccount(actor.accountId)?.displayName ?? null } });
  });

  router.get('/api/v5/cases', (req, res) => {
    const actor = actorOf(req);
    if (!actor || !FULL_READ_ROLES.includes(actor.role)) return sendFail(res, 403, 'FORBIDDEN', 'Staff only.');
    res.json({ success: true, data: store.list() });
  });

  router.get('/api/v5/cases/:id', (req, res) => {
    const actor = actorOf(req);
    if (!actor || !FULL_READ_ROLES.includes(actor.role)) return sendFail(res, 403, 'FORBIDDEN', 'Staff only.');
    const c = store.get(req.params.id);
    if (!c) return sendFail(res, 404, 'NOT_FOUND', 'Case not found.');
    res.json({ success: true, data: c });
  });

  router.post('/api/v5/cases/:id/transitions', (req, res) => {
    const actor = actorOf(req);
    if (!actor) return sendFail(res, 401, 'UNAUTHENTICATED', 'Choose a role first.');
    const c = store.get(req.params.id);
    if (!c) return sendFail(res, 404, 'NOT_FOUND', 'Case not found.');
    const { action, expectedVersion, ...payload } = (req.body ?? {}) as Record<string, unknown>;
    if (!V5_ACTIONS.includes(action as V5Action)) return sendFail(res, 400, 'VALIDATION', 'Unknown action.');
    const outcome = store.apply(c, { ...payload, action } as V5Command, actor, new Date().toISOString(), Number(expectedVersion));
    if ('ok' in outcome) {
      const status = outcome.code === 'FORBIDDEN' ? 403 : outcome.code === 'VALIDATION' ? 400 : 409;
      return sendFail(res, status, outcome.code, outcome.message, outcome.rule);
    }
    res.json({ success: true, data: { case: outcome.case, event: { seq: outcome.event.seq, event_hash: outcome.event.event_hash, type: outcome.event.type } } });
  });

  router.get('/api/v5/cases/:id/events', (req, res) => {
    const actor = actorOf(req);
    if (!actor || !FULL_READ_ROLES.includes(actor.role)) return sendFail(res, 403, 'FORBIDDEN', 'Staff only.');
    const c = store.get(req.params.id);
    if (!c) return sendFail(res, 404, 'NOT_FOUND', 'Case not found.');
    res.json({ success: true, data: store.eventsFor(c.id, c.chainId) });
  });

  router.get('/api/v5/public/track/:code', (req, res) => {
    const c = store.byPublicCode(req.params.code);
    if (!c) return sendFail(res, 404, 'NOT_FOUND', 'No report has this code.');
    res.json({ success: true, data: publicCaseView(c, new Date().toISOString()) });
  });

  router.get('/api/v5/public/chain/:chainId/verify', (req, res) => {
    const chainId = req.params.chainId as ChainId;
    if (chainId !== 'prod' && chainId !== 'demo') return sendFail(res, 404, 'NOT_FOUND', 'Unknown chain.');
    res.json({ success: true, data: store.verify(chainId) });
  });

  return store;
}
