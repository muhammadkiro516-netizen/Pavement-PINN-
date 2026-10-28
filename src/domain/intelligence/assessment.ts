/**
 * Engineering assessment of one road segment: DATA → ENGINE → RESULT, with provenance,
 * uncertainty and validation status (spec §16, §28, §29, §31).
 *
 * The segment risk here comes only from observed evidence in the workflow (open reports,
 * engineer-confirmed severity). Structural numbers (strains, life) come only from the PINN
 * surrogate / MLET service (/api/engine/assess); the old browser formula engine is removed.
 */
import type { DamageReport, RoadSegment } from '../../types';
import type { ReportCase } from '../workflow/model';
import { Confidence, estimateTrafficLoad, NO_WIM_PROVIDER, pavementBaseline, Provenanced, TrafficLoadEstimate, WeatherObservation, weatherEvidence, WimProvider } from './evidence';

export type RiskLevel = 'HIGH' | 'WATCH' | 'MODERATE' | 'GOOD';

export const EVIDENCE_ENGINE_VERSION = 'evidence-risk@1 (observed reports and inspections only)';

/** Ranges the formula engine was written for; inputs outside are flagged (spec §29 OOD warning). */
export const ENGINE_INPUT_RANGES = {
  axleLoadTon: [10, 25],
  rainIntensityMmHr: [0, 100],
  subgradeCbrPercent: [3, 10],
  asphaltThicknessCm: [5, 25],
  asphaltModulusMpa: [1200, 3500]
} as const;

export interface AssessmentInputs {
  axleLoadTon: number;
  rainIntensityMmHr: number;
  floodDurationHours: number;
  surfaceTemperatureC: number;
  subgradeCbrPercent: number;
  asphaltThicknessCm: number;
  asphaltModulusMpa: number;
}

export interface EngineeringAssessment {
  id: string;
  segmentId: string;
  createdAt: string;
  engine: 'PINN' | 'EVIDENCE';
  modelVersion: string;
  inputs: AssessmentInputs;
  inputProvenance: Record<keyof AssessmentInputs, string>;
  outputs: {
    /** 100 = no evidence of damage; lowered by open reports and confirmed severity. */
    conditionScorePrototype: number;
    /** Structural responses are not computed here (see /api/engine/assess). */
    tensileStrainMicro: number | null;
    compressiveStrainMicro: number | null;
    surfaceDeflectionMicron: number | null;
  };
  risk: RiskLevel;
  riskReasons: string[];
  confidence: Confidence;
  uncertaintyReasons: string[];
  outOfRange: string[];
  /** Null: the rule-based engine has no physics residual; a trained PINN would report it. */
  physicsResidual: number | null;
  validationStatus: 'VALIDATION_REQUIRED';
  dataStatus: 'OBSERVED';
  traffic: TrafficLoadEstimate;
  weather: Provenanced<WeatherObservation | null>;
}

function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

export function defaultInputs(segment: RoadSegment, now: string): { inputs: AssessmentInputs; provenance: Record<keyof AssessmentInputs, string>; weather: Provenanced<WeatherObservation | null> } {
  const baseline = pavementBaseline(segment);
  const weather = weatherEvidence(segment, now);
  const [cbrLo, cbrHi] = baseline.value.subgradeCbrRange;
  const [eLo, eHi] = baseline.value.asphaltModulusRangeMpa;
  return {
    inputs: {
      axleLoadTon: segment.defaultAxleLoadTon,
      rainIntensityMmHr: weather.value ? weather.value.rainfallMmPerHr : 0,
      floodDurationHours: weather.value?.wetSurface ? 2 : 0,
      surfaceTemperatureC: weather.value ? weather.value.temperatureC + 12 : 40,
      subgradeCbrPercent: Math.round(((cbrLo + cbrHi) / 2) * 10) / 10,
      asphaltThicknessCm: baseline.value.surfaceThicknessCm,
      asphaltModulusMpa: Math.round((eLo + eHi) / 2)
    },
    provenance: {
      axleLoadTon: 'SYNTHETIC segment attribute (no WIM)',
      rainIntensityMmHr: `${weather.dataStatus} weather`,
      floodDurationHours: `${weather.dataStatus} weather (wet surface → 2 h assumed)`,
      surfaceTemperatureC: `${weather.dataStatus} air temperature + 12 °C surface assumption`,
      subgradeCbrPercent: 'REFERENCE BASELINE midpoint (SYNTHETIC)',
      asphaltThicknessCm: 'REFERENCE BASELINE (SYNTHETIC)',
      asphaltModulusMpa: 'REFERENCE BASELINE midpoint (SYNTHETIC)'
    },
    weather
  };
}

function riskFromScore(score: number): RiskLevel {
  if (score < 40) return 'HIGH';
  if (score < 55) return 'WATCH';
  if (score < 70) return 'MODERATE';
  return 'GOOD';
}

const RISK_ORDER: RiskLevel[] = ['GOOD', 'MODERATE', 'WATCH', 'HIGH'];
const maxRisk = (a: RiskLevel, b: RiskLevel): RiskLevel => (RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b);

