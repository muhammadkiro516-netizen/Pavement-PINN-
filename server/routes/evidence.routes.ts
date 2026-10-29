import fs from "node:fs";
import path from "node:path";
import type { Request, Response, Router } from "express";
import { actorFrom } from "../auth/actor";
import { rateLimit } from "../middleware/rateLimit";
import { REPO_ROOT } from "../runtime/repoRoot";
import type { WorkflowRuntime } from "../services/workflowRuntime";

const DIR = path.join(REPO_ROOT, "measurements");
const NAME = /^[a-z0-9_-]+\.json$/i;

/** SUS (Brooke 1996): odd items positive, even items negative; score 0-100. */
export function susScore(a: number[]): number {
  return a.reduce((s, v, i) => s + (i % 2 === 0 ? v - 1 : 5 - v), 0) * 2.5;
}

/**
 * SPEC M10: the evidence page reads only measurements/*.json (each file carries its date, commit,
 * device and label). SUS answers from the in-app questionnaire are stored as a ledger.
 */
export function registerEvidenceRoutes(router: Router, runtime: WorkflowRuntime): void {
  router.get("/api/public/measurements", (_req: Request, res: Response) => {
    const out: Record<string, unknown> = {};
    if (fs.existsSync(DIR)) {
      for (const f of fs.readdirSync(DIR)) {
        if (!NAME.test(f)) continue;
        try {
          const j = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
          // Large grids stay on disk; the page needs the numbers, not every cell.
          if (j && typeof j === "object") delete (j as Record<string, unknown>).grid;
          out[f.replace(/\.json$/, "")] = j;
        } catch {
          out[f.replace(/\.json$/, "")] = { error: "unreadable" };
        }
      }
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, measurements: out });
  });

  router.post("/api/sus", rateLimit("sus", 5, 60_000), async (req: Request, res: Response) => {
    await runtime.ready;
    const actor = actorFrom(req, runtime);
    if (!actor) return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Masuk dulu." } });
    const a = req.body?.answers;
    if (!Array.isArray(a) || a.length !== 10 || !a.every((v) => Number.isInteger(v) && v >= 1 && v <= 5)) {
      return res.status(422).json({ success: false, error: { code: "VALIDATION", message: "10 jawaban skala 1-5." } });
    }
    const prev = (await runtime.service.listRecords("sus")).find((r) => r.by === actor.id);
    const r = await runtime.service.putRecord("sus", { id: prev?.id, by: actor.id, role: actor.role, answers: a, score: susScore(a) });
    if (r.ok === false) return res.status(500).json({ success: false, error: { code: r.code, message: r.message } });
    res.status(201).json({ success: true, score: susScore(a) });
  });
}
