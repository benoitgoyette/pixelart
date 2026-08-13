import { expect, test } from '@playwright/test';
import { Editor } from './editor';

/** Frames 1..n, each holding one more pixel than the last: [1, 2, 3, ...]. */
async function ladder(editor: Editor, frames: number): Promise<void> {
  await editor.paint(2, 2);
  for (let i = 1; i < frames; i++) {
    await editor.newFrame();
    await editor.paint(2 + i * 2, 5);
  }
}

test('a new frame copies the current drawing', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.paint(4, 4);
  await editor.paint(5, 4);

  await editor.newFrame();
  expect(await editor.framePixelCounts()).toEqual([2, 2]);
  expect(await editor.currentFrame()).toBe(2); // and lands on the copy
});

test('editing one frame leaves the others alone', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.paint(4, 4);
  await editor.newFrame();
  await editor.paint(9, 9);

  expect(await editor.framePixelCounts()).toEqual([1, 2]);
});

test('undo follows an edit back to the frame it happened on', async ({ page }) => {
  const editor = await Editor.open(page);
  await ladder(editor, 3);
  await editor.selectFrame(1);
  expect(await editor.currentFrame()).toBe(1);

  await page.keyboard.press('Meta+z');
  // The last stroke was on frame 3, so undo must return there to unwind it.
  expect(await editor.currentFrame()).toBe(3);
  expect(await editor.framePixelCounts()).toEqual([1, 2, 2]);
});

test('frames navigate by click, arrow keys, and wheel', async ({ page }) => {
  const editor = await Editor.open(page);
  await ladder(editor, 4);

  await editor.selectFrame(2);
  expect(await editor.currentFrame()).toBe(2);

  await page.locator('body').press('ArrowRight');
  expect(await editor.currentFrame()).toBe(3);

  await page.locator('body').press('ArrowLeft');
  expect(await editor.currentFrame()).toBe(2);

  const strip = await page.locator('#filmstrip').boundingBox();
  await page.mouse.move(strip!.x + strip!.width / 2, strip!.y + strip!.height / 2);
  await page.mouse.wheel(0, 60);
  expect(await editor.currentFrame()).toBe(3);
});

test('the filmstrip lays frames out left to right', async ({ page }) => {
  const editor = await Editor.open(page);
  await ladder(editor, 4);

  const boxes = await page.locator('.frame-item').evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y) };
    }),
  );
  expect(new Set(boxes.map((b) => b.y)).size).toBe(1);
  for (let i = 1; i < boxes.length; i++) expect(boxes[i].x).toBeGreaterThan(boxes[i - 1].x);
});

test('dragging a thumbnail reorders the frames', async ({ page }) => {
  const editor = await Editor.open(page);
  await ladder(editor, 4);
  expect(await editor.framePixelCounts()).toEqual([1, 2, 3, 4]);

  await editor.dragFrame(1, 'end');
  expect(await editor.framePixelCounts()).toEqual([2, 3, 4, 1]);

  await editor.dragFrame(4, 'start');
  expect(await editor.framePixelCounts()).toEqual([1, 2, 3, 4]);
});

test('a plain click on a thumbnail selects instead of reordering', async ({ page }) => {
  const editor = await Editor.open(page);
  await ladder(editor, 4);

  await editor.selectFrame(2);
  expect(await editor.currentFrame()).toBe(2);
  expect(await editor.framePixelCounts()).toEqual([1, 2, 3, 4]);
});

test('history still points at the right art after a reorder', async ({ page }) => {
  const editor = await Editor.open(page);
  await ladder(editor, 4);
  await editor.dragFrame(1, 'end'); // now [2, 3, 4, 1]

  await page.keyboard.press('Meta+z');
  // The last stroke belonged to the 4-pixel drawing, wherever it now sits.
  expect(await editor.framePixelCounts()).toEqual([2, 3, 3, 1]);
});

test('deleting a frame removes it and keeps the rest', async ({ page }) => {
  const editor = await Editor.open(page);
  await ladder(editor, 3);

  await editor.selectFrame(2);
  await page.click('#delete-frame'); // the dialog handler accepts
  expect(await editor.framePixelCounts()).toEqual([1, 3]);
});

test('the last frame cannot be deleted', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.paint(3, 3);

  await page.click('#delete-frame');
  expect(await editor.frameCount()).toBe(1);
  await expect(page.locator('#status')).toContainText('at least one frame');
});

test('frames survive a reload', async ({ page }) => {
  const editor = await Editor.open(page);
  await ladder(editor, 3);
  await editor.selectFrame(2);

  await editor.reload();
  expect(await editor.framePixelCounts()).toEqual([1, 2, 3]);
  expect(await editor.currentFrame()).toBe(2);
});

test('moving between frames does not mark the animation as unsaved', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.paint(3, 3);
  await editor.newFrame();
  await editor.saveAs('navigated');

  await editor.selectFrame(1);
  await editor.selectFrame(2);
  // Navigation is remembered, but it is not an edit.
  expect(await editor.projectName()).toBe('navigated');
});
