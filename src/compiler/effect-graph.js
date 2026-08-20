/**
 * Deterministic semantic effect graph construction.
 */

import { MATERIAL_PROFILES } from './registry.js';
import { phaseFromSpecificEnergy } from './material-state.js';
import { stableHexHash } from './hash.js';

/**
 * @param {object} program
 * @param {object} ruleEvaluation
 */
export function buildEffectGraph(program, ruleEvaluation) {
  const nodes = [];
  const edges = [];
  /** @type {Map<string, string>} */
  const transformBySealDomain = new Map();
  /** @type {Map<string, string>} */
  const shapeBySeal = new Map();

  for (const sealResult of ruleEvaluation.sealResults ?? []) {
    const sealIndex = program.seals.findIndex((s) => s.sealId === sealResult.sealId);
    const sealPrefix = `seal${sealIndex >= 0 ? sealIndex : 0}`;
    const counters = {
      domain: 0,
      source: 0,
      shape: 0,
      transform: 0,
      target: 0,
      force: 0,
      diagnostic: 0,
      environmental: 0,
      operator: 0,
      state: 0,
      material: 0,
      driver: 0,
    };

    const sortedEffects = [...(sealResult.effects ?? [])].sort((a, b) =>
      effectSortKey(a).localeCompare(effectSortKey(b)),
    );

    for (const effect of sortedEffects) {
      if (effect.kind === 'operator_result') {
        const shapeId = buildOperatorResultGraph(
          effect,
          sealPrefix,
          counters,
          nodes,
          edges,
          transformBySealDomain,
          shapeBySeal,
        );
        if (shapeId) {
          shapeBySeal.set(sealPrefix, shapeId);
          if (effect.domainRegistryId) {
            shapeBySeal.set(`${sealPrefix}:${effect.domainRegistryId}`, shapeId);
          }
        }
      } else if (effect.kind === 'sign_crush' || effect.kind === 'crush_water_mist') {
        buildCrushWaterMistGraph(effect, sealPrefix, counters, nodes, edges);
      }
    }

    for (const effect of sortedEffects) {
      if (effect.kind === 'operator_result' && effect.operatorFamily === 'scope_filter') {
        buildCrosshairCenterGroupGraph(
          effect,
          sealPrefix,
          counters,
          nodes,
          edges,
          transformBySealDomain,
          shapeBySeal,
        );
        buildScopeFilterGraph(effect, sealPrefix, counters, nodes, edges);
      }
    }

    buildCondensationCandidateGraphs(sortedEffects, sealPrefix, counters, nodes, edges);
  }

  const sortedNodes = sortNodes(nodes);
  const sortedEdges = sortEdges(canonicalizeEdges(edges));

  return {
    graphId: deriveGraphId(program.programId, sortedNodes, sortedEdges),
    nodes: sortedNodes,
    edges: sortedEdges,
  };
}

/**
 * @param {object} effect
 */
function effectSortKey(effect) {
  const order = {
    operator_result: -1,
    sign_crush: 1,
    crush_water_mist: 1,
  };
  return `${order[effect.kind] ?? 9}:${effect.ruleId ?? effect.kind}`;
}

/**
 * @param {object} effect
 * @param {string} sealPrefix
 * @param {object} counters
 * @param {object[]} nodes
 * @param {object[]} edges
 * @param {Map<string, string>} transformBySealDomain
 * @param {Map<string, string>} shapeBySeal
 * @returns {string | null}
 */
function buildOperatorResultGraph(
  effect,
  sealPrefix,
  counters,
  nodes,
  edges,
  transformBySealDomain,
  shapeBySeal,
) {
  if (effect.operatorFamily === 'field_emit') {
    return buildFieldEmitOperatorGraph(effect, sealPrefix, counters, nodes, edges);
  }
  if (effect.operatorFamily === 'field_attract') {
    buildPullSignGraph(effect, sealPrefix, counters, nodes, edges);
    return null;
  }
  if (effect.operatorFamily === 'scope_boundary') {
    buildRegionSignGraph(effect, sealPrefix, counters, nodes, edges);
    return null;
  }
  if (effect.operatorFamily === 'lift_motion') {
    buildLevitationGraph(effect, sealPrefix, counters, nodes, edges);
    return null;
  }
  if (effect.operatorFamily === 'material_intake') {
    if (effect.signRegistryId === 'sign.gather') {
      buildGatherSignGraph(effect, sealPrefix, counters, nodes, edges);
    } else {
      buildCollectionSignGraph(effect, sealPrefix, counters, nodes, edges);
    }
    return null;
  }
  if (effect.operatorFamily === 'field_focus') {
    buildConvergenceSignGraph(effect, sealPrefix, counters, nodes, edges);
    return null;
  }
  if (effect.operatorFamily === 'weaken_modifier_source') {
    buildModifierSourceGraph(effect, sealPrefix, counters, nodes, edges);
    const modifierNodeId = buildWeakModifierGraph(effect, sealPrefix, counters, nodes, edges);
    transformBySealDomain.set(
      `${sealPrefix}:${effect.domainRegistryId}:${effect.domainSigilObjectId ?? ''}`,
      modifierNodeId,
    );
    transformBySealDomain.set(`${sealPrefix}:${effect.domainRegistryId}`, modifierNodeId);
    transformBySealDomain.set(`object:${effect.domainSigilObjectId ?? ''}`, modifierNodeId);
    return null;
  }
  if (effect.operatorFamily === 'temperature_driver') {
    const driverId = buildTemperatureDriverGraph(effect, sealPrefix, counters, nodes, edges);
    transformBySealDomain.set(`object:${effect.domainSigilObjectId ?? ''}`, driverId);
    if (effect.binding) {
      buildPhaseStateBindingGraph(effect, driverId, sealPrefix, counters, nodes, edges);
    }
    return null;
  }
  if (effect.operatorFamily === 'scope_filter') {
    return null;
  }
  return null;
}

/**
 * @param {object} effect
 * @param {string} sealPrefix
 * @param {object} counters
 * @param {object[]} nodes
 * @param {object[]} edges
 * @returns {string | null}
 */
function buildFieldEmitOperatorGraph(effect, sealPrefix, counters, nodes, edges) {
  buildFieldLobeGraph(effect, sealPrefix, counters, nodes, edges);
  if (
    effect.derivedClassification === 'dispersion_emission' ||
    effect.compatTrace?.legacyEffectKind === 'outward_dispersion' ||
    effect.signRegistryId === 'sign.dispersion'
  ) {
    return buildOutwardDispersionGraph(effect, sealPrefix, counters, nodes, edges);
  }
  if (
    effect.derivedClassification === 'column_emission' ||
    (effect.signRegistryId === 'sign.column' && effect.domainRegistryId === 'sigil.water')
  ) {
    return buildWatershotGraph(effect, sealPrefix, counters, nodes, edges);
  }
  return null;
}

/**
 * @param {object} effect
 * @param {string} sealPrefix
 * @param {object} counters
 * @param {object[]} nodes
 * @param {object[]} edges
 */
