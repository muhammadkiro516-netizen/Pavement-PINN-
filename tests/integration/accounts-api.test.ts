/**
 * Real accounts (docs/LEAN_PLAN.md): citizens register, a Koordinator creates staff, and the
 * product server has no fixture identities (demo auth off).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../../server/app';
import { createWorkflowRuntime } from '../../server/services/workflowRuntime';
import { AccountStore } from '../../server/repositories/accountStore';
import { bodyWithSession } from '../helpers/sessionCookie';

let server: Server;
let base = '';
let file = '';
let coordinatorToken = '';

before(async () => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pinn-accounts-')), 'accounts.json');
  const accounts = new AccountStore(file);
  accounts.create({ email: 'koor@dinas.go.id', name: 'Koordinator Uji', password: 'rahasia-123', agency: 'Dinas BMBK Uji', role: 'OPERATIONS_MANAGER' });
  const workflow = createWorkflowRuntime({ seed: false, demoAuthEnabled: false, accounts, sessionSecret: 'a'.repeat(40) });
  await workflow.ready;
  await new Promise<void>((resolve) => {
    server = createApp({ workflow }).listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  coordinatorToken = (await post('/api/auth/login', { email: 'koor@dinas.go.id', password: 'rahasia-123' })).body.token;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function post(p: string, body: unknown, token?: string) {
  const r = await fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
  return { status: r.status, body: await bodyWithSession(r) };
}

async function get(p: string, token?: string) {
  const r = await fetch(base + p, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: r.status, body: (await r.json()) as any };
}

test('a citizen registers, is signed in as PUBLIC_REPORTER, and /me returns the profile without the hash', async () => {
  const reg = await post('/api/auth/register', { email: 'Sari@Mail.com', name: 'Sari', password: 'jalanrusak1', role: 'OPERATIONS_MANAGER' });
  assert.equal(reg.status, 200);
  assert.equal(reg.body.actor.role, 'PUBLIC_REPORTER', 'a body cannot choose the role');
  assert.equal(reg.body.actor.kind, 'ACCOUNT');
  const me = await get('/api/auth/me', reg.body.token);
  assert.equal(me.body.account.email, 'sari@mail.com');
  assert.equal(me.body.account.passwordHash, undefined);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /jalanrusak1/, 'the password is never stored');
});

test('registration validates input and refuses a duplicate email', async () => {
  assert.equal((await post('/api/auth/register', { email: 'bukan-email', name: 'X Y', password: 'panjang123' })).status, 400);
  assert.equal((await post('/api/auth/register', { email: 'a@b.co', name: 'Ab', password: 'pendek' })).status, 400);
  await post('/api/auth/register', { email: 'dup@b.co', name: 'Dup', password: 'panjang123' });
  assert.equal((await post('/api/auth/register', { email: 'DUP@b.co', name: 'Dup', password: 'panjang123' })).status, 409);
});

test('a wrong password and fixture credentials are refused when demo auth is off', async () => {
  assert.equal((await post('/api/auth/login', { email: 'koor@dinas.go.id', password: 'salah-sekali' })).status, 401);
  assert.equal((await post('/api/auth/login', { username: 'field.ahmad', password: 'FieldPinn2026!' })).status, 401);
});

test('only a Koordinator creates staff; the new engineer can sign in and is offered for assignment', async () => {
  const citizen = (await post('/api/auth/register', { email: 'warga2@mail.com', name: 'Warga Dua', password: 'panjang123' })).body.token;
  const staff = { email: 'petugas@dinas.go.id', name: 'Petugas Uji', password: 'lapangan-1', role: 'FIELD_ENGINEER', agency: 'UPTD Uji' };
  assert.equal((await post('/api/staff', staff, citizen)).status, 403);
  assert.equal((await post('/api/staff', { ...staff, agency: '' }, coordinatorToken)).status, 400, 'staff need an agency');
  const created = await post('/api/staff', staff, coordinatorToken);
  assert.equal(created.status, 201);
  const login = await post('/api/auth/login', { email: staff.email, password: staff.password });
  assert.equal(login.body.actor.role, 'FIELD_ENGINEER');
  const engineers = await get('/api/workflow/engineers', coordinatorToken);
  assert.deepEqual(engineers.body.items.map((e: any) => e.id), [created.body.account.id]);
});

test('a deactivated staff account cannot sign in and its open session stops at /me', async () => {
  const staff = { email: 'nonaktif@dinas.go.id', name: 'Petugas Nonaktif', password: 'lapangan-2', role: 'FIELD_ENGINEER', agency: 'UPTD Uji' };
  const id = (await post('/api/staff', staff, coordinatorToken)).body.account.id;
  const token = (await post('/api/auth/login', { email: staff.email, password: staff.password })).body.token;
  assert.equal((await post(`/api/staff/${id}/active`, { active: false }, coordinatorToken)).status, 200);
  assert.equal((await post('/api/auth/login', { email: staff.email, password: staff.password })).status, 401);
  assert.equal((await get('/api/auth/me', token)).status, 401);
});

test('accounts survive a restart (file store)', () => {
  const reloaded = new AccountStore(file);
  assert.ok(reloaded.verify('sari@mail.com', 'jalanrusak1'));
  assert.equal(reloaded.verify('sari@mail.com', 'salah'), null);
});
