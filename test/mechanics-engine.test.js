import test from 'node:test';
import assert from 'node:assert/strict';
import {
  angleInWindow,
  computeGearCoupling,
  constraintConnectionPoints,
  copyMechanicsSelection,
  createAssembly,
  createConstraint,
  createForceElement,
  createGate,
  createLatch,
  createMechanicsDocument,
  createPrimitivePart,
  createRotationCoupling,
  createSensor,
  createSpellDevice,
  glueAssemblies,
  migrateMechanicsDocument,
  pasteMechanicsSelection,
  planCogwheelPlacement,
  quaternionFromAxisAngle,
  removeMechanicsItem,
  resolveRotaryGate,
  rotaryGateDriverAngle,
  resolveLatchTransition,
  resolveSlidingGate,
  assemblyNodeDescriptor,
  descendantPartIds,
  scaleHierarchyNode,
  transformPoint,
  transformDirection,
  unglueAssembly,
  updateHierarchyNode,
  validateMechanicsDocument,
} from '../src/mechanics-engine/index.js';

test('mechanics documents start versioned and dependency-free', () => {
  const document = createMechanicsDocument();
  assert.equal(document.schemaVersion, 3);
  assert.deepEqual(document.assemblies, []);
  assert.deepEqual(document.gates, []);
});

test('assemblies normalize persistent editor visibility without changing physical fields', () => {
  const assembly = createAssembly({
    assemblyId: 'assembly:editor-options',
    editor: { opacity: 0.35, clickThrough: true },
  });
  assert.deepEqual(assembly.editor, { opacity: 0.35, clickThrough: true });
  assert.equal(assembly.bodyMode, 'dynamic');

  const restored = createMechanicsDocument({ assemblies: [assembly] }).assemblies[0];
  assert.deepEqual(restored.editor, assembly.editor);
});

