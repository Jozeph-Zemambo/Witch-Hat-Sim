import { parseSpellMakerName } from './registry.js';
import { SPELL_MAKER_DEFAULTS } from './spell-maker-defaults.js';

export { SPELL_MAKER_DEFAULTS } from './spell-maker-defaults.js';

const PROJECT_DEFAULTS = Object.freeze({
  sealScale: 1,
  sealAngle: 0,
  sealOffset: 0,
  ringRadius: 0,
  ringWeight: 10,
  signSize: 200,
  signAmount: 8,
  signRadius: 0,
  signAngle: 0,
  signRotation: 0,
  signSkip: 0,
  sigilSize: 400,
  sigilAngle: 0,
});

const DISPLAY_TOKENS = Object.freeze({
  aeriforms_defined: 'Aeriforms Defined',
  bird_a: 'Bird A',
  bird_b: 'Bird B',
  collection: 'Collection',
  convergence: 'Convergence',
  crosshair: 'Crosshair',
  crush: 'Crush',
  dispersion: 'Dispersion',
  sign_of_wind: 'Sign of Wind',
  sights_set: 'Sights Set',
  wind_underfoot: 'Wind Underfoot',
  whorling_winds: 'Whorling Winds',
});

/**
 * Convert project-authored spell JSON (`signProfiles[].kind`) into the cleaned
 * WHA Spell Maker JSON shape used by https://wha-spell-maker.daviamsilva.dev.
 *
 * @param {unknown} input
 * @returns {object}
 */
export function toSpellMakerJson(input) {
  const root = asObject(input);
  const out = {};

  assignNonDefault(out, 'name', stringValue(root.name ?? root.title), SPELL_MAKER_DEFAULTS.spell.name);
  out.author = stringValue(root.author, SPELL_MAKER_DEFAULTS.spell.author);
  assignNonDefault(
    out,
    'description',
    stringValue(root.description),
    SPELL_MAKER_DEFAULTS.spell.description,
  );
  assignNonDefault(out, 'background', root.background, SPELL_MAKER_DEFAULTS.spell.background);
  assignNonDefault(
    out,
    'backgroundColor',
    root.backgroundColor,
    SPELL_MAKER_DEFAULTS.spell.backgroundColor,
  );

  out.seals = arrayValue(root.seals).map((seal) =>
    projectSealToSpellMaker(asObject(seal)),
  );

  return out;
}

/**
 * Convert WHA Spell Maker JSON into the project fixture shape. Website defaults
 * that affect geometry are materialized because the website omits them.
 *
 * @param {unknown} input
 * @param {{ materializeDefaults?: boolean }} [options]
 * @returns {object}
 */
export function fromSpellMakerJson(input, options = {}) {
  const materializeDefaults = options.materializeDefaults ?? true;
  const root = asObject(input);
  const out = {};

  assignIfPresent(out, 'title', stringValue(root.name ?? root.title));
  assignIfPresent(out, 'author', stringValue(root.author));
  assignIfPresent(out, 'description', stringValue(root.description));
  out.seals = arrayValue(root.seals).map((seal) =>
    spellMakerSealToProject(asObject(seal), { materializeDefaults }),
  );

  return out;
}

/**
 * @param {unknown} input
 * @param {{ direction?: 'auto' | 'to-spell-maker' | 'from-spell-maker'; materializeDefaults?: boolean }} [options]
 * @returns {object}
 */
export function convertSpellJson(input, options = {}) {
  const direction = options.direction ?? 'auto';
  if (direction === 'to-spell-maker') return toSpellMakerJson(input);
  if (direction === 'from-spell-maker') return fromSpellMakerJson(input, options);

  return looksLikeProjectJson(input)
    ? toSpellMakerJson(input)
    : fromSpellMakerJson(input, options);
}

/**
 * @param {object} seal
 */
