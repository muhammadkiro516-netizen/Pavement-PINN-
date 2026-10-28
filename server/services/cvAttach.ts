import { createHash } from "node:crypto";
import type { CvAssessment, CvSeverityLevel } from "../../src/types/cv";
import type { ReportSeverity } from "../../src/types";
import { CvAnalysisStore, type CvRecord } from "./cvAnalysisStore";

/** Model severity -> report severity. `unknown` has no report value: the reporter chooses. */
export const CV_TO_REPORT_SEVERITY: Record<CvSeverityLevel, ReportSeverity | null> = {
  minor: "LIGHT",
  moderate: "MODERATE",
  severe: "SEVERE",
  unknown: null
};

export type CvAttachResult = { ok: true; assessment: CvAssessment; record: CvRecord } | { ok: false; message: string };

function photoSha(photoUrl: unknown): string | null {
  if (typeof photoUrl !== "string") return null;
  const m = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(photoUrl);
  return m ? createHash("sha256").update(Buffer.from(m[1], "base64")).digest("hex") : null;
}

/**
 * Build the assessment a report keeps from the server's stored analysis. The client only names
 * the analysis id; everything model-derived comes from the store, and the reporter's choices
 * are recorded next to the model output as corrections.
 */
export async function attachCvAnalysis(
  store: CvAnalysisStore,
  analysisId: unknown,
  draft: { photoUrl?: unknown; damageType?: unknown; severity?: unknown }
): Promise<CvAttachResult> {
  if (!CvAnalysisStore.isId(analysisId)) return { ok: false, message: "cvAnalysisId is not a valid analysis id." };
  const record = await store.get(analysisId);
  if (!record) return { ok: false, message: "The cited CV analysis does not exist on this server." };
  if (record.reportId) return { ok: false, message: "This CV analysis is already attached to another report." };
  if (photoSha(draft.photoUrl) !== record.imageSha256) return { ok: false, message: "The report photo is not the photo that was analysed." };
  const a = record.analysis;
  const modelSeverity = a.overallSeverity ?? "unknown";
  const corrections: CvAssessment["userCorrections"] = {};
  const modelType = a.primary?.damageType ?? null;
  if (typeof draft.damageType === "string" && draft.damageType !== modelType) corrections.damageType = { model: modelType, user: draft.damageType };
  const mapped = CV_TO_REPORT_SEVERITY[modelSeverity];
  if (typeof draft.severity === "string" && draft.severity !== mapped) corrections.severity = { model: modelSeverity, user: draft.severity };
  return {
    ok: true,
    record,
    assessment: {
      analysisId: a.analysisId,
      status: a.status,
      statusReasons: a.statusReasons ?? [],
      modelId: a.model?.detector.modelId ?? "unknown",
      segmenterId: a.model?.segmenter?.ran ? a.model.segmenter.modelId : null,
      runtime: a.model?.detector.runtime ?? "unknown",
      device: a.model?.detector.device ?? "unknown",
      labelsVersion: a.model?.labelsVersion ?? "unknown",
      severityPolicy: a.model?.severityPolicy ?? "unknown",
      primary: a.primary ?? null,
      detections: a.detections.map((d) => ({ taxonomyCode: d.taxonomyCode, label: d.label, confidence: d.confidence, bbox: d.bbox, segmentationMetrics: d.segmentationMetrics, severity: d.severity })),
      modelSeverity,
      measurements: a.measurements,
      quality: a.quality,
      timings: a.timings,
      overlayUrl: a.overlayUrl ?? null,
      imageSha256: record.imageSha256,
      userCorrections: corrections,
      scene: a.scene ?? null,
      surfaceIndex: a.surfaceIndex,
      hazards: a.hazards ?? []
    }
  };
}
