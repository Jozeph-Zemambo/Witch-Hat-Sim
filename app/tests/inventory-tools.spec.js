import { expect, test } from '@playwright/test';
import { createPressurePlateDocument } from '../src/mechanics/starterDocuments.js';

async function enterWorld(page) {
  await page.goto('/');
  await page.getByTestId('title-play').click();
  await page.getByTestId('acknowledge-enter').click();
  const tutorialSkip = page.getByTestId('tutorial-skip');
  if (await tutorialSkip.count()) await tutorialSkip.click();
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
}

async function completedCanvasClick(page, position) {
  const canvas = page.locator('canvas.scene-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Scene canvas has no bounding box');
  await page.mouse.click(box.x + box.width * position.x, box.y + box.height * position.y);
}

async function assertCanvasToolOpensOnce(page, key, dialogName, position) {
  await page.keyboard.press(key);
  await expect(page.getByTestId(`inventory-slot-${Number(key) - 1}`)).toHaveAttribute('aria-pressed', 'true');
  const expectedTool = dialogName === 'Asset Manager' ? 'asset-manager' : 'weather-manager';
  await expect.poll(() => page.evaluate(() => window.__WHA_SELECTED_TOOL__)).toBe(expectedTool);
  const before = await page.evaluate(() => Number(window.__WHA_PRIMARY_PICK_DEBUG__?.count ?? 0));
  await completedCanvasClick(page, position);
  await expect.poll(() => page.evaluate(() => Number(window.__WHA_PRIMARY_PICK_DEBUG__?.count ?? 0))).toBe(before + 1);
  await expect(page.getByRole('dialog', { name: dialogName })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: dialogName })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__?.inputEnabled)).toBe(true);
}

