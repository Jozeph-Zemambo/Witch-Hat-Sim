export const MAIN_WORLD_FIXED_DT = 1 / 60;
export const MAIN_WORLD_MAX_SUBSTEPS = 4;
export const MAIN_WORLD_MAX_FRAME_DT = 0.1;
export const MAIN_WORLD_FORCE_BUDGET = 180;
export const EARTH_EMERGENCE_SECONDS = 0.6;

// The practice field is authored once here and consumed by both the Three
// mesh and the main-world Rapier terrain mesh.  Keeping the clearing branch in
// this contract prevents a visible/render-only floor from drifting away from
// the gameplay surface.
export const MAIN_WORLD_TERRAIN_SIZE = Object.freeze({ x: 24, z: 18 });
export const MAIN_WORLD_TERRAIN_SEGMENTS = 64;

// The atelier roof is authored from the ridge and the top corners of the
// gable, then extended along that same slope to form the eaves. This keeps the
// visible shell and the fixed Rapier roof on one exact, closed roofline.
const ATELIER_WALL_TOP_Y = 0.36 + 2.5;
const ATELIER_WALL_HALF_WIDTH = 2.2;
const ATELIER_ROOF_HALF_RUN = ATELIER_WALL_HALF_WIDTH + 0.45;
const ATELIER_ROOF_RIDGE_Y = ATELIER_WALL_TOP_Y + 1.85;
const ATELIER_ROOF_RISE = ATELIER_ROOF_RIDGE_Y - ATELIER_WALL_TOP_Y;
const ATELIER_ROOF_SLOPE = ATELIER_ROOF_RISE / ATELIER_WALL_HALF_WIDTH;
const ATELIER_ROOF_EAVE_Y = ATELIER_ROOF_RIDGE_Y - ATELIER_ROOF_SLOPE * ATELIER_ROOF_HALF_RUN;
const ATELIER_ROOF_NOMINAL_LENGTH = Math.hypot(
  ATELIER_ROOF_HALF_RUN,
  ATELIER_ROOF_RIDGE_Y - ATELIER_ROOF_EAVE_Y,
);
const ATELIER_WORLD_POSITION = Object.freeze({ x: -5.8, y: 0, z: -3.6 });
const ATELIER_WORLD_ROTATION_Y = 0.72;

function atelierLocalPointToWorld(localPoint) {
  const cosine = Math.cos(ATELIER_WORLD_ROTATION_Y);
  const sine = Math.sin(ATELIER_WORLD_ROTATION_Y);
  return Object.freeze({
    x: ATELIER_WORLD_POSITION.x + Number(localPoint.x ?? 0) * cosine + Number(localPoint.z ?? 0) * sine,
    y: ATELIER_WORLD_POSITION.y + Number(localPoint.y ?? 0),
    z: ATELIER_WORLD_POSITION.z - Number(localPoint.x ?? 0) * sine + Number(localPoint.z ?? 0) * cosine,
  });
}

const ATELIER_SPAWN_LOCAL = Object.freeze({ x: -0.3, y: 0, z: 4.15 });
const ATELIER_WRITING_DESK_LOCAL = Object.freeze({ x: 0, y: 1.22, z: -1.15 });
const ATELIER_WORKSHOP_DESK_LOCAL = Object.freeze({ x: 1.72, y: 1.22, z: 0.48 });

export const ATELIER_DESK_LAYOUT = Object.freeze({
  floorY: 0.36,
  topCenterY: 1.22,
  topThickness: 0.1,
  topSurfaceY: 1.284,
  writing: Object.freeze({ width: 2, depth: 0.9, leg: 0.14 }),
  mechanics: Object.freeze({ width: 1.56, depth: 0.72, leg: 0.15 }),
});

// One entrance contract drives both the visible stones and their colliders.
// The path is ordered from the doorway out toward the spawn point, with a
// shallow 8 cm drop between broad, overlapping walking surfaces.
export const ATELIER_ENTRANCE_STEPS = Object.freeze([
  Object.freeze({ x: -0.3, z: 2.38, height: 0.32, radius: 0.5, rotationY: 0.08 }),
  Object.freeze({ x: -0.27, z: 2.78, height: 0.24, radius: 0.48, rotationY: -0.1 }),
  Object.freeze({ x: -0.31, z: 3.18, height: 0.16, radius: 0.46, rotationY: 0.13 }),
  Object.freeze({ x: -0.29, z: 3.58, height: 0.08, radius: 0.44, rotationY: -0.06 }),
]);

