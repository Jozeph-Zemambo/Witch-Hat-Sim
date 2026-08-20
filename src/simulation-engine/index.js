/**
 * Pure simulation-engine entrypoint.
 *
 * The compiler turns authored spell input into deterministic effect data. This
 * module turns that semantic data plus scene state into render-neutral runtime
 * intents. It deliberately imports no browser, Babylon, or physics libraries.
 */
export const SIMULATION_ENGINE_VERSION = '0.1.0';
// The browser scene normalizes every authored outer spell ring to this local
// radius before applying the placement frame's world scale. Levitation uses
// the same contract for its generated body so the visible orb, its collider,
// and the circle that owns it cannot drift to different sizes.
export const NORMALIZED_SPELL_CIRCLE_RADIUS = 1.2;
// The main-world paper spellpad is a square. Dispersion must clear its corners,
// not merely the circular ink seal drawn inside it. Keep the authored note size
// and the proportional corner clearance here so rendering and physics cannot
// drift into separate footprint formulas.
export const NORMALIZED_PLACED_SPELL_NOTE_SIDE = 2.8;
export const DISPERSION_NOTE_CLEARANCE_FACTOR = 1.05;

export function placedSpellDispersionClearanceRadius(worldScale = 1) {
  const scale = clamp(finite(worldScale, 1), 0.2, 4);
  return roundNumber(
    (NORMALIZED_PLACED_SPELL_NOTE_SIDE * Math.SQRT2 * DISPERSION_NOTE_CLEARANCE_FACTOR * scale) / 2,
    4,
  );
}

const DEFAULT_SOURCE_AMOUNT = 80;
const DEFAULT_SOURCE_CAPACITY = 100;
const DEFAULT_WATER_COLUMN_REQUIREMENT = 12;
const DEFAULT_ACTIVATION_DURATION_MS = 5000;
const DEFAULT_SIGN_SIZE = 200;
const COLUMN_HEIGHT_MULTIPLIER = 3;
const REGION_CLUSTER_THRESHOLD_DEG = 35;
const EXPLICIT_CROSSHAIR_MODES = new Set(['crosshair_1', 'crosshair_2', 'crosshair_3']);

const EFFECT_PHASE_ORDER = [
  {
    phaseIndex: 1,
    phase: 'geometry_ring_ownership',
    description: 'resolve geometry and ring ownership',
  },
  {
    phaseIndex: 2,
    phase: 'domains_sigils',
    description: 'resolve domains and sigils',
  },
  {
    phaseIndex: 3,
    phase: 'targeting_source_operators',
    description: 'resolve targeting/source operators: Region, Crosshair, Pull, Collection, Gather',
  },
  {
    phaseIndex: 4,
    phase: 'source_budget',
    description: 'acquire or generate source budget',
  },
  {
    phaseIndex: 5,
    phase: 'transforms_state_modifiers',
    description: 'apply transforms/state modifiers: cool, crush, radial, glow, heat',
  },
  {
    phaseIndex: 6,
    phase: 'shape_output_operators',
    description: 'resolve shape/output operators: column, levitation, convergence, dispersion',
  },
  {
    phaseIndex: 7,
    phase: 'region_emergence_placement',
    description: 'apply Region distribution/emergence placement to final output placement',
  },
  {
    phaseIndex: 8,
    phase: 'physics_material_simulation',
    description: 'run physics/material simulation',
  },
  {
    phaseIndex: 9,
    phase: 'lifecycle_cleanup_leftovers',
    description: 'run lifecycle cleanup and material leftovers',
  },
];

const DEFAULT_PLACEMENT_FRAME = {
  origin: { x: 0, y: 0, z: 0 },
  normal: { x: 0, y: 1, z: 0 },
  tangent: { x: 1, y: 0, z: 0 },
  bitangent: { x: 0, y: 0, z: 1 },
  worldScale: 1,
};

const MATERIAL_PRESETS = {
  water: {
    materialFamily: 'water',
    phase: 'liquid',
    renderPreset: 'water_liquid',
    viscosity: 1,
    cohesion: 1,
  },
  mist: {
    materialFamily: 'water',
    phase: 'mist_cloud',
    renderPreset: 'mist_cloud',
    viscosity: 0.18,
    cohesion: 0.18,
  },
  cloud: {
    materialFamily: 'water',
    phase: 'mist_cloud',
    renderPreset: 'mist_cloud',
    viscosity: 0.18,
    cohesion: 0.18,
  },
  ice: {
    materialFamily: 'water',
    phase: 'ice',
    renderPreset: 'ice_chunk',
    viscosity: 8,
    cohesion: 4,
  },
  earth: {
    materialFamily: 'earth',
    phase: 'solid',
    renderPreset: 'earth_solid',
    viscosity: 5,
    cohesion: 3,
  },
  dust: {
    materialFamily: 'earth',
    phase: 'crushed_earth',
    renderPreset: 'crushed_earth',
    viscosity: 1.4,
    cohesion: 0.55,
  },
  sand: {
    materialFamily: 'earth',
    phase: 'crushed_earth',
    renderPreset: 'crushed_earth',
    viscosity: 1.35,
    cohesion: 0.5,
  },
  crushed_earth: {
    materialFamily: 'earth',
    phase: 'crushed_earth',
    renderPreset: 'crushed_earth',
    viscosity: 1.4,
    cohesion: 0.55,
  },
  mud: {
    materialFamily: 'mud',
    phase: 'sludge',
    renderPreset: 'mud_sludge',
    viscosity: 3.8,
    cohesion: 1.8,
  },
  glow: {
    materialFamily: 'light',
    phase: 'glow',
    renderPreset: 'glow',
    viscosity: 0,
    cohesion: 0,
  },
};

/**
 * @param {Partial<SceneSource>} [overrides]
 * @returns {SceneSource}
 */
export function createSceneSource(overrides = {}) {
  const kind = overrides.kind ?? 'water';
  const preset = MATERIAL_PRESETS[overrides.materialState ?? kind] ?? MATERIAL_PRESETS[kind] ?? null;
  const id = overrides.id ?? `source:${kind}:0`;
  return {
    id,
    kind,
    label: overrides.label ?? labelForKind(kind),
    materialState: overrides.materialState ?? preset?.phase ?? kind,
    materialFamily:
      overrides.materialFamily ?? preset?.materialFamily ?? materialFamilyForKind(kind),
    amount:
      typeof overrides.amount === 'number' ? overrides.amount : DEFAULT_SOURCE_AMOUNT,
    capacity:
      typeof overrides.capacity === 'number'
        ? overrides.capacity
        : DEFAULT_SOURCE_CAPACITY,
    nonDepleting: overrides.nonDepleting === true,
    mass:
      typeof overrides.mass === 'number'
        ? overrides.mass
        : defaultMassForSource(kind, overrides.amount),
    cohesion:
      typeof overrides.cohesion === 'number'
        ? overrides.cohesion
        : preset?.cohesion ?? defaultCohesionForKind(kind),
    phaseResistance:
      typeof overrides.phaseResistance === 'number'
        ? overrides.phaseResistance
        : defaultPhaseResistanceForState(overrides.materialState ?? kind),
    movable: overrides.movable !== false,
    position: normalizePosition(overrides.position, defaultPositionForKind(kind)),
  };
}

/**
 * @param {Partial<SceneProp>} [overrides]
 * @returns {SceneProp}
 */
export function createSceneProp(overrides = {}) {
  const kind = overrides.kind ?? 'prop';
  return {
    id: overrides.id ?? 'prop:0',
    kind,
    label: overrides.label ?? 'Practice prop',
    visualKind: overrides.visualKind ?? kind,
    targetRole: overrides.targetRole ?? 'generic_practice_prop',
    materialState: overrides.materialState ?? kind,
    materialFamily: overrides.materialFamily ?? materialFamilyForKind(kind),
    amount: typeof overrides.amount === 'number' ? overrides.amount : 1,
    capacity: typeof overrides.capacity === 'number' ? overrides.capacity : 1,
    nonDepleting: overrides.nonDepleting === true,
    position: normalizePosition(overrides.position, { x: 2.4, y: 0, z: 0.8 }),
    size: typeof overrides.size === 'number' ? overrides.size : 1,
    mass: typeof overrides.mass === 'number' ? overrides.mass : 4,
    cohesion: typeof overrides.cohesion === 'number' ? overrides.cohesion : 1.2,
    phaseResistance:
      typeof overrides.phaseResistance === 'number' ? overrides.phaseResistance : 1,
    movable: overrides.movable !== false,
    ...(overrides.bodyMode === 'fixed' || overrides.bodyMode === 'dynamic'
      ? { bodyMode: overrides.bodyMode }
      : {}),
    ...(typeof overrides.affectedByGravity === 'boolean'
      ? { affectedByGravity: overrides.affectedByGravity }
      : {}),
  };
}

/**
 * @returns {SceneState}
 */
export function createDefaultSceneState() {
  return {
    sources: [
      createSceneSource({
        id: 'source:water:default',
        kind: 'water',
        label: 'Water basin',
        // Beside the practice tree, with enough clearance for both physical
        // footprints while keeping them legible as one yard cluster.
        position: { x: 4.1, y: 0, z: 0.55 },
      }),
    ],
    props: [
      createSceneProp({
        id: 'prop:practice-cube',
        label: 'Practice cube',
        position: { x: 2.1, y: 0, z: -0.9 },
        affectedByGravity: true,
      }),
      createSceneProp({
        id: 'prop:small-practice-cube',
        label: 'Small practice cube',
        visualKind: 'prop',
        targetRole: 'generic_practice_prop',
        materialFamily: 'generic',
        materialState: 'prop',
        position: { x: -1.55, y: 0, z: -2.35 },
        size: 0.58,
        mass: 1.2,
        cohesion: 1.4,
        phaseResistance: 1,
        affectedByGravity: true,
      }),
      createSceneProp({
        id: 'field-practice-crate-0',
        label: 'Practice cube 2',
        visualKind: 'practice_crate',
        targetRole: 'generic_practice_prop',
        materialFamily: 'generic',
        materialState: 'wood',
        position: { x: -3.4, y: 0, z: -2.4 },
        size: 1.2888888889,
        mass: 3.2,
        affectedByGravity: true,
      }),
      createSceneProp({
        id: 'field-practice-crate-1',
        label: 'Practice cube 3',
        visualKind: 'practice_crate',
        targetRole: 'generic_practice_prop',
        materialFamily: 'generic',
        materialState: 'wood',
        position: { x: -2.85, y: 0, z: -2.0 },
        size: 1.2888888889,
        mass: 3.2,
        affectedByGravity: true,
      }),
      createSceneProp({
        id: 'prop:practice-tree',
        kind: 'tree',
        label: 'Practice tree',
        visualKind: 'tree_landmark',
        targetRole: 'immovable_pull_landmark',
        materialFamily: 'generic',
        materialState: 'wood',
        position: { x: 2.6, y: 0, z: 1.5 },
        size: 3.8,
        mass: 120,
        cohesion: 8,
        phaseResistance: 4,
        movable: false,
        nonDepleting: true,
      }),
      createSceneProp({
        id: 'prop:tree-apple',
        kind: 'prop',
        label: 'Tree apple',
        visualKind: 'tree_apple',
        targetRole: 'movable_tree_pull_target',
        materialFamily: 'generic',
        materialState: 'prop',
        position: { x: 1.35, y: 0.22, z: 1.1 },
        size: 0.42,
        mass: 0.25,
        cohesion: 0.35,
        phaseResistance: 0.55,
        amount: 1,
        capacity: 1,
      }),
    ],
  };
}

/**
 * @param {{ graph?: object; program?: object; diagnostics?: object[]; sceneState?: Partial<SceneState>; options?: { effectLifecycle?: { activeEffectIds?: string[]; deltaMs?: number } } }} args
 */
export function interpretCompiledSpell({
  graph = { nodes: [], edges: [] },
  program = null,
  diagnostics = [],
  sceneState = createDefaultSceneState(),
  options = {},
} = {}) {
  const normalizedScene = normalizeSceneState(sceneState);
  assertUniqueSceneObjectIds(normalizedScene);
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const placementFrame = normalizePlacementFrame(options.placementFrame);
  const lifecycle = resolveActivationLifecycle(program, options.activation ?? {});

  /** @type {RuntimeIntent[]} */
  const intents = [];
  intents.push(buildSpellActivationIntent(lifecycle));
  intents.push(buildActivationCircuitIntent(lifecycle));
  intents.push(buildPlacementFrameIntent(placementFrame));
  intents.push(buildSpellCircleIntent(program, placementFrame));
  intents.push(buildEffectOrderIntent());

  const regionDistributions = buildRegionDistributionIntents(
    nodes,
    program,
    placementFrame,
    lifecycle,
  );
  intents.push(...regionDistributions);

  const crosshairScopes = buildCrosshairScopeIntents(nodes, program, options);
  intents.push(...crosshairScopes);

  const sourceAcquisitions = buildSourceAcquisitionIntents(
    nodes,
    edges,
    normalizedScene,
    program,
    placementFrame,
    lifecycle,
    regionDistributions,
  );
  const sourceRequirements = buildSourceRequirements(
    nodes,
    edges,
    normalizedScene,
    sourceAcquisitions,
    lifecycle,
  );
  intents.push(...sourceRequirements.requirements);
  intents.push(...sourceRequirements.bindings);
  intents.push(...sourceAcquisitions);
  const physicsMotionIntents = buildPhysicsMotionIntents(
    sourceAcquisitions,
    normalizedScene,
    placementFrame,
    lifecycle,
    options.motionBaselines,
  );

  const materialStates = buildMaterialStateIntents(
    nodes,
    edges,
    sourceAcquisitions,
    lifecycle,
    sourceRequirements,
    crosshairScopes,
    placementFrame,
  );
  intents.push(...materialStates);

  const fieldModifications = buildFieldModificationIntents(
    nodes,
    edges,
    program,
    lifecycle,
    sourceAcquisitions,
  );
  intents.push(...fieldModifications);
  const thermalMaterialIntents = buildThermalMaterialIntents(
    nodes,
    edges,
    sourceRequirements,
    crosshairScopes,
    lifecycle,
    placementFrame,
  );
  intents.push(...thermalMaterialIntents);

  const materialReversionIntents = buildMaterialReversionIntents(
    nodes,
    edges,
    sourceAcquisitions,
    fieldModifications,
    lifecycle,
  );
  intents.push(...materialReversionIntents);

  const columnIntents = buildColumnIntents(nodes, edges, program, {
    placementFrame,
    lifecycle,
    regionDistributions,
    sourceAcquisitions,
    fieldModifications,
  });
  for (const column of columnIntents) {
    intents.push(column);
  }
  const dispersionIntents = buildDispersionIntents(nodes, edges, program, {
    placementFrame,
    lifecycle,
    regionDistributions,
    sourceAcquisitions,
    fieldModifications,
  });
  intents.push(...dispersionIntents);
  intents.push(...buildIlluminationIntents([...columnIntents, ...dispersionIntents], lifecycle));

  const nodeByIdForForces = new Map(nodes.map((node) => [node.nodeId, node]));
  const forceIntents = [];
  for (const force of nodes.filter((node) => node.nodeType === 'force_constraint')) {
    const fieldModification = findFieldModificationForForce(fieldModifications, force);
    const generatedBudget = levitationBudgetForForce(force, edges, program, nodeByIdForForces);
    const levitationVisual = levitationVisualForForce(force, generatedBudget);
    const regionOrigin = regionOriginForSeal(
      regionDistributions,
      sealKeyForNode(force.nodeId),
    );
    const active = forceConstraintRuntimeActive(force, fieldModification, lifecycle);
    forceIntents.push({
      intentType: 'force_constraint_debug',
      id: `intent:${force.nodeId}`,
      nodeId: force.nodeId,
      forceKind: force.forceKind,
      registryId: force.registryId,
      active,
      visual: Boolean(levitationVisual),
      visualPreset: levitationVisual?.visualPreset ?? null,
      visualShape: levitationVisual?.visualShape ?? null,
      materialKind: generatedBudget?.materialKind ?? null,
      materialFamily: generatedBudget ? materialFamilyForKind(generatedBudget.materialKind) : null,
      resourceBudget: generatedBudget,
      sourceRequired: false,
      sourcePolicy: generatedBudget ? 'source_free_sigil_generation' : null,
      physicsField: physicsFieldForForceConstraint({
        force,
        active,
        generatedBudget,
        placementFrame,
      }),
      regionOrigin,
      geometry: force.geometryBinding ?? null,
      metadata: {
        motionMode: force.motionMode ?? null,
        continuousStream: force.continuousStream === true,
        oneShotLaunch: force.oneShotLaunch === true,
        pullMode: force.pullMode ?? null,
        pullTwist: force.pullTwist ?? null,
        convergenceMode: fieldModification?.convergenceMode ?? force.convergenceMode ?? null,
        legacyConvergenceMode:
          force.registryId === 'sign.convergence' ? force.convergenceMode ?? null : null,
        fieldModification: fieldModification ?? force.geometryBinding?.fieldModification ?? null,
        targetFieldPolicy: fieldModification?.targetFieldPolicy ?? null,
        regionAffects: 'origin_only_when_region_present',
        regionApplication: regionOrigin,
        generatedResourceBudget: generatedBudget,
        outputShape: generatedBudget?.outputShape ?? null,
        budgetPolicy: generatedBudget?.budgetPolicy ?? null,
        visualDeferred: false,
        visual: levitationVisual,
      },
    });
  }
  intents.push(...forceIntents);
  intents.push(...physicsMotionIntents);
  const cleanupIntents = buildLifecycleCleanupIntents(
    [...columnIntents, ...dispersionIntents, ...forceIntents],
    lifecycle,
  );
  intents.push(...cleanupIntents);
  const modifierCleanupIntents = buildModifierCleanupIntents(materialStates, lifecycle);
  intents.push(...modifierCleanupIntents);
  intents.push(
    ...buildEffectLifecycleIntents({
      activeEffects: [
        ...materialStates,
        ...thermalMaterialIntents,
        ...materialReversionIntents,
        ...columnIntents,
        ...dispersionIntents,
        ...forceIntents,
        ...physicsMotionIntents,
      ],
      cleanupIntents,
      modifierCleanupIntents,
      lifecycle,
      effectLifecycle: options.effectLifecycle,
    }),
  );

  intents.push(
    ...nodes
      .filter((node) => node.nodeType === 'diagnostic_marker')
      .map((node) => ({
        intentType: 'diagnostic_marker',
        id: `intent:${node.nodeId}`,
        nodeId: node.nodeId,
        markerKind: node.markerKind,
        status: node.status ?? 'compiled_with_warnings',
        evidenceTier: node.evidenceTier ?? null,
        evidenceRefs: node.evidenceRefs ?? [],
        active: true,
        visibleByDefault: false,
      })),
  );
  intents.push(
    ...diagnostics.map((diagnostic) => ({
      intentType: 'diagnostic_marker',
      id: `intent:${diagnostic.id ?? diagnostic.code}`,
      diagnostic,
      markerKind: diagnostic.code,
      status: diagnostic.status ?? diagnostic.severity ?? 'unknown',
      evidenceTier: diagnostic.evidence ?? null,
      active: true,
      visibleByDefault: false,
    })),
  );

  return {
    version: SIMULATION_ENGINE_VERSION,
    ready: true,
    policy: { warningScopedEffects: 'animate_when_semantics_satisfied' },
    lifecycle,
    placementFrame,
    sceneState: normalizedScene,
    sourceStatus: sourceRequirements.sourceStatus,
    intents,
    summary: summarizeIntents(intents),
  };
}

/**
 * @param {object} force
 * @param {RuntimeIntent | null} fieldModification
 * @param {object} lifecycle
 */
function forceConstraintRuntimeActive(force, fieldModification, lifecycle) {
  if (force.registryId === 'sign.convergence') {
    return fieldModification?.active === true;
  }
  return lifecycle.active === true;
}

export function createSimulationEngine() {
  return {
    version: SIMULATION_ENGINE_VERSION,
    ready: true,
    systems: [
      'activation-lifecycle',
      'placement-frame',
      'source-availability',
      'source-acquisition',
      'effect-lifecycle-operations',
      'physics-motion-preview',
      'region-emergence',
      'crosshair-scope',
      'material-state',
      'material-reversion',
      'graph-intent-interpretation',
    ],
    interpretCompiledSpell,
  };
}

/**
 * @param {object | null} program
 * @param {object} activation
 */
function resolveActivationLifecycle(program, activation = {}) {
  const durationMs = Math.max(
    1,
    finite(activation.durationMs, DEFAULT_ACTIVATION_DURATION_MS),
  );
  const elapsedMs = Math.max(0, finite(activation.elapsedMs, 0));
  const mode = activation.mode ?? 'timed';
  const detectedOuterRingClosed = allOuterRingsClosed(program);
  const enforceOuterRing = activation.enforceOuterRing === true;
  const mechanicalCompleters = normalizeMechanicalCompleters(activation.mechanicalCompleters);
  const mechanicalCompletion = mechanicalCompleters.reduce(
    (maximum, completer) => Math.max(maximum, completer.completion),
    0,
  );
  const hasCompletionOverride = Number.isFinite(Number(activation.outerRingCompletion));
  const completionThreshold = 1;
  const manualCompletion = hasCompletionOverride
    ? clamp(roundNumber(Number(activation.outerRingCompletion), 4), 0, 1)
    : activation.outerRingClosed === false
      ? 0
      : enforceOuterRing
        ? detectedOuterRingClosed ? 1 : 0
        : 1;
  const outerRingCompletion = clamp(
    roundNumber(Math.max(manualCompletion, mechanicalCompletion), 4),
    0,
    1,
  );
  const completionClosed = outerRingCompletion >= completionThreshold;
  const outerRingClosed = hasCompletionOverride
    ? completionClosed
    : activation.outerRingClosed ??
      (enforceOuterRing ? detectedOuterRingClosed : true);
  const requestedActive = activation.active !== false;
  const timedStillRunning = mode !== 'timed' || elapsedMs < durationMs;
  const active = Boolean(requestedActive && outerRingClosed && timedStillRunning);
  const repetitionSymbols = repetitionSymbolsForProgram(program);
  const activeRepetitionSymbols = repetitionSymbols.filter(
    (symbol) => symbol.semanticEligibility === 'eligible',
  );
  const repetition = activeRepetitionSymbols.length > 0;

  return {
    active,
    mode,
    phase: !outerRingClosed ? 'dormant_open_ring' : active ? 'active' : 'ended',
    durationMs,
    elapsedMs,
    remainingMs: mode === 'timed' ? Math.max(0, durationMs - elapsedMs) : null,
    requestedActive,
    outerRingClosed,
    outerRingCompletion,
    outerRingCompletionThreshold: completionThreshold,
    ringBreakAmount: roundNumber(1 - outerRingCompletion, 4),
    activationCircuitState: outerRingClosed ? 'complete' : 'incomplete',
    activationCircuitPolicy: 'outer_ring_completion_threshold',
    mechanicalCompletionReady: true,
    mechanicalCompletion,
    mechanicalCompleters,
    activationCompletionSource:
      mechanicalCompletion >= completionThreshold
        ? 'mechanical_completer'
        : hasCompletionOverride
          ? 'manual_completion'
          : enforceOuterRing
            ? 'detected_ring_geometry'
            : 'default_closed',
    detectedOuterRingClosed,
    enforceOuterRing,
    activationGate: 'outer_ring_closed',
    canonicalTrigger: 'complete_outer_ring',
    repetition,
    repetitionSymbolCount: repetitionSymbols.length,
    activeRepetitionSymbolCount: activeRepetitionSymbols.length,
    repetitionPolicy:
      repetitionSymbols.length > 0 && activeRepetitionSymbols.length === 0
        ? 'diagnostic_only_no_lifecycle_extension'
        : repetition
          ? 'active_repetition_extends_lifecycle'
          : 'none',
    nonRepetitionStopsActiveEffects: !repetition,
    generatedMaterialMayRemain: true,
  };
}

/**
 * @param {object[]} completers
 */
function normalizeMechanicalCompleters(completers = []) {
  if (!Array.isArray(completers)) return [];
  return completers
    .filter((completer) => completer && typeof completer === 'object')
    .map((completer, index) => {
      const completion = clamp(roundNumber(finite(completer.completion, 0), 4), 0, 1);
      return {
        id: completer.id ?? `mechanical-completer:${index}`,
        propId: completer.propId ?? completer.id ?? null,
        role: completer.role ?? 'activation_ring_mechanical_key',
        completion,
        seated: completion >= 1,
        distanceToGap:
          Number.isFinite(Number(completer.distanceToGap))
            ? roundNumber(Number(completer.distanceToGap), 4)
            : null,
        keyPosition: completer.keyPosition
          ? normalizePosition(completer.keyPosition, { x: 0, y: 0, z: 0 })
          : null,
        gapPosition: completer.gapPosition
          ? normalizePosition(completer.gapPosition, { x: 0, y: 0, z: 0 })
          : null,
        completionPolicy: completer.completionPolicy ?? 'distance_to_outer_ring_gap',
      };
    });
}

/**
 * @param {object} lifecycle
 */
function buildSpellActivationIntent(lifecycle) {
  return {
    intentType: 'spell_activation',
    id: 'intent:spell-activation',
    active: lifecycle.active,
    lifecycle,
    stopsActiveEffectsOnEnd: lifecycle.nonRepetitionStopsActiveEffects,
    leftoverPolicy: lifecycle.generatedMaterialMayRemain
      ? 'generated_material_may_remain'
      : 'dispose_all',
  };
}

/**
 * @param {object} lifecycle
 */
function buildActivationCircuitIntent(lifecycle) {
  const completion = finite(lifecycle.outerRingCompletion, lifecycle.outerRingClosed ? 1 : 0);
  const threshold = finite(lifecycle.outerRingCompletionThreshold, 1);
  return {
    intentType: 'activation_circuit',
    id: 'intent:activation-circuit:outer-ring',
    active: true,
    circuitKind: 'outer_ring',
    activationGate: lifecycle.activationGate,
    canonicalTrigger: lifecycle.canonicalTrigger,
    completion,
    completionPercent: Math.round(completion * 100),
    completionThreshold: threshold,
    closed: lifecycle.outerRingClosed === true,
    circuitState: lifecycle.activationCircuitState,
    breakAmount: finite(lifecycle.ringBreakAmount, 0),
    dormantWhenIncomplete: true,
    mechanicalCompletionReady: lifecycle.mechanicalCompletionReady === true,
    mechanicalCompletion: finite(lifecycle.mechanicalCompletion, 0),
    mechanicalCompleters: lifecycle.mechanicalCompleters ?? [],
    completionSource: lifecycle.activationCompletionSource,
    controlPolicy: 'complete_or_break_outer_ring_segment',
    interactionAffordance: completion >= threshold
      ? 'break_outer_ring'
      : 'complete_outer_ring',
    reason: lifecycle.outerRingClosed
      ? 'outer_ring_complete'
      : 'outer_ring_incomplete_dormant',
  };
}

