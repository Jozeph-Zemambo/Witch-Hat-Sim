// Shared flame shader for production fire effects.
//
// The tube/sheet geometry is animated on the CPU; this material makes it READ as
// fire: a hot yellow-white core near the origin ramping to orange then deep red,
// with travelling turbulence and a ragged, noise-eaten alpha toward the far end
// so the edge flickers apart like flame tongues instead of ending in a solid rim.
//
// Two coordinate modes share one shader:
//   axis   — t = distance along uAxis from uOrigin, over uSpan (column)
//   radial — t = (|p - uOrigin| - uInner) / uSpan               (dispersion disc)

import * as THREE from 'three';

// Shared JS representation of the GLSL palette below. Other fire effects can
// reuse these exact stops without approximating the simulator's fire colors.
export const FIRE_FLAME_COLORS = Object.freeze({
  hot: '#ffed8c',
  mid: '#ff730a',
  edge: '#b81c00',
  body: '#ff6a1f',
  emissive: '#ff3300',
  illumination: '#ff7e33',
});

const FLAME_NOISE = `
float hash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash(i);
  float n100 = hash(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}
`;

export function makeFlameMaterial({ radial = false } = {}) {
  // Where the far end starts dissolving into tongues. The dispersion disc keeps a
  // wide flaming rim; the column stays a solid cylinder until right at its end.
  const bodyEdge = radial ? '0.45' : '0.78';
  const raggedEdge = radial ? '0.55' : '0.84';
  const bodyCut = radial ? '0.45' : '0.3';
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOrigin: { value: new THREE.Vector3() },
      uAxis: { value: new THREE.Vector3(0, 1, 0) },
      uSpan: { value: 1 },
      uInner: { value: 0 },
      // 1 = far end dissolves into ragged tongues (contact/rim); 0 = solid end.
      uRagged: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uOrigin;
      uniform vec3 uAxis;
      uniform float uSpan;
      uniform float uInner;
      uniform float uRagged;
      varying vec3 vWorld;
      ${FLAME_NOISE}
      void main() {
        ${radial
          ? 'float t = clamp((length(vWorld - uOrigin) - uInner) / max(uSpan, 0.001), 0.0, 1.0);'
          : 'float t = clamp(dot(vWorld - uOrigin, uAxis) / max(uSpan, 0.001), 0.0, 1.0);'}
        // Two octaves of turbulence travelling toward the flame tip.
        float n = vnoise(vWorld * 5.5 ${radial ? '- vec3(uTime * 1.4)' : '- uAxis * uTime * 3.4'});
        n += 0.5 * vnoise(vWorld * 11.0 ${radial ? '- vec3(uTime * 2.2)' : '- uAxis * uTime * 5.2'});
        n /= 1.5;

        // Hot core -> orange body -> deep red tongues.
        vec3 cHot = vec3(1.0, 0.93, 0.55);
        vec3 cMid = vec3(1.0, 0.45, 0.04);
        vec3 cRed = vec3(0.72, 0.11, 0.0);
        float shade = clamp(t + (n - 0.5) * 0.35, 0.0, 1.0);
        vec3 col = mix(cHot, cMid, smoothstep(0.02, 0.5, shade));
        col = mix(col, cRed, smoothstep(0.55, 0.95, shade));
        col += vec3(0.9, 0.4, 0.05) * (0.5 - abs(n - 0.5)) * 0.35;

        // Solid body for most of the span. Only when uRagged is on (collision
        // contact / dispersion rim) does the far end get eaten by noise into
        // flame tongues; otherwise the column ends as a clean solid cylinder.
        float body = 1.0 - smoothstep(${bodyEdge}, 1.0, t) * ${bodyCut} * uRagged;
        float ragged = 1.0 - smoothstep(${raggedEdge}, 1.0, t) * (1.0 - n) * 1.5 * uRagged;
        float alpha = clamp(body * ragged, 0.0, 1.0) * 0.96;
        if (alpha < 0.03) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
  material.toneMapped = false;
  return material;
}

/** Per-frame uniform sync. `span` = column length or (reach - seal). */
export function updateFlameMaterial(material, { time, origin, axis, span, inner = 0, ragged = 1 }) {
  if (!material?.uniforms) return;
  material.uniforms.uTime.value = time;
  if (origin) material.uniforms.uOrigin.value.copy(origin);
  if (axis) material.uniforms.uAxis.value.copy(axis);
  material.uniforms.uSpan.value = Math.max(span ?? 1, 0.001);
  material.uniforms.uInner.value = inner;
  material.uniforms.uRagged.value = ragged;
}