// Rendering, interaction, player setup, Rapier, and browser tests all consume
// this contract. The entrance spawn deliberately faces local -Z: directly
// through the open doorway and toward the writing desk.
export const ATELIER_PLAYTHROUGH = Object.freeze({
  position: ATELIER_WORLD_POSITION,
  rotationY: ATELIER_WORLD_ROTATION_Y,
  spawn: Object.freeze({
    local: ATELIER_SPAWN_LOCAL,
    world: atelierLocalPointToWorld(ATELIER_SPAWN_LOCAL),
    facing: ATELIER_WORLD_ROTATION_Y - Math.PI,
    pitch: 0,
    cameraMode: 'fp',
  }),
  writingDesk: Object.freeze({
    local: ATELIER_WRITING_DESK_LOCAL,
    world: atelierLocalPointToWorld(ATELIER_WRITING_DESK_LOCAL),
  }),
  workshopDesk: Object.freeze({
    local: ATELIER_WORKSHOP_DESK_LOCAL,
    world: atelierLocalPointToWorld(ATELIER_WORKSHOP_DESK_LOCAL),
  }),
  bookshelfLocal: Object.freeze({ x: -1.9, y: 0, z: 0.72 }),
});

export const ATELIER_ROOF_LAYOUT = Object.freeze({
  halfRun: ATELIER_ROOF_HALF_RUN,
  halfDepth: 2.5,
  wallTopY: ATELIER_WALL_TOP_Y,
  ridgeY: ATELIER_ROOF_RIDGE_Y,
  eaveY: ATELIER_ROOF_EAVE_Y,
  panelCenterY: (ATELIER_ROOF_RIDGE_Y + ATELIER_ROOF_EAVE_Y) / 2,
  slopeAngle: Math.atan2(
    ATELIER_ROOF_RIDGE_Y - ATELIER_ROOF_EAVE_Y,
    ATELIER_ROOF_HALF_RUN,
  ),
  // A small extension at both ends closes the ridge seam and carries the
  // shingle shell cleanly past the eave instead of ending edge-to-edge.
  panelLength: ATELIER_ROOF_NOMINAL_LENGTH + 0.18,
  thickness: 0.14,
});

export function terrainHeightAt(x, z) {
  // The authored practice field is a single exact flat surface. Keeping this
  // contract pure lets rendering and the Rapier heightfield share the same
  // gameplay plane without triangle-edge climbs.
  return 0;
}

export const FORCE_CONTRACT = Object.freeze({
  column: Object.freeze({
    water: Object.freeze({ cap: 180 }),
    fire: Object.freeze({ cap: 120 }),
    wind: Object.freeze({ cap: 110 }),
    light: Object.freeze({ cap: 0 }),
  }),
  dispersion: Object.freeze({
    water: Object.freeze({ cap: 18 }),
    fire: Object.freeze({ cap: 13.2 }),
    wind: Object.freeze({ cap: 12 }),
    light: Object.freeze({ cap: 0 }),
  }),
  waterCurtain: Object.freeze({ cap: 36 }),
  earthEmergence: Object.freeze({ cap: 140 }),
});

function atelierDeskLegColliderParts(kind, origin, rotationY = 0) {
  const dimensions = ATELIER_DESK_LAYOUT[kind];
  const topBottom = ATELIER_DESK_LAYOUT.topCenterY - ATELIER_DESK_LAYOUT.topThickness / 2;
  const legHeight = topBottom - ATELIER_DESK_LAYOUT.floorY;
  const legCenterY = ATELIER_DESK_LAYOUT.floorY + legHeight / 2;
  const localX = dimensions.width / 2 - dimensions.leg * 0.9;
  const localZ = dimensions.depth / 2 - dimensions.leg * 0.9;
  const cosine = Math.cos(rotationY);
  const sine = Math.sin(rotationY);
  return [-localX, localX].flatMap((x, xIndex) => [-localZ, localZ].map((z, zIndex) => ({
    id: `${kind}-desk-leg-${xIndex}-${zIndex}`,
    position: {
      x: origin.x + x * cosine + z * sine,
      y: legCenterY,
      z: origin.z - x * sine + z * cosine,
    },
    halfExtents: {
      x: dimensions.leg / 2,
      y: legHeight / 2,
      z: dimensions.leg / 2,
    },
  })));
}

