/**
 * Geometry and vector analysis for normalized sign instances.
 * See spec/magic-engine.md geometry-sensitive sign behavior.
 */

import { getSignOperatorDefinition } from './registry.js';

const DEFAULT_SIGN_SIZE = 200;
const VECTOR_SUM_TOLERANCE = 1e-6;
const FIELD_QUANTUM = 1e6;
const FIELD_LOBE_GAP_THRESHOLD_DEG = 120;
const DIRECTIONAL_BIAS_SENSITIVITY = 10;
const LEVITATION_DOMAIN_REGISTRY_IDS = new Set([
  'sigil.water',
  'sigil.fire',
  'sigil.earth',
  'sigil.wind',
  'sigil.light',
]);

/** Directional signs that reuse column placement/facing/symmetry pipeline (M1). */
const DIRECTIONAL_COLUMN_PARITY_REGISTRY_IDS = new Set([
  'sign.pull',
  'sign.region',
  'sign.dispersion',
  'sign.crush',
  'sign.collection',
  'sign.gather',
  'sign.convergence',
]);

const DIRECTIONAL_BIAS_REGISTRY_IDS = new Set([
  'sign.column',
  'sign.levitation',
  ...DIRECTIONAL_COLUMN_PARITY_REGISTRY_IDS,
]);

/**
 * @param {object | null | undefined} symbol
 */
function canContributeSemantics(symbol) {
  return (
    symbol?.semanticEligibility !== 'visual_only' &&
    symbol?.semanticEligibility !== 'unresolved' &&
    symbol?.semanticEligibility !== 'diagnostic_only' &&
    symbol?.semanticEligibility !== 'invalid_structure' &&
    symbol?.geometry?.visibility?.active !== false
  );
}

/**
 * Enrich a SpellProgram with per-instance geometry and same-kind aggregation.
 *
 * @param {object} program
 */
export function analyzeSpellGeometry(program) {
  const analysis = {
    seals: [],
    sameKindAggregations: [],
  };

  for (const seal of program.seals ?? []) {
    const sealAnalysis = analyzeSealGeometry(seal, program);
    seal.geometryAnalysis = sealAnalysis;
    analysis.seals.push({
      sealId: seal.sealId,
      signGroups: sealAnalysis.signGroups,
      watershotColumn: sealAnalysis.watershotColumn ?? null,
      outwardDispersion: sealAnalysis.outwardDispersion ?? null,
      pullSigns: sealAnalysis.pullSigns ?? null,
      regionLayout: sealAnalysis.regionLayout ?? null,
      radialPointing: sealAnalysis.radialPointing ?? null,
      centerGroup: sealAnalysis.centerGroup ?? null,
      levitation: sealAnalysis.levitation ?? null,
      modifierAffixes: sealAnalysis.modifierAffixes ?? null,
      centerAffixes: sealAnalysis.centerAffixes ?? null,
      crushLayout: sealAnalysis.crushLayout ?? null,
      collectionLayout: sealAnalysis.collectionLayout ?? null,
      gatherLayout: sealAnalysis.gatherLayout ?? null,
      convergenceLayout: sealAnalysis.convergenceLayout ?? null,
      operatorContributions: sealAnalysis.operatorContributions ?? [],
      operatorApplications: sealAnalysis.operatorApplications ?? [],
      fieldGroups: sealAnalysis.fieldGroups ?? [],
      fieldLobes: sealAnalysis.fieldLobes ?? [],
    });
    analysis.sameKindAggregations.push(...sealAnalysis.signGroups);
  }

  program.geometryAnalysis = analysis;
  return program;
}

/**
 * @param {object} seal
 * @param {object} program
 */
function analyzeSealGeometry(seal, program) {
  const instances = (seal.symbols ?? []).filter(
    (s) =>
      s.categoryHint === 'sign' &&
      s.objectId?.startsWith('sign-instance:') &&
      s.resolvedRegistryId &&
      canContributeSemantics(s),
  );

  for (const symbol of instances) {
    symbol.geometryAnalysis = enrichSignInstance(symbol, seal);
  }

  const groups = buildSameKindGroups(seal, instances, program);
  const outwardDispersion = analyzeOutwardDispersion(seal, groups);
  const pullSigns = analyzePullSigns(seal, groups);
  const regionLayout = analyzeRegionLayout(seal, groups);
  const watershotColumn = analyzeWatershotColumn(seal, groups);
  const radialPointing = analyzeRadialPointing(seal);
  const centerGroup = identifyCenterGroup(seal, groups, watershotColumn);
  const levitation = analyzeLevitation(seal, groups);
  const modifierAffixes = analyzeModifierAffixes(seal, centerGroup);
  const centerAffixes = analyzeCenterAffixes(seal, centerGroup);
  const crushLayout = analyzeCrush(seal, groups, centerGroup);
  const collectionLayout = analyzeCollectionLayout(seal, groups);
  const gatherLayout = analyzeGatherLayout(seal, groups);
  const convergenceLayout = analyzeConvergenceLayout(seal, groups);
  const operatorFields = analyzeOperatorFields(seal, groups);
  const operatorApplications = analyzeOperatorApplications({
    seal,
    outwardDispersion,
    pullSigns,
    regionLayout,
    levitation,
    collectionLayout,
    gatherLayout,
    convergenceLayout,
  });

  return {
    signGroups: groups,
    watershotColumn,
    outwardDispersion,
    pullSigns,
    regionLayout,
    radialPointing,
    centerGroup,
    levitation,
    modifierAffixes,
    centerAffixes,
    crushLayout,
    collectionLayout,
    gatherLayout,
    convergenceLayout,
    operatorContributions: operatorFields.operatorContributions,
    operatorApplications,
    fieldGroups: operatorFields.fieldGroups,
    fieldLobes: operatorFields.fieldLobes,
  };
}

/**
 * @param {object} symbol
 * @param {object} seal
 */
function enrichSignInstance(symbol, seal) {
  const geom = symbol.geometry ?? {};
  const placementPolarDeg =
    typeof geom.polarAngleDeg === 'number' ? geom.polarAngleDeg : 0;
  const facingDeg = typeof geom.facingDeg === 'number' ? geom.facingDeg : geom.angleDeg ?? 0;
  const profileRotationDeg =
    typeof geom.placementRotationDeg === 'number'
      ? geom.placementRotationDeg
      : geom.rotationDeg ?? 0;
  const size = typeof geom.size === 'number' ? geom.size : DEFAULT_SIGN_SIZE;
  const polarRadius = typeof geom.polarRadius === 'number' ? geom.polarRadius : 0;

  const positionAngleDeg = placementPolarDeg;
  const angleDerivedFacingDeg = normalizeDegrees(placementPolarDeg + facingDeg);
  const inverted = isInvertedFacing(facingDeg);
  const scaleWeight = size / DEFAULT_SIGN_SIZE;

  const directionVector = computeDirectionVector(placementPolarDeg, facingDeg);
  const radialComponents = decomposeRadialComponents(
    directionVector,
    placementPolarDeg,
    scaleWeight,
  );

  const ring = seal.rings?.[0];
  const placementZone =
    polarRadius <= 0
      ? 'on_ring'
      : ring && polarRadius <= (ring.radius ?? 0) + 1
        ? 'inside_ring'
        : 'outside_ring';

  return {
    positionAngleDeg,
    radialDistance: polarRadius,
    topOriginSlot: symbol.radial?.slotIndex ?? 0,
    profileRotationDeg,
    signAngleDeg: facingDeg,
    rotationDeg: geom.rotationDeg ?? profileRotationDeg,
    angleDerivedFacingDeg,
    inverted,
    scaleWeight,
    placementZone,
    directionVector,
    radialComponents,
    localPosition: geom.localPosition ?? { x: 0, y: 0 },
    programPosition: geom.programPosition ?? geom.localPosition ?? { x: 0, y: 0 },
  };
}

/**
 * @param {number} placementPolarDeg
 * @param {number} facingDeg
 */
function computeDirectionVector(placementPolarDeg, facingDeg) {
  const posRad = (placementPolarDeg * Math.PI) / 180;
  let dx = -Math.cos(posRad);
  let dy = -Math.sin(posRad);
  const faceRad = (facingDeg * Math.PI) / 180;
  const cosF = Math.cos(faceRad);
  const sinF = Math.sin(faceRad);
  return {
    x: dx * cosF - dy * sinF,
    y: dx * sinF + dy * cosF,
  };
}

/**
 * @param {{ x: number; y: number }} directionVector
 * @param {number} placementPolarDeg
 * @param {number} scaleWeight
 */
