import fs from "node:fs";
import path from "node:path";
import express, { type Request, type Response, type Router } from "express";
import { actorFrom } from "../auth/actor";
import { rateLimit } from "../middleware/rateLimit";
import { callInference } from "../services/inferenceClient";
import { MATERIAL_CATALOGUE } from "../services/materials";
import { REPO_ROOT } from "../runtime/repoRoot";
import { checkPhotoReference, stripPhotoMetadata } from "../services/photoValidation";
import type { WorkflowRuntime } from "../services/workflowRuntime";
import { auditFlags, RESPONSES, underReview } from "../../src/domain/audit/flags";
import { fairCost, type PriceBook } from "../../src/domain/audit/fairness";
import { repairLives } from "../../src/domain/roads/recurrence";
import type { Actor } from "../../src/domain/workflow/model";

const PRICE_FILE = path.join(REPO_ROOT, "config", "prices", "jabodetabek.json");
const loadPrices = (): PriceBook => JSON.parse(fs.readFileSync(PRICE_FILE, "utf8"));
const MIN_THICKNESS = Object.fromEntries(MATERIAL_CATALOGUE.materials.map((m) => [m.id, m.minThicknessCm]));
const ROAD_CLASS: Record<string, string> = { NASIONAL: "NASIONAL", TOL: "TOL", PROVINSI: "PROVINSI", KOTA: "KOTA", KABUPATEN: "KABUPATEN" };

function fail(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ success: false, error: { code, message } });
}

const isStaff = (a: Actor | null) => !!a && (a.role === "FIELD_ENGINEER" || a.role === "OPERATIONS_MANAGER");
const isLeader = (a: Actor | null) => !!a && (a.role === "OPERATIONS_MANAGER" || a.role === "POLICY_MAKER");

/**
 * SPEC M5.1 (PINN-2 diagnosis + Koordinator decision), M6 (audit flags, fair cost, project data).
 * Observations for the diagnosis are gathered here from recorded data, never typed by the client.
 */
