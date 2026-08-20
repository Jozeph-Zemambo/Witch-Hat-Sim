import { expect, test } from '@playwright/test';
import { join } from 'node:path';

function screenshotPath(name) {
  return join(
    process.env.FABLING_RUNS ?? '/tmp',
    '02-build-player-world-collisions',
    'screenshots',
    name,
  );
}

async function enterWorld(page) {
  await page.goto('/');
  await page.getByTestId('title-play').click();
  const acknowledgement = page.getByTestId('acknowledge-enter');
  if (await acknowledgement.count()) {
    await expect(page.getByTestId('scene-canvas-frame')).toHaveCount(1);
    await expect(page.getByTestId('scene-canvas')).toBeVisible();
    await acknowledgement.click();
    const tutorialSkip = page.getByTestId('tutorial-skip');
    if (await tutorialSkip.count()) await tutorialSkip.click();
  }
  await expect(page.locator('[data-entry-phase="world"]')).toBeVisible();
  await expect(page.getByTestId('scene-canvas-frame')).toHaveCount(1);
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__WHA_MAIN_WORLD_PHYSICS__?.ready), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => Boolean(window.__WHA_PLAYER_PHYSICS__))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__WHA_SCENE_READY__ === true)).toBe(true);
  await expect.poll(() => page.evaluate(() => (
    typeof window.__WHA_SET_PLAYER_STATE__ === 'function' && Boolean(window.__WHA_PLAYER__?.position)
  ))).toBe(true);
}

async function teleport(page, position) {
  await page.evaluate((next) => window.__WHA_SET_PLAYER_STATE__({ position: next }), position);
  await expect.poll(() => page.evaluate((next) => {
    const actual = window.__WHA_PLAYER__?.position;
    return actual && Math.hypot(actual.x - next.x, actual.z - next.z) < 0.02;
  }, position)).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const render = window.__WHA_PLAYER__?.position;
    const direct = window.__WHA_PLAYER_PHYSICS__?.getSnapshot?.()?.position;
    const published = window.__WHA_MAIN_WORLD_PHYSICS__?.player?.position;
    if (!render || !direct || !published) return false;
    return Math.hypot(render.x - direct.x, render.z - direct.z) < 0.02
      && Math.hypot(render.x - published.x, render.z - published.z) < 0.02
      && Math.hypot(direct.x - published.x, direct.z - published.z) < 0.02;
  })).toBe(true);
}

test('main-world coverage and player evidence include wall, tree, source, rocks, and every practice block', async ({ page }) => {
  await enterWorld(page);
  const snapshot = await page.evaluate(() => window.__WHA_MAIN_WORLD_PHYSICS__);
  await expect.poll(() => page.evaluate(() => window.__WHA_WORLD_OBJECT_LABEL_COUNT__)).toBe(0);
  expect(snapshot.player.config).toMatchObject({
    height: 1.575,
    radius: 0.28,
    capsuleHalfHeight: 0.5075,
    offset: 0.02,
    mass: 48,
    autostepMaxHeight: 0.22,
    autostepMinWidth: 0.25,
    snapToGroundDistance: 0.18,
  });
  expect(snapshot.bodies['atelier-house'].bodyMode).toBe('fixed');
  expect(snapshot.bodies['prop:prop:practice-tree'].bodyMode).toBe('fixed');
  expect(snapshot.bodies['prop:prop:tree-apple'].bodyMode).toBe('dynamic');
  expect(snapshot.bodies['prop:prop:practice-cube'].bodyMode).toBe('dynamic');
  expect(snapshot.bodies['prop:prop:small-practice-cube'].bodyMode).toBe('dynamic');
  expect(snapshot.bodies['prop:field-practice-crate-0'].bodyMode).toBe('dynamic');
  expect(snapshot.bodies['prop:field-practice-crate-1'].bodyMode).toBe('dynamic');
  expect(Object.values(snapshot.bodies).some((body) => body.role === 'source_vessel')).toBe(true);
  expect(Object.values(snapshot.bodies).some((body) => body.role === 'loose_rock')).toBe(true);
  expect(Object.values(snapshot.bodies).some((body) => body.role === 'loose_crate')).toBe(true);
});

