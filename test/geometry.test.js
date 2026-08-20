/**
 * Geometry and vector analysis tests (VAL-GEOMETRY-001..004).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { importSpell } from '../src/compiler/importer.js';
import { analyzeGeometry } from '../src/compiler/geometry.js';

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
);

/**
 * @param {string} name
 */
function loadFixture(name) {
  return JSON.parse(readFileSync(path.join(fixturesDir, name), 'utf8'));
}

/**
 * @param {object} program
 */
function columnInstances(program) {
  return program.seals[0].symbols.filter(
    (s) =>
      s.objectId.startsWith('sign-instance:') &&
      s.resolvedRegistryId === 'sign.column',
  );
}

function tiltDeg(axis) {
  return (
    Math.atan2(Math.hypot(axis.x ?? 0, axis.y ?? 0), Math.abs(axis.z ?? 0)) *
    180 /
    Math.PI
  );
}

// VAL-GEOMETRY-001
test('VAL-GEOMETRY-001: expanded signs expose computed geometry and vector metadata', () => {
  const program = analyzeGeometry(importSpell(loadFixture('full-layout.json')));
  const instance = columnInstances(program)[0];
  assert.ok(instance.geometryAnalysis);
  assert.equal(instance.geometryAnalysis.radialDistance, 90);
  assert.equal(instance.geometryAnalysis.profileRotationDeg, 0);
  assert.equal(instance.geometryAnalysis.signAngleDeg, 0);
  assert.equal(instance.geometryAnalysis.scaleWeight, 0.9);
  assert.ok(instance.geometryAnalysis.directionVector);
  assert.ok(instance.geometryAnalysis.radialComponents);
  assert.equal(typeof instance.geometryAnalysis.radialComponents.inward, 'number');
  assert.equal(typeof instance.geometryAnalysis.radialComponents.outward, 'number');
  assert.equal(
    typeof instance.geometryAnalysis.radialComponents.tangentialClockwise,
    'number',
  );
});

// VAL-GEOMETRY-002
test('VAL-GEOMETRY-002: symmetric Watershot-like fixture is centered/balanced', () => {
  const program = analyzeGeometry(importSpell(loadFixture('watershot-centered.json')));
  const watershot = program.geometryAnalysis.seals[0].watershotColumn;
  assert.ok(watershot);
  assert.equal(watershot.template, 'watershot_like');
  assert.equal(watershot.centered, true);
  assert.equal(watershot.biased, false);
  assert.equal(watershot.columnGroup.columnVectorClassification, 'centered');
  assert.equal(watershot.symmetryClass, 'symmetric');
  assert.ok(watershot.columnGroup.biasMagnitude < 1e-5);
  assert.equal(watershot.columnGroup.instanceCount, 4);
});

// VAL-GEOMETRY-003
test('VAL-GEOMETRY-003: biased Watershot-like fixture has nonzero bias metadata', () => {
  const program = analyzeGeometry(importSpell(loadFixture('watershot-biased.json')));
  const watershot = program.geometryAnalysis.seals[0].watershotColumn;
  assert.ok(watershot);
  assert.equal(watershot.centered, false);
  assert.ok(watershot.biased || watershot.multiProfile);
  assert.ok(watershot.columnGroup.biasMagnitude > 0);
  assert.ok(
    Math.abs(watershot.vectorSum.x) > 0 || Math.abs(watershot.vectorSum.y) > 0,
  );
});

test('VAL-GEOMETRY-003b: additive field lobes expose centered 3D column emission', () => {
  const program = analyzeGeometry(importSpell(loadFixture('watershot-centered.json')));
  const seal = program.geometryAnalysis.seals[0];
  assert.equal(seal.fieldLobes.length, 1);
  const [lobe] = seal.fieldLobes;
  assert.equal(lobe.operatorFamily, 'field_emit');
  assert.equal(lobe.registryId, 'sign.column');
  assert.equal(lobe.axis.x, 0);
  assert.equal(lobe.axis.y, 0);
  assert.equal(lobe.axis.z, 1);
  assert.equal(lobe.cluster.count, 4);
  assert.equal(seal.operatorContributions.length, 4);
});

