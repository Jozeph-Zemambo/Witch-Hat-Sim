import {
  ATELIER_PLAYTHROUGH,
  EARTH_EMERGENCE_SPEED,
  MAIN_WORLD_BUILTIN_BODIES,
  MAIN_WORLD_FIXED_DT,
  MAIN_WORLD_FORCE_BUDGET,
  MAIN_WORLD_MAX_FRAME_DT,
  MAIN_WORLD_MAX_SUBSTEPS,
  add,
  bodyBoundingRadius,
  buildMainWorldSpellFields,
  comparableForceLimit,
  earthColumnPushLimit,
  earthEmergenceSweep,
  earthPushResistance,
  length,
  mainWorldBodyForProp,
  mainWorldBodyForSource,
  mainWorldPropCenterOffset,
  placedSpellMountBodyId,
  sampleDispersionField,
  sampleEarthSweep,
  sampleWaterCurtain,
  scale,
  subtract,
  terrainHeightAt,
  takeAggregateForceBudget,
  waterColumnTrajectory,
} from './force-contract.js';
import {
  clamp,
  cogwheelRootRadius,
  cogwheelWorldFrame,
  dotVector,
  inverseTransformDirection,
  inverseTransformPoint,
  inverseQuaternion,
  materialProfile,
  multiplyQuaternion as mechanicsMultiplyQuaternion,
  normalizeAngle,
  normalizeVector,
  resolveLatchTransition,
  resolveMechanicalGate,
  rotateVector,
  scaleVector,
  signedTwistAngle,
  subtractVector,
  transformDirection,
  transformPoint,
  vectorLength,
} from '../../../src/mechanics-engine/index.js';
import { evaluateMountedSpellDevices } from '../mechanics/spell-device-system.js';
import { assetDefinitionForId } from '../assets/assetCatalog.js';
import {
  mergePlacementTransform,
  normalizePlacementTransform,
  scaleVectorBy,
  validatePlacementTransformPatch,
  worldAssemblyTransform,
} from '../mechanics/placementTransforms.js';

// Rapier normally owns sleeping. This is a narrowly scoped contact-jitter
// fallback for finite blueprint projectiles only, expressed entirely as a
// physical near-rest state rather than elapsed demo time.
const BLUEPRINT_PROJECTILE_SLEEP_LINEAR_SPEED = 0.01;
const BLUEPRINT_PROJECTILE_SLEEP_ANGULAR_SPEED = 0.01;
const MAIN_WORLD_PLAYER_MOVE_SPEED = 3.15;
// A kinematic character has no gravity of its own. Feed the controller the
// displacement produced by one fixed step of gravity while it is not moving
// upward. With Rapier's configured character mass this produces the same
// mass * gravity support impulse as a 48-unit dynamic body, so spring plates
// and other load-bearing mechanisms feel the player's weight continuously.
const PLAYER_WEIGHT_DISPLACEMENT = 9.81 * MAIN_WORLD_FIXED_DT * MAIN_WORLD_FIXED_DT;
// A spell stream unloads the character's ordinary shoe/ground contact while
// it is pushing. This is kinetic sliding resistance, not the standing 0.72
// contact friction used by the character collider.
const PLAYER_FIELD_SLIDING_FRICTION = 0.2;
const DYNAMIC_LINEAR_DAMPING = 0.2;
const DYNAMIC_ANGULAR_DAMPING = 0.5;
const DYNAMIC_PLACEMENT_FRICTION = 0.8;
const DYNAMIC_PLACEMENT_RESTITUTION = 0.05;
const GROUND_FRICTION = 0.8;
const GROUND_RESTITUTION = 0.05;

const PLACEMENT_KIND_ALIASES = Object.freeze({
  spell: 'spell',
  spellpad: 'spell',
  'placed-spell': 'spell',
  asset: 'asset',
  'placed-asset': 'asset',
  'asset-placement': 'asset',
  'asset-manager': 'asset',
  'mechanics-build': 'mechanics-build',
  mechanics: 'mechanics-build',
  blueprint: 'mechanics-build',
  'placed-mechanics': 'mechanics-build',
  'mechanics-library': 'mechanics-build',
  prop: 'prop',
  'scene-prop': 'prop',
  'practice-cube': 'prop',
});

function normalizePlacementKind(kind) {
  return PLACEMENT_KIND_ALIASES[String(kind ?? '').toLowerCase()] ?? null;
}

export const MAIN_WORLD_PLAYER_CONFIG = Object.freeze({
  height: 1.575,
  radius: 0.28,
  capsuleHalfHeight: 0.5075,
  offset: 0.02,
  mass: 48,
  // Walk through ordinary stair/curb-sized rises without requiring a jump.
  // The atelier entrance now rises in shallow 8 cm increments to a 0.32 m
  // landing, while obstacles above this shin-height envelope remain jump-gated.
  autostepMaxHeight: 0.22,
  autostepMinWidth: 0.25,
  autostepIncludesDynamicBodies: false,
  snapToGroundDistance: 0.18,
  maxSlopeClimbAngle: (50 * Math.PI) / 180,
  minSlopeSlideAngle: (55 * Math.PI) / 180,
  slide: true,
  applyImpulsesToDynamicBodies: true,
});

export class MainWorldRapierRuntime {
  constructor(rapier, options = {}) {
    this.R = rapier;
    this.world = new rapier.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = MAIN_WORLD_FIXED_DT;
    this.accumulator = 0;
    this.elapsedSeconds = 0;
    this.stepCount = 0;
    this.bodies = new Map();
    this.gravityBodies = new Map();
    this.gravityPlacementRecords = new Map();
    this.placedAssets = [];
    this.placedAssetIds = new Set();
    this.placedAssetStructureSignatures = new Map();
    this.fields = new Map();
    this.spellBindings = new Map();
    this.generatedLevitationBodies = new Map();
    this.earthColumnBodies = new Map();
    this.rejectedFields = [];
    this.forceApplications = [];
    this.blockedSignals = [];
    this.forceBudgetByBody = new Map();
    this.structureSignature = '';
    this.sceneProps = [];
    this.sceneSources = [];
    // Blueprint records deliberately live in this world.  Do not replace this
    // with RapierMechanicsWorld: the main scene owns the only Rapier World and
    // calls World.step exactly once from _fixedStep.
    this.blueprint = null;
    this.blueprintBodyIds = new Set();
    this.blueprintJoints = new Map();
    this.blueprintMeshSupports = new Map();
    this.blueprintSprings = [];
    this.blueprintRotationTrackers = new Map();
    this.blueprintContinuousIds = new Set();
    this.blueprintSensors = new Map();
    this.blueprintLatches = new Map();
    this.blueprintAuxiliaryBodies = new Set();
    this.blueprintColliderInfo = new Map();
    this.blueprintGateStates = new Map();
    this.blueprintCouplingStates = new Map();
    this.blueprintTriggerEvents = [];
    this.blueprintSpellDevices = [];
    this.blueprintFields = [];
    this.blueprintEarthFieldStates = new Map();
    this.eventQueue = new rapier.EventQueue(true);
    this.playerRecord = null;
    this.playerController = null;
    this.playerRequestedTranslation = { x: 0, y: 0, z: 0 };
    this.playerRequestSerial = 0;
    this.playerRequestSource = null;
    this.playerLastRequest = { x: 0, y: 0, z: 0 };
    this.playerLastComputed = { x: 0, y: 0, z: 0 };
    this.playerLastCollisions = [];
    this.playerLastGrounded = false;
    this.playerDemandReason = null;
    this.playerNeedsStep = true;
    this.playerPushedBodyIds = new Set();
    this.playerSupport = null;
    this.playerFieldVelocity = { x: 0, y: 0, z: 0 };
    this.playerEarthCarryTranslation = { x: 0, y: 0, z: 0 };
    this.onEarthBlocked = options.onEarthBlocked ?? null;
    this.syncBodies(options.props ?? [], options.sources ?? []);
    this.syncPlacedAssets(options.placedAssets ?? []);
    this._createPlayer(options.playerState);
    this.syncSpells(options.placedSpells ?? []);
    if (options.placedMechanicsBuilds?.length) {
      this.syncBlueprints(options.placedMechanicsBuilds);
    } else {
      this.syncBlueprint(options.blueprint ?? null);
    }
  }

  dispose() {
    for (const record of this.earthColumnBodies.values()) {
      if (record.body?.isValid()) this.world?.removeRigidBody(record.body);
    }
    this.earthColumnBodies.clear();
    for (const record of this.generatedLevitationBodies.values()) {
      if (record.body?.isValid()) this.world?.removeRigidBody(record.body);
    }
    this.generatedLevitationBodies.clear();
    this.eventQueue?.free();
    this.eventQueue = null;
    this.world?.free();
    this.world = null;
    this.bodies.clear();
    this.gravityBodies.clear();
    this.gravityPlacementRecords.clear();
    this.placedAssets = [];
    this.placedAssetIds.clear();
    this.placedAssetStructureSignatures.clear();
    this.fields.clear();
    this.spellBindings.clear();
    this.playerController?.free?.();
    this.playerController = null;
    this.playerRecord = null;
    this.playerPushedBodyIds.clear();
    this.playerSupport = null;
    this.playerFieldVelocity = { x: 0, y: 0, z: 0 };
    this.playerEarthCarryTranslation = { x: 0, y: 0, z: 0 };
  }

  cameraObstructionDistance(origin, direction, maxDistance) {
    const distance = Number(maxDistance);
    if (!this.world || !Number.isFinite(distance) || distance <= 0) return null;
    const ray = new this.R.Ray(origin, direction);
    const hit = this.world.castRay(
      ray,
      distance,
      true,
      undefined,
      undefined,
      this.playerRecord?.collider ?? undefined,
    );
    return hit ? hit.timeOfImpact : null;
  }

  syncBlueprint(blueprint) {
    if (!blueprint) {
      this._unloadBlueprint();
      return;
    }
    const document = blueprint?.document ?? blueprint ?? null;
    const identity = blueprint?.blueprintId ?? document?.metadata?.name ?? null;
    if (!document || !identity) {
      this._unloadBlueprint();
      return;
    }
    const signature = JSON.stringify(document);
    if (this.blueprint?.signature === signature) return;
    this._unloadBlueprint();
    this.blueprint = { identity, signature, document };
    this._buildBlueprintDocument(document);
  }

  syncBlueprints(placements = []) {
    const normalizedPlacements = (placements ?? [])
      .filter((placement) => placement?.document)
      .map((placement, index) => ({
        ...placement,
        id: placement.id ?? placement.blueprintId ?? `blueprint:${index + 1}`,
        transform: normalizePlacementTransform(placement.transform),
      }));
    const document = composePlacedMechanicsDocument(normalizedPlacements);
    if (!document) {
      this._unloadBlueprint();
      return;
    }
    const signature = JSON.stringify({ placements: normalizedPlacements, document });
    if (this.blueprint?.signature === signature) return;
    if (this._canUpdateBlueprintPlacementPoses(normalizedPlacements)) {
      this._applyBlueprintPlacementPoses(normalizedPlacements, document, signature);
      return;
    }
    this._unloadBlueprint();
    this.blueprint = {
      identity: 'placed-mechanics',
      signature,
      document,
      placements: normalizedPlacements,
    };
    this._buildBlueprintDocument(document);
  }

  _buildBlueprintDocument(document) {
    for (const assembly of document.assemblies ?? []) this._createBlueprintAssembly(assembly);
    for (const constraint of document.constraints ?? []) this._createBlueprintJoint(constraint);
    this._createBlueprintMeshSupports();
    for (const force of document.forceElements ?? []) this._createBlueprintForce(force);
    for (const sensor of document.sensors ?? []) this._createBlueprintSensor(sensor);
    for (const latch of document.latches ?? []) this._createBlueprintLatch(latch);
    for (const constraint of document.constraints ?? []) {
      if (constraint.drive?.enabled && Math.abs(constraint.drive.targetVelocity ?? 0) > 0.0001) {
        this.blueprintContinuousIds.add(this._blueprintBodyId(constraint.assemblyAId));
        this.blueprintContinuousIds.add(this._blueprintBodyId(constraint.assemblyBId));
      }
    }
    this._updateBlueprintGateStates();
    this._refreshBlueprintFields();
    this._refreshSceneQueries();
  }

  _canUpdateBlueprintPlacementPoses(nextPlacements) {
    const previous = this.blueprint?.placements;
    if (!previous || previous.length !== nextPlacements.length) return false;
    return nextPlacements.every((next) => {
      const prior = previous.find((item) => item.id === next.id);
      if (!prior || JSON.stringify(prior.document) !== JSON.stringify(next.document)) return false;
      if ((prior.affectedByGravity === true) !== (next.affectedByGravity === true)) return false;
      return sameVector(
        normalizePlacementTransform(prior.transform).scale,
        normalizePlacementTransform(next.transform).scale,
      );
    });
  }

  _applyBlueprintPlacementPoses(placements, document, signature) {
    for (const assembly of document.assemblies ?? []) {
      const record = this.bodies.get(this._blueprintBodyId(assembly.assemblyId));
      if (!record) return;
      const body = record.body;
      if (!sameVector(body.translation(), assembly.transform.position)) {
        body.setTranslation(assembly.transform.position, true);
      }
      if (!sameRotation(body.rotation(), assembly.transform.rotation)) {
        body.setRotation(assembly.transform.rotation, true);
      }
      record.sourcePosition = { ...assembly.transform.position };
      record.definition.position = { ...assembly.transform.position };
      record.placementTransform = {
        position: { ...assembly.transform.position },
        rotation: { ...assembly.transform.rotation },
        scale: { x: 1, y: 1, z: 1 },
      };
      if (body.isDynamic()) body.wakeUp?.();
    }
    this.blueprint = {
      ...this.blueprint,
      signature,
      document,
      placements,
    };
    this._refreshBlueprintFields();
    this._refreshSceneQueries();
  }

  _unloadBlueprint() {
    for (const joint of this.blueprintJoints.values()) {
      if (joint.joint?.isValid()) this.world?.removeImpulseJoint(joint.joint, true);
    }
    for (const support of this.blueprintMeshSupports.values()) {
      if (support.joint?.isValid()) this.world?.removeImpulseJoint(support.joint, true);
    }
    for (const latch of this.blueprintLatches.values()) {
      if (latch.joint?.isValid()) this.world?.removeImpulseJoint(latch.joint, true);
    }
    for (const id of this.blueprintBodyIds) {
      const record = this.bodies.get(id);
      if (record) this.world?.removeRigidBody(record.body);
      this.bodies.delete(id);
    }
    for (const body of this.blueprintAuxiliaryBodies) {
      if (body?.isValid()) this.world?.removeRigidBody(body);
    }
    this.blueprint = null;
    this.blueprintBodyIds.clear();
    this.blueprintJoints.clear();
    this.blueprintMeshSupports.clear();
    this.blueprintSprings = [];
    this.blueprintRotationTrackers.clear();
    this.blueprintContinuousIds.clear();
    this.blueprintSensors.clear();
    this.blueprintLatches.clear();
    this.blueprintAuxiliaryBodies.clear();
    this.blueprintColliderInfo.clear();
    this.blueprintGateStates.clear();
    this.blueprintCouplingStates.clear();
    this.blueprintTriggerEvents = [];
    this.blueprintSpellDevices = [];
    this.blueprintFields = [];
    for (const fieldId of this.blueprintEarthFieldStates.keys()) {
      const column = this.earthColumnBodies.get(fieldId);
      if (column?.body?.isValid()) this.world?.removeRigidBody(column.body);
      this.earthColumnBodies.delete(fieldId);
    }
    this.blueprintEarthFieldStates.clear();
  }

  setBlockedHandler(handler) {
    this.onEarthBlocked = handler ?? null;
  }

  setDemandReason(reason) {
    this.playerDemandReason = reason ?? null;
  }

  /**
   * Synchronize Asset Manager placements into the main-world Rapier world.
   * Transform-only changes update the existing body; geometry or body-mode
   * changes rebuild that placement's colliders without touching other bodies.
   */
  syncPlacedAssets(assets = []) {
    if (!this.world) return;
    const normalized = (assets ?? [])
      .filter((asset) => asset?.id && assetDefinitionForId(asset.assetDefinitionId ?? asset.definitionId ?? asset.assetId))
      .map((asset) => ({ ...asset, transform: normalizePlacementTransform(asset.transform) }));
    const nextIds = new Set(normalized.map((asset) => asset.id));
    let changed = false;
    for (const id of this.placedAssetIds) {
      if (nextIds.has(id)) continue;
      this._removePlacedAssetBody(id);
      changed = true;
    }
    for (const asset of normalized) {
      const definition = assetDefinitionForId(asset.assetDefinitionId ?? asset.definitionId ?? asset.assetId);
      const bodyId = placedAssetBodyId(asset.id);
      const structureSignature = JSON.stringify({
        definitionId: definition.id,
        bodyMode: placedAssetBodyMode(asset),
        mass: Number(asset.mass ?? 4),
        collider: asset.collider ?? null,
        size: definition.size,
      });
      const record = this.bodies.get(bodyId);
      if (!record || this.placedAssetStructureSignatures.get(asset.id) !== structureSignature) {
        this._removePlacedAssetBody(asset.id);
        this._createPlacedAssetBody(asset, definition, bodyId, structureSignature);
        changed = true;
        continue;
      }
      const nextTransform = normalizePlacementTransform(asset.transform);
      if (!samePlacementTransform(record.placementTransform, nextTransform)) {
        this._applyPlacementBodyTransform(record, nextTransform);
        changed = true;
      }
    }
    this.placedAssets = normalized;
    this.placedAssetIds = nextIds;
    this.placedAssetStructureSignatures = new Map(
      normalized.map((asset) => [asset.id, JSON.stringify({
        definitionId: assetDefinitionForId(asset.assetDefinitionId ?? asset.definitionId ?? asset.assetId).id,
        bodyMode: placedAssetBodyMode(asset),
        mass: Number(asset.mass ?? 4),
        collider: asset.collider ?? null,
        size: assetDefinitionForId(asset.assetDefinitionId ?? asset.definitionId ?? asset.assetId).size,
      })]),
    );
    if (changed) this._refreshSceneQueries();
  }

