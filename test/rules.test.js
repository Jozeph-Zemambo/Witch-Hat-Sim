/**
 * Rule evaluation tests (VAL-RULES-001..009).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { importSpell } from '../src/compiler/importer.js';
import { resolveProgramRegistry } from '../src/compiler/registry.js';
import { analyzeSpellGeometry } from '../src/compiler/geometry.js';
import { evaluateRules, flattenRuleEvaluation } from '../src/compiler/rules.js';
import { compileSpell } from '../src/compiler/compile.js';

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
);

function loadFixture(name) {
  return JSON.parse(readFileSync(path.join(fixturesDir, name), 'utf8'));
}

function analyzeForRules(fixture) {
  const program = importSpell(fixture);
  resolveProgramRegistry(program);
  analyzeSpellGeometry(program);
  return flattenRuleEvaluation(evaluateRules(program));
}

function operatorResult(effects, operatorFamily, signRegistryId) {
  return effects.find(
    (e) =>
      e.kind === 'operator_result' &&
      e.operatorFamily === operatorFamily &&
      e.signRegistryId === signRegistryId,
  );
}

function operatorResults(effects, operatorFamily, signRegistryId) {
  return effects.filter(
    (e) =>
      e.kind === 'operator_result' &&
      e.operatorFamily === operatorFamily &&
      e.signRegistryId === signRegistryId,
  );
}

function radialModifier(effects, domainRegistryId) {
  return effects.find(
    (e) =>
      e.kind === 'operator_result' &&
      e.operatorFamily === 'weaken_modifier_source' &&
      (domainRegistryId ? e.domainRegistryId === domainRegistryId : true),
  );
}

function crosshairScope(effects) {
  return operatorResult(effects, 'scope_filter', 'sign.crosshair');
}

// VAL-RULES-001
test('VAL-RULES-001: Watershot-like rule emits warning-scoped water column effect with evidence', () => {
  const { effects, diagnostics } = analyzeForRules(loadFixture('watershot-centered.json'));
  const w = effects.find(
    (e) =>
      e.kind === 'operator_result' &&
      e.operatorFamily === 'field_emit' &&
      e.signRegistryId === 'sign.column' &&
      e.domainRegistryId === 'sigil.water' &&
      e.derivedClassification === 'column_emission',
  );
  assert.ok(w);
  assert.equal(w.domainRegistryId, 'sigil.water');
  assert.ok(diagnostics.some((d) => d.code === 'rules.compiled_with_warnings'));
  assert.ok(
    diagnostics.some((d) =>
      (d.provenance?.evidenceRefs ?? []).includes('DOSSIER:SPELL_WATERSHOT_SEAL'),
    ),
  );
});

// VAL-RULES-002
test('VAL-RULES-002: Radial fire maps to heat weak domain with custom-supported provenance', () => {
  const { effects, diagnostics } = analyzeForRules(loadFixture('radial-fire.json'));
  const r = radialModifier(effects, 'sigil.fire');
  assert.ok(r);
  assert.equal(r.domainRegistryId, 'sigil.fire');
  assert.equal(r.weakEffect, 'heat');
  assert.ok(diagnostics.some((d) => d.code === 'rules.compiled_with_warnings'));
  assert.ok(
    diagnostics.some((d) => d.provenance?.customSupported === true || d.provenance?.evidenceRefs),
  );
});

// VAL-RULES-003
test('VAL-RULES-003: Radial water maps to mist without steam implication', () => {
  const { effects, diagnostics } = analyzeForRules(loadFixture('radial-water.json'));
  const r = radialModifier(effects, 'sigil.water');
  assert.ok(r);
  assert.equal(r.weakEffect, 'mist');
  const msg = diagnostics.map((d) => d.message).join(' ');
  assert.ok(!msg.toLowerCase().includes('steam'));
});

// VAL-RULES-004
test('VAL-RULES-004: Radial earth maps to dust not sand', () => {
  const { effects } = analyzeForRules(loadFixture('radial-earth.json'));
  const r = radialModifier(effects, 'sigil.earth');
  assert.ok(r);
  assert.equal(r.weakEffect, 'dust');
});

// VAL-RULES-005
test('VAL-RULES-005: Radial light maps to glow', () => {
  const { effects } = analyzeForRules(loadFixture('radial-light.json'));
  const r = radialModifier(effects, 'sigil.light');
  assert.ok(r);
  assert.equal(r.weakEffect, 'glow');
});

// VAL-RULES-006
test('VAL-RULES-006: Radial wind yields no-op diagnostic and no radial weak effect', () => {
  const { effects, diagnostics } = analyzeForRules(loadFixture('radial-wind.json'));
  assert.equal(operatorResults(effects, 'weaken_modifier_source', 'sign.radial').length, 0);
  assert.ok(diagnostics.some((d) => d.code === 'rules.radial_wind_no_weak_form'));
});

// VAL-RULES-007
test('VAL-RULES-007: Valid Crosshair center-group yields modifier linkage plus radial heat', () => {
  const { effects } = analyzeForRules(loadFixture('crosshair-valid.json'));
  const c = crosshairScope(effects);
  assert.ok(c);
  assert.equal(c.centerGroup.centerRegistryId, 'sigil.water');
  assert.ok(
    effects.some(
      (e) =>
        e.kind === 'operator_result' &&
        e.operatorFamily === 'weaken_modifier_source' &&
        e.domainRegistryId === 'sigil.fire' &&
        e.weakEffect === 'heat' &&
        e.pointedAtSigilId,
    ),
  );
});

// VAL-RULES-008
test('VAL-RULES-008: Invalid Crosshair structure emits invalid_structure diagnostic', () => {
  const { effects, diagnostics } = analyzeForRules(loadFixture('crosshair-invalid.json'));
  assert.equal(operatorResults(effects, 'scope_filter', 'sign.crosshair').length, 0);
  assert.ok(diagnostics.some((d) => d.code === 'invalid_structure_for_symbol'));
  assert.ok(diagnostics.some((d) => d.status === 'invalid_structure'));
});

// VAL-RULES-009
test('VAL-RULES-009: unsupported combinations do not invent Watershot or radial modifiers', () => {
  const { effects, diagnostics } = analyzeForRules(
    loadFixture('unsupported-combo-fire-column.json'),
  );
  assert.equal(
    effects.filter(
      (e) =>
        e.kind === 'operator_result' &&
        e.operatorFamily === 'field_emit' &&
        e.derivedClassification === 'column_emission' &&
        e.domainRegistryId === 'sigil.water',
    ).length,
    0,
  );
  assert.equal(diagnostics.some((d) => d.code === 'invalid_symbol_pairing'), false);

  const invalidCount = analyzeForRules(loadFixture('radial-invalid-count.json'));
  assert.equal(operatorResults(invalidCount.effects, 'weaken_modifier_source', 'sign.radial').length, 0);
  assert.ok(invalidCount.diagnostics.some((d) => d.code === 'rules.radial_invalid_count'));

  const three = analyzeForRules(loadFixture('radial-three-on-target.json'));
  assert.equal(operatorResults(three.effects, 'weaken_modifier_source', 'sign.radial').length, 0);
  assert.ok(three.diagnostics.some((d) => d.code === 'rules.radial_invalid_count'));

  const amb = analyzeForRules(loadFixture('radial-ambiguous.json'));
  assert.equal(operatorResults(amb.effects, 'weaken_modifier_source', 'sign.radial').length, 0);
  assert.ok(amb.diagnostics.some((d) => d.code === 'rules.radial_ambiguous_domain'));
});

// VAL-LEVIT-001
test('VAL-LEVIT-001: balanced fire levitation yields centered float with height from sign length', () => {
  const { effects } = analyzeForRules(loadFixture('levitation-fire-balanced.json'));
  const lev = operatorResult(effects, 'lift_motion', 'sign.levitation');
  assert.ok(lev);
  assert.equal(lev.balanced, true);
  assert.equal(lev.geometryBinding.centeredFloat, true);
  assert.ok(lev.heightFromSignLength > 0);
  assert.equal(lev.launchVector, null);
});

// VAL-LEVIT-002
test('VAL-LEVIT-002: imbalanced fire levitation yields launch vector metadata', () => {
  const { effects } = analyzeForRules(loadFixture('levitation-fire-launch.json'));
  const lev = operatorResult(effects, 'lift_motion', 'sign.levitation');
  assert.ok(lev);
  assert.equal(lev.balanced, false);
  assert.ok(lev.launchVector);
  assert.ok(lev.oneShotLaunch);
  assert.equal(lev.continuousStream, false);
});

// VAL-LEVIT-003
test('VAL-LEVIT-003: imbalanced wind levitation yields continuous stream metadata', () => {
  const { effects } = analyzeForRules(loadFixture('levitation-wind-stream.json'));
  const lev = operatorResult(effects, 'lift_motion', 'sign.levitation');
  assert.ok(lev);
  assert.equal(lev.balanced, false);
  assert.equal(lev.continuousStream, true);
  assert.equal(lev.oneShotLaunch, false);
});

test('VAL-LEVIT-004: every elemental sigil keeps the shared generated-output levitation contract', () => {
  for (const materialKind of ['water', 'light', 'earth']) {
    const fixture = loadFixture('levitation-fire-balanced.json');
    fixture.title = `${materialKind} levitation balanced output`;
    fixture.seals[0].sigils = [{ name: materialKind }];
    const { effects } = analyzeForRules(fixture);
    const lev = operatorResult(effects, 'lift_motion', 'sign.levitation');
    assert.ok(lev, materialKind);
    assert.equal(lev.domainRegistryId, `sigil.${materialKind}`);
    assert.equal(lev.balanced, true);
    assert.equal(lev.continuousStream, false);
    assert.equal(lev.geometryBinding.generatedOutput, true);
    assert.equal(lev.geometryBinding.targetMode, 'generated_output');
  }

  const lightLaunch = loadFixture('levitation-fire-launch.json');
  lightLaunch.title = 'Light levitation launch';
  lightLaunch.seals[0].sigils = [{ name: 'light' }];
  const launch = operatorResult(
    analyzeForRules(lightLaunch).effects,
    'lift_motion',
    'sign.levitation',
  );
  assert.ok(launch);
  assert.equal(launch.oneShotLaunch, true);
  assert.equal(launch.continuousStream, false);
});

test('VAL-OPERATOR-001: Wave 2 signs emit primary generic operator results', () => {
  const normalDispersion = loadFixture('dispersion-fire-explicit.json');
  normalDispersion.seals[0].signProfiles[0].angle = 0;
  const cases = [
    [normalDispersion, 'outward_dispersion', 'field_emit', 'sign.dispersion'],
    ['pull-angled-twist.json', 'sign_pull', 'field_attract', 'sign.pull'],
    ['region-water-inward.json', 'sign_region', 'scope_boundary', 'sign.region'],
    ['levitation-fire-balanced.json', 'levitation_fire', 'lift_motion', 'sign.levitation'],
    ['collection-multi-domain.json', 'sign_collection', 'material_intake', 'sign.collection'],
    ['gather-multi-domain.json', 'sign_gather', 'material_intake', 'sign.gather'],
    ['convergence-point-focus-valid.json', 'sign_convergence', 'field_focus', 'sign.convergence'],
  ];

  for (const [fixture, legacyEffectKind, operatorFamily, signRegistryId] of cases) {
    const input = typeof fixture === 'string' ? loadFixture(fixture) : fixture;
    const { effects } = analyzeForRules(input);
    const primary = effects.filter(
      (e) =>
        e.kind === 'operator_result' &&
        e.compatTrace?.legacyEffectKind === legacyEffectKind &&
        e.operatorFamily === operatorFamily &&
        e.signRegistryId === signRegistryId,
    );
    assert.ok(primary.length > 0, typeof fixture === 'string' ? fixture : signRegistryId);
    assert.ok(primary.every((e) => e.domainRegistryId && e.geometryBinding && e.confidence));
  }

  const { effects } = analyzeForRules(loadFixture('dispersion-fire-explicit.json'));
  const invertedColumn = operatorResult(effects, 'field_emit', 'sign.column');
  assert.ok(invertedColumn);
  assert.equal(
    invertedColumn.geometryBinding.semanticOverrides[0].reason,
    'inverted_dispersion_resolves_as_column',
  );
});

test('VAL-OPERATOR-002: levitation operator result exposes motion channels in graph', () => {
  const compiled = compileSpell(loadFixture('levitation-fire-balanced.json'));
  const operator = compiled.graph.nodes.find(
    (n) => n.nodeType === 'force_constraint' && n.registryId === 'sign.levitation',
  );
  assert.ok(operator);
  assert.equal(operator.motionMode, 'stable_hover');
  assert.equal(operator.verticalLift, 240);
  assert.deepEqual(operator.translationVector, { x: 0, y: 0 });
  assert.equal(operator.torqueDirection, 'none');
  assert.equal(compiled.graph.nodes.some((n) => n.nodeType === 'operator_effect'), false);
});

test('VAL-OPERATOR-003: operator results expose enriched generic metadata', () => {
  const collection = compileSpell(loadFixture('collection-multi-domain.json')).graph.nodes.find(
    (n) => n.nodeType === 'source_mode' && n.mode === 'collect_nearby',
  );
  assert.equal(collection.mode, 'collect_nearby');

  const gather = compileSpell(loadFixture('gather-multi-domain.json')).graph.nodes.find(
    (n) => n.nodeType === 'source_mode' && n.mode === 'gather_active',
  );
  assert.equal(gather.mode, 'gather_active');

  const convergence = compileSpell(loadFixture('convergence-point-focus-valid.json')).graph.nodes.find(
    (n) => n.nodeType === 'force_constraint' && n.registryId === 'sign.convergence',
  );
  assert.equal(convergence.convergenceMode, 'point_focus');
  assert.equal(convergence.geometryBinding.fieldModification.coherenceDelta, 0.5);
  assert.equal(convergence.geometryBinding.fieldModification.spreadMultiplier, 0.5);
});

test('Water Heater Spell Maker fixture: radials point at fire and crosshair applies heat', () => {
  const { effects, diagnostics } = analyzeForRules(
    loadFixture('spellmaker-water-heater.json'),
  );
  const heat = radialModifier(effects, 'sigil.fire');
  assert.ok(heat);
  assert.equal(heat.pointedAtSigilId, 'sigil-instance:0');
  const cross = crosshairScope(effects);
  assert.ok(cross);
  assert.ok(!diagnostics.some((d) => d.code === 'rules.radial_invalid_count'));
});

test('Crosshair modifier from sign_Cool affixed to off-center sigil', () => {
  const { effects } = analyzeForRules(loadFixture('crosshair-cool-water.json'));
  const cross = crosshairScope(effects);
  assert.ok(cross);
  assert.equal(cross.modifierEffect.kind, 'crosshair_cool_modifier');
  assert.equal(cross.modifierEffect.weakEffect, 'cool');
});

test('Strengthen on fire radial modifier yields retained heat intensity', () => {
  const { effects } = analyzeForRules(
    loadFixture('spellmaker-water-heater-strengthen.json'),
  );
  const cross = crosshairScope(effects);
  assert.ok(cross);
  assert.equal(cross.modifierEffect.intensityKind, 'retained_heat');
  assert.equal(cross.modifierEffect.strengthenApplied, true);
});

test('Strengthen on cool modifier yields retained cooling weak effect', () => {
  const { effects } = analyzeForRules(loadFixture('crosshair-cool-water-freezing.json'));
  const cross = crosshairScope(effects);
  assert.ok(cross);
  assert.equal(cross.modifierEffect.weakEffect, 'cool');
  assert.equal(cross.modifierEffect.intensityKind, 'retained_cooling');
});
