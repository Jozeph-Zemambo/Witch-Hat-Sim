import { expect, test } from '@playwright/test';
import { createPressurePlateDocument } from '../src/mechanics/starterDocuments.js';

const WORKBENCH_STORAGE_KEY = 'wha-mechanics-workbench-v1';

function legacyPressurePlateDocument({ revision = 0 } = {}) {
  const document = createPressurePlateDocument();
  document.metadata.revision = revision;
  delete document.metadata.starterId;
  delete document.metadata.starterVersion;
  const frame = document.assemblies.find((assembly) => assembly.assemblyId === 'assembly:pressure-frame');
  const legacyRails = {
    'part:frame-rail-left': { size: { x: 0.22, y: 0.45, z: 2.05 }, position: { x: -1.48, y: 0.25, z: 0 } },
    'part:frame-rail-right': { size: { x: 0.22, y: 0.45, z: 2.05 }, position: { x: 1.48, y: 0.25, z: 0 } },
    'part:frame-rail-front': { size: { x: 2.55, y: 0.45, z: 0.22 }, position: { x: 0, y: 0.25, z: -1.12 } },
    'part:frame-rail-back': { size: { x: 2.55, y: 0.45, z: 0.22 }, position: { x: 0, y: 0.25, z: 1.12 } },
  };
  for (const part of frame.parts) {
    const legacy = legacyRails[part.partId];
    if (!legacy) continue;
    part.size = legacy.size;
    part.localTransform.position = legacy.position;
  }
  return document;
}

async function seedStoredDocument(page, document) {
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, { key: WORKBENCH_STORAGE_KEY, value: document });
}

async function storedPressureFrame(page) {
  return page.evaluate((key) => {
    const document = JSON.parse(window.localStorage.getItem(key));
    return {
      metadata: document.metadata,
      frame: document.assemblies.find((assembly) => assembly.assemblyId === 'assembly:pressure-frame'),
    };
  }, WORKBENCH_STORAGE_KEY);
}

async function loadStarter(page, starterId) {
  await page.getByRole('button', { name: 'Examples', exact: true }).click();
  await page.getByTestId(`mechanics-starter-${starterId}`).click();
}

async function openShapePalette(page) {
  const toolbar = page.getByRole('toolbar', { name: 'Mechanics tools' });
  await toolbar.getByRole('button', { name: 'Shapes', exact: true }).click();
}

async function openWorkshopSpellMaker(page) {
  await page.goto('/mechanics');
  await loadStarter(page, 'blank');
  await openShapePalette(page);
  await page.getByTestId('mechanics-add-plate').click();

  const toolbar = page.getByRole('toolbar', { name: 'Mechanics tools' });
  await toolbar.getByRole('button', { name: 'Spell plate', exact: true }).click();
  const mountDialog = page.getByRole('dialog', { name: 'Mount a spell plate' });
  await mountDialog.getByRole('button', { name: 'Create a spell for this plate' }).click();
  return page.getByRole('dialog', { name: 'Create spell for plate' });
}

test('assembly editor visibility controls persist, identify click-through items, and undo independently', async ({ page }) => {
  await page.goto('/mechanics');
  await loadStarter(page, 'blank');
  await openShapePalette(page);
  await page.getByRole('button', { name: 'Block', exact: true }).click();

  const opacity = page.getByRole('slider', { name: 'Block opacity' });
  const clickThrough = page.getByRole('checkbox', { name: /Click through in world/i });
  await expect(opacity).toHaveValue('1');
  await expect(clickThrough).not.toBeChecked();

  await opacity.fill('0.4');
  await expect(page.getByTestId('mechanics-canvas').locator('canvas'))
    .toHaveAttribute('data-mechanics-opacity-preview', 'assembly:assembly:1:0.4');
  await expect.poll(() => page.evaluate((key) => {
    const document = JSON.parse(window.localStorage.getItem(key));
    return document.assemblies[0].editor.opacity;
  }, WORKBENCH_STORAGE_KEY)).toBe(1);
  await opacity.blur();
  await clickThrough.check();
  await expect(page.getByTestId('mechanics-assembly-assembly:1')).toContainText('click-through');
  await expect.poll(() => page.evaluate((key) => {
    const document = JSON.parse(window.localStorage.getItem(key));
    return document.assemblies[0].editor;
  }, WORKBENCH_STORAGE_KEY)).toEqual({ opacity: 0.4, clickThrough: true });

  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('mechanics-assembly-assembly:1')).not.toContainText('click-through');
  await expect.poll(() => page.evaluate((key) => {
    const document = JSON.parse(window.localStorage.getItem(key));
    return document.assemblies[0].editor;
  }, WORKBENCH_STORAGE_KEY)).toEqual({ opacity: 0.4, clickThrough: false });

  await page.keyboard.press('Control+z');
  await expect.poll(() => page.evaluate((key) => {
    const document = JSON.parse(window.localStorage.getItem(key));
    return document.assemblies[0].editor;
  }, WORKBENCH_STORAGE_KEY)).toEqual({ opacity: 1, clickThrough: false });
});

test('relationship editor visibility controls persist, identify click-through items, and undo independently', async ({ page }) => {
  await page.goto('/mechanics');
  await loadStarter(page, 'catapult');

  const relationship = page.locator('[data-testid^="mechanics-relationship-"]').first();
  const relationshipId = (await relationship.getAttribute('data-testid')).replace('mechanics-relationship-', '');
  const readEditor = (id) => page.evaluate(({ key, mechanicId }) => {
    const document = JSON.parse(window.localStorage.getItem(key));
    const collections = ['constraints', 'forceElements', 'latches', 'sensors', 'rotationCouplings', 'spellDevices', 'gates'];
    return collections
      .flatMap((collection) => document[collection])
      .find((item) => Object.values(item).includes(mechanicId))?.editor;
  }, { key: WORKBENCH_STORAGE_KEY, mechanicId: id });
  await relationship.click();

  const opacity = page.getByRole('slider', { name: /opacity$/i });
  const clickThrough = page.getByRole('checkbox', { name: /Click through in world/i });
  await expect(opacity).toHaveValue('1');
  await opacity.fill('0.35');
  await expect(page.getByTestId('mechanics-canvas').locator('canvas'))
    .toHaveAttribute('data-mechanics-opacity-preview', `relationship:${relationshipId}:0.35`);
  await expect.poll(() => readEditor(relationshipId)).toBeUndefined();
  await opacity.blur();
  await clickThrough.check();
  await expect(relationship).toContainText('click-through');

  await expect.poll(() => readEditor(relationshipId)).toEqual({ opacity: 0.35, clickThrough: true });
  await page.keyboard.press('Control+z');
  await expect.poll(() => readEditor(relationshipId)).toEqual({ opacity: 0.35, clickThrough: false });
  await page.keyboard.press('Control+z');
  await expect.poll(() => readEditor(relationshipId)).toBeUndefined();
});

async function findGizmoHitRegion(page, axis) {
  return page.evaluate((wantedAxis) => {
    const canvas = document.querySelector('.mechanics-canvas canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const hits = [];
    for (let y = rect.top + rect.height * 0.15; y <= rect.top + rect.height * 0.85; y += 3) {
      for (let x = rect.left + rect.width * 0.15; x <= rect.left + rect.width * 0.85; x += 3) {
        canvas.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true,
          button: -1,
          clientX: x,
          clientY: y,
          pointerId: 91,
          pointerType: 'mouse',
        }));
        if (canvas.dataset.mechanicsTransformAxis === wantedAxis) hits.push({ x, y });
      }
    }
    if (hits.length === 0) return null;
    const minX = Math.min(...hits.map((hit) => hit.x));
    const maxX = Math.max(...hits.map((hit) => hit.x));
    const minY = Math.min(...hits.map((hit) => hit.y));
    const maxY = Math.max(...hits.map((hit) => hit.y));
    const positiveSideHits = hits.filter((hit) => hit.x >= maxX - Math.max(4, (maxX - minX) * 0.12));
    return {
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      positiveX: {
        x: positiveSideHits.reduce((sum, hit) => sum + hit.x, 0) / positiveSideHits.length,
        y: positiveSideHits.reduce((sum, hit) => sum + hit.y, 0) / positiveSideHits.length,
      },
    };
  }, axis);
}

