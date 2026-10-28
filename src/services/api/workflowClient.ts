/**
 * Browser access to the report workflow.
 *
 * `HttpWorkflowGateway` talks to the Express API, which is authoritative: it decides the
 * actor from its own signed session token and persists every change before answering.
 *
 * `OfflineWorkflowGateway` runs the same domain service in the browser, in memory, for
 * the static GitHub Pages build where no API exists. The UI shows a visible
 * "offline demo" label in that mode; nothing there is persisted or authorized by a server.
 */
import { WORKFLOW_API_PATHS } from '../../types';
import type { AccountProfile, DamageReport, EngineAssessRequest, EngineAssessResult, UserRole } from '../../types';
import { apiUrl, isStaticHost } from './client';
import type { Actor, ReportCase, WorkflowAction } from '../../domain/workflow/model';
import { availableActions, type WorkflowCommand } from '../../domain/workflow/stateMachine';
import { toPublicView, type PublicReportView } from '../../domain/workflow/projections';
import { MemoryCaseStore, WorkflowService, type AuditEvent, type ServiceResult } from '../../domain/workflow/service';
import { DEMO_CV_PROVIDER } from '../../domain/workflow/screening';
import { canEditReport, isOfficialRole } from '../../domain/access';
import type { ReportDraft } from '../../domain/reports/reportFactory';
import type { RoadSegment } from '../../types';
import { assessSegment, snapshotOf, ENGINE_INPUT_RANGES, type AssessmentInputs, type EngineeringAssessment } from '../../domain/intelligence/assessment';
import { explainAssessment, type StructuredExplanation } from '../../domain/intelligence/explain';
import { runWhatIf, type WhatIfResult } from '../../domain/intelligence/whatIf';
import { buildRoadStory, type StoryEntry } from '../../domain/intelligence/roadStory';

export type GatewayMode = 'SERVER' | 'OFFLINE_DEMO';

export type ReportView =
  | { audience: 'STAFF'; case: ReportCase; availableActions: WorkflowAction[]; canEdit: boolean; isMine?: boolean }
  | { audience: 'PUBLIC'; case: PublicReportView; availableActions: WorkflowAction[]; canEdit: boolean; isMine?: boolean };

export interface EngineerSummary {
  id: string;
  name: string;
  title: string;
  agencyCode: string;
}

export class WorkflowApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = 'WorkflowApiError';
  }
}

export interface LoginCredentials {
  /** Username or demo email. */
  username: string;
  password: string;
  /** Interface to open for official demo accounts; default is the modern app. */
  layout?: 'MODERN_APP' | 'CLASSIC_PORTAL';
}

/**
 * Checks demo credentials in the browser for the static demo build, where no server
 * exists. Returns the account id they open, or null. Only provided when demo access is
 * explicitly enabled for the build (src/features/authentication/demoAccess.ts).
 */
export type OfflineCredentialVerifier = (credentials: LoginCredentials) => Promise<string | null>;

/** The account the UI is acting as; `null` means an anonymous visitor. */
export interface SessionAccount {
  id: string;
  role: UserRole;
}

/** A started session: the actor, and the registered account's profile (null for test fixtures). */
export interface SignedIn {
  actor: Actor;
  account: AccountProfile | null;
}

