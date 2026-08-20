import test from 'node:test';
import assert from 'node:assert/strict';
import { MATERIAL_PROFILES } from '../src/compiler/registry.js';
import { phaseFromSpecificEnergy, stepSpecificEnergy } from '../src/compiler/material-state.js';

test('material state helper classifies water phase from bounded specific energy', () => {
  const water = MATERIAL_PROFILES['material.water'];
  assert.equal(phaseFromSpecificEnergy(water, -1), 'solid');
  assert.equal(phaseFromSpecificEnergy(water, 0.55), 'liquid');
  assert.equal(phaseFromSpecificEnergy(water, 2), 'vapor');
});

test('material state helper steps thermal drivers deterministically and clamps bounds', () => {
  const water = MATERIAL_PROFILES['material.water'];
  const heated = stepSpecificEnergy(
    { materialProfile: water, specificEnergy: 0.95 },
    { direction: 'heat', strength: 0.2 },
    2,
  );
  assert.equal(heated.specificEnergy, 1);
  assert.equal(heated.phase, 'vapor');
  assert.equal(heated.bounded, true);

  const cooled = stepSpecificEnergy(
    { materialProfile: water, specificEnergy: 0.1 },
    { direction: 'cool', strength: 0.2 },
    2,
  );
  assert.equal(cooled.specificEnergy, 0);
  assert.equal(cooled.phase, 'solid');
});

test('retention gain slows specific-energy stepping without becoming direct temperature boost', () => {
  const water = MATERIAL_PROFILES['material.water'];
  const plain = stepSpecificEnergy(
    { materialProfile: water, specificEnergy: 0.5 },
    { direction: 'heat', strength: 0.2 },
    1,
  );
  const retained = stepSpecificEnergy(
    { materialProfile: water, specificEnergy: 0.5 },
    { direction: 'heat', strength: 0.2, retentionGain: 1 },
    1,
  );
  assert.equal(plain.specificEnergy, 0.7);
  assert.equal(retained.specificEnergy, 0.6);
});