async function findConnectionEndpointHit(page, side) {
  const predicted = await page.evaluate((wantedSide) => {
    const canvas = document.querySelector('.mechanics-canvas canvas');
    if (!canvas) return null;
    const points = JSON.parse(canvas.dataset.mechanicsConnectionPoints || 'null');
    if (!points?.[wantedSide]) return null;
    return {
      x: points[wantedSide].x,
      y: points[wantedSide].y,
      host: points[wantedSide].assemblyId,
    };
  }, side);
  if (!predicted) return null;
  const canvas = page.getByTestId('mechanics-canvas').locator('canvas');
  await page.mouse.move(predicted.x, predicted.y);
  if (await canvas.getAttribute('data-mechanics-connection-endpoint') === side) {
    return { ...predicted, centerHit: true };
  }
  for (let dy = -24; dy <= 24; dy += 4) {
    for (let dx = -24; dx <= 24; dx += 4) {
      await page.mouse.move(predicted.x + dx, predicted.y + dy);
      if (await canvas.getAttribute('data-mechanics-connection-endpoint') === side) {
        return {
          x: predicted.x + dx,
          y: predicted.y + dy,
          host: predicted.host,
          centerHit: false,
        };
      }
    }
  }
  return null;
}

test('opening the workbench refreshes the untouched legacy pressure plate starter', async ({ page }) => {
  await seedStoredDocument(page, legacyPressurePlateDocument());
  await page.goto('/mechanics');

  await expect.poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.documentName))
    .toBe('Light pressure plate');
  await expect.poll(async () => (await storedPressureFrame(page)).metadata)
    .toMatchObject({ starterId: 'pressure-plate', starterVersion: 3, revision: 0 });

  const initiallyRestored = await storedPressureFrame(page);
  const initialLeftRail = initiallyRestored.frame.parts.find((part) => part.partId === 'part:frame-rail-left');
  expect(initialLeftRail.size).toEqual({ x: 0.22, y: 1.22, z: 2.46 });
  expect(initialLeftRail.localTransform.position).toEqual({ x: -1.48, y: 0.31, z: 0 });

  await loadStarter(page, 'pressure-plate');
  const explicitlyLoaded = await storedPressureFrame(page);
  expect(explicitlyLoaded.frame.parts).toEqual(initiallyRestored.frame.parts);
});

test('opening the workbench preserves a user-edited legacy pressure plate', async ({ page }) => {
  await seedStoredDocument(page, legacyPressurePlateDocument({ revision: 1 }));
  await page.goto('/mechanics');

  await expect.poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.documentName))
    .toBe('Light pressure plate');
  const restored = await storedPressureFrame(page);
  const leftRail = restored.frame.parts.find((part) => part.partId === 'part:frame-rail-left');
  expect(restored.metadata).toMatchObject({ revision: 1 });
  expect(restored.metadata.starterId).toBeUndefined();
  expect(leftRail.size).toEqual({ x: 0.22, y: 0.45, z: 2.05 });
});

test('mechanics workbench loads a real Rapier scene and exposes the core build tools', async ({ page }) => {
  await page.goto('/mechanics');

  await expect(page.getByRole('heading', { name: 'Mechanics Workbench' })).toBeVisible();
  await expect(page.getByTestId('mechanics-canvas')).toBeVisible();
  await expect(page.getByRole('toolbar', { name: 'Mechanics tools' })).toBeVisible();
  await expect(page.getByTestId('mechanics-mode-build')).toHaveAttribute('aria-pressed', 'true');
  // The Move/Rotate/Scale switch lives on the Modify tool.
  await page
    .getByRole('toolbar', { name: 'Mechanics tools' })
    .getByRole('button', { name: 'Modify', exact: true })
    .click();
  await page.getByRole('button', { name: 'Rotate E', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Rotate E', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Scale R', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Scale R', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('w');
  await expect(page.getByRole('button', { name: 'Move W', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect
    .poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__))
    .toMatchObject({
      mode: 'build',
      rapierReady: true,
      documentName: 'Wind gear drive',
      bodyCount: 6,
      assemblyBodyCount: 5,
      groundBodyCount: 1,
      jointCount: 3,
      activeSpellDevices: ['spell-device:wind-drive'],
    });
});

test('player can add primitive shapes, select several, and glue them into one compound body', async ({ page }) => {
  await page.goto('/mechanics');
  await loadStarter(page, 'blank');
  await openShapePalette(page);

  await page.getByTestId('mechanics-add-cuboid').click();
  await page.getByTestId('mechanics-add-sphere').click();
  await page.getByTestId('mechanics-assembly-assembly:1').click();
  await page.getByTestId('mechanics-assembly-assembly:2').click({ modifiers: ['Shift'] });

  const toolbar = page.getByRole('toolbar', { name: 'Mechanics tools' });
  await toolbar.getByRole('button', { name: 'Glue', exact: true }).click();
  await expect(page.getByTestId('mechanics-glue')).toBeEnabled();
  await page.getByTestId('mechanics-glue').click();

  await expect(page.getByTestId('mechanics-status')).toContainText('Shapes glued');
  await expect(page.getByTestId('mechanics-assembly-assembly:1')).toContainText('2 shapes');
  await expect
    .poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.bodyCount))
    .toBe(2);
  await expect.poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.groundBodyCount)).toBe(1);

  await page.getByRole('button', { name: 'Undo build action', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.bodyCount)).toBe(3);
  await page.getByRole('button', { name: 'Redo build action', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.bodyCount)).toBe(2);
});

