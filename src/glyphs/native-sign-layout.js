import { resolveGlyphGeometry } from './lore-glyphs.js';

const DEFAULT_RING_RADIUS = 100;
const DEFAULT_CENTER_CLEARANCE = 24;
const MAX_SOLVE_GAP = 10000;
const SOLVE_ITERATIONS = 48;

/**
 * Pure native sign layout contract shared by authoring, SVG, and Three/R3F.
 * Coordinates are in the spell's 2D ring plane: +Y is up and the canonical
 * sign axis (+Y) points inward from the supplied radial anchor at facing 0°.
 *
 * @param {{
 *   containingRingRadius?: number,
 *   signAnchor?: { x?: number; y?: number },
 *   facingDeg?: number,
 *   glyphId?: string,
 *   size?: number,
 *   canonicalGlyph?: object,
 *   centerClearance?: number,
 *   strokePadding?: number,
 * }} options
 */
export function resolveNativeSignLayout(options = {}) {
  const containingRingRadius = Math.max(0, finite(options.containingRingRadius, DEFAULT_RING_RADIUS));
  const centerClearance = clamp(
    finite(options.centerClearance, DEFAULT_CENTER_CLEARANCE),
    0,
    containingRingRadius,
  );
  const glyphId = options.glyphId ?? options.canonicalGlyph?.id ?? 'sign.column';
  const size = finite(options.size ?? options.canonicalGlyph?.size, 200);
  const fitMode = options.fitMode === 'fixed' ? 'fixed' : 'auto';
  const geometry = options.canonicalGlyph ?? resolveGlyphGeometry(glyphId, { size, availableGap: 1 });
  if (!geometry || geometry.category !== 'sign') return null;
  // Solve the shared annular space against the largest native sign. Smaller
  // authored sizes reuse that same available gap, so size remains monotonic
  // instead of letting a small sign claim a larger normalized gap.
  const containmentGeometry = resolveGlyphGeometry(glyphId, {
    size: Math.max(size, finite(options.containmentSize, 300)),
    availableGap: 1,
  }) ?? geometry;

  const anchor = normalizedAnchor(options.signAnchor);
  const facingDeg = finite(options.facingDeg, 0);
  const strokePadding = Math.max(
    0,
    finite(options.strokePadding, geometry.strokeWidth * 1.8),
  );
  const canonicalCorners = paddedCorners(geometry.bounds, strokePadding);
  const canonicalContainment = paddedCorners(containmentGeometry.bounds, strokePadding);
  const corners = canonicalCorners.map((corner) => orientCanonicalPoint(corner, anchor, facingDeg));
  const containmentCorners = canonicalContainment.map((corner) =>
    orientCanonicalPoint(corner, anchor, facingDeg),
  );
  const solveCorners = [...containmentCorners, ...corners];

  const fits = (gap) => placementInterval({
    corners: solveCorners,
    anchor,
    gap,
    containingRingRadius,
    centerClearance,
  });
  // Baseline gap solved at facing 0. A rotated glyph can "fit" diagonally
  // across the annulus with a much larger gap (its rotated corners slip past
  // the radial corner test), which used to inflate the sign at certain
  // facings. Capping by the canonical-orientation gap keeps visual size
  // rotation-invariant: rotation may only shrink-to-fit, never grow.
  const baselineCorners = [...canonicalContainment, ...canonicalCorners].map((corner) =>
    orientCanonicalPoint(corner, anchor, 0),
  );
  const baselineGap = solveLargestGap((gap) => placementInterval({
    corners: baselineCorners,
    anchor,
    gap,
    containingRingRadius,
    centerClearance,
  }));

  let availableGap = fitMode === 'fixed'
    ? baselineGap
    : Math.min(solveLargestGap(fits), baselineGap);
  // A requested radial distance further caps the gap so the glyph still fits
  // entirely between the center clearance and the ring at that radius.
  const requestedDistance = Number(options.radialDistance);
  if (fitMode === 'auto' && Number.isFinite(requestedDistance)) {
    const target = clamp(requestedDistance, centerClearance, containingRingRadius);
    const fitsAtTarget = (gap) => {
      const interval = fits(gap);
      return interval && interval.inner <= target && interval.outer >= target ? interval : null;
    };
    availableGap = Math.min(availableGap, solveLargestGap(fitsAtTarget));
  }
  const interval = fits(availableGap) ?? placementInterval({
    corners: solveCorners,
    anchor,
    gap: 0,
    containingRingRadius,
    centerClearance,
  });
  const requestedRadius = fitMode === 'fixed'
    ? (Number.isFinite(requestedDistance) ? requestedDistance : containingRingRadius * 0.8)
    : Number.isFinite(requestedDistance)
      ? clamp(requestedDistance, interval.inner, interval.outer)
      : interval.outer;
  const radialDistance = clamp(
    requestedRadius,
    centerClearance,
    containingRingRadius,
  );
  const placement = {
    x: anchor.x * radialDistance,
    y: anchor.y * radialDistance,
  };
  const worldCorners = corners.map((corner) => ({
    x: placement.x + corner.x * availableGap,
    y: placement.y + corner.y * availableGap,
  }));
  const radii = worldCorners.map((corner) => Math.hypot(corner.x, corner.y));

  return Object.freeze({
    glyphId,
    size,
    fitMode,
    facingDeg,
    containingRingRadius,
    centerClearance,
    strokePadding,
    anchor: Object.freeze({ x: anchor.x, y: anchor.y }),
    placement: Object.freeze({
      x: round(placement.x),
      y: round(placement.y),
      radius: round(radialDistance),
    }),
    availableGap: round(availableGap),
    radialInterval: Object.freeze({
      inner: round(clamp(interval.inner, centerClearance, containingRingRadius)),
      outer: round(clamp(interval.outer, centerClearance, containingRingRadius)),
    }),
    canonicalBounds: Object.freeze([...geometry.bounds]),
    worldCorners: Object.freeze(worldCorners.map((corner) => Object.freeze({
      x: round(corner.x),
      y: round(corner.y),
    }))),
    measuredBounds: Object.freeze({
      minX: round(Math.min(...worldCorners.map((corner) => corner.x))),
      minY: round(Math.min(...worldCorners.map((corner) => corner.y))),
      maxX: round(Math.max(...worldCorners.map((corner) => corner.x))),
      maxY: round(Math.max(...worldCorners.map((corner) => corner.y))),
      minRadius: round(Math.min(...radii)),
      maxRadius: round(Math.max(...radii)),
    }),
  });
}

