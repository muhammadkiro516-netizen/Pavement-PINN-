import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaAlerts, distanceToLineM, hazardsAlongRoute, rankRoutes, type HazardCase } from '../../src/domain/routing/safeRoute';

const c = (id: string, state: string, at: [number, number], extra: Partial<HazardCase['report']> = {}, updatedAt = '2026-10-20T00:00:00Z'): HazardCase => ({
  id,
  state,
  updatedAt,
  report: { coordinates: at, damageTypeLabel: 'Lubang', severity: 'MODERATE', ...extra }
});

// A straight east-west road at lat -6.2 and a parallel one ~1.1 km north.
const south: Array<[number, number]> = [[-6.2, 106.8], [-6.2, 106.82]];
const north: Array<[number, number]> = [[-6.19, 106.8], [-6.19, 106.82]];

test('distance to a line is measured to the nearest segment', () => {
  assert.ok(distanceToLineM([-6.2, 106.81], south) < 1);
  const d = distanceToLineM([-6.1998, 106.81], south);
  assert.ok(d > 15 && d < 30, `got ${d}`);
});

test('only verified, open hazards within the buffer count', () => {
  const cases = [c('a', 'VERIFIED', [-6.2001, 106.81]), c('b', 'NEEDS_REVIEW', [-6.2, 106.811]), c('d', 'COMPLETED', [-6.2, 106.812]), c('e', 'VERIFIED', [-6.195, 106.81])];
  assert.deepEqual(hazardsAlongRoute(cases, south).map((h) => h.id), ['a']);
});

test('the route with fewer weighted hazards is recommended, even if slower', () => {
  const cases = [c('a', 'VERIFIED', [-6.2, 106.81], { damageType: 'FLOODING', severity: 'SEVERE' })];
  const r = rankRoutes(cases, [{ distanceM: 2000, durationS: 300, line: south }, { distanceM: 2400, durationS: 360, line: north }]);
  assert.equal(r[0].score, 4);
  assert.equal(r[1].score, 0);
  assert.equal(r[1].recommended, true);
  assert.equal(r[0].recommended, false);
});

test('ties go to the faster route', () => {
  const r = rankRoutes([], [{ distanceM: 2400, durationS: 360, line: north }, { distanceM: 2000, durationS: 300, line: south }]);
  assert.equal(r[1].recommended, true);
});

test('area alerts list hazards and repairs inside the radius and flag the new ones', () => {
  const cases = [c('a', 'VERIFIED', [-6.2, 106.8], {}, '2026-10-25T00:00:00Z'), c('b', 'COMPLETED', [-6.2005, 106.8], {}, '2026-10-10T00:00:00Z'), c('far', 'VERIFIED', [-6.3, 106.8])];
  const alerts = areaAlerts(cases, [{ id: 'home', name: 'Rumah', center: [-6.2, 106.8], radiusM: 500 }], '2026-10-15T00:00:00Z');
  assert.deepEqual(alerts.map((a) => [a.caseId, a.kind, a.fresh]), [['a', 'HAZARD', true], ['b', 'REPAIRED', false]]);
});
