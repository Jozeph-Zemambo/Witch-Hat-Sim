import { expect, test } from '@playwright/test';

async function scenePoint(page) {
  const canvas = page.locator('canvas.scene-canvas');
  await expect(canvas).toBeVisible({ timeout: 120_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Scene canvas has no bounding box');
  return {
    canvas,
    box,
    position: {
      x: Math.min(box.width - 20, Math.max(20, box.width * 0.7)),
      y: Math.min(box.height - 20, Math.max(20, box.height * 0.78)),
    },
  };
}

async function saveAndPlaceDefaultSpell(page) {
  await page.goto('/dev');
  await page.getByRole('button', { name: 'Save to Spellpad' }).click();
  const target = await scenePoint(page);
  await target.canvas.click({ button: 'right', force: true, position: target.position });
  await expect(page.getByTestId('tool-status')).toContainText('placed inactive');
  return target;
}

async function cameraDebug(page) {
  return page.evaluate(() => window.__WHA_CAMERA_DEBUG__ ?? null);
}

async function aimFirstPersonAtPhysicsBody(page, bodyId) {
  await page.evaluate((id) => {
    const target = window.__WHA_MAIN_WORLD_PHYSICS__.bodies[id].position;
    const distance = 2.2;
    const playerHeadHeight = 1.43;
    window.__WHA_SET_PLAYER_STATE__({
      position: { x: target.x, z: target.z - distance },
      yaw: 0,
      pitch: Math.atan2(target.y - playerHeadHeight, distance),
    });
  }, bodyId);
  await expect.poll(() => page.evaluate((id) => {
    const target = window.__WHA_MAIN_WORLD_PHYSICS__?.bodies?.[id]?.position;
    const camera = window.__WHA_CAMERA_DEBUG__;
    if (!target || !camera) return false;
    const dx = target.x - camera.position.x;
    const dy = target.y - camera.position.y;
    const dz = target.z - camera.position.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    return (
      dx / length * camera.lookDirection.x
      + dy / length * camera.lookDirection.y
      + dz / length * camera.lookDirection.z
    ) > 0.998;
  }, bodyId)).toBe(true);
  const canvas = page.locator('canvas.scene-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Scene canvas has no bounding box');
  return { canvas, position: { x: box.width / 2, y: box.height / 2 } };
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
  });
}

async function moveCapturedCursorTo(page, locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Captured cursor target has no bounding box');
  await moveCapturedCursorToPoint(page, {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  });
}

async function moveCapturedCursorToPoint(page, point) {
  await page.evaluate(({ x, y }) => {
    const cursor = window.__WHA_VIRTUAL_CURSOR__;
    const movement = new MouseEvent('mousemove', { bubbles: true });
    Object.defineProperty(movement, 'movementX', { value: (x - (cursor.exactX ?? cursor.x)) / (cursor.sensitivity ?? 1) });
    Object.defineProperty(movement, 'movementY', { value: (y - (cursor.exactY ?? cursor.y)) / (cursor.sensitivity ?? 1) });
    document.dispatchEvent(movement);
  }, point);
}

async function dispatchCapturedClick(page, button = 0) {
  await page.evaluate((mouseButton) => {
    const downAllowed = document.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: mouseButton,
      buttons: mouseButton === 2 ? 2 : 1,
      pointerId: 73,
      pointerType: 'mouse',
    }));
    if (downAllowed) {
      document.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: mouseButton,
        buttons: mouseButton === 2 ? 2 : 1,
      }));
    }
    const upAllowed = document.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      button: mouseButton,
      buttons: 0,
      pointerId: 73,
      pointerType: 'mouse',
    }));
    if (upAllowed) {
      document.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        button: mouseButton,
        buttons: 0,
      }));
    }
    if (mouseButton === 2) {
      document.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        buttons: 0,
      }));
    }
  }, button);
}

async function dispatchCapturedWorldClick(page, button = 0) {
  await page.evaluate((mouseButton) => {
    const canvas = document.querySelector('canvas.scene-canvas');
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: mouseButton,
      buttons: mouseButton === 2 ? 2 : 1,
      pointerId: 72,
      pointerType: 'mouse',
    }));
    canvas.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      button: mouseButton,
      buttons: 0,
      pointerId: 72,
      pointerType: 'mouse',
    }));
  }, button);
}

async function dispatchCapturedMouseDown(page, button = 0) {
  await page.evaluate((mouseButton) => {
    const allowed = document.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: mouseButton,
      buttons: mouseButton === 2 ? 2 : 1,
      pointerId: 74,
      pointerType: 'mouse',
    }));
    if (allowed) {
      document.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: mouseButton,
        buttons: mouseButton === 2 ? 2 : 1,
      }));
    }
  }, button);
}

async function dispatchCapturedMouseUp(page, button = 0) {
  await page.evaluate((mouseButton) => {
    const allowed = document.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      button: mouseButton,
      buttons: 0,
      pointerId: 74,
      pointerType: 'mouse',
    }));
    if (allowed) {
      document.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        button: mouseButton,
        buttons: 0,
      }));
    }
  }, button);
}

async function dispatchCapturedMovement(page, x, y) {
  await page.evaluate(({ movementX, movementY }) => {
    const cursor = window.__WHA_VIRTUAL_CURSOR__;
    const scaledX = movementX / (cursor.effectiveSensitivity ?? cursor.sensitivity ?? 1);
    const scaledY = movementY / (cursor.effectiveSensitivity ?? cursor.sensitivity ?? 1);
    const timeStamp = performance.now();
    const pointerMovement = new PointerEvent('pointermove', {
      bubbles: true,
      buttons: 1,
      pointerId: 74,
      pointerType: 'mouse',
    });
    const mouseMovement = new MouseEvent('mousemove', { bubbles: true, buttons: 1 });
    for (const event of [pointerMovement, mouseMovement]) {
      Object.defineProperty(event, 'movementX', { value: scaledX });
      Object.defineProperty(event, 'movementY', { value: scaledY });
      Object.defineProperty(event, 'timeStamp', { value: timeStamp });
      document.dispatchEvent(event);
    }
  }, { movementX: x, movementY: y });
}

async function dispatchCapturedWheel(page, deltaY) {
  await page.evaluate((amount) => {
    document.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: amount,
    }));
  }, deltaY);
}

function cameraDistance(left, right) {
  return Math.hypot(
    Number(left.x) - Number(right.x),
    Number(left.y) - Number(right.y),
    Number(left.z) - Number(right.z),
  );
}