function projectSealToSpellMaker(seal) {
  const out = {};
  const transform = asObject(seal.transform);

  assignNonDefault(out, 'visible', seal.visible, SPELL_MAKER_DEFAULTS.seal.visible);
  assignNonDefault(out, 'name', stringValue(seal.name), SPELL_MAKER_DEFAULTS.seal.name);

  const sealAngle = firstNumber(
    seal.angle,
    transform.rotation,
    transform.rotationDeg,
    transform.angle,
    PROJECT_DEFAULTS.sealAngle,
  );
  assignNonDefault(out, 'angle', sealAngle, SPELL_MAKER_DEFAULTS.seal.angle);

  const scale = spellMakerScaleFromProject(seal, transform);
  assignNonDefault(out, 'scale', scale, SPELL_MAKER_DEFAULTS.seal.scale);

  const offsetX = firstNumber(
    seal.offsetX,
    sumNumbers(transform.x, transform.offsetX),
    PROJECT_DEFAULTS.sealOffset,
  );
  const offsetY = firstNumber(
    seal.offsetY,
    sumNumbers(transform.y, transform.offsetY),
    PROJECT_DEFAULTS.sealOffset,
  );
  assignNonDefault(out, 'offsetX', offsetX, SPELL_MAKER_DEFAULTS.seal.offsetX);
  assignNonDefault(out, 'offsetY', offsetY, SPELL_MAKER_DEFAULTS.seal.offsetY);

  const rings = arrayValue(seal.rings).map((ring) =>
    projectRingToSpellMaker(asObject(ring)),
  );
  const sigils = arrayValue(seal.sigils).map((sigil) =>
    projectCenterSigilToSpellMaker(asObject(sigil)),
  );
  const signs = [
    ...arrayValue(seal.signProfiles).map((profile) =>
      projectProfileToSpellMaker(asObject(profile), { projectStyle: true }),
    ),
    ...arrayValue(seal.signs).map((profile) =>
      projectProfileToSpellMaker(asObject(profile), { projectStyle: false }),
    ),
  ];
  const lines = arrayValue(seal.lines).map((line) =>
    projectLineToSpellMaker(asObject(line)),
  );

  if (rings.length > 0) out.rings = rings;
  if (sigils.length > 0) out.sigils = sigils;
  if (signs.length > 0) out.signs = signs;
  if (lines.length > 0) out.lines = lines;
  return out;
}

/**
 * @param {object} ring
 */
function projectRingToSpellMaker(ring) {
  const out = {};
  assignNonDefault(out, 'visible', ring.visible, SPELL_MAKER_DEFAULTS.ring.visible);
  assignNonDefault(out, 'name', stringValue(ring.name), SPELL_MAKER_DEFAULTS.ring.name);
  assignNonDefault(out, 'color', ring.color, SPELL_MAKER_DEFAULTS.ring.color);
  assignNonDefault(out, 'filled', ring.filled, SPELL_MAKER_DEFAULTS.ring.filled);
  assignNonDefault(out, 'fillColor', ring.fillColor, SPELL_MAKER_DEFAULTS.ring.fillColor);
  assignNonDefault(
    out,
    'radius',
    firstNumber(ring.radius, PROJECT_DEFAULTS.ringRadius),
    SPELL_MAKER_DEFAULTS.ring.radius,
  );
  assignNonDefault(
    out,
    'weight',
    firstNumber(ring.weight, PROJECT_DEFAULTS.ringWeight),
    SPELL_MAKER_DEFAULTS.ring.weight,
  );
  assignNonDefault(out, 'openingSize', ring.openingSize, SPELL_MAKER_DEFAULTS.ring.openingSize);
  assignNonDefault(out, 'openingAngle', ring.openingAngle, SPELL_MAKER_DEFAULTS.ring.openingAngle);
  assignNonDefault(
    out,
    'offsetX',
    firstNumber(ring.offsetX, ring.x, SPELL_MAKER_DEFAULTS.ring.offsetX),
    SPELL_MAKER_DEFAULTS.ring.offsetX,
  );
  assignNonDefault(
    out,
    'offsetY',
    firstNumber(ring.offsetY, ring.y, SPELL_MAKER_DEFAULTS.ring.offsetY),
    SPELL_MAKER_DEFAULTS.ring.offsetY,
  );
  return out;
}

/**
 * @param {object} sigil
 */