function buildFieldLobeGraph(effect, sealPrefix, counters, nodes, edges) {
  const operatorId = `node.operator.field_lobe.${sealPrefix}.${counters.operator++}`;
  nodes.push(fieldLobeNode(operatorId, effect));
  edges.push(
    edge(
      `edge.operator.aggregates_lobe.${sealPrefix}.${counters.operator}`,
      'aggregates_into_lobe',
      operatorId,
      operatorId,
      effect,
      {
        contributionIds: effect.fieldLobe?.contributionIds ?? [],
        geometryBinding: effect.geometryBinding,
      },
    ),
  );
}

/**
 * @param {object} effect
 * @param {string} sealPrefix
 * @param {object} counters
 * @param {object[]} nodes
 * @param {object[]} edges
 */
function buildModifierSourceGraph(effect, sealPrefix, counters, nodes, edges) {
  const operatorId = `node.operator.modifier_source.${sealPrefix}.${counters.operator++}`;
  nodes.push(modifierSourceNode(operatorId, effect));
  edges.push(
    edge(
      `edge.operator.modifier_source.${sealPrefix}.${counters.operator}`,
      'contributes_vector',
      operatorId,
      operatorId,
      effect,
      {
        geometryBinding: effect.geometryBinding,
        operatorFamily: effect.operatorFamily,
      },
    ),
  );
}

/**
 * @param {object} effect
 * @param {string} sealPrefix
 * @param {object} counters
 * @param {object[]} nodes
 * @param {object[]} edges
 */
function buildScopeFilterGraph(effect, sealPrefix, counters, nodes, edges) {
  const operatorId = `node.operator.target_selector.${sealPrefix}.${counters.operator++}`;
  const targetId = `node.target.center_group.${sealPrefix}.0`;
  nodes.push(targetSelectorNode(operatorId, effect));
  edges.push(
    edge(
      `edge.operator.filters_target.${sealPrefix}`,
      'filters_target',
      operatorId,
      targetId,
      effect,
      {
        geometryBinding: effect.geometryBinding,
        operatorFamily: effect.operatorFamily,
      },
    ),
  );
}

/**
 * @param {object} effect
 * @param {string} sealPrefix
 * @param {object} counters
 * @param {object[]} nodes
 * @param {object[]} edges
 * @returns {string}
 */
function buildWatershotGraph(effect, sealPrefix, counters, nodes, edges) {
  const domainShort = domainShortFor(effect.domainRegistryId);
  const domainId = `node.domain.${domainShort}.${sealPrefix}.${counters.domain++}`;
  const sourceId = `node.source.${domainShort}.${sealPrefix}.${counters.source++}`;
  const shapeId = `node.shape.column.${sealPrefix}.${counters.shape++}`;
  const isWaterColumn = effect.domainRegistryId === 'sigil.water';
  const diagId = `node.diag.${isWaterColumn ? 'watershot' : `${domainShort}_column`}.${sealPrefix}.${counters.diagnostic++}`;

  nodes.push(
    domainNode(domainId, domainShort, effect.domainRegistryId, effect),
    sourceModeNode(sourceId, effect),
    shapeFieldNode(shapeId, effect),
    diagnosticMarkerNode(
      diagId,
      isWaterColumn ? 'watershot_warning' : 'generated_column_warning',
      effect,
    ),
  );

  edges.push(
    edge(`edge.requires.domain_source.${sealPrefix}`, 'requires', domainId, sourceId, effect),
    edge(`edge.requires.column_domain.${sealPrefix}`, 'requires', shapeId, domainId, effect, {
      geometryBinding: { ownerSeal: sealPrefix, ringIndex: 0 },
    }),
    edge(`edge.binds_geometry.column.${sealPrefix}`, 'binds_geometry', shapeId, shapeId, effect, {
      geometryBinding: effect.geometryBinding,
    }),
    edge(`edge.degrades_warning.${sealPrefix}`, 'degrades_to_warning', diagId, shapeId, effect),
  );

  return shapeId;
}

function buildCrushWaterMistGraph(effect, sealPrefix, counters, nodes, edges) {
  const domainId = `node.domain.water.${sealPrefix}.${counters.domain++}`;
  const transformId = `node.transform.mist.${sealPrefix}.${counters.transform++}`;
  const diagId = `node.diag.crush_water_mist.${sealPrefix}.${counters.diagnostic++}`;

  nodes.push(
    domainNode(domainId, 'water', effect.domainRegistryId, effect),
    crushMistTransformNode(transformId, effect),
    diagnosticMarkerNode(diagId, 'crush_water_mist_warning', effect),
  );

  edges.push(
    edge(`edge.crush_mist_modifies.${sealPrefix}`, 'modifies', transformId, domainId, effect, {
      geometryBinding: { transformKind: 'crush_water_mist', effectKind: 'crush_water_mist' },
    }),
    edge(`edge.degrades_crush_mist.${sealPrefix}`, 'degrades_to_warning', diagId, transformId, effect),
  );
}

/**
 * Outward dispersion emission (inverted column or sign.dispersion).
 *
 * @param {object} effect
 * @param {string} sealPrefix
 * @param {object} counters
 * @param {object[]} nodes
 * @param {object[]} edges
 */
/**
 * Uniform sign.pull force (inward or push-from-inversion metadata).
 *
 * @param {object} effect
 * @param {string} sealPrefix
 * @param {object} counters
 * @param {object[]} nodes
 * @param {object[]} edges
 */
function buildPullSignGraph(effect, sealPrefix, counters, nodes, edges) {
  const domainShort = effect.domainRegistryId.replace('sigil.', '');
  const domainId = `node.domain.${domainShort}.${sealPrefix}.${counters.domain++}`;
  const forceId = `node.force.pull.${sealPrefix}.${counters.force++}`;
  const diagId = `node.diag.pull.${sealPrefix}.${counters.diagnostic++}`;
  const forceKind =
    effect.pullMode === 'push' || effect.effectKind === 'push' ? 'push' : 'pull';

  nodes.push(
    domainNode(domainId, domainShort, effect.domainRegistryId, effect),
    {
      nodeId: forceId,
      nodeType: 'force_constraint',
      forceKind,
      signRole: effect.signRole ?? 'pull',
      pullMode: effect.pullMode ?? forceKind,
      effectKind: effect.effectKind ?? 'pull_sign',
      registryId: 'sign.pull',
      directionMode: effect.directionMode ?? effect.geometryBinding?.directionMode,
      pullTwist: effect.pullTwist ?? effect.geometryBinding?.pullTwist ?? null,
      pushMetadata: effect.pushMetadata ?? null,
      geometryBinding: effect.geometryBinding,
      evidenceTier: effect.evidenceTier,
      evidenceRefs: effect.evidenceRefs ?? [],
      provenanceClass: effect.provenanceClass,
      sourceObjects: effect.sourceObjects ?? [],
      warningScoped: effect.warningScoped === true,
      active: true,
    },
    diagnosticMarkerNode(
      diagId,
      forceKind === 'push' ? 'pull_inverted_push' : 'pull_warning',
      effect,
    ),
  );

  edges.push(
    edge(`edge.pull_requires.${domainShort}.${sealPrefix}`, 'requires', forceId, domainId, effect),
    edge(`edge.binds_geometry.pull.${sealPrefix}`, 'binds_geometry', forceId, forceId, effect, {
      geometryBinding: effect.geometryBinding,
    }),
    edge(`edge.degrades_pull.${sealPrefix}`, 'degrades_to_warning', diagId, forceId, effect),
  );
}

