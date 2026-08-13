import { expect, test } from '@playwright/test';
import { Editor } from './editor';

test('a dropped image is converted into the frame', async ({ page }) => {
  const editor = await Editor.open(page);
  const size = await editor.canvasSize();

  await editor.dropFile('quad.png');
  await expect(page.locator('#status')).toContainText('imported quad.png');

  // A 2×2 source covers the grid in four flat blocks, one colour each.
  expect((await editor.framePixelCounts())[0]).toBe(size * size);
  expect(
    await editor.frameColors([
      [0, 0],
      [size - 1, 0],
      [0, size - 1],
      [size - 1, size - 1],
    ]),
  ).toEqual(['#ff0000', '#00ff00', '#0000ff', '#ffffff']);
});

test('the file picker imports the same way', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.importFile('quad.png');
  expect((await editor.frameColors([[0, 0]]))[0]).toBe('#ff0000');
});

test('the status line reports the size and colour count', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.importFile('quad.png');
  expect(await editor.status()).toBe('imported quad.png — 32 × 32, 4 colors');
});

test('fit keeps the whole image and leaves transparent bars', async ({ page }) => {
  const editor = await Editor.open(page);
  const size = await editor.canvasSize();

  await editor.importFile('wide.png');

  // 64×16 fitted onto 32×32 lands as an 8-row band, centred.
  const rows = new Set((await editor.framePixelCells()).map(([, y]) => y));
  expect([...rows].sort((a, b) => a - b)).toEqual([12, 13, 14, 15, 16, 17, 18, 19]);
  expect(await editor.frameColors([[0, 16], [size - 1, 16], [0, 0]])).toEqual([
    '#ff0000',
    '#0000ff',
    'clear',
  ]);
});

test('crop fills the whole grid instead', async ({ page }) => {
  const editor = await Editor.open(page);
  const size = await editor.canvasSize();

  await page.selectOption('#import-fit', 'crop');
  await editor.importFile('wide.png');

  expect((await editor.framePixelCounts())[0]).toBe(size * size);
  // The centred square of the source spans both halves, so the split survives.
  expect(await editor.frameColors([[0, 0], [size - 1, size - 1]])).toEqual([
    '#ff0000',
    '#0000ff',
  ]);
});

test('snapping to the palette keeps every colour in the palette', async ({ page }) => {
  const editor = await Editor.open(page);

  await page.check('#import-snap');
  await editor.importFile('quad.png');

  const corners = await editor.frameColors([[0, 0], [31, 0], [0, 31], [31, 31]]);
  const palette = await page.locator('#palette .swatch').evaluateAll((swatches) =>
    swatches.map((swatch) => (swatch as HTMLElement).dataset.hex!.toLowerCase()),
  );
  for (const color of corners) expect(palette).toContain(color);
  // Pure red is not in the palette, so snapping must have moved it.
  expect(corners).not.toContain('#ff0000');
});

test('transparency in the source survives the import', async ({ page }) => {
  const editor = await Editor.open(page);
  const size = await editor.canvasSize();

  await editor.importFile('half-clear.png');

  // 2×1 fitted onto the grid: a 16-row band, red on the left, clear on the right.
  const cells = await editor.framePixelCells();
  expect(cells.every(([x]) => x < size / 2)).toBe(true);
  expect((await editor.frameColors([[0, 16]]))[0]).toBe('#ff0000');
});

test('an import is one undo step over whatever was there', async ({ page }) => {
  const editor = await Editor.open(page);

  await editor.paint(5, 5);
  expect((await editor.framePixelCounts())[0]).toBe(1);

  await editor.importFile('quad.png');
  expect((await editor.framePixelCounts())[0]).toBe(32 * 32);

  await page.click('#undo');
  // The drawing is back, exactly as it was.
  expect(await editor.framePixelCells()).toEqual([[5, 5]]);

  await page.click('#redo');
  expect((await editor.framePixelCounts())[0]).toBe(32 * 32);
});

test('the import lands on the frame being edited, not the first one', async ({ page }) => {
  const editor = await Editor.open(page);

  await editor.newFrame();
  await editor.newFrame();
  expect(await editor.currentFrame()).toBe(3);

  await editor.importFile('quad.png');
  const counts = await editor.framePixelCounts();
  expect(counts[0]).toBe(0);
  expect(counts[2]).toBe(32 * 32);
});

test('a non-image file is refused, leaving the art alone', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.paint(5, 5);

  await page.setInputFiles('#import-file', {
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not an image'),
  });

  await expect(page.locator('#status')).toContainText('not an image file');
  expect(await editor.framePixelCells()).toEqual([[5, 5]]);
});

test('a corrupt image is reported rather than throwing', async ({ page }) => {
  const editor = await Editor.open(page);

  await page.setInputFiles('#import-file', {
    name: 'broken.png',
    mimeType: 'image/png',
    buffer: Buffer.from('\x89PNG\r\n\x1a\n garbage'),
  });

  await expect(page.locator('#status')).toContainText('could not read broken.png');
  expect(await editor.framePixelCounts()).toEqual([0]);
});

test('the framing choice is remembered across a reload', async ({ page }) => {
  const editor = await Editor.open(page);
  await page.selectOption('#import-fit', 'crop');
  await page.check('#import-snap');

  await editor.reload();
  await expect(page.locator('#import-fit')).toHaveValue('crop');
  await expect(page.locator('#import-snap')).toBeChecked();
});

test('dragging over the canvas shows a drop hint that clears on leave', async ({ page }) => {
  await Editor.open(page);
  const stage = page.locator('#stage');

  const transfer = await page.evaluateHandle(() => {
    const t = new DataTransfer();
    t.items.add(new File([new Uint8Array([1])], 'x.png', { type: 'image/png' }));
    return t;
  });

  await stage.dispatchEvent('dragover', { dataTransfer: transfer });
  await expect(stage).toHaveClass(/dropping/);

  await stage.dispatchEvent('dragleave', { dataTransfer: transfer });
  await expect(stage).not.toHaveClass(/dropping/);
});
