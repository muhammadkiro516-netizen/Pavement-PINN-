/**
 * Client for the Python inference service (Dokumen Induk v3 D-23): Express forwards
 * engine requests to INFERENCE_URL. When the service is down the caller gets an explicit
 * INFERENCE_UNAVAILABLE error — never a locally invented result.
 */
export const DEFAULT_INFERENCE_URL = "http://127.0.0.1:8100";
// MLET field grids take seconds (one solver call per radius); a loaded host needs headroom.
const TIMEOUT_MS = 90_000;

export function inferenceUrl(): string {
  return (process.env.INFERENCE_URL || DEFAULT_INFERENCE_URL).replace(/\/+$/, "");
}

export type InferenceReply =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number; body: unknown }
  | { ok: false; status: 503; unavailable: true; message: string };

export async function callInference(method: "GET" | "POST", path: string, payload?: unknown, timeoutMs: number = TIMEOUT_MS): Promise<InferenceReply> {
  try {
    const res = await fetch(`${inferenceUrl()}${path}`, {
      method,
      headers: payload === undefined ? undefined : { "Content-Type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch (error: any) {
    return { ok: false, status: 503, unavailable: true, message: error?.name === "TimeoutError" ? "Inference service timed out." : "Inference service is not reachable." };
  }
}

/** Binary POST (image or video bytes) to the inference service. */
export async function callInferenceBytes(path: string, bytes: Buffer, contentType: string, timeoutMs = 60_000): Promise<InferenceReply> {
  try {
    const res = await fetch(`${inferenceUrl()}${path}`, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch (error: any) {
    return { ok: false, status: 503, unavailable: true, message: error?.name === "TimeoutError" ? "Inference service timed out." : "Inference service is not reachable." };
  }
}
