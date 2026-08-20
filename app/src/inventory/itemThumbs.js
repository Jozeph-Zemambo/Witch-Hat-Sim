import * as THREE from 'three';
import { getHeldModel, disposeHeldModel } from './heldModels.js';

// Minecraft-style offscreen renders of each inventory item.
// One shared WebGLRenderer is created lazily, used to render every item's
// representative mesh to a PNG data-URL, then disposed. Results are cached.
// The meshes are the same held-item models used in-world (heldModels.js), so
// the slot icon matches the object in the player's hand.

const HOTBAR_SIZE = 144;
const HELD_ITEM_SIZE = 224;
const caches = new Map();
const generatedSizes = new Set();
const generatingBySize = new Map();

// Fallback generic item — a tapered wand.
function fallbackBuilder() {
  const g = new THREE.Group();
  const wand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.18, 1.5, 12),
    new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.7 }),
  );
  wand.rotation.z = Math.PI * 0.18;
  g.add(wand);
  const tip = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.2),
    new THREE.MeshStandardMaterial({ color: 0x4e8f87, metalness: 0.5, roughness: 0.3 }),
  );
  tip.position.set(0.28, 0.78, 0);
  g.add(tip);
  return g;
}

function buildThumbGroup(id) {
  const held = getHeldModel(id);
  if (held) return held.group;
  return fallbackBuilder();
}

function renderThumb(renderer, scene, camera, id) {
  const group = buildThumbGroup(id);
  // Minecraft-ish angle.
  group.rotation.x += THREE.MathUtils.degToRad(20);
  group.rotation.y += THREE.MathUtils.degToRad(-28);
  scene.add(group);
  group.updateMatrixWorld(true);

  // Frame tight: center the model and fit its bounding sphere to ~85% of the
  // square frame so every item reads clearly at slot size.
  const bounds = new THREE.Box3().setFromObject(group);
  const center = bounds.getCenter(new THREE.Vector3());
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  group.position.sub(center);
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const fill = 0.85;
  const distance = sphere.radius / (fill * Math.tan(halfFov));
  camera.position.set(0, 0, Math.max(distance, sphere.radius + camera.near + 0.05));
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(group);
  disposeHeldModel(group);
  return url;
}

function cacheForSize(size) {
  if (!caches.has(size)) caches.set(size, new Map());
  return caches.get(size);
}

// Generate a fixed-size thumb set once. `items` is an array of { id }.
function ensureThumbs(items, size) {
  const cache = cacheForSize(size);
  if (generatedSizes.has(size)) return Promise.resolve(cache);
  if (generatingBySize.has(size)) return generatingBySize.get(size);

  const generating = new Promise((resolve) => {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setSize(size, size);
      renderer.setClearColor(0x000000, 0);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
      camera.position.set(0, 0, 5.4);
      camera.lookAt(0, 0, 0);

      scene.add(new THREE.AmbientLight(0xffffff, 0.85));
      const dir = new THREE.DirectionalLight(0xffffff, 1.0);
      dir.position.set(2, 3, 4);
      scene.add(dir);

      items.forEach(({ id }) => {
        try {
          cache.set(id, renderThumb(renderer, scene, camera, id));
        } catch {
          // leave uncached -> component falls back to icon
        }
      });
    } catch {
      // WebGL unavailable -> all fall back to icons
    } finally {
      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss?.();
      }
      generatedSizes.add(size);
      generatingBySize.delete(size);
      resolve(cache);
    }
  });
  generatingBySize.set(size, generating);
  return generating;
}

export function ensureItemThumbs(items) {
  return ensureThumbs(items, HOTBAR_SIZE);
}

export function ensureHeldItemThumbs(items) {
  return ensureThumbs(items, HELD_ITEM_SIZE);
}

export function getItemThumb(id, size = HOTBAR_SIZE) {
  return cacheForSize(size).get(id) ?? null;
}
