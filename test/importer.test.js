/**
 * Spell JSON importer tests (VAL-IMPORT-001..010).
 *
 * Fixture JSON shape (Spell Maker-like, project-authored):
 * - title?: string
 * - seals[]: transform?, rings[], sigils[], signProfiles[], lines[]
 * - signProfiles: kind|name, amount|count, size, rotation, angle, radius, skip
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  decodeSpellShareLink,
  importSpellFromShareLink,
  importSpellFromJson,
  importSpell,
  IMPORTER_VERSION,
} from '../src/compiler/importer.js';
import {
  decodeSpellShareLink as decodeSpellShareLinkExported,
  importSpell as importSpellExported,
} from '../src/index.js';

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
 * @param {unknown} value
 */
function encodeBase64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

// VAL-IMPORT-001
test('VAL-IMPORT-001: direct JSON import produces normalized SpellProgram', () => {
  const program = importSpellFromJson(loadFixture('full-layout.json'));
  assert.equal(program.source.kind, 'direct_json');
  assert.equal(program.source.importerVersion, IMPORTER_VERSION);
  assert.equal(program.title, 'Watershot study');
  assert.ok(program.programId.startsWith('program:'));
  assert.ok(Array.isArray(program.seals));
  assert.ok(program.coordinateSpace);
  assert.ok(program.importMetadata);
});

// VAL-IMPORT-002
test('VAL-IMPORT-002: identical JSON yields deep-equal stable IDs', () => {
  const fixture = loadFixture('repeated-signs.json');
  const first = importSpell(fixture);
  const second = importSpell(fixture);
  assert.deepEqual(first, second);
  assert.equal(first.programId, second.programId);

  const ids = collectStableIds(first);
  const idsAgain = collectStableIds(second);
  assert.deepEqual(ids, idsAgain);
  assert.ok(ids.sealIds.includes('seal:0'));
  assert.ok(ids.generatorIds.length >= 1);
  assert.ok(ids.instanceIds.length >= 1);
});

test('import snapshots caller-owned JSON and caps malformed radial expansion', () => {
  const input = {
    title: 'Snapshot boundary',
    seals: [{
      rings: [{ radius: 100 }],
      sigils: [{ name: 'water' }],
      signProfiles: [{ kind: 'column', amount: 2, radius: 80 }],
    }],
  };
  const first = importSpell(input);
  const second = importSpell(input);

  first.seals[0].provenance.raw.rings[0].radius = 999;
  assert.equal(input.seals[0].rings[0].radius, 100);
  assert.equal(second.seals[0].provenance.raw.rings[0].radius, 100);
  assert.equal(first.programId, second.programId);

  for (const amount of [1.9, 513, 10_000]) {
    const malformed = importSpell({
      seals: [{
        sigils: [{ name: 'water' }],
        signProfiles: [{ kind: 'column', amount, radius: 80 }],
      }],
    });
    assert.equal(
      malformed.seals[0].symbols.filter((symbol) => symbol.objectId.startsWith('sign-instance:')).length,
      0,
    );
    const generator = malformed.seals[0].symbols.find(
      (symbol) => symbol.objectId.startsWith('sign-generator:'),
    );
    assert.equal(generator.semanticEligibility, 'diagnostic_only');
    assert.ok(malformed.diagnostics.some((diagnostic) => (
      diagnostic.code === 'import.radial_malformed'
      && diagnostic.sourcePath === '/seals/0/signProfiles/0/amount'
    )));
  }
});

test('invalid direct JSON roots diagnose and stop semantic import without throwing', () => {
  for (const input of [null, undefined, [], 42, 'not json', '"text"']) {
    const program = importSpellFromJson(input);
    assert.deepEqual(program.seals, []);
    assert.equal(program.diagnostics.length, 1);
    assert.equal(program.diagnostics[0].code, 'import.root_malformed');
    assert.equal(program.diagnostics[0].status, 'invalid_structure');
  }

  const missingSeals = importSpellFromJson({ title: 'Missing seals' });
  assert.deepEqual(missingSeals.seals, []);
  assert.equal(missingSeals.diagnostics.length, 1);
  assert.equal(missingSeals.diagnostics[0].sourcePath, '/seals');
});

test('explicit malformed geometry is finite-normalized and suppressed from active semantics', () => {
  const malformedProfiles = importSpell({
    seals: [{
      rings: [{ radius: 100 }],
      sigils: [{ name: 'water' }],
      signProfiles: [
        { kind: 'column', amount: 1, size: -1, radius: 80 },
        { kind: 'gather', amount: 1, size: 200, radius: Infinity },
        { kind: 'levitation', amount: 1, size: 200, radius: 80, angle: NaN },
      ],
    }],
  });
  assert.equal(
    malformedProfiles.seals[0].symbols.some(
      (symbol) => symbol.objectId.startsWith('sign-instance:'),
    ),
    false,
  );
  assert.equal(
    malformedProfiles.seals[0].symbols
      .filter((symbol) => symbol.objectId.startsWith('sign-generator:'))
      .every((symbol) => symbol.semanticEligibility === 'diagnostic_only'),
    true,
  );
  assert.deepEqual(
    malformedProfiles.diagnostics
      .filter((diagnostic) => diagnostic.code === 'import.geometry_malformed')
      .map((diagnostic) => diagnostic.sourcePath),
    [
      '/seals/0/signProfiles/0/size',
      '/seals/0/signProfiles/1/radius',
      '/seals/0/signProfiles/2/angle',
    ],
  );

  for (const seal of [
    {
      rings: [{ radius: -10 }],
      sigils: [{ name: 'water' }],
      signProfiles: [{ kind: 'column', amount: 1, size: 200, radius: 0 }],
    },
    {
      transform: { scale: Infinity },
      rings: [{ radius: 100 }],
      sigils: [{ name: 'water' }],
      signProfiles: [{ kind: 'column', amount: 1, size: 200, radius: 80 }],
    },
    {
      rings: [{ radius: 100 }],
      sigils: [{ name: 'water', size: NaN }],
    },
  ]) {
    const program = importSpell({ seals: [seal] });
    assert.equal(
      program.seals[0].symbols.some(
        (symbol) => symbol.semanticEligibility === 'eligible',
      ),
      false,
    );
    assert.ok(
      program.diagnostics.some((diagnostic) => diagnostic.code === 'import.geometry_malformed'),
    );
  }
});

