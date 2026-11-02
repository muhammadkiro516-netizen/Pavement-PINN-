import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SAME_PHOTO_PCT, cosine } from '../../server/v6/insights';
import { NEAR_M, nearestPlaces } from '../../server/v6/poi';
import { borrowedPriceNote } from '../../server/v6/priceBook';
import poi from '../../config/v6/poi_near.json';

test('photo similarity: same direction is 100, opposite is not a match', () => {
  assert.equal(Math.round(cosine([1, 0, 1], [2, 0, 2]) * 100), 100);
  assert.ok(cosine([1, 0], [0, 1]) * 100 < SAME_PHOTO_PCT);
  assert.equal(cosine([0, 0], [1, 1]), 0);
});

test('schools and hospitals count only within 300 m, and the name comes from the map', () => {
  const school = poi.schools[0];
  const at = nearestPlaces(school.lat, school.lon);
  assert.equal(at.school?.distanceM, 0);
  assert.equal(at.school?.name, school.name);
  assert.equal(nearestPlaces(school.lat + (NEAR_M * 40) / 111_320, school.lon + 3).school, null);
  assert.ok(poi.schools.length > 100, 'the extract is not empty');
  assert.ok(poi.hospitals.length > 10);
});

test('a region with its own prices is not told it has none: the note names only the borrowed option', () => {
  const own = { label: 'Tambal aspal panas', price: { how: 'SAME_REGION' } };
  const borrowed = { label: 'Beton cepat kering', price: { how: 'OTHER_REGION_IKK' } };
  const missing = { label: 'Tambal aspal dingin', price: null };
  assert.equal(borrowedPriceNote([own, missing]), '');
  const mixed = borrowedPriceNote([own, borrowed, missing]);
  assert.match(mixed, /Harga Beton cepat kering hanya perkiraan/);
  assert.doesNotMatch(mixed, /belum tersedia/);
  assert.doesNotMatch(mixed, /Tambal aspal panas/);
  assert.match(borrowedPriceNote([borrowed, missing]), /Harga resmi wilayah ini belum tersedia/);
});
