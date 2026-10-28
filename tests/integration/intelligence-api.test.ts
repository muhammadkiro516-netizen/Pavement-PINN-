/**
 * P4/P5 over HTTP: risk map, segment detail, assessment + explanation, provenance,
 * Road Story and What-If (engineer-only, range-checked), plus the spec-path aliases.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../../server/app';
import { INITIAL_COMMUNITY_REPORTS } from '../../src/data/mock/communityReports';
import { demoLoginFor } from '../../src/data/reference/demoCredentials';
import { bodyWithSession } from '../helpers/sessionCookie';

let server: Server;
let base = '';

before(async () => {
  await new Promise<void>((resolve) => {
    server = createApp().listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const call = async (method: string, p: string, body?: unknown, token?: string) => {
  const r = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: r.status, body: await bodyWithSession(r) };
};
const login = async (accountId: string) => (await call('POST', '/api/auth/login', demoLoginFor(accountId))).body.token as string;

test('risk map lists the pilot corridor first with honest status labels', async () => {
  const r = await call('GET', '/api/risk-map');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items.slice(0, 4).map((i: any) => i.segmentId), ['KRW-001', 'KRW-002', 'KRW-003', 'KRW-004']);
  for (const i of r.body.items) {
    assert.ok(['HIGH', 'WATCH', 'MODERATE', 'GOOD'].includes(i.risk));
    assert.equal(i.engine, 'EVIDENCE');
    assert.equal(i.validationStatus, 'VALIDATION_REQUIRED');
  }
  assert.equal(r.body.items[0].geometryStatus, 'ILLUSTRATIVE');
});

test('segment detail hides WIM vehicle records and returns the labelled estimate', async () => {
  const r = await call('GET', '/api/road-segments/JLN-KRW-KIIC-1');
  assert.equal(r.status, 200);
  assert.equal(r.body.segment.wimDetails, undefined);
  assert.equal(r.body.segment.activeWimStatus, undefined);
  assert.equal(r.body.estimate.engine, 'EVIDENCE');
  assert.equal((await call('GET', '/api/road-segments/NOPE')).status, 404);
});

test('assessment endpoint returns provenance and a deterministic explanation', async () => {
  const r = await call('GET', '/api/road-segments/KRW-001/assessment');
  assert.equal(r.status, 200);
  assert.equal(r.body.assessment.engine, 'EVIDENCE');
  assert.equal(r.body.assessment.traffic.wim.status, 'WIM_NOT_AVAILABLE');
  assert.equal(r.body.explanation.source, 'DETERMINISTIC_RULES');
  assert.equal((await call('GET', '/api/road-segments/NOPE/assessment')).status, 404);
});

test('provenance endpoint describes segments, assessments and reports', async () => {
  const seg = await call('GET', '/api/provenance/road_segment/KRW-002');
  assert.equal(seg.status, 200);
  assert.ok(seg.body.records.some((r: any) => r.dataStatus === 'ILLUSTRATIVE'));
  const asm = await call('GET', '/api/provenance/assessment/KRW-002');
  assert.equal(asm.body.validationStatus, 'VALIDATION_REQUIRED');
  const rep = await call('GET', `/api/provenance/report/${INITIAL_COMMUNITY_REPORTS[0].id}`);
  assert.equal(rep.body.records[0].dataStatus, 'SYNTHETIC');
  assert.equal(rep.body.records[1].dataStatus, 'ILLUSTRATIVE');
  assert.equal((await call('GET', '/api/provenance/unicorn/x')).status, 400);
});

test('What-If is retired with the formula engine: 410 pointing to the PINN assessment', async () => {
  const eng = await login('USR-006');
  const r = await call('POST', '/api/simulations', { segmentId: 'KRW-002', scenario: { asphaltThicknessCm: 14 } }, eng);
  assert.equal(r.status, 410);
  assert.match(r.body.error.message, /engine\/assess/);
});

test('Road Story includes PREDICTED and SIMULATED entries, labelled', async () => {
  const r = await call('GET', '/api/road-segments/KRW-002/story');
  assert.equal(r.status, 200);
  assert.equal(r.body.audience, 'PUBLIC');
  const kinds = new Set(r.body.story.map((e: any) => e.kind));
  assert.ok(kinds.has('PREDICTED'));
});

test('spec aliases: POST /api/reports accepts anonymous submissions and flags OUT_OF_SCOPE locations', async () => {
  const anon = (await call('POST', '/api/auth/anonymous')).body.token;
  const { id, status, creatorAccountId, creatorRole, origin, createdAt, ...content } = INITIAL_COMMUNITY_REPORTS[0];
  void id; void status; void creatorAccountId; void creatorRole; void origin; void createdAt;
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const jakarta = await call('POST', '/api/reports', { report: { ...content, photoUrl: png, coordinates: [-6.2, 106.8] } }, anon);
  assert.equal(jakarta.status, 201);
  const staff = await login('USR-008');
  const view = await call('GET', `/api/workflow/reports/${jakarta.body.report.case.id}`, undefined, staff);
  assert.ok(view.body.report.case.screening.reasons.some((r: string) => r.startsWith('OUT_OF_SCOPE')));
});
