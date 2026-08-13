import { describe, expect, it } from 'vitest';
import {
  PixelDoc,
  TRANSPARENT,
  liftRegion,
  rotate,
  sameColor,
  stampRegion,
} from '../../src/canvas';
import { floodFill } from '../../src/tools';
import { BLUE, RED, countOpaque, docFromRows, rowsFromDoc } from './helpers';

describe('PixelDoc', () => {
  it('round-trips a pixel', () => {
    const doc = new PixelDoc(4, 4);
    doc.set(1, 2, RED);
    expect(doc.get(1, 2)).toEqual(RED);
  });

  it('drops writes outside its bounds instead of wrapping', () => {
    const doc = new PixelDoc(4, 4);
    doc.set(-1, 0, RED);
    doc.set(4, 0, RED);
    doc.set(0, 9, RED);
    expect(countOpaque(doc)).toBe(0);
  });

  it('snapshots independently of later edits', () => {
    const doc = new PixelDoc(4, 4);
    doc.set(0, 0, RED);
    const snapshot = doc.snapshot();
    doc.set(1, 1, RED);
    doc.restore(snapshot);
    expect(countOpaque(doc)).toBe(1);
  });
});

describe('sameColor', () => {
  it('treats all fully transparent pixels as equal despite stale channels', () => {
    expect(sameColor([255, 0, 0, 0], [0, 0, 255, 0])).toBe(true);
  });

  it('distinguishes opaque colours', () => {
    expect(sameColor(RED, BLUE)).toBe(false);
  });
});

describe('floodFill', () => {
  it('fills a bounded region and stops at the wall', () => {
    const doc = docFromRows([
      '#####',
      '#...#',
      '#...#',
      '#####',
      '.....',
    ]);
    floodFill(doc, 2, 2, BLUE);
    expect(doc.get(2, 1)).toEqual(BLUE);
    expect(doc.get(0, 4)[3]).toBe(0); // outside the wall, untouched
  });

  it('reaches around a concave obstacle', () => {
    const doc = docFromRows([
      '#######',
      '#.....#',
      '#.###.#',
      '#.....#',
      '#######',
    ]);
    floodFill(doc, 1, 1, BLUE);
    expect(doc.get(5, 3)).toEqual(BLUE);
    expect(doc.get(3, 2)).toEqual(RED); // the obstacle itself survives
  });

  it('does nothing when the target already holds the fill colour', () => {
    const doc = new PixelDoc(4, 4);
    doc.set(1, 1, BLUE);
    floodFill(doc, 1, 1, BLUE);
    expect(countOpaque(doc)).toBe(1);
  });

  // Guards the iterative implementation: a recursive fill overflows here.
  it('fills a full 128x128 canvas without exhausting the stack', () => {
    const doc = new PixelDoc(128, 128);
    floodFill(doc, 64, 64, RED);
    expect(countOpaque(doc)).toBe(128 * 128);
  });
});