// VAL-IMPORT-003
test('VAL-IMPORT-003: missing title and seal transform defaults', () => {
  const program = importSpellFromJson(loadFixture('minimal-defaults.json'));
  assert.equal(program.title, 'Imported WHA spell');
  const transform = program.seals[0].transform;
  assert.equal(transform.x, 0);
  assert.equal(transform.y, 0);
  assert.equal(transform.scaleX, 1);
  assert.equal(transform.scaleY, 1);
  assert.equal(transform.rotationDeg, 0);
  assert.equal(transform.offsetX, 0);
  assert.equal(transform.offsetY, 0);
});

// VAL-IMPORT-004
test('VAL-IMPORT-004: rings, sigils, signs, and lines preserve provenance and geometry', () => {
  const program = importSpell(loadFixture('full-layout.json'));
  const seal = program.seals[0];
  assert.equal(seal.provenance.sourcePath, '/seals/0');
  assert.equal(seal.rings[0].provenance.sourcePath, '/seals/0/rings/0');
  assert.equal(seal.rings[0].radius, 120);
  const sigil = seal.symbols.find((s) => s.categoryHint === 'sigil');
  assert.ok(sigil);
  assert.equal(sigil.provenance.sourcePath, '/seals/0/sigils/0');
  assert.equal(sigil.resolvedRegistryId, 'sigil.water');
  const line = seal.lines[0];
  assert.equal(line.provenance.sourcePath, '/seals/0/lines/0');
  assert.deepEqual(line.points, [
    [0, 0],
    [50, 50],
  ]);
  const profilePath = '/seals/0/signProfiles/0';
  const instance = seal.symbols.find((s) => s.objectId === 'sign-instance:0');
  assert.equal(instance.provenance.sourcePath, profilePath);
  assert.equal(instance.geometry.polarRadius, 90);
});

// VAL-IMPORT-005
test('VAL-IMPORT-005: sign profile defaults size 200, amount 8, single sign at top', () => {
  const program = importSpell(loadFixture('minimal-defaults.json'));
  const seal = program.seals[0];
  const generator = seal.symbols.find((s) => s.objectId === 'sign-generator:0');
  assert.ok(generator);
  assert.equal(generator.geometry.size, 200);
  assert.equal(generator.radial.count, 8);
  assert.equal(generator.geometry.defaultSizeApplied, true);
  const instances = seal.symbols.filter((s) => s.objectId.startsWith('sign-instance:'));
  assert.equal(instances.length, 8);
  const topInstance = instances.find((s) => s.radial.slotIndex === 0);
  assert.ok(topInstance);
  assert.equal(topInstance.geometry.polarAngleDeg, -90);
  const sigil = seal.symbols.find((s) => s.categoryHint === 'sigil');
  assert.ok(sigil);
  assert.equal(sigil.geometry.localPosition.y, 0);
});

// VAL-IMPORT-006
test('VAL-IMPORT-006: profile rotation vs sign angle are distinct', () => {
  const program = importSpell(loadFixture('rotation-angle-distinct.json'));
  const seal = program.seals[0];
  const instances = seal.symbols
    .filter((s) => s.objectId.startsWith('sign-instance:'))
    .sort((a, b) => a.radial.slotIndex - b.radial.slotIndex);
  assert.equal(instances.length, 4);
  assert.equal(instances[0].geometry.polarAngleDeg, -45);
  assert.equal(instances[0].geometry.placementRotationDeg, 45);
  assert.equal(instances[0].geometry.facingDeg, 30);
  assert.equal(instances[0].geometry.angleDeg, 30);
  assert.notEqual(instances[0].geometry.polarAngleDeg, instances[0].geometry.facingDeg);
});

// VAL-IMPORT-007
test('VAL-IMPORT-007: repeated signs expand with generator provenance', () => {
  const program = importSpell(loadFixture('repeated-signs.json'));
  const seal = program.seals[0];
  const generator = seal.symbols.find((s) => s.objectId === 'sign-generator:0');
  assert.ok(generator);
  assert.equal(generator.radial.count, 6);
  assert.equal(generator.radial.amountSkip, 1);
  assert.equal(generator.provenance.sourcePath, '/seals/0/signProfiles/0');
  const instances = seal.symbols.filter((s) => s.objectId.startsWith('sign-instance:'));
  assert.equal(instances.length, 5);
  for (const inst of instances) {
    assert.equal(inst.radial.generatorId, 'sign-generator:0');
    assert.ok(inst.objectId.match(/^sign-instance:\d+$/));
    assert.equal(inst.geometry.polarRadius, 75);
  }
});

