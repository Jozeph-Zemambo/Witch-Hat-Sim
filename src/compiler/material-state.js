/**
 * Pure, deterministic material-state helpers for simulator-facing graph output.
 *
 * The compiler emits state drivers; it does not run a continuous simulation.
 * These helpers define the bounded stepping semantics a later runtime can apply.
 */

const DEFAULT_FREEZE_BOUNDARY = 0.33;
const DEFAULT_BOIL_BOUNDARY = 0.86;
const DEFAULT_MIN_ENERGY = 0;
const DEFAULT_MAX_ENERGY = 1;

/**
 * @param {object | null | undefined} materialProfile
 * @param {number} specificEnergy
 * @returns {'solid' | 'liquid' | 'vapor' | 'unspecified'}
 */
export function phaseFromSpecificEnergy(materialProfile, specificEnergy) {
  if (!materialProfile || !Number.isFinite(specificEnergy)) return 'unspecified';
  const min = finiteOr(materialProfile.specificEnergyMin, DEFAULT_MIN_ENERGY);
  const max = finiteOr(materialProfile.specificEnergyMax, DEFAULT_MAX_ENERGY);
  const freeze = finiteOr(materialProfile.freezeSpecificEnergy, DEFAULT_FREEZE_BOUNDARY);
  const boil = finiteOr(materialProfile.boilSpecificEnergy, DEFAULT_BOIL_BOUNDARY);
  const energy = clamp(specificEnergy, min, max);

  if (energy <= freeze) return 'solid';
  if (energy >= boil) return 'vapor';
  return 'liquid';
}

/**
 * @param {{ materialProfile?: object; specificEnergy?: number; phase?: string }} state
 * @param {{ direction?: string; thermalEffect?: string; strength?: number; minSpecificEnergy?: number; maxSpecificEnergy?: number; retentionGain?: number }} driver
 * @param {number} dt
 * @returns {{ specificEnergy: number; phase: string; deltaSpecificEnergy: number; bounded: true }}
 */
export function stepSpecificEnergy(state, driver, dt = 1) {
  const profile = state?.materialProfile ?? {};
  const min = finiteOr(driver?.minSpecificEnergy, finiteOr(profile.specificEnergyMin, DEFAULT_MIN_ENERGY));
  const max = finiteOr(driver?.maxSpecificEnergy, finiteOr(profile.specificEnergyMax, DEFAULT_MAX_ENERGY));
  const current = clamp(finiteOr(state?.specificEnergy, defaultEnergyForPhase(state?.phase)), min, max);
  const direction = driverDirection(driver);
  const strength = Math.max(0, finiteOr(driver?.strength, defaultDriverStrength(driver)));
  const duration = Math.max(0, finiteOr(dt, 0));
  const retention = Math.max(0, finiteOr(driver?.retentionGain, 0));
  const retentionScale = 1 / (1 + retention);
  const rawDelta = direction * strength * duration * retentionScale;
  const next = clamp(current + rawDelta, min, max);

  return {
    specificEnergy: next,
    phase: phaseFromSpecificEnergy(profile, next),
    deltaSpecificEnergy: next - current,
    bounded: true,
  };
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function finiteOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * @param {string | undefined} phase
 */
function defaultEnergyForPhase(phase) {
  if (phase === 'solid') return 0.2;
  if (phase === 'vapor') return 0.95;
  return 0.55;
}

/**
 * @param {object | null | undefined} driver
 */
function driverDirection(driver) {
  if (driver?.direction === 'cool') return -1;
  if (driver?.thermalEffect === 'cool' || driver?.thermalEffect === 'freeze') return -1;
  return 1;
}

/**
 * @param {object | null | undefined} driver
 */
function defaultDriverStrength(driver) {
  if (driver?.thermalEffect === 'hot') return 0.14;
  if (driver?.thermalEffect === 'freeze') return 0.14;
  return 0.08;
}