test('VAL-GEOMETRY-003c: column imbalance uses push-through-center lobe direction', () => {
  const program = analyzeGeometry(importSpell(loadFixture('watershot-biased-single.json')));
  const [lobe] = program.geometryAnalysis.seals[0].fieldLobes;
  const previousTiltDeg = tiltDeg({ x: -0.33035, y: 0, z: 0.943858 });
  assert.ok(lobe);
  assert.equal(lobe.registryId, 'sign.column');
  assert.ok(lobe.axis.x < 0, 'east-side column should push emission west through center');
  assert.equal(lobe.axis.y, 0);
  assert.ok(previousTiltDeg * 10 > 90);
  assert.ok(tiltDeg(lobe.axis) > 89.9);
});

test('VAL-GEOMETRY-003c2: biased field lobes amplify previous tilt angle tenfold', () => {
  const program = analyzeGeometry(importSpell(loadFixture('watershot-biased.json')));
  const [lobe] = program.geometryAnalysis.seals[0].fieldLobes;
  const previousTiltDeg = tiltDeg({ x: -0.099504, y: 0, z: 0.995037 });

  assert.ok(lobe);
  assert.equal(lobe.registryId, 'sign.column');
  assert.ok(lobe.axis.x < 0);
  assert.ok(Math.abs(tiltDeg(lobe.axis) - previousTiltDeg * 10) < 0.2);
});

test('VAL-GEOMETRY-003d: separated column clusters emit multiple deterministic lobes', () => {
  const program = analyzeGeometry(
    importSpell({
      title: 'Opposing column lobe clusters',
      seals: [
        {
          sigils: [{ name: 'water' }],
          rings: [{ radius: 100 }],
          signProfiles: [
            { kind: 'column', amount: 1, size: 200, rotation: 0, angle: 0, radius: 80 },
            { kind: 'column', amount: 1, size: 200, rotation: 180, angle: 0, radius: 80 },
          ],
        },
      ],
    }),
  );
  const lobes = program.geometryAnalysis.seals[0].fieldLobes;
  assert.equal(lobes.length, 2);
  assert.deepEqual(
    lobes.map((l) => l.cluster.count),
    [1, 1],
  );
  assert.ok(lobes.some((l) => l.axis.y > 0));
  assert.ok(lobes.some((l) => l.axis.y < 0));
});

test('VAL-GEOMETRY-003e: dispersion emits wider field lobe metadata than column', () => {
  const column = analyzeGeometry(importSpell(loadFixture('watershot-centered.json')))
    .geometryAnalysis.seals[0].fieldLobes[0];
  const input = loadFixture('dispersion-fire-explicit.json');
  input.seals[0].signProfiles[0].angle = 0;
  const dispersion = analyzeGeometry(importSpell(input))
    .geometryAnalysis.seals[0].fieldLobes[0];

  assert.equal(dispersion.registryId, 'sign.dispersion');
  assert.equal(dispersion.operatorFamily, 'field_emit');
  assert.ok(dispersion.spread > column.spread);

  const inverted = analyzeGeometry(importSpell(loadFixture('dispersion-fire-explicit.json')))
    .geometryAnalysis.seals[0].fieldLobes[0];
  assert.equal(inverted.registryId, 'sign.column');
  assert.equal(inverted.semanticOverrides[0].reason, 'inverted_dispersion_resolves_as_column');
});

