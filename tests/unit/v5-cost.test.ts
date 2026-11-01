import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fairCost, type CostRequest } from '../../src/domain/v5/costEngine';

const pothole: CostRequest = { caseId: 'C', mode: 'SINGLE', mix: 'AC_WC', lengthM: 0.8, widthM: 0.6, depthCm: 7, sizeStatus: 'MEASURED', sizeSource: 'marker card', regionName: 'DKI Jakarta', regionIsJakarta: true };
const strip: CostRequest = { caseId: 'C', mode: 'TRACE', mix: 'AC_WC', lengthM: 62, widthM: 3.5, depthCm: 3.5, sizeStatus: 'MEASURED', sizeSource: 'GPS trace', regionName: 'DKI Jakarta', regionIsJakarta: true };

test('worked example 8.1 reproduces exactly: one Jakarta pothole', () => {
  const r = fairCost(pothole);
  assert.deepEqual(r.fairCostIdr, { low: 388993, mid: 434904, high: 506904 });
  assert.equal(r.quantity.areaCutM2.mid, 1.68);
  assert.equal(r.quantity.qPay.mid, 0.1176);
  assert.deepEqual(r.quantity.tons, { low: 0.2646, mid: 0.2699, high: 0.2752 });
  const line = (id: string) => r.lines.find((l) => l.id === id)!.idr;
  assert.deepEqual(line('hotmix'), { low: 330483, mid: 371844, high: 435802 });
  assert.deepEqual(line('cutout'), { low: 19961, mid: 19961, high: 20868 });
  assert.deepEqual(line('ppn'), { low: 38549, mid: 43099, high: 50234 });
  assert.equal(line('tack'), null);
});

test('worked example 8.2 reproduces exactly: long damage strip, minimum thickness governs', () => {
  const r = fairCost(strip);
  assert.equal(r.quantity.depthRepairCm, 4);
  assert.equal(r.quantity.areaCutM2.mid, 219.1);
  assert.equal(r.quantity.qPay.mid, 8.764);
  assert.deepEqual(r.fairCostIdr, { low: 28989249, mid: 32410687, high: 37776424 });
  assert.deepEqual(r.lines.find((l) => l.id === 'hotmix')!.idr, { low: 24628862, mid: 27711238, high: 32477618 });
});

test('comparison examples from 06 §8: within, and needs clarification, in both directions', () => {
  const within = fairCost({ ...pothole, reportedSpendIdr: 480000 }).comparison!;
  assert.equal(within.diffPct, 10.4);
  assert.equal(within.result, 'WITHIN_RANGE');
  const above = fairCost({ ...pothole, reportedSpendIdr: 1200000 }).comparison!;
  assert.equal(above.diffPct, 175.9);
  assert.equal(above.result, 'NEEDS_CLARIFICATION');
  assert.equal(above.label_en, 'Indicative difference — needs clarification');
  assert.equal(fairCost({ ...strip, reportedSpendIdr: 36000000 }).comparison!.diffPct, 11.1);
  const below = fairCost({ ...strip, reportedSpendIdr: 9500000 }).comparison!;
  assert.equal(below.diffPct, -70.7);
  assert.equal(below.result, 'NEEDS_CLARIFICATION');
});

test('every input has a status and a source; excluded lines are named; the result is indicative', () => {
  const r = fairCost(pothole);
  for (const i of r.inputs) {
    assert.ok(i.status, i.key);
    assert.ok(i.source, i.key);
  }
  assert.equal(r.basis, 'INDICATIVE');
  assert.equal(r.completeness.complete, false);
  assert.ok(r.completeness.excluded.includes('7.1.(2a) tack coat'));
  assert.ok(r.inputs.find((i) => i.key === 'ohp')!.status === 'OFFICIAL');
});

test('a mix with no sourced price gives no number, and says why', () => {
  const r = fairCost({ ...pothole, mix: 'COLD_MIX', reportedSpendIdr: 500000 });
  assert.equal(r.fairCostIdr, null);
  assert.equal(r.comparison, null);
  assert.match(r.label, /TODO_VERIFY/);
});

test('outside Jakarta the stand-in prices are declared', () => {
  const r = fairCost({ ...pothole, regionName: 'Kabupaten Karawang', regionIsJakarta: false });
  assert.ok(r.warnings.some((w) => w.includes('Karawang') && w.includes('TODO_VERIFY')));
});

test('a size band widens the range and says the size was not measured', () => {
  const r = fairCost({ ...pothole, lengthM: { low: 0.32, mid: 0.8, high: 1.0 }, widthM: { low: 0.32, mid: 0.6, high: 1.0 }, sizeStatus: 'AI_ESTIMATE' });
  assert.ok(r.fairCostIdr!.low < 388993 && r.fairCostIdr!.high > 506904);
  assert.ok(r.warnings.some((w) => w.includes('not measured on site')));
});

test('prices match the sourced data file', () => {
  const csv = readFileSync('docs/v5/data/material_prices.csv', 'utf8');
  for (const value of ['1254346.42', '1381217', '1248991.42', '169737.46', '9400', '11565']) assert.ok(csv.includes(value), value);
});
