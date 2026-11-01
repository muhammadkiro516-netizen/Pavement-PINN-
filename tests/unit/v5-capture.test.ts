import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import express from 'express';
import type { V5Store } from '../../server/v5/store';
import { CaptureService, NONCE_TTL_MS, analyseTrace, isCaptureFailure } from '../../server/v5/capture';
import { registerV5Routes } from '../../server/v5/routes';
import { PILOT_ROSTER, StaffAccounts } from '../../server/v5/staffAccounts';
import { inclusionProof, merkleRoot, verifyInclusion } from '../../server/v5/merkle';
import { bannedWordsIn } from '../../src/domain/v5/wording';
import { normalizePdf, renderTemplate, reportProblems } from '../../server/v5/documents';

// Nothing listens here: these tests cover the path with the AI service down.
process.env.INFERENCE_URL = 'http://127.0.0.1:9';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'v5-cap-'));
const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')}`;
const GPS = { lat: -6.2, lon: 106.85, accuracyM: 8, speedMps: 0 };

test('live capture only: no file input on the capture and citizen screens', () => {
  for (const file of ['src/features/roles/Capture.tsx', 'src/features/roles/StaffPages.tsx', 'src/features/roles/CitizenReports.tsx', 'src/features/community-reports/ReportRoadIssueCard.tsx', 'src/features/community-reports/ReportExtraAngles.tsx', 'src/features/community-reports/LongDamageWalk.tsx']) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /type=["']file["']/, file);
  }
});

test('nothing of the old sample mode is left in the app', () => {
  for (const dir of ['public/demo', 'public/photos', 'public/test-fixtures', 'public/dataset-reference/rdd2022']) assert.equal(fs.existsSync(dir), false, dir);
  for (const file of ['src/features/roles/Capture.tsx', 'src/features/roles/PublicPages.tsx', 'src/features/roles/TrackPages.tsx', 'src/features/roles/StaffPages.tsx', 'src/features/roles/api.ts', 'src/pages/roles/RolePages.tsx', 'server/v5/routes.ts', 'server/v5/capture.ts']) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /demo|sampleId|fast-forward/i, file);
  }
});

test('a citizen is never asked for depth (C-2.6)', () => {
  // The report screen fixes depth at "not measured"; no field or label asks for it.
  const text = fs.readFileSync('src/features/community-reports/ReportRoadIssueCard.tsx', 'utf8');
  assert.match(text, /estimatedDepthCm: 0,/);
  assert.doesNotMatch(text, /<(input|label)[^>]*(depth|kedalaman)/i);
  assert.doesNotMatch(text, />\s*Kedalaman/);
});

test('nonce: reuse and expiry are refused', async () => {
  const service = new CaptureService(tmp());
  const { nonce } = service.issueNonce('dev-1', 'REPORT');
  assert.equal(service.checkNonce(nonce, 'dev-2'), 'NONCE_INVALID', 'bound to its owner');
  assert.equal(service.checkNonce(nonce, 'dev-1'), null);
  assert.equal(service.checkNonce(nonce, 'dev-1'), 'NONCE_REUSED');
  const old = service.issueNonce('dev-1', 'REPORT', 1000);
  assert.equal(service.checkNonce(old.nonce, 'dev-1', 1000 + NONCE_TTL_MS + 1), 'NONCE_EXPIRED');
  assert.equal(service.checkNonce('made-up', 'dev-1'), 'NONCE_INVALID');
});

test('capture refuses bad nonces, poor GPS, vehicle speed and a photo it cannot blur', async () => {
  const s = new CaptureService(tmp());
  const base = { ownerId: 'd', image: JPEG, kind: 'OVERVIEW', gps: GPS, motionSamples: 3 };
  const code = async (extra: Record<string, unknown>) => {
    const r = await s.capture({ ...base, nonce: s.issueNonce('d', 'REPORT').nonce, ...extra });
    assert.ok(isCaptureFailure(r));
    return isCaptureFailure(r) ? r.code : '';
  };
  assert.equal(await code({ nonce: 'nope' }), 'NONCE_INVALID');
  assert.equal(await code({ gps: { ...GPS, accuracyM: 120 } }), 'GPS_ACCURACY');
  assert.equal(await code({ gps: null }), 'NO_GPS');
  assert.equal(await code({ gps: { ...GPS, speedMps: 8 } }), 'SPEED_LOCK');
  assert.equal(await code({ near: { latE6: -6300000, lonE6: 106850000, maxM: 50 } }), 'OFF_SITE');
  assert.equal(await code({ image: 'data:image/png;base64,AAAA' }), 'VALIDATION');
  assert.equal(await code({}), 'PRIVACY_UNAVAILABLE');
});

