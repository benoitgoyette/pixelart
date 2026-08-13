import { PixelDoc, RGBA, TRANSPARENT, linePoints, sameColor } from './canvas';

export type ToolId =
  | 'pencil'
  | 'eraser'
  | 'bucket'
  | 'eyedropper'
  | 'line'
  | 'rect'
  | 'oval'
  | 'polygon'
  | 'select';

/** Tools drawn by dragging out a preview and committing on release. */
export type ShapeTool = Extract<ToolId, 'line' | 'rect' | 'oval'>;

export interface ToolDef {
  id: ToolId;
  label: string;
  icon: string;
  shortcut: string;
}

export const TOOLS: ToolDef[] = [
  { id: 'pencil', label: 'Pencil', icon: '✏️', shortcut: 'b' },
  { id: 'eraser', label: 'Eraser', icon: '🧽', shortcut: 'e' },
  { id: 'line', label: 'Line', icon: '╱', shortcut: 'l' },
  { id: 'rect', label: 'Rectangle', icon: '▭', shortcut: 'r' },
  { id: 'oval', label: 'Oval', icon: '◯', shortcut: 'o' },
  { id: 'polygon', label: 'Polygon', icon: '⬠', shortcut: 'p' },
  { id: 'bucket', label: 'Fill', icon: '🪣', shortcut: 'g' },
  { id: 'eyedropper', label: 'Pick', icon: '💧', shortcut: 'i' },
  { id: 'select', label: 'Select', icon: '⬚', shortcut: 'm' },
];

/** Square brush widths, in art pixels. */
export const BRUSH_SIZES = [1, 3, 5] as const;
export type BrushSize = (typeof BRUSH_SIZES)[number];

export function isBrushSize(value: number): value is BrushSize {
  return (BRUSH_SIZES as readonly number[]).includes(value);
}

export interface ToolContext {
  doc: PixelDoc;
  color: RGBA;
  /** Brush width for the active tool; ignored by fill and eyedropper. */
  size: BrushSize;
  /** Used by the eyedropper to hand the sampled color back to the editor. */
  setColor(color: RGBA): void;
}

/** Whether a tool strokes with a brush, and so has a width to configure. */
export function hasBrushSize(tool: ToolId): boolean {
  return tool === 'pencil' || tool === 'eraser' || tool === 'polygon' || isShapeTool(tool);
}

export function isShapeTool(tool: ToolId): tool is ShapeTool {
  return tool === 'line' || tool === 'rect' || tool === 'oval';
}

/** Closed shapes have an interior to fill; a line doesn't. */
export function hasShapeFill(tool: ToolId): boolean {
  return tool === 'rect' || tool === 'oval' || tool === 'polygon';
}

function isFillableShape(tool: ShapeTool): tool is Extract<ShapeTool, 'rect' | 'oval'> {
  return tool === 'rect' || tool === 'oval';
}

/** Paints a size×size square centered on (cx, cy); out-of-bounds cells are dropped. */
export function stamp(
  doc: PixelDoc,
  cx: number,
  cy: number,
  size: number,
  color: RGBA,
): void {
  const radius = Math.floor(size / 2);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      doc.set(cx + dx, cy + dy, color);
    }
  }
}

/** Whether a tool mutates the document (and so should open an undo entry). */
export function isDestructive(tool: ToolId): boolean {
  // Select only marks a region; the copy it leads to opens its own entry.
  return tool !== 'eyedropper' && tool !== 'select';
}

export function applyTool(tool: ToolId, ctx: ToolContext, x: number, y: number): void {
  const { doc } = ctx;
  // A wide brush still paints when its center strays outside — stamp() clips the
  // rest. Fill and eyedropper need a real cell under the cursor.
  if (!doc.contains(x, y) && !hasBrushSize(tool)) return;

  switch (tool) {
    case 'pencil':
      stamp(doc, x, y, ctx.size, ctx.color);
      break;
    case 'eraser':
      stamp(doc, x, y, ctx.size, TRANSPARENT);
      break;
    case 'bucket':
      floodFill(doc, x, y, ctx.color);
      break;
    case 'eyedropper':
      ctx.setColor(doc.get(x, y));
      break;
    case 'select':
      // Marks a region; the editor owns the marquee and the copy that follows.
      break;
    case 'line':
    case 'rect':
    case 'oval':
    case 'polygon':
      // Shapes are previewed across a drag (or a click sequence, for the
      // polygon) and committed by the editor, not painted cell-by-cell here.
      // See strokeShape() and strokePolygon().
      break;
  }
}

/**
 * Draws a shape between two corners: interior first (when `fill` is given and
 * the shape is closed), then the outline on top at the brush width.
 */
export function strokeShape(
  tool: ShapeTool,
  ctx: ToolContext,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  fill: RGBA | null = null,
): void {
  if (fill !== null && isFillableShape(tool)) {
    fillShape(tool, ctx.doc, x0, y0, x1, y1, fill);
  }
  for (const [x, y] of shapePoints(tool, x0, y0, x1, y1)) {
    stamp(ctx.doc, x, y, ctx.size, ctx.color);
  }
}

/**
 * Draws a polygon through `points`: interior first when it's closed and a fill
 * was chosen, then every edge at the brush width. An open polygon draws the
 * edges it has so far, which is what the in-progress preview wants.
 */
