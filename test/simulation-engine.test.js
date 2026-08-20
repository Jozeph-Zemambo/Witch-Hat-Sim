import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compileSpell } from '../src/compiler/compile.js';
import {
  buildSpellDocument,
  createSpellMakerDraft,
  createSpellSignGroup,
} from '../src/spell-maker/authoring.js';
import {
  createDefaultSceneState,
  createSceneProp,
  createSceneSource,
  interpretCompiledSpell,
  DISPERSION_NOTE_CLEARANCE_FACTOR,
  NORMALIZED_PLACED_SPELL_NOTE_SIDE,
  NORMALIZED_SPELL_CIRCLE_RADIUS,
  placedSpellDispersionClearanceRadius,
} from '../src/simulation-engine/index.js';

test('placed spell dispersion clearance stays beyond the square note corners at every scale', () => {
  for (const worldScale of [0.2, 1, 4]) {
    const cornerRadius = (NORMALIZED_PLACED_SPELL_NOTE_SIDE * Math.SQRT2 * worldScale) / 2;
    const clearanceRadius = placedSpellDispersionClearanceRadius(worldScale);
    assert.equal(clearanceRadius, Number((cornerRadius * DISPERSION_NOTE_CLEARANCE_FACTOR).toFixed(4)));
    assert.ok(clearanceRadius > cornerRadius);
  }
});

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
);

function loadFixture(name) {
  return JSON.parse(readFileSync(path.join(fixturesDir, name), 'utf8'));
}

function compileFixture(name) {
  return compileSpell(loadFixture(name));
}

function interpretFixture(name, sceneState) {
  const compiled = compileFixture(name);
  return interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState,
  });
}

function interpretNativeColumn(groups, placementFrame) {
  const draft = createSpellMakerDraft();
  draft.name = 'Native column direction probe';
  draft.sigilId = 'sigil.water';
  draft.groups = groups;
  const compiled = compileSpell(buildSpellDocument(draft));
  return interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
    options: placementFrame ? { placementFrame } : {},
  }).intents.find((intent) => intent.intentType === 'water_column');
}

function intentsOf(result, type) {
  return result.intents.filter((intent) => intent.intentType === type);
}

function firstIntentIndex(result, type) {
  return result.intents.findIndex((intent) => intent.intentType === type);
}

function roundTo(value, precision = 6) {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

test('runtime rejects duplicate scene IDs before producing ambiguous intents', () => {
  const compiled = compileFixture('watershot-centered.json');
  const interpret = (sceneState) => interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState,
  });

  assert.throws(
    () => interpret({
      sources: [
        createSceneSource({ id: 'duplicate', kind: 'water' }),
        createSceneSource({ id: 'duplicate', kind: 'water' }),
      ],
      props: [],
    }),
    /Duplicate scene object ID "duplicate" in sources and sources/,
  );
  assert.throws(
    () => interpret({
      sources: [createSceneSource({ id: 'shared', kind: 'water' })],
      props: [createSceneProp({ id: 'shared' })],
    }),
    /Duplicate scene object ID "shared" in sources and props/,
  );
});

test('warning-scoped effects use the documented unconditional semantic animation policy', () => {
  const compiled = compileFixture('watershot-centered.json');
  const baseArgs = {
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
  };
  const normal = interpretCompiledSpell(baseArgs);
  const obsoleteToggle = interpretCompiledSpell({
    ...baseArgs,
    options: { animateWarningScoped: false },
  });
  assert.deepEqual(normal.policy, {
    warningScopedEffects: 'animate_when_semantics_satisfied',
  });
  assert.equal(intentsOf(normal, 'water_column')[0].active, true);
  assert.deepEqual(
    intentsOf(obsoleteToggle, 'water_column'),
    intentsOf(normal, 'water_column'),
  );
});

test('simulation engine maps Watershot graph/program to spell-origin water column intent', () => {
  const result = interpretFixture('watershot-centered.json', {
    sources: [
      createSceneSource({
        id: 'source:water:test',
        kind: 'water',
        amount: 80,
        capacity: 100,
      }),
    ],
    props: [],
  });

  const waterColumn = intentsOf(result, 'water_column')[0];
  assert.ok(waterColumn);
  assert.equal(waterColumn.active, true);
  assert.equal(waterColumn.centered, true);
  assert.equal(waterColumn.biased, false);
  assert.equal(typeof waterColumn.magnitude, 'number');
  assert.equal(waterColumn.sourceId, null);
  assert.equal(waterColumn.materialOrigin, 'sigil_generated');
  assert.equal(waterColumn.originPolicy, 'spell_placement_frame_or_region_anchor');
  assert.equal(waterColumn.sourceFreeOrigin, true);
  assert.deepEqual(waterColumn.origin, { x: 0, y: 0.22, z: 0 });
  assert.ok(waterColumn.sceneAxis.y > 0.9);

  const circle = intentsOf(result, 'spell_circle_render_data')[0];
  assert.ok(circle);
  assert.equal(circle.active, true);
  assert.equal(circle.seals.length, 1);
});

test('native Spell Maker columns preserve the compiled erected direction', () => {
  const balanced = interpretNativeColumn([
    createSpellSignGroup('group:balanced', { count: 4 }),
  ]);
  assert.deepEqual(balanced.localAxis, { x: 0, y: 0, z: 1 });
  assert.ok(balanced.sceneAxis.y > 0.999999);

  const single = interpretNativeColumn([
    createSpellSignGroup('group:single', {
      count: 1,
      positionsDeg: [0],
      facingsDeg: [0],
    }),
  ]);
  // Authoring 0° is the right edge of the ring, so its inward column points
  // along spell-local -X and must keep that direction after compilation.
  assert.ok(single.localAxis.x < -0.999999);
  assert.ok(single.localAxis.z > 0);
  assert.ok(single.localAxis.z < 0.00001);
  assert.ok(single.sceneAxis.x < -0.999999);

  const asymmetric = interpretNativeColumn([
    createSpellSignGroup('group:asymmetric', {
      count: 4,
      positionsDeg: [0, 90, 180, 225],
    }),
  ]);
  assert.ok(asymmetric.localAxis.x > 0);
  assert.ok(asymmetric.localAxis.y < 0);
  assert.ok(asymmetric.localAxis.z > 0);
});

test('native Spell Maker column direction retains lobe weights and group rotation', () => {
  const weighted = interpretNativeColumn([
    createSpellSignGroup('group:strong', {
      count: 1,
      size: 300,
      positionsDeg: [0],
    }),
    createSpellSignGroup('group:weak', {
      count: 1,
      size: 100,
      positionsDeg: [180],
    }),
  ]);
  assert.ok(weighted.localAxis.x < -0.999999);
  assert.ok(weighted.localAxis.z > 0);
  assert.equal(weighted.directionPolicy, 'weighted_inward_push_away_from_stronger_sign');

  const reversedWeight = interpretNativeColumn([
    createSpellSignGroup('group:weak', {
      count: 1,
      size: 100,
      positionsDeg: [0],
    }),
    createSpellSignGroup('group:strong', {
      count: 1,
      size: 300,
      positionsDeg: [180],
    }),
  ]);
  assert.ok(reversedWeight.localAxis.x > 0.999999);
  assert.ok(reversedWeight.localAxis.z > 0);

  const base = interpretNativeColumn([
    createSpellSignGroup('group:base', {
      count: 4,
      positionsDeg: [0, 90, 180, 225],
    }),
  ]);
  const rotated = interpretNativeColumn([
    createSpellSignGroup('group:rotated', {
      count: 4,
      rotationDeg: 90,
      positionsDeg: [0, 90, 180, 225],
    }),
  ]);
  assert.ok(Math.abs(rotated.localAxis.x + base.localAxis.y) < 0.000001);
  assert.ok(Math.abs(rotated.localAxis.y - base.localAxis.x) < 0.000001);
  assert.ok(Math.abs(rotated.localAxis.z - base.localAxis.z) < 0.000001);
});

test('every material column tilts away from the stronger sign', () => {
  for (const sigilId of ['sigil.water', 'sigil.fire', 'sigil.earth', 'sigil.wind', 'sigil.light']) {
    const draft = createSpellMakerDraft();
    draft.name = `${sigilId} weighted column`;
    draft.sigilId = sigilId;
    draft.groups = [
      createSpellSignGroup('group:strong', {
        count: 1,
        size: 300,
        positionsDeg: [0],
      }),
      createSpellSignGroup('group:weak', {
        count: 1,
        size: 100,
        positionsDeg: [180],
      }),
    ];
    const compiled = compileSpell(buildSpellDocument(draft));
    const result = interpretCompiledSpell({
      graph: compiled.graph,
      program: compiled.program,
      diagnostics: compiled.diagnostics,
      sceneState: { sources: [], props: [] },
    });
    const column = result.intents.find((intent) =>
      ['water_column', 'material_column'].includes(intent.intentType),
    );
    assert.ok(column, sigilId);
    assert.ok(column.localAxis.x < -0.999999, sigilId);
    assert.ok(column.localAxis.z > 0, sigilId);
    const strongSign = compiled.program.seals[0].symbols.find(
      (symbol) => symbol.resolvedRegistryId === 'sign.column' && symbol.geometry?.size === 300,
    );
    const strongPosition = strongSign.geometry.programPosition;
    const lateralDot =
      strongPosition.x * column.localAxis.x + strongPosition.y * column.localAxis.y;
    assert.ok(lateralDot < 0, `${sigilId} must point away from the stronger sign`);
    assert.equal(column.directionPolicy, 'weighted_inward_push_away_from_stronger_sign');
  }
});

test('native Spell Maker column direction transforms from spell-local to wall world space', () => {
  const wallColumn = interpretNativeColumn([
    createSpellSignGroup('group:wall', { count: 4 }),
  ], {
    origin: { x: 2, y: 1, z: 0 },
    normal: { x: 1, y: 0, z: 0 },
    tangent: { x: 0, y: 0, z: -1 },
    bitangent: { x: 0, y: 1, z: 0 },
    worldScale: 1,
  });
  assert.ok(wallColumn.sceneAxis.x > 0.999999);
  assert.ok(Math.abs(wallColumn.sceneAxis.y) < 0.000001);
  assert.ok(Math.abs(wallColumn.sceneAxis.z) < 0.000001);
});

test('simulation engine keeps Watershot active when no compatible water source exists', () => {
  const result = interpretFixture('watershot-centered.json', {
    sources: [],
    props: [],
  });

  const waterColumn = intentsOf(result, 'water_column')[0];
  assert.ok(waterColumn);
  assert.equal(waterColumn.active, true);
  assert.equal(waterColumn.degraded, false);
  assert.equal(waterColumn.sourceRequirementId, null);
});

test('finite source with zero amount blocks Water Heater target material state', () => {
  const result = interpretFixture('spellmaker-water-heater.json', {
    sources: [
      createSceneSource({
        id: 'source:water:empty',
        kind: 'water',
        amount: 0,
        capacity: 100,
      }),
    ],
    props: [],
  });

  const requirement = intentsOf(result, 'source_requirement').find(
    (intent) => intent.materialKind === 'water',
  );
  assert.ok(requirement);
  assert.equal(requirement.satisfied, false);
  assert.equal(intentsOf(result, 'thermal_material_state')[0].active, false);
});

test('non-depleting source satisfies Water Heater target material state even with zero amount', () => {
  const result = interpretFixture('spellmaker-water-heater.json', {
    sources: [
      createSceneSource({
        id: 'source:water:infinite',
        kind: 'water',
        amount: 0,
        capacity: 100,
        nonDepleting: true,
      }),
    ],
    props: [],
  });

  const binding = intentsOf(result, 'source_binding').find(
    (intent) => intent.materialKind === 'water',
  );
  assert.ok(binding);
  assert.equal(binding.nonDepleting, true);
  assert.equal(binding.active, true);
  assert.equal(intentsOf(result, 'thermal_material_state')[0].active, true);
});

test('single column sign renders as a horizontal spell-origin water shot', () => {
  const input = loadFixture('watershot-centered.json');
  input.seals[0].signProfiles[0].amount = 1;
  const compiled = compileSpell(input);
  const result = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
  });

  const waterColumn = intentsOf(result, 'water_column')[0];
  assert.ok(waterColumn);
  assert.equal(waterColumn.active, true);
  assert.equal(waterColumn.sourceObjectCount, 1);
  assert.equal(Math.abs(waterColumn.sceneAxis.y) < 0.001, true);
  assert.equal(Math.hypot(waterColumn.sceneAxis.x, waterColumn.sceneAxis.z) > 0.99, true);
});

test('two symmetric column signs collapse into one vertical water column intent', () => {
  const input = loadFixture('watershot-centered.json');
  input.seals[0].signProfiles[0].amount = 2;
  const compiled = compileSpell(input);
  const result = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
  });

  const waterColumns = intentsOf(result, 'water_column');
  assert.equal(waterColumns.length, 1);
  assert.equal(waterColumns[0].collapsedNodeIds.length, 2);
  assert.ok(waterColumns[0].sceneAxis.y > 0.9);
});

test('water column thickness comes from the containing ring and not sign size', () => {
  const smallInput = loadFixture('watershot-centered.json');
  smallInput.seals[0].rings = [{ radius: 50 }, { radius: 120 }, { radius: 250 }];
  smallInput.seals[0].signProfiles[0].amount = 1;
  smallInput.seals[0].signProfiles[0].radius = 80;
  smallInput.seals[0].signProfiles[0].size = 100;

  const largeInput = structuredClone(smallInput);
  largeInput.seals[0].signProfiles[0].size = 320;

  const smallCompiled = compileSpell(smallInput);
  const largeCompiled = compileSpell(largeInput);
  const smallResult = interpretCompiledSpell({
    graph: smallCompiled.graph,
    program: smallCompiled.program,
    diagnostics: smallCompiled.diagnostics,
    sceneState: { sources: [], props: [] },
  });
  const largeResult = interpretCompiledSpell({
    graph: largeCompiled.graph,
    program: largeCompiled.program,
    diagnostics: largeCompiled.diagnostics,
    sceneState: { sources: [], props: [] },
  });

  const smallColumn = intentsOf(smallResult, 'water_column')[0];
  const largeColumn = intentsOf(largeResult, 'water_column')[0];

  assert.equal(smallColumn.thicknessRingRadius, 120);
  assert.equal(smallColumn.displayMaxRadius, 250);
  assert.equal(smallColumn.columnRadiusRatio, 0.7);
  assert.equal(smallColumn.columnHeightMultiplier, 3);
  assert.equal(smallColumn.resourceBudget.columnRadius, 84);
  assert.equal(smallColumn.resourceBudget.columnDiameter, 168);
  assert.equal(largeColumn.thicknessRingRadius, smallColumn.thicknessRingRadius);
  assert.equal(largeColumn.displayMaxRadius, smallColumn.displayMaxRadius);
  assert.notEqual(largeColumn.signSizeScale, smallColumn.signSizeScale);
});

test('simulation engine maps Water Heater to thermal material state bound to water source', () => {
  const result = interpretFixture('spellmaker-water-heater.json', {
    sources: [
      createSceneSource({
        id: 'source:water:basin',
        kind: 'water',
        amount: 60,
        capacity: 100,
      }),
    ],
    props: [],
  });

  const thermal = intentsOf(result, 'thermal_material_state')[0];
  assert.ok(thermal);
  assert.equal(thermal.active, true);
  assert.equal(thermal.materialKind, 'water');
  assert.equal(thermal.thermalEffect, 'warm');
  assert.equal(thermal.phase, 'liquid');
  assert.equal(thermal.sourceId, 'source:water:basin');
  assert.equal(thermal.materialFamily, 'water');
  assert.equal(thermal.direction, 'heat');
  assert.equal(thermal.temperatureDriver.equilibriumTempC, 55);
  assert.equal(thermal.temperatureDriver.doesNotCreateMaterial, true);
  assert.equal(thermal.specificEnergy, 0.55);
  assert.equal(thermal.phaseModel, 'specific_energy_plateau');
  assert.deepEqual(thermal.phaseThresholds, {
    freezeSpecificEnergy: 0.33,
    boilSpecificEnergy: 0.86,
    minSpecificEnergy: 0,
    maxSpecificEnergy: 1,
  });
  assert.equal(thermal.materialPreset.registryId, 'material.water');
  assert.equal(thermal.materialPreset.thermalProfile.model, 'specific_energy');
  assert.deepEqual(thermal.visualState, {
    renderPreset: 'warming_material_meter',
    showsTemperatureDriver: true,
    showsPhaseState: true,
    showsMaterialPreset: true,
    noInstantPhaseChange: true,
    doesNotCreateMaterial: true,
  });
  assert.deepEqual(thermal.targetSourceIds, ['source:water:basin']);
  assert.equal(thermal.targetSelectionPolicy, 'all_compatible_sources_inside_crosshair_volume');
  assert.equal(thermal.targetSourceCount, 1);
});

test('Crosshair area thermal effects affect every compatible source inside the target volume', () => {
  const result = interpretFixture('spellmaker-water-heater.json', {
    sources: [
      createSceneSource({
        id: 'source:water:near-left',
        kind: 'water',
        amount: 40,
        capacity: 80,
        position: { x: -1.5, y: 0, z: 0 },
      }),
      createSceneSource({
        id: 'source:water:near-right',
        kind: 'water',
        amount: 20,
        capacity: 80,
        position: { x: 2.4, y: 0, z: 0 },
      }),
      createSceneSource({
        id: 'source:water:far',
        kind: 'water',
        amount: 90,
        capacity: 100,
        position: { x: 4.5, y: 0, z: 0 },
      }),
      createSceneSource({
        id: 'source:earth:near',
        kind: 'earth',
        amount: 90,
        capacity: 100,
        position: { x: 1, y: 0, z: 0 },
      }),
    ],
    props: [],
  });

  const thermal = intentsOf(result, 'thermal_material_state')[0];
  assert.ok(thermal);
  assert.equal(thermal.crosshairMode, 'crosshair_2');
  assert.equal(thermal.targetVolume.shape, 'sphere');
  assert.equal(thermal.targetVolume.radius, 3);
  assert.equal(thermal.active, true);
  assert.deepEqual(thermal.targetSourceIds, [
    'source:water:near-left',
    'source:water:near-right',
  ]);
  assert.deepEqual(
    thermal.targetSources.map((source) => source.distance),
    [1.5, 2.4],
  );
  assert.equal(thermal.targetSourceCount, 2);
  assert.equal(thermal.sourceId, 'source:water:near-left');
  assert.deepEqual(
    intentsOf(result, 'source_binding')
      .filter((binding) => binding.materialKind === 'water')
      .map((binding) => binding.sourceId),
    ['source:water:near-left', 'source:water:near-right', 'source:water:far'],
  );
  assert.equal(thermal.targetSourceIds.includes('source:water:far'), false);
  assert.equal(thermal.targetSourceIds.includes('source:earth:near'), false);

  const materialState = intentsOf(result, 'material_state').find(
    (intent) => intent.materialKind === 'water' && intent.materialOrigin === 'targeted_scene_material',
  );
  assert.ok(materialState);
  assert.equal(materialState.active, true);
  assert.equal(materialState.crosshairMode, 'crosshair_2');
  assert.deepEqual(materialState.targetSourceIds, thermal.targetSourceIds);
  assert.deepEqual(materialState.sourceBindingIds, thermal.sourceBindingIds);
  assert.equal(materialState.targetSelectionPolicy, 'all_compatible_sources_inside_crosshair_volume');
  assert.equal(materialState.sourceId, 'source:water:near-left');
});