function buildEffectOrderIntent() {
  return {
    intentType: 'effect_order_debug',
    id: 'intent:effect-order',
    active: true,
    fixedPhaseOrder: EFFECT_PHASE_ORDER,
    runtimePrelude: [
      {
        phase: 'activation_lifecycle',
        intentTypes: ['spell_activation', 'activation_circuit'],
      },
      {
        phase: 'placement_frame',
        intentTypes: ['placement_frame', 'spell_circle_render_data'],
      },
    ],
    intentTypePhases: [
      {
        intentTypes: ['placement_frame', 'spell_circle_render_data'],
        phaseIndex: 1,
        phase: 'geometry_ring_ownership',
      },
      {
        intentTypes: ['region_emergence', 'targeting_debug', 'source_requirement'],
        phaseIndex: 3,
        phase: 'targeting_source_operators',
        note: 'Region is discovered as targeting grammar here, then applied to output emergence in phase 7.',
      },
      {
        intentTypes: ['source_binding', 'source_acquisition'],
        phaseIndex: 4,
        phase: 'source_budget',
      },
      {
        intentTypes: ['material_state', 'thermal_material_state'],
        phaseIndex: 5,
        phase: 'transforms_state_modifiers',
      },
      {
        intentTypes: [
          'field_modification',
          'water_column',
          'material_column',
          'water_dispersion',
          'material_dispersion',
          'force_constraint_debug',
        ],
        phaseIndex: 6,
        phase: 'shape_output_operators',
      },
      {
        intentTypes: ['water_column', 'material_column', 'water_dispersion', 'material_dispersion'],
        phaseIndex: 7,
        phase: 'region_emergence_placement',
        note: 'Outputs carry emergence anchors/budget shares after shape resolution.',
      },
      {
        intentTypes: ['physics_motion'],
        phaseIndex: 8,
        phase: 'physics_material_simulation',
      },
      {
        intentTypes: ['lifecycle_cleanup', 'modifier_cleanup', 'effect_lifecycle'],
        phaseIndex: 9,
        phase: 'lifecycle_cleanup_leftovers',
        note: 'Lifecycle operation intents provide render-neutral start/update/stop/dispose hooks after semantic intents are resolved.',
      },
    ],
    deterministic: true,
    regionDiscoveryPhase: 'targeting_source_operators',
    regionApplicationPhase: 'region_emergence_placement',
  };
}

/**
 * @param {object} frame
 */
function buildPlacementFrameIntent(frame) {
  return {
    intentType: 'placement_frame',
    id: 'intent:placement-frame',
    active: true,
    frame,
    placementMode: frame.placementMode,
    surfaceMode: frame.surfaceMode,
    surfaceTargetId: frame.surfaceTargetId,
    surfaceLabel: frame.surfaceLabel,
    coordinateSpace: 'spell_local_plane',
    emergenceNormal: frame.normal,
    worldScale: frame.worldScale,
    localAxes: {
      x: frame.tangent,
      y: frame.bitangent,
      z: frame.normal,
    },
  };
}

/**
 * @param {object | null} program
 */
function allOuterRingsClosed(program) {
  const seals = program?.seals ?? [];
  if (seals.length === 0) return true;
  return seals.every((seal) => {
    const rings = seal.rings ?? [];
    if (rings.length === 0) return true;
    const outer = [...rings].sort((a, b) => finite(b.radius, 0) - finite(a.radius, 0))[0];
    return !['open', 'broken', 'incomplete'].includes(String(outer?.closureState ?? 'closed'));
  });
}

/**
 * @param {object | null} program
 */
function repetitionSymbolsForProgram(program) {
  return (program?.seals ?? []).flatMap((seal) =>
    (seal.symbols ?? []).filter((symbol) =>
      ['sign.repetition', 'sigil.repetition'].includes(
        symbol.resolvedRegistryId ?? symbol.registryCandidate,
      ),
    ),
  );
}

/**
 * @param {object | undefined} frame
 */
function normalizePlacementFrame(frame = {}) {
  const normal = normalizeSceneVector(frame.normal ?? DEFAULT_PLACEMENT_FRAME.normal);
  const requestedTangent = normalizeSceneVector(
    frame.tangent ?? DEFAULT_PLACEMENT_FRAME.tangent,
  );
  const tangentProjection = subtractVector(
    requestedTangent,
    scaleVector(normal, dotVector(requestedTangent, normal)),
  );
  const tangent =
    vectorLength(tangentProjection) > 0.000001
      ? normalizeSceneVector(tangentProjection)
      : fallbackTangentForNormal(normal);
  const bitangent = normalizeSceneVector(crossVector(normal, tangent));

  return {
    origin: normalizePosition(frame.origin, DEFAULT_PLACEMENT_FRAME.origin),
    normal,
    tangent,
    bitangent,
    worldScale: clamp(finite(frame.worldScale, 1), 0.25, 4),
    placementMode: frame.placementMode ?? (frame.surfaceMode === 'ground' ? 'ground_plane' : 'surface'),
    surfaceMode: frame.surfaceMode ?? null,
    surfaceTargetId: frame.surfaceTargetId ?? null,
    surfaceLabel: frame.surfaceLabel ?? null,
  };
}

/**
 * @param {{ x: number; y: number; z: number }} normal
 */
function fallbackTangentForNormal(normal) {
  const reference = Math.abs(normal.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  return normalizeSceneVector(crossVector(reference, normal));
}

/**
 * @param {object} frame
 * @param {{ x?: number; y?: number; z?: number }} local
 */
function localToScene(frame, local) {
  const worldScale = clamp(finite(frame.worldScale, 1), 0.25, 4);
  return addVector(
    frame.origin,
    addVector(
      addVector(
        scaleVector(frame.tangent, finite(local.x, 0) * worldScale),
        scaleVector(frame.bitangent, finite(local.y, 0) * worldScale),
      ),
      scaleVector(frame.normal, finite(local.z, 0) * worldScale),
    ),
  );
}

/**
 * @param {object} frame
 * @param {{ x?: number; y?: number; z?: number }} scenePosition
 */
function sceneToLocal(frame, scenePosition) {
  const delta = subtractVector(scenePosition, frame.origin);
  const worldScale = clamp(finite(frame.worldScale, 1), 0.25, 4);
  return {
    x: dotVector(delta, frame.tangent) / worldScale,
    y: dotVector(delta, frame.bitangent) / worldScale,
    z: dotVector(delta, frame.normal) / worldScale,
  };
}

/**
 * @param {object} frame
 * @param {{ x?: number; y?: number; z?: number }} local
 */
function localDirectionToScene(frame, local) {
  return normalizeSceneVector(
    addVector(
      addVector(
        scaleVector(frame.tangent, finite(local.x, 0)),
        scaleVector(frame.bitangent, finite(local.y, 0)),
      ),
      scaleVector(frame.normal, finite(local.z, 0)),
    ),
  );
}

/**
 * @param {object[]} nodes
 * @param {object[]} edges
 * @param {SceneState} sceneState
 * @param {RuntimeIntent[]} sourceAcquisitions
 * @param {object} lifecycle
 */
function buildSourceRequirements(
  nodes,
  edges,
  sceneState,
  sourceAcquisitions = [],
  lifecycle = { active: true, phase: 'active' },
) {
  /** @type {Map<string, object>} */
  const byDomainNodeId = new Map();
  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));
  for (const node of nodes) {
    if (node.nodeType === 'domain') {
      byDomainNodeId.set(node.nodeId, node);
    }
  }

  const sourceStatus = buildSourceStatus(sceneState);

  /** @type {RuntimeIntent[]} */
  const requirements = [];
  /** @type {RuntimeIntent[]} */
  const bindings = [];

  for (const [domainNodeId, domain] of byDomainNodeId.entries()) {
    const materialKind = materialKindForDomain(domain.registryId ?? domain.domain);
    if (!materialKind) continue;

    const sourceRequiredEdges = edges.filter(
      (edge) =>
        edge.edgeType === 'requires' &&
        edge.toNodeId === domainNodeId &&
        isSourceRequiringNode(nodeById.get(edge.fromNodeId)),
    );

    for (const edgeRecord of sourceRequiredEdges) {
      const operator = nodeById.get(edgeRecord.fromNodeId);
      const acquisition = sourceAcquisitions.find(
        (item) => item.operatorNodeId === operator?.nodeId,
      );
      const sourceMode = sourceModeForOperator(operator);
      const requiredAmount =
        acquisition?.requiredAmount ??
        requiredAmountForSourceOperator(operator, domain, [], nodes);
      const satisfied = acquisition ? acquisition.satisfied : false;
      const limited = acquisition ? acquisition.limited : false;
      const requirementId = `source-requirement:${operator?.nodeId ?? domainNodeId}`;

      requirements.push({
        intentType: 'source_requirement',
        id: requirementId,
        nodeId: domainNodeId,
        operatorNodeId: operator?.nodeId ?? null,
        materialKind,
        materialFamily: materialFamilyForKind(materialKind),
        registryId: domain.registryId,
        sourceMode,
        requiredAmount,
        satisfied,
        limited,
        active: lifecycle.active,
        reason: lifecycle.active
          ? satisfied
            ? null
            : acquisition?.reason ?? `No compatible ${materialKind} source could satisfy ${sourceMode}`
          : lifecycle.phase,
      });

      for (const match of acquisition?.matches ?? []) {
        const source = sourceStatus.find((item) => item.id === match.sourceId);
        if (!source) continue;
        bindings.push({
          intentType: 'source_binding',
          id: `source-binding:${operator?.nodeId ?? domainNodeId}:${source.id}`,
          requirementId,
          nodeId: domainNodeId,
          operatorNodeId: operator?.nodeId ?? null,
          sourceId: source.id,
          materialKind,
          sourceMode,
          amount: source.amount,
          acquiredAmount: match.acquiredAmount,
          capacity: source.capacity,
          nonDepleting: source.nonDepleting,
          fillRatio: source.fillRatio,
          active: lifecycle.active && match.selected === true && satisfied,
        });
      }
    }
  }

  for (const phase of nodes.filter((node) => node.nodeType === 'phase_state')) {
    const materialKind = phase.targetMaterial ?? materialKindForDomain(phase.registryId);
    if (!materialKind) continue;
    if (requirements.some((requirement) => requirement.materialKind === materialKind)) {
      continue;
    }

    const requiredAmount = 8;
    const compatibleSources = sourceStatus.filter((source) =>
      compatibleMaterialFamily(
        materialFamilyForKind(materialKind),
        source.materialFamily ?? materialFamilyForKind(source.kind),
      ),
    );
    const availableSources = compatibleSources.filter(
      (source) => source.nonDepleting || finite(source.amount, 0) > 0,
    );
    const satisfied = availableSources.length > 0;
    const limited = Boolean(
      availableSources.some(
        (source) =>
          !source.nonDepleting &&
          finite(source.amount, 0) > 0 &&
          finite(source.amount, 0) < requiredAmount,
      ),
    );
    const requirementId = `source-requirement:${phase.nodeId}`;

    requirements.push({
      intentType: 'source_requirement',
      id: requirementId,
      nodeId: phase.nodeId,
      materialKind,
      registryId: phase.registryId,
      sourceMode: 'target_material_state',
      requiredAmount,
      satisfied,
      limited,
      active: lifecycle.active,
      reason: lifecycle.active
        ? satisfied ? null : `No available ${materialKind} source in the scene`
        : lifecycle.phase,
    });

    for (const source of compatibleSources) {
      const active = source.nonDepleting || finite(source.amount, 0) > 0;
      bindings.push({
        intentType: 'source_binding',
        id: `source-binding:${phase.nodeId}:${source.id}`,
        requirementId,
        nodeId: phase.nodeId,
        sourceId: source.id,
        materialKind,
        sourceMode: 'target_material_state',
        amount: source.amount,
        capacity: source.capacity,
        nonDepleting: source.nonDepleting,
        fillRatio: source.fillRatio,
        active: lifecycle.active && active,
      });
    }
  }

  const bindingByNodeId = new Map();
  for (const binding of bindings) {
    if (!bindingByNodeId.has(binding.nodeId)) {
      bindingByNodeId.set(binding.nodeId, binding);
    }
  }

  return {
    sourceStatus,
    requirements,
    bindings,
    requirementByNodeId: new Map(requirements.map((item) => [item.nodeId, item])),
    bindingByNodeId,
  };
}

/**
 * @param {SceneState} sceneState
 */
function buildSourceStatus(sceneState) {
  return sceneState.sources.map((source) => ({
    ...source,
    materialFamily: source.materialFamily ?? materialFamilyForKind(source.kind),
    available: source.nonDepleting || source.amount > 0,
    fillRatio:
      source.nonDepleting || source.capacity <= 0
        ? 1
        : clamp(source.amount / source.capacity, 0, 1),
  }));
}

/**
 * @param {object | undefined} node
 */
function isSourceRequiringNode(node) {
  if (!node) return false;
  if (node.nodeType === 'source_mode') {
    return ['collect_nearby', 'gather_active'].includes(node.mode);
  }
  if (node.nodeType === 'force_constraint') {
    return node.signRole === 'pull' || node.registryId === 'sign.pull';
  }
  return false;
}

/**
 * @param {object | undefined} operator
 */
function sourceModeForOperator(operator) {
  if (!operator) return 'source_required';
  if (operator.nodeType === 'source_mode') return operator.mode ?? 'source_required';
  if (operator.registryId === 'sign.pull') return operator.pullMode ?? operator.forceKind ?? 'pull';
  return 'source_required';
}

/**
 * @param {object[]} nodes
 * @param {object[]} edges
 * @param {SceneState} sceneState
 * @param {object | null} program
 * @param {object} placementFrame
 * @param {object} lifecycle
 * @param {RuntimeIntent[]} regionDistributions
 */
function buildSourceAcquisitionIntents(
  nodes,
  edges,
  sceneState,
  program,
  placementFrame,
  lifecycle,
  regionDistributions = [],
) {
  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));
  const sources = buildSourceStatus(sceneState);
  const remainingFiniteAmountBySourceId = new Map(
    sources
      .filter((source) => source.nonDepleting !== true)
      .map((source) => [source.id, Math.max(0, finite(source.amount, 0))]),
  );
  const props = sceneState.props ?? [];
  const symbolIndex = indexSymbols(program);
  const intents = [];

  for (const operator of nodes.filter(isSourceRequiringNode)) {
    const operatorSealKey = sealKeyForNode(operator.nodeId);
    const domainEdge = edges.find(
      (edge) => edge.edgeType === 'requires' && edge.fromNodeId === operator.nodeId,
    );
    const domain = domainEdge ? nodeById.get(domainEdge.toNodeId) : null;
    const sourceMode = sourceModeForOperator(operator);
    const domainRegistryId = domain?.registryId ?? operator.fromDomain ?? null;
    const materialKind = materialKindForDomain(domainRegistryId);
    const materialFamily = materialFamilyForKind(materialKind);
    const requiredAmount = requiredAmountForSourceOperator(operator, domain, edges, nodes);
    const reach = reachForOperator(operator, symbolIndex);
    const pullCapacity = pullCapacityForOperator(operator, symbolIndex);
    const regionOrigin = regionOriginForSeal(regionDistributions, operatorSealKey);
    const sourceFieldFrames = sourceOperatorFramesForOrigin(placementFrame, regionOrigin);
    const primarySourceFieldFrame = sourceFieldFrames[0] ?? sourceOperatorFramesForOrigin(placementFrame, null)[0];
    const acquisitionCapacity = acquisitionCapacityForSourceOperator(
      operator,
      requiredAmount,
      pullCapacity,
    );
    const candidates = candidatesForSourceMode(sourceMode, materialFamily, sources, props)
      .map((candidate) => {
        if (candidate.candidateType !== 'source' || candidate.nonDepleting === true) {
          return candidate;
        }
        return {
          ...candidate,
          amount: remainingFiniteAmountBySourceId.get(candidate.id) ?? 0,
        };
      })
      .map((candidate) =>
        evaluateSourceCandidate(candidate, {
          sourceMode,
          materialFamily,
          reach,
          pullCapacity,
          placementFrames: sourceFieldFrames,
        }),
      );
    const compatible = orderSourceCandidates(
      candidates.filter(
        (candidate) =>
          candidate.compatibleFamily &&
          candidate.withinReach &&
          candidate.canPull &&
          candidate.availableAmount > 0,
      ),
      sourceMode,
    );
    const spendsGatheredMaterial =
      sourceMode === 'gather_active' && ['water', 'earth'].includes(materialFamily);
    let remaining = acquisitionCapacity;
    const matches = compatible.map((candidate) => {
      const potentialAcquiredAmount =
        sourceMode === 'collect_nearby'
          ? collectionAffectedAmount(candidate, requiredAmount)
          : candidate.nonDepleting
            ? remaining
            : Math.min(candidate.availableAmount, remaining);
      const acquiredAmount = lifecycle.active ? potentialAcquiredAmount : 0;
      if (sourceMode !== 'collect_nearby') {
        remaining = Math.max(0, remaining - potentialAcquiredAmount);
      }
      const spendAmount =
        lifecycle.active &&
        spendsGatheredMaterial &&
        candidate.candidateType === 'source' &&
        candidate.nonDepleting !== true
          ? acquiredAmount
          : 0;
      return {
        sourceId: candidate.id,
        candidateType: candidate.candidateType,
        candidateKind: candidate.kind,
        label: candidate.label ?? candidate.id,
        visualKind: candidate.visualKind ?? candidate.kind,
        targetRole: candidate.targetRole ?? null,
        materialFamily: candidate.materialFamily,
        materialState: candidate.materialState ?? candidate.kind,
        position: candidate.position ?? null,
        selected: acquiredAmount > 0,
        acquiredAmount,
        potentialAcquiredAmount,
        distance: candidate.distance,
        distancePolicy: candidate.distancePolicy,
        distanceOriginPolicy: candidate.distanceOriginPolicy,
        sourceFieldOriginId: candidate.sourceFieldOriginId ?? null,
        sourceFieldOrigin: candidate.sourceFieldOrigin ?? null,
        pullDifficulty: candidate.pullDifficulty,
        pullDifficultyBreakdown: candidate.pullDifficultyBreakdown,
        availableAmount: candidate.availableAmount,
        sourceSpendPolicy:
          spendAmount > 0
            ? 'deplete_finite_source_on_gather_handoff'
            : candidate.nonDepleting
              ? 'non_depleting_source_preserved'
              : 'preview_or_motion_only',
        spendsSourceAmount: spendAmount > 0,
        spendAmount,
      };
    });
    const acquiredAmount = matches.reduce((sum, match) => sum + match.acquiredAmount, 0);
    for (const match of matches) {
      if (match.spendAmount <= 0) continue;
      const remaining = remainingFiniteAmountBySourceId.get(match.sourceId) ?? 0;
      remainingFiniteAmountBySourceId.set(
        match.sourceId,
        Math.max(0, remaining - match.spendAmount),
      );
    }
    const satisfied =
      lifecycle.active &&
      (acquiredAmount >= requiredAmount ||
        matches.some((match) => match.selected && requiredAmount <= 0));
    const limited = acquiredAmount > 0 && acquiredAmount < requiredAmount;
    const sourceBudgetLimited = acquiredAmount > 0 && acquiredAmount < acquisitionCapacity;
    const reason = satisfied
      ? null
      : lifecycle.active
        ? sourceAcquisitionFailureReason(candidates, sourceMode, materialFamily)
        : lifecycle.phase;

    intents.push({
      intentType: 'source_acquisition',
      id: `source-acquisition:${operator.nodeId}`,
      operatorNodeId: operator.nodeId,
      sealKey: operatorSealKey,
      domainNodeId: domain?.nodeId ?? null,
      sourceMode,
      signRole: operator.signRole ?? (operator.registryId === 'sign.pull' ? 'pull' : null),
      materialKind,
      materialFamily,
      materialCompatibilityPolicy: sourceMaterialCompatibilityPolicy(sourceMode, materialFamily),
      sourceContentPolicy: sourceContentPolicyForMode(sourceMode, materialFamily),
      sourceCapacityPolicy: sourceCapacityPolicyForMode(sourceMode, materialFamily, {
        requiredAmount,
        acquisitionCapacity,
        reach,
        pullCapacity,
        reachPolicy: primarySourceFieldFrame.reachPolicy,
        originPolicy: primarySourceFieldFrame.originPolicy,
        originCount: sourceFieldFrames.length,
      }),
      requiredAmount,
      acquisitionCapacity,
      acquiredAmount,
      satisfied,
      limited,
      sourceBudgetLimited,
      active: lifecycle.active,
      reason,
      reach,
      pullCapacity,
      sourceFieldOrigin: primarySourceFieldFrame.origin,
      sourceFieldOriginPolicy: primarySourceFieldFrame.originPolicy,
      sourceFieldOrigins: sourceFieldFrames.map(sourceFieldOriginRecord),
      reachPolicy: primarySourceFieldFrame.reachPolicy,
      regionOrigin,
      originPolicy: regionOrigin
        ? 'region_anchor_origin_modifier'
        : 'spell_placement_frame_origin',
      matches,
      rejectedCandidates: candidates
        .filter((candidate) => !matches.some((match) => match.sourceId === candidate.id))
        .map((candidate) => ({
          sourceId: candidate.id,
          candidateKind: candidate.kind,
          label: candidate.label ?? candidate.id,
          visualKind: candidate.visualKind ?? candidate.kind,
          targetRole: candidate.targetRole ?? null,
          compatibleFamily: candidate.compatibleFamily,
          withinReach: candidate.withinReach,
          movable: candidate.movable,
          canPull: candidate.canPull,
          distance: candidate.distance,
          distancePolicy: candidate.distancePolicy,
          distanceOriginPolicy: candidate.distanceOriginPolicy,
          sourceFieldOriginId: candidate.sourceFieldOriginId ?? null,
          sourceFieldOrigin: candidate.sourceFieldOrigin ?? null,
          reach: candidate.reach,
          pullCapacity: candidate.pullCapacity,
          pullDifficulty: candidate.pullDifficulty,
          pullDifficultyBreakdown: candidate.pullDifficultyBreakdown,
          availableAmount: candidate.availableAmount,
          reason: candidate.rejectionReason,
        })),
      feedsDownstream:
        sourceMode === 'gather_active' &&
        ['water', 'earth'].includes(materialFamily) &&
        acquiredAmount > 0,
      downstreamHandoffScope:
        sourceMode === 'gather_active' && ['water', 'earth'].includes(materialFamily)
          ? 'same_seal_phase1'
          : 'none',
      collectionFeedsDownstream: false,
      sourceSpendPolicy:
        spendsGatheredMaterial && acquiredAmount > 0
          ? 'deplete_finite_sources_for_gather_handoff'
          : 'no_source_depletion',
      sourceSpends: matches
        .filter((match) => match.spendAmount > 0)
        .map((match) => ({
          sourceId: match.sourceId,
          spendAmount: match.spendAmount,
          materialFamily: match.materialFamily,
          materialState: match.materialState,
          policy: match.sourceSpendPolicy,
        })),
      creationAssumption: 'no_creation',
      sourceSelectionRule:
        sourceMode === 'collect_nearby'
          ? 'all_movable_reachable_within_pull_capacity'
          : sourceMode === 'pull' || sourceMode === 'push'
            ? 'compatible_material_or_object_in_field'
            : 'compatible_family_in_range',
      candidateSelection:
        sourceMode === 'pull' || sourceMode === 'push'
          ? 'compatible_material_or_object_in_field'
          : sourceMode === 'collect_nearby'
            ? 'all_material_families_movable_reachable_with_capacity_check'
            : 'compatible_material_in_range',
      capacityPolicy:
        sourceMode === 'collect_nearby'
          ? 'collection_checks_mobility_reach_mass_cohesion_phase_distance'
          : 'pull_difficulty_must_not_exceed_operator_capacity',
      sourceSelectionOrder:
        sourceMode === 'collect_nearby'
          ? 'scene_order_after_reach_mobility_capacity_filter'
          : 'nearest_reachable_lowest_difficulty_first',
    });
  }

  return intents;
}

/**
 * @param {object[]} sourceAcquisitions
 * @param {SceneState} sceneState
 * @param {object} placementFrame
 * @param {object} lifecycle
 * @param {Record<string, { x?: number; y?: number; z?: number }> | Map<string, { x?: number; y?: number; z?: number }>} [motionBaselines]
 */
