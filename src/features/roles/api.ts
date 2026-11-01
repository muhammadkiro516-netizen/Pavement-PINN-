/** Thin client for /api/v5. Errors keep the server's plain-English message and SoD rule. */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const TOKEN_KEY = 'pp-v5-session';

export class V5ApiError extends Error {
  constructor(message: string, readonly code: string, readonly rule?: string) {
    super(message);
  }
}

const STAFF_TOKEN_KEY = 'pp-v6-staff-session';
const REMEMBER_KEY = 'pp-v6-remember';

const local = (key: string, value?: string | null): string | null => {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* Blocked storage: the person types the code again next time. */ }
  return null;
};

export function sessionToken(): string | null {
  const staff = local(STAFF_TOKEN_KEY);
  if (staff) return staff;
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

/** Set once by the workspace shell: asks the person for their PIN on a sensitive action. */
let askPin: (() => Promise<string | null>) | null = null;
export const setPinAsker = (fn: typeof askPin) => { askPin = fn; };

async function send<T>(url: string, body: unknown, pin?: string): Promise<T> {
  const token = sessionToken();
  const res = await fetch(`${BASE}${url}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-v5-session': token } : {}), ...(pin ? { 'x-v6-pin': pin } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const json = await res.json();
  if (!json.success) {
    if (json.error?.code === 'PIN_REQUIRED' && askPin) {
      const typed = await askPin();
      if (typed) return send<T>(url, body, typed);
    }
    throw new V5ApiError(json.error?.message ?? 'Ada yang tidak berjalan. Coba lagi.', json.error?.code ?? 'ERROR', json.error?.rule);
  }
  return json.data as T;
}

export const v5 = <T,>(path: string, body?: unknown) => send<T>(`/api/v5${path}`, body);
export const v6 = <T,>(path: string, body?: unknown) => send<T>(`/api/v6${path}`, body);

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

export const staffSessionActive = () => !!local(STAFF_TOKEN_KEY);

/** A device that has signed in before only needs the PIN. */
export const hasRememberedDevice = () => !!local(REMEMBER_KEY);

export function signOutStaff(): void {
  local(STAFF_TOKEN_KEY, null);
  local(REMEMBER_KEY, null);
  flag(STAFF_KEY, null);
  setSessionToken(null);
}

/** The Lock button: back to the PIN screen, on this device only. */
export async function lockSession(): Promise<void> {
  await v6('/session/lock', {}).catch(() => undefined);
  local(STAFF_TOKEN_KEY, null);
  setSessionToken(null);
}

export type SignInStep = 'SET_PIN' | 'ENTER_PIN' | 'GUEST';

export const startSignIn = (code: string) => v6<{ step: SignInStep; agencyName: string }>('/session/start', { code });

/** With a code, or with the remembered device when the code is empty. */
export async function finishSignIn(code: string | null, pin: string | null): Promise<void> {
  const out = await v6<{ token: string; remember: string | null }>('/session', code ? { code, pin } : { remember: local(REMEMBER_KEY), pin });
  local(STAFF_TOKEN_KEY, out.token);
  if (out.remember) local(REMEMBER_KEY, out.remember);
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
