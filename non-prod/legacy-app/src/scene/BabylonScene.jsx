import { useEffect, useRef } from 'react';
import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HemisphericLight,
  Matrix,
  Mesh,
  MeshBuilder,
  PointLight,
  PointerDragBehavior,
  Quaternion,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData,
} from '@babylonjs/core';

export default function BabylonScene({
  runtimeResult,
  sources,
  props,
  sceneLeftovers = [],
  updateSourcePosition,
  updatePropPosition,
  updateSpellPlacement,
  onRemoteToggle,
  onOuterRingToggle,
  environmentMode = 'day',
  weatherMode = 'clear',
  timelinePaused = false,
}) {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const engineRef = useRef(null);
  const dynamicRootRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.72, 0.85, 0.94, 1);

    const camera = new ArcRotateCamera(
      'camera',
      -Math.PI / 2.45,
      Math.PI / 3.05,
      11.5,
      new Vector3(0, 0.65, 0),
      scene,
    );
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 5;
    camera.upperRadiusLimit = 20;

    const ambient = new HemisphericLight('sky-ambient-light', new Vector3(0.2, 1, 0.1), scene);
    ambient.intensity = 0.78;
    const sun = new DirectionalLight('sun-key-light', new Vector3(-0.45, -1, -0.25), scene);
    sun.position = new Vector3(5, 8, 4);
    sun.intensity = 0.82;

    renderPracticeWorld(scene);
    updateEnvironment(scene, environmentMode, weatherMode);

    const handleCanvasClick = (event) => {
      const toggleRemote = scene.metadata?.onRemoteToggle;
      const toggleOuterRing = scene.metadata?.onOuterRingToggle;
      const rect = canvas.getBoundingClientRect();
      const pick = pickMeshAtCssPoint(scene, event.clientX - rect.left, event.clientY - rect.top);
      const role = pick?.pickedMesh?.metadata?.role;
      if (role === 'spell-remote' && typeof toggleRemote === 'function') {
        window.__WHA_REMOTE_PICK_COUNT__ = (window.__WHA_REMOTE_PICK_COUNT__ ?? 0) + 1;
        toggleRemote();
      } else if (role === 'activation-ring-toggle' && typeof toggleOuterRing === 'function') {
        window.__WHA_RING_HANDLE_PICK_COUNT__ = (window.__WHA_RING_HANDLE_PICK_COUNT__ ?? 0) + 1;
        toggleOuterRing();
      }
    };
    canvas.addEventListener('click', handleCanvasClick);

    dynamicRootRef.current = new TransformNode('dynamic-root', scene);
    sceneRef.current = scene;
    engineRef.current = engine;

    engine.runRenderLoop(() => {
      scene.render();
    });

    const resize = () => engine.resize();
    window.addEventListener('resize', resize);

    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('click', handleCanvasClick);
      scene.dispose();
      engine.dispose();
      sceneRef.current = null;
      engineRef.current = null;
      dynamicRootRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    renderDynamicScene({
      scene,
      dynamicRootRef,
      runtimeResult,
      sources,
      props,
      sceneLeftovers,
      updateSourcePosition,
      updatePropPosition,
      updateSpellPlacement,
      onRemoteToggle,
      onOuterRingToggle,
      environmentMode,
      weatherMode,
      timelinePaused,
    });
  }, [
    runtimeResult,
    sources,
    props,
    sceneLeftovers,
    updateSourcePosition,
    updatePropPosition,
    updateSpellPlacement,
    onRemoteToggle,
    onOuterRingToggle,
    environmentMode,
    weatherMode,
    timelinePaused,
  ]);

  return (
    <canvas
      ref={canvasRef}
      className="scene-canvas"
      data-testid="scene-canvas"
      aria-label="3D spell sandbox"
    />
  );
}

function renderPracticeWorld(scene) {
  const sky = MeshBuilder.CreateSphere(
    'world-sky-dome',
    { diameter: 80, segments: 32, sideOrientation: Mesh.BACKSIDE },
    scene,
  );
  sky.position.y = -8;
  const skyMaterial = new StandardMaterial('sky-dome-material', scene);
  skyMaterial.diffuseColor = new Color3(0.62, 0.78, 0.92);
  skyMaterial.specularColor = Color3.Black();
  skyMaterial.backFaceCulling = false;
  sky.material = skyMaterial;

  const ground = MeshBuilder.CreateGround(
    'practice-field-terrain',
    { width: 24, height: 18, subdivisions: 64 },
    scene,
  );
  ground.material = practiceGroundMaterial(scene);
  applyTerrainVariation(ground);

  const clearing = MeshBuilder.CreateCylinder(
    'practice-dirt-clearing',
    { diameter: 5.6, height: 0.018, tessellation: 72 },
    scene,
  );
  clearing.position.y = 0.025;
  clearing.material = material(scene, 'dirt-clearing-material', new Color3(0.46, 0.36, 0.24), 0.94);

  const path = MeshBuilder.CreateBox(
    'practice-dirt-path',
    { width: 2.1, height: 0.02, depth: 13.5 },
    scene,
  );
  path.position = new Vector3(-4.2, 0.03, 0.8);
  path.rotation.y = -0.14;
  path.material = material(scene, 'dirt-path-material', new Color3(0.42, 0.33, 0.23), 0.86);

  const horizon = MeshBuilder.CreateTorus(
    'world-horizon-band',
    { diameter: 34, thickness: 0.08, tessellation: 128 },
    scene,
  );
  horizon.position.y = -0.02;
  horizon.material = material(scene, 'horizon-band-material', new Color3(0.46, 0.64, 0.53), 0.82);

  const sun = MeshBuilder.CreateSphere('world-sun-marker', { diameter: 0.72, segments: 24 }, scene);
  sun.position = new Vector3(6.5, 7.5, -7.5);
  sun.material = emissiveMaterial(scene, 'sun-marker-material', new Color3(1, 0.82, 0.34));

  renderTree(scene, new Vector3(2.6, 0, 1.5));
  renderStaticProps(scene);
}

function practiceGroundMaterial(scene) {
  const texture = new DynamicTexture('practice-ground-texture', { width: 512, height: 512 }, scene, true);
  const context = texture.getContext();
  context.fillStyle = '#6f8f55';
  context.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 900; i += 1) {
    const x = (i * 73) % 512;
    const y = (i * 191) % 512;
    const size = 1 + (i % 5);
    context.fillStyle = i % 4 === 0 ? '#496f3d' : i % 7 === 0 ? '#8a734d' : '#789b5d';
    context.fillRect(x, y, size, size);
  }
  texture.update();

  const mat = new StandardMaterial('practice-ground-material', scene);
  mat.diffuseTexture = texture;
  mat.diffuseColor = new Color3(0.78, 0.9, 0.68);
  mat.specularColor = new Color3(0.05, 0.07, 0.04);
  return mat;
}

function applyTerrainVariation(ground) {
  const positions = ground.getVerticesData(VertexBuffer.PositionKind);
  if (!positions) return;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const z = positions[i + 2];
    const nearPracticeArea = Math.hypot(x, z) < 3;
    positions[i + 1] = nearPracticeArea
      ? 0
      : Math.sin(x * 0.52) * 0.055 + Math.cos(z * 0.46) * 0.04;
  }
  ground.setVerticesData(VertexBuffer.PositionKind, positions, true);
  const indices = ground.getIndices();
  const normals = [];
  VertexData.ComputeNormals(positions, indices, normals);
  ground.setVerticesData(VertexBuffer.NormalKind, normals, true);
}

function renderTree(scene, position) {
  const trunk = MeshBuilder.CreateCylinder(
    'world-tree-trunk',
    { diameterTop: 0.34, diameterBottom: 0.52, height: 2.1, tessellation: 12 },
    scene,
  );
  trunk.position = position.add(new Vector3(0, 1.05, 0));
  trunk.material = material(scene, 'tree-trunk-material', new Color3(0.43, 0.29, 0.18), 1);

  const foliageMaterial = material(scene, 'tree-foliage-material', new Color3(0.18, 0.43, 0.24), 1);
  for (const [index, offset] of [
    new Vector3(0, 2.25, 0),
    new Vector3(-0.45, 1.95, 0.12),
    new Vector3(0.43, 1.9, -0.08),
  ].entries()) {
    const foliage = MeshBuilder.CreateSphere(
      `world-tree-canopy-${index}`,
      { diameter: index === 0 ? 1.6 : 1.18, segments: 18 },
      scene,
    );
    foliage.position = position.add(offset);
    foliage.material = foliageMaterial;
  }
}

function renderStaticProps(scene) {
  const stoneMaterial = material(scene, 'field-stone-material', new Color3(0.42, 0.45, 0.4), 1);
  for (const [index, position] of [
    new Vector3(3.0, 0.16, -2.6),
    new Vector3(3.5, 0.12, -2.15),
    new Vector3(-3.3, 0.14, 2.6),
  ].entries()) {
    const stone = MeshBuilder.CreatePolyhedron(
      `field-stone-${index}`,
      { type: 2, size: 0.32 + index * 0.04 },
      scene,
    );
    stone.position = position;
    stone.material = stoneMaterial;
  }

  const crateMaterial = material(scene, 'practice-crate-material', new Color3(0.53, 0.36, 0.2), 1);
  for (const [index, position] of [new Vector3(-3.4, 0.27, -2.4), new Vector3(-2.85, 0.22, -2.0)].entries()) {
    const crate = MeshBuilder.CreateBox(
      `field-practice-crate-${index}`,
      { width: 0.58, height: 0.46, depth: 0.58 },
      scene,
    );
    crate.position = position;
    crate.material = crateMaterial;
  }
}

function updateEnvironment(scene, environmentMode, weatherMode) {
  const night = environmentMode === 'night';
  const dusk = environmentMode === 'dusk';
  const clearColor = night
    ? new Color4(0.06, 0.08, 0.13, 1)
    : dusk
      ? new Color4(0.62, 0.46, 0.55, 1)
      : new Color4(0.72, 0.85, 0.94, 1);
  const skyColor = night
    ? new Color3(0.04, 0.06, 0.12)
    : dusk
      ? new Color3(0.68, 0.42, 0.46)
      : new Color3(0.62, 0.78, 0.92);
  const ambientIntensity = night ? 0.28 : dusk ? 0.48 : 0.78;
  const sunIntensity = night ? 0.16 : dusk ? 0.44 : 0.82;
  scene.clearColor = clearColor;
  const ambient = scene.getLightByName('sky-ambient-light');
  if (ambient) ambient.intensity = ambientIntensity;
  const sun = scene.getLightByName('sun-key-light');
  if (sun) sun.intensity = weatherMode === 'rain' ? sunIntensity * 0.68 : sunIntensity;
  const sky = scene.getMaterialByName('sky-dome-material');
  if (sky) {
    sky.diffuseColor = skyColor;
  }
}

function environmentLightingDebug(scene) {
  const ambient = scene.getLightByName('sky-ambient-light');
  const sun = scene.getLightByName('sun-key-light');
  const sky = scene.getMaterialByName('sky-dome-material');
  return {
    clearColor: color4Debug(scene.clearColor),
    skyColor: color3Debug(sky?.diffuseColor),
    ambientIntensity: round(ambient?.intensity ?? 0),
    sunIntensity: round(sun?.intensity ?? 0),
  };
}

function color3Debug(color) {
  return {
    r: round(color?.r ?? 0),
    g: round(color?.g ?? 0),
    b: round(color?.b ?? 0),
  };
}

function color4Debug(color) {
  return {
    ...color3Debug(color),
    a: round(color?.a ?? 1),
  };
}

function renderDynamicScene({
  scene,
  dynamicRootRef,
  runtimeResult,
  sources,
  props,
  sceneLeftovers,
  updateSourcePosition,
  updatePropPosition,
  updateSpellPlacement,
  onRemoteToggle,
  onOuterRingToggle,
  environmentMode,
  weatherMode,
  timelinePaused,
}) {
  updateEnvironment(scene, environmentMode, weatherMode);
  scene.metadata = {
    ...(scene.metadata ?? {}),
    onRemoteToggle,
    onOuterRingToggle,
  };
  clearWaterColumnSimulations(scene);
  dynamicRootRef.current?.dispose();
  const root = new TransformNode('dynamic-root', scene);
  dynamicRootRef.current = root;

  const circle = runtimeResult?.intents.find(
    (intent) => intent.intentType === 'spell_circle_render_data',
  );
  const spellCircleDebug = renderSpellCircle(
    scene,
    root,
    circle,
    runtimeResult?.lifecycle,
    updateSpellPlacement,
    onOuterRingToggle,
  );
  const remoteDebug = renderSpellRemote(
    scene,
    root,
    runtimeResult?.lifecycle,
    circle,
    onRemoteToggle,
  );
  renderSources(scene, root, sources, updateSourcePosition);
  renderProps(scene, root, props, updatePropPosition);
  renderWaterColumns(scene, root, runtimeResult?.intents ?? [], runtimeResult?.lifecycle, timelinePaused, props);
  renderMaterialColumns(scene, root, runtimeResult?.intents ?? []);
  renderDispersions(scene, root, runtimeResult?.intents ?? []);
  const levitationDebug = renderLevitationForces(scene, root, runtimeResult?.intents ?? [], circle);
  renderLifecycleCleanup(scene, root, runtimeResult?.intents ?? [], sceneLeftovers);
  renderThermalStates(scene, root, runtimeResult?.intents ?? [], sources);
  renderRegionAnchors(scene, root, runtimeResult?.intents ?? []);
  renderMaterialStates(scene, root, runtimeResult?.intents ?? [], circle);
  const sourceFieldDebug = renderSourceAcquisitions(
    scene,
    root,
    runtimeResult?.intents ?? [],
    sources,
    props,
    circle,
  );
  renderPhysicsMotions(scene, root, runtimeResult?.intents ?? []);
  const targetVolumeDebug = renderTargetingDebug(scene, root, runtimeResult?.intents ?? [], circle);
  renderFieldModifications(scene, root, runtimeResult?.intents ?? [], circle);
  renderWeather(scene, root, weatherMode);

  window.__WHA_SCENE_READY__ = true;
  window.__WHA_SCENE_MESH_COUNT__ = scene.meshes.length;
  window.__WHA_SCENE_FEATURES__ = scene.meshes.map((mesh) => mesh.name);
  window.__WHA_SCENE_ENVIRONMENT__ = { environmentMode, weatherMode };
  window.__WHA_ENVIRONMENT_LIGHTING__ = environmentLightingDebug(scene);
  window.__WHA_LIGHT_EFFECTS__ = scene.lights
    .filter((light) => light.name.startsWith('spell-light:'))
    .map((light) => ({
      name: light.name,
      intensity: light.intensity,
      range: light.range,
      position: {
        x: round(light.position?.x ?? 0),
        y: round(light.position?.y ?? 0),
        z: round(light.position?.z ?? 0),
      },
    }));
  window.__WHA_SOURCE_VISUALS__ = sources.map((source) => ({
    id: source.id,
    kind: source.kind,
    materialState: source.materialState ?? source.kind,
    visualPreset: sourceVisualPreset(source),
    position: {
      x: round(source.position?.x ?? 0),
      y: round(source.position?.y ?? 0),
      z: round(source.position?.z ?? 0),
    },
    fillRatio: source.nonDepleting
      ? 1
      : clamp(source.amount / Math.max(1, source.capacity), 0, 1),
  }));
  window.__WHA_PROP_VISUALS__ = props.map((prop) => ({
    id: prop.id,
    kind: prop.kind,
    label: prop.label,
    visualKind: prop.visualKind ?? prop.kind,
    visualPreset: propVisualPreset(prop),
    targetRole: prop.targetRole ?? null,
    movable: prop.movable !== false,
    position: {
      x: round(prop.position?.x ?? 0),
      y: round(prop.position?.y ?? 0),
      z: round(prop.position?.z ?? 0),
    },
  }));
  window.__WHA_SPELL_PLACEMENT__ = circle?.placementFrame?.origin ?? null;
  window.__WHA_SPELL_PLACEMENT_FRAME__ = circle?.placementFrame ?? null;
  window.__WHA_SPELL_CIRCLE_VISUAL__ = spellCircleDebug;
  const activationCircuit = (runtimeResult?.intents ?? []).find(
    (intent) => intent.intentType === 'activation_circuit',
  );
  window.__WHA_ACTIVATION_CIRCUIT__ = activationCircuit
    ? {
        completion: activationCircuit.completion,
        completionPercent: activationCircuit.completionPercent,
        completionThreshold: activationCircuit.completionThreshold,
        closed: activationCircuit.closed,
        circuitState: activationCircuit.circuitState,
        breakAmount: activationCircuit.breakAmount,
        dormantWhenIncomplete: activationCircuit.dormantWhenIncomplete,
        mechanicalCompletionReady: activationCircuit.mechanicalCompletionReady,
        mechanicalCompletion: activationCircuit.mechanicalCompletion,
        mechanicalCompleters: activationCircuit.mechanicalCompleters ?? [],
        completionSource: activationCircuit.completionSource,
        interactionAffordance: activationCircuit.interactionAffordance,
        reason: activationCircuit.reason,
      }
    : null;
  window.__WHA_SPELL_REMOTE__ = runtimeResult?.lifecycle
    ? {
        active: runtimeResult.lifecycle.active,
        phase: runtimeResult.lifecycle.phase,
        mode: runtimeResult.lifecycle.mode,
        outerRingClosed: runtimeResult.lifecycle.outerRingClosed,
        outerRingCompletion: runtimeResult.lifecycle.outerRingCompletion,
        activationGate: runtimeResult.lifecycle.activationGate,
        elapsedMs: runtimeResult.lifecycle.elapsedMs,
        remainingMs: runtimeResult.lifecycle.remainingMs,
        timelinePaused,
        interactive: typeof onRemoteToggle === 'function',
        screenPoint: remoteDebug?.screenPoint ?? null,
      }
    : null;
  window.__WHA_SPELL_ACTIVATION__ = runtimeResult?.lifecycle
    ? {
        active: runtimeResult.lifecycle.active,
        phase: runtimeResult.lifecycle.phase,
        requestedActive: runtimeResult.lifecycle.requestedActive,
        outerRingClosed: runtimeResult.lifecycle.outerRingClosed,
        outerRingCompletion: runtimeResult.lifecycle.outerRingCompletion,
        activationCircuitState: runtimeResult.lifecycle.activationCircuitState,
        activationGate: runtimeResult.lifecycle.activationGate,
        elapsedMs: runtimeResult.lifecycle.elapsedMs,
        remainingMs: runtimeResult.lifecycle.remainingMs,
        timelinePaused,
      }
    : null;
  window.__WHA_COLUMN_DEBUG__ = (runtimeResult?.intents ?? [])
    .filter(
      (intent) =>
        ['water_column', 'material_column'].includes(intent.intentType) && intent.active,
    )
    .map((intent) => ({
      type: intent.intentType,
      materialKind: intent.materialKind,
      materialState: intent.materialState ?? null,
      phase: intent.phase ?? null,
      renderPreset: intent.renderPreset ?? null,
      origin: intent.origin,
      originPolicy: intent.originPolicy,
      sourceFreeOrigin: intent.sourceFreeOrigin,
      sourceId: intent.sourceId ?? null,
      sourceMaterialState: intent.sourceMaterialState ?? null,
      sourceCandidateKind: intent.sourceCandidateKind ?? null,
      sourceMaterialFamily: intent.sourceMaterialFamily ?? null,
      gatheredMaterialPreserved: intent.gatheredMaterialPreserved === true,
      sourceMaterialHandoffPolicy: intent.sourceMaterialHandoffPolicy ?? null,
      sourceHandoffScope: intent.sourceHandoffScope ?? null,
      ignoredSourceHandoff: intent.ignoredSourceHandoff ?? null,
      sceneAxis: intent.sceneAxis,
      interactionPolicy: intent.interactionPolicy ?? null,
      flowCuePreset:
        intent.intentType === 'water_column' && waterColumnHasFlowCues(intent)
          ? 'authored_pressure_stream_contact_solver_no_pooling'
          : null,
      emergence: intent.emergence
        ? {
            anchorCount: intent.emergence.anchorCount,
            budgetPolicy: intent.emergence.budgetPolicy,
            anchors: (intent.emergence.anchors ?? []).map((anchor) => ({
              anchorId: anchor.anchorId,
              placement: anchor.placement,
              weight: anchor.weight,
              clusterSize: anchor.clusterSize,
              clusterPolicy: anchor.clusterPolicy,
              budgetShare: anchor.budgetShare,
              budgetAmount: anchor.budgetAmount,
              scenePosition: anchor.scenePosition,
            })),
          }
        : null,
      convergenceMode: intent.convergenceMode ?? null,
      compressedByConvergence: intent.compressedByConvergence === true,
      compressionVisual: intent.compressionVisual ?? null,
    }));
  window.__WHA_DISPERSION_DEBUG__ = (runtimeResult?.intents ?? [])
    .filter(
      (intent) =>
        ['water_dispersion', 'material_dispersion'].includes(intent.intentType) &&
        intent.active,
    )
    .map((intent) => ({
      type: intent.intentType,
      materialKind: intent.materialKind,
      materialState: intent.materialState ?? null,
      phase: intent.phase,
      renderPreset: intent.renderPreset,
      origin: intent.origin,
      originPolicy: intent.originPolicy,
      sourceFreeOrigin: intent.sourceFreeOrigin,
      sourceId: intent.sourceId ?? null,
      sourceMaterialState: intent.sourceMaterialState ?? null,
      sourceCandidateKind: intent.sourceCandidateKind ?? null,
      sourceMaterialFamily: intent.sourceMaterialFamily ?? null,
      gatheredMaterialPreserved: intent.gatheredMaterialPreserved === true,
      sourceMaterialHandoffPolicy: intent.sourceMaterialHandoffPolicy ?? null,
      sourceHandoffScope: intent.sourceHandoffScope ?? null,
      ignoredSourceHandoff: intent.ignoredSourceHandoff ?? null,
      sceneAxis: intent.sceneAxis,
      spread: intent.spread,
      emissionKind: intent.emissionKind,
      interactionPolicy: intent.interactionPolicy ?? null,
      resourceBudget: intent.resourceBudget,
      emergence: intent.emergence
        ? {
            anchorCount: intent.emergence.anchorCount,
            budgetPolicy: intent.emergence.budgetPolicy,
            anchors: (intent.emergence.anchors ?? []).map((anchor) => ({
              anchorId: anchor.anchorId,
              placement: anchor.placement,
              weight: anchor.weight,
              clusterSize: anchor.clusterSize,
              clusterPolicy: anchor.clusterPolicy,
              budgetShare: anchor.budgetShare,
              budgetAmount: anchor.budgetAmount,
              scenePosition: anchor.scenePosition,
            })),
          }
        : null,
    }));
  window.__WHA_MATERIAL_STATES__ = (runtimeResult?.intents ?? [])
    .filter((intent) => intent.intentType === 'material_state' && intent.active)
    .map((intent) => ({
      id: intent.id,
      materialKind: intent.materialKind,
      materialFamily: intent.materialFamily,
      phase: intent.phase,
      renderPreset: intent.renderPreset,
      sourceRequired: intent.sourceRequired,
      sourceId: intent.sourceId ?? null,
      materialOrigin: intent.materialOrigin,
      reversion: intent.reversion ?? null,
      attachment: intent.attachment ?? null,
      modifierLifecycle: intent.modifierLifecycle ?? null,
      visualPreset: materialStateVisualPreset(intent),
    }));
  window.__WHA_THERMAL_STATES__ = thermalDebug(runtimeResult?.intents ?? []);
  window.__WHA_TARGETING_DEBUG__ = (runtimeResult?.intents ?? [])
    .filter((intent) => intent.intentType === 'targeting_debug')
    .map((intent) => ({
      mode: intent.mode,
      defaulted: intent.defaulted,
      reason: intent.reason,
      signSize: intent.signSize,
      modifierWeakEffect: intent.modifierWeakEffect,
      targetVolume: intent.targetVolume,
    }));
  window.__WHA_TARGET_VOLUME_VISUALS__ = targetVolumeDebug;
  window.__WHA_REGION_DEBUG__ = regionDebug(runtimeResult?.intents ?? []);
  window.__WHA_LEVITATION_VISUALS__ = levitationDebug;
  window.__WHA_PHYSICS_MOTION__ = (runtimeResult?.intents ?? [])
    .filter((intent) => intent.intentType === 'physics_motion')
    .map((intent) => ({
      motionKind: intent.motionKind,
      sourceMode: intent.sourceMode,
      active: intent.active,
      sourceId: intent.sourceId,
      movesActualSceneObject: intent.movesActualSceneObject,
      reservoirPreviewOnly: intent.reservoirPreviewOnly,
      visualPreset: physicsMotionVisualPreset(intent),
      motionRatio: intent.motionRatio,
      motionProgress: intent.motionProgress,
      motionDurationMs: intent.motionDurationMs,
      motionTimingPolicy: intent.motionTimingPolicy,
      baselinePosition: intent.baselinePosition ?? null,
      currentObjectPosition: intent.currentObjectPosition ?? null,
      toPosition: intent.toPosition ?? null,
      sourceFieldOrigin: intent.sourceFieldOrigin ?? null,
      sourceFieldOriginId: intent.sourceFieldOriginId ?? null,
      sourceFieldOriginPolicy: intent.sourceFieldOriginPolicy ?? null,
      pullCapacity: intent.pullCapacity,
      pullDifficulty: intent.pullDifficulty,
    }));
  window.__WHA_EFFECT_LIFECYCLE__ = (runtimeResult?.intents ?? [])
    .filter((intent) => intent.intentType === 'effect_lifecycle')
    .map((intent) => ({
      operation: intent.operation,
      operationIndex: intent.operationIndex,
      sourceIntentId: intent.sourceIntentId,
      sourceIntentType: intent.sourceIntentType,
      lifecyclePhase: intent.lifecyclePhase,
      effectRuntimePhase: intent.effectRuntimePhase,
      elapsedMs: intent.elapsedMs,
      dtMs: intent.dtMs,
      cleanupIntentId: intent.cleanupIntentId,
      disposalPolicy: intent.disposalPolicy,
      createsPersistentMaterial: intent.createsPersistentMaterial,
      leftover: intent.leftover ?? null,
    }));
  window.__WHA_SOURCE_ACQUISITIONS__ = sourceAcquisitionDebug(runtimeResult?.intents ?? []);
  window.__WHA_SOURCE_FIELD_VISUALS__ = sourceFieldDebug;
  window.__WHA_SOURCE_SPENDS__ = sourceSpendDebug(runtimeResult?.intents ?? []);
  window.__WHA_PERSISTENT_LEFTOVERS__ = sceneLeftovers.map((leftover) => ({
    id: leftover.id,
    sourceCleanupId: leftover.sourceCleanupId,
    activationInstanceId: leftover.activationInstanceId,
    programId: leftover.programId,
    renderPreset: leftover.leftover?.renderPreset,
    behavior: leftover.leftover?.behavior,
    remainsInWorld: leftover.leftover?.remainsInWorld,
    finite: leftover.leftover?.finite,
    amount: leftover.leftover?.amount,
    units: leftover.leftover?.units,
    budgetPolicy: leftover.leftover?.budgetPolicy,
    outputShape: leftover.leftover?.outputShape,
    cleanupPolicy: leftover.cleanupPolicy ?? null,
  }));
  window.__WHA_CONVERGENCE_VISUALS__ = convergenceVisualDebug(runtimeResult?.intents ?? []);
  window.__WHA_PICK_MESH_AT__ = (x, y) => {
    return pickMeshAtCssPoint(scene, x, y)?.pickedMesh?.name ?? null;
  };
}

