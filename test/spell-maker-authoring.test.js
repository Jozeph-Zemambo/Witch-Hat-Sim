import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSpell } from '../src/compiler/compile.js';
import {
  SPELL_MAKER_SIGILS,
  SPELL_MAKER_SIGNS,
  buildSpellDocument,
  createSpellMakerDraft,
  createSpellSignGroup,
  resizeGroupFacings,
  resizeGroupPlacements,
  validateSpellMakerDraft,
} from '../src/spell-maker/authoring.js';

function normalizedAngle(value) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

test('authoring exposes only the five core sigils and three in-scope signs', () => {
  assert.deepEqual(SPELL_MAKER_SIGILS.map((item) => item.id), [
    'sigil.water', 'sigil.fire', 'sigil.earth', 'sigil.wind', 'sigil.light',
  ]);
  assert.deepEqual(SPELL_MAKER_SIGNS.map((item) => item.id), [
    'sign.column', 'sign.dispersion', 'sign.levitation',
  ]);
  assert.ok(!SPELL_MAKER_SIGNS.some((item) => item.id === 'sign.pull'));
});

test('document generation preserves group placement and per-instance facing at compiler boundary', () => {
  const draft = createSpellMakerDraft();
  draft.name = 'Turning Water';
  draft.sigilId = 'sigil.water';
  draft.groups = [createSpellSignGroup('group:test', {
    signId: 'sign.column',
    count: 3,
    rotationDeg: 30,
    size: 260,
    facingsDeg: [-25, 0, 40],
  })];

  const document = buildSpellDocument(draft);
  assert.equal(document.seals.length, 1);
  assert.deepEqual(document.seals[0].sigils, [{ name: 'water' }]);
  assert.deepEqual(
    document.seals[0].signProfiles.map((profile) => ({
      kind: profile.kind,
      amount: profile.amount,
      rotation: profile.rotation,
      angle: profile.angle,
      size: profile.size,
    })),
    [
      { kind: 'column', amount: 1, rotation: 120, angle: -25, size: 260 },
      { kind: 'column', amount: 1, rotation: -120, angle: 0, size: 260 },
      { kind: 'column', amount: 1, rotation: 0, angle: 40, size: 260 },
    ],
  );

  const compiled = compileSpell(document);
  assert.deepEqual(compiled.metadata.pipeline, ['import', 'registry', 'geometry', 'rules', 'graph']);
  const signs = compiled.program.seals[0].symbols.filter(
    (symbol) => symbol.objectId.startsWith('sign-instance:'),
  );
  assert.deepEqual(signs.map((symbol) => symbol.resolvedRegistryId), [
    'sign.column', 'sign.column', 'sign.column',
  ]);
  assert.deepEqual(
    signs.map((symbol) => normalizedAngle(symbol.geometry.polarAngleDeg)),
    [30, 150, -90],
  );
  assert.deepEqual(signs.map((symbol) => symbol.geometry.facingDeg), [-25, 0, 40]);
});

test('compiled signs preserve every authored position, radius, size, and facing', () => {
  const draft = createSpellMakerDraft();
  draft.groups = [createSpellSignGroup('group:placed-layout', {
    signId: 'sign.levitation',
    count: 4,
    rotationDeg: 17,
    positionsDeg: [-11, 78, 163, -104],
    radii: [51, 64, 77, 90],
    sizes: [100, 165, 230, 300],
    facingsDeg: [-130, -25, 45, 172],
  })];

  const compiled = compileSpell(buildSpellDocument(draft));
  const signs = compiled.program.seals[0].symbols.filter(
    (symbol) => symbol.objectId.startsWith('sign-instance:'),
  );

  assert.deepEqual(
    signs.map((symbol) => ({
      position: normalizedAngle(symbol.geometry.polarAngleDeg),
      radius: symbol.geometry.polarRadius,
      size: symbol.geometry.size,
      facing: symbol.geometry.facingDeg,
    })),
    [
      { position: 6, radius: 51, size: 100, facing: -130 },
      { position: 95, radius: 64, size: 165, facing: -25 },
      { position: -180, radius: 77, size: 230, facing: 45 },
      { position: -87, radius: 90, size: 300, facing: 172 },
    ],
  );
});

test('validation is actionable and never mutates an invalid draft', () => {
  const draft = {
    name: '   ',
    sigilId: null,
    groups: [{
      id: 'group:bad',
      signId: 'sign.pull',
      count: '2.5',
      rotationDeg: 'nope',
      size: 301,
      facingsDeg: [0],
    }],
  };
  const before = structuredClone(draft);
  const result = validateSpellMakerDraft(draft);
  assert.equal(result.valid, false);
  assert.equal(result.errors.name, undefined);
  assert.match(result.errors.sigilId, /core sigil/i);
  assert.match(result.errors['groups.group:bad.signId'], /Column, Dispersion, or Levitation/);
  assert.match(result.errors['groups.group:bad.count'], /whole number from 1 to 12/);
  assert.match(result.errors['groups.group:bad.rotationDeg'], /-360° to 360°/);
  assert.match(result.errors['groups.group:bad.size'], /100 to 300/);
  assert.deepEqual(draft, before);
  assert.throws(() => buildSpellDocument(draft), /invalid/i);
  assert.deepEqual(draft, before);
});

test('mixed sign groups are rejected instead of being silently rewritten', () => {
  const draft = createSpellMakerDraft();
  draft.groups = [
    createSpellSignGroup('group:column', { signId: 'sign.column', count: 1 }),
    createSpellSignGroup('group:levitation', { signId: 'sign.levitation', count: 1 }),
  ];
  const before = structuredClone(draft);

  const validation = validateSpellMakerDraft(draft);

  assert.equal(validation.valid, false);
  assert.equal(
    validation.errors['groups.group:levitation.signId'],
    'All sign groups in one seal must use the same sign.',
  );
  assert.deepEqual(draft, before);
  assert.throws(() => buildSpellDocument(draft), /Spell draft is invalid/);
});

test('spell names are optional while compilation keeps a safe internal title', () => {
  const draft = createSpellMakerDraft();
  const validation = validateSpellMakerDraft(draft);
  assert.equal(validation.valid, true);
  assert.equal(buildSpellDocument(draft).title, 'Untitled spell');
  assert.equal(draft.name, '');
});

test('facing controls resize without overwriting existing instance angles', () => {
  const group = createSpellSignGroup('group:resize', {
    count: 2,
    facingsDeg: [15, -20],
  });
  assert.deepEqual(resizeGroupFacings(group, 4), [15, -20, 0, 0]);
  assert.deepEqual(resizeGroupFacings(group, 1), [15]);
});

test('count changes preserve surviving sign placements and radii', () => {
  const group = createSpellSignGroup('group:placements', {
    count: 3,
    positionsDeg: [11, 77, -133],
    radii: [61, 72, 83],
  });
  assert.deepEqual(resizeGroupPlacements(group, 5), {
    positionsDeg: [11, 77, -133, 216, 288],
    radii: [61, 72, 83, '', ''],
  });
  assert.deepEqual(resizeGroupPlacements(group, 2), {
    positionsDeg: [11, 77],
    radii: [61, 72],
  });
});
