import * as PIXI from 'pixi.js';

import { clamp, hslToRgb, mixColor, seedRng } from '../../shared/overlay';
import { makeStaticParticleContainer } from '../../shared/pixi';
import { PLATE_PIXEL, PX, pixelSize, snapPixel } from './palette';
import type { Palette } from './palette';

type MotifPainter = (
  out: PIXI.Particle[],
  texture: PIXI.Texture,
  width: number,
  height: number,
  palette: Palette,
  rng: () => number,
) => void;

export class PixelPattern {
  readonly view: PIXI.ParticleContainer<PIXI.Particle>;

  private readonly motifs: readonly MotifPainter[] = [
    (out, texture, width, height, palette, rng) => this.diagonalBars(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.rings(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.pixelWaves(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.blocks(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.signalRunes(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.edgeSpray(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.bubbles(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.chevrons(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.circuit(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.flameSweep(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.slashStack(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.scallops(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.mountainPixels(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.confettiLane(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.zebraCuts(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.sunbursts(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.cloudBands(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.leafBits(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.equalizer(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.checkerFade(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.ribbonCut(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.constellation(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.stairSteps(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.pixelSwirl(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.xMarks(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.honeycomb(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.drips(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.wideStripes(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.barcode(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.waveBlocks(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.petalScatter(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.glitch(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.foam(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.borderDots(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.tileSlants(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.paintScabs(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.stainIslands(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.inkPuddles(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.offsetSwatches(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.dryBrush(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.splatterRail(out, texture, width, height, palette, rng),
    (out, texture, width, height, palette, rng) => this.blockArrows(out, texture, width, height, palette, rng),
  ];

  constructor(
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    seed: number,
  ) {
    this.view = makeStaticParticleContainer(texture);

    const rng = seedRng(seed);
    const particles: PIXI.Particle[] = [];
    const motifCount = this.motifs.length;
    const motif = seed % motifCount;
    const colors = this.plateColors(palette, seed);

    this.stainWash(particles, texture, width, height, palette, colors, rng);
    this.dotField(particles, texture, width, height, colors, rng);
    this.paintMotif(motif, particles, texture, width, height, palette, rng);
    if (rng() > 0.28) {
      this.paintMotif((motif + 11 + Math.floor(rng() * 7)) % motifCount, particles, texture, width, height, palette, rng);
    }
    if (rng() > 0.56) {
      this.paintMotif((motif + 23 + Math.floor(rng() * 11)) % motifCount, particles, texture, width, height, palette, rng);
    }
    this.colorAccentBits(particles, texture, width, height, colors, rng);

    this.view.addParticle(...particles);
    this.view.update();
  }

  private add(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    x: number,
    y: number,
    w: number,
    h: number,
    tint: number,
    alpha: number,
  ): void {
    out.push(new PIXI.Particle({
      texture,
      x: snapPixel(x),
      y: snapPixel(y),
      scaleX: pixelSize(w),
      scaleY: pixelSize(h),
      tint,
      alpha: clamp(alpha * 1.28, 0.12, 0.78),
    }));
  }

  private plateColors(palette: Palette, seed: number): number[] {
    const rng = seedRng(seed ^ 0x51edc0de);
    const hue = Math.floor(rng() * 360);
    return [
      palette.panel,
      palette.accent,
      palette.pop,
      palette.glow,
      palette.dim,
      hslToRgb(hue + 54, 0.92, 0.62),
      hslToRgb(hue + 126, 0.86, 0.54),
      hslToRgb(hue + 202, 0.88, 0.58),
      hslToRgb(hue + 284, 0.82, 0.64),
      mixColor(palette.pop, 0xffffff, 0.28),
    ];
  }

  private colorAccentBits(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    colors: number[],
    rng: () => number,
  ): void {
    const bits = 18 + Math.floor(rng() * 22);
    for (let i = 0; i < bits; i++) {
      const horizontal = rng() > 0.35;
      const size = PLATE_PIXEL * (1 + Math.floor(rng() * 3));
      this.add(
        out,
        texture,
        rng() * width,
        rng() * height,
        horizontal ? size * (1 + rng() * 3) : size,
        horizontal ? PLATE_PIXEL : size * (1 + rng() * 2),
        colors[Math.floor(rng() * colors.length)],
        0.24 + rng() * 0.28,
      );
    }
  }

  private paintMotif(
    motif: number,
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    rng: () => number,
  ): void {
    this.motifs[motif](out, texture, width, height, palette, rng);
  }

  private stainWash(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    colors: number[],
    rng: () => number,
  ): void {
    const washColors = [palette.base, ...colors];
    const washes: Array<() => void> = [
      () => this.stackedStains(out, texture, width, height, washColors, rng),
      () => this.offsetStains(out, texture, width, height, washColors, rng),
      () => this.splitStains(out, texture, width, height, washColors, rng),
      () => this.brushStreaks(out, texture, width, height, washColors, rng),
      () => this.stainIslands(out, texture, width, height, palette, rng),
      () => this.inkPuddles(out, texture, width, height, palette, rng),
      () => this.offsetSwatches(out, texture, width, height, palette, rng),
    ];
    washes[Math.floor(rng() * washes.length)]();
  }

  private stainBlob(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    cx: number,
    cy: number,
    w: number,
    h: number,
    tint: number,
    alpha: number,
    rng: () => number,
  ): void {
    const step = PLATE_PIXEL;
    const left = cx - w / 2;
    const top = cy - h / 2;
    const wobble = 0.10 + rng() * 0.22;
    for (let y = top; y <= top + h; y += step) {
      const ny = (y - cy) / (h / 2);
      const rowNoise = Math.sin(y * 0.17 + cx * 0.03) * wobble + (rng() - 0.5) * wobble;
      for (let x = left; x <= left + w; x += step) {
        const nx = (x - cx) / (w / 2);
        const edge = nx * nx + ny * ny * (1.35 + rowNoise);
        if (edge < 1.0 + rowNoise && rng() > 0.08 + Math.max(0, edge - 0.62) * 0.42) {
          const cellW = step * (1 + Math.floor(rng() * 3));
          this.add(out, texture, x, y, cellW, step, tint, alpha * (0.78 + rng() * 0.28));
        }
      }
    }

    const specks = 4 + Math.floor(rng() * 8);
    for (let i = 0; i < specks; i++) {
      const angle = rng() * Math.PI * 2;
      const dist = 0.42 + rng() * 0.66;
      const x = cx + Math.cos(angle) * w * 0.5 * dist;
      const y = cy + Math.sin(angle) * h * 0.5 * dist;
      const size = rng() > 0.65 ? step * 2 : step;
      this.add(out, texture, x, y, size, size, tint, alpha * (0.52 + rng() * 0.28));
    }
  }

  private stackedStains(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, colors: number[], rng: () => number): void {
    const bands = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < bands; i++) {
      const bandH = height / (bands + 0.45);
      const cy = bandH * (i + 0.52) + (rng() - 0.5) * 10;
      const w = width * (0.62 + rng() * 0.34);
      const cx = width * (0.44 + rng() * 0.12);
      this.stainBlob(out, texture, cx, cy, w, bandH * (0.95 + rng() * 0.45), colors[i % colors.length], 0.22 + rng() * 0.2, rng);
    }
  }

  private offsetStains(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, colors: number[], rng: () => number): void {
    const stains = 4 + Math.floor(rng() * 4);
    for (let i = 0; i < stains; i++) {
      const cy = height * (0.16 + i / Math.max(1, stains - 1) * 0.68) + (rng() - 0.5) * 12;
      const cx = width * (0.25 + rng() * 0.5);
      const w = width * (0.32 + rng() * 0.48);
      const h = 18 + rng() * Math.max(16, height * 0.24);
      this.stainBlob(out, texture, cx, cy, w, h, colors[(i + 1) % colors.length], 0.20 + rng() * 0.22, rng);
    }
  }

  private splitStains(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, colors: number[], rng: () => number): void {
    for (let side = 0; side < 2; side++) {
      const cx = width * (side === 0 ? 0.28 : 0.72) + (rng() - 0.5) * 30;
      const cy = height * (0.38 + rng() * 0.24);
      this.stainBlob(out, texture, cx, cy, width * (0.34 + rng() * 0.22), height * (0.68 + rng() * 0.25), colors[(side * 2 + 1) % colors.length], 0.22 + rng() * 0.18, rng);
    }
    this.stainBlob(out, texture, width * 0.5, height * (0.48 + (rng() - 0.5) * 0.22), width * 0.48, height * 0.36, colors[3 % colors.length], 0.12 + rng() * 0.16, rng);
  }

  private brushStreaks(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, colors: number[], rng: () => number): void {
    const lanes = 4 + Math.floor(rng() * 4);
    for (let i = 0; i < lanes; i++) {
      const y = height * (0.14 + rng() * 0.72);
      const x = -20 + rng() * width * 0.3;
      const w = width * (0.48 + rng() * 0.58);
      const h = 10 + rng() * 18;
      this.stainBlob(out, texture, x + w * 0.5, y, w, h, colors[i % colors.length], 0.22 + rng() * 0.2, rng);
    }
  }

  private dotField(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    colors: number[],
    rng: () => number,
  ): void {
    const count = Math.floor(width / 18);
    for (let i = 0; i < count; i++) {
      const size = rng() > 0.7 ? PX * 2 : PX;
      this.add(
        out,
        texture,
        rng() * width,
        10 + rng() * (height - 20),
        size,
        size,
        colors[Math.floor(rng() * colors.length)],
        0.18 + rng() * 0.32,
      );
    }
  }

  private diagonalBars(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    rng: () => number,
  ): void {
    for (let x = -width * 0.15; x < width; x += 26 + rng() * 12) {
      for (let step = 0; step < 7; step++) {
        this.add(out, texture, x + step * 7, height - 12 - step * 5, 24, PX, palette.accent, 0.24);
      }
    }
  }

  private rings(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    rng: () => number,
  ): void {
    const cx = width * (0.2 + rng() * 0.6);
    const cy = height * (0.35 + rng() * 0.35);
    for (let r = 12; r < height * 1.5; r += 13) {
      for (let a = 0; a < Math.PI * 2; a += 0.35) {
        if (rng() < 0.42) {
          this.add(out, texture, cx + Math.cos(a) * r, cy + Math.sin(a) * r, PX, PX, palette.pop, 0.24);
        }
      }
    }
  }

  private pixelWaves(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    rng: () => number,
  ): void {
    for (let lane = 0; lane < 4; lane++) {
      const y = 12 + lane * ((height - 24) / 4);
      const tint = lane % 2 === 0 ? palette.glow : palette.accent;
      for (let x = 0; x < width; x += PX * 2) {
        const wave = Math.sin(x * 0.035 + lane + rng() * 0.1);
        if (wave > 0.15) this.add(out, texture, x, y + wave * 11, PX, PX, tint, 0.22);
      }
    }
  }

  private blocks(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    rng: () => number,
  ): void {
    const blockW = 30 + rng() * 48;
    for (let x = 0; x < width; x += blockW) {
      const tint = rng() > 0.5 ? palette.accent : palette.pop;
      this.add(out, texture, x, height - 18 - rng() * 12, blockW * (0.55 + rng() * 0.4), 14, tint, 0.18);
    }
  }

  private signalRunes(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    rng: () => number,
  ): void {
    for (let x = 12; x < width - 12; x += 24 + rng() * 20) {
      const y = 12 + rng() * (height - 24);
      this.add(out, texture, x, y, PX * 3, PX, palette.glow, 0.32);
      this.add(out, texture, x + PX, y - PX, PX, PX * 3, palette.glow, 0.24);
      if (rng() > 0.45) this.add(out, texture, x + PX * 4, y + PX, PX, PX, palette.pop, 0.32);
    }
  }

  private edgeSpray(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    rng: () => number,
  ): void {
    for (let i = 0; i < 42; i++) {
      const side = rng() > 0.5;
      const x = side ? rng() * width * 0.26 : width - rng() * width * 0.26;
      this.add(out, texture, x, rng() * height, PX, PX, rng() > 0.5 ? palette.accent : palette.glow, 0.35);
    }
  }

  private bubbles(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let i = 0; i < 18; i++) {
      const cx = rng() * width;
      const cy = rng() * height;
      const r = 6 + rng() * 18;
      for (let a = 0; a < Math.PI * 2; a += 0.55) {
        this.add(out, texture, cx + Math.cos(a) * r, cy + Math.sin(a) * r, PX, PX, rng() > 0.5 ? palette.glow : palette.accent, 0.22);
      }
    }
  }

  private chevrons(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let x = -20; x < width; x += 44) {
      const y = 8 + rng() * (height - 20);
      const tint = rng() > 0.5 ? palette.accent : palette.pop;
      for (let i = 0; i < 6; i++) {
        this.add(out, texture, x + i * PX * 2, y + i * PX, PX * 3, PX, tint, 0.38);
        this.add(out, texture, x + i * PX * 2, y + (10 - i) * PX, PX * 3, PX, tint, 0.38);
      }
    }
  }

  private circuit(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let y = 12; y < height; y += 16 + rng() * 10) {
      let x = rng() * 24;
      while (x < width - 20) {
        const len = 18 + rng() * 52;
        this.add(out, texture, x, y, len, PX, palette.accent, 0.32);
        if (rng() > 0.45) this.add(out, texture, x + len, y - 8, PX, 16, palette.glow, 0.28);
        if (rng() > 0.55) this.add(out, texture, x + len + 6, y - 2, PX * 2, PX * 2, palette.pop, 0.38);
        x += len + 18 + rng() * 22;
      }
    }
  }

  private flameSweep(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let x = 0; x < width; x += PX * 2) {
      const flame = Math.sin(x * 0.035 + rng() * 0.3) * 0.5 + 0.5;
      const h = 14 + flame * (height - 18);
      const tint = rng() > 0.5 ? palette.pop : palette.accent;
      for (let y = height - h; y < height; y += PX * 2) {
        if (rng() > 0.22) this.add(out, texture, x, y, PX * 2, PX * 2, tint, 0.21 + flame * 0.22);
      }
    }
  }

  private slashStack(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let x = -height; x < width; x += 18 + rng() * 18) {
      const tint = rng() > 0.5 ? palette.glow : palette.pop;
      for (let y = 0; y < height; y += PX) {
        this.add(out, texture, x + y * 0.9, y, 10 + rng() * 18, PX, tint, 0.20);
      }
    }
  }

  private scallops(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let cx = 0; cx < width + 30; cx += 28) {
      const cy = rng() > 0.5 ? 0 : height;
      for (let a = 0; a < Math.PI; a += 0.22) {
        const yDir = cy === 0 ? 1 : -1;
        this.add(out, texture, cx + Math.cos(a) * 18, cy + Math.sin(a) * 18 * yDir, PX * 2, PX, palette.glow, 0.25);
      }
    }
  }

  private mountainPixels(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let x = 0; x < width; x += PX * 2) {
      const ridge = height * (0.34 + 0.28 * Math.sin(x * 0.024 + rng()));
      for (let y = ridge; y < height; y += PX * 2) {
        if (rng() > 0.36) this.add(out, texture, x, y, PX * 2, PX * 2, rng() > 0.5 ? palette.dim : palette.accent, 0.24);
      }
    }
  }

  private confettiLane(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    const colors = [palette.panel, palette.accent, palette.pop, palette.glow, palette.ink];
    for (let i = 0; i < 75; i++) {
      this.add(out, texture, rng() * width, rng() * height, PX * (1 + Math.floor(rng() * 4)), PX, colors[Math.floor(rng() * colors.length)], 0.26 + rng() * 0.28);
    }
  }

  private zebraCuts(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let y = -height; y < height * 2; y += 12 + rng() * 10) {
      const tint = rng() > 0.5 ? 0xffffff : palette.dim;
      for (let x = 0; x < width; x += PX * 2) {
        this.add(out, texture, x, y + Math.sin(x * 0.04) * 10 + x * 0.14, PX * 2, PX * 2, tint, 0.18);
      }
    }
  }

  private sunbursts(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    const cx = rng() * width;
    const cy = rng() * height;
    for (let a = 0; a < Math.PI * 2; a += 0.18) {
      const len = 18 + rng() * Math.max(width, height) * 0.38;
      for (let r = 8; r < len; r += PX * 3) {
        this.add(out, texture, cx + Math.cos(a) * r, cy + Math.sin(a) * r, PX * 2, PX, rng() > 0.5 ? palette.glow : palette.accent, 0.18);
      }
    }
  }

  private cloudBands(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let x = -30; x < width; x += 22) {
      const cy = height * (0.28 + rng() * 0.44);
      const h = 16 + rng() * 28;
      this.add(out, texture, x, cy, 32 + rng() * 50, h, rng() > 0.5 ? palette.glow : palette.panel, 0.18);
      this.add(out, texture, x + 10, cy - h * 0.35, 22 + rng() * 35, h * 0.55, palette.accent, 0.16);
    }
  }

  private leafBits(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let i = 0; i < 34; i++) {
      const x = rng() * width;
      const y = rng() * height;
      const tint = rng() > 0.5 ? palette.accent : palette.glow;
      this.add(out, texture, x, y, PX * 4, PX, tint, 0.30);
      this.add(out, texture, x + PX, y - PX, PX * 2, PX * 3, tint, 0.22);
    }
  }

  private equalizer(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let x = 0; x < width; x += 10) {
      const h = 6 + rng() * (height - 12);
      this.add(out, texture, x, height - h, 5, h, rng() > 0.5 ? palette.pop : palette.glow, 0.32);
    }
  }

  private checkerFade(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    const cell = 12 + Math.floor(rng() * 3) * 4;
    for (let y = 0; y < height; y += cell) {
      for (let x = 0; x < width; x += cell) {
        if (((x / cell + y / cell) | 0) % 2 === 0) this.add(out, texture, x, y, cell, cell, rng() > 0.5 ? palette.accent : palette.dim, 0.16 + (x / width) * 0.20);
      }
    }
  }

  private ribbonCut(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let i = 0; i < 5; i++) {
      const y = rng() * height;
      const h = 8 + rng() * 14;
      this.add(out, texture, 0, y, width, h, i % 2 ? palette.pop : palette.accent, 0.17);
      this.add(out, texture, width * (0.2 + rng() * 0.5), y - PX, 18 + rng() * 30, h + PX * 2, palette.glow, 0.26);
    }
  }

  private constellation(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    let px = rng() * width;
    let py = rng() * height;
    for (let i = 0; i < 24; i++) {
      const x = rng() * width;
      const y = rng() * height;
      this.add(out, texture, x, y, PX * 2, PX * 2, palette.glow, 0.48);
      this.add(out, texture, Math.min(px, x), Math.min(py, y), Math.abs(x - px) + PX, PX, palette.accent, 0.12);
      px = x;
      py = y;
    }
  }

  private stairSteps(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let x = 0; x < width; x += 24) {
      const steps = 3 + Math.floor(rng() * 5);
      for (let s = 0; s < steps; s++) {
        this.add(out, texture, x + s * PX * 2, height - (s + 2) * PX * 2, 22, PX * 2, rng() > 0.5 ? palette.pop : palette.panel, 0.22);
      }
    }
  }

  private pixelSwirl(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    const cx = width * (0.35 + rng() * 0.3);
    const cy = height * (0.25 + rng() * 0.5);
    for (let t = 0; t < 42; t++) {
      const a = t * 0.42;
      const r = 2 + t * 1.8;
      this.add(out, texture, cx + Math.cos(a) * r, cy + Math.sin(a) * r, PX * 3, PX, t % 2 ? palette.accent : palette.glow, 0.34);
    }
  }

  private xMarks(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let i = 0; i < 18; i++) {
      const x = rng() * width;
      const y = rng() * height;
      const tint = rng() > 0.5 ? palette.pop : palette.accent;
      for (let s = 0; s < 5; s++) {
        this.add(out, texture, x + s * PX, y + s * PX, PX, PX, tint, 0.32);
        this.add(out, texture, x + (4 - s) * PX, y + s * PX, PX, PX, tint, 0.32);
      }
    }
  }

  private honeycomb(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let y = 0; y < height; y += 18) {
      for (let x = (Math.floor(y / 18) % 2) * 12; x < width; x += 26) {
        const tint = rng() > 0.5 ? palette.glow : palette.dim;
        this.add(out, texture, x, y, 12, PX, tint, 0.20);
        this.add(out, texture, x - PX, y + PX, PX, 10, tint, 0.20);
        this.add(out, texture, x + 12, y + PX, PX, 10, tint, 0.20);
      }
    }
  }

  private drips(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let x = 0; x < width; x += 12 + rng() * 24) {
      const h = 10 + rng() * (height * 0.7);
      this.add(out, texture, x, 0, 6 + rng() * 10, h, rng() > 0.5 ? palette.pop : palette.accent, 0.25);
      this.add(out, texture, x - PX, h, PX * 3, PX * 3, palette.glow, 0.24);
    }
  }

  private wideStripes(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    const colors = [palette.panel, palette.accent, palette.pop, palette.glow];
    for (let x = 0; x < width; x += 28 + rng() * 26) {
      this.add(out, texture, x, 0, 18 + rng() * 35, height, colors[Math.floor(rng() * colors.length)], 0.20);
    }
  }

  private barcode(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let x = 0; x < width; x += 5 + rng() * 9) {
      const w = 2 + rng() * 7;
      this.add(out, texture, x, 6 + rng() * 10, w, height - 12 - rng() * 20, rng() > 0.5 ? palette.ink : palette.glow, 0.25);
    }
  }

  private waveBlocks(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let x = 0; x < width; x += 10) {
      const y = height * 0.5 + Math.sin(x * 0.035) * height * 0.28;
      this.add(out, texture, x, y, 18, height - y, rng() > 0.5 ? palette.accent : palette.panel, 0.22);
    }
  }

  private petalScatter(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let i = 0; i < 36; i++) {
      const x = rng() * width;
      const y = rng() * height;
      const tint = rng() > 0.5 ? palette.pop : palette.glow;
      this.add(out, texture, x, y, PX * 3, PX, tint, 0.30);
      this.add(out, texture, x + PX, y + PX, PX, PX * 2, tint, 0.22);
    }
  }

  private glitch(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let i = 0; i < 26; i++) {
      this.add(out, texture, rng() * width, rng() * height, 18 + rng() * 88, PX * (1 + Math.floor(rng() * 3)), rng() > 0.5 ? palette.accent : palette.pop, 0.28);
    }
  }

  private foam(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let i = 0; i < 45; i++) {
      const s = PX * (1 + Math.floor(rng() * 3));
      this.add(out, texture, rng() * width, rng() * height, s, s, rng() > 0.5 ? palette.glow : 0xffffff, 0.20 + rng() * 0.28);
    }
  }

  private paintScabs(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    const colors = [palette.accent, palette.pop, palette.glow, palette.panel];
    for (let i = 0; i < 9; i++) {
      this.stainBlob(
        out,
        texture,
        width * (0.12 + rng() * 0.76),
        height * (0.14 + rng() * 0.72),
        38 + rng() * 98,
        14 + rng() * 32,
        colors[Math.floor(rng() * colors.length)],
        0.20 + rng() * 0.24,
        rng,
      );
    }
  }

  private stainIslands(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    const colors = [palette.panel, palette.accent, palette.dim, palette.pop, palette.glow];
    const islands = 5 + Math.floor(rng() * 5);
    for (let i = 0; i < islands; i++) {
      const w = width * (0.18 + rng() * 0.34);
      const h = height * (0.20 + rng() * 0.26);
      this.stainBlob(
        out,
        texture,
        rng() * width,
        height * (0.16 + rng() * 0.68),
        w,
        h,
        colors[i % colors.length],
        0.20 + rng() * 0.24,
        rng,
      );
    }
  }

  private inkPuddles(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    const colors = [palette.ink, palette.dim, palette.accent, palette.panel];
    for (let i = 0; i < 4; i++) {
      this.stainBlob(
        out,
        texture,
        width * (0.18 + rng() * 0.64),
        height * (0.24 + rng() * 0.52),
        width * (0.28 + rng() * 0.36),
        height * (0.18 + rng() * 0.22),
        colors[i % colors.length],
        0.16 + rng() * 0.22,
        rng,
      );
    }
    this.dotField(out, texture, width, height, [palette.ink, palette.glow, palette.pop], rng);
  }

  private offsetSwatches(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    const colors = [palette.accent, palette.panel, palette.pop, palette.glow, palette.dim];
    const rows = 3 + Math.floor(rng() * 3);
    for (let row = 0; row < rows; row++) {
      const y = height * ((row + 0.55) / rows) + (rng() - 0.5) * 10;
      const swatches = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < swatches; i++) {
        const w = width * (0.18 + rng() * 0.24);
        const x = width * ((i + 0.5) / swatches) + (rng() - 0.5) * 42;
        this.stainBlob(out, texture, x, y, w, 18 + rng() * 22, colors[(row + i) % colors.length], 0.18 + rng() * 0.20, rng);
      }
    }
  }

  private dryBrush(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    const colors = [palette.glow, palette.accent, palette.pop, palette.panel];
    for (let line = 0; line < 9; line++) {
      const y = height * (0.12 + rng() * 0.74);
      let x = -rng() * 30;
      while (x < width) {
        if (rng() > 0.28) {
          this.add(out, texture, x, y + (rng() - 0.5) * 10, 18 + rng() * 46, PLATE_PIXEL, colors[line % colors.length], 0.16 + rng() * 0.22);
        }
        x += 18 + rng() * 30;
      }
    }
  }

  private splatterRail(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    const colors = [palette.accent, palette.pop, palette.glow, palette.ink];
    const rails = 2 + Math.floor(rng() * 3);
    for (let rail = 0; rail < rails; rail++) {
      const y = height * ((rail + 0.65) / (rails + 0.3));
      this.stainBlob(out, texture, width * 0.5, y, width * (0.64 + rng() * 0.22), 12 + rng() * 18, colors[rail % colors.length], 0.22 + rng() * 0.18, rng);
      for (let i = 0; i < 18; i++) {
        const size = rng() > 0.62 ? PLATE_PIXEL * 2 : PLATE_PIXEL;
        this.add(out, texture, rng() * width, y + (rng() - 0.5) * 42, size, size, colors[Math.floor(rng() * colors.length)], 0.22 + rng() * 0.28);
      }
    }
  }

  private borderDots(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let x = 4; x < width; x += 14) {
      this.add(out, texture, x, 4, PX, PX, palette.glow, 0.42);
      this.add(out, texture, x, height - 8, PX, PX, palette.pop, 0.34);
    }
    for (let y = 8; y < height; y += 14) {
      this.add(out, texture, 4, y, PX, PX, palette.accent, 0.34);
      this.add(out, texture, width - 8, y, PX, PX, palette.glow, 0.34);
    }
    if (rng() > 0.5) this.edgeSpray(out, texture, width, height, palette, rng);
  }

  private tileSlants(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let y = 0; y < height; y += 18) {
      for (let x = -20; x < width; x += 34) {
        this.add(out, texture, x + y * 0.6, y, 24, 8, rng() > 0.5 ? palette.panel : palette.accent, 0.22);
      }
    }
  }

  private blockArrows(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let x = 0; x < width; x += 48) {
      const y = height * (0.25 + rng() * 0.4);
      const tint = rng() > 0.5 ? palette.pop : palette.glow;
      this.add(out, texture, x, y, 28, 14, tint, 0.28);
      this.add(out, texture, x + 28, y - 8, 12, 30, tint, 0.28);
      this.add(out, texture, x + 40, y, 10, 14, palette.accent, 0.32);
    }
  }
}
