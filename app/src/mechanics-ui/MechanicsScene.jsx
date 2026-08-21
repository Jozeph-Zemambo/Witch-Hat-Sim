import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import {
  COGWHEEL_PRESETS,
  MECHANICAL_MATERIALS,
  PRIMITIVE_SHAPES,
  addVector,
  descendantPartIds,
  normalizeVector,
  planCogwheelPlacement,
  quaternionBetweenVectors,
  scaleVector,
  transformDirection,
} from '../../../src/mechanics-engine/index.js';
import {
  MechanicalCogwheelGeometry,
  MechanicalPartGeometry,
} from './MechanicalPartGeometry.jsx';
import { loadRapier } from '../mechanics/rapier-loader.js';
import { RapierMechanicsWorld } from '../mechanics/RapierMechanicsWorld.js';
import { evaluateMountedSpellDevices } from '../mechanics/spell-device-system.js';
import {
  emphasizeUniformScaleHandle,
  installDirectionalUniformScale,
  installTransformAxisLatch,
} from '../mechanics/transformControlInteraction.js';
import { SimSpellOutputPresentation } from '../scene/ThreeScene.jsx';
import { LIGHT_MAGIC } from '../visual/lightMagic.js';
import {
  LabelSprite,
  MechanicalRelationshipVisuals,
  RelationshipPresentation,
  relationshipEndpointInfo,
} from './RelationshipVisuals.jsx';

export default function MechanicsScene({
  document,
  mode,
  activeTool,
  placementPreset,
  cogPreset,
  selectedAssemblyIds,
  selectedMechanicId,
  focusedNode,
  previewNode,
  editorOpacityPreview,
  transformMode,
  onSelectAssembly,
  onSelectMechanic,
  onMoveAssembly,
  onTransformSpellPlate,
  onMoveRelationshipEndpoint,
  onPlacePrimitive,
  onPlaceCog,
  onRuntimeSnapshot,
  runtimeResetToken,
  runtimeCommand,
  manualActiveDeviceIds,
  lightLevel = 1,
}) {
  return (
    <Canvas
      className="mechanics-canvas"
      data-testid="mechanics-canvas"
      aria-label="Mechanical construction field"
      camera={{ position: [8.5, 6.6, 10.5], fov: 44, near: 0.08, far: 120 }}
      dpr={[1, 1.25]}
      gl={{ antialias: true, preserveDrawingBuffer: false }}
    >
      <MechanicsSceneContents
        document={document}
        mode={mode}
        activeTool={activeTool}
        placementPreset={placementPreset}
        cogPreset={cogPreset}
        selectedAssemblyIds={selectedAssemblyIds}
        selectedMechanicId={selectedMechanicId}
        focusedNode={focusedNode}
        previewNode={previewNode}
        editorOpacityPreview={editorOpacityPreview}
        transformMode={transformMode}
        onSelectAssembly={onSelectAssembly}
        onSelectMechanic={onSelectMechanic}
        onMoveAssembly={onMoveAssembly}
        onTransformSpellPlate={onTransformSpellPlate}
        onMoveRelationshipEndpoint={onMoveRelationshipEndpoint}
        onPlacePrimitive={onPlacePrimitive}
        onPlaceCog={onPlaceCog}
        onRuntimeSnapshot={onRuntimeSnapshot}
        runtimeResetToken={runtimeResetToken}
        runtimeCommand={runtimeCommand}
        manualActiveDeviceIds={manualActiveDeviceIds}
        lightLevel={lightLevel}
      />
    </Canvas>
  );
}

