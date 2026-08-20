import {
  addVector,
  composeTransforms,
  dotVector,
  crossVector,
  inverseTransformPoint,
  normalizeVector,
  rotateVector,
  scaleVector,
  subtractVector,
  transformDirection,
  transformPoint,
  vectorLength,
} from './math.js';

const LOCAL_AXES = [
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: 0, z: 1 },
];

// Finds the two actual part surfaces that are closest to one another. This is
// the shared authority for automatically placed joints, springs, and latches;
// assembly origins are not assumed to be useful connection points.
export function closestAssemblyConnection(assemblyA, assemblyB, transforms = {}) {
  if (!assemblyA || !assemblyB) return null;
  const transformA = transforms[assemblyA.assemblyId] ?? assemblyA.transform;
  const transformB = transforms[assemblyB.assemblyId] ?? assemblyB.transform;
  let best = null;
  for (const partA of assemblyA.parts ?? []) {
    const frameA = partWorldFrame(transformA, partA);
    for (const partB of assemblyB.parts ?? []) {
      const frameB = partWorldFrame(transformB, partB);
      const between = subtractVector(frameB.position, frameA.position);
      const centerDistance = vectorLength(between);
      const fallback = normalizeVector(
        subtractVector(transformB.position, transformA.position),
        { x: 1, y: 0, z: 0 },
      );
      const direction = normalizeVector(between, fallback);
      const radiusA = partSupportRadius(partA, frameA.rotation, direction);
      const radiusB = partSupportRadius(partB, frameB.rotation, direction);
      const pointA = addVector(frameA.position, scaleVector(direction, radiusA));
      const pointB = addVector(frameB.position, scaleVector(direction, -radiusB));
      const surfaceGap = Math.max(0, centerDistance - radiusA - radiusB);
      const score = surfaceGap * 1000 + centerDistance;
      if (!best || score < best.score) {
        best = {
          score,
          partAId: partA.partId,
          partBId: partB.partId,
          pointA,
          pointB,
          midpoint: scaleVector(addVector(pointA, pointB), 0.5),
          direction,
          surfaceGap,
        };
      }
    }
  }
  return best;
}

export function partWorldFrame(assemblyTransform, part) {
  return composeTransforms(assemblyTransform, part.localTransform);
}

export function partSupportRadius(part, worldRotation, worldDirection) {
  const direction = normalizeVector(worldDirection);
  if (part.shape === 'sphere') {
    return Math.max(part.size.x, part.size.y, part.size.z) / 2;
  }
  const half = [part.size.x / 2, part.size.y / 2, part.size.z / 2];
  return LOCAL_AXES.reduce((extent, localAxis, index) => {
    const worldAxis = rotateVector(localAxis, worldRotation);
    return extent + Math.abs(dotVector(direction, worldAxis)) * half[index];
  }, 0);
}

// Returns the nearest point where an axis running through origin reaches real
// geometry in an assembly. It lets hinge visuals span the connected material
// instead of drawing a fixed-length pin at an arbitrary anchor.
export function nearestAssemblyPointOnAxis(assembly, assemblyTransform, origin, axisValue) {
  if (!assembly) return { point: { ...origin }, coordinate: 0, partId: null };
  const axis = normalizeVector(axisValue);
  let best = null;
  for (const part of assembly.parts ?? []) {
    const frame = partWorldFrame(assemblyTransform, part);
    const offset = subtractVector(frame.position, origin);
    const coordinate = dotVector(offset, axis);
    const axialRadius = partSupportRadius(part, frame.rotation, axis);
    const radialOffset = subtractVector(offset, scaleVector(axis, coordinate));
    const radialDirection = normalizeVector(radialOffset, perpendicularTo(axis));
    const radialRadius = partSupportRadius(part, frame.rotation, radialDirection);
    const radialDistance = vectorLength(radialOffset);
    const radialGap = Math.max(0, radialDistance - radialRadius);
    const min = coordinate - axialRadius;
    const max = coordinate + axialRadius;
    const nearestCoordinate = Math.min(max, Math.max(min, 0));
    const score = radialGap * 1000 + Math.abs(nearestCoordinate);
    if (!best || score < best.score) {
      best = {
        score,
        coordinate: nearestCoordinate,
        point: addVector(origin, scaleVector(axis, nearestCoordinate)),
        partId: part.partId,
      };
    }
  }
  return best ?? { point: { ...origin }, coordinate: 0, partId: null };
}

