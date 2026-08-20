/**
 * VAL-SPEC-001: Spec documents official sign synthesis rules (structural / grep checks).
 * VAL-LOCK-001: Full suite run includes locked-regression.test.js (no duplicate assertions here).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} rel */
function readSpec(rel) {
  return readFileSync(path.join(repoRoot, rel), 'utf8');
}

/**
 * @param {string} label
 * @param {string} haystack
 * @param {(string|RegExp)[]} needles
 */
function assertSpecMentions(label, haystack, needles) {
  for (const needle of needles) {
    const ok =
      typeof needle === 'string' ? haystack.includes(needle) : needle.test(haystack);
    assert.ok(ok, `${label}: expected spec to mention ${String(needle)}`);
  }
}

const symbolSemantics = readSpec('spec/symbol-semantics.md');
const magicEngine = readSpec('spec/magic-engine.md');
const combined = `${symbolSemantics}\n${magicEngine}`;

// VAL-SPEC-001
test('VAL-SPEC-001: symbol-semantics documents M6 official sign synthesis section', () => {
  assertSpecMentions('symbol-semantics', symbolSemantics, [
    'Official signs synthesis (M6 compiler contract)',
    'VAL-SPEC-001',
    'sign-first',
    'column-parity',
  ]);
});

test('VAL-SPEC-001: outward dispersion equals inverted or outward column', () => {
  assertSpecMentions('outward dispersion', combined, [
    'RULE_GEOM_OUTWARD_DISPERSION_LIKE',
    /outward_dispersion/,
    /inverted column|outward-facing.*column/i,
  ]);
});

test('VAL-SPEC-001: crush water mist documented', () => {
  assertSpecMentions('crush water mist', combined, [
    'RULE_SIGN_CRUSH_WATER_MIST',
    'crush_water_mist',
    /water.*mist|mist.*water/i,
  ]);
});

test('VAL-SPEC-001: standalone cool documented', () => {
  assertSpecMentions('standalone cool', combined, [
    'RULE_STANDALONE_COOL_CENTER_GROUP',
    'temperature_driver',
    /without.*crosshair|no crosshair/i,
  ]);
});

test('VAL-SPEC-001: sign-first pull region collection gather convergence documented', () => {
  assertSpecMentions('sign-first directional/source signs', combined, [
    'RULE_SIGN_PULL_UNIFORM',
    'RULE_SIGN_REGION_UNIFORM',
    'RULE_SIGN_COLLECTION_UNIFORM',
    'RULE_SIGN_GATHER_UNIFORM',
    'RULE_SIGN_CONVERGENCE_POINT_FOCUS',
    /sign-first/i,
  ]);
});

test('VAL-SPEC-001: float deprecated and heat Crosshair-only documented', () => {
  assertSpecMentions('float deprecated', combined, [
    'REJECT_FLOAT_DETACHED_OUTPUT',
    /deprecated/i,
    'sign.float',
  ]);
  assertSpecMentions('heat crosshair-only', combined, [
    'RULE_HEAT_CROSSHAIR_ONLY',
    /Crosshair-only|crosshair-only/i,
    'temperature_driver',
  ]);
});

test('VAL-SPEC-001: magic-engine M6 integration section references locked custom signs unchanged', () => {
  assertSpecMentions('magic-engine M6', magicEngine, [
    'Official signs synthesis (M6 integration)',
    'VAL-SPEC-001',
    'VAL-LOCK-001',
    'sign.radial',
    'sign.crosshair',
  ]);
});

test('VAL-SPEC-001: magic-engine dossier-to-rule trace includes official sign rule IDs', () => {
  const traceStart = magicEngine.indexOf('## Dossier-to-rule trace examples');
  assert.ok(traceStart >= 0, 'expected dossier-to-rule trace section');
  const traceSection = magicEngine.slice(traceStart, traceStart + 6000);
  assertSpecMentions('trace section', traceSection, [
    'RULE_GEOM_OUTWARD_DISPERSION_LIKE',
    'RULE_SIGN_PULL_UNIFORM',
    'RULE_HEAT_CROSSHAIR_ONLY',
  ]);
});

test('VAL-SPEC-001: public specs describe state graph instead of stale modifier graph terms', () => {
  assert.equal(/\bthermal_field\b/.test(combined), false);
  assert.equal(/\bcold_field\b/.test(combined), false);
  assert.equal(/\bapplies_modifier\b/.test(combined), false);
  assert.ok(combined.includes('temperature_driver'));
  assert.ok(combined.includes('phase_state'));
  assert.ok(combined.includes('stabilizes_state'));
});
