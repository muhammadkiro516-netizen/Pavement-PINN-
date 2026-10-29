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
  assert.equal(areaFromDimensions({ lengthCm: 120, widthCm: 80, depthCm: 6 }), 0.96);
  assert.equal(volumeFromDimensions({ lengthCm: 120, widthCm: 80, depthCm: 6 }), 0.058);
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

import { cleanMarks, combineMeasurements, measureFromMarks } from '../../src/domain/workflow/inspectionViews';

test('a photo measurement scales by the in-picture reference and corrects for aspect ratio', () => {
  // 4:3 photo; a 10 cm tape spans 0.1 of the width; the hole spans 0.6 of the width and 0.4 of the height.
  const m = { refCm: 10, ref: [[0.1, 0.5], [0.2, 0.5]] as [[number, number], [number, number]], aspect: 4 / 3, items: [{ what: 'LENGTH' as const, pts: [[0.2, 0.5], [0.8, 0.5]] as [[number, number], [number, number]] }, { what: 'WIDTH' as const, pts: [[0.5, 0.3], [0.5, 0.7]] as [[number, number], [number, number]] }] };
  const v = measureFromMarks(m);
  assert.equal(v.LENGTH, 60);
  assert.equal(v.WIDTH, 30);
});

test('depth measured on several angles is averaged and their spread reported', () => {
  const side = { marks: { refCm: 10, ref: [[0, 0], [0, 0.1]] as [[number, number], [number, number]], aspect: 1, items: [{ what: 'DEPTH' as const, pts: [[0.5, 0.2], [0.5, 0.27]] as [[number, number], [number, number]] }] } };
  const detail = { marks: { refCm: 10, ref: [[0, 0], [0, 0.2]] as [[number, number], [number, number]], aspect: 1, items: [{ what: 'DEPTH' as const, pts: [[0.5, 0.2], [0.5, 0.36]] as [[number, number], [number, number]] }] } };
  const c = combineMeasurements([side, detail, { marks: null }]);
  assert.deepEqual(c.DEPTH, { cm: 7.5, n: 2, spreadPct: 13, values: [7, 8] });
});

test('marks with out-of-range numbers are dropped on the server', () => {
  assert.equal(cleanMarks({ refCm: 10, ref: [[0, 0], [2, 0]], aspect: 1, items: [] }), null);
  assert.equal(cleanMarks({ refCm: -1, ref: [[0, 0], [1, 0]], aspect: 1, items: [] }), null);
  assert.deepEqual(cleanMarks({ refCm: 10, ref: [[0, 0], [1, 0]], aspect: 1, items: [{ what: 'DEPTH', pts: [[0, 0], [0, 1]] }, { what: 'HACK', pts: [[0, 0], [0, 1]] }] })?.items.map((i) => i.what), ['DEPTH']);
});
