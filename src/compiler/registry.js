/**
 * Conservative symbol registry for the compiler-core prototype.
 * Full catalog: spec/symbol-semantics.md
 */

/** @typedef {'sigil' | 'sign' | 'shape' | 'toh' | 'material' | 'subelement'} SymbolCategory */
/** @typedef {'official' | 'custom_project_supported' | 'ignored_visual' | 'unknown'} ProvenanceClass */

/**
 * @typedef {object} RegistryEntry
 * @property {string} registryId
 * @property {SymbolCategory} category
 * @property {string} displayName
 * @property {string | null} domain
 * @property {ProvenanceClass} provenanceClass
 * @property {boolean} activeInPrototype
 * @property {readonly string[]} geometryApplicability
 * @property {string} implementationStatus
 * @property {object | null} [operatorDefinition]
 */

/** Prototype-resolvable sigil IDs (VAL-REGISTRY-001). */
export const PROTOTYPE_SIGIL_IDS = [
  'sigil.water',
  'sigil.fire',
  'sigil.earth',
  'sigil.wind',
  'sigil.light',
  'sigil.repetition',
];

/** Registry-backed material state metadata for simulator-facing graph output. */
export const MATERIAL_PROFILES = Object.freeze({
  'material.water': Object.freeze({
    materialFamily: 'water',
    defaultPhase: 'liquid',
    freezePointC: 0,
    boilPointC: 100,
    specificHeatLiquidKJPerKgK: 4.18,
    specificHeatSolidKJPerKgK: 2.05,
    latentFusionKJPerKg: 333.55,
    minTempC: -80,
    maxTempC: 120,
    specificEnergyMin: 0,
    freezeSpecificEnergy: 0.33,
    boilSpecificEnergy: 0.86,
    specificEnergyMax: 1,
  }),
  'material.ice': Object.freeze({
    materialFamily: 'water',
    defaultPhase: 'solid',
    freezePointC: 0,
    boilPointC: 100,
    specificHeatLiquidKJPerKgK: 4.18,
    specificHeatSolidKJPerKgK: 2.05,
    latentFusionKJPerKg: 333.55,
    minTempC: -80,
    maxTempC: 0,
    specificEnergyMin: 0,
    freezeSpecificEnergy: 0.33,
    boilSpecificEnergy: 0.86,
    specificEnergyMax: 1,
  }),
});

/** Weak forms produced by project-supported modifier signs. */
export const SUBELEMENT_PROFILES = Object.freeze({
  'subelement.heat': Object.freeze({
    driverKind: 'temperature_driver',
    thermalEffect: 'warm',
    equilibriumTempC: 55,
    minTempC: 0,
    maxTempC: 80,
  }),
  'subelement.mist': Object.freeze({
    driverKind: 'material_form',
    materialFamily: 'water',
    requiresMaterialIntakeForCondensation: true,
  }),
  'subelement.dust': Object.freeze({
    driverKind: 'material_form',
    materialFamily: 'earth',
  }),
  'subelement.glow': Object.freeze({
    driverKind: 'luminous_modifier',
    thermalByDefault: false,
  }),
});

/** Prototype-resolvable sign IDs (VAL-REGISTRY-002). */
export const PROTOTYPE_SIGN_IDS = [
  'sign.column',
  'sign.levitation',
  'sign.radial',
  'sign.crosshair',
  'sign.cool',
  'sign.crush',
  'sign.strengthen',
];

