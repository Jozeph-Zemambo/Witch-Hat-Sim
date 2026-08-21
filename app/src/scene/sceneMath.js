import * as THREE from 'three';
import { MIN_MOUNTED_SPELL_WORLD_SCALE } from '../../../src/simulation-engine/index.js';
import { MIN_PLACED_SPELL_SCALE } from '../store.js';

export const DEFAULT_FRAME = {
  origin: { x: 0, y: 0, z: 0 },
  normal: { x: 0, y: 1, z: 0 },
  tangent: { x: 1, y: 0, z: 0 },
  bitangent: { x: 0, y: 0, z: 1 },
};

export function worldThicknessRadiusForIntent(intent) {
  const source = intent.renderGeometry ?? intent.geometry ?? intent;
  const explicitWorldRadius = Number(
    source.worldThicknessRingRadius ?? source.worldRadius ?? source.radiusWorld,
  );
  if (Number.isFinite(explicitWorldRadius)) return Math.max(0.2, explicitWorldRadius);
  const displayMaxRadius = Math.max(
    120,
    Number(intent.displayMaxRadius ?? intent.thicknessRingRadius ?? 120),
  );
  const rawRingRadius = Math.max(1, Number(intent.thicknessRingRadius ?? displayMaxRadius));
  return Math.max(1.2, (rawRingRadius * 1.2) / displayMaxRadius);
}

export function symbolPosition(symbol, scale) {
  if (symbol.position) {
    return {
      x: (symbol.position.x ?? 0) * scale,
      // The render group's local +Z is opposite the compiler frame's
      // bitangent. Mirror program Y so each sign is drawn on the same side
      // that owns its column push contribution.
      z: -(symbol.position.y ?? 0) * scale,
    };
  }
  const angle = ((symbol.polarAngleDeg ?? 0) * Math.PI) / 180;
  const radius = (symbol.polarRadius ?? 0) * scale;
  return { x: Math.cos(angle) * radius, z: -Math.sin(angle) * radius };
}

export function centeredDispersionOrigin(frame) {
  return toVector3(frame.origin)
    .add(frame.normal.clone().multiplyScalar(0.22 * frame.worldScale));
}

export function anchorForPolarAngle(angleDeg = 0) {
  const radians = (Number(angleDeg) * Math.PI) / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

export function environmentPalette(environmentMode) {
  if (environmentMode === 'night') {
    return {
      clear: '#0f1421',
      fog: '#101827',
      sky: '#0a0f1f',
      ambient: 0.28,
      sun: 0.16,
      ambientColor: '#8e9ec4',
      sunColor: '#b9c3e8',
    };
  }
  if (environmentMode === 'dusk') {
    return {
      clear: '#9e758c',
      fog: '#9e758c',
      sky: '#ad6b75',
      ambient: 0.48,
      sun: 0.44,
      ambientColor: '#f1c5ae',
      sunColor: '#ffc083',
    };
  }
  return {
    clear: '#b8d9f0',
    fog: '#b8d9f0',
    sky: '#9ec7eb',
    ambient: 0.78,
    sun: 0.82,
    ambientColor: '#e7f5db',
    sunColor: '#fff0c8',
  };
}

export function normalizeFrame(frame = DEFAULT_FRAME) {
  const normal = toSceneAxis(frame.normal ?? DEFAULT_FRAME.normal);
  const tangent = toSceneAxis(frame.tangent ?? DEFAULT_FRAME.tangent);
  const bitangent = frame.bitangent != null
    ? toSceneAxis(frame.bitangent)
    : new THREE.Vector3().crossVectors(normal, tangent).normalize();
  return {
    origin: frame.origin ?? DEFAULT_FRAME.origin,
    normal,
    tangent,
    bitangent,
    worldScale: clamp(
      Number(frame.worldScale ?? MIN_PLACED_SPELL_SCALE),
      MIN_MOUNTED_SPELL_WORLD_SCALE,
      4,
    ),
  };
}

export function mapAxis(axis) {
  const mapped = axis
    ? new THREE.Vector3(axis.x ?? 0, axis.z ?? 1, axis.y ?? 0)
    : new THREE.Vector3(0, 1, 0);
  if (mapped.lengthSq() <= 0.000001) return new THREE.Vector3(0, 1, 0);
  return mapped.normalize();
}

export function toSceneAxis(axis) {
  if (axis instanceof THREE.Vector3) return axis.clone().normalize();
  const vector = new THREE.Vector3(axis?.x ?? 0, axis?.y ?? 1, axis?.z ?? 0);
  if (vector.lengthSq() <= 0.000001) return new THREE.Vector3(0, 1, 0);
  return vector.normalize();
}

export function perpendicularBasis(direction) {
  const dir = direction.lengthSq() > 0.000001
    ? direction.clone().normalize()
    : new THREE.Vector3(0, 1, 0);
  const reference = Math.abs(dir.dot(new THREE.Vector3(0, 1, 0))) > 0.92
    ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(dir, reference).normalize();
  const up = new THREE.Vector3().crossVectors(right, dir).normalize();
  return { right, up };
}

export function quaternionFromUp(direction) {
  const dir = direction.lengthSq() > 0.000001
    ? direction.clone().normalize()
    : new THREE.Vector3(0, 1, 0);
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
}

export function quaternionFromFrame(normalInput, tangentInput) {
  const normal = toSceneAxis(normalInput);
  let tangent = toSceneAxis(tangentInput);
  tangent = tangent.sub(normal.clone().multiplyScalar(tangent.dot(normal))).normalize();
  if (tangent.lengthSq() <= 0.000001) {
    tangent = Math.abs(normal.y) > 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0).cross(normal).normalize();
  }
  const localZ = new THREE.Vector3().crossVectors(tangent, normal).normalize();
  const matrix = new THREE.Matrix4().makeBasis(tangent, normal, localZ);
  return new THREE.Quaternion().setFromRotationMatrix(matrix);
}

export function toVector3(position = {}, yOverride) {
  return new THREE.Vector3(position.x ?? 0, yOverride ?? position.y ?? 0, position.z ?? 0);
}

export function vectorArray(position = {}, yOverride) {
  return [position.x ?? 0, yOverride ?? position.y ?? 0, position.z ?? 0];
}

export function vectorDebug(vector) {
  return {
    x: round(vector.x ?? 0),
    y: round(vector.y ?? 0),
    z: round(vector.z ?? 0),
  };
}

export function safeMeshId(value) {
  return String(value).replace(/[^a-zA-Z0-9:_-]/g, '-');
}

export function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function horizontalBasis(forwardInput) {
  const forward = new THREE.Vector3(forwardInput.x, 0, forwardInput.z);
  if (forward.lengthSq() <= 0.000001) forward.set(0, 0, -1);
  forward.normalize();
  const right = new THREE.Vector3()
    .crossVectors(forward, new THREE.Vector3(0, 1, 0))
    .normalize();
  return { forward, right };
}

export function lookDirectionFor(yaw, pitch) {
  const horizontal = Math.cos(pitch);
  return new THREE.Vector3(
    Math.sin(yaw) * horizontal,
    Math.sin(pitch),
    Math.cos(yaw) * horizontal,
  ).normalize();
}

export function round(value) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
