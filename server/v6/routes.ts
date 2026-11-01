/**
 * Sign-in with a personal code or QR plus a PIN, and the Team & Codes module
 * (docs/v6/V6_UPDATE_TWO_PORTALS.md §2.2, §2.5). Every change to who may enter goes in the audit chain.
 */
import type { Request, Response, Router } from 'express';
import { rateLimit } from '../middleware/rateLimit';
import { V6_ROLES, type V6Role } from '../../src/domain/v6/roles';
import type { V5Actor } from '../../src/domain/v5/model';
import type { V5Store } from '../v5/store';
import { MAX_PIN_TRIES, type LoginResult, type StaffMember, type Workspaces } from './workspaces';

export interface SessionIssuer {
  issue(kind: 'STAFF' | 'REMEMBER', id: string, extra: { hours: number; epoch: number; sid?: string }): string;
  read(token: string | undefined): { kind: string; id: string; exp: number; epoch?: number; sid?: string } | null;
}

interface V6Deps {
  workspaces: Workspaces;
  store: V5Store;
  sessions: SessionIssuer;
  actorOf: (req: Request) => V5Actor | null;
  sendFail: (res: Response, status: number, code: string, message: string, rule?: string) => unknown;
  /** Code for the QR badge: a link whose fragment never reaches a server log. */
  qrFor: (url: string) => Promise<string>;
}

const REMEMBER_HOURS = 24 * 30;
const STAFF_ROLES: readonly V6Role[] = V6_ROLES.filter((r) => r !== 'CONTRACTOR');

export const LOCKED_MESSAGE = 'Terlalu banyak percobaan. Coba lagi 15 menit lagi, atau minta Operations Manager memperbarui kode.';

/** Asks again for the PIN on a sensitive action (§2.2). Sends the failure itself and returns false. */
export function checkReauth(deps: Pick<V6Deps, 'workspaces' | 'sendFail'>, req: Request, res: Response, actor: V5Actor): boolean {
  if (actor.kind !== 'PERSON') return true;
  const pin = req.get('x-v6-pin');
  if (!pin) {
    deps.sendFail(res, 428, 'PIN_REQUIRED', 'Masukkan PIN untuk melanjutkan.');
    return false;
  }
  const now = new Date().toISOString();
  const outcome = deps.workspaces.checkPin(actor.accountId, pin, now);
  deps.workspaces.log({ at: now, agencyId: actor.agencyId ?? null, memberId: actor.accountId, result: outcome === 'OK' ? 'PIN_CHECK_OK' : 'PIN_CHECK_BAD', device: device(req) });
  if (outcome === 'OK') return true;
  deps.sendFail(res, outcome === 'LOCKED' ? 423 : 403, outcome === 'LOCKED' ? 'LOCKED' : 'PIN_WRONG', outcome === 'LOCKED' ? LOCKED_MESSAGE : 'PIN salah.');
  return false;
}

const device = (req: Request) => (req.get('user-agent') ?? 'tidak diketahui').slice(0, 120);

const memberView = (m: StaffMember, codeStatus: string) => ({ id: m.id, name: m.name, title: m.title, role: m.role, status: m.status, codeStatus, lastSeen: m.lastSeen, hasPin: !!m.pinHash, caseId: m.caseId });

