import { create } from 'zustand';
import {
  COGWHEEL_PRESETS,
  MECHANICAL_MATERIALS,
  PRIMITIVE_SHAPES,
  closestAssemblyConnection,
  constraintConnectionPoints,
  createAssembly,
  createConstraint,
  createForceElement,
  createGate,
  createLatch,
  createPrimitivePart,
  createRotationCoupling,
  createSensor,
  createSpellDevice,
  copyMechanicsSelection,
  duplicateAssembly,
  glueAssemblies,
  inverseTransformDirection,
  inverseTransformPoint,
  migrateMechanicsDocument,
  planCogwheelPlacement,
  nextMechanicsId,
  normalizeVector,
  pasteMechanicsSelection,
  removeMechanicsItem,
  rotateVector,
  sanitizeSize,
  transformDirection,
  transformPoint,
  torsionSpringConnectionPoints,
  unglueAssembly,
  validateMechanicsDocument,
  vectorLength,
  subtractVector,
  addVector,
  assemblyNodeDescriptor,
  descendantPartIds,
  scaleVector,
  scaleHierarchyNode,
  updateHierarchyNode,
} from '../../../src/mechanics-engine/index.js';
import { MECHANICS_STARTERS, mechanicsStarterDocument } from './starterDocuments.js';
import { mountedSpellSnapshot } from './spell-device-system.js';
import {
  blueprintAppearanceRestored,
  blueprintAppearanceSummary,
} from './blueprintAppearance.js';

const STORAGE_KEY = 'wha-mechanics-workbench-v1';
const BLUEPRINTS_KEY = 'wha-mechanics-blueprints-v1';
const HISTORY_LIMIT = 60;

const storedDocument = loadStoredDocument();
const initialDocument = storedDocument ?? mechanicsStarterDocument('wind-gears');

