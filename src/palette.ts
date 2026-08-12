import { RGBA } from './canvas';

/** A compact 16-color starter palette (Sweetie-16 style ramp). */
export const DEFAULT_PALETTE: string[] = [
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
