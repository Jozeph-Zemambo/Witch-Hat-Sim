import { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls as ThreeOrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  AtelierMechanicsDesk,
  AtelierWritingDesk,
  InkpotAndQuill,
  MortarAndPestle,
  OpenSpellpad,
} from '../scene/AtelierDesks.jsx';
import { ATELIER_DESK_LAYOUT } from '../world-physics/force-contract.js';

const VIEW_PRESETS = Object.freeze({
  free: { position: [2.65, 2.15, 2.8], target: [0, 0.95, 0] },
  top: { position: [0, 5, 0.001], target: [0, 0.75, 0], up: [0, 0, -1] },
  front: { position: [0, 1.42, 3.25], target: [0, 1.02, 0] },
  back: { position: [0, 1.42, -3.25], target: [0, 1.02, 0] },
  left: { position: [-3.25, 1.42, 0], target: [0, 1.02, 0] },
  right: { position: [3.25, 1.42, 0], target: [0, 1.02, 0] },
  player: { position: [0, 1.8, 2.25], target: [0, 1.22, 0] },
  legs: { position: [2.4, 0.72, 2.55], target: [0, 0.76, 0] },
});

const PROP_SURFACE_Y = 0.55;
const PROP_VIEW_PRESETS = Object.freeze({
  spellpad: {
    free: { position: [0.72, 1.12, 0.82], target: [0, 0.57, 0] },
    top: { position: [0, 2.25, 0.001], target: [0, 0.55, 0], up: [0, 0, -1] },
    front: { position: [0, 0.72, 1.28], target: [0, 0.565, 0] },
    back: { position: [0, 0.72, -1.28], target: [0, 0.565, 0] },
    left: { position: [-1.28, 0.72, 0], target: [0, 0.565, 0] },
    right: { position: [1.28, 0.72, 0], target: [0, 0.565, 0] },
    player: { position: [0, 0.98, 0.9], target: [0, 0.56, 0] },
    legs: { position: [0.85, 0.585, 0.9], target: [0, 0.56, 0] },
  },
  quill: {
    free: { position: [0.72, 1.06, 0.9], target: [0, 0.76, 0] },
    top: { position: [0, 1.8, 0.001], target: [0, 0.72, 0], up: [0, 0, -1] },
    front: { position: [0, 0.78, 1.05], target: [0, 0.76, 0] },
    back: { position: [0, 0.78, -1.05], target: [0, 0.76, 0] },
    left: { position: [-1.05, 0.78, 0], target: [0, 0.76, 0] },
    right: { position: [1.05, 0.78, 0], target: [0, 0.76, 0] },
    player: { position: [0, 1.04, 0.9], target: [0, 0.76, 0] },
    legs: { position: [0.62, 0.68, 0.78], target: [0, 0.68, 0] },
  },
  mortar: {
    free: { position: [0.48, 0.84, 0.58], target: [0, 0.64, 0] },
    top: { position: [0, 1.5, 0.001], target: [0, 0.62, 0], up: [0, 0, -1] },
    front: { position: [0, 0.68, 0.68], target: [0, 0.63, 0] },
    back: { position: [0, 0.68, -0.68], target: [0, 0.63, 0] },
    left: { position: [-0.68, 0.68, 0], target: [0, 0.63, 0] },
    right: { position: [0.68, 0.68, 0], target: [0, 0.63, 0] },
    player: { position: [0, 0.82, 0.52], target: [0, 0.63, 0] },
    legs: { position: [0.43, 0.6, 0.5], target: [0, 0.61, 0] },
  },
});

