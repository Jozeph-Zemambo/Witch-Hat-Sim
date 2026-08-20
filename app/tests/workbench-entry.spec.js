import { expect, test } from '@playwright/test';
import { join } from 'node:path';

function screenshotPath(name) {
  return join(
    process.env.FABLING_RUNS ?? '/tmp',
    '05-connect-atelier-workbench',
    'screenshots',
    name,
  );
}

async function enterWorld(page) {
  await page.goto('/');
  await page.getByTestId('title-play').click();
  await expect(page.getByTestId('scene-canvas-frame')).toHaveCount(1);
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
  await page.getByTestId('acknowledge-enter').click();
  await expect(page.getByTestId('tutorial-skip')).toBeVisible();
  await page.getByTestId('tutorial-skip').click();
  await expect(page.locator('[data-entry-phase="world"]')).toBeVisible();
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__WHA_SCENE_READY__ === true)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__WHA_MAIN_WORLD_PHYSICS__?.ready === true)).toBe(true);
  await expect.poll(() => page.evaluate(() => (
    typeof window.__WHA_SET_PLAYER_STATE__ === 'function' && Boolean(window.__WHA_PLAYER__?.position)
  ))).toBe(true);
}

async function moveToWorkshopDesk(page) {
  await page.evaluate(() => window.__WHA_SET_PLAYER_STATE__({
    position: { x: -5.55, y: 0, z: -3.35 },
    facing: Math.atan2(-4.1904 - -5.55, -4.3733 - -3.35),
  }));
  await expect(page.getByTestId('workbench-prompt')).toBeVisible();
  await page.screenshot({ path: screenshotPath('atelier-workbench-prompt.png') });
}

test('entrance-right workshop desk is gated by proximity and aim, then enters the existing workbench', async ({ page }) => {
  await enterWorld(page);
  await expect(page.getByTestId('workbench-prompt')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__WHA_WORKBENCH_INTERACTION__?.closeEnough)).toBe(false);

  await moveToWorkshopDesk(page);
  await expect.poll(() => page.evaluate(() => window.__WHA_WORKBENCH_INTERACTION__)).toMatchObject({
    surfaceName: 'atelier-workshop-desk',
    closeEnough: true,
    aiming: true,
    eligible: true,
    locked: false,
  });

  await page.getByTestId('enter-workshop').click();
  await expect(page).toHaveURL(/\/mechanics\?from=atelier$/);
  await expect(page.getByRole('heading', { name: 'Mechanics Workbench' })).toBeVisible();
  await expect(page.getByTestId('return-to-atelier')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.rapierReady)).toBe(true);
  await page.screenshot({ path: screenshotPath('mechanics-workbench-entered.png') });
});

test('enter and return preserve player position, facing, inventory selection, and session acknowledgement', async ({ page }) => {
  test.setTimeout(90_000);
  await enterWorld(page);
  await page.keyboard.press('5');
  await expect(page.getByTestId('inventory-slot-4')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('camera-mode-toggle').click();
  await moveToWorkshopDesk(page);
  const before = await page.evaluate(() => ({
    position: window.__WHA_PLAYER__.position,
    facing: window.__WHA_PLAYER__.facing,
  }));

  await page.getByTestId('enter-workshop').click();
  await page.getByTestId('return-to-atelier').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
  await expect(page.getByTestId('acknowledgement-backdrop')).toHaveCount(0);
  await expect(page.getByTestId('inventory-slot-4')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate((savedPosition) => {
    const current = window.__WHA_PLAYER__?.position;
    if (!current) return Number.POSITIVE_INFINITY;
    return Math.hypot(
      current.x - savedPosition.x,
      current.y - savedPosition.y,
      current.z - savedPosition.z,
    );
  }, before.position)).toBeLessThan(0.02);
  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__?.facing)).toBe(before.facing);
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
  await expect(page.getByTestId('camera-mode-toggle')).toHaveAttribute('data-camera-mode', 'tp');
  await page.screenshot({ path: screenshotPath('atelier-workbench-returned.png') });
});

test('direct mechanics route stays functional and browser back/forward follows the bridge', async ({ page }) => {
  await page.goto('/mechanics');
  await expect(page.getByRole('heading', { name: 'Mechanics Workbench' })).toBeVisible();
  await expect(page.getByTestId('return-to-atelier')).toBeVisible();
  await page.getByTestId('return-to-atelier').click();
  await expect(page).toHaveURL(/\/$/);

  await enterWorld(page);
  await moveToWorkshopDesk(page);
  await page.getByTestId('enter-workshop').click();
  await expect(page).toHaveURL(/\/mechanics\?from=atelier$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/mechanics\?from=atelier$/);
  await expect(page.getByRole('heading', { name: 'Mechanics Workbench' })).toBeVisible();
});
