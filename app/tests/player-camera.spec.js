import { expect, test } from '@playwright/test';
import { join } from 'node:path';

function screenshotPath(name) {
  return join(
    process.env.FABLING_RUNS ?? '/tmp',
    '06-rebuild-player-camera-controls',
    'screenshots',
    name,
  );
}

async function enterWorld(page) {
  await page.goto('/');
  await page.getByTestId('title-play').click();
  await page.getByTestId('acknowledge-enter').click();
  const tutorialSkip = page.getByTestId('tutorial-skip');
  if (await tutorialSkip.count()) await tutorialSkip.click();
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
}

async function installPointerLockProbe(page) {
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas.scene-canvas');
    let locked = false;
    Object.defineProperty(document, 'pointerLockElement', {
      configurable: true,
      get: () => (locked ? canvas : null),
    });
    Object.defineProperty(canvas, 'requestPointerLock', {
      configurable: true,
      value: () => {
        locked = true;
        document.dispatchEvent(new Event('pointerlockchange'));
        return Promise.resolve();
      },
    });
    Object.defineProperty(document, 'exitPointerLock', {
      configurable: true,
      value: () => {
        locked = false;
        document.dispatchEvent(new Event('pointerlockchange'));
      },
    });
    window.__WHA_TEST_RELEASE_POINTER_LOCK__ = () => {
      document.exitPointerLock();
    };
  });
}

async function dispatchMouse(page, movementX, movementY = 0) {
  await page.evaluate(({ movementX: x, movementY: y }) => {
    const event = new MouseEvent('mousemove', { bubbles: true });
    Object.defineProperty(event, 'movementX', { value: x });
    Object.defineProperty(event, 'movementY', { value: y });
    document.dispatchEvent(event);
  }, { movementX, movementY });
}

test('FP crosshair and pointer-locked M2 share the split editor canvas center', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/dev');
  await expect(page.locator('canvas.scene-canvas')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Save to Spellpad' }).click();

  const cameraModeToggle = page.getByTestId('camera-mode-toggle');
  await cameraModeToggle.evaluate((button) => button.click());
  await expect(cameraModeToggle).toHaveAttribute('data-camera-mode', 'fc');
  await cameraModeToggle.evaluate((button) => button.click());
  await expect(cameraModeToggle).toHaveAttribute('data-camera-mode', 'fp');

  const alignment = await page.evaluate(() => {
    const canvas = document.querySelector('canvas.scene-canvas');
    const crosshair = document.querySelector('[data-testid="fps-crosshair"]');
    const canvasBounds = canvas.getBoundingClientRect();
    const crosshairBounds = crosshair.getBoundingClientRect();
    return {
      canvasCenter: {
        x: canvasBounds.left + canvasBounds.width / 2,
        y: canvasBounds.top + canvasBounds.height / 2,
      },
      crosshairCenter: {
        x: crosshairBounds.left + crosshairBounds.width / 2,
        y: crosshairBounds.top + crosshairBounds.height / 2,
      },
    };
  });
  expect(alignment.crosshairCenter.x).toBeCloseTo(alignment.canvasCenter.x, 5);
  expect(alignment.crosshairCenter.y).toBeCloseTo(alignment.canvasCenter.y, 5);

  await page.evaluate(() => {
    window.__WHA_SET_PLAYER_STATE__({
      position: window.__WHA_PLAYER__.position,
      yaw: window.__WHA_PLAYER__.yaw,
      pitchDeg: -55,
    });
  });
  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__.pitchDeg)).toBe(-55);

  await installPointerLockProbe(page);
  await page.getByTestId('camera-pointer-lock').click();
  await page.evaluate(() => {
    window.__WHA_CONTEXT_PICK_DEBUG__ = { sentinel: true };
    document.querySelector('canvas.scene-canvas').dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 2,
      buttons: 2,
      pointerId: 63,
      pointerType: 'mouse',
    }));
  });
  await expect.poll(() => page.evaluate(() => window.__WHA_CONTEXT_PICK_DEBUG__)).toMatchObject({
    selectedTool: 'spellpad',
    inputEventType: 'pointerdown',
    pointerLocked: true,
  });
  await expect(page.getByTestId('tool-status')).toContainText('placed inactive');
  await expect.poll(() => page.evaluate(() => window.__WHA_PLACED_SPELLS__?.length)).toBe(1);
  const centeredPlacement = await page.evaluate(() => ({
    pickedSurfaceId: window.__WHA_CONTEXT_PICK_DEBUG__?.surfaceId,
    placedSurfaceId: window.__WHA_PLACED_SPELLS__?.[0]?.anchor?.surfaceId,
  }));
  expect(centeredPlacement.pickedSurfaceId).toBeTruthy();
  expect(centeredPlacement.placedSurfaceId).toBe(centeredPlacement.pickedSurfaceId);

  await page.evaluate(() => {
    document.querySelector('canvas.scene-canvas').dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      button: 2,
    }));
  });
  await expect.poll(() => page.evaluate(() => window.__WHA_PLACED_SPELLS__?.length)).toBe(1);
});

