import { expect, test } from '@playwright/test';

async function sceneTarget(page) {
  const canvas = page.locator('canvas.scene-canvas');
  await expect(canvas).toBeVisible({ timeout: 120_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Scene canvas has no bounding box');
  return {
    canvas,
    position: { x: box.width * 0.36, y: box.height * 0.56 },
  };
}

async function activeWindStreaks(page) {
  return page.evaluate(() => {
    const effects = Object.values(window.__WHA_MAIN_ELEMENT_DISPERSIONS__ ?? {});
    return effects.find((effect) => effect.element === 'wind')?.windStreaks ?? null;
  });
}

test('large-to-small Wind dispersion keeps its surviving streaks around the full circle', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/dev');
  const target = await sceneTarget(page);

  await page.getByRole('button', { name: 'Spellpad — inventory slot 1' }).click({ force: true });
  await target.canvas.click({ force: true, position: target.position });
  const spellpad = page.getByRole('dialog', { name: 'Spellpad' });
  await spellpad.getByRole('button', { name: 'Create spell' }).click();

  const maker = page.getByRole('dialog', { name: 'Create spell' });
  await maker.getByLabel('Spell name').fill('Wind Scale Regression');
  await maker.getByRole('radio', { name: 'Wind' }).check();
  await maker.getByLabel('Sign type').selectOption('sign.dispersion');
  await maker.getByRole('button', { name: 'Save spell' }).click();
  await page.getByRole('dialog', { name: 'Spellpad' }).getByRole('button', { name: 'Close' }).click();

  await target.canvas.click({ button: 'right', force: true, position: target.position });
  await expect(page.getByTestId('tool-status')).toContainText('Wind Scale Regression placed inactive');

  await page.getByRole('button', { name: 'Spell Manager — inventory slot 2' }).click({ force: true });
  await target.canvas.click({ force: true, position: target.position });
  const manager = page.getByRole('dialog', { name: 'Spell Manager' });
  await manager.getByRole('button', { name: 'Toggled' }).click();
  await manager.getByRole('button', { name: 'Activate' }).click();
  await manager.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Wrench — inventory slot 3' }).click({ force: true });
  const wrench = page.getByTestId('wrench-hud');
  await expect(wrench).toBeVisible();
  const scale = wrench.getByLabel('Uniform scale');

  await scale.fill('4');
  await scale.press('Enter');
  await expect.poll(() => activeWindStreaks(page), { timeout: 15_000 }).toMatchObject({
    count: expect.any(Number),
    layout: {
      angularCount: expect.any(Number),
      renderedSlotCount: expect.any(Number),
      storageSlotCount: expect.any(Number),
      angularSpanRadians: expect.any(Number),
    },
  });
  const large = await activeWindStreaks(page);
  expect(large.count).toBeGreaterThan(20);

  await scale.fill('0.25');
  await scale.press('Enter');
  await expect.poll(() => activeWindStreaks(page), { timeout: 15_000 }).toMatchObject({
    count: 6,
    layout: {
      angularCount: 6,
      renderedSlotCount: 6,
    },
  });
  const small = await activeWindStreaks(page);
  expect(small.layout.storageSlotCount).toBeGreaterThan(small.layout.angularCount);
  expect(small.layout.angularSpanRadians).toBeGreaterThan(Math.PI * 1.5);
});