export default function DeskLabScene({
  subject,
  view,
  spellpadAcquired,
  contactOverlay,
  lighting,
  onQaChange,
}) {
  const orthographic = view === 'top';
  const isDesk = subject === 'writing' || subject === 'mechanics';
  return (
    <Canvas
      key={`${subject}-${orthographic ? 'desk-lab-ortho' : 'desk-lab-perspective'}`}
      className="scene-canvas lab-canvas"
      data-testid="desk-lab-canvas"
      aria-label={`${subject} inspection scene`}
      shadows
      orthographic={orthographic}
      camera={orthographic
        ? { position: [0, 5, 0.001], zoom: isDesk ? 285 : 720, near: 0.01, far: 50 }
        : { position: [2.65, 2.15, 2.8], fov: 40, near: 0.03, far: 50 }}
      dpr={[1, 2]}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
    >
      <color attach="background" args={[lighting === 'atelier' ? '#d9c89e' : '#dce4e2']} />
      {lighting === 'atelier' ? (
        <>
          <hemisphereLight args={['#fff0cc', '#514630', 1.1]} />
          <ambientLight intensity={0.45} />
          <directionalLight position={[4, 6, 3]} intensity={1.35} color="#ffe0a9" castShadow />
          <directionalLight position={[-3, 3, -2]} intensity={0.35} color="#95b7ae" />
        </>
      ) : (
        <>
          <hemisphereLight args={['#ffffff', '#66706d', 1.35]} />
          <ambientLight intensity={0.7} />
          <directionalLight position={[4, 7, 5]} intensity={1.1} color="#ffffff" castShadow />
          <directionalLight position={[-4, 4, -3]} intensity={0.55} color="#cce4df" />
        </>
      )}
      <mesh
        name="desk-lab-floor"
        position={[0, ATELIER_DESK_LAYOUT.floorY - 0.018, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[7, 7]} />
        <meshStandardMaterial color={lighting === 'atelier' ? '#6f634a' : '#8f9b97'} roughness={0.95} />
      </mesh>
      <gridHelper
        args={[5, 20, '#52615d', '#81908c']}
        position={[0, ATELIER_DESK_LAYOUT.floorY + 0.002, 0]}
      />
      {subject === 'writing' ? (
        <AtelierWritingDesk
          spellpadAcquired={spellpadAcquired}
          showObjectiveMarker={false}
        />
      ) : subject === 'mechanics' ? (
        <AtelierMechanicsDesk />
      ) : (
        <>
          <InspectionPlinth />
          {subject === 'spellpad' ? (
            <OpenSpellpad position={[0, PROP_SURFACE_Y, 0]} rotation={[0, 0, 0]} />
          ) : null}
          {subject === 'quill' ? <InkpotAndQuill position={[0, PROP_SURFACE_Y, 0]} /> : null}
          {subject === 'mortar' ? <MortarAndPestle position={[0, PROP_SURFACE_Y, 0]} /> : null}
        </>
      )}
      {contactOverlay && isDesk ? <ContactOverlay deskKind={subject} /> : null}
      <DeskCamera subject={subject} view={view} />
      <DeskQaProbe
        subject={subject}
        spellpadAcquired={spellpadAcquired}
        onQaChange={onQaChange}
      />
    </Canvas>
  );
}

function InspectionPlinth() {
  return (
    <mesh name="prop-inspection-plinth" position={[0, PROP_SURFACE_Y - 0.025, 0]} receiveShadow>
      <boxGeometry args={[0.9, 0.05, 0.72]} />
      <meshStandardMaterial color="#aaa28e" roughness={0.94} />
    </mesh>
  );
}

function DeskCamera({ subject, view }) {
  const controlsRef = useRef(null);
  const { camera, gl, invalidate } = useThree();
  const presets = PROP_VIEW_PRESETS[subject] ?? VIEW_PRESETS;
  const preset = presets[view] ?? presets.free;

  useEffect(() => {
    camera.up.set(...(preset.up ?? [0, 1, 0]));
    camera.position.set(...preset.position);
    camera.lookAt(new THREE.Vector3(...preset.target));
    camera.updateProjectionMatrix();
    const controls = new ThreeOrbitControls(camera, gl.domElement);
    controls.target.set(...preset.target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.11;
    controls.minDistance = 0.45;
    controls.maxDistance = 10;
    controls.maxPolarAngle = Math.PI * 0.98;
    controls.addEventListener('change', invalidate);
    controls.update();
    controlsRef.current = controls;
    invalidate();
    return () => {
      controls.removeEventListener('change', invalidate);
      controls.dispose();
      controlsRef.current = null;
    };
  }, [camera, gl, invalidate, preset]);

  useFrame(() => controlsRef.current?.update());
  return null;
}

function ContactOverlay({ deskKind }) {
  const dimensions = ATELIER_DESK_LAYOUT[deskKind];
  const topBottom = ATELIER_DESK_LAYOUT.topCenterY - ATELIER_DESK_LAYOUT.topThickness / 2;
  return (
    <group name="desk-contact-overlay">
      <mesh
        name="top-contact-plane"
        position={[0, ATELIER_DESK_LAYOUT.topSurfaceY + 0.002, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[dimensions.width, dimensions.depth]} />
        <meshBasicMaterial
          color="#20a16b"
          transparent
          opacity={0.18}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh
        name="underside-contact-plane"
        position={[0, topBottom - 0.002, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[dimensions.width, dimensions.depth]} />
        <meshBasicMaterial
          color="#2967b0"
          transparent
          opacity={0.13}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh
        name="floor-contact-plane"
        position={[0, ATELIER_DESK_LAYOUT.floorY + 0.003, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[dimensions.width + 0.4, dimensions.depth + 0.4]} />
        <meshBasicMaterial
          color="#d2a42e"
          transparent
          opacity={0.15}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

function DeskQaProbe({ subject, spellpadAcquired, onQaChange }) {
  const { scene } = useThree();

  useEffect(() => {
    scene.updateMatrixWorld(true);
    const contacts = [];
    scene.traverse((object) => {
      if (!object.userData?.qaTopProp) return;
      const bounds = new THREE.Box3().setFromObject(object);
      const expected = Number(object.userData.contactSurfaceY);
      const delta = bounds.min.y - expected;
      contacts.push({
        name: object.name,
        expected: round(expected),
        actual: round(bounds.min.y),
        delta: round(delta),
        pass: Math.abs(delta) <= 0.008,
      });
    });

    const isDesk = subject === 'writing' || subject === 'mechanics';
    const topBottom = ATELIER_DESK_LAYOUT.topCenterY - ATELIER_DESK_LAYOUT.topThickness / 2;
    const legs = isDesk
      ? ['left-front', 'right-front', 'left-rear', 'right-rear'].map((label) => {
        const object = scene.getObjectByName(`${subject}-leg-${label}`);
        const bounds = object ? new THREE.Box3().setFromObject(object) : null;
        const floorDelta = bounds ? bounds.min.y - ATELIER_DESK_LAYOUT.floorY : Infinity;
        const undersideDelta = bounds ? bounds.max.y - topBottom : Infinity;
        return {
          name: label,
          floorDelta: round(floorDelta),
          undersideDelta: round(undersideDelta),
          pass: Math.abs(floorDelta) <= 0.002 && Math.abs(undersideDelta) <= 0.002,
        };
      })
      : [];
    const inkLayers = [];
    scene.traverse((object) => {
      if (!object.userData?.flatSpellInk) return;
      inkLayers.push({
        name: object.name,
        clearance: round(object.userData.clearance),
        pass: object.userData.clearance <= 0.001,
      });
    });
    const quill = scene.getObjectByName('inkpot-and-quill');
    const mortar = scene.getObjectByName('mortar-and-pestle');
    const result = {
      deskKind: isDesk ? subject : null,
      subject,
      spellpadAcquired,
      contacts,
      legs,
      inkLayers,
      allContactsPass: isDesk ? contacts.length > 0 && contacts.every((entry) => entry.pass) : true,
      allLegsPass: isDesk ? legs.every((entry) => entry.pass) : true,
      flatInkPass: inkLayers.length > 0 && inkLayers.every((entry) => entry.pass),
      quillInsertionDepth: round(quill?.userData?.insertionDepth),
      quillInsertionPass: Boolean(quill?.userData?.insertionDepth >= 0.035),
      mortarCavityDepth: round(mortar?.userData?.cavityDepth),
      mortarCavityPass: Boolean(mortar?.userData?.mortarCavity && mortar.userData.cavityDepth >= 0.04),
    };
    window.__WHA_DESK_LAB__ = result;
    onQaChange?.(result);
    return () => {
      if (window.__WHA_DESK_LAB__ === result) delete window.__WHA_DESK_LAB__;
    };
  }, [onQaChange, scene, spellpadAcquired, subject]);

  return null;
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 10000) / 10000 : null;
}
