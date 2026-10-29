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
import { checkPhotoReference, photoGpsPosition, stripPhotoMetadata } from "../services/photoValidation";
import { distanceMeters } from "../../src/domain/workflow/screening";
import { AGENCIES, agencyById, resolveAuthority } from "../services/authorityResolver";
import { citizenImpact, quests, type QuestDef } from "../../src/domain/workflow/impact";
import { visitsFor } from "./share.routes";
import { trackingCodeFor } from "../../src/domain/workspace/fromCase";
import questConfig from "../../config/quests.json";

/** How far the camera position may be from the reported position. */
const PHOTO_LOCATION_TOLERANCE_M = 1000;
import { attachCvAnalysis } from "../services/cvAttach";
import { checkRepairPhoto } from "../services/repairCheck";
import { MATERIAL_CATALOGUE, materialById } from "../services/materials";
import { reportCards } from "../../src/domain/workflow/reportCard";
import { CONFIRM_MILESTONES_MONTHS, dueConfirmations, recurrence, repairLives, statsByMethod } from "../../src/domain/roads/recurrence";
import type { WorkflowRuntime } from "../services/workflowRuntime";
import { CvAnalysisStore } from "../services/cvAnalysisStore";
import type { InspectionView } from "../../src/domain/workflow/inspectionViews";
import { createHash } from "node:crypto";
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

/** Model result for one inspection view, copied from the server's CV store; null if unverifiable. */
async function viewAiFrom(store: WorkflowRuntime["cv"], analysisId: unknown, photoUrl: string) {
  if (!CvAnalysisStore.isId(analysisId)) return null;
  const record = await store.get(analysisId);
  const m = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(photoUrl);
  if (!record || !m || createHash("sha256").update(Buffer.from(m[1], "base64")).digest("hex") !== record.imageSha256) return null;
  const a = record.analysis;
  return {
    analysisId: a.analysisId,
    status: a.status,
    primaryLabel: a.primary?.label ?? null,
    primaryType: a.primary?.damageType ?? null,
    confidence: a.primary?.confidence ?? null,
    detections: a.detections.length,
    severity: a.overallSeverity ?? "unknown",
    surfaceIndex: typeof a.surfaceIndex === "number" ? a.surfaceIndex : null,
    flooded: !!a.hazards?.includes("GENANGAN")
  };
}