function decomposeRadialComponents(directionVector, placementPolarDeg, scaleWeight) {
  const posRad = (placementPolarDeg * Math.PI) / 180;
  const radialUx = Math.cos(posRad);
  const radialUy = Math.sin(posRad);
  const tangentialUx = -radialUy;
  const tangentialUy = radialUx;

  const { x, y } = directionVector;
  const inward = -(x * radialUx + y * radialUy) * scaleWeight;
  const outward = -inward;
  const tangentialRaw = x * tangentialUx + y * tangentialUy;
  const tangential =
    tangentialRaw >= 0
      ? tangentialRaw * scaleWeight
      : tangentialRaw * scaleWeight;
  const tangentialClockwise = tangential >= 0 ? tangential : 0;
  const tangentialCounterclockwise = tangential < 0 ? -tangential : 0;

  return {
    inward,
    outward,
    tangential,
    tangentialClockwise,
    tangentialCounterclockwise,
  };
}

/**
 * @param {object} seal
 * @param {object[]} instances
 * @param {object} program
 */
function buildSameKindGroups(seal, instances, program) {
  const byRegistry = /** @type {Record<string, object[]>} */ ({});

  for (const inst of instances) {
    const id = inst.resolvedRegistryId;
    if (!id) continue;
    if (!byRegistry[id]) byRegistry[id] = [];
    byRegistry[id].push(inst);
  }

  const importGroups = program.importMetadata?.sameKindSignGroups ?? [];
  const groups = [];

  for (const [registryId, groupInstances] of Object.entries(byRegistry)) {
    const importGroup = importGroups.find((g) => g.registryId === registryId);
    const profileIds = importGroup?.profileIds ?? [
      ...new Set(groupInstances.map((i) => i.radial?.profileId).filter(Boolean)),
    ];

    const duplicateVectorSet = groupInstances.map((inst) => {
      const ga = inst.geometryAnalysis;
      return {
        objectId: inst.objectId,
        profileId: inst.radial?.profileId ?? null,
        directionVector: ga.directionVector,
        scaleWeight: ga.scaleWeight,
        radialComponents: ga.radialComponents,
      };
    });

    const rawVectorSum = sumWeightedVectors(duplicateVectorSet);
    const vectorSum = DIRECTIONAL_BIAS_REGISTRY_IDS.has(registryId)
      ? amplifyDirectionalBias2(rawVectorSum)
      : rawVectorSum;
    const profileCount = profileIds.length;
    const symmetryClass = classifySymmetry(vectorSum, profileCount);

    const aggregation = {
      registryId,
      sealId: seal.sealId,
      profileIds,
      profileCount,
      instanceIds: groupInstances.map((i) => i.objectId),
      instanceCount: groupInstances.length,
      duplicateVectorSet,
      vectorSum,
      symmetryClass,
      biasMagnitude: vectorMagnitude(vectorSum),
      columnVectorClassification: null,
    };

    if (
      registryId === 'sign.column' ||
      DIRECTIONAL_COLUMN_PARITY_REGISTRY_IDS.has(registryId)
    ) {
      aggregation.columnVectorClassification = classifyColumnVector(
        vectorSum,
        profileCount,
        groupInstances.length,
      );
    }

    for (const inst of groupInstances) {
      inst.geometryAnalysis.sameKindGroupId = `same-kind:${registryId.replace(/\./g, '-')}`;
      inst.geometryAnalysis.vectorSum = vectorSum;
      inst.geometryAnalysis.symmetryClass = symmetryClass;
    }

    groups.push(aggregation);
  }

  return groups.sort((a, b) => a.registryId.localeCompare(b.registryId));
}

/**
 * @param {object[]} duplicateVectorSet
 */
function sumWeightedVectors(duplicateVectorSet) {
  let x = 0;
  let y = 0;
  let inward = 0;
  let outward = 0;
  let tangential = 0;

  for (const item of duplicateVectorSet) {
    const w = item.scaleWeight ?? 1;
    x += item.directionVector.x * w;
    y += item.directionVector.y * w;
    inward += item.radialComponents.inward;
    outward += item.radialComponents.outward;
    tangential += item.radialComponents.tangential;
  }

  return { x, y, inward, outward, tangential };
}

/**
 * @param {{ x?: number; y?: number; inward?: number; outward?: number; tangential?: number }} vector
 */
function amplifyDirectionalBias2(vector) {
  const x = vector.x ?? 0;
  const y = vector.y ?? 0;
  if (Math.hypot(x, y) <= VECTOR_SUM_TOLERANCE) {
    return vector;
  }
  return {
    ...vector,
    x: q(x * DIRECTIONAL_BIAS_SENSITIVITY),
    y: q(y * DIRECTIONAL_BIAS_SENSITIVITY),
  };
}

/**
 * @param {{ x: number; y: number }} vectorSum
 */
function vectorMagnitude(vectorSum) {
  return Math.hypot(vectorSum.x, vectorSum.y);
}

/**
 * @param {{ x: number; y: number }} vectorSum
 * @param {number} profileCount
 */
function classifySymmetry(vectorSum, profileCount) {
  const mag = vectorMagnitude(vectorSum);
  if (mag <= VECTOR_SUM_TOLERANCE) {
    return profileCount > 1 ? 'symmetric' : 'symmetric';
  }
  if (profileCount > 1) {
    return 'skewed_supported';
  }
  return mag > VECTOR_SUM_TOLERANCE ? 'skewed_supported' : 'symmetric';
}

/**
 * @param {{ x: number; y: number }} vectorSum
 * @param {number} profileCount
 * @param {number} instanceCount
 */
function classifyColumnVector(vectorSum, profileCount, instanceCount) {
  const mag = vectorMagnitude(vectorSum);
  if (mag <= VECTOR_SUM_TOLERANCE) {
    return instanceCount > 1 || profileCount > 1 ? 'centered' : 'centered';
  }
  if (profileCount > 1) {
    return 'multi_profile';
  }
  return 'biased';
}

/**
 * @param {object} seal
 * @param {object[]} groups
 */
function analyzeOperatorFields(seal, groups) {
  const centerSigil = resolveOwnerDomainSigil(seal);
  const centerPosition =
    centerSigil?.geometry?.programPosition ??
    centerSigil?.geometry?.localPosition ??
    { x: 0, y: 0 };
  const operatorContributions = [];

  for (const group of groups) {
    const operatorDefinition = getSignOperatorDefinition(group.registryId);
    if (operatorDefinition?.operatorFamily !== 'field_emit') continue;

    const instances = instancesForGroup(seal, group);
    for (const inst of instances) {
      const contribution = buildFieldContribution(
        inst,
        group,
        operatorDefinition,
        centerSigil,
        centerPosition,
      );
      if (!contribution) continue;
      inst.geometryAnalysis.operatorContribution = contribution;
      operatorContributions.push(contribution);
    }
  }

  const fieldGroups = groupFieldContributions(operatorContributions);
  const fieldLobes = fieldGroups.flatMap((group) => group.lobes);
  return { operatorContributions, fieldGroups, fieldLobes };
}

/**
 * @param {object} inst
 * @param {object} group
 * @param {object} operatorDefinition
 * @param {object | null} centerSigil
 * @param {{ x: number; y: number }} centerPosition
 */
function buildFieldContribution(inst, group, operatorDefinition, centerSigil, centerPosition) {
  const ga = inst.geometryAnalysis ?? {};
  const pos = ga.programPosition ?? inst.geometry?.programPosition ?? { x: 0, y: 0 };
  const semanticOverride = fieldSemanticOverrideForInstance(inst, group.registryId);
  const effectiveOperatorDefinition =
    semanticOverride?.operatorDefinition ?? operatorDefinition;
  const effectiveRegistryId = semanticOverride?.registryId ?? group.registryId;
  const polarity = effectiveOperatorDefinition.polarity ?? null;
  const horizontal =
    polarity === 'emit_outward_leak'
      ? normalize2({
          x: (pos.x ?? 0) - (centerPosition.x ?? 0),
          y: (pos.y ?? 0) - (centerPosition.y ?? 0),
        })
      : normalize2({
          x: (centerPosition.x ?? 0) - (pos.x ?? 0),
          y: (centerPosition.y ?? 0) - (pos.y ?? 0),
        });
  const lateralGain = effectiveOperatorDefinition.lateralGain ?? 0;
  const verticalGain = effectiveOperatorDefinition.verticalGain ?? 0;
  const axis = normalize3({
    x: horizontal.x * lateralGain,
    y: horizontal.y * lateralGain,
    z: verticalGain,
  });
  const magnitude = q(ga.scaleWeight ?? 1);
  const vector = scale3(axis, magnitude);

  return {
    contributionId: `operator-contribution:${inst.objectId}`,
    objectId: inst.objectId,
    registryId: effectiveRegistryId,
    sourceRegistryId: group.registryId,
    operatorFamily: effectiveOperatorDefinition.operatorFamily,
    polarity,
    anchorKind: effectiveOperatorDefinition.defaultAnchor ?? 'center_group',
    anchorObjectId: centerSigil?.objectId ?? null,
    anchorRegistryId: centerSigil?.resolvedRegistryId ?? null,
    positionAngleDeg: q(normalizeDegrees(ga.positionAngleDeg ?? 0)),
    sourcePath: inst.provenance?.sourcePath ?? '',
    magnitude,
    axis,
    vector,
    coefficients: {
      verticalGain,
      lateralGain,
      tangentialGain: effectiveOperatorDefinition.tangentialGain ?? 0,
      spreadGain: effectiveOperatorDefinition.spreadGain ?? 0,
    },
    sourceObjects: [{ objectId: inst.objectId, registryId: group.registryId }],
    semanticOverride: semanticOverride
      ? {
          fromRegistryId: group.registryId,
          toRegistryId: effectiveRegistryId,
          reason: semanticOverride.reason,
        }
      : null,
  };
}