/** @type {Readonly<Record<string, object>>} */
const SIGN_OPERATOR_DEFINITIONS = Object.freeze({
  'sign.column': Object.freeze({
    operatorFamily: 'field_emit',
    confidence: 'fan_documented_plausible',
    defaultAnchor: 'center_group',
    defaultLookAt: 'center',
    polarity: 'push_through_center',
    verticalGain: 1,
    lateralGain: 0.35,
    tangentialGain: 0,
    spreadGain: 0.08,
    orientationProbe: 'short_line_outward',
  }),
  'sign.radial': Object.freeze({
    operatorFamily: 'weaken_modifier_source',
    confidence: 'custom_project_supported',
    defaultAnchor: 'pointed_at_sigil',
    polarity: 'weaken_domain',
    exactCount: 2,
    projectWeakForms: Object.freeze({
      'sigil.fire': 'heat',
      'sigil.water': 'mist',
      'sigil.earth': 'dust',
      'sigil.light': 'glow',
    }),
  }),
  'sign.crosshair': Object.freeze({
    operatorFamily: 'scope_filter',
    confidence: 'custom_project_supported',
    defaultAnchor: 'center_group',
    defaultLookAt: 'center',
    polarity: 'modifier_to_center_group',
    targetKind: 'center_group',
  }),
  'sign.dispersion': Object.freeze({
    operatorFamily: 'field_emit',
    confidence: 'fan_documented_plausible',
    defaultAnchor: 'center_group',
    defaultLookAt: 'center',
    polarity: 'emit_outward_leak',
    verticalGain: 0.35,
    lateralGain: 0.6,
    tangentialGain: 0,
    spreadGain: 0.85,
    orientationProbe: 'short_line_outward',
  }),
  'sign.levitation': Object.freeze({
    operatorFamily: 'lift_motion',
    confidence: 'fan_documented_plausible',
    defaultAnchor: 'attached_object_or_center_group',
    defaultLookAt: 'center',
    polarity: 'lift_and_translate',
    verticalGain: 1,
    lateralGain: 0.4,
    tangentialGain: 0.65,
    spreadGain: 0,
    orientationProbe: 'arrow_tip_inward',
  }),
  'sign.pull': Object.freeze({
    operatorFamily: 'field_attract',
    confidence: 'fan_documented_plausible',
    defaultAnchor: 'center_group',
    defaultLookAt: 'center',
    polarity: 'pull_inward',
    verticalGain: 0,
    lateralGain: 1,
    tangentialGain: 0.5,
    spreadGain: 0,
    orientationProbe: 'arrow_tip_inward',
  }),
  'sign.region': Object.freeze({
    operatorFamily: 'scope_boundary',
    confidence: 'fan_documented_plausible',
    defaultAnchor: 'ring',
    defaultLookAt: 'center',
    polarity: 'boundary_scope',
    regionFilter: 'on_ring',
  }),
  'sign.convergence': Object.freeze({
    operatorFamily: 'field_focus',
    confidence: 'fan_documented_plausible',
    defaultAnchor: 'center_group',
    defaultLookAt: 'center',
    polarity: 'point_focus',
    focusGain: 1,
    rigidityGain: 0.5,
    orientationProbe: 'triangle_point_inward',
  }),
  'sign.collection': Object.freeze({
    operatorFamily: 'material_intake',
    confidence: 'fan_documented_plausible',
    defaultAnchor: 'center_group',
    polarity: 'collect_nearby',
    sourceMode: 'collect_nearby',
    passiveRadius: 'prototype_default',
    activePull: 0,
    requiresAmbientSource: true,
  }),
  'sign.gather': Object.freeze({
    operatorFamily: 'material_intake',
    confidence: 'fan_documented_plausible',
    defaultAnchor: 'center_group',
    polarity: 'gather_active',
    sourceMode: 'gather_active',
    passiveRadius: 'prototype_default',
    activePull: 0.5,
    requiresAmbientSource: true,
  }),
  'sign.float': Object.freeze({
    operatorFamily: 'gravity_override',
    confidence: 'deprecated_or_variant_symbol',
    defaultAnchor: 'attached_object',
    defaultLookAt: 'none',
    polarity: 'gravity_override',
    verticalGain: 1,
    lateralGain: 0,
    spreadGain: 0,
    diagnosticOnly: true,
  }),
});

/**
 * Additive operator metadata used by the reworked compiler path.
 *
 * @param {string | null | undefined} registryId
 */
export function getSignOperatorDefinition(registryId) {
  const id = typeof registryId === 'string' ? registryId.trim() : '';
  const def = SIGN_OPERATOR_DEFINITIONS[id];
  return def ? cloneOperatorDefinition(def) : null;
}

/**
 * @param {string} registryId
 */
function signOperatorDefinition(registryId) {
  return getSignOperatorDefinition(registryId);
}

