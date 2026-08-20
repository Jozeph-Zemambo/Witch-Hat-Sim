import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWrenchPickTarget } from '../src/scene/wrenchPicking.js';

function objectWithUserData(userData, parent = null) {
  return { userData, parent };
}

test('bound spell yields to its exact ray-hit host but remains selectable beyond the host', () => {
  const spellObject = objectWithUserData({ placedSpellId: 'placed-spell:1' });
  const hostObject = objectWithUserData({ sceneAsset: { type: 'prop', id: 'prop:practice-cube' } });
  const otherObject = objectWithUserData({ sceneAsset: { type: 'prop', id: 'prop:small-practice-cube' } });
  const spells = [{
    id: 'placed-spell:1',
    binding: {
      surfaceKind: 'prop',
      surfaceTargetId: 'prop:practice-cube',
      bodyId: 'prop:prop:practice-cube',
    },
  }];

  assert.deepEqual(resolveWrenchPickTarget([
    { object: spellObject, distance: 2 },
    { object: hostObject, distance: 2.02 },
  ], spells), { kind: 'prop', id: 'prop:practice-cube', distance: 2.02 });

  assert.deepEqual(resolveWrenchPickTarget([
    { object: spellObject, distance: 2 },
  ], spells), { kind: 'spell', id: 'placed-spell:1', distance: 2 });

  assert.deepEqual(resolveWrenchPickTarget([
    { object: spellObject, distance: 2 },
    { object: otherObject, distance: 2.02 },
  ], spells), { kind: 'spell', id: 'placed-spell:1', distance: 2 });
});

test('explicitly unbound spells never redirect wrench selection to their old anchor', () => {
  const spellObject = objectWithUserData({ placedSpellId: 'placed-spell:1' });
  const hostObject = objectWithUserData({ sceneAsset: { type: 'prop', id: 'prop:practice-cube' } });
  const spells = [{
    id: 'placed-spell:1',
    binding: null,
    anchor: { surfaceKind: 'prop', surfaceTargetId: 'prop:practice-cube' },
  }];
  assert.deepEqual(resolveWrenchPickTarget([
    { object: spellObject, distance: 2 },
    { object: hostObject, distance: 2.02 },
  ], spells), { kind: 'spell', id: 'placed-spell:1', distance: 2 });
});