function MechanicsSceneContents(props) {
  const {
    document,
    mode,
    selectedAssemblyIds,
    selectedMechanicId,
    onRuntimeSnapshot,
    runtimeResetToken,
    runtimeCommand,
    manualActiveDeviceIds,
  } = props;
  const { camera, gl } = useThree();
  const worldRef = useRef(null);
  const assemblyRefs = useRef(new Map());
  const cameraControlsRef = useRef(null);
  const directManipulationRef = useRef(false);
  const placementGestureRef = useRef(null);
  const endpointDragRef = useRef(null);
  const endpointRaycasterRef = useRef(new THREE.Raycaster());
  const lastPublishRef = useRef(0);
  const lastCommandRef = useRef(null);
  const [physicsState, setPhysicsState] = useState('loading');
  const [runtimeView, setRuntimeView] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [placementPoint, setPlacementPoint] = useState(null);
  const [endpointPreview, setEndpointPreview] = useState(null);
  const [hoveredEndpoint, setHoveredEndpoint] = useState(null);
  const editableEndpointInfo = useMemo(
    () => mode === 'build' && props.activeTool === 'modify'
      ? relationshipEndpointInfo(document, runtimeView, selectedMechanicId)
      : null,
    [document, mode, props.activeTool, runtimeView, selectedMechanicId],
  );
  useEffect(() => {
    if (!editableEndpointInfo) {
      gl.domElement.dataset.mechanicsConnectionPoints = '';
      return;
    }
    const rect = gl.domElement.getBoundingClientRect();
    const screenPoint = (point) => {
      const projected = point.clone().project(camera);
      return {
        x: rect.left + (projected.x + 1) * rect.width / 2,
        y: rect.top + (1 - projected.y) * rect.height / 2,
      };
    };
    gl.domElement.dataset.mechanicsConnectionPoints = JSON.stringify({
      A: { ...screenPoint(editableEndpointInfo.pointA), assemblyId: editableEndpointInfo.assemblyAId },
      B: { ...screenPoint(editableEndpointInfo.pointB), assemblyId: editableEndpointInfo.assemblyBId },
    });
  }, [camera, editableEndpointInfo, gl]);
  useEffect(() => {
    gl.domElement.dataset.mechanicsConnectionEndpoint = hoveredEndpoint?.side ?? '';
    gl.domElement.dataset.mechanicsConnectionHost = hoveredEndpoint?.assemblyId ?? '';
  }, [gl, hoveredEndpoint]);
  const handleEndpointHover = useCallback((endpoint) => {
    // Keep this synchronous for input diagnostics and automation scans; React
    // state still drives the assembly highlight on the following render.
    gl.domElement.dataset.mechanicsConnectionEndpoint = endpoint?.side ?? '';
    gl.domElement.dataset.mechanicsConnectionHost = endpoint?.assemblyId ?? '';
    setHoveredEndpoint(endpoint);
  }, [gl]);
  useEffect(() => {
    gl.domElement.dataset.mechanicsFocusedNode = props.focusedNode?.nodeId ?? '';
    gl.domElement.dataset.mechanicsPreviewNode = props.previewNode?.nodeId ?? '';
    gl.domElement.dataset.mechanicsOpacityPreview = props.editorOpacityPreview
      ? `${props.editorOpacityPreview.kind}:${props.editorOpacityPreview.id}:${props.editorOpacityPreview.opacity}`
      : '';
  }, [gl, props.focusedNode, props.previewNode, props.editorOpacityPreview]);
  const handleDragState = useCallback((active) => {
    const nextActive = Boolean(active);
    directManipulationRef.current = nextActive;
    if (cameraControlsRef.current) cameraControlsRef.current.enabled = !nextActive;
    setDragging(nextActive);
  }, []);
  const pointOnConnectedAssembly = useCallback((event, assemblyId) => {
    const group = assemblyRefs.current.get(assemblyId);
    if (!group || !event.ray) return null;
    endpointRaycasterRef.current.ray.copy(event.ray);
    return endpointRaycasterRef.current
      .intersectObject(group, true)
      .find((hit) => hit.object.userData?.connectionSurface === true)?.point ?? null;
  }, []);
  const beginEndpointDrag = useCallback((endpoint) => {
    endpointDragRef.current = { ...endpoint, lastPoint: endpoint.point.clone(), moved: false };
    gl.domElement.dataset.mechanicsEndpointDragging = endpoint.side;
    gl.domElement.dataset.mechanicsEndpointSurfaceHit = '';
    setEndpointPreview({ ...endpoint, worldPoint: endpoint.point });
    handleDragState(true);
  }, [gl, handleDragState]);
  const moveEndpointDrag = useCallback((endpoint, event) => {
    const drag = endpointDragRef.current;
    if (!drag || drag.mechanicId !== endpoint.mechanicId || drag.side !== endpoint.side) return;
    const point = pointOnConnectedAssembly(event, endpoint.assemblyId);
    // Missing the host is intentionally a no-op: an endpoint can slide over
    // its connected assembly, but it can never be left floating in space.
    gl.domElement.dataset.mechanicsEndpointSurfaceHit = point ? endpoint.assemblyId : '';
    if (!point) return;
    drag.moved = drag.moved || point.distanceToSquared(drag.lastPoint) > 1e-8;
    drag.lastPoint = point.clone();
    setEndpointPreview({ ...endpoint, worldPoint: point.clone() });
  }, [pointOnConnectedAssembly]);
  const endEndpointDrag = useCallback(() => {
    const drag = endpointDragRef.current;
    endpointDragRef.current = null;
    gl.domElement.dataset.mechanicsEndpointDragging = '';
    setEndpointPreview(null);
    handleDragState(false);
    if (!drag?.moved) return;
    props.onMoveRelationshipEndpoint?.(drag.mechanicId, drag.side, {
      x: drag.lastPoint.x,
      y: drag.lastPoint.y,
      z: drag.lastPoint.z,
    });
  }, [gl, handleDragState, props.onMoveRelationshipEndpoint]);
  useEffect(() => {
    if (mode === 'build' && props.activeTool === 'modify' && selectedMechanicId) return;
    endpointDragRef.current = null;
    setEndpointPreview(null);
    setHoveredEndpoint(null);
    handleDragState(false);
  }, [handleDragState, mode, props.activeTool, selectedMechanicId]);
  const manualIds = useMemo(() => new Set(manualActiveDeviceIds), [manualActiveDeviceIds]);
  const placementActive = mode === 'build' && (props.activeTool === 'shape' || props.activeTool === 'cog');
  const cogPlacementActive = mode === 'build' && props.activeTool === 'cog';
  // Turn a hover/click placement (ground or assembly surface) into a cogwheel
  // plan. Hovering a cogwheel meshes against it; hovering any other assembly
  // face mounts the wheel there, axled about the face normal.
  const cogPlanFor = useCallback(
    (placement) => {
      if (placement.assemblyId) {
        const assembly = document.assemblies.find((item) => item.assemblyId === placement.assemblyId);
        const hasCog = assembly?.parts.some((item) => item.shape === 'cogwheel');
        if (assembly && !hasCog) {
          const preset = COGWHEEL_PRESETS[props.cogPreset] ?? COGWHEEL_PRESETS['cog-large'];
          const offset = preset.defaultSize.y / 2 + 0.02;
          const normal = placement.normal ?? { x: 0, y: 1, z: 0 };
          return {
            presetId: props.cogPreset,
            position: {
              x: placement.x + normal.x * offset,
              y: placement.y + normal.y * offset,
              z: placement.z + normal.z * offset,
            },
            rotation: quaternionBetweenVectors({ x: 0, y: 1, z: 0 }, normal),
            hostAssemblyId: assembly.assemblyId,
            hostLabel: assembly.label,
            worldAxis: normal,
            snapped: null,
          };
        }
      }
      return planCogwheelPlacement(document, placement, props.cogPreset, {
        snap: placement.shift !== true,
        // When the pointer is directly over a cogwheel, preserve that explicit
        // target even if another nearby cogwheel also has a valid snap ring.
        targetAssemblyId: placement.assemblyId ?? null,
      });
    },
    [document, props.cogPreset],
  );
  const cogPlan = useMemo(() => {
    if (!cogPlacementActive || !placementPoint) return null;
    return cogPlanFor(placementPoint);
  }, [cogPlacementActive, placementPoint, cogPlanFor]);
  useEffect(() => {
    gl.domElement.dataset.mechanicsCogSnap = cogPlan?.snapped?.targetAssemblyId ?? '';
  }, [gl, cogPlan]);
  // Written synchronously on pointer move (not via an effect) so scanning
  // tests can dispatch a move and read the hovered surface immediately.
  const handlePlacementMove = useCallback(
    (placement) => {
      gl.domElement.dataset.mechanicsPlacementAssembly = placement?.assemblyId ?? '';
      if (placementGestureRef.current) placementGestureRef.current.placement = placement;
      setPlacementPoint(placement);
    },
    [gl],
  );
  useEffect(() => {
    if (!placementActive) gl.domElement.dataset.mechanicsPlacementAssembly = '';
  }, [gl, placementActive]);
  const commitPlacement = useCallback(
    (placement) => {
      if (props.activeTool === 'cog') {
        props.onPlaceCog?.(cogPlanFor(placement));
        return;
      }
      props.onPlacePrimitive?.(shapePlacementPosition(props.placementPreset, placement));
    },
    [props.activeTool, props.onPlaceCog, props.onPlacePrimitive, props.placementPreset, cogPlanFor],
  );
  const beginPlacementGesture = useCallback((event, placement) => {
    const nativeEvent = event.nativeEvent ?? event;
    if (nativeEvent.button !== 0) return;
    placementGestureRef.current = {
      pointerId: event.pointerId ?? nativeEvent.pointerId,
      x: nativeEvent.clientX,
      y: nativeEvent.clientY,
      distance: 0,
      placement,
    };
  }, []);
  useEffect(() => {
    const canvas = gl.domElement;
    const handlePointerMove = (event) => {
      const gesture = placementGestureRef.current;
      if (!gesture || (gesture.pointerId != null && event.pointerId !== gesture.pointerId)) return;
      gesture.distance = Math.max(
        gesture.distance,
        Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y),
      );
    };
    const handlePointerUp = (event) => {
      const gesture = placementGestureRef.current;
      if (!gesture || (gesture.pointerId != null && event.pointerId !== gesture.pointerId)) return;
      placementGestureRef.current = null;
      if (event.button !== 0 || gesture.distance > 5 || !placementActive) return;
      commitPlacement(gesture.placement);
    };
    const cancelPlacement = (event) => {
      const gesture = placementGestureRef.current;
      if (!gesture || (gesture.pointerId != null && event.pointerId !== gesture.pointerId)) return;
      placementGestureRef.current = null;
    };
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointercancel', cancelPlacement);
    return () => {
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointercancel', cancelPlacement);
    };
  }, [commitPlacement, gl, placementActive]);
  useEffect(() => {
    if (!placementActive) placementGestureRef.current = null;
  }, [placementActive]);

  useEffect(() => {
    let disposed = false;
    setPhysicsState('loading');
    loadRapier().then((rapier) => {
      if (disposed) return;
      worldRef.current?.dispose();
      if (!rapier) {
        worldRef.current = null;
        setPhysicsState('error');
        return;
      }
      const world = new RapierMechanicsWorld(rapier, document, { paused: mode !== 'test' });
      worldRef.current = world;
      const snapshot = world.getSnapshot();
      setRuntimeView(snapshot);
      onRuntimeSnapshot(snapshot);
      setPhysicsState('ready');
    });
    return () => {
      disposed = true;
      worldRef.current?.dispose();
      worldRef.current = null;
    };
  }, [document, runtimeResetToken]);

  useEffect(() => {
    worldRef.current?.setPaused(mode !== 'test');
  }, [mode, physicsState]);

  useEffect(() => {
    const world = worldRef.current;
    if (!world || !runtimeCommand || lastCommandRef.current === runtimeCommand.id) return;
    lastCommandRef.current = runtimeCommand.id;
    if (runtimeCommand.type === 'release_latch') world.releaseLatch(runtimeCommand.latchId);
    if (runtimeCommand.type === 'arm_latch') world.armLatch(runtimeCommand.latchId);
    if (runtimeCommand.type === 'impulse') {
      world.applyTestImpulse(runtimeCommand.assemblyId, runtimeCommand.impulse);
    }
    if (runtimeCommand.type === 'torque') {
      world.applyTestTorque(runtimeCommand.assemblyId, runtimeCommand.torqueImpulse);
    }
    const snapshot = world.getSnapshot();
    setRuntimeView(snapshot);
    onRuntimeSnapshot(snapshot);
  }, [runtimeCommand, physicsState, onRuntimeSnapshot]);

  useFrame((_, delta) => {
    const world = worldRef.current;
    if (!world) return;
    world.setPaused(mode !== 'test');
    let snapshot = world.step(delta);
    const spellEvaluation = evaluateMountedSpellDevices(document, snapshot, {
      manualActiveIds: manualIds,
    });
    world.setSpellFields(
      spellEvaluation.fields,
      spellEvaluation.devices.filter((device) => device.active),
    );
    snapshot = world.getSnapshot();
    for (const [assemblyId, group] of assemblyRefs.current) {
      const transform = snapshot.assemblies[assemblyId];
      if (!group) continue;
      group.visible = !snapshot.removedAssemblyIds?.includes(assemblyId);
      if (!transform || mode === 'build') continue;
      group.position.set(transform.position.x, transform.position.y, transform.position.z);
      group.quaternion.set(
        transform.rotation.x,
        transform.rotation.y,
        transform.rotation.z,
        transform.rotation.w,
      );
    }
    const now = performance.now();
    if (now - lastPublishRef.current >= 100) {
      lastPublishRef.current = now;
      const published = {
        ...snapshot,
        physicsState,
        activeSpellDevices: spellEvaluation.devices.filter((device) => device.active),
        spellDevices: spellEvaluation.devices,
      };
      setRuntimeView(published);
      onRuntimeSnapshot(published);
      window.__WHA_MECHANICS_DEBUG__ = {
        mode,
        rapierReady: physicsState === 'ready',
        documentName: document.metadata?.name,
        bodyCount: published.bodyCount,
        assemblyBodyCount: published.assemblyBodyCount,
        groundBodyCount: published.groundBodyCount,
        colliderCount: published.colliderCount,
        collisionListenerCount: published.collisionListenerCount,
        eventQueueCount: published.eventQueueCount,
        retainedSnapshotCount: published.retainedSnapshotCount,
        listenerCount: published.listenerCount,
        snapshotCount: published.snapshotCount,
        projectileCount: published.projectileCount,
        removedAssemblyIds: published.removedAssemblyIds,
        jointCount: published.jointCount,
        assemblies: published.assemblies,
        constraints: published.constraints,
        gates: published.gates,
        latches: published.latches,
        rotationCouplings: published.couplings,
        activeSpellDevices: published.activeSpellDevices.map((device) => device.deviceId),
        forceApplicationCount: published.forceApplicationCount,
        forceCandidateCount: published.forceCandidateCount,
        forceSaturationCount: published.forceSaturationCount,
        awakeBodyCount: published.awakeBodyCount,
        averageStepDurationMs: published.averageStepDurationMs,
        peakStepDurationMs: published.peakStepDurationMs,
        rebuildCount: published.rebuildCount,
        camera: {
          position: {
            x: camera.position.x,
            y: camera.position.y,
            z: camera.position.z,
          },
          target: cameraControlsRef.current
            ? {
                x: cameraControlsRef.current.target.x,
                y: cameraControlsRef.current.target.y,
                z: cameraControlsRef.current.target.z,
              }
            : null,
          controlsEnabled: cameraControlsRef.current?.enabled ?? false,
        },
      };
    }
  });

  // Workshop lighting level: 1 is full daylight, lower values dusk the whole
  // stage (sky, fog, ambient, and key together) so spell light reads clearly.
  const level = Math.min(1, Math.max(0.05, Number(props.lightLevel ?? 1)));
  const stageColor = useMemo(
    () => `#${new THREE.Color('#141a24').lerp(new THREE.Color('#dce8df'), level).getHexString()}`,
    [level],
  );
  return (
    <>
      <color attach="background" args={[stageColor]} />
      <fog attach="fog" args={[stageColor, 18, 46]} />
      <ambientLight intensity={0.06 + 0.72 * level * level} color="#eaf2e7" />
      <directionalLight
        position={[7, 11, 5]}
        intensity={1.35 * level}
        color="#fff2d0"
      />
      <CameraControls controlsRef={cameraControlsRef} enabled={!dragging} />
      <WorkbenchGround
        directManipulationRef={directManipulationRef}
        placementEnabled={placementActive}
        onPlacementMove={handlePlacementMove}
        onPlacementStart={beginPlacementGesture}
        onClear={() => props.onSelectMechanic(null)}
      />
      {mode === 'build' && props.activeTool === 'shape' && placementPoint ? (
        <PlacementGhost
          preset={props.placementPreset}
          position={shapePlacementPosition(props.placementPreset, placementPoint)}
        />
      ) : null}
      {cogPlan ? <CogwheelPlacementGhost plan={cogPlan} /> : null}
      {document.assemblies.map((assembly) => {
        const rootFocused = props.focusedNode?.assemblyId === assembly.assemblyId
          && props.focusedNode.nodeId === assembly.assemblyId;
        const focusedPartIds = props.focusedNode?.assemblyId === assembly.assemblyId
          ? new Set(descendantPartIds(assembly, props.focusedNode.nodeId))
          : new Set();
        const previewPartIds = props.previewNode?.assemblyId === assembly.assemblyId
          ? new Set(descendantPartIds(assembly, props.previewNode.nodeId))
          : new Set();
        return (
          <AssemblyVisual
            key={assembly.assemblyId}
            assembly={assembly}
            mode={mode}
            runtimeTransform={runtimeView?.assemblies?.[assembly.assemblyId]}
            selected={selectedAssemblyIds.includes(assembly.assemblyId)}
            primarySelected={selectedAssemblyIds[0] === assembly.assemblyId}
            rootFocused={rootFocused}
            focusedPartIds={focusedPartIds}
            previewPartIds={previewPartIds}
            opacityPreview={editorOpacityFor(props.editorOpacityPreview, 'assembly', assembly.assemblyId)}
            connectionEndpointHovered={hoveredEndpoint?.assemblyId === assembly.assemblyId}
            connectionEndpointEditing={Boolean(editableEndpointInfo)}
            transformMode={props.transformMode}
            gizmoEnabled={mode === 'build' && props.activeTool === 'modify'}
            placementEnabled={placementActive}
            onPlacementMove={handlePlacementMove}
            onPlacementStart={beginPlacementGesture}
            onSelect={props.onSelectAssembly}
            onMove={props.onMoveAssembly}
            onDragState={handleDragState}
            directManipulationRef={directManipulationRef}
            onTestDrag={(assemblyId, impulse) => {
              worldRef.current?.applyTestImpulse(assemblyId, impulse);
            }}
            registerRef={(group) => {
              if (group) assemblyRefs.current.set(assembly.assemblyId, group);
              else assemblyRefs.current.delete(assembly.assemblyId);
            }}
          />
        );
      })}
      <MechanicalRelationshipVisuals
        document={document}
        runtimeView={runtimeView}
        selectedMechanicId={selectedMechanicId}
        editorOpacityPreview={props.editorOpacityPreview}
        endpointEditing={mode === 'build' && props.activeTool === 'modify'}
        endpointPreview={endpointPreview}
        onEndpointDragStart={beginEndpointDrag}
        onEndpointDrag={moveEndpointDrag}
        onEndpointDragEnd={endEndpointDrag}
        onEndpointHover={handleEndpointHover}
        onSelect={(mechanicId) => {
          if (!directManipulationRef.current) props.onSelectMechanic(mechanicId);
        }}
      />
      <SpellDeviceVisuals
        document={document}
        runtimeView={runtimeView}
        selectedMechanicId={selectedMechanicId}
        editorOpacityPreview={props.editorOpacityPreview}
        transformMode={props.transformMode}
        gizmoEnabled={mode === 'build' && props.activeTool === 'modify'}
        onTransform={props.onTransformSpellPlate}
        onDragState={handleDragState}
        onSelect={(mechanicId) => {
          if (!directManipulationRef.current) props.onSelectMechanic(mechanicId);
        }}
      />
      <SimSpellOutputPresentation
        owner="mechanics"
        devices={runtimeView?.spellDevices ?? []}
      />
      <SensorVisuals
        document={document}
        runtimeView={runtimeView}
        selectedMechanicId={selectedMechanicId}
        editorOpacityPreview={props.editorOpacityPreview}
        onSelect={(mechanicId) => {
          if (!directManipulationRef.current) props.onSelectMechanic(mechanicId);
        }}
      />
      {physicsState === 'loading' ? <PhysicsMarker color="#c49d35" /> : null}
      {physicsState === 'error' ? <PhysicsMarker color="#a43f32" /> : null}
    </>
  );
}

