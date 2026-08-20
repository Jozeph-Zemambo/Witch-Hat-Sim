import { expect, test } from '@playwright/test';

async function enterWorld(page) {
  await page.goto('/');
  await page.evaluate(() => window.sessionStorage.clear());
  await page.reload();
  await page.getByTestId('title-play').click();
  await page.getByTestId('acknowledge-enter').click();
  const tutorialSkip = page.getByTestId('tutorial-skip');
  if (await tutorialSkip.count()) await tutorialSkip.click();
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
}

async function scenePoint(page) {
  const canvas = page.locator('canvas.scene-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Scene canvas has no bounding box');
  return { canvas, position: { x: box.width * 0.7, y: box.height * 0.78 } };
}

test('player journey retains the native spell and world across tools and pressure-plate workbench', async ({ page }) => {
  test.setTimeout(120_000);
  await enterWorld(page);

  await page.getByRole('button', { name: 'Spellpad — inventory slot 1' }).click();
  const spellpad = page.getByRole('dialog', { name: 'Spellpad' });
  await spellpad.getByRole('button', { name: 'Create spell' }).click();
  const maker = page.getByRole('dialog', { name: 'Create spell' });
  await maker.getByLabel('Spell name').fill('Journey Light');
  await maker.getByRole('radio', { name: 'Light' }).check();
  await maker.getByLabel('Count').fill('1');
  await maker.getByLabel('Size').fill('100');
  await maker.getByRole('button', { name: 'Save spell' }).click();
  const savedPad = page.getByRole('dialog', { name: 'Spellpad' });
  await expect(savedPad).toContainText('Journey Light');
  await savedPad.getByRole('button', { name: 'Edit' }).click();
  const padEditor = page.getByRole('dialog', { name: 'Edit spell' });
  await padEditor.getByLabel('Spell name').fill('Journey Light Edited');
  await padEditor.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('dialog', { name: 'Spellpad' })).toContainText('Journey Light Edited');
  await page.getByRole('dialog', { name: 'Spellpad' }).getByRole('button', { name: 'Close' }).click();

  // Use TP for the placement journey; FP pointer ownership is covered by the
  // dedicated camera suite.
  await page.getByTestId('camera-mode-toggle').click();
  await expect(page.getByTestId('camera-mode-toggle')).toHaveAttribute('data-camera-mode', 'tp');
  const target = await scenePoint(page);
  await target.canvas.click({ button: 'right', force: true, position: target.position });
  await expect.poll(() => page.evaluate(() => window.__WHA_CONTEXT_PICK_DEBUG__)).toMatchObject({
    selectedTool: 'spellpad',
  });
  await expect(page.getByTestId('tool-status')).toContainText('Journey Light Edited placed inactive');

  await page.getByRole('button', { name: 'Spell Manager — inventory slot 2' }).click({ force: true });
  const manager = page.getByRole('dialog', { name: 'Spell Manager' });
  await expect(manager).toContainText('Journey Light Edited');
  await expect(manager.getByRole('button', { name: 'Edit spell' })).toBeVisible();
  await manager.getByRole('button', { name: 'Activate' }).click({ force: true });
  await expect(page.getByTestId('tool-status')).toContainText('Journey Light Edited');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Asset Manager — inventory slot 4' }).click();
  await expect(page.getByRole('dialog', { name: 'Asset Manager' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Weather Manager — inventory slot 5' })).toBeVisible();

  await page.getByRole('button', { name: 'Wrench — inventory slot 3' }).click();
  await target.canvas.click({ force: true, position: target.position });
  await expect(page.getByTestId('wrench-hud')).toBeVisible();

  await page.evaluate(() => window.__WHA_SET_PLAYER_STATE__({
    position: { x: -5.55, y: 0, z: -3.35 },
    facing: Math.atan2(-4.1904 - -5.55, -4.3733 - -3.35),
  }));
  await expect(page.getByTestId('workbench-prompt')).toBeVisible();
  await page.getByTestId('enter-workshop').click();
  await expect(page).toHaveURL(/\/mechanics\?from=atelier$/);
  await page.getByRole('button', { name: 'Examples', exact: true }).click();
  await page.getByTestId('mechanics-starter-pressure-plate').click();
  await expect.poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.documentName)).toBe('Light pressure plate');
  await page.getByTestId('mechanics-mode-test').click();
  await expect.poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.gates?.['gate:pressure-light']?.closed)).toBe(true);
  await expect(page.getByText('closed · active', { exact: true })).toBeVisible();
  await page.getByTestId('return-to-atelier').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__WHA_PLACED_SPELLS__?.[0]?.name)).toBe('Journey Light Edited');
});
