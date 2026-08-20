import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { loadRapier } from '../mechanics/rapier-loader.js';
import { MainWorldRapierRuntime } from './MainWorldRapierRuntime.js';
import { useSpellStore } from '../store.js';
import { PlacedWorldObjects } from './PlacedWorldObjects.jsx';
import { MAIN_WORLD_FRAME_PRIORITY } from '../scene/framePriorities.js';

function publishMainWorldSnapshot(runtime, snapshotRef, snapshot = runtime.getSnapshot()) {
  snapshotRef.current = snapshot;
  window.__WHA_MAIN_WORLD_PHYSICS__ = snapshot;
  return snapshot;
}

function teleportAndPublishMainWorldSnapshot(runtime, position, snapshotRef) {
  runtime.teleportPlayer(position);
  return publishMainWorldSnapshot(runtime, snapshotRef);
}

export function MainWorldPhysicsController({
  props = [],
  sources = [],
  placedSpells = [],
  blueprint = null,
  onEarthBlocked,
  initialPlayerState = null,
  playerControllerRef,
  pendingPlayerTeleportRef,
  wrenchDragSelection = null,
}) {
  const { scene, invalidate } = useThree();
  const placedAssets = useSpellStore((state) => state.placedAssets);
  const placedMechanicsBuilds = useSpellStore((state) => state.placedMechanicsBuilds);
  const runtimeRef = useRef(null);
  const latestRef = useRef({ props, sources, placedSpells, placedAssets, blueprint, placedMechanicsBuilds, onEarthBlocked, initialPlayerState });
  const baseMatricesRef = useRef(new Map());
  const lastMountedMatricesRef = useRef(new Map());
  const mountedMatrixOwnersRef = useRef(new Map());
  const placementSignaturesRef = useRef(new Map());
  const snapshotRef = useRef(null);
  const placementSignature = placedSpells.map((spell) => JSON.stringify({
    id: spell.id,
    anchor: spell.anchor,
    binding: spell.binding,
    placementTransform: spell.placementTransform,
    transform: spell.transform,
  })).join('|');

  useEffect(() => {
    latestRef.current = { props, sources, placedSpells, placedAssets, blueprint, placedMechanicsBuilds, onEarthBlocked, initialPlayerState };
    runtimeRef.current?.setBlockedHandler(onEarthBlocked);
    runtimeRef.current?.syncBodies(props, sources);
    runtimeRef.current?.syncPlacedAssets(placedAssets);
    runtimeRef.current?.syncSpells(placedSpells);
    if (placedMechanicsBuilds?.length) {
      runtimeRef.current?.syncBlueprints([
        ...placedMechanicsBuilds,
        ...(blueprint?.document ? [blueprint] : []),
      ]);
    } else {
      runtimeRef.current?.syncBlueprint(blueprint);
    }
    if (runtimeRef.current) snapshotRef.current = runtimeRef.current.getSnapshot();
    invalidate();
  }, [blueprint, initialPlayerState, invalidate, onEarthBlocked, placedAssets, placedMechanicsBuilds, placedSpells, props, sources]);

  useEffect(() => {
    const nextSignatures = new Map(placedSpells.map((spell) => [spell.id, JSON.stringify({
      anchor: spell.anchor,
      binding: spell.binding,
      placementTransform: spell.placementTransform,
      transform: spell.transform,
    })]));
    const changedSpellIds = new Set(
      [...new Set([...placementSignaturesRef.current.keys(), ...nextSignatures.keys()])]
        .filter((spellId) => placementSignaturesRef.current.get(spellId) !== nextSignatures.get(spellId)),
    );
    for (const [uuid, spellId] of mountedMatrixOwnersRef.current) {
      if (!changedSpellIds.has(spellId)) continue;
      baseMatricesRef.current.delete(uuid);
      lastMountedMatricesRef.current.delete(uuid);
      mountedMatrixOwnersRef.current.delete(uuid);
    }
    placementSignaturesRef.current = nextSignatures;
  }, [placementSignature]);

  useEffect(() => {
    let cancelled = false;
    loadRapier().then((rapier) => {
      if (cancelled || !rapier) {
        if (!cancelled) window.__WHA_MAIN_WORLD_PHYSICS__ = { ready: false, error: 'rapier_unavailable' };
        return;
      }
      const latest = latestRef.current;
      const runtime = new MainWorldRapierRuntime(rapier, {
        props: latest.props,
        sources: latest.sources,
        placedAssets: latest.placedAssets,
        placedSpells: latest.placedSpells,
        blueprint: latest.blueprint,
        placedMechanicsBuilds: [
          ...(latest.placedMechanicsBuilds ?? []),
        ],
        onEarthBlocked: latest.onEarthBlocked,
        playerState: latest.initialPlayerState,
      });
      const pendingTeleport = pendingPlayerTeleportRef?.current;
      if (pendingTeleport) {
        teleportAndPublishMainWorldSnapshot(runtime, pendingTeleport, snapshotRef);
        pendingPlayerTeleportRef.current = null;
      }
      if (latest.placedMechanicsBuilds?.length) {
        runtime.syncBlueprints([
          ...latest.placedMechanicsBuilds,
          ...(latest.blueprint?.document ? [latest.blueprint] : []),
        ]);
      } else {
        runtime.syncBlueprint(latest.blueprint);
      }
      runtimeRef.current = runtime;
      publishMainWorldSnapshot(runtime, snapshotRef);
      if (playerControllerRef) {
        playerControllerRef.current = {
          requestTranslation: (translation) => { runtime.setPlayerRequest(translation, 'input'); invalidate(); },
          teleportPlayer: (position) => { teleportAndPublishMainWorldSnapshot(runtime, position, snapshotRef); invalidate(); },
          getPlayerState: () => runtime.getSnapshot().player,
          cameraObstructionDistance: (origin, direction, maxDistance) => (
            runtime.cameraObstructionDistance(origin, direction, maxDistance)
          ),
        };
        window.__WHA_PLAYER_PHYSICS__ = {
          requestTranslation: (translation) => { runtime.setPlayerRequest(translation); invalidate(); },
          teleportPlayer: (position) => { teleportAndPublishMainWorldSnapshot(runtime, position, snapshotRef); invalidate(); },
          getSnapshot: () => runtime.getSnapshot().player,
        };
      }
      invalidate();
    });
    return () => {
      cancelled = true;
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
      snapshotRef.current = null;
      if (playerControllerRef) playerControllerRef.current = null;
      delete window.__WHA_PLAYER_PHYSICS__;
      delete window.__WHA_MAIN_WORLD_PHYSICS__;
      delete window.__WHA_PLACED_SPELL_WORLD_TRANSFORMS__;
      delete window.__WHA_SPELL_BINDING_DELTAS__;
      delete window.__WHA_PLACEMENT_WORLD_TRANSFORMS__;
      baseMatricesRef.current.clear();
      lastMountedMatricesRef.current.clear();
      mountedMatrixOwnersRef.current.clear();
      placementSignaturesRef.current.clear();
    };
  }, [invalidate, pendingPlayerTeleportRef, playerControllerRef]);

  useFrame((_, deltaSeconds) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const pendingTeleport = pendingPlayerTeleportRef?.current;
    if (pendingTeleport) {
      teleportAndPublishMainWorldSnapshot(runtime, pendingTeleport, snapshotRef);
      pendingPlayerTeleportRef.current = null;
    }
    const previousSnapshot = snapshotRef.current ?? runtime.getSnapshot();
    const hasActiveField = previousSnapshot.fields.some((field) => field.active === true);
    const hasContinuousBlueprintField = (previousSnapshot.blueprint?.deviceFieldCount ?? 0) > 0;
    const hasPlayerRequest = runtime.hasPlayerRequest();
    const hasAwakeDynamicBody = runtime.hasAwakeDynamicBody();
    const shouldStep = hasActiveField || hasContinuousBlueprintField || hasPlayerRequest || hasAwakeDynamicBody;
    const demandReason = hasActiveField
      ? 'active_field'
      : hasContinuousBlueprintField
        ? 'continuous_blueprint'
        : hasPlayerRequest
          ? 'player_request'
          : hasAwakeDynamicBody
            ? 'awake_dynamic_body'
            : null;
    runtime.setDemandReason(demandReason);
    const snapshot = shouldStep
      ? runtime.step(deltaSeconds)
      : previousSnapshot;
    if (shouldStep) invalidate();
    snapshotRef.current = snapshot;

    const dynamicBodies = Object.values(snapshot.bodies).filter(
      (body) => (body.bodyMode === 'dynamic' || body.earthCarried === true) && body.renderName,
    );
    const isBeingDragged = (kind, id) => (
      wrenchDragSelection?.kind === kind && wrenchDragSelection?.id === id
    );

    // A gravity-released mechanics item has several Rapier bodies but one
    // wrench root. Follow its first authored assembly so the selected root and
    // gizmo travel with the falling mechanism while every child keeps its real
    // body pose relative to that moving root.
    for (const build of latestRef.current.placedMechanicsBuilds ?? []) {
      if (build.affectedByGravity !== true || isBeingDragged('mechanics-build', build.id)) continue;
      const reference = dynamicBodies.find(
        (body) => body.placementKind === 'mechanics-build' && body.placementId === build.id,
      );
      if (reference) applyMechanicsPlacementRootPose(scene, build, reference);
    }

    for (const body of dynamicBodies) {
      if (isBeingDragged(body.placementKind, body.placementId)) continue;
      const object = scene.getObjectByName(body.renderName);
      if (!object) continue;
      applyPhysicsPoseToRenderedObject(object, body);
    }

    // Spell circles are massless attachments. Remove any legacy standalone
    // spell body and move the render/effect nodes by the host body's delta.
    for (const id of runtime.gravityBodies.keys()) {
      runtime.removeGravityPlacement(id);
    }

    const worldTransforms = {};
    const bindingDeltas = {};
    for (const spell of latestRef.current.placedSpells) {
      const deltaTransform = runtime.mountedTransformForSpell(spell.id);
      const spellObject = scene.getObjectByName(`placed-spell:${spell.id}`);
      if (!deltaTransform) {
        if (spellObject) worldTransforms[spell.id] = worldTransformForObject(spellObject);
        continue;
      }
      bindingDeltas[spell.id] = deltaTransform;
      const deltaMatrix = new THREE.Matrix4().compose(
        new THREE.Vector3(
          deltaTransform.translation.x,
          deltaTransform.translation.y,
          deltaTransform.translation.z,
        ),
        new THREE.Quaternion(
          deltaTransform.rotation.x,
          deltaTransform.rotation.y,
          deltaTransform.rotation.z,
          deltaTransform.rotation.w,
        ),
        new THREE.Vector3(1, 1, 1),
      );
      scene.traverse((object) => {
        if (
          object.name !== `placed-spell:${spell.id}` &&
          !object.name.startsWith(`spell-output:${spell.id}:`)
        ) return;
        object.updateMatrix();
        const currentMatrix = object.matrix.clone();
        const lastMounted = lastMountedMatricesRef.current.get(object.uuid);
        let base = baseMatricesRef.current.get(object.uuid);
        if (!base) {
          // Newly mounted R3F nodes can still have a stale local `matrix`
          // until the render pass updates matrixWorld. Capture the authored
          // declarative transform once; activation refreshes are allowed to
          // reapply it without rebasing the physical attachment.
          base = currentMatrix.clone();
          baseMatricesRef.current.set(object.uuid, base);
          mountedMatrixOwnersRef.current.set(object.uuid, spell.id);
        } else if (
          isBeingDragged('spell', spell.id) &&
          lastMounted &&
          !currentMatrix.equals(lastMounted) &&
          !currentMatrix.equals(base)
        ) {
          // TransformControls edits the mounted world pose directly while the
          // user is dragging. Convert only that explicit edit back through the
          // mount delta. A normal React refresh resets currentMatrix to `base`
          // and must never be mistaken for a new attachment baseline.
          base = deltaMatrix.clone().invert().multiply(currentMatrix);
          baseMatricesRef.current.set(object.uuid, base);
          mountedMatrixOwnersRef.current.set(object.uuid, spell.id);
        }
        const transformed = deltaMatrix.clone().multiply(base);
        transformed.decompose(object.position, object.quaternion, object.scale);
        object.updateMatrix();
        lastMountedMatricesRef.current.set(object.uuid, object.matrix.clone());
      });
      if (spellObject) worldTransforms[spell.id] = worldTransformForObject(spellObject);
    }
    window.__WHA_PLACED_SPELL_WORLD_TRANSFORMS__ = worldTransforms;
    window.__WHA_SPELL_BINDING_DELTAS__ = bindingDeltas;
    const placementWorldTransforms = {};
    for (const asset of latestRef.current.placedAssets ?? []) {
      const object = scene.getObjectByName(`placed-asset:${asset.id}`);
      if (object) placementWorldTransforms[`asset:${asset.id}`] = worldTransformForObject(object);
    }
    for (const prop of latestRef.current.props ?? []) {
      const object = scene.getObjectByName(`prop:${prop.id}`);
      if (object) placementWorldTransforms[`prop:${prop.id}`] = worldTransformForObject(object);
    }
    for (const build of latestRef.current.placedMechanicsBuilds ?? []) {
      const object = scene.getObjectByName(`placed-mechanics-build:${build.id}`);
      if (object) placementWorldTransforms[`mechanics-build:${build.id}`] = worldTransformForObject(object);
    }
    window.__WHA_PLACEMENT_WORLD_TRANSFORMS__ = placementWorldTransforms;
    if (shouldStep) window.dispatchEvent(new CustomEvent('wha-placement-physics-pose'));
    publishMainWorldSnapshot(runtime, snapshotRef, snapshot);
  }, MAIN_WORLD_FRAME_PRIORITY.physics);

  return <PlacedWorldObjects assets={placedAssets} mechanicsBuilds={placedMechanicsBuilds} />;
}

