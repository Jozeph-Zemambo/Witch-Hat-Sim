// Levitation sign-geometry resolver.
import { LIGHT_MAGIC } from '../visual/lightMagic.js';
//
// Levitation reuses the Column sign's weighted radial geometry but applies the
// resolved direction differently (see spec/sign-descriptions/levitation.md). This
// module is framework-agnostic (no THREE / no React) so the controls readout, the
// 3D scene, and tests can all share one source of truth.
//
// Key spec rules encoded here:
//   * lateralBias = sum(signDirection[i] * signWeight[i])  (in-plane vector sum)
//   * An inward sign points THROUGH the center, so its motion travels toward the
//     side OPPOSITE the sign's placement: signDirection(inward) = -positionUnit.
//   * Equal inward signs placed symmetrically cancel their lateral vectors but keep
//     their lift -> "centered support", not zero levitation power.
//   * Tangential facing contributes torque, never translation.
//   * Increasing every sign equally raises support (normalLift) without bias;
//     increasing one sign raises its share of the imbalance.

export const DOMAINS = [
  {
    id: 'fire',
    label: 'Fire',
    target: 'generated_output',
    output: 'orb',
    glyph: '🔥',
    color: '#ff7a2f',
    accent: '#ffd27a',
    blurb: 'Generated fire, held or launched as a flame orb.',
  },
  {
    id: 'water',
    label: 'Water',
    target: 'generated_output',
    output: 'orb',
    glyph: '💧',
    color: '#33a7e0',
    accent: '#bfeeff',
    blurb: 'Generated water, held or launched as a liquid orb.',
  },
  {
    id: 'light',
    label: 'Light',
    target: 'generated_output',
    output: 'orb',
    glyph: '✦',
    color: LIGHT_MAGIC.body,
    accent: LIGHT_MAGIC.highlight,
    blurb: 'Generated light, held or launched as a glowing orb.',
  },
  {
    id: 'earth',
    label: 'Earth',
    target: 'generated_output',
    output: 'mass',
    glyph: '⛰',
    color: '#a9794c',
    accent: '#d8b58a',
    blurb: 'Generated earth, held or launched as a compact rocky mass.',
  },
  {
    id: 'wind',
    label: 'Wind',
    target: 'seal_carrier',
    output: 'carrier',
    glyph: '🌀',
    color: '#bfe9d0',
    accent: '#eafff4',
    blurb: 'Acts on the carrier bearing the seal — sustained guidance, not an orb.',
  },
];

export function domainById(id) {
  return DOMAINS.find((domain) => domain.id === id) ?? DOMAINS[0];
}

// Shared tuning so the controls readout and the 3D scene resolve identically.
export const RESOLVER_DEFAULTS = { refSize: 0.7, baseLift: 1 };

// --- Layout presets ---------------------------------------------------------
// Each preset is a function of the global sign size so the size slider scales the
// whole layout (raising support) while a preset's internal ratios create (or
// cancel) lateral / tangential imbalance.
export const LAYOUTS = [
  {
    id: 'balanced_pair',
    label: 'Balanced pair',
    note: 'Two equal inward signs, 180° apart → centered support.',
    expectedMode: 'stable_hover',
    build: (size) => [
      { angle: 0, size, facing: 'inward' },
      { angle: Math.PI, size, facing: 'inward' },
    ],
  },
  {
    id: 'balanced_quad',
    label: 'Balanced quad',
    note: 'Four equal inward signs → strong, very stable centered support.',
    expectedMode: 'stable_hover',
    build: (size) => [
      { angle: 0, size, facing: 'inward' },
      { angle: Math.PI / 2, size, facing: 'inward' },
      { angle: Math.PI, size, facing: 'inward' },
      { angle: (3 * Math.PI) / 2, size, facing: 'inward' },
    ],
  },
  {
    id: 'single',
    label: 'Single sign',
    note: 'One inward sign → lift plus drift toward the opposite side.',
    expectedMode: 'lift_with_drift',
    build: (size) => [{ angle: Math.PI, size, facing: 'inward' }],
  },
  {
    id: 'unequal_opposing',
    label: 'Unequal opposing',
    note: 'Opposed signs, one larger → partial cancel, angled along the larger.',
    expectedMode: 'lift_with_drift',
    build: (size) => [
      { angle: 0, size: size * 1.85, facing: 'inward' },
      { angle: Math.PI, size: size * 0.8, facing: 'inward' },
    ],
  },
  {
    id: 'tangential_chasing',
    label: 'Tangential chasing',
    note: 'Signs face around the ring → centered lift plus rotation (torque).',
    expectedMode: 'lift_with_rotation',
    build: (size) => [
      { angle: 0, size, facing: 'ccw' },
      { angle: Math.PI / 2, size, facing: 'ccw' },
      { angle: Math.PI, size, facing: 'ccw' },
      { angle: (3 * Math.PI) / 2, size, facing: 'ccw' },
    ],
  },
  {
    id: 'chasing_uneven',
    label: 'Chasing + drift',
    note: 'Tangential chase plus one radial sign → lift, translate, and rotate.',
    expectedMode: 'lift_translate_rotate',
    build: (size) => [
      { angle: 0, size, facing: 'ccw' },
      { angle: Math.PI / 2, size, facing: 'ccw' },
      { angle: Math.PI, size, facing: 'ccw' },
      { angle: (3 * Math.PI) / 2, size: size * 1.4, facing: 'inward' },
    ],
  },
];

