import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSpell } from '../../src/compiler/compile.js';
import { interpretCompiledSpell } from '../../src/simulation-engine/index.js';
import {
  createAssembly,
  createConstraint,
  createForceElement,
  createLatch,
  createMechanicsDocument,
  createPrimitivePart,
  createRotationCoupling,
  createSensor,
  createSpellDevice,
  constraintConnectionPoints,
  quaternionFromAxisAngle,
} from '../../src/mechanics-engine/index.js';
import { loadRapier } from '../src/mechanics/rapier-loader.js';
import {
  MECHANICS_FIXED_DT,
  RapierMechanicsWorld,
} from '../src/mechanics/RapierMechanicsWorld.js';
import {
  createCamWatererDocument,
  createCatapultDocument,
  createPressurePlateDocument,
} from '../src/mechanics/starterDocuments.js';
import { evaluateMountedSpellDevices } from '../src/mechanics/spell-device-system.js';

const R = await loadRapier();

test('Rapier mechanics world builds one body with multiple colliders for a glued assembly', () => {
  const document = createMechanicsDocument({
    assemblies: [
      createAssembly({
        assemblyId: 'assembly:compound',
        transform: { position: { x: 0, y: 3, z: 0 } },
        parts: [
          createPrimitivePart({ partId: 'part:a', preset: 'cuboid' }),
          createPrimitivePart({
            partId: 'part:b',
            preset: 'sphere',
            localTransform: { position: { x: 0.8, y: 0, z: 0 } },
          }),
        ],
      }),
    ],
  });
  const mechanics = new RapierMechanicsWorld(R, document);
  const snapshot = mechanics.getSnapshot();
  assert.equal(snapshot.bodyCount, 2, 'assembly body plus owned ground body');
  assert.equal(snapshot.assemblyBodyCount, 1);
  assert.equal(snapshot.collisionListenerCount, 0);
  assert.equal(snapshot.eventQueueCount, 1);
  assert.equal(snapshot.retainedSnapshotCount, 0);
  assert.equal(snapshot.colliderCount, 3, 'two part colliders plus the ground');
  assert.ok(snapshot.assemblies['assembly:compound'].mass > 0);
  mechanics.dispose();
});

test('dynamic assemblies fall under gravity while fixed assemblies remain still', () => {
  const document = createMechanicsDocument({
    assemblies: [
      boxAssembly('assembly:dynamic', { x: -1, y: 4, z: 0 }),
      boxAssembly('assembly:fixed', { x: 1, y: 4, z: 0 }, 'fixed'),
    ],
  });
  const mechanics = new RapierMechanicsWorld(R, document, { paused: false });
  stepWorld(mechanics, 60);
  const snapshot = mechanics.getSnapshot();
  assert.ok(snapshot.assemblies['assembly:dynamic'].position.y < 3);
  assert.equal(snapshot.assemblies['assembly:fixed'].position.y, 4);
  mechanics.dispose();
});

test('fixed-step resets rebuild stable body counts and reproduce transforms', () => {
  const document = createMechanicsDocument({
    assemblies: [boxAssembly('assembly:repeatable', { x: 0, y: 4, z: 0 })],
  });
  const first = new RapierMechanicsWorld(R, document, { paused: false });
  stepWorld(first, 90);
  const yFirst = first.getSnapshot().assemblies['assembly:repeatable'].position.y;
  first.rebuild(document);
  first.setPaused(false);
  stepWorld(first, 90);
  const reset = first.getSnapshot();
  assert.equal(reset.bodyCount, 2);
  assert.equal(reset.colliderCount, 2);
  assert.equal(reset.rebuildCount, 2);
  assert.ok(Math.abs(reset.assemblies['assembly:repeatable'].position.y - yFirst) < 1e-6);
  first.dispose();
});

test('material density changes physical mass for otherwise identical shapes', () => {
  const makeMaterialBox = (assemblyId, materialId, x) =>
    createAssembly({
      assemblyId,
      transform: { position: { x, y: 2, z: 0 } },
      parts: [
        createPrimitivePart({
          partId: `${assemblyId}:part`,
          preset: 'cuboid',
          size: { x: 1, y: 1, z: 1 },
          materialId,
        }),
      ],
    });
  const document = createMechanicsDocument({
    assemblies: [
      makeMaterialBox('assembly:wood', 'material.wood_light', -1),
      makeMaterialBox('assembly:iron', 'material.iron', 1),
    ],
  });
  const mechanics = new RapierMechanicsWorld(R, document);
  const snapshot = mechanics.getSnapshot();
  assert.ok(snapshot.assemblies['assembly:iron'].mass > snapshot.assemblies['assembly:wood'].mass * 7);
  mechanics.dispose();
});

test('material restitution changes contact behavior', () => {
  const sphere = (assemblyId, materialId, x) =>
    createAssembly({
      assemblyId,
      transform: { position: { x, y: 3, z: 0 } },
      parts: [
        createPrimitivePart({
          partId: `${assemblyId}:part`,
          preset: 'sphere',
          materialId,
        }),
      ],
    });
  const document = createMechanicsDocument({
    assemblies: [
      sphere('assembly:stone-ball', 'material.stone', -1),
      sphere('assembly:rubber-ball', 'material.practice_rubber', 1),
    ],
  });
  const mechanics = new RapierMechanicsWorld(R, document, { paused: false });
  stepWorld(mechanics, 121);
  const snapshot = mechanics.getSnapshot();
  assert.ok(
    snapshot.assemblies['assembly:rubber-ball'].position.y >
      snapshot.assemblies['assembly:stone-ball'].position.y + 0.25,
  );
  mechanics.dispose();
});

test('prismatic constraints keep motion on their axis and respect limits', () => {
  const document = createMechanicsDocument({
    assemblies: [
      boxAssembly('assembly:rail', { x: 0, y: 2, z: 0 }, 'fixed'),
      boxAssembly('assembly:slider', { x: 0, y: 2, z: 0 }),
    ],
    constraints: [
      createConstraint({
        constraintId: 'constraint:slider',
        type: 'prismatic',
        assemblyAId: 'assembly:rail',
        assemblyBId: 'assembly:slider',
        localAxisA: { x: 1, y: 0, z: 0 },
        limits: { enabled: true, min: -0.5, max: 0.5 },
      }),
    ],
  });
  const mechanics = new RapierMechanicsWorld(R, document, { paused: false });
  mechanics.applyTestImpulse('assembly:slider', { x: 20, y: 4, z: 5 });
  stepWorld(mechanics, 120);
  const slider = mechanics.getSnapshot().assemblies['assembly:slider'];
  assert.ok(Math.abs(slider.position.x) <= 0.58);
  assert.ok(Math.abs(slider.position.y - 2) < 0.08);
  assert.ok(Math.abs(slider.position.z) < 0.08);
  mechanics.dispose();
});