test('Crosshair target material state degrades when compatible sources are outside the target volume', () => {
  const result = interpretFixture('spellmaker-water-heater.json', {
    sources: [
      createSceneSource({
        id: 'source:water:far',
        kind: 'water',
        amount: 90,
        capacity: 100,
        position: { x: 4.5, y: 0, z: 0 },
      }),
    ],
    props: [],
  });

  const materialState = intentsOf(result, 'material_state').find(
    (intent) => intent.materialKind === 'water' && intent.materialOrigin === 'targeted_scene_material',
  );
  assert.ok(materialState);
  assert.equal(materialState.active, false);
  assert.equal(materialState.degraded, true);
  assert.equal(materialState.reason, 'No compatible water source inside crosshair_2 target volume');
  assert.equal(materialState.sourceId, null);
  assert.equal(materialState.sourceBindingId, null);
  assert.deepEqual(materialState.targetSourceIds, []);
  assert.equal(materialState.targetSourceCount, 0);

  const thermal = intentsOf(result, 'thermal_material_state')[0];
  assert.equal(thermal.active, false);
  assert.equal(thermal.sourceId, null);
  assert.deepEqual(thermal.targetSourceIds, []);
});

test('ended targeted material states report lifecycle reason instead of silent inactivity', () => {
  const compiled = compileFixture('spellmaker-water-heater.json');
  const ended = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: {
      sources: [
        createSceneSource({
          id: 'source:water:basin',
          kind: 'water',
          amount: 60,
          capacity: 100,
          position: { x: 0.5, y: 0, z: 0 },
        }),
      ],
      props: [],
    },
    options: { activation: { elapsedMs: 2500, durationMs: 2000 } },
  });

  const materialState = intentsOf(ended, 'material_state').find(
    (intent) => intent.materialKind === 'water' && intent.materialOrigin === 'targeted_scene_material',
  );
  assert.ok(materialState);
  assert.equal(materialState.sourceAvailable, true);
  assert.deepEqual(materialState.targetSourceIds, ['source:water:basin']);
  assert.equal(materialState.active, false);
  assert.equal(materialState.degraded, false);
  assert.equal(materialState.reason, 'ended');

  const requirement = intentsOf(ended, 'source_requirement').find(
    (intent) => intent.id === materialState.sourceRequirementId,
  );
  assert.ok(requirement);
  assert.equal(requirement.satisfied, true);
  assert.equal(requirement.active, false);
  assert.equal(requirement.reason, 'ended');
  const binding = intentsOf(ended, 'source_binding').find(
    (intent) => intent.id === materialState.sourceBindingId,
  );
  assert.ok(binding);
  assert.equal(binding.active, false);

  const thermal = intentsOf(ended, 'thermal_material_state')[0];
  assert.equal(thermal.active, false);
  assert.equal(thermal.reason, 'ended');
});

test('simulation engine maps levitation graph nodes to render-neutral visual force intents', () => {
  const result = interpretFixture('levitation-fire-balanced.json', {
    sources: [
      createSceneSource({
        id: 'source:fire:test',
        kind: 'fire',
        amount: 40,
        capacity: 100,
      }),
    ],
    props: [],
  });

  const force = intentsOf(result, 'force_constraint_debug')[0];
  assert.ok(force);
  assert.equal(force.forceKind, 'float');
  assert.equal(force.registryId, 'sign.levitation');
  assert.equal(force.visual, true);
  assert.equal(force.visualPreset, 'levitation_stable_hover');
  assert.equal(force.visualShape, 'levitation_force_field');
  assert.equal(force.materialKind, 'fire');
  assert.equal(force.materialFamily, 'fire');
  assert.equal(force.sourceRequired, false);
  assert.equal(force.sourcePolicy, 'source_free_sigil_generation');
  assert.equal(force.resourceBudget.finite, true);
  assert.equal(force.resourceBudget.materialKind, 'fire');
  assert.equal(force.resourceBudget.outputShape, 'sphere_like_levitation_field');
  assert.equal(force.resourceBudget.budgetMode, 'geometry_derived_finite');
  assert.equal(
    force.resourceBudget.budgetPolicy,
    'finite_ring_sphere_no_infinite_levitation_material',
  );
  assert.equal(force.resourceBudget.units, 'local_volume_units');
  assert.equal(typeof force.resourceBudget.amount, 'number');
  assert.equal(force.resourceBudget.amount > 0, true);
  assert.equal(force.metadata.motionMode, 'stable_hover');
  assert.equal(force.metadata.generatedResourceBudget.amount, force.resourceBudget.amount);
  assert.equal(force.metadata.outputShape, 'sphere_like_levitation_field');
  assert.equal(
    force.metadata.budgetPolicy,
    'finite_ring_sphere_no_infinite_levitation_material',
  );
  assert.equal(force.metadata.visualDeferred, false);
  assert.equal(force.metadata.visual.visualPreset, 'levitation_stable_hover');
  assert.equal(force.metadata.visual.renderPolicy, 'visualize_force_field_without_moving_objects_until_physics_phase');
  assert.deepEqual(force.metadata.visual.translationVector, { x: 0, y: 0 });

  const windResult = interpretFixture('levitation-wind-stream.json', {
    sources: [],
    props: [],
  });
  const windForce = intentsOf(windResult, 'force_constraint_debug')[0];
  assert.ok(windForce);
  assert.equal(windForce.forceKind, 'wind_stream');
  assert.equal(windForce.materialKind, 'wind');
  assert.equal(windForce.materialFamily, 'wind');
  assert.equal(windForce.visual, true);
  assert.equal(windForce.visualPreset, 'levitation_continuous_stream');
  assert.equal(windForce.resourceBudget.outputShape, 'sphere_like_levitation_field');
  assert.equal(windForce.metadata.continuousStream, true);
  assert.equal(windForce.metadata.visual.continuousStream, true);
  assert.deepEqual(windForce.metadata.visual.translationVector, { x: 0, y: -7 });
  assert.equal(
    windForce.metadata.generatedResourceBudget.amount,
    windForce.resourceBudget.amount,
  );
});

test('all levitation domains expose world-consumable orb or carrier physics fields', () => {
  for (const materialKind of ['fire', 'water', 'light', 'earth']) {
    const fixture = loadFixture('levitation-fire-balanced.json');
    fixture.title = `${materialKind} levitation runtime`;
    fixture.seals[0].sigils = [{ name: materialKind }];
    const compiled = compileSpell(fixture);
    const result = interpretCompiledSpell({
      graph: compiled.graph,
      program: compiled.program,
      diagnostics: compiled.diagnostics,
      sceneState: { sources: [], props: [] },
    });
    const force = intentsOf(result, 'force_constraint_debug')[0];
    assert.ok(force, materialKind);
    assert.equal(force.materialKind, materialKind);
    assert.equal(force.physicsField.fieldShape, 'generated_levitation_orb');
    assert.equal(force.physicsField.oneShotLaunch, false);
    assert.ok(force.physicsField.radius > 0);
    assert.ok(force.physicsField.hoverHeight > 0);
  }

  const wind = interpretFixture('levitation-wind-stream.json', { sources: [], props: [] });
  const windForce = intentsOf(wind, 'force_constraint_debug')[0];
  assert.equal(windForce.physicsField.fieldShape, 'carrier_levitation');
  assert.deepEqual(windForce.physicsField.direction, { x: 0, y: -1, z: 0 });
  assert.deepEqual(windForce.physicsField.emissionDirection, { x: 0, y: 1, z: 0 });
});

test('elemental levitation orb collider radius exactly follows its owning spell circle scale', () => {
  const compiled = compileFixture('levitation-fire-balanced.json');
  for (const worldScale of [0.25, 0.4, 1, 2.5]) {
    const result = interpretCompiledSpell({
      graph: compiled.graph,
      program: compiled.program,
      diagnostics: compiled.diagnostics,
      sceneState: { sources: [], props: [] },
      options: {
        placementFrame: {
          origin: { x: 0, y: 0, z: 0 },
          normal: { x: 0, y: 1, z: 0 },
          tangent: { x: 1, y: 0, z: 0 },
          bitangent: { x: 0, y: 0, z: 1 },
          worldScale,
        },
      },
    });
    const force = intentsOf(result, 'force_constraint_debug')[0];
    assert.equal(
      force.physicsField.radius,
      NORMALIZED_SPELL_CIRCLE_RADIUS * worldScale,
    );
  }
});

test('Wind Levitation carrier thrust always points opposite the spell face normal', () => {
  const compiled = compileFixture('levitation-wind-stream.json');
  const cases = [
    {
      normal: { x: 0, y: 1, z: 0 },
      tangent: { x: 1, y: 0, z: 0 },
      expected: { x: 0, y: -1, z: 0 },
    },
    {
      normal: { x: 0, y: -1, z: 0 },
      tangent: { x: 1, y: 0, z: 0 },
      expected: { x: 0, y: 1, z: 0 },
    },
    {
      normal: { x: 1, y: 0, z: 0 },
      tangent: { x: 0, y: 0, z: 1 },
      expected: { x: -1, y: 0, z: 0 },
    },
  ];

  for (const { normal, tangent, expected } of cases) {
    const result = interpretCompiledSpell({
      graph: compiled.graph,
      program: compiled.program,
      diagnostics: compiled.diagnostics,
      sceneState: { sources: [], props: [] },
      options: {
        placementFrame: {
          origin: { x: 0, y: 0, z: 0 },
          normal,
          tangent,
        },
      },
    });
    const force = intentsOf(result, 'force_constraint_debug')[0];
    assert.deepEqual(force.physicsField.direction, expected);
    assert.deepEqual(force.physicsField.emissionDirection, normal);
  }
});

test('ended non-Repetition levitation force outputs expose lifecycle cleanup semantics', () => {
  const cases = [
    {
      fixture: 'levitation-fire-balanced.json',
      materialKind: 'fire',
      forceKind: 'float',
      renderPreset: 'fire_ceased',
    },
    {
      fixture: 'levitation-wind-stream.json',
      materialKind: 'wind',
      forceKind: 'wind_stream',
      renderPreset: 'wind_ceased',
    },
  ];

  for (const testCase of cases) {
    const compiled = compileFixture(testCase.fixture);
    const result = interpretCompiledSpell({
      graph: compiled.graph,
      program: compiled.program,
      diagnostics: compiled.diagnostics,
      sceneState: { sources: [], props: [] },
      options: { activation: { elapsedMs: 2500, durationMs: 2000 } },
    });

    const force = intentsOf(result, 'force_constraint_debug')[0];
    assert.ok(force, testCase.fixture);
    assert.equal(force.active, false);
    assert.equal(force.forceKind, testCase.forceKind);
    assert.equal(force.materialKind, testCase.materialKind);
    assert.equal(force.resourceBudget.finite, true);

    const cleanup = intentsOf(result, 'lifecycle_cleanup').find(
      (intent) => intent.sourceIntentId === force.id,
    );
    assert.ok(cleanup, testCase.fixture);
    assert.equal(cleanup.nonRepetitionStopsActiveEffects, true);
    assert.equal(cleanup.resourceBudget.amount, force.resourceBudget.amount);
    assert.equal(cleanup.leftover.materialKind, testCase.materialKind);
    assert.equal(cleanup.leftover.renderPreset, testCase.renderPreset);
    assert.equal(cleanup.leftover.behavior, 'cease_without_leftover');
    assert.equal(cleanup.leftover.remainsInWorld, false);
  }
});

test('Region emergence anchors split one generated output budget without changing column vector', () => {
  const input = loadFixture('watershot-centered.json');
  input.seals[0].signProfiles.push({
    kind: 'region',
    amount: 2,
    size: 200,
    rotation: 0,
    angle: 180,
    radius: 120,
  });
  const compiled = compileSpell(input);
  const result = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
  });

  const region = intentsOf(result, 'region_emergence')[0];
  assert.ok(region);
  assert.equal(region.anchors.length, 2);
  assert.deepEqual(region.debug, {
    outcome: 'split_outward_emergence',
    anchorCount: 2,
    split: true,
    centered: false,
    outward: true,
    biased: false,
    fallback: false,
    budgetPolicy: 'weighted_split_no_power_gain',
    budgetWeightBasis: 'sum_region_sign_scale_weight_per_anchor',
    clusterPolicy: 'merge_region_signs_within_35_degrees',
    anchorWeights: [1, 1],
    budgetShares: [0.5, 0.5],
    budgetShareTotal: 1,
  });
  assert.deepEqual(
    region.anchors.map((anchor) => anchor.budgetShare),
    [0.5, 0.5],
  );
  assert.equal(region.budgetPolicy, 'weighted_split_no_power_gain');

  const waterColumn = intentsOf(result, 'water_column')[0];
  assert.equal(waterColumn.resourceBudget.finite, true);
  assert.equal(waterColumn.emergence.anchorCount, 2);
  assert.equal(waterColumn.emergence.vectorSemanticsUnaffected, true);
  assert.equal(waterColumn.sceneAxis.y > 0.9, true);
  assert.equal(
    Math.round(
      waterColumn.emergence.anchors.reduce(
        (sum, anchor) => sum + anchor.budgetAmount,
        0,
      ),
    ),
    Math.round(waterColumn.resourceBudget.amount),
  );
});

test('Region anchor budgets follow sign scale weights without increasing total output', () => {
  const compiled = compileSpell({
    title: 'Weighted region water column',
    seals: [
      {
        sigils: [{ name: 'water' }],
        rings: [{ radius: 100 }],
        signProfiles: [
          { kind: 'column', amount: 4, size: 200, rotation: 0, angle: 0, radius: 80 },
          { kind: 'region', amount: 1, size: 300, rotation: 0, angle: 180, radius: 120 },
          { kind: 'region', amount: 1, size: 100, rotation: 180, angle: 180, radius: 120 },
        ],
      },
    ],
  });
  const result = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
  });

  const region = intentsOf(result, 'region_emergence')[0];
  assert.equal(region.debug.budgetWeightBasis, 'sum_region_sign_scale_weight_per_anchor');
  assert.equal(region.debug.clusterPolicy, 'merge_region_signs_within_35_degrees');
  assert.deepEqual(region.debug.anchorWeights, [0.5, 1.5]);
  assert.deepEqual(region.debug.budgetShares, [0.25, 0.75]);
  assert.equal(region.debug.budgetShareTotal, 1);
  assert.deepEqual(
    region.anchors.map((anchor) => anchor.clusterSize),
    [1, 1],
  );
  assert.deepEqual(
    region.anchors.map((anchor) => anchor.clusterPolicy),
    ['merge_region_signs_within_35_degrees', 'merge_region_signs_within_35_degrees'],
  );

  const waterColumn = intentsOf(result, 'water_column')[0];
  assert.deepEqual(
    waterColumn.emergence.anchors.map((anchor) => anchor.budgetShare),
    [0.25, 0.75],
  );
  assert.equal(
    roundTo(
      waterColumn.emergence.anchors.reduce((sum, anchor) => sum + anchor.budgetAmount, 0),
      4,
    ),
    roundTo(waterColumn.resourceBudget.amount, 4),
  );
  assert.equal(waterColumn.emergence.vectorSemanticsUnaffected, true);
});

test('Region clusters nearby same-facing signs into one weighted emergence anchor', () => {
  const compiled = compileSpell({
    title: 'Clustered region water column',
    seals: [
      {
        sigils: [{ name: 'water' }],
        rings: [{ radius: 100 }],
        signProfiles: [
          { kind: 'column', amount: 4, size: 200, rotation: 0, angle: 0, radius: 80 },
          { kind: 'region', amount: 1, size: 200, rotation: 0, angle: 180, radius: 120 },
          { kind: 'region', amount: 1, size: 100, rotation: 20, angle: 180, radius: 120 },
        ],
      },
    ],
  });
  const result = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
  });

  const region = intentsOf(result, 'region_emergence')[0];
  assert.equal(region.anchors.length, 1);
  assert.equal(region.anchors[0].clusterSize, 2);
  assert.equal(region.anchors[0].weight, 1.5);
  assert.equal(region.anchors[0].budgetShare, 1);
  assert.deepEqual(region.debug.anchorWeights, [1.5]);
  assert.deepEqual(region.debug.budgetShares, [1]);
  assert.equal(region.debug.outcome, 'moved_outward');
});

test('Region debug classifies centered and biased emergence outcomes', () => {
  const centered = interpretFixture('region-water-inward.json', {
    sources: [],
    props: [],
  });
  const centeredRegion = intentsOf(centered, 'region_emergence')[0];
  assert.equal(centeredRegion.debug.outcome, 'stayed_centered');
  assert.equal(centeredRegion.debug.centered, true);
  assert.equal(centeredRegion.debug.split, false);
  assert.deepEqual(centeredRegion.debug.budgetShares, [1]);
  assert.equal(centeredRegion.anchors[0].placement, 'centered_inward_collapse');

  const biasedInput = loadFixture('watershot-centered.json');
  biasedInput.seals[0].signProfiles.push({
    kind: 'region',
    amount: 1,
    size: 200,
    rotation: 0,
    angle: 0,
    radius: 120,
  });
  const biasedCompiled = compileSpell(biasedInput);
  const biased = interpretCompiledSpell({
    graph: biasedCompiled.graph,
    program: biasedCompiled.program,
    diagnostics: biasedCompiled.diagnostics,
    sceneState: { sources: [], props: [] },
  });
  const biasedRegion = intentsOf(biased, 'region_emergence')[0];
  assert.equal(biasedRegion.debug.outcome, 'biased_one_side');
  assert.equal(biasedRegion.debug.biased, true);
  assert.equal(biasedRegion.debug.centered, false);
  assert.deepEqual(biasedRegion.debug.budgetShares, [1]);
  assert.equal(biasedRegion.anchors[0].placement, 'biased_region_cluster');
});

