import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import {
  emphasizeUniformScaleHandle,
  installTransformAxisLatch,
} from '../mechanics/transformControlInteraction.js';
import {
  PromotedElementColumnEffect,
  PromotedWaterColumnEffect,
} from './WaterColumnEffects.jsx';
import { WATER_COLUMN_RUNTIME_SETTINGS } from './waterColumnConfig.js';
import { normalizeInputSensitivity } from '../inputSettings.js';
import {
  PromotedElementDispersionEffect,
  PromotedWaterDispersionEffect,
} from './WaterDispersionEffects.jsx';
import {
  animateOrbVisual as animateLevitationOrbVisual,
  createOrbGeometry as createLevitationOrbGeometry,
  createOrbMaterial as createLevitationOrbMaterial,
} from './LevitationEffects.jsx';
import { MainWorldPhysicsController } from '../world-physics/MainWorldPhysicsController.jsx';
import HeldItemRig from './HeldItemRig.jsx';
import { MAIN_WORLD_FRAME_PRIORITY } from './framePriorities.js';
import {
  placedSpellIdForSceneObject,
  sceneAssetForSceneObject,
} from './wrenchPicking.js';
import {
  CharacterModel,
  neutralPose,
  walkTargets,
  airTargets,
  crouchTargets,
  landTargets,
  idleTargets,
  dampPose,
  applyPose,
} from '../character/CharacterRig.jsx';
import { glyphRenderPolicy } from '../../../src/glyphs/lore-glyphs.js';
import { resolveNativeSignLayout } from '../../../src/glyphs/native-sign-layout.js';
import ThreeLoreGlyph from '../glyphs/ThreeLoreGlyph.jsx';
import {
  AtelierMechanicsDesk,
  AtelierWritingDesk,
} from './AtelierDesks.jsx';
import { materialProfile } from '../../../src/mechanics-engine/index.js';
import {
  ATELIER_ENTRANCE_STEPS,
  ATELIER_PLAYTHROUGH,
  ATELIER_ROOF_LAYOUT,
  MAIN_WORLD_TERRAIN_SEGMENTS,
  MAIN_WORLD_TERRAIN_SIZE,
  mainWorldPropCenterOffset,
  mainWorldPropDimensions,
  terrainHeightAt,
} from '../world-physics/force-contract.js';
import { LIGHT_MAGIC } from '../visual/lightMagic.js';
import { YardDetails, YardGroundCover } from './YardGroundCover.jsx';
import {
  NORMALIZED_PLACED_SPELL_NOTE_SIDE,
  NORMALIZED_SPELL_CIRCLE_RADIUS,
  placedSpellDispersionClearanceRadius,
} from '../../../src/simulation-engine/index.js';
import {
  DEFAULT_PLACED_SPELL_SCALE,
  MIN_PLACED_SPELL_SCALE,
} from '../store.js';

const DEFAULT_FRAME = {
  origin: { x: 0, y: 0, z: 0 },
  normal: { x: 0, y: 1, z: 0 },
  tangent: { x: 1, y: 0, z: 0 },
  bitangent: { x: 0, y: 0, z: 1 },
};

const PLAYER_HEIGHT = 1.575;
// First-person eye height must clear the 1.22 m atelier desktops so the
// tabletop objects the player is asked to inspect are actually visible.
const PLAYER_HEAD_HEIGHT = 1.44;
// Walk speed trimmed ~14% (was 3.15) so displacement per stride cycle matches
// the widened visual stride below and the feet stop sliding.
const PLAYER_SPEED = 2.7;
// Main-world-only stride tuning: widen leg reach and slow cadence slightly so
// per-cycle displacement (speed * cycle time) equals the foot arc coverage.
// The shared rig keeps the default stride of 1 outside this world.
const PLAYER_WALK_STRIDE = 1.3;
const PLAYER_WALK_CADENCE = 0.95;
// The rig is authored ~1.93 m tall; the avatar renders at
// PLAYER_HEIGHT, so animation math converts world speeds into rig-local units.
const PLAYER_RIG_SCALE = PLAYER_HEIGHT / 1.93;
// Jump tuning uses gravity 20 and a 5.3 launch velocity at rig scale, with 25%
// more apex height for the main-world player. Because jump height is
// height is proportional to launch velocity squared, the height multiplier is
// applied to velocity through its square root.
const PLAYER_JUMP_GRAVITY = 20;
const PLAYER_JUMP_HEIGHT_MULTIPLIER = 1.25;
const PLAYER_JUMP_VELOCITY = 5.3 * Math.sqrt(
  PLAYER_RIG_SCALE * PLAYER_JUMP_HEIGHT_MULTIPLIER,
);
const PLAYER_AIR_HEIGHT_THRESHOLD = 0.12;
const PLAYER_CROUCH_SECONDS = 0.13;
const PLAYER_LAND_SECONDS = 0.22;
const PLAYER_LOOK_SENSITIVITY = 0.0025;
const PLAYER_PITCH_LIMIT = THREE.MathUtils.degToRad(80);
const THIRD_PERSON_FOV = 52;
const FREE_CAMERA_FOV = 58;
const THIRD_PERSON_DISTANCE = 3.4;
const THIRD_PERSON_SHOULDER_OFFSET = 0.55;
const THIRD_PERSON_LIFT = 0.38;
const THIRD_PERSON_COLLISION_CLEARANCE = 0.18;
const FREE_CAMERA_SPEED = 4.5;
const PLAYER_BOUNDS = { minX: -11.35, maxX: 11.35, minZ: -8.35, maxZ: 8.35 };
// A full-height jump descends about 75 m in roughly three seconds under the
// player's 20 m/s² gravity. This is a spatial kill plane, not a timer.
const PLAYER_RESPAWN_Y = -75;
const PLAYER_START = {
  x: ATELIER_PLAYTHROUGH.spawn.world.x,
  z: ATELIER_PLAYTHROUGH.spawn.world.z,
};
const SUN_KEY_POSITION = [5, 8, 4];
const SKY_DOME_CENTER = [0, -8, 0];
const SKY_DOME_RADIUS = 40;
const SKY_SUN_DIRECTION = projectDirectionOntoSkyDome(
  new THREE.Vector3(...SUN_KEY_POSITION).normalize(),
  new THREE.Vector3(...SKY_DOME_CENTER),
  SKY_DOME_RADIUS,
);

function ThreeScene({
  runtimeResult,
  placedSpells = [],
  sources,
  props,
  sceneLeftovers = [],
  updateSourcePosition,
  updatePropPosition,
  selectedAssetId = null,
  onAssetSelect,
  updateSpellPlacement,
  selectedTool = null,
  heldTool = null,
  selectedPlacedSpellId = null,
  onPrimaryToolAction,
  onSurfacePlacement,
  onPlacedSpellSelect,
  onPlacedSpellContextAction,
  onWrenchContextAction,
  selectedWrenchPlacement = null,
  wrenchTransformMode = 'translate',
  onWrenchTransform,
  onPlacedSpellBlocked,
  environmentMode = 'day',
  weatherMode = 'clear',
  timelinePaused = false,
  cameraMode = 'tp',
  blueprint = null,
  inputEnabled = true,
  cameraInputEnabled = inputEnabled,
  capturedCursorActive = false,
  cameraSensitivity = 1,
  initialPlayerState = null,
  spellpadAcquired = true,
  onAtelierInteract,
  onAtelierPromptChange,
  lifecycleFrameActive = false,
  onLifecycleFrame,
}) {
  const [wrenchDragging, setWrenchDragging] = useState(false);
  const animatedIntentTypes = new Set([
    'water_column',
    'material_column',
    'water_dispersion',
    'material_dispersion',
  ]);
  const requiresContinuousFrames = placedSpells.some((spell) => (
    spell.runtimeResult?.intents?.some((intent, _index, intents) => (
      (intent.active === true && animatedIntentTypes.has(intent.intentType))
        || (intent.active === true
          && intent.intentType === 'force_constraint_debug'
          && intent.registryId === 'sign.levitation'
          && intent.materialKind !== 'wind')
        || (intent.intentType === 'effect_lifecycle'
          && intent.operation === 'stop'
          && (
            animatedIntentTypes.has(intent.sourceIntentType)
            || (intent.sourceIntentType === 'force_constraint_debug'
              && intents.some((source) => (
                source.id === intent.sourceIntentId
                && source.registryId === 'sign.levitation'
                && source.materialKind !== 'wind'
              )))
          ))
    ))
  )) || weatherMode === 'rain' || lifecycleFrameActive;

  return (
    <Canvas
      className="scene-canvas-frame"
      data-testid="scene-canvas-frame"
      aria-label="3D spell sandbox"
      // The canvas remains the single renderer owner across overlays. Modal
      // state disables world input and renders on scene invalidation, while
      // the interactive world retains its continuous movement/effect loop.
      frameloop="demand"
      camera={{ position: [7.4, 5.4, 8.6], fov: 44, near: 0.1, far: 120 }}
      dpr={[1, 1.25]}
      shadows={{ type: THREE.PCFShadowMap }}
      gl={{ antialias: true, preserveDrawingBuffer: false }}
      onCreated={({ gl }) => {
        gl.setClearColor(environmentPalette(environmentMode).clear, 1);
        gl.domElement.classList.add('scene-canvas');
        gl.domElement.dataset.testid = 'scene-canvas';
        gl.domElement.setAttribute('aria-label', '3D spell sandbox');
        gl.domElement.addEventListener('contextmenu', preventCanvasContextMenu);
      }}
    >
      <ContinuousFrameDriver active={requiresContinuousFrames} onFrame={onLifecycleFrame} />
      <SceneToolPointerController
        selectedTool={selectedTool}
        inputEnabled={inputEnabled}
        pointerLookEnabled
        onAssetSelect={onAssetSelect}
        onPrimaryToolAction={onPrimaryToolAction}
        onSurfacePlacement={onSurfacePlacement}
        onPlacedSpellContextAction={onPlacedSpellContextAction}
        onWrenchContextAction={onWrenchContextAction}
      />
      <ThreeSceneContents
        runtimeResult={runtimeResult}
        placedSpells={placedSpells}
        sources={sources}
        props={props}
        sceneLeftovers={sceneLeftovers}
        updateSourcePosition={updateSourcePosition}
        updatePropPosition={updatePropPosition}
        selectedAssetId={selectedAssetId}
        onAssetSelect={onAssetSelect}
        updateSpellPlacement={updateSpellPlacement}
        selectedTool={selectedTool}
        heldTool={heldTool}
        selectedPlacedSpellId={selectedPlacedSpellId}
        onPrimaryToolAction={onPrimaryToolAction}
        onSurfacePlacement={onSurfacePlacement}
        onPlacedSpellSelect={onPlacedSpellSelect}
        onPlacedSpellContextAction={onPlacedSpellContextAction}
        selectedWrenchPlacement={selectedWrenchPlacement}
        wrenchTransformMode={wrenchTransformMode}
        onWrenchTransform={onWrenchTransform}
        onWrenchDragStateChange={setWrenchDragging}
        wrenchDragSelection={wrenchDragging ? selectedWrenchPlacement : null}
        onPlacedSpellBlocked={onPlacedSpellBlocked}
        environmentMode={environmentMode}
        weatherMode={weatherMode}
        timelinePaused={timelinePaused}
        cameraMode={cameraMode}
        inputEnabled={inputEnabled}
        cameraInputEnabled={cameraInputEnabled && !wrenchDragging}
        capturedCursorActive={capturedCursorActive}
        cameraSensitivity={cameraSensitivity}
        blueprint={blueprint}
        initialPlayerState={initialPlayerState}
        spellpadAcquired={spellpadAcquired}
        onAtelierInteract={onAtelierInteract}
        onAtelierPromptChange={onAtelierPromptChange}
      />
    </Canvas>
  );
}

export default memo(ThreeScene);

function ContinuousFrameDriver({ active, onFrame }) {
  useFrame(({ invalidate }) => {
    if (!active) return;
    onFrame?.();
    invalidate();
  });
  return null;
}

function WorldWrenchTransformGizmo({ placement, mode, onCommit, onDragStateChange }) {
  const { camera, gl, scene, invalidate } = useThree();
  const onCommitRef = useRef(onCommit);
  const onDragStateChangeRef = useRef(onDragStateChange);
  onCommitRef.current = onCommit;
  onDragStateChangeRef.current = onDragStateChange;
  useEffect(() => {
    const prefix = placement.kind === 'mechanics-build'
      ? 'placed-mechanics-build:'
      : placement.kind === 'spell'
        ? 'placed-spell:'
        : placement.kind === 'prop'
          ? 'prop:'
          : 'placed-asset:';
    const object = scene.getObjectByName(`${prefix}${placement.id}`);
    if (!object) return undefined;

    const controls = new TransformControls(camera);
    // TransformControls normally forces all Pointer Lock coordinates to the
    // canvas center. Marked events already carry the in-app cursor position,
    // so only those events bypass that built-in centering behavior.
    const getTransformPointer = controls._getPointer;
    controls._getPointer = (event) => {
      if (!event.__whaVirtualPointer) return getTransformPointer(event);
      const rect = gl.domElement.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        y: -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
        button: event.button,
      };
    };
    // Its stock pointer-up path also releases pointer capture that it skipped
    // taking under Pointer Lock. Finish virtual drags through the public API.
    const handleTransformPointerUp = controls._onPointerUp;
    controls._onPointerUp = (event) => {
      if (!event.__whaVirtualPointer) {
        handleTransformPointerUp(event);
        return;
      }
      if (!controls.enabled) return;
      controls.domElement.removeEventListener('pointermove', controls._onPointerMove);
      controls.pointerUp(controls._getPointer(event));
    };
    controls.setMode(['translate', 'rotate', 'scale'].includes(mode) ? mode : 'translate');
    controls.setSpace(mode === 'scale' ? 'local' : 'world');
    controls.setTranslationSnap(0.1);
    controls.setRotationSnap(Math.PI / 24);
    controls.setScaleSnap(0.1);
    controls.setSize(0.78);
    emphasizeUniformScaleHandle(controls);
    controls.attach(object);
    const helper = controls.getHelper();
    helper.name = `wrench-transform-controls:${placement.kind}:${placement.id}`;
    scene.add(helper);

    const syncFeedback = () => {
      gl.domElement.dataset.wrenchTransformAxis = controls.axis ?? '';
      gl.domElement.dataset.wrenchTransformDragging = String(controls.dragging);
      gl.domElement.dataset.wrenchTransformOperation = controls.mode;
      gl.domElement.dataset.wrenchUniformScaleHandle = controls.mode === 'scale' ? 'XYZ' : '';
      gl.domElement.style.cursor = controls.dragging ? 'grabbing' : controls.axis ? 'grab' : '';
      invalidate();
    };
    const handleDragging = (event) => {
      onDragStateChangeRef.current?.(Boolean(event.value));
      syncFeedback();
    };
    const handleMouseUp = () => {
      onCommitRef.current?.({
        position: { x: object.position.x, y: object.position.y, z: object.position.z },
        rotation: {
          x: object.quaternion.x,
          y: object.quaternion.y,
          z: object.quaternion.z,
          w: object.quaternion.w,
        },
        scale: { x: object.scale.x, y: object.scale.y, z: object.scale.z },
      });
    };
    const removeAxisLatch = installTransformAxisLatch(controls, (axis) => {
      gl.domElement.dataset.wrenchTransformLatchedAxis = axis ?? '';
    });

    controls.addEventListener('change', syncFeedback);
    controls.addEventListener('dragging-changed', handleDragging);
    controls.addEventListener('mouseUp', handleMouseUp);
    controls.connect(gl.domElement);
    syncFeedback();
    return () => {
      if (controls.dragging) onDragStateChangeRef.current?.(false);
      removeAxisLatch();
      controls.removeEventListener('change', syncFeedback);
      controls.removeEventListener('dragging-changed', handleDragging);
      controls.removeEventListener('mouseUp', handleMouseUp);
      controls.detach();
      scene.remove(helper);
      controls.dispose();
      delete gl.domElement.dataset.wrenchTransformAxis;
      delete gl.domElement.dataset.wrenchTransformDragging;
      delete gl.domElement.dataset.wrenchTransformOperation;
      delete gl.domElement.dataset.wrenchTransformLatchedAxis;
      delete gl.domElement.dataset.wrenchUniformScaleHandle;
      gl.domElement.style.cursor = '';
      invalidate();
    };
  }, [camera, gl, invalidate, mode, placement.id, placement.kind, scene]);
  return null;
}

function ThreeSceneContents({
  runtimeResult,
  placedSpells,
  sources,
  props,
  selectedAssetId,
  onAssetSelect,
  selectedTool,
  heldTool = null,
  selectedPlacedSpellId,
  onPrimaryToolAction,
  onSurfacePlacement,
  onPlacedSpellSelect,
  onPlacedSpellContextAction,
  selectedWrenchPlacement,
  wrenchTransformMode,
  onWrenchTransform,
  onWrenchDragStateChange,
  wrenchDragSelection,
  onPlacedSpellBlocked,
  environmentMode,
  weatherMode,
  timelinePaused,
  cameraMode,
  inputEnabled,
  cameraInputEnabled,
  capturedCursorActive,
  cameraSensitivity,
  blueprint,
  initialPlayerState,
  spellpadAcquired,
  onAtelierInteract,
  onAtelierPromptChange,
}) {
  const playerControllerRef = useRef(null);
  const pendingPlayerTeleportRef = useRef(null);
  const blockedEarthVisualSpellIdsRef = useRef(new Set());
  const palette = useMemo(() => environmentPalette(environmentMode), [environmentMode]);
  const handleEarthBlocked = useCallback((placedSpellId, signal) => {
    blockedEarthVisualSpellIdsRef.current.add(placedSpellId);
    onPlacedSpellBlocked?.(placedSpellId, signal);
  }, [onPlacedSpellBlocked]);

  useEffect(() => {
    for (const spell of placedSpells) {
      if (spell.runtimeResult?.lifecycle?.active === true) {
        blockedEarthVisualSpellIdsRef.current.delete(spell.id);
      }
    }
  }, [placedSpells]);

  return (
    <>
      <color attach="background" args={[palette.clear]} />
      <fog attach="fog" args={[palette.fog, 14, weatherMode === 'rain' ? 36 : 48]} />
      <ambientLight name="sky-ambient-light" intensity={palette.ambient} color={palette.ambientColor} />
      <directionalLight
        name="sun-key-light"
        position={SUN_KEY_POSITION}
        intensity={weatherMode === 'rain' ? palette.sun * 0.68 : palette.sun}
        color={palette.sunColor}
        castShadow
      />
      <MainWorldPhysicsController
        props={props}
        sources={sources}
        placedSpells={placedSpells}
        onEarthBlocked={handleEarthBlocked}
        blueprint={blueprint}
        initialPlayerState={initialPlayerState}
        playerControllerRef={playerControllerRef}
        pendingPlayerTeleportRef={pendingPlayerTeleportRef}
        wrenchDragSelection={wrenchDragSelection}
      />
      {selectedTool === 'wrench' && selectedWrenchPlacement ? (
        <WorldWrenchTransformGizmo
          placement={selectedWrenchPlacement}
          mode={wrenchTransformMode}
          onCommit={onWrenchTransform}
          onDragStateChange={onWrenchDragStateChange}
        />
      ) : null}
      <PracticeWorld
        palette={palette}
        weatherMode={weatherMode}
        placedSpells={placedSpells}
        sources={sources}
        props={props}
        selectedTool={selectedTool}
        onPrimaryToolAction={onPrimaryToolAction}
        onSurfacePlacement={onSurfacePlacement}
        spellpadAcquired={spellpadAcquired}
        onAtelierInteract={onAtelierInteract}
      />
      <AtelierDeskInteractionSensor
        spellpadAcquired={spellpadAcquired}
        onPromptChange={onAtelierPromptChange}
        onInteract={onAtelierInteract}
        inputEnabled={inputEnabled}
      />
      <PlayerCharacter
        cameraMode={cameraMode}
        inputEnabled={cameraInputEnabled}
        capturedCursorActive={capturedCursorActive}
        cameraSensitivity={cameraSensitivity}
        initialPlayerState={initialPlayerState}
        playerControllerRef={playerControllerRef}
        pendingPlayerTeleportRef={pendingPlayerTeleportRef}
      />
      <HeldItemRig
        selectedTool={heldTool ?? selectedTool}
        fpsCameraEnabled={cameraMode === 'fp'}
        inputEnabled={inputEnabled}
      />
      <DynamicScene
        runtimeResult={runtimeResult}
        placedSpells={placedSpells}
        sources={sources}
        props={props}
        selectedAssetId={selectedAssetId}
        onAssetSelect={onAssetSelect}
        selectedTool={selectedTool}
        selectedPlacedSpellId={selectedPlacedSpellId}
        onPrimaryToolAction={onPrimaryToolAction}
        onSurfacePlacement={onSurfacePlacement}
        onPlacedSpellSelect={onPlacedSpellSelect}
        onPlacedSpellContextAction={onPlacedSpellContextAction}
        timelinePaused={timelinePaused}
        weatherMode={weatherMode}
        blockedEarthVisualSpellIds={blockedEarthVisualSpellIdsRef.current}
        blueprint={blueprint}
      />
      <SceneDebug
        runtimeResult={runtimeResult}
        placedSpells={placedSpells}
        sources={sources}
        props={props}
        environmentMode={environmentMode}
        weatherMode={weatherMode}
        timelinePaused={timelinePaused}
      />
    </>
  );
}

function SceneToolPointerController({
  selectedTool,
  inputEnabled = true,
  pointerLookEnabled = false,
  onAssetSelect,
  onPrimaryToolAction,
  onSurfacePlacement,
  onPlacedSpellContextAction,
  onWrenchContextAction,
}) {
  const { camera, gl, scene } = useThree();
  const gestureRef = useRef({ button: -1, x: 0, y: 0, distance: 0 });
  const suppressLockedContextMenuRef = useRef(false);
  const inputEnabledRef = useRef(inputEnabled);
  const selectedToolRef = useRef(selectedTool);
  inputEnabledRef.current = inputEnabled;
  selectedToolRef.current = selectedTool;

  useEffect(() => {
    const canvas = gl.domElement;
    const pointerForEvent = (event) => {
      const rect = canvas.getBoundingClientRect();
      const locked = pointerLookEnabled
        && document.pointerLockElement === canvas
        && !event.__whaVirtualPointer;
      const clientX = locked || !Number.isFinite(event.clientX)
        ? rect.left + rect.width / 2
        : event.clientX;
      const clientY = locked || !Number.isFinite(event.clientY)
        ? rect.top + rect.height / 2
        : event.clientY;
      return new THREE.Vector2(
        ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
      );
    };
    const handleSecondaryToolAction = (event) => {
      if (!inputEnabledRef.current) return;
      const gesture = gestureRef.current;
      if (event.type === 'contextmenu' && gesture.distance > 5) return;
      const pointer = pointerForEvent(event);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      window.__WHA_CONTEXT_PICK_DEBUG__ = {
        selectedTool: selectedToolRef.current,
        inputEventType: event.type,
        pointerLocked: document.pointerLockElement === canvas,
        forwarded: Boolean(event.__whaVirtualPointer),
        hitCount: hits.length,
        surfaceId: hits.map((hit) => surfaceMetadataForObject(hit.object)?.id).find(Boolean) ?? null,
        hits: hits.slice(0, 24).map((hit) => ({
          name: hit.object.name,
          placedSpellId: placedSpellIdForObject(hit.object),
          distance: round(hit.distance),
        })),
      };
      if (selectedToolRef.current === 'manager' || selectedToolRef.current === 'wrench') {
        if (selectedToolRef.current === 'wrench') return;
        const placedSpellId = hits
          .map((hit) => placedSpellIdForObject(hit.object))
          .find(Boolean);
        if (placedSpellId) {
          onPlacedSpellContextAction?.(placedSpellId);
          return;
        }
        return;
      }
      if (!['spellpad', 'asset-manager', 'mechanics-library'].includes(selectedToolRef.current)) return;
      const hit = hits.find((candidate) => surfaceMetadataForObject(candidate.object));
      if (!hit) return;
      const surface = surfaceMetadataForObject(hit.object);
      const normal = (hit.face?.normal?.clone() ?? new THREE.Vector3(0, 1, 0))
        .transformDirection(hit.object.matrixWorld)
        .normalize();
      const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      let tangent = cameraRight.sub(normal.clone().multiplyScalar(cameraRight.dot(normal)));
      if (tangent.lengthSq() <= 0.000001) {
        const fallback = Math.abs(normal.y) > 0.9
          ? new THREE.Vector3(1, 0, 0)
          : new THREE.Vector3(0, 1, 0);
        tangent = fallback.sub(normal.clone().multiplyScalar(fallback.dot(normal)));
      }
      tangent.normalize();
      onSurfacePlacement?.({
        point: vectorDebug(hit.point),
        normal: vectorDebug(normal),
        tangent: vectorDebug(tangent),
        surfaceId: surface.id,
        surfaceKind: surface.kind ?? 'world',
        surfaceTargetId: surface.targetId ?? null,
        mountBodyId: surface.mountBodyId ?? null,
        mechanicsBuildId: surface.mechanicsBuildId ?? null,
        spellDeviceId: surface.spellDeviceId ?? null,
        surfaceLabel: surface.label ?? surface.id,
      });
    };
    const handlePointerDown = (event) => {
      gestureRef.current = {
        button: event.button,
        x: event.clientX,
        y: event.clientY,
        distance: 0,
      };
      const lockedWorldPointer = pointerLookEnabled
        && document.pointerLockElement === canvas
        && !event.__whaVirtualPointer;
      if (event.button === 2 && lockedWorldPointer) {
        suppressLockedContextMenuRef.current = true;
        handleSecondaryToolAction(event);
      }
    };
    const handlePointerMove = (event) => {
      if (pointerLookEnabled && document.pointerLockElement === canvas && !event.__whaVirtualPointer) return;
      const gesture = gestureRef.current;
      gesture.distance = Math.max(
        gesture.distance,
        Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y),
      );
    };
    const handlePointerUp = (event) => {
      if (!inputEnabledRef.current || event.button !== 0) return;
      const gesture = gestureRef.current;
      if (gesture.button !== 0 || gesture.distance > 5) return;
      const tool = selectedToolRef.current;
      if (!['spellpad', 'manager', 'asset-manager', 'mechanics-library', 'weather-manager'].includes(tool)) return;

      const pointer = pointerForEvent(event);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      const asset = hits.map((hit) => sceneAssetForObject(hit.object)).find(Boolean);
      const gameplayHit = hits.some((hit) => (
        Boolean(sceneAssetForObject(hit.object) || surfaceMetadataForObject(hit.object))
      ));
      if (tool === 'asset-manager' && asset?.id) onAssetSelect?.(asset.id);
      onPrimaryToolAction?.();
      window.__WHA_PRIMARY_PICK_DEBUG__ = {
        ...(window.__WHA_PRIMARY_PICK_DEBUG__ ?? {}),
        count: Number(window.__WHA_PRIMARY_PICK_DEBUG__?.count ?? 0) + 1,
        tool,
        hitCount: hits.length,
        gameplayHit,
        assetId: asset?.id ?? null,
      };
    };
    const handleContextMenu = (event) => {
      event.preventDefault();
      const matchingLockedContextMenu = suppressLockedContextMenuRef.current
        && event.button === 2
        && pointerLookEnabled
        && document.pointerLockElement === canvas
        && !event.__whaVirtualPointer;
      suppressLockedContextMenuRef.current = false;
      if (matchingLockedContextMenu) return;
      handleSecondaryToolAction(event);
    };
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('contextmenu', handleContextMenu);
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [camera, gl, onAssetSelect, onPlacedSpellContextAction, onPrimaryToolAction, onSurfacePlacement, onWrenchContextAction, pointerLookEnabled, scene]);

  return null;
}

function placedSpellIdForObject(object) {
  return placedSpellIdForSceneObject(object);
}

function surfaceMetadataForObject(object) {
  let current = object;
  while (current) {
    if (current.userData?.spellSurface) return current.userData.spellSurface;
    current = current.parent;
  }
  return null;
}

function sceneAssetForObject(object) {
  return sceneAssetForSceneObject(object);
}

function SpriteLabel({ name, text, position, color = '#1b332c' }) {
  const texture = useMemo(() => makeLabelTexture(text, color), [color, text]);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <sprite name={name} position={position} scale={[0.72, 0.18, 1]}>
      <spriteMaterial map={texture} transparent depthWrite={false} />
    </sprite>
  );
}

function makeLabelTexture(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(255, 253, 247, 0.82)';
  roundRect(context, 18, 18, canvas.width - 36, canvas.height - 36, 18);
  context.fill();
  context.strokeStyle = 'rgba(78, 97, 70, 0.22)';
  context.stroke();
  context.fillStyle = color;
  context.font = '700 42px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(String(text ?? '').slice(0, 24), canvas.width / 2, canvas.height / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function preventCanvasContextMenu(event) {
  event.preventDefault();
}

function placementFromSurfaceEvent(event, surface) {
  const point = event.point.clone();
  const localNormal = event.face?.normal?.clone() ?? new THREE.Vector3(0, 1, 0);
  const normal = localNormal.transformDirection(event.object.matrixWorld).normalize();
  const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(event.camera.quaternion);
  let tangent = cameraRight.sub(normal.clone().multiplyScalar(cameraRight.dot(normal)));
  if (tangent.lengthSq() <= 0.000001) {
    const fallback = Math.abs(normal.y) > 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
    tangent = fallback.sub(normal.clone().multiplyScalar(fallback.dot(normal)));
  }
  tangent.normalize();
  return {
    point: vectorDebug(point),
    normal: vectorDebug(normal),
    tangent: vectorDebug(tangent),
    surfaceId: surface.id,
    surfaceKind: surface.kind ?? 'world',
    surfaceTargetId: surface.targetId ?? null,
    mountBodyId: surface.mountBodyId ?? null,
    surfaceLabel: surface.label ?? surface.id,
  };
}

function surfaceInteractionProps({
  surface,
}) {
  return {
    userData: {
      spellSurface: surface,
      sceneAsset: { type: 'prop', id: surface.targetId },
    },
  };
}

