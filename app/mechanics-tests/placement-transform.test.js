import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  mergePlacementTransform,
  normalizePlacementTransform,
  validatePlacementTransformPatch,
} from '../src/mechanics/placementTransforms.js';
import { MainWorldRapierRuntime } from '../src/world-physics/MainWorldRapierRuntime.js';
import {
  DEFAULT_PLACED_SPELL_SCALE,
  MIN_PLACED_SPELL_SCALE,
  useSpellStore,
} from '../src/store.js';
import { createSpellMakerDraft } from '../../src/spell-maker/authoring.js';
import { createDefaultSceneState } from '../../src/simulation-engine/index.js';
import { rotateVector } from '../../src/mechanics-engine/index.js';

test('placement transform math normalizes quaternion and preserves partial edits', () => {
  const normalized = normalizePlacementTransform({
    position: { x: 2, y: 'bad', z: -3 },
    rotation: { x: 0, y: 2, z: 0, w: 0 },
    scale: { x: -2, y: 0, z: 4 },
  });
  assert.deepEqual(normalized.position, { x: 2, y: 0, z: -3 });
  assert.deepEqual(normalized.rotation, { x: 0, y: 1, z: 0, w: 0 });
  assert.deepEqual(normalized.scale, { x: 2, y: 0.05, z: 4 });

  const merged = mergePlacementTransform(normalized, { position: { y: 7 }, scale: 3 });
  assert.deepEqual(merged.position, { x: 2, y: 7, z: -3 });
  assert.deepEqual(merged.scale, { x: 3, y: 3, z: 3 });
  assert.equal(validatePlacementTransformPatch({ rotation: { x: Number.NaN } }).ok, false);
  assert.equal(validatePlacementTransformPatch({ scale: 0 }).ok, true);
});

test('generic store action updates asset placement and rejects invalid input atomically', () => {
  const store = useSpellStore.getState();
  const id = store.placeAsset('shape:cuboid', { point: { x: 0, y: 0, z: 0 } });
  assert.ok(id);
  assert.equal(useSpellStore.getState().updatePlacementTransform({
    kind: 'asset',
    id,
    position: { x: 2, y: 1, z: -4 },
    rotation: { x: 0, y: 0.70710678, z: 0, w: 0.70710678 },
    scale: { x: 2, y: 1, z: 0.5 },
  }), true);
  assert.deepEqual(useSpellStore.getState().placedAssets.find((item) => item.id === id).transform.position, { x: 2, y: 1, z: -4 });
  const before = useSpellStore.getState().placedAssets.find((item) => item.id === id).transform;
  assert.equal(useSpellStore.getState().updatePlacementTransform({ kind: 'asset', id, scale: { x: Infinity } }), false);
  assert.deepEqual(useSpellStore.getState().placedAssets.find((item) => item.id === id).transform, before);
  useSpellStore.getState().removePlacedAsset(id);
});

