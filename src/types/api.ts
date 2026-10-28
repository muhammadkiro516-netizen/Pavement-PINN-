/**
 * HTTP API contracts shared by the Express server (server/) and the frontend
 * API clients (src/services/api/). Paths and payload shapes mirror the
 * pre-restructure server.ts exactly — see docs/api/API_INVENTORY.md.
 */
import type { UserRole } from './rbac';
import type { RoadSegment } from './road';
import type { SimulationParams, SimulationResult } from './simulation';

export const API_PATHS = {
  health: '/api/health',
  roads: '/api/roads',
  simulate: '/api/simulate',
  generateNarrative: '/api/generate-narrative'
} as const;

/**
 * Workflow, identity and system endpoints added for the cross-role workflow (P2).
 * Kept separate from API_PATHS, whose six pre-restructure entries are a frozen contract.
 * Contract details: docs/api/WORKFLOW_API.md.
 */
export const WORKFLOW_API_PATHS = {
  /** Credential login (demo credentials while DEMO_AUTH is on). */
  login: '/api/auth/login',
  /** Same call as `login` under its older name; also requires credentials. */
  demoSession: '/api/auth/demo-session',
  anonymousSession: '/api/auth/anonymous',
  me: '/api/auth/me',
  /** Ends the signed-in session (revokes the token, clears the cookie). */
  logout: '/api/auth/logout',
  /** Citizen self-registration (creates a PUBLIC_REPORTER account and signs it in). */
  register: '/api/auth/register',
  /** Staff accounts, managed by a Koordinator (OPERATIONS_MANAGER). */
  staff: '/api/staff',
  staffActive: '/api/staff/:id/active',
  reports: '/api/workflow/reports',
  report: '/api/workflow/reports/:id',
  transitions: '/api/workflow/reports/:id/transitions',
  content: '/api/workflow/reports/:id/content',
  audit: '/api/workflow/audit',
  engineers: '/api/workflow/engineers',
  systemHealth: '/api/system-health',
  roadStory: '/api/road-segments/:id/story',
  riskMap: '/api/risk-map'
} as const;

export interface ApiErrorBody {
  success: false;
  error: { code: string; message: string };
}

export type SyncStatus = 'SYNCED' | 'COMMIT_MISMATCH' | 'SOURCE_MODIFIED' | 'UNKNOWN';

export interface HealthResponse {
  status: 'ok';
  appName: string;
  timestamp: string;
  /** Code this server process runs (stale = started before the latest server/domain change, or commit mismatch). */
  server?: {
    pid: number;
    startedAt: string;
    commit: string | null;
    currentCommit: string | null;
    stale: boolean;
    syncStatus?: SyncStatus;
    checkedAt?: string;
    changedFiles?: string[];
    fingerprint?: { loaded: string; disk: string; files: number };
  };
}

export type RoadsResponse = RoadSegment[];

export interface SimulateRequest {
  params: SimulationParams;
}

export type SimulateResponse =
  | { success: true; result: SimulationResult }
  | { success: false; error: string };

/** Which generator produced the narrative text. */
export type NarrativeSource = 'rule-engine-offline' | 'rule-engine-fallback' | 'gemini-3.7-flash';

export interface NarrativeRequest {
  role: UserRole;
  simulationData: SimulationResult;
}

export interface NarrativeResponse {
  success: true;
  narrative: string;
  source: NarrativeSource;
}

/** Query string accepted by both OpenVINO export endpoints (all optional). */
export interface OpenvinoExportQuery {
  device?: string;
  precision?: string;
  streams?: string;
}

/** GET /api/runtime — which runtime answers on this port (no secrets, no credentials). */
export interface RuntimeIdentity {
  app: 'pavement-pinn';
  status: 'ok';
  /** Random per server process; every port that is an alias of one runtime reports the same id. */
  runtimeId: string;
  pid: number;
  startedAt: string;
  mode: 'development' | 'production';
  /** Ports this runtime answers on; `requestPort` is the one this request came through. */
  ports: { primary: number; aliases: number[] };
  requestPort: number | null;
  project: { name: string; rootId: string; branch: string | null; commit: string | null; dirtyFiles: number | null; worktrees: number | null };
  code: { commit: string | null; syncStatus: SyncStatus; stale: boolean; changedFiles: string[]; fingerprint?: { loaded: string; disk: string; files: number } };
  /** Data store identity: kind and a hash of its absolute location (the path itself is not sent). */
  dataStore: { kind: 'file' | 'memory'; storeId: string; relativeLocation: string | null };
  api: { baseUrl: string };
  sessions: 'per-process' | 'shared-secret';
}

/** A registered account as the server returns it (login, register, /api/auth/me). */
export interface AccountProfile {
  id: string;
  email: string;
  name: string;
  role: import('./rbac').UserRole;
  agency: string | null;
  createdAt?: string;
  active?: boolean;
}
