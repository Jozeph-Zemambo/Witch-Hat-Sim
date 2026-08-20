import { expect, test } from '@playwright/test';
import { join } from 'node:path';

function screenshotPath(name) {
  return join(
    process.env.FABLING_RUNS ?? '/tmp',
    '03-build-player-game-shell',
    'screenshots',
    name,
  );
}

async function freshTitle(page) {
  await page.goto('/');
  await page.evaluate(() => window.sessionStorage.clear());
  await page.reload();
  await expect(page.getByTestId('title-play')).toBeVisible();
}

async function enterAcceptedWorld(page) {
  await freshTitle(page);
  await page.getByTestId('title-play').click();
  await expect(page.getByTestId('acknowledgement-backdrop')).toBeVisible();
  await expect(page.getByTestId('scene-canvas-frame')).toHaveCount(1);
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
  await page.getByTestId('acknowledge-enter').click();
  await expect(page.getByTestId('acknowledgement-backdrop')).toHaveCount(0);
  await expect(page.getByTestId('tutorial-start')).toBeVisible();
  await page.getByTestId('tutorial-skip').click();
  await expect(page.locator('[data-entry-phase="world"]')).toBeVisible();
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__WHA_SCENE_READY__ === true)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__WHA_MAIN_WORLD_PHYSICS__?.ready === true)).toBe(true);
  await expect.poll(() => page.evaluate(() => (
    typeof window.__WHA_SET_PLAYER_STATE__ === 'function' && Boolean(window.__WHA_PLAYER__?.position)
  ))).toBe(true);
}

test('root is a restrained title screen with one Play action', async ({ page }) => {
  await freshTitle(page);

  await expect(page.getByRole('heading', { name: 'The Wandering Atelier' })).toBeVisible();
  await expect(page.getByRole('button')).toHaveCount(3);
  await expect(page.getByTestId('music-toggle')).toBeVisible();
  await expect(page.getByTestId('settings-toggle')).toBeVisible();
  await expect(page.getByTestId('scene-canvas')).toHaveCount(0);
  await page.screenshot({ path: screenshotPath('title-laptop.png') });
});

test('Play enters the Atelier and blocks all world input until acknowledgement', async ({ page }) => {
  await freshTitle(page);
  await page.getByTestId('title-play').click();

  const acknowledgement = page.getByRole('dialog', { name: 'Before entering' });
  await expect(acknowledgement).toBeVisible();
  await expect(acknowledgement).toContainText('Unofficial, unaffiliated fan sandbox');
  await expect(acknowledgement).toContainText('Playful and experimental');
  await expect(acknowledgement).toContainText('not saved or exported may disappear');
  await expect(page.getByTestId('acknowledge-enter')).toBeFocused();
  await expect(page.locator('[data-entry-phase="ack"]')).toBeVisible();
  await expect(page.getByTestId('scene-canvas-frame')).toHaveCount(1);
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
  await expect(page.locator('[data-testid^="inventory-slot-"]').first()).toBeDisabled();
  await expect(page.getByTestId('camera-mode-toggle')).toBeDisabled();

  await page.keyboard.press('Escape');
  await page.getByTestId('acknowledgement-backdrop').click({ position: { x: 8, y: 8 } });
  await expect(acknowledgement).toBeVisible();
  await expect(page.locator('[data-entry-phase="ack"]')).toBeVisible();
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
  await page.screenshot({ path: screenshotPath('acknowledgement-laptop.png') });
});

test('acknowledgement enables the full world shell and player input', async ({ page }) => {
  await enterAcceptedWorld(page);

  await expect(page.locator('[data-testid^="inventory-slot-"]').first()).toBeEnabled();
  await expect(page.getByTestId('camera-mode-toggle')).toBeEnabled();
  await expect(page.locator('[data-player-input-enabled="true"]')).toBeVisible();

  const before = await page.evaluate(() => window.__WHA_PLAYER__.position);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true })));
  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__.position.x)).toBeGreaterThan(before.x);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', bubbles: true })));

  await page.keyboard.press('5');
  await expect(page.getByTestId('inventory-slot-4')).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: screenshotPath('accepted-world-laptop.png') });
});

