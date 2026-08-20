import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthoredSpellTemplate } from '../src/spell-maker/templatePersistence.js';
import {
  createSpellMakerDraft,
  createSpellSignGroup,
} from '../../src/spell-maker/authoring.js';
import { useSpellStore } from '../src/store.js';

function normalizedAngle(value) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

test('authored spell becomes an immutable template through the existing compiler pipeline', () => {
  const draft = createSpellMakerDraft();
  draft.name = 'Maker Wind Lift';
  draft.sigilId = 'sigil.wind';
  draft.groups = [createSpellSignGroup('group:lift', {
    signId: 'sign.levitation',
    count: 2,
    rotationDeg: 45,
    size: 280,
    sizes: [140, 280],
    facingsDeg: [10, -35],
    radii: [62, 84],
  })];

  const result = createAuthoredSpellTemplate(draft, 'spell-template:1');
  assert.equal(result.ok, true);
  assert.equal(result.template.source, 'spell_maker');
  assert.equal(result.template.name, 'Maker Wind Lift');
  assert.deepEqual(result.template.compileResult.metadata.pipeline, [
    'import', 'registry', 'geometry', 'rules', 'graph',
  ]);
  assert.notStrictEqual(result.template.compileResult, result.compileResult);
  assert.notStrictEqual(result.template.authoredDocument, result.document);
  assert.deepEqual(
    result.template.authoredDocument.seals[0].signProfiles.map((profile) => profile.size),
    [140, 280],
  );
  assert.ok(result.template.authoredDocument.seals[0].signProfiles.every(
    (profile) => profile.nativeLayoutMode === 'fixed',
  ));
  const renderedSigns = result.template.compileResult.program.seals[0].symbols.filter(
    (symbol) => symbol.categoryHint === 'sign' && !symbol.objectId.includes('generator'),
  );
  assert.deepEqual(renderedSigns.map((symbol) => symbol.geometry.size), [140, 280]);
  assert.deepEqual(renderedSigns.map((symbol) => symbol.geometry.polarRadius), [62, 84]);
  assert.deepEqual(renderedSigns.map((symbol) => symbol.geometry.polarAngleDeg), [45, -135]);
  assert.deepEqual(renderedSigns.map((symbol) => symbol.geometry.facingDeg), [10, -35]);
  assert.ok(renderedSigns.every((symbol) => symbol.geometry.nativeLayoutMode === 'fixed'));

  draft.name = 'Mutated after save';
  draft.groups[0].facingsDeg[0] = 300;
  result.document.title = 'Mutated returned document';
  result.compileResult.program.title = 'Mutated returned compile';
  assert.equal(result.template.name, 'Maker Wind Lift');
  assert.equal(result.template.authorDraft.groups[0].facingsDeg[0], 10);
  assert.equal(result.template.authoredDocument.title, 'Maker Wind Lift');
  assert.equal(result.template.compileResult.program.title, 'Maker Wind Lift');
});

test('placed spell render data retains each sign pose from the authoring canvas', () => {
  useSpellStore.setState({
    spellTemplates: [],
    placedSpells: [],
    selectedSpellTemplateId: null,
    selectedPlacedSpellId: null,
    nextSpellTemplateIndex: 1,
    nextPlacedSpellIndex: 1,
  });
  const draft = createSpellMakerDraft();
  draft.name = 'Placed layout proof';
  draft.groups = [createSpellSignGroup('group:layout-proof', {
    signId: 'sign.dispersion',
    count: 3,
    rotationDeg: 23,
    positionsDeg: [-15, 102, -137],
    radii: [53, 71, 89],
    sizes: [115, 205, 295],
    facingsDeg: [-72, 19, 146],
  })];

  const saved = useSpellStore.getState().saveAuthoredSpell(draft);
  assert.equal(saved.ok, true);
  const placedSpellId = useSpellStore.getState().placeSelectedSpell({ x: 0, y: 0, z: 0 });
  const placed = useSpellStore.getState().placedSpells.find((spell) => spell.id === placedSpellId);
  const circle = placed.runtimeResult.intents.find(
    (intent) => intent.intentType === 'spell_circle_render_data',
  );
  const signs = circle.seals[0].symbols.filter((symbol) => symbol.categoryHint === 'sign');

  assert.deepEqual(
    signs.map((symbol) => ({
      glyph: symbol.registryId,
      position: normalizedAngle(symbol.polarAngleDeg),
      radius: symbol.polarRadius,
      size: symbol.size,
      facing: symbol.facingDeg,
    })),
    [
      { glyph: 'sign.dispersion', position: 8, radius: 53, size: 115, facing: -72 },
      { glyph: 'sign.dispersion', position: 125, radius: 71, size: 205, facing: 19 },
      { glyph: 'sign.dispersion', position: -114, radius: 89, size: 295, facing: 146 },
    ],
  );
});

