import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileSpell } from '../../src/compiler/compile.js';
import {
  NORMALIZED_SPELL_CIRCLE_RADIUS,
  interpretCompiledSpell,
  placedSpellDispersionClearanceRadius,
} from '../../src/simulation-engine/index.js';
import {
  createAssembly,
  createConstraint,
  createForceElement,
  createLatch,
  createMechanicsDocument,
  createPrimitivePart,
  quaternionFromAxisAngle,
  createSensor,
} from '../../src/mechanics-engine/index.js';
import { loadRapier } from '../src/mechanics/rapier-loader.js';
import { MainWorldRapierRuntime } from '../src/world-physics/MainWorldRapierRuntime.js';
import {
  createCamWatererDocument,
  createCatapultDocument,
  createPressurePlateDocument,
} from '../src/mechanics/starterDocuments.js';
import {
  ATELIER_DESK_LAYOUT,
  ATELIER_ENTRANCE_STEPS,
  ATELIER_PLAYTHROUGH,
  ATELIER_ROOF_LAYOUT,
  FORCE_CONTRACT,
  EARTH_EMERGENCE_SPEED,
  MAIN_WORLD_BUILTIN_BODIES,
  MAIN_WORLD_FIXED_DT,
  MAIN_WORLD_FORCE_BUDGET,
  MAIN_WORLD_TERRAIN_SIZE,
  buildMainWorldSpellFields,
  classifyMainWorldBody,
  comparableForceLimit,
  earthColumnPushLimit,
  earthPushResistance,
  earthEmergenceSweep,
  sampleDispersionField,
  sampleEarthSweep,
  sampleWaterCurtain,
  takeAggregateForceBudget,
  terrainHeightAt,
} from '../src/world-physics/force-contract.js';
import { MAIN_WORLD_PLAYER_CONFIG } from '../src/world-physics/MainWorldRapierRuntime.js';

const R = await loadRapier();

test('main-world body classification keeps terrain/house/explicit fixed immovable and loose bodies dynamic', () => {
  assert.equal(classifyMainWorldBody({ role: 'terrain' }), 'fixed');
  assert.equal(classifyMainWorldBody({ role: 'house' }), 'fixed');
  assert.equal(classifyMainWorldBody({ bodyMode: 'fixed' }), 'fixed');
  assert.equal(classifyMainWorldBody({ movable: false }), 'fixed');
  assert.equal(classifyMainWorldBody({ bodyMode: 'dynamic', movable: true }), 'dynamic');
  assert.equal(classifyMainWorldBody({ visualKind: 'tree_apple' }), 'dynamic');
});

test('atelier entrance stones form one shallow, overlapping rise into the floor', () => {
  assert.equal(ATELIER_ENTRANCE_STEPS.length, 4);
  for (let index = 0; index < ATELIER_ENTRANCE_STEPS.length; index += 1) {
    const step = ATELIER_ENTRANCE_STEPS[index];
    assert.ok(step.height <= 0.32);
    if (index === ATELIER_ENTRANCE_STEPS.length - 1) continue;
    const outward = ATELIER_ENTRANCE_STEPS[index + 1];
    assert.ok(step.height > outward.height);
    assert.ok(step.height - outward.height <= 0.08 + Number.EPSILON);
    assert.ok(outward.z - step.z < step.radius + outward.radius);
  }
  assert.ok(ATELIER_DESK_LAYOUT.floorY - ATELIER_ENTRANCE_STEPS[0].height <= 0.08);
});

test('consumer caps preserve compiler strength ordering and exact zero-force Light', () => {
  assert.equal(comparableForceLimit('water', 'column', 4, 20), 80);
  assert.equal(comparableForceLimit('fire', 'column', 4, 12), 48);
  assert.equal(comparableForceLimit('wind', 'column', 4, 15.6), 62.4);
  assert.ok(
    Math.abs(
      comparableForceLimit('wind', 'column', 4, 15.6) -
      comparableForceLimit('fire', 'column', 4, 12) * 1.3,
    ) < 1e-9,
  );
  assert.equal(comparableForceLimit('light', 'column', 1000, 0), 0);
  assert.equal(comparableForceLimit('water', 'dispersion', 20, 2), FORCE_CONTRACT.dispersion.water.cap);
  assert.equal(comparableForceLimit('earth', 'dispersion', 20, 0.6), FORCE_CONTRACT.dispersion.earth.cap);
  assert.equal(comparableForceLimit('water', 'water_curtain', 20, 4), 36);
  assert.equal(comparableForceLimit('earth', 'earth_emergence', 20, 16), 140);
  assert.equal(comparableForceLimit('water', 'column', 2, 200, 0.25), 100);
});