test('without the AI service nothing is made up: no detection, no blur claim', async () => {
  const s = new CaptureService(tmp(), true);
  const r = await s.capture({ ownerId: 'd', image: JPEG, kind: 'OVERVIEW', nonce: s.issueNonce('d', 'R').nonce, gps: GPS, motionSamples: 1 });
  assert.ok(!isCaptureFailure(r));
  if (isCaptureFailure(r)) return;
  assert.equal(r.captureTrust, 'LIVE_NONCE');
  assert.equal(r.ai.status, 'MODEL_UNAVAILABLE', 'a stopped AI service is reported, not hidden');
  assert.equal(r.ai.detections.length, 0, 'no made-up detection');
  assert.equal(r.privacy.status, 'NOT_AVAILABLE');
  assert.equal(r.privacy.platesBlurred, null, 'plate blur is never claimed');
});

test('evidence is single use across cases and bound to who took it', async () => {
  const s = new CaptureService(tmp(), true);
  const r = await s.capture({ ownerId: 'd', image: JPEG, kind: 'OVERVIEW', nonce: s.issueNonce('d', 'R').nonce, gps: GPS, motionSamples: 1 });
  assert.ok(!isCaptureFailure(r));
  if (isCaptureFailure(r)) return;
  const other = s.claim([r.id], 'someone-else', 'C1');
  assert.ok(isCaptureFailure(other) && other.code === 'FORBIDDEN');
  assert.ok(!isCaptureFailure(s.claim([r.id], 'd', 'C1')));
  const again = s.claim([r.id], 'd', 'C2');
  assert.ok(isCaptureFailure(again) && again.code === 'DUPLICATE_EVIDENCE');
});

test('originals are deleted after 7 days', async () => {
  const dir = tmp();
  const s = new CaptureService(dir, true);
  fs.writeFileSync(path.join(dir, 'originals', 'EV-x.enc'), 'x');
  assert.equal(s.purgeOriginals(Date.now()), 0);
  assert.equal(s.purgeOriginals(Date.now() + 8 * 86_400_000), 1);
  assert.equal(fs.existsSync(path.join(dir, 'originals', 'EV-x.enc')), false);
});

test('trace length and quality from synthetic walks (05 §6.4)', () => {
  const walk = (n: number, stepDeg: number, dtMs: number, acc = 4) => Array.from({ length: n }, (_, i) => ({ lat: -6.2 + i * stepDeg, lon: 106.85, accuracyM: acc, t: i * dtMs }));
  const good = analyseTrace(walk(21, 0.00001, 2000), 3);
  assert.ok(Math.abs(good.lengthM - 22.3) < 0.5, String(good.lengthM));
  assert.equal(good.quality, 'HIGH');
  assert.equal(good.longEnough, true);
  assert.equal(good.enoughPhotos, true);
  const driving = analyseTrace(walk(10, 0.0001, 1000), 3);
  assert.ok(driving.flags.includes('SPEED'));
  const gaps = analyseTrace(walk(6, 0.00001, 20000), 3);
  assert.ok(gaps.flags.includes('GAPS'));
  assert.equal(gaps.quality, 'LOW');
  assert.equal(analyseTrace(walk(4, 0.00001, 2000), 2).enoughPhotos, false);
  assert.equal(analyseTrace(walk(3, 0.00001, 2000), 3).longEnough, false);
  assert.equal(analyseTrace(walk(10, 0.00001, 2000, 50), 3).points, 0, 'poor fixes are dropped');
});

test('Merkle: every inclusion proof verifies, and a wrong leaf fails (RFC 6962)', () => {
  for (const size of [1, 2, 3, 7, 8, 13]) {
    const leaves = Array.from({ length: size }, (_, i) => `event-${i}`);
    const root = merkleRoot(leaves);
    leaves.forEach((leaf, i) => {
      const proof = inclusionProof(leaves, i);
      assert.equal(verifyInclusion(leaf, i, size, proof, root), true, `${size}/${i}`);
      assert.equal(verifyInclusion('tampered', i, size, proof, root), false);
    });
  }
  assert.notEqual(merkleRoot(['a', 'b']), merkleRoot(['b', 'a']));
});

const placeholderValues = (html: string) => Object.fromEntries([...html.matchAll(/\{\{([a-z_]+)\}\}/g)].map((m) => [m[1], '']));

