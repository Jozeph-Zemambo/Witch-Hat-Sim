import {
  addVector,
  clamp,
  cogwheelWorldFrame,
  cogwheelRootRadius,
  crossVector,
  dotVector,
  inverseQuaternion,
  inverseTransformDirection,
  inverseTransformPoint,
  materialProfile,
  multiplyQuaternion,
  normalizeAngle,
  normalizeVector,
  resolveMechanicalGate,
  resolveLatchTransition,
  rotateVector,
  scaleVector,
  signedTwistAngle,
  subtractVector,
  transformDirection,
  transformPoint,
  vectorLength,
} from '../../../src/mechanics-engine/index.js';
import {
  comparableForceLimit,
  sampleDispersionField,
  sampleWaterCurtain,
  waterColumnTrajectory,
} from '../world-physics/force-contract.js';

export const MECHANICS_FIXED_DT = 1 / 120;
const MAX_SUBSTEPS = 8;
const MAX_FRAME_DT = 0.1;
const MAX_ACTIVE_PROJECTILES = 16;
const PROJECTILE_ESCAPE_RADIUS = 60;
const PROJECTILE_ESCAPE_MIN_Y = -12;
const PROJECTILE_ESCAPE_MAX_Y = 50;
const GROUND_FRICTION = 0.8;
const GROUND_RESTITUTION = 0.05;
// Do not keep a finite mechanism awake to correct numerical noise below a
// perceptible torque. Continuous drives deliberately bypass this threshold.
const SETTLING_TORQUE = 0.025;

export class RapierMechanicsWorld {
  constructor(rapier, document, options = {}) {
    this.R = rapier;
    this.gravity = options.gravity ?? 9.81;
    this.document = document;
    this.world = null;
    this.eventQueue = null;
    this.accumulator = 0;
    this.paused = options.paused ?? true;
    this.elapsedSeconds = 0;
    this.bodyByAssemblyId = new Map();
    this.colliderInfoByHandle = new Map();
    this.constraintRuntime = new Map();
    this.meshSupportRuntime = new Map();
    this.springRuntime = new Map();
    this.sensorRuntime = new Map();
    this.latchRuntime = new Map();
    this.rotationTrackers = new Map();
    this.gateStates = new Map();
    this.couplingStates = new Map();
    this.spellFields = [];
    this.activeSpellDevices = [];
    this.triggerEvents = [];
    this.forceApplications = [];
    this.forceApplicationCount = 0;
    this.forceCandidateCount = 0;
    this.forceSaturationCount = 0;
    this.physicsStepCount = 0;
    this.totalStepDurationMs = 0;
    this.lastStepDurationMs = 0;
    this.peakStepDurationMs = 0;
    this.anchorBodies = [];
    this.projectileAssemblyIds = new Set();
    this.removedAssemblyIds = new Set();
    this.continuouslyDrivenAssemblyIds = new Set();
    this.rebuildCount = 0;
    this.rebuild(document);
  }

  rebuild(document = this.document) {
    if (this.eventQueue) this.eventQueue.free();
    if (this.world) this.world.free();
    this.document = document;
    this.world = new this.R.World({ x: 0, y: -this.gravity, z: 0 });
    this.world.timestep = MECHANICS_FIXED_DT;
    this.world.numSolverIterations = 8;
    this.world.maxCcdSubsteps = 2;
    this.eventQueue = new this.R.EventQueue(true);
    this.accumulator = 0;
    this.elapsedSeconds = 0;
    this.bodyByAssemblyId.clear();
    this.colliderInfoByHandle.clear();
    this.constraintRuntime.clear();
    this.meshSupportRuntime.clear();
    this.springRuntime.clear();
    this.sensorRuntime.clear();
    this.latchRuntime.clear();
    this.rotationTrackers.clear();
    this.gateStates.clear();
    this.couplingStates.clear();
    this.triggerEvents = [];
    this.forceApplications = [];
    this.forceApplicationCount = 0;
    this.forceCandidateCount = 0;
    this.forceSaturationCount = 0;
    this.physicsStepCount = 0;
    this.totalStepDurationMs = 0;
    this.lastStepDurationMs = 0;
    this.peakStepDurationMs = 0;
    this.anchorBodies = [];
    this.projectileAssemblyIds.clear();
    this.removedAssemblyIds.clear();
    this.continuouslyDrivenAssemblyIds.clear();
    for (const constraint of document.constraints ?? []) {
      if (constraint.drive?.enabled && Math.abs(constraint.drive.targetVelocity ?? 0) > 0.0001) {
        this.continuouslyDrivenAssemblyIds.add(constraint.assemblyAId);
        this.continuouslyDrivenAssemblyIds.add(constraint.assemblyBId);
      }
    }
    this._buildGround();
    for (const assembly of document.assemblies ?? []) this._buildAssembly(assembly);
    for (const constraint of document.constraints ?? []) this._buildConstraint(constraint);
    this._buildMeshSupports();
    for (const element of document.forceElements ?? []) this._buildForceElement(element);
    for (const sensor of document.sensors ?? []) this._buildSensor(sensor);
    for (const latch of document.latches ?? []) this._buildLatch(latch);
    this._updateGateStates();
    this.rebuildCount += 1;
    return this.getSnapshot();
  }

  _buildGround() {
    const body = this.world.createRigidBody(
      this.R.RigidBodyDesc.fixed().setTranslation(0, -0.12, 0).setUserData({ role: 'ground' }),
    );
    const collider = this.world.createCollider(
      this.R.ColliderDesc.cuboid(30, 0.12, 30)
        .setFriction(GROUND_FRICTION)
        .setRestitution(GROUND_RESTITUTION),
      body,
    );
    this.groundBody = body;
    this.colliderInfoByHandle.set(collider.handle, { role: 'ground', assemblyId: null });
  }