export const MAIN_WORLD_BUILTIN_BODIES = Object.freeze([
  Object.freeze({
    id: 'practice-field-terrain',
    renderName: 'practice-field-terrain',
    bodyMode: 'fixed',
    role: 'terrain',
    position: Object.freeze({ x: 0, y: 0, z: 0 }),
    collider: Object.freeze({
      shape: 'compound',
      parts: Object.freeze([
        { id: 'terrain-heightfield', shape: 'terrain-heightfield' },
      ]),
    }),
  }),
  Object.freeze({
    id: 'atelier-house',
    renderName: null,
    bodyMode: 'fixed',
    role: 'house',
    position: ATELIER_PLAYTHROUGH.position,
    rotationY: ATELIER_PLAYTHROUGH.rotationY,
    collider: Object.freeze({
      shape: 'compound',
      parts: Object.freeze([
        // Foundation perimeter and thin interior floor preserve the hollow
        // route rather than turning the building into a solid block.
        { id: 'foundation-front', position: { x: 0, y: 0.19, z: 2.17 }, halfExtents: { x: 2.45, y: 0.2, z: 0.08 } },
        { id: 'foundation-back', position: { x: 0, y: 0.19, z: -2.17 }, halfExtents: { x: 2.45, y: 0.2, z: 0.08 } },
        { id: 'foundation-left', position: { x: -2.37, y: 0.19, z: 0 }, halfExtents: { x: 0.08, y: 0.2, z: 2.09 } },
        { id: 'foundation-right', position: { x: 2.37, y: 0.19, z: 0 }, halfExtents: { x: 0.08, y: 0.2, z: 2.09 } },
        { id: 'floor', position: { x: 0, y: 0.33, z: 0 }, halfExtents: { x: 2.18, y: 0.03, z: 1.98 } },
        { id: 'back-wall', position: { x: 0, y: 1.61, z: -2 }, halfExtents: { x: 2.29, y: 1.25, z: 0.09 } },
        { id: 'left-wall', position: { x: -2.2, y: 1.61, z: 0 }, halfExtents: { x: 0.09, y: 1.25, z: 2 } },
        { id: 'right-wall', position: { x: 2.2, y: 1.61, z: 0 }, halfExtents: { x: 0.09, y: 1.25, z: 2 } },
        { id: 'front-left-wall', position: { x: -1.6, y: 1.61, z: 2 }, halfExtents: { x: 0.6, y: 1.25, z: 0.09 } },
        { id: 'front-right-wall', position: { x: 1.3, y: 1.61, z: 2 }, halfExtents: { x: 0.9, y: 1.25, z: 0.09 } },
        { id: 'front-door-header', position: { x: -0.3, y: 2.54, z: 2 }, halfExtents: { x: 0.7, y: 0.32, z: 0.09 } },
        {
          id: 'roof-right',
          position: { x: ATELIER_ROOF_LAYOUT.halfRun / 2, y: ATELIER_ROOF_LAYOUT.panelCenterY, z: 0 },
          rotationZ: -ATELIER_ROOF_LAYOUT.slopeAngle,
          halfExtents: {
            x: ATELIER_ROOF_LAYOUT.panelLength / 2,
            y: ATELIER_ROOF_LAYOUT.thickness / 2,
            z: ATELIER_ROOF_LAYOUT.halfDepth,
          },
        },
        {
          id: 'roof-left',
          position: { x: -ATELIER_ROOF_LAYOUT.halfRun / 2, y: ATELIER_ROOF_LAYOUT.panelCenterY, z: 0 },
          rotationZ: ATELIER_ROOF_LAYOUT.slopeAngle,
          halfExtents: {
            x: ATELIER_ROOF_LAYOUT.panelLength / 2,
            y: ATELIER_ROOF_LAYOUT.thickness / 2,
            z: ATELIER_ROOF_LAYOUT.halfDepth,
          },
        },
        { id: 'chimney', position: { x: 1.45, y: 4, z: -1.2 }, shape: 'cylinder', halfHeight: 1.35, radius: 0.34 },
        ...ATELIER_ENTRANCE_STEPS.map((step, index) => ({
          id: `step-${index}`,
          position: { x: step.x, y: step.height / 2, z: step.z },
          shape: 'cylinder',
          halfHeight: step.height / 2,
          radius: step.radius,
        })),
        { id: 'table-top', position: { x: 0, y: 1.22, z: -1.15 }, halfExtents: { x: ATELIER_DESK_LAYOUT.writing.width / 2, y: 0.05, z: ATELIER_DESK_LAYOUT.writing.depth / 2 } },
        ...atelierDeskLegColliderParts('writing', { x: 0, z: -1.15 }),
        // Entrance-right mechanics desk: authored lengthwise along local Z.
        { id: 'workshop-desk-top', position: { x: 1.72, y: 1.22, z: 0.48 }, halfExtents: { x: ATELIER_DESK_LAYOUT.mechanics.depth / 2, y: 0.05, z: ATELIER_DESK_LAYOUT.mechanics.width / 2 } },
        ...atelierDeskLegColliderParts('mechanics', { x: 1.72, z: 0.48 }, Math.PI / 2),
        // The bookshelf moves to entrance-left, forward of the side window.
        { id: 'bookshelf-frame', position: { x: -2.03, y: 1.26, z: 0.72 }, halfExtents: { x: 0.13, y: 0.9, z: 0.65 } },
        ...[0.4, 0.92, 1.44].map((y, index) => ({ id: `bookshelf-shelf-${index}`, position: { x: -1.9, y, z: 0.72 }, halfExtents: { x: 0.16, y: 0.02, z: 0.62 } })),
        { id: 'stool-seat', position: { x: 0.1, y: 0.86, z: -0.35 }, shape: 'cylinder', halfHeight: 0.03, radius: 0.18 },
      ]),
    }),
  }),
  ...[
    [3.0, 0.16, -2.6, 0.32],
    [3.5, 0.12, -2.15, 0.36],
    [-3.3, 0.14, 2.6, 0.4],
  ].map(([x, y, z, radius], index) => Object.freeze({
    id: `field-stone-${index}`,
    renderName: `field-stone-${index}`,
    bodyMode: 'dynamic',
    role: 'loose_rock',
    position: Object.freeze({ x, y: Math.max(y, radius), z }),
    mass: 2.4 + radius * 3,
    collider: Object.freeze({ shape: 'ball', radius: radius * 0.86 }),
  })),
  ...[
    [-3.4, 0.27, -2.4],
    [-2.85, 0.22, -2.0],
  ].map(([x, y, z], index) => Object.freeze({
    id: `field-practice-crate-${index}`,
    renderName: `field-practice-crate-${index}`,
    bodyMode: 'dynamic',
    role: 'loose_crate',
    position: Object.freeze({ x, y: Math.max(y, 0.23), z }),
    mass: 3.2,
    collider: Object.freeze({ shape: 'cuboid', halfExtents: Object.freeze({ x: 0.29, y: 0.23, z: 0.29 }) }),
  })),
]);