function buildPhysicsMotionIntents(sourceAcquisitions, sceneState, placementFrame, lifecycle, motionBaselines) {
  const candidates = new Map([
    ...buildSourceStatus(sceneState).map((source) => [source.id, source]),
    ...(sceneState.props ?? []).map((prop) => [prop.id, prop]),
  ]);
  const spellOrigin = localToScene(placementFrame, { x: 0, y: 0, z: 0.16 });
  const motionDurationMs = Math.max(1, finite(lifecycle.durationMs, DEFAULT_ACTIVATION_DURATION_MS));
  const motionProgress = lifecycle.active
    ? clamp(roundNumber(finite(lifecycle.elapsedMs, 0) / motionDurationMs, 4), 0, 1)
    : 0;
  const intents = [];

  for (const acquisition of sourceAcquisitions) {
    for (const match of acquisition.matches ?? []) {
      if (!match.selected || match.acquiredAmount <= 0) continue;
      const candidate = candidates.get(match.sourceId);
      if (!candidate) continue;
      const motionId = `physics-motion:${acquisition.operatorNodeId}:${match.sourceId}`;
      const baselinePosition = motionBaselinePosition(
        motionBaselines,
        motionId,
        match.sourceId,
        candidate.position ?? { x: 0, y: 0, z: 0 },
      );
      const fromPosition = addVector(
        baselinePosition,
        scaleVector(placementFrame.normal, 0.18),
      );
      const regionMotionOrigin =
        match.distanceOriginPolicy === 'region_anchor_origin_modifier'
          ? match.sourceFieldOrigin
          : null;
      const motionOrigin =
        regionMotionOrigin ??
        (acquisition.sourceFieldOriginPolicy === 'region_anchor_origin_modifier'
          ? acquisition.sourceFieldOrigin
          : null) ??
        spellOrigin;
      const toPosition = motionTargetForAcquisition(acquisition, fromPosition, motionOrigin);
      const pullDifficulty = finite(match.pullDifficulty, 0);
      const motionRatio =
        pullDifficulty <= 0
          ? 1
          : clamp(roundNumber(acquisition.pullCapacity / pullDifficulty, 4), 0, 1);
      const currentPosition = interpolateVector(fromPosition, toPosition, motionProgress);
      const currentObjectPosition = interpolateVector(
        baselinePosition,
        toPosition,
        motionProgress,
      );

      intents.push({
        intentType: 'physics_motion',
        id: motionId,
        sourceAcquisitionId: acquisition.id,
        operatorNodeId: acquisition.operatorNodeId,
        sourceId: match.sourceId,
        candidateType: match.candidateType ?? candidate.candidateType ?? 'source',
        candidateKind: match.candidateKind ?? candidate.kind,
        sourceMode: acquisition.sourceMode,
        signRole: acquisition.signRole,
        materialKind: acquisition.materialKind,
        materialFamily: acquisition.materialFamily,
        materialState: match.materialState ?? candidate.materialState ?? candidate.kind,
        active: lifecycle.active,
        simulationPhase: 'physics_material_simulation',
        motionKind: motionKindForAcquisition(acquisition),
        originPolicy: acquisition.originPolicy ?? 'spell_placement_frame_origin',
        regionOrigin: acquisition.regionOrigin ?? null,
        sourceFieldOrigin: match.sourceFieldOrigin ?? acquisition.sourceFieldOrigin ?? null,
        sourceFieldOriginId: match.sourceFieldOriginId ?? null,
        sourceFieldOriginPolicy:
          match.distanceOriginPolicy ?? acquisition.sourceFieldOriginPolicy ?? null,
        fromPosition,
        baselinePosition,
        toPosition,
        currentPosition,
        currentObjectPosition,
        motionProgress,
        motionDurationMs,
        motionTimingPolicy: 'lifecycle_elapsed_progress',
        distance: roundNumber(vectorLength(subtractVector(fromPosition, toPosition)), 3),
        distancePolicy: 'placement_frame_3d_distance',
        acquiredAmount: roundNumber(match.acquiredAmount, 3),
        pullDifficulty,
        pullCapacity: acquisition.pullCapacity,
        motionRatio,
        mass: finite(candidate.mass, defaultMassForSource(candidate.kind, candidate.amount)),
        cohesion: finite(candidate.cohesion, defaultCohesionForKind(candidate.kind)),
        phaseResistance: finite(
          candidate.phaseResistance,
          defaultPhaseResistanceForState(candidate.materialState ?? candidate.kind),
        ),
        physicsField: {
          active: lifecycle.active,
          fieldShape: 'target_force',
          targetId: match.sourceId,
          direction: normalizeSceneVector(subtractVector(toPosition, baselinePosition)),
          forceMagnitude: roundNumber(
            clamp(finite(acquisition.pullCapacity, 0) * Math.max(0.25, motionRatio) * 1.5, 0, 180),
            4,
          ),
          applicationMode: 'center_of_mass',
          targetFilter: 'selected_existing_movable_target',
          forceModel: 'bounded_pull_capacity',
          simulationPhase: 'physics_material_simulation',
          tuningAuthority: 'project_supported_physics_adapter',
        },
        feedsDownstream: acquisition.feedsDownstream === true,
        movesActualSceneObject: (match.candidateType ?? candidate.candidateType) === 'prop',
        reservoirPreviewOnly: (match.candidateType ?? candidate.candidateType) === 'source',
        conservationPolicy: 'no_creation_selected_source_budget',
      });
    }
  }

  return intents;
}

/**
 * @param {object} acquisition
 * @param {{ x: number; y: number; z: number }} fromPosition
 * @param {{ x: number; y: number; z: number }} spellOrigin
 */
function motionTargetForAcquisition(acquisition, fromPosition, spellOrigin) {
  if (acquisition.sourceMode === 'push' || acquisition.signRole === 'push') {
    const away = normalizeSceneVector(subtractVector(fromPosition, spellOrigin));
    const distance = Math.max(0.6, finite(acquisition.reach, 1) * 0.45);
    return addVector(fromPosition, scaleVector(away, distance));
  }
  return spellOrigin;
}

/**
 * @param {object} acquisition
 */
function motionKindForAcquisition(acquisition) {
  if (acquisition.sourceMode === 'gather_active') return 'resource_intake_to_spell_origin';
  if (acquisition.sourceMode === 'collect_nearby') return 'area_collection_to_spell_origin';
  if (acquisition.sourceMode === 'push' || acquisition.signRole === 'push') return 'push_field_motion';
  if (acquisition.sourceMode === 'pull' || acquisition.signRole === 'pull') return 'pull_field_motion';
  return 'source_to_spell_origin';
}

/**
 * @param {Record<string, { x?: number; y?: number; z?: number }> | Map<string, { x?: number; y?: number; z?: number }> | undefined} baselines
 * @param {string} motionId
 * @param {string} sourceId
 * @param {{ x?: number; y?: number; z?: number }} fallback
 */
function motionBaselinePosition(baselines, motionId, sourceId, fallback) {
  const raw =
    baselines instanceof Map
      ? baselines.get(motionId) ?? baselines.get(sourceId)
      : baselines?.[motionId] ?? baselines?.[sourceId];
  return normalizePosition(raw, normalizePosition(fallback, { x: 0, y: 0, z: 0 }));
}

/**
 * @param {object | undefined} operator
 * @param {object | undefined | null} domain
 * @param {object[]} incoming
 * @param {object[]} nodes
 */
function requiredAmountForSourceOperator(operator, domain, incoming, nodes) {
  if (!operator) return domain ? requiredAmountForDomain(domain, incoming, nodes) : 1;
  if (operator.nodeType === 'source_mode') {
    const activePull = finite(operator.geometryBinding?.materialIntake?.activePull, 0);
    if (operator.mode === 'gather_active') return Math.max(6, Math.round(activePull * 6));
    return 4;
  }
  if (operator.registryId === 'sign.pull') {
    return Math.max(1, Math.round(finite(operator.geometryBinding?.biasMagnitude, 1) * 4));
  }
  return domain ? requiredAmountForDomain(domain, incoming, nodes) : 1;
}

/**
 * @param {object | undefined} operator
 * @param {number} requiredAmount
 * @param {number} pullCapacity
 */
function acquisitionCapacityForSourceOperator(operator, requiredAmount, pullCapacity) {
  if (operator?.nodeType === 'source_mode' && operator.mode === 'gather_active') {
    return Math.max(requiredAmount, Math.round(pullCapacity));
  }
  return requiredAmount;
}

/**
 * @param {object} operator
 * @param {Map<string, object>} symbolIndex
 */
function reachForOperator(operator, symbolIndex) {
  const sourceSymbols = (operator.sourceObjects ?? [])
    .map((source) => symbolIndex.get(source.objectId))
    .filter(Boolean);
  const signSize =
    average(sourceSymbols.map((symbol) => symbol.geometry?.size).filter(isFiniteNumber)) ??
    DEFAULT_SIGN_SIZE;
  const baseReach = Math.max(2.4, signSize / 85);
  if (operator.mode === 'collect_nearby') return baseReach * 0.85;
  if (operator.mode === 'gather_active') return baseReach * 1.15;
  if (operator.registryId === 'sign.pull') return baseReach * 1.35;
  return baseReach;
}

/**
 * @param {object} operator
 * @param {Map<string, object>} symbolIndex
 */
function pullCapacityForOperator(operator, symbolIndex) {
  const sourceSymbols = (operator.sourceObjects ?? [])
    .map((source) => symbolIndex.get(source.objectId))
    .filter(Boolean);
  const scale =
    average(sourceSymbols.map((symbol) => symbol.geometry?.size).filter(isFiniteNumber)) ??
    DEFAULT_SIGN_SIZE;
  const scaleWeight = scale / DEFAULT_SIGN_SIZE;
  if (operator.mode === 'gather_active') {
    return Math.max(8, finite(operator.geometryBinding?.materialIntake?.activePull, 1.5) * 8 * scaleWeight);
  }
  if (operator.mode === 'collect_nearby') return 6 * scaleWeight;
  if (operator.registryId === 'sign.pull') return 10 * scaleWeight;
  return 4 * scaleWeight;
}

/**
 * @param {string} sourceMode
 * @param {string} materialFamily
 * @param {object[]} sources
 * @param {object[]} props
 */
function candidatesForSourceMode(sourceMode, materialFamily, sources, props) {
  const sourceCandidates = sources.map((source) => ({
    ...source,
    candidateType: 'source',
    materialFamily: source.materialFamily ?? materialFamilyForKind(source.kind),
  }));
  if (!['collect_nearby', 'pull', 'push'].includes(sourceMode)) return sourceCandidates;
  return [
    ...sourceCandidates,
    ...props.map((prop) => ({
      ...prop,
      candidateType: 'prop',
      amount: finite(prop.amount, 1),
      capacity: finite(prop.capacity, 1),
      nonDepleting: prop.nonDepleting === true,
      materialFamily: prop.materialFamily ?? materialFamilyForKind(prop.kind),
    })),
  ];
}

/**
 * @param {object} candidate
 * @param {{ sourceMode: string; materialFamily: string; reach: number; pullCapacity: number; placementFrames: object[] }} args
 */
function evaluateSourceCandidate(candidate, args) {
  const compatibleFamily = compatibleSourceCandidate(args.sourceMode, args.materialFamily, candidate);
  const nearestOrigin = nearestSourceOperatorFrame(
    args.placementFrames,
    candidate.position ?? { x: 0, y: 0, z: 0 },
  );
  const distance = nearestOrigin.distance;
  const withinReach = distance <= args.reach;
  const pullDifficultyBreakdown = computePullDifficulty(candidate, distance, args.reach);
  const pullDifficulty = pullDifficultyBreakdown.total;
  const movable = candidate.movable !== false;
  const canPull = compatibleFamily && withinReach && movable && args.pullCapacity >= pullDifficulty;
  const availableAmount = candidate.nonDepleting
    ? Number.POSITIVE_INFINITY
    : Math.max(0, finite(candidate.amount, 0));
  return {
    ...candidate,
    compatibleFamily,
    movable,
    distance,
    distancePolicy: nearestOrigin.reachPolicy,
    distanceOriginPolicy: nearestOrigin.originPolicy,
    sourceFieldOriginId: nearestOrigin.originId,
    sourceFieldOrigin: nearestOrigin.origin,
    reach: args.reach,
    pullCapacity: args.pullCapacity,
    withinReach,
    pullDifficulty,
    pullDifficultyBreakdown,
    canPull,
    availableAmount,
    rejectionReason: !compatibleFamily
      ? 'incompatible_material_family'
      : !withinReach
        ? 'outside_reach'
        : !movable
          ? 'immovable_candidate'
          : !canPull
            ? 'pull_capacity_below_difficulty'
            : availableAmount <= 0
              ? 'empty_source'
              : null,
  };
}

/**
 * @param {object[]} placementFrames
 * @param {{ x?: number; y?: number; z?: number }} position
 */
function nearestSourceOperatorFrame(placementFrames, position) {
  const frames = placementFrames.length > 0 ? placementFrames : sourceOperatorFramesForOrigin(DEFAULT_PLACEMENT_FRAME, null);
  let nearest = null;
  for (const frame of frames) {
    const distance = vectorLength(subtractVector(position, frame.origin));
    if (!nearest || distance < nearest.distance) {
      nearest = {
        originId: frame.originId ?? null,
        origin: frame.origin,
        originPolicy: frame.originPolicy ?? 'spell_placement_frame_origin',
        reachPolicy: frame.reachPolicy ?? 'placement_frame_3d_distance',
        distance,
      };
    }
  }
  return nearest;
}

/**
 * @param {object} placementFrame
 * @param {object | null} regionOrigin
 */
function sourceOperatorFramesForOrigin(placementFrame, regionOrigin) {
  if (regionOrigin?.anchors?.length > 0) {
    const frames = regionOrigin.anchors
      .filter((anchor) => anchor.scenePosition)
      .map((anchor) => ({
        ...placementFrame,
        originId: anchor.anchorId ?? null,
        origin: anchor.scenePosition,
        originPolicy: 'region_anchor_origin_modifier',
        reachPolicy: 'region_anchor_3d_distance',
      }));
    if (frames.length > 0) return frames;
  }
  return [{
    ...placementFrame,
    originId: 'spell-placement-frame',
    originPolicy: 'spell_placement_frame_origin',
    reachPolicy: 'placement_frame_3d_distance',
  }];
}

/**
 * @param {object} frame
 */
function sourceFieldOriginRecord(frame) {
  return {
    originId: frame.originId ?? null,
    origin: frame.origin,
    originPolicy: frame.originPolicy ?? 'spell_placement_frame_origin',
    reachPolicy: frame.reachPolicy ?? 'placement_frame_3d_distance',
  };
}

/**
 * @param {object[]} candidates
 * @param {string} sourceMode
 */
function orderSourceCandidates(candidates, sourceMode) {
  if (sourceMode === 'collect_nearby') return candidates;
  return [...candidates].sort((a, b) => {
    const distanceDelta = finite(a.distance, 0) - finite(b.distance, 0);
    if (Math.abs(distanceDelta) > 0.000001) return distanceDelta;
    const difficultyDelta = finite(a.pullDifficulty, 0) - finite(b.pullDifficulty, 0);
    if (Math.abs(difficultyDelta) > 0.000001) return difficultyDelta;
    return String(a.id ?? '').localeCompare(String(b.id ?? ''));
  });
}

/**
 * @param {string} sourceMode
 * @param {string} wantedFamily
 * @param {object} candidate
 */
function compatibleSourceCandidate(sourceMode, wantedFamily, candidate) {
  if (sourceMode === 'collect_nearby') return true;
  if (compatibleMaterialFamily(wantedFamily, candidate.materialFamily)) return true;
  if (candidate.candidateType !== 'prop') return false;
  if (!['pull', 'push'].includes(sourceMode)) return false;
  return wantedFamily === 'wind' && candidate.materialFamily === 'generic';
}

/**
 * @param {string} sourceMode
 * @param {string} materialFamily
 */
function sourceMaterialCompatibilityPolicy(sourceMode, materialFamily) {
  if (sourceMode === 'collect_nearby') {
    return {
      matching: 'all_material_families',
      acceptedFamilies: ['any'],
      acceptedMaterialStates: ['any'],
      exactPhaseRequired: false,
      note: 'Collection queries all movable reachable material without downstream source handoff.',
    };
  }
  if (sourceMode === 'gather_active' && materialFamily === 'water') {
    return {
      matching: 'broad_material_family',
      acceptedFamilies: ['water'],
      acceptedMaterialStates: ['water', 'liquid', 'ice', 'mist', 'cloud', 'mist_cloud'],
      exactPhaseRequired: false,
      note: 'Gather accepts water-family phases; later effects can only use material actually gathered.',
    };
  }
  if (sourceMode === 'gather_active' && materialFamily === 'earth') {
    return {
      matching: 'broad_material_family',
      acceptedFamilies: ['earth'],
      acceptedMaterialStates: ['earth', 'solid', 'dust', 'sand', 'crushed_earth'],
      exactPhaseRequired: false,
      note: 'Gather accepts earth-family granular states; later effects can only use material actually gathered.',
    };
  }
  if ((sourceMode === 'pull' || sourceMode === 'push') && materialFamily === 'wind') {
    return {
      matching: 'material_family_or_generic_object',
      acceptedFamilies: ['wind', 'generic'],
      acceptedMaterialStates: ['wind', 'air', 'generic', 'prop'],
      exactPhaseRequired: false,
      note: 'Wind Pull may act on generic movable props through physics capacity checks.',
    };
  }
  return {
    matching: 'material_family',
    acceptedFamilies: [materialFamily],
    acceptedMaterialStates: [materialFamily],
    exactPhaseRequired: false,
    note: 'Compatible material family is required; exact phase is not a separate requirement.',
  };
}

/**
 * @param {string} sourceMode
 * @param {string} materialFamily
 * @param {{ requiredAmount: number; acquisitionCapacity: number; reach: number; pullCapacity: number; reachPolicy?: string; originPolicy?: string; originCount?: number }} args
 */
function sourceCapacityPolicyForMode(sourceMode, materialFamily, args) {
  const shared = {
    formula: 'mass * cohesion * phaseResistance * distanceFalloff',
    comparator: 'pullDifficulty <= pullCapacity',
    mobilityRequired: true,
    reachPolicy: args.reachPolicy ?? 'placement_frame_3d_distance',
    originPolicy: args.originPolicy ?? 'spell_placement_frame_origin',
    operands: ['mass', 'cohesion', 'phaseResistance', 'distanceFalloff'],
    materialFamily,
    requiredAmount: args.requiredAmount,
    acquisitionCapacity: args.acquisitionCapacity,
    reach: roundNumber(args.reach, 3),
    pullCapacity: roundNumber(args.pullCapacity, 3),
    originCount: Math.max(1, finite(args.originCount, 1)),
  };
  if (sourceMode === 'collect_nearby') {
    return {
      ...shared,
      policyId: 'collection_area_capacity_check',
      sourceMode,
      selectionRule: 'all_movable_reachable_within_pull_capacity',
      downstreamHandoff: false,
      depletionPolicy: 'no_source_depletion',
      note: 'Collection checks all material families for reach, mobility, mass, cohesion, phase, and distance; it does not feed later generation.',
    };
  }
  if (sourceMode === 'gather_active') {
    return {
      ...shared,
      policyId: 'gather_family_capacity_and_handoff_check',
      sourceMode,
      selectionRule: 'nearest_reachable_lowest_difficulty_first',
      downstreamHandoff: ['water', 'earth'].includes(materialFamily),
      depletionPolicy: ['water', 'earth'].includes(materialFamily)
        ? 'finite_scene_sources_deplete_only_when_actually_gathered'
        : 'no_downstream_handoff',
      note: 'Gather filters by material family, then capacity-checks practical pull difficulty before any same-spell source handoff.',
    };
  }
  if (sourceMode === 'pull' || sourceMode === 'push') {
    return {
      ...shared,
      policyId: 'pull_push_object_capacity_check',
      sourceMode,
      selectionRule: 'compatible_material_or_object_in_field',
      downstreamHandoff: false,
      depletionPolicy: 'no_source_depletion',
      note: 'Pull and push move compatible existing material or generic props through the field; they do not create material or source budget.',
    };
  }
  return {
    ...shared,
    policyId: 'source_required_capacity_check',
    sourceMode,
    selectionRule: 'compatible_material_in_range',
    downstreamHandoff: false,
    depletionPolicy: 'no_source_depletion',
    note: 'Source-requiring operators must find compatible material within reach and capacity.',
  };
}

/**
 * @param {string} sourceMode
 * @param {string} materialFamily
 */
function sourceContentPolicyForMode(sourceMode, materialFamily) {
  const supportsGatherHandoff =
    sourceMode === 'gather_active' && ['water', 'earth'].includes(materialFamily);
  const shared = {
    collectsSpellEffects: false,
    clonesActiveModifiers: false,
    activeModifierOwnership: 'preserve_original_spell_owner',
    effectTransferPolicy: 'material_only_no_effect_transfer',
    creationAssumption: 'no_creation',
  };

  if (sourceMode === 'collect_nearby') {
    return {
      ...shared,
      policyId: 'collection_material_only_no_effect_clone',
      sourceMode,
      gathersMaterialResources: true,
      downstreamHandoff: false,
      handoffPolicy: 'no_downstream_handoff',
      note: 'Collection pulls nearby available material or objects only; it does not collect spell effects, clone active modifiers, or feed downstream generation.',
    };
  }

  if (sourceMode === 'gather_active') {
    return {
      ...shared,
      policyId: 'gather_material_resource_no_effect_clone',
      sourceMode,
      gathersMaterialResources: true,
      downstreamHandoff: supportsGatherHandoff,
      handoffPolicy: supportsGatherHandoff
        ? 'actual_gathered_material_only_for_same_seal_water_earth_phase1'
        : 'no_downstream_handoff_for_material_family',
      note: 'Gather moves material/resources only; modifiers on gathered material stay owned by their original spell and are not cloned. Phase 1 handoff is local to the same seal until explicit multi-ring storage/feed rules exist.',
    };
  }

  if (sourceMode === 'pull' || sourceMode === 'push') {
    return {
      ...shared,
      policyId: 'pull_push_existing_target_no_effect_clone',
      sourceMode,
      gathersMaterialResources: false,
      downstreamHandoff: false,
      handoffPolicy: 'no_downstream_handoff',
      note: 'Pull and push move existing targets only; active effects or modifiers are not duplicated as source budget.',
    };
  }

  return {
    ...shared,
    policyId: 'source_material_only_no_effect_clone',
    sourceMode,
    gathersMaterialResources: true,
    downstreamHandoff: false,
    handoffPolicy: 'no_downstream_handoff',
    note: 'Source acquisition tracks material only and preserves active spell effect ownership.',
  };
}

/**
 * @param {object} source
 * @param {number} distance
 * @param {number} reach
 */
function computePullDifficulty(source, distance, reach) {
  const mass = finite(source.mass, defaultMassForSource(source.kind, source.amount));
  const cohesion = finite(source.cohesion, defaultCohesionForKind(source.kind));
  const phaseResistance = finite(
    source.phaseResistance,
    defaultPhaseResistanceForState(source.materialState ?? source.kind),
  );
  const distanceFalloff = 1 + distance / Math.max(0.1, reach);
  return {
    formula: 'mass * cohesion * phaseResistance * distanceFalloff',
    mass: roundNumber(mass, 3),
    cohesion: roundNumber(cohesion, 3),
    phaseResistance: roundNumber(phaseResistance, 3),
    distance: roundNumber(distance, 3),
    reach: roundNumber(reach, 3),
    distanceFalloff: roundNumber(distanceFalloff, 3),
    total: roundNumber(mass * cohesion * phaseResistance * distanceFalloff, 3),
  };
}

/**
 * @param {object} candidate
 * @param {number} fallbackAmount
 */
function collectionAffectedAmount(candidate, fallbackAmount) {
  if (candidate.nonDepleting === true) {
    if (isFiniteNumber(candidate.amount) && candidate.amount > 0) return candidate.amount;
    if (isFiniteNumber(candidate.capacity) && candidate.capacity > 0) return candidate.capacity;
    return Math.max(1, fallbackAmount);
  }
  return Math.max(0, finite(candidate.availableAmount, finite(candidate.amount, fallbackAmount)));
}

/**
 * @param {object[]} candidates
 * @param {string} sourceMode
 * @param {string} materialFamily
 */
function sourceAcquisitionFailureReason(candidates, sourceMode, materialFamily) {
  if (candidates.length === 0) return `No scene candidates for ${sourceMode}`;
  const compatible = candidates.filter((candidate) => candidate.compatibleFamily);
  if (compatible.length === 0) {
    return `No compatible ${materialFamily} material for ${sourceMode}`;
  }
  const reachable = compatible.filter((candidate) => candidate.withinReach);
  if (reachable.length === 0) {
    return `Compatible ${materialFamily} material is outside ${sourceMode} reach`;
  }
  const movable = reachable.filter((candidate) => candidate.movable);
  if (movable.length === 0) {
    return `Compatible ${materialFamily} material is immovable for ${sourceMode}`;
  }
  const pullable = movable.filter((candidate) => candidate.canPull);
  if (pullable.length === 0) {
    return `Compatible ${materialFamily} material exceeds ${sourceMode} pull capacity`;
  }
  return `Compatible ${materialFamily} material has no available amount`;
}

/**
 * @param {string} wanted
 * @param {string} actual
 */
function compatibleMaterialFamily(wanted, actual) {
  if (!wanted || !actual) return false;
  if (wanted === actual) return true;
  if (wanted === 'water' && ['mist', 'cloud', 'ice'].includes(actual)) return true;
  if (wanted === 'earth' && ['dust', 'sand', 'crushed_earth'].includes(actual)) return true;
  return false;
}

/**
 * @param {object[]} nodes
 * @param {object | null} program
 * @param {object} placementFrame
 * @param {object} lifecycle
 */
function buildRegionDistributionIntents(nodes, program, placementFrame, lifecycle) {
  const symbolIndex = indexSymbols(program);
  return nodes
    .filter((node) => node.nodeType === 'shape_field' && node.shape === 'region')
    .map((node) => {
      const sealKey = sealKeyForNode(node.nodeId);
      const seal = sealForKey(program, sealKey);
      const sourceSymbols = (node.sourceObjects ?? [])
        .map((source) => symbolIndex.get(source.objectId))
        .filter(Boolean);
      const anchors = resolveRegionAnchors(node, sourceSymbols, seal, placementFrame);
      const debug = regionDebugForAnchors(anchors);
      return {
        intentType: 'region_emergence',
        id: `region-emergence:${node.nodeId}`,
        nodeId: node.nodeId,
        sealKey,
        active: lifecycle.active,
        regionZone: node.regionZone ?? node.geometryBinding?.regionZone ?? 'unknown',
        emissionPlacement: node.emissionPlacement ?? node.geometryBinding?.emissionPlacement ?? 'on_ring',
        applicationOrder: {
          discoveredPhase: 'targeting_source_operators',
          appliedPhase: 'late_output_placement',
        },
        grammarRole: 'emergence_origin_modifier',
        budgetPolicy: 'weighted_split_no_power_gain',
        vectorSemantics: 'does_not_change_column_pull_or_levitation_force',
        anchors,
        debug,
        unsupportedLayout: anchors.some((anchor) => anchor.placement === 'deterministic_fallback'),
        evidenceTier: node.evidenceTier ?? null,
        warningScoped: node.warningScoped === true,
      };
    });
}

/**
 * @param {RuntimeIntent[]} regionDistributions
 * @param {string} sealKey
 */
function regionOriginForSeal(regionDistributions, sealKey) {
  const region = regionDistributions.find((item) => item.sealKey === sealKey);
  if (!region) return null;
  const primaryAnchor = region.anchors?.[0] ?? null;
  return {
    regionIntentId: region.id,
    regionZone: region.regionZone ?? null,
    anchorCount: region.anchors?.length ?? 0,
    primaryAnchorId: primaryAnchor?.anchorId ?? null,
    primaryScenePosition: primaryAnchor?.scenePosition ?? null,
    anchors: region.anchors ?? [],
    originPolicy: 'region_anchor_origin_modifier',
    applicationOrder: {
      discoveredPhase: 'targeting_source_operators',
      appliedPhase: 'source_force_origin_placement',
    },
    budgetPolicy: 'origin_only_no_power_gain',
    vectorSemanticsUnaffected: true,
  };
}

/**
 * @param {object[]} anchors
 */