export const useMechanicsStore = create((set, get) => ({
  document: initialDocument,
  starterId: storedDocument?.metadata?.starterId ?? (storedDocument ? 'saved' : 'wind-gears'),
  mode: 'build',
  activeTool: 'select',
  transformMode: 'translate',
  placementPreset: 'cuboid',
  cogPreset: 'cog-large',
  selectedAssemblyIds: [],
  selectedMechanicId: null,
  focusedNode: null,
  previewNode: null,
  editorOpacityPreview: null,
  historyPast: [],
  historyFuture: [],
  status: 'Choose a shape or select part of the starter machine.',
  dialog: null,
  runtimeSnapshot: null,
  runtimeResetToken: 0,
  runtimeCommand: null,
  nextRuntimeCommandId: 1,
  manualActiveDeviceIds: [],
  clipboard: null,
  blueprints: loadBlueprints(),
  editingBlueprintId: null,
  editingBlueprintBaseline: null,

  setMode(mode) {
    if (!['build', 'test', 'inspect'].includes(mode)) return;
    set({
      mode,
      editorOpacityPreview: null,
      status:
        mode === 'build'
          ? 'Build mode — physics paused. Change shapes and connections freely.'
          : mode === 'test'
            ? 'Test mode — gravity, joints, springs, gates, and spells are live.'
            : 'Inspect mode — physics paused at the current moment.',
    });
  },

  setActiveTool(activeTool) {
    set({ activeTool, status: toolHint(activeTool) });
  },

  setTransformMode(transformMode) {
    if (!['translate', 'rotate', 'scale'].includes(transformMode) || get().mode !== 'build') return;
    set({
      transformMode,
      status:
        transformMode === 'rotate'
          ? 'Rotate mode — drag a colored ring on the selected assembly.'
          : transformMode === 'scale'
            ? 'Scale mode — drag a box handle; part dimensions stay physical and serializable.'
            : 'Move mode — drag an arrow or plane square to move; hold Shift while dragging to resize those axes.',
    });
  },

  setDialog(dialog) {
    set({ dialog });
  },

  loadStarter(starterId) {
    const document = mechanicsStarterDocument(starterId);
    set((state) => ({
      document,
      starterId,
      mode: 'build',
      selectedAssemblyIds: [],
      selectedMechanicId: null,
      focusedNode: null,
      previewNode: null,
      historyPast: pushHistory(state.historyPast, state.document),
      historyFuture: [],
      runtimeResetToken: state.runtimeResetToken + 1,
      manualActiveDeviceIds: [],
      status: `${document.metadata.name} loaded. Press Test when you are ready.`,
      dialog: null,
      editingBlueprintId: null,
      editingBlueprintBaseline: null,
    }));
  },

  replaceDocument(document, status = 'Contraption loaded.') {
    let migration;
    let migrated;
    let validation;
    try {
      migration = migrateMechanicsDocument(document);
      migrated = migration.document;
      validation = validateMechanicsDocument(migrated);
    } catch {
      set({ status: 'That JSON could not be read as a mechanics document. The current build was kept.' });
      return false;
    }
    if (migration.error || !migrated) {
      set({ status: mechanicsDocumentLoadError(migration.error) });
      return false;
    }
    if (!validation.ok) {
      set({ status: validation.diagnostics[0]?.message ?? 'That file is not a valid contraption.' });
      return false;
    }
    commitDocument(
      set,
      get,
      migrated,
      migration.migrations.length > 0 ? `${status} Older fields were migrated safely.` : status,
      { clearSelection: true },
    );
    set({ editingBlueprintId: null, editingBlueprintBaseline: null });
    return true;
  },

  addPrimitive(preset, placementPosition = null) {
    if (get().mode !== 'build') return;
    const definition = PRIMITIVE_SHAPES[preset] ?? PRIMITIVE_SHAPES.cuboid;
    const document = get().document;
    const assemblyId = nextMechanicsId(document, 'assembly');
    const count = document.assemblies.length;
    const column = count % 5;
    const row = Math.floor(count / 5) % 4;
    const size = definition.defaultSize;
    const position = placementPosition
      ? {
          x: Number(placementPosition.x),
          // The scene passes a surface-aware position (seated on the ground
          // or on an assembly face); fall back to ground rest height.
          y: Number.isFinite(placementPosition.y) && placementPosition.y > 0
            ? Number(placementPosition.y)
            : size.y / 2 + 0.05,
          z: Number(placementPosition.z),
        }
      : {
          x: -2.4 + column * 1.2,
          y: size.y / 2 + 0.05,
          z: -1.6 + row * 1.25,
        };
    const assembly = createAssembly({
      assemblyId,
      label: definition.label,
      transform: {
        position,
      },
      tags: definition.rotationPortAxis ? ['shaft'] : [],
      parts: [
        createPrimitivePart({
          partId: `${assemblyId}:part-1`,
          preset,
        }),
      ],
    });
    const next = { ...document, assemblies: [...document.assemblies, assembly] };
    set({ placementPreset: preset });
    commitDocument(set, get, next, `${definition.label} added. Hover the field or another shape to place more; use Select to move it.`, {
      selectedAssemblyIds: [assemblyId],
      focusedNode: { assemblyId, nodeId: assemblyId },
    });
  },

  selectAssembly(assemblyId, additive = false) {
    set((state) => {
      const selected = additive
        ? state.selectedAssemblyIds.includes(assemblyId)
          ? state.selectedAssemblyIds.filter((id) => id !== assemblyId)
          : [...state.selectedAssemblyIds, assemblyId]
        : [assemblyId];
      const assembly = state.document.assemblies.find((item) => item.assemblyId === assemblyId);
      return {
        selectedAssemblyIds: selected,
        selectedMechanicId: null,
        focusedNode: { assemblyId, nodeId: assemblyId },
        previewNode: null,
        status: assembly ? `${assembly.label} selected.` : state.status,
      };
    });
  },

  focusAssemblyNode(assemblyId, nodeId = assemblyId) {
    const assembly = get().document.assemblies.find((item) => item.assemblyId === assemblyId);
    const descriptor = assembly ? assemblyNodeDescriptor(assembly, nodeId) : null;
    if (!assembly || !descriptor) return;
    set({
      selectedAssemblyIds: [assemblyId],
      selectedMechanicId: null,
      focusedNode: { assemblyId, nodeId: descriptor.nodeId },
      previewNode: null,
      status: `${descriptor.label} selected.`,
    });
  },

  previewAssemblyNode(assemblyId, nodeId) {
    const assembly = get().document.assemblies.find((item) => item.assemblyId === assemblyId);
    const descriptor = assembly ? assemblyNodeDescriptor(assembly, nodeId) : null;
    if (!descriptor) return;
    set({
      previewNode: { assemblyId, nodeId: descriptor.nodeId },
      status: `${descriptor.label} highlighted.`,
    });
  },

  clearPreviewAssemblyNode() {
    set({ previewNode: null });
  },

  previewEditorOpacity(kind, id, opacity) {
    if (get().mode !== 'build' || !['assembly', 'relationship'].includes(kind)) return;
    const value = Number(opacity);
    if (!id || !Number.isFinite(value)) return;
    set({
      editorOpacityPreview: {
        kind,
        id,
        opacity: Math.min(1, Math.max(0.05, value)),
      },
    });
  },

  clearEditorOpacityPreview() {
    set({ editorOpacityPreview: null });
  },

  selectMechanic(selectedMechanicId) {
    set({
      selectedMechanicId,
      selectedAssemblyIds: [],
      focusedNode: null,
      previewNode: null,
      editorOpacityPreview: null,
      status: 'Mechanical relationship selected.',
    });
  },

  clearSelection() {
    set({
      selectedAssemblyIds: [],
      selectedMechanicId: null,
      focusedNode: null,
      previewNode: null,
    });
  },

  updateAssemblyNode(assemblyId, nodeId, patch) {
    if (get().mode !== 'build') return;
    if (nodeId === assemblyId) {
      get().updateAssembly(assemblyId, patch);
      return;
    }
    const document = get().document;
    const next = {
      ...document,
      assemblies: document.assemblies.map((assembly) =>
        assembly.assemblyId === assemblyId
          ? updateHierarchyNode(assembly, nodeId, patch)
          : assembly,
      ),
    };
    commitDocument(set, get, next, 'Assembly contents updated.', {
      selectedAssemblyIds: [assemblyId],
      focusedNode: { assemblyId, nodeId },
    });
  },

  scaleAssemblyNode(assemblyId, nodeId, scale) {
    if (get().mode !== 'build') return;
    if (nodeId === assemblyId) {
      get().setAssemblyTransform(assemblyId, { scale });
      return;
    }
    const document = get().document;
    const next = {
      ...document,
      assemblies: document.assemblies.map((assembly) =>
        assembly.assemblyId === assemblyId
          ? scaleHierarchyNode(assembly, nodeId, scale)
          : assembly,
      ),
    };
    commitDocument(set, get, next, 'Assembly contents resized.', {
      selectedAssemblyIds: [assemblyId],
      focusedNode: { assemblyId, nodeId },
    });
  },

  setAssemblyNodeMaterial(assemblyId, nodeId, materialId) {
    if (!MECHANICAL_MATERIALS[materialId]) return;
    if (nodeId === assemblyId) {
      get().setAssemblyMaterial(assemblyId, materialId);
      return;
    }
    const document = get().document;
    const assembly = document.assemblies.find((item) => item.assemblyId === assemblyId);
    if (!assembly) return;
    const partIds = new Set(descendantPartIds(assembly, nodeId));
    const next = {
      ...document,
      assemblies: document.assemblies.map((item) =>
        item.assemblyId === assemblyId
          ? {
              ...item,
              parts: item.parts.map((part) =>
                partIds.has(part.partId) ? { ...part, materialId } : part,
              ),
            }
          : item,
      ),
    };
    commitDocument(set, get, next, `${MECHANICAL_MATERIALS[materialId].label} applied.`, {
      selectedAssemblyIds: [assemblyId],
      focusedNode: { assemblyId, nodeId },
    });
  },

  updateAssembly(assemblyId, patch) {
    if (get().mode !== 'build') return;
    const document = get().document;
    const next = {
      ...document,
      assemblies: document.assemblies.map((assembly) => {
        if (assembly.assemblyId !== assemblyId) return assembly;
        return {
          ...assembly,
          ...patch,
          editor: patch.editor
            ? { ...assembly.editor, ...patch.editor }
            : assembly.editor,
          transform: patch.transform
            ? {
                position: { ...assembly.transform.position, ...(patch.transform.position ?? {}) },
                rotation: { ...assembly.transform.rotation, ...(patch.transform.rotation ?? {}) },
              }
            : assembly.transform,
        };
      }),
    };
    commitDocument(set, get, next, 'Assembly updated.', { selectedAssemblyIds: [assemblyId] });
  },

  setAssemblyEditorOptions(assemblyId, patch) {
    if (get().mode !== 'build') return;
    const assembly = get().document.assemblies.find((item) => item.assemblyId === assemblyId);
    if (!assembly) return;
    const requestedOpacity = Number(patch.opacity ?? assembly.editor?.opacity ?? 1);
    const editor = {
      opacity: Number.isFinite(requestedOpacity)
        ? Math.min(1, Math.max(0.05, requestedOpacity))
        : assembly.editor?.opacity ?? 1,
      clickThrough: (patch.clickThrough ?? assembly.editor?.clickThrough) === true,
    };
    get().updateAssembly(assemblyId, { editor });
    set({
      status: patch.clickThrough != null
        ? editor.clickThrough
          ? `${assembly.label} is click-through in the editor. Physics is unchanged.`
          : `${assembly.label} can be selected in the world again.`
        : `${assembly.label} opacity set to ${Math.round(editor.opacity * 100)}%.`,
    });
  },

  setAssemblyPosition(assemblyId, position, history = true) {
    if (get().mode !== 'build') return;
    const document = get().document;
    const next = {
      ...document,
      assemblies: document.assemblies.map((assembly) =>
        assembly.assemblyId === assemblyId
          ? { ...assembly, transform: { ...assembly.transform, position: { ...position } } }
          : assembly,
      ),
    };
    if (history) commitDocument(set, get, next, 'Assembly moved.', { selectedAssemblyIds: [assemblyId] });
    else set({ document: next });
  },

  setAssemblyTransform(assemblyId, transform, history = true) {
    if (get().mode !== 'build') return;
    const document = get().document;
    const next = {
      ...document,
      assemblies: document.assemblies.map((assembly) =>
        assembly.assemblyId === assemblyId
          ? (() => {
              const scale = transform.scale ?? { x: 1, y: 1, z: 1 };
              const scaledAssembly = scaleHierarchyNode(assembly, assemblyId, scale);
              return {
              ...scaledAssembly,
              transform: {
                position: {
                  ...assembly.transform.position,
                  ...(transform.position ?? {}),
                  y: Math.max(
                    0.04,
                    transform.position?.y ?? assembly.transform.position.y,
                  ),
                },
                rotation: {
                  ...assembly.transform.rotation,
                  ...(transform.rotation ?? {}),
                },
              },
            };
            })()
          : assembly,
      ),
    };
    if (history) {
      commitDocument(set, get, next, 'Assembly transformed.', {
        selectedAssemblyIds: [assemblyId],
      });
    } else set({ document: next });
  },

  setAssemblyMaterial(assemblyId, materialId) {
    if (!MECHANICAL_MATERIALS[materialId]) return;
    const document = get().document;
    const next = {
      ...document,
      assemblies: document.assemblies.map((assembly) =>
        assembly.assemblyId === assemblyId
          ? {
              ...assembly,
              parts: assembly.parts.map((part) => ({ ...part, materialId })),
            }
          : assembly,
      ),
    };
    commitDocument(set, get, next, `${MECHANICAL_MATERIALS[materialId].label} applied.`, {
      selectedAssemblyIds: [assemblyId],
    });
  },

  updatePart(assemblyId, partId, patch) {
    if (get().mode !== 'build') return;
    const document = get().document;
    const next = {
      ...document,
      assemblies: document.assemblies.map((assembly) =>
        assembly.assemblyId === assemblyId
          ? {
              ...assembly,
              parts: assembly.parts.map((part) =>
                part.partId === partId
                  ? {
                      ...part,
                      ...patch,
                      size: patch.size ? { ...part.size, ...patch.size } : part.size,
                      localTransform: patch.localTransform
                        ? {
                            position: {
                              ...part.localTransform.position,
                              ...(patch.localTransform.position ?? {}),
                            },
                            rotation: {
                              ...part.localTransform.rotation,
                              ...(patch.localTransform.rotation ?? {}),
                            },
                          }
                        : part.localTransform,
                    }
                  : part,
              ),
            }
          : assembly,
      ),
    };
    commitDocument(set, get, next, 'Shape dimensions updated.', { selectedAssemblyIds: [assemblyId] });
  },

  toggleAssemblyFixed(assemblyId) {
    const assembly = get().document.assemblies.find((item) => item.assemblyId === assemblyId);
    if (!assembly) return;
    get().updateAssembly(assemblyId, { bodyMode: assembly.bodyMode === 'fixed' ? 'dynamic' : 'fixed' });
  },

  glueSelection() {
    const state = get();
    const result = glueAssemblies(state.document, state.selectedAssemblyIds);
    if (!result.changed) {
      set({ status: 'Select at least two assemblies to glue.' });
      return;
    }
    commitDocument(set, get, result.document, 'Shapes glued. They now move as one rigid object.', {
      selectedAssemblyIds: [result.assemblyId],
    });
  },

  unglueSelection() {
    const [assemblyId] = get().selectedAssemblyIds;
    const result = unglueAssembly(get().document, assemblyId);
    if (!result.changed) {
      set({ status: 'Select one glued assembly with at least two shapes.' });
      return;
    }
    commitDocument(set, get, result.document, 'Assembly separated into individual shapes.', {
      selectedAssemblyIds: result.assemblyIds,
    });
  },

  duplicateSelection() {
    const [assemblyId] = get().selectedAssemblyIds;
    if (!assemblyId) return;
    const nextId = nextMechanicsId(get().document, 'assembly');
    const result = duplicateAssembly(get().document, assemblyId, nextId);
    if (!result.changed) return;
    commitDocument(set, get, result.document, 'Assembly duplicated.', {
      selectedAssemblyIds: [result.assemblyId],
    });
  },

  copySelection() {
    const state = get();
    if (state.selectedAssemblyIds.length === 0) return false;
    const clipboard = copyMechanicsSelection(state.document, state.selectedAssemblyIds);
    set({
      clipboard,
      status: `${clipboard.assemblies.length} assembly${clipboard.assemblies.length === 1 ? '' : 'ies'} copied with internal relationships.`,
    });
    return true;
  },

  pasteSelection() {
    const state = get();
    const result = pasteMechanicsSelection(state.document, state.clipboard);
    if (!result.changed) {
      set({ status: 'Copy one or more assemblies before pasting.' });
      return false;
    }
    commitDocument(set, get, result.document, 'Copied assemblies pasted with their internal relationships.', {
      selectedAssemblyIds: result.assemblyIds,
    });
    return true;
  },

  deleteSelection() {
    const state = get();
    const ids = state.selectedAssemblyIds.length > 0
      ? state.selectedAssemblyIds
      : state.selectedMechanicId
        ? [state.selectedMechanicId]
        : [];
    if (ids.length === 0) return;
    let document = state.document;
    for (const id of ids) document = removeMechanicsItem(document, id).document;
    commitDocument(set, get, document, `${ids.length} item${ids.length === 1 ? '' : 's'} removed.`, {
      clearSelection: true,
    });
  },

  addConstraint(input) {
    const document = get().document;
    const assemblyA = document.assemblies.find((item) => item.assemblyId === input.assemblyAId);
    const assemblyB = document.assemblies.find((item) => item.assemblyId === input.assemblyBId);
    if (!assemblyA || !assemblyB || assemblyA.assemblyId === assemblyB.assemblyId) return false;
    const alreadyConnected = document.constraints.some(
      (item) =>
        (item.assemblyAId === assemblyA.assemblyId && item.assemblyBId === assemblyB.assemblyId) ||
        (item.assemblyAId === assemblyB.assemblyId && item.assemblyBId === assemblyA.assemblyId),
    );
    if (alreadyConnected) {
      set({ status: 'Those assemblies already have a primary joint. Delete it before replacing it.' });
      return false;
    }
    const connection = closestAssemblyConnection(assemblyA, assemblyB);
    const midpoint = connection?.midpoint
      ?? scaleVector(addVector(assemblyA.transform.position, assemblyB.transform.position), 0.5);
    const axisWorld = axisVector(input.axis);
    const constraint = createConstraint({
      constraintId: nextMechanicsId(document, 'constraint'),
      type: input.type,
      label: input.label || undefined,
      assemblyAId: assemblyA.assemblyId,
      assemblyBId: assemblyB.assemblyId,
      localAnchorA: inverseTransformPoint(assemblyA.transform, midpoint),
      localAnchorB: inverseTransformPoint(assemblyB.transform, midpoint),
      localAxisA: inverseTransformDirection(assemblyA.transform, axisWorld),
      limits: {
        enabled: input.limitsEnabled !== false,
        min: Number(input.min),
        max: Number(input.max),
      },
      collideConnected: input.collideConnected === true,
      drive: input.driveEnabled
        ? {
            enabled: true,
            targetVelocity: Number(input.driveVelocity ?? 1.3),
            damping: Number(input.driveDamping ?? 2.2),
            maxImpulse: Number(input.driveMaxTorque ?? 18),
          }
        : null,
    });
    commitDocument(
      set,
      get,
      { ...document, constraints: [...document.constraints, constraint] },
      `${constraint.label} connected.`,
      { selectedMechanicId: constraint.constraintId },
    );
    return true;
  },

  addSpring(input) {
    const document = get().document;
    const assemblyA = document.assemblies.find((item) => item.assemblyId === input.assemblyAId);
    const assemblyB = document.assemblies.find((item) => item.assemblyId === input.assemblyBId);
    if (!assemblyA || !assemblyB) return false;
    const distance = vectorLength(subtractVector(assemblyA.transform.position, assemblyB.transform.position));
    const connection = closestAssemblyConnection(assemblyA, assemblyB);
    const element = createForceElement({
      forceElementId: nextMechanicsId(document, 'spring'),
      type: input.type,
      label: input.label || undefined,
      assemblyAId: assemblyA.assemblyId,
      assemblyBId: assemblyB.assemblyId,
      constraintId: input.constraintId || null,
      localAnchorA: connection ? inverseTransformPoint(assemblyA.transform, connection.pointA) : undefined,
      localAnchorB: connection ? inverseTransformPoint(assemblyB.transform, connection.pointB) : undefined,
      restLength: Number(input.restLength ?? (connection ? connection.surfaceGap : distance || 1)),
      restAngle: Number(input.restAngle ?? 0),
      stiffness: Number(input.stiffness ?? 32),
      damping: Number(input.damping ?? 5),
      maxImpulse: Number(input.maxImpulse ?? 36),
    });
    commitDocument(
      set,
      get,
      { ...document, forceElements: [...document.forceElements, element] },
      `${element.label} connected.`,
      { selectedMechanicId: element.forceElementId },
    );
    return true;
  },

  addLatch(input) {
    const document = get().document;
    const assemblyA = document.assemblies.find((item) => item.assemblyId === input.assemblyAId);
    const assemblyB = document.assemblies.find((item) => item.assemblyId === input.assemblyBId);
    if (!assemblyA || !assemblyB) return false;
    const connection = closestAssemblyConnection(assemblyA, assemblyB);
    const latch = createLatch({
      latchId: nextMechanicsId(document, 'latch'),
      assemblyAId: input.assemblyAId,
      assemblyBId: input.assemblyBId,
      mode: input.mode,
      label: input.label || undefined,
      releaseSensorId: input.releaseSensorId || null,
      localAnchorA: connection ? inverseTransformPoint(assemblyA.transform, connection.pointA) : undefined,
      localAnchorB: connection ? inverseTransformPoint(assemblyB.transform, connection.pointB) : undefined,
    });
    commitDocument(
      set,
      get,
      { ...document, latches: [...document.latches, latch] },
      'Latch added. It begins armed when Test starts.',
      { selectedMechanicId: latch.latchId },
    );
    return true;
  },

  addSensor(input) {
    const document = get().document;
    const assembly = document.assemblies.find((item) => item.assemblyId === input.assemblyId);
    const sensor = createSensor({
      sensorId: nextMechanicsId(document, 'sensor'),
      assemblyId: input.attachToAssembly ? input.assemblyId : null,
      label: input.label || undefined,
      shape: input.shape,
      size: { x: Number(input.sizeX), y: Number(input.sizeY), z: Number(input.sizeZ) },
      localTransform: {
        position: input.attachToAssembly && assembly
          ? { x: 0, y: 0, z: 0 }
          : assembly?.transform.position ?? { x: 0, y: 0.5, z: 0 },
      },
      triggerPolicy: input.triggerPolicy,
    });
    commitDocument(
      set,
      get,
      { ...document, sensors: [...document.sensors, sensor] },
      'Contact trigger added. Connect it to a latch from the Latch dialog.',
      { selectedMechanicId: sensor.sensorId },
    );
    return true;
  },

  addGearCoupling(input) {
    const document = get().document;
    const assemblyA = document.assemblies.find((item) => item.assemblyId === input.assemblyAId);
    const assemblyB = document.assemblies.find((item) => item.assemblyId === input.assemblyBId);
    if (!assemblyA || !assemblyB) return false;
    const connection = closestAssemblyConnection(assemblyA, assemblyB);
    const coupling = createRotationCoupling({
      couplingId: nextMechanicsId(document, 'coupling'),
      assemblyAId: input.assemblyAId,
      assemblyBId: input.assemblyBId,
      axisA: axisVector(input.axisA),
      axisB: axisVector(input.axisB),
      localAnchorA: connection
        ? inverseTransformPoint(assemblyA.transform, connection.pointA)
        : null,
      localAnchorB: connection
        ? inverseTransformPoint(assemblyB.transform, connection.pointB)
        : null,
      ratio: Number(input.ratio),
      torqueCapacity: Number(input.torqueCapacity),
      style: 'shaft',
      label: input.label || 'Shaft link',
    });
    commitDocument(
      set,
      get,
      { ...document, rotationCouplings: [...document.rotationCouplings, coupling] },
      'Shaft link connected. The rod is decorative; torque is physically coupled at the ratio.',
      { selectedMechanicId: coupling.couplingId },
    );
    return true;
  },

  setCogPreset(cogPreset) {
    if (!COGWHEEL_PRESETS[cogPreset]) return;
    set({ cogPreset });
  },

  // A surface-mounted cog gets an authored axle. A cog snapped into a mesh
  // gets only the mesh relationship; the runtime supplies invisible free-spin
  // support without cluttering the document with another connection.
  addCogwheel(plan) {
    if (get().mode !== 'build' || !plan) return false;
    const document = get().document;
    const preset = COGWHEEL_PRESETS[plan.presetId] ?? COGWHEEL_PRESETS['cog-large'];
    const assemblyId = nextMechanicsId(document, 'assembly');
    const assembly = createAssembly({
      assemblyId,
      label: preset.label,
      transform: { position: plan.position, rotation: plan.rotation },
      tags: ['shaft'],
      parts: [
        createPrimitivePart({
          partId: `${assemblyId}:part-1`,
          shape: 'cogwheel',
          label: preset.label,
          size: preset.defaultSize,
          materialId: 'material.wood_heavy',
          rotationPortAxis: preset.rotationPortAxis,
        }),
      ],
    });
    let next = { ...document, assemblies: [...document.assemblies, assembly] };
    const notes = [`${preset.label} placed.`];
    const hostAssemblyId = plan.snapped ? null : plan.hostAssemblyId ?? null;
    const host = next.assemblies.find((item) => item.assemblyId === hostAssemblyId);
    if (host) {
      const worldAxis =
        plan.worldAxis ??
        transformDirection({ position: { x: 0, y: 0, z: 0 }, rotation: plan.rotation }, { x: 0, y: 1, z: 0 });
      const constraint = createConstraint({
        constraintId: nextMechanicsId(next, 'constraint'),
        type: 'revolute',
        label: `${preset.label} axle`,
        assemblyAId: host.assemblyId,
        assemblyBId: assemblyId,
        localAnchorA: inverseTransformPoint(host.transform, plan.position),
        localAnchorB: { x: 0, y: 0, z: 0 },
        localAxisA: inverseTransformDirection(host.transform, worldAxis),
      });
      next = { ...next, constraints: [...next.constraints, constraint] };
      notes.push(`Axle hinged to ${host.label}.`);
    }
    if (plan.snapped) {
      const target = next.assemblies.find((item) => item.assemblyId === plan.snapped.targetAssemblyId);
      if (target) {
        const coupling = createRotationCoupling({
          couplingId: nextMechanicsId(next, 'coupling'),
          assemblyAId: target.assemblyId,
          assemblyBId: assemblyId,
          axisA: plan.snapped.targetLocalAxis,
          axisB: { x: 0, y: 1, z: 0 },
          ratio: plan.snapped.ratio,
          torqueCapacity: 32,
          style: 'mesh',
          label: `Cog mesh ${meshRatioLabel(plan.snapped.ratio)}`,
        });
        next = { ...next, rotationCouplings: [...next.rotationCouplings, coupling] };
        notes.push(`Teeth meshed with ${target.label} at ${meshRatioLabel(plan.snapped.ratio)}.`);
      }
    }
    commitDocument(set, get, next, notes.join(' '), { selectedAssemblyIds: [assemblyId] });
    return true;
  },

  // Quick-add from the palette: lands on the placement grid, but still snaps
  // into mesh when a cogwheel is nearby — clicking Large then Small yields a
  // working coupled pair with zero extra steps.
  addCogwheelQuick(presetId) {
    if (get().mode !== 'build') return false;
    const document = get().document;
    const count = document.assemblies.length;
    const cursor = {
      x: -2.4 + (count % 5) * 1.2,
      y: 0,
      z: -1.6 + (Math.floor(count / 5) % 4) * 1.25,
    };
    const plan = planCogwheelPlacement(document, cursor, presetId, { snap: true });
    set({ cogPreset: COGWHEEL_PRESETS[presetId] ? presetId : get().cogPreset });
    return get().addCogwheel(plan);
  },

  addSpellPlate(input) {
    const document = get().document;
    const deviceId = nextMechanicsId(document, 'spell-device');
    const gateId = input.gateType === 'manual' ? null : nextMechanicsId(document, 'gate');
    const device = createSpellDevice({
      deviceId,
      assemblyId: input.assemblyId,
      label: input.label || (input.spellTemplateId ? undefined : 'Empty spell socket'),
      spellTemplateId: input.spellTemplateId || null,
      spell: mountedSpellSnapshot(input.spellTemplate),
      gateId,
      forceScale: Number(input.forceScale ?? 1),
      localFrame: {
        origin: { x: 0, y: Number(input.offset ?? 0.12), z: 0 },
        normal: axisVector(input.normal),
        tangent: tangentForAxis(input.normal),
      },
    });
    const gate = gateId
      ? createGate({
          gateId,
          type: input.gateType,
          plateDeviceId: deviceId,
          driverConstraintId: input.driverConstraintId,
          closedRange: { min: 0.43, max: 0.57 },
          closedWindows: [{ startRadians: -0.28, endRadians: 0.28 }],
          phaseOffsetRadians: Number(input.phaseOffsetRadians ?? 0),
        })
      : null;
    commitDocument(
      set,
      get,
      {
        ...document,
        spellDevices: [...document.spellDevices, device],
        gates: gate ? [...document.gates, gate] : document.gates,
      },
      gate ? `${gate.label} mounted with the spell plate.` : 'Spell plate mounted with a manual test gate.',
      { selectedMechanicId: device.deviceId },
    );
    return true;
  },

  updateMechanic(mechanicId, patch, status = 'Relationship updated.') {
    if (get().mode !== 'build') return false;
    const document = get().document;
    const next = patchMechanicDocument(document, mechanicId, patch);
    if (!next) return false;
    const validation = validateMechanicsDocument(next);
    if (!validation.ok) {
      set({ status: validation.diagnostics[0]?.message ?? 'That change is not valid.' });
      return false;
    }
    commitDocument(set, get, next, status, { selectedMechanicId: mechanicId });
    return true;
  },

  setSpellPlateTransform(deviceId, transform) {
    if (get().mode !== 'build') return false;
    const document = get().document;
    const device = document.spellDevices.find((item) => item.deviceId === deviceId);
    const assembly = document.assemblies.find((item) => item.assemblyId === device?.assemblyId);
    if (!device || !assembly || !transform?.position || !transform?.rotation) return false;
    const worldNormal = rotateVector({ x: 0, y: 0, z: 1 }, transform.rotation);
    const worldTangent = rotateVector({ x: 1, y: 0, z: 0 }, transform.rotation);
    const scale = transform.scale ?? { x: 1, y: 1, z: 1 };
    const scaleFactor = [scale.x, scale.y, scale.z]
      .map((value) => Number(value) || 1)
      .reduce((chosen, value) => (
        Math.abs(value - 1) > Math.abs(chosen - 1) ? value : chosen
      ), 1);
    const next = patchMechanicDocument(document, deviceId, {
      localFrame: {
        origin: inverseTransformPoint(assembly.transform, transform.position),
        normal: inverseTransformDirection(assembly.transform, worldNormal),
        tangent: inverseTransformDirection(assembly.transform, worldTangent),
      },
      plateRadius: (device.plateRadius ?? 0.42) * Math.max(0.1, scaleFactor),
    });
    if (!next) return false;
    commitDocument(set, get, next, 'Spell plate mount transformed.', { selectedMechanicId: deviceId });
    return true;
  },

  setRelationshipEndpoint(mechanicId, side, worldPoint) {
    if (get().mode !== 'build' || !['A', 'B'].includes(side)) return false;
    const document = get().document;
    const anchorKey = side === 'A' ? 'localAnchorA' : 'localAnchorB';
    const assemblyKey = side === 'A' ? 'assemblyAId' : 'assemblyBId';
    let collectionKey = null;
    let idKey = null;
    let mechanic = document.constraints.find((item) => item.constraintId === mechanicId);
    if (mechanic) [collectionKey, idKey] = ['constraints', 'constraintId'];
    if (!mechanic) {
      mechanic = document.forceElements.find((item) => item.forceElementId === mechanicId);
      if (mechanic) [collectionKey, idKey] = ['forceElements', 'forceElementId'];
    }
    if (!mechanic) {
      mechanic = document.latches.find((item) => item.latchId === mechanicId);
      if (mechanic) [collectionKey, idKey] = ['latches', 'latchId'];
    }
    if (!mechanic) {
      mechanic = document.rotationCouplings.find(
        (item) => item.couplingId === mechanicId && item.style !== 'mesh',
      );
      if (mechanic) [collectionKey, idKey] = ['rotationCouplings', 'couplingId'];
    }
    const assembly = document.assemblies.find(
      (item) => item.assemblyId === mechanic?.[assemblyKey],
    );
    if (!mechanic || !assembly || !worldPoint) {
      set({ status: 'That relationship does not have a movable endpoint.' });
      return false;
    }
    let nextMechanic;
    if (collectionKey === 'constraints') {
      const assemblyA = document.assemblies.find((item) => item.assemblyId === mechanic.assemblyAId);
      const assemblyB = document.assemblies.find((item) => item.assemblyId === mechanic.assemblyBId);
      const current = constraintConnectionPoints(document, mechanic);
      if (!assemblyA || !assemblyB || !current) return false;
      const pointA = side === 'A' ? worldPoint : current.pointA;
      const pointB = side === 'B' ? worldPoint : current.pointB;
      nextMechanic = {
        ...mechanic,
        connectionAnchorA: inverseTransformPoint(assemblyA.transform, pointA),
        connectionAnchorB: inverseTransformPoint(assemblyB.transform, pointB),
      };
      delete nextMechanic.surfaceAnchorA;
      delete nextMechanic.surfaceAnchorB;
    } else if (collectionKey === 'forceElements' && mechanic.type === 'torsion_spring') {
      const current = torsionSpringConnectionPoints(document, mechanic);
      const assemblyA = document.assemblies.find((item) => item.assemblyId === mechanic.assemblyAId);
      const assemblyB = document.assemblies.find((item) => item.assemblyId === mechanic.assemblyBId);
      if (!assemblyA || !assemblyB || !current) return false;
      nextMechanic = {
        ...mechanic,
        connectionAnchorA: inverseTransformPoint(
          assemblyA.transform,
          side === 'A' ? worldPoint : current.pointA,
        ),
        connectionAnchorB: inverseTransformPoint(
          assemblyB.transform,
          side === 'B' ? worldPoint : current.pointB,
        ),
      };
    } else {
      nextMechanic = {
        ...mechanic,
        [anchorKey]: inverseTransformPoint(assembly.transform, worldPoint),
      };
    }
    const next = {
      ...document,
      [collectionKey]: document[collectionKey].map((item) =>
        item[idKey] === mechanicId ? nextMechanic : item,
      ),
    };
    const validation = validateMechanicsDocument(next);
    if (!validation.ok) {
      set({ status: validation.diagnostics[0]?.message ?? 'That endpoint position is not valid.' });
      return false;
    }
    commitDocument(
      set,
      get,
      next,
      `${side === 'A' ? 'First' : 'Second'} connection point moved on ${assembly.label}.`,
      { selectedMechanicId: mechanicId },
    );
    return true;
  },

  setSpellPlateGate(deviceId, input) {
    if (get().mode !== 'build') return false;
    const document = get().document;
    const device = document.spellDevices.find((item) => item.deviceId === deviceId);
    if (!device) return false;
    const otherGates = document.gates.filter((gate) => gate.gateId !== device.gateId);
    if (input.gateType === 'manual') {
      if (!device.gateId) return true;
      commitDocument(
        set,
        get,
        {
          ...document,
          gates: otherGates,
          spellDevices: document.spellDevices.map((item) =>
            item.deviceId === deviceId ? { ...item, gateId: null } : item,
          ),
        },
        'Spell plate switched to a manual test key.',
        { selectedMechanicId: deviceId },
      );
      return true;
    }
    if (!input.driverConstraintId) {
      set({
        status:
          input.gateType === 'sliding_ring_gate'
            ? 'Add a slider joint first so it can drive this gate.'
            : 'Add a hinge first so it can drive this gate.',
      });
      return false;
    }
    const existing = document.gates.find((gate) => gate.gateId === device.gateId);
    const gateId = device.gateId ?? nextMechanicsId(document, 'gate');
    const gate = createGate({
      ...(existing ?? {}),
      label: existing && existing.type === input.gateType ? existing.label : undefined,
      gateId,
      type: input.gateType,
      plateDeviceId: deviceId,
      driverConstraintId: input.driverConstraintId,
      phaseOffsetRadians: Number(input.phaseOffsetRadians ?? existing?.phaseOffsetRadians ?? 0),
      closedRange: existing?.closedRange ?? { min: 0.43, max: 0.57 },
      closedWindows: existing?.closedWindows?.length
        ? existing.closedWindows
        : [{ startRadians: -0.28, endRadians: 0.28 }],
    });
    const next = {
      ...document,
      gates: [...otherGates, gate],
      spellDevices: document.spellDevices.map((item) =>
        item.deviceId === deviceId ? { ...item, gateId } : item,
      ),
    };
    const validation = validateMechanicsDocument(next);
    if (!validation.ok) {
      set({ status: validation.diagnostics[0]?.message ?? 'That gate setup is not valid.' });
      return false;
    }
    commitDocument(set, get, next, `${gate.label} now drives the spell plate.`, {
      selectedMechanicId: deviceId,
    });
    return true;
  },

  toggleManualSpell(deviceId) {
    set((state) => {
      const device = state.document.spellDevices.find((item) => item.deviceId === deviceId);
      if (!device?.spellTemplateId) {
        return {
          manualActiveDeviceIds: state.manualActiveDeviceIds.filter((id) => id !== deviceId),
        };
      }
      return {
        manualActiveDeviceIds: state.manualActiveDeviceIds.includes(deviceId)
          ? state.manualActiveDeviceIds.filter((id) => id !== deviceId)
          : [...state.manualActiveDeviceIds, deviceId],
      };
    });
  },

  issueRuntimeCommand(type, payload = {}) {
    set((state) => ({
      runtimeCommand: { id: state.nextRuntimeCommandId, type, ...payload },
      nextRuntimeCommandId: state.nextRuntimeCommandId + 1,
    }));
  },

  setRuntimeSnapshot(runtimeSnapshot) {
    set({ runtimeSnapshot });
  },

  resetTest() {
    set((state) => ({
      runtimeResetToken: state.runtimeResetToken + 1,
      mode: 'build',
      runtimeSnapshot: null,
      manualActiveDeviceIds: [],
      status: 'Test reset to the last Build state.',
    }));
  },

  undo() {
    const state = get();
    const previous = state.historyPast.at(-1);
    if (!previous || state.mode !== 'build') return;
    set({
      document: previous,
      historyPast: state.historyPast.slice(0, -1),
      historyFuture: [state.document, ...state.historyFuture].slice(0, HISTORY_LIMIT),
      selectedAssemblyIds: [],
      selectedMechanicId: null,
      focusedNode: null,
      previewNode: null,
      runtimeResetToken: state.runtimeResetToken + 1,
      status: 'Undid the last build action.',
    });
  },

  redo() {
    const state = get();
    const next = state.historyFuture[0];
    if (!next || state.mode !== 'build') return;
    set({
      document: next,
      historyPast: pushHistory(state.historyPast, state.document),
      historyFuture: state.historyFuture.slice(1),
      selectedAssemblyIds: [],
      selectedMechanicId: null,
      focusedNode: null,
      previewNode: null,
      runtimeResetToken: state.runtimeResetToken + 1,
      status: 'Redid the build action.',
    });
  },

  saveBlueprint(name) {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) return false;
    const record = {
      blueprintId: nextBlueprintId(get().blueprints),
      name: trimmed,
      document: get().document,
    };
    set((state) => ({
      blueprints: [...state.blueprints, record],
      status: `${trimmed} saved to this browser. Appearance check: ${blueprintAppearanceSummary(record.document)}.`,
    }));
    return record.blueprintId;
  },

  saveBlueprintAsNew(name) {
    const source = get().blueprints.find((item) => item.blueprintId === get().editingBlueprintId);
    const trimmed = String(name ?? '').trim();
    if (!trimmed) return false;
    const record = {
      blueprintId: nextBlueprintId(get().blueprints),
      name: trimmed,
      document: get().document,
    };
    set((state) => ({
      blueprints: [...state.blueprints, record],
      status: `${trimmed} saved as a new blueprint with its current opacity settings. ${source?.name ?? 'The original'} was not changed.`,
      dialog: null,
      editingBlueprintId: record.blueprintId,
      editingBlueprintBaseline: state.document,
    }));
    return record.blueprintId;
  },

  overwriteBlueprint() {
    const state = get();
    const blueprint = state.blueprints.find((item) => item.blueprintId === state.editingBlueprintId);
    if (!blueprint) return false;
    set({
      blueprints: state.blueprints.map((item) => (
        item.blueprintId === blueprint.blueprintId
          ? { ...item, document: state.document }
          : item
      )),
      editingBlueprintBaseline: state.document,
      status: `${blueprint.name} updated in the Mechanics Library. Appearance check: ${blueprintAppearanceSummary(state.document)}.`,
    });
    return true;
  },

  beginBlueprintEdit(blueprintId) {
    const state = get();
    if (state.editingBlueprintId === blueprintId && state.editingBlueprintBaseline) return true;
    const blueprint = state.blueprints.find((item) => item.blueprintId === blueprintId);
    if (!blueprint) {
      set({ status: 'That saved blueprint is no longer available.' });
      return false;
    }
    if (!get().replaceDocument(blueprint.document, `${blueprint.name} opened for editing.`)) return false;
    const loadedDocument = get().document;
    const appearanceRestored = blueprintAppearanceRestored(blueprint.document, loadedDocument);
    set({
      editingBlueprintId: blueprint.blueprintId,
      editingBlueprintBaseline: loadedDocument,
      mode: 'build',
      dialog: null,
      status: appearanceRestored
        ? `${blueprint.name} opened for editing. Appearance check: ${blueprintAppearanceSummary(loadedDocument)} restored.`
        : `${blueprint.name} opened, but some opacity settings changed during document migration. Review appearance before saving.`,
    });
    return true;
  },

  loadBlueprint(blueprintId) {
    return get().beginBlueprintEdit(blueprintId);
  },

  deleteBlueprint(blueprintId) {
    set((state) => ({
      blueprints: state.blueprints.filter((item) => item.blueprintId !== blueprintId),
      status: 'Saved blueprint removed.',
      editingBlueprintId: state.editingBlueprintId === blueprintId ? null : state.editingBlueprintId,
      editingBlueprintBaseline: state.editingBlueprintId === blueprintId
        ? null
        : state.editingBlueprintBaseline,
    }));
  },
}));