/**
 * Uniform sign.region on-ring emission zone.
 *
 * @param {object} effect
 * @param {string} sealPrefix
 * @param {object} counters
 * @param {object[]} nodes
 * @param {object[]} edges
 */
function buildRegionSignGraph(effect, sealPrefix, counters, nodes, edges) {
  const domainShort = effect.domainRegistryId.replace('sigil.', '');
  const domainId = `node.domain.${domainShort}.${sealPrefix}.${counters.domain++}`;
  const shapeId = `node.shape.region.${sealPrefix}.${counters.shape++}`;
  const diagId = `node.diag.region.${sealPrefix}.${counters.diagnostic++}`;

  nodes.push(
    domainNode(domainId, domainShort, effect.domainRegistryId, effect),
    regionShapeNode(shapeId, effect),
    diagnosticMarkerNode(diagId, 'region_warning', effect),
  );

  edges.push(
    edge(`edge.requires.region_domain.${sealPrefix}`, 'requires', shapeId, domainId, effect, {
      geometryBinding: { emissionPlacement: effect.emissionPlacement, regionZone: effect.regionZone },
    }),
    edge(`edge.binds_geometry.region.${sealPrefix}`, 'binds_geometry', shapeId, shapeId, effect, {
      geometryBinding: effect.geometryBinding,
    }),
    edge(`edge.degrades_region_warning.${sealPrefix}`, 'degrades_to_warning', diagId, shapeId, effect),
  );
}

/**
 * Uniform sign.collection collect_nearby source mode (no material creation).
 *
 * @param {object} effect
 * @param {string} sealPrefix
 * @param {object} counters
 * @param {object[]} nodes
 * @param {object[]} edges
 */
function buildCollectionSignGraph(effect, sealPrefix, counters, nodes, edges) {
  const domainShort = effect.domainRegistryId.replace('sigil.', '');
  const domainId = `node.domain.${domainShort}.${sealPrefix}.${counters.domain++}`;
  const sourceId = `node.source.collection.${sealPrefix}.${counters.source++}`;
  const diagId = `node.diag.collection.${sealPrefix}.${counters.diagnostic++}`;

  nodes.push(
    domainNode(domainId, domainShort, effect.domainRegistryId, effect),
    collectionSourceModeNode(sourceId, effect),
    diagnosticMarkerNode(diagId, 'collection_warning', effect),
  );

  edges.push(
    edge(`edge.collection_requires.${domainShort}.${sealPrefix}`, 'requires', sourceId, domainId, effect),
    edge(`edge.binds_geometry.collection.${sealPrefix}`, 'binds_geometry', sourceId, sourceId, effect, {
      geometryBinding: effect.geometryBinding,
    }),
    edge(`edge.degrades_collection.${sealPrefix}`, 'degrades_to_warning', diagId, sourceId, effect),
  );
}

/**
 * Uniform sign.gather gather_active source mode (distinct from collection).
 *
 * @param {object} effect
 * @param {string} sealPrefix
 * @param {object} counters
 * @param {object[]} nodes
 * @param {object[]} edges
 */
function buildGatherSignGraph(effect, sealPrefix, counters, nodes, edges) {
  const domainShort = effect.domainRegistryId.replace('sigil.', '');
  const domainId = `node.domain.${domainShort}.${sealPrefix}.${counters.domain++}`;
  const sourceId = `node.source.gather.${sealPrefix}.${counters.source++}`;
  const diagId = `node.diag.gather.${sealPrefix}.${counters.diagnostic++}`;

  nodes.push(
    domainNode(domainId, domainShort, effect.domainRegistryId, effect),
    gatherSourceModeNode(sourceId, effect),
    diagnosticMarkerNode(diagId, 'gather_warning', effect),
  );

  edges.push(
    edge(`edge.gather_requires.${domainShort}.${sealPrefix}`, 'requires', sourceId, domainId, effect),
    edge(`edge.binds_geometry.gather.${sealPrefix}`, 'binds_geometry', sourceId, sourceId, effect, {
      geometryBinding: effect.geometryBinding,
    }),
    edge(`edge.degrades_gather.${sealPrefix}`, 'degrades_to_warning', diagId, sourceId, effect),
  );
}

/**
 * Symmetric inward convergence point-focus force metadata.
 *
 * @param {object} effect
 * @param {string} sealPrefix
 * @param {object} counters
 * @param {object[]} nodes
 * @param {object[]} edges
 */
function buildConvergenceSignGraph(effect, sealPrefix, counters, nodes, edges) {
  const domainShort = effect.domainRegistryId.replace('sigil.', '');
  const domainId = `node.domain.${domainShort}.${sealPrefix}.${counters.domain++}`;
  const forceId = `node.force.convergence.${sealPrefix}.${counters.force++}`;
  const diagId = `node.diag.convergence.${sealPrefix}.${counters.diagnostic++}`;

  nodes.push(
    domainNode(domainId, domainShort, effect.domainRegistryId, effect),
    {
      nodeId: forceId,
      nodeType: 'force_constraint',
      forceKind: 'converge',
      signRole: 'convergence',
      convergenceMode: effect.convergenceMode ?? 'point_focus',
      pointFocus: effect.pointFocus === true,
      effectKind: effect.effectKind ?? 'convergence_point_focus',
      registryId: 'sign.convergence',
      geometryBinding: effect.geometryBinding,
      evidenceTier: effect.evidenceTier,
      evidenceRefs: effect.evidenceRefs ?? [],
      provenanceClass: effect.provenanceClass,
      sourceObjects: effect.sourceObjects ?? [],
      warningScoped: effect.warningScoped === true,
      active: true,
    },
    diagnosticMarkerNode(diagId, 'convergence_warning', effect),
  );

  edges.push(
    edge(`edge.convergence_requires.${domainShort}.${sealPrefix}`, 'requires', forceId, domainId, effect),
    edge(`edge.binds_geometry.convergence.${sealPrefix}`, 'binds_geometry', forceId, forceId, effect, {
      geometryBinding: effect.geometryBinding,
    }),
    edge(`edge.degrades_convergence.${sealPrefix}`, 'degrades_to_warning', diagId, forceId, effect),
  );
}

function buildOutwardDispersionGraph(effect, sealPrefix, counters, nodes, edges) {
  const domainShort = effect.domainRegistryId.replace('sigil.', '');
  const domainId = `node.domain.${domainShort}.${sealPrefix}.${counters.domain++}`;
  const shapeId = `node.shape.dispersion.${sealPrefix}.${counters.shape++}`;
  const diagId = `node.diag.outward_dispersion.${sealPrefix}.${counters.diagnostic++}`;

  nodes.push(
    domainNode(domainId, domainShort, effect.domainRegistryId, effect),
    dispersionShapeNode(shapeId, effect),
    diagnosticMarkerNode(diagId, 'outward_dispersion_warning', effect),
  );

  edges.push(
    edge(`edge.requires.dispersion_domain.${sealPrefix}`, 'requires', shapeId, domainId, effect),
    edge(`edge.binds_geometry.dispersion.${sealPrefix}`, 'binds_geometry', shapeId, shapeId, effect, {
      geometryBinding: effect.geometryBinding,
    }),
    edge(`edge.degrades_dispersion_warning.${sealPrefix}`, 'degrades_to_warning', diagId, shapeId, effect),
  );

  return shapeId;
}

