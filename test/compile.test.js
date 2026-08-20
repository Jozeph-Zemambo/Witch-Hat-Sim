/**
 * Effect graph, compile pipeline, CLI (VAL-GRAPH-001..005, VAL-CROSS-001..005).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compileSpell } from '../src/compiler/compile.js';
import packageJson from '../package.json' with { type: 'json' };

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
);
const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const compileCli = path.join(projectRoot, 'bin', 'compile.js');

function loadFixture(name) {
  return JSON.parse(readFileSync(path.join(fixturesDir, name), 'utf8'));
}

/** @param {ReturnType<typeof compileSpell>} compileOut */
function modifierEdges(compileOut) {
  return (compileOut.graph?.edges ?? []).filter((e) => e.edgeType === 'applies_modifier');
}

/** @param {ReturnType<typeof compileSpell>} compileOut */
function energyEdges(compileOut) {
  return (compileOut.graph?.edges ?? []).filter((e) => e.edgeType === 'drives_specific_energy');
}

// VAL-GRAPH-001
test('VAL-GRAPH-001: compile output JSON is byte-stable across identical runs', () => {
  const fixture = loadFixture('watershot-centered.json');
  const a = JSON.stringify(compileSpell(fixture));
  const b = JSON.stringify(compileSpell(fixture));
  assert.equal(a, b);
});

// VAL-GRAPH-002
test('VAL-GRAPH-002: compile result exposes program, graph, diagnostics, metadata', () => {
  const out = compileSpell(loadFixture('radial-fire.json'));
  assert.ok(out.program);
  assert.ok(out.graph);
  assert.ok(Array.isArray(out.graph.nodes));
  assert.ok(Array.isArray(out.graph.edges));
  assert.ok(Array.isArray(out.diagnostics));
  assert.ok(out.metadata);
  assert.equal(out.metadata.compilerCoreVersion, packageJson.version);

  const bad = compileSpell(loadFixture('crosshair-invalid.json'));
  assert.ok(bad.graph);
  assert.ok(Array.isArray(bad.diagnostics));
});

// VAL-GRAPH-003
test('VAL-GRAPH-003: graph nodes preserve registry bindings, provenance, and geometry', () => {
  const { graph } = compileSpell(loadFixture('watershot-centered.json'));
  const col = graph.nodes.find((n) => n.nodeType === 'shape_field' && n.shape === 'column');
  assert.ok(col);
  assert.equal(col.registryId, 'sign.column');
  assert.ok(Array.isArray(col.sourceObjects));
  assert.ok(col.sourceObjects.length > 0);
  assert.ok(col.geometryBinding);
  assert.ok(col.evidenceRefs?.length);
});

// VAL-GRAPH-004
test('VAL-GRAPH-004: diagnostics expose stable schema fields', () => {
  const { diagnostics } = compileSpell(loadFixture('radial-wind.json'));
  assert.ok(diagnostics.length > 0);
  for (const d of diagnostics) {
    assert.ok(typeof d.code === 'string');
    assert.ok(typeof d.status === 'string' || typeof d.severity === 'string');
    assert.ok('sourcePath' in d);
    assert.ok('message' in d);
    assert.ok('fallback' in d || 'conservativeFallback' in d);
  }
});

// VAL-GRAPH-005
test('VAL-GRAPH-005: CLI compiles fixture to parseable JSON without timestamps', () => {
  const fixturePath = path.join(fixturesDir, 'minimal-defaults.json');
  const res = spawnSync(process.execPath, [compileCli, fixturePath], {
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stderr);
  const parsed = JSON.parse(res.stdout);
  assert.ok(parsed.graph);
  const s = res.stdout;
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(s), 'no ISO timestamps in output');
});

// VAL-CROSS-001
test('VAL-CROSS-001: centered Watershot flows end-to-end to column shape graph nodes', () => {
  const { graph, diagnostics } = compileSpell(loadFixture('watershot-centered.json'));
  const col = graph.nodes.find((n) => n.nodeType === 'shape_field' && n.shape === 'column');
  assert.ok(col);
  assert.equal(col.geometryBinding.centered, true);
  assert.ok(diagnostics.some((d) => d.code === 'rules.compiled_with_warnings'));
});