test('dispersion separates outward canopy force from the downward Water-only curtain', () => {
  const field = {
    materialKind: 'water',
    center: { x: 0, y: 2, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
    axisU: { x: 1, y: 0, z: 0 },
    axisV: { x: 0, y: 0, z: 1 },
    innerRadius: 0.4,
    outerRadius: 2,
    halfThickness: 0.25,
    signAngles: [0],
    curtain: {
      direction: { x: 0, y: -1, z: 0 },
      forceMagnitude: 4,
    },
  };
  const spread = sampleDispersionField(field, { x: 1, y: 2, z: 0 });
  assert.ok(spread);
  assert.deepEqual(spread.direction, { x: 1, y: 0, z: 0 });
  assert.equal(sampleDispersionField(field, { x: 2.2, y: 2, z: 0 }), null);
  assert.equal(
    sampleDispersionField(field, { x: -1, y: 2, z: 0 }),
    null,
    'the uncovered opposite quadrant must stay outside the canopy field',
  );
  assert.equal(
    sampleWaterCurtain(field, { x: 1, y: 2, z: 0 }),
    null,
    'the canopy itself must not also receive the falling-water force',
  );
  const curtain = sampleWaterCurtain(field, { x: 1, y: 1, z: 0 });
  assert.ok(curtain);
  assert.deepEqual(curtain.direction, { x: 0, y: -1, z: 0 });
  assert.equal(
    sampleWaterCurtain(field, { x: -1, y: 1, z: 0 }),
    null,
    'the falling curtain must preserve the source sign angular coverage',
  );
  assert.equal(
    sampleWaterCurtain({ ...field, materialKind: 'fire' }, { x: 1, y: 1, z: 0 }),
    null,
    'non-Water dispersions never gain a falling-water force',
  );
  assert.equal(
    sampleWaterCurtain({ ...field, curtain: null }, { x: 1, y: 1, z: 0 }),
    null,
    'Water fields must opt into the explicit curtain contract',
  );
  const contactedField = {
    ...field,
    signAngles: [0, Math.PI / 2, Math.PI, Math.PI * 1.5],
    dispersionContacts: {
      quadrants: [
        { landingY: 0.8 },
        { landingY: 0 },
        { landingY: 0.2 },
        { landingY: 0 },
      ],
    },
  };
  assert.equal(
    sampleWaterCurtain(contactedField, { x: 1, y: 0.7, z: 0 }),
    null,
    'quadrant zero force must end at its own collision landing height',
  );
  const oppositeQuadrant = sampleWaterCurtain(contactedField, { x: -1, y: 0.7, z: 0 });
  assert.ok(oppositeQuadrant);
  assert.equal(oppositeQuadrant.quadrantIndex, 2);
  assert.equal(oppositeQuadrant.landingY, 0.2);
});

test('both Water dispersion regions are noticeable but weaker than a comparable Water column', () => {
  const mass = 4;
  const column = comparableForceLimit('water', 'column', mass, 20, 1);
  const canopy = comparableForceLimit('water', 'dispersion', mass, 2, 1);
  const curtain = comparableForceLimit('water', 'water_curtain', mass, 4, 1);
  assert.ok(canopy > 0);
  assert.ok(curtain > 0);
  assert.ok(canopy < column);
  assert.ok(curtain < column);
});

test('aggregate body budget never grants more than 180 force units', () => {
  assert.equal(takeAggregateForceBudget(0, 160), 160);
  assert.equal(takeAggregateForceBudget(160, 80), 20);
  assert.equal(takeAggregateForceBudget(180, 1), 0);
  assert.equal(MAIN_WORLD_FORCE_BUDGET, 180);
});

test('main-world Rapier runtime applies water > wind = 1.3x fire column forces and Light applies none', () => {
  const magnitudes = {};
  for (const materialKind of ['water', 'fire', 'wind', 'light']) {
    const runtime = new MainWorldRapierRuntime(R, {
      props: [looseProp('target', { x: 1, y: 0, z: 0 }, 4)],
      placedSpells: [columnSpell(materialKind)],
    });
    runtime.step(MAIN_WORLD_FIXED_DT);
    const application = runtime.getSnapshot().forceApplications.find((item) => item.bodyId === 'prop:target');
    magnitudes[materialKind] = application?.magnitude ?? 0;
    if (application) assert.equal(application.wakeUp, true);
    runtime.dispose();
  }
  assert.ok(magnitudes.water > magnitudes.wind);
  assert.ok(magnitudes.wind > magnitudes.fire);
  assert.ok(Math.abs(magnitudes.wind / magnitudes.fire - 1.3) < 1e-9);
  assert.equal(magnitudes.light, 0);
});

test('representative compiler fields pass unchanged into the main-world consumer', () => {
  for (const materialKind of ['water', 'fire', 'wind', 'earth', 'light']) {
    const runtimeResult = compileColumnRuntime(materialKind);
    const intent = runtimeResult.intents.find((item) =>
      ['water_column', 'material_column'].includes(item.intentType),
    );
    const built = buildMainWorldSpellFields([{
      id: `spell:compiled-${materialKind}`,
      activationInstanceId: 1,
      anchor: { surfaceKind: 'world', surfaceId: 'practice-field-terrain' },
      runtimeResult,
    }]);
    assert.equal(built.fields.length, 1, materialKind);
    assert.equal(built.fields[0].fieldShape, intent.physicsField.fieldShape);
    assert.equal(built.fields[0].forceMagnitude, intent.physicsField.forceMagnitude);
    assert.deepEqual(built.fields[0].direction, intent.physicsField.direction);
    assert.equal(built.fields[0].length, intent.physicsField.length);
    assert.equal(built.fields[0].radius, intent.physicsField.radius);
  }

  const runtimeResult = compileColumnRuntime('wind');
  const runtime = new MainWorldRapierRuntime(R, {
    props: [looseProp('compiled-target', { x: 0, y: 0, z: 0 }, 1)],
    placedSpells: [{
      id: 'spell:compiled-wind',
      activationInstanceId: 1,
      anchor: { surfaceKind: 'world', surfaceId: 'practice-field-terrain' },
      runtimeResult,
    }],
  });
  runtime.step(MAIN_WORLD_FIXED_DT);
  const application = runtime.getSnapshot().forceApplications.find(
    (item) => item.bodyId === 'prop:compiled-target' && item.mode === 'column',
  );
  assert.ok(application);
  assert.ok(application.magnitude > 0);
  runtime.dispose();
});

test('compiled Light levitation creates one Rapier orb body and lifecycle cleanup removes it', () => {
  const runtimeResult = compileLevitationRuntime('light');
  const force = runtimeResult.intents.find((item) => item.intentType === 'force_constraint_debug');
  assert.equal(force.physicsField.fieldShape, 'generated_levitation_orb');
  const placedSpell = {
    id: 'spell:light-levitation',
    activationInstanceId: 1,
    anchor: { surfaceKind: 'world', surfaceId: 'practice-field-terrain' },
    runtimeResult,
  };
  const built = buildMainWorldSpellFields([placedSpell]);
  assert.equal(built.fields.length, 1);
  assert.equal(built.fields[0].materialKind, 'light');

  const runtime = new MainWorldRapierRuntime(R, { placedSpells: [placedSpell] });
  runtime.step(MAIN_WORLD_FIXED_DT);
  const active = runtime.getSnapshot();
  const orb = Object.values(active.bodies).find((body) => body.role === 'generated_levitation_orb');
  assert.ok(orb);
  assert.match(orb.renderName, /^levitation-orb:main-world-field:/);
  assert.ok(orb.position.y > 0.5);

  runtime.syncSpells([{
    ...placedSpell,
    runtimeResult: {
      ...runtimeResult,
      lifecycle: { ...runtimeResult.lifecycle, active: false },
      intents: runtimeResult.intents.map((intent) => ({ ...intent, active: false })),
    },
  }]);
  assert.equal(
    Object.values(runtime.getSnapshot().bodies).some((body) => body.role === 'generated_levitation_orb'),
    false,
  );
  runtime.dispose();
});

test('only Earth generated levitation orbs keep a physical collider', () => {
  for (const materialKind of ['water', 'fire', 'light', 'earth']) {
    const runtimeResult = compileLevitationRuntime(materialKind);
    const placedSpell = {
      id: `spell:${materialKind}-collision-mode`,
      activationInstanceId: 1,
      anchor: { surfaceKind: 'world', surfaceId: 'practice-field-terrain' },
      runtimeResult,
    };
    const runtime = new MainWorldRapierRuntime(R, { placedSpells: [placedSpell] });
    runtime.step(MAIN_WORLD_FIXED_DT);
    const fieldId = runtime.getSnapshot().fields[0].id;
    const record = runtime.generatedLevitationBodies.get(fieldId);
    assert.ok(record);
    assert.equal(record.collisionMode, materialKind === 'earth' ? 'solid' : 'passthrough');
    assert.equal(record.body.numColliders(), materialKind === 'earth' ? 1 : 0);
    assert.equal(
      runtime.getSnapshot().bodies[`generated:${fieldId}`].collisionMode,
      materialKind === 'earth' ? 'solid' : 'passthrough',
    );
    runtime.dispose();
  }
});

test('persisted levitation snapshots discard their retired radius at the world boundary', () => {
  const runtimeResult = compileLevitationRuntime('light');
  const staleRadius = 9;
  const intents = runtimeResult.intents.map((intent) => (
    intent.intentType === 'force_constraint_debug'
      ? { ...intent, physicsField: { ...intent.physicsField, radius: staleRadius } }
      : intent
  ));
  const circle = intents.find((intent) => intent.intentType === 'spell_circle_render_data');
  const built = buildMainWorldSpellFields([{
    id: 'spell:persisted-light-levitation',
    activationInstanceId: 1,
    anchor: { surfaceKind: 'world', surfaceId: 'practice-field-terrain' },
    runtimeResult: { ...runtimeResult, intents },
  }]);

  assert.notEqual(built.fields[0].radius, staleRadius);
  assert.equal(
    built.fields[0].radius,
    NORMALIZED_SPELL_CIRCLE_RADIUS * circle.placementFrame.worldScale,
  );
});

test('imbalanced elemental levitation launches its generated body through Rapier', () => {
  const runtimeResult = compileLevitationRuntime('light', true);
  const placedSpell = {
    id: 'spell:light-launch',
    activationInstanceId: 1,
    anchor: { surfaceKind: 'world', surfaceId: 'practice-field-terrain' },
    runtimeResult,
  };
  const runtime = new MainWorldRapierRuntime(R, { placedSpells: [placedSpell] });
  const before = Object.values(runtime.getSnapshot().bodies)
    .find((body) => body.role === 'generated_levitation_orb');
  for (let index = 0; index < 8; index += 1) runtime.step(MAIN_WORLD_FIXED_DT);
  const after = Object.values(runtime.getSnapshot().bodies)
    .find((body) => body.role === 'generated_levitation_orb');
  assert.ok(after);
  assert.ok(Math.hypot(
    after.position.x - before.position.x,
    after.position.y - before.position.y,
    after.position.z - before.position.z,
  ) > 0.15);
  assert.ok(Math.hypot(
    after.linearVelocity.x,
    after.linearVelocity.y,
    after.linearVelocity.z,
  ) > 1);
  runtime.dispose();
});

test('main-world Wind Levitation applies carrier force opposite top, underside, and side spell faces', () => {
  const cases = [
    {
      normal: { x: 0, y: 1, z: 0 },
      tangent: { x: 1, y: 0, z: 0 },
      axis: 'y',
      sign: -1,
    },
    {
      normal: { x: 0, y: -1, z: 0 },
      tangent: { x: 1, y: 0, z: 0 },
      axis: 'y',
      sign: 1,
    },
    {
      normal: { x: 1, y: 0, z: 0 },
      tangent: { x: 0, y: 0, z: 1 },
      axis: 'x',
      sign: -1,
    },
  ];

  for (const [index, { normal, tangent, axis, sign }] of cases.entries()) {
    const runtimeResult = compileLevitationRuntime('wind', false, {
      origin: { x: 0, y: 1, z: 0 },
      normal,
      tangent,
    });
    const spell = {
      id: `spell:wind-carrier-${index}`,
      activationInstanceId: 1,
      anchor: { surfaceKind: 'prop', surfaceTargetId: 'carrier' },
      binding: { bodyId: 'prop:carrier' },
      runtimeResult,
    };
    const runtime = new MainWorldRapierRuntime(R, {
      props: [looseProp('carrier', { x: 0, y: 1, z: 0 }, 2)],
      placedSpells: [spell],
    });
    runtime.step(MAIN_WORLD_FIXED_DT);
    const application = runtime.getSnapshot().forceApplications.find(
      (item) => item.mode === 'carrier_levitation' && item.bodyId === 'prop:carrier',
    );
    assert.ok(application);
    assert.ok(application.force[axis] * sign > 0, `${axis} force must have sign ${sign}`);
    runtime.dispose();
  }
});

test('main-world Rapier applies outward canopy and downward curtain forces in separate regions', () => {
  const placementFrame = {
    origin: { x: 0, y: 2, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
    tangent: { x: 1, y: 0, z: 0 },
  };
  const runtimeResult = compileDispersionRuntime('water', placementFrame);
  const intent = runtimeResult.intents.find((item) => item.intentType === 'water_dispersion');
  const placedSpell = {
    id: 'spell:compiled-water-dispersion',
    activationInstanceId: 1,
    anchor: { surfaceKind: 'world', surfaceId: 'practice-field-terrain' },
    runtimeResult,
  };
  const built = buildMainWorldSpellFields([placedSpell]);
  assert.equal(built.fields.length, 1);
  assert.equal(built.fields[0].forceMagnitude, intent.physicsField.forceMagnitude);
  assert.equal(
    built.fields[0].curtain.forceMagnitude,
    intent.physicsField.curtain.forceMagnitude,
  );
  assert.equal(built.fields[0].outerRadius, placedSpellDispersionClearanceRadius(1));

  const runtime = new MainWorldRapierRuntime(R, {
    // Prop positions are bottom-aligned; the runtime adds a 0.25 center offset.
    props: [
      looseProp('canopy-target', { x: 1, y: 1.75, z: 0 }, 1),
      looseProp('curtain-target', { x: 1, y: 0.75, z: 0 }, 1),
    ],
    placedSpells: [placedSpell],
  });
  runtime.step(MAIN_WORLD_FIXED_DT);
  const applications = runtime.getSnapshot().forceApplications;
  const canopy = applications.find((item) => item.bodyId === 'prop:canopy-target');
  const curtain = applications.find((item) => item.bodyId === 'prop:curtain-target');
  assert.equal(canopy?.mode, 'dispersion');
  assert.ok(canopy.force.x > 0);
  assert.ok(Math.abs(canopy.force.y) < 1e-9);
  assert.equal(curtain?.mode, 'water_curtain');
  assert.ok(curtain.force.y < 0);
  assert.ok(Math.abs(curtain.force.x) < 1e-9);
  runtime.dispose();
});

test('Rapier publishes four independent dispersion landings and one blocker shortens only its field-local quadrant', () => {
  const placementFrame = {
    origin: { x: 0, y: 2, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
    tangent: { x: 1, y: 0, z: 0 },
  };
  const radius = placedSpellDispersionClearanceRadius(1);
  const theta = (19.3 * Math.PI) / 180;
  const runtime = new MainWorldRapierRuntime(R, {
    props: [looseProp('quadrant-zero-blocker', {
      x: Math.cos(theta) * radius,
      y: 0.8,
      z: Math.sin(theta) * radius,
    }, 4)],
    placedSpells: [{
      id: 'spell:quadrant-contact',
      activationInstanceId: 1,
      anchor: { surfaceKind: 'world', surfaceId: 'practice-field-terrain' },
      runtimeResult: compileDispersionRuntime('water', placementFrame),
    }],
  });
  runtime.step(MAIN_WORLD_FIXED_DT);
  const field = runtime.getSnapshot().fields.find(
    (item) => item.placedSpellId === 'spell:quadrant-contact',
  );
  assert.equal(field.dispersionContacts.model, 'four_independent_quadrants');
  assert.equal(field.dispersionContacts.quadrants.length, 4);
  const blockedQuadrant = field.dispersionContacts.quadrants.find(
    (quadrant) => quadrant.bodyId === 'prop:quadrant-zero-blocker',
  );
  assert.ok(blockedQuadrant, 'the field-local quadrant containing the blocker owns the contact');
  assert.ok(blockedQuadrant.landingY > 0.8);
  for (const quadrant of field.dispersionContacts.quadrants.filter(
    (item) => item.index !== blockedQuadrant.index,
  )) {
    assert.notEqual(quadrant.bodyId, 'prop:quadrant-zero-blocker');
    assert.ok(quadrant.landingY < blockedQuadrant.landingY);
  }
  runtime.dispose();
});

test('the player collider is an authoritative dispersion-quadrant contact', () => {
  const radius = placedSpellDispersionClearanceRadius(1);
  const runtime = new MainWorldRapierRuntime(R, {
    playerState: {
      position: {
        x: radius / Math.SQRT2,
        y: 0,
        z: -radius / Math.SQRT2,
      },
    },
    placedSpells: [{
      id: 'spell:player-quadrant-contact',
      activationInstanceId: 1,
      anchor: { surfaceKind: 'world', surfaceId: 'practice-field-terrain' },
      runtimeResult: compileDispersionRuntime('water', {
        origin: { x: 0, y: 2, z: 0 },
        normal: { x: 0, y: 1, z: 0 },
        tangent: { x: 1, y: 0, z: 0 },
      }),
    }],
  });
  runtime.step(MAIN_WORLD_FIXED_DT);
  const quadrants = runtime.getSnapshot().fields[0].dispersionContacts.quadrants;
  const playerContacts = quadrants.filter((quadrant) => quadrant.bodyId === 'player');
  assert.equal(playerContacts.length, 1, 'standing within one sector shortens only that sector');
  assert.ok(playerContacts[0].landingY > 1.4, 'the curtain lands at the player collider top');
  runtime.dispose();
});

test('main-world non-Water dispersion has canopy force and no curtain force', () => {
  const runtimeResult = compileDispersionRuntime('fire', {
    origin: { x: 0, y: 2, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
    tangent: { x: 1, y: 0, z: 0 },
  });
  const runtime = new MainWorldRapierRuntime(R, {
    props: [
      looseProp('fire-canopy-target', { x: 1, y: 1.75, z: 0 }, 1),
      looseProp('fire-curtain-target', { x: 1, y: 0.75, z: 0 }, 1),
    ],
    placedSpells: [{
      id: 'spell:compiled-fire-dispersion',
      activationInstanceId: 1,
      anchor: { surfaceKind: 'world', surfaceId: 'practice-field-terrain' },
      runtimeResult,
    }],
  });
  runtime.step(MAIN_WORLD_FIXED_DT);
  const applications = runtime.getSnapshot().forceApplications.filter(
    (item) => item.fieldId.includes('spell:compiled-fire-dispersion'),
  );
  assert.deepEqual(applications.map((item) => item.mode), ['dispersion']);
  assert.ok(applications[0].force.x > 0);
  assert.ok(Math.abs(applications[0].force.y) < 1e-9);
  runtime.dispose();
});

test('overlapping fields share one 180-unit body cap and deactivation stops force without erasing velocity', () => {
  const spells = [columnSpell('water', 'a'), columnSpell('water', 'b'), columnSpell('water', 'c')];
  const runtime = new MainWorldRapierRuntime(R, {
    props: [looseProp('target', { x: 1, y: 0, z: 0 }, 20)],
    placedSpells: spells,
  });
  runtime.step(MAIN_WORLD_FIXED_DT);
  const active = runtime.getSnapshot();
  const total = active.forceApplications
    .filter((item) => item.bodyId === 'prop:target')
    .reduce((sum, item) => sum + item.magnitude, 0);
  assert.ok(total <= 180 + 1e-9);
  assert.ok(active.bodies['prop:target'].linearVelocity.x > 0);
  runtime.syncSpells(spells.map((spell) => ({
    ...spell,
    runtimeResult: { ...spell.runtimeResult, lifecycle: { active: false }, intents: spell.runtimeResult.intents.map((intent) => ({ ...intent, active: false })) },
  })));
  const before = runtime.getSnapshot().bodies['prop:target'].linearVelocity.x;
  runtime.step(MAIN_WORLD_FIXED_DT);
  const inactive = runtime.getSnapshot();
  assert.equal(inactive.forceApplications.length, 0);
  assert.ok(inactive.bodies['prop:target'].linearVelocity.x > 0);
  assert.ok(inactive.bodies['prop:target'].linearVelocity.x <= before);
  runtime.dispose();
});

test('Earth emergence pushes a dynamic obstruction and gives a dynamic mount equal-opposite reaction', () => {
  const spell = columnSpell('earth', 'earth-react', {
    anchor: { surfaceKind: 'prop', surfaceTargetId: 'mount' },
    origin: { x: 0, y: 0.25, z: 0 },
  });
  const runtime = new MainWorldRapierRuntime(R, {
    props: [
      looseProp('mount', { x: 0, y: 0, z: 0 }, 5),
      looseProp('obstruction', { x: 0.32, y: 0, z: 0 }, 3),
    ],
    placedSpells: [spell],
  });
  runtime.step(MAIN_WORLD_FIXED_DT);
  const applications = runtime.getSnapshot().forceApplications;
  const obstruction = applications.find((item) => item.bodyId === 'prop:obstruction' && item.mode === 'earth_emergence');
  const reaction = applications.find((item) => item.bodyId === 'prop:mount' && item.mode === 'earth_mount_reaction');
  assert.ok(obstruction);
  assert.ok(reaction);
  assert.ok(Math.abs(obstruction.force.x + reaction.force.x) < 1e-7);
  runtime.dispose();
});

test('a bound Wind column applies thrust to its massless dynamic host', () => {
  const spell = columnSpell('wind', 'bound-thrust', {
    origin: { x: 0.28, y: 1, z: 0 },
  });
  spell.binding = {
    bodyId: 'prop:mount',
    surfaceKind: 'prop',
    surfaceTargetId: 'mount',
    surfaceLabel: 'mount',
  };
  const runtime = new MainWorldRapierRuntime(R, {
    props: [looseProp('mount', { x: 0, y: 0.75, z: 0 }, 5)],
    placedSpells: [spell],
  });
  const bodyCountBefore = runtime.getSnapshot().bodyCount;
  runtime.step(MAIN_WORLD_FIXED_DT);
  const snapshot = runtime.getSnapshot();
  const reaction = snapshot.forceApplications.find(
    (item) => item.bodyId === 'prop:mount' && item.mode === 'wind_mount_thrust',
  );
  assert.ok(reaction);
  assert.ok(reaction.force.x < 0, 'host moves opposite the emitted wind direction');
  assert.ok(snapshot.bodies['prop:mount'].linearVelocity.x < 0);
  assert.equal(snapshot.bodyCount, bodyCountBefore, 'binding adds no spell rigid body');
  assert.deepEqual(snapshot.gravityBodies, {});
  runtime.dispose();
});

test('binding to the pre-rotated fixed Atelier starts with an identity attachment delta', () => {
  const spell = columnSpell('light', 'atelier-bound', {
    origin: { x: ATELIER_PLAYTHROUGH.position.x, y: 1.5, z: ATELIER_PLAYTHROUGH.position.z },
  });
  spell.binding = {
    bodyId: 'atelier-house',
    surfaceKind: 'world',
    surfaceId: 'atelier-house',
    surfaceLabel: 'Atelier',
  };
  const runtime = new MainWorldRapierRuntime(R, { placedSpells: [spell] });
  const delta = runtime.mountedTransformForSpell(spell.id);
  assert.ok(Math.hypot(delta.translation.x, delta.translation.y, delta.translation.z) < 0.000001);
  assert.ok(Math.hypot(delta.rotation.x, delta.rotation.y, delta.rotation.z) < 0.000001);
  assert.ok(Math.abs(Math.abs(delta.rotation.w) - 1) < 0.000001);
  assert.deepEqual(runtime.getSnapshot().gravityBodies, {});
  runtime.dispose();
});

test('fixed Earth obstruction shatters on the first confirmed physical contact', () => {
  const signals = [];
  const runtime = new MainWorldRapierRuntime(R, {
    props: [{ ...looseProp('wall', { x: 0.32, y: 0, z: 0 }, 20), movable: false, bodyMode: 'fixed' }],
    placedSpells: [columnSpell('earth', 'earth-blocked')],
    onEarthBlocked: (placedSpellId, signal) => signals.push({ placedSpellId, signal }),
  });
  runtime.step(MAIN_WORLD_FIXED_DT);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].placedSpellId, 'spell:earth-blocked');
  assert.equal(signals[0].signal.elapsedMs, 17);
  assert.equal(signals[0].signal.reason, 'fixed_mount_fixed_obstruction');
  runtime.dispose();
});

test('earth push capacity is radius-dominant and shatters against excessive resistance', () => {
  const base = { radius: 0.84, length: 12.6, forceMagnitude: 60 };
  const baseLimit = earthColumnPushLimit(base);
  const radiusGain = earthColumnPushLimit({ ...base, radius: base.radius * 2 }) - baseLimit;
  const lengthGain = earthColumnPushLimit({ ...base, length: base.length * 2 }) - baseLimit;
  assert.ok(radiusGain > lengthGain * 10, `radius gain ${radiusGain} should dominate length gain ${lengthGain}`);
  assert.ok(earthPushResistance(20) > earthColumnPushLimit({ radius: 0.58, length: 4.2, forceMagnitude: 16 }));

  const signals = [];
  const runtime = new MainWorldRapierRuntime(R, {
    props: [looseProp('too-heavy', { x: 0.32, y: 0, z: 0 }, 20)],
    placedSpells: [columnSpell('earth', 'heavy-resistance')],
    onEarthBlocked: (placedSpellId, signal) => signals.push({ placedSpellId, signal }),
  });
  runtime.step(MAIN_WORLD_FIXED_DT);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].signal.reason, 'earth_column_resistance_exceeded');
  assert.ok(signals[0].signal.requiredForce > signals[0].signal.pushLimit);
  runtime.dispose();
});

