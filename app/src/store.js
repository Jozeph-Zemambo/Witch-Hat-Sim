import { create } from 'zustand';
import { compileSpell, decodeSpellShareLink } from '../../src/compiler/index.js';
import {
  createDefaultSceneState,
  createSceneProp,
  createSceneSource,
  interpretCompiledSpell,
} from '../../src/simulation-engine/index.js';
import { SAMPLE_SPELLS, prettyJson } from './samples.js';
import {
  createAuthoredSpellTemplate,
  updateAuthoredSpellTemplate,
} from './spell-maker/templatePersistence.js';
import { assetDefinitionForId } from './assets/assetCatalog.js';
import {
  mergePlacementTransform,
  normalizePlacementTransform,
  validatePlacementTransformPatch,
} from './mechanics/placementTransforms.js';
import {
  multiplyQuaternion,
  quaternionBetweenVectors,
  quaternionFromAxisAngle,
  rotateVector as mechanicsRotateVector,
} from '../../src/mechanics-engine/index.js';
import {
  ATELIER_PLAYTHROUGH,
  mainWorldPropCenterOffset,
} from './world-physics/force-contract.js';
import { mountedSpellSnapshot } from './mechanics/spell-device-system.js';

const defaultScene = createDefaultSceneState();
const DEFAULT_ACTIVATION_DURATION_MS = 5000;
const MIN_PLACED_SPELL_DURATION_MS = 250;
const MAX_PLACED_SPELL_DURATION_MS = 300_000;
export const DEFAULT_PLACED_SPELL_SCALE = 0.2;
export const MIN_PLACED_SPELL_SCALE = DEFAULT_PLACED_SPELL_SCALE;
const MAX_PLACED_SPELL_SCALE = 4;
const MAX_PLACED_SPELL_TILT_DEG = 85;
const DEFAULT_SPELL_RING_WORLD_RADIUS = 2.25;
const RING_KEY_SEATED_DISTANCE = 0.32;
const RING_KEY_INFLUENCE_DISTANCE = 1.2;
const CAMERA_MODES = new Set(['fp', 'tp', 'fc']);
const DEFAULT_SPELL_PLACEMENT = {
  x: 0,
  y: 0,
  z: 0,
  surfaceMode: 'ground',
  surfaceTargetId: null,
};
const TIMELINE_STEP_MS = 250;
const WORLD_HISTORY_LIMIT = 60;
const PROP_SURFACE_FACE_GAP = 0.012;
const DEFAULT_PLAYER_STATE = {
  position: { ...ATELIER_PLAYTHROUGH.spawn.world },
  facing: ATELIER_PLAYTHROUGH.spawn.facing,
  pitch: ATELIER_PLAYTHROUGH.spawn.pitch,
  cameraMode: ATELIER_PLAYTHROUGH.spawn.cameraMode,
};

function normalizeCameraMode(cameraMode) {
  if (cameraMode === 'fps') return 'fp';
  if (cameraMode === 'orbit') return 'tp';
  return CAMERA_MODES.has(cameraMode) ? cameraMode : 'fp';
}

const PLACED_ASSETS_STORAGE_KEY = 'wha-placed-assets-v1';
const PLACED_MECHANICS_STORAGE_KEY = 'wha-placed-mechanics-builds-v1';

export const PLACEMENT_KINDS = Object.freeze({
  SPELL: 'spell',
  ASSET: 'asset',
  MECHANICS_BUILD: 'mechanics-build',
  PROP: 'prop',
});

const PLACEMENT_KIND_ALIASES = Object.freeze({
  spell: PLACEMENT_KINDS.SPELL,
  spellpad: PLACEMENT_KINDS.SPELL,
  'placed-spell': PLACEMENT_KINDS.SPELL,
  asset: PLACEMENT_KINDS.ASSET,
  'placed-asset': PLACEMENT_KINDS.ASSET,
  'asset-placement': PLACEMENT_KINDS.ASSET,
  'asset-manager': PLACEMENT_KINDS.ASSET,
  'mechanics-build': PLACEMENT_KINDS.MECHANICS_BUILD,
  mechanics: PLACEMENT_KINDS.MECHANICS_BUILD,
  blueprint: PLACEMENT_KINDS.MECHANICS_BUILD,
  'placed-mechanics': PLACEMENT_KINDS.MECHANICS_BUILD,
  'mechanics-library': PLACEMENT_KINDS.MECHANICS_BUILD,
  prop: PLACEMENT_KINDS.PROP,
  'scene-prop': PLACEMENT_KINDS.PROP,
  'practice-cube': PLACEMENT_KINDS.PROP,
});

function normalizePlacementKind(kind) {
  return PLACEMENT_KIND_ALIASES[String(kind ?? '').toLowerCase()] ?? null;
}

function isUniformPlacementTransform(transform) {
  return Boolean(
    transform &&
    transform.position &&
    transform.rotation &&
    (typeof transform.scale === 'number' || transform.scale),
  );
}

function legacySpellPlacementTransform(spell) {
  const scale = Number(spell.transform?.scale ?? DEFAULT_PLACED_SPELL_SCALE);
  return normalizePlacementTransform({
    position: spell.placementTransform?.position ?? spell.anchor?.point,
    rotation: spell.placementTransform?.rotation,
    scale: Number.isFinite(scale) ? scale : DEFAULT_PLACED_SPELL_SCALE,
  });
}

function initialSpellPlacementTransform(anchor) {
  const normal = normalizeVector(anchor?.normal, { x: 0, y: 1, z: 0 });
  const normalRotation = quaternionBetweenVectors({ x: 0, y: 1, z: 0 }, normal);
  const provisionalTangent = orthogonalTangent(
    normal,
    mechanicsRotateVector({ x: 1, y: 0, z: 0 }, normalRotation),
  );
  const tangent = orthogonalTangent(normal, anchor?.tangent);
  const roll = Math.atan2(
    dotVector(normal, crossVector(provisionalTangent, tangent)),
    dotVector(provisionalTangent, tangent),
  );
  const rotation = multiplyQuaternion(
    quaternionFromAxisAngle(normal, roll),
    normalRotation,
  );
  return normalizePlacementTransform({
    position: addVector(anchor?.point ?? { x: 0, y: 0, z: 0 }, scaleVector(normal, 0.018)),
    rotation,
    scale: DEFAULT_PLACED_SPELL_SCALE,
  });
}

function eulerDegreesFromQuaternion(rotation = {}) {
  const normalized = normalizePlacementTransform({ rotation }).rotation;
  const { x, y, z, w } = normalized;
  const sinrCosp = 2 * (w * x + y * z);
  const cosrCosp = 1 - 2 * (x * x + y * y);
  const sinp = 2 * (w * y - z * x);
  const sinyCosp = 2 * (w * z + x * y);
  const cosyCosp = 1 - 2 * (y * y + z * z);
  return {
    x: (Math.atan2(sinrCosp, cosrCosp) * 180) / Math.PI,
    y: (Math.asin(Math.max(-1, Math.min(1, sinp))) * 180) / Math.PI,
    z: (Math.atan2(sinyCosp, cosyCosp) * 180) / Math.PI,
  };
}

