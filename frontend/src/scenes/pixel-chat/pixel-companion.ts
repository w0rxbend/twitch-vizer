import * as PIXI from 'pixi.js';

import { fillStyle, hslToRgb, mixColor, seedRng } from '../../shared/overlay';
import { makeStaticParticleContainer } from '../../shared/pixi';
import { addPixelParticle, PX } from './pixel-helpers';
import type { Palette } from './theme';

/** Vertical space PixelChatCard reserves for the companion sprite. */
export const COMPANION_HEIGHT = 76;

/** The per-seed choices every drawing step reads from. */
interface CompanionProfile {
  type: number;
  eyes: number;
  mouth: number;
  hat: number;
  body: number;
  shirt: number;
  accent: number;
  hair: number;
  skin: number;
  dark: number;
  light: number;
}

type CellFn = (x: number, y: number, tint: number, alpha?: number) => void;
type BlockFn = (x: number, y: number, w: number, h: number, tint: number, alpha?: number) => void;

/** A small procedural mascot (blob, human, robot, ...) drawn per user seed. */
export class PixelCompanion {
  readonly view = new PIXI.Container();

  constructor(texture: PIXI.Texture, palette: Palette, userAccent: number, seed: number) {
    const shadow = new PIXI.Graphics()
      .rect(14, 67, 38, PX).fill(fillStyle(0x000000, 0.34))
      .rect(20, 70, 26, PX).fill(fillStyle(0x000000, 0.22));
    const layer = makeStaticParticleContainer(texture);
    const rng = seedRng(seed ^ 0xc0de);
    const particles: PIXI.Particle[] = [];
    const colors = this.makeColors(palette, userAccent, seed);
    const profile: CompanionProfile = {
      type: seed % 12,
      eyes: Math.floor(seed / 13) % 8,
      mouth: Math.floor(seed / 41) % 7,
      hat: Math.floor(seed / 89) % 9,
      body: colors[Math.floor(seed / 7) % colors.length],
      shirt: colors[Math.floor(seed / 19) % colors.length],
      accent: colors[Math.floor(seed / 31) % colors.length],
      hair: mixColor(colors[Math.floor(seed / 53) % colors.length], 0x120916, 0.48),
      skin: hslToRgb(22 + (seed % 32), 0.64, 0.62),
      dark: mixColor(palette.night, 0x000000, 0.42),
      light: mixColor(colors[Math.floor(seed / 101) % colors.length], 0xffffff, 0.36),
    };

    const add = (x: number, y: number, w: number, h: number, tint: number, alpha = 1) =>
      addPixelParticle(particles, texture, x, y, w, h, tint, alpha);
    const cell = (x: number, y: number, tint: number, alpha = 1) => add(x * PX, y * PX, PX, PX, tint, alpha);
    const block = (x: number, y: number, w: number, h: number, tint: number, alpha = 1) => add(x * PX, y * PX, w * PX, h * PX, tint, alpha);

    if (profile.type < 5) {
      this.blobBody(cell, profile, rng);
    } else if (profile.type < 8) {
      this.humanBody(cell, block, profile, rng);
    } else if (profile.type < 10) {
      this.robotBody(cell, block, profile, rng);
    } else {
      this.tallOneEyeBody(cell, block, profile, rng);
    }

    this.face(cell, block, profile);
    this.accessories(cell, block, profile, rng, palette);
    this.dither(cell, profile, rng);

    layer.addParticle(...particles);
    layer.update();
    this.view.addChild(shadow, layer);
  }

  private makeColors(palette: Palette, userAccent: number, seed: number): number[] {
    const rng = seedRng(seed ^ 0x51357);
    return [
      userAccent,
      palette.line,
      palette.rose,
      palette.gold,
      palette.blue,
      palette.violet,
      palette.leaf,
      hslToRgb(14 + rng() * 34, 0.88, 0.54),
      hslToRgb(102 + rng() * 45, 0.74, 0.48),
      hslToRgb(190 + rng() * 42, 0.88, 0.56),
    ];
  }