test('passable columns stop at the nearest contact and do not force bodies behind it', () => {
  const runtime = new MainWorldRapierRuntime(R, {
    props: [
      looseProp('near', { x: 1, y: 0, z: 0 }, 2),
      looseProp('far', { x: 2, y: 0, z: 0 }, 2),
    ],
    placedSpells: [columnSpell('wind', 'nearest-contact')],
  });
  runtime.step(MAIN_WORLD_FIXED_DT);
  const snapshot = runtime.getSnapshot();
  assert.ok(snapshot.forceApplications.some((item) => item.bodyId === 'prop:near'));
  assert.equal(snapshot.forceApplications.some((item) => item.bodyId === 'prop:far'), false);
  assert.equal(snapshot.fields[0].interception.bodyId, 'prop:near');
  assert.equal(snapshot.fields[0].interception.segment, 'straight');
  runtime.dispose();
});

test('a fixed interception truncates a passable column without applying force behind it', () => {
  const runtime = new MainWorldRapierRuntime(R, {
    props: [
      { ...looseProp('wall', { x: 1, y: 0, z: 0 }, 20), movable: false, bodyMode: 'fixed' },
      looseProp('behind', { x: 2, y: 0, z: 0 }, 2),
    ],
    placedSpells: [columnSpell('fire', 'fixed-cutoff')],
  });
  runtime.step(MAIN_WORLD_FIXED_DT);
  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.forceApplications.some((item) => item.bodyId === 'prop:behind'), false);
  assert.equal(snapshot.fields[0].interception.bodyId, 'prop:wall');
  assert.equal(snapshot.fields[0].interception.forceApplied, false);
  runtime.dispose();
});