export interface WorkflowGateway {
  readonly mode: GatewayMode;
  /** Check credentials and start a session for the account they open. */
  login(credentials: LoginCredentials): Promise<SignedIn>;
  /** Create a citizen account and sign it in. */
  register(input: { email: string; name: string; password: string }): Promise<SignedIn>;
  /** End the signed-in session: forgotten here at once; settles once the server has revoked it. */
  logout(): Promise<void>;
  /** Called when the server refuses a signed-in session as ended (2-hour limit or logged out elsewhere). */
  onSessionEnded(listener: (() => void) | null): void;
  /**
   * Resume the session for this account, or start an anonymous one when null. A named
   * account needs a session from `login`; without one this fails with UNAUTHENTICATED
   * instead of creating a session from the account id.
   */
  useAccount(account: SessionAccount | null): Promise<Actor>;
  listReports(): Promise<ReportView[]>;
  getReport(id: string): Promise<ReportView>;
  submit(draft: ReportDraft): Promise<{ view: ReportView; claimToken: string | null }>;
  transition(id: string, command: WorkflowCommand, expectedVersion: number): Promise<ReportView>;
  editContent(id: string, patch: Partial<DamageReport>, expectedVersion: number): Promise<ReportView>;
  audit(entityId?: string): Promise<AuditEvent[]>;
  engineers(): Promise<EngineerSummary[]>;
  assessment(segmentId: string): Promise<{ assessment: EngineeringAssessment; explanation: StructuredExplanation }>;
  story(segmentId: string): Promise<{ audience: 'STAFF' | 'PUBLIC'; story: StoryEntry[]; note: string }>;
  simulate(segmentId: string, scenario: Partial<AssessmentInputs>): Promise<WhatIfResult>;
  /** Layered-elastic assessment + Monte Carlo from the Python inference service (M1–M2). */
  engineAssess(body: EngineAssessRequest): Promise<EngineAssessResult>;
}

/** Display report for any view (staff or public). */
export function displayReport(view: ReportView): DamageReport {
  const c = view.case as ReportCase | PublicReportView;
  return c.report;
}

/** Intelligence endpoints (server/routes/intelligence.routes.ts). */
export const INTELLIGENCE_PATHS = {
  assessment: '/api/road-segments/:id/assessment',
  simulations: '/api/simulations',
  engineAssess: '/api/engine/assess'
} as const;

const TOKEN_KEY = 'pavement-pinn.workflow-session';
/** Static demo build: account id of the last successful credential check in this tab. */
const OFFLINE_LOGIN_KEY = 'pavement-pinn.offline-login';
const CLAIMS_KEY = 'pavement-pinn.report-claims';

function readStorage(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the session lives in memory only.
  }
}

/** Claim tokens of reports this browser tab submitted anonymously (shown once by the server). */
export function rememberClaim(reportId: string, claimToken: string): void {
  const claims = JSON.parse(readStorage(CLAIMS_KEY) || '{}') as Record<string, string>;
  claims[reportId] = claimToken;
  writeStorage(CLAIMS_KEY, JSON.stringify(claims));
}

export function claimFor(reportId: string): string | null {
  try {
    return (JSON.parse(readStorage(CLAIMS_KEY) || '{}') as Record<string, string>)[reportId] ?? null;
  } catch {
    return null;
  }
}

function pathFor(template: string, id: string): string {
  return template.replace(':id', encodeURIComponent(id));
}

/*
 * Sessions on the server gateway:
 * - Signed-in accounts: the server's HttpOnly cookie (sent automatically, same origin). This
 *   class never sees or stores that token; a refresh or another tab resumes it from the cookie.
 * - Anonymous visitors: a bearer token kept in this tab's sessionStorage.
 */
export class HttpWorkflowGateway implements WorkflowGateway {
  readonly mode: GatewayMode = 'SERVER';
  /** Bearer token of the anonymous visitor only; null for signed-in accounts (cookie). */
  private token: string | null = null;
  private actor: Actor | null = null;
  private sessionKey: string | null = null;
  private sessionEnded: (() => void) | null = null;
  private pendingLogout: Promise<void> = Promise.resolve();

  onSessionEnded(listener: (() => void) | null): void {
    this.sessionEnded = listener;
  }

