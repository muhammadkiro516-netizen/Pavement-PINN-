/**
 * Analysis Workspace over HTTP with real sessions (handoff U2/U6):
 * RBAC, F.E correction -> real rerun on the Python service -> version -> M.O approval ->
 * public tracking page; SSE stage events; and the honest path when inference is down.
 *
 * The Python service is started from inference/.venv when present. Without it the
 * "real rerun" test is skipped with that reason; nothing is faked in its place.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../../server/app';
import { createWorkflowRuntime, type WorkflowRuntime } from '../../server/services/workflowRuntime';
import { demoLoginFor } from '../../src/data/reference/demoCredentials';
import { bodyWithSession } from '../helpers/sessionCookie';

const PY = [path.join(process.cwd(), 'inference', '.venv', 'bin', 'python'), path.join(process.cwd(), 'inference', '.venv', 'Scripts', 'python.exe')].find((p) => existsSync(p)) ?? 'python-not-installed';
const PY_PORT = 8199;
let py: ChildProcess | null = null;
let pyReady = false;

async function startApp(engineUrl: string): Promise<{ server: Server; base: string; runtime: WorkflowRuntime }> {
  const runtime = createWorkflowRuntime({
    sessionSecret: 'w'.repeat(40),
    analysisEngine: {
      call: async (method, p, payload) => {
        try {
          const res = await fetch(engineUrl + p, { method, headers: payload ? { 'Content-Type': 'application/json' } : undefined, body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(120000) });
          return { ok: res.ok, status: res.status, body: await res.json() };
        } catch {
          return { ok: false, status: 503, unavailable: true, message: 'unreachable' } as const;
        }
      }
    }
  });
  await runtime.ready;
  return new Promise((resolve) => {
    const server = createApp({ workflow: runtime }).listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, runtime }));
  });
}

let live: Awaited<ReturnType<typeof startApp>>;
let dead: Awaited<ReturnType<typeof startApp>>;

before(async () => {
  if (existsSync(PY)) {
    py = spawn(PY, ['-m', 'uvicorn', 'app.main:app', '--port', String(PY_PORT), '--log-level', 'warning'], { cwd: path.join(process.cwd(), 'inference'), stdio: 'ignore' });
    for (let i = 0; i < 120 && !pyReady; i++) {
      await new Promise((r) => setTimeout(r, 250));
      pyReady = await fetch(`http://127.0.0.1:${PY_PORT}/v1/geometry/health`).then((r) => r.ok).catch(() => false);
    }
  }
  live = await startApp(`http://127.0.0.1:${PY_PORT}`);
  dead = await startApp('http://127.0.0.1:9'); // nothing listens on the discard port
});

after(async () => {
  for (const s of [live, dead]) await new Promise<void>((r) => s.server.close(() => r()));
  py?.kill();
});

const tokens = new Map<string, string>();
async function call(base: string, method: string, p: string, body?: unknown, account?: string) {
  let token: string | undefined;
  if (account) {
    const key = `${base}|${account}`;
    if (!tokens.has(key)) {
      const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(demoLoginFor(account)) });
      tokens.set(key, (await bodyWithSession(r)).token);
    }
    token = tokens.get(key);
  }
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
}

const FE = 'USR-006';
const MO = 'USR-008';
const PM = 'USR-007';
const CITIZEN = 'USR-004';
const DEMO = '/api/v3/reports/ROAD-2026-001';
const CONTOUR = { kind: 'contour', objectId: 'POTHOLE-024', field: 'contour', reason: 'Batas lubang dikoreksi setelah cek lapangan', evidence: ['F02'] };

async function settle(base: string, account = MO) {
  // Up to 90 s: an MLET field grid takes a few seconds alone, much longer on a loaded machine.
  for (let i = 0; i < 900; i++) {
    const ws = (await call(base, 'GET', `${DEMO}/workspace`, undefined, account)).body.workspace;
    if (!ws.stageRuns.some((r: any) => !r.supersededBy && (r.status === 'queued' || r.status === 'running'))) return ws;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('stage runs did not settle');
}

test('only M.O and F.E open the workspace API; citizens, policy makers and anonymous get 403', async () => {
  assert.equal((await call(live.base, 'GET', '/api/v3/workspaces')).status, 403);
  assert.equal((await call(live.base, 'GET', '/api/v3/workspaces', undefined, CITIZEN)).status, 403);
  assert.equal((await call(live.base, 'GET', '/api/v3/workspaces', undefined, PM)).status, 403);
  const r = await call(live.base, 'GET', '/api/v3/workspaces', undefined, MO);
  assert.equal(r.status, 200);
  // The demo workspace and every SEED_IMPORT citizen report are DATA CONTOH: excluded from KPIs.
  assert.equal(r.body.kpi.excludedDemo, r.body.items.filter((i: any) => i.demo).length);
  assert.ok(r.body.kpi.excludedDemo >= 2);
  assert.ok(r.body.items.some((i: any) => i.reportId === 'ROAD-2026-001' && i.demo));
  assert.equal((await call(live.base, 'GET', `${DEMO}/workspace`, undefined, FE)).status, 200);
});

test('a citizen report opens with blocked geometry stages and no measurements', async () => {
  const list = (await call(live.base, 'GET', '/api/v3/workspaces', undefined, MO)).body.items;
  const citizen = list.find((i: any) => i.reportId.startsWith('REP-KRW'));
  const ws = (await call(live.base, 'GET', `/api/v3/reports/${citizen.reportId}/workspace`, undefined, MO)).body.workspace;
  assert.equal(ws.stageRuns.find((r: any) => r.stage === 'T1_reconstruct').status, 'blocked');
  assert.ok(Object.values(ws.objects[0].measurements).every((m: any) => m.value === null && m.reasonUnavailable));
  assert.equal(ws.objects[0].class.confidence, null);
  assert.equal(ws.publicInfo.sanitizedPhotoUri, null);
});

test('M.O cannot correct (403); without inference the rerun is blocked and approval refused', async () => {
  const c = { ...CONTOUR, newValue: [[100, 100], [700, 100], [700, 700], [100, 700]] };
  assert.equal((await call(dead.base, 'POST', `${DEMO}/corrections`, c, MO)).status, 403);
  assert.equal((await call(dead.base, 'POST', `${DEMO}/corrections`, c, FE)).status, 200);
  const ws = await settle(dead.base);
  const t4 = ws.stageRuns.find((r: any) => !r.supersededBy && r.stage === 'T4_surface');
  assert.equal(t4.status, 'blocked');
  assert.match(t4.reason, /inference/i);
  assert.equal((await call(dead.base, 'POST', `${DEMO}/versions/submit`, { changeSummaryPublic: 'Petugas memperbaiki batas lubang.' }, FE)).status, 200);
  const approve = await call(dead.base, 'POST', `${DEMO}/versions/1/approve`, {}, MO);
  assert.equal(approve.status, 409);
  assert.equal(approve.body.code, 'STAGES_NOT_READY');
});

test('F.E contour correction -> real rerun -> new version -> M.O approves -> /track shows the revision', { skip: existsSync(PY) ? false : 'inference/.venv missing' }, async () => {
  assert.ok(pyReady, 'Python inference service did not start');
  const events: string[] = [];
  const ctrl = new AbortController();
  const login = await fetch(live.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(demoLoginFor(MO)) });
  const moToken = (await bodyWithSession(login)).token;
  const stream = await fetch(`${live.base}${DEMO}/stream`, { headers: { Authorization: `Bearer ${moToken}` }, signal: ctrl.signal });
  const reader = stream.body!.getReader();
  const pump = (async () => {
    const dec = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const m of dec.decode(value).matchAll(/event: (\w+)/g)) events.push(m[1]);
      }
    } catch {
      /* aborted */
    }
  })();

  const before = (await call(live.base, 'GET', `${DEMO}/workspace`, undefined, FE)).body.workspace;
  const oldVolume = before.objects[0].measurements.volumeL.value;
  // A smaller contour (inner disc) must give a smaller deficit volume.
  const s = before.surfaces[0];
  const c0 = (s.cols * s.cellSize) / 2;
  const ring = Array.from({ length: 48 }, (_, i) => [c0 + 120 * Math.cos((i / 48) * 2 * Math.PI), c0 + 120 * Math.sin((i / 48) * 2 * Math.PI)]);
  assert.equal((await call(live.base, 'POST', `${DEMO}/corrections`, { ...CONTOUR, newValue: ring }, FE)).status, 200);
  const ws = await settle(live.base);
  const latest = (st: string) => ws.stageRuns.find((r: any) => !r.supersededBy && r.stage === st);
  assert.equal(latest('T4_surface').status, 'completed');
  assert.equal(latest('T5_quantify').status, 'completed');
  assert.equal(ws.stageRuns.find((r: any) => r.runId === 'demo-run-T5').status, 'stale');
  const vol = ws.objects[0].measurements.volumeL;
  assert.equal(vol.provenance, 'corrected');
  assert.ok(vol.value < oldVolume, `volume ${vol.value} should shrink from ${oldVolume}`);

  assert.equal((await call(live.base, 'POST', `${DEMO}/versions/submit`, { changeSummaryPublic: 'Petugas lapangan memperbaiki batas lubang.' }, FE)).status, 200);
  assert.equal((await call(live.base, 'POST', `${DEMO}/versions/1/approve`, {}, FE)).status, 403);
  const approved = await call(live.base, 'POST', `${DEMO}/versions/1/approve`, {}, MO);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));

  const code = approved.body.workspace.trackingCode;
  const track = await call(live.base, 'GET', `/api/public/track/${code}`);
  assert.equal(track.status, 200);
  assert.equal(track.body.track.currentVersion, 1);
  assert.equal(track.body.track.changeSummary, 'Petugas lapangan memperbaiki batas lubang.');
  assert.ok(!JSON.stringify(track.body).includes('USR-'));
  await new Promise((r) => setTimeout(r, 200));
  ctrl.abort();
  await pump;
  assert.ok(events.includes('stage'), `SSE events: ${events.join(',')}`);
  assert.ok(events.includes('version'));
});