test('placed Spellpad scale drives its circle, signs, and compiled output geometry', () => {
  useSpellStore.setState({
    spellTemplates: [],
    selectedSpellTemplateId: null,
    placedSpells: [],
    selectedPlacedSpellId: null,
    nextSpellTemplateIndex: 1,
    nextPlacedSpellIndex: 1,
    worldHistoryPast: [],
    worldHistoryFuture: [],
    worldEditTransaction: null,
  });
  const draft = createSpellMakerDraft();
  draft.name = 'Spellpad scale contract';
  assert.equal(useSpellStore.getState().saveAuthoredSpell(draft).ok, true);
  const spellId = useSpellStore.getState().placeSelectedSpell({
    point: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
  });
  const outputFor = () => useSpellStore.getState().placedSpells
    .find((spell) => spell.id === spellId)
    .runtimeResult.intents.find((intent) =>
      ['water_column', 'material_column'].includes(intent.intentType),
    );
  const baseOutput = outputFor();

  useSpellStore.getState().updatePlacedSpellTransform(spellId, {
    scale: MIN_PLACED_SPELL_SCALE,
  });
  let spell = useSpellStore.getState().placedSpells.find((item) => item.id === spellId);
  let circle = spell.runtimeResult.intents.find(
    (intent) => intent.intentType === 'spell_circle_render_data',
  );
  let output = outputFor();
  const smallerRatio = MIN_PLACED_SPELL_SCALE / DEFAULT_PLACED_SPELL_SCALE;

  assert.deepEqual(spell.placementTransform.scale, {
    x: MIN_PLACED_SPELL_SCALE,
    y: MIN_PLACED_SPELL_SCALE,
    z: MIN_PLACED_SPELL_SCALE,
  });
  assert.ok(
    Math.abs(circle.placementFrame.worldScale - MIN_PLACED_SPELL_SCALE) < 1e-9,
  );
  assert.equal(
    output.physicsField.length,
    Number((baseOutput.physicsField.length * smallerRatio).toFixed(4)),
  );
  assert.equal(
    output.physicsField.radius,
    Number((baseOutput.physicsField.radius * smallerRatio).toFixed(4)),
  );

  assert.equal(useSpellStore.getState().updatePlacementTransform({
    kind: 'spell',
    id: spellId,
    scale: 0.4,
  }), true);
  spell = useSpellStore.getState().placedSpells.find((item) => item.id === spellId);
  circle = spell.runtimeResult.intents.find(
    (intent) => intent.intentType === 'spell_circle_render_data',
  );
  output = outputFor();
  const largerRatio = 0.4 / DEFAULT_PLACED_SPELL_SCALE;
  assert.ok(Math.abs(circle.placementFrame.worldScale - 0.4) < 1e-9);
  assert.equal(
    output.physicsField.length,
    Number((baseOutput.physicsField.length * largerRatio).toFixed(4)),
  );
  assert.equal(
    output.physicsField.radius,
    Number((baseOutput.physicsField.radius * largerRatio).toFixed(4)),
  );
});

test('every yard practice block uses the shared wrench prop contract without an asset-library entry', async () => {
  const scene = createDefaultSceneState();
  const practiceCube = scene.props.find((item) => item.id === 'prop:practice-cube');
  const smallPracticeCube = scene.props.find((item) => item.id === 'prop:small-practice-cube');
  const practiceCrates = scene.props.filter((item) => item.visualKind === 'practice_crate');
  assert.equal(practiceCube.label, 'Practice cube');
  assert.equal(smallPracticeCube.label, 'Small practice cube');
  assert.equal(smallPracticeCube.targetRole, 'generic_practice_prop');
  assert.notEqual(smallPracticeCube.visualKind, 'activation_ring_key');
  assert.deepEqual(practiceCrates.map((item) => item.label), ['Practice cube 2', 'Practice cube 3']);
  assert.equal(practiceCrates.every((item) => item.targetRole === 'generic_practice_prop'), true);
  assert.equal(scene.props.some((item) => item.targetRole === 'activation_ring_mechanical_key'), false);

  useSpellStore.setState({
    props: scene.props,
    worldHistoryPast: [],
    worldHistoryFuture: [],
    worldEditTransaction: null,
  });
  const rotation = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
  assert.equal(useSpellStore.getState().updatePlacementTransform({
    kind: 'prop',
    id: smallPracticeCube.id,
    position: { x: 3, y: 1.25, z: -2 },
    rotation,
    scale: { x: 1.5, y: 0.75, z: 2 },
  }), true);
  const transformed = useSpellStore.getState().props.find((item) => item.id === smallPracticeCube.id);
  assert.deepEqual(transformed.position, { x: 3, y: 1, z: -2 });
  assert.ok(Math.abs(transformed.rotation.y - rotation.y) < 1e-12);
  assert.ok(Math.abs(transformed.rotation.w - rotation.w) < 1e-12);
  assert.deepEqual(transformed.scale, { x: 1.5, y: 0.75, z: 2 });
  assert.equal(useSpellStore.getState().undoWorldEdit(), true);
  assert.deepEqual(
    useSpellStore.getState().props.find((item) => item.id === smallPracticeCube.id).position,
    smallPracticeCube.position,
  );

  await RAPIER.init();
  const runtime = new MainWorldRapierRuntime(RAPIER, { props: scene.props });
  assert.equal(runtime.updatePlacementTransform({
    kind: 'practice-cube',
    id: practiceCube.id,
    position: { x: 4, y: 1.25, z: 2 },
    rotation,
    scale: { x: 2, y: 1, z: 0.5 },
  }), true);
  const body = runtime.getSnapshot().bodies[`prop:${practiceCube.id}`];
  assert.equal(body.placementKind, 'prop');
  assert.equal(body.placementId, practiceCube.id);
  assert.deepEqual(body.position, { x: 4, y: 1.25, z: 2 });
  assert.deepEqual(body.scale, { x: 2, y: 1, z: 0.5 });
  const crateBody = runtime.getSnapshot().bodies['prop:field-practice-crate-0'];
  assert.equal(crateBody.placementKind, 'prop');
  assert.equal(crateBody.placementId, 'field-practice-crate-0');
  assert.equal(crateBody.role, 'loose_crate');
  runtime.dispose();
});

