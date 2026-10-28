/**
 * Structured road-damage analysis produced by the Python CV engine (inference/app/cv) and
 * kept by the server. Photo and video frames share this schema. Measurements are in image
 * pixels: no calibration exists, so physical size and depth are never claimed.
 */
export type CvAnalysisStatus = 'completed' | 'inconclusive' | 'review_required' | 'failed';
export type CvSeverityLevel = 'minor' | 'moderate' | 'severe' | 'unknown';

export interface CvSegmentationMetrics {
  areaPixels: number;
  skeletonLengthPixels: number;
  estimatedWidthPixels: number;
  maxWidthPixels: number;
  orientationDeg: number;
  elongation: number;
  components: number;
}

export interface CvDetection {
  classIndex: number;
  modelLabel: string;
  /** App taxonomy code from models/cv/cv_registry.json (e.g. LONGITUDINAL_CRACK). */
  taxonomyCode: string;
  damageType: string;
  label: string;
  confidence: number;
  /** [x1, y1, x2, y2] in original image pixels. */
  bbox: [number, number, number, number];
  bboxAreaFraction: number;
  segmentationMetrics: CvSegmentationMetrics | null;
  severity: { level: CvSeverityLevel; basis: string; confidence: string; evidence: string[] };
}

export interface CvAnalysis {
  analysisId: string;
  sourceType: 'image' | 'video_frame';
  engineVersion: string;
  status: CvAnalysisStatus;
  statusReasons: string[];
  failure?: { code: string; stage: string; message: string };
  image: { width: number; height: number; sourceReference: string; sha256?: string; bytes?: number };
  quality: { imageUsable: boolean; overallStatus: string; warnings: string[]; sharpnessLaplacianVar: number; meanBrightness: number };
  model?: {
    detector: { modelId: string; runtime: string; device: string; labels: string[]; confAccept: number; confCandidate: number };
    segmenter: { modelId: string; runtime: string; device: string; ran: boolean } | null;
    labelsVersion: string;
    severityPolicy: string;
  };
  detections: CvDetection[];
  lowConfidenceCandidates?: CvDetection[];
  segmentation?: { instances: unknown[]; totalCrackPixels: number } | null;
  primary?: { taxonomyCode: string; damageType: string; label: string; confidence: number } | null;
  overallSeverity?: CvSeverityLevel;
  /** Zero-shot scene model (CLIP on OpenVINO), uncalibrated: routes reports, never decides. */
  scene?: CvScene | null;
  /** Relative visual damage index 0-100 (share of the road area covered by defects; image space). */
  surfaceIndex?: number;
  /** GENANGAN (standing water) and/or RUSAK_TOTAL (surface destroyed), for human confirmation. */
  hazards?: CvHazard[];
  measurements?: {
    coordinateSpace: 'image_pixels' | 'metric';
    metricCalibrationStatus: 'validated' | 'unavailable' | 'unvalidated';
    physicalDepthStatus: 'measured' | 'estimated' | 'not_estimable';
    relativeDepthStatus?: string;
    note?: string;
  };
  timings: { preprocessingMs?: number; detectionMs?: number; segmentationMs?: number; inferenceMs?: number; postprocessingMs?: number; totalMs?: number };
  /** Server-relative URLs of the stored artefacts (the original photo stays in the report). */
  overlayUrl?: string | null;
  maskUrl?: string | null;
  createdAt?: string;
}

export type CvJobStage =
  | 'queued'
  | 'validating_input'
  | 'model_loading'
  | 'preprocessing'
  | 'detecting'
  | 'segmenting'
  | 'evaluating'
  | 'validating'
  | 'done';

export interface CvJobView {
  jobId: string;
  state: 'queued' | 'running' | 'done' | 'error';
  stage: CvJobStage;
  stages: CvJobStage[];
  analysis?: CvAnalysis;
  error?: { code: string; message: string };
}

/** What a report keeps: the server-verified analysis plus the reporter's corrections, side by side. */
export type CvHazard = 'GENANGAN' | 'RUSAK_TOTAL';

export interface CvScene {
  modelId: string;
  calibrated: false;
  isRoad: boolean;
  road?: Record<string, number>;
  surface?: Record<string, number>;
  surfaceTop?: { key: string; label: string; p: number };
  water: { flooded: boolean; p: number };
}

export interface CvAssessment {
  analysisId: string;
  status: CvAnalysisStatus;
  statusReasons: string[];
  modelId: string;
  segmenterId: string | null;
  runtime: string;
  device: string;
  labelsVersion: string;
  severityPolicy: string;
  primary: CvAnalysis['primary'];
  detections: Array<Pick<CvDetection, 'taxonomyCode' | 'label' | 'confidence' | 'bbox' | 'segmentationMetrics' | 'severity'>>;
  modelSeverity: CvSeverityLevel;
  measurements: CvAnalysis['measurements'];
  quality: CvAnalysis['quality'];
  timings: CvAnalysis['timings'];
  overlayUrl: string | null;
  imageSha256: string;
  /** Reporter choices that differ from the model output; the model output above is unchanged. */
  userCorrections: { damageType?: { model: string | null; user: string }; severity?: { model: CvSeverityLevel; user: string } };
  scene?: CvScene | null;
  surfaceIndex?: number;
  hazards?: CvHazard[];
}