/**
 * @param {object} inst
 * @param {string} registryId
 */
function fieldSemanticOverrideForInstance(inst, registryId) {
  if (registryId !== 'sign.dispersion') return null;
  if (inst.geometryAnalysis?.inverted !== true) return null;
  const operatorDefinition = getSignOperatorDefinition('sign.column');
  if (!operatorDefinition) return null;
  return {
    registryId: 'sign.column',
    operatorDefinition,
    reason: 'inverted_dispersion_resolves_as_column',
  };
}

/**
 * @param {object[]} contributions
 */
function groupFieldContributions(contributions) {
  const grouped = new Map();
  for (const contribution of contributions) {
    const key = JSON.stringify({
      operatorFamily: contribution.operatorFamily,
      registryId: contribution.registryId,
      anchorObjectId: contribution.anchorObjectId ?? null,
    });
    if (!grouped.has(key)) {
      grouped.set(key, {
        operatorFamily: contribution.operatorFamily,
        registryId: contribution.registryId,
        anchorObjectId: contribution.anchorObjectId ?? null,
        contributions: [],
      });
    }
    grouped.get(key).contributions.push(contribution);
  }

  return [...grouped.values()]
    .map((groupMeta, groupIndex) => {
      const sorted = stableContributionSort(groupMeta.contributions);
      const lobes = aggregateFieldLobes(sorted, {
        groupIndex,
        operatorFamily: groupMeta.operatorFamily,
        registryId: groupMeta.registryId,
        anchorObjectId: groupMeta.anchorObjectId,
      });
      return {
        fieldGroupId: `field-group:${groupMeta.operatorFamily}:${groupMeta.registryId}:${groupMeta.anchorObjectId ?? 'seal_center'}`,
        operatorFamily: groupMeta.operatorFamily,
        registryId: groupMeta.registryId,
        anchorObjectId: groupMeta.anchorObjectId,
        contributionIds: sorted.map((c) => c.contributionId),
        contributions: sorted,
        lobes,
      };
    })
    .sort((a, b) => a.fieldGroupId.localeCompare(b.fieldGroupId));
}

/**
 * @param {object[]} contributions
 */
function stableContributionSort(contributions) {
  return [...contributions].sort((a, b) => {
    if (a.positionAngleDeg !== b.positionAngleDeg) {
      return a.positionAngleDeg - b.positionAngleDeg;
    }
    const sourceCompare = String(a.sourcePath).localeCompare(String(b.sourcePath));
    if (sourceCompare !== 0) return sourceCompare;
    return String(a.objectId).localeCompare(String(b.objectId));
  });
}

/**
 * @param {object[]} contributions
 * @param {{ groupIndex: number; operatorFamily: string; registryId: string; anchorObjectId: string | null }} group
 */
function aggregateFieldLobes(contributions, group) {
  if (contributions.length === 0) return [];

  const clusters = clusterContributionsByAngle(contributions);
  return clusters
    .map((cluster, clusterIndex) => {
      const rawVectorSum = cluster.reduce(
        (sum, contribution) => add3(sum, contribution.vector),
        { x: 0, y: 0, z: 0 },
      );
      const vectorSum = amplifyDirectionalTilt3(rawVectorSum);
      const magnitude = q(vectorMagnitude3(vectorSum));
      return {
        lobeId: `field-lobe:${group.groupIndex}:${clusterIndex}`,
        operatorFamily: group.operatorFamily,
        registryId: group.registryId,
        anchorObjectId: group.anchorObjectId,
        contributionIds: cluster.map((c) => c.contributionId),
        sourceObjects: cluster.flatMap((c) => c.sourceObjects ?? []),
        semanticOverrides: cluster
          .map((c) => c.semanticOverride)
          .filter(Boolean),
        axis: normalize3(vectorSum),
        vectorSum,
        magnitude,
        spread: q(cluster.reduce((sum, c) => sum + (c.coefficients?.spreadGain ?? 0), 0) / cluster.length),
        cluster: {
          count: cluster.length,
          startAngleDeg: cluster[0].positionAngleDeg,
          endAngleDeg: cluster[cluster.length - 1].positionAngleDeg,
        },
        compatibility: {
          derivedLegacyShape: group.registryId === 'sign.column' ? 'column' : null,
        },
      };
    })
    .sort((a, b) => {
      if (Math.abs(a.magnitude - b.magnitude) > VECTOR_SUM_TOLERANCE) {
        return b.magnitude - a.magnitude;
      }
      return a.lobeId.localeCompare(b.lobeId);
    });
}

/**
 * @param {object[]} sortedContributions
 */
function clusterContributionsByAngle(sortedContributions) {
  if (sortedContributions.length <= 1) return [sortedContributions];

  const gaps = sortedContributions.map((contribution, index) => {
    const next = sortedContributions[(index + 1) % sortedContributions.length];
    const rawGap =
      index + 1 < sortedContributions.length
        ? next.positionAngleDeg - contribution.positionAngleDeg
        : 360 - contribution.positionAngleDeg + next.positionAngleDeg;
    return { index, gap: rawGap };
  });

  const breakIndexes = gaps
    .filter((g) => g.gap > FIELD_LOBE_GAP_THRESHOLD_DEG)
    .map((g) => g.index);
  if (breakIndexes.length === 0) return [sortedContributions];

  const clusters = [];
  for (let i = 0; i < breakIndexes.length; i++) {
    const start = (breakIndexes[i] + 1) % sortedContributions.length;
    const end = breakIndexes[(i + 1) % breakIndexes.length];
    const cluster = [];
    let cursor = start;
    while (true) {
      cluster.push(sortedContributions[cursor]);
      if (cursor === end) break;
      cursor = (cursor + 1) % sortedContributions.length;
    }
    clusters.push(cluster);
  }

  return clusters.sort((a, b) => {
    const angleA = a[0]?.positionAngleDeg ?? 0;
    const angleB = b[0]?.positionAngleDeg ?? 0;
    if (angleA !== angleB) return angleA - angleB;
    return String(a[0]?.objectId ?? '').localeCompare(String(b[0]?.objectId ?? ''));
  });
}

/**
 * @param {{ x: number; y: number }} vector
 */
function normalize2(vector) {
  const mag = Math.hypot(vector.x, vector.y);
  if (mag <= VECTOR_SUM_TOLERANCE) return { x: 0, y: 0 };
  return { x: q(vector.x / mag), y: q(vector.y / mag) };
}

/**
 * @param {{ x?: number; y?: number; z?: number }} vector
 */
function normalize3(vector) {
  const x = vector.x ?? 0;
  const y = vector.y ?? 0;
  const z = vector.z ?? 0;
  const mag = Math.hypot(x, y, z);
  if (mag <= VECTOR_SUM_TOLERANCE) return { x: 0, y: 0, z: 0 };
  return { x: q(x / mag), y: q(y / mag), z: q(z / mag) };
}

/**
 * @param {{ x: number; y: number; z: number }} a
 * @param {{ x: number; y: number; z: number }} b
 */
function add3(a, b) {
  return { x: q(a.x + b.x), y: q(a.y + b.y), z: q(a.z + b.z) };
}

/**
 * @param {{ x: number; y: number; z: number }} vector
 * @param {number} scalar
 */
function scale3(vector, scalar) {
  return {
    x: q(vector.x * scalar),
    y: q(vector.y * scalar),
    z: q(vector.z * scalar),
  };
}

/**
 * @param {{ x: number; y: number; z: number }} vector
 */
function amplifyDirectionalTilt3(vector) {
  const horizontal = Math.hypot(vector.x, vector.y);
  const vertical = vector.z;
  if (horizontal <= VECTOR_SUM_TOLERANCE || Math.abs(vertical) <= VECTOR_SUM_TOLERANCE) {
    return vector;
  }

  const angle = Math.atan2(horizontal, Math.abs(vertical));
  const amplifiedAngle = Math.min(angle * DIRECTIONAL_BIAS_SENSITIVITY, Math.PI / 2 - 1e-6);
  const amplifiedHorizontal = Math.tan(amplifiedAngle) * Math.abs(vertical);
  const scale = amplifiedHorizontal / horizontal;

  return {
    x: q(vector.x * scale),
    y: q(vector.y * scale),
    z: q(vertical),
  };
}

