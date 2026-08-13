import { PixelDoc, RGBA } from '../../src/canvas';

export const RED: RGBA = [255, 0, 0, 255];
export const BLUE: RGBA = [0, 0, 255, 255];

/** Builds a doc from an ASCII map: '#' is opaque, anything else transparent. */
export function docFromRows(rows: string[], color: RGBA = RED): PixelDoc {
  const doc = new PixelDoc(rows[0].length, rows.length);
  rows.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      if (cell === '#') doc.set(x, y, color);
    });
  });
  return doc;
}

/** Renders a doc back to an ASCII map, so failures read as pictures. */
export function rowsFromDoc(doc: PixelDoc): string[] {
  return Array.from({ length: doc.height }, (_, y) =>
    Array.from({ length: doc.width }, (_, x) => (doc.get(x, y)[3] > 0 ? '#' : '.')).join(''),
  );
}

/** Paints the points onto a blank doc of the given size and returns the map. */
export function plot(
  width: number,
  height: number,
  points: Array<[number, number]>,
): string[] {
  const doc = new PixelDoc(width, height);
  for (const [x, y] of points) doc.set(x, y, RED);
  return rowsFromDoc(doc);
}

export function countOpaque(doc: PixelDoc): number {
  let total = 0;
  for (let i = 3; i < doc.data.length; i += 4) if (doc.data[i] > 0) total++;
  return total;
}