let lastPersistedDocument = null;
let lastPersistedBlueprints = null;
useMechanicsStore.subscribe((state) => {
  if (typeof localStorage === 'undefined') return;
  if (state.document !== lastPersistedDocument) {
    lastPersistedDocument = state.document;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.document));
  }
  if (state.blueprints !== lastPersistedBlueprints) {
    lastPersistedBlueprints = state.blueprints;
    localStorage.setItem(BLUEPRINTS_KEY, JSON.stringify(state.blueprints));
  }
});

function commitDocument(set, get, document, status, options = {}) {
  set((state) => ({
    document: {
      ...document,
      metadata: {
        ...document.metadata,
        revision: (state.document.metadata?.revision ?? 0) + 1,
      },
    },
    historyPast: pushHistory(state.historyPast, state.document),
    historyFuture: [],
    selectedAssemblyIds: options.clearSelection
      ? []
      : options.selectedAssemblyIds ?? state.selectedAssemblyIds,
    selectedMechanicId: options.clearSelection
      ? null
      : options.selectedMechanicId ?? state.selectedMechanicId,
    focusedNode: options.clearSelection
      ? null
      : options.focusedNode
        ?? (options.selectedAssemblyIds?.length === 1
          ? { assemblyId: options.selectedAssemblyIds[0], nodeId: options.selectedAssemblyIds[0] }
          : state.focusedNode),
    previewNode: null,
    editorOpacityPreview: null,
    runtimeResetToken: state.runtimeResetToken + 1,
    status,
    dialog: null,
  }));
}

