/** Live camera overlay: frame boxes land on the right pixels of an object-cover video. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { frameSize, mapBoxToScreen } from '../../src/features/community-reports/liveDetection';

test('frame size keeps the aspect ratio and the long side at 640 (480 on low data)', () => {
  assert.deepEqual(frameSize(1920, 1080, false), { w: 640, h: 360 });
  assert.deepEqual(frameSize(1080, 1920, true), { w: 270, h: 480 });
  assert.deepEqual(frameSize(320, 240, false), { w: 320, h: 240 });
});

test('a landscape video covering a portrait screen: centre crop maps boxes correctly', () => {
  // 1920x1080 video in a 390x844 container: scale = 844/1080, horizontal overflow cropped.
  const s = 844 / 1080;
  const ox = (390 - 1920 * s) / 2;
  const r = mapBoxToScreen([320, 180, 330, 190], { w: 640, h: 360 }, { w: 1920, h: 1080 }, { w: 390, h: 844 });
  assert.ok(Math.abs(r.left - (ox + 960 * s)) < 1e-6);
  assert.ok(Math.abs(r.top - 540 * s) < 1e-6);
  assert.ok(Math.abs(r.width - 30 * s) < 1e-6);
});

test('same aspect: the frame maps 1:1 after scaling', () => {
  const r = mapBoxToScreen([0, 0, 640, 360], { w: 640, h: 360 }, { w: 1280, h: 720 }, { w: 640, h: 360 });
  assert.deepEqual(r, { left: 0, top: 0, width: 640, height: 360 });
});