test('FP mouse yaw and pitch are natural, bounded, W-stable, and diagonal movement is normalized', async ({ page }) => {
  await enterWorld(page);
  const cameraModeToggle = page.getByTestId('camera-mode-toggle');
  await expect(cameraModeToggle).toHaveAttribute('data-camera-mode', 'fp');
  await cameraModeToggle.hover();
  await expect(page.getByTestId('camera-mode-tooltip')).toHaveText('First person');
  await expect(page.getByTestId('camera-mode-tooltip')).toBeVisible();
  await expect(page.getByTestId('fps-crosshair')).toBeVisible();
  await installPointerLockProbe(page);
  await page.getByTestId('camera-pointer-lock').click();
  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__?.pointerLock)).toMatchObject({ locked: true });

  const beforeYaw = await page.evaluate(() => window.__WHA_PLAYER__.yaw);
  await dispatchMouse(page, 180);
  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__.yaw)).not.toBe(beforeYaw);
  const turnedYaw = await page.evaluate(() => window.__WHA_PLAYER__.yaw);
  await dispatchMouse(page, 0, -260);
  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__.yaw)).toBe(turnedYaw);
  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__.pitchDeg)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__.lookDirection.y)).toBeGreaterThan(0);
  await dispatchMouse(page, 0, -10_000);
  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__.pitchDeg)).toBe(80);
  await dispatchMouse(page, 0, 20_000);
  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__.pitchDeg)).toBe(-80);

  const beforeW = await page.evaluate(() => ({
    ...window.__WHA_PLAYER__.position,
    yaw: window.__WHA_PLAYER__.yaw,
    pitch: window.__WHA_PLAYER__.pitch,
  }));
  await page.keyboard.down('w');
  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__.moving)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__.position)).not.toEqual(beforeW.position);
  await page.keyboard.up('w');
  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__.yaw)).toBe(beforeW.yaw);
  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__.pitch)).toBe(beforeW.pitch);

  await page.keyboard.down('w');
  await page.keyboard.down('d');
  await expect.poll(() => page.evaluate(() => {
    const movement = window.__WHA_PLAYER__.movement;
    return movement.moving && Math.hypot(movement.x, movement.z);
  })).toBeCloseTo(1, 2);
  await page.keyboard.up('d');
  await page.keyboard.up('w');
  await page.screenshot({ path: screenshotPath('fps-centered-crosshair-facing.png') });
});

test('holding M1 and dragging rotates the camera without pointer lock', async ({ page }) => {
  await enterWorld(page);
  const canvas = page.getByTestId('scene-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Scene canvas has no bounding box');
  const before = await page.evaluate(() => ({
    yaw: window.__WHA_PLAYER__.yaw,
    pitch: window.__WHA_PLAYER__.pitch,
  }));

  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down({ button: 'left' });
  await expect(canvas).toHaveAttribute('data-camera-look-dragging', 'true');
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.4, { steps: 4 });
  await page.mouse.up({ button: 'left' });

  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__.yaw)).not.toBe(before.yaw);
  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__.pitch)).not.toBe(before.pitch);
  await expect(canvas).toHaveAttribute('data-camera-look-dragging', 'false');
});

