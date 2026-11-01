/** Thin client for /api/v5. Errors keep the server's plain-English message and SoD rule. */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const TOKEN_KEY = 'pp-v5-session';

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
  if (!json.success) throw new V5ApiError(json.error?.message ?? 'Ada yang tidak berjalan. Coba lagi.', json.error?.code ?? 'ERROR', json.error?.rule);
  return json.data as T;
}

const DEVICE_KEY = 'pp-v5-device';
const STAFF_KEY = 'pp-v5-staff';

const flag = (key: string, value?: string | null) => {
  try {
    if (value === undefined) return sessionStorage.getItem(key);
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch { /* Storage may be blocked: the session lasts for this page. */ }
  return null;
};

export const staffSessionActive = () => flag(STAFF_KEY) === '1' && !!sessionToken();

export function signOutStaff(): void {
  flag(STAFF_KEY, null);
  setSessionToken(null);
}

/** Staff sign-in. False when these are not valid credentials. */
export async function signInStaff(email: string, password: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/v5/session/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const json = await res.json();
    if (!json.success) return false;
    setSessionToken(json.data.token);
    flag(STAFF_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/** A citizen has no login: a pseudonymous device key, kept so "Kawal" still works next week. */
export async function ensureDeviceSession(): Promise<void> {
  if (staffSessionActive()) return;
  let saved: string | null = null;
  try { saved = localStorage.getItem(DEVICE_KEY); } catch { /* blocked storage: a new key below */ }
  if (saved) {
    setSessionToken(saved);
    try { await v5('/me'); return; } catch { /* expired: a new key below */ }
  }
  setSessionToken(null);
  const session = await v5<{ token: string }>('/session/device', {});
  try { localStorage.setItem(DEVICE_KEY, session.token); } catch { /* blocked storage */ }
  setSessionToken(session.token);
}
