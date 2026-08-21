import { create } from 'zustand';
import { compileSpell, decodeSpellShareLink } from '../../../src/compiler/index.js';
import {
  createDefaultSceneState,
  createSceneProp,
  createSceneSource,
  interpretCompiledSpell,
} from '../../../src/simulation-engine/index.js';
import { SAMPLE_SPELLS, prettyJson } from './samples.js';

const defaultScene = createDefaultSceneState();
const DEFAULT_ACTIVATION_DURATION_MS = 2000;
const DEFAULT_SPELL_RING_WORLD_RADIUS = 2.25;
const RING_KEY_SEATED_DISTANCE = 0.32;
const RING_KEY_INFLUENCE_DISTANCE = 1.2;
const DEFAULT_SPELL_PLACEMENT = {
  x: 0,
  y: 0,
  z: 0,
  surfaceMode: 'ground',
  surfaceTargetId: null,
};
const TIMELINE_STEP_MS = 250;
const PROP_SURFACE_FACE_GAP = 0.012;

export const ASSET_PACKS = [
  {
    packId: 'open-placeholder',
    packDisplayName: 'Open placeholder pack',
    packKind: 'placeholder',
    licenseNotice: 'Project-owned procedural shapes and labels; no bundled WHA artwork.',
    disclaimerRequired: false,
    available: true,
    fallbackPackId: null,
    version: '0.1.0',
  },
  {
    packId: 'wha-fan-fidelity',
    packDisplayName: 'WHA fan-fidelity pack',
    packKind: 'fan_wha_fidelity',
    licenseNotice: 'Not installed. Placeholders render instead; artwork would remain render-only.',
    disclaimerRequired: true,
    available: false,
    fallbackPackId: 'open-placeholder',
    version: 'planned',
  },
];

export const PROP_SURFACE_FACES = [
  {
    value: 'prop-east',
    label: 'Prop east face',
    faceLabel: 'east face',
    normal: { x: 1, y: 0, z: 0 },
    tangent: { x: 0, y: 0, z: 1 },
  },
  {
    value: 'prop-west',
    label: 'Prop west face',
    faceLabel: 'west face',
    normal: { x: -1, y: 0, z: 0 },
    tangent: { x: 0, y: 0, z: 1 },
  },
  {
    value: 'prop-north',
    label: 'Prop north face',
    faceLabel: 'north face',
    normal: { x: 0, y: 0, z: -1 },
    tangent: { x: 1, y: 0, z: 0 },
  },
  {
    value: 'prop-south',
    label: 'Prop south face',
    faceLabel: 'south face',
    normal: { x: 0, y: 0, z: 1 },
    tangent: { x: 1, y: 0, z: 0 },
  },
  {
    value: 'prop-top',
    label: 'Prop top face',
    faceLabel: 'top face',
    normal: { x: 0, y: 1, z: 0 },
    tangent: { x: 1, y: 0, z: 0 },
  },
];

function propSurfaceFaceForMode(surfaceMode) {
  return PROP_SURFACE_FACES.find((face) => face.value === surfaceMode) ?? null;
}

function isPropSurfaceMode(surfaceMode) {
  return propSurfaceFaceForMode(surfaceMode) != null;
}

function buildRuntime(
  compileResult,
  sources,
  props,
  activation,
  spellPlacement,
  crosshairMode,
  motionBaselines,
  effectLifecycle,
) {
  if (!compileResult) return null;
  return interpretCompiledSpell({
    graph: compileResult.graph,
    program: compileResult.program,
    diagnostics: compileResult.diagnostics,
    sceneState: { sources, props },
    options: {
      activation,
      placementFrame: placementFrameFromState(spellPlacement, props),
      crosshairMode: crosshairMode === 'auto' ? undefined : crosshairMode,
      motionBaselines,
      effectLifecycle,
    },
  });
}

