import { RGBA, TRANSPARENT } from './canvas';
import { nearestPaletteColor } from './palette';

/**
 * How a source image is mapped onto the grid: `fit` keeps all of it and leaves
 * transparent bars on the short axis, `crop` fills the grid and trims the
 * overhang off both ends of the long one.
 */
export type FitMode = 'fit' | 'crop';

/** Coverage a cell needs to count as solid. Below it the cell goes fully clear. */
export const ALPHA_CUTOFF = 128;

/** Longest side we read at. Beyond this the browser pre-scales; see fileToBitmap. */
export const MAX_SOURCE_SIDE = 2048;

/** A bare pixel buffer — what a canvas ImageData and a test fixture both are. */
export interface Bitmap {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImportOptions {
  mode: FitMode;
  /** Snap every cell to the editor's palette, which reads as deliberate pixel art. */
  snapToPalette: boolean;
}

/**
 * The source rectangle that gets sampled, and the grid rectangle it lands in.
 * One of the two is always the whole thing: `fit` shrinks the destination,
 * `crop` shrinks the source.
 */
export function importGeometry(
  source: { width: number; height: number },
  width: number,
  height: number,
  mode: FitMode,
): { src: Rect; dst: Rect } {
  const whole = { x: 0, y: 0, w: source.width, h: source.height };

  if (mode === 'fit') {
    const scale = Math.min(width / source.width, height / source.height);
    // At least one cell, so a very wide sliver still leaves a visible line.
    const w = Math.max(1, Math.min(width, Math.round(source.width * scale)));
    const h = Math.max(1, Math.min(height, Math.round(source.height * scale)));
    return {
      src: whole,
      dst: { x: Math.floor((width - w) / 2), y: Math.floor((height - h) / 2), w, h },
    };
  }

  // Crop: the largest centered rectangle of the source with the grid's aspect.
  const wider = source.width * height > source.height * width;
  const w = wider ? Math.max(1, Math.round((source.height * width) / height)) : source.width;
  const h = wider ? source.height : Math.max(1, Math.round((source.width * height) / width));
  return {
    src: {
      x: Math.floor((source.width - w) / 2),
      y: Math.floor((source.height - h) / 2),
      w,
      h,
    },
    dst: { x: 0, y: 0, w: width, h: height },
  };
}

/**
 * Averages the source box behind one grid cell. Alpha-weighted, so transparent
 * pixels contribute nothing: averaging their stale RGB would drag edges toward
 * black and leave a dark fringe around cut-out artwork.
 */
function averageBox(source: Bitmap, x0: number, y0: number, x1: number, y1: number): RGBA {
  // Half-open, and never empty: a box narrower than a pixel still samples one.
  const left = Math.max(0, Math.floor(x0));
  const top = Math.max(0, Math.floor(y0));
  const right = Math.min(source.width, Math.max(left + 1, Math.ceil(x1)));
  const bottom = Math.min(source.height, Math.max(top + 1, Math.ceil(y1)));

  let r = 0;
  let g = 0;
  let b = 0;
  let alpha = 0;
  let count = 0;

  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const i = (y * source.width + x) * 4;
      const a = source.data[i + 3];
      r += source.data[i] * a;
      g += source.data[i + 1] * a;
      b += source.data[i + 2] * a;
      alpha += a;
      count++;
    }
  }

  if (count === 0 || alpha === 0) return TRANSPARENT;
  return [Math.round(r / alpha), Math.round(g / alpha), Math.round(b / alpha), alpha / count];
}

/**
 * Downsamples `source` onto a width × height grid, one box average per cell.
 * The result is a frame buffer ready for `new PixelDoc(width, height, bytes)`.
 *
 * Coverage is thresholded rather than kept: pixel art wants hard edges, and a
 * halo of half-transparent cells would read as extra colors to the fill tool.
 */
export function resampleToGrid(
  source: Bitmap,
  width: number,
  height: number,
  { mode, snapToPalette }: ImportOptions,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const { src, dst } = importGeometry(source, width, height, mode);

  const perCellX = src.w / dst.w;
  const perCellY = src.h / dst.h;

  for (let row = 0; row < dst.h; row++) {
    const y0 = src.y + row * perCellY;
    for (let column = 0; column < dst.w; column++) {
      const x0 = src.x + column * perCellX;
      const averaged = averageBox(source, x0, y0, x0 + perCellX, y0 + perCellY);

      if (averaged[3] < ALPHA_CUTOFF) continue; // out stays transparent
      const color = snapToPalette ? nearestPaletteColor(averaged) : averaged;

      const i = ((dst.y + row) * width + dst.x + column) * 4;
      out[i] = color[0];
      out[i + 1] = color[1];
      out[i + 2] = color[2];
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Distinct opaque colors in a frame buffer — for reporting what an import produced. */
export function countColors(frame: Uint8ClampedArray): number {
  const seen = new Set<number>();
  for (let i = 0; i < frame.length; i += 4) {
    if (frame[i + 3] === 0) continue;
    seen.add((frame[i] << 16) | (frame[i + 1] << 8) | frame[i + 2]);
  }
  return seen.size;
}

/**
 * Decodes a dropped or chosen file into a pixel buffer, pre-scaled so a photo
 * from a phone doesn't mean holding 60MB of ImageData. The pre-scale is at most
 * a 2× reduction short of the grid in practice, and box averaging does the rest.
 */
export async function fileToBitmap(file: File): Promise<Bitmap> {
  const bitmap = await createImageBitmap(file);
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > MAX_SOURCE_SIDE ? MAX_SOURCE_SIDE / longest : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const scratch = document.createElement('canvas');
    scratch.width = width;
    scratch.height = height;
    const ctx = scratch.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas context unavailable');

    // Smoothing on: this step is a reduction, and it feeds an averaging pass.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);

    const image = ctx.getImageData(0, 0, width, height);
    return { width, height, data: image.data };
  } finally {
    bitmap.close();
  }
}

/** Whether a dropped file is worth handing to the decoder. */
export function isImageFile(file: File): boolean {
  // Some platforms hand over an empty type for less common formats, so fall back
  // to the extension rather than refusing the file outright.
  return file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(file.name);
}
