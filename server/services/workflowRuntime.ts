import { randomUUID } from "node:crypto";
import { MemoryCaseStore, WorkflowService, type CaseStore } from "../../src/domain/workflow/service";
import { DEMO_CV_PROVIDER, VERIFIED_CV_PROVIDER } from "../../src/domain/workflow/screening";
import { USER_ACCOUNTS } from "../../src/data/reference/demoAccounts";
import { INITIAL_COMMUNITY_REPORTS } from "../../src/data/mock/communityReports";
import type { UserRole } from "../../src/types";
import { SessionSigner } from "../auth/sessionTokens";
import { WorkspaceService, type AnalysisEngine } from "./workspaceService";
import { FileWorkspaceRepository } from "../repositories/workspaceStore";
import { CvAnalysisStore } from "./cvAnalysisStore";
import { AccountStore } from "../repositories/accountStore";

/** Everything the workflow routes need, assembled once per app. */
export interface WorkflowRuntime {
  service: WorkflowService;
  signer: SessionSigner;
  demoAuthEnabled: boolean;
  storeKind: "memory" | "file";
  storeLocation: string | null;
  ready: Promise<void>;
  /** Road-damage CV analyses the reports may cite (server-side record, never client state). */
  cv: CvAnalysisStore;
  /** Analysis workspaces (handoff U2): stage runs, corrections, versions. */
  workspaces: WorkspaceService;
  /** Registered accounts (citizens and staff). */
  accounts: AccountStore;
}

export function roleOfDemoAccount(accountId: string): UserRole | null {
  return USER_ACCOUNTS.find((a) => a.id === accountId)?.role ?? null;
}

export function createWorkflowRuntime(options: {
  store?: CaseStore;
  storeKind?: "memory" | "file";
  storeLocation?: string | null;
  sessionSecret?: string;
  /** Absolute session lifetime (seconds); default 2 hours. */
  sessionMaxAgeSeconds?: number;
  /** File that keeps logged-out token ids across restarts (file-backed runtimes only). */
  revocationFile?: string | null;
  demoAuthEnabled?: boolean;
  seed?: boolean;
  cvDir?: string | null;
  workspaceDir?: string | null;
  analysisEngine?: AnalysisEngine;
  /** Registered accounts; in memory when not given. */
  accounts?: AccountStore;
} = {}): WorkflowRuntime {
  const store = options.store ?? new MemoryCaseStore();
  const accounts = options.accounts ?? new AccountStore();
  // Fixture identities exist only where demo auth is on, which the product server never enables
  // (DEMO_AUTH defaults to off); in-memory test runtimes keep them until the tests migrate.
  const demoAuthEnabled = options.demoAuthEnabled ?? true;
  const service = new WorkflowService(store, {
    now: () => new Date().toISOString(),
    newId: (prefix) => `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`,
    roleOf: (id) => accounts.roleOf(id) ?? (demoAuthEnabled ? roleOfDemoAccount(id) : null),
    // The product screens with the verified OpenVINO result; fixture runtimes keep the demo provider.
    cv: demoAuthEnabled ? DEMO_CV_PROVIDER : VERIFIED_CV_PROVIDER
  });
  const ready = options.seed === false ? Promise.resolve() : service.ensureSeeded(INITIAL_COMMUNITY_REPORTS).then(() => undefined);
  return {
    service,
    signer: new SessionSigner(options.sessionSecret, options.sessionMaxAgeSeconds, options.revocationFile ?? null),
    demoAuthEnabled,
    accounts,
    storeKind: options.storeKind ?? (options.store ? "file" : "memory"),
    storeLocation: options.storeLocation ?? null,
    ready,
    cv: new CvAnalysisStore(options.cvDir ?? null),
    workspaces: new WorkspaceService(new FileWorkspaceRepository(options.workspaceDir ?? null), service, options.analysisEngine, { seedDemo: options.seed !== false })
  };
}