test('all ten inventory slots remain reachable at the minimum supported viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await enterAcceptedWorld(page);

  const viewport = page.viewportSize();
  const slots = page.locator('[data-testid^="inventory-slot-"]');
  await expect(slots).toHaveCount(10);
  for (let index = 0; index < 10; index += 1) {
    const box = await slots.nth(index).boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  }
  expect((await slots.nth(5).boundingBox()).y).toBeGreaterThan((await slots.nth(0).boundingBox()).y);
});

test('front yard uses sparse grass without the old dirt clearing', async ({ page }) => {
  await enterAcceptedWorld(page);

  await expect.poll(() => page.evaluate(() => window.__WHA_YARD_GRASS__ ?? null)).toMatchObject({
    hasDirtClearing: false,
    rustleMode: 'player-proximity',
    geometryStyle: 'bent-solid-faceted-tufts',
    bladeTopology: 'closed-diamond-prism',
    baseLayout: 'scattered-roots',
    bladesPerTuft: 3,
    withinTuftHeightSpread: 0.42,
    trianglesPerTuft: 42,
    clusterSizeRange: [4, 10],
    placedSpellZoneCount: 0,
  });
  const yard = await page.evaluate(() => window.__WHA_YARD_GRASS__);
  expect(yard.totalCount).toBeGreaterThan(500);
  expect(yard.totalCount).toBeLessThan(1100);
  expect(yard.visibleCount).toBeGreaterThan(350);
  expect(yard.hiddenCount).toBeGreaterThan(60);
  await expect.poll(() => page.evaluate(() => {
    const names = window.__WHA_SCENE_FEATURES__ ?? [];
    return {
      grass: names.includes('yard-grass-cover'),
      details: names.includes('yard-details'),
      steppingStones: names.includes('yard-stepping-stones'),
      oldClearing: names.includes('practice-dirt-clearing'),
      oldPath: names.includes('practice-dirt-path'),
    };
  })).toEqual({
    grass: true,
    details: true,
    steppingStones: true,
    oldClearing: false,
    oldPath: false,
  });
});

test('ground spell placement clears its full grass footprint', async ({ page }) => {
  test.setTimeout(120_000);
  await enterAcceptedWorld(page);
  await page.getByRole('button', { name: 'Spellpad — inventory slot 1' }).click();
  const spellpad = page.getByRole('dialog', { name: 'Spellpad' });
  await spellpad.getByRole('button', { name: 'Create spell' }).click();
  const maker = page.getByRole('dialog', { name: 'Create spell' });
  await maker.getByLabel('Spell name').fill('Grass clearance check');
  await maker.getByRole('radio', { name: 'Earth' }).check({ force: true });
  await maker.getByLabel('Count').fill('1');
  await maker.getByLabel('Size').fill('100');
  await maker.getByRole('button', { name: 'Save spell' }).click();
  await page.getByRole('dialog', { name: 'Spellpad' }).getByRole('button', { name: 'Close' }).click();
  await page.getByTestId('camera-mode-toggle').click();
  await expect.poll(() => page.evaluate(() => window.__WHA_YARD_GRASS__ ?? null)).not.toBeNull();
  const initial = await page.evaluate(() => window.__WHA_YARD_GRASS__);
  const canvas = page.locator('canvas.scene-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Scene canvas has no bounding box');
  await page.keyboard.press('2');
  let terrainPoint = null;
  const horizontalRatios = [0.08, 0.22, 0.5, 0.78, 0.92];
  const verticalRatios = [0.56, 0.68, 0.78, 0.86];
  for (const yRatio of verticalRatios) {
    for (const xRatio of horizontalRatios) {
      const point = { x: box.width * xRatio, y: box.height * yRatio };
      await canvas.click({ button: 'right', force: true, position: point });
      const surfaceId = await page.evaluate(() => window.__WHA_CONTEXT_PICK_DEBUG__?.surfaceId ?? null);
      if (surfaceId === 'practice-field-terrain') {
        terrainPoint = point;
        break;
      }
    }
    if (terrainPoint) break;
  }
  expect(terrainPoint).not.toBeNull();
  await page.keyboard.press('1');
  await canvas.click({
    button: 'right',
    force: true,
    position: terrainPoint,
  });

  await expect.poll(() => page.evaluate(() => window.__WHA_YARD_GRASS__?.placedSpellZoneCount ?? 0)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__WHA_YARD_GRASS__?.placedSpellClearRadii ?? []))
    .toEqual([0.57]);
  await expect.poll(() => page.evaluate(() => window.__WHA_YARD_GRASS__?.placedSpellHiddenTuftCount ?? 0))
    .toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__WHA_YARD_GRASS__?.visibleCount ?? Infinity))
    .toBeLessThan(initial.visibleCount);
});