function renderSpellCircle(scene, root, circle, lifecycle, updateSpellPlacement, onOuterRingToggle) {
  if (!circle?.active) return null;
  const seal = circle.seals?.[0];
  if (!seal) return null;
  const frame = circle.placementFrame ?? {};
  const circleRoot = new TransformNode('spell-placement-root', scene);
  circleRoot.parent = root;
  circleRoot.position = toVector(frame.origin ?? { x: 0, y: 0, z: 0 });
  circleRoot.rotationQuaternion = rotationFromUp(
    toSceneAxis(frame.normal ?? { x: 0, y: 1, z: 0 }),
  );

  const maxRadius = Math.max(
    120,
    ...seal.rings.map((ring) => ring.radius || 0),
    ...seal.symbols.map((symbol) => symbol.polarRadius || Math.hypot(symbol.position.x, symbol.position.y)),
  );
  const scale = 2.25 / maxRadius;
  const outerRingRadius = Math.max(
    ...(seal.rings.length > 0 ? seal.rings : [{ radius: 120 }]).map(
      (ring) => ring.radius || 0,
    ),
  );
  const worldOuterRadius = Math.max(1.2, outerRingRadius * scale);

  const handle = MeshBuilder.CreateCylinder(
    'spell-placement-handle',
    { diameter: 5.05, height: 0.012, tessellation: 72 },
    scene,
  );
  handle.parent = circleRoot;
  handle.position.y = 0.018;
  handle.material = material(scene, 'spell-placement-handle-material', new Color3(0.32, 0.52, 0.41), 0.12);
  addPlacementDrag(handle, updateSpellPlacement);

  const ringMaterial = material(scene, 'circle-line', new Color3(0.12, 0.29, 0.22), 1);
  for (const ring of seal.rings.length > 0 ? seal.rings : [{ ringId: 'fallback', radius: 120 }]) {
    const radius = Math.max(1.2, (ring.radius || maxRadius * 0.55) * scale);
    const torus = MeshBuilder.CreateTorus(
      `spell-ring:${ring.ringId}`,
      { diameter: radius * 2, thickness: 0.018, tessellation: 96 },
      scene,
    );
    torus.parent = circleRoot;
    torus.position.y = 0.035;
    torus.material = ringMaterial;
  }
  const ringToggleDebug = renderActivationRingToggle(
    scene,
    circleRoot,
    lifecycle,
    worldOuterRadius,
    onOuterRingToggle,
  );

  if (lifecycle?.outerRingClosed === false) {
    const breakAmount = clamp(1 - Number(lifecycle.outerRingCompletion ?? 0), 0, 1);
    const gap = MeshBuilder.CreateBox(
      'spell-ring-open-gap',
      { width: 0.16 + breakAmount * 0.28, height: 0.055, depth: 0.16 },
      scene,
    );
    gap.parent = circleRoot;
    gap.position = new Vector3(0, 0.07, -worldOuterRadius);
    gap.material = emissiveMaterial(
      scene,
      'spell-ring-open-gap-material',
      new Color3(0.88, 0.28, 0.16),
    );
  }

  const sigilMaterial = material(scene, 'sigil-material', new Color3(0.2, 0.49, 0.37), 1);
  const signMaterial = material(scene, 'sign-material', new Color3(0.1, 0.22, 0.18), 1);
  for (const symbol of seal.symbols) {
    const pos = symbolPosition(symbol, scale);
    const disc = MeshBuilder.CreateCylinder(
      `symbol:${symbol.objectId}`,
      { diameter: symbol.categoryHint === 'sigil' ? 0.24 : 0.16, height: 0.025, tessellation: 28 },
      scene,
    );
    disc.parent = circleRoot;
    disc.position = new Vector3(pos.x, 0.055, pos.z);
    disc.material = symbol.categoryHint === 'sigil' ? sigilMaterial : signMaterial;

    const label = makeLabel(scene, `label:${symbol.objectId}`, symbol.label, 0.72, 0.18);
    label.parent = circleRoot;
    label.position = new Vector3(pos.x, 0.42, pos.z);
  }

  return {
    maxSourceRadius: maxRadius,
    outerRingRadius,
    worldOuterRadius: round(worldOuterRadius),
    worldOuterDiameter: round(worldOuterRadius * 2),
    terrainWidth: 24,
    terrainHeight: 18,
    terrainWidthRatio: round((worldOuterRadius * 2) / 24),
    placementMode: circle.placementMode,
    activationRingHandle: ringToggleDebug,
  };
}

function renderActivationRingToggle(scene, circleRoot, lifecycle, worldOuterRadius, onOuterRingToggle) {
  if (!lifecycle) return null;
  const closed = lifecycle.outerRingClosed !== false;
  const completion = clamp(Number(lifecycle.outerRingCompletion ?? (closed ? 1 : 0)), 0, 1);
  const stateName = closed ? 'closed' : completion > 0 ? 'partial' : 'open';
  const handle = MeshBuilder.CreateBox(
    `activation-ring-toggle:${stateName}`,
    {
      width: closed ? 0.24 : 0.42,
      height: 0.075,
      depth: 0.18,
    },
    scene,
  );
  handle.parent = circleRoot;
  handle.position = new Vector3(-0.22 + completion * 0.44, 0.105, -worldOuterRadius);
  handle.material = emissiveMaterial(
    scene,
    `activation-ring-toggle-material:${stateName}`,
    closed ? new Color3(0.28, 0.72, 0.42) : new Color3(0.94, 0.62, 0.22),
  );
  if (typeof onOuterRingToggle === 'function') {
    handle.metadata = {
      role: 'activation-ring-toggle',
      interactive: true,
      outerRingClosed: closed,
      action: closed ? 'break_outer_ring' : 'complete_outer_ring',
      canonicalTrigger: 'complete_outer_ring',
      outerRingCompletion: completion,
    };
  }

  const rail = MeshBuilder.CreateBox(
    `activation-ring-rail:${stateName}`,
    { width: 0.62, height: 0.018, depth: 0.06 },
    scene,
  );
  rail.parent = circleRoot;
  rail.position = new Vector3(0, 0.065, -worldOuterRadius);
  rail.material = material(scene, `activation-ring-rail-material:${stateName}`, new Color3(0.24, 0.33, 0.25), 0.62);

  return {
    present: true,
    state: stateName,
    action: closed ? 'break_outer_ring' : 'complete_outer_ring',
    completion,
    completionPercent: Math.round(completion * 100),
    interactive: typeof onOuterRingToggle === 'function',
    canonicalTrigger: 'complete_outer_ring',
    screenPoint: projectToScreen(scene, handle.getAbsolutePosition()),
  };
}

function renderSpellRemote(scene, root, lifecycle, circle, onRemoteToggle) {
  if (!lifecycle || !circle?.placementFrame) return null;
  const frame = circle.placementFrame;
  const origin = toVector(frame.origin ?? { x: 0, y: 0, z: 0 });
  const normal = toSceneAxis(frame.normal ?? { x: 0, y: 1, z: 0 });
  const tangent = toSceneAxis(frame.tangent ?? { x: 1, y: 0, z: 0 });
  const bitangent = toSceneAxis(frame.bitangent ?? { x: 0, y: 0, z: 1 });
  const remoteRoot = new TransformNode('spell-remote-root', scene);
  remoteRoot.parent = root;
  remoteRoot.position = origin
    .add(tangent.scale(-1.18))
    .add(bitangent.scale(-0.86))
    .add(normal.scale(0.1));
  remoteRoot.rotationQuaternion = rotationFromUp(normal);

  const body = MeshBuilder.CreateCylinder(
    'spell-remote-body',
    { diameterTop: 0.34, diameterBottom: 0.46, height: 0.16, tessellation: 28 },
    scene,
  );
  body.parent = remoteRoot;
  body.position.y = 0.08;
  body.material = material(scene, 'spell-remote-body-material', new Color3(0.18, 0.22, 0.18), 1);
  addRemoteToggle(body, onRemoteToggle);

  const socket = MeshBuilder.CreateTorus(
    'spell-remote-socket',
    { diameter: 0.38, thickness: 0.025, tessellation: 32 },
    scene,
  );
  socket.parent = remoteRoot;
  socket.position.y = 0.18;
  socket.material = material(scene, 'spell-remote-socket-material', new Color3(0.48, 0.56, 0.47), 1);
  addRemoteToggle(socket, onRemoteToggle);

  const stateColor = lifecycle.active
    ? new Color3(0.46, 0.86, 0.48)
    : new Color3(0.58, 0.22, 0.16);
  const hitArea = MeshBuilder.CreateSphere(
    'spell-remote-hit-area',
    { diameter: 0.9, segments: 18 },
    scene,
  );
  hitArea.parent = remoteRoot;
  hitArea.position.y = 0.36;
  hitArea.material = material(scene, 'spell-remote-hit-area-material', stateColor, 0.07);
  addRemoteToggle(hitArea, onRemoteToggle);

  const orb = MeshBuilder.CreateSphere(
    `spell-remote-state:${lifecycle.phase}`,
    { diameter: 0.18, segments: 18 },
    scene,
  );
  orb.parent = remoteRoot;
  orb.position.y = 0.32;
  orb.material = emissiveMaterial(scene, `spell-remote-state:${lifecycle.phase}:material`, stateColor);
  addRemoteToggle(orb, onRemoteToggle);

  const timer = MeshBuilder.CreateTorus(
    `spell-remote-timer:${lifecycle.phase}`,
    { diameter: 0.58, thickness: 0.012, tessellation: 48 },
    scene,
  );
  timer.parent = remoteRoot;
  timer.position.y = 0.03;
  timer.material = material(scene, `spell-remote-timer:${lifecycle.phase}:material`, stateColor, 0.78);
  addRemoteToggle(timer, onRemoteToggle);

  const progress = lifecycle.mode === 'timed'
    ? clamp(lifecycle.elapsedMs / Math.max(1, lifecycle.durationMs), 0, 1)
    : lifecycle.active
      ? 0
      : 1;
  const pointer = MeshBuilder.CreateBox(
    `spell-remote-progress:${lifecycle.phase}`,
    { width: 0.05, height: 0.035, depth: 0.1 },
    scene,
  );
  pointer.parent = remoteRoot;
  const angle = -Math.PI / 2 + progress * Math.PI * 2;
  pointer.position = new Vector3(Math.cos(angle) * 0.29, 0.045, Math.sin(angle) * 0.29);
  pointer.rotation.y = -angle;
  pointer.material = timer.material;
  addRemoteToggle(pointer, onRemoteToggle);

  const pickPosition = remoteRoot.position.add(normal.scale(0.36));
  return {
    screenPoint: projectToScreen(scene, pickPosition),
  };
}

function projectToScreen(scene, worldPosition) {
  const camera = scene.activeCamera;
  if (!camera) return null;
  const engine = scene.getEngine();
  const viewport = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
  const projected = Vector3.Project(
    worldPosition,
    Matrix.IdentityReadOnly,
    scene.getTransformMatrix(),
    viewport,
  );
  const canvas = engine.getRenderingCanvas();
  const scaleX = canvas ? canvas.clientWidth / Math.max(1, engine.getRenderWidth()) : 1;
  const scaleY = canvas ? canvas.clientHeight / Math.max(1, engine.getRenderHeight()) : 1;
  return {
    x: projected.x * scaleX,
    y: projected.y * scaleY,
    z: projected.z,
  };
}

function pickMeshAtCssPoint(scene, x, y) {
  const engine = scene.getEngine();
  const canvas = engine.getRenderingCanvas();
  const scaleX = canvas ? engine.getRenderWidth() / Math.max(1, canvas.clientWidth) : 1;
  const scaleY = canvas ? engine.getRenderHeight() / Math.max(1, canvas.clientHeight) : 1;
  return scene.pick(x * scaleX, y * scaleY);
}

function addRemoteToggle(mesh, onRemoteToggle) {
  if (typeof onRemoteToggle !== 'function') return;
  mesh.metadata = {
    ...(mesh.metadata ?? {}),
    role: 'spell-remote',
    interactive: true,
  };
}

function renderSources(scene, root, sources, updateSourcePosition) {
  for (const source of sources) {
    const fillRatio = source.nonDepleting
      ? 1
      : clamp(source.amount / Math.max(1, source.capacity), 0, 1);
    const base = MeshBuilder.CreateCylinder(
      `source:${source.id}`,
      { diameter: 0.72, height: 0.18, tessellation: 32 },
      scene,
    );
    base.parent = root;
    base.position = toVector(source.position, 0.09);
    base.material = sourceMaterial(scene, source.kind, 0.85);
    addDrag(base, source.id, updateSourcePosition);

    if (isMistCloudSource(source)) {
      renderMistSource(scene, base, source, fillRatio);
    } else if (source.kind === 'water') {
      base.name = `water-basin:${source.id}`;
      const rim = MeshBuilder.CreateTorus(
        `water-basin-rim:${source.id}`,
        { diameter: 0.8, thickness: 0.055, tessellation: 36 },
        scene,
      );
      rim.parent = base;
      rim.position.y = 0.15;
      rim.material = material(scene, `basin-rim:${source.id}`, new Color3(0.38, 0.42, 0.38), 1);

      const innerWall = MeshBuilder.CreateCylinder(
        `water-basin-inner:${source.id}`,
        { diameter: 0.68, height: 0.32, tessellation: 32 },
        scene,
      );
      innerWall.parent = base;
      innerWall.position.y = 0.08;
      innerWall.material = material(scene, `basin-wall:${source.id}`, new Color3(0.47, 0.52, 0.47), 0.82);

      const level = MeshBuilder.CreateCylinder(
        `water-basin-level:${source.id}`,
        { diameter: 0.58, height: 0.025, tessellation: 40 },
        scene,
      );
      level.parent = base;
      level.position.y = 0.16 + fillRatio * 0.24;
      level.material = material(scene, `water:${source.id}`, new Color3(0.18, 0.57, 0.76), 0.72);

      const levelMeter = MeshBuilder.CreateBox(
        `water-basin-meter:${source.id}`,
        { width: 0.08, height: Math.max(0.06, fillRatio * 0.52), depth: 0.05 },
        scene,
      );
      levelMeter.parent = base;
      levelMeter.position = new Vector3(0.48, 0.18 + fillRatio * 0.26, 0);
      levelMeter.material = material(scene, `water-meter:${source.id}`, new Color3(0.1, 0.44, 0.68), 0.9);
    } else if (source.kind === 'fire') {
      renderFireSource(scene, base, source, fillRatio);
    } else if (source.kind === 'earth') {
      renderEarthSource(scene, base, source, fillRatio);
    }

    const label = makeLabel(
      scene,
      `source-label:${source.id}`,
      `${source.label}${source.nonDepleting ? ' inf' : ` ${Math.round(source.amount)}`}`,
      0.86,
      0.2,
    );
    label.parent = base;
    label.position.y = 0.74;
  }
}

