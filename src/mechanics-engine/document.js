import {
  DEFAULT_MECHANICAL_MATERIAL_ID,
  MECHANICS_LIMITS,
  MECHANICS_SCHEMA_VERSION,
  PRIMITIVE_SHAPES,
} from './constants.js';
import { constraintConnectionPoints } from './connections.js';
import {
  IDENTITY_QUATERNION,
  ZERO_VECTOR,
  addVector,
  inverseTransformPoint,
  quaternion,
  scaleVector,
  transformPoint,
  vector,
} from './math.js';

export function createMechanicsDocument(patch = {}) {
  return {
    schemaVersion: MECHANICS_SCHEMA_VERSION,
    assemblies: clone(patch.assemblies ?? []).map((assembly) => createAssembly(assembly)),
    constraints: clone(patch.constraints ?? []),
    forceElements: clone(patch.forceElements ?? []),
    sensors: clone(patch.sensors ?? []),
    latches: clone(patch.latches ?? []),
    rotationCouplings: clone(patch.rotationCouplings ?? []),
    spellDevices: clone(patch.spellDevices ?? []),
    gates: clone(patch.gates ?? []),
    metadata: {
      name: patch.metadata?.name ?? 'Untitled contraption',
      description: patch.metadata?.description ?? '',
      revision: Number.isInteger(patch.metadata?.revision) ? patch.metadata.revision : 0,
      ...clone(patch.metadata ?? {}),
    },
  };
}

export function createPrimitivePart({
  partId,
  preset = 'cuboid',
  shape,
  size,
  localTransform,
  materialId = DEFAULT_MECHANICAL_MATERIAL_ID,
  label,
  rotationPortAxis,
} = {}) {
  const definition = PRIMITIVE_SHAPES[preset] ?? PRIMITIVE_SHAPES.cuboid;
  return {
    partId: partId ?? `part:${preset}`,
    label: label ?? definition.label,
    shape: shape ?? definition.shape,
    size: sanitizeSize(size ?? definition.defaultSize),
    localTransform: normalizeTransform(localTransform),
    materialId,
    rotationPortAxis: rotationPortAxis ?? definition.rotationPortAxis ?? null,
  };
}

export function createAssembly({
  assemblyId,
  label = 'Assembly',
  bodyMode = 'dynamic',
  transform,
  parts,
  structure,
  tags = [],
  editor,
} = {}) {
  const normalizedParts = (parts ?? [createPrimitivePart()]).map((part, index) =>
    createPrimitivePart({ ...part, partId: part.partId ?? `part:${index + 1}` }),
  );
  return {
    assemblyId: assemblyId ?? 'assembly:1',
    label,
    bodyMode: bodyMode === 'fixed' ? 'fixed' : 'dynamic',
    transform: normalizeTransform(transform),
    parts: normalizedParts,
    structure: normalizeStructureWithoutCycle(structure, normalizedParts),
    tags: [...new Set(tags.map(String))],
    editor: {
      opacity: normalizeEditorOpacity(editor?.opacity),
      clickThrough: editor?.clickThrough === true,
    },
  };
}

function normalizeEditorOpacity(value) {
  const opacity = Number(value ?? 1);
  return Number.isFinite(opacity) ? Math.min(1, Math.max(0.05, opacity)) : 1;
}

export function createConstraint({
  constraintId,
  type = 'revolute',
  assemblyAId,
  assemblyBId = null,
  localAnchorA,
  localAnchorB,
  connectionAnchorA = null,
  connectionAnchorB = null,
  localAxisA,
  limits,
  collideConnected = false,
  label,
  drive,
} = {}) {
  return {
    constraintId: constraintId ?? 'constraint:1',
    label: label ?? constraintLabel(type),
    type: ['fixed', 'revolute', 'prismatic'].includes(type) ? type : 'revolute',
    assemblyAId: assemblyAId ?? null,
    assemblyBId,
    localAnchorA: vector(localAnchorA),
    localAnchorB: vector(localAnchorB),
    connectionAnchorA: connectionAnchorA ? vector(connectionAnchorA) : null,
    connectionAnchorB: connectionAnchorB ? vector(connectionAnchorB) : null,
    localAxisA: vector(localAxisA ?? { x: 1, y: 0, z: 0 }),
    limits: {
      enabled: limits?.enabled === true,
      min: Number.isFinite(limits?.min) ? limits.min : type === 'prismatic' ? -1 : -Math.PI,
      max: Number.isFinite(limits?.max) ? limits.max : type === 'prismatic' ? 1 : Math.PI,
    },
    collideConnected: Boolean(collideConnected),
    drive: drive
      ? {
          enabled: drive.enabled !== false,
          targetVelocity: Number(drive.targetVelocity ?? 0),
          damping: Number(drive.damping ?? 2),
          maxImpulse: Number(drive.maxImpulse ?? 12),
        }
      : null,
  };
}

