const EPSILON = 1e-9;

export const IDENTITY_QUATERNION = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
export const ZERO_VECTOR = Object.freeze({ x: 0, y: 0, z: 0 });

export function vector(value = ZERO_VECTOR) {
  return {
    x: finite(value.x, 0),
    y: finite(value.y, 0),
    z: finite(value.z, 0),
  };
}

export function quaternion(value = IDENTITY_QUATERNION) {
  const q = {
    x: finite(value.x, 0),
    y: finite(value.y, 0),
    z: finite(value.z, 0),
    w: finite(value.w, 1),
  };
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  if (length <= EPSILON) return { ...IDENTITY_QUATERNION };
  return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
}

export function addVector(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subtractVector(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scaleVector(value, scale) {
  return { x: value.x * scale, y: value.y * scale, z: value.z * scale };
}

export function dotVector(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function crossVector(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function vectorLength(value) {
  return Math.hypot(value.x, value.y, value.z);
}

export function normalizeVector(value, fallback = { x: 1, y: 0, z: 0 }) {
  const length = vectorLength(value);
  if (length <= EPSILON) return { ...fallback };
  return scaleVector(value, 1 / length);
}

export function multiplyQuaternion(aValue, bValue) {
  const a = quaternion(aValue);
  const b = quaternion(bValue);
  return quaternion({
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  });
}

export function inverseQuaternion(value) {
  const q = quaternion(value);
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

export function rotateVector(value, rotation) {
  const q = quaternion(rotation);
  const u = { x: q.x, y: q.y, z: q.z };
  const uv = crossVector(u, value);
  const uuv = crossVector(u, uv);
  return addVector(value, addVector(scaleVector(uv, 2 * q.w), scaleVector(uuv, 2)));
}

export function transformPoint(transform, localPoint) {
  return addVector(vector(transform.position), rotateVector(vector(localPoint), transform.rotation));
}

export function inverseTransformPoint(transform, worldPoint) {
  return rotateVector(
    subtractVector(vector(worldPoint), vector(transform.position)),
    inverseQuaternion(transform.rotation),
  );
}

export function transformDirection(transform, localDirection) {
  return rotateVector(vector(localDirection), transform.rotation);
}

export function inverseTransformDirection(transform, worldDirection) {
  return rotateVector(vector(worldDirection), inverseQuaternion(transform.rotation));
}

export function composeTransforms(parent, child) {
  return {
    position: transformPoint(parent, child.position ?? ZERO_VECTOR),
    rotation: multiplyQuaternion(parent.rotation, child.rotation),
  };
}

export function relativeTransform(parent, world) {
  return {
    position: inverseTransformPoint(parent, world.position),
    rotation: multiplyQuaternion(inverseQuaternion(parent.rotation), world.rotation),
  };
}

export function quaternionFromAxisAngle(axisValue, angle) {
  const axis = normalizeVector(vector(axisValue));
  const half = angle / 2;
  const sin = Math.sin(half);
  return quaternion({ x: axis.x * sin, y: axis.y * sin, z: axis.z * sin, w: Math.cos(half) });
}

export function signedTwistAngle(relativeRotation, axisValue) {
  const axis = normalizeVector(vector(axisValue));
  const q = quaternion(relativeRotation);
  const projection = dotVector({ x: q.x, y: q.y, z: q.z }, axis);
  return normalizeAngle(2 * Math.atan2(projection, q.w));
}

export function normalizeAngle(angle) {
  let normalized = finite(angle, 0) % (Math.PI * 2);
  if (normalized <= -Math.PI) normalized += Math.PI * 2;
  if (normalized > Math.PI) normalized -= Math.PI * 2;
  return normalized;
}

export function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, finite(value, min)));
}

export function round(value, places = 6) {
  const scale = 10 ** places;
  return Math.round(finite(value, 0) * scale) / scale;
}