function renderMistSource(scene, base, source, fillRatio) {
  base.name = `mist-source:${source.id}`;
  base.material = material(scene, `mist-source-pad:${source.id}`, new Color3(0.5, 0.62, 0.6), 0.34);

  const mat = material(scene, `mist-source-material:${source.id}`, new Color3(0.66, 0.78, 0.82), 0.36);
  for (let index = 0; index < 9; index += 1) {
    const angle = (Math.PI * 2 * index) / 9;
    const radius = index === 0 ? 0 : 0.18 + (index % 3) * 0.09;
    const puff = MeshBuilder.CreateSphere(
      `mist-source-puff:${source.id}:${index}`,
      { diameter: (0.22 + (index % 3) * 0.07) * (0.65 + fillRatio * 0.65), segments: 16 },
      scene,
    );
    puff.parent = base;
    puff.position = new Vector3(
      Math.cos(angle) * radius,
      0.18 + (index % 4) * 0.08 + fillRatio * 0.1,
      Math.sin(angle) * radius,
    );
    puff.material = mat;
  }

  renderSourceMeter(
    scene,
    base,
    source,
    fillRatio,
    'mist-source-meter',
    new Color3(0.55, 0.72, 0.78),
  );
}

function renderFireSource(scene, base, source, fillRatio) {
  base.name = `fire-brazier:${source.id}`;
  base.material = material(scene, `fire-brazier-base:${source.id}`, new Color3(0.25, 0.24, 0.21), 1);

  const rim = MeshBuilder.CreateTorus(
    `fire-brazier-rim:${source.id}`,
    { diameter: 0.76, thickness: 0.045, tessellation: 32 },
    scene,
  );
  rim.parent = base;
  rim.position.y = 0.14;
  rim.material = material(scene, `fire-brazier-rim-material:${source.id}`, new Color3(0.18, 0.18, 0.16), 1);

  const emberBed = MeshBuilder.CreateCylinder(
    `fire-brazier-ember-bed:${source.id}`,
    { diameter: 0.56, height: 0.035, tessellation: 30 },
    scene,
  );
  emberBed.parent = base;
  emberBed.position.y = 0.18;
  emberBed.material = emissiveMaterial(
    scene,
    `fire-brazier-ember-bed-material:${source.id}`,
    new Color3(0.75, 0.24 + fillRatio * 0.12, 0.09),
  );

  for (let index = 0; index < 3; index += 1) {
    const flame = MeshBuilder.CreateSphere(
      `fire-brazier-flame:${source.id}:${index}`,
      { diameter: 0.18 + fillRatio * (0.16 + index * 0.035), segments: 16 },
      scene,
    );
    flame.parent = base;
    flame.position = new Vector3((index - 1) * 0.1, 0.3 + index * 0.06 + fillRatio * 0.12, index === 1 ? 0.04 : -0.03);
    flame.scaling.y = 1.45 + fillRatio * 0.55;
    flame.material = emissiveMaterial(
      scene,
      `fire-brazier-flame-material:${source.id}:${index}`,
      index === 1 ? new Color3(1, 0.62, 0.16) : new Color3(0.95, 0.28, 0.12),
    );
  }

  renderSourceMeter(
    scene,
    base,
    source,
    fillRatio,
    'fire-brazier-meter',
    new Color3(0.96, 0.42, 0.12),
  );
}

function renderEarthSource(scene, base, source, fillRatio) {
  base.name = `earth-tray:${source.id}`;
  base.material = material(scene, `earth-tray-base:${source.id}`, new Color3(0.34, 0.29, 0.22), 1);

  const rim = MeshBuilder.CreateTorus(
    `earth-tray-rim:${source.id}`,
    { diameter: 0.8, thickness: 0.04, tessellation: 30 },
    scene,
  );
  rim.parent = base;
  rim.position.y = 0.14;
  rim.scaling.z = 0.78;
  rim.material = material(scene, `earth-tray-rim-material:${source.id}`, new Color3(0.31, 0.25, 0.18), 1);

  const mound = MeshBuilder.CreateCylinder(
    `earth-tray-mound:${source.id}`,
    { diameter: 0.5 + fillRatio * 0.18, height: 0.1 + fillRatio * 0.16, tessellation: 18 },
    scene,
  );
  mound.parent = base;
  mound.position.y = 0.18 + fillRatio * 0.08;
  mound.scaling.z = 0.78;
  mound.material = material(scene, `earth-tray-mound-material:${source.id}`, new Color3(0.43, 0.36, 0.25), 1);

  for (let index = 0; index < 6; index += 1) {
    const angle = (Math.PI * 2 * index) / 6;
    const rock = MeshBuilder.CreatePolyhedron(
      `earth-tray-stone:${source.id}:${index}`,
      { type: index % 2 === 0 ? 1 : 2, size: 0.07 + fillRatio * 0.055 },
      scene,
    );
    rock.parent = base;
    rock.position = new Vector3(
      Math.cos(angle) * (0.12 + (index % 3) * 0.045),
      0.25 + fillRatio * 0.08 + (index % 2) * 0.025,
      Math.sin(angle) * (0.09 + (index % 2) * 0.04),
    );
    rock.rotation = new Vector3(index * 0.31, index * 0.19, index * 0.27);
    rock.material = material(scene, `earth-tray-stone-material:${source.id}:${index}`, new Color3(0.5, 0.43, 0.31), 1);
  }

  renderSourceMeter(
    scene,
    base,
    source,
    fillRatio,
    'earth-tray-meter',
    new Color3(0.5, 0.42, 0.27),
  );
}

function renderSourceMeter(scene, base, source, fillRatio, name, color) {
  const rail = MeshBuilder.CreateBox(
    `${name}-rail:${source.id}`,
    { width: 0.055, height: 0.56, depth: 0.04 },
    scene,
  );
  rail.parent = base;
  rail.position = new Vector3(0.48, 0.36, 0);
  rail.material = material(scene, `${name}-rail-material:${source.id}`, new Color3(0.2, 0.23, 0.2), 0.85);

  const amount = MeshBuilder.CreateBox(
    `${name}:${source.id}`,
    { width: 0.085, height: Math.max(0.045, fillRatio * 0.52), depth: 0.055 },
    scene,
  );
  amount.parent = base;
  amount.position = new Vector3(0.48, 0.11 + fillRatio * 0.26, 0);
  amount.material = material(scene, `${name}-material:${source.id}`, color, 0.92);
}

function sourceVisualPreset(source) {
  if (isMistCloudSource(source)) return 'mist_cloud_bank_with_meter';
  if (source.kind === 'water') return 'basin_with_level_meter';
  if (source.kind === 'fire') return 'brazier_with_ember_meter';
  if (source.kind === 'earth') return 'earth_tray_with_stone_meter';
  return 'simple_source_marker';
}

function isMistCloudSource(source) {
  return ['mist', 'cloud', 'mist_cloud'].includes(source.materialState ?? source.kind);
}

function renderProps(scene, root, props, updatePropPosition) {
  for (const prop of props) {
    if (prop.visualKind === 'tree_landmark') {
      renderTreeTargetProp(scene, root, prop);
      continue;
    }
    if (prop.visualKind === 'tree_apple') {
      renderTreeAppleProp(scene, root, prop, updatePropPosition);
      continue;
    }
    if (prop.visualKind === 'activation_ring_key') {
      renderActivationKeyProp(scene, root, prop, updatePropPosition);
      continue;
    }
    renderPracticeBlockProp(scene, root, prop, updatePropPosition);
  }
}

function propVisualPreset(prop) {
  if (prop.visualKind === 'tree_landmark') return 'tree_landmark_target_ring';
  if (prop.visualKind === 'tree_apple') return 'movable_tree_pull_target';
  if (prop.visualKind === 'activation_ring_key') return 'activation_ring_mechanical_key';
  return 'textured_practice_block_with_surface_faces';
}

function renderPracticeBlockProp(scene, root, prop, updatePropPosition) {
  const size = Math.max(0.3, prop.size ?? 1) * 0.45;
  const half = size / 2;
  const mesh = MeshBuilder.CreateBox(
    `prop:${prop.id}`,
    { size },
    scene,
  );
  mesh.parent = root;
  mesh.position = toVector(prop.position, 0.25);
  mesh.material = practiceBlockMaterial(scene, prop);
  mesh.metadata = {
    role: 'practice-block-prop',
    targetRole: prop.targetRole,
    movable: prop.movable !== false,
    visualPreset: propVisualPreset(prop),
  };
  addDrag(mesh, prop.id, updatePropPosition);

  renderPracticeBlockBands(scene, mesh, prop.id, size);
  renderPracticeBlockFaceMarkers(scene, mesh, prop.id, half);

  const label = makeLabel(scene, `prop-label:${prop.id}`, prop.label, 0.8, 0.2);
  label.parent = mesh;
  label.position.y = 0.55;
}

function practiceBlockMaterial(scene, prop) {
  const texture = new DynamicTexture(
    `practice-block-texture:${prop.id}`,
    { width: 256, height: 256 },
    scene,
    true,
  );
  const context = texture.getContext();
  context.fillStyle = '#768076';
  context.fillRect(0, 0, 256, 256);
  context.strokeStyle = '#58645c';
  context.lineWidth = 4;
  for (let line = 32; line < 256; line += 48) {
    context.beginPath();
    context.moveTo(line, 0);
    context.lineTo(line - 18, 256);
    context.stroke();
  }
  for (let index = 0; index < 180; index += 1) {
    const x = (index * 53) % 256;
    const y = (index * 97) % 256;
    context.fillStyle = index % 3 === 0 ? '#8a927f' : '#626d65';
    context.fillRect(x, y, 2 + (index % 3), 1 + (index % 2));
  }
  texture.update();

  const mat = new StandardMaterial(`practice-block-material:${prop.id}`, scene);
  mat.diffuseTexture = texture;
  mat.diffuseColor = new Color3(0.58, 0.64, 0.58);
  mat.specularColor = new Color3(0.06, 0.08, 0.06);
  return mat;
}

function renderPracticeBlockBands(scene, parent, propId, size) {
  const bandMaterial = material(
    scene,
    `practice-block-band-material:${propId}`,
    new Color3(0.24, 0.31, 0.26),
    0.94,
  );
  const band = Math.max(0.025, size * 0.075);
  const post = Math.max(0.035, size * 0.11);
  for (const [index, y] of [-size / 2 - band / 2, size / 2 + band / 2].entries()) {
    const cap = MeshBuilder.CreateBox(
      `practice-block-band:${propId}:cap-${index}`,
      { width: size + band * 1.1, height: band, depth: size + band * 1.1 },
      scene,
    );
    cap.parent = parent;
    cap.position = new Vector3(0, y, 0);
    cap.material = bandMaterial;
  }
  for (const x of [-size / 2, size / 2]) {
    for (const z of [-size / 2, size / 2]) {
      const corner = MeshBuilder.CreateBox(
        `practice-block-corner:${propId}:${x > 0 ? 'east' : 'west'}-${z > 0 ? 'south' : 'north'}`,
        { width: post, height: size + band, depth: post },
        scene,
      );
      corner.parent = parent;
      corner.position = new Vector3(x, 0, z);
      corner.material = bandMaterial;
    }
  }
}

function renderPracticeBlockFaceMarkers(scene, parent, propId, half) {
  const markerMaterial = material(
    scene,
    `practice-block-face-material:${propId}`,
    new Color3(0.21, 0.45, 0.34),
    0.62,
  );
  const inset = half * 0.7;
  const lift = 0.012;
  const faceSpecs = [
    ['east', { width: lift, height: inset, depth: inset }, new Vector3(half + lift, 0, 0)],
    ['west', { width: lift, height: inset, depth: inset }, new Vector3(-half - lift, 0, 0)],
    ['north', { width: inset, height: inset, depth: lift }, new Vector3(0, 0, -half - lift)],
    ['south', { width: inset, height: inset, depth: lift }, new Vector3(0, 0, half + lift)],
    ['top', { width: inset, height: lift, depth: inset }, new Vector3(0, half + lift, 0)],
  ];
  for (const [face, dimensions, position] of faceSpecs) {
    const marker = MeshBuilder.CreateBox(
      `practice-block-surface:${propId}:${face}`,
      dimensions,
      scene,
    );
    marker.parent = parent;
    marker.position = position;
    marker.material = markerMaterial;
    marker.metadata = {
      role: 'practice-block-surface-face',
      surfaceFace: face,
      visualPreset: 'attachable_surface_face_marker',
    };
  }
}

function renderActivationKeyProp(scene, root, prop, updatePropPosition) {
  const key = MeshBuilder.CreateBox(
    `activation-key:${prop.id}`,
    {
      width: Math.max(0.26, (prop.size ?? 0.58) * 0.46),
      height: 0.12,
      depth: Math.max(0.18, (prop.size ?? 0.58) * 0.32),
    },
    scene,
  );
  key.parent = root;
  key.position = toVector(prop.position, 0.12);
  key.material = emissiveMaterial(
    scene,
    `activation-key-material:${prop.id}`,
    new Color3(0.86, 0.66, 0.28),
  );
  key.metadata = {
    role: 'activation-ring-key',
    targetRole: prop.targetRole,
    movable: prop.movable !== false,
  };
  addDrag(key, prop.id, updatePropPosition);

  const notch = MeshBuilder.CreateBox(
    `activation-key-notch:${prop.id}`,
    { width: 0.08, height: 0.028, depth: 0.22 },
    scene,
  );
  notch.parent = key;
  notch.position = new Vector3(0.11, 0.076, 0);
  notch.material = material(scene, `activation-key-notch-material:${prop.id}`, new Color3(0.22, 0.16, 0.08), 0.92);

  const label = makeLabel(scene, `prop-label:${prop.id}`, prop.label, 0.78, 0.18);
  label.parent = key;
  label.position.y = 0.38;
}

function renderTreeTargetProp(scene, root, prop) {
  const base = toVector(prop.position, 0.03);
  const ring = MeshBuilder.CreateTorus(
    `tree-target-ring:${prop.id}`,
    { diameter: 1.9, thickness: 0.035, tessellation: 48 },
    scene,
  );
  ring.parent = root;
  ring.position = base.add(new Vector3(0, 0.055, 0));
  ring.material = material(scene, `tree-target-ring-material:${prop.id}`, new Color3(0.22, 0.42, 0.24), 0.58);
  ring.metadata = {
    role: 'tree-pull-landmark',
    targetRole: prop.targetRole,
    movable: false,
  };

  const label = makeLabel(scene, `tree-target-label:${prop.id}`, prop.label, 0.95, 0.2);
  label.parent = root;
  label.position = base.add(new Vector3(0, 2.95, 0));
}

function renderTreeAppleProp(scene, root, prop, updatePropPosition) {
  const apple = MeshBuilder.CreateSphere(
    `tree-apple-target:${prop.id}`,
    { diameter: Math.max(0.12, (prop.size ?? 0.42) * 0.5), segments: 18 },
    scene,
  );
  apple.parent = root;
  apple.position = toVector(prop.position, 0.22);
  apple.material = emissiveMaterial(scene, `tree-apple-material:${prop.id}`, new Color3(0.74, 0.08, 0.05));
  apple.metadata = {
    role: 'movable-tree-pull-target',
    targetRole: prop.targetRole,
    movable: prop.movable !== false,
  };
  addDrag(apple, prop.id, updatePropPosition);

  const stem = MeshBuilder.CreateCylinder(
    `tree-apple-stem:${prop.id}`,
    { diameter: 0.025, height: 0.12, tessellation: 8 },
    scene,
  );
  stem.parent = root;
  stem.position = apple.position.add(new Vector3(0, 0.16, 0));
  stem.material = material(scene, `tree-apple-stem-material:${prop.id}`, new Color3(0.28, 0.16, 0.07), 1);

  const label = makeLabel(scene, `prop-label:${prop.id}`, prop.label, 0.72, 0.17);
  label.parent = root;
  label.position = apple.position.add(new Vector3(0, 0.36, 0));
}

function renderWaterColumns(scene, root, intents, lifecycle, timelinePaused, props = []) {
  const activeColumns = intents.filter((item) => item.intentType === 'water_column' && item.active);
  if (activeColumns.length === 0) {
    scene.metadata = {
      ...(scene.metadata ?? {}),
      waterColumnSimulationClocks: {},
      waterColumnSimulationDebug: {},
    };
    window.__WHA_WATER_SIM_DEBUG__ = [];
    return;
  }

  for (const intent of activeColumns) {
    const dir = intent.sceneAxis ? toSceneAxis(intent.sceneAxis) : mapAxis(intent.axis);
    const worldThicknessRingRadius = worldThicknessRadiusForIntent(intent);
    const signScale = Math.max(0.35, intent.signSizeScale ?? 1);
    const height = Math.min(2.35, Math.max(0.9, intent.magnitude * 0.34 * signScale + 0.78));
    const radius = Math.max(0.08, (worldThicknessRingRadius * (intent.columnDiameterRatio ?? 0.8)) / 2);
    for (const plan of columnRenderPlans(intent, { x: 0, y: 0.22, z: 0 })) {
      const origin = plan.origin;
      const planRadius = Math.min(radius * plan.radiusScale, 0.145);
      const nameSuffix = plan.nameSuffix;
      if (intent.renderPreset === 'mist_cloud' || intent.renderPreset === 'ice_chunk') {
        renderNonLiquidWaterColumn(scene, root, intent, origin, dir, height, planRadius, plan, nameSuffix);
      } else {
        renderReactiveWaterColumn(scene, root, intent, origin, dir, height, planRadius, plan, nameSuffix, {
          lifecycle,
          timelinePaused,
          props,
        });
      }
    }
  }
}

function clearWaterColumnSimulations(scene) {
  const observers = scene.metadata?.waterColumnSimulationObservers ?? [];
  for (const observer of observers) {
    scene.onBeforeRenderObservable.remove(observer);
  }
  scene.metadata = {
    ...(scene.metadata ?? {}),
    waterColumnSimulationObservers: [],
    waterColumnSimulationDebug: {},
  };
}