/**
 * @param {{ x: number; y: number; z: number }} vector
 */
function vectorMagnitude3(vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

/**
 * @param {number} value
 */
function q(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * FIELD_QUANTUM) / FIELD_QUANTUM;
}

/**
 * @param {{
 *   seal: object;
 *   outwardDispersion: object | null;
 *   pullSigns: object | null;
 *   regionLayout: object | null;
 *   levitation: object | null;
 *   collectionLayout: object | null;
 *   gatherLayout: object | null;
 *   convergenceLayout: object | null;
 * }} args
 */
function analyzeOperatorApplications(args) {
  const applications = [];
  const layouts = [
    { layout: args.outwardDispersion, signRegistryId: preferredOutwardRegistryId(args.outwardDispersion), legacyLayoutKind: 'outward_dispersion', legacyEffectKind: 'outward_dispersion' },
    { layout: args.pullSigns, signRegistryId: 'sign.pull', legacyLayoutKind: 'pull_sign', legacyEffectKind: 'sign_pull' },
    { layout: args.regionLayout, signRegistryId: 'sign.region', legacyLayoutKind: 'region_layout', legacyEffectKind: 'sign_region' },
    { layout: args.levitation, signRegistryId: 'sign.levitation', legacyLayoutKind: 'levitation', legacyEffectKind: args.levitation?.domainRegistryId === 'sigil.wind' ? 'levitation_wind' : 'levitation_fire' },
    { layout: args.collectionLayout, signRegistryId: 'sign.collection', legacyLayoutKind: 'collection_layout', legacyEffectKind: 'sign_collection' },
    { layout: args.gatherLayout, signRegistryId: 'sign.gather', legacyLayoutKind: 'gather_layout', legacyEffectKind: 'sign_gather' },
    { layout: args.convergenceLayout, signRegistryId: 'sign.convergence', legacyLayoutKind: 'convergence_layout', legacyEffectKind: 'sign_convergence' },
  ];

  for (const { layout, signRegistryId, legacyLayoutKind, legacyEffectKind } of layouts) {
    if (!layout || !signRegistryId) continue;
    const operatorDefinition = getSignOperatorDefinition(signRegistryId);
    if (!operatorDefinition) continue;
    applications.push(
      buildOperatorApplication(layout, signRegistryId, operatorDefinition, {
        sealId: args.seal.sealId,
        index: applications.length,
        legacyLayoutKind,
        legacyEffectKind,
      }),
    );
  }

  return applications.sort((a, b) => a.applicationId.localeCompare(b.applicationId));
}

/**
 * @param {object | null} outwardDispersion
 */
function preferredOutwardRegistryId(outwardDispersion) {
  if (!outwardDispersion?.instances?.length) return null;
  if (outwardDispersion.instances.some((i) => i.registryId === 'sign.dispersion')) {
    return 'sign.dispersion';
  }
  return 'sign.column';
}

/**
 * @param {object} layout
 * @param {string} signRegistryId
 * @param {object} operatorDefinition
 * @param {{ sealId: string; index: number; legacyLayoutKind: string; legacyEffectKind: string }} meta
 */
function buildOperatorApplication(layout, signRegistryId, operatorDefinition, meta) {
  const sourceObjects = (layout.instances ?? []).map((i) => ({
    objectId: i.objectId,
    registryId: i.registryId ?? signRegistryId,
  }));
  const base = {
    applicationId: `operator-application:${meta.sealId}:${signRegistryId}:${meta.index}`,
    operatorFamily: operatorDefinition.operatorFamily,
    operatorRole: operatorRoleForDefinition(operatorDefinition),
    signRegistryId,
    domainRegistryId: layout.domainRegistryId ?? null,
    domainSigilObjectId: layout.domainSigilObjectId ?? null,
    polarity: operatorDefinition.polarity ?? null,
    confidence: operatorDefinition.confidence ?? 'fan_documented_plausible',
    orientationProbe: operatorDefinition.orientationProbe ?? null,
    orientationProbeResolution: {
      status: operatorDefinition.orientationProbe
        ? 'recorded_fallback_current_facing_math'
        : 'not_required',
      behaviorSource: 'current_facing_math',
      diagnosticCode: operatorDefinition.orientationProbe
        ? 'geometry.unresolved_orientation_probe'
        : null,
    },
    legacyLayoutKind: meta.legacyLayoutKind,
    legacyEffectKind: meta.legacyEffectKind,
    sourceObjects,
    targetQuery: defaultTargetQuery(layout, signRegistryId, operatorDefinition),
    materialIntake: null,
    fieldModification: null,
    geometryBinding: {
      vectorSummary: layout.vectorSummary ?? layout.vectorSum ?? null,
      symmetric: layout.symmetric === true || layout.balanced === true,
      symmetryClass: layout.symmetryClass ?? null,
      biasMagnitude: q(layout.biasMagnitude ?? vectorMagnitude(layout.vectorSummary ?? layout.vectorSum ?? { x: 0, y: 0 })),
    },
  };

  if (signRegistryId === 'sign.pull') {
    return {
      ...base,
      directionMode: layout.directionMode,
      pullTwist: layout.pullTwist ?? null,
      pushMetadata:
        layout.directionMode === 'push'
          ? { fromPullInversion: true, pushInstanceCount: layout.pushInstances?.length ?? 0 }
          : null,
      geometryBinding: {
        ...base.geometryBinding,
        directionMode: layout.directionMode,
        pullTwist: layout.pullTwist ?? null,
        targetQuery: base.targetQuery,
      },
    };
  }

  if (signRegistryId === 'sign.region') {
    return {
      ...base,
      regionZone: layout.regionZone,
      emissionPlacement: layout.emissionPlacement ?? 'on_ring',
      geometryBinding: {
        ...base.geometryBinding,
        regionZone: layout.regionZone,
        emissionPlacement: layout.emissionPlacement ?? 'on_ring',
        targetQuery: base.targetQuery,
      },
    };
  }

  if (signRegistryId === 'sign.levitation') {
    return {
      ...base,
      motionMode: layout.motionMode,
      verticalLift: layout.verticalLift,
      translationVector: layout.translationVector,
      tangentialBias: layout.tangentialBias,
      torqueDirection: layout.torqueDirection,
      orbitBias: layout.orbitBias,
      geometryBinding: {
        ...base.geometryBinding,
        motionMode: layout.motionMode,
        verticalLift: layout.verticalLift,
        translationVector: layout.translationVector,
        tangentialBias: layout.tangentialBias,
        torqueDirection: layout.torqueDirection,
        orbitBias: layout.orbitBias,
      },
    };
  }

  if (signRegistryId === 'sign.collection' || signRegistryId === 'sign.gather') {
    const sourceMode = layout.sourceMode ?? operatorDefinition.sourceMode;
    const materialIntake = {
      sourceMode,
      queryMode: signRegistryId === 'sign.gather' ? 'active_nearby_query' : 'passive_nearby_query',
      requiresAmbientSource: operatorDefinition.requiresAmbientSource === true,
      passiveRadius: operatorDefinition.passiveRadius ?? 'prototype_default',
      activePull: operatorDefinition.activePull ?? 0,
      targetDomainRegistryId: layout.domainRegistryId ?? null,
    };
    return {
      ...base,
      sourceMode,
      requiresAmbientSource: operatorDefinition.requiresAmbientSource === true,
      activePull: operatorDefinition.activePull ?? 0,
      materialIntake,
      geometryBinding: {
        ...base.geometryBinding,
        sourceMode,
        materialIntake,
      },
    };
  }

  if (signRegistryId === 'sign.convergence') {
    const fieldModification = {
      coherenceDelta: layout.pointFocusEligible ? 0.5 : 0,
      spreadMultiplier: layout.pointFocusEligible ? 0.5 : 1,
      rigidityGain: operatorDefinition.rigidityGain ?? 0,
      cohesionGain: layout.pointFocusEligible ? (operatorDefinition.focusGain ?? 1) * 0.5 : 0,
    };
    return {
      ...base,
      convergenceMode: layout.pointFocusEligible ? 'point_focus' : 'under_specified',
      pointFocus: layout.pointFocusEligible === true,
      fieldModification,
      geometryBinding: {
        ...base.geometryBinding,
        pointFocus: layout.pointFocusEligible === true,
        convergenceMode: layout.pointFocusEligible ? 'point_focus' : 'under_specified',
        ignoredWindWallInference: layout.ignoredWindWallInference === true,
        fieldModification,
      },
    };
  }

  if (operatorDefinition.operatorFamily === 'field_emit') {
    const fieldModification = {
      emissionKind:
        operatorDefinition.polarity === 'emit_outward_leak'
          ? 'outward_leak_cone'
          : 'coherent_beam',
      verticalGain: operatorDefinition.verticalGain ?? 0,
      lateralGain: operatorDefinition.lateralGain ?? 0,
      spreadGain: operatorDefinition.spreadGain ?? 0,
      tangentialGain: operatorDefinition.tangentialGain ?? 0,
    };
    return {
      ...base,
      fieldModification,
      geometryBinding: {
        ...base.geometryBinding,
        fieldModification,
      },
    };
  }

  return base;
}