function buildWeakModifierGraph(effect, sealPrefix, counters, nodes, edges) {
  if (effect.temperatureDriver) {
    return buildTemperatureDriverGraph(effect, sealPrefix, counters, nodes, edges);
  }
  if (effect.luminousModifier) {
    return buildLuminousModifierGraph(effect, sealPrefix, counters, nodes, edges);
  }
  return buildRadialGraph(effect, sealPrefix, counters, nodes, edges);
}

function buildTemperatureDriverGraph(effect, sealPrefix, counters, nodes, edges) {
  const weak = effect.weakEffect ?? effect.temperatureDriver?.direction ?? 'temperature';
  const driverId = `node.temperature_driver.${weak}.${sealPrefix}.${counters.driver++}`;
  nodes.push(temperatureDriverNode(driverId, effect));

  const domainId = ensureDomainNodeForEffect(effect, sealPrefix, counters, nodes);
  if (domainId) {
    edges.push(
      edge(`edge.weakens_to.${weak}.${sealPrefix}.${counters.driver}`, 'weakens_to', domainId, driverId, effect, {
        subelementRegistryId: effect.subelementRegistryId ?? null,
        weakEffect: effect.weakEffect ?? null,
      }),
    );
  }

  return driverId;
}

function buildLuminousModifierGraph(effect, sealPrefix, counters, nodes, edges) {
  const nodeId = `node.luminous.glow.${sealPrefix}.${counters.transform++}`;
  nodes.push(luminousModifierNode(nodeId, effect));
  const domainId = ensureDomainNodeForEffect(effect, sealPrefix, counters, nodes);
  if (domainId) {
    edges.push(
      edge(`edge.weakens_to.glow.${sealPrefix}.${counters.transform}`, 'weakens_to', domainId, nodeId, effect, {
        subelementRegistryId: effect.subelementRegistryId ?? 'subelement.glow',
        thermalByDefault: false,
      }),
    );
  }
  return nodeId;
}

function buildPhaseStateBindingGraph(effect, driverId, sealPrefix, counters, nodes, edges) {
  const phaseId = `node.phase.${domainShortFor(effect.domainRegistryId)}.${sealPrefix}.${counters.state++}`;
  nodes.push(phaseStateNode(phaseId, effect));
  if (effect.binding?.materialProfileId) {
    const materialId = `node.material.${String(effect.binding.materialProfileId).replace(/\W+/g, '_')}.${sealPrefix}.${counters.material++}`;
    nodes.push(materialPresetNode(materialId, effect));
    edges.push(
      edge(`edge.material_phase.${sealPrefix}.${counters.material}`, 'crosses_phase_boundary', materialId, phaseId, effect, {
        materialProfileId: effect.binding.materialProfileId,
        phaseBoundaryModel: 'specific_energy_plateau',
      }),
    );
  }
  edges.push(
    edge(`edge.driver.energy.${sealPrefix}.${counters.state}`, 'drives_specific_energy', driverId, phaseId, effect, {
      temperatureDriver: effect.temperatureDriver,
      targetQuery: effect.targetQuery ?? null,
      binding: effect.binding ?? null,
    }),
  );
  if (effect.strengthenApplied === true || effect.temperatureDriver?.retentionGain > 0) {
    edges.push(
      edge(
        `edge.driver.stabilizes.${sealPrefix}.${counters.state}`,
        'stabilizes_state',
        driverId,
        phaseId,
        effect,
        {
          retentionGain: effect.temperatureDriver?.retentionGain ?? 0,
          stabilizationMode:
            effect.temperatureDriver?.stabilizationMode ?? 'retains_driver_state',
          doesNotChangeTemperatureDirectly: true,
        },
      ),
    );
  }
  edges.push(
    edge(`edge.phase.boundary.${sealPrefix}.${counters.state}`, 'crosses_phase_boundary', phaseId, phaseId, effect, {
      phaseChange:
        effect.temperatureDriver?.instantPhaseChange === false
          ? 'gradual_not_instant'
          : 'suppressed_without_runtime_state',
      bounded: true,
    }),
  );
  return phaseId;
}

function buildCondensationCandidateGraphs(effects, sealPrefix, counters, nodes, edges) {
  const coolingNodes = nodes.filter(
    (node) =>
      nodeBelongsToSeal(node.nodeId, sealPrefix) &&
      node.nodeType === 'temperature_driver' &&
      node.temperatureDriver?.direction === 'cool' &&
      edges.some(
        (edgeRecord) =>
          edgeRecord.edgeType === 'drives_specific_energy' &&
          edgeRecord.fromNodeId === node.nodeId &&
          nodes.some(
            (targetNode) =>
              targetNode.nodeId === edgeRecord.toNodeId &&
              targetNode.nodeType === 'phase_state' &&
              targetNode.registryId === 'material.water',
          ),
      ),
  );
  if (coolingNodes.length === 0) return;

  const intakeEffects = effects.filter(
    (effect) =>
      effect.kind === 'operator_result' &&
      effect.operatorFamily === 'material_intake' &&
      isCondensationSource(effect.domainRegistryId),
  );
  if (intakeEffects.length === 0) return;

  for (const cooling of coolingNodes) {
    for (const intake of intakeEffects) {
      const sourceId = nodes.find(
        (node) =>
          nodeBelongsToSeal(node.nodeId, sealPrefix) &&
          node.nodeType === 'source_mode' &&
          node.signRole === (intake.signRegistryId === 'sign.gather' ? 'gather' : 'collection') &&
          node.sourceObjects?.some?.((source) =>
            (intake.sourceObjects ?? []).some((other) => other.objectId === source.objectId),
          ),
      )?.nodeId;
      if (!sourceId) continue;

      const candidateId = `node.material.condensation_candidate.${sealPrefix}.${counters.material++}`;
      nodes.push(condensationCandidateNode(candidateId, cooling, intake));
      edges.push(
        edge(
          `edge.condensation.source.${sealPrefix}.${counters.material}`,
          'filters_target',
          sourceId,
          candidateId,
          intake,
          {
            materialIntake: intake.materialIntake ?? null,
            sourceMode: intake.sourceMode ?? null,
            conservativeCandidate: true,
          },
        ),
        edge(
          `edge.condensation.cooling.${sealPrefix}.${counters.material}`,
          'drives_specific_energy',
          cooling.nodeId,
          candidateId,
          cooling,
          {
            temperatureDriver: cooling.temperatureDriver,
            condensationRequiresMaterialIntake: true,
            doesNotCreateMaterial: true,
          },
        ),
      );
    }
  }
}

function isCondensationSource(registryId) {
  return registryId === 'sigil.water' || registryId === 'subelement.mist';
}