test('Water continuation keeps full force through its tapered falling trajectory', () => {
  const straight = new MainWorldRapierRuntime(R, {
    props: [looseProp('straight', { x: 1, y: 1.75, z: 0 }, 4)],
    placedSpells: [columnSpell('water', 'straight-water', { origin: { x: 0, y: 2, z: 0 } })],
  });
  straight.step(MAIN_WORLD_FIXED_DT);
  const straightForce = straight.getSnapshot().forceApplications.find((item) => item.bodyId === 'prop:straight');
  assert.ok(straightForce);
  straight.dispose();

  const falling = new MainWorldRapierRuntime(R, {
    props: [looseProp('falling', { x: 5.8, y: 1.015, z: 0 }, 4)],
    placedSpells: [columnSpell('water', 'falling-water', { origin: { x: 0, y: 2, z: 0 } })],
  });
  falling.step(MAIN_WORLD_FIXED_DT);
  const snapshot = falling.getSnapshot();
  const fallingForce = snapshot.forceApplications.find((item) => item.bodyId === 'prop:falling');
  assert.ok(fallingForce);
  assert.equal(fallingForce.mode, 'water_column_continuation');
  assert.equal(fallingForce.magnitude, straightForce.magnitude);
  assert.equal(snapshot.fields[0].interception.segment, 'water_continuation');
  falling.dispose();
});

test('column interception applies physical force to the character', () => {
  const runtime = new MainWorldRapierRuntime(R, {
    playerState: { position: { x: 1, y: 0, z: 0 } },
    placedSpells: [columnSpell('wind', 'player-hit', { origin: { x: 0, y: MAIN_WORLD_PLAYER_CONFIG.height / 2, z: 0 } })],
  });
  runtime.step(MAIN_WORLD_FIXED_DT);
  const snapshot = runtime.getSnapshot();
  const hit = snapshot.forceApplications.find((item) => item.bodyId === 'player' && item.mode === 'column');
  assert.ok(hit);
  assert.ok(snapshot.player.fieldVelocity.x > 0);
  assert.equal(snapshot.fields[0].interception.bodyId, 'player');
  runtime.dispose();
});

test('passable column force ends at the visible flat tip', () => {
  const columnLength = 4.2;
  const playerCenterBeyondTip = columnLength + MAIN_WORLD_PLAYER_CONFIG.radius + 0.02;
  const runtime = new MainWorldRapierRuntime(R, {
    playerState: { position: { x: playerCenterBeyondTip, y: 0, z: 0 } },
    placedSpells: [columnSpell('wind', 'flat-tip-miss', {
      origin: { x: 0, y: MAIN_WORLD_PLAYER_CONFIG.height / 2, z: 0 },
    })],
  });
  runtime.step(MAIN_WORLD_FIXED_DT);
  const snapshot = runtime.getSnapshot();
  assert.equal(
    snapshot.forceApplications.some((item) => item.bodyId === 'player' && item.mode === 'column'),
    false,
  );
  assert.equal(snapshot.fields[0].interception, null);
  runtime.dispose();
});

test('active Earth output owns a persistent solid collider and weak Earth dispersion applies force', () => {
  const earthColumn = new MainWorldRapierRuntime(R, {
    placedSpells: [columnSpell('earth', 'solid-column', { origin: { x: 0, y: 4, z: 0 } })],
  });
  earthColumn.step(MAIN_WORLD_FIXED_DT);
  assert.ok(Object.values(earthColumn.getSnapshot().bodies).some((body) => body.role === 'earth_spell_column'));
  earthColumn.dispose();

  const runtimeResult = compileDispersionRuntime('earth');
  const runtime = new MainWorldRapierRuntime(R, {
    props: [looseProp('earth-dispersion-target', { x: 1, y: -0.03, z: 0 }, 2)],
    placedSpells: [{
      id: 'spell:earth-dispersion',
      activationInstanceId: 1,
      anchor: { surfaceKind: 'world', surfaceId: 'practice-field-terrain' },
      runtimeResult,
    }],
  });
  runtime.step(MAIN_WORLD_FIXED_DT);
  const application = runtime.getSnapshot().forceApplications.find(
    (item) => item.bodyId === 'prop:earth-dispersion-target' && item.mode === 'dispersion',
  );
  assert.ok(application);
  assert.ok(application.magnitude > 0 && application.magnitude <= FORCE_CONTRACT.dispersion.earth.cap);
  runtime.dispose();
});

test('Earth leading-face sampling carries centered loads in the emergence direction', () => {
  const sweep = earthEmergenceSweep({
    origin: { x: 0, y: 0, z: 0 },
    direction: { x: 0, y: 1, z: 0 },
    length: 4,
    radius: 0.84,
  }, 0, 0.01);
  const sample = sampleEarthSweep(sweep, { x: 0, y: 0.25, z: 0 }, 0.39);
  assert.equal(sample.contactType, 'leading_face');
  assert.deepEqual(sample.direction, { x: 0, y: 1, z: 0 });
  assert.equal(sample.carryDistance, sweep.length);
});

test('Earth emergence carries a loose shape on its leading face without replacing its collider or water-style launch', () => {
  const length = 2.4;
  const runtime = new MainWorldRapierRuntime(R, {
    props: [looseProp('earth-payload', { x: 0, y: 0, z: 0 }, 3)],
    placedSpells: [columnSpell('earth', 'payload-lift', {
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 0, y: 1, z: 0 },
      length,
      radius: 0.84,
      forceMagnitude: 60,
    })],
  });
  runtime.step(MAIN_WORLD_FIXED_DT);
  const columnRecord = [...runtime.earthColumnBodies.values()][0];
  const colliderHandle = columnRecord.collider.handle;
  const steps = Math.ceil(length / (EARTH_EMERGENCE_SPEED * MAIN_WORLD_FIXED_DT)) + 8;
  for (let index = 1; index < steps; index += 1) runtime.step(MAIN_WORLD_FIXED_DT);
  const snapshot = runtime.getSnapshot();
  const payload = snapshot.bodies['prop:earth-payload'];
  assert.equal([...runtime.earthColumnBodies.values()][0].collider.handle, colliderHandle);
  assert.equal(snapshot.blockedSignals.length, 0);
  assert.ok(
    payload.position.y >= length + 0.2,
    `payload should finish on top of the ${length}m pillar; got y=${payload.position.y}`,
  );
  assert.ok(
    payload.linearVelocity.y <= EARTH_EMERGENCE_SPEED + 0.25,
    `payload should retain at most a slight ${EARTH_EMERGENCE_SPEED}m/s hop; got vy=${payload.linearVelocity.y}`,
  );
  runtime.dispose();
});