function CameraControls({ controlsRef, enabled }) {
  const { camera, gl, invalidate } = useThree();
  const localControlsRef = useRef(null);
  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.target.set(0, 1.3, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 4;
    controls.maxDistance = 24;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.enabled = enabled;
    controls.addEventListener('change', invalidate);
    localControlsRef.current = controls;
    controlsRef.current = controls;
    return () => {
      if (controlsRef.current === controls) controlsRef.current = null;
      localControlsRef.current = null;
      controls.removeEventListener('change', invalidate);
      controls.dispose();
    };
  }, [camera, controlsRef, gl, invalidate]);
  useEffect(() => {
    if (localControlsRef.current) localControlsRef.current.enabled = enabled;
  }, [enabled]);
  useFrame(() => {
    if (!localControlsRef.current) return;
    if (localControlsRef.current.enabled) localControlsRef.current.update();
  });
  return null;
}

function WorkbenchGround({
  directManipulationRef,
  onClear,
  placementEnabled,
  onPlacementMove,
  onPlacementStart,
}) {
  const placementFromEvent = (event) => {
    const raw = event.point;
    const unsnapped = event.nativeEvent?.altKey === true;
    return {
      x: unsnapped ? raw.x : Math.round(raw.x * 10) / 10,
      y: 0,
      z: unsnapped ? raw.z : Math.round(raw.z * 10) / 10,
      normal: { x: 0, y: 1, z: 0 },
      assemblyId: null,
      // Shift suppresses cogwheel mesh-snapping during cog placement.
      shift: event.nativeEvent?.shiftKey === true,
    };
  };
  return (
    <group>
      <mesh
        name="mechanics-ground"
        position={[0, -0.12, 0]}
        receiveShadow
        onPointerMove={(event) => {
          if (directManipulationRef.current) return;
          if (!placementEnabled) return;
          onPlacementMove(placementFromEvent(event));
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
          if (directManipulationRef.current) return;
          if (placementEnabled) {
            const position = placementFromEvent(event);
            onPlacementMove(position);
            onPlacementStart(event, position);
            return;
          }
          onClear();
        }}
      >
        <boxGeometry args={[60, 0.24, 60]} />
        <meshStandardMaterial color="#71866e" roughness={0.94} />
      </mesh>
      <gridHelper args={[24, 24, '#d9cf9c', '#5f735d']} position={[0, 0.012, 0]} />
      <mesh position={[0, 0.021, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.8, 4, 64]} />
        <meshBasicMaterial color="#d3c58d" transparent opacity={0.3} />
      </mesh>
    </group>
  );
}

