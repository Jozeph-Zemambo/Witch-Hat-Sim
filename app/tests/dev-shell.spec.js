import { expect, test } from '@playwright/test';

test('dev route preserves the raw compiler, import, source, and debug shell', async ({ page }) => {
  await page.goto('/dev');

  await expect(page).toHaveURL(/\/dev$/);
  await expect(page.getByRole('heading', { name: 'WHA Spell Simulator' })).toBeVisible();
  await expect(page.getByLabel('Sample spell')).toBeVisible();
  await expect(page.getByLabel('Spell JSON')).toBeVisible();
  await expect(page.getByLabel('Local JSON file')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Compile', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show debug' })).toBeVisible();
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
});

test('root does not expose the permanent developer panel', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.sessionStorage.clear());
  await page.reload();

  await expect(page.getByTestId('title-play')).toBeVisible();
  await expect(page.getByLabel('Spell JSON')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Compile', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show debug' })).toHaveCount(0);
});
