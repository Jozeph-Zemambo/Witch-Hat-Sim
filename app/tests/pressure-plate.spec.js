import { expect, test } from '@playwright/test';
import { join } from 'node:path';

const SCREENSHOT_DIR = join(
  process.env.FABLING_RUNS ?? '/tmp',
  '08-build-pressure-plate-machine',
  'screenshots',
);

async function loadPressurePlate(page) {
  await page.goto('/mechanics');
  await expect.poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.rapierReady)).toBe(true);
  await page.getByRole('button', { name: 'Examples', exact: true }).click();
  await page.getByTestId('mechanics-starter-pressure-plate').click();
  await expect(page.getByRole('heading', { name: 'Mechanics Workbench' })).toBeVisible();
  await expect(page.getByText('Light pressure plate', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.documentName)).toBe('Light pressure plate');
}

function pressureState(page) {
  return page.evaluate(() => {
    const debug = window.__WHA_MECHANICS_DEBUG__;
    return {
      debug,
      plate: debug?.assemblies?.['assembly:pressure-plate'],
      load: debug?.assemblies?.['assembly:pressure-load'],
      slider: debug?.constraints?.['constraint:pressure-slider'],
      gate: debug?.gates?.['gate:pressure-light'],
      active: debug?.activeSpellDevices?.includes('spell-device:pressure-light'),
    };
  });
}

test('pressure plate starts raised and completes Light only under real load', async ({ page }) => {
  await loadPressurePlate(page);

  const unloaded = await pressureState(page);
  expect(unloaded.plate.position.y).toBeGreaterThan(1.40);
  expect(unloaded.slider.normalizedPosition).toBeGreaterThan(0.95);
  expect(unloaded.gate.closed).toBe(false);
  expect(unloaded.active).toBe(false);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/pressure-plate-unloaded-low-angle.png`, fullPage: false });

  await page.getByTestId('mechanics-mode-test').click();
  await expect.poll(async () => (await pressureState(page)).gate?.closed).toBe(true);
  await expect.poll(async () => (await pressureState(page)).active).toBe(true);
  const loaded = await pressureState(page);
  expect(loaded.plate.position.y).toBeLessThan(unloaded.plate.position.y - 0.12);
  expect(loaded.slider.normalizedPosition).toBeLessThan(0.45);
  await expect(page.getByText('closed · active', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/pressure-plate-loaded-low-angle.png`, fullPage: false });

  const load = page.getByTestId('mechanics-assembly-assembly:pressure-load');
  await load.click();
  const pushRight = page.getByRole('button', { name: 'Push right', exact: true });
  for (let index = 0; index < 5; index += 1) await pushRight.click();
  await expect.poll(async () => (await pressureState(page)).gate?.closed).toBe(false);
  await expect.poll(async () => (await pressureState(page)).active).toBe(false);
  await expect.poll(async () => (await pressureState(page)).slider?.normalizedPosition).toBeGreaterThan(0.95);
  const unloadedAgain = await pressureState(page);
  expect(unloadedAgain.plate.position.y).toBeGreaterThan(loaded.plate.position.y + 0.12);
  expect(unloadedAgain.slider.normalizedPosition).toBeGreaterThan(0.95);

  await page.getByTestId('mechanics-mode-inspect').click();
  await page.getByTestId('mechanics-relationship-constraint:pressure-slider').click();
  await expect(page.getByRole('heading', { name: 'Inspector' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Vertical plate travel', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Reset test', exact: true }).click();
  await expect.poll(() => page.getByTestId('mechanics-mode-build').getAttribute('aria-pressed')).toBe('true');
  await expect.poll(async () => (await pressureState(page)).gate?.closed).toBe(false);
  await expect.poll(async () => (await pressureState(page)).debug?.bodyCount).toBe(4);
  await expect.poll(async () => (await pressureState(page)).debug?.groundBodyCount).toBe(1);
});
