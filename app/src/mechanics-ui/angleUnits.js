const DEGREES_PER_RADIAN = 180 / Math.PI;

export function radiansToDegrees(value) {
  return Number(value) * DEGREES_PER_RADIAN;
}

export function degreesToRadians(value) {
  return Number(value) / DEGREES_PER_RADIAN;
}

export function formatDegrees(value, fractionDigits = 1) {
  return `${radiansToDegrees(value).toFixed(fractionDigits)}°`;
}
