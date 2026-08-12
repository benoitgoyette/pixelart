# pixelart

A browser-based pixel art editor. No dependencies at runtime — the whole thing is
TypeScript drawing to a `<canvas>`, built with Vite and deployable as a static site.

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static bundle in dist/
```

## Features

**Tools** — pencil, eraser, line, rectangle, oval, flood fill, and eyedropper.
Keyboard shortcuts: `B` pencil, `E` eraser, `L` line, `R` rectangle, `O` oval,
`G` fill, `I` eyedropper.

- Pencil and eraser have independent 1×1 / 3×3 / 5×5 widths.
- Shapes preview live across a drag and commit on release, as one undo step.
- Rectangle and oval can be filled with the brush color or a separate custom color.
- Undo/redo (`⌘Z` / `⇧⌘Z`), 100 steps deep, one entry per stroke.
- 16 / 32 / 64 / 128 canvases, 1–32× zoom, toggleable pixel grid.
- Transparent by default, with an optional solid background for preview and export.
- PNG export at 1× / 4× / 8× / 16× with nearest-neighbor scaling and a filename prompt.
- Art and settings auto-save to `localStorage`.

## Layout

```
index.html        toolbar, sidebar, canvas stage, save dialog
src/main.ts       wiring: input, history, persistence, UI state
src/canvas.ts     PixelDoc (RGBA buffer), Renderer, PNG export
src/tools.ts      tool definitions, brush stamping, flood fill, shape geometry
src/palette.ts    default palette and color conversion
src/style.css
```

The document is a flat `Uint8ClampedArray` of RGBA; the on-screen canvas is only a
view of it. Rendering blits the document 1:1 into a scratch canvas and scales it up
with image smoothing off, so cost is independent of canvas size.