  /**
   * Apply the wrench transform contract directly to a live placement. The
   * controller normally reaches this path through syncPlacedAssets or
   * syncBlueprints, but it is public for a future UI/runtime bridge.
   *
   * @param {{kind: 'spell'|'asset'|'mechanics-build'|'prop', id: string, position?: object, rotation?: object, scale?: number|object}} input
   * @returns {boolean} whether a live placement was found and updated.
   */
  updatePlacementTransform(input = {}) {
    const kind = normalizePlacementKind(input.kind);
    const id = String(input.id ?? '');
    const patch = input.transform
      ? input.transform
      : Object.fromEntries(['position', 'rotation', 'scale']
        .filter((field) => input[field] !== undefined)
        .map((field) => [field, input[field]]));
    const validation = validatePlacementTransformPatch(patch);
    if (!kind || !id || !validation.ok) return false;

    if (kind === 'asset') {
      const asset = this.placedAssets.find((item) => item.id === id);
      if (!asset) return false;
      const next = mergePlacementTransform(asset.transform, patch);
      this.syncPlacedAssets(this.placedAssets.map((item) => item.id === id ? { ...item, transform: next } : item));
      return true;
    }

    if (kind === 'mechanics-build' && this.blueprint?.placements) {
      const placement = this.blueprint.placements.find((item) => item.id === id);
      if (!placement) return false;
      const next = mergePlacementTransform(placement.transform, patch);
      this.syncBlueprints(this.blueprint.placements.map((item) => item.id === id ? { ...item, transform: next } : item));
      return true;
    }

    if (kind === 'prop') {
      const prop = this.sceneProps.find((item) => item.id === id);
      if (!prop) return false;
      const centerOffset = mainWorldPropCenterOffset(prop);
      const current = normalizePlacementTransform({
        position: {
          x: Number(prop.position?.x ?? 0),
          y: Number(prop.position?.y ?? 0) + centerOffset,
          z: Number(prop.position?.z ?? 0),
        },
        rotation: prop.rotation,
        scale: prop.scale,
      });
      const next = mergePlacementTransform(current, patch);
      this.syncBodies(this.sceneProps.map((item) => item.id === id
        ? {
            ...item,
            position: {
              x: next.position.x,
              y: next.position.y - centerOffset,
              z: next.position.z,
            },
            rotation: next.rotation,
            scale: next.scale,
          }
        : item), this.sceneSources);
      return true;
    }

    if (kind === 'spell') {
      const gravity = this.gravityPlacementRecords.get(id);
      if (!gravity) return false;
      const next = mergePlacementTransform(gravity.placementTransform, patch);
      const bodyPosition = patch.position ?? copyVector(gravity.body.translation());
      const bodyRotation = patch.rotation ?? copyRotation(gravity.body.rotation());
      const halfExtents = scaleVectorBy(gravity.baseHalfExtents, next.scale);
      this.updateGravityPlacement(id, bodyPosition, bodyRotation, halfExtents, gravity.mass, { transform: next });
      return true;
    }
    return false;
  }

  _createPlacedAssetBody(asset, definition, bodyId, structureSignature) {
    const transform = normalizePlacementTransform(asset.transform);
    const bodyMode = placedAssetBodyMode(asset);
    const descriptor = bodyMode === 'fixed' ? this.R.RigidBodyDesc.fixed() : this.R.RigidBodyDesc.dynamic();
    descriptor
      .setTranslation(transform.position.x, transform.position.y, transform.position.z)
      .setRotation(transform.rotation);
    if (bodyMode === 'dynamic') {
      descriptor
        .setLinearDamping(DYNAMIC_LINEAR_DAMPING)
        .setAngularDamping(DYNAMIC_ANGULAR_DAMPING)
        .setCcdEnabled(true);
    }
    const id = bodyId;
    descriptor.setUserData({ mainWorldBodyId: id, role: 'placed_asset', placementKind: 'asset', placementId: asset.id });
    const body = this.world.createRigidBody(descriptor);
    const colliderDefinitions = placedAssetColliderDefinitions(asset, definition);
    const record = {
      body,
      definition: {
        id,
        sourceId: asset.id,
        renderName: `placed-asset:${asset.id}`,
        role: 'placed_asset',
        bodyMode,
        mass: Math.max(0.05, Number(asset.mass ?? 4)),
        materialId: asset.materialId ?? definition.materialId,
        position: { ...transform.position },
        collider: colliderDefinitions[0],
      },
      sourcePosition: { ...transform.position },
      boundingRadius: Math.max(definition.size?.x ?? 0.5, definition.size?.y ?? 0.5, definition.size?.z ?? 0.5),
      placementKind: 'asset',
      placementId: asset.id,
      placementTransform: transform,
      colliderDefinitions,
      colliderScale: transform.scale,
      colliders: [],
    };
    this._rebuildPlacementColliders(record);
    this.bodies.set(id, record);
    this.placedAssetStructureSignatures.set(asset.id, structureSignature);
  }

  _removePlacedAssetBody(assetId) {
    const bodyId = placedAssetBodyId(assetId);
    const record = this.bodies.get(bodyId);
    if (!record) return;
    this._removeBodyRecord(record);
    this.bodies.delete(bodyId);
    this.placedAssetStructureSignatures.delete(assetId);
  }

  _removeBodyRecord(record) {
    for (const collider of record.colliders ?? []) this.world?.removeCollider(collider, true);
    this.world?.removeRigidBody(record.body);
  }

  _rebuildPlacementColliders(record) {
    for (const collider of record.colliders ?? []) this.world?.removeCollider(collider, true);
    record.colliders = [];
    const material = materialProfile(record.materialId ?? record.definition.materialId ?? 'material.wood_light');
    for (const childDefinition of record.colliderDefinitions ?? []) {
      const collider = colliderDescriptor(this.R, scaleColliderDefinition(childDefinition, record.placementTransform?.scale));
      if (record.body.isDynamic()) {
        collider.setFriction(DYNAMIC_PLACEMENT_FRICTION).setRestitution(DYNAMIC_PLACEMENT_RESTITUTION);
      } else {
        collider.setFriction(material.friction ?? 0.68).setRestitution(material.restitution ?? 0.08);
      }
      if (record.body.isDynamic()) collider.setMass(record.definition.mass ?? 4);
      record.colliders.push(this.world.createCollider(collider, record.body));
    }
    record.colliderScale = { ...record.placementTransform.scale };
  }

  _applyPlacementBodyTransform(record, transform) {
    const previous = record.placementTransform ?? normalizePlacementTransform();
    if (!sameVector(previous.position, transform.position)) {
      record.body.setTranslation(transform.position, true);
    }
    if (!sameRotation(previous.rotation, transform.rotation)) {
      record.body.setRotation(transform.rotation, true);
    }
    if (!sameVector(previous.scale, transform.scale)) {
      record.placementTransform = transform;
      this._rebuildPlacementColliders(record);
    } else {
      record.placementTransform = transform;
    }
    record.sourcePosition = { ...transform.position };
    record.definition.position = { ...transform.position };
    if (record.body.isDynamic()) record.body.wakeUp?.();
  }

  syncBodies(props = [], sources = []) {
    if (!this.world) return;
    this.sceneProps = props;
    this.sceneSources = sources;
    const definitions = [
      ...MAIN_WORLD_BUILTIN_BODIES,
      ...sources.map(mainWorldBodyForSource),
      ...props.map(mainWorldBodyForProp),
    ];
    const signature = definitions.map((item) => [
      item.id,
      item.mass,
      item.collider.shape,
    ].join(':')).join('|');
    if (signature !== this.structureSignature) {
      // Props can be added while a blueprint is running. Rebuild its owned
      // bodies through this same world after the base scene is rebuilt; never
      // leave stale joints pointing at freed Rapier bodies.
      const blueprintToRestore = this.blueprint?.placements
        ? { placements: this.blueprint.placements }
        : this.blueprint
          ? { blueprintId: this.blueprint.identity, document: this.blueprint.document }
          : null;
      const assetsToRestore = this.placedAssets;
      if (blueprintToRestore) this._unloadBlueprint();
      for (const record of this.bodies.values()) this.world.removeRigidBody(record.body);
      this.bodies.clear();
      for (const definition of definitions) this._createBody(definition);
      this.structureSignature = signature;
      if (assetsToRestore.length) this.syncPlacedAssets(assetsToRestore);
      if (blueprintToRestore?.placements) this.syncBlueprints(blueprintToRestore.placements);
      else if (blueprintToRestore) this.syncBlueprint(blueprintToRestore);
      this._refreshSceneQueries();
      return;
    }

    let movedBody = false;
    for (const definition of definitions) {
      const record = this.bodies.get(definition.id);
      if (!record) continue;
      const colliderChanged = !sameColliderDefinition(record.definition.collider, definition.collider);
      const bodyModeChanged = record.definition.bodyMode !== definition.bodyMode;
      if (!sameVector(definition.position, record.sourcePosition)) {
        record.body.setTranslation(definition.position, true);
        record.sourcePosition = { ...definition.position };
        movedBody = true;
      }
      const nextRotation = definition.rotation ?? identityQuaternion();
      if (!sameRotation(nextRotation, record.sourceRotation ?? identityQuaternion())) {
        record.body.setRotation(nextRotation, true);
        record.sourceRotation = { ...nextRotation };
        movedBody = true;
      }
      if (colliderChanged) {
        this._rebuildBodyColliders(record, definition);
        movedBody = true;
      }
      if (bodyModeChanged) {
        this._setBodyMode(record, definition);
        movedBody = true;
      }
      record.definition = definition;
      if (definition.scale) {
        record.placementTransform = normalizePlacementTransform({
          position: definition.position,
          rotation: nextRotation,
          scale: definition.scale,
        });
      }
    }
    if (movedBody) this._refreshSceneQueries();
  }

  setPlayerRequest(translation = { x: 0, y: 0, z: 0 }, source = 'external') {
    if (source === 'input' && this.playerRequestSource === 'external' && this.hasPlayerRequest()) return;
    this.playerRequestedTranslation = {
      x: Number(translation.x ?? 0),
      y: Number(translation.y ?? 0),
      z: Number(translation.z ?? 0),
    };
    this.playerRequestSerial += 1;
    this.playerRequestSource = source;
  }

  teleportPlayer(position = {}) {
    if (!this.playerRecord) return;
    const x = Number(position.x ?? this.playerRecord.footPosition.x);
    const z = Number(position.z ?? this.playerRecord.footPosition.z);
    const y = Number(position.y ?? terrainHeightAt(x, z));
    const footPosition = { x, y, z };
    this.playerRecord.body.setTranslation({ x, y: y + MAIN_WORLD_PLAYER_CONFIG.height / 2, z }, true);
    this.playerRecord.footPosition = footPosition;
    this.playerRequestedTranslation = { x: 0, y: 0, z: 0 };
    this.playerRequestSource = null;
    this.playerLastRequest = { x: 0, y: 0, z: 0 };
    this.playerLastComputed = { x: 0, y: 0, z: 0 };
    this.playerSupport = null;
    this.playerFieldVelocity = { x: 0, y: 0, z: 0 };
    this.world.propagateModifiedBodyPositionsToColliders?.();
    this._refreshSceneQueries();
    this.playerDemandReason = 'teleport';
  }

  hasPlayerRequest() {
    return this.playerNeedsStep
      || Math.abs(this.playerRequestedTranslation.x) > 0.000001
      || Math.abs(this.playerRequestedTranslation.y) > 0.000001
      || Math.abs(this.playerRequestedTranslation.z) > 0.000001
      || length(this.playerFieldVelocity) > 0.000001;
  }

  hasAwakeDynamicBody() {
    return [...this.bodies.values()].some((record) => record.body.isDynamic() && !record.body.isSleeping())
      || [...this.gravityBodies.values()].some((body) => body.isDynamic() && !body.isSleeping())
      || [...this.generatedLevitationBodies.values()].some((record) => !record.body.isSleeping());
  }

  // Per-placement gravity bodies. A placed spell flagged "affected by gravity"
  // gets a real dynamic rigid body so it can tip, fall, and be pushed by the
  // player character controller (which collides with every collider in the
  // world). Kept in a separate map so prop/source resyncs never free them.
  ensureGravityPlacement(id, position, rotation, halfExtents, mass, options = {}) {
    if (!this.world || this.gravityBodies.has(id)) return;
    const R = this.R;
    const descriptor = R.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setLinearDamping(DYNAMIC_LINEAR_DAMPING)
      .setAngularDamping(DYNAMIC_ANGULAR_DAMPING)
      .setCcdEnabled(true);
    if (rotation) descriptor.setRotation(rotation);
    descriptor.setUserData({ mainWorldBodyId: id, role: 'gravity_placement' });
    const body = this.world.createRigidBody(descriptor);
    const collider = R.ColliderDesc
      .cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setMass(Math.max(0.1, mass ?? 6))
      .setFriction(DYNAMIC_PLACEMENT_FRICTION)
      .setRestitution(DYNAMIC_PLACEMENT_RESTITUTION);
    const colliderHandle = this.world.createCollider(collider, body);
    this.gravityBodies.set(id, body);
    this.gravityPlacementRecords.set(id, {
      body,
      collider: colliderHandle,
      halfExtents: { ...halfExtents },
      baseHalfExtents: { ...(options.baseHalfExtents ?? halfExtents) },
      mass: Math.max(0.1, mass ?? 6),
      placementTransform: normalizePlacementTransform({
        position,
        rotation,
        scale: options.scale ?? 1,
      }),
    });
    this._refreshSceneQueries();
  }

  /**
   * Reposition and, when needed, resize a gravity-backed spell placement.
   * Dynamic bodies are explicitly woken so an edit cannot leave a sleeping
   * note at its old pose; collider replacement is isolated to this body.
   */
  updateGravityPlacement(id, position, rotation, halfExtents, mass, options = {}) {
    const record = this.gravityPlacementRecords.get(id);
    const body = record?.body ?? this.gravityBodies.get(id);
    if (!body || !this.world) return false;
    const previousHalfExtents = record?.halfExtents ?? null;
    if (position) body.setTranslation(position, true);
    if (rotation) body.setRotation(rotation, true);
    const nextHalfExtents = {
      x: Number(halfExtents?.x ?? previousHalfExtents?.x ?? 0.7),
      y: Number(halfExtents?.y ?? previousHalfExtents?.y ?? 0.009),
      z: Number(halfExtents?.z ?? previousHalfExtents?.z ?? 0.7),
    };
    const changedScale = !previousHalfExtents || !sameVector(previousHalfExtents, nextHalfExtents);
    if (changedScale) {
      if (record?.collider) this.world.removeCollider(record.collider, true);
      const collider = this.R.ColliderDesc
        .cuboid(nextHalfExtents.x, nextHalfExtents.y, nextHalfExtents.z)
        .setMass(Math.max(0.1, mass ?? record?.mass ?? 6))
        .setFriction(DYNAMIC_PLACEMENT_FRICTION)
        .setRestitution(DYNAMIC_PLACEMENT_RESTITUTION);
      const colliderHandle = this.world.createCollider(collider, body);
      if (record) {
        record.collider = colliderHandle;
        record.halfExtents = nextHalfExtents;
      }
    }
    body.wakeUp?.();
    if (record) {
      record.mass = Math.max(0.1, mass ?? record.mass ?? 6);
      record.placementTransform = options.transform ?? normalizePlacementTransform({
        position: position ?? body.translation(),
        rotation: rotation ?? body.rotation(),
        scale: options.scale ?? record.placementTransform.scale,
      });
    }
    this.world.propagateModifiedBodyPositionsToColliders?.();
    this._refreshSceneQueries();
    return true;
  }

  removeGravityPlacement(id) {
    const body = this.gravityBodies.get(id);
    if (!body) return;
    // resetForces/resetTorques before removal is defensive against the Rapier
    // persistent-force gotcha for any future force application on these bodies.
    body.resetForces?.(false);
    body.resetTorques?.(false);
    this.gravityPlacementRecords.delete(id);
    this.world?.removeRigidBody(body);
    this.gravityBodies.delete(id);
  }

  hasGravityPlacement(id) {
    return this.gravityBodies.has(id);
  }

  gravityPlacementTransform(id) {
    const body = this.gravityBodies.get(id);
    if (!body) return null;
    return { position: copyVector(body.translation()), rotation: copyRotation(body.rotation()) };
  }

  syncSpells(placedSpells = []) {
    const previousBindings = this.spellBindings;
    this.spellBindings = new Map((placedSpells ?? []).flatMap((spell) => {
      const bodyId = placedSpellMountBodyId(spell);
      if (!bodyId) return [];
      const previous = previousBindings.get(spell.id);
      if (previous?.bodyId === bodyId) return [[spell.id, previous]];
      return [[spell.id, this._mountBindingForBodyId(bodyId) ?? { bodyId }]];
    }));
    const { fields, rejected } = buildMainWorldSpellFields(placedSpells);
    const next = new Map();
    for (const definition of fields) {
      const previous = this.fields.get(definition.id);
      const sameActivation = previous?.activationInstanceId === definition.activationInstanceId;
      const sameMount = previous?.mountBodyId === definition.mountBodyId;
      const state = sameActivation
        ? {
            ...previous,
            ...definition,
            mountBinding: sameMount
              ? previous.mountBinding
              : this._mountBinding(definition),
          }
        : {
            ...definition,
            emergenceElapsed: 0,
            emergedLength: 0,
            emergenceProgress: 0,
            blockedSignaled: false,
            interception: null,
            dispersionContacts: null,
            mountBinding: this._mountBinding(definition),
          };
      if (!definition.active) {
        state.blockedSignaled = false;
        state.interception = null;
        state.dispersionContacts = null;
      }
      next.set(definition.id, state);
    }
    this.fields = next;
    for (const [fieldId, record] of this.earthColumnBodies) {
      const field = next.get(fieldId);
      if (field?.active && field.fieldShape === 'earth_emergence') continue;
      if (record.body?.isValid()) this.world?.removeRigidBody(record.body);
      this.earthColumnBodies.delete(fieldId);
    }
    this.rejectedFields = rejected;
    this._syncGeneratedLevitationBodies();
  }

