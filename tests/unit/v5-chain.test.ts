import { sweepEscalations } from '../../server/v5/escalationJob';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import express from 'express';
import { EventChain, GENESIS_HASH, assertIntegerPayload, canonicalize, hashEventBody, sha256Hex } from '../../server/v5/chain';
import { registerV5Routes } from '../../server/v5/routes';
import { PILOT_ROSTER, StaffAccounts } from '../../server/v5/staffAccounts';
import { V5Store } from '../../server/v5/store';
import { SYSTEM_ACTOR } from '../../src/domain/v5/stateMachine';
import { ACTORS, ROWS, caseAt, ev } from '../helpers/v5Fixtures';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'v5-chain-'));

const draft = (i: number) => ({
  type: 'case.submitted',
  entity: { type: 'case', id: `CASE-${i}` },
  actor: { ref: 'system:test', role: 'SYSTEM', kind: 'SYSTEM' },
  server_received_at: '2026-11-01T03:00:00.000Z',
  payload: { n: i, depth_mm: 70 }
});

function flipByteInPayload(line: string): string {
  // Changes one digit inside the payload, keeps the line valid JSON.
  return line.replace('"depth_mm":70', '"depth_mm":71');
}

test('RFC 8785 vectors: key order, number form and escaping', () => {
  // Numbers from RFC 8785 §3.2.2.3 (ES6 serialisation).
  assert.equal(canonicalize({ numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001] }), '{"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27]}');
  assert.equal(canonicalize({ string: '€$\u000F\nA\'B"\\\\"/' }), `{"string":"€$\\u000f\\nA'B\\"\\\\\\\\\\"/"}`);
  assert.equal(canonicalize({ literals: [null, true, false] }), '{"literals":[null,true,false]}');
  // Sorting by UTF-16 code units (RFC 8785 §3.2.3 example keys).
  const sorted = canonicalize({ '€': 'Euro Sign', '\r': 'Carriage Return', 'דּ': 'Hebrew Letter Dalet With Dagesh', '1': 'One', '😀': 'Emoji: Grinning Face', '\u0080': 'Control', 'ö': 'Latin Small Letter O With Diaeresis' });
  assert.deepEqual(Object.values(JSON.parse(sorted)).slice(0, 0), []);
  const keys = [...sorted.matchAll(/"((?:[^"\\]|\\.)*)":/g)].map((m) => JSON.parse(`"${m[1]}"`));
  assert.deepEqual(keys, ['\r', '1', '\u0080', 'ö', '€', '😀', 'דּ']);
  assert.throws(() => canonicalize({ x: Infinity }));
});

test('the same event body gives the same hash whatever the key order', () => {
  const a = { v: 1, seq: 1, payload: { a: 1, b: 2 } } as never;
  const b = { payload: { b: 2, a: 1 }, seq: 1, v: 1 } as never;
  assert.equal(hashEventBody(a), hashEventBody(b));
});

test('payload numbers must be integers (07 §2.1)', () => {
  assert.throws(() => assertIntegerPayload({ cost: { low: 1.5 } }));
  assert.doesNotThrow(() => assertIntegerPayload({ cost: { low: 388993 }, list: [1, 2] }));
  const chain = new EventChain(tmp());
  assert.throws(() => chain.append('prod', { ...draft(1), payload: { score: 0.91 } }));
  assert.equal(chain.events('prod').length, 0, 'nothing is written');
});

test('IN-1: one changed byte in 1,000 events fails at exactly that seq', () => {
  const chain = new EventChain(tmp());
  for (let i = 1; i <= 1000; i++) chain.append('prod', draft(i));
  const clean = chain.verify('prod');
  assert.equal(clean.ok, true);
  assert.equal(clean.checked, 1000);

  const file = chain.fileFor('prod');
  const original = fs.readFileSync(file, 'utf8');
  const lines = original.trimEnd().split('\n');
  for (const seq of [1, 500, 1000]) {
    const edited = [...lines];
    edited[seq - 1] = flipByteInPayload(edited[seq - 1]);
    assert.notEqual(edited[seq - 1], lines[seq - 1]);
    fs.writeFileSync(file, `${edited.join('\n')}\n`);
    const report = chain.verify('prod');
    assert.equal(report.ok, false);
    assert.deepEqual([report.firstFailure!.seq, report.firstFailure!.status], [seq, 'HASH_MISMATCH']);
  }
  fs.writeFileSync(file, original);
  assert.equal(chain.verify('prod').ok, true);
});

test('IN-2: a deleted event breaks the link at the next seq', () => {
  const chain = new EventChain(tmp());
  for (let i = 1; i <= 6; i++) chain.append('prod', draft(i));
  const file = chain.fileFor('prod');
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
  lines.splice(2, 1);
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  const report = chain.verify('prod');
  assert.equal(report.ok, false);
  assert.deepEqual([report.firstFailure!.seq, report.firstFailure!.status], [4, 'LINK_BROKEN']);
});

