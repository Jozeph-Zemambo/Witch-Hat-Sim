/**
 * Full compile pipeline: import → registry → geometry → rules → effect graph.
 */

import { importSpell } from './importer.js';
import { resolveProgramRegistry } from './registry.js';
import { analyzeSpellGeometry } from './geometry.js';
import { evaluateRules, flattenRuleEvaluation } from './rules.js';
import { buildEffectGraph } from './effect-graph.js';
import { COMPILER_CORE_VERSION } from './constants.js';
import { sortCompileDiagnostics } from './diagnostics.js';

export const COMPILER_COMPILE_VERSION = '0.1.0';

/**
 * Normalize diagnostic objects for stable JSON schema (VAL-GRAPH-004).
 *
 * @param {object} d
 */
function normalizeDiagnostic(d) {
  const id =
    d.id ??
    `diag:${d.code ?? 'unknown'}:${d.sourcePath ?? ''}:${d.normalizedObjectId ?? d.objectId ?? ''}`;
  return {
    id,
    code: d.code ?? 'unknown',
    status: d.status ?? d.severity ?? 'unknown',
    severity: d.severity ?? d.status ?? 'unknown',
    sourcePath: d.sourcePath ?? '',
    objectId: d.objectId ?? d.normalizedObjectId ?? null,
    normalizedObjectId: d.normalizedObjectId ?? d.objectId ?? null,
    evidence: d.evidence ?? d.evidenceTier ?? null,
    provenance: d.provenance ?? null,
    message: d.message ?? '',
    fallback: d.fallback ?? d.conservativeFallback ?? null,
    conservativeFallback: d.conservativeFallback ?? d.fallback ?? null,
    ...(d.registryId ? { registryId: d.registryId } : {}),
  };
}

/**
 * @param {unknown} input
 * @param {object} [importOptions]
 */
export function compileSpell(input, importOptions) {
  const program = importSpell(input, importOptions);
  resolveProgramRegistry(program);
  analyzeSpellGeometry(program);

  const evalResult = evaluateRules(program);
  const graph = buildEffectGraph(program, evalResult);
  const { diagnostics: ruleDiagnostics } = flattenRuleEvaluation(evalResult);

  const rawDiag = [
    ...(program.diagnostics ?? []).map(normalizeDiagnostic),
    ...ruleDiagnostics.map(normalizeDiagnostic),
  ];
  const diagnostics = sortCompileDiagnostics(rawDiag).map(normalizeDiagnostic);

  return {
    program,
    graph,
    diagnostics,
    metadata: {
      compilerCoreVersion: COMPILER_CORE_VERSION,
      compileModuleVersion: COMPILER_COMPILE_VERSION,
      pipeline: ['import', 'registry', 'geometry', 'rules', 'graph'],
    },
  };
}

export const compile = compileSpell;

/**
 * @param {unknown} input
 * @param {object} [importOptions]
 */
export function stableCompilePayload(input, importOptions) {
  return compileSpell(input, importOptions);
}

/**
 * @param {unknown} input
 * @param {object} [importOptions]
 */
export function compileToJson(input, importOptions) {
  return JSON.stringify(compileSpell(input, importOptions));
}