test('the report template has no government kop or emblem, and says it is not official', () => {
  const template = fs.readFileSync('docs/v5/templates/audit_report_independent.html', 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const body = template.slice(template.indexOf('<body>'));
  assert.match(body, /bukan naskah dinas/i);
  assert.doesNotMatch(body, /<img/i, 'no image in the template; only the QR fragment is added');
  assert.doesNotMatch(body, /garuda|pemerintah provinsi|kementerian/i);
});

test('the renderer fails on unknown placeholders and the wording check catches accusations', () => {
  const template = fs.readFileSync('docs/v5/templates/audit_report_independent.html', 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  assert.throws(() => renderTemplate({}), /Unknown template placeholders/);
  const html = renderTemplate(placeholderValues(template));
  assert.deepEqual(reportProblems(html), [], 'the legal disclaimer does not trip the checker');
  assert.ok(reportProblems(`${html}<p>ada korupsi di sini</p>`).length > 0);
  assert.ok(bannedWordsIn('fraud').length > 0);
});

test('PDF clock normalisation repeats bytes for the same snapshot (IN-3)', () => {
  const a = Buffer.from("/CreationDate (D:20261101120000+00'00') x /ModDate (D:20261101120000+00'00')", 'latin1');
  const b = Buffer.from("/CreationDate (D:20261101120755+00'00') x /ModDate (D:20261101120755+00'00')", 'latin1');
  const t = '2026-11-01T03:00:00.000Z';
  assert.deepEqual(normalizePdf(a, t), normalizePdf(b, t));
  assert.equal(normalizePdf(a, t).length, a.length, 'offsets in the file stay valid');
  assert.match(normalizePdf(a, t).toString('latin1'), /D:20261101030000/);
});

// Whole API, AI service down: the workflow still completes and says what was not computed.
let server: Server;
let base = '';
let apiStore: V5Store;

const call = async (url: string, opts: { token?: string; body?: unknown } = {}) => {
  const res = await fetch(`${base}${url}`, { method: opts.body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(opts.token ? { 'x-v5-session': opts.token } : {}) }, ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }) });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, body: (type.includes('json') ? await res.json() : await res.text()) as any };
};
const PASSWORD = 'test-password-1';
const login = async (accountId: string) => (await call('/api/v5/session/login', { body: { email: PILOT_ROSTER.find((a) => a.accountId === accountId)!.email, password: PASSWORD } })).body.data.token as string;
const AT = { lat: -6.2006, lon: 106.8574, accuracyM: 8, speedMps: 0 };

