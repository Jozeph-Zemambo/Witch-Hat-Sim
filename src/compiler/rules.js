/**
 * Limited rule evaluation: Watershot, Radial weak-domain, Crosshair center-group, Levitation.
 */

import { makeCompileDiagnostic } from './diagnostics.js';
import { SUBELEMENT_PROFILES, isCatalogDeferredSign } from './registry.js';

const WATERSHOT_EVIDENCE = ['DOSSIER:SPELL_WATERSHOT_SEAL', 'GEOM_DIR_COLUMN_RADIAL_VECTOR'];
const RADIAL_EVIDENCE = ['ACCEPT_CUSTOM_RADIAL_WEAKEN_DOMAIN', 'SRC-SIGNS'];
const CROSSHAIR_EVIDENCE = [
  'ACCEPT_CUSTOM_CROSSHAIR_CENTER_GROUP_MODIFIER',
  'RULE_CUSTOM_CROSSHAIR_CENTER_GROUP',
];
const CROSSHAIR_COOL_EVIDENCE = [
  'SRC-SIGNS',
  'ACCEPT_CROSSHAIR_COOL_MODIFIER',
  'RULE_CROSSHAIR_COOL_SIGN_MODIFIER',
];
const STRENGTHEN_EVIDENCE = ['SRC-SIGNS', 'RULE_CROSSHAIR_STRENGTHEN_INTENSITY'];
const LEVITATION_FIRE_EVIDENCE = ['DOSSIER:SPELL_PYREBALL_SEAL'];
const LEVITATION_WIND_EVIDENCE = ['DOSSIER:SPELL_SKYSOARING_SEAL'];
const LEVITATION_PROJECT_EVIDENCE = [
  'SRC-SIGNS',
  'RULE_SIGN_LEVITATION_ELEMENTAL_OUTPUT',
  'custom_project_supported',
];
const OUTWARD_DISPERSION_EVIDENCE = [
  'SRC-SIGNS',
  'RULE_GEOM_OUTWARD_DISPERSION_LIKE',
  'fan_documented_plausible',
];
const PULL_SIGN_EVIDENCE = [
  'SRC-SIGNS',
  'DOSSIER:SPELL_GRASPING_WIND',
  'RULE_SIGN_PULL_UNIFORM',
  'GEOM_DIR_PULL_INWARD',
];
const REGION_SIGN_EVIDENCE = [
  'SRC-SIGNS',
  'DOSSIER:SPELL_FLOATING_DROPS',
  'RULE_SIGN_REGION_UNIFORM',
  'GEOM_DIR_REGION_OPPOSED',
];
const CRUSH_SIGN_EVIDENCE = [
  'SRC-SIGNS',
  'RULE_SIGN_CRUSH_WATER_MIST',
  'fan_documented_plausible',
];
const STANDALONE_COOL_EVIDENCE = [
  'SRC-SIGNS',
  'RULE_STANDALONE_COOL_CENTER_GROUP',
  'fan_documented_plausible',
];
const COLLECTION_SIGN_EVIDENCE = [
  'SRC-SIGNS',
  'RULE_SIGN_COLLECTION_UNIFORM',
  'fan_documented_plausible',
];
const GATHER_SIGN_EVIDENCE = [
  'SRC-SIGNS',
  'RULE_SIGN_GATHER_UNIFORM',
  'fan_documented_plausible',
];
const CONVERGENCE_SIGN_EVIDENCE = [
  'SRC-SIGNS',
  'RULE_SIGN_CONVERGENCE_POINT_FOCUS',
  'IGNORED_UNOFFICIAL_SPELL_INFERENCE',
];

/** @type {Readonly<Record<string, { weakEffect: string; transformKind: string; evidenceTier: string }>>} */
const RADIAL_WEAK_MAP = {
  'sigil.fire': {
    weakEffect: 'heat',
    subelementRegistryId: 'subelement.heat',
    transformKind: 'weaken_to_heat',
    evidenceTier: 'fan_documented_plausible',
  },
  'sigil.water': {
    weakEffect: 'mist',
    subelementRegistryId: 'subelement.mist',
    transformKind: 'weaken_to_mist',
    evidenceTier: 'custom_project_supported',
  },
  'sigil.earth': {
    weakEffect: 'dust',
    subelementRegistryId: 'subelement.dust',
    transformKind: 'weaken_to_dust',
    evidenceTier: 'custom_project_supported',
  },
  'sigil.light': {
    weakEffect: 'glow',
    subelementRegistryId: 'subelement.glow',
    transformKind: 'weaken_to_glow',
    evidenceTier: 'custom_project_supported',
  },
};

const REQUIRED_RADIAL_POINT_AT_COUNT = 2;

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
 * @param {object} program
 */
export function evaluateRules(program) {
  const sealResults = [];

  for (const seal of program.seals ?? []) {
    assignRingOwnership(seal);
    sealResults.push(evaluateSealRules(seal, program));
  }

  return {
    sealResults,
    unsupportedPairings: collectUnsupportedPairings(program, sealResults),
  };
}

/**
 * @param {{ sealResults: object[]; unsupportedPairings?: object[] }} result
 */
export function flattenRuleEvaluation(result) {
  /** @type {object[]} */
  const effects = [];
  /** @type {object[]} */
  const diagnostics = [...(result.unsupportedPairings ?? [])];

  for (const sr of result.sealResults ?? []) {
    for (const e of sr.effects ?? []) {
      effects.push({ ...e, sealId: sr.sealId });
    }
    diagnostics.push(...(sr.diagnostics ?? []));
  }

  effects.sort((a, b) => {
    const ka = `${a.kind}:${a.sealId}:${a.ruleId ?? ''}`;
    const kb = `${b.kind}:${b.sealId}:${b.ruleId ?? ''}`;
    return ka.localeCompare(kb);
  });

  return { effects, diagnostics };
}

/**
 * @param {object} seal
 */
function assignRingOwnership(seal) {
  const rings = [...(seal.rings ?? [])].sort(
    (a, b) => (a.radius ?? 0) - (b.radius ?? 0),
  );

  for (const symbol of seal.symbols ?? []) {
    const explicit = readRingIndex(symbol);
    let ringIndex = explicit;
    let ringId = null;

    if (ringIndex === null && rings.length > 0) {
      const polarRadius =
        symbol.geometry?.polarRadius ?? symbol.geometryAnalysis?.radialDistance ?? 0;
      ringIndex = ringIndexForRadius(polarRadius, rings);
    }

    if (ringIndex !== null && rings[ringIndex]) {
      ringId = rings[ringIndex].ringId;
    }

    symbol.ringOwnership = {
      ringIndex,
      ringId,
      ringCount: rings.length,
      zone:
        ringIndex === null
          ? 'unassigned'
          : ringIndex === 0
            ? rings.length > 1
              ? 'inner'
              : 'on_ring'
            : ringIndex === rings.length - 1
              ? 'outer'
              : 'middle',
    };
  }
}

/**
 * @param {object} symbol
 */
function readRingIndex(symbol) {
  const raw =
    symbol.geometry?.sourceGeometry?.raw ??
    symbol.provenance?.raw ??
    symbol.radial?.raw ??
    null;
  if (raw && typeof raw.ringIndex === 'number' && raw.ringIndex >= 0) {
    return raw.ringIndex;
  }
  return null;
}

/**
 * @param {number} polarRadius
 * @param {object[]} rings sorted by radius asc
 */
function ringIndexForRadius(polarRadius, rings) {
  for (let i = 0; i < rings.length; i++) {
    if (polarRadius <= (rings[i].radius ?? 0) + 1) {
      return i;
    }
  }
  return rings.length - 1;
}

/**
 * @param {object} seal
 * @param {object} program
 */