  private blobBody(
    cell: CellFn,
    profile: Pick<CompanionProfile, 'type' | 'body' | 'dark' | 'light' | 'accent'>,
    rng: () => number,
  ): void {
    const cx = profile.type === 3 ? 9 : 8;
    const cy = profile.type === 2 ? 8 : 9;
    const rx = [5.7, 4.4, 5.0, 4.8, 5.8][profile.type] ?? 5.2;
    const ry = [6.0, 6.4, 5.2, 6.7, 4.9][profile.type] ?? 5.6;
    const cells: boolean[][] = [];

    for (let y = 0; y < 17; y++) {
      cells[y] = [];
      for (let x = 0; x < 17; x++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        let inside = nx * nx + ny * ny < 1.02 + Math.sin(x * 1.1 + y * 0.6) * 0.05;
        if (profile.type === 2) inside ||= (Math.abs(x - cx) < 2.5 && y > 2 && y < 14);
        if (profile.type === 3) inside ||= (x > 11 && x < 15 && y > 7 && y < 11);
        cells[y][x] = inside;
      }
    }

    for (let y = 0; y < cells.length; y++) {
      for (let x = 0; x < cells[y].length; x++) {
        if (!cells[y][x]) continue;
        const edge = !cells[y - 1]?.[x] || !cells[y + 1]?.[x] || !cells[y]?.[x - 1] || !cells[y]?.[x + 1];
        const tint = edge ? profile.dark : y < cy - 2 ? profile.light : profile.body;
        cell(x, y + 1, tint, 0.98);
      }
    }

    if (profile.type === 0 || profile.type === 4) {
      cell(3, 3, profile.dark);
      cell(4, 2, profile.light);
      cell(12, 3, profile.dark);
      cell(11, 2, profile.light);
    }
    if (profile.type === 3) {
      for (let t = 0; t < 4; t++) cell(14 + t, 8 - t, profile.accent, 0.9);
    }
    cell(5, 15, profile.dark);
    cell(10, 15, profile.dark);
    if (rng() > 0.45) {
      cell(1, 9, profile.dark);
      cell(15, 9, profile.dark);
    }
  }

  private humanBody(
    cell: CellFn,
    block: BlockFn,
    profile: Pick<CompanionProfile, 'type' | 'shirt' | 'skin' | 'hair' | 'dark' | 'accent' | 'light'>,
    rng: () => number,
  ): void {
    block(5, 3, 7, 7, profile.dark);
    block(6, 3, 5, 7, profile.skin);
    block(5, 2, 7, 3, profile.hair);
    if (profile.type === 5) {
      block(4, 1, 8, 2, profile.hair);
      cell(3, 3, profile.hair);
      cell(12, 3, profile.hair);
    } else if (profile.type === 6) {
      block(5, 1, 7, 2, profile.accent);
      cell(11, 0, profile.light);
    } else {
      block(4, 3, 3, 2, profile.hair);
      block(10, 3, 3, 2, profile.hair);
    }
    block(5, 10, 7, 5, profile.dark);
    block(6, 10, 5, 5, profile.shirt);
    block(3, 11, 2, 4, profile.skin);
    block(12, 11, 2, 4, profile.skin);
    block(6, 15, 2, 3, profile.dark);
    block(10, 15, 2, 3, profile.dark);
    if (rng() > 0.5) {
      block(5, 10, 7, 1, profile.light, 0.62);
      cell(8, 12, profile.accent, 0.78);
    }
  }

  private robotBody(
    cell: CellFn,
    block: BlockFn,
    profile: Pick<CompanionProfile, 'body' | 'shirt' | 'dark' | 'accent' | 'light'>,
    rng: () => number,
  ): void {
    block(4, 3, 10, 9, profile.dark);
    block(5, 4, 8, 7, profile.body);
    block(5, 12, 8, 4, profile.dark);
    block(6, 12, 6, 3, profile.shirt);
    block(2, 7, 2, 6, profile.dark);
    block(14, 7, 2, 6, profile.dark);
    block(2, 8, 1, 4, profile.accent);
    block(15, 8, 1, 4, profile.accent);
    block(6, 16, 2, 2, profile.dark);
    block(11, 16, 2, 2, profile.dark);
    if (rng() > 0.35) {
      block(6, 1, 6, 2, profile.accent);
      cell(5, 2, profile.light);
      cell(12, 2, profile.light);
    } else {
      block(8, 0, 1, 3, profile.light);
      cell(8, 0, profile.accent);
    }
  }

