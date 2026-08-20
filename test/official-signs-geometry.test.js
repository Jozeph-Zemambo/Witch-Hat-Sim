/**
 * Official signs M1: directional column-parity geometry and outward dispersion path.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { importSpell } from '../src/compiler/importer.js';
import { analyzeGeometry } from '../src/compiler/geometry.js';
import { compileSpell } from '../src/compiler/compile.js';
import { evaluateRules } from '../src/compiler/rules.js';

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

/** Column-parity geometry fields shared by column, pull, region, dispersion. */
const COLUMN_PARITY_INSTANCE_FIELDS = [
  'positionAngleDeg',
  'radialDistance',
  'profileRotationDeg',
  'signAngleDeg',
  'angleDerivedFacingDeg',
  'inverted',
  'scaleWeight',
  'placementZone',
  'directionVector',
  'radialComponents',
  'symmetryClass',
  'vectorSum',
  'sameKindGroupId',
];

/**
 * @param {object} ga
 */
function assertColumnParityInstanceGeometry(ga) {
  for (const field of COLUMN_PARITY_INSTANCE_FIELDS) {
    assert.ok(field in ga, `missing geometry field: ${field}`);
  }
  assert.equal(typeof ga.positionAngleDeg, 'number');
  assert.equal(typeof ga.inverted, 'boolean');
  assert.equal(typeof ga.scaleWeight, 'number');
  assert.ok(ga.directionVector);
  assert.equal(typeof ga.radialComponents.inward, 'number');
  assert.equal(typeof ga.radialComponents.outward, 'number');
  assert.equal(typeof ga.radialComponents.tangentialClockwise, 'number');
  assert.ok(['symmetric', 'skewed_supported'].includes(ga.symmetryClass));
}

/**
 * @param {object} program
 * @param {string} registryId
 */
function signInstances(program, registryId) {
  return program.seals.flatMap((seal) =>
    (seal.symbols ?? []).filter(
      (s) =>
        s.objectId?.startsWith('sign-instance:') && s.resolvedRegistryId === registryId,
    ),
  );
}

// VAL-DIR-001
test('VAL-DIR-001: pull region dispersion have column-parity geometry and symmetry', () => {
  const program = analyzeGeometry(importSpell(loadFixture('directional-multi-domain.json')));

  for (const registryId of ['sign.pull', 'sign.region', 'sign.dispersion']) {
    const instances = signInstances(program, registryId);
    assert.ok(instances.length >= 2, registryId);
    for (const inst of instances) {
      assertColumnParityInstanceGeometry(inst.geometryAnalysis);
    }
    const group = program.geometryAnalysis.sameKindAggregations.find(
      (g) => g.registryId === registryId,
    );
    assert.ok(group, registryId);
    assert.ok(group.columnVectorClassification);
    assert.ok(['symmetric', 'skewed_supported'].includes(group.symmetryClass));
    assert.equal(typeof group.biasMagnitude, 'number');
    assert.ok(group.vectorSum);
  }
});

// VAL-DIR-002
test('VAL-DIR-002: watershot and levitation fixtures keep locked geometry classes', () => {
  const watershotCentered = analyzeGeometry(importSpell(loadFixture('watershot-centered.json')));
  const ws = watershotCentered.geometryAnalysis.seals[0].watershotColumn;
  assert.ok(ws);
  assert.equal(ws.template, 'watershot_like');
  assert.equal(ws.centered, true);
  assert.equal(ws.symmetryClass, 'symmetric');
  assert.equal(watershotCentered.geometryAnalysis.seals[0].outwardDispersion, null);

  const watershotBiased = analyzeGeometry(importSpell(loadFixture('watershot-biased.json')));
  const wb = watershotBiased.geometryAnalysis.seals[0].watershotColumn;
  assert.ok(wb);
  assert.equal(wb.centered, false);
  assert.ok(wb.biased || wb.multiProfile);
  assert.equal(watershotBiased.geometryAnalysis.seals[0].outwardDispersion, null);

  const levBalanced = analyzeGeometry(importSpell(loadFixture('levitation-fire-balanced.json')));
  const lev = levBalanced.geometryAnalysis.seals[0].levitation;
  assert.ok(lev);
  assert.equal(lev.domainRegistryId, 'sigil.fire');
  assert.equal(lev.balanced, true);
  assert.equal(lev.launchVector, null);

  const lockedWatershot = compileSpell(loadFixture('watershot-centered.json'));
  const col = lockedWatershot.graph.nodes.find(
    (n) => n.nodeType === 'shape_field' && n.shape === 'column',
  );
  assert.ok(col);
  assert.equal(col.geometryBinding.centered, true);
});

// VAL-DISP-001
test('VAL-DISP-001: outward-facing column classified as outward_dispersion', () => {
  const program = analyzeGeometry(importSpell(loadFixture('outward-column-water.json')));
  const seal = program.geometryAnalysis.seals[0];
  assert.equal(seal.watershotColumn, null);
  assert.ok(seal.outwardDispersion);
  assert.equal(seal.outwardDispersion.kind, 'outward_dispersion');
  assert.equal(seal.outwardDispersion.domainRegistryId, 'sigil.water');
  assert.ok(
    seal.outwardDispersion.instances.every((i) => i.registryId === 'sign.column'),
  );
  assert.ok(seal.outwardDispersion.vectorSummary);
  assert.equal(typeof seal.outwardDispersion.symmetric, 'boolean');
});

