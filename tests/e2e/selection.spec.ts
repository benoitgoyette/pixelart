import { expect, test } from '@playwright/test';
import { Editor } from './editor';

/** Frame 1 holds a 2x2 block at (4,4); `count` frames follow, all empty. */
async function blockPlusEmptyFrames(editor: Editor, count: number): Promise<void> {
  for (const [x, y] of [[4, 4], [5, 4], [4, 5], [5, 5]]) await editor.paint(x, y);
  for (let i = 0; i < count; i++) await editor.newFrame();
  // New frames copy the current drawing, so empty them to isolate the copy.
  for (let frame = 2; frame <= count + 1; frame++) {
    await editor.selectFrame(frame);
    await editor.clearFrame();
  }
  await editor.selectFrame(1);
}

test('selecting marks a region and asks where to copy it', async ({ page }) => {
  const editor = await Editor.open(page);
  await blockPlusEmptyFrames(editor, 1);

  await editor.selectTool('duplicate');
  await editor.selectRegion([3, 3], [6, 6]);

  await expect(page.locator('#copy-dialog')).toBeVisible();
  await expect(page.locator('#copy-summary')).toContainText('4 × 4 px from frame 1');
});

test('the first click starts the rectangle, the second finishes it', async ({ page }) => {
  const editor = await Editor.open(page);
  await blockPlusEmptyFrames(editor, 1);
  await editor.selectTool('duplicate');

  await editor.clickCell(3, 3);
  await expect(page.locator('#status')).toContainText('click again to finish');
  await expect(page.locator('#copy-dialog')).toBeHidden();

  // The rectangle tracks the cursor between the clicks, without a button held.
  await editor.hoverCell(6, 6);
  await expect(page.locator('#status')).toContainText('4 × 4');
  await editor.hoverCell(8, 8);
  await expect(page.locator('#status')).toContainText('6 × 6');

  await editor.clickCell(8, 8);
  await expect(page.locator('#copy-dialog')).toBeVisible();
  await expect(page.locator('#copy-summary')).toContainText('6 × 6 px');
});

test('Escape abandons a half-made selection', async ({ page }) => {
  const editor = await Editor.open(page);
  await blockPlusEmptyFrames(editor, 1);
  await editor.selectTool('duplicate');

  await editor.clickCell(3, 3);
  await page.locator('body').press('Escape');
  await expect(page.locator('#status')).toContainText('selection cleared');

  // The abandoned start point is forgotten: the next click starts afresh.
  await editor.clickCell(10, 10);
  await expect(page.locator('#status')).toContainText('click again to finish');
  await expect(page.locator('#copy-dialog')).toBeHidden();
});

test('copies into a single frame', async ({ page }) => {
  const editor = await Editor.open(page);
  await blockPlusEmptyFrames(editor, 2);

  await editor.selectTool('duplicate');
  await editor.selectRegion([3, 3], [6, 6]);
  await page.selectOption('#copy-mode', 'single');
  await page.selectOption('#copy-frame', '2'); // zero-based: frame 3
  await page.click('#copy-confirm');

  expect(await editor.framePixelCounts()).toEqual([4, 0, 4]);
});

test('copies into a range, and one undo reverts the whole range', async ({ page }) => {
  const editor = await Editor.open(page);
  await blockPlusEmptyFrames(editor, 3);

  await editor.selectTool('duplicate');
  await editor.selectRegion([3, 3], [6, 6]);
  await page.selectOption('#copy-mode', 'range');
  await page.selectOption('#copy-from', '1');
  await page.selectOption('#copy-to', '3');
  await page.click('#copy-confirm');
  expect(await editor.framePixelCounts()).toEqual([4, 4, 4, 4]);

  await page.locator('body').press('Meta+z');
  expect(await editor.framePixelCounts()).toEqual([4, 0, 0, 0]);
  await expect(page.locator('#status')).toContainText('3 frames');
});

test('copies into all frames, landing at the same coordinates', async ({ page }) => {
  const editor = await Editor.open(page);
  await blockPlusEmptyFrames(editor, 3);

  await editor.selectTool('duplicate');
  await editor.selectRegion([3, 3], [6, 6]);
  await page.selectOption('#copy-mode', 'all');
  await page.click('#copy-confirm');

  const perFrame = await editor.framePixelIndices();
  expect(perFrame).toHaveLength(4);
  for (const frame of perFrame) expect(frame).toEqual(perFrame[0]);
});

test('a reversed range is accepted rather than rejected', async ({ page }) => {
  const editor = await Editor.open(page);
  await blockPlusEmptyFrames(editor, 2);

  await editor.selectTool('duplicate');
  await editor.selectRegion([3, 3], [6, 6]);
  await page.selectOption('#copy-mode', 'range');
  await page.selectOption('#copy-from', '2'); // to..from, backwards
  await page.selectOption('#copy-to', '1');
  await page.click('#copy-confirm');

  expect(await editor.framePixelCounts()).toEqual([4, 4, 4]);
});

test('the copied region replaces the target area, transparency included', async ({ page }) => {
  const editor = await Editor.open(page);
  await blockPlusEmptyFrames(editor, 1);

  // Put a stray pixel in frame 2 inside the region about to be copied over.
  await editor.selectFrame(2);
  await editor.paint(6, 6);
  expect(await editor.framePixelCounts()).toEqual([4, 1]);

  await editor.selectFrame(1);
  await editor.selectTool('duplicate');
  await editor.selectRegion([3, 3], [8, 8]); // covers the stray pixel
  await page.selectOption('#copy-mode', 'all');
  await page.click('#copy-confirm');

  // The stray is gone: the region was replaced, not merged.
  expect(await editor.framePixelCounts()).toEqual([4, 4]);
});

test('copying onto the source frame alone is refused', async ({ page }) => {
  const editor = await Editor.open(page);
  await blockPlusEmptyFrames(editor, 1);

  await editor.selectTool('duplicate');
  await editor.selectRegion([3, 3], [6, 6]);
  await page.selectOption('#copy-mode', 'single');
  await page.selectOption('#copy-frame', '0'); // the current frame
  await page.click('#copy-confirm');

  await expect(page.locator('#status')).toContainText('other than this one');
  expect(await editor.framePixelCounts()).toEqual([4, 0]);
});

test('cancel copies nothing, and Escape clears the marquee', async ({ page }) => {
  const editor = await Editor.open(page);
  await blockPlusEmptyFrames(editor, 1);

  await editor.selectTool('duplicate');
  await editor.selectRegion([3, 3], [6, 6]);
  await page.click('#copy-cancel');
  expect(await editor.framePixelCounts()).toEqual([4, 0]);

  await editor.selectRegion([3, 3], [6, 6]);
  await page.click('#copy-cancel');
  await page.locator('body').press('Escape');
  await expect(page.locator('#status')).toContainText('selection cleared');
});

test('the marquee never becomes part of the art', async ({ page }) => {
  const editor = await Editor.open(page);
  await blockPlusEmptyFrames(editor, 1);

  await editor.selectTool('duplicate');
  await editor.selectRegion([10, 10], [20, 20]); // over empty canvas
  await page.click('#copy-cancel');

  // Selecting empty space and cancelling leaves the pixel counts untouched.
  expect(await editor.framePixelCounts()).toEqual([4, 0]);
});