export function classifyMainWorldBody(value = {}) {
  if (
    value.bodyMode === 'fixed' ||
    value.movable === false ||
    ['terrain', 'house', 'atelier', 'tree_landmark', 'immovable_pull_landmark'].includes(
      value.role ?? value.visualKind ?? value.targetRole,
    )
  ) return 'fixed';
  return 'dynamic';
}

export function mainWorldBodyForProp(prop) {
  const size = Math.max(0.3, Number(prop.size ?? 1)) * 0.45;
  const apple = prop.visualKind === 'tree_apple';
  const tree = prop.visualKind === 'tree_landmark';
  const key = prop.visualKind === 'activation_ring_key';
  const centerOffset = tree ? 0 : apple ? 0.22 : 0.25;
  return {
    id: `prop:${prop.id}`,
    sourceId: prop.id,
    renderName: `prop:${prop.id}`,
    bodyMode: classifyMainWorldBody(prop),
    role: prop.visualKind ?? prop.targetRole ?? 'loose_prop',
    position: add(prop.position, tree ? { x: 0, y: 1.05, z: 0 } : { x: 0, y: centerOffset, z: 0 }),
    mass: Math.max(0.05, Number(prop.mass ?? 4)),
    collider: tree
      ? { shape: 'cylinder', halfHeight: 1.05, radius: 0.32 }
      : apple
        ? { shape: 'ball', radius: Math.max(0.08, size * 0.5) }
        : { shape: 'cuboid', halfExtents: { x: size / 2, y: size / 2, z: size / 2 } },
  };
}

