import {
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
  quaternionFromAxisAngle,
} from '../../../src/mechanics-engine/index.js';

export const MECHANICS_STARTERS = [
  {
    starterId: 'blank',
    starterVersion: 1,
    label: 'Empty field',
    description: 'Start with ground, gravity, and a clean workbench.',
    create: createBlankDocument,
  },
  {
    starterId: 'catapult',
    starterVersion: 1,
    label: 'Spring catapult',
    description: 'A hinged arm, torsion spring, latch, falling trigger, and loose stone.',
    create: createCatapultDocument,
  },
  {
    starterId: 'pressure-plate',
    starterVersion: 3,
    label: 'Light pressure plate',
    description: 'A spring-loaded plate opens its underside Light dispersion only under real load.',
    create: createPressurePlateDocument,
  },
  {
    starterId: 'wind-gears',
    starterVersion: 4,
    label: 'Wind gear drive',
    description: 'Wind turns a paddle wheel, its axle drives a large cog, and that cog meshes with a smaller one.',
    create: createWindGearDocument,
  },
  {
    starterId: 'cam-waterer',
    starterVersion: 1,
    label: 'Cam garden waterer',
    description: 'One rotating shaft closes three water-spell gates in sequence.',
    create: createCamWatererDocument,
  },
];

export function mechanicsStarterDocument(starterId = 'blank') {
  const starter = MECHANICS_STARTERS.find((item) => item.starterId === starterId) ?? MECHANICS_STARTERS[0];
  const document = starter.create();
  return {
    ...document,
    metadata: {
      ...document.metadata,
      starterId: starter.starterId,
      starterVersion: starter.starterVersion,
    },
  };
}

export function createBlankDocument() {
  return createMechanicsDocument({
    metadata: {
      name: 'New contraption',
      description: 'An empty practice field.',
      revision: 0,
    },
  });
}

export function createCatapultDocument() {
  const base = createAssembly({
    assemblyId: 'assembly:catapult-base',
    label: 'Anchored base',
    bodyMode: 'fixed',
    transform: { position: { x: 0, y: 0.55, z: 0 } },
    parts: [
      part('part:base-deck', 'plate', { x: 3.1, y: 0.3, z: 2.2 }, { x: 0, y: -0.35, z: 0 }, 'material.wood_heavy'),
      part('part:left-support', 'beam', { x: 0.3, y: 1.5, z: 0.3 }, { x: -0.7, y: 0.45, z: 0 }, 'material.wood_heavy'),
      part('part:right-support', 'beam', { x: 0.3, y: 1.5, z: 0.3 }, { x: 0.7, y: 0.45, z: 0 }, 'material.wood_heavy'),
    ],
  });
  // A pure torsion machine: the wound coil at the pivot supplies the whole throw,
  // so there is no counterweight to muddy the story of where the energy comes from.
  const arm = createAssembly({
    assemblyId: 'assembly:catapult-arm',
    label: 'Throwing arm',
    transform: { position: { x: 0, y: 1.25, z: 0 } },
    tags: ['catapult-arm'],
    parts: [
      part('part:throwing-beam', 'beam', { x: 0.3, y: 0.24, z: 3.0 }, { x: 0, y: 0, z: 0.45 }),
      part('part:cup', 'plate', { x: 0.85, y: 0.16, z: 0.75 }, { x: 0, y: 0.18, z: 1.72 }),
      part('part:arm-heel', 'cuboid', { x: 0.42, y: 0.3, z: 0.5 }, { x: 0, y: -0.05, z: -0.85 }),
    ],
  });
  const stone = createAssembly({
    assemblyId: 'assembly:catapult-stone',
    label: 'Loose stone',
    transform: { position: { x: 0, y: 1.72, z: 1.7 } },
    tags: ['projectile'],
    parts: [part('part:stone', 'sphere', { x: 0.46, y: 0.46, z: 0.46 }, { x: 0, y: 0, z: 0 }, 'material.stone')],
  });
  const triggerWeight = createAssembly({
    assemblyId: 'assembly:trigger-weight',
    label: 'Trigger weight',
    transform: { position: { x: -2.25, y: 2.4, z: 0 } },
    tags: ['trigger-weight'],
    parts: [part('part:trigger-weight', 'sphere', { x: 0.5, y: 0.5, z: 0.5 }, { x: 0, y: 0, z: 0 }, 'material.stone')],
  });

  return createMechanicsDocument({
    metadata: {
      name: 'Spring catapult',
      description:
        'The copper coils flanking the pivot are wound 64°; the catch holds the arm level against them. The falling weight trips the release pad and the coils snap the arm up and over, hurling the stone.',
    },
    assemblies: [base, arm, stone, triggerWeight],
    constraints: [
      createConstraint({
        constraintId: 'constraint:catapult-pivot',
        label: 'Arm pivot',
        type: 'revolute',
        assemblyAId: base.assemblyId,
        assemblyBId: arm.assemblyId,
        localAnchorA: { x: 0, y: 0.7, z: 0 },
        localAnchorB: { x: 0, y: 0, z: 0 },
        localAxisA: { x: 1, y: 0, z: 0 },
        // Negative angles swing the cup upward; the stop sits just past vertical.
        limits: { enabled: true, min: -1.35, max: 0.25 },
      }),
    ],
    forceElements: [
      createForceElement({
        forceElementId: 'spring:catapult',
        label: 'Arm torsion spring',
        type: 'torsion_spring',
        assemblyAId: base.assemblyId,
        assemblyBId: arm.assemblyId,
        constraintId: 'constraint:catapult-pivot',
        // Rest angle is 1.12 rad of cup-up swing: latched level, the coil holds
        // that much twist and snaps the arm up-and-over on release.
        restAngle: -1.12,
        stiffness: 42,
        damping: 5,
        maxImpulse: 48,
      }),
    ],
    sensors: [
      createSensor({
        sensorId: 'sensor:catapult-release',
        label: 'Release pad',
        size: { x: 1.1, y: 0.22, z: 1.1 },
        localTransform: { position: { x: -2.25, y: 0.38, z: 0 } },
        triggerPolicy: 'one_shot',
        acceptedTags: ['trigger-weight'],
      }),
    ],
    latches: [
      createLatch({
        latchId: 'latch:catapult',
        label: 'Arm catch',
        assemblyAId: arm.assemblyId,
        assemblyBId: base.assemblyId,
        releaseSensorId: 'sensor:catapult-release',
      }),
    ],
  });
}

