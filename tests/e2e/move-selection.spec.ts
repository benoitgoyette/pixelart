import { expect, test } from '@playwright/test';
import { Editor } from './editor';

/** A 2×2 block at (4,4), the thing every test here drags around. */
const BLOCK: Array<[number, number]> = [
  [4, 4],
  [5, 4],
  [4, 5],
  [5, 5],
];

async function blockOnCanvas(editor: Editor): Promise<void> {
  for (const [x, y] of BLOCK) await editor.paint(x, y);
  expect(await editor.framePixelCells()).toEqual(BLOCK);
}

/** Marks the 4×4 region around the block, leaving the marquee live. */
async function selectAroundBlock(editor: Editor): Promise<void> {
  await editor.selectTool('select');
  await editor.selectRegion([3, 3], [6, 6]);
}

test('marking a region leaves the marquee live instead of asking to copy', async ({ page }) => {
  const editor = await Editor.open(page);
  await blockOnCanvas(editor);
  await selectAroundBlock(editor);

  await expect(page.locator('#copy-dialog')).toBeHidden();
  await expect(page.locator('#status')).toContainText('4 × 4 selection');
  await expect(page.locator('#status')).toContainText('drag inside it to move it');
  // Marking alone must not touch the art.
  expect(await editor.framePixelCells()).toEqual(BLOCK);
});

test('the cursor becomes a hand inside the selection, and a crosshair outside', async ({
  page,
}) => {
  const editor = await Editor.open(page);
  await blockOnCanvas(editor);
  await selectAroundBlock(editor);

  await editor.hoverCell(4, 4); // inside
  expect(await editor.canvasCursor()).toBe('grab');

  await editor.hoverCell(20, 20); // outside
  expect(await editor.canvasCursor()).toBe('crosshair');
});

test('dragging the selection moves the pixels and leaves transparency behind', async ({
  page,
}) => {
  const editor = await Editor.open(page);
  await blockOnCanvas(editor);
  await selectAroundBlock(editor);

  // Grab the block's top-left cell and drop it 6 right, 4 down.
  await editor.dragOnCanvas([4, 4], [10, 8]);

  await expect(page.locator('#status')).toContainText('moved 4 × 4 selection');
  expect(await editor.framePixelCells()).toEqual([
    [10, 8],
    [11, 8],
    [10, 9],
    [11, 9],
  ]);
});

test('the emptied space is transparent, not the background colour', async ({ page }) => {
  const editor = await Editor.open(page);
  await blockOnCanvas(editor);

  // A solid canvas background must not be baked into the vacated cells.
  await page.selectOption('#background', { index: 1 });
  await selectAroundBlock(editor);
  await editor.dragOnCanvas([4, 4], [12, 12]);

  const cells = await editor.framePixelCells();
  expect(cells).toHaveLength(4);
  for (const [x, y] of BLOCK) {
    expect(cells).not.toContainEqual([x, y]);
  }
});

test('one undo puts the whole move back', async ({ page }) => {
  const editor = await Editor.open(page);
  await blockOnCanvas(editor);
  await selectAroundBlock(editor);
  await editor.dragOnCanvas([4, 4], [10, 8]);

  await page.locator('body').press('Meta+z');
  expect(await editor.framePixelCells()).toEqual(BLOCK);
});

test('the selection can be dragged again from where it landed', async ({ page }) => {
  const editor = await Editor.open(page);
  await blockOnCanvas(editor);
  await selectAroundBlock(editor);

  await editor.dragOnCanvas([4, 4], [10, 4]);
  // The marquee travelled too, so grabbing its new interior works straight away.
  expect(await editor.canvasCursor()).toBe('grab');
  await editor.dragOnCanvas([10, 4], [10, 10]);

  expect(await editor.framePixelCells()).toEqual([
    [10, 10],
    [11, 10],
    [10, 11],
    [11, 11],
  ]);
});

test('Escape mid-drag puts the selection back where it started', async ({ page }) => {
  const editor = await Editor.open(page);
  await blockOnCanvas(editor);
  await selectAroundBlock(editor);

  const from = await editor.cellPoint(4, 4);
  const to = await editor.cellPoint(14, 14);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.locator('body').press('Escape');
  await page.mouse.up();

  await expect(page.locator('#status')).toContainText('move cancelled');
  expect(await editor.framePixelCells()).toEqual(BLOCK);
});

test('a grab that never travels changes nothing and costs no undo', async ({ page }) => {
  const editor = await Editor.open(page);
  await blockOnCanvas(editor);
  // A stroke before the selection gives undo something to reach for.
  await editor.paint(20, 20);
  await selectAroundBlock(editor);

  await editor.clickCell(4, 4); // press and release without moving
  expect(await editor.framePixelCells()).toEqual([...BLOCK, [20, 20]]);

  // Undo reaches past the no-op grab to the stray pixel.
  await page.locator('body').press('Meta+z');
  expect(await editor.framePixelCells()).toEqual(BLOCK);
});

test('the selection stops at the canvas edge rather than losing pixels', async ({ page }) => {
  const editor = await Editor.open(page);
  await blockOnCanvas(editor);
  await selectAroundBlock(editor);

  const size = await editor.canvasSize();
  // Drag hard past the bottom-right corner; the 4×4 rectangle should sit flush.
  await editor.dragOnCanvas([4, 4], [size + 10, size + 10]);

  const cells = await editor.framePixelCells();
  expect(cells).toHaveLength(4);
  // The block sat one cell inside its 4×4 marquee, so it lands one cell in.
  const last = size - 2;
  expect(cells).toContainEqual([last, last]);
});

test('switching tools drops the selection and the hand cursor', async ({ page }) => {
  const editor = await Editor.open(page);
  await blockOnCanvas(editor);
  await selectAroundBlock(editor);

  await editor.selectTool('pencil');
  await editor.hoverCell(4, 4);
  expect(await editor.canvasCursor()).toBe('crosshair');
});