// A hover or click on an assembly face, expressed in the same shape as a
// ground placement: world point + world face normal + the assembly it hit.
function assemblyPlacementFromEvent(event, assemblyId) {
  const normal = event.face?.normal
    ? event.face.normal.clone().transformDirection(event.object.matrixWorld).normalize()
    : new THREE.Vector3(0, 1, 0);
  return {
    x: event.point.x,
    y: event.point.y,
    z: event.point.z,
    normal: { x: normal.x, y: normal.y, z: normal.z },
    assemblyId,
    shift: event.nativeEvent?.shiftKey === true,
  };
}

// Where a primitive shape should rest for a placement: seated on the hit
// surface, offset along the face normal by the shape's extent in that
// direction (the ground is just the normal-up case).
function shapePlacementPosition(preset, placement) {
  const definition = PRIMITIVE_SHAPES[preset] ?? PRIMITIVE_SHAPES.cuboid;
  const size = definition.defaultSize;
  const normal = placement.normal ?? { x: 0, y: 1, z: 0 };
  const extent =
    (Math.abs(normal.x) * size.x + Math.abs(normal.y) * size.y + Math.abs(normal.z) * size.z) / 2 +
    0.04;
  return {
    x: placement.x + normal.x * extent,
    y: placement.y + normal.y * extent,
    z: placement.z + normal.z * extent,
  };
}