export function createPressurePlateDocument() {
  // Tuned against the isolated Rapier adapter: a 0.62m stone is about 0.56u,
  // while the preloaded 28u/m spring gives the loaded plate roughly 0.20m of
  // travel. The 0.30m slider
  // travel leaves a raised rest at normalized 1 and a loaded gate window below
  // 0.45, with 0.035 hysteresis preventing contact chatter at the edge.
  const frame = createAssembly({
    assemblyId: 'assembly:pressure-frame',
    label: 'Pressure plate frame',
    bodyMode: 'fixed',
    transform: { position: { x: 0, y: 0.55, z: 0 } },
    tags: ['pressure-plate-frame'],
    parts: [
      part('part:frame-deck', 'plate', { x: 3.2, y: 0.25, z: 2.6 }, { x: 0, y: -0.42, z: 0 }, 'material.wood_heavy'),
      // The rails form a sealed light well: they sit flush on the deck, meet at
      // the corners, and rise to the raised plate's lip. The only openings are
      // the thin perimeter seams around the plate (0.06m sides, 0.10m ends),
      // so the underside Light escapes only through those seams.
      part('part:frame-rail-left', 'beam', { x: 0.22, y: 1.22, z: 2.46 }, { x: -1.48, y: 0.31, z: 0 }, 'material.wood_heavy'),
      part('part:frame-rail-right', 'beam', { x: 0.22, y: 1.22, z: 2.46 }, { x: 1.48, y: 0.31, z: 0 }, 'material.wood_heavy'),
      part('part:frame-rail-front', 'beam', { x: 2.74, y: 1.22, z: 0.22 }, { x: 0, y: 0.31, z: -1.12 }, 'material.wood_heavy'),
      part('part:frame-rail-back', 'beam', { x: 2.74, y: 1.22, z: 0.22 }, { x: 0, y: 0.31, z: 1.12 }, 'material.wood_heavy'),
    ],
  });
  const plate = createAssembly({
    assemblyId: 'assembly:pressure-plate',
    label: 'Spring-loaded plate',
    transform: { position: { x: 0, y: 1.43, z: 0 } },
    tags: ['pressure-plate'],
    parts: [
      part('part:pressure-plate', 'plate', { x: 2.62, y: 0.16, z: 1.82 }, { x: 0, y: 0, z: 0 }, 'material.wood_heavy'),
    ],
  });
  const load = createAssembly({
    assemblyId: 'assembly:pressure-load',
    label: 'Test load stone',
    transform: { position: { x: 0, y: 2.45, z: 0 } },
    tags: ['pressure-load'],
    parts: [part('part:pressure-load', 'cuboid', { x: 0.62, y: 0.62, z: 0.62 }, { x: 0, y: 0, z: 0 }, 'material.stone')],
  });
  return createMechanicsDocument({
    metadata: {
      name: 'Light pressure plate',
      description:
        'The raised plate is guided by a vertical rail and returned by a preloaded physical 28u spring. A 0.56u stone load depresses it through a 0.30m travel window; the underside Light dispersion completes only while the gate is seated, and its glow seeps out of the perimeter seams of the sealed well.',
      // Dim the workshop for this build so the seam glow reads clearly.
      environment: { lightLevel: 0.3 },
    },
    assemblies: [frame, plate, load],
    constraints: [
      createConstraint({
        constraintId: 'constraint:pressure-slider',
        label: 'Vertical plate travel',
        type: 'prismatic',
        assemblyAId: frame.assemblyId,
        assemblyBId: plate.assemblyId,
        localAnchorA: { x: 0, y: 0, z: 0 },
        localAnchorB: { x: 0, y: 0, z: 0 },
        // Keep the guide hardware inside the sealed center well. Without
        // explicit presentation anchors the generic editor infers exposed
        // surface contacts, which puts this internal guide on a side rail.
        connectionAnchorA: { x: 0, y: 0, z: 0 },
        connectionAnchorB: { x: 0, y: 0, z: 0 },
        localAxisA: { x: 0, y: 1, z: 0 },
        limits: { enabled: true, min: 0.58, max: 0.88 },
      }),
    ],
    forceElements: [
      createForceElement({
        forceElementId: 'spring:pressure-return',
        label: 'Plate return spring',
        type: 'linear_spring',
        assemblyAId: frame.assemblyId,
        assemblyBId: plate.assemblyId,
        localAnchorA: { x: 0, y: 0, z: 0 },
        localAnchorB: { x: 0, y: 0, z: 0 },
        restLength: 1.12,
        stiffness: 28,
        damping: 6,
        maxImpulse: 32,
      }),
    ],
    sensors: [
      createSensor({
        sensorId: 'sensor:pressure-contact',
        assemblyId: frame.assemblyId,
        label: 'Load contact area',
        size: { x: 2.4, y: 0.18, z: 1.6 },
        localTransform: { position: { x: 0, y: 0.72, z: 0 } },
        triggerPolicy: 'held',
        acceptedTags: ['pressure-load'],
      }),
    ],
    spellDevices: [
      createSpellDevice({
        deviceId: 'spell-device:pressure-light',
        assemblyId: plate.assemblyId,
        label: 'Underside Light dispersion',
        spellTemplateId: 'light-column',
        gateId: 'gate:pressure-light',
        localFrame: {
          origin: { x: 0, y: -0.13, z: 0 },
          normal: { x: 0, y: -1, z: 0 },
          tangent: { x: 1, y: 0, z: 0 },
        },
        forceScale: 0,
      }),
    ],
    gates: [
      createGate({
        gateId: 'gate:pressure-light',
        type: 'sliding_ring_gate',
        label: 'Pressed Light ring',
        plateDeviceId: 'spell-device:pressure-light',
        driverConstraintId: 'constraint:pressure-slider',
        closedRange: { min: 0, max: 0.45 },
        lateralTolerance: 0.035,
        hysteresis: 0.035,
      }),
    ],
  });
}