// VAL-IMPORT-008
test('VAL-IMPORT-008: same-kind profiles grouped; overlap not rejected', () => {
  const program = importSpell(loadFixture('overlapping-profiles.json'));
  const groups = program.importMetadata.sameKindSignGroups;
  const columnGroup = groups.find((g) => g.registryId === 'sign.column');
  assert.ok(columnGroup);
  assert.equal(columnGroup.profileIds.length, 2);
  assert.equal(columnGroup.instanceIds.length, 2);
  const overlapError = program.diagnostics.find((d) =>
    /overlap/i.test(d.message ?? ''),
  );
  assert.equal(overlapError, undefined);
  const inst0 = program.seals[0].symbols.find((s) => s.objectId === 'sign-instance:0');
  const inst1 = program.seals[0].symbols.find((s) => s.objectId === 'sign-instance:1');
  assert.equal(inst0.geometry.polarAngleDeg, inst1.geometry.polarAngleDeg);
});

// VAL-IMPORT-009
test('VAL-IMPORT-009: unsupported symbols stay diagnostic-only', () => {
  const program = importSpell(loadFixture('unsupported-symbols.json'));
  const seal = program.seals[0];
  const unknownSigil = seal.symbols.find((s) => s.registryCandidate === 'sigil.unknown_moon');
  assert.ok(unknownSigil);
  assert.equal(unknownSigil.resolvedRegistryId, null);
  assert.equal(unknownSigil.semanticEligibility, 'unresolved');
  const rain = seal.symbols.find(
    (s) => s.resolvedRegistryId === 'sign.rain' && s.radial?.generatorId,
  );
  assert.ok(rain);
  assert.equal(rain.semanticEligibility, 'diagnostic_only');
  assert.ok(
    program.diagnostics.some(
      (d) =>
        d.code === 'import.unsupported_symbol' &&
        d.conservativeFallback === 'visual_only',
    ),
  );
  assert.ok(
    program.diagnostics.some((d) => d.code === 'import.unresolved_symbol'),
  );
  const active = seal.symbols.filter((s) => s.semanticEligibility === 'eligible');
  assert.equal(active.length, 0);
});

// VAL-IMPORT-010
test('VAL-IMPORT-010: Crosshair and Radial resolve as custom-supported', () => {
  const program = importSpell(loadFixture('custom-supported-signs.json'));
  const seal = program.seals[0];
  const crosshair = seal.symbols.find((s) => s.resolvedRegistryId === 'sign.crosshair');
  const radial = seal.symbols.find((s) => s.resolvedRegistryId === 'sign.radial');
  assert.ok(crosshair);
  assert.ok(radial);
  assert.equal(crosshair.provenance.customSupported, true);
  assert.equal(crosshair.provenance.canonClass, 'custom_project_supported');
  assert.notEqual(crosshair.provenance.canonClass, 'official');
  assert.ok(
    program.diagnostics.some(
      (d) =>
        d.code === 'import.custom_supported_unofficial_sign' &&
        d.message.includes('sign.crosshair'),
    ),
  );
});

test('VAL-IMPORT-011: custom images import as stable visual-only objects without semantics', () => {
  const program = importSpell(loadFixture('custom-image-visual-only.json'));
  const seal = program.seals[0];
  assert.equal(seal.customVisuals.length, 1);
  const visual = seal.customVisuals[0];
  assert.equal(visual.visualId, 'import.visual:0:0');
  assert.equal(visual.label, 'Looks like a column sign');
  assert.equal(visual.assetRef, 'local-user-sketch-column.png');
  assert.equal(visual.semanticEligibility, 'visual_only');
  assert.equal(visual.provenance.registryLookup, 'custom_visual');
  assert.equal(visual.provenance.customImageMarker, true);
  assert.deepEqual(visual.geometry.localPosition, { x: 12, y: -24 });
  assert.equal(visual.geometry.width, 64);
  assert.equal(visual.geometry.height, 48);
  assert.equal(visual.geometry.rotationDeg, 15);

  const symbol = seal.symbols.find((item) => item.objectId === visual.visualId);
  assert.ok(symbol);
  assert.equal(symbol.categoryHint, 'custom_image');
  assert.equal(symbol.registryCandidate, 'import.visual:0:0');
  assert.equal(symbol.resolvedRegistryId, null);
  assert.equal(symbol.semanticEligibility, 'visual_only');
  assert.equal(symbol.provenance.registryLookup, 'custom_visual');
  assert.equal(symbol.provenance.customImageMarker, true);

  assert.ok(
    program.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === 'import.custom_image_visual_only' &&
        diagnostic.normalizedObjectId === 'import.visual:0:0' &&
        diagnostic.registryLookup === 'custom_visual' &&
        diagnostic.customImageMarker === true &&
        diagnostic.conservativeFallback === 'visual_only',
    ),
  );
  assert.equal(
    program.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === 'import.unresolved_symbol' &&
        diagnostic.normalizedObjectId === 'import.visual:0:0',
    ),
    false,
  );
});