// VAL-DISP-002
test('VAL-DISP-002: non-inverted sign.dispersion shares outward_dispersion path with outward column', () => {
  const input = loadFixture('dispersion-fire-explicit.json');
  input.seals[0].signProfiles[0].angle = 0;
  const program = analyzeGeometry(importSpell(input));
  const od = program.geometryAnalysis.seals[0].outwardDispersion;
  assert.ok(od);
  assert.equal(od.kind, 'outward_dispersion');
  assert.equal(od.domainRegistryId, 'sigil.fire');
  assert.ok(od.instances.every((i) => i.registryId === 'sign.dispersion'));
  assert.ok(od.dispersionGroup);
  assert.equal(od.columnGroup, null);

  const columnProgram = analyzeGeometry(importSpell(loadFixture('outward-column-water.json')));
  const columnOd = columnProgram.geometryAnalysis.seals[0].outwardDispersion;
  assert.equal(columnOd.kind, 'outward_dispersion');
  assert.ok(columnOd.vectorSummary);
  assert.equal(typeof columnOd.symmetric, 'boolean');
  assert.equal(typeof od.symmetric, 'boolean');

  const invertedProgram = analyzeGeometry(importSpell(loadFixture('dispersion-fire-explicit.json')));
  assert.equal(invertedProgram.geometryAnalysis.seals[0].outwardDispersion, null);
});

// VAL-DISP-003
test('VAL-DISP-003: inward watershot remains watershotColumn not outward_dispersion', () => {
  const program = analyzeGeometry(importSpell(loadFixture('watershot-centered.json')));
  const seal = program.geometryAnalysis.seals[0];
  assert.ok(seal.watershotColumn);
  assert.equal(seal.watershotColumn.template, 'watershot_like');
  assert.equal(seal.outwardDispersion, null);

  for (const name of ['watershot-biased.json', 'watershot-biased-single.json']) {
    const biased = analyzeGeometry(importSpell(loadFixture(name)));
    assert.ok(biased.geometryAnalysis.seals[0].watershotColumn, name);
    assert.equal(biased.geometryAnalysis.seals[0].outwardDispersion, null, name);
  }
});

test('outward dispersion rule emits dispersion_emission effect kind', () => {
  const program = analyzeGeometry(importSpell(loadFixture('outward-column-water.json')));
  const effect = evaluateRules(program).sealResults[0].effects.find(
    (e) =>
      e.kind === 'operator_result' &&
      e.operatorFamily === 'field_emit' &&
      e.derivedClassification === 'dispersion_emission',
  );
  assert.ok(effect);
  assert.equal(effect.geometryBinding.effectKind, 'dispersion_emission');
  assert.equal(effect.compatTrace.legacyEffectKind, 'outward_dispersion');
});

test('VAL-DISP graph: outward column and sign.dispersion share dispersion_emission shape', () => {
  const normalDispersionInput = loadFixture('dispersion-fire-explicit.json');
  normalDispersionInput.seals[0].signProfiles[0].angle = 0;
  for (const [label, input] of [
    ['outward-column-water.json', loadFixture('outward-column-water.json')],
    ['normal sign.dispersion', normalDispersionInput],
  ]) {
    const result = compileSpell(input);
    const dispersion = result.graph.nodes.find(
      (n) => n.nodeType === 'shape_field' && n.shape === 'dispersion',
    );
    assert.ok(dispersion, label);
    assert.equal(dispersion.effectKind, 'dispersion_emission');
    const watershot = result.graph.nodes.find(
      (n) => n.nodeType === 'shape_field' && n.shape === 'column',
    );
    assert.equal(watershot, undefined, label);
  }

  const explicit = compileSpell(normalDispersionInput);
  assert.ok(
    explicit.graph.nodes.some(
      (n) => n.nodeType === 'field_lobe' && n.registryId === 'sign.dispersion',
    ),
  );
  assert.equal(explicit.graph.nodes.some((n) => n.nodeType === 'operator_effect'), false);

  const inverted = compileSpell(loadFixture('dispersion-fire-explicit.json'));
  assert.ok(
    inverted.graph.nodes.some(
      (n) => n.nodeType === 'shape_field' && n.shape === 'column',
    ),
  );
  assert.equal(
    inverted.graph.nodes.find((n) => n.shape === 'dispersion'),
    undefined,
  );
  assert.ok(
    inverted.graph.nodes.some(
      (n) =>
        n.nodeType === 'field_lobe' &&
        n.registryId === 'sign.column' &&
        n.semanticOverrides?.some(
          (override) => override.reason === 'inverted_dispersion_resolves_as_column',
        ),
    ),
  );

  const inward = compileSpell(loadFixture('watershot-centered.json'));
  assert.ok(
    inward.graph.nodes.some(
      (n) => n.nodeType === 'shape_field' && n.shape === 'column',
    ),
  );
  assert.equal(
    inward.graph.nodes.find((n) => n.shape === 'dispersion'),
    undefined,
  );
});