function evaluateSealRules(seal, program) {
  const diagnostics = [];
  const effects = [
    ...evaluateFieldLobeOperators(seal),
    ...evaluateOperatorApplications(seal, diagnostics),
  ];

  const watershot = evaluateWatershot(seal, diagnostics);

  const radialWeakDomains = evaluateRadialWeakDomain(seal, diagnostics);
  for (const radial of radialWeakDomains) {
    effects.push(buildModifierSourceOperator(radial));
  }

  const standaloneCool = evaluateStandaloneCool(
    seal,
    diagnostics,
    watershot ? [watershot] : [],
  );
  if (standaloneCool) effects.push(buildStandaloneCoolOperator(standaloneCool));

  const crush = evaluateCrush(seal, diagnostics);
  if (crush) effects.push(crush);

  const crosshair = evaluateCrosshairCenterGroup(seal, diagnostics, effects);
  if (crosshair) {
    effects.push(buildScopeFilterOperator(crosshair));
  }

  maybeFireColumnUnsupported(seal, effects, diagnostics);

  evaluateDeferredCatalogSigns(seal, diagnostics);

  return { sealId: seal.sealId, effects, diagnostics };
}

/**
 * Additive operator effects: field lobes are emitted beside legacy template effects.
 *
 * @param {object} seal
 */
function evaluateFieldLobeOperators(seal) {
  return (seal.geometryAnalysis?.fieldLobes ?? []).map((lobe) => {
    const derived = derivedFieldEmitClassification(seal, lobe);
    return {
      ruleId: 'RULE_OPERATOR_FIELD_LOBE',
      kind: 'operator_result',
      operatorFamily: lobe.operatorFamily,
      operatorRole: 'field_output',
      signRegistryId: lobe.registryId,
      domainRegistryId: lobe.anchorRegistryId ?? ownerDomainIdFromLobe(seal, lobe),
      domainSigilObjectId: lobe.anchorObjectId ?? null,
      anchorObjectId: lobe.anchorObjectId,
      fieldLobe: lobe,
      derivedClassification: derived.classification,
      compatTrace: {
        legacyEffectKind: derived.legacyEffectKind,
      },
      sourceObjects: lobe.sourceObjects ?? [],
      geometryBinding: {
        axis: lobe.axis,
        vectorSum: lobe.vectorSum,
        magnitude: lobe.magnitude,
        spread: lobe.spread,
        cluster: lobe.cluster,
        compatibility: lobe.compatibility,
        semanticOverrides: lobe.semanticOverrides ?? [],
        ...derived.geometryBinding,
      },
      evidenceTier: 'fan_documented_plausible',
      evidenceRefs: ['RULE_OPERATOR_FIELD_LOBE'],
      confidence: 'fan_documented_plausible',
      provenanceClass: 'fan_documented_plausible',
      warningScoped: true,
    };
  });
}

/**
 * @param {object} seal
 * @param {object} lobe
 */
function derivedFieldEmitClassification(seal, lobe) {
  if (lobe.registryId === 'sign.dispersion') {
    return {
      classification: 'dispersion_emission',
      legacyEffectKind: 'outward_dispersion',
      geometryBinding: {
        effectKind: 'dispersion_emission',
        symmetric: seal.geometryAnalysis?.outwardDispersion?.symmetric ?? null,
        symmetryClass: seal.geometryAnalysis?.outwardDispersion?.symmetryClass ?? null,
        biasMagnitude: seal.geometryAnalysis?.outwardDispersion?.biasMagnitude ?? null,
      },
    };
  }
  if (lobe.registryId === 'sign.column' && seal.geometryAnalysis?.outwardDispersion) {
    return {
      classification: 'dispersion_emission',
      legacyEffectKind: 'outward_dispersion',
      geometryBinding: {
        effectKind: 'dispersion_emission',
        symmetric: seal.geometryAnalysis.outwardDispersion.symmetric,
        symmetryClass: seal.geometryAnalysis.outwardDispersion.symmetryClass,
        biasMagnitude: seal.geometryAnalysis.outwardDispersion.biasMagnitude,
      },
    };
  }
  const watershot = seal.geometryAnalysis?.watershotColumn;
  if (lobe.registryId === 'sign.column' && watershot) {
    return {
      classification: 'column_emission',
      legacyEffectKind: 'watershot_column',
      geometryBinding: {
        centered: watershot.centered === true,
        biased: watershot.biased === true || watershot.multiProfile === true,
        symmetryClass: watershot.symmetryClass,
        biasMagnitude: watershot.columnGroup?.biasMagnitude ?? 0,
        columnVectorClassification: watershot.columnGroup?.columnVectorClassification ?? null,
      },
    };
  }
  return {
    classification: lobe.registryId === 'sign.column' ? 'column_emission' : null,
    legacyEffectKind: null,
    geometryBinding: {},
  };
}

/**
 * @param {object} seal
 * @param {object} lobe
 */
function ownerDomainIdFromLobe(seal, lobe) {
  const anchorId = lobe.anchorObjectId;
  const anchor = (seal.symbols ?? []).find((s) => s.objectId === anchorId);
  return anchor?.resolvedRegistryId ?? null;
}

/**
 * @param {object} seal
 * @param {object[]} diagnostics
 */
function evaluateOperatorApplications(seal, diagnostics) {
  const results = [];
  for (const app of seal.geometryAnalysis?.operatorApplications ?? []) {
    const result = evaluateOperatorApplication(seal, app, diagnostics);
    if (result) results.push(result);
  }
  return results;
}

/**
 * @param {object} seal
 * @param {object} app
 * @param {object[]} diagnostics
 */