/**
 * @param {object} def
 */
function cloneOperatorDefinition(def) {
  return JSON.parse(JSON.stringify(def));
}

/** @type {ReadonlyMap<string, RegistryEntry>} */
const CATALOG = new Map([
  [
    'sigil.water',
    entry('sigil.water', 'sigil', 'Water', 'water', 'fan_documented_plausible', [
      'place',
    ]),
  ],
  [
    'sigil.fire',
    entry('sigil.fire', 'sigil', 'Fire', 'fire_heat', 'fan_documented_plausible', [
      'place',
    ]),
  ],
  [
    'sigil.earth',
    entry('sigil.earth', 'sigil', 'Earth', 'earth_solid', 'fan_documented_plausible', [
      'place',
    ]),
  ],
  [
    'sigil.wind',
    entry('sigil.wind', 'sigil', 'Wind', 'wind_air', 'fan_documented_plausible', [
      'place',
    ]),
  ],
  [
    'sigil.light',
    entry('sigil.light', 'sigil', 'Light', 'light', 'fan_documented_plausible', [
      'place',
    ]),
  ],
  [
    'sigil.repetition',
    entry(
      'sigil.repetition',
      'sigil',
      'Repetition',
      'repeat',
      'fan_documented_plausible',
      ['repeat', 'sym', 'nested'],
      {
        implementationStatus:
          'registry alias target for retconned sign.repetition; no active repetition operator yet',
      },
    ),
  ],
  [
    'material.water',
    entry('material.water', 'material', 'Water Material', 'water', 'fan_documented_plausible', [], {
      materialProfile: MATERIAL_PROFILES['material.water'],
      implementationStatus: 'material profile for phase-state graph output',
    }),
  ],
  [
    'material.ice',
    entry('material.ice', 'material', 'Ice Material', 'water', 'fan_documented_plausible', [], {
      materialProfile: MATERIAL_PROFILES['material.ice'],
      implementationStatus: 'material preset for solid water phase-state graph output',
    }),
  ],
  [
    'subelement.heat',
    entry('subelement.heat', 'subelement', 'Heat', 'fire_heat', 'fan_documented_plausible', [], {
      subelementProfile: SUBELEMENT_PROFILES['subelement.heat'],
      implementationStatus: 'bounded temperature driver weak form',
    }),
  ],
  [
    'subelement.mist',
    entry('subelement.mist', 'subelement', 'Mist', 'water', 'custom_project_supported', [], {
      subelementProfile: SUBELEMENT_PROFILES['subelement.mist'],
      implementationStatus: 'weak material form; condensation requires material intake',
    }),
  ],
  [
    'subelement.dust',
    entry('subelement.dust', 'subelement', 'Dust', 'earth_solid', 'custom_project_supported', [], {
      subelementProfile: SUBELEMENT_PROFILES['subelement.dust'],
      implementationStatus: 'weak material form',
    }),
  ],
  [
    'subelement.glow',
    entry('subelement.glow', 'subelement', 'Glow', 'light', 'custom_project_supported', [], {
      subelementProfile: SUBELEMENT_PROFILES['subelement.glow'],
      implementationStatus: 'luminous weak form; not thermal by default',
    }),
  ],
  [
    'sign.column',
    entry('sign.column', 'sign', 'Column', null, 'fan_documented_plausible', [
      'rot',
      'scale',
      'radius',
      'place',
      'line',
      'sym',
      'nested',
    ], {
      operatorDefinition: signOperatorDefinition('sign.column'),
    }),
  ],
  [
    'sign.levitation',
    entry('sign.levitation', 'sign', 'Levitation', null, 'fan_documented_plausible', [
      'rot',
      'scale',
      'radius',
      'place',
      'sym',
      'nested',
    ], {
      operatorDefinition: signOperatorDefinition('sign.levitation'),
    }),
  ],
  [
    'sign.radial',
    entry(
      'sign.radial',
      'sign',
      'Radial',
      null,
      'custom_project_supported',
      ['place', 'line', 'nested', 'sym'],
      {
        operatorDefinition: signOperatorDefinition('sign.radial'),
      },
    ),
  ],
  [
    'sign.crosshair',
    entry(
      'sign.crosshair',
      'sign',
      'Crosshair',
      null,
      'custom_project_supported',
      ['place', 'line', 'nested'],
      {
        operatorDefinition: signOperatorDefinition('sign.crosshair'),
      },
    ),
  ],
  [
    'sign.cool',
    entry('sign.cool', 'sign', 'Cool', null, 'fan_documented_plausible', [
      'scale',
      'place',
      'sym',
      'nested',
    ]),
  ],
  [
    'sign.crush',
    entry('sign.crush', 'sign', 'Crush', null, 'fan_documented_plausible', [
      'rot',
      'scale',
      'place',
      'line',
      'sym',
      'nested',
    ]),
  ],
  [
    'sign.strengthen',
    entry('sign.strengthen', 'sign', 'Strengthen', null, 'fan_documented_plausible', [
      'scale',
      'place',
      'line',
      'sym',
      'nested',
    ]),
  ],
  [
    'sign.collection',
    entry('sign.collection', 'sign', 'Collection', null, 'fan_documented_plausible', [
      'rot',
      'scale',
      'radius',
      'place',
      'sym',
    ], {
      operatorDefinition: signOperatorDefinition('sign.collection'),
    }),
  ],
  [
    'sign.gather',
    entry('sign.gather', 'sign', 'Gather', null, 'fan_documented_plausible', [
      'rot',
      'scale',
      'radius',
      'place',
      'sym',
    ], {
      operatorDefinition: signOperatorDefinition('sign.gather'),
    }),
  ],
  [
    'sign.convergence',
    entry('sign.convergence', 'sign', 'Convergence', null, 'fan_documented_plausible', [
      'rot',
      'scale',
      'radius',
      'place',
      'sym',
    ], {
      operatorDefinition: signOperatorDefinition('sign.convergence'),
    }),
  ],
  [
    'sign.pull',
    entry('sign.pull', 'sign', 'Pull', null, 'fan_documented_plausible', [
      'rot',
      'scale',
      'radius',
      'place',
      'sym',
      'nested',
    ], {
      operatorDefinition: signOperatorDefinition('sign.pull'),
    }),
  ],
  [
    'sign.region',
    entry('sign.region', 'sign', 'Region', null, 'fan_documented_plausible', [
      'rot',
      'scale',
      'radius',
      'place',
      'sym',
      'nested',
    ], {
      operatorDefinition: signOperatorDefinition('sign.region'),
    }),
  ],
  [
    'sign.dispersion',
    entry('sign.dispersion', 'sign', 'Dispersion', null, 'fan_documented_plausible', [
      'rot',
      'scale',
      'radius',
      'place',
      'sym',
      'nested',
    ], {
      operatorDefinition: signOperatorDefinition('sign.dispersion'),
    }),
  ],
  [
    'sign.float',
    deferredEntry('sign.float', 'Float', ['rot', 'scale', 'place', 'sym', 'nested'], {
      operatorDefinition: signOperatorDefinition('sign.float'),
    }),
  ],
  [
    'sign.billow',
    deferredEntry('sign.billow', 'Billow', ['rot', 'scale', 'place', 'sym']),
  ],
  [
    'sign.weave',
    deferredEntry('sign.weave', 'Weave', ['rot', 'scale', 'line', 'sym', 'nested']),
  ],
  [
    'sign.entwine',
    deferredEntry('sign.entwine', 'Entwine', ['rot', 'scale', 'line', 'sym', 'nested']),
  ],
  [
    'sign.sign_of_wind',
    deferredEntry('sign.sign_of_wind', 'Sign of Wind', [
      'rot',
      'scale',
      'place',
      'line',
      'sym',
      'nested',
    ]),
  ],
  [
    'sign.aeriforms_defined',
    deferredEntry('sign.aeriforms_defined', 'Aeriforms Defined', [
      'place',
      'line',
      'nested',
    ]),
  ],
  [
    'sign.glaives',
    deferredEntry('sign.glaives', 'Glaives', ['rot', 'scale', 'radius', 'place', 'sym']),
  ],
  [
    'sign.sights_set',
    deferredEntry('sign.sights_set', 'Sights Set', [
      'rot',
      'scale',
      'radius',
      'place',
      'line',
      'nested',
    ]),
  ],
  [
    'sign.repetition',
    deferredEntry('sign.repetition', 'Repetition', [
      'rot',
      'scale',
      'radius',
      'place',
      'line',
      'repeat',
      'sym',
      'nested',
    ], {
      aliasOf: 'sigil.repetition',
      implementationStatus:
        'legacy sign alias for retconned sigil.repetition; diagnostic-only until repetition semantics are designed',
    }),
  ],
]);