test('pressure plate slider hardware stays centered and continuous through live travel', () => {
  const document = createPressurePlateDocument();
  const constraint = document.constraints.find(
    (item) => item.constraintId === 'constraint:pressure-slider',
  );
  const mechanics = new RapierMechanicsWorld(R, document, { paused: false });
  let previous = constraintConnectionPoints(document, constraint, {
    [constraint.assemblyAId]: mechanics.getSnapshot().assemblies[constraint.assemblyAId],
    [constraint.assemblyBId]: mechanics.getSnapshot().assemblies[constraint.assemblyBId],
  });
  let largestFrameMove = 0;

  for (let index = 0; index < 120; index += 1) {
    const snapshot = mechanics.step(MECHANICS_FIXED_DT);
    const current = constraintConnectionPoints(document, constraint, {
      [constraint.assemblyAId]: snapshot.assemblies[constraint.assemblyAId],
      [constraint.assemblyBId]: snapshot.assemblies[constraint.assemblyBId],
    });
    largestFrameMove = Math.max(
      largestFrameMove,
      Math.hypot(
        current.pointA.x - previous.pointA.x,
        current.pointA.y - previous.pointA.y,
        current.pointA.z - previous.pointA.z,
      ),
    );
    assert.ok(Math.abs(current.pointA.x) < 1e-6, 'guide remains centered on x');
    assert.ok(Math.abs(current.pointA.z) < 1e-6, 'guide remains centered on z');
    previous = current;
  }

  assert.ok(largestFrameMove < 1e-6, `fixed guide jumped ${largestFrameMove.toFixed(6)}m`);
  mechanics.dispose();
});

test('revolute constraints reject off-axis rotation and respect angular limits', () => {
  const document = createMechanicsDocument({
    assemblies: [
      boxAssembly('assembly:hinge-frame', { x: 0, y: 2, z: 0 }, 'fixed'),
      boxAssembly('assembly:hinge-member', { x: 0, y: 2, z: 0 }),
    ],
    constraints: [
      createConstraint({
        constraintId: 'constraint:limited-hinge',
        type: 'revolute',
        assemblyAId: 'assembly:hinge-frame',
        assemblyBId: 'assembly:hinge-member',
        localAxisA: { x: 1, y: 0, z: 0 },
        limits: { enabled: true, min: -0.25, max: 0.25 },
      }),
    ],
  });
  const mechanics = new RapierMechanicsWorld(R, document, { paused: false, gravity: 0 });
  mechanics.applyTestTorque('assembly:hinge-member', { x: 8, y: 8, z: 8 });
  stepWorld(mechanics, 120);
  const snapshot = mechanics.getSnapshot();
  assert.ok(Math.abs(snapshot.constraints['constraint:limited-hinge'].angleRadians) <= 0.3);
  assert.ok(Math.abs(snapshot.assemblies['assembly:hinge-member'].angularVelocity.y) < 0.1);
  assert.ok(Math.abs(snapshot.assemblies['assembly:hinge-member'].angularVelocity.z) < 0.1);
  mechanics.dispose();
});

test('linear springs pull separated bodies toward their rest length', () => {
  const document = createMechanicsDocument({
    assemblies: [
      boxAssembly('assembly:anchor', { x: 0, y: 4, z: 0 }, 'fixed'),
      boxAssembly('assembly:weight', { x: 0, y: 1, z: 0 }),
    ],
    forceElements: [
      createForceElement({
        forceElementId: 'spring:1',
        assemblyAId: 'assembly:anchor',
        assemblyBId: 'assembly:weight',
        restLength: 1,
        stiffness: 45,
        damping: 6,
      }),
    ],
  });
  const mechanics = new RapierMechanicsWorld(R, document, { paused: false });
  stepWorld(mechanics, 120);
  const weight = mechanics.getSnapshot().assemblies['assembly:weight'];
  assert.ok(weight.position.y > 1.4, `spring should lift the weight, received y=${weight.position.y}`);
  mechanics.dispose();
});

test('latches hold a body until released', () => {
  const document = createMechanicsDocument({
    assemblies: [
      boxAssembly('assembly:frame', { x: -0.6, y: 3, z: 0 }, 'fixed'),
      boxAssembly('assembly:load', { x: 0.6, y: 3, z: 0 }),
    ],
    latches: [
      createLatch({
        latchId: 'latch:1',
        assemblyAId: 'assembly:load',
        assemblyBId: 'assembly:frame',
      }),
    ],
  });
  const mechanics = new RapierMechanicsWorld(R, document, { paused: false });
  stepWorld(mechanics, 30);
  assert.ok(Math.abs(mechanics.getSnapshot().assemblies['assembly:load'].position.y - 3) < 0.05);
  assert.equal(mechanics.releaseLatch('latch:1'), true);
  stepWorld(mechanics, 60);
  assert.ok(mechanics.getSnapshot().assemblies['assembly:load'].position.y < 2);
  assert.equal(mechanics.getSnapshot().latches['latch:1'].state, 'released');
  mechanics.dispose();
});

test('latches solve their authored contact anchors instead of body centers', () => {
  const document = createMechanicsDocument({
    assemblies: [
      boxAssembly('assembly:fixed', { x: 0, y: 3, z: 0 }, 'fixed'),
      boxAssembly('assembly:moving', { x: 0, y: 3, z: 0 }),
    ],
    latches: [createLatch({
      latchId: 'latch:contacts',
      assemblyAId: 'assembly:moving',
      assemblyBId: 'assembly:fixed',
      localAnchorA: { x: 1, y: 0, z: 0 },
      localAnchorB: { x: -1, y: 0, z: 0 },
    })],
  });
  const mechanics = new RapierMechanicsWorld(R, document, { paused: false, gravity: 0 });
  stepWorld(mechanics, 60);
  const moving = mechanics.getSnapshot().assemblies['assembly:moving'];
  assert.ok(moving.position.x < -1.8, `authored contacts should meet; received x=${moving.position.x}`);
  mechanics.dispose();
});