  private async request<T>(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
    const headers: Record<string, string> = { ...extraHeaders };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let res: Response;
    try {
      res = await fetch(apiUrl(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new WorkflowApiError('NETWORK', 'Server tidak dapat dihubungi. Perubahan tidak tersimpan.', 0);
    }
    const json = (await res.json().catch(() => null)) as { success?: boolean; error?: { code: string; message: string } } | null;
    if (!res.ok || !json || json.success === false) {
      const code = json?.error?.code ?? 'HTTP_ERROR';
      if (code === 'SESSION_EXPIRED') {
        if (this.actor?.kind === 'ANONYMOUS' || this.token) {
          // An anonymous token ran out: forget it; the next useAccount(null) starts a new one.
          this.token = null;
          this.actor = null;
          this.sessionKey = null;
          writeStorage(TOKEN_KEY, null);
        } else if (this.actor) {
          this.actor = null;
          this.sessionKey = null;
          this.sessionEnded?.();
        }
      }
      throw new WorkflowApiError(code, json?.error?.message ?? `HTTP ${res.status}`, res.status);
    }
    return json as T;
  }

  async useAccount(account: SessionAccount | null): Promise<Actor> {
    const key = account ? `demo:${account.id}` : 'anonymous';
    if (this.sessionKey === key && this.actor) return this.actor;
    if (account) {
      // Signed-in account: the cookie is the session. Ask the server who it belongs to; a
      // session for another account (or none) is never reused for this one.
      this.token = null;
      writeStorage(TOKEN_KEY, null);
      const me = await this.request<{ actor: Actor }>('GET', WORKFLOW_API_PATHS.me);
      if (me.actor.id !== account.id || (me.actor.kind !== 'ACCOUNT' && me.actor.kind !== 'DEMO_ACCOUNT')) {
        this.actor = null;
        this.sessionKey = null;
        throw new WorkflowApiError('UNAUTHENTICATED', 'Sesi tidak ditemukan atau sudah berakhir. Silakan masuk kembali.', 401);
      }
      this.actor = me.actor;
      this.sessionKey = key;
      return me.actor;
    }
    // Anonymous: reuse this tab's stored token while it is still valid.
    const stored = readStorage(TOKEN_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as { key: string; token: string };
        if (parsed.key === key) {
          this.token = parsed.token;
          const me = await this.request<{ actor: Actor }>('GET', WORKFLOW_API_PATHS.me);
          this.actor = me.actor;
          this.sessionKey = key;
          return me.actor;
        }
      } catch {
        // Expired or malformed: start a new session below.
      }
    }
    this.token = null;
    if (account) {
      // Named accounts only resume a session created by `login`; never from an account id.
      this.actor = null;
      this.sessionKey = null;
      throw new WorkflowApiError('UNAUTHENTICATED', 'Sesi tidak ditemukan atau sudah berakhir. Silakan masuk kembali.', 401);
    }
    const res = await this.request<{ token: string; actor: Actor }>('POST', WORKFLOW_API_PATHS.anonymousSession);
    this.token = res.token;
    this.actor = res.actor;
    this.sessionKey = key;
    writeStorage(TOKEN_KEY, JSON.stringify({ key, token: res.token }));
    return res.actor;
  }

  async login(credentials: LoginCredentials): Promise<SignedIn> {
    // End the previous identity first, and wait for it: a logout still in flight when the new
    // session cookie arrives would revoke the new session instead of the old one.
    this.forget();
    await this.endServerSession();
    return this.startSession(await this.request<SignedIn>('POST', WORKFLOW_API_PATHS.login, credentials));
  }

  async register(input: { email: string; name: string; password: string }): Promise<SignedIn> {
    this.forget();
    await this.endServerSession();
    return this.startSession(await this.request<SignedIn>('POST', WORKFLOW_API_PATHS.register, input));
  }

  private startSession(res: SignedIn): SignedIn {
    this.actor = res.actor;
    this.sessionKey = `demo:${res.actor.id}`;
    return { actor: res.actor, account: res.account ?? null };
  }

  logout(): Promise<void> {
    this.forget();
    // Revoke on the server too (the cookie stops working everywhere). keepalive lets it finish
    // even when the page navigates away right after.
    return this.endServerSession();
  }

  private forget(): void {
    this.token = null;
    this.actor = null;
    this.sessionKey = null;
    writeStorage(TOKEN_KEY, null);
  }

  /** Server logouts run one after another, so a later login can wait for all of them. */
  private endServerSession(): Promise<void> {
    this.pendingLogout = this.pendingLogout.then(() =>
      fetch(apiUrl(WORKFLOW_API_PATHS.logout), { method: 'POST', credentials: 'same-origin', keepalive: true }).then(
        () => undefined,
        () => undefined
      )
    );
    return this.pendingLogout;
  }

  async listReports(): Promise<ReportView[]> {
    const res = await this.request<{ items: ReportView[] }>('GET', `${WORKFLOW_API_PATHS.reports}?limit=200`);
    return res.items;
  }

  async getReport(id: string): Promise<ReportView> {
    const claim = claimFor(id);
    const res = await this.request<{ report: ReportView }>('GET', pathFor(WORKFLOW_API_PATHS.report, id), undefined, claim ? { 'x-claim-token': claim } : {});
    return res.report;
  }

  async submit(draft: ReportDraft): Promise<{ view: ReportView; claimToken: string | null }> {
    const res = await this.request<{ report: ReportView; claimToken?: string }>('POST', WORKFLOW_API_PATHS.reports, { report: draft });
    if (res.claimToken) rememberClaim(res.report.case.id, res.claimToken);
    return { view: res.report, claimToken: res.claimToken ?? null };
  }

  async transition(id: string, command: WorkflowCommand, expectedVersion: number): Promise<ReportView> {
    return (await this.request<{ report: ReportView }>('POST', pathFor(WORKFLOW_API_PATHS.transitions, id), { command, expectedVersion })).report;
  }

  async editContent(id: string, patch: Partial<DamageReport>, expectedVersion: number): Promise<ReportView> {
    return (await this.request<{ report: ReportView }>('PATCH', pathFor(WORKFLOW_API_PATHS.content, id), { patch, expectedVersion })).report;
  }

  async audit(entityId?: string): Promise<AuditEvent[]> {
    const q = entityId ? `?entityId=${encodeURIComponent(entityId)}&limit=200` : '?limit=200';
    return (await this.request<{ items: AuditEvent[] }>('GET', `${WORKFLOW_API_PATHS.audit}${q}`)).items;
  }

  async engineers(): Promise<EngineerSummary[]> {
    return (await this.request<{ items: EngineerSummary[] }>('GET', WORKFLOW_API_PATHS.engineers)).items;
  }

  async assessment(segmentId: string) {
    return this.request<{ assessment: EngineeringAssessment; explanation: StructuredExplanation }>('GET', pathFor(INTELLIGENCE_PATHS.assessment, segmentId));
  }

  async story(segmentId: string) {
    return this.request<{ audience: 'STAFF' | 'PUBLIC'; story: StoryEntry[]; note: string }>('GET', pathFor(WORKFLOW_API_PATHS.roadStory, segmentId));
  }

  async simulate(segmentId: string, scenario: Partial<AssessmentInputs>): Promise<WhatIfResult> {
    return (await this.request<{ result: WhatIfResult }>('POST', INTELLIGENCE_PATHS.simulations, { segmentId, scenario })).result;
  }

  async engineAssess(body: EngineAssessRequest): Promise<EngineAssessResult> {
    return (await this.request<{ result: EngineAssessResult }>('POST', INTELLIGENCE_PATHS.engineAssess, body)).result;
  }
}

/**
 * In-browser fallback for the static demo host. Same domain rules, memory only, actor
 * chosen locally (there is no server to sign anything) — labelled OFFLINE_DEMO in the UI.
 */
export class OfflineWorkflowGateway implements WorkflowGateway {
  readonly mode: GatewayMode = 'OFFLINE_DEMO';
  private actor: Actor = { id: 'anon-offline', role: 'PUBLIC_VIEWER', kind: 'ANONYMOUS' };
  private readonly service: WorkflowService;
  private readonly ready: Promise<number>;
  private seq = 0;

