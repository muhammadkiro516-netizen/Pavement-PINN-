import type { CvAnalysis } from "../../src/types/cv";
import type { ReportCase, RepairCheck } from "../../src/domain/workflow/model";
import { callInferenceBytes } from "./inferenceClient";

/**
 * Second opinion on a repair photo: the same CV pipeline that read the citizen photo looks at the
 * after-photo. It never resolves a case; the Koordinator sees it next to both photos and decides.
 */
export async function checkRepairPhoto(photoUrl: string, current: ReportCase | null, now: string): Promise<RepairCheck> {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i.exec(photoUrl);
  const before = current?.report.cvAssessment?.surfaceIndex ?? null;
  if (!m) return { ran: false, at: now, reason: "Foto tidak dapat dibaca.", indexBefore: before, indexAfter: null, damageStillDetected: null, detections: 0, isRoad: null, modelId: null };
  const reply = await callInferenceBytes("/v1/cv/analyze-image", Buffer.from(m[2], "base64"), m[1].toLowerCase(), 20_000);
  if (!reply.ok) {
    const reason = "unavailable" in reply ? "Layanan AI sedang tidak aktif; periksa foto secara manual." : "AI tidak dapat membaca foto ini.";
    return { ran: false, at: now, reason, indexBefore: before, indexAfter: null, damageStillDetected: null, detections: 0, isRoad: null, modelId: null };
  }
  const a = reply.body as CvAnalysis;
  const n = a.detections?.length ?? 0;
  return {
    ran: true,
    at: now,
    reason: null,
    indexBefore: before,
    indexAfter: typeof a.surfaceIndex === "number" ? a.surfaceIndex : null,
    damageStillDetected: n > 0,
    detections: n,
    isRoad: a.scene ? a.scene.isRoad : null,
    modelId: a.model?.detector.modelId ?? null
  };
}
