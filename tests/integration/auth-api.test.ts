/**
 * Demo login over real HTTP: credentials decide the identity, the server signs the
 * session, and nothing in a request body can choose an account or a role.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../../server/app';
import { createWorkflowRuntime } from '../../server/services/workflowRuntime';
import { DEMO_CREDENTIALS } from '../../src/data/reference/demoCredentials';
import { USER_ACCOUNTS } from '../../src/data/reference/demoAccounts';
import { bodyWithSession } from '../helpers/sessionCookie';

let server: Server;
let base = '';

function listen(app: ReturnType<typeof createApp>): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve({ server: s, base: `http://127.0.0.1:${(s.address() as AddressInfo).port}` }));
  });
}

before(async () => {
  const workflow = createWorkflowRuntime({ seed: false, sessionSecret: 'z'.repeat(40) });
  await workflow.ready;
  ({ server, base } = await listen(createApp({ workflow })));
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function post(p: string, body: unknown, at = base) {
  const r = await fetch(at + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await bodyWithSession(r) };
}

async function me(token: string) {
  const r = await fetch(base + '/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  return { status: r.status, body: await bodyWithSession(r) };
}

test('each demo credential signs in as its own account and role', async () => {
  for (const credential of DEMO_CREDENTIALS) {
    const r = await post('/api/auth/login', { username: credential.username, password: credential.password });
    assert.equal(r.status, 200, credential.username);
    assert.equal(r.body.actor.id, credential.accounts.MODERN_APP);
    assert.equal(r.body.actor.role, credential.role);
    assert.equal(r.body.actor.kind, 'DEMO_ACCOUNT');
    assert.match(r.body.authentication, /not production/);
    const who = await me(r.body.token);
    assert.equal(who.status, 200);
    assert.equal(who.body.actor.id, credential.accounts.MODERN_APP);
    assert.equal(USER_ACCOUNTS.find((a) => a.id === who.body.actor.id)?.role, credential.role);
  }
});

test('the five demo roles are the five existing role identifiers', () => {
  assert.deepEqual(
    DEMO_CREDENTIALS.map((c) => c.role).sort(),
    ['FIELD_ENGINEER', 'OPERATIONS_MANAGER', 'POLICY_MAKER', 'PUBLIC_REPORTER', 'PUBLIC_VIEWER']
  );
  for (const c of DEMO_CREDENTIALS) {
    for (const id of [c.accounts.MODERN_APP, c.accounts.CLASSIC_PORTAL].filter(Boolean)) {
      assert.equal(USER_ACCOUNTS.find((a) => a.id === id)?.role, c.role, `${c.username} -> ${id}`);
    }
  }
});

test('username is case-insensitive, the demo email works, and the classic portal is selectable', async () => {
  const ahmad = DEMO_CREDENTIALS[0];
  const upper = await post('/api/auth/login', { username: `  ${ahmad.username.toUpperCase()} `, password: ahmad.password });
  assert.equal(upper.status, 200);
  const email = USER_ACCOUNTS.find((a) => a.id === ahmad.accounts.MODERN_APP)!.email;
  const byEmail = await post('/api/auth/login', { username: email, password: ahmad.password });
  assert.equal(byEmail.status, 200);
  assert.equal(byEmail.body.actor.id, ahmad.accounts.MODERN_APP);
  const classic = await post('/api/auth/login', { username: ahmad.username, password: ahmad.password, layout: 'CLASSIC_PORTAL' });
  assert.equal(classic.body.actor.id, ahmad.accounts.CLASSIC_PORTAL);
});

test('wrong password and unknown user fail the same way; a password is case-sensitive', async () => {
  const c = DEMO_CREDENTIALS[1];
  const wrong = await post('/api/auth/login', { username: c.username, password: 'nope' });
  const unknown = await post('/api/auth/login', { username: 'nobody.here', password: c.password });
  const casing = await post('/api/auth/login', { username: c.username, password: c.password.toLowerCase() });
  for (const r of [wrong, unknown, casing]) {
    assert.equal(r.status, 401);
    assert.equal(r.body.error.code, 'UNAUTHENTICATED');
    assert.equal(r.body.error.message, 'Invalid username or password.');
    assert.equal(r.body.token, undefined);
  }
});

test('an account id or role in the body never signs anyone in', async () => {
  const s = await listen(createApp({ workflow: createWorkflowRuntime({ seed: false }) }));
  try {
    for (const body of [{ accountId: 'USR-008' }, { role: 'POLICY_MAKER' }, { username: 'ops.hendra' }, { password: 'OpsPinn2026!' }]) {
      for (const p of ['/api/auth/login', '/api/auth/demo-session']) {
        const r = await post(p, body, s.base);
        assert.equal(r.status, 400, `${p} ${JSON.stringify(body)}`);
        assert.equal(r.body.token, undefined);
      }
    }
    // A role claimed next to valid credentials is ignored: the account decides the role.
    const viewer = DEMO_CREDENTIALS[4];
    const r = await post('/api/auth/login', { username: viewer.username, password: viewer.password, role: 'POLICY_MAKER' }, s.base);
    assert.equal(r.body.actor.role, 'PUBLIC_VIEWER');
  } finally {
    await new Promise<void>((resolve) => s.server.close(() => resolve()));
  }
});

test('repeated login attempts from one client are rate limited', async () => {
  const s = await listen(createApp({ workflow: createWorkflowRuntime({ seed: false }) }));
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await post('/api/auth/login', { username: 'ops.hendra', password: 'wrong' }, s.base)).status);
    assert.ok(statuses.slice(0, 20).every((code) => code === 401));
    assert.equal(statuses[20], 429);
  } finally {
    await new Promise<void>((resolve) => s.server.close(() => resolve()));
  }
});

test('a tampered token is rejected', async () => {
  const c = DEMO_CREDENTIALS[3];
  const { body } = await post('/api/auth/login', { username: c.username, password: c.password });
  const [payload, sig] = (body.token as string).split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), role: 'POLICY_MAKER' })).toString('base64url');
  assert.equal((await me(`${forged}.${sig}`)).status, 401);
  assert.equal((await me('not-a-token')).status, 401);
});

test('with DEMO_AUTH=false login is unavailable even with valid credentials', async () => {
  const runtime = createWorkflowRuntime({ demoAuthEnabled: false, seed: false });
  const s = await listen(createApp({ workflow: runtime }));
  try {
    const c = DEMO_CREDENTIALS[0];
    const r = await post('/api/auth/login', { username: c.username, password: c.password }, s.base);
    assert.equal(r.status, 401);
    assert.equal(r.body.error.code, 'UNAUTHENTICATED');
  } finally {
    await new Promise<void>((resolve) => s.server.close(() => resolve()));
  }
});