async function findWrenchGizmoHitRegion(page, axis, visibleOnly = false) {
  return page.evaluate(({ wantedAxis, requireTopHit }) => {
    const canvas = document.querySelector('canvas.scene-canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const hits = [];
    for (let y = rect.top + rect.height * 0.1; y <= rect.top + rect.height * 0.9; y += 4) {
      for (let x = rect.left + rect.width * 0.1; x <= rect.left + rect.width * 0.9; x += 4) {
        const event = new PointerEvent('pointermove', {
          bubbles: true,
          button: -1,
          clientX: x,
          clientY: y,
          pointerId: 92,
          pointerType: 'mouse',
        });
        Object.defineProperty(event, '__whaVirtualPointer', { value: true });
        canvas.dispatchEvent(event);
        if (canvas.dataset.wrenchTransformAxis === wantedAxis && (!requireTopHit || document.elementFromPoint(x, y) === canvas)) {
          hits.push({ x, y });
        }
      }
    }
    if (hits.length === 0) return null;
    const center = {
      x: hits.reduce((sum, hit) => sum + hit.x, 0) / hits.length,
      y: hits.reduce((sum, hit) => sum + hit.y, 0) / hits.length,
    };
    return hits.reduce((closest, hit) => (
      Math.hypot(hit.x - center.x, hit.y - center.y) < Math.hypot(closest.x - center.x, closest.y - center.y)
        ? hit
        : closest
    ), hits[0]);
  }, { wantedAxis: axis, requireTopHit: visibleOnly });
}

test('Spellpad saves reusable templates and places independent inactive copies', async ({ page }) => {
  test.setTimeout(75_000);
  const target = await saveAndPlaceDefaultSpell(page);
  await target.canvas.click({
    button: 'right',
    force: true,
    position: {
      x: target.box.width * 0.52,
      y: target.box.height * 0.68,
    },
  });

  await page.getByRole('button', { name: 'Spell Manager — inventory slot 2' }).click({ force: true });
  await target.canvas.click({ force: true, position: target.position });
  const manager = page.getByRole('dialog', { name: 'Spell Manager' });
  await expect(manager).toBeVisible();
  await expect(manager.getByText('Centered Watershot columns #1')).toBeVisible();
  await expect(manager.getByText('Centered Watershot columns #2')).toBeVisible();
  const durationInputs = await manager.getByLabel('Duration (seconds)').all();
  expect(durationInputs).toHaveLength(2);
  expect(await manager.getByRole('button', { name: 'Held' }).count()).toBe(0);
  const firstRow = manager.locator('article').filter({ hasText: 'Centered Watershot columns #1' });
  const secondRow = manager.locator('article').filter({ hasText: 'Centered Watershot columns #2' });
  await firstRow.getByRole('button', { name: 'Toggled' }).click();
  await secondRow.getByRole('button', { name: 'Toggled' }).click();
  await firstRow.getByRole('button', { name: 'Activate' }).click();
  await secondRow.getByRole('button', { name: 'Activate' }).click();
  await expect(page.getByTestId('water-column-count')).toHaveText('2');
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.values(window.__WHA_MAIN_WATER_COLUMNS__ ?? {}).filter(
          (column) => column.promotedToMain === true && column.lifecycle?.phase !== 'idle',
        ).length,
      ),
    )
    .toBe(2);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.values(window.__WHA_MAIN_WATER_COLUMNS__ ?? {}).every(
          (column) => column.labGuideVisible === false,
        ),
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.values(window.__WHA_MAIN_WATER_COLUMNS__ ?? {}).map((column) => ({
          selfCollisionDetected: column.projectedArc?.selfCollisionDetected,
          surface: column.collision?.surface,
          perpendicular: Math.abs(column.direction?.y ?? 0) < 0.01,
        })),
      ),
    )
    .toEqual([
      {
        selfCollisionDetected: false,
        surface: 'ground',
        perpendicular: true,
      },
      {
        selfCollisionDetected: false,
        surface: 'ground',
        perpendicular: true,
      },
    ]);
});

test('promoted dispersion renderer drives the main placed spell', async ({ page }) => {
  test.setTimeout(75_000);
  await page.goto('/dev');
  await page.getByLabel('Sample spell').selectOption('water-dispersion');
  await page.getByRole('button', { name: 'Compile', exact: true }).click();
  await page.getByRole('button', { name: 'Save to Spellpad' }).click();
  const target = await scenePoint(page);
  await target.canvas.click({ button: 'right', force: true, position: target.position });

  await page.getByRole('button', { name: 'Spell Manager — inventory slot 2' }).click({ force: true });
  await target.canvas.click({ force: true, position: target.position });
  const manager = page.getByRole('dialog', { name: 'Spell Manager' });
  await manager.getByRole('button', { name: 'Toggled' }).click();
  await manager.getByRole('button', { name: 'Activate' }).click();

  await expect(page.getByTestId('dispersion-count')).toHaveText('1');
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.values(window.__WHA_MAIN_WATER_DISPERSIONS__ ?? {})[0] ?? null,
      ),
    )
    .toMatchObject({
      promotedToMain: true,
      mode: 'water_dispersion_sheet',
      outputProfile: { geometry: 'radial_umbrella_curtain' },
      presentation: {
        helperGuidesVisible: false,
        rivuletCount: 17,
        rivuletScale: 0.39,
      },
      sheet: {
        effectiveCanopyReach: 0.52,
        minimumCanopyReach: 0.52,
      },
      semantics: {
        collision: {
          model: 'four_independent_quadrants',
          quadrantCount: 4,
          independentPerQuadrant: true,
        },
      },
      contactMist: {
        style: 'thin_low_volume_line',
        quadrantCount: 4,
        particleCount: 12,
      },
    });

  await expect.poll(() => page.evaluate(() => {
    const field = (window.__WHA_MAIN_WORLD_PHYSICS__?.fields ?? []).find(
      (item) => item.fieldShape === 'dispersion' && item.materialKind === 'water',
    );
    return field ? {
      outerRadius: Number(field.outerRadius?.toFixed(4)),
      contactModel: field.dispersionContacts?.model,
      quadrantCount: field.dispersionContacts?.quadrants?.length,
    } : null;
  })).toEqual({
    outerRadius: 0.5197,
    contactModel: 'four_independent_quadrants',
    quadrantCount: 4,
  });
});

test('Manager controls five-second and toggled activation independently', async ({ page }) => {
  const target = await saveAndPlaceDefaultSpell(page);
  await page.getByRole('button', { name: 'Spell Manager — inventory slot 2' }).click({ force: true });
  await target.canvas.click({ force: true, position: target.position });

  const manager = page.getByRole('dialog', { name: 'Spell Manager' });
  await manager.getByRole('button', { name: 'Activate' }).click();
  await expect(page.getByTestId('water-column-count')).toHaveText('1');
  await manager.getByRole('button', { name: 'Toggled' }).click();
  await expect(page.getByTestId('water-column-count')).toHaveText('0');
  await manager.getByRole('button', { name: 'Activate' }).click();
  await expect(page.getByTestId('water-column-count')).toHaveText('1');
  await manager.getByRole('button', { name: 'Close' }).click();
  await target.canvas.click({ button: 'right', force: true, position: target.position });
  await expect(page.getByTestId('water-column-count')).toHaveText('0');
});

test('TP camera remains responsive while a timed spell is active', async ({ page }) => {
  test.setTimeout(75_000);
  const target = await saveAndPlaceDefaultSpell(page);
  await page.getByRole('button', { name: 'Spell Manager — inventory slot 2' }).click({ force: true });
  await target.canvas.click({ force: true, position: target.position });

  const manager = page.getByRole('dialog', { name: 'Spell Manager' });
  await manager.getByLabel('Duration (seconds)').fill('120');
  await manager.getByRole('button', { name: 'Activate' }).click();
  await expect(page.getByTestId('water-column-count')).toHaveText('1');
  await manager.getByRole('button', { name: 'Close' }).click();

  const before = await cameraDebug(page);
  expect(before?.mode).toBe('tp');
  expect(before?.position).toBeTruthy();

  await page.waitForTimeout(350);
  await expect(page.getByTestId('water-column-count')).toHaveText('1');
  const afterTimerTick = await cameraDebug(page);
  expect(afterTimerTick.mode).toBe('tp');

  await installPointerLockProbe(page);
  await page.getByTestId('camera-pointer-lock').click();
  await page.evaluate(() => {
    const event = new MouseEvent('mousemove', { bubbles: true });
    Object.defineProperty(event, 'movementX', { value: 180 });
    Object.defineProperty(event, 'movementY', { value: -40 });
    document.dispatchEvent(event);
  });

  const afterDrag = await cameraDebug(page);
  expect(cameraDistance(before.position, afterDrag.position)).toBeGreaterThan(0.05);
  await expect(page.getByTestId('water-column-count')).toHaveText('1');
});

