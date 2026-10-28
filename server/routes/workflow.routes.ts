import type { Request, Response, Router } from "express";
import { WORKFLOW_API_PATHS } from "../../src/types";
import { USER_ACCOUNTS } from "../../src/data/reference/demoAccounts";
import { canEditReport, isOfficialRole } from "../../src/domain/access";
import type { Actor, ReportCase } from "../../src/domain/workflow/model";
import { WORKFLOW_ACTIONS, WORKFLOW_STATES } from "../../src/domain/workflow/model";
import { availableActions, type WorkflowCommand } from "../../src/domain/workflow/stateMachine";
import { toPublicView } from "../../src/domain/workflow/projections";
import type { ServiceResult } from "../../src/domain/workflow/service";
import type { ReportDraft } from "../../src/domain/reports/reportFactory";
import { hashClaimToken, newClaimToken } from "../auth/sessionTokens";
import { rateLimit } from "../middleware/rateLimit";
import { checkPhotoReference } from "../services/photoValidation";
import { attachCvAnalysis } from "../services/cvAttach";
import type { WorkflowRuntime } from "../services/workflowRuntime";
import { actorFrom, clearSessionCookie, credentialFrom, sessionFrom, setSessionCookie } from "../auth/actor";
import { verifyDemoLogin } from "../auth/demoLogin";
import { AccountError, toProfile, type AccountProfile } from "../repositories/accountStore";
import { segmentById } from "../services/segments";
import { assessSegment, snapshotOf } from "../../src/domain/intelligence/assessment";
import { personOf } from "../../src/domain/identity/people";

/**
 * Workflow API (docs/api/WORKFLOW_API.md). The server decides the actor from its own
 * signed session token; request bodies never carry identity. Official roles see full
 * report cases; everyone else gets the public projection.
 */

type ErrorCode = "UNAUTHENTICATED" | "SESSION_EXPIRED" | "FORBIDDEN" | "VALIDATION" | "NOT_FOUND" | "VERSION_CONFLICT" | "INVALID_TRANSITION" | "STORAGE" | "DISABLED";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  FORBIDDEN: 403,
  VALIDATION: 400,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  INVALID_TRANSITION: 422,
  STORAGE: 503,
  DISABLED: 403
};

/** Endpoint paths named in spec v2.2 Lampiran L, served as aliases of the workflow routes. */
export const SPEC_PATHS = { reports: "/api/reports", login: "/api/auth/login" } as const;

function sendError(res: Response, code: ErrorCode, message: string): void {
  res.status(STATUS[code]).json({ success: false, error: { code, message } });
}

function accountFailure(res: Response, error: unknown): void {
  if (!(error instanceof AccountError)) throw error;
  sendError(res, error.code === "CONFLICT" ? "VERSION_CONFLICT" : error.code, error.message);
}

function sendResult(res: Response, result: ServiceResult<ReportCase>, actor: Actor, status = 200): void {
  if (result.ok === false) {
    const failure = result as Extract<ServiceResult<ReportCase>, { ok: false }>;
    sendError(res, failure.code as ErrorCode, failure.message);
    return;
  }
  res.status(status).json({ success: true, report: viewFor(result.value, actor) });
}

function isOfficial(actor: Actor | null): boolean {
  return !!actor && actor.role !== "SYSTEM" && isOfficialRole(actor.role);
}

/** Full case for staff, public projection for everyone else; plus what this actor may do. */
function viewFor(c: ReportCase, actor: Actor | null) {
  const canEdit = !!actor && canEditReport(actor, c.report);
  if (isOfficial(actor)) {
    return { audience: "STAFF" as const, case: c, availableActions: availableActions(c, actor!), canEdit };
  }
  return {
    audience: "PUBLIC" as const,
    case: toPublicView(c),
    availableActions: [],
    canEdit,
    isMine: !!actor && c.createdBy.id === actor.id
  };
}