function pushHistory(history, document) {
  return [...history, document].slice(-HISTORY_LIMIT);
}

function patchMechanicDocument(document, mechanicId, patch) {
  const constraint = document.constraints.find((item) => item.constraintId === mechanicId);
  if (constraint) {
    const nextConstraint = patchConstraint(document, constraint, patch);
    return {
      ...document,
      constraints: document.constraints.map((item) =>
        item === constraint ? nextConstraint : item,
      ),
      forceElements: document.forceElements.map((item) =>
        item.type === 'torsion_spring' && item.constraintId === mechanicId
          ? {
              ...item,
              assemblyAId: nextConstraint.assemblyAId,
              assemblyBId: nextConstraint.assemblyBId,
            }
          : item,
      ),
    };
  }
  const spring = document.forceElements.find((item) => item.forceElementId === mechanicId);
  if (spring) {
    return {
      ...document,
      forceElements: document.forceElements.map((item) =>
        item === spring ? patchSpring(document, item, patch) : item,
      ),
    };
  }
  const sensor = document.sensors.find((item) => item.sensorId === mechanicId);
  if (sensor) {
    return {
      ...document,
      sensors: document.sensors.map((item) => (item === sensor ? patchSensor(document, item, patch) : item)),
    };
  }
  const latch = document.latches.find((item) => item.latchId === mechanicId);
  if (latch) {
    return {
      ...document,
      latches: document.latches.map((item) => (item === latch ? patchLatch(item, patch) : item)),
    };
  }
  const coupling = document.rotationCouplings.find((item) => item.couplingId === mechanicId);
  if (coupling) {
    return {
      ...document,
      rotationCouplings: document.rotationCouplings.map((item) =>
        item === coupling ? patchCoupling(item, patch) : item,
      ),
    };
  }
  const device = document.spellDevices.find((item) => item.deviceId === mechanicId);
  if (device) {
    return {
      ...document,
      spellDevices: document.spellDevices.map((item) => (item === device ? patchDevice(document, item, patch) : item)),
    };
  }
  const gate = document.gates.find((item) => item.gateId === mechanicId);
  if (gate) {
    return {
      ...document,
      gates: document.gates.map((item) => (item === gate ? patchGate(item, patch) : item)),
    };
  }
  return null;
}

