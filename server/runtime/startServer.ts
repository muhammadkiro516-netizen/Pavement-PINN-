import path from "node:path";
import http from "node:http";
import { createApp } from "../app";
import { loadServerConfig, type ServerConfig } from "../config/env";
import { attachFrontendHost } from "../middleware/frontendHost";
import { FileCaseStore } from "../repositories/fileCaseStore";
import { createWorkflowRuntime } from "../services/workflowRuntime";
import { AccountStore } from "../repositories/accountStore";
import { setRuntimePorts, setRuntimeStore } from "./runtimeIdentity";
import { resolveSessionSecret } from "../auth/sessionTokens";

export interface StartOptions {
  /** Port that owns the runtime (default: config.port). */
  port?: number;
  /** Extra ports answered by this same process: same app, store, sessions and HMR. */
  aliasPorts?: number[];
  config?: ServerConfig;
}

export interface StartedServer {
  ports: number[];
  storeLocation: string;
  close: () => Promise<void>;
}

const listen = (server: http.Server, port: number, host: string) =>
  new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });

/**
 * One PAVEMENT-PINN runtime: one Express app, one workflow store, one session signer and
 * (in development) one Vite instance. Alias ports are extra HTTP listeners on the same app;
 * their websocket upgrades are handed to the primary server, where Vite's HMR listens.
 * Throws (EADDRINUSE etc.) before anything is served if a port cannot be bound.
 */
export async function startServer(options: StartOptions = {}): Promise<StartedServer> {
  const config = options.config ?? loadServerConfig();
  const port = options.port ?? config.port;
  const aliases = [...new Set(options.aliasPorts ?? [])].filter((p) => p !== port);
  const store = new FileCaseStore(config.dataDir);
  const workflow = createWorkflowRuntime({
    store,
    storeKind: "file",
    storeLocation: store.location,
    // Kept in the data directory when SESSION_SECRET is unset, so a restart keeps everyone signed in.
    sessionSecret: resolveSessionSecret(config.sessionSecret, path.dirname(store.location)),
    sessionMaxAgeSeconds: config.sessionMaxAgeSeconds,
    revocationFile: path.join(path.dirname(store.location), "revoked-sessions.json"),
    demoAuthEnabled: config.demoAuthEnabled,
    // Real data only: no sample reports or sample workspaces are loaded into the product.
    seed: false,
    accounts: new AccountStore(path.join(config.dataDir, "accounts.json")),
    cvDir: path.join(config.dataDir, "cv-analyses"),
    workspaceDir: path.join(config.dataDir, "workspaces")
  });
  await workflow.ready;
  const app = createApp({ workflow });
  const primary = http.createServer(app);
  // Vite middleware or static serving (must come after the API routes); HMR rides on `primary`.
  const stopFrontend = await attachFrontendHost(app, config, primary);

  const servers = [primary];
  await listen(primary, port, config.host);
  try {
    for (const alias of aliases) {
      const server = http.createServer(app);
      server.on("upgrade", (req, socket, head) => primary.emit("upgrade", req, socket, head));
      await listen(server, alias, config.host);
      servers.push(server);
    }
  } catch (error) {
    await Promise.all(servers.map((s) => new Promise((r) => s.close(() => r(null)))));
    throw error;
  }
  setRuntimePorts(port, aliases);
  setRuntimeStore("file", store.location, Boolean(config.sessionSecret));
  return {
    ports: [port, ...aliases],
    storeLocation: store.location,
    close: async () => {
      // Vite's watcher would otherwise keep the process alive after the ports are closed.
      await stopFrontend().catch(() => undefined);
      await Promise.all(servers.map((s) => new Promise((r) => { s.closeAllConnections?.(); s.close(() => r(null)); })));
    }
  };
}
