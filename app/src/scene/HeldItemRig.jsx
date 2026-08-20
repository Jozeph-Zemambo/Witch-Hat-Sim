import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getHeldModel, disposeHeldModel, resolveHeldModelId } from '../inventory/heldModels.js';
import { MAIN_WORLD_FRAME_PRIORITY } from './framePriorities.js';

// Renders the equipped tool as a real 3D object in the world:
// - FPS view: a viewmodel anchored to the bottom-right of the camera with a
//   subtle idle bob and sway (damped under prefers-reduced-motion).
// - Third-person view: attached to the player avatar's right hand. Prefers an
//   explicit 'held-item-anchor' object (the ported character rig will provide
//   one), then any hand/right-arm-named node, then a fixed offset beside the
//   'player-character' group.

const FPS_OFFSET = new THREE.Vector3(0.36, -0.3, -0.85);
const FPS_SCALE = 0.16;
const THIRD_PERSON_SCALE = 0.24;
// Right-hand offset in player-local space (player faces local +Z; the
// character's right side is local -X). World units, relative to feet.
const HAND_OFFSET = new THREE.Vector3(-0.34, 0.82, 0.24);
const ANCHOR_NAME = 'held-item-anchor';
const HAND_NAME_PATTERN = /(^|[-_ ])(hand|arm)[-_ ]?(r|right)?\b|right[-_ ]?(hand|arm)/i;
const ANCHOR_RECHECK_FRAMES = 90;

