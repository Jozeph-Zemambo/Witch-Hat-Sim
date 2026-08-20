import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { assetDefinitionForId } from '../assets/assetCatalog.js';
import {
  normalizePlacementTransform,
  scaleVectorBy,
  worldAssemblyTransform,
} from '../mechanics/placementTransforms.js';
import {
  DEFAULT_PLACED_SPELL_SCALE,
  MIN_PLACED_SPELL_SCALE,
  useSpellStore,
} from '../store.js';
import {
  ATELIER_PLAYTHROUGH,
  MAIN_WORLD_TERRAIN_SIZE,
} from '../world-physics/force-contract.js';

const GRASS_CLUSTER_STEP = 1.35;
const GRASS_CLUSTER_DENSITY = 0.5;
const GRASS_CLUSTER_MIN = 4;
const GRASS_CLUSTER_MAX = 10;
const GRASS_BLADES_PER_TUFT = 3;
const DEFAULT_SPELL_RADIUS = 2.25;

// Decorative yard fixtures live outside the central build/spell area. Their
// footprints are shared with grass clearance so blades never grow through the
// stones or woody shrub bases.
export const YARD_STEPPING_STONES = Object.freeze([
  Object.freeze({ x: -3.08, z: -0.15, sx: 0.38, sz: 0.29, rotation: -0.1 }),
  Object.freeze({ x: -2.48, z: 0.12, sx: 0.34, sz: 0.27, rotation: 0.2 }),
  Object.freeze({ x: -1.86, z: 0.28, sx: 0.4, sz: 0.3, rotation: -0.18 }),
  Object.freeze({ x: -1.18, z: 0.32, sx: 0.35, sz: 0.26, rotation: 0.08 }),
  Object.freeze({ x: -0.48, z: 0.22, sx: 0.39, sz: 0.28, rotation: -0.24 }),
]);

export const YARD_SHRUBS = Object.freeze([
  Object.freeze({ x: -7.95, z: -0.42, scale: 0.9, rotation: 0.25 }),
  Object.freeze({ x: -1.25, z: -5.45, scale: 0.82, rotation: -0.35 }),
  Object.freeze({ x: 4.6, z: 3.55, scale: 0.88, rotation: 0.62 }),
]);

const YARD_FLOWER_PATCHES = Object.freeze([
  Object.freeze({ x: -2.9, z: -4.05, rotation: 0.25, tones: ['#e8d66f', '#f1efe0', '#c96f69'] }),
  Object.freeze({ x: 4.0, z: 2.65, rotation: -0.5, tones: ['#e3c85c', '#d9e6db', '#bd7180'] }),
]);

const STATIC_CLEAR_ZONES = Object.freeze([
  // The Atelier is an oriented rectangle; keeping its true rotation avoids a
  // conspicuous circular bald patch around the building.
  Object.freeze({
    kind: 'oriented-box',
    id: 'atelier-house',
    x: ATELIER_PLAYTHROUGH.position.x,
    z: ATELIER_PLAYTHROUGH.position.z,
    halfX: 2.72,
    halfZ: 2.72,
    rotation: ATELIER_PLAYTHROUGH.rotationY,
    margin: 0.12,
  }),
  ...[
    [3.0, -2.6, 0.48],
    [3.5, -2.15, 0.52],
    [-3.3, 2.6, 0.56],
    [-3.4, -2.4, 0.48],
    [-2.85, -2.0, 0.48],
  ].map(([x, z, radius], index) => Object.freeze({ kind: 'circle', id: `static-prop-${index}`, x, z, radius })),
  ...YARD_STEPPING_STONES.map((stone, index) => Object.freeze({
    kind: 'circle',
    id: `yard-step-${index}`,
    x: stone.x,
    z: stone.z,
    radius: Math.max(stone.sx, stone.sz) + 0.08,
  })),
  ...YARD_SHRUBS.map((shrub, index) => Object.freeze({
    kind: 'circle',
    id: `yard-shrub-${index}`,
    x: shrub.x,
    z: shrub.z,
    radius: 0.48 * shrub.scale,
  })),
]);

function seededNoise(a, b, salt = 0) {
  const value = Math.sin(a * 127.1 + b * 311.7 + salt * 74.7) * 43758.5453123;
  return value - Math.floor(value);
}

