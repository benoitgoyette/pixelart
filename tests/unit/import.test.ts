import { describe, expect, it } from 'vitest';
import { PixelDoc, RGBA } from '../../src/canvas';
import { Bitmap, countColors, importGeometry, resampleToGrid } from '../../src/import';
import { DEFAULT_PALETTE, hexToRgba, nearestPaletteColor, rgbaToHex } from '../../src/palette';
import { rowsFromDoc } from './helpers';

/** Builds a source bitmap from a per-pixel function. */
function bitmap(width: number, height: number, at: (x: number, y: number) => RGBA): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4);
  let i = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = at(x, y);
      data[i++] = r;
      data[i++] = g;
      data[i++] = b;
      data[i++] = a;
    }
  }
  return { width, height, data };
}

const RED: RGBA = [255, 0, 0, 255];
const BLUE: RGBA = [0, 0, 255, 255];
const CLEAR: RGBA = [0, 0, 0, 0];

/** The imported frame as a PixelDoc, so the ASCII helpers can read it. */
function imported(
  source: Bitmap,
  size: number,
  mode: 'fit' | 'crop' = 'fit',
  snapToPalette = false,
): PixelDoc {
  return new PixelDoc(size, size, resampleToGrid(source, size, size, { mode, snapToPalette }));
}

describe('importGeometry', () => {
  it('fits a wide image into a band, centered, leaving the rest clear', () => {
    const { src, dst } = importGeometry({ width: 64, height: 16 }, 32, 32, 'fit');
    expect(src).toEqual({ x: 0, y: 0, w: 64, h: 16 });
    expect(dst).toEqual({ x: 0, y: 12, w: 32, h: 8 });
  });

  it('fits a tall image into a column', () => {
    const { dst } = importGeometry({ width: 16, height: 64 }, 32, 32, 'fit');
    expect(dst).toEqual({ x: 12, y: 0, w: 8, h: 32 });
  });

  it('crops a wide image to a centered square that fills the grid', () => {
    const { src, dst } = importGeometry({ width: 64, height: 16 }, 32, 32, 'crop');
    expect(src).toEqual({ x: 24, y: 0, w: 16, h: 16 });
    expect(dst).toEqual({ x: 0, y: 0, w: 32, h: 32 });
  });

  it('leaves a source already at the grid aspect whole, either mode', () => {
    for (const mode of ['fit', 'crop'] as const) {
      const { src, dst } = importGeometry({ width: 100, height: 100 }, 32, 32, mode);
      expect(src).toEqual({ x: 0, y: 0, w: 100, h: 100 });
      expect(dst).toEqual({ x: 0, y: 0, w: 32, h: 32 });
    }
  });

  it('keeps an extreme sliver at least one cell wide', () => {
    const { dst } = importGeometry({ width: 4000, height: 1 }, 32, 32, 'fit');
    expect(dst.h).toBe(1);
  });
});

describe('resampleToGrid', () => {
  it('averages each cell over the source box behind it', () => {
    // A 4×4 split down the middle, onto a 2×2 grid: no blending across the seam.
    const source = bitmap(4, 4, (x) => (x < 2 ? RED : BLUE));
    const doc = imported(source, 2);
    expect(doc.get(0, 0)).toEqual(RED);
    expect(doc.get(1, 0)).toEqual(BLUE);
  });

  it('blends a cell that straddles two colors', () => {
    const source = bitmap(2, 1, (x) => (x === 0 ? RED : BLUE));
    const doc = imported(source, 1);
    expect(doc.get(0, 0)).toEqual([128, 0, 128, 255]);
  });

  it('upscales a tiny image into blocks rather than leaving gaps', () => {
    const source = bitmap(2, 2, (x, y) => (x === y ? RED : BLUE));
    expect(rowsFromDoc(imported(source, 4))).toEqual(['####', '####', '####', '####']);
    const doc = imported(source, 4);
    expect(doc.get(0, 0)).toEqual(RED);
    expect(doc.get(3, 0)).toEqual(BLUE);
    expect(doc.get(3, 3)).toEqual(RED);
  });

  it('leaves the bars outside a fitted image transparent', () => {
    const source = bitmap(4, 2, () => RED);
    expect(rowsFromDoc(imported(source, 4))).toEqual(['....', '####', '####', '....']);
  });

  it('fills the whole grid when cropping', () => {
    const source = bitmap(4, 2, () => RED);
    expect(rowsFromDoc(imported(source, 4, 'crop'))).toEqual(['####', '####', '####', '####']);
  });

  it('thresholds coverage instead of leaving a half-transparent fringe', () => {
    // Each destination cell averages one opaque and one clear source pixel, so
    // coverage lands at 50% — just short of the cutoff.
    const source = bitmap(2, 1, (x) => (x === 0 ? RED : CLEAR));
    const doc = imported(source, 1);
    expect(doc.get(0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('keeps a hard edge where the coverage is clean', () => {
    // One source pixel per cell, so neither cell has mixed coverage to soften.
    const source = bitmap(2, 1, (x) => (x === 0 ? RED : CLEAR));
    const doc = imported(source, 2);
    expect(doc.get(0, 0)).toEqual(RED);
    expect(doc.get(1, 0)).toEqual([0, 0, 0, 0]);
  });

  it('ignores the color of transparent pixels when averaging', () => {
    // Three quarters covered, so the cell survives the cutoff — and the colour
    // must be pure red, not red dragged toward the clear pixels' black.
    const source = bitmap(4, 1, (x) => (x === 3 ? CLEAR : RED));
    const doc = imported(source, 1);
    expect(doc.get(0, 0)).toEqual(RED);
  });

  it('produces a buffer sized exactly for the grid', () => {
    const frame = resampleToGrid(bitmap(9, 7, () => RED), 32, 32, {
      mode: 'fit',
      snapToPalette: false,
    });
    expect(frame.length).toBe(32 * 32 * 4);
  });

  it('snaps every cell to the palette when asked', () => {
    const source = bitmap(2, 2, (x, y) => [40 * x, 90 * y, 200, 255]);
    const doc = imported(source, 2, 'fit', true);

    const palette = new Set(DEFAULT_PALETTE.map((hex) => hex.toLowerCase()));
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        expect(palette).toContain(rgbaToHex(doc.get(x, y)));
      }
    }
  });
});

describe('nearestPaletteColor', () => {
  it('returns a palette entry unchanged', () => {
    for (const hex of DEFAULT_PALETTE) {
      expect(rgbaToHex(nearestPaletteColor(hexToRgba(hex)))).toBe(hex);
    }
  });

  it('matches on lightness rather than raw channel distance', () => {
    // Near-white must land on a white, not on a pale blue-grey.
    expect(rgbaToHex(nearestPaletteColor([250, 250, 250, 255]))).toBe('#ffffff');
    expect(rgbaToHex(nearestPaletteColor([10, 10, 20, 255]))).toBe('#1a1c2c');
  });

  it('carries the original alpha through', () => {
    expect(nearestPaletteColor([250, 250, 250, 0])[3]).toBe(0);
  });
});

describe('countColors', () => {
  it('counts distinct opaque colors and ignores empty cells', () => {
    const source = bitmap(2, 2, (x, y) => (x === 0 ? RED : y === 0 ? BLUE : CLEAR));
    const frame = resampleToGrid(source, 2, 2, { mode: 'crop', snapToPalette: false });
    expect(countColors(frame)).toBe(2);
  });
});