function patchConstraint(document, constraint, patch) {
  const next = withMechanicEditorPatch({ ...constraint }, patch);
  if (patch.label != null) next.label = patch.label;
  if (patch.type && ['fixed', 'revolute', 'prismatic'].includes(patch.type)) next.type = patch.type;
  if (patch.collideConnected != null) next.collideConnected = Boolean(patch.collideConnected);
  if (patch.limits) {
    next.limits = {
      enabled: patch.limits.enabled ?? next.limits.enabled,
      min: Number(patch.limits.min ?? next.limits.min),
      max: Number(patch.limits.max ?? next.limits.max),
    };
  }
  if (patch.drive !== undefined) {
    next.drive =
      patch.drive === null
        ? null
        : {
            enabled: true,
            targetVelocity: 1.3,
            damping: 2.2,
            maxImpulse: 18,
            ...(next.drive ?? {}),
            ...patch.drive,
          };
  }
  // Keep the axis pointing the same way in the world when assemblies change,
  // unless the patch explicitly picks a new axis.
  const oldA = document.assemblies.find((item) => item.assemblyId === constraint.assemblyAId);
  let worldAxis = oldA
    ? transformDirection(oldA.transform, constraint.localAxisA)
    : { ...constraint.localAxisA };
  if (patch.axis) worldAxis = axisVector(patch.axis);
  if (patch.assemblyAId) next.assemblyAId = patch.assemblyAId;
  if (patch.assemblyBId) next.assemblyBId = patch.assemblyBId;
  const assemblyA = document.assemblies.find((item) => item.assemblyId === next.assemblyAId);
  const assemblyB = document.assemblies.find((item) => item.assemblyId === next.assemblyBId);
  if ((patch.axis || patch.assemblyAId) && assemblyA) {
    next.localAxisA = inverseTransformDirection(assemblyA.transform, worldAxis);
  }
  if ((patch.assemblyAId || patch.assemblyBId || patch.recenterAnchors) && assemblyA && assemblyB) {
    const midpoint = scaleVector(
      addVector(assemblyA.transform.position, assemblyB.transform.position),
      0.5,
    );
    next.localAnchorA = inverseTransformPoint(assemblyA.transform, midpoint);
    next.localAnchorB = inverseTransformPoint(assemblyB.transform, midpoint);
    delete next.connectionAnchorA;
    delete next.connectionAnchorB;
    delete next.surfaceAnchorA;
    delete next.surfaceAnchorB;
  }
  return next;
}