test('hotbar exposes the six tools and reserves later slots', async ({ page }) => {
  await enterWorld(page);
  await expect(page.getByRole('button', { name: 'Spellpad — inventory slot 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Spell Manager — inventory slot 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Wrench — inventory slot 3' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Asset Manager — inventory slot 4' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Weather Manager — inventory slot 5' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mechanics Library — inventory slot 6' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reserved empty — inventory slot 7' })).toBeVisible();
  await page.keyboard.press('4');
  await expect(page.getByTestId('inventory-slot-3')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('5');
  await expect(page.getByTestId('inventory-slot-4')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('6');
  await expect(page.getByTestId('inventory-slot-5')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('tool-status')).toContainText('Mechanics Library selected');
  await page.keyboard.press('7');
  await expect(page.getByTestId('tool-status')).toContainText('Empty inventory slot selected');
});

test('Mechanics Library edits a saved build in the workshop and supports overwrite or save as new', async ({ page }) => {
  test.setTimeout(120_000);
  const originalDocument = createPressurePlateDocument();
  originalDocument.assemblies[0].editor.opacity = 0.35;
  const originalAssemblyCount = originalDocument.assemblies.length;
  await page.addInitScript(({ document }) => {
    window.localStorage.setItem('wha-mechanics-blueprints-v1', JSON.stringify([{
      blueprintId: 'blueprint:library-edit-test',
      name: 'Library machine',
      document,
    }]));
  }, { document: originalDocument });

  await enterWorld(page);
  await page.getByRole('button', { name: 'Mechanics Library — inventory slot 6' }).click();
  const library = page.getByRole('dialog', { name: 'Mechanics Library' });
  await expect(library.getByText('Library machine', { exact: true })).toBeVisible();
  await expect(library.locator('.mechanics-library-appearance')).toContainText('1 assembly uses custom opacity');
  await library.getByRole('button', { name: 'Edit', exact: true }).click();

  await expect(page).toHaveURL(/\/mechanics\?from=atelier&editBlueprint=blueprint%3Alibrary-edit-test$/);
  await expect(page.getByRole('heading', { name: 'Mechanics Workbench' })).toBeVisible();
  const editContext = page.getByTestId('mechanics-edit-context');
  await expect(editContext).toContainText('Editing Library machine');
  await expect(editContext).toContainText('All changes saved');
  await expect(page.getByTestId('mechanics-status')).toContainText('1 assembly uses custom opacity restored');
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();

  await page.getByRole('toolbar', { name: 'Mechanics tools' }).getByRole('button', { name: 'Shapes', exact: true }).click();
  await page.getByTestId('mechanics-add-cuboid').click();
  await expect(editContext).toContainText('Unsaved changes');
  await page.getByTestId('return-to-atelier').click();
  const leaveDialog = page.getByRole('dialog', { name: 'Leave without saving?' });
  await expect(leaveDialog).toContainText('Your changes to Library machine have not been saved.');
  await leaveDialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editContext).toContainText('All changes saved');
  await expect(page.getByTestId('mechanics-status')).toContainText('updated in the Mechanics Library');

  await page.getByTestId('mechanics-add-sphere').click();
  await page.getByRole('button', { name: 'Save as new', exact: true }).click();
  const blueprints = page.getByRole('dialog', { name: 'Personal blueprints' });
  await expect(blueprints.getByLabel('Blueprint name')).toHaveValue('Library machine copy');
  await blueprints.getByLabel('Blueprint name').fill('Library machine variation');
  await blueprints.getByRole('button', { name: 'Save as new blueprint', exact: true }).click();

  await expect(page.getByRole('dialog', { name: 'Personal blueprints' })).toHaveCount(0);
  await expect(editContext).toContainText('Editing Library machine variation');
  await expect(editContext).toContainText('All changes saved');
  const saved = await page.evaluate(() => JSON.parse(window.localStorage.getItem('wha-mechanics-blueprints-v1')));
  expect(saved).toHaveLength(2);
  expect(saved.find((item) => item.name === 'Library machine').document.assemblies).toHaveLength(originalAssemblyCount + 1);
  expect(saved.find((item) => item.name === 'Library machine variation').document.assemblies).toHaveLength(originalAssemblyCount + 2);
});

test('Mechanics Save / load round-trips editable assembly JSON and keeps malformed input safe', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/mechanics');
  await expect(page.getByRole('heading', { name: 'Mechanics Workbench' })).toBeVisible();

  await page.getByRole('button', { name: 'Save / load', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Personal blueprints' });
  const json = dialog.getByTestId('mechanics-assembly-json');
  const current = JSON.parse(await json.inputValue());
  expect(current.schemaVersion).toBeGreaterThan(0);
  expect(current.assemblies.length).toBeGreaterThan(0);

  await json.fill('{"assemblies":');
  await dialog.getByTestId('mechanics-apply-json').click();
  await expect(dialog.getByRole('alert')).toContainText('invalid JSON');
  await expect(json).toHaveValue('{"assemblies":');

  const pasted = {
    ...current,
    metadata: { ...current.metadata, name: 'Pasted JSON build' },
  };
  await json.fill(JSON.stringify(pasted, null, 2));
  await dialog.getByTestId('mechanics-apply-json').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.mechanics-title-block > div > span')).toHaveText('Pasted JSON build');

  await page.getByRole('button', { name: 'Save / load', exact: true }).click();
  const reloadedDialog = page.getByRole('dialog', { name: 'Personal blueprints' });
  const downloadPromise = page.waitForEvent('download');
  await reloadedDialog.getByTestId('mechanics-export-json').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.json$/);

  const fileImported = {
    ...pasted,
    metadata: { ...pasted.metadata, name: 'File imported build' },
  };
  await reloadedDialog.locator('input[type="file"]').setInputFiles({
    name: 'assembly.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fileImported)),
  });
  await expect(reloadedDialog).toHaveCount(0);
  await expect(page.locator('.mechanics-title-block > div > span')).toHaveText('File imported build');
});

test('placed mechanics render their real Sim Light output instead of a field placeholder', async ({ page }) => {
  const document = createPressurePlateDocument();
  await page.addInitScript(({ pressureDocument }) => {
    window.localStorage.setItem('wha-placed-mechanics-builds-v1', JSON.stringify([{
      id: 'placed-mechanics:light-output-test',
      blueprintId: 'blueprint:light-output-test',
      name: 'Imported Light pressure plate',
      document: pressureDocument,
      anchor: {
        point: { x: 5, y: 0, z: 3 },
        normal: { x: 0, y: 1, z: 0 },
        surfaceId: 'world-surface',
        surfaceKind: 'world',
      },
      transform: {
        position: { x: 5, y: 0, z: 3 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
    }]));
  }, { pressureDocument: document });

  await enterWorld(page);
  await expect.poll(
    () => page.evaluate(() => window.__WHA_MAIN_WORLD_PHYSICS__?.blueprint?.spellDevices?.[0] ?? null),
    { timeout: 20_000 },
  ).toMatchObject({
    active: true,
    outputIntents: expect.arrayContaining([
      expect.objectContaining({ intentType: 'material_column', materialKind: 'light' }),
      expect.objectContaining({ intentType: 'illumination', materialKind: 'light' }),
    ]),
  });
  await expect.poll(
    () => page.evaluate(() => (
      window.__WHA_LOCAL_ILLUMINATION__?.emitters?.find((emitter) => emitter.owner === 'main-mechanics')
      ?? null
    )),
    { timeout: 20_000 },
  ).toMatchObject({ materialKind: 'light', active: true, owner: 'main-mechanics' });
});

test('held-item panel shows both mouse actions for every equipped tool', async ({ page }) => {
  await enterWorld(page);
  const expectedControls = [
    ['1', 'Spellpad', 'Open Spellpad', 'Place selected spell'],
    ['2', 'Spell Manager', 'Open Spell Manager', 'Activate / deactivate spell'],
    ['3', 'Wrench', 'Select item', 'Remove item'],
    ['4', 'Asset Manager', 'Open Asset Manager', 'Place selected asset'],
    ['5', 'Weather Manager', 'Open Weather Manager', 'No action'],
    ['6', 'Mechanics Library', 'Open Mechanics Library', 'Place selected build'],
  ];

  for (const [key, name, m1Action, m2Action] of expectedControls) {
    await page.keyboard.press(key);
    const panel = page.getByTestId('held-item');
    await expect(panel).toHaveAttribute('aria-label', `Held item: ${name}`);
    await expect(panel).toContainText(name);
    await expect(panel.locator('kbd')).toHaveText(['M1', 'M2']);
    await expect(panel.locator('dd')).toHaveText([m1Action, m2Action]);
  }
});

test('Asset Manager is a top-left palette with shapes, nature, and decorative water basin entries', async ({ page }) => {
  await enterWorld(page);
  await page.getByRole('button', { name: 'Asset Manager — inventory slot 4' }).click();
  const manager = page.getByRole('dialog', { name: 'Asset Manager' });
  await expect(manager).toHaveAttribute('aria-modal', 'false');
  await expect(manager.getByText('Shapes', { exact: true })).toBeVisible();
  await expect(manager.getByText('Nature', { exact: true })).toBeVisible();
  const waterCategory = manager.locator('fieldset').filter({ hasText: 'Water basin' });
  await expect(waterCategory).toHaveCount(1);
  await expect(waterCategory).toBeVisible();
  await expect(manager.getByTestId('asset-shape-cuboid')).toBeVisible();
  await expect(manager.getByTestId('asset-shape-sphere')).toBeVisible();
  await expect(manager.getByTestId('asset-shape-nature-tree-cedar')).toBeVisible();
  await expect(manager.getByTestId('asset-shape-nature-rock-small')).toBeVisible();
  await expect(manager.getByTestId('asset-shape-water-basin')).toBeVisible();
  await expect(manager.getByRole('button', { name: 'Add fire' })).toHaveCount(0);
  await expect(manager.getByText('Fire source', { exact: true })).toHaveCount(0);

  await manager.getByTestId('asset-shape-water-basin').click();
  await expect(manager.getByTestId('asset-shape-water-basin')).toHaveAttribute('aria-pressed', 'true');
});

test('Weather Manager changes the shared night and rain state', async ({ page }) => {
  await enterWorld(page);
  await page.getByRole('button', { name: 'Weather Manager — inventory slot 5' }).click();
  const manager = page.getByRole('dialog', { name: 'Weather Manager' });
  await manager.getByRole('button', { name: 'Night' }).click();
  await manager.getByRole('button', { name: 'Rain' }).click();
  await expect(manager).toHaveAttribute('aria-labelledby', 'weather-manager-title');
  await expect(manager.getByRole('status')).toContainText('night · rain');
  await expect(manager.getByRole('button', { name: 'Night' })).toHaveAttribute('aria-pressed', 'true');
  await expect(manager.getByRole('button', { name: 'Rain' })).toHaveAttribute('aria-pressed', 'true');
});

test('canvas primary clicks open Asset and Weather managers from every aim height exactly once', async ({ page }) => {
  test.setTimeout(90_000);
  await enterWorld(page);
  const positions = [
    { x: 0.5, y: 0.12 },
    { x: 0.5, y: 0.5 },
    // Keep the low aim point above the overlaid hotbar; y=.88 now lands on it.
    { x: 0.5, y: 0.78 },
  ];
  for (const position of positions) {
    await assertCanvasToolOpensOnce(page, '4', 'Asset Manager', position);
  }
  for (const position of positions) {
    await assertCanvasToolOpensOnce(page, '5', 'Weather Manager', position);
  }

  await page.keyboard.press('4');
  const before = await page.evaluate(() => Number(window.__WHA_PRIMARY_PICK_DEBUG__?.count ?? 0));
  await completedCanvasClick(page, { x: 0.08, y: 0.08 });
  await expect(page.getByRole('dialog', { name: 'Asset Manager' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Number(window.__WHA_PRIMARY_PICK_DEBUG__?.count ?? 0))).toBe(before + 1);
});

test('Spellpad and Manager primary clicks open UI while secondary clicks keep their world contracts', async ({ page }) => {
  await enterWorld(page);
  for (const [key, dialogName] of [['1', 'Spellpad'], ['2', 'Spell Manager']]) {
    await page.keyboard.press(key);
    const before = await page.evaluate(() => Number(window.__WHA_PRIMARY_PICK_DEBUG__?.count ?? 0));
    await completedCanvasClick(page, { x: 0.5, y: 0.5 });
    await expect(page.getByRole('dialog', { name: dialogName })).toBeVisible();
    await expect.poll(() => page.evaluate(() => Number(window.__WHA_PRIMARY_PICK_DEBUG__?.count ?? 0))).toBe(before + 1);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: dialogName })).toHaveCount(0);

  }

  const canvas = page.locator('canvas.scene-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Scene canvas has no bounding box');
  const afterPrimary = await page.evaluate(() => Number(window.__WHA_PRIMARY_PICK_DEBUG__?.count ?? 0));

  await page.keyboard.press('1');
  await expect.poll(() => page.evaluate(() => window.__WHA_SELECTED_TOOL__)).toBe('spellpad');
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5, { button: 'right' });
  await expect.poll(() => page.evaluate(() => window.__WHA_CONTEXT_PICK_DEBUG__?.surfaceId ?? null)).not.toBeNull();
  await expect(page.getByRole('dialog', { name: 'Spellpad' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.keyboard.press('2');
  await expect.poll(() => page.evaluate(() => window.__WHA_SELECTED_TOOL__)).toBe('manager');
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5, { button: 'right' });
  await expect(page.getByRole('dialog', { name: 'Spell Manager' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => Number(window.__WHA_PRIMARY_PICK_DEBUG__?.count ?? 0))).toBe(afterPrimary);
});

test('placement docks keep world movement and drag-look available while open', async ({ page }) => {
  await enterWorld(page);
  const slot = page.getByRole('button', { name: 'Asset Manager — inventory slot 4' });
  await slot.click();
  const manager = page.getByRole('dialog', { name: 'Asset Manager' });
  await expect(manager).toBeVisible();
  await expect(manager).toHaveAttribute('aria-modal', 'false');
  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__?.inputEnabled)).toBe(true);

  const beforeMove = await page.evaluate(() => window.__WHA_PLAYER__.position);
  await page.keyboard.down('w');
  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__.position)).not.toEqual(beforeMove);
  await page.keyboard.up('w');

  const canvas = page.locator('canvas.scene-canvas');
  const beforeYaw = await page.evaluate(() => window.__WHA_PLAYER__.yaw);
  await page.evaluate(() => {
    const target = document.querySelector('canvas.scene-canvas');
    const rect = target.getBoundingClientRect();
    const pointer = (type, x, buttons) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      button: type === 'pointermove' ? -1 : 0,
      buttons,
      clientX: x,
      clientY: rect.top + rect.height * 0.5,
      pointerId: 81,
      pointerType: 'mouse',
    }));
    pointer('pointerdown', rect.left + rect.width * 0.78, 1);
    pointer('pointermove', rect.left + rect.width * 0.88, 1);
    pointer('pointerup', rect.left + rect.width * 0.88, 0);
  });
  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__.yaw)).not.toBe(beforeYaw);

  await page.keyboard.press('Escape');
  await expect(manager).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__?.inputEnabled)).toBe(true);
  await expect(page.getByTestId('camera-mode-toggle')).toHaveAttribute('data-camera-mode', 'fp');
});

test('Spellpad, Manager, and Wrench remain available after the new slots', async ({ page }) => {
  await enterWorld(page);
  await page.getByRole('button', { name: 'Spellpad — inventory slot 1' }).click();
  await expect(page.getByRole('dialog', { name: 'Spellpad' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Spell Manager — inventory slot 2' }).click();
  await expect(page.getByRole('dialog', { name: 'Spell Manager' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Wrench — inventory slot 3' }).click();
  await expect(page.getByTestId('tool-status')).toContainText('Wrench');
});