test('nested assembly tree preserves levels and separates preview from inspector focus', async ({ page }) => {
  await page.goto('/mechanics');
  await loadStarter(page, 'blank');
  await openShapePalette(page);
  await page.getByTestId('mechanics-add-cuboid').click();
  await expect(page.getByRole('button', { name: 'Expand Block' })).toHaveCount(0);
  await page.getByTestId('mechanics-add-sphere').click();
  await page.getByTestId('mechanics-assembly-assembly:1').click();
  await page.getByTestId('mechanics-assembly-assembly:2').click({ modifiers: ['Shift'] });
  await page
    .getByRole('toolbar', { name: 'Mechanics tools' })
    .getByRole('button', { name: 'Glue', exact: true })
    .click();
  await page.getByTestId('mechanics-glue').click();

  const rootDisclosure = page.getByRole('button', { name: 'Expand 2-part assembly' });
  await expect(rootDisclosure).toHaveAttribute('aria-expanded', 'false');
  await page.getByTestId('mechanics-assembly-assembly:1').click();
  await expect(rootDisclosure).toHaveAttribute('aria-expanded', 'false');

  await openShapePalette(page);
  await page.getByTestId('mechanics-add-wedge').click();
  await page.getByTestId('mechanics-assembly-assembly:1').click();
  await page.getByTestId('mechanics-assembly-assembly:2').click({ modifiers: ['Shift'] });
  await page
    .getByRole('toolbar', { name: 'Mechanics tools' })
    .getByRole('button', { name: 'Glue', exact: true })
    .click();
  await page.getByTestId('mechanics-glue').click();

  await page.getByRole('button', { name: 'Expand 2-part assembly' }).click();
  await page.getByRole('button', { name: 'Expand 2-part assembly' }).click();
  await expect(page.getByTestId(/mechanics-node-/).filter({ hasText: 'Block' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Expand Block' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Expand Sphere' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Collapse 2-part assembly' }).first().click();

  const contents = page.getByRole('group', { name: 'Contents' });
  const assemblyPreview = contents.locator('.mechanics-content-preview').filter({ hasText: '2-part assembly' });
  await expect(assemblyPreview).toBeVisible();
  await expect(contents.locator('.mechanics-content-preview').filter({ hasText: 'Wedge' })).toBeVisible();
  await expect(contents.locator('.mechanics-content-preview').filter({ hasText: 'Block' })).toHaveCount(0);

  await assemblyPreview.click();
  const canvas = page.getByTestId('mechanics-canvas').locator('canvas');
  const previewNode = await canvas.getAttribute('data-mechanics-preview-node');
  expect(previewNode).toBeTruthy();
  await expect(canvas).toHaveAttribute('data-mechanics-focused-node', 'assembly:1');

  await contents.getByRole('button', { name: 'Inspect 2-part assembly' }).click();
  await expect(canvas).toHaveAttribute('data-mechanics-preview-node', '');
  await expect(canvas).toHaveAttribute('data-mechanics-focused-node', previewNode);
  await expect(page.getByRole('button', { name: 'Expand 2-part assembly' }).first()).toHaveAttribute('aria-expanded', 'false');
  const nestedContents = page.getByRole('group', { name: 'Contents' });
  await expect(nestedContents.locator('.mechanics-content-preview').filter({ hasText: 'Block' })).toBeVisible();
  await expect(nestedContents.locator('.mechanics-content-preview').filter({ hasText: 'Sphere' })).toBeVisible();

  await nestedContents.getByRole('button', { name: 'Inspect Sphere' }).click();
  await expect(page.getByRole('group', { name: 'Position in parent' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Contents' })).toHaveCount(0);
  const size = page.getByRole('group', { name: 'Size' });
  await size.getByRole('spinbutton', { name: 'X' }).fill('1.1');
  await size.getByRole('spinbutton', { name: 'X' }).press('Enter');
  await expect(size.getByRole('spinbutton', { name: 'X' })).toHaveValue('1.10');
});

test('shape tool previews and places a grid-snapped primitive directly in the scene', async ({ page }) => {
  await page.goto('/mechanics');
  await loadStarter(page, 'blank');
  await openShapePalette(page);
  await page.getByTestId('mechanics-add-cuboid').click();

  const canvas = page.getByTestId('mechanics-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Mechanics canvas has no bounding box');
  await canvas.hover({ position: { x: box.width * 0.55, y: box.height * 0.6 } });
  await canvas.click({ position: { x: box.width * 0.55, y: box.height * 0.6 } });

  await expect(page.getByTestId('mechanics-assembly-assembly:2')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.bodyCount))
    .toBe(3);
  await expect.poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.groundBodyCount)).toBe(1);
});

test('holding a placement tool to orbit places neither shapes nor cogwheels', async ({ page }) => {
  await page.goto('/mechanics');
  await loadStarter(page, 'blank');
  await openShapePalette(page);
  await page.getByTestId('mechanics-add-cuboid').click();

  const canvas = page.getByTestId('mechanics-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Mechanics canvas has no bounding box');
  const start = {
    x: box.x + box.width * 0.55,
    y: box.y + box.height * 0.6,
  };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 36, start.y + 18, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId('mechanics-assembly-assembly:2')).toHaveCount(0);

  await canvas.click({ position: { x: box.width * 0.55, y: box.height * 0.6 } });
  await expect(page.getByTestId('mechanics-assembly-assembly:2')).toBeVisible();

  await page
    .getByRole('toolbar', { name: 'Mechanics tools' })
    .getByRole('button', { name: 'Cogs', exact: true })
    .click();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 32, start.y + 20, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId('mechanics-assembly-assembly:3')).toHaveCount(0);

  await canvas.click({ position: { x: box.width * 0.55, y: box.height * 0.6 } });
  await expect(page.getByTestId('mechanics-assembly-assembly:3')).toBeVisible();
});

test('scene gizmo moves normally, resizes with Shift, and preserves camera drag', async ({ page }) => {
  await page.goto('/mechanics');
  await loadStarter(page, 'blank');
  await openShapePalette(page);
  await page.getByTestId('mechanics-add-cuboid').click();
  // The gizmo belongs to the Modify tool: Select is inspect-only and
  // placement tools keep assembly clicks for surface placement.
  await page
    .getByRole('toolbar', { name: 'Mechanics tools' })
    .getByRole('button', { name: 'Modify', exact: true })
    .click();

  const canvas = page.getByTestId('mechanics-canvas');
  await expect
    .poll(() => canvas.locator('canvas').getAttribute('data-mechanics-transform-dragging'))
    .toBe('false');

  const readAxes = async (groupName) => {
    const group = page.getByRole('group', { name: groupName });
    const inputs = Object.fromEntries(
      ['X', 'Y', 'Z'].map((axis) => [axis, group.getByRole('spinbutton', { name: axis })]),
    );
    return Object.fromEntries(
    await Promise.all(
      Object.entries(inputs).map(async ([axis, input]) => [axis, Number(await input.inputValue())]),
    ),
    );
  };
  const focusRoot = async () => {
    await page.getByTestId('mechanics-assembly-assembly:1').click();
    await expect(page.getByRole('group', { name: 'World position' })).toBeVisible();
  };
  const readShapeSize = async () => {
    const size = await readAxes('Size');
    return size;
  };

  const beforeMove = await readAxes('World position');
  const sizeBeforeMove = await readShapeSize();
  const moveHandle = await findGizmoHitRegion(page, 'X');
  expect(moveHandle).not.toBeNull();
  await page.mouse.move(moveHandle.positiveX.x, moveHandle.positiveX.y);
  await page.mouse.down();
  await page.mouse.move(moveHandle.positiveX.x + 45, moveHandle.positiveX.y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await readAxes('World position')).X).not.toBeCloseTo(beforeMove.X, 1);
  expect((await readShapeSize()).X).toBeCloseTo(sizeBeforeMove.X, 2);
  await expect.poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.bodyCount)).toBe(2);
  await expect.poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.groundBodyCount)).toBe(1);
  await expect(page.getByTestId('mechanics-assembly-assembly:1')).toHaveAttribute('aria-pressed', 'true');

  const beforeAxisResizePosition = await readAxes('World position');
  const beforeAxisResize = await readShapeSize();
  await page.keyboard.down('Shift');
  await expect(canvas.locator('canvas')).toHaveAttribute('data-mechanics-transform-operation', 'scale');
  const axisResizeHandle = await findGizmoHitRegion(page, 'X');
  expect(axisResizeHandle).not.toBeNull();
  await page.mouse.move(axisResizeHandle.positiveX.x, axisResizeHandle.positiveX.y);
  await expect(canvas.locator('canvas')).toHaveAttribute('data-mechanics-transform-axis', 'X');
  await page.mouse.down();
  await expect(canvas.locator('canvas')).toHaveAttribute('data-mechanics-transform-dragging', 'true');
  await page.mouse.move(axisResizeHandle.positiveX.x + 24, axisResizeHandle.positiveX.y, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect.poll(async () => Math.abs((await readShapeSize()).X - beforeAxisResize.X))
    .toBeGreaterThan(0.05);
  const afterAxisResize = await readShapeSize();
  expect(afterAxisResize.X).not.toBeCloseTo(beforeAxisResize.X, 1);
  expect(afterAxisResize.Y).toBeCloseTo(beforeAxisResize.Y, 2);
  expect(afterAxisResize.Z).toBeCloseTo(beforeAxisResize.Z, 2);
  expect((await readAxes('World position')).X).toBeCloseTo(beforeAxisResizePosition.X, 2);
  await expect(canvas.locator('canvas')).toHaveAttribute('data-mechanics-transform-operation', 'translate');

  const beforePlaneMove = await readAxes('World position');
  const sizeBeforePlaneMove = await readShapeSize();
  const planeMoveHandle = await findGizmoHitRegion(page, 'XY');
  expect(planeMoveHandle).not.toBeNull();
  await page.mouse.move(planeMoveHandle.center.x, planeMoveHandle.center.y);
  await page.mouse.down();
  await page.mouse.move(planeMoveHandle.center.x + 22, planeMoveHandle.center.y - 20, { steps: 10 });
  await page.mouse.up();
  const afterPlaneMove = await readAxes('World position');
  expect(afterPlaneMove.X).not.toBeCloseTo(beforePlaneMove.X, 1);
  expect(afterPlaneMove.Y).not.toBeCloseTo(beforePlaneMove.Y, 1);
  expect(afterPlaneMove.Z).toBeCloseTo(beforePlaneMove.Z, 2);
  expect((await readShapeSize()).X).toBeCloseTo(sizeBeforePlaneMove.X, 2);

  const beforePlaneResizePosition = await readAxes('World position');
  const beforePlaneResize = await readShapeSize();
  await page.keyboard.down('Shift');
  await expect(canvas.locator('canvas')).toHaveAttribute('data-mechanics-transform-operation', 'scale');
  const planeResizeHandle = await findGizmoHitRegion(page, 'XY');
  expect(planeResizeHandle).not.toBeNull();
  await page.mouse.move(planeResizeHandle.center.x, planeResizeHandle.center.y);
  await expect(canvas.locator('canvas')).toHaveAttribute('data-mechanics-transform-axis', 'XY');
  await page.mouse.down();
  await expect(canvas.locator('canvas')).toHaveAttribute('data-mechanics-transform-dragging', 'true');
  await page.mouse.move(planeResizeHandle.center.x + 20, planeResizeHandle.center.y - 16, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect.poll(async () => {
    const size = await readShapeSize();
    return Math.min(
      Math.abs(size.X - beforePlaneResize.X),
      Math.abs(size.Y - beforePlaneResize.Y),
    );
  }).toBeGreaterThan(0.05);
  const afterPlaneResize = await readShapeSize();
  expect(afterPlaneResize.X).not.toBeCloseTo(beforePlaneResize.X, 1);
  expect(afterPlaneResize.Y).not.toBeCloseTo(beforePlaneResize.Y, 1);
  expect(afterPlaneResize.Z).toBeCloseTo(beforePlaneResize.Z, 2);
  const afterPlaneResizePosition = await readAxes('World position');
  expect(afterPlaneResizePosition.X).toBeCloseTo(beforePlaneResizePosition.X, 2);
  expect(afterPlaneResizePosition.Y).toBeCloseTo(beforePlaneResizePosition.Y, 2);
  await expect(canvas.locator('canvas')).toHaveAttribute('data-mechanics-transform-dragging', 'false');

  const cameraBefore = await page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.camera?.position);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Mechanics canvas has no bounding box');
  const orbitStart = { x: box.x + box.width * 0.84, y: box.y + box.height * 0.78 };
  await page.mouse.move(orbitStart.x, orbitStart.y);
  await page.mouse.down();
  await page.mouse.move(orbitStart.x - 70, orbitStart.y, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate((before) => {
      const after = window.__WHA_MECHANICS_DEBUG__?.camera?.position;
      if (!before || !after) return 0;
      return Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
    }, cameraBefore))
    .toBeGreaterThan(0.1);
});

