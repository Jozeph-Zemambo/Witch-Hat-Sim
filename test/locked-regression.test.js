/**
 * VAL-LOCK-001: Regression lock for frozen Radial/Crosshair/inward Watershot/levitation
 * and Crosshair Cool/Strengthen graph shapes. Fails if locked semantics drift.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compileSpell } from '../src/compiler/compile.js';

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
);

function loadFixture(name) {
  return JSON.parse(readFileSync(path.join(fixturesDir, name), 'utf8'));
}

/** @param {ReturnType<typeof compileSpell>} out */
function modifierEdges(out) {
  return (out.graph?.edges ?? []).filter((e) => e.edgeType === 'applies_modifier');
}

/** @param {ReturnType<typeof compileSpell>} out */
function energyEdges(out) {
  return (out.graph?.edges ?? []).filter((e) => e.edgeType === 'drives_specific_energy');
}

/** @param {object} graph */
function activeNodes(graph) {
  return graph.nodes.filter((n) => n.nodeType !== 'diagnostic_marker');
}

/** @param {object} graph */
function edgeKinds(graph) {
  return [...new Set(graph.edges.map((e) => e.edgeType))].sort();
}

/** @param {object} graph */
function nodeKindCounts(graph) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const n of graph.nodes) {
    counts[n.nodeType] = (counts[n.nodeType] ?? 0) + 1;
  }
  return counts;
}

// VAL-LOCK-001
test('VAL-LOCK-001: spellmaker-water-heater graph shape and crosshair heat semantics', () => {
  const out = compileSpell(loadFixture('spellmaker-water-heater.json'));
  const { graph } = out;

  assert.deepEqual(nodeKindCounts(graph), {
    diagnostic_marker: 2,
    domain: 1,
    material_preset: 1,
    modifier_source: 2,
    phase_state: 1,
    target_selector: 1,
    target: 1,
    temperature_driver: 2,
  });
  assert.deepEqual(edgeKinds(graph), [
    'binds_geometry',
    'contributes_vector',
    'crosses_phase_boundary',
    'degrades_to_warning',
    'drives_specific_energy',
    'filters_target',
    'weakens_to',
  ]);

  assert.equal(modifierEdges(out).length, 0);
  assert.equal(energyEdges(out).length, 1);

  const thermal = graph.nodes.find(
    (n) => n.nodeType === 'temperature_driver' && n.weakEffect === 'heat',
  );
  assert.ok(thermal);
  assert.equal(thermal.temperatureDriver.thermalEffect, 'warm');
  assert.equal(thermal.doesNotPhaseChangeByItself, true);
  const phase = graph.nodes.find((n) => n.nodeType === 'phase_state');
  assert.equal(phase?.targetMaterial, 'water');

  const target = graph.nodes.find((n) => n.nodeType === 'target');
  assert.ok(target);
  assert.equal(target.registryId, 'sign.crosshair');
  assert.deepEqual(target.targetedNodeIds, ['node.phase.water.seal0.0']);

  const seal = out.program.seals[0];
  const radials = seal.symbols.filter(
    (s) =>
      s.resolvedRegistryId === 'sign.radial' && s.objectId.startsWith('sign-instance:'),
  );
  assert.equal(radials.length, 4);
  for (const radial of radials) {
    assert.equal(radial.geometryAnalysis?.pointedAtRegistryId, 'sigil.fire');
  }
  assert.equal(
    seal.geometryAnalysis.radialPointing.countsBySigilId['sigil-instance:0'].registryId,
    'sigil.fire',
  );
  assert.equal(
    seal.geometryAnalysis.radialPointing.countsBySigilId['sigil-instance:0'].count,
    2,
  );

  assert.ok(
    graph.nodes.filter((n) => n.nodeType === 'temperature_driver' && n.weakEffect === 'heat')
      .length >= 1,
  );
  assert.equal(
    activeNodes(graph).filter((n) => n.nodeType === 'shape_field').length,
    0,
    'Water Heater crosshair path must not add a separate watershot shape_field node',
  );
});

test('VAL-LOCK-001: spellmaker-water-heater-strengthen hotter heat graph shape', () => {
  const out = compileSpell(loadFixture('spellmaker-water-heater-strengthen.json'));
  const { graph } = out;

  assert.deepEqual(nodeKindCounts(graph), {
    diagnostic_marker: 2,
    domain: 1,
    material_preset: 1,
    modifier_source: 2,
    phase_state: 1,
    target_selector: 1,
    target: 1,
    temperature_driver: 2,
  });
  assert.equal(modifierEdges(out).length, 0);
  assert.equal(energyEdges(out).length, 1);

  const thermal = graph.nodes.find(
    (n) => n.nodeType === 'temperature_driver' && n.weakEffect === 'heat' && n.strengthenApplied,
  );
  assert.ok(thermal);
  assert.equal(thermal.temperatureDriver.thermalEffect, 'warm');
  assert.equal(thermal.intensityKind, 'retained_heat');
  assert.equal(thermal.temperatureDriver.retentionGain > 0, true);
  assert.ok(graph.edges.some((e) => e.edgeType === 'stabilizes_state'));
});

test('VAL-LOCK-001: watershot centered inward column graph shape', () => {
  const out = compileSpell(loadFixture('watershot-centered.json'));
  const { graph } = out;

  assert.deepEqual(nodeKindCounts(graph), {
    diagnostic_marker: 1,
    domain: 1,
    field_lobe: 1,
    shape_field: 1,
    source_mode: 1,
  });
  assert.deepEqual(edgeKinds(graph), [
    'aggregates_into_lobe',
    'binds_geometry',
    'degrades_to_warning',
    'requires',
  ]);
  assert.equal(modifierEdges(out).length, 0);

  const col = graph.nodes.find((n) => n.nodeType === 'shape_field' && n.shape === 'column');
  assert.ok(col);
  assert.equal(col.registryId, 'sign.column');
  assert.equal(col.geometryBinding.centered, true);
  assert.equal(col.geometryBinding.biased, false);
  assert.equal(col.geometryBinding.symmetryClass, 'symmetric');
});

