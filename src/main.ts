import { PixelDoc, RGBA, Renderer, linePoints, rotate, toPngBlob } from './canvas';
import { DEFAULT_PALETTE, hexToRgba, rgbaToCss, rgbaToHex } from './palette';
import {
  BRUSH_SIZES,
  BrushSize,
  TOOLS,
  ToolId,
  applyTool,
  hasBrushSize,
  hasShapeFill,
  isBrushSize,
  isDestructive,
  isShapeTool,
  strokePolygon,
  strokeShape,
} from './tools';

const STORAGE_KEY = 'pixelart:doc';
const SETTINGS_KEY = 'pixelart:settings';
const MAX_HISTORY = 100;

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
};

const canvas = el<HTMLCanvasElement>('canvas');
const toolsEl = el<HTMLDivElement>('tools');
const paletteEl = el<HTMLDivElement>('palette');
const currentSwatch = el<HTMLDivElement>('current-swatch');
const colorInput = el<HTMLInputElement>('color-input');
const sizeSelect = el<HTMLSelectElement>('doc-size');
const gridToggle = el<HTMLInputElement>('show-grid');
const zoomInput = el<HTMLInputElement>('zoom');
const zoomValue = el<HTMLSpanElement>('zoom-value');
const rotateInput = el<HTMLInputElement>('rotate');
const rotateValue = el<HTMLSpanElement>('rotate-value');
const statusEl = el<HTMLSpanElement>('status');
const exportScale = el<HTMLSelectElement>('export-scale');
const backgroundSelect = el<HTMLSelectElement>('background');
const backgroundColor = el<HTMLInputElement>('background-color');
const pencilSizeSelect = el<HTMLSelectElement>('pencil-size');
const eraserSizeSelect = el<HTMLSelectElement>('eraser-size');
const pencilSizeField = el<HTMLLabelElement>('pencil-size-field');
const eraserSizeField = el<HTMLLabelElement>('eraser-size-field');
const shapeFillSelect = el<HTMLSelectElement>('shape-fill');
const shapeFillColor = el<HTMLInputElement>('shape-fill-color');
const shapeSection = el<HTMLElement>('shape-section');
const shapeFillPalette = el<HTMLDivElement>('shape-fill-palette');
const saveDialog = el<HTMLDialogElement>('save-dialog');
const saveName = el<HTMLInputElement>('save-name');
const saveHint = el<HTMLParagraphElement>('save-hint');
const filmstripEl = el<HTMLDivElement>('filmstrip');
const frameCounter = el<HTMLSpanElement>('frame-counter');

const renderer = new Renderer(canvas);

/** Set by loadFrames() and consumed at boot; declared first to dodge the TDZ. */
let pendingFrameIndex = 0;

/**
 * Every frame of the animation, all the same size. `doc` always aliases the one
 * being edited, so the drawing code stays frame-agnostic.
 */
let frames: PixelDoc[] = loadFrames();
let frameIndex = 0;
let doc = frames[0];
let tool: ToolId = 'pencil';
let color: RGBA = hexToRgba(colorInput.value);
let zoom = Number(zoomInput.value);
let showGrid = gridToggle.checked;
/** null means the art keeps its own transparency, on screen and on export. */
let background: string | null = null;
/** Remembered between saves so re-exporting doesn't mean retyping the name. */
let lastFilename = '';
/** Pencil and eraser carry independent widths, the way desktop editors do. */
let pencilSize: BrushSize = 1;
let eraserSize: BrushSize = 1;

/** History spans frames, so each entry records which one it belongs to. */
interface Snapshot {
  frame: number;
  data: Uint8ClampedArray;
}

const undoStack: Snapshot[] = [];
const redoStack: Snapshot[] = [];
let strokeOpen = false;
let lastCell: [number, number] | null = null;
/** Vertices placed so far, and the pixels underneath them. Empty when idle. */
let polygonPoints: Array<[number, number]> = [];
let polygonBase: Uint8ClampedArray | null = null;
/** Pixels as they stood before the pending rotation; null when none is pending. */
let rotateBase: Uint8ClampedArray | null = null;
/** Where a shape drag started, and the canvas to redraw it against each move. */
let shapeOrigin: [number, number] | null = null;
let shapeBase: Uint8ClampedArray | null = null;

sizeSelect.value = String(doc.width);

// --- history -----------------------------------------------------------------

