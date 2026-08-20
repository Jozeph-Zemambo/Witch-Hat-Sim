import { expect, test } from '@playwright/test';

async function placedSpellCanvasPoint(page, canvas) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Scene canvas has no bounding box');
  return page.evaluate(({ width, height }) => {
    const spell = window.__WHA_PLACED_SPELLS__[0];
    const target = window.__WHA_PLACED_SPELL_WORLD_TRANSFORMS__[spell.id].position;
    const camera = window.__WHA_CAMERA_DEBUG__;
    const forward = camera.lookDirection;
    const rightLength = Math.hypot(forward.z, forward.x) || 1;
    const right = { x: -forward.z / rightLength, y: 0, z: forward.x / rightLength };
    const up = {
      x: right.y * forward.z - right.z * forward.y,
      y: right.z * forward.x - right.x * forward.z,
      z: right.x * forward.y - right.y * forward.x,
    };
    const delta = {
      x: target.x - camera.position.x,
      y: target.y - camera.position.y,
      z: target.z - camera.position.z,
    };
    const depth = delta.x * forward.x + delta.y * forward.y + delta.z * forward.z;
    const tanHalfFov = Math.tan((camera.fov * Math.PI / 180) / 2);
    const ndcX = (delta.x * right.x + delta.y * right.y + delta.z * right.z)
      / (depth * tanHalfFov * (width / height));
    const ndcY = (delta.x * up.x + delta.y * up.y + delta.z * up.z)
      / (depth * tanHalfFov);
    return { x: (ndcX + 1) * width / 2, y: (1 - ndcY) * height / 2 };
  }, { width: box.width, height: box.height });
}