function ensureDomainNodeForEffect(effect, sealPrefix, counters, nodes) {
  if (!effect.domainRegistryId) return null;
  const domainShort = domainShortFor(effect.domainRegistryId);
  const existing = nodes.find(
    (n) =>
      nodeBelongsToSeal(n.nodeId, sealPrefix) &&
      n.nodeType === 'domain' &&
      n.registryId === effect.domainRegistryId,
  );
  if (existing) return existing.nodeId;
  const domainId = `node.domain.${domainShort}.${sealPrefix}.${counters.domain++}`;
  nodes.push(domainNode(domainId, domainShort, effect.domainRegistryId, effect));
  return domainId;
}

function domainShortFor(registryId) {
  return String(registryId ?? 'unknown').replace('sigil.', '').replace(/\W+/g, '_');
}

/**
 * @param {object} effect
 * @param {string} sealPrefix
 * @param {object} counters
 * @param {object[]} nodes
 * @param {object[]} edges
 * @returns {string}
 */
function buildRadialGraph(effect, sealPrefix, counters, nodes, edges) {
  const domainShort = effect.domainRegistryId.replace('sigil.', '');
  const domainId = `node.domain.${domainShort}.${sealPrefix}.${counters.domain++}`;
  const transformId = `node.transform.${effect.weakEffect}.${sealPrefix}.${counters.transform++}`;
  const diagId = `node.diag.radial.${sealPrefix}.${counters.diagnostic++}`;

  nodes.push(
    domainNode(domainId, domainShort, effect.domainRegistryId, effect),
    materialTransformNode(transformId, effect),
    diagnosticMarkerNode(diagId, 'radial_custom_supported', effect),
  );

  edges.push(
    edge(`edge.radial_modifies.${domainShort}.${sealPrefix}`, 'modifies', transformId, domainId, effect, {
      geometryBinding: {
        ringIndex: effect.ringIndex,
        pointedAtSigilId: effect.pointedAtSigilId,
        radialCount: effect.radialObjectIds?.length,
      },
    }),
    edge(`edge.degrades_radial.${sealPrefix}`, 'degrades_to_warning', diagId, transformId, effect),
  );

  return transformId;
}

/**
 * @param {object} effect
 * @param {string} sealPrefix
 * @param {object} counters
 * @param {object[]} nodes
 * @param {object[]} edges
 */
function buildLevitationGraph(effect, sealPrefix, counters, nodes, edges) {
  const domainShort = effect.domainRegistryId.replace('sigil.', '');
  const domainId = `node.domain.${domainShort}.${sealPrefix}.${counters.domain++}`;
  const forceId = `node.force.levitation.${sealPrefix}.${counters.force++}`;
  const diagId = `node.diag.levitation.${sealPrefix}.${counters.diagnostic++}`;

  nodes.push(
    domainNode(domainId, domainShort, effect.domainRegistryId, effect),
    {
      nodeId: forceId,
      nodeType: 'force_constraint',
      forceKind: effect.domainRegistryId === 'sigil.wind' ? 'wind_stream' : 'float',
      registryId: 'sign.levitation',
      geometryBinding: effect.geometryBinding,
      continuousStream: effect.continuousStream === true,
      oneShotLaunch: effect.oneShotLaunch === true,
      heightFromSignLength: effect.heightFromSignLength,
      motionMode: effect.motionMode ?? null,
      verticalLift: effect.verticalLift ?? null,
      translationVector: effect.translationVector ?? null,
      tangentialBias: effect.tangentialBias ?? null,
      torqueDirection: effect.torqueDirection ?? null,
      evidenceTier: effect.evidenceTier,
      evidenceRefs: effect.evidenceRefs ?? [],
      provenanceClass: effect.provenanceClass,
      sourceObjects: effect.sourceObjects ?? [],
      warningScoped: effect.warningScoped === true,
      active: true,
    },
    diagnosticMarkerNode(diagId, 'levitation_warning', effect),
  );

  edges.push(
    edge(`edge.levitation_requires.${domainShort}.${sealPrefix}`, 'requires', forceId, domainId, effect),
    edge(`edge.binds_geometry.levitation.${sealPrefix}`, 'binds_geometry', forceId, forceId, effect, {
      geometryBinding: effect.geometryBinding,
    }),
    edge(`edge.degrades_levitation.${sealPrefix}`, 'degrades_to_warning', diagId, forceId, effect),
  );
}

/**
 * @param {object} effect
 * @param {string} sealPrefix
 * @param {object} counters
 * @param {object[]} nodes
 * @param {object[]} edges
 * @param {Map<string, string>} transformBySealDomain
 * @param {Map<string, string>} shapeBySeal
 */
function buildCrosshairCenterGroupGraph(
  effect,
  sealPrefix,
  counters,
  nodes,
  edges,
  transformBySealDomain,
  shapeBySeal,
) {
  const inner = effect.innerTarget;
  const modifier = effect.modifierEffect;
  const centerGroup = effect.centerGroup;

  const targetId = `node.target.center_group.${sealPrefix}.${counters.target++}`;
  const crosshairDiagId = `node.diag.crosshair.${sealPrefix}.${counters.diagnostic++}`;
  const heatedDiagId = `node.diag.heated_water.${sealPrefix}.${counters.diagnostic++}`;

  const targetedNodeIds = [];
  let innerShapeId =
    shapeBySeal.get(`${sealPrefix}:${inner.domainRegistryId ?? ''}`) ??
    shapeBySeal.get(sealPrefix) ??
    null;

  if (inner.kind === 'watershot_column' || inner.kind === 'operator_field_emit') {
    if (innerShapeId) targetedNodeIds.push(innerShapeId);
  }

  nodes.push({
    nodeId: targetId,
    nodeType: 'target',
    targetKind: inner.targetKind ?? 'center_group',
    centerSigilId: centerGroup.centerSigilId,
    targetedNodeIds,
    targetabilitySource: 'sign.crosshair',
    registryId: 'sign.crosshair',
    evidenceTier: effect.evidenceTier,
    evidenceRefs: effect.evidenceRefs,
    provenanceClass: effect.provenanceClass,
    sourceObjects: [{ objectId: effect.crosshairObjectId, registryId: 'sign.crosshair' }],
    active: true,
  });

  nodes.push(
    diagnosticMarkerNode(crosshairDiagId, 'crosshair_custom_supported', effect),
    diagnosticMarkerNode(heatedDiagId, 'heated_water_column_warning', effect),
  );

  let modifierTransformId =
    transformBySealDomain.get(`object:${modifier.domainSigilObjectId ?? ''}`) ??
    transformBySealDomain.get(
      `${sealPrefix}:${modifier.domainRegistryId}:${modifier.domainSigilObjectId ?? ''}`,
    ) ??
    transformBySealDomain.get(`${sealPrefix}:${modifier.domainRegistryId}`) ??
    null;

  if (!modifierTransformId && modifier.temperatureDriver) {
    modifierTransformId = buildTemperatureDriverGraph(modifier, sealPrefix, counters, nodes, edges);
  } else if (!modifierTransformId && modifier.luminousModifier) {
    modifierTransformId = buildLuminousModifierGraph(modifier, sealPrefix, counters, nodes, edges);
  } else if (!modifierTransformId) {
    modifierTransformId = `node.transform.${modifier.weakEffect ?? 'modifier'}.${sealPrefix}.0`;
  }
  if (modifier.temperatureDriver) {
    const driverNode = nodes.find((n) => n.nodeId === modifierTransformId);
    if (driverNode?.nodeType === 'temperature_driver') {
      Object.assign(driverNode, temperatureDriverNode(modifierTransformId, modifier));
    }
  }

  const applyToId = innerShapeId ?? targetId;

  edges.push(
    edge(`edge.crosshair_marks.${sealPrefix}`, 'binds_geometry', targetId, targetId, effect, {
      fromSign: 'sign.crosshair',
      geometryBinding: { centerSigilId: centerGroup.centerSigilId },
    }),
    edge(`edge.crosshair_warning.${sealPrefix}`, 'degrades_to_warning', crosshairDiagId, targetId, effect),
    edge(`edge.heated_water_warning.${sealPrefix}`, 'degrades_to_warning', heatedDiagId, applyToId, effect),
  );

  if (modifier.temperatureDriver && centerGroup.centerRegistryId === 'sigil.water') {
    const phaseId = buildPhaseStateBindingGraph(
      {
        ...effect,
        signRegistryId: modifier.signRegistryId ?? effect.signRegistryId,
        domainRegistryId: centerGroup.centerRegistryId,
        domainSigilObjectId: centerGroup.centerSigilId,
        weakEffect: modifier.weakEffect,
        intensityTier: modifier.intensityTier ?? 'base',
        intensityKind: modifier.intensityKind ?? null,
        strengthenApplied: modifier.strengthenApplied === true,
        temperatureDriver: modifier.temperatureDriver,
        binding: {
          bindingMode: 'scope_filter',
          centerSigilId: centerGroup.centerSigilId,
          centerRegistryId: centerGroup.centerRegistryId,
          materialProfileId: 'material.water',
          applyToId,
        },
        targetQuery: {
          material: 'water',
          spatialRelation: 'center_group',
          withinScopeFilter: true,
        },
      },
      modifierTransformId,
      sealPrefix,
      counters,
      nodes,
      edges,
    );
    if (targetedNodeIds.length === 0) targetedNodeIds.push(phaseId);
  }
}