describe('liftRegion and stampRegion', () => {
  // An L, so a flipped or transposed region can't pass as correct.
  const L = docFromRows([
    '......',
    '.#....',
    '.#....',
    '.##...',
    '......',
    '......',
  ]);

  it('lifts a rectangle and stamps it back unchanged', () => {
    const region = liftRegion(L, { x: 1, y: 1, w: 2, h: 3 });
    const doc = new PixelDoc(6, 6);
    stampRegion(doc, region, 1, 1);
    expect(rowsFromDoc(doc)).toEqual(rowsFromDoc(L));
  });

  it('carries the pixels to a new corner', () => {
    const region = liftRegion(L, { x: 1, y: 1, w: 2, h: 3 });
    const doc = new PixelDoc(6, 6);
    stampRegion(doc, region, 3, 2);
    expect(rowsFromDoc(doc)).toEqual([
      '......',
      '......',
      '...#..',
      '...#..',
      '...##.',
      '......',
    ]);
  });

  it('replaces the destination rather than merging into it', () => {
    // A blank region stamped over art wipes it: transparency is carried too.
    const blank = liftRegion(new PixelDoc(6, 6), { x: 0, y: 0, w: 2, h: 3 });
    const doc = docFromRows(rowsFromDoc(L));
    stampRegion(doc, blank, 1, 1);
    expect(countOpaque(doc)).toBe(0);
  });

  it('reads transparent past the edges instead of failing', () => {
    const region = liftRegion(L, { x: 4, y: 4, w: 4, h: 4 });
    expect(region.data.every((channel) => channel === 0)).toBe(true);
  });

  it('drops the part of a stamp that falls outside the canvas', () => {
    const region = liftRegion(L, { x: 1, y: 1, w: 2, h: 3 });
    const doc = new PixelDoc(6, 6);
    stampRegion(doc, region, 5, 4);
    // Only the top-left cell of the L lands; the rest is off the canvas.
    expect(countOpaque(doc)).toBe(2);
    expect(doc.get(5, 4)).toEqual(RED);
  });

  it('survives a self-overlapping move, source cleared then stamped', () => {
    const doc = docFromRows(rowsFromDoc(L));
    const from = { x: 1, y: 1, w: 2, h: 3 };
    const region = liftRegion(doc, from);

    for (let y = from.y; y < from.y + from.h; y++) {
      for (let x = from.x; x < from.x + from.w; x++) doc.set(x, y, TRANSPARENT);
    }
    stampRegion(doc, region, 2, 2); // one cell right and down — overlaps itself

    expect(rowsFromDoc(doc)).toEqual([
      '......',
      '......',
      '..#...',
      '..#...',
      '..##..',
      '......',
    ]);
  });
});

describe('rotate', () => {
  // An asymmetric glyph, so an orientation error can't hide behind symmetry.
  const F = docFromRows([
    '.........',
    '.#####...',
    '.#.......',
    '.#.......',
    '.####....',
    '.#.......',
    '.#.......',
    '.#.......',
    '.........',
  ]);

  it('leaves the art untouched at 0 degrees', () => {
    expect(rowsFromDoc(rotate(F, 0))).toEqual(rowsFromDoc(F));
  });

  it('turns clockwise', () => {
    // The stem running down the left becomes the row running right along the top.
    expect(rowsFromDoc(rotate(F, 90))[1]).toBe('.#######.');
  });

  it('is lossless at right angles', () => {
    expect(countOpaque(rotate(F, 90))).toBe(countOpaque(F));
    expect(countOpaque(rotate(F, 180))).toBe(countOpaque(F));
    expect(countOpaque(rotate(F, 270))).toBe(countOpaque(F));
  });

  it('returns to the original after four quarter turns', () => {
    const four = rotate(rotate(rotate(rotate(F, 90), 90), 90), 90);
    expect(rowsFromDoc(four)).toEqual(rowsFromDoc(F));
  });

  it('composes: 270 equals three 90s, and 180 twice is identity', () => {
    expect(rowsFromDoc(rotate(F, 270))).toEqual(
      rowsFromDoc(rotate(rotate(rotate(F, 90), 90), 90)),
    );
    expect(rowsFromDoc(rotate(rotate(F, 180), 180))).toEqual(rowsFromDoc(F));
  });

  it('normalises angles outside 0-359', () => {
    expect(rowsFromDoc(rotate(F, 360))).toEqual(rowsFromDoc(F));
    expect(rowsFromDoc(rotate(F, -90))).toEqual(rowsFromDoc(rotate(F, 270)));
    expect(rowsFromDoc(rotate(F, 450))).toEqual(rowsFromDoc(rotate(F, 90)));
  });

  it('keeps the canvas size and never writes out of bounds', () => {
    const wide = new PixelDoc(9, 5);
    wide.set(0, 0, RED);
    const turned = rotate(wide, 37);
    expect([turned.width, turned.height]).toEqual([9, 5]);
  });

  it('resamples arbitrary angles without inventing colours', () => {
    const turned = rotate(F, 45);
    for (let i = 0; i < turned.data.length; i += 4) {
      if (turned.data[i + 3] === 0) continue;
      expect([turned.data[i], turned.data[i + 1], turned.data[i + 2]]).toEqual([255, 0, 0]);
    }
  });
});