/** Official signs in catalog with import/rules diagnostics only (M5 ambiguous catalog). */
export const CATALOG_DEFERRED_SIGN_IDS = [
  'sign.float',
  'sign.billow',
  'sign.weave',
  'sign.entwine',
  'sign.sign_of_wind',
  'sign.aeriforms_defined',
  'sign.glaives',
  'sign.sights_set',
  'sign.repetition',
];

/**
 * @param {string | null | undefined} registryId
 */
export function isCatalogDeferredSign(registryId) {
  const entry = CATALOG.get(typeof registryId === 'string' ? registryId.trim() : '');
  return entry?.category === 'sign' && entry.activeInPrototype === false;
}

/**
 * @param {string} registryId
 * @param {SymbolCategory} category
 * @param {string} displayName
 * @param {string | null} domain
 * @param {string} tier
 * @param {readonly string[]} geometryApplicability
 * @param {{ activeInPrototype?: boolean; implementationStatus?: string; operatorDefinition?: object | null; [key: string]: any }} [options]
 * @returns {RegistryEntry}
 */
function entry(
  registryId,
  category,
  displayName,
  domain,
  tier,
  geometryApplicability,
  options = {},
) {
  const provenanceClass =
    tier === 'custom_project_supported'
      ? 'custom_project_supported'
      : /** @type {ProvenanceClass} */ ('official');
  const activeInPrototype = options.activeInPrototype ?? true;
  return {
    registryId,
    category,
    displayName,
    domain,
    provenanceClass,
    activeInPrototype,
    geometryApplicability,
    implementationStatus:
      options.implementationStatus ??
      (provenanceClass === 'custom_project_supported'
        ? 'custom-supported active in narrow templates'
        : activeInPrototype
          ? 'active in narrow templates with warning'
          : 'catalog diagnostic-only until dossier template'),
    ...(options.operatorDefinition ? { operatorDefinition: options.operatorDefinition } : {}),
    ...(options.aliasOf ? { aliasOf: options.aliasOf } : {}),
    ...(options.materialProfile ? { materialProfile: options.materialProfile } : {}),
    ...(options.subelementProfile ? { subelementProfile: options.subelementProfile } : {}),
  };
}

