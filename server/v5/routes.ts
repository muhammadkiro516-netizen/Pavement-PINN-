/**
 * v5 API (02 §6), under /api/v5 so the v4 paths and their tests stay as they are. Roles, state and
 * separation of duties are decided here on the server from a signed session, never by the client.
 */
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response, Router } from 'express';
import { V5_ACTIONS, SYSTEM_ACTOR, type V5Action, type V5Command } from '../../src/domain/v5/stateMachine';
import { V5_STATE_LABELS, type EvidenceRef, type V5Actor, type V5Case, type V5Flag, type V5PinnRun } from '../../src/domain/v5/model';
import { ladderStatus, LADDER } from '../../src/domain/v5/escalation';
import { fairCost, type CostRequest, type Mix } from '../../src/domain/v5/costEngine';
import { citizenDisputeTriggersInspection } from '../../src/domain/v5/sod';
import { followUpIsDue, followUpIsOverdue } from '../../src/domain/v5/followUps';
import { bannedWordsIn } from '../../src/domain/v5/wording';
import wordingLibrary from '../../config/wording/neutral_v1.json';
import { callInference } from '../services/inferenceClient';
import { rateLimit } from '../middleware/rateLimit';
import { DEMO_ACCOUNTS, DEMO_EMAILS, DEMO_PASSWORD, actorFor, deviceActor, findDemoAccount } from './demoPeople';
import { canonicalize, sha256Hex, verifyChainText, type ChainEvent, type ChainId } from './chain';
import { V5Store, type IssuedDocument } from './store';
import { RoadRegistry, parseCsv, type RoutingDecision } from './routing';
import { CaptureService, analyseTrace, isCaptureFailure } from './capture';
import { buildPlaceholders, htmlToPdf, qrFor, renderTemplate, reportProblems } from './documents';
import { inclusionProof, merkleRoot } from './merkle';
import { seedDemoCases } from './seed';

const SESSION_HOURS = 8;
const DAY_MS = 86_400_000;

export interface V5Options {
  dataDir: string;
  demoMode: boolean;
  /** Load the demo cases at start. Default: on in DEMO MODE. Tests build their own. */
  seed?: boolean;
}

/** Roles allowed to read the whole case and its event chain (03 matrix: case.read_full). */
const FULL_READ_ROLES = ['FIELD_INSPECTOR', 'COORDINATOR', 'APPROVER', 'REPAIR_CREW', 'SUPERVISOR', 'AUDITOR', 'AGENCY_HEAD'];
const PINN_ROLES = ['FIELD_INSPECTOR', 'COORDINATOR', 'APPROVER', 'AUDITOR'];
const COST_ROLES = ['FIELD_INSPECTOR', 'COORDINATOR', 'APPROVER', 'AUDITOR'];
const DOCUMENT_ROLES = ['COORDINATOR', 'AUDITOR', 'AGENCY_HEAD'];
const FLAG_ROLES = ['COORDINATOR', 'AUDITOR'];
const SPEND_LOWER_LIMIT_C = 120; // Default threshold, TODO_VERIFY: Spec 2018 rev.2 Divisi 6 table.

const REPAIR_OPTIONS: Record<string, string[]> = {
  POTHOLE: ['HOT_MIX_FULL_DEPTH_PATCH', 'COLD_MIX_TEMPORARY'],
  ALLIGATOR: ['OVERLAY', 'MILL_AND_INLAY'],
  SEVERE_BREAKUP: ['RECONSTRUCTION']
};

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
    // A citizen's device key lasts, so "My reports" still works next week; staff sessions do not.
    const hours = kind === 'DEVICE' ? 24 * 365 : SESSION_HOURS;
    const body = Buffer.from(JSON.stringify({ kind, id, exp: Date.now() + hours * 3_600_000 })).toString('base64url');
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

/** Time this case lives in: real time, plus the labelled DEMO fast-forward. */
export const caseNow = (c: V5Case, nowMs = Date.now()) => new Date(nowMs + c.demoClockDays * DAY_MS).toISOString();

const EVENT_LABEL: Record<string, string> = {
  'demo.seeded': 'Sample case loaded',
  'case.submitted': 'Citizen report received',
  'case.screening_started': 'Automatic screening started',
  'case.screened': 'Screened and routed to an office',
  'case.duplicate_suggested': 'Possible duplicate noted',
  'case.accepted': 'Accepted by the agency',
  'case.transfer_requested': 'Transfer to another agency asked',
  'case.transfer_confirmed': 'Transfer confirmed',
  'case.referred': 'Sent to an official channel',
  'case.pending_set': 'Delay reason published',
  'case.hazard_marked': 'Warning sign recorded',
  'inspection.assigned': 'Inspector assigned',
  'inspection.submitted': 'Inspection done on site',
  'inspection.verified': 'Inspection checked',
  'inspection.reinspection_requested': 'Inspection to be repeated',
  'pinn.run': 'Expected life calculated',
  'cost.estimated': 'Fair cost calculated',
  'plan.proposed': 'Repair plan proposed',
  'plan.returned': 'Plan returned for changes',
  'plan.approved': 'Repair plan approved',
  'work_order.issued': 'Repair scheduled',
  'work.started': 'Repair started',
  'work.stage_evidence': 'Repair photo added',
  'work.submitted': 'Repair evidence sent',
  'work.rejected': 'Repair needs rework',
  'work.verified': 'Repair checked by supervisor',
  'work.accepted': 'Repair accepted. Under watch',
  'follow_up.recorded': 'Follow-up recorded',
  'follow_up.scheduled': 'Follow-up scheduled',
  'flag.created': 'Under technical review',
  'response.added': 'Agency responded',
  'case.reopened': 'Broke again. Case reopened',
  'case.closed': 'Case closed',
  'document.issued': 'Audit report issued',
  'demo.time_advanced': 'DEMO: time fast-forwarded'
};

/** What anyone can see: no reporter, staff or provider data (02 §8.1 P-11). */
export function publicCaseView(c: V5Case, now: string, events: ChainEvent[] = []) {
  const { isDemo, publicCode, state, closureReason, createdAt, mode, damageClass, sizeBand, routing, pending, hazard, underTechnicalReview, followUps, captureTrust, witnesses, trace, warrantyFlag, demoClockDays } = c;
  const ladder = ladderStatus(c, now);
  return {
    publicCode,
    state,
    stateLabel: state ? V5_STATE_LABELS[state].en : null,
    closureReason,
    createdAt,
    mode,
    damageClass,
    sizeBand,
    routing: routing ? { segmentName: routing.segmentName, roadStatus: routing.roadStatus, authorityName: routing.authorityName, officeName: routing.officeName, confidence: routing.confidence, basis: routing.basis, note: routing.note } : null,
    pending,
    hazard,
    // Flags show only as a neutral line in public (02 CO-8.1).
    underTechnicalReview: underTechnicalReview || c.flags.some((f) => f.state === 'OPEN'),
    captureTrust,
    witnesses,
    isDemo,
    demoClockDays,
    trace: trace ? { lengthM: trace.lengthM, quality: trace.quality } : null,
    warrantyFlag,
    photos: c.evidence.filter((e) => ['OVERVIEW', 'CLOSEUP', 'TRACE_POINT'].includes(e.kind) || (e.kind === 'WORK_STAGE' && (e.stage === 'BEFORE' || e.stage === 'AFTER'))).map((e) => ({ id: e.id, kind: e.kind, stage: e.stage, demo: e.captureTrust === 'DEMO' })),
    followUps: followUps.map(({ milestone, dueAt, trigger, result, recordedAt, windowDays }) => ({ milestone, dueAt, trigger, result, recordedAt, windowDays, due: followUpIsDue({ dueAt, result } as never, now), overdue: followUpIsOverdue({ dueAt, result, windowDays } as never, now) })),
    confirmations: { stillFixed: c.citizenConfirmations.filter((x) => x.result === 'OK').length, brokeAgain: c.citizenConfirmations.filter((x) => x.result === 'DAMAGED').length },
    ladder,
    complaintDraftAvailable: ladder.level === 'COMPLAINT',
    now,
    timeline: events.filter((e) => e.type !== 'case.screening_started').map((e) => ({ type: e.type, label: EVENT_LABEL[e.type] ?? e.type, at: e.server_received_at, role: e.actor.role, hash: e.event_hash.slice(0, 12), state: e.refs.next_state ? V5_STATE_LABELS[e.refs.next_state as keyof typeof V5_STATE_LABELS]?.en ?? null : null }))
  };
}