test('inferred joint hardware stays attached to its authored body surfaces at runtime', () => {
  const document = createMechanicsDocument({
    assemblies: [
      createAssembly({
        assemblyId: 'assembly:frame',
        bodyMode: 'fixed',
        transform: { position: { x: 0, y: 0, z: 0 } },
        parts: [
          createPrimitivePart({
            partId: 'part:left',
            size: { x: 0.2, y: 1, z: 2 },
            localTransform: { position: { x: -1, y: 0, z: 0 } },
          }),
          createPrimitivePart({
            partId: 'part:right',
            size: { x: 0.2, y: 1, z: 2 },
            localTransform: { position: { x: 1, y: 0, z: 0 } },
          }),
        ],
      }),
      createAssembly({
        assemblyId: 'assembly:slider',
        transform: { position: { x: -0.75, y: 1, z: 0 } },
        parts: [
          createPrimitivePart({
            partId: 'part:slider',
            size: { x: 0.3, y: 0.2, z: 0.3 },
          }),
        ],
      }),
    ],
    constraints: [
      createConstraint({
        constraintId: 'constraint:slider',
        type: 'prismatic',
        assemblyAId: 'assembly:frame',
        assemblyBId: 'assembly:slider',
        localAxisA: { x: 0, y: 1, z: 0 },
      }),
    ],
  });
  const constraint = document.constraints[0];
  const authored = constraintConnectionPoints(document, constraint);
  const runtime = constraintConnectionPoints(document, constraint, {
    'assembly:frame': document.assemblies[0].transform,
    'assembly:slider': {
      position: { x: 0.75, y: 0.5, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    },
  });

  assert.deepEqual(runtime.pointA, authored.pointA, 'fixed-side hardware must not switch faces');
  assert.ok(
    Math.abs(runtime.pointB.x - (authored.pointB.x + 1.5)) < 1e-9,
    'moving-side hardware follows the same body-local point',
  );
  assert.ok(Math.abs(runtime.pointB.y - (authored.pointB.y - 0.5)) < 1e-9);
});

test('glue converts selected parts into one compound assembly while preserving world positions', () => {
  const document = createMechanicsDocument({
    assemblies: [
      createAssembly({
        assemblyId: 'assembly:1',
        transform: { position: { x: 2, y: 0, z: 0 } },
        parts: [createPrimitivePart({ partId: 'part:1', preset: 'cuboid' })],
      }),
      createAssembly({
        assemblyId: 'assembly:2',
        transform: { position: { x: 4, y: 1, z: 0 } },
        parts: [createPrimitivePart({ partId: 'part:2', preset: 'sphere' })],
      }),
    ],
  });

  const result = glueAssemblies(document, ['assembly:1', 'assembly:2']);
  assert.equal(result.changed, true);
  assert.equal(result.document.assemblies.length, 1);
  const merged = result.document.assemblies[0];
  assert.equal(merged.parts.length, 2);
  assert.deepEqual(merged.transform.position, { x: 2, y: 0, z: 0 });
  assert.deepEqual(merged.parts[1].localTransform.position, { x: 2, y: 1, z: 0 });
  assert.equal(document.assemblies.length, 2, 'operation does not mutate the source document');
});

test('glue preserves rotated part world transforms', () => {
  const quarterTurn = quaternionFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
  const document = createMechanicsDocument({
    assemblies: [
      createAssembly({ assemblyId: 'assembly:1', transform: { rotation: quarterTurn } }),
      createAssembly({
        assemblyId: 'assembly:2',
        transform: { position: { x: 1, y: 0, z: 0 }, rotation: quarterTurn },
      }),
    ],
  });
  const merged = glueAssemblies(document, ['assembly:1', 'assembly:2']).document.assemblies[0];
  assert.ok(Math.abs(merged.parts[1].localTransform.position.z - 1) < 1e-6);
  assert.ok(Math.abs(merged.parts[1].localTransform.position.x) < 1e-6);
});

test('glue preserves external coupling axes in world space', () => {
  const quarterTurn = quaternionFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2);
  const document = createMechanicsDocument({
    assemblies: [
      createAssembly({ assemblyId: 'assembly:root' }),
      createAssembly({ assemblyId: 'assembly:rotated', transform: { rotation: quarterTurn } }),
      createAssembly({ assemblyId: 'assembly:external' }),
    ],
    rotationCouplings: [
      createRotationCoupling({
        couplingId: 'coupling:external',
        assemblyAId: 'assembly:rotated',
        assemblyBId: 'assembly:external',
        axisA: { x: 1, y: 0, z: 0 },
      }),
    ],
  });
  const before = transformDirection(
    document.assemblies[1].transform,
    document.rotationCouplings[0].axisA,
  );
  const result = glueAssemblies(document, ['assembly:root', 'assembly:rotated']);
  const merged = result.document.assemblies.find((item) => item.assemblyId === 'assembly:root');
  const coupling = result.document.rotationCouplings[0];
  const after = transformDirection(merged.transform, coupling.axisA);

  assert.ok(Math.abs(after.x - before.x) < 1e-9);
  assert.ok(Math.abs(after.y - before.y) < 1e-9);
  assert.ok(Math.abs(after.z - before.z) < 1e-9);
});

test('remove and glue repair dependent references instead of committing invalid documents', () => {
  const assemblies = [
    createAssembly({ assemblyId: 'assembly:a' }),
    createAssembly({ assemblyId: 'assembly:b' }),
  ];
  const document = createMechanicsDocument({
    assemblies,
    constraints: [
      createConstraint({
        constraintId: 'constraint:driver',
        assemblyAId: 'assembly:a',
        assemblyBId: 'assembly:b',
      }),
    ],
    forceElements: [
      createForceElement({
        forceElementId: 'spring:torsion',
        type: 'torsion_spring',
        assemblyAId: 'assembly:a',
        assemblyBId: 'assembly:b',
        constraintId: 'constraint:driver',
      }),
    ],
    sensors: [createSensor({ sensorId: 'sensor:release', assemblyId: 'assembly:a' })],
    latches: [
      createLatch({
        latchId: 'latch:triggered',
        assemblyAId: 'assembly:a',
        assemblyBId: 'assembly:b',
        releaseSensorId: 'sensor:release',
      }),
    ],
    spellDevices: [
      createSpellDevice({
        deviceId: 'device:gated',
        assemblyId: 'assembly:a',
        gateId: 'gate:driver',
      }),
    ],
    gates: [
      createGate({
        gateId: 'gate:driver',
        type: 'rotary_cam_gate',
        plateDeviceId: 'device:gated',
        driverConstraintId: 'constraint:driver',
      }),
    ],
  });

  const withoutSensor = removeMechanicsItem(document, 'sensor:release').document;
  assert.equal(withoutSensor.latches[0].releaseSensorId, null);
  assert.equal(validateMechanicsDocument(withoutSensor).ok, true);

  const withoutConstraint = removeMechanicsItem(document, 'constraint:driver').document;
  assert.deepEqual(withoutConstraint.forceElements, []);
  assert.deepEqual(withoutConstraint.gates, []);
  assert.equal(withoutConstraint.spellDevices[0].gateId, null);
  assert.equal(validateMechanicsDocument(withoutConstraint).ok, true);

  const withoutGate = removeMechanicsItem(document, 'gate:driver').document;
  assert.equal(withoutGate.spellDevices[0].gateId, null);
  assert.equal(validateMechanicsDocument(withoutGate).ok, true);

  const glued = glueAssemblies(document, ['assembly:a', 'assembly:b']).document;
  assert.deepEqual(glued.constraints, []);
  assert.deepEqual(glued.forceElements, []);
  assert.deepEqual(glued.gates, []);
  assert.equal(glued.spellDevices[0].gateId, null);
  assert.equal(validateMechanicsDocument(glued).ok, true);
});

