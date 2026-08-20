import test from 'node:test';
import assert from 'node:assert/strict';
import { transformDirection, transformPoint } from '../../src/mechanics-engine/index.js';
import { useMechanicsStore } from '../src/mechanics/mechanicsStore.js';
import { useSpellStore } from '../src/store.js';

test('player state persists bounded pitch and the selected camera mode across mechanics', () => {
  const store = useSpellStore.getState();
  store.setPlayerState({
    position: { x: 2, y: 0, z: -1 },
    facing: 0.4,
    pitchDeg: 120,
    cameraMode: 'fps',
  });
  let player = useSpellStore.getState().playerState;
  assert.equal(player.pitch, (80 * Math.PI) / 180);
  assert.equal(player.cameraMode, 'fp');

  store.setPlayerState({
    position: { x: 2, y: 0, z: -1 },
    facing: 0.4,
    pitch: -Math.PI,
    cameraMode: 'orbit',
  });
  player = useSpellStore.getState().playerState;
  assert.equal(player.pitch, -(80 * Math.PI) / 180);
  assert.equal(player.cameraMode, 'tp');

  store.setPlayerState({
    position: { x: 2, y: 0, z: -1 },
    facing: 0.4,
    cameraMode: 'fc',
  });
  assert.equal(useSpellStore.getState().playerState.cameraMode, 'fc');
});

test('scene scaling bakes into serializable part sizes and remains undoable', () => {
  const store = useMechanicsStore.getState();
  store.loadStarter('blank');
  useMechanicsStore.getState().addPrimitive('cuboid');
  const before = useMechanicsStore.getState().document.assemblies[0];
  useMechanicsStore.getState().setAssemblyTransform(before.assemblyId, {
    position: before.transform.position,
    rotation: before.transform.rotation,
    scale: { x: 2, y: 0.5, z: 1.5 },
  });
  const scaled = useMechanicsStore.getState().document.assemblies[0];
  assert.ok(Math.abs(scaled.parts[0].size.x - 1.6) < 1e-9);
  assert.ok(Math.abs(scaled.parts[0].size.y - 0.25) < 1e-9);
  assert.ok(Math.abs(scaled.parts[0].size.z - 1.2) < 1e-9);
  assert.equal('scale' in scaled.transform, false);

  useMechanicsStore.getState().undo();
  assert.deepEqual(useMechanicsStore.getState().document.assemblies[0].parts[0].size, before.parts[0].size);
});

test('saved blueprints support edit, overwrite, and save-as-new without changing the original copy', () => {
  const store = useMechanicsStore.getState();
  store.loadStarter('blank');
  useMechanicsStore.getState().addPrimitive('cuboid');
  useMechanicsStore.getState().setAssemblyEditorOptions('assembly:1', { opacity: 0.4 });
  const blueprintId = useMechanicsStore.getState().saveBlueprint('Editable machine');
  assert.ok(blueprintId);

  useMechanicsStore.getState().loadStarter('blank');
  assert.equal(useMechanicsStore.getState().beginBlueprintEdit(blueprintId), true);
  const baseline = useMechanicsStore.getState().editingBlueprintBaseline;
  assert.equal(useMechanicsStore.getState().document, baseline);
  assert.equal(useMechanicsStore.getState().editingBlueprintId, blueprintId);
  assert.equal(useMechanicsStore.getState().document.assemblies[0].editor.opacity, 0.4);
  assert.match(useMechanicsStore.getState().status, /1 assembly uses custom opacity restored/i);

  useMechanicsStore.getState().addPrimitive('sphere');
  assert.notEqual(useMechanicsStore.getState().document, baseline);
  assert.equal(useMechanicsStore.getState().overwriteBlueprint(), true);
  const overwritten = useMechanicsStore.getState().blueprints.find((item) => item.blueprintId === blueprintId);
  assert.equal(overwritten.document.assemblies.length, 2);
  assert.equal(useMechanicsStore.getState().editingBlueprintBaseline, useMechanicsStore.getState().document);

  useMechanicsStore.getState().addPrimitive('beam');
  const copyId = useMechanicsStore.getState().saveBlueprintAsNew('Editable machine variation');
  assert.ok(copyId);
  assert.notEqual(copyId, blueprintId);
  const blueprints = useMechanicsStore.getState().blueprints;
  assert.equal(blueprints.find((item) => item.blueprintId === blueprintId).document.assemblies.length, 2);
  assert.equal(blueprints.find((item) => item.blueprintId === copyId).document.assemblies.length, 3);
  assert.equal(useMechanicsStore.getState().editingBlueprintId, copyId);
  assert.equal(useMechanicsStore.getState().editingBlueprintBaseline, useMechanicsStore.getState().document);

  useMechanicsStore.getState().deleteBlueprint(copyId);
  useMechanicsStore.getState().deleteBlueprint(blueprintId);
});

