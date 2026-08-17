/*
 * pixelart — a browser-based pixel art editor
 * Copyright (C) 2026 Benoit Goyette
 *
 * Free software under the GNU General Public License v3 or later, without any
 * warranty. See the LICENSE file at the root of this repository.
 */

import { RGBA } from './canvas';

/**
 * A compact starter palette: a first row of black and white followed by the
 * primaries and secondaries at full strength — the pure values a ramp
 * deliberately leaves out, but which pixel art reaches for as keys, outlines
 * and highlights — then a 16-color Sweetie-16 style ramp.
 *
 * Laid out eight to a row, so each group is a whole number of rows.
 */
export const DEFAULT_PALETTE: string[] = [
  '#000000',
  '#ffffff',
  '#ff0000',
  '#00ff00',
  '#0000ff',
  '#ff00ff',
  '#ffff00',
  '#00ffff',
  '#1a1c2c',
  '#5d275d',
  '#b13e53',
  '#ef7d57',
  '#ffcd75',
  '#a7f070',
  '#38b764',
  '#257179',
  '#29366f',
  '#3b5dc9',
  '#41a6f6',
  '#73eff7',
  '#f4f4f4',
  '#94b0c2',
  '#566c86',
  '#333c57',
];

/**
 * How many colors of their own a user may keep. Past this the oldest goes, so
 * saving one more always works rather than failing at a limit nobody was told
 * about — and localStorage never grows without bound.
 */
export const MAX_CUSTOM_SWATCHES = 32;

/** A six-digit hex color, the only form the swatch store keeps. */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

/**
 * Reads the saved swatches out of whatever localStorage handed back. Anything
 * unparseable, of the wrong shape, or not a color is dropped rather than thrown:
 * a corrupted entry costs the saved colors, not the whole editor.
 */
export function parseSwatches(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const saved: unknown = JSON.parse(raw);
    if (!Array.isArray(saved)) return [];
    const clean: string[] = [];
    for (const entry of saved) {
      if (!isHexColor(entry)) continue;
      const hex = entry.toLowerCase();
      if (!clean.includes(hex)) clean.push(hex);
    }
    return clean.slice(-MAX_CUSTOM_SWATCHES);
  } catch {
    return [];
  }
}

/**
 * `swatches` with `hex` appended — the same list back when it already holds it,
 * so a caller can tell a save from a no-op by identity. The oldest is dropped
 * once the list is full.
 */
export function withSwatch(swatches: string[], hex: string): string[] {
  const color = hex.toLowerCase();
  if (!isHexColor(color) || swatches.includes(color)) return swatches;
  return [...swatches, color].slice(-MAX_CUSTOM_SWATCHES);
}

/** `swatches` without `hex`, or the same list back when it wasn't there. */
export function withoutSwatch(swatches: string[], hex: string): string[] {
  const color = hex.toLowerCase();
  if (!swatches.includes(color)) return swatches;
  return swatches.filter((entry) => entry !== color);
}

export function hexToRgba(hex: string): RGBA {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
    255,
  ];
}

export function rgbaToHex(color: RGBA): string {
  const part = (n: number) => n.toString(16).padStart(2, '0');
  return `#${part(color[0])}${part(color[1])}${part(color[2])}`;
}

export function rgbaToCss(color: RGBA): string {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${color[3] / 255})`;
}

/**
 * sRGB to Oklab. Distances in Oklab track how different two colors *look*,
 * which plain RGB distance does not: in RGB a mid grey sits closer to a
 * saturated blue than to a lighter grey, so snapping picks the wrong entry.
 */
export function toOklab([r, g, b]: RGBA): [number, number, number] {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lr = linear(r);
  const lg = linear(g);
  const lb = linear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** The palette in both forms, computed once: RGBA to return, Oklab to compare. */
const PALETTE_LAB: Array<{ rgba: RGBA; lab: [number, number, number] }> = DEFAULT_PALETTE.map(
  (hex) => {
    const rgba = hexToRgba(hex);
    return { rgba, lab: toOklab(rgba) };
  },
);

/** The palette entry that looks closest to `color`; its alpha is carried over. */
export function nearestPaletteColor(color: RGBA): RGBA {
  const [l, a, b] = toOklab(color);

  let best = PALETTE_LAB[0];
  let bestDistance = Infinity;
  for (const entry of PALETTE_LAB) {
    const distance =
      (entry.lab[0] - l) ** 2 + (entry.lab[1] - a) ** 2 + (entry.lab[2] - b) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
    }
  }
  return [best.rgba[0], best.rgba[1], best.rgba[2], color[3]];
}