function CogwheelPlacementGhost({ plan }) {
  const preset = COGWHEEL_PRESETS[plan.presetId] ?? COGWHEEL_PRESETS['cog-large'];
  const meshed = Boolean(plan.snapped);
  return (
    <group
      position={[plan.position.x, plan.position.y, plan.position.z]}
      quaternion={[plan.rotation.x, plan.rotation.y, plan.rotation.z, plan.rotation.w]}
      renderOrder={4}
    >
      <mesh>
        <MechanicalCogwheelGeometry size={preset.defaultSize} />
        <meshBasicMaterial
          color={meshed ? '#4fd08a' : '#65c58f'}
          transparent
          opacity={meshed ? 0.42 : 0.28}
          depthWrite={false}
          wireframe={!meshed}
        />
      </mesh>
      {meshed ? (
        <LabelSprite text={`will mesh ${meshRatioText(plan.snapped.ratio)}`} position={[0, 0.6, 0]} scale={0.9} />
      ) : null}
      {!meshed && plan.hostAssemblyId ? (
        <LabelSprite text={`axle on ${plan.hostLabel ?? 'assembly'}`} position={[0, 0.6, 0]} scale={0.9} />
      ) : null}
    </group>
  );
}

function meshRatioText(ratio) {
  const magnitude = Math.abs(Number(ratio) || 1);
  if (magnitude >= 1) {
    return `${Number.isInteger(magnitude) ? magnitude : magnitude.toFixed(1)}:1`;
  }
  const inverse = 1 / Math.max(1e-6, magnitude);
  return `1:${Number.isInteger(inverse) ? inverse : inverse.toFixed(1)}`;
}

function PlacementGhost({ preset, position }) {
  const definition = PRIMITIVE_SHAPES[preset] ?? PRIMITIVE_SHAPES.cuboid;
  const part = {
    shape: definition.shape,
    size: definition.defaultSize,
  };
  return (
    <mesh position={[position.x, position.y, position.z]} renderOrder={4}>
      <MechanicalPartGeometry part={part} />
      <meshBasicMaterial
        color="#65c58f"
        transparent
        opacity={0.28}
        depthWrite={false}
        wireframe
      />
    </mesh>
  );
}

function AssemblyVisual({
  assembly,
  mode,
  runtimeTransform,
  selected,
  primarySelected,
  rootFocused,
  focusedPartIds,
  previewPartIds,
  opacityPreview,
  connectionEndpointHovered,
  connectionEndpointEditing,
  transformMode,
  gizmoEnabled,
  placementEnabled,
  onPlacementMove,
  onPlacementStart,
  onSelect,
  onMove,
  onDragState,
  directManipulationRef,
  onTestDrag,
  registerRef,
}) {
  const groupRef = useRef(null);
  const pointerDragRef = useRef(null);
  const { camera } = useThree();
  const commitTransform = useCallback(
    (transform) => onMove(assembly.assemblyId, transform),
    [assembly.assemblyId, onMove],
  );
  const transform = mode === 'build' || !runtimeTransform
    ? assembly.transform
    : { position: runtimeTransform.position, rotation: runtimeTransform.rotation };
  const clickThrough = assembly.editor?.clickThrough === true;
  const opacity = opacityPreview ?? assembly.editor?.opacity ?? 1;
  return (
    <group
      ref={(group) => {
        groupRef.current = group;
        registerRef(group);
      }}
      name={assembly.assemblyId}
      position={[transform.position.x, transform.position.y, transform.position.z]}
      quaternion={[
        transform.rotation.x,
        transform.rotation.y,
        transform.rotation.z,
        transform.rotation.w,
      ]}
      onPointerMove={(event) => {
        if (clickThrough) return;
        if (!placementEnabled || directManipulationRef.current) return;
        // This assembly's surface is the placement target — keep the ground
        // behind it from stealing the ghost.
        event.stopPropagation();
        onPlacementMove(assemblyPlacementFromEvent(event, assembly.assemblyId));
      }}
      onPointerDown={(event) => {
        if (clickThrough) return;
        // Endpoint handles sit directly on part surfaces. While editing one,
        // let the handle receive the same ray instead of the host assembly
        // swallowing the pointer-down first.
        if (connectionEndpointEditing) return;
        event.stopPropagation();
        if (directManipulationRef.current) return;
        if (placementEnabled) {
          // Placement tools treat assemblies as surfaces. The shared gesture
          // gate commits this pose on release only when the press stayed a click.
          const placement = assemblyPlacementFromEvent(event, assembly.assemblyId);
          onPlacementMove(placement);
          onPlacementStart(event, placement);
          return;
        }
        onSelect(assembly.assemblyId, event.shiftKey);
        if (mode === 'test' && assembly.bodyMode !== 'fixed') {
          pointerDragRef.current = {
            x: event.nativeEvent.clientX,
            y: event.nativeEvent.clientY,
            pointerId: event.pointerId,
          };
          event.target.setPointerCapture?.(event.pointerId);
          onDragState(true);
        }
      }}
      onPointerUp={(event) => {
        const start = pointerDragRef.current;
        if (!start) return;
        event.stopPropagation();
        const dx = event.nativeEvent.clientX - start.x;
        const dy = event.nativeEvent.clientY - start.y;
        pointerDragRef.current = null;
        event.target.releasePointerCapture?.(start.pointerId);
        onDragState(false);
        if (Math.hypot(dx, dy) < 4) return;
        const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        cameraRight.y = 0;
        cameraRight.normalize();
        const impulse = cameraRight.multiplyScalar(dx * 0.022);
        impulse.y += -dy * 0.022;
        onTestDrag(assembly.assemblyId, { x: impulse.x, y: impulse.y, z: impulse.z });
      }}
      onPointerCancel={() => {
        pointerDragRef.current = null;
        onDragState(false);
      }}
      onPointerOver={(event) => {
        if (clickThrough) return;
        if (connectionEndpointEditing) return;
        event.stopPropagation();
        window.document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        if (connectionEndpointEditing) return;
        window.document.body.style.cursor = '';
      }}
    >
      {assembly.parts.map((part) => (
        <PartVisual
          key={part.partId}
          part={part}
          selected={selected && rootFocused}
          focused={focusedPartIds.has(part.partId)}
          previewed={previewPartIds.has(part.partId)}
          connectionEndpointHovered={connectionEndpointHovered}
          opacity={opacity}
        />
      ))}
      {assembly.bodyMode === 'fixed' ? <AnchorMarker /> : null}
      {selected && rootFocused ? <SelectionMarker assembly={assembly} /> : null}
      {gizmoEnabled && primarySelected && rootFocused ? (
        // The gizmo belongs to the Modify tool only: Select stays a safe
        // look-around tool, and placement tools keep assembly clicks for
        // surface placement.
        <TransformGizmo
          objectRef={groupRef}
          mode={transformMode}
          onDragState={onDragState}
          onCommit={commitTransform}
        />
      ) : null}
    </group>
  );
}