export function mainWorldBodyForSource(source) {
  return {
    id: `source:${source.id}`,
    sourceId: source.id,
    renderName: `source:${source.id}`,
    bodyMode: 'fixed',
    role: 'source_vessel',
    position: { x: source.position?.x ?? 0, y: source.position?.y ?? 0.09, z: source.position?.z ?? 0 },
    collider: { shape: 'cylinder', halfHeight: 0.5, radius: 0.52 },
  };
}

export function buildMainWorldSpellFields(placedSpells = []) {
  const fields = [];
  const rejected = [];
  for (const spell of placedSpells) {
    const mountBodyId = placedSpellMountBodyId(spell);
    const intents = spell.runtimeResult?.intents ?? [];
    for (const intent of intents) {
      if (intent.intentType === 'physics_motion' || intent.physicsField?.fieldShape === 'target_force') {
        rejected.push({ placedSpellId: spell.id, intentId: intent.id, reason: 'pull_out_of_scope' });
        continue;
      }
      if (
        intent.intentType === 'force_constraint_debug' &&
        ['generated_levitation_orb', 'carrier_levitation'].includes(intent.physicsField?.fieldShape)
      ) {
        const physicsField = intent.physicsField;
        fields.push({
          ...physicsField,
          id: `main-world-field:${spell.id}:${intent.id}`,
          placedSpellId: spell.id,
          activationInstanceId: Number(spell.activationInstanceId ?? 0),
          active: intent.active === true && spell.runtimeResult?.lifecycle?.active === true,
          materialKind: normalizedMaterial(intent.materialKind),
          mountBodyId,
          baseFrame: frameFromIntent(intent),
        });
        continue;
      }
      if (!['water_column', 'material_column', 'water_dispersion', 'material_dispersion'].includes(intent.intentType)) {
        continue;
      }
      const materialKind = normalizedMaterial(intent.materialKind);
      const active = intent.active === true && spell.runtimeResult?.lifecycle?.active === true;
      const common = {
        id: `main-world-field:${spell.id}:${intent.id}`,
        placedSpellId: spell.id,
        activationInstanceId: Number(spell.activationInstanceId ?? 0),
        active,
        materialKind,
        mountBodyId,
        baseFrame: frameFromIntent(intent),
      };
      if (intent.intentType.endsWith('_column')) {
        const physicsField = intent.physicsField;
        if (!physicsField || !['column', 'earth_emergence'].includes(physicsField.fieldShape)) continue;
        fields.push({ ...physicsField, ...common });
      } else {
        const physicsField = intent.physicsField;
        if (!physicsField || physicsField.fieldShape !== 'dispersion') continue;
        fields.push({ ...physicsField, ...common });
      }
    }
  }
  return { fields, rejected };
}

export function placedSpellMountBodyId(spell = {}) {
  // `binding: null` is an explicit unbind. Records created before binding was
  // introduced have no property, so keep their prop/world anchors working.
  if (Object.prototype.hasOwnProperty.call(spell, 'binding')) {
    return spell.binding?.bodyId ?? null;
  }
  return spell.anchor?.surfaceKind === 'prop' && spell.anchor?.surfaceTargetId
    ? `prop:${spell.anchor.surfaceTargetId}`
    : fixedMountBodyId(spell.anchor);
}

