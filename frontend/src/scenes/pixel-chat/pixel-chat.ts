import * as PIXI from 'pixi.js';

import {
  clamp,
  colorFromString,
  formatEventLabel,
  formatEventText,
  hashSeed,
  hslToRgb,
  messageAvatarUrl,
  mixColor,
  OverlayEventSocket,
  rgba,
  renderParts as renderMessageParts,
  seedRng,
} from '../../shared/overlay';
import type { MessagePart, VisualEventMsg, VisualEventName } from '../../shared/overlay';

interface Palette {
  night: number;
  plate: number;
  plateDeep: number;
  ink: number;
  edge: number;
  line: number;
  flower: number;
  leaf: number;
  gold: number;
  blue: number;
  rose: number;
  violet: number;
}

interface Spark {
  particle: PIXI.Particle;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

const PX = 4;
const TILE = PX * 2;
const CARD_GAP = 12;
const CARD_LIFETIME = 34 * 60;
const MAX_CARDS = 7;
const FONT = '"Courier New", "Lucida Console", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", monospace';
const TEXT_WHITE = 0xffffff;
const TEXT_BLACK = 0x050507;

function snap(value: number, grid = PX): number {
  return Math.round(value / grid) * grid;
}

function messageText(msg: VisualEventMsg): string {
  return formatEventText(msg, 'joined the pattern');
}

function eventLabel(event: VisualEventName): string {
  return formatEventLabel(event, { chatLabel: 'PIXEL', separator: ' ' });
}

function textParts(msg: VisualEventMsg): MessagePart[] {
  return renderMessageParts(msg, messageText(msg));
}

function makePixelTexture(app: PIXI.Application): PIXI.Texture {
  const g = new PIXI.Graphics();
  g.rect(0, 0, 1, 1).fill(0xffffff);
  const texture = app.renderer.generateTexture({
    target: g,
    frame: new PIXI.Rectangle(0, 0, 1, 1),
    resolution: 1,
  });
  g.destroy();
  return texture;
}

function luminance(color: number): number {
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function makePalette(seed: number, userAccent: number): Palette {
  const rng = seedRng(seed ^ 0x87ab3d1);
  const hue = Math.floor(rng() * 360);
  const plateHue = hue + [0, 34, 96, 148, 203, 276][seed % 6];
  const plate = mixColor(hslToRgb(plateHue, 0.62, 0.34), userAccent, 0.30);
  const plateDeep = mixColor(plate, 0x080712, 0.52);
  const line = hslToRgb(hue + 172, 0.88, 0.58);
  const rose = hslToRgb(hue + 314, 0.90, 0.58);
  const gold = hslToRgb(hue + 52, 0.92, 0.62);
  const blue = hslToRgb(hue + 202, 0.90, 0.60);
  const violet = hslToRgb(hue + 266, 0.80, 0.66);
  const leaf = hslToRgb(hue + 116, 0.72, 0.48);
  const night = mixColor(hslToRgb(hue + 238, 0.60, 0.11), 0x05030a, 0.52);
  const edge = mixColor(line, 0xffffff, 0.12);
  const flower = mixColor(rose, userAccent, 0.24);
  const ink = luminance(plate) > 0.45 ? 0x100915 : 0xfff7cf;

  return { night, plate, plateDeep, ink, edge, line, flower, leaf, gold, blue, rose, violet };
}

function pixelFill(
  g: PIXI.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: number | { color: number; alpha: number },
): void {
  g.rect(snap(x), snap(y), Math.max(PX, snap(w)), Math.max(PX, snap(h))).fill(fill);
}

function plateShape(
  g: PIXI.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
  fill: number | { color: number; alpha: number },
): void {
  const rng = seedRng(seed);
  const rows = Math.ceil(h / TILE);
  const corner = TILE * (2 + Math.floor(rng() * 2));
  const toothChance = 0.46 + rng() * 0.18;

  for (let row = 0; row < rows; row++) {
    const rowY = y + row * TILE;
    const rowH = Math.min(TILE, y + h - rowY);
    const top = Math.max(0, corner - row * TILE);
    const bottom = Math.max(0, corner - (rows - 1 - row) * TILE);
    const baseInset = Math.max(top, bottom);
    const jitter = rng() > toothChance ? TILE : rng() > 0.62 ? -PX : 0;
    const left = snap(Math.max(0, baseInset + jitter), PX);
    const right = snap(Math.max(0, baseInset - jitter), PX);
    pixelFill(g, x + left, rowY, w - left - right, rowH, fill);
  }
}

class TextilePlate {
  readonly view = new PIXI.Container();
  readonly mask = new PIXI.Graphics();

  constructor(
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    userAccent: number,
    seed: number,
  ) {
    const shadow = new PIXI.Graphics();
    const base = new PIXI.Graphics();
    const edge = new PIXI.Graphics();
    const innerX = TILE;
    const innerY = TILE;
    const innerW = width - TILE * 2;
    const innerH = height - TILE * 2;
    const pattern = this.makePattern(texture, innerW, innerH, palette, userAccent, seed);

    shadow.roundRect(PX, PX * 2, width, height, TILE).fill(rgba(0x000000, 0.44));
    base.roundRect(0, 0, width, height, TILE).fill(0x120c18);
    base.roundRect(PX, PX, width - PX * 2, height - PX * 2, TILE - PX).fill(rgba(0x2a2030, 0.96));
    base.roundRect(innerX, innerY, innerW, innerH, PX).fill(rgba(palette.plateDeep, 0.60));

    edge.roundRect(0, 0, width, height, TILE).stroke({ color: 0x070609, width: PX * 2, alpha: 0.95 });
    edge.roundRect(PX * 2, PX * 2, width - PX * 4, height - PX * 4, PX).stroke({ color: mixColor(palette.edge, 0xffffff, 0.12), width: PX, alpha: 0.48 });
    edge.rect(TILE * 3, PX, width * 0.20, PX).fill(rgba(0xffffff, 0.22));
    edge.rect(width * 0.68, height - PX * 2, width * 0.18, PX).fill(rgba(0xffffff, 0.16));

    pattern.x = innerX;
    pattern.y = innerY;

    this.view.addChild(shadow, base, pattern, edge);
  }

  private makePattern(
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    userAccent: number,
    seed: number,
  ): PIXI.Container {
    void texture;
    const layer = new PIXI.Container();
    const ribbon = new PIXI.Graphics();
    const motifs = new PIXI.Graphics();
    const rng = seedRng(seed ^ 0x706174);
    const schemes = this.ribbonSchemes(palette, userAccent);
    const colors = schemes[seed % schemes.length];

    this.drawRibbonBands(ribbon, width, height, colors, rng);
    this.drawRibbonMotifs(motifs, width, height, colors, Math.floor(rng() * 6), rng);

    layer.addChild(ribbon, motifs);
    return layer;
  }

  private ribbonSchemes(palette: Palette, userAccent: number): number[][] {
    return [
      [0xcac2c2, 0x3f2d44, 0xffc0d8, 0xee73c8, 0x755d94],
      [0xb9cbb6, 0xf4c2b7, 0xe9958d, 0xd86fac, 0x8a4961],
      [0xe0e4eb, 0xb7c7d8, 0x72c7cf, 0x3b4459, 0x202226],
      [0x4d1418, 0x7f2418, 0xc45513, 0xf4bd42, 0xfff171],
      [0x8d6b7b, 0xcf65bd, 0xee79cb, 0xf3b5cf, 0xf7dfc4],
      [0xffdfe4, 0xffefe1, 0xd9f1df, 0x69bda7, 0x246b63, 0x82516a],
      [0xe2e4ff, 0xb88bd5, 0x8e7f8e, 0x4f515b, 0x30323a, 0x181b22],
      [0x00a7a7, 0x78f7e3, 0xfff5a3, 0xc8dc7a, 0x587451, 0x005f66],
      [0xec2f79, 0xff7ba7, 0xffc38b, 0xfff5b8, 0xf5f2ea, 0xbd2a59],
      [0x1f1646, 0x5c35b1, 0xb95dde, 0xff66c8, 0xf6a2d5, 0x85d8ff],
      [0x0b4f5f, 0x2ec4b6, 0xf6f7d7, 0xffb703, 0xfb8500, 0xd62828],
      [0x283618, 0x606c38, 0xdda15e, 0xfefae0, 0xbc6c25, 0x6f1d1b],
      [0x102542, 0x2b59c3, 0x7de2d1, 0xf7f6c5, 0xf26430, 0xa62639],
      [mixColor(palette.plate, 0xffffff, 0.28), mixColor(userAccent, 0xffffff, 0.18), palette.rose, palette.line, palette.violet],
    ];
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
      if (i > 0) g.rect(x - PX, 0, PX, height).fill(rgba(mixColor(color, 0x000000, 0.25), 0.36));
      if (rng() > 0.42) {
        const accent = colors[(i + 2 + Math.floor(rng() * colors.length)) % colors.length];
        g.rect(x + Math.min(segmentW, remaining) * 0.58, 0, PX * (1 + Math.floor(rng() * 2)), height)
          .fill(rgba(mixColor(accent, 0xffffff, 0.18), 0.72));
      }
      x += segmentW;
      if (x >= width) break;
    }

    g.rect(0, 0, width, PX).fill(rgba(0xffffff, 0.24));
    g.rect(0, height - PX, width, PX).fill(rgba(0x000000, 0.32));
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
      let current = (motif + layer + Math.floor(rng() * 4)) % 9;
      while (used.has(current)) current = (current + 1) % 9;
      used.add(current);

      if (current === 0) this.drawVerticalScallops(g, width, height, colors, rng);
      else if (current === 1) this.drawCrescentColumns(g, width, height, colors, rng);
      else if (current === 2) this.drawBracketWaves(g, width, height, colors, rng);
      else if (current === 3) this.drawChevronRibbon(g, width, height, colors, rng);
      else if (current === 4) this.drawDotArcRibbon(g, width, height, colors, rng);
      else if (current === 5) this.drawSwirlColumns(g, width, height, colors, rng);
      else if (current === 6) this.drawFlowerRosettes(g, width, height, colors, rng);
      else if (current === 7) this.drawDiamondChain(g, width, height, colors, rng);
      else this.drawLeafVines(g, width, height, colors, rng);
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
        g.circle(px, py, PX * 1.5).fill(rgba(color, 0.78));
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

  private drawHeartDots(
    g: PIXI.Graphics,
    width: number,
    height: number,
    colors: number[],
    rng: () => number,
  ): void {
    const color = mixColor(colors[Math.floor(rng() * colors.length)], 0x1b1420, 0.28);
    for (let x = width * 0.28; x < width * 0.96; x += width * 0.12) {
      for (let y = height * 0.24; y < height * 0.80; y += height * 0.28) {
        g.circle(x, y, PX).fill(rgba(color, 0.70));
        g.circle(x + PX * 1.3, y, PX).fill(rgba(color, 0.70));
        g.rect(x - PX * 0.3, y + PX, PX * 2.4, PX * 1.4).fill(rgba(color, 0.70));
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
          .fill(rgba(petal, 0.58));
      }
      g.circle(x, cy, PX * 1.35).fill(rgba(mixColor(center, 0xffffff, 0.18), 0.82));
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
      g.circle(x, y, PX).fill(rgba(colors[(Math.floor(x / step) + 2) % colors.length], 0.68));
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
        g.ellipse(x, y + side * PX * 2.2, PX * 2.8, PX * 1.3, side * 0.55, 0, Math.PI * 2)
          .fill(rgba(mixColor(color, 0xffffff, 0.18), 0.48));
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
        g.circle(x, y, PX * (0.7 + rng() * 0.8)).fill(rgba(color, 0.56));
      } else {
        g.rect(x, y, PX * (1 + Math.floor(rng() * 3)), PX).fill(rgba(color, 0.48));
      }
    }
  }

  private add(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    x: number,
    y: number,
    w: number,
    h: number,
    tint: number,
    alpha = 1,
  ): void {
    let drawX = x;
    let drawY = y;
    let drawW = w;
    let drawH = h;
    if (drawW < 0) {
      drawX += drawW;
      drawW = Math.abs(drawW);
    }
    if (drawH < 0) {
      drawY += drawH;
      drawH = Math.abs(drawH);
    }
    out.push(new PIXI.Particle({
      texture,
      x: snap(drawX),
      y: snap(drawY),
      scaleX: Math.max(PX, snap(drawW)),
      scaleY: Math.max(PX, snap(drawH)),
      tint,
      alpha,
    }));
  }

  private illustratedPanel(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    userAccent: number,
    colors: number[],
    rng: () => number,
  ): void {
    const baseOptions = [
      mixColor(palette.blue, palette.plate, 0.30),
      mixColor(palette.rose, palette.plate, 0.24),
      mixColor(palette.leaf, palette.plate, 0.24),
      mixColor(palette.gold, palette.plate, 0.32),
      mixColor(palette.violet, palette.plateDeep, 0.30),
      mixColor(userAccent, palette.plate, 0.34),
    ];
    const base = mixColor(baseOptions[Math.floor(rng() * baseOptions.length)], 0xffffff, 0.10);
    const dark = mixColor(base, palette.night, 0.34);
    const pale = mixColor(base, 0xfff4cf, 0.64);
    const pop = colors[Math.floor(rng() * colors.length)];
    const pop2 = colors[Math.floor(rng() * colors.length)];
    const layout = Math.floor(rng() * 8);

    this.add(out, texture, 0, 0, width, height, dark, 0.92);
    this.add(out, texture, PX, PX, width - PX * 2, height - PX * 2, base, 0.92);

    if (layout === 0) {
      this.sweepBlob(out, texture, -width * 0.10, height * 0.02, width * 0.42, height * 1.10, pale, 0.90, rng);
      this.sweepBlob(out, texture, width * 0.08, -height * 0.12, width * 0.26, height * 1.18, mixColor(pale, palette.line, 0.32), 0.66, rng);
      this.add(out, texture, width * 0.76, TILE, width * 0.18, height - TILE * 2, pop, 0.88);
      this.add(out, texture, width * 0.82, height * 0.25, width * 0.12, PX, palette.night, 0.50);
    } else if (layout === 1) {
      this.sweepBlob(out, texture, width * 0.04, height * 0.02, width * 0.26, height * 0.92, mixColor(palette.line, 0xffffff, 0.18), 0.82, rng);
      this.dripCurtain(out, texture, width * 0.24, 0, width * 0.34, height, palette.night, pop, rng);
      this.sweepBlob(out, texture, width * 0.62, -height * 0.12, width * 0.26, height * 1.24, pale, 0.86, rng);
    } else if (layout === 2) {
      this.add(out, texture, 0, 0, width * 0.36, height, mixColor(palette.night, palette.blue, 0.22), 0.84);
      this.add(out, texture, width * 0.30, 0, width * 0.16, height, mixColor(palette.ink, 0xffffff, 0.08), 0.46);
      this.sweepBlob(out, texture, width * 0.68, -height * 0.16, width * 0.40, height * 1.30, pale, 0.86, rng);
      this.add(out, texture, width * 0.08, height * 0.18, TILE * 4, TILE * 4, 0x08111c, 0.72);
    } else if (layout === 3) {
      this.diagonalBlock(out, texture, -TILE, height * 0.68, width * 0.34, height * 0.40, pop, 0.90);
      this.diagonalBlock(out, texture, width * 0.50, height * 0.10, width * 0.42, height * 0.72, pale, 0.82);
      this.diagonalBlock(out, texture, width * 0.72, -TILE, width * 0.26, height * 0.62, mixColor(0xffffff, pop2, 0.24), 0.88);
      this.triangleConfetti(out, texture, width, height, palette, colors, rng);
    } else if (layout === 4) {
      this.sweepBlob(out, texture, width * 0.04, -height * 0.20, width * 0.36, height * 1.42, pale, 0.84, rng);
      this.sweepBlob(out, texture, width * 0.46, -height * 0.20, width * 0.28, height * 1.36, mixColor(pop, 0xffffff, 0.24), 0.66, rng);
      this.add(out, texture, width * 0.72, 0, width * 0.26, height, mixColor(pop2, palette.night, 0.20), 0.82);
      this.palmLeaves(out, texture, width * 0.12, height * 0.22, width * 0.28, height * 0.66, 0xf9f3dc, rng);
    } else if (layout === 5) {
      this.add(out, texture, 0, 0, width * 0.22, height, pale, 0.86);
      this.sweepBlob(out, texture, width * 0.16, -height * 0.10, width * 0.42, height * 1.22, mixColor(palette.ink, palette.plate, 0.42), 0.78, rng);
      this.sweepBlob(out, texture, width * 0.50, -height * 0.10, width * 0.36, height * 1.22, mixColor(pop, palette.night, 0.28), 0.78, rng);
      this.thinLineGrid(out, texture, width * 0.04, height * 0.16, width * 0.22, height * 0.66, 0xffffff, 0.22);
    } else if (layout === 6) {
      this.diagonalBlock(out, texture, width * 0.08, height * 0.82, width * 0.40, height * 0.34, mixColor(palette.leaf, palette.night, 0.26), 0.82);
      this.add(out, texture, width * 0.22, 0, width * 0.12, height, mixColor(palette.gold, 0xffffff, 0.10), 0.82);
      this.add(out, texture, width * 0.36, 0, width * 0.12, height, mixColor(palette.rose, 0xffffff, 0.08), 0.82);
      this.add(out, texture, width * 0.50, 0, width * 0.12, height, mixColor(palette.line, 0xffffff, 0.10), 0.82);
      this.sweepBlob(out, texture, width * 0.66, -height * 0.08, width * 0.32, height * 1.12, pop, 0.68, rng);
    } else {
      this.add(out, texture, 0, 0, width * 0.52, height, mixColor(palette.night, palette.leaf, 0.22), 0.82);
      this.sweepBlob(out, texture, width * 0.52, -height * 0.10, width * 0.34, height * 1.26, pale, 0.88, rng);
      this.add(out, texture, width * 0.76, 0, width * 0.18, height, mixColor(pop, 0xffffff, 0.18), 0.82);
      this.largeRing(out, texture, width * 0.72, height * 0.46, height * 0.32, palette.leaf, 0.82);
    }
  }

  private sweepBlob(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    x: number,
    y: number,
    w: number,
    h: number,
    tint: number,
    alpha: number,
    rng: () => number,
  ): void {
    const rows = Math.max(2, Math.ceil(h / TILE));
    const phase = rng() * Math.PI * 2;
    for (let row = 0; row < rows; row++) {
      const t = rows <= 1 ? 0 : row / (rows - 1);
      const cy = y + row * TILE;
      const bulge = Math.sin(t * Math.PI) * w * (0.24 + rng() * 0.08);
      const wave = Math.sin(t * Math.PI * 2.2 + phase) * w * 0.08;
      const inset = Math.max(0, Math.abs(t - 0.5) * w * 0.24 - bulge * 0.16);
      this.add(out, texture, x + inset + wave, cy, Math.max(TILE, w - inset * 2 + bulge), TILE, tint, alpha);
    }
  }

  private diagonalBlock(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    x: number,
    y: number,
    w: number,
    h: number,
    tint: number,
    alpha: number,
  ): void {
    const rows = Math.max(2, Math.ceil(h / TILE));
    for (let row = 0; row < rows; row++) {
      const rowY = y + row * TILE;
      this.add(out, texture, x + row * TILE * 0.85, rowY, w, TILE, tint, alpha);
    }
  }

  private dripCurtain(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    x: number,
    y: number,
    w: number,
    h: number,
    dark: number,
    accent: number,
    rng: () => number,
  ): void {
    for (let px = x; px < x + w; px += TILE * (1 + Math.floor(rng() * 2))) {
      const dripH = h * (0.36 + rng() * 0.60);
      const color = rng() > 0.46 ? dark : accent;
      this.add(out, texture, px, y, PX * (1 + Math.floor(rng() * 2)), dripH, color, 0.42 + rng() * 0.20);
      if (rng() > 0.42) this.add(out, texture, px - PX, y + dripH, TILE, TILE, color, 0.36);
    }
  }

  private palmLeaves(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    x: number,
    y: number,
    w: number,
    h: number,
    tint: number,
    rng: () => number,
  ): void {
    const leaves = 5 + Math.floor(rng() * 3);
    for (let leaf = 0; leaf < leaves; leaf++) {
      const angle = -0.7 + leaf * (1.4 / Math.max(1, leaves - 1));
      const len = w * (0.48 + rng() * 0.38);
      for (let step = 0; step < 9; step++) {
        const t = step / 8;
        const px = x + w * 0.20 + Math.cos(angle) * len * t;
        const py = y + h * 0.16 + Math.sin(angle) * h * 0.40 * t + step * PX;
        this.add(out, texture, px, py, TILE * (1 + (1 - t) * 2), PX, tint, 0.28 + (1 - t) * 0.28);
      }
    }
  }

  private thinLineGrid(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    x: number,
    y: number,
    w: number,
    h: number,
    tint: number,
    alpha: number,
  ): void {
    for (let px = x; px < x + w; px += TILE * 3) {
      this.add(out, texture, px, y, PX, h, tint, alpha);
    }
    for (let py = y; py < y + h; py += TILE * 3) {
      this.add(out, texture, x, py, w, PX, tint, alpha * 0.82);
    }
  }

  private largeRing(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    cx: number,
    cy: number,
    radius: number,
    tint: number,
    alpha: number,
  ): void {
    for (let angle = 0; angle < Math.PI * 2; angle += 0.22) {
      this.add(out, texture, cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, TILE, TILE, tint, alpha);
      this.add(out, texture, cx + Math.cos(angle) * radius * 0.58, cy + Math.sin(angle) * radius * 0.58, TILE, TILE, tint, alpha * 0.42);
    }
  }

  private triangleConfetti(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    colors: number[],
    rng: () => number,
  ): void {
    for (let i = 0; i < 18; i++) {
      const x = width * (0.02 + rng() * 0.90);
      const y = height * (0.08 + rng() * 0.78);
      const tint = colors[Math.floor(rng() * colors.length)];
      const size = TILE * (1 + Math.floor(rng() * 2));
      this.add(out, texture, x, y, size, PX, tint, 0.68);
      this.add(out, texture, x + PX, y + PX, Math.max(PX, size - PX * 2), PX, rng() > 0.5 ? palette.ink : 0xffffff, 0.34);
      if (rng() > 0.52) this.add(out, texture, x + size, y + PX, PX, PX, tint, 0.48);
    }
  }

  private illustratedMarks(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    colors: number[],
    rng: () => number,
  ): void {
    const mode = Math.floor(rng() * 6);
    if (mode === 0) {
      this.largeRing(out, texture, width * (0.74 + rng() * 0.18), height * (0.30 + rng() * 0.40), height * (0.18 + rng() * 0.18), palette.ink, 0.42);
    } else if (mode === 1) {
      this.palmLeaves(out, texture, width * 0.04, height * 0.08, width * 0.34, height * 0.74, 0xffffff, rng);
    } else if (mode === 2) {
      this.thinLineGrid(out, texture, width * 0.05, height * 0.18, width * 0.24, height * 0.58, 0xffffff, 0.20);
    } else if (mode === 3) {
      this.triangleConfetti(out, texture, width, height, palette, colors, rng);
    } else if (mode === 4) {
      this.bannerWaves(out, texture, width, height, palette, colors, rng);
    } else {
      this.bannerClouds(out, texture, width, height, palette, colors, rng);
    }

    for (let i = 0; i < 18; i++) {
      const tint = rng() > 0.48 ? colors[Math.floor(rng() * colors.length)] : 0xfff4d5;
      this.add(out, texture, rng() * width, rng() * height, PX * (1 + Math.floor(rng() * 2)), PX * (1 + Math.floor(rng() * 2)), tint, 0.34 + rng() * 0.24);
    }
  }

  private bannerBackdrops(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    userAccent: number,
    colors: number[],
    rng: () => number,
  ): void {
    const strips = 2 + Math.floor(rng() * 3);
    const stripGap = Math.max(PX, Math.floor(height / Math.max(5, strips * 7)) * PX);
    const palettePool = [
      palette.plate,
      mixColor(palette.plate, palette.rose, 0.40),
      mixColor(palette.plate, palette.blue, 0.46),
      mixColor(palette.plate, palette.gold, 0.34),
      mixColor(palette.plate, palette.leaf, 0.38),
      mixColor(palette.plate, userAccent, 0.44),
      mixColor(palette.plateDeep, palette.violet, 0.34),
    ];

    for (let strip = 0; strip < strips; strip++) {
      const y = snap(stripGap + strip * ((height - stripGap * 2) / strips), TILE);
      const h = snap(Math.max(TILE * 3, (height - stripGap * (strips + 1)) / strips), TILE);
      const cap = TILE * (1 + Math.floor(rng() * 3));
      const x = cap + (rng() > 0.62 ? TILE : 0);
      const w = width - x - cap - (rng() > 0.58 ? TILE : 0);
      const base = palettePool[Math.floor(rng() * palettePool.length)];
      const shade = mixColor(base, palette.night, 0.28 + rng() * 0.20);
      const glow = mixColor(base, 0xffffff, 0.25 + rng() * 0.20);
      const endColor = colors[Math.floor(rng() * colors.length)];

      this.add(out, texture, x, y, w, h, shade, 0.58);
      this.add(out, texture, x + PX, y + PX, w - PX * 2, h - PX * 2, base, 0.72);
      this.add(out, texture, x + TILE, y + PX, w * (0.34 + rng() * 0.28), PX, glow, 0.56);
      this.add(out, texture, x + TILE, y + h - PX * 2, w - TILE * 2, PX, palette.night, 0.22);
      this.add(out, texture, x, y + PX, PX, h - PX * 2, palette.night, 0.24);
      this.add(out, texture, x + w - PX, y + PX, PX, h - PX * 2, palette.night, 0.24);

      for (let c = 0; c < cap; c += PX) {
        const inset = c < cap / 2 ? cap / 2 - c : c - cap / 2;
        if (rng() > 0.34) this.add(out, texture, x - c - PX, y + inset, PX, Math.max(PX, h - inset * 2), endColor, 0.30);
        if (rng() > 0.34) this.add(out, texture, x + w + c, y + inset, PX, Math.max(PX, h - inset * 2), glow, 0.24);
      }
    }
  }

  private bannerSurfaceMarks(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    colors: number[],
    rng: () => number,
  ): void {
    const mode = Math.floor(rng() * 7);
    if (mode === 0) {
      this.bannerDots(out, texture, width, height, palette, colors, rng);
      this.bannerScratches(out, texture, width, height, colors, rng);
      return;
    }
    if (mode === 1) {
      this.bannerSlashes(out, texture, width, height, colors, rng);
      this.bannerDots(out, texture, width, height, palette, colors, rng);
      return;
    }
    if (mode === 2) {
      this.bannerTicks(out, texture, width, height, palette, colors, rng);
      return;
    }
    if (mode === 3) {
      this.bannerBlockSegments(out, texture, width, height, colors, rng);
      this.bannerScratches(out, texture, width, height, colors, rng);
      return;
    }
    if (mode === 4) {
      this.bannerClouds(out, texture, width, height, palette, colors, rng);
      return;
    }
    if (mode === 5) {
      this.bannerWaves(out, texture, width, height, palette, colors, rng);
      return;
    }
    this.bannerDots(out, texture, width, height, palette, colors, rng);
    this.bannerTicks(out, texture, width, height, palette, colors, rng);
  }

  private bannerDots(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    colors: number[],
    rng: () => number,
  ): void {
    const clusters = 4 + Math.floor(rng() * 5);
    for (let cluster = 0; cluster < clusters; cluster++) {
      const cx = width * (0.08 + rng() * 0.84);
      const cy = height * (0.18 + rng() * 0.64);
      const tint = rng() > 0.48 ? mixColor(palette.ink, 0xffffff, 0.12) : colors[Math.floor(rng() * colors.length)];
      const dots = 5 + Math.floor(rng() * 8);
      for (let i = 0; i < dots; i++) {
        const x = cx + (rng() - 0.5) * TILE * 8;
        const y = cy + (rng() - 0.5) * TILE * 3;
        const size = rng() > 0.76 ? PX * 2 : PX;
        this.add(out, texture, x, y, size, size, tint, 0.35 + rng() * 0.26);
      }
    }
  }

  private bannerScratches(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    colors: number[],
    rng: () => number,
  ): void {
    for (let i = 0; i < 26; i++) {
      const x = rng() * width;
      const y = rng() * height;
      const len = TILE * (2 + Math.floor(rng() * 5));
      const tint = colors[Math.floor(rng() * colors.length)];
      this.add(out, texture, x, y, len, PX, tint, 0.18 + rng() * 0.24);
      if (rng() > 0.52) this.add(out, texture, x + PX * 2, y - PX, len * 0.45, PX, 0xffffff, 0.10 + rng() * 0.12);
    }
  }

  private bannerSlashes(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    colors: number[],
    rng: () => number,
  ): void {
    for (let x = -height; x < width; x += TILE * (3 + Math.floor(rng() * 3))) {
      const tint = colors[Math.floor(rng() * colors.length)];
      for (let y = 0; y < height; y += TILE) {
        if (rng() > 0.22) this.add(out, texture, x + y * 0.72, y, TILE * 2, PX, tint, 0.24);
      }
    }
  }

  private bannerTicks(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    colors: number[],
    rng: () => number,
  ): void {
    const laneY = snap(height * (0.24 + rng() * 0.52), TILE);
    for (let x = TILE * 2; x < width - TILE * 2; x += TILE * (1 + Math.floor(rng() * 2))) {
      if (rng() < 0.34) continue;
      const h = TILE * (1 + Math.floor(rng() * 3));
      const tint = rng() > 0.35 ? colors[Math.floor(rng() * colors.length)] : palette.ink;
      this.add(out, texture, x, laneY + (rng() > 0.5 ? 0 : TILE), PX, h, tint, 0.42);
    }
  }

  private bannerBlockSegments(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    colors: number[],
    rng: () => number,
  ): void {
    let x = TILE * 2;
    const y = snap(height * (0.22 + rng() * 0.48), TILE);
    while (x < width - TILE * 2) {
      const w = TILE * (2 + Math.floor(rng() * 6));
      const h = TILE * (1 + Math.floor(rng() * 3));
      this.add(out, texture, x, y + (rng() > 0.5 ? 0 : TILE), w, h, colors[Math.floor(rng() * colors.length)], 0.34);
      x += w + TILE * (1 + Math.floor(rng() * 4));
    }
  }

  private bannerClouds(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    colors: number[],
    rng: () => number,
  ): void {
    const clouds = 3 + Math.floor(rng() * 4);
    for (let cloud = 0; cloud < clouds; cloud++) {
      const x = width * (0.08 + rng() * 0.76);
      const y = height * (0.18 + rng() * 0.62);
      const tint = rng() > 0.5 ? mixColor(palette.ink, 0xffffff, 0.20) : colors[Math.floor(rng() * colors.length)];
      this.add(out, texture, x, y, TILE * (3 + Math.floor(rng() * 5)), TILE, tint, 0.24);
      this.add(out, texture, x + TILE, y - PX, TILE * (2 + Math.floor(rng() * 3)), PX, 0xffffff, 0.20);
      this.add(out, texture, x + TILE * 2, y + TILE, TILE * (2 + Math.floor(rng() * 3)), PX, tint, 0.20);
    }
  }

  private bannerWaves(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    colors: number[],
    rng: () => number,
  ): void {
    const lanes = 2 + Math.floor(rng() * 3);
    for (let lane = 0; lane < lanes; lane++) {
      const y = height * ((lane + 0.65) / (lanes + 0.35));
      const tint = lane % 2 ? palette.ink : colors[Math.floor(rng() * colors.length)];
      for (let x = TILE; x < width - TILE; x += TILE) {
        const wave = Math.sin(x * 0.045 + lane * 1.7);
        if (wave > -0.15) this.add(out, texture, x, y + wave * TILE, TILE, PX, tint, 0.26 + Math.max(0, wave) * 0.18);
      }
    }
  }

  private stackedBands(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    colors: number[],
    rng: () => number,
  ): void {
    let y = 0;
    while (y < height) {
      const bandH = TILE * (1 + Math.floor(rng() * 3));
      const color = colors[Math.floor(rng() * colors.length)];
      const mode = Math.floor(rng() * 4);
      for (let x = 0; x < width; x += TILE) {
        if (mode === 0 && (x / TILE) % 2 === 0) this.add(out, texture, x, y, TILE, bandH, color, 0.16);
        if (mode === 1) this.add(out, texture, x, y + ((x / TILE) % 2) * PX, TILE, PX, color, 0.30);
        if (mode === 2 && rng() > 0.20) this.add(out, texture, x, y, TILE, PX, color, 0.26);
        if (mode === 3 && x % (TILE * 3) === 0) this.add(out, texture, x, y, TILE * 2, bandH, color, 0.13);
      }
      y += bandH + TILE * (1 + Math.floor(rng() * 2));
    }
  }

  private mazeLines(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    rng: () => number,
  ): void {
    const lanes = 3 + Math.floor(rng() * 3);
    for (let lane = 0; lane < lanes; lane++) {
      let x = TILE * (1 + Math.floor(rng() * 3));
      const yBase = height * ((lane + 0.75) / (lanes + 0.5));
      while (x < width - TILE) {
        const step = TILE * (2 + Math.floor(rng() * 4));
        const y = snap(yBase + (rng() - 0.5) * TILE * 4);
        this.add(out, texture, x, y, step, PX, lane % 2 ? palette.line : palette.blue, 0.42);
        if (rng() > 0.35) {
          const dir = rng() > 0.5 ? 1 : -1;
          this.add(out, texture, x + step, y, PX, TILE * dir, palette.line, 0.38);
          this.add(out, texture, x + step, y + TILE * dir, TILE * (1 + Math.floor(rng() * 2)), PX, palette.rose, 0.30);
        }
        x += step + TILE * (1 + Math.floor(rng() * 3));
      }
    }
  }

  private diamonds(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    colors: number[],
    rng: () => number,
  ): void {
    const cols = Math.max(2, Math.floor(width / 92));
    const rows = Math.max(1, Math.floor(height / 44));
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (rng() < 0.22) continue;
        const cx = width * ((col + 0.5) / cols) + (rng() - 0.5) * TILE * 3;
        const cy = height * ((row + 0.5) / rows) + (rng() - 0.5) * TILE * 2;
        const radius = TILE * (2 + Math.floor(rng() * 3));
        const color = colors[(row + col + Math.floor(rng() * colors.length)) % colors.length];
        for (let d = 0; d <= radius; d += TILE) {
          const half = radius - d;
          this.add(out, texture, cx - half, cy - d, half * 2 + PX, PX, color, 0.42);
          this.add(out, texture, cx - half, cy + d, half * 2 + PX, PX, color, 0.34);
        }
        this.add(out, texture, cx - PX, cy - PX, PX * 2, PX * 2, colors[Math.floor(rng() * colors.length)], 0.52);
      }
    }
  }

  private chevrons(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    colors: number[],
    rng: () => number,
  ): void {
    const stripes = 2 + Math.floor(rng() * 3);
    for (let stripe = 0; stripe < stripes; stripe++) {
      const y = snap(height * (0.18 + rng() * 0.64));
      const color = colors[Math.floor(rng() * colors.length)];
      for (let x = -TILE; x < width + TILE; x += TILE * 5) {
        for (let i = 0; i < 4; i++) {
          this.add(out, texture, x + i * TILE, y + i * PX, TILE * 2, PX, color, 0.46);
          this.add(out, texture, x + i * TILE, y + (7 - i) * PX, TILE * 2, PX, color, 0.46);
        }
      }
    }
  }

  private cornerFlorals(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    rng: () => number,
  ): void {
    const corners = [
      { x: TILE * 2, y: TILE * 2, sx: 1, sy: 1 },
      { x: width - TILE * 2, y: TILE * 2, sx: -1, sy: 1 },
      { x: TILE * 2, y: height - TILE * 2, sx: 1, sy: -1 },
      { x: width - TILE * 2, y: height - TILE * 2, sx: -1, sy: -1 },
    ];

    for (const corner of corners) {
      const stemLen = TILE * (4 + Math.floor(rng() * 3));
      this.add(out, texture, corner.x, corner.y, PX, stemLen * corner.sy, palette.leaf, 0.54);
      this.add(out, texture, corner.x, corner.y, stemLen * corner.sx, PX, palette.leaf, 0.44);
      for (let i = 1; i < 5; i++) {
        const bx = corner.x + corner.sx * i * TILE;
        const by = corner.y + corner.sy * (i % 2 ? TILE : TILE * 2);
        this.add(out, texture, bx, by, TILE, PX, palette.leaf, 0.52);
        this.add(out, texture, bx + corner.sx * PX, by + corner.sy * PX, PX, TILE, palette.leaf, 0.38);
      }
      const fx = corner.x + corner.sx * stemLen;
      const fy = corner.y + corner.sy * (rng() > 0.5 ? TILE : stemLen);
      this.flower(out, texture, fx, fy, corner.sx, corner.sy, palette);
    }
  }

  private flower(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    x: number,
    y: number,
    sx: number,
    sy: number,
    palette: Palette,
  ): void {
    this.add(out, texture, x, y, PX * 2, PX * 2, palette.gold, 0.78);
    this.add(out, texture, x - sx * PX * 2, y, PX * 2, PX * 2, palette.flower, 0.76);
    this.add(out, texture, x + sx * PX * 2, y, PX * 2, PX * 2, palette.flower, 0.76);
    this.add(out, texture, x, y - sy * PX * 2, PX * 2, PX * 2, palette.rose, 0.72);
    this.add(out, texture, x, y + sy * PX * 2, PX * 2, PX * 2, palette.violet, 0.72);
  }

  private microStitches(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    colors: number[],
    rng: () => number,
    density = 1,
  ): void {
    const count = Math.floor((width * height) / 900 * density);
    for (let i = 0; i < count; i++) {
      const color = colors[Math.floor(rng() * colors.length)];
      const horizontal = rng() > 0.35;
      this.add(
        out,
        texture,
        rng() * width,
        rng() * height,
        horizontal ? TILE : PX,
        horizontal ? PX : TILE,
        color,
        0.20 + rng() * 0.22,
      );
    }
  }

  private drawBorder(
    g: PIXI.Graphics,
    width: number,
    height: number,
    palette: Palette,
    userAccent: number,
    seed: number,
  ): void {
    const rng = seedRng(seed ^ 0xb04d);
    const colors = [palette.line, palette.gold, palette.rose, palette.blue, userAccent];
    for (let x = TILE * 4; x < width - TILE * 4; x += TILE * 3) {
      const color = colors[Math.floor(rng() * colors.length)];
      pixelFill(g, x, TILE, TILE * 2, PX, color);
      pixelFill(g, x + PX, height - TILE - PX, TILE * 2, PX, color);
      if (rng() > 0.52) {
        pixelFill(g, x + TILE, TILE + PX, PX, PX, palette.ink);
        pixelFill(g, x + TILE, height - TILE - PX * 2, PX, PX, palette.ink);
      }
    }
    for (let y = TILE * 3; y < height - TILE * 3; y += TILE * 3) {
      const color = colors[Math.floor(rng() * colors.length)];
      pixelFill(g, TILE, y, PX, TILE * 2, color);
      pixelFill(g, width - TILE - PX, y + PX, PX, TILE * 2, color);
      if (rng() > 0.42) {
        pixelFill(g, TILE + PX, y + TILE, PX, PX, palette.gold);
        pixelFill(g, width - TILE - PX * 2, y + TILE, PX, PX, palette.gold);
      }
    }
  }

  private drawCornerDither(g: PIXI.Graphics, width: number, height: number, palette: Palette, seed: number): void {
    const rng = seedRng(seed ^ 0xd17a);
    const colors = [palette.edge, palette.rose, palette.gold, palette.blue, palette.ink];
    for (let corner = 0; corner < 4; corner++) {
      const sx = corner % 2 === 0 ? 1 : -1;
      const sy = corner < 2 ? 1 : -1;
      const ox = sx === 1 ? 0 : width;
      const oy = sy === 1 ? 0 : height;
      for (let y = 0; y < TILE * 6; y += PX) {
        for (let x = 0; x < TILE * 8; x += PX) {
          const dist = (x + y) / (TILE * 14);
          if (rng() > 0.45 + dist) {
            pixelFill(g, ox + sx * x - (sx < 0 ? PX : 0), oy + sy * y - (sy < 0 ? PX : 0), PX, PX, colors[Math.floor(rng() * colors.length)]);
          }
        }
      }
    }
  }
}

