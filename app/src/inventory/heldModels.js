import * as THREE from 'three';

// Shared low-poly held-item models. One recognizable model per inventory tool.
// Used both by the in-world held-item rig (src/scene/HeldItemRig.jsx) and the
// hotbar thumbnail renderer (src/inventory/itemThumbs.js) so the icon in the
// slot is literally the object in the hand.
//
// getHeldModel(id) -> { group, animate } | null
//   group   — a fresh THREE.Group per call, roughly fits a unit sphere.
//   animate — optional (group, t) per-frame hook (t in seconds).

// Witch Hat Atelier parchment/teal/ink palette.
const INK = 0x2b241d;
const TEAL = 0x4e8f87;
const TEAL_DEEP = 0x33655f;
const GOLD = 0xb9974f;
const WARM_RED = 0xa93b2c;
const CREAM = 0xf2e8d5;
const PARCH = 0xe9dcc3;
const WOOD = 0x8a6a3f;
const WOOD_DARK = 0x6b4e2c;
const STEEL = 0x9aa6ad;
const STEEL_LIGHT = 0xbcc6cc;

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.62,
    metalness: opts.metalness ?? 0.08,
    ...opts,
  });
}

function box(w, h, d, material) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
}

// --- spellpad: an open-topped notepad with pages curled over the binding ---
function buildSpellpad() {
  const g = new THREE.Group();
  const coverMat = mat(TEAL_DEEP, { roughness: 0.7 });
  const pageMat = mat(CREAM, { roughness: 0.9 });
  const pageEdgeMat = mat(PARCH, { roughness: 0.9 });

  // Back cover.
  const back = box(1.05, 0.08, 1.4, coverMat);
  g.add(back);
  // Page block sitting on the cover.
  const block = box(0.96, 0.16, 1.3, pageEdgeMat);
  block.position.set(0, 0.12, 0.03);
  g.add(block);
  // Top flat page with a drawn spell: an ink circle with a simple sign inside.
  const top = box(0.94, 0.02, 1.26, pageMat);
  top.position.set(0, 0.21, 0.03);
  g.add(top);
  const inkMat = mat(INK, { roughness: 0.8 });
  const pageY = 0.226;
  const circleZ = 0.08;
  // Outer spell circle.
  const circle = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.022, 6, 28), inkMat);
  circle.rotation.x = -Math.PI / 2;
  circle.position.set(0, pageY, circleZ);
  g.add(circle);
  // Sign inside the circle: a keystone glyph — vertical stroke, crossbar,
  // and two short angled ticks, like a rough rune.
  const strokeV = box(0.028, 0.012, 0.4, inkMat);
  strokeV.position.set(0, pageY, circleZ);
  g.add(strokeV);
  const strokeH = box(0.34, 0.012, 0.028, inkMat);
  strokeH.position.set(0, pageY, circleZ - 0.07);
  g.add(strokeH);
  const tickA = box(0.16, 0.012, 0.026, inkMat);
  tickA.position.set(-0.11, pageY, circleZ + 0.12);
  tickA.rotation.y = 0.7;
  g.add(tickA);
  const tickB = box(0.16, 0.012, 0.026, inkMat);
  tickB.position.set(0.11, pageY, circleZ + 0.12);
  tickB.rotation.y = -0.7;
  g.add(tickB);
  // Small accent ring at the circle's edge, like a linked sub-seal.
  const subSeal = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.016, 6, 18), mat(TEAL, { roughness: 0.5 }));
  subSeal.rotation.x = -Math.PI / 2;
  subSeal.position.set(0.24, pageY, circleZ - 0.24);
  g.add(subSeal);
  // Spiral binding along the -Z edge.
  const ringMat = mat(GOLD, { metalness: 0.6, roughness: 0.3 });
  for (let i = 0; i < 6; i += 1) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.02, 6, 14), ringMat);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(-0.42 + i * 0.168, 0.13, -0.68);
    g.add(ring);
  }
  // Flipped/curled pages arched over the binding.
  for (let i = 0; i < 3; i += 1) {
    const flipped = box(0.9, 0.018, 0.66, pageMat.clone());
    flipped.position.set(0, 0.3 + i * 0.045, -0.5 - i * 0.06);
    flipped.rotation.x = -(0.85 + i * 0.28);
    g.add(flipped);
  }
  g.rotation.x = 0.28;
  return g;
}