test('Region modifies Pull origin without changing pull selection semantics', () => {
  const compiled = compileSpell({
    title: 'Region-biased pull',
    seals: [
      {
        sigils: [{ name: 'wind' }],
        rings: [{ radius: 100 }],
        signProfiles: [
          { kind: 'pull', amount: 2, size: 200, rotation: 0, angle: 0, radius: 70 },
          { kind: 'region', amount: 1, size: 200, rotation: 0, angle: 90, radius: 120 },
        ],
      },
    ],
  });
  const result = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: {
      sources: [],
      props: [
        createSceneProp({
          id: 'prop:near-cube',
          position: { x: 1, y: 0, z: 0 },
          mass: 1,
        }),
      ],
    },
  });

  const region = intentsOf(result, 'region_emergence')[0];
  assert.ok(region);
  const pull = intentsOf(result, 'source_acquisition').find(
    (intent) => intent.sourceMode === 'pull',
  );
  assert.ok(pull);
  assert.equal(pull.satisfied, true);
  assert.equal(pull.candidateSelection, 'compatible_material_or_object_in_field');
  assert.equal(pull.regionOrigin.regionIntentId, region.id);
  assert.equal(pull.regionOrigin.budgetPolicy, 'origin_only_no_power_gain');
  assert.equal(pull.regionOrigin.vectorSemanticsUnaffected, true);

  const motion = intentsOf(result, 'physics_motion').find(
    (intent) => intent.sourceAcquisitionId === pull.id,
  );
  assert.ok(motion);
  assert.equal(motion.originPolicy, 'region_anchor_origin_modifier');
  assert.deepEqual(motion.toPosition, pull.regionOrigin.primaryScenePosition);
  assert.notDeepEqual(motion.toPosition, { x: 0, y: 0.16, z: 0 });
  assert.equal(motion.motionKind, 'pull_field_motion');
});

test('Region-modified Pull reach is measured from the region anchor field origin', () => {
  const compiled = compileSpell({
    title: 'Region-offset pull reach',
    seals: [
      {
        sigils: [{ name: 'wind' }],
        rings: [{ radius: 100 }],
        signProfiles: [
          { kind: 'pull', amount: 2, size: 200, rotation: 0, angle: 0, radius: 70 },
          { kind: 'region', amount: 1, size: 200, rotation: 0, angle: 90, radius: 120 },
        ],
      },
    ],
  });
  const result = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: {
      sources: [],
      props: [
        createSceneProp({
          id: 'prop:region-near-center-far',
          position: { x: 0, y: 0, z: 4.8 },
          mass: 1,
        }),
      ],
    },
  });

  const pull = intentsOf(result, 'source_acquisition').find(
    (intent) => intent.sourceMode === 'pull',
  );
  assert.ok(pull);
  assert.equal(pull.satisfied, true);
  assert.equal(pull.sourceFieldOriginPolicy, 'region_anchor_origin_modifier');
  assert.equal(pull.reachPolicy, 'region_anchor_3d_distance');
  assert.equal(pull.sourceCapacityPolicy.reachPolicy, 'region_anchor_3d_distance');
  assert.equal(pull.sourceCapacityPolicy.originPolicy, 'region_anchor_origin_modifier');
  assert.equal(roundTo(pull.sourceFieldOrigin.z, 3), 2.25);
  assert.equal(pull.matches[0].sourceId, 'prop:region-near-center-far');
  assert.equal(pull.matches[0].distancePolicy, 'region_anchor_3d_distance');
  assert.equal(pull.matches[0].distanceOriginPolicy, 'region_anchor_origin_modifier');
  assert.equal(pull.matches[0].distance < pull.reach, true);
  assert.equal(4.8 > pull.reach, true);

  const motion = intentsOf(result, 'physics_motion').find(
    (intent) => intent.sourceAcquisitionId === pull.id,
  );
  assert.ok(motion);
  assert.deepEqual(motion.toPosition, pull.sourceFieldOrigin);
  assert.equal(motion.originPolicy, 'region_anchor_origin_modifier');
});

test('multi-anchor Region Pull selects the nearest reachable anchor for source checks and motion', () => {
  const compiled = compileSpell({
    title: 'Multi-anchor region pull',
    seals: [
      {
        sigils: [{ name: 'wind' }],
        rings: [{ radius: 100 }],
        signProfiles: [
          { kind: 'pull', amount: 2, size: 200, rotation: 0, angle: 0, radius: 70 },
          { kind: 'region', amount: 2, size: 200, rotation: 0, angle: 90, radius: 120 },
        ],
      },
    ],
  });
  const result = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: {
      sources: [],
      props: [
        createSceneProp({
          id: 'prop:second-anchor-target',
          position: { x: 0, y: 0, z: 4.8 },
          mass: 1,
        }),
      ],
    },
  });

  const region = intentsOf(result, 'region_emergence')[0];
  assert.equal(region.anchors.length, 2);
  const secondAnchor = region.anchors[1];
  assert.equal(roundTo(secondAnchor.scenePosition.z, 3), 2.25);

  const pull = intentsOf(result, 'source_acquisition').find(
    (intent) => intent.sourceMode === 'pull',
  );
  assert.ok(pull);
  assert.equal(pull.satisfied, true);
  assert.equal(pull.sourceFieldOrigins.length, 2);
  assert.equal(pull.sourceCapacityPolicy.originCount, 2);
  assert.equal(pull.matches[0].sourceId, 'prop:second-anchor-target');
  assert.equal(pull.matches[0].sourceFieldOriginId, secondAnchor.anchorId);
  assert.deepEqual(pull.matches[0].sourceFieldOrigin, secondAnchor.scenePosition);
  assert.equal(pull.matches[0].distancePolicy, 'region_anchor_3d_distance');
  assert.equal(pull.matches[0].distance < pull.reach, true);
  assert.equal(4.8 > pull.reach, true);
  assert.equal(
    Math.abs(4.8 - region.anchors[0].scenePosition.z) > pull.reach,
    true,
  );

  const motion = intentsOf(result, 'physics_motion').find(
    (intent) => intent.sourceAcquisitionId === pull.id,
  );
  assert.ok(motion);
  assert.equal(motion.sourceFieldOriginId, secondAnchor.anchorId);
  assert.deepEqual(motion.sourceFieldOrigin, secondAnchor.scenePosition);
  assert.deepEqual(motion.toPosition, secondAnchor.scenePosition);
});

test('Region metadata attaches to Levitation as origin-only force placement', () => {
  const compiled = compileSpell({
    title: 'Region-biased wind levitation',
    seals: [
      {
        sigils: [{ name: 'wind' }],
        rings: [{ radius: 100 }],
        signProfiles: [
          { kind: 'levitation', amount: 2, size: 200, rotation: 0, angle: 0, radius: 70 },
          { kind: 'region', amount: 1, size: 200, rotation: 0, angle: 90, radius: 120 },
        ],
      },
    ],
  });
  const result = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
  });

  const region = intentsOf(result, 'region_emergence')[0];
  const force = intentsOf(result, 'force_constraint_debug').find(
    (intent) => intent.registryId === 'sign.levitation',
  );
  assert.ok(force);
  assert.equal(force.forceKind, 'wind_stream');
  assert.equal(force.regionOrigin.regionIntentId, region.id);
  assert.equal(force.regionOrigin.budgetPolicy, 'origin_only_no_power_gain');
  assert.equal(force.metadata.regionApplication.regionIntentId, region.id);
  assert.equal(force.metadata.regionApplication.vectorSemanticsUnaffected, true);
  assert.equal(force.metadata.regionAffects, 'origin_only_when_region_present');
  assert.equal(force.resourceBudget.outputShape, 'sphere_like_levitation_field');
  assert.equal(force.physicsField.fieldShape, 'carrier_levitation');
  assert.equal(force.physicsField.targetFilter, 'spell_carrier_only');
  assert.equal(force.physicsField.forceModel, 'gravity_compensated_bounded_carrier_lift');
});

test('Crosshair resolves contextual modes and opt-in column mode', () => {
  const generated = interpretFixture('crosshair-valid.json', { sources: [], props: [] });
  const generatedScope = intentsOf(generated, 'targeting_debug').find(
    (intent) => intent.modifierWeakEffect,
  );
  assert.equal(generatedScope.mode, 'crosshair_1');
  assert.equal(generatedScope.defaulted, true);
  assert.equal(generatedScope.reason, 'generation_or_source_flow_present');
  assert.equal(generatedScope.signSize, 200);
  assert.equal(generatedScope.targetVolume.shape, 'generated_output_binding');

  const area = interpretFixture('spellmaker-water-heater.json', {
    sources: [createSceneSource({ id: 'source:water:test', kind: 'water' })],
    props: [],
  });
  const areaScope = intentsOf(area, 'targeting_debug').find(
    (intent) => intent.modifierWeakEffect === 'heat',
  );
  assert.equal(areaScope.mode, 'crosshair_2');
  assert.equal(areaScope.defaulted, true);
  assert.equal(areaScope.reason, 'no_generation_or_source_flow_present');
  assert.equal(areaScope.signSize, 300);
  assert.equal(areaScope.targetVolume.shape, 'sphere');
  assert.equal(areaScope.targetVolume.radius, 3);

  const compiled = compileFixture('spellmaker-water-heater.json');
  const outputOverride = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [createSceneSource({ kind: 'water' })], props: [] },
    options: { crosshairMode: 'crosshair_1' },
  });
  const outputScope = intentsOf(outputOverride, 'targeting_debug').find(
    (intent) => intent.modifierWeakEffect === 'heat',
  );
  assert.equal(outputScope.mode, 'crosshair_1');
  assert.equal(outputScope.defaulted, false);
  assert.equal(outputScope.reason, 'explicit_runtime_override');
  assert.equal(outputScope.targetVolume.shape, 'generated_output_binding');

  const generatedCompiled = compileFixture('crosshair-valid.json');
  const sphereOverride = interpretCompiledSpell({
    graph: generatedCompiled.graph,
    program: generatedCompiled.program,
    diagnostics: generatedCompiled.diagnostics,
    sceneState: { sources: [], props: [] },
    options: { crosshairMode: 'crosshair_2' },
  });
  const sphereScope = intentsOf(sphereOverride, 'targeting_debug').find(
    (intent) => intent.modifierWeakEffect,
  );
  assert.equal(sphereScope.mode, 'crosshair_2');
  assert.equal(sphereScope.defaulted, false);
  assert.equal(sphereScope.reason, 'explicit_runtime_override');
  assert.equal(sphereScope.targetVolume.shape, 'sphere');

  const columnOverride = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [createSceneSource({ kind: 'water' })], props: [] },
    options: { crosshairMode: 'crosshair_3' },
  });
  const columnScope = intentsOf(columnOverride, 'targeting_debug').find(
    (intent) => intent.modifierWeakEffect === 'heat',
  );
  assert.equal(columnScope.mode, 'crosshair_3');
  assert.equal(columnScope.defaulted, false);
  assert.equal(columnScope.reason, 'explicit_runtime_override');
  assert.equal(columnScope.signSize, 300);
  assert.equal(columnScope.targetVolume.shape, 'local_column');
  assert.equal(columnScope.targetVolume.radius, 3);
  assert.equal(columnScope.targetVolume.height, 7.5);
});

test('Crosshair target volumes use the spell local frame for surface placement', () => {
  const compiled = compileFixture('spellmaker-water-heater.json');
  const result = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: {
      sources: [
        createSceneSource({
          id: 'source:water:surface-normal',
          kind: 'water',
          amount: 40,
          position: { x: 2, y: 0, z: 0 },
        }),
        createSceneSource({
          id: 'source:water:world-up',
          kind: 'water',
          amount: 40,
          position: { x: 0, y: 4, z: 0 },
        }),
        createSceneSource({
          id: 'source:water:beyond-height',
          kind: 'water',
          amount: 40,
          position: { x: 4.2, y: 0, z: 0 },
        }),
      ],
      props: [],
    },
    options: {
      crosshairMode: 'crosshair_3',
      placementFrame: {
        origin: { x: 0, y: 0, z: 0 },
        normal: { x: 1, y: 0, z: 0 },
        tangent: { x: 0, y: 0, z: 1 },
        placementMode: 'prop_surface',
        surfaceMode: 'prop-east',
      },
    },
  });

  const thermal = intentsOf(result, 'thermal_material_state')[0];
  assert.equal(thermal.crosshairMode, 'crosshair_3');
  assert.equal(thermal.targetVolume.shape, 'local_column');
  assert.deepEqual(thermal.targetSourceIds, ['source:water:surface-normal']);
  assert.equal(thermal.targetSources[0].distance, 0);
});

test('Crosshair spherical area uses 3D radius rather than ground-plane fallback', () => {
  const result = interpretFixture('spellmaker-water-heater.json', {
    sources: [
      createSceneSource({
        id: 'source:water:overhead',
        kind: 'water',
        amount: 40,
        position: { x: 0, y: 3.2, z: 0 },
      }),
      createSceneSource({
        id: 'source:water:inside',
        kind: 'water',
        amount: 40,
        position: { x: 0, y: 2.8, z: 0 },
      }),
    ],
    props: [],
  });

  const thermal = intentsOf(result, 'thermal_material_state')[0];
  assert.equal(thermal.crosshairMode, 'crosshair_2');
  assert.deepEqual(thermal.targetSourceIds, ['source:water:inside']);
  assert.equal(thermal.targetSources[0].distance, 2.8);
});

test('Convergence runtime metadata expands legacy point-focus into compression modes', () => {
  const axis = interpretFixture('convergence-point-focus-valid.json', {
    sources: [],
    props: [],
  });
  const axisMode = intentsOf(axis, 'field_modification')[0];
  assert.equal(axisMode.convergenceMode, 'axis_compression');
  assert.equal(axisMode.legacyConvergenceMode, 'point_focus');
  assert.equal(axisMode.active, false);
  assert.equal(axisMode.diagnosticOnly, true);
  assert.equal(axisMode.reason, 'requires generated output or source-flow field to compress');
  assert.equal(axisMode.fieldModification.compressesActiveField, false);
  assert.equal(axisMode.fieldModification.pullsMaterialTowardSigns, false);
  assert.equal(axisMode.targetFieldPolicy.policyId, 'convergence_requires_active_spell_field');
  assert.equal(axisMode.targetFieldPolicy.hasTargetField, false);
  assert.equal(axisMode.targetFieldPolicy.activeTargetField, false);
  assert.deepEqual(axisMode.targetFieldPolicy.targetKinds, []);
  assert.equal(axisMode.targetFieldPolicy.standaloneConvergenceCreatesField, false);
  const standaloneForce = intentsOf(axis, 'force_constraint_debug')[0];
  assert.equal(standaloneForce.registryId, 'sign.convergence');
  assert.equal(standaloneForce.active, false);
  assert.equal(standaloneForce.metadata.convergenceMode, 'axis_compression');
  assert.equal(standaloneForce.metadata.fieldModification.active, false);
  assert.equal(
    standaloneForce.metadata.targetFieldPolicy.policyId,
    'convergence_requires_active_spell_field',
  );

  const radialInput = loadFixture('convergence-point-focus-valid.json');
  radialInput.seals[0].signProfiles[0].amount = 4;
  const radialCompiled = compileSpell(radialInput);
  const radial = interpretCompiledSpell({
    graph: radialCompiled.graph,
    program: radialCompiled.program,
    diagnostics: radialCompiled.diagnostics,
    sceneState: { sources: [], props: [] },
  });
  assert.equal(
    intentsOf(radial, 'field_modification')[0].convergenceMode,
    'radial_point_focus',
  );
  assert.equal(intentsOf(radial, 'field_modification')[0].active, false);
  assert.equal(intentsOf(radial, 'field_modification')[0].diagnosticOnly, true);

  const biasedInput = loadFixture('convergence-point-focus-valid.json');
  biasedInput.seals[0].signProfiles[0].amount = 3;
  const biasedCompiled = compileSpell(biasedInput);
  const biased = interpretCompiledSpell({
    graph: biasedCompiled.graph,
    program: biasedCompiled.program,
    diagnostics: biasedCompiled.diagnostics,
    sceneState: { sources: [], props: [] },
  });
  assert.equal(
    intentsOf(biased, 'field_modification')[0].convergenceMode,
    'biased_compression',
  );
  assert.equal(intentsOf(biased, 'field_modification')[0].active, false);
  assert.equal(intentsOf(biased, 'field_modification')[0].diagnosticOnly, true);

  const under = interpretFixture('convergence-under-specified.json', {
    sources: [],
    props: [],
  });
  const underMode = intentsOf(under, 'field_modification')[0];
  assert.equal(underMode.convergenceMode, 'under_specified');
  assert.equal(underMode.diagnosticOnly, true);
});

test('Convergence compression metadata attaches to generated columns', () => {
  const compiled = compileSpell({
    title: 'Converged water column',
    seals: [
      {
        sigils: [{ name: 'water' }],
        rings: [{ radius: 100 }],
        signProfiles: [
          { kind: 'column', amount: 4, size: 200, rotation: 0, angle: 0, radius: 80 },
          { kind: 'convergence', amount: 2, size: 200, rotation: 0, angle: 0, radius: 70 },
        ],
      },
    ],
  });
  const result = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
  });

  const field = intentsOf(result, 'field_modification')[0];
  const waterColumn = intentsOf(result, 'water_column')[0];
  assert.equal(field.convergenceMode, 'axis_compression');
  assert.equal(field.active, true);
  assert.equal(field.diagnosticOnly, false);
  assert.equal(field.fieldModification.compressesActiveField, true);
  assert.equal(field.targetFieldPolicy.activeTargetField, true);
  assert.deepEqual(field.targetFieldPolicy.targetKinds, ['column_output', 'field_lobe_output']);
  const convergenceForce = intentsOf(result, 'force_constraint_debug').find(
    (intent) => intent.registryId === 'sign.convergence',
  );
  assert.ok(convergenceForce);
  assert.equal(convergenceForce.active, true);
  assert.equal(convergenceForce.metadata.fieldModification.active, true);
  assert.equal(convergenceForce.metadata.targetFieldPolicy.activeTargetField, true);
  assert.equal(waterColumn.fieldModificationId, field.id);
  assert.equal(waterColumn.convergenceMode, 'axis_compression');
  assert.equal(waterColumn.compressedByConvergence, true);
  assert.equal(waterColumn.fieldModification.compressionAxes.length, 1);
  assert.equal(
    Math.abs(
      Math.hypot(
        waterColumn.fieldModification.compressionAxes[0].x,
        waterColumn.fieldModification.compressionAxes[0].y,
      ) - 1,
    ) < 0.001,
    true,
  );
  assert.equal(waterColumn.fieldModification.compressesActiveField, true);
  assert.equal(waterColumn.fieldModification.pullsMaterialTowardSigns, false);
  assert.equal(waterColumn.compressionVisual.visualPreset, 'axis_ovalized_column');
  assert.equal(waterColumn.compressionVisual.crossSectionScaleX, 0.58);
  assert.equal(waterColumn.compressionVisual.crossSectionScaleZ, 1.18);
});

