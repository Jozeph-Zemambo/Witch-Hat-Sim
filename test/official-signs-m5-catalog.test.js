/**
 * Official signs M5: Float deprecated; deferred catalog signs diagnostic-only.
 * Synthetic fixtures only — no dossier spell clones.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { importSpell } from '../src/compiler/importer.js';
import { compileSpell } from '../src/compiler/compile.js';
import { evaluateRules, flattenRuleEvaluation } from '../src/compiler/rules.js';
import {
  resolveSymbol,
  lookupRegistrySpellMaker,
  CATALOG_DEFERRED_SIGN_IDS,
  isCatalogDeferredSign,
} from '../src/compiler/registry.js';

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
);

/** @param {string} name */
function loadFixture(name) {
  return JSON.parse(readFileSync(path.join(fixturesDir, name), 'utf8'));
}

const ACTIVE_EFFECT_KINDS = new Set([
  'watershot_column',
  'outward_dispersion',
  'sign_pull',
  'sign_region',
  'sign_collection',
  'sign_gather',
  'sign_convergence',
  'sign_crush',
  'standalone_cool',
  'radial_weak_domain',
  'crosshair_center_group',
  'levitation_fire',
  'levitation_wind',
]);

const CATALOG_SIGN_TOKENS = [
  { token: 'float', registryId: 'sign.float' },
  { token: 'billow', registryId: 'sign.billow' },
  { token: 'weave', registryId: 'sign.weave' },
  { token: 'entwine', registryId: 'sign.entwine' },
  { token: 'sign_of_wind', registryId: 'sign.sign_of_wind' },
  { token: 'aeriforms_defined', registryId: 'sign.aeriforms_defined' },
  { token: 'glaives', registryId: 'sign.glaives' },
  { token: 'sights_set', registryId: 'sign.sights_set' },
  { token: 'repetition', registryId: 'sign.repetition' },
];

const RULE_DIAG_BY_SIGN = {
  'sign.float': 'rules.deprecated_or_variant_symbol',
  'sign.billow': 'rules.catalog_deferred_no_template',
  'sign.weave': 'rules.catalog_deferred_no_template',
  'sign.entwine': 'rules.catalog_deferred_no_template',
  'sign.sign_of_wind': 'rules.ambiguous_symbol_semantics',
  'sign.aeriforms_defined': 'rules.ambiguous_symbol_semantics',
  'sign.glaives': 'rules.forbidden_body_affecting_symbol',
  'sign.sights_set': 'rules.forbidden_body_affecting_symbol',
  'sign.repetition': 'registry.legacy_sign_alias',
};

/** @param {object[]} effects */
function assertNoCatalogActiveEffects(effects) {
  for (const effect of effects) {
    assert.ok(!ACTIVE_EFFECT_KINDS.has(effect.kind), `unexpected active effect: ${effect.kind}`);
    assert.notEqual(effect.signRegistryId, 'sign.float');
    assert.notEqual(effect.kind, 'levitation_float');
    assert.notEqual(effect.effectKind, 'float');
  }
}

/** @param {object} compiled */
function assertNoFloatEffectNodes(compiled) {
  const activeNodes = compiled.graph.nodes.filter(
    (n) =>
      n.nodeType !== 'diagnostic_marker' &&
      n.nodeType !== 'unresolved_symbol' &&
      n.nodeType !== 'visual_only',
  );
  assert.equal(activeNodes.length, 0);
  assert.equal(
    compiled.graph.nodes.filter(
      (n) =>
        n.nodeType === 'force_constraint' &&
        (n.forceKind === 'float' || n.registryId === 'sign.float'),
    ).length,
    0,
  );
}

// VAL-FLOAT-001
test('VAL-FLOAT-001: sign_Float resolves in registry and lookup', () => {
  const lookup = lookupRegistrySpellMaker('sign_Float', 'sign');
  assert.equal(lookup.resolvedRegistryId, 'sign.float');
  assert.equal(lookup.official, true);

  const resolved = resolveSymbol('sign.float');
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.entry.registryId, 'sign.float');
  assert.equal(resolved.entry.activeInPrototype, false);
  assert.ok(isCatalogDeferredSign('sign.float'));
});

test('VAL-FLOAT-001: float fixture emits deprecated_or_variant_symbol without float effect', () => {
  for (const fixture of ['float-fire-deprecated.json', 'float-wind-deprecated.json']) {
    const compiled = compileSpell(loadFixture(fixture));
    const { effects, diagnostics } = flattenRuleEvaluation(
      evaluateRules(importSpell(loadFixture(fixture))),
    );

    assertNoCatalogActiveEffects(effects);
    assertNoFloatEffectNodes(compiled);

    assert.ok(
      diagnostics.some((d) => d.code === 'rules.deprecated_or_variant_symbol'),
      fixture,
    );
    assert.ok(
      compiled.diagnostics.some((d) => d.code === 'rules.deprecated_or_variant_symbol'),
      fixture,
    );
    assert.ok(
      diagnostics.some(
        (d) =>
          d.code === 'rules.deprecated_or_variant_symbol' &&
          (d.registryId === 'sign.float' || d.message.includes('sign.float')),
      ),
      fixture,
    );
  }
});

