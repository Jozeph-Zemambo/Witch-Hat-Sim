// Rapier physics for the Character lab.
//
// The character is a real dynamic rigid body (locked rotations, capsule
// collider, ~55 kg) so it falls under gravity and its weight transfers to
// anything it stands on. A balanced seesaw plank sits on the auto-walk loop to
// prove the weight transfer: stepping onto one end tips it.
//
// Locomotion stays authored (the walk/jump state machine picks velocities); the
// solver owns vertical motion and contacts. Per this repo's known Rapier
// gotcha, forces AND torques are reset on every fixed step even though we
// mostly drive velocities — any future addForceAtPoint would otherwise persist.

import { loadRapier } from '../mechanics/rapier-loader.js';

export { loadRapier } from '../mechanics/rapier-loader.js';

const FIXED_DT = 1 / 120;
const MAX_SUBSTEPS = 8;

// Capsule spans center ± (halfHeight + radius); rest translation puts the
// bottom of the capsule exactly on the ground plane (y = 0).
export const CAPSULE_RADIUS = 0.24;
export const CAPSULE_HALF_HEIGHT = 0.39;
export const BODY_CENTER_Y = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS; // 0.63 = hip height
export const CHARACTER_MASS = 55;

export const SEESAW = {
  position: { x: 0, z: 2.4 }, // on the auto-walk ring, tangent along +x
  pivotHeight: 0.16,
  plankHalf: { x: 0.95, y: 0.03, z: 0.34 },
  plankMass: 12,
};

export class CharacterPhysics {
  constructor(rapier, { gravity = 20 } = {}) {
    this.R = rapier;
    this.gravity = gravity;
    this.world = new rapier.World({ x: 0, y: -gravity, z: 0 });
    this.world.timestep = FIXED_DT;
    this.accumulator = 0;
    this.intent = { vx: 0, vz: 0 };
    this._buildGround();
    this._buildCharacter();
    this._buildSeesaw();
  }

  _buildGround() {
    const R = this.R;
    const body = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0));
    this.world.createCollider(
      R.ColliderDesc.cuboid(24, 0.1, 24).setFriction(0.9).setRestitution(0),
      body,
    );
  }

  _buildCharacter() {
    const R = this.R;
    // Spawn a little above rest height so the drop under gravity is visible.
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(0, BODY_CENTER_Y + 1.1, 0)
        .lockRotations()
        .setLinearDamping(0)
        .setCanSleep(false),
    );
    const volume =
      Math.PI * CAPSULE_RADIUS * CAPSULE_RADIUS * ((4 / 3) * CAPSULE_RADIUS + 2 * CAPSULE_HALF_HEIGHT);
    const collider = this.world.createCollider(
      R.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS)
        .setDensity(CHARACTER_MASS / volume)
        .setFriction(0.15)
        .setRestitution(0),
      body,
    );
    this.character = { body, collider };
  }

  _buildSeesaw() {
    const R = this.R;
    const { position, pivotHeight, plankHalf, plankMass } = SEESAW;
    const fulcrum = this.world.createRigidBody(
      R.RigidBodyDesc.fixed().setTranslation(position.x, pivotHeight * 0.5, position.z),
    );
    this.world.createCollider(
      R.ColliderDesc.cylinder(pivotHeight * 0.5, 0.09).setFriction(0.8),
      fulcrum,
    );
    const plankY = pivotHeight + plankHalf.y;
    // Start tilted so the near (-x) end rests on the ground as a walkable ramp
    // instead of presenting a vertical ledge to the capsule.
    const tilt = Math.asin(Math.min(1, pivotHeight / plankHalf.x));
    const plank = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(position.x, plankY, position.z)
        .setRotation({ x: 0, y: 0, z: Math.sin(tilt / 2), w: Math.cos(tilt / 2) })
        .setAngularDamping(1.4)
        .setLinearDamping(0.4)
        .setCanSleep(false),
    );
    const volume = 8 * plankHalf.x * plankHalf.y * plankHalf.z;
    this.world.createCollider(
      R.ColliderDesc.cuboid(plankHalf.x, plankHalf.y, plankHalf.z)
        .setDensity(plankMass / volume)
        .setFriction(0.9)
        .setRestitution(0),
      plank,
    );
    // Hinge on the fulcrum's z axis so the plank tilts along its long (x) axis.
    const joint = this.R.JointData.revolute(
      { x: 0, y: pivotHeight * 0.5, z: 0 },
      { x: 0, y: -plankHalf.y, z: 0 },
      { x: 0, y: 0, z: 1 },
    );
    this.world.createImpulseJoint(joint, fulcrum, plank, true);
    this.plank = plank;
  }

  /** Desired horizontal velocity for the next steps (the solver keeps vy). */
  setMoveIntent(vx, vz) {
    this.intent.vx = vx;
    this.intent.vz = vz;
  }

  jump(verticalVelocity) {
    const body = this.character.body;
    const v = body.linvel();
    body.setLinvel({ x: v.x, y: verticalVelocity, z: v.z }, true);
  }

  /** Clamp the character into the stage bounds without fighting the solver. */
  clampToBounds(bounds) {
    const body = this.character.body;
    const t = body.translation();
    const cx = Math.min(bounds, Math.max(-bounds, t.x));
    const cz = Math.min(bounds, Math.max(-bounds, t.z));
    if (cx !== t.x || cz !== t.z) body.setTranslation({ x: cx, y: t.y, z: cz }, true);
  }

  isGrounded() {
    const R = this.R;
    const t = this.character.body.translation();
    const ray = new R.Ray({ x: t.x, y: t.y, z: t.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(
      ray,
      BODY_CENTER_Y + 0.09,
      true,
      undefined,
      undefined,
      this.character.collider,
      this.character.body,
    );
    return hit !== null;
  }

  step(dt) {
    this.accumulator += Math.min(dt, 0.1);
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
      const body = this.character.body;
      // Repo gotcha: persistent forces/torques must be cleared every step.
      body.resetForces(true);
      body.resetTorques(true);
      this.plank.resetForces(true);
      this.plank.resetTorques(true);
      const v = body.linvel();
      body.setLinvel({ x: this.intent.vx, y: v.y, z: this.intent.vz }, true);
      this.world.step();
      this.accumulator -= FIXED_DT;
      steps += 1;
    }
  }

  getCharacterState() {
    const t = this.character.body.translation();
    const v = this.character.body.linvel();
    return {
      x: t.x,
      z: t.z,
      airY: Math.max(0, t.y - BODY_CENTER_Y),
      verticalVelocity: v.y,
      grounded: this.isGrounded(),
    };
  }

  getPlankTransform() {
    const t = this.plank.translation();
    const r = this.plank.rotation();
    return {
      position: { x: t.x, y: t.y, z: t.z },
      quaternion: { x: r.x, y: r.y, z: r.z, w: r.w },
    };
  }

  dispose() {
    this.world.free();
    this.world = null;
    this.character = null;
    this.plank = null;
  }
}
