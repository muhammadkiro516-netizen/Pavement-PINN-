/**
 * Demo session — which stakeholder identity the UI is currently acting as.
 *
 * Before anyone picks an account the visitor is ANONYMOUS: a public viewer that may
 * report road damage without logging in (spec §22), never one of the named demo accounts.
 * The workflow server gives the anonymous visitor its own server-issued id; this
 * provider only tracks which identity the UI shows.
 *
 * Where a signed-in session lives:
 * - Server (normal): an HttpOnly cookie set at login. The server is the only authority: on load
 *   this provider asks /api/auth/me who is signed in and until when, so a refresh, a new tab or
 *   a direct URL resumes the same account and role, and nothing in browser storage can name an
 *   account. Nothing below this provider renders until that answer is in, so route guards never
 *   see a half-restored identity (no flash of the login page). The deadline is absolute
 *   (issuedAt + 2 h, set by the server) and never moves; the server refuses the session after it.
 * - Static build (no server): the offline demo keeps the account id in sessionStorage.
 * Limits: docs/LOGIN_AND_DEMO_AUTH.md.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { UserRole, WORKFLOW_API_PATHS, type AccountProfile } from '../../types';
import { USER_ACCOUNTS, UserAccount } from '../../features/authentication/demoAccounts';
import { apiUrl, isStaticHost } from '../../services/api/client';

/** Stable id of the local anonymous identity (the server issues its own anon-… id). */
export const ANONYMOUS_ACCOUNT_ID = 'ANONYMOUS';

const NEUTRAL_AVATAR =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#334155"/><circle cx="32" cy="25" r="11" fill="#94a3b8"/><path d="M12 56c3-11 11-17 20-17s17 6 20 17z" fill="#94a3b8"/></svg>'
  );

/** Visitor who has not picked an account: public viewer, can report, cannot edit. */
export const ANONYMOUS_ACCOUNT: UserAccount = {
  id: ANONYMOUS_ACCOUNT_ID,
  name: 'Pengunjung Anonim',
  title: 'Warga tanpa login',
  role: 'PUBLIC_VIEWER',
  agency: 'Publik',
  agencyCode: 'ANONIM',
  email: '',
  nip: 'Tidak login',
  clearanceLevel: 'Publik — tanpa akun (laporan anonim)',
  avatarUrl: NEUTRAL_AVATAR,
  allowedScopes: ['Lihat peta & laporan publik', 'Buat laporan kerusakan anonim', 'Lacak status laporan dengan ID laporan'],
  restrictedScopes: ['Mengedit laporan', 'Data internal petugas & audit trail']
};

const ROLE_TITLE: Partial<Record<UserRole, string>> = {
  PUBLIC_REPORTER: 'Warga',
  FIELD_ENGINEER: 'Petugas Lapangan',
  OPERATIONS_MANAGER: 'Koordinator'
};

/** The app's account shape for a registered account (no fixture fields are invented). */
export function accountFromProfile(profile: AccountProfile): UserAccount {
  return {
    id: profile.id,
    name: profile.name,
    title: ROLE_TITLE[profile.role] ?? profile.role,
    role: profile.role,
    agency: profile.agency ?? 'Warga',
    agencyCode: profile.agency ?? '',
    email: profile.email,
    nip: '',
    clearanceLevel: ROLE_TITLE[profile.role] ?? '',
    avatarUrl: NEUTRAL_AVATAR,
    layoutStyle: 'MODERN_APP',
    allowedScopes: [],
    restrictedScopes: []
  };
}

/** Identity before any login. */
export const DEFAULT_PUBLIC_ACCOUNT: UserAccount = ANONYMOUS_ACCOUNT;

export function isAnonymousAccount(account: Pick<UserAccount, 'id'>): boolean {
  return account.id === ANONYMOUS_ACCOUNT_ID;
}

/** Shown on the login page after the server ended the session at its 2-hour limit. */
export const SESSION_EXPIRED_MESSAGE = 'Sesi Anda telah berakhir setelah 2 jam. Silakan login kembali.';