function beginStroke(): void {
  if (strokeOpen) return;
  undoStack.push({ frame: frameIndex, data: doc.snapshot() });
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
  strokeOpen = true;
}

function endStroke(): void {
  if (!strokeOpen) return;
  strokeOpen = false;
  persist();
}

/** Throws away the open stroke's undo entry — for edits abandoned, not applied. */
function discardStroke(): void {
  if (!strokeOpen) return;
  undoStack.pop();
  strokeOpen = false;
}

function undo(): void {
  // Mid-polygon, undo means "drop the polygon" rather than reaching past it.
  if (polygonBase !== null) return cancelPolygon();
  finishRotation();
  const previous = undoStack.pop();
  if (!previous) return status('nothing to undo');
  // Follow the edit back to the frame it happened on.
  if (previous.frame !== frameIndex) showFrame(previous.frame);
  redoStack.push({ frame: frameIndex, data: doc.snapshot() });
  doc.restore(previous.data);
  render();
  persist();
}

function redo(): void {
  cancelPolygon();
  finishRotation();
  const next = redoStack.pop();
  if (!next) return status('nothing to redo');
  if (next.frame !== frameIndex) showFrame(next.frame);
  undoStack.push({ frame: frameIndex, data: doc.snapshot() });
  doc.restore(next.data);
  render();
  persist();
}

/**
 * Keeps history pointing at the right frames after one is inserted or removed.
 * `remap` returns the entry's new index, or null to drop it entirely.
 */
function remapHistory(remap: (frame: number) => number | null): void {
  for (const stack of [undoStack, redoStack]) {
    for (let i = stack.length - 1; i >= 0; i--) {
      const next = remap(stack[i].frame);
      if (next === null) stack.splice(i, 1);
      else stack[i].frame = next;
    }
  }
}

// --- frames ------------------------------------------------------------------

/** Thumbnails, parallel to `frames`, so a repaint doesn't rebuild the DOM. */
let frameViews: Array<{ root: HTMLElement; thumb: HTMLCanvasElement }> = [];

/** Switches the edited frame without disturbing pending tool state. */
function showFrame(index: number): void {
  frameIndex = Math.min(Math.max(index, 0), frames.length - 1);
  doc = frames[frameIndex];
  syncFilmstrip();
  render();
}

function selectFrame(index: number): void {
  if (index === frameIndex || index < 0 || index >= frames.length) return;
  // Pending edits belong to the frame that started them.
  cancelPolygon();
  finishRotation();
  showFrame(index);
  status(`frame ${frameIndex + 1} of ${frames.length}`);
}

function buildFilmstrip(): void {
  filmstripEl.textContent = '';
  frameViews = frames.map((frame, index) => {
    const root = document.createElement('button');
    root.type = 'button';
    root.className = 'frame-item';
    root.title = `Edit frame ${index + 1}`;

    const label = document.createElement('span');
    label.className = 'frame-label';
    label.textContent = String(index + 1);

    const thumb = document.createElement('canvas');
    thumb.className = 'frame-thumb';
    thumb.width = frame.width;
    thumb.height = frame.height;

    root.append(label, thumb);
    root.addEventListener('click', () => selectFrame(index));
    filmstripEl.appendChild(root);
    return { root, thumb };
  });
  syncFilmstrip();
}

function paintThumb(index: number): void {
  const view = frameViews[index];
  if (!view) return;
  const ctx = view.thumb.getContext('2d');
  if (!ctx) return;
  const frame = frames[index];
  ctx.clearRect(0, 0, view.thumb.width, view.thumb.height);
  ctx.putImageData(new ImageData(frame.data.slice(), frame.width, frame.height), 0, 0);
}

function syncFilmstrip(): void {
  frameViews.forEach((view, index) => {
    view.root.classList.toggle('current', index === frameIndex);
    paintThumb(index);
  });
  frameCounter.textContent = `${frameIndex + 1} / ${frames.length}`;
  frameViews[frameIndex]?.root.scrollIntoView({ block: 'nearest' });
}

/** Copies the current drawing into a new frame placed right after it. */
function newFrame(): void {
  cancelPolygon();
  finishRotation();

  frames.splice(frameIndex + 1, 0, new PixelDoc(doc.width, doc.height, doc.snapshot()));
  // Everything after the insertion point shifts up by one.
  const inserted = frameIndex + 1;
  remapHistory((frame) => (frame >= inserted ? frame + 1 : frame));

  buildFilmstrip();
  showFrame(inserted);
  persist();
  status(`frame ${frameIndex + 1} of ${frames.length} — copied from the previous one`);
}