test('Light Levitation compiles into a visible golden Rapier orb in the player world', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/dev');
  await expect(page.getByTestId('scene-canvas-frame')).toBeVisible();
  await page.getByLabel('Sample spell').selectOption('light-levitation');
  await page.getByRole('button', { name: 'Compile', exact: true }).click();
  await expect(page.getByTestId('compile-status')).toHaveText('Compile OK');
  await page.getByRole('button', { name: 'Save to Spellpad' }).click();
  const cameraModeToggle = page.getByTestId('camera-mode-toggle');
  await cameraModeToggle.evaluate((button) => button.click());
  await expect(cameraModeToggle).toHaveAttribute('data-camera-mode', 'fc');
  await cameraModeToggle.evaluate((button) => button.click());
  await expect(cameraModeToggle).toHaveAttribute('data-camera-mode', 'fp');

  const canvas = page.locator('canvas.scene-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Scene canvas has no bounding box');
  const position = { x: box.width / 2, y: box.height * 0.74 };
  await canvas.click({ button: 'right', force: true, position });
  await page.evaluate(() => {
    const camera = window.__WHA_CAMERA_DEBUG__;
    const screenNdcY = 1 - (0.74 * 2);
    const verticalOffset = Math.atan(screenNdcY * Math.tan((camera.fov * Math.PI / 180) / 2));
    window.__WHA_SET_PLAYER_STATE__({
      position: window.__WHA_PLAYER__.position,
      yaw: camera.yaw,
      pitch: camera.pitch + verticalOffset,
    });
  });
  await page.keyboard.press('2');
  await expect.poll(() => page.evaluate(() => window.__WHA_SELECTED_TOOL__)).toBe('manager');
  await canvas.click({ force: true, position: { x: box.width / 2, y: box.height / 2 } });
  const manager = page.getByRole('dialog', { name: 'Spell Manager' });
  await expect(manager).toBeVisible();
  const toggled = manager.getByRole('button', { name: 'Toggled' });
  if (await toggled.getAttribute('aria-pressed') !== 'true') await toggled.click();
  await manager.getByRole('button', { name: 'Close' }).click({ force: true });
  await page.evaluate(() => {
    const sceneCanvas = document.querySelector('canvas.scene-canvas');
    let locked = false;
    Object.defineProperty(document, 'pointerLockElement', {
      configurable: true,
      get: () => (locked ? sceneCanvas : null),
    });
    Object.defineProperty(sceneCanvas, 'requestPointerLock', {
      configurable: true,
      value: () => {
        locked = true;
        document.dispatchEvent(new Event('pointerlockchange'));
        return Promise.resolve();
      },
    });
  });
  await page.getByTestId('camera-pointer-lock').click();
  const pressM2 = (pointerId) => page.evaluate((id) => {
    document.querySelector('canvas.scene-canvas').dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 2,
      buttons: 2,
      pointerId: id,
      pointerType: 'mouse',
    }));
  }, pointerId);
  await pressM2(91);
  await expect(page.getByTestId('tool-status')).toContainText('activated');

  // M2 is the normal in-world path. The first rendered state must begin
  // inside the formation, not flash the completed full-size sphere before
  // the motion system receives its first frame.
  await expect.poll(
    () => page.evaluate(() => {
      const visual = window.__WHA_LEVITATION_VISUALS__?.[0];
      if (!visual) return null;
      return visual.lifecyclePhase !== 'hovering' && visual.presence < 1
        ? { lifecyclePhase: visual.lifecyclePhase, presence: visual.presence }
        : null;
    }),
    { timeout: 15_000 },
  ).not.toBeNull();

  await expect.poll(
    () => page.evaluate(() => window.__WHA_LEVITATION_VISUALS__?.[0] ?? null),
    { timeout: 15_000 },
  ).toMatchObject({
    materialKind: 'light',
    visualPreset: 'levitation_stable_hover',
    fieldShape: 'generated_levitation_orb',
    active: true,
    bodyColor: '#f4e991',
    illuminationColor: '#fff0b0',
    renderName: expect.stringMatching(/^levitation-orb:main-world-field:/),
    animationStyle: 'light_converge_and_release',
    floorRingPresent: false,
    materialType: 'MeshStandardMaterial',
    geometryType: 'IcosahedronGeometry',
    surfaceProfile: 'lab_golden_emissive_light',
  });
  await expect.poll(
    () => page.evaluate(() => {
      const visual = window.__WHA_LEVITATION_VISUALS__?.[0];
      return visual ? {
        radiiMatch: visual.orbRadius === visual.circleRadius,
        lifecyclePhase: visual.lifecyclePhase,
        presence: visual.presence,
        rendered: visual.renderedVisible === true && visual.renderedFrameCount > 0,
      } : null;
    }),
    { timeout: 15_000 },
  ).toEqual({ radiiMatch: true, lifecyclePhase: 'hovering', presence: 1, rendered: true });
  await expect.poll(
    () => page.evaluate(() => Object.values(window.__WHA_MAIN_WORLD_PHYSICS__?.bodies ?? {})
      .find((body) => body.role === 'generated_levitation_orb') ?? null),
    { timeout: 15_000 },
  ).toMatchObject({
    role: 'generated_levitation_orb',
    bodyMode: 'dynamic',
  });
  await page.screenshot({
    path: `${process.env.FABLING_RUNS ?? '/tmp'}/wha-light-levitation-world.png`,
  });

  // The same visual stays mounted for its render-neutral stop operation, so
  // Light can release outward instead of disappearing in the deactivation
  // click. Completion is a spring rest state, not a fixed timeout.
  await pressM2(92);
  await expect(page.getByTestId('tool-status')).toContainText('deactivated');
  await expect.poll(
    () => page.evaluate(() => window.__WHA_LEVITATION_VISUALS__?.[0] ?? null),
    { timeout: 15_000 },
  ).toMatchObject({
    active: false,
    animationStyle: 'light_converge_and_release',
    floorRingPresent: false,
  });
  await expect.poll(
    () => page.evaluate(() => {
      const visual = window.__WHA_LEVITATION_VISUALS__?.[0];
      return visual ? { lifecyclePhase: visual.lifecyclePhase, presence: visual.presence } : null;
    }),
    { timeout: 15_000 },
  ).toEqual({ lifecyclePhase: 'settled', presence: 0 });
  expect(errors).toEqual([]);
});

