import type { Request, Response, Router } from "express";
import { WORKFLOW_API_PATHS } from "../../src/types";
import { isOfficialRole } from "../../src/domain/access";
import { assessSegment, type AssessmentInputs } from "../../src/domain/intelligence/assessment";
import { explainAssessment } from "../../src/domain/intelligence/explain";
import { runWhatIf } from "../../src/domain/intelligence/whatIf";
import { buildRoadStory } from "../../src/domain/intelligence/roadStory";
import { rateLimit } from "../middleware/rateLimit";
import type { WorkflowRuntime } from "../services/workflowRuntime";
import { actorFrom } from "../auth/actor";
import { ALL_SEGMENTS, segmentById } from "../services/segments";


export const ASSESSMENT_PATH = "/api/road-segments/:id/assessment";
export const SIMULATIONS_PATH = "/api/simulations";
export const SIMULATION_PATH = "/api/simulations/:id";
export const SEGMENT_PATH = "/api/road-segments/:id";
export const PROVENANCE_PATH = "/api/provenance/:entityType/:id";

/** Validated ranges for scenario inputs (engine ranges; spec Lampiran L: out of range → 422). */
const SCENARIO_RANGES: Record<keyof AssessmentInputs, [number, number]> = {
  axleLoadTon: [10, 25],
  rainIntensityMmHr: [0, 100],
  floodDurationHours: [0, 48],
  surfaceTemperatureC: [25, 60],
  subgradeCbrPercent: [3, 10],
  asphaltThicknessCm: [5, 25],
  asphaltModulusMpa: [1200, 3500]
};

const SCENARIO_KEYS: Array<keyof AssessmentInputs> = [
  "axleLoadTon",
  "rainIntensityMmHr",
  "floodDurationHours",
  "surfaceTemperatureC",
  "subgradeCbrPercent",
  "asphaltThicknessCm",
  "asphaltModulusMpa"
];

