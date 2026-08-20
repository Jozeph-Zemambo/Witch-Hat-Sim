import { COGWHEEL_PRESETS, COG_TOOTH_DEPTH, cogwheelPitchRadius } from './constants.js';
import {
  IDENTITY_QUATERNION,
  addVector,
  crossVector,
  dotVector,
  multiplyQuaternion,
  normalizeVector,
  quaternionFromAxisAngle,
  rotateVector,
  scaleVector,
  subtractVector,
  transformPoint,
  vectorLength,
} from './math.js';

const LOCAL_UP = { x: 0, y: 1, z: 0 };

export function cogwheelPartOf(assembly) {
  return assembly?.parts?.find((part) => part.shape === 'cogwheel') ?? null;
}

// World-space center and spin axis of an assembly's cogwheel part.
export function cogwheelWorldFrame(assembly, part = cogwheelPartOf(assembly)) {
  if (!part) return null;
  const rotation = multiplyQuaternion(assembly.transform.rotation, part.localTransform.rotation);
  return {
    center: transformPoint(assembly.transform, part.localTransform.position),
    axis: normalizeVector(rotateVector(part.rotationPortAxis ?? LOCAL_UP, rotation), { ...LOCAL_UP }),
    pitchRadius: cogwheelPitchRadius(part.size),
  };
}

// The cogwheel's spin axis expressed in its assembly's local space — the axis
// a rotation coupling on that assembly should use.
export function cogwheelAssemblyAxis(part) {
  return normalizeVector(
    rotateVector(part.rotationPortAxis ?? LOCAL_UP, part.localTransform.rotation),
    { ...LOCAL_UP },
  );
}

export function quaternionBetweenVectors(from, to) {
  const f = normalizeVector(from);
  const t = normalizeVector(to);
  const alignment = dotVector(f, t);
  if (alignment > 0.99999) return { ...IDENTITY_QUATERNION };
  if (alignment < -0.99999) {
    const helper = Math.abs(f.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    return quaternionFromAxisAngle(normalizeVector(crossVector(f, helper)), Math.PI);
  }
  return quaternionFromAxisAngle(
    normalizeVector(crossVector(f, t)),
    Math.acos(Math.min(1, Math.max(-1, alignment))),
  );
}

// Plan where a new cogwheel would land for a world-space cursor point.
// Free space: it lies flat at the cursor. Near an existing cogwheel (and
// snapping is not suppressed): the cursor is projected into that cogwheel's
// actual plane, so the requested direction is preserved around horizontal,
// vertical, and arbitrarily rotated wheels. The pitch circles meet exactly,
// the axes align, and the plan carries everything needed to auto-create the
// mesh coupling. The mesh runtime keeps unsupported cogs in place without
// exposing a second axle relationship.
export function planCogwheelPlacement(document, cursorPoint, presetId, options = {}) {
  const preset = COGWHEEL_PRESETS[presetId] ?? COGWHEEL_PRESETS['cog-large'];
  const pitchRadius = cogwheelPitchRadius(preset.defaultSize);
  const snapEnabled = options.snap !== false;
  const preferredTargetAssemblyId = options.targetAssemblyId ?? null;

  let best = null;
  if (snapEnabled) {
    for (const assembly of document.assemblies ?? []) {
      if (preferredTargetAssemblyId && assembly.assemblyId !== preferredTargetAssemblyId) continue;
      const frame = cogwheelWorldFrame(assembly);
      if (!frame) continue;
      const toCursor = subtractVector(cursorPoint, frame.center);
      const axial = scaleVector(frame.axis, dotVector(toCursor, frame.axis));
      let inPlane = subtractVector(toCursor, axial);
      const planarDistance = vectorLength(inPlane);
      const meshDistance = frame.pitchRadius + pitchRadius;
      if (planarDistance > meshDistance + 0.6) continue;
      if (planarDistance < 1e-4) {
        const helper = Math.abs(frame.axis.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
        inPlane = crossVector(frame.axis, helper);
      }
      const direction = normalizeVector(inPlane);
      const snappedPosition = addVector(frame.center, scaleVector(direction, meshDistance));
      const cursorDistance = vectorLength(subtractVector(snappedPosition, cursorPoint));
      if (!best || cursorDistance < best.cursorDistance) {
        best = { assembly, frame, direction, snappedPosition, cursorDistance };
      }
    }
  }

  if (!best) {
    return {
      presetId,
      position: {
        x: cursorPoint.x,
        y: preset.defaultSize.y / 2 + 0.02,
        z: cursorPoint.z,
      },
      rotation: { ...IDENTITY_QUATERNION },
      snapped: null,
    };
  }

  const { frame, assembly } = best;
  return {
    presetId,
    position: best.snappedPosition,
    rotation: quaternionBetweenVectors(LOCAL_UP, frame.axis),
    snapped: {
      targetAssemblyId: assembly.assemblyId,
      // Coupling semantics: angleB = ratio · angleA with the target as A and
      // the new cogwheel as B; meshed teeth counter-rotate at the radius ratio.
      ratio: Number((-(frame.pitchRadius / pitchRadius)).toFixed(3)),
      targetLocalAxis: cogwheelAssemblyAxis(cogwheelPartOf(assembly)),
      worldAxis: frame.axis,
    },
  };
}

export function cogwheelOuterRadius(size) {
  return cogwheelPitchRadius(size) + COG_TOOTH_DEPTH / 2;
}

export function cogwheelRootRadius(size) {
  return Math.max(0.05, cogwheelPitchRadius(size) - COG_TOOTH_DEPTH / 2);
}