export function strokePolygon(
  ctx: ToolContext,
  points: Array<[number, number]>,
  closed: boolean,
  fill: RGBA | null = null,
): void {
  if (points.length === 0) return;

  if (closed && fill !== null && points.length >= 3) {
    fillPolygon(ctx.doc, points, fill);
  }

  // A lone vertex has no edge to stroke, so stamp it directly.
  if (points.length === 1) {
    stamp(ctx.doc, points[0][0], points[0][1], ctx.size, ctx.color);
    return;
  }

  const edges = closed ? points.length : points.length - 1;
  for (let i = 0; i < edges; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    for (const [x, y] of linePoints(x0, y0, x1, y1)) {
      stamp(ctx.doc, x, y, ctx.size, ctx.color);
    }
  }
}

/**
 * Scanline fill with the even-odd rule: for each row, find where the edges cross
 * it and fill between alternating pairs. Handles concave and self-intersecting
 * outlines, which a flood fill from an interior seed could not.
 */
export function fillPolygon(
  doc: PixelDoc,
  points: Array<[number, number]>,
  color: RGBA,
): void {
  if (points.length < 3) return;

  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of points) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  minY = Math.max(0, Math.ceil(minY));
  maxY = Math.min(doc.height - 1, Math.floor(maxY));

  const crossings: number[] = [];
  for (let y = minY; y <= maxY; y++) {
    crossings.length = 0;

    for (let i = 0; i < points.length; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[(i + 1) % points.length];
      // Half-open test: counts each vertex once and ignores horizontal edges,
      // so spans can't double-count and flip the inside/outside parity.
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        crossings.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
      }
    }

    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const from = Math.ceil(crossings[i]);
      const to = Math.floor(crossings[i + 1]);
      for (let x = from; x <= to; x++) doc.set(x, y, color);
    }
  }
}

/** Paints the solid interior of a closed shape, row by row. */
export function fillShape(
  tool: 'rect' | 'oval',
  doc: PixelDoc,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: RGBA,
): void {
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);

  if (tool === 'rect') {
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) doc.set(x, y, color);
    }
    return;
  }

  // Same ellipse the outline traces, so the fill lands exactly inside it.
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const rx = (right - left) / 2;
  const ry = (bottom - top) / 2;

  for (let y = top; y <= bottom; y++) {
    const k = ry === 0 ? 0 : Math.sqrt(Math.max(0, 1 - ((y - cy) / ry) ** 2));
    const from = Math.ceil(cx - rx * k - 0.5);
    const to = Math.floor(cx + rx * k + 0.5);
    for (let x = from; x <= to; x++) doc.set(x, y, color);
  }
}

/** The outline cells of a shape spanning the box from (x0,y0) to (x1,y1). */
export function shapePoints(
  tool: ShapeTool,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Array<[number, number]> {
  if (tool === 'line') return linePoints(x0, y0, x1, y1);

  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);

  return tool === 'rect'
    ? rectPoints(left, top, right, bottom)
    : ovalPoints(left, top, right, bottom);
}

function rectPoints(
  left: number,
  top: number,
  right: number,
  bottom: number,
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let x = left; x <= right; x++) {
    points.push([x, top], [x, bottom]);
  }
  for (let y = top + 1; y < bottom; y++) {
    points.push([left, y], [right, y]);
  }
  return points;
}

/**
 * The ellipse inscribed in the box, traced twice — once per row and once per
 * column. Row-tracing alone leaves gaps where the curve runs near-horizontal,
 * and column-tracing alone where it runs near-vertical; their union is closed.
 */
function ovalPoints(
  left: number,
  top: number,
  right: number,
  bottom: number,
): Array<[number, number]> {
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const rx = (right - left) / 2;
  const ry = (bottom - top) / 2;

  const seen = new Set<string>();
  const points: Array<[number, number]> = [];
  const add = (x: number, y: number) => {
    const key = `${x},${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    points.push([x, y]);
  };

  // An even-sized box puts the center on a half-pixel. Rounding both edges the
  // same way would collapse them onto one cell, so ties round away from center.
  const lower = (v: number) => Math.ceil(v - 0.5);
  const upper = (v: number) => Math.floor(v + 0.5);

  for (let y = top; y <= bottom; y++) {
    const k = ry === 0 ? 0 : Math.sqrt(Math.max(0, 1 - ((y - cy) / ry) ** 2));
    add(lower(cx - rx * k), y);
    add(upper(cx + rx * k), y);
  }
  for (let x = left; x <= right; x++) {
    const k = rx === 0 ? 0 : Math.sqrt(Math.max(0, 1 - ((x - cx) / rx) ** 2));
    add(x, lower(cy - ry * k));
    add(x, upper(cy + ry * k));
  }
  return points;
}

/** Scanline flood fill — iterative, so a full 128×128 fill can't blow the stack. */
export function floodFill(doc: PixelDoc, startX: number, startY: number, fill: RGBA): void {
  const target = doc.get(startX, startY);
  if (sameColor(target, fill)) return;

  const stack: Array<[number, number]> = [[startX, startY]];

  while (stack.length > 0) {
    const [seedX, y] = stack.pop()!;

    let x = seedX;
    while (x > 0 && sameColor(doc.get(x - 1, y), target)) x--;

    let spanAbove = false;
    let spanBelow = false;

    for (; x < doc.width && sameColor(doc.get(x, y), target); x++) {
      doc.set(x, y, fill);

      const above = y > 0 && sameColor(doc.get(x, y - 1), target);
      if (above && !spanAbove) stack.push([x, y - 1]);
      spanAbove = above;

      const below = y < doc.height - 1 && sameColor(doc.get(x, y + 1), target);
      if (below && !spanBelow) stack.push([x, y + 1]);
      spanBelow = below;
    }
  }
}
