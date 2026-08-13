import { expect, test } from '@playwright/test';
import { Editor } from './editor';

test('several animations are kept side by side', async ({ page }) => {
  const editor = await Editor.open(page);

  await editor.paint(3, 3);
  await editor.newFrame();
  await editor.paint(6, 6);
  await editor.saveAs('walk-cycle');

  await page.click('#new-drawing');
  await editor.paint(4, 4);
  await editor.saveAs('idle-pose');

  await editor.openLibrary();
  expect(await editor.libraryNames()).toEqual(['idle-pose', 'walk-cycle']); // newest first
  await expect(editor.libraryRow('walk-cycle')).toContainText('2 frames');
});

test('loading restores frames and canvas size', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.paint(3, 3);
  await editor.newFrame();
  await editor.paint(6, 6);
  await editor.saveAs('walk-cycle');

  await page.selectOption('#doc-size', '16'); // a different drawing, different size
  await editor.paint(4, 4);
  await editor.saveAs('small');

  await editor.openLibrary();
  await editor.libraryRow('walk-cycle').locator('button.primary').click();

  await expect(page.locator('#project-name')).toHaveText('walk-cycle');
  expect(await editor.framePixelCounts()).toEqual([1, 2]);
  expect(await page.locator('#doc-size').inputValue()).toBe('32');
});

test('the unsaved marker appears on edit and clears on save', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.paint(3, 3);
  expect(await editor.projectName()).toContain('•');

  await editor.saveAs('hero');
  expect(await editor.projectName()).toBe('hero');

  await editor.paint(5, 5);
  expect(await editor.projectName()).toContain('•');
});

test('Cmd+S saves without touching the toolbar', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.paint(3, 3);

  await page.keyboard.press('Meta+s');
  await page.fill('#save-name', 'via-shortcut');
  await page.click('#save-confirm');

  await expect(page.locator('#project-name')).toHaveText('via-shortcut');
});

test('saving under the same name updates, a new name copies', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.paint(3, 3);
  await editor.saveAs('hero');

  await editor.paint(4, 4);
  await editor.saveAs('hero'); // same name: still one entry
  await editor.openLibrary();
  expect(await editor.libraryNames()).toEqual(['hero']);
  await page.click('#library-close');

  await editor.paint(5, 5);
  await editor.saveAs('hero-v2'); // new name: a copy alongside
  await editor.openLibrary();
  expect((await editor.libraryNames()).sort()).toEqual(['hero', 'hero-v2']);
});

test('deleting removes only the chosen animation', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.paint(3, 3);
  await editor.saveAs('keep');
  await page.click('#new-drawing');
  await editor.paint(4, 4);
  await editor.saveAs('drop');

  await editor.openLibrary();
  await editor.libraryRow('drop').getByText('Delete').click();
  expect(await editor.libraryNames()).toEqual(['keep']);
});

test('the library and the working drawing both survive a reload', async ({ page }) => {
  const editor = await Editor.open(page);
  await editor.paint(3, 3);
  await editor.newFrame();
  await editor.paint(6, 6);
  await editor.saveAs('persisted');

  await editor.reload();
  expect(await editor.projectName()).toBe('persisted');
  expect(await editor.framePixelCounts()).toEqual([1, 2]);

  await editor.openLibrary();
  expect(await editor.libraryNames()).toEqual(['persisted']);
});

test.describe('unsaved-changes prompt', () => {
  test('New on clean work does not ask', async ({ page }) => {
    const editor = await Editor.open(page);
    await page.click('#new-drawing');
    await expect(page.locator('#unsaved-dialog')).toBeHidden();
    expect(await editor.frameCount()).toBe(1);
  });

  test('Cancel keeps the work exactly as it was', async ({ page }) => {
    const editor = await Editor.open(page);
    await editor.paint(3, 3);
    await editor.newFrame();
    const before = await editor.framePixelCounts();

    await page.click('#new-drawing');
    await expect(page.locator('#unsaved-dialog')).toBeVisible();
    await page.click('#unsaved-cancel');

    await expect(page.locator('#status')).toContainText('cancelled');
    expect(await editor.framePixelCounts()).toEqual(before);
  });

  test("Don't save discards and resets to one empty frame", async ({ page }) => {
    const editor = await Editor.open(page);
    await editor.paint(3, 3);
    await editor.newFrame();

    await page.click('#new-drawing');
    await page.click('#unsaved-discard');

    await expect(page.locator('#project-name')).toHaveText('untitled');
    expect(await editor.framePixelCounts()).toEqual([0]);
  });

  test('Save stores the work first, then resets', async ({ page }) => {
    const editor = await Editor.open(page);
    await editor.paint(3, 3);

    await page.click('#new-drawing');
    await page.click('#unsaved-save');
    await page.fill('#save-name', 'rescued');
    await page.click('#save-confirm');

    await expect(page.locator('#project-name')).toHaveText('untitled');
    expect(await editor.framePixelCounts()).toEqual([0]);
    await editor.openLibrary();
    expect(await editor.libraryNames()).toEqual(['rescued']);
  });

  test('cancelling the name prompt abandons the new drawing', async ({ page }) => {
    const editor = await Editor.open(page);
    await editor.paint(3, 3);
    const before = await editor.framePixelCounts();

    await page.click('#new-drawing');
    await page.click('#unsaved-save');
    await page.click('#save-cancel'); // backed out of naming it

    // The work must survive: it was never saved, so it must not be discarded.
    await expect(page.locator('#status')).toContainText('cancelled');
    expect(await editor.framePixelCounts()).toEqual(before);
  });

  test('loading over unsaved work asks the same way', async ({ page }) => {
    const editor = await Editor.open(page);
    await editor.paint(3, 3);
    await editor.saveAs('saved-one');
    await page.click('#new-drawing');
    await editor.paint(7, 7); // unsaved work in progress

    await editor.openLibrary();
    await editor.libraryRow('saved-one').locator('button.primary').click();
    await expect(page.locator('#unsaved-dialog')).toBeVisible();

    await page.click('#unsaved-discard');
    await expect(page.locator('#project-name')).toHaveText('saved-one');
  });
});