test('assembly document JSON round-trips and invalid replacements keep the current build', () => {
  useMechanicsStore.getState().loadStarter('catapult');
  const source = structuredClone(useMechanicsStore.getState().document);
  const serialized = JSON.stringify(source);

  assert.equal(
    useMechanicsStore.getState().replaceDocument(JSON.parse(serialized), 'JSON build loaded.'),
    true,
  );
  const loaded = useMechanicsStore.getState().document;
  assert.deepEqual(loaded.assemblies, source.assemblies);
  assert.deepEqual(loaded.constraints, source.constraints);
  assert.deepEqual(loaded.forceElements, source.forceElements);
  assert.deepEqual(loaded.sensors, source.sensors);
  assert.deepEqual(loaded.latches, source.latches);
  assert.deepEqual(loaded.rotationCouplings, source.rotationCouplings);
  assert.deepEqual(loaded.spellDevices, source.spellDevices);
  assert.deepEqual(loaded.gates, source.gates);
  assert.equal(loaded.metadata.name, source.metadata.name);
  assert.equal(loaded.metadata.revision, source.metadata.revision + 1);

  const beforeInvalidLoad = useMechanicsStore.getState().document;
  assert.equal(useMechanicsStore.getState().replaceDocument({
    schemaVersion: source.schemaVersion,
    assemblies: source.assemblies,
    constraints: [{
      constraintId: 'constraint:invalid',
      assemblyAId: 'missing-assembly',
      assemblyBId: null,
    }],
  }), false);
  assert.equal(useMechanicsStore.getState().document, beforeInvalidLoad);
  assert.match(useMechanicsStore.getState().status, /invalid assemblyAId/i);
});

test('assembly editor opacity and click-through settings are undoable and do not alter physics', () => {
  useMechanicsStore.getState().loadStarter('blank');
  useMechanicsStore.getState().addPrimitive('cuboid');
  const assemblyId = useMechanicsStore.getState().document.assemblies[0].assemblyId;

  useMechanicsStore.getState().setAssemblyEditorOptions(assemblyId, { clickThrough: true });
  let assembly = useMechanicsStore.getState().document.assemblies[0];
  assert.equal(assembly.editor.clickThrough, true);
  assert.equal(assembly.bodyMode, 'dynamic');

  useMechanicsStore.getState().setAssemblyEditorOptions(assemblyId, { opacity: 0.4 });
  assembly = useMechanicsStore.getState().document.assemblies[0];
  assert.equal(assembly.editor.opacity, 0.4);
  assert.equal(assembly.parts[0].materialId, 'material.wood_light');

  useMechanicsStore.getState().undo();
  assert.equal(useMechanicsStore.getState().document.assemblies[0].editor.opacity, 1);
  assert.equal(useMechanicsStore.getState().document.assemblies[0].editor.clickThrough, true);
  useMechanicsStore.getState().undo();
  assert.equal(useMechanicsStore.getState().document.assemblies[0].editor.clickThrough, false);
});

test('opacity scrubbing previews without mutating the document or adding undo steps', () => {
  useMechanicsStore.getState().loadStarter('blank');
  useMechanicsStore.getState().addPrimitive('cuboid');
  const beforeDocument = useMechanicsStore.getState().document;
  const beforeHistoryLength = useMechanicsStore.getState().historyPast.length;

  useMechanicsStore.getState().previewEditorOpacity('assembly', 'assembly:1', 0.45);
  const previewState = useMechanicsStore.getState();
  assert.deepEqual(previewState.editorOpacityPreview, {
    kind: 'assembly',
    id: 'assembly:1',
    opacity: 0.45,
  });
  assert.equal(previewState.document, beforeDocument);
  assert.equal(previewState.historyPast.length, beforeHistoryLength);

  useMechanicsStore.getState().clearEditorOpacityPreview();
  assert.equal(useMechanicsStore.getState().editorOpacityPreview, null);
});

