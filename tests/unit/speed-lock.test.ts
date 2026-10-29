/** SPEC 0.6 / M1.4: the report camera locks above 10 km/h; unknown speed does not lock. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocked, speedFromFixes, SPEED_LIMIT_KMH } from '../../src/features/location/speedLock';

test('speed from two GPS fixes and the 10 km/h lock', () => {
  const a = { lat: -6.2, lng: 106.8, t: 0 };
  const walking = speedFromFixes(a, { lat: -6.2 + 0.0000135, lng: 106.8, t: 1000 })!; // ~1.5 m in 1 s
  const riding = speedFromFixes(a, { lat: -6.2 + 0.0000899, lng: 106.8, t: 1000 })!; // ~10 m in 1 s = 36 km/h
  assert.ok(walking < 6 && riding > 30, `${walking} ${riding}`);
  assert.equal(isLocked(walking), false);
  assert.equal(isLocked(riding), true);
  assert.equal(isLocked(null), false, 'unknown speed (no GPS) never locks the camera');
  assert.equal(isLocked(SPEED_LIMIT_KMH), false);
  assert.equal(speedFromFixes(a, { ...a, t: 200 }), null, 'fixes too close in time are not used');
});