function solveLargestGap(fits) {
  let high = 1;
  while (high < MAX_SOLVE_GAP && fits(high)) high *= 2;
  let low = 0;
  for (let iteration = 0; iteration < SOLVE_ITERATIONS; iteration += 1) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return low;
}

function placementInterval({ corners, anchor, gap, containingRingRadius, centerClearance }) {
  let outer = Infinity;
  let inner = centerClearance;
  for (const corner of corners) {
    const radial = (corner.x * anchor.x + corner.y * anchor.y) * gap;
    const tangent = (-corner.x * anchor.y + corner.y * anchor.x) * gap;
    const outerRoot = containingRingRadius ** 2 - tangent ** 2;
    if (outerRoot < 0) return null;
    const outerDistance = Math.sqrt(outerRoot);
    // Keep the whole glyph on the anchor-facing side of the ring. Without
    // the lower root a large gap could legally place a corner past the far
    // side of the circle while still satisfying the squared-radius test.
    inner = Math.max(inner, -radial - outerDistance);
    outer = Math.min(outer, -radial + outerDistance);

    const innerRoot = centerClearance ** 2 - tangent ** 2;
    if (innerRoot >= 0) inner = Math.max(inner, -radial + Math.sqrt(innerRoot));
  }
  return outer >= inner && outer >= 0 ? { inner, outer } : null;
}

function orientCanonicalPoint(point, anchor, facingDeg) {
  const angle = (facingDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rotatedX = point.x * cos - point.y * sin;
  const rotatedY = point.x * sin + point.y * cos;
  const inward = { x: -anchor.x, y: -anchor.y };
  const tangent = { x: -anchor.y, y: anchor.x };
  return {
    x: tangent.x * rotatedX + inward.x * rotatedY,
    y: tangent.y * rotatedX + inward.y * rotatedY,
  };
}

function paddedCorners(bounds, padding) {
  const [minX, minY, maxX, maxY] = bounds;
  return [
    { x: minX - padding, y: minY - padding },
    { x: minX - padding, y: maxY + padding },
    { x: maxX + padding, y: minY - padding },
    { x: maxX + padding, y: maxY + padding },
  ];
}

function normalizedAnchor(anchor) {
  const x = finite(anchor?.x, 0);
  const y = finite(anchor?.y, -1);
  const length = Math.hypot(x, y);
  return length > 0.000001 ? { x: x / length, y: y / length } : { x: 0, y: -1 };
}

function finite(value, fallback) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function round(value) { return Number(value.toFixed(5)); }