function renderReactiveWaterColumn(scene, root, intent, origin, dir, height, radius, plan, nameSuffix, options) {
  const basis = perpendicularBasis(dir);
  const rotation = rotationFromUp(dir);
  const key = `${intent.id}${nameSuffix}`;
  const seed = hashStringToUnit(`${key}:${JSON.stringify(intent.resourceBudget ?? {})}`);
  const particleCount = clamp(Math.round(24 + radius * 26 + height * 2.8), 28, 46);
  const streamMaterial = waterColumnMaterial(scene, intent, 'body', nameSuffix);
  const innerStreamMaterial = waterColumnMaterial(scene, intent, 'innerMass', nameSuffix);
  const lobeMaterial = waterColumnMaterial(scene, intent, 'turbulence', nameSuffix);
  const foamMaterial = waterColumnMaterial(scene, intent, 'foam', nameSuffix);
  const splashMaterial = waterColumnMaterial(scene, intent, 'splash', nameSuffix);

  const streamCore = createWaterColumnSurfaceMesh(scene, `water-column:${intent.id}${nameSuffix}`, 12, 14);
  streamCore.parent = root;
  streamCore.material = streamMaterial;
  streamCore.metadata = {
    role: 'water-column-reactive-irregular-surface',
    visualPreset: 'authored_pressure_stream_contact_solver_no_pooling',
    keyframed: false,
    deterministic: true,
    primitivePolicy: 'irregular_surface_not_stretched_sphere_or_cylinder',
  };
  annotateRegionAnchor(streamCore, plan);
  applyColumnCompression(streamCore, intent);

  const innerCore = createWaterColumnSurfaceMesh(
    scene,
    `water-column-inner-mass:${intent.id}${nameSuffix}`,
    10,
    12,
  );
  innerCore.parent = root;
  innerCore.material = innerStreamMaterial;
  innerCore.metadata = {
    role: 'water-column-authored-inner-mass',
    visualPreset: 'dense_pressurized_water_mass_layer',
    keyframed: false,
    deterministic: true,
  };
  annotateRegionAnchor(innerCore, plan);
  applyColumnCompression(innerCore, intent);

  const emitterChurn = createIrregularPoolMesh(
    scene,
    `water-column-emitter:${intent.id}${nameSuffix}`,
    26,
    seed + 0.11,
  );
  emitterChurn.parent = root;
  emitterChurn.material = foamMaterial;
  emitterChurn.metadata = {
    role: 'water-column-impact-foam',
    visualPreset: 'irregular_foamy_water_impact_not_ui_disc',
  };
  annotateRegionAnchor(emitterChurn, plan);

  const surfaceStreaks = [];
  for (let index = 0; index < 10; index += 1) {
    const streak = MeshBuilder.CreateCylinder(
      `water-column-surface-streak:${intent.id}${nameSuffix}:${index}`,
      { height: 1, diameter: 1, tessellation: 7 },
      scene,
    );
    streak.parent = root;
    streak.material = index % 4 === 0 ? foamMaterial : lobeMaterial;
    streak.metadata = {
      role: 'water-column-surface-streak',
      visualPreset: 'vertical_surface_sheeting_and_foam_streak',
      streakIndex: index,
    };
    annotateRegionAnchor(streak, plan);
    applyColumnCompression(streak, intent);
    surfaceStreaks.push(streak);
  }

  const topSprayMeshes = Array.from({ length: 10 }, (_, index) => {
    const spray = MeshBuilder.CreateCylinder(
      `water-column-top-spray:${intent.id}${nameSuffix}:${index}`,
      { height: 1, diameter: 1, tessellation: 6 },
      scene,
    );
    spray.parent = root;
    spray.material = index % 3 === 0 ? foamMaterial : splashMaterial;
    spray.metadata = {
      role: 'water-column-top-breakup-spray',
      visualPreset: 'pressurized_water_column_top_breakup',
      sprayIndex: index,
    };
    annotateRegionAnchor(spray, plan);
    return spray;
  });

  const particles = waterParticleProfiles(particleCount, radius, height, seed);
  const dropletMeshes = particles.map((particle, index) => {
    const droplet = MeshBuilder.CreateSphere(
      `water-column-particle:${intent.id}${nameSuffix}:${index}`,
      { diameter: 1, segments: 8 },
      scene,
    );
    droplet.parent = root;
    droplet.material = index % 5 === 0 ? foamMaterial : splashMaterial;
    droplet.metadata = {
      role: 'water-column-simulated-particle',
      visualPreset: 'velocity_gravity_drag_collision_particle',
      particleVolumeShare: particle.volumeShare,
    };
    annotateRegionAnchor(droplet, plan);
    return droplet;
  });

  const splashMeshes = particles.slice(0, 14).map((particle, index) => {
    const splash = MeshBuilder.CreateSphere(
      `water-column-splash:${intent.id}${nameSuffix}:${index}`,
      { diameter: 1, segments: 8 },
      scene,
    );
    splash.parent = root;
    splash.material = foamMaterial;
    splash.metadata = {
      role: 'water-column-collision-splash',
      visualPreset: 'collision_impulse_splash',
      particleVolumeShare: particle.volumeShare,
    };
    annotateRegionAnchor(splash, plan);
    return splash;
  });

  const contactSprayMeshes = Array.from({ length: 10 }, (_, index) => {
    const mist = MeshBuilder.CreateSphere(
      `water-column-contact-mist:${intent.id}${nameSuffix}:${index}`,
      { diameter: 1, segments: 8 },
      scene,
    );
    mist.parent = root;
    mist.material = index % 3 === 0 ? foamMaterial : splashMaterial;
    mist.metadata = {
      role: 'water-column-local-contact-mist',
      visualPreset: 'localized_contact_spray_from_pressure_solver',
      contactMistIndex: index,
    };
    annotateRegionAnchor(mist, plan);
    return mist;
  });

  const system = {
    key,
    intent,
    nameSuffix,
    origin,
    dir,
    basis,
    height,
    radius,
    seed,
    particleCount,
    streamRings: 12,
    streamSegments: 14,
    particles,
    streamCore,
    innerCore,
    emitterChurn,
    surfaceStreaks,
    topSprayMeshes,
    dropletMeshes,
    splashMeshes,
    contactSprayMeshes,
    props: options.props ?? [],
    currentLengthScale: 0,
    topBreakupAllowed: Vector3.Dot(dir.clone().normalize(), Vector3.Up()) > 0.72,
    timelinePaused: options.timelinePaused === true,
    lifecycle: options.lifecycle ?? {},
  };

  updateReactiveWaterColumn(scene, system, 0);
  const observer = scene.onBeforeRenderObservable.add(() => {
    updateReactiveWaterColumn(scene, system, scene.getEngine().getDeltaTime());
  });
  scene.metadata = {
    ...(scene.metadata ?? {}),
    waterColumnSimulationObservers: [
      ...(scene.metadata?.waterColumnSimulationObservers ?? []),
      observer,
    ],
  };
}

function renderNonLiquidWaterColumn(scene, root, intent, origin, dir, height, radius, plan, nameSuffix) {
  const rotation = rotationFromUp(dir);
  const body = MeshBuilder.CreateCylinder(
    `water-column:${intent.id}${nameSuffix}`,
    { height, diameter: radius * 2, tessellation: 28 },
    scene,
  );
  body.parent = root;
  body.position = origin.add(dir.scale(height / 2));
  body.rotationQuaternion = rotation;
  body.material = waterColumnMaterial(scene, intent, 'body', nameSuffix);
  body.metadata = {
    role: 'water-column-non-liquid-state',
    visualPreset: intent.renderPreset === 'mist_cloud' ? 'mist_column_state' : 'ice_column_state',
  };
  annotateRegionAnchor(body, plan);
  applyColumnCompression(body, intent);

  const detailCount = intent.renderPreset === 'mist_cloud' ? 8 : 5;
  const basis = perpendicularBasis(dir);
  for (let index = 0; index < detailCount; index += 1) {
    const t = (index + 0.65) / (detailCount + 0.8);
    const offset = basis.right
      .scale(Math.sin(index * 1.7) * radius * 0.55)
      .add(basis.up.scale(Math.cos(index * 1.13) * radius * 0.35));
    const detail = MeshBuilder.CreateSphere(
      `water-column-state-detail:${intent.id}${nameSuffix}:${index}`,
      { diameter: radius * (intent.renderPreset === 'mist_cloud' ? 0.9 : 0.48), segments: 12 },
      scene,
    );
    detail.parent = root;
    detail.position = origin.add(dir.scale(height * t)).add(offset);
    detail.rotationQuaternion = rotation;
    detail.scaling.y = intent.renderPreset === 'mist_cloud' ? 0.62 : 1.18;
    detail.material = waterColumnMaterial(scene, intent, intent.renderPreset === 'mist_cloud' ? 'mist' : 'ice', nameSuffix);
    annotateRegionAnchor(detail, plan);
    applyColumnCompression(detail, intent);
  }
}

function updateReactiveWaterColumn(scene, system, deltaMs) {
  const clocks = scene.metadata?.waterColumnSimulationClocks ?? {};
  const lifecycleElapsedMs = Math.max(0, system.lifecycle?.elapsedMs ?? 0);
  const previousClockMs = clocks[system.key] ?? lifecycleElapsedMs;
  const nextClockMs = system.timelinePaused
    ? Math.max(previousClockMs, lifecycleElapsedMs)
    : Math.max(lifecycleElapsedMs, previousClockMs + Math.min(50, Math.max(0, deltaMs || 0)));
  clocks[system.key] = nextClockMs;
  scene.metadata = {
    ...(scene.metadata ?? {}),
    waterColumnSimulationClocks: clocks,
  };

  const timeSec = nextClockMs / 1000;
  const eruptionScale = easeOutCubic(clamp(timeSec / 0.5, 0, 1));
  const pressureContacts = solveWaterColumnContacts(system, system.props, eruptionScale);
  const targetLengthScale = eruptionScale * pressureContacts.streamLengthScale;
  system.currentLengthScale += (targetLengthScale - system.currentLengthScale) * 0.24;
  system.activeLengthScale = clamp(system.currentLengthScale, 0.025, 1);
  system.activeHeight = system.height * system.activeLengthScale;
  system.pressureContacts = pressureContacts;
  updateWaterColumnSurfaceMesh(system.streamCore, system, timeSec, {
    radiusScale: 1,
    turbulenceScale: 1,
  });
  updateWaterColumnSurfaceMesh(system.innerCore, system, timeSec, {
    radiusScale: 0.58,
    turbulenceScale: 0.42,
    centerPulseScale: 0.45,
  });

  updateIrregularPoolMesh(system.emitterChurn, {
    center: { x: system.origin.x, z: system.origin.z },
    radiusX: system.radius * (0.62 + eruptionScale * 0.5 + Math.sin(timeSec * 9.1) * 0.04),
    radiusZ: system.radius * (0.44 + eruptionScale * 0.34 + Math.cos(timeSec * 8.7) * 0.035),
    y: 0.066,
    angle: timeSec * 0.2,
    edgeNoise: 0.16,
  });

  for (const [index, streak] of system.surfaceStreaks.entries()) {
    const profile = lobeProfile(index, system.seed);
    const t = (profile.t + timeSec * profile.speed) % 1;
    if (t > system.activeLengthScale + 0.035) {
      streak.setEnabled(false);
      continue;
    }
    streak.setEnabled(true);
    const lateralWave = Math.sin(timeSec * profile.wobble + profile.phase);
    const surfaceRadius = waterSurfaceRadius(system, t, profile.phase, timeSec) * 1.02;
    const offset = system.basis.right
      .scale(Math.cos(profile.phase + timeSec * 0.7) * surfaceRadius)
      .add(system.basis.up.scale(Math.sin(profile.phase + timeSec * 0.7) * surfaceRadius + lateralWave * system.radius * 0.08));
    streak.position = system.origin.add(system.dir.scale(system.height * t * system.activeLengthScale)).add(offset);
    streak.rotationQuaternion = rotationFromVelocity(system.dir.scale(1.8).add(offset.scale(0.18)), system.dir);
    const width = system.radius * (0.018 + profile.size * 0.012);
    streak.scaling = new Vector3(width, system.radius * (0.2 + profile.size * 0.13), width * 0.7);
  }

  for (const [index, spray] of system.topSprayMeshes.entries()) {
    if (!system.topBreakupAllowed || system.activeLengthScale < 0.68 || pressureContacts.coreBlocked) {
      spray.setEnabled(false);
      continue;
    }
    const profile = lobeProfile(index + 37, system.seed + 0.19);
    const age = (timeSec * (0.85 + profile.speed) + profile.t) % 1;
    const angle = profile.phase + Math.sin(timeSec * 1.7 + index) * 0.2;
    const outward = system.basis.right
      .scale(Math.cos(angle))
      .add(system.basis.up.scale(Math.sin(angle)));
    const top = waterSurfaceCenter(system, 0.92, timeSec);
    const velocity = system.dir
      .scale(0.7 + profile.size * 0.25)
      .add(outward.scale(0.55 + profile.radiusFactor * 0.45))
      .add(new Vector3(0, -0.45 * age, 0));
    spray.setEnabled(age < 0.66);
    spray.position = top
      .add(outward.scale(system.radius * (0.35 + age * 1.2)))
      .add(system.dir.scale(system.radius * (0.2 + age * 0.9)))
      .add(new Vector3(0, -age * age * 0.42, 0));
    spray.rotationQuaternion = rotationFromVelocity(velocity, system.dir);
    const width = system.radius * (0.038 + profile.size * 0.018);
    spray.scaling = new Vector3(width, width * (0.78 + age * 0.35), width * 0.76);
  }

  updateWaterColumnContactSpray(system, timeSec);

  const particleStates = system.particles.map((particle) =>
    simulateWaterParticle(system, particle, (timeSec + particle.birthOffset) % particle.lifetime),
  );
  let inFlightVolume = 0;
  let splashVolume = 0;
  let fadedAfterSplashVolume = 0;

  for (const [index, state] of particleStates.entries()) {
    const mesh = system.dropletMeshes[index];
    const particle = system.particles[index];
    if (state.state === 'flight') {
      inFlightVolume += particle.volumeShare;
      mesh.setEnabled(true);
      mesh.position = state.position;
      mesh.rotationQuaternion = rotationFromVelocity(state.velocity ?? system.dir, system.dir);
      const size = system.radius * (0.052 + particle.size * 0.026);
      mesh.scaling = new Vector3(size * 0.86, size * 1.28, size * 0.82);
    } else if (state.state === 'splash') {
      splashVolume += particle.volumeShare;
      mesh.setEnabled(false);
    } else {
      mesh.setEnabled(false);
      fadedAfterSplashVolume += particle.volumeShare;
    }
  }

  for (const [index, mesh] of system.splashMeshes.entries()) {
    const state = particleStates[index];
    const particle = system.particles[index];
    if (state?.state === 'splash') {
      mesh.setEnabled(true);
      mesh.position = state.position;
      mesh.rotationQuaternion = rotationFromVelocity(state.velocity ?? Vector3.Up(), Vector3.Up());
      const size = system.radius * (0.072 + particle.size * 0.036) * (1 - state.splashProgress * 0.46);
      mesh.scaling = new Vector3(size * 1.15, size * 0.74, size * 0.92);
    } else {
      mesh.setEnabled(false);
    }
  }

  const totalVolume = system.particles.reduce((sum, particle) => sum + particle.volumeShare, 0);
  const debug = {
    intentId: system.intent.id,
    visualPreset: 'authored_pressure_stream_contact_solver_no_pooling',
    deterministic: true,
    keyframed: false,
    collisionDriven: true,
    collisionModel: 'ground_plane_first_pass',
    architecture: 'authored_visual_stream_plus_invisible_pressure_contact_solver',
    visualLayer: 'dense_water_mass_surface_turbulence_local_spray',
    physicsLayer: 'pressure_contact_solver_debug_only_no_direct_position_setting',
    eruptionDurationMs: 500,
    eruptionScale: round(eruptionScale),
    streamLengthScale: round(system.activeLengthScale),
    topBreakupPolicy: system.topBreakupAllowed
      ? 'vertical_stream_breakup_only_after_eruption'
      : 'suppressed_for_angled_streams',
    contactPolicy: 'local_contact_classification_edge_partial_core',
    volumePolicy: 'post_impact_water_splashes_then_disappears_no_pooling',
    poolingPolicy: 'disabled_by_visual_scope',
    opacityPolicy: 'dense_mostly_opaque_water',
    primitivePolicy: 'dense_surface_short_blob_splashes_no_beads_no_pool_discs',
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
    simulationTimeMs: Math.round(nextClockMs),
    particleCount: system.particleCount,
    poolCount: 0,
    volume: {
      total: round(totalVolume),
      inFlight: round(inFlightVolume),
      splash: round(splashVolume),
      fadedAfterSplash: round(fadedAfterSplashVolume),
    },
    pools: [],
  };
  const debugMap = scene.metadata?.waterColumnSimulationDebug ?? {};
  debugMap[system.key] = debug;
  scene.metadata = {
    ...(scene.metadata ?? {}),
    waterColumnSimulationDebug: debugMap,
  };
  window.__WHA_WATER_SIM_DEBUG__ = Object.values(debugMap);
}

function updateWaterColumnContactSpray(system, timeSec) {
  const contact = system.pressureContacts?.strongest;
  for (const [index, mist] of system.contactSprayMeshes.entries()) {
    if (!contact || contact.classification === 'none') {
      mist.setEnabled(false);
      continue;
    }
    const profile = lobeProfile(index + 151, system.seed + 0.41);
    const age = (timeSec * (1.4 + profile.speed) + profile.t) % 1;
    const sideAngle = profile.phase + age * 1.6;
    const side = system.basis.right
      .scale(Math.cos(sideAngle))
      .add(system.basis.up.scale(Math.sin(sideAngle)));
    const blockedBoost = contact.classification === 'core_block' ? 1.35 : 1;
    const pressure = clamp(contact.localPressure / 7, 0.28, 1.35);
    const contactNormal = contact.contactNormal ?? side;
    const sprayDirection = side
      .scale(0.45 + pressure * 0.34)
      .add(contactNormal.scale(0.24))
      .add(system.dir.scale(contact.classification === 'core_block' ? -0.16 : 0.12));
    mist.setEnabled(age < 0.74);
    mist.position = contact.contactPoint
      .add(sprayDirection.scale(system.radius * (0.35 + age * 2.1) * blockedBoost))
      .add(new Vector3(0, Math.sin(age * Math.PI) * system.radius * 0.55, 0));
    mist.rotationQuaternion = rotationFromVelocity(sprayDirection, system.dir);
    const size = system.radius * (0.09 + profile.size * 0.055) * (1 - age * 0.38) * blockedBoost;
    mist.scaling = new Vector3(size * 1.18, size * 0.82, size);
  }
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
  const coreBlock = strongest?.classification === 'core_block';
  const streamLengthScale = coreBlock
    ? clamp(strongest.axialDistance / Math.max(0.001, system.height), 0.16, 1)
    : 1;
  return {
    contacts,
    strongest,
    coreBlocked: coreBlock,
    streamLengthScale,
  };
}

function classifyWaterColumnPropContact(system, prop, activeHeight) {
  const bounds = propContactBounds(prop);
  const samples = propContactSamples(bounds);
  const pressureRadius = system.radius * 1.45 + bounds.radius * 0.15;
  let insideCount = 0;
  let coreCount = 0;
  let weightedPoint = Vector3.Zero();
  let totalWeight = 0;
  let axialTotal = 0;
  let radialFalloffTotal = 0;
  let contactNormal = Vector3.Zero();
  for (const point of samples) {
    const relative = point.subtract(system.origin);
    const axial = Vector3.Dot(relative, system.dir);
    if (axial < 0 || axial > activeHeight) continue;
    const centerlinePoint = system.origin.add(system.dir.scale(axial));
    const radial = point.subtract(centerlinePoint);
    const radialDistance = radial.length();
    if (radialDistance > pressureRadius) continue;
    const radialFalloff = 1 - clamp(radialDistance / pressureRadius, 0, 1);
    const weight = 0.2 + radialFalloff * radialFalloff;
    insideCount += 1;
    if (radialDistance <= system.radius * 0.5) coreCount += 1;
    weightedPoint = weightedPoint.add(point.scale(weight));
    totalWeight += weight;
    axialTotal += axial * weight;
    radialFalloffTotal += radialFalloff * weight;
    if (radialDistance > 0.0001) contactNormal = contactNormal.add(radial.normalize().scale(weight));
  }
  if (insideCount === 0 || totalWeight <= 0) {
    return { propId: prop.id, classification: 'none' };
  }
  const coverage = insideCount / samples.length;
  const contactPoint = weightedPoint.scale(1 / totalWeight);
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
      contactNormal.lengthSquared() > 0.0001
        ? contactNormal.normalize()
        : system.dir.scale(-1),
    localPressure: pressure / Math.sqrt(mass),
  };
}

function propContactBounds(prop) {
  const visualSize = Math.max(0.3, prop.size ?? 1) * 0.45;
  const half = visualSize / 2;
  if (prop.visualKind === 'tree_apple') {
    const diameter = Math.max(0.12, (prop.size ?? 0.42) * 0.5);
    const center = toVector(prop.position, 0.22);
    return { center, half: new Vector3(diameter / 2, diameter / 2, diameter / 2), radius: diameter / 2 };
  }
  const center = toVector(prop.position, prop.visualKind === 'activation_ring_key' ? 0.12 : 0.25);
  return { center, half: new Vector3(half, half, half), radius: Math.sqrt(3) * half };
}

function propContactSamples(bounds) {
  const { center, half } = bounds;
  const samples = [center];
  samples.push(
    center.add(new Vector3(half.x, 0, 0)),
    center.add(new Vector3(-half.x, 0, 0)),
    center.add(new Vector3(0, half.y, 0)),
    center.add(new Vector3(0, -half.y, 0)),
    center.add(new Vector3(0, 0, half.z)),
    center.add(new Vector3(0, 0, -half.z)),
  );
  for (const x of [-half.x, half.x]) {
    for (const y of [-half.y, half.y]) {
      for (const z of [-half.z, half.z]) {
        samples.push(center.add(new Vector3(x, y, z)));
      }
    }
  }
  return samples;
}

function createWaterColumnSurfaceMesh(scene, name, ringCount, segmentCount) {
  const mesh = new Mesh(name, scene);
  const positions = new Array(ringCount * segmentCount * 3).fill(0);
  const uvs = [];
  for (let ring = 0; ring < ringCount; ring += 1) {
    for (let segment = 0; segment < segmentCount; segment += 1) {
      uvs.push(segment / segmentCount, ring / Math.max(1, ringCount - 1));
    }
  }
  const indices = [];
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
  const normals = new Array(positions.length).fill(0);
  VertexData.ComputeNormals(positions, indices, normals);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.uvs = uvs;
  vertexData.applyToMesh(mesh, true);
  mesh.metadata = {
    ...(mesh.metadata ?? {}),
    ringCount,
    segmentCount,
  };
  return mesh;
}

function updateWaterColumnSurfaceMesh(mesh, system, timeSec, options = {}) {
  const ringCount = mesh.metadata?.ringCount ?? system.streamRings;
  const segmentCount = mesh.metadata?.segmentCount ?? system.streamSegments;
  const radiusScale = options.radiusScale ?? 1;
  const turbulenceScale = options.turbulenceScale ?? 1;
  const centerPulseScale = options.centerPulseScale ?? 1;
  const positions = [];
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
      const position = center
        .add(system.basis.right.scale(x))
        .add(system.basis.up.scale(z));
      positions.push(position.x, position.y, position.z);
    }
  }
  const indices = mesh.getIndices();
  mesh.setVerticesData(VertexBuffer.PositionKind, positions, true);
  const normals = [];
  VertexData.ComputeNormals(positions, indices, normals);
  mesh.setVerticesData(VertexBuffer.NormalKind, normals, true);
}