test('Wind Levitation visuals scale with their circle and exist only while active', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/dev');
  await expect(page.getByTestId('scene-canvas-frame')).toBeVisible();
  await page.getByLabel('Sample spell').selectOption('wind-levitation');
  await page.getByRole('button', { name: 'Compile', exact: true }).click();
  await expect(page.getByTestId('compile-status')).toHaveText('Compile OK');
  await page.getByRole('button', { name: 'Save to Spellpad' }).click();

  const canvas = page.locator('canvas.scene-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Scene canvas has no bounding box');
  const position = { x: box.width * 0.7, y: box.height * 0.78 };
  await canvas.click({ button: 'right', force: true, position });
  await expect.poll(() => page.evaluate(() => window.__WHA_LEVITATION_VISUALS__ ?? []))
    .toEqual([]);

  await page.getByRole('button', { name: 'Wrench — inventory slot 3' }).click({ force: true });
  const wrench = page.getByTestId('wrench-hud');
  await expect(wrench).toBeVisible();
  await wrench.getByLabel('Uniform scale').fill('0.4');
  await wrench.getByLabel('Uniform scale').press('Enter');
  await expect(wrench.getByLabel('Uniform scale')).toHaveValue('0.40');

  await page.getByRole('button', { name: 'Spell Manager — inventory slot 2' }).click({ force: true });
  await canvas.click({ force: true, position });
  const manager = page.getByRole('dialog', { name: 'Spell Manager' });
  await expect(manager).toBeVisible();
  const toggled = manager.getByRole('button', { name: 'Toggled' });
  if (await toggled.getAttribute('aria-pressed') !== 'true') await toggled.click();
  await manager.getByRole('button', { name: 'Activate' }).click({ force: true });

  await expect.poll(
    () => page.evaluate(() => window.__WHA_LEVITATION_VISUALS__?.[0] ?? null),
    { timeout: 15_000 },
  ).toMatchObject({
    materialKind: 'wind',
    active: true,
    worldScale: 0.4,
    effectScale: 2,
  });

  await manager.getByRole('button', { name: 'Deactivate' }).click({ force: true });
  await expect.poll(() => page.evaluate(() => window.__WHA_LEVITATION_VISUALS__ ?? []))
    .toEqual([]);
  expect(errors).toEqual([]);
});

