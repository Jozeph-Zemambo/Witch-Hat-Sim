import {
  isCatalogDeferredSign,
  lookupRegistrySpellMaker,
  parseSpellMakerName,
} from './registry.js';
import { stableHexHash } from './hash.js';
import { SPELL_MAKER_DEFAULTS } from './spell-maker-defaults.js';

export const IMPORTER_VERSION = '0.1.0';

const DEFAULT_TITLE = 'Imported WHA spell';
const DEFAULT_SIGN_SIZE = 200;
const DEFAULT_SIGN_AMOUNT = 8;
const DEFAULT_PROJECT_RING_RADIUS = 0;
const DEFAULT_PROJECT_SIGN_RADIUS = 0;
/** Top of circle in degrees (12 o'clock), clockwise-positive placement convention. */
const TOP_ORIGIN_DEG = -90;
const SHARE_LINK_PAYLOAD_PARAMS = ['spell', 'payload', 'spellPayload'];
const SHARE_LINK_JSON_PARAMS = ['spellJson', 'json'];
const MAX_SHARE_LINK_JSON_CHARS = 256_000;
const MAX_UNKNOWN_FIELDS = 64;
const MAX_UNKNOWN_FIELD_JSON_CHARS = 4_096;
const MAX_GEOMETRY_MAGNITUDE = 1_000_000;
// Imported Spell Maker files can legitimately contain larger radial groups than
// the native authoring UI, but direct JSON must not be able to allocate an
// unbounded number of semantic/render objects.
const MAX_RADIAL_AMOUNT = 512;
const SUPPORTED_SHARE_PAYLOAD_VERSIONS = new Set([
  undefined,
  null,
  'spell-json-import-v0.1',
  'wha-sim-spell-v0.1',
]);
const ROOT_KNOWN_KEYS = new Set(['name', 'title', 'version', 'notes', 'seals']);
const SEAL_KNOWN_KEYS = new Set([
  'transform',
  'scale',
  'angle',
  'offsetX',
  'offsetY',
  'rings',
  'sigils',
  'signs',
  'signProfiles',
  'lines',
  'customVisuals',
  'customImages',
]);
const RING_KNOWN_KEYS = new Set([
  'name',
  'radius',
  'x',
  'y',
  'offsetX',
  'offsetY',
  'open',
  'openingSize',
  'visible',
  'hidden',
  'decorative',
  'stroke',
  'color',
  'weight',
  'opacity',
]);
const SYMBOL_KNOWN_KEYS = new Set([
  'name',
  'kind',
  'size',
  'nativeLayoutMode',
  'width',
  'height',
  'angle',
  'rotation',
  'rotationDeg',
  'radius',
  'x',
  'y',
  'offsetX',
  'offsetY',
  'offsetStrafe',
  'amount',
  'count',
  'amountSkip',
  'skip',
  'visible',
  'hidden',
  'decorative',
]);
const LINE_KNOWN_KEYS = new Set([
  'points',
  'from',
  'to',
  'name',
  'visible',
  'hidden',
  'decorative',
  'color',
  'weight',
  'stroke',
  'opacity',
]);
const CUSTOM_VISUAL_KNOWN_KEYS = new Set([
  'label',
  'name',
  'assetRef',
  'src',
  'path',
  'blobRef',
  'x',
  'y',
  'offsetX',
  'offsetY',
  'width',
  'height',
  'size',
  'rotation',
  'rotationDeg',
  'angle',
  'visible',
  'hidden',
  'decorative',
]);

/**
 * @param {unknown} input
 * @param {{ sourceKind?: 'direct_json' | 'share_link'; sourceLabel?: string }} [options]
 */
export function importSpellFromJson(input, options = {}) {
  const sourceKind = options.sourceKind ?? 'direct_json';
  const parsed = parseDirectJsonRoot(input, sourceKind);
  // Provenance is part of the returned immutable compile snapshot. Never retain
  // aliases into caller-owned objects: a later caller mutation must not change
  // an already-derived programId/graphId or a second compile result.
  const root = parsed.root;

  const ctx = {
    diagnostics: /** @type {object[]} */ ([...parsed.diagnostics]),
    rawUnknownFields: /** @type {Record<string, unknown>} */ ({}),
    sourceKind,
    importFlavor: detectImportFlavor(root),
    sameKindSignGroups: /** @type {Record<string, { groupId: string; registryId: string; profileIds: string[]; instanceIds: string[] }>} */ ({}),
    counters: {
      seal: 0,
      ring: 0,
      sigil: 0,
      line: 0,
      signProfile: 0,
      signGenerator: 0,
      signInstance: 0,
      sigilInstance: 0,
    },
  };

  const title =
    typeof root.name === 'string' && root.name.trim()
      ? root.name.trim()
      : typeof root.title === 'string' && root.title.trim()
        ? root.title.trim()
      : DEFAULT_TITLE;

  collectUnknownFields(root, '', ROOT_KNOWN_KEYS, ctx);

  if (parsed.diagnostics.length === 0 && !Array.isArray(root.seals)) {
    ctx.diagnostics.push(
      makeDiagnostic({
        code: 'import.root_malformed',
        status: 'invalid_structure',
        sourceKind,
        sourcePath: '/seals',
        message: 'Spell root must contain a seals array',
        fallback: 'invalid_structure',
      }),
    );
  }
  const sealsRaw = Array.isArray(root.seals) ? root.seals : [];
  const seals = sealsRaw.map((sealRaw, sealIndex) =>
    normalizeSeal(/** @type {Record<string, unknown>} */ (sealRaw ?? {}), sealIndex, ctx),
  );

  const program = {
    programId: deriveProgramId(title, seals, sourceKind),
    title,
    source: {
      kind: sourceKind,
      importerVersion: IMPORTER_VERSION,
      ...(options.sourceLabel ? { sourceLabel: options.sourceLabel } : {}),
    },
    coordinateSpace: {
      unit: 'normalized',
      origin: 'seal_center',
      yAxis: 'down',
      angleConvention: 'degrees_clockwise_from_top',
      topOriginDeg: TOP_ORIGIN_DEG,
    },
    seals,
    unresolvedObjects: collectUnresolvedObjects(seals),
    diagnostics: sortDiagnostics(ctx.diagnostics),
    importMetadata: {
      compatibilityVersion: 'spell-json-import-v0.1',
      sameKindSignGroups: Object.values(ctx.sameKindSignGroups).sort((a, b) =>
        a.groupId.localeCompare(b.groupId),
      ),
      ...(Object.keys(ctx.rawUnknownFields).length > 0
        ? { rawUnknownFields: sortObjectByKey(ctx.rawUnknownFields) }
        : {}),
    },
  };

  return program;
}

/**
 * Direct JSON uses the same object-root contract as decoded share links. Invalid
 * input becomes a diagnostic-only empty root instead of throwing or being
 * silently treated as an empty valid spell.
 *
 * @param {unknown} input
 * @param {string} sourceKind
 * @returns {{ root: Record<string, unknown>; diagnostics: object[] }}
 */
function parseDirectJsonRoot(input, sourceKind) {
  let parsedInput = input;
  if (typeof input === 'string') {
    try {
      parsedInput = JSON.parse(input);
    } catch {
      return malformedRoot('Direct JSON is not valid JSON text', 'malformed_json', sourceKind);
    }
  }

  if (!parsedInput || typeof parsedInput !== 'object' || Array.isArray(parsedInput)) {
    return malformedRoot('Direct JSON root must be an object', 'invalid_root_type', sourceKind);
  }

  try {
    return {
      root: /** @type {Record<string, unknown>} */ (structuredClone(parsedInput)),
      diagnostics: [],
    };
  } catch {
    return malformedRoot(
      'Direct JSON root must contain cloneable JSON-compatible data',
      'non_json_root',
      sourceKind,
    );
  }
}

function malformedRoot(message, fallback, sourceKind) {
  return {
    root: {},
    diagnostics: [
      makeDiagnostic({
        code: 'import.root_malformed',
        status: 'invalid_structure',
        sourceKind,
        sourcePath: '/',
        message,
        fallback,
      }),
    ],
  };
}

/**
 * Build the root render/diagnostic handoff index required by the import spec.
 * Entries are references to preserved seal symbols; they do not create semantics.
 *
 * @param {object[]} seals
 */