test('VAL-IMPORT-012: share links decode client-side and import like direct JSON', () => {
  const fixture = loadFixture('custom-supported-signs.json');
  const link = `https://wha-sim.local/share?spell=${encodeBase64UrlJson(fixture)}`;
  const decoded = decodeSpellShareLink(link);
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.payload, fixture);
  assert.equal(decoded.encoding, 'base64url');

  const result = importSpellFromShareLink(link);
  assert.ok(result.program);
  assert.equal(result.program.source.kind, 'share_link');
  assert.equal(result.program.source.sourceLabel, link);

  const direct = importSpell(fixture);
  assert.equal(result.program.programId, direct.programId);
  assert.deepEqual(result.program.coordinateSpace, direct.coordinateSpace);
  assert.deepEqual(result.program.importMetadata, direct.importMetadata);
  assert.equal(result.program.title, direct.title);
  assert.equal(result.program.seals.length, direct.seals.length);
  assert.equal(result.program.seals[0].symbols.length, direct.seals[0].symbols.length);
  assert.ok(
    result.program.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === 'import.custom_supported_unofficial_sign' &&
        diagnostic.provenance.sourceKind === 'share_link',
    ),
  );
  assert.ok(
    result.program.seals[0].symbols.every(
      (symbol) => symbol.provenance.sourceKind === 'share_link',
    ),
  );
});

test('VAL-IMPORT-013: invalid share links return diagnostics without empty programs', () => {
  const invalid = importSpellFromShareLink('not a url');
  assert.equal(invalid.program, null);
  assert.equal(invalid.diagnostics[0].code, 'import.share_decode_failed');
  assert.equal(invalid.diagnostics[0].provenance.sourceKind, 'share_link');
  assert.equal(invalid.diagnostics[0].conservativeFallback, 'invalid_url');

  const unsupported = decodeSpellShareLink('https://wha-sim.local/share?unknown=payload');
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.diagnostics[0].conservativeFallback, 'unsupported_encoding');

  const malformed = decodeSpellShareLink(
    `https://wha-sim.local/share?spell=${Buffer.from('not-json', 'utf8').toString('base64url')}`,
  );
  assert.equal(malformed.ok, false);
  assert.equal(malformed.diagnostics[0].conservativeFallback, 'malformed_json');

  const unknownVersion = decodeSpellShareLink(
    `https://wha-sim.local/share?spell=${encodeBase64UrlJson({ version: 'future-v9', seals: [] })}`,
  );
  assert.equal(unknownVersion.ok, false);
  assert.equal(unknownVersion.diagnostics[0].conservativeFallback, 'unknown_version');

  const unsafeImage = decodeSpellShareLink(
    `https://wha-sim.local/share?spell=${encodeBase64UrlJson({
      title: 'Unsafe image',
      seals: [{ customImages: [{ src: 'data:image/png;base64,abc' }] }],
    })}`,
  );
  assert.equal(unsafeImage.ok, false);
  assert.equal(unsafeImage.diagnostics[0].conservativeFallback, 'unsafe_custom_image_payload');
});

test('VAL-IMPORT-014: safe unknown external fields are preserved as metadata only', () => {
  const program = importSpell({
    title: 'Unknown metadata safety',
    author: 'Apprentice Q',
    'source/note': { shelf: 'field notebook', page: 7 },
    unsafePayload: 'javascript:alert(1)',
    largeEditorDump: 'x'.repeat(5_000),
    seals: [
      {
        editorSealId: 'seal-a',
        rings: [{ radius: 120, stroke: { color: '#123456' } }],
        sigils: [{ name: 'sigil_Water', layer: 'ink' }],
        signProfiles: [
          {
            kind: 'sign_Column',
            amount: 2,
            radius: 80,
            editor: { selected: true },
          },
        ],
        lines: [{ points: [[0, 0], [20, 20]], label: 'guide line' }],
        customImages: [
          {
            label: 'Margin mark',
            src: 'margin-mark.png',
            editorTag: 'decorative',
          },
        ],
      },
    ],
  });

  assert.deepEqual(program.importMetadata.rawUnknownFields, {
    '/author': 'Apprentice Q',
    '/seals/0/customImages/0/editorTag': 'decorative',
    '/seals/0/editorSealId': 'seal-a',
    '/seals/0/lines/0/label': 'guide line',
    '/seals/0/signProfiles/0/editor': { selected: true },
    '/seals/0/sigils/0/layer': 'ink',
    '/source~1note': { shelf: 'field notebook', page: 7 },
  });
  assert.deepEqual(program.seals[0].rings[0].style, { strokeColor: '#123456' });
  assert.equal(program.seals[0].symbols.some((symbol) => symbol.registryCandidate === 'editor'), false);
  assert.ok(
    program.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === 'import.ignored_external_field' &&
        diagnostic.sourcePath === '/unsafePayload' &&
        diagnostic.conservativeFallback === 'unsafe_external_field_payload',
    ),
  );
  assert.ok(
    program.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === 'import.ignored_external_field' &&
        diagnostic.sourcePath === '/largeEditorDump' &&
        diagnostic.conservativeFallback === 'oversized_external_field',
    ),
  );
});