const STATIC_STORAGE_KEY = 'pavement-pinn.demo-session.account-id';
const AUTH_CHANNEL = 'pavement-pinn.auth';

type SessionStatus = 'restoring' | 'ready' | 'unreachable';

function readStaticAccount(): UserAccount {
  try {
    const storedId = window.sessionStorage.getItem(STATIC_STORAGE_KEY);
    return USER_ACCOUNTS.find((acc) => acc.id === storedId) ?? DEFAULT_PUBLIC_ACCOUNT;
  } catch {
    return DEFAULT_PUBLIC_ACCOUNT;
  }
}

function storeStaticAccount(account: UserAccount | null): void {
  try {
    if (account && !isAnonymousAccount(account)) window.sessionStorage.setItem(STATIC_STORAGE_KEY, account.id);
    else window.sessionStorage.removeItem(STATIC_STORAGE_KEY);
  } catch {
    // Storage unavailable: the session lives in memory only.
  }
}

type ServerSession =
  | { kind: 'account'; account: UserAccount; expiresAt: string }
  | { kind: 'none' }
  | { kind: 'expired' }
  | { kind: 'unreachable' };

/** Who the server says is signed in (cookie session); never throws. */
async function fetchServerSession(): Promise<ServerSession> {
  let res: Response;
  try {
    res = await fetch(apiUrl(WORKFLOW_API_PATHS.me), { credentials: 'same-origin', cache: 'no-store' });
  } catch {
    return { kind: 'unreachable' };
  }
  const json = (await res.json().catch(() => null)) as
    | { success?: boolean; actor?: { id: string; kind: string }; account?: AccountProfile | null; expiresAt?: string; error?: { code?: string } }
    | null;
  if (res.status >= 500 || !json) return { kind: 'unreachable' };
  if (!res.ok || !json.success) return json.error?.code === 'SESSION_EXPIRED' ? { kind: 'expired' } : { kind: 'none' };
  const account =
    json.actor?.kind === 'ACCOUNT' && json.account
      ? accountFromProfile(json.account)
      : json.actor?.kind === 'DEMO_ACCOUNT'
        ? USER_ACCOUNTS.find((a) => a.id === json.actor!.id)
        : undefined;
  return account && json.expiresAt ? { kind: 'account', account, expiresAt: json.expiresAt } : { kind: 'none' };
}

export interface SessionValue {
  currentAccount: UserAccount;
  activeRole: UserRole;
  /** Absolute end of the signed-in session (ISO), or null for the anonymous visitor. */
  expiresAt: string | null;
  /** Set after the session ended at its time limit; the login page shows it. */
  endedNotice: string | null;
  clearEndedNotice: () => void;
  /** Show the account a credential check returned. Call only after a successful login. */
  establishSession: (account: UserAccount, expiresAt?: string | null) => void;
  /**
   * Return to the anonymous visitor at once. Pass the server logout: other tabs are told only
   * after it settles, so they re-check against a session that is already revoked.
   */
  logout: (serverLogout?: Promise<unknown>) => void;
  /** The server rejected the session as ended: sign out (all tabs) with the expiry notice. */
  expireSession: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const serverMode = !isStaticHost();
  const [status, setStatus] = useState<SessionStatus>(serverMode ? 'restoring' : 'ready');
  const [currentAccount, setCurrentAccount] = useState<UserAccount>(() => (serverMode ? DEFAULT_PUBLIC_ACCOUNT : readStaticAccount()));
  const [activeRole, setActiveRole] = useState<UserRole>(() => currentAccount.role);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [endedNotice, setEndedNotice] = useState<string | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  // Deadline of the session this tab holds; read in resync without re-creating it.
  const deadline = useRef<string | null>(null);

  const apply = useCallback((account: UserAccount, until: string | null) => {
    setCurrentAccount((prev) => (prev.id === account.id ? prev : account));
    setActiveRole(account.role);
    setExpiresAt(until);
    deadline.current = until;
  }, []);

  const toAnonymous = useCallback(() => apply(DEFAULT_PUBLIC_ACCOUNT, null), [apply]);

