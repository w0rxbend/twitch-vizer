import { clamp } from './math';

/** Parses a CSS-style hex color ("#abc" or "#aabbcc") to packed 0xRRGGBB. */
export function colorFromString(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  let hex = value.startsWith('#') ? value.slice(1) : value;
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    hex = hex.replace(/./g, (ch) => ch + ch);
  }
  if (!/^[0-9a-f]{6}$/i.test(hex)) return fallback;
  return Number.parseInt(hex, 16);
}

/** Relative luminance (WCAG coefficients) of a packed 0xRRGGBB color, 0..1. */
export function luminance(color: number): number {
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function hslToRgb(h: number, s: number, l: number): number {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  return (
    (Math.round((r + m) * 255) << 16)
    | (Math.round((g + m) * 255) << 8)
    | Math.round((b + m) * 255)
  );
}

/** Linear interpolation between two packed 0xRRGGBB colors, t clamped to 0..1. */
export function mixColor(a: number, b: number, t: number): number {
  const clamped = clamp(t, 0, 1);
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  return (
    (Math.round(ar + (br - ar) * clamped) << 16)
    | (Math.round(ag + (bg - ag) * clamped) << 8)
    | Math.round(ab + (bb - ab) * clamped)
  );
}

/** Builds a PIXI fill-style object from a packed 0xRRGGBB color and alpha. */
export function fillStyle(color: number, alpha: number): { color: number; alpha: number } {
  return { color, alpha };
}