test('world latch re-arm reuses its owned anchor body', () => {
  const document = createMechanicsDocument({
    assemblies: [boxAssembly('assembly:load', { x: 0, y: 3, z: 0 })],
    latches: [
      createLatch({
        latchId: 'latch:world',
        assemblyAId: 'assembly:load',
        assemblyBId: null,
        mode: 'manual',
      }),
    ],
  });
  const mechanics = new RapierMechanicsWorld(R, document, { paused: false });
  const initial = mechanics.getSnapshot();

  for (let index = 0; index < 5; index += 1) {
    assert.equal(mechanics.releaseLatch('latch:world'), true);
    assert.equal(mechanics.armLatch('latch:world'), true);
    const snapshot = mechanics.getSnapshot();
    assert.equal(snapshot.bodyCount, initial.bodyCount);
    assert.equal(snapshot.jointCount, initial.jointCount);
  }
  mechanics.dispose();
});

test('catch latches re-arm open and lock only when bodies enter tolerance', () => {
  const document = createMechanicsDocument({
    assemblies: [
      boxAssembly('assembly:catch-base', { x: 0, y: 2, z: 0 }, 'fixed'),
      boxAssembly('assembly:catch-target', { x: 0.2, y: 2, z: 0 }),
    ],
    latches: [
      createLatch({
        latchId: 'latch:catch',
        assemblyAId: 'assembly:catch-target',
        assemblyBId: 'assembly:catch-base',
        mode: 'catch',
        armed: false,
        catchDistance: 0.35,
      }),
    ],
  });
  const mechanics = new RapierMechanicsWorld(R, document, { paused: false, gravity: 0 });
  assert.equal(mechanics.getSnapshot().latches['latch:catch'].state, 'open');
  mechanics.armLatch('latch:catch');
  assert.equal(mechanics.getSnapshot().latches['latch:catch'].state, 'open');
  mechanics.step(MECHANICS_FIXED_DT);
  assert.equal(mechanics.getSnapshot().latches['latch:catch'].state, 'latched');
  mechanics.dispose();
});

test('contact sensors release their connected latch once', () => {
  const document = createMechanicsDocument({
    assemblies: [
      boxAssembly('assembly:frame', { x: 1.4, y: 3, z: 0 }, 'fixed'),
      boxAssembly('assembly:load', { x: 2.6, y: 3, z: 0 }),
      boxAssembly('assembly:trigger-weight', { x: 0, y: 3, z: 0 }),
    ],
    sensors: [
      createSensor({
        sensorId: 'sensor:release',
        size: { x: 1.4, y: 0.4, z: 1.4 },
        localTransform: { position: { x: 0, y: 0.45, z: 0 } },
      }),
    ],
    latches: [
      createLatch({
        latchId: 'latch:1',
        assemblyAId: 'assembly:load',
        assemblyBId: 'assembly:frame',
        releaseSensorId: 'sensor:release',
      }),
    ],
  });
  const mechanics = new RapierMechanicsWorld(R, document, { paused: false });
  stepWorld(mechanics, 120);
  const snapshot = mechanics.getSnapshot();
  assert.equal(snapshot.latches['latch:1'].state, 'released');
  assert.ok(snapshot.assemblies['assembly:load'].position.y < 2.5);
  mechanics.dispose();
});

test('held contact sensors emit once per fixed step until contact exits', () => {
  const document = createMechanicsDocument({
    assemblies: [boxAssembly('assembly:weight', { x: 0, y: 1, z: 0 })],
    sensors: [createSensor({
      sensorId: 'sensor:held',
      triggerPolicy: 'held',
      size: { x: 2, y: 2, z: 2 },
      localTransform: { position: { x: 0, y: 1, z: 0 } },
    })],
  });
  const mechanics = new RapierMechanicsWorld(R, document, { paused: false, gravity: 0 });
  const first = mechanics.step(MECHANICS_FIXED_DT);
  const second = mechanics.step(MECHANICS_FIXED_DT);
  assert.deepEqual(first.triggerEvents.map((event) => event.event), ['held']);
  assert.deepEqual(second.triggerEvents.map((event) => event.event), ['held']);
  assert.equal(second.sensors['sensor:held'].active, true);
  mechanics.dispose();
});

test('editable catapult fixture releases and launches its loose projectile through contact physics', () => {
  const document = createCatapultDocument();
  const mechanics = new RapierMechanicsWorld(R, document, { paused: false });
  let stoneMaxHeight = 0;
  for (let index = 0; index < 400; index += 1) {
    mechanics.step(MECHANICS_FIXED_DT);
    stoneMaxHeight = Math.max(
      stoneMaxHeight,
      mechanics.getSnapshot().assemblies['assembly:catapult-stone'].position.y,
    );
  }
  const snapshot = mechanics.getSnapshot();
  assert.equal(snapshot.latches['latch:catapult'].state, 'released');
  // A real launch arcs well above the machine — a stone shoved along the
  // ground must not pass this test.
  assert.ok(stoneMaxHeight > 3, `stone should arc upward, peaked at ${stoneMaxHeight.toFixed(2)}`);
  assert.ok(Math.abs(snapshot.assemblies['assembly:catapult-stone'].position.z) > 4);
  assert.ok(snapshot.assemblies['assembly:catapult-stone'].position.y < 0.35);
  mechanics.dispose();
});

test('moving joint and torsion contact nodes does not teleport the connected bodies', () => {
  const document = createCatapultDocument();
  const pivot = document.constraints.find(
    (item) => item.constraintId === 'constraint:catapult-pivot',
  );
  pivot.connectionAnchorA = { x: -0.8, y: 0.5, z: 0.25 };
  pivot.connectionAnchorB = { x: 0.8, y: -0.45, z: -0.25 };
  const spring = document.forceElements.find((item) => item.forceElementId === 'spring:catapult');
  spring.connectionAnchorA = { x: -0.6, y: 0.3, z: 0.2 };
  spring.connectionAnchorB = { x: 0.5, y: -0.3, z: -0.2 };
  const authored = document.assemblies.find(
    (item) => item.assemblyId === 'assembly:catapult-arm',
  ).transform.position;
  const mechanics = new RapierMechanicsWorld(R, document, { paused: false, gravity: 0 });
  stepWorld(mechanics, 5);
  const actual = mechanics.getSnapshot().assemblies['assembly:catapult-arm'].position;
  const displacement = Math.hypot(
    actual.x - authored.x,
    actual.y - authored.y,
    actual.z - authored.z,
  );
  assert.ok(displacement < 0.01, `arm moved ${displacement.toFixed(4)} after contact-only edits`);
  mechanics.dispose();
});