test('VAL-IMPORT-015: malformed lines are preserved but marked invalid_structure', () => {
  const program = importSpell({
    title: 'Line validation',
    seals: [
      {
        rings: [{ radius: 100 }],
        sigils: [{ name: 'sigil_Water' }],
        lines: [
          { points: [] },
          { points: [[0, 0], ['bad', 5], [20, 20]] },
          { points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], from: 'sigil:0', to: 'ring:0' },
        ],
      },
    ],
  });

  const [emptyLine, partlyMalformedLine, objectPointLine] = program.seals[0].lines;
  assert.equal(emptyLine.lineId, 'line:0');
  assert.equal(emptyLine.semanticEligibility, 'invalid_structure');
  assert.deepEqual(emptyLine.points, []);
  assert.equal(partlyMalformedLine.semanticEligibility, 'invalid_structure');
  assert.deepEqual(partlyMalformedLine.points, [
    [0, 0],
    [20, 20],
  ]);
  assert.equal(objectPointLine.semanticEligibility, undefined);
  assert.deepEqual(objectPointLine.points, [
    [1, 2],
    [3, 4],
  ]);
  assert.deepEqual(objectPointLine.anchors, { from: 'sigil:0', to: 'ring:0' });
  assert.deepEqual(
    program.diagnostics
      .filter((diagnostic) => diagnostic.code === 'import.line_malformed')
      .map((diagnostic) => ({
        sourcePath: diagnostic.sourcePath,
        normalizedObjectId: diagnostic.normalizedObjectId,
        fallback: diagnostic.conservativeFallback,
      })),
    [
      {
        sourcePath: '/seals/0/lines/0/points',
        normalizedObjectId: 'line:0',
        fallback: 'invalid_structure',
      },
      {
        sourcePath: '/seals/0/lines/1/points',
        normalizedObjectId: 'line:1',
        fallback: 'invalid_structure',
      },
    ],
  );
});

test('VAL-IMPORT-019: explicit line anchors create symbol and ring lineConnections', () => {
  const program = importSpell({
    title: 'Line connection probe',
    seals: [
      {
        rings: [{ radius: 100 }],
        sigils: [{ name: 'sigil_Water' }],
        signProfiles: [{ kind: 'sign_Column', amount: 1, radius: 80 }],
        customImages: [{ label: 'Sketch marker', src: 'sketch-marker.png' }],
        lines: [
          { points: [[0, 0], [10, 10]], from: 'sigil:0', to: 'ring:0' },
          { points: [[1, 1], [2, 2]], from: 'sign-instance:0', to: 'missing:0' },
          { points: [[3, 3], [4, 4]], from: 'import.visual:0:0' },
        ],
      },
    ],
  });
  const seal = program.seals[0];
  const water = seal.symbols.find((s) => s.objectId === 'sigil:0');
  const column = seal.symbols.find((s) => s.objectId === 'sign-instance:0');
  const visual = seal.symbols.find((s) => s.objectId === 'import.visual:0:0');

  assert.deepEqual(seal.lines.map((line) => line.connections), [
    [
      {
        lineId: 'line:0',
        endpoint: 'from',
        targetId: 'sigil:0',
        targetKind: 'symbol',
        sourcePath: '/seals/0/lines/0',
      },
      {
        lineId: 'line:0',
        endpoint: 'to',
        targetId: 'ring:0',
        targetKind: 'ring',
        sourcePath: '/seals/0/lines/0',
      },
    ],
    [
      {
        lineId: 'line:1',
        endpoint: 'from',
        targetId: 'sign-instance:0',
        targetKind: 'symbol',
        sourcePath: '/seals/0/lines/1',
      },
      {
        lineId: 'line:1',
        endpoint: 'to',
        targetId: 'missing:0',
        targetKind: 'unresolved',
        sourcePath: '/seals/0/lines/1',
      },
    ],
    [
      {
        lineId: 'line:2',
        endpoint: 'from',
        targetId: 'import.visual:0:0',
        targetKind: 'symbol',
        sourcePath: '/seals/0/lines/2',
      },
    ],
  ]);
  assert.deepEqual(seal.lines[1].unresolvedAnchors, [
    { endpoint: 'to', targetId: 'missing:0', targetKind: 'unresolved' },
  ]);
  assert.deepEqual(water.geometry.lineConnections, [
    {
      lineId: 'line:0',
      endpoint: 'from',
      targetKind: 'symbol',
      targetId: 'sigil:0',
      sourcePath: '/seals/0/lines/0',
    },
  ]);
  assert.deepEqual(seal.rings[0].lineConnections, [
    {
      lineId: 'line:0',
      endpoint: 'to',
      targetKind: 'ring',
      targetId: 'ring:0',
      sourcePath: '/seals/0/lines/0',
    },
  ]);
  assert.deepEqual(column.geometry.lineConnections, [
    {
      lineId: 'line:1',
      endpoint: 'from',
      targetKind: 'symbol',
      targetId: 'sign-instance:0',
      sourcePath: '/seals/0/lines/1',
    },
  ]);
  assert.deepEqual(visual.geometry.lineConnections, [
    {
      lineId: 'line:2',
      endpoint: 'from',
      targetKind: 'symbol',
      targetId: 'import.visual:0:0',
      sourcePath: '/seals/0/lines/2',
    },
  ]);
});

