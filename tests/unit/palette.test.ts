import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTE, hexToRgba, rgbaToCss, rgbaToHex } from '../../src/palette';
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

describe('tool metadata', () => {
  it('gives every tool a unique id and shortcut', () => {
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length);
    expect(new Set(TOOLS.map((t) => t.shortcut)).size).toBe(TOOLS.length);
  });

  it('marks only the read-only tools as non-destructive', () => {
    expect(isDestructive('pencil')).toBe(true);
    expect(isDestructive('eyedropper')).toBe(false);
    expect(isDestructive('select')).toBe(false);
  });

  it('offers a brush width to the tools that stroke', () => {
    for (const tool of ['pencil', 'eraser', 'line', 'rect', 'oval', 'polygon'] as const) {
      expect(hasBrushSize(tool)).toBe(true);
    }
    for (const tool of ['bucket', 'eyedropper', 'select'] as const) {
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