  step(deltaSeconds) {
    if (!this.world) return this.getSnapshot();
    this.accumulator += Math.min(MAIN_WORLD_MAX_FRAME_DT, Math.max(0, Number(deltaSeconds ?? 0)));
    let steps = 0;
    while (this.accumulator >= MAIN_WORLD_FIXED_DT && steps < MAIN_WORLD_MAX_SUBSTEPS) {
      this._fixedStep();
      this.accumulator -= MAIN_WORLD_FIXED_DT;
      this.elapsedSeconds += MAIN_WORLD_FIXED_DT;
      this.stepCount += 1;
      steps += 1;
    }
    if (steps === MAIN_WORLD_MAX_SUBSTEPS && this.accumulator >= MAIN_WORLD_FIXED_DT) {
      this.accumulator = Math.min(this.accumulator, MAIN_WORLD_FIXED_DT);
    }
    return this.getSnapshot();
  }

  getSnapshot() {
    const bodies = {};
    for (const [id, record] of this.bodies) {
      const translation = record.body.translation();
      const rotation = record.body.rotation();
      bodies[id] = {
        id,
        renderName: record.definition.renderName,
        sourceId: record.definition.sourceId ?? null,
        role: record.definition.role,
        placementKind: record.placementKind ?? null,
        placementId: record.placementId ?? null,
        earthCarried: record.earthCarried === true,
        bodyMode: record.definition.bodyMode,
        mass: record.body.isDynamic() ? record.body.mass() : 0,
        sleeping: record.body.isDynamic() ? record.body.isSleeping() : false,
        position: copyVector(translation),
        rotation: copyRotation(rotation),
        scale: record.placementTransform?.scale ?? null,
        linearVelocity: copyVector(record.body.linvel()),
        angularVelocity: copyVector(record.body.angvel()),
      };
    }
    for (const [fieldId, record] of this.generatedLevitationBodies) {
      const translation = record.body.translation();
      const rotation = record.body.rotation();
      bodies[`generated:${fieldId}`] = {
        id: `generated:${fieldId}`,
        renderName: record.renderName,
        sourceId: fieldId,
        role: 'generated_levitation_orb',
        bodyMode: 'dynamic',
        collisionMode: record.collisionMode,
        mass: record.body.mass(),
        sleeping: record.body.isSleeping(),
        position: copyVector(translation),
        rotation: copyRotation(rotation),
        scale: { x: 1, y: 1, z: 1 },
        linearVelocity: copyVector(record.body.linvel()),
        angularVelocity: copyVector(record.body.angvel()),
      };
    }
    for (const [fieldId, record] of this.earthColumnBodies) {
      const translation = record.body.translation();
      const rotation = record.body.rotation();
      bodies[`earth-column:${fieldId}`] = {
        id: `earth-column:${fieldId}`,
        renderName: null,
        sourceId: fieldId,
        role: 'earth_spell_column',
        bodyMode: 'kinematic_position_based',
        mass: 0,
        sleeping: false,
        position: copyVector(translation),
        rotation: copyRotation(rotation),
        scale: { x: record.radius, y: record.length, z: record.radius },
        linearVelocity: { x: 0, y: 0, z: 0 },
        angularVelocity: { x: 0, y: 0, z: 0 },
      };
    }
    const player = this._playerSnapshot();
    const gravityBodies = {};
    for (const [id, body] of this.gravityBodies) {
      gravityBodies[id] = {
        id,
        role: 'gravity_placement',
        placementKind: 'spell',
        placementId: id,
        bodyMode: 'dynamic',
        mass: body.mass(),
        sleeping: body.isSleeping(),
        position: copyVector(body.translation()),
        rotation: copyRotation(body.rotation()),
        linearVelocity: copyVector(body.linvel()),
        angularVelocity: copyVector(body.angvel()),
        scale: this.gravityPlacementRecords.get(id)?.placementTransform?.scale ?? null,
      };
    }
    return {
      ready: Boolean(this.world),
      fixedDt: MAIN_WORLD_FIXED_DT,
      maxSubsteps: MAIN_WORLD_MAX_SUBSTEPS,
      stepCount: this.stepCount,
      elapsedSeconds: this.elapsedSeconds,
      bodyCount: this.bodies.size + this.gravityBodies.size + this.generatedLevitationBodies.size + this.earthColumnBodies.size,
      dynamicBodyCount: [...this.bodies.values()].filter((item) => item.body.isDynamic()).length
        + this.gravityBodies.size
        + this.generatedLevitationBodies.size,
      fixedBodyCount: [...this.bodies.values()].filter((item) => !item.body.isDynamic()).length
        + this.earthColumnBodies.size,
      bodies,
      gravityBodies,
      player,
      demand: {
        reason: this.playerDemandReason,
        playerRequest: this.hasPlayerRequest(),
        awakeDynamicBody: this.hasAwakeDynamicBody(),
        activeField: [...this.fields.values()].some((field) => field.active),
        continuousBlueprint: this.blueprintFields.length > 0,
      },
      fields: [...this.fields.values()].map((field) => ({
        id: field.id,
        placedSpellId: field.placedSpellId,
        materialKind: field.materialKind,
        fieldShape: field.fieldShape,
        active: field.active,
        length: field.length ?? null,
        radius: field.radius ?? null,
        innerRadius: field.innerRadius ?? null,
        outerRadius: field.outerRadius ?? null,
        mountBodyId: field.mountBodyId,
        emergenceProgress: field.emergenceProgress,
        interception: field.interception ? { ...field.interception } : null,
        dispersionContacts: field.dispersionContacts
          ? {
              ...field.dispersionContacts,
              quadrants: field.dispersionContacts.quadrants.map((contact) => ({ ...contact })),
            }
          : null,
        pushLimit: field.fieldShape === 'earth_emergence' ? earthColumnPushLimit(field) : null,
      })),
      rejectedFields: [...this.rejectedFields],
      forceApplications: this.forceApplications.map((item) => ({ ...item })),
      blockedSignals: this.blockedSignals.map((item) => ({ ...item })),
      aggregateForceCap: MAIN_WORLD_FORCE_BUDGET,
      blueprint: this.blueprint ? {
        id: this.blueprint.identity,
        name: this.blueprint.document.metadata?.name ?? 'Blueprint',
        bodyCount: this.blueprintBodyIds.size,
        jointCount:
          this.blueprintJoints.size +
          this.blueprintMeshSupports.size +
          this.blueprintSprings.filter((item) => item.definition.type === 'linear_spring').length +
          [...this.blueprintLatches.values()].filter((item) => item.joint).length,
        deviceFieldCount: this.blueprintFields.length,
        constraints: Object.fromEntries(
          [...this.blueprintJoints].map(([constraintId, runtime]) => [
            constraintId,
            { type: runtime.definition.type, ...this._blueprintJointState(constraintId) },
          ]),
        ),
        sensors: Object.fromEntries(
          [...this.blueprintSensors].map(([sensorId, runtime]) => [
            sensorId,
            {
              touching: [...runtime.touching],
              active: runtime.touching.size > 0,
              fired: runtime.fired,
            },
          ]),
        ),
        latches: Object.fromEntries(
          [...this.blueprintLatches].map(([latchId, runtime]) => [
            latchId,
            {
              state: runtime.state,
              releasedAt: runtime.releasedAt,
              catchArmed: runtime.catchArmed,
            },
          ]),
        ),
        gates: Object.fromEntries(this.blueprintGateStates),
        couplings: Object.fromEntries(this.blueprintCouplingStates),
        triggerEvents: [...this.blueprintTriggerEvents],
        spellDevices: this.blueprintSpellDevices.map(blueprintSpellDeviceSnapshot),
      } : null,
    };
  }

  mountedTransformForSpell(placedSpellId) {
    const bindingRecord = this.spellBindings.get(placedSpellId);
    if (!bindingRecord) return null;
    let binding = bindingRecord;
    if (!binding.baseMountPosition) {
      binding = this._mountBindingForBodyId(binding.bodyId);
      if (!binding) return null;
      this.spellBindings.set(placedSpellId, binding);
    }
    const mount = this.bodies.get(binding.bodyId)?.body;
    if (!mount) return null;
    return transformDelta(binding.baseMountPosition, binding.baseMountRotation, mount.translation(), mount.rotation());
  }

  _createBody(definition) {
    const R = this.R;
    const descriptor = definition.bodyMode === 'fixed' ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.dynamic();
    descriptor.setTranslation(definition.position.x, definition.position.y, definition.position.z);
    if (definition.rotation) descriptor.setRotation(definition.rotation);
    else if (definition.rotationY) descriptor.setRotation(yawQuaternion(definition.rotationY));
    descriptor.setUserData({ mainWorldBodyId: definition.id, role: definition.role });
    if (definition.bodyMode === 'dynamic') {
      descriptor
        .setLinearDamping(DYNAMIC_LINEAR_DAMPING)
        .setAngularDamping(DYNAMIC_ANGULAR_DAMPING)
        .setCcdEnabled(true);
    }
    const body = this.world.createRigidBody(descriptor);
    const colliders = this._createBodyColliders(body, definition);
    this.bodies.set(definition.id, {
      body,
      colliders,
      definition,
      placementKind: definition.placementKind ?? null,
      placementId: definition.placementId ?? null,
      placementTransform: definition.scale ? normalizePlacementTransform({
        position: definition.position,
        rotation: definition.rotation,
        scale: definition.scale,
      }) : null,
      sourcePosition: { ...definition.position },
      sourceRotation: { ...(definition.rotation ?? identityQuaternion()) },
      boundingRadius: bodyBoundingRadius(definition),
    });
  }

  _createBodyColliders(body, definition) {
    const colliders = [];
    const colliderDefinitions = definition.collider?.shape === 'compound'
      ? definition.collider.parts ?? []
      : [definition.collider];
    for (const childDefinition of colliderDefinitions) {
      const collider = colliderDescriptor(this.R, childDefinition);
      if (childDefinition.position) collider.setTranslation(
        childDefinition.position.x ?? 0,
        childDefinition.position.y ?? 0,
        childDefinition.position.z ?? 0,
      );
      if (childDefinition.rotation) collider.setRotation(childDefinition.rotation);
      else if (childDefinition.rotationY || childDefinition.rotationZ) {
        collider.setRotation(composeEulerQuaternion(0, childDefinition.rotationY ?? 0, childDefinition.rotationZ ?? 0));
      }
      if (definition.bodyMode === 'dynamic') {
        collider
          .setFriction(DYNAMIC_PLACEMENT_FRICTION)
          .setRestitution(DYNAMIC_PLACEMENT_RESTITUTION)
          .setMass(Math.max(0.05, definition.mass ?? 4));
      } else if (definition.role === 'terrain') {
        collider.setFriction(GROUND_FRICTION).setRestitution(GROUND_RESTITUTION);
      } else {
        collider.setFriction(0.68);
        collider.setRestitution(definition.role === 'loose_rock' ? 0.18 : 0.08);
      }
      colliders.push(this.world.createCollider(collider, body));
    }
    return colliders;
  }

  _rebuildBodyColliders(record, definition) {
    for (const collider of record.colliders ?? []) this.world.removeCollider(collider, false);
    record.colliders = this._createBodyColliders(record.body, definition);
    record.boundingRadius = bodyBoundingRadius(definition);
    if (record.body.isDynamic()) record.body.wakeUp();
  }

  _setBodyMode(record, definition) {
    const dynamic = definition.bodyMode === 'dynamic';
    const nextType = dynamic ? this.R.RigidBodyType.Dynamic : this.R.RigidBodyType.Fixed;
    if (record.body.bodyType() === nextType) return;
    record.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    record.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    record.body.setBodyType(nextType, true);
    for (const collider of record.colliders ?? []) {
      if (dynamic) {
        collider.setFriction(DYNAMIC_PLACEMENT_FRICTION);
        collider.setRestitution(DYNAMIC_PLACEMENT_RESTITUTION);
        collider.setMass(Math.max(0.05, definition.mass ?? 4));
      } else if (definition.role === 'terrain') {
        collider.setFriction(GROUND_FRICTION).setRestitution(GROUND_RESTITUTION);
      } else {
        collider.setFriction(0.68);
        collider.setRestitution(definition.role === 'loose_rock' ? 0.18 : 0.08);
      }
    }
    if (dynamic) record.body.wakeUp();
  }

  _createPlayer(playerState = null) {
    const x = Number(playerState?.position?.x ?? ATELIER_PLAYTHROUGH.spawn.world.x);
    const z = Number(playerState?.position?.z ?? ATELIER_PLAYTHROUGH.spawn.world.z);
    const y = Number(playerState?.position?.y ?? terrainHeightAt(x, z));
    const descriptor = this.R.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(x, y + MAIN_WORLD_PLAYER_CONFIG.height / 2, z);
    descriptor.setUserData({ mainWorldBodyId: 'player', role: 'player' });
    const body = this.world.createRigidBody(descriptor);
    const collider = this.R.ColliderDesc.capsule(
      MAIN_WORLD_PLAYER_CONFIG.capsuleHalfHeight,
      MAIN_WORLD_PLAYER_CONFIG.radius,
    ).setMass(MAIN_WORLD_PLAYER_CONFIG.mass).setFriction(0.72);
    const colliderHandle = this.world.createCollider(collider, body);
    const controller = this.world.createCharacterController(MAIN_WORLD_PLAYER_CONFIG.offset);
    controller.setUp({ x: 0, y: 1, z: 0 });
    controller.setSlideEnabled(MAIN_WORLD_PLAYER_CONFIG.slide);
    controller.enableAutostep(
      MAIN_WORLD_PLAYER_CONFIG.autostepMaxHeight,
      MAIN_WORLD_PLAYER_CONFIG.autostepMinWidth,
      MAIN_WORLD_PLAYER_CONFIG.autostepIncludesDynamicBodies,
    );
    controller.enableSnapToGround(MAIN_WORLD_PLAYER_CONFIG.snapToGroundDistance);
    controller.setMaxSlopeClimbAngle(MAIN_WORLD_PLAYER_CONFIG.maxSlopeClimbAngle);
    controller.setMinSlopeSlideAngle(MAIN_WORLD_PLAYER_CONFIG.minSlopeSlideAngle);
    controller.setApplyImpulsesToDynamicBodies(MAIN_WORLD_PLAYER_CONFIG.applyImpulsesToDynamicBodies);
    controller.setCharacterMass(MAIN_WORLD_PLAYER_CONFIG.mass);
    this.playerRecord = {
      body,
      collider: colliderHandle,
      footPosition: { x, y, z },
    };
    this.playerController = controller;
  }

  _playerSnapshot() {
    if (!this.playerRecord || !this.playerController) return null;
    const translation = this.playerRecord.body.translation();
    const footPosition = {
      x: Number(translation.x),
      y: Number(translation.y - MAIN_WORLD_PLAYER_CONFIG.height / 2),
      z: Number(translation.z),
    };
    this.playerRecord.footPosition = footPosition;
    return {
      id: 'player',
      role: 'player',
      bodyMode: 'kinematic_position_based',
      position: footPosition,
      bodyPosition: copyVector(translation),
      grounded: this.playerLastGrounded,
      requestedTranslation: { ...this.playerLastRequest },
      computedMovement: { ...this.playerLastComputed },
      fieldVelocity: { ...this.playerFieldVelocity },
      collisionCount: this.playerLastCollisions.length,
      collisionRoles: this.playerLastCollisions.map((item) => item.role),
      collisions: this.playerLastCollisions.map((item) => ({ ...item })),
      supportBodyId: this.playerSupport?.bodyId ?? null,
      config: { ...MAIN_WORLD_PLAYER_CONFIG },
    };
  }

  _refreshSceneQueries() {
    // Rapier 0.18 updates its shape-query broad phase during World.step and
    // does not expose a separate query-pipeline update. A zero-duration warmup
    // after body creation/authored teleports makes the first real 1/60 step's
    // Earth sweep query current without advancing velocity or simulation time.
    const timestep = this.world.timestep;
    this.world.timestep = 0;
    this.world.step(this.eventQueue);
    this._drainBlueprintCollisionEvents();
    this._updateBlueprintGateStates();
    this.world.timestep = timestep;
  }