  _buildAssembly(assembly) {
    if (assembly.tags?.includes('projectile')) {
      if (this.projectileAssemblyIds.size >= MAX_ACTIVE_PROJECTILES) {
        this.removedAssemblyIds.add(assembly.assemblyId);
        return;
      }
      this.projectileAssemblyIds.add(assembly.assemblyId);
    }
    const descriptor = (assembly.bodyMode === 'fixed'
      ? this.R.RigidBodyDesc.fixed()
      : this.R.RigidBodyDesc.dynamic()
          .setLinearDamping(0.04)
          .setAngularDamping(0.06)
          .setCanSleep(true))
      .setTranslation(
        assembly.transform.position.x,
        assembly.transform.position.y,
        assembly.transform.position.z,
      )
      .setRotation(assembly.transform.rotation)
      .setUserData({ assemblyId: assembly.assemblyId, role: 'assembly' });
    const body = this.world.createRigidBody(descriptor);
    body.setAdditionalSolverIterations(2);
    this.bodyByAssemblyId.set(assembly.assemblyId, body);

    for (const part of assembly.parts) {
      const material = materialProfile(part.materialId);
      const colliderDesc = colliderDescriptorForPart(this.R, part)
        .setTranslation(
          part.localTransform.position.x,
          part.localTransform.position.y,
          part.localTransform.position.z,
        )
        .setRotation(part.localTransform.rotation)
        .setDensity(material.density)
        .setFriction(material.friction)
        .setRestitution(material.restitution);
      const collider = this.world.createCollider(colliderDesc, body);
      this.colliderInfoByHandle.set(collider.handle, {
        role: 'part',
        assemblyId: assembly.assemblyId,
        partId: part.partId,
      });
    }
  }

  _buildConstraint(constraint) {
    const bodyA = this.bodyByAssemblyId.get(constraint.assemblyAId);
    if (!bodyA) return;
    const bodyB = this.bodyByAssemblyId.get(constraint.assemblyBId) ?? this._anchorBodyFor(bodyA);
    let params;
    if (constraint.type === 'fixed') {
      params = this.R.JointData.fixed(
        constraint.localAnchorA,
        identityQuaternion(),
        constraint.localAnchorB,
        identityQuaternion(),
      );
    } else if (constraint.type === 'prismatic') {
      params = this.R.JointData.prismatic(
        constraint.localAnchorA,
        constraint.localAnchorB,
        normalizeVector(constraint.localAxisA),
      );
      if (constraint.limits?.enabled) {
        params.limitsEnabled = true;
        params.limits = [constraint.limits.min, constraint.limits.max];
      }
    } else {
      params = this.R.JointData.revolute(
        constraint.localAnchorA,
        constraint.localAnchorB,
        normalizeVector(constraint.localAxisA),
      );
      if (constraint.limits?.enabled) {
        params.limitsEnabled = true;
        params.limits = [constraint.limits.min, constraint.limits.max];
      }
    }
    const joint = this.world.createImpulseJoint(params, bodyA, bodyB, true);
    if (
      constraint.limits?.enabled &&
      ['revolute', 'prismatic'].includes(constraint.type) &&
      'setLimits' in joint
    ) {
      joint.setLimits(constraint.limits.min, constraint.limits.max);
    }
    joint.setContactsEnabled(constraint.collideConnected === true);
    // Drives are applied manually each substep (see _applyMotorTorques) so their
    // torque respects maxImpulse and the frame feels the reaction torque.
    this.constraintRuntime.set(constraint.constraintId, {
      definition: constraint,
      joint,
      bodyA,
      bodyB,
      initialRelativeRotation: multiplyQuaternion(inverseQuaternion(bodyA.rotation()), bodyB.rotation()),
    });
  }

  _buildMeshSupports() {
    const visiblySupported = new Set();
    for (const constraint of this.document.constraints ?? []) {
      if (constraint.type !== 'revolute') continue;
      visiblySupported.add(constraint.assemblyAId);
      visiblySupported.add(constraint.assemblyBId);
    }
    for (const coupling of this.document.rotationCouplings ?? []) {
      if (coupling.style !== 'mesh') continue;
      for (const [assemblyId, otherAssemblyId] of [
        [coupling.assemblyAId, coupling.assemblyBId],
        [coupling.assemblyBId, coupling.assemblyAId],
      ]) {
        if (visiblySupported.has(assemblyId) || this.meshSupportRuntime.has(assemblyId)) continue;
        const assembly = this.document.assemblies.find((item) => item.assemblyId === assemblyId);
        const body = this.bodyByAssemblyId.get(assemblyId);
        if (!assembly || !body?.isDynamic()) continue;
        const frame = cogwheelWorldFrame(assembly);
        if (!frame) continue;

        // If the cog it meshes with already has a real frame bearing, inherit
        // that frame internally. Otherwise pin this cog to its placed world
        // position. Neither case creates a document relationship or a visual
        // bearing: the mesh itself is the user's authored connection.
        const otherBearing = (this.document.constraints ?? []).find(
          (item) =>
            item.type === 'revolute' &&
            (item.assemblyAId === otherAssemblyId || item.assemblyBId === otherAssemblyId),
        );
        const hostAssemblyId = otherBearing
          ? otherBearing.assemblyAId === otherAssemblyId
            ? otherBearing.assemblyBId
            : otherBearing.assemblyAId
          : null;
        let hostBody = this.bodyByAssemblyId.get(hostAssemblyId);
        let localAnchorHost;
        let localAxisHost;
        if (hostBody) {
          const hostAssembly = this.document.assemblies.find((item) => item.assemblyId === hostAssemblyId);
          localAnchorHost = inverseTransformPoint(hostAssembly.transform, frame.center);
          localAxisHost = inverseTransformDirection(hostAssembly.transform, frame.axis);
        } else {
          hostBody = this._anchorBodyFor(body);
          localAnchorHost = inverseTransformPoint(assembly.transform, frame.center);
          localAxisHost = inverseTransformDirection(assembly.transform, frame.axis);
        }
        const localAnchorCog = inverseTransformPoint(assembly.transform, frame.center);
        const params = this.R.JointData.revolute(
          localAnchorHost,
          localAnchorCog,
          normalizeVector(localAxisHost),
        );
        const joint = this.world.createImpulseJoint(params, hostBody, body, true);
        joint.setContactsEnabled(false);
        this.meshSupportRuntime.set(assemblyId, {
          couplingId: coupling.couplingId,
          hostAssemblyId,
          joint,
        });
      }
    }
  }