test('rewriting an event and rehashing it still fails: the signature or the next link breaks', () => {
  const chain = new EventChain(tmp());
  for (let i = 1; i <= 3; i++) chain.append('prod', draft(i));
  const file = chain.fileFor('prod');
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
  const e = JSON.parse(lines[2]);
  e.payload.depth_mm = 5;
  e.payload_sha256 = sha256Hex(canonicalize(e.payload));
  e.event_hash = hashEventBody(e);
  lines[2] = JSON.stringify(e);
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  assert.equal(chain.verify('prod').firstFailure!.status, 'BAD_SIGNATURE');
});

test('the first event links to the genesis hash', () => {
  const chain = new EventChain(tmp());
  const first = chain.append('prod', draft(2));
  assert.equal(first.seq, 1);
  assert.equal(first.prev_hash, GENESIS_HASH);
});

test('the log never holds a person: actor refs are HMACs, and the head survives a restart', () => {
  const dir = tmp();
  const store = new V5Store(dir);
  const row = ROWS.find((r) => r.action === 'ACCEPT')!;
  const c = caseAt('TRIAGE');
  store.apply(c, { ...row.cmd, action: 'ACCEPT' }, ACTORS.coordinator, '2026-11-01T03:00:00.000Z', c.version);
  const text = store.chain.readText('prod');
  assert.doesNotMatch(text, /P-COO|ACC-COO/);
  assert.match(text, /"ref":"staff:[0-9a-f]{32}"/);
  const reopened = new V5Store(dir);
  assert.equal(reopened.get(c.id)!.state, 'ACCEPTED');
  const again = reopened.chain.append('prod', draft(9));
  assert.equal(again.seq, 2, 'chain continues after a restart');
});

test('removing the newest events is caught by the recorded chain head', () => {
  const dir = tmp();
  const store = new V5Store(dir);
  let c = caseAt('TRIAGE');
  const accepted = store.apply(c, { reason: 'Checked against the photos.', damageClass: 'POTHOLE', action: 'ACCEPT' }, ACTORS.coordinator, '2026-11-01T03:00:00.000Z', c.version);
  assert.ok(!('ok' in accepted));
  if ('ok' in accepted) return;
  c = accepted.case;
  store.apply(c, { reason: 'Waiting for the budget year.', code: 'AWAITING_BUDGET', until: '2026-12-01T00:00:00.000Z', action: 'SET_PENDING' }, ACTORS.coordinator, '2026-11-01T03:01:00.000Z', c.version);
  assert.equal(store.verify('prod').ok, true);
  const file = store.chain.fileFor('prod');
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
  fs.writeFileSync(file, `${lines[0]}\n`);
  const report = store.verify('prod');
  assert.equal(report.ok, false);
  assert.equal(report.truncated, true);
});

// HTTP: roles and SoD are enforced by the server.
let server: Server;
let base = '';
let httpStore: V5Store;

const call = async (url: string, opts: { token?: string; body?: unknown } = {}) => {
  const res = await fetch(`${base}${url}`, {
    method: opts.body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(opts.token ? { 'x-v5-session': opts.token } : {}) },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) })
  });
  return { status: res.status, body: (await res.json()) as any };
};
const PASSWORD = 'test-password-1';
const emailOf = (accountId: string) => PILOT_ROSTER.find((a) => a.accountId === accountId)!.email;
const login = async (accountId: string) => (await call('/api/v5/session/login', { body: { email: emailOf(accountId), password: PASSWORD } })).body.data.token as string;