test('VAL-GEOMETRY-003f: operator applications preserve Wave 2 layout semantics', () => {
  const pull = analyzeGeometry(importSpell(loadFixture('pull-angled-twist.json')))
    .geometryAnalysis.seals[0].operatorApplications[0];
  assert.equal(pull.operatorFamily, 'field_attract');
  assert.equal(pull.signRegistryId, 'sign.pull');
  assert.equal(pull.operatorRole, 'force_field');
  assert.equal(pull.orientationProbe, 'arrow_tip_inward');
  assert.equal(pull.orientationProbeResolution.status, 'recorded_fallback_current_facing_math');
  assert.equal(pull.targetQuery.targetKind, 'matching_aspect_matter');
  assert.ok(pull.pullTwist);

  const push = analyzeGeometry(importSpell(loadFixture('pull-inverted-push.json')))
    .geometryAnalysis.seals[0].operatorApplications[0];
  assert.equal(push.directionMode, 'push');
  assert.deepEqual(push.pushMetadata, { fromPullInversion: true, pushInstanceCount: 2 });

  const collection = analyzeGeometry(importSpell(loadFixture('collection-multi-domain.json')))
    .geometryAnalysis.seals[0].operatorApplications[0];
  const gather = analyzeGeometry(importSpell(loadFixture('gather-multi-domain.json')))
    .geometryAnalysis.seals[0].operatorApplications[0];
  assert.equal(collection.operatorFamily, 'material_intake');
  assert.equal(gather.operatorFamily, 'material_intake');
  assert.equal(collection.sourceMode, 'collect_nearby');
  assert.equal(gather.sourceMode, 'gather_active');
  assert.equal(collection.materialIntake.queryMode, 'passive_nearby_query');
  assert.equal(gather.materialIntake.queryMode, 'active_nearby_query');
  assert.ok(gather.materialIntake.activePull > collection.materialIntake.activePull);
});

test('VAL-GEOMETRY-003h: convergence operator exposes additive field-focus metadata', () => {
  const convergence = analyzeGeometry(importSpell(loadFixture('convergence-point-focus-valid.json')))
    .geometryAnalysis.seals[0].operatorApplications[0];
  assert.equal(convergence.operatorFamily, 'field_focus');
  assert.equal(convergence.operatorRole, 'field_modifier');
  assert.equal(convergence.orientationProbe, 'triangle_point_inward');
  assert.equal(convergence.fieldModification.coherenceDelta, 0.5);
  assert.equal(convergence.fieldModification.spreadMultiplier, 0.5);
  assert.ok(convergence.fieldModification.rigidityGain > 0);
  assert.ok(convergence.fieldModification.cohesionGain > 0);
});

test('VAL-GEOMETRY-003g: levitation keeps hover, drift, and rotation channels distinct', () => {
  const stable = analyzeGeometry(importSpell(loadFixture('levitation-fire-balanced.json')))
    .geometryAnalysis.seals[0].levitation;
  assert.equal(stable.motionMode, 'stable_hover');
  assert.deepEqual(stable.translationVector, { x: 0, y: 0 });
  assert.equal(stable.torqueDirection, 'none');

  const drift = analyzeGeometry(
    importSpell({
      title: 'Asymmetric levitation drift',
      seals: [
        {
          sigils: [{ name: 'fire' }],
          rings: [{ radius: 100 }],
          signProfiles: [
            { kind: 'levitation', amount: 1, size: 200, radius: 60, angle: 0 },
          ],
        },
      ],
    }),
  ).geometryAnalysis.seals[0].levitation;
  assert.equal(drift.motionMode, 'lift_with_drift');
  assert.ok(Math.abs(drift.translationVector.x) > 0 || Math.abs(drift.translationVector.y) > 0);
  assert.ok(Math.abs(Math.hypot(drift.translationVector.x, drift.translationVector.y) - 10) < 1e-6);

  const chasing = analyzeGeometry(
    importSpell({
      title: 'Chasing levitation rotation',
      seals: [
        {
          sigils: [{ name: 'fire' }],
          rings: [{ radius: 100 }],
          signProfiles: [
            { kind: 'levitation', amount: 4, size: 200, radius: 50, angle: 90 },
          ],
        },
      ],
    }),
  ).geometryAnalysis.seals[0].levitation;
  assert.equal(chasing.motionMode, 'lift_with_rotation');
  assert.deepEqual(chasing.translationVector, { x: 0, y: 0 });
  assert.ok(Math.abs(chasing.tangentialBias) > 0);
  assert.ok(['clockwise', 'counterclockwise'].includes(chasing.torqueDirection));
});