test('scaling one practice block rebuilds only its collider and preserves every other live body', async () => {
  const scene = createDefaultSceneState();
  await RAPIER.init();
  const runtime = new MainWorldRapierRuntime(RAPIER, { props: scene.props, sources: scene.sources });
  const selectedId = 'prop:field-practice-crate-0';
  const unrelatedId = 'field-stone-0';
  const selectedBody = runtime.bodies.get(selectedId).body;
  const unrelatedBody = runtime.bodies.get(unrelatedId).body;
  const unrelatedPosition = { x: 6.25, y: 2.4, z: -1.75 };
  const unrelatedVelocity = { x: -0.8, y: 0.35, z: 1.1 };
  unrelatedBody.setTranslation(unrelatedPosition, false);
  unrelatedBody.setLinvel(unrelatedVelocity, false);

  runtime.syncBodies(scene.props.map((prop) => prop.id === 'field-practice-crate-0'
    ? { ...prop, scale: { x: 1.6, y: 0.7, z: 1.25 } }
    : prop), scene.sources);

  assert.equal(runtime.bodies.get(selectedId).body, selectedBody);
  assert.equal(runtime.bodies.get(unrelatedId).body, unrelatedBody);
  const unrelatedAfter = runtime.getSnapshot().bodies[unrelatedId];
  for (const axis of ['x', 'y', 'z']) {
    assert.ok(Math.abs(unrelatedAfter.position[axis] - unrelatedPosition[axis]) < 1e-6);
    assert.ok(Math.abs(unrelatedAfter.linearVelocity[axis] - unrelatedVelocity[axis]) < 1e-6);
  }
  assert.deepEqual(runtime.getSnapshot().bodies[selectedId].scale, { x: 1.6, y: 0.7, z: 1.25 });
  const scaledHalfExtents = runtime.bodies.get(selectedId).colliders[0].halfExtents();
  assert.ok(Math.abs(scaledHalfExtents.x - 0.29 * 1.6) < 1e-6);
  assert.ok(Math.abs(scaledHalfExtents.y - 0.23 * 0.7) < 1e-6);
  assert.ok(Math.abs(scaledHalfExtents.z - 0.29 * 1.25) < 1e-6);
  runtime.dispose();
});