function waterSurfaceCenter(system, t, timeSec, pulseScale = 1) {
  const activeHeight = system.activeHeight ?? system.height;
  const sway = Math.sin(t * Math.PI * 1.4 + timeSec * 2.1 + system.seed * 4) * system.radius * 0.055 * pulseScale;
  const pulse = Math.sin(t * Math.PI * 4.6 - timeSec * 6.8) * system.radius * 0.022 * pulseScale;
  return system.origin
    .add(system.dir.scale(activeHeight * t))
    .add(system.basis.right.scale(sway))
    .add(system.basis.up.scale(pulse));
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

function createIrregularPoolMesh(scene, name, pointCount, seed) {
  const mesh = new Mesh(name, scene);
  const positions = new Array((pointCount + 1) * 3).fill(0);
  const indices = [];
  for (let index = 1; index <= pointCount; index += 1) {
    const next = index === pointCount ? 1 : index + 1;
    indices.push(0, index, next);
  }
  const normals = new Array(positions.length).fill(0);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.applyToMesh(mesh, true);
  const random = seededProfileRandom(seed, pointCount + 17);
  mesh.metadata = {
    ...(mesh.metadata ?? {}),
    pointCount,
    outlineNoise: Array.from({ length: pointCount }, () => 0.72 + random() * 0.56),
  };
  return mesh;
}

function updateIrregularPoolMesh(mesh, pool) {
  const pointCount = mesh.metadata?.pointCount ?? 24;
  const noise = mesh.metadata?.outlineNoise ?? [];
  const positions = [pool.center.x, pool.y, pool.center.z];
  const angleOffset = pool.angle ?? 0;
  for (let index = 0; index < pointCount; index += 1) {
    const angle = (index / pointCount) * Math.PI * 2;
    const edge = 1 + ((noise[index] ?? 1) - 1) * (pool.edgeNoise ?? 0.18);
    const localX = Math.cos(angle) * pool.radiusX * edge;
    const localZ = Math.sin(angle) * pool.radiusZ * edge;
    const rotatedX = localX * Math.cos(angleOffset) - localZ * Math.sin(angleOffset);
    const rotatedZ = localX * Math.sin(angleOffset) + localZ * Math.cos(angleOffset);
    positions.push(pool.center.x + rotatedX, pool.y, pool.center.z + rotatedZ);
  }
  mesh.setVerticesData(VertexBuffer.PositionKind, positions, true);
  if (mesh.metadata?.normalsInitialized !== true) {
    const normals = new Array(positions.length).fill(0);
    for (let index = 0; index < normals.length; index += 3) {
      normals[index + 1] = 1;
    }
    mesh.setVerticesData(VertexBuffer.NormalKind, normals, true);
    mesh.metadata.normalsInitialized = true;
  }
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
  const gravity = new Vector3(0, -9.8, 0);
  let position = system.origin
    .add(system.basis.right.scale(particle.radialX))
    .add(system.basis.up.scale(particle.radialZ));
  let velocity = system.dir
    .scale(particle.upwardSpeed)
    .add(system.basis.right.scale(particle.sideX))
    .add(system.basis.up.scale(particle.sideZ));
  const groundY = 0.052;
  let elapsed = 0;
  while (elapsed < ageSec) {
    const dt = Math.min(1 / 36, ageSec - elapsed);
    velocity = velocity.add(gravity.scale(dt));
    velocity = velocity.scale(Math.pow(particle.drag, dt));
    const next = position.add(velocity.scale(dt));
    if (next.y <= groundY && velocity.y < 0) {
      const hitT = clamp((position.y - groundY) / Math.max(0.0001, position.y - next.y), 0, 1);
      const impactPosition = Vector3.Lerp(position, next, hitT);
      const impactVelocity = velocity.clone();
      const afterImpact = ageSec - elapsed - dt * hitT;
      if (afterImpact < 0.42) {
        const splashVelocity = new Vector3(
          impactVelocity.x * 0.34 + particle.sideX * 0.18,
          Math.abs(impactVelocity.y) * 0.28 + 0.45,
          impactVelocity.z * 0.34 + particle.sideZ * 0.18,
        );
      const splashPosition = impactPosition
        .add(splashVelocity.scale(afterImpact))
        .add(gravity.scale(0.5 * afterImpact * afterImpact));
      splashPosition.y = Math.max(groundY + 0.018, splashPosition.y);
      return {
          state: 'splash',
          position: splashPosition,
          velocity: splashVelocity,
          impactPosition,
          splashProgress: afterImpact / 0.42,
        };
      }
      return {
        state: 'spent',
        impactPosition,
      };
    }
    position = next;
    elapsed += dt;
  }
  return { state: 'flight', position, velocity };
}

function rotationFromVelocity(velocity, fallback) {
  const direction = velocity?.lengthSquared?.() > 0.000001 ? velocity.clone().normalize() : fallback;
  return rotationFromUp(direction ?? Vector3.Up());
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

function waterColumnHasFlowCues(intent) {
  return !['ice_chunk', 'mist_cloud'].includes(intent.renderPreset);
}

function waterColumnMaterial(scene, intent, role, nameSuffix = '') {
  const materialName = `water-column-${role}:${intent.id}${nameSuffix}`;
  if (intent.renderPreset === 'ice_chunk') {
    return material(scene, materialName, new Color3(0.64, 0.86, 0.94), role === 'highlight' ? 0.42 : 0.76);
  }
  if (intent.renderPreset === 'mist_cloud') {
    return material(scene, materialName, new Color3(0.68, 0.78, 0.82), role === 'highlight' ? 0.18 : 0.3);
  }
  if (role === 'body') {
    const mat = material(scene, materialName, new Color3(0.03, 0.48, 0.68), 0.9);
    mat.diffuseTexture = waterFlowTexture(scene, `${materialName}:flow-texture`);
    mat.specularColor = new Color3(0.58, 0.84, 0.96);
    mat.emissiveColor = new Color3(0.01, 0.08, 0.1);
    mat.backFaceCulling = false;
    return mat;
  }
  if (role === 'innerMass') {
    const mat = material(scene, materialName, new Color3(0.1, 0.68, 0.86), 0.58);
    mat.diffuseTexture = waterFlowTexture(scene, `${materialName}:inner-flow-texture`);
    mat.specularColor = new Color3(0.76, 0.94, 1);
    mat.emissiveColor = new Color3(0.03, 0.14, 0.16);
    mat.backFaceCulling = false;
    return mat;
  }
  if (role === 'turbulence') {
    const mat = material(scene, materialName, new Color3(0.12, 0.62, 0.84), 0.78);
    mat.specularColor = new Color3(0.58, 0.86, 0.96);
    return mat;
  }
  if (role === 'foam') {
    const mat = material(scene, materialName, new Color3(0.58, 0.86, 0.94), 0.42);
    mat.emissiveColor = new Color3(0.08, 0.16, 0.18);
    return mat;
  }
  if (role === 'splash') {
    return material(scene, materialName, new Color3(0.34, 0.78, 0.96), 0.86);
  }
  if (role === 'pool') {
    const mat = material(scene, materialName, new Color3(0.02, 0.44, 0.68), 0.86);
    mat.specularColor = new Color3(0.5, 0.82, 0.96);
    return mat;
  }
  if (role === 'poolSheen') {
    const mat = material(scene, materialName, new Color3(0.42, 0.75, 0.86), 0.18);
    mat.specularColor = new Color3(0.7, 0.9, 1);
    return mat;
  }
  if (role === 'highlight') {
    return material(scene, materialName, new Color3(0.78, 0.93, 1), 0.34);
  }
  if (role === 'flow') {
    return material(scene, materialName, new Color3(0.72, 0.92, 1), 0.46);
  }
  if (role === 'droplet') {
    return material(scene, materialName, new Color3(0.7, 0.9, 1), 0.62);
  }
  if (role === 'origin') {
    return material(scene, materialName, new Color3(0.56, 0.86, 0.98), 0.64);
  }
  return material(scene, materialName, new Color3(0.16, 0.55, 0.78), 0.58);
}

function waterFlowTexture(scene, name) {
  const texture = new DynamicTexture(name, { width: 128, height: 512 }, scene, true);
  const context = texture.getContext();
  const gradient = context.createLinearGradient(0, 0, 128, 0);
  gradient.addColorStop(0, '#043755');
  gradient.addColorStop(0.22, '#075f91');
  gradient.addColorStop(0.45, '#0b88ba');
  gradient.addColorStop(0.62, '#064e79');
  gradient.addColorStop(1, '#032f4a');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 512);

  for (let index = 0; index < 34; index += 1) {
    const x = (index * 37) % 128;
    const y = (index * 89) % 512;
    const width = 1 + (index % 3);
    const height = 48 + ((index * 17) % 96);
    const alpha = 0.16 + (index % 5) * 0.035;
    context.fillStyle = `rgba(147, 222, 245, ${alpha})`;
    context.fillRect(x, y, width, height);
  }

  for (let index = 0; index < 58; index += 1) {
    const x = (index * 53) % 128;
    const y = (index * 71) % 512;
    const radius = 1 + (index % 4) * 0.55;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = `rgba(185, 238, 248, ${0.12 + (index % 3) * 0.04})`;
    context.fill();
  }

  texture.update();
  texture.vScale = 2.1;
  texture.uScale = 1.15;
  return texture;
}

function columnRenderPlans(intent, fallbackOrigin) {
  const anchors = intent.emergence?.anchors ?? [];
  if (anchors.length === 0) {
    return [
      {
        origin: toVector(intent.origin ?? fallbackOrigin),
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
      origin: toVector(anchor.scenePosition ?? intent.origin ?? fallbackOrigin),
      nameSuffix: anchors.length === 1 ? '' : `:${safeMeshId(anchor.anchorId ?? `anchor-${index}`)}`,
      anchor,
      budgetShare,
      radiusScale: Math.max(0.35, Math.sqrt(budgetShare || 1 / anchors.length)),
    };
  });
}

function annotateRegionAnchor(mesh, plan) {
  if (!plan.anchor) return;
  mesh.metadata = {
    ...(mesh.metadata ?? {}),
    regionAnchorId: plan.anchor.anchorId,
    regionBudgetShare: plan.budgetShare,
  };
}

function applyColumnCompression(mesh, intent) {
  const visual = intent.compressionVisual;
  if (!visual) return;
  const scaleX = visual.crossSectionScaleX ?? 1;
  const scaleZ = visual.crossSectionScaleZ ?? scaleX;
  mesh.scaling.x *= scaleX;
  mesh.scaling.z *= scaleZ;
  mesh.metadata = {
    ...(mesh.metadata ?? {}),
    compressedByConvergence: true,
    convergenceMode: intent.convergenceMode,
    compressionVisual: visual,
  };
}

function renderMaterialColumns(scene, root, intents) {
  for (const intent of intents.filter((item) => item.intentType === 'material_column' && item.active)) {
    const dir = intent.sceneAxis ? toSceneAxis(intent.sceneAxis) : new Vector3(0, 1, 0);
    const worldThicknessRingRadius = worldThicknessRadiusForIntent(intent);
    const signScale = Math.max(0.35, intent.signSizeScale ?? 1);
    const height = Math.max(0.9, intent.magnitude * 0.58 * signScale + 1.0);
    const radius = Math.max(0.08, (worldThicknessRingRadius * (intent.columnDiameterRatio ?? 0.8)) / 2);

    for (const plan of columnRenderPlans(intent, { x: 0, y: 0.22, z: 0 })) {
      const origin = plan.origin;
      const planRadius = radius * plan.radiusScale;
      if (intent.materialKind === 'earth') {
        renderEarthColumn(scene, root, intent, origin, dir, height, planRadius, plan);
      } else if (intent.materialKind === 'wind') {
        renderWindColumn(scene, root, intent, origin, dir, height, planRadius, plan);
      } else if (intent.materialKind === 'light') {
        renderLightColumn(scene, root, intent, origin, dir, height, planRadius, plan);
      }
    }
  }
}

function renderDispersions(scene, root, intents) {
  const outputs = intents.filter(
    (item) =>
      ['water_dispersion', 'material_dispersion'].includes(item.intentType) && item.active,
  );
  for (const intent of outputs) {
    const dir = intent.sceneAxis ? toSceneAxis(intent.sceneAxis) : mapAxis(intent.axis);
    const worldThicknessRingRadius = worldThicknessRadiusForIntent(intent);
    const signScale = Math.max(0.35, intent.signSizeScale ?? 1);
    const reach = Math.max(0.9, intent.magnitude * 0.42 * signScale + 0.9);
    const baseRadius = Math.max(0.08, (worldThicknessRingRadius * (intent.columnDiameterRatio ?? 0.8)) / 2);
    const spread = clamp(intent.spread ?? 0.55, 0.08, 1.2);
    const mat = dispersionMaterial(scene, intent);
    const basis = perpendicularBasis(dir);

    for (const plan of columnRenderPlans(intent, { x: 0, y: 0.22, z: 0 })) {
      const origin = plan.origin;
      const nameSuffix = plan.nameSuffix;
      const planRadius = baseRadius * plan.radiusScale;
      const lobeCount = intent.materialKind === 'wind' ? 6 : 5;
      for (let index = 0; index < lobeCount; index += 1) {
        const centered = index - (lobeCount - 1) / 2;
        const sideOffset = basis.right.scale(centered * spread * planRadius * 0.74);
        const upOffset = basis.up.scale(Math.abs(centered) * spread * planRadius * 0.18);
        const lobeDir = dir
          .add(basis.right.scale(centered * spread * 0.2))
          .add(basis.up.scale(Math.abs(centered) * spread * 0.05))
          .normalize();
        const lobe = MeshBuilder.CreateCylinder(
          `dispersion-output:${intent.id}${nameSuffix}:${index}`,
          {
            height: reach * (0.78 + index * 0.035),
            diameterTop: Math.max(0.03, planRadius * 0.28),
            diameterBottom: Math.max(0.08, planRadius * (0.82 + spread * 0.28)),
            tessellation: 18,
          },
          scene,
        );
        lobe.parent = root;
        lobe.position = origin.add(sideOffset).add(upOffset).add(lobeDir.scale(reach * 0.42));
        lobe.rotationQuaternion = rotationFromUp(lobeDir);
        lobe.material = mat;
        annotateRegionAnchor(lobe, plan);
      }

      const emitter = MeshBuilder.CreateSphere(
        `dispersion-origin:${intent.id}${nameSuffix}`,
        { diameter: Math.max(0.14, planRadius * 1.15), segments: 16 },
        scene,
      );
      emitter.parent = root;
      emitter.position = origin;
      emitter.material = mat;
      annotateRegionAnchor(emitter, plan);

      if (intent.materialKind === 'water' || intent.materialKind === 'earth') {
        for (let index = 0; index < 7; index += 1) {
          const angle = (Math.PI * 2 * index) / 7;
          const scatter = basis.right
            .scale(Math.cos(angle) * planRadius * (0.7 + spread * 0.8))
            .add(basis.up.scale(Math.sin(angle) * planRadius * 0.26));
          const droplet = MeshBuilder.CreateSphere(
            `${intent.materialKind}-dispersion-particle:${intent.id}${nameSuffix}:${index}`,
            { diameter: Math.max(0.035, planRadius * 0.16), segments: 10 },
            scene,
          );
          droplet.parent = root;
          droplet.position = origin.add(dir.scale(reach * (0.28 + index * 0.045))).add(scatter);
          droplet.material = mat;
          annotateRegionAnchor(droplet, plan);
        }
      }

      if (intent.materialKind === 'fire' || intent.materialKind === 'light') {
        createSpellPointLight(
          scene,
          root,
          `spell-light:dispersion:${intent.id}${nameSuffix}`,
          origin.add(dir.scale(reach * 0.58)),
          planRadius,
          intent.materialKind === 'light' ? 0.82 : 0.62,
        );
      }
    }
  }
}

function renderLevitationForces(scene, root, intents, circle) {
  const frame = circle?.placementFrame ?? {};
  const normal = toSceneAxis(frame.normal ?? { x: 0, y: 1, z: 0 });
  const forces = intents.filter(
    (intent) =>
      intent.intentType === 'force_constraint_debug' &&
      intent.registryId === 'sign.levitation' &&
      intent.active &&
      intent.visual === true,
  );
  const debug = [];

  for (const force of forces) {
    const visual = force.metadata?.visual ?? {};
    const origin = force.regionOrigin?.primaryScenePosition
      ? toVector(force.regionOrigin.primaryScenePosition)
      : toVector(frame.origin ?? { x: 0, y: 0, z: 0 }).add(normal.scale(0.18));
    const liftHeight = clamp((visual.verticalLift ?? 180) / 180, 0.65, 1.8);
    const center = origin.add(normal.scale(0.38 + liftHeight * 0.24));
    const radius = clamp(Math.sqrt(force.resourceBudget?.amount ?? 1) / 30, 0.34, 0.82);
    const mat = levitationMaterial(scene, force);
    const direction = levitationDirection(frame, visual.translationVector, normal);

    const ring = MeshBuilder.CreateTorus(
      `levitation-field:${force.id}`,
      { diameter: radius * 2, thickness: Math.max(0.018, radius * 0.06), tessellation: 48 },
      scene,
    );
    ring.parent = root;
    ring.position = center;
    ring.rotationQuaternion = rotationFromUp(normal);
    ring.material = mat;
    ring.metadata = levitationMetadata(force, visual, direction);

    const core = MeshBuilder.CreateSphere(
      `levitation-core:${force.id}`,
      { diameter: radius * 0.48, segments: 18 },
      scene,
    );
    core.parent = root;
    core.position = center.add(normal.scale(radius * 0.22));
    core.material = mat;
    core.metadata = levitationMetadata(force, visual, direction);

    if (visual.continuousStream || visual.oneShotLaunch) {
      renderLevitationDirection(scene, root, force, visual, center, direction, radius, mat);
    } else {
      renderLevitationHover(scene, root, force, center, normal, radius, mat);
    }

    debug.push({
      id: force.id,
      visualPreset: force.visualPreset,
      visualShape: force.visualShape,
      materialKind: force.materialKind,
      motionMode: force.metadata?.motionMode ?? null,
      renderPolicy: visual.renderPolicy ?? null,
      origin: vectorDebug(origin),
      center: vectorDebug(center),
      direction: vectorDebug(direction),
      forceDeferredToPhysics: true,
      resourceBudget: force.resourceBudget ?? null,
    });
  }

  return debug;
}

function renderLevitationHover(scene, root, force, center, normal, radius, mat) {
  for (let index = 0; index < 3; index += 1) {
    const ring = MeshBuilder.CreateTorus(
      `levitation-hover-ring:${force.id}:${index}`,
      {
        diameter: radius * (1.05 + index * 0.28),
        thickness: Math.max(0.012, radius * 0.035),
        tessellation: 36,
      },
      scene,
    );
    ring.parent = root;
    ring.position = center.add(normal.scale((index - 1) * radius * 0.16));
    ring.rotationQuaternion = rotationFromUp(normal);
    ring.material = mat;
    ring.metadata = { role: 'levitation-hover-ring', visualPreset: force.visualPreset };
  }
}

function renderLevitationDirection(scene, root, force, visual, center, direction, radius, mat) {
  const length = visual.continuousStream ? radius * 2.8 : radius * 2.1;
  const basis = perpendicularBasis(direction);
  for (let index = 0; index < 4; index += 1) {
    const side = index - 1.5;
    const start = center
      .add(basis.right.scale(side * radius * 0.22))
      .add(basis.up.scale((index % 2) * radius * 0.12));
    const end = start.add(direction.scale(length * (0.74 + index * 0.07)));
    renderDebugConnector(
      scene,
      root,
      `levitation-stream:${force.id}:${index}`,
      start,
      end,
      levitationColor(force),
      visual.continuousStream ? 0.36 : 0.48,
      Math.max(0.012, radius * 0.045),
    );
  }
  const arrow = MeshBuilder.CreateCylinder(
    `levitation-vector:${force.id}`,
    {
      height: Math.max(0.16, radius * 0.34),
      diameterTop: 0,
      diameterBottom: Math.max(0.08, radius * 0.22),
      tessellation: 16,
    },
    scene,
  );
  arrow.parent = root;
  arrow.position = center.add(direction.scale(length));
  arrow.rotationQuaternion = rotationFromUp(direction);
  arrow.material = mat;
  arrow.metadata = levitationMetadata(force, visual, direction);
}

function levitationDirection(frame, translationVector, normal) {
  const tangent = toSceneAxis(frame.tangent ?? { x: 1, y: 0, z: 0 });
  const bitangent = toSceneAxis(frame.bitangent ?? { x: 0, y: 0, z: 1 });
  const local = translationVector ?? { x: 0, y: 0 };
  const direction = tangent
    .scale(local.x ?? 0)
    .add(bitangent.scale(local.y ?? 0))
    .add(normal.scale(0.45));
  if (direction.lengthSquared() <= 0.000001) return normal;
  return direction.normalize();
}

function levitationColor(force) {
  if (force.materialKind === 'wind') return new Color3(0.72, 0.9, 0.86);
  if (force.materialKind === 'fire') return new Color3(0.96, 0.48, 0.18);
  if (force.materialKind === 'light') return new Color3(1, 0.86, 0.36);
  return new Color3(0.78, 0.82, 0.72);
}

function levitationMaterial(scene, force) {
  if (force.materialKind === 'fire' || force.materialKind === 'light') {
    return emissiveMaterial(scene, `levitation-material:${force.id}`, levitationColor(force));
  }
  return material(scene, `levitation-material:${force.id}`, levitationColor(force), 0.42);
}

function levitationMetadata(force, visual, direction) {
  return {
    role: 'levitation-force-field',
    visualPreset: force.visualPreset,
    visualShape: force.visualShape,
    motionMode: force.metadata?.motionMode ?? null,
    renderPolicy: visual.renderPolicy ?? null,
    forceDeferredToPhysics: true,
    direction: vectorDebug(direction),
  };
}

function renderEarthColumn(scene, root, intent, origin, dir, height, radius, plan) {
  const nameSuffix = plan?.nameSuffix ?? '';
  const pillar = MeshBuilder.CreateCylinder(
    `earth-column:${intent.id}${nameSuffix}`,
    { height, diameterTop: radius * 1.68, diameterBottom: radius * 2.05, tessellation: 18 },
    scene,
  );
  pillar.parent = root;
  pillar.position = origin.add(dir.scale(height / 2));
  pillar.rotationQuaternion = rotationFromUp(dir);
  pillar.material = material(scene, `earth-column:${intent.id}${nameSuffix}`, new Color3(0.42, 0.33, 0.22), 1);
  annotateRegionAnchor(pillar, plan ?? {});
  applyColumnCompression(pillar, intent);

  const cap = MeshBuilder.CreatePolyhedron(
    `earth-column-cap:${intent.id}${nameSuffix}`,
    { type: 2, size: radius * 1.55 },
    scene,
  );
  cap.parent = root;
  cap.position = origin.add(dir.scale(height + radius * 0.25));
  cap.material = material(scene, `earth-column-cap:${intent.id}${nameSuffix}`, new Color3(0.5, 0.41, 0.29), 1);
  annotateRegionAnchor(cap, plan ?? {});
  applyColumnCompression(cap, intent);

  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2;
    const chip = MeshBuilder.CreatePolyhedron(
      `earth-column-debris:${intent.id}${nameSuffix}:${i}`,
      { type: 1, size: radius * 0.34 },
      scene,
    );
    chip.parent = root;
    chip.position = origin.add(new Vector3(Math.cos(angle) * radius * 1.5, 0.03, Math.sin(angle) * radius * 1.5));
    chip.material = cap.material;
  }
}