test('structural rerun after a layer correction runs MLET and marks the old run stale', { skip: existsSync(PY) ? false : 'inference/.venv missing' }, async () => {
  assert.equal((await call(live.base, 'POST', `${DEMO}/corrections`, { kind: 'layers', field: 'layers.0.thicknessMm.value', newValue: 120, reason: 'Core #C-07 menunjukkan AC 120 mm', evidence: ['core-C07.jpg'] }, FE)).status, 200);
  const ws = await settle(live.base);
  const runs = ws.structuralRuns;
  assert.equal(runs.length, 2);
  assert.equal(runs[0].status, 'stale');
  assert.equal(runs[1].status, 'completed');
  assert.notEqual(runs[1].epsTUe.value, runs[0].epsTUe.value);
  assert.equal(runs[1].fieldGrids.length, 3);
  assert.equal(ws.layers[0].source, 'MEASURED');
});

test('vehicle scenario: each preset reaches MLET per axle; heavier vehicles strain more; inference down -> 503', { skip: existsSync(PY) ? false : 'inference/.venv missing' }, async () => {
  const { VEHICLE_PRESETS } = await import('../../src/domain/workspace/vehicles');
  const et: Record<string, number> = {};
  for (const v of Object.values(VEHICLE_PRESETS)) {
    const r = await call(live.base, 'POST', '/api/v3/reports/ROAD-2026-002/vehicle-scenario', { vehicle: v }, MO);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const s = r.body.scenario;
    assert.equal(s.axles.length, v.axles.length);
    assert.ok(s.axles.every((a: any) => a.etUe > 0 && a.error === null), JSON.stringify(s.axles));
    assert.ok(s.field?.eps_xx?.values?.length > 0);
    assert.equal(s.axles[s.governingIndex].etUe, Math.max(...s.axles.map((a: any) => a.etUe)));
    et[v.type] = Math.max(...s.axles.map((a: any) => a.etUe));
  }
  assert.ok(et.motorcycle < et.car && et.car < et.truck, JSON.stringify(et));
  const bad = await call(live.base, 'POST', '/api/v3/reports/ROAD-2026-002/vehicle-scenario', { vehicle: { ...VEHICLE_PRESETS.car, axles: [] } }, MO);
  assert.equal(bad.status, 400);
  const down = await call(dead.base, 'POST', '/api/v3/reports/ROAD-2026-002/vehicle-scenario', { vehicle: VEHICLE_PRESETS.car }, MO);
  assert.equal(down.status, 503);
  assert.equal((await call(live.base, 'POST', '/api/v3/reports/ROAD-2026-002/vehicle-scenario', { vehicle: VEHICLE_PRESETS.car }, CITIZEN)).status, 403);
});