function recordTransformForKind(record, kind) {
  if (kind === PLACEMENT_KINDS.PROP) {
    const centerOffset = mainWorldPropCenterOffset(record);
    return normalizePlacementTransform({
      position: addVector(record.position, { x: 0, y: centerOffset, z: 0 }),
      rotation: record.rotation,
      scale: record.scale,
    });
  }
  if (kind === PLACEMENT_KINDS.SPELL && !isUniformPlacementTransform(record.transform)) {
    return record.placementTransform ?? legacySpellPlacementTransform(record);
  }
  return normalizePlacementTransform(record.transform);
}

function applyTransformToRecord(record, kind, transform, patch) {
  if (kind === PLACEMENT_KINDS.PROP) {
    const centerOffset = mainWorldPropCenterOffset(record);
    return {
      ...record,
      position: {
        x: transform.position.x,
        y: transform.position.y - centerOffset,
        z: transform.position.z,
      },
      rotation: transform.rotation,
      scale: transform.scale,
    };
  }
  if (kind !== PLACEMENT_KINDS.SPELL || isUniformPlacementTransform(record.transform)) {
    return {
      ...record,
      transform,
    };
  }

  // The current Spellpad renderer still consumes pitch/yaw degrees. Keep that
  // legacy field in sync while exposing a canonical transform for the wrench
  // and for the next renderer migration.
  const legacyTransform = { ...record.transform };
  const scale = (transform.scale.x + transform.scale.y + transform.scale.z) / 3;
  if (patch.scale != null) legacyTransform.scale = scale;
  if (patch.rotation) {
    const euler = eulerDegreesFromQuaternion(transform.rotation);
    legacyTransform.pitchDeg = clampNumber(
      euler.x,
      -MAX_PLACED_SPELL_TILT_DEG,
      MAX_PLACED_SPELL_TILT_DEG,
      Number(record.transform.pitchDeg ?? 0),
    );
    legacyTransform.yawDeg = clampNumber(
      euler.y,
      -MAX_PLACED_SPELL_TILT_DEG,
      MAX_PLACED_SPELL_TILT_DEG,
      Number(record.transform.yawDeg ?? 0),
    );
  }
  return {
    ...record,
    placementTransform: transform,
    transform: legacyTransform,
  };
}

function loadStoredArray(key) {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function nextPlacementIndex(records, prefix) {
  return Math.max(
    1,
    ...(records ?? []).map((record) => {
      const match = String(record?.id ?? '').match(new RegExp(`^${prefix}:(\\d+)$`));
      return match ? Number(match[1]) + 1 : 1;
    }),
  );
}

const STORED_PLACED_ASSETS = loadStoredArray(PLACED_ASSETS_STORAGE_KEY);
const STORED_PLACED_MECHANICS = loadStoredArray(PLACED_MECHANICS_STORAGE_KEY);

function worldEditSnapshot(state) {
  return {
    props: state.props,
    placedSpells: state.placedSpells,
    placedAssets: state.placedAssets,
    placedMechanicsBuilds: state.placedMechanicsBuilds,
    selectedPlacedSpellId: state.selectedPlacedSpellId,
    nextPlacedSpellIndex: state.nextPlacedSpellIndex,
    nextPlacedAssetIndex: state.nextPlacedAssetIndex,
    nextPlacedMechanicsBuildIndex: state.nextPlacedMechanicsBuildIndex,
  };
}

function pushWorldHistory(history, snapshot) {
  return [...history, snapshot].slice(-WORLD_HISTORY_LIMIT);
}

function worldEditChanged(snapshot, state) {
  return snapshot.props !== state.props
    || snapshot.placedSpells !== state.placedSpells
    || snapshot.placedAssets !== state.placedAssets
    || snapshot.placedMechanicsBuilds !== state.placedMechanicsBuilds
    || snapshot.selectedPlacedSpellId !== state.selectedPlacedSpellId
    || snapshot.nextPlacedSpellIndex !== state.nextPlacedSpellIndex
    || snapshot.nextPlacedAssetIndex !== state.nextPlacedAssetIndex
    || snapshot.nextPlacedMechanicsBuildIndex !== state.nextPlacedMechanicsBuildIndex;
}

function withWorldHistory(state, patch) {
  if (state.worldEditTransaction) return patch;
  return {
    ...patch,
    worldHistoryPast: pushWorldHistory(state.worldHistoryPast, worldEditSnapshot(state)),
    worldHistoryFuture: [],
  };
}

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

function placementExtentForDefinition(definition, normal = { x: 0, y: 1, z: 0 }) {
  const size = definition?.size ?? { x: 0.8, y: 0.5, z: 0.8 };
  return (
    Math.abs(Number(normal.x ?? 0)) * Number(size.x ?? 0) +
    Math.abs(Number(normal.y ?? 0)) * Number(size.y ?? 0) +
    Math.abs(Number(normal.z ?? 0)) * Number(size.z ?? 0)
  ) / 2 + 0.04;
}

function placementTransformForSurface(definition, surfacePlacement, seatOnSurface = true) {
  const point = surfacePlacement?.point ?? { x: 0, y: 0, z: 0 };
  const normal = normalizeVector(surfacePlacement?.normal, { x: 0, y: 1, z: 0 });
  const extent = seatOnSurface ? placementExtentForDefinition(definition, normal) : 0;
  return normalizePlacementTransform({
    position: {
      x: Number(point.x ?? 0) + normal.x * extent,
      y: Number(point.y ?? 0) + normal.y * extent,
      z: Number(point.z ?? 0) + normal.z * extent,
    },
    rotation: quaternionBetweenVectors({ x: 0, y: 1, z: 0 }, normal),
    scale: { x: 1, y: 1, z: 1 },
  });
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

function clampNumber(value, min, max, fallback = min) {
  const number = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(number) ? number : fallback));
}

function vectorLength(vector) {
  return Math.hypot(vector?.x ?? 0, vector?.y ?? 0, vector?.z ?? 0);
}

function normalizeVector(vector, fallback = { x: 0, y: 1, z: 0 }) {
  const length = vectorLength(vector);
  if (length <= 0.000001) return { ...fallback };
  return {
    x: Number(vector.x ?? 0) / length,
    y: Number(vector.y ?? 0) / length,
    z: Number(vector.z ?? 0) / length,
  };
}

function dotVector(left, right) {
  return (
    Number(left?.x ?? 0) * Number(right?.x ?? 0) +
    Number(left?.y ?? 0) * Number(right?.y ?? 0) +
    Number(left?.z ?? 0) * Number(right?.z ?? 0)
  );
}

function crossVector(left, right) {
  return {
    x: Number(left?.y ?? 0) * Number(right?.z ?? 0) - Number(left?.z ?? 0) * Number(right?.y ?? 0),
    y: Number(left?.z ?? 0) * Number(right?.x ?? 0) - Number(left?.x ?? 0) * Number(right?.z ?? 0),
    z: Number(left?.x ?? 0) * Number(right?.y ?? 0) - Number(left?.y ?? 0) * Number(right?.x ?? 0),
  };
}