test('relationship editor opacity and click-through settings are undoable and do not alter mechanics', () => {
  useMechanicsStore.getState().loadStarter('catapult');
  const spring = useMechanicsStore.getState().document.forceElements[0];
  const beforePhysics = {
    stiffness: spring.stiffness,
    damping: spring.damping,
    assemblyAId: spring.assemblyAId,
    assemblyBId: spring.assemblyBId,
  };

  assert.equal(useMechanicsStore.getState().updateMechanic(
    spring.forceElementId,
    { editor: { opacity: 0.35 } },
  ), true);
  assert.equal(useMechanicsStore.getState().updateMechanic(
    spring.forceElementId,
    { editor: { clickThrough: true } },
  ), true);

  let updated = useMechanicsStore.getState().document.forceElements[0];
  assert.deepEqual(updated.editor, { opacity: 0.35, clickThrough: true });
  assert.deepEqual({
    stiffness: updated.stiffness,
    damping: updated.damping,
    assemblyAId: updated.assemblyAId,
    assemblyBId: updated.assemblyBId,
  }, beforePhysics);

  useMechanicsStore.getState().undo();
  updated = useMechanicsStore.getState().document.forceElements[0];
  assert.deepEqual(updated.editor, { opacity: 0.35, clickThrough: false });
  useMechanicsStore.getState().undo();
  assert.equal(useMechanicsStore.getState().document.forceElements[0].editor, undefined);
});

test('nested assembly focus, preview, and local transforms stay distinct from body selection', () => {
  useMechanicsStore.getState().loadStarter('blank');
  useMechanicsStore.getState().addPrimitive('cuboid');
  useMechanicsStore.getState().addPrimitive('sphere');
  useMechanicsStore.getState().selectAssembly('assembly:1');
  useMechanicsStore.getState().selectAssembly('assembly:2', true);
  useMechanicsStore.getState().glueSelection();

  const assembly = useMechanicsStore.getState().document.assemblies[0];
  const sphereGroup = assembly.structure.children[1];
  useMechanicsStore.getState().previewAssemblyNode(assembly.assemblyId, sphereGroup.nodeId);
  assert.deepEqual(useMechanicsStore.getState().previewNode, {
    assemblyId: assembly.assemblyId,
    nodeId: sphereGroup.nodeId,
  });
  assert.deepEqual(useMechanicsStore.getState().selectedAssemblyIds, [assembly.assemblyId]);

  useMechanicsStore.getState().focusAssemblyNode(assembly.assemblyId, sphereGroup.nodeId);
  assert.equal(useMechanicsStore.getState().previewNode, null);
  const beforeX = assembly.parts[1].localTransform.position.x;
  useMechanicsStore.getState().updateAssemblyNode(assembly.assemblyId, sphereGroup.nodeId, {
    localTransform: { position: { x: beforeX + 1 } },
  });
  const moved = useMechanicsStore.getState().document.assemblies[0];
  assert.equal(moved.parts[0].localTransform.position.x, assembly.parts[0].localTransform.position.x);
  assert.equal(moved.parts[1].localTransform.position.x, beforeX + 1);
  assert.deepEqual(useMechanicsStore.getState().focusedNode, {
    assemblyId: assembly.assemblyId,
    nodeId: sphereGroup.nodeId,
  });
});

test('relationship parameters are editable, validated, and undoable', () => {
  useMechanicsStore.getState().loadStarter('catapult');

  // Numeric spring edit commits and undoes.
  assert.equal(
    useMechanicsStore.getState().updateMechanic('spring:catapult', { stiffness: 55 }),
    true,
  );
  const spring = () =>
    useMechanicsStore.getState().document.forceElements.find((item) => item.forceElementId === 'spring:catapult');
  assert.equal(spring().stiffness, 55);
  useMechanicsStore.getState().undo();
  assert.equal(spring().stiffness, 42);

  // Axis edits re-localize against assembly A.
  assert.equal(
    useMechanicsStore.getState().updateMechanic('constraint:catapult-pivot', { axis: 'z' }),
    true,
  );
  const pivot = () =>
    useMechanicsStore.getState().document.constraints.find((item) => item.constraintId === 'constraint:catapult-pivot');
  assert.deepEqual(pivot().localAxisA, { x: 0, y: 0, z: 1 });

  // Invalid limits are refused and leave the document untouched.
  const before = pivot().limits;
  assert.equal(
    useMechanicsStore.getState().updateMechanic('constraint:catapult-pivot', { limits: { min: 2, max: 1 } }),
    false,
  );
  assert.deepEqual(pivot().limits, before);
  assert.match(useMechanicsStore.getState().status, /minimum must be below/i);

  // Reconnecting an assembly re-centers the anchors at the new midpoint.
  assert.equal(
    useMechanicsStore.getState().updateMechanic('constraint:catapult-pivot', {
      assemblyBId: 'assembly:catapult-stone',
    }),
    true,
  );
  assert.equal(pivot().assemblyBId, 'assembly:catapult-stone');
  assert.ok(Math.abs(pivot().localAnchorA.y - 0.585) < 1e-6);
  assert.ok(Math.abs(pivot().localAnchorA.z - 0.85) < 1e-6);
});