test('Convergence does not compress Gather-gated columns until material is actually gathered', () => {
  const compiled = compileSpell({
    title: 'Gather-gated converged water column',
    seals: [
      {
        sigils: [{ name: 'water' }],
        rings: [{ radius: 100 }],
        signProfiles: [
          { kind: 'gather', amount: 2, size: 200, rotation: 0, angle: 0, radius: 70 },
          { kind: 'column', amount: 4, size: 200, rotation: 0, angle: 0, radius: 80 },
          { kind: 'convergence', amount: 2, size: 200, rotation: 0, angle: 0, radius: 70 },
        ],
      },
    ],
  });

  const missing = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
  });
  const missingField = intentsOf(missing, 'field_modification')[0];
  const missingColumn = intentsOf(missing, 'water_column')[0];
  const missingForce = intentsOf(missing, 'force_constraint_debug').find(
    (intent) => intent.registryId === 'sign.convergence',
  );
  assert.equal(missingField.convergenceMode, 'axis_compression');
  assert.equal(missingField.active, false);
  assert.equal(missingField.fieldModification.compressesActiveField, false);
  assert.equal(missingField.targetFieldPolicy.activeTargetField, false);
  assert.deepEqual(missingField.targetFieldPolicy.activeTargetKinds, []);
  assert.deepEqual(missingField.targetFieldPolicy.sourceGateBlockedTargetKinds, [
    'column_output',
    'field_lobe_output',
    'gather_active_source_flow',
  ]);
  assert.equal(missingField.targetFieldPolicy.generatedOrForceOutput, false);
  assert.equal(missingColumn.active, false);
  assert.equal(missingColumn.compressedByConvergence, false);
  assert.equal(missingColumn.fieldModificationId, null);
  assert.equal(missingForce.active, false);

  const supplied = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: {
      sources: [
        createSceneSource({
          id: 'source:water:near',
          kind: 'water',
          amount: 20,
          position: { x: 1, y: 0, z: 0 },
        }),
      ],
      props: [],
    },
  });
  const suppliedField = intentsOf(supplied, 'field_modification')[0];
  const suppliedColumn = intentsOf(supplied, 'water_column')[0];
  assert.equal(suppliedField.active, true);
  assert.equal(suppliedField.targetFieldPolicy.activeTargetField, true);
  assert.deepEqual(suppliedField.targetFieldPolicy.sourceGateBlockedTargetKinds, []);
  assert.deepEqual(suppliedField.targetFieldPolicy.activeTargetKinds, [
    'column_output',
    'field_lobe_output',
    'gather_active_source_flow',
  ]);
  assert.equal(suppliedColumn.active, true);
  assert.equal(suppliedColumn.compressedByConvergence, true);
  assert.equal(suppliedColumn.fieldModificationId, suppliedField.id);
});

test('Gather capacity succeeds only when compatible material is actually movable', () => {
  const success = interpretFixture('gather-multi-domain.json', {
    sources: [
      createSceneSource({
        id: 'source:water:near',
        kind: 'water',
        amount: 80,
        position: { x: 1, y: 0, z: 0 },
      }),
    ],
    props: [],
  });
  const waterGather = intentsOf(success, 'source_acquisition').find(
    (intent) => intent.materialFamily === 'water',
  );
  assert.equal(waterGather.satisfied, true);
  assert.equal(waterGather.feedsDownstream, true);
  assert.equal(waterGather.creationAssumption, 'no_creation');
  assert.equal(waterGather.materialCompatibilityPolicy.matching, 'broad_material_family');
  assert.deepEqual(waterGather.materialCompatibilityPolicy.acceptedFamilies, ['water']);
  assert.deepEqual(waterGather.materialCompatibilityPolicy.acceptedMaterialStates, [
    'water',
    'liquid',
    'ice',
    'mist',
    'cloud',
    'mist_cloud',
  ]);
  assert.equal(waterGather.materialCompatibilityPolicy.exactPhaseRequired, false);
  assert.equal(waterGather.sourceContentPolicy.policyId, 'gather_material_resource_no_effect_clone');
  assert.equal(waterGather.sourceContentPolicy.collectsSpellEffects, false);
  assert.equal(waterGather.sourceContentPolicy.clonesActiveModifiers, false);
  assert.equal(
    waterGather.sourceContentPolicy.activeModifierOwnership,
    'preserve_original_spell_owner',
  );
  assert.equal(waterGather.sourceContentPolicy.effectTransferPolicy, 'material_only_no_effect_transfer');
  assert.equal(waterGather.sourceContentPolicy.downstreamHandoff, true);
  assert.equal(
    waterGather.sourceContentPolicy.handoffPolicy,
    'actual_gathered_material_only_for_same_seal_water_earth_phase1',
  );
  assert.equal(waterGather.downstreamHandoffScope, 'same_seal_phase1');
  assert.equal(waterGather.sourceCapacityPolicy.policyId, 'gather_family_capacity_and_handoff_check');
  assert.equal(waterGather.sourceCapacityPolicy.formula, 'mass * cohesion * phaseResistance * distanceFalloff');
  assert.equal(waterGather.sourceCapacityPolicy.comparator, 'pullDifficulty <= pullCapacity');
  assert.equal(waterGather.sourceCapacityPolicy.reachPolicy, 'placement_frame_3d_distance');
  assert.deepEqual(waterGather.sourceCapacityPolicy.operands, [
    'mass',
    'cohesion',
    'phaseResistance',
    'distanceFalloff',
  ]);
  assert.equal(waterGather.sourceCapacityPolicy.downstreamHandoff, true);
  assert.equal(
    waterGather.sourceCapacityPolicy.depletionPolicy,
    'finite_scene_sources_deplete_only_when_actually_gathered',
  );
  assert.equal(waterGather.sourceCapacityPolicy.requiredAmount, waterGather.requiredAmount);
  assert.equal(waterGather.sourceCapacityPolicy.acquisitionCapacity, waterGather.acquisitionCapacity);
  assert.equal(waterGather.sourceCapacityPolicy.pullCapacity, waterGather.pullCapacity);
  assert.equal(waterGather.requiredAmount, 6);
  assert.equal(waterGather.acquisitionCapacity, 12);
  assert.equal(waterGather.acquiredAmount, 12);
  assert.equal(waterGather.sourceSpendPolicy, 'deplete_finite_sources_for_gather_handoff');
  assert.deepEqual(waterGather.sourceSpends, [
    {
      sourceId: 'source:water:near',
      spendAmount: 12,
      materialFamily: 'water',
      materialState: 'liquid',
      policy: 'deplete_finite_source_on_gather_handoff',
    },
  ]);
  assert.equal(waterGather.matches[0].spendsSourceAmount, true);
  assert.equal(waterGather.matches[0].spendAmount, 12);
  const gatherMotion = intentsOf(success, 'physics_motion').find(
    (intent) => intent.sourceAcquisitionId === waterGather.id,
  );
  assert.ok(gatherMotion);
  assert.equal(gatherMotion.motionKind, 'resource_intake_to_spell_origin');
  assert.equal(gatherMotion.conservationPolicy, 'no_creation_selected_source_budget');
  assert.equal(gatherMotion.feedsDownstream, true);
  assert.equal(gatherMotion.reservoirPreviewOnly, true);
  assert.deepEqual(gatherMotion.fromPosition, { x: 1, y: 0.18, z: 0 });
  assert.deepEqual(gatherMotion.toPosition, { x: 0, y: 0.16, z: 0 });

  const failure = interpretFixture('gather-multi-domain.json', {
    sources: [
      createSceneSource({
        id: 'source:ice:heavy',
        kind: 'ice',
        materialState: 'ice',
        amount: 80,
        mass: 100,
        position: { x: 1, y: 0, z: 0 },
      }),
    ],
    props: [],
  });
  const failedWaterGather = intentsOf(failure, 'source_acquisition').find(
    (intent) => intent.materialFamily === 'water',
  );
  assert.equal(failedWaterGather.satisfied, false);
  assert.match(failedWaterGather.reason, /pull capacity/i);
  assert.equal(failedWaterGather.rejectedCandidates[0].sourceId, 'source:ice:heavy');
  assert.equal(failedWaterGather.rejectedCandidates[0].reason, 'pull_capacity_below_difficulty');
  assert.equal(failedWaterGather.rejectedCandidates[0].compatibleFamily, true);
  assert.equal(failedWaterGather.rejectedCandidates[0].withinReach, true);
  assert.equal(failedWaterGather.rejectedCandidates[0].movable, true);
  assert.equal(
    failedWaterGather.rejectedCandidates[0].pullDifficulty >
      failedWaterGather.rejectedCandidates[0].pullCapacity,
    true,
  );
  assert.deepEqual(
    failedWaterGather.rejectedCandidates[0].pullDifficultyBreakdown.formula,
    'mass * cohesion * phaseResistance * distanceFalloff',
  );
  assert.equal(failedWaterGather.rejectedCandidates[0].pullDifficultyBreakdown.mass, 100);
  assert.equal(failedWaterGather.rejectedCandidates[0].pullDifficultyBreakdown.cohesion, 4);
  assert.equal(
    failedWaterGather.rejectedCandidates[0].pullDifficultyBreakdown.phaseResistance,
    2.4,
  );
  assert.equal(
    intentsOf(failure, 'physics_motion').some(
      (intent) => intent.sourceAcquisitionId === failedWaterGather.id,
    ),
    false,
  );
});

test('Gather failure reason considers only compatible candidates for reach diagnostics', () => {
  const result = interpretFixture('gather-multi-domain.json', {
    sources: [
      createSceneSource({
        id: 'source:fire:near',
        kind: 'fire',
        amount: 80,
        position: { x: 0.4, y: 0, z: 0 },
      }),
      createSceneSource({
        id: 'source:water:far',
        kind: 'water',
        amount: 80,
        position: { x: 20, y: 0, z: 0 },
      }),
    ],
    props: [],
  });

  const gather = intentsOf(result, 'source_acquisition').find(
    (intent) => intent.sourceMode === 'gather_active' && intent.materialFamily === 'water',
  );

  assert.ok(gather);
  assert.equal(gather.satisfied, false);
  assert.match(gather.reason, /outside gather_active reach/i);
  assert.deepEqual(
    gather.rejectedCandidates.map((candidate) => [candidate.sourceId, candidate.reason]),
    [
      ['source:fire:near', 'incompatible_material_family'],
      ['source:water:far', 'outside_reach'],
    ],
  );
});

test('Gather spends finite capacity on nearest reachable material before farther sources', () => {
  const compiled = compileSpell({
    title: 'Gather nearest water first',
    seals: [
      {
        sigils: [{ name: 'water' }],
        rings: [{ radius: 100 }],
        signProfiles: [
          { kind: 'gather', amount: 2, size: 200, rotation: 0, angle: 180, radius: 70 },
          { kind: 'column', amount: 4, size: 200, rotation: 0, angle: 0, radius: 80 },
        ],
      },
    ],
  });
  const result = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: {
      sources: [
        createSceneSource({
          id: 'source:water:far',
          kind: 'water',
          amount: 12,
          position: { x: 2.2, y: 0, z: 0 },
        }),
        createSceneSource({
          id: 'source:water:near',
          kind: 'water',
          amount: 4,
          position: { x: 0.4, y: 0, z: 0 },
        }),
      ],
      props: [],
    },
  });
  const gather = intentsOf(result, 'source_acquisition').find(
    (intent) => intent.sourceMode === 'gather_active',
  );
  assert.ok(gather);
  assert.equal(gather.satisfied, true);
  assert.equal(gather.sourceSelectionOrder, 'nearest_reachable_lowest_difficulty_first');
  assert.deepEqual(
    gather.matches.map((match) => [match.sourceId, match.acquiredAmount, match.spendAmount]),
    [
      ['source:water:near', 4, 4],
      ['source:water:far', 8, 8],
    ],
  );
  assert.deepEqual(
    gather.sourceSpends.map((spend) => [spend.sourceId, spend.spendAmount]),
    [
      ['source:water:near', 4],
      ['source:water:far', 8],
    ],
  );
  assert.equal(gather.matches[0].distance < gather.matches[1].distance, true);
});

test('multiple Gather operators share one finite source allocation ledger', () => {
  const gatherSeal = {
    rings: [{ radius: 100 }],
    sigils: [{ name: 'water' }],
    signProfiles: [{ kind: 'gather', amount: 1, radius: 80, size: 200 }],
  };
  const compiled = compileSpell({
    title: 'Two gathers, one reservoir',
    seals: [gatherSeal, structuredClone(gatherSeal)],
  });
  const result = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: {
      sources: [
        createSceneSource({
          id: 'source:finite-water',
          kind: 'water',
          amount: 10,
          capacity: 10,
          mass: 0.1,
          cohesion: 0.1,
          phaseResistance: 0.1,
          position: { x: 0, y: 0, z: 0 },
        }),
      ],
      props: [],
    },
  });
  const acquisitions = intentsOf(result, 'source_acquisition').filter(
    (intent) => intent.sourceMode === 'gather_active',
  );
  assert.equal(acquisitions.length, 2);
  assert.deepEqual(acquisitions.map((intent) => intent.acquiredAmount), [10, 0]);
  assert.equal(acquisitions[0].satisfied, true);
  assert.equal(acquisitions[1].satisfied, false);
  const totalSpend = acquisitions
    .flatMap((intent) => intent.sourceSpends)
    .reduce((sum, spend) => sum + spend.spendAmount, 0);
  assert.equal(totalSpend, 10);
});

test('inactive Gather reports candidates without acquiring or spending source material', () => {
  const compiled = compileSpell({
    title: 'Inactive gather preview',
    seals: [
      {
        sigils: [{ name: 'water' }],
        rings: [{ radius: 100 }],
        signProfiles: [
          { kind: 'gather', amount: 2, size: 200, rotation: 0, angle: 180, radius: 70 },
          { kind: 'column', amount: 4, size: 200, rotation: 0, angle: 0, radius: 80 },
        ],
      },
    ],
  });
  const ended = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: {
      sources: [
        createSceneSource({
          id: 'source:water:ready',
          kind: 'water',
          amount: 80,
          position: { x: 0.8, y: 0, z: 0 },
        }),
      ],
      props: [],
    },
    options: { activation: { elapsedMs: 2500, durationMs: 2000 } },
  });

  const gather = intentsOf(ended, 'source_acquisition').find(
    (intent) => intent.sourceMode === 'gather_active',
  );
  assert.ok(gather);
  assert.equal(gather.active, false);
  assert.equal(gather.reason, 'ended');
  assert.equal(gather.satisfied, false);
  assert.equal(gather.acquiredAmount, 0);
  assert.equal(gather.feedsDownstream, false);
  assert.equal(gather.sourceSpendPolicy, 'no_source_depletion');
  assert.deepEqual(gather.sourceSpends, []);
  assert.equal(gather.matches[0].sourceId, 'source:water:ready');
  assert.equal(gather.matches[0].selected, false);
  assert.equal(gather.matches[0].acquiredAmount, 0);
  assert.equal(gather.matches[0].potentialAcquiredAmount, 12);
  assert.equal(gather.matches[0].spendsSourceAmount, false);
  assert.equal(gather.matches[0].spendAmount, 0);
  assert.equal(
    intentsOf(ended, 'physics_motion').some((intent) => intent.sourceAcquisitionId === gather.id),
    false,
  );
  const requirement = intentsOf(ended, 'source_requirement').find(
    (intent) => intent.operatorNodeId === gather.operatorNodeId,
  );
  assert.ok(requirement);
  assert.equal(requirement.active, false);
  assert.equal(requirement.reason, 'ended');
  const binding = intentsOf(ended, 'source_binding').find(
    (intent) => intent.operatorNodeId === gather.operatorNodeId,
  );
  assert.ok(binding);
  assert.equal(binding.active, false);
  assert.equal(binding.acquiredAmount, 0);
});

test('Gather-fed water outputs use actual acquired material as the source-limited budget', () => {
  const compiled = compileSpell({
    title: 'Gather-fed water column',
    seals: [
      {
        sigils: [{ name: 'water' }],
        rings: [{ radius: 100 }],
        signProfiles: [
          { kind: 'gather', amount: 2, size: 200, rotation: 0, angle: 180, radius: 70 },
          { kind: 'column', amount: 4, size: 200, rotation: 0, angle: 0, radius: 80 },
        ],
      },
    ],
  });

  const partial = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: {
      sources: [
        createSceneSource({
          id: 'source:water:small',
          kind: 'water',
          amount: 2,
          position: { x: 1, y: 0, z: 0 },
        }),
      ],
      props: [],
    },
  });

  const gather = intentsOf(partial, 'source_acquisition').find(
    (intent) => intent.sourceMode === 'gather_active',
  );
  assert.equal(gather.satisfied, false);
  assert.equal(gather.limited, true);
  assert.equal(gather.acquiredAmount, 2);
  assert.equal(gather.feedsDownstream, true);

  const column = intentsOf(partial, 'water_column')[0];
  assert.ok(column);
  assert.equal(column.active, true);
  assert.equal(column.degraded, true);
  assert.equal(column.reason, 'gather_source_limited_actual_material_below_required');
  assert.equal(column.materialOrigin, 'gather_supplied');
  assert.equal(column.sourceRequired, true);
  assert.equal(column.sourceFreeOrigin, false);
  assert.equal(column.sourcePolicy, 'gather_supplied_source_limited_actual_material');
  assert.equal(column.resourceBudget.budgetMode, 'source_limited_actual_material');
  assert.equal(column.resourceBudget.amount, 2);
  assert.equal(column.resourceBudget.requiredAmount, 6);
  assert.equal(column.resourceBudget.acquisitionCapacity, 12);
  assert.equal(column.resourceBudget.generatedGeometryBudget.amount > 2, true);
  assert.equal(column.resourceBudget.sourceLimited, true);
  assert.equal(column.resourceBudget.sourceSatisfied, false);
  assert.equal(
    column.resourceBudget.sourceLimitedReason,
    'gather_source_limited_actual_material_below_required',
  );
  assert.equal(column.emergence.anchors[0].budgetAmount, 2);
  assert.equal(column.noSilentMaterialCreation, true);

  const abundant = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: {
      sources: [
        createSceneSource({
          id: 'source:water:abundant',
          kind: 'water',
          amount: 80,
          position: { x: 1, y: 0, z: 0 },
        }),
      ],
      props: [],
    },
  });
  const abundantGather = intentsOf(abundant, 'source_acquisition').find(
    (intent) => intent.sourceMode === 'gather_active',
  );
  assert.equal(abundantGather.requiredAmount, 6);
  assert.equal(abundantGather.acquisitionCapacity, 12);
  assert.equal(abundantGather.acquiredAmount, 12);
  assert.equal(abundantGather.sourceBudgetLimited, false);
  const abundantColumn = intentsOf(abundant, 'water_column')[0];
  assert.equal(abundantColumn.active, true);
  assert.equal(abundantColumn.degraded, false);
  assert.equal(abundantColumn.resourceBudget.amount, 12);
  assert.equal(abundantColumn.resourceBudget.amount > abundantGather.requiredAmount, true);
  assert.equal(abundantColumn.resourceBudget.sourceSatisfied, true);
  assert.equal(abundantColumn.resourceBudget.sourceBudgetLimited, false);

  const missing = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
  });
  const missingColumn = intentsOf(missing, 'water_column')[0];
  assert.ok(missingColumn);
  assert.equal(missingColumn.active, false);
  assert.equal(missingColumn.degraded, true);
  assert.equal(missingColumn.materialOrigin, 'gather_required_missing');
  assert.equal(missingColumn.sourceRequired, true);
  assert.equal(missingColumn.sourcePolicy, 'gather_required_no_material_available');
  assert.equal(missingColumn.resourceBudget.amount, 0);
  assert.equal(missingColumn.resourceBudget.sourceLimited, true);
  assert.equal(missingColumn.noSilentMaterialCreation, true);
});