/** Priority with its reasons, so a coordinator can see why (02 CO-1). */
export function priorityOf(c: V5Case, now: string) {
  const reasons: { text: string; points: number }[] = [];
  if (c.hazard) reasons.push({ text: 'Hazard marked', points: 40 });
  if (c.sizeBand === 'L' || c.sizeBand === 'T3') reasons.push({ text: 'Large damage, as reported', points: 30 });
  else if (c.sizeBand === 'M' || c.sizeBand === 'T2') reasons.push({ text: 'Medium damage, as reported', points: 15 });
  if (c.damageClass === 'POTHOLE') reasons.push({ text: 'Pothole', points: 15 });
  if (c.witnesses > 0) reasons.push({ text: `${c.witnesses} witness${c.witnesses === 1 ? '' : 'es'}`, points: Math.min(20, c.witnesses * 5) });
  const ladder = ladderStatus(c, now);
  if (ladder.applies && ladder.daysWaiting > 0) reasons.push({ text: `Waiting ${ladder.daysWaiting} day${ladder.daysWaiting === 1 ? '' : 's'}`, points: Math.min(30, ladder.daysWaiting) });
  if (c.routing?.confidence === 'LOW') reasons.push({ text: 'Coordinator to confirm the owner', points: 5 });
  return { score: reasons.reduce((sum, r) => sum + r.points, 0), reasons };
}

const describeRouting = (d: RoutingDecision): NonNullable<V5Case['routing']> => ({
  segmentId: d.segment?.id ?? null,
  segmentName: d.segment?.name ?? null,
  roadStatus: d.status,
  authorityId: d.authorityId,
  authorityName: d.authorityName,
  authorityLevel: d.status,
  officeId: d.officeId,
  officeName: d.officeName,
  confidence: d.confidence,
  basis: `${d.basis} ${d.legalBasis}.`,
  note: d.coordinatorPrompt
});

const REGION_PREFIX = { jakarta: 'JKT', karawang: 'KRW' } as const;

export interface V5Runtime {
  store: V5Store;
  capture: CaptureService;
  registry: RoadRegistry;
}

