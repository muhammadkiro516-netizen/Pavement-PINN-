import { Router, type Request, type Response } from "express";
import { registerHealthRoutes } from "./health.routes";
import { registerRoadsRoutes } from "./roads.routes";
import { registerPinnRoutes } from "./pinn.routes";
import { registerWorkflowRoutes } from "./workflow.routes";
import { registerSystemRoutes } from "./system.routes";
import { registerIntelligenceRoutes } from "./intelligence.routes";
import { registerCvRoutes } from "./cv.routes";
import { registerWorkspaceRoutes } from "./workspace.routes";
import { registerAuditRoutes } from "./audit.routes";
import type { WorkflowRuntime } from "../services/workflowRuntime";

/**
 * All HTTP API routes. Paths are the pre-restructure paths, taken from the shared
 * API_PATHS contract so server and client cannot drift apart.
 *
 * The six original endpoints have no authentication. The workflow endpoints decide the
 * actor from a server-signed session token and enforce roles, ownership and transitions
 * (docs/api/WORKFLOW_API.md, docs/architecture/RBAC_MATRIX.md).
 */
export function createApiRouter(workflow: WorkflowRuntime): Router {
  const router = Router();

  // Same registration order as before the split.
  registerHealthRoutes(router);
  registerRoadsRoutes(router);
  registerPinnRoutes(router, workflow);
  registerWorkflowRoutes(router, workflow);
  registerSystemRoutes(router, workflow);
  registerIntelligenceRoutes(router, workflow);
  registerCvRoutes(router, workflow);
  registerWorkspaceRoutes(router, workflow);
  registerAuditRoutes(router, workflow);

  // Anything else under /api is an API mistake, not a page: answer JSON 404 instead of
  // letting the request fall through to the SPA host (which replied with HTML, status 200).
  router.use("/api", function apiNotFound(_req: Request, res: Response) {
    res.status(404).json({ success: false, error: "Unknown API endpoint" });
  });

  return router;
}