test('relationship endpoints move independently, stay attached to their host, and undo once', () => {
  useMechanicsStore.getState().loadStarter('catapult');
  const beforeHistory = useMechanicsStore.getState().historyPast.length;
  const pivot = () => useMechanicsStore
    .getState()
    .document.constraints.find((item) => item.constraintId === 'constraint:catapult-pivot');
  const originalA = { ...pivot().localAnchorA };
  const originalB = { ...pivot().localAnchorB };

  assert.equal(
    useMechanicsStore.getState().setRelationshipEndpoint(
      'constraint:catapult-pivot',
      'A',
      { x: 0.35, y: 0.9, z: 0.2 },
    ),
    true,
  );
  const movedAssemblyA = useMechanicsStore.getState().document.assemblies.find(
    (item) => item.assemblyId === pivot().assemblyAId,
  );
  assert.deepEqual(
    transformPoint(movedAssemblyA.transform, pivot().connectionAnchorA),
    { x: 0.35, y: 0.9, z: 0.2 },
  );
  assert.ok(pivot().connectionAnchorB);
  assert.deepEqual(pivot().localAnchorA, originalA);
  assert.deepEqual(pivot().localAnchorB, originalB);
  const document = useMechanicsStore.getState().document;
  const assemblyA = document.assemblies.find((item) => item.assemblyId === pivot().assemblyAId);
  const assemblyB = document.assemblies.find((item) => item.assemblyId === pivot().assemblyBId);
  assert.deepEqual(
    transformPoint(assemblyA.transform, pivot().localAnchorA),
    transformPoint(assemblyB.transform, pivot().localAnchorB),
  );
  assert.equal(useMechanicsStore.getState().historyPast.length, beforeHistory + 1);

  useMechanicsStore.getState().undo();
  assert.equal(pivot().connectionAnchorA, null);
  assert.deepEqual(pivot().localAnchorB, originalB);
});

test('torsion spring brace and push contacts are independently editable', () => {
  useMechanicsStore.getState().loadStarter('catapult');
  const spring = () => useMechanicsStore
    .getState()
    .document.forceElements.find((item) => item.forceElementId === 'spring:catapult');
  assert.equal(
    useMechanicsStore.getState().setRelationshipEndpoint(
      'spring:catapult',
      'B',
      { x: 0.1, y: 1.2, z: 0.25 },
    ),
    true,
  );
  assert.ok(spring().connectionAnchorA);
  const arm = useMechanicsStore.getState().document.assemblies.find(
    (item) => item.assemblyId === spring().assemblyBId,
  );
  assert.deepEqual(
    transformPoint(arm.transform, spring().connectionAnchorB),
    { x: 0.1, y: 1.2, z: 0.25 },
  );
  assert.equal(spring().constraintId, 'constraint:catapult-pivot');
});

test('linear spring and shaft endpoints are editable but cog mesh contact is not', () => {
  useMechanicsStore.getState().loadStarter('pressure-plate');
  const spring = () => useMechanicsStore
    .getState()
    .document.forceElements.find((item) => item.forceElementId === 'spring:pressure-return');
  const originalA = { ...spring().localAnchorA };
  const originalB = { ...spring().localAnchorB };
  assert.equal(
    useMechanicsStore.getState().setRelationshipEndpoint(
      'spring:pressure-return',
      'B',
      { x: 0.4, y: 1.3, z: 0.1 },
    ),
    true,
  );
  assert.deepEqual(spring().localAnchorA, originalA);
  assert.notDeepEqual(spring().localAnchorB, originalB);

  useMechanicsStore.getState().loadStarter('wind-gears');
  assert.equal(
    useMechanicsStore.getState().setRelationshipEndpoint(
      'coupling:wind-output',
      'A',
      { x: 0, y: 1, z: 0 },
    ),
    false,
  );
  assert.match(useMechanicsStore.getState().status, /does not have a movable endpoint/i);
});

