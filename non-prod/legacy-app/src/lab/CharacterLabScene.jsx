import { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls as ThreeOrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CharacterPhysics, loadRapier, SEESAW } from './characterPhysics.js';
import {
  CharacterModel,
  neutralPose,
  walkTargets,
  crouchTargets,
  airTargets,
  landTargets,
  idleTargets,
  dampPose,
  applyPose,
} from '../character/CharacterRig.jsx';

// --- Stage + locomotion constants -------------------------------------------
const BOUNDS = 5.2;
const GRAVITY = 20; // gamey gravity: snappier arcs than 9.8
const JUMP_VELOCITY = 5.3; // apex ≈ 0.7 m
const CROUCH_SECONDS = 0.13;
const LAND_SECONDS = 0.22;
const AUTO_TURN_RADIUS = 2.4; // auto-walk steers a constant-radius loop

const damp = THREE.MathUtils.damp;
const clamp = THREE.MathUtils.clamp;

function dampAngle(current, target, lambda, dt) {
  let delta = (target - current) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-lambda * dt));
}

export default function CharacterLabScene(props) {
  return (
    <Canvas
      className="scene-canvas lab-canvas"
      data-testid="character-lab-canvas"
      aria-label="Character design lab scene"
      shadows
      camera={{ position: [3.4, 2.1, 4.4], fov: 45, near: 0.1, far: 90 }}
      dpr={[1, 2]}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
    >
      <color attach="background" args={['#0e1320']} />
      <fog attach="fog" args={['#0e1320', 16, 34]} />
      <hemisphereLight args={['#dfeaff', '#1a2032', 0.85]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[5, 8, 4]} intensity={1.05} color="#fff3da" castShadow />
      <directionalLight position={[-4, 3, -3]} intensity={0.35} color="#9fc6ff" />
      <pointLight position={[0, 2.6, 2.4]} intensity={0.5} color="#ffffff" distance={14} />
      <Stage />
      <CharacterRig {...props} />
    </Canvas>
  );
}

function Stage() {
  return (
    <group name="character-lab-stage">
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[8, 48]} />
        <meshStandardMaterial color="#243d31" roughness={0.95} />
      </mesh>
      {/* Reference rings: auto-walk loop and the movement bounds. */}
      {[AUTO_TURN_RADIUS, BOUNDS].map((radius, index) => (
        <mesh key={radius} position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[radius, 0.014, 6, 96]} />
          <meshBasicMaterial color={index === 0 ? '#4f8567' : '#38506a'} />
        </mesh>
      ))}
      <HeightPole position={[-2.6, 0, -2.6]} />
    </group>
  );
}

// A striped measuring post (0.5 m bands up to 2 m) so body proportions read
// against a real-world scale while animations play.
function HeightPole({ position }) {
  return (
    <group position={position}>
      {[0, 1, 2, 3].map((band) => (
        <mesh key={band} position={[0, 0.25 + band * 0.5, 0]} castShadow>
          <cylinderGeometry args={[0.045, 0.045, 0.5, 10]} />
          <meshStandardMaterial
            color={band % 2 === 0 ? '#e8dcae' : '#8c2f2f'}
            roughness={0.85}
          />
        </mesh>
      ))}
      <mesh position={[0, 2.03, 0]}>
        <sphereGeometry args={[0.06, 12, 8]} />
        <meshStandardMaterial color="#c6ab5e" roughness={0.5} />
      </mesh>
    </group>
  );
}

function CameraFollowControls({ turntable, focusRef }) {
  const { camera, gl } = useThree();
  const controlsRef = useRef(null);
  useEffect(() => {
    const controls = new ThreeOrbitControls(camera, gl.domElement);
    controls.target.set(0, 0.9, 0);
    controls.minDistance = 1.8;
    controls.maxDistance = 14;
    controls.maxPolarAngle = Math.PI * 0.52;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controlsRef.current = controls;
    return () => {
      controls.dispose();
      controlsRef.current = null;
    };
  }, [camera, gl]);
  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.autoRotate = turntable;
    controls.autoRotateSpeed = 1.6;
    const focus = focusRef.current;
    if (focus) {
      const dt = Math.min(delta, 0.05);
      controls.target.x = damp(controls.target.x, focus.x, 6, dt);
      controls.target.y = damp(controls.target.y, focus.y + 0.9, 6, dt);
      controls.target.z = damp(controls.target.z, focus.z, 6, dt);
    }
    controls.update();
  });
  return null;
}

function movementKey(key) {
  const normalized = key.toLowerCase();
  if (normalized === 'w' || normalized === 'arrowup') return 'north';
  if (normalized === 's' || normalized === 'arrowdown') return 'south';
  if (normalized === 'a' || normalized === 'arrowleft') return 'west';
  if (normalized === 'd' || normalized === 'arrowright') return 'east';
  if (normalized === ' ' || normalized === 'spacebar') return 'jump';
  return null;
}

function isEditableEventTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)
  );
}