function patchSpring(document, spring, patch) {
  const next = withMechanicEditorPatch({ ...spring }, patch);
  if (patch.label != null) next.label = patch.label;
  for (const key of ['restLength', 'restAngle', 'stiffness', 'damping', 'maxImpulse']) {
    if (patch[key] != null && Number.isFinite(Number(patch[key]))) next[key] = Number(patch[key]);
  }
  if (patch.constraintId !== undefined) {
    next.constraintId = patch.constraintId || null;
    const hinge = document.constraints.find((item) => item.constraintId === patch.constraintId);
    if (hinge) {
      next.assemblyAId = hinge.assemblyAId;
      next.assemblyBId = hinge.assemblyBId;
    }
  }
  if (patch.assemblyAId) next.assemblyAId = patch.assemblyAId;
  if (patch.assemblyBId) next.assemblyBId = patch.assemblyBId;
  return next;
}

function patchSensor(document, sensor, patch) {
  const next = withMechanicEditorPatch({ ...sensor }, patch);
  if (patch.label != null) next.label = patch.label;
  if (patch.shape) next.shape = patch.shape === 'sphere' ? 'sphere' : 'cuboid';
  if (patch.triggerPolicy) next.triggerPolicy = patch.triggerPolicy;
  if (patch.acceptedTags) next.acceptedTags = patch.acceptedTags.map(String);
  if (patch.size) next.size = sanitizeSize({ ...next.size, ...patch.size });
  if (patch.position) {
    next.localTransform = {
      ...next.localTransform,
      position: { ...next.localTransform.position, ...patch.position },
    };
  }
  if (patch.assemblyId !== undefined && (patch.assemblyId || null) !== (sensor.assemblyId ?? null)) {
    // Convert the stored position so the zone stays where it is in the world.
    const oldHost = document.assemblies.find((item) => item.assemblyId === sensor.assemblyId);
    const worldPosition = oldHost
      ? transformPoint(oldHost.transform, next.localTransform.position)
      : { ...next.localTransform.position };
    const newHost = document.assemblies.find((item) => item.assemblyId === patch.assemblyId);
    next.assemblyId = newHost ? patch.assemblyId : null;
    next.localTransform = {
      ...next.localTransform,
      position: newHost ? inverseTransformPoint(newHost.transform, worldPosition) : worldPosition,
    };
  }
  return next;
}