function makeGrassClumpGeometry() {
  const positions = [];
  const colors = [];
  const bladeSpecs = [
    { rootAngle: 0.18, rootRadius: 0.05, angle: 0.38, width: 0.07, height: 1, lean: 0.04, curve: 0.012 },
    { rootAngle: 2.72, rootRadius: 0.034, angle: 2.08, width: 0.05, height: 0.58, lean: 0.06, curve: -0.014 },
    { rootAngle: 5.16, rootRadius: 0.056, angle: 4.74, width: 0.06, height: 0.78, lean: 0.035, curve: 0.009 },
  ];
  const lowerFacetTones = ['#4d813e', '#416f35', '#315c2c', '#3a6831'];
  const upperFacetTones = ['#68a052', '#579046', '#427938', '#4b8540'];
  const baseTone = new THREE.Color('#2f5729');

  const appendTriangle = (a, b, c, tone) => {
    const color = tone instanceof THREE.Color ? tone : new THREE.Color(tone);
    for (const point of [a, b, c]) {
      positions.push(point.x, point.y, point.z);
      colors.push(color.r, color.g, color.b);
    }
  };
  const appendQuad = (a, b, c, d, tone) => {
    appendTriangle(a, b, c, tone);
    appendTriangle(a, c, d, tone);
  };
  const crossSection = (center, direction, across, halfWidth, halfDepth) => [
    center.clone().addScaledVector(across, halfWidth),
    center.clone().addScaledVector(direction, halfDepth),
    center.clone().addScaledVector(across, -halfWidth),
    center.clone().addScaledVector(direction, -halfDepth),
  ];

  for (const blade of bladeSpecs) {
    const direction = new THREE.Vector3(Math.sin(blade.angle), 0, Math.cos(blade.angle));
    const across = new THREE.Vector3(direction.z, 0, -direction.x);
    const baseCenter = new THREE.Vector3(
      Math.sin(blade.rootAngle) * blade.rootRadius,
      0,
      Math.cos(blade.rootAngle) * blade.rootRadius,
    );
    const bendCenter = baseCenter.clone().add(direction.clone()
      .multiplyScalar(blade.lean * 0.24)
      .addScaledVector(across, blade.curve * 0.25))
      .setY(blade.height * 0.62);
    const tip = baseCenter.clone().add(direction.clone()
      .multiplyScalar(blade.lean)
      .addScaledVector(across, blade.curve))
      .setY(blade.height);
    const base = crossSection(baseCenter, direction, across, blade.width / 2, blade.width * 0.16);
    const bend = crossSection(bendCenter, direction, across, blade.width * 0.32, blade.width * 0.1);

    // Each independently rooted blade is a closed, tapered diamond prism.
    // The irregular root disk and lean directions prevent the three blades
    // from collapsing into one pinched bouquet silhouette.
    for (let side = 0; side < 4; side += 1) {
      const next = (side + 1) % 4;
      appendQuad(base[side], bend[side], bend[next], base[next], lowerFacetTones[side]);
      appendTriangle(bend[side], tip, bend[next], upperFacetTones[side]);
    }
    appendTriangle(base[0], base[2], base[1], baseTone);
    appendTriangle(base[0], base[3], base[2], baseTone);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildGrassInstances() {
  const instances = [];
  const halfX = MAIN_WORLD_TERRAIN_SIZE.x / 2 - 0.28;
  const halfZ = MAIN_WORLD_TERRAIN_SIZE.z / 2 - 0.28;
  let row = 0;
  for (let z = -halfZ; z <= halfZ; z += GRASS_CLUSTER_STEP) {
    let column = 0;
    for (let x = -halfX; x <= halfX; x += GRASS_CLUSTER_STEP) {
      const densityNoise = seededNoise(column, row, 1);
      if (densityNoise < GRASS_CLUSTER_DENSITY) {
        const centerX = x + (seededNoise(column, row, 2) - 0.5) * GRASS_CLUSTER_STEP * 0.48;
        const centerZ = z + (seededNoise(column, row, 3) - 0.5) * GRASS_CLUSTER_STEP * 0.48;
        const tuftCount = GRASS_CLUSTER_MIN + Math.floor(
          seededNoise(column, row, 4) * (GRASS_CLUSTER_MAX - GRASS_CLUSTER_MIN + 1),
        );
        const clusterRotation = seededNoise(column, row, 5) * Math.PI * 2;
        for (let tuftIndex = 0; tuftIndex < tuftCount; tuftIndex += 1) {
          const angle = clusterRotation + tuftIndex * 2.39996323 + seededNoise(column, row, 10 + tuftIndex) * 0.42;
          const radius = tuftIndex === 0
            ? 0
            : 0.12 + Math.sqrt(seededNoise(column, row, 20 + tuftIndex)) * 0.38;
          const sizeNoise = seededNoise(column, row, 30 + tuftIndex);
          const tuftX = centerX + Math.cos(angle) * radius;
          const tuftZ = centerZ + Math.sin(angle) * radius;
          if (Math.abs(tuftX) > halfX || Math.abs(tuftZ) > halfZ) continue;
          instances.push({
            x: tuftX,
            z: tuftZ,
            rotation: seededNoise(column, row, 40 + tuftIndex) * Math.PI * 2,
            width: 0.92 + sizeNoise * 0.14,
            height: 0.25 + sizeNoise * 0.05,
          });
        }
      }
      column += 1;
    }
    row += 1;
  }
  return instances;
}

function circleZone(id, position, radius) {
  const x = Number(position?.x);
  const z = Number(position?.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return { kind: 'circle', id, x, z, radius: Math.max(0.08, Number(radius) || 0.08) };
}

function spellClearZone(spell) {
  const normal = spell.anchor?.normal ?? { x: 0, y: 1, z: 0 };
  const point = spell.placementTransform?.position ?? spell.anchor?.point;
  const isPracticeTerrain = spell.anchor?.surfaceId === 'practice-field-terrain';
  // The practice terrain is intentionally uneven. Its world-space height is
  // not a reliable ground/prop discriminator, so trust the authored surface
  // identity and use the low-height fallback only for older placement data.
  if (
    Number(normal.y ?? 1) < 0.72
    || (!isPracticeTerrain && Number(point?.y ?? 0) > 0.28)
  ) return null;
  const rawScale = spell.placementTransform?.scale
    ?? spell.transform?.scale
    ?? DEFAULT_PLACED_SPELL_SCALE;
  const scale = typeof rawScale === 'number'
    ? rawScale
    : Math.max(Number(rawScale?.x ?? 1), Number(rawScale?.z ?? 1));
  return circleZone(
    `spell:${spell.id}`,
    point,
    DEFAULT_SPELL_RADIUS * Math.max(MIN_PLACED_SPELL_SCALE, scale) + 0.12,
  );
}

function assetClearZone(asset) {
  const definition = assetDefinitionForId(asset.assetDefinitionId ?? asset.definitionId ?? asset.assetId);
  if (!definition) return null;
  const transform = normalizePlacementTransform(asset.transform);
  if (transform.position.y > 0.3) return null;
  const radius = Math.max(
    definition.size?.x ?? 0.5,
    definition.size?.z ?? 0.5,
  ) * Math.max(transform.scale.x, transform.scale.z) / 2 + 0.14;
  return circleZone(`asset:${asset.id}`, transform.position, radius);
}

function mechanicsClearZones(build) {
  const buildTransform = normalizePlacementTransform(build.transform);
  const scale = buildTransform.scale;
  return (build.document?.assemblies ?? []).map((assembly) => {
    const world = worldAssemblyTransform(assembly.transform, build.transform);
    const radius = Math.max(0.25, ...(assembly.parts ?? []).map((part) => {
      const local = scaleVectorBy(part.localTransform?.position, scale);
      const size = scaleVectorBy(part.size, scale);
      return Math.hypot(local.x, local.z) + Math.hypot(size.x, size.z) / 2;
    })) + 0.14;
    return circleZone(`mechanics:${build.id}:${assembly.assemblyId}`, world.position, radius);
  }).filter(Boolean);
}

function propClearZone(prop) {
  const size = Math.max(0.3, Number(prop.size ?? 1)) * 0.45;
  const radius = prop.visualKind === 'tree_landmark'
    ? 0.72
    : prop.visualKind === 'tree_apple'
      ? 0.14
      : Math.max(0.3, size * 0.72);
  return circleZone(`prop:${prop.id}`, prop.position, radius);
}

function sourceClearZone(source) {
  const radius = source.kind === 'water' && source.materialState !== 'mist_cloud' ? 0.68 : 0.46;
  return circleZone(`source:${source.id}`, source.position, radius);
}

export function pointInsideGrassClearZone(point, zone) {
  if (zone.kind === 'oriented-box') {
    const cosine = Math.cos(-zone.rotation);
    const sine = Math.sin(-zone.rotation);
    const dx = point.x - zone.x;
    const dz = point.z - zone.z;
    const localX = dx * cosine - dz * sine;
    const localZ = dx * sine + dz * cosine;
    return Math.abs(localX) <= zone.halfX + (zone.margin ?? 0)
      && Math.abs(localZ) <= zone.halfZ + (zone.margin ?? 0);
  }
  return Math.hypot(point.x - zone.x, point.z - zone.z) <= zone.radius;
}

function grassClearZones({ placedSpells, placedAssets, placedMechanicsBuilds, props, sources }) {
  return [
    ...STATIC_CLEAR_ZONES,
    ...placedSpells.map(spellClearZone),
    ...placedAssets.map(assetClearZone),
    ...placedMechanicsBuilds.flatMap(mechanicsClearZones),
    ...props.map(propClearZone),
    ...sources.map(sourceClearZone),
  ].filter(Boolean);
}

export function YardGroundCover({ placedSpells = [], props = [], sources = [] }) {
  const { invalidate } = useThree();
  const meshRef = useRef(null);
  const shaderRef = useRef(null);
  const rustleStrengthRef = useRef(0);
  const reducedMotionRef = useRef(false);
  const placedAssets = useSpellStore((state) => state.placedAssets);
  const placedMechanicsBuilds = useSpellStore((state) => state.placedMechanicsBuilds);
  const geometry = useMemo(() => makeGrassClumpGeometry(), []);
  const instances = useMemo(() => buildGrassInstances(), []);
  const clearZones = useMemo(() => grassClearZones({
    placedSpells,
    placedAssets,
    placedMechanicsBuilds,
    props,
    sources,
  }), [placedAssets, placedMechanicsBuilds, placedSpells, props, sources]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const update = () => { reducedMotionRef.current = Boolean(media?.matches); };
    update();
    media?.addEventListener?.('change', update);
    return () => media?.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const placedSpellZones = clearZones.filter((zone) => zone.id.startsWith('spell:'));
    let visibleCount = 0;
    let placedSpellHiddenTuftCount = 0;
    instances.forEach((instance, index) => {
      const hidden = clearZones.some((zone) => pointInsideGrassClearZone(instance, zone));
      if (placedSpellZones.some((zone) => pointInsideGrassClearZone(instance, zone))) {
        placedSpellHiddenTuftCount += 1;
      }
      dummy.position.set(instance.x, 0.018, instance.z);
      dummy.rotation.set(0, instance.rotation, 0);
      dummy.scale.set(
        hidden ? 0 : instance.width,
        hidden ? 0 : instance.height,
        hidden ? 0 : instance.width,
      );
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      if (!hidden) visibleCount += 1;
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    window.__WHA_YARD_GRASS__ = {
      totalCount: instances.length,
      visibleCount,
      hiddenCount: instances.length - visibleCount,
      clearZoneCount: clearZones.length,
      placedSpellZoneCount: placedSpellZones.length,
      placedSpellClearRadii: placedSpellZones.map((zone) => Number(zone.radius.toFixed(3))),
      placedSpellHiddenTuftCount,
      placedAssetZoneCount: clearZones.filter((zone) => zone.id.startsWith('asset:')).length,
      hasDirtClearing: false,
      rustleMode: 'player-proximity',
      geometryStyle: 'bent-solid-faceted-tufts',
      bladeTopology: 'closed-diamond-prism',
      baseLayout: 'scattered-roots',
      bladesPerTuft: GRASS_BLADES_PER_TUFT,
      withinTuftHeightSpread: 0.42,
      trianglesPerTuft: geometry.getAttribute('position').count / 3,
      clusterSizeRange: [GRASS_CLUSTER_MIN, GRASS_CLUSTER_MAX],
    };
    invalidate();
  }, [clearZones, geometry, instances, invalidate]);

  const patchGrassShader = useCallback((shader) => {
    shaderRef.current = shader;
    shader.uniforms.uGrassTime = { value: 0 };
    shader.uniforms.uGrassPlayer = { value: new THREE.Vector2(1000, 1000) };
    shader.uniforms.uGrassRustle = { value: 0 };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uGrassTime;
        uniform vec2 uGrassPlayer;
        uniform float uGrassRustle;`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
        #ifdef USE_INSTANCING
          vec3 grassOrigin = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float grassTip = smoothstep(0.05, 1.0, position.y);
          float grassDistance = distance(grassOrigin.xz, uGrassPlayer);
          float grassProximity = 1.0 - smoothstep(0.25, 1.55, grassDistance);
          float grassBreeze = sin(uGrassTime * 1.25 + grassOrigin.x * 1.7 + grassOrigin.z * 1.15);
          float grassBrush = sin(uGrassTime * 7.2 + grassOrigin.x * 4.1 - grassOrigin.z * 3.2);
          transformed.x += grassTip * (grassBreeze * 0.012 + grassProximity * uGrassRustle * grassBrush * 0.065);
          transformed.z += grassTip * (grassBreeze * 0.008 + grassProximity * uGrassRustle * cos(uGrassTime * 6.4 + grassOrigin.z * 3.7) * 0.045);
        #endif`,
      );
  }, []);

  useFrame(({ clock }, delta) => {
    const shader = shaderRef.current;
    if (!shader) return;
    const player = window.__WHA_PLAYER__;
    if (player?.position) shader.uniforms.uGrassPlayer.value.set(player.position.x, player.position.z);
    const target = reducedMotionRef.current ? 0 : player?.moving ? 1 : 0.18;
    rustleStrengthRef.current = THREE.MathUtils.damp(rustleStrengthRef.current, target, 10, Math.min(delta, 0.05));
    shader.uniforms.uGrassTime.value = clock.elapsedTime;
    shader.uniforms.uGrassRustle.value = rustleStrengthRef.current;
  });

  return (
    <instancedMesh
      ref={meshRef}
      name="yard-grass-cover"
      args={[geometry, undefined, instances.length]}
      frustumCulled={false}
    >
      <meshStandardMaterial
        color="#ffffff"
        vertexColors
        roughness={0.96}
        metalness={0}
        flatShading
        side={THREE.DoubleSide}
        onBeforeCompile={patchGrassShader}
        customProgramCacheKey={() => 'yard-grass-proximity-rustle-v2'}
      />
    </instancedMesh>
  );
}

export function YardDetails() {
  return (
    <group name="yard-details">
      <group name="yard-stepping-stones">
        {YARD_STEPPING_STONES.map((stone, index) => (
          <mesh
            key={index}
            name={`yard-step-${index}`}
            position={[stone.x, 0.055 + (index % 2) * 0.008, stone.z]}
            rotation={[0.03 * ((index % 3) - 1), stone.rotation, 0.025 * ((index % 2) ? 1 : -1)]}
            scale={[stone.sx, 0.09, stone.sz]}
            castShadow
            receiveShadow
          >
            <dodecahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color={index % 2 ? '#85877a' : '#777c70'} roughness={0.97} flatShading />
          </mesh>
        ))}
      </group>
      {YARD_SHRUBS.map((shrub, index) => (
        <GardenShrub key={index} index={index} {...shrub} />
      ))}
      {YARD_FLOWER_PATCHES.map((patch, index) => (
        <FlowerPatch key={index} index={index} {...patch} />
      ))}
    </group>
  );
}

function GardenShrub({ x, z, scale, rotation, index }) {
  const clumps = [
    [-0.22, 0.24, 0.02, 0.34],
    [0.18, 0.28, -0.08, 0.38],
    [0.02, 0.42, 0.12, 0.33],
    [-0.02, 0.2, -0.24, 0.28],
  ];
  const tones = ['#365f37', '#477844', '#56844a', '#2f5633'];
  return (
    <group name={`yard-shrub-${index}`} position={[x, 0, z]} rotation={[0, rotation, 0]} scale={scale}>
      {clumps.map(([cx, cy, cz, radius], clumpIndex) => (
        <mesh
          key={clumpIndex}
          position={[cx, cy, cz]}
          rotation={[0.1 * clumpIndex, clumpIndex * 0.72, -0.06 * clumpIndex]}
          castShadow
        >
          <icosahedronGeometry args={[radius, 1]} />
          <meshStandardMaterial color={tones[(index + clumpIndex) % tones.length]} roughness={0.96} flatShading />
        </mesh>
      ))}
    </group>
  );
}

function FlowerPatch({ x, z, rotation, tones, index }) {
  const flowers = useMemo(() => Array.from({ length: 9 }, (_, flowerIndex) => {
    const angle = flowerIndex * 2.39996323 + index * 0.7;
    const radius = 0.12 + (flowerIndex % 4) * 0.09;
    return {
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius * 0.72,
      height: 0.14 + (flowerIndex % 3) * 0.035,
      tone: tones[flowerIndex % tones.length],
    };
  }), [index, tones]);
  return (
    <group name={`yard-flower-patch-${index}`} position={[x, 0, z]} rotation={[0, rotation, 0]}>
      {flowers.map((flower, flowerIndex) => (
        <group key={flowerIndex} position={[flower.x, 0, flower.z]}>
          <mesh position={[0, flower.height / 2, 0]} rotation={[0.04 * ((flowerIndex % 3) - 1), 0, 0.08 * ((flowerIndex % 2) ? 1 : -1)]}>
            <cylinderGeometry args={[0.008, 0.011, flower.height, 5]} />
            <meshStandardMaterial color="#426d3d" roughness={0.9} flatShading />
          </mesh>
          <mesh position={[0, flower.height, 0]} rotation={[0.2, flowerIndex, 0.1]} castShadow>
            <octahedronGeometry args={[0.038, 0]} />
            <meshStandardMaterial color={flower.tone} roughness={0.78} flatShading />
          </mesh>
        </group>
      ))}
    </group>
  );
}