for (const elemental of [
  {
    material: 'water',
    sample: 'water-levitation',
    materialType: 'MeshPhysicalMaterial',
    geometryType: 'SphereGeometry',
    surfaceProfile: 'lab_refractive_rippled_water',
    teardownPhase: 'splashing',
  },
  {
    material: 'earth',
    sample: 'earth-levitation',
    materialType: 'MeshStandardMaterial',
    geometryType: 'DodecahedronGeometry',
    surfaceProfile: 'lab_faceted_rough_earth',
    teardownPhase: 'crumbling',
  },
]) {
  test(`${elemental.material} levitation keeps its Lab surface and elemental teardown`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/dev');
    await page.getByLabel('Sample spell').selectOption(elemental.sample);
    await page.getByRole('button', { name: 'Compile', exact: true }).click();
    await expect(page.getByTestId('compile-status')).toHaveText('Compile OK');
    await page.getByRole('button', { name: 'Save to Spellpad' }).click();

    const canvas = page.locator('canvas.scene-canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Scene canvas has no bounding box');
    const position = { x: box.width * 0.7, y: box.height * 0.78 };
    await canvas.click({ button: 'right', force: true, position });
    await page.getByRole('button', { name: 'Spell Manager — inventory slot 2' }).click({ force: true });
    await canvas.click({ force: true, position });
    const manager = page.getByRole('dialog', { name: 'Spell Manager' });
    await expect(manager).toBeVisible();
    const toggled = manager.getByRole('button', { name: 'Toggled' });
    if (await toggled.getAttribute('aria-pressed') !== 'true') await toggled.click();
    await manager.getByRole('button', { name: 'Close' }).click({ force: true });
    const placedPoint = await placedSpellCanvasPoint(page, canvas);
    const pressM2 = () => canvas.click({ button: 'right', force: true, position: placedPoint });
    await pressM2();
    await expect.poll(() => page.evaluate(() => window.__WHA_PLACED_SPELLS__?.[0]?.active)).toBe(true);
    await expect.poll(() => page.evaluate(() => {
      const visual = window.__WHA_LEVITATION_VISUALS__?.[0];
      return visual ? {
        materialType: visual.materialType,
        geometryType: visual.geometryType,
        surfaceProfile: visual.surfaceProfile,
        radiiMatch: visual.orbRadius === visual.circleRadius,
        floorRingPresent: visual.floorRingPresent,
        animatedSurface: visual.materialKind !== 'water' || visual.surfaceMotion > 0,
      } : null;
    }), { timeout: 20_000 }).toEqual({
      materialType: elemental.materialType,
      geometryType: elemental.geometryType,
      surfaceProfile: elemental.surfaceProfile,
      radiiMatch: true,
      floorRingPresent: false,
      animatedSurface: true,
    });
    await expect.poll(() => page.evaluate(() => {
      const visual = window.__WHA_LEVITATION_VISUALS__?.[0];
      return visual ? { phase: visual.lifecyclePhase, presence: visual.presence } : null;
    }), { timeout: 20_000 }).toEqual({ phase: 'hovering', presence: 1 });
    await page.screenshot({ path: `/tmp/wha-player-${elemental.material}-hovering.png` });

    await pressM2();
    await expect.poll(() => page.evaluate(() => window.__WHA_PLACED_SPELLS__?.[0]?.active)).toBe(false);
    await expect.poll(() => page.evaluate(({ phase, material }) => {
      const visual = window.__WHA_LEVITATION_VISUALS__?.[0];
      if (visual?.active !== false || visual.lifecyclePhase !== phase) return false;
      return material === 'earth'
        ? visual.particleCount === 12 && visual.renderedVisible === true
        : visual.presence > 0.04 && visual.presence < 0.96;
    }, {
      phase: elemental.teardownPhase,
      material: elemental.material,
    }), { timeout: 20_000 }).toBe(true);
    await page.screenshot({ path: `/tmp/wha-player-${elemental.material}-teardown.png` });
    await expect.poll(() => page.evaluate(() => {
      const visual = window.__WHA_LEVITATION_VISUALS__?.[0];
      return visual ? { phase: visual.lifecyclePhase, presence: visual.presence } : null;
    }), { timeout: 30_000 }).toEqual({ phase: 'settled', presence: 0 });
  });
}

