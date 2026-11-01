import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { registerV5Routes } from '../../server/v5/routes';
import { MAX_PIN_TRIES, Workspaces, newAccessCode } from '../../server/v6/workspaces';
import { V6_DUTIES, isWeakPin, panelDuty } from '../../src/domain/v6/roles';
import { actorForAction } from '../../src/domain/v5/stateMachine';
import { checkSod } from '../../src/domain/v5/sod';
import { ACTORS, caseAt, person } from '../helpers/v5Fixtures';
import { TEST_AGENCY, TEST_PIN, seedWorkspace } from '../helpers/v6Access';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'v6-access-'));
const NOW = '2026-11-02T03:00:00.000Z';

test('every v5 duty belongs to exactly one v6 role, citizens to none', () => {
  const held = Object.values(V6_DUTIES).flat();
  assert.deepEqual([...held].sort(), ['ADMIN', 'AGENCY_HEAD', 'APPROVER', 'AUDITOR', 'COORDINATOR', 'FIELD_INSPECTOR', 'REPAIR_CREW', 'SUPERVISOR']);
  assert.equal(new Set(held).size, held.length);
});

test('the duty is picked per action, and the panel follows the case', () => {
  const om = { ...ACTORS.coordinator, duties: V6_DUTIES.OM };
  assert.equal(actorForAction(om, 'APPROVE_PLAN').role, 'APPROVER');
  assert.equal(actorForAction(om, 'ASSIGN_INSPECTION').role, 'COORDINATOR');
  const fe = { ...ACTORS.inspector, duties: V6_DUTIES.FE };
  assert.equal(actorForAction(fe, 'VERIFY_WORK').role, 'SUPERVISOR');
  assert.equal(actorForAction(fe, 'APPROVE_PLAN').role, 'FIELD_INSPECTOR', 'no duty allows it, so the role stays and the machine refuses');
  assert.equal(panelDuty('OM', 'PLAN_PROPOSED'), 'APPROVER');
  assert.equal(panelDuty('OM', 'TRIAGE'), 'COORDINATOR');
  assert.equal(panelDuty('FE', 'WORK_SUBMITTED'), 'SUPERVISOR');
});

test('codes: readable alphabet, stored only as a hash, and a typed code works in any case', () => {
  for (let i = 0; i < 200; i++) assert.match(newAccessCode(), /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{4}$/);
  const dir = tmp();
  const spaces = new Workspaces(dir);
  spaces.upsertAgency({ id: 'A', name: 'A', kind: 'KOTA', authorityIds: ['x'], region: '31', logoUri: null, contact: '', slaDays: 7, sessionHours: 12 });
  const { member, code } = spaces.addMember({ agencyId: 'A', name: 'Uji', title: 'Uji', role: 'FE' }, NOW);
  spaces.setPin(member.id, TEST_PIN);
  const onDisk = fs.readFileSync(path.join(dir, 'workspaces.json'), 'utf8');
  assert.equal(onDisk.includes(code), false);
  assert.equal(onDisk.includes(code.replace(/-/g, '')), false);
  assert.equal(onDisk.includes(TEST_PIN), false);
  assert.equal(spaces.findByCode(code.toLowerCase().replace(/-/g, ' '), NOW)?.id, member.id);
  assert.equal(spaces.findByCode('AAA-AAA-AAAA', NOW), null);
});

test('PIN: weak ones are refused, and wrong tries lock the code for a while', () => {
  for (const weak of ['123456', '654321', '111111', '12345', 'abcdef']) assert.equal(isWeakPin(weak), true, weak);
  assert.equal(isWeakPin(TEST_PIN), false);
  const spaces = new Workspaces(tmp());
  spaces.upsertAgency({ id: 'A', name: 'A', kind: 'KOTA', authorityIds: [], region: '31', logoUri: null, contact: '', slaDays: 7, sessionHours: 12 });
  const { member } = spaces.addMember({ agencyId: 'A', name: 'Uji', title: 'Uji', role: 'FE' }, NOW);
  assert.equal(spaces.setPin(member.id, '123456'), false);
  spaces.setPin(member.id, TEST_PIN);
  for (let i = 1; i < MAX_PIN_TRIES; i++) assert.equal(spaces.checkPin(member.id, '000001', NOW), 'WRONG');
  assert.equal(spaces.checkPin(member.id, '000001', NOW), 'LOCKED');
  assert.equal(spaces.checkPin(member.id, TEST_PIN, NOW), 'LOCKED', 'even the right PIN waits');
  assert.equal(spaces.checkPin(member.id, TEST_PIN, '2026-11-02T03:16:00.000Z'), 'OK');
});

