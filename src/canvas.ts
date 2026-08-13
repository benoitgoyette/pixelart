/** RGBA color, each channel 0-255. */
export type RGBA = [number, number, number, number];

export const TRANSPARENT: RGBA = [0, 0, 0, 0];

/**
 * A pixel document: a flat RGBA buffer plus the geometry to address it.
 * This is the single source of truth; the on-screen canvas is only a view of it.
 */
export class PixelDoc {
  readonly width: number;
  readonly height: number;
  data: Uint8ClampedArray;

  constructor(width: number, height: number, data?: Uint8ClampedArray) {
    this.width = width;
    this.height = height;
    this.data = data ?? new Uint8ClampedArray(width * height * 4);
  }

  contains(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): RGBA {
    const i = (y * this.width + x) * 4;
    const d = this.data;
    return [d[i], d[i + 1], d[i + 2], d[i + 3]];
  }

  set(x: number, y: number, color: RGBA): void {
    if (!this.contains(x, y)) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = color[0];
    this.data[i + 1] = color[1];
    this.data[i + 2] = color[2];
    this.data[i + 3] = color[3];
  }

  clear(): void {
    this.data.fill(0);
  }

  snapshot(): Uint8ClampedArray {
    return this.data.slice();
  }

  restore(snapshot: Uint8ClampedArray): void {
    this.data.set(snapshot);
  }
}

export function sameColor(a: RGBA, b: RGBA): boolean {
  // Fully transparent pixels are equal regardless of their stale RGB channels.
  if (a[3] === 0 && b[3] === 0) return true;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

/** Bresenham line, so a fast drag paints a continuous stroke instead of dots. */
export function linePoints(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;

  for (;;) {
    points.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return points;
}

/**
 * Rotates the document clockwise about its center into a new doc of the same
 * size, sampling nearest-neighbor so no new colors appear. Corners swept outside
 * the canvas are clipped; area swept in is transparent.
 *
 * Right angles use exact index permutations rather than trigonometry, so 90°,
 * 180°, and 270° are lossless and perfectly reversible.
 */
export function rotate(source: PixelDoc, degrees: number): PixelDoc {
  const angle = ((Math.round(degrees) % 360) + 360) % 360;
  const w = source.width;
  const h = source.height;
  const out = new PixelDoc(w, h);

  if (angle === 0) {
    out.data.set(source.data);
    return out;
  }

  const square = w === h;
  if (angle === 180 || (square && (angle === 90 || angle === 270))) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = angle === 90 ? y : angle === 180 ? w - 1 - x : w - 1 - y;
        const sy = angle === 90 ? h - 1 - x : angle === 180 ? h - 1 - y : x;
        out.set(x, y, source.get(sx, sy));
      }
    }
    return out;
  }

  // Inverse mapping: walk destination pixels and pull from the source, which
  // leaves no unwritten holes the way a forward scatter would.
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const sx = Math.round(cx + dx * cos + dy * sin);
      const sy = Math.round(cy - dx * sin + dy * cos);
      if (source.contains(sx, sy)) out.set(x, y, source.get(sx, sy));
    }
  }
  return out;
}

/**
 * A rectangle of pixels held outside any document — what the select tool lifts
 * off the canvas so it can be dragged around and put back down elsewhere.
 */
export interface Region {
  w: number;
  h: number;
  /** w × h RGBA quadruplets, row-major. */
  data: Uint8ClampedArray;
}

/** Copies the pixels inside `rect` out of `doc`; cells past its edges read transparent. */
export function liftRegion(doc: PixelDoc, rect: Rect): Region {
  const data = new Uint8ClampedArray(rect.w * rect.h * 4);
  let i = 0;
  for (let row = 0; row < rect.h; row++) {
    for (let column = 0; column < rect.w; column++) {
      const x = rect.x + column;
      const y = rect.y + row;
      const [r, g, b, a] = doc.contains(x, y) ? doc.get(x, y) : TRANSPARENT;
      data[i++] = r;
      data[i++] = g;
      data[i++] = b;
      data[i++] = a;
    }
  }
  return { w: rect.w, h: rect.h, data };
}

/**
 * Writes `region` into `doc` with its top-left corner at (x, y), replacing what
 * was there — transparent cells included, so a move leaves no ghost of the
 * pixels it landed on. Cells outside the document are dropped.
 */
export function stampRegion(doc: PixelDoc, region: Region, x: number, y: number): void {
  let i = 0;
  for (let row = 0; row < region.h; row++) {
    for (let column = 0; column < region.w; column++) {
      doc.set(x + column, y + row, [
        region.data[i],
        region.data[i + 1],
        region.data[i + 2],
        region.data[i + 3],
      ]);
      i += 4;
    }
  }
}

const CHECKER_LIGHT = '#3a3a42';
const CHECKER_DARK = '#31313a';
const CHECKER_SIZE = 8; // screen pixels

