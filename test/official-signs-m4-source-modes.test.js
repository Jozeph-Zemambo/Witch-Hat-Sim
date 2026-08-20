/**
 * Official signs M4: Collection, Gather source modes; Convergence point-focus.
 * Synthetic fixtures only — no wind-wall inference.
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
import { lookupRegistrySpellMaker } from '../src/compiler/registry.js';

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
);

/** @param {string} name */
function loadFixture(name) {
  return JSON.parse(readFileSync(path.join(fixturesDir, name), 'utf8'));
}

const DOMAIN_SIGILS = [
  { sealIndex: 0, domain: 'sigil.water' },
  { sealIndex: 1, domain: 'sigil.fire' },
  { sealIndex: 2, domain: 'sigil.wind' },
  { sealIndex: 3, domain: 'sigil.earth' },
  { sealIndex: 4, domain: 'sigil.light' },
];

const COLUMN_PARITY_INSTANCE_FIELDS = [
  'positionAngleDeg',
  'radialDistance',
  'profileRotationDeg',
  'signAngleDeg',
  'angleDerivedFacingDeg',
  'inverted',
  'scaleWeight',
  'placementZone',
  'directionVector',
  'radialComponents',
  'symmetryClass',
  'vectorSum',
  'sameKindGroupId',
];

/** @param {object} ga */
function assertColumnParityInstanceGeometry(ga) {
  for (const field of COLUMN_PARITY_INSTANCE_FIELDS) {
    assert.ok(field in ga, `missing geometry field: ${field}`);
  }
}

/** @param {object[]} effects */
function collectionEffects(effects) {
  return effects.filter(
    (e) =>
      e.kind === 'operator_result' &&
      e.operatorFamily === 'material_intake' &&
      e.signRegistryId === 'sign.collection',
  );
}

/** @param {object[]} effects */
function gatherEffects(effects) {
  return effects.filter(
    (e) =>
      e.kind === 'operator_result' &&
      e.operatorFamily === 'material_intake' &&
      e.signRegistryId === 'sign.gather',
  );
}

/** @param {object[]} effects */
function convergenceEffects(effects) {
  return effects.filter(
    (e) =>
      e.kind === 'operator_result' &&
      e.operatorFamily === 'field_focus' &&
      e.signRegistryId === 'sign.convergence',
  );
}

// VAL-COLL-001
test('VAL-COLL-001: collection sign uniform collect_nearby source-mode per domain', () => {
  const program = analyzeGeometry(importSpell(loadFixture('collection-multi-domain.json')));
  const { effects } = flattenRuleEvaluation(evaluateRules(program));

  assert.equal(collectionEffects(effects).length, DOMAIN_SIGILS.length);

  for (const { sealIndex, domain } of DOMAIN_SIGILS) {
    const effect = collectionEffects(effects).find((e) => e.sealId === `seal:${sealIndex}`);
    assert.ok(effect, domain);
    assert.equal(effect.operatorRole, 'source_acquisition');
    assert.equal(effect.sourceMode, 'collect_nearby');
    assert.equal(effect.domainRegistryId, domain);
    assert.equal(effect.signRegistryId, 'sign.collection');
    assert.equal(effect.legacyEffectKind, 'sign_collection');
    assert.notEqual(effect.sourceMode, 'gather_active');
  }

  const layout = program.geometryAnalysis.seals[0].collectionLayout;
  assert.ok(layout);
  assert.equal(layout.sourceMode, 'collect_nearby');

  const compiled = compileSpell(loadFixture('collection-multi-domain.json'));
  const sourceNodes = compiled.graph.nodes.filter(
    (n) => n.nodeType === 'source_mode' && n.mode === 'collect_nearby',
  );
  assert.equal(sourceNodes.length, DOMAIN_SIGILS.length);
  assert.equal(
    compiled.graph.nodes.filter((n) => n.nodeType === 'source_mode' && n.mode === 'gather_active')
      .length,
    0,
  );
  assert.equal(
    compiled.graph.nodes.filter((n) => n.creationAssumption === 'create_material').length,
    0,
  );
});