test('active wind fields apply real directional force', () => {
  const document = createMechanicsDocument({
    assemblies: [
      createAssembly({
        assemblyId: 'assembly:paddle',
        transform: { position: { x: 0.35, y: 1, z: 2 } },
        parts: [
          createPrimitivePart({
            partId: 'part:paddle',
            preset: 'plate',
            size: { x: 1.4, y: 0.2, z: 0.5 },
          }),
        ],
      }),
    ],
  });
  const mechanics = new RapierMechanicsWorld(R, document, { paused: false, gravity: 0 });
  mechanics.setSpellFields([
    {
      id: 'field:wind',
      deviceId: 'device:wind',
      active: true,
      fieldShape: 'column',
      origin: { x: 0, y: 1, z: 0 },
      direction: { x: 0, y: 0, z: 1 },
      length: 5,
      radius: 1,
      forceMagnitude: 35,
    },
  ]);
  stepWorld(mechanics, 60);
  const snapshot = mechanics.getSnapshot();
  assert.ok(snapshot.assemblies['assembly:paddle'].velocity.z > 0.4);
  assert.ok(snapshot.forceApplicationCount > 0);
  mechanics.dispose();
});

test('compiler field strength is multiplied by body mass before caps and fixed bodies stay immune', () => {
  const assembly = (assemblyId, materialId, x, bodyMode = 'dynamic') =>
    createAssembly({
      assemblyId,
      bodyMode,
      transform: { position: { x, y: 1, z: 1 } },
      parts: [
        createPrimitivePart({
          partId: `${assemblyId}:part`,
          preset: 'cuboid',
          materialId,
        }),
      ],
    });
  const measure = (assemblyId, materialId) => {
    const mechanics = new RapierMechanicsWorld(R, createMechanicsDocument({
      assemblies: [assembly(assemblyId, materialId, 0)],
    }), { paused: false, gravity: 0 });
    mechanics.setSpellFields([{
      id: `field:${assemblyId}`,
      active: true,
      fieldShape: 'column',
      materialKind: 'fire',
      origin: { x: 0, y: 1, z: 0 },
      direction: { x: 0, y: 0, z: 1 },
      length: 4,
      radius: 1.5,
      forceMagnitude: 12,
    }]);
    stepWorld(mechanics, 12);
    const velocity = mechanics.getSnapshot().assemblies[assemblyId].velocity.z;
    mechanics.dispose();
    return velocity;
  };
  const lightVelocity = measure('assembly:light', 'material.wood_light');
  const heavyVelocity = measure('assembly:heavy', 'material.iron');
  assert.ok(
    Math.abs(lightVelocity - heavyVelocity) < 0.08,
    `mass-scaled acceleration should match before caps: light=${lightVelocity}, heavy=${heavyVelocity}`,
  );
  const fixedMechanics = new RapierMechanicsWorld(R, createMechanicsDocument({
    assemblies: [assembly('assembly:fixed-target', 'material.wood_light', 0, 'fixed')],
  }), { paused: false, gravity: 0 });
  fixedMechanics.setSpellFields([{
    id: 'field:fixed', active: true, fieldShape: 'column', materialKind: 'fire',
    origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: 0, z: 1 },
    length: 4, radius: 1.5, forceMagnitude: 12,
  }]);
  stepWorld(fixedMechanics, 12);
  assert.equal(fixedMechanics.getSnapshot().assemblies['assembly:fixed-target'].position.z, 1);
  fixedMechanics.dispose();
});

test('an off-center wind hit produces real angular velocity', () => {
  const document = createMechanicsDocument({
    assemblies: [
      createAssembly({
        assemblyId: 'assembly:offset-paddle',
        transform: { position: { x: 0, y: 1, z: 1 } },
        parts: [
          createPrimitivePart({
            partId: 'part:hub',
            preset: 'cuboid',
            size: { x: 0.7, y: 0.7, z: 0.7 },
          }),
          createPrimitivePart({
            partId: 'part:offset',
            preset: 'plate',
            size: { x: 0.4, y: 0.4, z: 0.4 },
            localTransform: { position: { x: 0.85, y: 0, z: 0 } },
          }),
        ],
      }),
    ],
  });
  const mechanics = new RapierMechanicsWorld(R, document, { paused: false, gravity: 0 });
  mechanics.setSpellFields([{
    id: 'field:off-center',
    active: true,
    fieldShape: 'column',
    origin: { x: 0, y: 1, z: 0 },
    direction: { x: 0, y: 0, z: 1 },
    length: 4,
    radius: 1.4,
    forceMagnitude: 20,
  }]);
  stepWorld(mechanics, 8);
  const angular = mechanics.getSnapshot().assemblies['assembly:offset-paddle'].angularVelocity;
  assert.ok(Math.abs(angular.y) > 0.1);
  mechanics.dispose();
});

test('mounted Wind Pull selects a real assembly and applies a bounded target force', () => {
  const document = createMechanicsDocument({
    assemblies: [
      boxAssembly('assembly:plate', { x: 0, y: 1, z: 0 }, 'fixed'),
      boxAssembly('assembly:target', { x: 1.2, y: 1, z: 0 }),
    ],
    spellDevices: [
      createSpellDevice({
        deviceId: 'spell-device:pull',
        assemblyId: 'assembly:plate',
        spellTemplateId: 'wind-pull',
        localFrame: {
          origin: { x: 0, y: 0, z: 0 },
          normal: { x: 0, y: 1, z: 0 },
          tangent: { x: 1, y: 0, z: 0 },
        },
      }),
    ],
  });
  const mechanics = new RapierMechanicsWorld(R, document, { paused: false, gravity: 0 });
  const spells = evaluateMountedSpellDevices(document, mechanics.getSnapshot(), {
    manualActiveIds: new Set(['spell-device:pull']),
  });
  const field = spells.fields.find((item) => item.fieldShape === 'target_force');
  assert.equal(field.targetAssemblyId, 'assembly:target');
  mechanics.setSpellFields(spells.fields, spells.devices);
  stepWorld(mechanics, 6);
  const snapshot = mechanics.getSnapshot();
  assert.ok(snapshot.assemblies['assembly:target'].velocity.x < -0.2);
  assert.ok(snapshot.forceApplicationCount > 0);
  mechanics.dispose();
});