function regionDebugForAnchors(anchors) {
  const placements = anchors.map((anchor) => anchor.placement);
  const anchorCount = anchors.length;
  const budgetShares = anchors.map((anchor) => anchor.budgetShare);
  const anchorWeights = anchors.map((anchor) => anchor.weight);
  const budgetShareTotal = roundNumber(
    budgetShares.reduce((sum, share) => sum + finite(share, 0), 0),
    6,
  );
  const split = anchorCount > 1;
  const centered = anchorCount === 1 && placements.includes('centered_inward_collapse');
  const outward = placements.some((placement) =>
    ['outward_boundary', 'opposing_boundary'].includes(placement),
  );
  const biased = placements.some((placement) => placement === 'biased_region_cluster');
  const fallback = placements.some((placement) => placement === 'deterministic_fallback');

  return {
    outcome: centered
      ? 'stayed_centered'
      : outward
        ? split
          ? 'split_outward_emergence'
          : 'moved_outward'
        : biased
          ? split
            ? 'split_biased_emergence'
            : 'biased_one_side'
          : fallback
            ? 'deterministic_fallback'
            : split
              ? 'split_multiple_emergence_points'
              : 'single_emergence_point',
    anchorCount,
    split,
    centered,
    outward,
    biased,
    fallback,
    budgetPolicy: 'weighted_split_no_power_gain',
    budgetWeightBasis: 'sum_region_sign_scale_weight_per_anchor',
    clusterPolicy: `merge_region_signs_within_${REGION_CLUSTER_THRESHOLD_DEG}_degrees`,
    anchorWeights,
    budgetShares,
    budgetShareTotal,
  };
}

/**
 * @param {object} regionNode
 * @param {object[]} sourceSymbols
 * @param {object | null} seal
 * @param {object} placementFrame
 */
function resolveRegionAnchors(regionNode, sourceSymbols, seal, placementFrame) {
  const regionZone = regionNode.regionZone ?? regionNode.geometryBinding?.regionZone ?? 'unknown';
  const vectorSummary = regionNode.geometryBinding?.vectorSummary ?? {};
  const symmetric = regionNode.geometryBinding?.symmetric === true;
  const displayRadius = Math.max(1, displayMaxRadiusForSeal({ seals: [seal].filter(Boolean) }, 'seal0'));
  const displayScale = 2.25 / Math.max(120, displayRadius);

  if (
    (regionZone === 'all_inward' || regionZone === 'on_ring_only') &&
    symmetric &&
    Math.hypot(finite(vectorSummary.x, 0), finite(vectorSummary.y, 0)) <= 0.000001
  ) {
    return withBudgetShares([
      {
        anchorId: `region-anchor:${regionNode.nodeId}:center`,
        placement: 'centered_inward_collapse',
        weight: 1,
        sourceObjectIds: sourceSymbols.map((symbol) => symbol.objectId),
        localPosition: { x: 0, y: 0, z: 0.22 },
        scenePosition: localToScene(placementFrame, { x: 0, y: 0, z: 0.22 }),
      },
    ]);
  }

  const clusters = clusterRegionSymbols(sourceSymbols);
  if (clusters.length === 0) {
    return withBudgetShares([
      {
        anchorId: `region-anchor:${regionNode.nodeId}:fallback`,
        placement: 'deterministic_fallback',
        weight: 1,
        sourceObjectIds: [],
        localPosition: { x: 0, y: 0, z: 0.22 },
        scenePosition: localToScene(placementFrame, { x: 0, y: 0, z: 0.22 }),
      },
    ]);
  }

  const anchors = clusters.map((cluster, index) => {
    const localPosition2 = averageLocalPosition(cluster);
    const radial = normalize2D(localPosition2);
    const local =
      regionZone === 'all_outward' || regionZone === 'opposing'
        ? {
            x: radial.x * displayRadius * (regionZone === 'all_outward' ? 1.15 : 1),
            y: radial.y * displayRadius * (regionZone === 'all_outward' ? 1.15 : 1),
            z: 0.22,
          }
        : { x: localPosition2.x, y: localPosition2.y, z: 0.22 };
    return {
      anchorId: `region-anchor:${regionNode.nodeId}:${index}`,
      placement:
        regionZone === 'all_outward'
          ? 'outward_boundary'
          : regionZone === 'opposing'
            ? 'opposing_boundary'
            : 'biased_region_cluster',
      weight: cluster.reduce(
        (sum, symbol) => sum + finite(symbol.geometryAnalysis?.scaleWeight, 1),
        0,
      ),
      sourceObjectIds: cluster.map((symbol) => symbol.objectId),
      clusterSize: cluster.length,
      clusterPolicy: `merge_region_signs_within_${REGION_CLUSTER_THRESHOLD_DEG}_degrees`,
      localPosition: local,
      scenePosition: localToScene(placementFrame, {
        x: local.x * displayScale,
        y: local.y * displayScale,
        z: local.z,
      }),
      positionAngleDeg: averageAngles(cluster.map((symbol) => symbol.geometry?.polarAngleDeg ?? 0)),
    };
  });

  return withBudgetShares(anchors);
}

/**
 * @param {{ sourceSymbols: object[]; displayMaxRadius: number; placementFrame: object }} args
 */
function resolveDispersionSourceAnchors(args) {
  const symbols = args.sourceSymbols.filter(
    (symbol) =>
      (symbol.resolvedRegistryId ?? symbol.registryCandidate) === 'sign.dispersion' &&
      symbol.geometryAnalysis?.inverted !== true,
  );
  if (symbols.length === 0) return [];

  const displayScale = 2.25 / Math.max(120, args.displayMaxRadius);
  return withBudgetShares(
    symbols.map((symbol, index) => {
      const pos = symbol.geometry?.localPosition ?? { x: 0, y: 0 };
      const local = {
        x: finite(pos.x, 0),
        y: finite(pos.y, 0),
        z: 0.22,
      };
      return {
        anchorId: `dispersion-anchor:${symbol.objectId}`,
        placement: 'dispersion_sign_position',
        weight: finite(symbol.geometryAnalysis?.scaleWeight, 1),
        sourceObjectIds: [symbol.objectId],
        clusterSize: 1,
        clusterPolicy: 'one_sheet_anchor_per_dispersion_sign',
        localPosition: local,
        scenePosition: localToScene(args.placementFrame, {
          x: local.x * displayScale,
          y: local.y * displayScale,
          z: local.z,
        }),
        positionAngleDeg: normalizeDegrees(finite(symbol.geometry?.polarAngleDeg, 0)),
        inverted: false,
        directionalBasis: 'source_position',
        index,
      };
    }),
  );
}

/**
 * @param {object[]} anchors
 */
function withBudgetShares(anchors) {
  const total = anchors.reduce((sum, anchor) => sum + finite(anchor.weight, 1), 0) || 1;
  return anchors.map((anchor) => ({
    ...anchor,
    weight: roundNumber(finite(anchor.weight, 1), 4),
    budgetShare: roundNumber(finite(anchor.weight, 1) / total, 6),
  }));
}

/**
 * @param {object[]} symbols
 */
function clusterRegionSymbols(symbols) {
  const sorted = [...symbols].sort(
    (a, b) =>
      normalizeDegrees(finite(a.geometry?.polarAngleDeg, 0)) -
      normalizeDegrees(finite(b.geometry?.polarAngleDeg, 0)),
  );
  if (sorted.length <= 1) return sorted.length === 0 ? [] : [sorted];

  const clusters = [];
  for (const symbol of sorted) {
    const angle = normalizeDegrees(finite(symbol.geometry?.polarAngleDeg, 0));
    const last = clusters[clusters.length - 1];
    const lastAngle = last
      ? normalizeDegrees(finite(last[last.length - 1].geometry?.polarAngleDeg, 0))
      : null;
    if (last && Math.abs(angle - lastAngle) <= REGION_CLUSTER_THRESHOLD_DEG) {
      last.push(symbol);
    } else {
      clusters.push([symbol]);
    }
  }

  if (clusters.length > 1) {
    const first = clusters[0];
    const last = clusters[clusters.length - 1];
    const firstAngle = normalizeDegrees(finite(first[0].geometry?.polarAngleDeg, 0));
    const lastAngle = normalizeDegrees(finite(last[last.length - 1].geometry?.polarAngleDeg, 0));
    if (360 - lastAngle + firstAngle <= REGION_CLUSTER_THRESHOLD_DEG) {
      clusters[0] = [...last, ...first];
      clusters.pop();
    }
  }

  return clusters;
}

/**
 * @param {object[]} symbols
 */
function averageLocalPosition(symbols) {
  const total = symbols.reduce(
    (sum, symbol) => {
      const pos = symbol.geometry?.localPosition ?? { x: 0, y: 0 };
      const weight = finite(symbol.geometryAnalysis?.scaleWeight, 1);
      return {
        x: sum.x + finite(pos.x, 0) * weight,
        y: sum.y + finite(pos.y, 0) * weight,
        weight: sum.weight + weight,
      };
    },
    { x: 0, y: 0, weight: 0 },
  );
  const divisor = total.weight || 1;
  return { x: total.x / divisor, y: total.y / divisor };
}

/**
 * @param {{ x?: number; y?: number }} vector
 */
function normalize2D(vector) {
  const x = finite(vector.x, 0);
  const y = finite(vector.y, 0);
  const length = Math.hypot(x, y);
  if (length <= 0.000001) return { x: 1, y: 0 };
  return { x: x / length, y: y / length };
}

/**
 * @param {number[]} angles
 */
function averageAngles(angles) {
  if (angles.length === 0) return 0;
  const sum = angles.reduce(
    (acc, angle) => {
      const rad = (normalizeDegrees(angle) * Math.PI) / 180;
      return { x: acc.x + Math.cos(rad), y: acc.y + Math.sin(rad) };
    },
    { x: 0, y: 0 },
  );
  return roundNumber(normalizeDegrees((Math.atan2(sum.y, sum.x) * 180) / Math.PI), 3);
}

/**
 * @param {{ materialKind: string; signSizeAverage: number; magnitude: number; thicknessRingRadius: number; columnRadiusRatio: number; columnHeightMultiplier: number }} args
 */
function generatedColumnBudget(args) {
  const columnRadius = Math.max(0.5, args.thicknessRingRadius * args.columnRadiusRatio);
  const columnDiameter = columnRadius * 2;
  const columnHeight = Math.max(
    1,
    (args.signSizeAverage / DEFAULT_SIGN_SIZE) *
      Math.max(1, args.magnitude) *
      100 *
      args.columnHeightMultiplier,
  );
  const crossSection = Math.PI * columnRadius ** 2;
  return {
    materialKind: args.materialKind,
    budgetMode: 'geometry_derived_finite',
    finite: true,
    amount: roundNumber(crossSection * columnHeight, 4),
    units: 'local_volume_units',
    outputShape: columnOutputShapeForMaterial(args.materialKind),
    budgetPolicy: 'finite_geometry_derived_column_budget',
    formula: 'pi * (0.7 * containingRingRadius)^2 * (3 * signScaledColumnHeight)',
    columnRadius: roundNumber(columnRadius, 4),
    columnDiameter: roundNumber(columnDiameter, 4),
    columnHeight: roundNumber(columnHeight, 4),
  };
}

/**
 * @param {string} materialKind
 */
function columnOutputShapeForMaterial(materialKind) {
  if (materialKind === 'earth') return 'solid_column_volume';
  if (materialKind === 'wind') return 'airflow_column_volume';
  if (materialKind === 'light') return 'illumination_beam_volume';
  return 'fluid_column_volume';
}

/**
 * @param {{ materialKind: string; signSizeAverage: number; magnitude: number; thicknessRingRadius: number; columnRadiusRatio: number; columnHeightMultiplier: number; dispersionSpread: number }} args
 */
function generatedDispersionBudget(args) {
  return {
    ...generatedColumnBudget(args),
    outputShape: 'dispersion',
    formula: 'column-equivalent finite volume budget; spread changes placement/readability, not total generated power',
    dispersionSpread: roundNumber(args.dispersionSpread, 4),
    budgetPolicy: 'finite_column_equivalent_no_spread_power_gain',
  };
}

function scaleGeneratedBudgetForPlacement(budget, worldScale) {
  const scale = clamp(finite(worldScale, 1), 0.25, 4);
  if (scale === 1) return { ...budget, worldScale: 1 };
  return {
    ...budget,
    amount: roundNumber(finite(budget.amount, 0) * scale ** 3, 4),
    columnRadius: isFiniteNumber(budget.columnRadius)
      ? roundNumber(budget.columnRadius * scale, 4)
      : budget.columnRadius,
    columnDiameter: isFiniteNumber(budget.columnDiameter)
      ? roundNumber(budget.columnDiameter * scale, 4)
      : budget.columnDiameter,
    columnHeight: isFiniteNumber(budget.columnHeight)
      ? roundNumber(budget.columnHeight * scale, 4)
      : budget.columnHeight,
    sphereRadius: isFiniteNumber(budget.sphereRadius)
      ? roundNumber(budget.sphereRadius * scale, 4)
      : budget.sphereRadius,
    worldScale: scale,
    placementScalePolicy: 'linear_world_geometry_cubic_generated_volume',
  };
}

/**
 * @param {{ materialKind: string; signSizeAverage: number; displayMaxRadius: number; verticalLift: number }} args
 */
function generatedLevitationBudget(args) {
  const signScale = Math.max(0.25, args.signSizeAverage / DEFAULT_SIGN_SIZE);
  const liftScale = Math.max(0.35, args.verticalLift / DEFAULT_SIGN_SIZE);
  const sphereRadius = Math.max(1, args.displayMaxRadius * 0.42 * Math.sqrt(signScale));
  const amount = (4 / 3) * Math.PI * sphereRadius ** 3 * liftScale;
  return {
    materialKind: args.materialKind,
    outputShape: 'sphere_like_levitation_field',
    budgetMode: 'geometry_derived_finite',
    finite: true,
    amount: roundNumber(amount, 4),
    units: 'local_volume_units',
    formula: '4/3 * pi * ringScaledLevitationRadius^3 * liftScale',
    sphereRadius: roundNumber(sphereRadius, 4),
    liftScale: roundNumber(liftScale, 4),
    signSizeAverage: roundNumber(args.signSizeAverage, 4),
    budgetPolicy: 'finite_ring_sphere_no_infinite_levitation_material',
  };
}

/**
 * @param {object} geometryBudget
 * @param {RuntimeIntent | null | undefined} gatherSupply
 */
function sourceLimitedBudgetForGather(geometryBudget, gatherSupply) {
  if (!gatherSupply) return geometryBudget;

  const acquiredAmount = Math.max(0, finite(gatherSupply.acquiredAmount, 0));
  return {
    ...geometryBudget,
    budgetMode: 'source_limited_actual_material',
    amount: roundNumber(acquiredAmount, 4),
    units: 'scene_source_amount_units',
    formula: 'actual gathered material amount; spell geometry records shaping capacity only',
    generatedGeometryBudget: geometryBudget,
    sourceAcquisitionId: gatherSupply.id,
    acquiredAmount: roundNumber(acquiredAmount, 4),
    requiredAmount: roundNumber(finite(gatherSupply.requiredAmount, 0), 4),
    acquisitionCapacity: roundNumber(finite(gatherSupply.acquisitionCapacity, acquiredAmount), 4),
    sourceLimited: true,
    sourceSatisfied: gatherSupply.satisfied === true,
    sourceBudgetLimited: gatherSupply.sourceBudgetLimited === true,
    sourceLimitedReason:
      gatherSupply.satisfied === true
        ? null
        : acquiredAmount > 0
          ? 'gather_source_limited_actual_material_below_required'
          : 'gather_required_no_material_available',
    budgetPolicy: 'actual_gathered_material_no_silent_generation',
  };
}

/**
 * @param {object[]} nodes
 * @param {object | null} program
 * @param {object} options
 */
function buildCrosshairScopeIntents(nodes, program, options = {}) {
  const symbolIndex = indexSymbols(program);
  const crosshairNodes = nodes.filter(
    (node) =>
      (node.nodeType === 'target' || node.nodeType === 'target_selector') &&
      node.registryId === 'sign.crosshair',
  );
  const hasGenerationOrSourceFlow = nodes.some(
    (node) =>
      (node.nodeType === 'shape_field' && ['column', 'dispersion'].includes(node.shape)) ||
      (node.nodeType === 'force_constraint' &&
        ['sign.levitation', 'sign.pull'].includes(node.registryId)) ||
      (node.nodeType === 'source_mode' &&
        ['collect_nearby', 'gather_active'].includes(node.mode)),
  );

  return crosshairNodes.map((node, index) => {
    const crosshairSymbols = (node.sourceObjects ?? [])
      .map((source) => symbolIndex.get(source.objectId))
      .filter(Boolean);
    const signSize =
      average(crosshairSymbols.map((symbol) => symbol.geometry?.size).filter(isFiniteNumber)) ??
      DEFAULT_SIGN_SIZE;
    const override =
      typeof options.crosshairMode === 'string'
        ? options.crosshairMode
        : options.crosshairMode?.[node.nodeId] ?? null;
    const mode = EXPLICIT_CROSSHAIR_MODES.has(override)
      ? override
      : hasGenerationOrSourceFlow
        ? 'crosshair_1'
        : 'crosshair_2';
    const radius = Math.max(0.5, signSize / 100);
    const targetVolume =
      mode === 'crosshair_1'
        ? {
            shape: 'generated_output_binding',
            radius: null,
            appliesTo: node.targetedNodeIds ?? [],
          }
        : mode === 'crosshair_3'
          ? {
              shape: 'local_column',
              radius,
              height: Math.max(1, radius * 2.5),
            }
          : {
              shape: 'sphere',
              radius,
            };

    return {
      intentType: 'targeting_debug',
      id: `crosshair-scope:${node.nodeId}:${index}`,
      nodeId: node.nodeId,
      active: true,
      targetingKind: 'crosshair',
      mode,
      defaulted: !override,
      signSize,
      reason: override
        ? 'explicit_runtime_override'
        : hasGenerationOrSourceFlow
          ? 'generation_or_source_flow_present'
          : 'no_generation_or_source_flow_present',
      targetKind: node.targetKind ?? node.geometryBinding?.targetKind ?? null,
      centerSigilId: node.centerSigilId ?? node.geometryBinding?.centerSigilId ?? null,
      centerRegistryId: node.centerRegistryId ?? node.geometryBinding?.centerRegistryId ?? null,
      modifierWeakEffect: node.modifierWeakEffect ?? node.geometryBinding?.modifierWeakEffect ?? null,
      targetVolume,
      signSizeAverage: signSize,
      evidenceTier: node.evidenceTier ?? null,
      warningScoped: node.warningScoped === true,
    };
  });
}

/**
 * @param {object[]} nodes
 * @param {object[]} edges
 * @param {RuntimeIntent[]} sourceAcquisitions
 * @param {object} lifecycle
 * @param {ReturnType<typeof buildSourceRequirements>} sourceRequirements
 * @param {RuntimeIntent[]} crosshairScopes
 * @param {object} placementFrame
 */
function buildMaterialStateIntents(
  nodes,
  edges,
  sourceAcquisitions,
  lifecycle,
  sourceRequirements,
  crosshairScopes = [],
  placementFrame = DEFAULT_PLACEMENT_FRAME,
) {
  const intents = [];

  for (const transform of nodes.filter((node) => node.nodeType === 'material_transform')) {
    const state = materialStateForTransform(transform);
    intents.push({
      intentType: 'material_state',
      id: `material-state:${transform.nodeId}`,
      nodeId: transform.nodeId,
      active: lifecycle.active,
      materialOrigin: materialOriginForTransform(transform, sourceAcquisitions),
      sourceRequired: false,
      noSilentCreation: true,
      ...state,
      transformKind: transform.transformKind ?? null,
      fromDomain: transform.fromDomain ?? null,
      evidenceTier: transform.evidenceTier ?? null,
      warningScoped: transform.warningScoped === true,
    });
  }

  for (const phase of nodes.filter((node) => node.nodeType === 'phase_state')) {
    const state = materialStateForPhase(phase);
    const sourceContext = materialStateSourceContext(
      phase,
      state.materialKind,
      sourceRequirements,
      crosshairScopes,
      placementFrame,
    );
    const sourceRequired = phase.doesNotCreateMaterial === true;
    const sourceAvailable = sourceRequired ? sourceContext.available : true;
    intents.push({
      intentType: 'material_state',
      id: `material-state:${phase.nodeId}`,
      nodeId: phase.nodeId,
      active: lifecycle.active && sourceAvailable,
      degraded: lifecycle.active && !sourceAvailable,
      reason: lifecycle.active
        ? sourceAvailable
          ? null
          : sourceContext.reason
        : lifecycle.phase,
      materialOrigin: 'targeted_scene_material',
      sourceRequired,
      noSilentCreation: sourceRequired,
      sourceAvailable,
      sourceRequirementId: sourceContext.requirement?.id ?? null,
      sourceBindingId: sourceContext.binding?.id ?? null,
      sourceId: sourceContext.binding?.sourceId ?? null,
      sourceBindingIds: sourceContext.sourceBindingIds,
      targetSourceIds: sourceContext.targetSourceIds,
      targetSourceCount: sourceContext.targetSourceIds.length,
      targetSelectionPolicy: sourceContext.targetSelectionPolicy,
      targetSources: sourceContext.targetSources,
      targetingScopeId: sourceContext.crosshairScope?.id ?? null,
      crosshairMode: sourceContext.crosshairScope?.mode ?? null,
      targetVolume: sourceContext.crosshairScope?.targetVolume ?? null,
      ...state,
      specificEnergy: phase.specificEnergy ?? null,
      phaseModel: phase.phaseModel ?? null,
      evidenceTier: phase.evidenceTier ?? null,
      warningScoped: phase.warningScoped === true,
    });
  }

  for (const luminous of nodes.filter((node) => node.nodeType === 'luminous_modifier')) {
    const attachment = glowAttachmentForLuminous(
      luminous,
      nodes,
      edges,
      crosshairScopes,
      sourceRequirements,
      placementFrame,
    );
    const targetAvailable = attachment.targetAvailable !== false;
    intents.push({
      intentType: 'material_state',
      id: `material-state:${luminous.nodeId}`,
      nodeId: luminous.nodeId,
      active: lifecycle.active && targetAvailable,
      degraded: lifecycle.active && !targetAvailable,
      reason: lifecycle.active
        ? targetAvailable
          ? null
          : attachment.reason
        : lifecycle.phase,
      materialOrigin: 'sigil_generated_modifier',
      sourceRequired: false,
      noSilentCreation: true,
      materialKind: 'light',
      materialFamily: 'light',
      materialState: 'glow',
      phase: 'glow',
      renderPreset: 'glow',
      viscosity: 0,
      cohesion: 0,
      thermalByDefault: luminous.thermalByDefault === true,
      attachment,
      modifierLifecycle: {
        attachedToEffectLifetime:
          attachment.targetKind === 'generated_spell_output' ||
          attachment.targetKind === 'targeted_scene_material',
        attachedToTargetedMaterial: attachment.targetKind === 'targeted_scene_material',
        stopsWithModifiedEffect:
          attachment.targetKind === 'generated_spell_output' ||
          attachment.targetKind === 'targeted_scene_material',
        stopsWithSpellLifecycle: true,
        nonRepetitionCleanup: lifecycle.nonRepetitionStopsActiveEffects === true,
      },
      evidenceTier: luminous.evidenceTier ?? null,
      warningScoped: luminous.warningScoped === true,
    });
  }

  const waterLiquid = intents.find(
    (intent) =>
      intent.materialFamily === 'water' &&
      intent.phase === 'liquid' &&
      canFeedMaterialMixture(intent),
  );
  const crushedEarth = intents.find(
    (intent) =>
      intent.materialFamily === 'earth' &&
      intent.phase === 'crushed_earth' &&
      canFeedMaterialMixture(intent),
  );
  if (waterLiquid && crushedEarth) {
    intents.push({
      intentType: 'material_state',
      id: 'material-state:mud-mixture',
      active: lifecycle.active,
      materialOrigin: 'water_plus_crushed_earth_mixture',
      sourceRequired: waterLiquid.sourceRequired === true,
      noSilentCreation: true,
      sourceAvailable: true,
      sourceRequirementId: waterLiquid.sourceRequirementId ?? null,
      sourceBindingId: waterLiquid.sourceBindingId ?? null,
      sourceId: waterLiquid.sourceId ?? null,
      materialKind: 'mud',
      materialFamily: 'mud',
      materialState: 'mud',
      ...MATERIAL_PRESETS.mud,
      mixtureInputs: [waterLiquid.id, crushedEarth.id],
    });
  }

  return intents;
}

/**
 * @param {object} luminous
 * @param {object[]} nodes
 * @param {object[]} edges
 * @param {RuntimeIntent[]} crosshairScopes
 * @param {ReturnType<typeof buildSourceRequirements>} sourceRequirements
 * @param {object} placementFrame
 */
function glowAttachmentForLuminous(
  luminous,
  nodes,
  edges,
  crosshairScopes = [],
  sourceRequirements = { sourceStatus: [], bindings: [] },
  placementFrame = DEFAULT_PLACEMENT_FRAME,
) {
  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));
  const generatedOutputs = nodes
    .filter(
      (node) =>
        node.nodeType === 'shape_field' && ['column', 'dispersion'].includes(node.shape),
    )
    .map((node) => {
      const domainNode = domainNodeForShape(node, edges, nodeById);
      const materialKind =
        materialKindForDomain(domainNode?.registryId ?? domainNode?.domain) ?? 'water';
      return {
        nodeId: node.nodeId,
        sealKey: sealKeyForNode(node.nodeId),
        materialKind,
        materialFamily: materialFamilyForKind(materialKind),
      };
    });

  if (generatedOutputs.length === 0) {
    const targetedMaterial = glowTargetedMaterialAttachment(
      luminous,
      crosshairScopes,
      sourceRequirements,
      placementFrame,
    );
    if (targetedMaterial) return targetedMaterial;

    return {
      targetKind: 'spell_local_glow_field',
      targetNodeIds: [],
      targetIntentTypes: [],
      attachmentPolicy: 'standalone_light_glow_until_spell_end',
      durationPolicy: 'spell_lifecycle',
    };
  }

  const luminousSealKey = sealKeyForNode(luminous.nodeId);
  const sameSeal = generatedOutputs.filter((output) => output.sealKey === luminousSealKey);
  const targets = sameSeal.length > 0 ? sameSeal : generatedOutputs;

  return {
    targetKind: 'generated_spell_output',
    targetNodeIds: targets.map((target) => target.nodeId),
    primaryTargetNodeId: targets[0]?.nodeId ?? null,
    targetIntentTypes: [
      'water_column',
      'material_column',
      'water_dispersion',
      'material_dispersion',
    ],
    targetMaterialKinds: [...new Set(targets.map((target) => target.materialKind))],
    targetMaterialFamilies: [...new Set(targets.map((target) => target.materialFamily))],
    attachmentPolicy: 'attach_to_spell_created_or_targeted_material_for_duration',
    durationPolicy: 'modified_effect_lifetime',
    targetScope: sameSeal.length > 0 ? 'same_seal_generated_output' : 'spell_generated_output',
  };
}

/**
 * @param {object} luminous
 * @param {RuntimeIntent[]} crosshairScopes
 * @param {ReturnType<typeof buildSourceRequirements>} sourceRequirements
 * @param {object} placementFrame
 */
