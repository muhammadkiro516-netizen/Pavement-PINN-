/** SPEC M9: Radar Bahaya warns only near verified, open hazards; weight rises with water, night, no sign. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { alertPattern, hazardsNear, type RadarCase } from '../../src/features/location/hazardRadar';

const at: [number, number] = [-6.2, 106.8];
const mk = (id: string, state: string, dLat: number, extra: Record<string, unknown> = {}): RadarCase =>
  ({ id, state, report: { coordinates: [at[0] + dLat, at[1]], severity: 'SEVERE', damageTypeLabel: 'Lubang', cvAssessment: null }, ...extra }) as RadarCase;

test('only verified open hazards within 150 m, heaviest first', () => {
  const day = new Date('2026-10-29T10:00:00');
  const cases = [
    mk('near', 'VERIFIED', 0.0005), // ~55 m
    mk('unverified', 'NEEDS_REVIEW', 0.0002),
    mk('fixed', 'CLOSED', 0.0002),
    mk('far', 'VERIFIED', 0.01),
    mk('signed', 'IN_PROGRESS', 0.001, { hazard: { at: 'x' } }) // ~110 m, sign present
  ];
  const hits = hazardsNear(cases, at, day);
  assert.deepEqual(hits.map((h) => h.id), ['near', 'signed']);
  assert.ok(hits[0].reasons.includes('belum ada rambu'));
  const night = hazardsNear([{ ...mk('w', 'VERIFIED', 0.0003), report: { ...mk('w', 'VERIFIED', 0.0003).report, cvAssessment: { hazards: ['GENANGAN'] } } }], at, new Date('2026-10-29T21:00:00'));
  assert.equal(night[0].weight, 5);
  assert.ok(alertPattern(5).length > alertPattern(1).length);
});