test('face-down mounted Wind Levitation supports the physical carrier rather than spawning matter', () => {
  const document = createMechanicsDocument({
    assemblies: [boxAssembly('assembly:carrier', { x: 0, y: 1.2, z: 0 })],
    spellDevices: [
      createSpellDevice({
        deviceId: 'spell-device:lift',
        assemblyId: 'assembly:carrier',
        spellTemplateId: 'wind-levitation',
        localFrame: {
          origin: { x: 0, y: 0.3, z: 0 },
          normal: { x: 0, y: -1, z: 0 },
          tangent: { x: 1, y: 0, z: 0 },
        },
      }),
    ],
  });
  const mechanics = new RapierMechanicsWorld(R, document, { paused: false });
  const spells = evaluateMountedSpellDevices(document, mechanics.getSnapshot(), {
    manualActiveIds: new Set(['spell-device:lift']),
  });
  const field = spells.fields.find((item) => item.fieldShape === 'carrier_levitation');
  assert.equal(field.targetAssemblyId, 'assembly:carrier');
  assert.equal(field.targetFilter, 'spell_carrier_only');
  mechanics.setSpellFields(spells.fields, spells.devices);
  stepWorld(mechanics, 60);
  const snapshot = mechanics.getSnapshot();
  assert.ok(snapshot.assemblies['assembly:carrier'].position.y > 1.2);
  assert.ok(snapshot.forceApplicationCount > 0);
  mechanics.dispose();
});

test('torsion spring motor rotates a hinge toward its rest angle', () => {
  const document = createMechanicsDocument({
    assemblies: [
      boxAssembly('assembly:frame', { x: 0, y: 2, z: 0 }, 'fixed'),
      boxAssembly('assembly:arm', { x: 0, y: 2, z: 0 }),
    ],
    constraints: [
      createConstraint({
        constraintId: 'constraint:hinge',
        type: 'revolute',
        assemblyAId: 'assembly:frame',
        assemblyBId: 'assembly:arm',
        localAxisA: { x: 1, y: 0, z: 0 },
      }),
    ],
    forceElements: [
      createForceElement({
        forceElementId: 'spring:torsion',
        type: 'torsion_spring',
        assemblyAId: 'assembly:frame',
        assemblyBId: 'assembly:arm',
        constraintId: 'constraint:hinge',
        restAngle: 0.8,
        stiffness: 30,
        damping: 5,
      }),
    ],
  });
  const mechanics = new RapierMechanicsWorld(R, document, { paused: false, gravity: 0 });
  stepWorld(mechanics, 90);
  const state = mechanics.getSnapshot().constraints['constraint:hinge'];
  assert.ok(Math.abs(state.angleRadians) > 0.2);
  mechanics.dispose();
});

test('idealized gear coupling transfers opposite rotation through bounded torque', () => {
  const frame = boxAssembly('assembly:frame', { x: 0, y: 2, z: 0 }, 'fixed');
  const input = boxAssembly('assembly:input', { x: -1, y: 2, z: 0 });
  const output = boxAssembly('assembly:output', { x: 1, y: 2, z: 0 });
  const document = createMechanicsDocument({
    assemblies: [frame, input, output],
    constraints: [
      createConstraint({
        constraintId: 'constraint:input',
        type: 'revolute',
        assemblyAId: frame.assemblyId,
        assemblyBId: input.assemblyId,
        localAnchorA: { x: -1, y: 0, z: 0 },
        localAxisA: { x: 1, y: 0, z: 0 },
      }),
      createConstraint({
        constraintId: 'constraint:output',
        type: 'revolute',
        assemblyAId: frame.assemblyId,
        assemblyBId: output.assemblyId,
        localAnchorA: { x: 1, y: 0, z: 0 },
        localAxisA: { x: 1, y: 0, z: 0 },
      }),
    ],
    rotationCouplings: [
      createRotationCoupling({
        couplingId: 'coupling:1',
        assemblyAId: input.assemblyId,
        assemblyBId: output.assemblyId,
        axisA: { x: 1, y: 0, z: 0 },
        axisB: { x: 1, y: 0, z: 0 },
        ratio: -1,
        torqueCapacity: 18,
      }),
    ],
  });
  const mechanics = new RapierMechanicsWorld(R, document, { paused: false, gravity: 0 });
  mechanics.applyTestTorque('assembly:input', { x: 2.5, y: 0, z: 0 });
  stepWorld(mechanics, 60);
  const snapshot = mechanics.getSnapshot();
  assert.ok(snapshot.assemblies['assembly:input'].angularVelocity.x > 0);
  assert.ok(snapshot.assemblies['assembly:output'].angularVelocity.x < 0);
  assert.ok(snapshot.couplings['coupling:1']);
  mechanics.dispose();
});

test('rotary cam gates sequence mounted spells from one driven shaft', () => {
  const document = createCamWatererDocument();
  const mechanics = new RapierMechanicsWorld(R, document, { paused: false });
  const seenActive = new Set();
  const activationOrder = [];
  let previousActiveId = null;
  for (let index = 0; index < 480; index += 1) {
    const before = mechanics.getSnapshot();
    const spells = evaluateMountedSpellDevices(document, before);
    mechanics.setSpellFields(spells.fields, spells.devices.filter((device) => device.active));
    mechanics.step(MECHANICS_FIXED_DT);
    for (const device of spells.devices) {
      if (!device.active) continue;
      seenActive.add(device.deviceId);
      if (device.deviceId !== previousActiveId) activationOrder.push(device.deviceId);
      previousActiveId = device.deviceId;
    }
  }
  assert.deepEqual(
    [...seenActive].sort(),
    ['spell-device:water-east', 'spell-device:water-north', 'spell-device:water-west'],
  );
  // Phases are clocked so the jets fire in row order: left (north), middle (east), right (west).
  assert.deepEqual(activationOrder.slice(0, 3), [
    'spell-device:water-north',
    'spell-device:water-east',
    'spell-device:water-west',
  ]);
  mechanics.dispose();
});