function PartVisual({ part, selected, focused, previewed, connectionEndpointHovered, opacity = 1 }) {
  const material = MECHANICAL_MATERIALS[part.materialId] ?? MECHANICAL_MATERIALS['material.wood_light'];
  const materialRef = useRef(null);
  const activeHighlight = selected || focused || previewed || connectionEndpointHovered;
  const reducedMotion = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  useFrame(({ clock }) => {
    if (!materialRef.current) return;
    materialRef.current.emissiveIntensity = activeHighlight
      ? connectionEndpointHovered
        ? reducedMotion
          ? 0.22
          : 0.22 + Math.sin(clock.elapsedTime * 4.2) * 0.08
        : reducedMotion
          ? 0.48
          : 0.48 + Math.sin(clock.elapsedTime * 4.2) * 0.22
      : 0;
  });
  return (
    <mesh
      name={part.partId}
      position={[
        part.localTransform.position.x,
        part.localTransform.position.y,
        part.localTransform.position.z,
      ]}
      quaternion={[
        part.localTransform.rotation.x,
        part.localTransform.rotation.y,
        part.localTransform.rotation.z,
        part.localTransform.rotation.w,
      ]}
      castShadow={opacity >= 0.25}
      receiveShadow
      userData={{ connectionSurface: true, partId: part.partId }}
    >
      <MechanicalPartGeometry part={part} />
      <meshStandardMaterial
        ref={materialRef}
        color={material.color}
        roughness={part.materialId === 'material.iron' ? 0.48 : 0.76}
        metalness={part.materialId === 'material.iron' ? 0.42 : 0.02}
        emissive={activeHighlight ? (connectionEndpointHovered ? '#765d20' : previewed ? '#b38623' : '#2d7651') : '#000000'}
        emissiveIntensity={activeHighlight ? 0.48 : 0}
        transparent={opacity < 1}
        opacity={opacity}
        depthWrite={opacity >= 0.98}
      />
    </mesh>
  );
}

function TransformGizmo({ objectRef, mode, onCommit, onDragState, minimumY = 0.04 }) {
  const { camera, gl, scene } = useThree();
  const onCommitRef = useRef(onCommit);
  const onDragStateRef = useRef(onDragState);
  onCommitRef.current = onCommit;
  onDragStateRef.current = onDragState;
  useEffect(() => {
    const object = objectRef.current;
    if (!object) return undefined;
    const baseMode = mode === 'rotate' ? 'rotate' : mode === 'scale' ? 'scale' : 'translate';
    const controls = new TransformControls(camera);
    controls.setMode(baseMode);
    controls.setSpace(baseMode === 'scale' ? 'local' : 'world');
    controls.setTranslationSnap(0.1);
    controls.setRotationSnap(Math.PI / 24);
    controls.setScaleSnap(0.1);
    controls.setSize(0.72);
    emphasizeUniformScaleHandle(controls);
    const removeDirectionalUniformScale = installDirectionalUniformScale(controls, gl.domElement);
    controls.attach(object);
    scene.add(controls.getHelper());
    const syncPointerFeedback = () => {
      const activeAxis = controls.axis ?? '';
      gl.domElement.dataset.mechanicsTransformAxis = activeAxis;
      gl.domElement.dataset.mechanicsTransformDragging = String(controls.dragging);
      gl.domElement.dataset.mechanicsTransformOperation = controls.mode;
      gl.domElement.dataset.mechanicsUniformScaleHandle = controls.mode === 'scale' ? 'XYZ' : '';
      gl.domElement.style.cursor = controls.dragging
        ? 'grabbing'
        : activeAxis
          ? 'grab'
          : '';
    };
    const applyModifierMode = (modifier) => {
      const nextMode = modifier === 'rotate' ? 'rotate' : modifier === 'resize' ? 'scale' : baseMode;
      controls.setMode(nextMode);
      controls.setSpace(nextMode === 'scale' ? 'local' : 'world');
      gl.domElement.dataset.mechanicsTransformModifier = modifier;
      controls.getHelper().updateMatrixWorld(true);
      syncPointerFeedback();
    };
    const modifierFromEvent = (event) => {
      // Ctrl (or Cmd) swaps in the rotation rings; Shift resizes from Move.
      if (baseMode !== 'rotate' && (event.ctrlKey || event.metaKey)) return 'rotate';
      if (baseMode === 'translate' && event.shiftKey) return 'resize';
      return 'default';
    };
    const handleModifierPointerDown = (event) => {
      if (event.button !== 0) return;
      applyModifierMode(modifierFromEvent(event));
    };
    const restoreBaseMode = () => {
      applyModifierMode('default');
    };
    const handleModifierKeyDown = (event) => {
      if (controls.dragging) return;
      if ((event.key === 'Control' || event.key === 'Meta') && baseMode !== 'rotate') {
        applyModifierMode('rotate');
        return;
      }
      if (event.key === 'Shift' && baseMode === 'translate') applyModifierMode('resize');
    };
    const handleModifierKeyUp = (event) => {
      if (controls.dragging) return;
      if (['Shift', 'Control', 'Meta'].includes(event.key)) restoreBaseMode();
    };
    // macOS turns Ctrl+click into a context menu — keep it off the canvas so
    // Ctrl-drag rotation works.
    const handleContextMenu = (event) => {
      event.preventDefault();
    };
    const handleDragging = (event) => {
      syncPointerFeedback();
      onDragStateRef.current(Boolean(event.value));
    };
    const handleMouseUp = () => {
      const committedScale = {
        x: object.scale.x,
        y: object.scale.y,
        z: object.scale.z,
      };
      onCommitRef.current({
        position: {
          x: object.position.x,
          y: minimumY == null ? object.position.y : Math.max(minimumY, object.position.y),
          z: object.position.z,
        },
        rotation: {
          x: object.quaternion.x,
          y: object.quaternion.y,
          z: object.quaternion.z,
          w: object.quaternion.w,
        },
        scale: committedScale,
      });
      object.scale.set(1, 1, 1);
    };
    const removeAxisLatch = installTransformAxisLatch(controls, (axis) => {
      gl.domElement.dataset.mechanicsTransformLatchedAxis = axis ?? '';
    });
    controls.addEventListener('dragging-changed', handleDragging);
    controls.addEventListener('axis-changed', syncPointerFeedback);
    controls.addEventListener('mouseUp', handleMouseUp);
    gl.domElement.addEventListener('pointerdown', handleModifierPointerDown, true);
    controls.connect(gl.domElement);
    gl.domElement.addEventListener('pointerup', restoreBaseMode);
    gl.domElement.addEventListener('pointercancel', restoreBaseMode);
    gl.domElement.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleModifierKeyDown);
    window.addEventListener('keyup', handleModifierKeyUp);
    syncPointerFeedback();
    return () => {
      if (controls.dragging) onDragStateRef.current(false);
      removeAxisLatch();
      removeDirectionalUniformScale();
      gl.domElement.removeEventListener('pointerdown', handleModifierPointerDown, true);
      gl.domElement.removeEventListener('pointerup', restoreBaseMode);
      gl.domElement.removeEventListener('pointercancel', restoreBaseMode);
      gl.domElement.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleModifierKeyDown);
      window.removeEventListener('keyup', handleModifierKeyUp);
      controls.removeEventListener('dragging-changed', handleDragging);
      controls.removeEventListener('axis-changed', syncPointerFeedback);
      controls.removeEventListener('mouseUp', handleMouseUp);
      controls.detach();
      scene.remove(controls.getHelper());
      controls.dispose();
      delete gl.domElement.dataset.mechanicsTransformAxis;
      delete gl.domElement.dataset.mechanicsTransformDragging;
      delete gl.domElement.dataset.mechanicsTransformModifier;
      delete gl.domElement.dataset.mechanicsTransformOperation;
      delete gl.domElement.dataset.mechanicsTransformLatchedAxis;
      delete gl.domElement.dataset.mechanicsUniformScaleHandle;
      gl.domElement.style.cursor = '';
    };
  }, [camera, gl, scene, objectRef, mode, minimumY]);
  return null;
}

