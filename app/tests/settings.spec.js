import { expect, test } from '@playwright/test';

async function freshTitle(page) {
  await page.goto('/');
  await page.evaluate(() => {
    window.sessionStorage.clear();
    window.localStorage.removeItem('wha-input-settings-v1');
    window.localStorage.removeItem('wha-music-volume');
  });
  await page.reload();
  await expect(page.getByTestId('title-play')).toBeVisible();
}

test('settings button opens a persistent settings modal and right-click stays inert', async ({ page }) => {
  test.setTimeout(90_000);
  await freshTitle(page);

  const music = page.getByTestId('music-toggle');
  const settingsButton = page.getByTestId('settings-toggle');
  const musicBox = await music.boundingBox();
  const settingsBox = await settingsButton.boundingBox();
  expect(musicBox).not.toBeNull();
  expect(settingsBox).not.toBeNull();
  expect(Math.abs((musicBox.y + musicBox.height / 2) - (settingsBox.y + settingsBox.height / 2))).toBeLessThan(2);
  expect(settingsBox.x).toBeGreaterThan(musicBox.x + musicBox.width);

  await settingsButton.click({ button: 'right' });
  await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);

  await settingsButton.click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('Volume')).toBeFocused();
  await expect(page.getByLabel('Volume')).toHaveValue('35');

  await page.getByLabel('Volume').fill('58');
  await page.getByLabel('Camera sensitivity').fill('1.5');
  await page.getByLabel('Cursor sensitivity').fill('0.8');
  await expect(dialog.getByText('58%')).toBeVisible();
  await expect(dialog.getByText('1.50×')).toBeVisible();
  await expect(dialog.getByText('0.80×')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__WHA_MUSIC__.volume)).toBeCloseTo(0.58, 5);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await page.getByTestId('settings-toggle').click();
  await expect(page.getByLabel('Volume')).toHaveValue('58');
  await expect(page.getByLabel('Camera sensitivity')).toHaveValue('1.5');
  await expect(page.getByLabel('Cursor sensitivity')).toHaveValue('0.8');

  await page.keyboard.press('Escape');
  await page.getByTestId('title-play').click();
  await page.getByTestId('acknowledge-enter').click();
  const tutorialSkip = page.getByTestId('tutorial-skip');
  if (await tutorialSkip.count()) await tutorialSkip.click();
  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__?.sensitivity)).toBe(1.5);

  await page.getByTestId('settings-toggle').click();
  await expect.poll(() => page.evaluate(() => window.__WHA_VIRTUAL_CURSOR__?.sensitivity)).toBeCloseTo(3.328, 3);
});

test('input sensitivity controls expose and preserve the full 0.001–4× range', async ({ page }) => {
  test.setTimeout(90_000);
  await freshTitle(page);

  await page.getByTestId('settings-toggle').click();
  const camera = page.getByLabel('Camera sensitivity');
  const cursor = page.getByLabel('Cursor sensitivity');

  await expect(camera).toHaveAttribute('min', '0.001');
  await expect(camera).toHaveAttribute('max', '4');
  await expect(camera).toHaveAttribute('step', '0.001');
  await expect(cursor).toHaveAttribute('min', '0.001');
  await expect(cursor).toHaveAttribute('max', '4');
  await expect(cursor).toHaveAttribute('step', '0.001');
  await expect(page.getByLabel('Volume')).toHaveAttribute('min', '0');
  await expect(page.getByLabel('Volume')).toHaveAttribute('max', '100');

  await camera.fill('0.001');
  await cursor.fill('4');
  await expect(page.getByText('0.001×')).toBeVisible();
  await expect(page.getByText('4.00×')).toBeVisible();

  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByTestId('settings-toggle').click();
  await expect(page.getByLabel('Camera sensitivity')).toHaveValue('0.001');
  await expect(page.getByLabel('Cursor sensitivity')).toHaveValue('4');

  await page.keyboard.press('Escape');
  await page.getByTestId('title-play').click();
  await page.getByTestId('acknowledge-enter').click();
  const tutorialSkip = page.getByTestId('tutorial-skip');
  if (await tutorialSkip.count()) await tutorialSkip.click();
  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__?.sensitivity)).toBe(0.001);

  await page.getByTestId('settings-toggle').click();
  await expect.poll(() => page.evaluate(() => window.__WHA_VIRTUAL_CURSOR__?.sensitivity)).toBeCloseTo(16.64, 5);
});
