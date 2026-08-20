import * as THREE from 'three';
import { FIRE_FLAME_COLORS } from './flameMaterial.js';

export const FIREBALL_BLOB_COUNT = 132;

export const FIREBALL_DEFAULTS = Object.freeze({
  radius: 0.38,
  height: 1.05,
  taper: 1.15,
  fullness: 0.82,
  blobSize: 0.82,
  riseSpeed: 0.32,
  wobble: 0.12,
  danceSpeed: 3.8,
  flicker: 0.16,
});

export const FIREBALL_CONTROLS = Object.freeze([
  { key: 'radius', label: 'Body radius', min: 0.18, max: 0.55, step: 0.01 },
  { key: 'height', label: 'Flame height', min: 0.45, max: 1.5, step: 0.01 },
  { key: 'taper', label: 'Tip taper', min: 0.3, max: 2.4, step: 0.05 },
  { key: 'fullness', label: 'Base fullness', min: 0, max: 1, step: 0.01 },
  { key: 'blobSize', label: 'Blob diameter', min: 0.2, max: 1.25, step: 0.01 },
  { key: 'riseSpeed', label: 'Rise speed', min: 0.05, max: 1.2, step: 0.01 },
  { key: 'wobble', label: 'Side-to-side wobble', min: 0, max: 0.32, step: 0.01 },
  { key: 'danceSpeed', label: 'Wobble speed', min: 0.5, max: 8, step: 0.1 },
  { key: 'flicker', label: 'Size flicker', min: 0, max: 0.35, step: 0.01 },
]);

const CONTROL_BY_KEY = new Map(FIREBALL_CONTROLS.map((control) => [control.key, control]));

function clampSetting(key, value) {
  const control = CONTROL_BY_KEY.get(key);
  const fallback = FIREBALL_DEFAULTS[key];
  const number = Number(value);
  if (!control || !Number.isFinite(number)) return fallback;
  return Math.min(control.max, Math.max(control.min, number));
}

export function normalizeFireballSettings(settings = {}) {
  return Object.fromEntries(
    Object.keys(FIREBALL_DEFAULTS).map((key) => [key, clampSetting(key, settings[key])]),
  );
}

