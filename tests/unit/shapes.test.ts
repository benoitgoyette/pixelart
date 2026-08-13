import { describe, expect, it } from 'vitest';
import { PixelDoc, linePoints } from '../../src/canvas';
import { fillPolygon, fillShape, shapePoints, stamp, strokePolygon } from '../../src/tools';
import { BLUE, RED, countOpaque, docFromRows, plot, rowsFromDoc } from './helpers';

const ctx = (doc: PixelDoc, size: 1 | 3 | 5 = 1) => ({
  doc,
  color: RED,
  size,
  setColor: () => {},
});

describe('linePoints', () => {
  it('draws a connected run with no gaps', () => {
    const points = linePoints(0, 0, 9, 4);
    for (let i = 1; i < points.length; i++) {
      const dx = Math.abs(points[i][0] - points[i - 1][0]);
      const dy = Math.abs(points[i][1] - points[i - 1][1]);
      expect(Math.max(dx, dy)).toBe(1);
    }
  });

  it('covers the same cells drawn either direction', () => {
    const key = (p: Array<[number, number]>) => p.map(([x, y]) => `${x},${y}`).sort();
    expect(key(linePoints(0, 0, 9, 4))).toEqual(key(linePoints(9, 4, 0, 0)));
  });

  it('includes both endpoints', () => {
    const points = linePoints(2, 3, 7, 1);
    expect(points[0]).toEqual([2, 3]);
    expect(points[points.length - 1]).toEqual([7, 1]);
  });
});

describe('rectangle outline', () => {
  it('traces the perimeter and leaves the interior empty', () => {
    expect(plot(10, 7, shapePoints('rect', 1, 1, 8, 5))).toEqual([
      '..........',
      '.########.',
      '.#......#.',
      '.#......#.',
      '.#......#.',
      '.########.',
      '..........',
    ]);
  });

  it('is independent of which corner the drag started from', () => {
    const key = (p: Array<[number, number]>) => p.map(([x, y]) => `${x},${y}`).sort();
    expect(key(shapePoints('rect', 8, 5, 1, 1))).toEqual(key(shapePoints('rect', 1, 1, 8, 5)));
  });
});

describe('oval outline', () => {
  it('closes with no gaps in the near-horizontal or near-vertical runs', () => {
    expect(plot(16, 12, shapePoints('oval', 1, 1, 14, 10))).toEqual([
      '................',
      '.....######.....',
      '...##......##...',
      '..#..........#..',
      '.#............#.',
      '.#............#.',
      '.#............#.',
      '.#............#.',
      '..#..........#..',
      '...##......##...',
      '.....######.....',
      '................',
    ]);
  });

  // Regression: Math.round sent both edges of a half-pixel center the same way,
  // collapsing a 2x2 oval to three cells.
  it('keeps both edges of an even-sized box', () => {
    expect(plot(4, 4, shapePoints('oval', 1, 1, 2, 2))).toEqual([
      '....',
      '.##.',
      '.##.',
      '....',
    ]);
  });

  it('degenerates to a straight line when a radius is zero', () => {
    expect(plot(6, 3, shapePoints('oval', 1, 1, 4, 1))).toEqual(['......', '.####.', '......']);
  });

  it('stays inside its bounding box', () => {
    for (const [x1, y1] of [[7, 5], [4, 9], [1, 1]] as const) {
      for (const [x, y] of shapePoints('oval', 1, 1, x1, y1)) {
        expect(x).toBeGreaterThanOrEqual(1);
        expect(y).toBeGreaterThanOrEqual(1);
        expect(x).toBeLessThanOrEqual(x1);
        expect(y).toBeLessThanOrEqual(y1);
      }
    }
  });
});

describe('shape fill', () => {
  it('fills a rectangle up to its outline', () => {
    const doc = new PixelDoc(10, 7);
    fillShape('rect', doc, 1, 1, 8, 5, RED);
    expect(rowsFromDoc(doc)).toEqual([
      '..........',
      '.########.',
      '.########.',
      '.########.',
      '.########.',
      '.########.',
      '..........',
    ]);
  });

  it('keeps an oval fill inside the outline it was drawn from', () => {
    const doc = new PixelDoc(16, 12);
    fillShape('oval', doc, 1, 1, 14, 10, RED);
    const outline = new Set(
      shapePoints('oval', 1, 1, 14, 10).map(([x, y]) => `${x},${y}`),
    );
    // Every filled cell is either on the outline or has filled neighbours on
    // both sides in its row — i.e. nothing escaped the curve.
    for (let y = 0; y < doc.height; y++) {
      for (let x = 0; x < doc.width; x++) {
        if (doc.get(x, y)[3] === 0) continue;
        const inside = doc.get(x - 1, y)[3] > 0 && doc.get(x + 1, y)[3] > 0;
        expect(outline.has(`${x},${y}`) || inside).toBe(true);
      }
    }
  });

  it('accepts corners in any order', () => {
    const a = new PixelDoc(8, 8);
    const b = new PixelDoc(8, 8);
    fillShape('oval', a, 1, 1, 6, 6, RED);
    fillShape('oval', b, 6, 6, 1, 1, RED);
    expect(rowsFromDoc(a)).toEqual(rowsFromDoc(b));
  });
});

