import { MECHANICAL_MATERIALS, MECHANICS_SCHEMA_VERSION } from './constants.js';
import { vectorLength } from './math.js';

export function validateMechanicsDocument(document) {
  const diagnostics = [];
  if (!document || typeof document !== 'object') {
    return {
      ok: false,
      diagnostics: [diagnostic('document.invalid', 'Mechanics document must be an object.')],
    };
  }
  if (document.schemaVersion !== MECHANICS_SCHEMA_VERSION) {
    diagnostics.push(
      diagnostic(
        'document.unsupported_schema',
        `Expected mechanics schema ${MECHANICS_SCHEMA_VERSION}, received ${document.schemaVersion}.`,
      ),
    );
  }

  const collections = [
    ['assemblies', document.assemblies, 'assemblyId'],
    ['constraints', document.constraints, 'constraintId'],
    ['forceElements', document.forceElements, 'forceElementId'],
    ['sensors', document.sensors, 'sensorId'],
    ['latches', document.latches, 'latchId'],
    ['rotationCouplings', document.rotationCouplings, 'couplingId'],
    ['spellDevices', document.spellDevices, 'deviceId'],
    ['gates', document.gates, 'gateId'],
  ];
  const ids = new Set();
  for (const [name, items, idField] of collections) {
    if (!Array.isArray(items)) {
      diagnostics.push(diagnostic('document.collection_invalid', `${name} must be an array.`, name));
      continue;
    }
    for (const item of items) {
      const id = item?.[idField];
      if (!id) diagnostics.push(diagnostic('document.id_missing', `${name} item is missing ${idField}.`, name));
      else if (ids.has(id)) diagnostics.push(diagnostic('document.id_duplicate', `Duplicate mechanics ID: ${id}.`, id));
      else ids.add(id);
    }
  }

  const assemblyIds = new Set((document.assemblies ?? []).map((item) => item.assemblyId));
  const constraintIds = new Set((document.constraints ?? []).map((item) => item.constraintId));
  const constraintById = new Map((document.constraints ?? []).map((item) => [item.constraintId, item]));
  const deviceIds = new Set((document.spellDevices ?? []).map((item) => item.deviceId));
  const gateIds = new Set((document.gates ?? []).map((item) => item.gateId));

  for (const assembly of document.assemblies ?? []) {
    checkTransform(diagnostics, assembly.transform, assembly.assemblyId, 'assembly transform');
    if (!Array.isArray(assembly.parts) || assembly.parts.length === 0) {
      diagnostics.push(diagnostic('assembly.empty', `${assembly.label ?? assembly.assemblyId} has no shapes.`, assembly.assemblyId));
      continue;
    }
    for (const part of assembly.parts) {
      if (!['cuboid', 'sphere', 'cylinder', 'wedge', 'cogwheel'].includes(part.shape)) {
        diagnostics.push(diagnostic('part.shape_unsupported', `Unsupported shape: ${part.shape}.`, part.partId));
      }
      if (!MECHANICAL_MATERIALS[part.materialId]) {
        diagnostics.push(diagnostic('part.material_unknown', `Unknown material: ${part.materialId}.`, part.partId));
      }
      if ([part.size?.x, part.size?.y, part.size?.z].some((value) => !isFinitePositive(value))) {
        diagnostics.push(diagnostic('part.size_invalid', 'Shape dimensions must be greater than zero.', part.partId));
      }
      checkTransform(diagnostics, part.localTransform, part.partId, 'shape transform');
    }
    const partIds = new Set(assembly.parts.map((part) => part.partId));
    const referencedParts = new Set();
    const nodeIds = new Set();
    const visitChildren = (children) => {
      if (!Array.isArray(children)) {
        diagnostics.push(diagnostic('assembly.structure_invalid', 'Assembly contents must be an array.', assembly.assemblyId));
        return;
      }
      for (const node of children) {
        if (!node?.nodeId || nodeIds.has(node.nodeId)) {
          diagnostics.push(diagnostic('assembly.node_id_invalid', 'Assembly content IDs must be present and unique.', assembly.assemblyId));
          continue;
        }
        nodeIds.add(node.nodeId);
        if (node.kind === 'shape') {
          if (!partIds.has(node.partId) || referencedParts.has(node.partId)) {
            diagnostics.push(diagnostic('assembly.part_reference_invalid', 'Each shape must appear exactly once in the assembly hierarchy.', assembly.assemblyId));
          }
          referencedParts.add(node.partId);
        } else if (node.kind === 'assembly') {
          visitChildren(node.children);
        } else {
          diagnostics.push(diagnostic('assembly.node_kind_invalid', 'Assembly contents must be shapes or assemblies.', assembly.assemblyId));
        }
      }
    };
    visitChildren(assembly.structure?.children);
    if (referencedParts.size !== partIds.size) {
      diagnostics.push(diagnostic('assembly.structure_incomplete', 'Every shape must belong to the assembly hierarchy.', assembly.assemblyId));
    }
  }

  const connectedPairs = new Set();
  for (const constraint of document.constraints ?? []) {
    checkAssemblyRef(diagnostics, assemblyIds, constraint.assemblyAId, constraint.constraintId, 'assemblyAId');
    if (constraint.assemblyBId) {
      checkAssemblyRef(diagnostics, assemblyIds, constraint.assemblyBId, constraint.constraintId, 'assemblyBId');
    }
    if (constraint.assemblyAId && constraint.assemblyAId === constraint.assemblyBId) {
      diagnostics.push(diagnostic('constraint.same_body', 'A constraint cannot connect an assembly to itself.', constraint.constraintId));
    }
    if (constraint.assemblyAId && constraint.assemblyBId) {
      const pair = [constraint.assemblyAId, constraint.assemblyBId].sort().join('|');
      if (connectedPairs.has(pair)) {
        diagnostics.push(
          diagnostic(
            'constraint.duplicate_pair',
            'Two assemblies cannot have multiple competing primary joints.',
            constraint.constraintId,
          ),
        );
      }
      connectedPairs.add(pair);
    }
    checkVector(diagnostics, constraint.localAnchorA, constraint.constraintId, 'localAnchorA');
    checkVector(diagnostics, constraint.localAnchorB, constraint.constraintId, 'localAnchorB');
    checkVector(diagnostics, constraint.localAxisA, constraint.constraintId, 'localAxisA');
    if (
      ['revolute', 'prismatic'].includes(constraint.type)
      && (!isFiniteVector(constraint.localAxisA) || vectorLength(constraint.localAxisA ?? {}) < 0.001)
    ) {
      diagnostics.push(diagnostic('constraint.axis_invalid', 'Hinge and slider axes cannot be zero-length.', constraint.constraintId));
    }
    if (
      constraint.limits?.enabled
      && (!isFiniteNumber(constraint.limits.min)
        || !isFiniteNumber(constraint.limits.max)
        || !(constraint.limits.min < constraint.limits.max))
    ) {
      diagnostics.push(diagnostic('constraint.limits_invalid', 'Constraint minimum must be below its maximum.', constraint.constraintId));
    }
    if (constraint.drive) {
      checkFiniteScalar(diagnostics, constraint.drive.targetVelocity, constraint.constraintId, 'drive.targetVelocity');
      checkNonnegativeScalar(diagnostics, constraint.drive.damping, constraint.constraintId, 'drive.damping');
      checkNonnegativeScalar(diagnostics, constraint.drive.maxImpulse, constraint.constraintId, 'drive.maxImpulse');
    }
  }

  for (const element of document.forceElements ?? []) {
    checkAssemblyRef(diagnostics, assemblyIds, element.assemblyAId, element.forceElementId, 'assemblyAId');
    if (element.assemblyBId) checkAssemblyRef(diagnostics, assemblyIds, element.assemblyBId, element.forceElementId, 'assemblyBId');
    if (element.assemblyAId && element.assemblyAId === element.assemblyBId) {
      diagnostics.push(diagnostic('force_element.same_body', 'A spring cannot connect an assembly to itself.', element.forceElementId));
    }
    checkVector(diagnostics, element.localAnchorA, element.forceElementId, 'localAnchorA');
    checkVector(diagnostics, element.localAnchorB, element.forceElementId, 'localAnchorB');
    if (element.type === 'linear_spring') {
      checkNonnegativeScalar(diagnostics, element.restLength, element.forceElementId, 'restLength');
    } else {
      checkFiniteScalar(diagnostics, element.restAngle, element.forceElementId, 'restAngle');
    }
    checkNonnegativeScalar(diagnostics, element.stiffness, element.forceElementId, 'stiffness');
    checkNonnegativeScalar(diagnostics, element.damping, element.forceElementId, 'damping');
    checkNonnegativeScalar(diagnostics, element.maxImpulse, element.forceElementId, 'maxImpulse');
    if (element.type === 'torsion_spring') {
      const hinge = constraintById.get(element.constraintId);
      if (!hinge) {
        diagnostics.push(diagnostic('spring.constraint_missing', 'Torsion spring needs an existing hinge.', element.forceElementId));
      } else {
        if (hinge.type !== 'revolute') {
          diagnostics.push(diagnostic('spring.constraint_incompatible', 'Torsion spring driver must be a revolute hinge.', element.forceElementId));
        }
        if (
          element.assemblyAId !== hinge.assemblyAId
          || element.assemblyBId !== hinge.assemblyBId
        ) {
          diagnostics.push(diagnostic('spring.endpoints_mismatch', 'Torsion spring endpoints must match its hinge endpoints.', element.forceElementId));
        }
      }
    }
  }

  for (const sensor of document.sensors ?? []) {
    if (sensor.assemblyId) checkAssemblyRef(diagnostics, assemblyIds, sensor.assemblyId, sensor.sensorId, 'assemblyId');
    if ([sensor.size?.x, sensor.size?.y, sensor.size?.z].some((value) => !isFinitePositive(value))) {
      diagnostics.push(diagnostic('sensor.size_invalid', 'Contact trigger dimensions must be finite and greater than zero.', sensor.sensorId));
    }
    checkTransform(diagnostics, sensor.localTransform, sensor.sensorId, 'sensor transform');
  }

  const sensorIds = new Set((document.sensors ?? []).map((item) => item.sensorId));
  for (const latch of document.latches ?? []) {
    checkAssemblyRef(diagnostics, assemblyIds, latch.assemblyAId, latch.latchId, 'assemblyAId');
    if (latch.assemblyBId) checkAssemblyRef(diagnostics, assemblyIds, latch.assemblyBId, latch.latchId, 'assemblyBId');
    if (latch.releaseSensorId && !sensorIds.has(latch.releaseSensorId)) {
      diagnostics.push(diagnostic('latch.sensor_missing', `Missing release trigger: ${latch.releaseSensorId}.`, latch.latchId));
    }
    if (latch.assemblyAId && latch.assemblyAId === latch.assemblyBId) {
      diagnostics.push(diagnostic('latch.same_body', 'A latch cannot connect an assembly to itself.', latch.latchId));
    }
    if (latch.localAnchorA) checkVector(diagnostics, latch.localAnchorA, latch.latchId, 'localAnchorA');
    if (latch.localAnchorB) checkVector(diagnostics, latch.localAnchorB, latch.latchId, 'localAnchorB');
    checkPositiveScalar(diagnostics, latch.catchDistance, latch.latchId, 'catchDistance');
    checkNonnegativeScalar(diagnostics, latch.catchSpeed, latch.latchId, 'catchSpeed');
  }

  for (const coupling of document.rotationCouplings ?? []) {
    checkAssemblyRef(diagnostics, assemblyIds, coupling.assemblyAId, coupling.couplingId, 'assemblyAId');
    checkAssemblyRef(diagnostics, assemblyIds, coupling.assemblyBId, coupling.couplingId, 'assemblyBId');
    if (coupling.assemblyAId && coupling.assemblyAId === coupling.assemblyBId) {
      diagnostics.push(diagnostic('coupling.same_body', 'A rotation coupling cannot connect an assembly to itself.', coupling.couplingId));
    }
    checkVector(diagnostics, coupling.axisA, coupling.couplingId, 'axisA');
    checkVector(diagnostics, coupling.axisB, coupling.couplingId, 'axisB');
    if (
      !isFiniteVector(coupling.axisA)
      || !isFiniteVector(coupling.axisB)
      || vectorLength(coupling.axisA) < 0.001
      || vectorLength(coupling.axisB) < 0.001
    ) {
      diagnostics.push(diagnostic('coupling.axis_invalid', 'Coupling axes must be finite and non-zero.', coupling.couplingId));
    }
    if (!isFiniteNumber(coupling.ratio) || Math.abs(Number(coupling.ratio)) < 0.01) {
      diagnostics.push(diagnostic('coupling.ratio_invalid', 'Gear ratio cannot be zero.', coupling.couplingId));
    }
    checkFiniteScalar(diagnostics, coupling.phaseOffset, coupling.couplingId, 'phaseOffset');
    checkNonnegativeScalar(diagnostics, coupling.torqueCapacity, coupling.couplingId, 'torqueCapacity');
    checkNonnegativeScalar(diagnostics, coupling.stiffness, coupling.couplingId, 'stiffness');
    checkNonnegativeScalar(diagnostics, coupling.damping, coupling.couplingId, 'damping');
    if (!isFiniteNumber(coupling.efficiency) || coupling.efficiency <= 0 || coupling.efficiency > 1) {
      diagnostics.push(diagnostic('numeric.range_invalid', 'efficiency must be finite and inside (0, 1].', coupling.couplingId));
    }
  }

  for (const device of document.spellDevices ?? []) {
    checkAssemblyRef(diagnostics, assemblyIds, device.assemblyId, device.deviceId, 'assemblyId');
    if (device.plateRadius != null && !isFinitePositive(device.plateRadius)) {
      diagnostics.push(diagnostic('spell_device.radius_invalid', 'Spell plate radius must be greater than zero.', device.deviceId));
    }
    checkVector(diagnostics, device.localFrame?.origin, device.deviceId, 'localFrame.origin');
    checkVector(diagnostics, device.localFrame?.normal, device.deviceId, 'localFrame.normal');
    checkVector(diagnostics, device.localFrame?.tangent, device.deviceId, 'localFrame.tangent');
    if (isFiniteVector(device.localFrame?.normal) && vectorLength(device.localFrame.normal) < 0.001) {
      diagnostics.push(diagnostic('spell_device.frame_invalid', 'Spell plate normal cannot be zero-length.', device.deviceId));
    }
    if (isFiniteVector(device.localFrame?.tangent) && vectorLength(device.localFrame.tangent) < 0.001) {
      diagnostics.push(diagnostic('spell_device.frame_invalid', 'Spell plate tangent cannot be zero-length.', device.deviceId));
    }
    checkNonnegativeScalar(diagnostics, device.forceScale, device.deviceId, 'forceScale');
    if (device.gateId && !gateIds.has(device.gateId)) {
      diagnostics.push(diagnostic('spell_device.gate_missing', `Missing gate: ${device.gateId}.`, device.deviceId));
    }
  }

  for (const gate of document.gates ?? []) {
    if (!deviceIds.has(gate.plateDeviceId)) {
      diagnostics.push(diagnostic('gate.device_missing', `Missing spell plate: ${gate.plateDeviceId}.`, gate.gateId));
    }
    const driver = constraintById.get(gate.driverConstraintId);
    if (!driver) {
      diagnostics.push(diagnostic('gate.driver_missing', `Missing gate driver: ${gate.driverConstraintId}.`, gate.gateId));
    } else if (
      (gate.type === 'rotary_cam_gate' && driver.type !== 'revolute')
      || (gate.type === 'sliding_ring_gate' && driver.type !== 'prismatic')
    ) {
      diagnostics.push(diagnostic('gate.driver_incompatible', `${gate.type} has an incompatible ${driver.type} driver.`, gate.gateId));
    }
    if (
      !isFiniteNumber(gate.closedRange?.min)
      || !isFiniteNumber(gate.closedRange?.max)
      || gate.closedRange.min > gate.closedRange.max
    ) {
      diagnostics.push(diagnostic('gate.range_invalid', 'Gate closed range must contain finite ordered values.', gate.gateId));
    }
    if (
      !Array.isArray(gate.closedWindows)
      || gate.closedWindows.length === 0
      || gate.closedWindows.some((window) =>
        !isFiniteNumber(window?.startRadians) || !isFiniteNumber(window?.endRadians))
    ) {
      diagnostics.push(diagnostic('gate.windows_invalid', 'Rotary gate windows must contain finite angles.', gate.gateId));
    }
    checkFiniteScalar(diagnostics, gate.phaseOffsetRadians, gate.gateId, 'phaseOffsetRadians');
    checkNonnegativeScalar(diagnostics, gate.lateralTolerance, gate.gateId, 'lateralTolerance');
    checkNonnegativeScalar(diagnostics, gate.angularToleranceRadians, gate.gateId, 'angularToleranceRadians');
    checkNonnegativeScalar(diagnostics, gate.hysteresis, gate.gateId, 'hysteresis');
  }

  return { ok: diagnostics.every((item) => item.severity !== 'error'), diagnostics };
}