  constructor(
    seedReports: DamageReport[],
    private readonly roleOf: (id: string) => UserRole | null,
    private readonly engineerList: EngineerSummary[],
    private readonly segments: RoadSegment[],
    private readonly verifyCredentials?: OfflineCredentialVerifier
  ) {
    this.service = new WorkflowService(new MemoryCaseStore(), {
      now: () => new Date().toISOString(),
      newId: (prefix) => `${prefix}-L${(++this.seq).toString(36).toUpperCase()}`,
      roleOf,
      cv: DEMO_CV_PROVIDER
    });
    this.ready = this.service.ensureSeeded(seedReports);
  }

  private view(c: ReportCase): ReportView {
    const canEdit = canEditReport(this.actor, c.report);
    if (this.actor.role !== 'SYSTEM' && isOfficialRole(this.actor.role)) {
      return { audience: 'STAFF', case: c, availableActions: availableActions(c, this.actor), canEdit };
    }
    return { audience: 'PUBLIC', case: toPublicView(c), availableActions: [], canEdit, isMine: c.createdBy.id === this.actor.id };
  }

  private unwrap(result: ServiceResult<ReportCase>): ReportView {
    if (result.ok === false) {
      const f = result as Extract<ServiceResult<ReportCase>, { ok: false }>;
      throw new WorkflowApiError(f.code, f.message, 0);
    }
    return this.view(result.value);
  }