function patchLatch(latch, patch) {
  const next = withMechanicEditorPatch({ ...latch }, patch);
  if (patch.label != null) next.label = patch.label;
  if (patch.mode) next.mode = patch.mode === 'manual' ? 'manual' : 'catch';
  if (patch.releaseSensorId !== undefined) next.releaseSensorId = patch.releaseSensorId || null;
  if (patch.assemblyAId) next.assemblyAId = patch.assemblyAId;
  if (patch.assemblyBId) next.assemblyBId = patch.assemblyBId;
  for (const key of ['catchDistance', 'catchSpeed']) {
    if (patch[key] != null && Number.isFinite(Number(patch[key]))) next[key] = Number(patch[key]);
  }
  return next;
}

function patchCoupling(coupling, patch) {
  const next = withMechanicEditorPatch({ ...coupling }, patch);
  if (patch.label != null) next.label = patch.label;
  if (patch.assemblyAId) next.assemblyAId = patch.assemblyAId;
  if (patch.assemblyBId) next.assemblyBId = patch.assemblyBId;
  if (patch.axisA) next.axisA = axisVector(patch.axisA);
  if (patch.axisB) next.axisB = axisVector(patch.axisB);
  if (patch.ratio != null && Number.isFinite(Number(patch.ratio)) && Math.abs(Number(patch.ratio)) >= 0.01) {
    next.ratio = Number(patch.ratio);
  }
  for (const key of ['torqueCapacity', 'stiffness', 'damping', 'efficiency']) {
    if (patch[key] != null && Number.isFinite(Number(patch[key]))) next[key] = Number(patch[key]);
  }
  return next;
}

