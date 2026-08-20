/**
 * The authoring/layout plane is mathematical XY (+Y up). SpellCircle maps it
 * into Three's ground plane as scene XZ with +Y becoming -Z. Keep the glyph
 * plane, its centroid offset, and its facing rotation on that same mapping.
 */
export const GLYPH_PLANE_ROTATION_X = -Math.PI / 2;

export function glyphSceneRotationY(category, direction, rotationDeg = 0) {
  if (category !== 'sign') {
    return -(finite(rotationDeg, 0) * Math.PI) / 180;
  }
  const x = finite(direction?.x, 0);
  const y = finite(direction?.y, 1);
  return Math.atan2(-x, y);
}

export function glyphSceneCenter(centerX, centerY, unitScale, elevation = 0.066) {
  return [
    finite(centerX, 0) * finite(unitScale, 1),
    finite(elevation, 0.066),
    -finite(centerY, 0) * finite(unitScale, 1),
  ];
}

/** Pure probe used to lock the canonical glyph-to-scene axis contract. */
export function canonicalGlyphVectorToScene(vector, rotationY) {
  const x = finite(vector?.x, 0);
  const z = -finite(vector?.y, 0);
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  return {
    x: cos * x + sin * z,
    z: -sin * x + cos * z,
  };
}

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}