// VAL-CROSS-002
test('VAL-CROSS-002: biased Watershot preserves bias in graph geometry bindings', () => {
  const { graph } = compileSpell(loadFixture('watershot-biased.json'));
  const col = graph.nodes.find((n) => n.nodeType === 'shape_field' && n.shape === 'column');
  assert.ok(col);
  assert.equal(col.geometryBinding.centered, false);
  assert.equal(col.geometryBinding.biased, true);
});

// VAL-CROSS-003
test('VAL-CROSS-003: radial fixtures map end-to-end (fire/water/earth/wind/light)', () => {
  const heat = compileSpell(loadFixture('radial-fire.json'));
  assert.ok(
    heat.graph.nodes.some(
      (n) => n.nodeType === 'temperature_driver' && n.registryId === 'subelement.heat',
    ),
  );

  const mist = compileSpell(loadFixture('radial-water.json'));
  assert.ok(
    mist.graph.nodes.some((n) => n.nodeType === 'material_transform' && n.toMaterial === 'mist'),
  );

  const dust = compileSpell(loadFixture('radial-earth.json'));
  assert.ok(
    dust.graph.nodes.some((n) => n.nodeType === 'material_transform' && n.toMaterial === 'dust'),
  );

  const glow = compileSpell(loadFixture('radial-light.json'));
  assert.ok(
    glow.graph.nodes.some(
      (n) => n.nodeType === 'luminous_modifier' && n.registryId === 'subelement.glow',
    ),
  );

  const wind = compileSpell(loadFixture('radial-wind.json'));
  assert.ok(
    !wind.graph.nodes.some(
      (n) => n.nodeType === 'material_transform' && n.fromDomain === 'sigil.wind',
    ),
  );
  assert.ok(wind.diagnostics.some((d) => d.code === 'rules.radial_wind_no_weak_form'));
});

// VAL-CROSS-004
test('VAL-CROSS-004: Water Heater flows to heated center water via applies_modifier', () => {
  const heater = compileSpell(loadFixture('spellmaker-water-heater.json'));
  const energy = energyEdges(heater);
  assert.equal(energy.length, 1);
  assert.ok(energy[0].fromNodeId.includes('temperature_driver.heat'));
  assert.ok(energy[0].toNodeId.includes('phase.water'));
  assert.equal(energy[0].binding?.centerRegistryId, 'sigil.water');

  const seal = heater.program.seals[0];
  const radials = seal.symbols.filter(
    (s) =>
      s.resolvedRegistryId === 'sign.radial' && s.objectId.startsWith('sign-instance:'),
  );
  assert.equal(radials.length, 4);
  for (const radial of radials) {
    assert.equal(radial.geometryAnalysis?.pointedAtRegistryId, 'sigil.fire');
  }

  const ok = compileSpell(loadFixture('crosshair-valid.json'));
  assert.equal(energyEdges(ok).length, 1);

  const bad = compileSpell(loadFixture('crosshair-invalid.json'));
  assert.equal(energyEdges(bad).length, 0);
  assert.ok(bad.diagnostics.some((d) => d.code === 'invalid_structure_for_symbol'));
});

test('VAL-CROSS-005: invisible imported symbols remain out of active compile semantics', () => {
  const hiddenColumn = compileSpell({
    title: 'Hidden column probe',
    seals: [
      {
        sigils: [{ name: 'sigil_Water' }],
        rings: [{ radius: 100 }],
        signProfiles: [{ kind: 'sign_Column', amount: 4, radius: 80, visible: false }],
      },
    ],
  });
  const hiddenColumnSeal = hiddenColumn.program.seals[0];
  const hiddenColumnInstances = hiddenColumnSeal.symbols.filter(
    (s) => s.resolvedRegistryId === 'sign.column' && s.objectId.startsWith('sign-instance:'),
  );
  assert.equal(hiddenColumnInstances.length, 4);
  assert.ok(hiddenColumnInstances.every((s) => s.semanticEligibility === 'visual_only'));
  assert.equal(
    hiddenColumnSeal.geometryAnalysis.signGroups.some((group) => group.registryId === 'sign.column'),
    false,
  );
  assert.equal(
    hiddenColumn.graph.nodes.some((n) => n.nodeType === 'shape_field' && n.shape === 'column'),
    false,
  );

  const hiddenWater = compileSpell({
    title: 'Hidden water probe',
    seals: [
      {
        sigils: [{ name: 'sigil_Water', hidden: true }],
        rings: [{ radius: 100 }],
        signProfiles: [{ kind: 'sign_Column', amount: 4, radius: 80 }],
      },
    ],
  });
  const hiddenWaterSeal = hiddenWater.program.seals[0];
  const water = hiddenWaterSeal.symbols.find((s) => s.resolvedRegistryId === 'sigil.water');
  assert.equal(water.semanticEligibility, 'visual_only');
  assert.equal(hiddenWaterSeal.geometryAnalysis.watershotColumn, null);
  assert.equal(
    hiddenWater.graph.nodes.some(
      (n) =>
        n.nodeType === 'shape_field' &&
        n.shape === 'column' &&
        n.domainRegistryId === 'sigil.water',
    ),
    false,
  );
});