export function registerV5Routes(router: Router, options: V5Options): V5Runtime {
  const dir = path.join(options.dataDir, 'v5');
  const store = new V5Store(dir);
  const sessions = new Sessions(dir);
  const capture = new CaptureService(dir, options.demoMode);
  // Parsed on first use: every createApp() in the v4 tests passes through here.
  let loadedRegistry: RoadRegistry | null = null;
  const roads = () => (loadedRegistry ??= new RoadRegistry());
  const registry = { decide: (...args: Parameters<RoadRegistry['decide']>) => roads().decide(...args), segmentsInBox: (...args: Parameters<RoadRegistry['segmentsInBox']>) => roads().segmentsInBox(...args), get version() { return roads().version; }, get available() { return roads().available; } } as RoadRegistry;
  const writeLimit = rateLimit('v5-write', 240, 60_000);

  capture.purgeOriginals();
  setInterval(() => capture.purgeOriginals(), 3_600_000).unref();

  const sendFail = (res: Response, status: number, code: string, message: string, rule?: string) =>
    res.status(status).json({ success: false, error: { code, message, ...(rule ? { rule } : {}) } });
  const httpStatus = (code: string) => (code === 'FORBIDDEN' ? 403 : code === 'NOT_FOUND' ? 404 : code === 'VERSION_CONFLICT' || code === 'INVALID_TRANSITION' ? 409 : code === 'UNAUTHENTICATED' ? 401 : 400);

  const actorOf = (req: Request): V5Actor | null => {
    const claims = sessions.read(req.get('x-v5-session') ?? undefined);
    if (!claims) return null;
    if (claims.kind === 'DEVICE') return deviceActor(claims.id);
    const account = findDemoAccount(claims.id);
    return account && options.demoMode ? actorFor(account) : null;
  };

  const staffCase = (req: Request, res: Response, roles: readonly string[]): { actor: V5Actor; c: V5Case } | null => {
    const actor = actorOf(req);
    if (!actor) { sendFail(res, 401, 'UNAUTHENTICATED', 'Choose a role first.'); return null; }
    if (!roles.includes(actor.role)) { sendFail(res, 403, 'FORBIDDEN', 'Your role cannot see this.'); return null; }
    const c = store.get(req.params.id);
    if (!c) { sendFail(res, 404, 'NOT_FOUND', 'Case not found.'); return null; }
    return { actor, c };
  };

  /** Applies one command, chains it and answers. */
  const respondOutcome = (res: Response, outcome: ReturnType<V5Store['apply']>) => {
    if ('ok' in outcome) return sendFail(res, httpStatus(outcome.code), outcome.code, outcome.message, outcome.rule);
    return res.json({ success: true, data: { case: outcome.case, event: { seq: outcome.event.seq, event_hash: outcome.event.event_hash, type: outcome.event.type } } });
  };

  router.get('/api/v5/config', (_req, res) => {
    res.json({ success: true, data: { demoMode: options.demoMode, actions: V5_ACTIONS, ladder: LADDER, samples: options.demoMode ? capture.samples() : [] } });
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

  // The sign-in form's test accounts for the role workspaces. Same DEMO MODE gate as the picker.
  router.post('/api/v5/session/login', rateLimit('v5-login', 30, 60_000), (req, res) => {
    if (!options.demoMode) return sendFail(res, 404, 'NOT_FOUND', 'Demo accounts are off.');
    const accountId = DEMO_EMAILS[String(req.body?.email ?? '').trim().toLowerCase()];
    const account = accountId ? findDemoAccount(accountId) : null;
    if (!account || req.body?.password !== DEMO_PASSWORD) return sendFail(res, 401, 'UNAUTHENTICATED', 'Email atau kata sandi salah.');
    res.json({ success: true, data: { token: sessions.issue('STAFF', account.accountId), account } });
  });

  // Citizens have no login: a pseudonymous device identity only (02 C-1).
  router.post('/api/v5/session/device', writeLimit, (_req, res) => {
    const deviceId = `DEV-${randomUUID()}`;
    res.json({ success: true, data: { token: sessions.issue('DEVICE', deviceId), pseudonym: `Warga-${deviceId.slice(4, 8).toUpperCase()}` } });
  });

  router.get('/api/v5/me', (req, res) => {
    const actor = actorOf(req);
    if (!actor) return sendFail(res, 401, 'UNAUTHENTICATED', 'Choose a role first.');
    res.json({ success: true, data: { role: actor.role, kind: actor.kind, accountId: actor.accountId, displayName: findDemoAccount(actor.accountId)?.displayName ?? null } });
  });

  // ---- Capture ------------------------------------------------------------------------------
  router.post('/api/v5/capture/nonce', writeLimit, (req, res) => {
    const actor = actorOf(req);
    if (!actor) return sendFail(res, 401, 'UNAUTHENTICATED', 'Start a session first.');
    res.json({ success: true, data: capture.issueNonce(actor.accountId, String(req.body?.purpose ?? 'REPORT')) });
  });

  router.post('/api/v5/evidence', writeLimit, async (req, res) => {
    const actor = actorOf(req);
    if (!actor) return sendFail(res, 401, 'UNAUTHENTICATED', 'Start a session first.');
    if (actor.role === 'AUDITOR' || actor.role === 'ADMIN' || actor.role === 'AGENCY_HEAD' || actor.role === 'APPROVER') return sendFail(res, 403, 'FORBIDDEN', 'Your role does not capture evidence.');
    const body = req.body ?? {};
    const c = body.caseId ? store.get(String(body.caseId)) : null;
    const maxM = actor.role === 'SUPERVISOR' ? 200 : 50;
    const result = await capture.capture({ ownerId: actor.accountId, image: body.image, sampleId: body.sampleId, nonce: body.nonce, kind: body.kind, stage: body.stage, gps: body.gps, motionSamples: body.motionSamples, clientTime: body.clientTime, values: body.values ?? null, near: c ? { latE6: c.location.latE6, lonE6: c.location.lonE6, maxM } : null });
    if (isCaptureFailure(result)) return sendFail(res, httpStatus(result.code) === 400 && result.code !== 'VALIDATION' ? 422 : httpStatus(result.code), result.code, result.message);
    const { ownerId: _owner, sha256OriginalEnc: _enc, ...view } = result;
    res.json({ success: true, data: { ...view, imageUrl: `/api/v5/evidence/${result.id}/image` } });
  });

  // Public derivative only: blurred, EXIF-free. The original is never served.
  router.get('/api/v5/evidence/:id/image', (req, res) => {
    const file = capture.imagePath(req.params.id);
    if (!file) return sendFail(res, 404, 'NOT_FOUND', 'Photo not found.');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.type('jpeg').send(fs.readFileSync(file));
  });

  router.get('/api/v5/evidence/:id', (req, res) => {
    const r = capture.get(req.params.id);
    if (!r) return sendFail(res, 404, 'NOT_FOUND', 'Photo not found.');
    const { ownerId: _owner, sha256OriginalEnc: _enc, gps: _gps, ...view } = r;
    res.json({ success: true, data: { ...view, imageUrl: `/api/v5/evidence/${r.id}/image` } });
  });

  // ---- Routing and map ----------------------------------------------------------------------
  router.get('/api/v5/routing/resolve', (req, res) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return sendFail(res, 400, 'VALIDATION', 'Latitude and longitude are required.');
    const toll = req.query.toll === 'yes' || req.query.toll === 'no' ? (req.query.toll as 'yes' | 'no') : null;
    res.json({ success: true, data: registry.decide(lat, lon, Number(req.query.accuracy) || 25, toll) });
  });

  router.get('/api/v5/public/segments', (req, res) => {
    const box = String(req.query.bbox ?? '').split(',').map(Number);
    if (box.length !== 4 || box.some((n) => !Number.isFinite(n))) return sendFail(res, 400, 'VALIDATION', 'bbox must be south,west,north,east.');
    res.json({ success: true, data: registry.segmentsInBox(box[0], box[1], box[2], box[3]) });
  });

  router.get('/api/v5/public/cases', (_req, res) => {
    const now = new Date().toISOString();
    res.json({ success: true, data: store.list().filter((c) => c.state && c.state !== 'MERGED').map((c) => ({ publicCode: c.publicCode, lat: c.location.latE6 / 1e6, lon: c.location.lonE6 / 1e6, state: c.state, stateLabel: V5_STATE_LABELS[c.state!].en, isDemo: c.isDemo, damageClass: c.damageClass, ladderLevel: ladderStatus(c, now).level })) });
  });

  // ---- Report (citizen and staff) -----------------------------------------------------------
  router.post('/api/v5/cases', writeLimit, async (req, res) => {
    const actor = actorOf(req);
    if (!actor) return sendFail(res, 401, 'UNAUTHENTICATED', 'Start a session first.');
    if (!['CITIZEN', 'FIELD_INSPECTOR', 'COORDINATOR'].includes(actor.role)) return sendFail(res, 403, 'FORBIDDEN', 'Your role cannot send a report.');
    const body = req.body ?? {};
    const mode = body.mode === 'TRACE' ? 'TRACE' : 'SINGLE';
    const lat = Number(body.lat);
    const lon = Number(body.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return sendFail(res, 400, 'VALIDATION', 'No location yet. Move to open sky and wait 10 seconds.');
    const accuracyM = Number(body.accuracyM) || 50;

    const decision = registry.decide(lat, lon, accuracyM, body.toll === 'yes' || body.toll === 'no' ? body.toll : null);
    const now = new Date().toISOString();
    const c0 = store.newCase({
      isDemo: options.demoMode,
      createdAt: now,
      createdBy: { kind: actor.kind === 'DEVICE' ? 'DEVICE' : 'STAFF', ref: store.chain.actorRef(actor.kind, actor.personId ?? actor.accountId), personId: actor.personId },
      mode,
      location: { latE6: Math.round(lat * 1e6), lonE6: Math.round(lon * 1e6), accuracyM },
      captureTrust: 'LIVE_NONCE'
    }, decision.area.region ? REGION_PREFIX[decision.area.region] : 'IDN');

    const claimed = capture.claim(body.evidenceIds, actor.accountId, c0.id);
    if (isCaptureFailure(claimed)) return sendFail(res, httpStatus(claimed.code), claimed.code, claimed.message);
    if (claimed.refs.length === 0) return sendFail(res, 400, 'VALIDATION', 'A report needs at least one photo.');
    const anySample = claimed.refs.some((r) => r.captureTrust === 'DEMO');

    let trace: V5Case['trace'] = null;
    if (mode === 'TRACE') {
      const points = Array.isArray(body.tracePoints) ? body.tracePoints : [];
      const analysis = analyseTrace(points, claimed.refs.length);
      const sampleTrace = options.demoMode && body.demoTrace === true;
      if (!analysis.longEnough && !sampleTrace) return sendFail(res, 400, 'VALIDATION', `Walk at least 10 m. So far ${analysis.lengthM} m.`);
      trace = { lengthM: analysis.lengthM, quality: analysis.quality, points: analysis.points };
    }

    const note = typeof body.note === 'string' ? body.note.slice(0, 500) : null;
    if (note && bannedWordsIn(note).length > 0) return sendFail(res, 400, 'VALIDATION', 'Please describe the damage in neutral words.');

    const submit = store.apply({ ...c0, captureTrust: anySample ? 'DEMO' : 'LIVE_NONCE', note }, { action: 'SUBMIT', evidence: claimed.refs, classGuess: body.classGuess ?? null, sizeBand: body.sizeBand ?? null, trace }, actor, now, 0);
    if ('ok' in submit) return sendFail(res, httpStatus(submit.code), submit.code, submit.message, submit.rule);

    // SYSTEM screening: detection result and routing. It ends in TRIAGE, never in ACCEPTED (SYS-3).
    const begin = store.apply(submit.case, { action: 'BEGIN_SCREENING' }, SYSTEM_ACTOR, now, submit.case.version);
    if ('ok' in begin) return sendFail(res, 500, begin.code, begin.message);
    const records = claimed.records;
    const bestDetection = records.flatMap((r) => r.ai.detections).sort((a, b) => b.confidence - a.confidence)[0] ?? null;
    const aiRan = records.some((r) => r.ai.status === 'REAL');
    const screening: V5Case['screening'] = { status: aiRan ? 'REAL' : 'MODEL_UNAVAILABLE', modelId: records.find((r) => r.ai.modelId)?.ai.modelId ?? null, label: bestDetection?.taxonomyCode ?? null, score: bestDetection?.confidence ?? null };
    const duplicates = store.list().filter((o) => o.id !== begin.case.id && o.state && V5_STATE_LABELS[o.state].open && distanceM(o, begin.case) <= 25).map((o) => o.publicCode);
    const done = store.apply(begin.case, { action: duplicates.length ? 'AUTO_MERGE_SUGGEST' : 'SCREENING_DONE', screening, routing: describeRouting(decision), duplicates }, SYSTEM_ACTOR, now, begin.case.version);
    if ('ok' in done) return sendFail(res, 500, done.code, done.message);
    res.json({ success: true, data: { caseId: done.case.id, publicCode: done.case.publicCode, state: done.case.state, routing: decision, screening, duplicates, eventHash: done.event.event_hash } });
  });

  router.get('/api/v5/cases', (req, res) => {
    const actor = actorOf(req);
    if (!actor) return sendFail(res, 401, 'UNAUTHENTICATED', 'Choose a role first.');
    if (!FULL_READ_ROLES.includes(actor.role)) return sendFail(res, 403, 'FORBIDDEN', 'Staff only.');
    const data = store.list().map((c) => {
      const now = caseNow(c);
      return { ...c, stateLabel: c.state ? V5_STATE_LABELS[c.state].en : null, ladder: ladderStatus(c, now), priority: priorityOf(c, now) };
    }).sort((a, b) => b.priority.score - a.priority.score);
    res.json({ success: true, data });
  });

  router.get('/api/v5/me/cases', (req, res) => {
    const actor = actorOf(req);
    if (!actor) return sendFail(res, 401, 'UNAUTHENTICATED', 'Start a session first.');
    const ref = store.chain.actorRef(actor.kind, actor.personId ?? actor.accountId);
    res.json({ success: true, data: store.list().filter((c) => c.createdBy.ref === ref).map((c) => publicCaseView(c, caseNow(c))) });
  });

  router.get('/api/v5/cases/:id', (req, res) => {
    const found = staffCase(req, res, FULL_READ_ROLES);
    if (!found) return;
    const now = caseNow(found.c);
    res.json({ success: true, data: { ...found.c, stateLabel: found.c.state ? V5_STATE_LABELS[found.c.state].en : null, ladder: ladderStatus(found.c, now), priority: priorityOf(found.c, now), now } });
  });

  // ---- Measure: PINN and cost ---------------------------------------------------------------
  router.post('/api/v5/cases/:id/pinn', writeLimit, async (req, res) => {
    const found = staffCase(req, res, PINN_ROLES);
    if (!found) return;
    const { c, actor } = found;
    const esalYear = Number(req.body?.esalYear);
    if (!Number.isFinite(esalYear) || esalYear <= 0) return sendFail(res, 400, 'VALIDATION', 'Type the traffic load in ESAL per year.');
    const status = c.routing?.roadStatus;
    const roadClass = status === 'NASIONAL' || status === 'TOL' || status === 'PROVINSI' || status === 'KOTA' ? status : 'KABUPATEN';
    const reply = await callInference('POST', '/v1/diagnose', { segment_id: c.id, road_class: roadClass, esal_year: esalYear, n: 2000, observations: { alligator: c.damageClass === 'ALLIGATOR' } }, 60_000);
    const now = new Date().toISOString();
    const baseOptions = REPAIR_OPTIONS[c.damageClass ?? ''] ?? ['HOT_MIX_FULL_DEPTH_PATCH', 'COLD_MIX_TEMPORARY'];
    let run: V5PinnRun;
    if ('unavailable' in reply || !reply.ok) {
      // FI-6.1: the plan can still go ahead, and says the range was not computed.
      run = { id: `PINN-${randomUUID().slice(0, 8)}`, status: 'PINN_UNAVAILABLE', reason: 'The physics service is not reachable.', repairOptions: baseOptions, ranAt: now, esalYear, roadClass };
    } else {
      const b = reply.body as { verdict: string; title: string; confidence: string; samples: number; remaining_life_years: { p10: number; p50: number; p90: number }; solver: { dry: { device: string; openvino: string } } };
      const toMonths = (y: number) => Math.round(y * 12 * 10) / 10;
      const options = b.verdict === 'RED' ? [...new Set([...baseOptions, 'OVERLAY'])] : baseOptions;
      run = { id: `PINN-${randomUUID().slice(0, 8)}`, status: 'COMPUTED', esalYear, roadClass, lifeMonths: { p10: toMonths(b.remaining_life_years.p10), p50: toMonths(b.remaining_life_years.p50), p90: toMonths(b.remaining_life_years.p90) }, verdict: b.verdict, title: b.title, confidence: b.confidence, samples: b.samples, solver: `pi-surrogate-v1, OpenVINO ${b.solver.dry.openvino.split('-')[0]}`, device: b.solver.dry.device, hostLabel: 'HOST_NON_INTEL', repairOptions: options, ranAt: now };
    }
    const payload = { pinn_run_id: run.id, status: run.status, esal_year: Math.round(esalYear), road_class: roadClass, life_days_p10: run.lifeMonths ? Math.round(run.lifeMonths.p10 * 30.44) : null, life_days_p50: run.lifeMonths ? Math.round(run.lifeMonths.p50 * 30.44) : null, life_days_p90: run.lifeMonths ? Math.round(run.lifeMonths.p90 * 30.44) : null };
    const next = store.record(c, { pinnRun: run }, 'pinn.run', payload, actor, now);
    res.json({ success: true, data: { run, case: next } });
  });

  router.post('/api/v5/cases/:id/cost', writeLimit, (req, res) => {
    const found = staffCase(req, res, COST_ROLES);
    if (!found) return;
    const { c, actor } = found;
    const i = c.inspection;
    const mix: Mix = req.body?.mix === 'COLD_MIX' ? 'COLD_MIX' : 'AC_WC';
    const reported = req.body?.reportedSpendIdr === undefined || req.body?.reportedSpendIdr === null || req.body?.reportedSpendIdr === '' ? (c.declared?.reportedSpendIdr ?? null) : Number(req.body.reportedSpendIdr);
    if (reported !== null && (!Number.isFinite(reported) || reported <= 0)) return sendFail(res, 400, 'VALIDATION', 'Reported spend must be a number in rupiah.');
    const isJakarta = c.publicCode.startsWith('JKT');
    let request: CostRequest;
    if (c.mode === 'TRACE' && c.trace) {
      request = { caseId: c.id, mode: 'TRACE', mix, lengthM: c.trace.lengthM, widthM: i?.widthMm ? i.widthMm / 1000 : 3.5, depthCm: i?.depthMmTyped ? i.depthMmTyped / 10 : null, sizeStatus: 'MEASURED', sizeSource: `GPS trace, quality ${c.trace.quality}`, regionName: c.routing?.authorityName ?? 'this area', regionIsJakarta: isJakarta, reportedSpendIdr: reported };
    } else {
      if (!i?.lengthMm || !i?.widthMm) return sendFail(res, 400, 'VALIDATION', 'Record the inspection size first.');
      request = {
        caseId: c.id,
        mode: 'SINGLE',
        mix,
        lengthM: i.lengthMm / 1000,
        widthM: i.widthMm / 1000,
        depthCm: i.depthMmTyped ? i.depthMmTyped / 10 : null,
        sizeStatus: i.areaStatus === 'MEASURED' ? 'MEASURED' : 'AI_ESTIMATE',
        sizeSource: i.areaStatus === 'MEASURED' ? 'Marker card in the photo; typed by the inspector' : 'Typed by the inspector; no marker card found',
        regionName: c.routing?.authorityName ?? 'this area',
        regionIsJakarta: isJakarta,
        reportedSpendIdr: reported,
        reportedSource: 'Declared by the repair crew'
      };
    }
    const output = fairCost(request);
    const now = new Date().toISOString();
    const costId = `COST-${randomUUID().slice(0, 8)}`;
    const stored = { ...output, id: costId, ranAt: now };
    const flags = [...c.flags];
    if (output.comparison?.result === 'NEEDS_CLARIFICATION' && !flags.some((f) => f.code === 'NEEDS_CLARIFICATION_COST' && f.state === 'OPEN')) {
      flags.push(makeFlag('NEEDS_CLARIFICATION_COST', 'W-02', String(Math.abs(output.comparison.diffPct)), '', 'SYSTEM', now));
    }
    const payload = { cost_estimate_id: costId, engine_version: output.engineVersion, price_table_version: output.priceTableVersion, route: output.route, fair_low_idr: output.fairCostIdr?.low ?? null, fair_mid_idr: output.fairCostIdr?.mid ?? null, fair_high_idr: output.fairCostIdr?.high ?? null, reported_spend_idr: reported === null ? null : Math.round(reported), diff_bp: output.comparison ? Math.round(output.comparison.diffPct * 100) : null, result: output.comparison?.result ?? null, inputs_sha256: sha256Hex(canonicalize(output.inputs)) };
    const next = store.record(c, { costRun: stored, flags }, 'cost.estimated', payload, actor, now);
    res.json({ success: true, data: { cost: stored, case: next } });
  });

  // ---- Transitions --------------------------------------------------------------------------
  router.post('/api/v5/cases/:id/transitions', writeLimit, (req, res) => {
    const actor = actorOf(req);
    if (!actor) return sendFail(res, 401, 'UNAUTHENTICATED', 'Choose a role first.');
    const c = store.get(req.params.id);
    if (!c) return sendFail(res, 404, 'NOT_FOUND', 'Case not found.');
    const { action, expectedVersion, evidenceIds, ...rest } = (req.body ?? {}) as Record<string, unknown>;
    if (!V5_ACTIONS.includes(action as V5Action)) return sendFail(res, 400, 'VALIDATION', 'Unknown action.');
    const cmd: V5Command = { ...rest, action: action as V5Action };

    // Fields only the server may set are dropped from the request, then computed here.
    delete cmd.evidence;
    delete cmd.markerDetected;
    delete cmd.rulerCheck;

    let evidenceRefs: EvidenceRef[] = [];
    if (evidenceIds !== undefined) {
      const claimed = capture.claim(evidenceIds, actor.accountId, c.id);
      if (isCaptureFailure(claimed)) return sendFail(res, httpStatus(claimed.code), claimed.code, claimed.message);
      evidenceRefs = claimed.refs;
      cmd.evidence = evidenceRefs;
    }

    // Accounts picked in the UI become people on the server, so SoD compares persons.
    const person = (accountId: unknown) => findDemoAccount(String(accountId ?? ''));
    if (action === 'ASSIGN_INSPECTION') {
      const a = person(cmd.inspectorAccountId);
      if (!a || a.role !== 'FIELD_INSPECTOR') return sendFail(res, 400, 'VALIDATION', 'Choose a Field Inspector.');
      cmd.inspectorPersonId = a.personId;
    }
    if (action === 'ISSUE_WORK_ORDER') {
      const crew = person(cmd.crewAccountId);
      const sup = person(cmd.supervisorAccountId);
      if (!crew || crew.role !== 'REPAIR_CREW') return sendFail(res, 400, 'VALIDATION', 'Choose a repair crew.');
      if (!sup || sup.role !== 'SUPERVISOR') return sendFail(res, 400, 'VALIDATION', 'Choose a supervisor.');
      Object.assign(cmd, { crewPersonId: crew.personId, crewOrgId: crew.orgId, supervisorPersonId: sup.personId, supervisorOrgId: sup.orgId, category: c.plan?.category });
    }
    if (action === 'SUBMIT_INSPECTION') {
      const markers = evidenceRefs.filter((e) => e.kind === 'MARKER_NADIR').map((e) => capture.get(e.id)?.marker);
      cmd.markerDetected = markers.some((m) => m?.found === true);
      // No ruler-reading model exists yet, so the honest status is "check by eye" (FI-3.2).
      cmd.rulerCheck = 'AI_UNREADABLE';
    }
    // The crew saves stage photos one by one; these commands then use the saved checklist.
    if (rest.useSavedStages === true) {
      delete cmd.useSavedStages;
      cmd.evidence = c.evidence.filter((e) => e.kind === 'WORK_STAGE');
    }
    delete cmd.declared;
    if (action === 'PROPOSE_PLAN' || action === 'PROMOTE_TO_PERMANENT') {
      // Quantities always come from recorded measurements (FI-7.1).
      const run = c.costRun;
      if (run) {
        const areaCm2 = Math.round(run.quantity.areaCutM2.mid * 10000);
        const thicknessMm = Math.round(run.quantity.depthRepairCm * 10);
        Object.assign(cmd, { areaCm2, thicknessMm, volumeCm3: (areaCm2 * thicknessMm) / 10, costEstimateId: run.id });
      }
      cmd.pinnRunId = c.pinnRun?.status === 'COMPUTED' ? c.pinnRun.id : null;
    }

    const now = new Date().toISOString();
    const outcome = store.apply(c, cmd, actor, now, Number(expectedVersion), { mergeTargetOk: (id) => { const t = store.get(id); return !!t && !!t.state && V5_STATE_LABELS[t.state].open && (t.routing?.segmentId === c.routing?.segmentId || distanceM(t, c) <= 25); } });
    if ('ok' in outcome) return respondOutcome(res, outcome);

    let next = outcome.case;
    const flags: V5Flag[] = [];
    if (action === 'SUBMIT_WORK_EVIDENCE') {
      const declared = readDeclared(rest.declared);
      for (const e of next.evidence) {
        const t = Number(e.values?.temperatureC);
        if (e.stage === 'MIX_TEMP_MAT' && Number.isFinite(t) && t < SPEND_LOWER_LIMIT_C) flags.push(makeFlag('LOW_MIX_TEMPERATURE', 'W-06', String(t), '', 'SYSTEM', now));
      }
      if (declared.tonnageKg && next.plan) {
        // RC-3.1: ASSUMED density 2.3 t/m³ unless a JMF is given; more than 15% is a question, not a rejection.
        const expectedKg = (next.plan.volumeCm3 / 1e6) * 2300;
        const diff = Math.abs(declared.tonnageKg - expectedKg) / expectedKg;
        if (diff > 0.15) flags.push(makeFlag('QUANTITY_DIFFERENCE', 'W-07', String(Math.round(diff * 100)), 'Density 2.3 t/m³ ASSUMED', 'SYSTEM', now));
      }
      next = store.record(next, { declared, flags: [...next.flags, ...flags] }, 'work.declared', { area_cm2: declared.areaCm2, thickness_mm: declared.thicknessMm, tonnage_kg: declared.tonnageKg, reported_spend_idr: declared.reportedSpendIdr, flags: flags.map((f) => f.code) }, actor, now);
    }
    if (action === 'RECORD_FOLLOW_UP') next = afterFollowUp(next, rest, now);
    res.json({ success: true, data: { case: next, event: { seq: outcome.event.seq, event_hash: outcome.event.event_hash, type: outcome.event.type } } });
  });

  /** SOD-10 and failures found on follow-up reopen the case through the same state machine. */
  const afterFollowUp = (c: V5Case, cmd: Record<string, unknown>, now: string): V5Case => {
    const answers = c.citizenConfirmations.map((a) => ({ result: a.result, deviceRef: a.deviceRef, withPhoto: a.withPhoto }));
    const inspectorFound = cmd.result === 'DEFECT';
    const citizens = cmd.result === 'DAMAGED' && citizenDisputeTriggersInspection(answers) && answers.some((a) => a.withPhoto);
    if (!inspectorFound && !citizens) return c;
    const reopened = store.apply(c, { action: 'REOPEN', reason: inspectorFound ? 'An inspector recorded a defect on follow-up.' : 'Two devices reported damage again, one with a photo.' }, SYSTEM_ACTOR, now, c.version);
    if ('ok' in reopened) return c;
    let next = reopened.case;
    if (next.warrantyFlag && !next.flags.some((f) => f.code === 'EARLY_FAILURE_IN_MAINTENANCE')) {
      next = store.record(next, { flags: [...next.flags, makeFlag('EARLY_FAILURE_IN_MAINTENANCE', 'W-03', '', '', 'SYSTEM', now)] }, 'flag.created', { code: 'EARLY_FAILURE_IN_MAINTENANCE', wording_id: 'W-03' }, SYSTEM_ACTOR, now);
    }
    return next;
  };

  // Stage photo saved as it is taken, so the crew's checklist survives a closed browser.
  router.post('/api/v5/cases/:id/stage-evidence', writeLimit, (req, res) => {
    const found = staffCase(req, res, ['REPAIR_CREW', 'SUPERVISOR']);
    if (!found) return;
    const { c, actor } = found;
    const assigned = actor.role === 'REPAIR_CREW' ? c.workOrder?.crewAccountId : c.workOrder?.supervisorAccountId;
    if (assigned !== actor.accountId) return sendFail(res, 403, 'FORBIDDEN', 'This work order is assigned to someone else.');
    const claimed = capture.claim([req.body?.evidenceId], actor.accountId, c.id);
    if (isCaptureFailure(claimed)) return sendFail(res, httpStatus(claimed.code), claimed.code, claimed.message);
    const [ref] = claimed.refs;
    const values = sanitizeValues(req.body?.values);
    const updated = { ...ref, values };
    const evidence = [...c.evidence.filter((e) => !(e.kind === 'WORK_STAGE' && e.stage === ref.stage)), updated];
    const next = store.record(c, { evidence }, 'work.stage_evidence', { stage: ref.stage, values: integerValues(values) }, actor, new Date().toISOString(), [ref.sha256]);
    res.json({ success: true, data: { case: next } });
  });

  // First sustained heavy rain has no sourced threshold (TODO_VERIFY), so a person records it.
  router.post('/api/v5/cases/:id/heavy-rain', writeLimit, (req, res) => {
    const found = staffCase(req, res, ['COORDINATOR']);
    if (!found) return;
    const { c, actor } = found;
    if (!c.followUps.some((f) => f.milestone === 'HEAVY_RAIN')) return sendFail(res, 409, 'INVALID_TRANSITION', 'This case has no heavy-rain follow-up.');
    const now = caseNow(c);
    const next = store.record(c, { followUps: c.followUps.map((f) => (f.milestone === 'HEAVY_RAIN' && !f.dueAt ? { ...f, dueAt: now } : f)) }, 'follow_up.scheduled', { milestone: 'HEAVY_RAIN', source: 'INPUT' }, actor, new Date().toISOString());
    res.json({ success: true, data: { case: next } });
  });

  // ---- Flags --------------------------------------------------------------------------------
  router.post('/api/v5/cases/:id/flags', writeLimit, (req, res) => {
    const found = staffCase(req, res, FLAG_ROLES);
    if (!found) return;
    const { c, actor } = found;
    const wordingId = String(req.body?.wordingId ?? '');
    if (!(wordingId in wordingLibrary.wordings)) return sendFail(res, 400, 'VALIDATION', 'Choose wording from the neutral library.');
    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 400) : '';
    const banned = bannedWordsIn(note);
    if (banned.length > 0) return sendFail(res, 400, 'VALIDATION', `Please use neutral wording. Avoid: ${banned.join(', ')}. Try "needs clarification".`);
    const now = new Date().toISOString();
    const flag = makeFlag(String(req.body?.code ?? 'AUDITOR_NOTE'), wordingId, String(req.body?.value ?? ''), note, actor.role, now);
    const next = store.record(c, { flags: [...c.flags, flag] }, 'flag.created', { code: flag.code, wording_id: wordingId, target_type: 'case', note }, actor, now);
    res.json({ success: true, data: { case: next, flag } });
  });

  // ---- Event log and verification -----------------------------------------------------------
  router.get('/api/v5/cases/:id/events', (req, res) => {
    const found = staffCase(req, res, FULL_READ_ROLES);
    if (!found) return;
    res.json({ success: true, data: { events: store.eventsFor(found.c.id, found.c.chainId), verify: store.verify(found.c.chainId) } });
  });

  router.get('/api/v5/public/track/:code', (req, res) => {
    const c = store.byPublicCode(req.params.code);
    if (!c) return sendFail(res, 404, 'NOT_FOUND', 'No report has this code.');
    res.json({ success: true, data: publicCaseView(c, caseNow(c), store.eventsFor(c.id, c.chainId)) });
  });

  // Citizen confirmation works from the public page: a device key, no login (02 C-8).
  router.post('/api/v5/public/track/:code/confirm', writeLimit, (req, res) => {
    const actor = actorOf(req);
    if (!actor || actor.kind !== 'DEVICE') return sendFail(res, 401, 'UNAUTHENTICATED', 'Open the citizen view first.');
    const c = store.byPublicCode(req.params.code);
    if (!c) return sendFail(res, 404, 'NOT_FOUND', 'No report has this code.');
    const open = c.followUps.find((f) => !f.result && !c.citizenConfirmations.some((a) => a.milestone === f.milestone && a.deviceRef === actor.accountId));
    if (!open) return sendFail(res, 409, 'INVALID_TRANSITION', 'You already answered every follow-up for now.');
    const claimed = capture.claim(req.body?.evidenceIds ?? [], actor.accountId, c.id);
    if (isCaptureFailure(claimed)) return sendFail(res, httpStatus(claimed.code), claimed.code, claimed.message);
    const result = req.body?.result === 'DAMAGED' ? 'DAMAGED' : 'OK';
    const now = new Date().toISOString();
    const outcome = store.apply(c, { action: 'RECORD_FOLLOW_UP', milestone: open.milestone, result, evidence: claimed.refs }, actor, now, c.version);
    if ('ok' in outcome) return respondOutcome(res, outcome);
    const next = afterFollowUp(outcome.case, { result }, now);
    res.json({ success: true, data: publicCaseView(next, caseNow(next), store.eventsFor(next.id, next.chainId)) });
  });

  // C-9: only logged facts, neutral wording, never sent automatically.
  router.get('/api/v5/public/track/:code/complaint-draft', (req, res) => {
    const c = store.byPublicCode(req.params.code);
    if (!c) return sendFail(res, 404, 'NOT_FOUND', 'No report has this code.');
    const ladder = ladderStatus(c, caseNow(c));
    if (ladder.level !== 'COMPLAINT') return sendFail(res, 409, 'INVALID_TRANSITION', 'A complaint draft opens after 30 days without handling.');
    const text = [
      'DRAF PENGADUAN (dibuat dari catatan peristiwa; periksa sebelum dikirim; tidak dikirim otomatis)',
      c.isDemo ? 'DEMO — BUKAN DATA NYATA' : '',
      `Kode laporan: ${c.publicCode}`,
      `Lokasi: ${(c.location.latE6 / 1e6).toFixed(5)}, ${(c.location.lonE6 / 1e6).toFixed(5)}${c.routing?.segmentName ? ` (${c.routing.segmentName})` : ''}`,
      `Instansi penerima: ${c.routing?.officeName ?? '-'}`,
      `Status saat ini: ${c.state ? V5_STATE_LABELS[c.state].id : '-'}`,
      `Menunggu: ${ladder.daysWaiting} hari sejak laporan diterima`,
      '',
      'Mohon klarifikasi dan tindak lanjut atas laporan ini. Dokumen ini berisi fakta tercatat dan bukan tuduhan terhadap pihak mana pun.',
      'Kanal yang dapat digunakan: SP4N-LAPOR! atau Ombudsman RI.'
    ].filter(Boolean).join('\n');
    res.type('text/plain; charset=utf-8').setHeader('Content-Disposition', `attachment; filename="draf-pengaduan-${c.publicCode}.txt"`);
    res.send(text);
  });

  router.get('/api/v5/public/chain/:chainId/verify', (req, res) => {
    const chainId = req.params.chainId as ChainId;
    if (chainId !== 'prod' && chainId !== 'demo') return sendFail(res, 404, 'NOT_FOUND', 'Unknown chain.');
    res.json({ success: true, data: store.verify(chainId) });
  });

  // DEMO: shows what tampering does, on a copy. The stored log is not touched.
  router.post('/api/v5/demo/tamper-simulate', writeLimit, (req, res) => {
    if (!options.demoMode) return sendFail(res, 404, 'NOT_FOUND', 'Demo tools are off.');
    const text = store.chain.readText('demo');
    const lines = text.split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) return sendFail(res, 409, 'INVALID_TRANSITION', 'The log is empty.');
    const seq = Math.min(lines.length, Math.max(1, Number(req.body?.seq) || Math.ceil(lines.length / 2)));
    const event = JSON.parse(lines[seq - 1]) as ChainEvent;
    event.server_received_at = new Date(new Date(event.server_received_at).getTime() - DAY_MS).toISOString();
    lines[seq - 1] = JSON.stringify(event);
    res.json({ success: true, data: { simulated: true, changedSeq: seq, changedField: 'server_received_at (one day earlier)', report: verifyChainText('demo', `${lines.join('\n')}\n`, store.chain.publicKey), storedLog: store.verify('demo') } });
  });

  router.post('/api/v5/demo/fast-forward', writeLimit, (req, res) => {
    if (!options.demoMode) return sendFail(res, 404, 'NOT_FOUND', 'Demo tools are off.');
    const actor = actorOf(req);
    if (!actor) return sendFail(res, 401, 'UNAUTHENTICATED', 'Choose a role first.');
    const c = store.byPublicCode(String(req.body?.code ?? ''));
    if (!c) return sendFail(res, 404, 'NOT_FOUND', 'No report has this code.');
    const days = Number(req.body?.days);
    if (!Number.isInteger(days) || days < 1 || days > 400) return sendFail(res, 400, 'VALIDATION', 'Days must be 1 to 400.');
    const next = store.record(c, { demoClockDays: c.demoClockDays + days }, 'demo.time_advanced', { days, total_days: c.demoClockDays + days }, SYSTEM_ACTOR, new Date().toISOString());
    res.json({ success: true, data: publicCaseView(next, caseNow(next), store.eventsFor(next.id, next.chainId)) });
  });

  // ---- Documents ----------------------------------------------------------------------------
  router.post('/api/v5/documents/audit-report', writeLimit, async (req, res) => {
    const actor = actorOf(req);
    if (!actor) return sendFail(res, 401, 'UNAUTHENTICATED', 'Choose a role first.');
    if (!DOCUMENT_ROLES.includes(actor.role)) return sendFail(res, 403, 'FORBIDDEN', 'Your role cannot issue this report.');
    const c = store.get(String(req.body?.caseId ?? ''));
    if (!c) return sendFail(res, 404, 'NOT_FOUND', 'Case not found.');
    try {
      const doc = await issueReport(c, actor, originOf(req));
      res.json({ success: true, data: publicDoc(doc) });
    } catch (e) {
      sendFail(res, 503, 'DOCUMENT_FAILED', `The report could not be printed: ${(e as Error).message}`);
    }
  });

  const originOf = (req: Request) => process.env.PUBLIC_URL || `${req.get('x-forwarded-proto') ?? req.protocol}://${req.get('x-forwarded-host') ?? req.get('host')}`;

  const publicDoc = (d: IssuedDocument) => {
    const { filePath: _file, ...rest } = d;
    return { ...rest, pdfUrl: `/api/v5/documents/${d.id}/pdf`, verifyUrl: `/v/${d.id}` };
  };

  const issueReport = async (c: V5Case, actor: V5Actor, origin: string): Promise<IssuedDocument> => {
    const chainId = c.chainId;
    const verified = store.verify(chainId);
    if (!verified.ok) throw new Error('the event log failed verification');
    const caseEvents = store.eventsFor(c.id, chainId).filter((e) => e.type !== 'document.issued');
    const prior = store.documentsFor(c.id);
    const latest = prior[prior.length - 1];
    const lastCaseSeq = caseEvents[caseEvents.length - 1]?.seq ?? 0;
    // Same facts, same document: a re-issue only happens when the record changed.
    if (latest && latest.snapshot.lastCaseSeq === lastCaseSeq) return latest;

    const all = store.chain.events(chainId);
    const hashes = all.map((e) => e.event_hash);
    const checkpoint = store.addCheckpoint(chainId, hashes, new Date().toISOString());
    const version = (latest?.version ?? 0) + 1;
    const docId = `DOC-${c.publicCode}-v${version}`;
    const snapshot = { chainId, firstSeq: 1, lastSeq: hashes.length, root: checkpoint.root, period: checkpoint.period, time: checkpoint.time };
    const verifyUrl = `${origin}/v/${docId}`;
    const office = officeDirectory(c.routing?.officeId ?? null);
    const evidenceHashes = c.evidence.map((e) => ({ label: `${e.kind}${e.stage ? ` ${e.stage}` : ''}`, sha256Public: e.sha256, sha256Enc: capture.get(e.id)?.sha256OriginalEnc ?? null }));
    const values = buildPlaceholders({ docId, version, supersedes: latest?.id ?? null, c, events: caseEvents, evidenceHashes, snapshot, verifyUrl, authorityAddress: office.address, authorityContact: office.contact }, await qrFor(verifyUrl));
    const html = renderTemplate(values);
    const banned = reportProblems(html);
    if (banned.length > 0) throw new Error(`neutral wording check failed: ${banned.join(', ')}`);
    const pdf = await htmlToPdf(html, path.join(dir, 'tmp'), snapshot.time);
    const sha256 = createHash('sha256').update(pdf).digest('hex');
    const docsDir = path.join(dir, 'documents');
    fs.mkdirSync(docsDir, { recursive: true });
    const filePath = path.join(docsDir, `${docId}.pdf`);
    fs.writeFileSync(filePath, pdf);
    const doc: IssuedDocument = { id: docId, kind: 'AUDIT_REPORT', caseId: c.id, publicCode: c.publicCode, version, supersedes: latest?.id ?? null, supersededBy: null, sha256, issuedAt: snapshot.time, isDemo: c.isDemo, filePath, snapshot: { ...snapshot, lastCaseSeq } };
    store.addDocument(doc);
    store.record(c, {}, 'document.issued', { doc_id: docId, kind: 'AUDIT_REPORT', version, sha256_unsigned: sha256, snapshot_root: snapshot.root, snapshot_last_seq: snapshot.lastSeq, supersedes: latest?.id ?? null }, actor, new Date().toISOString());
    return doc;
  };

  const directory = new Map<string, Record<string, string>>();
  for (const name of ['authorities_jakarta.csv', 'authorities_national_balai.csv']) {
    for (const row of parseCsv(fs.readFileSync(path.join(process.cwd(), 'docs', 'v5', 'data', name), 'utf8'))) directory.set(row.id, row);
  }
  const officeDirectory = (id: string | null) => {
    const row = id ? directory.get(id) ?? directory.get(id.replace(/^satpel-bm-([a-z]+)-.*/, 'sudin-bm-$1')) : null;
    return { address: row?.address || 'Alamat kantor belum terverifikasi', contact: [row?.phone, row?.email].filter(Boolean).join(' · ') || 'Kontak belum terverifikasi' };
  };

  router.get('/api/v5/documents', (req, res) => {
    const actor = actorOf(req);
    if (!actor || !FULL_READ_ROLES.includes(actor.role)) return sendFail(res, 403, 'FORBIDDEN', 'Staff only.');
    res.json({ success: true, data: store.documents().map(publicDoc) });
  });

  router.get('/api/v5/documents/:id/pdf', (req, res) => {
    const d = store.document(req.params.id);
    if (!d || !fs.existsSync(d.filePath)) return sendFail(res, 404, 'NOT_FOUND', 'Document not found.');
    res.setHeader('Content-Disposition', `inline; filename="${d.id}.pdf"`);
    res.type('application/pdf').send(fs.readFileSync(d.filePath));
  });

  router.get('/api/v5/public/verify/:docId', (req, res) => {
    const d = store.document(req.params.docId);
    if (!d) return sendFail(res, 404, 'NOT_FOUND', 'No document has this ID.');
    const chain = store.verify(d.snapshot.chainId as ChainId);
    const all = store.chain.events(d.snapshot.chainId as ChainId);
    const hashes = all.slice(0, d.snapshot.lastSeq).map((e) => e.event_hash);
    const rootMatches = hashes.length === d.snapshot.lastSeq && merkleRoot(hashes) === d.snapshot.root;
    const caseEvents = all.filter((e) => e.entity.id === d.caseId && e.seq <= d.snapshot.lastSeq);
    const issued = all.find((e) => e.type === 'document.issued' && e.payload.doc_id === d.id) ?? null;
    const fileBytes = fs.existsSync(d.filePath) ? fs.readFileSync(d.filePath) : null;
    const fileMatchesLog = !!fileBytes && !!issued && createHash('sha256').update(fileBytes).digest('hex') === issued.payload.sha256_unsigned;
    const last = caseEvents[caseEvents.length - 1];
    res.json({
      success: true,
      data: {
        docId: d.id,
        kind: d.kind,
        version: d.version,
        issuedAt: d.issuedAt,
        sha256: d.sha256,
        supersededBy: store.documentsFor(d.caseId).find((o) => o.supersedes === d.id)?.id ?? null,
        isDemo: d.isDemo,
        publicCode: d.publicCode,
        snapshot: { chainId: d.snapshot.chainId, lastSeq: d.snapshot.lastSeq, root: d.snapshot.root, period: d.snapshot.period },
        checks: { eventLogIntact: chain.ok, firstFailure: chain.firstFailure, truncated: chain.truncated, checkpointRootMatches: rootMatches, issuedEventFound: !!issued, storedFileMatchesLog: fileMatchesLog, caseEventsCovered: caseEvents.length },
        inclusionProof: last ? { eventHash: last.event_hash, seq: last.seq, path: inclusionProof(hashes, last.seq - 1) } : null,
        ots: { status: d.isDemo ? 'NOT_ANCHORED_DEMO' : 'NOT_ANCHORED', note: d.isDemo ? 'A demo chain is never anchored to Bitcoin.' : 'OpenTimestamps anchoring is not switched on yet.' },
        pdfUrl: `/api/v5/documents/${d.id}/pdf`,
        proves: 'The document has not changed since it was issued, and the records it uses were in our log at that time.',
        doesNotProve: 'That the observations are correct. Agencies verify on site.'
      }
    });
  });

  // ---- Measurements: only what scripts wrote; anything else is "not measured yet" ------------
  router.get('/api/v5/public/measurements', (_req, res) => {
    const measureDir = path.join(process.cwd(), 'measurements');
    const files = fs.existsSync(measureDir) ? fs.readdirSync(measureDir).filter((f) => f.endsWith('.json')).sort() : [];
    const data = files.map((name) => {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(measureDir, name), 'utf8'));
        return { file: name, ok: true, json: j };
      } catch {
        return { file: name, ok: false, json: null };
      }
    });
    res.json({ success: true, data });
  });

  // ---- Agency head and admin: read real records ----------------------------------------------
  router.get('/api/v5/dashboard/agency', (req, res) => {
    const actor = actorOf(req);
    if (!actor || !['AGENCY_HEAD', 'COORDINATOR', 'APPROVER', 'AUDITOR'].includes(actor.role)) return sendFail(res, 403, 'FORBIDDEN', 'Your role cannot see this.');
    const rows = store.list().map((c) => ({ c, ladder: ladderStatus(c, caseNow(c)) }));
    const byLevel = (level: string) => rows.filter((r) => r.ladder.level === level).length;
    res.json({ success: true, data: {
      totalCases: rows.length,
      open: rows.filter((r) => r.c.state && V5_STATE_LABELS[r.c.state].open).length,
      underWatch: rows.filter((r) => r.c.state === 'MONITORING').length,
      levels: { COORDINATOR: byLevel('COORDINATOR'), AGENCY_HEAD: byLevel('AGENCY_HEAD'), PUBLIC: byLevel('PUBLIC'), COMPLAINT: byLevel('COMPLAINT') },
      escalated: rows.filter((r) => r.ladder.level === 'AGENCY_HEAD' || r.ladder.level === 'PUBLIC' || r.ladder.level === 'COMPLAINT').map((r) => ({ id: r.c.id, publicCode: r.c.publicCode, stateLabel: r.c.state ? V5_STATE_LABELS[r.c.state].en : '', daysWaiting: r.ladder.daysWaiting, level: r.ladder.level, office: r.c.routing?.officeName ?? null, delay: r.c.pending?.code ?? null, version: r.c.version })),
      overlaps: store.chain.events('demo').filter((e) => e.actor.overlap_basis).length + store.chain.events('prod').filter((e) => e.actor.overlap_basis).length
    } });
  });

  router.get('/api/v5/admin/overview', (req, res) => {
    const actor = actorOf(req);
    if (!actor || actor.role !== 'ADMIN') return sendFail(res, 403, 'FORBIDDEN', 'Region admins only.');
    const data = path.join(process.cwd(), 'docs', 'v5', 'data');
    const prices = parseCsv(fs.readFileSync(path.join(data, 'material_prices.csv'), 'utf8'));
    const ump = parseCsv(fs.readFileSync(path.join(data, 'ump_2026.csv'), 'utf8'));
    const umk = parseCsv(fs.readFileSync(path.join(data, 'umk_2026.csv'), 'utf8'));
    const countBy = (rows: Record<string, string>[], key: string) => rows.reduce<Record<string, number>>((acc, r) => { acc[r[key] || 'unknown'] = (acc[r[key] || 'unknown'] ?? 0) + 1; return acc; }, {});
    const offices = [...directory.values()];
    res.json({ success: true, data: {
      registry: { version: registry.version, available: registry.available, attribution: 'Road geometry © OpenStreetMap contributors (ODbL). Class only; legal status from decrees is TODO_VERIFY.' },
      offices: { total: offices.length, byStatus: countBy(offices, 'status'), list: offices.slice(0, 40).map((o) => ({ id: o.id, name: o.name, type: o.type, status: o.status })) },
      prices: { total: prices.length, byStatus: countBy(prices, 'status'), list: prices.filter((p) => p.price_idr).slice(0, 30).map((p) => ({ id: p.price_id, item: p.item, unit: p.unit, priceIdr: Number(p.price_idr), region: p.region_or_supply_point, status: p.status, source: p.source })) },
      wages: { ump: ump.length, umkTodo: umk.filter((u) => u.status === 'TODO_VERIFY').length },
      note: 'Editing is not built yet. These tables come straight from docs/v5/data, each row with its source and status.'
    } });
  });

  // Everything the 60-second tour shows comes from the seeded case's real records.
  router.get('/api/v5/demo/tour', async (req, res) => {
    if (!options.demoMode) return sendFail(res, 404, 'NOT_FOUND', 'The tour runs in demo mode only.');
    const c = store.list().find((x) => x.isDemo && x.state === 'MONITORING' && x.publicCode.startsWith('JKT')) ?? null;
    if (!c) return sendFail(res, 409, 'INVALID_TRANSITION', 'The sample case is still loading. Try again in a minute.');
    const first = c.evidence.find((e) => e.kind === 'OVERVIEW');
    const rec = first ? capture.get(first.id) : null;
    let doc: IssuedDocument | null = store.documentsFor(c.id).slice(-1)[0] ?? null;
    if (!doc) {
      try {
        doc = await issueReport(c, actorFor(findDemoAccount('ACC-AUDIT')!), originOf(req));
      } catch {
        doc = null;
      }
    }
    res.json({ success: true, data: {
      case: publicCaseView(store.get(c.id)!, caseNow(c), store.eventsFor(c.id, c.chainId)),
      photo: rec ? { id: rec.id, detections: rec.ai.detections, width: rec.ai.width, height: rec.ai.height } : null,
      inspection: c.inspection,
      pinn: c.pinnRun,
      cost: c.costRun,
      stages: c.evidence.filter((e) => e.kind === 'WORK_STAGE' && e.stage !== 'SUPERVISOR_AFTER').map((e) => e.stage),
      doc: doc ? publicDoc(doc) : null
    } });
  });

  if (options.demoMode && options.seed !== false) seedDemoCases({ store, capture, registry }).catch((e) => console.error('[v5] demo seed failed:', e));

  return { store, capture, registry };
}