export interface RenderOptions {
  zoom: number;
  showGrid: boolean;
  /** CSS color painted behind the art, or null to keep it transparent. */
  background: string | null;
  /** Cell to ring as an interaction hint (the polygon's closing point). */
  marker?: [number, number] | null;
  /** Marquee drawn over the art, in art-pixel coordinates. */
  selection?: Rect | null;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Paints the document into a display canvas at `zoom` screen-pixels per art-pixel,
 * over a transparency checkerboard, with an optional pixel grid on top.
 */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly scratch: HTMLCanvasElement;
  private readonly scratchCtx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = require2d(canvas);
    this.scratch = document.createElement('canvas');
    this.scratchCtx = require2d(this.scratch);
  }

  render(doc: PixelDoc, { zoom, showGrid, background, marker, selection }: RenderOptions): void {
    const w = doc.width * zoom;
    const h = doc.height * zoom;

    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    // The checkerboard stands in for "no background"; a solid color replaces it.
    if (background === null) {
      this.drawCheckerboard(w, h);
    } else {
      this.ctx.fillStyle = background;
      this.ctx.fillRect(0, 0, w, h);
    }
    this.drawPixels(doc, w, h);
    if (showGrid && zoom >= 6) this.drawGrid(doc, zoom, w, h);
    if (marker) this.drawMarker(marker, zoom);
    if (selection) this.drawSelection(selection, zoom);
  }

  /** Marching-ants style marquee — an overlay, never part of the art. */
  private drawSelection(rect: Rect, zoom: number): void {
    const ctx = this.ctx;
    const x = rect.x * zoom;
    const y = rect.y * zoom;
    const w = rect.w * zoom;
    const h = rect.h * zoom;

    ctx.save();
    // A dark underlay keeps the dashes readable over light and dark art alike.
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#41a6f6';
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
  }

  /** An overlay ring — screen-space only, so it never touches pixel data. */
  private drawMarker([mx, my]: [number, number], zoom: number): void {
    const ctx = this.ctx;
    const inset = Math.max(1, Math.round(zoom / 8));
    ctx.lineWidth = Math.max(1, Math.round(zoom / 6));
    ctx.strokeStyle = '#41a6f6';
    ctx.strokeRect(
      mx * zoom - inset + 0.5,
      my * zoom - inset + 0.5,
      zoom + inset * 2 - 1,
      zoom + inset * 2 - 1,
    );
  }

  private drawCheckerboard(w: number, h: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = CHECKER_DARK;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = CHECKER_LIGHT;
    for (let y = 0; y < h; y += CHECKER_SIZE) {
      for (let x = (y / CHECKER_SIZE) % 2 ? CHECKER_SIZE : 0; x < w; x += CHECKER_SIZE * 2) {
        ctx.fillRect(x, y, CHECKER_SIZE, CHECKER_SIZE);
      }
    }
  }

  private drawPixels(doc: PixelDoc, w: number, h: number): void {
    // Blit the document at 1:1 into a scratch canvas, then scale it up with
    // smoothing off — far cheaper than filling one rect per pixel.
    if (this.scratch.width !== doc.width || this.scratch.height !== doc.height) {
      this.scratch.width = doc.width;
      this.scratch.height = doc.height;
    }
    const image = new ImageData(doc.data.slice(), doc.width, doc.height);
    this.scratchCtx.putImageData(image, 0, 0);

    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.scratch, 0, 0, w, h);
  }

  private drawGrid(doc: PixelDoc, zoom: number, w: number, h: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < doc.width; x++) {
      ctx.moveTo(x * zoom + 0.5, 0);
      ctx.lineTo(x * zoom + 0.5, h);
    }
    for (let y = 1; y < doc.height; y++) {
      ctx.moveTo(0, y * zoom + 0.5);
      ctx.lineTo(w, y * zoom + 0.5);
    }
    ctx.stroke();
  }
}

/**
 * Renders the document to a PNG blob, scaled up with nearest-neighbor.
 * A null background leaves untouched pixels transparent in the exported file.
 */
export function toPngBlob(
  doc: PixelDoc,
  scale: number,
  background: string | null = null,
): Promise<Blob> {
  const source = document.createElement('canvas');
  source.width = doc.width;
  source.height = doc.height;
  require2d(source).putImageData(new ImageData(doc.data.slice(), doc.width, doc.height), 0, 0);

  const out = document.createElement('canvas');
  out.width = doc.width * scale;
  out.height = doc.height * scale;
  const ctx = require2d(out);
  if (background !== null) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, out.width, out.height);
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, out.width, out.height);

  return new Promise((resolve, reject) => {
    out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png');
  });
}

/** Widest sheet browsers reliably encode; beyond this, canvases silently fail. */
export const MAX_SHEET_PX = 16384;

/**
 * Packs every frame into one PNG, laid out left to right at `scale`. Frames keep
 * a uniform cell size, so an engine can slice the strip by width alone.
 */
export function toSpriteSheetBlob(
  docs: PixelDoc[],
  scale: number,
  background: string | null = null,
): Promise<Blob> {
  if (docs.length === 0) return Promise.reject(new Error('no frames to export'));

  const cellWidth = docs[0].width * scale;
  const cellHeight = docs[0].height * scale;

  const sheet = document.createElement('canvas');
  sheet.width = cellWidth * docs.length;
  sheet.height = cellHeight;

  const ctx = require2d(sheet);
  if (background !== null) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, sheet.width, sheet.height);
  }
  ctx.imageSmoothingEnabled = false;

  // One scratch canvas reused for every frame's 1:1 blit.
  const scratch = document.createElement('canvas');
  scratch.width = docs[0].width;
  scratch.height = docs[0].height;
  const scratchCtx = require2d(scratch);

  docs.forEach((doc, index) => {
    scratchCtx.clearRect(0, 0, scratch.width, scratch.height);
    scratchCtx.putImageData(new ImageData(doc.data.slice(), doc.width, doc.height), 0, 0);
    ctx.drawImage(scratch, index * cellWidth, 0, cellWidth, cellHeight);
  });

  return new Promise((resolve, reject) => {
    sheet.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))),
      'image/png',
    );
  });
}

function require2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas context unavailable');
  return ctx;
}
