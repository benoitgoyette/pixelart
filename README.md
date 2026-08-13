# pixelart

A browser-based pixel art editor for drawing game sprites and animating them
frame by frame. No dependencies at runtime — the whole thing is TypeScript
drawing to a `<canvas>`, built with Vite and deployable as a static site.

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + static bundle in dist/
```

## Tests

```bash
npm test         # unit (vitest)
npm run test:e2e # browser (playwright, starts its own dev server on 5174)
npm run test:all # build + both suites, as CI runs them
```

**Unit tests** (`tests/unit`) cover the DOM-free logic where the subtle bugs
live: shape geometry, flood fill, rotation, colour conversion, and the library's
storage layer. Failures print ASCII pictures of the shape produced, so a broken
oval reads as a broken oval.

**Browser tests** (`tests/e2e`) drive the real app through Playwright and cover
the behaviour units can't reach: frame-aware undo, drag-to-reorder keeping
history aligned, playback, the save-first prompts, copying a selection across
frames, and the bytes of an exported PNG. Each test gets a fresh browser context,
so `localStorage` starts empty without any clearing — which matters, since
clearing on every load would also wipe the reloads under test.

The suite is written against user-visible behaviour, not internals: it reads
pixel counts from the filmstrip thumbnails and decodes exported PNGs, rather
than reaching into application state.

## Features

**Tools** — pencil, eraser, line, rectangle, oval, polygon, flood fill,
eyedropper, select, and duplicate. Keyboard shortcuts: `B` pencil, `E` eraser,
`L` line, `R` rectangle, `O` oval, `P` polygon, `G` fill, `I` eyedropper,
`M` select, `D` duplicate. `X` toggles mirror editing.

- Pencil and eraser have independent 1×1 / 3×3 / 5×5 widths.
- **Mirror edit** (`X`) is a modifier rather than a tool of its own, so it stays
  on across tool changes; switching it on reveals the axis choice — vertical
  (left ↔ right) or horizontal (top ↔ bottom) — and draws the line down the
  middle of the canvas as an overlay. Every stroke, shape and fill is echoed onto
  the reflected cell, and the pair undoes as one step. Line, rectangle, oval and
  polygon stay on the side they started from: their far corner stops at the line
  rather than crossing it, which would bury the shape under its own reflection.
  Moving a selection, copying between frames and rotating are unaffected.
- The **select** tool marks a rectangle with two clicks — one to start, one to
  finish, with the rectangle tracking the cursor in between — then moves it. The
  cursor turns into a hand over a live selection; drag from inside it and the
  pixels travel with it, landing where you release the button and leaving
  transparency behind. The rectangle stops at the canvas edge rather than losing
  pixels, the marquee stays on its new home so it can be dragged again, and the
  whole move is one undo step (`Esc` mid-drag puts it back, `Esc` after clears
  the marquee).
- Shapes preview live across a drag and commit on release, as one undo step.
- The polygon places a vertex per click; click the ringed start point (or press
  `Enter`) to close it, `Esc` to abandon it. The whole sequence is one undo step.
- Rectangle, oval, and polygon can be filled with the brush color or a separate
  custom color. Polygon interiors use an even-odd scanline fill, so concave
  outlines fill correctly.
- Rotate the canvas 0–359° about its center, with 90/180/270 presets. Right
  angles are lossless; other angles resample nearest-neighbor and clip the
  corners swept outside.
- Undo/redo (`⌘Z` / `⇧⌘Z`), 100 steps deep, one entry per stroke. History spans
  frames: undo returns to the frame an edit happened on.

**Animation** — every drawing is a frame, listed in the strip below the canvas.

- **New frame** copies the current drawing into a new frame after it, so each
  frame starts from the last rather than from nothing.
- Move between frames by clicking a thumbnail, scrolling the strip, or pressing
  `←` / `→`.
- **Play** previews the animation in the canvas at 4–24 fps (`Space` toggles it).
- Drag a thumbnail to reorder frames; a caret shows where it will land.
- The **duplicate** tool marks a rectangle with two clicks — one to start, one to
  finish, with the rectangle tracking the cursor in between (`Esc` abandons it).
  The second click offers to duplicate the region into a single frame, a range,
  or all of them, landing at the same coordinates and replacing that area,
  transparency included. The copy is a single undo step.
- **Delete** removes the current frame. Adding, deleting, and reordering frames
  are not themselves undoable, though reordering keeps the drawing history
  pointing at the right frames.
- All frames share one canvas size, so changing Size starts a fresh animation.
- 16 / 32 / 64 / 128 canvases, 1–32× zoom, toggleable pixel grid.
- Transparent by default, with an optional solid background for preview and export.
- **Export PNG** saves the current frame; **Export frames** saves every frame as
  one sprite sheet — a horizontal strip of uniform cells, which is what engines
  slice by frame width. Both honor the 1× / 4× / 8× / 16× scale, use
  nearest-neighbor, and keep transparency.

**Saving** — work is kept in `localStorage`, in two separate places.

- The current drawing autosaves continuously, so a reload picks up where you left
  off whether or not you ever save by name.
- **New** starts an empty drawing at the current canvas size. If there are
  unsaved changes it offers Save / Don't save / Cancel first, as does loading
  another animation.
- **Save** (`⌘S`) stores the animation under a name; **Open…** lists everything
  saved with a thumbnail, frame count, size, and date, to load or delete. Several
  animations can be kept side by side.
- Saving under the same name updates that entry; a new name saves a copy. The
  toolbar shows the current name, with a `•` when it differs from the saved copy.
- Storage is finite — a few large animations can fill the quota, which is
  reported rather than failing silently.

## Layout

```
index.html        toolbar, sidebar, canvas stage, filmstrip, save dialog
src/main.ts       wiring: input, frames, history, persistence, UI state
src/canvas.ts     PixelDoc (RGBA buffer), Renderer, PNG export
src/tools.ts      tool definitions, brush stamping, flood fill, shape geometry
src/palette.ts    default palette and color conversion
src/style.css
```

Each frame is a flat `Uint8ClampedArray` of RGBA; the on-screen canvas is only a
view of the frame being edited. Rendering blits the document 1:1 into a scratch canvas and scales it up
with image smoothing off, so cost is independent of canvas size.