function compileJson(
  jsonText,
  sources,
  props,
  activation,
  spellPlacement,
  crosshairMode,
  motionBaselines,
  effectLifecycle,
  importSource,
) {
  const input = JSON.parse(jsonText);
  const compileResult = compileSpell(input, compileImportOptions(importSource));
  return {
    compileResult,
    runtimeResult: buildRuntime(
      compileResult,
      sources,
      props,
      activation,
      spellPlacement,
      crosshairMode,
      motionBaselines,
      effectLifecycle,
    ),
  };
}

function compileImportOptions(importSource) {
  if (!importSource) return undefined;
  return {
    sourceKind: importSource.kind === 'share_link' ? 'share_link' : 'direct_json',
    sourceLabel: importSource.sourceLabel,
  };
}

function buildSpellInstance(compileResult, selectedSampleId, samples, importSource) {
  const sample = samples.find((item) => item.id === selectedSampleId);
  const program = compileResult?.program;
  const imported =
    importSource?.kind === 'local_json' ||
    importSource?.kind === 'pasted_json' ||
    importSource?.kind === 'share_link';
  const sourceDisplayLabel =
    importSource?.displayLabel ?? importSource?.sourceLabel ?? 'Imported source';
  return {
    id: 'spell-instance:primary',
    slot: 1,
    label: imported
      ? program?.title ?? importSource?.sourceLabel ?? 'Imported spell'
      : sample?.label ?? program?.title ?? 'Imported spell',
    sampleId: selectedSampleId,
    programId: program?.programId ?? program?.title ?? selectedSampleId,
    programTitle: imported
      ? sourceDisplayLabel
      : program?.title ?? sample?.label ?? 'Untitled spell',
    source: importSource?.kind ?? 'single_spell_import',
    futureMultipleInstancesReady: true,
  };
}

function sourceSpendKey(state, runtimeResult) {
  if (!runtimeResult?.lifecycle?.active) return null;
  const programId =
    state.compileResult?.program?.programId ??
    state.compileResult?.program?.title ??
    state.selectedSampleId;
  return `${state.activationInstanceId}:${programId}`;
}

function sourceSpendsFromRuntime(runtimeResult) {
  const spends = new Map();
  for (const acquisition of runtimeResult?.intents ?? []) {
    if (
      acquisition.intentType !== 'source_acquisition' ||
      acquisition.active !== true ||
      acquisition.sourceMode !== 'gather_active' ||
      acquisition.feedsDownstream !== true
    ) {
      continue;
    }
    for (const spend of acquisition.sourceSpends ?? []) {
      if (!spend.sourceId || spend.spendAmount <= 0) continue;
      spends.set(spend.sourceId, (spends.get(spend.sourceId) ?? 0) + spend.spendAmount);
    }
  }
  return spends;
}

function programKeyFromState(state) {
  return (
    state.compileResult?.program?.programId ??
    state.compileResult?.program?.title ??
    state.selectedSampleId
  );
}

function physicsMotionsFromRuntime(runtimeResult) {
  return (runtimeResult?.intents ?? []).filter(
    (intent) =>
      intent.intentType === 'physics_motion' &&
      intent.active === true &&
      intent.movesActualSceneObject === true &&
      intent.reservoirPreviewOnly !== true &&
      intent.sourceId &&
      (intent.currentObjectPosition || intent.toPosition),
  );
}

function activeEffectLifecycleIds(runtimeResult) {
  return (runtimeResult?.intents ?? [])
    .filter(
      (intent) =>
        intent.intentType === 'effect_lifecycle' &&
        (intent.operation === 'start' || intent.operation === 'update') &&
        intent.sourceIntentId,
    )
    .map((intent) => intent.sourceIntentId);
}

function activationRingGapPositionFromState(state) {
  return {
    x: Number(state.spellPlacement?.x ?? 0),
    y: 0,
    z: Number(state.spellPlacement?.z ?? 0) - DEFAULT_SPELL_RING_WORLD_RADIUS,
  };
}