/**
 * @param {string} nodeId
 * @param {string} domain
 * @param {string} registryId
 * @param {object} effect
 */
function domainNode(nodeId, domain, registryId, effect) {
  return {
    nodeId,
    nodeType: 'domain',
    domain,
    registryId,
    evidenceTier: effect.evidenceTier,
    evidenceRefs: effect.evidenceRefs ?? [],
    provenanceClass: effect.provenanceClass,
    sourceObjects: effect.sourceObjects ?? [],
    active: true,
  };
}

/**
 * @param {string} nodeId
 * @param {object} effect
 */
function sourceModeNode(nodeId, effect) {
  return {
    nodeId,
    nodeType: 'source_mode',
    mode: 'create_or_collect_unknown_warning',
    materialPresence: 'unknown_warn',
    creationAssumption: 'warning_scoped',
    evidenceTier: effect.evidenceTier,
    evidenceRefs: effect.evidenceRefs ?? [],
    provenanceClass: effect.provenanceClass,
    active: true,
  };
}

/**
 * @param {string} nodeId
 * @param {object} effect
 */
function collectionSourceModeNode(nodeId, effect) {
  return {
    nodeId,
    nodeType: 'source_mode',
    mode: 'collect_nearby',
    signRole: 'collection',
    materialPresence: 'nearby_unknown_warn',
    creationAssumption: 'no_creation',
    evidenceTier: effect.evidenceTier,
    evidenceRefs: effect.evidenceRefs ?? [],
    provenanceClass: effect.provenanceClass,
    sourceObjects: effect.sourceObjects ?? [],
    warningScoped: effect.warningScoped === true,
    active: true,
  };
}

/**
 * @param {string} nodeId
 * @param {object} effect
 */
function gatherSourceModeNode(nodeId, effect) {
  return {
    nodeId,
    nodeType: 'source_mode',
    mode: 'gather_active',
    signRole: 'gather',
    materialPresence: 'nearby_unknown_warn',
    creationAssumption: 'no_creation',
    evidenceTier: effect.evidenceTier,
    evidenceRefs: effect.evidenceRefs ?? [],
    provenanceClass: effect.provenanceClass,
    sourceObjects: effect.sourceObjects ?? [],
    warningScoped: effect.warningScoped === true,
    active: true,
  };
}

/**
 * @param {string} nodeId
 * @param {object} effect
 */
function shapeFieldNode(nodeId, effect) {
  return {
    nodeId,
    nodeType: 'shape_field',
    shape: 'column',
    registryId: effect.signRegistryId,
    geometryBinding: effect.geometryBinding,
    evidenceTier: effect.evidenceTier,
    evidenceRefs: effect.evidenceRefs ?? [],
    provenanceClass: effect.provenanceClass,
    sourceObjects: effect.sourceObjects ?? [],
    warningScoped: effect.warningScoped === true,
    active: true,
  };
}

/**
 * @param {string} nodeId
 * @param {object} effect
 */
function crushMistTransformNode(nodeId, effect) {
  return {
    nodeId,
    nodeType: 'material_transform',
    kind: 'sign_crush',
    fromDomain: effect.domainRegistryId,
    toMaterial: effect.weakEffect ?? 'mist',
    transformKind: effect.transformKind ?? 'crush_water_mist',
    effectKind: effect.effectKind ?? 'crush_water_mist',
    registryId: effect.signRegistryId ?? 'sign.crush',
    evidenceTier: effect.evidenceTier,
    evidenceRefs: effect.evidenceRefs ?? [],
    provenanceClass: effect.provenanceClass,
    sourceObjects: effect.sourceObjects ?? [],
    warningScoped: effect.warningScoped === true,
    active: true,
  };
}

/**
 * @param {string} nodeId
 * @param {object} effect
 */
function dispersionShapeNode(nodeId, effect) {
  return {
    nodeId,
    nodeType: 'shape_field',
    shape: 'dispersion',
    effectKind: effect.effectKind ?? 'dispersion_emission',
    registryIds: effect.signRegistryIds ?? [effect.signRegistryId].filter(Boolean),
    geometryBinding: effect.geometryBinding,
    evidenceTier: effect.evidenceTier,
    evidenceRefs: effect.evidenceRefs ?? [],
    provenanceClass: effect.provenanceClass,
    sourceObjects: effect.sourceObjects ?? [],
    warningScoped: effect.warningScoped === true,
    active: true,
  };
}

/**
 * @param {string} nodeId
 * @param {object} effect
 */
function regionShapeNode(nodeId, effect) {
  return {
    nodeId,
    nodeType: 'shape_field',
    shape: 'region',
    signRole: effect.signRole ?? 'region',
    effectKind: effect.effectKind ?? 'region_boundary',
    regionZone: effect.regionZone,
    emissionPlacement: effect.emissionPlacement,
    registryId: effect.signRegistryId ?? 'sign.region',
    geometryBinding: effect.geometryBinding,
    evidenceTier: effect.evidenceTier,
    evidenceRefs: effect.evidenceRefs ?? [],
    provenanceClass: effect.provenanceClass,
    sourceObjects: effect.sourceObjects ?? [],
    warningScoped: effect.warningScoped === true,
    active: true,
  };
}

/**
 * @param {string} nodeId
 * @param {object} effect
 */