async function shot(token: string, _name: string, kind: string, stage?: string) {
  const { nonce } = (await call('/api/v5/capture/nonce', { token, body: { purpose: 'X' } })).body.data;
  const r = await call('/api/v5/evidence', { token, body: { nonce, image: JPEG, kind, stage, gps: AT, motionSamples: 1 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data.id as string;
}

before(async () => {
  const app = express();
  app.use(express.json({ limit: '7mb' }));
  const router = express.Router();
  const dataDir = tmp();
  const staff = new StaffAccounts(path.join(dataDir, 'v5'));
  for (const account of PILOT_ROSTER) staff.upsert(account, PASSWORD);
  apiStore = registerV5Routes(router, { dataDir, lenientCapture: true }).store;
  app.use(router);
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => { server.close(); });

test('API walkthrough: report to accepted repair, every number from a real path', async () => {
  const device = (await call('/api/v5/session/device', { body: {} })).body.data.token;
  const overview = await shot(device, 'pothole', 'OVERVIEW');
  const sent = await call('/api/v5/cases', { token: device, body: { mode: 'SINGLE', evidenceIds: [overview], lat: AT.lat, lon: AT.lon, accuracyM: 8, sizeBand: 'M', classGuess: null } });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const { caseId, publicCode } = sent.body.data;
  assert.equal(sent.body.data.state, 'TRIAGE', 'screening never accepts on its own');
  assert.equal(sent.body.data.screening.status, 'MODEL_UNAVAILABLE');

  const coord = await login('ACC-COORD');
  const act = async (token: string, action: string, body: Record<string, unknown> = {}) => {
    const c = (await call(`/api/v5/cases/${caseId}`, { token })).body.data;
    return call(`/api/v5/cases/${caseId}/transitions`, { token, body: { action, expectedVersion: c.version, ...body } });
  };
  const ok = (r: { status: number; body: any }) => assert.equal(r.status, 200, JSON.stringify(r.body));
  ok(await act(coord, 'ACCEPT', { reason: 'Photo shows road damage here.', damageClass: 'POTHOLE' }));
  ok(await act(coord, 'ASSIGN_INSPECTION', { inspectorAccountId: 'ACC-INSPECT', dueAt: '2027-01-01T00:00:00.000Z' }));

  const insp = await login('ACC-INSPECT');
  const evidenceIds = [await shot(insp, 'pothole', 'OVERVIEW'), await shot(insp, 'marker-card', 'MARKER_NADIR'), await shot(insp, 'ruler', 'DEPTH_RULER')];
  // The client cannot claim a marker or a ruler match: the server overwrites both.
  ok(await act(insp, 'SUBMIT_INSPECTION', { verdict: 'CONFIRMED', classConfirmed: 'POTHOLE', lengthMm: 800, widthMm: 600, depthMmTyped: 70, evidenceIds, markerDetected: true, rulerCheck: 'MATCH' }));
  const inspected = (await call(`/api/v5/cases/${caseId}`, { token: insp })).body.data;
  assert.equal(inspected.inspection.rulerCheck, 'AI_UNREADABLE');
  assert.equal(inspected.inspection.areaStatus, 'AI_ESTIMATE', 'with the marker service down the size is not MEASURED');
  ok(await act(coord, 'VERIFY_INSPECTION', { reason: 'Measurements and photos are complete.', acknowledgeRulerMismatch: true }));

  const pinn = await call(`/api/v5/cases/${caseId}/pinn`, { token: insp, body: { esalYear: 250000 } });
  assert.equal(pinn.body.data.run.status, 'PINN_UNAVAILABLE', 'no invented life range');
  const cost = await call(`/api/v5/cases/${caseId}/cost`, { token: insp, body: { mix: 'AC_WC', reportedSpendIdr: 1200000 } });
  assert.deepEqual(cost.body.data.cost.fairCostIdr, { low: 388993, mid: 434904, high: 506904 }, 'worked example 8.1 through the API');
  assert.equal(cost.body.data.case.flags[0].code, 'NEEDS_CLARIFICATION_COST');
  assert.ok(cost.body.data.case.flags[0].text.includes('bukan temuan audit'));

  ok(await act(insp, 'PROPOSE_PLAN', { repairType: 'HOT_MIX_FULL_DEPTH_PATCH', category: 'PERMANENT', urgency: 'PRIORITY', rationale: 'Deep pothole.', areaCm2: 999, thicknessMm: 1, volumeCm3: 1 }));
  const planned = (await call(`/api/v5/cases/${caseId}`, { token: insp })).body.data;
  assert.equal(planned.plan.areaCm2, 16800, 'quantities come from the measurements, not the request');

  const blocked = await act(await login('ACC-INSPECT-AS-APPROVER'), 'APPROVE_PLAN', { reason: 'Looks fine to me today.', budgetSource: 'APBD' });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.rule, 'SOD-2');
  const approver = await login('ACC-APPROVE');
  ok(await act(approver, 'APPROVE_PLAN', { reason: 'Fair cost and size look right.', budgetSource: 'APBD' }));

  const sameCrew = await act(coord, 'ISSUE_WORK_ORDER', { type: 'SWAKELOLA', crewAccountId: 'ACC-CREW', supervisorAccountId: 'ACC-CREW', targetDate: '2027-01-01T00:00:00.000Z' });
  assert.equal(sameCrew.status, 400, 'the crew cannot be chosen as supervisor');
  ok(await act(coord, 'ISSUE_WORK_ORDER', { type: 'SWAKELOLA', crewAccountId: 'ACC-CREW', supervisorAccountId: 'ACC-SUPERVISE', targetDate: '2027-01-01T00:00:00.000Z' }));

  const crew = await login('ACC-CREW');
  const stage = async (s: string, values?: Record<string, unknown>) => ok(await call(`/api/v5/cases/${caseId}/stage-evidence`, { token: crew, body: { evidenceId: await shot(crew, `stage-${s.toLowerCase().replace(/_/g, '-')}`, 'WORK_STAGE', s), values } }));
  await stage('BEFORE');
  assert.equal((await act(crew, 'START_WORK', { useSavedStages: true })).status, 400, 'cut edges are still missing');
  await stage('CUT_EDGES');
  ok(await act(crew, 'START_WORK', { useSavedStages: true }));
  for (const s of ['CLEAN_DRY', 'TACK_COAT', 'DELIVERY_TICKET', 'MIX_TEMP_TRUCK', 'COMPACTION', 'AFTER']) await stage(s);
  assert.equal((await act(crew, 'SUBMIT_WORK_EVIDENCE', { useSavedStages: true })).status, 400, 'mix temperature is still missing');
  await stage('MIX_TEMP_MAT', { temperatureC: 100 });
  ok(await act(crew, 'SUBMIT_WORK_EVIDENCE', { useSavedStages: true, declared: { tonnageKg: 900, reportedSpendIdr: 1200000 } }));
  const submitted = (await call(`/api/v5/cases/${caseId}`, { token: crew })).body.data;
  const codes = submitted.flags.map((f: { code: string }) => f.code);
  assert.ok(codes.includes('LOW_MIX_TEMPERATURE'), 'a low temperature is an indication, not a rejection');
  assert.ok(codes.includes('QUANTITY_DIFFERENCE'));

  const sup = await login('ACC-SUPERVISE');
  assert.equal((await act(sup, 'VERIFY_WORK', {})).status, 400, 'the supervisor needs an own photo');
  ok(await act(sup, 'VERIFY_WORK', { evidenceIds: [await shot(sup, 'stage-supervisor-after', 'WORK_STAGE', 'SUPERVISOR_AFTER')] }));
  ok(await act(approver, 'ACCEPT_WORK', { reason: 'The supervisor checked every stage.', maintenanceMonths: 6, phoDate: new Date().toISOString() }));

  const track = (await call(`/api/v5/public/track/${publicCode}`)).body.data;
  assert.equal(track.stateLabel, 'Repaired — under watch');
  assert.deepEqual(track.followUps.map((f: { milestone: string }) => f.milestone), ['M1', 'M3', 'PRE_FHO', 'M6', 'HEAVY_RAIN']);
  assert.equal(track.underTechnicalReview, true, 'open flags show only as a neutral line');
  assert.doesNotMatch(JSON.stringify(track), /QUANTITY_DIFFERENCE|ACC-|P-INSPECT|proposerPersonId/);

  // Citizens: one answer is an observation; two devices, one with a photo, reopen the case.
  const confirm = (token: string, result: string, evidenceIds: string[] = []) => call(`/api/v5/public/track/${publicCode}/confirm`, { token, body: { result, evidenceIds } });
  const first = await confirm(device, 'DAMAGED');
  assert.equal(first.body.data.state, 'MONITORING');
  const second = (await call('/api/v5/session/device', { body: {} })).body.data.token;
  const photo = await shot(second, 'pothole-2', 'FOLLOW_UP');
  const reopened = await confirm(second, 'DAMAGED', [photo]);
  assert.equal(reopened.body.data.state, 'REOPENED');
  assert.equal(reopened.body.data.warrantyFlag, true, 'inside the 6-month maintenance period');

  // Auditor read-only; the log still verifies after the whole walk.
  const auditor = await login('ACC-AUDIT');
  assert.equal((await act(auditor, 'ASSIGN_INSPECTION', { inspectorAccountId: 'ACC-INSPECT', dueAt: '2027-01-01T00:00:00.000Z' })).body.error.rule, 'SOD-8');
  const accused = await call(`/api/v5/cases/${caseId}/flags`, { token: auditor, body: { wordingId: 'W-01', note: 'The crew committed fraud here' } });
  assert.equal(accused.status, 400);
  const neutral = await call(`/api/v5/cases/${caseId}/flags`, { token: auditor, body: { wordingId: 'W-01', note: 'Please compare with the ticket.' } });
  assert.equal(neutral.status, 200);
  assert.equal((await call('/api/v5/public/chain/prod/verify')).body.data.ok, true);
});

test('API: the complaint draft opens after 30 real days, and the ladder follows the clock', async () => {
  const device = (await call('/api/v5/session/device', { body: {} })).body.data.token;
  const id = await shot(device, 'x', 'OVERVIEW');
  const { publicCode, caseId } = (await call('/api/v5/cases', { token: device, body: { mode: 'SINGLE', evidenceIds: [id], lat: -6.9, lon: 110.4, accuracyM: 8 } })).body.data;
  assert.match(publicCode, /^IDN-/, 'outside the pilot regions');
  assert.equal((await call(`/api/v5/public/track/${publicCode}/complaint-draft`)).status, 409);
  // The report is dated 31 days back, as if it had really waited that long.
  const c = apiStore.get(caseId)!;
  apiStore.record(c, { ladderStartAt: new Date(Date.now() - 31 * 86_400_000).toISOString() }, 'migration.note', {}, { kind: 'SYSTEM', accountId: 'system:test', personId: null, role: 'SYSTEM', scope: '*' }, new Date().toISOString());
  assert.equal((await call(`/api/v5/public/track/${publicCode}`)).body.data.ladder.level, 'COMPLAINT');
  const draft = await call(`/api/v5/public/track/${publicCode}/complaint-draft`);
  assert.match(draft.body, /tidak dikirim otomatis/);
  assert.equal(bannedWordsIn(draft.body).length, 0);
});
