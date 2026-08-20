/**
 * Registry resolution tests (VAL-REGISTRY-001..003).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSymbol,
  getSignOperatorDefinition,
  PROTOTYPE_SIGIL_IDS,
  PROTOTYPE_SIGN_IDS,
} from '../src/compiler/registry.js';

// VAL-REGISTRY-001
test('VAL-REGISTRY-001: prototype sigils resolve with stable category and domain', () => {
  const expectedDomains = {
    'sigil.water': 'water',
    'sigil.fire': 'fire_heat',
    'sigil.earth': 'earth_solid',
    'sigil.wind': 'wind_air',
    'sigil.light': 'light',
    'sigil.repetition': 'repeat',
  };

  assert.deepEqual(PROTOTYPE_SIGIL_IDS, Object.keys(expectedDomains));

  for (const id of PROTOTYPE_SIGIL_IDS) {
    const result = resolveSymbol(id);
    assert.equal(result.resolved, true, id);
    assert.equal(result.registryId, id);
    assert.equal(result.entry.category, 'sigil');
    assert.equal(result.entry.domain, expectedDomains[id]);
    assert.equal(result.entry.provenanceClass, 'official');
    assert.equal(result.diagnostic, null);
  }
});

test('VAL-REGISTRY-001b: material and subelement profiles resolve', () => {
  const water = resolveSymbol('material.water');
  assert.equal(water.resolved, true);
  assert.equal(water.entry.category, 'material');
  assert.equal(water.entry.materialProfile.materialFamily, 'water');

  const heat = resolveSymbol('subelement.heat');
  assert.equal(heat.resolved, true);
  assert.equal(heat.entry.category, 'subelement');
  assert.equal(heat.entry.subelementProfile.driverKind, 'temperature_driver');

  const glow = resolveSymbol('subelement.glow');
  assert.equal(glow.entry.subelementProfile.thermalByDefault, false);
});

// VAL-REGISTRY-002
test('VAL-REGISTRY-002: prototype signs resolve with deterministic metadata and provenance class', () => {
  assert.deepEqual(PROTOTYPE_SIGN_IDS, [
    'sign.column',
    'sign.levitation',
    'sign.radial',
    'sign.crosshair',
    'sign.cool',
    'sign.crush',
    'sign.strengthen',
  ]);

  const column = resolveSymbol('sign.column');
  assert.equal(column.entry.category, 'sign');
  assert.equal(column.entry.provenanceClass, 'official');
  assert.ok(column.entry.geometryApplicability.includes('sym'));
  assert.equal(column.entry.operatorDefinition.operatorFamily, 'field_emit');
  assert.equal(column.entry.operatorDefinition.polarity, 'push_through_center');

  const levitation = resolveSymbol('sign.levitation');
  assert.equal(levitation.entry.provenanceClass, 'official');

  const radial = resolveSymbol('sign.radial');
  assert.equal(radial.entry.provenanceClass, 'custom_project_supported');
  assert.equal(radial.entry.operatorDefinition.operatorFamily, 'weaken_modifier_source');
  assert.equal(radial.entry.operatorDefinition.exactCount, 2);

  const crosshair = resolveSymbol('sign.crosshair');
  assert.equal(crosshair.entry.provenanceClass, 'custom_project_supported');
  assert.notEqual(crosshair.entry.provenanceClass, 'official');
  assert.equal(crosshair.entry.operatorDefinition.operatorFamily, 'scope_filter');

  const cool = resolveSymbol('sign.cool');
  assert.equal(cool.resolved, true);
  assert.equal(cool.entry.provenanceClass, 'official');

  const strengthen = resolveSymbol('sign.strengthen');
  assert.equal(strengthen.resolved, true);
  assert.equal(strengthen.entry.provenanceClass, 'official');
});

test('VAL-REGISTRY-002b: sign operator definitions are cloned lookup metadata', () => {
  const first = getSignOperatorDefinition('sign.column');
  const second = getSignOperatorDefinition('sign.column');
  assert.equal(first.operatorFamily, 'field_emit');
  first.operatorFamily = 'mutated';
  assert.equal(second.operatorFamily, 'field_emit');
  assert.equal(getSignOperatorDefinition('sign.unknown'), null);
});

test('VAL-REGISTRY-002c: Wave 2 signs expose additive operator definitions', () => {
  const expected = {
    'sign.dispersion': 'field_emit',
    'sign.levitation': 'lift_motion',
    'sign.pull': 'field_attract',
    'sign.region': 'scope_boundary',
    'sign.convergence': 'field_focus',
    'sign.collection': 'material_intake',
    'sign.gather': 'material_intake',
    'sign.float': 'gravity_override',
  };

  for (const [registryId, operatorFamily] of Object.entries(expected)) {
    const resolved = resolveSymbol(registryId);
    assert.equal(resolved.resolved, true, registryId);
    assert.equal(resolved.entry.operatorDefinition.operatorFamily, operatorFamily);
    assert.equal(getSignOperatorDefinition(registryId).operatorFamily, operatorFamily);
  }

  const float = getSignOperatorDefinition('sign.float');
  assert.equal(float.diagnosticOnly, true);
  assert.equal(resolveSymbol('sign.float').entry.activeInPrototype, false);
});

// VAL-REGISTRY-003
test('VAL-REGISTRY-003: unknown IDs emit diagnostics without partial registry entries', () => {
  const unknown = resolveSymbol('sigil.unknown_moon');
  assert.equal(unknown.resolved, false);
  assert.equal(unknown.registryId, null);
  assert.equal(unknown.entry, null);
  assert.equal(unknown.registryCandidate, 'sigil.unknown_moon');
  assert.ok(unknown.diagnostic);
  assert.equal(unknown.diagnostic.code, 'registry.unsupported_symbol');
  assert.equal(unknown.diagnostic.conservativeFallback, 'unsupported_symbol');
});