test('Wrench exposes keyboard transforms and confirmed removal', async ({ page }) => {
  await saveAndPlaceDefaultSpell(page);
  await page.getByRole('button', { name: 'Wrench — inventory slot 3' }).click({ force: true });

  const hud = page.getByTestId('wrench-hud');
  await expect(hud).toBeVisible();
  await hud.getByLabel('Uniform scale').fill('1.5');
  await hud.getByLabel('Uniform scale').press('Enter');
  await hud.getByLabel('Rotation X').fill('20');
  await hud.getByLabel('Rotation X').press('Enter');
  await hud.getByLabel('Rotation Y').fill('-15');
  await hud.getByLabel('Rotation Y').press('Enter');
  await expect(hud.getByLabel('Uniform scale')).toHaveValue('1.50');
  await expect(hud.getByLabel('Rotation X')).toHaveValue('20.00');
  await expect(hud.getByLabel('Rotation Y')).toHaveValue('-15.00');

  await hud.getByRole('button', { name: 'Remove item' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Remove placed spell?' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Remove spell' }).click();
  await expect(hud).toHaveCount(0);
  await expect(page.locator('canvas.scene-canvas')).not.toHaveAttribute('data-wrench-transform-operation');
});

test('wrench controls keep the existing pointer-lock session through close', async ({ page }) => {
  test.setTimeout(180_000);
  await saveAndPlaceDefaultSpell(page);
  await installPointerLockProbe(page);
  await page.getByTestId('camera-pointer-lock').click();
  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__.pointerLock.locked)).toBe(true);

  await page.getByRole('button', { name: 'Wrench — inventory slot 3' }).click({ force: true });
  const hud = page.getByTestId('wrench-hud');
  await expect(hud).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__.pointerLock)).toMatchObject({
    locked: true,
    preferred: true,
    suspended: false,
    requested: 1,
  });
  await expect(page.getByTestId('captured-pointer-cursor')).toBeVisible();

  const hudBox = await hud.boundingBox();
  if (!hudBox) throw new Error('Wrench HUD has no bounding box');
  await moveCapturedCursorToPoint(page, {
    x: hudBox.x + hudBox.width / 2,
    y: hudBox.y + hudBox.height * 0.75,
  });
  await dispatchCapturedWheel(page, 800);
  await expect.poll(() => hud.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  const size = hud.getByLabel('Uniform scale');
  const sizeBox = await size.boundingBox();
  if (!sizeBox) throw new Error('Uniform scale input has no bounding box');
  const beforeSize = Number(await size.inputValue());
  await moveCapturedCursorToPoint(page, {
    x: sizeBox.x + sizeBox.width - 5,
    y: sizeBox.y + sizeBox.height * 0.25,
  });
  await dispatchCapturedClick(page);
  await expect.poll(async () => Number(await size.inputValue())).toBeGreaterThan(beforeSize);
  await moveCapturedCursorToPoint(page, {
    x: sizeBox.x + sizeBox.width - 5,
    y: sizeBox.y + sizeBox.height * 0.75,
  });
  await dispatchCapturedClick(page);
  await expect.poll(async () => Number(await size.inputValue())).toBe(beforeSize);

  await moveCapturedCursorToPoint(page, {
    x: sizeBox.x + sizeBox.width * 0.5,
    y: sizeBox.y + sizeBox.height / 2,
  });
  await expect.poll(() => page.evaluate(() => {
    const cursorState = window.__WHA_VIRTUAL_CURSOR__;
    const target = document.elementFromPoint(cursorState.exactX, cursorState.exactY);
    return { tag: target?.tagName, type: target?.getAttribute?.('type') };
  })).toEqual({ tag: 'INPUT', type: 'number' });
  await dispatchCapturedClick(page);
  await page.keyboard.press('Meta+A');
  await page.keyboard.type('1.5');
  await page.keyboard.press('Enter');
  await expect.poll(async () => Number(await size.inputValue())).toBeGreaterThan(beforeSize);

  await moveCapturedCursorToPoint(page, {
    x: hudBox.x + hudBox.width / 2,
    y: hudBox.y + hudBox.height * 0.25,
  });
  await dispatchCapturedWheel(page, -800);
  await expect.poll(() => hud.evaluate((element) => element.scrollTop)).toBe(0);
  await moveCapturedCursorTo(page, hud.getByRole('button', { name: 'Close wrench controls' }));
  await dispatchCapturedClick(page);
  await expect(hud).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__.pointerLock)).toMatchObject({
    locked: true,
    preferred: true,
    suspended: false,
    requested: 1,
  });
});