function AnchorMarker() {
  return (
    <group position={[0, 0.2, 0]}>
      <mesh>
        <octahedronGeometry args={[0.14]} />
        <meshStandardMaterial color="#d7b448" emissive="#5f4610" emissiveIntensity={0.25} />
      </mesh>
      <mesh position={[0, -0.16, 0]}>
        <cylinderGeometry args={[0.035, 0.035, 0.3, 8]} />
        <meshStandardMaterial color="#d7b448" metalness={0.5} roughness={0.4} />
      </mesh>
    </group>
  );
}

function SelectionMarker({ assembly }) {
  const radius = Math.max(
    0.4,
    ...assembly.parts.map((part) => Math.hypot(part.size.x, part.size.y, part.size.z) / 2),
  );
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
      <ringGeometry args={[radius * 0.85, radius * 0.9, 48]} />
      <meshBasicMaterial color="#f3cf58" transparent opacity={0.9} depthTest={false} />
    </mesh>
  );
}

function SpellDeviceVisuals({
  document,
  runtimeView,
  selectedMechanicId,
  editorOpacityPreview,
  transformMode,
  gizmoEnabled,
  onTransform,
  onDragState,
  onSelect,
}) {
  const deviceRuntime = new Map((runtimeView?.spellDevices ?? []).map((item) => [item.deviceId, item]));
  return (
    <group>
      {document.spellDevices.map((device) => {
        const runtime = deviceRuntime.get(device.deviceId);
        const assembly = document.assemblies.find((item) => item.assemblyId === device.assemblyId);
        if (!assembly) return null;
        const transform = runtimeView?.assemblies?.[assembly.assemblyId] ?? assembly.transform;
        return (
          <RelationshipPresentation
            key={device.deviceId}
            editor={device.editor}
            previewOpacity={editorOpacityFor(editorOpacityPreview, 'relationship', device.deviceId)}
          >
            <SpellPlateVisual
              device={device}
              assemblyTransform={transform}
              runtime={runtime}
              selected={selectedMechanicId === device.deviceId}
              transformMode={transformMode}
              gizmoEnabled={gizmoEnabled && selectedMechanicId === device.deviceId}
              onTransform={onTransform}
              onDragState={onDragState}
              onSelect={onSelect}
            />
          </RelationshipPresentation>
        );
      })}
    </group>
  );
}