test('player-route M2 visibly forms and dissipates lab-quality fire with reduced motion', async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/dev');
  await page.getByLabel('Sample spell').selectOption('fire-levitation');
  await page.getByRole('button', { name: 'Compile', exact: true }).click();
  await expect(page.getByTestId('compile-status')).toHaveText('Compile OK');
  await page.getByRole('button', { name: 'Save to Spellpad' }).click();
  const cameraModeToggle = page.getByTestId('camera-mode-toggle');
  await cameraModeToggle.evaluate((button) => button.click());
  await expect(cameraModeToggle).toHaveAttribute('data-camera-mode', 'fc');
  await cameraModeToggle.evaluate((button) => button.click());
  await expect(cameraModeToggle).toHaveAttribute('data-camera-mode', 'fp');
  const canvas = page.locator('canvas.scene-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Scene canvas has no bounding box');
  await canvas.click({
    button: 'right',
    force: true,
    position: { x: box.width / 2, y: box.height * 0.74 },
  });
  await expect(page.getByTestId('tool-status')).toContainText('placed inactive');

  await page.evaluate(() => {
    const camera = window.__WHA_CAMERA_DEBUG__;
    const screenNdcY = 1 - (0.74 * 2);
    const verticalOffset = Math.atan(screenNdcY * Math.tan((camera.fov * Math.PI / 180) / 2));
    window.__WHA_SET_PLAYER_STATE__({
      position: window.__WHA_PLAYER__.position,
      yaw: camera.yaw,
      pitch: camera.pitch + verticalOffset,
    });
  });
  await page.keyboard.press('2');
  await canvas.click({ force: true, position: await placedSpellCanvasPoint(page, canvas) });
  const manager = page.getByRole('dialog', { name: 'Spell Manager' });
  await expect(manager).toBeVisible();
  await manager.getByRole('button', { name: 'Toggled' }).click();
  await manager.getByRole('button', { name: 'Close' }).click({ force: true });
  // Enter the real PlayerShell route while retaining the authored placement
  // held by the shared store.
  await page.evaluate(() => {
    window.sessionStorage.setItem('wha-player-acknowledged', '1');
    window.history.pushState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByTestId('scene-canvas-frame')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__WHA_PLACED_SPELLS__?.length ?? 0)).toBe(1);
  await page.keyboard.press('2');
  await expect.poll(() => page.evaluate(() => window.__WHA_SELECTED_TOOL__)).toBe('manager');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const placedPoint = await placedSpellCanvasPoint(page, canvas);
  const pressM2 = async () => canvas.click({
    button: 'right',
    force: true,
    position: placedPoint,
  });

  await pressM2();
  await expect.poll(() => page.evaluate(() => window.__WHA_PLACED_SPELLS__?.[0]?.active)).toBe(true);
  await expect.poll(
    () => page.evaluate(() => {
      const visual = window.__WHA_LEVITATION_VISUALS__?.[0];
      if (!visual || visual.active !== true) return null;
      return visual.presence > 0.04 && visual.presence < 0.9 ? {
        phase: visual.lifecyclePhase,
        reducedMotion: visual.reducedMotion,
        materialType: visual.materialType,
        surfaceProfile: visual.surfaceProfile,
        shaderMoving: visual.shaderTime > 0,
        rendered: visual.renderedVisible === true,
      } : null;
    }),
    { timeout: 15_000 },
  ).toEqual({
    phase: 'igniting',
    reducedMotion: true,
    materialType: 'ShaderMaterial',
    surfaceProfile: 'lab_simplex_fire_with_embers',
    shaderMoving: true,
    rendered: true,
  });
  await page.screenshot({ path: '/tmp/wha-player-fire-forming.png' });

  await expect.poll(
    () => page.evaluate(() => {
      const visual = window.__WHA_LEVITATION_VISUALS__?.[0];
      return visual ? {
        phase: visual.lifecyclePhase,
        presence: visual.presence,
        rendered: visual.renderedVisible === true && visual.renderedFrameCount > 0,
      } : null;
    }),
    { timeout: 15_000 },
  ).toEqual({ phase: 'hovering', presence: 1, rendered: true });
  await page.screenshot({ path: '/tmp/wha-player-fire-hovering.png' });

  await pressM2();
  await expect.poll(
    () => page.evaluate(() => {
      const visual = window.__WHA_LEVITATION_VISUALS__?.[0];
      if (!visual || visual.active !== false) return null;
      return visual.presence > 0.04 && visual.presence < 0.9 ? {
        phase: visual.lifecyclePhase,
        rendered: visual.renderedVisible === true,
      } : null;
    }),
    { timeout: 15_000 },
  ).toEqual({ phase: 'dissipating', rendered: true });
  await page.screenshot({ path: '/tmp/wha-player-fire-dissipating.png' });
  await expect.poll(
    () => page.evaluate(() => {
      const visual = window.__WHA_LEVITATION_VISUALS__?.[0];
      return visual ? { phase: visual.lifecyclePhase, presence: visual.presence } : null;
    }),
    { timeout: 15_000 },
  ).toEqual({ phase: 'settled', presence: 0 });
});