function projectCenterSigilToSpellMaker(sigil) {
  const out = {
    name: toSpellMakerName(sigil.name ?? sigil.kind, 'sigil'),
  };
  assignNonDefault(out, 'visible', sigil.visible, SPELL_MAKER_DEFAULTS.centerSigil.visible);
  assignNonDefault(out, 'tinted', sigil.tinted, SPELL_MAKER_DEFAULTS.centerSigil.tinted);
  assignNonDefault(out, 'color', sigil.color, SPELL_MAKER_DEFAULTS.centerSigil.color);
  assignNonDefault(out, 'prefix', stringValue(sigil.prefix), SPELL_MAKER_DEFAULTS.centerSigil.prefix);
  assignNonDefault(
    out,
    'size',
    firstNumber(sigil.size, PROJECT_DEFAULTS.sigilSize),
    SPELL_MAKER_DEFAULTS.centerSigil.size,
  );
  assignNonDefault(
    out,
    'angle',
    firstNumber(sigil.angle, PROJECT_DEFAULTS.sigilAngle),
    SPELL_MAKER_DEFAULTS.centerSigil.angle,
  );
  assignNonDefault(
    out,
    'offsetX',
    firstNumber(sigil.offsetX, sigil.x, SPELL_MAKER_DEFAULTS.centerSigil.offsetX),
    SPELL_MAKER_DEFAULTS.centerSigil.offsetX,
  );
  assignNonDefault(
    out,
    'offsetY',
    firstNumber(sigil.offsetY, sigil.y, SPELL_MAKER_DEFAULTS.centerSigil.offsetY),
    SPELL_MAKER_DEFAULTS.centerSigil.offsetY,
  );
  return out;
}

/**
 * @param {object} profile
 * @param {{ projectStyle: boolean }} options
 */
function projectProfileToSpellMaker(profile, options) {
  const rawName = profile.name ?? profile.kind;
  const parsed = parseSpellMakerName(String(rawName ?? ''));
  const category = parsed.category ?? profile.categoryHint ?? 'sign';
  const out = {
    name: toSpellMakerName(rawName, category),
  };

  assignNonDefault(out, 'visible', profile.visible, SPELL_MAKER_DEFAULTS.sign.visible);
  assignNonDefault(out, 'tinted', profile.tinted, SPELL_MAKER_DEFAULTS.sign.tinted);
  assignNonDefault(out, 'color', profile.color, SPELL_MAKER_DEFAULTS.sign.color);
  assignNonDefault(out, 'prefix', stringValue(profile.prefix), SPELL_MAKER_DEFAULTS.sign.prefix);
  assignNonDefault(
    out,
    'size',
    firstNumber(profile.size, PROJECT_DEFAULTS.signSize),
    SPELL_MAKER_DEFAULTS.sign.size,
  );
  assignNonDefault(
    out,
    'angle',
    firstNumber(profile.angle, PROJECT_DEFAULTS.signAngle),
    SPELL_MAKER_DEFAULTS.sign.angle,
  );
  assignNonDefault(out, 'offsetStrafe', profile.offsetStrafe, SPELL_MAKER_DEFAULTS.sign.offsetStrafe);

  const radiusFallback = options.projectStyle
    ? PROJECT_DEFAULTS.signRadius
    : SPELL_MAKER_DEFAULTS.sign.radius;
  assignNonDefault(
    out,
    'radius',
    firstNumber(profile.radius, radiusFallback),
    SPELL_MAKER_DEFAULTS.sign.radius,
  );

  assignNonDefault(
    out,
    'amount',
    firstNumber(profile.amount, profile.count, PROJECT_DEFAULTS.signAmount),
    SPELL_MAKER_DEFAULTS.sign.amount,
  );
  assignNonDefault(
    out,
    'amountSkip',
    firstNumber(profile.amountSkip, profile.skip, PROJECT_DEFAULTS.signSkip),
    SPELL_MAKER_DEFAULTS.sign.amountSkip,
  );
  assignNonDefault(
    out,
    'rotation',
    firstNumber(profile.rotation, PROJECT_DEFAULTS.signRotation),
    SPELL_MAKER_DEFAULTS.sign.rotation,
  );
  assignNonDefault(out, 'offsetX', profile.offsetX, SPELL_MAKER_DEFAULTS.sign.offsetX);
  assignNonDefault(out, 'offsetY', profile.offsetY, SPELL_MAKER_DEFAULTS.sign.offsetY);
  return out;
}

/**
 * @param {object} line
 */