function SpellPlateVisual({
  device,
  assemblyTransform,
  runtime,
  selected,
  transformMode,
  gizmoEnabled,
  onTransform,
  onDragState,
  onSelect,
}) {
  const groupRef = useRef(null);
  const frame = runtime?.frame;
  const active = runtime?.active === true;
  const socketed = device.spellTemplateId != null;
  const gateClosed = runtime?.gateClosed === true || active;
  const origin = frame?.origin ?? transformPointLocal(assemblyTransform, device.localFrame.origin);
  const normal = normalizeVector(frame?.normal ?? transformDirection(assemblyTransform, device.localFrame.normal));
  const tangent = normalizeVector(frame?.tangent ?? transformDirection(assemblyTransform, device.localFrame.tangent));
  const radius = device.plateRadius ?? 0.42;
  const quaternion = useMemo(() => {
    const x = new THREE.Vector3(tangent.x, tangent.y, tangent.z).normalize();
    const z = new THREE.Vector3(normal.x, normal.y, normal.z).normalize();
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    x.crossVectors(y, z).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  }, [normal.x, normal.y, normal.z, tangent.x, tangent.y, tangent.z]);
  const output =
    runtime?.outputIntents?.find((intent) => intent.physicsField) ??
    runtime?.outputIntents?.[0];
  const field = output?.physicsField;
  return (
    <group>
      <group
        ref={groupRef}
        position={[origin.x, origin.y, origin.z]}
        quaternion={quaternion}
        {...mechanicPointerHandlers(device.deviceId, onSelect, device.editor?.clickThrough)}
      >
        {socketed ? (
          <mesh>
            <torusGeometry args={[radius, Math.max(0.012, radius * 0.06), 8, 64, Math.PI * 1.86]} />
            <meshBasicMaterial color={active ? '#63d99a' : '#403b31'} transparent opacity={0.96} />
          </mesh>
        ) : (
          // An empty socket: a dashed ring waiting for a glyph.
          [0, 1, 2, 3].map((quarter) => (
            <mesh key={quarter} rotation={[0, 0, quarter * (Math.PI / 2) + 0.28]}>
              <torusGeometry args={[radius, Math.max(0.01, radius * 0.048), 8, 14, Math.PI / 3.2]} />
              <meshBasicMaterial color={gateClosed ? '#b9a04b' : '#6a6154'} transparent opacity={0.92} />
            </mesh>
          ))
        )}
        <mesh position={[radius, -radius * 0.107, 0]} rotation={[0, 0, 0.55]}>
          <boxGeometry args={[radius * 0.38, Math.max(0.018, radius * 0.083), Math.max(0.014, radius * 0.06)]} />
          <meshBasicMaterial color={active ? '#f0d36a' : gateClosed ? '#d8b95c' : '#a76b52'} />
        </mesh>
        <mesh>
          <circleGeometry args={[radius * 0.86, 48]} />
          <meshBasicMaterial
            color={active ? '#85ddb0' : socketed ? '#d8cfad' : '#3c362d'}
            transparent
            opacity={socketed ? 0.12 : 0.3}
            depthWrite={false}
          />
        </mesh>
        {!socketed ? (
          <mesh>
            <ringGeometry args={[radius * 0.17, radius * 0.24, 24]} />
            <meshBasicMaterial color="#6a6154" transparent opacity={0.9} />
          </mesh>
        ) : null}
        {selected ? <LabelSprite text={device.label} position={[0, radius + 0.16, 0]} /> : null}
        {gizmoEnabled ? (
          <TransformGizmo
            objectRef={groupRef}
            mode={transformMode}
            minimumY={null}
            onDragState={onDragState}
            onCommit={(transform) => onTransform?.(device.deviceId, transform)}
          />
        ) : null}
      </group>
      {output ? (
        <OutputFieldVisual
          origin={field?.origin ?? output.origin ?? output.baselinePosition ?? origin}
          direction={field?.direction ?? output.sceneAxis ?? normal}
          length={field?.length ?? Math.min(4, Math.max(1.6, output.magnitude ?? 2.5))}
          radius={field?.radius ?? 0.22}
          materialKind={output.materialKind}
          active={active}
        />
      ) : null}
    </group>
  );
}

function OutputFieldVisual({ origin, direction, length, radius, materialKind, active }) {
  const dir = normalizeVector(direction);
  const position = addVector(origin, scaleVector(dir, length / 2));
  const quaternion = useMemo(() => {
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dir.x, dir.y, dir.z));
    return q;
  }, [dir.x, dir.y, dir.z]);
  const color = materialKind === 'water'
    ? '#52a7dc'
    : materialKind === 'earth'
      ? '#886344'
      : materialKind === 'light'
        ? LIGHT_MAGIC.body
        : '#ccecf0';
  return (
    <mesh position={[position.x, position.y, position.z]} quaternion={quaternion}>
      <cylinderGeometry args={[radius * 0.72, radius, length, 18, 1, true]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={active ? (materialKind === 'wind' ? 0.18 : 0.42) : 0.08}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function SensorVisuals({ document, runtimeView, selectedMechanicId, editorOpacityPreview, onSelect }) {
  return (
    <group>
      {document.sensors.map((sensor) => {
        const attached = sensor.assemblyId
          ? runtimeView?.assemblies?.[sensor.assemblyId] ?? document.assemblies.find((item) => item.assemblyId === sensor.assemblyId)?.transform
          : null;
        const position = attached
          ? transformPointLocal(attached, sensor.localTransform.position)
          : sensor.localTransform.position;
        const active = runtimeView?.sensors?.[sensor.sensorId]?.active;
        const sensorColor = active ? '#f1ca46' : '#c9863f';
        return (
          <RelationshipPresentation
            key={sensor.sensorId}
            editor={sensor.editor}
            previewOpacity={editorOpacityFor(editorOpacityPreview, 'relationship', sensor.sensorId)}
          >
            <group
              position={[position.x, position.y, position.z]}
              {...mechanicPointerHandlers(sensor.sensorId, onSelect, sensor.editor?.clickThrough)}
            >
              <mesh>
                {sensor.shape === 'sphere' ? (
                  <sphereGeometry args={[Math.max(sensor.size.x, sensor.size.y, sensor.size.z) / 2, 16, 12]} />
                ) : (
                  <boxGeometry args={[sensor.size.x, sensor.size.y, sensor.size.z]} />
                )}
                <meshBasicMaterial color={sensorColor} wireframe transparent opacity={0.85} />
              </mesh>
              <mesh>
                {sensor.shape === 'sphere' ? (
                  <sphereGeometry args={[Math.max(sensor.size.x, sensor.size.y, sensor.size.z) / 2, 16, 12]} />
                ) : (
                  <boxGeometry args={[sensor.size.x, sensor.size.y, sensor.size.z]} />
                )}
                <meshBasicMaterial color={sensorColor} transparent opacity={active ? 0.2 : 0.09} depthWrite={false} />
              </mesh>
              {selectedMechanicId === sensor.sensorId ? (
                <LabelSprite text={sensor.label} position={[0, sensor.size.y / 2 + 0.24, 0]} />
              ) : null}
            </group>
          </RelationshipPresentation>
        );
      })}
    </group>
  );
}

function mechanicPointerHandlers(id, onSelect, clickThrough) {
  if (!onSelect || clickThrough) return {};
  return {
    onPointerDown: (event) => {
      event.stopPropagation();
      onSelect(id);
    },
    onPointerOver: (event) => {
      event.stopPropagation();
      window.document.body.style.cursor = 'pointer';
    },
    onPointerOut: () => {
      window.document.body.style.cursor = '';
    },
  };
}

function editorOpacityFor(preview, kind, id) {
  return preview?.kind === kind && preview.id === id ? preview.opacity : null;
}

function PhysicsMarker({ color }) {
  return (
    <mesh position={[0, 2.8, 0]}>
      <octahedronGeometry args={[0.2]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

function transformPointLocal(transform, local) {
  const q = new THREE.Quaternion(
    transform.rotation.x,
    transform.rotation.y,
    transform.rotation.z,
    transform.rotation.w,
  );
  const point = new THREE.Vector3(local.x, local.y, local.z).applyQuaternion(q);
  return {
    x: transform.position.x + point.x,
    y: transform.position.y + point.y,
    z: transform.position.z + point.z,
  };
}