/* Pose math and rig geometry now live in ../character/CharacterRig.jsx. */

function CharacterRig({
  controlMode = 'keyboard',
  walkSpeed = 1.8,
  timeScale = 1,
  turntable = false,
  jumpSignal = 0,
  onStats,
}) {
  const joints = useRef({});
  const pose = useRef(neutralPose());
  const keysRef = useRef(new Set());
  const focusRef = useRef(new THREE.Vector3(0, 0, 0));
  const sim = useRef({
    x: 0,
    z: 0,
    facing: 0,
    heading: 0,
    phase: 0,
    speedFactor: 0,
    state: 'idle',
    stateTime: 0,
    airY: 0,
    verticalVelocity: 0,
    jumpQueued: false,
    statsClock: 0,
  });
  const physicsRef = useRef(null);

  // Real weight: a Rapier world owns gravity, contacts, and the seesaw plank.
  // Until (or unless) WASM loads, the old kinematic fallback keeps working.
  useEffect(() => {
    let disposed = false;
    let physics = null;
    loadRapier().then((rapier) => {
      if (disposed || !rapier) return;
      physics = new CharacterPhysics(rapier, { gravity: GRAVITY });
      physicsRef.current = physics;
    });
    return () => {
      disposed = true;
      physicsRef.current = null;
      physics?.dispose();
    };
  }, []);

  useEffect(() => {
    const setKey = (event, pressed) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableEventTarget(event.target)) return;
      const key = movementKey(event.key);
      if (!key) return;
      if (key === 'jump') {
        if (pressed) sim.current.jumpQueued = true;
      } else {
        keysRef.current[pressed ? 'add' : 'delete'](key);
      }
      event.preventDefault();
    };
    const handleKeyDown = (event) => setKey(event, true);
    const handleKeyUp = (event) => setKey(event, false);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const lastJumpSignal = useRef(jumpSignal);
  useEffect(() => {
    if (jumpSignal > lastJumpSignal.current) sim.current.jumpQueued = true;
    lastJumpSignal.current = jumpSignal;
  }, [jumpSignal]);

  useFrame((frame, rawDelta) => {
    const s = sim.current;
    const dt = Math.min(rawDelta, 0.05) * timeScale;
    const grounded = s.state !== 'air';

    // --- Steering ------------------------------------------------------------
    let moveX = 0;
    let moveZ = 0;
    if (controlMode === 'auto') {
      s.heading += dt * (walkSpeed / AUTO_TURN_RADIUS);
      moveX = Math.sin(s.heading);
      moveZ = Math.cos(s.heading);
    } else {
      const keys = keysRef.current;
      moveX = (keys.has('east') ? 1 : 0) - (keys.has('west') ? 1 : 0);
      moveZ = (keys.has('south') ? 1 : 0) - (keys.has('north') ? 1 : 0);
    }
    const moveLength = Math.hypot(moveX, moveZ);
    const moving = moveLength > 0 && s.state !== 'crouch' && s.state !== 'land';
    // Air control is reduced so jumps keep their takeoff momentum.
    const control = grounded ? 1 : 0.55;
    if (moving) {
      s.facing = dampAngle(s.facing, Math.atan2(moveX, moveZ), 12, dt);
    }
    const groundSpeed = moving && grounded ? walkSpeed : 0;
    s.speedFactor = damp(s.speedFactor, clamp(groundSpeed / 2.2, 0, 1), 8, dt);
    if (s.speedFactor > 0.02) {
      s.phase += dt * (4.6 + walkSpeed * 2.2) * Math.max(s.speedFactor, 0.4);
    }

    // --- Jump state machine ----------------------------------------------------
    if (s.jumpQueued && (s.state === 'idle' || s.state === 'walk')) {
      s.state = 'crouch';
      s.stateTime = 0;
    }
    s.jumpQueued = false;
    s.stateTime += dt;

    const physics = physicsRef.current;
    if (physics) {
      // Dynamic body: the solver owns gravity and vertical motion; the state
      // machine steers horizontal velocity and fires the jump impulse.
      const speed = moving ? walkSpeed * control : 0;
      physics.setMoveIntent(
        moving ? (moveX / moveLength) * speed : 0,
        moving ? (moveZ / moveLength) * speed : 0,
      );
      if (s.state === 'crouch' && s.stateTime >= CROUCH_SECONDS) {
        s.state = 'air';
        s.stateTime = 0;
        physics.jump(JUMP_VELOCITY);
      }
      physics.step(dt);
      physics.clampToBounds(BOUNDS);
      const body = physics.getCharacterState();
      s.x = body.x;
      s.z = body.z;
      s.airY = body.airY;
      s.verticalVelocity = body.verticalVelocity;
      if (s.state === 'air') {
        if (body.grounded && body.verticalVelocity <= 0.05 && s.stateTime > 0.06) {
          s.state = 'land';
          s.stateTime = 0;
        }
      } else if (s.state === 'land') {
        if (s.stateTime >= LAND_SECONDS) s.state = moving ? 'walk' : 'idle';
      } else if (s.state === 'idle' || s.state === 'walk') {
        if (!body.grounded && s.airY > 0.14) {
          // Walked off a ledge (e.g. the seesaw plank): free fall.
          s.state = 'air';
          s.stateTime = 0;
        } else {
          s.state = moving ? 'walk' : 'idle';
        }
      }
      const plank = physics.getPlankTransform();
      const plankMesh = joints.current.plank;
      if (plankMesh) {
        plankMesh.position.set(plank.position.x, plank.position.y, plank.position.z);
        plankMesh.quaternion.set(
          plank.quaternion.x,
          plank.quaternion.y,
          plank.quaternion.z,
          plank.quaternion.w,
        );
      }
    } else {
      // Kinematic fallback (Rapier WASM unavailable).
      if (moving) {
        const step = dt * walkSpeed * control;
        s.x = clamp(s.x + (moveX / moveLength) * step, -BOUNDS, BOUNDS);
        s.z = clamp(s.z + (moveZ / moveLength) * step, -BOUNDS, BOUNDS);
      }
      if (s.state === 'crouch' && s.stateTime >= CROUCH_SECONDS) {
        s.state = 'air';
        s.stateTime = 0;
        s.verticalVelocity = JUMP_VELOCITY;
      } else if (s.state === 'air') {
        s.verticalVelocity -= GRAVITY * dt;
        s.airY += s.verticalVelocity * dt;
        if (s.airY <= 0) {
          s.airY = 0;
          s.verticalVelocity = 0;
          s.state = 'land';
          s.stateTime = 0;
        }
      } else if (s.state === 'land' && s.stateTime >= LAND_SECONDS) {
        s.state = moving ? 'walk' : 'idle';
      } else if (s.state === 'idle' || s.state === 'walk') {
        s.state = moving ? 'walk' : 'idle';
      }
    }

    // --- Pose targets ----------------------------------------------------------
    const target = neutralPose();
    idleTargets(target, frame.clock.elapsedTime);
    if (s.speedFactor > 0.02) walkTargets(target, s.phase, s.speedFactor);
    if (s.state === 'crouch') {
      crouchTargets(target, Math.min(1, s.stateTime / CROUCH_SECONDS));
    } else if (s.state === 'air') {
      airTargets(target, s.verticalVelocity);
    } else if (s.state === 'land') {
      const recover = 1 - Math.min(1, s.stateTime / LAND_SECONDS);
      landTargets(target, recover * recover);
    }

    const current = dampPose(pose.current, target, dt);

    // --- Apply to the skeleton ---------------------------------------------------
    const j = joints.current;
    if (j.root) {
      j.root.position.set(s.x, s.airY, s.z);
      j.root.rotation.y = s.facing;
    }
    applyPose(j, current, { airY: s.airY });
    focusRef.current.set(s.x, s.airY * 0.5, s.z);

    // --- Debug + panel stats -----------------------------------------------------
    s.statsClock += rawDelta;
    if (s.statsClock >= 0.15) {
      s.statsClock = 0;
      const stats = {
        state: s.state,
        moving,
        speed: moving && grounded ? walkSpeed : 0,
        airHeight: Math.round(s.airY * 100) / 100,
        position: {
          x: Math.round(s.x * 100) / 100,
          z: Math.round(s.z * 100) / 100,
        },
      };
      window.__WHA_CHARACTER_LAB__ = stats;
      onStats?.(stats);
    }
  });

  const bind = (name) => (object) => {
    joints.current[name] = object;
  };

  return (
    <>
      <CharacterModel bind={bind} />
      <Seesaw bind={bind} />
      <CameraFollowControls turntable={turntable} focusRef={focusRef} />
    </>
  );
}

// Balanced seesaw the character can walk onto: the plank is a Rapier dynamic
// body hinged on the fulcrum, so the character's weight visibly tips it.
function Seesaw({ bind }) {
  const { position, pivotHeight, plankHalf } = SEESAW;
  // Keep the first rendered frame consistent with the dynamic body's spawn
  // pose. The near end rests on the ground, making the plank a walkable ramp
  // even while Rapier is initializing asynchronously.
  const initialTilt = Math.asin(Math.min(1, pivotHeight / plankHalf.x));
  return (
    <group name="character-lab-seesaw">
      <mesh position={[position.x, pivotHeight * 0.5, position.z]} castShadow receiveShadow>
        <cylinderGeometry args={[0.09, 0.13, pivotHeight, 16]} />
        <meshStandardMaterial color="#5a4632" roughness={0.85} />
      </mesh>
      <mesh
        ref={bind('plank')}
        position={[position.x, pivotHeight + plankHalf.y, position.z]}
        rotation={[0, 0, initialTilt]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[plankHalf.x * 2, plankHalf.y * 2, plankHalf.z * 2]} />
        <meshStandardMaterial color="#8a6b45" roughness={0.8} />
      </mesh>
    </group>
  );
}