export function fireballSettingsDocument(settings) {
  const value = normalizeFireballSettings(settings);
  return {
    schema: 'wha.fireball-shape.v1',
    appearance: 'cel_sprite_volume',
    palette: 'fire_column_dispersion',
    shape: {
      radius: value.radius,
      height: value.height,
      taper: value.taper,
      fullness: value.fullness,
      blobSize: value.blobSize,
    },
    motion: {
      riseSpeed: value.riseSpeed,
      wobble: value.wobble,
      danceSpeed: value.danceSpeed,
      flicker: value.flicker,
    },
  };
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

export function createFireballGeometry() {
  const random = seededRandom(0xf17eba11);
  const positions = new Float32Array(FIREBALL_BLOB_COUNT * 3);
  const angles = new Float32Array(FIREBALL_BLOB_COUNT);
  const radii = new Float32Array(FIREBALL_BLOB_COUNT);
  const heights = new Float32Array(FIREBALL_BLOB_COUNT);
  const sizes = new Float32Array(FIREBALL_BLOB_COUNT);
  const phases = new Float32Array(FIREBALL_BLOB_COUNT);
  const randoms = new Float32Array(FIREBALL_BLOB_COUNT);
  for (let index = 0; index < FIREBALL_BLOB_COUNT; index += 1) {
    angles[index] = random() * Math.PI * 2;
    radii[index] = random();
    heights[index] = random();
    sizes[index] = 0.72 + random() * 0.58;
    phases[index] = random();
    randoms[index] = random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
  geometry.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
  geometry.setAttribute('aHeight', new THREE.BufferAttribute(heights, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.2, 0), 2.2);
  geometry.userData.fireballStyle = 'cel_sprite_volume';
  geometry.userData.blobCount = FIREBALL_BLOB_COUNT;
  return geometry;
}

export function createFireballMaterial() {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uRadius: { value: FIREBALL_DEFAULTS.radius },
      uHeight: { value: FIREBALL_DEFAULTS.height },
      uTaper: { value: FIREBALL_DEFAULTS.taper },
      uFullness: { value: FIREBALL_DEFAULTS.fullness },
      uBlobSize: { value: FIREBALL_DEFAULTS.blobSize },
      uRiseSpeed: { value: FIREBALL_DEFAULTS.riseSpeed },
      uWobble: { value: FIREBALL_DEFAULTS.wobble },
      uDanceSpeed: { value: FIREBALL_DEFAULTS.danceSpeed },
      uFlicker: { value: FIREBALL_DEFAULTS.flicker },
      uHot: { value: new THREE.Color(FIRE_FLAME_COLORS.hot) },
      uMid: { value: new THREE.Color(FIRE_FLAME_COLORS.mid) },
      uEdge: { value: new THREE.Color(FIRE_FLAME_COLORS.edge) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    toneMapped: false,
    vertexShader: `
      uniform float uTime;
      uniform float uRadius;
      uniform float uHeight;
      uniform float uTaper;
      uniform float uFullness;
      uniform float uBlobSize;
      uniform float uRiseSpeed;
      uniform float uWobble;
      uniform float uDanceSpeed;
      uniform float uFlicker;
      attribute float aAngle;
      attribute float aRadius;
      attribute float aHeight;
      attribute float aSize;
      attribute float aPhase;
      attribute float aRandom;
      varying float vRandom;
      varying float vVertical;
      void main() {
        float vertical = fract(aHeight + aPhase * 0.37 + uTime * uRiseSpeed);
        float taper = pow(max(0.055, 1.0 - vertical), uTaper);
        float radialSample = pow(aRadius, mix(1.75, 0.58, uFullness));
        float angle = aAngle + sin(uTime * uDanceSpeed * 0.22 + aRandom * 9.0) * 0.18;
        float spread = uRadius * taper * radialSample;
        float sway = sin(uTime * uDanceSpeed + aRandom * 12.0) * uWobble * (0.3 + vertical);
        vec3 pos = vec3(
          cos(angle) * spread + sway,
          (vertical - 0.34) * uHeight,
          sin(angle) * spread + cos(uTime * uDanceSpeed * 0.87 + aRandom * 10.0) * uWobble * 0.55
        );
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float flicker = 1.0 + sin(uTime * (uDanceSpeed * 1.7) + aRandom * 18.0) * uFlicker;
        float tipScale = 0.62 + taper * 0.58;
        gl_PointSize = max(1.0, uBlobSize * aSize * flicker * tipScale * (300.0 / max(0.2, -mvPosition.z)));
        vRandom = aRandom;
        vVertical = vertical;
      }
    `,
    fragmentShader: `
      uniform vec3 uHot;
      uniform vec3 uMid;
      uniform vec3 uEdge;
      varying float vRandom;
      varying float vVertical;
      void main() {
        float outerDistance = length(gl_PointCoord - vec2(0.5));
        if (outerDistance > 0.5) discard;
        float jitter = (vRandom - 0.5) * 0.045;
        float midDistance = length(gl_PointCoord - vec2(0.5, 0.54));
        float hotDistance = length(gl_PointCoord - vec2(0.5, 0.60));
        float hotRadius = 0.24 + jitter - vVertical * 0.025;
        float midRadius = 0.38 + jitter;
        vec3 color = uEdge;
        if (midDistance < midRadius) color = uMid;
        if (hotDistance < hotRadius) color = uHot;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  material.name = 'wha-cel-fireball-material';
  return material;
}

export function updateFireballMaterial(material, settings, time) {
  if (!material?.uniforms) return;
  const value = normalizeFireballSettings(settings);
  material.uniforms.uTime.value = time;
  material.uniforms.uRadius.value = value.radius;
  material.uniforms.uHeight.value = value.height;
  material.uniforms.uTaper.value = value.taper;
  material.uniforms.uFullness.value = value.fullness;
  material.uniforms.uBlobSize.value = value.blobSize;
  material.uniforms.uRiseSpeed.value = value.riseSpeed;
  material.uniforms.uWobble.value = value.wobble;
  material.uniforms.uDanceSpeed.value = value.danceSpeed;
  material.uniforms.uFlicker.value = value.flicker;
}