test('unglue restores separate assemblies at each part world transform', () => {
  const glued = createMechanicsDocument({
    assemblies: [
      createAssembly({
        assemblyId: 'assembly:glued',
        transform: { position: { x: 3, y: 1, z: -1 } },
        parts: [
          createPrimitivePart({ partId: 'part:a', preset: 'beam' }),
          createPrimitivePart({
            partId: 'part:b',
            preset: 'sphere',
            localTransform: { position: { x: 1, y: 0.5, z: 0 } },
          }),
        ],
      }),
    ],
  });
  const result = unglueAssembly(glued, 'assembly:glued');
  assert.equal(result.document.assemblies.length, 2);
  assert.deepEqual(result.document.assemblies[1].transform.position, { x: 4, y: 1.5, z: -1 });
});

test('nested glue preserves immediate sub-assemblies instead of flattening to root shapes', () => {
  const first = createMechanicsDocument({
    assemblies: [
      createAssembly({ assemblyId: 'assembly:a', label: 'A' }),
      createAssembly({ assemblyId: 'assembly:b', label: 'B', transform: { position: { x: 2, y: 0, z: 0 } } }),
    ],
  });
  const ab = glueAssemblies(first, ['assembly:a', 'assembly:b']).document.assemblies[0];
  const withThird = createMechanicsDocument({
    ...first,
    assemblies: [
      ab,
      createAssembly({ assemblyId: 'assembly:c', label: 'C', transform: { position: { x: 4, y: 0, z: 0 } } }),
    ],
  });
  const nested = glueAssemblies(withThird, [ab.assemblyId, 'assembly:c']).document.assemblies[0];

  assert.equal(nested.structure.children.length, 2);
  assert.equal(nested.structure.children[0].kind, 'assembly');
  assert.equal(nested.structure.children[0].children.length, 2);
  assert.equal(descendantPartIds(nested, nested.structure.children[0].nodeId).length, 2);
  assert.equal(nested.parts.length, 3, 'physics leaves remain available without becoming the UI hierarchy');
  const scaledNested = scaleHierarchyNode(
    nested,
    nested.structure.children[0].nodeId,
    { x: 2, y: 2, z: 2 },
  );
  assert.equal(
    scaledNested.structure.children[0].children[1].localTransform.position.x,
    4,
    'nested child coordinates stay consistent with baked leaf geometry after parent resizing',
  );

  const separated = unglueAssembly(
    createMechanicsDocument({ assemblies: [nested] }),
    nested.assemblyId,
  );
  assert.equal(separated.document.assemblies.length, 2);
  assert.equal(separated.document.assemblies[0].structure.children.length, 2);
});

test('nested assembly and leaf transforms update only their descendant geometry', () => {
  const source = createMechanicsDocument({
    assemblies: [
      createAssembly({ assemblyId: 'assembly:a', label: 'A' }),
      createAssembly({ assemblyId: 'assembly:b', label: 'B', transform: { position: { x: 2, y: 0, z: 0 } } }),
    ],
  });
  const assembly = glueAssemblies(source, ['assembly:a', 'assembly:b']).document.assemblies[0];
  const group = assembly.structure.children[1];
  const untouched = assembly.parts[0].localTransform.position;
  const moved = updateHierarchyNode(assembly, group.nodeId, {
    localTransform: { position: { x: 3 } },
  });
  assert.deepEqual(moved.parts[0].localTransform.position, untouched);
  assert.equal(moved.parts[1].localTransform.position.x, 3);

  const shapeId = group.children[0].nodeId;
  const resized = scaleHierarchyNode(moved, shapeId, { x: 2, y: 1, z: 1 });
  assert.equal(resized.parts[1].size.x, moved.parts[1].size.x * 2);
  assert.equal(assemblyNodeDescriptor(resized, shapeId).kind, 'shape');
});

