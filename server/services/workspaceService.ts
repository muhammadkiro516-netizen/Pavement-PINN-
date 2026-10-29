/**
 * Analysis workspace service: loads/creates workspaces, applies commands (pure functions in
 * src/domain/workspace/commands.ts), and executes queued stage runs.
 *
 * Execution never invents output. Geometry reruns and structural runs go to the Python
 * inference service; when it is unreachable or a tool (COLMAP) is missing, the stage is
 * recorded as `blocked` with the reason.
 */
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { Actor } from "../../src/domain/workflow/model";
import type { WorkflowService } from "../../src/domain/workflow/service";
import type { Measured, StageId, StageRun, StructuralRun, Workspace } from "../../src/domain/workspace/types";
import { STAGE_IDS } from "../../src/domain/workspace/types";
import { addGroundTruth, applyCorrection, decideVersion, submitVersion, type CommandOutcome } from "../../src/domain/workspace/commands";
import { buildDemoWorkspace, DEMO_REPORT_ID } from "../../src/domain/workspace/demo";
import { buildCompletedWorkspace, COMPLETED_REPORT_ID } from "../../src/domain/workspace/demoCompleted";
import { workspaceFromCase } from "../../src/domain/workspace/fromCase";
import { segmentById } from "./segments";
import { enforceScale, REASON } from "../../src/domain/workspace/measured";
import { dependencyBlock, inputHash, updateRun, type Clock } from "../../src/domain/workspace/orchestrator";
import { latestRuns } from "../../src/domain/workspace/rerun";
import { toPublicTrack, type PublicTrackView } from "../../src/domain/workspace/publicTrack";
import { portfolioKpi, workspaceKpi } from "../../src/domain/workspace/metrics";
import { assessLoadFor, vehicleLoads, type VehicleConfig } from "../../src/domain/workspace/vehicles";
import { parseVehicle } from "../../src/domain/workspace/vehicleSchema";
import type { WorkspaceRepository } from "../repositories/workspaceStore";
import { callInference, type InferenceReply } from "./inferenceClient";

/** The Python endpoints the executor needs; injectable so tests can run without the service. */
export interface AnalysisEngine {
  call(method: "GET" | "POST", path: string, payload?: unknown): Promise<InferenceReply>;
}
export const INFERENCE_ENGINE: AnalysisEngine = { call: callInference };

export type WorkspaceEvent = { type: "stage" | "object" | "version" | "workspace"; reportId: string; at: string; data: unknown };

const unreachable = (r: InferenceReply) => ("unavailable" in r ? "Layanan inference tidak tersedia" : `Layanan inference menolak (${r.status})`);

export class WorkspaceService {
  readonly events = new EventEmitter();
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly clock: Clock;

  constructor(
    private readonly repo: WorkspaceRepository,
    private readonly workflow: WorkflowService,
    private readonly engine: AnalysisEngine = INFERENCE_ENGINE,
    options: { now?: () => string; seedDemo?: boolean } = {}
  ) {
    this.clock = { now: options.now ?? (() => new Date().toISOString()), id: (p) => `${p}-${randomUUID().slice(0, 8)}` };
    this.events.setMaxListeners(100);
    this.seedDemo = options.seedDemo ?? true;
  }
  private readonly seedDemo: boolean;