test('falling below the map kill plane respawns at the Atelier', async ({ page }) => {
  await enterWorld(page);
  const spawn = await page.evaluate(() => ({ ...window.__WHA_PLAYER__.position }));

  await page.evaluate(() => {
    window.__WHA_PLAYER_PHYSICS__.teleportPlayer({ x: 13, y: -74, z: 0 });
  });
  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__?.position?.y)).toBeCloseTo(-74, 1);
  expect(await page.evaluate((start) => {
    const current = window.__WHA_PLAYER__?.position;
    return Math.hypot(current.x - start.x, current.z - start.z);
  }, spawn)).toBeGreaterThan(1);

  await page.evaluate(() => {
    window.__WHA_PLAYER_PHYSICS__.teleportPlayer({ x: 13, y: -76, z: 0 });
  });
  await expect.poll(() => page.evaluate((start) => {
    const current = window.__WHA_PLAYER__?.position;
    return current && Math.hypot(current.x - start.x, current.z - start.z) < 0.02;
  }, spawn)).toBe(true);
});

test('wall blocks, doorway remains traversable, and workshop desk stays visibly aligned', async ({ page }) => {
  await enterWorld(page);
  // Local house point x=1.5 is outside the right side of the front doorway.
  await teleport(page, { x: -2.7, z: -2.43 });
  await page.evaluate(() => window.__WHA_PLAYER_PHYSICS__.requestTranslation({ x: -0.7, y: 0, z: -0.8 }));
  await expect.poll(() => page.evaluate(() => window.__WHA_MAIN_WORLD_PHYSICS__?.player?.collisionRoles ?? [])).toContain('house');
  await page.screenshot({ path: screenshotPath('wall-with-doorway.png') });

  // The same front route through local x=-0.3 is open.
  await teleport(page, { x: -4.58, z: -1.73 });
  await page.evaluate(() => window.__WHA_PLAYER_PHYSICS__.requestTranslation({ x: -0.8, y: 0, z: -1.1 }));
  await page.evaluate(() => window.__WHA_SET_PLAYER_STATE__({
    position: { x: -5.55, y: 0, z: -3.35 },
    facing: Math.atan2(-4.1904 - -5.55, -4.3733 - -3.35),
  }));
  const teleportPublications = await page.evaluate(() => {
    const render = window.__WHA_PLAYER__?.position;
    const direct = window.__WHA_PLAYER_PHYSICS__?.getSnapshot?.()?.position;
    const published = window.__WHA_MAIN_WORLD_PHYSICS__?.player?.position;
    const delta = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    return {
      render,
      direct,
      published,
      renderDirectDelta: delta(render, direct),
      renderPublishedDelta: delta(render, published),
      directPublishedDelta: delta(direct, published),
    };
  });
  expect(teleportPublications.renderDirectDelta).toBeLessThan(0.02);
  expect(teleportPublications.renderPublishedDelta).toBeLessThan(0.02);
  expect(teleportPublications.directPublishedDelta).toBeLessThan(0.02);
  await expect(page.getByTestId('workbench-prompt')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__WHA_WORKBENCH_INTERACTION__)).toMatchObject({
    physicsAligned: true,
    eligible: true,
  });
  await expect.poll(() => page.evaluate(() => {
    const physics = window.__WHA_MAIN_WORLD_PHYSICS__?.player?.position;
    const render = window.__WHA_PLAYER__?.position;
    return physics && render && Math.hypot(physics.x - render.x, physics.z - render.z) < 0.02;
  })).toBe(true);
  await page.screenshot({ path: screenshotPath('inside-workbench-aligned.png') });
});

