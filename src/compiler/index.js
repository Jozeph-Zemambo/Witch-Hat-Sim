/** @typedef {'direct_json'} SpellSourceKind */

/**
 * Minimal compiler-core entry surface for later pipeline modules.
 */
import { COMPILER_CORE_VERSION } from './constants.js';

export { COMPILER_CORE_VERSION } from './constants.js';

import { importSpell } from './importer.js';
import { resolveSymbol, resolveProgramRegistry, getSignOperatorDefinition } from './registry.js';
import { analyzeSpellGeometry } from './geometry.js';
import {
  compileSpell,
  compile,
  compileToJson,
  stableCompilePayload,
  COMPILER_COMPILE_VERSION,
} from './compile.js';

export {
  decodeSpellShareLink,
  importSpellFromShareLink,
  importSpellFromJson,
  importSpell,
  IMPORTER_VERSION,
} from './importer.js';

export {
  SPELL_MAKER_DEFAULTS,
  toSpellMakerJson,
  fromSpellMakerJson,
  convertSpellJson,
} from './spell-maker-converter.js';

export {
  resolveSymbol,
  resolveProgramRegistry,
  lookupRegistry,
  getSignOperatorDefinition,
  PROTOTYPE_SIGIL_IDS,
  PROTOTYPE_SIGN_IDS,
} from './registry.js';

export { analyzeSpellGeometry, analyzeGeometry } from './geometry.js';

export {
  compileSpell,
  compile,
  compileToJson,
  stableCompilePayload,
  COMPILER_COMPILE_VERSION,
} from './compile.js';

export { evaluateRules, flattenRuleEvaluation } from './rules.js';
export { buildEffectGraph } from './effect-graph.js';
export { phaseFromSpecificEnergy, stepSpecificEnergy } from './material-state.js';

/**
 * Registry resolution followed by geometry/vector analysis.
 *
 * @param {unknown} input
 * @param {object} [importOptions]
 */
export function analyzeProgram(input, importOptions) {
  const program = importSpell(input, importOptions);
  resolveProgramRegistry(program);
  analyzeSpellGeometry(program);
  return program;
}

/**
 * @returns {{ version: string; ready: true; importSpell: typeof importSpell; resolveSymbol: typeof resolveSymbol; resolveProgramRegistry: typeof resolveProgramRegistry; getSignOperatorDefinition: typeof getSignOperatorDefinition; analyzeSpellGeometry: typeof analyzeSpellGeometry; analyzeProgram: typeof analyzeProgram; compileSpell: typeof compileSpell }}
 */
export function createCompilerCore() {
  return {
    version: COMPILER_CORE_VERSION,
    ready: true,
    importSpell,
    resolveSymbol,
    resolveProgramRegistry,
    getSignOperatorDefinition,
    analyzeSpellGeometry,
    analyzeGeometry: analyzeSpellGeometry,
    analyzeProgram,
    compileSpell,
  };
}