function scaleVector(vector, amount) {
  return {
    x: Number(vector?.x ?? 0) * amount,
    y: Number(vector?.y ?? 0) * amount,
    z: Number(vector?.z ?? 0) * amount,
  };
}

function addVector(left, right) {
  return {
    x: Number(left?.x ?? 0) + Number(right?.x ?? 0),
    y: Number(left?.y ?? 0) + Number(right?.y ?? 0),
    z: Number(left?.z ?? 0) + Number(right?.z ?? 0),
  };
}

function subtractVector(left, right) {
  return {
    x: Number(left?.x ?? 0) - Number(right?.x ?? 0),
    y: Number(left?.y ?? 0) - Number(right?.y ?? 0),
    z: Number(left?.z ?? 0) - Number(right?.z ?? 0),
  };
}

function rotateVectorAroundAxis(vector, axis, angleDeg) {
  const normalizedAxis = normalizeVector(axis, { x: 1, y: 0, z: 0 });
  const radians = (Number(angleDeg ?? 0) * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const cross = crossVector(normalizedAxis, vector);
  const projection = dotVector(normalizedAxis, vector) * (1 - cosine);
  return addVector(
    addVector(scaleVector(vector, cosine), scaleVector(cross, sine)),
    scaleVector(normalizedAxis, projection),
  );
}

function orthogonalTangent(normal, requestedTangent) {
  const normalizedNormal = normalizeVector(normal);
  const projected = subtractVector(
    requestedTangent ?? { x: 1, y: 0, z: 0 },
    scaleVector(normalizedNormal, dotVector(requestedTangent, normalizedNormal)),
  );
  if (vectorLength(projected) > 0.000001) {
    return normalizeVector(projected, { x: 1, y: 0, z: 0 });
  }
  const reference = Math.abs(normalizedNormal.y) > 0.9
    ? { x: 1, y: 0, z: 0 }
    : { x: 0, y: 1, z: 0 };
  return normalizeVector(crossVector(reference, normalizedNormal), { x: 1, y: 0, z: 0 });
}

function placedSpellAnchorPoint(spell, props) {
  const anchor = spell.anchor ?? {};
  if (anchor.surfaceKind === 'prop' && anchor.surfaceTargetId) {
    const prop = props.find((item) => item.id === anchor.surfaceTargetId);
    if (prop) {
      return addVector(prop.position, anchor.localPoint ?? anchor.point);
    }
  }
  return { ...(anchor.point ?? { x: 0, y: 0, z: 0 }) };
}

function placementFrameForPlacedSpell(spell, props) {
  if (spell.placementTransform || isUniformPlacementTransform(spell.transform)) {
    const transform = normalizePlacementTransform(spell.placementTransform ?? spell.transform);
    const normal = { x: 0, y: 1, z: 0 };
    const rotatedNormal = normalizeVector(mechanicsRotateVector(normal, transform.rotation), normal);
    const tangent = orthogonalTangent(
      rotatedNormal,
      mechanicsRotateVector({ x: 1, y: 0, z: 0 }, transform.rotation),
    );
    const bitangent = normalizeVector(crossVector(rotatedNormal, tangent), { x: 0, y: 0, z: 1 });
    return {
      origin: { ...transform.position },
      anchorPoint: { ...transform.position },
      normal: rotatedNormal,
      tangent,
      bitangent,
      worldScale: (transform.scale.x + transform.scale.y + transform.scale.z) / 3,
      placementMode: 'world_transform',
      surfaceMode: spell.anchor?.surfaceKind ?? 'world',
      surfaceTargetId: spell.anchor?.surfaceTargetId ?? null,
      surfaceLabel: spell.anchor?.surfaceLabel ?? spell.anchor?.surfaceId ?? 'World surface',
    };
  }
  const baseNormal = normalizeVector(spell.anchor?.normal, { x: 0, y: 1, z: 0 });
  const baseTangent = orthogonalTangent(baseNormal, spell.anchor?.tangent);
  const baseBitangent = normalizeVector(crossVector(baseNormal, baseTangent), { x: 0, y: 0, z: 1 });
  const pitchDeg = clampNumber(
    spell.transform?.pitchDeg,
    -MAX_PLACED_SPELL_TILT_DEG,
    MAX_PLACED_SPELL_TILT_DEG,
    0,
  );
  const yawDeg = clampNumber(
    spell.transform?.yawDeg,
    -MAX_PLACED_SPELL_TILT_DEG,
    MAX_PLACED_SPELL_TILT_DEG,
    0,
  );
  let normal = rotateVectorAroundAxis(baseNormal, baseTangent, pitchDeg);
  let bitangent = rotateVectorAroundAxis(baseBitangent, baseTangent, pitchDeg);
  normal = normalizeVector(rotateVectorAroundAxis(normal, bitangent, yawDeg), baseNormal);
  let tangent = normalizeVector(rotateVectorAroundAxis(baseTangent, bitangent, yawDeg), baseTangent);
  tangent = orthogonalTangent(normal, tangent);
  bitangent = normalizeVector(crossVector(normal, tangent), baseBitangent);

  const worldScale = clampNumber(
    spell.transform?.scale,
    MIN_PLACED_SPELL_SCALE,
    MAX_PLACED_SPELL_SCALE,
    DEFAULT_PLACED_SPELL_SCALE,
  );
  const anchorPoint = placedSpellAnchorPoint(spell, props);
  const tiltCosine = clampNumber(dotVector(baseNormal, normal), -1, 1, 1);
  const tiltRadians = Math.acos(tiltCosine);
  const clearance = 0.018 + Math.sin(tiltRadians) * 1.42 * worldScale;
  const origin = addVector(anchorPoint, scaleVector(baseNormal, clearance));

  return {
    origin,
    anchorPoint,
    normal,
    tangent,
    bitangent,
    worldScale,
    placementMode: 'surface_anchor',
    surfaceMode: spell.anchor?.surfaceKind ?? 'world',
    surfaceTargetId: spell.anchor?.surfaceTargetId ?? null,
    surfaceLabel: spell.anchor?.surfaceLabel ?? spell.anchor?.surfaceId ?? 'World surface',
  };
}

function activationOptionsForPlacedSpell(spell, now = Date.now()) {
  const elapsedMs =
    spell.spellActive && spell.activationStartedAt
      ? Math.max(0, now - spell.activationStartedAt)
      : Math.max(0, Number(spell.activationElapsedMs ?? 0));
  return {
    active: spell.spellActive,
    mode: spell.activationMode,
    elapsedMs,
    durationMs: spell.activationDurationMs,
    enforceOuterRing: false,
    outerRingClosed: true,
    outerRingCompletion: 1,
  };
}

function buildPlacedSpellRuntime(spell, state, now = Date.now()) {
  const compileResult = spell.compileResult;
  if (!compileResult) return null;
  const activation = activationOptionsForPlacedSpell(spell, now);
  const deltaMs = Math.max(0, activation.elapsedMs - Number(spell.effectLifecycleElapsedMs ?? 0));
  const sources =
    spell.spellActive && spell.activationSourceSnapshot
      ? spell.activationSourceSnapshot
      : state.sources;
  return interpretCompiledSpell({
    graph: compileResult.graph,
    program: compileResult.program,
    diagnostics: compileResult.diagnostics,
    sceneState: { sources, props: state.props },
    options: {
      activation,
      placementFrame: placementFrameForPlacedSpell(spell, state.props),
      crosshairMode: state.crosshairMode === 'auto' ? undefined : state.crosshairMode,
      motionBaselines: spell.physicsMotionBaselines ?? {},
      effectLifecycle: {
        activeEffectIds: spell.effectLifecycleActiveIds ?? [],
        deltaMs,
      },
    },
  });
}

function cloneCompileResult(compileResult) {
  return cloneJson(compileResult);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function cloneSceneSources(sources) {
  return JSON.parse(JSON.stringify(sources ?? []));
}

function normalizeSurfacePlacement(surfacePlacement, props) {
  const point = {
    x: Number(surfacePlacement?.point?.x ?? 0),
    y: Number(surfacePlacement?.point?.y ?? 0),
    z: Number(surfacePlacement?.point?.z ?? 0),
  };
  const normal = normalizeVector(surfacePlacement?.normal, { x: 0, y: 1, z: 0 });
  const tangent = orthogonalTangent(normal, surfacePlacement?.tangent);
  const surfaceTargetId = surfacePlacement?.surfaceTargetId ?? null;
  const prop = surfaceTargetId ? props.find((item) => item.id === surfaceTargetId) : null;
  return {
    point,
    normal,
    tangent,
    surfaceId: surfacePlacement?.surfaceId ?? 'world-surface',
    surfaceKind: prop ? 'prop' : surfacePlacement?.surfaceKind ?? 'world',
    surfaceTargetId: prop?.id ?? null,
    surfaceLabel: surfacePlacement?.surfaceLabel ?? prop?.label ?? 'World surface',
    localPoint: prop ? subtractVector(point, prop.position) : null,
  };
}

function bindingForSurfacePlacement(surfacePlacement, props) {
  const surfaceTargetId = surfacePlacement?.surfaceTargetId ?? null;
  const prop = surfaceTargetId ? props.find((item) => item.id === surfaceTargetId) : null;
  const bodyId = surfacePlacement?.mountBodyId ?? (prop ? `prop:${prop.id}` : null);
  if (!bodyId) return null;
  return {
    bodyId,
    surfaceKind: surfacePlacement?.surfaceKind ?? (prop ? 'prop' : 'world'),
    surfaceId: surfacePlacement?.surfaceId ?? bodyId,
    surfaceTargetId: prop?.id ?? surfaceTargetId,
    surfaceLabel: surfacePlacement?.surfaceLabel ?? prop?.label ?? bodyId,
  };
}

function placedLeftovers(spell, runtimeResult) {
  return (runtimeResult?.intents ?? [])
    .filter((intent) => intent.intentType === 'lifecycle_cleanup' && intent.active)
    .map((cleanup) => ({
      ...cleanup,
      id: `${spell.id}:${cleanup.id}:activation-${spell.activationInstanceId}`,
      sourceCleanupId: cleanup.id,
      placedSpellId: spell.id,
      activationInstanceId: spell.activationInstanceId,
      programId: spell.compileResult?.program?.programId ?? spell.templateId,
      persistent: true,
    }));
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
  spellTemplates: [],
  selectedSpellTemplateId: null,
  placedSpells: [],
  selectedPlacedSpellId: null,
  nextSpellTemplateIndex: 1,
  nextPlacedSpellIndex: 1,
  placedAssets: STORED_PLACED_ASSETS,
  placedMechanicsBuilds: STORED_PLACED_MECHANICS,
  worldHistoryPast: [],
  worldHistoryFuture: [],
  worldEditTransaction: null,
  placementTransformError: null,
  nextPlacedAssetIndex: nextPlacementIndex(STORED_PLACED_ASSETS, 'placed-asset'),
  nextPlacedMechanicsBuildIndex: nextPlacementIndex(STORED_PLACED_MECHANICS, 'placed-mechanics'),
  nextActivationOrder: 1,
  playerState: { ...DEFAULT_PLAYER_STATE, position: { ...DEFAULT_PLAYER_STATE.position } },
  selectedInventorySlot: 0,
  spellpadAcquired: false,

  beginWorldEdit() {
    if (get().worldEditTransaction) return false;
    set((state) => ({ worldEditTransaction: worldEditSnapshot(state) }));
    return true;
  },

  commitWorldEdit() {
    const state = get();
    const transaction = state.worldEditTransaction;
    if (!transaction) return false;
    if (!worldEditChanged(transaction, state)) {
      set({ worldEditTransaction: null });
      return false;
    }
    set({
      worldHistoryPast: pushWorldHistory(state.worldHistoryPast, transaction),
      worldHistoryFuture: [],
      worldEditTransaction: null,
    });
    return true;
  },

  undoWorldEdit() {
    const state = get();
    if (state.worldEditTransaction) {
      set({
        ...state.worldEditTransaction,
        worldEditTransaction: null,
        placementTransformError: null,
      });
      get().refreshPlacedSpells();
      return true;
    }
    const previous = state.worldHistoryPast.at(-1);
    if (!previous) return false;
    set({
      ...previous,
      worldHistoryPast: state.worldHistoryPast.slice(0, -1),
      worldHistoryFuture: [worldEditSnapshot(state), ...state.worldHistoryFuture]
        .slice(0, WORLD_HISTORY_LIMIT),
      worldEditTransaction: null,
      placementTransformError: null,
    });
    get().refreshPlacedSpells();
    return true;
  },

  redoWorldEdit() {
    const state = get();
    const next = state.worldHistoryFuture[0];
    if (!next) return false;
    set({
      ...next,
      worldHistoryPast: pushWorldHistory(state.worldHistoryPast, worldEditSnapshot(state)),
      worldHistoryFuture: state.worldHistoryFuture.slice(1),
      worldEditTransaction: null,
      placementTransformError: null,
    });
    get().refreshPlacedSpells();
    return true;
  },

  setPlayerState(playerState) {
    if (!playerState?.position) return;
    set({
      playerState: {
        position: {
          x: Number(playerState.position.x ?? DEFAULT_PLAYER_STATE.position.x),
          y: Number(playerState.position.y ?? DEFAULT_PLAYER_STATE.position.y),
          z: Number(playerState.position.z ?? DEFAULT_PLAYER_STATE.position.z),
        },
        facing: Number(playerState.facing ?? DEFAULT_PLAYER_STATE.facing),
        pitch: clampNumber(
          playerState.pitch ?? (
            playerState.pitchDeg == null
              ? DEFAULT_PLAYER_STATE.pitch
              : (Number(playerState.pitchDeg) * Math.PI) / 180
          ),
          -((80 * Math.PI) / 180),
          (80 * Math.PI) / 180,
          DEFAULT_PLAYER_STATE.pitch,
        ),
        cameraMode: normalizeCameraMode(playerState.cameraMode),
      },
    });
  },

  setSpellpadAcquired(spellpadAcquired) {
    set({ spellpadAcquired: Boolean(spellpadAcquired) });
  },

  resetPlayerToAtelierSpawn() {
    set({
      playerState: {
        ...DEFAULT_PLAYER_STATE,
        position: { ...DEFAULT_PLAYER_STATE.position },
      },
      selectedInventorySlot: 0,
    });
  },

  setSelectedInventorySlot(selectedInventorySlot) {
    const slot = Number(selectedInventorySlot);
    if (!Number.isInteger(slot) || slot < 0 || slot > 9) return;
    set({ selectedInventorySlot: slot });
  },

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
    get().refreshPlacedSpells();
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
    get().refreshPlacedSpells();
  },

  placeAsset(assetId, surfacePlacement) {
    const definition = assetDefinitionForId(assetId);
    if (!definition) return null;
    const index = get().nextPlacedAssetIndex;
    const id = `placed-asset:${index}`;
    const asset = {
      id,
      assetDefinitionId: definition.id,
      name: definition.name,
      category: definition.category,
      affectedByGravity: false,
      anchor: {
        point: { ...(surfacePlacement?.point ?? { x: 0, y: 0, z: 0 }) },
        normal: normalizeVector(surfacePlacement?.normal, { x: 0, y: 1, z: 0 }),
        surfaceId: surfacePlacement?.surfaceId ?? 'world-surface',
        surfaceKind: surfacePlacement?.surfaceKind ?? 'world',
        surfaceTargetId: surfacePlacement?.surfaceTargetId ?? null,
        surfaceLabel: surfacePlacement?.surfaceLabel ?? 'World surface',
      },
      transform: placementTransformForSurface(definition, surfacePlacement, true),
    };
    set((state) => withWorldHistory(state, {
      placedAssets: [...state.placedAssets, asset],
      nextPlacedAssetIndex: state.nextPlacedAssetIndex + 1,
    }));
    return id;
  },

  removePlacedAsset(assetId) {
    let changed = false;
    set((state) => {
      if (!state.placedAssets.some((asset) => asset.id === assetId)) return {};
      changed = true;
      return withWorldHistory(state, {
        placedAssets: state.placedAssets.filter((asset) => asset.id !== assetId),
      });
    });
    return changed;
  },

  /**
   * Update one world placement through the wrench backend contract.
   *
   * @param {{kind: 'spell'|'asset'|'mechanics-build'|'prop', id: string, position?: {x?: number, y?: number, z?: number}, rotation?: {x?: number, y?: number, z?: number, w?: number}, scale?: number|{x?: number, y?: number, z?: number}}} input
   * @returns {boolean} true when the addressed placement was validated and persisted in store state.
   *
   * Rotation follows the Mechanics workbench contract: the UI edits XYZ Euler
   * angles in degrees, converts them with degreesToRadians, then passes the
   * resulting THREE/ Rapier-compatible quaternion here. Position is in world
   * units and scale is positive, uniform or per-axis.
   */
  updatePlacementTransform(input = {}) {
    const kind = normalizePlacementKind(input.kind);
    const id = String(input.id ?? '');
    const patch = {};
    for (const field of ['position', 'rotation', 'scale']) {
      if (input[field] !== undefined) patch[field] = input[field];
    }
    const validation = validatePlacementTransformPatch(patch);
    const collectionKey = kind === PLACEMENT_KINDS.SPELL
      ? 'placedSpells'
      : kind === PLACEMENT_KINDS.ASSET
        ? 'placedAssets'
        : kind === PLACEMENT_KINDS.MECHANICS_BUILD
          ? 'placedMechanicsBuilds'
          : kind === PLACEMENT_KINDS.PROP
            ? 'props'
          : null;
    const state = get();
    const record = collectionKey
      ? state[collectionKey].find((item) => item.id === id)
      : null;
    if (!kind || !id || !collectionKey || !record || !validation.ok) {
      set({ placementTransformError: validation.error ?? 'Placement kind or id was not found.' });
      return false;
    }
    const nextTransform = mergePlacementTransform(recordTransformForKind(record, kind), patch);
    set((current) => withWorldHistory(current, {
      [collectionKey]: current[collectionKey].map((item) =>
        item.id === id ? applyTransformToRecord(item, kind, nextTransform, patch) : item,
      ),
      placementTransformError: null,
    }));
    if (kind === PLACEMENT_KINDS.SPELL) get().refreshPlacedSpells();
    if (kind === PLACEMENT_KINDS.PROP) {
      get().refreshRuntime();
      get().refreshPlacedSpells();
    }
    return true;
  },

  /**
   * Release or anchor one placed world item. Assets become one dynamic body;
   * mechanics builds release their authored fixed assemblies while retaining
   * the saved joints and moving parts. Anchoring may include the live world
   * transform so a fallen item freezes where it currently rests.
   */
  setWorldPlacementGravity(input = {}) {
    const kind = normalizePlacementKind(input.kind);
    if (![PLACEMENT_KINDS.ASSET, PLACEMENT_KINDS.MECHANICS_BUILD, PLACEMENT_KINDS.PROP].includes(kind)) return false;
    const id = String(input.id ?? '');
    const collectionKey = kind === PLACEMENT_KINDS.ASSET
      ? 'placedAssets'
      : kind === PLACEMENT_KINDS.MECHANICS_BUILD
        ? 'placedMechanicsBuilds'
        : 'props';
    const record = get()[collectionKey].find((item) => item.id === id);
    if (!record) return false;
    const affectedByGravity = input.affectedByGravity === true;
    const transformPatch = input.transform == null
      ? null
      : validatePlacementTransformPatch(input.transform);
    if (transformPatch && !transformPatch.ok) return false;
    const currentTransform = recordTransformForKind(record, kind);
    const transform = input.transform == null
      ? currentTransform
      : mergePlacementTransform(currentTransform, input.transform);
    set((state) => withWorldHistory(state, {
      [collectionKey]: state[collectionKey].map((item) => item.id === id
        ? kind === PLACEMENT_KINDS.PROP
          ? { ...applyTransformToRecord(item, kind, transform, input.transform ?? {}), affectedByGravity }
          : { ...item, affectedByGravity, transform }
        : item),
    }));
    if (kind === PLACEMENT_KINDS.PROP) {
      get().refreshRuntime();
      get().refreshPlacedSpells();
    }
    return true;
  },

  updatePlacedAssetTransform(assetId, patch) {
    set((state) => withWorldHistory(state, {
      placedAssets: state.placedAssets.map((asset) =>
        asset.id === assetId
          ? { ...asset, transform: normalizePlacementTransform({ ...asset.transform, ...patch }) }
          : asset,
      ),
    }));
  },

  placeMechanicsBuild(blueprint, surfacePlacement) {
    if (!blueprint?.document) return null;
    const index = get().nextPlacedMechanicsBuildIndex;
    const id = `placed-mechanics:${index}`;
    const build = {
      id,
      blueprintId: blueprint.blueprintId ?? `blueprint:${index}`,
      name: blueprint.name ?? blueprint.document.metadata?.name ?? `Mechanics build ${index}`,
      document: cloneJson(blueprint.document),
      affectedByGravity: false,
      anchor: {
        point: { ...(surfacePlacement?.point ?? { x: 0, y: 0, z: 0 }) },
        normal: normalizeVector(surfacePlacement?.normal, { x: 0, y: 1, z: 0 }),
        surfaceId: surfacePlacement?.surfaceId ?? 'world-surface',
        surfaceKind: surfacePlacement?.surfaceKind ?? 'world',
        surfaceTargetId: surfacePlacement?.surfaceTargetId ?? null,
        surfaceLabel: surfacePlacement?.surfaceLabel ?? 'World surface',
      },
      transform: placementTransformForSurface(
        { size: { x: 0, y: 0, z: 0 } },
        surfacePlacement,
        false,
      ),
    };
    set((state) => withWorldHistory(state, {
      placedMechanicsBuilds: [...state.placedMechanicsBuilds, build],
      nextPlacedMechanicsBuildIndex: state.nextPlacedMechanicsBuildIndex + 1,
    }));
    return id;
  },

  removeMechanicsBuild(buildId) {
    let changed = false;
    set((state) => {
      if (!state.placedMechanicsBuilds.some((build) => build.id === buildId)) return {};
      changed = true;
      return withWorldHistory(state, {
        placedMechanicsBuilds: state.placedMechanicsBuilds.filter((build) => build.id !== buildId),
      });
    });
    return changed;
  },

  updateMechanicsBuildTransform(buildId, patch) {
    set((state) => withWorldHistory(state, {
      placedMechanicsBuilds: state.placedMechanicsBuilds.map((build) =>
        build.id === buildId
          ? { ...build, transform: normalizePlacementTransform({ ...build.transform, ...patch }) }
          : build,
      ),
    }));
  },

  updateSource(sourceId, patch) {
    set((state) => ({
      sources: state.sources.map((source) =>
        source.id === sourceId ? { ...source, ...patch } : source,
      ),
    }));
    get().refreshRuntime();
    get().refreshPlacedSpells();
  },

  updateSourcePosition(sourceId, position) {
    get().updateSource(sourceId, { position });
  },

  removeSource(sourceId) {
    set((state) => ({
      sources: state.sources.filter((source) => source.id !== sourceId),
    }));
    get().refreshRuntime();
    get().refreshPlacedSpells();
  },

  updatePropPosition(propId, position) {
    set((state) => ({
      props: state.props.map((prop) =>
        prop.id === propId ? { ...prop, position } : prop,
      ),
    }));
    get().refreshRuntime();
    get().refreshPlacedSpells();
  },

  updateProp(propId, patch) {
    set((state) => ({
      props: state.props.map((prop) =>
        prop.id === propId ? { ...prop, ...patch } : prop,
      ),
    }));
    get().refreshRuntime();
    get().refreshPlacedSpells();
  },

  removeProp(propId) {
    set((state) => withWorldHistory(state, {
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
      placedSpells: state.placedSpells.filter(
        (spell) => spell.anchor?.surfaceTargetId !== propId,
      ),
      selectedPlacedSpellId:
        state.placedSpells.some(
          (spell) => spell.id === state.selectedPlacedSpellId && spell.anchor?.surfaceTargetId === propId,
        )
          ? null
          : state.selectedPlacedSpellId,
    }));
    get().refreshRuntime();
    get().refreshPlacedSpells();
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

  saveCurrentToSpellpad() {
    const state = get();
    if (!state.compileResult || state.compileError) return null;
    const programId =
      state.compileResult.program?.programId ??
      state.compileResult.program?.title ??
      `compiled-spell:${state.nextSpellTemplateIndex}`;
    const existing = state.spellTemplates.find((template) => template.programId === programId);
    if (existing) {
      set({ selectedSpellTemplateId: existing.id });
      return existing.id;
    }
    const id = `spell-template:${state.nextSpellTemplateIndex}`;
    const sample = state.samples.find((item) => item.id === state.selectedSampleId);
    const template = {
      id,
      programId,
      name:
        state.compileResult.program?.title ??
        sample?.label ??
        `Spell ${state.nextSpellTemplateIndex}`,
      source: state.importSource?.kind ?? 'compiled_editor',
      sourceLabel:
        state.importSource?.displayLabel ??
        state.importSource?.sourceLabel ??
        sample?.label ??
        'Compiled editor spell',
      compileResult: cloneCompileResult(state.compileResult),
    };
    set((current) => ({
      spellTemplates: [...current.spellTemplates, template],
      selectedSpellTemplateId: id,
      nextSpellTemplateIndex: current.nextSpellTemplateIndex + 1,
    }));
    return id;
  },

  saveAuthoredSpell(draft, templateId = null) {
    const state = get();
    const existing = templateId
      ? state.spellTemplates.find((template) => template.id === templateId)
      : null;
    const id = existing?.id ?? `spell-template:${state.nextSpellTemplateIndex}`;
    const result = existing
      ? updateAuthoredSpellTemplate(existing, draft)
      : createAuthoredSpellTemplate(draft, id);
    if (!result.ok) return result;
    if (!existing && state.spellTemplates.some(
      (template) => template.programId === result.template.programId,
    )) {
      const duplicate = state.spellTemplates.find(
        (template) => template.programId === result.template.programId,
      );
      set({ selectedSpellTemplateId: duplicate.id });
      return { ok: true, templateId: duplicate.id, existing: true };
    }
    if (existing) {
      set((current) => ({
        spellTemplates: current.spellTemplates.map((template) =>
          template.id === existing.id ? result.template : template,
        ),
        selectedSpellTemplateId: existing.id,
      }));
      return { ...result, templateId: existing.id, updated: true };
    }
    set((current) => ({
      spellTemplates: [...current.spellTemplates, result.template],
      selectedSpellTemplateId: id,
      nextSpellTemplateIndex: current.nextSpellTemplateIndex + 1,
    }));
    return { ...result, templateId: id, created: true };
  },

  saveAuthoredPlacedSpell(draft, placedSpellId) {
    const placedSpell = get().placedSpells.find((spell) => spell.id === placedSpellId);
    if (!placedSpell) {
      return { ok: false, error: 'Placed spell was not found.' };
    }
    const result = updateAuthoredSpellTemplate(placedSpell, draft);
    if (!result.ok) return result;
    set((state) => ({
      placedSpells: state.placedSpells.map((spell) =>
        spell.id === placedSpellId
          ? {
              ...spell,
              name: result.template.name,
              authorDraft: cloneJson(result.template.authorDraft),
              compileResult: cloneCompileResult(result.template.compileResult),
            }
          : spell,
      ),
    }));
    queueMicrotask(() => get().refreshPlacedSpells());
    return { ...result, placedSpellId, updated: true };
  },

  selectSpellTemplate(selectedSpellTemplateId) {
    if (!get().spellTemplates.some((template) => template.id === selectedSpellTemplateId)) return;
    set({ selectedSpellTemplateId });
  },

  renameSpellTemplate(templateId, name) {
    const nextName = String(name ?? '').slice(0, 80);
    set((state) => ({
      spellTemplates: state.spellTemplates.map((template) =>
        template.id === templateId ? { ...template, name: nextName } : template,
      ),
    }));
  },

  removeSpellTemplate(templateId) {
    set((state) => {
      const remaining = state.spellTemplates.filter((template) => template.id !== templateId);
      return {
        spellTemplates: remaining,
        selectedSpellTemplateId:
          state.selectedSpellTemplateId === templateId
            ? remaining[0]?.id ?? null
            : state.selectedSpellTemplateId,
      };
    });
  },

  placeSelectedSpell(surfacePlacement) {
    const state = get();
    const template =
      state.spellTemplates.find((item) => item.id === state.selectedSpellTemplateId) ??
      state.spellTemplates[0];
    if (!template) return null;
    const id = `placed-spell:${state.nextPlacedSpellIndex}`;
    const anchor = normalizeSurfacePlacement(surfacePlacement, state.props);
    const placedSpell = {
      id,
      templateId: template.id,
      name: template.name,
      authorDraft: template.authorDraft ? cloneJson(template.authorDraft) : null,
      copyNumber:
        state.placedSpells.filter((spell) => spell.templateId === template.id).length + 1,
      compileResult: cloneCompileResult(template.compileResult),
      anchor,
      binding: bindingForSurfacePlacement(surfacePlacement, state.props),
      placementTransform: initialSpellPlacementTransform(anchor),
      transform: { scale: DEFAULT_PLACED_SPELL_SCALE, pitchDeg: 0, yawDeg: 0 },
      activationMode: 'timed',
      activationDurationMs: DEFAULT_ACTIVATION_DURATION_MS,
      affectedByGravity: false,
      spellActive: false,
      activationStartedAt: null,
      activationElapsedMs: 0,
      activationInstanceId: 0,
      activationOrder: 0,
      lastSourceSpendKey: null,
      effectLifecycleActiveIds: [],
      effectLifecycleElapsedMs: 0,
      physicsMotionBaselines: {},
      activationSourceSnapshot: null,
      runtimeResult: null,
    };
    set((current) => withWorldHistory(current, {
      placedSpells: [...current.placedSpells, placedSpell],
      selectedPlacedSpellId: id,
      nextPlacedSpellIndex: current.nextPlacedSpellIndex + 1,
    }));
    get().refreshPlacedSpells();
    return id;
  },

  socketSelectedSpellOnMechanicsPlate(buildId, deviceId) {
    const state = get();
    const template = state.spellTemplates.find((item) => item.id === state.selectedSpellTemplateId)
      ?? state.spellTemplates[0];
    if (!template) return null;
    let changed = false;
    set((current) => {
      const placedMechanicsBuilds = current.placedMechanicsBuilds.map((build) => {
        if (build.id !== buildId) return build;
        const devices = build.document?.spellDevices ?? [];
        if (!devices.some((device) => device.deviceId === deviceId)) return build;
        changed = true;
        return {
          ...build,
          document: {
            ...build.document,
            spellDevices: devices.map((device) => device.deviceId === deviceId
              ? {
                  ...device,
                  spellTemplateId: template.id,
                  spell: mountedSpellSnapshot(template),
                  label: device.label === 'Empty spell socket' ? `${template.name} spell plate` : device.label,
                }
              : device),
          },
        };
      });
      return changed ? withWorldHistory(current, { placedMechanicsBuilds }) : {};
    });
    return changed ? { buildId, deviceId, templateId: template.id, name: template.name } : null;
  },

  selectPlacedSpell(selectedPlacedSpellId) {
    if (
      selectedPlacedSpellId != null &&
      !get().placedSpells.some((spell) => spell.id === selectedPlacedSpellId)
    ) {
      return;
    }
    set({ selectedPlacedSpellId });
  },

  updatePlacedSpellTransform(placedSpellId, patch) {
    set((state) => withWorldHistory(state, {
      placedSpells: state.placedSpells.map((spell) => {
        if (spell.id !== placedSpellId) return spell;
        return {
          ...spell,
          transform: {
            ...spell.transform,
            ...(patch.scale == null
              ? {}
              : {
                  scale: clampNumber(
                    patch.scale,
                    MIN_PLACED_SPELL_SCALE,
                    MAX_PLACED_SPELL_SCALE,
                    spell.transform.scale,
                  ),
                }),
            ...(patch.pitchDeg == null
              ? {}
              : {
                  pitchDeg: clampNumber(
                    patch.pitchDeg,
                    -MAX_PLACED_SPELL_TILT_DEG,
                    MAX_PLACED_SPELL_TILT_DEG,
                    spell.transform.pitchDeg,
                  ),
                }),
            ...(patch.yawDeg == null
              ? {}
              : {
                  yawDeg: clampNumber(
                    patch.yawDeg,
                    -MAX_PLACED_SPELL_TILT_DEG,
                    MAX_PLACED_SPELL_TILT_DEG,
                    spell.transform.yawDeg,
                  ),
                }),
          },
        };
      }),
    }));
    get().refreshPlacedSpells();
  },

  resetPlacedSpellTransform(placedSpellId) {
    get().updatePlacedSpellTransform(placedSpellId, {
      scale: DEFAULT_PLACED_SPELL_SCALE,
      pitchDeg: 0,
      yawDeg: 0,
    });
  },

  setPlacedSpellGravity(placedSpellId, affectedByGravity) {
    // Placed spell circles are massless attachments. Retain the action as a
    // compatibility no-op for older callers, but never create an independent
    // rigid body that would add weight or alter the host's balance.
    if (affectedByGravity) return false;
    set((state) => ({
      placedSpells: state.placedSpells.map((spell) =>
        spell.id === placedSpellId ? { ...spell, affectedByGravity: false } : spell,
      ),
    }));
    return true;
  },

  unbindPlacedSpell(placedSpellId, worldTransform = null) {
    let changed = false;
    set((state) => {
      const placedSpells = state.placedSpells.map((spell) => {
        if (spell.id !== placedSpellId || !spell.binding) return spell;
        changed = true;
        const transform = worldTransform
          ? normalizePlacementTransform(worldTransform)
          : recordTransformForKind(spell, PLACEMENT_KINDS.SPELL);
        return {
          ...spell,
          binding: null,
          affectedByGravity: false,
          placementTransform: transform,
          anchor: {
            ...spell.anchor,
            point: { ...transform.position },
            localPoint: null,
            surfaceKind: 'world',
            surfaceTargetId: null,
            surfaceId: 'unbound-world',
            surfaceLabel: 'Unbound in world',
          },
        };
      });
      return changed ? withWorldHistory(state, { placedSpells }) : {};
    });
    if (changed) get().refreshPlacedSpells();
    return changed;
  },

  setPlacedSpellMode(placedSpellId, activationMode) {
    if (!['timed', 'toggled'].includes(activationMode)) return;
    set((state) => ({
      placedSpells: state.placedSpells.map((spell) =>
        spell.id === placedSpellId
          ? {
              ...spell,
              activationMode,
              spellActive: false,
              activationStartedAt: null,
              activationElapsedMs: 0,
              effectLifecycleElapsedMs: 0,
              activationSourceSnapshot: null,
            }
          : spell,
      ),
    }));
    get().refreshPlacedSpells();
  },

  setPlacedSpellDurationSeconds(placedSpellId, seconds) {
    const activationDurationMs = clampNumber(
      Number(seconds) * 1000,
      MIN_PLACED_SPELL_DURATION_MS,
      MAX_PLACED_SPELL_DURATION_MS,
      DEFAULT_ACTIVATION_DURATION_MS,
    );
    set((state) => ({
      placedSpells: state.placedSpells.map((spell) =>
        spell.id === placedSpellId ? { ...spell, activationDurationMs } : spell,
      ),
    }));
    get().refreshPlacedSpells();
  },

  activatePlacedSpell(placedSpellId) {
    const activationOrder = get().nextActivationOrder;
    set((state) => ({
      nextActivationOrder: state.nextActivationOrder + 1,
      placedSpells: state.placedSpells.map((spell) =>
        spell.id === placedSpellId
          ? {
              ...spell,
              spellActive: true,
              activationStartedAt: Date.now(),
              activationElapsedMs: 0,
              activationInstanceId: spell.activationInstanceId + 1,
              activationOrder,
              lastSourceSpendKey: null,
              effectLifecycleActiveIds: [],
              effectLifecycleElapsedMs: 0,
              activationSourceSnapshot: cloneSceneSources(state.sources),
            }
          : spell,
      ),
    }));
    queueMicrotask(() => {
      get().refreshPlacedSpells();
      get().applyPlacedSpellSourceSpend(placedSpellId);
    });
  },

  deactivatePlacedSpell(placedSpellId) {
    set((state) => ({
      placedSpells: state.placedSpells.map((spell) =>
        spell.id === placedSpellId
          ? {
              ...spell,
              spellActive: false,
              activationStartedAt: null,
              activationElapsedMs: 0,
              activationSourceSnapshot: null,
            }
          : spell,
      ),
    }));
    get().refreshPlacedSpells();
  },

  triggerPlacedSpell(placedSpellId) {
    const spell = get().placedSpells.find((item) => item.id === placedSpellId);
    if (!spell) return;
    if (spell.activationMode === 'toggled' && spell.spellActive) {
      get().deactivatePlacedSpell(placedSpellId);
      return;
    }
    get().activatePlacedSpell(placedSpellId);
  },

  removePlacedSpell(placedSpellId) {
    const spell = get().placedSpells.find((item) => item.id === placedSpellId);
    if (!spell) return;
    if (spell.spellActive || (spell.effectLifecycleActiveIds?.length ?? 0) > 0) {
      get().deactivatePlacedSpell(placedSpellId);
    }
    set((state) => withWorldHistory(state, {
      placedSpells: state.placedSpells.filter((item) => item.id !== placedSpellId),
      selectedPlacedSpellId:
        state.selectedPlacedSpellId === placedSpellId ? null : state.selectedPlacedSpellId,
    }));
    return true;
  },

  refreshPlacedSpells() {
    const state = get();
    if (state.placedSpells.length === 0) return;
    const now = Date.now();
    const newLeftovers = [];
    const placedSpells = [...state.placedSpells]
      .sort((left, right) => left.activationOrder - right.activationOrder)
      .map((spell) => {
        const runtimeResult = buildPlacedSpellRuntime(spell, state, now);
        const activation = activationOptionsForPlacedSpell(spell, now);
        const timedEnded =
          spell.activationMode === 'timed' &&
          spell.spellActive &&
          activation.elapsedMs >= spell.activationDurationMs;
        newLeftovers.push(...placedLeftovers(spell, runtimeResult));
        return {
          ...spell,
          runtimeResult,
          spellActive: timedEnded ? false : spell.spellActive,
          activationStartedAt: timedEnded ? null : spell.activationStartedAt,
          activationElapsedMs: timedEnded
            ? spell.activationDurationMs
            : activation.elapsedMs,
          activationSourceSnapshot: timedEnded ? null : spell.activationSourceSnapshot,
          effectLifecycleActiveIds: timedEnded
            ? []
            : activeEffectLifecycleIds(runtimeResult),
          effectLifecycleElapsedMs: activation.elapsedMs,
        };
      });
    set({
      placedSpells,
      sceneLeftovers: mergeLeftovers(state.sceneLeftovers, newLeftovers),
    });
  },

  applyPlacedSpellSourceSpend(placedSpellId) {
    const state = get();
    const spell = state.placedSpells.find((item) => item.id === placedSpellId);
    if (!spell?.runtimeResult?.lifecycle?.active) return;
    const spendKey = `${spell.id}:${spell.activationInstanceId}`;
    if (spell.lastSourceSpendKey === spendKey) return;
    const spends = sourceSpendsFromRuntime(spell.runtimeResult);
    set((current) => ({
      placedSpells: current.placedSpells.map((item) =>
        item.id === placedSpellId ? { ...item, lastSourceSpendKey: spendKey } : item,
      ),
      sources: current.sources.map((source) => {
        const spendAmount = spends.get(source.id) ?? 0;
        if (spendAmount <= 0 || source.nonDepleting) return source;
        return {
          ...source,
          amount: Math.max(0, Number((Number(source.amount ?? 0) - spendAmount).toFixed(3))),
        };
      }),
    }));
    if (spends.size > 0) get().refreshPlacedSpells();
  },

  setCrosshairMode(crosshairMode) {
    set({ crosshairMode });
    get().refreshRuntime();
    get().refreshPlacedSpells();
  },

  setDebugOpen(debugOpen) {
    set({ debugOpen });
  },

  selectDebugItem(selectedDebugId) {
    set({ selectedDebugId });
  },
}));

let lastPersistedPlacedAssets = null;
let lastPersistedMechanicsBuilds = null;
useSpellStore.subscribe((state) => {
  if (typeof localStorage === 'undefined') return;
  try {
    if (state.placedAssets !== lastPersistedPlacedAssets) {
      lastPersistedPlacedAssets = state.placedAssets;
      localStorage.setItem(PLACED_ASSETS_STORAGE_KEY, JSON.stringify(state.placedAssets));
    }
    if (state.placedMechanicsBuilds !== lastPersistedMechanicsBuilds) {
      lastPersistedMechanicsBuilds = state.placedMechanicsBuilds;
      localStorage.setItem(PLACED_MECHANICS_STORAGE_KEY, JSON.stringify(state.placedMechanicsBuilds));
    }
  } catch {
    // Keep the live sandbox usable when storage is blocked or its quota is full.
  }
});