export function createWindGearDocument() {
  const frame = createAssembly({
    assemblyId: 'assembly:gear-frame',
    label: 'Machine frame',
    bodyMode: 'fixed',
    transform: { position: { x: 0, y: 2.1, z: 1 } },
    parts: [
      part('part:frame-base', 'plate', { x: 5, y: 0.25, z: 2.2 }, { x: 1, y: -1.9, z: 0 }, 'material.wood_heavy'),
      part('part:frame-post-a', 'beam', { x: 0.3, y: 3.9, z: 0.3 }, { x: -0.65, y: 0, z: 0 }, 'material.wood_heavy'),
      part('part:frame-post-b', 'beam', { x: 0.3, y: 3.9, z: 0.3 }, { x: 0.65, y: 0, z: 0 }, 'material.wood_heavy'),
    ],
  });
  const input = createAssembly({
    assemblyId: 'assembly:wind-wheel',
    label: 'Paddle wheel, axle, and large cog',
    transform: { position: { x: 0, y: 2.1, z: 1 } },
    tags: ['shaft', 'wind-catcher'],
    parts: [
      // Keep the wind-catching wheel, axle, and large cog on one rigid shaft.
      // They occupy three clearly separated planes instead of overlapping into
      // the old hybrid wheel/cog silhouette.
      ...paddleWheelParts('input', 1.25, -1.05, 'material.wood_light'),
      part(
        'part:input-axle',
        'cylinder',
        { x: 0.2, y: 2.35, z: 0.2 },
        { x: 0.02, y: 0, z: 0 },
        'material.iron',
        quaternionFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2),
      ),
      cogwheelPart(
        'part:input-cog',
        { x: 1.6, y: 0.24, z: 1.6 },
        { x: 1.05, y: 0, z: 0 },
        'material.wood_light',
      ),
    ],
  });
  const output = createAssembly({
    assemblyId: 'assembly:output-gear',
    label: 'Floating small cog',
    // Large and small pitch radii are 0.8 and 0.4, so 1.2 units puts
    // their pitch circles exactly tooth-to-tooth in the shared gear plane.
    transform: { position: { x: 0, y: 3.3, z: 1 } },
    tags: ['shaft', 'load'],
    parts: [
      cogwheelPart(
        'part:output-cog',
        { x: 0.8, y: 0.24, z: 0.8 },
        { x: 1.05, y: 0, z: 0 },
        'material.iron',
      ),
    ],
  });
  // The wind column is short (~2.3 world units), so the plate sits low and close,
  // blowing across the bottom of the paddle sweep where each pass gains real torque.
  const plate = createAssembly({
    assemblyId: 'assembly:wind-plate',
    label: 'Wind spell mount',
    bodyMode: 'fixed',
    transform: { position: { x: -1.05, y: 1.05, z: -1.05 } },
    parts: [
      part('part:wind-plate', 'plate', { x: 1.35, y: 1.35, z: 0.12 }, { x: 0, y: 0, z: 0 }, 'material.iron'),
      part('part:wind-pedestal', 'beam', { x: 0.18, y: 1.0, z: 0.18 }, { x: 0, y: -0.55, z: 0 }, 'material.wood_heavy'),
    ],
  });
  const key = createAssembly({
    assemblyId: 'assembly:wind-key',
    label: 'Sliding ring key',
    transform: { position: { x: -1.05, y: 1.05, z: -0.95 } },
    parts: [part('part:wind-key', 'cuboid', { x: 0.22, y: 0.42, z: 0.14 }, { x: 0, y: 0, z: 0 }, 'material.iron')],
  });

  return createMechanicsDocument({
    metadata: {
      name: 'Wind gear drive',
      description: 'Wind catches the separate paddle wheel, which turns the long axle and large cog. The large cog meshes with the unsupported small cog. Slide the key sideways to break the ring.',
    },
    assemblies: [frame, input, output, plate, key],
    constraints: [
      createConstraint({
        constraintId: 'constraint:input-bearing',
        label: 'Input bearing',
        type: 'revolute',
        assemblyAId: frame.assemblyId,
        assemblyBId: input.assemblyId,
        localAnchorA: { x: 0, y: 0, z: 0 },
        localAnchorB: { x: 0, y: 0, z: 0 },
        localAxisA: { x: 1, y: 0, z: 0 },
        // Zero-velocity drive acts as bearing friction so the wind settles at a
        // readable spin instead of accelerating without bound.
        drive: { enabled: true, targetVelocity: 0, damping: 3, maxImpulse: 24 },
      }),
      createConstraint({
        constraintId: 'constraint:wind-key-slider',
        label: 'Ring key rail',
        type: 'prismatic',
        assemblyAId: plate.assemblyId,
        assemblyBId: key.assemblyId,
        localAnchorA: { x: 0, y: 0, z: 0.1 },
        localAnchorB: { x: 0, y: 0, z: 0 },
        localAxisA: { x: 1, y: 0, z: 0 },
        limits: { enabled: true, min: -0.75, max: 0.75 },
      }),
    ],
    rotationCouplings: [
      createRotationCoupling({
        couplingId: 'coupling:wind-output',
        label: 'Cog mesh 2:1',
        assemblyAId: input.assemblyId,
        assemblyBId: output.assemblyId,
        axisA: { x: 1, y: 0, z: 0 },
        axisB: { x: 1, y: 0, z: 0 },
        ratio: -2,
        torqueCapacity: 36,
        style: 'mesh',
      }),
    ],
    spellDevices: [
      createSpellDevice({
        deviceId: 'spell-device:wind-drive',
        assemblyId: plate.assemblyId,
        label: 'Wind drive plate',
        spellTemplateId: 'wind-column',
        gateId: 'gate:wind-key',
        localFrame: {
          origin: { x: 0, y: 0, z: 0.12 },
          normal: { x: 0, y: 0, z: 1 },
          tangent: { x: 1, y: 0, z: 0 },
        },
        forceScale: 0.9,
      }),
    ],
    gates: [
      createGate({
        gateId: 'gate:wind-key',
        type: 'sliding_ring_gate',
        label: 'Sliding wind key',
        plateDeviceId: 'spell-device:wind-drive',
        driverConstraintId: 'constraint:wind-key-slider',
        closedRange: { min: 0.44, max: 0.56 },
        lateralTolerance: 0.03,
        hysteresis: 0.025,
      }),
    ],
  });
}