test('sensor attachment converts positions so the zone stays put in the world', () => {
  useMechanicsStore.getState().loadStarter('catapult');
  assert.equal(
    useMechanicsStore.getState().updateMechanic('sensor:catapult-release', {
      assemblyId: 'assembly:catapult-base',
    }),
    true,
  );
  const sensor = useMechanicsStore
    .getState()
    .document.sensors.find((item) => item.sensorId === 'sensor:catapult-release');
  assert.equal(sensor.assemblyId, 'assembly:catapult-base');
  // Base sits at (0, 0.55, 0); world position (-2.25, 0.38, 0) becomes this local offset.
  assert.ok(Math.abs(sensor.localTransform.position.x - -2.25) < 1e-6);
  assert.ok(Math.abs(sensor.localTransform.position.y - -0.17) < 1e-6);
});

test('spell plates can move, resize, rotate, and change hosts without losing the mount', () => {
  useMechanicsStore.getState().loadStarter('wind-gears');
  const beforeDocument = useMechanicsStore.getState().document;
  const before = beforeDocument.spellDevices.find((item) => item.deviceId === 'spell-device:wind-drive');
  const beforeHost = beforeDocument.assemblies.find((item) => item.assemblyId === before.assemblyId);
  const worldOrigin = transformPoint(beforeHost.transform, before.localFrame.origin);
  const worldNormal = transformDirection(beforeHost.transform, before.localFrame.normal);

  const newHost = beforeDocument.assemblies.find((item) => item.assemblyId !== before.assemblyId);
  assert.equal(useMechanicsStore.getState().updateMechanic(before.deviceId, { assemblyId: newHost.assemblyId }), true);
  let device = useMechanicsStore.getState().document.spellDevices.find((item) => item.deviceId === before.deviceId);
  assert.equal(device.assemblyId, newHost.assemblyId);
  const remountedOrigin = transformPoint(newHost.transform, device.localFrame.origin);
  const remountedNormal = transformDirection(newHost.transform, device.localFrame.normal);
  for (const axis of ['x', 'y', 'z']) {
    assert.ok(Math.abs(remountedOrigin[axis] - worldOrigin[axis]) < 1e-9);
    assert.ok(Math.abs(remountedNormal[axis] - worldNormal[axis]) < 1e-9);
  }

  assert.equal(useMechanicsStore.getState().updateMechanic(device.deviceId, {
    position: { x: device.localFrame.origin.x + 0.25 },
    plateRadius: 0.7,
  }), true);
  device = useMechanicsStore.getState().document.spellDevices.find((item) => item.deviceId === before.deviceId);
  assert.ok(Math.abs(device.plateRadius - 0.7) < 1e-9);

  const movedWorld = transformPoint(newHost.transform, device.localFrame.origin);
  assert.equal(useMechanicsStore.getState().setSpellPlateTransform(device.deviceId, {
    position: { x: movedWorld.x, y: movedWorld.y + 0.2, z: movedWorld.z },
    rotation: { x: 0, y: Math.sin(Math.PI / 4), z: 0, w: Math.cos(Math.PI / 4) },
    scale: { x: 1.5, y: 1, z: 1 },
  }), true);
  device = useMechanicsStore.getState().document.spellDevices.find((item) => item.deviceId === before.deviceId);
  assert.ok(Math.abs(device.plateRadius - 1.05) < 1e-9);
  assert.ok(Math.abs(transformPoint(newHost.transform, device.localFrame.origin).y - (movedWorld.y + 0.2)) < 1e-9);
  const rotatedNormal = transformDirection(newHost.transform, device.localFrame.normal);
  assert.ok(Math.abs(rotatedNormal.x - 1) < 1e-9);
  assert.ok(Math.abs(rotatedNormal.z) < 1e-9);
});