function collectUnresolvedObjects(seals) {
  const objects = [];
  for (const seal of seals ?? []) {
    for (const symbol of seal.symbols ?? []) {
      if (!isNonActiveImportObject(symbol)) continue;
      objects.push({
        objectId: symbol.objectId,
        sealId: seal.sealId,
        categoryHint: symbol.categoryHint,
        registryCandidate: symbol.registryCandidate ?? null,
        resolvedRegistryId: symbol.resolvedRegistryId ?? null,
        semanticEligibility: symbol.semanticEligibility ?? 'unknown',
        sourcePath: symbol.provenance?.sourcePath ?? null,
        registryLookup: symbol.provenance?.registryLookup ?? 'not_applicable',
        customImageMarker: symbol.provenance?.customImageMarker === true,
        assetRef: symbol.assetRef ?? null,
        geometry: summarizeRenderableGeometry(symbol.geometry ?? {}),
        provenance: {
          sourceKind: symbol.provenance?.sourceKind ?? 'direct_json',
          sourcePath: symbol.provenance?.sourcePath ?? null,
          rawSymbolToken: symbol.provenance?.rawSymbolToken ?? null,
        },
      });
    }
  }
  return objects;
}

/**
 * @param {object} symbol
 */
function isNonActiveImportObject(symbol) {
  return (
    !symbol.resolvedRegistryId ||
    symbol.semanticEligibility === 'visual_only' ||
    symbol.semanticEligibility === 'unresolved' ||
    symbol.semanticEligibility === 'diagnostic_only' ||
    symbol.semanticEligibility === 'unsupported'
  );
}

/**
 * @param {object} geometry
 */
function summarizeRenderableGeometry(geometry) {
  return {
    localPosition: geometry.localPosition ?? null,
    programPosition: geometry.programPosition ?? null,
    size: geometry.size ?? null,
    width: geometry.width ?? null,
    height: geometry.height ?? null,
    scale: geometry.scale ?? null,
    rotationDeg: geometry.rotationDeg ?? null,
    angleDeg: geometry.angleDeg ?? null,
    polarAngleDeg: geometry.polarAngleDeg ?? null,
    polarRadius: geometry.polarRadius ?? null,
    visibility: geometry.visibility ?? null,
    sourceGeometry: {
      sourcePath: geometry.sourceGeometry?.sourcePath ?? null,
    },
  };
}

/**
 * Decode a project-owned public share link into raw Spell JSON without network access.
 * Accepted shapes place either base64url JSON in `spell`, `payload`, or `spellPayload`,
 * or URL-encoded JSON in `spellJson` or `json`, in the query string or hash params.
 *
 * @param {string} shareLink
 * @returns {{ ok: true; payload: Record<string, unknown>; sourceLabel: string; encoding: 'base64url' | 'json_param'; diagnostics: object[] } | { ok: false; payload: null; sourceLabel: string; encoding: null; diagnostics: object[] }}
 */
export function decodeSpellShareLink(shareLink) {
  const input = typeof shareLink === 'string' ? shareLink.trim() : '';
  const fail = (reason, message, sourceLabel = input) => ({
    ok: false,
    payload: null,
    sourceLabel,
    encoding: null,
    diagnostics: [
      makeDiagnostic({
        code: 'import.share_decode_failed',
        status: 'invalid_structure',
        sourceKind: 'share_link',
        sourcePath: 'share_link',
        message,
        fallback: reason,
      }),
    ],
  });

  let url;
  try {
    url = new URL(input);
  } catch {
    return fail('invalid_url', 'Share link is not a valid URL');
  }

  const params = [url.searchParams, paramsFromHash(url.hash)];
  const encodedPayload = firstParam(params, SHARE_LINK_PAYLOAD_PARAMS);
  const jsonPayload = firstParam(params, SHARE_LINK_JSON_PARAMS);
  if (!encodedPayload && !jsonPayload) {
    return fail(
      'unsupported_encoding',
      'Share link does not contain a recognized spell payload parameter',
      url.href,
    );
  }

  let jsonText;
  let encoding;
  try {
    if (encodedPayload) {
      jsonText = decodeBase64UrlUtf8(encodedPayload.value);
      encoding = 'base64url';
    } else {
      jsonText = jsonPayload.value;
      encoding = 'json_param';
    }
  } catch {
    return fail('unsupported_encoding', 'Share link payload encoding is unsupported', url.href);
  }

  if (jsonText.length > MAX_SHARE_LINK_JSON_CHARS) {
    return fail('oversized_payload', 'Share link payload is too large to import safely', url.href);
  }

  let payload;
  try {
    payload = JSON.parse(jsonText);
  } catch {
    return fail('malformed_json', 'Share link payload is not valid JSON', url.href);
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return fail('malformed_json', 'Share link payload must decode to a JSON object', url.href);
  }

  if (!SUPPORTED_SHARE_PAYLOAD_VERSIONS.has(payload.version)) {
    return fail('unknown_version', 'Share link payload version is not supported', url.href);
  }

  if (hasUnsafeCustomImagePayload(/** @type {Record<string, unknown>} */ (payload))) {
    return fail(
      'unsafe_custom_image_payload',
      'Share link contains an unsafe embedded custom image payload',
      url.href,
    );
  }

  return {
    ok: true,
    payload: /** @type {Record<string, unknown>} */ (payload),
    sourceLabel: url.href,
    encoding,
    diagnostics: [],
  };
}

/**
 * @param {string} shareLink
 */
export function importSpellFromShareLink(shareLink) {
  const decoded = decodeSpellShareLink(shareLink);
  if (!decoded.ok) {
    return {
      program: null,
      diagnostics: decoded.diagnostics,
      decoded,
    };
  }

  const program = importSpell(decoded.payload, {
    sourceKind: 'share_link',
    sourceLabel: decoded.sourceLabel,
  });
  return {
    program,
    diagnostics: program.diagnostics,
    decoded,
  };
}

/**
 * @param {string} title
 * @param {object[]} seals
 * @param {string} sourceKind
 */
function deriveProgramId(title, seals, sourceKind) {
  const identitySourceKind = sourceKind === 'share_link' ? 'direct_json' : sourceKind;
  return `program:${stableHexHash({
    title,
    seals: normalizeSourceKindForIdentity(seals),
    sourceKind: identitySourceKind,
  })}`;
}

/**
 * Share links are transport wrappers around direct JSON, so source-kind provenance is
 * normalized only for identity hashing while remaining intact on the returned program.
 * @param {unknown} value
 * @returns {unknown}
 */
function normalizeSourceKindForIdentity(value) {
  if (Array.isArray(value)) return value.map((item) => normalizeSourceKindForIdentity(item));
  if (!value || typeof value !== 'object') return value;
  const normalized = {};
  for (const [key, entry] of Object.entries(value)) {
    normalized[key] =
      key === 'sourceKind' && entry === 'share_link'
        ? 'direct_json'
        : normalizeSourceKindForIdentity(entry);
  }
  return normalized;
}

/**
 * @param {string} hash
 */
function paramsFromHash(hash) {
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  const queryStart = text.indexOf('?');
  const paramsText = queryStart >= 0 ? text.slice(queryStart + 1) : text;
  return new URLSearchParams(paramsText);
}

/**
 * @param {URLSearchParams[]} paramSets
 * @param {string[]} names
 */
function firstParam(paramSets, names) {
  for (const params of paramSets) {
    for (const name of names) {
      const value = params.get(name);
      if (value) return { name, value };
    }
  }
  return null;
}

/**
 * @param {string} encoded
 */
function decodeBase64UrlUtf8(encoded) {
  const compact = encoded.replace(/\s/g, '');
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(compact)) {
    throw new Error('unsupported base64url payload');
  }
  const base64 = compact.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  if (typeof globalThis.atob === 'function') {
    const binary = globalThis.atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(padded, 'base64').toString('utf8');
  }
  throw new Error('base64url decoding unavailable');
}

/**
 * @param {Record<string, unknown>} payload
 */
function hasUnsafeCustomImagePayload(payload) {
  const seals = Array.isArray(payload.seals) ? payload.seals : [];
  for (const sealRaw of seals) {
    const seal = /** @type {Record<string, unknown>} */ (sealRaw ?? {});
    const visuals = Array.isArray(seal.customVisuals)
      ? seal.customVisuals
      : Array.isArray(seal.customImages)
        ? seal.customImages
        : [];
    for (const visualRaw of visuals) {
      const visual = /** @type {Record<string, unknown>} */ (visualRaw ?? {});
      const asset = visual.assetRef ?? visual.src ?? visual.path ?? visual.blobRef;
      if (typeof asset === 'string' && /^(data|javascript):/i.test(asset.trim())) {
        return true;
      }
    }
  }
  return false;
}

/**
 * @param {Record<string, unknown>} raw
 * @param {string} basePath
 * @param {Set<string>} knownKeys
 * @param {{ rawUnknownFields: Record<string, unknown>; diagnostics: object[]; sourceKind: string }} ctx
 */