test('Earth emergence displaces an anchored Asset Manager shape without making it a launch projectile', () => {
  const runtime = new MainWorldRapierRuntime(R, {
    placedAssets: [{
      id: 'placed-asset:earth-shape',
      assetDefinitionId: 'shape:cuboid',
      category: 'Shapes',
      name: 'Block',
      affectedByGravity: false,
      anchor: { point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } },
      transform: {
        position: { x: 0, y: 0.29, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
    }],
    placedSpells: [columnSpell('earth', 'anchored-shape-lift', {
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 0, y: 1, z: 0 },
      length: 2.4,
      radius: 0.84,
      forceMagnitude: 60,
    })],
  });
  runtime.step(MAIN_WORLD_FIXED_DT);
  const assetRecord = runtime.bodies.get('placed-asset:placed-asset:earth-shape');
  const colliderHandle = assetRecord.colliders[0].handle;
  const steps = Math.ceil(2.4 / (EARTH_EMERGENCE_SPEED * MAIN_WORLD_FIXED_DT)) + 8;
  let sawSolidSurfaceTranslation = false;
  for (let index = 1; index < steps; index += 1) {
    runtime.step(MAIN_WORLD_FIXED_DT);
    sawSolidSurfaceTranslation ||= runtime.getSnapshot().forceApplications
      .some((item) => item.transport === 'solid_surface_translation');
  }
  const snapshot = runtime.getSnapshot();
  const payload = snapshot.bodies['placed-asset:placed-asset:earth-shape'];
  assert.equal(assetRecord.colliders[0].handle, colliderHandle);
  assert.equal(payload.bodyMode, 'fixed');
  assert.equal(payload.earthCarried, true);
  assert.ok(payload.position.y >= 2.4 + 0.29 - 0.05, `anchored shape should ride the solid front; got y=${payload.position.y}`);
  assert.equal(sawSolidSurfaceTranslation, true);
  assert.equal(snapshot.blockedSignals.length, 0);
  runtime.dispose();
});

test('a sufficiently large Earth column carries the player above its solid front instead of engulfing them', () => {
  const length = 2.4;
  const runtime = new MainWorldRapierRuntime(R, {
    playerState: { position: { x: 0, y: 0, z: 0 } },
    placedSpells: [columnSpell('earth', 'large-player-lift', {
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 0, y: 1, z: 0 },
      length,
      radius: 1.2,
      forceMagnitude: 60,
      })],
  });
  const steps = Math.ceil(length / (EARTH_EMERGENCE_SPEED * MAIN_WORLD_FIXED_DT)) + 3;
  for (let index = 0; index < steps; index += 1) runtime.step(MAIN_WORLD_FIXED_DT);
  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.blockedSignals.length, 0);
  assert.ok(
    snapshot.player.position.y >= length - 0.03,
    `player feet must remain above the ${length}m pillar instead of inside it; got y=${snapshot.player.position.y}`,
  );
  assert.ok(snapshot.player.fieldVelocity.y <= 0.05, 'Earth carry must not become stored launch velocity');
  runtime.dispose();
});

test('an undersized Earth column still shatters when the standing player exceeds its push capacity', () => {
  const signals = [];
  const runtime = new MainWorldRapierRuntime(R, {
    playerState: { position: { x: 0, y: 0, z: 0 } },
    placedSpells: [columnSpell('earth', 'small-player-load', {
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 0, y: 1, z: 0 },
      radius: 0.58,
      forceMagnitude: 16,
    })],
    onEarthBlocked: (_placedSpellId, signal) => signals.push(signal),
  });
  runtime.step(MAIN_WORLD_FIXED_DT);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].reason, 'earth_column_resistance_exceeded');
  assert.equal(runtime.earthColumnBodies.size, 0);
  runtime.dispose();
});

test('a completed Earth column is a solid wall for the character controller', () => {
  const runtime = new MainWorldRapierRuntime(R, {
    playerState: { position: { x: -1, y: 0, z: 0 } },
    placedSpells: [columnSpell('earth', 'player-wall', {
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 0, y: 1, z: 0 },
    })],
  });
  for (let index = 0; index < 40; index += 1) runtime.step(MAIN_WORLD_FIXED_DT);
  for (let index = 0; index < 20; index += 1) {
    runtime.setPlayerRequest({ x: 0.06, y: 0, z: 0 }, 'input');
    runtime.step(MAIN_WORLD_FIXED_DT);
  }
  const player = runtime.getSnapshot().player;
  const contactEnvelope = 0.58 + MAIN_WORLD_PLAYER_CONFIG.radius + MAIN_WORLD_PLAYER_CONFIG.offset;
  assert.ok(
    Math.abs(player.position.x + contactEnvelope) < 0.005,
    `solid Earth column should stop the character at its collider envelope; got x=${player.position.x}`,
  );
  runtime.dispose();
});

test('source vessels stay fixed and solid without cancelling a nearby Earth emergence', () => {
  const signals = [];
  const runtime = new MainWorldRapierRuntime(R, {
    sources: [{
      id: 'water-basin',
      kind: 'water',
      position: { x: 0, y: 0, z: 0.9 },
    }],
    placedSpells: [columnSpell('earth', 'earth-near-source', {
      origin: { x: 0, y: 0.25, z: 0 },
    })],
    onEarthBlocked: (placedSpellId, signal) => signals.push({ placedSpellId, signal }),
  });
  runtime.step(MAIN_WORLD_FIXED_DT);
  runtime.step(MAIN_WORLD_FIXED_DT);
  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.bodies['source:water-basin'].bodyMode, 'fixed');
  assert.equal(snapshot.bodies['source:water-basin'].role, 'source_vessel');
  assert.equal(snapshot.fields[0].active, true);
  assert.deepEqual(signals, []);
  runtime.dispose();
});

test('mounted field frame follows its dynamic Rapier mount and Pull intents are rejected', () => {
  const pullSpell = {
    id: 'spell:pull',
    activationInstanceId: 1,
    runtimeResult: {
      lifecycle: { active: true },
      intents: [{ id: 'pull', intentType: 'physics_motion', active: true }],
    },
  };
  const built = buildMainWorldSpellFields([pullSpell]);
  assert.equal(built.fields.length, 0);
  assert.equal(built.rejected[0].reason, 'pull_out_of_scope');

  const runtime = new MainWorldRapierRuntime(R, {
    props: [looseProp('mount', { x: 0, y: 2, z: 0 }, 2)],
    placedSpells: [columnSpell('wind', 'mounted', {
      anchor: { surfaceKind: 'prop', surfaceTargetId: 'mount' },
      origin: { x: 0, y: 2.25, z: 0 },
    })],
  });
  for (let index = 0; index < 4; index += 1) runtime.step(MAIN_WORLD_FIXED_DT);
  const delta = runtime.mountedTransformForSpell('spell:mounted');
  assert.ok(delta);
  assert.ok(delta.translation.y < 0);
  runtime.dispose();
});

