import { expect, test } from '@playwright/test';

async function sceneTarget(page) {
  const canvas = page.locator('canvas.scene-canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Scene canvas has no bounding box');
  return {
    canvas,
    position: { x: box.width * 0.36, y: box.height * 0.56 },
  };
}

async function openSpellpad(page) {
  const target = await sceneTarget(page);
  await page.getByRole('button', { name: 'Spellpad — inventory slot 1' }).click({ force: true });
  await target.canvas.click({ force: true, position: target.position });
  const dialog = page.getByRole('dialog', { name: 'Spellpad' });
  await expect(dialog).toBeVisible();
  return { dialog, target };
}

test('spell maker entry, controls, canonical preview, validation, save, select, and place', async ({ page }) => {
  // The full maker flow creates and reopens multiple WebGL-backed views; allow
  // the suite's serial GPU-safe runner enough budget for that work.
  test.setTimeout(120_000);
  await page.goto('/dev');
  await expect(page.getByRole('button', { name: 'Create spell' })).toHaveCount(0);

  const { dialog: spellpad, target } = await openSpellpad(page);
  await spellpad.getByRole('button', { name: 'Create spell' }).click();
  const maker = page.getByRole('dialog', { name: 'Create spell' });
  await expect(maker).toBeVisible();
  await expect(maker.getByLabel('Spell name')).toBeFocused();

  await expect(maker.getByRole('radio')).toHaveCount(5);
  for (const name of ['Water', 'Fire', 'Earth', 'Wind', 'Light']) {
    await expect(maker.getByRole('radio', { name })).toBeVisible();
  }
  const signType = maker.getByLabel('Sign type');
  await expect(signType.locator('option')).toHaveText(['Column', 'Dispersion', 'Levitation']);
  await expect(signType.locator('option', { hasText: 'Pull' })).toHaveCount(0);

  await expect(maker.locator('.spell-maker-preview svg[data-glyph-id="sigil.water"]')).toBeVisible();
  await expect(maker.locator('.spell-preview-sign[data-glyph-id="sign.column"]')).toHaveCount(4);
  await maker.getByLabel('Spell name').fill('Wind Scatter');
  await maker.getByRole('radio', { name: 'Wind' }).check();
  await signType.selectOption('sign.dispersion');
  await maker.getByLabel('Count').fill('2');
  await maker.getByLabel('Group rotation').fill('35');
  await maker.getByLabel('Sign 1 size').fill('100');
  await maker.getByLabel('Sign 1 facing').fill('-20');
  await maker.getByLabel('Sign 2 facing').fill('45');

  const previewSigns = maker.locator('.spell-preview-sign[data-glyph-id="sign.dispersion"]');
  await expect(previewSigns).toHaveCount(2);
  await expect(previewSigns.nth(0)).toHaveAttribute('data-placement-deg', '35');
  await expect(previewSigns.nth(0)).toHaveAttribute('data-facing-deg', '-20');
  await expect(previewSigns.nth(1)).toHaveAttribute('data-facing-deg', '45');
  const shortSign = await previewSigns.nth(0).boundingBox();
  await maker.getByLabel('Sign 1 size').fill('300');
  const longSign = await previewSigns.nth(0).boundingBox();
  expect(longSign?.height).toBeGreaterThan(shortSign?.height ?? 0);
  await expect(previewSigns.nth(0).locator('svg[data-glyph-id="sign.dispersion"]')).toBeVisible();

  // Sign 1 position/radius numeric controls stay in sync with the preview.
  await expect(maker.getByLabel('Sign 1 position')).toHaveValue('0');
  await maker.getByLabel('Sign 1 position').fill('10');
  await expect(previewSigns.nth(0)).toHaveAttribute('data-placement-deg', '45');
  await maker.getByLabel('Sign 1 position').fill('0');

  // Facing rotation must never inflate the sign: the fitted gap is capped by
  // the canonical (facing 0) solve, so size stays rotation-invariant.
  const gapAtFacing = async (value) => {
    await maker.getByLabel('Sign 1 facing').fill(String(value));
    return Number(await previewSigns.nth(0).getAttribute('data-layout-gap'));
  };
  const baselineGap = await gapAtFacing(0);
  for (const facing of [30, 90, 330]) {
    expect(await gapAtFacing(facing)).toBeLessThanOrEqual(baselineGap + 0.001);
  }
  await maker.getByLabel('Sign 1 facing').fill('-20');

  await maker.getByRole('button', { name: 'Add group' }).click();
  await expect(maker.getByLabel('Sign type')).toHaveCount(2);
  // Groups after the first mirror group 1's sign; only group 1 keeps the switcher.
  const groupTwoSign = maker.getByLabel('Sign type').nth(1);
  await expect(groupTwoSign).toBeDisabled();
  await expect(groupTwoSign).toHaveValue('sign.dispersion');
  await signType.first().selectOption('sign.levitation');
  await expect(groupTwoSign).toHaveValue('sign.levitation');
  await expect(maker.locator('.spell-preview-sign[data-glyph-id="sign.levitation"]')).toHaveCount(6);
  await signType.first().selectOption('sign.dispersion');
  await maker.getByRole('button', { name: 'Remove group 2' }).click();
  await maker.getByRole('button', { name: 'Confirm remove group 2' }).click();
  await expect(maker.getByLabel('Sign type')).toHaveCount(1);

  await maker.getByLabel('Count').fill('0');
  await maker.getByRole('button', { name: 'Save spell' }).click();
  await expect(maker.getByText('count must be a whole number from 1 to 12')).toBeVisible();
  await expect(maker.getByLabel('Spell name')).toHaveValue('Wind Scatter');
  await expect(maker.getByLabel('Group rotation')).toHaveValue('35');
  await expect(maker.getByLabel('Sign 1 facing')).toHaveValue('-20');
  await expect(maker.getByLabel('Sign 1 size')).toHaveValue('300');

  await maker.getByLabel('Count').fill('2');
  await maker.getByRole('button', { name: 'Save spell' }).click();
  const savedPad = page.getByRole('dialog', { name: 'Spellpad' });
  await expect(savedPad).toBeVisible();
  const savedRow = savedPad.locator('article').filter({ hasText: 'Wind Scatter' });
  await expect(savedRow.getByRole('button', { name: 'Selected Wind Scatter' })).toHaveAttribute('aria-pressed', 'true');
  await expect(savedRow.locator('.spell-template-thumbnail')).toBeVisible();
  await expect(savedRow.getByText('Created spell')).toHaveCount(0);
  await expect(savedRow.getByText('Spell name')).toHaveCount(0);
  await expect(savedRow.getByRole('button', { name: 'Remove', exact: true })).toBeVisible();
  await savedPad.getByRole('button', { name: 'Close' }).click();

  await target.canvas.click({ button: 'right', force: true, position: target.position });
  await expect(page.getByTestId('tool-status')).toContainText('Wind Scatter placed inactive');
  await page.getByRole('button', { name: 'Spell Manager — inventory slot 2' }).click({ force: true });
  await target.canvas.click({ force: true, position: target.position });
  await expect(page.getByRole('dialog', { name: 'Spell Manager' })).toContainText('Wind Scatter #1');
});