function PracticeWorld({
  palette,
  weatherMode,
  placedSpells,
  sources,
  props,
  selectedTool,
  onPrimaryToolAction,
  onSurfacePlacement,
  spellpadAcquired,
  onAtelierInteract,
}) {
  const groundGeometry = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(
      MAIN_WORLD_TERRAIN_SIZE.x,
      MAIN_WORLD_TERRAIN_SIZE.z,
      MAIN_WORLD_TERRAIN_SEGMENTS,
      MAIN_WORLD_TERRAIN_SEGMENTS,
    );
    geometry.rotateX(-Math.PI / 2);
    const position = geometry.attributes.position;
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const z = position.getZ(index);
      position.setY(index, terrainHeightAt(x, z));
    }
    const colors = new Float32Array(position.count * 3);
    const low = new THREE.Color('#5f8247');
    const high = new THREE.Color('#789758');
    const color = new THREE.Color();
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const z = position.getZ(index);
      const variation = (Math.sin(x * 1.17 + z * 0.83) + Math.cos(x * 0.51 - z * 1.39) + 2) / 4;
      color.copy(low).lerp(high, variation * 0.72);
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return geometry;
  }, []);

  return (
    <group name="three-practice-world">
      <SkyDome palette={palette} weatherMode={weatherMode} />
      <mesh
        name="practice-field-terrain"
        geometry={groundGeometry}
        receiveShadow
        {...surfaceInteractionProps({
          surface: {
            id: 'practice-field-terrain',
            label: 'Practice field',
            mountBodyId: 'practice-field-terrain',
          },
          selectedTool,
          onPrimaryToolAction,
          onSurfacePlacement,
        })}
      >
        <meshStandardMaterial color="#ffffff" vertexColors roughness={0.97} />
      </mesh>
      <YardGroundCover placedSpells={placedSpells} props={props} sources={sources} />
      <YardDetails />
      <mesh name="world-horizon-band" rotation={[Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <torusGeometry args={[17, 0.04, 8, 128]} />
        <meshStandardMaterial color="#759c7f" roughness={0.9} />
      </mesh>
      <StaticProps
        selectedTool={selectedTool}
        onPrimaryToolAction={onPrimaryToolAction}
        onSurfacePlacement={onSurfacePlacement}
      />
      <Atelier
        position={[
          ATELIER_PLAYTHROUGH.position.x,
          ATELIER_PLAYTHROUGH.position.y,
          ATELIER_PLAYTHROUGH.position.z,
        ]}
        rotationY={ATELIER_PLAYTHROUGH.rotationY}
        spellpadAcquired={spellpadAcquired}
        onAtelierInteract={onAtelierInteract}
      />
    </group>
  );
}

function SkyDome({ palette, weatherMode }) {
  return (
    <group name="world-sun-marker">
      <mesh name="world-sky-dome" position={[0, -8, 0]}>
        <sphereGeometry args={[SKY_DOME_RADIUS, 48, 24]} />
        <shaderMaterial
          side={THREE.BackSide}
          depthWrite={false}
          toneMapped={false}
          uniforms={{
            skyColor: { value: new THREE.Color(palette.sky) },
            sunColor: { value: new THREE.Color(palette.sunColor) },
            sunVisibility: { value: weatherMode === 'rain' ? 0.48 : 1 },
            sunDirection: { value: SKY_SUN_DIRECTION },
          }}
          vertexShader={SKY_DOME_VERTEX_SHADER}
          fragmentShader={SKY_DOME_FRAGMENT_SHADER}
        />
      </mesh>
    </group>
  );
}

const SKY_DOME_VERTEX_SHADER = `
  varying vec3 skyDirection;

  void main() {
    skyDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_DOME_FRAGMENT_SHADER = `
  uniform vec3 skyColor;
  uniform vec3 sunColor;
  uniform float sunVisibility;
  uniform vec3 sunDirection;
  varying vec3 skyDirection;

  void main() {
    float alignment = dot(normalize(skyDirection), sunDirection);
    float halo = smoothstep(0.970, 0.994, alignment);
    float disc = smoothstep(0.994, 0.997, alignment);
    float sunPaint = (halo * 0.28 + disc * 0.72) * sunVisibility;
    gl_FragColor = vec4(mix(skyColor, sunColor, sunPaint), 1.0);
    #include <colorspace_fragment>
  }
`;

function projectDirectionOntoSkyDome(worldDirection, domeCenter, radius) {
  // Intersect the directional-light ray from the world origin with the
  // lowered sky sphere, then return the hit in dome-local coordinates.
  const offset = domeCenter.clone().multiplyScalar(-1);
  const b = -2 * worldDirection.dot(domeCenter);
  const c = offset.lengthSq() - radius ** 2;
  const distance = (-b + Math.sqrt(b ** 2 - 4 * c)) / 2;
  return worldDirection
    .clone()
    .multiplyScalar(distance)
    .sub(domeCenter)
    .normalize();
}

// Canopy lobes shared by the solid base mass and the instanced leaf shell, as
// [x, y, z, radius]. Keeping them module-level gives LeafCanopy a stable
// reference so the (fairly heavy) instance layout is only computed once.
const TREE_PRIMARY_LOBES = [
  [0, 2.32, 0, 0.8],
  [-0.45, 1.98, 0.12, 0.6],
  [0.43, 1.95, -0.08, 0.6],
];
const TREE_CLUMP_LOBES = [
  [0, 2.58, 0.06, 0.46],
  [-0.5, 2.36, 0.3, 0.34],
  [0.55, 2.32, -0.26, 0.36],
  [-0.22, 2.72, -0.34, 0.3],
  [0.3, 2.64, 0.4, 0.3],
  [-0.62, 2.02, -0.2, 0.27],
  [0.62, 2.64, 0.16, 0.28],
];
const TREE_LEAF_LOBES = [...TREE_PRIMARY_LOBES, ...TREE_CLUMP_LOBES];
const CANOPY_LEAF_TONES = ['#3f7d4a', '#4c8a54', '#5b9a5c', '#356b3f', '#6aa85a', '#2f5f39'];

// A single flat leaf card: a pointed oval in the XY plane with its face normal
// on +Z, pivoted near the stem so it fans out naturally when oriented outward.
function makeLeafGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.5, 0.28, 0.46, 0.92, 0, 1.12);
  shape.bezierCurveTo(-0.46, 0.92, -0.5, 0.28, 0, 0);
  const geometry = new THREE.ShapeGeometry(shape, 5);
  geometry.translate(0, -0.5, 0);
  return geometry;
}

// Scatter leaf cards across the surface of each canopy lobe, oriented outward
// with random spin/tilt and a randomized green tone. Deterministic so the tree
// looks identical every render.
function computeLeafInstances(lobes) {
  const up = new THREE.Vector3(0, 0, 1);
  let seed = 20240611;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const instances = [];
  for (const [cx, cy, cz, radius] of lobes) {
    const count = Math.max(28, Math.round(radius * radius * 260));
    for (let i = 0; i < count; i += 1) {
      const theta = Math.acos(1 - 2 * rnd());
      const phi = 2 * Math.PI * rnd();
      const dir = new THREE.Vector3(
        Math.sin(theta) * Math.cos(phi),
        Math.cos(theta),
        Math.sin(theta) * Math.sin(phi),
      );
      const r = radius * (0.82 + rnd() * 0.26);
      const position = new THREE.Vector3(cx, cy, cz).addScaledVector(dir, r);
      const quaternion = new THREE.Quaternion().setFromUnitVectors(up, dir);
      quaternion.multiply(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rnd() * Math.PI * 2),
      );
      const tiltAxis = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
      quaternion.premultiply(
        new THREE.Quaternion().setFromAxisAngle(tiltAxis, (rnd() - 0.5) * 0.95),
      );
      instances.push({
        position,
        quaternion,
        scale: 0.17 * (0.62 + rnd() * 0.85),
        color: CANOPY_LEAF_TONES[Math.floor(rnd() * CANOPY_LEAF_TONES.length)],
      });
    }
  }
  return instances;
}

function LeafCanopy({ lobes }) {
  const geometry = useMemo(() => makeLeafGeometry(), []);
  const instances = useMemo(() => computeLeafInstances(lobes), [lobes]);
  const meshRef = useRef(null);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    instances.forEach((instance, index) => {
      dummy.position.copy(instance.position);
      dummy.quaternion.copy(instance.quaternion);
      dummy.scale.setScalar(instance.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      mesh.setColorAt(index, color.set(instance.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [instances]);

  return (
    <instancedMesh
      ref={meshRef}
      name="world-tree-leaves"
      args={[geometry, undefined, instances.length]}
      castShadow
      frustumCulled={false}
    >
      <meshStandardMaterial side={THREE.DoubleSide} roughness={0.82} metalness={0} flatShading />
    </instancedMesh>
  );
}

function Tree({ position }) {
  // Witch Hat Atelier storybook oak: a warm gnarled trunk with flared roots,
  // a pair of reaching boughs, and a leafy canopy — a darker solid base mass
  // wrapped in a shell of individual leaf cards. The canonical
  // trunk/canopy-0..2 names are preserved for picking and tests.
  const barkColor = '#6a4a30';
  const barkShade = '#553a24';
  const canopyBaseTones = ['#2c5836', '#244a2d', '#315f3a'];

  const roots = Array.from({ length: 5 }, (_, i) => {
    const angle = (Math.PI * 2 * i) / 5 + 0.4;
    return { x: Math.cos(angle) * 0.24, z: Math.sin(angle) * 0.24, angle };
  });

  // Fallen leaves scattered on the ground around the trunk. Distributed with
  // the golden angle so the litter reads as natural rather than gridded, with
  // a few autumnal tones mixed into the greens.
  const leafTones = ['#4c8a54', '#6aa85a', '#caa23f', '#c87b35', '#3f7d4a'];
  const fallenLeaves = Array.from({ length: 18 }, (_, i) => {
    const angle = i * 2.39996323;
    const radius = 0.6 + (i % 5) * 0.34;
    return {
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      rot: angle * 1.7,
      tilt: ((i % 3) - 1) * 0.12,
      tone: leafTones[i % leafTones.length],
      scale: 0.82 + (i % 4) * 0.16,
    };
  });

  return (
    <group name="world-tree" position={position}>
      {/* Flared roots gripping the soil */}
      {roots.map((root, index) => (
        <mesh
          key={`root-${index}`}
          name={`world-tree-root-${index}`}
          position={[root.x, 0.12, root.z]}
          rotation={[0, -root.angle, 0.5]}
          castShadow
        >
          <cylinderGeometry args={[0.05, 0.15, 0.5, 6]} />
          <meshStandardMaterial color={barkShade} roughness={0.96} flatShading />
        </mesh>
      ))}

      {/* Trunk */}
      <mesh name="world-tree-trunk" position={[0, 1.05, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.3, 2.1, 9]} />
        <meshStandardMaterial color={barkColor} roughness={0.95} flatShading />
      </mesh>

      {/* Boughs reaching up into the canopy */}
      <mesh name="world-tree-bough-0" position={[-0.34, 1.95, 0.1]} rotation={[0, 0, 0.7]} castShadow>
        <cylinderGeometry args={[0.05, 0.1, 0.95, 6]} />
        <meshStandardMaterial color={barkColor} roughness={0.95} flatShading />
      </mesh>
      <mesh name="world-tree-bough-1" position={[0.32, 1.9, -0.08]} rotation={[0, 0, -0.75]} castShadow>
        <cylinderGeometry args={[0.05, 0.1, 0.9, 6]} />
        <meshStandardMaterial color={barkColor} roughness={0.95} flatShading />
      </mesh>

      {/* Darker solid canopy mass so gaps between leaves read as shaded
          interior foliage rather than sky. Primary lobes keep canonical names. */}
      {TREE_PRIMARY_LOBES.map(([x, y, z, radius], index) => (
        <mesh key={index} name={`world-tree-canopy-${index}`} position={[x, y, z]} castShadow>
          <icosahedronGeometry args={[radius * 0.9, 1]} />
          <meshStandardMaterial color={canopyBaseTones[index % canopyBaseTones.length]} roughness={0.95} flatShading />
        </mesh>
      ))}
      {TREE_CLUMP_LOBES.map(([x, y, z, radius], index) => (
        <mesh key={`clump-${index}`} name={`world-tree-foliage-${index}`} position={[x, y, z]} castShadow>
          <icosahedronGeometry args={[radius * 0.9, 1]} />
          <meshStandardMaterial color={canopyBaseTones[index % canopyBaseTones.length]} roughness={0.95} flatShading />
        </mesh>
      ))}

      {/* Leaf shell: hundreds of individual leaf cards over the canopy mass */}
      <LeafCanopy lobes={TREE_LEAF_LOBES} />

      {/* Fallen leaves resting on the ground around the trunk */}
      {fallenLeaves.map((leaf, index) => (
        <mesh
          key={`leaf-${index}`}
          name={`world-tree-leaf-${index}`}
          position={[leaf.x, 0.02, leaf.z]}
          rotation={[leaf.tilt, leaf.rot, 0]}
          scale={[0.12 * leaf.scale, 0.022, 0.075 * leaf.scale]}
          castShadow
        >
          <octahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={leaf.tone} roughness={0.85} flatShading />
        </mesh>
      ))}
    </group>
  );
}

function StaticProps({ selectedTool, onPrimaryToolAction, onSurfacePlacement }) {
  return (
    <group name="world-static-props">
      {[
        [3.0, 0.16, -2.6, 0.32],
        [3.5, 0.12, -2.15, 0.36],
        [-3.3, 0.14, 2.6, 0.4],
      ].map(([x, y, z, size], index) => (
        <mesh
          key={index}
          name={`field-stone-${index}`}
          position={[x, y, z]}
          rotation={[0.25, index, 0.15]}
          {...surfaceInteractionProps({
            surface: {
              id: `field-stone-${index}`,
              label: `Field stone ${index + 1}`,
              mountBodyId: `field-stone-${index}`,
            },
            selectedTool,
            onPrimaryToolAction,
            onSurfacePlacement,
          })}
        >
          <dodecahedronGeometry args={[size, 0]} />
          <meshStandardMaterial color="#6b7366" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// The Atelier — a storybook witch's workshop in the Witch Hat Atelier key:
// limewashed plaster over a hand-hewn timber frame on a mossy fieldstone
// footing, a steep wood-shingle roof with a rounded clay chimney, and an arched
// door left standing open onto the practice clearing. Built in local space with
// the door facing +Z, then placed and turned to face the field.
// ---------------------------------------------------------------------------

const ATELIER = {
  plaster: '#e4d8bc',
  plasterShade: '#d3c29a',
  beam: '#3b2a1b',
  beamWarm: '#4c3826',
  stone: '#8c897b',
  stoneDark: '#6f6c5f',
  moss: '#5d7350',
  shingle: '#6b4429',
  clay: '#a8503a',
  terracotta: '#c0653f',
  copper: '#b3793f',
  patina: '#4f8c84',
  glass: '#acc4d6',
  parchment: '#e7dcc0',
  ink: '#24293c',
  forest: '#2f5f39',
  teal: '#3c7a72',
  dustyBlue: '#6f87a6',
  wood: '#6b4a2e',
  woodLight: '#835b36',
};

function Beam({ args, position, rotation, color = ATELIER.beam }) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial color={color} roughness={0.9} flatShading />
    </mesh>
  );
}

function Plaster({ args, position, rotation }) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial color={ATELIER.plaster} roughness={0.95} />
    </mesh>
  );
}

function Jar({ position, color = ATELIER.teal, h = 0.17, r = 0.06 }) {
  return (
    <group position={position}>
      <mesh position={[0, -h * 0.04, 0]} castShadow>
        <cylinderGeometry args={[r * 0.82, r, h * 0.82, 20]} />
        <meshPhysicalMaterial
          color="#c8d8d2"
          roughness={0.16}
          transmission={0.35}
          thickness={0.08}
          transparent
          opacity={0.58}
        />
      </mesh>
      <mesh position={[0, -h * 0.09, 0]}>
        <cylinderGeometry args={[r * 0.73, r * 0.88, h * 0.58, 18]} />
        <meshStandardMaterial color={color} roughness={0.3} transparent opacity={0.84} />
      </mesh>
      <mesh position={[0, h * 0.42, 0]} castShadow>
        <cylinderGeometry args={[r * 0.5, r * 0.7, h * 0.22, 18]} />
        <meshPhysicalMaterial color="#d7e2de" roughness={0.18} transparent opacity={0.62} />
      </mesh>
      <mesh position={[0, h / 2 + 0.02, 0]}>
        <cylinderGeometry args={[r * 0.52, r * 0.58, 0.055, 14]} />
        <meshStandardMaterial color="#7a5a3a" roughness={0.85} />
      </mesh>
      <mesh position={[0, -h * 0.02, r * 0.94]}>
        <boxGeometry args={[r * 0.9, h * 0.32, 0.004]} />
        <meshStandardMaterial color="#d8c69e" roughness={0.94} />
      </mesh>
    </group>
  );
}

function Book({ position, rotation, color, w = 0.2, h = 0.24, d = 0.06 }) {
  return (
    <mesh position={position} rotation={rotation} castShadow>
      <boxGeometry args={[w, h, d]} />
      <meshStandardMaterial color={color} roughness={0.72} />
    </mesh>
  );
}

function Scroll({ position, rotation, len = 0.28, r = 0.034, color = ATELIER.parchment }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[r, r, len, 12]} />
        <meshStandardMaterial color={color} roughness={0.88} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[r * 1.08, 0.012, 6, 16]} />
        <meshStandardMaterial color="#9b7b46" roughness={0.7} />
      </mesh>
    </group>
  );
}

function LeadedWindow({ position, rotation, w = 0.82, h = 0.78 }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh>
        <boxGeometry args={[w, h, 0.03]} />
        <meshStandardMaterial color={ATELIER.glass} roughness={0.15} metalness={0.1} transparent opacity={0.5} />
      </mesh>
      <Beam args={[w + 0.12, 0.08, 0.1]} position={[0, h / 2 + 0.05, 0]} />
      <Beam args={[w + 0.12, 0.08, 0.1]} position={[0, -h / 2 - 0.05, 0]} />
      <Beam args={[0.08, h + 0.18, 0.1]} position={[-w / 2 - 0.05, 0, 0]} />
      <Beam args={[0.08, h + 0.18, 0.1]} position={[w / 2 + 0.05, 0, 0]} />
      <Beam args={[w, 0.024, 0.06]} position={[0, 0, 0.02]} color={ATELIER.copper} />
      <Beam args={[0.024, h, 0.06]} position={[0, 0, 0.02]} color={ATELIER.copper} />
      <Beam args={[w + 0.2, 0.05, 0.16]} position={[0, -h / 2 - 0.12, 0.05]} color={ATELIER.patina} />
    </group>
  );
}

function PottedHerb({ position, scale = 1 }) {
  const tufts = Array.from({ length: 7 }, (_, i) => {
    const a = i * 1.12;
    const rr = 0.04 + (i % 2) * 0.03;
    return {
      x: Math.cos(a) * rr,
      z: Math.sin(a) * rr,
      y: 0.22 + (i % 3) * 0.04,
      rot: [i % 2 ? 0.22 : -0.18, a, 0.16],
      color: i % 2 ? ATELIER.forest : '#447f4b',
    };
  });
  return (
    <group position={position} scale={scale}>
      <mesh castShadow>
        <cylinderGeometry args={[0.13, 0.1, 0.2, 14]} />
        <meshStandardMaterial color={ATELIER.terracotta} roughness={0.88} />
      </mesh>
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.135, 0.135, 0.04, 14]} />
        <meshStandardMaterial color={ATELIER.clay} roughness={0.85} />
      </mesh>
      {tufts.map((t, i) => (
        <mesh key={i} position={[t.x, t.y, t.z]} rotation={t.rot} castShadow>
          <coneGeometry args={[0.03, 0.24, 6]} />
          <meshStandardMaterial color={t.color} roughness={0.82} flatShading />
        </mesh>
      ))}
    </group>
  );
}

function Atelier({
  position = [0, 0, 0],
  rotationY = 0,
  spellpadAcquired = true,
  onAtelierInteract,
}) {
  // structural dimensions (local space, +Z is the door-facing front)
  const floorY = 0.36;
  const wallH = 2.5;
  const T = 0.18;
  const WX = 2.2; // half width  (left/right walls at x = ±WX)
  const WZ = 2.0; // half depth  (front/back walls at z = ±WZ)
  const wallTopY = floorY + wallH;
  const Xr = ATELIER_ROOF_LAYOUT.halfRun;
  const Zr = ATELIER_ROOF_LAYOUT.halfDepth;
  const eaveY = ATELIER_ROOF_LAYOUT.eaveY;
  const ridgeY = ATELIER_ROOF_LAYOUT.ridgeY;
  const slopeAngle = ATELIER_ROOF_LAYOUT.slopeAngle;
  const slopeLen = ATELIER_ROOF_LAYOUT.panelLength;
  const gableApex = ridgeY - wallTopY;
  const front = WZ + 0.12; // mounting plane just proud of the front wall face
  const rightFace = WX + 0.12;

  // arched doorway, offset toward -X for the asymmetric hand-built feel
  const doorHalfW = 0.7;
  const doorCx = -0.3;
  const springY = floorY + 1.86; // top of the straight jambs
  const doorArchCenterY = springY + 0.06;
  const doorArchRiseScale = 0.58;
  const doorL = doorCx - doorHalfW;
  const doorR = doorCx + doorHalfW;

  const gableShape = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-WX, 0);
    s.lineTo(WX, 0);
    s.lineTo(0, gableApex);
    s.closePath();
    return s;
  }, [WX, gableApex]);

  const footingStones = Array.from({ length: 22 }, (_, i) => {
    const a = (i / 22) * Math.PI * 2;
    return {
      x: Math.cos(a) * (Xr + 0.05),
      z: Math.sin(a) * (Zr + 0.05),
      s: 0.18 + ((i * 7) % 5) * 0.04,
      rot: [a, i, a * 0.5],
      moss: i % 3 === 0,
    };
  }).filter((stone) => !(
    stone.z > WZ + 0.3
    && stone.x > doorL - 0.12
    && stone.x < doorR + 0.12
  ));

  const ivy = Array.from({ length: 16 }, (_, i) => {
    const t = i / 15;
    return {
      x: -WX + Math.sin(i * 1.7) * 0.12,
      y: floorY + t * (wallH + 0.1),
      z: WZ + 0.06 + Math.cos(i * 2.1) * 0.08,
      s: 0.1 + (i % 3) * 0.03,
      color: i % 2 ? ATELIER.forest : '#4f8c5a',
    };
  });

  return (
    <group
      name="atelier-workshop"
      position={position}
      rotation={[0, rotationY, 0]}
      userData={{
        spellSurface: {
          id: 'atelier-house',
          kind: 'world',
          label: 'Atelier',
          mountBodyId: 'atelier-house',
        },
      }}
    >
      {/* fieldstone footing */}
      <mesh name="atelier-foundation" position={[0, 0.19, 0]} receiveShadow castShadow>
        <boxGeometry args={[2 * WX + 0.5, 0.4, 2 * WZ + 0.5]} />
        <meshStandardMaterial color={ATELIER.stoneDark} roughness={0.95} />
      </mesh>
      {footingStones.map((s, i) => (
        <mesh key={`fstone-${i}`} position={[s.x, 0.16, s.z]} rotation={s.rot} castShadow receiveShadow>
          <dodecahedronGeometry args={[s.s, 0]} />
          <meshStandardMaterial color={s.moss ? ATELIER.moss : ATELIER.stone} roughness={0.96} flatShading />
        </mesh>
      ))}

      {/* plank floor */}
      <mesh name="atelier-floor" position={[0, floorY - 0.03, 0]} receiveShadow>
        <boxGeometry args={[2 * WX - 0.04, 0.06, 2 * WZ - 0.04]} />
        <meshStandardMaterial color={ATELIER.wood} roughness={0.9} />
      </mesh>

      {/* plaster walls */}
      <Plaster args={[2 * WX + T, wallH, T]} position={[0, floorY + wallH / 2, -WZ]} />
      <Plaster args={[T, wallH, 2 * WZ]} position={[-WX, floorY + wallH / 2, 0]} />
      <Plaster args={[T, wallH, 2 * WZ]} position={[WX, floorY + wallH / 2, 0]} />
      {/* front wall: two segments either side of the open arched doorway */}
      <Plaster args={[WX + doorL, wallH, T]} position={[(-WX + doorL) / 2, floorY + wallH / 2, WZ]} />
      <Plaster args={[WX - doorR, wallH, T]} position={[(WX + doorR) / 2, floorY + wallH / 2, WZ]} />
      <Plaster args={[2 * doorHalfW, wallTopY - springY, T]} position={[doorCx, (springY + wallTopY) / 2, WZ]} />
      <Beam args={[2 * doorHalfW + 0.1, 0.14, T + 0.06]} position={[doorCx, springY + 0.05, WZ]} color={ATELIER.beamWarm} />
      {/* A shallow eyebrow arch leaves a quiet plaster break below the wall-top beam. */}
      <mesh
        name="atelier-door-arch"
        position={[doorCx, doorArchCenterY, front]}
        scale={[1, doorArchRiseScale, 1]}
        castShadow
      >
        <torusGeometry args={[doorHalfW, 0.06, 8, 24, Math.PI]} />
        <meshStandardMaterial color={ATELIER.beamWarm} roughness={0.85} flatShading />
      </mesh>

      {/* timber frame */}
      {[[-WX, -WZ], [WX, -WZ], [-WX, WZ], [WX, WZ]].map(([x, z], i) => (
        <Beam key={`post-${i}`} args={[0.16, wallH + 0.12, 0.16]} position={[x, floorY + wallH / 2, z]} />
      ))}
      <Beam args={[2 * WX + 0.32, 0.16, 0.16]} position={[0, wallTopY, -WZ]} />
      <Beam args={[2 * WX + 0.32, 0.16, 0.16]} position={[0, wallTopY, WZ]} />
      <Beam args={[0.16, 0.16, 2 * WZ]} position={[-WX, wallTopY, 0]} />
      <Beam args={[0.16, 0.16, 2 * WZ]} position={[WX, wallTopY, 0]} />
      <Beam args={[2 * WX + 0.32, 0.14, 0.16]} position={[0, floorY + 0.06, -WZ]} color={ATELIER.beamWarm} />
      <Beam args={[0.16, 0.14, 2 * WZ]} position={[-WX, floorY + 0.06, 0]} color={ATELIER.beamWarm} />
      <Beam args={[0.16, 0.14, 2 * WZ]} position={[WX, floorY + 0.06, 0]} color={ATELIER.beamWarm} />
      <Beam args={[0.12, 0.12, 2 * WZ]} position={[WX, floorY + wallH * 0.55, 0]} />
      {[-1.0, 0.0, 1.0].map((z, i) => (
        <Beam key={`rstud-${i}`} args={[0.1, wallH, 0.1]} position={[WX, floorY + wallH / 2, z]} />
      ))}
      <Beam args={[0.1, 1.0, 0.1]} position={[WX, wallTopY - 0.55, -1.3]} rotation={[0.7, 0, 0]} />
      {[-1.1, 1.1].map((x, i) => (
        <Beam key={`bstud-${i}`} args={[0.1, wallH, 0.1]} position={[x, floorY + wallH / 2, -WZ]} />
      ))}

      {/* steep wood-shingle roof */}
      <mesh name="atelier-roof-right" position={[Xr / 2, ATELIER_ROOF_LAYOUT.panelCenterY, 0]} rotation={[0, 0, -slopeAngle]} castShadow receiveShadow>
        <boxGeometry args={[slopeLen, ATELIER_ROOF_LAYOUT.thickness, 2 * Zr]} />
        <meshStandardMaterial color={ATELIER.shingle} roughness={0.9} flatShading />
      </mesh>
      <mesh name="atelier-roof-left" position={[-Xr / 2, ATELIER_ROOF_LAYOUT.panelCenterY, 0]} rotation={[0, 0, slopeAngle]} castShadow receiveShadow>
        <boxGeometry args={[slopeLen, ATELIER_ROOF_LAYOUT.thickness, 2 * Zr]} />
        <meshStandardMaterial color={ATELIER.shingle} roughness={0.9} flatShading />
      </mesh>
      <mesh name="atelier-ridge" position={[0, ridgeY + 0.02, 0]} castShadow>
        <boxGeometry args={[0.22, 0.16, 2 * Zr + 0.1]} />
        <meshStandardMaterial color={ATELIER.patina} roughness={0.7} metalness={0.2} />
      </mesh>

      {/* curved-feeling gables with carved bargeboards + an oculus */}
      <mesh name="atelier-gable-front" position={[0, wallTopY, WZ]}>
        <shapeGeometry args={[gableShape]} />
        <meshStandardMaterial color={ATELIER.plasterShade} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      <mesh name="atelier-gable-back" position={[0, wallTopY, -WZ]} rotation={[0, Math.PI, 0]}>
        <shapeGeometry args={[gableShape]} />
        <meshStandardMaterial color={ATELIER.plasterShade} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      <Beam args={[Math.hypot(WX, gableApex), 0.12, 0.1]} position={[-WX / 2, wallTopY + gableApex / 2, WZ + 0.05]} rotation={[0, 0, Math.atan2(gableApex, WX)]} color={ATELIER.beamWarm} />
      <Beam args={[Math.hypot(WX, gableApex), 0.12, 0.1]} position={[WX / 2, wallTopY + gableApex / 2, WZ + 0.05]} rotation={[0, 0, -Math.atan2(gableApex, WX)]} color={ATELIER.beamWarm} />
      <mesh position={[0, wallTopY + gableApex * 0.45, WZ + 0.04]}>
        <circleGeometry args={[0.26, 20]} />
        <meshStandardMaterial color={ATELIER.glass} roughness={0.15} transparent opacity={0.6} />
      </mesh>
      <mesh position={[0, wallTopY + gableApex * 0.45, WZ + 0.05]}>
        <torusGeometry args={[0.27, 0.04, 8, 20]} />
        <meshStandardMaterial color={ATELIER.copper} roughness={0.6} metalness={0.3} />
      </mesh>

      {/* rounded clay chimney with terracotta pots */}
      <group position={[1.45, 0, -1.2]}>
        <mesh name="atelier-chimney" position={[0, 4.0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.3, 0.34, 2.7, 16]} />
          <meshStandardMaterial color={ATELIER.clay} roughness={0.92} />
        </mesh>
        <mesh position={[0, 5.4, 0]} castShadow>
          <cylinderGeometry args={[0.37, 0.37, 0.2, 16]} />
          <meshStandardMaterial color={ATELIER.terracotta} roughness={0.85} />
        </mesh>
        {[-0.13, 0.13].map((dx, i) => (
          <mesh key={i} position={[dx, 5.6, 0]} castShadow>
            <cylinderGeometry args={[0.08, 0.09, 0.22, 12]} />
            <meshStandardMaterial color={ATELIER.terracotta} roughness={0.8} />
          </mesh>
        ))}
      </group>

      {/* the door, standing open against the wall */}
      <group position={[doorL, floorY + (springY - floorY) / 2, WZ + 0.1]} rotation={[0, -1.95, 0]}>
        <mesh name="atelier-door" position={[doorHalfW, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[2 * doorHalfW, springY - floorY - 0.04, 0.06]} />
          <meshStandardMaterial color={ATELIER.woodLight} roughness={0.85} />
        </mesh>
        {[-0.25, 0.25].map((dx, i) => (
          <mesh key={i} position={[doorHalfW + dx, 0, 0.035]}>
            <boxGeometry args={[0.03, springY - floorY - 0.12, 0.02]} />
            <meshStandardMaterial color={ATELIER.beam} roughness={0.9} />
          </mesh>
        ))}
        {[-0.55, 0.55].map((dy, i) => (
          <mesh key={`hinge-${i}`} position={[0.06, dy, 0.04]}>
            <boxGeometry args={[0.16, 0.07, 0.03]} />
            <meshStandardMaterial color={ATELIER.copper} metalness={0.4} roughness={0.5} />
          </mesh>
        ))}
        <mesh position={[2 * doorHalfW - 0.14, 0, 0.06]}>
          <cylinderGeometry args={[0.04, 0.04, 0.05, 12]} />
          <meshStandardMaterial color={ATELIER.copper} metalness={0.4} roughness={0.5} />
        </mesh>
      </group>

      {/* small leaded-glass windows */}
      <LeadedWindow position={[1.3, floorY + 1.3, front]} />
      <LeadedWindow position={[rightFace, floorY + 1.2, -0.4]} rotation={[0, Math.PI / 2, 0]} />

      {/* natural integration: ivy, herbs, stone steps */}
      {ivy.map((v, i) => (
        <mesh key={`ivy-${i}`} position={[v.x, v.y, v.z]} rotation={[i, i * 1.3, 0]} castShadow>
          <icosahedronGeometry args={[v.s, 0]} />
          <meshStandardMaterial color={v.color} roughness={0.85} flatShading />
        </mesh>
      ))}
      <PottedHerb position={[doorL - 0.28, floorY, WZ + 0.34]} />
      {ATELIER_ENTRANCE_STEPS.map((step, i) => (
        <mesh
          key={`step-${i}`}
          name={`atelier-entrance-step-${i}`}
          position={[step.x, step.height / 2, step.z]}
          rotation={[0, step.rotationY, 0]}
          receiveShadow
          castShadow
        >
          <cylinderGeometry args={[step.radius - 0.025, step.radius, step.height, 10]} />
          <meshStandardMaterial color={ATELIER.stone} roughness={0.95} flatShading />
        </mesh>
      ))}

      {/* interior collar beam */}
      <Beam args={[2 * WX, 0.16, 0.16]} position={[0, wallTopY - 0.05, -0.3]} />

      {/* Back-wall writing desk: the Spellpad lives here, never the workshop route. */}
      <group name="atelier-writing-desk" position={[0, 0, -1.15]}>
        <AtelierWritingDesk
          spellpadAcquired={spellpadAcquired}
          showObjectiveMarker={!spellpadAcquired}
          onSpellpadClick={(event) => {
            event.stopPropagation();
            onAtelierInteract?.({ kind: 'spellpad', source: 'click', surfaceName: 'atelier-writing-desk' });
          }}
        />
      </group>

      {/* Entrance-right mechanics desk: the only in-world route to the workshop. */}
      <group
        name="atelier-workshop-desk"
        position={[1.72, 0, 0.48]}
        rotation={[0, Math.PI / 2, 0]}
        userData={{ atelierInteraction: 'workshop' }}
        onClick={(event) => {
          event.stopPropagation();
          onAtelierInteract?.({ kind: 'workshop', source: 'click', surfaceName: 'atelier-workshop-desk' });
        }}
      >
        <AtelierMechanicsDesk
          onClick={(event) => {
            event.stopPropagation();
            onAtelierInteract?.({ kind: 'workshop', source: 'click', surfaceName: 'atelier-workshop-desk' });
          }}
        />
      </group>

      {/* Bookshelf relocated to entrance-left, clear of the mechanics desk. */}
      <group position={[-1.9, floorY, 0.72]}>
        <mesh position={[-0.13, 0.9, 0]} receiveShadow>
          <boxGeometry args={[0.04, 1.8, 1.3]} />
          <meshStandardMaterial color={ATELIER.woodLight} roughness={0.88} />
        </mesh>
        {[-0.62, 0.62].map((z, i) => (
          <mesh key={`up-${i}`} position={[0, 0.9, z]} castShadow>
            <boxGeometry args={[0.32, 1.8, 0.06]} />
            <meshStandardMaterial color={ATELIER.wood} roughness={0.88} />
          </mesh>
        ))}
        {[0.4, 0.92, 1.44].map((y, si) => (
          <group key={`shelf-${si}`}>
            <mesh position={[0, y, 0]} receiveShadow castShadow>
              <boxGeometry args={[0.3, 0.04, 1.24]} />
              <meshStandardMaterial color={ATELIER.woodLight} roughness={0.88} />
            </mesh>
            {Array.from({ length: 6 }, (_, bi) => {
              const tones = [ATELIER.ink, ATELIER.forest, ATELIER.clay, ATELIER.dustyBlue, ATELIER.teal, '#7a4a2c'];
              return (
                <Book
                  key={bi}
                  position={[0.0, y + 0.14, -0.42 + bi * 0.085]}
                  rotation={[0, 0, bi === 5 ? 0.3 : 0]}
                  color={tones[(bi + si) % tones.length]}
                  w={0.2}
                  h={0.26 - (bi % 2) * 0.03}
                  d={0.06}
                />
              );
            })}
          </group>
        ))}
        <Jar position={[0.04, 1.06, 0.5]} color={ATELIER.teal} />
        <Scroll position={[0.04, 0.5, 0.45]} rotation={[0, Math.PI / 2, 0]} len={0.3} />
      </group>

      {/* three-legged stool */}
      <group position={[0.1, floorY, -0.35]}>
        <mesh position={[0, 0.5, 0]} castShadow>
          <cylinderGeometry args={[0.18, 0.18, 0.06, 16]} />
          <meshStandardMaterial color={ATELIER.woodLight} roughness={0.88} />
        </mesh>
        {[0, 2.1, 4.2].map((a, i) => (
          <mesh key={i} position={[Math.cos(a) * 0.12, 0.25, Math.sin(a) * 0.12]} rotation={[0.12 * Math.cos(a), 0, 0.12 * Math.sin(a)]} castShadow>
            <cylinderGeometry args={[0.025, 0.03, 0.5, 8]} />
            <meshStandardMaterial color={ATELIER.wood} roughness={0.9} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function PlayerCharacter({
  cameraMode,
  inputEnabled = true,
  capturedCursorActive = false,
  cameraSensitivity = 1,
  initialPlayerState = null,
  playerControllerRef,
  pendingPlayerTeleportRef,
}) {
  const { camera, gl, invalidate } = useThree();
  const playerRef = useRef(null);
  const keysRef = useRef(new Set());
  const freeCameraKeysRef = useRef(new Set());
  const freeCameraPressesRef = useRef(new Set());
  const positionRef = useRef({
    x: Number(initialPlayerState?.position?.x ?? PLAYER_START.x),
    z: Number(initialPlayerState?.position?.z ?? PLAYER_START.z),
  });
  const facingRef = useRef(Number(initialPlayerState?.facing ?? ATELIER_PLAYTHROUGH.spawn.facing));
  const pitchRef = useRef(readPlayerPitch(initialPlayerState));
  const walkClockRef = useRef(0);
  const cameraModeRef = useRef(cameraMode);
  const lastCameraModeRef = useRef(cameraMode);
  const freeCameraRef = useRef({
    position: new THREE.Vector3(),
    yaw: Number(initialPlayerState?.facing ?? ATELIER_PLAYTHROUGH.spawn.facing),
    pitch: readPlayerPitch(initialPlayerState),
    initialized: false,
  });
  const inputEnabledRef = useRef(inputEnabled);
  const capturedCursorActiveRef = useRef(capturedCursorActive);
  const cameraSensitivityRef = useRef(cameraSensitivity);
  const reducedMotionRef = useRef(false);
  const pointerStateRef = useRef({
    locked: false,
    preferred: false,
    suspended: false,
    requested: 0,
    changeCount: 0,
    errorCount: 0,
    lastEvent: 'initial',
  });
  const lookDragRef = useRef({ active: false, pointerId: null, x: 0, y: 0 });
  const movementRef = useRef({ forward: 0, right: 0, x: 0, z: 0, moving: false });
  // Shared witch rig (visual only — physics/position are owned elsewhere).
  const jointsRef = useRef({});
  const poseRef = useRef(neutralPose());
  const rigSimRef = useRef({ lastX: null, lastZ: null, lastY: null, speedFactor: 0, verticalVelocity: 0 });
  // Jump state machine (ported from the character lab):
  // idle -> crouch (anticipation) -> air (launch/tuck) -> land (squash) -> idle.
  const jumpSimRef = useRef({ state: 'idle', stateTime: 0, vy: 0, queued: false });
  const bindJoint = useCallback((name) => (object) => {
    jointsRef.current[name] = object;
  }, []);

  cameraModeRef.current = cameraMode;
  inputEnabledRef.current = inputEnabled;
  capturedCursorActiveRef.current = capturedCursorActive;
  cameraSensitivityRef.current = normalizeInputSensitivity(cameraSensitivity);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const update = () => {
      reducedMotionRef.current = Boolean(media?.matches);
    };
    update();
    media?.addEventListener?.('change', update);
    return () => media?.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    if (cameraMode === 'fc') return;
    freeCameraKeysRef.current.clear();
    freeCameraPressesRef.current.clear();
  }, [cameraMode]);

  useLayoutEffect(() => {
    const canvas = gl.domElement;
    const pointerState = pointerStateRef.current;
    const syncPointerLock = (eventName) => {
      pointerState.locked = document.pointerLockElement === canvas;
      pointerState.changeCount += 1;
      pointerState.lastEvent = eventName;
      if (!pointerState.locked) {
        keysRef.current.clear();
        freeCameraKeysRef.current.clear();
        freeCameraPressesRef.current.clear();
        if (!pointerState.suspended) {
          pointerState.preferred = false;
        }
      }
      invalidate();
    };
    const handlePointerLockChange = () => syncPointerLock('pointerlockchange');
    const handlePointerLockError = () => {
      pointerState.errorCount += 1;
      pointerState.lastEvent = 'pointerlockerror';
      pointerState.locked = document.pointerLockElement === canvas;
    };
    const requestPointerLock = ({ resume = false } = {}) => {
      if (!resume && !inputEnabledRef.current) return false;
      if (!resume) {
        pointerState.preferred = true;
        pointerState.suspended = false;
      }
      if (document.pointerLockElement === canvas) return true;
      pointerState.requested += 1;
      pointerState.lastEvent = resume ? 'resume-request' : 'request';
      const request = canvas.requestPointerLock?.();
      request?.catch?.(() => {});
      return true;
    };
    window.__WHA_REQUEST_POINTER_LOCK__ = requestPointerLock;
    window.__WHA_RESUME_POINTER_LOCK__ = () => {
      if (!pointerState.preferred || !pointerState.suspended) return false;
      pointerState.suspended = false;
      return requestPointerLock({ resume: true });
    };
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    document.addEventListener('pointerlockerror', handlePointerLockError);
    syncPointerLock('initial');
    return () => {
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      document.removeEventListener('pointerlockerror', handlePointerLockError);
      delete window.__WHA_REQUEST_POINTER_LOCK__;
      delete window.__WHA_RESUME_POINTER_LOCK__;
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    };
  }, [gl, invalidate]);

  useEffect(() => {
    const canvas = gl.domElement;
    const applyLookDelta = (movementX, movementY) => {
      if (!inputEnabledRef.current) return;
      if (!Number.isFinite(movementX) || !Number.isFinite(movementY)) return;
      const freeCamera = freeCameraRef.current;
      const yawRef = cameraModeRef.current === 'fc' ? freeCamera : null;
      const lookSensitivity = PLAYER_LOOK_SENSITIVITY * cameraSensitivityRef.current;
      if (movementX !== 0) {
        if (yawRef) yawRef.yaw = normalizeYaw(yawRef.yaw - movementX * lookSensitivity);
        else facingRef.current = normalizeYaw(facingRef.current - movementX * lookSensitivity);
      }
      if (movementY !== 0) {
        const nextPitch = clamp(
          (yawRef ? yawRef.pitch : pitchRef.current) - movementY * lookSensitivity,
          -PLAYER_PITCH_LIMIT,
          PLAYER_PITCH_LIMIT,
        );
        if (yawRef) yawRef.pitch = nextPitch;
        else pitchRef.current = nextPitch;
      }
      invalidate();
    };
    const handleMouseMove = (event) => {
      if (!inputEnabledRef.current) return;
      if (document.pointerLockElement !== canvas) return;
      if (capturedCursorActiveRef.current) return;
      const movementX = Number(event.movementX ?? 0);
      const movementY = Number(event.movementY ?? 0);
      applyLookDelta(movementX, movementY);
    };
    const endLookDrag = (event) => {
      const drag = lookDragRef.current;
      if (!drag.active || (event?.pointerId != null && event.pointerId !== drag.pointerId)) return;
      drag.active = false;
      canvas.dataset.cameraLookDragging = 'false';
      if (event?.pointerId != null && canvas.hasPointerCapture?.(event.pointerId)) {
        try {
          canvas.releasePointerCapture?.(event.pointerId);
        } catch {
          // The browser may already have released capture while cancelling.
        }
      }
    };
    const handlePointerDown = (event) => {
      if (!inputEnabledRef.current || event.button !== 0) return;
      if (document.pointerLockElement === canvas) return;
      lookDragRef.current = {
        active: true,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      canvas.dataset.cameraLookDragging = 'true';
      try {
        canvas.setPointerCapture?.(event.pointerId);
      } catch {
        // Synthetic test pointers may not be registered as active pointers.
      }
    };
    const handlePointerMove = (event) => {
      const drag = lookDragRef.current;
      if (!drag.active || event.pointerId !== drag.pointerId) return;
      if (!inputEnabledRef.current || document.pointerLockElement === canvas) {
        endLookDrag(event);
        return;
      }
      const movementX = Number(event.clientX) - drag.x;
      const movementY = Number(event.clientY) - drag.y;
      drag.x = Number(event.clientX);
      drag.y = Number(event.clientY);
      applyLookDelta(movementX, movementY);
    };
    document.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', endLookDrag);
    canvas.addEventListener('pointercancel', endLookDrag);
    canvas.addEventListener('lostpointercapture', endLookDrag);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', endLookDrag);
      canvas.removeEventListener('pointercancel', endLookDrag);
      canvas.removeEventListener('lostpointercapture', endLookDrag);
      endLookDrag();
      delete canvas.dataset.cameraLookDragging;
    };
  }, [gl, invalidate]);

  useLayoutEffect(() => {
    const pointerState = pointerStateRef.current;
    const canvas = gl.domElement;
    if (!inputEnabled) {
      keysRef.current.clear();
      freeCameraKeysRef.current.clear();
      freeCameraPressesRef.current.clear();
      lookDragRef.current.active = false;
      canvas.dataset.cameraLookDragging = 'false';
    }
    if (!inputEnabled && !capturedCursorActive) {
      if (pointerState.preferred || document.pointerLockElement === canvas) {
        pointerState.preferred = true;
        pointerState.suspended = true;
      }
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
      return;
    }
    if (!capturedCursorActive && pointerState.preferred && pointerState.suspended) {
      window.__WHA_RESUME_POINTER_LOCK__?.();
    }
  }, [capturedCursorActive, gl, inputEnabled]);

  useEffect(() => {
    window.__WHA_SET_PLAYER_STATE__ = (nextState) => {
      if (!nextState?.position) return;
      const position = {
        x: Number(nextState.position.x ?? positionRef.current.x),
        z: Number(nextState.position.z ?? positionRef.current.z),
      };
      const facing = Number(nextState.yaw ?? nextState.facing ?? facingRef.current);
      const pitch = readPlayerPitch(nextState, pitchRef.current);
      positionRef.current = position;
      facingRef.current = facing;
      pitchRef.current = pitch;
      const physicsPosition = {
        x: position.x,
        y: terrainHeightAt(position.x, position.z),
        z: position.z,
      };
      const teleportPlayer = playerControllerRef?.current?.teleportPlayer
        ?? window.__WHA_PLAYER_PHYSICS__?.teleportPlayer;
      if (teleportPlayer) {
        teleportPlayer(physicsPosition);
        if (pendingPlayerTeleportRef) pendingPlayerTeleportRef.current = null;
      } else if (pendingPlayerTeleportRef) {
        pendingPlayerTeleportRef.current = physicsPosition;
      }
      window.__WHA_PLAYER__ = {
        ...(window.__WHA_PLAYER__ ?? {}),
        position: { ...position, y: terrainHeightAt(position.x, position.z) },
        facing,
        yaw: facing,
        pitch,
        pitchDeg: round(THREE.MathUtils.radToDeg(pitch)),
      };
      window.__WHA_EVALUATE_WORKBENCH__?.();
      window.dispatchEvent(new Event('wha-player-state-change'));
      invalidate();
    };
    return () => delete window.__WHA_SET_PLAYER_STATE__;
  }, [invalidate]);

  useEffect(() => {
    const initialX = Number(initialPlayerState?.position?.x ?? PLAYER_START.x);
    const initialZ = Number(initialPlayerState?.position?.z ?? PLAYER_START.z);
    if (!Number.isFinite(initialX) || !Number.isFinite(initialZ)) return;
    positionRef.current = { x: initialX, z: initialZ };
    facingRef.current = Number(
      initialPlayerState?.yaw
      ?? initialPlayerState?.facing
      ?? ATELIER_PLAYTHROUGH.spawn.facing,
    );
    pitchRef.current = readPlayerPitch(initialPlayerState);
    keysRef.current.clear();
    freeCameraKeysRef.current.clear();
    freeCameraPressesRef.current.clear();
  }, [initialPlayerState]);

  useEffect(() => {
    const setKey = (event, pressed) => {
      if (!inputEnabledRef.current) return;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableEventTarget(event.target) && event.target.tagName !== 'BUTTON') return;
      const freeCameraKey = cameraModeRef.current === 'fc' ? freeCameraMovementKey(event) : null;
      if (freeCameraKey) {
        freeCameraKeysRef.current[pressed ? 'add' : 'delete'](freeCameraKey);
        if (pressed && !event.repeat) freeCameraPressesRef.current.add(freeCameraKey);
        invalidate();
        event.preventDefault();
        return;
      }
      const key = playerMovementKey(event.key, cameraModeRef.current);
      if (!key) return;
      if (key === 'jump') {
        if (pressed && !event.repeat) jumpSimRef.current.queued = true;
      } else {
        keysRef.current[pressed ? 'add' : 'delete'](key);
      }
      invalidate();
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
  }, [invalidate]);

  // Movement intent is prepared before the main-world owner runs. The
  // controller then resolves it against Rapier colliders; the publication
  // pass below runs after that resolution and never publishes a pre-collision
  // position.
  useFrame((_, delta) => {
    if (!inputEnabledRef.current) {
      keysRef.current.clear();
      freeCameraKeysRef.current.clear();
      freeCameraPressesRef.current.clear();
    }
    const keys = keysRef.current;
    const forwardInput = (keys.has('north') ? 1 : 0) - (keys.has('south') ? 1 : 0);
    const rightInput = (keys.has('east') ? 1 : 0) - (keys.has('west') ? 1 : 0);
    const forward = new THREE.Vector3(Math.sin(facingRef.current), 0, Math.cos(facingRef.current));
    const { right } = horizontalBasis(forward);
    const move = forward.multiplyScalar(forwardInput).add(right.multiplyScalar(rightInput));
    const moveLength = move.length();
    if (moveLength > 0.000001) move.multiplyScalar(1 / moveLength);
    const length = Math.hypot(move.x, move.z);
    const moving = length > 0.000001 && inputEnabledRef.current;
    const dt = Math.min(delta, 0.05);
    // Air control is reduced so jumps keep their takeoff momentum (lab: 0.55).
    const jump = jumpSimRef.current;
    const control = jump.state === 'air' ? 0.55 : 1;
    const distance = moving ? dt * PLAYER_SPEED * control : 0;

    // --- Jump state machine (crouch -> air -> land), physics-resolved --------
    const physicsPlayer = playerControllerRef?.current?.getPlayerState?.();
    const grounded = physicsPlayer?.grounded ?? true;
    const physicsPosition = physicsPlayer?.position;
    if (physicsPosition?.y <= PLAYER_RESPAWN_Y) {
      keysRef.current.clear();
      jumpSimRef.current = { state: 'idle', stateTime: 0, vy: 0, queued: false };
      movementRef.current = { forward: 0, right: 0, x: 0, z: 0, moving: false };
      window.__WHA_SET_PLAYER_STATE__?.({
        position: ATELIER_PLAYTHROUGH.spawn.world,
        facing: ATELIER_PLAYTHROUGH.spawn.facing,
        pitch: ATELIER_PLAYTHROUGH.spawn.pitch,
      });
      return;
    }
    const airHeight = physicsPosition
      ? Math.max(0, physicsPosition.y - terrainHeightAt(physicsPosition.x, physicsPosition.z))
      : 0;
    if (jump.queued && jump.state === 'idle' && grounded && inputEnabledRef.current) {
      jump.state = 'crouch';
      jump.stateTime = 0;
    }
    jump.queued = false;
    jump.stateTime += dt;
    let requestedY = 0;
    if (jump.state === 'idle' && !grounded && airHeight > PLAYER_AIR_HEIGHT_THRESHOLD) {
      // Walking off a ledge starts the same physics-resolved air phase as a
      // jump, but with no upward impulse. The controller's grounded result is
      // intentionally gated by air height so a flat-ground contact gap cannot
      // toggle the animation state.
      jump.state = 'air';
      jump.stateTime = 0;
      jump.vy = 0;
    }
    if (jump.state === 'crouch') {
      if (jump.stateTime >= PLAYER_CROUCH_SECONDS) {
        jump.state = 'air';
        jump.stateTime = 0;
        jump.vy = PLAYER_JUMP_VELOCITY;
      }
    } else if (jump.state === 'air') {
      jump.vy -= PLAYER_JUMP_GRAVITY * dt;
      requestedY = jump.vy * dt;
      if (grounded && jump.vy <= 0.05 && jump.stateTime > 0.06) {
        jump.state = 'land';
        jump.stateTime = 0;
        jump.vy = 0;
      }
    } else if (jump.state === 'land') {
      if (jump.stateTime >= PLAYER_LAND_SECONDS) jump.state = 'idle';
    }

    const requested = {
      x: move.x * distance,
      y: requestedY,
      z: move.z * distance,
    };
    playerControllerRef?.current?.requestTranslation(requested);
    movementRef.current = {
      forward: forwardInput,
      right: rightInput,
      x: round(moving ? move.x : 0),
      z: round(moving ? move.z : 0),
      moving,
    };
    if (moving || jump.state !== 'idle') invalidate();

    if (cameraModeRef.current === 'fc' && inputEnabledRef.current) {
      const cameraKeys = freeCameraKeysRef.current;
      const cameraPresses = freeCameraPressesRef.current;
      const hasCameraInput = (key) => cameraKeys.has(key) || cameraPresses.has(key);
      const freeCamera = freeCameraRef.current;
      const cameraForward = lookDirectionFor(freeCamera.yaw, freeCamera.pitch);
      const cameraRight = new THREE.Vector3().crossVectors(cameraForward, new THREE.Vector3(0, 1, 0));
      if (cameraRight.lengthSq() <= 0.000001) cameraRight.set(1, 0, 0);
      else cameraRight.normalize();
      const cameraMove = new THREE.Vector3()
        .addScaledVector(cameraForward, (hasCameraInput('forward') ? 1 : 0) - (hasCameraInput('back') ? 1 : 0))
        .addScaledVector(cameraRight, (hasCameraInput('right') ? 1 : 0) - (hasCameraInput('left') ? 1 : 0));
      cameraMove.y += (hasCameraInput('up') ? 1 : 0) - (hasCameraInput('down') ? 1 : 0);
      cameraPresses.clear();
      if (cameraMove.lengthSq() > 0.000001) {
        cameraMove.normalize().multiplyScalar(FREE_CAMERA_SPEED * dt);
        freeCamera.position.add(cameraMove);
        invalidate();
      }
    }
  }, MAIN_WORLD_FRAME_PRIORITY.playerInput);

  useFrame((frame, rawDelta) => {
    const physicsPlayer = playerControllerRef?.current?.getPlayerState?.();
    if (physicsPlayer?.position) {
      positionRef.current = {
        x: physicsPlayer.position.x,
        z: physicsPlayer.position.z,
      };
    }
    const mode = cameraModeRef.current;
    const { x, z } = positionRef.current;
    const y = physicsPlayer?.position?.y ?? terrainHeightAt(x, z);
    const moving = movementRef.current.moving;
    const forward = new THREE.Vector3(Math.sin(facingRef.current), 0, Math.cos(facingRef.current));
    const player = playerRef.current;
    if (player) {
      player.position.set(x, y, z);
      player.rotation.y = facingRef.current;
      player.visible = mode !== 'fp';

      // --- Rig animation (visual only) ---------------------------------------
      const dt = Math.min(rawDelta, 0.05);
      const rigSim = rigSimRef.current;
      // Horizontal speed measured from resolved position deltas (never writes
      // back to physics or position).
      let horizontalSpeed = 0;
      let verticalVelocity = 0;
      if (rigSim.lastX !== null && dt > 0) {
        horizontalSpeed = Math.hypot(x - rigSim.lastX, z - rigSim.lastZ) / dt;
        verticalVelocity = (y - rigSim.lastY) / dt;
      }
      rigSim.lastX = x;
      rigSim.lastZ = z;
      rigSim.lastY = y;
      rigSim.verticalVelocity = THREE.MathUtils.damp(
        rigSim.verticalVelocity, verticalVelocity, 14, dt,
      );
      // The rig animates in lab units (1.93 m tall); convert the measured
      // world speed into rig-local speed so stride amplitude and cadence match
      // the lab's speed relationship (lab: factor = speed/2.2, phase rate =
      // 4.6 + speed*2.2). Clamp to reject teleport spikes.
      const localSpeed = Math.min(horizontalSpeed / PLAYER_RIG_SCALE, 6);
      const targetFactor = reducedMotionRef.current
        ? (moving ? 0.35 : 0)
        : clamp(localSpeed / 2.2, 0, 1);
      rigSim.speedFactor = THREE.MathUtils.damp(rigSim.speedFactor, targetFactor, 8, dt);
      if (rigSim.speedFactor > 0.02) {
        walkClockRef.current +=
          dt * (4.6 + localSpeed * 2.2) * PLAYER_WALK_CADENCE * Math.max(rigSim.speedFactor, 0.4);
      }

      const groundY = terrainHeightAt(x, z);
      const airY = Math.max(0, y - groundY);
      const grounded = physicsPlayer ? (physicsPlayer.grounded ?? true) : true;
      const jump = jumpSimRef.current;
      const airborne = jump.state === 'air' || (!grounded && airY > 0.12);

      const target = neutralPose();
      idleTargets(target, frame.clock.elapsedTime);
      if (rigSim.speedFactor > 0.02) walkTargets(target, walkClockRef.current, rigSim.speedFactor, PLAYER_WALK_STRIDE);
      if (jump.state === 'crouch') {
        crouchTargets(target, Math.min(1, jump.stateTime / PLAYER_CROUCH_SECONDS));
      } else if (jump.state === 'air') {
        // airTargets expects a lab-scale vertical velocity.
        airTargets(target, jump.vy / PLAYER_RIG_SCALE);
      } else if (jump.state === 'land') {
        const recover = 1 - Math.min(1, jump.stateTime / PLAYER_LAND_SECONDS);
        landTargets(target, recover * recover);
      } else if (airborne) {
        airTargets(target, rigSim.verticalVelocity / PLAYER_RIG_SCALE);
      }
      const current = dampPose(poseRef.current, target, dt);
      applyPose(jointsRef.current, current, { airY: airborne ? airY : 0 });
    }
    let thirdPersonDebug = null;
    if (mode === 'fp') {
      camera.position.set(x, y + PLAYER_HEAD_HEIGHT, z);
      const lookDirection = lookDirectionFor(facingRef.current, pitchRef.current);
      camera.lookAt(camera.position.clone().add(lookDirection.multiplyScalar(3)));
      setCameraFov(camera, 58);
    } else if (mode === 'tp') {
      const resolved = resolveThirdPersonCamera(
        { x, y, z },
        facingRef.current,
        pitchRef.current,
        playerControllerRef?.current,
      );
      camera.position.copy(resolved.position);
      camera.lookAt(camera.position.clone().add(resolved.lookDirection));
      setCameraFov(camera, THIRD_PERSON_FOV);
      thirdPersonDebug = resolved;
    } else {
      const freeCamera = freeCameraRef.current;
      if (lastCameraModeRef.current !== 'fc' || !freeCamera.initialized) {
        const seed = resolveThirdPersonCamera(
          { x, y, z },
          facingRef.current,
          pitchRef.current,
          playerControllerRef?.current,
        );
        freeCamera.position.copy(seed.position);
        freeCamera.yaw = facingRef.current;
        freeCamera.pitch = pitchRef.current;
        freeCamera.initialized = true;
        thirdPersonDebug = seed;
      }
      const lookDirection = lookDirectionFor(freeCamera.yaw, freeCamera.pitch);
      camera.position.copy(freeCamera.position);
      camera.lookAt(camera.position.clone().add(lookDirection));
      setCameraFov(camera, FREE_CAMERA_FOV);
    }
    lastCameraModeRef.current = mode;
    const pointerLock = pointerStateRef.current;
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    const movementState = { ...movementRef.current, normalized: movementRef.current.moving };
    window.__WHA_PLAYER__ = {
      height: PLAYER_HEIGHT,
      headHeight: PLAYER_HEAD_HEIGHT,
      position: { x: round(x), y: round(y), z: round(z) },
      facing: round(facingRef.current),
      yaw: round(facingRef.current),
      pitch: round(pitchRef.current),
      pitchDeg: round(THREE.MathUtils.radToDeg(pitchRef.current)),
      moving,
      movement: movementState,
      grounded: physicsPlayer?.grounded ?? false,
      jumpState: jumpSimRef.current.state,
      cameraMode: mode,
      inputEnabled: inputEnabledRef.current,
      pointerLock: pointerLock.locked,
    };
    window.__WHA_CAMERA_MODE__ = mode;
    window.__WHA_CAMERA_DEBUG__ = {
      mode,
      position: {
        x: round(camera.position.x),
        y: round(camera.position.y),
        z: round(camera.position.z),
      },
      playerHeadPosition: {
        x: round(x),
        y: round(y + PLAYER_HEAD_HEIGHT),
        z: round(z),
      },
      fov: round(camera.fov),
      lookDirection: {
        x: round(cameraDirection.x),
        y: round(cameraDirection.y),
        z: round(cameraDirection.z),
      },
      yaw: round(mode === 'fc' ? freeCameraRef.current.yaw : facingRef.current),
      pitch: round(mode === 'fc' ? freeCameraRef.current.pitch : pitchRef.current),
      pitchDeg: round(THREE.MathUtils.radToDeg(
        mode === 'fc' ? freeCameraRef.current.pitch : pitchRef.current,
      )),
      pitchLimitDeg: 80,
      sensitivity: round(cameraSensitivityRef.current),
      thirdPerson: thirdPersonDebug ? {
        desiredPosition: vectorDebug(thirdPersonDebug.desiredPosition),
        pivot: vectorDebug(thirdPersonDebug.pivot),
        desiredBoomDistance: round(thirdPersonDebug.desiredBoomDistance),
        resolvedBoomDistance: round(thirdPersonDebug.resolvedBoomDistance),
        obstructed: thirdPersonDebug.obstructed,
      } : null,
      freeCamera: mode === 'fc' ? {
        position: vectorDebug(freeCameraRef.current.position),
        yaw: round(freeCameraRef.current.yaw),
        pitch: round(freeCameraRef.current.pitch),
      } : null,
      inputEnabled: inputEnabledRef.current,
      pointerLock: {
        locked: pointerLock.locked,
        preferred: pointerLock.preferred,
        suspended: pointerLock.suspended,
        requested: pointerLock.requested,
        changeCount: pointerLock.changeCount,
        errorCount: pointerLock.errorCount,
        lastEvent: pointerLock.lastEvent,
      },
    };
  }, MAIN_WORLD_FRAME_PRIORITY.playerPresentation);

  // The rig authors the character ~1.93 m tall (hat tip); scale it down so the
  // avatar matches PLAYER_HEIGHT used by the camera and physics capsule.
  const rigScale = PLAYER_HEIGHT / 1.93;
  return (
    <group
      ref={playerRef}
      name="player-character"
      position={[PLAYER_START.x, 0, PLAYER_START.z]}
      rotation={[0, ATELIER_PLAYTHROUGH.spawn.facing, 0]}
      scale={[rigScale, rigScale, rigScale]}
    >
      <CharacterModel bind={bindJoint} />
    </group>
  );
}

function AtelierDeskInteractionSensor({
  spellpadAcquired,
  onPromptChange,
  onInteract,
  inputEnabled,
}) {
  const previousRef = useRef('');
  const currentRef = useRef(null);

  const evaluate = useCallback(() => {
    const player = window.__WHA_PLAYER__;
    const position = player?.position ?? PLAYER_START;
    const facing = Number(player?.facing ?? ATELIER_PLAYTHROUGH.spawn.facing);
    const directPhysicsPosition = window.__WHA_PLAYER_PHYSICS__?.getSnapshot?.()?.position;
    const publishedPhysicsPosition = window.__WHA_MAIN_WORLD_PHYSICS__?.player?.position;
    const renderToDirectDelta = directPhysicsPosition && Math.hypot(
      Number(directPhysicsPosition.x) - Number(position.x),
      Number(directPhysicsPosition.z) - Number(position.z),
    );
    const renderToPublishedDelta = publishedPhysicsPosition && Math.hypot(
      Number(publishedPhysicsPosition.x) - Number(position.x),
      Number(publishedPhysicsPosition.z) - Number(position.z),
    );
    const directToPublishedDelta = directPhysicsPosition && publishedPhysicsPosition && Math.hypot(
      Number(directPhysicsPosition.x) - Number(publishedPhysicsPosition.x),
      Number(directPhysicsPosition.z) - Number(publishedPhysicsPosition.z),
    );
    const physicsAligned = Boolean(
      renderToDirectDelta < 0.02
      && renderToPublishedDelta < 0.02
      && directToPublishedDelta < 0.02,
    );
    const targets = [
      {
        kind: 'spellpad',
        surfaceName: 'atelier-writing-desk',
        world: ATELIER_PLAYTHROUGH.writingDesk.world,
        available: !spellpadAcquired,
      },
      {
        kind: 'workshop',
        surfaceName: 'atelier-workshop-desk',
        world: ATELIER_PLAYTHROUGH.workshopDesk.world,
        available: true,
      },
    ];
    const targetStates = targets.map((target) => {
      const dx = target.world.x - Number(position.x ?? PLAYER_START.x);
      const dz = target.world.z - Number(position.z ?? PLAYER_START.z);
      const distance = Math.hypot(dx, dz);
      const facingDot = (
        Math.sin(facing) * dx + Math.cos(facing) * dz
      ) / Math.max(0.001, distance);
      const closeEnough = distance <= (target.kind === 'spellpad' ? 2.25 : 2.35);
      const aiming = facingDot >= 0.42;
      const eligible = Boolean(
        target.available
        && inputEnabled
        && closeEnough
        && aiming
        && physicsAligned,
      );
      const locked = target.kind === 'workshop' && !spellpadAcquired;
      return {
        kind: target.kind,
        surfaceName: target.surfaceName,
        world: { ...target.world },
        distance: round(distance),
        closeEnough,
        aiming,
        physicsAligned,
        eligible,
        locked,
        canInteract: eligible && !locked,
      };
    });
    const visibleTargets = targetStates.filter((target) => target.eligible);
    const interaction = (
      visibleTargets.sort((left, right) => left.distance - right.distance)[0]
      ?? targetStates.filter((target) => (
        target.kind === 'workshop' || !spellpadAcquired
      )).sort((left, right) => left.distance - right.distance)[0]
      ?? null
    );
    currentRef.current = interaction;
    window.__WHA_ATELIER_INTERACTION__ = {
      active: interaction,
      targets: Object.fromEntries(targetStates.map((target) => [target.kind, target])),
    };
    window.__WHA_WORKBENCH_INTERACTION__ = targetStates.find(
      (target) => target.kind === 'workshop',
    );
    const signature = interaction
      ? `${interaction.kind}:${interaction.eligible}:${interaction.locked}:${interaction.closeEnough}:${interaction.aiming}:${spellpadAcquired}`
      : 'none';
    if (signature !== previousRef.current) {
      previousRef.current = signature;
      onPromptChange?.(interaction);
    }
  }, [inputEnabled, onPromptChange, spellpadAcquired]);

  useEffect(() => {
    window.__WHA_ATELIER_PLAYTHROUGH__ = ATELIER_PLAYTHROUGH;
    window.__WHA_EVALUATE_WORKBENCH__ = evaluate;
    window.__WHA_EVALUATE_ATELIER_INTERACTIONS__ = evaluate;
    window.addEventListener('wha-player-state-change', evaluate);
    return () => {
      window.removeEventListener('wha-player-state-change', evaluate);
      if (window.__WHA_EVALUATE_WORKBENCH__ === evaluate) delete window.__WHA_EVALUATE_WORKBENCH__;
      if (window.__WHA_EVALUATE_ATELIER_INTERACTIONS__ === evaluate) {
        delete window.__WHA_EVALUATE_ATELIER_INTERACTIONS__;
      }
      delete window.__WHA_ATELIER_PLAYTHROUGH__;
    };
  }, [evaluate]);

  useEffect(() => {
    const handleInteractionKey = (event) => {
      if (
        event.key.toLowerCase() !== 'e'
        || event.repeat
        || event.defaultPrevented
        || event.metaKey
        || event.ctrlKey
        || event.altKey
        || isEditableEventTarget(event.target)
      ) return;
      const interaction = currentRef.current;
      if (!interaction?.canInteract) return;
      event.preventDefault();
      onInteract?.({
        kind: interaction.kind,
        source: 'keyboard',
        surfaceName: interaction.surfaceName,
      });
    };
    window.addEventListener('keydown', handleInteractionKey);
    return () => window.removeEventListener('keydown', handleInteractionKey);
  }, [onInteract]);

  useFrame(evaluate);

  return null;
}

function playerMovementKey(key, cameraMode) {
  const normalized = key.toLowerCase();
  if (normalized === 'w' || (cameraMode !== 'fc' && normalized === 'arrowup')) return 'north';
  if (normalized === 's' || (cameraMode !== 'fc' && normalized === 'arrowdown')) return 'south';
  if (normalized === 'a' || (cameraMode !== 'fc' && normalized === 'arrowleft')) return 'west';
  if (normalized === 'd' || (cameraMode !== 'fc' && normalized === 'arrowright')) return 'east';
  if (normalized === ' ' || normalized === 'spacebar') return 'jump';
  return null;
}

function freeCameraMovementKey(event) {
  if (event.key === 'ArrowUp') return 'forward';
  if (event.key === 'ArrowDown') return 'back';
  if (event.key === 'ArrowLeft') return 'left';
  if (event.key === 'ArrowRight') return 'right';
  if (event.code === 'Comma') return 'down';
  if (event.code === 'Period') return 'up';
  return null;
}

function isEditableEventTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)
  );
}

function DynamicScene({
  runtimeResult,
  placedSpells,
  sources,
  props,
  selectedAssetId,
  onAssetSelect,
  selectedTool,
  selectedPlacedSpellId,
  onPrimaryToolAction,
  onSurfacePlacement,
  onPlacedSpellSelect,
  onPlacedSpellContextAction,
  timelinePaused,
  weatherMode,
  blockedEarthVisualSpellIds,
  blueprint,
}) {
  const spellScenes = placedSpells.map((spell) => ({
    spell,
    lifecycle: spell.runtimeResult?.lifecycle ?? null,
    circle: spell.runtimeResult?.intents?.find(
      (intent) => intent.intentType === 'spell_circle_render_data',
    ) ?? null,
  }));
  const placedIntents = placedSpells.flatMap((spell) => {
    const placementFrame = spell.runtimeResult?.intents?.find(
      (intent) => intent.intentType === 'spell_circle_render_data',
    )?.placementFrame ?? null;
    const placedWorldScale = Number(
      placementFrame?.worldScale ?? spell.transform?.scale ?? DEFAULT_PLACED_SPELL_SCALE,
    );
    const stoppingEffectIds = new Set(
      (spell.runtimeResult?.intents ?? [])
        .filter((intent) => intent.intentType === 'effect_lifecycle' && intent.operation === 'stop')
        .map((intent) => intent.sourceIntentId),
    );
    return (spell.runtimeResult?.intents ?? []).map((intent) => ({
      ...intent,
      _runtimeIntentId: intent.id,
      id: `${spell.id}:${intent.id}`,
      placedSpellId: spell.id,
      _placementFrame: intent.placementFrame ?? placementFrame,
      _lifecycle: spell.runtimeResult?.lifecycle ?? null,
      _worldScale: placedWorldScale,
      _effectScale: placedWorldScale / DEFAULT_PLACED_SPELL_SCALE,
      _dispersionMinimumRadius: placedSpellDispersionClearanceRadius(placedWorldScale),
      _stopping: stoppingEffectIds.has(intent.id),
    }));
  });
  // Idle placements do not own frame consumers. A render-neutral lifecycle
  // stop keeps the existing consumer mounted just long enough to perform its
  // visual ending phase; it is not treated as a newly active effect.
  const renderablePlacedIntents = placedIntents.filter(
    (intent) => intent.active === true || intent._stopping,
  );
  const waterColumns = renderablePlacedIntents.filter(
    (intent) => intent.intentType === 'water_column',
  );
  const materialColumns = renderablePlacedIntents.filter(
    (intent) => intent.intentType === 'material_column',
  );
  const dispersions = renderablePlacedIntents.filter(
    (intent) => ['water_dispersion', 'material_dispersion'].includes(intent.intentType),
  );
  const illuminations = renderablePlacedIntents.filter((intent) => intent.intentType === 'illumination');
  const levitations = placedIntents.filter(
    (intent) => (intent.active === true || (intent._stopping && intent.materialKind !== 'wind'))
      && intent.intentType === 'force_constraint_debug'
      && intent.registryId === 'sign.levitation',
  );

  return (
    <group name="dynamic-root">
      {spellScenes.map(({ spell, circle, lifecycle }) => (
        <SpellCircle
          key={spell.id}
          spell={spell}
          circle={circle}
          lifecycle={lifecycle}
          selectedTool={selectedTool}
          selected={spell.id === selectedPlacedSpellId}
          onPrimaryToolAction={onPrimaryToolAction}
          onSelect={onPlacedSpellSelect}
          onContextAction={onPlacedSpellContextAction}
        />
      ))}
      <Sources
        sources={sources ?? []}
        selectedTool={selectedTool}
        selectedAssetId={selectedAssetId}
        onAssetSelect={onAssetSelect}
      />
      <Props
        props={props ?? []}
        selectedTool={selectedTool}
        selectedAssetId={selectedAssetId}
        onAssetSelect={onAssetSelect}
        onPrimaryToolAction={onPrimaryToolAction}
        onSurfacePlacement={onSurfacePlacement}
      />
      <MainWorldBlueprint blueprint={blueprint} />
      <SpellIlluminationPresentation owner="main" illuminations={illuminations} />
      <LiveMountedSpellOutputPresentation
        owner="main-mechanics"
        timelinePaused={timelinePaused}
        props={props ?? []}
      />
      <LevitationPresentation intents={levitations} />
      <WaterColumns
        intents={waterColumns}
        lifecycle={null}
        timelinePaused={timelinePaused}
        props={props ?? []}
      />
      <MaterialColumns
        intents={materialColumns}
        blockedEarthVisualSpellIds={blockedEarthVisualSpellIds}
        props={props ?? []}
      />
      <WaterDispersions intents={dispersions.filter((intent) => intent.materialKind === 'water')} />
      <MaterialDispersions intents={dispersions.filter((intent) => intent.materialKind !== 'water')} />
      <Weather weatherMode={weatherMode} />
    </group>
  );
}

function LiveMountedSpellOutputPresentation({ owner, timelinePaused, props }) {
  const [devices, setDevices] = useState([]);
  const snapshotRef = useRef(null);
  useFrame(() => {
    const snapshot = globalThis.window?.__WHA_MAIN_WORLD_PHYSICS__;
    if (!snapshot || snapshot === snapshotRef.current) return;
    snapshotRef.current = snapshot;
    setDevices(snapshot.blueprint?.spellDevices ?? []);
  });
  return (
    <SimSpellOutputPresentation
      owner={owner}
      devices={devices}
      timelinePaused={timelinePaused}
      props={props}
    />
  );
}

const simSpellOutputRegistry = new Map();

export function SimSpellOutputPresentation({
  owner = 'mounted-spells',
  devices = [],
  timelinePaused = false,
  props = [],
}) {
  const intents = devices.flatMap((device) => (device.outputIntents ?? [])
    .filter((intent) => intent.active === true)
    .map((intent) => ({
      ...intent,
      _runtimeIntentId: intent.id,
      id: `${device.deviceId}:${intent.id}`,
      placedSpellId: device.deviceId,
      _placementFrame: intent.placementFrame ?? device.frame ?? null,
      _worldScale: Number(intent.worldScale ?? device.frame?.worldScale ?? 1),
      _effectScale: Number(intent.worldScale ?? device.frame?.worldScale ?? 1),
    })));
  const waterColumns = intents.filter((intent) => intent.intentType === 'water_column');
  const materialColumns = intents.filter((intent) => intent.intentType === 'material_column');
  const dispersions = intents.filter(
    (intent) => ['water_dispersion', 'material_dispersion'].includes(intent.intentType),
  );
  const illuminations = intents.filter((intent) => intent.intentType === 'illumination');
  const levitations = intents.filter(
    (intent) => intent.intentType === 'force_constraint_debug' && intent.registryId === 'sign.levitation',
  );
  useEffect(() => {
    simSpellOutputRegistry.set(owner, {
      owner,
      deviceCount: devices.length,
      activeIntentCount: intents.length,
      intents: intents.map((intent) => ({
        id: intent.id,
        intentType: intent.intentType,
        materialKind: intent.materialKind,
        active: intent.active === true,
      })),
    });
    window.__WHA_SIM_MOUNTED_SPELL_OUTPUTS__ = Object.fromEntries(simSpellOutputRegistry);
    return () => {
      simSpellOutputRegistry.delete(owner);
      window.__WHA_SIM_MOUNTED_SPELL_OUTPUTS__ = Object.fromEntries(simSpellOutputRegistry);
    };
  }, [devices.length, intents, owner]);
  return (
    <group name={`sim-spell-outputs:${owner}`}>
      {illuminations.length > 0 ? (
        <SpellIlluminationPresentation owner={owner} illuminations={illuminations} />
      ) : null}
      {levitations.length > 0 ? <LevitationPresentation intents={levitations} /> : null}
      {waterColumns.length > 0 ? (
        <WaterColumns
          intents={waterColumns}
          lifecycle={null}
          timelinePaused={timelinePaused}
          props={props}
        />
      ) : null}
      {materialColumns.length > 0 ? (
        <MaterialColumns intents={materialColumns} blockedEarthVisualSpellIds={new Set()} props={props} />
      ) : null}
      {dispersions.some((intent) => intent.materialKind === 'water') ? (
        <WaterDispersions intents={dispersions.filter((intent) => intent.materialKind === 'water')} />
      ) : null}
      {dispersions.some((intent) => intent.materialKind !== 'water') ? (
        <MaterialDispersions intents={dispersions.filter((intent) => intent.materialKind !== 'water')} />
      ) : null}
    </group>
  );
}

function MainWorldBlueprint({ blueprint }) {
  if (!blueprint?.document) return null;
  return (
    <group name="main-world-blueprint">
      {(blueprint.document.assemblies ?? []).map((assembly) => (
        <group key={assembly.assemblyId} name={`blueprint:${assembly.assemblyId}`} position={vectorArray(assembly.transform.position)} quaternion={quaternionArray(assembly.transform.rotation)}>
          {(assembly.parts ?? []).map((part) => <BlueprintPart key={part.partId} part={part} />)}
        </group>
      ))}
    </group>
  );
}

function quaternionArray(rotation = {}) {
  return [rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0, rotation.w ?? 1];
}

function BlueprintPart({ part }) {
  const color = materialProfile(part.materialId).color;
  const geometry = part.shape === 'sphere'
    ? <sphereGeometry args={[Math.max(part.size.x, part.size.y, part.size.z) / 2, 16, 12]} />
    : (part.shape === 'cylinder' || part.shape === 'wheel' || part.shape === 'shaft' || part.shape === 'cogwheel')
      ? <cylinderGeometry args={[part.size.x / 2, part.size.x / 2, part.size.y, 16]} />
      : <boxGeometry args={[part.size.x, part.size.y, part.size.z]} />;
  return <mesh castShadow receiveShadow position={vectorArray(part.localTransform.position)} quaternion={quaternionArray(part.localTransform.rotation)}>{geometry}<meshStandardMaterial color={color} roughness={.7} /></mesh>;
}

function SpellCircle({
  spell,
  circle,
  lifecycle,
  selectedTool,
  selected,
  onPrimaryToolAction,
  onSelect,
  onContextAction,
}) {
  const [hovered, setHovered] = useState(false);
  if (!circle?.active || !circle.seals?.[0]) return null;
  const seal = circle.seals[0];
  const frame = normalizeFrame(circle.placementFrame);
  const worldScale = clamp(
    Number(circle.placementFrame?.worldScale ?? spell.transform?.scale ?? MIN_PLACED_SPELL_SCALE),
    MIN_PLACED_SPELL_SCALE,
    4,
  );
  const maxRadius = Math.max(
    120,
    ...seal.rings.map((ring) => ring.radius || 0),
    ...seal.symbols.map((symbol) => symbol.polarRadius || Math.hypot(symbol.position.x, symbol.position.y)),
  );
  const scale = NORMALIZED_SPELL_CIRCLE_RADIUS / maxRadius;
  const active = lifecycle?.active === true;
  return (
    <group
      name={`placed-spell:${spell.id}`}
      userData={{ placedSpellId: spell.id }}
      position={vectorArray(frame.origin)}
      quaternion={quaternionFromFrame(frame.normal, frame.tangent)}
      scale={[worldScale, worldScale, worldScale]}
    >
      <group>
      <mesh
        name={`spell-note:${spell.id}`}
        position={[0, 0.012, 0]}
        onPointerOver={(event) => {
          if (selectedTool !== 'wrench') return;
          event.stopPropagation();
          setHovered(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = '';
        }}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[NORMALIZED_PLACED_SPELL_NOTE_SIDE, 0.028, NORMALIZED_PLACED_SPELL_NOTE_SIDE]} />
        <meshStandardMaterial
          color={selected || hovered ? '#fff0a8' : '#f5e8a8'}
          emissive={active ? '#416d50' : '#000000'}
          emissiveIntensity={active ? 0.22 : 0}
          roughness={0.92}
        />
      </mesh>
      {[
        [0, 0.034, -1.39, 2.78, 0.035],
        [0, 0.034, 1.39, 2.78, 0.035],
        [-1.39, 0.034, 0, 0.035, 2.78],
        [1.39, 0.034, 0, 0.035, 2.78],
      ].map(([x, y, z, width, depth], index) => (
        <mesh key={index} name={`spell-note-edge:${spell.id}:${index}`} position={[x, y, z]}>
          <boxGeometry args={[width, 0.018, depth]} />
          <meshStandardMaterial color="#8f7940" roughness={0.9} />
        </mesh>
      ))}
      <mesh name={`spell-note-fold:${spell.id}`} position={[1.18, 0.04, -1.18]} rotation={[0, Math.PI / 4, 0]}>
        <boxGeometry args={[0.25, 0.018, 0.25]} />
        <meshStandardMaterial color="#dfcf86" roughness={0.95} />
      </mesh>
      {(seal.rings.length > 0 ? seal.rings : [{ ringId: 'fallback', radius: 120 }]).map((ring) => {
        const radius = Math.max(
          NORMALIZED_SPELL_CIRCLE_RADIUS,
          (ring.radius || maxRadius * 0.55) * scale,
        );
        return (
          <mesh key={ring.ringId} name={`spell-ring:${spell.id}:${ring.ringId}`} position={[0, 0.045, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[radius, 0.009, 8, 96]} />
            <meshStandardMaterial color="#1f4938" roughness={0.78} />
          </mesh>
        );
      })}
      {seal.symbols.map((symbol) => {
        const nativeSignLayout = symbol.categoryHint === 'sign'
          ? resolveNativeSignLayout({
              containingRingRadius: 100,
              signAnchor: anchorForPolarAngle(symbol.polarAngleDeg),
              facingDeg: symbol.facingDeg ?? symbol.angleDeg ?? 0,
              glyphId: symbol.registryId,
              size: symbol.size,
              centerClearance: 24,
              radialDistance: symbol.nativeLayoutMode === 'fixed' ? symbol.polarRadius : undefined,
              fitMode: symbol.nativeLayoutMode,
            })
          : null;
        const positionedSymbol = nativeSignLayout
          ? { ...symbol, nativeSignLayout, nativeUnitScale: scale }
          : symbol;
        const pos = nativeSignLayout
          ? { x: nativeSignLayout.placement.x * scale, z: -nativeSignLayout.placement.y * scale }
          : symbolPosition(symbol, scale);
        const isSigil = symbol.categoryHint === 'sigil';
        const usesLoreGlyph = glyphRenderPolicy(symbol.registryId) === 'lore_glyph';
        return (
          <group key={symbol.objectId} name={`symbol-group:${spell.id}:${symbol.objectId}`} position={[pos.x, 0, pos.z]}>
            {usesLoreGlyph ? (
              <ThreeLoreGlyph symbol={positionedSymbol} color={isSigil ? '#28664d' : '#173f31'} />
            ) : (
              <>
                <mesh name={`symbol:${spell.id}:${symbol.objectId}`} position={[0, 0.06, 0]}>
                  <cylinderGeometry args={[isSigil ? 0.12 : 0.08, isSigil ? 0.12 : 0.08, 0.025, 28]} />
                  <meshStandardMaterial color={isSigil ? '#337d5e' : '#1a382e'} roughness={0.74} />
                </mesh>
                <SpriteLabel name={`label:${spell.id}:${symbol.objectId}`} text={symbol.label} position={[0, 0.42, 0]} color="#173328" />
              </>
            )}
          </group>
        );
      })}
      </group>
    </group>
  );
}

function SpellRemote({ circle, lifecycle, onRemoteToggle }) {
  if (!lifecycle || !circle?.placementFrame) return null;
  const frame = normalizeFrame(circle.placementFrame);
  const origin = toVector3(frame.origin);
  const normal = toSceneAxis(frame.normal);
  const tangent = toSceneAxis(frame.tangent);
  const bitangent = toSceneAxis(frame.bitangent);
  const position = origin
    .clone()
    .add(tangent.clone().multiplyScalar(-1.18))
    .add(bitangent.clone().multiplyScalar(-0.86))
    .add(normal.clone().multiplyScalar(0.1));
  const stateColor = lifecycle.active ? '#75db7a' : '#943829';
  const progress =
    lifecycle.mode === 'timed'
      ? clamp(lifecycle.elapsedMs / Math.max(1, lifecycle.durationMs), 0, 1)
      : lifecycle.active
        ? 0
        : 1;
  const angle = -Math.PI / 2 + progress * Math.PI * 2;
  const toggle = (event) => {
    event.stopPropagation();
    window.__WHA_REMOTE_PICK_COUNT__ = (window.__WHA_REMOTE_PICK_COUNT__ ?? 0) + 1;
    onRemoteToggle?.();
  };

  return (
    <group name="spell-remote-root" position={position} quaternion={quaternionFromUp(normal)}>
      <mesh name="spell-remote-body" position={[0, 0.08, 0]} onClick={toggle}>
        <cylinderGeometry args={[0.23, 0.17, 0.16, 28]} />
        <meshStandardMaterial color="#2e382e" roughness={0.7} />
      </mesh>
      <mesh name="spell-remote-socket" position={[0, 0.18, 0]} rotation={[Math.PI / 2, 0, 0]} onClick={toggle}>
        <torusGeometry args={[0.19, 0.0125, 8, 32]} />
        <meshStandardMaterial color="#7a8f78" roughness={0.7} />
      </mesh>
      <mesh name="spell-remote-hit-area" position={[0, 0.36, 0]} onClick={toggle}>
        <sphereGeometry args={[0.45, 18, 10]} />
        <meshStandardMaterial color={stateColor} transparent opacity={0.07} depthWrite={false} />
      </mesh>
      <mesh name={`spell-remote-state:${lifecycle.phase}`} position={[0, 0.32, 0]} onClick={toggle}>
        <sphereGeometry args={[0.09, 18, 10]} />
        <meshStandardMaterial color={stateColor} emissive={stateColor} emissiveIntensity={0.8} />
      </mesh>
      <mesh name={`spell-remote-timer:${lifecycle.phase}`} position={[0, 0.03, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.29, 0.006, 8, 48]} />
        <meshStandardMaterial color={stateColor} transparent opacity={0.78} />
      </mesh>
      <mesh
        name={`spell-remote-progress:${lifecycle.phase}`}
        position={[Math.cos(angle) * 0.29, 0.045, Math.sin(angle) * 0.29]}
        rotation={[0, -angle, 0]}
      >
        <boxGeometry args={[0.05, 0.035, 0.1]} />
        <meshStandardMaterial color={stateColor} />
      </mesh>
    </group>
  );
}

function Sources({ sources, selectedTool, selectedAssetId, onAssetSelect }) {
  return (
    <group name="scene-sources">
      {sources.map((source) => (
        <Source
          key={source.id}
          source={source}
          selectedTool={selectedTool}
          selected={selectedAssetId === source.id}
          onAssetSelect={onAssetSelect}
        />
      ))}
    </group>
  );
}

function Source({ source, selectedTool, selected, onAssetSelect }) {
  const fillRatio = source.nonDepleting
    ? 1
    : clamp((source.amount ?? 0) / Math.max(1, source.capacity ?? 1), 0, 1);
  const position = vectorArray(source.position, 0.09);
  const assetProps = {
    userData: { sceneAsset: { type: 'source', id: source.id } },
  };

  if (source.kind === 'water') {
    const mist = source.materialState === 'mist_cloud';
    if (mist) {
      return (
        <group name={`mist-source:${source.id}`} position={position} {...assetProps}>
          <mesh name={`source:${source.id}`}>
            <cylinderGeometry args={[0.36, 0.36, 0.18, 32]} />
            <meshStandardMaterial color="#809e99" transparent opacity={0.34} />
          </mesh>
          {Array.from({ length: 9 }, (_, index) => {
            const angle = (Math.PI * 2 * index) / 9;
            const radius = index === 0 ? 0 : 0.18 + (index % 3) * 0.09;
            return (
              <mesh
                key={index}
                name={`mist-source-puff:${source.id}:${index}`}
                position={[
                  Math.cos(angle) * radius,
                  0.18 + (index % 4) * 0.08 + fillRatio * 0.1,
                  Math.sin(angle) * radius,
                ]}
              >
                <sphereGeometry args={[(0.11 + (index % 3) * 0.035) * (0.65 + fillRatio * 0.65), 16, 8]} />
                <meshStandardMaterial color="#a8c7d1" transparent opacity={0.36} />
              </mesh>
            );
          })}
        </group>
      );
    }

    // A low, hand-built practice basin. It is deliberately wider than it is
    // tall, so it reads as a source of water from the normal orbit camera
    // rather than as another scene marker. Canonical source/rim/level names
    // are preserved for the scene inspector and interaction tests.
    return (
      <group name={`water-basin:${source.id}`} position={position} {...assetProps}>
        {/* Broad, slightly irregular plinth keeps the small object grounded. */}
        <mesh name={`water-basin-foot:${source.id}`} position={[0, 0.035, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.52, 0.47, 0.09, 10]} />
          <meshStandardMaterial color="#4c564d" roughness={0.94} flatShading />
        </mesh>
        <mesh position={[0, 0.095, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.42, 0.48, 0.05, 10]} />
          <meshStandardMaterial color="#687267" roughness={0.9} flatShading />
        </mesh>
        {/* Narrow pedestal: it makes a filled basin legible above grass. */}
        <mesh name={`water-basin-pedestal:${source.id}`} position={[0, 0.19, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.2, 0.28, 0.22, 10]} />
          <meshStandardMaterial color="#586359" roughness={0.92} flatShading />
        </mesh>
        <mesh position={[0, 0.295, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.31, 0.2, 0.045, 10]} />
          <meshStandardMaterial color="#718071" roughness={0.88} flatShading />
        </mesh>
        {/* The bowl is flared like a real vessel instead of a solid cylinder. */}
        <mesh name={`source:${source.id}`} position={[0, 0.38, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.5, 0.31, 0.2, 32, 1, true]} />
          <meshStandardMaterial color="#667367" roughness={0.86} flatShading />
        </mesh>
        {/* The dark inner wall creates a genuine-looking cavity around the water. */}
        <mesh name={`water-basin-cavity:${source.id}`} position={[0, 0.415, 0]}>
          <cylinderGeometry args={[0.405, 0.275, 0.19, 32, 1, true]} />
          <meshStandardMaterial color="#263a36" roughness={0.98} side={THREE.BackSide} />
        </mesh>
        {/* Six inset bronze markers make the vessel feel authored without obscuring it. */}
        {Array.from({ length: 6 }, (_, index) => {
          const angle = (Math.PI * 2 * index) / 6 + Math.PI / 6;
          return (
            <mesh
              key={index}
              name={`water-basin-marker:${source.id}:${index}`}
              position={[Math.cos(angle) * 0.465, 0.405, Math.sin(angle) * 0.465]}
              rotation={[0, -angle, 0]}
            >
              <sphereGeometry args={[0.026, 10, 8]} />
              <meshStandardMaterial color="#a08048" roughness={0.56} metalness={0.5} />
            </mesh>
          );
        })}
        {/* A warm metal band picks the rim out from the cool stone. */}
        <mesh name={`water-basin-rim:${source.id}`} position={[0, 0.486, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.48, 0.043, 10, 32]} />
          <meshStandardMaterial color="#8e7545" roughness={0.46} metalness={0.52} flatShading />
        </mesh>
        <WaterBasinSurface sourceId={source.id} fillRatio={fillRatio} />
      </group>
    );
  }

  return (
    <group name={`source:${source.id}`} position={position} {...assetProps}>
      <mesh>
        <cylinderGeometry args={[0.36, 0.36, 0.18, 32]} />
        <meshStandardMaterial color={source.kind === 'fire' ? '#772f1a' : '#716a54'} roughness={0.8} />
      </mesh>
    </group>
  );
}

function WaterBasinSurface({ sourceId, fillRatio }) {
  const waterRef = useRef(null);
  const surfaceY = 0.353 + fillRatio * 0.105;
  const surfaceScale = 0.7 + fillRatio * 0.3;

  useFrame(({ clock }) => {
    if (!waterRef.current) return;
    const elapsed = clock.getElapsedTime();
    waterRef.current.rotation.y = elapsed * 0.055;
    waterRef.current.position.y = surfaceY + Math.sin(elapsed * 1.35) * 0.003;
  });

  return (
    <group ref={waterRef} position={[0, surfaceY, 0]} scale={[surfaceScale, 1, surfaceScale]}>
      <mesh name={`water-basin-level:${sourceId}`}>
        <cylinderGeometry args={[0.395, 0.395, 0.025, 40]} />
        <meshPhysicalMaterial
          color="#249cc1"
          roughness={0.12}
          metalness={0.05}
          clearcoat={0.8}
          clearcoatRoughness={0.16}
          transmission={0.18}
          transparent
          opacity={0.9}
        />
      </mesh>
      <mesh name={`water-basin-ripple:${sourceId}:outer`} position={[0, 0.015, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.28, 0.006, 5, 40]} />
        <meshStandardMaterial color="#b6f2ef" emissive="#4eacc4" emissiveIntensity={0.45} transparent opacity={0.48} />
      </mesh>
      <mesh name={`water-basin-ripple:${sourceId}:inner`} position={[0, 0.018, 0]} rotation={[Math.PI / 2, 0.8, 0]}>
        <torusGeometry args={[0.13, 0.004, 5, 32]} />
        <meshStandardMaterial color="#d5ffff" emissive="#70bed1" emissiveIntensity={0.35} transparent opacity={0.42} />
      </mesh>
    </group>
  );
}

function Props({ props, selectedTool, selectedAssetId, onAssetSelect, onPrimaryToolAction, onSurfacePlacement }) {
  return (
    <group name="scene-props">
      {props.map((prop) => (
        <Prop
          key={prop.id}
          prop={prop}
          selectedTool={selectedTool}
          selected={selectedAssetId === prop.id}
          onAssetSelect={onAssetSelect}
          onPrimaryToolAction={onPrimaryToolAction}
          onSurfacePlacement={onSurfacePlacement}
        />
      ))}
    </group>
  );
}

function Prop({ prop, selectedTool, selected, onAssetSelect, onPrimaryToolAction, onSurfacePlacement }) {
  const dimensions = mainWorldPropDimensions(prop);
  const visualSize = dimensions.x;
  const position = vectorArray(prop.position, mainWorldPropCenterOffset(prop));
  const rotation = quaternionArray(prop.rotation);
  const scale = vectorArray(
    typeof prop.scale === 'number'
      ? { x: prop.scale, y: prop.scale, z: prop.scale }
      : (prop.scale ?? { x: 1, y: 1, z: 1 }),
  );
  const interactionProps = surfaceInteractionProps({
    surface: {
      id: `prop:${prop.id}`,
      kind: 'prop',
      targetId: prop.id,
      label: prop.label ?? prop.id,
      mountBodyId: `prop:${prop.id}`,
    },
    selectedTool,
    onPrimaryToolAction,
    onSurfacePlacement,
    onAssetSelect,
    selected,
  });

  // The practice tree is a real planted landmark: render the styled tree rooted
  // on the ground (y = 0) rather than the placeholder floating box.
  if (prop.visualKind === 'tree_landmark') {
    return (
      <group name={`prop:${prop.id}`} position={vectorArray(prop.position, 0)} {...interactionProps}>
        <Tree position={[0, 0, 0]} />
      </group>
    );
  }

  if (prop.visualKind === 'tree_apple') {
    return (
      <group name={`prop:${prop.id}`} position={position} quaternion={rotation} scale={scale} {...interactionProps}>
        <mesh name={`prop-apple:${prop.id}`}>
          <sphereGeometry args={[visualSize * 0.5, 18, 12]} />
          <meshStandardMaterial color="#b83b2d" roughness={0.55} />
        </mesh>
        <mesh name={`prop-apple-stem:${prop.id}`} position={[0, visualSize * 0.52, 0]}>
          <cylinderGeometry args={[0.015, 0.02, 0.12, 8]} />
          <meshStandardMaterial color="#472912" />
        </mesh>
      </group>
    );
  }

  return (
    <group name={`prop:${prop.id}`} position={position} quaternion={rotation} scale={scale} {...interactionProps}>
      <mesh name={`prop-box:${prop.id}`} castShadow>
        <boxGeometry args={[dimensions.x, dimensions.y, dimensions.z]} />
        <meshStandardMaterial
          color={prop.visualKind === 'activation_ring_key'
            ? '#665b42'
            : prop.visualKind === 'practice_crate'
              ? '#875c33'
              : '#8b6a43'}
          roughness={prop.visualKind === 'practice_crate' ? 0.88 : 0.72}
        />
      </mesh>
    </group>
  );
}

function WaterColumns({ intents, lifecycle, timelinePaused, props }) {
  const physicsInterceptions = usePhysicsColumnInterceptions(intents);
  const collisionBoxes = useMemo(
    () => (props ?? [])
      .filter((prop) => prop.visualKind !== 'activation_ring_key')
      .map((prop) => {
        const bounds = propContactBounds(prop);
        return {
          id: prop.id,
          surface: `prop:${prop.id}`,
          min: bounds.center.clone().sub(bounds.half),
          max: bounds.center.clone().add(bounds.half),
        };
      }),
    [props],
  );

  useEffect(() => {
    if (intents.length === 0) {
      window.__WHA_WATER_SIM_DEBUG__ = [];
      window.__WHA_MAIN_WATER_COLUMNS__ = {};
    }
  }, [intents.length]);

  return (
    <group name="three-water-columns">
      {intents.flatMap((intent) => {
        const dir = intent.sceneAxis ? toSceneAxis(intent.sceneAxis) : mapAxis(intent.axis);
        const placedWorldScale = clamp(
          Number(intent._worldScale ?? MIN_PLACED_SPELL_SCALE),
          MIN_PLACED_SPELL_SCALE,
          4,
        );
        const worldThicknessRingRadius = worldThicknessRadiusForIntent(intent);
        // The compiler owns the physical/output length. Rendering that exact
        // value prevents an invisible force tube from extending past the tip.
        const height = Number(intent.physicsField?.length ?? (
          Math.min(
            2.35,
            Math.max(0.9, intent.magnitude * 0.34 * Math.max(0.35, intent.signSizeScale ?? 1) + 0.78),
          ) * (intent.columnHeightMultiplier ?? 3) * placedWorldScale
        ));
        const radius = Math.max(0.08, worldThicknessRingRadius * (intent.columnRadiusRatio ?? 0.7)) * placedWorldScale;
        return columnRenderPlans(intent, { x: 0, y: 0.22, z: 0 }).map((plan) => {
          const planRadius = radius * plan.radiusScale;
          const key = `${intent.id}${plan.nameSuffix}`;
          if (intent.renderPreset === 'mist_cloud' || intent.renderPreset === 'ice_chunk') {
            return (
              <group key={key} name={`spell-output:${key}`}>
              <NonLiquidWaterColumn
                intent={intent}
                origin={plan.origin}
                dir={dir}
                height={height}
                radius={planRadius}
                plan={plan}
              />
              </group>
            );
          }
          return (
            <group key={key} name={`spell-output:${key}`}>
              <PromotedWaterColumnEffect
                effectId={key}
                origin={plan.origin}
                direction={dir}
                baseRadius={Math.max(0.14 * placedWorldScale, planRadius)}
                groundY={0}
                collisionBoxes={[
                  ...collisionBoxes,
                  ...(physicsInterceptions[intent.id] ? [physicsInterceptions[intent.id]] : []),
                ]}
                active={intent.active === true}
                showLabContext={false}
                settings={{
                  ...WATER_COLUMN_RUNTIME_SETTINGS,
                  spellLength: height,
                  projectedExitVelocity:
                    WATER_COLUMN_RUNTIME_SETTINGS.projectedExitVelocity *
                    Math.sqrt(placedWorldScale),
                }}
              />
            </group>
          );
        });
      })}
    </group>
  );
}

const MAX_LOCAL_ILLUMINATION_LIGHTS = 8;
const illuminationRegistry = new Map();

export function SpellIlluminationPresentation({ owner = 'scene', illuminations = [] }) {
  const entries = useMemo(
    () => illuminations
      .filter((intent) => intent?.intentType === 'illumination')
      .filter((intent) => intent.active === true && intent.materialKind === 'light')
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .slice(0, MAX_LOCAL_ILLUMINATION_LIGHTS),
    [illuminations],
  );

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__WHA_LOCAL_ILLUMINATION_INPUT__ = illuminations.map((intent) => ({
        id: intent.id,
        sourceIntentId: intent.sourceIntentId ?? null,
        materialKind: intent.materialKind ?? null,
        active: intent.active === true,
        origin: intent.emitterOrigin ?? intent.origin ?? null,
      }));
    }
    const prefix = `${owner}:`;
    const currentIds = new Set(entries.map((entry) => `${prefix}${entry.id}`));
    for (const id of [...illuminationRegistry.keys()]) {
      if (id.startsWith(prefix) && !currentIds.has(id)) illuminationRegistry.delete(id);
    }
    for (const entry of entries) {
      illuminationRegistry.set(`${prefix}${entry.id}`, illuminationDebugEntry(entry, owner));
    }
    publishIlluminationDebug();
    return () => {
      for (const id of currentIds) illuminationRegistry.delete(id);
      publishIlluminationDebug();
    };
  }, [entries, illuminations, owner]);

  return (
    <group name={`spell-illumination:${owner}`}>
      {entries.map((entry) => (
        <SpellIlluminationEmitter key={entry.id} entry={entry} />
      ))}
    </group>
  );
}

function SpellIlluminationEmitter({ entry }) {
  const { scene } = useThree();
  const origin = entry.emitterOrigin ?? entry.origin ?? { x: 0, y: 0, z: 0 };
  const reach = clamp(Number(entry.reach ?? 1), 0.7, ILLUMINATION_MAX_REACH);
  // Rendered candela: the intent's abstract intensity is tuned for the
  // debug falloff model; three's physical point lights need more punch
  // for the glow to read against a lit scene.
  const intensity = clamp(Number(entry.intensity ?? 0), 0, ILLUMINATION_MAX_INTENSITY) * 2.4;
  const bounce = illuminationBounceOrigin(entry, origin, reach);
  // Occlusion probe: a sparse sphere of rays cast against the scene a few
  // times a second. Directions where a ray escapes are openings light can
  // actually take; blocked directions are walls it must not pass through.
  const [probe, setProbe] = useState(null);
  const probeState = useRef({ cooldown: 0, origin: new THREE.Vector3(Infinity, 0, 0) });
  useFrame((_, delta) => {
    const state = probeState.current;
    state.cooldown -= delta;
    const position = new THREE.Vector3(origin.x ?? 0, origin.y ?? 0, origin.z ?? 0);
    // Re-probe promptly when the emitter itself moves; otherwise only on a
    // slow heartbeat to catch other scenery shifting around it.
    const moved = position.distanceToSquared(state.origin) > 0.0016;
    // A moving emitter refreshes at ~7Hz; a static one on a slow heartbeat.
    if (state.cooldown > (moved ? ILLUMINATION_PROBE_INTERVAL - 0.15 : 0)) return;
    state.cooldown = ILLUMINATION_PROBE_INTERVAL;
    state.origin.copy(position);
    const result = probeIlluminationOcclusion(scene, position, reach * 2);
    // Keep the previous probe object when nothing meaningfully changed so
    // downstream memoization holds and the lights aren't rebuilt.
    setProbe((previous) =>
      previous && !moved && Math.abs(previous.openness - result.openness) < 0.02
        ? previous
        : result,
    );
  });
  const openness = probe?.openness ?? 1;
  // Mostly-open emitters keep one omnidirectional leak halo. Enclosed ones
  // get spill lights only where the probe says light can get out — through
  // openings or thin material — placed just past the exit surface so the
  // seep hugs seams and walls instead of passing through thick barriers.
  const clusters = useMemo(
    () => (probe == null || probe.openness >= 0.5 ? null : clusterEscapeSamples(probe.samples)),
    [probe],
  );
  const spills = clusters == null
    ? [{ x: origin.x ?? 0, y: origin.y ?? 0, z: origin.z ?? 0, weight: 1 }]
    : clusters.map((cluster) => ({
        x: (origin.x ?? 0) + cluster.direction.x * cluster.exitDistance,
        y: (origin.y ?? 0) + cluster.direction.y * cluster.exitDistance,
        z: (origin.z ?? 0) + cluster.direction.z * cluster.exitDistance,
        weight: cluster.weight,
      }));
  // Any transmission at all keeps the total seep near full strength (an
  // enclosure's worth of light escaping through what openings exist); a
  // genuinely sealed thick enclosure fades to nothing outside.
  const spillScale = probe == null || openness >= 0.5 ? 1 : Math.min(1, openness * 8);
  return (
    <group>
      {/* Occlusion-aware direct term: a shadow-casting point light, so
          geometry blocks the glow and it escapes only through openings. */}
      <pointLight
        name={`local-light:${entry.id}`}
        position={[origin.x ?? 0, origin.y ?? 0, origin.z ?? 0]}
        color={entry.color ?? LIGHT_MAGIC.illumination}
        intensity={intensity * 3}
        distance={reach}
        decay={2}
        castShadow
        shadow-mapSize-width={256}
        shadow-mapSize-height={256}
        shadow-bias={-0.006}
        shadow-radius={4}
        shadow-camera-near={0.05}
        shadow-camera-far={reach}
      />
      {/* One-bounce approximation: a dim, wide, unshadowed fill pushed
          along the emission direction toward the first lit surface. Scaled
          by openness so an enclosed emitter's bounce stays inside. */}
      <pointLight
        name={`local-light-bounce:${entry.id}`}
        position={[bounce.x, bounce.y, bounce.z]}
        color={entry.color ?? LIGHT_MAGIC.illumination}
        intensity={intensity * 0.35 * (0.25 + 0.75 * openness)}
        distance={reach * 1.6}
        decay={2}
        castShadow={false}
      />
      {/* Multi-bounce leak, placed where light can really get out. Reaches
          past `reach` on purpose: diffuse leak-out has to clear enclosure
          walls to land on the surrounding floor and rims. A fully sealed
          emitter (no escaped rays) renders no leak at all. */}
      {spills.map((spill, index) => (
        <pointLight
          key={index}
          name={`local-light-leak:${entry.id}:${index}`}
          position={[spill.x, spill.y, spill.z]}
          color={entry.color ?? LIGHT_MAGIC.illumination}
          intensity={intensity * 7 * 0.85 * spill.weight * spillScale}
          distance={reach * 2.4}
          decay={2}
          castShadow={false}
        />
      ))}
      {/* Visible glow volume: additive, depth-TESTED shells standing in
          for in-air scatter. Because they depth-test against geometry,
          an enclosed emitter's glow is hidden by the walls and beams out
          only through real openings and seams. */}
      {ILLUMINATION_GLOW_SHELLS.map(([shellRadius, shellOpacity]) => (
        <mesh
          key={shellRadius}
          name={`local-light-glow:${entry.id}:${shellRadius}`}
          position={[origin.x ?? 0, origin.y ?? 0, origin.z ?? 0]}
          renderOrder={3}
        >
          <sphereGeometry args={[reach * shellRadius, 24, 18]} />
          <meshBasicMaterial
            color={entry.color ?? LIGHT_MAGIC.illumination}
            transparent
            opacity={shellOpacity * Math.min(1, intensity)}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

const ILLUMINATION_PROBE_INTERVAL = 1.5;

// Fibonacci-sphere probe directions: even coverage with few rays.
const ILLUMINATION_PROBE_DIRECTIONS = (() => {
  const directions = [];
  const count = 64;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let index = 0; index < count; index += 1) {
    const y = 1 - (2 * index + 1) / count;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = golden * index;
    directions.push(new THREE.Vector3(Math.cos(angle) * ring, y, Math.sin(angle) * ring));
  }
  return directions;
})();

const illuminationProbeRaycaster = new THREE.Raycaster();

// How quickly material eats light: transmission = exp(-thickness / TAU).
// A 6cm stick passes ~60%, a 22cm plank ~16%, a 60cm stone block ~0.7%.
const ILLUMINATION_TRANSMISSION_TAU = 0.12;

// Per-direction transmission by measuring how much solid material the ray
// crosses. Front faces seen from the origin are entries; front faces seen
// from the far end (a reversed cast) are exits. Pairing them in order gives
// the traversed thickness even across several separate walls.
function probeIlluminationOcclusion(scene, origin, far) {
  // One traversal up front: only solid, shadow-relevant meshes block light —
  // sensor wireframes, ghosts, glow shells, grid lines, and marker sprites
  // are all see-through, and raycasting them (especially the grid helper's
  // line segments) is what makes whole-scene casts expensive.
  const solids = [];
  scene.traverse((object) => {
    if (
      object.isMesh === true &&
      (object.castShadow === true || object.receiveShadow === true) &&
      !String(object.name ?? '').startsWith('local-light-glow')
    ) {
      solids.push(object);
    }
  });
  illuminationProbeRaycaster.far = far;
  const samples = [];
  let totalTransmission = 0;
  const farPoint = new THREE.Vector3();
  const reverse = new THREE.Vector3();
  for (const direction of ILLUMINATION_PROBE_DIRECTIONS) {
    illuminationProbeRaycaster.set(origin, direction);
    const entries = illuminationProbeRaycaster
      .intersectObjects(solids, false)
      .map((hit) => hit.distance);
    let transmission = 1;
    let exitDistance = 0.2;
    if (entries.length > 0) {
      farPoint.copy(direction).multiplyScalar(far).add(origin);
      reverse.copy(direction).negate();
      illuminationProbeRaycaster.set(farPoint, reverse);
      const exits = illuminationProbeRaycaster
        .intersectObjects(solids, false)
        .map((hit) => far - hit.distance)
        .sort((a, b) => a - b);
      let thickness = 0;
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        const exit = exits.find((value) => value > entry) ?? far;
        thickness += Math.max(0, exit - entry);
      }
      transmission = Math.exp(-thickness / ILLUMINATION_TRANSMISSION_TAU);
      exitDistance = Math.min(far * 0.9, (exits[exits.length - 1] ?? entries[0]) + 0.15);
    }
    samples.push({ direction, transmission, exitDistance });
    totalTransmission += transmission;
  }
  return { samples, openness: totalTransmission / samples.length };
}

// Greedy direction clustering: group transmitting rays into at most three
// cones so each opening (a seam ring, a doorway, a slit) gets one spill
// light, weighted by how much light its directions let through.
function clusterEscapeSamples(samples, maxClusters = 3) {
  const pool = samples.filter((sample) => sample.transmission > 0.05);
  const clusters = [];
  while (pool.length > 0 && clusters.length < maxClusters) {
    let seedIndex = 0;
    let seedWeight = -1;
    for (let index = 0; index < pool.length; index += 1) {
      let weight = 0;
      for (const other of pool) {
        if (other.direction.dot(pool[index].direction) > 0.55) weight += other.transmission;
      }
      if (weight > seedWeight) {
        seedWeight = weight;
        seedIndex = index;
      }
    }
    const seed = pool[seedIndex];
    const members = pool.filter((sample) => sample.direction.dot(seed.direction) > 0.55);
    const centroid = new THREE.Vector3();
    let weight = 0;
    let exitDistance = 0;
    for (const member of members) {
      centroid.addScaledVector(member.direction, member.transmission);
      exitDistance += member.exitDistance * member.transmission;
      weight += member.transmission;
    }
    centroid.normalize();
    clusters.push({
      direction: centroid,
      weight,
      exitDistance: weight > 0 ? exitDistance / weight : 0.2,
    });
    for (const member of members) pool.splice(pool.indexOf(member), 1);
  }
  const total = clusters.reduce((sum, cluster) => sum + cluster.weight, 0) || 1;
  return clusters.map((cluster) => ({ ...cluster, weight: cluster.weight / total }));
}

const ILLUMINATION_MAX_REACH = 9;
const ILLUMINATION_MAX_INTENSITY = 2.6;
// [fraction of reach, base opacity] per additive shell: a bright core with two
// wider, fainter halos fakes the falloff of light scattering in air.
const ILLUMINATION_GLOW_SHELLS = [
  [0.12, 0.5],
  [0.3, 0.22],
  [0.62, 0.09],
];

// Where the emitter's beam first lands, roughly: half the reach along the
// emission direction (falling back to the placement normal). The bounce fill
// lives there so indirect spill originates at the lit surface, not the plate.
function illuminationBounceOrigin(entry, origin, reach) {
  const raw = entry.direction ?? entry.normal ?? entry.placementFrame?.normal ?? { x: 0, y: 1, z: 0 };
  const length = Math.hypot(raw.x ?? 0, raw.y ?? 0, raw.z ?? 0) || 1;
  const step = reach * 0.5;
  return {
    x: (origin.x ?? 0) + ((raw.x ?? 0) / length) * step,
    y: (origin.y ?? 0) + ((raw.y ?? 0) / length) * step,
    z: (origin.z ?? 0) + ((raw.z ?? 0) / length) * step,
  };
}

function illuminationDebugEntry(entry, owner) {
  const origin = entry.emitterOrigin ?? entry.origin ?? { x: 0, y: 0, z: 0 };
  const reach = clamp(Number(entry.reach ?? 1), 0.7, ILLUMINATION_MAX_REACH);
  const intensity = clamp(Number(entry.intensity ?? 0), 0, ILLUMINATION_MAX_INTENSITY);
  const falloff = (distance) => round(intensity / (1 + (distance / reach) ** 2));
  return {
    id: entry.id,
    owner,
    sourceIntentId: entry.sourceIntentId ?? null,
    materialKind: entry.materialKind,
    active: true,
    origin: vectorDebug(origin),
    normal: vectorDebug(entry.normal ?? entry.placementFrame?.normal),
    direction: vectorDebug(entry.direction),
    radius: round(Number(entry.radius ?? 0)),
    reach: round(reach),
    color: entry.color ?? LIGHT_MAGIC.illumination,
    intensity: round(intensity),
    worldScale: round(Number(entry.worldScale ?? 1)),
    neighboringSurfaceSamples: {
      near: falloff(Math.max(0.18, Number(entry.radius ?? 0.2))),
      edge: falloff(reach * 0.78),
    },
  };
}

const levitationVisualRegistry = new Map();

function publishLevitationVisuals() {
  if (typeof window === 'undefined') return;
  window.__WHA_LEVITATION_VISUALS__ = [...levitationVisualRegistry.values()];
}

function levitationDebugBase(intent) {
  const worldScale = Number(intent._worldScale ?? DEFAULT_PLACED_SPELL_SCALE);
  const circleRadius = NORMALIZED_SPELL_CIRCLE_RADIUS * worldScale;
  return {
    id: intent.id,
    materialKind: intent.materialKind,
    visualPreset: intent.visualPreset,
    motionMode: intent.metadata?.motionMode ?? null,
    fieldShape: intent.physicsField?.fieldShape ?? null,
    active: intent.active === true,
    bodyColor: levitationColor(intent.materialKind),
    illuminationColor: intent.materialKind === 'light' ? LIGHT_MAGIC.illumination : null,
    renderName: intent.materialKind === 'wind'
      ? `levitation-wind:${intent.id}`
      : levitationRenderName(intent),
    worldScale: round(worldScale),
    effectScale: round(Number(
      intent._effectScale
        ?? worldScale / DEFAULT_PLACED_SPELL_SCALE,
    )),
    orbRadius: intent.materialKind === 'wind'
      ? null
      : round(circleRadius),
    circleRadius: round(circleRadius),
    lifecyclePhase: intent.active === true ? 'forming' : 'ending',
    presence: intent.active === true ? 0 : 1,
    animationStyle: intent.materialKind === 'wind'
      ? 'wind_stream'
      : levitationAnimationStyle(intent.materialKind),
    floorRingPresent: false,
    teardownSettled: false,
  };
}

function updateLevitationVisual(intent, patch) {
  const previous = levitationVisualRegistry.get(intent.id) ?? levitationDebugBase(intent);
  levitationVisualRegistry.set(intent.id, { ...previous, ...patch });
  publishLevitationVisuals();
}

function LevitationPresentation({ intents = [] }) {
  const ownedIdsRef = useRef(new Set());
  useEffect(() => {
    const ids = new Set(intents.map((intent) => intent.id));
    for (const id of ownedIdsRef.current) {
      if (!ids.has(id)) levitationVisualRegistry.delete(id);
    }
    ownedIdsRef.current = ids;
    for (const intent of intents) {
      const previous = levitationVisualRegistry.get(intent.id);
      levitationVisualRegistry.set(intent.id, {
        ...levitationDebugBase(intent),
        ...(previous ?? {}),
        active: intent.active === true,
      });
    }
    publishLevitationVisuals();
    return () => {
      for (const id of ids) levitationVisualRegistry.delete(id);
      if (ownedIdsRef.current === ids) ownedIdsRef.current = new Set();
      publishLevitationVisuals();
    };
  }, [intents]);
  return (
    <group name="three-levitation-effects">
      {intents.map((intent) => (
        intent.materialKind === 'wind'
          ? <WindLevitationStream key={intent.id} intent={intent} />
          : <ElementalLevitationOrb key={intent.id} intent={intent} />
      ))}
    </group>
  );
}

function levitationInitialCenter(intent) {
  const field = intent.physicsField ?? {};
  const origin = field.origin ?? intent.regionOrigin?.primaryScenePosition ?? intent._placementFrame?.origin ?? DEFAULT_FRAME.origin;
  const normal = field.normal ?? intent._placementFrame?.normal ?? DEFAULT_FRAME.normal;
  const height = Number(field.hoverHeight ?? 0.7);
  return [
    Number(origin.x ?? 0) + Number(normal.x ?? 0) * height,
    Number(origin.y ?? 0) + Number(normal.y ?? 1) * height,
    Number(origin.z ?? 0) + Number(normal.z ?? 0) * height,
  ];
}

function levitationRenderName(intent) {
  return `levitation-orb:main-world-field:${intent.placedSpellId}:${intent._runtimeIntentId}`;
}

function ElementalLevitationOrb({ intent }) {
  const circleRadius = NORMALIZED_SPELL_CIRCLE_RADIUS * Number(
    intent._worldScale ?? DEFAULT_PLACED_SPELL_SCALE,
  );
  // Placed spells intentionally retain their compiled snapshot. Older saved
  // snapshots therefore still contain the retired volume-derived orb radius.
  // The owning circle is the live size authority at the presentation boundary,
  // so existing placements update without rewriting their authored snapshot.
  const radius = circleRadius;
  const material = intent.materialKind;
  const visualDomain = useMemo(() => ({ id: material }), [material]);
  const orbGeometry = useMemo(
    () => createLevitationOrbGeometry(visualDomain, radius),
    [radius, visualDomain],
  );
  const orbMaterial = useMemo(
    () => createLevitationOrbMaterial(visualDomain, radius),
    [radius, visualDomain],
  );
  const rootRef = useRef(null);
  const coreRef = useRef(null);
  const haloRef = useRef(null);
  const lightRef = useRef(null);
  const particleRefs = useRef([]);
  const reducedMotionRef = useRef(false);
  const motionRef = useRef(createLevitationOrbMotionState());
  const hoverHeight = Number(intent.physicsField?.hoverHeight ?? 0.7);

  useEffect(() => () => {
    orbGeometry.dispose?.();
    orbMaterial.dispose?.();
  }, [orbGeometry, orbMaterial]);

  useLayoutEffect(() => {
    const core = coreRef.current;
    if (!core) return undefined;
    core.visible = false;
    core.scale.setScalar(0.001);
    if (haloRef.current) haloRef.current.scale.setScalar(0.001);
    if (lightRef.current) lightRef.current.intensity = 0;
    particleRefs.current.forEach((particle) => {
      if (particle) particle.visible = false;
    });

    const previousAfterRender = core.onAfterRender;
    let renderedFrameCount = 0;
    core.onAfterRender = (...args) => {
      previousAfterRender?.apply(core, args);
      renderedFrameCount += 1;
      updateLevitationVisual(intent, {
        renderedFrameCount,
        renderedVisible: core.visible && rootRef.current?.visible !== false,
      });
    };
    return () => {
      core.onAfterRender = previousAfterRender;
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const sync = () => {
      reducedMotionRef.current = Boolean(media?.matches);
    };
    sync();
    media?.addEventListener?.('change', sync);
    return () => media?.removeEventListener?.('change', sync);
  }, []);

  useFrame((frame, rawDt) => {
    const root = rootRef.current;
    const core = coreRef.current;
    if (!root || !core) return;
    const motion = motionRef.current;
    const active = intent.active === true;
    const reduced = reducedMotionRef.current;
    const dt = Math.min(1 / 30, Math.max(0, rawDt));
    if (motion.active !== active) {
      motion.active = active;
      resetLevitationOrbMotion(motion, {
        active,
        material,
        radius,
        hoverHeight,
        reduced,
      });
    }

    root.visible = !motion.settled;
    if (active) {
      stepLevitationAssembly(motion, dt);
      updateLevitationFormation({
        material,
        radius,
        hoverHeight,
        time: frame.clock.elapsedTime,
        motion,
        core,
        halo: haloRef.current,
        light: lightRef.current,
        particles: particleRefs.current,
      });
    } else {
      updateLevitationTeardown({
        material,
        radius,
        hoverHeight,
        dt,
        motion,
        core,
        halo: haloRef.current,
        light: lightRef.current,
        particles: particleRefs.current,
      });
    }
    animateLevitationOrbVisual({
      domain: visualDomain,
      material: orbMaterial,
      geometry: orbGeometry,
      embers: active && material === 'fire' ? particleRefs.current : [],
      presence: motion.presence,
      time: frame.clock.elapsedTime,
      motionScale: reduced ? 0.42 : 1,
      visualScale: radius / 0.3,
    });
    updateLevitationVisual(intent, {
      active,
      orbRadius: round(radius),
      circleRadius: round(circleRadius),
      lifecyclePhase: motion.phase,
      presence: round(motion.presence),
      reducedMotion: reduced,
      motionPreference: reduced ? 'reduced_spatial_travel' : 'full',
      teardownSettled: motion.settled,
      particleCount: particleRefs.current.filter(Boolean).length,
      materialType: orbMaterial.type,
      geometryType: orbGeometry.type,
      geometryVertexCount: orbGeometry.attributes.position?.count ?? 0,
      surfaceProfile: levitationSurfaceProfile(material),
      surfaceMotion: levitationSurfaceMotion(orbGeometry),
      shaderTime: round(Number(orbMaterial.uniforms?.uTime?.value ?? 0)),
    });
    // The main world renders on demand. Elemental surfaces (fire displacement,
    // water ripples, light pulse) and lifecycle motion therefore own their next
    // frame instead of relying on unrelated player or weather movement.
    if (active || !motion.settled) frame.invalidate();
  });

  return (
    <group
      ref={rootRef}
      name={levitationRenderName(intent)}
      position={levitationInitialCenter(intent)}
      userData={{ placedSpellId: intent.placedSpellId, role: 'generated_levitation_orb' }}
    >
      <mesh
        ref={coreRef}
        name={`${levitationRenderName(intent)}:body`}
        geometry={orbGeometry}
        material={orbMaterial}
        castShadow={material !== 'light'}
        receiveShadow={material === 'earth'}
      />
      <group name={`${levitationRenderName(intent)}:${levitationAnimationStyle(material)}`}>
        {Array.from({ length: 12 }, (_, index) => (
          <mesh
            key={index}
            ref={(node) => { particleRefs.current[index] = node; }}
            name={`levitation-${material}-particle:${intent.id}:${index}`}
          >
            {material === 'earth'
              ? <dodecahedronGeometry args={[radius * (0.11 + (index % 3) * 0.018), 0]} />
              : <sphereGeometry args={[radius * (0.055 + (index % 3) * 0.012), 8, 6]} />}
            {material === 'fire' ? (
              <meshBasicMaterial
                color={index % 3 === 0 ? '#fff0c2' : '#ff8a2a'}
                transparent
                opacity={0.85}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
                toneMapped={false}
              />
            ) : (
              <meshStandardMaterial
                color={levitationColor(material)}
                emissive={material === 'light' ? LIGHT_MAGIC.emissive : '#000000'}
                emissiveIntensity={material === 'light' ? 1.1 : 0}
                roughness={material === 'earth' ? 0.96 : 0.24}
                transparent={material !== 'earth'}
                opacity={material === 'earth' ? 1 : 0.8}
              />
            )}
          </mesh>
        ))}
      </group>
      {material === 'light' ? (
        <>
          <mesh ref={haloRef}>
            <sphereGeometry args={[radius, 24, 18]} />
            <meshBasicMaterial
              color={LIGHT_MAGIC.highlight}
              transparent
              opacity={0.13}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          <pointLight
            ref={lightRef}
            name={`levitation-light:${intent.id}`}
            color={LIGHT_MAGIC.illumination}
            distance={7}
            decay={2}
          />
        </>
      ) : null}
    </group>
  );
}

function levitationAnimationStyle(materialKind) {
  if (materialKind === 'water') return 'water_gather_and_splash';
  if (materialKind === 'earth') return 'earth_assemble_and_crumble';
  if (materialKind === 'light') return 'light_converge_and_release';
  return 'fire_ignite_and_dissipate';
}

function levitationSurfaceProfile(materialKind) {
  if (materialKind === 'fire') return 'lab_simplex_fire_with_embers';
  if (materialKind === 'water') return 'lab_refractive_rippled_water';
  if (materialKind === 'earth') return 'lab_faceted_rough_earth';
  return 'lab_golden_emissive_light';
}

function levitationSurfaceMotion(geometry) {
  const base = geometry.userData?.base;
  const current = geometry.attributes?.position?.array;
  if (!base || !current) return null;
  let maxDelta = 0;
  const stride = Math.max(3, Math.floor(current.length / 96 / 3) * 3);
  for (let index = 0; index < current.length; index += stride) {
    maxDelta = Math.max(maxDelta, Math.abs(Number(current[index]) - Number(base[index])));
  }
  return round(maxDelta);
}

function createLevitationOrbMotionState() {
  return {
    active: null,
    presence: 0,
    presenceVelocity: 0,
    particles: [],
    phase: 'forming',
    settled: false,
    reduced: false,
  };
}

function resetLevitationOrbMotion(motion, { active, material, radius, hoverHeight, reduced }) {
  motion.settled = false;
  motion.reduced = reduced;
  motion.presenceVelocity = 0;
  if (active) {
    motion.presence = 0;
    motion.phase = material === 'fire' ? 'igniting' : 'forming';
    motion.particles = [];
    return;
  }
  motion.presence = Math.max(0.001, motion.presence);
  motion.phase = material === 'water'
    ? 'splashing'
    : material === 'earth'
      ? 'crumbling'
      : 'dissipating';
  motion.particles = Array.from({ length: 12 }, (_, index) => {
    const angle = (index / 12) * Math.PI * 2;
    const layer = (index % 3) - 1;
    const radial = radius * Math.sqrt(Math.max(0, 1 - (layer * 0.46) ** 2));
    const travelScale = reduced ? 0.45 : 1;
    const horizontalSpeed = (material === 'water' ? radius * 2.8 : radius * 0.95) * travelScale;
    return {
      position: new THREE.Vector3(
        Math.cos(angle) * radial * 0.72,
        layer * radius * 0.46,
        Math.sin(angle) * radial * 0.72,
      ),
      velocity: new THREE.Vector3(
        Math.cos(angle) * horizontalSpeed,
        (material === 'water'
          ? radius * (1.2 + (index % 4) * 0.18)
          : radius * (0.2 + (index % 3) * 0.08)) * travelScale,
        Math.sin(angle) * horizontalSpeed,
      ),
      ground: -hoverHeight + radius * (material === 'earth' ? 0.12 : 0.04),
      bounces: 0,
      settled: false,
      opacity: 1,
    };
  });
}

function stepLevitationAssembly(motion, dt) {
  const acceleration = (1 - motion.presence) * 42 - motion.presenceVelocity * 12;
  motion.presenceVelocity += acceleration * dt;
  motion.presence = clamp(motion.presence + motion.presenceVelocity * dt, 0, 1.02);
  // Treat sub-pixel scale error with low residual velocity as spring rest.
  // Demand-rendered scenes can otherwise strand the lifecycle at 0.99x even
  // though no visible motion remains.
  if (Math.abs(1 - motion.presence) < 0.008 && Math.abs(motion.presenceVelocity) < 0.05) {
    motion.presence = 1;
    motion.presenceVelocity = 0;
    motion.phase = 'hovering';
  }
}

function updateLevitationFormation({ material, radius, hoverHeight, time, motion, core, halo, light, particles }) {
  const presence = clamp(motion.presence, 0, 1);
  const smooth = presence * presence * (3 - 2 * presence);
  core.visible = presence > 0.08;
  core.position.set(0, material === 'water' ? -radius * 0.08 * (1 - smooth) : 0, 0);
  if (material === 'fire') {
    core.scale.set(0.72 + smooth * 0.28, 0.25 + smooth * 0.75, 0.72 + smooth * 0.28);
  } else if (material === 'water') {
    core.scale.set(0.62 + smooth * 0.38, 0.2 + smooth * 0.8, 0.62 + smooth * 0.38);
  } else {
    core.scale.setScalar(Math.max(0.001, smooth));
  }
  if (halo) halo.scale.setScalar(1.55 * smooth);
  if (light) light.intensity = 1.5 * smooth;
  particles.forEach((particle, index) => {
    if (!particle) return;
    const angle = (index / particles.length) * Math.PI * 2 + time * (material === 'fire' ? 1.4 : 0.35);
    const stagger = (index % 4) * 0.045;
    const local = clamp((presence - stagger) / Math.max(0.001, 1 - stagger), 0, 1);
    const startRadius = radius * (motion.reduced ? 0.72 : 1.05 + (index % 3) * 0.18);
    const startY = (motion.reduced ? -radius * 0.34 : -hoverHeight)
      + radius * (0.08 + (index % 2) * 0.06);
    if (material === 'fire') {
      const cycle = (time * (0.7 + (index % 3) * 0.08) + index / particles.length) % 1;
      particle.visible = presence > 0.08;
      particle.position.set(
        Math.cos(angle) * radius * (0.3 + cycle * 0.5),
        -radius * 0.55 + cycle * radius * 1.8,
        Math.sin(angle) * radius * (0.3 + cycle * 0.5),
      );
      particle.scale.setScalar((1 - cycle) * presence);
      particle.material.opacity = (1 - cycle) * presence;
      return;
    }
    if (motion.phase === 'hovering') {
      particle.visible = material === 'light';
      if (material === 'light') {
        particle.position.set(
          Math.cos(angle) * radius * 1.25,
          Math.sin(angle * 1.7) * radius * 0.38,
          Math.sin(angle) * radius * 1.25,
        );
        particle.scale.setScalar(0.7 + Math.sin(time * 2.4 + index) * 0.18);
        particle.material.opacity = 0.48;
      }
      return;
    }
    particle.visible = true;
    const targetLayer = ((index % 3) - 1) * radius * 0.38;
    const targetRadius = radius * Math.sqrt(Math.max(0, 1 - (targetLayer / radius) ** 2)) * 0.78;
    particle.position.set(
      THREE.MathUtils.lerp(Math.cos(angle) * startRadius, Math.cos(angle) * targetRadius, local),
      THREE.MathUtils.lerp(startY, targetLayer, local),
      THREE.MathUtils.lerp(Math.sin(angle) * startRadius, Math.sin(angle) * targetRadius, local),
    );
    particle.scale.setScalar(material === 'earth' ? 1 : 0.65 + local * 0.35);
    particle.material.opacity = material === 'earth' ? 1 : 0.35 + local * 0.5;
  });
}

function updateLevitationTeardown({ material, radius, dt, motion, core, halo, light, particles }) {
  if (motion.settled) return;
  if (material === 'fire' || material === 'light') {
    const stiffness = material === 'light' ? 34 : 24;
    const damping = material === 'light' ? 11 : 8;
    const acceleration = -motion.presence * stiffness - motion.presenceVelocity * damping;
    motion.presenceVelocity += acceleration * dt;
    motion.presence = Math.max(0, motion.presence + motion.presenceVelocity * dt);
    const presence = motion.presence;
    core.scale.set(
      Math.max(0.001, presence * (material === 'fire' ? 0.8 : 1)),
      Math.max(0.001, presence * (material === 'fire' ? 1.25 : 1)),
      Math.max(0.001, presence * (material === 'fire' ? 0.8 : 1)),
    );
    core.position.y += (material === 'fire' ? radius * 1.4 : radius * 0.35) * dt;
    particles.forEach((particle, index) => {
      if (!particle) return;
      const angle = (index / particles.length) * Math.PI * 2;
      particle.visible = presence > 0.01;
      particle.position.x += Math.cos(angle) * radius * dt * (material === 'light' ? 1.4 : 0.55);
      particle.position.y += radius * dt * (material === 'fire' ? 2.4 + (index % 3) * 0.3 : 0.45);
      particle.position.z += Math.sin(angle) * radius * dt * (material === 'light' ? 1.4 : 0.55);
      particle.scale.setScalar(Math.max(0.001, presence));
      particle.material.opacity = presence * 0.75;
    });
    if (halo) halo.scale.setScalar(1.55 * presence * (material === 'light' ? 1 + (1 - presence) * 0.7 : 1));
    if (light) light.intensity = 1.5 * presence;
    if (presence <= 0.008 && Math.abs(motion.presenceVelocity) <= 0.08) {
      motion.presence = 0;
      motion.settled = true;
      motion.phase = 'settled';
      core.visible = false;
      particles.forEach((particle) => { if (particle) particle.visible = false; });
    }
    return;
  }

  let settledCount = 0;
  motion.particles.forEach((state, index) => {
    const particle = particles[index];
    if (!particle) return;
    particle.visible = true;
    if (!state.settled) {
      state.velocity.y -= (material === 'water' ? 7.4 : 9.8) * dt;
      state.position.addScaledVector(state.velocity, dt);
      if (state.position.y <= state.ground) {
        state.position.y = state.ground;
        state.bounces += 1;
        state.velocity.y = Math.abs(state.velocity.y) * (material === 'water' && state.bounces === 1 ? 0.34 : 0.14);
        state.velocity.x *= material === 'water' ? 0.74 : 0.42;
        state.velocity.z *= material === 'water' ? 0.74 : 0.42;
      }
      if (
        state.bounces > 0
        && Math.abs(state.velocity.y) < 0.08
        && Math.hypot(state.velocity.x, state.velocity.z) < 0.08
      ) {
        state.settled = true;
        state.velocity.set(0, 0, 0);
      }
    }
    if (state.settled) settledCount += 1;
    particle.position.copy(state.position);
    if (material === 'water') {
      const speed = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z);
      particle.scale.set(1 + speed * 0.08, Math.max(0.2, 0.7 - speed * 0.035), 1 + speed * 0.08);
      state.opacity = state.settled ? Math.max(0, state.opacity - dt * 1.4) : 0.82;
      particle.material.opacity = state.opacity;
    } else {
      particle.rotation.x += state.velocity.z * dt * 0.7;
      particle.rotation.z -= state.velocity.x * dt * 0.7;
    }
  });
  const airborne = 1 - settledCount / Math.max(1, motion.particles.length);
  motion.presence = airborne;
  if (material === 'water') {
    core.scale.set(0.82 + airborne * 0.18, Math.max(0.02, airborne), 0.82 + airborne * 0.18);
    core.position.y -= radius * (1.2 - airborne) * dt * 4;
  } else {
    core.scale.setScalar(Math.max(0.001, airborne));
  }
  if (settledCount === motion.particles.length) {
    const waterVisible = material === 'water' && motion.particles.some((state) => state.opacity > 0.02);
    if (!waterVisible) {
      motion.presence = 0;
      motion.settled = true;
      motion.phase = 'settled';
      core.visible = false;
      particles.forEach((particle) => { if (particle) particle.visible = false; });
    }
  }
}

function WindLevitationStream({ intent }) {
  const field = intent.physicsField ?? {};
  const origin = field.origin ?? intent._placementFrame?.origin ?? DEFAULT_FRAME.origin;
  // The visible air stream exits through the spell face; the carrier force in
  // `field.direction` is the equal-and-opposite reaction.
  const direction = toVector3(field.emissionDirection ?? DEFAULT_FRAME.normal).normalize();
  const guide = toVector3(field.guidanceDirection ?? { x: 0, y: 0, z: 0 });
  const resolved = direction.clone().add(guide.multiplyScalar(0.28)).normalize();
  const quaternion = quaternionFromUp(resolved);
  const effectScale = Math.max(0.05, Number(
    intent._effectScale
      ?? Number(intent._worldScale ?? DEFAULT_PLACED_SPELL_SCALE) / DEFAULT_PLACED_SPELL_SCALE,
  ));
  return (
    <group
      name={`spell-output:${intent.id}`}
      position={[origin.x ?? 0, origin.y ?? 0, origin.z ?? 0]}
      scale={[effectScale, effectScale, effectScale]}
      userData={{ placedSpellId: intent.placedSpellId, role: 'carrier_levitation_stream' }}
    >
      <group name={`levitation-wind:${intent.id}`}>
        {[0, 1, 2, 3].map((index) => (
          <mesh
            key={index}
            position={[Math.cos(index * Math.PI / 2) * 0.16, 0.48 + index * 0.08, Math.sin(index * Math.PI / 2) * 0.16]}
            quaternion={quaternion}
          >
            <capsuleGeometry args={[0.018, 0.72 + index * 0.08, 4, 8]} />
            <meshBasicMaterial color="#bfe9d0" transparent opacity={0.38} depthWrite={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function levitationColor(materialKind) {
  if (materialKind === 'light') return LIGHT_MAGIC.body;
  if (materialKind === 'water') return '#39b4f0';
  if (materialKind === 'earth') return '#a9794c';
  return '#ff7a2f';
}

function publishIlluminationDebug() {
  if (typeof window === 'undefined') return;
  const emitters = [...illuminationRegistry.values()];
  window.__WHA_LOCAL_ILLUMINATION__ = {
    maxLightCount: MAX_LOCAL_ILLUMINATION_LIGHTS,
    activeLightCount: emitters.length,
    totalIntensity: round(emitters.reduce((sum, emitter) => sum + emitter.intensity, 0)),
    emitters,
    neighboringSurfaceSamples: emitters.map((emitter) => ({
      id: emitter.id,
      owner: emitter.owner,
      ...emitter.neighboringSurfaceSamples,
    })),
  };
}

function MaterialColumns({ intents, blockedEarthVisualSpellIds, props = [] }) {
  const physicsInterceptions = usePhysicsColumnInterceptions(intents);
  const collisionBoxes = useMemo(
    () => (props ?? [])
      .filter((prop) => prop.visualKind !== 'activation_ring_key')
      .map((prop) => {
        const bounds = propContactBounds(prop);
        return {
          id: prop.id,
          surface: `prop:${prop.id}`,
          min: bounds.center.clone().sub(bounds.half),
          max: bounds.center.clone().add(bounds.half),
        };
      }),
    [props],
  );
  return (
    <group name="three-material-columns">
      {intents.flatMap((intent) => {
        const direction = intent.sceneAxis ? toSceneAxis(intent.sceneAxis) : mapAxis(intent.axis);
        const worldScale = clamp(
          Number(intent._worldScale ?? MIN_PLACED_SPELL_SCALE),
          MIN_PLACED_SPELL_SCALE,
          4,
        );
        const height = Number(intent.physicsField?.length ?? (
          Math.min(
            2.35,
            Math.max(0.9, intent.magnitude * 0.34 * Math.max(0.35, intent.signSizeScale ?? 1) + 0.78),
          ) * (intent.columnHeightMultiplier ?? 3) * worldScale
        ));
        const radius = Math.max(
          0.08,
          worldThicknessRadiusForIntent(intent) * (intent.columnRadiusRatio ?? 0.7),
        ) * worldScale;
        return columnRenderPlans(intent, { x: 0, y: 0.22, z: 0 }).map((plan) => {
          const key = `${intent.id}${plan.nameSuffix}`;
          return (
            <group key={key} name={`spell-output:${key}`}>
              <PromotedElementColumnEffect
                element={intent.materialKind}
                effectId={key}
                origin={plan.origin}
                direction={direction}
                baseRadius={radius * plan.radiusScale}
                active={intent.active === true}
                collisionBoxes={
                  ['fire', 'wind'].includes(intent.materialKind)
                    ? [
                        ...collisionBoxes,
                        ...(physicsInterceptions[intent.id] ? [physicsInterceptions[intent.id]] : []),
                      ]
                    : []
                }
                crumbleWholeOutputOnEarlyEnd={
                  intent.materialKind === 'earth' && blockedEarthVisualSpellIds?.has(intent.placedSpellId)
                }
                showLabContext={false}
                useInternalLight={intent.materialKind !== 'light'}
                settings={{
                  spellLength: height,
                  projectedRadiusScale: 1,
                  obstacleEnabled: false,
                }}
              />
            </group>
          );
        });
      })}
    </group>
  );
}

function usePhysicsColumnInterceptions(intents) {
  const [boxes, setBoxes] = useState({});
  const signatureRef = useRef('');
  useFrame(() => {
    const fields = window.__WHA_MAIN_WORLD_PHYSICS__?.fields ?? [];
    const byFieldId = new Map(fields.map((field) => [field.id, field]));
    const next = {};
    for (const intent of intents) {
      const runtimeIntentId = intent._runtimeIntentId ?? intent.id;
      const fieldId = `main-world-field:${intent.placedSpellId}:${runtimeIntentId}`;
      const interception = byFieldId.get(fieldId)?.interception;
      if (!interception?.blocked || !interception.point) continue;
      const point = toVector3(interception.point);
      const halfSize = Math.max(0.08, Number(intent.physicsField?.radius ?? 0.2) * 0.18);
      const half = new THREE.Vector3(halfSize, halfSize, halfSize);
      next[intent.id] = {
        id: `physics-interception:${fieldId}`,
        surface: interception.bodyId ?? 'physics-interception',
        min: point.clone().sub(half),
        max: point.clone().add(half),
      };
    }
    const signature = JSON.stringify(Object.entries(next).map(([id, box]) => [
      id,
      box.surface,
      box.min.x,
      box.min.y,
      box.min.z,
      box.max.x,
      box.max.y,
      box.max.z,
    ]));
    if (signature === signatureRef.current) return;
    signatureRef.current = signature;
    setBoxes(next);
  });
  return boxes;
}

function WaterDispersions({ intents }) {
  const physicsContacts = usePhysicsDispersionContacts(intents);
  useEffect(() => {
    window.__WHA_NATIVE_SPELL_GEOMETRY__ = intents.map((intent) => {
      const frame = normalizeFrame(intent._placementFrame ?? intent.placementFrame);
      const emergence = toVector3(intent.origin ?? centeredDispersionOrigin(frame));
      return {
        intentId: intent.id,
        intentType: intent.intentType,
        runtimeOrigin: intent.origin ?? null,
        sourceAnchor: intent.dispersionGeometry?.sourceAnchors?.[0]?.scenePosition ?? null,
        emergenceOrigin: { x: emergence.x, y: emergence.y, z: emergence.z },
        placementFrameOrigin: frame.origin,
        placementFrameNormal: vectorDebug(frame.normal),
        surfaceClearance: 0.22 * frame.worldScale,
      };
    });
  }, [intents]);
  return (
    <group name="three-water-dispersions">
      {intents.map((intent) => {
        const frame = normalizeFrame(intent._placementFrame ?? intent.placementFrame);
        const origin = toVector3(intent.origin ?? centeredDispersionOrigin(frame));
        const placedWorldScale = clamp(
          Number(intent._worldScale ?? intent.worldScale ?? MIN_PLACED_SPELL_SCALE),
          MIN_PLACED_SPELL_SCALE,
          4,
        );
        const signScale = Math.max(0.35, intent.signSizeScale ?? 1);
        const sealRadius = 0.46 * placedWorldScale;
        const semanticReach = Math.min(2.8, (0.46 + 1.05 * signScale) * placedWorldScale);
        const center = origin;
        const sourceAnchors = intent.dispersionGeometry?.sourceAnchors ?? [];
        const signAngles = sourceAnchors.length > 0
          ? sourceAnchors.map((anchor) => ((anchor.positionAngleDeg ?? 0) * Math.PI) / 180)
          : undefined;
        const effectId = intent.id;
        return (
          <group key={effectId} name={`spell-output:${effectId}`}>
          <PromotedWaterDispersionEffect
            effectId={effectId}
            center={center}
            axisU={frame.tangent}
            axisV={frame.bitangent}
            signAngles={signAngles}
            signSizes={signAngles?.map(() => 0.66 * signScale)}
            sealRadius={sealRadius}
            canopyReach={semanticReach}
            minimumCanopyReach={Number(intent._dispersionMinimumRadius ?? 0)}
            quadrantContacts={physicsContacts[intent.id]?.quadrants ?? null}
            surfaceY={0}
            active={intent.active === true}
            showLabContext={false}
          />
          </group>
        );
      })}
    </group>
  );
}

function usePhysicsDispersionContacts(intents) {
  const [contacts, setContacts] = useState({});
  const signatureRef = useRef('');
  useFrame(() => {
    const fields = window.__WHA_MAIN_WORLD_PHYSICS__?.fields ?? [];
    const byFieldId = new Map(fields.map((field) => [field.id, field]));
    const next = {};
    for (const intent of intents) {
      const runtimeIntentId = intent._runtimeIntentId ?? intent.id;
      const fieldId = `main-world-field:${intent.placedSpellId}:${runtimeIntentId}`;
      const dispersionContacts = byFieldId.get(fieldId)?.dispersionContacts;
      if (dispersionContacts?.quadrants?.length !== 4) continue;
      next[intent.id] = dispersionContacts;
    }
    const signature = JSON.stringify(next);
    if (signature === signatureRef.current) return;
    signatureRef.current = signature;
    setContacts(next);
  });
  return contacts;
}

function MaterialDispersions({ intents }) {
  useEffect(() => {
    if (intents.length === 0) return;
    window.__WHA_NATIVE_SPELL_GEOMETRY__ = intents.map((intent) => {
      const frame = normalizeFrame(intent._placementFrame ?? intent.placementFrame);
      const emergence = toVector3(intent.origin ?? centeredDispersionOrigin(frame));
      return {
        intentId: intent.id,
        intentType: intent.intentType,
        runtimeOrigin: intent.origin ?? null,
        sourceAnchor: intent.dispersionGeometry?.sourceAnchors?.[0]?.scenePosition ?? null,
        emergenceOrigin: { x: emergence.x, y: emergence.y, z: emergence.z },
        placementFrameOrigin: frame.origin,
        placementFrameNormal: vectorDebug(frame.normal),
        surfaceClearance: 0.22 * frame.worldScale,
      };
    });
  }, [intents]);
  return (
    <group name="three-material-dispersions">
      {intents.map((intent) => {
        const frame = normalizeFrame(intent._placementFrame ?? intent.placementFrame);
        const origin = toVector3(intent.origin ?? centeredDispersionOrigin(frame));
        const worldScale = clamp(
          Number(intent._worldScale ?? intent.worldScale ?? MIN_PLACED_SPELL_SCALE),
          MIN_PLACED_SPELL_SCALE,
          4,
        );
        const signScale = Math.max(0.35, intent.signSizeScale ?? 1);
        const sealRadius = 0.46 * worldScale;
        const semanticReach = Math.min(2.8, (0.46 + 1.05 * signScale) * worldScale);
        const canopyReach = Math.max(
          semanticReach,
          Number(intent._dispersionMinimumRadius ?? 0),
        );
        const center = origin;
        const sourceAnchors = intent.dispersionGeometry?.sourceAnchors ?? [];
        const signAngles = sourceAnchors.length > 0
          ? sourceAnchors.map((anchor) => ((anchor.positionAngleDeg ?? 0) * Math.PI) / 180)
          : undefined;
        return (
          <group key={intent.id} name={`spell-output:${intent.id}`}>
            <PromotedElementDispersionEffect
              element={intent.materialKind}
              effectId={intent.id}
              center={center}
              axisU={frame.tangent}
              axisV={frame.bitangent}
              signAngles={signAngles}
              sealRadius={sealRadius}
              canopyReach={canopyReach}
              active={intent.active === true}
              showLabContext={false}
              useInternalLight={intent.materialKind !== 'light'}
            />
          </group>
        );
      })}
    </group>
  );
}

function WaterDispersionSheet({ intent, plan, dir, basis, reach, radius, spread }) {
  const origin = plan.origin;
  const gravity = new THREE.Vector3(0, -1, 0);
  const sheetWidthMultiplier = intent.dispersionGeometry?.sheet?.widthMultiplier ?? (1.15 + spread * 0.75);
  const sheetWidth = Math.max(0.18, radius * sheetWidthMultiplier * 1.9);
  const sheetThickness = Math.max(0.018, radius * 0.14);
  const spellLength = reach * 0.58;
  const fallLength = reach * 0.72;
  const sideOffset = basis.right.clone().multiplyScalar((plan.index - 0.5) * sheetThickness * 1.4);
  const sheetOrigin = origin.clone().add(sideOffset);
  const spellCenter = sheetOrigin.clone().add(dir.clone().multiplyScalar(spellLength * 0.5));
  const fallStart = sheetOrigin.clone().add(dir.clone().multiplyScalar(spellLength));
  const fallCenter = fallStart
    .clone()
    .add(gravity.clone().multiplyScalar(fallLength * 0.48))
    .add(dir.clone().multiplyScalar(reach * 0.1));
  const spellQuaternion = quaternionFromUp(dir);
  const fallQuaternion = quaternionFromUp(gravity);

  return (
    <group name={`water-dispersion-system:${intent.id}${plan.nameSuffix}`}>
      <mesh
        name={`dispersion-output:${intent.id}${plan.nameSuffix}:sheet`}
        position={spellCenter}
        quaternion={spellQuaternion}
      >
        <boxGeometry args={[sheetWidth, spellLength, sheetThickness]} />
        <meshPhysicalMaterial color="#3fb8e8" roughness={0.16} transparent opacity={0.48} transmission={0.18} depthWrite={false} />
      </mesh>
      <mesh
        name={`water-dispersion-falling-sheet:${intent.id}${plan.nameSuffix}`}
        position={fallCenter}
        quaternion={fallQuaternion}
      >
        <boxGeometry args={[sheetWidth * 0.82, fallLength, sheetThickness * 0.86]} />
        <meshPhysicalMaterial color="#66c8ef" roughness={0.18} transparent opacity={0.42} transmission={0.16} depthWrite={false} />
      </mesh>
      <mesh name={`dispersion-origin:${intent.id}${plan.nameSuffix}`} position={origin}>
        <sphereGeometry args={[Math.max(0.045, radius * 0.36), 14, 10]} />
        <meshStandardMaterial color="#42b9e8" transparent opacity={0.66} />
      </mesh>
      {Array.from({ length: 8 }, (_, index) => {
        const edge = index % 2 === 0 ? -1 : 1;
        const progress = (index + 1) / 9;
        const position = fallStart
          .clone()
          .add(basis.right.clone().multiplyScalar(edge * sheetWidth * (0.42 + progress * 0.12)))
          .add(gravity.clone().multiplyScalar(fallLength * progress * 0.92))
          .add(dir.clone().multiplyScalar(reach * (0.06 + progress * 0.08)));
        return (
          <mesh
            key={index}
            name={`water-dispersion-particle:${intent.id}${plan.nameSuffix}:${index}`}
            position={position}
          >
            <sphereGeometry args={[Math.max(0.018, radius * (0.075 + progress * 0.025)), 8, 6]} />
            <meshStandardMaterial color="#8fdcf3" transparent opacity={0.7} />
          </mesh>
        );
      })}
    </group>
  );
}

function ReactiveWaterColumn({ intent, origin, dir, height, radius, plan, lifecycle, timelinePaused, props, debugRef }) {
  const streamRef = useRef(null);
  const innerRef = useRef(null);
  const emitterRef = useRef(null);
  const streakRefs = useRef([]);
  const topSprayRefs = useRef([]);
  const dropletRefs = useRef([]);
  const splashRefs = useRef([]);
  const contactSprayRefs = useRef([]);
  const clockRef = useRef(Math.max(0, lifecycle?.elapsedMs ?? 0));
  const lengthScaleRef = useRef(0);
  const key = `${intent.id}${plan.nameSuffix}`;
  const seed = useMemo(
    () => hashStringToUnit(`${key}:${JSON.stringify(intent.resourceBudget ?? {})}`),
    [intent.resourceBudget, key],
  );
  const basis = useMemo(() => perpendicularBasis(dir), [dir]);
  const particleCount = clamp(Math.round(24 + radius * 26 + height * 2.8), 28, 46);
  const particles = useMemo(
    () => waterParticleProfiles(particleCount, radius, height, seed),
    [height, particleCount, radius, seed],
  );
  const system = useMemo(
    () => ({
      key,
      intent,
      nameSuffix: plan.nameSuffix,
      origin,
      dir,
      basis,
      height,
      radius,
      seed,
      particleCount,
      particles,
      props,
      topBreakupAllowed: dir.clone().normalize().dot(new THREE.Vector3(0, 1, 0)) > 0.72,
    }),
    [basis, dir, height, intent, key, origin, particleCount, particles, plan.nameSuffix, props, radius, seed],
  );
  const geometry = useMemo(() => createWaterColumnSurfaceGeometry(12, 14), []);
  const innerGeometry = useMemo(() => createWaterColumnSurfaceGeometry(10, 12), []);
  const emitterGeometry = useMemo(() => createIrregularPoolGeometry(26, seed + 0.11), [seed]);

  useFrame((_, delta) => {
    const lifecycleElapsedMs = Math.max(0, lifecycle?.elapsedMs ?? 0);
    const previousClockMs = clockRef.current;
    const nextClockMs = timelinePaused
      ? Math.max(previousClockMs, lifecycleElapsedMs)
      : Math.max(lifecycleElapsedMs, previousClockMs + Math.min(50, Math.max(0, delta * 1000)));
    clockRef.current = nextClockMs;

    const timeSec = nextClockMs / 1000;
    const eruptionScale = easeOutCubic(clamp(timeSec / 0.5, 0, 1));
    const pressureContacts = solveWaterColumnContacts(system, props, eruptionScale);
    const targetLengthScale = eruptionScale * pressureContacts.streamLengthScale;
    lengthScaleRef.current += (targetLengthScale - lengthScaleRef.current) * 0.24;
    const activeLengthScale = clamp(lengthScaleRef.current, 0.025, 1);
    const activeHeight = height * activeLengthScale;
    const liveSystem = {
      ...system,
      pressureContacts,
      activeLengthScale,
      activeHeight,
    };

    updateWaterColumnSurfaceGeometry(streamRef.current?.geometry, liveSystem, timeSec, {
      radiusScale: 1,
      turbulenceScale: 1,
    });
    updateWaterColumnSurfaceGeometry(innerRef.current?.geometry, liveSystem, timeSec, {
      radiusScale: 0.58,
      turbulenceScale: 0.42,
      centerPulseScale: 0.45,
    });
    updateIrregularPoolGeometry(emitterRef.current?.geometry, {
      center: { x: origin.x, z: origin.z },
      radiusX: radius * (0.62 + eruptionScale * 0.5 + Math.sin(timeSec * 9.1) * 0.04),
      radiusZ: radius * (0.44 + eruptionScale * 0.34 + Math.cos(timeSec * 8.7) * 0.035),
      y: origin.y - 0.16,
      angle: timeSec * 0.2,
      edgeNoise: 0.16,
    });
    updateSurfaceStreaks(streakRefs.current, liveSystem, timeSec);
    updateTopSpray(topSprayRefs.current, liveSystem, timeSec);
    updateContactSpray(contactSprayRefs.current, liveSystem, timeSec);
    const volume = updateParticles(dropletRefs.current, splashRefs.current, liveSystem, timeSec);
    debugRef.current[key] = waterDebug(liveSystem, nextClockMs, eruptionScale, volume);
    window.__WHA_WATER_SIM_DEBUG__ = Object.values(debugRef.current);
  });

  return (
    <group name={`water-column-system:${key}`}>
      <mesh ref={streamRef} name={`water-column:${intent.id}${plan.nameSuffix}`} geometry={geometry}>
        <WaterMaterial role="body" intent={intent} />
      </mesh>
      <mesh ref={innerRef} name={`water-column-inner-mass:${intent.id}${plan.nameSuffix}`} geometry={innerGeometry}>
        <WaterMaterial role="innerMass" intent={intent} />
      </mesh>
      <mesh ref={emitterRef} name={`water-column-emitter:${intent.id}${plan.nameSuffix}`} geometry={emitterGeometry}>
        <WaterMaterial role="foam" intent={intent} />
      </mesh>
      {Array.from({ length: 10 }, (_, index) => (
        <mesh
          key={index}
          ref={(mesh) => {
            streakRefs.current[index] = mesh;
          }}
          name={`water-column-surface-streak:${intent.id}${plan.nameSuffix}:${index}`}
        >
          <cylinderGeometry args={[1, 1, 1, 7]} />
          <WaterMaterial role={index % 4 === 0 ? 'foam' : 'turbulence'} intent={intent} />
        </mesh>
      ))}
      {Array.from({ length: 10 }, (_, index) => (
        <mesh
          key={index}
          ref={(mesh) => {
            topSprayRefs.current[index] = mesh;
          }}
          name={`water-column-top-spray:${intent.id}${plan.nameSuffix}:${index}`}
        >
          <cylinderGeometry args={[1, 1, 1, 6]} />
          <WaterMaterial role={index % 3 === 0 ? 'foam' : 'splash'} intent={intent} />
        </mesh>
      ))}
      {particles.map((particle, index) => (
        <mesh
          key={index}
          ref={(mesh) => {
            dropletRefs.current[index] = mesh;
          }}
          name={`water-column-particle:${intent.id}${plan.nameSuffix}:${index}`}
        >
          <sphereGeometry args={[1, 8, 6]} />
          <WaterMaterial role={index % 5 === 0 ? 'foam' : 'splash'} intent={intent} />
        </mesh>
      ))}
      {particles.slice(0, 14).map((particle, index) => (
        <mesh
          key={index}
          ref={(mesh) => {
            splashRefs.current[index] = mesh;
          }}
          name={`water-column-splash:${intent.id}${plan.nameSuffix}:${index}`}
        >
          <sphereGeometry args={[1, 8, 6]} />
          <WaterMaterial role="foam" intent={intent} />
        </mesh>
      ))}
      {Array.from({ length: 10 }, (_, index) => (
        <mesh
          key={index}
          ref={(mesh) => {
            contactSprayRefs.current[index] = mesh;
          }}
          name={`water-column-contact-mist:${intent.id}${plan.nameSuffix}:${index}`}
        >
          <sphereGeometry args={[1, 8, 6]} />
          <WaterMaterial role={index % 3 === 0 ? 'foam' : 'splash'} intent={intent} />
        </mesh>
      ))}
    </group>
  );
}

function NonLiquidWaterColumn({ intent, origin, dir, height, radius, plan }) {
  const quaternion = quaternionFromUp(dir);
  const position = origin.clone().add(dir.clone().multiplyScalar(height / 2));
  const detailCount = intent.renderPreset === 'mist_cloud' ? 8 : 5;
  const basis = perpendicularBasis(dir);
  return (
    <group name={`water-column-non-liquid-system:${intent.id}${plan.nameSuffix}`}>
      <mesh name={`water-column:${intent.id}${plan.nameSuffix}`} position={position} quaternion={quaternion}>
        <cylinderGeometry args={[radius, radius, height, 28]} />
        <WaterMaterial role="body" intent={intent} />
      </mesh>
      {Array.from({ length: detailCount }, (_, index) => {
        const t = (index + 0.65) / (detailCount + 0.8);
        const offset = basis.right
          .clone()
          .multiplyScalar(Math.sin(index * 1.7) * radius * 0.55)
          .add(basis.up.clone().multiplyScalar(Math.cos(index * 1.13) * radius * 0.35));
        const detailPosition = origin.clone().add(dir.clone().multiplyScalar(height * t)).add(offset);
        return (
          <mesh
            key={index}
            name={`water-column-state-detail:${intent.id}${plan.nameSuffix}:${index}`}
            position={detailPosition}
            quaternion={quaternion}
            scale={[1, intent.renderPreset === 'mist_cloud' ? 0.62 : 1.18, 1]}
          >
            <sphereGeometry args={[radius * (intent.renderPreset === 'mist_cloud' ? 0.45 : 0.24), 12, 8]} />
            <WaterMaterial role={intent.renderPreset === 'mist_cloud' ? 'mist' : 'ice'} intent={intent} />
          </mesh>
        );
      })}
    </group>
  );
}

function WaterMaterial({ role, intent }) {
  if (intent.renderPreset === 'ice_chunk') {
    return <meshPhysicalMaterial color="#a3dbea" roughness={0.16} transparent opacity={0.76} />;
  }
  if (intent.renderPreset === 'mist_cloud') {
    return <meshStandardMaterial color="#adc7d1" transparent opacity={0.3} depthWrite={false} />;
  }
  if (role === 'body') {
    return (
      <meshPhysicalMaterial
        color="#087aad"
        roughness={0.1}
        metalness={0}
        transmission={0.18}
        transparent
        opacity={0.9}
        emissive="#03141a"
        side={THREE.DoubleSide}
      />
    );
  }
  if (role === 'innerMass') {
    return (
      <meshPhysicalMaterial
        color="#1aaddb"
        roughness={0.08}
        transmission={0.32}
        transparent
        opacity={0.58}
        emissive="#082429"
        side={THREE.DoubleSide}
      />
    );
  }
  if (role === 'foam') {
    return <meshStandardMaterial color="#94dbee" transparent opacity={0.42} emissive="#14292e" depthWrite={false} />;
  }
  if (role === 'splash') {
    return <meshStandardMaterial color="#57c7f5" transparent opacity={0.86} roughness={0.24} />;
  }
  if (role === 'turbulence') {
    return <meshStandardMaterial color="#1f9ed6" transparent opacity={0.78} roughness={0.2} />;
  }
  return <meshStandardMaterial color="#298cc7" transparent opacity={0.58} roughness={0.22} />;
}

// ---------------------------------------------------------------------------
// Rain weather + glow-volume registry
// ---------------------------------------------------------------------------
//
// Rain is drawn as one instanced-mesh "animation", but every drop is an
// independently simulated water object: it owns a position/velocity, falls
// under gravity, recycles when it reaches the ground, and is published into the
// scene's water-object registry. Because each drop is individually addressable,
// volumetric effects can touch single drops without touching the whole system.
// The canonical example is a glow column: a spell registers an upright volume
// into glowVolumeRegistry, and only the drops whose current position lands
// inside that volume light up — the rest of the rain stays its normal cool grey.

const RAIN_AREA = { minX: -13, maxX: 13, minZ: -10, maxZ: 10 };
const RAIN_SPAWN_TOP = 9.5;
const RAIN_DROP_COUNT = 420;
const RAIN_SPLASH_COUNT = 56;
const RAIN_WIND = { x: -0.6, z: 0.25 }; // gentle slant (world units / sec)
const RAIN_TILT = { x: 0.18, z: -0.28 }; // streak lean to match the wind
const RAIN_BASE_COLOR = new THREE.Color('#9ab8cc');
const RAIN_GLOW_DEFAULT_COLOR = '#8ff4ff';
const RAIN_SPLASH_BASE_COLOR = new THREE.Color('#bfe6f3');

// Upright "glow" volumes that water objects (rain drops) react to. A spell that
// creates a column of glowing water registers its volume here and removes it on
// cleanup; the rain reads the registry every frame. Shape: a vertical cylinder
// { id, x, z, radius, yMin, yMax, color, intensity }.
const glowVolumeRegistry = new Map();
let glowVolumeSerial = 0;

function registerGlowVolume(volume = {}) {
  const id = volume.id ?? `glow-volume:${(glowVolumeSerial += 1)}`;
  const colorHex = volume.color ?? RAIN_GLOW_DEFAULT_COLOR;
  glowVolumeRegistry.set(id, {
    id,
    x: Number(volume.x ?? 0),
    z: Number(volume.z ?? 0),
    radius: Math.max(0.05, Number(volume.radius ?? 0.6)),
    yMin: Number(volume.yMin ?? 0),
    yMax: Number(volume.yMax ?? 3),
    color: colorHex,
    intensity: Number(volume.intensity ?? 1),
    _color: new THREE.Color(colorHex),
  });
  publishGlowVolumes();
  return () => {
    glowVolumeRegistry.delete(id);
    publishGlowVolumes();
  };
}

function publishGlowVolumes() {
  if (typeof window === 'undefined') return;
  window.__WHA_GLOW_VOLUMES__ = Array.from(glowVolumeRegistry.values()).map((v) => ({
    id: v.id,
    x: round(v.x),
    z: round(v.z),
    radius: round(v.radius),
    yMin: round(v.yMin),
    yMax: round(v.yMax),
    color: v.color,
    intensity: round(v.intensity),
  }));
}

function pointInsideGlowVolume(x, y, z, volume) {
  if (y < volume.yMin || y > volume.yMax) return false;
  const dx = x - volume.x;
  const dz = z - volume.z;
  return dx * dx + dz * dz <= volume.radius * volume.radius;
}

// Stable registration hook so a glow-column spell (or a test) can light up the
// rain without importing scene internals: window.__WHA_REGISTER_GLOW_VOLUME__(v)
// returns an unregister callback.
if (typeof window !== 'undefined') {
  window.__WHA_REGISTER_GLOW_VOLUME__ = registerGlowVolume;
  publishGlowVolumes();
}

function resetRainDrop(drop, spreadColumn) {
  drop.x = RAIN_AREA.minX + Math.random() * (RAIN_AREA.maxX - RAIN_AREA.minX);
  drop.z = RAIN_AREA.minZ + Math.random() * (RAIN_AREA.maxZ - RAIN_AREA.minZ);
  drop.y = spreadColumn ? Math.random() * RAIN_SPAWN_TOP : RAIN_SPAWN_TOP + Math.random() * 1.6;
  drop.speed = 7.5 + Math.random() * 6;
  drop.length = 0.34 + Math.random() * 0.42;
  drop.thickness = 0.012 + Math.random() * 0.01;
  return drop;
}

function createRainDrops(count) {
  const drops = [];
  for (let index = 0; index < count; index += 1) {
    drops.push(resetRainDrop({ x: 0, y: 0, z: 0, speed: 0, length: 0, thickness: 0 }, true));
  }
  return drops;
}

function createRainSplashes(count) {
  const splashes = [];
  for (let index = 0; index < count; index += 1) {
    splashes.push({ x: 0, y: 0, z: 0, life: 0, ttl: 0.34, active: false, color: new THREE.Color() });
  }
  return splashes;
}

function publishRainWaterObjects(dropCount, glowingCount, glowVolumeCount) {
  if (typeof window === 'undefined') return;
  window.__WHA_WATER_OBJECTS__ = [
    {
      id: 'weather-rain',
      kind: 'rain',
      renderer: 'three',
      materialFamily: 'water',
      materialState: 'liquid',
      instanced: true,
      // Each drop is an individual water object; reported as a batched group.
      dropCount,
      glowingCount,
      reactsToGlowVolumes: true,
      activeGlowVolumes: glowVolumeCount,
    },
  ];
}

function Weather({ weatherMode }) {
  if (weatherMode !== 'rain') return null;
  return <RainSystem />;
}

function RainSystem() {
  const dropsMeshRef = useRef(null);
  const splashMeshRef = useRef(null);
  const splashCursorRef = useRef(0);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorScratch = useMemo(() => new THREE.Color(), []);
  const volumeScratch = useRef([]);
  const drops = useMemo(() => createRainDrops(RAIN_DROP_COUNT), []);
  const splashes = useMemo(() => createRainSplashes(RAIN_SPLASH_COUNT), []);

  // Seed instance matrices/colors once so the first painted frame is correct.
  useEffect(() => {
    const dropsMesh = dropsMeshRef.current;
    const splashMesh = splashMeshRef.current;
    if (dropsMesh) {
      drops.forEach((drop, index) => {
        dummy.position.set(drop.x, drop.y, drop.z);
        dummy.rotation.set(RAIN_TILT.x, 0, RAIN_TILT.z);
        dummy.scale.set(drop.thickness, drop.length, drop.thickness);
        dummy.updateMatrix();
        dropsMesh.setMatrixAt(index, dummy.matrix);
        dropsMesh.setColorAt(index, RAIN_BASE_COLOR);
      });
      dropsMesh.instanceMatrix.needsUpdate = true;
      if (dropsMesh.instanceColor) dropsMesh.instanceColor.needsUpdate = true;
    }
    if (splashMesh) {
      dummy.position.set(0, -100, 0);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.setScalar(0.0001);
      dummy.updateMatrix();
      for (let index = 0; index < RAIN_SPLASH_COUNT; index += 1) {
        splashMesh.setMatrixAt(index, dummy.matrix);
        splashMesh.setColorAt(index, colorScratch.setRGB(0, 0, 0));
      }
      splashMesh.instanceMatrix.needsUpdate = true;
      if (splashMesh.instanceColor) splashMesh.instanceColor.needsUpdate = true;
    }
    return () => {
      if (typeof window !== 'undefined') window.__WHA_WATER_OBJECTS__ = [];
    };
  }, [colorScratch, drops, dummy]);

  useFrame((_, delta) => {
    const dropsMesh = dropsMeshRef.current;
    const splashMesh = splashMeshRef.current;
    if (!dropsMesh) return;
    const dt = Math.min(0.05, Math.max(0, delta));

    // Snapshot active glow volumes once per frame (usually 0–2).
    const volumes = volumeScratch.current;
    volumes.length = 0;
    for (const volume of glowVolumeRegistry.values()) volumes.push(volume);

    let glowingCount = 0;
    for (let index = 0; index < drops.length; index += 1) {
      const drop = drops[index];
      drop.y -= drop.speed * dt;
      drop.x += RAIN_WIND.x * dt;
      drop.z += RAIN_WIND.z * dt;

      const ground = terrainHeightAt(drop.x, drop.z);
      if (drop.y <= ground) {
        // The drop is a water object landing: emit a splash that inherits the
        // drop's current look (so a glowing drop leaves a glowing splash).
        let splashColor = RAIN_SPLASH_BASE_COLOR;
        for (let v = 0; v < volumes.length; v += 1) {
          if (pointInsideGlowVolume(drop.x, ground + 0.05, drop.z, volumes[v])) {
            splashColor = volumes[v]._color;
            break;
          }
        }
        if (splashMesh) {
          const splash = splashes[splashCursorRef.current];
          splashCursorRef.current = (splashCursorRef.current + 1) % splashes.length;
          splash.x = drop.x;
          splash.z = drop.z;
          splash.y = ground;
          splash.life = 0;
          splash.active = true;
          splash.color.copy(splashColor);
        }
        resetRainDrop(drop, false);
      }

      let glowing = false;
      for (let v = 0; v < volumes.length; v += 1) {
        if (pointInsideGlowVolume(drop.x, drop.y, drop.z, volumes[v])) {
          colorScratch.copy(volumes[v]._color);
          glowing = true;
          glowingCount += 1;
          break;
        }
      }
      if (!glowing) colorScratch.copy(RAIN_BASE_COLOR);

      dummy.position.set(drop.x, drop.y, drop.z);
      dummy.rotation.set(RAIN_TILT.x, 0, RAIN_TILT.z);
      dummy.scale.set(drop.thickness, drop.length * (glowing ? 1.3 : 1), drop.thickness);
      dummy.updateMatrix();
      dropsMesh.setMatrixAt(index, dummy.matrix);
      dropsMesh.setColorAt(index, colorScratch);
    }
    dropsMesh.instanceMatrix.needsUpdate = true;
    if (dropsMesh.instanceColor) dropsMesh.instanceColor.needsUpdate = true;

    if (splashMesh) {
      for (let index = 0; index < splashes.length; index += 1) {
        const splash = splashes[index];
        if (splash.active) {
          splash.life += dt;
          if (splash.life >= splash.ttl) splash.active = false;
        }
        if (!splash.active) {
          dummy.position.set(0, -100, 0);
          dummy.scale.setScalar(0.0001);
          dummy.updateMatrix();
          splashMesh.setMatrixAt(index, dummy.matrix);
          splashMesh.setColorAt(index, colorScratch.setRGB(0, 0, 0));
          continue;
        }
        const progress = splash.life / splash.ttl;
        const grow = 0.5 + progress * 1.9;
        dummy.position.set(splash.x, splash.y + 0.014, splash.z);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(grow, grow, grow);
        dummy.updateMatrix();
        splashMesh.setMatrixAt(index, dummy.matrix);
        splashMesh.setColorAt(index, colorScratch.copy(splash.color).multiplyScalar(1 - progress));
      }
      splashMesh.instanceMatrix.needsUpdate = true;
      if (splashMesh.instanceColor) splashMesh.instanceColor.needsUpdate = true;
    }

    publishRainWaterObjects(drops.length, glowingCount, volumes.length);
  });

  return (
    <group name="weather-rain">
      <instancedMesh
        ref={dropsMeshRef}
        name="weather-rain-drops"
        args={[undefined, undefined, RAIN_DROP_COUNT]}
        frustumCulled={false}
      >
        <cylinderGeometry args={[1, 1, 1, 5, 1]} />
        <meshBasicMaterial transparent opacity={0.82} depthWrite={false} toneMapped={false} />
      </instancedMesh>
      <instancedMesh
        ref={splashMeshRef}
        name="weather-rain-splashes"
        args={[undefined, undefined, RAIN_SPLASH_COUNT]}
        frustumCulled={false}
      >
        <ringGeometry args={[0.02, 0.05, 14]} />
        <meshBasicMaterial
          transparent
          opacity={0.9}
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </instancedMesh>
    </group>
  );
}

function SceneDebug({ runtimeResult, placedSpells = [], sources, props, environmentMode, weatherMode, timelinePaused }) {
  const { gl, invalidate, scene } = useThree();
  const publishWorldObjectLabelCount = () => {
    let count = 0;
    for (const groupName of ['scene-sources', 'scene-props']) {
      scene.getObjectByName(groupName)?.traverse((object) => {
        if (object.isSprite === true) count += 1;
      });
    }
    window.__WHA_WORLD_OBJECT_LABEL_COUNT__ = count;
  };
  const publishPlacedSpellDebug = () => {
    const records = placedSpells.map((spell) => ({
      id: spell.id,
      templateId: spell.templateId,
      name: spell.name,
      copyNumber: spell.copyNumber,
      active: spell.runtimeResult?.lifecycle?.active === true,
      phase: spell.runtimeResult?.lifecycle?.phase ?? 'inactive',
      mode: spell.activationMode,
      durationMs: spell.activationDurationMs,
      elapsedMs: spell.activationElapsedMs,
      anchor: spell.anchor,
      transform: spell.transform,
      placementFrame: spell.runtimeResult?.intents?.find(
        (intent) => intent.intentType === 'placement_frame',
      )?.frame ?? null,
    }));
    window.__WHA_PLACED_SPELLS__ = records;
    window.__WHA_SPELL_ACTIVATIONS__ = records.map((record) => ({
      id: record.id,
      active: record.active,
      phase: record.phase,
      mode: record.mode,
      durationMs: record.durationMs,
      elapsedMs: record.elapsedMs,
    }));
    window.__WHA_SPELL_ACTIVATION__ = window.__WHA_SPELL_ACTIVATIONS__[0] ?? null;
    window.__WHA_SPELL_REMOTE__ = null;
  };
  useEffect(() => {
    installThreeFeatureDebugGuard();
    const names = [
      ...expectedSceneFeatures(runtimeResult, weatherMode, sources, props),
      ...placedSpells.flatMap((spell) => [
        `placed-spell:${spell.id}`,
        `spell-note:${spell.id}`,
      ]),
    ];
    window.__WHA_RENDERER__ = 'three';
    window.__WHA_SCENE_READY__ = true;
    window.__WHA_SCENE_MESH_COUNT__ = names.length;
    window.__WHA_SCENE_FEATURES__ = names;
    window.__WHA_SCENE_ENVIRONMENT__ = { environmentMode, weatherMode };
    window.__WHA_ENVIRONMENT_LIGHTING__ = {
      renderer: 'three',
      environmentMode,
      weatherMode,
    };
    window.__WHA_LIGHT_EFFECTS__ = [];
    window.__WHA_SCENE_LEFTOVERS__ = [];
    publishWorldObjectLabelCount();
    window.__WHA_SPELL_CIRCLE_VISUAL__ = spellCircleDebug(runtimeResult);
    window.__WHA_DISPERSION_DEBUG__ = dispersionDebug(runtimeResult);
    publishPlacedSpellDebug();
    // The main canvas is demand-driven. Scene readiness is also the lifecycle
    // point that guarantees the first authored world frame is actually drawn.
    invalidate();
  }, [environmentMode, invalidate, placedSpells, props, runtimeResult, scene, sources, timelinePaused, weatherMode]);

  useFrame(() => {
    if ((window.__WHA_SCENE_FEATURES__?.length ?? 0) === 0) {
      const names = expectedSceneFeatures(runtimeResult, weatherMode, sources, props);
      window.__WHA_SCENE_MESH_COUNT__ = names.length;
      window.__WHA_SCENE_FEATURES__ = names;
    }
    window.__WHA_RENDERER__ = 'three';
    window.__WHA_SCENE_READY__ = true;
    publishWorldObjectLabelCount();
    window.__WHA_DISPERSION_DEBUG__ = dispersionDebug(runtimeResult);
    gl.setClearColor(environmentPalette(environmentMode).clear, 1);
  });
  return null;
}

function installThreeFeatureDebugGuard() {
  if (window.__WHA_SCENE_FEATURE_GUARD__ === 'three') return;
  const current = Array.isArray(window.__WHA_SCENE_FEATURES__) ? window.__WHA_SCENE_FEATURES__ : [];
  let cachedFeatures = current;
  Object.defineProperty(window, '__WHA_SCENE_FEATURES__', {
    configurable: true,
    get() {
      return cachedFeatures;
    },
    set(nextFeatures) {
      const next = Array.isArray(nextFeatures) ? nextFeatures : [];
      if (window.__WHA_RENDERER__ === 'three' && next.length === 0 && cachedFeatures.length > 0) {
        return;
      }
      cachedFeatures = next;
    },
  });
  window.__WHA_SCENE_FEATURE_GUARD__ = 'three';
}

function expectedSceneFeatures(runtimeResult, weatherMode, sources = [], props = []) {
  const names = [
    'three-practice-world',
    'world-sky-dome',
    'practice-field-terrain',
    'yard-grass-cover',
    'yard-details',
    'yard-stepping-stones',
    'world-horizon-band',
    'world-sun-marker',
    'world-tree',
    'world-tree-trunk',
    'world-tree-canopy-0',
    'world-tree-canopy-1',
    'world-tree-canopy-2',
    'field-stone-0',
    'field-stone-1',
    'field-stone-2',
    'field-practice-crate-0',
    'field-practice-crate-1',
    'player-character',
    'player-shadow',
    'player-boots',
    'player-cloak',
    'player-face',
    'player-hat-brim',
    'player-hat-crown',
    `player-height:${PLAYER_HEIGHT}`,
    'dynamic-root',
  ];
  const circle = runtimeResult?.intents.find((intent) => intent.intentType === 'spell_circle_render_data');
  const lifecycle = runtimeResult?.lifecycle;
  names.push('scene-sources');
  for (const source of sources ?? []) {
    if (source.kind === 'water') {
      if (source.materialState === 'mist_cloud') {
        names.push(`mist-source:${source.id}`, `source:${source.id}`);
        for (let index = 0; index < 9; index += 1) {
          names.push(`mist-source-puff:${source.id}:${index}`);
        }
      } else {
        names.push(
          `water-basin:${source.id}`,
          `source:${source.id}`,
          `water-basin-rim:${source.id}`,
          `water-basin-level:${source.id}`,
        );
      }
    } else {
      names.push(`source:${source.id}`);
    }
  }
  names.push('scene-props');
  for (const prop of props ?? []) {
    names.push(`prop:${prop.id}`);
    if (prop.visualKind === 'tree_apple') {
      names.push(`prop-apple:${prop.id}`, `prop-apple-stem:${prop.id}`);
    } else if (prop.visualKind === 'tree_landmark') {
      names.push('world-tree', 'world-tree-trunk', 'world-tree-canopy-0', 'world-tree-canopy-1', 'world-tree-canopy-2');
    } else {
      names.push(`prop-box:${prop.id}`);
    }
  }
  if (circle?.active && circle.seals?.[0]) {
    const seal = circle.seals[0];
    const maxRadius = Math.max(
      120,
      ...seal.rings.map((ring) => ring.radius || 0),
      ...seal.symbols.map((symbol) => symbol.polarRadius || Math.hypot(symbol.position.x, symbol.position.y)),
    );
    const scale = 2.25 / maxRadius;
    const outerRingRadius = Math.max(
      ...(seal.rings.length > 0 ? seal.rings : [{ radius: 120 }]).map((ring) => ring.radius || 0),
    );
    const worldOuterRadius = Math.max(1.2, outerRingRadius * scale);
    const closed = lifecycle?.outerRingClosed !== false;
    const completion = clamp(Number(lifecycle?.outerRingCompletion ?? (closed ? 1 : 0)), 0, 1);
    const stateName = closed ? 'closed' : completion > 0 ? 'partial' : 'open';
    names.push(
      'spell-placement-root',
      'spell-placement-handle',
      `activation-ring-toggle:${stateName}`,
      `activation-ring-rail:${stateName}`,
      'spell-remote-root',
      'spell-remote-body',
      'spell-remote-socket',
      'spell-remote-hit-area',
      `spell-remote-state:${lifecycle?.phase ?? 'idle'}`,
      `spell-remote-timer:${lifecycle?.phase ?? 'idle'}`,
      `spell-remote-progress:${lifecycle?.phase ?? 'idle'}`,
    );
    if (!closed) names.push('spell-ring-open-gap');
    for (const ring of seal.rings.length > 0 ? seal.rings : [{ ringId: 'fallback', radius: 120 }]) {
      names.push(`spell-ring:${ring.ringId}`);
    }
    for (const symbol of seal.symbols) {
      names.push(`symbol:${symbol.objectId}`, `label:${symbol.objectId}`);
    }
    names.push(`spell-circle-radius:${round(worldOuterRadius)}`);
  }
  for (const intent of runtimeResult?.intents ?? []) {
    if (intent.intentType !== 'water_column' || !intent.active) continue;
    const worldThicknessRingRadius = worldThicknessRadiusForIntent(intent);
    const height = Number(intent.physicsField?.length ?? (
      Math.min(
        2.35,
        Math.max(0.9, intent.magnitude * 0.34 * Math.max(0.35, intent.signSizeScale ?? 1) + 0.78),
      ) * (intent.columnHeightMultiplier ?? 3)
    ));
    const radius = Math.max(0.08, worldThicknessRingRadius * (intent.columnRadiusRatio ?? 0.7));
    for (const plan of columnRenderPlans(intent, { x: 0, y: 0.22, z: 0 })) {
      const key = `${intent.id}${plan.nameSuffix}`;
      names.push(`water-column-system:${key}`, `water-column:${intent.id}${plan.nameSuffix}`);
      if (intent.renderPreset === 'mist_cloud' || intent.renderPreset === 'ice_chunk') {
        const detailCount = intent.renderPreset === 'mist_cloud' ? 8 : 5;
        for (let index = 0; index < detailCount; index += 1) {
          names.push(`water-column-state-detail:${intent.id}${plan.nameSuffix}:${index}`);
        }
      } else {
        const particleCount = clamp(Math.round(24 + radius * plan.radiusScale * 26 + height * 2.8), 28, 46);
        names.push(
          `water-column-inner-mass:${intent.id}${plan.nameSuffix}`,
          `water-column-emitter:${intent.id}${plan.nameSuffix}`,
        );
        for (let index = 0; index < 10; index += 1) {
          names.push(
            `water-column-surface-streak:${intent.id}${plan.nameSuffix}:${index}`,
            `water-column-top-spray:${intent.id}${plan.nameSuffix}:${index}`,
            `water-column-contact-mist:${intent.id}${plan.nameSuffix}:${index}`,
          );
        }
        for (let index = 0; index < particleCount; index += 1) {
          names.push(`water-column-particle:${intent.id}${plan.nameSuffix}:${index}`);
        }
        for (let index = 0; index < Math.min(14, particleCount); index += 1) {
          names.push(`water-column-splash:${intent.id}${plan.nameSuffix}:${index}`);
        }
      }
    }
  }
  for (const intent of runtimeResult?.intents ?? []) {
    if (intent.intentType !== 'water_dispersion' || !intent.active) continue;
    for (const plan of dispersionRenderPlans(intent, { x: 0, y: 0.22, z: 0 })) {
      names.push(
        `water-dispersion-system:${intent.id}${plan.nameSuffix}`,
        `dispersion-output:${intent.id}${plan.nameSuffix}:sheet`,
        `water-dispersion-falling-sheet:${intent.id}${plan.nameSuffix}`,
        `dispersion-origin:${intent.id}${plan.nameSuffix}`,
      );
      for (let index = 0; index < 8; index += 1) {
        names.push(`water-dispersion-particle:${intent.id}${plan.nameSuffix}:${index}`);
      }
    }
  }
  if (weatherMode === 'rain') {
    names.push('weather-rain', 'weather-rain-drops', 'weather-rain-splashes');
  }
  return names;
}

function spellCircleDebug(runtimeResult) {
  const circle = runtimeResult?.intents.find((intent) => intent.intentType === 'spell_circle_render_data');
  const seal = circle?.seals?.[0];
  if (!circle?.active || !seal) return null;
  const maxRadius = Math.max(
    120,
    ...seal.rings.map((ring) => ring.radius || 0),
    ...seal.symbols.map((symbol) => symbol.polarRadius || Math.hypot(symbol.position.x, symbol.position.y)),
  );
  const scale = 2.25 / maxRadius;
  const outerRingRadius = Math.max(
    ...(seal.rings.length > 0 ? seal.rings : [{ radius: 120 }]).map((ring) => ring.radius || 0),
  );
  const worldOuterRadius = Math.max(1.2, outerRingRadius * scale);
  return {
    maxSourceRadius: maxRadius,
    outerRingRadius,
    worldOuterRadius: round(worldOuterRadius),
    worldOuterDiameter: round(worldOuterRadius * 2),
    terrainWidth: 24,
    terrainHeight: 18,
    terrainWidthRatio: round((worldOuterRadius * 2) / 24),
    placementMode: circle.placementMode,
    renderer: 'three',
  };
}

function spellRemoteDebug(runtimeResult, timelinePaused) {
  const lifecycle = runtimeResult?.lifecycle;
  if (!lifecycle) return null;
  return {
    active: lifecycle.active,
    phase: lifecycle.phase,
    mode: lifecycle.mode,
    outerRingClosed: lifecycle.outerRingClosed,
    outerRingCompletion: lifecycle.outerRingCompletion,
    activationGate: lifecycle.activationGate,
    elapsedMs: lifecycle.elapsedMs,
    remainingMs: lifecycle.remainingMs,
    timelinePaused,
    interactive: true,
    screenPoint: null,
    renderer: 'three',
  };
}

function spellActivationDebug(runtimeResult, timelinePaused) {
  const lifecycle = runtimeResult?.lifecycle;
  if (!lifecycle) return null;
  return {
    active: lifecycle.active,
    phase: lifecycle.phase,
    requestedActive: lifecycle.requestedActive,
    outerRingClosed: lifecycle.outerRingClosed,
    outerRingCompletion: lifecycle.outerRingCompletion,
    activationCircuitState: lifecycle.activationCircuitState,
    activationGate: lifecycle.activationGate,
    elapsedMs: lifecycle.elapsedMs,
    remainingMs: lifecycle.remainingMs,
    timelinePaused,
    renderer: 'three',
  };
}

function dispersionDebug(runtimeResult) {
  return (runtimeResult?.intents ?? [])
    .filter((intent) => ['water_dispersion', 'material_dispersion'].includes(intent.intentType) && intent.active)
    .map((intent) => ({
      type: intent.intentType,
      materialKind: intent.materialKind,
      materialState: intent.materialState ?? null,
      phase: intent.phase,
      renderPreset: intent.renderPreset,
      origin: intent.origin,
      originPolicy: intent.originPolicy,
      sourceFreeOrigin: intent.sourceFreeOrigin === true,
      sourceId: intent.sourceId ?? null,
      sceneAxis: intent.sceneAxis,
      spread: intent.spread,
      emissionKind: intent.emissionKind,
      outputProfile: intent.outputProfile ?? null,
      gravityBehavior: intent.gravityBehavior ?? null,
      dispersionGeometry: intent.dispersionGeometry ?? null,
      interactionPolicy: intent.interactionPolicy ?? null,
      resourceBudget: intent.resourceBudget,
      renderer: 'three',
    }));
}

function createWaterColumnSurfaceGeometry(ringCount, segmentCount) {
  const positions = new Float32Array(ringCount * segmentCount * 3);
  const uvs = [];
  const indices = [];
  for (let ring = 0; ring < ringCount; ring += 1) {
    for (let segment = 0; segment < segmentCount; segment += 1) {
      uvs.push(segment / segmentCount, ring / Math.max(1, ringCount - 1));
    }
  }
  for (let ring = 0; ring < ringCount - 1; ring += 1) {
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const nextSegment = (segment + 1) % segmentCount;
      const a = ring * segmentCount + segment;
      const b = ring * segmentCount + nextSegment;
      const c = (ring + 1) * segmentCount + segment;
      const d = (ring + 1) * segmentCount + nextSegment;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.userData = { ringCount, segmentCount };
  geometry.computeVertexNormals();
  return geometry;
}

function updateWaterColumnSurfaceGeometry(geometry, system, timeSec, options = {}) {
  if (!geometry) return;
  const ringCount = geometry.userData.ringCount ?? 12;
  const segmentCount = geometry.userData.segmentCount ?? 14;
  const radiusScale = options.radiusScale ?? 1;
  const turbulenceScale = options.turbulenceScale ?? 1;
  const centerPulseScale = options.centerPulseScale ?? 1;
  const position = geometry.attributes.position;
  let cursor = 0;
  for (let ring = 0; ring < ringCount; ring += 1) {
    const t = ring / (ringCount - 1);
    const center = waterSurfaceCenter(system, t, timeSec, centerPulseScale);
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const angle = (segment / segmentCount) * Math.PI * 2;
      const surfaceRadius = waterSurfaceRadius(system, t, angle, timeSec) * radiusScale;
      const wrinkle =
        1 +
        Math.sin(angle * 3 + t * 8.2 - timeSec * 7.5 + system.seed * 5) * 0.08 * turbulenceScale +
        Math.cos(angle * 5 - t * 5.3 + timeSec * 4.8) * 0.045 * turbulenceScale;
      const x = Math.cos(angle) * surfaceRadius * wrinkle;
      const z = Math.sin(angle) * surfaceRadius * (0.82 + Math.sin(t * Math.PI) * 0.12);
      const vertex = center
        .clone()
        .add(system.basis.right.clone().multiplyScalar(x))
        .add(system.basis.up.clone().multiplyScalar(z));
      position.setXYZ(cursor, vertex.x, vertex.y, vertex.z);
      cursor += 1;
    }
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

function createIrregularPoolGeometry(pointCount, seed) {
  const positions = new Float32Array((pointCount + 1) * 3);
  const indices = [];
  for (let index = 1; index <= pointCount; index += 1) {
    const next = index === pointCount ? 1 : index + 1;
    indices.push(0, index, next);
  }
  const random = seededProfileRandom(seed, pointCount + 17);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.userData = {
    pointCount,
    outlineNoise: Array.from({ length: pointCount }, () => 0.72 + random() * 0.56),
  };
  geometry.computeVertexNormals();
  return geometry;
}

function updateIrregularPoolGeometry(geometry, pool) {
  if (!geometry) return;
  const pointCount = geometry.userData.pointCount ?? 24;
  const noise = geometry.userData.outlineNoise ?? [];
  const position = geometry.attributes.position;
  position.setXYZ(0, pool.center.x, pool.y, pool.center.z);
  const angleOffset = pool.angle ?? 0;
  for (let index = 0; index < pointCount; index += 1) {
    const angle = (index / pointCount) * Math.PI * 2;
    const edge = 1 + ((noise[index] ?? 1) - 1) * (pool.edgeNoise ?? 0.18);
    const localX = Math.cos(angle) * pool.radiusX * edge;
    const localZ = Math.sin(angle) * pool.radiusZ * edge;
    const rotatedX = localX * Math.cos(angleOffset) - localZ * Math.sin(angleOffset);
    const rotatedZ = localX * Math.sin(angleOffset) + localZ * Math.cos(angleOffset);
    position.setXYZ(index + 1, pool.center.x + rotatedX, pool.y, pool.center.z + rotatedZ);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

function updateSurfaceStreaks(meshes, system, timeSec) {
  for (const [index, streak] of meshes.entries()) {
    if (!streak) continue;
    const profile = lobeProfile(index, system.seed);
    const t = (profile.t + timeSec * profile.speed) % 1;
    if (t > system.activeLengthScale + 0.035) {
      streak.visible = false;
      continue;
    }
    streak.visible = true;
    const lateralWave = Math.sin(timeSec * profile.wobble + profile.phase);
    const surfaceRadius = waterSurfaceRadius(system, t, profile.phase, timeSec) * 1.02;
    const offset = system.basis.right
      .clone()
      .multiplyScalar(Math.cos(profile.phase + timeSec * 0.7) * surfaceRadius)
      .add(
        system.basis.up
          .clone()
          .multiplyScalar(Math.sin(profile.phase + timeSec * 0.7) * surfaceRadius + lateralWave * system.radius * 0.08),
      );
    streak.position.copy(
      system.origin.clone().add(system.dir.clone().multiplyScalar(system.height * t * system.activeLengthScale)).add(offset),
    );
    streak.quaternion.copy(quaternionFromUp(system.dir.clone().multiplyScalar(1.8).add(offset.clone().multiplyScalar(0.18))));
    const width = system.radius * (0.018 + profile.size * 0.012);
    streak.scale.set(width, system.radius * (0.2 + profile.size * 0.13), width * 0.7);
  }
}

function updateTopSpray(meshes, system, timeSec) {
  for (const [index, spray] of meshes.entries()) {
    if (!spray || !system.topBreakupAllowed || system.activeLengthScale < 0.68 || system.pressureContacts.coreBlocked) {
      if (spray) spray.visible = false;
      continue;
    }
    const profile = lobeProfile(index + 37, system.seed + 0.19);
    const age = (timeSec * (0.85 + profile.speed) + profile.t) % 1;
    const angle = profile.phase + Math.sin(timeSec * 1.7 + index) * 0.2;
    const outward = system.basis.right
      .clone()
      .multiplyScalar(Math.cos(angle))
      .add(system.basis.up.clone().multiplyScalar(Math.sin(angle)));
    const top = waterSurfaceCenter(system, 0.92, timeSec);
    const velocity = system.dir
      .clone()
      .multiplyScalar(0.7 + profile.size * 0.25)
      .add(outward.clone().multiplyScalar(0.55 + profile.radiusFactor * 0.45))
      .add(new THREE.Vector3(0, -0.45 * age, 0));
    spray.visible = age < 0.66;
    spray.position.copy(
      top
        .add(outward.clone().multiplyScalar(system.radius * (0.35 + age * 1.2)))
        .add(system.dir.clone().multiplyScalar(system.radius * (0.2 + age * 0.9)))
        .add(new THREE.Vector3(0, -age * age * 0.42, 0)),
    );
    spray.quaternion.copy(quaternionFromUp(velocity));
    const width = system.radius * (0.038 + profile.size * 0.018);
    spray.scale.set(width, width * (0.78 + age * 0.35), width * 0.76);
  }
}

function updateContactSpray(meshes, system, timeSec) {
  const contact = system.pressureContacts?.strongest;
  for (const [index, mist] of meshes.entries()) {
    if (!mist || !contact || contact.classification === 'none') {
      if (mist) mist.visible = false;
      continue;
    }
    const profile = lobeProfile(index + 151, system.seed + 0.41);
    const age = (timeSec * (1.4 + profile.speed) + profile.t) % 1;
    const sideAngle = profile.phase + age * 1.6;
    const side = system.basis.right
      .clone()
      .multiplyScalar(Math.cos(sideAngle))
      .add(system.basis.up.clone().multiplyScalar(Math.sin(sideAngle)));
    const blockedBoost = contact.classification === 'core_block' ? 1.35 : 1;
    const pressure = clamp(contact.localPressure / 7, 0.28, 1.35);
    const contactNormal = contact.contactNormal ?? side;
    const sprayDirection = side
      .clone()
      .multiplyScalar(0.45 + pressure * 0.34)
      .add(contactNormal.clone().multiplyScalar(0.24))
      .add(system.dir.clone().multiplyScalar(contact.classification === 'core_block' ? -0.16 : 0.12));
    mist.visible = age < 0.74;
    mist.position.copy(
      contact.contactPoint
        .clone()
        .add(sprayDirection.clone().multiplyScalar(system.radius * (0.35 + age * 2.1) * blockedBoost))
        .add(new THREE.Vector3(0, Math.sin(age * Math.PI) * system.radius * 0.55, 0)),
    );
    mist.quaternion.copy(quaternionFromUp(sprayDirection));
    const size = system.radius * (0.09 + profile.size * 0.055) * (1 - age * 0.38) * blockedBoost;
    mist.scale.set(size * 1.18, size * 0.82, size);
  }
}

function updateParticles(droplets, splashes, system, timeSec) {
  const particleStates = system.particles.map((particle) =>
    simulateWaterParticle(system, particle, (timeSec + particle.birthOffset) % particle.lifetime),
  );
  let inFlight = 0;
  let splash = 0;
  let fadedAfterSplash = 0;
  for (const [index, state] of particleStates.entries()) {
    const mesh = droplets[index];
    const particle = system.particles[index];
    if (!mesh) continue;
    if (state.state === 'flight') {
      inFlight += particle.volumeShare;
      mesh.visible = true;
      mesh.position.copy(state.position);
      mesh.quaternion.copy(quaternionFromUp(state.velocity ?? system.dir));
      const size = system.radius * (0.052 + particle.size * 0.026);
      mesh.scale.set(size * 0.86, size * 1.28, size * 0.82);
    } else if (state.state === 'splash') {
      splash += particle.volumeShare;
      mesh.visible = false;
    } else {
      mesh.visible = false;
      fadedAfterSplash += particle.volumeShare;
    }
  }
  for (const [index, mesh] of splashes.entries()) {
    const state = particleStates[index];
    const particle = system.particles[index];
    if (!mesh) continue;
    if (state?.state === 'splash') {
      mesh.visible = true;
      mesh.position.copy(state.position);
      mesh.quaternion.copy(quaternionFromUp(state.velocity ?? new THREE.Vector3(0, 1, 0)));
      const size = system.radius * (0.072 + particle.size * 0.036) * (1 - state.splashProgress * 0.46);
      mesh.scale.set(size * 1.15, size * 0.74, size * 0.92);
    } else {
      mesh.visible = false;
    }
  }
  return {
    total: system.particles.reduce((sum, particle) => sum + particle.volumeShare, 0),
    inFlight,
    splash,
    fadedAfterSplash,
  };
}

function waterDebug(system, clockMs, eruptionScale, volume) {
  const pressureContacts = system.pressureContacts ?? { contacts: [] };
  return {
    intentId: system.intent.id,
    renderer: 'three',
    visualPreset: 'three_pressure_stream_contact_solver_no_pooling',
    deterministic: true,
    keyframed: false,
    collisionDriven: true,
    collisionModel: 'ground_plane_first_pass',
    architecture: 'react_three_fiber_authored_visual_stream_plus_contact_debug',
    visualLayer: 'dense_water_mass_surface_turbulence_local_spray',
    physicsLayer: 'pressure_contact_solver_debug_only_no_direct_position_setting',
    eruptionDurationMs: 500,
    eruptionScale: round(eruptionScale),
    streamLengthScale: round(system.activeLengthScale),
    contactPolicy: 'local_contact_classification_edge_partial_core',
    poolingPolicy: 'disabled_by_visual_scope',
    primitivePolicy: 'dense_irregular_surface_no_stretched_sphere_or_cylinder',
    contactSolver: {
      enabled: true,
      contacts: pressureContacts.contacts.map((contact) => ({
        propId: contact.propId,
        classification: contact.classification,
        coverage: round(contact.coverage),
        radialFalloff: round(contact.radialFalloff),
        axialDistance: round(contact.axialDistance),
        localPressure: round(contact.localPressure),
        forceMode: 'debug_vector_only_until_rigid_body_adapter',
        contactPoint: vectorDebug(contact.contactPoint),
      })),
      coreBlocked: pressureContacts.coreBlocked,
      strongestContactType: pressureContacts.strongest?.classification ?? 'none',
    },
    seed: round(system.seed),
    simulationTimeMs: Math.round(clockMs),
    particleCount: system.particleCount,
    poolCount: 0,
    volume: {
      total: round(volume.total),
      inFlight: round(volume.inFlight),
      splash: round(volume.splash),
      fadedAfterSplash: round(volume.fadedAfterSplash),
    },
    pools: [],
  };
}

function solveWaterColumnContacts(system, props, eruptionScale) {
  const activeHeight = Math.max(system.height * eruptionScale, system.radius * 0.5);
  const contacts = [];
  for (const prop of props ?? []) {
    if (prop.visualKind === 'activation_ring_key') continue;
    const contact = classifyWaterColumnPropContact(system, prop, activeHeight);
    if (contact.classification !== 'none') contacts.push(contact);
  }
  contacts.sort((a, b) => b.localPressure - a.localPressure);
  const strongest = contacts[0] ?? null;
  const coreBlocked = strongest?.classification === 'core_block';
  const streamLengthScale = coreBlocked
    ? clamp(strongest.axialDistance / Math.max(0.001, system.height), 0.16, 1)
    : 1;
  return { contacts, strongest, coreBlocked, streamLengthScale };
}

function classifyWaterColumnPropContact(system, prop, activeHeight) {
  const bounds = propContactBounds(prop);
  const samples = propContactSamples(bounds);
  const pressureRadius = system.radius * 1.45 + bounds.radius * 0.15;
  let insideCount = 0;
  let coreCount = 0;
  const weightedPoint = new THREE.Vector3();
  let totalWeight = 0;
  let axialTotal = 0;
  let radialFalloffTotal = 0;
  const contactNormal = new THREE.Vector3();
  for (const point of samples) {
    const relative = point.clone().sub(system.origin);
    const axial = relative.dot(system.dir);
    if (axial < 0 || axial > activeHeight) continue;
    const centerlinePoint = system.origin.clone().add(system.dir.clone().multiplyScalar(axial));
    const radial = point.clone().sub(centerlinePoint);
    const radialDistance = radial.length();
    if (radialDistance > pressureRadius) continue;
    const radialFalloff = 1 - clamp(radialDistance / pressureRadius, 0, 1);
    const weight = 0.2 + radialFalloff * radialFalloff;
    insideCount += 1;
    if (radialDistance <= system.radius * 0.5) coreCount += 1;
    weightedPoint.add(point.clone().multiplyScalar(weight));
    totalWeight += weight;
    axialTotal += axial * weight;
    radialFalloffTotal += radialFalloff * weight;
    if (radialDistance > 0.0001) contactNormal.add(radial.normalize().multiplyScalar(weight));
  }
  if (insideCount === 0 || totalWeight <= 0) return { propId: prop.id, classification: 'none' };
  const coverage = insideCount / samples.length;
  const contactPoint = weightedPoint.multiplyScalar(1 / totalWeight);
  const axialDistance = axialTotal / totalWeight;
  const radialFalloff = radialFalloffTotal / totalWeight;
  const classification =
    coreCount > 0 && coverage >= 0.18
      ? 'core_block'
      : coverage >= 0.28 || insideCount >= 5
        ? 'partial_hit'
        : 'edge_graze';
  const mass = Math.max(0.2, prop.mass ?? (prop.movable === false ? 120 : 4));
  const pressure = (system.intent.resourceBudget?.amount ?? 8) * (0.8 + radialFalloff * 1.4);
  return {
    propId: prop.id,
    classification,
    movable: prop.movable !== false,
    coverage,
    radialFalloff,
    axialDistance,
    contactPoint,
    contactNormal:
      contactNormal.lengthSq() > 0.0001
        ? contactNormal.normalize()
        : system.dir.clone().multiplyScalar(-1),
    localPressure: pressure / Math.sqrt(mass),
  };
}

function propContactBounds(prop) {
  const dimensions = mainWorldPropDimensions(prop);
  if (prop.visualKind === 'tree_apple') {
    const diameter = Math.max(0.12, (prop.size ?? 0.42) * 0.5);
    const center = toVector3(prop.position, 0.22);
    return {
      center,
      half: new THREE.Vector3(diameter / 2, diameter / 2, diameter / 2),
      radius: diameter / 2,
    };
  }
  const center = toVector3(prop.position, mainWorldPropCenterOffset(prop));
  const half = new THREE.Vector3(dimensions.x / 2, dimensions.y / 2, dimensions.z / 2);
  return {
    center,
    half,
    radius: half.length(),
  };
}

function propContactSamples(bounds) {
  const { center, half } = bounds;
  const samples = [center.clone()];
  samples.push(
    center.clone().add(new THREE.Vector3(half.x, 0, 0)),
    center.clone().add(new THREE.Vector3(-half.x, 0, 0)),
    center.clone().add(new THREE.Vector3(0, half.y, 0)),
    center.clone().add(new THREE.Vector3(0, -half.y, 0)),
    center.clone().add(new THREE.Vector3(0, 0, half.z)),
    center.clone().add(new THREE.Vector3(0, 0, -half.z)),
  );
  for (const x of [-half.x, half.x]) {
    for (const y of [-half.y, half.y]) {
      for (const z of [-half.z, half.z]) {
        samples.push(center.clone().add(new THREE.Vector3(x, y, z)));
      }
    }
  }
  return samples;
}

function waterSurfaceCenter(system, t, timeSec, pulseScale = 1) {
  const activeHeight = system.activeHeight ?? system.height;
  const sway =
    Math.sin(t * Math.PI * 1.4 + timeSec * 2.1 + system.seed * 4) *
    system.radius *
    0.055 *
    pulseScale;
  const pulse = Math.sin(t * Math.PI * 4.6 - timeSec * 6.8) * system.radius * 0.022 * pulseScale;
  return system.origin
    .clone()
    .add(system.dir.clone().multiplyScalar(activeHeight * t))
    .add(system.basis.right.clone().multiplyScalar(sway))
    .add(system.basis.up.clone().multiplyScalar(pulse));
}

function waterSurfaceRadius(system, t, angle, timeSec) {
  const eruptionOpening = clamp((system.activeLengthScale ?? 1) * 1.35, 0.22, 1);
  const throat = 0.76 + Math.sin(t * Math.PI) * 0.22;
  const base = system.radius * throat * eruptionOpening;
  const contactCompression = system.pressureContacts?.coreBlocked
    ? 1 - Math.max(0, t - (system.pressureContacts.streamLengthScale ?? 1) * 0.78) * 0.38
    : 1;
  const risingBands =
    Math.sin(t * 13.5 - timeSec * 8.2 + angle * 1.7 + system.seed * 7) * 0.065 +
    Math.cos(t * 6.1 + timeSec * 2.8 - angle * 2.4) * 0.04;
  const emitterPressureBulge = Math.max(0, 1 - t * 4) * 0.16;
  const topBreakup = system.topBreakupAllowed ? Math.max(0, (t - 0.74) / 0.26) * -0.16 : 0;
  const bottomThroat = Math.max(0, 1 - t * 6) * -0.06;
  return Math.max(
    system.radius * 0.34 * eruptionOpening,
    base * (1 + risingBands + emitterPressureBulge + topBreakup + bottomThroat) * contactCompression,
  );
}

function waterParticleProfiles(count, radius, height, seed) {
  return Array.from({ length: count }, (_, index) => {
    const random = seededProfileRandom(seed, index);
    const angle = random() * Math.PI * 2;
    const radial = Math.sqrt(random()) * radius * 0.42;
    const sideSpeed = radius * (0.9 + random() * 1.2);
    const sideAngle = random() * Math.PI * 2;
    return {
      birthOffset: random() * 1.25,
      lifetime: 2.4 + random() * 1.25 + height * 0.08,
      radialX: Math.cos(angle) * radial,
      radialZ: Math.sin(angle) * radial,
      sideX: Math.cos(sideAngle) * sideSpeed,
      sideZ: Math.sin(sideAngle) * sideSpeed,
      upwardSpeed: 3.1 + height * 0.34 + random() * 0.85,
      drag: 0.82 + random() * 0.08,
      size: 0.6 + random() * 0.8,
      volumeShare: 1 / count,
    };
  });
}

function simulateWaterParticle(system, particle, ageSec) {
  const gravity = new THREE.Vector3(0, -9.8, 0);
  let position = system.origin
    .clone()
    .add(system.basis.right.clone().multiplyScalar(particle.radialX))
    .add(system.basis.up.clone().multiplyScalar(particle.radialZ));
  let velocity = system.dir
    .clone()
    .multiplyScalar(particle.upwardSpeed)
    .add(system.basis.right.clone().multiplyScalar(particle.sideX))
    .add(system.basis.up.clone().multiplyScalar(particle.sideZ));
  const groundY = 0.052;
  let elapsed = 0;
  while (elapsed < ageSec) {
    const dt = Math.min(1 / 36, ageSec - elapsed);
    velocity = velocity.add(gravity.clone().multiplyScalar(dt));
    velocity = velocity.multiplyScalar(Math.pow(particle.drag, dt));
    const next = position.clone().add(velocity.clone().multiplyScalar(dt));
    if (next.y <= groundY && velocity.y < 0) {
      const hitT = clamp((position.y - groundY) / Math.max(0.0001, position.y - next.y), 0, 1);
      const impactPosition = position.clone().lerp(next, hitT);
      const impactVelocity = velocity.clone();
      const afterImpact = ageSec - elapsed - dt * hitT;
      if (afterImpact < 0.42) {
        const splashVelocity = new THREE.Vector3(
          impactVelocity.x * 0.34 + particle.sideX * 0.18,
          Math.abs(impactVelocity.y) * 0.28 + 0.45,
          impactVelocity.z * 0.34 + particle.sideZ * 0.18,
        );
        const splashPosition = impactPosition
          .clone()
          .add(splashVelocity.clone().multiplyScalar(afterImpact))
          .add(gravity.clone().multiplyScalar(0.5 * afterImpact * afterImpact));
        splashPosition.y = Math.max(groundY + 0.018, splashPosition.y);
        return {
          state: 'splash',
          position: splashPosition,
          velocity: splashVelocity,
          impactPosition,
          splashProgress: afterImpact / 0.42,
        };
      }
      return { state: 'spent', impactPosition };
    }
    position = next;
    elapsed += dt;
  }
  return { state: 'flight', position, velocity };
}

function lobeProfile(index, seed) {
  const random = seededProfileRandom(seed + 0.37, index + 91);
  return {
    t: random(),
    speed: 0.09 + random() * 0.18,
    radiusFactor: 0.18 + random() * 0.56,
    phase: random() * Math.PI * 2,
    wobble: 2.3 + random() * 4.8,
    size: 0.7 + random() * 0.8,
  };
}

function seededProfileRandom(seed, index) {
  let state = Math.floor((seed * 1000000 + index * 1013904223) % 2147483647);
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function hashStringToUnit(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1000000) / 1000000;
}

function columnRenderPlans(intent, fallbackOrigin) {
  const anchors = intent.emergence?.anchors ?? [];
  if (anchors.length === 0) {
    return [
      {
        origin: toVector3(intent.origin ?? fallbackOrigin),
        nameSuffix: '',
        anchor: null,
        budgetShare: 1,
        radiusScale: 1,
      },
    ];
  }
  return anchors.map((anchor, index) => {
    const budgetShare = clamp(anchor.budgetShare ?? 1 / anchors.length, 0, 1);
    return {
      origin: toVector3(anchor.scenePosition ?? intent.origin ?? fallbackOrigin),
      nameSuffix: anchors.length === 1 ? '' : `:${safeMeshId(anchor.anchorId ?? `anchor-${index}`)}`,
      anchor,
      budgetShare,
      radiusScale: Math.max(0.35, Math.sqrt(budgetShare || 1 / anchors.length)),
    };
  });
}

function dispersionRenderPlans(intent, fallbackOrigin) {
  return [{
    origin: toVector3(intent.origin ?? fallbackOrigin),
    nameSuffix: '',
    anchor: null,
    index: 0,
    budgetShare: 1,
    radiusScale: 1,
  }];
}

function worldThicknessRadiusForIntent(intent) {
  const source = intent.renderGeometry ?? intent.geometry ?? intent;
  const explicitWorldRadius = Number(
    source.worldThicknessRingRadius ?? source.worldRadius ?? source.radiusWorld,
  );
  if (Number.isFinite(explicitWorldRadius)) return Math.max(0.2, explicitWorldRadius);
  const displayMaxRadius = Math.max(
    120,
    Number(intent.displayMaxRadius ?? intent.thicknessRingRadius ?? 120),
  );
  const rawRingRadius = Math.max(1, Number(intent.thicknessRingRadius ?? displayMaxRadius));
  return Math.max(
    1.2,
    (rawRingRadius * 1.2) / displayMaxRadius,
  );
}

function symbolPosition(symbol, scale) {
  if (symbol.position) {
    return {
      x: (symbol.position.x ?? 0) * scale,
      // The render group's local +Z is opposite the compiler frame's
      // bitangent. Mirror program Y so each sign is drawn on the same side
      // that owns its column push contribution.
      z: -(symbol.position.y ?? 0) * scale,
    };
  }
  const angle = ((symbol.polarAngleDeg ?? 0) * Math.PI) / 180;
  const radius = (symbol.polarRadius ?? 0) * scale;
  return { x: Math.cos(angle) * radius, z: -Math.sin(angle) * radius };
}

function centeredDispersionOrigin(frame) {
  return toVector3(frame.origin)
    .add(frame.normal.clone().multiplyScalar(0.22 * frame.worldScale));
}

function anchorForPolarAngle(angleDeg = 0) {
  const radians = (Number(angleDeg) * Math.PI) / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

function environmentPalette(environmentMode) {
  if (environmentMode === 'night') {
    return {
      clear: '#0f1421',
      fog: '#101827',
      sky: '#0a0f1f',
      ambient: 0.28,
      sun: 0.16,
      ambientColor: '#8e9ec4',
      sunColor: '#b9c3e8',
    };
  }
  if (environmentMode === 'dusk') {
    return {
      clear: '#9e758c',
      fog: '#9e758c',
      sky: '#ad6b75',
      ambient: 0.48,
      sun: 0.44,
      ambientColor: '#f1c5ae',
      sunColor: '#ffc083',
    };
  }
  return {
    clear: '#b8d9f0',
    fog: '#b8d9f0',
    sky: '#9ec7eb',
    ambient: 0.78,
    sun: 0.82,
    ambientColor: '#e7f5db',
    sunColor: '#fff0c8',
  };
}

function normalizeFrame(frame = DEFAULT_FRAME) {
  const normal = toSceneAxis(frame.normal ?? DEFAULT_FRAME.normal);
  const tangent = toSceneAxis(frame.tangent ?? DEFAULT_FRAME.tangent);
  const bitangent =
    frame.bitangent != null
      ? toSceneAxis(frame.bitangent)
      : new THREE.Vector3().crossVectors(normal, tangent).normalize();
  return {
    origin: frame.origin ?? DEFAULT_FRAME.origin,
    normal,
    tangent,
    bitangent,
    worldScale: clamp(
      Number(frame.worldScale ?? MIN_PLACED_SPELL_SCALE),
      MIN_PLACED_SPELL_SCALE,
      4,
    ),
  };
}

function mapAxis(axis) {
  const mapped = axis
    ? new THREE.Vector3(axis.x ?? 0, axis.z ?? 1, axis.y ?? 0)
    : new THREE.Vector3(0, 1, 0);
  if (mapped.lengthSq() <= 0.000001) return new THREE.Vector3(0, 1, 0);
  return mapped.normalize();
}

function toSceneAxis(axis) {
  if (axis instanceof THREE.Vector3) return axis.clone().normalize();
  const vector = new THREE.Vector3(axis?.x ?? 0, axis?.y ?? 1, axis?.z ?? 0);
  if (vector.lengthSq() <= 0.000001) return new THREE.Vector3(0, 1, 0);
  return vector.normalize();
}

function perpendicularBasis(direction) {
  const dir = direction.lengthSq() > 0.000001 ? direction.clone().normalize() : new THREE.Vector3(0, 1, 0);
  const reference = Math.abs(dir.dot(new THREE.Vector3(0, 1, 0))) > 0.92
    ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(dir, reference).normalize();
  const up = new THREE.Vector3().crossVectors(right, dir).normalize();
  return { right, up };
}

function quaternionFromUp(direction) {
  const dir = direction.lengthSq() > 0.000001 ? direction.clone().normalize() : new THREE.Vector3(0, 1, 0);
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
}

function quaternionFromFrame(normalInput, tangentInput) {
  const normal = toSceneAxis(normalInput);
  let tangent = toSceneAxis(tangentInput);
  tangent = tangent.sub(normal.clone().multiplyScalar(tangent.dot(normal))).normalize();
  if (tangent.lengthSq() <= 0.000001) {
    tangent = Math.abs(normal.y) > 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0).cross(normal).normalize();
  }
  const localZ = new THREE.Vector3().crossVectors(tangent, normal).normalize();
  const matrix = new THREE.Matrix4().makeBasis(tangent, normal, localZ);
  return new THREE.Quaternion().setFromRotationMatrix(matrix);
}

function toVector3(position = {}, yOverride) {
  return new THREE.Vector3(position.x ?? 0, yOverride ?? position.y ?? 0, position.z ?? 0);
}

function vectorArray(position = {}, yOverride) {
  return [position.x ?? 0, yOverride ?? position.y ?? 0, position.z ?? 0];
}

function vectorDebug(vector) {
  return {
    x: round(vector.x ?? 0),
    y: round(vector.y ?? 0),
    z: round(vector.z ?? 0),
  };
}

function safeMeshId(value) {
  return String(value).replace(/[^a-zA-Z0-9:_-]/g, '-');
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function horizontalBasis(forwardInput) {
  const forward = new THREE.Vector3(forwardInput.x, 0, forwardInput.z);
  if (forward.lengthSq() <= 0.000001) forward.set(0, 0, -1);
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  return { forward, right };
}

function lookDirectionFor(yaw, pitch) {
  const horizontal = Math.cos(pitch);
  return new THREE.Vector3(
    Math.sin(yaw) * horizontal,
    Math.sin(pitch),
    Math.cos(yaw) * horizontal,
  ).normalize();
}

function resolveThirdPersonCamera(playerPosition, yaw, pitch, playerController) {
  const lookDirection = lookDirectionFor(yaw, pitch);
  const right = new THREE.Vector3().crossVectors(lookDirection, new THREE.Vector3(0, 1, 0));
  if (right.lengthSq() <= 0.000001) right.set(1, 0, 0);
  else right.normalize();
  const pivot = new THREE.Vector3(
    playerPosition.x,
    playerPosition.y + PLAYER_HEAD_HEIGHT - 0.12,
    playerPosition.z,
  );
  const desiredPosition = pivot.clone()
    .addScaledVector(lookDirection, -THIRD_PERSON_DISTANCE)
    .addScaledVector(right, THIRD_PERSON_SHOULDER_OFFSET)
    .add(new THREE.Vector3(0, THIRD_PERSON_LIFT, 0));
  const boom = desiredPosition.clone().sub(pivot);
  const desiredBoomDistance = boom.length();
  const boomDirection = boom.normalize();
  const cameraUp = new THREE.Vector3().crossVectors(right, lookDirection).normalize();
  const cameraProbeOffsets = [
    new THREE.Vector3(),
    right.clone().multiplyScalar(0.16),
    right.clone().multiplyScalar(-0.16),
    cameraUp.clone().multiplyScalar(0.11),
    cameraUp.clone().multiplyScalar(-0.11),
  ];
  let resolvedFraction = 1;
  for (const offset of cameraProbeOffsets) {
    const probe = desiredPosition.clone().add(offset).sub(pivot);
    const probeDistance = probe.length();
    probe.normalize();
    const hitDistance = playerController?.cameraObstructionDistance?.(
      { x: pivot.x, y: pivot.y, z: pivot.z },
      { x: probe.x, y: probe.y, z: probe.z },
      probeDistance,
    );
    if (Number.isFinite(hitDistance)) {
      resolvedFraction = Math.min(resolvedFraction, hitDistance / probeDistance);
    }
  }
  const obstructed = resolvedFraction < 1;
  const resolvedBoomDistance = obstructed
    ? Math.max(0.32, desiredBoomDistance * resolvedFraction - THIRD_PERSON_COLLISION_CLEARANCE)
    : desiredBoomDistance;
  return {
    position: pivot.clone().addScaledVector(boomDirection, resolvedBoomDistance),
    desiredPosition,
    pivot,
    lookDirection,
    desiredBoomDistance,
    resolvedBoomDistance,
    obstructed,
  };
}

function setCameraFov(camera, fov) {
  if (camera.fov === fov) return;
  camera.fov = fov;
  camera.updateProjectionMatrix();
}

function readPlayerPitch(state, fallback = 0) {
  const raw = state?.pitch ?? (
    state?.pitchDeg == null ? fallback : THREE.MathUtils.degToRad(Number(state.pitchDeg))
  );
  const pitch = Number(raw);
  return clamp(Number.isFinite(pitch) ? pitch : fallback, -PLAYER_PITCH_LIMIT, PLAYER_PITCH_LIMIT);
}

function normalizeYaw(value) {
  const fullTurn = Math.PI * 2;
  return ((value + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
}

function round(value) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
