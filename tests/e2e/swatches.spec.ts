import { expect, test } from '@playwright/test';
import { Editor } from './editor';

test('the saved row stays away until there is a colour in it', async ({ page }) => {
  await Editor.open(page);

  await expect(page.locator('#custom-palette')).toBeHidden();

  await page.locator('#color-input').fill('#123456');
  await page.click('#save-swatch');

  await expect(page.locator('#custom-palette')).toBeVisible();
  await expect(page.locator('#custom-palette .swatch')).toHaveCount(1);
  await expect(page.locator('#status')).toContainText('saved #123456');
});

test('a saved swatch paints with its colour', async ({ page }) => {
  const editor = await Editor.open(page);

  await page.locator('#color-input').fill('#123456');
  await page.click('#save-swatch');

  // Pick another colour, then come back to the saved one through its swatch.
  await page.locator('#color-input').fill('#ff00ff');
  await page.click('#custom-palette .swatch');
  await editor.paint(4, 4);

  expect(await editor.frameColors([[4, 4]])).toEqual(['#123456']);
});

test('saved colours outlive a reload', async ({ page }) => {
  const editor = await Editor.open(page);

  await page.locator('#color-input').fill('#123456');
  await page.click('#save-swatch');
  await page.locator('#color-input').fill('#abcdef');
  await page.click('#save-swatch');

  await editor.reload();

  await expect(page.locator('#custom-palette .swatch')).toHaveCount(2);
  expect(
    await page.locator('#custom-palette .swatch').evaluateAll((swatches) =>
      swatches.map((swatch) => (swatch as HTMLElement).dataset.hex),
    ),
  ).toEqual(['#123456', '#abcdef']);
});

test('right-clicking a saved swatch removes it, for good', async ({ page }) => {
  const editor = await Editor.open(page);

  await page.locator('#color-input').fill('#123456');
  await page.click('#save-swatch');
  await page.click('#custom-palette .swatch', { button: 'right' });

  await expect(page.locator('#status')).toContainText('removed #123456');
  await expect(page.locator('#custom-palette')).toBeHidden();

  await editor.reload();
  await expect(page.locator('#custom-palette')).toBeHidden();
});

test('the built-in palette has no removal gesture', async ({ page }) => {
  await Editor.open(page);

  const before = await page.locator('#palette .swatch').count();
  await page.click('#palette .swatch', { button: 'right' });

  expect(await page.locator('#palette .swatch').count()).toBe(before);
});

test('a colour already in a palette is not saved twice', async ({ page }) => {
  await Editor.open(page);

  // Black opens the built-in palette's first row.
  await page.locator('#color-input').fill('#000000');
  await page.click('#save-swatch');
  await expect(page.locator('#status')).toContainText('already in the palette');
  await expect(page.locator('#custom-palette')).toBeHidden();

  await page.locator('#color-input').fill('#123456');
  await page.click('#save-swatch');
  await page.click('#save-swatch');
  await expect(page.locator('#status')).toContainText('already in the palette');
  await expect(page.locator('#custom-palette .swatch')).toHaveCount(1);
});

test('saved colours are offered as a shape fill too', async ({ page }) => {
  await Editor.open(page);

  await page.locator('#color-input').fill('#123456');
  await page.click('#save-swatch');

  // The fill palettes only appear for a rectangle with a custom fill.
  await page.click('.tool[data-tool="rect"]');
  await page.selectOption('#shape-fill', 'custom');

  const saved = page.locator('#shape-fill-custom-palette .swatch');
  await expect(saved).toHaveCount(1);
  await saved.click();
  await expect(page.locator('#shape-fill-color')).toHaveValue('#123456');
  await expect(saved).toHaveClass(/selected/);
});
