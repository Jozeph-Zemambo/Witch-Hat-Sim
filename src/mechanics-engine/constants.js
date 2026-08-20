export const MECHANICS_SCHEMA_VERSION = 3;

export const MECHANICAL_MATERIALS = Object.freeze({
  'material.wood_light': Object.freeze({
    materialId: 'material.wood_light',
    label: 'Light wood',
    density: 0.58,
    friction: 0.72,
    restitution: 0.08,
    color: '#b9854f',
    description: 'Light and grippy. Good for arms, frames, and paddles.',
  }),
  'material.wood_heavy': Object.freeze({
    materialId: 'material.wood_heavy',
    label: 'Heavy wood',
    density: 0.92,
    friction: 0.82,
    restitution: 0.05,
    color: '#765137',
    description: 'Sturdy wood for bases, wheels, and counterweights.',
  }),
  'material.stone': Object.freeze({
    materialId: 'material.stone',
    label: 'Stone',
    density: 2.35,
    friction: 0.68,
    restitution: 0.03,
    color: '#85857d',
    description: 'Dense and steady. Useful for weights and projectiles.',
  }),
  'material.iron': Object.freeze({
    materialId: 'material.iron',
    label: 'Iron',
    density: 4.8,
    friction: 0.48,
    restitution: 0.06,
    color: '#59636a',
    description: 'Very dense. Best for compact shafts and flywheels.',
  }),
  'material.glass': Object.freeze({
    materialId: 'material.glass',
    label: 'Glass',
    density: 1.35,
    friction: 0.24,
    restitution: 0.22,
    color: '#91cbd0',
    description: 'Smooth and lively. A readable experimental material.',
  }),
  'material.practice_rubber': Object.freeze({
    materialId: 'material.practice_rubber',
    label: 'Practice rubber',
    density: 1.05,
    friction: 1.05,
    restitution: 0.72,
    color: '#446b54',
    description: 'High grip and bounce for test pieces and wheels.',
  }),
});

export const DEFAULT_MECHANICAL_MATERIAL_ID = 'material.wood_light';

export const PRIMITIVE_SHAPES = Object.freeze({
  cuboid: Object.freeze({
    shape: 'cuboid',
    label: 'Block',
    defaultSize: { x: 0.8, y: 0.5, z: 0.8 },
  }),
  beam: Object.freeze({
    shape: 'cuboid',
    label: 'Beam',
    defaultSize: { x: 0.28, y: 0.28, z: 2.2 },
  }),
  plate: Object.freeze({
    shape: 'cuboid',
    label: 'Plate',
    defaultSize: { x: 1.5, y: 0.16, z: 1.0 },
  }),
  sphere: Object.freeze({
    shape: 'sphere',
    label: 'Sphere',
    defaultSize: { x: 0.7, y: 0.7, z: 0.7 },
  }),
  cylinder: Object.freeze({
    shape: 'cylinder',
    label: 'Cylinder',
    defaultSize: { x: 0.7, y: 1.0, z: 0.7 },
  }),
  shaft: Object.freeze({
    shape: 'cylinder',
    label: 'Shaft',
    defaultSize: { x: 0.22, y: 2.0, z: 0.22 },
    rotationPortAxis: { x: 0, y: 1, z: 0 },
  }),
  wheel: Object.freeze({
    shape: 'cylinder',
    label: 'Wheel',
    defaultSize: { x: 1.4, y: 0.22, z: 1.4 },
    rotationPortAxis: { x: 0, y: 1, z: 0 },
  }),
  wedge: Object.freeze({
    shape: 'wedge',
    label: 'Wedge',
    defaultSize: { x: 0.9, y: 0.7, z: 1.1 },
  }),
});

// Every cogwheel shares one tooth pitch (arc length per tooth at the pitch
// circle) so any two cogwheels mesh; the ratio then comes purely from their
// pitch radii. Teeth reach ±COG_TOOTH_DEPTH/2 around the pitch circle.
export const COG_TOOTH_PITCH = 0.36;
export const COG_TOOTH_DEPTH = 0.18;

export const COGWHEEL_PRESETS = Object.freeze({
  'cog-large': Object.freeze({
    shape: 'cogwheel',
    label: 'Large cogwheel',
    defaultSize: { x: 1.6, y: 0.24, z: 1.6 },
    rotationPortAxis: { x: 0, y: 1, z: 0 },
  }),
  'cog-small': Object.freeze({
    shape: 'cogwheel',
    label: 'Small cogwheel',
    defaultSize: { x: 0.8, y: 0.24, z: 0.8 },
    rotationPortAxis: { x: 0, y: 1, z: 0 },
  }),
});

export function cogwheelPitchRadius(size) {
  return Math.max(size?.x ?? 0, size?.z ?? 0) / 2;
}

export function cogwheelToothCount(size) {
  return Math.max(6, Math.round((cogwheelPitchRadius(size) * 2 * Math.PI) / COG_TOOTH_PITCH));
}

export const MECHANICS_LIMITS = Object.freeze({
  minimumPartSize: 0.08,
  maximumPartSize: 12,
  minimumDensity: 0.05,
  maximumDensity: 12,
  maximumSpringStiffness: 240,
  maximumSpringDamping: 40,
  maximumGearTorque: 120,
  maximumSpellForce: 180,
  gatePositionTolerance: 0.025,
  gateAngularTolerance: 0.06,
});

export function materialProfile(materialId) {
  return MECHANICAL_MATERIALS[materialId] ?? MECHANICAL_MATERIALS[DEFAULT_MECHANICAL_MATERIAL_ID];
}
