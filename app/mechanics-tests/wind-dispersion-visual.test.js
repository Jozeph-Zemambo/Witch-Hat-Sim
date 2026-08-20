import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WIND_DISPERSION_LAB_REACH,
  WIND_DISPERSION_LAB_STREAK_COUNT,
  windDispersionStreakMetrics,
  windDispersionStreakTheta,
} from '../src/scene/windDispersionConfig.js';
import { placedSpellDispersionClearanceRadius } from '../../src/simulation-engine/index.js';

test('wind dispersion uses the lab as the exact streak-density baseline', () => {
  assert.deepEqual(windDispersionStreakMetrics(WIND_DISPERSION_LAB_REACH), {
    count: WIND_DISPERSION_LAB_STREAK_COUNT,
    reachScale: 1,
    sizeScale: 1,
    countAuthority: 'effective_canopy_circumference',
    sizeAuthority: 'gentle_fourth_root_of_canopy_scale',
  });
});

test('wind dispersion count scales much more than individual streak size', () => {
  const small = windDispersionStreakMetrics(WIND_DISPERSION_LAB_REACH * 0.25);
  const large = windDispersionStreakMetrics(WIND_DISPERSION_LAB_REACH * 4);

  assert.equal(small.count, 5);
  assert.equal(large.count, 80);
  assert.ok(small.sizeScale >= 0.7 && small.sizeScale < 0.75);
  assert.ok(large.sizeScale > 1.4 && large.sizeScale <= 1.5);
  assert.equal(large.count / small.count, 16);
  assert.ok(large.sizeScale / small.sizeScale < 2.2);
});

test('wind dispersion retains a sparse readable minimum for extremely small effects', () => {
  const tiny = windDispersionStreakMetrics(WIND_DISPERSION_LAB_REACH * 0.02);
  assert.equal(tiny.count, 3);
  assert.equal(tiny.sizeScale, 0.7);
});

test('the smallest ordinary placed spell uses six restrained streaks instead of the lab twenty', () => {
  const placed = windDispersionStreakMetrics(placedSpellDispersionClearanceRadius(0.25));
  assert.equal(placed.count, 6);
  assert.ok(placed.sizeScale > 0.73 && placed.sizeScale < 0.74);
});

test('a downscaled wind dispersion redistributes its surviving streaks around the full circle', () => {
  const activeCount = 6;
  const angles = Array.from(
    { length: activeCount },
    (_, index) => windDispersionStreakTheta(index, activeCount),
  );
  const occupiedQuadrants = new Set(angles.map((angle) => {
    const normalized = (angle + Math.PI * 2) % (Math.PI * 2);
    return Math.floor(normalized / (Math.PI / 2));
  }));

  assert.deepEqual([...occupiedQuadrants].sort(), [0, 1, 2, 3]);
  assert.ok(angles.at(-1) > Math.PI * 1.5, 'the final live streak must not remain in the old large-count wedge');
});