// VAL-GEOMETRY-004
test('VAL-GEOMETRY-004: multiple same-kind profiles aggregate for bias analysis', () => {
  const program = analyzeGeometry(importSpell(loadFixture('overlapping-profiles.json')));
  const aggregate = program.geometryAnalysis.sameKindAggregations.find(
    (a) => a.registryId === 'sign.column',
  );
  assert.ok(aggregate);
  assert.equal(aggregate.profileCount, 2);
  assert.equal(aggregate.instanceCount, 2);
  assert.equal(aggregate.columnVectorClassification, 'multi_profile');
  assert.ok(aggregate.biasMagnitude > 0);
  assert.equal(aggregate.profileIds.length, 2);
});

// VAL-GEOMETRY-005
test('VAL-GEOMETRY-005: radial instances expose pointedAtSigilId from placement and facing', () => {
  const program = analyzeGeometry(importSpell(loadFixture('radial-fire.json')));
  const radials = program.seals[0].symbols.filter(
    (s) => s.resolvedRegistryId === 'sign.radial' && s.objectId.startsWith('sign-instance:'),
  );
  assert.equal(radials.length, 2);
  for (const radial of radials) {
    assert.equal(radial.geometryAnalysis.pointedAtSigilId, 'sigil:0');
    assert.equal(radial.geometryAnalysis.pointedAtRegistryId, 'sigil.fire');
  }
  const pointing = program.geometryAnalysis.seals[0].radialPointing;
  assert.equal(pointing.countsBySigilId['sigil:0'].count, 2);
});

// VAL-GEOMETRY-006
test('VAL-GEOMETRY-006: radial pair count on target is exactly two for weak-domain', () => {
  const heater = analyzeGeometry(importSpell(loadFixture('spellmaker-water-heater.json')));
  const heaterCounts = heater.geometryAnalysis.seals[0].radialPointing.countsBySigilId;
  const fireCount = Object.values(heaterCounts).find((c) => c.registryId === 'sigil.fire');
  assert.ok(fireCount);
  assert.equal(fireCount.count, 2);

  const one = analyzeGeometry(importSpell(loadFixture('radial-one-on-target.json')));
  assert.equal(
    one.geometryAnalysis.seals[0].radialPointing.countsBySigilId['sigil:0'].count,
    1,
  );

  const three = analyzeGeometry(importSpell(loadFixture('radial-three-on-target.json')));
  assert.equal(
    three.geometryAnalysis.seals[0].radialPointing.countsBySigilId['sigil:0'].count,
    3,
  );
});

test('VAL-GEOMETRY-006b: center group identifies center sigil and inward column modifiers', () => {
  const program = analyzeGeometry(importSpell(loadFixture('crosshair-valid.json')));
  const center = program.geometryAnalysis.seals[0].centerGroup;
  assert.ok(center);
  assert.equal(center.centerRegistryId, 'sigil.water');
  assert.equal(center.hasColumn, true);
});

test('VAL-GEOMETRY-005b: Water Heater radials point at sigil.fire not sigil.water', () => {
  const program = analyzeGeometry(importSpell(loadFixture('spellmaker-water-heater.json')));
  const radials = program.seals[0].symbols.filter(
    (s) => s.resolvedRegistryId === 'sign.radial' && s.objectId.startsWith('sign-instance:'),
  );
  for (const radial of radials) {
    assert.equal(radial.geometryAnalysis.pointedAtRegistryId, 'sigil.fire');
  }
});

test('analyzeGeometry is deterministic across repeated runs', () => {
  const fixture = loadFixture('watershot-biased.json');
  const first = analyzeGeometry(importSpell(fixture));
  const second = analyzeGeometry(importSpell(fixture));
  assert.deepEqual(first.geometryAnalysis, second.geometryAnalysis);
});