/**
 * @param {string} registryId
 * @param {string} displayName
 * @param {readonly string[]} geometryApplicability
 * @returns {RegistryEntry}
 */
function deferredEntry(registryId, displayName, geometryApplicability, options = {}) {
  return entry(registryId, 'sign', displayName, null, 'fan_documented_plausible', geometryApplicability, {
    activeInPrototype: false,
    implementationStatus: 'catalog diagnostic-only until dossier template',
    ...options,
  });
}

/**
 * Resolve a stable registry ID to prototype catalog metadata.
 * Unknown IDs return diagnostics only — no partial active entry.
 *
 * @param {string | null | undefined} registryId
 */
export function resolveSymbol(registryId) {
  const id = typeof registryId === 'string' ? registryId.trim() : '';
  if (!id) {
    return unresolvedResult(id || null, 'missing_registry_id');
  }

  const catalogEntry = CATALOG.get(id);
  if (catalogEntry) {
    return {
      resolved: true,
      registryId: id,
      entry: { ...catalogEntry },
      diagnostic: null,
    };
  }

  return unresolvedResult(id, 'unsupported_symbol');
}

/**
 * @param {string | null} registryId
 * @param {string} reason
 */
function unresolvedResult(registryCandidate, reason) {
  return {
    resolved: false,
    registryId: null,
    registryCandidate,
    entry: null,
    diagnostic: {
      code: 'registry.unsupported_symbol',
      status: 'unsupported_symbol',
      registryCandidate,
      reason,
      message: registryCandidate
        ? `Unknown registry ID "${registryCandidate}" has no catalog entry; no active semantics`
        : 'Missing registry ID; no active semantics',
      conservativeFallback: 'unsupported_symbol',
    },
  };
}