test('SoD: one OM or one FE may go on, as an exception the auditor sees; with two they may not', () => {
  const c = caseAt('PLAN_PROPOSED');
  const proposer = c.plan!.proposerPersonId;
  const self = person('APPROVER', 'INS', { personId: proposer });
  assert.equal(checkSod('APPROVE_PLAN', {}, c, self).ok, false);
  const alone = checkSod('APPROVE_PLAN', {}, c, { ...self, soleInRole: true });
  assert.deepEqual(alone, { ok: true, overlapBasis: 'Only one Operations Manager in this agency' });

  const done = caseAt('WORK_SUBMITTED');
  const verifier = person('SUPERVISOR', 'INS', { personId: done.plan!.proposerPersonId });
  assert.equal(checkSod('VERIFY_WORK', {}, done, verifier).ok, false);
  assert.deepEqual(checkSod('VERIFY_WORK', {}, done, { ...verifier, soleInRole: true }), { ok: true, overlapBasis: 'Only one Field Engineer in this agency' });
});

// ---- Over HTTP ------------------------------------------------------------------------------------
let server: Server;
let base: string;
let codes: Record<string, string>;
let otherOmCode: string;
let runtime: ReturnType<typeof registerV5Routes>;

const call = async (url: string, opts: { token?: string; body?: unknown; pin?: string } = {}) => {
  const res = await fetch(`${base}${url}`, {
    method: opts.body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(opts.token ? { 'x-v5-session': opts.token } : {}), ...(opts.pin ? { 'x-v6-pin': opts.pin } : {}) },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) })
  });
  return { status: res.status, body: (await res.json()) as any };
};
const signIn = async (code: string, pin = TEST_PIN) => (await call('/api/v6/session', { body: { code, pin } })).body.data;

