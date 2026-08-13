import { describe, expect, it } from 'vitest';
import { PixelDoc, mirrorHalf, mirrorPoint } from '../../src/canvas';
import { floodFill, stamp, strokeShape } from '../../src/tools';
import { RED, countOpaque, docFromRows, rowsFromDoc } from './helpers';

const ctx = (doc: PixelDoc, size: 1 | 3 | 5 = 1) => ({
  doc,
  color: RED,
  size,
  setColor: () => {},
});

describe('mirrorPoint', () => {
  it('reflects across a vertical line, leaving the row alone', () => {
    expect(mirrorPoint(32, 32, 'vertical', 3, 7)).toEqual([28, 7]);
  });

  it('reflects across a horizontal line, leaving the column alone', () => {
    expect(mirrorPoint(32, 32, 'horizontal', 3, 7)).toEqual([3, 24]);
  });

  it('is its own inverse', () => {
    const once = mirrorPoint(16, 9, 'horizontal', 5, 2);
    expect(mirrorPoint(16, 9, 'horizontal', ...once)).toEqual([5, 2]);
  });
});

describe('mirrorHalf', () => {
  it('splits an even extent into two halves of the same width', () => {
    expect(mirrorHalf(32, 0)).toEqual([0, 15]);
    expect(mirrorHalf(32, 15)).toEqual([0, 15]);
    expect(mirrorHalf(32, 16)).toEqual([16, 31]);
    expect(mirrorHalf(32, 31)).toEqual([16, 31]);
  });

  it('lets both halves of an odd extent reach the middle cell', () => {
    expect(mirrorHalf(33, 0)).toEqual([0, 16]);
    expect(mirrorHalf(33, 32)).toEqual([16, 32]);
  });
});

describe('PixelDoc mirroring', () => {
  it('writes nothing but the cell asked for while mirroring is off', () => {
    const doc = new PixelDoc(8, 8);
    doc.set(1, 1, RED);
    expect(countOpaque(doc)).toBe(1);
  });

  it('echoes each write across a vertical line', () => {
    const doc = new PixelDoc(8, 4);
    doc.mirror = 'vertical';
    doc.set(1, 1, RED);
    doc.set(2, 2, RED);

    expect(rowsFromDoc(doc)).toEqual([
      '........',
      '.#....#.',
      '..#..#..',
      '........',
    ]);
  });

  it('echoes each write across a horizontal line', () => {
    const doc = new PixelDoc(4, 8);
    doc.mirror = 'horizontal';
    doc.set(1, 1, RED);

    expect(rowsFromDoc(doc)).toEqual([
      '....',
      '.#..',
      '....',
      '....',
      '....',
      '....',
      '.#..',
      '....',
    ]);
  });

  it('writes a cell on the line once, not twice', () => {
    const doc = new PixelDoc(5, 5);
    doc.mirror = 'vertical';
    doc.set(2, 3, RED);
    expect(countOpaque(doc)).toBe(1);
  });

  it('drops reflections that fall outside the canvas as any write would', () => {
    const doc = new PixelDoc(8, 8);
    doc.mirror = 'vertical';
    doc.set(-1, 4, RED); // reflects onto x = 8, also out of bounds
    expect(countOpaque(doc)).toBe(0);
  });

  it('stops echoing as soon as the flag is cleared', () => {
    const doc = new PixelDoc(8, 8);
    doc.mirror = 'vertical';
    doc.set(1, 1, RED);
    doc.mirror = null;
    doc.set(1, 3, RED);
    expect(countOpaque(doc)).toBe(3);
  });
});

describe('tools under a mirror', () => {
  it('mirrors a whole brush stamp, not just its center', () => {
    const doc = new PixelDoc(10, 5);
    doc.mirror = 'vertical';
    stamp(doc, 2, 2, 3, RED);

    expect(rowsFromDoc(doc)).toEqual([
      '..........',
      '.###..###.',
      '.###..###.',
      '.###..###.',
      '..........',
    ]);
  });

  it('mirrors a shape outline drawn on one side', () => {
    const doc = new PixelDoc(12, 6);
    doc.mirror = 'vertical';
    strokeShape('rect', ctx(doc), 1, 1, 4, 4);

    expect(rowsFromDoc(doc)).toEqual([
      '............',
      '.####..####.',
      '.#..#..#..#.',
      '.#..#..#..#.',
      '.####..####.',
      '............',
    ]);
  });

  it('mirrors a fill without filling the reflection twice', () => {
    const doc = docFromRows([
      '............',
      '.####..####.',
      '.#..#..#..#.',
      '.####..####.',
      '............',
    ]);
    doc.mirror = 'vertical';
    floodFill(doc, 2, 2, RED);

    expect(rowsFromDoc(doc)).toEqual([
      '............',
      '.####..####.',
      '.####..####.',
      '.####..####.',
      '............',
    ]);
  });
});