test('Water Heater compile exposes applies_modifier heated-water graph branch', () => {
  const out = compileSpell(loadFixture('spellmaker-water-heater.json'));
  assert.ok(
    out.graph.nodes.some(
      (n) => n.nodeType === 'temperature_driver' && n.weakEffect === 'heat',
    ),
  );
  const phase = out.graph.nodes.find((n) => n.nodeType === 'phase_state');
  assert.ok(phase);
  assert.equal(phase.targetMaterial, 'water');
  assert.equal(phase.phase, 'liquid');
  assert.equal(phase.doesNotCreateMaterial, true);
  assert.ok(
    out.graph.edges.some(
      (e) => e.edgeType === 'drives_specific_energy' && e.toNodeId === phase.nodeId,
    ),
  );
  assert.ok(
    out.graph.edges.some(
      (e) =>
        e.edgeType === 'crosses_phase_boundary' &&
        e.fromNodeId === phase.nodeId &&
        e.phaseChange === 'suppressed_without_runtime_state',
    ),
  );
  const pointing = out.program.seals[0].geometryAnalysis.radialPointing;
  assert.equal(pointing.countsBySigilId['sigil-instance:0'].registryId, 'sigil.fire');
});

test('Crosshair cool sign applies cooling field to water center group', () => {
  const out = compileSpell(loadFixture('crosshair-cool-water.json'));
  assert.equal(energyEdges(out).length, 1);
  const driver = out.graph.nodes.find((n) => n.nodeType === 'temperature_driver');
  assert.ok(driver);
  assert.equal(driver.weakEffect, 'cool');
  assert.equal(driver.temperatureDriver.thermalEffect, 'cool');
  const phase = out.graph.nodes.find((n) => n.nodeType === 'phase_state');
  assert.equal(phase?.targetMaterial, 'water');
});

test('Crosshair cool+strengthen on modifier yields freezing field', () => {
  const out = compileSpell(loadFixture('crosshair-cool-water-freezing.json'));
  const driver = out.graph.nodes.find((n) => n.nodeType === 'temperature_driver');
  assert.ok(driver);
  assert.equal(driver.weakEffect, 'cool');
  assert.equal(driver.strengthenApplied, true);
  assert.equal(driver.temperatureDriver.thermalEffect, 'cool');
  assert.equal(driver.temperatureDriver.retentionGain > 0, true);
  assert.equal(
    out.graph.edges.some((e) => e.edgeType === 'stabilizes_state'),
    true,
  );
});

test('Water Heater with strengthen yields hotter heat modifier metadata', () => {
  const out = compileSpell(loadFixture('spellmaker-water-heater-strengthen.json'));
  const bound = out.graph.edges.find((e) => e.edgeType === 'drives_specific_energy');
  assert.ok(bound);
  const driver = out.graph.nodes.find((n) => n.nodeId === bound.fromNodeId);
  assert.ok(driver);
  assert.equal(driver.strengthenApplied, true);
  assert.equal(driver.intensityKind, 'retained_heat');
  assert.equal(driver.temperatureDriver.thermalEffect, 'warm');
  assert.equal(driver.temperatureDriver.retentionGain > 0, true);
  assert.equal(
    out.graph.edges.some((e) => e.edgeType === 'stabilizes_state'),
    true,
  );
});