function glowTargetedMaterialAttachment(
  luminous,
  crosshairScopes,
  sourceRequirements,
  placementFrame,
) {
  const scope = crosshairScopes.find(
    (item) =>
      item.modifierWeakEffect === luminous.weakEffect ||
      item.modifierWeakEffect === luminous.spectralMode ||
      item.modifierWeakEffect === 'glow',
  );
  if (!scope) return null;

  const targetMaterialKind = materialKindForDomain(scope.centerRegistryId) ?? null;
  if (!targetMaterialKind) return null;

  const targetContext = thermalTargetSourceContext(
    sourceRequirements,
    targetMaterialKind,
    scope,
    placementFrame,
  );
  return {
    targetKind: 'targeted_scene_material',
    targetNodeIds: scope.targetVolume?.appliesTo ?? [],
    targetIntentTypes: ['scene_source', 'material_state'],
    targetMaterialKinds: [targetMaterialKind],
    targetMaterialFamilies: [materialFamilyForKind(targetMaterialKind)],
    targetSourceIds: targetContext.sourceIds,
    targetSourceCount: targetContext.sourceIds.length,
    targetSources: targetContext.sources,
    targetVolume: scope.targetVolume,
    targetingScopeId: scope.id,
    crosshairMode: scope.mode,
    targetAvailable: targetContext.satisfied,
    reason: targetContext.reason,
    attachmentPolicy: 'attach_to_targeted_compatible_material_for_duration',
    durationPolicy: 'targeted_material_spell_lifecycle',
  };
}

/**
 * @param {object} phase
 * @param {string | null | undefined} materialKind
 * @param {ReturnType<typeof buildSourceRequirements>} sourceRequirements
 * @param {RuntimeIntent[]} crosshairScopes
 * @param {object} placementFrame
 */
function materialStateSourceContext(
  phase,
  materialKind,
  sourceRequirements,
  crosshairScopes = [],
  placementFrame = DEFAULT_PLACEMENT_FRAME,
) {
  const requirement =
    sourceRequirements.requirementByNodeId.get(phase.nodeId) ??
    findRequirementForMaterial(sourceRequirements.requirements, materialKind);
  const crosshairScope = crosshairScopes.find(
    (scope) =>
      materialKindForDomain(scope.centerRegistryId) === materialKind ||
      scope.targetVolume?.appliesTo?.includes(phase.nodeId),
  );
  const targetSources = thermalTargetSourceContext(
    sourceRequirements,
    materialKind,
    crosshairScope,
    placementFrame,
  );
  const binding = targetSources.primarySourceBindingId
    ? sourceRequirements.bindings.find(
        (item) => item.id === targetSources.primarySourceBindingId,
      )
    : targetSources.areaMode
      ? null
      : requirement
        ? sourceRequirements.bindingByNodeId.get(requirement.nodeId)
        : null;
  const available = requirement ? targetSources.satisfied === true : true;
  return {
    requirement,
    binding,
    available,
    reason: available
      ? null
      : targetSources.reason ?? requirement?.reason ?? `No ${materialKind} source binding`,
    sourceBindingIds: targetSources.sourceBindingIds,
    targetSourceIds: targetSources.sourceIds,
    targetSources: targetSources.sources,
    targetSelectionPolicy: targetSources.selectionPolicy,
    crosshairScope,
  };
}

/**
 * @param {RuntimeIntent} intent
 */
function canFeedMaterialMixture(intent) {
  return (
    intent.active === true &&
    (intent.sourceRequired !== true || intent.sourceAvailable === true)
  );
}

/**
 * @param {object[]} nodes
 * @param {object[]} edges
 * @param {RuntimeIntent[]} sourceAcquisitions
 * @param {RuntimeIntent[]} fieldModifications
 * @param {object} lifecycle
 */
function buildMaterialReversionIntents(
  nodes,
  edges,
  sourceAcquisitions,
  fieldModifications,
  lifecycle,
) {
  const coolingCausesByOperator = coolingReversionCausesByOperator(nodes, edges);
  const intents = [];

  for (const acquisition of sourceAcquisitions) {
    if (
      acquisition.sourceMode !== 'gather_active' ||
      acquisition.feedsDownstream !== true ||
      acquisition.materialFamily !== 'water' ||
      acquisition.satisfied !== true
    ) {
      continue;
    }

    const causes = [
      ...(coolingCausesByOperator.get(acquisition.operatorNodeId) ?? []),
      ...convergenceReversionCausesForAcquisition(acquisition, fieldModifications),
    ];
    if (causes.length === 0) continue;

    for (const match of acquisition.matches ?? []) {
      if (!match.selected || match.acquiredAmount <= 0 || !isMistCloudMatch(match)) continue;
      intents.push({
        intentType: 'material_state',
        id: `material-state:water-reversion:${acquisition.operatorNodeId}:${match.sourceId}`,
        nodeId: acquisition.operatorNodeId,
        active: lifecycle.active,
        degraded: !lifecycle.active,
        reason: lifecycle.active ? null : lifecycle.phase,
        materialOrigin: 'gathered_mist_cloud_reversion',
        sourceRequired: true,
        noSilentCreation: true,
        sourceAvailable: true,
        sourceRequirementId: `source-requirement:${acquisition.operatorNodeId}`,
        sourceBindingId: `source-binding:${acquisition.operatorNodeId}:${match.sourceId}`,
        sourceId: match.sourceId,
        materialKind: 'water',
        materialFamily: 'water',
        materialState: 'liquid',
        phase: 'liquid',
        renderPreset: 'water_liquid',
        viscosity: MATERIAL_PRESETS.water.viscosity,
        cohesion: MATERIAL_PRESETS.water.cohesion,
        reversion: {
          fromMaterialState: match.materialState ?? match.candidateKind ?? null,
          fromMaterialFamily: match.materialFamily ?? 'water',
          acquiredAmount: roundNumber(match.acquiredAmount, 3),
          sourceMode: acquisition.sourceMode,
          requiresActualGather: true,
          acceptedInputPhases: ['mist_cloud', 'mist', 'cloud'],
          causes,
        },
      });
    }
  }

  return intents;
}

/**
 * @param {object[]} nodes
 * @param {object[]} edges
 */
function coolingReversionCausesByOperator(nodes, edges) {
  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));
  const causes = new Map();

  for (const target of nodes.filter(
    (node) =>
      node.nodeType === 'material_preset' &&
      node.presetKind === 'condensation_candidate' &&
      node.condensationRequiresMaterialIntake === true,
  )) {
    const sourceEdges = edges.filter(
      (edge) => edge.edgeType === 'filters_target' && edge.toNodeId === target.nodeId,
    );
    const coolingEdges = edges.filter(
      (edge) =>
        edge.edgeType === 'drives_specific_energy' &&
        edge.toNodeId === target.nodeId &&
        nodeById.get(edge.fromNodeId)?.temperatureDriver?.direction === 'cool',
    );
    for (const sourceEdge of sourceEdges) {
      const operator = nodeById.get(sourceEdge.fromNodeId);
      if (operator?.nodeType !== 'source_mode' || operator.mode !== 'gather_active') continue;
      const existing = causes.get(operator.nodeId) ?? [];
      for (const coolingEdge of coolingEdges) {
        const driver = nodeById.get(coolingEdge.fromNodeId);
        existing.push({
          cause: 'cooling_condensation',
          driverNodeId: driver?.nodeId ?? null,
          candidateNodeId: target.nodeId,
          thermalEffect: driver?.temperatureDriver?.thermalEffect ?? driver?.weakEffect ?? 'cool',
          instantMaterialCreation: false,
        });
      }
      causes.set(operator.nodeId, existing);
    }
  }

  return causes;
}

/**
 * @param {RuntimeIntent} acquisition
 * @param {RuntimeIntent[]} fieldModifications
 */
function convergenceReversionCausesForAcquisition(acquisition, fieldModifications) {
  const sealKey = sealKeyForNode(acquisition.operatorNodeId);
  return fieldModifications
    .filter(
      (field) =>
        field.signRole === 'convergence' &&
        field.active === true &&
        field.sealKey === sealKey &&
        field.convergenceMode !== 'under_specified',
    )
    .map((field) => ({
      cause: 'convergence_compression',
      fieldModificationId: field.id,
      convergenceMode: field.convergenceMode,
      compressesActiveField: field.fieldModification?.compressesActiveField === true,
      pullsMaterialTowardSigns: field.fieldModification?.pullsMaterialTowardSigns === true,
    }));
}

/**
 * @param {object} match
 */
function isMistCloudMatch(match) {
  const materialState = String(match.materialState ?? '').toLowerCase();
  const candidateKind = String(match.candidateKind ?? '').toLowerCase();
  return [materialState, candidateKind].some((value) =>
    ['mist', 'cloud', 'mist_cloud', 'water_mist', 'water_cloud'].includes(value),
  );
}

/**
 * @param {object | undefined} match
 * @param {string} materialKind
 * @returns {object | null}
 */
function materialStateForGatherHandoff(match, materialKind) {
  if (!match) return null;
  const materialFamily = materialFamilyForKind(materialKind);
  const values = [match.materialState, match.candidateKind]
    .map((value) => String(value ?? '').toLowerCase())
    .filter(Boolean);

  if (materialFamily === 'water') {
    if (values.includes('ice')) {
      return {
        ...MATERIAL_PRESETS.ice,
        materialState: 'ice',
      };
    }
    if (
      values.some((value) =>
        ['mist', 'cloud', 'mist_cloud', 'water_mist', 'water_cloud'].includes(value),
      )
    ) {
      return {
        ...MATERIAL_PRESETS.mist,
        materialState: 'mist_cloud',
      };
    }
  }

  if (
    materialFamily === 'earth' &&
    values.some((value) => ['dust', 'sand', 'crushed_earth'].includes(value))
  ) {
    return {
      ...MATERIAL_PRESETS.crushed_earth,
      materialState: 'crushed_earth',
    };
  }

  return null;
}

/**
 * @param {object} options
 * @param {string} options.materialKind
 * @param {object} options.defaultState
 * @param {object | undefined} options.selectedGatherMatch
 * @param {boolean} options.hasGatheredMaterial
 * @returns {object}
 */
function outputMaterialStateForGatherHandoff({
  materialKind,
  defaultState,
  selectedGatherMatch,
  hasGatheredMaterial,
}) {
  if (!hasGatheredMaterial) return defaultState;
  return materialStateForGatherHandoff(selectedGatherMatch, materialKind) ?? defaultState;
}

/**
 * @param {object} transform
 */
function materialStateForTransform(transform) {
  const toMaterial = transform.toMaterial ?? transform.weakEffect ?? 'unknown';
  const preset = MATERIAL_PRESETS[toMaterial] ?? MATERIAL_PRESETS[materialFamilyForKind(toMaterial)] ?? {};
  const materialFamily = preset.materialFamily ?? materialFamilyForKind(toMaterial);
  return {
    materialKind: toMaterial,
    materialFamily,
    materialState: preset.phase ?? toMaterial,
    phase: preset.phase ?? toMaterial,
    renderPreset: preset.renderPreset ?? toMaterial,
    viscosity: preset.viscosity ?? 1,
    cohesion: preset.cohesion ?? 1,
  };
}

/**
 * @param {object} phase
 */
function materialStateForPhase(phase) {
  const materialKind = phase.targetMaterial ?? materialKindForDomain(phase.registryId) ?? 'material';
  const phaseName = phase.phase ?? 'unspecified';
  const preset =
    phaseName === 'solid'
      ? MATERIAL_PRESETS.ice
      : phaseName === 'gas'
        ? MATERIAL_PRESETS.mist
        : MATERIAL_PRESETS[materialKind] ?? MATERIAL_PRESETS.water;
  return {
    materialKind,
    materialFamily: phase.materialFamily ?? preset.materialFamily ?? materialFamilyForKind(materialKind),
    materialState: phaseName,
    phase: phaseName,
    renderPreset: preset.renderPreset,
    viscosity: preset.viscosity,
    cohesion: preset.cohesion,
  };
}

/**
 * @param {object} transform
 * @param {RuntimeIntent[]} sourceAcquisitions
 */
function materialOriginForTransform(transform, sourceAcquisitions) {
  const family = materialFamilyForKind(transform.fromDomain ?? transform.toMaterial);
  const gather = sourceAcquisitions.find(
    (item) =>
      item.sourceMode === 'gather_active' &&
      item.feedsDownstream === true &&
      item.materialFamily === family,
  );
  return gather ? 'gather_supplied_transform' : 'sigil_generated_transform';
}

/**
 * @param {object[]} nodes
 * @param {object[]} edges
 * @param {object | null} program
 * @param {object} lifecycle
 */
function buildFieldModificationIntents(nodes, edges, program, lifecycle, sourceAcquisitions = []) {
  const bySeal = new Map();
  for (const seal of program?.seals ?? []) {
    const index = program.seals.indexOf(seal);
    const layout = seal.geometryAnalysis?.convergenceLayout;
    if (layout) bySeal.set(`seal${index}`, layout);
  }

  const intents = [];
  for (const [sealKey, layout] of bySeal.entries()) {
    const mode = classifyConvergenceMode(layout);
    const force = nodes.find(
      (node) =>
        node.nodeType === 'force_constraint' &&
        node.registryId === 'sign.convergence' &&
        sealKeyForNode(node.nodeId) === sealKey,
    );
    const targetFieldPolicy = convergenceTargetFieldPolicy(
      nodes,
      edges,
      sourceAcquisitions,
      sealKey,
      lifecycle,
    );
    const hasActiveTargetField = targetFieldPolicy.activeTargetField === true;
    const fieldModification = runtimeConvergenceMetadata(layout, mode, hasActiveTargetField);
    const underSpecified = mode === 'under_specified';
    intents.push({
      intentType: 'field_modification',
      id: `field-modification:${sealKey}:convergence`,
      nodeId: force?.nodeId ?? null,
      sealKey,
      active: lifecycle.active && !underSpecified && hasActiveTargetField,
      diagnosticOnly: underSpecified || !hasActiveTargetField,
      signRole: 'convergence',
      convergenceMode: mode,
      legacyConvergenceMode: force?.convergenceMode ?? (layout.pointFocusEligible ? 'point_focus' : null),
      fieldModification,
      targetFieldPolicy,
      geometry: force?.geometryBinding ?? layout,
      reason: underSpecified
        ? 'requires at least two compatible inward convergence signs'
        : hasActiveTargetField
          ? null
          : targetFieldPolicy.reason,
      evidenceTier: force?.evidenceTier ?? 'fan_documented_plausible',
      warningScoped: force?.warningScoped === true,
    });
  }

  return intents;
}

/**
 * @param {object[]} nodes
 * @param {object[]} edges
 * @param {RuntimeIntent[]} sourceAcquisitions
 * @param {string} sealKey
 * @param {object} lifecycle
 */
function convergenceTargetFieldPolicy(nodes, edges, sourceAcquisitions, sealKey, lifecycle) {
  const targetKinds = [];
  const activeTargetKinds = [];
  const sourceGateBlockedTargetKinds = [];
  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));
  const materialFamilyForOutputNode = (node) => {
    const directDomain = requiredDomainNodeForNode(node, edges, nodeById);
    const directKind = materialKindForDomain(directDomain?.registryId ?? directDomain?.domain);
    if (directKind) return materialFamilyForKind(directKind);

    const sourceObjectIds = new Set(
      (node.sourceObjects ?? []).map((source) => source.objectId).filter(Boolean),
    );
    if (sourceObjectIds.size === 0) return null;
    const siblingDomain = nodes.find(
      (candidate) =>
        candidate.nodeType === 'domain' &&
        sealKeyForNode(candidate.nodeId) === sealKey &&
        (candidate.sourceObjects ?? []).some((source) => sourceObjectIds.has(source.objectId)),
    );
    const siblingKind = materialKindForDomain(siblingDomain?.registryId ?? siblingDomain?.domain);
    return siblingKind ? materialFamilyForKind(siblingKind) : null;
  };
  const acquisitions = sourceAcquisitions.filter(
    (acquisition) => sealKeyForNode(acquisition.operatorNodeId) === sealKey,
  );
  const gateForMaterialFamily = (materialFamily) =>
    acquisitions.find(
      (acquisition) =>
        acquisition.sourceMode === 'gather_active' &&
        acquisition.materialFamily === materialFamily &&
        ['water', 'earth'].includes(materialFamily),
    );
  const addOutputTarget = (kind, materialFamily = null) => {
    targetKinds.push(kind);
    const gate = materialFamily ? gateForMaterialFamily(materialFamily) : null;
    if (gate && gate.satisfied !== true) {
      sourceGateBlockedTargetKinds.push(kind);
      return;
    }
    activeTargetKinds.push(kind);
  };
  const acquisitionHasActiveFlow = (acquisition) =>
    acquisition?.active === true &&
    acquisition.satisfied === true &&
    (acquisition.matches ?? []).some((match) => match.selected === true);
  const addSourceFlowTarget = (kind, operatorNodeId) => {
    targetKinds.push(kind);
    const acquisition = acquisitions.find((item) => item.operatorNodeId === operatorNodeId);
    if (acquisitionHasActiveFlow(acquisition)) {
      activeTargetKinds.push(kind);
    } else {
      sourceGateBlockedTargetKinds.push(kind);
    }
  };

  for (const node of nodes) {
    if (sealKeyForNode(node.nodeId) !== sealKey) continue;
    if (node.registryId === 'sign.convergence') continue;
    if (node.nodeType === 'shape_field') {
      addOutputTarget(`${node.shape ?? 'shape'}_output`, materialFamilyForOutputNode(node));
    } else if (node.nodeType === 'field_lobe') {
      addOutputTarget('field_lobe_output', materialFamilyForOutputNode(node));
    } else if (node.nodeType === 'force_constraint' && node.registryId === 'sign.levitation') {
      addOutputTarget('levitation_force_field');
    } else if (
      node.nodeType === 'source_mode' &&
      ['gather_active', 'collect_nearby', 'pull', 'push'].includes(node.mode)
    ) {
      addSourceFlowTarget(`${node.mode ?? 'source'}_source_flow`, node.nodeId);
    }
  }

  const hasGeneratedOrForceOutput = activeTargetKinds.some(
    (kind) =>
      kind.endsWith('_output') ||
      kind === 'field_lobe_output' ||
      kind === 'levitation_force_field',
  );
  const activeSourceFlow = acquisitions.some(
    (acquisition) => acquisitionHasActiveFlow(acquisition),
  );
  const hasTargetField = targetKinds.length > 0;
  const activeTargetField = lifecycle.active === true && (hasGeneratedOrForceOutput || activeSourceFlow);

  return {
    policyId: 'convergence_requires_active_spell_field',
    hasTargetField,
    activeTargetField,
    targetKinds: Array.from(new Set(targetKinds)).sort(),
    activeTargetKinds: Array.from(new Set(activeTargetKinds)).sort(),
    sourceGateBlockedTargetKinds: Array.from(new Set(sourceGateBlockedTargetKinds)).sort(),
    sourceAcquisitionIds: acquisitions.map((acquisition) => acquisition.id),
    activeSourceFlow,
    generatedOrForceOutput: hasGeneratedOrForceOutput,
    compressesActiveFieldOnly: true,
    pullsMaterialTowardSigns: false,
    standaloneConvergenceCreatesField: false,
    reason: hasTargetField
      ? lifecycle.active
        ? 'requires active generated output or satisfied source-flow field'
        : lifecycle.phase
      : 'requires generated output or source-flow field to compress',
  };
}

/**
 * @param {object} layout
 */
function classifyConvergenceMode(layout) {
  if (layout.ignoredWindWallInference === true) return 'under_specified';
  if (layout.instanceCount < 2 || layout.inwardCount !== layout.instanceCount) {
    return 'under_specified';
  }
  if (layout.symmetric === true && layout.instanceCount === 2) return 'axis_compression';
  if (layout.symmetric === true && layout.instanceCount >= 4) return 'radial_point_focus';
  if (layout.instanceCount >= 3) return 'biased_compression';
  return layout.pointFocusEligible === true ? 'axis_compression' : 'under_specified';
}

/**
 * @param {object} layout
 * @param {string} mode
 * @param {boolean} compressesActiveField
 */
function runtimeConvergenceMetadata(layout, mode, compressesActiveField = true) {
  const vectorSummary = layout.vectorSummary ?? {};
  const biasVector = normalize2D({
    x: finite(vectorSummary.x, 0),
    y: finite(vectorSummary.y, 0),
  });
  const anisotropy =
    mode === 'axis_compression'
      ? 1
      : mode === 'biased_compression'
        ? Math.max(0.25, finite(layout.biasMagnitude, 0))
        : 0;
  return {
    convergenceMode: mode,
    compressionAxes: convergenceCompressionAxes(layout, mode),
    radialCompression: mode === 'radial_point_focus' ? 1 : 0,
    anisotropy: roundNumber(anisotropy, 4),
    biasVector: mode === 'biased_compression' ? biasVector : { x: 0, y: 0 },
    compressesActiveField,
    pullsMaterialTowardSigns: false,
  };
}

/**
 * @param {object} layout
 * @param {string} mode
 */
