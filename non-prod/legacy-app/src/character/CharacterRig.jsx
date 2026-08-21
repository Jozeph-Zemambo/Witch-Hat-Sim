// Shared witch-character rig: geometry + pose/animation math extracted from the
// Character Lab so both the lab (/lab/character) and the main simulator world
// render the exact same avatar.
//
// Contract:
// - <CharacterModel bind={bind} /> renders the rig. `bind(name)` must return a
//   ref callback that stores each joint object under `name`. Joint names:
//   root, shadow, body, hips, torso, head, thighL/R, kneeL/R, footL/R,
//   shoulderL/R, elbowL/R.
// - The character faces local +Z; set root.rotation.y = atan2(moveX, moveZ).
// - Pose channels are plain numbers (see neutralPose). Build a frame target
//   with the *Targets helpers, blend with dampPose, apply with applyPose.
// - The anatomically RIGHT mitten hand contains an empty Object3D named
//   exactly 'held-item-anchor' (path: root > character-body > character-torso >
//   character-shoulder-L > character-elbow-L > character-hand >
//   held-item-anchor), positioned so a held object sits in the palm. The L/R
//   joint suffixes are mirrored vs anatomy (the character faces +Z, so its
//   right side is local -X, where the 'L'-suffixed limbs sit).
import { useMemo } from 'react';
import * as THREE from 'three';
import { createFaceTexture } from '../lab/characterFace.js';

// PEAK-style proportions: ~3.5 heads tall, no neck, high shoulders, stubby legs.
export const HIP_HEIGHT = 0.63;
export const HEAD_RADIUS = 0.21;
export const SHOULDER = { x: 0.26, y: 0.5 };
export const ELBOW_DROP = 0.24;
export const HIP_X = 0.11;
export const KNEE_DROP = 0.3;
export const ANKLE_DROP = 0.27;

export const HELD_ITEM_ANCHOR_NAME = 'held-item-anchor';

// Smoothly tapered lathe profile for the torso: seat -> gentle waist -> chest
// -> rounded shoulders. Rotationally symmetric, so the back is as clean as the
// front (no belly bulge, no seams).
const TORSO_PROFILE = [
  [0.001, 0.055],
  [0.085, 0.065],
  [0.155, 0.11],
  [0.198, 0.18],
  [0.202, 0.22],
  [0.188, 0.32],
  [0.192, 0.42],
  [0.196, 0.5],
  [0.178, 0.58],
  [0.128, 0.65],
  [0.001, 0.685],
].map(([x, y]) => new THREE.Vector2(x, y));

export const COLORS = {
  skin: '#d8b28c',
  tunic: '#315941',
  sleeves: '#3a6349',
  leggings: '#2a3a33',
  boots: '#2d241f',
  hatBrim: '#203a31',
  hatCrown: '#263f35',
  hatBand: '#c6ab5e',
};

const damp = THREE.MathUtils.damp;
const clamp = THREE.MathUtils.clamp;

// --- Pose math ---------------------------------------------------------------

// Rest pose the animation channels blend back to when a state stops driving them.
export function neutralPose() {
  return {
    bodyY: 0,
    bodyLean: 0,
    hipsRoll: 0,
    torsoYaw: 0,
    torsoRoll: 0,
    headTilt: 0,
    thighLx: 0,
    thighRx: 0,
    kneeLx: 0.06,
    kneeRx: 0.06,
    footLx: 0,
    footRx: 0,
    shLx: 0,
    shRx: 0,
    shLz: -0.1,
    shRz: 0.1,
    elLx: -0.28,
    elRx: -0.28,
  };
}