function evaluateOperatorApplication(seal, app, diagnostics) {
  if (!app?.operatorFamily) return null;
  if (app.operatorFamily === 'field_emit') {
    if (app.legacyEffectKind !== 'outward_dispersion') return null;
    if (!app.domainRegistryId) return null;
    pushWarningDiagnostic(diagnostics, app, {
      code: 'rules.compiled_with_warnings',
      message:
        'Field emission operator for outward dispersion is warning-scoped',
      evidenceRefs: OUTWARD_DISPERSION_EVIDENCE,
      template: 'field_emit_dispersion',
    });
    return operatorResultFromApplication(app, {
      derivedClassification: 'dispersion_emission',
      effectKind: 'dispersion_emission',
      fieldModification: app.fieldModification ?? null,
      evidenceRefs: OUTWARD_DISPERSION_EVIDENCE,
    });
  }
  if (app.operatorFamily === 'field_attract') {
    if (!app.domainRegistryId || !PROTOTYPE_DOMAIN_SIGILS.has(app.domainRegistryId)) return null;
    const pullMode = app.directionMode === 'push' ? 'push' : 'pull';
    pushWarningDiagnostic(diagnostics, app, {
      code: pullMode === 'push' ? 'rules.pull_inverted_push' : 'rules.compiled_with_warnings',
      message:
        pullMode === 'push'
          ? 'Pull operator resolves inverted/outward layout as push metadata'
          : `Pull operator on ${app.domainRegistryId} is warning-scoped`,
      evidenceRefs: PULL_SIGN_EVIDENCE,
      template: 'field_attract',
      extraProvenance: {
        pullMode,
        pushInstanceCount: app.pushMetadata?.pushInstanceCount ?? 0,
      },
    });
    return operatorResultFromApplication(app, {
      pullMode,
      effectKind: pullMode === 'push' ? 'push' : 'pull',
      pullTwist: app.pullTwist ?? null,
      pushMetadata: app.pushMetadata ?? null,
      directionMode: app.directionMode ?? null,
      evidenceRefs: PULL_SIGN_EVIDENCE,
    });
  }
  if (app.operatorFamily === 'scope_boundary') {
    if (!app.domainRegistryId || !PROTOTYPE_DOMAIN_SIGILS.has(app.domainRegistryId)) return null;
    pushWarningDiagnostic(diagnostics, app, {
      message: `Scope boundary operator on ${app.domainRegistryId} (${app.regionZone}) is warning-scoped`,
      evidenceRefs: REGION_SIGN_EVIDENCE,
      template: 'scope_boundary',
      extraProvenance: { regionZone: app.regionZone },
    });
    return operatorResultFromApplication(app, {
      regionZone: app.regionZone ?? null,
      emissionPlacement: app.emissionPlacement ?? 'on_ring',
      effectKind: 'region_boundary',
      evidenceRefs: REGION_SIGN_EVIDENCE,
    });
  }
  if (app.operatorFamily === 'lift_motion') {
    if (!PROTOTYPE_DOMAIN_SIGILS.has(app.domainRegistryId)) {
      return null;
    }
    const evidenceRefs =
      app.domainRegistryId === 'sigil.fire'
        ? LEVITATION_FIRE_EVIDENCE
        : app.domainRegistryId === 'sigil.wind'
          ? LEVITATION_WIND_EVIDENCE
          : LEVITATION_PROJECT_EVIDENCE;
    pushWarningDiagnostic(diagnostics, app, {
      message: `Lift-motion operator for ${app.domainRegistryId} is warning-scoped`,
      evidenceRefs,
      template: 'lift_motion',
    });
    const translationVector = app.translationVector ?? { x: 0, y: 0 };
    const moving = Math.hypot(translationVector.x ?? 0, translationVector.y ?? 0) > 1e-6;
    return operatorResultFromApplication(app, {
      motionMode: app.motionMode ?? null,
      verticalLift: app.verticalLift ?? null,
      translationVector,
      tangentialBias: app.tangentialBias ?? 0,
      torqueDirection: app.torqueDirection ?? 'none',
      balanced: app.geometryBinding?.symmetric === true && !moving,
      continuousStream: app.domainRegistryId === 'sigil.wind' && moving,
      oneShotLaunch: app.domainRegistryId !== 'sigil.wind' && moving,
      heightFromSignLength: app.verticalLift ?? null,
      launchVector: moving ? translationVector : null,
      geometryBinding: {
        centeredFloat: !moving && app.domainRegistryId !== 'sigil.wind',
        generatedOutput: app.domainRegistryId !== 'sigil.wind',
        targetMode: app.domainRegistryId === 'sigil.wind' ? 'seal_carrier' : 'generated_output',
        outputMagnitudeScale: app.geometryBinding?.outputMagnitudeScale ?? null,
        biasMagnitude: app.geometryBinding?.biasMagnitude ?? 0,
      },
      evidenceRefs,
    });
  }
  if (app.operatorFamily === 'material_intake') {
    if (!app.domainRegistryId || !PROTOTYPE_DOMAIN_SIGILS.has(app.domainRegistryId)) return null;
    const sourceMode = app.sourceMode ?? (app.signRegistryId === 'sign.gather' ? 'gather_active' : 'collect_nearby');
    pushWarningDiagnostic(diagnostics, app, {
      message: `Material intake operator on ${app.domainRegistryId} emits ${sourceMode} source mode`,
      evidenceRefs: app.signRegistryId === 'sign.gather' ? GATHER_SIGN_EVIDENCE : COLLECTION_SIGN_EVIDENCE,
      template: 'material_intake',
      extraProvenance: { sourceMode },
    });
    return operatorResultFromApplication(app, {
      sourceMode,
      materialIntake: app.materialIntake ?? null,
      effectKind: sourceMode,
      evidenceRefs: app.signRegistryId === 'sign.gather' ? GATHER_SIGN_EVIDENCE : COLLECTION_SIGN_EVIDENCE,
    });
  }
  if (app.operatorFamily === 'field_focus') {
    const sampleObject = app.sourceObjects?.[0]?.objectId ?? null;
    if (app.geometryBinding?.ignoredWindWallInference) {
      diagnostics.push(
        makeCompileDiagnostic({
          code: 'rules.ignored_unofficial_spell_inference',
          status: 'speculative_disabled',
          sourcePath: sampleObject ?? '',
          normalizedObjectId: sampleObject,
          message:
            'Ignored unofficial wind-wall spell inference; convergence and inverted column do not activate',
          fallback: 'speculative_disabled',
          evidenceTier: 'speculative_disabled',
          provenance: { inference: 'wind_wall', evidenceRefs: CONVERGENCE_SIGN_EVIDENCE },
        }),
      );
      return null;
    }
    if (app.pointFocus !== true) {
      diagnostics.push(
        makeCompileDiagnostic({
          code: 'rules.convergence_under_specified',
          status: 'speculative_disabled',
          sourcePath: sampleObject ?? '',
          normalizedObjectId: sampleObject,
          message:
            'Convergence operator is under-specified for point-focus; requires symmetric inward duplicate signs',
          fallback: 'speculative_disabled',
          evidenceTier: 'speculative_disabled',
          provenance: { evidenceRefs: CONVERGENCE_SIGN_EVIDENCE },
        }),
      );
      return null;
    }
    if (!app.domainRegistryId || !PROTOTYPE_DOMAIN_SIGILS.has(app.domainRegistryId)) return null;
    pushWarningDiagnostic(diagnostics, app, {
      message: `Field focus operator on ${app.domainRegistryId} yields point-focus metadata`,
      evidenceRefs: CONVERGENCE_SIGN_EVIDENCE,
      template: 'field_focus',
      extraProvenance: { convergenceMode: 'point_focus' },
    });
    return operatorResultFromApplication(app, {
      convergenceMode: app.convergenceMode ?? 'point_focus',
      pointFocus: true,
      fieldModification: app.fieldModification ?? null,
      effectKind: 'convergence_point_focus',
      evidenceRefs: CONVERGENCE_SIGN_EVIDENCE,
    });
  }
  return null;
}

/**
 * @param {object} app
 * @param {object} [extra]
 */
function operatorResultFromApplication(app, extra = {}) {
  const evidenceRefs = extra.evidenceRefs ?? ['RULE_OPERATOR_APPLICATION'];
  const { geometryBinding: extraGeometryBinding, ...restExtra } = extra;
  return {
    ruleId: `RULE_OPERATOR_RESULT_${String(app.signRegistryId).replace(/\W+/g, '_').toUpperCase()}`,
    kind: 'operator_result',
    operatorFamily: app.operatorFamily,
    operatorRole: app.operatorRole ?? null,
    signRegistryId: app.signRegistryId,
    domainRegistryId: app.domainRegistryId ?? null,
    domainSigilObjectId: app.domainSigilObjectId ?? null,
    sourceObjects: app.sourceObjects ?? [],
    geometryBinding: {
      ...(app.geometryBinding ?? {}),
      ...(extraGeometryBinding ?? {}),
      operatorApplicationId: app.applicationId ?? null,
    },
    confidence: app.confidence ?? 'fan_documented_plausible',
    diagnosticScope: 'warning_scoped',
    operatorApplicationId: app.applicationId ?? null,
    legacyEffectKind: app.legacyEffectKind ?? null,
    compatTrace: {
      legacyEffectKind: app.legacyEffectKind ?? null,
      legacyLayoutKind: app.legacyLayoutKind ?? null,
    },
    orientationProbe: app.orientationProbe ?? null,
    orientationProbeResolution: app.orientationProbeResolution ?? null,
    targetQuery: app.targetQuery ?? null,
    materialIntake: app.materialIntake ?? null,
    fieldModification: app.fieldModification ?? null,
    evidenceTier: app.confidence ?? 'fan_documented_plausible',
    evidenceRefs,
    provenanceClass:
      app.confidence === 'custom_project_supported'
        ? 'custom_project_supported'
        : 'fan_documented_plausible',
    warningScoped: true,
    ...restExtra,
  };
}

/**
 * @param {object[]} diagnostics
 * @param {object} app
 * @param {{ code?: string; message: string; evidenceRefs: string[]; template: string; extraProvenance?: object }} spec
 */
function pushWarningDiagnostic(diagnostics, app, spec) {
  const sampleObject = app.sourceObjects?.[0]?.objectId ?? null;
  diagnostics.push(
    makeCompileDiagnostic({
      code: spec.code ?? 'rules.compiled_with_warnings',
      status: 'compiled_with_warnings',
      sourcePath: sampleObject ?? '',
      normalizedObjectId: sampleObject,
      message: spec.message,
      fallback: 'compiled_with_warnings',
      evidenceTier: app.confidence ?? 'fan_documented_plausible',
      provenance: {
        template: spec.template,
        operatorFamily: app.operatorFamily,
        signRegistryId: app.signRegistryId,
        evidenceRefs: spec.evidenceRefs,
        ...(spec.extraProvenance ?? {}),
      },
    }),
  );
}