  _fixedStep() {
    this.forceApplications = [];
    this.forceBudgetByBody = new Map();
    this.playerEarthCarryTranslation = { x: 0, y: 0, z: 0 };
    for (const record of this.bodies.values()) {
      if (!record.body.isDynamic()) continue;
      record.body.resetForces(false);
      record.body.resetTorques(false);
    }
    // Rapier keeps addForceAtPoint's induced torque until it is explicitly
    // cleared. Gravity placements are separate from authored scene bodies,
    // so they need the same force-and-torque reset path every fixed step.
    for (const body of this.gravityBodies.values()) {
      if (!body.isDynamic()) continue;
      body.resetForces(false);
      body.resetTorques(false);
    }
    for (const field of this.fields.values()) {
      if (!field.active) continue;
      const worldField = this._worldField(field);
      if (worldField.fieldShape === 'earth_emergence') this._applyEarthEmergence(field, worldField);
      else if (worldField.fieldShape === 'column') this._applyColumn(worldField, field);
      else if (worldField.fieldShape === 'dispersion') this._applyDispersion(worldField, field);
      else if (worldField.fieldShape === 'carrier_levitation') this._applyCarrierLevitation(worldField);
    }
    this._updateGeneratedLevitationBodies();
    this._updateBlueprintCatchLatches();
    this._applyBlueprintRotationCouplings();
    this._applyBlueprintMechanics();
    // Device fields are compiled from the shared mechanics document compiler,
    // then consumed by this runtime's existing physicsField loop once.
    for (const field of this.blueprintFields) {
      if (!field.active) continue;
      if (field.fieldShape === 'column') this._applyColumn(field);
      else if (field.fieldShape === 'dispersion') this._applyDispersion(field);
      else if (field.fieldShape === 'earth_emergence') {
        const previous = this.blueprintEarthFieldStates.get(field.id);
        const state = previous
          ? { ...previous, ...field }
          : { ...field, emergenceElapsed: 0, emergedLength: 0, emergenceProgress: 0, blockedSignaled: false };
        this.blueprintEarthFieldStates.set(field.id, state);
        this._applyEarthEmergence(state, field);
      }
      else if (field.fieldShape === 'carrier_levitation') this._applyCarrierLevitation(field);
      else if (field.fieldShape === 'target_force') this._applyBlueprintTargetForce(field);
    }
    const playerContactBodyIds = new Set();
    const playerContactVelocities = new Map();
    if (this.playerController && this.playerRecord) {
      const inputRequested = this.playerRequestedTranslation;
      const fieldTranslation = scale(this.playerFieldVelocity, MAIN_WORLD_FIXED_DT);
      const earthCarryTranslation = this.playerEarthCarryTranslation;
      const supportTranslation = inputRequested.y <= 0
        ? this._playerSupportTranslation()
        : { x: 0, y: 0, z: 0 };
      const upwardEarthCarry = earthCarryTranslation.y > 0.000001;
      const weightTranslation = inputRequested.y <= 0 && !upwardEarthCarry
        ? { x: 0, y: -PLAYER_WEIGHT_DISPLACEMENT, z: 0 }
        : { x: 0, y: 0, z: 0 };
      const requested = add(
        add(add(add(inputRequested, supportTranslation), weightTranslation), fieldTranslation),
        earthCarryTranslation,
      );
      this.playerLastRequest = { ...requested };
      const dynamicVelocitiesBeforeController = new Map(
        [...this.bodies.values()]
          .filter((record) => record.body.isDynamic())
          .map((record) => [record.definition.id, {
            linear: copyVector(record.body.linvel()),
            angular: copyVector(record.body.angvel()),
          }]),
      );
      this.playerController.computeColliderMovement(
        this.playerRecord.collider,
        requested,
        this.R.QueryFilterFlags.EXCLUDE_SENSORS,
      );
      const computed = this.playerController.computedMovement();
      // Rapier's character controller can reject an upward request when the
      // growing Earth collider already overlaps the capsule's upper half. The
      // Earth leading face is the authoritative moving-solid contact in this
      // case: preserve that measured displacement instead of leaving the
      // player at ground level while the visible pillar passes through them.
      const resolvedComputed = upwardEarthCarry
        ? {
            x: computed.x,
            y: Math.max(computed.y, earthCarryTranslation.y),
            z: computed.z,
          }
        : computed;
      this.playerLastComputed = copyVector(resolvedComputed);
      this.playerLastGrounded = this.playerController.computedGrounded();
      const collisions = [];
      let nextSupport = null;
      const playerTranslation = this.playerRecord.body.translation();
      const playerFootPosition = {
        x: Number(playerTranslation.x),
        y: Number(playerTranslation.y - MAIN_WORLD_PLAYER_CONFIG.height / 2),
        z: Number(playerTranslation.z),
      };
      for (let index = 0; index < this.playerController.numComputedCollisions(); index += 1) {
        const collision = this.playerController.computedCollision(index);
        const collider = collision?.collider;
        const data = collider?.parent()?.userData ?? {};
        collisions.push({
          colliderId: data.mainWorldBodyId ?? null,
          role: data.role ?? 'unknown',
          toi: Number(collision?.toi ?? 0),
          normal: copyVector(collision?.normal1 ?? { x: 0, y: 0, z: 0 }),
        });
        const contactBodyId = data.mainWorldBodyId;
        const contactRecord = contactBodyId ? this.bodies.get(contactBodyId) : null;
        if (
          inputRequested.y <= 0
          && Number(collision?.normal1?.y ?? 0) > 0.5
          && contactRecord
          && (!nextSupport || contactRecord.body.isDynamic() || !nextSupport.dynamic)
        ) {
          const transform = {
            position: contactRecord.body.translation(),
            rotation: contactRecord.body.rotation(),
          };
          nextSupport = {
            bodyId: contactBodyId,
            dynamic: contactRecord.body.isDynamic(),
            localPoint: inverseTransformPoint(transform, playerFootPosition),
            worldPoint: copyVector(playerFootPosition),
          };
        }
        if (contactRecord?.body.isDynamic() && !playerContactVelocities.has(contactBodyId)) {
          playerContactBodyIds.add(contactBodyId);
          playerContactVelocities.set(contactBodyId, dynamicVelocitiesBeforeController.get(contactBodyId));
        }
      }
      // Standing weight continuously produces a tiny downward controller
      // request. Do not let that passive terrain contact erase the most recent
      // meaningful wall/prop collision before consumers can observe it.
      const drivenTranslation = add(
        add(add(inputRequested, supportTranslation), fieldTranslation),
        earthCarryTranslation,
      );
      const hasMeaningfulCollision = collisions.some((collision) => collision.role !== 'terrain');
      if (length(drivenTranslation) > 0.000001 || hasMeaningfulCollision) {
        this.playerLastCollisions = collisions;
      }
      const current = this.playerRecord.body.translation();
      this.playerRecord.body.setNextKinematicTranslation({
        x: current.x + resolvedComputed.x,
        y: current.y + resolvedComputed.y,
        z: current.z + resolvedComputed.z,
      });
      this.playerRequestedTranslation = { x: 0, y: 0, z: 0 };
      this.playerRequestSource = null;
      this.playerNeedsStep = false;
      this.playerSupport = this.playerController.computedGrounded() && inputRequested.y <= 0
        ? nextSupport ?? this.playerSupport
        : null;
      this._resolvePlayerFieldVelocity(requested, resolvedComputed);
    }
    this._stabilizePlayerContactBodies(playerContactBodyIds, playerContactVelocities);
    // CharacterController.computeColliderMovement applies its dynamic-body
    // impulse immediately. Stabilize the contact before World.step so an
    // authored body that starts grounded cannot leave the terrain before the
    // grounded/near-rest state is observed.
    this.world.step(this.eventQueue);
    this._drainBlueprintCollisionEvents();
    this._updateBlueprintGateStates();
    this._sleepNearRestPlayerBodies();
    this._sleepNearStaticBlueprintProjectiles();
    this._refreshBlueprintFields();
  }

  _playerSupportTranslation() {
    const support = this.playerSupport;
    if (!support) return { x: 0, y: 0, z: 0 };
    const record = this.bodies.get(support.bodyId);
    if (!record) {
      this.playerSupport = null;
      return { x: 0, y: 0, z: 0 };
    }
    const worldPoint = transformPoint(
      { position: record.body.translation(), rotation: record.body.rotation() },
      support.localPoint,
    );
    const translation = subtractVector(worldPoint, support.worldPoint);
    support.worldPoint = worldPoint;
    return translation;
  }

  _stabilizePlayerContactBodies(bodyIds, velocitiesBeforeContact) {
    if (bodyIds.size === 0) return;
    const fieldDrivenBodies = new Set(this.forceApplications.map((application) => application.bodyId));
    for (const bodyId of bodyIds) {
      const record = this.bodies.get(bodyId);
      const before = velocitiesBeforeContact.get(bodyId);
      if (!record || !before || fieldDrivenBodies.has(bodyId) || !this._isTerrainSupported(record)) continue;
      this.playerPushedBodyIds.add(bodyId);

      const mass = Math.max(0.05, record.body.mass());
      const pushSpeed = MAIN_WORLD_PLAYER_MOVE_SPEED * MAIN_WORLD_PLAYER_CONFIG.mass / (MAIN_WORLD_PLAYER_CONFIG.mass + mass);
      const beforeSpeed = Math.hypot(before.linear.x, before.linear.z);
      const current = record.body.linvel();
      const currentSpeed = Math.hypot(current.x, current.z);
      // A body already moving faster than the player is not a player-push
      // launch. Preserve it for native Rapier/field mechanics to resolve.
      if (beforeSpeed > pushSpeed + 0.05 || currentSpeed <= pushSpeed + 0.000001) continue;

      const scaleFactor = pushSpeed / currentSpeed;
      record.body.setLinvel({
        x: current.x * scaleFactor,
        y: current.y,
        z: current.z * scaleFactor,
      }, true);

      const angular = record.body.angvel();
      const angularSpeed = length(angular);
      const angularLimit = pushSpeed / Math.max(record.boundingRadius, 0.25);
      if (angularSpeed > angularLimit) {
        const angularScale = angularLimit / angularSpeed;
        record.body.setAngvel(scaleVector(angular, angularScale), true);
      }
    }
  }

  _sleepNearRestPlayerBodies() {
    const fieldDrivenBodies = new Set(this.forceApplications.map((application) => application.bodyId));
    for (const bodyId of this.playerPushedBodyIds) {
      const record = this.bodies.get(bodyId);
      if (!record || !record.body.isDynamic() || record.body.isSleeping() || fieldDrivenBodies.has(bodyId)) continue;
      if (!this._isTerrainSupported(record)) continue;
      if (length(record.body.linvel()) > BLUEPRINT_PROJECTILE_SLEEP_LINEAR_SPEED) continue;
      if (length(record.body.angvel()) > BLUEPRINT_PROJECTILE_SLEEP_ANGULAR_SPEED) continue;
      record.body.sleep();
    }
  }

  _isTerrainSupported(record) {
    const translation = record.body.translation();
    const collider = record.definition.collider ?? {};
    const supportHalfHeight = collider.shape === 'ball'
      ? collider.radius
      : collider.shape === 'cylinder'
        ? collider.halfHeight
        : collider.halfExtents?.y ?? 0.5;
    // The capsule radius is the existing gameplay contact envelope. Treat a
    // loose body inside that envelope above the shared terrain plane as
    // ground-supported for the contact stabilizer; gravity then resolves any
    // small authored vertical offset instead of allowing a pushed body to
    // become an unbounded aerial projectile.
    return translation.y - supportHalfHeight <= terrainHeightAt(translation.x, translation.z) + MAIN_WORLD_PLAYER_CONFIG.radius;
  }

  _sleepNearStaticBlueprintProjectiles() {
    for (const id of this.blueprintBodyIds) {
      const record = this.bodies.get(id);
      if (!record?.definition.tags?.includes('projectile') || this.blueprintContinuousIds.has(id)) continue;
      if (!record.body.isDynamic() || record.body.isSleeping()) continue;
      if (this.forceApplications.some((application) => application.bodyId === id)) continue;
      if (length(record.body.linvel()) > BLUEPRINT_PROJECTILE_SLEEP_LINEAR_SPEED) continue;
      if (length(record.body.angvel()) > BLUEPRINT_PROJECTILE_SLEEP_ANGULAR_SPEED) continue;
      record.body.sleep();
    }
  }

  _blueprintBodyId(assemblyId) { return `blueprint:${this.blueprint.identity}:${assemblyId}`; }

  _createBlueprintAssembly(assembly) {
    const id = this._blueprintBodyId(assembly.assemblyId);
    const R = this.R;
    const descriptor = assembly.bodyMode === 'fixed' ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.dynamic()
      .setLinearDamping(DYNAMIC_LINEAR_DAMPING)
      .setAngularDamping(DYNAMIC_ANGULAR_DAMPING)
      .setCcdEnabled(true)
      .setCanSleep(true);
    descriptor.setTranslation(assembly.transform.position.x, assembly.transform.position.y, assembly.transform.position.z);
    descriptor.setRotation(assembly.transform.rotation);
    descriptor.setUserData({ mainWorldBodyId: id, blueprintAssemblyId: assembly.assemblyId, role: 'blueprint_assembly' });
    const body = this.world.createRigidBody(descriptor);
    for (const part of assembly.parts ?? []) {
      const material = materialProfile(part.materialId);
      const collider = blueprintColliderDescriptor(R, part)
        .setTranslation(part.localTransform.position.x, part.localTransform.position.y, part.localTransform.position.z)
        .setRotation(part.localTransform.rotation)
        .setDensity(material.density)
        .setFriction(assembly.bodyMode === 'fixed' ? material.friction : DYNAMIC_PLACEMENT_FRICTION)
        .setRestitution(assembly.bodyMode === 'fixed' ? material.restitution : DYNAMIC_PLACEMENT_RESTITUTION);
      const createdCollider = this.world.createCollider(collider, body);
      this.blueprintColliderInfo.set(createdCollider.handle, {
        role: 'part',
        assemblyId: assembly.assemblyId,
        partId: part.partId,
      });
    }
    this.bodies.set(id, {
      body,
      definition: {
        id, sourceId: assembly.assemblyId, renderName: `blueprint:${assembly.assemblyId}`,
        role: 'blueprint_assembly', bodyMode: assembly.bodyMode === 'fixed' ? 'fixed' : 'dynamic',
        tags: assembly.tags ?? [],
        position: { ...assembly.transform.position }, collider: { shape: 'cuboid', halfExtents: { x: .5, y: .5, z: .5 } },
      },
      sourcePosition: { ...assembly.transform.position },
      boundingRadius: 1,
      placementKind: 'mechanics-build',
      placementId: assembly.assemblyId.split('::')[0],
      placementTransform: normalizePlacementTransform({
        position: assembly.transform.position,
        rotation: assembly.transform.rotation,
      }),
    });
    this.blueprintBodyIds.add(id);
  }

  _createBlueprintJoint(definition) {
    const bodyA = this.bodies.get(this._blueprintBodyId(definition.assemblyAId))?.body;
    if (!bodyA) return;
    const bodyB = this.bodies.get(this._blueprintBodyId(definition.assemblyBId))?.body
      ?? this._createBlueprintAnchorBody({
        position: bodyA.translation(),
        rotation: bodyA.rotation(),
      });
    let params;
    if (definition.type === 'fixed') params = this.R.JointData.fixed(definition.localAnchorA, identityQuaternion(), definition.localAnchorB, identityQuaternion());
    else if (definition.type === 'prismatic') params = this.R.JointData.prismatic(definition.localAnchorA, definition.localAnchorB, normalizeVector(definition.localAxisA));
    else params = this.R.JointData.revolute(definition.localAnchorA, definition.localAnchorB, normalizeVector(definition.localAxisA));
    const joint = this.world.createImpulseJoint(params, bodyA, bodyB, true);
    if (definition.limits?.enabled && 'setLimits' in joint) joint.setLimits(definition.limits.min, definition.limits.max);
    joint.setContactsEnabled(definition.collideConnected === true);
    this.blueprintJoints.set(definition.constraintId, { definition, joint, bodyA, bodyB, initialRelativeRotation: mechanicsMultiplyQuaternion(inverseQuaternion(bodyA.rotation()), bodyB.rotation()) });
  }

  _createBlueprintMeshSupports() {
    const document = this.blueprint.document;
    const visiblySupported = new Set();
    for (const constraint of document.constraints ?? []) {
      if (constraint.type !== 'revolute') continue;
      visiblySupported.add(constraint.assemblyAId);
      visiblySupported.add(constraint.assemblyBId);
    }
    for (const coupling of document.rotationCouplings ?? []) {
      if (coupling.style !== 'mesh') continue;
      for (const [assemblyId, otherAssemblyId] of [
        [coupling.assemblyAId, coupling.assemblyBId],
        [coupling.assemblyBId, coupling.assemblyAId],
      ]) {
        if (visiblySupported.has(assemblyId) || this.blueprintMeshSupports.has(assemblyId)) continue;
        const assembly = document.assemblies.find((item) => item.assemblyId === assemblyId);
        const body = this.bodies.get(this._blueprintBodyId(assemblyId))?.body;
        if (!assembly || !body?.isDynamic()) continue;
        const frame = cogwheelWorldFrame(assembly);
        if (!frame) continue;
        const otherBearing = (document.constraints ?? []).find(
          (item) => item.type === 'revolute' && (
            item.assemblyAId === otherAssemblyId || item.assemblyBId === otherAssemblyId
          ),
        );
        const hostAssemblyId = otherBearing
          ? otherBearing.assemblyAId === otherAssemblyId
            ? otherBearing.assemblyBId
            : otherBearing.assemblyAId
          : null;
        let hostBody = this.bodies.get(this._blueprintBodyId(hostAssemblyId))?.body;
        let localAnchorHost;
        let localAxisHost;
        if (hostBody) {
          const hostAssembly = document.assemblies.find((item) => item.assemblyId === hostAssemblyId);
          localAnchorHost = inverseTransformPoint(hostAssembly.transform, frame.center);
          localAxisHost = inverseTransformDirection(hostAssembly.transform, frame.axis);
        } else {
          hostBody = this._createBlueprintAnchorBody(assembly.transform);
          localAnchorHost = inverseTransformPoint(assembly.transform, frame.center);
          localAxisHost = inverseTransformDirection(assembly.transform, frame.axis);
        }
        const localAnchorCog = inverseTransformPoint(assembly.transform, frame.center);
        const joint = this.world.createImpulseJoint(
          this.R.JointData.revolute(
            localAnchorHost,
            localAnchorCog,
            normalizeVector(localAxisHost),
          ),
          hostBody,
          body,
          true,
        );
        joint.setContactsEnabled(false);
        this.blueprintMeshSupports.set(assemblyId, { couplingId: coupling.couplingId, joint });
      }
    }
  }

  _createBlueprintForce(force) {
    if (force.type === 'linear_spring') {
      const bodyA = this.bodies.get(this._blueprintBodyId(force.assemblyAId))?.body;
      const bodyB = this.bodies.get(this._blueprintBodyId(force.assemblyBId))?.body;
      if (bodyA && bodyB) this.blueprintSprings.push({ definition: force, bodyA, bodyB });
      return;
    }
    const joint = this.blueprintJoints.get(force.constraintId);
    if (joint) this.blueprintSprings.push({ definition: force, joint, bodyA: joint.bodyA, bodyB: joint.bodyB });
  }

  _createBlueprintSensor(sensor) {
    let body = sensor.assemblyId
      ? this.bodies.get(this._blueprintBodyId(sensor.assemblyId))?.body
      : null;
    let localTransform = sensor.localTransform;
    if (!body) {
      body = this._createBlueprintAnchorBody(sensor.localTransform);
      localTransform = { position: { x: 0, y: 0, z: 0 }, rotation: identityQuaternion() };
    }
    const half = {
      x: Number(sensor.size?.x ?? 0.5) / 2,
      y: Number(sensor.size?.y ?? 0.5) / 2,
      z: Number(sensor.size?.z ?? 0.5) / 2,
    };
    const descriptor = (sensor.shape === 'sphere'
      ? this.R.ColliderDesc.ball(Math.max(half.x, half.y, half.z))
      : this.R.ColliderDesc.cuboid(half.x, half.y, half.z))
      .setTranslation(localTransform.position.x, localTransform.position.y, localTransform.position.z)
      .setRotation(localTransform.rotation)
      .setSensor(true)
      .setMass(0)
      .setActiveCollisionTypes(this.R.ActiveCollisionTypes.ALL)
      .setActiveEvents(this.R.ActiveEvents.COLLISION_EVENTS);
    const collider = this.world.createCollider(descriptor, body);
    this.blueprintColliderInfo.set(collider.handle, {
      role: 'sensor',
      assemblyId: sensor.assemblyId,
      sensorId: sensor.sensorId,
    });
    this.blueprintSensors.set(sensor.sensorId, {
      definition: sensor,
      collider,
      touching: new Set(),
      fired: false,
    });
  }

