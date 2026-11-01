import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RoadRegistry, parseCsv } from '../../server/v5/routing';

const real = new RoadRegistry();
const snapshot = JSON.parse(fs.readFileSync('config/v5/roads_snapshot.json', 'utf8')) as { roads: { id: string; name: string | null; highway: string; toll: boolean; pts: [number, number][] }[] };
const mid = (r: { pts: [number, number][] }) => r.pts[Math.floor(r.pts.length / 2)];
const inJakarta = ([lat, lon]: [number, number]) => lat > -6.3 && lat < -6.12 && lon > 106.74 && lon < 106.95;
// The box is rough, so the admin polygon decides: Tangerang Selatan roads inside it are not DKI.
const pick = (match: (r: (typeof snapshot.roads)[number]) => boolean, n: number) => snapshot.roads.filter((r) => match(r) && inJakarta(mid(r)) && real.decide(mid(r)[0], mid(r)[1], 8).area.region === 'jakarta').slice(0, n);
const KOTA: [string, number, number, string][] = [
  ['Jakarta Pusat, Monas', -6.1754, 106.8272, 'jakpus'],
  ['Jakarta Utara, Tanjung Priok', -6.1215, 106.8775, 'jakut'],
  ['Jakarta Barat, Grogol', -6.1671, 106.7898, 'jakbar'],
  ['Jakarta Selatan, Blok M', -6.2442, 106.7983, 'jaksel'],
  ['Jakarta Timur, Matraman', -6.2006, 106.8574, 'jaktim']
];

test('the snapshot covers Jakarta and Karawang roads and areas', () => {
  assert.ok(real.available);
  assert.ok(pick((r) => r.toll, 1).length > 0, 'toll roads');
  assert.ok(pick((r) => r.highway.startsWith('primary'), 1).length > 0, 'primary roads');
});

for (const [name, lat, lon, slug] of KOTA) {
  test(`Jakarta area: ${name} routes to its own Suku Dinas chain`, () => {
    const d = real.decide(lat, lon, 8);
    assert.equal(d.area.region, 'jakarta');
    assert.ok(d.officeChain.some((id) => id === `sudin-bm-${slug}`), JSON.stringify(d.officeChain));
    assert.ok(d.officeChain.includes('dbm-dki'));
    assert.equal(d.authorityId === 'pemprov-dki' || d.status === 'TOL', true);
  });
}

for (const road of pick((r) => r.toll || r.highway.startsWith('motorway'), 8)) {
  test(`Jakarta toll: ${road.name ?? road.id} goes to the operator with BPJT watching`, () => {
    const [lat, lon] = mid(road);
    const d = real.decide(lat, lon, 8, 'yes');
    assert.equal(d.status, 'TOL');
    assert.ok(d.watcherIds.includes('bpjt'));
    assert.ok(d.confidence === 'HIGH' || d.confidence === 'MEDIUM');
  });
}

for (const road of pick((r) => !r.toll && r.highway.startsWith('trunk'), 4)) {
  test(`Jakarta trunk: ${road.name ?? road.id} is LOW, the coordinator checks the national list`, () => {
    const [lat, lon] = mid(road);
    const d = real.decide(lat, lon, 8, 'no');
    assert.equal(d.status, 'PROVINSI');
    assert.equal(d.confidence, 'LOW');
    assert.match(d.coordinatorPrompt ?? '', /Kepmen PUPR 1688/);
    assert.ok(d.ruleIds.includes('DKI-TRUNK-NO-SK'));
  });
}

for (const road of pick((r) => !r.toll && /^(primary|secondary)/.test(r.highway), 10)) {
  test(`Jakarta provincial: ${road.name ?? road.id} is the regional default, never HIGH`, () => {
    const [lat, lon] = mid(road);
    const d = real.decide(lat, lon, 8, 'no');
    if (d.ruleIds.includes('DKI-TRUNK-NO-SK') || d.status === 'TOL') return; // A trunk or toll road runs alongside.
    assert.equal(d.status, 'PROVINSI');
    assert.equal(d.confidence, 'MEDIUM');
    assert.equal(d.source, 'regional_open_data');
    assert.ok(d.officeId.startsWith('satpel-bm-') || d.officeId.startsWith('sudin-bm-'), d.officeId);
  });
}