/**
 * @param {object} radialEffect
 */
function buildModifierSourceOperator(radialEffect) {
  const thermal = buildTemperatureDriverMetadata(radialEffect.weakEffect, radialEffect);
  return {
    ruleId: 'RULE_OPERATOR_MODIFIER_SOURCE',
    kind: 'operator_result',
    operatorFamily: 'weaken_modifier_source',
    operatorRole: 'modifier_source',
    sourceEffectKind: radialEffect.kind,
    domainRegistryId: radialEffect.domainRegistryId,
    domainSigilObjectId: radialEffect.domainSigilObjectId,
    signRegistryId: radialEffect.signRegistryId,
    weakEffect: radialEffect.weakEffect,
    subelementRegistryId: radialEffect.subelementRegistryId,
    transformKind: radialEffect.transformKind,
    temperatureDriver: thermal,
    luminousModifier:
      radialEffect.weakEffect === 'glow'
        ? {
            effectKind: 'luminous_modifier',
            spectralMode: 'glow',
            thermalByDefault: false,
          }
        : null,
    pointedAtSigilId: radialEffect.pointedAtSigilId,
    radialObjectIds: radialEffect.radialObjectIds ?? [],
    confidence: radialEffect.evidenceTier ?? 'fan_documented_plausible',
    compatTrace: {
      legacyEffectKind: radialEffect.kind,
      legacyRuleId: radialEffect.ruleId ?? null,
    },
    sourceObjects: radialEffect.sourceObjects ?? [],
    geometryBinding: {
      pointedAtSigilId: radialEffect.pointedAtSigilId,
      radialObjectIds: radialEffect.radialObjectIds ?? [],
      radialCount: radialEffect.radialObjectIds?.length ?? 0,
    },
    evidenceTier: radialEffect.evidenceTier,
    evidenceRefs: radialEffect.evidenceRefs ?? [],
    provenanceClass: radialEffect.provenanceClass,
    warningScoped: radialEffect.warningScoped === true,
  };
}

/**
 * @param {object} coolEffect
 */
function buildStandaloneCoolOperator(coolEffect) {
  const thermal = buildTemperatureDriverMetadata(
    coolEffect.intensityKind ?? coolEffect.weakEffect,
    coolEffect,
  );
  return {
    ruleId: 'RULE_OPERATOR_TEMPERATURE_DRIVER_COOL',
    kind: 'operator_result',
    operatorFamily: 'temperature_driver',
    operatorRole: 'state_driver',
    signRegistryId: 'sign.cool',
    domainRegistryId: coolEffect.domainRegistryId,
    domainSigilObjectId: coolEffect.centerSigilId,
    weakEffect: coolEffect.weakEffect,
    intensityTier: coolEffect.intensityTier ?? 'base',
    intensityKind: coolEffect.intensityKind ?? null,
    strengthenApplied: coolEffect.strengthenApplied === true,
    temperatureDriver: thermal,
    targetQuery: {
      targetKind: 'center_group',
      aspectFilter: coolEffect.domainRegistryId,
      centerSigilId: coolEffect.centerSigilId,
    },
    binding: {
      bindingMode: 'center_affix',
      centerSigilId: coolEffect.centerSigilId,
      centerRegistryId: coolEffect.domainRegistryId,
      materialProfileId:
        coolEffect.domainRegistryId === 'sigil.water' ? 'material.water' : null,
    },
    sourceObjects: coolEffect.sourceObjects ?? [],
    geometryBinding: coolEffect.geometryBinding,
    confidence: coolEffect.evidenceTier ?? 'fan_documented_plausible',
    diagnosticScope: 'warning_scoped',
    evidenceTier: coolEffect.evidenceTier,
    evidenceRefs: coolEffect.evidenceRefs ?? [],
    provenanceClass: coolEffect.provenanceClass,
    warningScoped: true,
    compatTrace: {
      legacyEffectKind: coolEffect.kind,
      legacyRuleId: coolEffect.ruleId,
    },
  };
}

/**
 * @param {object} crosshairEffect
 */
function buildScopeFilterOperator(crosshairEffect) {
  const modifier = crosshairEffect.modifierEffect;
  return {
    ruleId: 'RULE_OPERATOR_SCOPE_FILTER',
    kind: 'operator_result',
    operatorFamily: 'scope_filter',
    operatorRole: 'scope_filter',
    signRegistryId: 'sign.crosshair',
    crosshairObjectId: crosshairEffect.crosshairObjectId,
    targetKind: crosshairEffect.innerTarget?.targetKind ?? 'center_group',
    centerGroup: crosshairEffect.centerGroup,
    modifierWeakEffect: crosshairEffect.modifierWeakEffect,
    modifierEffect: {
      ...modifier,
      temperatureDriver: buildTemperatureDriverMetadata(
        modifier?.weakEffect,
        modifier,
      ),
      luminousModifier:
        modifier?.weakEffect === 'glow'
          ? {
              effectKind: 'luminous_modifier',
              spectralMode: 'glow',
              thermalByDefault: false,
            }
          : modifier?.luminousModifier ?? null,
    },
    innerTarget: crosshairEffect.innerTarget,
    confidence: crosshairEffect.evidenceTier ?? 'custom_project_supported',
    compatTrace: {
      legacyEffectKind: crosshairEffect.kind,
      legacyRuleId: crosshairEffect.ruleId ?? null,
    },
    sourceObjects: [{ objectId: crosshairEffect.crosshairObjectId, registryId: 'sign.crosshair' }],
    geometryBinding: {
      centerSigilId: crosshairEffect.centerGroup?.centerSigilId ?? null,
      centerRegistryId: crosshairEffect.centerGroup?.centerRegistryId ?? null,
      targetKind: crosshairEffect.innerTarget?.targetKind ?? 'center_group',
      modifierWeakEffect: crosshairEffect.modifierWeakEffect,
    },
    evidenceTier: crosshairEffect.evidenceTier,
    evidenceRefs: crosshairEffect.evidenceRefs ?? [],
    provenanceClass: crosshairEffect.provenanceClass,
    warningScoped: crosshairEffect.warningScoped === true,
  };
}

/**
 * @param {string | null | undefined} weakEffect
 * @param {object} source
 */
function buildTemperatureDriverMetadata(weakEffect, source = {}) {
  const effect = weakEffect;
  if (!['heat', 'cool'].includes(effect ?? '')) return null;
  if (effect === 'heat') {
    const profile = SUBELEMENT_PROFILES['subelement.heat'];
    return {
      driverKind: 'temperature_driver',
      direction: 'heat',
      thermalEffect: profile.thermalEffect,
      equilibriumTempC: profile.equilibriumTempC,
      minTempC: profile.minTempC,
      maxTempC: profile.maxTempC,
      minSpecificEnergy: 0,
      maxSpecificEnergy: 1,
      strength: 0.08,
      bounded: true,
      doesNotCreateMaterial: true,
      doesNotPhaseChangeByItself: true,
      strengthenApplied: source.strengthenApplied === true,
      retentionGain: source.strengthenApplied === true ? source.strengthenWeight ?? 1 : 0,
      stabilizationMode: source.strengthenApplied === true ? 'retains_driver_state' : null,
    };
  }
  return {
    driverKind: 'temperature_driver',
    direction: 'cool',
    thermalEffect: 'cool',
    equilibriumTempC: 4,
    minTempC: -5,
    maxTempC: 25,
    minSpecificEnergy: 0,
    maxSpecificEnergy: 1,
    strength: 0.08,
    bounded: true,
    doesNotCreateMaterial: true,
    instantPhaseChange: false,
    strengthenApplied: source.strengthenApplied === true,
    retentionGain: source.strengthenApplied === true ? source.strengthenWeight ?? 1 : 0,
    stabilizationMode: source.strengthenApplied === true ? 'retains_driver_state' : null,
  };
}

