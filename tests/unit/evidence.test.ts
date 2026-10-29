/** SPEC M10: SUS scoring, measurements endpoint, SUS answers stored once per account. */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../../server/app';
import { createWorkflowRuntime } from '../../server/services/workflowRuntime';
import { MemoryCaseStore } from '../../src/domain/workflow/service';
import { susScore } from '../../server/routes/evidence.routes';
import { demoLoginFor } from '../../src/data/reference/demoCredentials';
import { bodyWithSession } from '../helpers/sessionCookie';

test('SUS score follows Brooke (1996): best 100, worst 0, neutral 50', () => {
  assert.equal(susScore([5, 1, 5, 1, 5, 1, 5, 1, 5, 1]), 100);
  assert.equal(susScore([1, 5, 1, 5, 1, 5, 1, 5, 1, 5]), 0);
  assert.equal(susScore(Array(10).fill(3)), 50);
});

let server: Server;
let base = '';
before(async () => {
  const workflow = createWorkflowRuntime({ store: new MemoryCaseStore(), sessionSecret: 'e'.repeat(40) });
  await workflow.ready;
  await new Promise<void>((resolve) => {
    server = createApp({ workflow }).listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

test('measurements are public and carry their labels; SUS needs a session and 10 answers', async () => {
  const m = await (await fetch(`${base}/api/public/measurements`)).json();
  assert.equal(m.success, true);
  for (const v of Object.values(m.measurements) as Array<Record<string, unknown>>) assert.ok(!('grid' in v), 'large grids are not served');
  if (m.measurements.pinn2) assert.equal(m.measurements.pinn2.label, 'TERUKUR');
  const anon = await fetch(`${base}/api/sus`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: Array(10).fill(3) }) });
  assert.equal(anon.status, 401);
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(demoLoginFor('USR-004')) });
  const token = (await bodyWithSession(login)).token;
  const post = (answers: unknown) => fetch(`${base}/api/sus`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ answers }) });
  assert.equal((await post([1, 2, 3])).status, 422);
  assert.equal((await post(Array(10).fill(6))).status, 422);
  const ok = await post([4, 2, 4, 2, 4, 2, 4, 2, 4, 2]);
  assert.equal(ok.status, 201);
  assert.equal((await ok.json()).score, 75);
});
