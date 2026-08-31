import * as PIXI from 'pixi.js';

import { fillStyle, mixColor, seedRng } from '../../shared/overlay';

export const TAU = Math.PI * 2;

export interface FluidPalette {
  deep: number;
  skin: number;
  skin2: number;
  accent: number;
  warm: number;
  cool: number;
  ink: number;
  foam: number;
}

export interface BlobPoint {
  angle: number;
  rx: number;
  ry: number;
  phase: number;
  speed: number;
  amp: number;
}

export function smoothClosedBlob(
  g: PIXI.Graphics,
  points: { x: number; y: number }[],
  fill: number | { color: number; alpha: number },
  stroke?: { color: number; alpha: number; width: number },
): void {
  if (points.length < 3) return;
  g.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const previous = points[(i - 1 + points.length) % points.length];
    const afterNext = points[(i + 2) % points.length];
    const cp1x = current.x + (next.x - previous.x) / 6;
    const cp1y = current.y + (next.y - previous.y) / 6;
    const cp2x = next.x - (afterNext.x - current.x) / 6;
    const cp2y = next.y - (afterNext.y - current.y) / 6;
    g.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, next.x, next.y);
  }
  g.closePath().fill(fill);
  if (stroke) g.stroke(stroke);
}

export class WobblyBlob {
  readonly view = new PIXI.Graphics();
  private readonly points: BlobPoint[];
  private readonly seed: number;
  private elapsed = 0;

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly palette: FluidPalette,
    seed: number,
  ) {
    this.seed = seed;
    const rng = seedRng(seed ^ 0x5f17b10b);
    const count = 15 + Math.floor(rng() * 5);
    this.points = Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * TAU;
      return {
        angle,
        rx: 0.86 + rng() * 0.24,
        ry: 0.80 + rng() * 0.28,
        phase: rng() * TAU,
        speed: 0.010 + rng() * 0.018,
        amp: 6 + rng() * 11,
      };
    });
    this.draw(0);
  }

  update(delta: number): void {
    this.elapsed += delta;
    this.draw(this.elapsed);
  }

  private draw(time: number): void {
    const g = this.view;
    const w = this.width;
    const h = this.height;
    const cx = w * 0.52;
    const cy = h * 0.50;
    const rx = w * 0.48;
    const ry = h * 0.48;
    const liquid = this.points.map((point) => {
      const wobble = Math.sin(time * point.speed + point.phase) * point.amp
        + Math.sin(time * point.speed * 0.62 + point.phase * 1.7) * point.amp * 0.45;
      return {
        x: cx + Math.cos(point.angle) * (rx * point.rx + wobble),
        y: cy + Math.sin(point.angle) * (ry * point.ry + wobble * 0.72),
      };
    });
    const rng = seedRng(this.seed ^ 0xca7d);

    g.clear();
    smoothClosedBlob(g, liquid, fillStyle(0x030409, 0.36));

    const shadow = liquid.map((p) => ({ x: p.x + 8, y: p.y + 10 }));
    smoothClosedBlob(g, shadow, fillStyle(0x000000, 0.20));
    smoothClosedBlob(g, liquid, fillStyle(this.palette.deep, 0.88), {
      color: mixColor(this.palette.foam, this.palette.accent, 0.2),
      alpha: 0.40,
      width: 2,
    });

    for (let i = 0; i < 5; i++) {
      const lx = w * (0.16 + rng() * 0.70) + Math.sin(time * 0.013 + i) * 9;
      const ly = h * (0.18 + rng() * 0.56) + Math.cos(time * 0.011 + i * 1.8) * 6;
      g.ellipse(lx, ly, 42 + rng() * 82, 10 + rng() * 28)
        .fill(fillStyle(i % 2 ? this.palette.skin : this.palette.skin2, 0.17 + rng() * 0.18));
    }

    g.ellipse(w * 0.30 + Math.sin(time * 0.018) * 8, h * 0.18, w * 0.24, 18)
      .fill(fillStyle(this.palette.foam, 0.16));
    g.circle(w * 0.86, h * 0.22 + Math.sin(time * 0.02) * 4, 8)
      .fill(fillStyle(this.palette.warm, 0.50));
    g.circle(w * 0.91, h * 0.58 + Math.cos(time * 0.016) * 4, 5)
      .fill(fillStyle(this.palette.cool, 0.48));
  }
}
