// Object Holding Lab scene: the witch character pinned in a static pose with
// the selected inventory item parented to the right-hand 'held-item-anchor'.
// TransformControls edit the item holder (offset / rotation / scale in anchor
// space); OrbitControls own the camera. READ-ONLY consumers of CharacterRig
// and heldModels — nothing here mutates those modules.
import { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls as ThreeOrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls as ThreeTransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { CharacterModel, neutralPose, applyPose } from '../character/CharacterRig.jsx';
import { getHeldModel, disposeHeldModel } from '../inventory/heldModels.js';

// Matches HeldItemRig.jsx THIRD_PERSON_SCALE — the base scale the game applies
// to every held item. The lab's per-item `scale` is a multiplier on top of it.
const BASE_HELD_SCALE = 0.24;
const ANCHOR_NAME = 'held-item-anchor';

export default function HoldingLabScene(props) {
  return (
    <Canvas
      className="scene-canvas lab-canvas"
      data-testid="holding-lab-canvas"
      aria-label="Object holding lab scene"
      shadows
      camera={{ position: [-1.35, 1.35, 1.5], fov: 42, near: 0.05, far: 60 }}
      dpr={[1, 2]}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
    >
      <color attach="background" args={['#101624']} />
      <hemisphereLight args={['#dfeaff', '#1a2032', 0.9]} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[4, 6, 4]} intensity={1.0} color="#fff3da" castShadow />
      <directionalLight position={[-4, 3, -2]} intensity={0.45} color="#9fc6ff" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[6, 40]} />
        <meshStandardMaterial color="#243040" roughness={0.95} />
      </mesh>
      <gridHelper args={[6, 12, '#3a4a60', '#2a3648']} position={[0, 0.005, 0]} />
      <HoldingRig {...props} />
    </Canvas>
  );
}

function HoldingRig({ itemId, config, armPose, gizmoMode, gizmoSpace, onGizmoChange }) {
  const joints = useRef({});
  const holderRef = useRef(null);
  const transformRef = useRef(null);
  const orbitRef = useRef(null);
  const onGizmoChangeRef = useRef(onGizmoChange);
  onGizmoChangeRef.current = onGizmoChange;
  const { scene, camera, gl } = useThree();

  // Pin the arm pose: neutral standing pose with the true-right arm (the
  // sign === -1 / 'L'-suffixed joints, per the mirrored rig naming) raised so
  // the mitten and held item are easy to inspect.
  const armPoseRef = useRef(armPose);
  armPoseRef.current = armPose;
  useFrame(() => {
    const pose = neutralPose();
    pose.shLx = armPoseRef.current.shoulderPitch;
    pose.shLz = armPoseRef.current.shoulderOut;
    pose.elLx = armPoseRef.current.elbow;
    applyPose(joints.current, pose, { airY: 0 });
    orbitRef.current?.update();
  });

  // Camera controls.
  useEffect(() => {
    const controls = new ThreeOrbitControls(camera, gl.domElement);
    controls.target.set(-0.3, 1.0, 0.25);
    controls.minDistance = 0.25;
    controls.maxDistance = 10;
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    orbitRef.current = controls;
    return () => {
      controls.dispose();
      orbitRef.current = null;
    };
  }, [camera, gl]);

  // Gizmo (created once).
  useEffect(() => {
    const controls = new ThreeTransformControls(camera, gl.domElement);
    controls.setSize(0.8);
    scene.add(controls.getHelper());
    controls.addEventListener('dragging-changed', (event) => {
      if (orbitRef.current) orbitRef.current.enabled = !event.value;
    });
    controls.addEventListener('objectChange', () => {
      const holder = holderRef.current;
      if (!holder) return;
      // Keep scale uniform whatever handle was dragged.
      if (controls.mode === 'scale') {
        const uniform = Math.max(0.01, holder.scale.x);
        holder.scale.setScalar(uniform);
      }
      onGizmoChangeRef.current?.({
        offset: [holder.position.x, holder.position.y, holder.position.z],
        rotation: [holder.rotation.x, holder.rotation.y, holder.rotation.z],
        scale: holder.scale.x,
      });
    });
    transformRef.current = controls;
    return () => {
      controls.detach();
      const helper = controls.getHelper();
      helper.parent?.remove(helper);
      controls.dispose();
      transformRef.current = null;
    };
  }, [camera, gl, scene]);

  useEffect(() => {
    transformRef.current?.setMode(gizmoMode);
  }, [gizmoMode]);
  useEffect(() => {
    transformRef.current?.setSpace(gizmoSpace);
  }, [gizmoSpace]);

  // Mount the selected item under the hand anchor.
  useEffect(() => {
    const anchor = scene.getObjectByName(ANCHOR_NAME);
    const held = itemId ? getHeldModel(itemId) : null;
    if (!anchor || !held) return undefined;
    const holder = new THREE.Group();
    holder.name = 'holding-lab-item-holder';
    const inner = new THREE.Group();
    inner.name = 'holding-lab-item-inner';
    inner.scale.setScalar(BASE_HELD_SCALE);
    inner.add(held.group);
    holder.add(inner);
    anchor.add(holder);
    holderRef.current = holder;
    transformRef.current?.attach(holder);
    return () => {
      transformRef.current?.detach();
      anchor.remove(holder);
      disposeHeldModel(held.group);
      if (holderRef.current === holder) holderRef.current = null;
    };
  }, [itemId, scene]);

  // Numeric config -> holder transform (gizmo drags write the same values
  // back through onGizmoChange, so this stays consistent both directions).
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    holder.position.set(config.offset[0], config.offset[1], config.offset[2]);
    holder.rotation.set(config.rotation[0], config.rotation[1], config.rotation[2]);
    holder.scale.setScalar(config.scale);
  }, [config, itemId]);

  const bind = (name) => (object) => {
    joints.current[name] = object;
  };

  return <CharacterModel bind={bind} showShadow={false} />;
}