// --- manager (Spell Manager): clipboard with checklist and a tick ---
function buildSpellManager() {
  const g = new THREE.Group();
  // Board.
  const board = box(1.05, 0.07, 1.45, mat(WOOD, { roughness: 0.82 }));
  g.add(board);
  // Paper.
  const paper = box(0.92, 0.03, 1.28, mat(CREAM, { roughness: 0.9 }));
  paper.position.y = 0.05;
  g.add(paper);
  // Clip at the top.
  const clip = box(0.44, 0.1, 0.16, mat(STEEL, { metalness: 0.7, roughness: 0.3 }));
  clip.position.set(0, 0.09, -0.62);
  g.add(clip);
  const clipHinge = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 0.44, 10),
    mat(STEEL_LIGHT, { metalness: 0.7, roughness: 0.3 }),
  );
  clipHinge.rotation.z = Math.PI / 2;
  clipHinge.position.set(0, 0.12, -0.56);
  g.add(clipHinge);
  // Checklist: small check boxes + text lines.
  const inkMat = mat(INK, { roughness: 0.8 });
  const tealMat = mat(TEAL, { roughness: 0.5 });
  for (let i = 0; i < 4; i += 1) {
    const z = -0.34 + i * 0.28;
    const checkbox = box(0.13, 0.015, 0.13, i === 0 ? tealMat : inkMat);
    checkbox.position.set(-0.3, 0.072, z);
    g.add(checkbox);
    const line = box(0.42, 0.015, 0.05, inkMat);
    line.position.set(0.1, 0.072, z);
    g.add(line);
  }
  // Big tick on the first row (two small angled bars).
  const tickMat = mat(WARM_RED, { roughness: 0.5 });
  const tickA = box(0.1, 0.03, 0.035, tickMat);
  tickA.position.set(-0.34, 0.09, -0.31);
  tickA.rotation.y = -0.8;
  g.add(tickA);
  const tickB = box(0.2, 0.03, 0.035, tickMat);
  tickB.position.set(-0.24, 0.09, -0.36);
  tickB.rotation.y = 0.65;
  g.add(tickB);
  g.rotation.x = 0.32;
  return g;
}

// --- wrench: chunky readable spanner ---
function buildWrench() {
  const g = new THREE.Group();
  const steel = mat(STEEL, { metalness: 0.72, roughness: 0.32 });
  const steelLight = mat(STEEL_LIGHT, { metalness: 0.72, roughness: 0.28 });
  // Handle.
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 1.35, 10), steel);
  g.add(handle);
  // Grip band.
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.235, 0.44, 10), mat(TEAL_DEEP, { roughness: 0.7 }));
  grip.position.y = -0.42;
  g.add(grip);
  // Open jaw head: a fat C made from a partial torus + two jaw blocks.
  const head = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.17, 10, 18, Math.PI * 1.35), steelLight);
  head.position.y = 0.82;
  head.rotation.z = Math.PI * 0.32;
  g.add(head);
  const jawA = box(0.24, 0.34, 0.3, steelLight);
  jawA.position.set(-0.3, 1.06, 0);
  jawA.rotation.z = 0.25;
  g.add(jawA);
  const jawB = box(0.24, 0.3, 0.3, steelLight);
  jawB.position.set(0.34, 1.0, 0);
  jawB.rotation.z = -0.25;
  g.add(jawB);
  // Ring end.
  const ringEnd = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.14, 10, 16), steel);
  ringEnd.position.y = -0.74;
  g.add(ringEnd);
  g.rotation.z = -0.5;
  g.scale.setScalar(0.85);
  return g;
}

// --- asset-manager: banded wooden crate ---
function buildAssetManager() {
  const g = new THREE.Group();
  const body = box(1.1, 1.1, 1.1, mat(WOOD, { roughness: 0.85 }));
  g.add(body);
  // Plank grooves: darker slats on each visible axis.
  const slatMat = mat(WOOD_DARK, { roughness: 0.9 });
  for (let i = -1; i <= 1; i += 2) {
    const slatX = box(1.14, 0.1, 1.14, slatMat);
    slatX.position.y = i * 0.32;
    g.add(slatX);
  }
  // Gold banding.
  const bandMat = mat(GOLD, { metalness: 0.6, roughness: 0.3 });
  const bandH = box(1.18, 0.14, 1.18, bandMat);
  g.add(bandH);
  const bandV = box(0.14, 1.18, 1.18, bandMat);
  g.add(bandV);
  // Teal seal stamp on the front face.
  const stamp = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 6, 18), mat(TEAL, { roughness: 0.5 }));
  stamp.position.set(0.34, 0.05, 0.58);
  g.add(stamp);
  g.rotation.y = 0.5;
  g.scale.setScalar(0.78);
  return g;
}