test('captured cursor operates spell-maker controls and fully edits the Preview', async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15',
    });
  });
  await page.goto('/dev');
  await expect(page.locator('canvas.scene-canvas')).toBeVisible({ timeout: 120_000 });
  await installPointerLockProbe(page);
  await page.getByTestId('camera-pointer-lock').click();
  await dispatchCapturedWorldClick(page);

  const spellpad = page.getByRole('dialog', { name: 'Spellpad' });
  await expect(spellpad).toBeVisible();
  await moveCapturedCursorTo(page, spellpad.getByRole('button', { name: 'Create spell' }));
  await dispatchCapturedClick(page);

  const maker = page.getByRole('dialog', { name: 'Create spell' });
  await expect(maker).toBeVisible();
  const cursor = page.getByTestId('captured-pointer-cursor');
  await expect(cursor).toBeVisible();
  const cursorBox = await cursor.boundingBox();
  expect(cursorBox?.width).toBeCloseTo(13.5, 1);
  expect(cursorBox?.height).toBeCloseTo(18, 1);
  await expect(cursor.locator('path')).toHaveCSS('fill', 'rgb(17, 17, 17)');
  await expect(cursor.locator('path')).toHaveCSS('stroke', 'rgb(255, 255, 255)');

  const freeMovement = await page.evaluate(() => window.__WHA_VIRTUAL_CURSOR__.effectiveSensitivity);
  await dispatchCapturedMouseDown(page);
  const heldMovement = await page.evaluate(() => window.__WHA_VIRTUAL_CURSOR__.effectiveSensitivity);
  await dispatchCapturedMouseUp(page);
  expect(freeMovement).toBeCloseTo(4.16, 5);
  expect(heldMovement).toBeCloseTo(2.6, 5);

  const spellName = maker.getByLabel('Spell name');
  await moveCapturedCursorTo(page, spellName);
  await dispatchCapturedClick(page);
  await page.keyboard.type('Captured controls');
  await expect(spellName).toHaveValue('Captured controls');

  const fire = maker.getByRole('radio', { name: 'Fire' });
  await moveCapturedCursorTo(page, fire);
  await dispatchCapturedClick(page);
  await expect(fire).toBeChecked();

  const signType = maker.getByLabel('Sign type');
  await moveCapturedCursorTo(page, signType);
  await dispatchCapturedClick(page);
  const selectMenu = page.getByRole('listbox', { name: 'Sign type options' });
  await expect(selectMenu).toBeVisible();
  const levitation = selectMenu.getByRole('option', { name: 'Levitation' });
  await moveCapturedCursorTo(page, levitation);
  await dispatchCapturedClick(page);
  await expect(signType).toHaveValue('sign.levitation');
  await expect(selectMenu).toHaveCount(0);

  const count = maker.getByLabel('Count');
  const countBox = await count.boundingBox();
  if (!countBox) throw new Error('Count input has no bounding box');
  await moveCapturedCursorToPoint(page, {
    x: countBox.x + countBox.width - 5,
    y: countBox.y + countBox.height * 0.25,
  });
  await dispatchCapturedClick(page);
  await expect(count).toHaveValue('5');
  await moveCapturedCursorToPoint(page, {
    x: countBox.x + countBox.width - 5,
    y: countBox.y + countBox.height * 0.75,
  });
  await dispatchCapturedClick(page);
  await expect(count).toHaveValue('4');

  const signTarget = maker.getByRole('button', { name: 'Select group 1, sign 1' });
  const sign = maker.locator('.spell-preview-sign').first();
  await moveCapturedCursorTo(page, signTarget);
  let resizeHandle = maker.getByRole('button', { name: 'Resize group 1, sign 1 from top right' });
  await expect(resizeHandle).toBeVisible();
  await moveCapturedCursorTo(page, spellName);
  await expect(resizeHandle).toHaveCount(0);
  await moveCapturedCursorTo(page, signTarget);
  await expect(resizeHandle).toBeVisible();
  await dispatchCapturedClick(page);
  await expect(resizeHandle).toBeVisible();

  const centerBeforeMove = {
    x: Number(await sign.getAttribute('data-center-x')),
    y: Number(await sign.getAttribute('data-center-y')),
  };
  await moveCapturedCursorTo(page, signTarget);
  await dispatchCapturedMouseDown(page);
  await dispatchCapturedMovement(page, -28, 24);
  // The Preview must move while M1 is still held, not only after release.
  await expect.poll(async () => {
    const current = {
      x: Number(await sign.getAttribute('data-center-x')),
      y: Number(await sign.getAttribute('data-center-y')),
    };
    return Math.hypot(current.x - centerBeforeMove.x, current.y - centerBeforeMove.y);
  }).toBeGreaterThan(1);
  await dispatchCapturedMouseUp(page);

  let rotateHandle = maker.getByRole('button', { name: 'Rotate group 1, sign 1' });
  const signBox = await sign.boundingBox();
  const rotateBox = await rotateHandle.boundingBox();
  if (!signBox || !rotateBox) throw new Error('Preview rotation handle has no bounding box');
  const signCenter = {
    x: signBox.x + signBox.width / 2,
    y: signBox.y + signBox.height / 2,
  };
  const rotatePoint = {
    x: rotateBox.x + rotateBox.width / 2,
    y: rotateBox.y + rotateBox.height / 2,
  };
  const rotateOffset = {
    x: rotatePoint.x - signCenter.x,
    y: rotatePoint.y - signCenter.y,
  };
  const beforeFacing = await maker.getByLabel('Sign 1 facing').inputValue();
  await moveCapturedCursorToPoint(page, rotatePoint);
  await dispatchCapturedMouseDown(page);
  await moveCapturedCursorToPoint(page, {
    x: signCenter.x - rotateOffset.y,
    y: signCenter.y + rotateOffset.x,
  });
  await dispatchCapturedMouseUp(page);
  await expect(maker.getByLabel('Sign 1 facing')).not.toHaveValue(beforeFacing);

  resizeHandle = maker.getByRole('button', { name: 'Resize group 1, sign 1 from top right' });
  const size = maker.getByLabel('Sign 1 size');
  const beforeResize = Number(await size.inputValue());
  const resizedSignBox = await sign.boundingBox();
  const resizeBox = await resizeHandle.boundingBox();
  if (!resizedSignBox || !resizeBox) throw new Error('Preview resize handle has no bounding box');
  const resizeCenter = {
    x: resizedSignBox.x + resizedSignBox.width / 2,
    y: resizedSignBox.y + resizedSignBox.height / 2,
  };
  const resizePoint = {
    x: resizeBox.x + resizeBox.width / 2,
    y: resizeBox.y + resizeBox.height / 2,
  };
  await moveCapturedCursorToPoint(page, resizePoint);
  await dispatchCapturedMouseDown(page);
  await moveCapturedCursorToPoint(page, {
    x: resizeCenter.x + (resizePoint.x - resizeCenter.x) * 1.35,
    y: resizeCenter.y + (resizePoint.y - resizeCenter.y) * 1.35,
  });
  await dispatchCapturedMouseUp(page);
  await expect.poll(async () => Number(await size.inputValue())).toBeGreaterThan(beforeResize);

  const fields = maker.locator('.spell-maker-fields');
  const initialScroll = await fields.evaluate((element) => element.scrollTop);
  const fieldsBox = await fields.boundingBox();
  if (!fieldsBox) throw new Error('Spell Maker fields have no bounding box');
  await moveCapturedCursorToPoint(page, {
    x: fieldsBox.x + fieldsBox.width * 0.5,
    y: fieldsBox.y + fieldsBox.height * 0.75,
  });
  await dispatchCapturedWheel(page, 420);
  await expect.poll(() => fields.evaluate((element) => element.scrollTop)).toBeGreaterThan(initialScroll);

  await moveCapturedCursorTo(page, maker.getByRole('button', { name: 'Save spell' }));
  await dispatchCapturedClick(page);
  await expect(spellpad).toBeVisible();
  await moveCapturedCursorTo(page, spellpad.getByRole('button', { name: 'Edit', exact: true }));
  await dispatchCapturedClick(page);

  const editor = page.getByRole('dialog', { name: 'Edit spell' });
  await expect(editor).toBeVisible();
  const editedSign = editor.locator('.spell-preview-sign').first();
  const editedSignTarget = editor.getByRole('button', { name: 'Select group 1, sign 1' });
  const editCenterBeforeMove = {
    x: Number(await editedSign.getAttribute('data-center-x')),
    y: Number(await editedSign.getAttribute('data-center-y')),
  };
  await moveCapturedCursorTo(page, editedSignTarget);
  await dispatchCapturedMouseDown(page);
  await dispatchCapturedMovement(page, 22, -18);
  await expect.poll(async () => {
    const current = {
      x: Number(await editedSign.getAttribute('data-center-x')),
      y: Number(await editedSign.getAttribute('data-center-y')),
    };
    return Math.hypot(current.x - editCenterBeforeMove.x, current.y - editCenterBeforeMove.y);
  }).toBeGreaterThan(1);
  await dispatchCapturedMouseUp(page);

  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__.pointerLock)).toMatchObject({
    locked: true,
    requested: 1,
  });
});