test('scale gizmo latches its pressed handle and exposes proportional XYZ scaling', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/mechanics');
  await loadStarter(page, 'blank');
  await openShapePalette(page);
  await page.getByTestId('mechanics-add-cuboid').click();
  await page
    .getByRole('toolbar', { name: 'Mechanics tools' })
    .getByRole('button', { name: 'Modify', exact: true })
    .click();
  await page.getByRole('group', { name: 'Transform tool' }).getByRole('button', { name: /Scale/ }).click();

  const canvas = page.getByTestId('mechanics-canvas').locator('canvas');
  await expect(canvas).toHaveAttribute('data-mechanics-uniform-scale-handle', 'XYZ');
  const xHandle = await findGizmoHitRegion(page, 'X');
  const yHandle = await findGizmoHitRegion(page, 'Y');
  expect(xHandle).not.toBeNull();
  expect(yHandle).not.toBeNull();

  await page.mouse.move(xHandle.positiveX.x, xHandle.positiveX.y);
  await page.mouse.down();
  await expect(canvas).toHaveAttribute('data-mechanics-transform-latched-axis', 'X');
  await page.mouse.move(yHandle.center.x, yHandle.center.y, { steps: 8 });
  await expect(canvas).toHaveAttribute('data-mechanics-transform-latched-axis', 'X');
  await expect(canvas).toHaveAttribute('data-mechanics-transform-axis', 'X');
  await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-mechanics-transform-latched-axis', '');

  // Reset the fixture, then use the center cube. Every dimension must receive
  // the same multiplier so the cuboid keeps its proportions.
  await loadStarter(page, 'blank');
  await openShapePalette(page);
  await page.getByTestId('mechanics-add-cuboid').click();
  await page
    .getByRole('toolbar', { name: 'Mechanics tools' })
    .getByRole('button', { name: 'Modify', exact: true })
    .click();
  await page.getByRole('group', { name: 'Transform tool' }).getByRole('button', { name: /Scale/ }).click();

  const readSize = async () => {
    const group = page.getByRole('group', { name: 'Size' });
    return Promise.all(['X', 'Y', 'Z'].map(async (axis) => Number(await group.getByRole('spinbutton', { name: axis }).inputValue())));
  };
  const before = await readSize();
  const uniformHandle = await findGizmoHitRegion(page, 'XYZ');
  expect(uniformHandle).not.toBeNull();
  await page.mouse.move(uniformHandle.center.x, uniformHandle.center.y);
  await page.mouse.down();
  await expect(canvas).toHaveAttribute('data-mechanics-transform-latched-axis', 'XYZ');
  await page.mouse.move(uniformHandle.center.x + 30, uniformHandle.center.y - 24, { steps: 10 });
  await page.mouse.up();
  const after = await readSize();
  const factors = after.map((value, index) => value / before[index]);
  expect(factors[0]).not.toBeCloseTo(1, 1);
  expect(factors[1]).toBeCloseTo(factors[0], 2);
  expect(factors[2]).toBeCloseTo(factors[0], 2);
});

test('material choice updates the live body mass shown by Rapier', async ({ page }) => {
  await page.goto('/mechanics');
  await loadStarter(page, 'blank');
  await openShapePalette(page);
  await page.getByTestId('mechanics-add-cuboid').click();
  await expect
    .poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.assemblies?.['assembly:1']?.mass))
    .toBeGreaterThan(0);
  const before = await page.evaluate(() => window.__WHA_MECHANICS_DEBUG__.assemblies['assembly:1'].mass);

  await page.getByLabel(/Material for all shapes/).selectOption('material.iron');
  await expect
    .poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.assemblies?.['assembly:1']?.mass))
    .toBeGreaterThan(before * 7);
});

