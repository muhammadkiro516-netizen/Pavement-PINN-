import { createHash } from "node:crypto";
import express, { type Request, type Response, type Router } from "express";
import { rateLimit } from "../middleware/rateLimit";
import { actorFrom } from "../auth/actor";
import { callInference, callInferenceBytes } from "../services/inferenceClient";
import { MAX_PHOTO_BYTES } from "../services/photoValidation";
import type { WorkflowRuntime } from "../services/workflowRuntime";
import type { CvAnalysis, CvJobView } from "../../src/types/cv";

export const CV_PATHS = {
  health: "/api/cv/health",
  jobs: "/api/cv/jobs",
  job: "/api/cv/jobs/:jobId",
  analysis: "/api/cv/analyses/:id",
  overlay: "/api/cv/analyses/:id/overlay",
  mask: "/api/cv/analyses/:id/mask",
  video: "/api/cv/analyze-video",
  live: "/api/cv/live"
} as const;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const JOB_ID = /^CVJ-[0-9A-F]{16}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9-]{8,64}$/;

function fail(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ success: false, error: { code, message } });
}

/** Error body of the Python service: {detail: {code, message}} or a plain string. */
function inferenceError(body: unknown): { code: string; message: string } {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (detail && typeof detail === "object" && "code" in detail) return detail as { code: string; message: string };
  return { code: "INFERENCE_ERROR", message: typeof detail === "string" ? detail : "Inference service rejected the image." };
}

interface PendingJob {
  imageSha256: string;
  analysisId?: string;
}

/**
 * Road-damage Computer Vision. Express validates and forwards the photo bytes to the Python
 * engine, follows the asynchronous job, and on completion stores the analysis and its
 * artefacts server-side. A report later cites the analysis by id (workflow.routes).
 */