function collectUnknownFields(raw, basePath, knownKeys, ctx) {
  for (const key of Object.keys(raw).sort()) {
    if (knownKeys.has(key)) continue;
    const sourcePath = `${basePath}/${escapeJsonPointerSegment(key)}`;
    const sanitized = sanitizeUnknownFieldValue(raw[key]);
    if (!sanitized.safe) {
      ctx.diagnostics.push(
        makeDiagnostic({
          code: 'import.ignored_external_field',
          status: 'metadata_ignored',
          sourceKind: ctx.sourceKind,
          sourcePath,
          message: sanitized.message,
          fallback: sanitized.reason,
        }),
      );
      continue;
    }
    if (Object.keys(ctx.rawUnknownFields).length >= MAX_UNKNOWN_FIELDS) {
      ctx.diagnostics.push(
        makeDiagnostic({
          code: 'import.ignored_external_field',
          status: 'metadata_ignored',
          sourceKind: ctx.sourceKind,
          sourcePath,
          message: 'Unknown external field ignored because the metadata limit was reached',
          fallback: 'unknown_field_limit_reached',
        }),
      );
      continue;
    }
    ctx.rawUnknownFields[sourcePath] = sanitized.value;
  }
}

/**
 * @param {unknown} value
 * @returns {{ safe: true; value: unknown } | { safe: false; reason: string; message: string }}
 */
function sanitizeUnknownFieldValue(value) {
  if (!isJsonSafeValue(value)) {
    return {
      safe: false,
      reason: 'unsupported_external_field_type',
      message: 'Unknown external field uses a non-JSON value and was ignored',
    };
  }
  if (containsUnsafeExternalString(value)) {
    return {
      safe: false,
      reason: 'unsafe_external_field_payload',
      message: 'Unknown external field contains an unsafe payload reference and was ignored',
    };
  }
  const cloned = JSON.parse(JSON.stringify(value));
  if (JSON.stringify(cloned).length > MAX_UNKNOWN_FIELD_JSON_CHARS) {
    return {
      safe: false,
      reason: 'oversized_external_field',
      message: 'Unknown external field is too large to preserve safely',
    };
  }
  return { safe: true, value: cloned };
}

/**
 * @param {unknown} value
 */
function isJsonSafeValue(value) {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonSafeValue(item));
  if (typeof value === 'object') {
    return Object.values(value).every((entry) => isJsonSafeValue(entry));
  }
  return false;
}

/**
 * @param {unknown} value
 */
function containsUnsafeExternalString(value) {
  if (typeof value === 'string') return /^(data|javascript):/i.test(value.trim());
  if (Array.isArray(value)) return value.some((item) => containsUnsafeExternalString(item));
  if (value && typeof value === 'object') {
    return Object.values(value).some((entry) => containsUnsafeExternalString(entry));
  }
  return false;
}

/**
 * @param {string} segment
 */