test('captured Asset Manager uses the in-app cursor and places without recapturing', async ({ page }) => {
  await page.goto('/dev');
  await expect(page.locator('canvas.scene-canvas')).toBeVisible({ timeout: 120_000 });
  await page.keyboard.press('4');
  await installPointerLockProbe(page);
  await page.getByTestId('camera-pointer-lock').click();
  await dispatchCapturedWorldClick(page);

  const manager = page.getByRole('dialog', { name: 'Asset Manager' });
  await expect(manager).toBeVisible();
  await expect(page.getByTestId('captured-pointer-cursor')).toBeVisible();
  await moveCapturedCursorTo(page, manager.getByTestId('asset-shape-cuboid'));
  await dispatchCapturedClick(page);
  await expect(manager.getByTestId('asset-shape-cuboid')).toHaveAttribute('aria-pressed', 'true');

  const canvas = page.locator('canvas.scene-canvas');
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('Scene canvas has no bounding box');
  await page.evaluate(({ x, y }) => {
    const cursor = window.__WHA_VIRTUAL_CURSOR__;
    const movement = new MouseEvent('mousemove', { bubbles: true });
    Object.defineProperty(movement, 'movementX', { value: (x - (cursor.exactX ?? cursor.x)) / (cursor.sensitivity ?? 1) });
    Object.defineProperty(movement, 'movementY', { value: (y - (cursor.exactY ?? cursor.y)) / (cursor.sensitivity ?? 1) });
    document.dispatchEvent(movement);
  }, { x: canvasBox.x + canvasBox.width * 0.72, y: canvasBox.y + canvasBox.height * 0.78 });
  await dispatchCapturedClick(page, 2);

  await expect(page.getByTestId('tool-status')).toContainText('Block placed');
  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__.pointerLock)).toMatchObject({
    locked: true,
    requested: 1,
  });
});

test('captured Spell Manager unbinds a placed spell without leaving pointer lock', async ({ page }) => {
  await saveAndPlaceDefaultSpell(page);
  await installPointerLockProbe(page);
  await page.getByTestId('camera-pointer-lock').click();
  await page.keyboard.press('2');
  await dispatchCapturedWorldClick(page);

  const manager = page.getByRole('dialog', { name: 'Spell Manager' });
  await expect(manager).toBeVisible();
  const unbind = manager.getByRole('button', { name: 'Unbind' });
  await expect(manager.getByTestId('spell-binding')).toContainText('Bound to');
  await moveCapturedCursorTo(page, unbind);
  await dispatchCapturedClick(page);
  await expect(manager.getByTestId('spell-binding')).toHaveText('Unbound');
  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__.pointerLock)).toMatchObject({
    locked: true,
    requested: 1,
  });
});

test('pointer-locked M2 pointerdown toggles a placed spell exactly once without contextmenu', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/dev');
  await page.getByRole('button', { name: 'Save to Spellpad' }).click();
  const cameraModeToggle = page.getByTestId('camera-mode-toggle');
  await cameraModeToggle.evaluate((button) => button.click());
  await expect(cameraModeToggle).toHaveAttribute('data-camera-mode', 'fc');
  await cameraModeToggle.evaluate((button) => button.click());
  await expect(cameraModeToggle).toHaveAttribute('data-camera-mode', 'fp');

  const canvas = page.locator('canvas.scene-canvas');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Scene canvas has no bounding box');
  const placement = { x: box.width / 2, y: box.height * 0.74 };
  await canvas.click({ button: 'right', force: true, position: placement });
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
  await expect.poll(() => page.evaluate(() => window.__WHA_SELECTED_TOOL__)).toBe('manager');
  await installPointerLockProbe(page);
  await page.getByTestId('camera-pointer-lock').click();

  const pressM2WithoutContextMenu = (pointerId) => page.evaluate((id) => {
    document.querySelector('canvas.scene-canvas').dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 2,
      buttons: 2,
      pointerId: id,
      pointerType: 'mouse',
    }));
  }, pointerId);
  const dispatchMatchingContextMenu = () => page.evaluate(() => {
    document.querySelector('canvas.scene-canvas').dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      button: 2,
    }));
  });

  await pressM2WithoutContextMenu(81);
  await expect.poll(() => page.evaluate(() => window.__WHA_PLACED_SPELLS__?.[0]?.active)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__WHA_CONTEXT_PICK_DEBUG__)).toMatchObject({
    selectedTool: 'manager',
    inputEventType: 'pointerdown',
    pointerLocked: true,
  });
  await dispatchMatchingContextMenu();
  await expect.poll(() => page.evaluate(() => window.__WHA_PLACED_SPELLS__?.[0]?.active)).toBe(true);

  await pressM2WithoutContextMenu(82);
  await expect.poll(() => page.evaluate(() => window.__WHA_PLACED_SPELLS__?.[0]?.active)).toBe(false);
  await dispatchMatchingContextMenu();
  await expect.poll(() => page.evaluate(() => window.__WHA_PLACED_SPELLS__?.[0]?.active)).toBe(false);
});

test('captured wrench M1 and M2 act on the item under the crosshair', async ({ page }) => {
  await page.goto('/dev');
  await page.getByTestId('camera-mode-toggle').click();
  await page.getByTestId('camera-mode-toggle').click();
  await expect(page.getByTestId('camera-mode-toggle')).toHaveAttribute('data-camera-mode', 'fp');
  await page.getByRole('button', { name: 'Asset Manager — inventory slot 4' }).click();
  const manager = page.getByRole('dialog', { name: 'Asset Manager' });
  await manager.getByTestId('asset-shape-cuboid').click();
  await manager.getByRole('button', { name: 'Close Asset Manager' }).click();

  const canvas = page.locator('canvas.scene-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Scene canvas has no bounding box');
  const placement = { x: box.width / 2, y: box.height * 0.74 };
  await canvas.click({ button: 'right', force: true, position: placement });
  await expect(page.getByTestId('tool-status')).toContainText('Block placed');
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

  await page.getByRole('button', { name: 'Wrench — inventory slot 3' }).click();
  await installPointerLockProbe(page);
  await page.getByTestId('camera-pointer-lock').click();
  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__.pointerLock.locked)).toBe(true);

  await page.evaluate(() => {
    const target = document.querySelector('canvas.scene-canvas');
    target.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: 1,
      clientY: 1,
      pointerId: 71,
      pointerType: 'mouse',
    }));
    target.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      button: 0,
      buttons: 0,
      clientX: 1,
      clientY: 1,
      pointerId: 71,
      pointerType: 'mouse',
    }));
  });
  const hud = page.getByTestId('wrench-hud');
  await expect(hud).toBeVisible();

  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__.pointerLock.locked)).toBe(true);
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas.scene-canvas');
    const rect = canvas.getBoundingClientRect();
    const event = new PointerEvent('pointerdown', {
      bubbles: true,
      button: 2,
      buttons: 2,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      pointerId: 72,
      pointerType: 'mouse',
    });
    Object.defineProperty(event, '__whaVirtualPointer', { value: true });
    canvas.dispatchEvent(event);
  });
  await expect.poll(() => page.evaluate(() => window.__WHA_WRENCH_PICK_DEBUG__))
    .toMatchObject({ action: 'context', target: { kind: 'asset' } });
  await expect(page.getByRole('dialog', { name: 'Remove item?' })).toBeVisible();
});

