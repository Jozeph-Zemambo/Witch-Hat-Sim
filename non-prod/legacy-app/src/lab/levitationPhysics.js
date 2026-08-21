// Rapier physics for the Levitation lab.
//
// Wind Levitation acts on the *carrier* (the object bearing the seal), and the spec
// requires that carrier motion eventually accounts for mass, gravity, collisions,
// drag, and torque (spec/sign-descriptions/levitation.md, "Wind" + Implementation
// Gap #6). This module wires that to a real, deterministic physics engine
// (@dimforge/rapier3d-compat) instead of faking it.
//
// Elemental Levitation (fire/water/light/earth) holds a generated orb; an uneven
// layout ejects it as a one-shot launch. The launched orb is a real dynamic body
// so it arcs under gravity and collides with the ground and obstacle.
//
// Rapier (a Rust→WASM engine) initializes asynchronously. loadRapier() caches the
// init promise; if WASM fails to load the lab degrades gracefully to a kinematic
// fallback (no hard crash) and reports physicsAvailable=false.

import { loadRapier } from '../mechanics/rapier-loader.js';

export { loadRapier } from '../mechanics/rapier-loader.js';

const FIXED_DT = 1 / 120;
const MAX_SUBSTEPS = 8;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class LevitationPhysics {
  /**
   * @param {typeof RAPIER} rapier resolved module from loadRapier()
   * @param {object} [opts]
   * @param {number} [opts.gravity=9.81]
   */
  constructor(rapier, opts = {}) {
    this.R = rapier;
    this.gravity = opts.gravity ?? 9.81;
    this.world = new rapier.World({ x: 0, y: -this.gravity, z: 0 });
    this.world.timestep = FIXED_DT;
    this.accumulator = 0;
    this.carrier = null;
    this.carrierIntent = { active: false, targetY: 1.6, capacityForce: 0, guidance: { x: 0, z: 0 }, torqueY: 0 };
    this.projectiles = [];
    this.obstacleBody = null;
    this.obstacleCollider = null;
    this._buildGround();
  }

  _buildGround() {
    const R = this.R;
    const body = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0));
    this.world.createCollider(
      R.ColliderDesc.cuboid(24, 0.1, 24).setRestitution(0.18).setFriction(0.9),
      body,
    );
    this.groundBody = body;
  }

  /** Create / move / remove the collidable obstacle. */
  setObstacle(enabled, position = { x: 0, y: 1, z: 0 }, half = 0.6) {
    const R = this.R;
    if (this.obstacleBody) {
      this.world.removeRigidBody(this.obstacleBody);
      this.obstacleBody = null;
      this.obstacleCollider = null;
    }
    if (!enabled) return;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z),
    );
    this.obstacleCollider = this.world.createCollider(
      R.ColliderDesc.cuboid(half, half, half).setRestitution(0.25).setFriction(0.7),
      body,
    );
    this.obstacleBody = body;
  }

  /**
   * Spawn the wind carrier (a plank-like platform that bears the seal).
   * @param {object} args
   * @param {{x:number,y:number,z:number}} args.half collider half-extents
   * @param {number} args.mass desired mass (kg)
   * @param {{x:number,y:number,z:number}} args.position
   */
  spawnCarrier({ half, mass, position }) {
    this.removeCarrier();
    const R = this.R;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setLinearDamping(0.55)
        .setAngularDamping(0.85)
        .setCanSleep(false),
    );
    const volume = 8 * half.x * half.y * half.z;
    const density = mass / Math.max(volume, 1e-3);
    const collider = this.world.createCollider(
      R.ColliderDesc.cuboid(half.x, half.y, half.z).setDensity(density).setFriction(0.6).setRestitution(0.1),
      body,
    );
    this.carrier = {
      body,
      collider,
      mass: body.mass(),
      half,
      restPosition: { ...position },
    };
    return this.carrier;
  }

  removeCarrier() {
    if (this.carrier) {
      this.world.removeRigidBody(this.carrier.body);
      this.carrier = null;
    }
  }

  /**
   * High-level levitation intent for the carrier. The per-step force is computed
   * from the body's live state so lift behaves like a real PD-controlled hold and
   * is hard-capped by support capacity (overload => it sags / falls).
   */
  setCarrierIntent({ active, targetY, capacityForce, guidance, torqueY, lateralCap }) {
    this.carrierIntent = {
      active: Boolean(active),
      targetY: targetY ?? this.carrierIntent.targetY,
      capacityForce: capacityForce ?? 0,
      guidance: guidance ?? { x: 0, z: 0 },
      torqueY: torqueY ?? 0,
      lateralCap: lateralCap ?? Infinity,
    };
  }

  /** Eject a generated-output orb as a real projectile. Returns its id. */
  spawnProjectile({ position, velocity, radius = 0.32, restitution = 0.3, id }) {
    const R = this.R;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setLinvel(velocity.x, velocity.y, velocity.z)
        .setLinearDamping(0.12)
        .setCanSleep(false),
    );
    this.world.createCollider(
      R.ColliderDesc.ball(radius).setDensity(0.8).setRestitution(restitution).setFriction(0.5),
      body,
    );
    const projectile = { id: id ?? `proj-${Math.random().toString(36).slice(2)}`, body, radius, age: 0 };
    this.projectiles.push(projectile);
    return projectile.id;
  }

  removeProjectile(id) {
    const index = this.projectiles.findIndex((p) => p.id === id);
    if (index >= 0) {
      this.world.removeRigidBody(this.projectiles[index].body);
      this.projectiles.splice(index, 1);
    }
  }

  clearProjectiles() {
    for (const projectile of this.projectiles) {
      this.world.removeRigidBody(projectile.body);
    }
    this.projectiles = [];
  }

  _applyCarrierForces() {
    const carrier = this.carrier;
    if (!carrier) return;
    const body = carrier.body;
    body.resetForces(true);
    body.resetTorques(true);
    const intent = this.carrierIntent;
    if (!intent.active) return; // inactive => gravity + collisions only (the carrier falls)

    const t = body.translation();
    const v = body.linvel();
    const m = carrier.mass;
    // PD hold toward the target hover height.
    const kp = 26;
    const kd = 9;
    const desiredAccel = kp * (intent.targetY - t.y) - kd * v.y;
    let lift = m * (this.gravity + desiredAccel);
    // Support capacity is a hard ceiling: if it is below the carrier's weight the
    // spell cannot hold the carrier and it sinks (overload).
    lift = clamp(lift, 0, intent.capacityForce);

    // Lateral guidance, capped so it reads as steered drift rather than a slingshot.
    let gx = intent.guidance.x;
    let gz = intent.guidance.z;
    const gMag = Math.hypot(gx, gz);
    if (gMag > intent.lateralCap && gMag > 1e-4) {
      const s = intent.lateralCap / gMag;
      gx *= s;
      gz *= s;
    }
    body.addForce({ x: gx, y: lift, z: gz }, true);
    if (intent.torqueY) body.addTorque({ x: 0, y: intent.torqueY, z: 0 }, true);
  }

  /** Advance physics by real time `dt`, using a fixed-step accumulator. */
  step(dt) {
    this.accumulator += Math.min(dt, 0.1);
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
      this._applyCarrierForces();
      this.world.step();
      this.accumulator -= FIXED_DT;
      steps += 1;
    }
    for (const projectile of this.projectiles) projectile.age += dt;
  }

  getCarrierTransform() {
    if (!this.carrier) return null;
    const t = this.carrier.body.translation();
    const r = this.carrier.body.rotation();
    const v = this.carrier.body.linvel();
    return {
      position: { x: t.x, y: t.y, z: t.z },
      quaternion: { x: r.x, y: r.y, z: r.z, w: r.w },
      velocity: { x: v.x, y: v.y, z: v.z },
    };
  }

  getProjectileTransforms() {
    return this.projectiles.map((projectile) => {
      const t = projectile.body.translation();
      const v = projectile.body.linvel();
      return {
        id: projectile.id,
        radius: projectile.radius,
        age: projectile.age,
        position: { x: t.x, y: t.y, z: t.z },
        speed: Math.hypot(v.x, v.y, v.z),
      };
    });
  }

  dispose() {
    this.world.free();
    this.world = null;
    this.carrier = null;
    this.projectiles = [];
  }
}