test('joint setup modal creates a real Rapier hinge between selected assemblies', async ({ page }) => {
  await page.goto('/mechanics');
  await loadStarter(page, 'blank');
  await openShapePalette(page);
  await page.getByTestId('mechanics-add-cuboid').click();
  await page.getByTestId('mechanics-add-beam').click();
  await page.getByTestId('mechanics-assembly-assembly:1').click();
  await page.getByTestId('mechanics-assembly-assembly:2').click({ modifiers: ['Shift'] });

  const toolbar = page.getByRole('toolbar', { name: 'Mechanics tools' });
  await toolbar.getByRole('button', { name: 'Joints', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect with a joint' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Connect joint', exact: true }).click();

  await expect(page.getByTestId('mechanics-relationship-constraint:1')).toContainText('Hinge');
  await expect
    .poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.jointCount))
    .toBe(1);

  await page.getByRole('toolbar', { name: 'Mechanics tools' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByTestId('mechanics-confirm-delete').click();
  await expect.poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.jointCount)).toBe(0);
  await page.getByRole('button', { name: 'Undo build action', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.jointCount)).toBe(1);
});

test('manual spell plate closes through the mechanical-completer lifecycle in Test mode', async ({ page }) => {
  await page.goto('/mechanics');
  await loadStarter(page, 'blank');
  await openShapePalette(page);
  await page.getByTestId('mechanics-add-plate').click();

  const toolbar = page.getByRole('toolbar', { name: 'Mechanics tools' });
  await toolbar.getByRole('button', { name: 'Spell plate', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Mount a spell plate' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Mount spell plate', exact: true }).click();

  await page.getByTestId('mechanics-mode-test').click();
  const manualKey = page.getByTestId('mechanics-manual-spell-spell-device:1');
  await expect(manualKey).toBeVisible();
  await manualKey.click();

  await expect
    .poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.activeSpellDevices))
    .toEqual(['spell-device:1']);
});

test('workbench spell maker selects a core sigil when its artwork is clicked', async ({ page }) => {
  const maker = await openWorkshopSpellMaker(page);
  const fireRadio = maker.getByRole('radio', { name: 'Fire' });
  const fireArtwork = maker.locator('svg[data-glyph-id="sigil.fire"]');

  await expect(fireRadio).not.toBeChecked();
  await expect(fireArtwork).toBeVisible();
  const artworkBox = await fireArtwork.boundingBox();
  if (!artworkBox) throw new Error('Fire sigil artwork has no bounding box.');
  // Click the visible artwork coordinates rather than the text or radio. The
  // glyph itself is intentionally pointer-transparent so Safari resolves the
  // hit on the enclosing label.
  await page.mouse.click(artworkBox.x + artworkBox.width / 2, artworkBox.y + artworkBox.height / 2);
  await expect(fireRadio).toBeChecked();
});

test('workbench spell maker keeps the enabled Save spell label readable', async ({ page }) => {
  const maker = await openWorkshopSpellMaker(page);
  const saveButton = maker.getByRole('button', { name: 'Save spell', exact: true });
  await expect(saveButton).toBeEnabled();

  const contrast = await saveButton.evaluate((button) => {
    const parseColor = (value) => {
      const match = value.match(/^rgba?\(([^)]+)\)$/);
      if (!match) return null;
      const channels = match[1].split(',').map((channel) => Number.parseFloat(channel.trim()));
      return {
        r: channels[0],
        g: channels[1],
        b: channels[2],
        a: channels[3] ?? 1,
      };
    };
    const composite = (foreground, background, opacity = 1) => {
      const alpha = (foreground.a ?? 1) * opacity;
      return {
        r: foreground.r * alpha + background.r * (1 - alpha),
        g: foreground.g * alpha + background.g * (1 - alpha),
        b: foreground.b * alpha + background.b * (1 - alpha),
      };
    };
    const luminance = (color) => {
      const channels = [color.r, color.g, color.b].map((channel) => channel / 255).map((channel) => (
        channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      ));
      return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
    };
    const ratio = (first, second) => {
      const firstLuminance = luminance(first);
      const secondLuminance = luminance(second);
      return (Math.max(firstLuminance, secondLuminance) + 0.05)
        / (Math.min(firstLuminance, secondLuminance) + 0.05);
    };

    const style = getComputedStyle(button);
    const foreground = parseColor(style.color);
    const background = parseColor(style.backgroundColor);
    let surface = null;
    for (let ancestor = button.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const candidate = parseColor(getComputedStyle(ancestor).backgroundColor);
      if (candidate && candidate.a > 0) {
        surface = candidate;
        break;
      }
    }
    if (!foreground || !background || !surface) {
      throw new Error('Could not resolve the Save spell button colors.');
    }

    const opacity = Number.parseFloat(style.opacity);
    return {
      ratio: ratio(
        composite(foreground, surface, opacity),
        composite(background, surface, opacity),
      ),
      color: style.color,
      backgroundColor: style.backgroundColor,
      opacity: style.opacity,
    };
  });

  expect(contrast.ratio).toBeGreaterThanOrEqual(4.5);
});

test('mounted Wind Pull uses the compiled spell to apply force to a real target body', async ({ page }) => {
  await page.goto('/mechanics');
  await loadStarter(page, 'blank');
  await openShapePalette(page);
  await page.getByTestId('mechanics-add-plate').click();
  await page.getByTestId('mechanics-add-cuboid').click();
  await page.getByTestId('mechanics-assembly-assembly:1').click();

  const toolbar = page.getByRole('toolbar', { name: 'Mechanics tools' });
  await toolbar.getByRole('button', { name: 'Spell plate', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Mount a spell plate' });
  await dialog.getByLabel('Prepared spell').selectOption('wind-pull');
  await expect(dialog.getByText(/Pulls the nearest compatible movable assembly/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Mount spell plate', exact: true }).click();

  await page.getByTestId('mechanics-mode-test').click();
  await page.getByTestId('mechanics-manual-spell-spell-device:1').click();
  await expect
    .poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.forceApplicationCount ?? 0))
    .toBeGreaterThan(0);
});

test('spring catapult releases from its contact trigger and runs under gravity', async ({ page }) => {
  await page.goto('/mechanics');
  await loadStarter(page, 'catapult');
  await page.getByTestId('mechanics-mode-test').click();

  await expect
    .poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.latches?.['latch:catapult']?.state))
    .toBe('released');
  await expect(page.getByRole('button', { name: 'Re-arm Arm catch', exact: true })).toBeVisible();
  // The stone must actually be hurled — a real arc, well above the machine.
  await expect
    .poll(
      () =>
        page.evaluate(
          () => window.__WHA_MECHANICS_DEBUG__?.assemblies?.['assembly:catapult-stone']?.position?.y ?? 0,
        ),
      { timeout: 15000 },
    )
    .toBeGreaterThan(2.5);
});

test('reset restores the last Build transform after a live physics test', async ({ page }) => {
  await page.goto('/mechanics');
  await loadStarter(page, 'blank');
  await openShapePalette(page);
  await page.getByTestId('mechanics-add-cuboid').click();
  const worldPosition = page.getByRole('group', { name: 'World position' });
  await worldPosition.getByRole('spinbutton', { name: 'Y' }).fill('4');
  await worldPosition.getByRole('spinbutton', { name: 'Y' }).press('Enter');

  await page.getByTestId('mechanics-mode-test').click();
  await expect
    .poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.assemblies?.['assembly:1']?.position?.y))
    .toBeLessThan(3.5);
  await page.getByRole('button', { name: 'Reset test', exact: true }).click();
  await expect(page.getByTestId('mechanics-mode-build')).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.assemblies?.['assembly:1']?.position?.y))
    .toBeCloseTo(4, 2);
});