function patchDevice(document, device, patch) {
  const next = withMechanicEditorPatch({ ...device }, patch);
  if (patch.label != null) next.label = patch.label;
  // An empty string empties the socket; the plate and its gate keep working.
  if (patch.spellTemplate !== undefined) {
    next.spell = mountedSpellSnapshot(patch.spellTemplate);
    next.spellTemplateId = patch.spellTemplate?.id ?? null;
  } else if (patch.spellTemplateId !== undefined) {
    next.spellTemplateId = patch.spellTemplateId || null;
    // Legacy preset selections have no native snapshot; emptying always clears both.
    if (!next.spellTemplateId) next.spell = null;
  }
  if (patch.forceScale != null && Number.isFinite(Number(patch.forceScale))) {
    next.forceScale = Number(patch.forceScale);
  }
  if (patch.plateRadius != null && Number.isFinite(Number(patch.plateRadius))) {
    next.plateRadius = Math.max(0.08, Number(patch.plateRadius));
  }
  if (patch.localFrame) {
    next.localFrame = {
      origin: { ...next.localFrame.origin, ...(patch.localFrame.origin ?? {}) },
      normal: normalizeVector({ ...next.localFrame.normal, ...(patch.localFrame.normal ?? {}) }),
      tangent: normalizeVector({ ...next.localFrame.tangent, ...(patch.localFrame.tangent ?? {}) }),
    };
  }
  if (patch.position) {
    next.localFrame = {
      ...next.localFrame,
      origin: { ...next.localFrame.origin, ...patch.position },
    };
  }
  if (patch.assemblyId && patch.assemblyId !== device.assemblyId) {
    const oldHost = document.assemblies.find((item) => item.assemblyId === device.assemblyId);
    const newHost = document.assemblies.find((item) => item.assemblyId === patch.assemblyId);
    if (oldHost && newHost) {
      const worldOrigin = transformPoint(oldHost.transform, device.localFrame.origin);
      const worldNormal = transformDirection(oldHost.transform, device.localFrame.normal);
      const worldTangent = transformDirection(oldHost.transform, device.localFrame.tangent);
      next.assemblyId = newHost.assemblyId;
      next.localFrame = {
        origin: inverseTransformPoint(newHost.transform, worldOrigin),
        normal: inverseTransformDirection(newHost.transform, worldNormal),
        tangent: inverseTransformDirection(newHost.transform, worldTangent),
      };
    }
  }
  if (patch.normal) {
    next.localFrame = {
      ...next.localFrame,
      normal: axisVector(patch.normal),
      tangent: tangentForAxis(patch.normal),
    };
  }
  return next;
}

function patchGate(gate, patch) {
  const next = withMechanicEditorPatch({ ...gate }, patch);
  if (patch.label != null) next.label = patch.label;
  if (patch.driverConstraintId) next.driverConstraintId = patch.driverConstraintId;
  for (const key of ['hysteresis', 'phaseOffsetRadians', 'lateralTolerance']) {
    if (patch[key] != null && Number.isFinite(Number(patch[key]))) next[key] = Number(patch[key]);
  }
  if (patch.closedRange) {
    next.closedRange = {
      min: Number(patch.closedRange.min ?? next.closedRange?.min ?? 0.43),
      max: Number(patch.closedRange.max ?? next.closedRange?.max ?? 0.57),
    };
  }
  if (patch.closedWindow) {
    const first = next.closedWindows?.[0] ?? { startRadians: -0.28, endRadians: 0.28 };
    next.closedWindows = [
      {
        startRadians: Number(patch.closedWindow.startRadians ?? first.startRadians),
        endRadians: Number(patch.closedWindow.endRadians ?? first.endRadians),
      },
      ...(next.closedWindows?.slice(1) ?? []),
    ];
  }
  return next;
}

function withMechanicEditorPatch(mechanic, patch) {
  if (!patch.editor) return mechanic;
  const requestedOpacity = Number(patch.editor.opacity ?? mechanic.editor?.opacity ?? 1);
  return {
    ...mechanic,
    editor: {
      opacity: Number.isFinite(requestedOpacity)
        ? Math.min(1, Math.max(0.05, requestedOpacity))
        : mechanic.editor?.opacity ?? 1,
      clickThrough: (patch.editor.clickThrough ?? mechanic.editor?.clickThrough) === true,
    },
  };
}

function meshRatioLabel(ratio) {
  const magnitude = Math.abs(Number(ratio) || 1);
  if (magnitude >= 1) {
    const rounded = Number.isInteger(magnitude) ? magnitude : Number(magnitude.toFixed(1));
    return `${rounded}:1`;
  }
  const inverse = 1 / Math.max(1e-6, magnitude);
  return `1:${Number.isInteger(inverse) ? inverse : Number(inverse.toFixed(1))}`;
}

function axisVector(axis) {
  if (axis === '-x') return { x: -1, y: 0, z: 0 };
  if (axis === 'y') return { x: 0, y: 1, z: 0 };
  if (axis === '-y') return { x: 0, y: -1, z: 0 };
  if (axis === 'z') return { x: 0, y: 0, z: 1 };
  if (axis === '-z') return { x: 0, y: 0, z: -1 };
  return { x: 1, y: 0, z: 0 };
}

function tangentForAxis(axis) {
  if (['x', '-x'].includes(axis)) return { x: 0, y: 0, z: 1 };
  return { x: 1, y: 0, z: 0 };
}

function mechanicsDocumentLoadError(error) {
  if (String(error).startsWith('unsupported_future_mechanics_schema_')) {
    const version = String(error).slice('unsupported_future_mechanics_schema_'.length);
    return `This mechanics document uses a newer schema (${version}). The current build was kept.`;
  }
  return 'That JSON is not a mechanics document. The current build was kept.';
}

function loadStoredDocument() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const migrated = migrateMechanicsDocument(parsed).document;
    if (!validateMechanicsDocument(migrated).ok) return null;
    return refreshStoredStarter(migrated);
  } catch {
    return null;
  }
}

function refreshStoredStarter(document) {
  if (isUntouchedLegacyPressurePlate(document)) {
    return mechanicsStarterDocument('pressure-plate');
  }

  const starterId = document.metadata?.starterId;
  const starter = MECHANICS_STARTERS.find((item) => item.starterId === starterId);
  if (!starter) return document;

  const storedVersion = Number(document.metadata?.starterVersion ?? 0);
  const untouched = Number(document.metadata?.revision ?? 0) === 0;
  return untouched && storedVersion < starter.starterVersion
    ? mechanicsStarterDocument(starterId)
    : document;
}

function isUntouchedLegacyPressurePlate(document) {
  if (document.metadata?.name !== 'Light pressure plate') return false;
  if (Number(document.metadata?.revision ?? 0) !== 0) return false;
  if (document.assemblies?.length !== 3) return false;

  const frame = document.assemblies.find((assembly) => assembly.assemblyId === 'assembly:pressure-frame');
  if (!frame || frame.parts?.length !== 5) return false;

  const expectedRails = {
    'part:frame-rail-left': { size: [0.22, 0.45, 2.05], position: [-1.48, 0.25, 0] },
    'part:frame-rail-right': { size: [0.22, 0.45, 2.05], position: [1.48, 0.25, 0] },
    'part:frame-rail-front': { size: [2.55, 0.45, 0.22], position: [0, 0.25, -1.12] },
    'part:frame-rail-back': { size: [2.55, 0.45, 0.22], position: [0, 0.25, 1.12] },
  };

  return Object.entries(expectedRails).every(([partId, expected]) => {
    const part = frame.parts.find((candidate) => candidate.partId === partId);
    return part
      && vectorMatches(part.size, expected.size)
      && vectorMatches(part.localTransform?.position, expected.position);
  });
}

function vectorMatches(vector, expected) {
  return ['x', 'y', 'z'].every((axis, index) => Number(vector?.[axis]) === expected[index]);
}

function loadBlueprints() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(BLUEPRINTS_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function nextBlueprintId(blueprints) {
  const base = `blueprint:${Date.now()}`;
  if (!blueprints.some((item) => item.blueprintId === base)) return base;
  let suffix = 2;
  while (blueprints.some((item) => item.blueprintId === `${base}:${suffix}`)) suffix += 1;
  return `${base}:${suffix}`;
}

function toolHint(tool) {
  if (tool === 'shape') return 'Choose a primitive. It appears on the field ready to move.';
  if (tool === 'glue') return 'Select two or more shapes, then glue them into one rigid object.';
  if (tool === 'joint') return 'Connect two assemblies with a hinge, slider, or fixed joint.';
  if (tool === 'spring') return 'Connect two assemblies with a linear or torsion spring.';
  if (tool === 'trigger') return 'Add a contact trigger or latch.';
  if (tool === 'cog')
    return 'Hover the field to place a cogwheel — near another cogwheel it snaps into mesh (hold Shift to skip). Click an assembly to mount it with an axle.';
  if (tool === 'gear') return 'Couple two rotating assemblies with an idealized ratio.';
  if (tool === 'spell') return 'Mount a compiled spell plate and choose its physical gate.';
  if (tool === 'hand') return 'Test hand — push selected objects and release latches.';
  return 'Select an assembly or mechanical relationship to inspect it.';
}