function convergenceCompressionAxes(layout, mode) {
  if (mode === 'radial_point_focus') {
    return [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
  }
  const first = layout.instances?.[0];
  const angle = normalizeDegrees(finite(first?.positionAngleDeg, 0));
  const rad = (angle * Math.PI) / 180;
  const axis = { x: roundNumber(Math.cos(rad), 6), y: roundNumber(Math.sin(rad), 6) };
  if (mode === 'axis_compression') return [axis];
  if (mode === 'biased_compression') return [axis, normalize2D(layout.vectorSummary ?? {})];
  return [];
}

/**
 * @param {RuntimeIntent[]} fieldModifications
 * @param {object} force
 */
function findFieldModificationForForce(fieldModifications, force) {
  if (force.registryId !== 'sign.convergence') return null;
  const sealKey = sealKeyForNode(force.nodeId);
  return fieldModifications.find((item) => item.sealKey === sealKey) ?? null;
}

/**
 * @param {RuntimeIntent[]} sourceAcquisitions
 * @param {string} materialFamily
 * @param {string} sealKey
 */
function gatherSupplyForOutput(sourceAcquisitions, materialFamily, sealKey) {
  return sourceAcquisitions.find(
    (item) =>
      item.sourceMode === 'gather_active' &&
      item.materialFamily === materialFamily &&
      (item.sealKey ?? sealKeyForNode(item.operatorNodeId)) === sealKey,
  );
}

/**
 * @param {RuntimeIntent[]} sourceAcquisitions
 * @param {string} materialFamily
 * @param {string} sealKey
 */
function otherSealGatherSupplyForOutput(sourceAcquisitions, materialFamily, sealKey) {
  return sourceAcquisitions.find(
    (item) =>
      item.sourceMode === 'gather_active' &&
      item.materialFamily === materialFamily &&
      (item.sealKey ?? sealKeyForNode(item.operatorNodeId)) !== sealKey,
  );
}

/**
 * @param {RuntimeIntent | undefined} gatherSupply
 */
function ignoredGatherHandoffForOutput(gatherSupply) {
  if (!gatherSupply) return null;
  return {
    operatorNodeId: gatherSupply.operatorNodeId,
    sealKey: gatherSupply.sealKey ?? sealKeyForNode(gatherSupply.operatorNodeId),
    reason: 'multi_ring_gather_handoff_requires_explicit_future_rule',
    policy: 'same_seal_phase1',
  };
}

/**
 * @param {object[]} nodes
 * @param {object | null} program
 * @param {{ placementFrame: object; lifecycle: object; regionDistributions: RuntimeIntent[]; sourceAcquisitions: RuntimeIntent[] }} context
 */
function buildColumnIntents(nodes, edges, program, context) {
  const columns = nodes.filter(
    (node) => node.nodeType === 'shape_field' && node.shape === 'column',
  );
  const bySeal = groupBy(columns, (column) => sealKeyForNode(column.nodeId));
  const symbolIndex = indexSymbols(program);
  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));

  return [...bySeal.entries()].map(([sealKey, sealColumns]) => {
    const sourceObjectIds = [
      ...new Set(
        sealColumns.flatMap((column) =>
          (column.sourceObjects ?? []).map((source) => source.objectId).filter(Boolean),
        ),
      ),
    ];
    const sourceSymbols = sourceObjectIds
      .map((id) => symbolIndex.get(id))
      .filter(Boolean);
    const representative = sealColumns[0] ?? {};
    const domainNode = domainNodeForShape(representative, edges, nodeById);
    const materialKind =
      materialKindForDomain(domainNode?.registryId ?? domainNode?.domain) ?? 'water';
    const materialFamily = materialFamilyForKind(materialKind);
    const geometry = representative.geometryBinding ?? {};
    const signSizeAverage =
      average(sourceSymbols.map((symbol) => symbol.geometry?.size).filter(isFiniteNumber)) ??
      200;
    const displayMaxRadius = displayMaxRadiusForSeal(program, sealKey);
    const thicknessRingRadius =
      containingRingRadiusForSymbols(program, sealKey, sourceSymbols) ?? displayMaxRadius;
    const localAxis = visualColumnLocalAxis(sealColumns);
    const sceneAxis = localDirectionToScene(context.placementFrame, localAxis);
    const magnitude = sealColumns.reduce(
      (sum, column) => sum + finite(column.geometryBinding?.magnitude, 1),
      0,
    );
    const geometryBudget = scaleGeneratedBudgetForPlacement(
      generatedColumnBudget({
        materialKind,
        signSizeAverage,
        magnitude,
        thicknessRingRadius,
        columnRadiusRatio: 0.7,
        columnHeightMultiplier: COLUMN_HEIGHT_MULTIPLIER,
      }),
      context.placementFrame.worldScale,
    );
    const region =
      context.regionDistributions.find((item) => item.sealKey === sealKey) ?? null;
    const fieldModification = (context.fieldModifications ?? []).find(
      (item) =>
        item.sealKey === sealKey &&
        item.signRole === 'convergence' &&
        item.active === true,
    ) ?? null;
    const gatherSupply = gatherSupplyForOutput(
      context.sourceAcquisitions,
      materialFamily,
      sealKey,
    );
    const ignoredOtherSealGatherSupply = otherSealGatherSupplyForOutput(
      context.sourceAcquisitions,
      materialFamily,
      sealKey,
    );
    const gatherConstrained = Boolean(
      gatherSupply && ['water', 'earth'].includes(materialFamily),
    );
    const gatheredAmount = Math.max(0, finite(gatherSupply?.acquiredAmount, 0));
    const hasGatheredMaterial = gatherConstrained && gatheredAmount > 0;
    const budget = sourceLimitedBudgetForGather(
      geometryBudget,
      gatherConstrained ? gatherSupply : null,
    );
    const emergenceAnchors =
      region?.anchors.map((anchor) => ({
        ...anchor,
        budgetAmount: roundNumber(budget.amount * anchor.budgetShare, 4),
      })) ?? [
        {
          anchorId: `region-anchor:${sealKey}:center`,
          placement: 'center',
          weight: 1,
          budgetShare: 1,
          localPosition: { x: 0, y: 0, z: 0 },
          scenePosition: localToScene(context.placementFrame, { x: 0, y: 0, z: 0.22 }),
          budgetAmount: budget.amount,
        },
      ];
    const primaryAnchor = emergenceAnchors[0];
    const materialOrigin = hasGatheredMaterial
      ? 'gather_supplied'
      : gatherConstrained
        ? 'gather_required_missing'
      : 'sigil_generated';
    const active = context.lifecycle.active && (!gatherConstrained || hasGatheredMaterial);
    const degraded =
      !context.lifecycle.active || (gatherConstrained && gatherSupply?.satisfied !== true);
    const reason = !context.lifecycle.active
      ? context.lifecycle.phase
      : gatherConstrained && !hasGatheredMaterial
        ? gatherSupply?.reason ?? 'gather_required_no_material_available'
        : gatherConstrained && gatherSupply?.satisfied !== true
          ? 'gather_source_limited_actual_material_below_required'
          : null;
    const selectedGatherMatch = gatherSupply?.matches?.find((match) => match.selected);
    const materialState = outputMaterialStateForGatherHandoff({
      materialKind,
      defaultState: columnMaterialState(materialKind),
      selectedGatherMatch,
      hasGatheredMaterial,
    });
    return {
      intentType: materialKind === 'water' ? 'water_column' : 'material_column',
      id: `intent:${materialKind}-column:${sealKey}`,
      nodeId: representative.nodeId,
      collapsedNodeIds: sealColumns.map((column) => column.nodeId),
      active,
      degraded,
      reason,
      materialKind,
      materialFamily,
      materialState: materialState.materialState,
      phase: materialState.phase,
      renderPreset: materialState.renderPreset,
      columnBehavior: columnBehaviorForMaterial(materialKind),
      interactionPolicy: columnInteractionPolicyForMaterial(materialKind),
      physicsField: physicsFieldForColumn({
        active,
        materialKind,
        origin:
          primaryAnchor.scenePosition ??
          localToScene(context.placementFrame, { x: 0, y: 0, z: 0.22 }),
        direction: sceneAxis,
        magnitude,
        signSizeAverage,
        thicknessRingRadius,
        displayMaxRadius,
        columnRadiusRatio: 0.7,
        columnHeightMultiplier: COLUMN_HEIGHT_MULTIPLIER,
        worldScale: context.placementFrame.worldScale,
      }),
      materialOrigin,
      sourceRequirementId: gatherConstrained
        ? `source-requirement:${gatherSupply.operatorNodeId}`
        : null,
      sourceBindingId: selectedGatherMatch?.sourceId
        ? `source-binding:${gatherSupply.operatorNodeId}:${selectedGatherMatch.sourceId}`
        : null,
      sourceId: selectedGatherMatch?.sourceId ?? null,
      sourceMaterialState: selectedGatherMatch?.materialState ?? null,
      sourceCandidateKind: selectedGatherMatch?.candidateKind ?? null,
      sourceMaterialFamily: selectedGatherMatch?.materialFamily ?? null,
      gatheredMaterialPreserved: hasGatheredMaterial && Boolean(selectedGatherMatch),
      sourceMaterialHandoffPolicy:
        hasGatheredMaterial && selectedGatherMatch
          ? 'preserve_actual_gathered_material_state_until_transform'
          : null,
      sourceHandoffScope: gatherConstrained ? 'same_seal_phase1' : 'none',
      ignoredSourceHandoff:
        !gatherSupply && ignoredOtherSealGatherSupply
          ? ignoredGatherHandoffForOutput(ignoredOtherSealGatherSupply)
          : null,
      origin:
        primaryAnchor.scenePosition ??
        localToScene(context.placementFrame, { x: 0, y: 0, z: 0.22 }),
      originPolicy:
        hasGatheredMaterial
          ? 'spell_origin_shaped_from_gathered_material'
          : 'spell_placement_frame_or_region_anchor',
      sourceFreeOrigin: !gatherConstrained,
      localOrigin: primaryAnchor.localPosition ?? { x: 0, y: 0, z: 0.22 },
      axis: geometry.axis ?? null,
      localAxis,
      sceneAxis,
      directionPolicy: 'weighted_inward_push_away_from_stronger_sign',
      magnitude,
      spread:
        average(
          sealColumns.map((column) => column.geometryBinding?.spread).filter(isFiniteNumber),
        ) ?? 0.08,
      fieldModificationId: fieldModification?.id ?? null,
      convergenceMode: fieldModification?.convergenceMode ?? null,
      fieldModification: fieldModification?.fieldModification ?? null,
      compressionVisual:
        fieldModification
          ? compressionVisualForFieldModification(fieldModification)
          : null,
      compressedByConvergence: Boolean(fieldModification),
      centered: sealColumns.some((column) => column.geometryBinding?.centered === true),
      biased: sealColumns.some((column) => column.geometryBinding?.biased === true),
      symmetryClass: geometry.symmetryClass ?? null,
      signSizeAverage,
      signSizeScale: signSizeAverage / 200,
      worldScale: context.placementFrame.worldScale,
      sourceObjectCount: sourceObjectIds.length,
      displayMaxRadius,
      thicknessRingRadius,
      columnRadiusRatio: 0.7,
      columnHeightMultiplier: COLUMN_HEIGHT_MULTIPLIER,
      resourceBudget: budget,
      sourceRequired: gatherConstrained,
      sourcePolicy:
        hasGatheredMaterial
          ? 'gather_supplied_source_limited_actual_material'
          : gatherConstrained
            ? 'gather_required_no_material_available'
          : 'source_free_sigil_generation',
      noSilentMaterialCreation: true,
      gatheredAmount: gatherConstrained ? roundNumber(gatheredAmount, 4) : null,
      gatherSatisfied: gatherConstrained ? gatherSupply?.satisfied === true : null,
      emergence: {
        regionIntentId: region?.id ?? null,
        regionZone: region?.regionZone ?? 'center_default',
        anchorCount: emergenceAnchors.length,
        anchors: emergenceAnchors,
        budgetPolicy: 'weighted_split_no_power_gain',
        appliedPhase: 'late_output_placement',
        vectorSemanticsUnaffected: true,
      },
      placementFrame: {
        normal: context.placementFrame.normal,
        tangent: context.placementFrame.tangent,
        bitangent: context.placementFrame.bitangent,
      },
      evidenceTier: representative.evidenceTier ?? null,
      warningScoped: representative.warningScoped === true,
    };
  });
}

/**
 * @param {object[]} nodes
 * @param {object[]} edges
 * @param {object | null} program
 * @param {{ placementFrame: object; lifecycle: object; regionDistributions: RuntimeIntent[]; sourceAcquisitions: RuntimeIntent[]; fieldModifications?: RuntimeIntent[] }} context
 */
function buildDispersionIntents(nodes, edges, program, context) {
  const dispersions = nodes.filter(
    (node) => node.nodeType === 'shape_field' && node.shape === 'dispersion',
  );
  const bySeal = groupBy(dispersions, (dispersion) => sealKeyForNode(dispersion.nodeId));
  const symbolIndex = indexSymbols(program);
  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));

  return [...bySeal.entries()].map(([sealKey, sealDispersions]) => {
    const budgetDispersions = sealDispersions.filter(
      (dispersion) =>
        dispersion.geometryBinding?.axis ||
        isFiniteNumber(dispersion.geometryBinding?.magnitude),
    );
    const effectiveDispersions =
      budgetDispersions.length > 0 ? budgetDispersions : sealDispersions;
    const sourceObjectIds = [
      ...new Set(
        sealDispersions.flatMap((dispersion) =>
          (dispersion.sourceObjects ?? []).map((source) => source.objectId).filter(Boolean),
        ),
      ),
    ];
    const sourceSymbols = sourceObjectIds
      .map((id) => symbolIndex.get(id))
      .filter(Boolean);
    const representative = effectiveDispersions[0] ?? {};
    const domainNode = domainNodeForShape(representative, edges, nodeById);
    const materialKind =
      materialKindForDomain(domainNode?.registryId ?? domainNode?.domain) ?? 'water';
    const materialFamily = materialFamilyForKind(materialKind);
    const geometries = effectiveDispersions.map((dispersion) => dispersion.geometryBinding ?? {});
    const geometry = representative.geometryBinding ?? {};
    const signSizeAverage =
      average(sourceSymbols.map((symbol) => symbol.geometry?.size).filter(isFiniteNumber)) ??
      DEFAULT_SIGN_SIZE;
    const displayMaxRadius = displayMaxRadiusForSeal(program, sealKey);
    const thicknessRingRadius =
      containingRingRadiusForSymbols(program, sealKey, sourceSymbols) ?? displayMaxRadius;
    const rawMagnitude = effectiveDispersions.reduce(
      (sum, dispersion) => sum + finite(dispersion.geometryBinding?.magnitude, 1),
      0,
    );
    const magnitude = Math.min(rawMagnitude, Math.max(1, sourceObjectIds.length));
    const spread = average(geometries.map((item) => item.spread).filter(isFiniteNumber)) ?? 0.55;
    const localAxis = visualDispersionLocalAxis(materialKind, effectiveDispersions, sourceSymbols);
    const sceneAxis = localDirectionToScene(context.placementFrame, localAxis);
    const sourceAnchors = resolveDispersionSourceAnchors({
      sourceSymbols,
      displayMaxRadius,
      placementFrame: context.placementFrame,
    });
    const geometryBudget = scaleGeneratedBudgetForPlacement(
      generatedDispersionBudget({
        materialKind,
        signSizeAverage,
        magnitude,
        thicknessRingRadius,
        columnRadiusRatio: 0.7,
        columnHeightMultiplier: 1,
        dispersionSpread: spread,
      }),
      context.placementFrame.worldScale,
    );
    const region =
      context.regionDistributions.find((item) => item.sealKey === sealKey) ?? null;
    const fieldModification =
      (context.fieldModifications ?? []).find(
        (item) =>
          item.sealKey === sealKey &&
          item.signRole === 'convergence' &&
          item.active === true,
      ) ?? null;
    const gatherSupply = gatherSupplyForOutput(
      context.sourceAcquisitions,
      materialFamily,
      sealKey,
    );
    const ignoredOtherSealGatherSupply = otherSealGatherSupplyForOutput(
      context.sourceAcquisitions,
      materialFamily,
      sealKey,
    );
    const gatherConstrained = Boolean(
      gatherSupply && ['water', 'earth'].includes(materialFamily),
    );
    const gatheredAmount = Math.max(0, finite(gatherSupply?.acquiredAmount, 0));
    const hasGatheredMaterial = gatherConstrained && gatheredAmount > 0;
    const budget = sourceLimitedBudgetForGather(
      geometryBudget,
      gatherConstrained ? gatherSupply : null,
    );
    const emergenceAnchors =
      region?.anchors.map((anchor) => ({
        ...anchor,
        budgetAmount: roundNumber(budget.amount * anchor.budgetShare, 4),
      })) ?? [
        {
          anchorId: `region-anchor:${sealKey}:center`,
          placement: 'center',
          weight: 1,
          budgetShare: 1,
          localPosition: { x: 0, y: 0, z: 0 },
          scenePosition: localToScene(context.placementFrame, { x: 0, y: 0, z: 0.22 }),
          budgetAmount: budget.amount,
        },
      ];
    const primaryAnchor = emergenceAnchors[0];
    const active = context.lifecycle.active && (!gatherConstrained || hasGatheredMaterial);
    const degraded =
      !context.lifecycle.active || (gatherConstrained && gatherSupply?.satisfied !== true);
    const reason = !context.lifecycle.active
      ? context.lifecycle.phase
      : gatherConstrained && !hasGatheredMaterial
        ? gatherSupply?.reason ?? 'gather_required_no_material_available'
        : gatherConstrained && gatherSupply?.satisfied !== true
          ? 'gather_source_limited_actual_material_below_required'
          : null;
    const selectedGatherMatch = gatherSupply?.matches?.find((match) => match.selected);
    const materialState = outputMaterialStateForGatherHandoff({
      materialKind,
      defaultState: dispersionMaterialState(materialKind),
      selectedGatherMatch,
      hasGatheredMaterial,
    });

    return {
      intentType: materialKind === 'water' ? 'water_dispersion' : 'material_dispersion',
      id: `intent:${materialKind}-dispersion:${sealKey}`,
      nodeId: representative.nodeId,
      collapsedNodeIds: sealDispersions.map((dispersion) => dispersion.nodeId),
      active,
      degraded,
      reason,
      materialKind,
      materialFamily,
      materialState: materialState.materialState,
      phase: materialState.phase,
      renderPreset: materialState.renderPreset,
      dispersionBehavior: dispersionBehaviorForMaterial(materialKind),
      interactionPolicy: dispersionInteractionPolicyForMaterial(materialKind),
      outputProfile: dispersionOutputProfileForMaterial(materialKind),
      physicsField: physicsFieldForDispersion({
        active,
        materialKind,
        origin:
          primaryAnchor.scenePosition ??
          localToScene(context.placementFrame, { x: 0, y: 0, z: 0.22 }),
        placementFrame: context.placementFrame,
        magnitude,
        signSizeAverage,
        sourceAnchors,
      }),
      gravityBehavior:
        materialKind === 'water'
          ? {
              enabled: true,
              mode: 'sheet_continues_then_falls',
              falloff: 'post_spell_plane_ballistic_sheet',
              gravityScale: 1,
              sheetCohesion: 0.62,
              breakup: 'edge_droplets_after_fall',
            }
          : null,
      materialOrigin: hasGatheredMaterial
        ? 'gather_supplied'
        : gatherConstrained
          ? 'gather_required_missing'
          : 'sigil_generated',
      sourceRequirementId: gatherConstrained
        ? `source-requirement:${gatherSupply.operatorNodeId}`
        : null,
      sourceBindingId: selectedGatherMatch?.sourceId
        ? `source-binding:${gatherSupply.operatorNodeId}:${selectedGatherMatch.sourceId}`
        : null,
      sourceId: selectedGatherMatch?.sourceId ?? null,
      sourceMaterialState: selectedGatherMatch?.materialState ?? null,
      sourceCandidateKind: selectedGatherMatch?.candidateKind ?? null,
      sourceMaterialFamily: selectedGatherMatch?.materialFamily ?? null,
      gatheredMaterialPreserved: hasGatheredMaterial && Boolean(selectedGatherMatch),
      sourceMaterialHandoffPolicy:
        hasGatheredMaterial && selectedGatherMatch
          ? 'preserve_actual_gathered_material_state_until_transform'
          : null,
      sourceHandoffScope: gatherConstrained ? 'same_seal_phase1' : 'none',
      ignoredSourceHandoff:
        !gatherSupply && ignoredOtherSealGatherSupply
          ? ignoredGatherHandoffForOutput(ignoredOtherSealGatherSupply)
          : null,
      origin:
        primaryAnchor.scenePosition ??
        localToScene(context.placementFrame, { x: 0, y: 0, z: 0.22 }),
      originPolicy:
        hasGatheredMaterial
          ? 'spell_origin_shaped_from_gathered_material'
          : 'spell_placement_frame_or_region_anchor',
      sourceFreeOrigin: !gatherConstrained,
      localOrigin: primaryAnchor.localPosition ?? { x: 0, y: 0, z: 0.22 },
      axis: geometry.axis ?? null,
      localAxis,
      sceneAxis,
      magnitude,
      spread,
      emissionKind:
        geometries.find((item) => item.fieldModification?.emissionKind)?.fieldModification
          ?.emissionKind ?? 'outward_dispersion',
      dispersionGeometry: {
        directionalBasis: 'dispersion_sign_position_not_column_push',
        sourceAnchorPolicy:
          sourceAnchors.length > 0
            ? 'coverage_only_from_dispersion_sign_positions'
            : 'center_fallback',
        sourceAnchors,
        sheet:
          materialKind === 'water'
            ? {
                shape: 'thin_falling_sheet',
                thicknessRatio: 0.18,
                widthMultiplier: roundNumber(1.15 + spread * 0.75, 4),
                gravityAffected: true,
              }
            : null,
      },
      fieldModificationId: fieldModification?.id ?? null,
      convergenceMode: fieldModification?.convergenceMode ?? null,
      fieldModification:
        fieldModification?.fieldModification ??
        geometries.find((item) => item.fieldModification?.emissionKind)?.fieldModification ??
        null,
      compressionVisual:
        fieldModification
          ? compressionVisualForFieldModification(fieldModification)
          : null,
      compressedByConvergence: Boolean(fieldModification),
      centered: effectiveDispersions.some(
        (dispersion) => dispersion.geometryBinding?.symmetric === true,
      ),
      biased: effectiveDispersions.some(
        (dispersion) => finite(dispersion.geometryBinding?.biasMagnitude, 0) > 0.001,
      ),
      symmetryClass: geometry.symmetryClass ?? null,
      signSizeAverage,
      signSizeScale: signSizeAverage / DEFAULT_SIGN_SIZE,
      worldScale: context.placementFrame.worldScale,
      sourceObjectCount: sourceObjectIds.length,
      displayMaxRadius,
      thicknessRingRadius,
      columnRadiusRatio: 0.7,
      resourceBudget: budget,
      sourceRequired: gatherConstrained,
      sourcePolicy:
        hasGatheredMaterial
          ? 'gather_supplied_source_limited_actual_material'
          : gatherConstrained
            ? 'gather_required_no_material_available'
          : 'source_free_sigil_generation',
      noSilentMaterialCreation: true,
      gatheredAmount: gatherConstrained ? roundNumber(gatheredAmount, 4) : null,
      gatherSatisfied: gatherConstrained ? gatherSupply?.satisfied === true : null,
      emergence: {
        regionIntentId: region?.id ?? null,
        regionZone: region?.regionZone ?? 'center_default',
        anchorCount: emergenceAnchors.length,
        anchors: emergenceAnchors,
        budgetPolicy: 'weighted_split_no_power_gain',
        appliedPhase: 'late_output_placement',
        vectorSemanticsUnaffected: true,
      },
      placementFrame: {
        origin: context.placementFrame.origin,
        normal: context.placementFrame.normal,
        tangent: context.placementFrame.tangent,
        bitangent: context.placementFrame.bitangent,
        worldScale: context.placementFrame.worldScale,
      },
      evidenceTier: representative.evidenceTier ?? null,
      warningScoped: representative.warningScoped === true,
    };
  });
}

/**
 * Light has no physics field. This separate render-neutral intent carries only
 * the spatial/presentation contract that a renderer needs to place a bounded
 * local emitter. It deliberately contains no Three or browser values.
 *
 * @param {RuntimeIntent[]} outputs
 * @param {object} lifecycle
 */
function buildIlluminationIntents(outputs, lifecycle) {
  return outputs
    .filter((output) => output.materialKind === 'light')
    .map((output) => {
      const worldScale = clamp(
        finite(output.worldScale ?? output.placementFrame?.worldScale, 1),
        0.25,
        4,
      );
      const signScale = Math.max(0.35, finite(output.signSizeScale, 1));
      const magnitude = Math.max(0, finite(output.magnitude, 1));
      const isDispersion = output.intentType === 'material_dispersion';
      const origin = normalizePosition(output.origin, DEFAULT_PLACEMENT_FRAME.origin);
      const normal = normalizeSceneVector(output.placementFrame?.normal);
      const direction = normalizeSceneVector(
        output.sceneAxis ?? output.placementFrame?.normal ?? DEFAULT_PLACEMENT_FRAME.normal,
      );
      const radius = roundNumber(
        clamp((isDispersion ? 0.48 : 0.28 + magnitude * 0.035) * worldScale, 0.16, 0.9),
        4,
      );
      const reach = roundNumber(
        clamp(
          (isDispersion
            ? 0.46 + 1.05 * signScale
            : 0.9 + magnitude * 0.34 * signScale) * worldScale,
          0.7,
          5.5,
        ),
        4,
      );
      const intensity = roundNumber(
        clamp((isDispersion ? 0.72 : 0.9) + magnitude * 0.12, 0.35, 1.8),
        4,
      );
      return {
        intentType: 'illumination',
        id: `intent:illumination:${output.id}`,
        sourceIntentId: output.id,
        active: output.active === true && lifecycle.active === true,
        materialKind: 'light',
        emitterOrigin: origin,
        origin,
        normal,
        direction,
        radius,
        reach,
        color: '#fff0b0',
        intensity,
        falloff: 'inverse_square_bounded_local',
        shape: isDispersion ? 'dispersion_fan' : 'column_beam',
        worldScale,
        lifecycle: {
          active: lifecycle.active === true,
          phase: lifecycle.phase ?? null,
          mode: lifecycle.mode ?? null,
          stopsWithSpellLifecycle: true,
        },
        placementFrame: {
          normal,
          tangent: output.placementFrame?.tangent ?? DEFAULT_PLACEMENT_FRAME.tangent,
          bitangent: output.placementFrame?.bitangent ?? DEFAULT_PLACEMENT_FRAME.bitangent,
        },
        noPhysicsForce: true,
        debugPolicy: 'renderer_samples_bounded_spatial_falloff',
      };
    });
}

/**
 * @param {RuntimeIntent} fieldModification
 */
function compressionVisualForFieldModification(fieldModification) {
  if (fieldModification.convergenceMode === 'radial_point_focus') {
    return {
      visualPreset: 'radial_tightened_column',
      crossSectionScaleX: 0.74,
      crossSectionScaleZ: 0.74,
      radiusMultiplier: 0.74,
    };
  }
  if (fieldModification.convergenceMode === 'biased_compression') {
    const bias = fieldModification.fieldModification?.biasVector ?? { x: 0, y: 0 };
    const biasStrength = Math.min(0.35, Math.hypot(finite(bias.x, 0), finite(bias.y, 0)) * 0.2);
    return {
      visualPreset: 'biased_pinched_column',
      crossSectionScaleX: 0.72,
      crossSectionScaleZ: roundNumber(1.08 + biasStrength, 4),
      radiusMultiplier: 0.9,
    };
  }
  return {
    visualPreset: 'axis_ovalized_column',
    crossSectionScaleX: 0.58,
    crossSectionScaleZ: 1.18,
    radiusMultiplier: 0.88,
  };
}

/**
 * @param {object} shape
 * @param {object[]} edges
 * @param {Map<string, object>} nodeById
 */
function domainNodeForShape(shape, edges, nodeById) {
  const edge = edges.find(
    (item) => item.edgeType === 'requires' && item.fromNodeId === shape.nodeId,
  );
  return edge ? nodeById.get(edge.toNodeId) ?? null : null;
}

/**
 * @param {object} node
 * @param {object[]} edges
 * @param {Map<string, object>} nodeById
 */
function requiredDomainNodeForNode(node, edges, nodeById) {
  const edge = edges.find(
    (item) => item.edgeType === 'requires' && item.fromNodeId === node.nodeId,
  );
  return edge ? nodeById.get(edge.toNodeId) ?? null : null;
}

/**
 * @param {object} force
 * @param {object[]} edges
 * @param {object | null} program
 * @param {Map<string, object>} nodeById
 */
function levitationBudgetForForce(force, edges, program, nodeById) {
  if (force.registryId !== 'sign.levitation') return null;

  const sealKey = sealKeyForNode(force.nodeId);
  const domainNode = requiredDomainNodeForNode(force, edges, nodeById);
  const materialKind =
    materialKindForDomain(domainNode?.registryId ?? domainNode?.domain) ?? 'force';
  const levitationSymbols = symbolsForSealAndRegistry(program, sealKey, 'sign.levitation');
  const signSizeAverage =
    average(levitationSymbols.map((symbol) => symbol.geometry?.size).filter(isFiniteNumber)) ??
    force.heightFromSignLength ??
    DEFAULT_SIGN_SIZE;
  const displayMaxRadius = displayMaxRadiusForSeal(program, sealKey);
  const verticalLift = finite(
    force.verticalLift ?? force.geometryBinding?.verticalLift,
    signSizeAverage,
  );

  return generatedLevitationBudget({
    materialKind,
    signSizeAverage,
    displayMaxRadius,
    verticalLift,
  });
}

/**
 * @param {object} force
 * @param {object | null} generatedBudget
 */
function levitationVisualForForce(force, generatedBudget) {
  if (force.registryId !== 'sign.levitation' || !generatedBudget) return null;
  const rawTranslationVector = force.translationVector ?? force.geometryBinding?.translationVector ?? {
    x: 0,
    y: 0,
  };
  const translationVector = {
    x: finite(rawTranslationVector.x, 0) === 0 ? 0 : finite(rawTranslationVector.x, 0),
    y: finite(rawTranslationVector.y, 0) === 0 ? 0 : finite(rawTranslationVector.y, 0),
  };
  const visualPreset =
    force.continuousStream === true
      ? 'levitation_continuous_stream'
      : force.oneShotLaunch === true
        ? 'levitation_launch_vector'
        : 'levitation_stable_hover';
  return {
    visualPreset,
    visualShape: 'levitation_force_field',
    materialKind: generatedBudget.materialKind,
    materialFamily: materialFamilyForKind(generatedBudget.materialKind),
    motionMode: force.motionMode ?? force.geometryBinding?.motionMode ?? null,
    centeredFloat: force.geometryBinding?.centeredFloat === true,
    continuousStream: force.continuousStream === true,
    oneShotLaunch: force.oneShotLaunch === true,
    translationVector,
    tangentialBias: finite(force.tangentialBias ?? force.geometryBinding?.tangentialBias, 0),
    torqueDirection: force.torqueDirection ?? force.geometryBinding?.torqueDirection ?? 'none',
    verticalLift: finite(force.verticalLift ?? force.geometryBinding?.verticalLift, 0),
    renderPolicy: 'visualize_force_field_without_moving_objects_until_physics_phase',
  };
}

/**
 * @param {string} materialKind
 */
function columnMaterialState(materialKind) {
  if (materialKind === 'earth') return MATERIAL_PRESETS.earth;
  if (materialKind === 'fire') {
    return {
      materialFamily: 'fire',
      materialState: 'flame_column',
      phase: 'flame_column',
      renderPreset: 'fire_column',
      viscosity: 0.12,
      cohesion: 0,
    };
  }
  if (materialKind === 'wind') {
    return {
      materialFamily: 'wind',
      phase: 'airflow',
      renderPreset: 'wind_air_beam',
      viscosity: 0.08,
      cohesion: 0.05,
    };
  }
  if (materialKind === 'light') {
    return {
      materialFamily: 'light',
      phase: 'beam',
      renderPreset: 'light_beam',
      viscosity: 0,
      cohesion: 0,
    };
  }
  return MATERIAL_PRESETS.water;
}

/**
 * @param {string} materialKind
 */
