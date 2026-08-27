import { hslToRgb, luminance, mixColor, seedRng } from '../../shared/overlay';

/** Logical pixel size of the scene's chunky-pixel grid. */
export const PX = 4;
/** Coarser grid used for the plate/stain artwork. */
export const PLATE_PIXEL = PX * 2;

export interface Palette {
  base: number;
  panel: number;
  ink: number;
  dim: number;
  accent: number;
  pop: number;
  glow: number;
}

export function makePalette(seed: number, userAccent: number): Palette {
  const rng = seedRng(seed ^ 0x9e3779b9);
  const hue = Math.floor(rng() * 360);
  const scheme = seed % 7;
  const panel = hslToRgb(hue, 0.74 + rng() * 0.22, 0.50 + rng() * 0.20);
  const accentHue = hue + [28, 58, 112, 154, 188, 226, 302][scheme];
  const popHue = hue + [176, 214, 268, 318, 92, 136, 42][scheme];
  const accent = mixColor(userAccent, hslToRgb(accentHue, 0.94, 0.58), 0.38);
  const pop = hslToRgb(popHue, 0.84 + rng() * 0.14, 0.54 + rng() * 0.20);
  const darkTint = hslToRgb(hue + 18, 0.48 + rng() * 0.24, 0.12 + rng() * 0.12);
  const base = mixColor(darkTint, hslToRgb(hue + 40, 0.68, 0.34), 0.18 + rng() * 0.18);
  const glow = hslToRgb(accentHue + 24, 0.86 + rng() * 0.12, 0.68 + rng() * 0.14);
  const dim = hslToRgb(hue + 96 + rng() * 88, 0.56 + rng() * 0.22, 0.36 + rng() * 0.16);
  const plateLight = luminance(mixColor(panel, userAccent, 0.45));
  const ink = plateLight > 0.58 ? mixColor(base, 0x050505, 0.42) : 0xf8fff4;

  return { base, panel, ink, dim, accent, pop, glow };
}

export function snapPixel(value: number, grid = PLATE_PIXEL): number {
  return Math.round(value / grid) * grid;
}

export function pixelSize(value: number, grid = PLATE_PIXEL): number {
  return Math.max(grid, Math.ceil(value / grid) * grid);
}