test('VAL-LOCK-001: watershot biased inward column preserves skewed_supported bias', () => {
  for (const name of ['watershot-biased.json', 'watershot-biased-single.json']) {
    const out = compileSpell(loadFixture(name));
    const col = out.graph.nodes.find(
      (n) => n.nodeType === 'shape_field' && n.shape === 'column',
    );
    assert.ok(col, name);
    assert.equal(col.geometryBinding.centered, false, name);
    assert.equal(col.geometryBinding.biased, true, name);
    assert.equal(col.geometryBinding.symmetryClass, 'skewed_supported', name);
    assert.deepEqual(edgeKinds(out.graph), [
      'aggregates_into_lobe',
      'binds_geometry',
      'degrades_to_warning',
      'requires',
    ]);
  }
});

test('VAL-LOCK-001: levitation fire balanced float force_constraint shape', () => {
  const out = compileSpell(loadFixture('levitation-fire-balanced.json'));
  const { graph } = out;

  assert.deepEqual(nodeKindCounts(graph), {
    diagnostic_marker: 1,
    domain: 1,
    force_constraint: 1,
  });
  assert.deepEqual(edgeKinds(graph), [
    'binds_geometry',
    'degrades_to_warning',
    'requires',
  ]);

  const fc = graph.nodes.find((n) => n.nodeType === 'force_constraint');
  assert.ok(fc);
  assert.equal(fc.registryId, 'sign.levitation');
  assert.equal(fc.forceKind, 'float');
  assert.equal(fc.continuousStream, false);
  assert.equal(fc.oneShotLaunch, false);
  assert.equal(fc.geometryBinding.centeredFloat, true);
  assert.equal(fc.heightFromSignLength, 240);
  assert.equal(out.program.seals[0].geometryAnalysis.levitation.balanced, true);
  assert.equal(out.program.seals[0].geometryAnalysis.levitation.launchVector, null);
  assert.equal(fc.motionMode, 'stable_hover');
  assert.equal(fc.verticalLift, 240);
});

test('VAL-LOCK-001: levitation fire launch one-shot vector metadata', () => {
  const out = compileSpell(loadFixture('levitation-fire-launch.json'));
  const fc = out.graph.nodes.find((n) => n.nodeType === 'force_constraint');
  assert.ok(fc);
  assert.equal(fc.forceKind, 'float');
  assert.equal(fc.oneShotLaunch, true);
  assert.equal(fc.continuousStream, false);
  assert.equal(fc.geometryBinding.centeredFloat, false);
  assert.ok(fc.geometryBinding.biasMagnitude > 0);

  const lev = out.program.seals[0].geometryAnalysis.levitation;
  assert.equal(lev.balanced, false);
  assert.ok(lev.launchVector);
  assert.equal(lev.oneShotLaunch, true);
});

test('VAL-LOCK-001: levitation wind stream continuous force_constraint', () => {
  const out = compileSpell(loadFixture('levitation-wind-stream.json'));
  const fc = out.graph.nodes.find((n) => n.nodeType === 'force_constraint');
  assert.ok(fc);
  assert.equal(fc.registryId, 'sign.levitation');
  assert.equal(fc.forceKind, 'wind_stream');
  assert.equal(fc.continuousStream, true);
  assert.equal(fc.oneShotLaunch, false);
  assert.equal(out.program.seals[0].geometryAnalysis.levitation.continuousStream, true);
});

test('VAL-LOCK-001: crosshair cool water state driver and target filter', () => {
  const out = compileSpell(loadFixture('crosshair-cool-water.json'));
  const { graph } = out;

  assert.deepEqual(nodeKindCounts(graph), {
    diagnostic_marker: 2,
    domain: 1,
    material_preset: 1,
    phase_state: 1,
    target_selector: 1,
    target: 1,
    temperature_driver: 1,
  });
  assert.deepEqual(edgeKinds(graph), [
    'binds_geometry',
    'crosses_phase_boundary',
    'degrades_to_warning',
    'drives_specific_energy',
    'filters_target',
    'weakens_to',
  ]);

  assert.equal(modifierEdges(out).length, 0);
  assert.equal(energyEdges(out).length, 1);

  const cold = graph.nodes.find(
    (n) => n.nodeType === 'temperature_driver' && n.weakEffect === 'cool',
  );
  assert.ok(cold);
  assert.equal(cold.temperatureDriver.thermalEffect, 'cool');
});

test('VAL-LOCK-001: crosshair cool plus strengthen freezing graph shape', () => {
  const out = compileSpell(loadFixture('crosshair-cool-water-freezing.json'));

  assert.equal(modifierEdges(out).length, 0);
  assert.equal(energyEdges(out).length, 1);

  const cold = out.graph.nodes.find(
    (n) => n.nodeType === 'temperature_driver' && n.weakEffect === 'cool',
  );
  assert.ok(cold);
  assert.equal(cold.temperatureDriver.thermalEffect, 'cool');
  assert.equal(cold.intensityKind, 'retained_cooling');
  assert.equal(cold.temperatureDriver.retentionGain > 0, true);
  assert.ok(out.graph.edges.some((e) => e.edgeType === 'stabilizes_state'));

  const phase = out.graph.nodes.find((n) => n.nodeType === 'phase_state');
  assert.ok(phase);
  assert.equal(phase.gradualPhaseChange, true);
});