// Where a cam lobe points (about the shaft's x-axis, measured from +y) at the
// moment its gate window closes: down and toward the plate row in front.
const CAM_LOBE_BASE_CLOCK = 2.47;

export function createCamWatererDocument() {
  // Two yoke posts hold the shaft so the spinning lobes never sweep through wood.
  const stand = createAssembly({
    assemblyId: 'assembly:cam-stand',
    label: 'Cam stand',
    bodyMode: 'fixed',
    transform: { position: { x: 0, y: 1.6, z: 0 } },
    parts: [
      part('part:cam-base', 'plate', { x: 5.2, y: 0.24, z: 3.6 }, { x: 0, y: -1.45, z: 0 }, 'material.wood_heavy'),
      part('part:cam-post-left', 'beam', { x: 0.32, y: 3.2, z: 0.32 }, { x: -0.85, y: 0, z: 0 }, 'material.wood_heavy'),
      part('part:cam-post-right', 'beam', { x: 0.32, y: 3.2, z: 0.32 }, { x: 0.85, y: 0, z: 0 }, 'material.wood_heavy'),
    ],
  });
  // One lobe per water plate, sitting directly above it on the shaft and clocked
  // to its gate phase, so "lobe swings down over the plate" matches "that column fires".
  const lobePlacements = [
    { suffix: 'north', x: -1.8, phase: 0 },
    { suffix: 'east', x: 0, phase: (Math.PI * 4) / 3 },
    { suffix: 'west', x: 1.8, phase: (Math.PI * 2) / 3 },
  ];
  const shaft = createAssembly({
    assemblyId: 'assembly:camshaft',
    label: 'Driven camshaft',
    transform: { position: { x: 0, y: 2.35, z: 0 } },
    tags: ['shaft', 'camshaft'],
    parts: [
      part(
        'part:camshaft',
        'shaft',
        { x: 0.3, y: 4.4, z: 0.3 },
        { x: 0, y: 0, z: 0 },
        'material.iron',
        quaternionFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2),
      ),
      ...lobePlacements.map((lobe) => {
        const clock = CAM_LOBE_BASE_CLOCK - lobe.phase;
        return part(
          `part:cam-lobe-${lobe.suffix}`,
          'cuboid',
          { x: 0.26, y: 0.72, z: 0.3 },
          { x: lobe.x, y: Math.cos(clock) * 0.34, z: Math.sin(clock) * 0.34 },
          'material.iron',
          quaternionFromAxisAngle({ x: 1, y: 0, z: 0 }, clock),
        );
      }),
    ],
  });
  const plates = [
    { id: 'north', label: 'Left water jet', position: { x: -1.8, y: 1.1, z: 1.0 }, phase: 0 },
    { id: 'east', label: 'Middle water jet', position: { x: 0, y: 1.1, z: 1.0 }, phase: (Math.PI * 4) / 3 },
    { id: 'west', label: 'Right water jet', position: { x: 1.8, y: 1.1, z: 1.0 }, phase: (Math.PI * 2) / 3 },
  ];
  const plateAssemblies = plates.map((plate) =>
    createAssembly({
      assemblyId: `assembly:water-plate-${plate.id}`,
      label: plate.label,
      bodyMode: 'fixed',
      transform: { position: plate.position },
      parts: [part(`part:water-plate-${plate.id}`, 'plate', { x: 1.1, y: 0.18, z: 1.1 }, { x: 0, y: 0, z: 0 }, 'material.iron')],
    }),
  );
  const bearing = createConstraint({
    constraintId: 'constraint:camshaft-bearing',
    label: 'Driven shaft bearing',
    type: 'revolute',
    assemblyAId: stand.assemblyId,
    assemblyBId: shaft.assemblyId,
    localAnchorA: { x: 0, y: 0.75, z: 0 },
    localAnchorB: { x: 0, y: 0, z: 0 },
    localAxisA: { x: 1, y: 0, z: 0 },
    drive: { enabled: true, targetVelocity: 1.3, damping: 2.2, maxImpulse: 18 },
  });

  return createMechanicsDocument({
    metadata: {
      name: 'Cam garden waterer',
      description:
        'The motor spins one camshaft with three lobes. When a lobe swings down over its plate the gate window closes and that jet fires — left, middle, right, in order.',
    },
    assemblies: [stand, shaft, ...plateAssemblies],
    constraints: [bearing],
    spellDevices: plates.map((plate, index) =>
      createSpellDevice({
        deviceId: `spell-device:water-${plate.id}`,
        assemblyId: plateAssemblies[index].assemblyId,
        label: plate.label,
        spellTemplateId: 'water-column',
        gateId: `gate:water-${plate.id}`,
        localFrame: {
          origin: { x: 0, y: 0.12, z: 0 },
          // All three jets arc the same way: up and out over the garden row.
          normal: { x: 0, y: 0.42, z: 0.91 },
          tangent: { x: 1, y: 0, z: 0 },
        },
      }),
    ),
    gates: plates.map((plate) =>
      createGate({
        gateId: `gate:water-${plate.id}`,
        type: 'rotary_cam_gate',
        label: `${plate.label} cam gate`,
        plateDeviceId: `spell-device:water-${plate.id}`,
        driverConstraintId: bearing.constraintId,
        phaseOffsetRadians: plate.phase,
        closedWindows: [{ startRadians: -0.32, endRadians: 0.32 }],
        hysteresis: 0.05,
      }),
    ),
  });
}