  _createBlueprintLatch(latch) {
    const runtime = {
      definition: latch,
      joint: null,
      state: latch.armed ? 'latched' : 'open',
      releasedAt: null,
      catchArmed: latch.armed === true,
    };
    this.blueprintLatches.set(latch.latchId, runtime);
    if (latch.armed) this._lockBlueprintLatch(runtime);
  }

  _createBlueprintAnchorBody(transform) {
    const body = this.world.createRigidBody(
      this.R.RigidBodyDesc.fixed()
        .setTranslation(transform.position.x, transform.position.y, transform.position.z)
        .setRotation(transform.rotation ?? identityQuaternion())
        .setUserData({ role: 'blueprint_auxiliary' }),
    );
    this.blueprintAuxiliaryBodies.add(body);
    return body;
  }

  _lockBlueprintLatch(runtime) {
    if (runtime.joint) return;
    const bodyA = this.bodies.get(this._blueprintBodyId(runtime.definition.assemblyAId))?.body;
    if (!bodyA) return;
    const bodyB = this.bodies.get(this._blueprintBodyId(runtime.definition.assemblyBId))?.body
      ?? (runtime.bodyB?.isValid()
        ? runtime.bodyB
        : this._createBlueprintAnchorBody({ position: bodyA.translation(), rotation: bodyA.rotation() }));
    const anchorA = runtime.definition.localAnchorA ?? { x: 0, y: 0, z: 0 };
    const anchorWorldA = transformPoint(
      { position: bodyA.translation(), rotation: bodyA.rotation() },
      anchorA,
    );
    const anchorB = runtime.definition.localAnchorB ?? inverseTransformPoint(
      { position: bodyB.translation(), rotation: bodyB.rotation() },
      anchorWorldA,
    );
    const relativeFrame = mechanicsMultiplyQuaternion(inverseQuaternion(bodyB.rotation()), bodyA.rotation());
    runtime.joint = this.world.createImpulseJoint(
      this.R.JointData.fixed(anchorA, identityQuaternion(), anchorB, relativeFrame),
      bodyA,
      bodyB,
      true,
    );
    runtime.joint.setContactsEnabled(false);
    runtime.bodyA = bodyA;
    runtime.bodyB = bodyB;
    runtime.state = 'latched';
  }

  _releaseBlueprintLatch(latchId) {
    const runtime = this.blueprintLatches.get(latchId);
    if (!runtime) return false;
    const transition = resolveLatchTransition(
      runtime.definition,
      { state: runtime.state, armed: runtime.catchArmed },
      { type: 'release' },
    );
    if (runtime.joint?.isValid()) this.world.removeImpulseJoint(runtime.joint, true);
    runtime.joint = null;
    runtime.state = transition.state;
    runtime.catchArmed = transition.armed;
    runtime.releasedAt = this.elapsedSeconds;
    runtime.bodyA?.wakeUp();
    runtime.bodyB?.wakeUp();
    return true;
  }

  _updateBlueprintCatchLatches() {
    for (const runtime of this.blueprintLatches.values()) {
      if (runtime.definition.mode !== 'catch' || !runtime.catchArmed || runtime.joint || !runtime.definition.assemblyBId) continue;
      const bodyA = this.bodies.get(this._blueprintBodyId(runtime.definition.assemblyAId))?.body;
      const bodyB = this.bodies.get(this._blueprintBodyId(runtime.definition.assemblyBId))?.body;
      if (!bodyA || !bodyB) continue;
      const anchorA = runtime.definition.localAnchorA ?? { x: 0, y: 0, z: 0 };
      const anchorB = runtime.definition.localAnchorB ?? { x: 0, y: 0, z: 0 };
      const pointA = transformPoint(
        { position: bodyA.translation(), rotation: bodyA.rotation() },
        anchorA,
      );
      const pointB = transformPoint(
        { position: bodyB.translation(), rotation: bodyB.rotation() },
        anchorB,
      );
      const transition = resolveLatchTransition(
        runtime.definition,
        { state: runtime.state, armed: runtime.catchArmed },
        {
          type: 'proximity',
          distance: vectorLength(subtractVector(pointA, pointB)),
          relativeSpeed: vectorLength(subtractVector(
            bodyA.velocityAtPoint(pointA),
            bodyB.velocityAtPoint(pointB),
          )),
        },
      );
      runtime.state = transition.state;
      runtime.catchArmed = transition.armed;
      if (transition.command === 'lock') this._lockBlueprintLatch(runtime);
    }
  }

  _applyBlueprintMechanics() {
    for (const runtime of this.blueprintJoints.values()) {
      const drive = runtime.definition.drive;
      if (!drive?.enabled || runtime.definition.type !== 'revolute') continue;
      this._applyBlueprintAxisTorque(runtime, (velocity) => clamp(drive.damping * (drive.targetVelocity - velocity), -drive.maxImpulse, drive.maxImpulse), Math.abs(drive.targetVelocity) > .0001);
    }
    for (const spring of this.blueprintSprings) {
      const d = spring.definition;
      if (d.type === 'linear_spring') {
        this._applyBlueprintLinearSpring(spring);
        continue;
      }
      const angle = this._blueprintJointState(d.constraintId).angleRadians ?? 0;
      this._applyBlueprintAxisTorque(spring.joint, (velocity) => clamp(d.stiffness * (d.restAngle - angle) - d.damping * velocity, -d.maxImpulse, d.maxImpulse), false);
    }
  }

  _applyBlueprintLinearSpring(runtime) {
    const { definition, bodyA, bodyB } = runtime;
    const anchorA = transformPoint(
      { position: bodyA.translation(), rotation: bodyA.rotation() },
      definition.localAnchorA,
    );
    const anchorB = transformPoint(
      { position: bodyB.translation(), rotation: bodyB.rotation() },
      definition.localAnchorB,
    );
    const delta = subtractVector(anchorB, anchorA);
    const springLength = vectorLength(delta);
    if (springLength < 0.0001) return;
    const direction = scaleVector(delta, 1 / springLength);
    const relativeVelocity = dotVector(subtractVector(bodyB.linvel(), bodyA.linvel()), direction);
    const force = clamp(
      Number(definition.stiffness ?? 0) * (springLength - Number(definition.restLength ?? 0))
        + Number(definition.damping ?? 0) * relativeVelocity,
      -(Number(definition.maxImpulse ?? 32) || 32) / MAIN_WORLD_FIXED_DT,
      (Number(definition.maxImpulse ?? 32) || 32) / MAIN_WORLD_FIXED_DT,
    );
    const impulse = scaleVector(direction, -force * MAIN_WORLD_FIXED_DT);
    if (bodyB.isDynamic()) bodyB.applyImpulse(impulse, Math.abs(force) > 0.025);
    if (bodyA.isDynamic()) bodyA.applyImpulse(scaleVector(impulse, -1), Math.abs(force) > 0.025);
  }

  _applyBlueprintAxisTorque(runtime, torqueFor, continuous) {
    const axis = normalizeVector(transformDirection({ position: runtime.bodyA.translation(), rotation: runtime.bodyA.rotation() }, runtime.definition.localAxisA));
    const velocity = dotVector(runtime.bodyB.angvel(), axis) - dotVector(runtime.bodyA.angvel(), axis);
    const torque = torqueFor(velocity);
    if (!Number.isFinite(torque) || Math.abs(torque) < .025) return;
    const impulse = scaleVector(axis, torque * MAIN_WORLD_FIXED_DT);
    if (runtime.bodyB.isDynamic()) runtime.bodyB.applyTorqueImpulse(impulse, continuous);
    if (runtime.bodyA.isDynamic()) runtime.bodyA.applyTorqueImpulse(scaleVector(impulse, -1), continuous);
  }

  _blueprintAssemblyRotationState(assemblyId, localAxis, body) {
    const normalized = signedTwistAngle(body.rotation(), localAxis);
    const key = `${assemblyId}:${localAxis.x}:${localAxis.y}:${localAxis.z}`;
    const previous = this.blueprintRotationTrackers.get(key);
    let angle = normalized;
    if (previous) {
      let delta = normalized - previous.normalized;
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      angle = previous.angle + delta;
    }
    this.blueprintRotationTrackers.set(key, { normalized, angle });
    const worldAxis = normalizeVector(rotateVector(localAxis, body.rotation()));
    return {
      angle,
      velocity: dotVector(body.angvel(), worldAxis),
      worldAxis,
    };
  }

  _applyBlueprintRotationCouplings() {
    for (const coupling of this.blueprint?.document?.rotationCouplings ?? []) {
      const bodyA = this.bodies.get(this._blueprintBodyId(coupling.assemblyAId))?.body;
      const bodyB = this.bodies.get(this._blueprintBodyId(coupling.assemblyBId))?.body;
      if (!bodyA?.isDynamic() || !bodyB?.isDynamic()) continue;
      const continuous =
        this.blueprintContinuousIds.has(this._blueprintBodyId(coupling.assemblyAId)) ||
        this.blueprintContinuousIds.has(this._blueprintBodyId(coupling.assemblyBId));
      if (!continuous && bodyA.isSleeping() && bodyB.isSleeping()) continue;
      const stateA = this._blueprintAssemblyRotationState(coupling.assemblyAId, coupling.axisA, bodyA);
      const stateB = this._blueprintAssemblyRotationState(coupling.assemblyBId, coupling.axisB, bodyB);
      const rawRatio = Number(coupling.ratio);
      const ratio = Math.abs(rawRatio) < 0.01 ? (rawRatio < 0 ? -0.01 : 0.01) : rawRatio;
      const efficiency = clamp(coupling.efficiency ?? 0.92, 0.01, 1);
      const phaseError = normalizeAngle(
        stateB.angle - (stateA.angle * ratio + (coupling.phaseOffset ?? 0)),
      );
      const velocityError = stateB.velocity - stateA.velocity * ratio;
      const invInertiaA = 1 / Math.max(1e-6, blueprintAngularInertiaAboutAxis(bodyA, stateA.worldAxis));
      const invInertiaB = 1 / Math.max(1e-6, blueprintAngularInertiaAboutAxis(bodyB, stateB.worldAxis));
      const phaseBias = clamp(phaseError * 10, -2.5, 2.5);
      const effectiveMass = 1 / Math.max(1e-9, invInertiaB + ratio * ratio * efficiency * invInertiaA);
      const requestedImpulse = -(velocityError + phaseBias) * effectiveMass;
      const capacityImpulse = Math.max(0, coupling.torqueCapacity ?? 24) * MAIN_WORLD_FIXED_DT;
      const impulseB = clamp(requestedImpulse, -capacityImpulse, capacityImpulse);
      const impulseA = -impulseB * ratio * efficiency;
      if (Math.abs(impulseA) + Math.abs(impulseB) >= 0.025 * MAIN_WORLD_FIXED_DT) {
        bodyA.applyTorqueImpulse(scaleVector(stateA.worldAxis, impulseA), continuous);
        bodyB.applyTorqueImpulse(scaleVector(stateB.worldAxis, impulseB), continuous);
      }
      this.blueprintCouplingStates.set(coupling.couplingId, {
        couplingId: coupling.couplingId,
        ratio,
        phaseError,
        velocityError,
        impulseA,
        impulseB,
        slipped: Math.abs(requestedImpulse) > capacityImpulse + 1e-9,
        loadRatio: capacityImpulse > 0
          ? Math.min(1, Math.abs(requestedImpulse) / capacityImpulse)
          : 1,
      });
    }
  }

  _drainBlueprintCollisionEvents() {
    this.blueprintTriggerEvents = [];
    this.eventQueue?.drainCollisionEvents((handleA, handleB, started) => {
      const infoA = this.blueprintColliderInfo.get(handleA);
      const infoB = this.blueprintColliderInfo.get(handleB);
      const sensorInfo = infoA?.role === 'sensor' ? infoA : infoB?.role === 'sensor' ? infoB : null;
      if (!sensorInfo) return;
      const otherHandle = sensorInfo === infoA ? handleB : handleA;
      const otherInfo = sensorInfo === infoA ? infoB : infoA;
      const target = this._blueprintSensorTarget(otherHandle, otherInfo);
      if (!target) return;
      const runtime = this.blueprintSensors.get(sensorInfo.sensorId);
      if (!runtime) return;
      if (
        runtime.definition.acceptedTags?.length > 0 &&
        !runtime.definition.acceptedTags.some((tag) => target.tags.includes(tag))
      ) return;
      if (started) runtime.touching.add(target.id);
      else runtime.touching.delete(target.id);
      const policy = runtime.definition.triggerPolicy;
      const shouldFire =
        (started && ['entered', 'one_shot'].includes(policy)) ||
        (!started && policy === 'exited');
      if (shouldFire && !(policy === 'one_shot' && runtime.fired)) {
        runtime.fired = true;
        this._emitBlueprintSensorEvent(runtime, target.id, started ? 'entered' : 'exited');
      }
      if (!started && runtime.touching.size === 0 && policy !== 'one_shot') runtime.fired = false;
    });
    this._emitHeldBlueprintSensorEvents();
  }

  _blueprintSensorTarget(handle, info) {
    if (info?.assemblyId) {
      const assembly = this.blueprint?.document.assemblies.find((item) => item.assemblyId === info.assemblyId);
      return { id: info.assemblyId, tags: assembly?.tags ?? [] };
    }
    const collider = this.world?.getCollider(handle);
    const data = collider?.parent()?.userData ?? {};
    const id = data.mainWorldBodyId;
    if (!id) return null;
    const record = this.bodies.get(id);
    return {
      id,
      tags: [...new Set([
        ...(record?.definition?.tags ?? []),
        record?.definition?.role,
        record?.placementKind,
        data.role,
      ].filter(Boolean))],
    };
  }

  _emitHeldBlueprintSensorEvents() {
    for (const runtime of this.blueprintSensors.values()) {
      if (runtime.definition.triggerPolicy !== 'held') continue;
      runtime.fired = runtime.touching.size > 0;
      for (const targetId of runtime.touching) this._emitBlueprintSensorEvent(runtime, targetId, 'held');
    }
  }

  _emitBlueprintSensorEvent(runtime, targetId, event) {
    this.blueprintTriggerEvents.push({
      sensorId: runtime.definition.sensorId,
      assemblyId: targetId,
      event,
      elapsedSeconds: this.elapsedSeconds,
    });
    for (const latch of this.blueprint.document.latches ?? []) {
      if (
        latch.releaseSensorId === runtime.definition.sensorId
        && this.blueprintLatches.get(latch.latchId)?.state === 'latched'
      ) this._releaseBlueprintLatch(latch.latchId);
    }
  }

  _updateBlueprintGateStates() {
    if (!this.blueprint) return;
    for (const gate of this.blueprint.document.gates ?? []) {
      const previous = this.blueprintGateStates.get(gate.gateId) ?? null;
      this.blueprintGateStates.set(
        gate.gateId,
        resolveMechanicalGate(gate, this._blueprintJointState(gate.driverConstraintId), previous),
      );
    }
  }

  _blueprintJointState(constraintId) {
    const runtime = this.blueprintJoints.get(constraintId);
    if (!runtime) return {};
    const { definition, bodyA, bodyB, initialRelativeRotation } = runtime;
    if (definition.type === 'prismatic') {
      const transformA = { position: bodyA.translation(), rotation: bodyA.rotation() };
      const transformB = { position: bodyB.translation(), rotation: bodyB.rotation() };
      const anchorA = transformPoint(transformA, definition.localAnchorA);
      const anchorB = transformPoint(transformB, definition.localAnchorB);
      const axis = normalizeVector(transformDirection(transformA, definition.localAxisA));
      const coordinate = dotVector(subtractVector(anchorB, anchorA), axis);
      const min = definition.limits?.enabled ? definition.limits.min : -1;
      const max = definition.limits?.enabled ? definition.limits.max : 1;
      return {
        coordinate,
        normalizedPosition: clamp((coordinate - min) / Math.max(0.0001, max - min), 0, 1),
        lateralError: vectorLength(
          subtractVector(subtractVector(anchorB, anchorA), scaleVector(axis, coordinate)),
        ),
        angularErrorRadians: 0,
      };
    }
    const relative = mechanicsMultiplyQuaternion(inverseQuaternion(bodyA.rotation()), bodyB.rotation());
    const delta = mechanicsMultiplyQuaternion(inverseQuaternion(initialRelativeRotation), relative);
    return {
      angleRadians: signedTwistAngle(delta, definition.localAxisA),
      axialError: 0,
    };
  }

  _refreshBlueprintFields() {
    if (!this.blueprint) return;
    const assemblies = {};
    for (const assembly of this.blueprint.document.assemblies ?? []) {
      const body = this.bodies.get(this._blueprintBodyId(assembly.assemblyId))?.body;
      if (!body) continue;
      assemblies[assembly.assemblyId] = { position: copyVector(body.translation()), rotation: copyRotation(body.rotation()), mass: body.isDynamic() ? body.mass() : 0 };
    }
    const gates = Object.fromEntries(this.blueprintGateStates);
    const evaluated = evaluateMountedSpellDevices(this.blueprint.document, { assemblies, gates }, {
      manualActiveIds: new Set((this.blueprint.document.spellDevices ?? []).map((item) => item.deviceId)),
      sceneState: { props: this.sceneProps, sources: this.sceneSources },
    });
    this.blueprintSpellDevices = evaluated.devices;
    this.blueprintFields = evaluated.fields.map((field) => ({
      ...field,
      active: field.active !== false,
      mountBodyId: field.targetAssemblyId
        ? this._blueprintBodyId(field.targetAssemblyId)
        : null,
    }));
    const activeEarthIds = new Set(
      this.blueprintFields
        .filter((field) => field.active && field.fieldShape === 'earth_emergence')
        .map((field) => field.id),
    );
    for (const fieldId of this.blueprintEarthFieldStates.keys()) {
      if (activeEarthIds.has(fieldId)) continue;
      this.blueprintEarthFieldStates.delete(fieldId);
      const column = this.earthColumnBodies.get(fieldId);
      if (column?.body?.isValid()) this.world?.removeRigidBody(column.body);
      this.earthColumnBodies.delete(fieldId);
    }
  }