test('spell plate gates can switch between manual, sliding, and rotary drivers', () => {
  useMechanicsStore.getState().loadStarter('wind-gears');
  const device = () =>
    useMechanicsStore
      .getState()
      .document.spellDevices.find((item) => item.deviceId === 'spell-device:wind-drive');

  assert.equal(
    useMechanicsStore.getState().setSpellPlateGate('spell-device:wind-drive', { gateType: 'manual' }),
    true,
  );
  assert.equal(device().gateId, null);
  assert.equal(useMechanicsStore.getState().document.gates.length, 0);

  assert.equal(
    useMechanicsStore.getState().setSpellPlateGate('spell-device:wind-drive', {
      gateType: 'sliding_ring_gate',
      driverConstraintId: 'constraint:wind-key-slider',
    }),
    true,
  );
  const gate = useMechanicsStore.getState().document.gates[0];
  assert.equal(device().gateId, gate.gateId);
  assert.equal(gate.type, 'sliding_ring_gate');
  assert.equal(gate.driverConstraintId, 'constraint:wind-key-slider');

  // A gate without a compatible driver is refused with guidance.
  assert.equal(
    useMechanicsStore.getState().setSpellPlateGate('spell-device:wind-drive', {
      gateType: 'rotary_cam_gate',
      driverConstraintId: '',
    }),
    false,
  );
  assert.match(useMechanicsStore.getState().status, /hinge/i);

  // Gear ratio edits stay bounded away from zero.
  assert.equal(
    useMechanicsStore.getState().updateMechanic('coupling:wind-output', { ratio: -3 }),
    true,
  );
  const coupling = useMechanicsStore
    .getState()
    .document.rotationCouplings.find((item) => item.couplingId === 'coupling:wind-output');
  assert.equal(coupling.ratio, -3);
});

test('empty spell sockets keep their gate working and accept a spell later', async () => {
  const { evaluateMountedSpellDevices } = await import('../src/mechanics/spell-device-system.js');
  useMechanicsStore.getState().loadStarter('wind-gears');

  // Empty the wind plate's socket.
  assert.equal(
    useMechanicsStore.getState().updateMechanic('spell-device:wind-drive', { spellTemplateId: '' }),
    true,
  );
  const device = () =>
    useMechanicsStore
      .getState()
      .document.spellDevices.find((item) => item.deviceId === 'spell-device:wind-drive');
  assert.equal(device().spellTemplateId, null);

  // The evaluator lists the empty socket as present but inactive, with no force fields,
  // while the gate itself still resolves (the key starts seated → closed).
  const document = useMechanicsStore.getState().document;
  const snapshot = {
    assemblies: Object.fromEntries(
      document.assemblies.map((assembly) => [assembly.assemblyId, assembly.transform]),
    ),
    gates: { 'gate:wind-key': { closed: true } },
  };
  const evaluation = evaluateMountedSpellDevices(document, snapshot);
  const entry = evaluation.devices.find((item) => item.deviceId === 'spell-device:wind-drive');
  assert.equal(entry.socketed, false);
  assert.equal(entry.active, false);
  assert.equal(entry.gateClosed, true);
  assert.equal(evaluation.fields.length, 0);

  // Socketing a spell brings the plate back to life.
  assert.equal(
    useMechanicsStore.getState().updateMechanic('spell-device:wind-drive', { spellTemplateId: 'water-column' }),
    true,
  );
  const socketedEvaluation = evaluateMountedSpellDevices(useMechanicsStore.getState().document, snapshot);
  const socketedEntry = socketedEvaluation.devices.find(
    (item) => item.deviceId === 'spell-device:wind-drive',
  );
  assert.equal(socketedEntry.socketed, true);
  assert.equal(socketedEntry.active, true);
});