test('TP follows over the right shoulder, shares player look, preserves facing while moving, and avoids the roof', async ({ page }) => {
  await enterWorld(page);
  await page.evaluate(() => window.__WHA_SET_PLAYER_STATE__({ position: { x: 0, z: 0 }, yaw: 0, pitch: 0 }));
  await page.getByTestId('camera-mode-toggle').click();
  await expect(page.getByTestId('camera-mode-toggle')).toHaveAttribute('data-camera-mode', 'tp');
  await expect(page.getByTestId('fps-crosshair')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__)).toMatchObject({
    mode: 'tp',
    fov: 52,
    thirdPerson: { obstructed: false },
  });

  const shoulder = await page.evaluate(() => ({
    camera: window.__WHA_CAMERA_DEBUG__.position,
    head: window.__WHA_CAMERA_DEBUG__.playerHeadPosition,
  }));
  expect(shoulder.camera.y).toBeGreaterThan(shoulder.head.y);
  expect(shoulder.camera.x).toBeLessThan(shoulder.head.x);

  await installPointerLockProbe(page);
  await page.getByTestId('camera-pointer-lock').click();
  const beforeLook = await page.evaluate(() => ({ yaw: window.__WHA_PLAYER__.yaw, camera: window.__WHA_CAMERA_DEBUG__.position }));
  await dispatchMouse(page, 160, -30);
  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__.yaw)).not.toBe(beforeLook.yaw);
  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__.position)).not.toEqual(beforeLook.camera);

  const beforeMove = await page.evaluate(() => ({
    position: window.__WHA_PLAYER__.position,
    yaw: window.__WHA_PLAYER__.yaw,
    facingDirection: {
      x: Math.sin(window.__WHA_PLAYER__.yaw),
      z: Math.cos(window.__WHA_PLAYER__.yaw),
    },
  }));
  await page.keyboard.down('w');
  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__.moving)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__.position)).not.toEqual(beforeMove.position);
  await page.keyboard.up('w');
  const afterMove = await page.evaluate(() => window.__WHA_PLAYER__);
  const displacement = {
    x: afterMove.position.x - beforeMove.position.x,
    z: afterMove.position.z - beforeMove.position.z,
  };
  expect(displacement.x * beforeMove.facingDirection.x + displacement.z * beforeMove.facingDirection.z).toBeGreaterThan(0);
  expect(afterMove.yaw).toBe(beforeMove.yaw);

  await page.evaluate(() => window.__WHA_SET_PLAYER_STATE__({
    position: { x: -5.8, z: -3.6 },
    yaw: 0,
    pitchDeg: -45,
  }));
  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__.thirdPerson?.obstructed)).toBe(true);
  const roofCamera = await page.evaluate(() => window.__WHA_CAMERA_DEBUG__.thirdPerson);
  expect(roofCamera.resolvedBoomDistance).toBeLessThan(roofCamera.desiredBoomDistance);
  await page.screenshot({ path: screenshotPath('third-person-follow-camera.png') });
});

test('FC seeds from TP, leaves WASD on the player, and moves independently with camera keys and mouse', async ({ page }) => {
  await enterWorld(page);
  await page.evaluate(() => window.__WHA_SET_PLAYER_STATE__({ position: { x: 0, z: 0 }, yaw: 0, pitch: 0 }));
  await page.getByTestId('camera-mode-toggle').click();
  const tpPosition = await page.evaluate(() => window.__WHA_CAMERA_DEBUG__.position);
  await page.getByTestId('camera-mode-toggle').click();
  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__)).toMatchObject({ mode: 'fc', fov: 58 });
  expect(await page.evaluate((before) => {
    const after = window.__WHA_CAMERA_DEBUG__.position;
    return Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
  }, tpPosition)).toBeLessThan(0.02);

  const beforePlayerMove = await page.evaluate(() => ({
    player: window.__WHA_PLAYER__.position,
    camera: window.__WHA_CAMERA_DEBUG__.position,
  }));
  await page.keyboard.down('w');
  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__.position)).not.toEqual(beforePlayerMove.player);
  await page.keyboard.up('w');
  expect(await page.evaluate(() => window.__WHA_CAMERA_DEBUG__.position)).toEqual(beforePlayerMove.camera);

  await page.keyboard.down('ArrowUp');
  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__.position.z)).toBeGreaterThan(beforePlayerMove.camera.z);
  await page.keyboard.up('ArrowUp');
  const beforeStrafe = await page.evaluate(() => window.__WHA_CAMERA_DEBUG__.position.x);
  await page.keyboard.down('ArrowRight');
  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__.position.x)).toBeLessThan(beforeStrafe);
  await page.keyboard.up('ArrowRight');
  const beforeTap = await page.evaluate(() => window.__WHA_CAMERA_DEBUG__.position.x);
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft' }));
  });
  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__.position.x)).not.toBe(beforeTap);
  const beforeRise = await page.evaluate(() => window.__WHA_CAMERA_DEBUG__.position.y);
  await page.keyboard.down('Period');
  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__.position.y)).toBeGreaterThan(beforeRise);
  await page.keyboard.up('Period');
  const beforeDescent = await page.evaluate(() => window.__WHA_CAMERA_DEBUG__.position.y);
  await page.keyboard.down('Comma');
  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__.position.y)).toBeLessThan(beforeDescent);
  await page.keyboard.up('Comma');
  const playerYaw = await page.evaluate(() => window.__WHA_PLAYER__.yaw);
  await installPointerLockProbe(page);
  await page.getByTestId('camera-pointer-lock').click();
  const cameraYaw = await page.evaluate(() => window.__WHA_CAMERA_DEBUG__.yaw);
  await dispatchMouse(page, 140, 20);
  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__.yaw)).not.toBe(cameraYaw);
  expect(await page.evaluate(() => window.__WHA_PLAYER__.yaw)).toBe(playerYaw);
});

