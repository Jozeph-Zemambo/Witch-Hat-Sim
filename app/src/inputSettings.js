export const INPUT_SENSITIVITY_MIN = 0.001;
export const INPUT_SENSITIVITY_MAX = 4;
export const INPUT_SENSITIVITY_STEP = 0.001;

export function normalizeInputSensitivity(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(INPUT_SENSITIVITY_MAX, Math.max(INPUT_SENSITIVITY_MIN, number))
    : fallback;
}