// Sign conventions (character faces local +Z): negative rotation.x swings a
// hanging limb forward; positive rotation.x on the torso leans it forward.
// `stride` scales the leg reach (1 = lab default) so the main world can widen
// the stride until per-cycle displacement matches the foot arc, without
// changing how /lab/character looks.
export function walkTargets(target, phase, s, stride = 1) {
  const swingL = Math.sin(phase);
  const swingR = Math.sin(phase + Math.PI);
  target.thighLx = -swingL * 0.62 * stride * s;
  target.thighRx = -swingR * 0.62 * stride * s;
  const kneeLift = 0.9 * (1 + (stride - 1) * 0.5);
  target.kneeLx = 0.06 + Math.max(0, Math.cos(phase)) * kneeLift * s;
  target.kneeRx = 0.06 + Math.max(0, -Math.cos(phase)) * kneeLift * s;
  target.footLx = -target.kneeLx * 0.5;
  target.footRx = -target.kneeRx * 0.5;
  // Arms counter-swing their opposite leg.
  target.shLx = -swingR * 0.42 * s;
  target.shRx = -swingL * 0.42 * s;
  target.elLx = -(0.3 + Math.max(0, swingR) * 0.35 * s);
  target.elRx = -(0.3 + Math.max(0, swingL) * 0.35 * s);
  target.bodyY = (Math.abs(Math.cos(phase)) - 0.5) * 0.05 * s;
  target.bodyLean = 0.1 * s;
  target.hipsRoll = swingL * 0.055 * s;
  target.torsoRoll = -swingL * 0.04 * s;
  target.torsoYaw = swingL * 0.07 * s;
  target.headTilt = -0.06 * s;
}

export function crouchTargets(target, k) {
  target.bodyY = -0.16 * k;
  target.bodyLean = 0.28 * k;
  target.thighLx = -0.75 * k;
  target.thighRx = -0.75 * k;
  target.kneeLx = 0.06 + 1.15 * k;
  target.kneeRx = 0.06 + 1.15 * k;
  target.footLx = -0.35 * k;
  target.footRx = -0.35 * k;
  target.shLx = 0.6 * k;
  target.shRx = 0.6 * k;
  target.elLx = -0.2;
  target.elRx = -0.2;
  target.headTilt = -0.22 * k;
}

export function airTargets(target, verticalVelocity) {
  // k blends the stretched launch pose (rising) into the tucked flail (falling).
  const k = clamp(0.5 - verticalVelocity * 0.22, 0, 1);
  target.bodyLean = 0.1 + 0.1 * k;
  target.thighLx = -0.25 - 0.65 * k;
  target.thighRx = -0.2 - 0.55 * k;
  target.kneeLx = 0.4 + 0.85 * k;
  target.kneeRx = 0.35 + 0.75 * k;
  target.footLx = -0.3;
  target.footRx = -0.25;
  // Rising: arms thrown overhead. Falling: arms wide, mittens out.
  target.shLx = -2.4 + 1.9 * k;
  target.shRx = -2.4 + 1.9 * k;
  target.shLz = -0.3 - 0.85 * k;
  target.shRz = 0.3 + 0.85 * k;
  target.elLx = -0.35;
  target.elRx = -0.35;
  target.headTilt = 0.12;
}

export function landTargets(target, k) {
  target.bodyY = -0.14 * k;
  target.bodyLean = 0.3 * k;
  target.thighLx = -0.6 * k;
  target.thighRx = -0.6 * k;
  target.kneeLx = 0.06 + 1.0 * k;
  target.kneeRx = 0.06 + 1.0 * k;
  target.footLx = -0.3 * k;
  target.footRx = -0.3 * k;
  target.shLx = -0.55 * k;
  target.shRx = -0.55 * k;
  target.headTilt = -0.18 * k;
}

export function idleTargets(target, time) {
  const breath = Math.sin(time * 1.7);
  target.bodyY = breath * 0.008;
  target.torsoRoll = Math.sin(time * 0.7) * 0.02;
  target.headTilt = Math.sin(time * 0.9) * 0.03;
  target.shLz = -0.1 + breath * 0.012;
  target.shRz = 0.1 - breath * 0.012;
}