function deleteFrame(): void {
  if (frames.length === 1) return status('an animation needs at least one frame');
  if (!confirm(`Delete frame ${frameIndex + 1} of ${frames.length}?`)) return;

  cancelPolygon();
  finishRotation();

  const removed = frameIndex;
  frames.splice(removed, 1);
  // Edits to the deleted frame can no longer be undone onto anything.
  remapHistory((frame) => (frame === removed ? null : frame > removed ? frame - 1 : frame));

  buildFilmstrip();
  showFrame(Math.min(removed, frames.length - 1));
  persist();
  status(`deleted frame ${removed + 1} — ${frames.length} left`);
}

el<HTMLButtonElement>('new-frame').addEventListener('click', newFrame);
el<HTMLButtonElement>('delete-frame').addEventListener('click', deleteFrame);

// Scrolling the strip steps between frames. Accumulated so one flick of a
// trackpad advances a frame or two rather than racing through the whole set.
let wheelTravel = 0;
filmstripEl.addEventListener(
  'wheel',
  (event) => {
    if (frames.length < 2) return;
    event.preventDefault();
    wheelTravel += event.deltaY;
    if (Math.abs(wheelTravel) < 40) return;
    selectFrame(frameIndex + Math.sign(wheelTravel));
    wheelTravel = 0;
  },
  { passive: false },
);

// --- drawing -----------------------------------------------------------------

function cellFromEvent(event: PointerEvent): [number, number] {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor(((event.clientX - rect.left) / rect.width) * doc.width);
  const y = Math.floor(((event.clientY - rect.top) / rect.height) * doc.height);
  return [x, y];
}

const toolContext = {
  get doc() {
    return doc;
  },
  get color() {
    return color;
  },
  get size() {
    return tool === 'eraser' ? eraserSize : pencilSize;
  },
  setColor: (picked: RGBA) => {
    // Sampling an empty pixel would give an unusable transparent brush.
    if (picked[3] === 0) return status('picked an empty pixel');
    setColor(picked);
    status(`picked ${rgbaToHex(picked)}`);
  },
};

function paintAt(x: number, y: number): void {
  applyTool(tool, toolContext, x, y);
  render();
}

/** Shapes are defined by their corners, so the drag is clamped onto the canvas. */
function clampToDoc(x: number, y: number): [number, number] {
  return [
    Math.min(Math.max(x, 0), doc.width - 1),
    Math.min(Math.max(y, 0), doc.height - 1),
  ];
}

/**
 * Redraws the in-progress shape: restore the pre-drag pixels, then stamp the
 * outline for the current corner. Cheap enough to run on every pointermove.
 */
function previewShape(x: number, y: number): void {
  if (shapeOrigin === null || shapeBase === null || !isShapeTool(tool)) return;
  const [ox, oy] = shapeOrigin;
  const [cx, cy] = clampToDoc(x, y);

  doc.restore(shapeBase);
  strokeShape(tool, toolContext, ox, oy, cx, cy, shapeFill());
  render();
  status(`${tool} ${Math.abs(cx - ox) + 1} × ${Math.abs(cy - oy) + 1}`);
}