function applyMechanicsPlacementRootPose(scene, build, referenceBody) {
  const root = scene.getObjectByName(`placed-mechanics-build:${build.id}`);
  const sourceAssemblyId = String(referenceBody.sourceId ?? '').slice(`${build.id}::`.length);
  const assembly = build.document?.assemblies?.find((item) => item.assemblyId === sourceAssemblyId)
    ?? build.document?.assemblies?.[0];
  if (!root || !assembly) return;
  const local = assembly.transform ?? {};
  const localRotation = new THREE.Quaternion(
    local.rotation?.x ?? 0,
    local.rotation?.y ?? 0,
    local.rotation?.z ?? 0,
    local.rotation?.w ?? 1,
  );
  const bodyRotation = new THREE.Quaternion(
    referenceBody.rotation.x,
    referenceBody.rotation.y,
    referenceBody.rotation.z,
    referenceBody.rotation.w,
  );
  const rootRotation = bodyRotation.multiply(localRotation.invert()).normalize();
  const scaledLocalPosition = new THREE.Vector3(
    Number(local.position?.x ?? 0) * root.scale.x,
    Number(local.position?.y ?? 0) * root.scale.y,
    Number(local.position?.z ?? 0) * root.scale.z,
  ).applyQuaternion(rootRotation);
  root.position.set(
    referenceBody.position.x - scaledLocalPosition.x,
    referenceBody.position.y - scaledLocalPosition.y,
    referenceBody.position.z - scaledLocalPosition.z,
  );
  root.quaternion.copy(rootRotation);
  root.updateMatrixWorld(true);
}

