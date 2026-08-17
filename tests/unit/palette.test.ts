import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PALETTE,
  MAX_CUSTOM_SWATCHES,
  hexToRgba,
  isHexColor,
  parseSwatches,
  rgbaToCss,
  rgbaToHex,
  withSwatch,
  withoutSwatch,
} from '../../src/palette';
import { TOOLS, hasBrushSize, hasShapeFill, isBrushSize, isDestructive, isShapeTool } from '../../src/tools';

describe('colour conversion', () => {
  it('parses six-digit hex as opaque rgba', () => {
    expect(hexToRgba('#41a6f6')).toEqual([65, 166, 246, 255]);
  });

  it('expands three-digit shorthand', () => {
    expect(hexToRgba('#fff')).toEqual([255, 255, 255, 255]);
  });

  it('round-trips every palette entry', () => {
    for (const hex of DEFAULT_PALETTE) {
      expect(rgbaToHex(hexToRgba(hex))).toBe(hex);
    }
  });

  it('pads single-digit channels', () => {
    expect(rgbaToHex([1, 2, 3, 255])).toBe('#010203');
  });

  it('renders css with alpha as a fraction', () => {
    expect(rgbaToCss([255, 0, 0, 255])).toBe('rgba(255, 0, 0, 1)');
    expect(rgbaToCss([255, 0, 0, 0])).toBe('rgba(255, 0, 0, 0)');
  });
});

describe('saved swatches', () => {
  const fill = (count: number) =>
    Array.from({ length: count }, (_, i) => `#${i.toString(16).padStart(6, '0')}`);

  it('accepts only six-digit hex colours', () => {
    expect(isHexColor('#00ffAA')).toBe(true);
    expect(isHexColor('#fff')).toBe(false); // shorthand isn't the stored form
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor(null)).toBe(false);
  });

  it('adds a colour, lowercased, and refuses a duplicate', () => {
    expect(withSwatch([], '#AABBCC')).toEqual(['#aabbcc']);
    const saved = ['#aabbcc'];
    // The same list back, so the caller can tell a save from a no-op.
    expect(withSwatch(saved, '#aabbcc')).toBe(saved);
    expect(withSwatch(saved, '#AABBCC')).toBe(saved);
  });

  it('ignores anything that is not a colour', () => {
    const saved = ['#aabbcc'];
    expect(withSwatch(saved, 'nonsense')).toBe(saved);
  });

  it('drops the oldest once full, so saving one more always works', () => {
    const full = fill(MAX_CUSTOM_SWATCHES);
    const next = withSwatch(full, '#ffffff');
    expect(next).toHaveLength(MAX_CUSTOM_SWATCHES);
    expect(next[next.length - 1]).toBe('#ffffff');
    expect(next).not.toContain(full[0]);
  });

  it('removes a colour, and leaves the list alone when it has none', () => {
    const saved = ['#aabbcc', '#001122'];
    expect(withoutSwatch(saved, '#AABBCC')).toEqual(['#001122']);
    expect(withoutSwatch(saved, '#ffffff')).toBe(saved);
  });

  it('round-trips through storage', () => {
    const saved = ['#aabbcc', '#001122'];
    expect(parseSwatches(JSON.stringify(saved))).toEqual(saved);
  });

  it('survives junk in storage rather than taking the editor down', () => {
    expect(parseSwatches(null)).toEqual([]);
    expect(parseSwatches('not json')).toEqual([]);
    expect(parseSwatches('{"nope":1}')).toEqual([]);
    // A corrupted entry costs that colour, not the rest.
    expect(parseSwatches('["#aabbcc", 7, "red", "#AABBCC", "#001122"]')).toEqual([
      '#aabbcc',
      '#001122',
    ]);
  });

  it('keeps the newest when storage holds more than the limit', () => {
    const tooMany = fill(MAX_CUSTOM_SWATCHES + 4);
    const parsed = parseSwatches(JSON.stringify(tooMany));
    expect(parsed).toHaveLength(MAX_CUSTOM_SWATCHES);
    expect(parsed[parsed.length - 1]).toBe(tooMany[tooMany.length - 1]);
  });
});

describe('tool metadata', () => {
  it('gives every tool a unique id and shortcut', () => {
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length);
    expect(new Set(TOOLS.map((t) => t.shortcut)).size).toBe(TOOLS.length);
  });

  it('marks only the read-only tools as non-destructive', () => {
    expect(isDestructive('pencil')).toBe(true);
    expect(isDestructive('eyedropper')).toBe(false);
    expect(isDestructive('duplicate')).toBe(false);
  });

  it('offers a brush width to the tools that stroke', () => {
    for (const tool of ['pencil', 'eraser', 'line', 'rect', 'oval', 'polygon'] as const) {
      expect(hasBrushSize(tool)).toBe(true);
    }
    for (const tool of ['bucket', 'eyedropper', 'duplicate'] as const) {
      expect(hasBrushSize(tool)).toBe(false);
    }
  });

  it('offers a fill only to closed shapes', () => {
    expect(hasShapeFill('rect')).toBe(true);
    expect(hasShapeFill('oval')).toBe(true);
    expect(hasShapeFill('polygon')).toBe(true);
    expect(hasShapeFill('line')).toBe(false);
    expect(hasShapeFill('pencil')).toBe(false);
  });

  it('counts only the drag shapes as shape tools', () => {
    expect(isShapeTool('line')).toBe(true);
    expect(isShapeTool('polygon')).toBe(false); // click sequence, not a drag
  });

  it('accepts only the odd brush sizes, so a brush has a true centre', () => {
    expect(isBrushSize(1)).toBe(true);
    expect(isBrushSize(3)).toBe(true);
    expect(isBrushSize(5)).toBe(true);
    expect(isBrushSize(2)).toBe(false);
    expect(isBrushSize(7)).toBe(false);
  });
});
