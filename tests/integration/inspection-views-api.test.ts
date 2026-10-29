/**
 * Guided multi-angle inspection over real HTTP: citizen report -> coordinator assigns -> field
 * engineer sends 3 angles + tape measurements -> coordinator sees the case summary and verifies.
 * A client-sent `ai` block is discarded: the server only copies results from its own CV store.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../../server/app';
import { createWorkflowRuntime } from '../../server/services/workflowRuntime';
import { MemoryCaseStore } from '../../src/domain/workflow/service';
import { INITIAL_COMMUNITY_REPORTS } from '../../src/data/mock/communityReports';
import { demoLoginFor } from '../../src/data/reference/demoCredentials';
import { bodyWithSession } from '../helpers/sessionCookie';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let server: Server;
let base = '';

before(async () => {
  const workflow = createWorkflowRuntime({ store: new MemoryCaseStore(), storeKind: 'memory', storeLocation: null, sessionSecret: 'y'.repeat(40) } as never);
  await workflow.ready;
  await new Promise<void>((ok) => {
    server = createApp({ workflow }).listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      ok();
    });
  });
});
after(() => new Promise<void>((ok) => server.close(() => ok())));

async function call(method: string, p: string, body?: unknown, token?: string) {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await bodyWithSession(res) };
}
const session = async (id: string) => (await call('POST', '/api/auth/login', demoLoginFor(id))).body.token as string;

test('multi-angle inspection travels from field engineer to coordinator as one case', async () => {
  const anon = await call('POST', '/api/auth/anonymous');
  const { id: _i, status: _s, creatorAccountId: _c, creatorRole: _r, origin: _o, createdAt: _a, ...content } = INITIAL_COMMUNITY_REPORTS[0];
  const created = await call('POST', '/api/workflow/reports', { report: { ...content, coordinates: [-6.3672, 107.4011], photoUrl: PNG, description: 'Lubang di lajur kiri' } }, anon.body.token);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.report.case.id as string;
  let version = created.body.report.case.version as number;
  const ops = await session('USR-008');
  const eng = await session('USR-006');
  const act = async (token: string, command: object, expect = 200) => {
    const r = await call('POST', `/api/workflow/reports/${id}/transitions`, { command, expectedVersion: version }, token);
    assert.equal(r.status, expect, JSON.stringify(r.body));
    if (r.status === 200) version = r.body.report.case.version;
    return r.body;
  };
  await act(ops, { action: 'REVIEW_ACCEPT', reason: 'Foto jelas.' });
  await act(ops, { action: 'REQUEST_INSPECTION', reason: 'Prioritas', engineerId: 'USR-006', dueAt: new Date(Date.now() + 3 * 864e5).toISOString(), instructions: 'Foto 3 sisi, ukur.' });

  const forged = { analysisId: 'CVA-FFFFFFFFFFFFFFFF', status: 'ok', primaryLabel: 'Lubang', primaryType: 'POTHOLE', confidence: 0.99, detections: 9, severity: 'severe', surfaceIndex: 99, flooded: true };
  const views = ['OVERVIEW', 'TOP', 'SIDE'].map((angle) => ({ angle, photoUrl: PNG, takenAt: new Date().toISOString(), analysisId: 'CVA-FFFFFFFFFFFFFFFF', ai: forged }));
  const base_ = { action: 'SUBMIT_INSPECTION', verdict: 'CONFIRMED', cvReview: { accepted: true, correctedClass: null }, measuredDepthCm: 6, measuredAreaM2: 1, severity: 'SEVERE', notes: 'Lubang lajur kiri, tepi terkelupas.' };
  // Missing the side photo is refused.
  await act(eng, { ...base_, views: views.slice(0, 2) }, 400);
  await act(eng, { ...base_, views, dimensions: { lengthCm: 120, widthCm: 80, depthCm: 6 } });

  const seen = await call('GET', `/api/workflow/reports/${id}`, undefined, ops);
  const ins = seen.body.report.case.inspection;
  assert.deepEqual(ins.views.map((v: { angle: string }) => v.angle), ['OVERVIEW', 'TOP', 'SIDE']);
  assert.ok(ins.views.every((v: { ai: unknown }) => v.ai === null), 'client-sent AI results are discarded');
  assert.deepEqual(ins.dimensions, { lengthCm: 120, widthCm: 80, depthCm: 6 });
  assert.ok(seen.body.report.availableActions.includes('VERIFY_INSPECTION'));
  await act(ops, { action: 'VERIFY_INSPECTION', reason: 'Foto 3 sisi dan ukuran sesuai.' });
});

test('a citizen report keeps the extra angles; forged AI on them is discarded', async () => {
  const anon = await call('POST', '/api/auth/anonymous');
  const { id: _i, status: _s, creatorAccountId: _c, creatorRole: _r, origin: _o, createdAt: _a, ...content } = INITIAL_COMMUNITY_REPORTS[0];
  const extraViews = [
    { angle: 'OVERVIEW', photoUrl: PNG, takenAt: new Date().toISOString(), analysisId: 'CVA-FFFFFFFFFFFFFFFF', ai: { primaryLabel: 'palsu', confidence: 1 } },
    { angle: 'SIDE', photoUrl: PNG, takenAt: new Date().toISOString(), analysisId: null },
    { angle: 'TOP', photoUrl: PNG, takenAt: new Date().toISOString(), analysisId: null }
  ];
  const created = await call('POST', '/api/workflow/reports', { report: { ...content, coordinates: [-6.3672, 107.4011], photoUrl: PNG, description: 'Lubang 3 sisi', extraViews } }, anon.body.token);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const ops = await session('USR-008');
  const seen = await call('GET', `/api/workflow/reports/${created.body.report.case.id}`, undefined, ops);
  const views = seen.body.report.case.report.extraViews;
  assert.deepEqual(views.map((v: { angle: string }) => v.angle), ['OVERVIEW', 'SIDE'], 'at most 2, TOP is not a citizen extra angle');
  assert.ok(views.every((v: { ai: unknown }) => v.ai === null));
});
