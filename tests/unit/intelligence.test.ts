/**
 * P4/P5: ESAL, traffic-to-load, evidence fallbacks, assessment provenance, explanation,
 * What-If sanity checks and Road Story labelling (src/domain/intelligence).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeEsal, EsalInputError, loadEquivalencyFactor, STANDARD_AXLE_TON } from '../../src/domain/intelligence/esal';
import { estimateTrafficLoad, pavementBaseline, weatherEvidence, WimProvider, ILLUSTRATIVE_AXLE_SPECTRUM } from '../../src/domain/intelligence/evidence';
import { assessSegment, snapshotOf, translateSurfaceEvidence } from '../../src/domain/intelligence/assessment';
import { explainAssessment } from '../../src/domain/intelligence/explain';
import { runWhatIf } from '../../src/domain/intelligence/whatIf';
import { buildRoadStory } from '../../src/domain/intelligence/roadStory';
import { KARAWANG_PILOT_SEGMENTS } from '../../src/data/reference/karawangPilot';
import { INITIAL_COMMUNITY_REPORTS } from '../../src/data/mock/communityReports';
import type { ReportCase } from '../../src/domain/workflow/model';

const NOW = '2026-10-14T03:00:00.000Z';
const [KRW1, KRW2, , KRW4] = KARAWANG_PILOT_SEGMENTS;

test('pilot corridor: four canonical KRW segments, illustrative geometry, synthetic attributes, no WIM claimed', () => {
  assert.deepEqual(KARAWANG_PILOT_SEGMENTS.map((s) => s.id), ['KRW-001', 'KRW-002', 'KRW-003', 'KRW-004']);
  for (const s of KARAWANG_PILOT_SEGMENTS) {
    assert.equal(s.geometryStatus, 'ILLUSTRATIVE');
    assert.equal(s.attributeStatus, 'SYNTHETIC');
    assert.equal(s.hasWimStation, false);
    assert.match(s.corridor, /Klari/);
    assert.doesNotMatch(s.name + s.corridor, /Cikarang/);
  }
  assert.deepEqual(KARAWANG_PILOT_SEGMENTS.map((s) => s.conditionCategory), ['HEAVY_DAMAGE', 'LIGHT_DAMAGE', 'MODERATE', 'GOOD']);
});

test('ESAL: fourth-power law, standard axle = 1, additive over groups, validated inputs', () => {
  assert.equal(loadEquivalencyFactor(STANDARD_AXLE_TON), 1);
  assert.ok(Math.abs(loadEquivalencyFactor(2 * STANDARD_AXLE_TON) - 16) < 1e-9);
  assert.equal(loadEquivalencyFactor(0), 0);
  const r = computeEsal([{ axleLoadTon: STANDARD_AXLE_TON, passes: 100 }, { axleLoadTon: 2 * STANDARD_AXLE_TON, passes: 10 }]);
  assert.ok(Math.abs(r.esal - 260) < 1e-6);
  assert.match(r.explanation, /Σ n × \(P\/8.16 t\)\^4/);
  assert.equal(computeEsal([]).esal, 0);
  assert.throws(() => loadEquivalencyFactor(-1), EsalInputError);
  assert.throws(() => loadEquivalencyFactor(Number.NaN), EsalInputError);
  assert.throws(() => loadEquivalencyFactor(80), EsalInputError);
  assert.throws(() => computeEsal([{ axleLoadTon: 8, passes: -3 }]), EsalInputError);
});

test('traffic-to-load without WIM: inferred, ranged, labelled WIM DATA NOT AVAILABLE, never a measurement', () => {
  const t = estimateTrafficLoad(KRW1);
  assert.equal(t.wim.status, 'WIM_NOT_AVAILABLE');
  assert.match(t.wim.message, /not available/);
  assert.equal(t.heavyVehiclesPerDay.dataStatus, 'INFERRED');
  assert.ok(t.heavyVehiclesPerDay.low < t.heavyVehiclesPerDay.central && t.heavyVehiclesPerDay.central < t.heavyVehiclesPerDay.high);
  assert.ok(t.dailyEsal.low < t.dailyEsal.central && t.dailyEsal.central < t.dailyEsal.high);
  assert.deepEqual(t.axleSpectrum, ILLUSTRATIVE_AXLE_SPECTRUM);
  assert.ok(Math.abs(ILLUSTRATIVE_AXLE_SPECTRUM.reduce((a, s) => a + s.share, 0) - 1) < 1e-9);
  assert.equal(t.dailyVehicles.dataStatus, 'SYNTHETIC');
});

test('traffic-to-load with WIM observations narrows the range and uses the observed spectrum', () => {
  const wim: WimProvider = { status: 'OBSERVED', observationsFor: () => [{ stationId: 'X', observedAt: NOW, axleLoadsTon: [6, 7, 12, 19], source: 'test feed' }] };
  const withWim = estimateTrafficLoad(KRW1, wim);
  const without = estimateTrafficLoad(KRW1);
  assert.equal(withWim.wim.status, 'OBSERVED');
  const relWidth = (r: { low: number; high: number; central: number }) => (r.high - r.low) / r.central;
  assert.ok(relWidth(withWim.dailyEsal) < relWidth(without.dailyEsal));
  assert.notDeepEqual(withWim.axleSpectrum, ILLUSTRATIVE_AXLE_SPECTRUM);
});

test('weather and baseline fallbacks are labelled DEMO / SYNTHETIC REFERENCE BASELINE', () => {
  const w = weatherEvidence(KRW1, NOW);
  assert.equal(w.dataStatus, 'DEMO');
  assert.equal(w.confidence, 'LOW');
  const unavailable = weatherEvidence(KRW1, NOW, { status: 'UNAVAILABLE', source: 'none', latestFor: () => null });
  assert.equal(unavailable.value, null);
  assert.match(unavailable.note, /unavailable/);
  const b = pavementBaseline(KRW2);
  assert.equal(b.dataStatus, 'SYNTHETIC');
  assert.match(b.source, /REFERENCE BASELINE/);
});

test('segment risk comes from observed evidence only: no formula engine, no strains, validation required', () => {
  const a = assessSegment(KRW1, { now: NOW });
  assert.equal(a.engine, 'EVIDENCE');
  assert.equal(a.dataStatus, 'OBSERVED');
  assert.equal(a.outputs.tensileStrainMicro, null, 'strains come only from the PINN / MLET service');
  assert.equal(a.physicsResidual, null);
  assert.equal(a.validationStatus, 'VALIDATION_REQUIRED');
  assert.equal(a.risk, 'GOOD', 'no reports -> no evidence of damage');
  assert.equal(snapshotOf(a).engine, 'EVIDENCE');
  assert.equal(assessSegment(KRW1, { now: NOW }).id, a.id);
});

test('a confirmed CRITICAL inspection raises the risk; evidence never lowers it', () => {
  const base = assessSegment(KRW4, { now: NOW });
  const critical = { segmentId: 'KRW-004', state: 'INSPECTED', inspection: { verdict: 'CONFIRMED', severity: 'CRITICAL' } } as unknown as ReportCase;
  const raised = assessSegment(KRW4, { now: NOW, cases: [critical] });
  assert.equal(raised.risk, 'HIGH');
  assert.ok(raised.riskReasons.some((r) => /KRITIS/.test(r)));
  assert.ok(raised.outputs.conditionScorePrototype < base.outputs.conditionScorePrototype, 'confirmed damage lowers the evidence score');
});

test('explanation answers what/why/evidence/confidence/next with qualitative levels only', () => {
  const a = assessSegment(KRW1, { now: NOW });
  const e = explainAssessment(a, []);
  assert.equal(e.source, 'DETERMINISTIC_RULES');
  assert.ok(e.what.startsWith('KRW-001'));
  for (const f of e.why) assert.ok(['HIGH', 'MEDIUM', 'LOW', 'UNCERTAIN'].includes(f.level));
  assert.doesNotMatch(JSON.stringify(e.why), /\d+(\.\d+)?%\s*(kontribusi|contribution)/i);
  assert.equal(e.why.find((f) => /Riwayat/.test(f.factor))?.level, 'UNCERTAIN');
  assert.ok(e.next.length > 0);
  for (const n of e.next) assert.doesNotMatch(n, /otomatis (menilang|memblokir)|automatically/i);
});

test('CV → engineering translation stops at a surface indicator: CALIBRATION REQUIRED', () => {
  const report = INITIAL_COMMUNITY_REPORTS[0];
  const t = translateSurfaceEvidence(report);
  assert.equal(t.translation.status, 'CALIBRATION_REQUIRED');
  assert.match(t.note, /CALIBRATION REQUIRED/);
  assert.equal('modulus' in t, false);
});

test('Road Story separates OBSERVED, PREDICTED, SIMULATED and DECISION; public view hides staff notes', () => {
  const c = {
    id: 'REP-1',
    segmentId: 'KRW-001',
    createdAt: '2026-10-01T00:00:00Z',
    dataStatus: 'USER_GENERATED',
    report: { damageTypeLabel: 'Pothole', severity: 'SEVERE' },
    inspection: { inspectedAt: '2026-10-03T00:00:00Z', verdict: 'CONFIRMED', severity: 'SEVERE', notes: 'catatan internal' },
    recommendation: { recommendedAt: '2026-10-04T00:00:00Z', treatment: 'Patching', urgency: 'PRIORITY' },
    approvals: [{ decidedAt: '2026-10-05T00:00:00Z', decision: 'APPROVED', reason: 'alasan internal' }],
    workOrder: null,
    history: []
  } as unknown as ReportCase;
  const a = assessSegment(KRW1, { now: '2026-10-06T00:00:00Z' });
  const story = buildRoadStory('KRW-001', [c], [a], [{ at: '2026-10-07T00:00:00Z', summary: 'thicker' }], 'PUBLIC');
  assert.deepEqual([...new Set(story.map((s) => s.kind))].sort(), ['DECISION', 'OBSERVED', 'PREDICTED', 'SIMULATED']);
  assert.doesNotMatch(JSON.stringify(story), /catatan internal|alasan internal/);
  assert.ok(Date.parse(story[0].at) >= Date.parse(story[story.length - 1].at), 'newest first');
  const staff = buildRoadStory('KRW-001', [c], [], [], 'STAFF');
  assert.match(JSON.stringify(staff), /catatan internal/);
});