test('VAL-COLL-001: collection signs use column-parity geometry', () => {
  const program = analyzeGeometry(importSpell(loadFixture('collection-multi-domain.json')));
  const instances = program.seals.flatMap((seal) =>
    (seal.symbols ?? []).filter(
      (s) =>
        s.objectId?.startsWith('sign-instance:') &&
        s.resolvedRegistryId === 'sign.collection',
    ),
  );
  assert.ok(instances.length >= 2);
  for (const inst of instances) {
    assertColumnParityInstanceGeometry(inst.geometryAnalysis);
  }
  const group = program.geometryAnalysis.sameKindAggregations.find(
    (g) => g.registryId === 'sign.collection',
  );
  assert.ok(group?.columnVectorClassification);
});

// VAL-GATHER-001
test('VAL-GATHER-001: gather sign uniform gather_active metadata distinct from collection', () => {
  const program = analyzeGeometry(importSpell(loadFixture('gather-multi-domain.json')));
  const { effects } = flattenRuleEvaluation(evaluateRules(program));

  assert.equal(gatherEffects(effects).length, DOMAIN_SIGILS.length);

  for (const { sealIndex, domain } of DOMAIN_SIGILS) {
    const effect = gatherEffects(effects).find((e) => e.sealId === `seal:${sealIndex}`);
    assert.ok(effect, domain);
    assert.equal(effect.operatorRole, 'source_acquisition');
    assert.equal(effect.sourceMode, 'gather_active');
    assert.equal(effect.domainRegistryId, domain);
    assert.equal(effect.signRegistryId, 'sign.gather');
    assert.equal(effect.legacyEffectKind, 'sign_gather');
    assert.notEqual(effect.sourceMode, 'collect_nearby');
  }

  const layout = program.geometryAnalysis.seals[0].gatherLayout;
  assert.ok(layout);
  assert.equal(layout.sourceMode, 'gather_active');

  const compiled = compileSpell(loadFixture('gather-multi-domain.json'));
  const gatherNodes = compiled.graph.nodes.filter(
    (n) => n.nodeType === 'source_mode' && n.mode === 'gather_active',
  );
  assert.equal(gatherNodes.length, DOMAIN_SIGILS.length);
  assert.equal(
    compiled.graph.nodes.filter((n) => n.nodeType === 'source_mode' && n.mode === 'collect_nearby')
      .length,
    0,
  );
});

test('VAL-GATHER-001: gather signs use column-parity geometry', () => {
  const program = analyzeGeometry(importSpell(loadFixture('gather-multi-domain.json')));
  const instances = program.seals.flatMap((seal) =>
    (seal.symbols ?? []).filter(
      (s) =>
        s.objectId?.startsWith('sign-instance:') && s.resolvedRegistryId === 'sign.gather',
    ),
  );
  assert.ok(instances.length >= 2);
  for (const inst of instances) {
    assertColumnParityInstanceGeometry(inst.geometryAnalysis);
  }
});

// VAL-CONV-001
test('VAL-CONV-001: symmetric inward convergence emits point-focus metadata', () => {
  const program = analyzeGeometry(importSpell(loadFixture('convergence-point-focus-valid.json')));
  const layout = program.geometryAnalysis.seals[0].convergenceLayout;
  assert.ok(layout);
  assert.equal(layout.pointFocusEligible, true);
  assert.equal(layout.ignoredWindWallInference, false);

  const { effects } = flattenRuleEvaluation(evaluateRules(program));
  const effect = convergenceEffects(effects)[0];
  assert.ok(effect);
  assert.equal(effect.convergenceMode, 'point_focus');
  assert.equal(effect.pointFocus, true);
  assert.equal(effect.effectKind, 'convergence_point_focus');
  assert.equal(effect.signRegistryId, 'sign.convergence');

  const compiled = compileSpell(loadFixture('convergence-point-focus-valid.json'));
  const force = compiled.graph.nodes.find(
    (n) => n.nodeType === 'force_constraint' && n.signRole === 'convergence',
  );
  assert.ok(force);
  assert.equal(force.convergenceMode, 'point_focus');
  assert.equal(force.pointFocus, true);
});