const DONE = '/api/v3/reports/ROAD-2026-002';

test('crack pipeline runs through the real rerun path and persists the crack map', { skip: existsSync(PY) ? false : 'inference/.venv missing' }, async () => {
  const r = await call(live.base, 'POST', `${DONE}/corrections`, { kind: 'reference_plane', objectId: 'CRACK-032', field: 'quality.referencePlane', newValue: { method: 'ring' }, reason: 'Hitung ulang crack dari permukaan tersimpan' }, FE);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  let ws: any;
  for (let i = 0; i < 200; i++) {
    ws = (await call(live.base, 'GET', `${DONE}/workspace`, undefined, MO)).body.workspace;
    if (!ws.stageRuns.some((x: any) => !x.supersededBy && (x.status === 'queued' || x.status === 'running'))) break;
    await new Promise((res) => setTimeout(res, 100));
  }
  const t5 = ws.stageRuns.find((x: any) => !x.supersededBy && x.stage === 'T5_quantify');
  assert.equal(t5.status, 'completed', JSON.stringify(t5));
  const crack = ws.objects.find((o: any) => o.objectId === 'CRACK-032');
  assert.match(crack.measurements.widthMeanMm.source.method, /crack_from_grid/);
  assert.ok(Math.abs(crack.measurements.widthMeanMm.value - 10) <= 2);
  assert.ok(Math.abs(crack.measurements.depthMaxMm.value - 6) <= 0.5);
  assert.equal(crack.measurements.volumeL.value, null);
  const s = ws.surfaces.find((x: any) => x.objectId === 'CRACK-032');
  assert.ok(s.crackMap.flat().includes(1));
  // the pothole in the same report still reruns through requantify
  const pot = ws.objects.find((o: any) => o.objectId === 'POTHOLE-031');
  assert.ok(pot.measurements.volumeL.value > 0);
});
