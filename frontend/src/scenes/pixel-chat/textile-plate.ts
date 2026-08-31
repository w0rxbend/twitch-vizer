import * as PIXI from 'pixi.js';

import { fillStyle, mixColor, seedRng } from '../../shared/overlay';
import { PX, TILE } from './pixel-helpers';
import { ribbonSchemes } from './theme';
import type { Palette, PixelChatTheme } from './theme';

/**
 * Motif drawers in dispatch order: the index a seed lands on picks the ribbon
 * pattern, so reordering this list changes what every existing seed renders.
 */
const MOTIF_DRAWERS = [
  'drawVerticalScallops',
  'drawCrescentColumns',
  'drawBracketWaves',
  'drawChevronRibbon',
  'drawDotArcRibbon',
  'drawSwirlColumns',
  'drawFlowerRosettes',
  'drawDiamondChain',
  'drawLeafVines',
] as const;

/** The procedurally patterned backing plate a chat card sits on. */
export class TextilePlate {
  readonly view = new PIXI.Container();

  constructor(
    width: number,
    height: number,
    palette: Palette,
    userAccent: number,
    seed: number,
    theme: PixelChatTheme,
  ) {
    const shadow = new PIXI.Graphics();
    const base = new PIXI.Graphics();
    const edge = new PIXI.Graphics();
    const innerX = TILE;
    const innerY = TILE;
    const innerW = width - TILE * 2;
    const innerH = height - TILE * 2;
    const pattern = this.makePattern(innerW, innerH, palette, userAccent, seed, theme);

    shadow.roundRect(PX, PX * 2, width, height, TILE).fill(fillStyle(0x000000, 0.44));
    base.roundRect(0, 0, width, height, TILE).fill(0x120c18);
    base.roundRect(PX, PX, width - PX * 2, height - PX * 2, TILE - PX).fill(fillStyle(0x2a2030, 0.96));
    base.roundRect(innerX, innerY, innerW, innerH, PX).fill(fillStyle(palette.plateDeep, 0.60));

    edge.roundRect(0, 0, width, height, TILE).stroke({ color: 0x070609, width: PX * 2, alpha: 0.95 });
    edge.roundRect(PX * 2, PX * 2, width - PX * 4, height - PX * 4, PX).stroke({ color: mixColor(palette.edge, 0xffffff, 0.12), width: PX, alpha: 0.48 });
    edge.rect(TILE * 3, PX, width * 0.20, PX).fill(fillStyle(0xffffff, 0.22));
    edge.rect(width * 0.68, height - PX * 2, width * 0.18, PX).fill(fillStyle(0xffffff, 0.16));

    pattern.x = innerX;
    pattern.y = innerY;

    this.view.addChild(shadow, base, pattern, edge);
  }

  private makePattern(
    width: number,
    height: number,
    palette: Palette,
    userAccent: number,
    seed: number,
    theme: PixelChatTheme,
  ): PIXI.Container {
    const layer = new PIXI.Container();
    const ribbon = new PIXI.Graphics();
    const motifs = new PIXI.Graphics();
    const rng = seedRng(seed ^ 0x706174);
    const schemes = ribbonSchemes(theme, palette, userAccent);
    const colors = schemes[seed % schemes.length];

    this.drawRibbonBands(ribbon, width, height, colors, rng);
    this.drawRibbonMotifs(motifs, width, height, colors, Math.floor(rng() * 6), rng);

    layer.addChild(ribbon, motifs);
    return layer;
  }

  private drawRibbonBands(
    g: PIXI.Graphics,
    width: number,
    height: number,
    colors: number[],
    rng: () => number,
  ): void {
    const segments = 6 + Math.floor(rng() * 4);
    let x = 0;
    for (let i = 0; i < segments; i++) {
      const remaining = width - x;
      const segmentW = i === segments - 1
        ? remaining
        : Math.max(TILE * 4, Math.round((width / segments) * (0.72 + rng() * 0.56) / PX) * PX);
      const color = colors[i % colors.length];
      g.rect(x, 0, Math.min(segmentW, remaining), height).fill(color);
      if (i > 0) g.rect(x - PX, 0, PX, height).fill(fillStyle(mixColor(color, 0x000000, 0.25), 0.36));
      if (rng() > 0.42) {
        const accent = colors[(i + 2 + Math.floor(rng() * colors.length)) % colors.length];
        g.rect(x + Math.min(segmentW, remaining) * 0.58, 0, PX * (1 + Math.floor(rng() * 2)), height)
          .fill(fillStyle(mixColor(accent, 0xffffff, 0.18), 0.72));
      }
      x += segmentW;
      if (x >= width) break;
    }

    g.rect(0, 0, width, PX).fill(fillStyle(0xffffff, 0.24));
    g.rect(0, height - PX, width, PX).fill(fillStyle(0x000000, 0.32));
  }