export function registerIntelligenceRoutes(router: Router, runtime: WorkflowRuntime): void {
  const simulateLimit = rateLimit("what-if", 60, 60_000);

  router.get(WORKFLOW_API_PATHS.riskMap, async (_req: Request, res: Response) => {
    await runtime.ready;
    const now = new Date().toISOString();
    const cases = await runtime.service.listCases();
    const items = ALL_SEGMENTS.map((segment) => {
      const a = assessSegment(segment, { now, cases });
      return {
        segmentId: segment.id,
        name: segment.name,
        pilot: !!segment.pilot,
        risk: a.risk,
        conditionScorePrototype: a.outputs.conditionScorePrototype,
        confidence: a.confidence,
        engine: a.engine,
        validationStatus: a.validationStatus,
        openReports: cases.filter((c) => c.segmentId === segment.id && c.state !== "CLOSED" && c.state !== "RESOLVED").length,
        attributeStatus: segment.attributeStatus ?? "SYNTHETIC",
        geometryStatus: segment.geometryStatus ?? "ILLUSTRATIVE"
      };
    });
    res.json({ success: true, generatedAt: now, dataStatus: "RULE_BASED estimates on SYNTHETIC/DEMO inputs", items });
  });

  router.get(ASSESSMENT_PATH, async (req: Request, res: Response) => {
    await runtime.ready;
    const segment = segmentById(req.params.id);
    if (!segment) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Unknown road segment." } });
    const cases = await runtime.service.listCases();
    const assessment = assessSegment(segment, { now: new Date().toISOString(), cases });
    res.json({ success: true, assessment, explanation: explainAssessment(assessment, cases) });
  });

  router.get(WORKFLOW_API_PATHS.roadStory, async (req: Request, res: Response) => {
    await runtime.ready;
    const segment = segmentById(req.params.id);
    if (!segment) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Unknown road segment." } });
    const actor = actorFrom(req, runtime);
    const audience = actor && actor.role !== "SYSTEM" && isOfficialRole(actor.role) ? "STAFF" : "PUBLIC";
    const cases = await runtime.service.listCases();
    const assessment = assessSegment(segment, { now: new Date().toISOString(), cases });
    const sims = (await runtime.service.listSimulations(segment.id)).map((s) => ({ at: s.at, summary: s.summary }));
    const story = buildRoadStory(segment.id, cases, [assessment], sims, audience);
    res.json({ success: true, segmentId: segment.id, audience, story, note: "Historical condition data is not yet available (DATA REQUIRED); the story starts with the records in this system." });
  });

  // POST /api/simulations — spec Lampiran L: Field Engineer only; out-of-range → 422.
  router.post(SIMULATIONS_PATH, simulateLimit, async (req: Request, res: Response) => {
    // Retired with the formula engine: scenarios now run on the PINN surrogate (/api/engine/assess).
    return res.status(410).json({ success: false, error: { code: "GONE", message: "Retired: use POST /api/engine/assess (PINN surrogate + MLET)." } });
  });

  router.get(SIMULATION_PATH, async (req: Request, res: Response) => {
    const actor = actorFrom(req, runtime);
    if (!actor || actor.role === "SYSTEM" || !isOfficialRole(actor.role)) {
      return res.status(actor ? 403 : 401).json({ success: false, error: { code: actor ? "FORBIDDEN" : "UNAUTHENTICATED", message: "Simulations are readable by official roles." } });
    }
    const record = await runtime.service.getSimulation(req.params.id);
    if (!record) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Simulation not found." } });
    res.json({ success: true, simulation: record });
  });

  // GET /api/road-segments/{id} — public segment facts plus the current estimate.
  router.get(SEGMENT_PATH, async (req: Request, res: Response) => {
    await runtime.ready;
    const segment = segmentById(req.params.id);
    if (!segment) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Unknown road segment." } });
    const cases = await runtime.service.listCases();
    const a = assessSegment(segment, { now: new Date().toISOString(), cases });
    const { wimDetails: _wim, activeWimStatus: _status, ...publicSegment } = segment;
    void _wim;
    void _status;
    res.json({
      success: true,
      segment: publicSegment,
      estimate: { risk: a.risk, conditionScorePrototype: a.outputs.conditionScorePrototype, confidence: a.confidence, engine: a.engine, validationStatus: a.validationStatus },
      openReports: cases.filter((c) => c.segmentId === segment.id && c.state !== "CLOSED" && c.state !== "RESOLVED").length
    });
  });

  // GET /api/provenance/{entity_type}/{id}
  router.get(PROVENANCE_PATH, async (req: Request, res: Response) => {
    await runtime.ready;
    const { entityType, id } = req.params;
    if (entityType === "road_segment") {
      const segment = segmentById(id);
      if (!segment) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Unknown road segment." } });
      return res.json({
        success: true,
        entityType,
        id,
        records: [
          { field: "attributes (PCI, CBR, thickness, traffic)", dataStatus: segment.attributeStatus ?? "SYNTHETIC", source: "Bundled demo dataset", confidence: "LOW" },
          { field: "geometry", dataStatus: segment.geometryStatus ?? "ILLUSTRATIVE", source: "Hand-placed points; digitisation DATA REQUIRED (G-01)", confidence: "LOW" },
          { field: "WIM", dataStatus: "WIM_NOT_AVAILABLE", source: "No official WIM feed connected (G-02)", confidence: "LOW" }
        ]
      });
    }
    if (entityType === "assessment") {
      const segment = segmentById(id);
      if (!segment) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Use the road segment id for assessment provenance." } });
      const a = assessSegment(segment, { now: new Date().toISOString(), cases: await runtime.service.listCases() });
      return res.json({ success: true, entityType, id: a.id, engine: a.engine, modelVersion: a.modelVersion, validationStatus: a.validationStatus, inputs: a.inputProvenance, uncertainty: a.uncertaintyReasons });
    }
    if (entityType === "report") {
      const c = await runtime.service.getCase(id);
      if (!c) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Report not found." } });
      const demo = c.dataStatus === "SYNTHETIC";
      return res.json({
        success: true,
        entityType,
        id,
        records: [
          { field: "report content", dataStatus: c.dataStatus, source: demo ? "Bundled demo dataset" : "Citizen submission" },
          { field: "photo", dataStatus: demo ? "ILLUSTRATIVE" : "USER_GENERATED", source: demo ? "Stock image" : "Uploaded with the report" },
          { field: "automated screening", dataStatus: c.screening ? c.screening.modelStatus : "NOT_RUN", source: c.screening?.modelVersion ?? "none" },
          { field: "field inspection", dataStatus: c.inspection ? "OBSERVED" : "NOT_AVAILABLE", source: c.inspection ? "Assigned field engineer" : "No inspection yet" }
        ]
      });
    }
    res.status(400).json({ success: false, error: { code: "VALIDATION", message: "entity_type must be road_segment, assessment or report." } });
  });
}