/** @type {Readonly<Record<string, { code: string; status: string; message: string; evidenceRefs: string[] }>>} */
const DEFERRED_CATALOG_SIGN_DIAGNOSTICS = {
  'sign.float': {
    code: 'rules.deprecated_or_variant_symbol',
    status: 'deprecated_or_variant_symbol',
    message:
      'sign.float is deprecated; use sign.levitation for levitation templates instead of standalone float output',
    evidenceRefs: ['REJECT_FLOAT_DETACHED_OUTPUT', 'DOSSIER:SPELL_PYREBALL_SEAL'],
  },
  'sign.billow': {
    code: 'rules.catalog_deferred_no_template',
    status: 'speculative_disabled',
    message: 'sign.billow has no project-supported official template; diagnostic-only',
    evidenceRefs: ['SRC-SIGNS'],
  },
  'sign.weave': {
    code: 'rules.catalog_deferred_no_template',
    status: 'speculative_disabled',
    message: 'sign.weave has no project-supported official template; diagnostic-only',
    evidenceRefs: ['SRC-SIGNS'],
  },
  'sign.entwine': {
    code: 'rules.catalog_deferred_no_template',
    status: 'speculative_disabled',
    message: 'sign.entwine has no project-supported official template; diagnostic-only',
    evidenceRefs: ['SRC-SIGNS'],
  },
  'sign.sign_of_wind': {
    code: 'rules.ambiguous_symbol_semantics',
    status: 'ambiguous_semantics',
    message:
      'sign.sign_of_wind is an official identity with unresolved wind semantics; no active effect without template',
    evidenceRefs: ['SRC-SIGNS'],
  },
  'sign.aeriforms_defined': {
    code: 'rules.ambiguous_symbol_semantics',
    status: 'ambiguous_semantics',
    message:
      'sign.aeriforms_defined is an official identity with unresolved aeriform semantics; no active effect without template',
    evidenceRefs: ['SRC-SIGNS'],
  },
  'sign.glaives': {
    code: 'rules.forbidden_body_affecting_symbol',
    status: 'forbidden_or_body_affecting',
    message:
      'sign.glaives flesh embedding and body-affecting behavior are blocked; no glaives embed effect',
    evidenceRefs: ['SRC-SIGNS'],
  },
  'sign.sights_set': {
    code: 'rules.forbidden_body_affecting_symbol',
    status: 'forbidden_or_body_affecting',
    message:
      'sign.sights_set homing and body targeting are safety-gated; no active targeting effect',
    evidenceRefs: ['SRC-SIGNS'],
  },
  'sign.repetition': {
    code: 'registry.legacy_sign_alias',
    status: 'legacy_sign_alias',
    message:
      'sign.repetition is a legacy alias for sigil.repetition; no active repetition operator in this wave',
    evidenceRefs: ['SRC-SIGNS'],
  },
};

/**
 * M5 ambiguous catalog: registry-resolved official signs without dossier templates.
 *
 * @param {object} seal
 * @param {object[]} diagnostics
 */
function evaluateDeferredCatalogSigns(seal, diagnostics) {
  for (const [signId, spec] of Object.entries(DEFERRED_CATALOG_SIGN_DIAGNOSTICS)) {
    const instances = deferredSignInstances(seal, signId);
    if (instances.length === 0) continue;

    const sample = instances[0];
    diagnostics.push(
      makeCompileDiagnostic({
        code: spec.code,
        status: spec.status,
        sourcePath: sample.provenance?.sourcePath ?? '',
        normalizedObjectId: sample.objectId,
        registryId: signId,
        message: spec.message,
        fallback: spec.status,
        evidenceTier: spec.status,
        provenance: { evidenceRefs: spec.evidenceRefs },
      }),
    );
  }
}

/**
 * @param {object} seal
 * @param {string} signId
 */
function deferredSignInstances(seal, signId) {
  return (seal.symbols ?? []).filter(
    (s) =>
      s.categoryHint === 'sign' &&
      s.objectId?.startsWith('sign-instance:') &&
      s.resolvedRegistryId === signId &&
      s.semanticEligibility === 'diagnostic_only',
  );
}

/**
 * Uniform sign.crush on center group; water+inward column → mist; other domains diagnostic only.
 *
 * @param {object} seal
 * @param {object[]} diagnostics
 */
function evaluateCrush(seal, diagnostics) {
  const crush = seal.geometryAnalysis?.crushLayout;
  if (!crush?.instances?.length || !crush.hasInwardColumn) return null;

  const domainId = crush.domainRegistryId;
  const sampleId = crush.instances[0]?.objectId ?? '';

  if (domainId !== 'sigil.water') {
    diagnostics.push(
      makeCompileDiagnostic({
        code: 'rules.crush_domain_undefined',
        status: 'speculative_disabled',
        sourcePath: sampleId,
        normalizedObjectId: sampleId,
        message: `Crush on ${domainId ?? 'unknown'} has no supported crush effect; water→mist only`,
        fallback: 'speculative_disabled',
        evidenceTier: 'fan_documented_plausible',
        provenance: {
          domainRegistryId: domainId,
          crushSignIds: crush.crushSignIds,
          evidenceRefs: CRUSH_SIGN_EVIDENCE,
        },
      }),
    );
    return null;
  }

  diagnostics.push(
    makeCompileDiagnostic({
      code: 'rules.compiled_with_warnings',
      status: 'compiled_with_warnings',
      sourcePath: sampleId,
      normalizedObjectId: sampleId,
      message: 'Water crush on center group yields mist (warning-scoped)',
      fallback: 'compiled_with_warnings',
      evidenceTier: 'fan_documented_plausible',
      provenance: { template: 'crush_water_mist', evidenceRefs: CRUSH_SIGN_EVIDENCE },
    }),
  );

  return {
    ruleId: 'RULE_SIGN_CRUSH_WATER_MIST',
    kind: 'sign_crush',
    signRole: 'crush',
    effectKind: 'crush_water_mist',
    transformKind: 'crush_water_mist',
    weakEffect: 'mist',
    domainRegistryId: 'sigil.water',
    domainSigilObjectId: crush.domainSigilObjectId,
    signRegistryId: 'sign.crush',
    sourceObjects: [
      { objectId: crush.domainSigilObjectId, registryId: 'sigil.water' },
      ...crush.instances.map((i) => ({ objectId: i.objectId, registryId: 'sign.crush' })),
    ],
    geometryBinding: {
      vectorSummary: crush.vectorSummary,
      symmetric: crush.symmetric === true,
      symmetryClass: crush.symmetryClass,
      biasMagnitude: crush.biasMagnitude,
      hasInwardColumn: true,
    },
    evidenceTier: 'fan_documented_plausible',
    evidenceRefs: CRUSH_SIGN_EVIDENCE,
    provenanceClass: 'fan_documented_plausible',
    warningScoped: true,
  };
}

/**
 * Standalone cool on center sigil group with inward column (no Crosshair).
 *
 * @param {object} seal
 * @param {object[]} diagnostics
 * @param {object[]} effects
 */