function projectLineToSpellMaker(line) {
  const out = {};
  assignNonDefault(out, 'visible', line.visible, SPELL_MAKER_DEFAULTS.line.visible);
  assignNonDefault(out, 'name', stringValue(line.name), SPELL_MAKER_DEFAULTS.line.name);
  assignNonDefault(out, 'color', line.color, SPELL_MAKER_DEFAULTS.line.color);
  assignNonDefault(
    out,
    'weight',
    firstNumber(line.weight, SPELL_MAKER_DEFAULTS.line.weight),
    SPELL_MAKER_DEFAULTS.line.weight,
  );
  out.points = arrayValue(line.points).map((point) => {
    const p = Array.isArray(point) ? { x: point[0], y: point[1] } : asObject(point);
    const outPoint = {};
    assignNonDefault(outPoint, 'x', p.x, SPELL_MAKER_DEFAULTS.point.x);
    assignNonDefault(outPoint, 'y', p.y, SPELL_MAKER_DEFAULTS.point.y);
    return outPoint;
  });
  return out;
}

/**
 * @param {object} seal
 * @param {{ materializeDefaults: boolean }} options
 */
function spellMakerSealToProject(seal, options) {
  const out = {};
  assignIfPresent(out, 'name', stringValue(seal.name));

  const transform = {};
  assignProjectNumber(transform, 'rotation', seal.angle, SPELL_MAKER_DEFAULTS.seal.angle, options);
  const scale = firstNumber(seal.scale);
  if (typeof scale === 'number') {
    assignProjectNumber(transform, 'scale', scale / 100, PROJECT_DEFAULTS.sealScale, options);
  } else if (options.materializeDefaults) {
    transform.scale = PROJECT_DEFAULTS.sealScale;
  }
  assignProjectNumber(transform, 'x', seal.offsetX, SPELL_MAKER_DEFAULTS.seal.offsetX, options);
  assignProjectNumber(transform, 'y', seal.offsetY, SPELL_MAKER_DEFAULTS.seal.offsetY, options);
  if (Object.keys(transform).length > 0) out.transform = transform;

  const rings = arrayValue(seal.rings).map((ring) =>
    spellMakerRingToProject(asObject(ring), options),
  );
  const sigils = arrayValue(seal.sigils).map((sigil) =>
    spellMakerCenterSigilToProject(asObject(sigil), options),
  );
  const signProfiles = [];
  const signs = [];
  for (const rawProfile of arrayValue(seal.signs)) {
    const profile = asObject(rawProfile);
    const parsed = parseSpellMakerName(String(profile.name ?? profile.kind ?? ''));
    if (parsed.category === 'sigil') {
      signs.push(spellMakerRepeatedSigilToProject(profile, options));
    } else {
      signProfiles.push(spellMakerSignToProject(profile, options));
    }
  }
  const lines = arrayValue(seal.lines).map((line) =>
    spellMakerLineToProject(asObject(line), options),
  );

  if (rings.length > 0) out.rings = rings;
  if (sigils.length > 0) out.sigils = sigils;
  if (signProfiles.length > 0) out.signProfiles = signProfiles;
  if (signs.length > 0) out.signs = signs;
  if (lines.length > 0) out.lines = lines;
  return out;
}

/**
 * @param {object} ring
 * @param {{ materializeDefaults: boolean }} options
 */
function spellMakerRingToProject(ring, options) {
  const out = {};
  assignIfPresent(out, 'name', stringValue(ring.name));
  assignProjectNumber(out, 'radius', ring.radius, SPELL_MAKER_DEFAULTS.ring.radius, options);
  assignProjectNumber(out, 'weight', ring.weight, SPELL_MAKER_DEFAULTS.ring.weight, options);
  assignProjectNumber(out, 'openingSize', ring.openingSize, SPELL_MAKER_DEFAULTS.ring.openingSize, options);
  assignProjectNumber(out, 'openingAngle', ring.openingAngle, SPELL_MAKER_DEFAULTS.ring.openingAngle, options);
  assignProjectNumber(out, 'x', ring.offsetX, SPELL_MAKER_DEFAULTS.ring.offsetX, options);
  assignProjectNumber(out, 'y', ring.offsetY, SPELL_MAKER_DEFAULTS.ring.offsetY, options);
  assignIfChanged(out, 'visible', ring.visible, SPELL_MAKER_DEFAULTS.ring.visible);
  assignIfChanged(out, 'color', ring.color, SPELL_MAKER_DEFAULTS.ring.color);
  assignIfChanged(out, 'filled', ring.filled, SPELL_MAKER_DEFAULTS.ring.filled);
  assignIfChanged(out, 'fillColor', ring.fillColor, SPELL_MAKER_DEFAULTS.ring.fillColor);
  return out;
}