function renderWindColumn(scene, root, intent, origin, dir, height, radius, plan) {
  const nameSuffix = plan?.nameSuffix ?? '';
  const windMaterial = material(scene, `wind-column:${intent.id}${nameSuffix}`, new Color3(0.75, 0.88, 0.9), 0.24);
  for (let i = 0; i < 5; i += 1) {
    const streak = MeshBuilder.CreateCylinder(
      `wind-column-streak:${intent.id}${nameSuffix}:${i}`,
      { height: height * (0.68 + i * 0.05), diameter: Math.max(0.018, radius * 0.12), tessellation: 8 },
      scene,
    );
    streak.parent = root;
    const angle = (i / 5) * Math.PI * 2;
    streak.position = origin
      .add(dir.scale(height * 0.45))
      .add(new Vector3(Math.cos(angle) * radius * 0.85, 0, Math.sin(angle) * radius * 0.85));
    streak.rotationQuaternion = rotationFromUp(dir);
    streak.material = windMaterial;
    annotateRegionAnchor(streak, plan ?? {});
    applyColumnCompression(streak, intent);
  }
}

function renderLightColumn(scene, root, intent, origin, dir, height, radius, plan) {
  const nameSuffix = plan?.nameSuffix ?? '';
  const surfaceGlow = MeshBuilder.CreateCylinder(
    `light-column-surface-glow:${intent.id}${nameSuffix}`,
    { diameter: Math.max(0.72, radius * 3.4), height: 0.012, tessellation: 56 },
    scene,
  );
  surfaceGlow.parent = root;
  surfaceGlow.position = origin.add(dir.scale(0.025));
  surfaceGlow.rotationQuaternion = rotationFromUp(dir);
  surfaceGlow.material = lightSurfaceGlowMaterial(scene, intent, nameSuffix);
  surfaceGlow.metadata = {
    role: 'light-column-surface-illumination',
    visualPreset: 'light_beam_surface_pool',
    illuminatesNearbySurface: true,
  };
  annotateRegionAnchor(surfaceGlow, plan ?? {});
  applyColumnCompression(surfaceGlow, intent);

  const beam = MeshBuilder.CreateCylinder(
    `light-column:${intent.id}${nameSuffix}`,
    { height, diameter: radius * 1.55, tessellation: 32 },
    scene,
  );
  beam.parent = root;
  beam.position = origin.add(dir.scale(height / 2));
  beam.rotationQuaternion = rotationFromUp(dir);
  beam.material = emissiveMaterial(scene, `light-column:${intent.id}${nameSuffix}`, new Color3(1, 0.88, 0.34));
  annotateRegionAnchor(beam, plan ?? {});
  applyColumnCompression(beam, intent);

  const glow = MeshBuilder.CreateSphere(
    `light-column-glow:${intent.id}${nameSuffix}`,
    { diameter: radius * 2.3, segments: 20 },
    scene,
  );
  glow.parent = root;
  glow.position = origin.add(dir.scale(height));
  glow.material = material(scene, `light-column-glow:${intent.id}${nameSuffix}`, new Color3(1, 0.9, 0.45), 0.35);
  annotateRegionAnchor(glow, plan ?? {});
  applyColumnCompression(glow, intent);

  createSpellPointLight(
    scene,
    root,
    `spell-light:column:${intent.id}${nameSuffix}`,
    origin.add(dir.scale(height * 0.68)),
    radius,
    1.05,
  );
}

function lightSurfaceGlowMaterial(scene, intent, nameSuffix) {
  const mat = material(
    scene,
    `light-column-surface-glow:${intent.id}${nameSuffix}`,
    new Color3(1, 0.88, 0.34),
    0.28,
  );
  mat.emissiveColor = new Color3(1, 0.78, 0.22).scale(0.62);
  return mat;
}

function renderLifecycleCleanup(scene, root, intents, sceneLeftovers = []) {
  const persistedSourceIds = new Set(
    sceneLeftovers.map((leftover) => leftover.sourceCleanupId).filter(Boolean),
  );
  const currentCleanups = intents
    .filter((item) => item.intentType === 'lifecycle_cleanup' && item.active)
    .filter((cleanup) => !persistedSourceIds.has(cleanup.id));
  for (const cleanup of [...sceneLeftovers, ...currentCleanups]) {
    const origin = toVector(cleanup.origin ?? { x: 0, y: 0.03, z: 0 });
    if (cleanup.leftover?.renderPreset === 'pooled_water_leftover') {
      const puddle = MeshBuilder.CreateCylinder(
        `leftover-water-pool:${cleanup.id}`,
        { diameter: 0.82, height: 0.024, tessellation: 40 },
        scene,
      );
      puddle.parent = root;
      puddle.position = new Vector3(origin.x, 0.045, origin.z);
      puddle.material = material(scene, `leftover-water:${cleanup.id}`, new Color3(0.12, 0.45, 0.66), 0.48);

      const falling = MeshBuilder.CreateSphere(
        `leftover-water-fall:${cleanup.id}`,
        { diameter: 0.18, segments: 16 },
        scene,
      );
      falling.parent = root;
      falling.position = new Vector3(origin.x, Math.max(0.34, origin.y + 0.16), origin.z);
      falling.material = puddle.material;

      const rippleMaterial = material(
        scene,
        `leftover-water-ripple-material:${cleanup.id}`,
        new Color3(0.62, 0.86, 0.96),
        0.34,
      );
      for (let i = 0; i < 3; i += 1) {
        const ripple = MeshBuilder.CreateTorus(
          `leftover-water-ripple:${cleanup.id}:${i}`,
          { diameter: 0.42 + i * 0.18, thickness: 0.01, tessellation: 48 },
          scene,
        );
        ripple.parent = root;
        ripple.position = new Vector3(origin.x, 0.064 + i * 0.002, origin.z);
        ripple.material = rippleMaterial;
        ripple.metadata = {
          role: 'leftover-water-ripple',
          visualPreset: 'wet_pool_with_falling_blob_and_ripples',
        };
      }
    } else if (cleanup.leftover?.renderPreset === 'earth_debris_leftover') {
      const debrisMaterial = material(scene, `leftover-earth:${cleanup.id}`, new Color3(0.45, 0.35, 0.22), 1);
      const dustMaterial = material(scene, `leftover-earth-dust:${cleanup.id}`, new Color3(0.56, 0.47, 0.34), 0.34);
      for (let i = 0; i < 7; i += 1) {
        const angle = (i / 7) * Math.PI * 2;
        const debris = MeshBuilder.CreatePolyhedron(
          `leftover-earth-debris:${cleanup.id}:${i}`,
          { type: 1, size: 0.12 + (i % 3) * 0.025 },
          scene,
        );
        debris.parent = root;
        debris.position = new Vector3(origin.x + Math.cos(angle) * 0.42, 0.08, origin.z + Math.sin(angle) * 0.42);
        debris.material = debrisMaterial;
      }
      for (let i = 0; i < 5; i += 1) {
        const angle = (i / 5) * Math.PI * 2 + 0.28;
        const dust = MeshBuilder.CreateSphere(
          `leftover-earth-dust:${cleanup.id}:${i}`,
          { diameter: 0.18 + i * 0.018, segments: 10 },
          scene,
        );
        dust.parent = root;
        dust.position = new Vector3(
          origin.x + Math.cos(angle) * (0.18 + i * 0.055),
          0.16 + i * 0.035,
          origin.z + Math.sin(angle) * (0.18 + i * 0.055),
        );
        dust.material = dustMaterial;
        dust.metadata = {
          role: 'leftover-earth-dust',
          visualPreset: 'crumbled_debris_with_dust_puffs',
        };
      }
    }
  }
}

function worldThicknessRadiusForIntent(intent) {
  const displayMaxRadius = Math.max(120, intent.displayMaxRadius ?? intent.thicknessRingRadius ?? 120);
  const rawRingRadius = Math.max(1, intent.thicknessRingRadius ?? displayMaxRadius);
  const displayScale = 2.25 / displayMaxRadius;
  return Math.max(0.08, rawRingRadius * displayScale);
}

function renderThermalStates(scene, root, intents, sources) {
  const thermal = intents.find(
    (intent) => intent.intentType === 'thermal_material_state' && intent.active,
  );
  if (!thermal) return;
  const source = sources.find((item) => item.id === thermal.sourceId && item.kind === 'water');
  if (!source) return;
  const fillRatio = source.nonDepleting
    ? 1
    : clamp(source.amount / Math.max(1, source.capacity), 0, 1);
  const meter = MeshBuilder.CreateBox(
    `thermal-meter:${thermal.id}`,
    { width: 0.14, height: Math.max(0.12, fillRatio * 0.9), depth: 0.14 },
    scene,
  );
  meter.parent = root;
  meter.position = toVector(source.position, 0.75 + fillRatio * 0.45);
  meter.material = emissiveMaterial(
    scene,
    `thermal:${thermal.id}`,
    thermal.direction === 'cool' ? new Color3(0.26, 0.66, 0.9) : new Color3(0.95, 0.38, 0.18),
  );

  const stateMarker = MeshBuilder.CreateCylinder(
    `thermal-state:${thermal.id}`,
    { diameter: 0.62, height: 0.018, tessellation: 40 },
    scene,
  );
  stateMarker.parent = root;
  stateMarker.position = toVector(source.position, 0.58);
  stateMarker.material = material(
    scene,
    `thermal-state:${thermal.id}`,
    thermal.direction === 'cool' ? new Color3(0.23, 0.65, 0.82) : new Color3(0.92, 0.42, 0.18),
    0.42,
  );

  const label = makeLabel(scene, `thermal-label:${thermal.id}`, `${thermal.phase} · ${thermal.thermalEffect}`, 1, 0.22);
  label.parent = root;
  label.position = toVector(source.position, 1.42);
}

function renderRegionAnchors(scene, root, intents) {
  const anchors = intents
    .filter((intent) => intent.intentType === 'region_emergence' && intent.active)
    .flatMap((intent) => intent.anchors ?? []);
  if (anchors.length === 0) return;
  const anchorMaterial = emissiveMaterial(scene, 'region-anchor-material', new Color3(0.35, 0.55, 0.92));
  for (const anchor of anchors) {
    const marker = MeshBuilder.CreateSphere(
      `region-anchor:${anchor.anchorId}`,
      { diameter: 0.16, segments: 12 },
      scene,
    );
    marker.parent = root;
    marker.position = toVector(anchor.scenePosition ?? { x: 0, y: 0.22, z: 0 });
    marker.material = anchorMaterial;

    const label = makeLabel(
      scene,
      `region-anchor-share:${anchor.anchorId}`,
      `${Math.round((anchor.budgetShare ?? 1) * 100)}%`,
      0.5,
      0.13,
    );
    label.parent = root;
    label.position = toVector(anchor.scenePosition ?? { x: 0, y: 0.22, z: 0 }, 0.26);
  }
}

function renderMaterialStates(scene, root, intents, circle) {
  const states = intents.filter(
    (intent) => intent.intentType === 'material_state' && intent.active,
  );
  const origin = toVector(circle?.placementFrame?.origin ?? { x: 0, y: 0, z: 0 });
  let offset = 0;
  for (const state of states) {
    if (state.renderPreset === 'water_liquid') continue;
    const stateOrigin = origin.add(new Vector3((offset % 3 - 1) * 0.26, 0, Math.floor(offset / 3) * 0.24));
    if (state.renderPreset === 'mist_cloud') {
      renderMistMaterialState(scene, root, state, stateOrigin);
    } else if (state.renderPreset === 'crushed_earth') {
      renderCrushedEarthMaterialState(scene, root, state, stateOrigin);
    } else if (state.renderPreset === 'mud_sludge') {
      renderMudMaterialState(scene, root, state, stateOrigin);
    } else if (state.renderPreset === 'glow') {
      renderGlowMaterialState(scene, root, state, stateOrigin, intents);
    } else if (state.renderPreset === 'ice_chunk') {
      renderIceMaterialState(scene, root, state, stateOrigin);
    } else {
      renderFallbackMaterialState(scene, root, state, stateOrigin);
    }
    offset += 1;
  }
}

function renderMistMaterialState(scene, root, state, origin) {
  const mat = materialForState(scene, state);
  const wispMat = softDiscMaterial(
    scene,
    `state:${state.id}:mist-wisp`,
    new Color3(0.76, 0.88, 0.9),
    0.32,
  );
  for (let index = 0; index < 7; index += 1) {
    const angle = (Math.PI * 2 * index) / 7;
    const radius = index === 0 ? 0 : 0.22 + (index % 2) * 0.18;
    const puff = MeshBuilder.CreateSphere(
      `material-mist-cloud:${state.id}:${index}`,
      { diameter: 0.42 + (index % 3) * 0.08, segments: 16 },
      scene,
    );
    puff.parent = root;
    puff.position = origin.add(
      new Vector3(Math.cos(angle) * radius, 0.34 + (index % 3) * 0.09, Math.sin(angle) * radius),
    );
    puff.material = mat;
  }

  for (let index = 0; index < 6; index += 1) {
    const angle = (Math.PI * 2 * index) / 6 + 0.28;
    const wisp = MeshBuilder.CreatePlane(
      `material-mist-soft-billboard:${state.id}:${index}`,
      { width: 0.44 + (index % 2) * 0.18, height: 0.24 + (index % 3) * 0.06 },
      scene,
    );
    wisp.parent = root;
    wisp.position = origin.add(
      new Vector3(
        Math.cos(angle) * (0.28 + (index % 3) * 0.06),
        0.46 + (index % 2) * 0.12,
        Math.sin(angle) * (0.28 + (index % 3) * 0.06),
      ),
    );
    wisp.rotation.z = angle * 0.35;
    wisp.billboardMode = Mesh.BILLBOARDMODE_ALL;
    wisp.material = wispMat;
    wisp.metadata = {
      role: 'material-state-soft-volume',
      visualPreset: materialStateVisualPreset(state),
    };
  }
}

function renderCrushedEarthMaterialState(scene, root, state, origin) {
  const mat = materialForState(scene, state);
  const dustMat = material(scene, `state:${state.id}:dust`, new Color3(0.46, 0.38, 0.28), 0.28);
  const grainMat = material(scene, `state:${state.id}:grain`, new Color3(0.34, 0.28, 0.2), 0.82);
  const drift = MeshBuilder.CreateTorus(
    `material-crushed-earth-dust:${state.id}`,
    { diameter: 1.15, thickness: 0.018, tessellation: 48 },
    scene,
  );
  drift.parent = root;
  drift.position = origin.add(new Vector3(0, 0.08, 0));
  drift.material = dustMat;

  for (let index = 0; index < 10; index += 1) {
    const angle = (Math.PI * 2 * index) / 10;
    const radius = 0.18 + (index % 4) * 0.09;
    const chip = MeshBuilder.CreatePolyhedron(
      `material-crushed-earth:${state.id}:${index}`,
      { type: 2, size: 0.07 + (index % 3) * 0.018 },
      scene,
    );
    chip.parent = root;
    chip.position = origin.add(
      new Vector3(Math.cos(angle) * radius, 0.05 + (index % 2) * 0.025, Math.sin(angle) * radius),
    );
    chip.rotation = new Vector3(index * 0.23, index * 0.41, index * 0.17);
    chip.material = mat;
  }

  for (let index = 0; index < 18; index += 1) {
    const angle = (Math.PI * 2 * index) / 18;
    const radius = 0.28 + (index % 5) * 0.055;
    const grain = MeshBuilder.CreateSphere(
      `material-crushed-earth-grain:${state.id}:${index}`,
      { diameter: 0.028 + (index % 3) * 0.008, segments: 6 },
      scene,
    );
    grain.parent = root;
    grain.position = origin.add(
      new Vector3(
        Math.cos(angle) * radius,
        0.035 + (index % 4) * 0.012,
        Math.sin(angle) * radius,
      ),
    );
    grain.material = grainMat;
    grain.metadata = {
      role: 'material-state-granular-particle',
      visualPreset: materialStateVisualPreset(state),
    };
  }
}

function renderMudMaterialState(scene, root, state, origin) {
  const mat = materialForState(scene, state);
  const ringMat = material(scene, `state:${state.id}:mud-viscosity`, new Color3(0.2, 0.15, 0.1), 0.42);
  const bubbleMat = material(scene, `state:${state.id}:mud-bubble`, new Color3(0.39, 0.31, 0.2), 0.78);
  const pool = MeshBuilder.CreateCylinder(
    `material-mud-sludge:${state.id}`,
    { diameter: 1.08, height: 0.045, tessellation: 42 },
    scene,
  );
  pool.parent = root;
  pool.position = origin.add(new Vector3(0, 0.032, 0));
  pool.scaling.z = 0.68;
  pool.material = mat;

  for (let index = 0; index < 3; index += 1) {
    const ring = MeshBuilder.CreateTorus(
      `material-mud-viscosity-ring:${state.id}:${index}`,
      { diameter: 0.42 + index * 0.22, thickness: 0.012, tessellation: 42 },
      scene,
    );
    ring.parent = root;
    ring.position = origin.add(new Vector3((index - 1) * 0.07, 0.066 + index * 0.003, 0.015 * index));
    ring.scaling.z = 0.62;
    ring.material = ringMat;
    ring.metadata = {
      role: 'material-state-viscous-flow',
      visualPreset: materialStateVisualPreset(state),
      viscosityIndex: index,
    };
  }

  for (let index = 0; index < 5; index += 1) {
    const angle = (Math.PI * 2 * index) / 5 + 0.2;
    const bubble = MeshBuilder.CreateSphere(
      `material-mud-bubble:${state.id}:${index}`,
      { diameter: 0.055 + (index % 2) * 0.025, segments: 10 },
      scene,
    );
    bubble.parent = root;
    bubble.position = origin.add(
      new Vector3(Math.cos(angle) * 0.26, 0.092 + (index % 3) * 0.006, Math.sin(angle) * 0.16),
    );
    bubble.scaling.y = 0.45;
    bubble.material = bubbleMat;
    bubble.metadata = {
      role: 'material-state-viscous-bubble',
      visualPreset: materialStateVisualPreset(state),
    };
  }
}