function distanceM(a: V5Case, b: V5Case): number {
  const dy = ((a.location.latE6 - b.location.latE6) / 1e6) * 111_320;
  const dx = ((a.location.lonE6 - b.location.lonE6) / 1e6) * 111_320 * Math.cos(((a.location.latE6 / 1e6) * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

export function makeFlag(code: string, wordingId: string, value: string, note: string, role: string, now: string): V5Flag {
  const entry = (wordingLibrary.wordings as Record<string, { id: string; en: string }>)[wordingId];
  return { id: `FLAG-${randomUUID().slice(0, 8)}`, code, wordingId, text: entry.id.replace('«x»', value), note, createdByRole: role, createdAt: now, state: 'OPEN' };
}

function readDeclared(raw: unknown): NonNullable<V5Case['declared']> {
  const d = (raw ?? {}) as Record<string, unknown>;
  const int = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);
  return { areaCm2: int(d.areaCm2), thicknessMm: int(d.thicknessMm), tonnageKg: int(d.tonnageKg), reportedSpendIdr: int(d.reportedSpendIdr) };
}

function sanitizeValues(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 8)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 80);
  }
  return out;
}

/** Log payloads hold integers only (07 §2.1); typed decimals are rounded for the log. */
function integerValues(values: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!values) return null;
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v) : v]));
}