test('tutorial starts outside in first person and waits for the writing-desk Spellpad', async ({ page }) => {
  await freshTitle(page);
  await page.getByTestId('title-play').click();
  await page.getByTestId('acknowledge-enter').click();
  await page.getByTestId('tutorial-start').click();

  await expect(page.locator('[data-entry-phase="tutorial"]')).toHaveAttribute('data-player-input-enabled', 'true');
  await expect(page.getByTestId('camera-mode-toggle')).toHaveAttribute('data-camera-mode', 'fp');
  await expect(page.getByTestId('tutorial-hud')).toContainText('WASD or arrow keys');
  await expect(page.getByTestId('spellpad-objective')).toContainText('Inside, on the writing desk');
  await expect(page.getByTestId('inventory-slot-0')).toBeDisabled();
  await expect.poll(() => page.evaluate(() => {
    const player = window.__WHA_PLAYER__;
    const spawn = window.__WHA_ATELIER_PLAYTHROUGH__?.spawn;
    return player && spawn && Math.hypot(
      player.position.x - spawn.world.x,
      player.position.z - spawn.world.z,
    );
  })).toBeLessThan(0.03);
  await page.screenshot({ path: screenshotPath('tutorial-spawn-first-person.png') });

  // The workshop is visible as an option but stays disabled before pickup.
  await page.evaluate(() => window.__WHA_SET_PLAYER_STATE__({
    position: { x: -5.55, y: 0, z: -3.35 },
    facing: Math.atan2(-4.1904 - -5.55, -4.3733 - -3.35),
  }));
  await expect(page.getByTestId('workbench-prompt')).toBeVisible();
  await expect(page.getByTestId('enter-workshop')).toBeDisabled();

  // The tools guide advances only when the physical Spellpad is collected.
  await page.evaluate(() => window.__WHA_SET_PLAYER_STATE__({
    position: { x: -5.4, y: 0, z: -3.4 },
    facing: Math.atan2(-6.558 - -5.4, -4.465 - -3.4),
  }));
  await expect(page.getByTestId('spellpad-prompt')).toBeVisible();
  await page.screenshot({ path: screenshotPath('writing-desk-spellpad-prompt.png') });
  await page.keyboard.press('e');
  await expect(page.getByTestId('inventory-slot-0')).toBeEnabled();
  await expect(page.getByTestId('spellpad-objective')).toHaveCount(0);
  await expect(page.getByTestId('tutorial-hud')).toContainText('Slot 1: Spellpad');
  await expect(page.getByTestId('tool-status')).toContainText('Spellpad added to inventory');
});

test('skipping grants the Spellpad without changing the outside spawn', async ({ page }) => {
  await freshTitle(page);
  await page.getByTestId('title-play').click();
  await page.getByTestId('acknowledge-enter').click();
  await page.getByTestId('tutorial-skip').click();

  await expect(page.locator('[data-entry-phase="world"]')).toBeVisible();
  await expect(page.getByTestId('inventory-slot-0')).toBeEnabled();
  await expect(page.getByTestId('spellpad-objective')).toHaveCount(0);
  await expect(page.getByTestId('camera-mode-toggle')).toHaveAttribute('data-camera-mode', 'fp');
  await expect.poll(() => page.evaluate(() => {
    const player = window.__WHA_PLAYER__;
    const spawn = window.__WHA_ATELIER_PLAYTHROUGH__?.spawn;
    return player && spawn && Math.hypot(
      player.position.x - spawn.world.x,
      player.position.z - spawn.world.z,
    );
  })).toBeLessThan(0.03);
});

test('acknowledgement is session-scoped and absent after returning from mechanics', async ({ page }) => {
  await enterAcceptedWorld(page);
  await page.goto('/mechanics');
  await expect(page.getByRole('heading', { name: /Mechanics/i }).first()).toBeVisible();
  await page.goto('/');
  await expect(page.getByTestId('acknowledgement-backdrop')).toHaveCount(0);
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
});