/**
 * @param {object} operatorDefinition
 */
function operatorRoleForDefinition(operatorDefinition) {
  const family = operatorDefinition.operatorFamily;
  if (family === 'field_emit') return 'field_output';
  if (family === 'field_attract') return 'force_field';
  if (family === 'lift_motion') return 'motion_field';
  if (family === 'scope_boundary') return 'scope_filter';
  if (family === 'field_focus') return 'field_modifier';
  if (family === 'material_intake') return 'source_acquisition';
  if (family === 'gravity_override') return 'support_state';
  return 'operator';
}

/**
 * @param {object} layout
 * @param {string} signRegistryId
 * @param {object} operatorDefinition
 */
function defaultTargetQuery(layout, signRegistryId, operatorDefinition) {
  const domainRegistryId = layout.domainRegistryId ?? null;
  if (signRegistryId === 'sign.region') {
    return {
      targetKind: 'region_boundary',
      scope: layout.emissionPlacement ?? 'on_ring',
      regionZone: layout.regionZone ?? null,
      domainRegistryId,
    };
  }
  if (signRegistryId === 'sign.pull') {
    return {
      targetKind: 'matching_aspect_matter',
      aspectFilter: domainRegistryId,
      relation: operatorDefinition.polarity ?? 'pull_inward',
    };
  }
  if (signRegistryId === 'sign.levitation') {
    return {
      targetKind: 'attached_object_or_center_group',
      domainRegistryId,
    };
  }
  if (signRegistryId === 'sign.collection' || signRegistryId === 'sign.gather') {
    return {
      targetKind: 'nearby_material_source',
      aspectFilter: domainRegistryId,
      requiresAmbientSource: operatorDefinition.requiresAmbientSource === true,
    };
  }
  if (signRegistryId === 'sign.convergence') {
    return {
      targetKind: 'field_lobe_or_loose_material',
      aspectFilter: domainRegistryId,
      relation: 'point_focus',
    };
  }
  return {
    targetKind: operatorDefinition.defaultAnchor ?? 'center_group',
    aspectFilter: domainRegistryId,
  };
}

/**
 * Sigil objects eligible as radial point-at targets (center + placed instances).
 *
 * @param {object} seal
 */
function listPointAtSigils(seal) {
  return (seal.symbols ?? []).filter(
    (s) =>
      s.categoryHint === 'sigil' &&
      s.resolvedRegistryId &&
      canContributeSemantics(s) &&
      (s.objectId.startsWith('sigil:') || s.objectId.startsWith('sigil-instance:')),
  );
}

/**
 * @param {object} radialInstance
 * @param {object[]} sigils
 */
function computePointedAtSigil(radialInstance, sigils) {
  const pos = radialInstance.geometry?.programPosition ??
    radialInstance.geometry?.localPosition ?? { x: 0, y: 0 };
  const dir = radialInstance.geometryAnalysis?.directionVector ?? { x: 0, y: 0 };
  const dirMag = Math.hypot(dir.x, dir.y);
  const radialRadius = radialInstance.geometry?.polarRadius ?? 0;
  if (dirMag <= VECTOR_SUM_TOLERANCE || sigils.length === 0) {
    return null;
  }

  const candidates =
    radialRadius > 20
      ? sigils.filter((s) => (s.geometry?.polarRadius ?? 0) > 1)
      : sigils;

  const ux = dir.x / dirMag;
  const uy = dir.y / dirMag;
  let best = null;
  let bestScore = -Infinity;

  for (const sigil of candidates.length > 0 ? candidates : sigils) {
    const sp =
      sigil.geometry?.programPosition ?? sigil.geometry?.localPosition ?? { x: 0, y: 0 };
    const dx = sp.x - pos.x;
    const dy = sp.y - pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= VECTOR_SUM_TOLERANCE) {
      return { objectId: sigil.objectId, registryId: sigil.resolvedRegistryId, score: 1 };
    }
    const toUx = dx / dist;
    const toUy = dy / dist;
    const dot = ux * toUx + uy * toUy;
    if (dot > bestScore) {
      bestScore = dot;
      best = sigil;
    }
  }

  if (!best || bestScore < 0.15) {
    return null;
  }

  return {
    objectId: best.objectId,
    registryId: best.resolvedRegistryId,
    score: bestScore,
  };
}

/**
 * @param {object} seal
 */
function analyzeRadialPointing(seal) {
  const sigils = listPointAtSigils(seal);
  const radialInstances = (seal.symbols ?? []).filter(
    (s) =>
      s.categoryHint === 'sign' &&
      s.objectId?.startsWith('sign-instance:') &&
      s.resolvedRegistryId === 'sign.radial' &&
      canContributeSemantics(s),
  );

  /** @type {Record<string, { objectId: string; registryId: string; count: number; radialObjectIds: string[] }>} */
  const countsBySigilId = {};

  for (const radial of radialInstances) {
    const target = computePointedAtSigil(radial, sigils);
    radial.geometryAnalysis = radial.geometryAnalysis ?? {};
    radial.geometryAnalysis.pointedAtSigilId = target?.objectId ?? null;
    radial.geometryAnalysis.pointedAtRegistryId = target?.registryId ?? null;
    radial.geometryAnalysis.pointAtScore = target?.score ?? null;

    if (target?.objectId) {
      if (!countsBySigilId[target.objectId]) {
        countsBySigilId[target.objectId] = {
          objectId: target.objectId,
          registryId: target.registryId,
          count: 0,
          radialObjectIds: [],
        };
      }
      countsBySigilId[target.objectId].count += 1;
      countsBySigilId[target.objectId].radialObjectIds.push(radial.objectId);
    }
  }

  return {
    countsBySigilId,
    instanceCount: radialInstances.length,
  };
}

/**
 * Cool/Strengthen signs affixed to the nearest off-center sigil (crosshair modifier sources).
 *
 * @param {object} seal
 * @param {object | null} centerGroup
 */
function analyzeModifierAffixes(seal, centerGroup) {
  const centerId = centerGroup?.centerSigilId ?? null;
  const sigils = listPointAtSigils(seal).filter((s) => s.objectId !== centerId);
  /** @type {Record<string, object>} */
  const bySigilId = {};

  for (const sigil of sigils) {
    bySigilId[sigil.objectId] = {
      sigilObjectId: sigil.objectId,
      registryId: sigil.resolvedRegistryId,
      strengthenSignIds: [],
      coolSignIds: [],
      strengthenWeight: 0,
      hasCool: false,
      hasStrengthen: false,
    };
  }

  const affixSigns = (seal.symbols ?? []).filter(
    (s) =>
      s.categoryHint === 'sign' &&
      s.objectId?.startsWith('sign-instance:') &&
      canContributeSemantics(s) &&
      (s.resolvedRegistryId === 'sign.cool' ||
        s.resolvedRegistryId === 'sign.strengthen'),
  );

  for (const sign of affixSigns) {
    const nearest = findNearestSigilByPosition(sign, sigils);
    if (!nearest) continue;
    const bucket = bySigilId[nearest.objectId];
    if (!bucket) continue;
    if (sign.resolvedRegistryId === 'sign.cool') {
      bucket.coolSignIds.push(sign.objectId);
      bucket.hasCool = true;
    }
    if (sign.resolvedRegistryId === 'sign.strengthen') {
      bucket.strengthenSignIds.push(sign.objectId);
      bucket.hasStrengthen = true;
      bucket.strengthenWeight += sign.geometryAnalysis?.scaleWeight ?? 1;
    }
  }

  return { bySigilId };
}

/**
 * Cool/Crush signs affixed to the center sigil group (inner ring / nearest center sigil).
 *
 * @param {object} seal
 * @param {object | null} centerGroup
 */