function samePoint(a: [number, number], b: [number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Redraws the in-progress polygon: the edges placed so far plus a rubber band to
 * the cursor. Hovering the start point previews the finished shape instead —
 * fill included — so what you see is what clicking commits.
 */
function previewPolygon(cursor: [number, number] | null): void {
  if (polygonBase === null || polygonPoints.length === 0) return;
  doc.restore(polygonBase);

  const closing =
    cursor !== null && samePoint(cursor, polygonPoints[0]) && polygonPoints.length >= 3;

  if (closing) {
    strokePolygon(toolContext, polygonPoints, true, shapeFill());
  } else {
    strokePolygon(toolContext, cursor === null ? polygonPoints : [...polygonPoints, cursor], false);
  }

  render();
  status(
    closing
      ? 'click to close the polygon'
      : `polygon: ${polygonPoints.length} point${polygonPoints.length === 1 ? '' : 's'} — click the ringed start point to close`,
  );
}

function addPolygonPoint(x: number, y: number): void {
  const point = clampToDoc(x, y);

  if (polygonPoints.length === 0) {
    beginStroke();
    polygonBase = doc.snapshot();
    polygonPoints = [point];
    previewPolygon(point);
    return;
  }

  if (samePoint(point, polygonPoints[0])) {
    if (polygonPoints.length < 3) return status('a polygon needs at least 3 points to close');
    closePolygon();
    return;
  }

  // A repeat click on the vertex just placed would add a zero-length edge.
  if (samePoint(point, polygonPoints[polygonPoints.length - 1])) return;

  polygonPoints.push(point);
  previewPolygon(point);
}

function closePolygon(): void {
  if (polygonBase === null || polygonPoints.length < 3) return;
  const count = polygonPoints.length;

  doc.restore(polygonBase);
  strokePolygon(toolContext, polygonPoints, true, shapeFill());
  polygonPoints = [];
  polygonBase = null;

  render();
  endStroke();
  status(`polygon closed (${count} points)`);
}

/** Abandons an unfinished polygon, along with the undo entry it opened. */
function cancelPolygon(): void {
  if (polygonBase === null) return;
  doc.restore(polygonBase);
  polygonPoints = [];
  polygonBase = null;
  discardStroke();
  render();
  persist();
  status('polygon cancelled');
}

canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId);
  // Painting banks any rotation still on the slider, so the two never share an
  // undo entry.
  finishRotation();
  const [x, y] = cellFromEvent(event);

  // The polygon spans a click sequence, so it manages its own stroke.
  if (tool === 'polygon') {
    addPolygonPoint(x, y);
    return;
  }

  if (isDestructive(tool)) beginStroke();

  if (isShapeTool(tool)) {
    shapeOrigin = clampToDoc(x, y);
    shapeBase = doc.snapshot();
    previewShape(x, y);
    return;
  }

  lastCell = [x, y];
  paintAt(x, y);
});

canvas.addEventListener('pointermove', (event) => {
  const [x, y] = cellFromEvent(event);

  if (polygonBase !== null) {
    previewPolygon(clampToDoc(x, y));
    return;
  }

  if (shapeOrigin !== null) {
    previewShape(x, y);
    return;
  }

  status(doc.contains(x, y) ? `${x}, ${y}` : 'ready');

  if (lastCell === null) return;
  const [px, py] = lastCell;
  if (px === x && py === y) return;

  // Fill and eyedropper are single-shot; only freehand tools follow the drag.
  if (tool === 'pencil' || tool === 'eraser') {
    for (const [lx, ly] of linePoints(px, py, x, y)) applyTool(tool, toolContext, lx, ly);
    render();
  }
  lastCell = [x, y];
});

function releasePointer(): void {
  lastCell = null;
  shapeOrigin = null;
  shapeBase = null;
  // A pending polygon outlives the pointer, so its stroke stays open.
  if (polygonBase !== null) return;
  endStroke();
}

canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);

// --- UI ----------------------------------------------------------------------

function buildTools(): void {
  for (const def of TOOLS) {
    const button = document.createElement('button');
    button.className = 'tool';
    button.dataset.tool = def.id;
    button.title = `${def.label} (${def.shortcut.toUpperCase()})`;
    const icon = document.createElement('span');
    icon.className = 'tool-icon';
    icon.textContent = def.icon;
    const label = document.createElement('span');
    label.textContent = def.label;
    button.append(icon, label);
    button.addEventListener('click', () => setTool(def.id));
    toolsEl.appendChild(button);
  }
  syncTools();
}

function syncTools(): void {
  for (const button of toolsEl.querySelectorAll<HTMLButtonElement>('.tool')) {
    button.classList.toggle('active', button.dataset.tool === tool);
  }
  // Both sizes stay editable; the one that isn't in play is dimmed. Shapes
  // stroke with the pencil width, so they light up that field too.
  pencilSizeField.classList.toggle('muted', tool === 'eraser' || !hasBrushSize(tool));
  eraserSizeField.hidden = tool !== 'eraser';
  // Fill only means something for closed shapes, so the section comes and goes
  // with the rectangle and oval tools rather than sitting there dimmed.
  shapeSection.hidden = !hasShapeFill(tool);
}

function setTool(next: ToolId): void {
  if (next !== tool) cancelPolygon();
  tool = next;
  syncTools();
  const size = toolContext.size;
  status(hasBrushSize(next) ? `${next} ${size} × ${size}` : next);
}