  /** Ask the server and follow its answer; a network failure keeps the current state. */
  const resync = useCallback(async () => {
    if (!serverMode) return;
    const session = await fetchServerSession();
    if (session.kind === 'account') {
      apply(session.account, session.expiresAt);
      setStatus('ready');
    } else if (session.kind === 'expired') {
      toAnonymous();
      setEndedNotice(SESSION_EXPIRED_MESSAGE);
      setStatus('ready');
    } else if (session.kind === 'none') {
      // The cookie lives exactly until the deadline, so after it the browser has already dropped
      // it and the server just sees no session: past our known deadline that still means expiry.
      const lapsed = deadline.current !== null && Date.now() >= Date.parse(deadline.current);
      toAnonymous();
      if (lapsed) setEndedNotice(SESSION_EXPIRED_MESSAGE);
      setStatus('ready');
    } else {
      // Unreachable: nothing is cleared (the cookie may still be valid). First load offers a retry.
      setStatus((s) => (s === 'restoring' ? 'unreachable' : s));
    }
  }, [serverMode, apply, toAnonymous]);

  // First load: restore before anything (routes, guards, data) renders.
  useEffect(() => {
    void resync();
  }, [resync]);

  // Other tabs: a login or logout there is re-read from the server here.
  useEffect(() => {
    if (!serverMode || typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(AUTH_CHANNEL);
    channel.current = ch;
    ch.onmessage = () => void resync();
    return () => {
      ch.close();
      channel.current = null;
    };
  }, [serverMode, resync]);
  const announce = useCallback((type: 'login' | 'logout') => channel.current?.postMessage({ type }), []);

  const expireSession = useCallback(() => {
    toAnonymous();
    storeStaticAccount(null);
    setEndedNotice(SESSION_EXPIRED_MESSAGE);
    announce('logout');
  }, [toAnonymous, announce]);

  // At the absolute deadline the server already refuses the session; ask it, and follow.
  // Timers run late after sleep, so returning to the tab (or a back/forward-cache restore)
  // re-checks too.
  useEffect(() => {
    if (!serverMode || !expiresAt) return;
    const remaining = Date.parse(expiresAt) - Date.now();
    const timer = window.setTimeout(() => void resync(), Math.max(0, Math.min(remaining + 500, 2 ** 31 - 1)));
    const recheck = () => {
      if (document.visibilityState === 'visible') void resync();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void resync();
    };
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('focus', recheck);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [serverMode, expiresAt, resync]);

  const establishSession = useCallback(
    (account: UserAccount, until: string | null = null) => {
      apply(account, until);
      setEndedNotice(null);
      if (!serverMode) storeStaticAccount(account);
      // The deadline is the server's: read it back rather than computing one here.
      else void resync();
      announce('login');
    },
    [apply, serverMode, announce, resync]
  );

  const logout = useCallback(
    (serverLogout?: Promise<unknown>) => {
      toAnonymous();
      storeStaticAccount(null);
      void Promise.resolve(serverLogout).finally(() => announce('logout'));
    },
    [toAnonymous, announce]
  );

  const clearEndedNotice = useCallback(() => setEndedNotice(null), []);

  const value = useMemo<SessionValue>(
    () => ({ currentAccount, activeRole, expiresAt, endedNotice, clearEndedNotice, establishSession, logout, expireSession }),
    [currentAccount, activeRole, expiresAt, endedNotice, clearEndedNotice, establishSession, logout, expireSession]
  );

  if (status !== 'ready') {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-[#090A0C] text-sm text-[#A0A6AF]" role="status" aria-live="polite">
        {status === 'restoring' ? (
          'Memeriksa sesi…'
        ) : (
          <div className="flex flex-col items-center gap-3">
            <span>Server tidak dapat dihubungi, sesi belum dapat diperiksa.</span>
            <button
              type="button"
              onClick={() => void resync()}
              className="h-9 cursor-pointer rounded-[10px] border border-[#292D33] bg-[#1E2228] px-4 text-[#F0F1F3]"
            >
              Coba lagi
            </button>
          </div>
        )}
      </div>
    );
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>');
  return value;
}