function analyzeCenterAffixes(seal, centerGroup) {
  const centerId = centerGroup?.centerSigilId ?? null;
  const empty = {
    centerSigilId: centerId,
    coolSignIds: [],
    crushSignIds: [],
    hasCool: false,
    hasCrush: false,
  };
  if (!centerId) return empty;

  const centerSigil = (seal.symbols ?? []).find((s) => s.objectId === centerId);
  if (!centerSigil) return empty;

  const centerOnly = [centerSigil];
  const affixSigns = (seal.symbols ?? []).filter(
    (s) =>
      s.categoryHint === 'sign' &&
      s.objectId?.startsWith('sign-instance:') &&
      canContributeSemantics(s) &&
      (s.resolvedRegistryId === 'sign.cool' || s.resolvedRegistryId === 'sign.crush'),
  );

  for (const sign of affixSigns) {
    const nearest = findNearestSigilByPosition(sign, centerOnly);
    if (!nearest || nearest.objectId !== centerId) continue;
    if (sign.resolvedRegistryId === 'sign.cool') {
      empty.coolSignIds.push(sign.objectId);
      empty.hasCool = true;
    }
    if (sign.resolvedRegistryId === 'sign.crush') {
      empty.crushSignIds.push(sign.objectId);
      empty.hasCrush = true;
    }
  }

  return empty;
}

/**
 * @param {object} signInstance
 * @param {object[]} sigils
 */
function findNearestSigilByPosition(signInstance, sigils) {
  if (sigils.length === 0) return null;
  const pos =
    signInstance.geometry?.programPosition ??
    signInstance.geometry?.localPosition ?? { x: 0, y: 0 };
  let best = null;
  let bestDist = Infinity;
  for (const sigil of sigils) {
    const sp =
      sigil.geometry?.programPosition ?? sigil.geometry?.localPosition ?? { x: 0, y: 0 };
    const dist = Math.hypot(sp.x - pos.x, sp.y - pos.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = sigil;
    }
  }
  return best;
}

/**
 * Center sigil group: seal-center domain sigil plus inward column signs modifying it.
 *
 * @param {object} seal
 * @param {object[]} groups
 * @param {object | null} watershotColumn
 */
function identifyCenterGroup(seal, groups, watershotColumn) {
  const sigils = listPointAtSigils(seal);
  if (sigils.length === 0) return null;

  const centerSigil =
    sigils.find((s) => (s.geometry?.polarRadius ?? 0) <= 1) ??
    sigils.reduce((best, s) => {
      const r = s.geometry?.polarRadius ?? Infinity;
      const br = best.geometry?.polarRadius ?? Infinity;
      return r < br ? s : best;
    }, sigils[0]);

  const columnGroup = groups.find((g) => g.registryId === 'sign.column');
  const columnPointsAtCenter =
    columnGroup &&
    columnGroup.vectorSum &&
    vectorMagnitude(columnGroup.vectorSum) <= VECTOR_SUM_TOLERANCE;

  const modifyingSignIds = columnPointsAtCenter ? [...columnGroup.instanceIds] : [];

  return {
    centerSigilId: centerSigil.objectId,
    centerRegistryId: centerSigil.resolvedRegistryId,
    modifyingSignIds,
    hasColumn: columnPointsAtCenter === true && modifyingSignIds.length > 0,
    watershotLike: Boolean(watershotColumn),
  };
}

/**
 * Semi-directional crush on center group with inward column.
 *
 * @param {object} seal
 * @param {object[]} groups
 * @param {object | null} centerGroup
 */
function analyzeCrush(seal, groups, centerGroup) {
  if (!centerGroup?.hasColumn) return null;

  const crushGroup = groups.find((g) => g.registryId === 'sign.crush');
  if (!crushGroup) return null;

  const centerSigil = listPointAtSigils(seal).find(
    (s) => s.objectId === centerGroup.centerSigilId,
  );
  if (!centerSigil) return null;

  const instances = instancesForGroup(seal, crushGroup)
    .filter((inst) => {
      const nearest = findNearestSigilByPosition(inst, [centerSigil]);
      return nearest?.objectId === centerGroup.centerSigilId && isInwardFacingInstance(inst);
    })
    .map((inst) => crushSignEntry(inst));

  if (instances.length === 0) return null;

  const vectorSummary = crushGroup.vectorSum ?? sumWeightedVectors(instances);

  return {
    kind: 'crush_center_group',
    domainRegistryId: centerGroup.centerRegistryId,
    domainSigilObjectId: centerGroup.centerSigilId,
    hasInwardColumn: true,
    instances,
    crushSignIds: instances.map((i) => i.objectId),
    vectorSummary,
    symmetric: crushGroup.symmetryClass === 'symmetric',
    symmetryClass: crushGroup.symmetryClass,
    biasMagnitude: crushGroup.biasMagnitude ?? vectorMagnitude(vectorSummary),
    crushGroup,
  };
}

/**
 * @param {object} inst
 */
function crushSignEntry(inst) {
  const ga = inst.geometryAnalysis ?? {};
  return {
    objectId: inst.objectId,
    registryId: 'sign.crush',
    profileId: inst.radial?.profileId ?? null,
    facingMode: 'inward',
    inverted: ga.inverted === true,
    positionAngleDeg: ga.positionAngleDeg,
    scaleWeight: ga.scaleWeight,
    directionVector: ga.directionVector,
    radialComponents: ga.radialComponents,
  };
}

/**
 * @param {object} seal
 * @param {object[]} groups
 */
function analyzeLevitation(seal, groups) {
  const levitationGroup = groups.find((g) => g.registryId === 'sign.levitation');
  if (!levitationGroup) return null;

  const domainSigil = (seal.symbols ?? []).find(
    (s) =>
      s.categoryHint === 'sigil' &&
      LEVITATION_DOMAIN_REGISTRY_IDS.has(s.resolvedRegistryId) &&
      canContributeSemantics(s),
  );
  if (!domainSigil) return null;

  const domainRegistryId = domainSigil.resolvedRegistryId;
  const vectorSum = levitationGroup.vectorSum ?? { x: 0, y: 0 };
  const biasMagnitude = vectorMagnitude(vectorSum);
  const balanced = biasMagnitude <= VECTOR_SUM_TOLERANCE;
  const tangentialBias = q(levitationGroup.vectorSum?.tangential ?? 0);
  const tangentialMagnitude = Math.abs(tangentialBias);
  const hasTangentialBias = tangentialMagnitude > VECTOR_SUM_TOLERANCE;
  const torqueDirection =
    !hasTangentialBias ? 'none' : tangentialBias > 0 ? 'clockwise' : 'counterclockwise';
  const totalSignLength = levitationGroup.duplicateVectorSet.reduce(
    (sum, item) => sum + (item.scaleWeight ?? 1) * DEFAULT_SIGN_SIZE,
    0,
  );
  const heightFromSignLength = q(totalSignLength / levitationGroup.instanceCount);
  const translationVector = balanced ? { x: 0, y: 0 } : { x: q(vectorSum.x), y: q(vectorSum.y) };
  const motionMode =
    balanced && hasTangentialBias
      ? 'lift_with_rotation'
      : balanced
        ? 'stable_hover'
        : hasTangentialBias
          ? 'lift_translate_rotate'
          : 'lift_with_drift';

  return {
    domainRegistryId,
    signRegistryId: 'sign.levitation',
    balanced,
    biasMagnitude: q(biasMagnitude),
    vectorSum: { ...vectorSum, x: q(vectorSum.x), y: q(vectorSum.y), tangential: tangentialBias },
    heightFromSignLength,
    launchVector: balanced ? null : { ...vectorSum },
    verticalLift: heightFromSignLength,
    translationVector,
    tangentialBias,
    torqueDirection,
    orbitBias:
      hasTangentialBias && balanced
        ? {
            translationCancels: true,
            tangentialMagnitude,
            torqueDirection,
          }
        : null,
    motionMode,
    outputMagnitudeScale: 0.65,
    continuousStream: domainRegistryId === 'sigil.wind' && !balanced,
    oneShotLaunch: domainRegistryId !== 'sigil.wind' && !balanced,
    instanceIds: levitationGroup.instanceIds,
  };
}

/**
 * Outward-facing column instances and explicit dispersion signs share one analysis object.
 *
 * @param {object} seal
 * @param {object[]} groups
 */