test('Gather handoff stays same-seal until explicit multi-ring storage rules exist', () => {
  const compiled = compileSpell({
    title: 'Separate gather and water column seals',
    seals: [
      {
        sigils: [{ name: 'water' }],
        rings: [{ radius: 100 }],
        signProfiles: [
          { kind: 'gather', amount: 2, size: 200, rotation: 0, angle: 0, radius: 70 },
        ],
      },
      {
        sigils: [{ name: 'water' }],
        rings: [{ radius: 100 }],
        signProfiles: [
          { kind: 'column', amount: 4, size: 200, rotation: 0, angle: 0, radius: 80 },
        ],
      },
    ],
  });

  const result = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
  });

  const gather = intentsOf(result, 'source_acquisition').find(
    (intent) => intent.sourceMode === 'gather_active',
  );
  assert.ok(gather);
  assert.equal(gather.sealKey, 'seal0');
  assert.equal(gather.satisfied, false);
  assert.equal(gather.downstreamHandoffScope, 'same_seal_phase1');
  assert.equal(
    gather.sourceContentPolicy.handoffPolicy,
    'actual_gathered_material_only_for_same_seal_water_earth_phase1',
  );

  const column = intentsOf(result, 'water_column')[0];
  assert.ok(column);
  assert.equal(column.active, true);
  assert.equal(column.degraded, false);
  assert.equal(column.materialOrigin, 'sigil_generated');
  assert.equal(column.sourceRequired, false);
  assert.equal(column.sourcePolicy, 'source_free_sigil_generation');
  assert.equal(column.sourceId, null);
  assert.equal(column.sourceRequirementId, null);
  assert.equal(column.sourceBindingId, null);
  assert.equal(column.sourceHandoffScope, 'none');
  assert.equal(column.ignoredSourceHandoff.reason, 'multi_ring_gather_handoff_requires_explicit_future_rule');
  assert.equal(column.ignoredSourceHandoff.policy, 'same_seal_phase1');
  assert.equal(column.ignoredSourceHandoff.sealKey, 'seal0');
  assert.equal(column.resourceBudget.budgetMode, 'geometry_derived_finite');
  assert.notEqual(column.resourceBudget.sourceLimited, true);
  assert.equal(column.noSilentMaterialCreation, true);
});

test('Gather-fed water columns preserve ice source state until a transform changes it', () => {
  const compiled = compileSpell({
    title: 'Gather-fed ice column',
    seals: [
      {
        sigils: [{ name: 'water' }],
        rings: [{ radius: 100 }],
        signProfiles: [
          { kind: 'gather', amount: 2, size: 200, rotation: 0, angle: 180, radius: 70 },
          { kind: 'column', amount: 4, size: 200, rotation: 0, angle: 0, radius: 80 },
        ],
      },
    ],
  });

  const result = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: {
      sources: [
        createSceneSource({
          id: 'source:ice:near',
          kind: 'ice',
          materialState: 'ice',
          amount: 40,
          mass: 0.4,
          cohesion: 0.2,
          phaseResistance: 0.35,
          position: { x: 1, y: 0, z: 0 },
        }),
      ],
      props: [],
    },
  });

  const column = intentsOf(result, 'water_column')[0];
  assert.ok(column);
  assert.equal(column.active, true);
  assert.equal(column.materialOrigin, 'gather_supplied');
  assert.equal(column.materialState, 'ice');
  assert.equal(column.phase, 'ice');
  assert.equal(column.renderPreset, 'ice_chunk');
  assert.equal(column.sourceId, 'source:ice:near');
  assert.equal(column.sourceMaterialState, 'ice');
  assert.equal(column.sourceCandidateKind, 'ice');
  assert.equal(column.sourceMaterialFamily, 'water');
  assert.equal(column.gatheredMaterialPreserved, true);
  assert.equal(
    column.sourceMaterialHandoffPolicy,
    'preserve_actual_gathered_material_state_until_transform',
  );
  assert.equal(column.noSilentMaterialCreation, true);
});

test('Gather-fed dispersion also uses actual gathered material instead of generated spread power', () => {
  const compiled = compileSpell({
    title: 'Gather-fed outward water dispersion',
    seals: [
      {
        sigils: [{ name: 'water' }],
        rings: [{ radius: 100 }],
        signProfiles: [
          { kind: 'gather', amount: 2, size: 200, rotation: 0, angle: 0, radius: 70 },
          { kind: 'column', amount: 4, size: 200, rotation: 0, angle: 180, radius: 80 },
        ],
      },
    ],
  });

  const result = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: {
      sources: [
        createSceneSource({
          id: 'source:water:mist',
          kind: 'mist',
          materialState: 'mist_cloud',
          amount: 3,
          position: { x: 1, y: 0, z: 0 },
        }),
      ],
      props: [],
    },
  });

  const dispersion = intentsOf(result, 'water_dispersion')[0];
  assert.ok(dispersion);
  assert.equal(dispersion.materialOrigin, 'gather_supplied');
  assert.equal(dispersion.materialState, 'mist_cloud');
  assert.equal(dispersion.phase, 'mist_cloud');
  assert.equal(dispersion.renderPreset, 'mist_cloud');
  assert.equal(dispersion.sourceId, 'source:water:mist');
  assert.equal(dispersion.sourceMaterialState, 'mist_cloud');
  assert.equal(dispersion.sourceCandidateKind, 'mist');
  assert.equal(dispersion.sourceMaterialFamily, 'water');
  assert.equal(dispersion.gatheredMaterialPreserved, true);
  assert.equal(
    dispersion.sourceMaterialHandoffPolicy,
    'preserve_actual_gathered_material_state_until_transform',
  );
  assert.equal(dispersion.sourceRequired, true);
  assert.equal(dispersion.sourcePolicy, 'gather_supplied_source_limited_actual_material');
  assert.equal(dispersion.resourceBudget.budgetMode, 'source_limited_actual_material');
  assert.equal(dispersion.resourceBudget.amount, 3);
  assert.equal(dispersion.resourceBudget.requiredAmount, 6);
  assert.equal(dispersion.resourceBudget.acquisitionCapacity, 12);
  assert.equal(dispersion.resourceBudget.sourceBudgetLimited, true);
  assert.equal(dispersion.resourceBudget.outputShape, 'dispersion');
  assert.equal(
    dispersion.resourceBudget.generatedGeometryBudget.budgetPolicy,
    'finite_column_equivalent_no_spread_power_gain',
  );
  assert.equal(dispersion.emergence.anchors[0].budgetAmount, 3);
});

test('Convergence compression metadata attaches to active dispersion fields only', () => {
  const compiled = compileSpell({
    title: 'Converged outward water dispersion',
    seals: [
      {
        sigils: [{ name: 'water' }],
        rings: [{ radius: 100 }],
        signProfiles: [
          { kind: 'column', amount: 4, size: 200, rotation: 0, angle: 180, radius: 80 },
          { kind: 'convergence', amount: 2, size: 200, rotation: 0, angle: 0, radius: 70 },
        ],
      },
    ],
  });
  const active = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
  });
  const field = intentsOf(active, 'field_modification')[0];
  const dispersion = intentsOf(active, 'water_dispersion')[0];
  assert.equal(field.active, true);
  assert.deepEqual(field.targetFieldPolicy.targetKinds, ['dispersion_output', 'field_lobe_output']);
  assert.equal(dispersion.active, true);
  assert.equal(dispersion.fieldModificationId, field.id);
  assert.equal(dispersion.convergenceMode, 'axis_compression');
  assert.equal(dispersion.compressedByConvergence, true);
  assert.equal(dispersion.fieldModification.compressesActiveField, true);
  assert.equal(dispersion.fieldModification.pullsMaterialTowardSigns, false);
  assert.equal(dispersion.compressionVisual.visualPreset, 'axis_ovalized_column');

  const ended = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
    options: { activation: { elapsedMs: 2500, durationMs: 2000 } },
  });
  const endedField = intentsOf(ended, 'field_modification')[0];
  const endedDispersion = intentsOf(ended, 'water_dispersion')[0];
  assert.equal(endedField.active, false);
  assert.equal(endedField.targetFieldPolicy.activeTargetField, false);
  assert.equal(endedDispersion.active, false);
  assert.equal(endedDispersion.fieldModificationId, null);
  assert.equal(endedDispersion.convergenceMode, null);
  assert.equal(endedDispersion.compressedByConvergence, false);
});

test('Collection checks sources but does not feed downstream generation', () => {
  const result = interpretFixture('collection-multi-domain.json', {
    sources: [
      createSceneSource({
        id: 'source:water:near',
        kind: 'water',
        amount: 10,
        position: { x: 1, y: 0, z: 0 },
      }),
      createSceneSource({
        id: 'source:fire:near',
        kind: 'fire',
        amount: 7,
        position: { x: 1, y: 0, z: 0 },
      }),
    ],
    props: [
      createSceneProp({
        id: 'prop:near',
        position: { x: 0.6, y: 0, z: 0.2 },
        mass: 1,
      }),
      createSceneProp({
        id: 'prop:near-2',
        position: { x: -0.4, y: 0, z: 0.2 },
        mass: 1,
        amount: 2,
      }),
    ],
  });
  const collection = intentsOf(result, 'source_acquisition').find(
    (intent) => intent.sourceMode === 'collect_nearby',
  );
  assert.ok(collection);
  assert.equal(collection.satisfied, true);
  assert.equal(collection.feedsDownstream, false);
  assert.equal(collection.collectionFeedsDownstream, false);
  assert.equal(collection.sourceSpendPolicy, 'no_source_depletion');
  assert.deepEqual(collection.sourceSpends, []);
  assert.equal(collection.sourceContentPolicy.policyId, 'collection_material_only_no_effect_clone');
  assert.equal(collection.sourceContentPolicy.collectsSpellEffects, false);
  assert.equal(collection.sourceContentPolicy.clonesActiveModifiers, false);
  assert.equal(
    collection.sourceContentPolicy.activeModifierOwnership,
    'preserve_original_spell_owner',
  );
  assert.equal(collection.sourceContentPolicy.effectTransferPolicy, 'material_only_no_effect_transfer');
  assert.equal(collection.sourceContentPolicy.downstreamHandoff, false);
  assert.equal(collection.sourceContentPolicy.handoffPolicy, 'no_downstream_handoff');
  assert.equal(collection.sourceSelectionRule, 'all_movable_reachable_within_pull_capacity');
  assert.equal(
    collection.candidateSelection,
    'all_material_families_movable_reachable_with_capacity_check',
  );
  assert.equal(
    collection.capacityPolicy,
    'collection_checks_mobility_reach_mass_cohesion_phase_distance',
  );
  assert.equal(collection.sourceCapacityPolicy.policyId, 'collection_area_capacity_check');
  assert.equal(collection.sourceCapacityPolicy.selectionRule, 'all_movable_reachable_within_pull_capacity');
  assert.equal(collection.sourceCapacityPolicy.downstreamHandoff, false);
  assert.equal(collection.sourceCapacityPolicy.depletionPolicy, 'no_source_depletion');
  assert.equal(collection.sourceCapacityPolicy.formula, 'mass * cohesion * phaseResistance * distanceFalloff');
  assert.equal(collection.sourceCapacityPolicy.comparator, 'pullDifficulty <= pullCapacity');
  assert.equal(collection.sourceCapacityPolicy.reachPolicy, 'placement_frame_3d_distance');
  assert.equal(collection.sourceSelectionOrder, 'scene_order_after_reach_mobility_capacity_filter');
  assert.deepEqual(
    collection.matches.map((match) => match.sourceId).sort(),
    ['prop:near', 'prop:near-2', 'source:fire:near', 'source:water:near'],
  );
  assert.equal(collection.acquiredAmount, 20);
  assert.equal(collection.acquiredAmount > collection.requiredAmount, true);
  assert.equal(collection.sourceBudgetLimited, false);
  const collectionMotion = intentsOf(result, 'physics_motion').find(
    (intent) => intent.sourceAcquisitionId === collection.id && intent.sourceId === 'prop:near',
  );
  assert.ok(collectionMotion);
  assert.equal(collectionMotion.motionKind, 'area_collection_to_spell_origin');
  assert.equal(collectionMotion.movesActualSceneObject, true);
  assert.equal(collectionMotion.feedsDownstream, false);
  assert.equal(
    intentsOf(result, 'physics_motion').filter(
      (intent) => intent.sourceAcquisitionId === collection.id,
    ).length,
    4,
  );
});

test('Collection rejects nearby movable objects that exceed pull capacity', () => {
  const result = interpretFixture('collection-multi-domain.json', {
    sources: [],
    props: [
      createSceneProp({
        id: 'prop:too-heavy',
        position: { x: 0.5, y: 0, z: 0.2 },
        mass: 1000,
        cohesion: 2,
        phaseResistance: 2,
      }),
    ],
  });

  const collection = intentsOf(result, 'source_acquisition').find(
    (intent) => intent.sourceMode === 'collect_nearby',
  );

  assert.ok(collection);
  assert.equal(collection.satisfied, false);
  assert.match(collection.reason, /pull capacity/i);
  assert.deepEqual(collection.matches, []);
  assert.equal(collection.rejectedCandidates[0].sourceId, 'prop:too-heavy');
  assert.equal(collection.rejectedCandidates[0].reason, 'pull_capacity_below_difficulty');
  assert.equal(collection.rejectedCandidates[0].compatibleFamily, true);
  assert.equal(collection.rejectedCandidates[0].withinReach, true);
  assert.equal(collection.rejectedCandidates[0].movable, true);
  assert.equal(collection.rejectedCandidates[0].canPull, false);
  assert.equal(
    collection.rejectedCandidates[0].pullDifficulty >
      collection.rejectedCandidates[0].pullCapacity,
    true,
  );
  assert.equal(
    intentsOf(result, 'physics_motion').some(
      (intent) => intent.sourceAcquisitionId === collection.id,
    ),
    false,
  );
});

test('Pull selects movable objects without creating material', () => {
  const result = interpretFixture('pull-angled-twist.json', {
    sources: [],
    props: [
      createSceneProp({
        id: 'prop:near-cube',
        position: { x: 1, y: 0, z: 0 },
        mass: 1,
      }),
    ],
  });
  const pull = intentsOf(result, 'source_acquisition').find(
    (intent) => intent.sourceMode === 'pull' && intent.materialFamily === 'wind',
  );
  assert.ok(pull);
  assert.equal(pull.satisfied, true);
  assert.equal(pull.creationAssumption, 'no_creation');
  assert.equal(pull.candidateSelection, 'compatible_material_or_object_in_field');
  assert.equal(pull.sourceContentPolicy.policyId, 'pull_push_existing_target_no_effect_clone');
  assert.equal(pull.sourceContentPolicy.collectsSpellEffects, false);
  assert.equal(pull.sourceContentPolicy.clonesActiveModifiers, false);
  assert.equal(pull.sourceContentPolicy.downstreamHandoff, false);
  assert.equal(pull.sourceContentPolicy.handoffPolicy, 'no_downstream_handoff');
  assert.equal(pull.sourceCapacityPolicy.policyId, 'pull_push_object_capacity_check');
  assert.equal(pull.sourceCapacityPolicy.selectionRule, 'compatible_material_or_object_in_field');
  assert.equal(pull.sourceCapacityPolicy.downstreamHandoff, false);
  assert.equal(pull.sourceCapacityPolicy.depletionPolicy, 'no_source_depletion');
  assert.equal(pull.sourceCapacityPolicy.comparator, 'pullDifficulty <= pullCapacity');
  assert.equal(pull.matches[0].sourceId, 'prop:near-cube');
  assert.equal(pull.matches[0].candidateType, 'prop');

  const motion = intentsOf(result, 'physics_motion').find(
    (intent) => intent.sourceAcquisitionId === pull.id,
  );
  assert.ok(motion);
  assert.equal(motion.motionKind, 'pull_field_motion');
  assert.equal(motion.movesActualSceneObject, true);
  assert.equal(motion.reservoirPreviewOnly, false);
  assert.deepEqual(motion.toPosition, { x: 0, y: 0.16, z: 0 });
  assert.equal(motion.physicsField.fieldShape, 'target_force');
  assert.equal(motion.physicsField.targetId, 'prop:near-cube');
  assert.equal(motion.physicsField.forceModel, 'bounded_pull_capacity');
  assert.ok(motion.physicsField.forceMagnitude > 0);
});

test('Pull physics motion exposes lifecycle progress and current object position', () => {
  const compiled = compileFixture('pull-angled-twist.json');
  const result = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: {
      sources: [],
      props: [
        createSceneProp({
          id: 'prop:near-cube',
          position: { x: 1, y: 0, z: 0 },
          mass: 1,
        }),
      ],
    },
    options: {
      activation: {
        active: true,
        mode: 'timed',
        elapsedMs: 1000,
        durationMs: 2000,
      },
    },
  });

  const motion = intentsOf(result, 'physics_motion').find(
    (intent) => intent.sourceId === 'prop:near-cube',
  );
  assert.ok(motion);
  assert.equal(motion.motionProgress, 0.5);
  assert.equal(motion.motionDurationMs, 2000);
  assert.equal(motion.motionTimingPolicy, 'lifecycle_elapsed_progress');
  assert.deepEqual(motion.currentObjectPosition, { x: 0.5, y: 0.08, z: 0 });
  assert.deepEqual(motion.currentPosition, { x: 0.5, y: 0.17, z: 0 });

  const continued = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: {
      sources: [],
      props: [
        createSceneProp({
          id: 'prop:near-cube',
          position: { x: 0.5, y: 0.08, z: 0 },
          mass: 1,
        }),
      ],
    },
    options: {
      activation: {
        active: true,
        mode: 'timed',
        elapsedMs: 1500,
        durationMs: 2000,
      },
      motionBaselines: {
        [motion.id]: { x: 1, y: 0, z: 0 },
      },
    },
  });
  const continuedMotion = intentsOf(continued, 'physics_motion').find(
    (intent) => intent.sourceId === 'prop:near-cube',
  );
  assert.ok(continuedMotion);
  assert.equal(continuedMotion.motionProgress, 0.75);
  assert.deepEqual(continuedMotion.baselinePosition, { x: 1, y: 0, z: 0 });
  assert.deepEqual(continuedMotion.currentObjectPosition, { x: 0.25, y: 0.12, z: 0 });
});

