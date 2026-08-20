import { expect, test } from '@playwright/test';

test('main world boots its isolated Rapier runtime with loose bodies dynamic and world structures fixed', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('title-play')).toBeVisible();
  await page.getByTestId('title-play').click();
  await expect(page.getByTestId('scene-canvas-frame')).toBeVisible();
  await expect.poll(
    () => page.evaluate(() => window.__WHA_MAIN_WORLD_PHYSICS__?.ready === true),
    { timeout: 20_000 },
  ).toBe(true);
  const snapshot = await page.evaluate(() => window.__WHA_MAIN_WORLD_PHYSICS__);
  expect(snapshot.fixedDt).toBeCloseTo(1 / 60, 8);
  expect(snapshot.maxSubsteps).toBe(4);
  expect(snapshot.aggregateForceCap).toBe(180);
  expect(snapshot.bodies['practice-field-terrain'].bodyMode).toBe('fixed');
  expect(snapshot.bodies['atelier-house'].bodyMode).toBe('fixed');
  expect(snapshot.bodies['field-stone-0'].bodyMode).toBe('dynamic');
  expect(snapshot.bodies['prop:field-practice-crate-0'].bodyMode).toBe('dynamic');
  expect(snapshot.bodies['prop:field-practice-crate-1'].bodyMode).toBe('dynamic');
  expect(snapshot.bodies['prop:prop:practice-cube'].bodyMode).toBe('dynamic');
  expect(snapshot.bodies['prop:prop:tree-apple'].bodyMode).toBe('dynamic');
  expect(snapshot.bodies['prop:prop:small-practice-cube'].bodyMode).toBe('dynamic');
  expect(snapshot.bodies['prop:prop:practice-tree'].bodyMode).toBe('fixed');
  expect(snapshot.rejectedFields).toEqual([]);
  expect(errors).toEqual([]);
});

test('main world promotes Earth column visuals and whole-output crumble lifecycle', async ({ page }) => {
  await page.goto('/dev');
  await page.getByLabel('Sample spell').selectOption('earth-pillar');
  await page.getByRole('button', { name: 'Compile', exact: true }).click();
  await page.getByRole('button', { name: 'Save to Spellpad' }).click();
  const canvas = page.locator('canvas.scene-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Scene canvas has no bounding box');
  const position = { x: box.width * 0.34, y: box.height * 0.54 };
  await canvas.click({ button: 'right', force: true, position });
  await page.getByRole('button', { name: 'Spell Manager — inventory slot 2' }).click({ force: true });
  await canvas.click({ force: true, position });
  const manager = page.getByRole('dialog', { name: 'Spell Manager' });
  await manager.getByRole('button', { name: 'Toggled' }).click();
  await manager.getByRole('button', { name: 'Activate' }).click();
  await expect(page.getByTestId('material-column-count')).toHaveText('1');
  await expect.poll(
    () => page.evaluate(() => Object.values(window.__WHA_MAIN_ELEMENT_COLUMNS__ ?? {})[0] ?? null),
    { timeout: 15_000 },
  ).toMatchObject({
    element: 'earth',
    promotedToMain: true,
    surfaceMotion: 'rigid_static',
    gravityOnDeactivate: true,
  });
  const columnLengths = await page.evaluate(() => ({
    visual: Object.values(window.__WHA_MAIN_ELEMENT_COLUMNS__ ?? {})
      .find((column) => column.element === 'earth')?.columnLength,
    physical: window.__WHA_MAIN_WORLD_PHYSICS__?.fields
      ?.find((field) => field.materialKind === 'earth')?.length,
  }));
  expect(columnLengths.visual).toBeCloseTo(columnLengths.physical, 3);
  await manager.getByRole('button', { name: 'Deactivate' }).click();
  await expect(page.getByTestId('material-column-count')).toHaveText('0');
  await expect.poll(
    () => page.evaluate(() => Object.values(window.__WHA_MAIN_ELEMENT_COLUMNS__ ?? {})[0]?.phase ?? null),
    { timeout: 8_000 },
  ).toMatch(/ending|idle/);
});

test('fixed/fixed Earth keeps its render output through the blocked crumble fallback', async ({ page }) => {
  await page.goto('/dev');
  await page.getByLabel('Sample spell').selectOption('earth-pillar');
  await page.getByRole('button', { name: 'Compile', exact: true }).click();
  await page.getByRole('button', { name: 'Save to Spellpad' }).click();
  // Place deterministically on fixed terrain directly beneath the fixed tree.
  // The visible, compiled pillar now owns the same finite length as physics,
  // so this setup guarantees a real obstruction without relying on the former
  // invisible overlong force volume.
  await page.evaluate(async () => {
    const { useSpellStore } = await import('/src/store.js');
    useSpellStore.getState().placeSelectedSpell({
      point: { x: 2.6, y: 0, z: 1.5 },
      normal: { x: 0, y: 1, z: 0 },
      tangent: { x: 1, y: 0, z: 0 },
      surfaceId: 'practice-field-terrain',
      surfaceKind: 'world',
      mountBodyId: 'practice-field-terrain',
      surfaceLabel: 'Practice field',
    });
  });
  await page.getByRole('button', { name: 'Spell Manager — inventory slot 2' }).click({ force: true });
  const manager = page.getByRole('dialog', { name: 'Spell Manager' });
  await manager.getByRole('button', { name: 'Toggled' }).click();
  await manager.getByRole('button', { name: 'Activate' }).click();
  await manager.getByRole('button', { name: 'Close' }).click();

  await expect.poll(
    () => page.evaluate(() => window.__WHA_MAIN_WORLD_PHYSICS__?.blockedSignals?.[0] ?? null),
    { timeout: 15_000 },
  ).toMatchObject({
    elapsedMs: 17,
    reason: 'fixed_mount_fixed_obstruction',
  });
  await expect.poll(
    () => page.evaluate(() => window.__WHA_PLACED_SPELLS__?.[0]?.active ?? null),
    { timeout: 8_000 },
  ).toBe(false);
  await expect.poll(
    () => page.evaluate(() => {
      const earth = Object.values(window.__WHA_MAIN_ELEMENT_COLUMNS__ ?? {})
        .find((column) => column.element === 'earth');
      return earth ? {
        phase: earth.phase,
        fallback: earth.crumbleWholeOutputFallback,
        endFront: earth.crumbleEndFront,
        visibleChunks: earth.crumbleVisibleChunkCount,
      } : null;
    }),
    { timeout: 8_000 },
  ).toMatchObject({
    phase: 'ending',
    fallback: true,
    endFront: 1,
    visibleChunks: 26,
  });
});