  private tallOneEyeBody(
    cell: CellFn,
    block: BlockFn,
    profile: Pick<CompanionProfile, 'type' | 'body' | 'dark' | 'light' | 'accent'>,
    rng: () => number,
  ): void {
    const cx = profile.type === 10 ? 8 : 7;
    for (let y = 1; y < 17; y++) {
      const taper = y < 5 ? 5 - y : y > 13 ? y - 13 : 0;
      const left = Math.max(4, cx - 4 + taper);
      const right = Math.min(13, cx + 4 - taper);
      for (let x = left; x <= right; x++) {
        const edge = x === left || x === right || y === 1 || y === 16;
        cell(x, y, edge ? profile.dark : y < 6 ? profile.light : profile.body, 0.98);
      }
    }
    block(2, 8, 3, 2, profile.dark);
    block(12, 8, 3, 2, profile.dark);
    if (rng() > 0.42) {
      block(7, 0, 2, 2, profile.accent);
      block(6, 1, 4, 1, profile.dark);
    }
  }

  private face(
    cell: CellFn,
    block: BlockFn,
    profile: Pick<CompanionProfile, 'type' | 'eyes' | 'mouth' | 'dark' | 'light' | 'accent'>,
  ): void {
    const eye = profile.eyes % 3 === 0 ? 0xffffff : profile.eyes % 3 === 1 ? 0xfff07a : 0xbfffff;
    const pupil = 0x081018;
    if (profile.type === 1 || profile.type >= 10) {
      block(6, 6, 5, 4, profile.dark);
      block(7, 6, 3, 3, eye);
      cell(8, 7, pupil);
    } else if (profile.eyes === 3) {
      block(5, 7, 3, 1, pupil);
      block(10, 7, 3, 1, pupil);
    } else if (profile.eyes === 6) {
      block(5, 6, 3, 3, eye);
      block(10, 6, 3, 3, eye);
      cell(6, 7, pupil);
      cell(11, 7, pupil);
    } else {
      block(5, 6, 2, 2, eye);
      block(11, 6, 2, 2, eye);
      cell(6, 7, pupil);
      cell(11, 7, pupil);
    }

    if (profile.mouth === 0) block(6, 10, 6, 1, pupil);
    else if (profile.mouth === 1) {
      block(6, 10, 6, 2, pupil);
      cell(7, 10, 0xfff0c0);
      cell(10, 10, 0xfff0c0);
    } else if (profile.mouth === 2) {
      block(7, 10, 4, 1, pupil);
      cell(6, 9, pupil);
      cell(11, 9, pupil);
    } else if (profile.mouth === 3) block(7, 10, 4, 2, profile.accent);
    else block(7, 10, 5, 1, pupil);
  }

  private accessories(
    cell: CellFn,
    block: BlockFn,
    profile: Pick<CompanionProfile, 'hat' | 'dark' | 'light' | 'accent' | 'shirt'>,
    rng: () => number,
    palette: Palette,
  ): void {
    if (profile.hat === 0) {
      block(4, 1, 10, 1, profile.accent);
      block(6, 0, 6, 1, profile.accent);
    } else if (profile.hat === 1) {
      block(5, 0, 8, 2, profile.dark);
      block(6, -1, 6, 1, profile.light);
    } else if (profile.hat === 2) {
      block(4, 2, 10, 1, palette.gold);
      block(6, 0, 6, 2, profile.accent);
    } else if (profile.hat === 3) {
      block(6, 0, 2, 3, profile.dark);
      block(11, 0, 2, 3, profile.dark);
      cell(6, 0, profile.light);
      cell(12, 0, profile.light);
    } else if (profile.hat === 4) {
      block(4, 6, 10, 1, 0xffffff, 0.86);
      cell(6, 7, palette.blue);
      cell(11, 7, palette.blue);
    } else if (profile.hat === 5) {
      block(12, 5, 4, 1, profile.accent);
      cell(15, 4, profile.light);
    }

    if (rng() > 0.55) {
      block(3, 13, 2, 1, profile.accent, 0.82);
      block(13, 13, 2, 1, profile.accent, 0.82);
    }
    if (rng() > 0.72) {
      block(7, 12, 4, 1, profile.light, 0.74);
      cell(9, 13, profile.shirt, 0.84);
    }
  }

  private dither(
    cell: CellFn,
    profile: Pick<CompanionProfile, 'body' | 'light' | 'accent'>,
    rng: () => number,
  ): void {
    const colors = [profile.body, profile.light, profile.accent];
    for (let i = 0; i < 10; i++) {
      const x = 4 + Math.floor(rng() * 9);
      const y = 5 + Math.floor(rng() * 10);
      cell(x, y, colors[Math.floor(rng() * colors.length)], 0.28 + rng() * 0.32);
    }
  }
}