function renderGlowMaterialState(scene, root, state, origin, intents) {
  const mat = materialForState(scene, state);
  const attachment = attachedGlowAnchorForState(state, intents);
  const glowOrigin = attachment?.position ?? origin.add(new Vector3(0, 0.46, 0));
  const meshPrefix = attachment ? 'material-glow-attached' : 'material-glow';
  const glow = MeshBuilder.CreateSphere(
    `${meshPrefix}:${state.id}`,
    { diameter: 0.38, segments: 24 },
    scene,
  );
  glow.parent = root;
  glow.position = glowOrigin;
  glow.material = mat;

  const halo = MeshBuilder.CreateTorus(
    `${meshPrefix}-halo:${state.id}`,
    { diameter: 0.72, thickness: 0.018, tessellation: 56 },
    scene,
  );
  halo.parent = glow;
  halo.rotation.x = Math.PI / 2;
  halo.material = mat;

  createSpellPointLight(
    scene,
    root,
    `spell-light:glow:${state.id}`,
    glow.position,
    0.32,
    0.58,
  );
}

function attachedGlowAnchorForState(state, intents) {
  if (state.attachment?.targetKind !== 'generated_spell_output') return null;
  const targetNodeIds = new Set(state.attachment.targetNodeIds ?? []);
  if (targetNodeIds.size === 0) return null;
  const column = intents.find((intent) => {
    if (!['water_column', 'material_column'].includes(intent.intentType) || !intent.active) {
      return false;
    }
    const columnNodeIds = [intent.nodeId, ...(intent.collapsedNodeIds ?? [])].filter(Boolean);
    return columnNodeIds.some((nodeId) => targetNodeIds.has(nodeId));
  });
  if (!column) return null;

  const origin = toVector(column.origin ?? { x: 0, y: 0.22, z: 0 });
  const rawAxis = toVector(column.sceneAxis ?? { x: 0, y: 1, z: 0 });
  const axis = rawAxis.lengthSquared() > 0.0001 ? rawAxis.normalize() : new Vector3(0, 1, 0);
  const height =
    column.materialKind === 'earth'
      ? 0.95
      : column.materialKind === 'light'
        ? 0.82
        : 1.08;
  return {
    position: origin.add(axis.scale(height)),
    targetIntentId: column.id,
  };
}

function renderIceMaterialState(scene, root, state, origin) {
  const mat = materialForState(scene, state);
  for (let index = 0; index < 5; index += 1) {
    const shard = MeshBuilder.CreatePolyhedron(
      `material-ice-chunk:${state.id}:${index}`,
      { type: 1, size: 0.16 + index * 0.018 },
      scene,
    );
    shard.parent = root;
    shard.position = origin.add(new Vector3((index - 2) * 0.16, 0.18 + index * 0.018, (index % 2) * 0.12));
    shard.rotation = new Vector3(index * 0.31, index * 0.2, index * 0.44);
    shard.material = mat;
  }
}

function renderFallbackMaterialState(scene, root, state, origin) {
  const marker = MeshBuilder.CreateSphere(
    `material-state:${state.id}`,
    { diameter: 0.28, segments: 16 },
    scene,
  );
  marker.parent = root;
  marker.position = origin.add(new Vector3(0, 0.34, 0));
  marker.material = materialForState(scene, state);
}

function materialStateVisualPreset(state) {
  if (state.renderPreset === 'mist_cloud') return 'soft_volumetric_mist_billboards';
  if (state.renderPreset === 'crushed_earth') return 'granular_crushed_earth_and_dust';
  if (state.renderPreset === 'mud_sludge') return 'thick_viscous_mud_sludge';
  if (state.renderPreset === 'ice_chunk') return 'rigid_frosted_ice_chunks';
  if (state.renderPreset === 'glow') return 'emissive_glow_with_light';
  return 'material_state_marker';
}

function createSpellPointLight(scene, root, name, position, radius, baseIntensity) {
  const light = new PointLight(name, position, scene);
  light.parent = root;
  light.diffuse = new Color3(1, 0.86, 0.34);
  light.specular = new Color3(1, 0.94, 0.62);
  light.range = Math.max(1.4, radius * 8);
  light.intensity = baseIntensity;
  return light;
}

function renderSourceAcquisitions(scene, root, intents, sources, props, circle) {
  const acquisitions = intents.filter(
    (intent) => intent.intentType === 'source_acquisition' && intent.active,
  );
  if (acquisitions.length === 0) return [];
  const frame = circle?.placementFrame ?? {};
  const normal = toSceneAxis(frame.normal ?? { x: 0, y: 1, z: 0 });
  const labelAxis = sourceFieldLabelAxis(frame, normal);
  const origin = toVector(frame.origin ?? { x: 0, y: 0, z: 0 });
  const candidateMap = new Map([
    ...sources.map((source) => [source.id, source]),
    ...props.map((prop) => [prop.id, prop]),
  ]);
  let offset = 0;
  const visuals = [];
  for (const acquisition of acquisitions.slice(0, 6)) {
    const profile = sourceFieldProfile(acquisition);
    const reach = Math.max(0.35, acquisition.reach ?? 1);
    const fieldOrigins = sourceFieldOriginsForAcquisition(acquisition, origin);
    for (const [originIndex, fieldOrigin] of fieldOrigins.entries()) {
      const originSuffix = fieldOrigin.originId
        ? `:${safeMeshId(fieldOrigin.originId)}`
        : `:${originIndex}`;
      const fieldPosition = toVector(fieldOrigin.origin);
      const wash = MeshBuilder.CreateCylinder(
        `source-field-wash:${acquisition.id}${originSuffix}`,
        { diameter: reach * 2, height: 0.014, tessellation: 72 },
        scene,
      );
      wash.parent = root;
      wash.position = fieldPosition.add(normal.scale(0.052 + offset * 0.004 + originIndex * 0.006));
      wash.rotationQuaternion = rotationFromUp(normal);
      wash.material = material(scene, `source-field-wash-material:${acquisition.id}`, profile.color, 0.12);
      wash.metadata = {
        role: 'source-field-wash',
        sourceMode: acquisition.sourceMode,
        sourceFieldOriginId: fieldOrigin.originId ?? null,
        sourceFieldOriginPolicy: fieldOrigin.originPolicy ?? null,
        placementNormal: vectorDebug(normal),
        origin: vectorDebug(fieldPosition),
      };

      const field = MeshBuilder.CreateTorus(
        `source-field:${acquisition.id}${originSuffix}`,
        { diameter: reach * 2, thickness: 0.018, tessellation: 72 },
        scene,
      );
      field.parent = root;
      field.position = fieldPosition.add(normal.scale(0.09 + offset * 0.004 + originIndex * 0.006));
      field.rotationQuaternion = rotationFromUp(normal);
      field.material = material(
        scene,
        `source-field-material:${acquisition.id}`,
        profile.color,
        0.38,
      );
      field.metadata = {
        role: 'source-field',
        sourceMode: acquisition.sourceMode,
        sourceFieldOriginId: fieldOrigin.originId ?? null,
        sourceFieldOriginPolicy: fieldOrigin.originPolicy ?? null,
        placementNormal: vectorDebug(normal),
        origin: vectorDebug(fieldPosition),
      };

      const fieldLabel = makeLabel(
        scene,
        `source-field-label:${acquisition.id}${originSuffix}`,
        fieldOrigins.length > 1 ? `${profile.label} ${originIndex + 1}` : profile.label,
        0.82,
        0.16,
      );
      fieldLabel.parent = root;
      fieldLabel.position = fieldPosition
        .add(normal.scale(0.48 + offset * 0.05))
        .add(labelAxis.scale(Math.min(1.15, reach * 0.42)));
    }

    for (const match of acquisition.matches ?? []) {
      const candidate = candidateMap.get(match.sourceId);
      if (!candidate) continue;
      const linkOrigin = toVector(match.sourceFieldOrigin ?? acquisition.sourceFieldOrigin ?? origin)
        .add(normal.scale(0.08));
      renderCandidateHalo(scene, root, acquisition, match, candidate, true);
      renderDebugConnector(
        scene,
        root,
        `source-link:${acquisition.id}:${match.sourceId}`,
        linkOrigin,
        toVector(candidate.position ?? { x: 0, y: 0, z: 0 }, 0.22),
        match.selected ? new Color3(0.22, 0.58, 0.38) : new Color3(0.62, 0.5, 0.3),
        match.selected ? 0.52 : 0.28,
      );
    }

    for (const spend of acquisition.sourceSpends ?? []) {
      const candidate = candidateMap.get(spend.sourceId);
      if (!candidate) continue;
      const marker = MeshBuilder.CreateBox(
        `source-spend-marker:${acquisition.id}:${spend.sourceId}`,
        { width: 0.18, height: 0.18, depth: 0.18 },
        scene,
      );
      marker.parent = root;
      marker.position = toVector(candidate.position ?? { x: 0, y: 0, z: 0 }, 0.78);
      marker.rotation.y = Math.PI / 4;
      marker.material = material(
        scene,
        `source-spend-marker-material:${acquisition.id}:${spend.sourceId}`,
        new Color3(0.16, 0.52, 0.6),
        0.84,
      );

      const label = makeLabel(
        scene,
        `source-spend-label:${acquisition.id}:${spend.sourceId}`,
        `-${Math.round(spend.spendAmount)}`,
        0.42,
        0.14,
      );
      label.parent = root;
      label.position = toVector(candidate.position ?? { x: 0, y: 0, z: 0 }, 1);
    }

    for (const rejected of acquisition.rejectedCandidates ?? []) {
      const candidate = candidateMap.get(rejected.sourceId);
      if (!candidate) continue;
      renderCandidateHalo(scene, root, acquisition, rejected, candidate, false);
      const marker = MeshBuilder.CreateSphere(
        `source-rejected:${acquisition.id}:${rejected.sourceId}`,
        { diameter: 0.13, segments: 10 },
        scene,
      );
      marker.parent = root;
      marker.position = toVector(candidate.position ?? { x: 0, y: 0, z: 0 }, 0.42);
      marker.material = material(scene, `source-rejected-material:${acquisition.id}:${rejected.sourceId}`, new Color3(0.75, 0.24, 0.2), 0.72);

      const label = makeLabel(
        scene,
        `source-rejected-label:${acquisition.id}:${rejected.sourceId}`,
        rejected.reason === 'pull_capacity_below_difficulty' ? 'heavy' : 'skip',
        0.5,
        0.13,
      );
      label.parent = root;
      label.position = toVector(candidate.position ?? { x: 0, y: 0, z: 0 }, 0.64);
    }

    const bar = MeshBuilder.CreateBox(
      `source-acquisition:${acquisition.id}`,
      {
        width: 0.18,
        height: acquisition.satisfied ? 0.52 : 0.24,
        depth: 0.18,
      },
      scene,
    );
    bar.parent = root;
    bar.position = new Vector3(2.7 + offset * 0.24, 0.28, 2.3);
    bar.material = material(
      scene,
      `source-acquisition-material:${acquisition.id}`,
      acquisition.satisfied ? new Color3(0.29, 0.65, 0.43) : new Color3(0.74, 0.33, 0.25),
      0.82,
    );
    offset += 1;
    visuals.push(sourceFieldVisualDebug(acquisition, profile, fieldOrigins, normal));
  }
  return visuals;
}

function sourceFieldLabelAxis(frame, normal) {
  const tangent = toSceneAxis(frame.bitangent ?? frame.tangent ?? { x: 0, y: 0, z: 1 });
  const projected = tangent.subtract(normal.scale(Vector3.Dot(tangent, normal)));
  if (projected.lengthSquared() > 0.000001) return projected.normalize();
  return perpendicularBasis(normal).right;
}

function sourceFieldOriginsForAcquisition(acquisition, fallbackOrigin) {
  if (Array.isArray(acquisition.sourceFieldOrigins) && acquisition.sourceFieldOrigins.length > 0) {
    return acquisition.sourceFieldOrigins.map((fieldOrigin, index) => ({
      originId: fieldOrigin.originId ?? `source-field-origin:${index}`,
      origin: fieldOrigin.origin ?? fallbackOrigin,
      originPolicy: fieldOrigin.originPolicy ?? acquisition.sourceFieldOriginPolicy ?? null,
      reachPolicy: fieldOrigin.reachPolicy ?? acquisition.reachPolicy ?? null,
    }));
  }
  return [
    {
      originId: acquisition.sourceFieldOriginId ?? 'spell-placement-frame',
      origin: acquisition.sourceFieldOrigin ?? fallbackOrigin,
      originPolicy: acquisition.sourceFieldOriginPolicy ?? 'spell_placement_frame_origin',
      reachPolicy: acquisition.reachPolicy ?? 'placement_frame_3d_distance',
    },
  ];
}

function renderCandidateHalo(scene, root, acquisition, candidateRecord, candidate, accepted) {
  const profile = sourceFieldProfile(acquisition);
  const halo = MeshBuilder.CreateTorus(
    `source-candidate-halo:${accepted ? 'selected' : 'rejected'}:${acquisition.id}:${candidateRecord.sourceId}`,
    {
      diameter: Math.max(0.44, (candidate.size ?? 1) * 0.62),
      thickness: accepted ? 0.026 : 0.018,
      tessellation: 40,
    },
    scene,
  );
  halo.parent = root;
  halo.position = toVector(candidate.position ?? { x: 0, y: 0, z: 0 }, accepted ? 0.24 : 0.2);
  halo.material = material(
    scene,
    `source-candidate-halo-material:${accepted ? 'selected' : 'rejected'}:${acquisition.id}:${candidateRecord.sourceId}`,
    accepted ? profile.color : new Color3(0.75, 0.24, 0.2),
    accepted ? 0.58 : 0.44,
  );
  halo.metadata = {
    role: 'source-candidate-halo',
    sourceMode: acquisition.sourceMode,
    sourceId: candidateRecord.sourceId,
    accepted,
    reason: candidateRecord.reason ?? null,
  };
}

function sourceFieldProfile(acquisition) {
  if (acquisition.sourceMode === 'collect_nearby') {
    return {
      visualPreset: 'area_collection_field',
      label: 'collect',
      color: acquisition.satisfied ? new Color3(0.62, 0.5, 0.3) : new Color3(0.73, 0.36, 0.24),
    };
  }
  if (acquisition.sourceMode === 'pull' || acquisition.signRole === 'pull') {
    return {
      visualPreset: 'pull_field',
      label: 'pull',
      color: acquisition.satisfied ? new Color3(0.44, 0.6, 0.76) : new Color3(0.73, 0.36, 0.24),
    };
  }
  if (acquisition.sourceMode === 'push' || acquisition.signRole === 'push') {
    return {
      visualPreset: 'push_field',
      label: 'push',
      color: acquisition.satisfied ? new Color3(0.68, 0.48, 0.8) : new Color3(0.73, 0.36, 0.24),
    };
  }
  return {
    visualPreset: 'gather_intake_field',
    label: 'gather',
    color: acquisition.satisfied ? new Color3(0.24, 0.62, 0.54) : new Color3(0.74, 0.33, 0.25),
  };
}

function sourceFieldVisualDebug(acquisition, profile, fieldOrigins = [], normal = Vector3.Up()) {
  return {
    id: acquisition.id,
    sourceMode: acquisition.sourceMode,
    signRole: acquisition.signRole ?? null,
    visualPreset: profile.visualPreset,
    label: profile.label,
    satisfied: acquisition.satisfied,
    reach: acquisition.reach,
    placementNormal: vectorDebug(normal),
    originCount: fieldOrigins.length,
    sourceFieldOrigins: fieldOrigins.map((fieldOrigin) => ({
      originId: fieldOrigin.originId ?? null,
      origin: fieldOrigin.origin ?? null,
      originPolicy: fieldOrigin.originPolicy ?? null,
      reachPolicy: fieldOrigin.reachPolicy ?? null,
    })),
    selectedCandidateCount: (acquisition.matches ?? []).filter((match) => match.selected).length,
    rejectedCandidateCount: acquisition.rejectedCandidates?.length ?? 0,
    feedsDownstream: acquisition.feedsDownstream === true,
    collectionFeedsDownstream: acquisition.collectionFeedsDownstream === true,
  };
}

function regionDebug(intents) {
  return intents
    .filter((intent) => intent.intentType === 'region_emergence')
    .map((intent) => ({
      id: intent.id,
      nodeId: intent.nodeId,
      active: intent.active,
      regionZone: intent.regionZone,
      emissionPlacement: intent.emissionPlacement,
      budgetPolicy: intent.budgetPolicy,
      vectorSemantics: intent.vectorSemantics,
      debug: intent.debug ?? null,
      anchors: (intent.anchors ?? []).map((anchor) => ({
        anchorId: anchor.anchorId,
        placement: anchor.placement,
        weight: anchor.weight,
        clusterSize: anchor.clusterSize,
        clusterPolicy: anchor.clusterPolicy,
        budgetShare: anchor.budgetShare,
        scenePosition: anchor.scenePosition,
      })),
    }));
}

function thermalDebug(intents) {
  return intents
    .filter((intent) => intent.intentType === 'thermal_material_state')
    .map((intent) => ({
      id: intent.id,
      active: intent.active,
      degraded: intent.degraded,
      reason: intent.reason ?? null,
      sourceId: intent.sourceId ?? null,
      materialKind: intent.materialKind,
      materialFamily: intent.materialFamily,
      thermalEffect: intent.thermalEffect,
      direction: intent.direction,
      strength: intent.strength,
      phase: intent.phase,
      specificEnergy: intent.specificEnergy,
      phaseModel: intent.phaseModel,
      phaseThresholds: intent.phaseThresholds,
      materialPreset: intent.materialPreset,
      temperatureDriver: intent.temperatureDriver,
      visualState: intent.visualState,
      targetVolume: intent.targetVolume ?? null,
    }));
}

function sourceAcquisitionDebug(intents) {
  return intents
    .filter((intent) => intent.intentType === 'source_acquisition')
    .map((intent) => ({
      id: intent.id,
      operatorNodeId: intent.operatorNodeId ?? null,
      sealKey: intent.sealKey ?? null,
      sourceMode: intent.sourceMode,
      materialFamily: intent.materialFamily,
      materialCompatibilityPolicy: intent.materialCompatibilityPolicy ?? null,
      sourceContentPolicy: intent.sourceContentPolicy ?? null,
      sourceCapacityPolicy: intent.sourceCapacityPolicy ?? null,
      requiredAmount: intent.requiredAmount,
      acquiredAmount: intent.acquiredAmount,
      satisfied: intent.satisfied,
      limited: intent.limited,
      active: intent.active,
      reason: intent.reason,
      reach: intent.reach,
      pullCapacity: intent.pullCapacity,
      sourceFieldOrigin: intent.sourceFieldOrigin ?? null,
      sourceFieldOriginPolicy: intent.sourceFieldOriginPolicy ?? null,
      sourceFieldOrigins: intent.sourceFieldOrigins ?? [],
      reachPolicy: intent.reachPolicy ?? null,
      sourceSelectionRule: intent.sourceSelectionRule,
      candidateSelection: intent.candidateSelection,
      capacityPolicy: intent.capacityPolicy,
      downstreamHandoffScope: intent.downstreamHandoffScope ?? null,
      sourceSelectionOrder: intent.sourceSelectionOrder,
      matches: (intent.matches ?? []).map((match) => ({
        sourceId: match.sourceId,
        candidateType: match.candidateType,
        label: match.label ?? null,
        visualKind: match.visualKind ?? null,
        targetRole: match.targetRole ?? null,
        materialFamily: match.materialFamily,
        materialState: match.materialState,
        selected: match.selected,
        acquiredAmount: match.acquiredAmount,
        distance: match.distance,
        distancePolicy: match.distancePolicy,
        distanceOriginPolicy: match.distanceOriginPolicy ?? null,
        sourceFieldOriginId: match.sourceFieldOriginId ?? null,
        sourceFieldOrigin: match.sourceFieldOrigin ?? null,
        pullDifficulty: match.pullDifficulty,
        pullDifficultyBreakdown: match.pullDifficultyBreakdown,
        availableAmount: match.availableAmount,
      })),
      rejectedCandidates: (intent.rejectedCandidates ?? []).map((candidate) => ({
        sourceId: candidate.sourceId,
        candidateKind: candidate.candidateKind,
        label: candidate.label ?? null,
        visualKind: candidate.visualKind ?? null,
        targetRole: candidate.targetRole ?? null,
        compatibleFamily: candidate.compatibleFamily,
        withinReach: candidate.withinReach,
        movable: candidate.movable,
        canPull: candidate.canPull,
        reason: candidate.reason,
        distance: candidate.distance,
        distancePolicy: candidate.distancePolicy,
        distanceOriginPolicy: candidate.distanceOriginPolicy ?? null,
        sourceFieldOriginId: candidate.sourceFieldOriginId ?? null,
        sourceFieldOrigin: candidate.sourceFieldOrigin ?? null,
        reach: candidate.reach,
        pullCapacity: candidate.pullCapacity,
        pullDifficulty: candidate.pullDifficulty,
        pullDifficultyBreakdown: candidate.pullDifficultyBreakdown,
        availableAmount: candidate.availableAmount,
      })),
    }));
}