export function createForceElement({
  forceElementId,
  type = 'linear_spring',
  assemblyAId,
  assemblyBId = null,
  constraintId = null,
  localAnchorA,
  localAnchorB,
  connectionAnchorA = null,
  connectionAnchorB = null,
  restLength = 1,
  restAngle = 0,
  stiffness = 28,
  damping = 4,
  maxImpulse = 32,
  label,
} = {}) {
  return {
    forceElementId: forceElementId ?? 'force-element:1',
    label: label ?? (type === 'torsion_spring' ? 'Torsion spring' : 'Linear spring'),
    type: type === 'torsion_spring' ? 'torsion_spring' : 'linear_spring',
    assemblyAId: assemblyAId ?? null,
    assemblyBId,
    constraintId,
    localAnchorA: vector(localAnchorA),
    localAnchorB: vector(localAnchorB),
    connectionAnchorA: connectionAnchorA ? vector(connectionAnchorA) : null,
    connectionAnchorB: connectionAnchorB ? vector(connectionAnchorB) : null,
    restLength: Number(restLength),
    restAngle: Number(restAngle),
    stiffness: Number(stiffness),
    damping: Number(damping),
    maxImpulse: Number(maxImpulse),
  };
}

export function createSensor({
  sensorId,
  assemblyId = null,
  label = 'Contact trigger',
  shape = 'cuboid',
  size = { x: 0.5, y: 0.5, z: 0.5 },
  localTransform,
  triggerPolicy = 'one_shot',
  action = null,
  acceptedTags = [],
} = {}) {
  return {
    sensorId: sensorId ?? 'sensor:1',
    assemblyId,
    label,
    shape: shape === 'sphere' ? 'sphere' : 'cuboid',
    size: sanitizeSize(size),
    localTransform: normalizeTransform(localTransform),
    triggerPolicy: ['entered', 'held', 'exited', 'one_shot'].includes(triggerPolicy)
      ? triggerPolicy
      : 'one_shot',
    action: action ? clone(action) : null,
    acceptedTags: acceptedTags.map(String),
  };
}

export function createLatch({
  latchId,
  assemblyAId,
  assemblyBId = null,
  label = 'Catch latch',
  mode = 'catch',
  armed = true,
  releaseSensorId = null,
  localAnchorA,
  localAnchorB,
  catchDistance = 0.35,
  catchSpeed = 3,
} = {}) {
  return {
    latchId: latchId ?? 'latch:1',
    label,
    mode: mode === 'manual' ? 'manual' : 'catch',
    assemblyAId: assemblyAId ?? null,
    assemblyBId,
    armed: armed !== false,
    releaseSensorId,
    localAnchorA: localAnchorA ? vector(localAnchorA) : null,
    localAnchorB: localAnchorB ? vector(localAnchorB) : null,
    catchDistance: Math.max(0.01, Number(catchDistance)),
    catchSpeed: Math.max(0, Number(catchSpeed)),
  };
}

export function createRotationCoupling({
  couplingId,
  assemblyAId,
  assemblyBId,
  axisA = { x: 0, y: 1, z: 0 },
  axisB = { x: 0, y: 1, z: 0 },
  localAnchorA = null,
  localAnchorB = null,
  ratio = -1,
  phaseOffset = 0,
  torqueCapacity = 24,
  stiffness = 18,
  damping = 4,
  efficiency = 0.92,
  style = 'shaft',
  label = 'Gear coupling',
} = {}) {
  return {
    couplingId: couplingId ?? 'coupling:1',
    label,
    type: 'gear',
    // 'mesh' couplings are adjacent cogwheels with interlocking teeth;
    // 'shaft' couplings are linked across a distance by a drive rod.
    style: style === 'mesh' ? 'mesh' : 'shaft',
    assemblyAId: assemblyAId ?? null,
    assemblyBId: assemblyBId ?? null,
    axisA: vector(axisA),
    axisB: vector(axisB),
    localAnchorA: localAnchorA ? vector(localAnchorA) : null,
    localAnchorB: localAnchorB ? vector(localAnchorB) : null,
    ratio: Number(ratio),
    phaseOffset: Number(phaseOffset),
    torqueCapacity: Number(torqueCapacity),
    stiffness: Number(stiffness),
    damping: Number(damping),
    efficiency: Number(efficiency),
    slipPolicy: 'slip_when_over_capacity',
  };
}

