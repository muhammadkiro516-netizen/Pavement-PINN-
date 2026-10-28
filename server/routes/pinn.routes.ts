import type { Request, Response, Router } from "express";
import { API_PATHS } from "../../src/types";
import { actorFrom } from "../auth/actor";
import { rateLimit } from "../middleware/rateLimit";
import { callInference, type InferenceReply } from "../services/inferenceClient";
import type { WorkflowRuntime } from "../services/workflowRuntime";

export const ENGINE_ASSESS_PATH = "/api/engine/assess";
export const ENGINE_HEALTH_PATH = "/api/engine/health";
export const ENGINE_DECIDE_PATH = "/api/engine/decide";
export const ENGINE_VEHICLES_PATH = "/api/engine/vehicle-classes";

/** First validation message from FastAPI ({detail: string | [{loc, msg}]}), for the UI. */
function describe(body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail[0]?.msg) {
    const loc = Array.isArray(detail[0].loc) ? detail[0].loc.filter((p: unknown) => p !== "body").join(".") : "";
    return loc ? `${loc}: ${detail[0].msg}` : String(detail[0].msg);
  }
  return "Inference service rejected the request.";
}

function relay(res: Response, reply: InferenceReply) {
  if ("unavailable" in reply) {
    return res.status(503).json({ success: false, error: { code: "INFERENCE_UNAVAILABLE", message: reply.message } });
  }
  if (!reply.ok) {
    const code = reply.status === 422 ? "VALIDATION" : "INFERENCE_ERROR";
    return res.status(reply.status).json({ success: false, error: { code, message: describe(reply.body), detail: reply.body } });
  }
  return res.json({ success: true, result: reply.body });
}

/**
 * Structural engine (milestone M1). The closed-form browser engine behind /api/simulate is
 * retired (audit F-03, F-11); the layered-elastic solver runs in the Python service.
 */
export function registerPinnRoutes(router: Router, runtime: WorkflowRuntime): void {
  const assessLimit = rateLimit("engine-assess", 60, 60_000);

  router.post(API_PATHS.simulate, (_req: Request, res: Response) => {
    res.status(410).json({ success: false, error: { code: "GONE", message: `Retired: the rule-based engine is replaced by POST ${ENGINE_ASSESS_PATH}.` } });
  });

  router.get(ENGINE_HEALTH_PATH, async (_req: Request, res: Response) => {
    relay(res, await callInference("GET", "/v1/health"));
  });

  // Field Engineer only, like What-If (D-032); the Python service validates ranges (422).
  router.post(ENGINE_ASSESS_PATH, assessLimit, async (req: Request, res: Response) => {
    await runtime.ready;
    const actor = actorFrom(req, runtime);
    if (!actor) return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Structural assessment requires an engineer session." } });
    if (actor.role !== "FIELD_ENGINEER") return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Structural assessment is limited to field engineers." } });
    relay(res, await callInference("POST", "/v1/assess", req.body ?? {}));
  });

  // One structural decision (damage -> modulus, traffic with ODOL, seasonal life, overlay and
  // reconstruction options) for field officers and coordinators.
  const decideLimit = rateLimit("engine-decide", 30, 60_000, (req) => actorFrom(req, runtime)?.id ?? null);
  router.post(ENGINE_DECIDE_PATH, decideLimit, async (req: Request, res: Response) => {
    await runtime.ready;
    const actor = actorFrom(req, runtime);
    if (!actor) return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Sign in as staff." } });
    if (actor.role !== "FIELD_ENGINEER" && actor.role !== "OPERATIONS_MANAGER") {
      return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Structural decisions are for field officers and coordinators." } });
    }
    relay(res, await callInference("POST", "/v1/decide", req.body ?? {}));
  });

  router.get(ENGINE_VEHICLES_PATH, async (_req: Request, res: Response) => {
    relay(res, await callInference("GET", "/v1/decide/vehicle-classes"));
  });
}
