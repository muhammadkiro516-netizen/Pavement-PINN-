/** SPEC M5.1/M6 over HTTP: who may see audit flags, run a diagnosis, decide, and enter project data. */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../../server/app';
import { createWorkflowRuntime } from '../../server/services/workflowRuntime';
import { MemoryCaseStore } from '../../src/domain/workflow/service';
import { demoLoginFor } from '../../src/data/reference/demoCredentials';
import { bodyWithSession } from '../helpers/sessionCookie';

let server: Server;
let base = '';

before(async () => {
  const workflow = createWorkflowRuntime({ store: new MemoryCaseStore(), sessionSecret: 'z'.repeat(40) });
  await workflow.ready;
  await new Promise<void>((resolve) => {
    server = createApp({ workflow }).listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function call(method: string, p: string, body?: unknown, token?: string) {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await bodyWithSession(res) };
}
const session = async (id: string) => (await call('POST', '/api/auth/login', demoLoginFor(id))).body.token as string;

test('audit flags: Koordinator and Pimpinan only; the public gets ids under review, no details', async () => {
  const [ops, policy, eng, citizen] = await Promise.all(['USR-008', 'USR-007', 'USR-006', 'USR-004'].map(session));
  assert.equal((await call('GET', '/api/audit/flags', undefined, ops)).status, 200);
  assert.equal((await call('GET', '/api/audit/flags', undefined, policy)).status, 200);
  assert.equal((await call('GET', '/api/audit/flags', undefined, eng)).status, 403);
  assert.equal((await call('GET', '/api/audit/flags', undefined, citizen)).status, 403);
  const pub = await call('GET', '/api/public/under-review');
  assert.equal(pub.status, 200);
  assert.deepEqual(Object.keys(pub.body).sort(), ['caseIds', 'success']);
  assert.equal((await call('POST', '/api/audit/flags/BIAYA:X/response', { response: 'JELASKAN', reason: 'ok' }, ops)).status, 422, 'reason needs 5+ chars');
  assert.equal((await call('POST', '/api/audit/flags/BIAYA:X/response', { response: 'JELASKAN', reason: 'Termasuk drainase' }, eng)).status, 403);
});

test('diagnosis decisions need the Koordinator and a reason; project data is verified by the Koordinator', async () => {
  const [ops, eng, citizen] = await Promise.all(['USR-008', 'USR-006', 'USR-004'].map(session));
  assert.equal((await call('POST', '/api/engine/diagnose', { segmentId: 'S1', esalYear: 1000 }, citizen)).status, 403);
  assert.equal((await call('POST', '/api/engine/diagnose', { segmentId: 'S1' }, eng)).status, 422, 'traffic is required, never assumed');
  const decision = { decision: 'TIMPA', modelVerdict: 'RED', overrideVerdict: 'YELLOW', reason: 'Core menunjukkan AC 12 cm' };
  assert.equal((await call('POST', '/api/roads/S1/diagnosis-decision', decision, eng)).status, 403);
  assert.equal((await call('POST', '/api/roads/S1/diagnosis-decision', { ...decision, reason: '' }, ops)).status, 422);
  assert.equal((await call('POST', '/api/roads/S1/diagnosis-decision', decision, ops)).status, 201);
  assert.equal((await call('GET', '/api/roads/S1/diagnosis-decisions', undefined, ops)).body.items.length, 1);

  const p = await call('POST', '/api/projects', { segmentId: 'S1', name: 'Pemeliharaan berkala Jl. Uji', year: 2024, mix: 'AC-WC', thicknessCm: 4, areaM2: 1200, valueIdr: 250000000, maintenanceMonths: 6, source: 'PAPAN_PROYEK' }, eng);
  assert.equal(p.status, 201);
  assert.equal(p.body.record.verifiedBy, null);
  assert.equal((await call('POST', `/api/projects/${p.body.record.id}/verify`, undefined, eng)).status, 403);
  assert.equal((await call('POST', `/api/projects/${p.body.record.id}/verify`, undefined, ops)).body.record.verifiedBy !== null, true);
  assert.equal((await call('POST', '/api/projects', { segmentId: 'S1', name: 'x', year: 2024, source: 'TEBAKAN' }, eng)).status, 422);
  assert.equal((await call('GET', '/api/projects?segment=S1', undefined, citizen)).status, 403);
});

test('fair cost over HTTP keeps labels and refuses citizens', async () => {
  const [ops, citizen] = await Promise.all(['USR-008', 'USR-004'].map(session));
  const r = await call('POST', '/api/audit/fair-cost', { materialId: 'AC-WC', thicknessCm: 4, areaM2: 100, valueIdr: 30000000 }, ops);
  assert.equal(r.body.result.status, 'PERLU_KLARIFIKASI');
  assert.ok(r.body.result.breakdown.every((b: { label: string }) => b.label));
  assert.equal((await call('POST', '/api/audit/fair-cost', { materialId: 'AC-WC', thicknessCm: 4, areaM2: 100 }, citizen)).status, 403);
});

test('treatment proposals: only the Koordinator or Pimpinan approve, with a note; engineers and citizens cannot', async () => {
  const [ops, policy, eng, citizen] = await Promise.all(['USR-008', 'USR-007', 'USR-006', 'USR-004'].map(session));
  const body = { text: 'Ruas uji memerlukan lapis ulang. Disarankan uji core dan DCP sebelum pekerjaan dimulai.', note: 'Disetujui untuk anggaran perubahan', source: 'SLM', device: 'CPU' };
  assert.equal((await call('POST', '/api/roads/S1/proposal/approve', body, eng)).status, 403);
  assert.equal((await call('POST', '/api/roads/S1/proposal/approve', body, citizen)).status, 403);
  assert.equal((await call('POST', '/api/roads/S1/proposal/approve', { ...body, note: '' }, ops)).status, 422);
  assert.equal((await call('POST', '/api/roads/S1/proposal/approve', body, policy)).status, 201);
  assert.equal((await call('POST', '/api/roads/S1/proposal', {}, eng)).status, 403);
});
