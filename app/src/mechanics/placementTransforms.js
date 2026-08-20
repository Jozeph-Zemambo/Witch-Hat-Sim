import {
  multiplyQuaternion,
  rotateVector,
} from '../../../src/mechanics-engine/index.js';

export const IDENTITY_PLACEMENT_TRANSFORM = Object.freeze({
  position: Object.freeze({ x: 0, y: 0, z: 0 }),
  rotation: Object.freeze({ x: 0, y: 0, z: 0, w: 1 }),
  scale: Object.freeze({ x: 1, y: 1, z: 1 }),
});

const MIN_PLACEMENT_SCALE = 0.05;

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizedQuaternion(rotation = {}) {
  const value = {
    x: finiteNumber(rotation.x, 0),
    y: finiteNumber(rotation.y, 0),
    z: finiteNumber(rotation.z, 0),
    w: finiteNumber(rotation.w, 1),
  };
  const length = Math.hypot(value.x, value.y, value.z, value.w);
  if (length <= 1e-9) return { ...IDENTITY_PLACEMENT_TRANSFORM.rotation };
  return {
    x: value.x / length,
    y: value.y / length,
    z: value.z / length,
    w: value.w / length,
  };
}

/**
 * Normalize a persisted or UI-supplied world placement transform.
 *
 * Position is in world units, rotation is a unit quaternion, and scale is
 * either one uniform number or an XYZ vector. Scale is always positive and
 * bounded away from zero so Rapier never receives a degenerate collider.
 */
export function normalizePlacementTransform(transform = {}) {
  const scale = typeof transform.scale === 'number'
    ? { x: transform.scale, y: transform.scale, z: transform.scale }
    : transform.scale ?? {};
  return {
    position: {
      x: finiteNumber(transform.position?.x, 0),
      y: finiteNumber(transform.position?.y, 0),
      z: finiteNumber(transform.position?.z, 0),
    },
    rotation: normalizedQuaternion(transform.rotation),
    scale: {
      x: Math.max(MIN_PLACEMENT_SCALE, Math.abs(finiteNumber(scale.x, 1))),
      y: Math.max(MIN_PLACEMENT_SCALE, Math.abs(finiteNumber(scale.y, 1))),
      z: Math.max(MIN_PLACEMENT_SCALE, Math.abs(finiteNumber(scale.z, 1))),
    },
  };
}

/**
 * Validate a partial transform patch before it is persisted or applied to
 * Rapier. Missing fields are allowed; present vector components must be
 * finite numbers. The returned error is suitable for a terse UI status.
 */
export function validatePlacementTransformPatch(patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, error: 'Transform patch must be an object.' };
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'Transform patch cannot be empty.' };
  }
  for (const [name, value] of Object.entries(patch)) {
    if (!['position', 'rotation', 'scale'].includes(name)) {
      return { ok: false, error: `Unknown transform field: ${name}.` };
    }
    if (name === 'scale' && typeof value === 'number') {
      if (!Number.isFinite(value)) {
        return { ok: false, error: 'Scale must be finite.' };
      }
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: `${name} must be a vector object.` };
    }
    for (const component of Object.keys(value)) {
      if (!['x', 'y', 'z', 'w'].includes(component)) {
        return { ok: false, error: `Unknown ${name} component: ${component}.` };
      }
      if (!Number.isFinite(Number(value[component]))) {
        return { ok: false, error: `${name}.${component} must be finite.` };
      }
    }
  }
  if (patch.rotation) {
    const rotation = { x: 0, y: 0, z: 0, w: 1, ...patch.rotation };
    if (Math.hypot(rotation.x, rotation.y, rotation.z, rotation.w) <= 1e-9) {
      return { ok: false, error: 'Rotation quaternion cannot be zero length.' };
    }
  }
  return { ok: true, error: null };
}

/**
 * Merge a partial UI transform patch into the current canonical transform.
 * The result is safe to serialize and safe to pass to a runtime sync method.
 */
export function mergePlacementTransform(current = {}, patch = {}) {
  return normalizePlacementTransform({
    ...current,
    ...patch,
    position: { ...(current.position ?? {}), ...(patch.position ?? {}) },
    rotation: { ...(current.rotation ?? {}), ...(patch.rotation ?? {}) },
    scale: typeof patch.scale === 'number'
      ? patch.scale
      : { ...(typeof current.scale === 'number' ? { x: current.scale, y: current.scale, z: current.scale } : current.scale ?? {}), ...(patch.scale ?? {}) },
  });
}

export function scaleVectorBy(value = {}, scale = {}) {
  return {
    x: Number(value.x ?? 0) * Number(scale.x ?? 1),
    y: Number(value.y ?? 0) * Number(scale.y ?? 1),
    z: Number(value.z ?? 0) * Number(scale.z ?? 1),
  };
}

export function worldAssemblyTransform(assemblyTransform = {}, placementTransform = {}) {
  const placement = normalizePlacementTransform(placementTransform);
  const localPosition = scaleVectorBy(assemblyTransform.position, placement.scale);
  const rotatedPosition = rotateVector(localPosition, placement.rotation);
  return {
    position: {
      x: placement.position.x + rotatedPosition.x,
      y: placement.position.y + rotatedPosition.y,
      z: placement.position.z + rotatedPosition.z,
    },
    rotation: multiplyQuaternion(placement.rotation, assemblyTransform.rotation ?? { x: 0, y: 0, z: 0, w: 1 }),
  };
}