function sourceSpendDebug(intents) {
  return intents
    .filter((intent) => intent.intentType === 'source_acquisition' && intent.active)
    .flatMap((intent) =>
      (intent.sourceSpends ?? []).map((spend) => ({
        acquisitionId: intent.id,
        sourceMode: intent.sourceMode,
        sourceId: spend.sourceId,
        spendAmount: spend.spendAmount,
        materialFamily: spend.materialFamily,
        materialState: spend.materialState,
        policy: spend.policy,
      })),
    );
}

function renderPhysicsMotions(scene, root, intents) {
  const motions = intents.filter((intent) => intent.intentType === 'physics_motion' && intent.active);
  if (motions.length === 0) return;

  for (const motion of motions.slice(0, 10)) {
    const from = toVector(motion.fromPosition ?? { x: 0, y: 0.2, z: 0 });
    const to = toVector(motion.toPosition ?? { x: 0, y: 0.2, z: 0 });
    const color =
      motion.motionKind === 'area_collection_to_spell_origin'
        ? new Color3(0.55, 0.46, 0.28)
        : motion.materialFamily === 'earth'
          ? new Color3(0.52, 0.36, 0.2)
          : new Color3(0.22, 0.58, 0.64);

    renderDebugConnector(
      scene,
      root,
      `physics-motion-path:${motion.id}`,
      from,
      to,
      color,
      motion.movesActualSceneObject ? 0.54 : 0.36,
      motion.movesActualSceneObject ? 0.026 : 0.018,
    );

    const direction = to.subtract(from);
    if (direction.lengthSquared() > 0.000001) {
      const arrow = MeshBuilder.CreateCylinder(
        `physics-motion-arrowhead:${motion.id}`,
        {
          height: motion.movesActualSceneObject ? 0.24 : 0.18,
          diameterTop: 0,
          diameterBottom: motion.movesActualSceneObject ? 0.16 : 0.11,
          tessellation: 14,
        },
        scene,
      );
      arrow.parent = root;
      arrow.position = to.subtract(direction.normalize().scale(motion.movesActualSceneObject ? 0.1 : 0.07));
      arrow.rotationQuaternion = rotationFromUp(direction);
      arrow.material = material(scene, `physics-motion-arrowhead-material:${motion.id}`, color, 0.62);
      arrow.metadata = {
        role: 'physics-motion-arrowhead',
        visualPreset: physicsMotionVisualPreset(motion),
        motionKind: motion.motionKind,
        sourceMode: motion.sourceMode,
      };
    }

    const ghost = MeshBuilder.CreateSphere(
      `physics-motion-ghost:${motion.id}`,
      { diameter: motion.movesActualSceneObject ? 0.2 : 0.14, segments: 14 },
      scene,
    );
    ghost.parent = root;
    ghost.position = to;
    ghost.material = material(scene, `physics-motion-ghost-material:${motion.id}`, color, 0.46);
  }
}

function physicsMotionVisualPreset(motion) {
  if (motion.motionKind === 'area_collection_to_spell_origin') return 'collection_inward_preview';
  if (motion.motionKind === 'pull_field_motion') return 'pull_vector_preview';
  if (motion.motionKind === 'push_field_motion') return 'push_vector_preview';
  return 'gather_intake_preview';
}

function renderTargetingDebug(scene, root, intents, circle) {
  const scopes = intents.filter((intent) => intent.intentType === 'targeting_debug');
  if (scopes.length === 0) return [];
  const frame = circle?.placementFrame ?? {};
  const normal = toSceneAxis(frame.normal ?? { x: 0, y: 1, z: 0 });
  const origin = toVector(frame.origin ?? { x: 0, y: 0, z: 0 }).add(normal.scale(0.24));
  const visuals = [];
  for (const scope of scopes) {
    const targetVolume = scope.targetVolume ?? {};
    const color =
      scope.mode === 'crosshair_3'
        ? new Color3(0.45, 0.54, 0.9)
        : scope.mode === 'crosshair_2'
          ? new Color3(0.35, 0.66, 0.78)
          : new Color3(0.52, 0.43, 0.82);
    if (targetVolume.shape === 'sphere') {
      const sphere = MeshBuilder.CreateSphere(
        `target-volume:${scope.mode}:${scope.id}`,
        { diameter: Math.max(0.5, targetVolume.radius * 2), segments: 24 },
        scene,
      );
      sphere.parent = root;
      sphere.position = origin;
      sphere.material = material(scene, `target-volume-material:${scope.id}`, color, 0.16);
      annotateTargetVolume(sphere, scope, targetVolume, normal, origin);
      visuals.push(targetVolumeVisualDebug(scope, targetVolume, normal, origin));
    } else if (targetVolume.shape === 'local_column') {
      const height = Math.max(0.7, targetVolume.height ?? 1.5);
      const column = MeshBuilder.CreateCylinder(
        `target-volume:${scope.mode}:${scope.id}`,
        { height, diameter: Math.max(0.5, (targetVolume.radius ?? 0.5) * 2), tessellation: 32 },
        scene,
      );
      column.parent = root;
      column.position = origin.add(normal.scale(height / 2));
      column.rotationQuaternion = rotationFromUp(normal);
      column.material = material(scene, `target-volume-material:${scope.id}`, color, 0.16);
      annotateTargetVolume(column, scope, targetVolume, normal, origin);
      visuals.push(targetVolumeVisualDebug(scope, targetVolume, normal, origin));
    } else {
      const ring = MeshBuilder.CreateTorus(
        `target-volume:${scope.mode}:${scope.id}`,
        { diameter: 1.2, thickness: 0.025, tessellation: 56 },
        scene,
      );
      ring.parent = root;
      ring.position = origin;
      ring.rotationQuaternion = rotationFromUp(normal);
      ring.material = material(scene, `target-volume-material:${scope.id}`, color, 0.45);
      annotateTargetVolume(ring, scope, targetVolume, normal, origin);
      visuals.push(targetVolumeVisualDebug(scope, targetVolume, normal, origin));
    }
  }
  return visuals;
}

function annotateTargetVolume(mesh, scope, targetVolume, normal, origin) {
  mesh.metadata = {
    ...(mesh.metadata ?? {}),
    targetingKind: 'crosshair',
    crosshairMode: scope.mode,
    targetVolumeShape: targetVolume.shape ?? 'generated_output_binding',
    placementNormal: vectorDebug(normal),
    origin: vectorDebug(origin),
  };
}

function targetVolumeVisualDebug(scope, targetVolume, normal, origin) {
  return {
    mode: scope.mode,
    shape: targetVolume.shape ?? 'generated_output_binding',
    normal: vectorDebug(normal),
    origin: vectorDebug(origin),
    radius: targetVolume.radius ?? null,
    height: targetVolume.height ?? null,
  };
}

function renderFieldModifications(scene, root, intents, circle) {
  const modifications = intents.filter(
    (intent) => intent.intentType === 'field_modification' && intent.active,
  );
  if (modifications.length === 0) return;
  const origin = toVector(circle?.placementFrame?.origin ?? { x: 0, y: 0, z: 0 }, 0.62);
  for (const modification of modifications) {
    renderConvergenceFieldVisual(scene, root, modification, origin);

    const axes = modification.fieldModification?.compressionAxes ?? [];
    axes.forEach((axis, index) => {
      const direction = new Vector3(axis.x ?? 1, 0, axis.y ?? 0).normalize();
      renderDebugConnector(
        scene,
        root,
        `convergence-axis:${modification.convergenceMode}:${index}`,
        origin.add(direction.scale(-0.85)),
        origin.add(direction.scale(0.85)),
        new Color3(0.68, 0.36, 0.82),
        0.55,
        0.025,
      );
    });

    if (modification.convergenceMode === 'biased_compression') {
      const bias = modification.fieldModification?.biasVector ?? { x: 0, y: 0 };
      const direction = new Vector3(bias.x ?? 0, 0, bias.y ?? 0);
      if (direction.lengthSquared() > 0.0001) {
        renderDebugConnector(
          scene,
          root,
          `convergence-bias:${modification.id}`,
          origin,
          origin.add(direction.normalize().scale(1.15)),
          new Color3(0.82, 0.42, 0.36),
          0.62,
          0.032,
        );
      }
    }
  }
}

function renderConvergenceFieldVisual(scene, root, modification, origin) {
  const profile = convergenceVisualProfile(modification);
  const shell = MeshBuilder.CreateTorus(
    `convergence-compressed-field:${modification.convergenceMode}:${modification.id}`,
    { diameter: 1.34 * profile.diameterScale, thickness: 0.034, tessellation: 72 },
    scene,
  );
  shell.parent = root;
  shell.position = origin;
  shell.scaling.x = profile.scaleX;
  shell.scaling.z = profile.scaleZ;
  shell.material = material(
    scene,
    `convergence-compressed-field-material:${modification.id}`,
    new Color3(0.68, 0.36, 0.82),
    0.52,
  );

  const core = MeshBuilder.CreateCylinder(
    `convergence-field-core:${modification.convergenceMode}:${modification.id}`,
    { diameter: 0.42 * profile.diameterScale, height: 0.035, tessellation: 40 },
    scene,
  );
  core.parent = root;
  core.position = origin.add(new Vector3(0, 0.012, 0));
  core.scaling.x = profile.scaleX;
  core.scaling.z = profile.scaleZ;
  core.material = material(
    scene,
    `convergence-field-core-material:${modification.id}`,
    new Color3(0.82, 0.58, 0.92),
    0.24,
  );

  if (modification.convergenceMode === 'radial_point_focus') {
    const focus = MeshBuilder.CreateTorus(
      `convergence-focus-tightening:${modification.id}`,
      { diameter: 0.72, thickness: 0.02, tessellation: 56 },
      scene,
    );
    focus.parent = root;
    focus.position = origin.add(new Vector3(0, 0.05, 0));
    focus.material = material(scene, `convergence-focus-tightening-material:${modification.id}`, new Color3(0.88, 0.72, 0.96), 0.62);
  }
}

function convergenceVisualProfile(modification) {
  if (modification.convergenceMode === 'radial_point_focus') {
    return { preset: 'radial_tightened_field', scaleX: 0.74, scaleZ: 0.74, diameterScale: 0.92 };
  }
  if (modification.convergenceMode === 'biased_compression') {
    const bias = modification.fieldModification?.biasVector ?? { x: 0, y: 0 };
    const biasStrength = Math.min(0.35, Math.hypot(bias.x ?? 0, bias.y ?? 0) * 0.2);
    return {
      preset: 'biased_pinched_field',
      scaleX: 0.72,
      scaleZ: 1.08 + biasStrength,
      diameterScale: 1,
    };
  }
  return { preset: 'axis_ovalized_field', scaleX: 0.58, scaleZ: 1.18, diameterScale: 1 };
}

function convergenceVisualDebug(intents) {
  return intents
    .filter((intent) => intent.intentType === 'field_modification' && intent.active)
    .map((intent) => {
      const profile = convergenceVisualProfile(intent);
      return {
        id: intent.id,
        mode: intent.convergenceMode,
        visualPreset: profile.preset,
        scaleX: profile.scaleX,
        scaleZ: profile.scaleZ,
        compressesActiveField: intent.fieldModification?.compressesActiveField === true,
        pullsMaterialTowardSigns: intent.fieldModification?.pullsMaterialTowardSigns === true,
        targetFieldPolicy: intent.targetFieldPolicy ?? null,
      };
    });
}

function renderDebugConnector(scene, root, name, from, to, color, alpha, diameter = 0.018) {
  const delta = to.subtract(from);
  if (delta.lengthSquared() <= 0.000001) return;
  const line = MeshBuilder.CreateCylinder(
    name,
    { height: delta.length(), diameter, tessellation: 8 },
    scene,
  );
  line.parent = root;
  line.position = from.add(delta.scale(0.5));
  line.rotationQuaternion = rotationFromUp(delta.normalize());
  line.material = material(scene, `${name}:material`, color, alpha);
}

function renderWeather(scene, root, weatherMode) {
  if (weatherMode !== 'rain') return;
  const rainMaterial = material(scene, 'weather-rain-material', new Color3(0.56, 0.68, 0.78), 0.42);
  for (let i = 0; i < 28; i += 1) {
    const drop = MeshBuilder.CreateCylinder(
      `weather-rain-streak:${i}`,
      { height: 0.72, diameter: 0.012, tessellation: 6 },
      scene,
    );
    drop.parent = root;
    drop.position = new Vector3(-5.5 + (i % 7) * 1.7, 3.5 + (i % 4) * 0.35, -3.5 + Math.floor(i / 7) * 2.2);
    drop.rotation.z = 0.18;
    drop.material = rainMaterial;
  }
}

function addDrag(mesh, id, updatePosition) {
  const drag = new PointerDragBehavior({ dragPlaneNormal: new Vector3(0, 1, 0) });
  drag.useObjectOrientationForDragging = false;
  drag.onDragEndObservable.add(() => {
    updatePosition(id, {
      x: round(mesh.position.x),
      y: 0,
      z: round(mesh.position.z),
    });
  });
  mesh.addBehavior(drag);
  mesh.metadata = { ...(mesh.metadata ?? {}), draggable: true };
}

function addPlacementDrag(mesh, updateSpellPlacement) {
  if (typeof updateSpellPlacement !== 'function') return;
  const drag = new PointerDragBehavior({ dragPlaneNormal: new Vector3(0, 1, 0) });
  drag.useObjectOrientationForDragging = false;
  drag.onDragEndObservable.add(() => {
    const worldPosition = mesh.getAbsolutePosition();
    updateSpellPlacement({
      x: round(worldPosition.x),
      y: 0,
      z: round(worldPosition.z),
    });
  });
  mesh.addBehavior(drag);
  mesh.metadata = { ...(mesh.metadata ?? {}), draggable: true, role: 'spell-placement' };
}

function makeLabel(scene, name, text, width, height) {
  const texture = new DynamicTexture(`${name}:texture`, { width: 512, height: 128 }, scene, true);
  texture.hasAlpha = true;
  texture.drawText(text, null, 78, 'bold 44px sans-serif', '#17211d', 'transparent', true);
  const mat = new StandardMaterial(`${name}:material`, scene);
  mat.diffuseTexture = texture;
  mat.opacityTexture = texture;
  mat.emissiveColor = new Color3(0.05, 0.08, 0.06);
  const plane = MeshBuilder.CreatePlane(name, { width, height }, scene);
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  plane.material = mat;
  return plane;
}

function sourceMaterial(scene, kind, alpha) {
  if (kind === 'water') return material(scene, 'source-water-material', new Color3(0.16, 0.43, 0.58), alpha);
  if (kind === 'fire') return material(scene, 'source-fire-material', new Color3(0.55, 0.19, 0.13), alpha);
  if (kind === 'earth') return material(scene, 'source-earth-material', new Color3(0.34, 0.4, 0.28), alpha);
  return material(scene, 'source-generic-material', new Color3(0.45, 0.5, 0.47), alpha);
}

function materialForState(scene, state) {
  if (state.renderPreset === 'mist_cloud') {
    return material(scene, `state:${state.id}`, new Color3(0.68, 0.78, 0.82), 0.38);
  }
  if (state.renderPreset === 'ice_chunk') {
    return material(scene, `state:${state.id}`, new Color3(0.64, 0.86, 0.94), 0.75);
  }
  if (state.renderPreset === 'crushed_earth') {
    return material(scene, `state:${state.id}`, new Color3(0.5, 0.42, 0.31), 0.88);
  }
  if (state.renderPreset === 'mud_sludge') {
    return material(scene, `state:${state.id}`, new Color3(0.31, 0.25, 0.17), 0.9);
  }
  if (state.renderPreset === 'glow') {
    return emissiveMaterial(scene, `state:${state.id}`, new Color3(0.98, 0.86, 0.36));
  }
  return material(scene, `state:${state.id}`, new Color3(0.55, 0.62, 0.58), 0.82);
}

function dispersionMaterial(scene, intent) {
  if (intent.materialKind === 'water') {
    if (intent.renderPreset === 'mist_cloud') {
      return material(scene, `dispersion:${intent.id}`, new Color3(0.68, 0.78, 0.82), 0.28);
    }
    if (intent.renderPreset === 'ice_chunk') {
      return material(scene, `dispersion:${intent.id}`, new Color3(0.64, 0.86, 0.94), 0.72);
    }
    return material(scene, `dispersion:${intent.id}`, new Color3(0.32, 0.72, 0.92), 0.42);
  }
  if (intent.materialKind === 'earth') {
    return material(scene, `dispersion:${intent.id}`, new Color3(0.5, 0.39, 0.24), 0.74);
  }
  if (intent.materialKind === 'fire') {
    return emissiveMaterial(scene, `dispersion:${intent.id}`, new Color3(0.95, 0.37, 0.16));
  }
  if (intent.materialKind === 'wind') {
    return material(scene, `dispersion:${intent.id}`, new Color3(0.74, 0.9, 0.88), 0.22);
  }
  if (intent.materialKind === 'light') {
    return emissiveMaterial(scene, `dispersion:${intent.id}`, new Color3(1, 0.88, 0.42));
  }
  return material(scene, `dispersion:${intent.id}`, new Color3(0.54, 0.62, 0.58), 0.54);
}

function material(scene, name, color, alpha = 1) {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = color;
  mat.specularColor = new Color3(0.08, 0.1, 0.09);
  mat.alpha = alpha;
  return mat;
}

function emissiveMaterial(scene, name, color) {
  const mat = material(scene, name, color, 0.92);
  mat.emissiveColor = color.scale(0.65);
  return mat;
}

function softDiscMaterial(scene, name, color, alpha) {
  const texture = new DynamicTexture(`${name}:texture`, { width: 128, height: 128 }, scene, true);
  const context = texture.getContext();
  const gradient = context.createRadialGradient(64, 64, 8, 64, 64, 62);
  gradient.addColorStop(0, `rgba(${color255(color.r)}, ${color255(color.g)}, ${color255(color.b)}, ${alpha})`);
  gradient.addColorStop(0.55, `rgba(${color255(color.r)}, ${color255(color.g)}, ${color255(color.b)}, ${alpha * 0.42})`);
  gradient.addColorStop(1, `rgba(${color255(color.r)}, ${color255(color.g)}, ${color255(color.b)}, 0)`);
  context.clearRect(0, 0, 128, 128);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  texture.update();

  const mat = new StandardMaterial(`${name}:material`, scene);
  mat.diffuseTexture = texture;
  mat.opacityTexture = texture;
  mat.diffuseColor = color;
  mat.emissiveColor = color.scale(0.16);
  mat.alpha = 0.74;
  mat.backFaceCulling = false;
  return mat;
}

function color255(value) {
  return Math.round(clamp(value, 0, 1) * 255);
}

function symbolPosition(symbol, scale) {
  if (symbol.position.x !== 0 || symbol.position.y !== 0) {
    return {
      x: symbol.position.x * scale,
      z: symbol.position.y * scale,
    };
  }
  const angle = ((symbol.polarAngleDeg ?? 0) * Math.PI) / 180;
  return {
    x: Math.cos(angle) * (symbol.polarRadius ?? 0) * scale,
    z: Math.sin(angle) * (symbol.polarRadius ?? 0) * scale,
  };
}

function mapAxis(axis) {
  const mapped = axis
    ? new Vector3(axis.x ?? 0, axis.z ?? 1, axis.y ?? 0)
    : new Vector3(0, 1, 0);
  if (mapped.lengthSquared() <= 0.000001) return new Vector3(0, 1, 0);
  return mapped.normalize();
}

function toSceneAxis(axis) {
  const vector = new Vector3(axis.x ?? 0, axis.y ?? 1, axis.z ?? 0);
  if (vector.lengthSquared() <= 0.000001) return new Vector3(0, 1, 0);
  return vector.normalize();
}

function rotationFromUp(direction) {
  const up = Vector3.Up();
  const dir = direction.normalize();
  const dot = clamp(Vector3.Dot(up, dir), -1, 1);
  if (dot > 0.9999) return Quaternion.Identity();
  if (dot < -0.9999) return Quaternion.RotationAxis(Vector3.Right(), Math.PI);
  const axis = Vector3.Cross(up, dir).normalize();
  return Quaternion.RotationAxis(axis, Math.acos(dot));
}

function perpendicularBasis(direction) {
  const dir = direction.lengthSquared() > 0.000001 ? direction.normalize() : Vector3.Up();
  const reference = Math.abs(Vector3.Dot(dir, Vector3.Up())) > 0.92
    ? Vector3.Right()
    : Vector3.Up();
  const right = Vector3.Cross(dir, reference).normalize();
  const up = Vector3.Cross(right, dir).normalize();
  return { right, up };
}

function toVector(position, yOverride) {
  return new Vector3(position.x ?? 0, yOverride ?? position.y ?? 0, position.z ?? 0);
}

function vectorDebug(vector) {
  return {
    x: round(vector.x ?? 0),
    y: round(vector.y ?? 0),
    z: round(vector.z ?? 0),
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function easeOutCubic(value) {
  const t = clamp(value, 0, 1);
  return 1 - Math.pow(1 - t, 3);
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function safeMeshId(value) {
  return String(value ?? 'item').replace(/[^a-zA-Z0-9_-]+/g, '-');
}
