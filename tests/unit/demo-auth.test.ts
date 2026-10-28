/**
 * Demo login without a browser: the credential table, the server-side check, the
 * gateways' session rules (no session from an account id, logout, refresh), the login
 * messages, and route guards for signed-out and wrong-role identities.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_CREDENTIALS,
  accountIdFor,
  demoLoginFor,
  findDemoCredential
} from '../../src/data/reference/demoCredentials';
import { USER_ACCOUNTS } from '../../src/data/reference/demoAccounts';
import { verifyDemoLogin } from '../../server/auth/demoLogin';
import {
  HttpWorkflowGateway,
  OfflineWorkflowGateway,
  WorkflowApiError,
  type LoginCredentials
} from '../../src/services/api/workflowClient';
import { loginErrorMessage, validateLoginFields } from '../../src/features/authentication/loginMessages';
import { canOpenRoute, resolveRouteAccess } from '../../src/app/guards/routeAccess';
import { getRoute } from '../../src/app/routeConfig';
import type { UserRole } from '../../src/types';

// --- A minimal sessionStorage, so the gateways' refresh behaviour can be exercised ------
const store = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  sessionStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  }
};

const roleOf = (id: string): UserRole | null => USER_ACCOUNTS.find((a) => a.id === id)?.role ?? null;
const verifier = async (c: LoginCredentials) => {
  const credential = findDemoCredential(c.username);
  return credential && credential.password === c.password ? accountIdFor(credential, c.layout) : null;
};
const offline = (withVerifier = true) => new OfflineWorkflowGateway([], roleOf, [], [], withVerifier ? verifier : undefined);

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'OK';
  } catch (e) {
    return e instanceof WorkflowApiError ? e.code : `UNEXPECTED ${(e as Error).message}`;
  }
}

test('the brief\'s five credentials map to the five roles and their named demo accounts', () => {
  const expected: Record<string, [UserRole, string]> = {
    'field.ahmad': ['FIELD_ENGINEER', 'Ir. Ahmad Subagyo, M.T.'],
    'ops.hendra': ['OPERATIONS_MANAGER', 'Drs. Hendra Gunawan, S.Si.'],
    'policy.retno': ['POLICY_MAKER', 'Dr. Ir. Retno Wulandari'],
    'citizen.budi': ['PUBLIC_REPORTER', 'Budi Santoso, S.T.'],
    'viewer.siti': ['PUBLIC_VIEWER', 'Siti Aminah, S.E.']
  };
  assert.deepEqual(DEMO_CREDENTIALS.map((c) => c.username).sort(), Object.keys(expected).sort());
  for (const c of DEMO_CREDENTIALS) {
    const [role, name] = expected[c.username];
    const account = USER_ACCOUNTS.find((a) => a.id === c.accounts.MODERN_APP)!;
    assert.equal(c.role, role);
    assert.equal(account.role, role);
    assert.equal(account.name, name);
  }
});

test('demo identities do not look like real institutional accounts', () => {
  for (const account of USER_ACCOUNTS) {
    assert.match(account.email, /@pavement-pinn\.example$/, account.id);
    assert.match(account.nip, /^DEMO-/, account.id);
  }
});

test('server check: valid credentials open the account; anything else fails without saying why', () => {
  assert.deepEqual(verifyDemoLogin('field.ahmad', 'FieldPinn2026!'), { ok: true, accountId: 'USR-006' });
  assert.deepEqual(verifyDemoLogin('field.ahmad', 'FieldPinn2026!', 'CLASSIC_PORTAL'), { ok: true, accountId: 'USR-001' });
  assert.deepEqual(verifyDemoLogin('citizen.budi', 'CitizenPinn2026!', 'CLASSIC_PORTAL'), { ok: true, accountId: 'USR-004' });
  for (const [u, p] of [
    ['field.ahmad', 'fieldpinn2026!'],
    ['field.ahmad', 'OpsPinn2026!'],
    ['nobody', 'FieldPinn2026!'],
    ['field.ahmad', 'x'.repeat(300)]
  ]) {
    assert.deepEqual(verifyDemoLogin(u, p), { ok: false, reason: 'INVALID_CREDENTIALS' }, `${u}/${p.slice(0, 12)}`);
  }
  for (const [u, p] of [['', 'x'], ['field.ahmad', ''], [undefined, 'x'], ['field.ahmad', 42]] as const) {
    assert.deepEqual(verifyDemoLogin(u, p), { ok: false, reason: 'MISSING_FIELDS' });
  }
});

test('demoLoginFor reverses the mapping for every demo account', () => {
  for (const account of USER_ACCOUNTS) {
    const login = demoLoginFor(account.id);
    assert.ok(login, account.id);
    assert.deepEqual(verifyDemoLogin(login!.username, login!.password, login!.layout), { ok: true, accountId: account.id });
  }
});

test('server gateway: a named account never gets a session from its id alone', async (t) => {
  store.clear();
  // Stand-in for the server: the session is whatever cookie the browser holds (none, then
  // one for a different account); logout calls are recorded.
  let cookieActor: { id: string; role: string; kind: string } | null = null;
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.endsWith('/api/auth/me')) {
      return cookieActor
        ? new Response(JSON.stringify({ success: true, actor: cookieActor }), { status: 200 })
        : new Response(JSON.stringify({ success: false, error: { code: 'UNAUTHENTICATED', message: 'No valid session.' } }), { status: 401 });
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  const gateway = new HttpWorkflowGateway();
  // No login (no session cookie): resuming an official account fails on the server's answer.
  assert.equal(await code(gateway.useAccount({ id: 'USR-007', role: 'POLICY_MAKER' })), 'UNAUTHENTICATED');
  // A session that belongs to a different account is not reused for this one,
  // and a token left in tab storage is not presented for a named account either.
  cookieActor = { id: 'USR-004', role: 'FIELD_ENGINEER', kind: 'DEMO_ACCOUNT' };
  store.set('pavement-pinn.workflow-session', JSON.stringify({ key: 'demo:USR-004', token: 'whatever' }));
  assert.equal(await code(gateway.useAccount({ id: 'USR-007', role: 'POLICY_MAKER' })), 'UNAUTHENTICATED');
  assert.equal(store.has('pavement-pinn.workflow-session'), false);
  // Logout ends the session on the server too.
  await gateway.logout();
  assert.ok(calls.some((c) => c === 'POST /api/auth/logout'), calls.join(', '));
});

test('static build gateway: login, refresh, logout and wrong credentials', async () => {
  store.clear();
  const first = offline();
  assert.equal(await code(first.useAccount({ id: 'USR-008', role: 'OPERATIONS_MANAGER' })), 'UNAUTHENTICATED');
  assert.equal(await code(first.login({ username: 'ops.hendra', password: 'wrong' })), 'UNAUTHENTICATED');
  const { actor } = await first.login({ username: 'OPS.HENDRA', password: 'OpsPinn2026!' });
  assert.deepEqual(actor, { id: 'USR-008', role: 'OPERATIONS_MANAGER', kind: 'DEMO_ACCOUNT' });

  // Refresh: a new gateway in the same tab resumes the signed-in account, and only that one.
  const afterRefresh = offline();
  assert.equal((await afterRefresh.useAccount({ id: 'USR-008', role: 'OPERATIONS_MANAGER' })).id, 'USR-008');
  assert.equal(await code(afterRefresh.useAccount({ id: 'USR-007', role: 'POLICY_MAKER' })), 'UNAUTHENTICATED');

  afterRefresh.logout();
  assert.equal(await code(offline().useAccount({ id: 'USR-008', role: 'OPERATIONS_MANAGER' })), 'UNAUTHENTICATED');
  assert.equal((await offline().useAccount(null)).kind, 'ANONYMOUS');
});

test('static build without demo access offers no login at all', async () => {
  store.clear();
  assert.equal(await code(offline(false).login({ username: 'ops.hendra', password: 'OpsPinn2026!' })), 'DISABLED');
});

test('login form messages: required fields, generic failure, rate limit, disabled, network', () => {
  assert.deepEqual(validateLoginFields('  ', ''), { username: 'Masukkan email atau nama pengguna.', password: 'Masukkan kata sandi.' });
  assert.deepEqual(validateLoginFields('field.ahmad', 'x'), {});
  assert.equal(loginErrorMessage('UNAUTHENTICATED'), 'Nama pengguna atau kata sandi salah.');
  assert.match(loginErrorMessage('RATE_LIMITED', 429), /Terlalu banyak/);
  assert.match(loginErrorMessage('DISABLED'), /belum tersedia/);
  assert.match(loginErrorMessage('NETWORK'), /tidak dapat dihubungi/);
});

test('route guards: signed-out visitors are sent to login, other roles are refused', () => {
  const anonymous = { role: 'PUBLIC_VIEWER' as UserRole };
  // Everything needs an account except login, public tracking and the evidence page.
  assert.equal(resolveRouteAccess(getRoute('map'), anonymous), 'LOGIN_REQUIRED');
  assert.equal(resolveRouteAccess(getRoute('tasks'), anonymous), 'LOGIN_REQUIRED');
  assert.equal(resolveRouteAccess(getRoute('login'), anonymous), 'ALLOW');
  assert.equal(resolveRouteAccess(getRoute('evidence'), anonymous), 'ALLOW');
  const engineer = { role: 'FIELD_ENGINEER' as UserRole };
  assert.equal(resolveRouteAccess(getRoute('team'), engineer), 'FORBIDDEN');
  assert.equal(canOpenRoute('tasks', engineer), true);
});
