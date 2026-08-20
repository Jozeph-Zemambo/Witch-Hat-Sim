import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAssembly,
  createConstraint,
  createForceElement,
  createMechanicsDocument,
  createPrimitivePart,
  createRotationCoupling,
  createSensor,
} from '../../src/mechanics-engine/index.js';
import { loadRapier } from '../src/mechanics/rapier-loader.js';
import { MECHANICS_FIXED_DT, RapierMechanicsWorld } from '../src/mechanics/RapierMechanicsWorld.js';

const R = await loadRapier();

test('mechanics benchmark records stable step metrics for a dense construction scene', () => {
  const document = benchmarkDocument();
  const mechanics = new RapierMechanicsWorld(R, document, { paused: false });
  mechanics.setSpellFields(
    Array.from({ length: 4 }, (_, index) => ({
      id: `field:${index}`,
      active: true,
      fieldShape: 'column',
      origin: { x: -6 + index * 4, y: 1, z: -6 },
      direction: { x: 0, y: 0, z: 1 },
      length: 12,
      radius: 1.4,
      forceMagnitude: 8,
    })),
  );
  for (let index = 0; index < 120; index += 1) mechanics.step(MECHANICS_FIXED_DT);
  const snapshot = mechanics.getSnapshot();
  assert.equal(snapshot.bodyCount, 101, '100 assemblies plus the owned ground body');
  assert.equal(document.assemblies.reduce((sum, item) => sum + item.parts.length, 0), 400);
  assert.equal(document.constraints.length, 50);
  assert.equal(document.forceElements.length, 20);
  assert.equal(document.sensors.length, 20);
  assert.equal(document.rotationCouplings.length, 10);
  assert.ok(snapshot.physicsStepCount >= 120);
  assert.equal(snapshot.rebuildCount, 1);
  assert.ok(snapshot.awakeBodyCount >= 0 && snapshot.awakeBodyCount <= 100);
  assert.ok(snapshot.forceCandidateCount > 0);
  assert.ok(snapshot.colliderCount >= 421, `expected part, sensor, and ground colliders; received ${snapshot.colliderCount}`);
  assert.ok(snapshot.averageStepDurationMs < 50, `average fixed step was ${snapshot.averageStepDurationMs}ms`);
  assert.ok(snapshot.peakStepDurationMs < 500, `peak fixed step was ${snapshot.peakStepDurationMs}ms`);
  mechanics.dispose();
});

function benchmarkDocument() {
  const assemblies = Array.from({ length: 100 }, (_, index) => {
    const x = (index % 10) * 1.4 - 6.3;
    const z = Math.floor(index / 10) * 1.4 - 6.3;
    return createAssembly({
      assemblyId: `assembly:${index + 1}`,
      label: `Benchmark body ${index + 1}`,
      transform: { position: { x, y: 1 + (index % 3) * 0.5, z } },
      parts: Array.from({ length: 4 }, (_, partIndex) =>
        createPrimitivePart({
          partId: `assembly:${index + 1}:part-${partIndex + 1}`,
          preset: partIndex === 0 ? 'cuboid' : 'sphere',
          size: { x: 0.22, y: 0.22, z: 0.22 },
          localTransform: {
            position: {
              x: (partIndex % 2) * 0.3,
              y: Math.floor(partIndex / 2) * 0.3,
              z: 0,
            },
          },
        }),
      ),
    });
  });
  const constraints = Array.from({ length: 50 }, (_, index) =>
    createConstraint({
      constraintId: `constraint:${index + 1}`,
      type: 'revolute',
      assemblyAId: `assembly:${index * 2 + 1}`,
      assemblyBId: `assembly:${index * 2 + 2}`,
      localAxisA: { x: 0, y: 1, z: 0 },
    }),
  );
  const forceElements = Array.from({ length: 20 }, (_, index) =>
    createForceElement({
      forceElementId: `spring:${index + 1}`,
      assemblyAId: `assembly:${index * 2 + 1}`,
      assemblyBId: `assembly:${index * 2 + 2}`,
      restLength: 0.8,
      stiffness: 10,
      damping: 2,
    }),
  );
  const sensors = Array.from({ length: 20 }, (_, index) =>
    createSensor({
      sensorId: `sensor:${index + 1}`,
      assemblyId: `assembly:${index + 1}`,
      size: { x: 0.45, y: 0.45, z: 0.45 },
    }),
  );
  const rotationCouplings = Array.from({ length: 10 }, (_, index) =>
    createRotationCoupling({
      couplingId: `coupling:${index + 1}`,
      assemblyAId: `assembly:${index * 2 + 1}`,
      assemblyBId: `assembly:${index * 2 + 2}`,
      ratio: -1,
      torqueCapacity: 4,
    }),
  );
  return createMechanicsDocument({
    metadata: { name: 'Mechanics benchmark' },
    assemblies,
    constraints,
    forceElements,
    sensors,
    rotationCouplings,
  });
}