function paddleWheelParts(prefix, radius, centerX, materialId) {
  const rotation = quaternionFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2);
  // This is deliberately a plain wind wheel rather than a toothed cog. Its
  // separated position makes the drive chain readable: wheel → axle → cog.
  const parts = [
    part(
      `part:${prefix}-wind-wheel`,
      'cylinder',
      { x: radius * 2, y: 0.3, z: radius * 2 },
      { x: centerX, y: 0, z: 0 },
      materialId,
      rotation,
    ),
  ];
  const paddleSize = { x: 0.18, y: radius * 0.62, z: radius * 0.72 };
  for (let index = 0; index < 4; index += 1) {
    // Start 45° off-phase so the wind column meets a paddle off-axis and produces torque.
    const angle = (index / 4) * Math.PI * 2 + Math.PI / 4;
    parts.push(
      part(
        `part:${prefix}-paddle-${index + 1}`,
        'cuboid',
        paddleSize,
        { x: centerX, y: Math.cos(angle) * radius * 0.85, z: Math.sin(angle) * radius * 0.85 },
        'material.wood_light',
        quaternionFromAxisAngle({ x: 1, y: 0, z: 0 }, angle),
      ),
    );
  }
  return parts;
}

function cogwheelPart(partId, size, position, materialId) {
  return createPrimitivePart({
    partId,
    preset: 'wheel',
    shape: 'cogwheel',
    size,
    materialId,
    rotationPortAxis: { x: 0, y: 1, z: 0 },
    localTransform: {
      position,
      // Cogwheels are authored flat on Y; this turns their axle onto +X to
      // match both revolute bearings and the paddle wheel's shaft.
      rotation: quaternionFromAxisAngle({ x: 0, y: 0, z: 1 }, -Math.PI / 2),
    },
  });
}

function part(partId, preset, size, position, materialId = 'material.wood_light', rotation = null) {
  return createPrimitivePart({
    partId,
    preset,
    size,
    materialId,
    localTransform: {
      position,
      rotation: rotation ?? { x: 0, y: 0, z: 0, w: 1 },
    },
  });
}
