import type { Request, Response, Router } from "express";
import { WORKFLOW_API_PATHS } from "../../src/types";
import { callInference, type InferenceReply } from "../services/inferenceClient";
import type { WorkflowRuntime } from "../services/workflowRuntime";

/**
 * GET /api/system-health — which parts of the system are actually live, by component.
 * States are reported as found, never upgraded: a demo or missing component says so.
 */
export function registerSystemRoutes(router: Router, runtime: WorkflowRuntime): void {
  router.get(WORKFLOW_API_PATHS.systemHealth, async (_req: Request, res: Response) => {
    const [cvReply, engineReply] = await Promise.all([callInference("GET", "/v1/cv/health"), callInference("GET", "/v1/health")]);
    const live = (reply: InferenceReply) => ("unavailable" in reply ? { status: "UNAVAILABLE", detail: reply.message } : { status: reply.ok ? "OK" : "ERROR", detail: reply.body });
    const cvHealth = live(cvReply);
    const engineHealth = live(engineReply);
    let storage: { status: "ok" | "error"; kind: string; detail: string };
    try {
      await runtime.ready;
      const n = (await runtime.service.listCases()).length;
      storage = {
        status: "ok",
        kind: runtime.storeKind === "file" ? "LOCAL_FILE (one server, daily backup)" : "MEMORY (not persisted)",
        detail: `${n} report cases`
      };
    } catch (error) {
      storage = { status: "error", kind: runtime.storeKind, detail: (error as Error).message };
    }
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      application: { status: "ok" },
      storage,
      photos: { status: "LOCAL", detail: "Photos are kept inside report records (base64, max 5 MB)." },
      authentication: runtime.demoAuthEnabled
        ? { status: "TEST_FIXTURES", detail: "Fixture identities enabled (DEMO_AUTH=true); never on the product server." }
        : { status: "ACCOUNTS", detail: `Registered accounts with scrypt passwords and server-signed sessions (${runtime.accounts.list().length} accounts).` },
      ai: {
        // Read live from the inference service, never upgraded: unreachable means unavailable.
        computerVision: cvHealth,
        structural: engineHealth,
        screening: { status: runtime.demoAuthEnabled ? "DEMO" : "REAL", detail: "Only a server-verified OpenVINO result can pass screening; everything else goes to human review." }
      }
    });
  });
}
