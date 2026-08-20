/**
 * Canonical lore-glyph geometry shared by DOM/SVG and scene adapters.
 * Sigils are centered on (0, 0). Signs anchor at (0, 0), with +y inward.
 */
export const LORE_GLYPH_IDS = Object.freeze([
  'sigil.water', 'sigil.fire', 'sigil.earth', 'sigil.wind', 'sigil.light',
  'sign.column', 'sign.dispersion', 'sign.levitation',
]);

const path = (commands, role) => Object.freeze({ type: 'path', role, commands: Object.freeze(commands) });
const circle = (cx, cy, r, fill, role) => Object.freeze({ type: 'circle', role, cx, cy, r, fill });
const M = (x, y) => ({ op: 'M', x, y });
const L = (x, y) => ({ op: 'L', x, y });
const C = (x1, y1, x2, y2, x, y) => ({ op: 'C', x1, y1, x2, y2, x, y });
const Q = (x1, y1, x, y) => ({ op: 'Q', x1, y1, x, y });
const Z = () => ({ op: 'Z' });

const SIGILS = {
  'sigil.water': {
    label: 'Water', bounds: [-0.54, -0.56, 0.58, 0.56],
    landmarks: ['central_s_flow', 'left_round_droplet', 'right_elongated_droplet'],
    primitives: [
      path([M(0.1, 0.5), C(-0.08, 0.51, -0.16, 0.36, -0.11, 0.2), C(-0.05, 0.02, 0.2, -0.13, 0.19, -0.31), C(0.18, -0.46, 0.09, -0.54, -0.06, -0.51)], 'central_s_flow'),
      path([M(-0.36, 0.23), C(-0.39, 0.08, -0.49, -0.1, -0.47, -0.2), C(-0.45, -0.34, -0.25, -0.36, -0.22, -0.21), C(-0.2, -0.11, -0.31, 0.08, -0.36, 0.23), Z()], 'left_round_droplet'),
      path([M(0.38, 0.23), C(0.24, 0.25, 0.17, 0.13, 0.2, 0.01), C(0.23, -0.14, 0.33, -0.37, 0.4, -0.5), C(0.45, -0.34, 0.55, -0.08, 0.56, 0.04), C(0.57, 0.15, 0.5, 0.23, 0.38, 0.23), Z()], 'right_elongated_droplet'),
    ],
  },
  'sigil.fire': {
    label: 'Fire', bounds: [-0.56, -0.52, 0.56, 0.55],
    landmarks: ['upright_triangle', 'extended_base', 'center_stem', 'left_spark', 'right_spark'],
    primitives: [
      path([M(0, 0.5), L(-0.39, -0.2), L(0.39, -0.2), Z()], 'upright_triangle'),
      path([M(-0.43, -0.2), L(0.43, -0.2)], 'extended_base'),
      path([M(0, -0.2), L(0, -0.43)], 'center_stem'),
      path([M(-0.27, 0.14), L(-0.48, 0.28)], 'left_spark'),
      path([M(0.27, 0.14), L(0.48, 0.28)], 'right_spark'),
    ],
  },
  'sigil.earth': {
    label: 'Earth', bounds: [-0.64, -0.54, 0.64, 0.48],
    landmarks: ['top_bar', 'center_stem', 'hooked_v', 'lower_bar', 'left_dot', 'right_dot'],
    primitives: [
      path([M(-0.43, 0.42), L(0.43, 0.42)], 'top_bar'),
      path([M(0, 0.42), L(0, -0.34)], 'center_stem'),
      path([M(-0.22, 0.16), L(-0.45, -0.05), L(0, -0.36), L(0.45, -0.05), L(0.22, 0.16)], 'hooked_v'),
      path([M(-0.37, -0.48), L(0.37, -0.48)], 'lower_bar'),
      circle(-0.58, 0.07, 0.052, true, 'left_dot'), circle(0.58, 0.07, 0.052, true, 'right_dot'),
    ],
  },
  'sigil.wind': {
    label: 'Wind', bounds: [-0.66, -0.56, 0.66, 0.56],
    landmarks: ['double_spiral_s', 'left_dash', 'right_dash', 'left_tick', 'right_tick'],
    primitives: [
      path([M(0.07, 0.5), C(0.31, 0.5, 0.36, 0.2, 0.18, 0.11), C(0.03, 0.03, -0.1, 0.13, -0.04, 0.24), C(0.02, 0.34, 0.15, 0.29, 0.17, 0.17), C(0.2, -0.02, -0.2, -0.05, -0.18, -0.22), C(-0.16, -0.36, -0.02, -0.41, 0.04, -0.3), C(0.1, -0.19, -0.03, -0.08, -0.18, -0.16), C(-0.36, -0.25, -0.31, -0.52, -0.07, -0.52)], 'double_spiral_s'),
      path([M(-0.62, 0), L(-0.32, 0)], 'left_dash'), path([M(0.32, 0), L(0.62, 0)], 'right_dash'),
      path([M(-0.51, 0.27), L(-0.36, 0.13)], 'left_tick'), path([M(0.51, 0.27), L(0.36, 0.13)], 'right_tick'),
    ],
  },
  'sigil.light': {
    label: 'Light', bounds: [-0.6, -0.6, 0.6, 0.6],
    landmarks: ['axis_square', 'inscribed_diamond', 'vertical_rays', 'horizontal_rays'],
    primitives: [
      path([M(-0.32, 0.32), L(0.32, 0.32), L(0.32, -0.32), L(-0.32, -0.32), Z()], 'axis_square'),
      path([M(0, 0.39), L(0.39, 0), L(0, -0.39), L(-0.39, 0), Z()], 'inscribed_diamond'),
      path([M(0, 0.56), L(0, 0.39), M(0, -0.39), L(0, -0.56)], 'vertical_rays'),
      path([M(-0.56, 0), L(-0.39, 0), M(0.39, 0), L(0.56, 0)], 'horizontal_rays'),
    ],
  },
};