/**
 * @param {object} sigil
 * @param {{ materializeDefaults: boolean }} options
 */
function spellMakerCenterSigilToProject(sigil, options) {
  const out = {
    name: projectToken(sigil.name ?? sigil.kind),
  };
  assignProjectNumber(out, 'size', sigil.size, SPELL_MAKER_DEFAULTS.centerSigil.size, options);
  assignProjectNumber(out, 'angle', sigil.angle, SPELL_MAKER_DEFAULTS.centerSigil.angle, options);
  assignProjectNumber(out, 'x', sigil.offsetX, SPELL_MAKER_DEFAULTS.centerSigil.offsetX, options);
  assignProjectNumber(out, 'y', sigil.offsetY, SPELL_MAKER_DEFAULTS.centerSigil.offsetY, options);
  assignIfChanged(out, 'visible', sigil.visible, SPELL_MAKER_DEFAULTS.centerSigil.visible);
  assignIfChanged(out, 'tinted', sigil.tinted, SPELL_MAKER_DEFAULTS.centerSigil.tinted);
  assignIfChanged(out, 'color', sigil.color, SPELL_MAKER_DEFAULTS.centerSigil.color);
  assignIfChanged(out, 'prefix', sigil.prefix, SPELL_MAKER_DEFAULTS.centerSigil.prefix);
  return out;
}

/**
 * @param {object} profile
 * @param {{ materializeDefaults: boolean }} options
 */
function spellMakerSignToProject(profile, options) {
  const out = {
    kind: projectToken(profile.name ?? profile.kind),
  };
  assignSpellMakerProfileFields(out, profile, options);
  return out;
}

/**
 * @param {object} profile
 * @param {{ materializeDefaults: boolean }} options
 */
function spellMakerRepeatedSigilToProject(profile, options) {
  const out = {
    name: toSpellMakerName(profile.name ?? profile.kind, 'sigil'),
  };
  assignSpellMakerProfileFields(out, profile, options);
  return out;
}

/**
 * @param {object} out
 * @param {object} profile
 * @param {{ materializeDefaults: boolean }} options
 */
function assignSpellMakerProfileFields(out, profile, options) {
  assignProjectNumber(out, 'size', profile.size, SPELL_MAKER_DEFAULTS.sign.size, options);
  assignProjectNumber(out, 'angle', profile.angle, SPELL_MAKER_DEFAULTS.sign.angle, options);
  assignProjectNumber(out, 'offsetStrafe', profile.offsetStrafe, SPELL_MAKER_DEFAULTS.sign.offsetStrafe, options);
  assignProjectNumber(out, 'radius', profile.radius, SPELL_MAKER_DEFAULTS.sign.radius, options);
  assignProjectNumber(out, 'amount', profile.amount, SPELL_MAKER_DEFAULTS.sign.amount, options);
  assignProjectNumber(out, 'skip', profile.amountSkip, SPELL_MAKER_DEFAULTS.sign.amountSkip, options);
  assignProjectNumber(out, 'rotation', profile.rotation, SPELL_MAKER_DEFAULTS.sign.rotation, options);
  assignProjectNumber(out, 'offsetX', profile.offsetX, SPELL_MAKER_DEFAULTS.sign.offsetX, options);
  assignProjectNumber(out, 'offsetY', profile.offsetY, SPELL_MAKER_DEFAULTS.sign.offsetY, options);
  assignIfChanged(out, 'visible', profile.visible, SPELL_MAKER_DEFAULTS.sign.visible);
  assignIfChanged(out, 'tinted', profile.tinted, SPELL_MAKER_DEFAULTS.sign.tinted);
  assignIfChanged(out, 'color', profile.color, SPELL_MAKER_DEFAULTS.sign.color);
  assignIfChanged(out, 'prefix', profile.prefix, SPELL_MAKER_DEFAULTS.sign.prefix);
}