export function registerAuditRoutes(router: Router, runtime: WorkflowRuntime): void {
  const service = runtime.service;
  const json = express.json({ limit: "6mb" });
  const limit = rateLimit("audit-write", 30, 60_000, (req) => actorFrom(req, runtime)?.id ?? null);

  router.get("/api/prices", (_req: Request, res: Response) => res.json({ success: true, ...loadPrices() }));

  router.post("/api/audit/fair-cost", json, (req: Request, res: Response) => {
    if (!isStaff(actorFrom(req, runtime)) && !isLeader(actorFrom(req, runtime))) return fail(res, 403, "FORBIDDEN", "Staf instansi saja.");
    const b = req.body ?? {};
    const thicknessCm = Number(b.thicknessCm), areaM2 = Number(b.areaM2);
    if (typeof b.materialId !== "string" || !(thicknessCm > 0) || !(areaM2 > 0)) return fail(res, 422, "VALIDATION", "materialId, thicknessCm, areaM2 wajib.");
    res.json({ success: true, result: fairCost({ materialId: b.materialId, thicknessCm, areaM2, valueIdr: b.valueIdr == null || b.valueIdr === "" ? null : Number(b.valueIdr) }, loadPrices()) });
  });

  router.get("/api/audit/flags", async (req: Request, res: Response) => {
    await runtime.ready;
    if (!isLeader(actorFrom(req, runtime))) return fail(res, 403, "FORBIDDEN", "Koordinator atau Pimpinan saja.");
    const flags = auditFlags(await service.listCases(), await service.listRepairConfirmations(), loadPrices(), (await service.listRecords("auditResponses")) as never, MIN_THICKNESS);
    const seg = typeof req.query.segment === "string" ? req.query.segment : null;
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, items: seg ? flags.filter((f) => f.segmentId === seg) : flags });
  });

  // SPEC M6.5: the Koordinator must answer each flag: explain, schedule a test, or reject with a reason.
  router.post("/api/audit/flags/:flagId/response", limit, json, async (req: Request, res: Response) => {
    await runtime.ready;
    const actor = actorFrom(req, runtime);
    if (actor?.role !== "OPERATIONS_MANAGER") return fail(res, 403, "FORBIDDEN", "Hanya Koordinator yang menanggapi flag audit.");
    const response = req.body?.response;
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!(RESPONSES as readonly string[]).includes(response) || reason.length < 5 || reason.length > 1000) return fail(res, 422, "VALIDATION", "response (JELASKAN|JADWALKAN_UJI|TOLAK) dan alasan (min. 5 karakter) wajib.");
    const testResult = typeof req.body?.testResult === "string" ? req.body.testResult.slice(0, 1000) : null;
    const r = await service.putRecord("auditResponses", { by: actor.id, flagId: req.params.flagId, response, reason, testResult });
    if (r.ok === false) return fail(res, 500, r.code, r.message);
    res.status(201).json({ success: true, record: r.value });
  });

  // Public: only "Sedang dalam pemeriksaan teknis", no details, no names (SPEC M6.5).
  router.get("/api/public/under-review", async (_req: Request, res: Response) => {
    await runtime.ready;
    const flags = auditFlags(await service.listCases(), await service.listRepairConfirmations(), loadPrices(), (await service.listRecords("auditResponses")) as never, MIN_THICKNESS);
    res.json({ success: true, caseIds: underReview(flags) });
  });

  // SPEC M5.1: PINN-2 diagnosis for a road segment from recorded observations.
  router.post("/api/engine/diagnose", limit, json, async (req: Request, res: Response) => {
    await runtime.ready;
    const actor = actorFrom(req, runtime);
    if (!isStaff(actor) && !isLeader(actor)) return fail(res, 403, "FORBIDDEN", "Staf instansi saja.");
    const segmentId = String(req.body?.segmentId ?? "");
    const esalYear = Number(req.body?.esalYear);
    if (!segmentId || !(esalYear > 0)) return fail(res, 422, "VALIDATION", "segmentId dan esalYear (> 0) wajib.");
    const cases = (await service.listCases()).filter((c) => c.segmentId === segmentId && c.dataStatus !== "SYNTHETIC");
    const lives = repairLives(cases, await service.listRepairConfirmations());
    const failed90 = lives.filter((l) => !l.censored && l.days <= 90).length;
    const observed90 = lives.filter((l) => (!l.censored && l.days <= 90) || l.days >= 90).length;
    const alligator = cases.some((c) => c.inspection?.verdict === "CONFIRMED" && /ALLIGATOR|BUAYA/i.test(`${c.inspection?.cvReview?.correctedClass ?? ""} ${c.report.damageType ?? ""}`));
    const project = (await service.listRecords("projects")).filter((p) => p.segmentId === segmentId && p.verifiedBy).sort((a, b) => Number(b.year) - Number(a.year))[0];
    const level = cases.find((c) => c.authority?.level)?.authority?.level ?? "KABUPATEN";
    const body = {
      segment_id: segmentId,
      road_class: ROAD_CLASS[level] ?? "KABUPATEN",
      esal_year: esalYear,
      growth: Number(req.body?.growth ?? 0.035),
      wet_months: Math.round(Number(req.body?.wetMonths ?? 5)),
      prior: project?.layers ?? null,
      observations: {
        alligator: cases.length ? alligator : null,
        years_since_overlay: project?.year ? Math.max(0, new Date().getFullYear() - Number(project.year)) : null,
        repairs_observed: observed90,
        repairs_failed_90d: failed90,
        odol_share: req.body?.odolShare == null ? null : Number(req.body.odolShare)
      }
    };
    const reply = await callInference("POST", "/v1/diagnose", body);
    if ("unavailable" in reply) return fail(res, 503, "INFERENCE_UNAVAILABLE", reply.message);
    if (!reply.ok) return fail(res, reply.status, "INFERENCE_ERROR", JSON.stringify((reply.body as { detail?: unknown })?.detail ?? reply.body).slice(0, 300));
    res.json({ success: true, result: reply.body, inputs: { ...body, project: project ? { id: project.id, name: project.name } : null } });
  });

  // SPEC M5.1.6: the Koordinator agrees or overrides with a reason; kept for calibration.
  router.post("/api/roads/:segmentId/diagnosis-decision", limit, json, async (req: Request, res: Response) => {
    await runtime.ready;
    const actor = actorFrom(req, runtime);
    if (actor?.role !== "OPERATIONS_MANAGER") return fail(res, 403, "FORBIDDEN", "Hanya Koordinator.");
    const decision = req.body?.decision;
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    const verdict = req.body?.modelVerdict;
    const override = req.body?.overrideVerdict ?? null;
    if ((decision !== "SETUJU" && decision !== "TIMPA") || reason.length < 5 || !["RED", "YELLOW", "GREEN"].includes(verdict) || (decision === "TIMPA" && !["RED", "YELLOW", "GREEN"].includes(override))) {
      return fail(res, 422, "VALIDATION", "decision SETUJU|TIMPA, modelVerdict, overrideVerdict (untuk TIMPA) dan alasan wajib.");
    }
    const r = await service.putRecord("diagnosisDecisions", { by: actor.id, segmentId: req.params.segmentId, decision, modelVerdict: verdict, overrideVerdict: override, reason, remainingLife: req.body?.remainingLife ?? null, title: typeof req.body?.title === "string" ? req.body.title.slice(0, 60) : null, dominantFactor: typeof req.body?.dominantFactor === "string" ? req.body.dominantFactor.slice(0, 60) : null, confidence: typeof req.body?.confidence === "string" ? req.body.confidence.slice(0, 20) : null });
    if (r.ok === false) return fail(res, 500, r.code, r.message);
    res.status(201).json({ success: true, record: r.value });
  });

  router.get("/api/roads/:segmentId/diagnosis-decisions", async (req: Request, res: Response) => {
    await runtime.ready;
    if (!isStaff(actorFrom(req, runtime)) && !isLeader(actorFrom(req, runtime))) return fail(res, 403, "FORBIDDEN", "Staf instansi saja.");
    res.json({ success: true, items: (await service.listRecords("diagnosisDecisions")).filter((d) => d.segmentId === req.params.segmentId) });
  });

  // SPEC M7: draft "Usulan Penanganan Ruas" — facts from records, prose from the local SLM, numbers from code.
  router.post("/api/roads/:segmentId/proposal", limit, json, async (req: Request, res: Response) => {
    await runtime.ready;
    const actor = actorFrom(req, runtime);
    if (!isLeader(actor)) return fail(res, 403, "FORBIDDEN", "Koordinator atau Pimpinan saja.");
    const segmentId = req.params.segmentId;
    const all = (await service.listCases()).filter((c) => c.segmentId === segmentId && c.dataStatus !== "SYNTHETIC");
    const open = all.filter((c) => !["RESOLVED", "CLOSED"].includes(c.state));
    const lives = repairLives(all, await service.listRepairConfirmations());
    const failed = lives.filter((l) => !l.censored && l.days <= 91).length;
    const observed = lives.filter((l) => (!l.censored && l.days <= 91) || l.days >= 91).length;
    const decision = (await service.listRecords("diagnosisDecisions")).filter((d) => d.segmentId === segmentId).at(-1);
    const flags = auditFlags(all, await service.listRepairConfirmations(), loadPrices(), (await service.listRecords("auditResponses")) as never, MIN_THICKNESS);
    const life = decision?.remainingLife as { p10: number; p50: number; p90: number } | undefined;
    const TITLE: Record<string, string> = { RED: "Perlu lapis ulang", YELLOW: "Pantau", GREEN: "Tambal cukup" };
    const verdict = decision ? String(decision.decision === "TIMPA" ? decision.overrideVerdict : decision.modelVerdict) : null;
    const facts = {
      damage_types: [...new Set(open.map((c) => c.report.damageTypeLabel.toLowerCase()))].slice(0, 5),
      diagnosis: decision ? { title: TITLE[verdict!] ?? decision.title, confidence: decision.confidence ?? "-", dominant_factor: decision.dominantFactor ?? "-", decision: decision.decision === "TIMPA" ? "ditimpa Koordinator dengan alasan" : "disetujui Koordinator" } : null,
      recurrence_known: observed > 0,
      flags: [...new Set(flags.map((f) => f.title))],
      fair_cost_known: false,
      hazard_missing: open.some((c) => !c.hazard && ["SEVERE", "CRITICAL"].includes(c.inspection?.severity ?? c.report.severity))
    };
    const values: Record<string, string> = {
      RUAS: open[0]?.report.segmentName ?? all[0]?.report.segmentName ?? segmentId,
      INSTANSI: all.find((c) => c.authority)?.authority?.name ?? "instansi berwenang",
      LAPORAN_TERBUKA: String(open.length),
      ...(life ? { SISA_UMUR: `${life.p10}–${life.p90} tahun (P10–P90, median ${life.p50})` } : {}),
      ...(observed ? { BERULANG: `${failed} dari ${observed} perbaikan` } : {})
    };
    // Two SLM attempts on a CPU can take over a minute.
    const reply = await callInference("POST", "/v1/proposal", { facts, values }, 180_000);
    if ("unavailable" in reply) return fail(res, 503, "INFERENCE_UNAVAILABLE", reply.message);
    if (!reply.ok) return fail(res, reply.status, "INFERENCE_ERROR", JSON.stringify((reply.body as { detail?: unknown })?.detail ?? reply.body).slice(0, 300));
    res.json({ success: true, draft: reply.body, facts, values });
  });

  router.post("/api/roads/:segmentId/proposal/approve", limit, json, async (req: Request, res: Response) => {
    await runtime.ready;
    const actor = actorFrom(req, runtime);
    if (!isLeader(actor)) return fail(res, 403, "FORBIDDEN", "Koordinator atau Pimpinan saja.");
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    if (text.length < 40 || text.length > 8000 || note.length < 5) return fail(res, 422, "VALIDATION", "Teks usulan dan catatan persetujuan (min. 5 karakter) wajib.");
    const r = await service.putRecord("proposals", { by: actor!.id, segmentId: req.params.segmentId, text, note, source: req.body?.source === "SLM" ? "SLM" : "TEMPLAT", device: typeof req.body?.device === "string" ? req.body.device : null });
    if (r.ok === false) return fail(res, 500, r.code, r.message);
    res.status(201).json({ success: true, record: r.value });
  });

  // SPEC M6.6: project data (manual form + photo of the project board); verified by a Koordinator.
  router.get("/api/projects", async (req: Request, res: Response) => {
    await runtime.ready;
    if (!isStaff(actorFrom(req, runtime)) && !isLeader(actorFrom(req, runtime))) return fail(res, 403, "FORBIDDEN", "Staf instansi saja.");
    const seg = typeof req.query.segment === "string" ? req.query.segment : null;
    const items = (await service.listRecords("projects")).filter((p) => !seg || p.segmentId === seg).map((p) => ({ ...p, photoUrl: p.photoUrl ? true : false }));
    res.json({ success: true, items });
  });

  router.post("/api/projects", limit, json, async (req: Request, res: Response) => {
    await runtime.ready;
    const actor = actorFrom(req, runtime);
    if (!isStaff(actor)) return fail(res, 403, "FORBIDDEN", "Petugas atau Koordinator saja.");
    const b = req.body ?? {};
    const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
    const name = typeof b.name === "string" ? b.name.trim().slice(0, 200) : "";
    const year = num(b.year);
    if (!name || typeof b.segmentId !== "string" || !year || year < 1980 || year > 2100) return fail(res, 422, "VALIDATION", "Nama kegiatan, ruas dan tahun wajib.");
    if (!["PAPAN_PROYEK", "SIRUP_LPSE", "DINAS", "LAINNYA"].includes(b.source)) return fail(res, 422, "VALIDATION", "Sumber: PAPAN_PROYEK | SIRUP_LPSE | DINAS | LAINNYA.");
    let photoUrl: string | null = null;
    if (b.photoUrl) {
      const p = checkPhotoReference(b.photoUrl);
      if (p.ok === false) return fail(res, 422, "VALIDATION", `Foto: ${p.message}`);
      photoUrl = stripPhotoMetadata(b.photoUrl);
    }
    const thicknessCm = num(b.thicknessCm);
    const layers = b.layers && typeof b.layers === "object" ? b.layers : null;
    const r = await service.putRecord("projects", {
      by: actor!.id, name, segmentId: b.segmentId, year, mix: typeof b.mix === "string" ? b.mix : null, thicknessCm, areaM2: num(b.areaM2), lengthM: num(b.lengthM),
      valueIdr: num(b.valueIdr), maintenanceMonths: num(b.maintenanceMonths), source: b.source, photoUrl, layers, verifiedBy: null, label: "DARI_INPUT"
    });
    if (r.ok === false) return fail(res, 500, r.code, r.message);
    res.status(201).json({ success: true, record: { ...r.value, photoUrl: !!photoUrl } });
  });

  router.post("/api/projects/:id/verify", limit, async (req: Request, res: Response) => {
    await runtime.ready;
    const actor = actorFrom(req, runtime);
    if (actor?.role !== "OPERATIONS_MANAGER") return fail(res, 403, "FORBIDDEN", "Hanya Koordinator yang memverifikasi data proyek.");
    const r = await service.putRecord("projects", { id: req.params.id, by: actor.id, verifiedBy: actor.id, verifiedAt: new Date().toISOString() });
    if (r.ok === false) return fail(res, r.code === "NOT_FOUND" ? 404 : 500, r.code, r.message);
    res.json({ success: true, record: { ...r.value, photoUrl: !!r.value.photoUrl } });
  });
}
