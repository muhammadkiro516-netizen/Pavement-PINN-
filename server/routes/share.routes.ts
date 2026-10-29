import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express, { type Request, type Response, type Router } from "express";
import { actorFrom } from "../auth/actor";
import { rateLimit } from "../middleware/rateLimit";
import type { WorkflowRuntime } from "../services/workflowRuntime";
import { trackingCodeFor } from "../../src/domain/workspace/fromCase";
import { toPublicView } from "../../src/domain/workflow/projections";
import { escalationOf } from "../../src/domain/workflow/escalation";
import type { ReportCase } from "../../src/domain/workflow/model";

const DATA_DIR = process.env.DATA_DIR || ".data";
const OG_DIR = path.join(DATA_DIR, "share-og");
const VISITS_FILE = path.join(DATA_DIR, "share-visits.json");
const CODE = /^[0-9A-F]{3}-[0-9A-F]{4}$/;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

let visits: Record<string, string[]> | null = null;
function loadVisits(): Record<string, string[]> {
  if (!visits) {
    try {
      visits = JSON.parse(fs.readFileSync(VISITS_FILE, "utf8"));
    } catch {
      visits = {};
    }
  }
  return visits!;
}

/** Unique visitors recorded for a share code. */
export function visitsFor(code: string): number {
  return (loadVisits()[code] ?? []).length;
}

/** Unique visitors per code: one salted hash per visitor per day; no IP is stored. */
function recordVisit(code: string, req: Request): number {
  const v = loadVisits();
  const day = new Date().toISOString().slice(0, 10);
  const key = createHash("sha256").update(`${req.ip}|${req.get("user-agent") ?? ""}|${day}|${code}`).digest("hex").slice(0, 16);
  const list = (v[code] ??= []);
  if (!list.includes(key)) {
    list.push(key);
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(VISITS_FILE, JSON.stringify(v));
    } catch {
      /* counting is best effort */
    }
  }
  return list.length;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * SPEC M4.2/M4.4: short link /r/:code with Open Graph (the OG image is the already blurred story
 * card, uploaded by the reporter or staff), unique visit counter, and public facts for the
 * tracking page. No personal data anywhere.
 */
export function registerShareRoutes(router: Router, runtime: WorkflowRuntime): void {
  const service = runtime.service;
  const byCode = async (code: string): Promise<ReportCase | null> => (await service.listCases()).find((c) => trackingCodeFor(c.id) === code) ?? null;

  router.get("/api/share/code/:caseId", async (req: Request, res: Response) => {
    await runtime.ready;
    const c = await service.getCase(req.params.caseId);
    if (!c) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Laporan tidak ditemukan." } });
    res.json({ success: true, code: trackingCodeFor(c.id) });
  });

  router.post("/api/share/:caseId/og", rateLimit("share-og", 20, 60_000), express.json({ limit: "1.5mb" }), async (req: Request, res: Response) => {
    await runtime.ready;
    const actor = actorFrom(req, runtime);
    const c = await service.getCase(req.params.caseId);
    if (!actor || !c) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Laporan tidak ditemukan." } });
    const staff = actor.role === "FIELD_ENGINEER" || actor.role === "OPERATIONS_MANAGER";
    if (!staff && c.createdBy.id !== actor.id) return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Hanya pelapor atau petugas." } });
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.png ?? ""));
    const buf = m ? Buffer.from(m[1], "base64") : null;
    if (!buf || buf.length > 1_000_000 || !buf.subarray(0, 4).equals(PNG_MAGIC)) return res.status(422).json({ success: false, error: { code: "VALIDATION", message: "Kirim kartu PNG (maks. 1 MB)." } });
    fs.mkdirSync(OG_DIR, { recursive: true });
    fs.writeFileSync(path.join(OG_DIR, `${trackingCodeFor(c.id)}.png`), buf);
    res.json({ success: true });
  });

  router.get("/r/:code/og.png", (req: Request, res: Response) => {
    const code = String(req.params.code).toUpperCase();
    const file = path.join(OG_DIR, `${code}.png`);
    if (!CODE.test(code) || !fs.existsSync(file)) return res.status(404).end();
    res.setHeader("Cache-Control", "public, max-age=600");
    res.type("png").send(fs.readFileSync(file));
  });

  router.get("/api/public/share/:code", async (req: Request, res: Response) => {
    await runtime.ready;
    const code = String(req.params.code).toUpperCase();
    const c = CODE.test(code) ? await byCode(code) : null;
    if (!c) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Kode tidak ditemukan." } });
    const v = toPublicView(c);
    const e = escalationOf(c);
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, caseId: c.id, damage: v.report.damageTypeLabel, place: v.report.segmentName, agency: v.authority?.name ?? null, pending: v.pending, hazard: !!v.hazard, waitingDays: e.waitingDays, escalation: e.level, witnesses: v.report.upvotesCount ?? 0, visits: (loadVisits()[code] ?? []).length, timeline: v.timeline });
  });

  router.get("/r/:code", async (req: Request, res: Response) => {
    await runtime.ready;
    const code = String(req.params.code).toUpperCase();
    const c = CODE.test(code) ? await byCode(code) : null;
    const base = `${req.protocol}://${req.get("host")}`;
    const target = `${base}/lacak/${encodeURIComponent(code)}/`;
    if (!c) return res.redirect(302, target);
    recordVisit(code, req);
    const v = toPublicView(c);
    const e = escalationOf(c);
    const title = `${v.report.damageTypeLabel} · ${v.report.segmentName}`;
    const desc = `${e.open ? `Menunggu ${e.waitingDays} hari` : "Sudah ditangani"} · ${v.authority?.name ?? "instansi sedang ditentukan"} · Ikut kawal laporan ini di PavementPINN.`;
    const og = fs.existsSync(path.join(OG_DIR, `${code}.png`)) ? `<meta property="og:image" content="${esc(`${base}/r/${code}/og.png`)}"><meta property="og:image:width" content="1080"><meta property="og:image:height" content="1920">` : "";
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(`${base}/r/${code}`)}">${og}<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0;url=${esc(target)}"></head><body style="background:#0B0D10;color:#fff;font-family:system-ui"><p><a style="color:#FFD60A" href="${esc(target)}">Buka laporan ${esc(code)}</a></p><script>location.replace(${JSON.stringify(target)})</script></body></html>`);
  });
}