test('VAL-IMPORT-020: ring and line visual style and visibility are normalized', () => {
  const program = importSpell({
    title: 'Style preservation probe',
    seals: [
      {
        rings: [
          {
            radius: 100,
            visible: false,
            stroke: { color: '#445566', width: 3, opacity: 0.35 },
          },
          {
            radius: 120,
            color: '#778899',
            weight: 2,
            opacity: 1.5,
          },
        ],
        sigils: [{ name: 'sigil_Water' }],
        lines: [
          {
            points: [[0, 0], [5, 5]],
            hidden: true,
            color: '#112233',
            weight: 1.5,
            opacity: 0.4,
          },
          {
            points: [[1, 1], [6, 6]],
            stroke: { color: '#abcdef', weight: 2.5, opacity: -1 },
          },
        ],
      },
    ],
  });
  const [hiddenRing, visibleRing] = program.seals[0].rings;
  const [hiddenLine, visibleLine] = program.seals[0].lines;

  assert.deepEqual(hiddenRing.visibility, {
    visible: false,
    active: false,
    source: 'explicit_visible_false',
    decorative: false,
  });
  assert.deepEqual(hiddenRing.style, {
    strokeColor: '#445566',
    strokeWeight: 3,
    strokeOpacity: 0.35,
  });
  assert.deepEqual(visibleRing.visibility, {
    visible: true,
    active: true,
    source: 'default_visible',
    decorative: false,
  });
  assert.deepEqual(visibleRing.style, {
    strokeColor: '#778899',
    strokeWeight: 2,
    strokeOpacity: 1,
  });
  assert.deepEqual(hiddenLine.visibility, {
    visible: false,
    active: false,
    source: 'explicit_hidden_true',
    decorative: false,
  });
  assert.equal(hiddenLine.semanticEligibility, 'visual_only');
  assert.deepEqual(hiddenLine.style, {
    strokeColor: '#112233',
    strokeWeight: 1.5,
    strokeOpacity: 0.4,
  });
  assert.deepEqual(visibleLine.visibility, {
    visible: true,
    active: true,
    source: 'default_visible',
    decorative: false,
  });
  assert.equal(visibleLine.semanticEligibility, undefined);
  assert.deepEqual(visibleLine.style, {
    strokeColor: '#abcdef',
    strokeWeight: 2.5,
    strokeOpacity: 0,
  });
  assert.equal(program.importMetadata.rawUnknownFields, undefined);
});

test('VAL-IMPORT-016: ring closure tracks explicit, unknown, and compatibility defaults', () => {
  const projectProgram = importSpellFromJson({
    title: 'Ring closure probe',
    seals: [
      {
        rings: [
          { radius: 100 },
          { radius: 110, open: false },
          { radius: 120, open: true },
          { radius: 130, openingSize: 0 },
          { radius: 140, openingSize: 12 },
        ],
      },
    ],
  });
  assert.deepEqual(
    projectProgram.seals[0].rings.map((ring) => ({
      closureState: ring.closureState,
      closureSource: ring.closureSource,
      closureDefaultApplied: ring.closureDefaultApplied,
      openingSize: ring.openingSize,
    })),
    [
      {
        closureState: 'unknown',
        closureSource: 'missing_external_closure',
        closureDefaultApplied: true,
        openingSize: undefined,
      },
      {
        closureState: 'closed',
        closureSource: 'explicit_open_flag',
        closureDefaultApplied: false,
        openingSize: undefined,
      },
      {
        closureState: 'open',
        closureSource: 'explicit_open_flag',
        closureDefaultApplied: false,
        openingSize: undefined,
      },
      {
        closureState: 'closed',
        closureSource: 'explicit_opening_size',
        closureDefaultApplied: false,
        openingSize: 0,
      },
      {
        closureState: 'open',
        closureSource: 'explicit_opening_size',
        closureDefaultApplied: false,
        openingSize: 12,
      },
    ],
  );

  const spellMakerProgram = importSpellFromJson({
    name: 'Spell Maker closure probe',
    seals: [
      {
        scale: 20,
        rings: [{}],
        signs: [{ name: 'sign_Column' }],
      },
    ],
  });
  assert.deepEqual(spellMakerProgram.seals[0].rings[0], {
    ringId: 'ring:0',
    radius: 450,
    center: { x: 0, y: 0 },
    visibility: {
      visible: true,
      active: true,
      source: 'default_visible',
      decorative: false,
    },
    closureState: 'closed',
    closureSource: 'spell_maker_compat_default',
    closureDefaultApplied: true,
    provenance: {
      sourceKind: 'direct_json',
      sourcePath: '/seals/0/rings/0',
      raw: {},
    },
  });
});

