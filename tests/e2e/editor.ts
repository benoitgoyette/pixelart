import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Page, expect } from '@playwright/test';

/** Absolute path of a test image under tests/e2e/fixtures. */
export function fixture(file: string): string {
  return join(import.meta.dirname, 'fixtures', file);
}

/**
 * Page object for the editor. Each Playwright test gets a fresh browser context,
 * so localStorage starts empty without any clearing — which matters, because an
 * init script that clears storage would also wipe it on the reloads under test.
 */
export class Editor {
  constructor(private readonly page: Page) {}

  static async open(page: Page): Promise<Editor> {
    const editor = new Editor(page);
    // Confirm dialogs are the app's guard rails; accept them unless a test
    // overrides this handler.
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto('/');
    await expect(page.locator('#canvas')).toBeVisible();
    return editor;
  }

  // --- geometry --------------------------------------------------------------

  /** Screen position of the centre of art-pixel (cx, cy) — for hand-rolled gestures. */
  cellPoint(cx: number, cy: number): Promise<{ x: number; y: number }> {
    return this.cell(cx, cy);
  }

  /** Screen position of the centre of art-pixel (cx, cy). */
  private async cell(cx: number, cy: number): Promise<{ x: number; y: number }> {
    const box = await this.page.locator('#canvas').boundingBox();
    if (!box) throw new Error('canvas has no box');
    const size = await this.canvasSize();
    return {
      x: box.x + ((cx + 0.5) * box.width) / size,
      y: box.y + ((cy + 0.5) * box.height) / size,
    };
  }

  canvasSize(): Promise<number> {
    return this.page.locator('#doc-size').inputValue().then(Number);
  }

  // --- drawing ---------------------------------------------------------------

  /** A single click on an art cell. */
  async clickCell(cx: number, cy: number): Promise<void> {
    const at = await this.cell(cx, cy);
    await this.page.mouse.move(at.x, at.y);
    await this.page.mouse.down();
    await this.page.mouse.up();
  }

  /** Same gesture, named for what it does with a drawing tool selected. */
  paint(cx: number, cy: number): Promise<void> {
    return this.clickCell(cx, cy);
  }

  /** Both marquee tools are click-to-start, click-to-finish. */
  async selectRegion(from: [number, number], to: [number, number]): Promise<void> {
    await this.clickCell(...from);
    await this.hoverCell(...to); // let the marquee track the cursor first
    await this.clickCell(...to);
  }

  /** The cursor the browser actually shows over the canvas. */
  canvasCursor(): Promise<string> {
    return this.page.locator('#canvas').evaluate((el) => getComputedStyle(el).cursor);
  }

  async hoverCell(cx: number, cy: number): Promise<void> {
    const at = await this.cell(cx, cy);
    await this.page.mouse.move(at.x, at.y);
  }

  async dragOnCanvas(from: [number, number], to: [number, number]): Promise<void> {
    const a = await this.cell(...from);
    const b = await this.cell(...to);
    await this.page.mouse.move(a.x, a.y);
    await this.page.mouse.down();
    await this.page.mouse.move(b.x, b.y, { steps: 8 });
    await this.page.mouse.up();
  }

  selectTool(tool: string): Promise<void> {
    return this.page.locator(`.tool[data-tool="${tool}"]`).click();
  }

  /** Mirror editing is a modifier, so this toggles rather than selects. */
  toggleMirror(): Promise<void> {
    return this.page.click('#mirror-tool');
  }

  /** Switches mirroring on if it isn't already, then picks its axis. */
  async setMirrorAxis(axis: 'vertical' | 'horizontal'): Promise<void> {
    if (!(await this.mirrorOn())) await this.toggleMirror();
    await this.page.selectOption('#mirror-axis', axis);
  }

  mirrorOn(): Promise<boolean> {
    return this.page
      .locator('#mirror-tool')
      .getAttribute('aria-pressed')
      .then((value) => value === 'true');
  }

  // --- image import ----------------------------------------------------------

  /** Imports through the file picker. `file` is a path under tests/e2e/fixtures. */
  async importFile(file: string): Promise<void> {
    await this.page.setInputFiles('#import-file', fixture(file));
    await expect(this.page.locator('#status')).toContainText('imported');
  }

  /**
   * Drops a fixture onto the canvas for real: the bytes are read here and
   * rebuilt as a File inside the page, since a DataTransfer can only be
   * assembled in the browser.
   */
  async dropFile(file: string): Promise<void> {
    const bytes = [...readFileSync(fixture(file))];
    await this.page.dispatchEvent('#stage', 'drop', {
      dataTransfer: await this.page.evaluateHandle(
        ([name, data]) => {
          const transfer = new DataTransfer();
          transfer.items.add(
            new File([new Uint8Array(data as number[])], name as string, { type: 'image/png' }),
          );
          return transfer;
        },
        [file, bytes] as [string, number[]],
      ),
    });
  }