test('default practice tree exposes movable apple target without moving the tree', () => {
  const result = interpretFixture('pull-angled-twist.json', createDefaultSceneState());
  const pull = intentsOf(result, 'source_acquisition').find(
    (intent) => intent.sourceMode === 'pull' && intent.materialFamily === 'wind',
  );
  assert.ok(pull);
  const appleMatch = pull.matches.find((match) => match.sourceId === 'prop:tree-apple');
  assert.ok(appleMatch);
  assert.equal(appleMatch.candidateType, 'prop');
  assert.equal(appleMatch.visualKind, 'tree_apple');
  assert.equal(appleMatch.targetRole, 'movable_tree_pull_target');
  assert.equal(appleMatch.selected, true);

  const treeCandidate = pull.rejectedCandidates.find(
    (candidate) => candidate.sourceId === 'prop:practice-tree',
  );
  assert.ok(treeCandidate);
  assert.equal(treeCandidate.visualKind, 'tree_landmark');
  assert.equal(treeCandidate.targetRole, 'immovable_pull_landmark');
  assert.equal(treeCandidate.reason, 'immovable_candidate');
  assert.equal(treeCandidate.movable, false);

  const appleMotion = intentsOf(result, 'physics_motion').find(
    (intent) => intent.sourceId === 'prop:tree-apple',
  );
  assert.ok(appleMotion);
  assert.equal(appleMotion.motionKind, 'pull_field_motion');
  assert.equal(appleMotion.movesActualSceneObject, true);
});

test('Pull reach uses scene distance instead of flattening to the ground plane', () => {
  const result = interpretFixture('pull-angled-twist.json', {
    sources: [],
    props: [
      createSceneProp({
        id: 'prop:overhead-cube',
        position: { x: 0, y: 20, z: 0 },
        mass: 1,
      }),
    ],
  });
  const pull = intentsOf(result, 'source_acquisition').find(
    (intent) => intent.sourceMode === 'pull' && intent.materialFamily === 'wind',
  );
  assert.ok(pull);
  assert.equal(pull.satisfied, false);
  assert.match(pull.reason, /outside pull reach/);
  assert.equal(pull.rejectedCandidates[0].sourceId, 'prop:overhead-cube');
  assert.equal(pull.rejectedCandidates[0].reason, 'outside_reach');
  assert.equal(pull.rejectedCandidates[0].distancePolicy, 'placement_frame_3d_distance');
  assert.equal(pull.rejectedCandidates[0].distance > pull.rejectedCandidates[0].reach, true);
  assert.equal(
    intentsOf(result, 'physics_motion').some((intent) => intent.sourceAcquisitionId === pull.id),
    false,
  );
});

test('Pull motion targets the placement-frame normal on side surfaces', () => {
  const compiled = compileFixture('pull-angled-twist.json');
  const result = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: {
      sources: [],
      props: [
        createSceneProp({
          id: 'prop:side-cube',
          position: { x: 1, y: 0, z: 0 },
          mass: 1,
        }),
      ],
    },
    options: {
      placementFrame: {
        origin: { x: 0, y: 0, z: 0 },
        normal: { x: 1, y: 0, z: 0 },
        tangent: { x: 0, y: 0, z: 1 },
        placementMode: 'prop_surface',
        surfaceMode: 'prop-east',
      },
    },
  });
  const pull = intentsOf(result, 'source_acquisition').find(
    (intent) => intent.sourceMode === 'pull' && intent.materialFamily === 'wind',
  );
  assert.ok(pull);
  assert.equal(pull.satisfied, true);
  assert.equal(pull.matches[0].distancePolicy, 'placement_frame_3d_distance');

  const motion = intentsOf(result, 'physics_motion').find(
    (intent) => intent.sourceAcquisitionId === pull.id,
  );
  assert.ok(motion);
  assert.deepEqual(motion.fromPosition, { x: 1.18, y: 0, z: 0 });
  assert.deepEqual(motion.toPosition, { x: 0.16, y: 0, z: 0 });
  assert.equal(motion.distancePolicy, 'placement_frame_3d_distance');
});

test('Inverted Pull resolves as push motion away from the spell origin', () => {
  const result = interpretFixture('pull-inverted-push.json', {
    sources: [
      createSceneSource({
        id: 'source:water:near',
        kind: 'water',
        amount: 20,
        position: { x: 1, y: 0, z: 0 },
      }),
    ],
    props: [],
  });
  const push = intentsOf(result, 'source_acquisition').find(
    (intent) => intent.sourceMode === 'push',
  );
  assert.ok(push);
  assert.equal(push.satisfied, true);
  const motion = intentsOf(result, 'physics_motion').find(
    (intent) => intent.sourceAcquisitionId === push.id,
  );
  assert.ok(motion);
  assert.equal(motion.motionKind, 'push_field_motion');
  assert.equal(motion.toPosition.x > motion.fromPosition.x, true);
});

test('Pull fails closed when no compatible movable candidate exists', () => {
  const result = interpretFixture('pull-angled-twist.json', {
    sources: [],
    props: [
      createSceneProp({
        id: 'prop:immovable',
        position: { x: 1, y: 0, z: 0 },
        movable: false,
      }),
    ],
  });
  const pull = intentsOf(result, 'source_acquisition').find(
    (intent) => intent.sourceMode === 'pull',
  );
  assert.equal(pull.satisfied, false);
  assert.match(pull.reason, /immovable/i);
  assert.equal(pull.rejectedCandidates[0].reason, 'immovable_candidate');
  assert.equal(
    intentsOf(result, 'physics_motion').some((intent) => intent.sourceAcquisitionId === pull.id),
    false,
  );
});

test('activation lifecycle can enforce open outer rings and timed shutdown', () => {
  const compiled = compileFixture('spellmaker-water-heater.json');
  const enforced = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: {
      sources: [createSceneSource({ id: 'source:water:test', kind: 'water' })],
      props: [],
    },
    options: { activation: { enforceOuterRing: true } },
  });
  assert.equal(enforced.lifecycle.detectedOuterRingClosed, false);
  assert.equal(enforced.lifecycle.active, false);
  assert.equal(intentsOf(enforced, 'thermal_material_state')[0].active, false);

  const watershot = compileFixture('watershot-centered.json');
  const ended = interpretCompiledSpell({
    graph: watershot.graph,
    program: watershot.program,
    diagnostics: watershot.diagnostics,
    sceneState: { sources: [], props: [] },
    options: { activation: { elapsedMs: 2500, durationMs: 2000 } },
  });
  assert.equal(ended.lifecycle.phase, 'ended');
  assert.equal(intentsOf(ended, 'water_column')[0].active, false);
  const cleanup = intentsOf(ended, 'lifecycle_cleanup')[0];
  assert.ok(cleanup);
  assert.equal(cleanup.leftover.renderPreset, 'pooled_water_leftover');
  assert.equal(cleanup.leftover.behavior, 'fall_and_pool');
  assert.equal(cleanup.leftover.remainsInWorld, true);
  assert.equal(cleanup.leftover.finite, true);
  assert.equal(cleanup.leftover.amount, cleanup.resourceBudget.amount);
  assert.equal(cleanup.leftover.units, cleanup.resourceBudget.units);
  assert.equal(cleanup.leftover.budgetPolicy, cleanup.resourceBudget.budgetPolicy);
  assert.equal(cleanup.cleanupPolicy.policyId, 'generated_water_falls_and_pools');
  assert.equal(cleanup.cleanupPolicy.behavior, 'fall_and_pool');
  assert.equal(cleanup.cleanupPolicy.remainsInWorld, true);
  assert.equal(cleanup.cleanupPolicy.generatedMaterialMayRemain, true);
  assert.equal(cleanup.cleanupPolicy.stopsActiveEffect, true);
  assert.equal(cleanup.cleanupPolicy.createsMaterial, true);
  assert.equal(cleanup.cleanupPolicy.outputShape, cleanup.resourceBudget.outputShape);
  assert.equal(cleanup.cleanupPolicy.outputShape, 'fluid_column_volume');
});

test('diagnostic-only Repetition symbols do not suppress non-Repetition cleanup', () => {
  const compiled = compileSpell({
    title: 'Diagnostic repetition with generated water',
    seals: [
      {
        sigils: [{ name: 'water' }],
        rings: [{ radius: 100 }],
        signProfiles: [
          { kind: 'column', amount: 2, size: 200, rotation: 0, angle: 0, radius: 80 },
          { kind: 'repetition', amount: 2, size: 200, rotation: 0, angle: 0, radius: 70 },
        ],
      },
    ],
  });
  const ended = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
    options: { activation: { elapsedMs: 2500, durationMs: 2000 } },
  });

  assert.equal(ended.lifecycle.phase, 'ended');
  assert.equal(ended.lifecycle.repetitionSymbolCount > 0, true);
  assert.equal(ended.lifecycle.activeRepetitionSymbolCount, 0);
  assert.equal(ended.lifecycle.repetition, false);
  assert.equal(ended.lifecycle.repetitionPolicy, 'diagnostic_only_no_lifecycle_extension');
  assert.equal(ended.lifecycle.nonRepetitionStopsActiveEffects, true);
  assert.equal(intentsOf(ended, 'water_column')[0].active, false);
  const cleanup = intentsOf(ended, 'lifecycle_cleanup')[0];
  assert.ok(cleanup);
  assert.equal(cleanup.nonRepetitionStopsActiveEffects, true);
  assert.equal(cleanup.leftover.renderPreset, 'pooled_water_leftover');
});

test('explicit outer ring override gates active spell effects', () => {
  const compiled = compileFixture('watershot-centered.json');
  const openRing = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
    options: { activation: { active: true, mode: 'held', outerRingClosed: false } },
  });
  assert.equal(openRing.lifecycle.phase, 'dormant_open_ring');
  assert.equal(openRing.lifecycle.active, false);
  assert.equal(openRing.lifecycle.requestedActive, true);
  assert.equal(openRing.lifecycle.outerRingClosed, false);
  assert.equal(intentsOf(openRing, 'water_column')[0].active, false);

  const closedRing = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
    options: { activation: { active: true, mode: 'held', outerRingClosed: true } },
  });
  assert.equal(closedRing.lifecycle.phase, 'active');
  assert.equal(closedRing.lifecycle.outerRingClosed, true);
  assert.equal(intentsOf(closedRing, 'water_column')[0].active, true);
});

test('partial outer ring completion stays dormant until mechanically complete', () => {
  const compiled = compileFixture('watershot-centered.json');
  const partial = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
    options: {
      activation: {
        active: true,
        mode: 'held',
        outerRingCompletion: 0.55,
      },
    },
  });
  const partialCircuit = intentsOf(partial, 'activation_circuit')[0];
  assert.equal(partial.lifecycle.phase, 'dormant_open_ring');
  assert.equal(partial.lifecycle.outerRingClosed, false);
  assert.equal(partial.lifecycle.outerRingCompletion, 0.55);
  assert.equal(partial.lifecycle.ringBreakAmount, 0.45);
  assert.equal(partial.lifecycle.activationCircuitState, 'incomplete');
  assert.equal(partialCircuit.completionPercent, 55);
  assert.equal(partialCircuit.circuitState, 'incomplete');
  assert.equal(partialCircuit.mechanicalCompletionReady, true);
  assert.equal(partialCircuit.interactionAffordance, 'complete_outer_ring');
  assert.equal(intentsOf(partial, 'water_column')[0].active, false);

  const complete = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
    options: {
      activation: {
        active: true,
        mode: 'held',
        outerRingCompletion: 1,
      },
    },
  });
  const completeCircuit = intentsOf(complete, 'activation_circuit')[0];
  assert.equal(complete.lifecycle.phase, 'active');
  assert.equal(complete.lifecycle.outerRingClosed, true);
  assert.equal(complete.lifecycle.outerRingCompletion, 1);
  assert.equal(completeCircuit.circuitState, 'complete');
  assert.equal(completeCircuit.interactionAffordance, 'break_outer_ring');
  assert.equal(intentsOf(complete, 'water_column')[0].active, true);
});

test('mechanical ring completer can close an otherwise open activation circuit', () => {
  const compiled = compileFixture('watershot-centered.json');
  const result = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
    options: {
      activation: {
        active: true,
        mode: 'held',
        outerRingCompletion: 0,
        mechanicalCompleters: [
          {
            id: 'activation-ring-key',
            propId: 'prop:activation-key',
            role: 'activation_ring_mechanical_key',
            completion: 1,
            distanceToGap: 0.04,
            keyPosition: { x: 0, y: 0, z: -2.25 },
            gapPosition: { x: 0, y: 0, z: -2.25 },
          },
        ],
      },
    },
  });
  const circuit = intentsOf(result, 'activation_circuit')[0];
  assert.equal(result.lifecycle.phase, 'active');
  assert.equal(result.lifecycle.outerRingClosed, true);
  assert.equal(result.lifecycle.outerRingCompletion, 1);
  assert.equal(result.lifecycle.mechanicalCompletion, 1);
  assert.equal(result.lifecycle.activationCompletionSource, 'mechanical_completer');
  assert.equal(circuit.completionSource, 'mechanical_completer');
  assert.equal(circuit.mechanicalCompleters[0].seated, true);
  assert.equal(circuit.mechanicalCompleters[0].propId, 'prop:activation-key');
  assert.equal(intentsOf(result, 'water_column')[0].active, true);
});

test('runtime exposes the fixed simulator effect phase order', () => {
  const result = interpretFixture('watershot-centered.json', { sources: [], props: [] });
  const order = intentsOf(result, 'effect_order_debug')[0];
  assert.ok(order);
  assert.deepEqual(
    order.fixedPhaseOrder.map((phase) => phase.phase),
    [
      'geometry_ring_ownership',
      'domains_sigils',
      'targeting_source_operators',
      'source_budget',
      'transforms_state_modifiers',
      'shape_output_operators',
      'region_emergence_placement',
      'physics_material_simulation',
      'lifecycle_cleanup_leftovers',
    ],
  );
  assert.equal(order.deterministic, true);
  assert.equal(order.regionDiscoveryPhase, 'targeting_source_operators');
  assert.equal(order.regionApplicationPhase, 'region_emergence_placement');
});

test('runtime intent stream follows fixed phase ordering for modifiers, outputs, physics, and cleanup', () => {
  const heater = interpretFixture('spellmaker-water-heater.json', {
    sources: [
      createSceneSource({
        id: 'source:water:near',
        kind: 'water',
        amount: 40,
        capacity: 100,
        position: { x: 0.5, y: 0, z: 0 },
      }),
    ],
    props: [],
  });
  assert.ok(
    firstIntentIndex(heater, 'material_state') <
      firstIntentIndex(heater, 'thermal_material_state'),
  );

  const converged = interpretFixture('convergence-point-focus-valid.json', {
    sources: [],
    props: [],
  });
  assert.ok(
    firstIntentIndex(converged, 'field_modification') <
      firstIntentIndex(converged, 'force_constraint_debug'),
  );

  const pulled = interpretFixture('pull-angled-twist.json', {
    sources: [],
    props: [
      createSceneProp({
        id: 'prop:near-cube',
        position: { x: 1, y: 0, z: 0 },
        mass: 1,
      }),
    ],
  });
  assert.ok(
    firstIntentIndex(pulled, 'source_acquisition') <
      firstIntentIndex(pulled, 'physics_motion'),
  );

  const watershot = compileFixture('watershot-centered.json');
  const ended = interpretCompiledSpell({
    graph: watershot.graph,
    program: watershot.program,
    diagnostics: watershot.diagnostics,
    sceneState: { sources: [], props: [] },
    options: { activation: { elapsedMs: 2500, durationMs: 2000 } },
  });
  assert.ok(firstIntentIndex(ended, 'water_column') < firstIntentIndex(ended, 'lifecycle_cleanup'));
  assert.ok(firstIntentIndex(ended, 'lifecycle_cleanup') < firstIntentIndex(ended, 'diagnostic_marker'));
});

test('runtime emits render-neutral effect lifecycle start update stop and dispose operations', () => {
  const compiled = compileFixture('watershot-centered.json');
  const first = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
    options: {
      activation: { elapsedMs: 0, durationMs: 2000 },
      effectLifecycle: { activeEffectIds: [], deltaMs: 0 },
    },
  });
  const firstOps = intentsOf(first, 'effect_lifecycle');
  const startedColumn = firstOps.find(
    (intent) => intent.sourceIntentType === 'water_column' && intent.operation === 'start',
  );
  assert.ok(startedColumn);
  assert.equal(startedColumn.renderNeutral, true);
  assert.equal(startedColumn.effectRuntimePhase, 'active_effect_runtime');
  assert.equal(startedColumn.elapsedMs, 0);

  const updated = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
    options: {
      activation: { elapsedMs: 250, durationMs: 2000 },
      effectLifecycle: {
        activeEffectIds: [startedColumn.sourceIntentId],
        deltaMs: 250,
      },
    },
  });
  const updatedColumn = intentsOf(updated, 'effect_lifecycle').find(
    (intent) =>
      intent.sourceIntentId === startedColumn.sourceIntentId &&
      intent.operation === 'update',
  );
  assert.ok(updatedColumn);
  assert.equal(updatedColumn.dtMs, 250);
  assert.equal(updatedColumn.elapsedMs, 250);

  const ended = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
    options: {
      activation: { elapsedMs: 2500, durationMs: 2000 },
      effectLifecycle: {
        activeEffectIds: [startedColumn.sourceIntentId],
        deltaMs: 250,
      },
    },
  });
  const endedOps = intentsOf(ended, 'effect_lifecycle').filter(
    (intent) => intent.sourceIntentId === startedColumn.sourceIntentId,
  );
  assert.deepEqual(
    endedOps.map((intent) => intent.operation),
    ['stop', 'dispose'],
  );
  assert.equal(endedOps[0].sourceIntentType, 'water_column');
  assert.equal(endedOps[0].leftover.renderPreset, 'pooled_water_leftover');
  assert.equal(endedOps[0].createsPersistentMaterial, true);
  assert.equal(endedOps[1].disposalPolicy, 'dispose_active_effect_keep_leftover');
  assert.ok(firstIntentIndex(ended, 'lifecycle_cleanup') < firstIntentIndex(ended, 'effect_lifecycle'));
  assert.ok(firstIntentIndex(ended, 'effect_lifecycle') < firstIntentIndex(ended, 'diagnostic_marker'));
});