test('cooling plus water material intake emits conservative condensation candidate', () => {
  const out = compileSpell({
    title: 'Crosshair cooling with collection source',
    seals: [
      {
        sigils: [{ name: 'sigil_Water' }],
        rings: [{ radius: 200 }],
        signProfiles: [
          { kind: 'crosshair', amount: 1, radius: 0 },
          { kind: 'collection', amount: 2, size: 200, rotation: 0, angle: 0, radius: 70 },
        ],
        signs: [
          {
            name: 'sigil_Earth',
            radius: 140,
            rotation: 90,
            angle: 180,
            amount: 1,
          },
          {
            name: 'sign_Cool',
            size: 250,
            radius: 140,
            rotation: 90,
            angle: 180,
            amount: 1,
          },
        ],
      },
    ],
  });
  const candidate = out.graph.nodes.find(
    (n) => n.nodeType === 'material_preset' && n.presetKind === 'condensation_candidate',
  );
  assert.ok(candidate);
  assert.equal(candidate.condensationRequiresMaterialIntake, true);
  assert.equal(candidate.instantMaterialCreation, false);
  assert.equal(
    out.graph.edges.some(
      (e) => e.toNodeId === candidate.nodeId && e.edgeType === 'drives_specific_energy',
    ),
    true,
  );
});

test('cooling without material intake does not emit condensation candidate', () => {
  const out = compileSpell(loadFixture('crosshair-cool-water.json'));
  assert.equal(
    out.graph.nodes.some(
      (n) => n.nodeType === 'material_preset' && n.presetKind === 'condensation_candidate',
    ),
    false,
  );
});

test('effect graph keeps independent seal domains and condensation local to its owning seal', () => {
  const radialSeal = loadFixture('radial-fire.json').seals[0];
  const radial = compileSpell({
    title: 'Independent radial seals',
    seals: [radialSeal, structuredClone(radialSeal)],
  });
  const fireDomains = radial.graph.nodes.filter(
    (node) => node.nodeType === 'domain' && node.registryId === 'sigil.fire',
  );
  assert.deepEqual(
    fireDomains.map((node) => node.nodeId),
    ['node.domain.fire.seal0.0', 'node.domain.fire.seal1.0'],
  );
  for (const edge of radial.graph.edges.filter((item) => item.edgeType === 'weakens_to')) {
    const fromSeal = edge.fromNodeId.match(/\.seal\d+\./)?.[0];
    const toSeal = edge.toNodeId.match(/\.seal\d+\./)?.[0];
    assert.equal(fromSeal, toSeal, `${edge.edgeId} must stay inside one seal`);
  }

  const coolingSeal = loadFixture('crosshair-cool-water.json').seals[0];
  const gatherSeal = {
    rings: [{ radius: 100 }],
    sigils: [{ name: 'water' }],
    signProfiles: [{ kind: 'gather', amount: 1, radius: 80 }],
  };
  for (const seals of [[coolingSeal, gatherSeal], [gatherSeal, coolingSeal]]) {
    const out = compileSpell({ title: 'Independent cooling and gather', seals });
    assert.equal(
      out.graph.nodes.some((node) => node.presetKind === 'condensation_candidate'),
      false,
      'cooling in one seal must not combine with intake in another seal',
    );
  }
});

test('every fixture effect graph has unique IDs and only existing node references', () => {
  const fixtureNames = readdirSync(fixturesDir).filter((name) => name.endsWith('.json'));
  for (const fixtureName of fixtureNames) {
    const { graph } = compileSpell(loadFixture(fixtureName));
    const nodeIds = graph.nodes.map((node) => node.nodeId);
    const edgeIds = graph.edges.map((edge) => edge.edgeId);
    assert.equal(new Set(nodeIds).size, nodeIds.length, `${fixtureName}: duplicate node ID`);
    assert.equal(new Set(edgeIds).size, edgeIds.length, `${fixtureName}: duplicate edge ID`);

    const nodeIdSet = new Set(nodeIds);
    for (const edge of graph.edges) {
      assert.ok(nodeIdSet.has(edge.fromNodeId), `${fixtureName}: missing ${edge.fromNodeId}`);
      assert.ok(nodeIdSet.has(edge.toNodeId), `${fixtureName}: missing ${edge.toNodeId}`);
    }
    for (const target of graph.nodes.filter((node) => node.nodeType === 'target')) {
      for (const targetedNodeId of target.targetedNodeIds ?? []) {
        assert.ok(nodeIdSet.has(targetedNodeId), `${fixtureName}: missing ${targetedNodeId}`);
      }
    }
  }
});

// VAL-CROSS-005
test('VAL-CROSS-005: prototype remains dependency-light (no runtime deps added)', () => {
  assert.ok(
    packageJson.dependencies === undefined ||
      Object.keys(packageJson.dependencies).length === 0,
  );
});