test('mountable spell plate derives its origin and force direction from the live body frame', () => {
  const rotation = quaternionFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
  const document = createMechanicsDocument({
    assemblies: [
      createAssembly({
        assemblyId: 'assembly:carrier',
        bodyMode: 'fixed',
        transform: { position: { x: 2, y: 1, z: -1 }, rotation },
      }),
    ],
    spellDevices: [
      createSpellDevice({
        deviceId: 'spell-device:mounted',
        assemblyId: 'assembly:carrier',
        spellTemplateId: 'wind-column',
        localFrame: {
          origin: { x: 0, y: 0, z: 0.4 },
          normal: { x: 0, y: 0, z: 1 },
          tangent: { x: 1, y: 0, z: 0 },
        },
      }),
    ],
  });
  const mechanics = new RapierMechanicsWorld(R, document);
  const spells = evaluateMountedSpellDevices(document, mechanics.getSnapshot(), {
    manualActiveIds: new Set(['spell-device:mounted']),
  });
  assert.equal(spells.devices[0].active, true);
  assert.ok(Math.abs(spells.devices[0].frame.origin.x - 2.4) < 0.001);
  assert.ok(Math.abs(spells.fields[0].direction.x - 1) < 0.001);
  assert.ok(Math.abs(spells.fields[0].direction.z) < 0.001);
  mechanics.dispose();
});

test('representative compiler output is consumed by the mechanics Rapier path', () => {
  const document = createMechanicsDocument({
    assemblies: [
      boxAssembly('assembly:compiled-plate', { x: 0, y: 1, z: 0 }, 'fixed'),
      boxAssembly('assembly:compiled-target', { x: 0, y: 1, z: 1.2 }),
    ],
    spellDevices: [
      createSpellDevice({
        deviceId: 'spell-device:compiled-wind',
        assemblyId: 'assembly:compiled-plate',
        spellTemplateId: 'wind-column',
        localFrame: {
          origin: { x: 0, y: 0, z: 0 },
          normal: { x: 0, y: 0, z: 1 },
          tangent: { x: 1, y: 0, z: 0 },
        },
      }),
    ],
  });
  const mechanics = new RapierMechanicsWorld(R, document, { paused: false, gravity: 0 });
  const spells = evaluateMountedSpellDevices(document, mechanics.getSnapshot(), {
    manualActiveIds: new Set(['spell-device:compiled-wind']),
  });
  const field = spells.fields.find((item) => item.fieldShape === 'column');
  assert.equal(field.forceMagnitude, 58.8967);
  assert.equal(field.materialKind, 'wind');
  assert.deepEqual(field.direction, { x: 0, y: 0, z: 1 });
  mechanics.setSpellFields(spells.fields, spells.devices);
  stepWorld(mechanics, 6);
  const snapshot = mechanics.getSnapshot();
  assert.ok(snapshot.forceApplications.some(
    (item) => item.fieldId === field.id && item.assemblyId === 'assembly:compiled-target',
  ));
  assert.ok(snapshot.assemblies['assembly:compiled-target'].velocity.z > 0);
  mechanics.dispose();
});

test('mounted plates consume their serialized native Spellpad compiler result', () => {
  const nativeCompileResult = compileSpell({
    title: 'Native Water Plate',
    seals: [{
      sigils: [{ name: 'water' }],
      rings: [{ radius: 100 }],
      signProfiles: [{ kind: 'column', amount: 4, size: 200, rotation: 0, angle: 0, radius: 80 }],
    }],
  });
  const document = createMechanicsDocument({
    assemblies: [boxAssembly('assembly:native-plate', { x: 0, y: 1, z: 0 }, 'fixed')],
    spellDevices: [createSpellDevice({
      deviceId: 'spell-device:native',
      assemblyId: 'assembly:native-plate',
      // Deliberately not a workshop preset: the serialized native result is authoritative.
      spellTemplateId: 'spell-template:player-water',
      spell: {
        templateId: 'spell-template:player-water',
        name: 'Native Water Plate',
        compileResult: nativeCompileResult,
      },
    })],
  });
  const mechanics = new RapierMechanicsWorld(R, document);
  const result = evaluateMountedSpellDevices(document, mechanics.getSnapshot(), {
    manualActiveIds: new Set(['spell-device:native']),
  });
  assert.equal(result.devices[0].spellName, 'Native Water Plate');
  assert.equal(result.devices[0].socketed, true);
  assert.ok(result.fields.some((field) => field.materialKind === 'water'));
  mechanics.dispose();
});

test('compiled Water dispersion and curtain components are consumed by mechanics', () => {
  const compiled = compileSpell({
    title: 'Water dispersion mechanics contract',
    seals: [{
      sigils: [{ name: 'water' }],
      rings: [{ radius: 100 }],
      signProfiles: [{ kind: 'dispersion', amount: 4, size: 200, radius: 80, angle: 0 }],
    }],
  });
  const runtime = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
    options: {
      placementFrame: {
        origin: { x: 0, y: 2, z: 0 },
        normal: { x: 0, y: 1, z: 0 },
        tangent: { x: 1, y: 0, z: 0 },
      },
    },
  });
  const intent = runtime.intents.find((item) => item.intentType === 'water_dispersion');
  const field = {
    ...intent.physicsField,
    id: 'field:compiled-water-dispersion',
    materialKind: intent.materialKind,
  };
  const document = createMechanicsDocument({
    assemblies: [
      boxAssembly('assembly:canopy-target', { x: 1, y: 2, z: 0 }),
      boxAssembly('assembly:curtain-target', { x: 1, y: 1, z: 0 }),
    ],
  });
  const mechanics = new RapierMechanicsWorld(R, document, { paused: false, gravity: 0 });
  mechanics.setSpellFields([field]);
  stepWorld(mechanics, 1);
  const applications = mechanics.getSnapshot().forceApplications.filter(
    (item) => item.fieldId === field.id,
  );
  assert.deepEqual(applications.map((item) => item.mode), ['dispersion', 'water_curtain']);
  assert.ok(applications.every((item) => item.magnitude > 0));
  const canopy = applications.find((item) => item.assemblyId === 'assembly:canopy-target');
  const curtain = applications.find((item) => item.assemblyId === 'assembly:curtain-target');
  assert.ok(canopy.force.x > 0);
  assert.ok(Math.abs(canopy.force.y) < 1e-9);
  assert.ok(curtain.force.y < 0);
  assert.ok(Math.abs(curtain.force.x) < 1e-9);
  mechanics.dispose();
});