  async register(): Promise<SignedIn> {
    throw new WorkflowApiError('DISABLED', 'Registration needs the server.', 403);
  }

  async login(credentials: LoginCredentials): Promise<SignedIn> {
    if (!this.verifyCredentials) {
      throw new WorkflowApiError('DISABLED', 'Login is not available in this static build (demo access is not enabled).', 403);
    }
    const accountId = await this.verifyCredentials(credentials);
    const role = accountId ? this.roleOf(accountId) : null;
    if (!accountId || !role) throw new WorkflowApiError('UNAUTHENTICATED', 'Invalid username or password.', 401);
    writeStorage(OFFLINE_LOGIN_KEY, accountId);
    this.actor = { id: accountId, role, kind: 'DEMO_ACCOUNT' };
    return { actor: this.actor, account: null };
  }

  onSessionEnded(): void {
    // The static build has no server session to end.
  }

  async logout(): Promise<void> {
    writeStorage(OFFLINE_LOGIN_KEY, null);
    this.actor = { id: 'anon-offline', role: 'PUBLIC_VIEWER', kind: 'ANONYMOUS' };
  }

  async useAccount(account: SessionAccount | null): Promise<Actor> {
    // Same rule as the server gateway: a named account needs an earlier credential check.
    if (account && readStorage(OFFLINE_LOGIN_KEY) !== account.id) {
      throw new WorkflowApiError('UNAUTHENTICATED', 'Sesi tidak ditemukan atau sudah berakhir. Silakan masuk kembali.', 401);
    }
    this.actor = account ? { id: account.id, role: account.role, kind: 'DEMO_ACCOUNT' } : { id: 'anon-offline', role: 'PUBLIC_VIEWER', kind: 'ANONYMOUS' };
    return this.actor;
  }

  async listReports(): Promise<ReportView[]> {
    await this.ready;
    return (await this.service.listCases()).map((c) => this.view(c));
  }

  async getReport(id: string): Promise<ReportView> {
    await this.ready;
    const c = await this.service.getCase(id);
    if (!c) throw new WorkflowApiError('NOT_FOUND', 'Report not found.', 404);
    return this.view(c);
  }

  async submit(draft: ReportDraft): Promise<{ view: ReportView; claimToken: string | null }> {
    await this.ready;
    return { view: this.unwrap(await this.service.submitReport(draft, this.actor, null)), claimToken: null };
  }

  async transition(id: string, command: WorkflowCommand, expectedVersion: number): Promise<ReportView> {
    await this.ready;
    if (command.action === 'RECOMMEND_ACTION') {
      // Same rule as the server route: the assessment is computed here, never taken from the caller.
      const current = await this.service.getCase(id);
      const segment = current ? this.segments.find((s) => s.id === current.segmentId) : undefined;
      const assessment = segment ? assessSegment(segment, { now: new Date().toISOString(), cases: await this.service.listCases() }) : null;
      command = { ...command, assessmentId: assessment ? assessment.id : null, assessment: assessment ? snapshotOf(assessment) : null };
    }
    return this.unwrap(await this.service.transition(id, command, this.actor, expectedVersion));
  }

