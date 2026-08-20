import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { LevitationPhysics } from '../src/scene/levitationPhysics.js';

await RAPIER.init({});

test('levitation projectile identity and age follow deterministic simulated time', () => {
  const physics = new LevitationPhysics(RAPIER);
  const firstId = physics.spawnProjectile({
    position: { x: 0, y: 2, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
  });
  const secondId = physics.spawnProjectile({
    position: { x: 1, y: 2, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
  });

  physics.step(0.1);
  const ageAfterCappedHitch = physics.getProjectileTransforms()[0].age;
  physics.step(-1);
  physics.step(Number.NaN);

  assert.deepEqual([firstId, secondId], ['proj-1', 'proj-2']);
  assert.equal(ageAfterCappedHitch, 8 / 120);
  assert.equal(physics.getProjectileTransforms()[0].age, ageAfterCappedHitch);
  physics.dispose();
});