// Exponentially blend every channel of `current` toward `target`.
export function dampPose(current, target, dt, lambda = 16) {
  for (const channel of Object.keys(current)) {
    current[channel] = damp(current[channel], target[channel], lambda, dt);
  }
  return current;
}

// Write a blended pose onto the bound joints. Does NOT touch root position or
// yaw — the caller owns world placement. `airY` (height above ground) drives
// the blob-shadow spread/fade.
export function applyPose(joints, pose, { airY = 0 } = {}) {
  const j = joints;
  if (j.body) j.body.position.y = HIP_HEIGHT + pose.bodyY;
  if (j.hips) j.hips.rotation.z = pose.hipsRoll;
  if (j.torso) j.torso.rotation.set(pose.bodyLean, pose.torsoYaw, pose.torsoRoll);
  if (j.head) j.head.rotation.x = pose.headTilt;
  if (j.thighL) j.thighL.rotation.x = pose.thighLx;
  if (j.thighR) j.thighR.rotation.x = pose.thighRx;
  if (j.kneeL) j.kneeL.rotation.x = pose.kneeLx;
  if (j.kneeR) j.kneeR.rotation.x = pose.kneeRx;
  if (j.footL) j.footL.rotation.x = pose.footLx;
  if (j.footR) j.footR.rotation.x = pose.footRx;
  if (j.shoulderL) j.shoulderL.rotation.set(pose.shLx, 0, pose.shLz);
  if (j.shoulderR) j.shoulderR.rotation.set(pose.shRx, 0, pose.shRz);
  if (j.elbowL) j.elbowL.rotation.x = pose.elLx;
  if (j.elbowR) j.elbowR.rotation.x = pose.elRx;
  if (j.shadow) {
    const spread = 1 / (1 + airY * 0.9);
    j.shadow.scale.setScalar(spread);
    j.shadow.material.opacity = 0.26 * spread;
  }
}

// --- Geometry ----------------------------------------------------------------

// A sphere sitting exactly on a joint pivot so the two segments it connects
// always read as one continuous limb, whatever angle the joint takes.
function JointCap({ radius, color, position = [0, 0, 0] }) {
  return (
    <mesh position={position} castShadow>
      <sphereGeometry args={[radius, 14, 10]} />
      <meshStandardMaterial color={color} roughness={0.88} />
    </mesh>
  );
}

// Drawn-on face: a thin transparent overlay sphere whose canvas texture holds
// the eyes + mouth (see characterFace.js for the variants).
function Face({ variant = 'peak' }) {
  const texture = useMemo(() => createFaceTexture(variant), [variant]);
  return (
    <mesh scale={1.012}>
      <sphereGeometry args={[HEAD_RADIUS, 28, 20]} />
      <meshBasicMaterial map={texture} transparent alphaTest={0.05} polygonOffset polygonOffsetFactor={-2} />
    </mesh>
  );
}