test('VAL-IMPORT-017: invisible and decorative symbols are preserved as visual-only', () => {
  const program = importSpell({
    title: 'Visibility policy probe',
    seals: [
      {
        sigils: [
          { name: 'sigil_Water', visible: false },
          { name: 'sigil_Fire', hidden: false },
          { name: 'sigil_Earth', decorative: true },
        ],
        signProfiles: [
          { kind: 'sign_Column', amount: 2, radius: 80, visible: false },
          { kind: 'sign_Gather', amount: 1, radius: 90, hidden: false },
        ],
      },
    ],
  });
  const seal = program.seals[0];
  const water = seal.symbols.find((s) => s.resolvedRegistryId === 'sigil.water');
  const fire = seal.symbols.find((s) => s.resolvedRegistryId === 'sigil.fire');
  const earth = seal.symbols.find((s) => s.resolvedRegistryId === 'sigil.earth');
  const columnGenerator = seal.symbols.find((s) => s.objectId === 'sign-generator:0');
  const columnInstances = seal.symbols.filter(
    (s) => s.resolvedRegistryId === 'sign.column' && s.objectId.startsWith('sign-instance:'),
  );
  const gather = seal.symbols.find(
    (s) => s.resolvedRegistryId === 'sign.gather' && s.objectId.startsWith('sign-instance:'),
  );

  assert.equal(water.semanticEligibility, 'visual_only');
  assert.deepEqual(water.geometry.visibility, {
    visible: false,
    active: false,
    source: 'explicit_visible_false',
    decorative: false,
  });
  assert.equal(fire.semanticEligibility, 'eligible');
  assert.deepEqual(fire.geometry.visibility, {
    visible: true,
    active: true,
    source: 'explicit_hidden_false',
    decorative: false,
  });
  assert.equal(earth.semanticEligibility, 'visual_only');
  assert.equal(earth.geometry.visibility.source, 'explicit_decorative_true');
  assert.equal(columnGenerator.semanticEligibility, 'visual_only');
  assert.equal(columnGenerator.geometry.visibility.source, 'explicit_visible_false');
  assert.equal(columnInstances.length, 2);
  assert.ok(columnInstances.every((s) => s.semanticEligibility === 'visual_only'));
  assert.equal(gather.semanticEligibility, 'eligible');
  assert.equal(gather.geometry.visibility.source, 'explicit_hidden_false');
  assert.equal(
    program.importMetadata.sameKindSignGroups.some((group) => group.registryId === 'sign.column'),
    false,
  );
});

test('VAL-IMPORT-018: unresolvedObjects indexes preserved non-active render objects', () => {
  const program = importSpell({
    title: 'Non-active object index probe',
    seals: [
      {
        sigils: [
          { name: 'sigil_Water' },
          { name: 'unknown_moon' },
          { name: 'sigil_Earth', decorative: true },
        ],
        signProfiles: [
          { kind: 'sign_Column', amount: 1, radius: 80 },
          { kind: 'sign_Rain', amount: 1, radius: 90 },
          { kind: 'sign_Gather', amount: 1, radius: 100, hidden: true },
        ],
        customImages: [
          {
            label: 'Margin sketch',
            src: 'margin-sketch.png',
            x: 4,
            y: -6,
            size: 32,
          },
        ],
      },
    ],
  });

  const indexed = program.unresolvedObjects.map((item) => ({
    objectId: item.objectId,
    categoryHint: item.categoryHint,
    registryCandidate: item.registryCandidate,
    resolvedRegistryId: item.resolvedRegistryId,
    semanticEligibility: item.semanticEligibility,
    customImageMarker: item.customImageMarker,
    assetRef: item.assetRef,
    sourcePath: item.sourcePath,
    visibilitySource: item.geometry.visibility?.source ?? null,
  }));

  assert.deepEqual(indexed, [
    {
      objectId: 'sigil:1',
      categoryHint: 'sigil',
      registryCandidate: 'sigil.unknown_moon',
      resolvedRegistryId: null,
      semanticEligibility: 'unresolved',
      customImageMarker: false,
      assetRef: null,
      sourcePath: '/seals/0/sigils/1',
      visibilitySource: 'default_visible',
    },
    {
      objectId: 'sigil:2',
      categoryHint: 'sigil',
      registryCandidate: 'sigil.earth',
      resolvedRegistryId: 'sigil.earth',
      semanticEligibility: 'visual_only',
      customImageMarker: false,
      assetRef: null,
      sourcePath: '/seals/0/sigils/2',
      visibilitySource: 'explicit_decorative_true',
    },
    {
      objectId: 'sign-instance:1',
      categoryHint: 'sign',
      registryCandidate: 'sign.rain',
      resolvedRegistryId: 'sign.rain',
      semanticEligibility: 'diagnostic_only',
      customImageMarker: false,
      assetRef: null,
      sourcePath: '/seals/0/signProfiles/1',
      visibilitySource: 'default_visible',
    },
    {
      objectId: 'sign-generator:1',
      categoryHint: 'sign',
      registryCandidate: 'sign.rain',
      resolvedRegistryId: 'sign.rain',
      semanticEligibility: 'diagnostic_only',
      customImageMarker: false,
      assetRef: null,
      sourcePath: '/seals/0/signProfiles/1',
      visibilitySource: 'default_visible',
    },
    {
      objectId: 'sign-instance:2',
      categoryHint: 'sign',
      registryCandidate: 'sign.gather',
      resolvedRegistryId: 'sign.gather',
      semanticEligibility: 'visual_only',
      customImageMarker: false,
      assetRef: null,
      sourcePath: '/seals/0/signProfiles/2',
      visibilitySource: 'explicit_hidden_true',
    },
    {
      objectId: 'sign-generator:2',
      categoryHint: 'sign',
      registryCandidate: 'sign.gather',
      resolvedRegistryId: 'sign.gather',
      semanticEligibility: 'visual_only',
      customImageMarker: false,
      assetRef: null,
      sourcePath: '/seals/0/signProfiles/2',
      visibilitySource: 'explicit_hidden_true',
    },
    {
      objectId: 'import.visual:0:0',
      categoryHint: 'custom_image',
      registryCandidate: 'import.visual:0:0',
      resolvedRegistryId: null,
      semanticEligibility: 'visual_only',
      customImageMarker: true,
      assetRef: 'margin-sketch.png',
      sourcePath: '/seals/0/customImages/0',
      visibilitySource: 'default_visible',
    },
  ]);

  assert.equal(
    program.unresolvedObjects.some((item) => item.resolvedRegistryId === 'sigil.water'),
    false,
  );
  assert.equal(
    program.unresolvedObjects.some((item) => item.resolvedRegistryId === 'sign.column'),
    false,
  );
  assert.deepEqual(program.unresolvedObjects[0].geometry.sourceGeometry, {
    sourcePath: '/seals/0/sigils/1',
  });
});