export function analyzeOutwardDispersion(seal, groups) {
  const columnGroup = groups.find((g) => g.registryId === 'sign.column');
  const dispersionGroup = groups.find((g) => g.registryId === 'sign.dispersion');
  const columnInstances = columnGroup
    ? instancesForGroup(seal, columnGroup).filter(isOutwardFacingInstance)
    : [];
  const dispersionInstances = dispersionGroup
    ? instancesForGroup(seal, dispersionGroup).filter((inst) => inst.geometryAnalysis?.inverted !== true)
    : [];

  const instances = [
    ...columnInstances.map((inst) => outwardDispersionEntry(inst, 'sign.column')),
    ...dispersionInstances.map((inst) => outwardDispersionEntry(inst, 'sign.dispersion')),
  ];

  if (instances.length === 0) return null;

  const duplicateVectorSet = instances.map((entry) => ({
    objectId: entry.objectId,
    profileId: entry.profileId,
    registryId: entry.registryId,
    directionVector: entry.directionVector,
    scaleWeight: entry.scaleWeight,
    radialComponents: entry.radialComponents,
  }));

  const vectorSummary = sumWeightedVectors(duplicateVectorSet);
  const profileCount = new Set(instances.map((i) => i.profileId).filter(Boolean)).size;
  const symmetryClass = classifySymmetry(vectorSummary, Math.max(profileCount, 1));
  const domainSigil = resolveOwnerDomainSigil(seal);

  return {
    kind: 'outward_dispersion',
    domainRegistryId: domainSigil?.resolvedRegistryId ?? null,
    domainSigilObjectId: domainSigil?.objectId ?? null,
    instances,
    duplicateVectorSet,
    vectorSummary,
    symmetric: symmetryClass === 'symmetric',
    symmetryClass,
    biasMagnitude: vectorMagnitude(vectorSummary),
    columnGroup: columnGroup ?? null,
    dispersionGroup: dispersionGroup ?? null,
  };
}

/**
 * @param {object} inst
 * @param {string} registryId
 */
function outwardDispersionEntry(inst, registryId) {
  const ga = inst.geometryAnalysis ?? {};
  return {
    objectId: inst.objectId,
    registryId,
    profileId: inst.radial?.profileId ?? null,
    inverted: ga.inverted === true,
    positionAngleDeg: ga.positionAngleDeg,
    scaleWeight: ga.scaleWeight,
    directionVector: ga.directionVector,
    radialComponents: ga.radialComponents,
    symmetryClass: ga.symmetryClass,
  };
}

/**
 * @param {object} seal
 * @param {object} group
 */
function instancesForGroup(seal, group) {
  const ids = new Set(group.instanceIds ?? []);
  return (seal.symbols ?? []).filter(
    (s) =>
      s.categoryHint === 'sign' &&
      s.objectId?.startsWith('sign-instance:') &&
      ids.has(s.objectId) &&
      canContributeSemantics(s),
  );
}

/**
 * @param {object} inst
 */
function isOutwardFacingInstance(inst) {
  const ga = inst.geometryAnalysis;
  if (!ga) return false;
  if (ga.inverted === true) return true;
  const inward = ga.radialComponents?.inward ?? 0;
  const outward = ga.radialComponents?.outward ?? 0;
  return outward > inward + VECTOR_SUM_TOLERANCE;
}

/**
 * @param {object} inst
 */
function isInwardFacingInstance(inst) {
  const ga = inst.geometryAnalysis;
  if (!ga) return false;
  if (ga.inverted === true) return false;
  const inward = ga.radialComponents?.inward ?? 0;
  const outward = ga.radialComponents?.outward ?? 0;
  return inward > outward + VECTOR_SUM_TOLERANCE;
}

/**
 * Uniform inward pull geometry (sign.pull); inverted instances are push candidates.
 *
 * @param {object} seal
 * @param {object[]} groups
 */
export function analyzePullSigns(seal, groups) {
  const pullGroup = groups.find((g) => g.registryId === 'sign.pull');
  if (!pullGroup) return null;

  const instances = instancesForGroup(seal, pullGroup);
  if (instances.length === 0) return null;

  const entries = instances.map((inst) => pullSignEntry(inst));
  const vectorSummary = pullGroup.vectorSum ?? sumWeightedVectors(entries);
  const pushInstances = entries.filter((e) => e.facingMode === 'outward');
  const directionMode = pushInstances.length > 0 ? 'push' : 'inward';
  const tangential = Math.abs(vectorSummary.tangential ?? 0);
  const hasAngledInstance = instances.some((inst) => isAngledPullInstance(inst));
  const pullTwist =
    directionMode === 'inward' && (tangential > VECTOR_SUM_TOLERANCE || hasAngledInstance)
      ? {
          tangential: vectorSummary.tangential ?? 0,
          vectorSum: { x: vectorSummary.x, y: vectorSummary.y },
          columnVectorClassification: pullGroup.columnVectorClassification,
          symmetryClass: pullGroup.symmetryClass,
        }
      : null;

  const domainSigil = resolveOwnerDomainSigil(seal);

  return {
    kind: 'pull_sign',
    domainRegistryId: domainSigil?.resolvedRegistryId ?? null,
    domainSigilObjectId: domainSigil?.objectId ?? null,
    pullGroup,
    instances: entries,
    directionMode,
    pushInstances,
    pullTwist,
    vectorSummary,
    symmetric: pullGroup.symmetryClass === 'symmetric',
    symmetryClass: pullGroup.symmetryClass,
    biasMagnitude: pullGroup.biasMagnitude ?? vectorMagnitude(vectorSummary),
  };
}

/**
 * @param {object} inst
 */
function pullSignEntry(inst) {
  const ga = inst.geometryAnalysis ?? {};
  const outward = isOutwardFacingInstance(inst);
  return {
    objectId: inst.objectId,
    registryId: 'sign.pull',
    profileId: inst.radial?.profileId ?? null,
    facingMode: outward ? 'outward' : 'inward',
    inverted: ga.inverted === true,
    positionAngleDeg: ga.positionAngleDeg,
    scaleWeight: ga.scaleWeight,
    directionVector: ga.directionVector,
    radialComponents: ga.radialComponents,
    signAngleDeg: ga.signAngleDeg,
    profileRotationDeg: ga.profileRotationDeg,
  };
}

/**
 * @param {object} inst
 */
function isAngledPullInstance(inst) {
  const ga = inst.geometryAnalysis;
  if (!ga) return false;
  const angle = normalizeDegrees(ga.signAngleDeg ?? 0);
  if (angle > 15 && angle < 165) return true;
  const tangential = Math.abs(ga.radialComponents?.tangential ?? 0);
  return tangential > VECTOR_SUM_TOLERANCE;
}

/**
 * Region layout from geometry: inward-only, outward-only, one-sided, or opposing pairs.
 *
 * @param {object} seal
 * @param {object[]} groups
 */
export function analyzeRegionLayout(seal, groups) {
  const regionGroup = groups.find((g) => g.registryId === 'sign.region');
  if (!regionGroup) return null;

  const instances = instancesForGroup(seal, regionGroup);
  if (instances.length === 0) return null;

  const entries = instances.map((inst) => regionSignEntry(inst));
  const vectorSummary = regionGroup.vectorSum ?? { x: 0, y: 0, inward: 0, outward: 0 };
  const regionZone = classifyRegionZone(entries, vectorSummary);
  const domainSigil = resolveOwnerDomainSigil(seal);

  return {
    kind: 'region_layout',
    domainRegistryId: domainSigil?.resolvedRegistryId ?? null,
    domainSigilObjectId: domainSigil?.objectId ?? null,
    regionGroup,
    instances: entries,
    regionZone,
    emissionPlacement: 'on_ring',
    vectorSummary,
    symmetric: regionGroup.symmetryClass === 'symmetric',
    symmetryClass: regionGroup.symmetryClass,
    biasMagnitude: regionGroup.biasMagnitude ?? vectorMagnitude(vectorSummary),
  };
}

/**
 * @param {object} inst
 */
function regionSignEntry(inst) {
  const ga = inst.geometryAnalysis ?? {};
  const outward = isOutwardFacingInstance(inst);
  const inward = isInwardFacingInstance(inst);
  return {
    objectId: inst.objectId,
    registryId: 'sign.region',
    profileId: inst.radial?.profileId ?? null,
    facingMode: outward ? 'outward' : inward ? 'inward' : 'neutral',
    inverted: ga.inverted === true,
    positionAngleDeg: ga.positionAngleDeg,
    placementZone: ga.placementZone,
    scaleWeight: ga.scaleWeight,
    directionVector: ga.directionVector,
    radialComponents: ga.radialComponents,
  };
}

/**
 * @param {object[]} entries
 * @param {{ inward?: number; outward?: number }} vectorSummary
 */
function classifyRegionZone(entries, vectorSummary) {
  const inwardCount = entries.filter((e) => e.facingMode === 'inward').length;
  const outwardCount = entries.filter((e) => e.facingMode === 'outward').length;
  const netIn = vectorSummary.inward ?? 0;
  const netOut = vectorSummary.outward ?? 0;

  if (inwardCount > 0 && outwardCount > 0) {
    return 'opposing';
  }
  if (outwardCount === entries.length) {
    return 'all_outward';
  }
  if (inwardCount === entries.length) {
    return 'all_inward';
  }
  if (
    entries.every((e) => e.placementZone === 'on_ring') &&
    Math.abs(netIn) <= VECTOR_SUM_TOLERANCE &&
    Math.abs(netOut) <= VECTOR_SUM_TOLERANCE
  ) {
    return 'on_ring_only';
  }
  if (Math.abs(netIn) <= VECTOR_SUM_TOLERANCE && Math.abs(netOut) <= VECTOR_SUM_TOLERANCE) {
    return 'opposing';
  }
  return netOut > netIn + VECTOR_SUM_TOLERANCE ? 'all_outward' : 'all_inward';
}