function dispersionMaterialState(materialKind) {
  if (materialKind === 'water') {
    return {
      materialFamily: 'water',
      materialState: 'sheet',
      phase: 'falling_sheet',
      renderPreset: 'water_sheet_dispersion',
      viscosity: 0.46,
      cohesion: 0.62,
    };
  }
  if (materialKind === 'earth') {
    return {
      materialFamily: 'earth',
      materialState: 'granular_spray',
      phase: 'granular_spray',
      renderPreset: 'earth_granular_dispersion',
      viscosity: 1.1,
      cohesion: 0.42,
    };
  }
  if (materialKind === 'fire') {
    return {
      materialFamily: 'fire',
      materialState: 'heat_plume',
      phase: 'heat_plume',
      renderPreset: 'fire_heat_dispersion',
      viscosity: 0.12,
      cohesion: 0,
    };
  }
  if (materialKind === 'wind') {
    return {
      materialFamily: 'wind',
      materialState: 'air_spray',
      phase: 'airflow',
      renderPreset: 'wind_air_dispersion',
      viscosity: 0.05,
      cohesion: 0,
    };
  }
  if (materialKind === 'light') {
    return {
      materialFamily: 'light',
      materialState: 'diffuse_light',
      phase: 'diffuse_light',
      renderPreset: 'light_dispersion',
      viscosity: 0,
      cohesion: 0,
    };
  }
  return {
    materialFamily: materialFamilyForKind(materialKind),
    materialState: 'diffuse_output',
    phase: 'diffuse_output',
    renderPreset: 'generic_dispersion',
    viscosity: 0.4,
    cohesion: 0.2,
  };
}

/**
 * @param {string} materialKind
 */
function columnBehaviorForMaterial(materialKind) {
  if (materialKind === 'earth') return 'solid_pillar_emerges_from_spell_plane';
  if (materialKind === 'fire') return 'flame_column_warning_scoped_no_material_source';
  if (materialKind === 'wind') return 'air_beam_force_deferred_to_physics';
  if (materialKind === 'light') return 'illumination_beam_no_heat_or_force';
  return 'flowing_water_column';
}

/**
 * @param {string} materialKind
 */
function columnInteractionPolicyForMaterial(materialKind) {
  if (materialKind === 'wind') {
    return {
      heat: 'none',
      force: 'deferred_to_physics_phase',
      movesObjectsImmediately: false,
      illumination: false,
      materialOutput: 'generated_airflow_beam',
    };
  }
  if (materialKind === 'light') {
    return {
      heat: 'none',
      force: 'none',
      movesObjectsImmediately: false,
      illumination: true,
      materialOutput: 'generated_illumination_beam',
    };
  }
  if (materialKind === 'earth') {
    return {
      heat: 'none',
      force: 'solid_push_or_shatter_in_physics_phase',
      movesObjectsImmediately: false,
      illumination: false,
      materialOutput: 'generated_solid_pillar',
    };
  }
  if (materialKind === 'fire') {
    return {
      heat: 'heat_plume_warning_scoped',
      force: 'deferred_to_physics_phase',
      movesObjectsImmediately: false,
      illumination: false,
      materialOutput: 'generated_flame_column',
    };
  }
  return {
    heat: 'none',
    force: 'deferred_to_physics_phase',
    movesObjectsImmediately: false,
    illumination: false,
    materialOutput: 'generated_or_gathered_water_flow',
  };
}

/**
 * Compiler-owned field-strength coefficients. Consumers multiply these values
 * by body mass and field falloff, then apply their own safety caps.
 *
 * @param {{ active: boolean; materialKind: string; origin: object; direction: object; magnitude: number; signSizeAverage: number; thicknessRingRadius: number; displayMaxRadius: number; columnRadiusRatio: number; columnHeightMultiplier: number; worldScale: number }} args
 */
function physicsFieldForColumn(args) {
  const strength = {
    water: { coefficient: 20, cap: 180 },
    fire: { coefficient: 12, cap: 120 },
    wind: { coefficient: 15.6, cap: 156 },
    earth: { coefficient: 16, cap: 140 },
    light: { coefficient: 0, cap: 0 },
  }[args.materialKind];
  if (!strength) return null;
  const worldScale = clamp(finite(args.worldScale, 1), 0.25, 4);
  const displayMaxRadius = Math.max(120, finite(args.displayMaxRadius, args.thicknessRingRadius));
  const displayedRingRadius = Math.max(
    1.2,
    (Math.max(1, finite(args.thicknessRingRadius, displayMaxRadius)) * 1.2) / displayMaxRadius,
  );
  const signScale = Math.max(0.35, finite(args.signSizeAverage, 200) / 200);
  const length = roundNumber(
    clamp(
      Math.min(
        2.35,
        Math.max(0.9, finite(args.magnitude, 1) * 0.34 * signScale + 0.78),
      ) *
        finite(args.columnHeightMultiplier, COLUMN_HEIGHT_MULTIPLIER) *
        worldScale,
      0.8,
      42,
    ),
    4,
  );
  const radius = roundNumber(
    clamp(displayedRingRadius * finite(args.columnRadiusRatio, 0.7) * worldScale, 0.15, 3),
    4,
  );
  return {
    active: args.active,
    fieldShape: args.materialKind === 'earth' ? 'earth_emergence' : 'column',
    origin: normalizePosition(args.origin, DEFAULT_PLACEMENT_FRAME.origin),
    direction: normalizeSceneVector(args.direction),
    length,
    radius,
    forceMagnitude: roundNumber(
      clamp(finite(args.magnitude, 1) * strength.coefficient, 0, strength.cap),
      4,
    ),
    falloff: 'linear_radial_and_axial',
    targetFilter: 'movable_non_owner',
    applicationMode: 'distributed_force_at_collider_center',
    interceptionPolicy:
      args.materialKind === 'earth'
        ? 'solid_push_or_shatter'
        : args.materialKind === 'light'
          ? 'none'
          : 'nearest_contact_truncates_output',
    continuation:
      args.materialKind === 'water'
        ? {
            mode: 'ballistic_taper',
            exitSpeed: roundNumber(3.2 * Math.sqrt(worldScale), 4),
            gravity: { x: 0, y: -5.88, z: 0 },
            groundY: 0,
            maxAge: 8,
            sampleStep: 0.035,
            radiusScaleAtEnd: 0.5,
            forceFalloff: 'constant_through_straight_and_falling_output',
          }
        : null,
    simulationPhase: 'physics_material_simulation',
    tuningAuthority: 'compiler_geometry_and_element_shape',
  };
}

/**
 * Outward dispersion is a weak radial field in the spell plane. Water also
 * carries a separate downward-curtain coefficient so consumers do not have to
 * infer a second force from the material name.
 *
 * @param {{ active: boolean; materialKind: string; origin: object; placementFrame: object; magnitude: number; signSizeAverage: number; sourceAnchors: object[] }} args
 */
function physicsFieldForDispersion(args) {
  const strength = {
    water: { coefficient: 2, cap: 18 },
    fire: { coefficient: 1.2, cap: 12 },
    wind: { coefficient: 1.56, cap: 15.6 },
    earth: { coefficient: 0.6, cap: 6 },
    light: { coefficient: 0, cap: 0 },
  }[args.materialKind];
  if (!strength) return null;
  const worldScale = clamp(finite(args.placementFrame?.worldScale, 1), 0.25, 4);
  const signScale = Math.max(0.35, finite(args.signSizeAverage, DEFAULT_SIGN_SIZE) / DEFAULT_SIGN_SIZE);
  const normal = normalizeSceneVector(args.placementFrame?.normal);
  const tangent = normalizeSceneVector(args.placementFrame?.tangent, { x: 1, y: 0, z: 0 });
  const bitangent = normalizeSceneVector(args.placementFrame?.bitangent, { x: 0, y: 0, z: 1 });
  const origin = normalizePosition(args.origin, DEFAULT_PLACEMENT_FRAME.origin);
  const forceMagnitude = roundNumber(
    clamp(finite(args.magnitude, 1) * strength.coefficient, 0, strength.cap),
    4,
  );
  return {
    active: args.active,
    fieldShape: 'dispersion',
    origin,
    center: origin,
    normal,
    axisU: tangent,
    axisV: bitangent,
    innerRadius: roundNumber(0.46 * worldScale, 4),
    outerRadius: roundNumber(
      Math.min(2.8, (0.46 + 1.05 * signScale) * worldScale),
      4,
    ),
    halfThickness: roundNumber(Math.max(0.16, 0.24 * worldScale), 4),
    signAngles: args.sourceAnchors.map(
      (anchor) => roundNumber((finite(anchor.positionAngleDeg, 0) * Math.PI) / 180, 6),
    ),
    directionMode: 'radial_outward_in_spell_plane',
    forceMagnitude,
    curtain:
      args.materialKind === 'water'
        ? {
            direction: { x: 0, y: -1, z: 0 },
            forceMagnitude: roundNumber(
              clamp(finite(args.magnitude, 1) * 4, 0, 36),
              4,
            ),
            falloff: 'angular_coverage_and_vertical_distance',
            applicationMode: 'distributed_force_at_collider_center',
          }
        : null,
    falloff: 'annular_angular_and_plane_distance',
    targetFilter: 'movable_non_owner',
    applicationMode: 'distributed_force_at_collider_center',
    simulationPhase: 'physics_material_simulation',
    tuningAuthority: 'compiler_geometry_and_element_shape',
  };
}

/**
 * Wind Levitation acts on the object carrying the seal. Other levitation domains
 * retain their generated-orb behavior and therefore do not receive a carrier
 * force contract here.
 *
 * @param {{ force: object; active: boolean; generatedBudget: object | null; placementFrame: object }} args
 */
function physicsFieldForForceConstraint(args) {
  if (args.force.registryId !== 'sign.levitation' || !args.generatedBudget) return null;
  const verticalLift = finite(
    args.force.verticalLift ?? args.force.geometryBinding?.verticalLift,
    0,
  );
  const rawTranslation =
    args.force.translationVector ?? args.force.geometryBinding?.translationVector ?? { x: 0, y: 0 };
  const drift = addVector(
    scaleVector(args.placementFrame.tangent, finite(rawTranslation.x, 0)),
    scaleVector(args.placementFrame.bitangent, finite(rawTranslation.y, 0)),
  );
  const driftMagnitude = vectorLength(drift);
  if (args.generatedBudget.materialKind !== 'wind') {
    const normal = normalizeSceneVector(args.placementFrame.normal);
    const launchVector = addVector(
      scaleVector(normal, Math.max(0.45, verticalLift / 180)),
      drift,
    );
    return {
      active: args.active,
      fieldShape: 'generated_levitation_orb',
      origin: normalizePosition(args.placementFrame.origin, DEFAULT_PLACEMENT_FRAME.origin),
      direction: normalizeSceneVector(launchVector),
      normal,
      radius: roundNumber(
        NORMALIZED_SPELL_CIRCLE_RADIUS * clamp(
          finite(args.placementFrame.worldScale, 1),
          0.25,
          4,
        ),
        4,
      ),
      hoverHeight: roundNumber(clamp(0.38 + (verticalLift / 180) * 0.24, 0.54, 1.12), 4),
      launchSpeed: roundNumber(clamp(3.2 + driftMagnitude * 0.12 + verticalLift / 90, 3.2, 11), 4),
      oneShotLaunch: args.force.oneShotLaunch === true,
      motionMode: args.force.motionMode ?? null,
      forceMagnitude: 0,
      applicationMode: 'generated_orb_body',
      targetFilter: 'generated_output_only',
      forceModel: 'bounded_generated_orb_hover_or_ballistic_launch',
      simulationPhase: 'physics_material_simulation',
      tuningAuthority: 'compiler_geometry_and_element_shape',
    };
  }
  const carrierNormal = normalizeSceneVector(args.placementFrame.normal);
  const carrierDirection = {
    x: -carrierNormal.x || 0,
    y: -carrierNormal.y || 0,
    z: -carrierNormal.z || 0,
  };
  return {
    active: args.active,
    fieldShape: 'carrier_levitation',
    origin: normalizePosition(args.placementFrame.origin, DEFAULT_PLACEMENT_FRAME.origin),
    // Wind Levitation is reaction thrust on the seal carrier: the emitted
    // stream leaves through the visible face while the carrier accelerates in
    // the opposite direction. This keeps top-, underside-, and side-mounted
    // seals on the same orientation contract instead of collapsing to world-up.
    direction: carrierDirection,
    emissionDirection: carrierNormal,
    guidanceDirection:
      driftMagnitude > 0.0001 ? normalizeSceneVector(drift) : { x: 0, y: 0, z: 0 },
    guidanceAcceleration: roundNumber(clamp(driftMagnitude * 0.18, 0, 8), 4),
    liftAcceleration: roundNumber(clamp(verticalLift / 70, 0.5, 12), 4),
    forceMagnitude: roundNumber(clamp(verticalLift * 0.42, 8, 180), 4),
    applicationMode: 'carrier_center_of_mass',
    targetFilter: 'spell_carrier_only',
    forceModel: 'gravity_compensated_bounded_carrier_lift',
    simulationPhase: 'physics_material_simulation',
    tuningAuthority: 'project_supported_physics_adapter',
  };
}

/**
 * @param {string} materialKind
 */
function dispersionBehaviorForMaterial(materialKind) {
  if (materialKind === 'water') return 'outward_water_sheet_with_gravity_falloff';
  if (materialKind === 'earth') return 'outward_granular_earth_spray_with_finite_budget';
  if (materialKind === 'fire') return 'outward_heat_plume_warning_scoped_no_material_source';
  if (materialKind === 'wind') return 'outward_airflow_spray_force_deferred_to_physics';
  if (materialKind === 'light') return 'diffuse_light_fan_no_heat_or_force';
  return 'outward_diffuse_material_output';
}

/**
 * @param {string} materialKind
 */
function dispersionOutputProfileForMaterial(materialKind) {
  if (materialKind === 'water') {
    return {
      shape: 'thin_falling_sheet',
      primarySurface: 'water_sheet',
      gravityAffected: true,
      postSpellBehavior: 'falls_as_sheet_then_breaks_into_edge_droplets',
    };
  }
  if (materialKind === 'earth') return { shape: 'granular_sheet', gravityAffected: true };
  if (materialKind === 'fire') return { shape: 'heat_sheet', gravityAffected: false };
  if (materialKind === 'wind') return { shape: 'air_sheet', gravityAffected: false };
  if (materialKind === 'light') return { shape: 'light_fan', gravityAffected: false };
  return { shape: 'diffuse_sheet', gravityAffected: false };
}

/**
 * @param {string} materialKind
 */
function dispersionInteractionPolicyForMaterial(materialKind) {
  if (materialKind === 'wind') {
    return {
      heat: 'none',
      force: 'deferred_to_physics_phase',
      movesObjectsImmediately: false,
      illumination: false,
      materialOutput: 'generated_airflow_dispersion',
    };
  }
  if (materialKind === 'light') {
    return {
      heat: 'none',
      force: 'none',
      movesObjectsImmediately: false,
      illumination: true,
      materialOutput: 'generated_diffuse_light_fan',
    };
  }
  if (materialKind === 'fire') {
    return {
      heat: 'heat_plume_warning_scoped',
      force: 'deferred_to_physics_phase',
      movesObjectsImmediately: false,
      illumination: false,
      materialOutput: 'generated_heat_plume',
    };
  }
  if (materialKind === 'earth') {
    return {
      heat: 'none',
      force: 'weak_granular_force_in_physics_phase',
      movesObjectsImmediately: false,
      illumination: false,
      materialOutput: 'generated_granular_earth_spray',
    };
  }
  return {
    heat: 'none',
    force: 'deferred_to_physics_phase',
    movesObjectsImmediately: false,
    illumination: false,
    materialOutput: 'generated_or_gathered_water_sheet',
  };
}

/**
 * @param {RuntimeIntent[]} outputIntents
 * @param {object} lifecycle
 */
function buildLifecycleCleanupIntents(outputIntents, lifecycle) {
  if (lifecycle.active || lifecycle.repetition) return [];

  return outputIntents
    .filter((output) => output.materialOrigin !== 'targeted_scene_material')
    .filter((output) => output.resourceBudget?.finite === true)
    .filter((output) => finite(output.resourceBudget?.amount, 0) > 0)
    .map((output) => {
      const leftoverBudget = {
        finite: true,
        amount: finite(output.resourceBudget?.amount, 0),
        units: output.resourceBudget?.units ?? 'local_volume_units',
        budgetPolicy: output.resourceBudget?.budgetPolicy,
        outputShape: output.resourceBudget?.outputShape,
      };
      const leftover =
        output.materialKind === 'water'
          ? {
              materialKind: 'water',
              materialFamily: 'water',
              phase: 'liquid',
              renderPreset: 'pooled_water_leftover',
              behavior: 'fall_and_pool',
              remainsInWorld: true,
              ...leftoverBudget,
            }
          : output.materialKind === 'earth'
            ? {
                materialKind: 'earth',
                materialFamily: 'earth',
                phase: 'debris',
                renderPreset: 'earth_debris_leftover',
                behavior: 'crumble_to_debris',
                remainsInWorld: true,
                ...leftoverBudget,
              }
            : {
                materialKind: output.materialKind,
                materialFamily: output.materialFamily,
                phase: output.phase,
                renderPreset: `${output.materialKind}_ceased`,
                behavior: 'cease_without_leftover',
                remainsInWorld: false,
                ...leftoverBudget,
              };
      const cleanupPolicy = lifecycleCleanupPolicyForOutput(output, leftover);

      return {
        intentType: 'lifecycle_cleanup',
        id: `lifecycle-cleanup:${output.id}`,
        sourceIntentId: output.id,
        sourceIntentType: output.intentType,
        active: true,
        cleanupPhase: 'lifecycle_cleanup',
        lifecyclePhase: lifecycle.phase,
        nonRepetitionStopsActiveEffects: lifecycle.nonRepetitionStopsActiveEffects,
        generatedMaterialMayRemain: lifecycle.generatedMaterialMayRemain,
        origin: output.origin,
        sceneAxis: output.sceneAxis,
        resourceBudget: output.resourceBudget,
        cleanupPolicy,
        leftover,
      };
    });
}

/**
 * @param {RuntimeIntent} output
 * @param {object} leftover
 */
function lifecycleCleanupPolicyForOutput(output, leftover) {
  return {
    policyId:
      leftover.materialKind === 'water'
        ? 'generated_water_falls_and_pools'
        : leftover.materialKind === 'earth'
          ? 'generated_earth_crumbles_to_debris'
          : 'generated_ephemeral_output_ceases',
    materialKind: leftover.materialKind,
    materialFamily: leftover.materialFamily ?? output.materialFamily,
    behavior: leftover.behavior,
    remainsInWorld: leftover.remainsInWorld === true,
    generatedMaterialMayRemain: ['water', 'earth'].includes(leftover.materialKind),
    stopsActiveEffect: true,
    createsMaterial: leftover.remainsInWorld === true,
    renderPreset: leftover.renderPreset,
    finite: leftover.finite === true,
    amount: leftover.amount,
    units: leftover.units,
    budgetPolicy: leftover.budgetPolicy,
    outputShape: leftover.outputShape ?? output.resourceBudget?.outputShape,
    note:
      leftover.materialKind === 'water'
        ? 'Non-Repetition water output stops generating and leaves finite pooled water.'
        : leftover.materialKind === 'earth'
          ? 'Non-Repetition earth output stops generating and leaves finite debris.'
          : 'Non-Repetition ephemeral output stops without persistent material leftover.',
  };
}

/**
 * @param {RuntimeIntent[]} materialStates
 * @param {object} lifecycle
 */
function buildModifierCleanupIntents(materialStates, lifecycle) {
  if (lifecycle.active || lifecycle.repetition) return [];

  return materialStates
    .filter(
      (state) =>
        state.intentType === 'material_state' &&
        state.modifierLifecycle &&
        (state.modifierLifecycle.stopsWithModifiedEffect === true ||
          state.modifierLifecycle.stopsWithSpellLifecycle === true),
    )
    .map((state) => ({
      intentType: 'modifier_cleanup',
      id: `modifier-cleanup:${state.id}`,
      sourceIntentId: state.id,
      sourceIntentType: state.intentType,
      active: true,
      cleanupPhase: 'modifier_cleanup',
      lifecyclePhase: lifecycle.phase,
      nonRepetitionStopsActiveEffects: lifecycle.nonRepetitionStopsActiveEffects,
      attachment: state.attachment ?? null,
      modifierLifecycle: state.modifierLifecycle,
      materialKind: state.materialKind,
      materialFamily: state.materialFamily,
      materialState: state.materialState,
      renderPreset: `${state.materialState ?? state.materialKind}_modifier_ceased`,
      cleanup: {
        behavior:
          state.attachment?.targetKind === 'generated_spell_output'
            ? 'detach_modifier_from_modified_effect_without_leftover'
            : state.attachment?.targetKind === 'targeted_scene_material'
              ? 'detach_modifier_from_targeted_material_without_leftover'
            : 'stop_spell_local_modifier_without_leftover',
        remainsInWorld: false,
        createsMaterial: false,
        sourceRequired: false,
      },
    }));
}

/**
 * @param {{ activeEffects: RuntimeIntent[]; cleanupIntents: RuntimeIntent[]; modifierCleanupIntents: RuntimeIntent[]; lifecycle: object; effectLifecycle?: { activeEffectIds?: string[]; deltaMs?: number } }} args
 */
function buildEffectLifecycleIntents({
  activeEffects,
  cleanupIntents,
  modifierCleanupIntents,
  lifecycle,
  effectLifecycle = {},
}) {
  const previousActiveIds = new Set(
    Array.isArray(effectLifecycle.activeEffectIds)
      ? effectLifecycle.activeEffectIds
      : [],
  );
  const hasPreviousState = Array.isArray(effectLifecycle.activeEffectIds);
  const dtMs = Math.max(0, finite(effectLifecycle.deltaMs, 0));
  const activeOperations = activeEffects
    .filter(isLifecycleManagedEffect)
    .map((effect) => {
      const operation = hasPreviousState
        ? previousActiveIds.has(effect.id) ? 'update' : 'start'
        : lifecycle.elapsedMs > 0 ? 'update' : 'start';
      return effectLifecycleOperationIntent({
        sourceIntent: effect,
        operation,
        lifecycle,
        dtMs,
      });
    });

  if (lifecycle.active || lifecycle.repetition) return activeOperations;

  const cleanupOperations = [];
  for (const cleanup of [...cleanupIntents, ...modifierCleanupIntents]) {
    cleanupOperations.push(
      effectLifecycleOperationIntent({
        sourceIntent: cleanup,
        operation: 'stop',
        lifecycle,
        dtMs,
        cleanup,
      }),
    );
    cleanupOperations.push(
      effectLifecycleOperationIntent({
        sourceIntent: cleanup,
        operation: 'dispose',
        lifecycle,
        dtMs,
        cleanup,
      }),
    );
  }
  return cleanupOperations;
}

/**
 * @param {RuntimeIntent} intent
 */
function isLifecycleManagedEffect(intent) {
  if (!intent || intent.active !== true) return false;
  if (!intent.id) return false;
  return [
    'material_state',
    'thermal_material_state',
    'material_reversion',
    'water_column',
    'material_column',
    'water_dispersion',
    'material_dispersion',
    'force_constraint_debug',
    'physics_motion',
  ].includes(intent.intentType);
}

/**
 * @param {{ sourceIntent: RuntimeIntent; operation: string; lifecycle: object; dtMs: number; cleanup?: RuntimeIntent }} args
 */
function effectLifecycleOperationIntent({ sourceIntent, operation, lifecycle, dtMs, cleanup = null }) {
  const sourceIntentId = cleanup?.sourceIntentId ?? sourceIntent.id;
  const operationIndex = { start: 1, update: 2, stop: 3, dispose: 4 }[operation] ?? 0;
  return {
    intentType: 'effect_lifecycle',
    id: `effect-lifecycle:${operation}:${sourceIntentId}`,
    active: true,
    sourceIntentId,
    sourceIntentType: cleanup?.sourceIntentType ?? sourceIntent.intentType,
    operation,
    operationIndex,
    lifecyclePhase: lifecycle.phase,
    simulationPhase: 'lifecycle_cleanup_leftovers',
    effectRuntimePhase:
      operation === 'start' || operation === 'update'
        ? 'active_effect_runtime'
        : 'effect_teardown',
    elapsedMs: finite(lifecycle.elapsedMs, 0),
    dtMs,
    renderNeutral: true,
    cleanupIntentId: cleanup?.id ?? null,
    cleanupPhase: cleanup?.cleanupPhase ?? null,
    cleanupPolicy: cleanup?.cleanupPolicy ?? cleanup?.cleanup ?? null,
    leftover: cleanup?.leftover ?? null,
    createsPersistentMaterial:
      cleanup?.leftover?.remainsInWorld === true ||
      cleanup?.cleanupPolicy?.createsMaterial === true,
    disposalPolicy:
      operation === 'dispose'
        ? cleanup?.leftover?.remainsInWorld === true
          ? 'dispose_active_effect_keep_leftover'
          : 'dispose_active_effect_without_leftover'
        : null,
  };
}

/**
 * @param {object[]} nodes
 * @param {object[]} edges
 * @param {ReturnType<typeof buildSourceRequirements>} sourceRequirements
 * @param {RuntimeIntent[]} crosshairScopes
 * @param {object} lifecycle
 * @param {object} placementFrame
 */