function readBrushSize(select: HTMLSelectElement, fallback: BrushSize): BrushSize {
  const value = Number(select.value);
  return isBrushSize(value) ? value : fallback;
}

function buildBrushSizes(): void {
  for (const select of [pencilSizeSelect, eraserSizeSelect]) {
    for (const size of BRUSH_SIZES) {
      const option = document.createElement('option');
      option.value = String(size);
      option.textContent = `${size} × ${size}`;
      select.appendChild(option);
    }
  }

  pencilSizeSelect.value = String(pencilSize);
  eraserSizeSelect.value = String(eraserSize);

  pencilSizeSelect.addEventListener('change', () => {
    pencilSize = readBrushSize(pencilSizeSelect, pencilSize);
    persistSettings();
    status(`pencil ${pencilSize} × ${pencilSize}`);
  });

  eraserSizeSelect.addEventListener('change', () => {
    eraserSize = readBrushSize(eraserSizeSelect, eraserSize);
    persistSettings();
    status(`eraser ${eraserSize} × ${eraserSize}`);
  });
}

/** Fills a container with the shared palette; `onPick` decides what a click means. */
function buildSwatches(container: HTMLElement, onPick: (hex: string) => void): void {
  for (const hex of DEFAULT_PALETTE) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'swatch';
    swatch.dataset.hex = hex;
    swatch.style.background = hex;
    swatch.title = hex;
    swatch.addEventListener('click', () => onPick(hex));
    container.appendChild(swatch);
  }
}

function buildPalette(): void {
  buildSwatches(paletteEl, (hex) => {
    setColor(hexToRgba(hex));
    if (tool === 'eraser') setTool('pencil');
  });

  buildSwatches(shapeFillPalette, (hex) => {
    shapeFillColor.value = hex;
    syncShapeFill();
  });
}

/** Marks the swatch matching the current custom fill, if the palette holds one. */
function syncShapeFillSwatches(): void {
  const current = shapeFillColor.value.toLowerCase();
  for (const swatch of shapeFillPalette.querySelectorAll<HTMLButtonElement>('.swatch')) {
    swatch.classList.toggle('selected', swatch.dataset.hex?.toLowerCase() === current);
  }
}

function setColor(next: RGBA): void {
  color = next;
  currentSwatch.style.background = rgbaToCss(next);
  colorInput.value = rgbaToHex(next);
}

function setDocSize(size: number): void {
  cancelPolygon();
  finishRotation();
  // Frames share one canvas size, so resizing starts a fresh animation.
  frames = [new PixelDoc(size, size)];
  undoStack.length = 0;
  redoStack.length = 0;
  buildFilmstrip();
  showFrame(0);
  persist();
  status(`new ${size} × ${size} canvas`);
}

colorInput.addEventListener('input', () => setColor(hexToRgba(colorInput.value)));

function applyBackground(): void {
  const choice = backgroundSelect.value;
  backgroundColor.hidden = choice !== 'custom';
  background =
    choice === 'transparent' ? null : choice === 'custom' ? backgroundColor.value : choice;
  render();
}

function syncBackground(): void {
  applyBackground();
  persistSettings();
  status(background === null ? 'transparent background' : `background ${background}`);
}

/**
 * Resolved at draw time rather than cached, so "Brush color" follows the
 * current color and a custom fill survives palette clicks.
 */
function shapeFill(): RGBA | null {
  const choice = shapeFillSelect.value;
  if (choice === 'none') return null;
  return choice === 'custom' ? hexToRgba(shapeFillColor.value) : color;
}

function applyShapeFill(): void {
  const custom = shapeFillSelect.value === 'custom';
  shapeFillColor.hidden = !custom;
  shapeFillPalette.hidden = !custom;
  if (custom) syncShapeFillSwatches();
}

function syncShapeFill(): void {
  applyShapeFill();
  persistSettings();
  const fill = shapeFill();
  status(fill === null ? 'shapes: outline only' : `shape fill ${rgbaToHex(fill)}`);
}

shapeFillSelect.addEventListener('change', syncShapeFill);
shapeFillColor.addEventListener('input', syncShapeFill);

backgroundSelect.addEventListener('change', syncBackground);
backgroundColor.addEventListener('input', syncBackground);

gridToggle.addEventListener('change', () => {
  showGrid = gridToggle.checked;
  render();
});

