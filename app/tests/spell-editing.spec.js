import { expect, test } from '@playwright/test';

async function sceneTarget(page) {
  const canvas = page.locator('canvas.scene-canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Scene canvas has no bounding box');
  return { canvas, position: { x: box.width * 0.36, y: box.height * 0.56 } };
}

async function createNativeSpell(page, name = 'Native edit source') {
  const target = await sceneTarget(page);
  await page.getByRole('button', { name: 'Spellpad — inventory slot 1' }).click({ force: true });
  await target.canvas.click({ force: true, position: target.position });
  const pad = page.getByRole('dialog', { name: 'Spellpad' });
  await pad.getByRole('button', { name: 'Create spell' }).click();
  const editor = page.getByRole('dialog', { name: 'Create spell' });
  await editor.getByLabel('Spell name').fill(name);
  await editor.getByRole('button', { name: 'Save spell' }).click();
  await expect(page.getByRole('dialog', { name: 'Spellpad' })).toBeVisible();
  return target;
}

test('Spellpad edits affect only future placements', async ({ page }) => {
  test.setTimeout(75_000);
  await page.goto('/dev');
  const target = await createNativeSpell(page);
  await page.getByRole('dialog', { name: 'Spellpad' }).getByRole('button', { name: 'Close' }).click();
  await target.canvas.click({ button: 'right', force: true, position: target.position });
  await page.getByRole('button', { name: 'Spellpad — inventory slot 1' }).click({ force: true });
  await target.canvas.click({ force: true, position: target.position });
  const pad = page.getByRole('dialog', { name: 'Spellpad' });
  const row = pad.locator('article').filter({ hasText: 'Native edit source' });
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit spell' });
  await expect(editor.getByLabel('Spell name')).toHaveValue('Native edit source');
  await editor.getByLabel('Spell name').fill('Changed glyph spell');
  await editor.getByRole('radio', { name: 'Wind' }).check();
  await editor.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('dialog', { name: 'Spellpad' })).toContainText('Changed glyph spell');
  await page.getByRole('dialog', { name: 'Spellpad' }).getByRole('button', { name: 'Close' }).click();

  await target.canvas.click({ button: 'right', force: true, position: { x: target.position.x + 40, y: target.position.y + 20 } });
  await expect(page.getByTestId('tool-status')).toContainText('Changed glyph spell placed inactive');
  await page.getByRole('button', { name: 'Spell Manager — inventory slot 2' }).click({ force: true });
  await target.canvas.click({ force: true, position: target.position });
  const manager = page.getByRole('dialog', { name: 'Spell Manager' });
  await expect(manager).toContainText('Native edit source #1');
  await expect(manager).toContainText('Changed glyph spell #2');
});

test('Manager edits only the selected placed spell and preserves its activation controls', async ({ page }) => {
  test.setTimeout(75_000);
  await page.goto('/dev');
  const target = await createNativeSpell(page, 'Manager source');
  await page.getByRole('dialog', { name: 'Spellpad' }).getByRole('button', { name: 'Close' }).click();
  await target.canvas.click({ button: 'right', force: true, position: target.position });
  await target.canvas.click({ button: 'right', force: true, position: { x: target.position.x + 40, y: target.position.y + 20 } });
  await page.getByRole('button', { name: 'Spell Manager — inventory slot 2' }).click({ force: true });
  await target.canvas.click({ force: true, position: target.position });
  const manager = page.getByRole('dialog', { name: 'Spell Manager' });
  const first = manager.locator('article').filter({ hasText: 'Manager source #1' });
  await first.getByRole('button', { name: 'Toggled' }).click();
  await first.getByRole('button', { name: 'Activate' }).click();
  await first.getByRole('button', { name: 'Edit spell' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit spell' });
  await editor.getByLabel('Spell name').fill('Manager changed');
  await editor.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('dialog', { name: 'Spell Manager' })).toContainText('Manager changed #1');
  await expect(page.getByRole('dialog', { name: 'Spell Manager' })).toContainText('Manager source #2');
  await expect(page.getByRole('dialog', { name: 'Spell Manager' })).toContainText('active');
  await page.getByRole('dialog', { name: 'Spell Manager' }).getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Spellpad — inventory slot 1' }).click({ force: true });
  await target.canvas.click({ force: true, position: target.position });
  await expect(page.getByRole('dialog', { name: 'Spellpad' })).toContainText('Manager source');
  await expect(page.getByRole('dialog', { name: 'Spellpad' })).not.toContainText('Manager changed');
});

test('invalid native edit is atomic and modified edit close asks for confirmation', async ({ page }) => {
  await page.goto('/dev');
  await createNativeSpell(page, 'Atomic source');
  const pad = page.getByRole('dialog', { name: 'Spellpad' });
  await pad.locator('article').filter({ hasText: 'Atomic source' }).getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit spell' });
  await editor.getByLabel('Spell name').fill('Draft only');
  await editor.getByLabel('Count').fill('0');
  await editor.getByRole('button', { name: 'Save changes' }).click();
  await expect(editor).toBeVisible();
  await expect(editor.getByText(/whole number from 1 to 12/)).toBeVisible();
  await editor.getByRole('button', { name: 'Cancel' }).click();
  const discard = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
  await expect(discard).toBeVisible();
  await discard.getByLabel('Keep editing').click();
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Close' }).click();
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByRole('dialog', { name: 'Spellpad' })).toContainText('Atomic source');
});

test('imported spells remain placeable without Spellpad source or editing tags', async ({ page }) => {
  await page.goto('/dev');
  await page.getByLabel('Sample spell').selectOption('watershot-centered');
  await page.getByRole('button', { name: 'Compile', exact: true }).click();
  await page.getByRole('button', { name: 'Save to Spellpad' }).click();
  const target = await sceneTarget(page);
  await page.getByRole('button', { name: 'Spellpad — inventory slot 1' }).click({ force: true });
  await target.canvas.click({ force: true, position: target.position });
  const pad = page.getByRole('dialog', { name: 'Spellpad' });
  await expect(pad).not.toContainText('Structured editing unavailable for imported spell.');
  await expect(pad.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await expect(pad.locator('.spell-template-thumbnail')).toBeVisible();
  await pad.getByRole('button', { name: 'Close' }).click();
  await target.canvas.click({ button: 'right', force: true, position: target.position });
  await expect(page.getByTestId('tool-status')).toContainText('Centered Watershot columns placed inactive');
  await page.getByRole('button', { name: 'Spell Manager — inventory slot 2' }).click({ force: true });
  await target.canvas.click({ force: true, position: target.position });
  await expect(page.getByRole('dialog', { name: 'Spell Manager' })).toContainText('Structured editing unavailable.');
});