test('gated wind spell applies physical force and drives the gear fixture', async ({ page }) => {
  await page.goto('/mechanics');
  await loadStarter(page, 'wind-gears');
  await page.getByTestId('mechanics-mode-test').click();

  await expect
    .poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.gates?.['gate:wind-key']?.closed))
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.forceApplicationCount ?? 0))
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.rotationCouplings?.['coupling:wind-output']))
    .toBeTruthy();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const input = window.__WHA_MECHANICS_DEBUG__?.assemblies?.['assembly:wind-wheel'];
        const output = window.__WHA_MECHANICS_DEBUG__?.assemblies?.['assembly:output-gear'];
        if (!input || !output) return false;
        const inputSpeed = input.angularVelocity?.x ?? 0;
        const outputSpeed = output.angularVelocity?.x ?? 0;
        return Math.abs(inputSpeed) > 0.01 && Math.abs(outputSpeed) > 0.01 && inputSpeed * outputSpeed < 0;
      }),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const rotation =
          window.__WHA_MECHANICS_DEBUG__?.assemblies?.['assembly:output-gear']?.rotation;
        if (!rotation) return 0;
        return Math.hypot(rotation.x, rotation.y, rotation.z);
      }),
    )
    .toBeGreaterThan(0.002);
});

test('one camshaft sequences three independently mounted water spell gates', async ({ page }) => {
  await page.goto('/mechanics');
  await loadStarter(page, 'cam-waterer');
  await page.getByTestId('mechanics-mode-test').click();

  await expect
    .poll(() => page.evaluate(() => Object.keys(window.__WHA_MECHANICS_DEBUG__?.gates ?? {}).length))
    .toBe(3);
  await expect
    .poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.activeSpellDevices?.length ?? 0))
    .toBe(1);
  await expect
    .poll(() => page.evaluate(() => (
      window.__WHA_SIM_MOUNTED_SPELL_OUTPUTS__?.mechanics?.intents
        ?.some((intent) => intent.intentType === 'water_column' && intent.materialKind === 'water')
      ?? false
    )))
    .toBe(true);
});

test('personal blueprint modal saves and reloads builds locally', async ({ page }) => {
  await page.goto('/mechanics');
  await loadStarter(page, 'blank');
  await openShapePalette(page);
  await page.getByTestId('mechanics-add-wheel').click();
  const wheelOpacity = page.getByRole('slider', { name: 'Wheel opacity' });
  await wheelOpacity.fill('0.4');
  await wheelOpacity.blur();

  await page.getByRole('button', { name: 'Save / load', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Personal blueprints' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('mechanics-appearance-check')).toContainText('1 assembly uses custom opacity');
  await dialog.getByLabel('Blueprint name').fill('My wheel test');
  await dialog.getByRole('button', { name: 'Save current build', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /My wheel test 1 assemblies.*1 assembly uses custom opacity/ })).toBeVisible();

  await dialog.getByRole('button', { name: 'Close Personal blueprints' }).click();
  await page.getByTestId('mechanics-add-cuboid').click();
  await expect(page.getByTestId('mechanics-assembly-assembly:2')).toBeVisible();
  await page.getByRole('button', { name: 'Save / load', exact: true }).click();
  await page.getByRole('dialog', { name: 'Personal blueprints' }).getByRole('button', {
    name: /My wheel test 1 assemblies.*1 assembly uses custom opacity/,
  }).click();
  await expect(page.getByTestId('mechanics-assembly-assembly:1')).toBeVisible();
  await expect(page.getByTestId('mechanics-assembly-assembly:2')).toHaveCount(0);
  await expect(page.getByTestId('mechanics-status')).toContainText('1 assembly uses custom opacity restored');
  await page.getByTestId('mechanics-assembly-assembly:1').click();
  await expect(page.getByRole('slider', { name: 'Wheel opacity' })).toHaveValue('0.4');
});

test('spring and trigger modals create reusable physical relationships', async ({ page }) => {
  await page.goto('/mechanics');
  await loadStarter(page, 'blank');
  await openShapePalette(page);
  await page.getByTestId('mechanics-add-cuboid').click();
  await page.getByTestId('mechanics-add-beam').click();
  await page.getByTestId('mechanics-assembly-assembly:1').click();
  await page.getByTestId('mechanics-assembly-assembly:2').click({ modifiers: ['Shift'] });

  const toolbar = page.getByRole('toolbar', { name: 'Mechanics tools' });
  await toolbar.getByRole('button', { name: 'Springs', exact: true }).click();
  const springDialog = page.getByRole('dialog', { name: 'Add a spring' });
  await springDialog.getByRole('button', { name: 'Add spring', exact: true }).click();
  await expect(page.getByTestId('mechanics-relationship-spring:1')).toContainText('Linear spring');

  await toolbar.getByRole('button', { name: 'Triggers', exact: true }).click();
  const triggerDialog = page.getByRole('dialog', { name: 'Add a trigger or latch' });
  await triggerDialog.getByRole('button', { name: 'Add trigger', exact: true }).click();
  await expect(page.getByTestId('mechanics-relationship-sensor:1')).toContainText('Contact trigger');

  await toolbar.getByRole('button', { name: 'Triggers', exact: true }).click();
  const latchDialog = page.getByRole('dialog', { name: 'Add a trigger or latch' });
  await latchDialog.getByRole('button', { name: 'Latch', exact: true }).click();
  await latchDialog.getByLabel('Release trigger (optional)').selectOption('sensor:1');
  await latchDialog.getByRole('button', { name: 'Add latch', exact: true }).click();
  await expect(page.getByTestId('mechanics-relationship-latch:1')).toContainText('Catch latch');
});

test('inspector fine-tunes whole-assembly rotation and scale; Ctrl summons the rotation rings', async ({ page }) => {
  await page.goto('/mechanics');
  await loadStarter(page, 'blank');
  await openShapePalette(page);
  await page.getByTestId('mechanics-add-cuboid').click();

  // Whole-assembly rotation in fine degrees from the inspector.
  const rotationGroup = page.getByRole('group', { name: 'Rotation (degrees)' });
  await rotationGroup.getByRole('spinbutton', { name: 'Y' }).fill('45');
  await rotationGroup.getByRole('spinbutton', { name: 'Y' }).press('Enter');
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__WHA_MECHANICS_DEBUG__?.assemblies?.['assembly:1']?.rotation?.y ?? 0,
      ),
    )
    .toBeGreaterThan(0.35); // quaternion y for a 45° yaw ≈ 0.38

  // Whole-assembly resize: ×1.5 multiplies every shape dimension.
  await page.getByRole('spinbutton', { name: 'Scale factor' }).fill('1.5');
  await page.getByRole('button', { name: /Apply ×/ }).click();
  const sizeGroup = page.getByRole('group', { name: 'Size' });
  await expect(sizeGroup.getByRole('spinbutton', { name: 'X' })).toHaveValue('1.20');

  // In Modify, holding Ctrl swaps the gizmo to the rotation rings.
  await page
    .getByRole('toolbar', { name: 'Mechanics tools' })
    .getByRole('button', { name: 'Modify', exact: true })
    .click();
  const canvas = page.getByTestId('mechanics-canvas').locator('canvas');
  await expect.poll(() => canvas.getAttribute('data-mechanics-transform-operation')).toBe('translate');
  await page.keyboard.down('Control');
  await expect.poll(() => canvas.getAttribute('data-mechanics-transform-operation')).toBe('rotate');
  await expect(canvas).toHaveAttribute('data-mechanics-transform-modifier', 'rotate');
  await page.keyboard.up('Control');
  await expect.poll(() => canvas.getAttribute('data-mechanics-transform-operation')).toBe('translate');
});

