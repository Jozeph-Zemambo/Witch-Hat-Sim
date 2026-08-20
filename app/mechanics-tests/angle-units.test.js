import test from 'node:test';
import assert from 'node:assert/strict';
import {
  degreesToRadians,
  formatDegrees,
  radiansToDegrees,
} from '../src/mechanics-ui/angleUnits.js';

test('mechanics angle units convert between degree UI values and radian physics values', () => {
  assert.ok(Math.abs(degreesToRadians(180) - Math.PI) < 1e-12);
  assert.ok(Math.abs(radiansToDegrees(Math.PI / 2) - 90) < 1e-12);
  assert.equal(formatDegrees(-1.12), '-64.2°');
});