export function comparableForceLimit(materialKind, mode, mass, fieldStrength = 0, falloff = 1) {
  const safeMass = Math.max(0, Number(mass ?? 0));
  const spec = mode === 'earth_emergence'
    ? FORCE_CONTRACT.earthEmergence
    : mode === 'water_curtain'
      ? FORCE_CONTRACT.waterCurtain
      : FORCE_CONTRACT[mode]?.[normalizedMaterial(materialKind)];
  if (!spec) return 0;
  return Math.min(
    spec.cap,
    Math.max(0, Number(fieldStrength ?? 0)) * safeMass * clamp01(falloff),
  );
}

export function sampleColumnField(field, point) {
  const delta = subtract(point, field.origin);
  const axial = dot(delta, field.direction);
  if (axial < 0 || axial > field.length) return null;
  const radialVector = subtract(delta, scale(field.direction, axial));
  const radial = length(radialVector);
  if (radial > field.radius) return null;
  const axialFalloff = clamp01(1 - axial / Math.max(field.length * 1.25, 0.001));
  const radialFalloff = clamp01(1 - radial / Math.max(field.radius, 0.001));
  return {
    point,
    direction: field.direction,
    falloff: Math.max(0.15, axialFalloff * radialFalloff),
    axial,
    radial,
  };
}

export function sampleDispersionField(field, point) {
  const delta = subtract(point, field.center);
  const planeDistance = dot(delta, field.normal);
  if (Math.abs(planeDistance) > field.halfThickness) return null;
  const planar = subtract(delta, scale(field.normal, planeDistance));
  const radius = length(planar);
  if (radius < field.innerRadius || radius > field.outerRadius) return null;
  const direction = normalize(planar, field.axisU);
  const angle = Math.atan2(dot(direction, field.axisV), dot(direction, field.axisU));
  const coverage = dispersionCoverage(angle, field.signAngles);
  if (coverage <= 0) return null;
  const annular = clamp01(1 - (radius - field.innerRadius) / Math.max(0.001, field.outerRadius - field.innerRadius));
  const planarFalloff = clamp01(1 - Math.abs(planeDistance) / field.halfThickness);
  return { point, direction, falloff: coverage * Math.max(0.12, annular * planarFalloff), radius };
}

export function sampleWaterCurtain(field, point, groundY = 0) {
  if (field.materialKind !== 'water') return null;
  const delta = subtract(point, field.center);
  const radialVector = add(scale(field.axisU, dot(delta, field.axisU)), scale(field.axisV, dot(delta, field.axisV)));
  const radius = length(radialVector);
  if (radius < field.innerRadius || radius > field.outerRadius) return null;
  if (point.y > field.center.y + field.halfThickness || point.y < groundY) return null;
  const direction = normalize(radialVector, field.axisU);
  const angle = Math.atan2(dot(direction, field.axisV), dot(direction, field.axisU));
  const coverage = dispersionCoverage(angle, field.signAngles);
  if (coverage <= 0) return null;
  const vertical = clamp01((field.center.y - point.y) / Math.max(0.1, field.center.y - groundY));
  return {
    point,
    direction: normalize(field.curtain?.direction, { x: 0, y: -1, z: 0 }),
    falloff: coverage * Math.max(0.2, vertical),
  };
}

export function earthEmergenceSweep(field, previousProgress, nextProgress) {
  const startDistance = field.length * clamp01(previousProgress);
  const endDistance = field.length * clamp01(nextProgress);
  return {
    start: add(field.origin, scale(field.direction, startDistance)),
    end: add(field.origin, scale(field.direction, endDistance)),
    direction: field.direction,
    radius: field.radius,
    length: Math.max(0, endDistance - startDistance),
    startDistance,
    endDistance,
  };
}

export function sampleEarthSweep(sweep, point, bodyRadius = 0) {
  if (sweep.length <= 0) return null;
  const delta = subtract(point, sweep.start);
  const axial = clamp(dot(delta, sweep.direction), 0, sweep.length);
  const nearest = add(sweep.start, scale(sweep.direction, axial));
  const away = subtract(point, nearest);
  const radial = length(away);
  const reach = sweep.radius + Math.max(0, bodyRadius);
  if (radial > reach) return null;
  const fallback = Math.abs(sweep.direction.y) < 0.92
    ? normalize({ x: -sweep.direction.z, y: 0, z: sweep.direction.x }, { x: 1, y: 0, z: 0 })
    : { x: 1, y: 0, z: 0 };
  return {
    point: nearest,
    direction: normalize(away, fallback),
    falloff: Math.max(0.2, clamp01(1 - radial / Math.max(0.001, reach))),
    radial,
  };
}