describe('polygon', () => {
  it('fills a concave outline without spilling past it', () => {
    const doc = new PixelDoc(20, 14);
    const points: Array<[number, number]> = [
      [1, 1],
      [10, 6],
      [18, 1],
      [18, 12],
      [1, 12],
    ];
    fillPolygon(doc, points, RED);
    const rows = rowsFromDoc(doc);
    // The notch between the two peaks must stay empty.
    expect(rows[1][9]).toBe('.');
    expect(rows[2][9]).toBe('.');
    // ...while the body below it is solid.
    expect(rows[11].slice(1, 19)).toBe('#'.repeat(18));
  });

  it('applies the even-odd rule, leaving a star hollow', () => {
    const doc = new PixelDoc(20, 14);
    fillPolygon(doc, [[9, 0], [12, 9], [3, 3], [16, 3], [6, 9]], RED);
    // Center of the star sits in a doubly-wound region: empty under even-odd.
    expect(doc.get(9, 5)[3]).toBe(0);
  });

  it('ignores horizontal edges rather than double-counting them', () => {
    const doc = new PixelDoc(10, 8);
    fillPolygon(doc, [[1, 1], [8, 1], [8, 6], [1, 6]], RED);
    const rows = rowsFromDoc(doc);
    // A parity bug from counting horizontal edges stripes the shape: every row
    // the fill covers must be solid, never alternating.
    for (let y = 1; y <= 5; y++) {
      expect(rows[y].slice(1, 9)).toBe('#'.repeat(8));
    }
    // The half-open rule leaves the bottom edge row to the outline, so the fill
    // alone stops one row short.
    expect(rows[6].slice(1, 9)).toBe('.'.repeat(8));
  });

  it('closes the bottom edge once the outline is stroked over the fill', () => {
    const doc = new PixelDoc(10, 8);
    strokePolygon(ctx(doc), [[1, 1], [8, 1], [8, 6], [1, 6]], true, BLUE);
    // What the user sees: no gap along any edge of a filled polygon.
    expect(rowsFromDoc(doc)[6].slice(1, 9)).toBe('#'.repeat(8));
  });

  it('needs three points to fill', () => {
    const doc = new PixelDoc(8, 8);
    fillPolygon(doc, [[1, 1], [6, 6]], RED);
    expect(countOpaque(doc)).toBe(0);
  });

  it('strokes an open polygon without the closing edge', () => {
    const open = new PixelDoc(8, 8);
    const closed = new PixelDoc(8, 8);
    const points: Array<[number, number]> = [[1, 1], [6, 1], [6, 6]];
    strokePolygon(ctx(open), points, false);
    strokePolygon(ctx(closed), points, true);
    expect(countOpaque(closed)).toBeGreaterThan(countOpaque(open));
  });

  it('stamps a lone vertex, which has no edge', () => {
    const doc = new PixelDoc(8, 8);
    strokePolygon(ctx(doc), [[3, 3]], false);
    expect(countOpaque(doc)).toBe(1);
  });

  it('draws the fill under the outline, not over it', () => {
    const doc = new PixelDoc(12, 12);
    strokePolygon(ctx(doc), [[1, 1], [10, 1], [10, 10], [1, 10]], true, BLUE);
    expect(doc.get(1, 1)).toEqual(RED); // outline colour survives on the edge
    expect(doc.get(5, 5)).toEqual(BLUE); // fill colour inside
  });
});

describe('stamp', () => {
  it('centres an odd-sized brush on the target cell', () => {
    const doc = new PixelDoc(7, 7);
    stamp(doc, 3, 3, 3, RED);
    expect(rowsFromDoc(doc)).toEqual([
      '.......',
      '.......',
      '..###..',
      '..###..',
      '..###..',
      '.......',
      '.......',
    ]);
  });

  it('clips at the edges instead of wrapping', () => {
    const doc = new PixelDoc(5, 5);
    stamp(doc, 0, 0, 5, RED);
    expect(rowsFromDoc(doc)).toEqual(['###..', '###..', '###..', '.....', '.....']);
    // Nothing leaked to the far side of the canvas.
    expect(doc.get(4, 4)[3]).toBe(0);
  });

  it('paints a partial brush when the centre is off-canvas', () => {
    const doc = docFromRows(['.....', '.....', '.....', '.....', '.....']);
    stamp(doc, -1, 2, 5, RED);
    expect(countOpaque(doc)).toBeGreaterThan(0);
  });
});