test('captured cursor continuously drives wrench gizmo resizing', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/dev');
  await page.getByRole('button', { name: 'Asset Manager — inventory slot 4' }).click();
  const manager = page.getByRole('dialog', { name: 'Asset Manager' });
  await manager.getByTestId('asset-shape-cuboid').click();
  await manager.getByRole('button', { name: 'Close Asset Manager' }).click();

  const target = await scenePoint(page);
  const visiblePlacement = {
    x: Math.max(24, target.box.width * 0.24),
    y: Math.min(target.box.height - 24, target.box.height * 0.68),
  };
  await target.canvas.click({ button: 'right', force: true, position: visiblePlacement });
  await expect(page.getByTestId('tool-status')).toContainText('Block placed');
  await page.getByRole('button', { name: 'Wrench — inventory slot 3' }).click();
  await target.canvas.click({ force: true, position: visiblePlacement });

  const hud = page.getByTestId('wrench-hud');
  await expect(hud).toBeVisible();
  await hud.getByRole('button', { name: 'Scale', exact: true }).click();
  await expect.poll(() => target.canvas.getAttribute('data-wrench-transform-operation')).toBe('scale');
  const scaleInputs = ['X', 'Y', 'Z'].map((axis) => hud.getByLabel(`Scale ${axis}`));
  const readScale = () => Promise.all(scaleInputs.map(async (input) => Number(await input.inputValue())));
  const before = await readScale();

  await expect.poll(() => page.evaluate(() => window.__WHA_PLAYER__?.inputEnabled)).toBe(true);
  await installPointerLockProbe(page);
  await page.getByTestId('camera-pointer-lock').evaluate((button) => button.click());
  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__?.pointerLock?.locked)).toBe(true);
  await expect(page.getByTestId('captured-pointer-cursor')).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(window.__WHA_VIRTUAL_CURSOR__))).toBe(true);
  const uniformHandle = await findWrenchGizmoHitRegion(page, 'XYZ', true);
  expect(uniformHandle).not.toBeNull();
  await moveCapturedCursorToPoint(page, uniformHandle);
  await expect.poll(() => page.evaluate(() => ({ cursor: window.__WHA_VIRTUAL_CURSOR__ }))).toMatchObject({
    cursor: { target: '3D spell sandbox' },
  });
  await expect.poll(() => page.evaluate(() => window.__WHA_VIRTUAL_CURSOR__.forwardedMoves)).toBeGreaterThan(0);
  await expect.poll(() => target.canvas.getAttribute('data-wrench-transform-axis')).toBe('XYZ');

  await dispatchCapturedMouseDown(page);
  await expect(target.canvas).toHaveAttribute('data-wrench-transform-latched-axis', 'XYZ');
  await expect(target.canvas).toHaveAttribute('data-wrench-transform-dragging', 'true');

  await dispatchCapturedMovement(page, 50, -40);
  await dispatchCapturedMouseUp(page);

  await expect.poll(readScale).not.toEqual(before);
  const enlarged = await readScale();
  for (let index = 0; index < enlarged.length; index += 1) {
    expect(enlarged[index]).toBeGreaterThan(before[index]);
    expect(enlarged[index] / before[index]).toBeCloseTo(enlarged[0] / before[0], 2);
  }

  const movedUniformHandle = await findWrenchGizmoHitRegion(page, 'XYZ', true);
  expect(movedUniformHandle).not.toBeNull();
  await moveCapturedCursorToPoint(page, movedUniformHandle);
  await expect.poll(() => target.canvas.getAttribute('data-wrench-transform-axis')).toBe('XYZ');
  await dispatchCapturedMouseDown(page);
  await dispatchCapturedMovement(page, -50, 40);
  await dispatchCapturedMouseUp(page);
  await expect.poll(async () => (await readScale())[0]).toBeLessThan(enlarged[0]);
  const reduced = await readScale();
  for (let index = 0; index < reduced.length; index += 1) {
    expect(reduced[index]).toBeLessThan(enlarged[index]);
    expect(reduced[index] / enlarged[index]).toBeCloseTo(reduced[0] / enlarged[0], 2);
  }
  await expect.poll(() => page.evaluate(() => window.__WHA_CAMERA_DEBUG__.pointerLock)).toMatchObject({
    locked: true,
    requested: 1,
  });
});

test('Wrench gravity toggle releases an asset immediately and keeps its inspector selected', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/dev');
  await page.getByRole('button', { name: 'Asset Manager — inventory slot 4' }).click();
  const manager = page.getByRole('dialog', { name: 'Asset Manager' });
  await manager.getByTestId('asset-shape-cuboid').click();
  await manager.getByRole('button', { name: 'Close' }).click();
  const target = await scenePoint(page);
  await target.canvas.click({ button: 'right', force: true, position: target.position });
  await page.getByRole('button', { name: 'Wrench — inventory slot 3' }).click();
  await target.canvas.click({ force: true, position: target.position });

  const hud = page.getByTestId('wrench-hud');
  const anchored = hud.getByRole('button', { name: 'Anchored', exact: true });
  const gravityAffected = hud.getByRole('button', { name: 'Gravity affected', exact: true });
  await expect(anchored).toHaveAttribute('aria-pressed', 'true');
  await hud.getByLabel('Position Y').fill('3');
  await hud.getByLabel('Position Y').press('Enter');
  await gravityAffected.click();
  await expect(gravityAffected).toHaveAttribute('aria-pressed', 'true');
  await expect(hud).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const body = Object.values(window.__WHA_MAIN_WORLD_PHYSICS__?.bodies ?? {})
      .find((item) => item.placementKind === 'asset' && item.bodyMode === 'dynamic');
    return body?.position?.y ?? 3;
  })).toBeLessThan(2.7);

  await anchored.click();
  await expect(anchored).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => Object.values(window.__WHA_MAIN_WORLD_PHYSICS__?.bodies ?? {})
    .some((item) => item.placementKind === 'asset' && item.bodyMode === 'fixed'))).toBe(true);
  await expect(hud).toBeVisible();
});