test('right-click plate handoff snapshots the active Spellpad spell into a placed build', () => {
  const compileResult = {
    graph: { nodes: [], edges: [] },
    program: { programId: 'program:active', title: 'Active native spell', seals: [] },
    diagnostics: [],
  };
  useSpellStore.setState({
    spellTemplates: [{
      id: 'spell-template:active',
      programId: 'program:active',
      name: 'Active native spell',
      compileResult,
    }],
    selectedSpellTemplateId: 'spell-template:active',
    placedMechanicsBuilds: [{
      id: 'placed-mechanics:socket-test',
      name: 'Socket test',
      document: {
        assemblies: [],
        spellDevices: [{
          deviceId: 'spell-device:empty',
          type: 'spell_plate',
          label: 'Empty spell socket',
          spellTemplateId: null,
          spell: null,
        }],
      },
    }],
  });
  const result = useSpellStore.getState().socketSelectedSpellOnMechanicsPlate(
    'placed-mechanics:socket-test',
    'spell-device:empty',
  );
  assert.equal(result.name, 'Active native spell');
  const device = useSpellStore.getState().placedMechanicsBuilds[0].document.spellDevices[0];
  assert.equal(device.spellTemplateId, 'spell-template:active');
  assert.equal(device.spell.name, 'Active native spell');
  assert.notEqual(device.spell.compileResult, compileResult);
});

test('wind gear starter separates the paddle wheel, axle, and real meshed cog pair', async () => {
  const { cogwheelWorldFrame, validateMechanicsDocument } = await import(
    '../../src/mechanics-engine/index.js'
  );
  useMechanicsStore.getState().loadStarter('wind-gears');
  const document = useMechanicsStore.getState().document;
  const input = document.assemblies.find((item) => item.assemblyId === 'assembly:wind-wheel');
  const output = document.assemblies.find((item) => item.assemblyId === 'assembly:output-gear');
  const coupling = document.rotationCouplings.find(
    (item) => item.couplingId === 'coupling:wind-output',
  );

  assert.equal(document.metadata.starterVersion, 4);
  assert.equal(input.parts.filter((item) => item.shape === 'cogwheel').length, 1);
  assert.equal(output.parts.filter((item) => item.shape === 'cogwheel').length, 1);
  assert.equal(output.parts.length, 1, 'the small cog should have no visible support or axle');
  assert.equal(
    document.constraints.some((item) => item.assemblyBId === output.assemblyId),
    false,
    'the small cog mesh should not add a public bearing relationship',
  );
  const windWheel = input.parts.find((item) => item.partId === 'part:input-wind-wheel');
  const axle = input.parts.find((item) => item.partId === 'part:input-axle');
  const largeCog = input.parts.find((item) => item.partId === 'part:input-cog');
  assert.ok(windWheel);
  assert.ok(axle);
  assert.ok(largeCog);
  assert.ok(
    largeCog.localTransform.position.x - windWheel.localTransform.position.x > 2,
    'the wind wheel and large cog should sit on opposite ends of the axle',
  );
  assert.equal(coupling.style, 'mesh');
  assert.equal(coupling.ratio, -2);

  const inputFrame = cogwheelWorldFrame(input);
  const outputFrame = cogwheelWorldFrame(output);
  const centerDistance = Math.hypot(
    inputFrame.center.x - outputFrame.center.x,
    inputFrame.center.y - outputFrame.center.y,
    inputFrame.center.z - outputFrame.center.z,
  );
  assert.ok(
    Math.abs(centerDistance - (inputFrame.pitchRadius + outputFrame.pitchRadius)) < 1e-9,
    'cog pitch circles should meet exactly',
  );
  assert.equal(validateMechanicsDocument(document).ok, true);
});