test('mounted Water dispersion scales canopy and curtain force together', () => {
  const compiled = compileSpell({
    title: 'Scaled Water dispersion mechanics contract',
    seals: [{
      sigils: [{ name: 'water' }],
      rings: [{ radius: 100 }],
      signProfiles: [{ kind: 'dispersion', amount: 4, size: 200, radius: 80, angle: 0 }],
    }],
  });
  const forceScale = 0.35;
  const deviceId = 'spell-device:scaled-water-dispersion';
  const document = createMechanicsDocument({
    assemblies: [boxAssembly('assembly:scaled-water-owner', { x: 0, y: 2, z: 0 }, 'fixed')],
    spellDevices: [createSpellDevice({
      deviceId,
      assemblyId: 'assembly:scaled-water-owner',
      spellTemplateId: 'native:scaled-water-dispersion',
      spell: {
        templateId: 'native:scaled-water-dispersion',
        name: 'Scaled Water dispersion mechanics contract',
        compileResult: compiled,
      },
      forceScale,
    })],
  });
  const mechanics = new RapierMechanicsWorld(R, document);
  const evaluated = evaluateMountedSpellDevices(document, mechanics.getSnapshot(), {
    manualActiveIds: new Set([deviceId]),
  });
  const intent = evaluated.devices[0].outputIntents.find(
    (item) => item.intentType === 'water_dispersion',
  );
  const field = evaluated.fields.find((item) => item.deviceId === deviceId);
  assert.ok(intent);
  assert.ok(field);
  assert.equal(field.forceMagnitude, intent.physicsField.forceMagnitude * forceScale);
  assert.equal(
    field.curtain.forceMagnitude,
    intent.physicsField.curtain.forceMagnitude * forceScale,
  );
  mechanics.dispose();
});

function boxAssembly(assemblyId, position, bodyMode = 'dynamic') {
  return createAssembly({
    assemblyId,
    bodyMode,
    transform: { position },
    parts: [
      createPrimitivePart({
        partId: `${assemblyId}:part`,
        preset: 'cuboid',
        size: { x: 0.5, y: 0.5, z: 0.5 },
      }),
    ],
  });
}

function stepWorld(world, steps) {
  for (let index = 0; index < steps; index += 1) world.step(MECHANICS_FIXED_DT);
}

test('joint drives respect their torque cap and push back on an unanchored frame', () => {
  const fixture = (maxImpulse) =>
    createMechanicsDocument({
      assemblies: [
        createAssembly({
          assemblyId: 'assembly:free-stand',
          transform: { position: { x: 0, y: 6, z: 0 } },
          parts: [
            createPrimitivePart({
              partId: 'part:stand',
              preset: 'cuboid',
              size: { x: 1.4, y: 0.4, z: 1.4 },
              materialId: 'material.wood_heavy',
            }),
          ],
        }),
        createAssembly({
          assemblyId: 'assembly:rotor',
          transform: { position: { x: 0, y: 6.6, z: 0 } },
          parts: [
            createPrimitivePart({
              partId: 'part:rotor',
              preset: 'wheel',
              size: { x: 1.6, y: 0.2, z: 1.6 },
              materialId: 'material.iron',
            }),
          ],
        }),
      ],
      constraints: [
        createConstraint({
          constraintId: 'constraint:rotor-bearing',
          type: 'revolute',
          assemblyAId: 'assembly:free-stand',
          assemblyBId: 'assembly:rotor',
          localAnchorA: { x: 0, y: 0.6, z: 0 },
          localAnchorB: { x: 0, y: 0, z: 0 },
          localAxisA: { x: 0, y: 1, z: 0 },
          drive: { enabled: true, targetVelocity: 6, damping: 8, maxImpulse },
        }),
      ],
    });

  const spinAfter = (maxImpulse, steps) => {
    const mechanics = new RapierMechanicsWorld(R, fixture(maxImpulse), { paused: false });
    for (let index = 0; index < steps; index += 1) mechanics.step(MECHANICS_FIXED_DT);
    const snapshot = mechanics.getSnapshot();
    const result = {
      rotor: snapshot.assemblies['assembly:rotor'].angularVelocity.y,
      stand: snapshot.assemblies['assembly:free-stand'].angularVelocity.y,
    };
    mechanics.dispose();
    return result;
  };

  // A weak motor spins the rotor up far more slowly than a strong one.
  const weak = spinAfter(0.4, 30);
  const strong = spinAfter(40, 30);
  assert.ok(weak.rotor > 0.01, `weak motor should still turn the rotor (${weak.rotor.toFixed(3)})`);
  assert.ok(
    strong.rotor > weak.rotor * 2,
    `capped torque should limit spin-up (weak ${weak.rotor.toFixed(2)}, strong ${strong.rotor.toFixed(2)})`,
  );
  // Newton's third law: the free-floating stand counter-rotates against the rotor.
  assert.ok(
    Math.sign(strong.stand) === -Math.sign(strong.rotor) && Math.abs(strong.stand) > 0.01,
    `stand should counter-rotate (rotor ${strong.rotor.toFixed(2)}, stand ${strong.stand.toFixed(2)})`,
  );
});