const SIGN_META = {
  'sign.column': { label: 'Column', landmarks: ['wide_base', 'inward_stick'] },
  'sign.dispersion': { label: 'Dispersion', landmarks: ['base_bar', 'inward_stick', 'lower_cup'] },
  'sign.levitation': { label: 'Levitation', landmarks: ['narrow_base', 'inward_stick', 'arrow_head'] },
};

/** 93.23% of head/shaft dimensional growth is assigned to stick length. */
export function signGrowthMetrics(size = 200, availableGap = 1) {
  const q = clamp((finite(size, 200) - 100) / 200, 0, 1);
  return Object.freeze({
    q,
    stickLength: availableGap * (0.28 + 0.62 * q),
    headWidth: availableGap * (0.18 + 0.03 * q),
    headHeight: availableGap * (0.11 + 0.015 * q),
    strokeWidth: availableGap * (0.018 + 0.004 * q),
    dimensionalGrowthToStick: 0.62 / (0.62 + 0.03 + 0.015),
  });
}

function signPrimitives(id, metrics) {
  const { stickLength: length, headWidth: width, headHeight: height } = metrics;
  if (id === 'sign.column') return [path([M(-width / 2, 0), L(width / 2, 0)], 'wide_base'), path([M(0, 0), L(0, length)], 'inward_stick')];
  if (id === 'sign.dispersion') return [path([M(-width / 2, 0), L(width / 2, 0)], 'base_bar'), path([M(0, 0), L(0, length)], 'inward_stick'), path([M(-width / 2, -height * 0.5), Q(0, -height * 1.08, width / 2, -height * 0.5)], 'lower_cup')];
  const arrowWidth = width * 0.78;
  const baseWidth = width * 0.62;
  return [path([M(-baseWidth / 2, 0), L(baseWidth / 2, 0)], 'narrow_base'), path([M(0, 0), L(0, length)], 'inward_stick'), path([M(-arrowWidth / 2, length - height), L(0, length), L(arrowWidth / 2, length - height)], 'arrow_head')];
}

export function isLoreGlyphId(id) { return LORE_GLYPH_IDS.includes(id); }
export function glyphRenderPolicy(id) { return isLoreGlyphId(id) ? 'lore_glyph' : 'unknown_dot_label'; }
export function getGlyphDefinition(id) {
  if (SIGILS[id]) return Object.freeze({ id, category: 'sigil', canonicalAxis: null, ...SIGILS[id] });
  if (SIGN_META[id]) return Object.freeze({ id, category: 'sign', canonicalAxis: '+y_inward', ringAnchor: { x: 0, y: 0 }, ...SIGN_META[id] });
  return null;
}

export function resolveGlyphGeometry(id, options = {}) {
  const definition = getGlyphDefinition(id);
  if (!definition) return null;
  if (definition.category === 'sigil') return Object.freeze({ ...definition, strokeWidth: 0.034, primitives: definition.primitives });
  const metrics = signGrowthMetrics(options.size, options.availableGap ?? 1);
  const lower = id === 'sign.dispersion' ? -metrics.headHeight * 1.1 : -metrics.strokeWidth;
  return Object.freeze({ ...definition, metrics, strokeWidth: metrics.strokeWidth, bounds: [-metrics.headWidth * 0.58, lower, metrics.headWidth * 0.58, metrics.stickLength + metrics.strokeWidth], primitives: Object.freeze(signPrimitives(id, metrics)) });
}

export function glyphCommandsToSvgPath(commands) {
  return commands.map((command) => {
    if (command.op === 'Z') return 'Z';
    if (command.op === 'M' || command.op === 'L') return `${command.op}${n(command.x)} ${n(-command.y)}`;
    if (command.op === 'C') return `C${n(command.x1)} ${n(-command.y1)} ${n(command.x2)} ${n(-command.y2)} ${n(command.x)} ${n(-command.y)}`;
    return `Q${n(command.x1)} ${n(-command.y1)} ${n(command.x)} ${n(-command.y)}`;
  }).join(' ');
}

/** Pure string adapter Stage 4 can inject or translate into DOM/SVG nodes. */
export function glyphToSvg(id, options = {}) {
  const geometry = resolveGlyphGeometry(id, options);
  if (!geometry) return null;
  const [minX, minY, maxX, maxY] = geometry.bounds;
  const padding = geometry.strokeWidth * 1.6;
  const viewBox = `${n(minX - padding)} ${n(-maxY - padding)} ${n(maxX - minX + padding * 2)} ${n(maxY - minY + padding * 2)}`;
  const color = escapeAttribute(options.color ?? 'currentColor');
  const title = escapeAttribute(options.title ?? geometry.label);
  const body = geometry.primitives.map((primitive) => primitive.type === 'circle'
    ? `<circle data-role="${primitive.role}" cx="${n(primitive.cx)}" cy="${n(-primitive.cy)}" r="${n(primitive.r)}"${primitive.fill ? ` fill="${color}"` : ' fill="none"'}/>`
    : `<path data-role="${primitive.role}" d="${glyphCommandsToSvgPath(primitive.commands)}" fill="none"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${title}" data-glyph-id="${id}" viewBox="${viewBox}" stroke="${color}" stroke-width="${n(geometry.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

function finite(value, fallback) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function n(value) { return Number(value.toFixed(5)); }
function escapeAttribute(value) { return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