test('v1 mechanics documents migrate flat shapes into the current hierarchy schema', () => {
  const legacy = {
    schemaVersion: 1,
    assemblies: [{
      assemblyId: 'assembly:legacy',
      label: 'Legacy',
      bodyMode: 'dynamic',
      transform: { position: { x: 0, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
      parts: [createPrimitivePart({ partId: 'part:legacy' })],
      tags: [],
    }],
    constraints: [],
    forceElements: [],
    sensors: [],
    latches: [],
    rotationCouplings: [],
    spellDevices: [],
    gates: [],
    metadata: {},
  };
  const migration = migrateMechanicsDocument(legacy);
  assert.equal(migration.document.schemaVersion, 3);
  assert.ok(migration.migrations.includes('v1_to_v2_assembly_hierarchy'));
  assert.deepEqual(migration.document.assemblies[0].structure.children, [
    { kind: 'shape', nodeId: 'part:legacy', partId: 'part:legacy' },
  ]);
  assert.equal(validateMechanicsDocument(migration.document).ok, true);
});

test('schema-v2 split joint anchors migrate to visual contacts plus one shared physics pivot', () => {
  const legacy = createMechanicsDocument({
    assemblies: [
      createAssembly({ assemblyId: 'assembly:a', bodyMode: 'fixed' }),
      createAssembly({
        assemblyId: 'assembly:b',
        transform: { position: { x: 2, y: 0, z: 0 } },
      }),
    ],
    constraints: [
      {
        ...createConstraint({
          constraintId: 'constraint:legacy',
          assemblyAId: 'assembly:a',
          assemblyBId: 'assembly:b',
        }),
        surfaceAnchorA: true,
        surfaceAnchorB: true,
      },
    ],
  });
  legacy.schemaVersion = 2;
  const result = migrateMechanicsDocument(legacy);
  const joint = result.document.constraints[0];
  const assemblyA = result.document.assemblies[0];
  const assemblyB = result.document.assemblies[1];
  assert.equal(result.document.schemaVersion, 3);
  assert.ok(result.migrations.includes('v2_to_v3_connection_anchor_frames'));
  assert.equal(joint.surfaceAnchorA, undefined);
  assert.equal(joint.surfaceAnchorB, undefined);
  assert.deepEqual(joint.connectionAnchorA, { x: 0, y: 0, z: 0 });
  assert.deepEqual(joint.connectionAnchorB, { x: 0, y: 0, z: 0 });
  assert.deepEqual(
    transformPoint(assemblyA.transform, joint.localAnchorA),
    transformPoint(assemblyB.transform, joint.localAnchorB),
  );
});

test('sliding gate requires travel and alignment, then uses hysteresis while seated', () => {
  const gate = createGate({
    gateId: 'gate:slide',
    closedRange: { min: 0.9, max: 1 },
    lateralTolerance: 0.02,
    angularToleranceRadians: 0.04,
    hysteresis: 0.03,
  });
  const open = resolveSlidingGate(gate, {
    normalizedPosition: 0.89,
    lateralError: 0,
    angularErrorRadians: 0,
  });
  assert.equal(open.closed, false);
  assert.equal(open.reason, 'slider_outside_closed_range');

  const closed = resolveSlidingGate(gate, {
    normalizedPosition: 0.95,
    lateralError: 0.01,
    angularErrorRadians: 0.02,
  }, open);
  assert.equal(closed.closed, true);
  assert.equal(closed.transition, 'closed');

  const held = resolveSlidingGate(gate, {
    normalizedPosition: 0.88,
    lateralError: 0.01,
    angularErrorRadians: 0.02,
  }, closed);
  assert.equal(held.closed, true);
  assert.equal(held.transition, null);
});

test('sliding gate diagnoses lateral and angular misalignment independently', () => {
  const gate = createGate();
  assert.equal(
    resolveSlidingGate(gate, { normalizedPosition: 1, lateralError: 1 }).reason,
    'ring_bridge_lateral_misalignment',
  );
  assert.equal(
    resolveSlidingGate(gate, { normalizedPosition: 1, angularErrorRadians: 1 }).reason,
    'ring_bridge_angular_misalignment',
  );
});

test('rotary gate activation windows work across the minus-pi/pi boundary', () => {
  const gate = createGate({
    gateId: 'gate:cam',
    type: 'rotary_cam_gate',
    closedWindows: [{ startRadians: 3.05, endRadians: -3.05 }],
  });
  assert.equal(resolveRotaryGate(gate, { angleRadians: Math.PI }).closed, true);
  assert.equal(resolveRotaryGate(gate, { angleRadians: 0 }).closed, false);
  assert.equal(angleInWindow(-3.1, 3.05, -3.05), true);
});

test('rotary gate reports only real open/close transitions', () => {
  const gate = createGate({ type: 'rotary_cam_gate' });
  const open = resolveRotaryGate(gate, { angleRadians: 1 });
  const closed = resolveRotaryGate(gate, { angleRadians: 0 }, open);
  const held = resolveRotaryGate(gate, { angleRadians: 0.05 }, closed);
  assert.equal(closed.transition, 'closed');
  assert.equal(held.transition, null);
});

test('rotary gate visual windows invert the resolver phase offset', () => {
  const offset = 0.7;
  const driverAngle = rotaryGateDriverAngle(0, offset);
  const gate = createGate({
    type: 'rotary_cam_gate',
    phaseOffsetRadians: offset,
    closedWindows: [{ startRadians: -0.01, endRadians: 0.01 }],
  });
  assert.equal(resolveRotaryGate(gate, { angleRadians: driverAngle }).closed, true);
});

test('catch and manual latches have deterministic arm, eligibility, and release transitions', () => {
  const catchLatch = { mode: 'catch', armed: false, catchDistance: 0.25, catchSpeed: 2 };
  const armed = resolveLatchTransition(catchLatch, { state: 'released', armed: false }, { type: 'arm' });
  assert.deepEqual(
    { state: armed.state, armed: armed.armed, command: armed.command },
    { state: 'open', armed: true, command: null },
  );
  const missed = resolveLatchTransition(catchLatch, armed, {
    type: 'proximity',
    distance: 0.1,
    relativeSpeed: 4,
  });
  assert.equal(missed.state, 'open');
  const caught = resolveLatchTransition(catchLatch, missed, {
    type: 'proximity',
    distance: 0.1,
    relativeSpeed: 0.5,
  });
  assert.equal(caught.state, 'latched');
  assert.equal(caught.command, 'lock');
  assert.equal(resolveLatchTransition(catchLatch, caught, { type: 'release' }).command, 'unlock');

  const manual = resolveLatchTransition(
    { mode: 'manual', armed: false },
    { state: 'open', armed: false },
    { type: 'arm' },
  );
  assert.equal(manual.state, 'latched');
  assert.equal(manual.command, 'lock');
});

test('gear coupling requests opposite-direction ratio and caps torque with slip', () => {
  const coupling = createRotationCoupling({ ratio: -2, torqueCapacity: 5, stiffness: 30, damping: 5 });
  const result = computeGearCoupling(
    coupling,
    { angleA: 1, angleB: 0, velocityA: 8, velocityB: 0 },
    1 / 120,
  );
  assert.equal(result.ratio, -2);
  assert.equal(result.slipped, true);
  assert.ok(Math.abs(result.torqueB) <= 5);
  assert.equal(Math.sign(result.torqueA), Math.sign(result.torqueB));
});

test('gear coupling is quiet when phase and velocity satisfy the ratio', () => {
  const coupling = createRotationCoupling({ ratio: -2, phaseOffset: 0.3 });
  const result = computeGearCoupling(coupling, {
    angleA: 0.4,
    angleB: -0.5,
    velocityA: 3,
    velocityB: -6,
  });
  assert.ok(Math.abs(result.phaseError) < 1e-8);
  assert.ok(Math.abs(result.velocityError) < 1e-8);
  assert.ok(Math.abs(result.torqueA) < 1e-8);
});

test('cog snapping preserves the cursor angle in a vertically rotated wheel plane', () => {
  const verticalRotation = quaternionFromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 2);
  const document = createMechanicsDocument({
    assemblies: [
      createAssembly({
        assemblyId: 'assembly:vertical-cog',
        transform: {
          position: { x: 2, y: 3, z: 4 },
          rotation: verticalRotation,
        },
        parts: [
          createPrimitivePart({
            shape: 'cogwheel',
            size: { x: 1.6, y: 0.24, z: 1.6 },
            rotationPortAxis: { x: 0, y: 1, z: 0 },
          }),
        ],
      }),
    ],
  });

  const plan = planCogwheelPlacement(
    document,
    { x: 2.6, y: 3.8, z: 4 },
    'cog-small',
  );

  assert.equal(plan.snapped.targetAssemblyId, 'assembly:vertical-cog');
  assert.ok(Math.abs(plan.position.x - 2.72) < 1e-6);
  assert.ok(Math.abs(plan.position.y - 3.96) < 1e-6);
  assert.ok(Math.abs(plan.position.z - 4) < 1e-6);
});

test('cog snapping honors the cogwheel directly targeted by the pointer', () => {
  const cogPart = () =>
    createPrimitivePart({
      shape: 'cogwheel',
      size: { x: 1.6, y: 0.24, z: 1.6 },
      rotationPortAxis: { x: 0, y: 1, z: 0 },
    });
  const document = createMechanicsDocument({
    assemblies: [
      createAssembly({
        assemblyId: 'assembly:left-cog',
        transform: { position: { x: 0, y: 0.14, z: 0 } },
        parts: [cogPart()],
      }),
      createAssembly({
        assemblyId: 'assembly:right-cog',
        transform: { position: { x: 1, y: 0.14, z: 0 } },
        parts: [cogPart()],
      }),
    ],
  });

  const plan = planCogwheelPlacement(
    document,
    { x: 0.8, y: 0.14, z: 0.2 },
    'cog-small',
    { targetAssemblyId: 'assembly:left-cog' },
  );

  assert.equal(plan.snapped.targetAssemblyId, 'assembly:left-cog');
});

test('validation catches invalid references, axes, and missing gate drivers', () => {
  const document = createMechanicsDocument({
    assemblies: [createAssembly({ assemblyId: 'assembly:1' })],
    constraints: [
      createConstraint({
        constraintId: 'constraint:bad',
        assemblyAId: 'assembly:1',
        assemblyBId: 'assembly:missing',
        localAxisA: { x: 0, y: 0, z: 0 },
      }),
    ],
    spellDevices: [createSpellDevice({ deviceId: 'device:1', assemblyId: 'assembly:1', gateId: 'gate:1' })],
    gates: [createGate({ gateId: 'gate:1', plateDeviceId: 'device:1', driverConstraintId: 'constraint:missing' })],
  });
  const result = validateMechanicsDocument(document);
  assert.equal(result.ok, false);
  const codes = result.diagnostics.map((item) => item.code);
  assert.ok(codes.includes('document.assembly_reference_missing'));
  assert.ok(codes.includes('constraint.axis_invalid'));
  assert.ok(codes.includes('gate.driver_missing'));
});

test('validation rejects incompatible relationships and non-finite physical values', () => {
  const document = createMechanicsDocument({
    assemblies: [
      createAssembly({ assemblyId: 'assembly:a' }),
      createAssembly({ assemblyId: 'assembly:b' }),
    ],
    constraints: [
      createConstraint({
        constraintId: 'constraint:slider',
        type: 'prismatic',
        assemblyAId: 'assembly:a',
        assemblyBId: 'assembly:b',
      }),
    ],
    forceElements: [
      createForceElement({
        forceElementId: 'spring:bad',
        type: 'torsion_spring',
        assemblyAId: 'assembly:b',
        assemblyBId: 'assembly:a',
        constraintId: 'constraint:slider',
        stiffness: Infinity,
      }),
    ],
    latches: [createLatch({ latchId: 'latch:self', assemblyAId: 'assembly:a', assemblyBId: 'assembly:a' })],
    rotationCouplings: [createRotationCoupling({
      couplingId: 'coupling:self',
      assemblyAId: 'assembly:a',
      assemblyBId: 'assembly:a',
      ratio: NaN,
    })],
    spellDevices: [createSpellDevice({ deviceId: 'device:bad', assemblyId: 'assembly:a', gateId: 'gate:bad' })],
    gates: [createGate({
      gateId: 'gate:bad',
      type: 'rotary_cam_gate',
      plateDeviceId: 'device:bad',
      driverConstraintId: 'constraint:slider',
      hysteresis: Infinity,
    })],
  });
  const codes = validateMechanicsDocument(document).diagnostics.map((item) => item.code);
  assert.ok(codes.includes('spring.constraint_incompatible'));
  assert.ok(codes.includes('spring.endpoints_mismatch'));
  assert.ok(codes.includes('latch.same_body'));
  assert.ok(codes.includes('coupling.same_body'));
  assert.ok(codes.includes('coupling.ratio_invalid'));
  assert.ok(codes.includes('gate.driver_incompatible'));
  assert.ok(codes.includes('numeric.range_invalid'));
});

test('validation accepts a complete hinged spring spell-gate assembly', () => {
  const document = createMechanicsDocument({
    assemblies: [
      createAssembly({ assemblyId: 'assembly:base', bodyMode: 'fixed' }),
      createAssembly({ assemblyId: 'assembly:arm' }),
    ],
    constraints: [
      createConstraint({
        constraintId: 'constraint:hinge',
        assemblyAId: 'assembly:base',
        assemblyBId: 'assembly:arm',
      }),
    ],
    forceElements: [
      createForceElement({
        forceElementId: 'spring:1',
        type: 'torsion_spring',
        assemblyAId: 'assembly:base',
        assemblyBId: 'assembly:arm',
        constraintId: 'constraint:hinge',
      }),
    ],
    spellDevices: [
      createSpellDevice({ deviceId: 'device:1', assemblyId: 'assembly:arm', gateId: 'gate:1' }),
    ],
    gates: [
      createGate({
        gateId: 'gate:1',
        type: 'rotary_cam_gate',
        plateDeviceId: 'device:1',
        driverConstraintId: 'constraint:hinge',
      }),
    ],
  });
  assert.deepEqual(validateMechanicsDocument(document), { ok: true, diagnostics: [] });
});

test('copy and paste preserves internal relationships while remapping every stable ID', () => {
  const source = createMechanicsDocument({
    assemblies: [
      createAssembly({ assemblyId: 'assembly:1' }),
      createAssembly({ assemblyId: 'assembly:2', transform: { position: { x: 1, y: 0, z: 0 } } }),
    ],
    constraints: [
      createConstraint({
        constraintId: 'constraint:1',
        assemblyAId: 'assembly:1',
        assemblyBId: 'assembly:2',
      }),
    ],
    spellDevices: [
      createSpellDevice({
        deviceId: 'spell-device:1',
        assemblyId: 'assembly:1',
        gateId: 'gate:1',
      }),
    ],
    gates: [
      createGate({
        gateId: 'gate:1',
        type: 'rotary_cam_gate',
        plateDeviceId: 'spell-device:1',
        driverConstraintId: 'constraint:1',
      }),
    ],
  });
  const fragment = copyMechanicsSelection(source, ['assembly:1', 'assembly:2']);
  const result = pasteMechanicsSelection(source, fragment);
  assert.equal(result.changed, true);
  assert.deepEqual(result.assemblyIds, ['assembly:3', 'assembly:4']);
  assert.equal(result.document.constraints.at(-1).constraintId, 'constraint:2');
  assert.deepEqual(
    [result.document.constraints.at(-1).assemblyAId, result.document.constraints.at(-1).assemblyBId],
    ['assembly:3', 'assembly:4'],
  );
  assert.equal(result.document.spellDevices.at(-1).deviceId, 'spell-device:2');
  assert.equal(result.document.gates.at(-1).plateDeviceId, 'spell-device:2');
  assert.equal(result.document.gates.at(-1).driverConstraintId, 'constraint:2');
  assert.equal(validateMechanicsDocument(result.document).ok, true);
});

test('mechanics document migration fills newly introduced collections without losing assemblies', () => {
  const legacy = {
    schemaVersion: 1,
    assemblies: [createAssembly({ assemblyId: 'assembly:legacy' })],
    constraints: [],
    forceElements: [],
    sensors: [],
    rotationCouplings: [],
    spellDevices: [],
    gates: [],
    metadata: { name: 'Legacy build' },
  };
  const result = migrateMechanicsDocument(legacy);
  assert.equal(result.error, null);
  assert.deepEqual(result.document.latches, []);
  assert.equal(result.document.assemblies[0].assemblyId, 'assembly:legacy');
  assert.ok(result.migrations.some((item) => item.includes('latches')));
  assert.equal(validateMechanicsDocument(result.document).ok, true);
});
