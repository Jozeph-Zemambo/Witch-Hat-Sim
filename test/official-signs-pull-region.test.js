/**
 * Official signs M2: Pull and Region (sign-first, element-uniform).
 * Synthetic fixtures only — dossier spells (Grasping Wind, Floating Drops) are NOT required.
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

const DOMAIN_SIGILS = [
  { sealIndex: 0, domain: 'sigil.water' },
  { sealIndex: 1, domain: 'sigil.fire' },
  { sealIndex: 2, domain: 'sigil.wind' },
  { sealIndex: 3, domain: 'sigil.earth' },
  { sealIndex: 4, domain: 'sigil.light' },
];

/** @param {object[]} effects */
function pullEffects(effects) {
  return effects.filter(
    (e) =>
      e.kind === 'operator_result' &&
      e.operatorFamily === 'field_attract' &&
      e.signRegistryId === 'sign.pull',
  );
}

/** @param {object[]} effects */
function regionEffects(effects) {
  return effects.filter(
    (e) =>
      e.kind === 'operator_result' &&
      e.operatorFamily === 'scope_boundary' &&
      e.signRegistryId === 'sign.region',
  );
}

// VAL-PULL-001
test('VAL-PULL-001: pull sign uniform role per sigil domain', () => {
  const program = analyzeGeometry(importSpell(loadFixture('pull-multi-domain.json')));
  const { effects } = flattenRuleEvaluation(evaluateRules(program));

  assert.equal(pullEffects(effects).length, DOMAIN_SIGILS.length);

  for (const { sealIndex, domain } of DOMAIN_SIGILS) {
    const effect = pullEffects(effects).find((e) => e.sealId === `seal:${sealIndex}`);
    assert.ok(effect, domain);
    assert.equal(effect.operatorRole, 'force_field');
    assert.equal(effect.kind, 'operator_result');
    assert.equal(effect.effectKind, 'pull');
    assert.equal(effect.pullMode, 'pull');
    assert.equal(effect.domainRegistryId, domain);
    assert.equal(effect.signRegistryId, 'sign.pull');
    assert.equal(effect.legacyEffectKind, 'sign_pull');
  }

  const compiled = compileSpell(loadFixture('pull-multi-domain.json'));
  const pullNodes = compiled.graph.nodes.filter(
    (n) => n.nodeType === 'force_constraint' && n.signRole === 'pull',
  );
  assert.equal(pullNodes.length, DOMAIN_SIGILS.length);
  for (const node of pullNodes) {
    assert.equal(node.pullMode, 'pull');
    assert.equal(node.forceKind, 'pull');
  }
});

// VAL-PULL-002
test('VAL-PULL-002: angled pull emits pull-plus-twist metadata', () => {
  const program = analyzeGeometry(importSpell(loadFixture('pull-angled-twist.json')));
  const pull = program.geometryAnalysis.seals[0].pullSigns;
  assert.ok(pull);
  assert.equal(pull.directionMode, 'inward');
  assert.ok(pull.pullTwist);
  assert.ok(Math.abs(pull.pullTwist.tangential ?? 0) > 0 || pull.pullTwist.vectorSum);

  const effect = pullEffects(flattenRuleEvaluation(evaluateRules(program)).effects)[0];
  assert.ok(effect);
  assert.equal(effect.pullMode, 'pull');
  assert.ok(effect.geometryBinding.pullTwist);

  const compiled = compileSpell(loadFixture('pull-angled-twist.json'));
  const force = compiled.graph.nodes.find(
    (n) => n.nodeType === 'force_constraint' && n.signRole === 'pull',
  );
  assert.ok(force?.pullTwist);
});

// VAL-PULL-003
test('VAL-PULL-003: inverted pull emits push not silent inward pull', () => {
  const program = analyzeGeometry(importSpell(loadFixture('pull-inverted-push.json')));
  const pull = program.geometryAnalysis.seals[0].pullSigns;
  assert.ok(pull);
  assert.equal(pull.directionMode, 'push');
  assert.ok(pull.pushInstances.length > 0);

  const { effects, diagnostics } = flattenRuleEvaluation(evaluateRules(program));
  const effect = pullEffects(effects)[0];
  assert.ok(effect);
  assert.equal(effect.pullMode, 'push');
  assert.notEqual(effect.pullMode, 'pull');
  assert.equal(effect.effectKind, 'push');
  assert.equal(effect.pushMetadata.fromPullInversion, true);
  assert.ok(effect.pushMetadata.pushInstanceCount > 0);
  assert.ok(
    diagnostics.some((d) => d.code === 'rules.pull_inverted_push'),
    'expected rules.pull_inverted_push diagnostic',
  );

  const compiled = compileSpell(loadFixture('pull-inverted-push.json'));
  const force = compiled.graph.nodes.find(
    (n) => n.nodeType === 'force_constraint' && n.signRole === 'pull',
  );
  assert.equal(force?.pullMode, 'push');
  assert.equal(force?.forceKind, 'push');
});

// VAL-REGION-001
test('VAL-REGION-001: region on-ring zones uniform across domains and facing modes', () => {
  const cases = [
    { fixture: 'region-water-inward.json', zone: 'all_inward', domain: 'sigil.water' },
    { fixture: 'region-fire-outward.json', zone: 'all_outward', domain: 'sigil.fire' },
    { fixture: 'region-opposing.json', zone: 'opposing', domain: 'sigil.wind' },
  ];

  for (const { fixture, zone, domain } of cases) {
    const program = analyzeGeometry(importSpell(loadFixture(fixture)));
    const layout = program.geometryAnalysis.seals[0].regionLayout;
    assert.ok(layout, fixture);
    assert.equal(layout.regionZone, zone, fixture);
    assert.equal(layout.emissionPlacement, 'on_ring', fixture);
    assert.equal(layout.domainRegistryId, domain, fixture);

    const effect = regionEffects(flattenRuleEvaluation(evaluateRules(program)).effects)[0];
    assert.ok(effect, fixture);
    assert.equal(effect.operatorRole, 'scope_filter');
    assert.equal(effect.kind, 'operator_result');
    assert.equal(effect.regionZone, zone, fixture);
    assert.equal(effect.domainRegistryId, domain, fixture);
    assert.equal(effect.emissionPlacement, 'on_ring', fixture);

    const shape = compileSpell(loadFixture(fixture)).graph.nodes.find(
      (n) => n.nodeType === 'shape_field' && n.shape === 'region',
    );
    assert.ok(shape, fixture);
    assert.equal(shape.signRole, 'region');
    assert.equal(shape.regionZone, zone, fixture);
  }
});

// VAL-REGION-002
test('VAL-REGION-002: region tests use synthetic fixtures not dossier spell clones', () => {
  const syntheticFixtures = [
    'region-water-inward.json',
    'region-fire-outward.json',
    'region-opposing.json',
  ];
  for (const name of syntheticFixtures) {
    const raw = readFileSync(path.join(fixturesDir, name), 'utf8');
    assert.ok(raw.includes('"kind": "region"'), name);
    assert.ok(!raw.toLowerCase().includes('floating'), name);
    assert.ok(!raw.toLowerCase().includes('grasping'), name);
    const out = compileSpell(loadFixture(name));
    assert.ok(regionEffects(out.effects ?? []).length > 0 || out.graph.nodes.some(
      (n) => n.shape === 'region',
    ), name);
  }
});