test('surface placement frame uses local spell normal instead of world-up', () => {
  const compiled = compileFixture('watershot-centered.json');
  const result = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
    options: {
      placementFrame: {
        origin: { x: 1, y: 0, z: 0 },
        normal: { x: 1, y: 0, z: 0 },
        tangent: { x: 0, y: 0, z: 1 },
        placementMode: 'prop_surface',
        surfaceMode: 'prop-east',
        surfaceTargetId: 'prop:practice-cube',
        surfaceLabel: 'Practice cube east face',
      },
    },
  });
  const frame = intentsOf(result, 'placement_frame')[0];
  assert.deepEqual(frame.emergenceNormal, { x: 1, y: 0, z: 0 });
  assert.equal(frame.placementMode, 'prop_surface');
  assert.equal(frame.surfaceMode, 'prop-east');
  assert.equal(frame.surfaceTargetId, 'prop:practice-cube');
  const circle = intentsOf(result, 'spell_circle_render_data')[0];
  assert.deepEqual(circle.placementFrame.origin, { x: 1, y: 0, z: 0 });
  assert.deepEqual(circle.placementFrame.normal, { x: 1, y: 0, z: 0 });
  assert.equal(circle.placementMode, 'prop_surface');
  assert.equal(circle.surfaceTargetId, 'prop:practice-cube');

  const waterColumn = intentsOf(result, 'water_column')[0];
  assert.equal(waterColumn.originPolicy, 'spell_placement_frame_or_region_anchor');
  assert.equal(waterColumn.sourceFreeOrigin, true);
  assert.equal(waterColumn.sceneAxis.x > 0.9, true);
  assert.equal(Math.abs(waterColumn.sceneAxis.y) < 0.001, true);
  assert.equal(Math.abs(waterColumn.sceneAxis.z) < 0.001, true);
  assert.equal(Math.abs(waterColumn.origin.x - 1.22) < 0.001, true);
});

test('material states expose cheap hybrid presets without silent source creation', () => {
  const mist = interpretFixture('radial-water.json', { sources: [], props: [] });
  const mistState = intentsOf(mist, 'material_state').find(
    (intent) => intent.materialKind === 'mist',
  );
  assert.equal(mistState.materialFamily, 'water');
  assert.equal(mistState.phase, 'mist_cloud');
  assert.equal(mistState.noSilentCreation, true);
  assert.equal(mistState.sourceRequired, false);
  assert.equal(mistState.materialOrigin, 'sigil_generated_transform');

  const dust = interpretFixture('radial-earth.json', { sources: [], props: [] });
  const dustState = intentsOf(dust, 'material_state').find(
    (intent) => intent.materialKind === 'dust',
  );
  assert.equal(dustState.materialFamily, 'earth');
  assert.equal(dustState.phase, 'crushed_earth');
  assert.equal(dustState.renderPreset, 'crushed_earth');

  const light = interpretFixture('radial-light.json', { sources: [], props: [] });
  const glowState = intentsOf(light, 'material_state').find(
    (intent) => intent.materialKind === 'light' && intent.materialState === 'glow',
  );
  assert.equal(glowState.materialKind, 'light');
  assert.equal(glowState.materialFamily, 'light');
  assert.equal(glowState.materialState, 'glow');
  assert.equal(glowState.phase, 'glow');
  assert.equal(glowState.renderPreset, 'glow');
  assert.equal(glowState.thermalByDefault, false);
  assert.equal(glowState.attachment.targetKind, 'spell_local_glow_field');
  assert.equal(glowState.modifierLifecycle.stopsWithSpellLifecycle, true);
});

test('glow material state attaches to generated spell outputs for that effect lifetime', () => {
  const compiled = compileSpell({
    title: 'Glow Watershot',
    seals: [
      {
        sigils: [{ name: 'water' }],
        rings: [{ radius: 100 }],
        signProfiles: [
          {
            kind: 'column',
            amount: 4,
            size: 200,
            rotation: 0,
            angle: 0,
            radius: 80,
          },
        ],
      },
      {
        sigils: [{ name: 'light' }],
        rings: [{ radius: 80 }],
        signProfiles: [{ kind: 'radial', amount: 2, radius: 40, angle: 0 }],
      },
    ],
  });
  const result = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
  });
  const waterColumn = intentsOf(result, 'water_column')[0];
  const glowState = intentsOf(result, 'material_state').find(
    (intent) => intent.materialKind === 'light' && intent.materialState === 'glow',
  );
  assert.ok(waterColumn);
  assert.ok(glowState);
  assert.equal(glowState.attachment.targetKind, 'generated_spell_output');
  assert.deepEqual(glowState.attachment.targetNodeIds, waterColumn.collapsedNodeIds);
  assert.deepEqual(glowState.attachment.targetIntentTypes, [
    'water_column',
    'material_column',
    'water_dispersion',
    'material_dispersion',
  ]);
  assert.deepEqual(glowState.attachment.targetMaterialKinds, ['water']);
  assert.equal(glowState.attachment.durationPolicy, 'modified_effect_lifetime');
  assert.equal(glowState.modifierLifecycle.attachedToEffectLifetime, true);
  assert.equal(glowState.modifierLifecycle.stopsWithModifiedEffect, true);
});

test('Crosshair-targeted radial light glow attaches to compatible scene material in range', () => {
  const fixture = loadFixture('spellmaker-water-heater.json');
  fixture.name = 'Crosshair Glow Water';
  fixture.seals[0].signs = fixture.seals[0].signs.map((sign) =>
    sign.name === 'sigil_Fire' ? { ...sign, name: 'sigil_Light' } : sign,
  );
  const compiled = compileSpell(fixture);
  const sceneState = {
    sources: [
      createSceneSource({
        id: 'source:water:near',
        kind: 'water',
        amount: 40,
        capacity: 100,
        position: { x: 1, y: 0, z: 0 },
      }),
      createSceneSource({
        id: 'source:water:far',
        kind: 'water',
        amount: 40,
        capacity: 100,
        position: { x: 4, y: 0, z: 0 },
      }),
      createSceneSource({
        id: 'source:earth:near',
        kind: 'earth',
        amount: 40,
        capacity: 100,
        position: { x: 1, y: 0, z: 0 },
      }),
    ],
    props: [],
  };
  const result = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState,
  });

  const glowStates = intentsOf(result, 'material_state').filter(
    (intent) => intent.materialKind === 'light' && intent.materialState === 'glow',
  );
  assert.ok(glowStates.length > 0);
  for (const glowState of glowStates) {
    assert.equal(glowState.active, true);
    assert.equal(glowState.attachment.targetKind, 'targeted_scene_material');
    assert.equal(glowState.attachment.crosshairMode, 'crosshair_2');
    assert.deepEqual(glowState.attachment.targetMaterialKinds, ['water']);
    assert.deepEqual(glowState.attachment.targetIntentTypes, [
      'scene_source',
      'material_state',
    ]);
    assert.deepEqual(glowState.attachment.targetSourceIds, ['source:water:near']);
    assert.equal(glowState.attachment.targetSourceCount, 1);
    assert.equal(glowState.attachment.targetSources[0].distance, 1);
    assert.equal(glowState.modifierLifecycle.attachedToTargetedMaterial, true);
    assert.equal(glowState.modifierLifecycle.stopsWithModifiedEffect, true);
  }

  const ended = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState,
    options: { activation: { elapsedMs: 2500, durationMs: 2000 } },
  });
  const endedGlow = intentsOf(ended, 'material_state').find(
    (intent) => intent.materialKind === 'light' && intent.materialState === 'glow',
  );
  assert.ok(endedGlow);
  assert.equal(endedGlow.active, false);
  assert.equal(endedGlow.reason, 'ended');
  const cleanup = intentsOf(ended, 'modifier_cleanup').find(
    (intent) => intent.sourceIntentId === endedGlow.id,
  );
  assert.ok(cleanup);
  assert.equal(cleanup.attachment.targetKind, 'targeted_scene_material');
  assert.equal(
    cleanup.cleanup.behavior,
    'detach_modifier_from_targeted_material_without_leftover',
  );
  assert.equal(cleanup.cleanup.createsMaterial, false);
});

test('ended attached glow emits modifier cleanup without material leftover', () => {
  const compiled = compileSpell({
    title: 'Glow Watershot Ended',
    seals: [
      {
        sigils: [{ name: 'water' }],
        rings: [{ radius: 100 }],
        signProfiles: [
          {
            kind: 'column',
            amount: 4,
            size: 200,
            rotation: 0,
            angle: 0,
            radius: 80,
          },
        ],
      },
      {
        sigils: [{ name: 'light' }],
        rings: [{ radius: 80 }],
        signProfiles: [{ kind: 'radial', amount: 2, radius: 40, angle: 0 }],
      },
    ],
  });
  const result = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
    options: { activation: { elapsedMs: 2500, durationMs: 2000 } },
  });

  const glowState = intentsOf(result, 'material_state').find(
    (intent) => intent.materialKind === 'light' && intent.materialState === 'glow',
  );
  assert.ok(glowState);
  assert.equal(glowState.active, false);
  assert.equal(glowState.attachment.targetKind, 'generated_spell_output');

  const cleanup = intentsOf(result, 'modifier_cleanup').find(
    (intent) => intent.sourceIntentId === glowState.id,
  );
  assert.ok(cleanup);
  assert.equal(cleanup.lifecyclePhase, 'ended');
  assert.equal(cleanup.attachment.targetKind, 'generated_spell_output');
  assert.equal(
    cleanup.cleanup.behavior,
    'detach_modifier_from_modified_effect_without_leftover',
  );
  assert.equal(cleanup.cleanup.remainsInWorld, false);
  assert.equal(cleanup.cleanup.createsMaterial, false);
  assert.equal(cleanup.cleanup.sourceRequired, false);
  assert.equal(
    intentsOf(result, 'lifecycle_cleanup').some(
      (intent) => intent.sourceIntentId === glowState.id,
    ),
    false,
  );
});

test('outward dispersion emits finite source-free runtime output without extra budget from spread', () => {
  const result = interpretFixture('outward-column-water.json', { sources: [], props: [] });
  const dispersion = intentsOf(result, 'water_dispersion')[0];
  assert.ok(dispersion);
  assert.equal(dispersion.materialKind, 'water');
  assert.equal(dispersion.materialFamily, 'water');
  assert.equal(dispersion.materialState, 'sheet');
  assert.equal(dispersion.phase, 'falling_sheet');
  assert.equal(dispersion.renderPreset, 'water_sheet_dispersion');
  assert.equal(dispersion.dispersionBehavior, 'outward_water_sheet_with_gravity_falloff');
  assert.equal(dispersion.outputProfile.shape, 'thin_falling_sheet');
  assert.equal(dispersion.outputProfile.gravityAffected, true);
  assert.equal(dispersion.gravityBehavior.mode, 'sheet_continues_then_falls');
  assert.equal(dispersion.dispersionGeometry.directionalBasis, 'dispersion_sign_position_not_column_push');
  assert.equal(dispersion.interactionPolicy.heat, 'none');
  assert.equal(dispersion.interactionPolicy.force, 'deferred_to_physics_phase');
  assert.equal(dispersion.interactionPolicy.movesObjectsImmediately, false);
  assert.equal(dispersion.interactionPolicy.materialOutput, 'generated_or_gathered_water_sheet');
  assert.equal(dispersion.materialOrigin, 'sigil_generated');
  assert.equal(dispersion.sourceRequired, false);
  assert.equal(dispersion.sourcePolicy, 'source_free_sigil_generation');
  assert.equal(dispersion.resourceBudget.finite, true);
  assert.equal(dispersion.resourceBudget.outputShape, 'dispersion');
  assert.equal(dispersion.resourceBudget.budgetPolicy, 'finite_column_equivalent_no_spread_power_gain');
  assert.equal(dispersion.sourceId, null);
  assert.equal(dispersion.emergence.budgetPolicy, 'weighted_split_no_power_gain');
  assert.equal(dispersion.collapsedNodeIds.length, 2);
});

test('explicit dispersion sign emits material dispersion semantics for non-water domains', () => {
  const input = loadFixture('dispersion-fire-explicit.json');
  input.seals[0].signProfiles[0].angle = 0;
  const compiled = compileSpell(input);
  const result = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
  });
  const dispersion = intentsOf(result, 'material_dispersion')[0];
  assert.ok(dispersion);
  assert.equal(dispersion.materialKind, 'fire');
  assert.equal(dispersion.materialFamily, 'fire');
  assert.equal(dispersion.phase, 'heat_plume');
  assert.equal(dispersion.renderPreset, 'fire_heat_dispersion');
  assert.equal(dispersion.dispersionBehavior, 'outward_heat_plume_warning_scoped_no_material_source');
  assert.equal(dispersion.sourcePolicy, 'source_free_sigil_generation');
  assert.equal(dispersion.resourceBudget.finite, true);
  assert.equal(dispersion.resourceBudget.outputShape, 'dispersion');
  assert.equal(dispersion.spread > 0.5, true);
  assert.equal(dispersion.dispersionGeometry.sourceAnchors.length, 4);
  assert.equal(
    dispersion.dispersionGeometry.sourceAnchorPolicy,
    'coverage_only_from_dispersion_sign_positions',
  );
  assert.deepEqual(dispersion.origin, { x: 0, y: 0.22, z: 0 });
  assert.deepEqual(dispersion.physicsField.origin, dispersion.origin);
  assert.notDeepEqual(
    dispersion.origin,
    dispersion.dispersionGeometry.sourceAnchors[0].scenePosition,
  );
});

test('inverted explicit dispersion resolves as a column output', () => {
  const result = interpretFixture('dispersion-fire-explicit.json', { sources: [], props: [] });
  const dispersion = intentsOf(result, 'material_dispersion')[0];
  const column = intentsOf(result, 'material_column')[0];
  assert.equal(dispersion, undefined);
  assert.ok(column);
  assert.equal(column.materialKind, 'fire');
  assert.equal(column.collapsedNodeIds.length, 1);
});

test('wind and light dispersion expose structured non-immediate force and heat policy', () => {
  const expectations = {
    wind: {
      phase: 'airflow',
      renderPreset: 'wind_air_dispersion',
      dispersionBehavior: 'outward_airflow_spray_force_deferred_to_physics',
      force: 'deferred_to_physics_phase',
      illumination: false,
      materialOutput: 'generated_airflow_dispersion',
    },
    light: {
      phase: 'diffuse_light',
      renderPreset: 'light_dispersion',
      dispersionBehavior: 'diffuse_light_fan_no_heat_or_force',
      force: 'none',
      illumination: true,
      materialOutput: 'generated_diffuse_light_fan',
    },
  };

  for (const [kind, expected] of Object.entries(expectations)) {
    const compiled = compileSpell({
      title: `${kind} dispersion policy`,
      seals: [
        {
          sigils: [{ name: kind }],
          rings: [{ radius: 100 }],
          signProfiles: [{ kind: 'dispersion', amount: 4, radius: 80 }],
        },
      ],
    });
    const result = interpretCompiledSpell({
      graph: compiled.graph,
      program: compiled.program,
      diagnostics: compiled.diagnostics,
      sceneState: { sources: [], props: [] },
    });

    const dispersion = intentsOf(result, 'material_dispersion')[0];
    assert.ok(dispersion, kind);
    assert.equal(dispersion.materialKind, kind);
    assert.equal(dispersion.phase, expected.phase);
    assert.equal(dispersion.renderPreset, expected.renderPreset);
    assert.equal(dispersion.dispersionBehavior, expected.dispersionBehavior);
    assert.equal(dispersion.interactionPolicy.heat, 'none');
    assert.equal(dispersion.interactionPolicy.force, expected.force);
    assert.equal(dispersion.interactionPolicy.movesObjectsImmediately, false);
    assert.equal(dispersion.interactionPolicy.illumination, expected.illumination);
    assert.equal(dispersion.interactionPolicy.materialOutput, expected.materialOutput);
    assert.equal(
      intentsOf(result, 'physics_motion').some((intent) => intent.materialKind === kind),
      false,
    );
  }
});

test('liquid water and crushed earth mix into mud only when source material exists', () => {
  const supplied = interpretFixture('mud-water-earth-mixture.json', {
    sources: [
      createSceneSource({
        id: 'source:water:mud',
        kind: 'water',
        amount: 80,
        capacity: 100,
      }),
    ],
    props: [],
  });
  const suppliedStates = intentsOf(supplied, 'material_state');
  const liquidWater = suppliedStates.find((intent) => intent.phase === 'liquid');
  const crushedEarth = suppliedStates.find((intent) => intent.phase === 'crushed_earth');
  const mud = suppliedStates.find((intent) => intent.materialKind === 'mud');
  assert.equal(liquidWater.active, true);
  assert.equal(liquidWater.sourceAvailable, true);
  assert.equal(crushedEarth.active, true);
  assert.ok(mud);
  assert.equal(mud.active, true);
  assert.equal(mud.materialFamily, 'mud');
  assert.equal(mud.phase, 'sludge');
  assert.equal(mud.renderPreset, 'mud_sludge');
  assert.equal(mud.materialOrigin, 'water_plus_crushed_earth_mixture');
  assert.deepEqual(mud.mixtureInputs, [liquidWater.id, crushedEarth.id]);
  assert.equal(mud.sourceId, 'source:water:mud');

  const missingWater = interpretFixture('mud-water-earth-mixture.json', {
    sources: [],
    props: [],
  });
  const missingStates = intentsOf(missingWater, 'material_state');
  const missingLiquidWater = missingStates.find((intent) => intent.phase === 'liquid');
  const missingMud = missingStates.find((intent) => intent.materialKind === 'mud');
  assert.equal(missingLiquidWater.active, false);
  assert.equal(missingLiquidWater.degraded, true);
  assert.equal(missingLiquidWater.sourceAvailable, false);
  assert.match(missingLiquidWater.reason, /No available water source/);
  assert.equal(missingMud, undefined);
});