test('Wrench selects, transforms, and removes placed assets through the same item controls', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/dev');
  await page.getByRole('button', { name: 'Asset Manager — inventory slot 4' }).click();
  const manager = page.getByRole('dialog', { name: 'Asset Manager' });
  await manager.getByTestId('asset-shape-cuboid').click();
  await manager.getByRole('button', { name: 'Close' }).click();

  const target = await scenePoint(page);
  await target.canvas.click({ button: 'right', force: true, position: target.position });
  await expect(page.getByTestId('tool-status')).toContainText('Block placed');

  await page.getByRole('button', { name: 'Wrench — inventory slot 3' }).click();
  await expect.poll(() => page.evaluate(() => window.__WHA_SELECTED_TOOL__)).toBe('wrench');

  // M2 removes the targeted asset even before it is selected.
  await target.canvas.click({ button: 'right', force: true, position: target.position });
  const removeDialog = page.getByRole('dialog', { name: 'Remove item?' });
  await expect(removeDialog).toBeVisible();
  await removeDialog.getByRole('button', { name: 'Cancel' }).click();

  // M1 selects it and exposes the workshop-style transform modes and gizmo.
  await target.canvas.click({ force: true, position: target.position });
  const hud = page.getByTestId('wrench-hud');
  await expect(hud).toContainText('Asset Manager asset');
  await expect(hud.getByRole('button', { name: 'Move', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => target.canvas.getAttribute('data-wrench-transform-operation')).toBe('translate');
  await hud.getByRole('button', { name: 'Rotate', exact: true }).click();
  await expect.poll(() => target.canvas.getAttribute('data-wrench-transform-operation')).toBe('rotate');
  await hud.getByRole('button', { name: 'Scale', exact: true }).click();
  await expect.poll(() => target.canvas.getAttribute('data-wrench-transform-operation')).toBe('scale');
  await expect(target.canvas).toHaveAttribute('data-wrench-uniform-scale-handle', 'XYZ');

  const xHandle = await findWrenchGizmoHitRegion(page, 'X');
  const yHandle = await findWrenchGizmoHitRegion(page, 'Y');
  expect(xHandle).not.toBeNull();
  expect(yHandle).not.toBeNull();
  const dragState = await page.evaluate(({ start, crossing }) => {
    const canvas = document.querySelector('canvas.scene-canvas');
    const setPointerCapture = canvas.setPointerCapture;
    const releasePointerCapture = canvas.releasePointerCapture;
    canvas.setPointerCapture = () => {};
    canvas.releasePointerCapture = () => {};
    const pointer = (type, point, button) => canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      button,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: point.x,
      clientY: point.y,
      pointerId: 93,
      pointerType: 'mouse',
    }));
    pointer('pointermove', start, -1);
    pointer('pointerdown', start, 0);
    const pressed = canvas.dataset.wrenchTransformLatchedAxis;
    pointer('pointermove', crossing, -1);
    const crossed = {
      latched: canvas.dataset.wrenchTransformLatchedAxis,
      active: canvas.dataset.wrenchTransformAxis,
    };
    pointer('pointerup', crossing, 0);
    canvas.setPointerCapture = setPointerCapture;
    canvas.releasePointerCapture = releasePointerCapture;
    return { pressed, crossed };
  }, { start: xHandle, crossing: yHandle });
  expect(dragState).toEqual({ pressed: 'X', crossed: { latched: 'X', active: 'X' } });

  await hud.getByRole('button', { name: 'Remove item' }).click();
  await page.getByRole('dialog', { name: 'Remove item?' }).getByRole('button', { name: 'Remove item' }).click();
  await expect(hud).toHaveCount(0);
  await expect(target.canvas).not.toHaveAttribute('data-wrench-transform-operation');
});

test('Wrench selects every yard practice block without creating Asset Manager entries', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/dev');
  await expect.poll(
    () => page.evaluate(() => window.__WHA_MAIN_WORLD_PHYSICS__?.ready === true),
    { timeout: 20_000 },
  ).toBe(true);
  const cameraModeToggle = page.getByTestId('camera-mode-toggle');
  await cameraModeToggle.click();
  await cameraModeToggle.click();
  await expect(cameraModeToggle).toHaveAttribute('data-camera-mode', 'fp');
  await page.getByRole('button', { name: 'Wrench — inventory slot 3' }).click();

  let target = await aimFirstPersonAtPhysicsBody(page, 'prop:prop:small-practice-cube');
  await target.canvas.click({ force: true, position: target.position });
  const hud = page.getByTestId('wrench-hud');
  await expect(hud).toContainText('Small practice cube');
  await expect(hud).toContainText('Practice cube');
  await expect(hud.getByRole('button', { name: 'Gravity affected' })).toHaveAttribute('aria-pressed', 'true');
  await hud.getByRole('button', { name: 'Close wrench controls' }).click();

  target = await aimFirstPersonAtPhysicsBody(page, 'prop:prop:practice-cube');
  await target.canvas.click({ force: true, position: target.position });
  await expect(hud).toContainText('Practice cube');
  await expect(hud).not.toContainText('Small practice cube');

  target = await aimFirstPersonAtPhysicsBody(page, 'prop:field-practice-crate-0');
  await target.canvas.click({ force: true, position: target.position });
  await expect(hud).toContainText('Practice cube 2');
  const crateX = await page.evaluate(() => (
    window.__WHA_MAIN_WORLD_PHYSICS__.bodies['prop:field-practice-crate-0'].position.x
  ));
  await hud.getByLabel('Position X').fill(String(crateX - 0.5));
  await hud.getByLabel('Position X').press('Enter');
  await expect.poll(() => page.evaluate(() => (
    window.__WHA_MAIN_WORLD_PHYSICS__.bodies['prop:field-practice-crate-0'].position.x
  ))).toBeCloseTo(crateX - 0.5, 1);
  await expect.poll(() => page.evaluate(() => (
    window.__WHA_MAIN_WORLD_PHYSICS__.bodies['field-stone-0'].sleeping
  ))).toBe(true);
  const unrelatedStone = await page.evaluate(() => {
    const body = window.__WHA_MAIN_WORLD_PHYSICS__.bodies['field-stone-0'];
    return { position: body.position, rotation: body.rotation };
  });
  await hud.getByLabel('Uniform scale').fill('1.25');
  await hud.getByLabel('Uniform scale').press('Enter');
  await expect.poll(() => page.evaluate(() => (
    window.__WHA_MAIN_WORLD_PHYSICS__.bodies['prop:field-practice-crate-0'].scale
  ))).toEqual({ x: 1.25, y: 1.25, z: 1.25 });
  await expect.poll(() => page.evaluate((expected) => {
    const body = window.__WHA_MAIN_WORLD_PHYSICS__.bodies['field-stone-0'];
    const positionDelta = Math.hypot(
      body.position.x - expected.position.x,
      body.position.y - expected.position.y,
      body.position.z - expected.position.z,
    );
    const rotationDelta = Math.hypot(
      body.rotation.x - expected.rotation.x,
      body.rotation.y - expected.rotation.y,
      body.rotation.z - expected.rotation.z,
      body.rotation.w - expected.rotation.w,
    );
    return body.sleeping === true && positionDelta < 0.000001 && rotationDelta < 0.000001;
  }, unrelatedStone), { timeout: 5_000 }).toBe(true);
  await hud.getByRole('button', { name: 'Anchored', exact: true }).click();
  await expect(hud.getByRole('button', { name: 'Anchored', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => (
    window.__WHA_MAIN_WORLD_PHYSICS__.bodies['prop:field-practice-crate-0'].bodyMode
  ))).toBe('fixed');
  await expect.poll(() => page.evaluate((expected) => {
    const body = window.__WHA_MAIN_WORLD_PHYSICS__.bodies['field-stone-0'];
    return body.sleeping === true
      && Math.hypot(
        body.position.x - expected.position.x,
        body.position.y - expected.position.y,
        body.position.z - expected.position.z,
      ) < 0.000001
      && Math.hypot(
        body.rotation.x - expected.rotation.x,
        body.rotation.y - expected.rotation.y,
        body.rotation.z - expected.rotation.z,
        body.rotation.w - expected.rotation.w,
      ) < 0.000001;
  }, unrelatedStone), { timeout: 5_000 }).toBe(true);
  await hud.getByRole('button', { name: 'Gravity affected', exact: true }).click();
  await expect(hud.getByRole('button', { name: 'Gravity affected', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => (
    window.__WHA_MAIN_WORLD_PHYSICS__.bodies['prop:field-practice-crate-0'].bodyMode
  ))).toBe('dynamic');
  await expect.poll(() => page.evaluate((expected) => {
    const body = window.__WHA_MAIN_WORLD_PHYSICS__.bodies['field-stone-0'];
    return body.sleeping === true
      && Math.hypot(
        body.position.x - expected.position.x,
        body.position.y - expected.position.y,
        body.position.z - expected.position.z,
      ) < 0.000001
      && Math.hypot(
        body.rotation.x - expected.rotation.x,
        body.rotation.y - expected.rotation.y,
        body.rotation.z - expected.rotation.z,
        body.rotation.w - expected.rotation.w,
      ) < 0.000001;
  }, unrelatedStone), { timeout: 5_000 }).toBe(true);

  target = await aimFirstPersonAtPhysicsBody(page, 'prop:field-practice-crate-1');
  await target.canvas.click({ force: true, position: target.position });
  await expect(hud).toContainText('Practice cube 3');
  await target.canvas.click({ button: 'right', force: true, position: target.position });
  const removeDialog = page.getByRole('dialog', { name: 'Remove item?' });
  await expect(removeDialog).toContainText('Practice cube 3');
  await removeDialog.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Asset Manager — inventory slot 4' }).click();
  const manager = page.getByRole('dialog', { name: 'Asset Manager' });
  await expect(manager).not.toContainText('Small practice cube');
  await expect(manager).not.toContainText('Practice cube 2');
  await expect(manager).not.toContainText('Practice cube 3');
});

test('Wrench selects a practice cube through a spell anchored to its surface', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/dev');
  await expect.poll(
    () => page.evaluate(() => window.__WHA_MAIN_WORLD_PHYSICS__?.ready === true),
    { timeout: 20_000 },
  ).toBe(true);
  await page.getByRole('button', { name: 'Save to Spellpad' }).click();
  const cameraModeToggle = page.getByTestId('camera-mode-toggle');
  await cameraModeToggle.click();
  await cameraModeToggle.click();
  await expect(cameraModeToggle).toHaveAttribute('data-camera-mode', 'fp');

  let target = await aimFirstPersonAtPhysicsBody(page, 'prop:prop:practice-cube');
  await target.canvas.click({ button: 'right', force: true, position: target.position });
  await expect.poll(() => page.evaluate(() => window.__WHA_PLACED_SPELLS__?.[0]?.anchor?.surfaceTargetId))
    .toBe('prop:practice-cube');

  await page.getByRole('button', { name: 'Wrench — inventory slot 3' }).click();
  target = await aimFirstPersonAtPhysicsBody(page, 'prop:prop:practice-cube');
  await target.canvas.click({ force: true, position: target.position });
  const hud = page.getByTestId('wrench-hud');
  await expect(hud).toContainText('Practice cube');
  await expect(hud).toContainText('World transform');
  await expect(target.canvas).toHaveAttribute('data-wrench-transform-operation', 'translate');

  const beforeMove = await page.evaluate(() => ({
    cubeX: window.__WHA_MAIN_WORLD_PHYSICS__.bodies['prop:prop:practice-cube'].position.x,
    spellX: window.__WHA_PLACED_SPELL_WORLD_TRANSFORMS__['placed-spell:1'].position.x,
  }));
  await hud.getByLabel('Position X').fill(String(beforeMove.cubeX + 0.5));
  await hud.getByLabel('Position X').press('Enter');
  await expect.poll(() => page.evaluate(() => (
    window.__WHA_MAIN_WORLD_PHYSICS__.bodies['prop:prop:practice-cube'].position.x
  ))).toBeCloseTo(beforeMove.cubeX + 0.5, 1);
  await expect.poll(() => page.evaluate(() => (
    window.__WHA_PLACED_SPELL_WORLD_TRANSFORMS__['placed-spell:1'].position.x
  ))).toBeCloseTo(beforeMove.spellX + 0.5, 1);

  target = await aimFirstPersonAtPhysicsBody(page, 'prop:prop:practice-cube');
  await target.canvas.click({ button: 'right', force: true, position: target.position });
  const removeDialog = page.getByRole('dialog', { name: 'Remove item?' });
  await expect(removeDialog).toContainText('Practice cube');
  await removeDialog.getByRole('button', { name: 'Cancel' }).click();

  await hud.getByRole('button', { name: 'Close wrench controls' }).click();
  target = await aimFirstPersonAtPhysicsBody(page, 'prop:prop:small-practice-cube');
  await target.canvas.click({ force: true, position: target.position });
  await expect(hud).toContainText('Small practice cube');
});