function escapeJsonPointerSegment(segment) {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * @param {Record<string, unknown>} value
 */
function sortObjectByKey(value) {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * @param {unknown} pointsRaw
 * @returns {{ points: number[][]; malformed: boolean; message: string }}
 */
function normalizeLinePoints(pointsRaw) {
  if (!Array.isArray(pointsRaw)) {
    return {
      points: [],
      malformed: true,
      message: 'Line points must be an array with at least two valid points',
    };
  }

  const points = [];
  let invalidPointSeen = false;
  for (const pointRaw of pointsRaw) {
    const point = normalizeLinePoint(pointRaw);
    if (!point) {
      invalidPointSeen = true;
      continue;
    }
    points.push(point);
  }

  if (points.length < 2) {
    return {
      points,
      malformed: true,
      message: 'Line has fewer than two valid points and cannot form a semantic connection',
    };
  }

  return {
    points,
    malformed: invalidPointSeen,
    message: invalidPointSeen
      ? 'Line contains malformed points; valid points were preserved for rendering'
      : '',
  };
}

/**
 * @param {unknown} pointRaw
 * @returns {number[] | null}
 */
function normalizeLinePoint(pointRaw) {
  if (Array.isArray(pointRaw)) {
    const x = Number(pointRaw[0]);
    const y = Number(pointRaw[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  }
  if (pointRaw && typeof pointRaw === 'object') {
    const point = /** @type {{ x?: unknown; y?: unknown }} */ (pointRaw);
    const x = Number(point.x);
    const y = Number(point.y);
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  }
  return null;
}

/**
 * @param {Record<string, unknown>} ring
 * @param {boolean} spellMakerLikeSeal
 * @returns {{ closureState: 'open' | 'closed' | 'unknown'; closureSource: string; defaultApplied: boolean; openingSize?: number }}
 */
function normalizeRingClosure(ring, spellMakerLikeSeal) {
  const hasOpen = typeof ring.open === 'boolean';
  const hasOpeningSize = typeof ring.openingSize === 'number' && Number.isFinite(ring.openingSize);
  if (hasOpen && ring.open === true) {
    return {
      closureState: 'open',
      closureSource: 'explicit_open_flag',
      defaultApplied: false,
      ...(hasOpeningSize ? { openingSize: ring.openingSize } : {}),
    };
  }
  if (hasOpeningSize && ring.openingSize > 0) {
    return {
      closureState: 'open',
      closureSource: 'explicit_opening_size',
      defaultApplied: false,
      openingSize: ring.openingSize,
    };
  }
  if ((hasOpen && ring.open === false) || (hasOpeningSize && ring.openingSize <= 0)) {
    return {
      closureState: 'closed',
      closureSource: hasOpen ? 'explicit_open_flag' : 'explicit_opening_size',
      defaultApplied: false,
      ...(hasOpeningSize ? { openingSize: ring.openingSize } : {}),
    };
  }
  if (spellMakerLikeSeal) {
    return {
      closureState: 'closed',
      closureSource: 'spell_maker_compat_default',
      defaultApplied: true,
    };
  }
  return {
    closureState: 'unknown',
    closureSource: 'missing_external_closure',
    defaultApplied: true,
  };
}

/**
 * @param {Record<string, unknown>} root
 */
function detectImportFlavor(root) {
  const seals = Array.isArray(root.seals) ? root.seals : [];
  const hasSpellMakerToken = seals.some((sealRaw) => {
    const seal = /** @type {Record<string, unknown>} */ (sealRaw ?? {});
    const sigils = Array.isArray(seal.sigils) ? seal.sigils : [];
    const signs = Array.isArray(seal.signs) ? seal.signs : [];
    return [...sigils, ...signs].some((entryRaw) => {
      const entry = /** @type {Record<string, unknown>} */ (entryRaw ?? {});
      return parseSpellMakerName(String(entry.name ?? '')).spellMakerPrefix;
    });
  });

  return {
    spellMakerLike:
      typeof root.name === 'string' ||
      hasSpellMakerToken ||
      seals.some((sealRaw) => {
        const seal = /** @type {Record<string, unknown>} */ (sealRaw ?? {});
        return (
          (Array.isArray(seal.signs) && seal.signs.length > 0) ||
          (typeof seal.scale === 'number' && seal.transform === undefined)
        );
      }),
  };
}

/**
 * @param {Record<string, unknown>} sealRaw
 * @param {{ spellMakerLike: boolean }} importFlavor
 */
function isSpellMakerLikeSeal(sealRaw, importFlavor) {
  if (importFlavor.spellMakerLike) return true;
  if (typeof sealRaw.scale === 'number' && sealRaw.transform === undefined) return true;
  const signs = Array.isArray(sealRaw.signs) ? sealRaw.signs : [];
  return signs.some((entryRaw) => {
    const entry = /** @type {Record<string, unknown>} */ (entryRaw ?? {});
    return parseSpellMakerName(String(entry.name ?? '')).spellMakerPrefix;
  });
}

/**
 * @param {Record<string, unknown>} sealRaw
 * @param {number} sealIndex
 * @param {object} ctx
 */
function normalizeSeal(sealRaw, sealIndex, ctx) {
  const sealId = `seal:${sealIndex}`;
  const basePath = `/seals/${sealIndex}`;
  collectUnknownFields(sealRaw, basePath, SEAL_KNOWN_KEYS, ctx);
  const spellMakerLikeSeal = isSpellMakerLikeSeal(sealRaw, ctx.importFlavor);
  const transformSource = { ...(sealRaw.transform ?? {}) };
  let sealGeometryInvalid = false;
  sealGeometryInvalid = diagnoseGeometryField(
    sealRaw,
    'scale',
    `${basePath}/scale`,
    ctx,
    { positive: true },
  ) || sealGeometryInvalid;
  for (const key of ['angle', 'offsetX', 'offsetY']) {
    sealGeometryInvalid = diagnoseGeometryField(
      sealRaw,
      key,
      `${basePath}/${key}`,
      ctx,
    ) || sealGeometryInvalid;
  }
  if (
    isFiniteGeometryNumber(sealRaw.scale, { positive: true }) &&
    transformSource.scale === undefined &&
    transformSource.scaleX === undefined
  ) {
    transformSource.scale = spellMakerLikeSeal ? sealRaw.scale / 100 : sealRaw.scale;
  }
  if (isFiniteGeometryNumber(sealRaw.angle) && transformSource.rotation === undefined) {
    transformSource.rotation = sealRaw.angle;
  }
  if (isFiniteGeometryNumber(sealRaw.offsetX) && transformSource.x === undefined) {
    transformSource.x = sealRaw.offsetX;
  }
  if (isFiniteGeometryNumber(sealRaw.offsetY) && transformSource.y === undefined) {
    transformSource.y = sealRaw.offsetY;
  }
  const transform = normalizeSealTransform(
    transformSource,
    `${basePath}/transform`,
    ctx.sourceKind,
    ctx,
  );
  sealGeometryInvalid = transform.invalidStructure === true || sealGeometryInvalid;

  let ringGeometryInvalid = false;
  const rings = (Array.isArray(sealRaw.rings) ? sealRaw.rings : []).map(
    (ringRaw, ringIndex) => {
      const ringId = `ring:${ctx.counters.ring++}`;
      const path = `${basePath}/rings/${ringIndex}`;
      const ring = /** @type {Record<string, unknown>} */ (ringRaw ?? {});
      collectUnknownFields(ring, path, RING_KNOWN_KEYS, ctx);
      const radiusResult = normalizeGeometryNumber(
        ring,
        'radius',
        spellMakerLikeSeal
          ? SPELL_MAKER_DEFAULTS.ring.radius
          : DEFAULT_PROJECT_RING_RADIUS,
        `${path}/radius`,
        ctx,
        { nonNegative: true },
      );
      const centerXResult = normalizeGeometryNumber(
        ring,
        ring.x !== undefined ? 'x' : 'offsetX',
        0,
        `${path}/${ring.x !== undefined ? 'x' : 'offsetX'}`,
        ctx,
      );
      const centerYResult = normalizeGeometryNumber(
        ring,
        ring.y !== undefined ? 'y' : 'offsetY',
        0,
        `${path}/${ring.y !== undefined ? 'y' : 'offsetY'}`,
        ctx,
      );
      const invalidRing = radiusResult.invalid || centerXResult.invalid || centerYResult.invalid;
      ringGeometryInvalid = invalidRing || ringGeometryInvalid;
      const closure = normalizeRingClosure(ring, spellMakerLikeSeal);
      const style = normalizeVisualStyle(ring);
      return {
        ringId,
        radius: radiusResult.value,
        center: {
          x: centerXResult.value,
          y: centerYResult.value,
        },
        visibility: normalizeVisibilityPolicy(ring),
        ...(style ? { style } : {}),
        closureState: closure.closureState,
        closureSource: closure.closureSource,
        closureDefaultApplied: closure.defaultApplied,
        ...(typeof closure.openingSize === 'number' ? { openingSize: closure.openingSize } : {}),
        ...(invalidRing ? { semanticEligibility: 'invalid_structure' } : {}),
        provenance: { sourceKind: ctx.sourceKind, sourcePath: path, raw: ring },
      };
    },
  );

  const symbols = [];
  const sigilsRaw = Array.isArray(sealRaw.sigils) ? sealRaw.sigils : [];
  for (let i = 0; i < sigilsRaw.length; i++) {
    const sigilRaw = /** @type {Record<string, unknown>} */ (sigilsRaw[i] ?? {});
    const objectId = `sigil:${ctx.counters.sigil++}`;
    const path = `${basePath}/sigils/${i}`;
    collectUnknownFields(sigilRaw, path, SYMBOL_KNOWN_KEYS, ctx);
    const lookup = lookupRegistrySpellMaker(String(sigilRaw.name ?? ''), 'sigil');
    const sizeResult = normalizeGeometryNumber(
      sigilRaw,
      'size',
      SPELL_MAKER_DEFAULTS.centerSigil.size,
      `${path}/size`,
      ctx,
      { positive: true },
    );
    const angleResult = normalizeGeometryNumber(sigilRaw, 'angle', 0, `${path}/angle`, ctx);
    const xKey = sigilRaw.x !== undefined ? 'x' : 'offsetX';
    const yKey = sigilRaw.y !== undefined ? 'y' : 'offsetY';
    const xResult = normalizeGeometryNumber(sigilRaw, xKey, 0, `${path}/${xKey}`, ctx);
    const yResult = normalizeGeometryNumber(sigilRaw, yKey, 0, `${path}/${yKey}`, ctx);
    const invalidSigil =
      sizeResult.invalid || angleResult.invalid || xResult.invalid || yResult.invalid;
    const size = sizeResult.value;
    const angle = angleResult.value;
    const x = xResult.value;
    const y = yResult.value;
    symbols.push(
      buildSymbol({
        objectId,
        path,
        raw: sigilRaw,
        categoryHint: 'sigil',
        lookup,
        sourceKind: ctx.sourceKind,
        semanticEligibility:
          invalidSigil || sealGeometryInvalid || ringGeometryInvalid
            ? 'invalid_structure'
            : undefined,
        geometry: {
          localPosition: { x, y },
          programPosition: { x, y },
          scale: size / SPELL_MAKER_DEFAULTS.centerSigil.size,
          size,
          defaultSizeApplied: sigilRaw.size === undefined,
          rotationDeg: angle,
          angleDeg: angle,
          polarAngleDeg: 0,
          polarRadius: 0,
          offsetX: x,
          offsetY: y,
        },
      }),
    );
  }

  const signsRaw = Array.isArray(sealRaw.signs) ? sealRaw.signs : [];
  for (let entryIndex = 0; entryIndex < signsRaw.length; entryIndex++) {
    const entry = /** @type {Record<string, unknown>} */ (signsRaw[entryIndex] ?? {});
    const nameParsed = parseSpellMakerName(String(entry.name ?? entry.kind ?? ''));
    const categoryHint = nameParsed.category === 'sigil' ? 'sigil' : 'sign';
    expandRadialProfile(
      entry,
      entryIndex,
      'signs',
      categoryHint,
      sealId,
      basePath,
      transform,
      'spell_maker_signs',
      ctx,
      symbols,
    );
  }

  const profilesRaw = Array.isArray(sealRaw.signProfiles) ? sealRaw.signProfiles : [];
  for (let profileIndex = 0; profileIndex < profilesRaw.length; profileIndex++) {
    const profile = /** @type {Record<string, unknown>} */ (
      profilesRaw[profileIndex] ?? {}
    );
    expandRadialProfile(
      profile,
      profileIndex,
      'signProfiles',
      'sign',
      sealId,
      basePath,
      transform,
      'project_sign_profiles',
      ctx,
      symbols,
    );
  }

  const lines = (Array.isArray(sealRaw.lines) ? sealRaw.lines : []).map(
    (lineRaw, lineIndex) => {
      const lineId = `line:${ctx.counters.line++}`;
      const path = `${basePath}/lines/${lineIndex}`;
      const line = /** @type {Record<string, unknown>} */ (lineRaw ?? {});
      collectUnknownFields(line, path, LINE_KNOWN_KEYS, ctx);
      const linePoints = normalizeLinePoints(line.points);
      const style = normalizeVisualStyle(line);
      if (linePoints.malformed) {
        ctx.diagnostics.push(
          makeDiagnostic({
            code: 'import.line_malformed',
            status: 'invalid_structure',
            sourceKind: ctx.sourceKind,
            sourcePath: `${path}/points`,
            normalizedObjectId: lineId,
            message: linePoints.message,
            fallback: 'invalid_structure',
          }),
        );
      }
      const normalizedLine = {
        lineId,
        points: linePoints.points,
        visibility: normalizeVisibilityPolicy(line),
        ...(style ? { style } : {}),
        anchors:
          line.from !== undefined || line.to !== undefined
            ? { from: line.from ?? null, to: line.to ?? null }
            : null,
        provenance: { sourceKind: ctx.sourceKind, sourcePath: path, raw: line },
      };
      if (linePoints.malformed) {
        normalizedLine.semanticEligibility = 'invalid_structure';
      } else if (normalizedLine.visibility.active === false) {
        normalizedLine.semanticEligibility = 'visual_only';
      }
      return normalizedLine;
    },
  );
  const customVisuals = normalizeCustomVisuals(sealRaw, sealIndex, basePath, ctx);
  symbols.push(...customVisuals.map((visual) => visual.symbol));
  if (sealGeometryInvalid || ringGeometryInvalid) {
    for (const symbol of symbols) {
      if (symbol.semanticEligibility !== 'visual_only') {
        symbol.semanticEligibility = 'invalid_structure';
      }
    }
  }
  attachLineConnections({ rings, symbols, lines });

  return {
    sealId,
    transform,
    rings,
    symbols,
    lines,
    customVisuals: customVisuals.map(({ symbol, ...visual }) => visual),
    provenance: { sourceKind: ctx.sourceKind, sourcePath: basePath, raw: sealRaw },
  };
}

/**
 * Preserve explicit line anchors on both the line and target object records.
 * This is structural geometry only; it does not create active spell semantics.
 *
 * @param {{ rings: object[]; symbols: object[]; lines: object[] }} seal
 */
function attachLineConnections(seal) {
  const ringById = new Map((seal.rings ?? []).map((ring) => [ring.ringId, ring]));
  const symbolById = new Map((seal.symbols ?? []).map((symbol) => [symbol.objectId, symbol]));

  for (const line of seal.lines ?? []) {
    if (!line.anchors) continue;
    const connections = [];
    const unresolvedAnchors = [];
    for (const endpoint of ['from', 'to']) {
      const anchorId = line.anchors[endpoint];
      if (anchorId === null || anchorId === undefined) continue;
      const resolved = resolveLineAnchor(anchorId, symbolById, ringById);
      const connection = {
        lineId: line.lineId,
        endpoint,
        targetId: String(anchorId),
        targetKind: resolved.kind,
        sourcePath: line.provenance?.sourcePath ?? null,
      };
      connections.push(connection);
      if (resolved.kind === 'symbol') {
        attachSymbolLineConnection(resolved.target, connection);
      } else if (resolved.kind === 'ring') {
        attachRingLineConnection(resolved.target, connection);
      } else {
        unresolvedAnchors.push({
          endpoint,
          targetId: String(anchorId),
          targetKind: 'unresolved',
        });
      }
    }
    if (connections.length > 0) line.connections = connections;
    if (unresolvedAnchors.length > 0) line.unresolvedAnchors = unresolvedAnchors;
  }
}

/**
 * @param {unknown} anchorId
 * @param {Map<string, object>} symbolById
 * @param {Map<string, object>} ringById
 * @returns {{ kind: 'symbol' | 'ring' | 'unresolved'; target: object | null }}
 */
function resolveLineAnchor(anchorId, symbolById, ringById) {
  if (typeof anchorId !== 'string') return { kind: 'unresolved', target: null };
  const symbol = symbolById.get(anchorId);
  if (symbol) return { kind: 'symbol', target: symbol };
  const ring = ringById.get(anchorId);
  if (ring) return { kind: 'ring', target: ring };
  return { kind: 'unresolved', target: null };
}

/**
 * @param {object} symbol
 * @param {object} connection
 */
function attachSymbolLineConnection(symbol, connection) {
  symbol.geometry = symbol.geometry ?? {};
  symbol.geometry.lineConnections = symbol.geometry.lineConnections ?? [];
  symbol.geometry.lineConnections.push({
    lineId: connection.lineId,
    endpoint: connection.endpoint,
    targetKind: 'symbol',
    targetId: symbol.objectId,
    sourcePath: connection.sourcePath,
  });
}

/**
 * @param {object} ring
 * @param {object} connection
 */
function attachRingLineConnection(ring, connection) {
  ring.lineConnections = ring.lineConnections ?? [];
  ring.lineConnections.push({
    lineId: connection.lineId,
    endpoint: connection.endpoint,
    targetKind: 'ring',
    targetId: ring.ringId,
    sourcePath: connection.sourcePath,
  });
}

/**
 * @param {Record<string, unknown>} sealRaw
 * @param {number} sealIndex
 * @param {string} basePath
 * @param {{ rawUnknownFields: Record<string, unknown>; diagnostics: object[]; sourceKind: string }} ctx
 */
function normalizeCustomVisuals(sealRaw, sealIndex, basePath, ctx) {
  const source = Array.isArray(sealRaw.customVisuals)
    ? { pathSegment: 'customVisuals', items: sealRaw.customVisuals }
    : Array.isArray(sealRaw.customImages)
      ? { pathSegment: 'customImages', items: sealRaw.customImages }
      : { pathSegment: 'customVisuals', items: [] };
  return source.items.map((visualRaw, visualIndex) => {
    const visual = /** @type {Record<string, unknown>} */ (visualRaw ?? {});
    const sourcePath = `${basePath}/${source.pathSegment}/${visualIndex}`;
    collectUnknownFields(visual, sourcePath, CUSTOM_VISUAL_KNOWN_KEYS, ctx);
    const objectId = `import.visual:${sealIndex}:${visualIndex}`;
    const label =
      typeof visual.label === 'string' && visual.label.trim()
        ? visual.label.trim()
        : typeof visual.name === 'string' && visual.name.trim()
          ? visual.name.trim()
          : `Custom visual ${visualIndex + 1}`;
    const assetRef =
      typeof visual.assetRef === 'string'
        ? visual.assetRef
        : typeof visual.src === 'string'
          ? visual.src
          : typeof visual.path === 'string'
            ? visual.path
            : typeof visual.blobRef === 'string'
              ? visual.blobRef
              : null;
    const x = typeof visual.x === 'number' ? visual.x : typeof visual.offsetX === 'number' ? visual.offsetX : 0;
    const y = typeof visual.y === 'number' ? visual.y : typeof visual.offsetY === 'number' ? visual.offsetY : 0;
    const width = typeof visual.width === 'number' && visual.width > 0 ? visual.width : null;
    const height = typeof visual.height === 'number' && visual.height > 0 ? visual.height : null;
    const size =
      typeof visual.size === 'number' && visual.size > 0
        ? visual.size
        : Math.max(width ?? 1, height ?? 1);
    const rotationDeg =
      typeof visual.rotation === 'number'
        ? visual.rotation
        : typeof visual.rotationDeg === 'number'
          ? visual.rotationDeg
          : typeof visual.angle === 'number'
            ? visual.angle
            : 0;
    const symbol = buildSymbol({
      objectId,
      path: sourcePath,
      raw: visual,
      categoryHint: 'custom_image',
      lookup: {
        registryCandidate: objectId,
        resolvedRegistryId: null,
      },
      sourceKind: ctx.sourceKind,
      semanticEligibility: 'visual_only',
      geometry: {
        localPosition: { x, y },
        programPosition: { x, y },
        scale: 1,
        size,
        width,
        height,
        defaultSizeApplied: visual.size === undefined,
        rotationDeg,
        angleDeg: rotationDeg,
        polarAngleDeg: 0,
        polarRadius: Math.hypot(x, y),
        offsetX: x,
        offsetY: y,
      },
    });
    symbol.assetRef = assetRef;
    symbol.provenance.registryLookup = 'custom_visual';
    symbol.provenance.customImageMarker = true;
    symbol.provenance.rawSymbolToken = label;

    return {
      visualId: objectId,
      label,
      assetRef,
      categoryHint: 'custom_image',
      semanticEligibility: 'visual_only',
      geometry: symbol.geometry,
      provenance: {
        sourceKind: ctx.sourceKind,
        sourcePath,
        raw: visual,
        registryLookup: 'custom_visual',
        customImageMarker: true,
      },
      symbol,
    };
  });
}

/**
 * @param {unknown} transformRaw
 * @param {string} path
 * @param {string} sourceKind
 * @param {object} ctx
 */
function normalizeSealTransform(transformRaw, path, sourceKind, ctx) {
  const t = /** @type {Record<string, unknown>} */ (transformRaw ?? {});
  const scaleResult = normalizeGeometryNumber(
    t,
    'scale',
    1,
    `${path}/scale`,
    ctx,
    { positive: true },
  );
  const scaleXResult = normalizeGeometryNumber(
    t,
    'scaleX',
    scaleResult.value,
    `${path}/scaleX`,
    ctx,
    { positive: true },
  );
  const scaleYResult = normalizeGeometryNumber(
    t,
    'scaleY',
    scaleXResult.value,
    `${path}/scaleY`,
    ctx,
    { positive: true },
  );
  const xResult = normalizeGeometryNumber(t, 'x', 0, `${path}/x`, ctx);
  const yResult = normalizeGeometryNumber(t, 'y', 0, `${path}/y`, ctx);
  const offsetXResult = normalizeGeometryNumber(t, 'offsetX', 0, `${path}/offsetX`, ctx);
  const offsetYResult = normalizeGeometryNumber(t, 'offsetY', 0, `${path}/offsetY`, ctx);
  const rotationKey =
    t.rotation !== undefined ? 'rotation' : t.rotationDeg !== undefined ? 'rotationDeg' : 'angle';
  const rotationResult = normalizeGeometryNumber(
    t,
    rotationKey,
    0,
    `${path}/${rotationKey}`,
    ctx,
  );
  const invalidStructure = [
    scaleResult,
    scaleXResult,
    scaleYResult,
    xResult,
    yResult,
    offsetXResult,
    offsetYResult,
    rotationResult,
  ].some((result) => result.invalid);
  return {
    x: xResult.value,
    y: yResult.value,
    scaleX: scaleXResult.value,
    scaleY: scaleYResult.value,
    rotationDeg: rotationResult.value,
    offsetX: offsetXResult.value,
    offsetY: offsetYResult.value,
    ...(invalidStructure ? { invalidStructure: true } : {}),
    provenance: { sourceKind, sourcePath: path, raw: t },
  };
}

/**
 * @param {Record<string, unknown>} profile
 * @param {number} profileIndex
 * @param {'signs' | 'signProfiles'} pathSegment
 * @param {'sign' | 'sigil'} categoryHint
 * @param {string} sealId
 * @param {string} basePath
 * @param {object} sealTransform
 * @param {'spell_maker_signs' | 'project_sign_profiles'} defaultFlavor
 * @param {object} ctx
 * @param {object[]} symbols
 */
function expandRadialProfile(
  profile,
  profileIndex,
  pathSegment,
  categoryHint,
  sealId,
  basePath,
  sealTransform,
  defaultFlavor,
  ctx,
  symbols,
) {
  const profileId = `${categoryHint}-profile:${ctx.counters.signProfile++}`;
  const profilePath = `${basePath}/${pathSegment}/${profileIndex}`;
  collectUnknownFields(profile, profilePath, SYMBOL_KNOWN_KEYS, ctx);
  const kind = String(profile.kind ?? profile.name ?? '');
  const lookup = lookupRegistrySpellMaker(kind, categoryHint);
  const isSign = categoryHint === 'sign';
  const instancePrefix = isSign ? 'sign-instance' : 'sigil-instance';
  const generatorPrefix = isSign ? 'sign-generator' : 'sigil-generator';
  const profileDefaults =
    defaultFlavor === 'spell_maker_signs'
      ? SPELL_MAKER_DEFAULTS.sign
      : {
          size: DEFAULT_SIGN_SIZE,
          radius: DEFAULT_PROJECT_SIGN_RADIUS,
          angle: 0,
          offsetStrafe: 0,
          offsetX: 0,
          offsetY: 0,
          amountSkip: 0,
          rotation: 0,
        };

  const sizeResult = normalizeGeometryNumber(
    profile,
    'size',
    profileDefaults.size,
    `${profilePath}/size`,
    ctx,
    { positive: true },
  );
  const size = sizeResult.value;
  const amountRaw = profile.amount ?? profile.count;
  let amount = DEFAULT_SIGN_AMOUNT;
  if (amountRaw !== undefined && amountRaw !== null) {
    const parsed = Number(amountRaw);
    if (
      !Number.isInteger(parsed)
      || parsed < 1
      || parsed > MAX_RADIAL_AMOUNT
    ) {
      ctx.diagnostics.push(
        makeDiagnostic({
          code: 'import.radial_malformed',
          status: 'invalid_structure',
          sourcePath: `${profilePath}/amount`,
          normalizedObjectId: profileId,
          message: `Radial sign profile amount must be a whole number from 1 to ${MAX_RADIAL_AMOUNT}`,
          fallback: 'invalid_structure',
          sourceKind: ctx.sourceKind,
        }),
      );
      amount = 0;
    } else amount = parsed;
  }

  const profileRotationResult = normalizeGeometryNumber(
    profile,
    'rotation',
    profileDefaults.rotation,
    `${profilePath}/rotation`,
    ctx,
  );
  const signAngleResult = normalizeGeometryNumber(
    profile,
    'angle',
    profileDefaults.angle,
    `${profilePath}/angle`,
    ctx,
  );
  const radiusResult = normalizeGeometryNumber(
    profile,
    'radius',
    profileDefaults.radius,
    `${profilePath}/radius`,
    ctx,
    { nonNegative: true },
  );
  const offsetStrafeResult = normalizeGeometryNumber(
    profile,
    'offsetStrafe',
    profileDefaults.offsetStrafe,
    `${profilePath}/offsetStrafe`,
    ctx,
  );
  const offsetXResult = normalizeGeometryNumber(
    profile,
    'offsetX',
    profileDefaults.offsetX,
    `${profilePath}/offsetX`,
    ctx,
  );
  const offsetYResult = normalizeGeometryNumber(
    profile,
    'offsetY',
    profileDefaults.offsetY,
    `${profilePath}/offsetY`,
    ctx,
  );
  const skipKey = profile.amountSkip !== undefined ? 'amountSkip' : 'skip';
  const amountSkipResult = normalizeGeometryNumber(
    profile,
    skipKey,
    profileDefaults.amountSkip,
    `${profilePath}/${skipKey}`,
    ctx,
    { nonNegative: true, integer: true, maximum: MAX_RADIAL_AMOUNT },
  );
  const profileRotation = profileRotationResult.value;
  const signAngle = signAngleResult.value;
  const radius = radiusResult.value;
  const offsetStrafe = offsetStrafeResult.value;
  const offsetX = offsetXResult.value;
  const offsetY = offsetYResult.value;
  const amountSkip = amountSkipResult.value;
  const malformedGeometry = [
    sizeResult,
    profileRotationResult,
    signAngleResult,
    radiusResult,
    offsetStrafeResult,
    offsetXResult,
    offsetYResult,
    amountSkipResult,
  ].some((result) => result.invalid);
  if (malformedGeometry) amount = 0;

  if (amount === 0) {
    symbols.push(
      buildSignGeneratorSymbol({
        generatorId: `${generatorPrefix}:${ctx.counters.signGenerator++}`,
        profileId,
        profilePath,
        profile,
        lookup,
        categoryHint,
        size,
        amount: 0,
        profileRotation,
        signAngle,
        radius,
        offsetStrafe,
        offsetX,
        offsetY,
        defaultFlavor,
        amountSkip,
        instances: [],
        semanticEligibility: 'diagnostic_only',
        sourceKind: ctx.sourceKind,
      }),
    );
    return;
  }

  const generatorId = `${generatorPrefix}:${ctx.counters.signGenerator++}`;
  const instances = [];
  const slotCount = amount;
  const stepDeg = slotCount > 0 ? 360 / slotCount : 0;

  for (let slot = 0; slot < slotCount; slot++) {
    if (slot < amountSkip) continue;
    const placementPolarDeg = TOP_ORIGIN_DEG + slot * stepDeg + profileRotation;
    const instanceId = `${instancePrefix}:${
      isSign ? ctx.counters.signInstance++ : ctx.counters.sigilInstance++
    }`;
    const facingDeg = signAngle;
    instances.push({
      instanceId,
      slotIndex: slot,
      placementPolarDeg,
      facingDeg,
      profileRotationDeg: profileRotation,
      signAngleDeg: signAngle,
      polarRadius: radius,
      offsetStrafe,
      offsetX,
      offsetY,
      size,
      nativeLayoutMode: profile.nativeLayoutMode === 'fixed' ? 'fixed' : 'auto',
      omitted: false,
      provenance: {
        sourceKind: ctx.sourceKind,
        sourcePath: profilePath,
        generatorId,
        profileId,
      },
    });

    const instanceSymbol = buildPlacedInstanceSymbol({
      objectId: instanceId,
      profilePath,
      profile,
      lookup,
      categoryHint,
      size,
      nativeLayoutMode: profile.nativeLayoutMode === 'fixed' ? 'fixed' : 'auto',
      placementPolarDeg,
      facingDeg,
      profileRotationDeg: profileRotation,
      radius,
      offsetStrafe,
      offsetX,
      offsetY,
      defaultFlavor,
      generatorId,
      profileId,
      slotIndex: slot,
      sourceKind: ctx.sourceKind,
    });
    symbols.push(instanceSymbol);

    if (isSign && canRegisterSemanticImportGroup(instanceSymbol)) {
      registerSameKindGroup(ctx, lookup.resolvedRegistryId, profileId, instanceId);
    }
  }

  symbols.push(
    buildSignGeneratorSymbol({
      generatorId,
      profileId,
      profilePath,
      profile,
      lookup,
      categoryHint,
      size,
      amount: slotCount,
      profileRotation,
      signAngle,
      radius,
      offsetStrafe,
      offsetX,
      offsetY,
      defaultFlavor,
      amountSkip,
      instances,
      semanticEligibility:
        categoryHint === 'sign'
          ? eligibilityForSignLookup(lookup)
          : lookup.resolvedRegistryId
            ? 'eligible'
            : 'unresolved',
      sourceKind: ctx.sourceKind,
    }),
  );
}

/**
 * @param {object} lookup
 */
function eligibilityForSignLookup(lookup) {
  if (!lookup.resolvedRegistryId) return 'unresolved';
  if (lookup.customSupported) return 'eligible';
  if (lookup.ignored) return 'diagnostic_only';
  if (isCatalogDeferredSign(lookup.resolvedRegistryId)) return 'diagnostic_only';
  if (lookup.official) return 'eligible';
  return 'unsupported';
}

/**
 * @param {object} symbol
 */
function canRegisterSemanticImportGroup(symbol) {
  return (
    symbol.semanticEligibility !== 'visual_only' &&
    symbol.semanticEligibility !== 'unresolved' &&
    symbol.semanticEligibility !== 'diagnostic_only' &&
    Boolean(symbol.resolvedRegistryId)
  );
}

/**
 * @param {object} ctx
 * @param {string | null} registryId
 * @param {string} profileId
 * @param {string} instanceId
 */
function registerSameKindGroup(ctx, registryId, profileId, instanceId) {
  if (!registryId) return;
  const key = registryId;
  if (!ctx.sameKindSignGroups[key]) {
    ctx.sameKindSignGroups[key] = {
      groupId: `same-kind:${registryId.replace(/\./g, '-')}`,
      registryId,
      profileIds: [],
      instanceIds: [],
    };
  }
  const group = ctx.sameKindSignGroups[key];
  if (!group.profileIds.includes(profileId)) {
    group.profileIds.push(profileId);
  }
  group.instanceIds.push(instanceId);
}

/**
 * @param {object} params
 */
function buildSignGeneratorSymbol(params) {
  const {
    generatorId,
    profileId,
    profilePath,
    profile,
    lookup,
    categoryHint,
    size,
    amount,
    profileRotation,
    signAngle,
    radius,
    offsetStrafe,
    offsetX,
    offsetY,
    defaultFlavor,
    amountSkip,
    instances,
    semanticEligibility,
    sourceKind,
  } = params;

  const symbol = buildSymbol({
    objectId: generatorId,
    path: profilePath,
    raw: profile,
    categoryHint,
    lookup,
    sourceKind,
    geometry: {
      localPosition: { x: 0, y: 0 },
      programPosition: { x: 0, y: 0 },
      scale: size / DEFAULT_SIGN_SIZE,
      size,
      nativeLayoutMode: profile.nativeLayoutMode === 'fixed' ? 'fixed' : 'auto',
      defaultSizeApplied: profile.size === undefined,
      rotationDeg: profileRotation,
      angleDeg: signAngle,
      polarAngleDeg: TOP_ORIGIN_DEG + profileRotation,
      polarRadius: radius,
      offsetStrafe,
      offsetX,
      offsetY,
      defaultRadiusApplied: profile.radius === undefined,
      defaultFlavor,
      placementRotationDeg: profileRotation,
      facingDeg: signAngle,
    },
    semanticEligibility,
    radial: {
      generatorId,
      profileId,
      count: amount,
      amountSkip,
      radius,
      profileRotationDeg: profileRotation,
      signAngleDeg: signAngle,
      angularDistribution: {
        startAngleDeg: TOP_ORIGIN_DEG,
        stepDeg: amount > 0 ? 360 / amount : 0,
        direction: 'clockwise',
      },
      instances,
    },
  });

  if (lookup.customSupported) {
    symbol.provenance.customSupported = true;
    symbol.provenance.canonClass = 'custom_project_supported';
  }

  return symbol;
}

/**
 * @param {object} params
 */
function buildPlacedInstanceSymbol(params) {
  const {
    objectId,
    profilePath,
    profile,
    lookup,
    categoryHint,
    size,
    nativeLayoutMode,
    placementPolarDeg,
    facingDeg,
    profileRotationDeg,
    radius,
    offsetStrafe,
    offsetX,
    offsetY,
    defaultFlavor,
    generatorId,
    profileId,
    slotIndex,
    sourceKind,
  } = params;

  const rad = (placementPolarDeg * Math.PI) / 180;
  const radialX = radius * Math.cos(rad);
  const radialY = radius * Math.sin(rad);
  const tangentialX = -Math.sin(rad);
  const tangentialY = Math.cos(rad);
  const x = offsetX + radialX + offsetStrafe * tangentialX;
  const y = offsetY + radialY + offsetStrafe * tangentialY;

  const symbol = buildSymbol({
    objectId,
    path: profilePath,
    raw: profile,
    categoryHint,
    lookup,
    sourceKind,
    geometry: {
      localPosition: { x, y },
      programPosition: { x, y },
      scale: size / DEFAULT_SIGN_SIZE,
      size,
      nativeLayoutMode: nativeLayoutMode === 'fixed' ? 'fixed' : 'auto',
      defaultSizeApplied: profile.size === undefined,
      rotationDeg: profileRotationDeg,
      angleDeg: facingDeg,
      polarAngleDeg: placementPolarDeg,
      polarRadius: radius,
      offsetStrafe,
      offsetX,
      offsetY,
      defaultRadiusApplied: profile.radius === undefined,
      defaultFlavor,
      placementRotationDeg: profileRotationDeg,
      facingDeg,
    },
    semanticEligibility:
      categoryHint === 'sign'
        ? eligibilityForSignLookup(lookup)
        : lookup.resolvedRegistryId
          ? 'eligible'
          : 'unresolved',
    radial: {
      generatorId,
      profileId,
      slotIndex,
    },
  });

  if (lookup.customSupported) {
    symbol.provenance.customSupported = true;
    symbol.provenance.canonClass = 'custom_project_supported';
  }

  return symbol;
}

/**
 * @param {object} params
 */
function buildSymbol(params) {
  const {
    objectId,
    path,
    raw,
    categoryHint,
    lookup,
    geometry,
    semanticEligibility: eligibilityOverride,
    radial,
    sourceKind,
  } = params;

  const visibility = normalizeVisibilityPolicy(raw);
  const baseSemanticEligibility =
    eligibilityOverride ??
    (lookup.resolvedRegistryId
      ? lookup.ignored
        ? 'diagnostic_only'
        : 'eligible'
      : 'unresolved');
  const semanticEligibility =
    visibility.active === false ? 'visual_only' : baseSemanticEligibility;

  const provenance = {
    sourcePath: path,
    sourceKind: sourceKind ?? 'direct_json',
    rawSymbolToken: raw.name ?? raw.kind ?? null,
    registryLookup: lookup.resolvedRegistryId
      ? lookup.customSupported
        ? 'resolved'
        : lookup.ignored
          ? 'resolved'
          : 'resolved'
      : 'unresolved',
  };

  const symbol = {
    objectId,
    categoryHint,
    registryCandidate: lookup.registryCandidate,
    resolvedRegistryId: lookup.resolvedRegistryId,
    geometry: {
      ...geometry,
      visibility: {
        visible: visibility.visible,
        active: visibility.active,
        source: visibility.source,
        decorative: visibility.decorative,
      },
      sourceGeometry: { sourcePath: path, raw },
    },
    semanticEligibility,
    provenance,
  };

  if (radial) symbol.radial = radial;

  return symbol;
}

/**
 * @param {Record<string, unknown>} raw
 */
function normalizeVisibilityPolicy(raw) {
  if (raw.visible === false) {
    return {
      visible: false,
      active: false,
      source: 'explicit_visible_false',
      decorative: raw.decorative === true,
    };
  }
  if (raw.hidden === true) {
    return {
      visible: false,
      active: false,
      source: 'explicit_hidden_true',
      decorative: raw.decorative === true,
    };
  }
  if (raw.decorative === true) {
    return {
      visible: true,
      active: false,
      source: 'explicit_decorative_true',
      decorative: true,
    };
  }
  if (raw.visible === true) {
    return {
      visible: true,
      active: true,
      source: 'explicit_visible_true',
      decorative: false,
    };
  }
  if (raw.hidden === false) {
    return {
      visible: true,
      active: true,
      source: 'explicit_hidden_false',
      decorative: false,
    };
  }
  return {
    visible: true,
    active: true,
    source: 'default_visible',
    decorative: false,
  };
}

/**
 * @param {Record<string, unknown>} raw
 */
function normalizeVisualStyle(raw) {
  const stroke =
    raw.stroke && typeof raw.stroke === 'object' && !Array.isArray(raw.stroke)
      ? /** @type {Record<string, unknown>} */ (raw.stroke)
      : {};
  const color = safeStyleString(raw.color) ?? safeStyleString(stroke.color);
  const weight =
    positiveNumber(raw.weight) ??
    positiveNumber(stroke.weight) ??
    positiveNumber(stroke.width);
  const opacity = boundedUnit(raw.opacity) ?? boundedUnit(stroke.opacity);
  const style = {
    ...(color ? { strokeColor: color } : {}),
    ...(typeof weight === 'number' ? { strokeWeight: weight } : {}),
    ...(typeof opacity === 'number' ? { strokeOpacity: opacity } : {}),
  };
  return Object.keys(style).length > 0 ? style : null;
}

/**
 * @param {unknown} value
 */
function safeStyleString(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > 128 || containsUnsafeExternalString(text)) return null;
  return text;
}

/**
 * @param {unknown} value
 */
function positiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * @param {unknown} value
 * @param {{ positive?: boolean; nonNegative?: boolean; integer?: boolean; maximum?: number }} [bounds]
 */
function isFiniteGeometryNumber(value, bounds = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const maximum = bounds.maximum ?? MAX_GEOMETRY_MAGNITUDE;
  if (Math.abs(value) > maximum) return false;
  if (bounds.positive && value <= 0) return false;
  if (bounds.nonNegative && value < 0) return false;
  if (bounds.integer && !Number.isInteger(value)) return false;
  return true;
}

/**
 * Validate one explicit geometry field while preserving a finite render-safe
 * fallback. Missing values remain eligible for documented defaults.
 *
 * @param {Record<string, unknown>} raw
 * @param {string} key
 * @param {number} fallback
 * @param {string} sourcePath
 * @param {object} ctx
 * @param {{ positive?: boolean; nonNegative?: boolean; integer?: boolean; maximum?: number }} [bounds]
 */
function normalizeGeometryNumber(raw, key, fallback, sourcePath, ctx, bounds = {}) {
  if (raw[key] === undefined) return { value: fallback, invalid: false };
  if (isFiniteGeometryNumber(raw[key], bounds)) {
    return { value: raw[key], invalid: false };
  }
  diagnoseGeometryField(raw, key, sourcePath, ctx, bounds);
  return { value: fallback, invalid: true };
}

/**
 * @param {Record<string, unknown>} raw
 * @param {string} key
 * @param {string} sourcePath
 * @param {object} ctx
 * @param {{ positive?: boolean; nonNegative?: boolean; integer?: boolean; maximum?: number }} [bounds]
 */
function diagnoseGeometryField(raw, key, sourcePath, ctx, bounds = {}) {
  if (raw[key] === undefined || isFiniteGeometryNumber(raw[key], bounds)) return false;
  ctx.diagnostics.push(
    makeDiagnostic({
      code: 'import.geometry_malformed',
      status: 'invalid_structure',
      sourceKind: ctx.sourceKind,
      sourcePath,
      message: `Geometry field ${key} must be a finite number within supported bounds`,
      fallback: 'invalid_structure',
    }),
  );
  return true;
}

/**
 * @param {unknown} value
 */
function boundedUnit(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

/**
 * @param {object} params
 */
function makeDiagnostic(params) {
  return {
    code: params.code,
    status: params.status,
    sourcePath: params.sourcePath,
    normalizedObjectId: params.normalizedObjectId ?? null,
    radialGeneratorId: params.radialGeneratorId ?? null,
    rawSymbolToken: params.rawSymbolToken ?? null,
    registryLookup: params.registryLookup ?? 'not_applicable',
    customImageMarker: params.customImageMarker ?? false,
    conservativeFallback: params.fallback,
    message: params.message,
    provenance: {
      sourceKind: params.sourceKind ?? 'direct_json',
      sourcePath: params.sourcePath,
    },
  };
}

/**
 * @param {object[]} diagnostics
 */
function sortDiagnostics(diagnostics) {
  const precedence = {
    'import.share_decode_failed': 0,
    'import.root_malformed': 0,
    'import.radial_malformed': 0,
    'import.line_malformed': 0,
    'import.geometry_malformed': 0,
    'import.ignored_external_field': 1,
    'import.unresolved_symbol': 2,
    'import.custom_image_visual_only': 3,
    'import.custom_supported_unofficial_sign': 4,
    'import.unsupported_symbol': 5,
  };
  return [...diagnostics].sort((a, b) => {
    const pa = precedence[a.code] ?? 99;
    const pb = precedence[b.code] ?? 99;
    if (pa !== pb) return pa - pb;
    return String(a.sourcePath).localeCompare(String(b.sourcePath));
  });
}

/**
 * Attach import diagnostics for symbols after seal normalization.
 * @param {object} program
 */
export function attachImportDiagnostics(program) {
  const diagnostics = [...(program.diagnostics ?? [])];
  const sourceKind = program.source?.kind ?? 'direct_json';

  for (const seal of program.seals ?? []) {
    for (const symbol of seal.symbols ?? []) {
      const path = symbol.provenance?.sourcePath ?? '';
      if (symbol.categoryHint === 'custom_image') {
        diagnostics.push(
          makeDiagnostic({
            code: 'import.custom_image_visual_only',
            status: 'visual_only',
            sourcePath: path,
            normalizedObjectId: symbol.objectId,
            rawSymbolToken: symbol.provenance?.rawSymbolToken,
            registryLookup: 'custom_visual',
            customImageMarker: true,
            message: 'Custom image imported as renderable visual; image cannot define WHA semantics',
            fallback: 'visual_only',
            sourceKind,
          }),
        );
        symbol.semanticEligibility = 'visual_only';
      } else if (symbol.semanticEligibility === 'visual_only') {
        continue;
      } else if (!symbol.resolvedRegistryId) {
        diagnostics.push(
          makeDiagnostic({
            code: 'import.unresolved_symbol',
            status: 'unsupported_symbol',
            sourcePath: path,
            normalizedObjectId: symbol.objectId,
            rawSymbolToken: symbol.provenance?.rawSymbolToken,
            registryLookup: 'unresolved',
            message: 'External token did not resolve to a stable registry ID',
            fallback: 'unsupported_symbol',
            sourceKind,
          }),
        );
        symbol.semanticEligibility = 'unresolved';
      } else if (symbol.provenance?.customSupported) {
        diagnostics.push(
          makeDiagnostic({
            code: 'import.custom_supported_unofficial_sign',
            status: 'compiled_with_warnings',
            sourcePath: path,
            normalizedObjectId: symbol.objectId,
            rawSymbolToken: symbol.provenance?.rawSymbolToken,
            registryLookup: 'resolved',
            message: `Resolves to ${symbol.resolvedRegistryId} as custom/project-supported unofficial sign`,
            fallback: 'compiled_with_warnings',
            sourceKind,
          }),
        );
      } else if (
        symbol.semanticEligibility === 'diagnostic_only' &&
        isCatalogDeferredSign(symbol.resolvedRegistryId)
      ) {
        diagnostics.push(
          makeDiagnostic({
            code: 'import.deferred_official_sign',
            status: 'visual_only',
            sourcePath: path,
            normalizedObjectId: symbol.objectId,
            rawSymbolToken: symbol.provenance?.rawSymbolToken,
            registryLookup: 'resolved',
            registryId: symbol.resolvedRegistryId,
            message: `Official sign ${symbol.resolvedRegistryId} resolves in catalog but has no dossier-gated active template`,
            fallback: 'visual_only',
            sourceKind,
          }),
        );
      } else if (symbol.semanticEligibility === 'diagnostic_only') {
        diagnostics.push(
          makeDiagnostic({
            code: 'import.unsupported_symbol',
            status: 'visual_only',
            sourcePath: path,
            normalizedObjectId: symbol.objectId,
            rawSymbolToken: symbol.provenance?.rawSymbolToken,
            registryLookup: 'resolved',
            message: 'Ignored unofficial sign label; no active effect',
            fallback: 'visual_only',
            sourceKind,
          }),
        );
      }
    }
  }

  program.diagnostics = sortDiagnostics(diagnostics);
  program.unresolvedObjects = collectUnresolvedObjects(program.seals ?? []);
  return program;
}

/**
 * Full import pipeline: normalize then attach symbol diagnostics.
 * @param {unknown} input
 * @param {object} [options]
 */
export function importSpell(input, options) {
  return attachImportDiagnostics(importSpellFromJson(input, options));
}