/**
 * Applies `angle` to the pixels as they were before this rotation began, so
 * scrubbing the slider re-rotates the original rather than compounding the
 * resampling of whatever the last frame produced.
 */
function previewRotation(angle: number): void {
  cancelPolygon();
  if (rotateBase === null) {
    beginStroke();
    rotateBase = doc.snapshot();
  }
  doc.data.set(rotate(new PixelDoc(doc.width, doc.height, rotateBase), angle).data);
  rotateValue.textContent = `${angle}°`;
  render();
  status(`rotated ${angle}°`);
}

/**
 * Banks a pending rotation: the art keeps it and the slider returns to zero, so
 * the next drag starts from the rotated art. A no-op when nothing is pending.
 */
function finishRotation(): void {
  if (rotateBase === null) return;
  rotateBase = null;
  rotateInput.value = '0';
  rotateValue.textContent = '0°';
  endStroke();
}

rotateInput.addEventListener('input', () => previewRotation(Number(rotateInput.value)));
// Held open through the whole scrub (pointer and keyboard alike) and banked when
// focus leaves, so a slider still mid-adjustment never compounds.
rotateInput.addEventListener('blur', finishRotation);

for (const button of document.querySelectorAll<HTMLButtonElement>('.rotate-presets button')) {
  button.addEventListener('click', () => {
    finishRotation();
    previewRotation(Number(button.dataset.angle));
    finishRotation();
  });
}

zoomInput.addEventListener('input', () => {
  zoom = Number(zoomInput.value);
  zoomValue.textContent = `${zoom}×`;
  render();
});

sizeSelect.addEventListener('change', () => {
  const size = Number(sizeSelect.value);
  const blank = frames.every((frame) => frame.data.every((channel) => channel === 0));
  const warning =
    frames.length > 1
      ? `Start a new ${size} × ${size} canvas? All ${frames.length} frames will be lost.`
      : `Start a new ${size} × ${size} canvas? Current art will be lost.`;
  if (!blank && !confirm(warning)) {
    sizeSelect.value = String(doc.width);
    return;
  }
  setDocSize(size);
});

el<HTMLButtonElement>('undo').addEventListener('click', undo);
el<HTMLButtonElement>('redo').addEventListener('click', redo);

el<HTMLButtonElement>('clear').addEventListener('click', () => {
  if (!confirm('Clear the canvas?')) return;
  cancelPolygon();
  finishRotation();
  beginStroke();
  doc.clear();
  endStroke();
  render();
  status('cleared');
});

/** Suggests the last name you used, falling back to one describing the export. */
function suggestedFilename(scale: number): string {
  if (lastFilename) {
    // Keep a per-frame suffix current instead of saving frame 3 over frame 1.
    const base = lastFilename.replace(/-frame\d+$/, '');
    return frames.length > 1 ? `${base}-frame${frameIndex + 1}` : base;
  }
  const stem = `pixelart-${doc.width}x${doc.height}@${scale}x`;
  return frames.length > 1 ? `${stem}-frame${frameIndex + 1}` : stem;
}

/**
 * Trims the name down to something a browser download will accept: no path
 * separators, no control characters, no redundant .png the caller would double up.
 */