test('adding another bound spell does not reapply an existing spell mount delta', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/dev');
  await expect.poll(
    () => page.evaluate(() => window.__WHA_MAIN_WORLD_PHYSICS__?.ready === true),
    { timeout: 20_000 },
  ).toBe(true);
  await page.getByRole('button', { name: 'Save to Spellpad' }).click();
  const cameraModeToggle = page.getByTestId('camera-mode-toggle');
  await cameraModeToggle.click();
  await cameraModeToggle.click();
  await expect(cameraModeToggle).toHaveAttribute('data-camera-mode', 'fp');

  let target = await aimFirstPersonAtPhysicsBody(page, 'prop:prop:practice-cube');
  await target.canvas.click({ button: 'right', force: true, position: target.position });
  await expect.poll(() => page.evaluate(() => window.__WHA_PLACED_SPELLS__?.length)).toBe(1);

  await page.getByRole('button', { name: 'Wrench — inventory slot 3' }).click();
  target = await aimFirstPersonAtPhysicsBody(page, 'prop:prop:practice-cube');
  await target.canvas.click({ force: true, position: target.position });
  const hud = page.getByTestId('wrench-hud');
  await expect(hud).toContainText('Practice cube');
  const cubeX = await page.evaluate(() => (
    window.__WHA_MAIN_WORLD_PHYSICS__.bodies['prop:prop:practice-cube'].position.x
  ));
  await hud.getByLabel('Position X').fill(String(cubeX + 0.5));
  await hud.getByLabel('Position X').press('Enter');
  await expect.poll(() => page.evaluate(() => (
    window.__WHA_MAIN_WORLD_PHYSICS__.bodies['prop:prop:practice-cube'].position.x
  ))).toBeCloseTo(cubeX + 0.5, 1);
  const beforeSecondPlacement = await page.evaluate(() => (
    window.__WHA_PLACED_SPELL_WORLD_TRANSFORMS__['placed-spell:1']
  ));

  await page.getByRole('button', { name: 'Spellpad — inventory slot 1' }).click();
  await page.getByRole('dialog', { name: 'Spellpad' }).getByRole('button', { name: 'Close' }).click();
  target = await aimFirstPersonAtPhysicsBody(page, 'prop:prop:practice-cube');
  await target.canvas.click({ button: 'right', force: true, position: target.position });
  await expect.poll(() => page.evaluate(() => window.__WHA_PLACED_SPELLS__?.length)).toBe(2);

  await expect.poll(() => page.evaluate((before) => {
    const after = window.__WHA_PLACED_SPELL_WORLD_TRANSFORMS__['placed-spell:1'];
    return Math.hypot(
      after.position.x - before.position.x,
      after.position.y - before.position.y,
      after.position.z - before.position.z,
    );
  }, beforeSecondPlacement)).toBeLessThan(0.01);
});

test('Spellpad and placed spells reset on refresh', async ({ page }) => {
  await saveAndPlaceDefaultSpell(page);
  await page.reload();
  await page.getByRole('button', { name: 'Spellpad — inventory slot 1' }).click({ force: true });
  const target = await scenePoint(page);
  await target.canvas.click({ force: true, position: target.position });
  await expect(page.getByRole('dialog', { name: 'Spellpad' })).toContainText('empty');
});