// A joint has one physics pivot, but its visible/contact hardware may touch the
// two bodies at different places. Keeping these concepts separate prevents the
// physics solver from snapping bodies together when an editor node is moved.
export function constraintConnectionPoints(document, constraint, transforms = {}) {
  const assemblyA = document.assemblies.find((item) => item.assemblyId === constraint.assemblyAId);
  const assemblyB = document.assemblies.find((item) => item.assemblyId === constraint.assemblyBId);
  if (!assemblyA || !assemblyB) return null;
  const transformA = transforms[constraint.assemblyAId] ?? assemblyA.transform;
  const transformB = transforms[constraint.assemblyBId] ?? assemblyB.transform;
  // Infer missing presentation anchors once in the authored Build pose, then
  // carry those body-local points through the live transforms. Re-running the
  // closest-surface search against moving bodies lets a tie switch from one
  // part/face to another; the physical joint remains continuous while its
  // rail, pin, or connector appears to teleport around the mechanism.
  const authoredPivot = transformPoint(assemblyA.transform, constraint.localAnchorA);
  let inferredA = authoredPivot;
  let inferredB = transformPoint(assemblyB.transform, constraint.localAnchorB);
  if (constraint.type === 'revolute') {
    const axis = transformDirection(assemblyA.transform, constraint.localAxisA);
    inferredA = nearestAssemblyPointOnAxis(
      assemblyA,
      assemblyA.transform,
      authoredPivot,
      axis,
    ).point;
    inferredB = nearestAssemblyPointOnAxis(
      assemblyB,
      assemblyB.transform,
      authoredPivot,
      axis,
    ).point;
  } else {
    const closest = closestAssemblyConnection(assemblyA, assemblyB);
    inferredA = closest?.pointA ?? inferredA;
    inferredB = closest?.pointB ?? inferredB;
  }
  const inferredLocalA = inverseTransformPoint(assemblyA.transform, inferredA);
  const inferredLocalB = inverseTransformPoint(assemblyB.transform, inferredB);
  return {
    pointA: constraint.connectionAnchorA
      ? transformPoint(transformA, constraint.connectionAnchorA)
      : constraint.surfaceAnchorA
        ? transformPoint(transformA, constraint.localAnchorA)
        : transformPoint(transformA, inferredLocalA),
    pointB: constraint.connectionAnchorB
      ? transformPoint(transformB, constraint.connectionAnchorB)
      : constraint.surfaceAnchorB
        ? transformPoint(transformB, constraint.localAnchorB)
        : transformPoint(transformB, inferredLocalB),
  };
}

// Torsion spring torque is applied through its hinge, while these are the two
// physical-looking legs that brace against the connected assemblies.
export function torsionSpringConnectionPoints(document, spring, transforms = {}) {
  const assemblyA = document.assemblies.find((item) => item.assemblyId === spring.assemblyAId);
  const assemblyB = document.assemblies.find((item) => item.assemblyId === spring.assemblyBId);
  if (!assemblyA || !assemblyB) return null;
  const transformA = transforms[spring.assemblyAId] ?? assemblyA.transform;
  const transformB = transforms[spring.assemblyBId] ?? assemblyB.transform;
  const constraint = document.constraints.find((item) => item.constraintId === spring.constraintId);
  const pivot = constraint
    ? transformPoint(assemblyA.transform, constraint.localAnchorA)
    : scaleVector(addVector(assemblyA.transform.position, assemblyB.transform.position), 0.5);
  const axis = normalizeVector(
    constraint
      ? transformDirection(assemblyA.transform, constraint.localAxisA)
      : { x: 1, y: 0, z: 0 },
  );
  const down = { x: 0, y: -1, z: 0 };
  const projectedDown = subtractVector(down, scaleVector(axis, dotVector(down, axis)));
  const braceDirection = normalizeVector(projectedDown, perpendicularTo(axis));
  let pushDirection = crossVector({ x: 0, y: 1, z: 0 }, axis);
  if (vectorLength(pushDirection) < 1e-6) pushDirection = perpendicularTo(axis);
  pushDirection = scaleVector(
    normalizeVector(pushDirection),
    Math.sign(spring.restAngle || 1),
  );
  const defaultAWorld = assemblySurfacePointAlongRay(
    assemblyA,
    assemblyA.transform,
    pivot,
    braceDirection,
  ).point;
  const defaultBWorld = assemblySurfacePointAlongRay(
    assemblyB,
    assemblyB.transform,
    pivot,
    pushDirection,
  ).point;
  const defaultLocalA = inverseTransformPoint(assemblyA.transform, defaultAWorld);
  const defaultLocalB = inverseTransformPoint(assemblyB.transform, defaultBWorld);
  return {
    pointA: spring.connectionAnchorA
      ? transformPoint(transformA, spring.connectionAnchorA)
      : transformPoint(transformA, defaultLocalA),
    pointB: spring.connectionAnchorB
      ? transformPoint(transformB, spring.connectionAnchorB)
      : transformPoint(transformB, defaultLocalB),
  };
}

function assemblySurfacePointAlongRay(assembly, assemblyTransform, origin, directionValue) {
  const direction = normalizeVector(directionValue);
  let best = null;
  for (const part of assembly.parts ?? []) {
    const frame = partWorldFrame(assemblyTransform, part);
    const offset = subtractVector(frame.position, origin);
    const coordinate = dotVector(offset, direction);
    const axialRadius = partSupportRadius(part, frame.rotation, direction);
    const radialOffset = subtractVector(offset, scaleVector(direction, coordinate));
    const radialDirection = normalizeVector(radialOffset, perpendicularTo(direction));
    const radialRadius = partSupportRadius(part, frame.rotation, radialDirection);
    const radialGap = Math.max(0, vectorLength(radialOffset) - radialRadius);
    const min = coordinate - axialRadius;
    const max = coordinate + axialRadius;
    if (max < 0.001) continue;
    const distance = min > 0.001 ? min : max;
    const score = radialGap * 1000 + distance;
    if (!best || score < best.score) {
      best = {
        score,
        point: addVector(origin, scaleVector(direction, distance)),
        partId: part.partId,
      };
    }
  }
  return best ?? { point: { ...origin }, partId: null };
}

function perpendicularTo(axis) {
  const helper = Math.abs(axis.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  return normalizeVector({
    x: axis.y * helper.z - axis.z * helper.y,
    y: axis.z * helper.x - axis.x * helper.z,
    z: axis.x * helper.y - axis.y * helper.x,
  });
}