function materialTransformNode(nodeId, effect) {
  return {
    nodeId,
    nodeType: 'material_transform',
    fromDomain: effect.domainRegistryId,
    toMaterial: effect.weakEffect,
    transformKind: effect.transformKind,
    registryId: effect.signRegistryId ?? 'sign.radial',
    evidenceTier: effect.evidenceTier,
    evidenceRefs: effect.evidenceRefs ?? [],
    provenanceClass: effect.provenanceClass,
    sourceObjects: effect.sourceObjects ?? [],
    warningScoped: effect.warningScoped === true,
    active: true,
  };
}

function temperatureDriverNode(nodeId, effect) {
  return {
    nodeId,
    nodeType: 'temperature_driver',
    registryId: effect.subelementRegistryId ?? effect.signRegistryId ?? null,
    signRegistryId: effect.signRegistryId ?? null,
    fromDomain: effect.domainRegistryId ?? null,
    domainSigilObjectId: effect.domainSigilObjectId ?? null,
    weakEffect: effect.weakEffect ?? null,
    intensityTier: effect.intensityTier ?? 'base',
    intensityKind: effect.intensityKind ?? null,
    strengthenApplied: effect.strengthenApplied === true,
    temperatureDriver: effect.temperatureDriver,
    equilibriumTempC: effect.temperatureDriver?.equilibriumTempC ?? null,
    minTempC: effect.temperatureDriver?.minTempC ?? null,
    maxTempC: effect.temperatureDriver?.maxTempC ?? null,
    bounded: effect.temperatureDriver?.bounded === true,
    strength: effect.temperatureDriver?.strength ?? null,
    minSpecificEnergy: effect.temperatureDriver?.minSpecificEnergy ?? null,
    maxSpecificEnergy: effect.temperatureDriver?.maxSpecificEnergy ?? null,
    retentionGain: effect.temperatureDriver?.retentionGain ?? 0,
    stabilizationMode: effect.temperatureDriver?.stabilizationMode ?? null,
    doesNotChangeTemperatureDirectlyFromStrengthen:
      effect.strengthenApplied === true || effect.temperatureDriver?.retentionGain > 0,
    doesNotCreateMaterial: effect.temperatureDriver?.doesNotCreateMaterial === true,
    doesNotPhaseChangeByItself:
      effect.temperatureDriver?.doesNotPhaseChangeByItself === true ||
      effect.temperatureDriver?.instantPhaseChange === false,
    geometryBinding: effect.geometryBinding,
    evidenceTier: effect.evidenceTier,
    evidenceRefs: effect.evidenceRefs ?? [],
    provenanceClass: effect.provenanceClass,
    sourceObjects: effect.sourceObjects ?? [],
    warningScoped: effect.warningScoped === true,
    active: true,
  };
}

function phaseStateNode(nodeId, effect) {
  const water = effect.domainRegistryId === 'sigil.water';
  const driver = effect.temperatureDriver ?? {};
  const materialProfile = effect.binding?.materialProfileId
    ? MATERIAL_PROFILES[effect.binding.materialProfileId]
    : null;
  const specificEnergy = water ? 0.55 : null;
  return {
    nodeId,
    nodeType: 'phase_state',
    registryId: effect.binding?.materialProfileId ?? (water ? 'material.water' : null),
    materialFamily: water ? 'water' : domainShortFor(effect.domainRegistryId),
    targetMaterial: water ? 'water' : domainShortFor(effect.domainRegistryId),
    phase:
      materialProfile && specificEnergy !== null
        ? phaseFromSpecificEnergy(materialProfile, specificEnergy)
        : water
          ? 'liquid'
          : 'unspecified',
    specificEnergy,
    specificEnergyUnits: water ? 'normalized_0_1' : null,
    phaseFraction: water ? 1 : null,
    phaseModel: water ? 'specific_energy_plateau' : 'symbolic_state_only',
    phaseThresholds: materialProfile
      ? {
          freezeSpecificEnergy: materialProfile.freezeSpecificEnergy,
          boilSpecificEnergy: materialProfile.boilSpecificEnergy,
          minSpecificEnergy: materialProfile.specificEnergyMin,
          maxSpecificEnergy: materialProfile.specificEnergyMax,
        }
      : null,
    centerSigilId: effect.binding?.centerSigilId ?? effect.targetQuery?.centerSigilId ?? null,
    centerRegistryId: effect.binding?.centerRegistryId ?? effect.domainRegistryId ?? null,
    thermalEffect: driver.thermalEffect ?? null,
    instantPhaseChange: driver.instantPhaseChange === true,
    gradualPhaseChange: driver.instantPhaseChange === false,
    condensationRequiresMaterialIntake: true,
    doesNotCreateMaterial: driver.doesNotCreateMaterial === true,
    geometryBinding: effect.geometryBinding,
    evidenceTier: effect.evidenceTier,
    evidenceRefs: effect.evidenceRefs ?? [],
    provenanceClass: effect.provenanceClass,
    sourceObjects: effect.sourceObjects ?? [],
    warningScoped: effect.warningScoped === true,
    active: true,
  };
}

function materialPresetNode(nodeId, effect) {
  const profile = effect.binding?.materialProfileId
    ? MATERIAL_PROFILES[effect.binding.materialProfileId]
    : null;
  return {
    nodeId,
    nodeType: 'material_preset',
    registryId: effect.binding?.materialProfileId ?? null,
    materialFamily: effect.domainRegistryId === 'sigil.water' ? 'water' : domainShortFor(effect.domainRegistryId),
    thermalProfile: effect.binding?.materialProfileId
      ? {
          model: 'specific_energy',
          phaseBoundary: 'latent_heat_plateau',
          bounded: true,
          specificEnergyMin: profile?.specificEnergyMin ?? 0,
          freezeSpecificEnergy: profile?.freezeSpecificEnergy ?? 0.33,
          boilSpecificEnergy: profile?.boilSpecificEnergy ?? 0.86,
          specificEnergyMax: profile?.specificEnergyMax ?? 1,
        }
      : null,
    evidenceTier: effect.evidenceTier,
    evidenceRefs: effect.evidenceRefs ?? [],
    provenanceClass: effect.provenanceClass,
    active: true,
  };
}

function condensationCandidateNode(nodeId, coolingEffect, intakeEffect) {
  return {
    nodeId,
    nodeType: 'material_preset',
    presetKind: 'condensation_candidate',
    registryId: 'material.water',
    materialFamily: 'water',
    sourceMode: intakeEffect.sourceMode ?? null,
    sourceRegistryId: intakeEffect.domainRegistryId ?? null,
    coolingDriver: {
      weakEffect: coolingEffect.weakEffect,
      direction: coolingEffect.temperatureDriver?.direction ?? null,
      bounded: coolingEffect.temperatureDriver?.bounded === true,
    },
    condensationRequiresMaterialIntake: true,
    conservativeCandidate: true,
    doesNotCreateMaterial: true,
    instantMaterialCreation: false,
    evidenceTier: coolingEffect.evidenceTier,
    evidenceRefs: [
      ...(coolingEffect.evidenceRefs ?? []),
      ...(intakeEffect.evidenceRefs ?? []),
    ],
    provenanceClass: coolingEffect.provenanceClass,
    sourceObjects: [
      ...(coolingEffect.sourceObjects ?? []),
      ...(intakeEffect.sourceObjects ?? []),
    ],
    active: true,
  };
}