async function hoverPlacementSurface(page, assemblyId) {
  return page.evaluate((wanted) => {
    const canvas = document.querySelector('.mechanics-canvas canvas');
    if (!canvas) return null;
    const move = (x, y) => {
      canvas.dataset.mechanicsPlacementAssembly = '';
      canvas.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        button: -1,
        clientX: x,
        clientY: y,
        pointerId: 83,
        pointerType: 'mouse',
      }));
      return canvas.dataset.mechanicsPlacementAssembly === wanted;
    };
    const rect = canvas.getBoundingClientRect();
    const hits = [];
    for (let y = rect.top + rect.height * 0.15; y <= rect.top + rect.height * 0.9; y += 4) {
      for (let x = rect.left + rect.width * 0.1; x <= rect.left + rect.width * 0.9; x += 4) {
        if (move(x, y)) hits.push({ x, y });
      }
    }
    if (hits.length === 0) return null;
    // Click well inside the silhouette: the collected hit nearest the centroid.
    const center = {
      x: hits.reduce((sum, hit) => sum + hit.x, 0) / hits.length,
      y: hits.reduce((sum, hit) => sum + hit.y, 0) / hits.length,
    };
    const best = hits.reduce((acc, hit) =>
      Math.hypot(hit.x - center.x, hit.y - center.y) < Math.hypot(acc.x - center.x, acc.y - center.y)
        ? hit
        : acc,
    );
    return move(best.x, best.y) ? best : null;
  }, assemblyId);
}

async function clickPlacementSurface(page, assemblyId) {
  const spot = await hoverPlacementSurface(page, assemblyId);
  expect(spot).not.toBeNull();
  // Confirm with a real pointer move that the click ray lands on the surface,
  // then click that exact point.
  await page.mouse.move(spot.x, spot.y);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.querySelector('.mechanics-canvas canvas')?.dataset.mechanicsPlacementAssembly,
      ),
    )
    .toBe(assemblyId);
  await page.mouse.down();
  await page.mouse.up();
}

test('placement tools treat assemblies as surfaces: shapes stack and cogs mount with axles', async ({ page }) => {
  await page.goto('/mechanics');
  await loadStarter(page, 'blank');
  await openShapePalette(page);
  await page.getByTestId('mechanics-add-cuboid').click();
  await expect(page.getByTestId('mechanics-assembly-assembly:1')).toBeVisible();

  // Cogs: clicking a block face mounts a cogwheel there with an automatic axle.
  const toolbar = page.getByRole('toolbar', { name: 'Mechanics tools' });
  await toolbar.getByRole('button', { name: 'Cogs', exact: true }).click();
  await clickPlacementSurface(page, 'assembly:1');
  await expect(page.getByTestId('mechanics-assembly-assembly:2')).toBeVisible();
  await expect(page.getByTestId('mechanics-relationship-constraint:1')).toContainText('axle');

  // Shapes: clicking the block's surface places another block seated on it
  // (previously this click only selected the block).
  await toolbar.getByRole('button', { name: 'Shapes', exact: true }).click();
  await clickPlacementSurface(page, 'assembly:1');
  await expect(page.getByTestId('mechanics-assembly-assembly:3')).toBeVisible();
});

test('cogwheel palette quick-adds snap into a coupled meshed pair automatically', async ({ page }) => {
  await page.goto('/mechanics');
  await loadStarter(page, 'blank');
  const toolbar = page.getByRole('toolbar', { name: 'Mechanics tools' });
  await toolbar.getByRole('button', { name: 'Cogs', exact: true }).click();
  await page.getByTestId('mechanics-add-cog-large').click();
  await expect(page.getByTestId('mechanics-assembly-assembly:1')).toBeVisible();
  await page.getByTestId('mechanics-add-cog-small').click();
  await expect(page.getByTestId('mechanics-assembly-assembly:2')).toBeVisible();
  // The small cog landed near the large one, so it snapped into mesh and the
  // counter-rotating 2:1 coupling was created without any dialog.
  await expect(page.getByTestId('mechanics-relationship-coupling:1')).toContainText('Cog mesh 2:1');
  // One undo removes the meshed wheel together with its coupling.
  await page.getByRole('button', { name: 'Undo build action', exact: true }).click();
  await expect(page.getByTestId('mechanics-relationship-coupling:1')).toHaveCount(0);
  await expect(page.getByTestId('mechanics-assembly-assembly:2')).toHaveCount(0);
});

test('shaft link modal and internal copy/paste preserve a connected mechanism', async ({ page }) => {
  await page.goto('/mechanics');
  await loadStarter(page, 'blank');
  await openShapePalette(page);
  await page.getByTestId('mechanics-add-wheel').click();
  await page.getByTestId('mechanics-add-wheel').click();
  await page.getByTestId('mechanics-assembly-assembly:1').click();
  await page.getByTestId('mechanics-assembly-assembly:2').click({ modifiers: ['Shift'] });

  const toolbar = page.getByRole('toolbar', { name: 'Mechanics tools' });
  await toolbar.getByRole('button', { name: 'Cogs', exact: true }).click();
  await page.getByRole('button', { name: 'Link two wheels with a shaft…', exact: true }).click();
  const gearDialog = page.getByRole('dialog', { name: 'Link rotation with a shaft' });
  await gearDialog.getByRole('button', { name: 'Connect rotation', exact: true }).click();
  await expect(page.getByTestId('mechanics-relationship-coupling:1')).toContainText('Shaft link');

  await page.getByTestId('mechanics-assembly-assembly:1').click();
  await page.getByTestId('mechanics-assembly-assembly:2').click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Copy selected assemblies', exact: true }).click();
  await page.getByRole('button', { name: 'Paste copied assemblies', exact: true }).click();

  await expect(page.getByTestId('mechanics-assembly-assembly:3')).toBeVisible();
  await expect(page.getByTestId('mechanics-assembly-assembly:4')).toBeVisible();
  await expect(page.getByTestId('mechanics-relationship-coupling:2')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.bodyCount))
    .toBe(5);
  await expect.poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.groundBodyCount)).toBe(1);
});

test('player-authored sliding gate activates a mounted spell from real slider state', async ({ page }) => {
  await page.goto('/mechanics');
  await loadStarter(page, 'blank');
  await openShapePalette(page);
  await page.getByTestId('mechanics-add-plate').click();
  await page.getByTestId('mechanics-add-cuboid').click();
  await page.getByTestId('mechanics-assembly-assembly:1').click();
  await page.getByTestId('mechanics-assembly-assembly:2').click({ modifiers: ['Shift'] });

  const toolbar = page.getByRole('toolbar', { name: 'Mechanics tools' });
  await toolbar.getByRole('button', { name: 'Joints', exact: true }).click();
  const jointDialog = page.getByRole('dialog', { name: 'Connect with a joint' });
  await jointDialog.getByRole('button', { name: 'Slider / rail', exact: true }).click();
  await jointDialog.getByRole('button', { name: 'Connect joint', exact: true }).click();

  await page.getByTestId('mechanics-assembly-assembly:1').click();
  await toolbar.getByRole('button', { name: 'Spell plate', exact: true }).click();
  const spellDialog = page.getByRole('dialog', { name: 'Mount a spell plate' });
  await spellDialog.getByRole('button', { name: 'Sliding key', exact: true }).click();
  await spellDialog.getByRole('button', { name: 'Mount spell plate', exact: true }).click();
  await page.getByTestId('mechanics-mode-test').click();

  await expect
    .poll(() => page.evaluate(() => Object.keys(window.__WHA_MECHANICS_DEBUG__?.gates ?? {}).length))
    .toBe(1);
  await expect
    .poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.activeSpellDevices?.length ?? 0))
    .toBe(1);
});