test('pointer lock lifecycle, dialog isolation, crosshair mode, and tool gesture ownership are explicit', async ({ page }) => {
  test.setTimeout(90_000);
  await enterWorld(page);
  await expect(page.getByTestId('fps-crosshair')).toBeVisible();
  await installPointerLockProbe(page);
  await page.getByTestId('camera-pointer-lock').click();
  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__.pointerLock)).toMatchObject({ locked: true });

  await page.evaluate(() => {
    window.__WHA_CONTEXT_PICK_DEBUG__ = { sentinel: true };
    document.querySelector('canvas.scene-canvas').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 }));
  });
  await expect.poll(() => page.evaluate(() => window.__WHA_CONTEXT_PICK_DEBUG__)).toMatchObject({
    selectedTool: 'spellpad',
  });
  const emptySpellpad = page.getByRole('dialog', { name: 'Spellpad' });
  await expect(emptySpellpad).toBeVisible();
  await page.evaluate(() => window.__WHA_TEST_RELEASE_POINTER_LOCK__());
  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__.pointerLock.locked)).toBe(false);
  await emptySpellpad.getByRole('button', { name: 'Close' }).click();
  await expect(emptySpellpad).toHaveCount(0);

  await page.getByTestId('camera-mode-toggle').click();
  await expect(page.getByTestId('fps-crosshair')).toHaveCount(0);
  await page.getByRole('button', { name: 'Spellpad — inventory slot 1' }).click();
  await expect(page.getByRole('dialog', { name: 'Spellpad' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__)).toMatchObject({ inputEnabled: false, pointerLock: false, moving: false });
  await page.keyboard.down('w');
  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__.moving)).toBe(false);
  await page.keyboard.up('w');
  await page.getByRole('dialog', { name: 'Spellpad' }).getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog', { name: 'Spellpad' })).toHaveCount(0);
});

test('captured modal UI keeps one pointer-lock session and closes through the in-app cursor', async ({ page }) => {
  await enterWorld(page);
  await installPointerLockProbe(page);
  await page.getByTestId('camera-pointer-lock').click();
  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__.pointerLock)).toMatchObject({
    locked: true,
    preferred: true,
    suspended: false,
    requested: 1,
  });
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas.scene-canvas');
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      buttons: 1,
    }));
    canvas.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      button: 0,
      buttons: 0,
    }));
  });
  const spellpad = page.getByRole('dialog', { name: 'Spellpad' });
  await expect(spellpad).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__.pointerLock)).toMatchObject({
    locked: true,
    preferred: true,
    suspended: false,
    requested: 1,
  });
  await expect(page.getByTestId('captured-pointer-cursor')).toBeVisible();

  const swipeDelivery = await page.evaluate(() => {
    const cursor = window.__WHA_VIRTUAL_CURSOR__;
    const startX = cursor.exactX;
    for (let index = 0; index < 5; index += 1) {
      const movement = new MouseEvent('mousemove', { bubbles: true });
      Object.defineProperty(movement, 'movementX', { value: 3 });
      Object.defineProperty(movement, 'movementY', { value: 0 });
      document.dispatchEvent(movement);
    }
    return {
      actual: window.__WHA_VIRTUAL_CURSOR__.exactX - startX,
      expected: 5 * 3 * cursor.sensitivity,
    };
  });
  expect(swipeDelivery.actual).toBeCloseTo(swipeDelivery.expected, 5);

  await page.evaluate(() => {
    const close = document.querySelector('[aria-labelledby="spellpad-dialog-title"] button[aria-label="Close"]');
    const rect = close.getBoundingClientRect();
    const cursor = window.__WHA_VIRTUAL_CURSOR__;
    const movement = new MouseEvent('mousemove', { bubbles: true });
    Object.defineProperty(movement, 'movementX', {
      value: (rect.left + rect.width / 2 - (cursor.exactX ?? cursor.x)) / (cursor.sensitivity ?? 1),
    });
    Object.defineProperty(movement, 'movementY', {
      value: (rect.top + rect.height / 2 - (cursor.exactY ?? cursor.y)) / (cursor.sensitivity ?? 1),
    });
    document.dispatchEvent(movement);
  });
  await expect.poll(() => page.evaluate(() => window.__WHA_VIRTUAL_CURSOR__?.target)).toBe('Close');
  await page.evaluate(() => {
    document.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
      buttons: 1,
    }));
    document.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      button: 0,
      buttons: 0,
    }));
  });
  await expect(spellpad).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__.pointerLock)).toMatchObject({
    locked: true,
    preferred: true,
    suspended: false,
    requested: 1,
  });
  await expect(page.getByTestId('captured-pointer-cursor')).toHaveCount(0);
});