function Leg({ side, bind }) {
  const sign = side === 'L' ? -1 : 1;
  return (
    <group
      ref={bind(`thigh${side}`)}
      name={`character-thigh-${side}`}
      position={[sign * HIP_X, 0, 0]}
    >
      {/* Hip cap tucks the thigh up into the torso seat. */}
      <JointCap radius={0.105} color={COLORS.leggings} />
      <mesh position={[0, -0.15, 0]} castShadow>
        <capsuleGeometry args={[0.095, 0.13, 6, 14]} />
        <meshStandardMaterial color={COLORS.leggings} roughness={0.88} />
      </mesh>
      <group ref={bind(`knee${side}`)} name={`character-knee-${side}`} position={[0, -KNEE_DROP, 0]}>
        <JointCap radius={0.088} color={COLORS.leggings} />
        <mesh position={[0, -0.14, 0]} castShadow>
          <capsuleGeometry args={[0.08, 0.12, 6, 14]} />
          <meshStandardMaterial color={COLORS.leggings} roughness={0.88} />
        </mesh>
        <group
          ref={bind(`foot${side}`)}
          name={`character-foot-${side}`}
          position={[0, -ANKLE_DROP, 0]}
        >
          {/* Ankle cap bridges shin and boot. */}
          <JointCap radius={0.075} color={COLORS.boots} position={[0, 0.02, 0]} />
          <mesh position={[0, -0.02, 0.05]} scale={[1, 0.55, 1.45]} castShadow>
            <sphereGeometry args={[0.105, 14, 10]} />
            <meshStandardMaterial color={COLORS.boots} roughness={0.9} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

// Mitten hand: rounded palm, merged finger block with hinted grooves, and a
// stubby thumb on the inner side. The wrist sphere overlaps the forearm so
// hand and sleeve read as one piece.
function MittenHand({ sign }) {
  const grooveX = 0.026;
  return (
    <group
      name="character-hand"
      position={[0, -0.225, 0]}
      // Yaw the whole mitten 90° so the palm (hand-local +Z) faces the body
      // (anatomically neutral: palms inward, thumbs pointing forward/+Z).
      rotation={[0, -sign * (Math.PI / 2), sign * 0.06]}
    >
      {/* Sleeve cuff overlapping the forearm end. */}
      <mesh position={[0, 0.035, 0]} castShadow>
        <cylinderGeometry args={[0.068, 0.075, 0.06, 14]} />
        <meshStandardMaterial color={COLORS.sleeves} roughness={0.88} />
      </mesh>
      {/* Wrist. */}
      <mesh castShadow>
        <sphereGeometry args={[0.06, 12, 10]} />
        <meshStandardMaterial color={COLORS.skin} roughness={0.7} />
      </mesh>
      {/* Palm: flattened rounded block. */}
      <mesh position={[0, -0.055, 0.008]} scale={[1.05, 1.2, 0.62]} castShadow>
        <sphereGeometry args={[0.068, 14, 12]} />
        <meshStandardMaterial color={COLORS.skin} roughness={0.7} />
      </mesh>
      {/* Merged finger block. */}
      <mesh position={[0, -0.125, 0.012]} scale={[1, 0.85, 0.6]} castShadow>
        <sphereGeometry args={[0.062, 14, 12]} />
        <meshStandardMaterial color={COLORS.skin} roughness={0.7} />
      </mesh>
      {/* Hinted finger grooves: two thin shaded strips on the block front. */}
      {[-grooveX, grooveX].map((x) => (
        <mesh key={x} position={[x, -0.128, 0.045]}>
          <boxGeometry args={[0.006, 0.055, 0.012]} />
          <meshStandardMaterial color="#c29e78" roughness={0.8} />
        </mesh>
      ))}
      {/* Stubby thumb — on the hand-local edge that faces forward (world +Z)
          after the 90° palm-inward yaw above, so thumbs point forward. */}
      <mesh
        position={[sign * 0.062, -0.06, 0.022]}
        rotation={[0.25, 0, sign * 0.75]}
        castShadow
      >
        <capsuleGeometry args={[0.026, 0.04, 6, 10]} />
        <meshStandardMaterial color={COLORS.skin} roughness={0.7} />
      </mesh>
      {sign === -1 && (
        // Empty anchor the held-item system looks up by name. Sits just in
        // front of and slightly above the palm so a gripped object rests
        // naturally in the mitten, +Z pointing away from the palm.
        // NOTE: the character faces local +Z, so its anatomical RIGHT side is
        // local -X — which is the sign === -1 ('L'-suffixed) limb. The L/R
        // joint names are mirrored relative to anatomy; the anchor lives here
        // so held items sit in the character's true right hand.
        // The anchor's local yaw cancels the hand group's palm-inward yaw so
        // the anchor's effective orientation relative to the forearm is
        // unchanged and existing ITEM_HOLD calibrations remain valid.
        <object3D
          name={HELD_ITEM_ANCHOR_NAME}
          position={[0, -0.075, 0.055]}
          rotation={[0, sign * (Math.PI / 2), 0]}
        />
      )}
    </group>
  );
}

function Arm({ side, bind }) {
  const sign = side === 'L' ? -1 : 1;
  return (
    <group
      ref={bind(`shoulder${side}`)}
      name={`character-shoulder-${side}`}
      position={[sign * SHOULDER.x, SHOULDER.y, 0]}
    >
      {/* Shoulder cap tucks the sleeve into the torso. */}
      <JointCap radius={0.088} color={COLORS.sleeves} />
      <mesh position={[0, -0.12, 0]} castShadow>
        <capsuleGeometry args={[0.07, 0.11, 6, 14]} />
        <meshStandardMaterial color={COLORS.sleeves} roughness={0.88} />
      </mesh>
      <group
        ref={bind(`elbow${side}`)}
        name={`character-elbow-${side}`}
        position={[0, -ELBOW_DROP, 0]}
      >
        <JointCap radius={0.076} color={COLORS.sleeves} />
        <mesh position={[0, -0.11, 0]} castShadow>
          <capsuleGeometry args={[0.06, 0.1, 6, 14]} />
          <meshStandardMaterial color={COLORS.sleeves} roughness={0.88} />
        </mesh>
        <MittenHand sign={sign} />
      </group>
    </group>
  );
}

// The full witch character. `bind(name)` supplies ref callbacks for every
// animated joint; pass showShadow={false} to skip the blob shadow.
export function CharacterModel({ bind, faceVariant = 'peak', showShadow = true }) {
  return (
    <group ref={bind('root')} name="witch-character">
      {showShadow && (
        <mesh
          ref={bind('shadow')}
          name="character-shadow"
          position={[0, 0.014, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <circleGeometry args={[0.42, 28]} />
          <meshBasicMaterial color="#0b1712" transparent opacity={0.26} depthWrite={false} />
        </mesh>
      )}

      <group ref={bind('body')} name="character-body" position={[0, HIP_HEIGHT, 0]}>
        {/* Legs hang from the hip bar so they sway with it. */}
        <group ref={bind('hips')} name="character-hips">
          <Leg side="L" bind={bind} />
          <Leg side="R" bind={bind} />
        </group>

        {/* Upper body pivots at the hips: lean carries torso, arms, and head. */}
        <group ref={bind('torso')} name="character-torso">
          {/* Lathed torso: one smooth tapered form (seat, gentle waist,
              chest, rounded shoulders) — clean from every angle. Slightly
              squashed on z so the chest reads flatter than the sides. */}
          <mesh position={[0, 0, 0]} scale={[1, 1, 0.86]} castShadow>
            <latheGeometry args={[TORSO_PROFILE, 28]} />
            <meshStandardMaterial color={COLORS.tunic} roughness={0.86} />
          </mesh>

          <Arm side="L" bind={bind} />
          <Arm side="R" bind={bind} />

          {/* Big head sits straight on the shoulders — no neck, PEAK-style. */}
          <group ref={bind('head')} name="character-head" position={[0, 0.72, 0]}>
            <mesh castShadow>
              <sphereGeometry args={[HEAD_RADIUS, 22, 16]} />
              <meshStandardMaterial color={COLORS.skin} roughness={0.68} />
            </mesh>
            <Face variant={faceVariant} />
            <group position={[0, 0.15, 0]} rotation={[0, 0, 0.09]}>
              <mesh castShadow>
                <cylinderGeometry args={[0.31, 0.31, 0.035, 28]} />
                <meshStandardMaterial color={COLORS.hatBrim} roughness={0.9} />
              </mesh>
              <mesh position={[0, 0.05, 0]}>
                <cylinderGeometry args={[0.175, 0.195, 0.07, 20]} />
                <meshStandardMaterial color={COLORS.hatBand} roughness={0.55} />
              </mesh>
              <mesh position={[0, 0.23, 0]} castShadow>
                <coneGeometry args={[0.19, 0.4, 22]} />
                <meshStandardMaterial color={COLORS.hatCrown} roughness={0.86} />
              </mesh>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
