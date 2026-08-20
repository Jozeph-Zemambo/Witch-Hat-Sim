import { expect, test } from '@playwright/test';
import path from 'node:path';

async function chooseLightSample(page) {
  const sample = page.getByLabel('Sample spell');
  const option = sample.locator('option').filter({ hasText: /Light Beam/i }).first();
  const value = await option.getAttribute('value');
  if (!value) throw new Error('No Light sample spell is available');
  await sample.selectOption(value);
  await page.getByRole('button', { name: 'Compile', exact: true }).click();
  await page.getByRole('button', { name: 'Save to Spellpad' }).click();
}

async function terrainPosition(page, canvas, box) {
  await page.getByRole('button', { name: 'Spell Manager — inventory slot 2' }).click({ force: true });
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__WHA_SELECTED_TOOL__)).toBe('manager');
  for (const yRatio of [0.5, 0.62, 0.72, 0.82, 0.9]) {
    for (const xRatio of [0.08, 0.24, 0.5, 0.76, 0.92]) {
      const position = { x: box.width * xRatio, y: box.height * yRatio };
      await canvas.click({ button: 'right', force: true, position });
      const surfaceId = await page.evaluate(() => window.__WHA_CONTEXT_PICK_DEBUG__?.surfaceId ?? null);
      if (surfaceId === 'practice-field-terrain') {
        await page.getByRole('button', { name: 'Spellpad — inventory slot 1' }).click({ force: true });
        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => window.__WHA_SELECTED_TOOL__)).toBe('spellpad');
        return position;
      }
    }
  }
  throw new Error('Could not resolve a practice-terrain placement ray');
}

async function placeLightSpell(page) {
  const canvas = page.locator('canvas.scene-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Scene canvas has no bounding box');
  const position = await terrainPosition(page, canvas, box);
  await canvas.click({ button: 'right', force: true, position });
  await page.getByRole('button', { name: 'Spell Manager — inventory slot 2' }).click({ force: true });
  await canvas.click({ force: true, position });
  return page.getByRole('dialog', { name: 'Spell Manager' });
}

async function setNight(page) {
  await page.getByRole('button', { name: 'Night', exact: true }).click();
}