class PixelAvatar {
  readonly view = new PIXI.Container();

  constructor(texture: PIXI.Texture, seed: number, palette: Palette, userAccent: number, avatarUrl?: string | null) {
    const fallback = this.makeFallback(texture, seed, palette, userAccent);
    const mask = new PIXI.Graphics().rect(3, 3, 30, 30).fill(0xffffff);
    const backplate = new PIXI.Graphics()
      .rect(0, 0, 36, 36).fill(rgba(0x05030a, 0.76))
      .rect(3, 3, 30, 30).fill(rgba(palette.plateDeep, 0.90));
    const frame = new PIXI.Graphics()
      .rect(0, 0, 36, PX).fill(palette.edge)
      .rect(0, 32, 36, PX).fill(palette.rose)
      .rect(0, 0, PX, 36).fill(userAccent)
      .rect(32, 0, PX, 36).fill(palette.gold)
      .rect(3, 3, 30, 30).stroke({ color: palette.night, width: 2, alpha: 0.78 });

    fallback.x = 4;
    fallback.y = 4;
    fallback.mask = mask;
    this.view.addChild(backplate, mask, fallback, frame);
    if (avatarUrl) this.loadAvatar(avatarUrl, this.view, fallback, mask);
  }

  private makeFallback(texture: PIXI.Texture, seed: number, palette: Palette, userAccent: number): PIXI.ParticleContainer<PIXI.Particle> {
    const rng = seedRng(seed ^ 0xabba);
    const layer = new PIXI.ParticleContainer<PIXI.Particle>({
      texture,
      roundPixels: true,
      dynamicProperties: {
        position: false,
        vertex: false,
        rotation: false,
        uvs: false,
        color: false,
      },
    });
    const particles: PIXI.Particle[] = [];
    const colors = [palette.ink, userAccent, palette.line, palette.gold, palette.rose, palette.blue];
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const mirror = x > 3 ? 6 - x : x;
        if (rng() + mirror * 0.08 + y * 0.03 < 0.43) continue;
        particles.push(new PIXI.Particle({
          texture,
          x: x * PX,
          y: y * PX,
          scaleX: PX,
          scaleY: PX,
          tint: colors[Math.floor(rng() * colors.length)],
          alpha: 0.96,
        }));
      }
    }
    layer.addParticle(...particles);
    layer.update();
    return layer;
  }

  private loadAvatar(
    url: string,
    view: PIXI.Container,
    fallback: PIXI.Container,
    mask: PIXI.Graphics,
  ): void {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.referrerPolicy = 'no-referrer';

    image.onload = () => {
      if ((view as PIXI.Container & { destroyed?: boolean }).destroyed) return;
      fallback.alpha = 0;
      const sprite = new PIXI.Sprite(PIXI.Texture.from(image));
      sprite.roundPixels = true;
      const size = 30;
      const scale = size / Math.max(image.naturalWidth, image.naturalHeight, 1);
      sprite.scale.set(scale);
      sprite.x = 3 + Math.round((size - sprite.width) / 2);
      sprite.y = 3 + Math.round((size - sprite.height) / 2);
      sprite.mask = mask;
      view.addChildAt(sprite, Math.min(3, view.children.length));
    };
    image.onerror = () => {
      console.warn('[PixelChatOverlay] avatar image failed to load:', url);
      fallback.alpha = 1;
    };
    image.src = url;
  }
}