function activationRingMechanicalCompleterFromState(state) {
  const key = state.props.find((prop) => prop.targetRole === 'activation_ring_mechanical_key');
  const gapPosition = activationRingGapPositionFromState(state);
  if (!key) {
    return {
      id: 'activation-ring-key:missing',
      role: 'activation_ring_mechanical_key',
      completion: 0,
      distanceToGap: null,
      gapPosition,
      keyPosition: null,
      completionPolicy: 'distance_to_outer_ring_gap',
    };
  }
  const keyPosition = {
    x: Number(key.position?.x ?? 0),
    y: Number(key.position?.y ?? 0),
    z: Number(key.position?.z ?? 0),
  };
  const distance = Math.hypot(
    keyPosition.x - gapPosition.x,
    keyPosition.z - gapPosition.z,
  );
  const completion =
    distance <= RING_KEY_SEATED_DISTANCE
      ? 1
      : distance >= RING_KEY_INFLUENCE_DISTANCE
        ? 0
        : 1 - (distance - RING_KEY_SEATED_DISTANCE) /
          (RING_KEY_INFLUENCE_DISTANCE - RING_KEY_SEATED_DISTANCE);
  return {
    id: 'activation-ring-key',
    propId: key.id,
    role: 'activation_ring_mechanical_key',
    completion: roundPosition(completion),
    distanceToGap: roundPosition(distance),
    keyPosition,
    gapPosition,
    completionPolicy: 'distance_to_outer_ring_gap',
  };
}

function physicsMotionCompletionTargets(runtimeResult) {
  return new Map(
    physicsMotionsFromRuntime(runtimeResult)
      .filter((motion) => motion.toPosition)
      .map((motion) => [
        motion.sourceId,
        {
          x: Number(motion.toPosition.x ?? 0),
          y: Number(motion.toPosition.y ?? 0),
          z: Number(motion.toPosition.z ?? 0),
        },
      ]),
  );
}

function applyPropPositionTargets(props, targets) {
  if (!targets || targets.size === 0) return props;
  return props.map((prop) =>
    targets.has(prop.id)
      ? {
          ...prop,
          position: targets.get(prop.id),
        }
      : prop,
  );
}

function physicsMotionKey(state, motion) {
  return `${state.activationInstanceId}:${programKeyFromState(state)}:${motion.id}`;
}

function interpolatePosition(from, to, progress) {
  const clamped = Math.min(1, Math.max(0, Number(progress ?? 0)));
  return {
    x: roundPosition(Number(from?.x ?? 0) + (Number(to?.x ?? 0) - Number(from?.x ?? 0)) * clamped),
    y: roundPosition(Number(from?.y ?? 0) + (Number(to?.y ?? 0) - Number(from?.y ?? 0)) * clamped),
    z: roundPosition(Number(from?.z ?? 0) + (Number(to?.z ?? 0) - Number(from?.z ?? 0)) * clamped),
  };
}

