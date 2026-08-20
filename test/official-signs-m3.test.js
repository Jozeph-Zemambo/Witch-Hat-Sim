/**
 * Official signs M3: Crush (water→mist), standalone Cool, heat-without-Crosshair guard.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { importSpell } from '../src/compiler/importer.js';
import { analyzeGeometry } from '../src/compiler/geometry.js';
import { compileSpell } from '../src/compiler/compile.js';
import { evaluateRules, flattenRuleEvaluation } from '../src/compiler/rules.js';

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
);

/** @param {string} name */
function loadFixture(name) {
  return JSON.parse(readFileSync(path.join(fixturesDir, name), 'utf8'));
}

/** @param {object} out */
function modifierEdges(out) {
  return (out.graph?.edges ?? []).filter((e) => e.edgeType === 'applies_modifier');
}

// VAL-CRUSH-001
test('VAL-CRUSH-001: water plus crush on center group with inward column yields mist effect', () => {
  const program = analyzeGeometry(importSpell(loadFixture('crush-water-mist.json')));
  const crush = program.geometryAnalysis.seals[0].crushLayout;
  assert.ok(crush);
  assert.equal(crush.domainRegistryId, 'sigil.water');
  assert.ok(crush.hasInwardColumn);
  assert.ok(crush.instances.length > 0);

  const { effects } = flattenRuleEvaluation(evaluateRules(program));
  const crushEffect = effects.find((e) => e.kind === 'sign_crush');
  assert.ok(crushEffect, 'expected sign_crush rule effect');
  assert.equal(crushEffect.domainRegistryId, 'sigil.water');
  assert.equal(crushEffect.effectKind, 'crush_water_mist');
  assert.equal(crushEffect.signRegistryId, 'sign.crush');

  const compiled = compileSpell(loadFixture('crush-water-mist.json'));
  const mistNode = compiled.graph.nodes.find(
    (n) =>
      n.effectKind === 'crush_water_mist' ||
      n.kind === 'sign_crush' ||
      (n.nodeType === 'material_transform' && n.toMaterial === 'mist'),
  );
  assert.ok(mistNode, 'expected crush mist graph node');
});

// VAL-CRUSH-002
test('VAL-CRUSH-002: center fire crush fixture emits crush_domain_undefined only', () => {
  const program = analyzeGeometry(importSpell(loadFixture('crush-fire-undefined.json')));
  const { effects, diagnostics } = flattenRuleEvaluation(evaluateRules(program));
  assert.equal(effects.filter((e) => e.kind === 'sign_crush').length, 0);
  assert.ok(diagnostics.some((d) => d.code === 'rules.crush_domain_undefined'));
});

test('VAL-CRUSH-002: non-water crush emits crush_domain_undefined diagnostic without crush nodes', () => {
  const program = analyzeGeometry(importSpell(loadFixture('crush-non-water-diagnostic.json')));
  const { effects, diagnostics } = flattenRuleEvaluation(evaluateRules(program));

  assert.equal(effects.filter((e) => e.kind === 'sign_crush').length, 0);

  const crushDiags = diagnostics.filter((d) => d.code === 'rules.crush_domain_undefined');
  assert.ok(crushDiags.length >= 3, 'expected diagnostic per non-water seal');

  const compiled = compileSpell(loadFixture('crush-non-water-diagnostic.json'));
  assert.equal(
    compiled.graph.nodes.filter(
      (n) => n.effectKind === 'crush_water_mist' || n.kind === 'sign_crush',
    ).length,
    0,
  );
  assert.ok(
    compiled.diagnostics.some((d) => d.code === 'rules.crush_domain_undefined'),
  );
});

// VAL-COOL-001
test('VAL-COOL-001: cool-water-column-standalone fixture yields cooled column without crosshair', () => {
  const program = analyzeGeometry(importSpell(loadFixture('cool-water-column-standalone.json')));
  assert.ok(program.geometryAnalysis.seals[0].centerAffixes?.hasCool);
  const { effects } = flattenRuleEvaluation(evaluateRules(program));
  assert.ok(
    effects.find(
      (e) => e.kind === 'operator_result' && e.operatorFamily === 'temperature_driver',
    ),
  );
  const compiled = compileSpell(loadFixture('cool-water-column-standalone.json'));
  assert.equal(modifierEdges(compiled).length, 0);
  assert.ok(
    compiled.graph.nodes.some(
      (n) => n.nodeType === 'phase_state' && n.gradualPhaseChange === true,
    ),
  );
});

test('VAL-COOL-001: standalone cool on center water column yields cooled column metadata', () => {
  const program = analyzeGeometry(importSpell(loadFixture('cool-standalone-water-column.json')));
  const affixes = program.geometryAnalysis.seals[0].centerAffixes;
  assert.ok(affixes?.coolSignIds?.length);
  assert.ok(program.geometryAnalysis.seals[0].centerGroup?.hasColumn);

  const { effects } = flattenRuleEvaluation(evaluateRules(program));
  const cool = effects.find(
    (e) => e.kind === 'operator_result' && e.operatorFamily === 'temperature_driver',
  );
  assert.ok(cool);
  assert.equal(cool.domainRegistryId, 'sigil.water');
  assert.equal(cool.signRegistryId, 'sign.cool');

  const compiled = compileSpell(loadFixture('cool-standalone-water-column.json'));
  const driver = compiled.graph.nodes.find((n) => n.nodeType === 'temperature_driver');
  assert.ok(driver);
  assert.equal(driver.temperatureDriver.thermalEffect, 'cool');
  const phase = compiled.graph.nodes.find((n) => n.nodeType === 'phase_state');
  assert.ok(phase);
  assert.equal(phase.instantPhaseChange, false);
  assert.equal(modifierEdges(compiled).length, 0);
});

test('VAL-COOL-001: standalone cool on fire center column yields cooled metadata', () => {
  const { effects } = flattenRuleEvaluation(
    evaluateRules(analyzeGeometry(importSpell(loadFixture('cool-standalone-fire-column.json')))),
  );
  const cool = effects.find(
    (e) => e.kind === 'operator_result' && e.operatorFamily === 'temperature_driver',
  );
  assert.ok(cool);
  assert.equal(cool.domainRegistryId, 'sigil.fire');

  const compiled = compileSpell(loadFixture('cool-standalone-fire-column.json'));
  const driver = compiled.graph.nodes.find((n) => n.nodeType === 'temperature_driver');
  assert.ok(driver);
  assert.equal(driver.weakEffect, 'cool');
  assert.equal(modifierEdges(compiled).length, 0);
});

// VAL-HEAT-001
test('VAL-HEAT-001: water column plus radial heat without crosshair does not warm water', () => {
  const compiled = compileSpell(loadFixture('heat-without-crosshair-negative.json'));
  assert.equal(
    compiled.graph.nodes.filter((n) => n.effectKind === 'thermal_field').length,
    0,
  );
  assert.equal(modifierEdges(compiled).length, 0);

  const warming = compiled.graph.edges.filter(
    (e) =>
      e.edgeType === 'applies_modifier' &&
      (e.geometryBinding?.modifierWeakEffect === 'heat' ||
        e.intentSummary?.includes?.('warm')),
  );
  assert.equal(warming.length, 0);
});
