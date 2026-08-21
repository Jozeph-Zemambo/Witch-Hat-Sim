export const WIND_DISPERSION_LAB_REACH = 1.81;
export const WIND_DISPERSION_LAB_STREAK_COUNT = 20;

const MIN_STREAK_COUNT = 3;
const MIN_STREAK_SIZE_SCALE = 0.7;
const MAX_STREAK_SIZE_SCALE = 1.5;

/**
 * Preserve the Dispersion lab's visible streak density at any canopy size.
 * Count follows circumference directly. Individual streaks scale much more
 * gently so a tiny spell stays legible and a large spell does not grow bars.
 */
export function windDispersionStreakMetrics(canopyReach = WIND_DISPERSION_LAB_REACH) {
  const reach = Number(canopyReach);
  const safeReach = Number.isFinite(reach) && reach > 0
    ? reach
    : WIND_DISPERSION_LAB_REACH;
  const reachScale = safeReach / WIND_DISPERSION_LAB_REACH;
  const sizeScale = Math.min(
    MAX_STREAK_SIZE_SCALE,
    Math.max(MIN_STREAK_SIZE_SCALE, reachScale ** 0.25),
  );
  return {
    count: Math.max(
      MIN_STREAK_COUNT,
      Math.round(WIND_DISPERSION_LAB_STREAK_COUNT * reachScale),
    ),
    reachScale,
    sizeScale,
    countAuthority: 'effective_canopy_circumference',
    sizeAuthority: 'gentle_fourth_root_of_canopy_scale',
  };
}

export function windDispersionStreakTheta(index, activeCount) {
  const count = Math.max(1, Math.floor(Number(activeCount) || 1));
  const jitter = (Math.sin(index * 127.1) * 0.5) * 0.4;
  return (index / count) * Math.PI * 2 + jitter;
}