test('anchoring and releasing one practice block changes only its body mode', async () => {
  const scene = createDefaultSceneState();
  await RAPIER.init();
  const runtime = new MainWorldRapierRuntime(RAPIER, { props: scene.props, sources: scene.sources });
  const selectedId = 'prop:field-practice-crate-0';
  const unrelatedId = 'field-stone-0';
  const selectedBody = runtime.bodies.get(selectedId).body;
  const unrelatedBody = runtime.bodies.get(unrelatedId).body;
  const selectedPosition = { x: -3.15, y: 1.4, z: -2.1 };
  const unrelatedPosition = { x: 6.25, y: 2.4, z: -1.75 };
  const unrelatedVelocity = { x: -0.8, y: 0.35, z: 1.1 };
  selectedBody.setTranslation(selectedPosition, false);
  unrelatedBody.setTranslation(unrelatedPosition, false);
  unrelatedBody.setLinvel(unrelatedVelocity, false);

  const anchoredProps = scene.props.map((prop) => prop.id === 'field-practice-crate-0'
    ? {
        ...prop,
        affectedByGravity: false,
        position: { x: selectedPosition.x, y: selectedPosition.y - 0.23, z: selectedPosition.z },
      }
    : prop);
  runtime.syncBodies(anchoredProps, scene.sources);

  assert.equal(runtime.bodies.get(selectedId).body, selectedBody);
  assert.equal(runtime.bodies.get(unrelatedId).body, unrelatedBody);
  assert.equal(selectedBody.isFixed(), true);
  let selectedAfter = runtime.getSnapshot().bodies[selectedId];
  for (const axis of ['x', 'y', 'z']) {
    assert.ok(Math.abs(selectedAfter.position[axis] - selectedPosition[axis]) < 1e-6);
  }
  let unrelatedAfter = runtime.getSnapshot().bodies[unrelatedId];
  for (const axis of ['x', 'y', 'z']) {
    assert.ok(Math.abs(unrelatedAfter.position[axis] - unrelatedPosition[axis]) < 1e-6);
    assert.ok(Math.abs(unrelatedAfter.linearVelocity[axis] - unrelatedVelocity[axis]) < 1e-6);
  }

  runtime.syncBodies(anchoredProps.map((prop) => prop.id === 'field-practice-crate-0'
    ? { ...prop, affectedByGravity: true }
    : prop), scene.sources);

  assert.equal(runtime.bodies.get(selectedId).body, selectedBody);
  assert.equal(runtime.bodies.get(unrelatedId).body, unrelatedBody);
  assert.equal(selectedBody.isDynamic(), true);
  selectedAfter = runtime.getSnapshot().bodies[selectedId];
  for (const axis of ['x', 'y', 'z']) {
    assert.ok(Math.abs(selectedAfter.position[axis] - selectedPosition[axis]) < 1e-6);
    assert.ok(Math.abs(selectedAfter.linearVelocity[axis]) < 1e-6);
  }
  unrelatedAfter = runtime.getSnapshot().bodies[unrelatedId];
  for (const axis of ['x', 'y', 'z']) {
    assert.ok(Math.abs(unrelatedAfter.position[axis] - unrelatedPosition[axis]) < 1e-6);
    assert.ok(Math.abs(unrelatedAfter.linearVelocity[axis] - unrelatedVelocity[axis]) < 1e-6);
  }
  runtime.dispose();
});

test('placed assets and mechanics default anchored and their gravity mode is undoable', () => {
  useSpellStore.setState({
    placedAssets: [],
    placedMechanicsBuilds: [],
    nextPlacedAssetIndex: 1,
    nextPlacedMechanicsBuildIndex: 1,
    worldHistoryPast: [],
    worldHistoryFuture: [],
    worldEditTransaction: null,
  });
  const assetId = useSpellStore.getState().placeAsset('shape:cuboid', {
    point: { x: 0, y: 2, z: 0 },
  });
  const mechanicsId = useSpellStore.getState().placeMechanicsBuild({
    blueprintId: 'blueprint:gravity-mode',
    document: { metadata: { name: 'Gravity mode' }, assemblies: [] },
  }, { point: { x: 1, y: 2, z: 0 } });
  assert.equal(useSpellStore.getState().placedAssets[0].affectedByGravity, false);
  assert.equal(useSpellStore.getState().placedMechanicsBuilds[0].affectedByGravity, false);

  assert.equal(useSpellStore.getState().setWorldPlacementGravity({
    kind: 'asset', id: assetId, affectedByGravity: true,
  }), true);
  assert.equal(useSpellStore.getState().placedAssets[0].affectedByGravity, true);
  assert.equal(useSpellStore.getState().setWorldPlacementGravity({
    kind: 'asset',
    id: assetId,
    affectedByGravity: false,
    transform: { position: { x: 4, y: 0.5, z: -2 } },
  }), true);
  assert.equal(useSpellStore.getState().placedAssets[0].affectedByGravity, false);
  assert.deepEqual(useSpellStore.getState().placedAssets[0].transform.position, { x: 4, y: 0.5, z: -2 });
  assert.equal(useSpellStore.getState().undoWorldEdit(), true);
  assert.equal(useSpellStore.getState().placedAssets[0].affectedByGravity, true);
  assert.equal(useSpellStore.getState().placedMechanicsBuilds[0].id, mechanicsId);
});