export function layoutById(id) {
  return LAYOUTS.find((layout) => layout.id === id) ?? LAYOUTS[0];
}

const EPS = 1e-4;

// In-plane direction contributed by one sign, given its facing.
function signDirection(sign) {
  const cos = Math.cos(sign.angle);
  const sin = Math.sin(sign.angle);
  switch (sign.facing) {
    case 'outward':
      // Points away from center, toward the sign's own side.
      return { x: cos, y: sin, radial: true };
    case 'cw':
    case 'ccw':
      // Tangential: perpendicular to the radius. Handled as torque, not translation.
      return { x: 0, y: 0, radial: false };
    case 'inward':
    default:
      // Points through the center -> motion travels to the OPPOSITE side.
      return { x: -cos, y: -sin, radial: true };
  }
}

/**
 * Resolve a set of sign profiles into Levitation motion channels.
 *
 * @param {Array<{angle:number,size:number,facing:string}>} signs
 * @param {object} [opts]
 * @param {number} [opts.refSize=1]        size that maps to baseline lift
 * @param {number} [opts.baseLift=1]       lift produced at the reference size
 * @param {number} [opts.lateralGain=1]    tuning: how strongly imbalance angles the path
 * @returns {object} resolved motion channels
 */
export function resolveLevitation(signs, opts = {}) {
  const refSize = opts.refSize ?? 1;
  const baseLift = opts.baseLift ?? 1;
  const lateralGain = opts.lateralGain ?? 1;

  const lateral = { x: 0, y: 0 };
  let totalWeight = 0;
  let torque = 0;

  for (const sign of signs) {
    const weight = Math.max(0, sign.size ?? 0);
    totalWeight += weight;
    const dir = signDirection(sign);
    lateral.x += dir.x * weight;
    lateral.y += dir.y * weight;
    if (sign.facing === 'ccw') torque += weight;
    else if (sign.facing === 'cw') torque -= weight;
  }

  const count = Math.max(1, signs.length);
  const avgSize = totalWeight / count;
  // Every-sign-equal scaling raises support; this is the spell-normal lift.
  const normalLift = baseLift * (avgSize / refSize);

  const lateralMag = Math.hypot(lateral.x, lateral.y);
  // 0 for a perfectly balanced layout, ~1 for a single sign. Drives how far the
  // resolved path tips off the spell normal.
  const driftFraction = totalWeight > EPS ? lateralMag / totalWeight : 0;
  // Same idea for rotation: torque relative to total sign weight.
  const torqueFraction = totalWeight > EPS ? torque / totalWeight : 0;

  const hasLateral = lateralMag > EPS;
  const hasTorque = Math.abs(torque) > EPS;
  const balanced = !hasLateral && !hasTorque;

  let motionMode = 'stable_hover';
  if (hasLateral && hasTorque) motionMode = 'lift_translate_rotate';
  else if (hasLateral) motionMode = 'lift_with_drift';
  else if (hasTorque) motionMode = 'lift_with_rotation';

  // 2D unit direction of the lateral bias within the spell plane.
  const lateralUnit = hasLateral
    ? { x: lateral.x / lateralMag, y: lateral.y / lateralMag }
    : { x: 0, y: 0 };

  // Angle of the resolved path off the spell normal (0 = straight along normal,
  // 90° = fully lateral). lateralGain is the spec's open tuning knob for how
  // perpendicular a single-sign launch should read.
  const tiltOffNormalRad = Math.atan2(lateralMag * lateralGain, Math.max(normalLift, EPS));

  return {
    signs,
    target: opts.target ?? 'generated_output',
    balanced,
    motionMode,
    normalLift,
    avgSize,
    totalWeight,
    lateral, // raw weighted 2D vector in plane coords (x along axisU, y along axisV)
    lateralUnit,
    lateralMag,
    driftFraction,
    torque,
    torqueFraction,
    torqueDirection: hasTorque ? (torque > 0 ? 'ccw' : 'cw') : 'none',
    tiltOffNormalRad,
    tiltOffNormalDeg: (tiltOffNormalRad * 180) / Math.PI,
  };
}

/**
 * Human-readable description of the resolved motion, used in the lab readout.
 */
export function describeMotion(resolved, domain) {
  const carrier = domain.target === 'seal_carrier';
  switch (resolved.motionMode) {
    case 'stable_hover':
      return carrier
        ? 'Symmetric → carrier propelled straight along the spell normal.'
        : 'Symmetric → output held centered above the seal.';
    case 'lift_with_drift':
      return carrier
        ? 'Uneven → carrier guided along an angled path (lift + drift).'
        : 'Uneven → output ejected along an angled path (lift + drift).';
    case 'lift_with_rotation':
      return carrier
        ? 'Tangential → carrier lifts while spinning (lift + torque).'
        : 'Tangential → output lifts while spinning (lift + torque).';
    case 'lift_translate_rotate':
      return carrier
        ? 'Mixed → carrier lifts, drifts, and rotates together.'
        : 'Mixed → output lifts, drifts, and rotates together.';
    default:
      return '';
  }
}