function parsePaging(req: Request): { limit: number; offset: number } {
  const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? "100"), 10) || 100, 1), 200);
  const offset = Math.max(Number.parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);
  return { limit, offset };
}

function parseVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

export function registerWorkflowRoutes(router: Router, runtime: WorkflowRuntime): void {
  const { service, signer } = runtime;
  const writeLimit = rateLimit("workflow-write", 120, 60_000);
  // Spec Lampiran L / §20.2: 10 reports per hour per client.
  const submitLimit = rateLimit("report-submit", 10, 60 * 60_000);
  const sessionLimit = rateLimit("session", 60, 60_000);
  // Credential attempts: tighter than other session calls.
  const loginLimit = rateLimit("login", 20, 60_000);

  // --- Identity -------------------------------------------------------------------
  // Demo login: username (or demo email) and password, checked against the dummy demo
  // credentials. Only while DEMO_AUTH is not "false"; there is no production identity
  // provider yet (docs/LOGIN_AND_DEMO_AUTH.md). A body naming an account id without a
  // password is refused: identity is never taken from the request.
  const signIn = (req: Request, res: Response, profile: AccountProfile) => {
    const actor: Actor = { id: profile.id, role: profile.role, kind: "ACCOUNT" };
    const { token, expiresAt, issuedAt } = signer.issue(actor);
    setSessionCookie(req, res, token, expiresAt);
    res.json({ success: true, expiresAt, issuedAt, actor, account: profile, authentication: "ACCOUNT" });
  };

  const demoLoginHandler = (req: Request, res: Response) => {
    const identifier = req.body?.email ?? req.body?.username;
    if (typeof identifier !== "string" || typeof req.body?.password !== "string" || identifier.trim() === "" || req.body.password === "") {
      return sendError(res, "VALIDATION", "Email dan kata sandi wajib diisi.");
    }
    const profile = runtime.accounts.verify(identifier, req.body.password);
    if (profile) return signIn(req, res, profile);
    if (!runtime.demoAuthEnabled) return sendError(res, "UNAUTHENTICATED", "Email atau kata sandi salah.");
    const result = verifyDemoLogin(req.body?.username, req.body?.password, req.body?.layout);
    if (result.ok === false) {
      return result.reason === "MISSING_FIELDS"
        ? sendError(res, "VALIDATION", "Username and password are required.")
        : sendError(res, "UNAUTHENTICATED", "Invalid username or password.");
    }
    const account = USER_ACCOUNTS.find((a) => a.id === result.accountId);
    if (!account) return sendError(res, "STORAGE", "Demo account catalogue is inconsistent.");
    const actor: Actor = { id: account.id, role: account.role, kind: "DEMO_ACCOUNT" };
    const { token, expiresAt, issuedAt } = signer.issue(actor);
    // The signed-in session rides in an HttpOnly cookie, so a refresh or a new tab resumes it
    // and page scripts never hold it. The deadline is absolute: issuedAt + 2 hours.
    setSessionCookie(req, res, token, expiresAt);
    res.json({ success: true, expiresAt, issuedAt, actor, authentication: "DEMO_CREDENTIALS (local demo only, not production authentication)" });
  };
  router.post(SPEC_PATHS.login, loginLimit, demoLoginHandler);
  // Older path of the same call; it now requires credentials too.
  router.post(WORKFLOW_API_PATHS.demoSession, loginLimit, demoLoginHandler);

  // Citizens register themselves; staff accounts come from a Koordinator (below).
  const registerLimit = rateLimit("register", 10, 60 * 60_000);
  router.post(WORKFLOW_API_PATHS.register, registerLimit, (req: Request, res: Response) => {
    try {
      const profile = runtime.accounts.create({ email: req.body?.email, name: req.body?.name, password: req.body?.password, role: "PUBLIC_REPORTER" });
      signIn(req, res, profile);
    } catch (error) {
      accountFailure(res, error);
    }
  });

  const coordinator = (req: Request, res: Response): Actor | null => {
    const actor = actorFrom(req, runtime);
    if (!actor) return sendError(res, "UNAUTHENTICATED", "Masuk sebagai Koordinator."), null;
    if (actor.role !== "OPERATIONS_MANAGER") return sendError(res, "FORBIDDEN", "Hanya Koordinator yang dapat mengelola akun petugas."), null;
    return actor;
  };

  router.get(WORKFLOW_API_PATHS.staff, (req: Request, res: Response) => {
    if (!coordinator(req, res)) return;
    res.json({ success: true, items: [...runtime.accounts.list("FIELD_ENGINEER"), ...runtime.accounts.list("OPERATIONS_MANAGER")] });
  });

  router.post(WORKFLOW_API_PATHS.staff, writeLimit, (req: Request, res: Response) => {
    const actor = coordinator(req, res);
    if (!actor) return;
    const role = req.body?.role;
    if (role !== "FIELD_ENGINEER" && role !== "OPERATIONS_MANAGER") return sendError(res, "VALIDATION", "Peran harus Petugas Lapangan atau Koordinator.");
    try {
      const profile = runtime.accounts.create({ email: req.body?.email, name: req.body?.name, password: req.body?.password, agency: req.body?.agency, role, createdBy: actor.id });
      res.status(201).json({ success: true, account: profile });
    } catch (error) {
      accountFailure(res, error);
    }
  });

  router.post(WORKFLOW_API_PATHS.staffActive, writeLimit, (req: Request, res: Response) => {
    const actor = coordinator(req, res);
    if (!actor) return;
    if (req.params.id === actor.id) return sendError(res, "VALIDATION", "Tidak dapat menonaktifkan akun sendiri.");
    const target = runtime.accounts.get(req.params.id);
    if (!target || target.role === "PUBLIC_REPORTER") return sendError(res, "NOT_FOUND", "Akun petugas tidak ditemukan.");
    res.json({ success: true, account: runtime.accounts.setActive(target.id, req.body?.active === true) });
  });

  router.post(WORKFLOW_API_PATHS.anonymousSession, sessionLimit, (_req: Request, res: Response) => {
    // The id is chosen by the server, so a browser cannot pick (or reuse) someone else's.
    const actor: Actor = { id: `anon-${newClaimToken().token.slice(0, 12)}`, role: "PUBLIC_VIEWER", kind: "ANONYMOUS" };
    const { token, expiresAt } = signer.issue(actor);
    res.json({ success: true, token, expiresAt, actor, authentication: "ANONYMOUS" });
  });

  router.get(WORKFLOW_API_PATHS.me, (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const session = sessionFrom(req, runtime);
    if (session.ok === false) {
      if (session.reason === "EXPIRED" || session.reason === "REVOKED") {
        clearSessionCookie(req, res);
        return sendError(res, "SESSION_EXPIRED", session.reason === "EXPIRED" ? "Session expired." : "Session ended.");
      }
      return sendError(res, "UNAUTHENTICATED", "No valid session.");
    }
    const { payload } = session;
    const account = session.actor.kind === "ACCOUNT" ? runtime.accounts.get(session.actor.id) : null;
    if (session.actor.kind === "ACCOUNT" && (!account || !account.active)) {
      clearSessionCookie(req, res);
      return sendError(res, "UNAUTHENTICATED", "Akun tidak aktif.");
    }
    res.json({
      success: true,
      actor: session.actor,
      account: account ? toProfile(account) : null,
      issuedAt: new Date(payload.iat * 1000).toISOString(),
      expiresAt: new Date(Math.min(payload.exp, payload.iat + signer.maxAgeSeconds) * 1000).toISOString()
    });
  });

  // Logout: the token stops working on the server at once (revoked), not just in this browser.
  router.post(WORKFLOW_API_PATHS.logout, (req: Request, res: Response) => {
    signer.revoke(credentialFrom(req));
    clearSessionCookie(req, res);
    res.json({ success: true });
  });

  // --- Reports --------------------------------------------------------------------
  router.get(WORKFLOW_API_PATHS.reports, async (req: Request, res: Response) => {
    await runtime.ready;
    const actor = actorFrom(req, runtime);
    const { limit, offset } = parsePaging(req);
    const state = typeof req.query.state === "string" ? req.query.state : null;
    if (state && !(WORKFLOW_STATES as readonly string[]).includes(state)) return sendError(res, "VALIDATION", "Unknown state filter.");
    const segmentId = typeof req.query.segmentId === "string" ? req.query.segmentId : null;
    const all = (await service.listCases()).filter((c) => (!state || c.state === state) && (!segmentId || c.segmentId === segmentId));
    res.json({ success: true, total: all.length, limit, offset, items: all.slice(offset, offset + limit).map((c) => viewFor(c, actor)) });
  });

  router.get(WORKFLOW_API_PATHS.report, async (req: Request, res: Response) => {
    await runtime.ready;
    const actor = actorFrom(req, runtime);
    const c = await service.getCase(req.params.id);
    if (!c) return sendError(res, "NOT_FOUND", "Report not found.");
    // An anonymous reporter can prove ownership on a fresh session with the claim token.
    const claim = typeof req.headers["x-claim-token"] === "string" ? req.headers["x-claim-token"] : null;
    const view = viewFor(c, actor) as ReturnType<typeof viewFor> & { isMine?: boolean };
    if (claim && c.claimTokenHash && hashClaimToken(claim) === c.claimTokenHash) view.isMine = true;
    res.json({ success: true, report: view });
  });

  const submitHandler = async (req: Request, res: Response) => {
    await runtime.ready;
    const actor = actorFrom(req, runtime);
    if (!actor) return sendError(res, "UNAUTHENTICATED", "Start a session first (anonymous sessions are allowed).");
    const draft = req.body?.report as ReportDraft | undefined;
    if (!draft || typeof draft !== "object") return sendError(res, "VALIDATION", "Body must be { report }.");
    const photo = checkPhotoReference(draft.photoUrl);
    if (photo.ok === false) return sendError(res, "VALIDATION", (photo as { message: string }).message);
    if (typeof draft.description !== "string" || draft.description.length > 2000) return sendError(res, "VALIDATION", "description must be text up to 2000 characters.");
    // A CV analysis is cited by id and read from the server store; client-sent analysis data is dropped.
    const cvId = (draft as { cvAnalysisId?: unknown }).cvAnalysisId;
    let verifiedCv = undefined;
    if (cvId !== undefined && cvId !== null) {
      const attached = await attachCvAnalysis(runtime.cv, cvId, draft);
      if (attached.ok === false) return sendError(res, "VALIDATION", (attached as { message: string }).message);
      verifiedCv = attached.assessment;
    }
    const claim = actor.kind === "ANONYMOUS" ? newClaimToken() : null;
    const result = await service.submitReport(draft, actor, claim ? claim.hash : null, verifiedCv);
    if (result.ok && verifiedCv) await runtime.cv.bind(verifiedCv.analysisId, result.value.id);
    if (result.ok && claim) {
      // The claim token is shown once; only its hash is stored.
      res.status(201).json({ success: true, report: viewFor(result.value, actor), claimToken: claim.token });
      return;
    }
    sendResult(res, result, actor, 201);
  };
  router.post(WORKFLOW_API_PATHS.reports, submitLimit, submitHandler);
  // Spec path (Lampiran L): same handler and limits.
  router.post(SPEC_PATHS.reports, submitLimit, submitHandler);

  router.post(WORKFLOW_API_PATHS.transitions, writeLimit, async (req: Request, res: Response) => {
    await runtime.ready;
    const actor = actorFrom(req, runtime);
    if (!actor) return sendError(res, "UNAUTHENTICATED", "No valid session.");
    const command = req.body?.command as WorkflowCommand | undefined;
    const expectedVersion = parseVersion(req.body?.expectedVersion);
    if (!command || typeof command !== "object" || !(WORKFLOW_ACTIONS as readonly string[]).includes(command.action)) {
      return sendError(res, "VALIDATION", "Body must be { command: { action, ... }, expectedVersion }.");
    }
    if (expectedVersion === null) return sendError(res, "VALIDATION", "expectedVersion must be a positive integer.");
    if (command.action === "COMPLETE_WORK_ORDER") {
      const photo = checkPhotoReference(command.completionPhotoUrl);
      if (photo.ok === false) return sendError(res, "VALIDATION", `Repair photo: ${photo.message}`);
    }
    if (command.action === "SUBMIT_INSPECTION" && command.evidencePhotoUrl) {
      // Same byte-level check as the citizen photo: real JPEG/PNG/WebP, at most 5 MB.
      const photo = checkPhotoReference(command.evidencePhotoUrl);
      if (photo.ok === false) return sendError(res, "VALIDATION", `Evidence photo: ${photo.message}`);
    }
    if (command.action === "RECOMMEND_ACTION") {
      // The assessment behind a recommendation is computed here, never taken from the client.
      const current = await service.getCase(req.params.id);
      const segment = current ? segmentById(current.segmentId) : undefined;
      if (segment) {
        const assessment = assessSegment(segment, { now: new Date().toISOString(), cases: await service.listCases() });
        command.assessmentId = assessment.id;
        command.assessment = snapshotOf(assessment);
      } else {
        command.assessmentId = null;
        command.assessment = null;
      }
    }
    sendResult(res, await service.transition(req.params.id, command, actor, expectedVersion), actor);
  });

  router.patch(WORKFLOW_API_PATHS.content, writeLimit, async (req: Request, res: Response) => {
    await runtime.ready;
    const actor = actorFrom(req, runtime);
    if (!actor) return sendError(res, "UNAUTHENTICATED", "No valid session.");
    const expectedVersion = parseVersion(req.body?.expectedVersion);
    const patch = req.body?.patch;
    if (!patch || typeof patch !== "object" || expectedVersion === null) {
      return sendError(res, "VALIDATION", "Body must be { patch, expectedVersion }.");
    }
    if (patch.photoUrl !== undefined) {
      const photo = checkPhotoReference(patch.photoUrl);
      if (photo.ok === false) return sendError(res, "VALIDATION", (photo as { message: string }).message);
    }
    sendResult(res, await service.editContent(req.params.id, patch, actor, expectedVersion), actor);
  });

  // --- Staff-only reads -----------------------------------------------------------
  router.get(WORKFLOW_API_PATHS.audit, async (req: Request, res: Response) => {
    await runtime.ready;
    const actor = actorFrom(req, runtime);
    if (!actor) return sendError(res, "UNAUTHENTICATED", "No valid session.");
    if (!isOfficial(actor)) return sendError(res, "FORBIDDEN", "The audit trail is limited to official roles.");
    const { limit, offset } = parsePaging(req);
    const entityId = typeof req.query.entityId === "string" ? req.query.entityId : undefined;
    res.json({ success: true, ...(await service.listAudit({ entityId, limit, offset })), limit, offset });
  });

  router.get(WORKFLOW_API_PATHS.engineers, (req: Request, res: Response) => {
    const actor = actorFrom(req, runtime);
    if (!isOfficial(actor)) return sendError(res, actor ? "FORBIDDEN" : "UNAUTHENTICATED", "Official session required.");
    res.json({
      success: true,
      // One entry per person (canonical account), so M.O cannot pick a duplicate account by mistake.
      items: [
        ...runtime.accounts.list("FIELD_ENGINEER").filter((a) => a.active).map((a) => ({ id: a.id, name: a.name, title: "Petugas Lapangan", agencyCode: a.agency ?? "" })),
        ...(runtime.demoAuthEnabled
          ? USER_ACCOUNTS.filter((a) => a.role === "FIELD_ENGINEER" && personOf(a.id) === a.id).map((a) => ({ id: a.id, name: a.name, title: a.title, agencyCode: a.agencyCode }))
          : [])
      ]
    });
  });
}