function luminousModifierNode(nodeId, effect) {
  return {
    nodeId,
    nodeType: 'luminous_modifier',
    registryId: effect.subelementRegistryId ?? 'subelement.glow',
    fromDomain: effect.domainRegistryId,
    weakEffect: effect.weakEffect,
    spectralMode: effect.luminousModifier?.spectralMode ?? 'glow',
    thermalByDefault: false,
    geometryBinding: effect.geometryBinding,
    evidenceTier: effect.evidenceTier,
    evidenceRefs: effect.evidenceRefs ?? [],
    provenanceClass: effect.provenanceClass,
    sourceObjects: effect.sourceObjects ?? [],
    warningScoped: effect.warningScoped === true,
    active: true,
  };
}

/**
 * @param {string} nodeId
 * @param {object} effect
 */
function fieldLobeNode(nodeId, effect) {
  return {
    nodeId,
    nodeType: 'field_lobe',
    operatorFamily: effect.operatorFamily,
    registryId: effect.signRegistryId,
    anchorObjectId: effect.anchorObjectId ?? null,
    axis: effect.fieldLobe?.axis ?? effect.geometryBinding?.axis ?? null,
    vectorSum: effect.fieldLobe?.vectorSum ?? effect.geometryBinding?.vectorSum ?? null,
    magnitude: effect.fieldLobe?.magnitude ?? effect.geometryBinding?.magnitude ?? null,
    spread: effect.fieldLobe?.spread ?? effect.geometryBinding?.spread ?? null,
    cluster: effect.fieldLobe?.cluster ?? effect.geometryBinding?.cluster ?? null,
    compatibility: effect.fieldLobe?.compatibility ?? effect.geometryBinding?.compatibility ?? null,
    semanticOverrides: effect.fieldLobe?.semanticOverrides ?? effect.geometryBinding?.semanticOverrides ?? [],
    geometryBinding: effect.geometryBinding,
    evidenceTier: effect.evidenceTier,
    evidenceRefs: effect.evidenceRefs ?? [],
    provenanceClass: effect.provenanceClass,
    sourceObjects: effect.sourceObjects ?? [],
    warningScoped: effect.warningScoped === true,
    active: true,
  };
}

/**
 * @param {string} nodeId
 * @param {object} effect
 */
function modifierSourceNode(nodeId, effect) {
  return {
    nodeId,
    nodeType: 'modifier_source',
    operatorFamily: effect.operatorFamily,
    sourceEffectKind: effect.sourceEffectKind,
    registryId: effect.signRegistryId,
    fromDomain: effect.domainRegistryId,
    domainSigilObjectId: effect.domainSigilObjectId,
    weakEffect: effect.weakEffect,
    transformKind: effect.transformKind,
    geometryBinding: effect.geometryBinding,
    evidenceTier: effect.evidenceTier,
    evidenceRefs: effect.evidenceRefs ?? [],
    provenanceClass: effect.provenanceClass,
    sourceObjects: effect.sourceObjects ?? [],
    warningScoped: effect.warningScoped === true,
    active: true,
  };
}

/**
 * @param {string} nodeId
 * @param {object} effect
 */
function targetSelectorNode(nodeId, effect) {
  return {
    nodeId,
    nodeType: 'target_selector',
    operatorFamily: effect.operatorFamily,
    registryId: effect.signRegistryId,
    targetKind: effect.targetKind,
    centerSigilId: effect.centerGroup?.centerSigilId ?? null,
    centerRegistryId: effect.centerGroup?.centerRegistryId ?? null,
    modifierWeakEffect: effect.modifierWeakEffect,
    geometryBinding: effect.geometryBinding,
    evidenceTier: effect.evidenceTier,
    evidenceRefs: effect.evidenceRefs ?? [],
    provenanceClass: effect.provenanceClass,
    sourceObjects: effect.sourceObjects ?? [],
    warningScoped: effect.warningScoped === true,
    active: true,
  };
}

/**
 * @param {string} nodeId
 * @param {string} markerKind
 * @param {object} effect
 */
function diagnosticMarkerNode(nodeId, markerKind, effect) {
  return {
    nodeId,
    nodeType: 'diagnostic_marker',
    markerKind,
    status: 'compiled_with_warnings',
    fallback: 'compiled_with_warnings',
    evidenceTier: effect.evidenceTier,
    evidenceRefs: effect.evidenceRefs ?? [],
    active: true,
  };
}

/**
 * @param {string} edgeId
 * @param {string} edgeType
 * @param {string} fromNodeId
 * @param {string} toNodeId
 * @param {object} effect
 * @param {object} [extra]
 */
function edge(edgeId, edgeType, fromNodeId, toNodeId, effect, extra = {}) {
  return {
    edgeId,
    edgeType,
    fromNodeId,
    toNodeId,
    causality:
      edgeType === 'applies_modifier' || edgeType === 'targets' || edgeType === 'filters_target'
        ? 'interaction_causality'
        : 'semantic_dependency',
    evidenceTier: effect.evidenceTier,
    evidenceRefs: effect.evidenceRefs ?? [],
    diagnosticBehavior: 'none',
    ...extra,
  };
}

/**
 * A semantic lookup performed while building one seal must never reuse a node
 * from a previously-built independent seal. Node IDs encode the owning seal as
 * a dot-delimited segment, so keep that ownership check in one place.
 *
 * @param {string} nodeId
 * @param {string} sealPrefix
 */
function nodeBelongsToSeal(nodeId, sealPrefix) {
  return String(nodeId ?? '').split('.').includes(sealPrefix);
}

/**
 * Edge identity is content-derived from its endpoints, type, geometry, and
 * evidence. Builder-local readable IDs are intentionally not authoritative:
 * several effects of the same family may exist in one seal.
 *
 * Exact duplicate records collapse to one semantic edge. Distinct records get
 * distinct stable IDs even when they were emitted by the same builder.
 *
 * @param {object[]} edges
 */
function canonicalizeEdges(edges) {
  const seen = new Set();
  const canonical = [];
  for (const edgeRecord of edges) {
    const { edgeId: _builderId, ...identity } = edgeRecord;
    const signature = JSON.stringify(identity);
    if (seen.has(signature)) continue;
    seen.add(signature);
    canonical.push({
      ...edgeRecord,
      edgeId: `edge.${String(edgeRecord.edgeType ?? 'unknown').replace(/\W+/g, '_')}.${stableHexHash(identity)}`,
    });
  }
  return canonical;
}

/**
 * @param {object[]} nodes
 */
function sortNodes(nodes) {
  return [...nodes].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
}

/**
 * @param {object[]} edges
 */
function sortEdges(edges) {
  return [...edges].sort((a, b) => {
    const idCmp = a.edgeId.localeCompare(b.edgeId);
    if (idCmp !== 0) return idCmp;
    return a.fromNodeId.localeCompare(b.fromNodeId);
  });
}

/**
 * @param {string} programId
 * @param {object[]} nodes
 * @param {object[]} edges
 */
function deriveGraphId(programId, nodes, edges) {
  return `effect-graph:${stableHexHash({ programId, nodes, edges })}`;
}