test('main-world Light illuminates nearby surfaces with bounded spatial falloff at day and night', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/dev');
  await expect(page.getByTestId('scene-canvas-frame')).toBeVisible();
  await chooseLightSample(page);
  const manager = await placeLightSpell(page);

  await expect.poll(
    () => page.evaluate(() => window.__WHA_LOCAL_ILLUMINATION__ ?? null),
    { timeout: 8_000 },
  ).toMatchObject({ activeLightCount: 0 });
  await testInfo.attach('light-inactive-debug', {
    body: JSON.stringify(await page.evaluate(() => window.__WHA_LOCAL_ILLUMINATION__ ?? null), null, 2),
    contentType: 'application/json',
  });

  const modeToggle = manager.getByRole('button', { name: 'Toggled' });
  if (await modeToggle.getAttribute('aria-pressed') !== 'true') await modeToggle.click();
  await manager.getByRole('button', { name: 'Activate' }).click();
  await expect.poll(
    () => page.evaluate(() => window.__WHA_LOCAL_ILLUMINATION__ ?? null),
    { timeout: 15_000 },
  ).toMatchObject({ activeLightCount: 1 });
  const activeDay = await page.evaluate(() => window.__WHA_LOCAL_ILLUMINATION__);
  expect(activeDay.activeLightCount).toBeLessThanOrEqual(activeDay.maxLightCount);
  expect(activeDay.emitters[0].materialKind).toBe('light');
  expect(activeDay.emitters[0].normal).toEqual(expect.objectContaining({ x: 0, y: 1, z: 0 }));
  expect(activeDay.emitters[0].origin.y).toBeGreaterThanOrEqual(0);
  expect(activeDay.emitters[0].neighboringSurfaceSamples.near)
    .toBeGreaterThan(activeDay.emitters[0].neighboringSurfaceSamples.edge);
  await testInfo.attach('light-active-day-debug', {
    body: JSON.stringify(activeDay, null, 2),
    contentType: 'application/json',
  });

  await manager.getByRole('button', { name: 'Deactivate' }).click();
  await manager.getByRole('button', { name: 'Close' }).click();
  await expect.poll(
    () => page.evaluate(() => window.__WHA_LOCAL_ILLUMINATION__?.activeLightCount ?? -1),
    { timeout: 8_000 },
  ).toBe(0);
  await setNight(page);
  const screenshotDir = path.join(process.env.FABLING_RUNS ?? '/tmp', '07-build-spell-illumination', 'screenshots');
  await page.evaluate(() => {
    const panel = document.createElement('pre');
    panel.dataset.testid = 'verification-light-debug';
    panel.textContent = JSON.stringify(window.__WHA_LOCAL_ILLUMINATION__ ?? null, null, 2);
    Object.assign(panel.style, {
      position: 'fixed', top: '12px', left: '12px', zIndex: '9999', margin: '0',
      padding: '8px', maxWidth: '420px', maxHeight: '260px', overflow: 'hidden',
      background: 'rgba(12, 14, 22, 0.92)', color: '#fff6cf', font: '11px/1.35 monospace',
      whiteSpace: 'pre-wrap', pointerEvents: 'none',
    });
    document.body.append(panel);
  });
  await page.screenshot({ path: path.join(screenshotDir, 'light-night-inactive.png') });
  await page.getByRole('button', { name: 'Spell Manager — inventory slot 2' }).click({ force: true });
  const nightManager = page.getByRole('dialog', { name: 'Spell Manager' });
  const nightModeToggle = nightManager.getByRole('button', { name: 'Toggled' });
  if (await nightModeToggle.getAttribute('aria-pressed') !== 'true') await nightModeToggle.click();
  await nightManager.getByRole('button', { name: 'Activate' }).click({ force: true });
  await expect.poll(
    () => page.evaluate(() => window.__WHA_LOCAL_ILLUMINATION__ ?? null),
    { timeout: 15_000 },
  ).toMatchObject({ activeLightCount: 1 });
  const activeNight = await page.evaluate(() => window.__WHA_LOCAL_ILLUMINATION__);
  expect(activeNight.emitters[0].neighboringSurfaceSamples.near)
    .toBeGreaterThan(activeNight.emitters[0].neighboringSurfaceSamples.edge);
  await testInfo.attach('light-active-night-debug', {
    body: JSON.stringify(activeNight, null, 2),
    contentType: 'application/json',
  });
  await page.evaluate((debug) => {
    const panel = document.querySelector('[data-testid="verification-light-debug"]');
    if (panel) panel.textContent = JSON.stringify(debug, null, 2);
  }, activeNight);
  await page.screenshot({ path: path.join(screenshotDir, 'light-night-active.png') });
  expect(errors).toEqual([]);
});

test('non-Light main-world output does not register a local Light emitter', async ({ page }) => {
  await page.goto('/dev');
  await expect(page.getByTestId('scene-canvas-frame')).toBeVisible();
  const sample = page.getByLabel('Sample spell');
  const option = sample.locator('option').filter({ hasText: /earth/i }).first();
  const value = await option.getAttribute('value');
  if (!value) throw new Error('No Earth sample spell is available');
  await sample.selectOption(value);
  await page.getByRole('button', { name: 'Compile', exact: true }).click();
  await page.getByRole('button', { name: 'Save to Spellpad' }).click();
  const canvas = page.locator('canvas.scene-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Scene canvas has no bounding box');
  const position = { x: box.width * 0.5, y: box.height * 0.58 };
  await canvas.click({ button: 'right', force: true, position });
  await page.getByRole('button', { name: 'Spell Manager — inventory slot 2' }).click({ force: true });
  await canvas.click({ force: true, position });
  const manager = page.getByRole('dialog', { name: 'Spell Manager' });
  const earthModeToggle = manager.getByRole('button', { name: 'Toggled' });
  if (await earthModeToggle.getAttribute('aria-pressed') !== 'true') await earthModeToggle.click();
  await manager.getByRole('button', { name: 'Activate' }).click();
  await expect.poll(
    () => page.evaluate(() => window.__WHA_LOCAL_ILLUMINATION__?.activeLightCount ?? -1),
    { timeout: 8_000 },
  ).toBe(0);
});