test('main-world blueprint adapter keeps one Rapier owner and repeated load/unload is count-stable', () => {
  const source = readFileSync(new URL('../src/world-physics/MainWorldRapierRuntime.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /new\s+RapierMechanicsWorld/);
  const runtime = new MainWorldRapierRuntime(R);
  const baseCount = runtime.getSnapshot().bodyCount;
  const blueprint = { blueprintId: 'saved:catapult', document: createCatapultDocument() };
  for (let index = 0; index < 3; index += 1) {
    runtime.syncBlueprint(blueprint);
    const loaded = runtime.getSnapshot();
    assert.equal(loaded.blueprint.bodyCount, blueprint.document.assemblies.length);
    assert.equal(loaded.bodyCount, baseCount + blueprint.document.assemblies.length);
    runtime.syncBlueprint(null);
    assert.equal(runtime.getSnapshot().bodyCount, baseCount);
    assert.equal(runtime.getSnapshot().blueprint, null);
  }
  runtime.dispose();
});

test('placed mechanics preserve the workshop document contract instead of flattening assemblies', () => {
  const placementId = 'placed-mechanics:pressure-contract';
  const prefix = `${placementId}::`;
  const runtime = new MainWorldRapierRuntime(R, {
    placedMechanicsBuilds: [{
      id: placementId,
      name: 'Placed pressure plate',
      document: createPressurePlateDocument(),
      transform: {
        position: { x: 6, y: 0, z: 2 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
    }],
  });

  let snapshot = runtime.getSnapshot();
  const frameId = `blueprint:placed-mechanics:${prefix}assembly:pressure-frame`;
  const plateId = `blueprint:placed-mechanics:${prefix}assembly:pressure-plate`;
  assert.equal(snapshot.blueprint.bodyCount, 3, 'all saved assemblies become live bodies');
  assert.equal(snapshot.blueprint.jointCount, 2, 'the slider and linear return spring both survive placement');
  assert.equal(snapshot.blueprint.spellDevices[0].active, false, 'the raised plate leaves its saved gate open');
  assert.ok(Math.abs(snapshot.bodies[frameId].position.x - 6) < 1e-6);
  assert.ok(Math.abs(snapshot.bodies[plateId].position.x - snapshot.bodies[frameId].position.x) < 1e-6);

  for (let step = 0; step < 600 && !snapshot.blueprint.gates[`${prefix}gate:pressure-light`].closed; step += 1) {
    snapshot = runtime.step(MAIN_WORLD_FIXED_DT);
  }
  assert.equal(snapshot.blueprint.sensors[`${prefix}sensor:pressure-contact`].active, true);
  assert.equal(snapshot.blueprint.gates[`${prefix}gate:pressure-light`].closed, true);
  assert.equal(snapshot.blueprint.spellDevices[0].active, true, 'the live saved gate completes the mounted spell');
  assert.ok(
    Math.abs(snapshot.bodies[plateId].position.x - snapshot.bodies[frameId].position.x) < 0.001,
    'the constrained plate stays aligned with its placed frame',
  );
  runtime.dispose();
});

test('main-world blueprints preserve constraints authored against the world', () => {
  const document = createMechanicsDocument({
    assemblies: [
      createAssembly({
        assemblyId: 'assembly:world-hinged',
        transform: { position: { x: 0, y: 4, z: 0 } },
      }),
    ],
    constraints: [
      createConstraint({
        constraintId: 'constraint:world-hinge',
        assemblyAId: 'assembly:world-hinged',
        assemblyBId: null,
      }),
    ],
  });
  const runtime = new MainWorldRapierRuntime(R, {
    blueprint: { blueprintId: 'world-anchor', document },
  });
  const bodyId = 'blueprint:world-anchor:assembly:world-hinged';
  const initialY = runtime.getSnapshot().bodies[bodyId].position.y;

  for (let index = 0; index < 30; index += 1) runtime.step(MAIN_WORLD_FIXED_DT);
  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.blueprint.jointCount, 1);
  assert.ok(snapshot.blueprint.constraints['constraint:world-hinge']);
  assert.ok(Math.abs(snapshot.bodies[bodyId].position.y - initialY) < 0.01);
  assert.equal(runtime.blueprintAuxiliaryBodies.size, 1);
  runtime.syncBlueprint(null);
  assert.equal(runtime.blueprintAuxiliaryBodies.size, 0);
  assert.equal(runtime.getSnapshot().blueprint, null);
  runtime.dispose();
});

test('main-world latches solve authored contacts and sensors detect the player', () => {
  const runtime = new MainWorldRapierRuntime(R);
  const playerPosition = runtime.getSnapshot().player.bodyPosition;
  const document = createMechanicsDocument({
    assemblies: [
      createAssembly({ assemblyId: 'assembly:fixed', bodyMode: 'fixed', transform: { position: { x: 20, y: 3, z: 0 } } }),
      createAssembly({ assemblyId: 'assembly:moving', transform: { position: { x: 20, y: 3, z: 0 } } }),
    ],
    latches: [createLatch({
      latchId: 'latch:contacts',
      assemblyAId: 'assembly:moving',
      assemblyBId: 'assembly:fixed',
      localAnchorA: { x: 1, y: 0, z: 0 },
      localAnchorB: { x: -1, y: 0, z: 0 },
    })],
    sensors: [createSensor({
      sensorId: 'sensor:player',
      triggerPolicy: 'held',
      acceptedTags: ['player'],
      size: { x: 2, y: 2, z: 2 },
      localTransform: { position: playerPosition },
    })],
  });
  runtime.syncBlueprint({ blueprintId: 'contacts-and-player', document });
  let snapshot = runtime.getSnapshot();
  for (let index = 0; index < 60; index += 1) snapshot = runtime.step(MAIN_WORLD_FIXED_DT);
  const movingId = 'blueprint:contacts-and-player:assembly:moving';
  assert.ok(snapshot.bodies[movingId].position.x < 18.2);
  assert.deepEqual(snapshot.blueprint.sensors['sensor:player'].touching, ['player']);
  assert.ok(snapshot.blueprint.triggerEvents.some((event) => event.event === 'held' && event.assemblyId === 'player'));
  runtime.dispose();
});

test('main-world torsion uses hinge-relative angle under rotated placement', () => {
  const worldRotation = quaternionFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
  const document = createMechanicsDocument({
    assemblies: [
      createAssembly({
        assemblyId: 'assembly:frame',
        bodyMode: 'fixed',
        transform: { position: { x: 0, y: 5, z: 0 }, rotation: worldRotation },
      }),
      createAssembly({
        assemblyId: 'assembly:arm',
        transform: { position: { x: 0, y: 5, z: 0 }, rotation: worldRotation },
        parts: [
          createPrimitivePart({
            partId: 'part:arm',
            size: { x: 2, y: 0.2, z: 0.2 },
          }),
        ],
      }),
    ],
    constraints: [
      createConstraint({
        constraintId: 'constraint:hinge',
        assemblyAId: 'assembly:frame',
        assemblyBId: 'assembly:arm',
        localAxisA: { x: 0, y: 1, z: 0 },
      }),
    ],
    forceElements: [
      createForceElement({
        forceElementId: 'spring:torsion',
        type: 'torsion_spring',
        assemblyAId: 'assembly:frame',
        assemblyBId: 'assembly:arm',
        constraintId: 'constraint:hinge',
        restAngle: 0,
        stiffness: 80,
        damping: 0,
        maxImpulse: 100,
      }),
    ],
  });
  const runtime = new MainWorldRapierRuntime(R, {
    blueprint: { blueprintId: 'rotated-torsion', document },
  });
  runtime.step(MAIN_WORLD_FIXED_DT);
  const snapshot = runtime.getSnapshot();
  const arm = snapshot.bodies['blueprint:rotated-torsion:assembly:arm'];

  assert.ok(Math.abs(snapshot.blueprint.constraints['constraint:hinge'].angleRadians) < 0.01);
  assert.ok(Math.hypot(arm.angularVelocity.x, arm.angularVelocity.y, arm.angularVelocity.z) < 0.01);
  runtime.dispose();
});

test('gravity-affected mechanics release their fixed anchors without losing the assembly contract', () => {
  const placementId = 'placed-mechanics:released-pressure';
  const placement = {
    id: placementId,
    document: createPressurePlateDocument(),
    transform: {
      position: { x: 0, y: 4, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    },
  };
  const runtime = new MainWorldRapierRuntime(R, {
    placedMechanicsBuilds: [placement],
  });
  const anchoredBodies = Object.values(runtime.getSnapshot().bodies).filter(
    (body) => body.placementKind === 'mechanics-build' && body.placementId === placementId,
  );
  assert.ok(anchoredBodies.some((body) => body.bodyMode === 'fixed'));
  runtime.syncBlueprints([{ ...placement, affectedByGravity: true }]);
  const initial = runtime.getSnapshot();
  const releasedBodies = Object.values(initial.bodies).filter(
    (body) => body.placementKind === 'mechanics-build' && body.placementId === placementId,
  );
  assert.equal(releasedBodies.length, createPressurePlateDocument().assemblies.length);
  assert.ok(releasedBodies.every((body) => body.bodyMode === 'dynamic'));
  assert.equal(initial.blueprint.jointCount, 2, 'saved joints remain live after fixed anchors are released');
  const startingMinimumY = Math.min(...releasedBodies.map((body) => body.position.y));
  for (let index = 0; index < 30; index += 1) runtime.step(MAIN_WORLD_FIXED_DT);
  const fallenBodies = Object.values(runtime.getSnapshot().bodies).filter(
    (body) => body.placementKind === 'mechanics-build' && body.placementId === placementId,
  );
  assert.ok(Math.min(...fallenBodies.map((body) => body.position.y)) < startingMinimumY - 0.2);
  runtime.syncBlueprints([placement]);
  const reanchoredBodies = Object.values(runtime.getSnapshot().bodies).filter(
    (body) => body.placementKind === 'mechanics-build' && body.placementId === placementId,
  );
  assert.ok(reanchoredBodies.some((body) => body.bodyMode === 'fixed'));
  runtime.dispose();
});

test('player weight continuously depresses and rides a placed pressure mechanism while preserving real spell intents', () => {
  const document = createPressurePlateDocument();
  document.assemblies = document.assemblies.filter(
    (assembly) => assembly.assemblyId !== 'assembly:pressure-load',
  );
  const placementId = 'placed-mechanics:player-pressure';
  const plateBodyId = `blueprint:placed-mechanics:${placementId}::assembly:pressure-plate`;
  const runtime = new MainWorldRapierRuntime(R, {
    playerState: { position: { x: 0, y: 1.51, z: 0 } },
    placedMechanicsBuilds: [{ id: placementId, document, transform: {} }],
  });
  const initial = runtime.getSnapshot();
  const initialPlayerY = initial.player.position.y;
  const initialPlateY = initial.bodies[plateBodyId].position.y;
  let snapshot = initial;
  for (let step = 0; step < 90; step += 1) snapshot = runtime.step(MAIN_WORLD_FIXED_DT);

  const playerTravel = initialPlayerY - snapshot.player.position.y;
  const plateTravel = initialPlateY - snapshot.bodies[plateBodyId].position.y;
  assert.equal(snapshot.player.config.mass, 48, 'the agreed player mass is unchanged');
  assert.equal(snapshot.player.supportBodyId, plateBodyId);
  assert.ok(plateTravel > 0.25, `the continuous player load should depress the plate; got ${plateTravel}`);
  assert.ok(
    Math.abs(playerTravel - plateTravel) < 0.03,
    `player/camera anchor must ride the plate: player=${playerTravel}, plate=${plateTravel}`,
  );

  const device = snapshot.blueprint.spellDevices.find(
    (item) => item.deviceId === `${placementId}::spell-device:pressure-light`,
  );
  assert.equal(device.active, true);
  assert.ok(device.outputIntents.some((intent) => intent.intentType === 'material_column'));
  const illumination = device.outputIntents.find((intent) => intent.intentType === 'illumination');
  assert.ok(illumination?.intensity > 0, 'the real Light illumination intent reaches the main renderer');
  assert.ok(illumination?.emitterOrigin, 'mounted Light keeps its live world-space emitter');
  runtime.dispose();
});

test('placement scale applies to generic linear joint travel instead of ejecting connected assemblies', () => {
  const document = createMechanicsDocument({
    metadata: { name: 'Generic sliding carriage' },
    assemblies: [
      createAssembly({
        assemblyId: 'assembly:rail',
        bodyMode: 'fixed',
        transform: { position: { x: 0, y: 4, z: 0 } },
        parts: [createPrimitivePart({
          partId: 'part:rail',
          size: { x: 1, y: 1, z: 1 },
          materialId: 'material.wood_heavy',
        })],
      }),
      createAssembly({
        assemblyId: 'assembly:carriage',
        transform: { position: { x: 2.5, y: 4, z: 0 } },
        parts: [createPrimitivePart({
          partId: 'part:carriage',
          size: { x: 1, y: 1, z: 1 },
          materialId: 'material.wood_heavy',
        })],
      }),
    ],
    constraints: [createConstraint({
      constraintId: 'constraint:travel',
      type: 'prismatic',
      assemblyAId: 'assembly:rail',
      assemblyBId: 'assembly:carriage',
      localAxisA: { x: 1, y: 0, z: 0 },
      limits: { enabled: true, min: 2, max: 3 },
    })],
  });

  for (const scale of [0.25, 0.5, 1.5]) {
    const placementId = `placed-mechanics:generic-scale-${scale}`;
    const prefix = `${placementId}::`;
    const runtime = new MainWorldRapierRuntime(R, {
      placedMechanicsBuilds: [{
        id: placementId,
        document,
        transform: { scale: { x: scale, y: scale, z: scale } },
      }],
    });
    for (let step = 0; step < 60; step += 1) runtime.step(MAIN_WORLD_FIXED_DT);
    const snapshot = runtime.getSnapshot();
    const rail = snapshot.bodies[`blueprint:placed-mechanics:${prefix}assembly:rail`];
    const carriage = snapshot.bodies[`blueprint:placed-mechanics:${prefix}assembly:carriage`];
    const authoredTravel = (carriage.position.x - rail.position.x) / scale;
    assert.ok(authoredTravel >= 2 - 0.002 && authoredTravel <= 3 + 0.002, `${scale}x preserves the authored travel window`);
    runtime.dispose();
  }
});

test('scaled pressure builds retain their assembled profile and load response', () => {
  for (const scale of [0.25, 0.5, 1.5]) {
    const placementId = `placed-mechanics:scaled-response-${scale}`;
    const prefix = `${placementId}::`;
    const runtime = new MainWorldRapierRuntime(R, {
      placedMechanicsBuilds: [{
        id: placementId,
        document: createPressurePlateDocument(),
        transform: { scale: { x: scale, y: scale, z: scale } },
      }],
    });
    let snapshot = runtime.getSnapshot();
    for (let step = 0; step < 600; step += 1) snapshot = runtime.step(MAIN_WORLD_FIXED_DT);
    const frame = snapshot.bodies[`blueprint:placed-mechanics:${prefix}assembly:pressure-frame`];
    const plate = snapshot.bodies[`blueprint:placed-mechanics:${prefix}assembly:pressure-plate`];
    const authoredGap = (plate.position.y - frame.position.y) / scale;
    assert.ok(authoredGap >= 0.58 - 0.01 && authoredGap <= 0.88 + 0.01, `${scale}x keeps the plate inside its workshop rail`);
    assert.equal(snapshot.blueprint.sensors[`${prefix}sensor:pressure-contact`].active, true, `${scale}x load remains on its sensor`);
    assert.equal(snapshot.blueprint.spellDevices[0].active, true, `${scale}x load still completes the mounted spell gate`);
    runtime.dispose();
  }
});

test('loaded catapult projectile settles then wakes from the main-world physicsField, while continuous drive persists', () => {
  const source = readFileSync(new URL('../src/world-physics/MainWorldRapierRuntime.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:elapsedSeconds|stepCount)\b[^\n]*\.sleep\s*\(/);
  const runtime = new MainWorldRapierRuntime(R);
  runtime.syncBlueprint({ blueprintId: 'saved:catapult', document: createCatapultDocument() });
  const stoneId = 'blueprint:saved:catapult:assembly:catapult-stone';
  for (let index = 0; index < 7200; index += 1) runtime.step(MAIN_WORLD_FIXED_DT);
  const settledStone = runtime.getSnapshot().bodies[stoneId];
  assert.equal(settledStone.sleeping, true);
  runtime.syncSpells([columnSpell('wind', 'wake-catapult', { origin: settledStone.position })]);
  runtime.step(MAIN_WORLD_FIXED_DT);
  assert.equal(runtime.getSnapshot().bodies[stoneId].sleeping, false);

  // Passing the former ten-second threshold cannot freeze a projectile that
  // is genuinely in flight; only Rapier's native near-rest sleep may settle it.
  runtime.syncSpells([]);
  const stone = runtime.bodies.get(stoneId).body;
  stone.setLinvel({ x: 4, y: 3, z: 0 }, true);
  runtime.step(MAIN_WORLD_FIXED_DT);
  const inFlightStone = runtime.getSnapshot().bodies[stoneId];
  assert.ok(inFlightStone.linearVelocity.x > 0.5, 'projectile retains measurable in-flight velocity after ten seconds');
  assert.equal(inFlightStone.sleeping, false, 'elapsed time alone does not freeze a moving projectile');

  runtime.syncBlueprint({ blueprintId: 'saved:continuous', document: createCamWatererDocument() });
  assert.ok(runtime.getSnapshot().blueprint.deviceFieldCount > 0, 'saved spell devices compile into main-world physics fields');
  for (let index = 0; index < 240; index += 1) runtime.step(MAIN_WORLD_FIXED_DT);
  const shaft = runtime.getSnapshot().bodies['blueprint:saved:continuous:assembly:camshaft'];
  assert.ok(Math.abs(shaft.angularVelocity.y) > 0.02 || Math.abs(shaft.angularVelocity.x) > 0.02);
  runtime.dispose();
});

function looseProp(id, position, mass) {
  return {
    id,
    label: id,
    visualKind: 'prop',
    position,
    size: 1,
    mass,
    movable: true,
    bodyMode: 'dynamic',
  };
}

function columnSpell(materialKind, suffix = materialKind, options = {}) {
  const id = `spell:${suffix}`;
  const origin = options.origin ?? { x: 0, y: 0.25, z: 0 };
  const direction = options.direction ?? { x: 1, y: 0, z: 0 };
  return {
    id,
    activationInstanceId: 1,
    anchor: options.anchor ?? { surfaceKind: 'world', surfaceId: 'practice-field-terrain' },
    runtimeResult: {
      lifecycle: { active: true },
      intents: [{
        id: `intent:${suffix}`,
        intentType: materialKind === 'water' ? 'water_column' : 'material_column',
        materialKind,
        active: true,
        origin,
        sceneAxis: direction,
        signSizeAverage: 200,
        thicknessRingRadius: 100,
        placementFrame: {
          normal: { x: 0, y: 1, z: 0 },
          tangent: { x: 1, y: 0, z: 0 },
          bitangent: { x: 0, y: 0, z: 1 },
        },
        physicsField: {
          active: true,
          fieldShape: materialKind === 'earth' ? 'earth_emergence' : 'column',
          origin,
          direction,
          length: options.length ?? 4.2,
          radius: options.radius ?? 0.58,
          forceMagnitude: options.forceMagnitude ?? {
            water: 20,
            fire: 12,
            wind: 15.6,
            earth: 16,
            light: 0,
          }[materialKind],
          continuation: materialKind === 'water'
            ? {
                mode: 'ballistic_taper',
                exitSpeed: 3.2,
                gravity: { x: 0, y: -5.88, z: 0 },
                groundY: 0,
                maxAge: 8,
                sampleStep: 0.035,
                radiusScaleAtEnd: 0.5,
              }
            : null,
          falloff: 'linear_radial_and_axial',
        },
      }],
    },
  };
}

function compileColumnRuntime(materialKind) {
  return compileMaterialRuntime(materialKind, 'column');
}

function compileDispersionRuntime(materialKind, placementFrame = null) {
  return compileMaterialRuntime(materialKind, 'dispersion', placementFrame);
}

function compileLevitationRuntime(materialKind, launch = false, placementFrame = null) {
  const compiled = compileSpell({
    title: `${materialKind} levitation main-world contract`,
    seals: [{
      sigils: [{ name: materialKind }],
      rings: [{ radius: 100 }],
      signProfiles: launch
        ? [
            { kind: 'levitation', amount: 1, radius: 60, angle: 180, size: 300 },
            { kind: 'levitation', amount: 1, radius: 60, angle: 90, size: 120 },
          ]
        : [{ kind: 'levitation', amount: 2, radius: 50, angle: 180, size: 240 }],
    }],
  });
  return interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
    options: placementFrame ? { placementFrame } : {},
  });
}

function compileMaterialRuntime(materialKind, signKind, placementFrame = null) {
  const compiled = compileSpell({
    title: `${materialKind} ${signKind} main-world contract`,
    seals: [{
      sigils: [{ name: materialKind }],
      rings: [{ radius: 100 }],
      signProfiles: [{ kind: signKind, amount: 4, size: 200, radius: 80, angle: 0 }],
    }],
  });
  return interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
    options: placementFrame ? { placementFrame } : {},
  });
}

test('player controller locks exact config and state-based demand stepping', () => {
  assert.deepEqual(MAIN_WORLD_PLAYER_CONFIG, {
    height: 1.575, radius: 0.28, capsuleHalfHeight: 0.5075, offset: 0.02, mass: 48,
    autostepMaxHeight: 0.22, autostepMinWidth: 0.25, autostepIncludesDynamicBodies: false,
    snapToGroundDistance: 0.18, maxSlopeClimbAngle: (50 * Math.PI) / 180,
    minSlopeSlideAngle: (55 * Math.PI) / 180, slide: true, applyImpulsesToDynamicBodies: true,
  });
  const runtime = new MainWorldRapierRuntime(R, { playerState: { position: { x: 0, y: 0, z: 0 } } });
  for (const record of runtime.bodies.values()) if (record.body.isDynamic()) record.body.sleep();
  assert.equal(runtime.hasPlayerRequest(), true);
  runtime.step(MAIN_WORLD_FIXED_DT);
  const first = runtime.getSnapshot();
  assert.equal(first.player.grounded, true);
  for (const record of runtime.bodies.values()) if (record.body.isDynamic()) record.body.sleep();
  const stepCount = first.stepCount;
  runtime.step(MAIN_WORLD_FIXED_DT);
  assert.equal(runtime.hasPlayerRequest(), false);
  assert.ok(runtime.getSnapshot().stepCount >= stepCount, 'stepping is demand-driven by live state');
  runtime.dispose();
});

test('player walks over the atelier entrance tablets but taller ledges remain jump-gated', () => {
  const runtime = new MainWorldRapierRuntime(R);
  const facing = ATELIER_PLAYTHROUGH.spawn.facing;
  const walkRequest = {
    x: Math.sin(facing) * 2.7 * MAIN_WORLD_FIXED_DT,
    y: 0,
    z: Math.cos(facing) * 2.7 * MAIN_WORLD_FIXED_DT,
  };

  for (let index = 0; index < 70; index += 1) {
    runtime.setPlayerRequest(walkRequest, 'input');
    runtime.step(MAIN_WORLD_FIXED_DT);
  }

  const inside = runtime.getSnapshot().player;
  assert.ok(
    inside.position.y >= 0.34,
    `entrance tablets should lift the player onto the 0.36 m atelier floor; got ${inside.position.y}`,
  );
  assert.ok(
    Math.hypot(
      inside.position.x - ATELIER_PLAYTHROUGH.spawn.world.x,
      inside.position.z - ATELIER_PLAYTHROUGH.spawn.world.z,
    ) > 2.5,
    'shallow entrance steps must not stop forward travel',
  );
  runtime.dispose();

  const ledgeRuntime = new MainWorldRapierRuntime(R, {
    playerState: { position: { x: 0, y: 0, z: 0 } },
  });
  const ledgeBody = ledgeRuntime.world.createRigidBody(
    R.RigidBodyDesc.fixed().setTranslation(0.8, 0.25, 0),
  );
  ledgeRuntime.world.createCollider(
    R.ColliderDesc.cuboid(0.2, 0.25, 1),
    ledgeBody,
  );
  ledgeRuntime._refreshSceneQueries();
  for (let index = 0; index < 30; index += 1) {
    ledgeRuntime.setPlayerRequest({ x: 2.7 * MAIN_WORLD_FIXED_DT, y: 0, z: 0 }, 'input');
    ledgeRuntime.step(MAIN_WORLD_FIXED_DT);
  }
  const blocked = ledgeRuntime.getSnapshot().player;
  assert.ok(blocked.position.x < 0.35, `0.50 m ledge should still require a jump; got x=${blocked.position.x}`);
  assert.ok(blocked.position.y < 0.05, `blocked player should remain on terrain; got y=${blocked.position.y}`);
  ledgeRuntime.dispose();
});

test('Atelier collider coverage is compound and doorway gap remains open', () => {
  const house = MAIN_WORLD_BUILTIN_BODIES.find((body) => body.id === 'atelier-house');
  assert.equal(house.collider.shape, 'compound');
  const ids = house.collider.parts.map((part) => part.id);
  for (const id of ['foundation-front', 'floor', 'back-wall', 'left-wall', 'right-wall', 'front-left-wall', 'front-right-wall', 'front-door-header', 'roof-right', 'chimney', 'step-0', 'table-top', 'bookshelf-frame', 'stool-seat']) assert.ok(ids.includes(id), id);
  const left = house.collider.parts.find((part) => part.id === 'front-left-wall');
  const right = house.collider.parts.find((part) => part.id === 'front-right-wall');
  assert.ok(left.position.x + left.halfExtents.x < -0.3);
  assert.ok(right.position.x - right.halfExtents.x >= 0.4);
  const roofRight = house.collider.parts.find((part) => part.id === 'roof-right');
  const roofLeft = house.collider.parts.find((part) => part.id === 'roof-left');
  assert.equal(roofRight.rotationZ, -ATELIER_ROOF_LAYOUT.slopeAngle);
  assert.equal(roofLeft.rotationZ, ATELIER_ROOF_LAYOUT.slopeAngle);
  assert.equal(roofRight.position.y, ATELIER_ROOF_LAYOUT.panelCenterY);
  assert.equal(roofLeft.position.y, ATELIER_ROOF_LAYOUT.panelCenterY);
  const rooflineAtWall = ATELIER_ROOF_LAYOUT.ridgeY
    - Math.tan(ATELIER_ROOF_LAYOUT.slopeAngle) * 2.2;
  assert.ok(Math.abs(rooflineAtWall - ATELIER_ROOF_LAYOUT.wallTopY) < 1e-10);
  const runtime = new MainWorldRapierRuntime(R);
  assert.equal(runtime.bodies.get('atelier-house').body.numColliders(), house.collider.parts.length);
  runtime.dispose();
});

test('player collision evidence reports slide and impulse while fixed structure stays fixed', () => {
  const runtime = new MainWorldRapierRuntime(R, {
    playerState: { position: { x: 0, y: 0, z: 0 } },
    props: [{ id: 'push-cube', visualKind: 'practice_cube', position: { x: 0.65, y: 0, z: 0 }, size: 1, mass: 2, movable: true }],
  });
  const before = runtime.getSnapshot().bodies['prop:push-cube'].position.x;
  runtime.setPlayerRequest({ x: 1, y: 0, z: 0 });
  runtime.step(MAIN_WORLD_FIXED_DT);
  const snapshot = runtime.getSnapshot();
  assert.ok(snapshot.player.computedMovement.x > 0);
  assert.ok(snapshot.player.collisionRoles.includes('practice_cube'));
  assert.ok(snapshot.bodies['prop:push-cube'].position.x > before);
  assert.equal(snapshot.bodies['atelier-house'].bodyMode, 'fixed');
  assert.equal(snapshot.bodies['atelier-house'].linearVelocity.x, 0);
  runtime.step(MAIN_WORLD_FIXED_DT);
  assert.ok(
    runtime.getSnapshot().player.collisionRoles.includes('practice_cube'),
    'passive standing weight must not immediately erase meaningful collision evidence',
  );
  runtime.dispose();
});

test('player-pushed dynamic body stays bounded and settles on shared terrain under demand stepping', () => {
  const runtime = new MainWorldRapierRuntime(R, {
    playerState: { position: { x: 1.2, y: 0, z: -0.9 } },
    props: [{
      id: 'stability-cube',
      visualKind: 'practice_cube',
      position: { x: 2.1, y: 0.22, z: -0.9 },
      size: 1,
      mass: 2,
      movable: true,
      bodyMode: 'dynamic',
    }],
  });
  const before = runtime.getSnapshot();
  const fixedBefore = before.bodies['atelier-house'].position;
  runtime.setPlayerRequest({ x: 1.4, y: 0, z: 0 }, 'input');
  const pushed = runtime.step(MAIN_WORLD_FIXED_DT);
  const pushedCube = pushed.bodies['prop:stability-cube'];
  assert.ok(pushed.player.collisionRoles.includes('practice_cube'));
  assert.ok(pushedCube.position.x > before.bodies['prop:stability-cube'].position.x);
  assert.ok(Math.hypot(pushedCube.linearVelocity.x, pushedCube.linearVelocity.z) < 4, 'push transfer stays near the player-speed/mass limit');
  assert.equal(pushed.demand.playerRequest, false);
  assert.equal(pushed.demand.awakeDynamicBody, true);

  for (let index = 1; index < 180; index += 1) runtime.step(MAIN_WORLD_FIXED_DT);
  const settled = runtime.getSnapshot();
  const cube = settled.bodies['prop:stability-cube'];
  const speed = Math.hypot(cube.linearVelocity.x, cube.linearVelocity.y, cube.linearVelocity.z);
  const angularSpeed = Math.hypot(cube.angularVelocity.x, cube.angularVelocity.y, cube.angularVelocity.z);
  assert.ok(Math.abs(cube.position.x) <= MAIN_WORLD_TERRAIN_SIZE.x / 2);
  assert.ok(Math.abs(cube.position.z) <= MAIN_WORLD_TERRAIN_SIZE.z / 2);
  assert.ok(cube.position.y - 0.225 >= terrainHeightAt(cube.position.x, cube.position.z) - 0.05);
  assert.ok(speed < 0.01, `settled linear speed ${speed}`);
  assert.ok(angularSpeed < 0.01, `settled angular speed ${angularSpeed}`);
  assert.equal(cube.sleeping, true);
  assert.equal(settled.demand.awakeDynamicBody, false);
  assert.deepEqual(settled.bodies['atelier-house'].position, fixedBefore);
  assert.equal(settled.bodies['atelier-house'].linearVelocity.x, 0);
  runtime.dispose();
});

test('shared ground catches fast dynamic bodies beyond the visible practice yard', () => {
  const runtime = new MainWorldRapierRuntime(R, {
    props: [{
      id: 'returning-cube',
      visualKind: 'practice_cube',
      position: { x: MAIN_WORLD_TERRAIN_SIZE.x, y: 30, z: MAIN_WORLD_TERRAIN_SIZE.z },
      size: 1,
      mass: 2,
      movable: true,
      bodyMode: 'dynamic',
    }],
  });
  const body = runtime.bodies.get('prop:returning-cube').body;
  body.setLinvel({ x: 0, y: -40, z: 0 }, true);

  for (let index = 0; index < 240; index += 1) runtime.step(MAIN_WORLD_FIXED_DT);

  const cube = runtime.getSnapshot().bodies['prop:returning-cube'];
  assert.ok(cube.position.y >= 0.22, `cube crossed the ground plane at y=${cube.position.y}`);
  assert.ok(Math.abs(cube.linearVelocity.y) < 0.01);
  assert.equal(cube.sleeping, true);
  runtime.dispose();
});

test('dynamic asset placement loses rolling energy on the shared ground', () => {
  const runtime = new MainWorldRapierRuntime(R, {
    placedAssets: [{
      id: 'asset:sphere-damping',
      assetDefinitionId: 'shape:sphere',
      bodyMode: 'dynamic',
      movable: true,
      transform: { position: { x: 0, y: 0.35, z: 0 } },
    }],
  });
  const bodyId = 'placed-asset:asset:sphere-damping';
  const body = runtime.bodies.get(bodyId).body;
  body.applyImpulse({ x: 1, y: 0, z: 0 }, true);
  const initial = runtime.getSnapshot().bodies[bodyId];
  const initialSpeed = Math.hypot(initial.linearVelocity.x, initial.linearVelocity.z);

  for (let index = 0; index < 60; index += 1) runtime.step(MAIN_WORLD_FIXED_DT);

  const settled = runtime.getSnapshot().bodies[bodyId];
  const settledSpeed = Math.hypot(settled.linearVelocity.x, settled.linearVelocity.z);
  assert.ok(initialSpeed > 0.1);
  assert.ok(settledSpeed < initialSpeed * 0.1, `rolling speed should decay: ${settledSpeed}`);
  runtime.dispose();
});
