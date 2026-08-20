import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fromSpellMakerJson,
  toSpellMakerJson,
} from '../src/compiler/spell-maker-converter.js';
import { importSpell } from '../src/compiler/importer.js';

test('project signProfiles convert to WHA Spell Maker names and cleaned defaults', () => {
  const project = {
    title: 'Rotation vs angle',
    seals: [
      {
        rings: [{ radius: 100 }],
        sigils: [{ name: 'water' }],
        signProfiles: [
          {
            kind: 'column',
            amount: 4,
            size: 200,
            rotation: 45,
            angle: 30,
            radius: 80,
            skip: 1,
          },
        ],
      },
    ],
  };

  assert.deepEqual(toSpellMakerJson(project), {
    name: 'Rotation vs angle',
    author: '',
    seals: [
      {
        rings: [{ radius: 100 }],
        sigils: [{ name: 'sigil_Water' }],
        signs: [
          {
            name: 'sign_Column',
            angle: 30,
            radius: 80,
            amount: 4,
            amountSkip: 1,
            rotation: 45,
          },
        ],
      },
    ],
  });
});

test('project omissions that differ from website defaults are preserved explicitly', () => {
  const project = {
    seals: [
      {
        rings: [{}],
        sigils: [{ name: 'water' }],
        signProfiles: [{ kind: 'column' }],
      },
    ],
  };

  assert.deepEqual(toSpellMakerJson(project), {
    author: '',
    seals: [
      {
        rings: [{ radius: 0 }],
        sigils: [{ name: 'sigil_Water' }],
        signs: [{ name: 'sign_Column', radius: 0 }],
      },
    ],
  });
});

test('Sylph Shoes website JSON materializes omitted geometry defaults and round-trips cleanly', () => {
  const sylph = {
    name: 'Sylph Shoes',
    author: '',
    description:
      'The sylph shoes seal contains a central wind underfoot sigil surrounded by convergence and levitation signs.',
    seals: [
      {
        rings: [{ name: 'Main' }],
        sigils: [{ name: 'sigil_Wind Underfoot', size: 550 }],
        signs: [{ name: 'sign_Convergence' }, { name: 'sign_Levitation', rotation: 22 }],
      },
    ],
  };

  const project = fromSpellMakerJson(sylph);
  assert.deepEqual(project.seals[0].rings[0], {
    name: 'Main',
    radius: 450,
    weight: 10,
    openingSize: 0,
    openingAngle: 0,
    x: 0,
    y: 0,
  });
  assert.deepEqual(project.seals[0].signProfiles, [
    {
      kind: 'convergence',
      size: 200,
      angle: 0,
      offsetStrafe: 0,
      radius: 325,
      amount: 8,
      skip: 0,
      rotation: 0,
      offsetX: 0,
      offsetY: 0,
    },
    {
      kind: 'levitation',
      size: 200,
      angle: 0,
      offsetStrafe: 0,
      radius: 325,
      amount: 8,
      skip: 0,
      rotation: 22,
      offsetX: 0,
      offsetY: 0,
    },
  ]);
  assert.deepEqual(toSpellMakerJson(project), sylph);
});

test('Spell Maker repeated sigils stay in signs[] for importer compatibility', () => {
  const external = {
    author: '',
    seals: [
      {
        signs: [{ name: 'sigil_Fire', amount: 2, amountSkip: 1, rotation: 90 }],
      },
    ],
  };

  const project = fromSpellMakerJson(external);
  assert.deepEqual(project.seals[0].signs, [
    {
      name: 'sigil_Fire',
      size: 200,
      angle: 0,
      offsetStrafe: 0,
      radius: 325,
      amount: 2,
      skip: 1,
      rotation: 90,
      offsetX: 0,
      offsetY: 0,
    },
  ]);

  const program = importSpell(toSpellMakerJson(project));
  const fireInstances = program.seals[0].symbols.filter(
    (symbol) =>
      symbol.resolvedRegistryId === 'sigil.fire' &&
      symbol.objectId.startsWith('sigil-instance:'),
  );
  assert.equal(fireInstances.length, 1);
  assert.equal(fireInstances[0].geometry.placementRotationDeg, 90);
});