export function registerCvRoutes(router: Router, runtime: WorkflowRuntime): void {
  const jobLimit = rateLimit("cv-jobs", 30, 60_000);
  const pending = new Map<string, PendingJob>();
  const byKey = new Map<string, string>();
  const raw = express.raw({ type: IMAGE_TYPES, limit: MAX_PHOTO_BYTES });

  // Camera preview: detector + scene on a small frame, several times a second. Signed-in only,
  // limited per account (not per IP), nothing stored: the captured photo is the evidence.
  const liveLimit = rateLimit("cv-live", 240, 60_000, (req) => actorFrom(req, runtime)?.id ?? null);
  const liveRaw = express.raw({ type: "image/jpeg", limit: 300_000 });
  router.post(CV_PATHS.live, liveLimit, liveRaw, async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    if (!actorFrom(req, runtime)) return fail(res, 401, "UNAUTHENTICATED", "Sign in to use the live camera check.");
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return fail(res, 422, "INVALID_IMAGE", "No frame received.");
    const reply = await callInferenceBytes("/v1/cv/live", req.body, "image/jpeg", 2500);
    if ("unavailable" in reply) return fail(res, 503, "INFERENCE_UNAVAILABLE", reply.message);
    if (!reply.ok) return fail(res, reply.status, inferenceError(reply.body).code, inferenceError(reply.body).message);
    res.json({ success: true, live: reply.body });
  });

  router.get(CV_PATHS.health, async (_req: Request, res: Response) => {
    const reply = await callInference("GET", "/v1/cv/health");
    if ("unavailable" in reply) return fail(res, 503, "INFERENCE_UNAVAILABLE", reply.message);
    res.json({ success: true, result: reply.body });
  });

  router.post(CV_PATHS.jobs, jobLimit, raw, async (req: Request, res: Response) => {
    const type = String(req.headers["content-type"] ?? "").split(";")[0];
    if (!IMAGE_TYPES.includes(type)) return fail(res, 415, "UNSUPPORTED_TYPE", "Send the photo as JPEG, PNG or WebP bytes.");
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return fail(res, 422, "INVALID_IMAGE", "No image bytes received.");
    const sha = createHash("sha256").update(req.body).digest("hex");
    // A retry with the same key and the same bytes returns the existing job instead of a new one.
    const key = typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : null;
    if (key && !IDEMPOTENCY_KEY.test(key)) return fail(res, 422, "VALIDATION", "Idempotency-Key must be 8-64 letters, digits or dashes.");
    const known = key ? byKey.get(`${key}:${sha}`) : undefined;
    if (known) return res.status(202).json({ success: true, job: { jobId: known, state: "queued", stage: "queued", stages: [] } });

    const reply = await callInferenceBytes("/v1/cv/jobs", req.body, type, 20_000);
    if ("unavailable" in reply) return fail(res, 503, "INFERENCE_UNAVAILABLE", reply.message);
    if (!reply.ok) {
      const e = inferenceError(reply.body);
      return fail(res, reply.status, e.code, e.message);
    }
    const job = reply.body as { jobId: string };
    pending.set(job.jobId, { imageSha256: sha });
    if (key) byKey.set(`${key}:${sha}`, job.jobId);
    if (pending.size > 1000) pending.delete(pending.keys().next().value as string);
    if (byKey.size > 1000) byKey.delete(byKey.keys().next().value as string);
    res.status(202).json({ success: true, job });
  });

  router.get(CV_PATHS.job, async (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    const mine = pending.get(jobId);
    if (!JOB_ID.test(jobId) || !mine) return fail(res, 404, "NOT_FOUND", "Unknown CV job.");
    if (mine.analysisId) {
      const rec = await runtime.cv.get(mine.analysisId);
      if (rec) return res.json({ success: true, job: { jobId, state: "done", stage: "done", stages: [], analysis: rec.analysis } satisfies CvJobView });
    }
    const reply = await callInference("GET", `/v1/cv/jobs/${jobId}`);
    if ("unavailable" in reply) return fail(res, 503, "INFERENCE_UNAVAILABLE", reply.message);
    if (!reply.ok) return fail(res, reply.status, inferenceError(reply.body).code, inferenceError(reply.body).message);
    const job = reply.body as CvJobView & { result?: CvAnalysis & { overlayJpegBase64?: string; segmentation?: { maskPngBase64?: string | null } } };
    if (job.state !== "done" || !job.result) {
      const { result: _r, ...view } = job;
      void _r;
      return res.json({ success: true, job: view });
    }
    const result = job.result;
    // Artefacts must belong to the bytes this server received.
    if (result.image.sha256 !== mine.imageSha256) return fail(res, 502, "ARTEFACT_MISMATCH", "Inference result does not match the uploaded image.");
    const overlay = result.overlayJpegBase64 ? Buffer.from(result.overlayJpegBase64, "base64") : null;
    const maskB64 = result.segmentation?.maskPngBase64;
    const mask = maskB64 ? Buffer.from(maskB64, "base64") : null;
    delete result.overlayJpegBase64;
    if (result.segmentation) delete result.segmentation.maskPngBase64;
    const id = result.analysisId;
    const analysis: CvAnalysis = {
      ...result,
      overlayUrl: overlay ? CV_PATHS.overlay.replace(":id", id) : null,
      maskUrl: mask ? CV_PATHS.mask.replace(":id", id) : null,
      createdAt: new Date().toISOString()
    };
    try {
      await runtime.cv.put({ analysis, imageSha256: mine.imageSha256, reportId: null }, overlay, mask);
    } catch (error: any) {
      return fail(res, 500, "PERSISTENCE_FAILED", `Analysis could not be stored: ${error?.message ?? error}`);
    }
    mine.analysisId = id;
    const view: CvJobView = { jobId, state: "done", stage: "done", stages: job.stages, analysis };
    res.json({ success: true, job: view });
  });

  router.get(CV_PATHS.analysis, async (req: Request, res: Response) => {
    const rec = await runtime.cv.get(req.params.id);
    if (!rec) return fail(res, 404, "NOT_FOUND", "Unknown analysis.");
    res.json({ success: true, analysis: rec.analysis, reportId: rec.reportId });
  });

  for (const [p, kind, mime] of [[CV_PATHS.overlay, "overlay", "image/jpeg"], [CV_PATHS.mask, "mask", "image/png"]] as const) {
    router.get(p, async (req: Request, res: Response) => {
      const buf = await runtime.cv.artefact(req.params.id, kind);
      if (!buf) return fail(res, 404, "NOT_FOUND", "Artefact not found.");
      res.setHeader("Content-Type", mime);
      res.setHeader("Cache-Control", "private, max-age=86400, immutable");
      res.send(buf);
    });
  }

  router.post(CV_PATHS.video, rateLimit("cv-video", 5, 60_000), express.raw({ type: ["video/mp4", "video/webm", "video/quicktime"], limit: 50 * 1024 * 1024 }), async (req: Request, res: Response) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return fail(res, 415, "UNSUPPORTED_TYPE", "Send MP4, WebM or MOV bytes.");
    const fps = Number(req.query.fps ?? 1);
    const reply = await callInferenceBytes(`/v1/cv/analyze-video?fps=${Number.isFinite(fps) ? fps : 1}`, req.body, String(req.headers["content-type"]), 300_000);
    if ("unavailable" in reply) return fail(res, 503, "INFERENCE_UNAVAILABLE", reply.message);
    if (!reply.ok) return fail(res, reply.status, inferenceError(reply.body).code, inferenceError(reply.body).message);
    res.json({ success: true, result: reply.body });
  });
}