test('invalid authoring returns field errors without changing the draft', () => {
  const draft = createSpellMakerDraft();
  draft.name = 'Kept draft';
  draft.groups[0].count = 0;
  const before = structuredClone(draft);
  const result = createAuthoredSpellTemplate(draft, 'spell-template:1');
  assert.equal(result.ok, false);
  assert.match(result.validation.errors['groups.group:1.count'], /whole number/);
  assert.deepEqual(draft, before);
});

test('Spellpad edits affect only future placements and manager edits affect only one placed spell', () => {
  useSpellStore.setState({
    spellTemplates: [],
    placedSpells: [],
    selectedSpellTemplateId: null,
    selectedPlacedSpellId: null,
    nextSpellTemplateIndex: 1,
    nextPlacedSpellIndex: 1,
  });
  const firstDraft = createSpellMakerDraft();
  firstDraft.name = 'Original water';
  const first = useSpellStore.getState().saveAuthoredSpell(firstDraft);
  assert.equal(first.ok, true);
  const placedOneId = useSpellStore.getState().placeSelectedSpell({ x: 1, y: 0, z: 2 });
  const placedTwoId = useSpellStore.getState().placeSelectedSpell({ x: -2, y: 0, z: 3 });

  useSpellStore.getState().updatePlacedSpellTransform(placedOneId, {
    scale: 1.75,
    pitchDeg: 24,
    yawDeg: -18,
  });
  useSpellStore.getState().setPlacedSpellMode(placedTwoId, 'toggled');
  useSpellStore.getState().activatePlacedSpell(placedTwoId);
  useSpellStore.getState().selectPlacedSpell(placedTwoId);

  const before = useSpellStore.getState();
  const beforePlaced = structuredClone(before.placedSpells);
  const editedDraft = structuredClone(before.spellTemplates[0].authorDraft);
  editedDraft.name = 'Future wind';
  editedDraft.sigilId = 'sigil.wind';

  const result = useSpellStore.getState().saveAuthoredSpell(editedDraft, first.templateId);
  assert.equal(result.ok, true);
  assert.equal(useSpellStore.getState().spellTemplates[0].name, 'Future wind');
  assert.deepEqual(useSpellStore.getState().placedSpells, beforePlaced);

  useSpellStore.getState().renameSpellTemplate(first.templateId, 'Future wind renamed');
  assert.ok(useSpellStore.getState().placedSpells.every((spell) => spell.name === 'Original water'));

  const futurePlacementId = useSpellStore.getState().placeSelectedSpell({ x: 8, y: 0, z: 9 });
  const futurePlacement = useSpellStore.getState().placedSpells.find(
    (spell) => spell.id === futurePlacementId,
  );
  assert.equal(futurePlacement.name, 'Future wind renamed');
  assert.equal(futurePlacement.compileResult.program.title, 'Future wind');

  useSpellStore.getState().selectPlacedSpell(placedTwoId);
  const managerDraft = structuredClone(
    useSpellStore.getState().placedSpells.find((spell) => spell.id === placedTwoId).authorDraft,
  );
  managerDraft.name = 'Manager-only earth';
  managerDraft.sigilId = 'sigil.earth';
  const managerResult = useSpellStore.getState().saveAuthoredPlacedSpell(managerDraft, placedTwoId);
  assert.equal(managerResult.ok, true);
  const afterManager = useSpellStore.getState();
  const placedOne = afterManager.placedSpells.find((spell) => spell.id === placedOneId);
  const placedTwo = afterManager.placedSpells.find((spell) => spell.id === placedTwoId);
  assert.equal(afterManager.spellTemplates[0].name, 'Future wind renamed');
  assert.equal(placedOne.name, 'Original water');
  assert.equal(placedTwo.name, 'Manager-only earth');
  assert.equal(placedTwo.compileResult.program.title, 'Manager-only earth');
  assert.equal(futurePlacement.name, 'Future wind renamed');
  assert.deepEqual(placedOne.transform, beforePlaced[0].transform);
  assert.equal(placedTwo.activationMode, beforePlaced[1].activationMode);
  assert.equal(placedTwo.spellActive, beforePlaced[1].spellActive);
  assert.equal(afterManager.selectedPlacedSpellId, placedTwoId);

  const beforeInvalid = structuredClone({
    templates: afterManager.spellTemplates,
    placed: afterManager.placedSpells.map((spell) => ({
      id: spell.id,
      name: spell.name,
      compileResult: spell.compileResult,
      authorDraft: spell.authorDraft,
    })),
  });
  const invalidDraft = structuredClone(managerDraft);
  invalidDraft.groups[0].count = 0;
  const invalid = useSpellStore.getState().saveAuthoredPlacedSpell(invalidDraft, placedTwoId);
  assert.equal(invalid.ok, false);
  assert.deepEqual(
    {
      templates: useSpellStore.getState().spellTemplates,
      placed: useSpellStore.getState().placedSpells.map((spell) => ({
        id: spell.id,
        name: spell.name,
        compileResult: spell.compileResult,
        authorDraft: spell.authorDraft,
      })),
    },
    beforeInvalid,
  );
});

