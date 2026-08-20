import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GLYPH_PLANE_ROTATION_X,
  canonicalGlyphVectorToScene,
  glyphSceneCenter,
  glyphSceneRotationY,
} from '../src/glyphs/threeGlyphTransform.js';

const SIGN_IDS = ['sign.column', 'sign.dispersion', 'sign.levitation'];
const DIRECTIONS = [
  { x: -1, y: 0 },
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
];

test('placed glyph plane uses the same +Y to -Z mapping as spell layout positions', () => {
  assert.equal(GLYPH_PLANE_ROTATION_X, -Math.PI / 2);
  assert.deepEqual(glyphSceneCenter(2, 5, 0.1), [0.2, 0.066, -0.5]);
});

test('every native sign points its canonical +Y axis along its compiled scene direction', () => {
  for (const glyphId of SIGN_IDS) {
    for (const direction of DIRECTIONS) {
      const rotationY = glyphSceneRotationY('sign', direction);
      const inward = canonicalGlyphVectorToScene({ x: 0, y: 1 }, rotationY);
      const tangent = canonicalGlyphVectorToScene({ x: 1, y: 0 }, rotationY);

      assert.ok(Math.abs(inward.x - direction.x) < 1e-12, `${glyphId} inward X`);
      assert.ok(Math.abs(inward.z + direction.y) < 1e-12, `${glyphId} inward Z`);
      assert.ok(Math.abs(inward.x * tangent.x + inward.z * tangent.z) < 1e-12, `${glyphId} orthogonal axes`);
    }
  }
});

test('center sigils share the corrected authoring-plane handedness', () => {
  const rotationY = glyphSceneRotationY('sigil', null, 0);
  assert.deepEqual(canonicalGlyphVectorToScene({ x: 0, y: 1 }, rotationY), { x: 0, z: -1 });
});