  /** Serialise all work on one report (commands and stage execution). */
  private exclusive<T>(reportId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(reportId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.chains.set(reportId, next.catch(() => undefined));
    return next;
  }

  private emit(type: WorkspaceEvent["type"], reportId: string, data: unknown) {
    this.events.emit(reportId, { type, reportId, at: this.clock.now(), data } satisfies WorkspaceEvent);
  }

  private async load(reportId: string): Promise<Workspace | null> {
    const stored = await this.repo.get(reportId);
    if (stored) return stored;
    let ws: Workspace | null = null;
    if (reportId === DEMO_REPORT_ID && this.seedDemo) ws = buildDemoWorkspace();
    else if (reportId === COMPLETED_REPORT_ID && this.seedDemo) ws = buildCompletedWorkspace();
    else {
      const c = await this.workflow.getCase(reportId);
      if (c) {
        const seg = segmentById(c.segmentId);
        ws = workspaceFromCase(c, seg ? { defaultAsphaltThicknessCm: seg.defaultAsphaltThicknessCm, defaultCbrPercent: seg.defaultCbrPercent } : undefined);
      }
    }
    if (ws) await this.repo.put(ws);
    return ws;
  }

  /** What leaves the API: metric values nulled for objects without a valid scale. */
  private view(ws: Workspace): Workspace {
    return { ...ws, objects: ws.objects.map(enforceScale) };
  }

  async get(reportId: string): Promise<Workspace | null> {
    const ws = await this.load(reportId);
    return ws ? this.view(ws) : null;
  }

  async list(): Promise<{ items: ReturnType<WorkspaceService["summary"]>[]; kpi: ReturnType<typeof portfolioKpi> }> {
    const ids = new Set<string>((await this.repo.list()).map((w) => w.reportId));
    for (const c of await this.workflow.listCases()) ids.add(c.id);
    if (this.seedDemo) {
      ids.add(DEMO_REPORT_ID);
      ids.add(COMPLETED_REPORT_ID);
    }
    const all = (await Promise.all([...ids].map((id) => this.load(id)))).filter((w): w is Workspace => !!w);
    return { items: all.map((w) => this.summary(w)), kpi: portfolioKpi(all) };
  }

  summary(ws: Workspace) {
    const latest = latestRuns(ws.stageRuns);
    const primary = ws.objects.find((o) => o.class.value !== "not_damage") ?? null;
    return {
      reportId: ws.reportId,
      demo: ws.demo,
      segment: ws.segment,
      primaryObject: primary ? { objectId: primary.objectId, class: primary.class.value, scaleStatus: primary.quality.scaleStatus, citizenSeverity: primary.reportedByCitizen?.severity ?? null } : null,
      stages: STAGE_IDS.map((s) => ({ stage: s, status: latest[s]?.status ?? null })),
      pendingVersions: ws.versions.filter((v) => v.status === "pending_approval").map((v) => ({ version: v.version, createdBy: v.createdBy, createdAt: v.createdAt, changeSummaryPublic: v.changeSummaryPublic })),
      kpi: workspaceKpi(ws),
      // Modul F priority is not implemented in this repository (IMPLEMENTATION_MAP §1).
      priority: null as null
    };
  }

  private async commit(reportId: string, outcome: CommandOutcome, kind: WorkspaceEvent["type"]): Promise<CommandOutcome> {
    if ("status" in outcome) return outcome;
    await this.repo.put(outcome.workspace);
    this.emit(kind, reportId, outcome.detail ?? null);
    return { ...outcome, workspace: this.view(outcome.workspace) };
  }

  private async command(reportId: string, kind: WorkspaceEvent["type"], fn: (ws: Workspace) => CommandOutcome, execute = false): Promise<CommandOutcome> {
    const result = await this.exclusive(reportId, async () => {
      const ws = await this.load(reportId);
      if (!ws) return { ok: false, status: 404, code: "NOT_FOUND", message: "Laporan tidak ditemukan." } as CommandOutcome;
      return this.commit(reportId, fn(ws), kind);
    });
    if (execute && !("status" in result)) void this.runQueued(reportId);
    return result;
  }

  correct(reportId: string, body: unknown, actor: Actor) {
    return this.command(reportId, "object", (ws) => applyCorrection(ws, body, actor, this.clock), true);
  }

  groundTruth(reportId: string, body: unknown, actor: Actor) {
    return this.command(reportId, "object", (ws) => addGroundTruth(ws, body, actor, this.clock), true);
  }

  submit(reportId: string, body: { changeSummaryPublic?: unknown; changeSummaryTechnical?: unknown }, actor: Actor) {
    return this.command(reportId, "version", (ws) => submitVersion(ws, body, actor, this.clock));
  }

  decide(reportId: string, version: number, decision: "approve" | "reject", reason: string | undefined, actor: Actor) {
    return this.command(reportId, "version", (ws) => decideVersion(ws, version, decision, reason, actor, this.clock));
  }

  /** Ops Manager action: ask the F.E for new photos (recorded; does not change results). */
  requestPhotos(reportId: string, body: { objectId?: unknown; slots?: unknown; reason?: unknown }, actor: Actor) {
    return this.command(reportId, "workspace", (ws) => {
      if (actor.role !== "OPERATIONS_MANAGER" && actor.role !== "FIELD_ENGINEER") return { ok: false, status: 403, code: "FORBIDDEN", message: "Tidak diizinkan." };
      const reason = String(body.reason ?? "").trim();
      if (reason.length < 5) return { ok: false, status: 400, code: "REASON_REQUIRED", message: "Alasan wajib diisi." };
      const slots = Array.isArray(body.slots) ? body.slots.map(String).slice(0, 12) : [];
      return { ok: true, workspace: { ...ws, audit: [...ws.audit, { at: this.clock.now(), by: actor.id, role: actor.role, action: "photo_requested", version: null, reason, detail: `${String(body.objectId ?? "")} slot: ${slots.join(", ") || "-"}` }] } };
    });
  }

  async findByTrackingCode(code: string): Promise<Workspace | null> {
    if (!/^[A-Z0-9]{3}-[A-Z0-9]{4}$/.test(code)) return null;
    const { items } = await this.list();
    for (const it of items) {
      const ws = await this.load(it.reportId);
      if (ws?.trackingCode === code) return ws;
    }
    return null;
  }

  async publicTrack(code: string): Promise<PublicTrackView | null> {
    const ws = await this.findByTrackingCode(code);
    return ws ? toPublicTrack(ws) : null;
  }

  async confirmRepair(code: string, repaired: boolean): Promise<PublicTrackView | null | "NOT_ALLOWED"> {
    const ws = await this.findByTrackingCode(code);
    if (!ws) return null;
    return this.exclusive(ws.reportId, async () => {
      const fresh = (await this.load(ws.reportId)) as Workspace;
      if (!toPublicTrack(fresh).canConfirmRepair) return "NOT_ALLOWED" as const;
      const next = { ...fresh, publicInfo: { ...fresh.publicInfo, citizenConfirmedRepaired: repaired }, audit: [...fresh.audit, { at: this.clock.now(), by: "public", role: "PUBLIC", action: "citizen_confirmation", version: null, detail: repaired ? "ya" : "belum" }] };
      await this.repo.put(next);
      this.emit("workspace", ws.reportId, null);
      return toPublicTrack(next);
    });
  }

  // ---- Stage execution ------------------------------------------------------------------

  /** Execute every queued run of a report, in stage order. Resolves when the pass is done. */
  runQueued(reportId: string): Promise<void> {
    return this.exclusive(reportId, async () => {
      for (const stage of STAGE_IDS) {
        let ws = await this.load(reportId);
        if (!ws) return;
        const run = latestRuns(ws.stageRuns)[stage];
        if (!run || run.status !== "queued") continue;
        const blocked = stage === "T8_finalize" ? null : dependencyBlock(ws.stageRuns, stage);
        if (blocked) {
          await this.setRun(ws, run, { status: "blocked", reason: blocked });
          continue;
        }
        const started = Date.now();
        ws = await this.setRun(ws, run, { status: "running", startedAt: this.clock.now() });
        try {
          const { workspace, patch } = await this.execute(ws, stage);
          await this.setRun(workspace, run, { ...patch, finishedAt: this.clock.now(), durationMs: Date.now() - started });
        } catch (error: any) {
          await this.setRun(ws, run, { status: "failed", errorCode: "EXEC_ERROR", reason: String(error?.message ?? error).slice(0, 300), finishedAt: this.clock.now() });
        }
      }
    });
  }

  private async setRun(ws: Workspace, run: StageRun, patch: Partial<StageRun>): Promise<Workspace> {
    const next = { ...ws, stageRuns: updateRun(ws.stageRuns, run.runId, patch) };
    await this.repo.put(next);
    this.emit("stage", ws.reportId, { stage: run.stage, runId: run.runId, ...patch });
    return next;
  }

  private async execute(ws: Workspace, stage: StageId): Promise<{ workspace: Workspace; patch: Partial<StageRun> }> {
    const done = (workspace: Workspace, modelVersion?: string, reason?: string) => ({ workspace, patch: { status: "completed" as const, modelVersion, reason } });
    const block = (reason: string, code = "BLOCKED") => ({ workspace: ws, patch: { status: "blocked" as const, reason, errorCode: code } });
    switch (stage) {
      case "T0_capture":
        return ws.frames.some((f) => f.accepted) ? done(ws, "gate-T0") : { workspace: ws, patch: { status: "needs_review", reason: "Belum ada frame yang diterima" } };
      case "T1_reconstruct": {
        const h = await this.engine.call("GET", "/v1/geometry/health");
        if (!h.ok) return block(unreachable(h), "INFERENCE_UNAVAILABLE");
        const body = h.body as { t1_status: string; t1_reason: string | null };
        if (body.t1_status !== "available") return block(body.t1_reason ?? "SfM tidak tersedia", "SFM_UNAVAILABLE");
        return block("SfM tersedia, tetapi unggah sekuens foto ke server inference belum disambungkan", "SEQUENCE_UPLOAD_MISSING");
      }
      case "T2_preprocess":
        return block("Menunggu point cloud dari T1");
      case "T3_detect": {
        const fe = ws.corrections.some((c) => ["class", "mask", "merge", "split"].includes(c.kind));
        if (fe) return done(ws, "koreksi F.E");
        // The OpenVINO detector's result for the report photo (server-verified at submission).
        const model = ws.objects.find((o) => o.class.modelVersion)?.class.modelVersion;
        return model ? done(ws, model) : { workspace: ws, patch: { status: "needs_review", reason: "Foto belum dianalisis model; petugas menentukan kelas" } };
      }
      case "T4_surface":
      case "T5_quantify":
        return this.requantifyAll(ws, stage);
      case "T6_validate":
        return ws.groundTruth.some((p) => p.referenceMm !== null && p.systemMm !== null) ? done(ws, "validasi pasangan lapangan") : block(REASON.noValidation, "NO_PAIRS");
      case "T7_structural":
        return this.structural(ws);
      case "T8_finalize":
        return done(ws, "finalisasi");
    }
  }

  private async requantifyAll(ws: Workspace, stage: StageId) {
    if (ws.surfaces.length === 0) return { workspace: ws, patch: { status: "blocked" as const, reason: "Belum ada permukaan 3D", errorCode: "NO_SURFACE" } };
    let next = ws;
    for (const surface of ws.surfaces) {
      const object = ws.objects.find((o) => o.objectId === surface.objectId);
      if (!object) continue;
      if (object.class.value.startsWith("crack_")) {
        const res = await this.crackObject(next, surface, object, stage);
        if ("blocked" in res) return { workspace: ws, patch: { status: "blocked" as const, reason: res.blocked, errorCode: "INFERENCE_UNAVAILABLE" } };
        next = res.workspace;
        continue;
      }
      const r = await this.engine.call("POST", "/v1/geometry/requantify", {
        object_id: surface.objectId,
        unit: surface.unit,
        cell_size: surface.cellSize,
        depth: surface.depth,
        contour: surface.contour,
        plane_rms: object.quality.planeRmsMm ?? null,
        scale_uncertainty_mm: object.quality.scaleUncertaintyMm ?? null,
        refit_plane: ws.corrections.some((c) => c.objectId === object.objectId && c.kind === "reference_plane")
      });
      if (!r.ok) return { workspace: ws, patch: { status: "blocked" as const, reason: unreachable(r), errorCode: "INFERENCE_UNAVAILABLE" } };
      if (stage === "T4_surface") continue; // T4 confirms the surface/contour; T5 writes the numbers
      const body = r.body as { unit: string; coverage_pct: number; metrics: Record<string, number | null> | null };
      const corrected = ws.corrections.some((c) => c.objectId === object.objectId && (c.kind === "contour" || c.kind === "reference_plane"));
      const runId = latestRuns(ws.stageRuns).T5_quantify?.runId;
      const method = corrected ? "geometry.requantify (kontur F.E)" : "geometry.requantify";
      const mk = (value: number | null | undefined, unit: string, unc: number | null = null, reason?: string): Measured =>
        value === null || value === undefined || body.unit !== "mm"
          ? { value: null, unit, uncertainty: null, provenance: "not_available", source: { stage: "T5_quantify", method, runId }, reasonUnavailable: reason ?? (body.unit !== "mm" ? REASON.relativeGeometry : REASON.notMeasured) }
          : { value, unit, uncertainty: unc, provenance: corrected ? "corrected" : object.measurements.depthMaxMm.provenance === "simulated" ? "simulated" : "provisional", source: { stage: "T5_quantify", method, runId } };
      const m = body.metrics ?? {};
      next = {
        ...next,
        objects: next.objects.map((o) =>
          o.objectId !== object.objectId
            ? o
            : {
                ...o,
                quality: { ...o.quality, coveragePct: body.coverage_pct },
                measurements: {
                  ...o.measurements,
                  lengthMm: mk(m.length_mm, "mm", surface.cellSize),
                  widthMaxMm: mk(m.width_mm, "mm", surface.cellSize),
                  depthMaxMm: mk(m.depth_max_mm, "mm", m.depth_max_unc_mm ?? null),
                  depthMeanMm: mk(m.depth_mean_mm, "mm", m.depth_mean_unc_mm ?? null),
                  areaM2: mk(m.area_m2, "m2"),
                  volumeL: mk(m.volume_l, "L", null, (m as any).volume_unavailable_reason ?? undefined)
                }
              }
        )
      };
    }
    return { workspace: next, patch: { status: "completed" as const, modelVersion: stage === "T4_surface" ? "geometry.surface" : "geometry.quantify" } };
  }

  /** T4–T5 for a crack: Pan et al. one-stage pipeline on the stored depth grid. */
  private async crackObject(ws: Workspace, surface: Workspace["surfaces"][number], object: Workspace["objects"][number], stage: StageId): Promise<{ workspace: Workspace } | { blocked: string }> {
    const r = await this.engine.call("POST", "/v1/geometry/crack", {
      object_id: surface.objectId,
      unit: surface.unit,
      cell_size: surface.cellSize,
      depth: surface.depth,
      plane_rms: object.quality.planeRmsMm ?? null
    });
    if (!r.ok) return { blocked: unreachable(r) };
    const body = r.body as { unit: string; is_crack: boolean; coverage_pct: number; crack_map: number[][]; skeleton: Array<[number, number]>; metrics: Record<string, number | null> | null; method: string };
    const surfaces = ws.surfaces.map((sf) => (sf.objectId === surface.objectId ? { ...sf, crackMap: body.crack_map, skeleton: body.skeleton } : sf));
    if (stage === "T4_surface") return { workspace: { ...ws, surfaces } };
    const runId = latestRuns(ws.stageRuns).T5_quantify?.runId;
    const metric = body.unit === "mm" && object.quality.scaleStatus === "valid";
    const why = !body.is_crack ? "Bukan crack menurut RANSAC garis (inlier di bawah ambang)" : !metric ? REASON.relativeGeometry : REASON.notMeasured;
    const m = body.metrics ?? {};
    const mk = (value: number | null | undefined, unit: string, unc: number | null = null): Measured =>
      value === null || value === undefined || !metric || !body.is_crack
        ? { value: null, unit, uncertainty: null, provenance: "not_available", source: { stage: "T5_quantify", method: body.method, runId }, reasonUnavailable: why }
        : { value, unit, uncertainty: unc, provenance: object.measurements.lengthMm.provenance === "simulated" || surface.synthetic ? "simulated" : "provisional", source: { stage: "T5_quantify", method: body.method, runId } };
    const objects = ws.objects.map((o) =>
      o.objectId !== object.objectId
        ? o
        : {
            ...o,
            quality: { ...o.quality, coveragePct: body.coverage_pct },
            measurements: {
              ...o.measurements,
              lengthMm: mk(m.length_mm, "mm", surface.cellSize),
              widthMeanMm: mk(m.width_mean_mm, "mm", m.width_unc_mm ?? null),
              widthMaxMm: mk(m.width_max_mm, "mm", m.width_unc_mm ?? null),
              depthMaxMm: mk(m.depth_max_mm, "mm", m.depth_unc_mm ?? null),
              depthMeanMm: mk(m.depth_mean_mm, "mm", m.depth_unc_mm ?? null),
              areaM2: mk(m.area_m2, "m2"),
              volumeL: { value: null, unit: "L", uncertainty: null, provenance: "not_available", source: { stage: "T5_quantify", method: body.method, runId }, reasonUnavailable: "Volume tidak dihitung untuk crack" } as Measured
            }
          }
    );
    return { workspace: { ...ws, surfaces, objects } };
  }

  /**
   * What-if run for a configured vehicle (not stored, no version): one MLET call per axle on
   * the workspace's current layers; the field grid comes from the governing (highest wheel
   * load) axle. Fails explicitly when layers are incomplete or inference is unreachable.
   */
  async vehicleScenario(reportId: string, raw: unknown) {
    const parsed = parseVehicle(raw);
    if ("message" in parsed) return { ok: false as const, status: 400, code: "INVALID", message: parsed.message };
    const ws = await this.load(reportId);
    if (!ws) return { ok: false as const, status: 404, code: "NOT_FOUND", message: "Laporan tidak ditemukan." };
    const vehicle: VehicleConfig = (parsed as { value: VehicleConfig }).value;
    const loads = vehicleLoads(vehicle);
    const bound = ws.layers.filter((l) => l.name !== "Subgrade");
    const sub = ws.layers.find((l) => l.name === "Subgrade");
    if (bound.some((l) => l.thicknessMm.value === null || l.modulusMPa.value === null || l.poisson.value === null) || sub?.modulusMPa.value == null) {
      return { ok: false as const, status: 409, code: "LAYERS_INCOMPLETE", message: "Data lapisan belum lengkap: isi tebal, modulus dan Poisson (tab Structure)." };
    }
    const base = {
      segment_id: ws.reportId,
      layers: bound.map((l) => ({ h_mm: l.thicknessMm.value, E_mpa: l.modulusMPa.value, nu: l.poisson.value, source: l.source })),
      subgrade: { cbr: Math.max(1, Math.min(50, (sub.modulusMPa.value as number) / 10)), E_mpa: sub.modulusMPa.value, nu: sub.poisson.value ?? 0.45 },
      n_mc: 0
    };
    const axles: Array<Record<string, unknown> & { index: number; etUe: number | null }> = [];
    for (const a of loads.axles) {
      const r = await this.engine.call("POST", "/v1/assess", { ...base, load: assessLoadFor(a, vehicle) });
      if (!r.ok) {
        const msg = "unavailable" in r ? "Layanan inference tidak tersedia" : String((r.body as any)?.detail ?? `HTTP ${r.status}`);
        if ("unavailable" in r) return { ok: false as const, status: 503, code: "INFERENCE_UNAVAILABLE", message: msg };
        axles.push({ ...a, etUe: null, evUe: null, error: msg });
        continue;
      }
      const b = r.body as { mlet: { et_ue: number; ev_ue: number; method: string } };
      axles.push({ ...a, etUe: b.mlet.et_ue, evUe: b.mlet.ev_ue, method: b.mlet.method, error: null });
    }
    // Governing axle = the one with the largest computed εt (dual tyres superpose, so the
    // highest single-wheel load is not necessarily the most damaging axle).
    const solved = axles.filter((a) => a.etUe !== null);
    if (!solved.length) return { ok: false as const, status: 422, code: "NOT_SOLVED", message: "MLET tidak dapat menyelesaikan sumbu mana pun" };
    const gov = solved.reduce((m, a) => ((a.etUe as number) > (m.etUe as number) ? a : m));
    const govAxle = loads.axles[gov.index];
    const fr = await this.engine.call("POST", "/v1/assess", { ...base, object_id: ws.objects[0]?.objectId ?? null, load: assessLoadFor(govAxle, vehicle), field_grid: true });
    const field = fr.ok ? (fr.body as any).field : null;
    return {
      ok: true as const,
      scenario: {
        vehicle,
        loads,
        axles,
        governingIndex: gov.index,
        field,
        layersUsed: ws.layers.map((l) => ({ name: l.name, thicknessMm: l.thicknessMm.value, modulusMPa: l.modulusMPa.value, source: l.source })),
        dynamic: "Tidak dimodelkan: MLET statis-linear; kecepatan dicatat tanpa faktor beban dinamis",
        label: "simulated",
        at: this.clock.now()
      }
    };
  }

  private async structural(ws: Workspace) {
    const block = (reason: string, code = "BLOCKED") => ({ workspace: ws, patch: { status: "blocked" as const, reason, errorCode: code } });
    const bound = ws.layers.filter((l) => l.name !== "Subgrade");
    if (bound.some((l) => l.thicknessMm.value === null || l.modulusMPa.value === null || l.poisson.value === null)) return block("Data lapisan belum lengkap (tebal, modulus, Poisson)");
    const sub = ws.layers.find((l) => l.name === "Subgrade");
    const eSub = sub?.modulusMPa.value ?? null;
    if (eSub === null) return block("Modulus subgrade belum diisi");
    const prev = [...ws.structuralRuns].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    const objectId = prev?.objectId ?? ws.objects[0]?.objectId ?? null;
    const lastOf = (kind: string) => [...ws.corrections].reverse().find((c) => c.kind === kind)?.newValue;
    const loadFix = lastOf("load") as { axleT: number; config?: string } | undefined;
    const load: StructuralRun["load"] = loadFix
      ? { axleT: Number(loadFix.axleT), config: loadFix.config ?? "roda ganda 330 mm", source: "MEASURED", esalSource: prev?.load.esalSource ?? "ASSUMED" }
      : prev?.load ?? { axleT: 8.16, config: "sumbu standar, roda ganda 330 mm", source: "DEFAULT", esalSource: "ASSUMED" };
    const criterion = (lastOf("criterion") as "AI" | "AUS" | undefined) ?? "AI";
    const payload = {
      segment_id: ws.reportId,
      object_id: objectId,
      layers: bound.map((l) => ({ h_mm: l.thicknessMm.value, E_mpa: l.modulusMPa.value, nu: l.poisson.value, source: l.source })),
      subgrade: { cbr: Math.max(1, Math.min(50, eSub / 10)), E_mpa: eSub, nu: sub?.poisson.value ?? 0.45 },
      load: { axle_t: load.axleT },
      criterion,
      n_mc: 0,
      field_grid: true
    };
    const r = await this.engine.call("POST", "/v1/assess", payload);
    if (!r.ok) return block(unreachable(r), "INFERENCE_UNAVAILABLE");
    const body = r.body as { mlet: { et_ue: number; ev_ue: number; method: string }; field: any; assumptions: string[]; engine_version: string };
    const runId = this.clock.id("mlet");
    const measured = (value: number): Measured => ({ value, unit: "µε", uncertainty: null, provenance: "simulated", source: { stage: "T7_structural", method: body.mlet.method, runId } });
    const run: StructuralRun = {
      runId,
      objectId,
      engine: "MLET-PyMastic",
      engineVersion: body.mlet.method,
      createdAt: this.clock.now(),
      status: "completed",
      inputHash: inputHash(payload),
      layers: ws.layers,
      load,
      condition: "dry",
      epsTUe: measured(body.mlet.et_ue),
      epsVUe: measured(body.mlet.ev_ue),
      lifeIndexYr: null,
      fieldGrids: body.field
        ? (["eps_xx", "eps_zz", "sigma_zz"] as const).map((variable) => ({ variable, unit: body.field[variable].unit, xMm: body.field.x_mm, zMm: body.field.z_mm, values: body.field[variable].values, wheelsXMm: body.field.wheels_x_mm, interfacesMm: body.field.interfaces_mm }))
        : [],
      assumptions: body.assumptions,
      scenarioLabel: "simulated"
    };
    const workspace: Workspace = {
      ...ws,
      structuralRuns: [...ws.structuralRuns.map((s) => (s.status === "completed" || s.status === "stale" ? { ...s, status: "stale" as const, supersededBy: s.supersededBy ?? runId } : s)), run]
    };
    return { workspace, patch: { status: "completed" as const, modelVersion: body.mlet.method } };
  }
}
