import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlyRain, WET_MONTH_MM } from '../../server/services/weather';

test('daily rain is summed per month and months >= 200 mm count as wet (Oldeman)', () => {
  const dates = ['2026-01-01', '2026-01-02', '2026-02-01', '2026-03-05'];
  const r = monthlyRain(dates, [150, 60, 40, null]);
  assert.deepEqual(r.monthly, [{ month: '2026-01', mm: 210 }, { month: '2026-02', mm: 40 }, { month: '2026-03', mm: 0 }]);
  assert.equal(r.wetMonths, 1);
  assert.equal(r.annualMm, 250);
  assert.equal(WET_MONTH_MM, 200);
});