test('imported templates remain placeable but cannot enter the structured editor', () => {
  useSpellStore.setState({
    spellTemplates: [],
    placedSpells: [],
    selectedSpellTemplateId: null,
    selectedPlacedSpellId: null,
    nextSpellTemplateIndex: 1,
    nextPlacedSpellIndex: 1,
  });
  useSpellStore.getState().selectSample('watershot-centered');
  useSpellStore.getState().compileCurrent();
  const importedId = useSpellStore.getState().saveCurrentToSpellpad();
  const imported = useSpellStore.getState().spellTemplates.find((template) => template.id === importedId);
  assert.equal(imported.authorDraft, undefined);
  const placedId = useSpellStore.getState().placeSelectedSpell({ x: 0, y: 0, z: 0 });
  assert.ok(placedId);
  assert.equal(useSpellStore.getState().placedSpells[0].authorDraft, null);
  const result = useSpellStore.getState().saveAuthoredSpell(createSpellMakerDraft(), importedId);
  assert.equal(result.ok, false);
  assert.match(result.error, /unavailable/i);
});

test('blocked local storage does not break live world placement', () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      setItem() {
        throw new DOMException('Storage is blocked', 'SecurityError');
      },
    },
  });

  try {
    useSpellStore.setState({
      placedAssets: [],
      placedMechanicsBuilds: [],
      nextPlacedAssetIndex: 1,
    });
    assert.doesNotThrow(() => {
      useSpellStore.getState().placeAsset('shape:cuboid', {
        point: { x: 1, y: 0, z: 2 },
        normal: { x: 0, y: 1, z: 0 },
      });
    });
    assert.equal(useSpellStore.getState().placedAssets.length, 1);
  } finally {
    if (originalDescriptor) Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
    else delete globalThis.localStorage;
  }
});