test('cogwheel placement plans snap into mesh, respect Shift, and commit as one undoable step', async () => {
  const { planCogwheelPlacement, validateMechanicsDocument } = await import(
    '../../src/mechanics-engine/index.js'
  );
  useMechanicsStore.getState().loadStarter('blank');

  // First cogwheel: free flat placement, valid document, no couplings.
  assert.equal(useMechanicsStore.getState().addCogwheelQuick('cog-large'), true);
  const afterLarge = useMechanicsStore.getState().document;
  assert.equal(afterLarge.assemblies.length, 1);
  const large = afterLarge.assemblies[0];
  assert.equal(large.parts[0].shape, 'cogwheel');
  assert.equal(afterLarge.rotationCouplings.length, 0);
  assert.equal(validateMechanicsDocument(afterLarge).ok, true);

  // Planning near it snaps to exactly the sum of pitch radii in its plane,
  // with the counter-rotating radius ratio (0.8 : 0.4 → −2).
  const cursor = {
    x: large.transform.position.x + 0.9,
    y: 0,
    z: large.transform.position.z + 0.2,
  };
  const plan = planCogwheelPlacement(afterLarge, cursor, 'cog-small');
  assert.ok(plan.snapped);
  assert.equal(plan.snapped.targetAssemblyId, large.assemblyId);
  const planarDistance = Math.hypot(
    plan.position.x - large.transform.position.x,
    plan.position.z - large.transform.position.z,
  );
  assert.ok(Math.abs(planarDistance - 1.2) < 1e-6);
  assert.ok(Math.abs(plan.position.y - large.transform.position.y) < 1e-6);
  assert.equal(plan.snapped.ratio, -2);

  // Shift (snap: false) plans a free wheel instead.
  const freePlan = planCogwheelPlacement(afterLarge, cursor, 'cog-small', { snap: false });
  assert.equal(freePlan.snapped, null);

  // Committing the snapped plan creates the wheel and its mesh coupling together.
  assert.equal(useMechanicsStore.getState().addCogwheel(plan), true);
  const meshed = useMechanicsStore.getState().document;
  assert.equal(meshed.assemblies.length, 2);
  assert.equal(meshed.rotationCouplings.length, 1);
  assert.equal(meshed.rotationCouplings[0].style, 'mesh');
  assert.equal(meshed.rotationCouplings[0].ratio, -2);
  assert.equal(validateMechanicsDocument(meshed).ok, true);

  // One undo removes the wheel and the coupling as a unit.
  useMechanicsStore.getState().undo();
  const undone = useMechanicsStore.getState().document;
  assert.equal(undone.assemblies.length, 1);
  assert.equal(undone.rotationCouplings.length, 0);
});

test('a cogwheel meshed beside an axled cog adds no second bearing relationship', async () => {
  const { planCogwheelPlacement } = await import('../../src/mechanics-engine/index.js');
  useMechanicsStore.getState().loadStarter('blank');
  useMechanicsStore.getState().addPrimitive('cuboid');
  const frame = useMechanicsStore.getState().document.assemblies[0];

  // Mount the first cog on the frame (the assembly-surface mount path).
  assert.equal(
    useMechanicsStore.getState().addCogwheel({
      presetId: 'cog-large',
      position: { x: frame.transform.position.x, y: 1.4, z: frame.transform.position.z },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      hostAssemblyId: frame.assemblyId,
      worldAxis: { x: 0, y: 1, z: 0 },
      snapped: null,
    }),
    true,
  );
  const mounted = useMechanicsStore.getState().document;
  assert.equal(mounted.constraints.length, 1);
  assert.equal(mounted.constraints[0].type, 'revolute');
  assert.equal(mounted.constraints[0].assemblyAId, frame.assemblyId);

  // Meshing a second cog relies on the mesh itself; no extra axle is authored.
  const largeId = mounted.assemblies[1].assemblyId;
  const large = mounted.assemblies[1];
  const plan = planCogwheelPlacement(
    mounted,
    { x: large.transform.position.x + 1.0, y: 0, z: large.transform.position.z },
    'cog-small',
  );
  assert.ok(plan.snapped);
  assert.equal(plan.snapped.targetAssemblyId, largeId);
  assert.equal('hostAssemblyId' in plan.snapped, false);
  assert.equal(useMechanicsStore.getState().addCogwheel(plan), true);
  const meshed = useMechanicsStore.getState().document;
  assert.equal(meshed.constraints.length, 1);
  assert.equal(meshed.rotationCouplings.length, 1);
  assert.equal(
    meshed.constraints.some((item) => item.assemblyBId === meshed.assemblies[2].assemblyId),
    false,
  );
});

test('automatic relationship anchors come from nearest part surfaces instead of assembly origins', async () => {
  const { closestAssemblyConnection, createAssembly, createPrimitivePart } = await import(
    '../../src/mechanics-engine/index.js'
  );
  const makeBox = (assemblyId, x) => createAssembly({
    assemblyId,
    transform: { position: { x, y: 1, z: 0 } },
    parts: [createPrimitivePart({
      partId: `${assemblyId}:part`,
      size: { x: 2, y: 1, z: 1 },
    })],
  });
  const connection = closestAssemblyConnection(makeBox('assembly:a', 0), makeBox('assembly:b', 4));
  assert.ok(Math.abs(connection.pointA.x - 1) < 1e-9);
  assert.ok(Math.abs(connection.pointB.x - 3) < 1e-9);
  assert.ok(Math.abs(connection.midpoint.x - 2) < 1e-9);
  assert.equal(connection.surfaceGap, 2);
});