test('gathered mist or cloud reverts to water only through cooling or convergence', () => {
  const mistSource = createSceneSource({
    id: 'source:mist:near',
    kind: 'water',
    label: 'Mist bank',
    materialState: 'mist_cloud',
    materialFamily: 'water',
    amount: 20,
    capacity: 20,
    mass: 0.4,
    cohesion: 0.2,
    phaseResistance: 0.25,
    position: { x: 1, y: 0, z: 0 },
  });

  const cooled = interpretFixture('gather-cool-mist-reversion.json', {
    sources: [mistSource],
    props: [],
  });
  const cooledGather = intentsOf(cooled, 'source_acquisition').find(
    (intent) => intent.sourceMode === 'gather_active',
  );
  assert.ok(cooledGather);
  assert.equal(cooledGather.materialCompatibilityPolicy.matching, 'broad_material_family');
  assert.equal(cooledGather.materialCompatibilityPolicy.exactPhaseRequired, false);
  assert.ok(cooledGather.materialCompatibilityPolicy.acceptedMaterialStates.includes('mist_cloud'));
  assert.equal(cooledGather.matches[0].materialState, 'mist_cloud');
  const cooledReversion = intentsOf(cooled, 'material_state').find(
    (intent) => intent.materialOrigin === 'gathered_mist_cloud_reversion',
  );
  assert.ok(cooledReversion);
  assert.equal(cooledReversion.active, true);
  assert.equal(cooledReversion.sourceId, 'source:mist:near');
  assert.equal(cooledReversion.materialKind, 'water');
  assert.equal(cooledReversion.phase, 'liquid');
  assert.equal(cooledReversion.renderPreset, 'water_liquid');
  assert.equal(cooledReversion.noSilentCreation, true);
  assert.equal(cooledReversion.reversion.fromMaterialState, 'mist_cloud');
  assert.deepEqual(
    cooledReversion.reversion.causes.map((cause) => cause.cause),
    ['cooling_condensation'],
  );

  const converged = interpretFixture('gather-convergence-mist-reversion.json', {
    sources: [mistSource],
    props: [],
  });
  const convergenceField = intentsOf(converged, 'field_modification')[0];
  assert.equal(convergenceField.active, true);
  assert.equal(convergenceField.fieldModification.compressesActiveField, true);
  assert.equal(convergenceField.targetFieldPolicy.activeSourceFlow, true);
  assert.deepEqual(convergenceField.targetFieldPolicy.targetKinds, ['gather_active_source_flow']);
  assert.deepEqual(convergenceField.targetFieldPolicy.activeTargetKinds, [
    'gather_active_source_flow',
  ]);
  assert.deepEqual(convergenceField.targetFieldPolicy.sourceGateBlockedTargetKinds, []);
  const convergedReversion = intentsOf(converged, 'material_state').find(
    (intent) => intent.materialOrigin === 'gathered_mist_cloud_reversion',
  );
  assert.ok(convergedReversion);
  assert.equal(convergedReversion.reversion.causes[0].cause, 'convergence_compression');
  assert.equal(convergedReversion.reversion.causes[0].convergenceMode, 'axis_compression');
  assert.equal(convergedReversion.reversion.causes[0].pullsMaterialTowardSigns, false);

  const liquidSource = createSceneSource({
    id: 'source:water:near',
    kind: 'water',
    materialState: 'liquid',
    amount: 20,
    capacity: 20,
    position: { x: 1, y: 0, z: 0 },
  });
  const alreadyLiquid = interpretFixture('gather-cool-mist-reversion.json', {
    sources: [liquidSource],
    props: [],
  });
  assert.equal(
    intentsOf(alreadyLiquid, 'material_state').find(
      (intent) => intent.materialOrigin === 'gathered_mist_cloud_reversion',
    ),
    undefined,
  );

  const missingMist = interpretFixture('gather-convergence-mist-reversion.json', {
    sources: [],
    props: [],
  });
  assert.equal(
    intentsOf(missingMist, 'material_state').find(
      (intent) => intent.materialOrigin === 'gathered_mist_cloud_reversion',
    ),
    undefined,
  );
});

test('earth, wind, and light columns become source-free generated material column intents', () => {
  const expectations = {
    earth: {
      phase: 'solid',
      renderPreset: 'earth_solid',
      columnBehavior: 'solid_pillar_emerges_from_spell_plane',
    },
    wind: {
      phase: 'airflow',
      renderPreset: 'wind_air_beam',
      columnBehavior: 'air_beam_force_deferred_to_physics',
    },
    light: {
      phase: 'beam',
      renderPreset: 'light_beam',
      columnBehavior: 'illumination_beam_no_heat_or_force',
    },
  };

  for (const [kind, expected] of Object.entries(expectations)) {
    const compiled = compileSpell({
      title: `${kind} column`,
      seals: [
        {
          sigils: [{ name: kind }],
          rings: [{ radius: 100 }],
          signProfiles: [
            {
              kind: 'column',
              amount: 4,
              size: 200,
              rotation: 0,
              angle: 0,
              radius: 80,
            },
          ],
        },
      ],
    });
    const result = interpretCompiledSpell({
      graph: compiled.graph,
      program: compiled.program,
      diagnostics: compiled.diagnostics,
      sceneState: { sources: [], props: [] },
    });

    const column = result.intents.find((item) =>
      ['water_column', 'material_column'].includes(item.intentType),
    );
    assert.ok(column, kind);
    assert.equal(column.materialKind, kind);
    assert.equal(column.materialFamily, kind);
    assert.equal(column.phase, expected.phase);
    assert.equal(column.renderPreset, expected.renderPreset);
    assert.equal(column.columnBehavior, expected.columnBehavior);
    assert.equal(column.interactionPolicy.movesObjectsImmediately, false);
    assert.equal(column.interactionPolicy.heat, 'none');
    assert.equal(column.materialOrigin, 'sigil_generated');
    assert.equal(column.sourceRequired, false);
    assert.equal(column.sourcePolicy, 'source_free_sigil_generation');
    assert.equal(column.resourceBudget.finite, true);
    assert.equal(column.sourceId, null);
  }
});

test('compiler emits ordered mass-scaled column field coefficients and keeps Earth special', () => {
  const expectations = {
    water: {
      fieldShape: 'column',
      forceMagnitude: 75.5086,
    },
    fire: {
      fieldShape: 'column',
      forceMagnitude: 45.3052,
    },
    wind: {
      fieldShape: 'column',
      forceMagnitude: 58.8967,
      force: 'deferred_to_physics_phase',
      illumination: false,
      materialOutput: 'generated_airflow_beam',
    },
    earth: {
      fieldShape: 'earth_emergence',
      forceMagnitude: 60.4069,
    },
    light: {
      fieldShape: 'column',
      forceMagnitude: 0,
      force: 'none',
      illumination: true,
      materialOutput: 'generated_illumination_beam',
    },
  };

  for (const [kind, expected] of Object.entries(expectations)) {
    const compiled = compileSpell({
      title: `${kind} interaction policy`,
      seals: [
        {
          sigils: [{ name: kind }],
          rings: [{ radius: 100 }],
          signProfiles: [{ kind: 'column', amount: 4, radius: 80 }],
        },
      ],
    });
    const result = interpretCompiledSpell({
      graph: compiled.graph,
      program: compiled.program,
      diagnostics: compiled.diagnostics,
      sceneState: { sources: [], props: [] },
    });

    const column = result.intents.find((item) =>
      ['water_column', 'material_column'].includes(item.intentType),
    );
    assert.equal(column.materialKind, kind);
    assert.equal(column.physicsField.fieldShape, expected.fieldShape);
    assert.equal(column.physicsField.forceMagnitude, expected.forceMagnitude);
    assert.deepEqual(column.physicsField.origin, column.origin);
    assert.deepEqual(column.physicsField.direction, column.sceneAxis);
    const visibleLength = Math.min(
      2.35,
      Math.max(0.9, column.magnitude * 0.34 * Math.max(0.35, column.signSizeScale) + 0.78),
    ) * column.columnHeightMultiplier * column.worldScale;
    assert.equal(column.physicsField.length, Number(visibleLength.toFixed(4)));
    assert.equal(column.physicsField.radius, 0.84);
    if (expected.force) assert.equal(column.interactionPolicy.force, expected.force);
    if (expected.illumination !== undefined) {
      assert.equal(column.interactionPolicy.illumination, expected.illumination);
    }
    if (expected.materialOutput) {
      assert.equal(column.interactionPolicy.materialOutput, expected.materialOutput);
    }
    assert.equal(
      intentsOf(result, 'physics_motion').some((intent) => intent.materialKind === kind),
      false,
    );
  }

  assert.ok(expectations.water.forceMagnitude > expectations.fire.forceMagnitude);
  assert.ok(expectations.wind.forceMagnitude > expectations.fire.forceMagnitude);
  assert.ok(
    Math.abs(expectations.wind.forceMagnitude / expectations.fire.forceMagnitude - 1.3) < 0.00001,
  );
});

test('compiler emits ordered weak dispersion fields, explicit zero Light, Water curtain, and weak Earth', () => {
  const fields = {};
  for (const kind of ['water', 'fire', 'wind', 'earth', 'light']) {
    const compiled = compileSpell({
      title: `${kind} dispersion physics contract`,
      seals: [{
        sigils: [{ name: kind }],
        rings: [{ radius: 100 }],
        signProfiles: [{ kind: 'dispersion', amount: 4, size: 200, radius: 80, angle: 0 }],
      }],
    });
    const result = interpretCompiledSpell({
      graph: compiled.graph,
      program: compiled.program,
      diagnostics: compiled.diagnostics,
      sceneState: { sources: [], props: [] },
    });
    const intent = result.intents.find((item) =>
      ['water_dispersion', 'material_dispersion'].includes(item.intentType),
    );
    assert.ok(intent, kind);
    fields[kind] = intent.physicsField;
  }

  assert.equal(fields.earth.fieldShape, 'dispersion');
  assert.equal(fields.light.fieldShape, 'dispersion');
  assert.equal(fields.light.forceMagnitude, 0);
  assert.equal(fields.water.forceMagnitude, 4.031);
  assert.equal(fields.fire.forceMagnitude, 2.4186);
  assert.equal(fields.wind.forceMagnitude, 3.1442);
  assert.equal(fields.earth.forceMagnitude, 1.2093);
  assert.equal(fields.water.curtain.forceMagnitude, 8.0619);
  assert.deepEqual(fields.water.curtain.direction, { x: 0, y: -1, z: 0 });
  assert.ok(fields.water.forceMagnitude > fields.fire.forceMagnitude);
  assert.ok(fields.wind.forceMagnitude > fields.fire.forceMagnitude);
  assert.ok(fields.fire.forceMagnitude > fields.earth.forceMagnitude);
  assert.ok(Math.abs(fields.wind.forceMagnitude / fields.fire.forceMagnitude - 1.3) < 0.0001);
  assert.ok(fields.water.curtain.forceMagnitude > fields.water.forceMagnitude);
  assert.ok(fields.water.curtain.forceMagnitude < 75.5086);
  assert.equal(fields.water.directionMode, 'radial_outward_in_spell_plane');
  assert.equal(fields.water.signAngles.length, 4);
});

test('Light keeps exact zero-force fields while exposing bounded lifecycle illumination metadata', () => {
  for (const shape of ['column', 'dispersion']) {
    const compiled = compileSpell({
      title: `Light ${shape} illumination contract`,
      seals: [{
        sigils: [{ name: 'light' }],
        rings: [{ radius: 100 }],
        signProfiles: [{ kind: shape, amount: 4, size: 200, radius: 80, angle: 0 }],
      }],
    });
    const placementFrame = {
      origin: { x: 2, y: 1, z: -3 },
      normal: { x: 0, y: -1, z: 0 },
      tangent: { x: 1, y: 0, z: 0 },
      bitangent: { x: 0, y: 0, z: -1 },
      worldScale: 1.5,
    };
    const active = interpretCompiledSpell({
      graph: compiled.graph,
      program: compiled.program,
      diagnostics: compiled.diagnostics,
      sceneState: { sources: [], props: [] },
      options: { placementFrame },
    });
    const output = active.intents.find((item) =>
      ['material_column', 'material_dispersion'].includes(item.intentType),
    );
    const illumination = intentsOf(active, 'illumination')[0];
    assert.ok(output, shape);
    assert.ok(illumination, shape);
    assert.equal(output.physicsField.forceMagnitude, 0);
    assert.equal(output.physicsField.active, true);
    assert.equal(illumination.active, true);
    assert.deepEqual(illumination.origin, output.origin);
    assert.deepEqual(illumination.normal, placementFrame.normal);
    assert.equal(illumination.worldScale, 1.5);
    assert.ok(illumination.reach > 0);
    assert.ok(illumination.reach <= 5.5);
    assert.ok(illumination.intensity > 0);
    assert.ok(illumination.intensity <= 1.8);
    assert.equal(illumination.noPhysicsForce, true);

    const inactive = interpretCompiledSpell({
      graph: compiled.graph,
      program: compiled.program,
      diagnostics: compiled.diagnostics,
      sceneState: { sources: [], props: [] },
      options: { placementFrame, activation: { active: false } },
    });
    assert.equal(intentsOf(inactive, 'illumination')[0].active, false);
    assert.equal(
      inactive.intents.find((item) =>
        ['material_column', 'material_dispersion'].includes(item.intentType),
      ).physicsField.forceMagnitude,
      0,
    );
  }

  const water = compileSpell({
    title: 'Water no local light',
    seals: [{ sigils: [{ name: 'water' }], rings: [{ radius: 100 }], signProfiles: [{ kind: 'column', amount: 1 }] }],
  });
  const waterResult = interpretCompiledSpell({
    graph: water.graph,
    program: water.program,
    diagnostics: water.diagnostics,
    sceneState: { sources: [], props: [] },
  });
  assert.deepEqual(intentsOf(waterResult, 'illumination'), []);
});

test('balanced earth column uses the spell local normal as a pillar axis', () => {
  const compiled = compileSpell({
    title: 'surface earth pillar',
    seals: [
      {
        sigils: [{ name: 'earth' }],
        rings: [{ radius: 100 }],
        signProfiles: [{ kind: 'column', amount: 4, radius: 80 }],
      },
    ],
  });
  const result = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
    options: {
      placementFrame: {
        origin: { x: 0, y: 0, z: 0 },
        normal: { x: 1, y: 0, z: 0 },
        tangent: { x: 0, y: 0, z: 1 },
      },
    },
  });

  const column = intentsOf(result, 'material_column')[0];
  assert.equal(column.materialKind, 'earth');
  assert.deepEqual(column.localAxis, { x: 0, y: 0, z: 1 });
  assert.equal(column.sceneAxis.x > 0.9, true);
  assert.equal(Math.abs(column.sceneAxis.y) < 0.001, true);
});

test('ended generated earth, wind, and light columns expose lifecycle cleanup semantics', () => {
  const expected = {
    earth: {
      renderPreset: 'earth_debris_leftover',
      behavior: 'crumble_to_debris',
      remainsInWorld: true,
      outputShape: 'solid_column_volume',
    },
    wind: {
      renderPreset: 'wind_ceased',
      behavior: 'cease_without_leftover',
      remainsInWorld: false,
      outputShape: 'airflow_column_volume',
    },
    light: {
      renderPreset: 'light_ceased',
      behavior: 'cease_without_leftover',
      remainsInWorld: false,
      outputShape: 'illumination_beam_volume',
    },
  };

  for (const [kind, leftover] of Object.entries(expected)) {
    const compiled = compileSpell({
      title: `${kind} ended column`,
      seals: [
        {
          sigils: [{ name: kind }],
          rings: [{ radius: 100 }],
          signProfiles: [{ kind: 'column', amount: 4, radius: 80 }],
        },
      ],
    });
    const result = interpretCompiledSpell({
      graph: compiled.graph,
      program: compiled.program,
      diagnostics: compiled.diagnostics,
      sceneState: { sources: [], props: [] },
      options: { activation: { elapsedMs: 2500, durationMs: 2000 } },
    });

    const cleanup = intentsOf(result, 'lifecycle_cleanup')[0];
    assert.ok(cleanup, kind);
    assert.equal(cleanup.leftover.materialKind, kind);
    assert.equal(cleanup.leftover.renderPreset, leftover.renderPreset);
    assert.equal(cleanup.leftover.behavior, leftover.behavior);
    assert.equal(cleanup.leftover.remainsInWorld, leftover.remainsInWorld);
    assert.equal(cleanup.leftover.finite, true);
    assert.equal(cleanup.leftover.amount, cleanup.resourceBudget.amount);
    assert.equal(cleanup.leftover.units, cleanup.resourceBudget.units);
    assert.equal(cleanup.leftover.budgetPolicy, cleanup.resourceBudget.budgetPolicy);
    assert.equal(cleanup.cleanupPolicy.behavior, leftover.behavior);
    assert.equal(cleanup.cleanupPolicy.remainsInWorld, leftover.remainsInWorld);
    assert.equal(cleanup.cleanupPolicy.stopsActiveEffect, true);
    assert.equal(cleanup.cleanupPolicy.outputShape, cleanup.resourceBudget.outputShape);
    assert.equal(cleanup.cleanupPolicy.outputShape, leftover.outputShape);
    assert.equal(cleanup.nonRepetitionStopsActiveEffects, true);
  }
});

test('placed spell world scale changes linear geometry and cubic generated volume', () => {
  const compiled = compileFixture('watershot-centered.json');
  const interpretAtScale = (worldScale) => interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
    options: {
      placementFrame: {
        origin: { x: 0, y: 0, z: 0 },
        normal: { x: 0, y: 1, z: 0 },
        tangent: { x: 1, y: 0, z: 0 },
        worldScale,
      },
    },
  });

  const base = interpretAtScale(1);
  const doubled = interpretAtScale(2);
  const baseColumn = intentsOf(base, 'water_column')[0];
  const doubledColumn = intentsOf(doubled, 'water_column')[0];
  const doubledFrame = intentsOf(doubled, 'placement_frame')[0];

  assert.equal(doubledFrame.worldScale, 2);
  assert.equal(doubledColumn.origin.y, baseColumn.origin.y * 2);
  assert.equal(doubledColumn.resourceBudget.columnRadius, baseColumn.resourceBudget.columnRadius * 2);
  assert.equal(doubledColumn.resourceBudget.columnDiameter, baseColumn.resourceBudget.columnDiameter * 2);
  assert.equal(doubledColumn.resourceBudget.columnHeight, baseColumn.resourceBudget.columnHeight * 2);
  assert.equal(doubledColumn.resourceBudget.amount, baseColumn.resourceBudget.amount * 8);
  assert.equal(doubledColumn.resourceBudget.placementScalePolicy, 'linear_world_geometry_cubic_generated_volume');
});

test('default timed activation lasts five seconds and placement scale is clamped', () => {
  const compiled = compileFixture('watershot-centered.json');
  const result = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
    options: {
      activation: { elapsedMs: 3000 },
      placementFrame: { worldScale: 12 },
    },
  });

  assert.equal(result.lifecycle.active, true);
  assert.equal(result.lifecycle.durationMs, 5000);
  assert.equal(result.lifecycle.remainingMs, 2000);
  assert.equal(intentsOf(result, 'placement_frame')[0].worldScale, 4);
});