/**
 * Attach registry resolution to every symbol on a SpellProgram.
 * Unknown symbols never receive a partial active registry entry.
 *
 * @param {object} program
 */
export function resolveProgramRegistry(program) {
  const resolutions = [];
  const diagnostics = [...(program.diagnostics ?? [])];

  for (const seal of program.seals ?? []) {
    for (const symbol of seal.symbols ?? []) {
      const registryId = symbol.resolvedRegistryId;
      const resolution = resolveSymbol(registryId);
      const record = {
        objectId: symbol.objectId,
        registryId,
        resolved: resolution.resolved,
        entry: resolution.entry,
        provenanceClass: resolution.entry?.provenanceClass ?? null,
        domain: resolution.entry?.domain ?? null,
      };
      symbol.registryResolution = record;

      if (!resolution.resolved && registryId) {
        diagnostics.push({
          code: 'registry.unresolved_symbol',
          status: 'unsupported_symbol',
          sourcePath: symbol.provenance?.sourcePath ?? '',
          normalizedObjectId: symbol.objectId,
          registryId: resolution.registryCandidate ?? registryId,
          registryLookup: 'unresolved',
          conservativeFallback: 'unsupported_symbol',
          message: resolution.diagnostic?.message ?? 'Unknown registry ID',
          provenance: {
            sourceKind: program.source?.kind ?? 'direct_json',
            sourcePath: symbol.provenance?.sourcePath ?? '',
          },
        });
        symbol.registryResolution.activeEntry = null;
      } else if (resolution.resolved) {
        symbol.registryResolution.activeEntry = { ...resolution.entry };
      }

      resolutions.push(record);
    }
  }

  program.registryResolutions = resolutions;
  program.diagnostics = sortRegistryDiagnostics(diagnostics);
  return program;
}

/**
 * @param {object[]} diagnostics
 */
function sortRegistryDiagnostics(diagnostics) {
  const precedence = {
    'import.radial_malformed': 0,
    'import.unresolved_symbol': 1,
    'registry.unresolved_symbol': 2,
    'import.custom_supported_unofficial_sign': 3,
    'import.unsupported_symbol': 4,
  };
  return [...diagnostics].sort((a, b) => {
    const pa = precedence[a.code] ?? 99;
    const pb = precedence[b.code] ?? 99;
    if (pa !== pb) return pa - pb;
    return String(a.sourcePath ?? '').localeCompare(String(b.sourcePath ?? ''));
  });
}

/** @type {ReadonlyMap<string, { registryId: string; category: string; official: boolean; customSupported?: boolean }>} */
const SIGIL_BY_TOKEN = new Map(
  ['water', 'fire', 'earth', 'wind', 'light'].map((name) => [
    name,
    { registryId: `sigil.${name}`, category: 'sigil', official: false },
  ]),
);

const OFFICIAL_SIGN_TOKENS = new Set([
  'aeriforms_defined',
  'billow',
  'collection',
  'column',
  'convergence',
  'cool',
  'crush',
  'dispersion',
  'entwine',
  'float',
  'gather',
  'glaives',
  'levitation',
  'pull',
  'region',
  'repetition',
  'sights_set',
  'sign_of_wind',
  'strengthen',
  'weave',
]);

const IGNORED_SIGN_TOKENS = new Set([
  'bend',
  'bind',
  'bolt',
  'diamond',
  'enlarge',
  'eye',
  'link',
  'orb',
  'puppet',
  'purify',
  'rain',
  'stability',
  'vision',
  'window',
]);

const CUSTOM_SUPPORTED_SIGN_TOKENS = new Set(['crosshair', 'radial']);