  async editContent(id: string, patch: Partial<DamageReport>, expectedVersion: number): Promise<ReportView> {
    await this.ready;
    return this.unwrap(await this.service.editContent(id, patch, this.actor, expectedVersion));
  }

  async audit(entityId?: string): Promise<AuditEvent[]> {
    if (this.actor.role === 'SYSTEM' || !isOfficialRole(this.actor.role)) {
      throw new WorkflowApiError('FORBIDDEN', 'The audit trail is limited to official roles.', 403);
    }
    return (await this.service.listAudit({ entityId, limit: 200, offset: 0 })).items;
  }

  async engineers(): Promise<EngineerSummary[]> {
    return this.engineerList;
  }

  private segment(id: string): RoadSegment {
    const s = this.segments.find((x) => x.id === id);
    if (!s) throw new WorkflowApiError('NOT_FOUND', 'Unknown road segment.', 404);
    return s;
  }

  async assessment(segmentId: string) {
    await this.ready;
    const cases = await this.service.listCases();
    const assessment = assessSegment(this.segment(segmentId), { now: new Date().toISOString(), cases });
    return { assessment, explanation: explainAssessment(assessment, cases) };
  }

  async story(segmentId: string) {
    await this.ready;
    const cases = await this.service.listCases();
    const audience = this.actor.role !== 'SYSTEM' && isOfficialRole(this.actor.role) ? ('STAFF' as const) : ('PUBLIC' as const);
    const assessment = assessSegment(this.segment(segmentId), { now: new Date().toISOString(), cases });
    const sims = (await this.service.listSimulations(segmentId)).map((s) => ({ at: s.at, summary: s.summary }));
    return { audience, story: buildRoadStory(segmentId, cases, [assessment], sims, audience), note: 'Offline demo: history exists only in this browser tab.' };
  }

  async simulate(segmentId: string, scenario: Partial<AssessmentInputs>): Promise<WhatIfResult> {
    await this.ready;
    // Same rules as POST /api/simulations: engineers only, inputs inside the validated range.
    if (this.actor.role !== 'FIELD_ENGINEER') throw new WorkflowApiError('FORBIDDEN', 'What-If simulation is limited to field engineers.', 403);
    for (const [key, value] of Object.entries(scenario) as Array<[keyof typeof ENGINE_INPUT_RANGES, number]>) {
      const range = ENGINE_INPUT_RANGES[key];
      if (range && (value < range[0] || value > range[1])) {
        throw new WorkflowApiError('OUTSIDE_VALIDATED_RANGE', `Outside validated range: ${key} must be ${range[0]}–${range[1]}.`, 422);
      }
    }
    const result = runWhatIf(this.segment(segmentId), scenario, { now: new Date().toISOString(), cases: await this.service.listCases() });
    await this.service.recordSimulation({ segmentId, requestedBy: this.actor, summary: result.explanation, result });
    return result;
  }

  async engineAssess(): Promise<EngineAssessResult> {
    // The static demo host has no Python service; never substitute a browser-side result.
    throw new WorkflowApiError('INFERENCE_UNAVAILABLE', 'Penilaian struktural butuh layanan inferensi (server + Python); tidak tersedia di demo statis.', 503);
  }
}

export function createWorkflowGateway(
  seedReports: DamageReport[],
  roleOf: (id: string) => UserRole | null,
  engineers: EngineerSummary[],
  segments: RoadSegment[],
  verifyCredentials?: OfflineCredentialVerifier
): WorkflowGateway {
  return isStaticHost()
    ? new OfflineWorkflowGateway(seedReports, roleOf, engineers, segments, verifyCredentials)
    : new HttpWorkflowGateway();
}
