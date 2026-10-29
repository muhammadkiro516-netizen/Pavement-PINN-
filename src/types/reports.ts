import type { CvAssessment } from './cv';
/** Community damage-report domain types. */
import type { UserRole } from './rbac';

export type DamageType =
  | 'POTHOLE'
  | 'ALLIGATOR_CRACK'
  | 'RUTTING'
  | 'CORRUGATION'
  | 'SUBSIDENCE'
  | 'CRACK'
  | 'SURFACE_DAMAGE'
  | 'ROAD_DEFORMATION'
  | 'DEPRESSION'
  | 'PATCHING'
  | 'FLOODING';

export type ReportSeverity = 'LIGHT' | 'MODERATE' | 'SEVERE' | 'CRITICAL';
/** Display status used by the report screens; derived from the workflow state (domain/workflow/projections.ts). */
export type ReportStatus = 'PENDING' | 'VERIFIED_BY_ENGINEER' | 'SCHEDULED_FOR_REPAIR' | 'REPAIRED' | 'CLOSED';

export interface DamageReport {
  id: string;
  reporterName: string;
  reporterRole: string;
  /** Account role of the creator. Recorded for reports made in the app; absent on the bundled demo reports. */
  creatorRole?: UserRole;
  /** 'SESSION': made in this browser session (not persisted). Absent: one of the bundled demo reports. */
  origin?: 'SESSION';
  /** Demo account id of the creator (session reports only). Client-side attribution, not an authenticated owner. */
  creatorAccountId?: string;
  /** ISO 8601 creation time (session reports only). `timestamp` stays the display string. */
  createdAt?: string;
  /** Canonical workflow state (domain/workflow/model.ts WorkflowState) when loaded from the workflow store. */
  workflowState?: string;
  /** Workflow case version, sent back as `expectedVersion` on the next transition. */
  caseVersion?: number;
  reporterAvatar?: string;
  timestamp: string;
  segmentId: string;
  segmentName: string;
  corridor: string;
  province: string;
  coordinates: [number, number];
  damageType: DamageType;
  damageTypeLabel: string;
  severity: ReportSeverity;
  estimatedDepthCm: number;
  estimatedAreaM2: number;
  photoUrl: string;
  /**
   * Where `photoUrl` comes from. Absent = the photo the reporter sent. DATASET_REFERENCE =
   * a labelled photo from a public road-damage dataset that illustrates the damage type (not
   * the pinned location). NO_DATASET_COVERAGE = no dataset photo exists for this damage type.
   * Set only by the system (seed data / migrations), never by a client.
   */
  photoProvenance?: 'REPORT_PHOTO' | 'DATASET_REFERENCE' | 'NO_DATASET_COVERAGE';
  /** Registry id of the dataset reference image (src/data/reference/datasetImageRegistry.json). */
  datasetAssetId?: string;
  description: string;
  status: ReportStatus;
  upvotesCount: number;
  userUpvoted?: boolean;

  /** Server-verified road-damage CV analysis (models/cv) with the reporter's corrections. Set by the server only. */
  cvAssessment?: CvAssessment;
  /** Draft-only: id of a server-stored CV analysis to attach. Never kept on the report. */
  cvAnalysisId?: string;
  /** Extra angles from the reporter (overview / side), each with the server-side AI result. */
  extraViews?: Array<{
    angle: 'OVERVIEW' | 'TOP' | 'SIDE' | 'DETAIL' | 'SIGN';
    photoUrl: string;
    takenAt: string;
    ai: { analysisId: string; status: string; primaryLabel: string | null; primaryType: string | null; confidence: number | null; detections: number; severity: string; surfaceIndex: number | null; flooded: boolean } | null;
  }>;

  // Computer Vision AI Analysis Data
  aiAnalysis?: {
    class: string;
    label: string;
    icon: string;
    /** null until a versioned detector (Module C) classifies the photo. */
    confidence: number | null;
    modelStatus?: 'REAL' | 'NOT_CLASSIFIED';
    modelVersion?: string;
    severity: string;
    characteristics: string[];
    detectionBox?: {
      xPercent: number;
      yPercent: number;
      widthPercent: number;
      heightPercent: number;
    };
  };

  // WIM correlation: no WIM data source is connected (F-04/F-16), so new reports never carry it.
  wimCorrelation?: {
    hasWimData: boolean;
    stationId: string;
    stationName: string;
    corridor: string;
    recentTruckPlate: string;
    recentTruckClass: string;
    maxAxleLoadTon: number;
    legalLimitTon: number;
    overloadPercent: number;
    overloadCategory: 'NONE' | 'LIGHT' | 'MODERATE' | 'HEAVY' | 'EXTREME';
    correlatedOverloadTrucksCount: number;
    estimatedPinnContributionPercent: number;
    causeAnalysisSummary: string;
  };

  // Community Citizen Reviews & Comments
  reviews?: ReportReview[];

  // Infrastructure Repair & Before/After Comparison Details
  repairDetails?: {
    /** Repair evidence photo; absent until a field engineer submits one. */
    afterPhotoUrl?: string;
    repairDate?: string;
    repairMethod?: string;
    repairedPciImprovement?: string;
    engineerNote?: string;
    agencyInCharge?: string;
    /** Real cases: true once M.O verified the repair evidence; false while it awaits verification. */
    verified?: boolean;
    /** Sample (SYNTHETIC) data: illustrative only, never verified evidence. */
    illustrative?: boolean;
  };
}

export interface ReportReview {
  id: string;
  userName: string;
  userAvatar?: string;
  userBadge?: string;
  rating: number;
  timeAgo: string;
  dateFormatted: string;
  comment: string;
  likesCount?: number;
}

/** Result of a report create/edit, returned only after the workflow store saved it. */
export type ReportMutationOutcome =
  | { ok: true; report: DamageReport; claimToken?: string | null }
  | { ok: false; error: string; code: string };

/** Report create/edit callbacks may be synchronous (legacy) or return the saved outcome. */
export type ReportMutationHandler = (report: DamageReport) => void | Promise<ReportMutationOutcome>;