function evaluateStandaloneCool(seal, diagnostics, effects) {
  if (activeSignInstances(seal, 'sign.crosshair').length > 0) return null;

  const centerGroup = seal.geometryAnalysis?.centerGroup;
  const centerAffixes = seal.geometryAnalysis?.centerAffixes;
  if (!centerGroup?.hasColumn || !centerAffixes?.hasCool) return null;

  const domainId = centerGroup.centerRegistryId;
  if (!domainId || !PROTOTYPE_DOMAIN_SIGILS.has(domainId)) return null;

  const sampleId = centerAffixes.coolSignIds[0] ?? '';

  diagnostics.push(
    makeCompileDiagnostic({
      code: 'rules.compiled_with_warnings',
      status: 'compiled_with_warnings',
      sourcePath: sampleId,
      normalizedObjectId: sampleId,
      message: `Standalone cool on ${domainId} center group with column is warning-scoped`,
      fallback: 'compiled_with_warnings',
      evidenceTier: 'fan_documented_plausible',
      provenance: { template: 'standalone_cool_center_group', evidenceRefs: STANDALONE_COOL_EVIDENCE },
    }),
  );

  const hasWatershot = effects.some(
    (e) =>
      e.kind === 'operator_result' &&
      e.operatorFamily === 'field_emit' &&
      e.signRegistryId === 'sign.column' &&
      e.domainRegistryId === 'sigil.water',
  );
  const baseKind =
    domainId === 'sigil.water' && hasWatershot ? 'watershot_column' : 'center_group_column';

  return {
    ruleId: 'RULE_STANDALONE_COOL_CENTER_GROUP',
    kind: 'standalone_cool',
    signRole: 'cool',
    effectKind: 'temperature_driver',
    weakEffect: 'cool',
    intensityTier: 'base',
    intensityKind: null,
    strengthenApplied: false,
    domainRegistryId: domainId,
    centerSigilId: centerGroup.centerSigilId,
    signRegistryId: 'sign.cool',
    coolSignIds: [...centerAffixes.coolSignIds],
    baseEffectKind: baseKind,
    sourceObjects: [
      { objectId: centerGroup.centerSigilId, registryId: domainId },
      ...centerAffixes.coolSignIds.map((id) => ({ objectId: id, registryId: 'sign.cool' })),
      ...(centerGroup.modifyingSignIds ?? []).map((id) => ({
        objectId: id,
        registryId: 'sign.column',
      })),
    ],
    geometryBinding: {
      centerGroup: {
        centerSigilId: centerGroup.centerSigilId,
        centerRegistryId: domainId,
        hasColumn: true,
      },
    },
    evidenceTier: 'fan_documented_plausible',
    evidenceRefs: STANDALONE_COOL_EVIDENCE,
    provenanceClass: 'fan_documented_plausible',
    warningScoped: true,
  };
}

/**
 * @param {object} seal
 * @param {object[]} diagnostics
 */
function evaluateWatershot(seal, diagnostics) {
  const watershot = seal.geometryAnalysis?.watershotColumn;
  if (!watershot) return null;

  const waterSigil = findSigil(seal, 'sigil.water');
  const columnGroup = watershot.columnGroup;
  if (!waterSigil || !columnGroup) return null;

  diagnostics.push(
    makeCompileDiagnostic({
      code: 'rules.compiled_with_warnings',
      status: 'compiled_with_warnings',
      sourcePath: waterSigil.provenance?.sourcePath ?? '',
      normalizedObjectId: waterSigil.objectId,
      message:
        'Watershot-like water+column template is warning-scoped; direct panel evidence still needed',
      fallback: 'compiled_with_warnings',
      evidenceTier: 'fan_documented_plausible',
      provenance: { template: 'watershot_like', evidenceRefs: WATERSHOT_EVIDENCE },
    }),
  );

  const direction = columnGroup.vectorSum ?? { x: 0, y: 0 };
  const biasMagnitude = columnGroup.biasMagnitude ?? 0;

  return {
    ruleId: 'RULE_WATERSHOT_WATER_COLUMN',
    template: 'watershot_like',
    kind: 'watershot_column',
    domainRegistryId: 'sigil.water',
    signRegistryId: 'sign.column',
    sourceObjects: [
      { objectId: waterSigil.objectId, registryId: 'sigil.water' },
      ...columnGroup.instanceIds.map((id) => ({ objectId: id, registryId: 'sign.column' })),
    ],
    geometryBinding: {
      directionVector: direction,
      biasMagnitude,
      columnVectorClassification: columnGroup.columnVectorClassification,
      centered: watershot.centered === true,
      biased: watershot.biased === true || watershot.multiProfile === true,
      symmetryClass: columnGroup.symmetryClass,
    },
    evidenceTier: 'fan_documented_plausible',
    evidenceRefs: WATERSHOT_EVIDENCE,
    provenanceClass: 'fan_documented_plausible',
    warningScoped: true,
  };
}

/**
 * @param {object} seal
 * @param {object[]} diagnostics
 */
function evaluateRadialWeakDomain(seal, diagnostics) {
  const results = [];
  const pointing = seal.geometryAnalysis?.radialPointing;
  if (!pointing?.countsBySigilId) return results;

  const radialSigns = activeSignInstances(seal, 'sign.radial');
  if (radialSigns.length === 0) return results;

  const processedTargets = new Set();

  for (const entry of Object.values(pointing.countsBySigilId)) {
    if (processedTargets.has(entry.objectId)) continue;
    processedTargets.add(entry.objectId);

    const sigil = (seal.symbols ?? []).find((s) => s.objectId === entry.objectId);
    if (!sigil?.resolvedRegistryId || !canContributeSemantics(sigil)) continue;

    const domainId = sigil.resolvedRegistryId;
    if (!PROTOTYPE_DOMAIN_SIGILS.has(domainId)) continue;

    if (entry.count !== REQUIRED_RADIAL_POINT_AT_COUNT) {
      const sampleRadial = radialSigns.find((r) =>
        entry.radialObjectIds.includes(r.objectId),
      );
      const domainSigilCount = (seal.symbols ?? []).filter(
        (s) =>
          s.categoryHint === 'sigil' &&
          s.resolvedRegistryId &&
          canContributeSemantics(s) &&
          PROTOTYPE_DOMAIN_SIGILS.has(s.resolvedRegistryId),
      ).length;
      const invalidCode =
        domainSigilCount > 1 ? 'rules.radial_ambiguous_domain' : 'rules.radial_invalid_count';
      diagnostics.push(
        makeCompileDiagnostic({
          code: invalidCode,
          status: 'invalid_structure',
          sourcePath: sampleRadial?.provenance?.sourcePath ?? sigil.provenance?.sourcePath ?? '',
          normalizedObjectId: sampleRadial?.objectId ?? sigil.objectId,
          message:
            invalidCode === 'rules.radial_ambiguous_domain'
              ? `Radial weak-domain is ambiguous with multiple domain sigils; found ${entry.count} radial sign(s) pointing at ${domainId} (requires exactly ${REQUIRED_RADIAL_POINT_AT_COUNT})`
              : `Radial weak-domain requires exactly ${REQUIRED_RADIAL_POINT_AT_COUNT} radial signs pointing at the target sigil; found ${entry.count} for ${domainId}`,
          fallback: 'invalid_structure',
          provenance: {
            pointedAtSigilId: entry.objectId,
            radialCount: entry.count,
            requiredCount: REQUIRED_RADIAL_POINT_AT_COUNT,
          },
        }),
      );
      continue;
    }

    const radialSign = radialSigns.find((r) => entry.radialObjectIds.includes(r.objectId));
    if (!radialSign) continue;

    if (domainId === 'sigil.wind') {
      diagnostics.push(
        makeCompileDiagnostic({
          code: 'rules.radial_wind_no_weak_form',
          status: 'visual_only',
          sourcePath: radialSign.provenance?.sourcePath ?? '',
          normalizedObjectId: radialSign.objectId,
          message:
            'Wind + Radial has no conservative weak-domain mapping; emit diagnostic only per prototype ruleset',
          fallback: 'visual_only',
          evidenceTier: 'custom_project_supported',
          provenance: { evidenceRefs: RADIAL_EVIDENCE, pointedAtSigilId: entry.objectId },
        }),
      );
      continue;
    }

    const mapping = RADIAL_WEAK_MAP[domainId];
    if (!mapping) {
      diagnostics.push(
        makeCompileDiagnostic({
          code: 'rules.unsupported_combination',
          status: 'speculative_disabled',
          sourcePath: radialSign.provenance?.sourcePath ?? '',
          normalizedObjectId: radialSign.objectId,
          message: `Radial weak-domain mapping is not supported for ${domainId}`,
          fallback: 'speculative_disabled',
        }),
      );
      continue;
    }

    diagnostics.push(
      makeCompileDiagnostic({
        code: 'rules.compiled_with_warnings',
        status: 'compiled_with_warnings',
        sourcePath: radialSign.provenance?.sourcePath ?? '',
        normalizedObjectId: radialSign.objectId,
        message: `Custom-supported Radial weakens ${domainId} to ${mapping.weakEffect} (${entry.count} radials point-at)`,
        fallback: 'compiled_with_warnings',
        evidenceTier: mapping.evidenceTier,
        provenance: {
          customSupported: true,
          evidenceRefs: RADIAL_EVIDENCE,
          pointedAtSigilId: entry.objectId,
        },
      }),
    );

    results.push({
      ruleId: 'RULE_CUSTOM_RADIAL_WEAKEN_DOMAIN',
      kind: 'radial_weak_domain',
      domainRegistryId: domainId,
      domainSigilObjectId: entry.objectId,
      signRegistryId: 'sign.radial',
      weakEffect: mapping.weakEffect,
      subelementRegistryId: mapping.subelementRegistryId,
      transformKind: mapping.transformKind,
      pointedAtSigilId: entry.objectId,
      radialObjectIds: entry.radialObjectIds,
      sourceObjects: [
        { objectId: sigil.objectId, registryId: domainId },
        ...entry.radialObjectIds.map((id) => ({ objectId: id, registryId: 'sign.radial' })),
      ],
      ringIndex: radialSign.ringOwnership?.ringIndex ?? null,
      evidenceTier: mapping.evidenceTier,
      evidenceRefs: RADIAL_EVIDENCE,
      provenanceClass:
        mapping.evidenceTier === 'custom_project_supported'
          ? 'custom_project_supported'
          : 'fan_documented_plausible',
      warningScoped: true,
    });
  }

  return results;
}

