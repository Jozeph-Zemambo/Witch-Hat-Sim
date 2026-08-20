import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pointerDirectionFromCenter,
  pointerProjection,
} from '../src/spell-maker/resizeInteraction.js';

test('spell maker resize keeps the pressed corner direction after crossing the center', () => {
  const bounds = { left: 80, top: 80, width: 40, height: 40 };
  const pressedCorner = { x: 100 + 20, y: 100 - 20 };
  const oppositeSide = { x: 100 - 28, y: 100 + 28 };
  const direction = pointerDirectionFromCenter(pressedCorner.x, pressedCorner.y, bounds);

  assert.ok(direction);
  assert.ok(pointerProjection(pressedCorner.x, pressedCorner.y, bounds, direction) > 0);
  assert.ok(pointerProjection(oppositeSide.x, oppositeSide.y, bounds, direction) < 0);
});
