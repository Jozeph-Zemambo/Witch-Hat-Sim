import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const SIGN_IDS = ['sign.column', 'sign.dispersion', 'sign.levitation'];
const SIZES = [100, 200, 300];

function screenshotPath(name) {
  const directory = path.join(
    process.env.FABLING_RUNS ?? '/tmp',
    '01-fix-native-spell-geometry',
    'screenshots',
  );
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, name);
}

async function scenePoint(page) {
  const canvas = page.locator('canvas.scene-canvas');
  await expect(canvas).toBeVisible({ timeout: 120_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Scene canvas has no bounding box');
  return {
    canvas,
    position: {
      x: Math.min(box.width - 20, Math.max(20, box.width * 0.7)),
      y: Math.min(box.height - 20, Math.max(20, box.height * 0.78)),
    },
  };
}

async function openMaker(page) {
  await page.goto('/dev');
  const canvas = page.locator('canvas.scene-canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Scene canvas has no bounding box');
  await page.getByRole('button', { name: 'Spellpad — inventory slot 1' }).click({ force: true });
  await canvas.click({ force: true, position: { x: box.width * 0.36, y: box.height * 0.56 } });
  const spellpad = page.getByRole('dialog', { name: 'Spellpad' });
  await expect(spellpad).toBeVisible();
  await spellpad.getByRole('button', { name: 'Create spell' }).click();
  const maker = page.getByRole('dialog', { name: 'Create spell' });
  await expect(maker).toBeVisible();
  return maker;
}

async function readPreviewContainment(maker, signId) {
  return maker.locator(`.spell-preview-sign[data-glyph-id="${signId}"]`).first().evaluate((sign) => {
    const ring = document.querySelector('[data-testid="spell-maker-preview"] .spell-preview-ring');
    if (!ring) throw new Error('Preview ring is not mounted');
    const ringRect = ring.getBoundingClientRect();
    const center = {
      x: ringRect.left + ringRect.width / 2,
      y: ringRect.top + ringRect.height / 2,
    };
    const ringRadius = Math.min(ringRect.width, ringRect.height) / 2;
    const svg = sign.querySelector('svg');
    if (!svg) throw new Error('Canonical sign SVG is not mounted');
    const box = svg.getBBox();
    const matrix = svg.getScreenCTM();
    if (!matrix) throw new Error('Canonical sign SVG has no screen transform');
    const corners = [
      [box.x, box.y],
      [box.x + box.width, box.y],
      [box.x, box.y + box.height],
      [box.x + box.width, box.y + box.height],
    ].map(([x, y]) => [
      matrix.a * x + matrix.c * y + matrix.e,
      matrix.b * x + matrix.d * y + matrix.f,
    ]);
    const measuredRadius = Math.max(...corners.map(([x, y]) => Math.hypot(x - center.x, y - center.y)));
    return {
      ringRadius,
      ringRect: ringRect.toJSON(),
      measuredRadius,
      signRect: sign.getBoundingClientRect().toJSON(),
      svgRect: svg.getBoundingClientRect().toJSON(),
      svgBox: { x: box.x, y: box.y, width: box.width, height: box.height },
      svgTransform: { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f },
      layout: JSON.parse(sign.dataset.layoutBounds),
      gap: Number(sign.dataset.layoutGap),
      radius: Number(sign.dataset.layoutRadius),
    };
  });
}

test('native authored preview keeps Column, Dispersion, and Levitation manually sized', async ({ page }) => {
  test.setTimeout(75_000);
  const maker = await openMaker(page);
  await maker.getByLabel('Spell name').fill('Geometry proof');
  const signType = maker.getByLabel('Sign type');
  const sizeInput = maker.getByLabel('Sign 1 size');

  for (const signId of SIGN_IDS) {
    await signType.selectOption(signId);
    for (const size of SIZES) {
      await sizeInput.fill(String(size));
      const sign = maker.locator(`.spell-preview-sign[data-glyph-id="${signId}"]`).first();
      await expect(sign).toBeVisible();
      const measurement = await readPreviewContainment(maker, signId);
      expect(measurement.gap).toBeGreaterThan(0);
      expect(measurement.radius).toBeLessThanOrEqual(100);
      expect(measurement.measuredRadius).toBeGreaterThan(0);
    }
  }

  await signType.selectOption('sign.column');
  await sizeInput.fill('200');
  const fixedSign = maker.locator('.spell-preview-sign[data-glyph-id="sign.column"]').first();
  const fixedBefore = await fixedSign.evaluate((element) => ({
    gap: element.dataset.layoutGap,
    width: element.style.width,
    height: element.style.height,
    size: element.dataset.signSize,
  }));
  await maker.getByLabel('Sign 1 position').fill('73');
  await maker.getByLabel('Sign 1 facing').fill('137');
  await expect(fixedSign).toHaveAttribute('data-sign-size', '200');
  expect(await fixedSign.evaluate((element) => ({
    gap: element.dataset.layoutGap,
    width: element.style.width,
    height: element.style.height,
    size: element.dataset.signSize,
  }))).toEqual(fixedBefore);
  await page.screenshot({ path: screenshotPath('native-spell-preview-max-size.png') });
});

test('active main-world dispersion centers above its placed spell circle', async ({ page }) => {
  test.setTimeout(75_000);
  await page.goto('/dev');
  await page.getByLabel('Spell JSON').fill(JSON.stringify({
    title: 'Centered explicit water dispersion',
    seals: [{
      sigils: [{ name: 'water' }],
      rings: [{ radius: 100 }],
      signProfiles: [{
        kind: 'dispersion',
        amount: 4,
        size: 200,
        rotation: 0,
        angle: 0,
        radius: 80,
      }],
    }],
  }));
  await page.getByRole('button', { name: 'Compile', exact: true }).click();
  await expect(page.getByTestId('compile-status')).toHaveText('Compile OK');
  await page.getByRole('button', { name: 'Save to Spellpad' }).click();

  const target = await scenePoint(page);
  await target.canvas.click({ button: 'right', force: true, position: target.position });
  await page.getByRole('button', { name: 'Spell Manager — inventory slot 2' }).click({ force: true });
  await target.canvas.click({ force: true, position: target.position });
  const manager = page.getByRole('dialog', { name: 'Spell Manager' });
  await expect(manager).toBeVisible();
  await manager.getByRole('button', { name: 'Toggled' }).click();
  await manager.getByRole('button', { name: 'Activate' }).click();
  await expect(page.getByTestId('dispersion-count')).toHaveText('1');

  await expect.poll(() => page.evaluate(() => ({
    native: window.__WHA_NATIVE_SPELL_GEOMETRY__?.[0] ?? null,
    water: Object.values(window.__WHA_MAIN_WATER_DISPERSIONS__ ?? {})[0] ?? null,
  }))).toMatchObject({
    native: { emergenceOrigin: expect.any(Object) },
    water: { promotedToMain: true },
  });
  await manager.getByRole('button', { name: 'Close' }).click();
  await expect(manager).toHaveCount(0);
  await page.screenshot({ path: screenshotPath('native-dispersion-ground-emergence.png') });
  const state = await page.evaluate(() => ({
    native: window.__WHA_NATIVE_SPELL_GEOMETRY__?.[0] ?? null,
    water: Object.values(window.__WHA_MAIN_WATER_DISPERSIONS__ ?? {})[0] ?? null,
  }));
  expect(state.native.emergenceOrigin).toEqual(state.native.runtimeOrigin);
  expect(state.native.emergenceOrigin).not.toEqual(state.native.sourceAnchor);
  const offset = {
    x: state.native.emergenceOrigin.x - state.native.placementFrameOrigin.x,
    y: state.native.emergenceOrigin.y - state.native.placementFrameOrigin.y,
    z: state.native.emergenceOrigin.z - state.native.placementFrameOrigin.z,
  };
  const normal = state.native.placementFrameNormal;
  const parallelDistance = offset.x * normal.x + offset.y * normal.y + offset.z * normal.z;
  const perpendicularDistance = Math.hypot(
    offset.y * normal.z - offset.z * normal.y,
    offset.z * normal.x - offset.x * normal.z,
    offset.x * normal.y - offset.y * normal.x,
  );
  expect(parallelDistance).toBeCloseTo(state.native.surfaceClearance, 3);
  expect(parallelDistance).toBeGreaterThan(0);
  expect(perpendicularDistance).toBeLessThan(0.001);
  expect(state.water.sourceHeight).toBeCloseTo(state.native.emergenceOrigin.y, 3);
  expect(state.water.sourceHeight).toBeLessThan(0.5);
});