  _applyBlueprintTargetForce(field) {
    const record = this.bodies.get(this._blueprintBodyId(field.targetAssemblyId));
    if (!record?.body.isDynamic()) return;
    const direction = normalizeVector(field.direction, { x: 0, y: 0, z: 0 });
    const magnitude = Math.max(0, Number(field.forceMagnitude ?? 0));
    if (magnitude <= 0 || vectorLength(direction) <= 0.0001) return;
    const force = scaleVector(direction, magnitude);
    record.body.addForce(force, true);
    this.forceApplications.push({
      fieldId: field.id,
      bodyId: record.definition.id,
      mode: 'target_force',
      magnitude,
      force,
      point: copyVector(record.body.translation()),
      wakeUp: true,
    });
  }

  _applyColumn(field, fieldState = null) {
    if (field.materialKind === 'light') {
      if (fieldState) fieldState.interception = null;
      return;
    }
    const direction = normalizeVector(field.direction);
    let pathDistance = 0;
    let hit = this._castColumnSegment(field, field.origin, direction, field.length, field.radius);
    let mode = 'column';
    if (hit) {
      pathDistance = hit.distance;
    } else if (field.materialKind === 'water' && field.continuation) {
      const trajectory = waterColumnTrajectory(field);
      pathDistance = field.length;
      for (let index = 1; index < trajectory.length; index += 1) {
        const start = trajectory[index - 1].point;
        const delta = subtract(trajectory[index].point, start);
        const segmentLength = length(delta);
        if (segmentLength <= 0.000001) continue;
        const segmentDirection = scale(delta, 1 / segmentLength);
        const progress = index / Math.max(1, trajectory.length - 1);
        const endScale = Number(field.continuation.radiusScaleAtEnd ?? 0.5);
        const radius = field.radius * (1 + (endScale - 1) * progress);
        hit = this._castColumnSegment(field, start, segmentDirection, segmentLength, radius);
        if (hit) {
          pathDistance += hit.distance;
          mode = 'water_column_continuation';
          break;
        }
        pathDistance += segmentLength;
      }
    }
    const interception = hit
      ? this._applyColumnHit(field, hit, mode, pathDistance)
      : null;
    if (fieldState) fieldState.interception = interception;
    if (field.materialKind === 'wind') this._applyMountedColumnThrust(field);
  }

  _castColumnSegment(field, origin, direction, segmentLength, radius) {
    if (segmentLength <= 0.000001 || radius <= 0) return null;
    const acceptsCollider = (collider) => {
      const body = collider.parent();
      const data = body?.userData ?? {};
      if (!body || data.role === 'terrain' || data.role === 'ground') return false;
      if (data.mainWorldBodyId === field.mountBodyId) return false;
      if (field.excludeAssemblyId && (
        data.blueprintAssemblyId === field.excludeAssemblyId ||
        data.assemblyId === field.excludeAssemblyId
      )) return false;
      return data.mainWorldBodyId !== `earth-column:${field.id}`;
    };
    // A swept ball is useful for nearest-hit ordering, but its swept volume is
    // a capsule with rounded ends. First restrict candidates to the exact
    // finite cylinder rendered on screen so nothing in front of the flat tip
    // can receive force from an invisible spherical cap.
    const exactCandidates = new Set();
    const center = add(origin, scale(direction, segmentLength / 2));
    this.world.intersectionsWithShape(
      center,
      quaternionFromUpVector(direction),
      new this.R.Cylinder(segmentLength / 2, Math.max(0.001, radius)),
      (collider) => {
        exactCandidates.add(collider.handle);
        return true;
      },
      this.R.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      undefined,
      undefined,
      acceptsCollider,
    );
    if (exactCandidates.size === 0) return null;
    const hit = this.world.castShape(
      origin,
      identityQuaternion(),
      direction,
      new this.R.Ball(Math.max(0.001, radius)),
      0,
      segmentLength,
      true,
      this.R.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      undefined,
      undefined,
      (collider) => exactCandidates.has(collider.handle),
    );
    if (!hit) return null;
    const distance = Number(hit.time_of_impact ?? hit.timeOfImpact ?? 0);
    return {
      collider: hit.collider,
      distance,
      point: add(origin, scale(direction, distance)),
      direction,
    };
  }

  _applyColumnHit(field, hit, mode, pathDistance) {
    const target = this._fieldTargetForCollider(hit.collider);
    const data = hit.collider.parent()?.userData ?? {};
    const bodyId = target?.definition?.id ?? data.mainWorldBodyId ?? null;
    if (target?.kind === 'player') {
      const requested = comparableForceLimit(
        field.materialKind,
        'column',
        MAIN_WORLD_PLAYER_CONFIG.mass,
        field.forceMagnitude,
        1,
      );
      this._applyPlayerForce(field, { point: hit.point, direction: hit.direction, falloff: 1 }, requested, mode);
    } else if (target?.body?.isDynamic()) {
      const requested = comparableForceLimit(
        field.materialKind,
        'column',
        target.body.mass(),
        field.forceMagnitude,
        field.materialKind === 'water'
          ? 1
          : Math.max(0.15, 1 - hit.distance / Math.max(field.length * 1.25, 0.001)),
      );
      this._applyForce(
        target,
        field,
        { point: hit.point, direction: hit.direction, falloff: 1 },
        requested,
        mode,
      );
    }
    return {
      blocked: true,
      bodyId,
      role: data.role ?? target?.definition?.role ?? 'unknown',
      distance: pathDistance,
      point: copyVector(hit.point),
      segment: mode === 'column' ? 'straight' : 'water_continuation',
      forceApplied: Boolean(target?.kind === 'player' || target?.body?.isDynamic()),
    };
  }

  _applyDispersion(field, fieldState = null) {
    const dispersionContacts = this._dispersionQuadrantContacts(field);
    field.dispersionContacts = dispersionContacts;
    if (fieldState && fieldState !== field) fieldState.dispersionContacts = dispersionContacts;
    for (const record of this._dynamicFieldTargets()) {
      if (record.definition.id === field.mountBodyId) continue;
      if (field.excludeAssemblyId && record.definition.sourceId === field.excludeAssemblyId) continue;
      const point = record.body.translation();
      const spread = sampleDispersionField(field, point);
      if (spread) {
        const requested = comparableForceLimit(
          field.materialKind,
          'dispersion',
          record.body.mass(),
          field.forceMagnitude,
          spread.falloff,
        );
        this._applyForce(record, field, spread, requested, 'dispersion');
      }
      const curtain = sampleWaterCurtain(field, point);
      if (curtain) {
        const requested = comparableForceLimit(
          'water',
          'water_curtain',
          record.body.mass(),
          field.curtain?.forceMagnitude,
          curtain.falloff,
        );
        this._applyForce(record, field, curtain, requested, 'water_curtain');
      }
    }
    if (this.playerRecord && field.mountBodyId !== 'player') {
      const point = this.playerRecord.body.translation();
      const spread = sampleDispersionField(field, point);
      if (spread) {
        const requested = comparableForceLimit(
          field.materialKind,
          'dispersion',
          MAIN_WORLD_PLAYER_CONFIG.mass,
          field.forceMagnitude,
          spread.falloff,
        );
        this._applyPlayerForce(field, spread, requested, 'dispersion');
      }
      const curtain = sampleWaterCurtain(field, point);
      if (curtain) {
        const requested = comparableForceLimit(
          'water',
          'water_curtain',
          MAIN_WORLD_PLAYER_CONFIG.mass,
          field.curtain?.forceMagnitude,
          curtain.falloff,
        );
        this._applyPlayerForce(field, curtain, requested, 'water_curtain');
      }
    }
  }

  _dispersionQuadrantContacts(field) {
    if (field.materialKind !== 'water' || !this.world) return null;
    const quadrantCount = 4;
    const samplesPerQuadrant = 7;
    const outerRadius = Math.max(0.001, Number(field.outerRadius ?? 0));
    const arcStep = (Math.PI / 2) / samplesPerQuadrant;
    // Adjacent swept balls overlap slightly, producing a continuous contact
    // outline without a one-ray blind spot at quadrant edges or around the
    // comparatively narrow player collider.
    const probeRadius = Math.max(0.035, outerRadius * arcStep * 0.58);
    const down = { x: 0, y: -1, z: 0 };
    const maxFall = 50;
    const quadrants = [];
    const acceptsCollider = (collider) => {
      const body = collider.parent();
      const data = body?.userData ?? {};
      if (!body) return true;
      if (data.mainWorldBodyId === field.mountBodyId) return false;
      if (field.excludeAssemblyId && (
        data.blueprintAssemblyId === field.excludeAssemblyId
        || data.assemblyId === field.excludeAssemblyId
      )) return false;
      return data.mainWorldBodyId !== `earth-column:${field.id}`;
    };

    for (let quadrant = 0; quadrant < quadrantCount; quadrant += 1) {
      const startAngle = quadrant * (Math.PI / 2);
      let highest = null;
      for (let sample = 0; sample < samplesPerQuadrant; sample += 1) {
        const theta = startAngle + (sample + 0.5) * arcStep;
        const radial = add(
          scale(field.axisU, Math.cos(theta) * outerRadius),
          scale(field.axisV, Math.sin(theta) * outerRadius),
        );
        const edge = add(field.center, radial);
        const origin = { x: edge.x, y: edge.y + probeRadius, z: edge.z };
        const hit = this.world.castShape(
          origin,
          identityQuaternion(),
          down,
          new this.R.Ball(probeRadius),
          0,
          maxFall,
          true,
          this.R.QueryFilterFlags.EXCLUDE_SENSORS,
          undefined,
          undefined,
          undefined,
          acceptsCollider,
        );
        if (!hit) continue;
        const distance = Number(hit.time_of_impact ?? hit.timeOfImpact ?? 0);
        const landingY = origin.y - distance - probeRadius + 0.015;
        if (highest && landingY <= highest.landingY) continue;
        const data = hit.collider.parent()?.userData ?? {};
        highest = {
          index: quadrant,
          startAngle,
          endAngle: startAngle + Math.PI / 2,
          landed: true,
          bodyId: data.mainWorldBodyId ?? null,
          role: data.role ?? 'unknown',
          point: { x: edge.x, y: landingY, z: edge.z },
          normal: copyVector(hit.normal2 ?? { x: 0, y: 1, z: 0 }),
          landingY,
          fallDistance: Math.max(0, edge.y - landingY),
        };
      }
      quadrants.push(highest ?? {
        index: quadrant,
        startAngle,
        endAngle: startAngle + Math.PI / 2,
        landed: false,
        bodyId: null,
        role: null,
        point: null,
        normal: { x: 0, y: 1, z: 0 },
        landingY: 0.04,
        fallDistance: Math.max(0, Number(field.center?.y ?? 0) - 0.04),
      });
    }
    return { model: 'four_independent_quadrants', quadrants };
  }

  _dynamicFieldTargets() {
    const targets = [...this.bodies.values()].filter((record) => record.body.isDynamic());
    for (const [id, body] of this.gravityBodies) {
      targets.push({ body, definition: { id, role: 'gravity_placement' } });
    }
    for (const [fieldId, record] of this.generatedLevitationBodies) {
      targets.push({
        body: record.body,
        definition: { id: `generated:${fieldId}`, role: 'generated_levitation_orb' },
      });
    }
    return targets;
  }

  _fieldTargetForCollider(collider) {
    const body = collider?.parent?.();
    const data = body?.userData ?? {};
    if (!body) return null;
    if (data.mainWorldBodyId === 'player') return { kind: 'player', body, definition: { id: 'player', role: 'player' } };
    const authored = this.bodies.get(data.mainWorldBodyId);
    if (authored) return authored;
    if (this.gravityBodies.get(data.mainWorldBodyId) === body) {
      return { body, definition: { id: data.mainWorldBodyId, role: 'gravity_placement' } };
    }
    if (String(data.mainWorldBodyId ?? '').startsWith('generated:')) {
      return { body, definition: { id: data.mainWorldBodyId, role: 'generated_levitation_orb' } };
    }
    return { body, definition: { id: data.mainWorldBodyId ?? `body:${body.handle}`, role: data.role ?? 'unknown' } };
  }

  _applyMountedColumnThrust(field) {
    const mountRecord = this.bodies.get(field.mountBodyId);
    if (!mountRecord?.body.isDynamic()) return;
    const direction = normalizeVector(field.direction);
    const magnitude = comparableForceLimit(
      'wind',
      'column',
      mountRecord.body.mass(),
      field.forceMagnitude,
      1,
    );
    if (magnitude <= 0) return;
    this._applyForce(
      mountRecord,
      field,
      {
        point: field.origin ?? mountRecord.body.translation(),
        direction: scale(direction, -1),
        falloff: 1,
      },
      magnitude,
      'wind_mount_thrust',
    );
  }

  _syncGeneratedLevitationBodies() {
    const activeFields = new Map(
      [...this.fields.values()]
        .filter((field) => field.active && field.fieldShape === 'generated_levitation_orb')
        .map((field) => [field.id, field]),
    );
    for (const [fieldId, record] of this.generatedLevitationBodies) {
      const field = activeFields.get(fieldId);
      if (
        field
        && record.activationInstanceId === field.activationInstanceId
        && record.collisionMode === levitationOrbCollisionMode(field.materialKind)
      ) continue;
      this.world?.removeRigidBody(record.body);
      this.generatedLevitationBodies.delete(fieldId);
    }
    for (const field of activeFields.values()) {
      if (this.generatedLevitationBodies.has(field.id)) continue;
      const worldField = this._worldField(field);
      const center = add(
        worldField.origin,
        scale(worldField.normal ?? worldField.direction, worldField.hoverHeight ?? 0.7),
      );
      const descriptor = this.R.RigidBodyDesc.dynamic()
        .setTranslation(center.x, center.y, center.z)
        .setLinearDamping(field.oneShotLaunch ? 0.08 : 3.2)
        .setAngularDamping(0.6)
        .setCcdEnabled(true);
      descriptor.setGravityScale(field.oneShotLaunch ? 1 : 0);
      const collisionMode = levitationOrbCollisionMode(field.materialKind);
      descriptor.setUserData({
        mainWorldBodyId: `generated:${field.id}`,
        role: 'generated_levitation_orb',
      });
      const body = this.world.createRigidBody(descriptor);
      const radius = Math.max(0.18, Number(field.radius ?? 0.34));
      let collider = null;
      if (collisionMode === 'solid') {
        collider = this.world.createCollider(
          this.R.ColliderDesc.ball(radius)
            .setMass(Math.max(0.12, radius * radius * radius * 8))
            .setFriction(0.42)
            .setRestitution(0.12),
          body,
        );
      } else {
        // Non-earth levitation is an elemental force/visual output, not a
        // solid payload. Keep a massed Rapier body so launch and field-driven
        // motion still use the existing path, but deliberately give it no
        // collider: the player and world bodies must pass straight through it.
        body.setAdditionalMass(Math.max(0.12, radius * radius * radius * 8), true);
      }
      if (field.oneShotLaunch) {
        body.setLinvel(scale(worldField.direction, field.launchSpeed ?? 4), true);
      }
      this.generatedLevitationBodies.set(field.id, {
        body,
        collider,
        collisionMode,
        renderName: `levitation-orb:${field.id}`,
        activationInstanceId: field.activationInstanceId,
        launched: field.oneShotLaunch === true,
      });
    }
    this._refreshSceneQueries();
  }

  _updateGeneratedLevitationBodies() {
    for (const [fieldId, record] of this.generatedLevitationBodies) {
      if (record.launched) continue;
      const field = this.fields.get(fieldId);
      if (!field?.active) continue;
      const worldField = this._worldField(field);
      const center = add(
        worldField.origin,
        scale(worldField.normal ?? worldField.direction, worldField.hoverHeight ?? 0.7),
      );
      record.body.setTranslation(center, true);
      record.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      record.body.setAngvel({ x: 0, y: 0.45, z: 0 }, true);
    }
  }

  _applyCarrierLevitation(field) {
    const record = this.bodies.get(field.mountBodyId);
    if (!record?.body.isDynamic()) return;
    const mass = Math.max(0.05, record.body.mass());
    const lift = scale(normalizeVector(field.direction), mass * (9.81 + Number(field.liftAcceleration ?? 0)));
    const guide = scale(normalizeVector(field.guidanceDirection), mass * Number(field.guidanceAcceleration ?? 0));
    const force = add(lift, guide);
    record.body.addForce(force, true);
    this.forceApplications.push({
      fieldId: field.id,
      bodyId: record.definition.id,
      mode: 'carrier_levitation',
      magnitude: length(force),
      force: copyVector(force),
      point: copyVector(record.body.translation()),
      wakeUp: true,
    });
  }