export function registerWorkflowRoutes(router: Router, runtime: WorkflowRuntime): void {
  const { service, signer } = runtime;
  const viewAi = (id: unknown, photo: string) => viewAiFrom(runtime.cv, id, photo);
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
    if (role !== "FIELD_ENGINEER" && role !== "OPERATIONS_MANAGER" && role !== "POLICY_MAKER") return sendError(res, "VALIDATION", "Peran harus Petugas Lapangan, Koordinator atau Pimpinan Instansi.");
    try {
      // Staff join the Koordinator's own agency; the agency is never taken from the request.
      const me = runtime.accounts.get(actor.id);
      const profile = runtime.accounts.create({
        email: req.body?.email, name: req.body?.name, password: req.body?.password,
        agency: me?.agency ?? req.body?.agency, agencyId: me?.agencyId ?? null, role, createdBy: actor.id
      });
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
    // On the spot only: when the camera recorded where the photo was taken, it must match the
    // reported position (GPS drift and indoor fixes stay well inside 1 km).
    const shotAt = typeof draft.photoUrl === "string" ? photoGpsPosition(draft.photoUrl) : null;
    if (shotAt && Array.isArray(draft.coordinates) && distanceMeters(shotAt, draft.coordinates as [number, number]) > PHOTO_LOCATION_TOLERANCE_M) {
      return sendError(res, "VALIDATION", "Foto ini diambil di tempat lain. Laporan harus dikirim dari lokasi kerusakan.");
    }
    // Privacy: camera metadata (EXIF GPS, device) is removed before storage, after the CV binding.
    if (typeof draft.photoUrl === "string") draft.photoUrl = stripPhotoMetadata(draft.photoUrl);
    // Extra citizen angles (overview / side): byte-checked, AI copied from the server CV store
    // only for the exact analysed bytes, EXIF stripped. At most 2; anything else is dropped.
    const rawViews = (draft as { extraViews?: unknown }).extraViews;
    const extraViews: InspectionView[] = [];
    if (Array.isArray(rawViews)) {
      for (const v of rawViews.slice(0, 2) as Array<Record<string, unknown>>) {
        if (!v || !["OVERVIEW", "SIDE", "DETAIL"].includes(String(v.angle)) || extraViews.some((x) => x.angle === v.angle)) continue;
        const ok = checkPhotoReference(v.photoUrl);
        if (ok.ok === false || typeof v.photoUrl !== "string" || !v.photoUrl.startsWith("data:image/")) return sendError(res, "VALIDATION", `Foto ${String(v.angle)}: ${(ok as { message?: string }).message ?? "harus berupa foto."}`);
        extraViews.push({ angle: v.angle as InspectionView["angle"], photoUrl: stripPhotoMetadata(v.photoUrl), takenAt: typeof v.takenAt === "string" ? v.takenAt : new Date().toISOString(), ai: await viewAi(v.analysisId, v.photoUrl) });
      }
    }
    (draft as { extraViews?: InspectionView[] }).extraViews = extraViews.length ? extraViews : undefined;
    const claim = actor.kind === "ANONYMOUS" ? newClaimToken() : null;
    // Who handles this road: resolved from the reported position (OSM, cached; offline fallback).
    const coords = Array.isArray(draft.coordinates) && draft.coordinates.every((n: unknown) => Number.isFinite(n)) ? (draft.coordinates as [number, number]) : null;
    const authority = coords ? await resolveAuthority(coords[0], coords[1]) : null;
    // Reports imported from public photo archives are labelled as such, never as citizen reports.
    const archive = runtime.accounts.get(actor.id)?.email === "arsip-commons@pavement-pinn.id";
    const result = await service.submitReport(draft, actor, claim ? claim.hash : null, verifiedCv, { authority, dataStatus: archive ? "PUBLIC_ARCHIVE" : undefined });
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
    if (command.action === "MARK_HAZARD") {
      const photo = checkPhotoReference(command.photoUrl);
      if (photo.ok === false) return sendError(res, "VALIDATION", `Hazard photo: ${photo.message}`);
      command.photoUrl = stripPhotoMetadata(command.photoUrl as string);
    }
    if (command.action === "TRANSFER_AUTHORITY") {
      // Only agencies of the registry; name and level come from the registry, not from the request.
      const agency = agencyById(String(command.agencyId ?? ""));
      if (!agency) return sendError(res, "VALIDATION", "Unknown agency.");
      command.agencyName = agency.name;
      command.level = agency.level;
    }
    if (command.action === "COMPLETE_WORK_ORDER") {
      const photo = checkPhotoReference(command.completionPhotoUrl);
      if (photo.ok === false) return sendError(res, "VALIDATION", `Repair photo: ${photo.message}`);
      command.completionPhotoUrl = stripPhotoMetadata(command.completionPhotoUrl as string);
      const repair = command.repair as { materialId?: unknown } | undefined;
      if (!repair || typeof repair.materialId !== "string" || !materialById(repair.materialId)) return sendError(res, "VALIDATION", "Material perbaikan harus dipilih dari katalog.");
      // Computed here only; a client-sent repairCheck is discarded.
      command.repairCheck = await checkRepairPhoto(command.completionPhotoUrl, await service.getCase(req.params.id), new Date().toISOString());
    }
    if (command.action === "SUBMIT_INSPECTION" && command.evidencePhotoUrl) {
      // Same byte-level check as the citizen photo: real JPEG/PNG/WebP, at most 5 MB.
      const photo = checkPhotoReference(command.evidencePhotoUrl);
      if (photo.ok === false) return sendError(res, "VALIDATION", `Evidence photo: ${photo.message}`);
    }
    if (command.action === "SUBMIT_INSPECTION" && Array.isArray(command.views)) {
      // Guided multi-angle views: each photo is checked; its AI result comes from this server's
      // CV store and only when the stored analysis was made on exactly these bytes.
      for (const v of command.views as Array<Record<string, unknown>>) {
        const photo = checkPhotoReference(v.photoUrl);
        if (photo.ok === false) return sendError(res, "VALIDATION", `Foto ${String(v.angle)}: ${photo.message}`);
        v.ai = await viewAi(v.analysisId, v.photoUrl as string);
        delete v.analysisId;
        v.photoUrl = stripPhotoMetadata(v.photoUrl as string);
      }
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

  // Real comments: anyone signed in may read public comments and write one; staff may write
  // staff-only notes. The shown name is decided here, never by the request.
  const commentLimit = rateLimit("comments", 10, 10 * 60_000, (req) => actorFrom(req, runtime)?.id ?? null);
  const displayName = (actor: Actor): string => {
    const account = runtime.accounts.get(actor.id);
    if (account) {
      if (account.role === "PUBLIC_REPORTER") return `Warga · ${account.id.slice(-4)}`;
      return account.agency ? `${account.name} · ${account.agency}` : account.name;
    }
    const fixture = USER_ACCOUNTS.find((a) => a.id === actor.id);
    return fixture ? fixture.name : "Warga";
  };
  router.get(WORKFLOW_API_PATHS.comments, async (req: Request, res: Response) => {
    await runtime.ready;
    const actor = actorFrom(req, runtime);
    const items = await service.listComments(req.params.id, isOfficial(actor));
    res.json({ success: true, items });
  });
  router.post(WORKFLOW_API_PATHS.comments, commentLimit, async (req: Request, res: Response) => {
    await runtime.ready;
    const actor = actorFrom(req, runtime);
    if (!actor || actor.role === "SYSTEM" || actor.kind === "ANONYMOUS") return sendError(res, "UNAUTHENTICATED", "Masuk dulu untuk berkomentar.");
    const text = typeof req.body?.text === "string" ? req.body.text : "";
    const visibility = req.body?.visibility === "STAFF" && isOfficial(actor) ? "STAFF" : "PUBLIC";
    const result = await service.addComment({ caseId: req.params.id, authorId: actor.id, authorRole: actor.role, authorName: displayName(actor), text, visibility });
    if (result.ok === false) {
      const failure = result as { code: ErrorCode; message: string };
      return sendError(res, failure.code, failure.message);
    }
    res.status(201).json({ success: true, comment: result.value });
  });

  // The signed-in citizen's recognition, computed from their real reports.
  router.get("/api/me/impact", async (req: Request, res: Response) => {
    await runtime.ready;
    const actor = actorFrom(req, runtime);
    if (!actor) return sendError(res, "UNAUTHENTICATED", "Masuk dulu.");
    res.setHeader("Cache-Control", "no-store");
    const cases = await service.listCases();
    const impact = citizenImpact(cases, actor.id);
    // SPEC M8: quest progress from server-verified events only.
    const mine = cases.filter((c) => c.createdBy.id === actor.id && !c.history.some((h) => h.action === "CLOSE_INVALID"));
    const firstStaff = (c: ReportCase) => c.history.find((h) => ["REVIEW_ACCEPT", "SCREENING_PASS", "REQUEST_INSPECTION"].includes(h.action))?.at;
    const verifiedAt = mine.map(firstStaff).filter((x): x is string => !!x);
    const rainy = (iso: string) => [10, 11, 0, 1, 2].includes(new Date(iso).getMonth());
    const q = quests(questConfig.quests as QuestDef[], {
      verifiedAt,
      repairedAt: mine.map((c) => c.history.find((h) => h.action === "RESOLVE")?.at).filter((x): x is string => !!x),
      confirmation36At: (await service.listRepairConfirmations()).filter((f) => f.by === actor.id && f.milestone !== 1).map((f) => f.at),
      visits: Math.max(0, ...mine.map((c) => visitsFor(trackingCodeFor(c.id)))),
      rainyWaterAt: mine.filter((c) => c.report.cvAssessment?.hazards?.includes("GENANGAN") && firstStaff(c) && rainy(c.createdAt)).map((c) => firstStaff(c)!),
      projectVerifiedAt: (await service.listRecords("projects")).filter((p) => p.by === actor.id && p.verifiedAt).map((p) => String(p.verifiedAt))
    }, questConfig.dailyXpCap);
    res.json({ success: true, impact: { ...impact, quests: q.items, xp: q.xp, dailyXpCap: questConfig.dailyXpCap } });
  });

  // SPEC M8: e-certificate "Relawan Pengawal Jalan" from level 4, verifiable by QR without personal data.
  const certCode = (id: string) => runtime.signer.mac(`cert:${id}`).slice(0, 12).toUpperCase();
  router.get("/api/me/certificate", async (req: Request, res: Response) => {
    await runtime.ready;
    const actor = actorFrom(req, runtime);
    if (!actor) return sendError(res, "UNAUTHENTICATED", "Masuk dulu.");
    const impact = citizenImpact(await service.listCases(), actor.id);
    if (impact.level.index < 3) return sendError(res, "FORBIDDEN", "Sertifikat tersedia mulai level Mitra Jalan.");
    res.json({ success: true, code: certCode(actor.id), level: impact.level.name, verified: impact.verified, repaired: impact.repaired, areaM2: impact.repairedAreaM2 });
  });
  router.get("/api/public/certificate/:code", async (req: Request, res: Response) => {
    await runtime.ready;
    const code = String(req.params.code).toUpperCase();
    const cases = await service.listCases();
    const ids = [...new Set(cases.map((c) => c.createdBy.id))];
    const id = ids.find((x) => certCode(x) === code);
    const impact = id ? citizenImpact(cases, id) : null;
    res.json({ success: true, valid: !!impact && impact.level.index >= 3, level: impact?.level.name ?? null, verifiedReports: impact?.verified ?? null });
  });

  router.get("/api/materials", (_req: Request, res: Response) => {
    res.json({ success: true, ...MATERIAL_CATALOGUE });
  });

  // SPEC M2.2: real repair life per spot / road segment, from recorded events only.
  router.get("/api/roads/repairs", async (req: Request, res: Response) => {
    await runtime.ready;
    const segmentId = typeof req.query.segment === "string" ? req.query.segment : null;
    const all = repairLives(await service.listCases(), await service.listRepairConfirmations());
    const lives = segmentId ? all.filter((l) => l.segmentId === segmentId) : all;
    const staff = isOfficial(actorFrom(req, runtime));
    res.setHeader("Cache-Control", "no-store");
    res.json({
      success: true,
      // Maintenance-period flags are internal (SPEC M2.4): never on the public response.
      items: lives.map((l) => (staff ? l : { ...l, inMaintenance: undefined, maintenanceEndsAt: undefined })),
      byMethod: statsByMethod(lives),
      recurrence3m: recurrence(lives, 3),
      recurrence6m: recurrence(lives, 6),
      label: "TERUKUR (dari peristiwa tercatat)"
    });
  });

  // SPEC M2.3: open 1/3/6-month questions for this device/account (reporter, or within 300 m).
  router.get("/api/me/confirmations", async (req: Request, res: Response) => {
    await runtime.ready;
    const actor = actorFrom(req, runtime);
    if (!actor) return sendError(res, "UNAUTHENTICATED", "Masuk dulu.");
    const lat = Number(req.query.lat), lng = Number(req.query.lng);
    const near = Number.isFinite(lat) && Number.isFinite(lng) ? ([lat, lng] as [number, number]) : null;
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, items: dueConfirmations(await service.listCases(), await service.listRepairConfirmations(), actor.id, Date.now(), near) });
  });

  router.post("/api/workflow/reports/:id/repair-confirmations", writeLimit, async (req: Request, res: Response) => {
    await runtime.ready;
    const actor = actorFrom(req, runtime);
    if (!actor) return sendError(res, "UNAUTHENTICATED", "Masuk dulu.");
    const milestone = Number(req.body?.milestone);
    const result = req.body?.result;
    if (!(CONFIRM_MILESTONES_MONTHS as readonly number[]).includes(milestone) || (result !== "OK" && result !== "BROKEN")) {
      return sendError(res, "VALIDATION", "Body: { milestone: 1|3|6, result: OK|BROKEN, photoUrl? }.");
    }
    const near = Array.isArray(req.body?.near) && req.body.near.every((n: unknown) => Number.isFinite(n)) ? (req.body.near as [number, number]) : null;
    const open = dueConfirmations(await service.listCases(), await service.listRepairConfirmations(), actor.id, Date.now(), near);
    if (!open.some((d) => d.caseId === req.params.id && d.milestone === milestone)) return sendError(res, "VALIDATION", "Konfirmasi ini belum dibuka atau sudah dijawab.");
    let photoUrl: string | null = null;
    if (req.body?.photoUrl) {
      const photo = checkPhotoReference(req.body.photoUrl);
      if (photo.ok === false) return sendError(res, "VALIDATION", `Foto: ${photo.message}`);
      photoUrl = stripPhotoMetadata(req.body.photoUrl);
    }
    const r = await service.addRepairConfirmation({ caseId: req.params.id, by: actor.id, milestone: milestone as 1 | 3 | 6, result, photoUrl });
    if (r.ok === false) return sendError(res, r.code === "NOT_FOUND" ? "NOT_FOUND" : "VALIDATION", r.message);
    res.status(201).json({ success: true, confirmation: { ...r.value, by: undefined } });
  });

  // SPEC M3.4: "Saya juga melihat ini" — one per account, optional photo, stored on the server.
  router.post("/api/workflow/reports/:id/witness", writeLimit, async (req: Request, res: Response) => {
    await runtime.ready;
    const actor = actorFrom(req, runtime);
    if (!actor) return sendError(res, "UNAUTHENTICATED", "Masuk dulu.");
    let photoUrl: string | null = null;
    if (req.body?.photoUrl) {
      const photo = checkPhotoReference(req.body.photoUrl);
      if (photo.ok === false) return sendError(res, "VALIDATION", `Foto: ${photo.message}`);
      photoUrl = stripPhotoMetadata(req.body.photoUrl);
    }
    const r = await service.addWitness({ caseId: req.params.id, by: actor.id, photoUrl });
    if (r.ok === false) return sendError(res, r.code === "NOT_FOUND" ? "NOT_FOUND" : r.code === "STORAGE" ? "STORAGE" : "VALIDATION", r.message);
    res.status(201).json({ success: true, count: r.value.count });
  });

  router.get("/api/me/witnessed", async (req: Request, res: Response) => {
    await runtime.ready;
    const actor = actorFrom(req, runtime);
    if (!actor) return sendError(res, "UNAUTHENTICATED", "Masuk dulu.");
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, items: await service.witnessedBy(actor.id) });
  });

  // SPEC M3.5: Rapor Instansi. Staff see every agency; the public only agencies with n >= 10.
  router.get("/api/agencies/report-card", async (req: Request, res: Response) => {
    await runtime.ready;
    const cards = reportCards(await service.listCases(), await service.listRepairConfirmations());
    const staff = isOfficial(actorFrom(req, runtime));
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, items: staff ? cards : cards.filter((c) => c.publishable) });
  });

  router.get("/api/agencies", (_req: Request, res: Response) => {
    res.json({ success: true, items: AGENCIES, attribution: "Penentuan instansi memakai data © OpenStreetMap contributors (ODbL)." });
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