export function takeAggregateForceBudget(used, requested, cap = MAIN_WORLD_FORCE_BUDGET) {
  return Math.max(0, Math.min(Math.max(0, requested), Math.max(0, cap - Math.max(0, used))));
}

export function bodyBoundingRadius(definition) {
  const collider = definition.collider ?? {};
  if (collider.shape === 'ball') return collider.radius;
  if (collider.shape === 'cylinder') return Math.hypot(collider.radius, collider.halfHeight);
  if (collider.shape === 'compound') {
    return Math.max(...(collider.parts ?? []).map((part) => {
      const radius = part.shape === 'ball'
        ? part.radius
        : part.shape === 'cylinder'
          ? Math.hypot(part.radius, part.halfHeight)
          : Math.hypot(part.halfExtents?.x ?? 0.25, part.halfExtents?.y ?? 0.25, part.halfExtents?.z ?? 0.25);
      return Math.hypot(part.position?.x ?? 0, part.position?.y ?? 0, part.position?.z ?? 0) + radius;
    }), 0.5);
  }
  if (collider.shape === 'terrain-heightfield') return Math.hypot(12, 1, 9);
  const half = collider.halfExtents ?? { x: 0.25, y: 0.25, z: 0.25 };
  return Math.hypot(half.x, half.y, half.z);
}

function frameFromIntent(intent) {
  const normal = normalize(intent.placementFrame?.normal, { x: 0, y: 1, z: 0 });
  const tangent = normalize(intent.placementFrame?.tangent, { x: 1, y: 0, z: 0 });
  const bitangent = normalize(
    intent.placementFrame?.bitangent,
    normalize(cross(normal, tangent), { x: 0, y: 0, z: 1 }),
  );
  return { normal, tangent, bitangent };
}

function fixedMountBodyId(anchor = {}) {
  if (anchor.surfaceId === 'practice-field-terrain' || anchor.surfaceId === 'practice-dirt-clearing' || anchor.surfaceId === 'practice-dirt-path') {
    return 'practice-field-terrain';
  }
  if (String(anchor.surfaceId ?? '').includes('atelier')) return 'atelier-house';
  return null;
}

function normalizedMaterial(kind) {
  return ['water', 'fire', 'wind', 'earth', 'light'].includes(kind) ? kind : 'light';
}

function dispersionCoverage(angle, signAngles) {
  const angles = signAngles?.length ? signAngles : [0, Math.PI];
  let sum = 0;
  for (const signAngle of angles) {
    const distance = Math.abs(angleDifference(angle, signAngle));
    const inner = Math.PI / 2 - 0.34;
    const outer = Math.PI / 2 + 0.34;
    sum += 1 - smoothstep(inner, outer, distance);
  }
  return clamp01(sum);
}

function angleDifference(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function smoothstep(a, b, value) {
  const t = clamp01((value - a) / Math.max(0.000001, b - a));
  return t * t * (3 - 2 * t);
}

export function vector(value, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: Number(value?.x ?? fallback.x),
    y: Number(value?.y ?? fallback.y),
    z: Number(value?.z ?? fallback.z),
  };
}
export function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
export function subtract(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
export function scale(value, scalar) { return { x: value.x * scalar, y: value.y * scalar, z: value.z * scalar }; }
export function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
export function cross(a, b) { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
export function length(value) { return Math.hypot(value.x, value.y, value.z); }
export function normalize(value, fallback = { x: 0, y: 1, z: 0 }) {
  const source = vector(value, fallback);
  const magnitude = length(source);
  return magnitude > 0.000001 ? scale(source, 1 / magnitude) : { ...fallback };
}
export function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value))); }
export function clamp01(value) { return clamp(value, 0, 1); }
