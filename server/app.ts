import express, { Express } from "express";
import { createApiRouter } from "./routes";
import { WORKFLOW_API_PATHS } from "../src/types";
import { createWorkflowRuntime, type WorkflowRuntime } from "./services/workflowRuntime";
import { clearSessionCookie, sessionFrom } from "./auth/actor";

export interface AppOptions {
  /** Workflow store, signer and settings. Defaults to an in-memory store (tests, quick starts). */
  workflow?: WorkflowRuntime;
}

/**
 * Assembles the Express application: body parsing first, then the API routes.
 * The frontend host (Vite dev middleware or the static build) is attached afterwards
 * by server/index.ts, so this function has no side effects and is safe to use in tests.
 */
export function createApp(options: AppOptions = {}): Express {
  const app = express();
  // The public link is a tunnel agent on this machine (ngrok / cloudflared): trust its
  // X-Forwarded-For so rate limits see each visitor, not the agent. Only loopback is trusted.
  app.set("trust proxy", "loopback");
  const workflow = options.workflow ?? createWorkflowRuntime();

  app.disable("x-powered-by");
  app.use(function securityHeaders(_req, res, next) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    next();
  });
  // Report bodies may carry one photo (base64, max 5 MB decoded); every other route keeps the 100 kB default.
  // Photos travel as data URLs: report, evidence, project board and the story card (SPEC M4/M6.6).
  app.use([WORKFLOW_API_PATHS.reports, WORKFLOW_API_PATHS.content, "/api/reports", "/api/projects", "/api/share", "/api/v5"], express.json({ limit: "7mb" }));
  app.use(express.json());
  // A request that carries a session the server no longer honours (past its 2-hour deadline,
  // or logged out) is refused, never quietly served as a public visitor: the browser must sign
  // in again. Login, logout and session-start calls are the way out, so they pass.
  const sessionExits = new Set<string>([WORKFLOW_API_PATHS.login, WORKFLOW_API_PATHS.demoSession, WORKFLOW_API_PATHS.anonymousSession, WORKFLOW_API_PATHS.logout, WORKFLOW_API_PATHS.me]);
  app.use("/api", function rejectEndedSessions(req, res, next) {
    if (sessionExits.has(req.originalUrl.split("?")[0])) return next();
    // v5 carries its own signed session header; an old v4 cookie must not block it.
    if (req.originalUrl.startsWith("/api/v5/")) return next();
    const session = sessionFrom(req, workflow);
    if (session.ok === false && (session.reason === "EXPIRED" || session.reason === "REVOKED")) {
      clearSessionCookie(req, res);
      res.status(401).json({ success: false, error: { code: "SESSION_EXPIRED", message: "Sesi Anda telah berakhir. Silakan login kembali." } });
      return;
    }
    next();
  });
  app.use(createApiRouter(workflow));

  return app;
}