test('tree/source contacts and dynamic push produce bounded collision evidence', async ({ page }) => {
  await enterWorld(page);
  const initial = await page.evaluate(() => window.__WHA_MAIN_WORLD_PHYSICS__);
  const fixedBefore = Object.fromEntries(
    Object.entries(initial.bodies)
      .filter(([, body]) => body.bodyMode === 'fixed')
      .map(([id, body]) => [id, body.position]),
  );
  const tree = initial.bodies['prop:prop:practice-tree'].position;
  await teleport(page, { x: tree.x - 1.2, z: tree.z });
  await page.evaluate(() => window.__WHA_PLAYER_PHYSICS__.requestTranslation({ x: 1.6, y: 0, z: 0 }));
  await expect.poll(() => page.evaluate(() => window.__WHA_MAIN_WORLD_PHYSICS__?.player?.collisionRoles ?? [])).toContain('tree_landmark');
  const source = Object.values(initial.bodies).find((body) => body.role === 'source_vessel');
  await teleport(page, { x: source.position.x - 1.2, z: source.position.z });
  await page.evaluate(() => window.__WHA_PLAYER_PHYSICS__.requestTranslation({ x: 1.6, y: 0, z: 0 }));
  await expect.poll(() => page.evaluate(() => window.__WHA_MAIN_WORLD_PHYSICS__?.player?.collisionRoles ?? [])).toContain('source_vessel');
  await page.screenshot({ path: screenshotPath('tree-source-contact.png') });

  const cubeBefore = await page.evaluate(() => window.__WHA_MAIN_WORLD_PHYSICS__.bodies['prop:prop:practice-cube'].position);
  await teleport(page, { x: cubeBefore.x - 0.9, z: cubeBefore.z });
  await page.screenshot({ path: screenshotPath('dynamic-before-push.png') });
  await page.evaluate(() => window.__WHA_PLAYER_PHYSICS__.requestTranslation({ x: 1.4, y: 0, z: 0 }));
  await expect.poll(() => page.evaluate((before) => {
    const cube = window.__WHA_MAIN_WORLD_PHYSICS__?.bodies['prop:prop:practice-cube'];
    return cube ? cube.position.x !== before.x || cube.position.z !== before.z : false;
  }, cubeBefore)).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const cube = window.__WHA_MAIN_WORLD_PHYSICS__?.bodies['prop:prop:practice-cube'];
    const demand = window.__WHA_MAIN_WORLD_PHYSICS__?.demand;
    if (!cube) return false;
    const speed = Math.hypot(cube.linearVelocity.x, cube.linearVelocity.y, cube.linearVelocity.z);
    const angularSpeed = Math.hypot(cube.angularVelocity.x, cube.angularVelocity.y, cube.angularVelocity.z);
    return Math.abs(cube.position.x) <= 12
      && Math.abs(cube.position.z) <= 9
      && cube.position.y >= -0.05
      && speed < 0.01
      && angularSpeed < 0.01
      && cube.sleeping === true
      && demand?.awakeDynamicBody === false;
  })).toBe(true);
  const final = await page.evaluate(() => window.__WHA_MAIN_WORLD_PHYSICS__);
  for (const [id, before] of Object.entries(fixedBefore)) {
    const body = final.bodies[id];
    expect(body).toBeTruthy();
    expect(Math.hypot(
      body.position.x - before.x,
      body.position.y - before.y,
      body.position.z - before.z,
    )).toBeLessThan(0.001);
    expect(Math.hypot(
      body.linearVelocity.x,
      body.linearVelocity.y,
      body.linearVelocity.z,
    )).toBeLessThan(0.001);
  }
  await page.screenshot({ path: screenshotPath('dynamic-after-push.png') });
});

test('dialog input disables player physics requests without weakening world ownership', async ({ page }) => {
  await enterWorld(page);
  await page.getByRole('button', { name: 'Spellpad — inventory slot 1' }).click();
  await expect(page.getByRole('dialog', { name: 'Spellpad' })).toBeVisible();
  const before = await page.evaluate(() => window.__WHA_PLAYER__?.position);
  await page.keyboard.down('w');
  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__?.moving)).toBe(false);
  await page.keyboard.up('w');
  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__)).toMatchObject({ inputEnabled: false, moving: false });
  expect(await page.evaluate(() => window.__WHA_PLAYER__?.position)).toEqual(before);
});