  _applyEarthEmergence(fieldState, field) {
    const fieldLength = Math.max(0, Number(field.length ?? 0));
    const previousLength = Math.min(
      fieldLength,
      Math.max(0, Number(fieldState.emergedLength ?? fieldLength * (fieldState.emergenceProgress ?? 0))),
    );
    const nextLength = Math.min(
      fieldLength,
      previousLength + EARTH_EMERGENCE_SPEED * MAIN_WORLD_FIXED_DT,
    );
    const previous = fieldLength > 0 ? previousLength / fieldLength : 1;
    if (previousLength < fieldLength) {
      fieldState.emergenceElapsed = Number(fieldState.emergenceElapsed ?? 0) + MAIN_WORLD_FIXED_DT;
    }
    fieldState.emergedLength = nextLength;
    fieldState.emergenceProgress = fieldLength > 0 ? nextLength / fieldLength : 1;
    const sweep = earthEmergenceSweep(field, previous, fieldState.emergenceProgress);
    if (sweep.length <= 0) {
      this._updateEarthColumnBody(field, fieldLength * fieldState.emergenceProgress, previousLength);
      return;
    }
    let blockingContact = null;
    let reaction = { x: 0, y: 0, z: 0 };
    const candidates = new Map();
    this.world.propagateModifiedBodyPositionsToColliders();
    const sweepCenter = add(sweep.start, scale(sweep.direction, sweep.length / 2));
    const sweepShape = new this.R.Capsule(Math.max(0.0001, sweep.length / 2), sweep.radius);
    this.world.intersectionsWithShape(
      sweepCenter,
      quaternionFromUpVector(sweep.direction),
      sweepShape,
      (collider) => {
        const body = collider.parent();
        const data = body?.userData ?? {};
        if (!body || data.mainWorldBodyId === `earth-column:${field.id}`) return true;
        const record = this._fieldTargetForCollider(collider);
        if (record) candidates.set(body.handle, { ...record, sourceRecord: record, collider, data });
        return true;
      },
      this.R.QueryFilterFlags.EXCLUDE_SENSORS,
    );
    for (const record of candidates.values()) {
      if (record.definition.id === field.mountBodyId || record.definition.role === 'terrain') continue;
      const earthCanDisplaceFixedPlacement = this._earthCanDisplaceFixedPlacement(record);
      if (!record.body.isDynamic() && record.kind !== 'player' && !earthCanDisplaceFixedPlacement) {
        // Source vessels remain real fixed colliders for the player and loose
        // bodies, but they are not structural blockers for the Earth output
        // that is emerging from the authored field.  The source basin sits
        // close to the canonical clearing placement and its vessel footprint
        // overlaps the first emergence capsule; treating that contact as a
        // blocked fixed structure deactivates an otherwise valid Earth spell
        // before its first visible frame.  Structural fixed bodies (house,
        // tree, authored fixed props, and fixed blueprint parts) still block.
        if (record.definition.role === 'source_vessel') continue;
        blockingContact = {
          bodyId: record.definition.id,
          role: record.definition.role,
          requiredForce: null,
          reason: 'fixed_mount_fixed_obstruction',
        };
        continue;
      }
      const bodyRadius = record.kind === 'player'
        ? MAIN_WORLD_PLAYER_CONFIG.height / 2
        : record.boundingRadius ?? 0.5;
      const sample = sampleEarthSweep(sweep, record.body.translation(), bodyRadius);
      if (!sample) continue;
      const mass = record.kind === 'player'
        ? MAIN_WORLD_PLAYER_CONFIG.mass
        : record.body.isDynamic()
          ? record.body.mass()
          : Math.max(0.05, Number(record.definition.mass ?? 4));
      const grounded = record.kind === 'player'
        ? this.playerLastGrounded || this.playerRecord.footPosition.y <= terrainHeightAt(
            this.playerRecord.footPosition.x,
            this.playerRecord.footPosition.z,
          ) + 0.05
        : record.boundingRadius !== undefined
          ? this._isTerrainSupported(record)
          : false;
      const requiredForce = earthPushResistance(mass, {
        grounded,
        friction: record.kind === 'player' ? 0.25 : DYNAMIC_PLACEMENT_FRICTION,
        player: record.kind === 'player',
      });
      const pushLimit = earthColumnPushLimit(field);
      if (requiredForce > pushLimit) {
        blockingContact = {
          bodyId: record.definition.id,
          role: record.definition.role,
          requiredForce,
          reason: 'earth_column_resistance_exceeded',
        };
        continue;
      }
      const requested = comparableForceLimit(
        'earth',
        'earth_emergence',
        mass,
        field.forceMagnitude,
        sample.falloff,
      );
      const applied = sample.contactType === 'leading_face'
        ? record.kind === 'player'
          ? this._applyPlayerEarthCarry(field, sample, requested)
          : record.body.isDynamic()
            ? this._applyDynamicEarthCarry(record, field, sample, requested)
            : this._applyAnchoredEarthCarry(record, field, sample, requested)
        : record.kind === 'player'
          ? this._applyPlayerForce(field, sample, requested, 'earth_emergence')
          : this._applyForce(record, field, sample, requested, 'earth_emergence');
      reaction = subtract(reaction, applied);
    }

    const mountRecord = this.bodies.get(field.mountBodyId);
    if (mountRecord?.body.isDynamic() && length(reaction) > 0.000001) {
      this._applyForce(
        mountRecord,
        field,
        { point: field.origin, direction: scale(reaction, 1 / length(reaction)), falloff: 1 },
        length(reaction),
        'earth_mount_reaction',
      );
    }

    if (blockingContact && !fieldState.blockedSignaled) {
      fieldState.emergedLength = previousLength;
      fieldState.emergenceProgress = previous;
      fieldState.blockedSignaled = true;
      const signal = {
        fieldId: field.id,
        placedSpellId: field.placedSpellId,
        stepCount: this.stepCount,
        elapsedMs: Math.round(fieldState.emergenceElapsed * 1000),
        reason: blockingContact.reason,
        obstructionBodyId: blockingContact.bodyId,
        obstructionRole: blockingContact.role,
        requiredForce: blockingContact.requiredForce,
        pushLimit: earthColumnPushLimit(field),
      };
      this.blockedSignals.push(signal);
      this.onEarthBlocked?.(field.placedSpellId, signal);
      return;
    }
    if (!blockingContact) this._updateEarthColumnBody(field, sweep.endDistance, previousLength);
  }

  _earthCanDisplaceFixedPlacement(record) {
    if (record?.placementKind !== 'asset') return false;
    const asset = this.placedAssets.find((item) => item.id === record.placementId);
    // Asset Manager shapes are authored as anchored scene objects by default,
    // but Earth is a moving solid: a shape sitting on its spell pad is still a
    // payload. Nature/landmark assets remain structural fixed obstructions.
    return asset?.category === 'Shapes'
      || String(asset?.assetDefinitionId ?? '').startsWith('shape:');
  }

  _updateEarthColumnBody(field, emergedLength, previousLength = 0) {
    const nextLength = Math.max(0.001, Math.min(field.length, emergedLength));
    const center = add(field.origin, scale(field.direction, nextLength / 2));
    const rotation = quaternionFromUpVector(field.direction);
    let record = this.earthColumnBodies.get(field.id);
    if (!record) {
      const initialLength = Math.max(0.001, Math.min(nextLength, previousLength));
      const initialCenter = add(field.origin, scale(field.direction, initialLength / 2));
      const descriptor = this.R.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(initialCenter.x, initialCenter.y, initialCenter.z)
        .setRotation(rotation)
        .setUserData({
          mainWorldBodyId: `earth-column:${field.id}`,
          role: 'earth_spell_column',
          placedSpellId: field.placedSpellId,
        });
      const body = this.world.createRigidBody(descriptor);
      const collider = this.world.createCollider(
        this.R.ColliderDesc.cylinder(initialLength / 2, field.radius)
          .setFriction(0.92)
          .setRestitution(0.03),
        body,
      );
      record = { body, collider, length: initialLength, radius: field.radius };
      this.earthColumnBodies.set(field.id, record);
    }
    record.body.setNextKinematicTranslation(center);
    record.body.setNextKinematicRotation(rotation);
    const geometryUnchanged = Math.abs(record.length - nextLength) < 0.0001
      && Math.abs(record.radius - field.radius) < 0.0001;
    if (geometryUnchanged) return;
    record.collider.setHalfHeight(nextLength / 2);
    record.collider.setRadius(field.radius);
    record.length = nextLength;
    record.radius = field.radius;
    this.world.propagateModifiedBodyPositionsToColliders?.();
  }

  _applyPlayerEarthCarry(field, sample, requested) {
    const force = this._recordEarthCarry(
      'player',
      field,
      sample,
      requested,
      'character_controller_carry',
    );
    this.playerEarthCarryTranslation = add(
      this.playerEarthCarryTranslation,
      scale(field.direction, sample.carryDistance),
    );
    this.playerNeedsStep = true;
    return force;
  }

  _applyDynamicEarthCarry(record, field, sample, requested) {
    const direction = normalizeVector(field.direction);
    const targetSpeed = sample.carryDistance / MAIN_WORLD_FIXED_DT;
    const currentVelocity = record.body.linvel();
    const currentAxialSpeed = dotVector(currentVelocity, direction);
    if (currentAxialSpeed < targetSpeed) {
      record.body.setLinvel(
        add(currentVelocity, scale(direction, targetSpeed - currentAxialSpeed)),
        true,
      );
    }
    return this._recordEarthCarry(
      record.definition.id,
      field,
      sample,
      requested,
      'solid_surface_velocity',
    );
  }

  _applyAnchoredEarthCarry(record, field, sample, requested) {
    const direction = normalizeVector(field.direction);
    const displacement = scale(direction, sample.carryDistance);
    const current = record.body.translation();
    // Keep the authored body fixed to gravity while allowing the Earth front
    // to translate a placed shape. The collider identity stays intact, and
    // the controller publishes this pose so the rendered asset cannot remain
    // behind the physical payload.
    record.body.setTranslation(add(current, displacement), true);
    (record.sourceRecord ?? record).earthCarried = true;
    this.world.propagateModifiedBodyPositionsToColliders?.();
    return this._recordEarthCarry(
      record.definition.id,
      field,
      sample,
      requested,
      'solid_surface_translation',
    );
  }

  _recordEarthCarry(bodyId, field, sample, requested, transport) {
    const used = this.forceBudgetByBody.get(bodyId) ?? 0;
    const magnitude = takeAggregateForceBudget(used, requested);
    if (magnitude <= 0) return { x: 0, y: 0, z: 0 };
    const force = scale(sample.direction, magnitude);
    this.forceBudgetByBody.set(bodyId, used + magnitude);
    this.forceApplications.push({
      fieldId: field.id,
      placedSpellId: field.placedSpellId,
      bodyId,
      materialKind: field.materialKind,
      mode: 'earth_emergence',
      transport,
      magnitude,
      force,
      point: copyVector(sample.point),
      wakeUp: true,
      aggregateAfter: used + magnitude,
    });
    return force;
  }

  _applyForce(record, field, sample, requested, mode) {
    const used = this.forceBudgetByBody.get(record.definition.id) ?? 0;
    const magnitude = takeAggregateForceBudget(used, requested);
    if (magnitude <= 0) return { x: 0, y: 0, z: 0 };
    const force = scale(sample.direction, magnitude);
    record.body.addForceAtPoint(force, sample.point, true);
    this.forceBudgetByBody.set(record.definition.id, used + magnitude);
    this.forceApplications.push({
      fieldId: field.id,
      placedSpellId: field.placedSpellId,
      bodyId: record.definition.id,
      materialKind: field.materialKind,
      mode,
      magnitude,
      force,
      point: copyVector(sample.point),
      wakeUp: true,
      aggregateAfter: used + magnitude,
    });
    return force;
  }

  _applyPlayerForce(field, sample, requested, mode) {
    const used = this.forceBudgetByBody.get('player') ?? 0;
    const magnitude = takeAggregateForceBudget(used, requested);
    if (magnitude <= 0) return { x: 0, y: 0, z: 0 };
    const force = scale(sample.direction, magnitude);
    this.playerFieldVelocity = add(
      this.playerFieldVelocity,
      scale(force, MAIN_WORLD_FIXED_DT / MAIN_WORLD_PLAYER_CONFIG.mass),
    );
    this.playerNeedsStep = true;
    this.forceBudgetByBody.set('player', used + magnitude);
    this.forceApplications.push({
      fieldId: field.id,
      placedSpellId: field.placedSpellId,
      bodyId: 'player',
      materialKind: field.materialKind,
      mode,
      magnitude,
      force,
      point: copyVector(sample.point),
      wakeUp: true,
      aggregateAfter: used + magnitude,
    });
    return force;
  }

  _resolvePlayerFieldVelocity(requested, computed) {
    let velocity = { ...this.playerFieldVelocity };
    for (const axis of ['x', 'y', 'z']) {
      if (
        Math.abs(velocity[axis]) > 0.000001 &&
        Math.abs(computed[axis]) + 0.00001 < Math.abs(requested[axis]) &&
        Math.sign(velocity[axis]) === Math.sign(requested[axis])
      ) velocity[axis] = 0;
    }
    if (this.playerController.computedGrounded()) {
      if (velocity.y < 0) velocity.y = 0;
      const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
      const nextSpeed = Math.max(0, horizontalSpeed - 9.81 * PLAYER_FIELD_SLIDING_FRICTION * MAIN_WORLD_FIXED_DT);
      if (horizontalSpeed > 0.000001) {
        velocity.x *= nextSpeed / horizontalSpeed;
        velocity.z *= nextSpeed / horizontalSpeed;
      }
    } else {
      velocity.y -= 9.81 * MAIN_WORLD_FIXED_DT;
    }
    if (length(velocity) < 0.0001) velocity = { x: 0, y: 0, z: 0 };
    this.playerFieldVelocity = velocity;
    if (length(velocity) > 0.000001) this.playerNeedsStep = true;
  }

  _mountBinding(field) {
    const spellBinding = field.placedSpellId
      ? this.spellBindings.get(field.placedSpellId)
      : null;
    if (spellBinding) {
      if (spellBinding.baseMountPosition) return spellBinding;
      const resolved = this._mountBindingForBodyId(spellBinding.bodyId);
      if (resolved) this.spellBindings.set(field.placedSpellId, resolved);
      return resolved;
    }
    return this._mountBindingForBodyId(field.mountBodyId);
  }

  _mountBindingForBodyId(bodyId) {
    if (!bodyId) return null;
    const record = this.bodies.get(bodyId);
    if (!record) return null;
    return {
      bodyId,
      // Placement frames already arrive in world space. Capture the owning
      // body's live pose once so the initial attachment delta is identity,
      // including pre-rotated fixed bodies such as the Atelier.
      baseMountPosition: copyVector(record.body.translation()),
      baseMountRotation: copyRotation(record.body.rotation()),
    };
  }

  _worldField(field) {
    let binding = field.mountBinding;
    if (!binding && field.mountBodyId) {
      binding = this._mountBinding(field);
      field.mountBinding = binding;
    }
    const mount = binding ? this.bodies.get(field.mountBodyId)?.body : null;
    if (!binding || !mount) return field;
    const delta = transformDelta(
      binding.baseMountPosition,
      binding.baseMountRotation,
      mount.translation(),
      mount.rotation(),
    );
    const transformed = { ...field };
    if (field.origin) transformed.origin = transformPointByDelta(field.origin, delta);
    if (field.center) transformed.center = transformPointByDelta(field.center, delta);
    if (field.direction) transformed.direction = rotateByQuaternion(field.direction, delta.rotation);
    if (field.emissionDirection) transformed.emissionDirection = rotateByQuaternion(field.emissionDirection, delta.rotation);
    if (field.normal) transformed.normal = rotateByQuaternion(field.normal, delta.rotation);
    if (field.axisU) transformed.axisU = rotateByQuaternion(field.axisU, delta.rotation);
    if (field.axisV) transformed.axisV = rotateByQuaternion(field.axisV, delta.rotation);
    return transformed;
  }
}