  private drawRibbonMotifs(
    g: PIXI.Graphics,
    width: number,
    height: number,
    colors: number[],
    motif: number,
    rng: () => number,
  ): void {
    const used = new Set<number>();
    const layers = 2 + Math.floor(rng() * 3);
    for (let layer = 0; layer < layers; layer++) {
      let current = (motif + layer + Math.floor(rng() * 4)) % MOTIF_DRAWERS.length;
      while (used.has(current)) current = (current + 1) % MOTIF_DRAWERS.length;
      used.add(current);

      this[MOTIF_DRAWERS[current]](g, width, height, colors, rng);
    }
    this.drawColorSprinkles(g, width, height, colors, rng);
  }

  private motifColor(colors: number[], index: number, darken = 0.20): number {
    const base = colors[(index + 1) % colors.length];
    if (index % 3 === 0) return mixColor(base, 0xffffff, 0.22);
    return mixColor(base, 0x1c1620, darken);
  }

  private drawVerticalScallops(
    g: PIXI.Graphics,
    width: number,
    height: number,
    colors: number[],
    rng: () => number,
  ): void {
    const gap = width / (4 + Math.floor(rng() * 2));
    for (let x = gap * 0.9; x < width + gap; x += gap) {
      const color = this.motifColor(colors, Math.floor(x / gap), 0.12);
      for (let y = -height * 0.2; y < height * 1.1; y += height * 0.32) {
        g.moveTo(x, y);
        g.bezierCurveTo(x + gap * 0.18, y + height * 0.08, x + gap * 0.18, y + height * 0.24, x, y + height * 0.34);
        g.stroke({ color, width: PX, alpha: 0.74 });
        g.moveTo(x + PX * 3, y);
        g.bezierCurveTo(x + gap * 0.26, y + height * 0.10, x + gap * 0.26, y + height * 0.22, x + PX * 3, y + height * 0.34);
        g.stroke({ color: mixColor(color, 0xffffff, 0.28), width: PX, alpha: 0.42 });
      }
    }
  }

  private drawCrescentColumns(
    g: PIXI.Graphics,
    width: number,
    height: number,
    colors: number[],
    rng: () => number,
  ): void {
    const cols = 5 + Math.floor(rng() * 2);
    const step = width / cols;
    for (let col = 1; col < cols; col++) {
      const x = col * step;
      const color = this.motifColor(colors, col, 0.06);
      for (let repeat = 0; repeat < 2; repeat++) {
        const y = height * (0.24 + repeat * 0.38);
        g.moveTo(x - step * 0.22, y - height * 0.24);
        g.bezierCurveTo(x + step * 0.16, y - height * 0.18, x + step * 0.16, y + height * 0.18, x - step * 0.22, y + height * 0.24);
        g.stroke({ color, width: PX, alpha: 0.58 });
        g.moveTo(x - step * 0.10, y - height * 0.20);
        g.bezierCurveTo(x + step * 0.06, y - height * 0.10, x + step * 0.06, y + height * 0.10, x - step * 0.10, y + height * 0.20);
        g.stroke({ color: mixColor(color, 0xffffff, 0.24), width: PX, alpha: 0.42 });
      }
    }
  }

  private drawBracketWaves(
    g: PIXI.Graphics,
    width: number,
    height: number,
    colors: number[],
    rng: () => number,
  ): void {
    const step = width / (5 + Math.floor(rng() * 2));
    for (let x = step * 0.55; x < width + step; x += step) {
      const color = this.motifColor(colors, Math.floor(x / step), 0.18);
      g.moveTo(x, 0);
      g.bezierCurveTo(x - step * 0.30, height * 0.22, x - step * 0.30, height * 0.78, x, height);
      g.stroke({ color, width: PX, alpha: 0.66 });
      g.moveTo(x + PX * 4, 0);
      g.bezierCurveTo(x - step * 0.14, height * 0.24, x - step * 0.14, height * 0.76, x + PX * 4, height);
      g.stroke({ color: mixColor(color, 0xffffff, 0.26), width: PX, alpha: 0.44 });
    }
  }

  private drawChevronRibbon(
    g: PIXI.Graphics,
    width: number,
    height: number,
    colors: number[],
    rng: () => number,
  ): void {
    const step = width / (5 + Math.floor(rng() * 2));
    for (let x = width * 0.12; x < width + step; x += step) {
      const color = this.motifColor(colors, Math.floor(x / step), 0.10);
      g.moveTo(x + step * 0.30, 0);
      g.lineTo(x - step * 0.08, height * 0.5);
      g.lineTo(x + step * 0.30, height);
      g.stroke({ color, width: PX * 2, alpha: 0.48 });
      g.moveTo(x + step * 0.44, 0);
      g.lineTo(x + step * 0.06, height * 0.5);
      g.lineTo(x + step * 0.44, height);
      g.stroke({ color: mixColor(color, 0xffffff, 0.22), width: PX, alpha: 0.40 });
    }
  }