function roundPosition(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function restorePropsToMotionBaselines(state) {
  const prefix = `${state.activationInstanceId}:${programKeyFromState(state)}:`;
  return state.props.map((prop) => {
    const baselineEntry = Object.entries(state.physicsMotionBaselines).find(
      ([key]) => key.startsWith(prefix) && key.endsWith(`:${prop.id}`),
    );
    if (!baselineEntry) return prop;
    const [, position] = baselineEntry;
    return {
      ...prop,
      position: {
        x: Number(position.x ?? 0),
        y: Number(position.y ?? 0),
        z: Number(position.z ?? 0),
      },
    };
  });
}

function leftoverRecordsFromRuntime(state, runtimeResult) {
  const programId = programKeyFromState(state);
  return (runtimeResult?.intents ?? [])
    .filter((intent) => intent.intentType === 'lifecycle_cleanup' && intent.active)
    .map((cleanup) => ({
      ...cleanup,
      id: `${cleanup.id}:activation-${state.activationInstanceId}`,
      sourceCleanupId: cleanup.id,
      activationInstanceId: state.activationInstanceId,
      programId,
      persistent: true,
    }));
}

function mergeLeftovers(existing, next) {
  if (next.length === 0) return existing;
  const byId = new Map(existing.map((leftover) => [leftover.id, leftover]));
  for (const leftover of next) {
    byId.set(leftover.id, leftover);
  }
  return [...byId.values()];
}

function activationOptionsFromState(state) {
  const elapsedMs =
    state.spellActive && !state.timelinePaused && state.activationStartedAt
      ? Date.now() - state.activationStartedAt
      : state.activationElapsedMs ?? 0;
  const mechanicalCompleter = activationRingMechanicalCompleterFromState(state);
  const manualCompletion = Number(state.outerRingCompletion ?? 0);
  return {
    active: state.spellActive,
    mode: state.activationMode,
    elapsedMs,
    durationMs: state.activationDurationMs,
    enforceOuterRing: state.enforceOuterRing,
    outerRingClosed: state.outerRingClosed,
    outerRingCompletion: state.enforceOuterRing
      ? undefined
      : Math.max(manualCompletion, mechanicalCompleter.completion),
    mechanicalCompleters: state.enforceOuterRing ? [] : [mechanicalCompleter],
  };
}

function placementFrameFromState(spellPlacement = DEFAULT_SPELL_PLACEMENT, props = []) {
  const face = propSurfaceFaceForMode(spellPlacement.surfaceMode);
  if (face) {
    const target = props.find((prop) => prop.id === spellPlacement.surfaceTargetId) ?? props[0];
    if (target) {
      const size = Math.max(0.3, target.size ?? 1) * 0.45;
      const halfSize = size / 2;
      const center = {
        x: target.position?.x ?? 0,
        y: 0.25,
        z: target.position?.z ?? 0,
      };
      const offset = halfSize + PROP_SURFACE_FACE_GAP;
      return {
        origin: {
          x: roundPosition(center.x + face.normal.x * offset),
          y: roundPosition(center.y + face.normal.y * offset),
          z: roundPosition(center.z + face.normal.z * offset),
        },
        normal: { ...face.normal },
        tangent: { ...face.tangent },
        placementMode: 'prop_surface',
        surfaceMode: spellPlacement.surfaceMode,
        surfaceTargetId: target.id,
        surfaceLabel: `${target.label ?? target.id} ${face.faceLabel}`,
      };
    }
  }
  return {
    origin: {
      x: spellPlacement.x ?? 0,
      y: spellPlacement.y ?? 0,
      z: spellPlacement.z ?? 0,
    },
    normal: { x: 0, y: 1, z: 0 },
    tangent: { x: 1, y: 0, z: 0 },
    placementMode: 'ground_plane',
    surfaceMode: 'ground',
    surfaceTargetId: null,
    surfaceLabel: 'ground',
  };
}

export const useSpellStore = create((set, get) => ({
  samples: SAMPLE_SPELLS,
  selectedSampleId: SAMPLE_SPELLS[0].id,
  jsonText: prettyJson(SAMPLE_SPELLS[0].fixture),
  compileResult: null,
  runtimeResult: null,
  importSource: null,
  spellInstances: [],
  selectedSpellInstanceId: 'spell-instance:primary',
  compileError: null,
  debugOpen: false,
  selectedDebugId: null,
  sources: defaultScene.sources,
  props: defaultScene.props,
  sceneLeftovers: [],
  nextSourceIndex: 1,
  nextPropIndex: 1,
  spellActive: true,
  activationMode: 'timed',
  activationInstanceId: 1,
  activationStartedAt: Date.now(),
  activationElapsedMs: 0,
  activationDurationMs: DEFAULT_ACTIVATION_DURATION_MS,
  timelinePaused: false,
  lastSourceSpendKey: null,
  physicsMotionBaselines: {},
  effectLifecycleActiveIds: [],
  effectLifecycleElapsedMs: 0,
  enforceOuterRing: false,
  outerRingClosed: true,
  outerRingCompletion: 1,
  environmentMode: 'day',
  weatherMode: 'clear',
  spellPlacement: { ...DEFAULT_SPELL_PLACEMENT },
  crosshairMode: 'auto',
  selectedAssetPackId: ASSET_PACKS[0].packId,

  selectSample(sampleId) {
    const sample = SAMPLE_SPELLS.find((item) => item.id === sampleId);
    if (!sample) return;
    set({
      selectedSampleId: sampleId,
      jsonText: prettyJson(sample.fixture),
      importSource: null,
      compileError: null,
    });
  },

  setJsonText(jsonText) {
    set({
      jsonText,
      importSource: { kind: 'pasted_json', sourceLabel: 'Edited JSON' },
    });
  },

  importLocalJson(jsonText, sourceLabel) {
    set({
      jsonText,
      importSource: { kind: 'local_json', sourceLabel, displayLabel: sourceLabel },
      compileError: null,
    });
  },

  importShareLink(shareLink) {
    const decoded = decodeSpellShareLink(shareLink);
    if (!decoded.ok) return decoded;
    set({
      jsonText: prettyJson(decoded.payload),
      importSource: {
        kind: 'share_link',
        sourceLabel: decoded.sourceLabel,
        displayLabel: 'Share link',
        encoding: decoded.encoding,
      },
      compileError: null,
    });
    return decoded;
  },

  setSelectedAssetPack(assetPackId) {
    if (!ASSET_PACKS.some((pack) => pack.packId === assetPackId)) return;
    set({ selectedAssetPackId: assetPackId });
  },

  compileCurrent() {
    const state = get();
    const {
      jsonText,
      sources,
      props,
      spellPlacement,
      crosshairMode,
      physicsMotionBaselines,
    } = state;
    try {
      const next = compileJson(
        jsonText,
        sources,
        props,
        activationOptionsFromState(state),
        spellPlacement,
        crosshairMode,
        physicsMotionBaselines,
        { activeEffectIds: [], deltaMs: 0 },
        state.importSource,
      );
      set({
        ...next,
        spellInstances: [
          buildSpellInstance(
            next.compileResult,
            state.selectedSampleId,
            state.samples,
            state.importSource,
          ),
        ],
        selectedSpellInstanceId: 'spell-instance:primary',
        sceneLeftovers: mergeLeftovers(
          state.sceneLeftovers,
          leftoverRecordsFromRuntime(state, next.runtimeResult),
        ),
        compileError: null,
        effectLifecycleActiveIds: activeEffectLifecycleIds(next.runtimeResult),
        effectLifecycleElapsedMs: 0,
      });
      get().applyRuntimeSourceSpends();
      get().applyRuntimePhysicsMotions();
    } catch (error) {
      set({
        compileError: error instanceof Error ? error.message : String(error),
        compileResult: null,
      runtimeResult: null,
      spellInstances: [],
      effectLifecycleActiveIds: [],
      effectLifecycleElapsedMs: 0,
    });
  }
},

  addSource(kind) {
    const index = get().nextSourceIndex;
    const source = createSceneSource({
      id: `source:${kind}:${index}`,
      kind,
      label: `${kind[0].toUpperCase()}${kind.slice(1)} source ${index}`,
      position: {
        x: -2 + index * 0.7,
        y: 0,
        z: kind === 'fire' ? -1.8 : kind === 'earth' ? 1.8 : 0.7,
      },
    });
    set((state) => ({
      sources: [...state.sources, source],
      nextSourceIndex: index + 1,
    }));
    get().refreshRuntime();
  },

  addProp() {
    const index = get().nextPropIndex;
    const prop = createSceneProp({
      id: `prop:${index}`,
      label: `Practice prop ${index}`,
      position: { x: 1.6 + index * 0.5, y: 0, z: -1.1 },
    });
    set((state) => ({
      props: [...state.props, prop],
      nextPropIndex: index + 1,
    }));
    get().refreshRuntime();
  },

  updateSource(sourceId, patch) {
    set((state) => ({
      sources: state.sources.map((source) =>
        source.id === sourceId ? { ...source, ...patch } : source,
      ),
    }));
    get().refreshRuntime();
  },

  updateSourcePosition(sourceId, position) {
    get().updateSource(sourceId, { position });
  },

  removeSource(sourceId) {
    set((state) => ({
      sources: state.sources.filter((source) => source.id !== sourceId),
    }));
    get().refreshRuntime();
  },

  updatePropPosition(propId, position) {
    set((state) => ({
      props: state.props.map((prop) =>
        prop.id === propId ? { ...prop, position } : prop,
      ),
    }));
    get().refreshRuntime();
  },

  removeProp(propId) {
    set((state) => ({
      props: state.props.filter((prop) => prop.id !== propId),
      spellPlacement:
        state.spellPlacement.surfaceTargetId === propId
          ? {
              ...state.spellPlacement,
              surfaceMode: state.props.some((prop) => prop.id !== propId)
                ? state.spellPlacement.surfaceMode
                : 'ground',
              surfaceTargetId:
                state.props.find((prop) => prop.id !== propId)?.id ?? null,
            }
          : state.spellPlacement,
    }));
    get().refreshRuntime();
  },

  refreshRuntime({ skipSourceSpends = false } = {}) {
    const state = get();
    const {
      compileResult,
      sources,
      props,
      spellPlacement,
      crosshairMode,
      physicsMotionBaselines,
      effectLifecycleActiveIds,
    } = state;
    if (!compileResult) return;
    const activation = activationOptionsFromState(state);
    const deltaMs = Math.max(0, activation.elapsedMs - (state.effectLifecycleElapsedMs ?? 0));
    const runtimeResult = buildRuntime(
      compileResult,
      sources,
      props,
      activation,
      spellPlacement,
      crosshairMode,
      physicsMotionBaselines,
      { activeEffectIds: effectLifecycleActiveIds, deltaMs },
    );
    const nextLeftovers = leftoverRecordsFromRuntime(state, runtimeResult);
    const timedEnded = activation.mode === 'timed' && activation.elapsedMs >= activation.durationMs;
    const nextProps = timedEnded
      ? applyPropPositionTargets(
          state.props,
          physicsMotionCompletionTargets(state.runtimeResult),
        )
      : state.props;
    set({
      runtimeResult,
      sceneLeftovers: mergeLeftovers(state.sceneLeftovers, nextLeftovers),
      activationElapsedMs: activation.elapsedMs,
      props: nextProps,
      spellActive: timedEnded ? false : state.spellActive,
      effectLifecycleActiveIds: timedEnded ? [] : activeEffectLifecycleIds(runtimeResult),
      effectLifecycleElapsedMs: activation.elapsedMs,
    });
    if (!skipSourceSpends) {
      get().applyRuntimeSourceSpends();
    }
    get().applyRuntimePhysicsMotions();
  },

  applyRuntimeSourceSpends() {
    const state = get();
    const spendKey = sourceSpendKey(state, state.runtimeResult);
    const spends = sourceSpendsFromRuntime(state.runtimeResult);
    if (!spendKey || spends.size === 0 || spendKey === state.lastSourceSpendKey) return;

    set((current) => ({
      lastSourceSpendKey: spendKey,
      sources: current.sources.map((source) => {
        const spendAmount = spends.get(source.id) ?? 0;
        if (spendAmount <= 0 || source.nonDepleting) return source;
        const currentAmount = Number(source.amount ?? 0);
        return {
          ...source,
          amount: Math.max(0, Number((currentAmount - spendAmount).toFixed(3))),
        };
      }),
    }));
    get().refreshRuntime({ skipSourceSpends: true });
  },

  applyRuntimePhysicsMotions() {
    const state = get();
    const motions = physicsMotionsFromRuntime(state.runtimeResult);
    if (motions.length === 0) return;

    const propById = new Map(state.props.map((prop) => [prop.id, prop]));
    const applicable = motions.filter((motion) => propById.has(motion.sourceId));
    if (applicable.length === 0) return;

    const nextBaselines = { ...state.physicsMotionBaselines };
    const targetByPropId = new Map(
      applicable.map((motion) => {
        const key = physicsMotionKey(state, motion);
        const prop = propById.get(motion.sourceId);
        if (!nextBaselines[key]) {
          nextBaselines[key] = {
            x: Number(prop?.position?.x ?? 0),
            y: Number(prop?.position?.y ?? 0),
            z: Number(prop?.position?.z ?? 0),
          };
        }
        const position = interpolatePosition(
          nextBaselines[key],
          motion.toPosition ?? motion.currentObjectPosition,
          motion.motionProgress,
        );
        return [
          motion.sourceId,
          position,
        ];
      }),
    );

    set((current) => ({
      physicsMotionBaselines: nextBaselines,
      props: current.props.map((prop) =>
        targetByPropId.has(prop.id)
          ? {
              ...prop,
              position: targetByPropId.get(prop.id),
            }
          : prop,
      ),
    }));
  },

  activateSpell(mode = get().activationMode) {
    set((state) => ({
      spellActive: true,
      activationMode: mode,
      activationInstanceId: state.activationInstanceId + 1,
      activationStartedAt: Date.now(),
      activationElapsedMs: 0,
      timelinePaused: false,
      lastSourceSpendKey: null,
      effectLifecycleActiveIds: [],
      effectLifecycleElapsedMs: 0,
    }));
    get().refreshRuntime();
  },

  deactivateSpell() {
    set({
      spellActive: false,
      activationElapsedMs: 0,
      activationStartedAt: null,
      timelinePaused: false,
    });
    get().refreshRuntime();
  },

  pauseTimeline() {
    const activation = activationOptionsFromState(get());
    set({
      timelinePaused: true,
      activationElapsedMs: activation.elapsedMs,
      activationStartedAt: null,
    });
    get().refreshRuntime();
  },

  resumeTimeline() {
    const state = get();
    const activation = activationOptionsFromState(state);
    const shouldRestart =
      activation.mode === 'timed' && activation.elapsedMs >= activation.durationMs;
    const elapsedMs = shouldRestart ? 0 : activation.elapsedMs;
    set({
      spellActive: true,
      timelinePaused: false,
      activationElapsedMs: elapsedMs,
      activationStartedAt: Date.now() - elapsedMs,
    });
    get().refreshRuntime();
  },

  stepTimeline(stepMs = TIMELINE_STEP_MS) {
    const activation = activationOptionsFromState(get());
    const elapsedMs =
      activation.mode === 'timed'
        ? Math.min(activation.durationMs, activation.elapsedMs + stepMs)
        : Math.max(0, activation.elapsedMs + stepMs);
    set({
      spellActive: true,
      timelinePaused: true,
      activationElapsedMs: elapsedMs,
      activationStartedAt: null,
    });
    get().refreshRuntime();
  },

  resetTimeline() {
    set((state) => ({
      spellActive: true,
      timelinePaused: true,
      activationStartedAt: null,
      activationElapsedMs: 0,
      effectLifecycleActiveIds: [],
      effectLifecycleElapsedMs: 0,
      props: restorePropsToMotionBaselines(state),
    }));
    get().refreshRuntime();
  },

  setActivationMode(activationMode) {
    set({ activationMode });
    if (activationMode === 'timed') {
      get().activateSpell('timed');
    } else {
      get().refreshRuntime();
    }
  },

  setEnforceOuterRing(enforceOuterRing) {
    set({ enforceOuterRing });
    get().refreshRuntime();
  },

  setOuterRingClosed(outerRingClosed) {
    set({
      outerRingClosed,
      outerRingCompletion: outerRingClosed ? 1 : 0,
    });
    get().refreshRuntime();
  },

  setOuterRingCompletion(outerRingCompletion) {
    const completion = Math.min(1, Math.max(0, Number(outerRingCompletion ?? 0)));
    set({
      outerRingCompletion: completion,
      outerRingClosed: completion >= 1,
    });
    get().refreshRuntime();
  },

  seatActivationKey() {
    const gapPosition = activationRingGapPositionFromState(get());
    set((state) => ({
      outerRingCompletion: 0,
      outerRingClosed: false,
      props: state.props.map((prop) =>
        prop.targetRole === 'activation_ring_mechanical_key'
          ? {
              ...prop,
              position: { ...gapPosition },
            }
          : prop,
      ),
    }));
    get().refreshRuntime();
  },

  pullActivationKeyBack() {
    const gapPosition = activationRingGapPositionFromState(get());
    set((state) => ({
      outerRingCompletion: 0,
      outerRingClosed: false,
      props: state.props.map((prop) =>
        prop.targetRole === 'activation_ring_mechanical_key'
          ? {
              ...prop,
              position: {
                x: roundPosition(gapPosition.x - 1.55),
                y: 0,
                z: roundPosition(gapPosition.z - 0.1),
              },
            }
          : prop,
      ),
    }));
    get().refreshRuntime();
  },

  setEnvironmentMode(environmentMode) {
    set({ environmentMode });
  },

  setWeatherMode(weatherMode) {
    set({ weatherMode });
  },

  setSpellPlacement(position) {
    set((state) => ({
      spellPlacement: {
        ...state.spellPlacement,
        x: Number(position.x ?? 0),
        y: Number(position.y ?? 0),
        z: Number(position.z ?? 0),
      },
    }));
    get().refreshRuntime();
  },

  moveSpellPlacement(delta) {
    const current = get().spellPlacement;
    get().setSpellPlacement({
      x: current.x + delta.x,
      z: current.z + delta.z,
    });
  },

  resetSpellPlacement() {
    set({ spellPlacement: { ...DEFAULT_SPELL_PLACEMENT } });
    get().refreshRuntime();
  },

  setPlacementSurface(surfaceMode) {
    const props = get().props;
    const face = propSurfaceFaceForMode(surfaceMode);
    const currentTargetId = get().spellPlacement.surfaceTargetId;
    const targetId =
      props.some((prop) => prop.id === currentTargetId) ? currentTargetId : props[0]?.id ?? null;
    set((state) => ({
      spellPlacement: {
        ...state.spellPlacement,
        surfaceMode: face ? face.value : 'ground',
        surfaceTargetId: face ? targetId : null,
      },
    }));
    get().refreshRuntime();
  },

  setPlacementTarget(surfaceTargetId) {
    const props = get().props;
    const target = props.find((prop) => prop.id === surfaceTargetId);
    if (!target) return;
    set((state) => ({
      spellPlacement: {
        ...state.spellPlacement,
        surfaceMode: isPropSurfaceMode(state.spellPlacement.surfaceMode)
          ? state.spellPlacement.surfaceMode
          : 'prop-east',
        surfaceTargetId: target.id,
      },
    }));
    get().refreshRuntime();
  },

  setCrosshairMode(crosshairMode) {
    set({ crosshairMode });
    get().refreshRuntime();
  },

  setDebugOpen(debugOpen) {
    set({ debugOpen });
  },

  selectDebugItem(selectedDebugId) {
    set({ selectedDebugId });
  },
}));
