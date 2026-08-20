// Drawn-on cartoon faces for the player character, PEAK-style: flat dot eyes and
// a simple mouth painted onto a canvas texture that wraps a thin overlay
// sphere on the head. Add new looks by registering another entry in FACES.

import * as THREE from 'three';

// Three.js SphereGeometry UVs: the local +Z direction (the way the character
// faces) lands at u = 0.25; v runs 0 (top) -> 1 (bottom). The canvas is
// 1024x512, so the face is drawn centered on (256, ~270).
const FACE_CENTER_U = 0.25;
const CANVAS_W = 1024;
const CANVAS_H = 512;

const INK = '#2b1c12';

const FACES = {
  // The default PEAK look: two oval eyes, small open-smile mouth.
  peak(ctx, cx, cy) {
    ctx.fillStyle = INK;
    // Eyes: simple vertical ovals, wide apart.
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + side * 62, cy - 26, 13, 20, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Mouth: small rounded open smile.
    ctx.beginPath();
    ctx.ellipse(cx, cy + 44, 26, 17, 0, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
  },
};

const textureCache = new Map();

export function createFaceTexture(variant = 'peak') {
  if (textureCache.has(variant)) return textureCache.get(variant);
  const draw = FACES[variant] ?? FACES.peak;
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  draw(ctx, FACE_CENTER_U * CANVAS_W, CANVAS_H * 0.53);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  textureCache.set(variant, texture);
  return texture;
}
