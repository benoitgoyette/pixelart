import { expect, test } from '@playwright/test';
import { Editor } from './editor';

async function threeFrames(editor: Editor): Promise<void> {
  await editor.paint(3, 3);
  await editor.newFrame();
  await editor.paint(6, 6);
  await editor.newFrame();
  await editor.paint(9, 9);
}

test('play cycles through every frame and loops', async ({ page }) => {
  const editor = await Editor.open(page);
  await threeFrames(editor);

  await page.selectOption('#fps', '24');
  await page.click('#play');
  await expect(page.locator('#play')).toHaveText(/Stop/);

  const seen = new Set<number>();
  for (let i = 0; i < 15 && seen.size < 3; i++) {
    seen.add(await editor.currentFrame());
    await page.waitForTimeout(50);
  }
  expect([...seen].sort()).toEqual([1, 2, 3]);
});

test('stopping returns to the frame being edited', async ({ page }) => {
  const editor = await Editor.open(page);
  await threeFrames(editor);
  await editor.selectFrame(2);

  await page.click('#play');
  await page.waitForTimeout(200);
  await page.click('#play');

  await expect(page.locator('#play')).toHaveText(/Play/);
  expect(await editor.currentFrame()).toBe(2);
});

test('clicking the canvas stops playback without painting', async ({ page }) => {
  const editor = await Editor.open(page);
  await threeFrames(editor);
  const before = await editor.framePixelCounts();

  await page.click('#play');
  await page.waitForTimeout(120);
  await editor.paint(15, 15);

  await expect(page.locator('#play')).toHaveText(/Play/);
  expect(await editor.framePixelCounts()).toEqual(before);
});

test('a single frame is refused rather than silently doing nothing', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.paint(3, 3);

  await page.click('#play');
  await expect(page.locator('#status')).toContainText('second frame');
  await expect(page.locator('#play')).toHaveText(/Play/);
});

test('Space toggles playback, but presses a focused button instead', async ({ page }) => {
  const editor = await Editor.open(page);
  await threeFrames(editor);

  await page.locator('body').press(' ');
  await expect(page.locator('#play')).toHaveText(/Stop/);
  await page.locator('body').press(' ');
  await expect(page.locator('#play')).toHaveText(/Play/);

  // Focused buttons keep their own activation keys.
  await page.locator('#new-frame').focus();
  const before = await editor.frameCount();
  await page.keyboard.press(' ');
  expect(await editor.frameCount()).toBe(before + 1);
  await expect(page.locator('#play')).toHaveText(/Play/);
});

test('playback stops before a structural change', async ({ page }) => {
  const editor = await Editor.open(page);
  await threeFrames(editor);

  await page.click('#play');
  await page.waitForTimeout(80);
  await editor.newFrame();

  await expect(page.locator('#play')).toHaveText(/Play/);
});