test('VAL-FLOAT-001: float does not compete with levitation when levitation also present', () => {
  const input = {
    title: 'float plus levitation contrast',
    seals: [
      {
        sigils: [{ name: 'fire' }],
        rings: [{ radius: 100 }],
        signProfiles: [
          {
            kind: 'float',
            amount: 2,
            size: 200,
            rotation: 0,
            angle: 0,
            radius: 70,
          },
          {
            kind: 'levitation',
            amount: 2,
            size: 240,
            rotation: 0,
            angle: 180,
            radius: 50,
          },
        ],
      },
    ],
  };
  const compiled = compileSpell(input);
  const levNodes = compiled.graph.nodes.filter(
    (n) => n.nodeType === 'force_constraint' && n.registryId === 'sign.levitation',
  );
  assert.equal(levNodes.length, 1);
  assert.equal(
    compiled.graph.nodes.filter((n) => n.registryId === 'sign.float').length,
    0,
  );
  assert.ok(
    compiled.diagnostics.some((d) => d.code === 'rules.deprecated_or_variant_symbol'),
  );
  assert.equal(
    levNodes.filter((n) => n.forceKind === 'float' && n.registryId === 'sign.float').length,
    0,
  );
});

// VAL-CATALOG-001
test('VAL-CATALOG-001: deferred catalog signs resolve in registry', () => {
  assert.deepEqual(CATALOG_DEFERRED_SIGN_IDS.sort(), [...CATALOG_DEFERRED_SIGN_IDS].sort());
  for (const { token, registryId } of CATALOG_SIGN_TOKENS) {
    const lookup = lookupRegistrySpellMaker(`sign_${token}`, 'sign');
    assert.equal(lookup.resolvedRegistryId, registryId, token);
    assert.equal(lookup.official, true, token);

    const resolved = resolveSymbol(registryId);
    assert.equal(resolved.resolved, true, registryId);
    assert.equal(resolved.entry.activeInPrototype, false, registryId);
    assert.ok(isCatalogDeferredSign(registryId), registryId);
  }
});

test('VAL-CATALOG-001: multi-domain deferred signs compile diagnostic-only', () => {
  const program = importSpell(loadFixture('catalog-deferred-multi-domain.json'));
  const { effects, diagnostics } = flattenRuleEvaluation(evaluateRules(program));
  const compiled = compileSpell(loadFixture('catalog-deferred-multi-domain.json'));

  assertNoCatalogActiveEffects(effects);
  assert.equal(
    compiled.graph.nodes.filter(
      (n) =>
        n.nodeType !== 'diagnostic_marker' &&
        n.nodeType !== 'unresolved_symbol' &&
        n.nodeType !== 'visual_only',
    ).length,
    0,
  );

  const billowSeals = ['seal:0', 'seal:1'];
  for (const sealId of billowSeals) {
    assert.ok(
      diagnostics.some(
        (d) => d.code === 'rules.catalog_deferred_no_template' && d.registryId === 'sign.billow',
      ),
      sealId,
    );
  }

  assert.ok(diagnostics.some((d) => d.code === 'rules.ambiguous_symbol_semantics'));
  assert.ok(diagnostics.some((d) => d.code === 'rules.forbidden_body_affecting_symbol'));

  for (const registryId of [
    'sign.billow',
    'sign.weave',
    'sign.entwine',
    'sign.sign_of_wind',
    'sign.aeriforms_defined',
    'sign.glaives',
    'sign.sights_set',
  ]) {
    assert.ok(
      diagnostics.some((d) => d.code === RULE_DIAG_BY_SIGN[registryId]),
      registryId,
    );
  }
});

test('VAL-CATALOG-001: repetition sign resolves but has no active rules', () => {
  const program = importSpell(loadFixture('repetition-diagnostic-only.json'));
  const instances = program.seals.flatMap((seal) =>
    (seal.symbols ?? []).filter(
      (s) =>
        s.objectId?.startsWith('sign-instance:') &&
        s.resolvedRegistryId === 'sign.repetition',
    ),
  );
  assert.ok(instances.length >= 2);
  for (const inst of instances) {
    assert.equal(inst.semanticEligibility, 'diagnostic_only');
  }

  const { effects, diagnostics } = flattenRuleEvaluation(evaluateRules(program));
  assertNoCatalogActiveEffects(effects);
  assert.ok(
    diagnostics.some(
      (d) =>
        d.code === 'registry.legacy_sign_alias' &&
        d.registryId === 'sign.repetition',
    ),
  );
  assert.equal(
    effects.filter((e) => e.signRegistryId === 'sign.repetition').length,
    0,
  );
});

test('VAL-CATALOG-001: M5 fixtures are synthetic not dossier clones', () => {
  for (const name of [
    'float-fire-deprecated.json',
    'float-wind-deprecated.json',
    'catalog-deferred-multi-domain.json',
    'repetition-diagnostic-only.json',
  ]) {
    const raw = readFileSync(path.join(fixturesDir, name), 'utf8').toLowerCase();
    assert.ok(!raw.includes('pyreball'), name);
    assert.ok(!raw.includes('floating drops'), name);
    assert.ok(!raw.includes('grasping'), name);
  }
});