/**
 * @param {string} raw
 */
function normalizeToken(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');
}

/**
 * Parse WHA Spell Maker `name` tokens (`sigil_Water`, `sign_Radial`, etc.).
 *
 * @param {string} rawName
 * @returns {{ token: string; category: 'sigil' | 'sign' | 'shape' | 'toh' | null; spellMakerPrefix: string | null }}
 */
export function parseSpellMakerName(rawName) {
  const normalized = normalizeToken(rawName);
  if (!normalized) {
    return { token: '', category: null, spellMakerPrefix: null };
  }
  if (normalized.startsWith('sigil_')) {
    return {
      token: normalized.slice(6),
      category: 'sigil',
      spellMakerPrefix: 'sigil',
    };
  }
  if (normalized.startsWith('sign_')) {
    return {
      token: normalized.slice(5),
      category: 'sign',
      spellMakerPrefix: 'sign',
    };
  }
  return { token: normalized, category: null, spellMakerPrefix: null };
}

/**
 * Import-time lookup for Spell Maker export tokens with optional prefix.
 *
 * @param {string} rawName
 * @param {'sigil' | 'sign' | 'shape' | 'toh'} [categoryHint]
 */
export function lookupRegistrySpellMaker(rawName, categoryHint) {
  const parsed = parseSpellMakerName(rawName);
  const category = parsed.category ?? categoryHint ?? 'sign';
  const normalizedFull = normalizeToken(rawName);
  if (
    (category === 'sign' || categoryHint === 'sign') &&
    OFFICIAL_SIGN_TOKENS.has(normalizedFull)
  ) {
    const registryId = `sign.${normalizedFull}`;
    return {
      registryCandidate: registryId,
      resolvedRegistryId: registryId,
      category: 'sign',
      official: true,
      customSupported: false,
      ignored: false,
    };
  }
  return lookupRegistry(parsed.token || normalizedFull, category);
}

/**
 * Import-time token lookup (broader than prototype resolveSymbol).
 *
 * @param {string} rawName
 * @param {'sigil' | 'sign' | 'shape' | 'toh'} categoryHint
 */
export function lookupRegistry(rawName, categoryHint) {
  const token = normalizeToken(rawName);
  if (!token) {
    return {
      registryCandidate: null,
      resolvedRegistryId: null,
      category: categoryHint,
      official: false,
      customSupported: false,
      ignored: false,
    };
  }

  if (categoryHint === 'sigil') {
    const row = SIGIL_BY_TOKEN.get(token);
    if (row) {
      return {
        registryCandidate: row.registryId,
        resolvedRegistryId: row.registryId,
        category: 'sigil',
        official: false,
        customSupported: false,
        ignored: false,
      };
    }
    return unresolvedLookup(token, 'sigil');
  }

  if (categoryHint === 'sign') {
    if (CUSTOM_SUPPORTED_SIGN_TOKENS.has(token)) {
      const registryId = `sign.${token}`;
      return {
        registryCandidate: registryId,
        resolvedRegistryId: registryId,
        category: 'sign',
        official: false,
        customSupported: true,
        ignored: false,
      };
    }
    if (OFFICIAL_SIGN_TOKENS.has(token)) {
      const registryId = `sign.${token}`;
      return {
        registryCandidate: registryId,
        resolvedRegistryId: registryId,
        category: 'sign',
        official: true,
        customSupported: false,
        ignored: false,
      };
    }
    if (IGNORED_SIGN_TOKENS.has(token)) {
      const registryId = `sign.${token}`;
      return {
        registryCandidate: registryId,
        resolvedRegistryId: registryId,
        category: 'sign',
        official: false,
        customSupported: false,
        ignored: true,
      };
    }
    return unresolvedLookup(token, 'sign');
  }

  return unresolvedLookup(token, categoryHint);
}

/**
 * @param {string} token
 * @param {string} category
 */
function unresolvedLookup(token, category) {
  const candidate = `${category}.${token}`;
  return {
    registryCandidate: candidate,
    resolvedRegistryId: null,
    category,
    official: false,
    customSupported: false,
    ignored: false,
  };
}