function buildThermalMaterialIntents(
  nodes,
  edges,
  sourceRequirements,
  crosshairScopes = [],
  lifecycle = { active: true },
  placementFrame = DEFAULT_PLACEMENT_FRAME,
) {
  const drivers = nodes.filter((node) => node.nodeType === 'temperature_driver');
  return drivers.flatMap((driver) => {
    const energyEdges = edges.filter(
      (edge) => edge.edgeType === 'drives_specific_energy' && edge.fromNodeId === driver.nodeId,
    );
    return energyEdges.map((edge) => {
      const phase = nodes.find((node) => node.nodeId === edge.toNodeId) ?? null;
      const materialKind = phase?.targetMaterial ?? materialKindForDomain(driver.fromDomain);
      const materialPreset =
        nodes.find(
          (node) =>
            node.nodeType === 'material_preset' &&
            compatibleMaterialFamily(materialFamilyForKind(materialKind), node.materialFamily),
        ) ?? null;
      const domainNode = nodes.find(
        (node) => node.nodeType === 'domain' && node.registryId === driver.fromDomain,
      );
      const requirement = domainNode
        ? sourceRequirements.requirementByNodeId.get(domainNode.nodeId) ??
          findRequirementForMaterial(sourceRequirements.requirements, materialKind)
        : findRequirementForMaterial(sourceRequirements.requirements, materialKind);
      const binding = requirement
        ? sourceRequirements.bindingByNodeId.get(requirement.nodeId)
        : null;
      const crosshairScope = crosshairScopes.find(
        (scope) =>
          scope.modifierWeakEffect === driver.weakEffect ||
          scope.modifierWeakEffect === driver.temperatureDriver?.direction,
      );
      const targetSources = thermalTargetSourceContext(
        sourceRequirements,
        materialKind,
        crosshairScope,
        placementFrame,
      );
      return {
        intentType: 'thermal_material_state',
        id: `intent:${driver.nodeId}:${edge.toNodeId}`,
        nodeId: driver.nodeId,
        phaseNodeId: phase?.nodeId ?? null,
        active: lifecycle.active && (requirement ? targetSources.satisfied : true),
        degraded: !(lifecycle.active && (requirement ? targetSources.satisfied : true)),
        reason: lifecycle.active && (requirement ? targetSources.satisfied : true)
          ? null
          : lifecycle.active
            ? targetSources.reason ?? requirement?.reason ?? `No ${materialKind} source binding`
            : lifecycle.phase,
        sourceRequirementId: requirement?.id ?? null,
        sourceBindingId:
          targetSources.primarySourceBindingId ??
          (targetSources.areaMode ? null : binding?.id) ??
          null,
        sourceId:
          targetSources.primarySourceId ??
          (targetSources.areaMode ? null : binding?.sourceId) ??
          null,
        sourceBindingIds: targetSources.sourceBindingIds,
        targetSourceIds: targetSources.sourceIds,
        targetSourceCount: targetSources.sourceIds.length,
        targetSelectionPolicy: targetSources.selectionPolicy,
        targetSources: targetSources.sources,
        targetingScopeId: crosshairScope?.id ?? null,
        crosshairMode: crosshairScope?.mode ?? null,
        targetVolume: crosshairScope?.targetVolume ?? null,
        materialKind,
        materialFamily: materialFamilyForKind(materialKind),
        thermalEffect: driver.temperatureDriver?.thermalEffect ?? driver.weakEffect ?? null,
        direction: driver.temperatureDriver?.direction ?? null,
        strength: driver.temperatureDriver?.strength ?? null,
        temperatureDriver: driver.temperatureDriver ?? null,
        specificEnergy: phase?.specificEnergy ?? null,
        phase: phase?.phase ?? 'unspecified',
        phaseModel: phase?.phaseModel ?? null,
        phaseThresholds: phase?.phaseThresholds ?? null,
        phaseFraction: phase?.phaseFraction ?? null,
        materialPreset: materialPreset
          ? {
              nodeId: materialPreset.nodeId,
              registryId: materialPreset.registryId,
              materialFamily: materialPreset.materialFamily,
              thermalProfile: materialPreset.thermalProfile ?? null,
            }
          : null,
        visualState: {
          renderPreset:
            driver.temperatureDriver?.direction === 'cool'
              ? 'cooling_material_meter'
              : 'warming_material_meter',
          showsTemperatureDriver: true,
          showsPhaseState: phase != null,
          showsMaterialPreset: materialPreset != null,
          noInstantPhaseChange: phase?.instantPhaseChange === false,
          doesNotCreateMaterial: driver.temperatureDriver?.doesNotCreateMaterial === true,
        },
        bounded: driver.bounded === true,
        evidenceTier: driver.evidenceTier ?? null,
        warningScoped: driver.warningScoped === true,
      };
    });
  });
}

/**
 * @param {ReturnType<typeof buildSourceRequirements>} sourceRequirements
 * @param {string | null | undefined} materialKind
 * @param {RuntimeIntent | null | undefined} crosshairScope
 * @param {object} placementFrame
 */
function thermalTargetSourceContext(
  sourceRequirements,
  materialKind,
  crosshairScope,
  placementFrame,
) {
  const materialFamily = materialFamilyForKind(materialKind);
  const compatibleSources = sourceRequirements.sourceStatus.filter(
    (source) =>
      compatibleMaterialFamily(
        materialFamily,
        source.materialFamily ?? materialFamilyForKind(source.kind),
      ) && (source.nonDepleting || finite(source.amount, 0) > 0),
  );
  const bindingIdBySourceId = new Map(
    sourceRequirements.bindings.map((binding) => [binding.sourceId, binding.id]),
  );
  const areaMode = ['crosshair_2', 'crosshair_3'].includes(crosshairScope?.mode);
  const targetVolume = crosshairScope?.targetVolume ?? null;
  const selected = areaMode
    ? compatibleSources.filter((source) =>
        sourceWithinTargetVolume(source, targetVolume, placementFrame),
      )
    : compatibleSources.slice(0, 1);
  const sources = selected.map((source) => ({
    sourceId: source.id,
    sourceBindingId: bindingIdBySourceId.get(source.id) ?? null,
    materialKind: source.kind,
    materialFamily: source.materialFamily ?? materialFamilyForKind(source.kind),
    materialState: source.materialState ?? source.kind,
    amount: source.amount,
    capacity: source.capacity,
    nonDepleting: source.nonDepleting === true,
    position: source.position ?? null,
    distance: roundNumber(sourceTargetDistance(source, targetVolume, placementFrame), 3),
    withinTargetVolume: areaMode ? true : null,
  }));
  const sourceIds = sources.map((source) => source.sourceId);
  const sourceBindingIds = sources
    .map((source) => source.sourceBindingId)
    .filter((id) => typeof id === 'string');
  const reason =
    selected.length > 0
      ? null
      : compatibleSources.length > 0 && areaMode
        ? `No compatible ${materialKind} source inside ${crosshairScope.mode} target volume`
        : `No available ${materialKind} source in the scene`;

  return {
    satisfied: selected.length > 0,
    reason,
    primarySourceId: sourceIds[0] ?? null,
    primarySourceBindingId: sourceBindingIds[0] ?? null,
    sourceIds,
    sourceBindingIds,
    sources,
    areaMode,
    selectionPolicy: areaMode
      ? 'all_compatible_sources_inside_crosshair_volume'
      : 'first_compatible_scene_source',
  };
}

/**
 * @param {object} source
 * @param {object | null | undefined} targetVolume
 * @param {object} placementFrame
 */
function sourceWithinTargetVolume(source, targetVolume, placementFrame) {
  if (!targetVolume) return true;
  const position = source.position ?? { x: 0, y: 0, z: 0 };
  const radius = Math.max(0, finite(targetVolume.radius, Number.POSITIVE_INFINITY));
  if (targetVolume.shape === 'sphere') {
    return vectorLength(subtractVector(position, placementFrame.origin)) <= radius;
  }
  if (targetVolume.shape === 'local_column') {
    const height = Math.max(0, finite(targetVolume.height, radius * 2));
    const local = sceneToLocal(placementFrame, position);
    const radialDistance = Math.hypot(local.x, local.y);
    return (
      radialDistance <= radius &&
      Math.abs(local.z) <= height / 2
    );
  }
  return true;
}

/**
 * @param {object} source
 * @param {object | null | undefined} targetVolume
 * @param {object} placementFrame
 */
function sourceTargetDistance(source, targetVolume, placementFrame) {
  const position = source.position ?? { x: 0, y: 0, z: 0 };
  if (targetVolume?.shape === 'local_column') {
    const local = sceneToLocal(placementFrame, position);
    return Math.hypot(local.x, local.y);
  }
  return vectorLength(subtractVector(position, placementFrame.origin));
}

/**
 * @param {object | null} program
 */
function buildSpellCircleIntent(program, placementFrame) {
  const seals = (program?.seals ?? []).map((seal) => {
    const symbols = (seal.symbols ?? [])
      .filter((symbol) => symbol.objectId && !symbol.objectId.includes('generator'))
      .map((symbol) => ({
        objectId: symbol.objectId,
        registryId: symbol.resolvedRegistryId ?? symbol.registryCandidate ?? null,
        categoryHint: symbol.categoryHint ?? null,
        label: shortLabel(symbol.resolvedRegistryId ?? symbol.registryCandidate ?? symbol.objectId),
        position: {
          x: finite(symbol.geometry?.localPosition?.x, 0),
          y: finite(symbol.geometry?.localPosition?.y, 0),
        },
        polarRadius: finite(symbol.geometry?.polarRadius, 0),
        polarAngleDeg: finite(symbol.geometry?.polarAngleDeg, 0),
        size: finite(symbol.geometry?.size, symbol.categoryHint === 'sigil' ? 400 : DEFAULT_SIGN_SIZE),
        nativeLayoutMode: symbol.geometry?.nativeLayoutMode === 'fixed' ? 'fixed' : 'auto',
        rotationDeg: finite(symbol.geometry?.rotationDeg, 0),
        facingDeg: finite(symbol.geometry?.facingDeg, symbol.geometry?.angleDeg ?? 0),
        inwardDirection: {
          x: finite(-Math.cos((finite(symbol.geometry?.polarAngleDeg, 0) * Math.PI) / 180), 0),
          y: finite(-Math.sin((finite(symbol.geometry?.polarAngleDeg, 0) * Math.PI) / 180), 1),
        },
        renderDirection: symbol.geometryAnalysis?.directionVector
          ? { x: finite(symbol.geometryAnalysis.directionVector.x, 0), y: finite(symbol.geometryAnalysis.directionVector.y, 1) }
          : null,
      }));
    return {
      sealId: seal.sealId,
      rings: (seal.rings ?? []).map((ring) => ({
        ringId: ring.ringId,
        radius: finite(ring.radius, 0),
        closureState: ring.closureState ?? 'closed',
      })),
      symbols,
    };
  });

  return {
    intentType: 'spell_circle_render_data',
    id: 'intent:spell-circle',
    active: seals.length > 0,
    title: program?.title ?? 'Untitled spell',
    coordinateSpace: program?.coordinateSpace ?? null,
    placementFrame,
    placementMode: placementFrame.placementMode ?? 'ground_plane',
    surfaceMode: placementFrame.surfaceMode ?? null,
    surfaceTargetId: placementFrame.surfaceTargetId ?? null,
    surfaceLabel: placementFrame.surfaceLabel ?? null,
    futureSurfacePlacementReady: true,
    seals,
  };
}

/**
 * @param {object[]} intents
 */
function summarizeIntents(intents) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const intent of intents) {
    counts[intent.intentType] = (counts[intent.intentType] ?? 0) + 1;
  }
  return {
    intentCounts: counts,
    activeVisualCount: intents.filter((intent) => intent.active && !intent.degraded).length,
    degradedCount: intents.filter((intent) => intent.degraded).length,
  };
}

/**
 * @param {object[]} items
 * @param {(item: object) => string} keyFor
 */
function groupBy(items, keyFor) {
  /** @type {Map<string, object[]>} */
  const groups = new Map();
  for (const item of items) {
    const key = keyFor(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

/**
 * @param {string | undefined} nodeId
 */
function sealKeyForNode(nodeId) {
  return String(nodeId ?? 'seal0').match(/seal\d+/)?.[0] ?? 'seal0';
}

/**
 * @param {object | null} program
 */
function indexSymbols(program) {
  /** @type {Map<string, object>} */
  const index = new Map();
  for (const seal of program?.seals ?? []) {
    for (const symbol of seal.symbols ?? []) {
      if (symbol.objectId) index.set(symbol.objectId, symbol);
    }
  }
  return index;
}

/**
 * @param {object | null} program
 * @param {string} sealKey
 * @param {string} registryId
 */
function symbolsForSealAndRegistry(program, sealKey, registryId) {
  const seal = sealForKey(program, sealKey);
  return (seal?.symbols ?? []).filter((symbol) => {
    const resolvedId = symbol.resolvedRegistryId ?? symbol.registryCandidate;
    return (
      resolvedId === registryId &&
      String(symbol.objectId ?? '').startsWith('sign-instance:')
    );
  });
}

/**
 * @param {object | null} program
 * @param {string} sealKey
 */
function displayMaxRadiusForSeal(program, sealKey) {
  const seal = sealForKey(program, sealKey);
  const radii = [
    ...(seal?.rings ?? []).map((ring) => ring.radius).filter(isFiniteNumber),
    ...(seal?.symbols ?? []).map((symbol) => symbol.geometry?.polarRadius).filter(isFiniteNumber),
  ];
  return Math.max(120, ...radii);
}

/**
 * @param {object | null} program
 * @param {string} sealKey
 * @param {object[]} sourceSymbols
 */
function containingRingRadiusForSymbols(program, sealKey, sourceSymbols) {
  const seal = sealForKey(program, sealKey);
  if (!seal) return null;
  const sortedRings = [...(seal.rings ?? [])].sort(
    (a, b) => finite(a.radius, 0) - finite(b.radius, 0),
  );
  const ringById = new Map(
    sortedRings
      .filter((ring) => ring.ringId)
      .map((ring) => [ring.ringId, finite(ring.radius, 0)]),
  );
  const ringRadii = sourceSymbols
    .map((symbol) => containingRingRadiusForSymbol(symbol, sortedRings, ringById))
    .filter(isFiniteNumber);
  return average(ringRadii);
}

/**
 * @param {object} symbol
 * @param {object[]} sortedRings
 * @param {Map<string, number>} ringById
 */
function containingRingRadiusForSymbol(symbol, sortedRings, ringById) {
  const ringId = symbol.ringOwnership?.ringId;
  if (ringId && ringById.has(ringId)) {
    return ringById.get(ringId);
  }

  const ringIndex = symbol.ringOwnership?.ringIndex;
  if (Number.isInteger(ringIndex) && sortedRings[ringIndex]) {
    return finite(sortedRings[ringIndex].radius, 0);
  }

  const polarRadius = symbol.geometry?.polarRadius;
  if (isFiniteNumber(polarRadius)) {
    const containingRing = sortedRings.find(
      (ring) => polarRadius <= finite(ring.radius, 0) + 1,
    );
    if (containingRing) return finite(containingRing.radius, 0);
  }

  return null;
}

/**
 * @param {object | null} program
 * @param {string} sealKey
 */
function sealForKey(program, sealKey) {
  const index = Number(sealKey.replace('seal', ''));
  return program?.seals?.[Number.isFinite(index) ? index : 0] ?? null;
}

/**
 * Each column sign pushes inward through the seal center. Opposing equal
 * contributions cancel laterally and leave the shared outward normal; a
 * stronger contribution leaves a lateral component pointing away from it.
 *
 * @param {object[]} columns
 */
function visualColumnLocalAxis(columns) {
  const combined = columns.reduce(
    (sum, column) => {
      const direction = column.geometryBinding?.vectorSum ?? column.geometryBinding?.axis ?? {};
      return {
        x: sum.x + finite(direction.x, 0),
        y: sum.y + finite(direction.y, 0),
        z: sum.z + finite(direction.z, 0),
      };
    },
    { x: 0, y: 0, z: 0 },
  );
  return normalizeSceneVector(combined);
}

/**
 * Dispersion bias comes from where the Dispersion signs sit on the seal.
 *
 * @param {string} materialKind
 * @param {object[]} dispersions
 * @param {object[]} sourceSymbols
 */
function visualDispersionLocalAxis(materialKind, dispersions, sourceSymbols) {
  if (materialKind === 'earth') {
    return { x: 0, y: 0, z: 1 };
  }

  const combined = dispersions.reduce(
    (sum, dispersion) => {
      const axis = dispersion.geometryBinding?.axis ?? {};
      return {
        x: sum.x + finite(axis.x, 0),
        y: sum.y + finite(axis.y, 0),
        z: sum.z + finite(axis.z, 0),
      };
    },
    { x: 0, y: 0, z: 0 },
  );
  if (Math.hypot(combined.x, combined.y, combined.z) > 0.000001) {
    return normalizeSceneVector(combined);
  }

  const dispersionSymbols = sourceSymbols.filter(
    (symbol) =>
      (symbol.resolvedRegistryId ?? symbol.registryCandidate) === 'sign.dispersion' &&
      symbol.geometryAnalysis?.inverted !== true,
  );
  const placement = dispersionSymbols.reduce(
    (sum, symbol) => {
      const pos = symbol.geometry?.localPosition ?? { x: 0, y: 0 };
      const weight = finite(symbol.geometryAnalysis?.scaleWeight, 1);
      return {
        x: sum.x + finite(pos.x, 0) * weight,
        y: sum.y + finite(pos.y, 0) * weight,
        weight: sum.weight + weight,
      };
    },
    { x: 0, y: 0, weight: 0 },
  );
  if (placement.weight > 0 && Math.hypot(placement.x, placement.y) > 0.000001) {
    return normalizeSceneVector({
      x: placement.x / placement.weight,
      y: placement.y / placement.weight,
      z: 0.35,
    });
  }

  return { x: 0, y: 0, z: 1 };
}

/**
 * @param {{ x?: number; y?: number; z?: number }} vector
 */
function normalizeSceneVector(vector) {
  const x = finite(vector.x, 0);
  const y = finite(vector.y, 0);
  const z = finite(vector.z, 0);
  const length = Math.hypot(x, y, z);
  if (length <= 0.000001) return { x: 0, y: 1, z: 0 };
  return { x: x / length, y: y / length, z: z / length };
}

/**
 * @param {number[]} values
 */
function average(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * @param {Partial<SceneState>} sceneState
 * @returns {SceneState}
 */
function normalizeSceneState(sceneState) {
  return {
    sources: (sceneState.sources ?? []).map((source, index) =>
      createSceneSource({
        ...source,
        id: source.id ?? `source:${source.kind ?? 'water'}:${index}`,
      }),
    ),
    props: (sceneState.props ?? []).map((prop, index) =>
      createSceneProp({
        ...prop,
        id: prop.id ?? `prop:${index}`,
      }),
    ),
  };
}

/**
 * Runtime intent IDs embed scene IDs. Duplicates, including a source/prop
 * collision, would make distinct targets indistinguishable to consumers, so
 * reject the scene before acquisition, spending, or motion is evaluated.
 *
 * @param {SceneState} sceneState
 */
function assertUniqueSceneObjectIds(sceneState) {
  const seen = new Map();
  for (const [collection, items] of [
    ['sources', sceneState.sources],
    ['props', sceneState.props],
  ]) {
    for (const item of items) {
      if (typeof item.id !== 'string' || item.id.trim() === '') {
        throw new TypeError(`Scene ${collection} must have non-empty string IDs`);
      }
      if (seen.has(item.id)) {
        throw new RangeError(
          `Duplicate scene object ID ${JSON.stringify(item.id)} in ${seen.get(item.id)} and ${collection}`,
        );
      }
      seen.set(item.id, collection);
    }
  }
}

/**
 * @param {object[]} requirements
 * @param {string | null | undefined} materialKind
 */
function findRequirementForMaterial(requirements, materialKind) {
  return requirements.find((requirement) => requirement.materialKind === materialKind) ?? null;
}

/**
 * @param {object} domain
 * @param {object[]} incoming
 * @param {object[]} nodes
 */
function requiredAmountForDomain(domain, incoming, nodes) {
  const shape = incoming
    .map((edge) => nodes.find((node) => node.nodeId === edge.fromNodeId))
    .find((node) => node?.nodeType === 'shape_field');
  if (shape?.shape === 'column') {
    const magnitude = finite(shape.geometryBinding?.magnitude, 1);
    return Math.max(DEFAULT_WATER_COLUMN_REQUIREMENT, Math.round(magnitude * 6));
  }
  if (domain.registryId === 'sigil.water' || domain.domain === 'water') {
    return 8;
  }
  return 1;
}

/**
 * @param {string | null | undefined} registryId
 */
function materialKindForDomain(registryId) {
  const id = String(registryId ?? '');
  if (id.includes('water')) return 'water';
  if (id.includes('fire')) return 'fire';
  if (id.includes('earth')) return 'earth';
  if (id.includes('wind') || id.includes('air')) return 'wind';
  if (id.includes('light') || id.includes('glow')) return 'light';
  if (id.includes('mist') || id.includes('cloud') || id.includes('ice')) return 'water';
  if (id.includes('dust') || id.includes('sand')) return 'earth';
  if (id.includes('mud')) return 'mud';
  return null;
}

/**
 * @param {string | null | undefined} kind
 */
function materialFamilyForKind(kind) {
  const id = String(kind ?? '').replace(/^sigil\./, '').replace(/^material\./, '');
  if (['water', 'mist', 'cloud', 'ice'].some((part) => id.includes(part))) return 'water';
  if (['earth', 'dust', 'sand', 'stone', 'crushed'].some((part) => id.includes(part))) return 'earth';
  if (id.includes('fire') || id.includes('heat')) return 'fire';
  if (id.includes('wind') || id.includes('air')) return 'wind';
  if (id.includes('light') || id.includes('glow')) return 'light';
  if (id.includes('mud')) return 'mud';
  if (id === 'prop') return 'generic';
  return id || 'generic';
}

/**
 * @param {string} kind
 * @param {number | undefined} amount
 */
function defaultMassForSource(kind, amount) {
  const base = Math.sqrt(Math.max(1, finite(amount, DEFAULT_SOURCE_AMOUNT))) / 3;
  if (['mist', 'cloud'].includes(kind)) return 0.8;
  if (kind === 'ice') return base * 2.4;
  if (kind === 'earth') return base * 1.5;
  if (kind === 'fire' || kind === 'light' || kind === 'wind') return 0.7;
  return base;
}

/**
 * @param {string} kind
 */
function defaultCohesionForKind(kind) {
  if (['mist', 'cloud', 'light', 'wind', 'fire'].includes(kind)) return 0.35;
  if (kind === 'ice') return 3.6;
  if (kind === 'earth') return 2.2;
  return 1;
}

/**
 * @param {string} state
 */
function defaultPhaseResistanceForState(state) {
  if (['mist', 'cloud', 'mist_cloud', 'glow'].includes(state)) return 0.5;
  if (['ice', 'solid'].includes(state)) return 2.4;
  if (['dust', 'sand', 'crushed_earth'].includes(state)) return 0.8;
  return 1;
}

/**
 * @param {string} kind
 */
function labelForKind(kind) {
  if (kind === 'water') return 'Water source';
  if (kind === 'fire') return 'Fire source';
  if (kind === 'earth') return 'Earth source';
  return 'Scene source';
}

/**
 * @param {string} kind
 */
function defaultPositionForKind(kind) {
  if (kind === 'fire') return { x: -1.2, y: 0, z: -1.8 };
  if (kind === 'earth') return { x: 1.2, y: 0, z: 1.7 };
  return { x: -2.2, y: 0, z: 0.5 };
}

/**
 * @param {object | undefined} position
 * @param {{ x: number; y: number; z: number }} fallback
 */
function normalizePosition(position, fallback) {
  return {
    x: finite(position?.x, fallback.x),
    y: finite(position?.y, fallback.y),
    z: finite(position?.z, fallback.z),
  };
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function finite(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * @param {unknown} value
 */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * @param {number} deg
 */
function normalizeDegrees(deg) {
  let value = deg % 360;
  if (value < 0) value += 360;
  return value;
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * @param {number} value
 * @param {number} [precision]
 */
function roundNumber(value, precision = 6) {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

/**
 * @param {{ x?: number; y?: number; z?: number }} a
 * @param {{ x?: number; y?: number; z?: number }} b
 */
function addVector(a, b) {
  return {
    x: finite(a.x, 0) + finite(b.x, 0),
    y: finite(a.y, 0) + finite(b.y, 0),
    z: finite(a.z, 0) + finite(b.z, 0),
  };
}

/**
 * @param {{ x?: number; y?: number; z?: number }} a
 * @param {{ x?: number; y?: number; z?: number }} b
 */
function subtractVector(a, b) {
  return {
    x: finite(a.x, 0) - finite(b.x, 0),
    y: finite(a.y, 0) - finite(b.y, 0),
    z: finite(a.z, 0) - finite(b.z, 0),
  };
}

/**
 * @param {{ x?: number; y?: number; z?: number }} vector
 * @param {number} scalar
 */
function scaleVector(vector, scalar) {
  return {
    x: finite(vector.x, 0) * scalar,
    y: finite(vector.y, 0) * scalar,
    z: finite(vector.z, 0) * scalar,
  };
}

/**
 * @param {{ x?: number; y?: number; z?: number }} from
 * @param {{ x?: number; y?: number; z?: number }} to
 * @param {number} progress
 */
function interpolateVector(from, to, progress) {
  const clampedProgress = clamp(progress, 0, 1);
  return {
    x: roundNumber(finite(from.x, 0) + (finite(to.x, 0) - finite(from.x, 0)) * clampedProgress),
    y: roundNumber(finite(from.y, 0) + (finite(to.y, 0) - finite(from.y, 0)) * clampedProgress),
    z: roundNumber(finite(from.z, 0) + (finite(to.z, 0) - finite(from.z, 0)) * clampedProgress),
  };
}

/**
 * @param {{ x?: number; y?: number; z?: number }} a
 * @param {{ x?: number; y?: number; z?: number }} b
 */
function dotVector(a, b) {
  return finite(a.x, 0) * finite(b.x, 0) +
    finite(a.y, 0) * finite(b.y, 0) +
    finite(a.z, 0) * finite(b.z, 0);
}

/**
 * @param {{ x?: number; y?: number; z?: number }} a
 * @param {{ x?: number; y?: number; z?: number }} b
 */
function crossVector(a, b) {
  return {
    x: finite(a.y, 0) * finite(b.z, 0) - finite(a.z, 0) * finite(b.y, 0),
    y: finite(a.z, 0) * finite(b.x, 0) - finite(a.x, 0) * finite(b.z, 0),
    z: finite(a.x, 0) * finite(b.y, 0) - finite(a.y, 0) * finite(b.x, 0),
  };
}

/**
 * @param {{ x?: number; y?: number; z?: number }} vector
 */
function vectorLength(vector) {
  return Math.hypot(finite(vector.x, 0), finite(vector.y, 0), finite(vector.z, 0));
}

/**
 * @param {{ x?: number; y?: number; z?: number }} a
 * @param {{ x?: number; y?: number; z?: number }} b
 */
function planarDistance(a, b) {
  return Math.hypot(finite(a.x, 0) - finite(b.x, 0), finite(a.z, 0) - finite(b.z, 0));
}

/**
 * @param {string | null | undefined} registryId
 */
function shortLabel(registryId) {
  return String(registryId ?? '')
    .replace(/^sigil\./, '')
    .replace(/^sign\./, '')
    .replace(/_/g, ' ');
}

/**
 * @typedef {object} SceneSource
 * @property {string} id
 * @property {'water' | 'fire' | 'earth' | string} kind
 * @property {string} label
 * @property {number} amount
 * @property {number} capacity
 * @property {boolean} nonDepleting
 * @property {{ x: number; y: number; z: number }} position
 */

/**
 * @typedef {object} SceneProp
 * @property {string} id
 * @property {'prop'} kind
 * @property {string} label
 * @property {{ x: number; y: number; z: number }} position
 * @property {number} size
 */

/**
 * @typedef {object} SceneState
 * @property {SceneSource[]} sources
 * @property {SceneProp[]} props
 */

/** @typedef {{ intentType: string; id: string; [key: string]: any }} RuntimeIntent */