export function createSpellDevice({
  deviceId,
  assemblyId,
  label = 'Wind spell plate',
  spellTemplateId = 'wind-column',
  spell = null,
  localFrame,
  gateId = null,
  forceScale = 1,
  plateRadius = 0.42,
  excludeOwnerAssembly = true,
} = {}) {
  return {
    deviceId: deviceId ?? 'spell-device:1',
    type: 'spell_plate',
    assemblyId: assemblyId ?? null,
    label,
    spellTemplateId,
    // Native Spellpad snapshot. Keeping this on the device makes a saved or
    // ported assembly self-contained instead of depending on workshop presets.
    spell: spell ? clone(spell) : null,
    localFrame: {
      origin: vector(localFrame?.origin),
      normal: vector(localFrame?.normal ?? { x: 0, y: 0, z: 1 }),
      tangent: vector(localFrame?.tangent ?? { x: 1, y: 0, z: 0 }),
    },
    gateId,
    forceScale: Number(forceScale),
    plateRadius: Math.max(0.08, Number(plateRadius) || 0.42),
    targetMask: { excludeOwnerAssembly: excludeOwnerAssembly !== false },
  };
}

export function createGate({
  gateId,
  type = 'sliding_ring_gate',
  plateDeviceId,
  driverConstraintId,
  closedRange,
  closedWindows,
  phaseOffsetRadians = 0,
  lateralTolerance = 0.025,
  angularToleranceRadians = 0.06,
  hysteresis = 0.025,
  label,
} = {}) {
  return {
    gateId: gateId ?? 'gate:1',
    type: type === 'rotary_cam_gate' ? 'rotary_cam_gate' : 'sliding_ring_gate',
    label: label ?? (type === 'rotary_cam_gate' ? 'Rotary cam gate' : 'Sliding ring gate'),
    plateDeviceId: plateDeviceId ?? null,
    driverConstraintId: driverConstraintId ?? null,
    closedRange: {
      min: Number.isFinite(closedRange?.min) ? closedRange.min : 0.9,
      max: Number.isFinite(closedRange?.max) ? closedRange.max : 1,
    },
    closedWindows: (closedWindows ?? [{ startRadians: -0.18, endRadians: 0.18 }]).map(
      (window) => ({
        startRadians: Number(window.startRadians),
        endRadians: Number(window.endRadians),
      }),
    ),
    phaseOffsetRadians: Number(phaseOffsetRadians),
    lateralTolerance: Number(lateralTolerance),
    angularToleranceRadians: Number(angularToleranceRadians),
    hysteresis: Number(hysteresis),
  };
}

export function nextMechanicsId(document, prefix) {
  const collections = [
    document.assemblies,
    document.constraints,
    document.forceElements,
    document.sensors,
    document.latches,
    document.rotationCouplings,
    document.spellDevices,
    document.gates,
  ];
  let highest = 0;
  for (const item of collections.flat()) {
    for (const value of Object.values(item ?? {})) {
      if (typeof value !== 'string' || !value.startsWith(`${prefix}:`)) continue;
      const numeric = Number(value.slice(prefix.length + 1));
      if (Number.isInteger(numeric)) highest = Math.max(highest, numeric);
    }
  }
  return `${prefix}:${highest + 1}`;
}

export function cloneMechanicsDocument(document) {
  return createMechanicsDocument(clone(document));
}