  _buildForceElement(element) {
    const bodyA = this.bodyByAssemblyId.get(element.assemblyAId);
    const bodyB = this.bodyByAssemblyId.get(element.assemblyBId);
    if (element.type === 'linear_spring') {
      if (!bodyA || !bodyB) return;
      // Rapier's spring joint is tension-only for this adapter's authored
      // relationship vocabulary. Keep the relationship editable, but solve
      // the public spring fields as a bounded bidirectional impulse so a
      // preloaded return spring can physically support a plate.
      this.springRuntime.set(element.forceElementId, { definition: element, joint: null, bodyA, bodyB });
      return;
    }

    const constraint = this.constraintRuntime.get(element.constraintId);
    if (!constraint) return;
    // Torsion springs are applied manually each substep (see _applyMotorTorques)
    // in the same measured-angle space the inspector reports, capped by maxImpulse.
    this.springRuntime.set(element.forceElementId, {
      definition: element,
      joint: constraint.joint,
      constraintId: element.constraintId,
      bodyA: constraint.bodyA,
      bodyB: constraint.bodyB,
    });
  }

  _buildSensor(sensor) {
    let body = sensor.assemblyId ? this.bodyByAssemblyId.get(sensor.assemblyId) : null;
    let localTransform = sensor.localTransform;
    if (!body) {
      body = this.world.createRigidBody(
        this.R.RigidBodyDesc.fixed()
          .setTranslation(
            sensor.localTransform.position.x,
            sensor.localTransform.position.y,
            sensor.localTransform.position.z,
          )
          .setRotation(sensor.localTransform.rotation)
          .setUserData({ role: 'sensor-anchor', sensorId: sensor.sensorId }),
      );
      this.anchorBodies.push(body);
      localTransform = {
        position: { x: 0, y: 0, z: 0 },
        rotation: identityQuaternion(),
      };
    }
    const half = {
      x: sensor.size.x / 2,
      y: sensor.size.y / 2,
      z: sensor.size.z / 2,
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
    this.colliderInfoByHandle.set(collider.handle, {
      role: 'sensor',
      assemblyId: sensor.assemblyId,
      sensorId: sensor.sensorId,
    });
    this.sensorRuntime.set(sensor.sensorId, {
      definition: sensor,
      collider,
      touching: new Set(),
      fired: false,
    });
  }

  _buildLatch(latch) {
    const runtime = {
      definition: latch,
      joint: null,
      state: latch.armed ? 'latched' : 'open',
      releasedAt: null,
      catchArmed: latch.armed === true,
    };
    this.latchRuntime.set(latch.latchId, runtime);
    if (latch.armed) this._lockLatch(runtime);
  }

  _lockLatch(runtime) {
    if (runtime.joint) return;
    const bodyA = this.bodyByAssemblyId.get(runtime.definition.assemblyAId);
    if (!bodyA) return;
    const bodyB = this.bodyByAssemblyId.get(runtime.definition.assemblyBId)
      ?? (runtime.bodyB?.isValid() ? runtime.bodyB : this._anchorBodyFor(bodyA));
    const anchorA = runtime.definition.localAnchorA ?? { x: 0, y: 0, z: 0 };
    const anchorWorldA = transformPoint(bodyTransformOf(bodyA), anchorA);
    const anchorB = runtime.definition.localAnchorB
      ?? inverseTransformPoint(bodyTransformOf(bodyB), anchorWorldA);
    const relativeFrame = multiplyQuaternion(inverseQuaternion(bodyB.rotation()), bodyA.rotation());
    const params = this.R.JointData.fixed(
      anchorA,
      identityQuaternion(),
      anchorB,
      relativeFrame,
    );
    runtime.joint = this.world.createImpulseJoint(params, bodyA, bodyB, true);
    runtime.joint.setContactsEnabled(false);
    runtime.bodyA = bodyA;
    runtime.bodyB = bodyB;
    runtime.state = 'latched';
  }

  _anchorBodyFor(body) {
    const bodyTransform = bodyTransformOf(body);
    const anchor = this.world.createRigidBody(
      this.R.RigidBodyDesc.fixed()
        .setTranslation(bodyTransform.position.x, bodyTransform.position.y, bodyTransform.position.z)
        .setRotation(bodyTransform.rotation)
        .setUserData({ role: 'world-anchor' }),
    );
    this.anchorBodies.push(anchor);
    return anchor;
  }

  releaseLatch(latchId) {
    const runtime = this.latchRuntime.get(latchId);
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

  armLatch(latchId) {
    const runtime = this.latchRuntime.get(latchId);
    if (!runtime) return false;
    const transition = resolveLatchTransition(
      runtime.definition,
      { state: runtime.state, armed: runtime.catchArmed },
      { type: 'arm' },
    );
    runtime.releasedAt = null;
    runtime.catchArmed = transition.armed;
    if (transition.command === 'lock' || !runtime.definition.assemblyBId) {
      this._lockLatch(runtime);
    } else {
      runtime.state = transition.state;
    }
    return true;
  }

  _updateCatchLatches() {
    for (const runtime of this.latchRuntime.values()) {
      if (
        runtime.definition.mode !== 'catch' ||
        !runtime.catchArmed ||
        runtime.joint ||
        !runtime.definition.assemblyBId
      ) continue;
      const bodyA = this.bodyByAssemblyId.get(runtime.definition.assemblyAId);
      const bodyB = this.bodyByAssemblyId.get(runtime.definition.assemblyBId);
      if (!bodyA || !bodyB) continue;
      const anchorA = runtime.definition.localAnchorA ?? { x: 0, y: 0, z: 0 };
      const anchorB = runtime.definition.localAnchorB ?? { x: 0, y: 0, z: 0 };
      const pointA = transformPoint(bodyTransformOf(bodyA), anchorA);
      const pointB = transformPoint(bodyTransformOf(bodyB), anchorB);
      const distance = vectorLength(subtractVector(pointA, pointB));
      const relativeSpeed = vectorLength(subtractVector(
        bodyA.velocityAtPoint(pointA),
        bodyB.velocityAtPoint(pointB),
      ));
      const transition = resolveLatchTransition(
        runtime.definition,
        { state: runtime.state, armed: runtime.catchArmed },
        { type: 'proximity', distance, relativeSpeed },
      );
      runtime.state = transition.state;
      runtime.catchArmed = transition.armed;
      if (transition.command === 'lock') this._lockLatch(runtime);
    }
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
  }

  setSpellFields(fields = [], activeDevices = []) {
    this.spellFields = fields.filter((field) => field?.active !== false);
    this.activeSpellDevices = activeDevices;
  }

  applyTestImpulse(assemblyId, impulse = { x: 0, y: 2, z: 0 }) {
    const body = this.bodyByAssemblyId.get(assemblyId);
    if (!body?.isDynamic()) return false;
    body.applyImpulse(impulse, true);
    return true;
  }

  applyTestTorque(assemblyId, torqueImpulse = { x: 1, y: 0, z: 0 }) {
    const body = this.bodyByAssemblyId.get(assemblyId);
    if (!body?.isDynamic()) return false;
    body.applyTorqueImpulse(torqueImpulse, true);
    return true;
  }

  step(deltaSeconds) {
    if (this.paused || !this.world) return this.getSnapshot();
    const stepStartedAt = nowMs();
    this.accumulator += Math.min(MAX_FRAME_DT, Math.max(0, deltaSeconds));
    let steps = 0;
    this.triggerEvents = [];
    this.forceApplications = [];
    while (this.accumulator >= MECHANICS_FIXED_DT && steps < MAX_SUBSTEPS) {
      this._updateCatchLatches();
      this._applyRotationCouplings();
      this._applyMotorTorques();
      this._applyLinearSprings();
      this._applySpellFields();
      this.world.step(this.eventQueue);
      this._drainCollisionEvents();
      this._emitHeldSensorEvents();
      this._cleanupEscapedProjectiles();
      this._updateGateStates();
      this.elapsedSeconds += MECHANICS_FIXED_DT;
      this.accumulator -= MECHANICS_FIXED_DT;
      steps += 1;
    }
    if (steps > 0) {
      this.lastStepDurationMs = nowMs() - stepStartedAt;
      this.peakStepDurationMs = Math.max(this.peakStepDurationMs, this.lastStepDurationMs);
      this.physicsStepCount += steps;
      this.totalStepDurationMs += this.lastStepDurationMs;
    }
    return this.getSnapshot();
  }

  _applyMotorTorques() {
    // Joint drives and torsion springs as bounded torques rather than the
    // engine's unbounded velocity/position servos: the torque never exceeds
    // maxImpulse, and the reaction torque acts on the frame body, so a motor
    // on an unanchored machine visibly pushes back against its own stand.
    for (const runtime of this.constraintRuntime.values()) {
      const drive = runtime.definition.drive;
      if (!drive?.enabled || runtime.definition.type !== 'revolute') continue;
      this._applyAxisTorque(runtime, (relativeVelocity) =>
        clampMagnitude(
          drive.damping * (drive.targetVelocity - relativeVelocity),
          drive.maxImpulse ?? 18,
        ),
        { continuous: Math.abs(drive.targetVelocity ?? 0) > 0.0001 },
      );
    }
    for (const runtime of this.springRuntime.values()) {
      const definition = runtime.definition;
      if (definition.type !== 'torsion_spring') continue;
      const constraint = this.constraintRuntime.get(definition.constraintId);
      if (!constraint || constraint.definition.type !== 'revolute') continue;
      const angle = this._jointStateForGate(definition.constraintId).angleRadians ?? 0;
      this._applyAxisTorque(constraint, (relativeVelocity) =>
        clampMagnitude(
          definition.stiffness * (definition.restAngle - angle) -
            definition.damping * relativeVelocity,
          definition.maxImpulse ?? 32,
        ),
        { continuous: false },
      );
    }
  }

  _applyLinearSprings() {
    for (const runtime of this.springRuntime.values()) {
      const definition = runtime.definition;
      if (definition.type !== 'linear_spring') continue;
      const { bodyA, bodyB } = runtime;
      const anchorA = transformPoint(bodyTransformOf(bodyA), definition.localAnchorA);
      const anchorB = transformPoint(bodyTransformOf(bodyB), definition.localAnchorB);
      const delta = subtractVector(anchorB, anchorA);
      const length = vectorLength(delta);
      if (length < 0.0001) continue;
      const direction = scaleVector(delta, 1 / length);
      const relativeVelocity = dotVector(subtractVector(bodyB.linvel(), bodyA.linvel()), direction);
      const scalar = clampMagnitude(
        Number(definition.stiffness ?? 0) * (length - Number(definition.restLength ?? 0)) +
          Number(definition.damping ?? 0) * relativeVelocity,
        (Number(definition.maxImpulse ?? 32) || 32) / MECHANICS_FIXED_DT,
      );
      const impulse = scaleVector(direction, -scalar * MECHANICS_FIXED_DT);
      if (bodyB.isDynamic()) {
        bodyB.applyImpulse(impulse, true);
        if (Math.abs(scalar) > SETTLING_TORQUE) bodyB.wakeUp();
      }
      if (bodyA.isDynamic()) bodyA.applyImpulse(scaleVector(impulse, -1), true);
    }
  }

  _applyAxisTorque(runtime, torqueFor, { continuous = false } = {}) {
    const { definition, bodyA, bodyB } = runtime;
    const axis = normalizeVector(transformDirection(bodyTransformOf(bodyA), definition.localAxisA));
    const relativeVelocity = dotVector(bodyB.angvel(), axis) - dotVector(bodyA.angvel(), axis);
    const torque = torqueFor(relativeVelocity);
    if (!Number.isFinite(torque) || Math.abs(torque) < SETTLING_TORQUE) return;
    const impulse = scaleVector(axis, torque * MECHANICS_FIXED_DT);
    // Finite springs and passive brakes must not wake a settled body every
    // fixed step. A meaningful motor still wakes its mechanism, while an
    // external collision, impulse, or spell force wakes finite bodies through
    // Rapier's normal paths.
    if (bodyB.isDynamic()) bodyB.applyTorqueImpulse(impulse, continuous);
    if (bodyA.isDynamic()) bodyA.applyTorqueImpulse(scaleVector(impulse, -1), continuous);
  }

  _applyRotationCouplings() {
    for (const coupling of this.document.rotationCouplings ?? []) {
      const bodyA = this.bodyByAssemblyId.get(coupling.assemblyAId);
      const bodyB = this.bodyByAssemblyId.get(coupling.assemblyBId);
      if (!bodyA?.isDynamic() || !bodyB?.isDynamic()) continue;
      const continuous =
        this.continuouslyDrivenAssemblyIds.has(coupling.assemblyAId) ||
        this.continuouslyDrivenAssemblyIds.has(coupling.assemblyBId);
      if (!continuous && bodyA.isSleeping() && bodyB.isSleeping()) continue;
      const stateA = this._rotationState(coupling.assemblyAId, coupling.axisA, bodyA);
      const stateB = this._rotationState(coupling.assemblyBId, coupling.axisB, bodyB);
      const rawRatio = Number(coupling.ratio);
      const ratio = Math.abs(rawRatio) < 0.01 ? (rawRatio < 0 ? -0.01 : 0.01) : rawRatio;
      const efficiency = clamp(coupling.efficiency ?? 0.92, 0.01, 1);
      const phaseError = normalizeAngle(
        stateB.angle - (stateA.angle * ratio + (coupling.phaseOffset ?? 0)),
      );
      const velocityError = stateB.velocity - stateA.velocity * ratio;
      // Solve the coupling as a velocity-level constraint: one impulse sized
      // by the true effective inertias that removes the velocity error plus a
      // bounded phase-correction bias. Unlike a fixed-gain torque, this can
      // never overshoot a light wheel — it lands exactly on the ratio.
      const invInertiaA = 1 / Math.max(1e-6, angularInertiaAboutAxis(bodyA, stateA.worldAxis));
      const invInertiaB = 1 / Math.max(1e-6, angularInertiaAboutAxis(bodyB, stateB.worldAxis));
      const phaseBias = clamp(phaseError * 10, -2.5, 2.5);
      const effectiveMass = 1 / Math.max(1e-9, invInertiaB + ratio * ratio * efficiency * invInertiaA);
      const requestedImpulse = -(velocityError + phaseBias) * effectiveMass;
      const capacityImpulse = Math.max(0, coupling.torqueCapacity ?? 24) * MECHANICS_FIXED_DT;
      const impulseB = clamp(requestedImpulse, -capacityImpulse, capacityImpulse);
      const impulseA = -impulseB * ratio * efficiency;
      if (Math.abs(impulseA) + Math.abs(impulseB) >= SETTLING_TORQUE * MECHANICS_FIXED_DT) {
        bodyA.applyTorqueImpulse(scaleVector(stateA.worldAxis, impulseA), continuous);
        bodyB.applyTorqueImpulse(scaleVector(stateB.worldAxis, impulseB), continuous);
      }
      const slipped = Math.abs(requestedImpulse) > capacityImpulse + 1e-9;
      this.couplingStates.set(coupling.couplingId, {
        couplingId: coupling.couplingId,
        ratio,
        phaseError,
        velocityError,
        impulseA,
        impulseB,
        slipped,
        loadRatio:
          capacityImpulse > 0 ? Math.min(1, Math.abs(requestedImpulse) / capacityImpulse) : 1,
      });
    }
  }

  _rotationState(key, localAxis, body) {
    const normalized = signedTwistAngle(body.rotation(), localAxis);
    const trackerKey = `${key}:${localAxis.x}:${localAxis.y}:${localAxis.z}`;
    const previous = this.rotationTrackers.get(trackerKey);
    let unwrapped = normalized;
    if (previous) {
      let delta = normalized - previous.normalized;
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      unwrapped = previous.unwrapped + delta;
    }
    this.rotationTrackers.set(trackerKey, { normalized, unwrapped });
    const worldAxis = normalizeVector(rotateVector(localAxis, body.rotation()));
    return {
      angle: unwrapped,
      velocity: dotVector(body.angvel(), worldAxis),
      worldAxis,
    };
  }

  _applySpellFields() {
    // Rapier's addForce/addForceAtPoint accumulate across steps until reset
    // (addForceAtPoint contributes both a force and a torque), so clear the
    // previous step's spell forces before applying this step's set.
    for (const body of this.bodyByAssemblyId.values()) {
      if (body.isDynamic()) {
        body.resetForces(false);
        body.resetTorques(false);
      }
    }
    this.forceMagnitudeThisStep = new Map();
    for (const field of this.spellFields) {
      if (!field?.active) continue;
      if (field.fieldShape === 'target_force') {
        this._applyTargetedSpellForce(field);
        continue;
      }
      if (field.fieldShape === 'carrier_levitation') {
        this._applyCarrierLevitation(field);
        continue;
      }
      if (field.fieldShape === 'dispersion') {
        this._applyDispersionSpellField(field);
        continue;
      }
      if (field.fieldShape !== 'column') continue;
      this._applyColumnSpellField(field);
    }
  }

  _applyColumnSpellField(field) {
    if (field.materialKind === 'light') return;
    const direction = normalizeVector(field.direction ?? { x: 0, y: 1, z: 0 });
    const length = clamp(field.length ?? 4, 0.1, 42);
    const radius = clamp(field.radius ?? 0.5, 0.05, 4);
    let hit = this._castColumnSegment(field, field.origin, direction, length, radius);
    let mode = 'column';
    if (!hit && field.materialKind === 'water' && field.continuation) {
      const trajectory = waterColumnTrajectory(field);
      for (let index = 1; index < trajectory.length; index += 1) {
        const start = trajectory[index - 1].point;
        const delta = subtractVector(trajectory[index].point, start);
        const segmentLength = vectorLength(delta);
        if (segmentLength <= 0.000001) continue;
        const segmentDirection = scaleVector(delta, 1 / segmentLength);
        const progress = index / Math.max(1, trajectory.length - 1);
        const endScale = Number(field.continuation.radiusScaleAtEnd ?? 0.5);
        hit = this._castColumnSegment(
          field,
          start,
          segmentDirection,
          segmentLength,
          radius * (1 + (endScale - 1) * progress),
        );
        if (hit) {
          mode = 'water_column_continuation';
          break;
        }
      }
    }
    if (!hit) return;
    this.forceCandidateCount += 1;
    const body = hit.collider.parent();
    const assemblyId = body?.userData?.assemblyId ?? null;
    if (!body?.isDynamic() || !assemblyId) return;
    const requested = comparableForceLimit(
      field.materialKind ?? 'wind',
      'column',
      body.mass(),
      field.forceMagnitude ?? 0,
      field.materialKind === 'water'
        ? 1
        : Math.max(0.15, 1 - hit.distance / Math.max(length * 1.25, 0.001)),
    );
    this._applySampledSpellForce(
      field,
      body,
      assemblyId,
      { point: hit.point, direction: hit.direction, falloff: 1 },
      requested,
      mode,
    );
  }

  _castColumnSegment(field, origin, direction, length, radius) {
    const acceptsCollider = (collider) => {
      const data = collider.parent()?.userData ?? {};
      if (data.role === 'ground') return false;
      return !field.excludeAssemblyId || data.assemblyId !== field.excludeAssemblyId;
    };
    const exactCandidates = new Set();
    const center = addVector(origin, scaleVector(direction, length / 2));
    this.world.intersectionsWithShape(
      center,
      quaternionFromUpVector(direction),
      new this.R.Cylinder(length / 2, Math.max(0.001, radius)),
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
      { x: 0, y: 0, z: 0, w: 1 },
      direction,
      new this.R.Ball(Math.max(0.001, radius)),
      0,
      length,
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
      point: addVector(origin, scaleVector(direction, distance)),
      direction,
    };
  }

  _applyDispersionSpellField(field) {
    for (const [assemblyId, body] of this.bodyByAssemblyId) {
      if (!body.isDynamic()) continue;
      if (field.excludeAssemblyId && assemblyId === field.excludeAssemblyId) continue;
      const point = body.translation();
      const spread = sampleDispersionField(field, point);
      if (spread) {
        this.forceCandidateCount += 1;
        const requested = comparableForceLimit(
          field.materialKind,
          'dispersion',
          body.mass(),
          field.forceMagnitude,
          spread.falloff,
        );
        this._applySampledSpellForce(field, body, assemblyId, spread, requested, 'dispersion');
      }
      const curtain = sampleWaterCurtain(field, point);
      if (curtain) {
        this.forceCandidateCount += 1;
        const requested = comparableForceLimit(
          'water',
          'water_curtain',
          body.mass(),
          field.curtain?.forceMagnitude,
          curtain.falloff,
        );
        this._applySampledSpellForce(field, body, assemblyId, curtain, requested, 'water_curtain');
      }
    }
  }

  _applySampledSpellForce(field, body, assemblyId, sample, requested, mode) {
    const magnitude = this._takeBodyForceBudget(body, requested);
    if (magnitude <= 0) return;
    const force = scaleVector(sample.direction, magnitude);
    body.addForceAtPoint(force, sample.point, true);
    this.forceApplications.push({
      fieldId: field.id,
      deviceId: field.deviceId,
      assemblyId,
      mode,
      point: { ...sample.point },
      force,
      magnitude,
    });
    this.forceApplicationCount += 1;
  }

  _applyTargetedSpellForce(field) {
    const body = this.bodyByAssemblyId.get(field.targetAssemblyId);
    if (!body?.isDynamic()) return;
    const direction = normalizeVector(
      field.direction ?? { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    );
    const requestedMagnitude = field.forceMagnitude ?? 0;
    const magnitude = this._takeBodyForceBudget(body, requestedMagnitude);
    if (magnitude <= 0 || vectorLength(direction) <= 0.0001) return;
    const force = scaleVector(direction, magnitude);
    body.addForce(force, true);
    this.forceCandidateCount += 1;
    this.forceApplicationCount += 1;
    this.forceApplications.push({
      fieldId: field.id,
      deviceId: field.deviceId,
      assemblyId: field.targetAssemblyId,
      point: { ...body.translation() },
      force,
      magnitude,
    });
  }

  _applyCarrierLevitation(field) {
    const body = this.bodyByAssemblyId.get(field.targetAssemblyId);
    if (!body?.isDynamic()) return;
    const direction = normalizeVector(field.direction ?? { x: 0, y: 1, z: 0 });
    const guidanceDirection = normalizeVector(
      field.guidanceDirection ?? { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    );
    const capacity = clamp(field.forceMagnitude ?? 0, 0, 180);
    const desiredLift = body.mass() * (this.gravity + clamp(field.liftAcceleration ?? 0, 0, 12));
    if ((field.forceMagnitude ?? 0) > 180 || desiredLift > capacity) this.forceSaturationCount += 1;
    const liftForce = scaleVector(direction, Math.min(capacity, desiredLift));
    const guidanceForce = scaleVector(
      guidanceDirection,
      body.mass() * clamp(field.guidanceAcceleration ?? 0, 0, 8),
    );
    let force = addVector(liftForce, guidanceForce);
    const requestedMagnitude = vectorLength(force);
    const magnitude = this._takeBodyForceBudget(body, requestedMagnitude);
    if (magnitude <= 0) return;
    if (requestedMagnitude > 0.0001 && magnitude < requestedMagnitude) {
      force = scaleVector(force, magnitude / requestedMagnitude);
    }
    body.addForce(force, true);
    this.forceCandidateCount += 1;
    this.forceApplicationCount += 1;
    this.forceApplications.push({
      fieldId: field.id,
      deviceId: field.deviceId,
      assemblyId: field.targetAssemblyId,
      point: { ...body.translation() },
      force,
      magnitude,
    });
  }

  _takeBodyForceBudget(body, requestedMagnitude) {
    const requested = Math.max(0, requestedMagnitude ?? 0);
    const used = this.forceMagnitudeThisStep?.get(body.handle) ?? 0;
    const allowed = Math.max(0, Math.min(requested, 180 - used));
    this.forceMagnitudeThisStep?.set(body.handle, used + allowed);
    if (allowed + 1e-7 < requested) this.forceSaturationCount += 1;
    return allowed;
  }

  _drainCollisionEvents() {
    this.eventQueue.drainCollisionEvents((handleA, handleB, started) => {
      const infoA = this.colliderInfoByHandle.get(handleA);
      const infoB = this.colliderInfoByHandle.get(handleB);
      const sensorInfo = infoA?.role === 'sensor' ? infoA : infoB?.role === 'sensor' ? infoB : null;
      const otherInfo = sensorInfo === infoA ? infoB : infoA;
      if (!sensorInfo || !otherInfo?.assemblyId) return;
      const runtime = this.sensorRuntime.get(sensorInfo.sensorId);
      if (!runtime) return;
      const assembly = this.document.assemblies.find((item) => item.assemblyId === otherInfo.assemblyId);
      if (
        runtime.definition.acceptedTags?.length > 0 &&
        !runtime.definition.acceptedTags.some((tag) => assembly?.tags?.includes(tag))
      ) return;
      if (started) runtime.touching.add(otherInfo.assemblyId);
      else runtime.touching.delete(otherInfo.assemblyId);
      const policy = runtime.definition.triggerPolicy;
      const shouldFire =
        (started && ['entered', 'one_shot'].includes(policy)) ||
        (!started && policy === 'exited');
      if (shouldFire && !(policy === 'one_shot' && runtime.fired)) {
        runtime.fired = true;
        this._emitSensorEvent(runtime, otherInfo.assemblyId, started ? 'entered' : 'exited');
      }
      if (!started && runtime.touching.size === 0 && policy !== 'one_shot') runtime.fired = false;
    });
  }

  _emitHeldSensorEvents() {
    for (const runtime of this.sensorRuntime.values()) {
      if (runtime.definition.triggerPolicy !== 'held') continue;
      runtime.fired = runtime.touching.size > 0;
      for (const assemblyId of runtime.touching) this._emitSensorEvent(runtime, assemblyId, 'held');
    }
  }

  _emitSensorEvent(runtime, assemblyId, event) {
    this.triggerEvents.push({
      sensorId: runtime.definition.sensorId,
      assemblyId,
      event,
      elapsedSeconds: this.elapsedSeconds,
    });
    for (const latch of this.document.latches ?? []) {
      if (
        latch.releaseSensorId === runtime.definition.sensorId
        && this.latchRuntime.get(latch.latchId)?.state === 'latched'
      ) this.releaseLatch(latch.latchId);
    }
  }

  _cleanupEscapedProjectiles() {
    for (const assemblyId of this.projectileAssemblyIds) {
      const body = this.bodyByAssemblyId.get(assemblyId);
      if (!body) continue;
      const position = body.translation();
      const escaped =
        Math.hypot(position.x, position.z) > PROJECTILE_ESCAPE_RADIUS ||
        position.y < PROJECTILE_ESCAPE_MIN_Y ||
        position.y > PROJECTILE_ESCAPE_MAX_Y;
      if (!escaped) continue;
      this.world.removeRigidBody(body);
      this.bodyByAssemblyId.delete(assemblyId);
      for (const [handle, info] of this.colliderInfoByHandle) {
        if (info.assemblyId === assemblyId) this.colliderInfoByHandle.delete(handle);
      }
      this.removedAssemblyIds.add(assemblyId);
    }
  }

  _updateGateStates() {
    for (const gate of this.document.gates ?? []) {
      const jointState = this._jointStateForGate(gate.driverConstraintId);
      const previous = this.gateStates.get(gate.gateId) ?? null;
      this.gateStates.set(gate.gateId, resolveMechanicalGate(gate, jointState, previous));
    }
  }

  _jointStateForGate(constraintId) {
    const runtime = this.constraintRuntime.get(constraintId);
    if (!runtime) return {};
    const { definition, bodyA, bodyB, initialRelativeRotation } = runtime;
    if (definition.type === 'prismatic') {
      const anchorA = transformPoint(bodyTransformOf(bodyA), definition.localAnchorA);
      const anchorB = transformPoint(bodyTransformOf(bodyB), definition.localAnchorB);
      const axis = normalizeVector(transformDirection(bodyTransformOf(bodyA), definition.localAxisA));
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
    const relative = multiplyQuaternion(inverseQuaternion(bodyA.rotation()), bodyB.rotation());
    const delta = multiplyQuaternion(inverseQuaternion(initialRelativeRotation), relative);
    return {
      angleRadians: signedTwistAngle(delta, definition.localAxisA),
      axialError: 0,
    };
  }

  getSnapshot() {
    const assemblies = {};
    let awakeBodyCount = 0;
    for (const [assemblyId, body] of this.bodyByAssemblyId) {
      const position = body.translation();
      const rotation = body.rotation();
      const velocity = body.linvel();
      const angularVelocity = body.angvel();
      assemblies[assemblyId] = {
        position: { ...position },
        rotation: { ...rotation },
        velocity: { ...velocity },
        angularVelocity: { ...angularVelocity },
        mass: body.mass(),
        sleeping: body.isSleeping(),
        fixed: body.isFixed(),
      };
      if (body.isDynamic() && !body.isSleeping()) awakeBodyCount += 1;
    }
    const constraints = {};
    for (const [constraintId, runtime] of this.constraintRuntime) {
      constraints[constraintId] = {
        type: runtime.definition.type,
        ...this._jointStateForGate(constraintId),
      };
    }
    const sensors = {};
    for (const [sensorId, runtime] of this.sensorRuntime) {
      sensors[sensorId] = {
        touching: [...runtime.touching],
        active: runtime.touching.size > 0,
        fired: runtime.fired,
      };
    }
    const latches = {};
    for (const [latchId, runtime] of this.latchRuntime) {
      latches[latchId] = {
        state: runtime.state,
        releasedAt: runtime.releasedAt,
        catchArmed: runtime.catchArmed,
      };
    }
    return {
      ready: Boolean(this.world),
      paused: this.paused,
      elapsedSeconds: this.elapsedSeconds,
      // Counts are owned live resources, not document definitions. In
      // particular, the ground and anchors are real Rapier bodies too.
      bodyCount: this.bodyByAssemblyId.size + this.anchorBodies.length + (this.groundBody ? 1 : 0),
      assemblyBodyCount: this.bodyByAssemblyId.size,
      groundBodyCount: this.groundBody ? 1 : 0,
      colliderCount: this.colliderInfoByHandle.size,
      // Sensors are the only persistent collision-event subscribers. The
      // EventQueue is a separate owned WASM resource, counted explicitly.
      collisionListenerCount: this.sensorRuntime.size,
      eventQueueCount: this.eventQueue ? 1 : 0,
      retainedSnapshotCount: 0,
      // Short aliases kept for the published debug contract.
      listenerCount: this.sensorRuntime.size,
      snapshotCount: 0,
      projectileCount: [...this.projectileAssemblyIds].filter((id) => this.bodyByAssemblyId.has(id)).length,
      removedAssemblyIds: [...this.removedAssemblyIds],
      jointCount:
        this.constraintRuntime.size +
        this.meshSupportRuntime.size +
        [...this.springRuntime.values()].filter((item) => item.definition.type === 'linear_spring').length +
        [...this.latchRuntime.values()].filter((item) => item.joint).length,
      rebuildCount: this.rebuildCount,
      assemblies,
      constraints,
      sensors,
      latches,
      gates: Object.fromEntries(this.gateStates),
      couplings: Object.fromEntries(this.couplingStates),
      triggerEvents: [...this.triggerEvents],
      forceApplications: [...this.forceApplications],
      forceApplicationCount: this.forceApplicationCount,
      forceCandidateCount: this.forceCandidateCount,
      forceSaturationCount: this.forceSaturationCount,
      awakeBodyCount,
      physicsStepCount: this.physicsStepCount,
      lastStepDurationMs: this.lastStepDurationMs,
      averageStepDurationMs:
        this.physicsStepCount > 0 ? this.totalStepDurationMs / this.physicsStepCount : 0,
      peakStepDurationMs: this.peakStepDurationMs,
      activeSpellDevices: [...this.activeSpellDevices],
    };
  }

  dispose() {
    this.eventQueue?.free();
    this.world?.free();
    this.eventQueue = null;
    this.world = null;
    this.bodyByAssemblyId.clear();
    this.colliderInfoByHandle.clear();
    this.constraintRuntime.clear();
    this.meshSupportRuntime.clear();
    this.springRuntime.clear();
    this.sensorRuntime.clear();
    this.latchRuntime.clear();
    this.rotationTrackers.clear();
    this.gateStates.clear();
    this.couplingStates.clear();
    this.anchorBodies = [];
    this.projectileAssemblyIds.clear();
    this.removedAssemblyIds.clear();
    this.continuouslyDrivenAssemblyIds.clear();
    this.groundBody = null;
    this.spellFields = [];
    this.activeSpellDevices = [];
    this.triggerEvents = [];
    this.forceApplications = [];
  }
}

function colliderDescriptorForPart(R, part) {
  const half = { x: part.size.x / 2, y: part.size.y / 2, z: part.size.z / 2 };
  if (part.shape === 'sphere') return R.ColliderDesc.ball(Math.max(half.x, half.y, half.z));
  if (part.shape === 'cylinder') return R.ColliderDesc.cylinder(half.y, Math.max(half.x, half.z));
  // Cogwheels collide as plain disks at their root radius: teeth are visual
  // only, and meshed pairs (centers at the sum of pitch radii) must not have
  // their colliders fighting the rotation coupling.
  if (part.shape === 'cogwheel') return R.ColliderDesc.cylinder(half.y, cogwheelRootRadius(part.size));
  if (part.shape === 'wedge') {
    const points = new Float32Array([
      -half.x, -half.y, -half.z,
      half.x, -half.y, -half.z,
      -half.x, half.y, -half.z,
      -half.x, -half.y, half.z,
      half.x, -half.y, half.z,
      -half.x, half.y, half.z,
    ]);
    return R.ColliderDesc.convexHull(points) ?? R.ColliderDesc.cuboid(half.x, half.y, half.z);
  }
  return R.ColliderDesc.cuboid(half.x, half.y, half.z);
}

function bodyTransformOf(body) {
  return { position: body.translation(), rotation: body.rotation() };
}

// Scalar angular inertia of a body about a world-space unit axis: âᵀ·I·â
// from Rapier's effective (world-frame) angular inertia matrix.
function angularInertiaAboutAxis(body, axis) {
  const m = body.effectiveAngularInertia();
  return (
    m.m11 * axis.x * axis.x +
    m.m22 * axis.y * axis.y +
    m.m33 * axis.z * axis.z +
    2 * (m.m12 * axis.x * axis.y + m.m13 * axis.x * axis.z + m.m23 * axis.y * axis.z)
  );
}

function identityQuaternion() {
  return { x: 0, y: 0, z: 0, w: 1 };
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

function clampMagnitude(value, magnitude) {
  const limit = Math.max(0, magnitude);
  return clamp(value, -limit, limit);
}

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}
