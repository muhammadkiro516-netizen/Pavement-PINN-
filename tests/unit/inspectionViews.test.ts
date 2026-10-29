import test from 'node:test';
import assert from 'node:assert/strict';
import { areaFromDimensions, summarizeViews, volumeFromDimensions, type InspectionView } from '../../src/domain/workflow/inspectionViews';
import { MemoryCaseStore, WorkflowService } from '../../src/domain/workflow/service';
import { DEMO_CV_PROVIDER } from '../../src/domain/workflow/screening';
import type { Actor } from '../../src/domain/workflow/model';
import { INITIAL_COMMUNITY_REPORTS } from '../../src/data/mock/communityReports';

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const ai = (primaryType: string | null, confidence: number, severity: string, flooded = false) => ({
  analysisId: 'CVA-0000000000000001', status: 'ok', primaryLabel: primaryType, primaryType, confidence, detections: primaryType ? 1 : 0, severity, surfaceIndex: 20, flooded
});
const view = (angle: InspectionView['angle'], a: InspectionView['ai']): InspectionView => ({ angle, photoUrl: PHOTO, takenAt: '2026-10-29T00:00:00Z', ai: a });

test('views agree on the type with the most confidence and report the highest severity', () => {
  const s = summarizeViews([view('OVERVIEW', ai('POTHOLE', 0.4, 'minor')), view('TOP', ai('POTHOLE', 0.8, 'severe')), view('SIDE', ai('CRACK', 0.6, 'moderate', true))]);
  assert.equal(s.consensusType, 'POTHOLE');
  assert.deepEqual(s.agreement, { agree: 2, of: 3 });
  assert.equal(s.maxSeverity, 'severe');
  assert.equal(s.suggestedSeverity, 'SEVERE');
  assert.equal(s.flooded, true);
  assert.deepEqual(s.missing, []);
});

test('missing required angles are listed', () => {
  assert.deepEqual(summarizeViews([view('TOP', null)]).missing, ['OVERVIEW', 'SIDE']);
});

test('area and patch volume come from tape measurements', () => {
  assert.equal(areaFromDimensions({ lengthCm: 120, widthCm: 80, depthCm: 6 }), 1);
  assert.equal(volumeFromDimensions({ lengthCm: 120, widthCm: 80, depthCm: 6 }), 0.06);
  assert.equal(areaFromDimensions({ lengthCm: 120, widthCm: null, depthCm: 6 }), null);
});

const CITIZEN: Actor = { id: 'USR-004', role: 'PUBLIC_REPORTER', kind: 'DEMO_ACCOUNT' };
const OPS: Actor = { id: 'USR-008', role: 'OPERATIONS_MANAGER', kind: 'DEMO_ACCOUNT' };
const ENG: Actor = { id: 'USR-006', role: 'FIELD_ENGINEER', kind: 'DEMO_ACCOUNT' };
const ROLES: Record<string, string> = { 'USR-004': 'PUBLIC_REPORTER', 'USR-008': 'OPERATIONS_MANAGER', 'USR-006': 'FIELD_ENGINEER' };

async function inspectionReady() {
  let seq = 0;
  let clock = Date.parse('2026-10-14T03:00:00.000Z');
  const service = new WorkflowService(new MemoryCaseStore(), { now: () => new Date((clock += 1000)).toISOString(), newId: (p) => `${p}-${++seq}`, roleOf: (id) => (ROLES[id] as never) ?? null, cv: DEMO_CV_PROVIDER });
  const { id, status, creatorAccountId, creatorRole, origin, createdAt, workflowState, caseVersion, ...content } = INITIAL_COMMUNITY_REPORTS[0];
  void id; void status; void creatorAccountId; void creatorRole; void origin; void createdAt; void workflowState; void caseVersion;
  let c = (await service.submitReport(content as never, CITIZEN, null) as { value: { id: string; version: number } }).value;
  for (const cmd of [{ action: 'REVIEW_ACCEPT', reason: 'Foto jelas.' }, { action: 'REQUEST_INSPECTION', reason: 'Prioritas', engineerId: ENG.id, dueAt: '2026-10-20T00:00:00.000Z', instructions: 'Foto 3 sisi.' }]) {
    c = (await service.transition(c.id, cmd as never, OPS, c.version) as { value: typeof c }).value;
  }
  return { service, c };
}
const base = { action: 'SUBMIT_INSPECTION', verdict: 'CONFIRMED', cvReview: { accepted: true, correctedClass: null }, measuredDepthCm: 6, measuredAreaM2: 1, severity: 'SEVERE', notes: 'Lubang di lajur kiri.' };

test('a guided inspection stores every angle and the tape measurements', async () => {
  const { service, c } = await inspectionReady();
  const views = ['OVERVIEW', 'TOP', 'SIDE'].map((angle) => ({ angle, photoUrl: PHOTO, takenAt: '2026-10-15T00:00:00Z', ai: null }));
  const r = await service.transition(c.id, { ...base, views, dimensions: { lengthCm: 120, widthCm: 80, depthCm: 6 } } as never, ENG, c.version);
  assert.equal(r.ok, true);
  const saved = (r as { value: { inspection: { views: InspectionView[]; dimensions: unknown } } }).value.inspection;
  assert.deepEqual(saved.views.map((v) => v.angle), ['OVERVIEW', 'TOP', 'SIDE']);
  assert.deepEqual(saved.dimensions, { lengthCm: 120, widthCm: 80, depthCm: 6 });
});

test('a guided inspection without the three required angles is rejected', async () => {
  const { service, c } = await inspectionReady();
  const r = await service.transition(c.id, { ...base, views: [{ angle: 'TOP', photoUrl: PHOTO, takenAt: 'x', ai: null }] } as never, ENG, c.version);
  assert.equal(r.ok, false);
});

test('an inspection without views still works (older clients)', async () => {
  const { service, c } = await inspectionReady();
  assert.equal((await service.transition(c.id, base as never, ENG, c.version)).ok, true);
});