// --- weather-manager: floating sun + cloud + rain cluster (animated) ---
function buildWeatherManager() {
  const g = new THREE.Group();

  const sun = new THREE.Group();
  sun.name = 'weather-sun';
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 18, 14),
    mat(GOLD, { metalness: 0.25, roughness: 0.4, emissive: 0x6b4a10 }),
  );
  sun.add(core);
  const rayMat = mat(GOLD, { metalness: 0.3, roughness: 0.4, emissive: 0x4a3208 });
  for (let i = 0; i < 8; i += 1) {
    const ray = box(0.2, 0.07, 0.07, rayMat);
    const a = (i / 8) * Math.PI * 2;
    ray.position.set(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0);
    ray.rotation.z = a;
    sun.add(ray);
  }
  sun.position.set(0.42, 0.44, -0.1);
  g.add(sun);

  const cloud = new THREE.Group();
  cloud.name = 'weather-cloud';
  const cloudMat = mat(CREAM, { roughness: 0.92 });
  [[-0.3, 0, 0.26], [0.02, 0.09, 0.32], [0.34, -0.02, 0.24], [0.02, -0.1, 0.27]].forEach(([x, y, r]) => {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 12), cloudMat);
    puff.position.set(x, y, 0);
    cloud.add(puff);
  });
  cloud.position.set(-0.32, -0.05, 0.12);
  g.add(cloud);

  const rain = new THREE.Group();
  rain.name = 'weather-rain';
  const dropMat = mat(TEAL, { roughness: 0.35, metalness: 0.15, transparent: true, opacity: 0.9 });
  for (let i = 0; i < 5; i += 1) {
    const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.24, 6), dropMat);
    drop.position.set(-0.62 + i * 0.16, -0.52 - (i % 2) * 0.12, 0.12);
    drop.rotation.z = 0.12;
    rain.add(drop);
    drop.userData.baseY = drop.position.y;
    drop.userData.phase = i * 1.3;
  }
  g.add(rain);
  return g;
}

function animateWeatherManager(group, t) {
  const sun = group.getObjectByName('weather-sun');
  if (sun) {
    sun.rotation.z = t * 0.5;
    sun.position.y = 0.44 + Math.sin(t * 1.3) * 0.05;
  }
  const cloud = group.getObjectByName('weather-cloud');
  if (cloud) {
    cloud.position.y = -0.05 + Math.sin(t * 1.1 + 1.7) * 0.045;
    cloud.position.x = -0.32 + Math.sin(t * 0.55) * 0.03;
  }
  const rain = group.getObjectByName('weather-rain');
  if (rain) {
    rain.children.forEach((drop) => {
      const phase = drop.userData.phase ?? 0;
      drop.position.y = (drop.userData.baseY ?? -0.55) - ((t * 0.55 + phase) % 0.3);
    });
  }
}

// --- mechanics-library: small book with a gear on the cover ---
function buildMechanicsLibrary() {
  const g = new THREE.Group();
  const coverMat = mat(WARM_RED, { roughness: 0.72 });
  // Covers + page block.
  const backCover = box(1.0, 0.07, 1.35, coverMat);
  backCover.position.y = -0.14;
  g.add(backCover);
  const frontCover = box(1.0, 0.07, 1.35, coverMat);
  frontCover.position.y = 0.14;
  g.add(frontCover);
  const pages = box(0.92, 0.22, 1.27, mat(CREAM, { roughness: 0.92 }));
  g.add(pages);
  // Spine.
  const spine = box(0.1, 0.36, 1.35, mat(0x7c2a1e, { roughness: 0.7 }));
  spine.position.x = -0.52;
  g.add(spine);
  // Gear on the cover: ring + teeth + hub.
  const gearMat = mat(GOLD, { metalness: 0.65, roughness: 0.3 });
  const gear = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.07, 8, 20), gearMat);
  ring.rotation.x = Math.PI / 2;
  gear.add(ring);
  for (let i = 0; i < 8; i += 1) {
    const tooth = box(0.12, 0.07, 0.09, gearMat);
    const a = (i / 8) * Math.PI * 2;
    tooth.position.set(Math.cos(a) * 0.34, 0, Math.sin(a) * 0.34);
    tooth.rotation.y = -a;
    gear.add(tooth);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.1, 10), gearMat);
  gear.add(hub);
  gear.position.set(0.06, 0.21, 0.05);
  g.add(gear);
  g.rotation.x = 0.3;
  return g;
}

// Canonical builders plus id aliases: the hotbar item list uses camelCase ids
// (spellManager, assetManager, ...) while the tool-selection layer uses
// kebab/short ids (manager, asset-manager, ...). Support both.
const HELD_MODEL_DEFS = {
  spellpad: { build: buildSpellpad },
  manager: { build: buildSpellManager },
  wrench: { build: buildWrench },
  'asset-manager': { build: buildAssetManager },
  'weather-manager': { build: buildWeatherManager, animate: animateWeatherManager },
  'mechanics-library': { build: buildMechanicsLibrary },
};

const HELD_MODEL_ALIASES = {
  spellManager: 'manager',
  'spell-manager': 'manager',
  assetManager: 'asset-manager',
  weatherManager: 'weather-manager',
  mechanicsLibrary: 'mechanics-library',
};

export function resolveHeldModelId(id) {
  if (!id) return null;
  const canonical = HELD_MODEL_ALIASES[id] ?? id;
  return HELD_MODEL_DEFS[canonical] ? canonical : null;
}

// Returns { group, animate } with a fresh THREE.Group, or null for unknown ids.
export function getHeldModel(id) {
  const canonical = resolveHeldModelId(id);
  if (!canonical) return null;
  const def = HELD_MODEL_DEFS[canonical];
  const group = def.build();
  group.name = `held-model:${canonical}`;
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
    }
  });
  return { group, animate: def.animate ?? null };
}

export function disposeHeldModel(group) {
  group?.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
    }
  });
}
