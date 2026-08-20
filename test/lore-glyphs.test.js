import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  LORE_GLYPH_IDS,
  getGlyphDefinition,
  glyphRenderPolicy,
  glyphToSvg,
  resolveGlyphGeometry,
  signGrowthMetrics,
} from '../src/glyphs/lore-glyphs.js';
import { resolveNativeSignLayout } from '../src/glyphs/native-sign-layout.js';
import { compileSpell } from '../src/compiler/compile.js';
import { interpretCompiledSpell } from '../src/simulation-engine/index.js';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name) => JSON.parse(readFileSync(path.join(fixtureDir, name), 'utf8'));

test('glyph registry covers the five sigils and three in-scope signs exactly', () => {
  assert.deepEqual(LORE_GLYPH_IDS, [
    'sigil.water', 'sigil.fire', 'sigil.earth', 'sigil.wind', 'sigil.light',
    'sign.column', 'sign.dispersion', 'sign.levitation',
  ]);
  for (const id of LORE_GLYPH_IDS) assert.ok(getGlyphDefinition(id));
});

test('glyph topology exposes the binding component counts and landmarks', () => {
  const expected = {
    'sigil.water': [3, ['central_s_flow', 'left_round_droplet', 'right_elongated_droplet']],
    'sigil.fire': [5, ['upright_triangle', 'extended_base', 'center_stem', 'left_spark', 'right_spark']],
    'sigil.earth': [6, ['top_bar', 'center_stem', 'hooked_v', 'lower_bar', 'left_dot', 'right_dot']],
    'sigil.wind': [5, ['double_spiral_s', 'left_dash', 'right_dash', 'left_tick', 'right_tick']],
    'sigil.light': [4, ['axis_square', 'inscribed_diamond', 'vertical_rays', 'horizontal_rays']],
    'sign.column': [2, ['wide_base', 'inward_stick']],
    'sign.dispersion': [3, ['base_bar', 'inward_stick', 'lower_cup']],
    'sign.levitation': [3, ['narrow_base', 'inward_stick', 'arrow_head']],
  };
  for (const [id, [count, landmarks]] of Object.entries(expected)) {
    const geometry = resolveGlyphGeometry(id, { size: 200 });
    assert.equal(geometry.primitives.length, count, id);
    assert.deepEqual(geometry.landmarks, landmarks, id);
    assert.deepEqual(geometry.primitives.map((primitive) => primitive.role), landmarks, id);
  }
  assert.equal(resolveGlyphGeometry('sigil.earth').primitives.filter((item) => item.fill).length, 2);
});

test('sign growth is stick-dominant with only slight terminal and stroke growth', () => {
  const small = signGrowthMetrics(100);
  const large = signGrowthMetrics(300);
  assert.equal(small.stickLength, 0.28);
  assert.equal(large.stickLength, 0.9);
  assert.equal(small.headWidth, 0.18);
  assert.equal(large.headWidth, 0.21);
  assert.equal(small.strokeWidth, 0.018);
  assert.equal(large.strokeWidth, 0.022);
  assert.ok(Math.abs(large.dimensionalGrowthToStick - 0.932330827) < 1e-6);
});

test('SVG adapter consumes canonical roles and preserves sign inward geometry', () => {
  const geometry = resolveGlyphGeometry('sign.levitation', { size: 300 });
  const svg = glyphToSvg('sign.levitation', { size: 300, color: '#76100d' });
  assert.match(svg, /data-glyph-id="sign\.levitation"/);
  for (const primitive of geometry.primitives) assert.match(svg, new RegExp(`data-role="${primitive.role}"`));
  const shaft = geometry.primitives.find((item) => item.role === 'inward_stick');
  assert.equal(shaft.commands.at(-1).y, geometry.metrics.stickLength);
  assert.equal(geometry.canonicalAxis, '+y_inward');
});

test('native sign layout contains every native sign at every supported size and facing', () => {
  for (const glyphId of ['sign.column', 'sign.dispersion', 'sign.levitation']) {
    for (const size of [100, 200, 300]) {
      for (const facingDeg of [-180, 0, 90, 180]) {
        const layout = resolveNativeSignLayout({
          containingRingRadius: 100,
          signAnchor: { x: 1, y: 0 },
          facingDeg,
          glyphId,
          size,
          centerClearance: 24,
        });
        assert.ok(layout.availableGap > 0, `${glyphId} size ${size} facing ${facingDeg}`);
        assert.ok(layout.measuredBounds.maxRadius <= 100.0001, `${glyphId} outer containment`);
        assert.ok(layout.measuredBounds.minRadius >= 24 - 0.0001, `${glyphId} center clearance`);
      }
    }
  }
});

test('native layout varies placement for facing while preserving the authored sign size', () => {
  const inward = resolveNativeSignLayout({
    containingRingRadius: 100,
    signAnchor: { x: 1, y: 0 },
    facingDeg: 0,
    glyphId: 'sign.levitation',
    size: 300,
    centerClearance: 24,
  });
  const outward = resolveNativeSignLayout({
    containingRingRadius: 100,
    signAnchor: { x: 1, y: 0 },
    facingDeg: 180,
    glyphId: 'sign.levitation',
    size: 300,
    centerClearance: 24,
  });
  assert.notEqual(inward.placement.radius, outward.placement.radius);
  assert.equal(inward.size, 300);
  assert.equal(outward.size, 300);
});

test('all eight known IDs select lore geometry and unknown IDs alone select dot+label fallback', () => {
  for (const id of LORE_GLYPH_IDS) assert.equal(glyphRenderPolicy(id), 'lore_glyph', id);
  assert.equal(glyphRenderPolicy('sign.pull'), 'unknown_dot_label');
  assert.equal(glyphRenderPolicy('sigil.unknown_moon'), 'unknown_dot_label');
});

test('spell-circle intent carries registry, size, rotation, inward and compiled facing vectors', () => {
  const compiled = compileSpell(fixture('watershot-centered.json'));
  const runtime = interpretCompiledSpell({
    graph: compiled.graph,
    program: compiled.program,
    diagnostics: compiled.diagnostics,
    sceneState: { sources: [], props: [] },
  });
  const circle = runtime.intents.find((intent) => intent.intentType === 'spell_circle_render_data');
  const programSign = compiled.program.seals[0].symbols.find((symbol) => symbol.resolvedRegistryId === 'sign.column' && symbol.objectId.includes('instance'));
  const renderSign = circle.seals[0].symbols.find((symbol) => symbol.objectId === programSign.objectId);
  assert.equal(renderSign.registryId, 'sign.column');
  assert.equal(renderSign.size, 200);
  assert.equal(typeof renderSign.rotationDeg, 'number');
  assert.equal(typeof renderSign.facingDeg, 'number');
  assert.deepEqual(renderSign.renderDirection, programSign.geometryAnalysis.directionVector);
  assert.ok(Math.hypot(renderSign.inwardDirection.x, renderSign.inwardDirection.y) > 0.999);
});
