/**
 * Stable compile-time diagnostic records (VAL-GRAPH-004).
 */

/**
 * @param {object} params
 */
export function makeCompileDiagnostic(params) {
  const {
    code,
    status,
    sourcePath = '',
    normalizedObjectId = null,
    message,
    fallback,
    provenance = {},
    evidenceTier = null,
    registryId = null,
  } = params;

  return {
    code,
    status,
    severity: status,
    sourcePath,
    normalizedObjectId,
    registryId,
    evidenceTier,
    provenance: {
      sourceKind: provenance.sourceKind ?? 'direct_json',
      sourcePath: provenance.sourcePath ?? sourcePath,
      ...provenance,
    },
    message,
    conservativeFallback: fallback,
    fallback,
  };
}

const CODE_PRECEDENCE = {
  'import.radial_malformed': 0,
  'import.unresolved_symbol': 1,
  'registry.unresolved_symbol': 2,
  'import.custom_supported_unofficial_sign': 3,
  'import.unsupported_symbol': 4,
  'invalid_structure_for_symbol': 5,
  'invalid_symbol_pairing': 6,
  'rules.radial_ambiguous_domain': 7,
  'rules.radial_invalid_count': 7,
  'rules.radial_wind_no_weak_form': 8,
  'rules.invalid_structure_for_symbol': 9,
  'rules.invalid_symbol_pairing': 10,
  'rules.radial_wind_no_op': 11,
  'rules.unsupported_combination': 12,
  'import.deferred_official_sign': 12,
  'rules.deprecated_or_variant_symbol': 12,
  'registry.legacy_sign_alias': 12,
  'rules.catalog_deferred_no_template': 12,
  'rules.ambiguous_symbol_semantics': 12,
  'rules.forbidden_body_affecting_symbol': 12,
  'rules.compiled_with_warnings': 13,
  'rules.speculative_disabled': 14,
};

/**
 * @param {object[]} diagnostics
 */
export function sortCompileDiagnostics(diagnostics) {
  return [...diagnostics].sort((a, b) => {
    const pa = CODE_PRECEDENCE[a.code] ?? 99;
    const pb = CODE_PRECEDENCE[b.code] ?? 99;
    if (pa !== pb) return pa - pb;
    const pathCmp = String(a.sourcePath ?? '').localeCompare(String(b.sourcePath ?? ''));
    if (pathCmp !== 0) return pathCmp;
    return String(a.normalizedObjectId ?? '').localeCompare(
      String(b.normalizedObjectId ?? ''),
    );
  });
}

/**
 * Normalize importer/registry diagnostics into compile schema.
 *
 * @param {object} raw
 */
export function normalizeProgramDiagnostic(raw) {
  return makeCompileDiagnostic({
    code: raw.code,
    status: raw.status,
    sourcePath: raw.sourcePath ?? raw.provenance?.sourcePath ?? '',
    normalizedObjectId: raw.normalizedObjectId ?? null,
    message: raw.message,
    fallback: raw.conservativeFallback ?? raw.fallback ?? raw.status,
    provenance: raw.provenance ?? { sourcePath: raw.sourcePath },
    registryId: raw.registryId ?? null,
  });
}
