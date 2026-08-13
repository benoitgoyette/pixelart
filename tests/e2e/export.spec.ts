import { expect, test } from '@playwright/test';
import { Editor } from './editor';

/** Decodes a downloaded PNG inside the page and reports what it contains. */
async function inspectPng(
  page: import('@playwright/test').Page,
  base64: string,
  frameSize: number,
  frameCount: number,
) {
  return page.evaluate(
    async ({ base64, frameSize, frameCount }) => {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = `data:image/png;base64,${base64}`;
      });

      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

      const cells: number[] = [];
      for (let cell = 0; cell < frameCount; cell++) {
        let count = 0;
        for (let y = 0; y < frameSize; y++) {
          for (let x = 0; x < frameSize; x++) {
            const index = (y * canvas.width + (cell * frameSize + x)) * 4;
            if (data[index + 3] > 0) count++;
          }
        }
        cells.push(count);
      }

      let opaque = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++;
      return { width: image.width, height: image.height, cells, opaque };
    },
    { base64, frameSize, frameCount },
  );
}

async function downloadAsBase64(
  page: import('@playwright/test').Page,
  trigger: () => Promise<void>,
) {
  const [download] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return { name: download.suggestedFilename(), base64: Buffer.concat(chunks).toString('base64') };
}

test('the sprite sheet lays every frame out in a row', async ({ page }) => {
  const editor = await Editor.open(page);

  // Four frames, one extra pixel each: 1, 2, 3, 4.
  await editor.paint(2, 8);
  for (const x of [6, 10, 14]) {
    await editor.newFrame();
    await editor.paint(x, 8);
  }
  await page.selectOption('#export-scale', '1');

  const { name, base64 } = await downloadAsBase64(page, async () => {
    await page.click('#export-frames');
    await expect(page.locator('#save-dialog')).toBeVisible();
    await expect(page.locator('#save-hint')).toContainText('4 frames in a row');
    await page.click('#save-confirm');
  });

  expect(name).toBe('pixelart-sheet-32x32-4frames.png');
  const sheet = await inspectPng(page, base64, 32, 4);
  expect([sheet.width, sheet.height]).toEqual([128, 32]);
  expect(sheet.cells).toEqual([1, 2, 3, 4]); // each frame in its own cell, in order
  expect(sheet.opaque).toBe(1 + 2 + 3 + 4); // background stayed transparent
});

test('the sheet honours the export scale', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.paint(2, 2);
  await editor.newFrame();
  await page.selectOption('#export-scale', '4');

  const { base64 } = await downloadAsBase64(page, async () => {
    await page.click('#export-frames');
    await page.click('#save-confirm');
  });

  const sheet = await inspectPng(page, base64, 128, 2);
  expect([sheet.width, sheet.height]).toEqual([32 * 4 * 2, 32 * 4]);
});

test('a solid background fills the sheet, transparency leaves it empty', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.paint(2, 2);
  await editor.newFrame();
  await page.selectOption('#export-scale', '1');
  await page.selectOption('#background', '#ffffff');

  const { base64 } = await downloadAsBase64(page, async () => {
    await page.click('#export-frames');
    await page.click('#save-confirm');
  });

  const sheet = await inspectPng(page, base64, 32, 2);
  expect(sheet.opaque).toBe(sheet.width * sheet.height); // every pixel painted
});

test('single-frame export saves just the current frame', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.paint(2, 2);
  await editor.newFrame();
  await editor.paint(5, 5);
  await page.selectOption('#export-scale', '1');

  const { name, base64 } = await downloadAsBase64(page, async () => {
    await page.click('#export');
    await page.click('#save-confirm');
  });

  expect(name).toContain('frame2');
  const png = await inspectPng(page, base64, 32, 1);
  expect([png.width, png.height]).toEqual([32, 32]);
  expect(png.opaque).toBe(2); // frame 2 holds both pixels; the sheet isn't involved
});

test('an oversized sheet is refused instead of silently failing', async ({ page }) => {
  const editor = await Editor.open(page);
  await page.selectOption('#doc-size', '128');
  await editor.paint(2, 2);
  for (let i = 0; i < 8; i++) await editor.newFrame();
  await page.selectOption('#export-scale', '16'); // 128 * 16 * 9 = 18432px wide

  await page.click('#export-frames');
  await expect(page.locator('#status')).toContainText('lower the export scale');
  await expect(page.locator('#save-dialog')).toBeHidden();
});