test('meshed cogwheels counter-rotate at their pitch-radius ratio', () => {
  const cogAssembly = (assemblyId, position, diameter) =>
    createAssembly({
      assemblyId,
      transform: { position },
      tags: ['shaft'],
      parts: [
        createPrimitivePart({
          partId: `${assemblyId}:part`,
          shape: 'cogwheel',
          size: { x: diameter, y: 0.24, z: diameter },
          materialId: 'material.wood_heavy',
          rotationPortAxis: { x: 0, y: 1, z: 0 },
        }),
      ],
    });
  // Large (pitch r 0.8) and small (pitch r 0.4) flat cogs mesh at exactly
  // the sum of the pitch radii. Only the driven large cog has a public axle;
  // the mesh gives the unsupported small cog invisible free-spin support.
  const document = createMechanicsDocument({
    assemblies: [
      boxAssembly('assembly:frame', { x: 0, y: 2, z: 0 }, 'fixed'),
      cogAssembly('assembly:cog-large', { x: 0, y: 2.6, z: 0 }, 1.6),
      cogAssembly('assembly:cog-small', { x: 1.2, y: 2.6, z: 0 }, 0.8),
    ],
    constraints: [
      createConstraint({
        constraintId: 'constraint:axle-large',
        type: 'revolute',
        assemblyAId: 'assembly:frame',
        assemblyBId: 'assembly:cog-large',
        localAnchorA: { x: 0, y: 0.6, z: 0 },
        localAxisA: { x: 0, y: 1, z: 0 },
        drive: { enabled: true, targetVelocity: 2.2, damping: 8, maxImpulse: 24 },
      }),
    ],
    rotationCouplings: [
      createRotationCoupling({
        couplingId: 'coupling:mesh',
        assemblyAId: 'assembly:cog-large',
        assemblyBId: 'assembly:cog-small',
        axisA: { x: 0, y: 1, z: 0 },
        axisB: { x: 0, y: 1, z: 0 },
        ratio: -2,
        torqueCapacity: 32,
        style: 'mesh',
      }),
    ],
  });
  const mechanics = new RapierMechanicsWorld(R, document, { paused: false, gravity: 9.81 });
  stepWorld(mechanics, 420);
  const snapshot = mechanics.getSnapshot();
  const largeSpin = snapshot.assemblies['assembly:cog-large'].angularVelocity.y;
  const smallSpin = snapshot.assemblies['assembly:cog-small'].angularVelocity.y;
  assert.ok(largeSpin > 0.8, `large cog should spin up under its drive, got ${largeSpin}`);
  assert.ok(smallSpin < 0, 'meshed cog must counter-rotate');
  const ratio = smallSpin / largeSpin;
  assert.ok(
    Math.abs(ratio + 2) < 0.3,
    `small cog should spin at −2× the large cog, got ratio ${ratio.toFixed(2)}`,
  );
  // The colliders sit at the root radii, so meshed wheels never fight: no
  // contact force should have shoved either wheel off its axle plane.
  assert.ok(Math.abs(snapshot.assemblies['assembly:cog-small'].position.y - 2.6) < 0.05);
  assert.equal(snapshot.jointCount, 2, 'one public axle plus one internal mesh support');
  mechanics.dispose();
});

test('resource counts include owned Rapier bodies and return to zero after repeated unloads', () => {
  const document = createCatapultDocument();
  for (let index = 0; index < 12; index += 1) {
    const mechanics = new RapierMechanicsWorld(R, document);
    const snapshot = mechanics.getSnapshot();
    // Ground + four assemblies + the release sensor's fixed anchor.
    assert.equal(snapshot.bodyCount, 6);
    assert.equal(snapshot.assemblyBodyCount, 4);
    assert.equal(snapshot.colliderCount, 10);
    assert.equal(snapshot.collisionListenerCount, 1);
    assert.equal(snapshot.eventQueueCount, 1);
    assert.equal(snapshot.retainedSnapshotCount, 0);
    mechanics.dispose();
    const disposed = mechanics.getSnapshot();
    assert.equal(disposed.bodyCount, 0);
    assert.equal(disposed.colliderCount, 0);
    assert.equal(disposed.collisionListenerCount, 0);
    assert.equal(disposed.eventQueueCount, 0);
  }
});

test('finite catapult torsion settles, then wakes again for an impulse', () => {
  const mechanics = new RapierMechanicsWorld(R, createCatapultDocument(), { paused: false });
  stepWorld(mechanics, 120 * 120);
  let snapshot = mechanics.getSnapshot();
  assert.equal(snapshot.assemblies['assembly:catapult-arm'].sleeping, true);
  assert.equal(snapshot.awakeBodyCount, 0);
  assert.equal(mechanics.applyTestImpulse('assembly:catapult-arm', { x: 0, y: 1, z: 0 }), true);
  snapshot = mechanics.getSnapshot();
  assert.equal(snapshot.assemblies['assembly:catapult-arm'].sleeping, false);
  mechanics.dispose();
});

test('continuous motor remains active while finite settling thresholds are enabled', () => {
  const mechanics = new RapierMechanicsWorld(R, createCamWatererDocument(), { paused: false });
  stepWorld(mechanics, 120 * 10);
  const shaft = mechanics.getSnapshot().assemblies['assembly:camshaft'];
  assert.equal(shaft.sleeping, false);
  assert.ok(Math.abs(shaft.angularVelocity.x) > 0.2, `camshaft should remain driven (${shaft.angularVelocity.x})`);
  mechanics.dispose();
});

test('spell force wakes a settled finite body and escaped projectiles release owned physics', () => {
  const projectile = createAssembly({
    assemblyId: 'assembly:projectile',
    tags: ['projectile'],
    transform: { position: { x: 0, y: 0.4, z: 0 } },
    parts: [createPrimitivePart({ partId: 'part:projectile', preset: 'sphere' })],
  });
  const mechanics = new RapierMechanicsWorld(R, createMechanicsDocument({ assemblies: [projectile] }), {
    paused: false,
  });
  stepWorld(mechanics, 360);
  assert.equal(mechanics.getSnapshot().assemblies['assembly:projectile'].sleeping, true);
  mechanics.setSpellFields([{
    id: 'field:wake', active: true, fieldShape: 'target_force', targetAssemblyId: 'assembly:projectile',
    direction: { x: 0, y: 1, z: 0 }, forceMagnitude: 30,
  }]);
  mechanics.step(MECHANICS_FIXED_DT);
  assert.equal(mechanics.getSnapshot().assemblies['assembly:projectile'].sleeping, false);
  mechanics.bodyByAssemblyId.get('assembly:projectile').setTranslation({ x: 61, y: 1, z: 0 }, true);
  mechanics.step(MECHANICS_FIXED_DT);
  const cleaned = mechanics.getSnapshot();
  assert.equal(cleaned.projectileCount, 0);
  assert.deepEqual(cleaned.removedAssemblyIds, ['assembly:projectile']);
  assert.equal(cleaned.bodyCount, 1, 'only the ground remains after projectile cleanup');
  mechanics.dispose();
});

test('projectile runtime ownership is capped without changing the document', () => {
  const assemblies = Array.from({ length: 17 }, (_, index) =>
    createAssembly({
      assemblyId: `assembly:projectile-${index}`,
      tags: ['projectile'],
      transform: { position: { x: index, y: 1, z: 0 } },
      parts: [createPrimitivePart({ partId: `part:projectile-${index}`, preset: 'sphere' })],
    }),
  );
  const mechanics = new RapierMechanicsWorld(R, createMechanicsDocument({ assemblies }));
  const snapshot = mechanics.getSnapshot();
  assert.equal(snapshot.projectileCount, 16);
  assert.equal(snapshot.bodyCount, 17, '16 active projectiles plus ground');
  assert.deepEqual(snapshot.removedAssemblyIds, ['assembly:projectile-16']);
  assert.equal(assemblies.length, 17, 'runtime cap does not mutate the document');
  mechanics.dispose();
});