test('index.js re-exports importSpell', () => {
  const program = importSpellExported(loadFixture('minimal-defaults.json'));
  assert.equal(program.source.kind, 'direct_json');
  assert.equal(typeof decodeSpellShareLinkExported, 'function');
});

test('Spell Maker export: name, signs[], sigil_/sign_ tokens', () => {
  const program = importSpell(loadFixture('spellmaker-water-heater.json'));
  assert.equal(program.title, 'Water Heater');

  const seal = program.seals[0];
  assert.equal(seal.transform.scaleX, 0.2);
  assert.equal(seal.rings[0].radius, 450);
  assert.equal(seal.rings[0].closureState, 'open');
  const water = seal.symbols.find((s) => s.resolvedRegistryId === 'sigil.water');
  assert.ok(water);
  assert.equal(water.provenance.sourcePath, '/seals/0/sigils/0');
  assert.equal(water.geometry.size, 400);

  const crosshairInstances = seal.symbols.filter(
    (s) => s.resolvedRegistryId === 'sign.crosshair' && s.objectId.startsWith('sign-instance:'),
  );
  assert.equal(crosshairInstances.length, 2);
  assert.equal(crosshairInstances[0].provenance.sourcePath, '/seals/0/signs/0');
  assert.equal(crosshairInstances[0].geometry.facingDeg, 90);
  assert.equal(crosshairInstances[0].geometry.polarRadius, 325);
  assert.equal(crosshairInstances[0].geometry.defaultRadiusApplied, true);

  const radialInstances = seal.symbols.filter(
    (s) => s.resolvedRegistryId === 'sign.radial' && s.objectId.startsWith('sign-instance:'),
  );
  assert.equal(radialInstances.length, 4);

  const fireInstances = seal.symbols.filter(
    (s) => s.resolvedRegistryId === 'sigil.fire' && s.objectId.startsWith('sigil-instance:'),
  );
  assert.equal(fireInstances.length, 2);
  for (const fi of fireInstances) {
    assert.equal(fi.geometry.polarRadius, 320);
    assert.equal(fi.geometry.facingDeg, 180);
    assert.equal(fi.geometry.placementRotationDeg, 90);
  }

  const radialProfile0 = seal.symbols.find(
    (s) =>
      s.provenance.sourcePath === '/seals/0/signs/1' &&
      s.objectId.startsWith('sign-generator:') &&
      (s.radial?.instances?.length ?? 0) === 2,
  );
  assert.ok(radialProfile0);
  assert.equal(radialProfile0.geometry.placementRotationDeg, 60);
});

test('Spell Maker export: omitted defaults match website placement behavior', () => {
  const program = importSpell({
    name: 'Sylph Shoes probe',
    seals: [
      {
        rings: [{ name: 'Main' }],
        sigils: [{ name: 'sigil_Wind Underfoot', size: 550 }],
        signs: [{ name: 'sign_Convergence' }, { name: 'sign_Levitation', rotation: 22 }],
      },
    ],
  });

  const seal = program.seals[0];
  assert.equal(seal.rings[0].radius, 450);
  const wind = seal.symbols.find((s) => s.categoryHint === 'sigil');
  assert.equal(wind.geometry.size, 550);

  const convergence = seal.symbols
    .filter((s) => s.resolvedRegistryId === 'sign.convergence' && s.objectId.startsWith('sign-instance:'))
    .sort((a, b) => a.radial.slotIndex - b.radial.slotIndex);
  assert.equal(convergence.length, 8);
  assert.equal(convergence[0].geometry.size, 200);
  assert.equal(convergence[0].geometry.polarRadius, 325);
  assert.equal(convergence[0].geometry.polarAngleDeg, -90);
  assert.ok(Math.abs(convergence[0].geometry.localPosition.x) < 1e-9);
  assert.equal(convergence[0].geometry.localPosition.y, -325);

  const levitation = seal.symbols
    .filter((s) => s.resolvedRegistryId === 'sign.levitation' && s.objectId.startsWith('sign-instance:'))
    .sort((a, b) => a.radial.slotIndex - b.radial.slotIndex);
  assert.equal(levitation.length, 8);
  assert.equal(levitation[0].geometry.placementRotationDeg, 22);
  assert.equal(levitation[0].geometry.polarAngleDeg, -68);
  assert.equal(levitation[0].geometry.facingDeg, 0);
});

/**
 * @param {object} program
 */
function collectStableIds(program) {
  const seal = program.seals[0];
  return {
    programId: program.programId,
    sealIds: program.seals.map((s) => s.sealId),
    ringIds: seal.rings.map((r) => r.ringId),
    lineIds: seal.lines.map((l) => l.lineId),
    symbolIds: seal.symbols.map((s) => s.objectId).sort(),
    generatorIds: seal.symbols
      .filter((s) => s.objectId.startsWith('sign-generator:'))
      .map((s) => s.objectId),
    instanceIds: seal.symbols
      .filter((s) => s.objectId.startsWith('sign-instance:'))
      .map((s) => s.objectId),
    diagnosticCodes: program.diagnostics.map((d) => d.code),
  };
}