  private drawDotArcRibbon(
    g: PIXI.Graphics,
    width: number,
    height: number,
    colors: number[],
    rng: () => number,
  ): void {
    const step = width / (6 + Math.floor(rng() * 2));
    for (let x = step * 0.55; x < width; x += step) {
      const color = this.motifColor(colors, Math.floor(x / step), 0.06);
      for (let i = 0; i < 7; i++) {
        const t = i / 6;
        const px = x - Math.sin(t * Math.PI) * step * 0.30;
        const py = height * (0.16 + t * 0.68);
        g.circle(px, py, PX * 1.5).fill(fillStyle(color, 0.78));
      }
    }
  }

  private drawSwirlColumns(
    g: PIXI.Graphics,
    width: number,
    height: number,
    colors: number[],
    rng: () => number,
  ): void {
    const step = width / (5 + Math.floor(rng() * 2));
    for (let x = step * 0.8; x < width + step; x += step) {
      const color = this.motifColor(colors, Math.floor(x / step), 0.24);
      for (let y = height * 0.24; y < height; y += height * 0.42) {
        g.moveTo(x - step * 0.24, y - height * 0.18);
        g.bezierCurveTo(x + step * 0.18, y - height * 0.24, x + step * 0.20, y + height * 0.08, x - step * 0.02, y + height * 0.04);
        g.bezierCurveTo(x - step * 0.22, y, x - step * 0.18, y + height * 0.20, x + step * 0.18, y + height * 0.20);
        g.stroke({ color, width: PX, alpha: 0.58 });
      }
    }
  }

  private drawFlowerRosettes(
    g: PIXI.Graphics,
    width: number,
    height: number,
    colors: number[],
    rng: () => number,
  ): void {
    const step = width / (6 + Math.floor(rng() * 3));
    for (let x = step * 0.65; x < width; x += step) {
      const cy = height * (0.28 + rng() * 0.44);
      const petal = this.motifColor(colors, Math.floor(x / step), 0.05);
      const center = colors[(Math.floor(x / step) + 3) % colors.length];
      for (let i = 0; i < 6; i++) {
        const angle = i * Math.PI / 3;
        g.circle(x + Math.cos(angle) * PX * 2.4, cy + Math.sin(angle) * PX * 2.4, PX * 1.6)
          .fill(fillStyle(petal, 0.58));
      }
      g.circle(x, cy, PX * 1.35).fill(fillStyle(mixColor(center, 0xffffff, 0.18), 0.82));
    }
  }

  private drawDiamondChain(
    g: PIXI.Graphics,
    width: number,
    height: number,
    colors: number[],
    rng: () => number,
  ): void {
    const step = width / (7 + Math.floor(rng() * 3));
    for (let x = step * 0.5; x < width + step; x += step) {
      const y = height * (0.30 + rng() * 0.40);
      const r = PX * (3 + Math.floor(rng() * 2));
      const color = this.motifColor(colors, Math.floor(x / step), 0.10);
      g.moveTo(x, y - r);
      g.lineTo(x + r, y);
      g.lineTo(x, y + r);
      g.lineTo(x - r, y);
      g.closePath();
      g.stroke({ color, width: PX, alpha: 0.68 });
      g.circle(x, y, PX).fill(fillStyle(colors[(Math.floor(x / step) + 2) % colors.length], 0.68));
    }
  }

  private drawLeafVines(
    g: PIXI.Graphics,
    width: number,
    height: number,
    colors: number[],
    rng: () => number,
  ): void {
    const lanes = 2 + Math.floor(rng() * 2);
    for (let lane = 0; lane < lanes; lane++) {
      const y = height * ((lane + 0.7) / (lanes + 0.35));
      const color = this.motifColor(colors, lane + Math.floor(rng() * colors.length), 0.16);
      g.moveTo(width * 0.06, y);
      for (let x = width * 0.06; x < width * 0.96; x += width * 0.16) {
        g.bezierCurveTo(x + width * 0.05, y - height * 0.20, x + width * 0.10, y + height * 0.20, x + width * 0.16, y);
      }
      g.stroke({ color, width: PX, alpha: 0.38 });

      for (let x = width * 0.12; x < width * 0.94; x += width * 0.14) {
        const side = rng() > 0.5 ? -1 : 1;
        g.ellipse(x, y + side * PX * 2.2, PX * 2.8, PX * 1.3)
          .fill(fillStyle(mixColor(color, 0xffffff, 0.18), 0.48));
      }
    }
  }

  private drawColorSprinkles(
    g: PIXI.Graphics,
    width: number,
    height: number,
    colors: number[],
    rng: () => number,
  ): void {
    const count = 18 + Math.floor(rng() * 20);
    for (let i = 0; i < count; i++) {
      const color = colors[Math.floor(rng() * colors.length)];
      const x = rng() * width;
      const y = height * (0.12 + rng() * 0.76);
      if (rng() > 0.55) {
        g.circle(x, y, PX * (0.7 + rng() * 0.8)).fill(fillStyle(color, 0.56));
      } else {
        g.rect(x, y, PX * (1 + Math.floor(rng() * 3)), PX).fill(fillStyle(color, 0.48));
      }
    }
  }
}
