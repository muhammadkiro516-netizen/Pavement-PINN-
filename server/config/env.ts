import { normalizeBasePath } from "../../src/constants/deployment";
import { SESSION_MAX_AGE_SECONDS } from "../auth/sessionTokens";

/**
 * Server runtime configuration, read once from the process environment.
 *
 * Note: `.env` files are NOT loaded (the pre-restructure server never called dotenv
 * either). Variables must be present in the real environment.
 */
export interface ServerConfig {
  port: number;
  host: string;
  isProduction: boolean;
  /** Base path the SPA assets are built for (must match the Vite `base`). */
  basePath: string;
  /** Directory of the local workflow store (development/demo persistence). */
  dataDir: string;
  /** HMAC secret for session tokens (>= 32 chars). Unset: a key kept in the data directory. */
  sessionSecret: string | undefined;
  /** Test fixture identities. Off unless DEMO_AUTH=true; the product uses registered accounts only. */
  demoAuthEnabled: boolean;
  /**
   * Absolute session lifetime in seconds: 2 hours. SESSION_MAX_AGE_SECONDS may only shorten it,
   * and only outside production (to test expiry without waiting two hours).
   */
  sessionMaxAgeSeconds: number;
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsedPort = Number.parseInt(env.PORT ?? "", 10);
  return {
    port: Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 3000,
    host: "0.0.0.0",
    isProduction: env.NODE_ENV === "production",
    basePath: normalizeBasePath(env.VITE_BASE_PATH),
    dataDir: env.DATA_DIR && env.DATA_DIR.trim() !== "" ? env.DATA_DIR : ".data",
    sessionSecret: env.SESSION_SECRET && env.SESSION_SECRET.length >= 32 ? env.SESSION_SECRET : undefined,
    demoAuthEnabled: env.DEMO_AUTH === "true",
    sessionMaxAgeSeconds: sessionMaxAge(env)
  };
}

function sessionMaxAge(env: NodeJS.ProcessEnv): number {
  const requested = Number.parseInt(env.SESSION_MAX_AGE_SECONDS ?? "", 10);
  if (env.NODE_ENV === "production" || !Number.isInteger(requested) || requested < 10) return SESSION_MAX_AGE_SECONDS;
  return Math.min(requested, SESSION_MAX_AGE_SECONDS);
}