function composePlacedMechanicsDocument(placements) {
  if (!placements?.length) return null;
  const document = {
    schemaVersion: 1,
    assemblies: [],
    constraints: [],
    forceElements: [],
    sensors: [],
    latches: [],
    rotationCouplings: [],
    spellDevices: [],
    gates: [],
    metadata: {
      name: placements.map((item) => item.name ?? item.document.metadata?.name ?? 'Mechanics build').join(' · '),
      description: 'Mechanics Library placements running in the main atelier world.',
      revision: 0,
    },
  };

  for (const placement of placements) {
    const source = placement.document;
    const prefix = `${placement.id}::`;
    const rekey = (value) => (value == null ? value : `${prefix}${value}`);
    const scale = normalizePlacementTransform(placement.transform).scale;
    const scaleLength = meanPlacementScale(scale);
    const scaleVolume = Number(scale.x) * Number(scale.y) * Number(scale.z);
    const assemblyById = new Map(
      (source.assemblies ?? []).map((assembly) => [assembly.assemblyId, assembly]),
    );

    for (const assembly of source.assemblies ?? []) {
      const worldTransform = worldAssemblyTransform(assembly.transform, placement.transform);
      document.assemblies.push({
        ...cloneRuntimeValue(assembly),
        assemblyId: rekey(assembly.assemblyId),
        // A placed mechanism normally preserves the workshop's fixed frame
        // and dynamic moving parts. Releasing the placement removes those
        // fixed world anchors without flattening or replacing the mechanism.
        bodyMode: placement.affectedByGravity === true ? 'dynamic' : assembly.bodyMode,
        transform: worldTransform,
        parts: (assembly.parts ?? []).map((part) => ({
          ...cloneRuntimeValue(part),
          size: scaleSizeAlongLocalAxes(
            part.size,
            assembly,
            part.localTransform?.rotation,
            scale,
          ),
          localTransform: {
            ...cloneRuntimeValue(part.localTransform),
            position: scaleAssemblyLocalVector(part.localTransform?.position, assembly, scale),
          },
        })),
      });
    }

    for (const constraint of source.constraints ?? []) {
      const assemblyA = assemblyById.get(constraint.assemblyAId);
      const linearScale = constraint.type === 'prismatic'
        ? scaleAlongAssemblyDirection(constraint.localAxisA, assemblyA, scale)
        : 1;
      document.constraints.push({
        ...cloneRuntimeValue(constraint),
        constraintId: rekey(constraint.constraintId),
        assemblyAId: rekey(constraint.assemblyAId),
        assemblyBId: rekey(constraint.assemblyBId),
        localAnchorA: scaleAssemblyLocalVector(constraint.localAnchorA, assemblyA, scale),
        localAnchorB: scaleAssemblyLocalVector(
          constraint.localAnchorB,
          assemblyById.get(constraint.assemblyBId),
          scale,
        ),
        connectionAnchorA: constraint.connectionAnchorA
          ? scaleAssemblyLocalVector(constraint.connectionAnchorA, assemblyA, scale)
          : null,
        connectionAnchorB: constraint.connectionAnchorB
          ? scaleAssemblyLocalVector(
              constraint.connectionAnchorB,
              assemblyById.get(constraint.assemblyBId),
              scale,
            )
          : null,
        localAxisA: scaleAssemblyLocalDirection(constraint.localAxisA, assemblyA, scale),
        limits: constraint.limits ? {
          ...cloneRuntimeValue(constraint.limits),
          min: Number(constraint.limits.min ?? 0) * linearScale,
          max: Number(constraint.limits.max ?? 0) * linearScale,
        } : null,
        drive: constraint.drive ? {
          ...cloneRuntimeValue(constraint.drive),
          targetVelocity: Number(constraint.drive.targetVelocity ?? 0) * (
            constraint.type === 'prismatic'
              ? Math.sqrt(linearScale)
              : 1 / Math.sqrt(scaleLength)
          ),
          damping: Number(constraint.drive.damping ?? 2) * (
            constraint.type === 'prismatic'
              ? scaleVolume / Math.sqrt(linearScale)
              : scaleVolume * Math.pow(scaleLength, 1.5)
          ),
          maxImpulse: Number(constraint.drive.maxImpulse ?? 12) * (
            constraint.type === 'prismatic'
              ? scaleVolume
              : scaleVolume * scaleLength
          ),
        } : null,
      });
    }

    for (const force of source.forceElements ?? []) {
      const assemblyA = assemblyById.get(force.assemblyAId);
      const assemblyB = assemblyById.get(force.assemblyBId);
      const springScale = force.type === 'linear_spring'
        ? scaleBetweenAssemblyAnchors(force, assemblyById, scale)
        : 1;
      document.forceElements.push({
        ...cloneRuntimeValue(force),
        forceElementId: rekey(force.forceElementId),
        assemblyAId: rekey(force.assemblyAId),
        assemblyBId: rekey(force.assemblyBId),
        constraintId: rekey(force.constraintId),
        localAnchorA: scaleAssemblyLocalVector(force.localAnchorA, assemblyA, scale),
        localAnchorB: scaleAssemblyLocalVector(force.localAnchorB, assemblyB, scale),
        connectionAnchorA: force.connectionAnchorA
          ? scaleAssemblyLocalVector(force.connectionAnchorA, assemblyA, scale)
          : null,
        connectionAnchorB: force.connectionAnchorB
          ? scaleAssemblyLocalVector(force.connectionAnchorB, assemblyB, scale)
          : null,
        restLength: Number(force.restLength ?? 0) * springScale,
        stiffness: Number(force.stiffness ?? 28) * (
          force.type === 'linear_spring'
            ? scaleVolume / springScale
            : scaleVolume * scaleLength
        ),
        damping: Number(force.damping ?? 4) * (
          force.type === 'linear_spring'
            ? scaleVolume / Math.sqrt(springScale)
            : scaleVolume * Math.pow(scaleLength, 1.5)
        ),
        maxImpulse: Number(force.maxImpulse ?? 32) * (
          force.type === 'linear_spring'
            ? scaleVolume
            : scaleVolume * scaleLength
        ),
      });
    }

    for (const sensor of source.sensors ?? []) {
      const attached = Boolean(sensor.assemblyId);
      const assembly = assemblyById.get(sensor.assemblyId);
      const localTransform = attached
        ? {
            ...cloneRuntimeValue(sensor.localTransform),
            position: scaleAssemblyLocalVector(sensor.localTransform?.position, assembly, scale),
          }
        : worldAssemblyTransform(sensor.localTransform, placement.transform);
      document.sensors.push({
        ...cloneRuntimeValue(sensor),
        sensorId: rekey(sensor.sensorId),
        assemblyId: rekey(sensor.assemblyId),
        size: attached
          ? scaleSizeAlongLocalAxes(sensor.size, assembly, sensor.localTransform?.rotation, scale)
          : scaleVectorBy(sensor.size, scale),
        localTransform,
      });
    }

    for (const latch of source.latches ?? []) {
      const assemblyA = assemblyById.get(latch.assemblyAId);
      const assemblyB = assemblyById.get(latch.assemblyBId);
      document.latches.push({
        ...cloneRuntimeValue(latch),
        latchId: rekey(latch.latchId),
        assemblyAId: rekey(latch.assemblyAId),
        assemblyBId: rekey(latch.assemblyBId),
        releaseSensorId: rekey(latch.releaseSensorId),
        localAnchorA: latch.localAnchorA
          ? scaleAssemblyLocalVector(latch.localAnchorA, assemblyA, scale)
          : null,
        localAnchorB: latch.localAnchorB
          ? scaleAssemblyLocalVector(latch.localAnchorB, assemblyB, scale)
          : null,
        catchDistance: Number(latch.catchDistance ?? 0.35) * scaleLength,
        catchSpeed: Number(latch.catchSpeed ?? 3) * Math.sqrt(scaleLength),
      });
    }

    for (const coupling of source.rotationCouplings ?? []) {
      const assemblyA = assemblyById.get(coupling.assemblyAId);
      const assemblyB = assemblyById.get(coupling.assemblyBId);
      document.rotationCouplings.push({
        ...cloneRuntimeValue(coupling),
        couplingId: rekey(coupling.couplingId),
        assemblyAId: rekey(coupling.assemblyAId),
        assemblyBId: rekey(coupling.assemblyBId),
        localAnchorA: coupling.localAnchorA
          ? scaleAssemblyLocalVector(coupling.localAnchorA, assemblyA, scale)
          : null,
        localAnchorB: coupling.localAnchorB
          ? scaleAssemblyLocalVector(coupling.localAnchorB, assemblyB, scale)
          : null,
        axisA: scaleAssemblyLocalDirection(coupling.axisA, assemblyA, scale),
        axisB: scaleAssemblyLocalDirection(coupling.axisB, assemblyB, scale),
        torqueCapacity: Number(coupling.torqueCapacity ?? 24) * scaleVolume * scaleLength,
        stiffness: Number(coupling.stiffness ?? 18) * scaleVolume * scaleLength,
        damping: Number(coupling.damping ?? 4) * scaleVolume * Math.pow(scaleLength, 1.5),
      });
    }

    for (const device of source.spellDevices ?? []) {
      const assembly = assemblyById.get(device.assemblyId);
      document.spellDevices.push({
        ...cloneRuntimeValue(device),
        deviceId: rekey(device.deviceId),
        assemblyId: rekey(device.assemblyId),
        gateId: rekey(device.gateId),
        localFrame: {
          ...cloneRuntimeValue(device.localFrame),
          origin: scaleAssemblyLocalVector(device.localFrame?.origin, assembly, scale),
          normal: scaleAssemblyLocalDirection(device.localFrame?.normal, assembly, scale),
          tangent: scaleAssemblyLocalDirection(device.localFrame?.tangent, assembly, scale),
        },
        plateRadius: Number(device.plateRadius ?? 0.42) * scaleLength,
        placementScale: scaleLength,
      });
    }

    for (const gate of source.gates ?? []) {
      document.gates.push({
        ...cloneRuntimeValue(gate),
        gateId: rekey(gate.gateId),
        plateDeviceId: rekey(gate.plateDeviceId),
        driverConstraintId: rekey(gate.driverConstraintId),
        lateralTolerance: Number(gate.lateralTolerance ?? 0.025) * scaleLength,
      });
    }
  }
  return document;
}

function meanPlacementScale(scale) {
  return (Number(scale.x) + Number(scale.y) + Number(scale.z)) / 3;
}

function scaleAlongBuildDirection(direction, scale) {
  const unit = normalizeVector(direction, { x: 1, y: 0, z: 0 });
  return vectorLength(scaleVectorBy(unit, scale));
}

function scaleAlongAssemblyDirection(direction, assembly, scale) {
  const buildDirection = assembly
    ? rotateVector(direction ?? { x: 1, y: 0, z: 0 }, assembly.transform.rotation)
    : direction;
  return scaleAlongBuildDirection(buildDirection, scale);
}

function scaleAssemblyLocalVector(value, assembly, scale) {
  if (!assembly) return scaleVectorBy(value, scale);
  const buildVector = rotateVector(value ?? { x: 0, y: 0, z: 0 }, assembly.transform.rotation);
  return rotateVector(
    scaleVectorBy(buildVector, scale),
    inverseQuaternion(assembly.transform.rotation),
  );
}

function scaleAssemblyLocalDirection(value, assembly, scale) {
  return normalizeVector(
    scaleAssemblyLocalVector(value ?? { x: 1, y: 0, z: 0 }, assembly, scale),
    value ?? { x: 1, y: 0, z: 0 },
  );
}

function scaleSizeAlongLocalAxes(size, assembly, localRotation, scale) {
  const rotation = assembly
    ? mechanicsMultiplyQuaternion(
        assembly.transform.rotation,
        localRotation ?? identityQuaternion(),
      )
    : localRotation ?? identityQuaternion();
  return {
    x: Number(size?.x ?? 0) * scaleAlongBuildDirection(rotateVector({ x: 1, y: 0, z: 0 }, rotation), scale),
    y: Number(size?.y ?? 0) * scaleAlongBuildDirection(rotateVector({ x: 0, y: 1, z: 0 }, rotation), scale),
    z: Number(size?.z ?? 0) * scaleAlongBuildDirection(rotateVector({ x: 0, y: 0, z: 1 }, rotation), scale),
  };
}

function scaleBetweenAssemblyAnchors(force, assemblyById, scale) {
  const assemblyA = assemblyById.get(force.assemblyAId);
  const assemblyB = assemblyById.get(force.assemblyBId);
  if (!assemblyA || !assemblyB) return meanPlacementScale(scale);
  const pointA = transformPoint(assemblyA.transform, force.localAnchorA);
  const pointB = transformPoint(assemblyB.transform, force.localAnchorB);
  const direction = subtractVector(pointB, pointA);
  return vectorLength(direction) > 0.000001
    ? scaleAlongBuildDirection(direction, scale)
    : meanPlacementScale(scale);
}

function cloneRuntimeValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function blueprintSpellDeviceSnapshot(device) {
  return {
    deviceId: device.deviceId,
    assemblyId: device.assemblyId,
    label: device.label,
    spellTemplateId: device.spellTemplateId,
    socketed: device.socketed,
    active: device.active,
    gateId: device.gateId,
    gateClosed: device.gateClosed,
    frame: cloneRuntimeValue(device.frame),
    lifecycle: cloneRuntimeValue(device.lifecycle),
    // Rendering consumes the exact compiler/simulation intents. Do not reduce
    // mounted spells to a mechanics-only field cylinder: Water, Light, Earth,
    // Wind, dispersion, and levitation must reach the same presentation
    // components as spells placed directly in the simulator.
    outputIntents: cloneRuntimeValue(device.outputIntents ?? []),
  };
}

function placedAssetBodyId(assetId) {
  return `placed-asset:${assetId}`;
}

function levitationOrbCollisionMode(materialKind) {
  return materialKind === 'earth' ? 'solid' : 'passthrough';
}

function placedAssetBodyMode(asset) {
  return asset?.bodyMode === 'dynamic' || asset?.movable === true || asset?.affectedByGravity === true
    ? 'dynamic'
    : 'fixed';
}

function placedAssetColliderDefinitions(asset, definition) {
  if (asset?.collider?.shape === 'compound') return asset.collider.parts ?? [];
  if (asset?.collider?.shape) return [asset.collider];
  const size = definition?.size ?? { x: 1, y: 1, z: 1 };
  return [{
    shape: 'cuboid',
    halfExtents: {
      x: Math.max(0.025, Number(size.x ?? 1) / 2),
      y: Math.max(0.025, Number(size.y ?? 1) / 2),
      z: Math.max(0.025, Number(size.z ?? 1) / 2),
    },
  }];
}

function scaleColliderDefinition(definition = {}, scale = { x: 1, y: 1, z: 1 }) {
  const safeScale = normalizePlacementTransform({ scale }).scale;
  const scaled = { ...definition };
  if (definition.position) scaled.position = scaleVectorBy(definition.position, safeScale);
  if (definition.shape === 'ball') {
    scaled.radius = Number(definition.radius ?? 0.5) * Math.max(safeScale.x, safeScale.y, safeScale.z);
  } else if (definition.shape === 'cylinder') {
    scaled.halfHeight = Number(definition.halfHeight ?? 0.5) * safeScale.y;
    scaled.radius = Number(definition.radius ?? 0.5) * Math.max(safeScale.x, safeScale.z);
  } else if (definition.halfExtents) {
    scaled.halfExtents = {
      x: Number(definition.halfExtents.x ?? 0.5) * safeScale.x,
      y: Number(definition.halfExtents.y ?? 0.5) * safeScale.y,
      z: Number(definition.halfExtents.z ?? 0.5) * safeScale.z,
    };
  }
  return scaled;
}

function colliderDescriptor(R, collider) {
  if (collider.shape === 'ball') return R.ColliderDesc.ball(collider.radius);
  if (collider.shape === 'cylinder') return R.ColliderDesc.cylinder(collider.halfHeight, collider.radius);
  if (collider.shape === 'terrain-ground-plane') {
    return new R.ColliderDesc(new R.HalfSpace({ x: 0, y: 1, z: 0 }));
  }
  if (collider.shape === 'compound') {
    // Compound children are created by _createBody so they retain local
    // offsets/rotations while the parent keeps the authored id and yaw.
    return R.ColliderDesc.cuboid(0.001, 0.001, 0.001);
  }
  const half = collider.halfExtents;
  return R.ColliderDesc.cuboid(half.x, half.y, half.z);
}

function blueprintColliderDescriptor(R, part) {
  const size = part.size;
  if (part.shape === 'sphere') return R.ColliderDesc.ball(Math.max(size.x, size.y, size.z) / 2);
  if (part.shape === 'cogwheel') {
    return R.ColliderDesc.cylinder(Math.max(0.04, size.y / 2), cogwheelRootRadius(size));
  }
  if (part.shape === 'cylinder' || part.shape === 'wheel' || part.shape === 'shaft') {
    return R.ColliderDesc.cylinder(Math.max(0.04, size.y / 2), Math.max(0.04, size.x / 2));
  }
  if (part.shape === 'wedge') {
    const half = { x: size.x / 2, y: size.y / 2, z: size.z / 2 };
    const points = new Float32Array([
      -half.x, -half.y, -half.z,
      half.x, -half.y, -half.z,
      -half.x, half.y, -half.z,
      -half.x, -half.y, half.z,
      half.x, -half.y, half.z,
      -half.x, half.y, half.z,
    ]);
    return R.ColliderDesc.convexHull(points)
      ?? R.ColliderDesc.cuboid(half.x, half.y, half.z);
  }
  return R.ColliderDesc.cuboid(Math.max(.04, size.x / 2), Math.max(.04, size.y / 2), Math.max(.04, size.z / 2));
}

function identityQuaternion() { return { x: 0, y: 0, z: 0, w: 1 }; }

function blueprintAngularInertiaAboutAxis(body, axis) {
  const matrix = body.effectiveAngularInertia();
  return (
    matrix.m11 * axis.x * axis.x +
    matrix.m22 * axis.y * axis.y +
    matrix.m33 * axis.z * axis.z +
    2 * (
      matrix.m12 * axis.x * axis.y +
      matrix.m13 * axis.x * axis.z +
      matrix.m23 * axis.y * axis.z
    )
  );
}

function yawQuaternion(angle) {
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
}

function composeEulerQuaternion(x = 0, y = 0, z = 0) {
  const cx = Math.cos(x / 2); const sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2); const sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2); const sz = Math.sin(z / 2);
  return {
    x: sx * cy * cz - cx * sy * sz,
    y: cx * sy * cz + sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
    w: cx * cy * cz + sx * sy * sz,
  };
}

function quaternionFromUpVector(direction) {
  const dot = Math.max(-1, Math.min(1, direction.y));
  if (dot < -0.999999) return { x: 1, y: 0, z: 0, w: 0 };
  const quaternion = { x: direction.z, y: 0, z: -direction.x, w: 1 + dot };
  const magnitude = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  return {
    x: quaternion.x / magnitude,
    y: quaternion.y / magnitude,
    z: quaternion.z / magnitude,
    w: quaternion.w / magnitude,
  };
}

function transformDelta(basePosition, baseRotation, currentPosition, currentRotation) {
  const inverseBase = conjugate(baseRotation);
  const rotation = multiplyQuaternion(currentRotation, inverseBase);
  const translatedBase = rotateByQuaternion(basePosition, rotation);
  return { rotation, translation: subtract(currentPosition, translatedBase) };
}

function transformPointByDelta(point, delta) {
  return add(rotateByQuaternion(point, delta.rotation), delta.translation);
}

function rotateByQuaternion(value, quaternion) {
  const q = quaternion;
  const ix = q.w * value.x + q.y * value.z - q.z * value.y;
  const iy = q.w * value.y + q.z * value.x - q.x * value.z;
  const iz = q.w * value.z + q.x * value.y - q.y * value.x;
  const iw = -q.x * value.x - q.y * value.y - q.z * value.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

function multiplyQuaternion(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function conjugate(value) { return { x: -value.x, y: -value.y, z: -value.z, w: value.w }; }
function copyVector(value) { return { x: Number(value.x), y: Number(value.y), z: Number(value.z) }; }
function copyRotation(value) { return { x: Number(value.x), y: Number(value.y), z: Number(value.z), w: Number(value.w) }; }
function sameVector(a, b) { return Math.abs(a.x - b.x) < 1e-8 && Math.abs(a.y - b.y) < 1e-8 && Math.abs(a.z - b.z) < 1e-8; }
function sameRotation(a, b) {
  return Math.abs(a.x - b.x) < 1e-8 && Math.abs(a.y - b.y) < 1e-8 && Math.abs(a.z - b.z) < 1e-8 && Math.abs(a.w - b.w) < 1e-8;
}
function samePlacementTransform(a, b) {
  return Boolean(a && b) && sameVector(a.position, b.position) && sameRotation(a.rotation, b.rotation) && sameVector(a.scale, b.scale);
}
function sameColliderDefinition(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export const mainWorldTransformMath = Object.freeze({
  transformDelta,
  transformPointByDelta,
  rotateByQuaternion,
  multiplyQuaternion,
});
