export const WATER_COLUMN_RUNTIME_SETTINGS = Object.freeze({
  projectedExitVelocity: 3.2,
  gravityArcStrength: 0.6,
  projectedRadiusScale: 1,
  projectedTaper: 0.5,
  projectedSegmentCount: 12,
  obstacleEnabled: false,
});

export const WATER_COLUMN_LAB_DEFAULTS = Object.freeze({
  angleDeg: 111,
  active: true,
  element: 'water',
  spellLength: 2,
  ...WATER_COLUMN_RUNTIME_SETTINGS,
  obstacle: Object.freeze({
    x: 0,
    y: 1.8,
    z: 0,
    size: 0.7,
  }),
});
