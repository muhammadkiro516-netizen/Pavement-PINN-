/** Thin client for /api/v5. Errors keep the server's plain-English message and SoD rule. */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const TOKEN_KEY = 'v5.session';

export class V5ApiError extends Error {
  constructor(message: string, readonly code: string, readonly rule?: string) {
    super(message);
  }
}

export function sessionToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* A private window may refuse storage; the session then lasts for this page only. */
  }
}

export async function v5<T>(path: string, body?: unknown): Promise<T> {
  const token = sessionToken();
  const res = await fetch(`${BASE}/api/v5${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-v5-session': token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const json = await res.json();
  if (!json.success) throw new V5ApiError(json.error?.message ?? 'Something went wrong.', json.error?.code ?? 'ERROR', json.error?.rule);
  return json.data as T;
}