export function registerV6Routes(router: Router, deps: V6Deps): void {
  const { workspaces, store, sessions, actorOf, sendFail, qrFor } = deps;
  const loginLimit = rateLimit('v6-login', 30, 60_000);
  const writeLimit = rateLimit('v6-write', 120, 60_000);

  const note = (req: Request, member: StaffMember | null, result: LoginResult) =>
    workspaces.log({ at: new Date().toISOString(), agencyId: member?.agencyId ?? null, memberId: member?.id ?? null, result, device: device(req) });

  const signIn = (req: Request, res: Response, member: StaffMember) => {
    const now = new Date().toISOString();
    const hours = workspaces.agency(member.agencyId)?.sessionHours ?? 12;
    workspaces.touch(member.id, now);
    note(req, member, 'OK');
    res.json({
      success: true,
      data: {
        token: sessions.issue('STAFF', member.id, { hours, epoch: member.epoch }),
        // Contractors have no PIN, so a remembered device would be a way in by itself.
        remember: member.role === 'CONTRACTOR' ? null : sessions.issue('REMEMBER', member.id, { hours: REMEMBER_HOURS, epoch: member.epoch }),
        role: member.role
      }
    });
  };

  // Step 1: the code. It says only whether a PIN must be made or typed.
  router.post('/api/v6/session/start', loginLimit, (req, res) => {
    const member = workspaces.findByCode(String(req.body?.code ?? ''), new Date().toISOString());
    if (!member) {
      note(req, null, 'BAD_CODE');
      return sendFail(res, 401, 'BAD_CODE', 'Kode tidak dikenal atau sudah tidak berlaku.');
    }
    res.json({ success: true, data: { step: member.role === 'CONTRACTOR' ? 'GUEST' : member.pinHash ? 'ENTER_PIN' : 'SET_PIN', agencyName: workspaces.agency(member.agencyId)?.name ?? '' } });
  });

  // Step 2: the code or a remembered device, with the PIN.
  router.post('/api/v6/session', loginLimit, (req, res) => {
    const now = new Date().toISOString();
    const remembered = req.body?.remember ? sessions.read(String(req.body.remember)) : null;
    let member: StaffMember | null = null;
    if (remembered?.kind === 'REMEMBER') {
      const m = workspaces.member(remembered.id);
      if (m && m.role !== 'CONTRACTOR' && workspaces.sessionValid(m, undefined, remembered.epoch, now)) member = m;
    } else if (req.body?.code) {
      member = workspaces.findByCode(String(req.body.code), now);
    }
    if (!member) {
      note(req, null, 'BAD_CODE');
      return sendFail(res, 401, 'BAD_CODE', 'Kode tidak dikenal atau sudah tidak berlaku.');
    }
    if (member.role === 'CONTRACTOR') return signIn(req, res, member);
    const pin = String(req.body?.pin ?? '');
    if (!member.pinHash) {
      if (!workspaces.setPin(member.id, pin)) return sendFail(res, 400, 'WEAK_PIN', 'PIN harus 6 angka dan tidak mudah ditebak, misalnya bukan 123456.');
      note(req, member, 'PIN_SET');
      return signIn(req, res, member);
    }
    const outcome = workspaces.checkPin(member.id, pin, now);
    if (outcome === 'OK') return signIn(req, res, member);
    note(req, member, outcome === 'LOCKED' ? 'LOCKED' : 'BAD_PIN');
    if (outcome === 'LOCKED') return sendFail(res, 423, 'LOCKED', LOCKED_MESSAGE);
    return sendFail(res, 401, 'BAD_PIN', `PIN salah. Setelah ${MAX_PIN_TRIES} kali salah, kode terkunci 15 menit.`);
  });

  // The Lock button: this session ends, and the device goes back to asking for the PIN.
  router.post('/api/v6/session/lock', writeLimit, (req, res) => {
    const claims = sessions.read(req.get('x-v5-session') ?? undefined);
    if (claims?.kind !== 'STAFF' || !claims.sid) return sendFail(res, 401, 'UNAUTHENTICATED', 'Belum masuk.');
    workspaces.revokeSession(claims.sid, claims.exp);
    note(req, workspaces.member(claims.id), 'LOCKED_BY_USER');
    res.json({ success: true, data: { locked: true } });
  });

  // Who a case can be transferred to. Names only.
  router.get('/api/v6/agencies', (req, res) => {
    const actor = actorOf(req);
    if (!actor?.agencyId) return sendFail(res, 401, 'UNAUTHENTICATED', 'Belum masuk.');
    res.json({ success: true, data: workspaces.agencies().filter((a) => a.id !== actor.agencyId).map((a) => ({ id: a.id, name: a.name })) });
  });

  // ---- Team & Codes -----------------------------------------------------------------------------
  /** OM manages; the Auditor reads (§2.4). */
  const teamActor = (req: Request, res: Response, write: boolean): V5Actor | null => {
    const actor = actorOf(req);
    if (!actor || !actor.agencyId) { sendFail(res, 401, 'UNAUTHENTICATED', 'Belum masuk.'); return null; }
    if (actor.v6Role !== 'OM' && (write || actor.v6Role !== 'AUDITOR')) { sendFail(res, 403, 'FORBIDDEN', 'Peran Anda tidak bisa membuka ini.'); return null; }
    if (write && !checkReauth(deps, req, res, actor)) return null;
    return actor;
  };

  const audit = (actor: V5Actor, type: string, memberId: string, role: string) =>
    store.recordEntity(type, { type: 'agency', id: actor.agencyId! }, { member_id: memberId, role }, actor, new Date().toISOString());

  const badge = async (req: Request, code: string) => {
    const origin = `${req.get('x-forwarded-proto') ?? req.protocol}://${req.get('host')}`;
    const url = `${origin}/login/#kode=${code}`;
    return { code, url, qr: await qrFor(url) };
  };

  router.get('/api/v6/team', (req, res) => {
    const actor = teamActor(req, res, false);
    if (!actor) return;
    const now = new Date().toISOString();
    res.json({ success: true, data: workspaces.members(actor.agencyId!).map((m) => memberView(m, workspaces.codeStatus(m.id, now))) });
  });

  router.get('/api/v6/team/log', (req, res) => {
    const actor = teamActor(req, res, false);
    if (!actor) return;
    const names = new Map(workspaces.members(actor.agencyId!).map((m) => [m.id, m.name]));
    res.json({ success: true, data: workspaces.logFor(actor.agencyId!).map((l) => ({ ...l, name: l.memberId ? names.get(l.memberId) ?? null : null })) });
  });

  router.post('/api/v6/team', writeLimit, async (req, res) => {
    const actor = teamActor(req, res, true);
    if (!actor) return;
    const name = String(req.body?.name ?? '').trim();
    const title = String(req.body?.title ?? '').trim();
    const role = req.body?.role as V6Role;
    if (name.length < 2 || !STAFF_ROLES.includes(role)) return sendFail(res, 400, 'VALIDATION', 'Isi nama dan pilih peran.');
    const { member, code } = workspaces.addMember({ agencyId: actor.agencyId!, name, title, role }, new Date().toISOString());
    audit(actor, 'access.staff_added', member.id, role);
    res.json({ success: true, data: { member: memberView(member, 'ACTIVE'), badge: await badge(req, code) } });
  });

  const ownMember = (actor: V5Actor, id: string) => {
    const m = workspaces.member(id);
    return m && m.agencyId === actor.agencyId ? m : null;
  };

  router.post('/api/v6/team/:id/renew', writeLimit, async (req, res) => {
    const actor = teamActor(req, res, true);
    if (!actor) return;
    const m = ownMember(actor, req.params.id);
    const code = m ? workspaces.renewCode(m.id, new Date().toISOString()) : null;
    if (!m || !code) return sendFail(res, 404, 'NOT_FOUND', 'Staf tidak ditemukan.');
    audit(actor, 'access.code_renewed', m.id, m.role);
    res.json({ success: true, data: { badge: await badge(req, code) } });
  });

  router.post('/api/v6/team/:id/revoke', writeLimit, (req, res) => {
    const actor = teamActor(req, res, true);
    if (!actor) return;
    const m = ownMember(actor, req.params.id);
    if (!m) return sendFail(res, 404, 'NOT_FOUND', 'Staf tidak ditemukan.');
    // The last OM cannot lock the agency out of its own workspace.
    if (m.role === 'OM' && workspaces.members(actor.agencyId!).filter((x) => x.role === 'OM' && x.status === 'ACTIVE').length <= 1) {
      return sendFail(res, 409, 'LAST_OM', 'Ini Operations Manager terakhir. Tambahkan pengganti lebih dulu.');
    }
    workspaces.revoke(m.id, new Date().toISOString());
    audit(actor, 'access.code_revoked', m.id, m.role);
    res.json({ success: true, data: { revoked: true } });
  });

  router.post('/api/v6/agency/session-hours', writeLimit, (req, res) => {
    const actor = teamActor(req, res, true);
    if (!actor) return;
    const hours = Number(req.body?.hours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 24) return sendFail(res, 400, 'VALIDATION', 'Lama sesi harus 1 sampai 24 jam.');
    workspaces.setSessionHours(actor.agencyId!, hours);
    store.recordEntity('access.session_hours_changed', { type: 'agency', id: actor.agencyId! }, { hours }, actor, new Date().toISOString());
    res.json({ success: true, data: { hours } });
  });
}