export function assessSegment(
  segment: RoadSegment,
  options: { now: string; inputs?: Partial<AssessmentInputs>; cases?: ReportCase[]; wim?: WimProvider } = { now: new Date().toISOString() }
): EngineeringAssessment {
  const base = defaultInputs(segment, options.now);
  const inputs: AssessmentInputs = { ...base.inputs, ...(options.inputs ?? {}) };
  const provenance = { ...base.provenance };
  for (const key of Object.keys(options.inputs ?? {}) as Array<keyof AssessmentInputs>) provenance[key] = 'USER SCENARIO INPUT (SIMULATED)';

  const outOfRange: string[] = [];

  const segmentCases = (options.cases ?? []).filter((c) => c.segmentId === segment.id && c.state !== 'CLOSED' && c.state !== 'RESOLVED');
  const confirmed = segmentCases.filter((c) => c.inspection?.verdict === 'CONFIRMED');
  const critical = confirmed.filter((c) => c.inspection?.severity === 'CRITICAL').length;
  const severe = confirmed.filter((c) => c.inspection?.severity === 'SEVERE').length;
  const openReports = segmentCases.length;
  const score = Math.max(0, 100 - 8 * openReports - 20 * severe - 35 * critical);
  let risk = riskFromScore(score);
  const riskReasons: string[] = [];
  if (critical > 0) {
    risk = maxRisk(risk, 'HIGH');
    riskReasons.push(`${critical} inspeksi lapangan mengonfirmasi kerusakan KRITIS.`);
  }
  if (severe > 0) {
    risk = maxRisk(risk, 'WATCH');
    riskReasons.push(`${severe} inspeksi lapangan mengonfirmasi kerusakan BERAT.`);
  }
  riskReasons.push(openReports > 0 ? `${openReports} laporan warga masih terbuka di ruas ini.` : 'Tidak ada laporan terbuka di ruas ini.');

  const traffic = estimateTrafficLoad(segment, options.wim ?? NO_WIM_PROVIDER);
  const uncertaintyReasons = ['Risiko dihitung dari laporan dan inspeksi yang tercatat; ruas tanpa laporan belum tentu baik.'];
  if (traffic.wim.status === 'WIM_NOT_AVAILABLE') uncertaintyReasons.push('WIM data is unavailable, so traffic load is estimated.');
  if (base.weather.dataStatus !== 'PUBLIC') uncertaintyReasons.push(`Weather is ${base.weather.dataStatus}, not a live observation.`);

  return {
    id: `ASM-${segment.id}-${hash(JSON.stringify(inputs))}`,
    segmentId: segment.id,
    createdAt: options.now,
    engine: 'EVIDENCE',
    modelVersion: EVIDENCE_ENGINE_VERSION,
    inputs,
    inputProvenance: provenance,
    outputs: {
      conditionScorePrototype: score,
      tensileStrainMicro: null,
      compressiveStrainMicro: null,
      surfaceDeflectionMicron: null
    },
    risk,
    riskReasons,
    // Never above LOW while every input is synthetic, demo or inferred.
    confidence: 'LOW',
    uncertaintyReasons,
    outOfRange,
    physicsResidual: null,
    validationStatus: 'VALIDATION_REQUIRED',
    dataStatus: 'OBSERVED',
    traffic,
    weather: base.weather
  };
}

/** Compact snapshot stored with a maintenance recommendation (provenance travels with it). */
export interface AssessmentSnapshot {
  id: string;
  engine: EngineeringAssessment['engine'];
  modelVersion: string;
  risk: RiskLevel;
  conditionScorePrototype: number;
  confidence: Confidence;
  validationStatus: 'VALIDATION_REQUIRED';
  createdAt: string;
}

export function snapshotOf(a: EngineeringAssessment): AssessmentSnapshot {
  return {
    id: a.id,
    engine: a.engine,
    modelVersion: a.modelVersion,
    risk: a.risk,
    conditionScorePrototype: a.outputs.conditionScorePrototype,
    confidence: a.confidence,
    validationStatus: a.validationStatus,
    createdAt: a.createdAt
  };
}

/** Surface indicator from the citizen report / CV class. Engineering parameters need calibration. */
export interface SurfaceIndicator {
  distressClass: string;
  severity: DamageReport['severity'];
  evidenceSource: 'CITIZEN_REPORT' | 'CV_DEMO' | 'CV_MODEL' | 'FIELD_INSPECTION';
  confidence: number | null;
  translation: { rule: string; version: string; status: 'CALIBRATION_REQUIRED' };
  note: string;
}

/**
 * CV → engineering translation boundary (spec §8.2). It deliberately produces a surface
 * condition indicator only. No modulus, CBR or axle load is inferred from a photo: the
 * calibration that would justify such a mapping does not exist yet.
 */
export function translateSurfaceEvidence(report: DamageReport, inspection?: ReportCase['inspection']): SurfaceIndicator {
  if (inspection) {
    return {
      distressClass: inspection.cvReview.correctedClass ?? report.damageType,
      severity: inspection.severity,
      evidenceSource: 'FIELD_INSPECTION',
      confidence: null,
      translation: { rule: 'none (observed indicator)', version: 'n/a', status: 'CALIBRATION_REQUIRED' },
      note: 'Observed by the assigned engineer; still not converted into structural parameters without calibration.'
    };
  }
  return {
    distressClass: report.aiAnalysis?.class ?? report.damageType,
    severity: report.severity,
    evidenceSource: report.aiAnalysis ? 'CV_DEMO' : 'CITIZEN_REPORT',
    confidence: report.aiAnalysis ? report.aiAnalysis.confidence : null,
    translation: { rule: 'distress class + severity → surface condition indicator', version: 'translation-0 (uncalibrated)', status: 'CALIBRATION_REQUIRED' },
    note: 'CALIBRATION REQUIRED: photos do not reveal modulus, CBR, stress or strain (spec §8.1).'
  };
}
