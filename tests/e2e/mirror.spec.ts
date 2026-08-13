import { expect, test } from '@playwright/test';
import { Editor } from './editor';

/** x of the mirrored column on a 32-wide canvas. */
const flipX = (x: number, size: number) => size - 1 - x;

test('the axis option appears only once mirroring is on', async ({ page }) => {
  const editor = await Editor.open(page);
  await expect(page.locator('#mirror-axis-field')).toBeHidden();

  await editor.toggleMirror();
  await expect(page.locator('#mirror-axis-field')).toBeVisible();
  expect(await editor.mirrorOn()).toBe(true);

  await editor.toggleMirror();
  await expect(page.locator('#mirror-axis-field')).toBeHidden();
  expect(await editor.mirrorOn()).toBe(false);
});

test('a pencil dot is echoed across the vertical line', async ({ page }) => {
  const editor = await Editor.open(page);
  const size = await editor.canvasSize();

  await editor.toggleMirror();
  await editor.paint(5, 7);

  expect(await editor.framePixelCells()).toEqual([
    [5, 7],
    [flipX(5, size), 7],
  ]);
});

test('the horizontal axis echoes top to bottom instead', async ({ page }) => {
  const editor = await Editor.open(page);
  const size = await editor.canvasSize();

  await editor.setMirrorAxis('horizontal');
  await editor.paint(5, 7);

  expect(await editor.framePixelCells()).toEqual([
    [5, 7],
    [5, size - 1 - 7],
  ]);
});

test('both halves of a mirrored stroke undo together', async ({ page }) => {
  const editor = await Editor.open(page);

  await editor.toggleMirror();
  await editor.dragOnCanvas([2, 2], [10, 10]);
  const painted = (await editor.framePixelCounts())[0];
  expect(painted).toBeGreaterThanOrEqual(18); // both sides of a 9-cell run

  await page.click('#undo');
  expect(await editor.framePixelCounts()).toEqual([0]);
});

/** Every painted cell has its reflection painted too, and vice versa. */
function expectSymmetric(cells: Array<[number, number]>, size: number): void {
  const key = (x: number, y: number) => `${x},${y}`;
  const painted = new Set(cells.map(([x, y]) => key(x, y)));
  const reflected = new Set(cells.map(([x, y]) => key(flipX(x, size), y)));
  expect([...reflected].sort()).toEqual([...painted].sort());
}

/** Columns touched on the right of the vertical line, as [first, last]. */
function rightSpan(cells: Array<[number, number]>, size: number): [number, number] {
  const columns = cells.filter(([x]) => x >= size / 2).map(([x]) => x);
  return [Math.min(...columns), Math.max(...columns)];
}

test('a line blocks at the mirror line rather than crossing it', async ({ page }) => {
  const editor = await Editor.open(page);
  const size = await editor.canvasSize();

  await editor.toggleMirror();
  await editor.selectTool('line');
  // Aimed well past the middle: the far end must stop on the near side.
  await editor.dragOnCanvas([2, 2], [size - 3, 2]);

  const cells = await editor.framePixelCells();
  const left = cells.filter(([x]) => x < size / 2).map(([x]) => x);

  // The drawn run reaches the line and stops; its reflection covers the rest.
  expect(Math.min(...left)).toBe(2);
  expect(Math.max(...left)).toBe(size / 2 - 1);
  expect(rightSpan(cells, size)).toEqual([size / 2, flipX(2, size)]);
  expectSymmetric(cells, size);
});

test('a rectangle drawn on the right half stays on the right half', async ({ page }) => {
  const editor = await Editor.open(page);
  const size = await editor.canvasSize();

  await editor.toggleMirror();
  await editor.selectTool('rect');
  // Started on the right, dragged past the line to x = 2.
  await editor.dragOnCanvas([size - 4, 4], [2, 12]);

  const cells = await editor.framePixelCells();
  // The far corner was clamped onto the line, so the box spans it to x = 28 —
  // rather than folding back over the half it started in.
  expect(rightSpan(cells, size)).toEqual([size / 2, size - 4]);
  expectSymmetric(cells, size);
});

test('mirroring survives a reload', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.setMirrorAxis('horizontal');

  await editor.reload();
  expect(await editor.mirrorOn()).toBe(true);
  await expect(page.locator('#mirror-axis')).toHaveValue('horizontal');
});

test('moving a selection is not mirrored', async ({ page }) => {
  const editor = await Editor.open(page);

  await editor.paint(3, 3);
  await editor.toggleMirror();
  const before = (await editor.framePixelCounts())[0];
  expect(before).toBe(1);

  await editor.selectTool('select');
  await editor.selectRegion([2, 2], [4, 4]);
  await editor.dragOnCanvas([3, 3], [3, 8]);

  // The pixel travelled; the mirror had no say in a move.
  expect(await editor.framePixelCells()).toEqual([[3, 8]]);
});
