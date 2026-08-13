import { expect, test } from '@playwright/test';
import { Editor } from './editor';

test('a drag paints a continuous stroke', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.dragOnCanvas([2, 2], [12, 12]);

  const [painted] = await editor.framePixelCounts();
  // Bresenham over 10 cells: a gapped stroke would fall well short.
  expect(painted).toBeGreaterThanOrEqual(11);
});

test('a stroke is one undo step, not one per pixel', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.dragOnCanvas([2, 2], [12, 12]);
  expect((await editor.framePixelCounts())[0]).toBeGreaterThan(1);

  await page.click('#undo');
  expect(await editor.framePixelCounts()).toEqual([0]);

  await page.click('#redo');
  expect((await editor.framePixelCounts())[0]).toBeGreaterThan(1);
});

test('the eraser clears pixels and the bucket fills the canvas', async ({ page }) => {
  const editor = await Editor.open(page);
  const size = await editor.canvasSize();

  await editor.selectTool('bucket');
  await editor.paint(5, 5);
  expect((await editor.framePixelCounts())[0]).toBe(size * size);

  await editor.selectTool('eraser');
  await editor.paint(5, 5);
  expect((await editor.framePixelCounts())[0]).toBe(size * size - 1);
});

test('brush size widens the stroke', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.paint(5, 5);
  const thin = (await editor.framePixelCounts())[0];

  await page.selectOption('#pencil-size', '3');
  await editor.paint(10, 10);
  const total = (await editor.framePixelCounts())[0];
  expect(total - thin).toBe(9); // a 3x3 stamp
});

test('the eraser carries its own width, shown only for the eraser', async ({ page }) => {
  const editor = await Editor.open(page);
  await expect(page.locator('#eraser-size-field')).toBeHidden();

  await editor.selectTool('eraser');
  await expect(page.locator('#eraser-size-field')).toBeVisible();

  await editor.selectTool('pencil');
  await expect(page.locator('#eraser-size-field')).toBeHidden();
});

test('shapes preview during the drag and commit as one undo step', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.selectTool('rect');
  await editor.dragOnCanvas([3, 3], [10, 8]);

  const perimeter = 2 * (8 + 6) - 4;
  expect((await editor.framePixelCounts())[0]).toBe(perimeter);

  await page.click('#undo');
  expect(await editor.framePixelCounts()).toEqual([0]);
});

test('shape fill is offered only for closed shapes', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.selectTool('line');
  await expect(page.locator('#shape-section')).toBeHidden();

  await editor.selectTool('rect');
  await expect(page.locator('#shape-section')).toBeVisible();

  await editor.selectTool('oval');
  await expect(page.locator('#shape-section')).toBeVisible();
});

test('a filled rectangle is solid, an unfilled one hollow', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.selectTool('rect');
  await editor.dragOnCanvas([3, 3], [10, 8]);
  const hollow = (await editor.framePixelCounts())[0];

  await page.click('#undo');
  await page.selectOption('#shape-fill', 'brush');
  await editor.dragOnCanvas([3, 3], [10, 8]);
  expect((await editor.framePixelCounts())[0]).toBe(8 * 6);
  expect((await editor.framePixelCounts())[0]).toBeGreaterThan(hollow);
});

test('the polygon closes on its start point as a single undo step', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.selectTool('polygon');

  await editor.paint(4, 4);
  await editor.paint(12, 4);
  await editor.paint(12, 12);
  await editor.paint(4, 4); // back to the ringed start point

  const closed = (await editor.framePixelCounts())[0];
  expect(closed).toBeGreaterThan(0);
  await expect(page.locator('#status')).toContainText('polygon closed');

  await page.click('#undo');
  expect(await editor.framePixelCounts()).toEqual([0]);
});

test('Escape abandons an unfinished polygon and its undo entry', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.paint(20, 20); // something to undo behind the polygon
  const before = await editor.framePixelCounts();

  await editor.selectTool('polygon');
  await editor.paint(4, 4);
  await editor.paint(12, 4);
  await page.locator('body').press('Escape');
  await expect(page.locator('#status')).toContainText('cancelled');

  // The abandoned polygon left no pixels and no undo entry of its own.
  expect(await editor.framePixelCounts()).toEqual(before);
  await page.click('#undo');
  expect(await editor.framePixelCounts()).toEqual([0]);
});

test('rotating 90 degrees four times returns the art unchanged', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.paint(4, 4);
  await editor.paint(5, 4);
  await editor.paint(4, 5);
  const before = await editor.framePixelIndices();

  for (let i = 0; i < 4; i++) {
    await page.locator('.rotate-presets button', { hasText: '90°' }).click();
  }
  expect(await editor.framePixelIndices()).toEqual(before);
});

test('the eyedropper refuses to pick an empty pixel', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.selectTool('eyedropper');
  await editor.paint(6, 6);
  await expect(page.locator('#status')).toContainText('empty pixel');
});

test('a tool shortcut still works right after clicking a button', async ({ page }) => {
  // Regression: a focus guard once disabled every shortcut once any button had
  // been clicked, which silently broke Cmd+Z during normal use.
  const editor = await Editor.open(page);
  await editor.dragOnCanvas([2, 2], [8, 8]);
  await page.click('#undo'); // leaves focus on the button
  await page.click('#redo');

  await page.keyboard.press('Meta+z');
  expect(await editor.framePixelCounts()).toEqual([0]);
});
