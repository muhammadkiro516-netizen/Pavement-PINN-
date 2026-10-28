/**
 * Automated screening of a new citizen report (spec §24 "AI SCREENING (confidence
 * check)", §20.2 abuse prevention, §22 controls).
 *
 * Only a trained Computer Vision model that actually ran (`REAL`) can let a report pass
 * screening automatically. Today no trained weights ship with the repository
 * (docs/AI.md), so the in-app classifier is a DEMO and every report goes to human review.
 * The checks below never decide that damage exists; they only route the report.
 */
import type { DamageReport } from '../../types';
import { hasValidCoordinates } from '../geo';
import type { ReportCase, ScreeningResult } from './model';
import { SCREENING_CONFIDENCE_THRESHOLD } from './stateMachine';
import { findCorridor, PILOT_CORRIDORS } from '../corridors';

/** Contract a real CV service must fulfil (see docs/AI.md, "CV model-loading contract"). */
export interface CvScreeningProvider {
  readonly status: 'REAL' | 'DEMO' | 'MODEL_UNAVAILABLE';
  readonly modelVersion: string | null;
  /** Returns the model's class and confidence for the report image, or null when no output. */
  classify(report: DamageReport): { detectedClass: string; confidence: number; modelVersion?: string } | null;
}

/**
 * The product provider: the OpenVINO detector's result for the report photo, which the server
 * attached by photo hash (reportFactory sets `modelStatus: 'REAL'` only from that record).
 * A report without such a result gets no class and goes to human review.
 */
export const VERIFIED_CV_PROVIDER: CvScreeningProvider = {
  status: 'REAL',
  modelVersion: null,
  classify(report) {
    const ai = report.aiAnalysis;
    if (!ai || ai.modelStatus !== 'REAL' || typeof ai.confidence !== 'number') return null;
    // A photo the scene model doubts is a road never passes automatically.
    if (report.cvAssessment?.scene && report.cvAssessment.scene.isRoad === false) return null;
    return { detectedClass: ai.class, confidence: ai.confidence, modelVersion: ai.modelVersion };
  }
};

/**
 * The provider used while no trained model is deployed: it reports the in-app demo
 * classification (labelled DEMO) and never claims a real confidence.
 */
export const DEMO_CV_PROVIDER: CvScreeningProvider = {
  status: 'DEMO',
  modelVersion: 'demo-rule-classifier (no trained weights)',
  classify(report) {
    if (!report.aiAnalysis) return null;
    return { detectedClass: report.aiAnalysis.class, confidence: report.aiAnalysis.confidence };
  }
};


/** Indonesia's rough bounding box; anything outside is not plausible for this system. */
const INDONESIA_BOUNDS = { minLat: -11.5, maxLat: 6.5, minLng: 94.5, maxLng: 141.5 };

/** Metres between two [lat, lng] points (haversine). */
export function distanceMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const DUPLICATE_RADIUS_M = 30;
export const DUPLICATE_WINDOW_DAYS = 7;

/** Open reports of the same damage type within 30 m and 7 days (a duplicate hint, not a verdict). */
export function findPossibleDuplicates(report: DamageReport, createdAt: string, existing: ReportCase[]): string[] {
  const t = Date.parse(createdAt);
  return existing
    .filter((c) => c.id !== report.id && c.state !== 'CLOSED' && c.state !== 'RESOLVED')
    .filter((c) => c.report.damageType === report.damageType)
    .filter((c) => Math.abs(t - Date.parse(c.createdAt)) <= DUPLICATE_WINDOW_DAYS * 86400000)
    .filter((c) => distanceMeters(c.report.coordinates, report.coordinates) <= DUPLICATE_RADIUS_M)
    .map((c) => c.id);
}

export function screenReport(report: DamageReport, createdAt: string, existing: ReportCase[], cv: CvScreeningProvider): ScreeningResult {
  const reasons: string[] = [];
  const output = cv.status === 'MODEL_UNAVAILABLE' ? null : cv.classify(report);

  if (cv.status === 'MODEL_UNAVAILABLE') reasons.push('Model CV tidak tersedia; laporan perlu ditinjau petugas.');
  if (cv.status === 'DEMO') reasons.push('Klasifikasi CV berstatus DEMO (tanpa bobot model terlatih); tidak dipakai untuk keputusan otomatis.');

  const [lat, lng] = report.coordinates;
  const inIndonesia =
    hasValidCoordinates(report) &&
    lat >= INDONESIA_BOUNDS.minLat && lat <= INDONESIA_BOUNDS.maxLat &&
    lng >= INDONESIA_BOUNDS.minLng && lng <= INDONESIA_BOUNDS.maxLng;
  if (!inIndonesia) reasons.push('Lokasi di luar wilayah yang masuk akal untuk sistem ini.');
  // Reports outside every pilot corridor are flagged OUT_OF_SCOPE for the reviewer, not rejected (spec Lampiran L).
  if (inIndonesia && !findCorridor(lat, lng)) {
    reasons.push(`OUT_OF_SCOPE: di luar koridor pilot (${PILOT_CORRIDORS.map((c) => c.name).join('; ')}); tetap diterima untuk ditinjau.`);
  }

  const duplicates = findPossibleDuplicates(report, createdAt, existing);
  if (duplicates.length > 0) reasons.push(`Kemungkinan duplikat dari ${duplicates.join(', ')}.`);

  const confidence = output ? output.confidence : null;
  const confident = cv.status === 'REAL' && confidence !== null && confidence >= SCREENING_CONFIDENCE_THRESHOLD;
  if (cv.status === 'REAL' && !output) reasons.push('Foto belum dianalisis model; perlu peninjauan petugas.');
  else if (cv.status === 'REAL' && !confident) reasons.push('Kepercayaan model di bawah ambang; perlu peninjauan petugas.');

  return {
    modelStatus: cv.status,
    modelVersion: output?.modelVersion ?? cv.modelVersion,
    detectedClass: output ? output.detectedClass : null,
    confidence,
    passed: confident && inIndonesia && duplicates.length === 0,
    reasons,
    at: createdAt
  };
}