/**
 * @param {object} seal
 * @param {object[]} diagnostics
 * @param {object[]} effects
 */
function evaluateCrosshairCenterGroup(seal, diagnostics, effects) {
  const crosshairSigns = activeSignInstances(seal, 'sign.crosshair');
  if (crosshairSigns.length === 0) return null;

  const crosshair = crosshairSigns[0];
  const centerGroup = seal.geometryAnalysis?.centerGroup;
  const invalidReasons = [];

  if (!centerGroup?.centerSigilId) invalidReasons.push('missing_center_group');
  if (!centerGroup?.centerRegistryId) invalidReasons.push('missing_center_sigil');

  const modifier = findCrosshairModifier(seal, effects);
  if (!modifier) invalidReasons.push('missing_modifier');

  if (invalidReasons.length > 0) {
    diagnostics.push(
      makeCompileDiagnostic({
        code: 'invalid_structure_for_symbol',
        status: 'invalid_structure',
        sourcePath: crosshair.provenance?.sourcePath ?? '',
        normalizedObjectId: crosshair.objectId,
        message: `Crosshair requires center group and valid modifier (${invalidReasons.join(', ')})`,
        fallback: 'invalid_structure',
        provenance: { invalidReasons, evidenceRefs: CROSSHAIR_EVIDENCE },
      }),
    );
    return null;
  }

  if (
    modifier.kind === 'radial_weak_domain' &&
    modifier.radialObjectIds?.length !== REQUIRED_RADIAL_POINT_AT_COUNT
  ) {
    diagnostics.push(
      makeCompileDiagnostic({
        code: 'rules.radial_invalid_count',
        status: 'invalid_structure',
        sourcePath: crosshair.provenance?.sourcePath ?? '',
        normalizedObjectId: crosshair.objectId,
        message:
          'Crosshair modifier from radial-weakened sigil requires exactly 2 radial signs on modifier sigil',
        fallback: 'invalid_structure',
      }),
    );
    return null;
  }

  diagnostics.push(
    makeCompileDiagnostic({
      code: 'rules.compiled_with_warnings',
      status: 'compiled_with_warnings',
      sourcePath: crosshair.provenance?.sourcePath ?? '',
      normalizedObjectId: crosshair.objectId,
      message: 'Custom-supported Crosshair applies outer modifier to center sigil group',
      fallback: 'compiled_with_warnings',
      evidenceTier: 'custom_project_supported',
      provenance: { customSupported: true, evidenceRefs: CROSSHAIR_EVIDENCE },
    }),
  );

  const innerEffect = buildCenterGroupTarget(seal, centerGroup, effects);

  const mergedModifier = mergeModifierAffixes(seal, modifier);

  return {
    ruleId: 'RULE_CUSTOM_CROSSHAIR_CENTER_GROUP',
    kind: 'crosshair_center_group',
    crosshairObjectId: crosshair.objectId,
    centerGroup,
    innerTarget: innerEffect,
    modifierEffect: mergedModifier,
    modifierWeakEffect:
      mergedModifier.weakEffect ??
      mergedModifier.intensityKind ??
      mergedModifier.domainRegistryId,
    evidenceTier: 'custom_project_supported',
    evidenceRefs: CROSSHAIR_EVIDENCE,
    provenanceClass: 'custom_project_supported',
    warningScoped: true,
  };
}

/**
 * @param {object} seal
 * @param {object} centerGroup
 * @param {object[]} effects
 */
function buildCenterGroupTarget(seal, centerGroup, effects) {
  const watershot = effects.find(
    (e) =>
      e.kind === 'operator_result' &&
      e.operatorFamily === 'field_emit' &&
      e.signRegistryId === 'sign.column' &&
      e.domainRegistryId === 'sigil.water',
  );
  if (watershot && centerGroup.centerRegistryId === 'sigil.water') {
    return {
      kind: 'operator_field_emit',
      domainRegistryId: 'sigil.water',
      signRegistryId: 'sign.column',
      targetKind: 'center_group',
      centerSigilId: centerGroup.centerSigilId,
    };
  }

  if (centerGroup.hasColumn && centerGroup.centerRegistryId === 'sigil.water') {
    return {
      kind: 'operator_field_emit',
      domainRegistryId: 'sigil.water',
      signRegistryId: 'sign.column',
      targetKind: 'center_group',
      centerSigilId: centerGroup.centerSigilId,
    };
  }

  return {
    kind: 'center_group_domain',
    domainRegistryId: centerGroup.centerRegistryId,
    targetKind: 'center_group',
    centerSigilId: centerGroup.centerSigilId,
  };
}

/**
 * Modifier sigil effect: raw domain or radial-weakened transform on a non-center sigil.
 *
 * @param {object} seal
 * @param {object[]} effects
 */
function findCrosshairModifier(seal, effects) {
  const centerId = seal.geometryAnalysis?.centerGroup?.centerSigilId;
  const affixBySigil = seal.geometryAnalysis?.modifierAffixes?.bySigilId ?? {};
  const modifierSigils = listModifierSigils(seal).filter((s) => s.objectId !== centerId);

  for (const sigil of modifierSigils) {
    const affix = affixBySigil[sigil.objectId];
    if (affix?.hasCool) {
      const coolModifier = {
        kind: 'crosshair_cool_modifier',
        domainRegistryId: sigil.resolvedRegistryId,
        domainSigilObjectId: sigil.objectId,
        weakEffect: 'cool',
        coolSignIds: [...affix.coolSignIds],
        signRegistryId: 'sign.cool',
        sourceObjects: [
          { objectId: sigil.objectId, registryId: sigil.resolvedRegistryId },
          ...affix.coolSignIds.map((id) => ({ objectId: id, registryId: 'sign.cool' })),
        ],
        evidenceTier: 'fan_documented_plausible',
        evidenceRefs: CROSSHAIR_COOL_EVIDENCE,
        provenanceClass: 'fan_documented_plausible',
        warningScoped: true,
      };
      return mergeModifierAffixes(seal, coolModifier);
    }
  }

  const radialEffects = effects.filter(
    (e) => e.kind === 'operator_result' && e.operatorFamily === 'weaken_modifier_source',
  );
  const offCenter = radialEffects.filter(
    (e) => e.domainSigilObjectId && e.domainSigilObjectId !== centerId,
  );
  const paired = offCenter.filter(
    (e) => e.radialObjectIds?.length === REQUIRED_RADIAL_POINT_AT_COUNT,
  );

  const mergedPaired = paired.map((e) => mergeModifierAffixes(seal, e));
  const heatPair = mergedPaired
    .filter((e) => e.domainRegistryId === 'sigil.fire' && e.weakEffect === 'heat')
    .sort((a, b) => Number(b.strengthenApplied === true) - Number(a.strengthenApplied === true))[0];
  if (heatPair) return heatPair;
  if (mergedPaired.length > 0) {
    return [...mergedPaired].sort(
      (a, b) => Number(b.strengthenApplied === true) - Number(a.strengthenApplied === true),
    )[0];
  }
  if (offCenter.length > 0) {
    const mergedOffCenter = offCenter.map((e) => mergeModifierAffixes(seal, e));
    return mergedOffCenter.sort(
      (a, b) => Number(b.strengthenApplied === true) - Number(a.strengthenApplied === true),
    )[0];
  }

  for (const radial of radialEffects) {
    if (radial.domainRegistryId === 'sigil.fire' && radial.weakEffect === 'heat') {
      return mergeModifierAffixes(seal, radial);
    }
  }

  return null;
}