/**
 * @param {object} line
 * @param {{ materializeDefaults: boolean }} options
 */
function spellMakerLineToProject(line, options) {
  const out = {};
  assignIfPresent(out, 'name', stringValue(line.name));
  assignProjectNumber(out, 'weight', line.weight, SPELL_MAKER_DEFAULTS.line.weight, options);
  assignIfChanged(out, 'visible', line.visible, SPELL_MAKER_DEFAULTS.line.visible);
  assignIfChanged(out, 'color', line.color, SPELL_MAKER_DEFAULTS.line.color);
  out.points = arrayValue(line.points).map((point) => {
    const p = asObject(point);
    return [
      firstNumber(p.x, SPELL_MAKER_DEFAULTS.point.x),
      firstNumber(p.y, SPELL_MAKER_DEFAULTS.point.y),
    ];
  });
  return out;
}

/**
 * @param {unknown} input
 */
function looksLikeProjectJson(input) {
  const root = asObject(input);
  if (typeof root.title === 'string') return true;
  return arrayValue(root.seals).some((sealRaw) => {
    const seal = asObject(sealRaw);
    return Array.isArray(seal.signProfiles);
  });
}

/**
 * @param {object} seal
 * @param {object} transform
 */
function spellMakerScaleFromProject(seal, transform) {
  if (typeof seal.scale === 'number') return seal.scale;
  const scale = firstNumber(transform.scale, transform.scaleX, PROJECT_DEFAULTS.sealScale);
  return scale * 100;
}

/**
 * @param {unknown} raw
 * @param {'sigil' | 'sign'} category
 */
function toSpellMakerName(raw, category) {
  const text = String(raw ?? '').trim();
  const parsed = parseSpellMakerName(text);
  if (parsed.spellMakerPrefix) {
    const prefix = parsed.spellMakerPrefix;
    return `${prefix}_${displayToken(parsed.token)}`;
  }

  const token = projectToken(text);
  const prefix = category === 'sigil' ? 'sigil' : 'sign';
  return `${prefix}_${displayToken(token)}`;
}

/**
 * @param {unknown} raw
 */
function projectToken(raw) {
  const text = String(raw ?? '').trim();
  const parsed = parseSpellMakerName(text);
  const token = parsed.token || text;
  return token
    .replace(/^(sign|sigil)\./i, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');
}

/**
 * @param {string} token
 */
function displayToken(token) {
  const normalized = projectToken(token);
  if (DISPLAY_TOKENS[normalized]) return DISPLAY_TOKENS[normalized];
  return normalized
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

/**
 * @param {object} out
 * @param {string} key
 * @param {unknown} value
 * @param {unknown} defaultValue
 */
function assignNonDefault(out, key, value, defaultValue) {
  if (value === undefined || Object.is(value, defaultValue)) return;
  out[key] = value;
}

/**
 * @param {object} out
 * @param {string} key
 * @param {unknown} value
 * @param {unknown} defaultValue
 */
function assignIfChanged(out, key, value, defaultValue) {
  if (value === undefined || Object.is(value, defaultValue)) return;
  out[key] = value;
}

/**
 * @param {object} out
 * @param {string} key
 * @param {unknown} value
 */
function assignIfPresent(out, key, value) {
  if (value === undefined || value === null || value === '') return;
  out[key] = value;
}

/**
 * @param {object} out
 * @param {string} key
 * @param {unknown} value
 * @param {number} fallback
 * @param {{ materializeDefaults: boolean }} options
 */
function assignProjectNumber(out, key, value, fallback, options) {
  const number = firstNumber(value);
  if (typeof number === 'number') {
    out[key] = number;
  } else if (options.materializeDefaults) {
    out[key] = fallback;
  }
}

/**
 * @param {unknown[]} values
 */
function firstNumber(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

/**
 * @param {unknown[]} values
 */
function sumNumbers(...values) {
  let seen = false;
  let total = 0;
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      seen = true;
      total += value;
    }
  }
  return seen ? total : undefined;
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 */
function stringValue(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

/**
 * @param {unknown} value
 */
function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/**
 * @param {unknown} value
 */
function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}