test('Sim world history undoes and redoes placements, removals, and grouped wrench changes', () => {
  useSpellStore.setState({
    spellTemplates: [],
    selectedSpellTemplateId: null,
    nextSpellTemplateIndex: 1,
    placedSpells: [],
    placedAssets: [],
    placedMechanicsBuilds: [],
    selectedPlacedSpellId: null,
    nextPlacedSpellIndex: 1,
    nextPlacedAssetIndex: 1,
    nextPlacedMechanicsBuildIndex: 1,
    worldHistoryPast: [],
    worldHistoryFuture: [],
    worldEditTransaction: null,
  });

  const spellDraft = createSpellMakerDraft();
  spellDraft.name = 'Undoable light';
  assert.equal(useSpellStore.getState().saveAuthoredSpell(spellDraft).ok, true);
  const spellId = useSpellStore.getState().placeSelectedSpell({ point: { x: 1, y: 0, z: 2 } });
  assert.equal(
    useSpellStore.getState().placedSpells.find((item) => item.id === spellId).transform.scale,
    DEFAULT_PLACED_SPELL_SCALE,
  );
  const assetId = useSpellStore.getState().placeAsset('shape:cuboid', { point: { x: 3, y: 0, z: 4 } });
  const mechanicsId = useSpellStore.getState().placeMechanicsBuild({
    blueprintId: 'blueprint:undo-test',
    name: 'Undo test build',
    document: { metadata: { name: 'Undo test build' }, assemblies: [] },
  }, { point: { x: 5, y: 0, z: 6 } });

  assert.deepEqual(
    [
      useSpellStore.getState().placedSpells.length,
      useSpellStore.getState().placedAssets.length,
      useSpellStore.getState().placedMechanicsBuilds.length,
    ],
    [1, 1, 1],
  );
  assert.equal(useSpellStore.getState().undoWorldEdit(), true);
  assert.equal(useSpellStore.getState().placedMechanicsBuilds.length, 0);
  assert.equal(useSpellStore.getState().undoWorldEdit(), true);
  assert.equal(useSpellStore.getState().placedAssets.length, 0);
  assert.equal(useSpellStore.getState().undoWorldEdit(), true);
  assert.equal(useSpellStore.getState().placedSpells.length, 0);

  assert.equal(useSpellStore.getState().redoWorldEdit(), true);
  assert.equal(useSpellStore.getState().redoWorldEdit(), true);
  assert.equal(useSpellStore.getState().redoWorldEdit(), true);
  assert.ok(useSpellStore.getState().placedSpells.some((item) => item.id === spellId));
  assert.ok(useSpellStore.getState().placedAssets.some((item) => item.id === assetId));
  assert.ok(useSpellStore.getState().placedMechanicsBuilds.some((item) => item.id === mechanicsId));

  const historyBeforeDrag = useSpellStore.getState().worldHistoryPast.length;
  const originalSpellTransform = structuredClone(
    useSpellStore.getState().placedSpells.find((item) => item.id === spellId).transform,
  );
  assert.equal(useSpellStore.getState().beginWorldEdit(), true);
  useSpellStore.getState().updatePlacedSpellTransform(spellId, { scale: 1.4 });
  useSpellStore.getState().updatePlacedSpellTransform(spellId, { scale: 1.8, pitchDeg: 20 });
  assert.equal(useSpellStore.getState().commitWorldEdit(), true);
  assert.equal(useSpellStore.getState().worldHistoryPast.length, historyBeforeDrag + 1);
  assert.equal(useSpellStore.getState().undoWorldEdit(), true);
  assert.deepEqual(
    useSpellStore.getState().placedSpells.find((item) => item.id === spellId).transform,
    originalSpellTransform,
  );

  assert.equal(useSpellStore.getState().removePlacedAsset(assetId), true);
  assert.equal(useSpellStore.getState().placedAssets.length, 0);
  assert.equal(useSpellStore.getState().undoWorldEdit(), true);
  assert.ok(useSpellStore.getState().placedAssets.some((item) => item.id === assetId));
});