export function migrateMechanicsDocument(input) {
  if (!input || typeof input !== 'object') {
    return { document: null, migrations: [], error: 'mechanics_document_not_an_object' };
  }
  const sourceVersion = Number.isInteger(input.schemaVersion) ? input.schemaVersion : 0;
  if (sourceVersion > MECHANICS_SCHEMA_VERSION) {
    return {
      document: null,
      migrations: [],
      error: `unsupported_future_mechanics_schema_${sourceVersion}`,
    };
  }
  const migrations = [];
  if (sourceVersion < 1) migrations.push('v0_to_v1_base_collections');
  if (sourceVersion < 2) migrations.push('v1_to_v2_assembly_hierarchy');
  if (sourceVersion < 3) migrations.push('v2_to_v3_connection_anchor_frames');
  const missingCollections = [
    'assemblies',
    'constraints',
    'forceElements',
    'sensors',
    'latches',
    'rotationCouplings',
    'spellDevices',
    'gates',
  ].filter((key) => !Array.isArray(input[key]));
  if (missingCollections.length > 0) {
    migrations.push(`v1_fill_missing_collections:${missingCollections.join(',')}`);
  }
  const document = createMechanicsDocument({ ...input, schemaVersion: MECHANICS_SCHEMA_VERSION });
  if (sourceVersion < 3) migrateLegacyJointEndpoints(document);
  return {
    document,
    migrations,
    error: null,
  };
}

function migrateLegacyJointEndpoints(document) {
  document.constraints = document.constraints.map((constraint) => {
    if (!constraint.surfaceAnchorA && !constraint.surfaceAnchorB) return constraint;
    const assemblyA = document.assemblies.find((item) => item.assemblyId === constraint.assemblyAId);
    const assemblyB = document.assemblies.find((item) => item.assemblyId === constraint.assemblyBId);
    const points = constraintConnectionPoints(document, constraint);
    if (!assemblyA || !assemblyB || !points) return constraint;
    const pivot = constraint.surfaceAnchorA && !constraint.surfaceAnchorB
      ? transformPoint(assemblyB.transform, constraint.localAnchorB)
      : constraint.surfaceAnchorB && !constraint.surfaceAnchorA
        ? transformPoint(assemblyA.transform, constraint.localAnchorA)
        : scaleVector(addVector(points.pointA, points.pointB), 0.5);
    const migrated = {
      ...constraint,
      connectionAnchorA: inverseTransformPoint(assemblyA.transform, points.pointA),
      connectionAnchorB: inverseTransformPoint(assemblyB.transform, points.pointB),
      localAnchorA: inverseTransformPoint(assemblyA.transform, pivot),
      localAnchorB: inverseTransformPoint(assemblyB.transform, pivot),
    };
    delete migrated.surfaceAnchorA;
    delete migrated.surfaceAnchorB;
    return migrated;
  });
}

function normalizeStructureWithoutCycle(structure, parts) {
  const partIds = new Set(parts.map((part) => part.partId));
  const usedParts = new Set();
  const usedNodes = new Set();
  const visit = (children) =>
    (Array.isArray(children) ? children : []).flatMap((node) => {
      if (node?.kind === 'shape') {
        const partId = String(node.partId ?? node.nodeId ?? '');
        if (!partIds.has(partId) || usedParts.has(partId)) return [];
        usedParts.add(partId);
        usedNodes.add(partId);
        return [{ kind: 'shape', nodeId: partId, partId }];
      }
      if (node?.kind !== 'assembly') return [];
      let nodeId = String(node.nodeId ?? `group:${usedNodes.size + 1}`);
      while (usedNodes.has(nodeId) || partIds.has(nodeId)) nodeId = `${nodeId}:nested`;
      usedNodes.add(nodeId);
      return [{
        kind: 'assembly',
        nodeId,
        label: String(node.label ?? 'Assembly'),
        localTransform: normalizeTransform(node.localTransform),
        children: visit(node.children),
      }];
    });
  const children = visit(structure?.children);
  for (const part of parts) {
    if (!usedParts.has(part.partId)) {
      children.push({ kind: 'shape', nodeId: part.partId, partId: part.partId });
    }
  }
  return { children };
}

export function normalizeTransform(transform = {}) {
  return {
    position: vector(transform.position ?? ZERO_VECTOR),
    rotation: quaternion(transform.rotation ?? IDENTITY_QUATERNION),
  };
}

export function sanitizeSize(size = { x: 1, y: 1, z: 1 }) {
  const clampPart = (value) =>
    Math.min(
      MECHANICS_LIMITS.maximumPartSize,
      Math.max(MECHANICS_LIMITS.minimumPartSize, Number(value ?? 1)),
    );
  return {
    x: clampPart(size.x),
    y: clampPart(size.y),
    z: clampPart(size.z),
  };
}

function constraintLabel(type) {
  if (type === 'fixed') return 'Fixed connection';
  if (type === 'prismatic') return 'Slider';
  return 'Hinge';
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
