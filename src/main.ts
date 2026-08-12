import { PixelDoc, RGBA, Renderer, linePoints, toPngBlob } from './canvas';
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

const renderer = new Renderer(canvas);

let doc = loadDoc() ?? new PixelDoc(32, 32);
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

const undoStack: Uint8ClampedArray[] = [];
const redoStack: Uint8ClampedArray[] = [];
let strokeOpen = false;
let lastCell: [number, number] | null = null;
/** Where a shape drag started, and the canvas to redraw it against each move. */
let shapeOrigin: [number, number] | null = null;
let shapeBase: Uint8ClampedArray | null = null;

sizeSelect.value = String(doc.width);

// --- history -----------------------------------------------------------------

function beginStroke(): void {
  if (strokeOpen) return;
  undoStack.push(doc.snapshot());
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
  strokeOpen = true;
}

function endStroke(): void {
  if (!strokeOpen) return;
  strokeOpen = false;
  persist();
}

function undo(): void {
  const previous = undoStack.pop();
  if (!previous) return status('nothing to undo');
  redoStack.push(doc.snapshot());
  doc.restore(previous);
  render();
  persist();
}

function redo(): void {
  const next = redoStack.pop();
  if (!next) return status('nothing to redo');
  undoStack.push(doc.snapshot());
  doc.restore(next);
  render();
  persist();
}

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

canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId);
  const [x, y] = cellFromEvent(event);
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
  doc = new PixelDoc(size, size);
  undoStack.length = 0;
  redoStack.length = 0;
  render();
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

zoomInput.addEventListener('input', () => {
  zoom = Number(zoomInput.value);
  zoomValue.textContent = `${zoom}×`;
  render();
});

sizeSelect.addEventListener('change', () => {
  const size = Number(sizeSelect.value);
  const blank = doc.data.every((channel) => channel === 0);
  if (!blank && !confirm(`Start a new ${size} × ${size} canvas? Current art will be lost.`)) {
    sizeSelect.value = String(doc.width);
    return;
  }
  setDocSize(size);
});

el<HTMLButtonElement>('undo').addEventListener('click', undo);
el<HTMLButtonElement>('redo').addEventListener('click', redo);

el<HTMLButtonElement>('clear').addEventListener('click', () => {
  if (!confirm('Clear the canvas?')) return;
  beginStroke();
  doc.clear();
  endStroke();
  render();
  status('cleared');
});

/** Suggests the last name you used, falling back to one describing the export. */
function suggestedFilename(scale: number): string {
  return lastFilename || `pixelart-${doc.width}x${doc.height}@${scale}x`;
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

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
    return;
  }

  const match = TOOLS.find((def) => def.shortcut === event.key.toLowerCase());
  if (match) setTool(match.id);
});

// --- persistence -------------------------------------------------------------

function persist(): void {
  try {
    let binary = '';
    for (const byte of doc.data) binary += String.fromCharCode(byte);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ width: doc.width, height: doc.height, data: btoa(binary) }),
    );
  } catch {
    status('could not save locally');
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

function loadDoc(): PixelDoc | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const { width, height, data } = JSON.parse(raw) as {
      width: number;
      height: number;
      data: string;
    };
    const binary = atob(data);
    if (binary.length !== width * height * 4) return null;
    const bytes = new Uint8ClampedArray(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new PixelDoc(width, height, bytes);
  } catch {
    return null;
  }
}

// --- boot --------------------------------------------------------------------

function render(): void {
  renderer.render(doc, { zoom, showGrid, background });
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
applyBackground();