test('a Jakarta side street not in the registry falls back to the area, LOW, coordinator confirms', () => {
  const d = real.decide(-6.2, 106.86, 8);
  const quiet = [[-6.2301, 106.8455], [-6.1902, 106.8123], [-6.2751, 106.8602], [-6.1404, 106.7804]].map(([a, b]) => real.decide(a, b, 8)).find((x) => x.segment === null);
  assert.ok(d);
  assert.ok(quiet, 'at least one sample has no major road within 25 m');
  assert.equal(quiet!.confidence, 'LOW');
  assert.equal(quiet!.source, 'admin_default');
  assert.equal(quiet!.status, 'PROVINSI');
  assert.match(quiet!.coordinatorPrompt ?? '', /Confirm/);
});

test('Karawang: a regency road off the map is LOW with Dinas PUPR; outside the pilot goes to SP4N-LAPOR!', () => {
  const offRoad = real.decide(-6.3, 107.4, 8);
  assert.equal(offRoad.area.region, 'karawang');
  assert.equal(offRoad.confidence, 'LOW');
  assert.equal(offRoad.officeId, 'dpupr-karawang');
  const outside = real.decide(-6.99, 110.42, 8);
  assert.equal(outside.status, 'UNKNOWN');
  assert.equal(outside.officeId, 'sp4n-lapor');
  assert.equal(outside.confidence, 'LOW');
});

test('map layer: GeoJSON with status and confidence, capped, and credits OSM', () => {
  const layer = real.segmentsInBox(-6.22, 106.84, -6.18, 106.88);
  assert.ok(layer.features.length > 0);
  assert.match(layer.attribution, /OpenStreetMap/);
  for (const f of layer.features as { properties: { status: string; confidence: string } }[]) {
    assert.ok(f.properties.status);
    assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(f.properties.confidence));
  }
  assert.ok(real.segmentsInBox(-6.4, 106.6, -6.0, 107.1, 50).features.length <= 50);
});

// Logic cases on a small fixture, so they do not depend on where OSM roads happen to run.
function fixture(): RoadRegistry {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v5-route-'));
  fs.mkdirSync(path.join(root, 'config', 'v5'), { recursive: true });
  fs.cpSync('docs/v5/data', path.join(root, 'docs', 'v5', 'data'), { recursive: true });
  const box: [number, number][] = [[-6.3, 106.8], [-6.3, 106.9], [-6.1, 106.9], [-6.1, 106.8], [-6.3, 106.8]];
  fs.writeFileSync(path.join(root, 'config', 'v5', 'roads_snapshot.json'), JSON.stringify({
    builtOn: 'fixture',
    roads: [
      { id: 'osm-toll', name: 'Tol Fixture', highway: 'motorway', toll: true, ref: null, operator: null, pts: [[-6.2, 106.85], [-6.19, 106.85]] },
      { id: 'osm-road', name: 'Jl. Fixture', highway: 'primary', toll: false, ref: null, operator: null, pts: [[-6.2, 106.85002], [-6.19, 106.85002]] }
    ],
    admin: [{ name: 'Jakarta Timur', level: 5, region: 'jakarta', rings: [box] }]
  }));
  return new RoadRegistry(root);
}

test('toll over an arterial: the citizen is asked; the answer decides; confidence is capped', () => {
  const r = fixture();
  const asked = r.decide(-6.195, 106.85001, 8);
  assert.equal(asked.askCitizen, 'Are you on the toll road?');
  assert.ok(asked.ruleIds.includes('CAP-AMBIGUOUS'));
  const yes = r.decide(-6.195, 106.85001, 8, 'yes');
  assert.equal(yes.status, 'TOL');
  assert.notEqual(yes.confidence, 'HIGH');
  const no = r.decide(-6.195, 106.85001, 8, 'no');
  assert.equal(no.status, 'PROVINSI');
  assert.equal(no.segment?.id, 'osm-road');
});

test('poor GPS caps confidence and widens the snap only up to 50 m', () => {
  const r = fixture();
  const near = r.decide(-6.195, 106.8503, 40, 'no');
  assert.ok(near.ruleIds.includes('CAP-GPS-ACCURACY'));
  assert.ok(near.segment, '30 m away is inside a 40 m GPS radius');
  const tight = r.decide(-6.195, 106.8503, 8);
  assert.equal(tight.segment, null, '30 m away is outside the 25 m snap');
  const far = r.decide(-6.195, 106.8509, 400);
  assert.equal(far.segment, null, 'the radius stops at 50 m whatever the GPS says');
});

test('CSV parser keeps commas inside quotes', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y",2\n'), [{ a: 'x, y', b: '2' }]);
});