test('relationships are editable from the build inspector', async ({ page }) => {
  await page.goto('/mechanics');
  await loadStarter(page, 'catapult');

  await page.getByTestId('mechanics-relationship-spring:catapult').click();
  await expect(page.getByLabel('Rest °')).toHaveValue('-64.17');
  const stiffness = page.getByLabel('Stiffness');
  await stiffness.fill('55');
  await stiffness.press('Enter');
  await expect(page.getByTestId('mechanics-status')).toContainText('Spring stiffness updated.');

  await page.getByTestId('mechanics-relationship-constraint:catapult-pivot').click();
  await expect(page.getByRole('button', { name: 'Hinge', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByLabel('Rotation axis').selectOption('z');
  await expect(page.getByTestId('mechanics-status')).toContainText('Joint axis changed.');

  await page.getByRole('checkbox', { name: 'Turn continuously in Test' }).check();
  await expect(page.getByTestId('mechanics-status')).toContainText('Motor enabled for Test mode.');
  await expect(page.getByLabel('Speed (°/s)')).toBeVisible();

  // Test mode locks editing back down.
  await page.getByTestId('mechanics-mode-test').click();
  await expect(page.getByText('Switch to Build mode to edit this relationship.')).toBeVisible();
});

test('Modify exposes surface-bound A/B connection nodes and commits a node drag once', async ({ page }) => {
  await page.goto('/mechanics');
  await loadStarter(page, 'catapult');
  await page.getByTestId('mechanics-relationship-constraint:catapult-pivot').click();
  await page
    .getByRole('toolbar', { name: 'Mechanics tools' })
    .getByRole('button', { name: 'Modify', exact: true })
    .click();

  await expect(page.getByText('Modify connection points')).toBeVisible();
  await expect(page.getByText(/Gold A\/B nodes are active/)).toBeVisible();
  await expect.poll(async () => (await findConnectionEndpointHit(page, 'A'))?.centerHit).toBe(true);
  const endpoint = await findConnectionEndpointHit(page, 'A');
  expect(endpoint).not.toBeNull();
  expect(endpoint.host).toBe('assembly:catapult-base');
  expect(endpoint.centerHit).toBe(true);

  const before = await page.evaluate((key) => {
    const document = JSON.parse(localStorage.getItem(key));
    const constraint = document.constraints.find((item) => item.constraintId === 'constraint:catapult-pivot');
    return { anchorA: constraint.localAnchorA, anchorB: constraint.localAnchorB };
  }, WORKBENCH_STORAGE_KEY);
  await page.mouse.move(endpoint.x, endpoint.y);
  await page.mouse.down();
  await expect(page.getByTestId('mechanics-canvas').locator('canvas'))
    .toHaveAttribute('data-mechanics-endpoint-dragging', 'A');
  await page.mouse.move(endpoint.x + 24, endpoint.y + 54, { steps: 12 });
  await expect(page.getByTestId('mechanics-canvas').locator('canvas'))
    .toHaveAttribute('data-mechanics-endpoint-surface-hit', 'assembly:catapult-base');
  await page.mouse.up();
  await expect.poll(() => page.evaluate((key) => {
    const document = JSON.parse(localStorage.getItem(key));
    const constraint = document.constraints.find((item) => item.constraintId === 'constraint:catapult-pivot');
    return {
      anchorA: constraint.localAnchorA,
      anchorB: constraint.localAnchorB,
      contactA: constraint.connectionAnchorA ?? null,
    };
  }, WORKBENCH_STORAGE_KEY)).toEqual({ ...before, contactA: expect.any(Object) });
  await expect(page.getByTestId('mechanics-status')).toContainText('First connection point moved');
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.evaluate((key) => {
    const document = JSON.parse(localStorage.getItem(key));
    const constraint = document.constraints.find((item) => item.constraintId === 'constraint:catapult-pivot');
    return constraint.connectionAnchorA ?? null;
  }, WORKBENCH_STORAGE_KEY)).toBeNull();

  await page.getByTestId('mechanics-relationship-spring:catapult').click();
  await expect.poll(async () => (await findConnectionEndpointHit(page, 'B'))?.centerHit).toBe(true);
  const torsionEndpoint = await findConnectionEndpointHit(page, 'B');
  expect(torsionEndpoint).not.toBeNull();
  expect(torsionEndpoint.host).toBe('assembly:catapult-arm');
  expect(torsionEndpoint.centerHit).toBe(true);
  await page.mouse.move(torsionEndpoint.x, torsionEndpoint.y);
  await page.mouse.down();
  await page.mouse.move(torsionEndpoint.x - 20, torsionEndpoint.y + 38, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate((key) => {
    const document = JSON.parse(localStorage.getItem(key));
    return document.forceElements.find((item) => item.forceElementId === 'spring:catapult')
      .connectionAnchorB ?? null;
  }, WORKBENCH_STORAGE_KEY)).not.toBeNull();
});

test('an empty spell socket mounts, gates, and stays inert until a spell is placed', async ({ page }) => {
  await page.goto('/mechanics');
  await loadStarter(page, 'blank');
  await openShapePalette(page);
  await page.getByTestId('mechanics-add-cuboid').click();

  const toolbar = page.getByRole('toolbar', { name: 'Mechanics tools' });
  await toolbar.getByRole('button', { name: 'Spell plate', exact: true }).click();
  await page.getByLabel('Prepared spell').selectOption('');
  await page.getByRole('button', { name: 'Mount spell plate', exact: true }).click();
  await expect(page.getByTestId('mechanics-status')).toContainText('manual test gate');

  await page.getByTestId('mechanics-mode-test').click();
  const toggle = page.getByTestId(/mechanics-manual-spell-/);
  await expect(toggle).toContainText('(empty socket)');
  await toggle.click();
  await expect
    .poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.activeSpellDevices?.length ?? -1))
    .toBe(0);

  // Socket a spell from the inspector and the same key now casts.
  await page.getByTestId('mechanics-mode-build').click();
  await page.getByTestId(/mechanics-relationship-spell-device/).click();
  await page.getByLabel('Socketed spell').selectOption('wind-column');
  await expect(page.getByTestId('mechanics-status')).toContainText('Spell placed in the socket.');
  await page.getByTestId('mechanics-mode-test').click();
  await page.getByTestId(/mechanics-manual-spell-/).click();
  await expect
    .poll(() => page.evaluate(() => window.__WHA_MECHANICS_DEBUG__?.activeSpellDevices?.length ?? -1))
    .toBe(1);
});

test('mounted spell plates expose modify transforms and can change hosts in place', async ({ page }) => {
  await page.goto('/mechanics');
  await loadStarter(page, 'wind-gears');
  await page.getByTestId('mechanics-relationship-spell-device:wind-drive').click();

  const mountedOn = page.getByLabel('Mounted on');
  await expect(mountedOn).toBeEnabled();
  await expect(page.getByLabel('Plate diameter')).toHaveValue('0.84');
  await page.getByRole('toolbar', { name: 'Mechanics tools' })
    .getByRole('button', { name: 'Modify', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Modify spell plate' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Transform tool' })).toBeVisible();
  await expect(page.getByTestId('mechanics-canvas').locator('canvas'))
    .toHaveAttribute('data-mechanics-transform-operation', 'translate');

  await page.getByLabel('Plate diameter').fill('1.20');
  await page.getByLabel('Plate diameter').blur();
  const previousHost = await mountedOn.inputValue();
  const newHost = await mountedOn.locator('option').evaluateAll(
    (options, current) => options.map((option) => option.value).find((value) => value !== current),
    previousHost,
  );
  await mountedOn.selectOption(newHost);

  await expect.poll(() => page.evaluate((key) => {
    const document = JSON.parse(localStorage.getItem(key));
    const device = document.spellDevices.find((item) => item.deviceId === 'spell-device:wind-drive');
    return { assemblyId: device.assemblyId, plateRadius: device.plateRadius };
  }, WORKBENCH_STORAGE_KEY)).toEqual({ assemblyId: newHost, plateRadius: 0.6 });
});