test('spell placement binds once, stays massless, and manager unbind is undoable', () => {
  useSpellStore.setState({
    spellTemplates: [],
    selectedSpellTemplateId: null,
    placedSpells: [],
    selectedPlacedSpellId: null,
    nextSpellTemplateIndex: 1,
    nextPlacedSpellIndex: 1,
    worldHistoryPast: [],
    worldHistoryFuture: [],
    worldEditTransaction: null,
  });
  const draft = createSpellMakerDraft();
  draft.name = 'Bound wind';
  assert.equal(useSpellStore.getState().saveAuthoredSpell(draft).ok, true);
  const spellId = useSpellStore.getState().placeSelectedSpell({
    point: { x: 1, y: 2, z: 3 },
    normal: { x: 1, y: 0, z: 0 },
    tangent: { x: 0, y: 0, z: 1 },
    surfaceKind: 'placed-asset',
    surfaceTargetId: 'placed-asset:7',
    surfaceId: 'placed-asset:7',
    surfaceLabel: 'Dynamic cube',
    mountBodyId: 'placed-asset:placed-asset:7',
  });
  const placed = useSpellStore.getState().placedSpells.find((spell) => spell.id === spellId);
  assert.equal(placed.binding.bodyId, 'placed-asset:placed-asset:7');
  assert.equal(placed.binding.surfaceLabel, 'Dynamic cube');
  assert.equal(placed.affectedByGravity, false);
  const placedNormal = rotateVector({ x: 0, y: 1, z: 0 }, placed.placementTransform.rotation);
  const placedTangent = rotateVector({ x: 1, y: 0, z: 0 }, placed.placementTransform.rotation);
  assert.ok(Math.hypot(placedNormal.x - 1, placedNormal.y, placedNormal.z) < 0.000001);
  assert.ok(Math.hypot(placedTangent.x, placedTangent.y, placedTangent.z - 1) < 0.000001);
  assert.equal(useSpellStore.getState().setPlacedSpellGravity(spellId, true), false);
  assert.equal(useSpellStore.getState().placedSpells[0].affectedByGravity, false);

  const frozenWorldTransform = {
    position: { x: 4, y: 5, z: 6 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: 0.6,
  };
  assert.equal(useSpellStore.getState().unbindPlacedSpell(spellId, frozenWorldTransform), true);
  const unbound = useSpellStore.getState().placedSpells[0];
  assert.equal(unbound.binding, null);
  assert.equal(unbound.anchor.surfaceLabel, 'Unbound in world');
  assert.deepEqual(unbound.placementTransform.position, frozenWorldTransform.position);
  assert.equal(useSpellStore.getState().unbindPlacedSpell(spellId), false);
  assert.equal(useSpellStore.getState().undoWorldEdit(), true);
  assert.equal(useSpellStore.getState().placedSpells[0].binding.bodyId, 'placed-asset:placed-asset:7');
});

test('live fixed and dynamic asset bodies receive pose and collider-scale edits', async () => {
  await RAPIER.init();
  const placements = [
    {
      id: 'fixed-asset',
      assetDefinitionId: 'shape:cuboid',
      bodyMode: 'fixed',
      transform: { position: { x: 0, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: 1 },
    },
    {
      id: 'dynamic-asset',
      assetDefinitionId: 'shape:cuboid',
      bodyMode: 'dynamic',
      transform: { position: { x: 1, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: 1 },
    },
  ];
  const runtime = new MainWorldRapierRuntime(RAPIER, { placedAssets: placements });
  assert.equal(runtime.updatePlacementTransform({ kind: 'asset', id: 'fixed-asset', position: { x: 3, y: 2, z: 1 }, scale: 2 }), true);
  assert.equal(runtime.updatePlacementTransform({ kind: 'asset', id: 'dynamic-asset', position: { x: -2, y: 3, z: 4 }, scale: { x: 2, y: 3, z: 4 } }), true);
  const snapshot = runtime.getSnapshot();
  assert.deepEqual(snapshot.bodies['placed-asset:fixed-asset'].position, { x: 3, y: 2, z: 1 });
  assert.deepEqual(snapshot.bodies['placed-asset:fixed-asset'].scale, { x: 2, y: 2, z: 2 });
  assert.deepEqual(snapshot.bodies['placed-asset:dynamic-asset'].position, { x: -2, y: 3, z: 4 });
  assert.deepEqual(snapshot.bodies['placed-asset:dynamic-asset'].scale, { x: 2, y: 3, z: 4 });
  assert.equal(snapshot.bodies['placed-asset:fixed-asset'].bodyMode, 'fixed');
  assert.equal(snapshot.bodies['placed-asset:dynamic-asset'].bodyMode, 'dynamic');
  runtime.dispose();
});