before(async () => {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  const dataDir = tmp();
  const staff = new StaffAccounts(path.join(dataDir, 'v5'));
  for (const account of PILOT_ROSTER) staff.upsert(account, PASSWORD);
  httpStore = registerV5Routes(router, { dataDir }).store;
  app.use(router);
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => { server.close(); });

function seededCase() {
  const c = caseAt('PLAN_PROPOSED', { plan: { ...caseAt('PLAN_PROPOSED').plan!, proposerPersonId: 'P-INSPECT' }, inspection: { ...caseAt('PLAN_PROPOSED').inspection!, inspectorPersonId: 'P-INSPECT' } });
  const seeded = httpStore.apply({ ...c, version: 0 }, { action: 'ADD_RESPONSE', text: 'Seed note for this test.' }, ACTORS.coordinator, '2026-11-01T03:00:00.000Z', 0);
  assert.ok(!('ok' in seeded));
  return (seeded as { case: typeof c }).case;
}

test('API: staff sign in with a password; no account can be chosen without one', async () => {
  const token = await login('ACC-AUDIT');
  assert.equal((await call('/api/v5/me', { token })).body.data.role, 'AUDITOR');
  assert.equal((await call('/api/v5/session/login', { body: { email: emailOf('ACC-AUDIT'), password: 'wrong' } })).status, 401);
  assert.equal((await call('/api/v5/session/login', { body: { email: 'nobody@example.org', password: PASSWORD } })).status, 401);
  // Routes that no longer exist: these two used to give a session or a staff list without a password.
  assert.equal((await fetch(`${base}/api/v5/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"accountId":"ACC-AUDIT"}' })).status, 404);
  assert.equal((await fetch(`${base}/api/v5/demo/accounts`)).status, 404);
  assert.equal(new Set(PILOT_ROSTER.map((a) => a.role)).size, 8, 'eight staff roles; the citizen has no account');
  const device = await call('/api/v5/session/device', { body: {} });
  assert.match(device.body.data.pseudonym, /^Warga-/);
  assert.equal((await call('/api/v5/me', { token: device.body.data.token })).body.data.role, 'CITIZEN');
  assert.equal((await call('/api/v5/me')).status, 401);
  assert.equal((await call('/api/v5/me', { token: 'forged.token' })).status, 401);
  assert.equal((await call('/api/v5/staff', { token: device.body.data.token })).status, 403, 'a citizen cannot list staff');
  assert.doesNotMatch(JSON.stringify((await call('/api/v5/staff', { token })).body.data), /passwordHash|@/);
});

test('API: the server blocks approval by the person who recommended the plan (SOD-2)', async () => {
  const c = seededCase();
  const body = { action: 'APPROVE_PLAN', expectedVersion: c.version, reason: 'Fair cost and measurements look right.', budgetSource: 'APBD' };
  const blocked = await call(`/api/v5/cases/${c.id}/transitions`, { token: await login('ACC-INSPECT-AS-APPROVER'), body });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.rule, 'SOD-2');
  assert.equal(blocked.body.error.message, 'You proposed this plan, so you cannot approve it.');
  const ok = await call(`/api/v5/cases/${c.id}/transitions`, { token: await login('ACC-APPROVE'), body });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.case.state, 'PLAN_APPROVED');
  assert.match(ok.body.data.event.event_hash, /^[0-9a-f]{64}$/);
});

test('API: an auditor is read-only, and a citizen cannot read the full case', async () => {
  const c = seededCase();
  const auditor = await login('ACC-AUDIT');
  const refused = await call(`/api/v5/cases/${c.id}/transitions`, { token: auditor, body: { action: 'RETURN_PLAN', expectedVersion: c.version, reason: 'This plan needs clarification.' } });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error.rule, 'SOD-8');
  const events = await call(`/api/v5/cases/${c.id}/events`, { token: auditor });
  assert.equal(events.status, 200);
  assert.ok(events.body.data.events.length >= 1);
  assert.equal(events.body.data.verify.ok, true);
  const device = await call('/api/v5/session/device', { body: {} });
  assert.equal((await call(`/api/v5/cases/${c.id}`, { token: device.body.data.token })).status, 403);
});

test('API: the public track view has no staff or reporter data', async () => {
  const c = seededCase();
  const { body } = await call(`/api/v5/public/track/${c.publicCode}`);
  const text = JSON.stringify(body.data);
  assert.doesNotMatch(text, /P-INS|ACC-|createdBy|inspectorPersonId|dev:x/);
  assert.equal(body.data.stateLabel, 'Repair plan proposed');
  assert.ok(body.data.ladder.steps.length === 4);
});

test('API: public verify is green, then fails after a stored byte changes', async () => {
  seededCase();
  const ok = await call('/api/v5/public/chain/prod/verify');
  assert.equal(ok.body.data.ok, true);
  const file = httpStore.chain.fileFor('prod');
  const original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, original.replace('Seed note', 'Seed nOte'));
  const bad = await call('/api/v5/public/chain/prod/verify');
  assert.equal(bad.body.data.ok, false);
  assert.equal(bad.body.data.firstFailure.status, 'HASH_MISMATCH');
  fs.writeFileSync(file, original);
  assert.equal((await call('/api/v5/public/chain/nope/verify')).status, 404);
  assert.equal(SYSTEM_ACTOR.role, 'SYSTEM');
  assert.ok(ev('OVERVIEW').sha256.length === 64);
});

test('the escalation job logs each reached step once and never changes the case state', () => {
  const store = new V5Store(tmp());
  const row = ROWS.find((r) => r.action === 'ACCEPT')!;
  const c = caseAt('TRIAGE');
  store.apply(c, { ...row.cmd, action: 'ACCEPT' }, ACTORS.coordinator, '2026-11-01T03:00:00.000Z', c.version);
  const levels = () => store.eventsFor(c.id, 'prod').filter((e) => e.type === 'escalation.reached').map((e) => e.payload.level);
  const day = (n: number) => new Date(Date.parse(store.get(c.id)!.ladderStartAt) + n * 86_400_000).toISOString();
  assert.equal(sweepEscalations(store, day(1)), 0);
  assert.equal(sweepEscalations(store, day(2)), 1);
  assert.equal(sweepEscalations(store, day(3)), 0, 'not written twice');
  assert.equal(sweepEscalations(store, day(14)), 2);
  assert.deepEqual(levels(), ['COORDINATOR', 'AGENCY_HEAD', 'PUBLIC']);
  assert.equal(store.get(c.id)!.state, 'ACCEPTED');
});