function checkAssemblyRef(diagnostics, ids, value, ownerId, field) {
  if (!value || !ids.has(value)) {
    diagnostics.push(diagnostic('document.assembly_reference_missing', `${ownerId} has an invalid ${field}: ${value ?? 'none'}.`, ownerId));
  }
}

function diagnostic(code, message, targetId = null, severity = 'error') {
  return { code, severity, message, targetId };
}

function isFiniteNumber(value) {
  return value !== null && value !== '' && Number.isFinite(Number(value));
}

function isFinitePositive(value) {
  return isFiniteNumber(value) && Number(value) > 0;
}

function isFiniteVector(value) {
  return value != null && [value.x, value.y, value.z].every(isFiniteNumber);
}

function checkVector(diagnostics, value, ownerId, field) {
  if (!isFiniteVector(value)) {
    diagnostics.push(diagnostic('numeric.vector_invalid', `${field} must contain finite x, y, and z values.`, ownerId));
  }
}

function checkTransform(diagnostics, transform, ownerId, field) {
  checkVector(diagnostics, transform?.position, ownerId, `${field}.position`);
  const rotation = transform?.rotation;
  if (!rotation || ![rotation.x, rotation.y, rotation.z, rotation.w].every(isFiniteNumber)) {
    diagnostics.push(diagnostic('numeric.rotation_invalid', `${field}.rotation must contain finite x, y, z, and w values.`, ownerId));
  }
}

function checkFiniteScalar(diagnostics, value, ownerId, field) {
  if (!isFiniteNumber(value)) {
    diagnostics.push(diagnostic('numeric.scalar_invalid', `${field} must be finite.`, ownerId));
  }
}

function checkPositiveScalar(diagnostics, value, ownerId, field) {
  if (!isFinitePositive(value)) {
    diagnostics.push(diagnostic('numeric.range_invalid', `${field} must be finite and greater than zero.`, ownerId));
  }
}

function checkNonnegativeScalar(diagnostics, value, ownerId, field) {
  if (!isFiniteNumber(value) || Number(value) < 0) {
    diagnostics.push(diagnostic('numeric.range_invalid', `${field} must be finite and nonnegative.`, ownerId));
  }
}