before(async () => {
  const dataDir = tmp();
  codes = seedWorkspace(dataDir);
  const spaces = new Workspaces(path.join(dataDir, 'v6'));
  spaces.upsertAgency({ id: 'AGENCY-OTHER', name: 'Instansi Lain', kind: 'KOTA', authorityIds: ['pemkot-lain'], region: '32', logoUri: null, contact: '', slaDays: 7, sessionHours: 12 });
  const other = spaces.addMember({ agencyId: 'AGENCY-OTHER', name: 'OM Lain', title: 'Uji', role: 'OM' }, new Date().toISOString());
  spaces.setPin(other.member.id, TEST_PIN);
  otherOmCode = other.code;
  const app = express();
  app.use(express.json());
  const router = express.Router();
  runtime = registerV5Routes(router, { dataDir, lenientCapture: true });
  app.use(router);
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => { server.close(); });

test('the old email and password route is gone', async () => {
  assert.equal((await fetch(`${base}/api/v5/session/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404);
});

test('sign-in: first time makes a PIN, then the PIN is required; unknown codes learn nothing', async () => {
  const om = await signIn(codes['ACC-COORD']);
  const added = await call('/api/v6/team', { token: om.token, pin: TEST_PIN, body: { name: 'Staf Baru', title: 'Petugas', role: 'FE' } });
  assert.equal(added.status, 200);
  const { code, qr, url } = added.body.data.badge;
  assert.match(qr, /^data:image\/png;base64,/);
  assert.match(url, /\/login\/#kode=/, 'the code stays in the fragment, away from server logs');

  assert.equal((await call('/api/v6/session/start', { body: { code } })).body.data.step, 'SET_PIN');
  assert.equal((await call('/api/v6/session', { body: { code, pin: '123456' } })).body.error.code, 'WEAK_PIN');
  const first = await call('/api/v6/session', { body: { code, pin: '739201' } });
  assert.equal(first.status, 200);
  assert.equal((await call('/api/v6/session/start', { body: { code } })).body.data.step, 'ENTER_PIN');
  assert.equal((await call('/api/v6/session', { body: { code, pin: '739202' } })).status, 401);
  assert.equal((await call('/api/v6/session/start', { body: { code: 'AAA-AAA-AAAA' } })).status, 401);
});

test('the Lock button ends the session; the remembered device still needs the PIN', async () => {
  const s = await signIn(codes['ACC-AUDIT']);
  assert.equal((await call('/api/v5/me', { token: s.token })).status, 200);
  assert.equal((await call('/api/v6/session/lock', { token: s.token, body: {} })).status, 200);
  assert.equal((await call('/api/v5/me', { token: s.token })).status, 401);
  assert.equal((await call('/api/v6/session', { body: { remember: s.remember } })).status, 401);
  const back = await call('/api/v6/session', { body: { remember: s.remember, pin: TEST_PIN } });
  assert.equal(back.status, 200);
  assert.equal((await call('/api/v5/me', { token: back.body.data.token })).status, 200);
  // A remember token is not a session.
  assert.equal((await call('/api/v5/me', { token: s.remember })).status, 401);
});

test('managing codes asks for the PIN again, is OM only, and renewing or revoking ends old sessions', async () => {
  const om = await signIn(codes['ACC-COORD']);
  assert.equal((await call('/api/v6/team', { token: om.token, body: { name: 'Tanpa PIN', role: 'FE' } })).body.error.code, 'PIN_REQUIRED');
  assert.equal((await call('/api/v6/team', { token: om.token, pin: '000001', body: { name: 'PIN Salah', role: 'FE' } })).body.error.code, 'PIN_WRONG');

  const fe = await signIn(codes['ACC-SUPERVISE']);
  assert.equal((await call('/api/v6/team', { token: fe.token })).status, 403);
  const auditor = await signIn(codes['ACC-AUDIT']);
  assert.equal((await call('/api/v6/team', { token: auditor.token })).status, 200, 'the auditor reads');
  assert.equal((await call('/api/v6/team', { token: auditor.token, pin: TEST_PIN, body: { name: 'Coba', role: 'FE' } })).status, 403, 'and only reads');
  assert.equal((await call('/api/v6/team', { token: om.token, pin: TEST_PIN, body: { name: 'Tamu', role: 'CONTRACTOR' } })).status, 400, 'a guest code comes only with a work order');

  const made = (await call('/api/v6/team', { token: om.token, pin: TEST_PIN, body: { name: 'Akan Dicabut', title: 'Petugas', role: 'FE' } })).body.data;
  const session = (await call('/api/v6/session', { body: { code: made.badge.code, pin: '739201' } })).body.data;
  const renewed = (await call(`/api/v6/team/${made.member.id}/renew`, { token: om.token, pin: TEST_PIN, body: {} })).body.data.badge.code;
  assert.equal((await call('/api/v5/me', { token: session.token })).status, 401, 'renewing signs them out');
  assert.equal((await call('/api/v6/session/start', { body: { code: made.badge.code } })).status, 401, 'the old code stops');
  const again = (await call('/api/v6/session', { body: { code: renewed, pin: '739201' } })).body.data;
  assert.equal((await call('/api/v5/me', { token: again.token })).status, 200, 'the PIN stays theirs');
  await call(`/api/v6/team/${made.member.id}/revoke`, { token: om.token, pin: TEST_PIN, body: {} });
  assert.equal((await call('/api/v5/me', { token: again.token })).status, 401);
  assert.equal((await call('/api/v6/session/start', { body: { code: renewed } })).status, 401);
});

test('every sign-in is logged with its device, and code changes are in the audit chain', async () => {
  const om = await signIn(codes['ACC-COORD']);
  const log = (await call('/api/v6/team/log', { token: om.token })).body.data;
  assert.ok(log.some((l: any) => l.result === 'OK' && l.memberId === 'ACC-COORD' && l.device));
  const types = runtime.store.chain.events('prod').map((e) => e.type);
  assert.ok(types.includes('access.staff_added') && types.includes('access.code_renewed') && types.includes('access.code_revoked'));
  assert.equal((await call('/api/v5/public/chain/prod/verify')).body.data.ok, true);
});

test('one agency never sees another agency, and its OM cannot manage their people', async () => {
  const other = await signIn(otherOmCode);
  assert.deepEqual((await call('/api/v5/cases', { token: other.token })).body.data, []);
  const team = (await call('/api/v6/team', { token: other.token })).body.data;
  assert.equal(team.some((m: any) => m.id === 'ACC-COORD'), false);
  assert.equal((await call('/api/v6/team/ACC-COORD/revoke', { token: other.token, pin: TEST_PIN, body: {} })).status, 404);
  assert.ok((await call('/api/v5/staff', { token: other.token })).body.data.every((m: any) => m.accountId !== 'ACC-COORD'));
  assert.equal(TEST_AGENCY, 'AGENCY-TEST');
});