test('cancel and close protect a dirty new spell until discard is confirmed', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/dev');
  const { dialog: spellpad, target } = await openSpellpad(page);
  await spellpad.getByRole('button', { name: 'Create spell' }).click();
  let maker = page.getByRole('dialog', { name: 'Create spell' });
  await maker.getByLabel('Spell name').fill('Preserved draft');
  await maker.getByRole('button', { name: 'Cancel' }).click();
  const discard = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
  await expect(discard).toBeVisible();
  await discard.getByText('Keep editing', { exact: true }).click();
  await expect(maker.getByLabel('Spell name')).toHaveValue('Preserved draft');
  await maker.getByRole('button', { name: 'Close' }).click();
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByRole('dialog', { name: 'Spellpad' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Create spell' })).toHaveCount(0);
  await page.getByRole('dialog', { name: 'Spellpad' }).getByRole('button', { name: 'Create spell' }).click();
  maker = page.getByRole('dialog', { name: 'Create spell' });
  await expect(maker.getByLabel('Spell name')).toHaveValue('');
});

test('removing a saved Spellpad template requires confirmation', async ({ page }) => {
  await page.goto('/dev');
  const { dialog: spellpad } = await openSpellpad(page);
  await spellpad.getByRole('button', { name: 'Create spell' }).click();
  const maker = page.getByRole('dialog', { name: 'Create spell' });
  await maker.getByLabel('Spell name').fill('Keepable spell');
  await maker.getByRole('button', { name: 'Save spell' }).click();

  const row = spellpad.locator('article').filter({ hasText: 'Keepable spell' });
  await row.getByRole('button', { name: 'Remove', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Remove saved spell?' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByText('Cancel', { exact: true }).click();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Remove', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Remove saved spell' }).click();
  await expect(row).toHaveCount(0);
  await expect(spellpad.getByRole('button', { name: 'Create spell' })).toBeFocused();
});

test('unnamed spells save, preview, select, edit, and place without forcing a name', async ({ page }) => {
  await page.goto('/dev');
  const { dialog: spellpad, target } = await openSpellpad(page);
  await spellpad.getByRole('button', { name: 'Create spell' }).click();
  const maker = page.getByRole('dialog', { name: 'Create spell' });
  await expect(maker.getByLabel('Spell name (optional)')).toHaveValue('');
  await maker.getByRole('button', { name: 'Save spell' }).click();

  const savedPad = page.getByRole('dialog', { name: 'Spellpad' });
  const row = savedPad.locator('article').filter({ hasText: 'Unnamed spell' });
  await expect(row).toBeVisible();
  await expect(row.getByRole('button', { name: 'Selected Unnamed spell' })).toHaveAttribute('aria-pressed', 'true');
  expect(await row.locator('.spell-template-thumbnail svg').count()).toBeGreaterThan(0);
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit spell' });
  await expect(editor.getByLabel('Spell name (optional)')).toHaveValue('');
  await editor.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('dialog', { name: 'Spellpad' }).getByRole('button', { name: 'Close' }).click();
  await target.canvas.click({ button: 'right', force: true, position: target.position });
  await expect(page.getByTestId('tool-status')).toContainText('Unnamed spell placed inactive');
});

test('Spellpad thumbnail renders only concrete Light levitation geometry', async ({ page }) => {
  await page.goto('/dev');
  const { dialog: spellpad } = await openSpellpad(page);
  await spellpad.getByRole('button', { name: 'Create spell' }).click();
  const maker = page.getByRole('dialog', { name: 'Create spell' });
  await maker.getByRole('radio', { name: 'Light' }).check();
  await maker.getByLabel('Sign type').selectOption('sign.levitation');
  await maker.getByRole('button', { name: 'Save spell' }).click();

  const row = page.getByRole('dialog', { name: 'Spellpad' })
    .locator('article')
    .filter({ hasText: 'Unnamed spell' });
  const thumbnail = row.locator('.spell-template-thumbnail');
  await expect(thumbnail.locator('svg[data-glyph-id="sigil.light"]')).toHaveCount(1);
  await expect(thumbnail.locator('svg[data-glyph-id="sign.levitation"]')).toHaveCount(4);
  await expect(thumbnail.locator('svg[data-glyph-id="sign.column"]')).toHaveCount(0);
  await expect(thumbnail.locator('svg[data-glyph-id="sign.dispersion"]')).toHaveCount(0);
  await expect(thumbnail.locator('[data-symbol-id*="generator"]')).toHaveCount(0);
  await expect(thumbnail.locator('svg [data-role="arrow_head"]')).toHaveCount(4);
  await expect(thumbnail.locator('svg [data-role="lower_cup"]')).toHaveCount(0);
});

test('count changes preserve signs and Backspace deletes only the selected sign', async ({ page }) => {
  await page.goto('/dev');
  const { dialog: spellpad } = await openSpellpad(page);
  await spellpad.getByRole('button', { name: 'Create spell' }).click();
  const maker = page.getByRole('dialog', { name: 'Create spell' });

  await maker.getByLabel('Sign 1 position').fill('11');
  await maker.getByLabel('Sign 1 radius').fill('61');
  await maker.getByLabel('Sign 1 facing').fill('15');
  await maker.getByLabel('Sign 1 size').fill('210');
  await maker.getByLabel('Sign 2 position').fill('77');
  await maker.getByLabel('Sign 2 radius').fill('72');
  await maker.getByLabel('Sign 3 position').fill('-133');

  await maker.getByLabel('Count').fill('5');
  await expect(maker.getByLabel('Sign 1 position')).toHaveValue('11');
  await expect(maker.getByLabel('Sign 1 radius')).toHaveValue('61');
  await expect(maker.getByLabel('Sign 1 facing')).toHaveValue('15');
  await expect(maker.getByLabel('Sign 1 size')).toHaveValue('210');
  await expect(maker.getByLabel('Sign 2 position')).toHaveValue('77');
  await expect(maker.getByLabel('Sign 2 radius')).toHaveValue('72');
  await expect(maker.getByLabel('Sign 5 position')).toHaveValue('288');

  await maker.getByLabel('Count').fill('3');
  await expect(maker.getByLabel('Sign 1 position')).toHaveValue('11');
  await expect(maker.getByLabel('Sign 2 position')).toHaveValue('77');
  await expect(maker.getByLabel('Sign 3 position')).toHaveValue('-133');

  const secondSign = maker.getByRole('button', { name: 'Select group 1, sign 2' });
  await secondSign.click();
  await expect(secondSign).toBeFocused();
  await page.keyboard.press('Backspace');
  await expect(maker.getByLabel('Count')).toHaveValue('2');
  await expect(maker.getByLabel('Sign 1 position')).toHaveValue('11');
  await expect(maker.getByLabel('Sign 2 position')).toHaveValue('-133');
  await expect(maker.getByRole('button', { name: 'Select group 1, sign 3' })).toHaveCount(0);
});

test('preview transform box moves, rotates, and resizes signs around a stable center', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/dev');
  const { dialog: spellpad } = await openSpellpad(page);
  await spellpad.getByRole('button', { name: 'Create spell' }).click();
  let maker = page.getByRole('dialog', { name: 'Create spell' });
  await maker.getByLabel('Spell name').fill('Turned signs');

  const preview = maker.getByTestId('spell-maker-preview');
  const sign = maker.locator('.spell-preview-sign').first();
  const signTarget = maker.getByRole('button', { name: 'Select group 1, sign 1' });
  await signTarget.click();
  await expect(sign).toHaveClass(/is-selected/);
  let rotateHandle = maker.getByRole('button', { name: 'Rotate group 1, sign 1' });
  let resizeHandle = maker.getByRole('button', { name: 'Resize group 1, sign 1 from top right' });
  await expect(rotateHandle).toBeVisible();
  await expect(resizeHandle).toBeVisible();
  await preview.click({ position: { x: 5, y: 5 } });
  await expect(rotateHandle).toBeHidden();
  await expect(resizeHandle).toBeHidden();
  await signTarget.click();
  rotateHandle = maker.getByRole('button', { name: 'Rotate group 1, sign 1' });
  resizeHandle = maker.getByRole('button', { name: 'Resize group 1, sign 1 from top right' });
  await expect(rotateHandle).toBeVisible();

  const centerOf = async () => ({
    x: Number(await sign.getAttribute('data-center-x')),
    y: Number(await sign.getAttribute('data-center-y')),
  });
  const expectCenterNear = async (expected, tolerance = 1.5) => {
    const actual = await centerOf();
    expect(Math.hypot(actual.x - expected.x, actual.y - expected.y)).toBeLessThanOrEqual(tolerance);
  };

  // Moving changes the rectangle center but keeps explicit size and facing.
  const previewBox = await preview.boundingBox();
  const targetBox = await signTarget.boundingBox();
  if (!previewBox || !targetBox) throw new Error('Preview sign has no bounding box');
  const facingBeforeMove = await sign.getAttribute('data-facing-deg');
  const sizeBeforeMove = await sign.getAttribute('data-sign-size');
  const gapBeforeMove = await sign.getAttribute('data-layout-gap');
  const localBoxBeforeMove = await sign.evaluate((element) => ({
    width: element.style.width,
    height: element.style.height,
  }));
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    previewBox.x + previewBox.width / 2 - 44,
    previewBox.y + previewBox.height / 2 + 44,
    { steps: 4 },
  );
  await expect(maker.getByLabel('Sign 1 position')).not.toHaveValue('0');
  await expect(maker.getByLabel('Sign 1 radius')).not.toHaveValue('');
  await page.mouse.up();
  await expect(sign).toHaveAttribute('data-facing-deg', facingBeforeMove ?? '0');
  await expect(sign).toHaveAttribute('data-sign-size', sizeBeforeMove ?? '200');
  await expect(sign).toHaveAttribute('data-layout-gap', gapBeforeMove ?? '0');
  expect(await sign.evaluate((element) => ({ width: element.style.width, height: element.style.height })))
    .toEqual(localBoxBeforeMove);
  await expect(maker.getByLabel('Sign 1 position')).not.toHaveValue('0');
  await expect(maker.getByLabel('Sign 1 radius')).not.toHaveValue('');

  // Rotation keeps the visible rectangle center and manual size fixed. The
  // polar anchor may change underneath to preserve that center.
  const centerBeforeTurn = await centerOf();
  rotateHandle = maker.getByRole('button', { name: 'Rotate group 1, sign 1' });
  await rotateHandle.focus();
  await page.keyboard.press('ArrowRight');
  await expect(maker.getByLabel('Sign 1 facing')).toHaveValue('-1');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(maker.getByLabel('Sign 1 facing')).toHaveValue('14');
  await expect(maker.getByLabel('Sign 1 size')).toHaveValue('200');
  await expectCenterNear(centerBeforeTurn);

  // Dragging the round handle also turns around the stable center.
  const signBox = await sign.boundingBox();
  const handleBox = await rotateHandle.boundingBox();
  if (!signBox || !handleBox) throw new Error('Rotation handle has no bounding box');
  const centerX = signBox.x + signBox.width / 2;
  const centerY = signBox.y + signBox.height / 2;
  const handleX = handleBox.x + handleBox.width / 2;
  const handleY = handleBox.y + handleBox.height / 2;
  const offsetX = handleX - centerX;
  const offsetY = handleY - centerY;
  await page.mouse.move(handleX, handleY);
  await page.mouse.down();
  await page.mouse.move(centerX - offsetY, centerY + offsetX, { steps: 5 });
  await page.mouse.up();
  await expect(maker.getByLabel('Sign 1 facing')).not.toHaveValue('14');
  await expect(maker.getByLabel('Sign 1 size')).toHaveValue('200');
  await expectCenterNear(centerBeforeTurn);

  // Corner handles change only this sign's size and expand around the same
  // center, both from the keyboard and by pointer drag.
  resizeHandle = maker.getByRole('button', { name: 'Resize group 1, sign 1 from top right' });
  await resizeHandle.focus();
  await page.keyboard.press('Shift+ArrowUp');
  await expect(maker.getByLabel('Sign 1 size')).toHaveValue('210');
  await expect(maker.getByLabel('Sign 2 size')).toHaveValue('200');
  await expectCenterNear(centerBeforeTurn);

  const resizeBox = await resizeHandle.boundingBox();
  const resizedSignBox = await sign.boundingBox();
  if (!resizeBox || !resizedSignBox) throw new Error('Resize handle has no bounding box');
  const resizeCenterX = resizedSignBox.x + resizedSignBox.width / 2;
  const resizeCenterY = resizedSignBox.y + resizedSignBox.height / 2;
  const resizeX = resizeBox.x + resizeBox.width / 2;
  const resizeY = resizeBox.y + resizeBox.height / 2;
  await page.mouse.move(resizeX, resizeY);
  await page.mouse.down();
  await page.mouse.move(
    resizeCenterX + (resizeX - resizeCenterX) * 1.35,
    resizeCenterY + (resizeY - resizeCenterY) * 1.35,
    { steps: 4 },
  );
  expect(Number(await maker.getByLabel('Sign 1 size').inputValue())).toBeGreaterThan(210);
  await page.mouse.up();
  expect(Number(await maker.getByLabel('Sign 1 size').inputValue())).toBeGreaterThan(210);
  await expect(maker.getByLabel('Sign 2 size')).toHaveValue('200');
  await expectCenterNear(centerBeforeTurn);

  // The corner pressed at the start owns the entire gesture. Crossing through
  // the sign toward the opposite corner must keep shrinking to the minimum;
  // it must not reinterpret the pointer as dragging the opposite corner out.
  await maker.getByLabel('Sign 1 size').fill('200');
  const centerBeforeLatchedResize = await centerOf();
  resizeHandle = maker.getByRole('button', { name: 'Resize group 1, sign 1 from top right' });
  const latchedResizeBox = await resizeHandle.boundingBox();
  const latchedSignBox = await sign.boundingBox();
  if (!latchedResizeBox || !latchedSignBox) throw new Error('Latched resize handle has no bounding box');
  const latchedCenter = {
    x: latchedSignBox.x + latchedSignBox.width / 2,
    y: latchedSignBox.y + latchedSignBox.height / 2,
  };
  const latchedCorner = {
    x: latchedResizeBox.x + latchedResizeBox.width / 2,
    y: latchedResizeBox.y + latchedResizeBox.height / 2,
  };
  await page.mouse.move(latchedCorner.x, latchedCorner.y);
  await page.mouse.down();
  await page.mouse.move(
    latchedCenter.x - (latchedCorner.x - latchedCenter.x) * 1.4,
    latchedCenter.y - (latchedCorner.y - latchedCenter.y) * 1.4,
    { steps: 6 },
  );
  await expect(maker.getByLabel('Sign 1 size')).toHaveValue('100');
  await page.mouse.up();
  await expect(maker.getByLabel('Sign 1 size')).toHaveValue('100');
  await expectCenterNear(centerBeforeLatchedResize);

  const persistedFacing = await maker.getByLabel('Sign 1 facing').inputValue();
  const persistedPosition = await maker.getByLabel('Sign 1 position').inputValue();
  const persistedRadius = await maker.getByLabel('Sign 1 radius').inputValue();
  const persistedSize = await maker.getByLabel('Sign 1 size').inputValue();
  await maker.getByRole('button', { name: 'Save spell' }).click();
  const savedPad = page.getByRole('dialog', { name: 'Spellpad' });
  const savedRow = savedPad.locator('article').filter({ hasText: 'Turned signs' });
  await savedRow.getByRole('button', { name: 'Edit' }).click();
  maker = page.getByRole('dialog', { name: 'Edit spell' });
  await expect(maker.getByLabel('Sign 1 facing')).toHaveValue(persistedFacing);
  await expect(maker.getByLabel('Sign 1 position')).toHaveValue(persistedPosition);
  await expect(maker.getByLabel('Sign 1 radius')).toHaveValue(persistedRadius);
  await expect(maker.getByLabel('Sign 1 size')).toHaveValue(persistedSize);
});

test('existing sample still compiles, saves, and places through the unchanged flow', async ({ page }) => {
  await page.goto('/dev');
  await page.getByLabel('Sample spell').selectOption('watershot-centered');
  await page.getByRole('button', { name: 'Compile', exact: true }).click();
  await expect(page.getByTestId('compile-status')).toHaveText('Compile OK');
  await page.getByRole('button', { name: 'Save to Spellpad' }).click();
  const target = await sceneTarget(page);
  await target.canvas.click({ button: 'right', force: true, position: target.position });
  await expect(page.getByTestId('tool-status')).toContainText('Centered Watershot columns placed inactive');
});