function worldTransformForObject(object) {
  object.updateWorldMatrix(true, false);
  const position = object.getWorldPosition(new THREE.Vector3());
  const rotation = object.getWorldQuaternion(new THREE.Quaternion());
  const scale = object.getWorldScale(new THREE.Vector3());
  return {
    position: { x: position.x, y: position.y, z: position.z },
    rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
    scale: { x: scale.x, y: scale.y, z: scale.z },
  };
}

function applyPhysicsPoseToRenderedObject(object, body) {
  const worldPosition = new THREE.Vector3(body.position.x, body.position.y, body.position.z);
  const worldRotation = new THREE.Quaternion(
    body.rotation.x,
    body.rotation.y,
    body.rotation.z,
    body.rotation.w,
  );
  const placementRoot = body.placementKind === 'mechanics-build'
    && object.parent?.name?.startsWith('placed-mechanics-build:')
    ? object.parent
    : null;
  if (!placementRoot) {
    object.position.copy(worldPosition);
    object.quaternion.copy(worldRotation);
    return;
  }

  // Mechanics assemblies are authored in build-local space and rendered
  // below the build placement root. Rapier owns world-space poses. Convert
  // that live pose back into the parent's coordinates before applying it;
  // assigning the world pose directly here applies the placement transform a
  // second time and visually tears a saved assembly apart.
  placementRoot.updateWorldMatrix(true, false);
  object.position.copy(placementRoot.worldToLocal(worldPosition));
  const parentWorldRotation = placementRoot.getWorldQuaternion(new THREE.Quaternion());
  object.quaternion.copy(parentWorldRotation.invert().multiply(worldRotation));
}