// Per-item held pose, keyed by canonical model id. Applied on top of the hand
// anchor in third person (and as an extra tilt on the FPS viewmodel) so flat
// items rest against the palm instead of phasing through the mitten.
// rotation: Euler XYZ (radians) in anchor space; offset: anchor-space units
// (pre-scale item-local units are ~unit-sphere; offsets here are world units).
const DEFAULT_HOLD = {
  rotation: new THREE.Euler(0, 0, 0),
  offset: new THREE.Vector3(0, 0, 0),
  fpsRotation: new THREE.Euler(0, 0, 0),
};
const ITEM_HOLD = {
  spellpad: {
    rotation: new THREE.Euler(-1.7235, 0.5116, -2.0602),
    offset: new THREE.Vector3(0.0194, -0.0579, -0.0549),
    fpsRotation: new THREE.Euler(0.35, 0, 0),
  },
  manager: {
    rotation: new THREE.Euler(-2.2686, 0.4936, -1.7918),
    offset: new THREE.Vector3(-0.0086, -0.0749, -0.0361),
    fpsRotation: new THREE.Euler(0.35, 0, 0),
  },
  wrench: {
    rotation: new THREE.Euler(-2.2712, -1.4839, 2.2344),
    offset: new THREE.Vector3(-0.0073, -0.0216, 0.0363),
    fpsRotation: new THREE.Euler(0, 0, 0),
    scale: 1.1581,
  },
  'asset-manager': {
    rotation: new THREE.Euler(0, 0, 0),
    offset: new THREE.Vector3(0.0666, -0.0871, 0),
    fpsRotation: new THREE.Euler(0, 0, 0),
  },
  'weather-manager': {
    rotation: new THREE.Euler(0.3801, 0, 0),
    offset: new THREE.Vector3(-0.0517, 1.1592, 0.4464),
    fpsRotation: new THREE.Euler(0, 0, 0),
  },
  'mechanics-library': {
    rotation: new THREE.Euler(0.8862, 0.1594, -1.1442),
    offset: new THREE.Vector3(0.0225, -0.0859, -0.0473),
    fpsRotation: new THREE.Euler(0.3, 0, 0),
  },
};
// Third-person hold overrides calibrated in the Object Holding Lab
// (localStorage 'wha-holding-config'). Overrides apply to the
// third-person grip only; the FPS viewmodel always uses the built-in values.
const HOLDING_CONFIG_KEY = 'wha-holding-config';
const HOLDING_CONFIG_EVENT = 'wha-holding-config-change';
let holdingOverrides = {};
function loadHoldingOverrides() {
  try {
    const raw = window.localStorage.getItem(HOLDING_CONFIG_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    holdingOverrides = {};
    for (const [id, entry] of Object.entries(parsed)) {
      if (!entry) continue;
      const rotation = Array.isArray(entry.rotation) ? entry.rotation : null;
      const offset = Array.isArray(entry.offset) ? entry.offset : null;
      holdingOverrides[id] = {
        rotation: rotation ? new THREE.Euler(...rotation.map(Number)) : null,
        offset: offset ? new THREE.Vector3(...offset.map(Number)) : null,
        scale: Number.isFinite(entry.scale) ? Number(entry.scale) : null,
      };
    }
  } catch {
    holdingOverrides = {};
  }
}
if (typeof window !== 'undefined') {
  loadHoldingOverrides();
  window.addEventListener('storage', (event) => {
    if (!event.key || event.key === HOLDING_CONFIG_KEY) loadHoldingOverrides();
  });
  window.addEventListener(HOLDING_CONFIG_EVENT, loadHoldingOverrides);
}
function getHold(id) {
  const base = ITEM_HOLD[resolveHeldModelId(id)] ?? DEFAULT_HOLD;
  const override = holdingOverrides[resolveHeldModelId(id)];
  if (!override) return base;
  return {
    rotation: override.rotation ?? base.rotation,
    offset: override.offset ?? base.offset,
    fpsRotation: base.fpsRotation,
    scale: override.scale,
  };
}

const scratchPos = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const scratchEuler = new THREE.Euler();
const tiltQuat = new THREE.Quaternion();
const holdQuat = new THREE.Quaternion();
const holdOff = new THREE.Vector3();

function findHandAnchor(scene) {
  const explicit = scene.getObjectByName(ANCHOR_NAME);
  if (explicit) return { object: explicit, explicit: true };
  const player = scene.getObjectByName('player-character');
  if (!player) return null;
  let hand = null;
  player.traverse((o) => {
    if (hand) return;
    if (o.name && o.name !== 'player-character' && HAND_NAME_PATTERN.test(o.name)) {
      // Only right-side or generic hand/arm nodes.
      if (/left|[-_ ]l\b/i.test(o.name)) return;
      hand = o;
    }
  });
  if (hand) return { object: hand, explicit: true };
  return { object: player, explicit: false };
}

export default function HeldItemRig({ selectedTool, fpsCameraEnabled, inputEnabled = true }) {
  const { camera, scene, invalidate } = useThree();
  const groupRef = useRef(null);
  const modelRef = useRef(null);
  const anchorRef = useRef(null);
  const anchorAgeRef = useRef(ANCHOR_RECHECK_FRAMES);
  const clockRef = useRef(0);
  const reducedMotionRef = useRef(false);

  const reducedMotionQuery = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null,
    [],
  );
  useEffect(() => {
    const update = () => {
      reducedMotionRef.current = Boolean(reducedMotionQuery?.matches);
    };
    update();
    reducedMotionQuery?.addEventListener?.('change', update);
    return () => reducedMotionQuery?.removeEventListener?.('change', update);
  }, [reducedMotionQuery]);

  // Swap the model whenever the equipped tool changes.
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return undefined;
    const held = selectedTool ? getHeldModel(selectedTool) : null;
    if (held) group.add(held.group);
    modelRef.current = held;
    invalidate();
    return () => {
      if (held) {
        group.remove(held.group);
        disposeHeldModel(held.group);
      }
      if (modelRef.current === held) modelRef.current = null;
    };
  }, [selectedTool, invalidate]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    const held = modelRef.current;
    if (!group) return;
    if (!held || !inputEnabled) {
      group.visible = false;
      return;
    }
    group.visible = true;
    clockRef.current += delta;
    const t = clockRef.current;
    // Damp all idle motion under prefers-reduced-motion.
    const motion = reducedMotionRef.current ? 0.12 : 1;

    if (fpsCameraEnabled) {
      // Viewmodel: bottom-right of the camera, slight inward tilt, idle bob.
      scratchPos.set(
        FPS_OFFSET.x + Math.sin(t * 1.7) * 0.008 * motion,
        FPS_OFFSET.y + Math.sin(t * 2.3) * 0.012 * motion,
        FPS_OFFSET.z,
      );
      scratchPos.applyQuaternion(camera.quaternion).add(camera.position);
      group.position.copy(scratchPos);
      scratchEuler.set(-0.16 + Math.sin(t * 1.15) * 0.015 * motion, 0.42, 0.06);
      tiltQuat.setFromEuler(scratchEuler);
      holdQuat.setFromEuler(getHold(selectedTool).fpsRotation);
      group.quaternion.copy(camera.quaternion).multiply(tiltQuat).multiply(holdQuat);
      group.scale.setScalar(FPS_SCALE);
    } else {
      // Third-person: right hand (or best available anchor).
      anchorAgeRef.current += 1;
      if (!anchorRef.current || anchorAgeRef.current >= ANCHOR_RECHECK_FRAMES) {
        anchorRef.current = findHandAnchor(scene);
        anchorAgeRef.current = 0;
      }
      const anchor = anchorRef.current;
      if (!anchor) {
        group.visible = false;
        return;
      }
      if (anchor.explicit) {
        const hold = getHold(selectedTool);
        anchor.object.getWorldPosition(scratchPos);
        anchor.object.getWorldQuaternion(scratchQuat);
        holdOff.copy(hold.offset).applyQuaternion(scratchQuat);
        group.position.copy(scratchPos).add(holdOff);
        holdQuat.setFromEuler(hold.rotation);
        group.quaternion.copy(scratchQuat).multiply(holdQuat);
      } else {
        // Fixed offset beside the player-character group's right side.
        const player = anchor.object;
        scratchPos.copy(HAND_OFFSET);
        scratchQuat.setFromEuler(scratchEuler.set(0, player.rotation.y, 0));
        scratchPos.applyQuaternion(scratchQuat).add(player.position);
        scratchPos.y += Math.sin(t * 1.4) * 0.015 * motion;
        group.position.copy(scratchPos);
        scratchEuler.set(0.35, player.rotation.y + 0.25, 0);
        group.quaternion.setFromEuler(scratchEuler);
      }
      group.visible = anchor.explicit || anchor.object.visible;
      const holdScale = anchor.explicit ? getHold(selectedTool).scale : null;
      group.scale.setScalar(THIRD_PERSON_SCALE * (Number.isFinite(holdScale) ? holdScale : 1));
    }

    held.animate?.(held.group, t);
    // Keep idle/weather motion alive under the demand frameloop; skip when
    // reduced motion leaves the item effectively static (non-animated items).
    if (!reducedMotionRef.current || held.animate) invalidate();
  }, MAIN_WORLD_FRAME_PRIORITY.heldItemAttachment);

  return <group ref={groupRef} name="held-item-rig" />;
}
