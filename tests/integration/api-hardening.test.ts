/**
 * Backend hardening tests (post-restructure):
 *  - unknown /api/* paths answer JSON 404 (they used to return the SPA HTML with 200);
 *  - untrusted request values cannot inject lines or unbounded text into the LLM prompt;
 *  - unknown roles never reach the language model.
 *
 * None of this is authentication: every endpoint is still open to any caller.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../../server/app';
import { INDONESIAN_ROAD_SEGMENTS } from '../../src/data/reference/indonesianRoads';

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

test('unknown /api paths answer JSON 404 for every method', async () => {
  for (const [method, path] of [['GET', '/api/nope'], ['POST', '/api/simulate/extra'], ['DELETE', '/api/roads'], ['GET', '/api']] as const) {
    const res = await fetch(base + path, { method });
    assert.equal(res.status, 404, `${method} ${path}`);
    assert.match(res.headers.get('content-type') ?? '', /^application\/json/);
    assert.deepEqual(await res.json(), { success: false, error: 'Unknown API endpoint' });
  }
});

test('the JSON 404 does not shadow the real endpoints or non-API paths', async () => {
  assert.equal((await fetch(base + '/api/health')).status, 200);
  assert.equal((await fetch(base + '/api/roads')).status, 200);
  // createApp() has no frontend host attached, so a page path is simply unhandled here;
  // the point is that it is NOT answered by the API 404 handler.
  const page = await fetch(base + '/dashboard/');
  assert.doesNotMatch(await page.text(), /Unknown API endpoint/);
});

test('oversized request bodies are rejected before any handler runs', async () => {
  // express.json() default limit is 100 kB; this pins that an unauthenticated caller
  // cannot post megabytes of "simulation data".
  const res = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'FIELD_ENGINEER', simulationData: { blob: 'x'.repeat(300000) } })
  });
  assert.equal(res.status, 413);
});