test('VAL-CONV-001: under-specified convergence emits diagnostic without active effect', () => {
  const program = analyzeGeometry(importSpell(loadFixture('convergence-under-specified.json')));
  const layout = program.geometryAnalysis.seals[0].convergenceLayout;
  assert.ok(layout);
  assert.equal(layout.pointFocusEligible, false);

  const { effects, diagnostics } = flattenRuleEvaluation(evaluateRules(program));
  assert.equal(convergenceEffects(effects).length, 0);
  assert.ok(
    diagnostics.some((d) => d.code === 'rules.convergence_under_specified'),
    'expected rules.convergence_under_specified',
  );

  const compiled = compileSpell(loadFixture('convergence-under-specified.json'));
  assert.equal(
    compiled.graph.nodes.filter(
      (n) => n.nodeType === 'force_constraint' && n.signRole === 'convergence',
    ).length,
    0,
  );
});

test('VAL-CONV-001: wind-wall inference layout ignored — no convergence activation', () => {
  const program = analyzeGeometry(importSpell(loadFixture('convergence-wind-wall-negative.json')));
  const layout = program.geometryAnalysis.seals[0].convergenceLayout;
  assert.ok(layout);
  assert.equal(layout.ignoredWindWallInference, true);

  const { effects, diagnostics } = flattenRuleEvaluation(evaluateRules(program));
  assert.equal(convergenceEffects(effects).length, 0);
  assert.ok(
    diagnostics.some((d) => d.code === 'rules.ignored_unofficial_spell_inference'),
    'expected ignored wind-wall diagnostic',
  );
  assert.equal(
    diagnostics.filter((d) => d.code === 'rules.convergence_under_specified').length,
    0,
  );

  const compiled = compileSpell(loadFixture('convergence-wind-wall-negative.json'));
  assert.equal(
    compiled.graph.nodes.filter(
      (n) => n.nodeType === 'force_constraint' && n.signRole === 'convergence',
    ).length,
    0,
  );
  assert.ok(
    compiled.diagnostics.some((d) => d.code === 'rules.ignored_unofficial_spell_inference'),
  );
});

test('VAL-CONV-001: convergence signs use column-parity geometry', () => {
  const program = analyzeGeometry(importSpell(loadFixture('convergence-point-focus-valid.json')));
  const instances = program.seals[0].symbols.filter(
    (s) =>
      s.objectId?.startsWith('sign-instance:') && s.resolvedRegistryId === 'sign.convergence',
  );
  assert.ok(instances.length >= 2);
  for (const inst of instances) {
    assertColumnParityInstanceGeometry(inst.geometryAnalysis);
  }
});

test('registry resolves collection gather convergence official tokens', () => {
  for (const token of ['collection', 'gather', 'convergence']) {
    const lookup = lookupRegistrySpellMaker(`sign_${token}`, 'sign');
    assert.equal(lookup.official, true);
    assert.equal(lookup.resolvedRegistryId, `sign.${token}`);
  }
});

test('M4 fixtures are synthetic not dossier clones', () => {
  for (const name of [
    'collection-multi-domain.json',
    'gather-multi-domain.json',
    'convergence-point-focus-valid.json',
  ]) {
    const raw = readFileSync(path.join(fixturesDir, name), 'utf8').toLowerCase();
    assert.ok(!raw.includes('floating'), name);
    assert.ok(!raw.includes('grasping'), name);
    assert.ok(!raw.includes('wall of wind'), name);
  }
});
