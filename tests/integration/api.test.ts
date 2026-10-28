/**
 * HTTP API contract tests.
 *
 * Boots the real Express app (server/app.ts) on an ephemeral port — no Vite, no mocks —
 * and exercises every endpoint. Expected values were recorded from the pre-restructure
 * server (server.ts @ fffa344) before the backend was split into modules.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../../server/app';
import { loadServerConfig } from '../../server/config/env';
import { generateNarrative, buildFallbackNarrative } from '../../server/services/narrativeService';
import { INDONESIAN_ROAD_SEGMENTS } from '../../src/data/reference/indonesianRoads';
import { API_PATHS } from '../../src/types';
import { defaultParamsFor } from '../physics-validation/pinnScenarios';

// Never call the real Gemini API from the test suite: without a key the endpoint must
// deterministically answer with the offline rule-engine narrative.
delete process.env.GEMINI_API_KEY;

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

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const postJson = (path: string, body: unknown) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('API_PATHS keeps the six pre-restructure endpoint paths', () => {
  assert.deepEqual(API_PATHS, {
    health: '/api/health',
    roads: '/api/roads',
    simulate: '/api/simulate',
    generateNarrative: '/api/generate-narrative'
  });
});

test('GET /api/health', async () => {
  const res = await fetch(base + '/api/health');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^application\/json/);
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ['status', 'appName', 'timestamp', 'server']);
  // Which code this process runs, so the UI can warn about a stale server on another port.
  assert.deepEqual(Object.keys(body.server), ['pid', 'startedAt', 'commit', 'currentCommit', 'stale', 'syncStatus', 'checkedAt', 'changedFiles', 'fingerprint']);
  assert.equal(typeof body.server.stale, 'boolean');
  assert.ok(['SYNCED', 'COMMIT_MISMATCH', 'SOURCE_MODIFIED', 'UNKNOWN'].includes(body.server.syncStatus));
  assert.ok(!Number.isNaN(Date.parse(body.server.checkedAt)));
  assert.equal(body.status, 'ok');
  assert.equal(body.appName, 'PAVEMENT-PINN');
  assert.ok(!Number.isNaN(Date.parse(body.timestamp)));
});

test('GET /api/roads returns the full reference dataset, byte-identical to baseline', async () => {
  const res = await fetch(base + '/api/roads');
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.equal(Buffer.byteLength(text), 8775); // was 18133 before fabricated WIM station data was removed (F-16)
  assert.equal(sha256(text), 'cb1a0db4ea3c50a76d68cbdd7d412b10c6eb1e1e7ceed4137db284d70b034938');
  assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(INDONESIAN_ROAD_SEGMENTS)));
});

test('POST /api/simulate is retired: 410 pointing to the MLET engine (F-03, F-11, v3 M1)', async () => {
  const res = await postJson('/api/simulate', { params: defaultParamsFor(INDONESIAN_ROAD_SEGMENTS[0]) });
  assert.equal(res.status, 410);
  const body = await res.json();
  assert.equal(body.error.code, 'GONE');
  assert.match(body.error.message, /\/api\/engine\/assess/);
});

test('GET /api/openvino/export-ir and export-config are removed: 404 (F-13, v3 Phase 0)', async () => {
  for (const path of ['/api/openvino/export-ir', '/api/openvino/export-ir?device=CPU&precision=FP32', '/api/openvino/export-config']) {
    const res = await fetch(base + path);
    assert.equal(res.status, 404, path);
  }
});

test('POST /api/generate-narrative: 200 envelope, offline rule-engine source when no API key is configured', async () => {
  const res = await postJson('/api/generate-narrative', { role: 'FIELD_ENGINEER', simulationData: {} });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ['success', 'narrative', 'source']);
  assert.equal(body.success, true);
  assert.equal(typeof body.narrative, 'string');
  assert.equal(body.source, 'rule-engine-offline');
  assert.ok(body.narrative.startsWith('[CATATAN TEKNIS - RULE_BASED, INDIKATIF]'));
});

test('POST /api/generate-narrative: malformed JSON is rejected with HTTP 400', async () => {
  const res = await fetch(base + '/api/generate-narrative', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not json'
  });
  assert.equal(res.status, 400);
});

test('narrative service: offline text matches the baseline fallback, per role', async () => {
  const offline = await generateNarrative('FIELD_ENGINEER', {}, null);
  assert.equal(offline.source, 'rule-engine-offline');
  assert.equal(
    offline.narrative,
    '[CATATAN TEKNIS - RULE_BASED, INDIKATIF]\nRegangan tarik dasar aspal: tidak tersedia; regangan tekan tanah dasar: tidak tersedia. Nilai dari mesin rumus, bukan desain; opsi perbaikan diputuskan insinyur.'
  );
  assert.match(buildFallbackNarrative('OPERATIONS_MANAGER', {}), /^\[SINYAL OPERASIONAL - RULE_BASED\]/);
  assert.match(buildFallbackNarrative('POLICY_MAKER', {}), /^\[RINGKASAN KEBIJAKAN - RULE_BASED\]/);
  // Any unrecognised role (including the public roles) receives the policy narrative.
  assert.equal(buildFallbackNarrative('PUBLIC_VIEWER', {}), buildFallbackNarrative('POLICY_MAKER', {}));
});

test('narrative service: prefers the narrative embedded in the simulation result', () => {
  const simulationData = { aiNarrative: { fieldEngineerNarrative: 'embedded-text' } };
  assert.equal(buildFallbackNarrative('FIELD_ENGINEER', simulationData), 'embedded-text');
});

test('narrative service: a failing Gemini client degrades to rule-engine-fallback', async () => {
  const failingClient = { models: { generateContent: async () => { throw new Error('boom'); } } };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await generateNarrative('POLICY_MAKER', {}, failingClient as never);
    assert.equal(result.source, 'rule-engine-fallback');
    assert.equal(result.narrative, buildFallbackNarrative('POLICY_MAKER', {}));
  } finally {
    console.warn = originalWarn;
  }
});

test('no endpoint requires authentication (documents the absence of backend authorization)', async () => {
  // Requests carry no credentials or role header and are all accepted. If auth is ever
  // added, this test must be replaced by a real role-to-endpoint matrix.
  for (const path of ['/api/health', '/api/roads']) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200, path);
  }
});

test('server config: defaults preserve port 3000 and the GitHub Pages base path', () => {
  assert.deepEqual(loadServerConfig({}), {
    port: 3000,
    host: '0.0.0.0',
    isProduction: false,
    basePath: '/PavementPinn/',
    dataDir: '.data',
    sessionSecret: undefined,
    demoAuthEnabled: false,
    sessionMaxAgeSeconds: 7200
  });
  assert.equal(loadServerConfig({ SESSION_SECRET: 'too-short' }).sessionSecret, undefined);
  assert.equal(loadServerConfig({ DEMO_AUTH: 'true' }).demoAuthEnabled, true);
  assert.equal(loadServerConfig({ PORT: '4317', NODE_ENV: 'production', VITE_BASE_PATH: '/' }).port, 4317);
  assert.equal(loadServerConfig({ NODE_ENV: 'production' }).isProduction, true);
  assert.equal(loadServerConfig({ VITE_BASE_PATH: '/' }).basePath, '/');
  assert.equal(loadServerConfig({ VITE_BASE_PATH: 'demo' }).basePath, '/demo/');
  assert.equal(loadServerConfig({ PORT: 'abc' }).port, 3000);
});