function sanitizeFilename(input: string, fallback: string): string {
  const cleaned = input
    .replace(/\.png$/i, '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .replace(/^\.+/, '')
    .trim();
  return cleaned || fallback;
}

function askForFilename(suggested: string, hint: string): Promise<string | null> {
  saveName.value = suggested;
  saveHint.textContent = hint;
  saveDialog.returnValue = '';
  saveDialog.showModal();
  saveName.focus();
  saveName.select();

  return new Promise((resolve) => {
    saveDialog.addEventListener(
      'close',
      () => {
        // Cancel and Esc both leave returnValue empty.
        resolve(
          saveDialog.returnValue === 'save' ? sanitizeFilename(saveName.value, suggested) : null,
        );
      },
      { once: true },
    );
  });
}

el<HTMLButtonElement>('save-cancel').addEventListener('click', () => saveDialog.close());

el<HTMLButtonElement>('export').addEventListener('click', async () => {
  const scale = Number(exportScale.value);
  const name = await askForFilename(
    suggestedFilename(scale),
    `${doc.width} × ${doc.height} at ${scale}× — ${
      background === null ? 'transparent background' : `background ${background}`
    }`,
  );
  if (name === null) return status('save cancelled');

  lastFilename = name;
  persistSettings();

  const blob = await toPngBlob(doc, scale, background);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}.png`;
  link.click();
  URL.revokeObjectURL(url);
  status(`saved ${name}.png at ${scale}×${background === null ? ' with transparency' : ''}`);
});

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;

  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    selectFrame(frameIndex + (event.key === 'ArrowDown' ? 1 : -1));
    return;
  }

  if (event.key === 'Escape' && polygonBase !== null) {
    event.preventDefault();
    cancelPolygon();
    return;
  }

  if (event.key === 'Enter' && polygonBase !== null) {
    event.preventDefault();
    if (polygonPoints.length < 3) return status('a polygon needs at least 3 points to close');
    closePolygon();
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
    return;
  }

  const match = TOOLS.find((def) => def.shortcut === event.key.toLowerCase());
  if (match) setTool(match.id);
});

// --- persistence -------------------------------------------------------------

function encodeFrame(data: Uint8ClampedArray): string {
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeFrame(encoded: string, expectedBytes: number): Uint8ClampedArray | null {
  const binary = atob(encoded);
  if (binary.length !== expectedBytes) return null;
  const bytes = new Uint8ClampedArray(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function persist(): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        width: doc.width,
        height: doc.height,
        index: frameIndex,
        frames: frames.map((frame) => encodeFrame(frame.data)),
      }),
    );
  } catch {
    // Many frames at 128px can outgrow the storage quota.
    status('could not save locally — try fewer frames or a smaller canvas');
  }
}

function persistSettings(): void {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        background: backgroundSelect.value,
        backgroundColor: backgroundColor.value,
        filename: lastFilename,
        pencilSize,
        eraserSize,
        shapeFill: shapeFillSelect.value,
        shapeFillColor: shapeFillColor.value,
      }),
    );
  } catch {
    /* settings are a convenience; ignore quota or private-mode failures */
  }
}

function loadSettings(): void {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as {
      background?: string;
      backgroundColor?: string;
      filename?: string;
      pencilSize?: number;
      eraserSize?: number;
      shapeFill?: string;
      shapeFillColor?: string;
    };
    if (saved.shapeFillColor) shapeFillColor.value = saved.shapeFillColor;
    if (saved.shapeFill) shapeFillSelect.value = saved.shapeFill;
    if (saved.backgroundColor) backgroundColor.value = saved.backgroundColor;
    if (saved.background) backgroundSelect.value = saved.background;
    if (saved.filename) lastFilename = saved.filename;
    if (saved.pencilSize !== undefined && isBrushSize(saved.pencilSize)) {
      pencilSize = saved.pencilSize;
    }
    if (saved.eraserSize !== undefined && isBrushSize(saved.eraserSize)) {
      eraserSize = saved.eraserSize;
    }
  } catch {
    /* fall back to the transparent default */
  }
}

/** Always returns at least one frame. `data` is the pre-animation save format. */
function loadFrames(): PixelDoc[] {
  const blank = () => [new PixelDoc(32, 32)];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return blank();

    const saved = JSON.parse(raw) as {
      width: number;
      height: number;
      data?: string;
      frames?: string[];
      index?: number;
    };
    const encoded = saved.frames ?? (saved.data ? [saved.data] : []);
    const expected = saved.width * saved.height * 4;

    const loaded: PixelDoc[] = [];
    for (const entry of encoded) {
      const bytes = decodeFrame(entry, expected);
      if (bytes === null) return blank(); // a size mismatch would corrupt the strip
      loaded.push(new PixelDoc(saved.width, saved.height, bytes));
    }
    if (loaded.length === 0) return blank();

    pendingFrameIndex = Math.min(Math.max(saved.index ?? 0, 0), loaded.length - 1);
    return loaded;
  } catch {
    return blank();
  }
}

// --- boot --------------------------------------------------------------------

function render(): void {
  paintThumb(frameIndex);
  renderer.render(doc, {
    zoom,
    showGrid,
    background,
    marker: polygonPoints.length > 0 ? polygonPoints[0] : null,
  });
}

function status(message: string): void {
  statusEl.textContent = message;
}

loadSettings(); // before the controls are built, so they render the saved state
buildTools();
buildBrushSizes();
buildPalette();
setColor(color);
zoomValue.textContent = `${zoom}×`;
applyShapeFill();
buildFilmstrip();
showFrame(pendingFrameIndex);
applyBackground();