  /** The colors of the current frame, as hex, keyed by cell. */
  frameColors(cells: Array<[number, number]>): Promise<string[]> {
    return this.page.evaluate((wanted) => {
      const thumb = document.querySelector<HTMLCanvasElement>('.frame-thumb')!;
      const data = thumb.getContext('2d')!.getImageData(0, 0, thumb.width, thumb.height).data;
      const part = (n: number) => n.toString(16).padStart(2, '0');
      return wanted.map(([x, y]) => {
        const i = (y * thumb.width + x) * 4;
        if (data[i + 3] === 0) return 'clear';
        return `#${part(data[i])}${part(data[i + 1])}${part(data[i + 2])}`;
      });
    }, cells);
  }

  /** Empties the current frame (the confirm is auto-accepted). */
  clearFrame(): Promise<void> {
    return this.page.click('#clear');
  }

  // --- inspection ------------------------------------------------------------

  /** Opaque pixel count per frame, read from the filmstrip thumbnails. */
  framePixelCounts(): Promise<number[]> {
    return this.page.evaluate(() =>
      [...document.querySelectorAll<HTMLCanvasElement>('.frame-thumb')].map((thumb) => {
        const data = thumb.getContext('2d')!.getImageData(0, 0, thumb.width, thumb.height).data;
        let count = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count++;
        return count;
      }),
    );
  }

  /** Indices of opaque pixels per frame — position, not just quantity. */
  framePixelIndices(): Promise<number[][]> {
    return this.page.evaluate(() =>
      [...document.querySelectorAll<HTMLCanvasElement>('.frame-thumb')].map((thumb) => {
        const data = thumb.getContext('2d')!.getImageData(0, 0, thumb.width, thumb.height).data;
        const on: number[] = [];
        for (let i = 3; i < data.length; i += 4) if (data[i] > 0) on.push((i - 3) / 4);
        return on;
      }),
    );
  }

  /** Opaque cells of one frame (1-based) as [x, y] pairs, so failures read as coordinates. */
  framePixelCells(oneBased = 1): Promise<Array<[number, number]>> {
    return this.page.evaluate((index) => {
      const thumb = document.querySelectorAll<HTMLCanvasElement>('.frame-thumb')[index];
      const data = thumb.getContext('2d')!.getImageData(0, 0, thumb.width, thumb.height).data;
      const cells: Array<[number, number]> = [];
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] === 0) continue;
        const cell = (i - 3) / 4;
        cells.push([cell % thumb.width, Math.floor(cell / thumb.width)]);
      }
      return cells;
    }, oneBased - 1);
  }

  frameCounter(): Promise<string> {
    return this.page.locator('#frame-counter').innerText();
  }

  /** 1-based index of the frame being edited. */
  async currentFrame(): Promise<number> {
    return Number((await this.frameCounter()).split('/')[0].trim());
  }

  frameCount(): Promise<number> {
    return this.page.locator('.frame-item').count();
  }

  status(): Promise<string> {
    return this.page.locator('#status').innerText();
  }

  projectName(): Promise<string> {
    return this.page.locator('#project-name').innerText();
  }

  storedFrames(): Promise<string[]> {
    return this.page.evaluate(
      () => JSON.parse(localStorage.getItem('pixelart:doc') ?? '{}').frames ?? [],
    );
  }

  // --- frames ----------------------------------------------------------------

  newFrame(): Promise<void> {
    return this.page.click('#new-frame');
  }

  selectFrame(oneBased: number): Promise<void> {
    return this.page.locator('.frame-item').nth(oneBased - 1).click();
  }

  /** Drags a frame thumbnail to the given horizontal edge of the strip. */
  async dragFrame(oneBased: number, target: 'start' | 'end'): Promise<void> {
    const item = this.page.locator('.frame-item');
    const from = await item.nth(oneBased - 1).boundingBox();
    const edge =
      target === 'end'
        ? await item.nth((await item.count()) - 1).boundingBox()
        : await item.nth(0).boundingBox();
    if (!from || !edge) throw new Error('missing frame box');

    await this.page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await this.page.mouse.down();
    const x = target === 'end' ? edge.x + edge.width : edge.x - 4;
    await this.page.mouse.move(x, from.y + from.height / 2, { steps: 12 });
    await this.page.mouse.up();
  }

  // --- persistence -----------------------------------------------------------

  async reload(): Promise<void> {
    await this.page.reload();
    await expect(this.page.locator('#canvas')).toBeVisible();
  }

  /** Saves to the library under `name`, waiting for the toolbar to confirm. */
  async saveAs(name: string): Promise<void> {
    await this.page.click('#save-animation');
    await this.page.fill('#save-name', name);
    await this.page.click('#save-confirm');
    await expect(this.page.locator('#project-name')).toHaveText(name);
  }

  openLibrary(): Promise<void> {
    return this.page.click('#open-library');
  }

  libraryNames(): Promise<string[]> {
    return this.page.locator('.library-name').allInnerTexts();
  }

  libraryRow(name: string) {
    return this.page.locator('.library-row', { hasText: name });
  }
}

/** Waits for a dialog to finish closing; its close event runs in a task. */
export async function closed(page: Page, selector: string): Promise<void> {
  await expect(page.locator(`${selector}[open]`)).toHaveCount(0);
}