/**
 * @param {{ positionAngleDeg?: number }[]} entries
 */
function positionAnglesSpanHalfPlane(entries) {
  const angles = entries
    .map((e) => normalizeDegrees(e.positionAngleDeg ?? 0))
    .sort((a, b) => a - b);
  if (angles.length <= 1) return true;

  let maxGap = 0;
  for (let i = 0; i < angles.length; i++) {
    const next = angles[(i + 1) % angles.length];
    const cur = angles[i];
    const gap = i + 1 < angles.length ? next - cur : 360 - cur + next;
    if (gap > maxGap) maxGap = gap;
  }
  const span = 360 - maxGap;
  return span <= 180 + VECTOR_SUM_TOLERANCE;
}

/**
 * @param {object} seal
 */
function resolveOwnerDomainSigil(seal) {
  const sigils = listPointAtSigils(seal);
  if (sigils.length === 0) return null;
  return (
    sigils.find((s) => (s.geometry?.polarRadius ?? 0) <= 1) ??
    sigils.reduce((best, s) => {
      const r = s.geometry?.polarRadius ?? Infinity;
      const br = best.geometry?.polarRadius ?? Infinity;
      return r < br ? s : best;
    }, sigils[0])
  );
}

function analyzeWatershotColumn(seal, groups) {
  const waterSigil = (seal.symbols ?? []).find(
    (s) =>
      s.resolvedRegistryId === 'sigil.water' &&
      s.categoryHint === 'sigil' &&
      canContributeSemantics(s),
  );
  const columnGroup = groups.find((g) => g.registryId === 'sign.column');
  if (!waterSigil || !columnGroup) return null;

  const columnInstances = instancesForGroup(seal, columnGroup);
  if (columnInstances.some(isOutwardFacingInstance)) return null;
  const vectorSum = columnGroup.vectorSum ?? { x: 0, y: 0, inward: 0, outward: 0 };
  if ((vectorSum.outward ?? 0) > (vectorSum.inward ?? 0) + VECTOR_SUM_TOLERANCE) {
    return null;
  }

  return {
    template: 'watershot_like',
    domainRegistryId: 'sigil.water',
    columnGroup,
    centered: columnGroup.columnVectorClassification === 'centered',
    biased: columnGroup.columnVectorClassification === 'biased',
    multiProfile: columnGroup.columnVectorClassification === 'multi_profile',
    vectorSum: columnGroup.vectorSum,
    symmetryClass: columnGroup.symmetryClass,
  };
}

/**
 * @param {number} deg
 */
function normalizeDegrees(deg) {
  let d = deg % 360;
  if (d < 0) d += 360;
  return d;
}

/**
 * @param {number} facingDeg
 */
function isInvertedFacing(facingDeg) {
  const n = normalizeDegrees(facingDeg);
  return n > 90 && n < 270;
}

/**
 * Uniform collection source-mode layout (sign.collection).
 *
 * @param {object} seal
 * @param {object[]} groups
 */
export function analyzeCollectionLayout(seal, groups) {
  return analyzeSourceModeSignLayout(seal, groups, 'sign.collection', 'collect_nearby');
}

/**
 * Uniform gather source-mode layout (sign.gather).
 *
 * @param {object} seal
 * @param {object[]} groups
 */
export function analyzeGatherLayout(seal, groups) {
  return analyzeSourceModeSignLayout(seal, groups, 'sign.gather', 'gather_active');
}

/**
 * @param {object} seal
 * @param {object[]} groups
 * @param {string} registryId
 * @param {string} sourceMode
 */
function analyzeSourceModeSignLayout(seal, groups, registryId, sourceMode) {
  const signGroup = groups.find((g) => g.registryId === registryId);
  if (!signGroup) return null;

  const instances = instancesForGroup(seal, signGroup);
  if (instances.length === 0) return null;

  const entries = instances.map((inst) => directionalSignEntry(inst, registryId));
  const vectorSummary = signGroup.vectorSum ?? sumWeightedVectors(entries);
  const domainSigil = resolveOwnerDomainSigil(seal);

  return {
    kind: registryId === 'sign.collection' ? 'collection_layout' : 'gather_layout',
    sourceMode,
    domainRegistryId: domainSigil?.resolvedRegistryId ?? null,
    domainSigilObjectId: domainSigil?.objectId ?? null,
    signGroup,
    instances: entries,
    vectorSummary,
    symmetric: signGroup.symmetryClass === 'symmetric',
    symmetryClass: signGroup.symmetryClass,
    biasMagnitude: signGroup.biasMagnitude ?? vectorMagnitude(vectorSummary),
  };
}

/**
 * Convergence layout: point-focus when symmetric inward duplicates; wind-wall ignored.
 *
 * @param {object} seal
 * @param {object[]} groups
 */
export function analyzeConvergenceLayout(seal, groups) {
  const convergenceGroup = groups.find((g) => g.registryId === 'sign.convergence');
  if (!convergenceGroup) return null;

  const instances = instancesForGroup(seal, convergenceGroup);
  if (instances.length === 0) return null;

  const entries = instances.map((inst) => directionalSignEntry(inst, 'sign.convergence'));
  const vectorSummary = convergenceGroup.vectorSum ?? sumWeightedVectors(entries);
  const inwardCount = entries.filter((e) => e.facingMode === 'inward').length;
  const outwardCount = entries.filter((e) => e.facingMode === 'outward').length;
  const ignoredWindWallInference = detectIgnoredWindWallInference(seal, groups);
  const pointFocusEligible =
    !ignoredWindWallInference &&
    instances.length >= 2 &&
    inwardCount === entries.length &&
    outwardCount === 0 &&
    convergenceGroup.symmetryClass === 'symmetric' &&
    vectorMagnitude(vectorSummary) <= VECTOR_SUM_TOLERANCE;

  const domainSigil = resolveOwnerDomainSigil(seal);

  return {
    kind: 'convergence_layout',
    domainRegistryId: domainSigil?.resolvedRegistryId ?? null,
    domainSigilObjectId: domainSigil?.objectId ?? null,
    convergenceGroup,
    instances: entries,
    vectorSummary,
    symmetric: convergenceGroup.symmetryClass === 'symmetric',
    symmetryClass: convergenceGroup.symmetryClass,
    biasMagnitude: convergenceGroup.biasMagnitude ?? vectorMagnitude(vectorSummary),
    pointFocusEligible,
    ignoredWindWallInference,
    inwardCount,
    instanceCount: instances.length,
  };
}

/**
 * Unofficial wind-wall spell inference: wind sigil + outward column + convergence.
 *
 * @param {object} seal
 * @param {object[]} groups
 */
function detectIgnoredWindWallInference(seal, groups) {
  const windSigil = (seal.symbols ?? []).find(
    (s) =>
      s.categoryHint === 'sigil' &&
      s.resolvedRegistryId === 'sigil.wind' &&
      canContributeSemantics(s),
  );
  if (!windSigil) return false;

  const columnGroup = groups.find((g) => g.registryId === 'sign.column');
  const convergenceGroup = groups.find((g) => g.registryId === 'sign.convergence');
  if (!columnGroup || !convergenceGroup || convergenceGroup.instanceCount === 0) {
    return false;
  }

  const columnInstances = instancesForGroup(seal, columnGroup);
  return columnInstances.some(isOutwardFacingInstance);
}

/**
 * @param {object} inst
 * @param {string} registryId
 */
function directionalSignEntry(inst, registryId) {
  const ga = inst.geometryAnalysis ?? {};
  const outward = isOutwardFacingInstance(inst);
  const inward = isInwardFacingInstance(inst);
  return {
    objectId: inst.objectId,
    registryId,
    profileId: inst.radial?.profileId ?? null,
    facingMode: outward ? 'outward' : inward ? 'inward' : 'neutral',
    inverted: ga.inverted === true,
    positionAngleDeg: ga.positionAngleDeg,
    placementZone: ga.placementZone,
    scaleWeight: ga.scaleWeight,
    directionVector: ga.directionVector,
    radialComponents: ga.radialComponents,
    signAngleDeg: ga.signAngleDeg,
    profileRotationDeg: ga.profileRotationDeg,
  };
}

/** @type {typeof analyzeCrush} */
export const analyzeCrushLayout = analyzeCrush;

/** @type {typeof analyzePullSigns} */
export const analyzePull = analyzePullSigns;

/** @type {typeof analyzeRegionLayout} */
export const analyzeRegion = analyzeRegionLayout;

/** @type {typeof analyzeSpellGeometry} */
export const analyzeGeometry = analyzeSpellGeometry;