class PixelCompanion {
  readonly view = new PIXI.Container();

  constructor(texture: PIXI.Texture, palette: Palette, userAccent: number, seed: number) {
    const shadow = new PIXI.Graphics()
      .rect(14, 67, 38, PX).fill(rgba(0x000000, 0.34))
      .rect(20, 70, 26, PX).fill(rgba(0x000000, 0.22));
    const layer = new PIXI.ParticleContainer<PIXI.Particle>({
      texture,
      roundPixels: true,
      dynamicProperties: {
        position: false,
        vertex: false,
        rotation: false,
        uvs: false,
        color: false,
      },
    });
    const rng = seedRng(seed ^ 0xc0de);
    const particles: PIXI.Particle[] = [];
    const colors = this.makeColors(palette, userAccent, seed);
    const profile = {
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

    const add = (x: number, y: number, w: number, h: number, tint: number, alpha = 1) => {
      let drawX = x;
      let drawY = y;
      let drawW = w;
      let drawH = h;
      if (drawW < 0) {
        drawX += drawW;
        drawW = Math.abs(drawW);
      }
      if (drawH < 0) {
        drawY += drawH;
        drawH = Math.abs(drawH);
      }
      particles.push(new PIXI.Particle({
        texture,
        x: snap(drawX),
        y: snap(drawY),
        scaleX: Math.max(PX, snap(drawW)),
        scaleY: Math.max(PX, snap(drawH)),
        tint,
        alpha,
      }));
    };

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
    cell: (x: number, y: number, tint: number, alpha?: number) => void,
    profile: {
      type: number;
      body: number;
      dark: number;
      light: number;
      accent: number;
    },
    rng: () => number,
  ): void {
    const cx = profile.type === 1 ? 8 : profile.type === 3 ? 9 : 8;
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
    cell: (x: number, y: number, tint: number, alpha?: number) => void,
    block: (x: number, y: number, w: number, h: number, tint: number, alpha?: number) => void,
    profile: {
      type: number;
      shirt: number;
      skin: number;
      hair: number;
      dark: number;
      accent: number;
      light: number;
    },
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
    cell: (x: number, y: number, tint: number, alpha?: number) => void,
    block: (x: number, y: number, w: number, h: number, tint: number, alpha?: number) => void,
    profile: {
      body: number;
      shirt: number;
      dark: number;
      accent: number;
      light: number;
    },
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
    cell: (x: number, y: number, tint: number, alpha?: number) => void,
    block: (x: number, y: number, w: number, h: number, tint: number, alpha?: number) => void,
    profile: {
      type: number;
      body: number;
      dark: number;
      light: number;
      accent: number;
    },
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
    cell: (x: number, y: number, tint: number, alpha?: number) => void,
    block: (x: number, y: number, w: number, h: number, tint: number, alpha?: number) => void,
    profile: {
      type: number;
      eyes: number;
      mouth: number;
      dark: number;
      light: number;
      accent: number;
    },
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
    cell: (x: number, y: number, tint: number, alpha?: number) => void,
    block: (x: number, y: number, w: number, h: number, tint: number, alpha?: number) => void,
    profile: {
      hat: number;
      dark: number;
      light: number;
      accent: number;
      shirt: number;
    },
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
    cell: (x: number, y: number, tint: number, alpha?: number) => void,
    profile: {
      body: number;
      light: number;
      accent: number;
    },
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

class PixelChatCard {
  readonly view = new PIXI.Container();
  readonly height: number;
  readonly width: number;
  readonly layoutSeed: number;
  private readonly fx = new PIXI.Graphics();
  private readonly noise = new PIXI.Graphics();
  private readonly lifetime = CARD_LIFETIME;
  private readonly seed: number;
  private readonly fxColors: number[];
  private readonly companion: PIXI.Container;
  private readonly companionBaseY: number;
  private age = 0;
  private assignedX = 0;
  private targetX = 0;
  private targetY = 0;
  private positioned = false;

  constructor(
    app: PIXI.Application,
    texture: PIXI.Texture,
    msg: VisualEventMsg,
    width: number,
    palette: Palette,
    userSeed: number,
    userAccent: number,
    seed: number,
  ) {
    this.width = width;
    this.seed = seed;
    this.layoutSeed = seed;
    this.fxColors = [
      TEXT_WHITE,
      userAccent,
      palette.line,
      palette.rose,
      palette.gold,
      palette.blue,
      palette.violet,
      palette.leaf,
    ];
    this.view.label = `pixel-chat:${msg.username}`;
    this.view.alpha = 0;

    const avatarSize = 36;
    const textX = 112;
    const avatarX = width - avatarSize - 22;
    const wrap = Math.max(210, avatarX - textX - 20);
    const content = this.makeContent(msg, palette, wrap);
    const name = new PIXI.Text({
      text: msg.username || 'anonymous',
      style: {
        fontFamily: FONT,
        fontSize: 18,
        fontWeight: '900',
        fill: TEXT_BLACK,
        letterSpacing: 0,
        stroke: { color: TEXT_WHITE, width: 3 },
      },
    });
    const tag = new PIXI.Text({
      text: eventLabel(msg.event),
      style: {
        fontFamily: FONT,
        fontSize: 11,
        fontWeight: '900',
        fill: TEXT_BLACK,
        letterSpacing: 0,
        stroke: { color: TEXT_WHITE, width: 2 },
      },
    });

    this.height = Math.max(92, Math.ceil(content.height + 62));
    const plate = new TextilePlate(texture, width, this.height, palette, userAccent, seed);
    const avatar = new PixelAvatar(texture, userSeed, palette, userAccent, messageAvatarUrl(msg));
    const companion = new PixelCompanion(texture, palette, userAccent, userSeed ^ seed);

    name.x = textX;
    name.y = 16;
    tag.x = Math.max(textX, avatarX - tag.width - 12);
    tag.y = 20;
    content.x = textX;
    content.y = 43;
    avatar.view.x = avatarX;
    avatar.view.y = Math.round((this.height - avatarSize) / 2);
    companion.view.x = 24;
    companion.view.y = Math.max(0, Math.round((this.height - 76) / 2));
    this.companion = companion.view;
    this.companionBaseY = companion.view.y;

    this.view.addChild(plate.view, this.fx, companion.view, name, tag, content, avatar.view, this.noise);
    app.stage.addChild(this.view);
  }

  setInitialX(x: number): void {
    this.assignedX = x;
    this.targetX = this.assignedX;
    if (!this.positioned) {
      this.view.x = this.assignedX;
    }
  }

  setTargetY(y: number): void {
    this.targetX = this.assignedX;
    this.targetY = y;
    if (!this.positioned) {
      this.view.x = this.assignedX;
      this.view.y = y + 16;
      this.positioned = true;
    }
  }

  update(delta: number): boolean {
    this.age += delta;
    const enter = clamp(this.age / 20, 0, 1);
    const leave = this.age > this.lifetime - 60 ? clamp((this.lifetime - this.age) / 60, 0, 1) : 1;
    const ease = 1 - Math.pow(1 - enter, 3);
    const shimmer = Math.sin((this.age + this.seed % 53) * 0.22) * 0.04;
    const glitch = Math.max(1 - enter, 1 - leave);
    const jitter = snap((Math.sin(this.age * 3.8 + this.seed) + Math.cos(this.age * 1.7)) * glitch * PX, PX);
    const hoverX = snap(Math.sin((this.age + this.seed % 101) * 0.032) * PX, PX);
    const hoverY = snap(Math.sin((this.age + this.seed % 89) * 0.045) * PX * 1.5, PX);

    this.view.x += (this.targetX + hoverX + jitter - this.view.x) * 0.22 * delta;
    this.view.y += (this.targetY + hoverY - this.view.y) * 0.24 * delta;
    this.view.alpha = ease * leave * (0.94 + shimmer);
    this.view.scale.x = 1 + glitch * 0.012 + Math.sin(this.age * 0.035 + this.seed) * 0.003;
    this.view.scale.y = 1 - glitch * 0.008 + Math.cos(this.age * 0.031 + this.seed) * 0.003;
    this.companion.y = this.companionBaseY + snap(Math.sin((this.age + this.seed % 37) * 0.12) * 2, PX);
    this.companion.x = 24 + snap(Math.sin((this.age + this.seed % 71) * 0.07) * 1.5, PX);
    this.drawEffects(enter, leave);
    this.drawNoise(glitch);

    return this.age >= this.lifetime;
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }

  private makeContent(msg: VisualEventMsg, palette: Palette, wrap: number): PIXI.Container {
    const content = new PIXI.Container();
    const style = {
      fontFamily: FONT,
      fontSize: 17,
      fontWeight: '900' as const,
      fill: TEXT_WHITE,
      lineHeight: 24,
      letterSpacing: 0,
      stroke: { color: TEXT_BLACK, width: 3 },
      dropShadow: {
        color: 0x000000,
        alpha: 0.42,
        distance: 2,
        blur: 0,
      },
    };
    const imageSize = 24;
    const gap = 4;
    const lineHeight = 24;
    let x = 0;
    let y = 0;
    let hasContent = false;

    const newline = () => {
      x = 0;
      y += lineHeight;
    };
    const place = (node: PIXI.Container | PIXI.Text, nodeWidth: number, nodeHeight = lineHeight) => {
      if (x > 0 && x + nodeWidth > wrap) newline();
      node.x = x;
      node.y = y + Math.max(0, Math.floor((lineHeight - nodeHeight) / 2));
      content.addChild(node);
      x += nodeWidth + gap;
      hasContent = true;
    };
    const addText = (text: string) => {
      for (const chunk of text.match(/\S+\s*|\s+/g) ?? []) {
        if (!chunk.trim()) {
          x = Math.min(wrap, x + 8);
          continue;
        }
        const label = new PIXI.Text({ text: chunk, style });
        if (label.width > wrap) label.scale.x = wrap / label.width;
        place(label, Math.min(label.width, wrap), label.height);
      }
    };
    const addImage = (part: MessagePart) => {
      if (!part.url) return;
      const holder = new PIXI.Container();
      holder.addChild(new PIXI.Graphics()
        .rect(0, 0, imageSize, imageSize).fill(rgba(palette.night, 0.70))
        .rect(PX, PX, imageSize - PX * 2, imageSize - PX * 2).stroke({ color: palette.gold, width: 2, alpha: 0.78 }));
      this.loadInlineImage(part, holder, imageSize);
      place(holder, imageSize, imageSize);
    };

    for (const part of textParts(msg)) {
      if (part.type === 'image') addImage(part);
      else addText(part.text ?? '');
    }

    if (!hasContent) addText(messageText(msg));
    return content;
  }

  private loadInlineImage(part: MessagePart, holder: PIXI.Container, size: number): void {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.referrerPolicy = 'no-referrer';
    image.onload = () => {
      if ((holder as PIXI.Container & { destroyed?: boolean }).destroyed) return;
      const sprite = new PIXI.Sprite(PIXI.Texture.from(image));
      sprite.roundPixels = true;
      const scale = (size - 4) / Math.max(image.naturalWidth, image.naturalHeight, 1);
      sprite.scale.set(scale);
      sprite.x = Math.round((size - sprite.width) / 2);
      sprite.y = Math.round((size - sprite.height) / 2);
      holder.addChild(sprite);
    };
    image.onerror = () => {
      if ((holder as PIXI.Container & { destroyed?: boolean }).destroyed) return;
      const fallback = new PIXI.Text({
        text: part.name?.trim() || '?',
        style: { fontFamily: FONT, fontSize: part.name && part.name.length <= 2 ? 18 : 10, fontWeight: '900', fill: 0xffffff, letterSpacing: 0 },
      });
      if (fallback.width > size - 4) fallback.scale.x = (size - 4) / fallback.width;
      fallback.x = Math.round((size - fallback.width) / 2);
      fallback.y = Math.round((size - fallback.height) / 2);
      holder.addChild(fallback);
    };
    image.src = part.url;
  }

  private drawNoise(amount: number): void {
    this.noise.clear();
    if (amount < 0.04) return;
    const rng = seedRng(this.seed ^ Math.floor(this.age * 19));
    for (let i = 0; i < 8 + amount * 12; i++) {
      const y = snap(rng() * this.height);
      const x = snap(rng() * this.width);
      const w = TILE * (1 + Math.floor(rng() * 6));
      this.noise.rect(x, y, w, PX).fill(rgba(rng() > 0.5 ? 0xffffff : 0x000000, 0.12 + amount * 0.18));
    }
  }

  private drawEffects(enter: number, leave: number): void {
    this.fx.clear();
    const rng = seedRng(this.seed ^ 0xeffec7);
    this.drawSparkles(rng, enter, leave);
    this.drawSparks(rng, enter, leave);
    this.drawSplashes(rng, enter);
    this.drawBleeding(rng, enter, leave);
    this.drawEvaporation(rng, leave);
  }

  private drawSparkles(rng: () => number, enter: number, leave: number): void {
    const count = 12;
    for (let i = 0; i < count; i++) {
      const edge = rng();
      const x = edge < 0.5 ? rng() * this.width : (rng() > 0.5 ? -PX * 2 : this.width + PX);
      const y = edge < 0.5 ? (rng() > 0.5 ? -PX : this.height + PX) : rng() * this.height;
      const pulse = Math.max(0, Math.sin(this.age * 0.12 + i * 1.7 + this.seed));
      const alpha = pulse * 0.82 * enter * leave;
      if (alpha < 0.08) continue;
      const color = this.fxColors[i % this.fxColors.length];
      this.fx.rect(snap(x), snap(y), PX, PX * 3).fill(rgba(color, alpha));
      this.fx.rect(snap(x - PX), snap(y + PX), PX * 3, PX).fill(rgba(color, alpha));
    }
  }

  private drawSparks(rng: () => number, enter: number, leave: number): void {
    for (let i = 0; i < 14; i++) {
      const phase = (this.age * (0.018 + rng() * 0.018) + rng() * 80) % 1;
      const side = rng() > 0.5 ? 1 : -1;
      const originX = side > 0 ? this.width - PX * 4 : PX * 4;
      const originY = this.height * (0.18 + rng() * 0.64);
      const x = originX + side * phase * (PX * (8 + rng() * 13));
      const y = originY - phase * (PX * (3 + rng() * 11)) + Math.sin(phase * Math.PI * 2) * PX;
      const alpha = (1 - phase) * enter * leave * 0.72;
      const color = this.fxColors[(i + 2) % this.fxColors.length];
      this.fx.rect(snap(x), snap(y), PX * (rng() > 0.72 ? 2 : 1), PX).fill(rgba(color, alpha));
    }
  }

  private drawSplashes(rng: () => number, enter: number): void {
    const splash = clamp(1 - this.age / 54, 0, 1) * enter;
    if (splash <= 0.02) return;
    for (let cluster = 0; cluster < 4; cluster++) {
      const cx = cluster % 2 === 0 ? PX * (6 + rng() * 12) : this.width - PX * (6 + rng() * 12);
      const cy = this.height * (0.22 + rng() * 0.58);
      const color = this.fxColors[(cluster + 3) % this.fxColors.length];
      for (let i = 0; i < 8; i++) {
        const angle = rng() * Math.PI * 2;
        const dist = (1 - splash) * PX * (6 + rng() * 14);
        this.fx.rect(
          snap(cx + Math.cos(angle) * dist),
          snap(cy + Math.sin(angle) * dist),
          PX * (rng() > 0.62 ? 2 : 1),
          PX * (rng() > 0.78 ? 2 : 1),
        ).fill(rgba(color, splash * (0.38 + rng() * 0.42)));
      }
    }
  }

  private drawBleeding(rng: () => number, enter: number, leave: number): void {
    const count = 9;
    for (let i = 0; i < count; i++) {
      const x = this.width * (0.08 + (i / Math.max(1, count - 1)) * 0.84) + (rng() - 0.5) * PX * 4;
      const pulse = 0.5 + 0.5 * Math.sin(this.age * (0.025 + rng() * 0.035) + i * 1.9);
      const length = snap(PX * (2 + pulse * 5 + rng() * 3), PX);
      const color = this.fxColors[(i + 1) % this.fxColors.length];
      const alpha = enter * leave * (0.20 + pulse * 0.32);
      this.fx.rect(snap(x), this.height - PX, PX * (rng() > 0.72 ? 2 : 1), length).fill(rgba(color, alpha));
      if (pulse > 0.72) this.fx.rect(snap(x), this.height + length + PX, PX, PX).fill(rgba(color, alpha * 0.8));
    }
  }

  private drawEvaporation(rng: () => number, leave: number): void {
    const evaporate = Math.max(0.18, 1 - leave);
    for (let i = 0; i < 12; i++) {
      const phase = (this.age * (0.006 + rng() * 0.010) + rng() * 30) % 1;
      const x = this.width * (0.08 + rng() * 0.84) + Math.sin(phase * Math.PI * 2 + i) * PX * 3;
      const y = -PX - phase * PX * (7 + rng() * 13);
      const alpha = (1 - phase) * evaporate * 0.42;
      const color = this.fxColors[(i + 5) % this.fxColors.length];
      this.fx.rect(snap(x), snap(y), PX * (rng() > 0.68 ? 2 : 1), PX).fill(rgba(color, alpha));
      if (rng() > 0.64) this.fx.rect(snap(x + PX * 2), snap(y - PX * 2), PX, PX).fill(rgba(TEXT_WHITE, alpha * 0.62));
    }
  }
}

class PixelChatOverlay {
  private app: PIXI.Application | null = null;
  private pixelTexture: PIXI.Texture | null = null;
  private cards: PixelChatCard[] = [];
  private userAccents = new Map<string, number>();
  private serial = 0;
  private sparks: Spark[] = [];
  private sparkLayer: PIXI.ParticleContainer<PIXI.Particle> | null = null;
  private readonly eventSocket = new OverlayEventSocket({
    label: 'PixelChatOverlay',
    onEvent: (msg) => this.spawn(msg),
  });

  async init(): Promise<void> {
    const app = new PIXI.Application();
    await app.init({
      resizeTo: window,
      backgroundAlpha: 0,
      antialias: false,
      resolution: 1,
      roundPixels: true,
    });

    document.body.appendChild(app.canvas);
    app.canvas.style.position = 'fixed';
    app.canvas.style.inset = '0';
    app.canvas.style.imageRendering = 'pixelated';

    this.app = app;
    this.pixelTexture = makePixelTexture(app);
    this.sparkLayer = new PIXI.ParticleContainer<PIXI.Particle>({
      texture: this.pixelTexture,
      roundPixels: true,
      dynamicProperties: {
        position: true,
        vertex: false,
        rotation: false,
        uvs: false,
        color: true,
      },
    });
    app.stage.addChild(this.sparkLayer);
    app.ticker.add(({ deltaTime }) => this.tick(deltaTime));
    window.addEventListener('resize', () => this.layoutCards());
    this.seedPreview();
  }

  connectWebSocket(): void {
    this.eventSocket.connect();
  }

  spawn(msg: VisualEventMsg): void {
    if (!this.app || !this.pixelTexture) return;
    const userKey = this.userKey(msg.username);
    const userSeed = msg.seed ?? hashSeed(userKey);
    const userAccent = this.userAccent(msg, userKey, userSeed);
    const seed = this.nextSeed(msg, userKey, userSeed);
    const palette = makePalette(seed, userAccent);
    const card = new PixelChatCard(
      this.app,
      this.pixelTexture,
      msg,
      this.cardWidth(),
      palette,
      userSeed,
      userAccent,
      seed,
    );
    card.setInitialX(this.randomCardLeft(card));

    this.cards.unshift(card);
    while (this.cards.length > MAX_CARDS) {
      this.cards.pop()?.destroy();
    }
    this.layoutCards();
    this.burst(card, palette, seed);
  }

  private tick(delta: number): void {
    for (let i = this.cards.length - 1; i >= 0; i--) {
      if (this.cards[i].update(delta)) {
        this.cards[i].destroy();
        this.cards.splice(i, 1);
        this.layoutCards();
      }
    }
    this.updateSparks(delta);
  }

  private layoutCards(): void {
    if (!this.app) return;
    let y = this.app.screen.height - 24;
    this.cards.forEach((card) => {
      y -= card.height;
      card.setTargetY(y);
      y -= CARD_GAP;
    });
  }

  private cardWidth(): number {
    const screenW = this.app?.screen.width ?? window.innerWidth;
    return snap(clamp(screenW * 0.38, 430, 690), PX);
  }

  private randomCardLeft(card: PixelChatCard): number {
    const screenW = this.app?.screen.width ?? window.innerWidth;
    const margin = screenW < 720 ? 10 : 24;
    const maxLeft = Math.max(margin, screenW - card.width - margin);
    const range = Math.max(0, maxLeft - margin);
    if (range <= 0) return margin;

    const rng = seedRng(card.layoutSeed ^ (card.width * 17) ^ Math.floor(card.height * 31));
    const lanes = Math.max(1, Math.floor(range / Math.max(140, card.width * 0.28)));
    const lane = lanes <= 1 ? 0 : Math.floor(rng() * lanes);
    const laneWidth = range / lanes;
    const laneJitter = Math.max(0, laneWidth - card.width * 0.12);
    return snap(margin + lane * laneWidth + rng() * laneJitter, PX);
  }

  private userKey(username: string): string {
    return username.trim().toLowerCase() || 'anonymous';
  }

  private userAccent(msg: VisualEventMsg, userKey: string, userSeed: number): number {
    const existing = this.userAccents.get(userKey);
    if (existing !== undefined) return existing;
    const fallback = hslToRgb(userSeed % 360, 0.82, 0.58);
    const color = colorFromString(msg.color, fallback);
    this.userAccents.set(userKey, color);
    return color;
  }

  private nextSeed(msg: VisualEventMsg, userKey: string, userSeed: number): number {
    this.serial += 1;
    return hashSeed([
      'pixel-chat',
      userKey,
      userSeed,
      msg.event,
      msg.text ?? '',
      this.serial,
      performance.now().toFixed(3),
      Math.floor(Math.random() * 0xffffffff),
    ].join(':'));
  }

  private burst(card: PixelChatCard, palette: Palette, seed: number): void {
    if (!this.sparkLayer || !this.pixelTexture) return;
    const rng = seedRng(seed ^ 0x5f1ce);
    const colors = [palette.line, palette.rose, palette.gold, palette.blue, palette.violet, palette.leaf];
    const x = card.view.x + 44 + rng() * 110;
    const y = card.view.y + 18 + rng() * Math.max(36, card.height - 24);

    for (let i = 0; i < 38; i++) {
      const speed = 1.3 + rng() * 3.4;
      const angle = -Math.PI * 0.88 + rng() * Math.PI * 0.95;
      const size = rng() > 0.76 ? TILE : PX;
      const particle = new PIXI.Particle({
        texture: this.pixelTexture,
        x,
        y,
        scaleX: size,
        scaleY: size,
        tint: colors[Math.floor(rng() * colors.length)],
        alpha: 0.92,
      });
      this.sparkLayer.addParticle(particle);
      this.sparks.push({
        particle,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 42 + rng() * 36,
      });
    }
  }

  private updateSparks(delta: number): void {
    if (!this.sparkLayer) return;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const spark = this.sparks[i];
      spark.life += delta;
      spark.particle.x += spark.vx * delta;
      spark.particle.y += spark.vy * delta;
      spark.vy += 0.052 * delta;
      spark.particle.alpha = clamp(1 - spark.life / spark.maxLife, 0, 1);
      if (spark.life >= spark.maxLife) {
        this.sparkLayer.removeParticle(spark.particle);
        this.sparks.splice(i, 1);
      }
    }
  }

  private seedPreview(): void {
    const params = new URLSearchParams(location.search);
    if (params.get('preview') === '0') return;
    this.spawn({ event: 'chat_message', username: 'worxbend', text: 'Welcome!', color: '#ff5fa8', seed: 1 });
  }
}

const overlay = new PixelChatOverlay();
overlay.init().then(() => {
  overlay.connectWebSocket();
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key !== ' ') return;
    const seed = Math.floor(Math.random() * 0xffffff);
    overlay.spawn({
      event: 'chat_message',
      username: `viewer${seed % 97}`,
      text: 'fresh procedural pixel plate',
      color: `#${seed.toString(16).padStart(6, '0')}`,
      seed,
    });
  });
});