/**
 * @param {object} seal
 * @param {object} modifier
 */
function mergeModifierAffixes(seal, modifier) {
  const sigilId = modifier.domainSigilObjectId;
  if (!sigilId) {
    return { ...modifier, intensityTier: 'base', strengthenApplied: false };
  }
  const affix = seal.geometryAnalysis?.modifierAffixes?.bySigilId?.[sigilId];
  if (!affix?.hasStrengthen) {
    return { ...modifier, intensityTier: 'base', strengthenApplied: false };
  }
  return applyStrengthenIntensity(modifier, affix);
}

/**
 * @param {object} modifier
 * @param {object} affix
 */
function applyStrengthenIntensity(modifier, affix) {
  const base = {
    ...modifier,
    intensityTier: 'strengthened',
    strengthenApplied: true,
    strengthenSignIds: [...affix.strengthenSignIds],
    strengthenWeight: affix.strengthenWeight,
    evidenceRefs: [...(modifier.evidenceRefs ?? []), ...STRENGTHEN_EVIDENCE],
  };

  if (modifier.weakEffect === 'cool' || modifier.kind === 'crosshair_cool_modifier') {
    return {
      ...base,
      weakEffect: 'cool',
      intensityKind: 'retained_cooling',
      transformKind: 'strengthen_retains_cooling',
    };
  }
  if (modifier.weakEffect === 'heat') {
    return { ...base, intensityKind: 'retained_heat', transformKind: 'strengthen_retains_heat' };
  }
  if (['mist', 'dust', 'glow'].includes(modifier.weakEffect ?? '')) {
    return { ...base, intensityKind: 'increased_quantity' };
  }
  if (modifier.domainRegistryId === 'sigil.fire') {
    return { ...base, weakEffect: modifier.weakEffect ?? 'heat', intensityKind: 'hotter' };
  }
  if (
    modifier.domainRegistryId === 'sigil.water' ||
    modifier.domainRegistryId === 'sigil.wind'
  ) {
    return { ...base, intensityKind: 'increased_quantity' };
  }
  return { ...base, intensityKind: 'increased_effect' };
}

/**
 * @param {object} seal
 */
function listModifierSigils(seal) {
  return (seal.symbols ?? []).filter(
    (s) =>
      s.categoryHint === 'sigil' &&
      s.resolvedRegistryId &&
      canContributeSemantics(s) &&
      (s.objectId.startsWith('sigil:') || s.objectId.startsWith('sigil-instance:')),
  );
}

/**
 * @param {object} seal
 * @param {object[]} effects
 * @param {object[]} diagnostics
 */
function maybeFireColumnUnsupported(seal, effects, diagnostics) {
  if (!findSigil(seal, 'sigil.fire')) return;
  if (activeSignInstances(seal, 'sign.column').length === 0) return;
  if (
    effects.some(
        (e) =>
        (e.kind === 'operator_result' &&
          (e.operatorFamily === 'field_emit' ||
            e.operatorFamily === 'field_attract' ||
            e.operatorFamily === 'scope_boundary')) ||
        e.kind === 'sign_crush' ||
        e.kind === 'standalone_cool',
    )
  ) {
    return;
  }
  const col = activeSignInstances(seal, 'sign.column')[0];
  diagnostics.push(
    makeCompileDiagnostic({
      code: 'invalid_symbol_pairing',
      status: 'nonsensical_combination',
      sourcePath: col?.provenance?.sourcePath ?? '',
      normalizedObjectId: col?.objectId ?? null,
      message:
        'Fire domain with column sign has no supported prototype template; effect is not coerced',
      fallback: 'no_active_effect',
    }),
  );
}

/**
 * @param {object} program
 * @param {object[]} sealResults
 */
function collectUnsupportedPairings(program, sealResults) {
  const diagnostics = [];
  const activeDomains = new Set();

  for (const seal of program.seals ?? []) {
    for (const sigil of seal.symbols ?? []) {
      if (
        sigil.categoryHint === 'sigil' &&
        sigil.resolvedRegistryId &&
        canContributeSemantics(sigil)
      ) {
        activeDomains.add(sigil.resolvedRegistryId);
      }
    }
  }

  if (activeDomains.has('sigil.fire') && activeDomains.has('sigil.water')) {
    const hasWatershot = sealResults.some((sr) =>
      sr.effects.some(
        (e) =>
          e.kind === 'operator_result' &&
          e.operatorFamily === 'field_emit' &&
          e.signRegistryId === 'sign.column' &&
          e.domainRegistryId === 'sigil.water',
      ),
    );
    const hasCrosshair = sealResults.some((sr) =>
      sr.effects.some(
        (e) =>
          e.kind === 'operator_result' &&
          (e.operatorFamily === 'scope_filter' || e.signRegistryId === 'sign.crosshair'),
      ),
    );
    if (hasWatershot || hasCrosshair) {
      diagnostics.push(
        makeCompileDiagnostic({
          code: 'rules.speculative_disabled',
          status: 'speculative_disabled',
          sourcePath: '/seals/0',
          normalizedObjectId: null,
          message:
            'Fire and water domains present; steam/vaporization transforms are not created',
          fallback: 'speculative_disabled',
          provenance: { evidenceRefs: ['REJECT_STEAM_HEAT_WATER'] },
        }),
      );
    }
  }

  for (const seal of program.seals ?? []) {
    for (const symbol of seal.symbols ?? []) {
      if (
        symbol.semanticEligibility === 'visual_only' ||
        symbol.semanticEligibility === 'unresolved' ||
        !symbol.resolvedRegistryId
      ) {
        continue;
      }
      if (symbol.semanticEligibility === 'diagnostic_only') {
        if (isCatalogDeferredSign(symbol.resolvedRegistryId)) {
          continue;
        }
        diagnostics.push(
          makeCompileDiagnostic({
            code: 'rules.unsupported_combination',
            status: 'visual_only',
            sourcePath: symbol.provenance?.sourcePath ?? '',
            normalizedObjectId: symbol.objectId,
            message: 'Ignored unofficial sign cannot produce active effect graph nodes',
            fallback: 'visual_only',
          }),
        );
      }
    }
  }

  return diagnostics;
}

/**
 * @param {object} seal
 * @param {string} registryId
 */
function findSigil(seal, registryId) {
  return (seal.symbols ?? []).find(
    (s) =>
      s.categoryHint === 'sigil' &&
      s.resolvedRegistryId === registryId &&
      canContributeSemantics(s),
  );
}

const PROTOTYPE_DOMAIN_SIGILS = new Set([
  'sigil.water',
  'sigil.fire',
  'sigil.earth',
  'sigil.wind',
  'sigil.light',
]);

/**
 * @param {object} seal
 * @param {string} signId
 */
function activeSignInstances(seal, signId) {
  return (seal.symbols ?? []).filter(
    (s) =>
      s.categoryHint === 'sign' &&
      s.objectId?.startsWith('sign-instance:') &&
      s.resolvedRegistryId === signId &&
      canContributeSemantics(s),
  );
}
