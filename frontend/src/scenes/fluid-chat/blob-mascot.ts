import * as PIXI from 'pixi.js';

import { fillStyle, mixColor, seedRng } from '../../shared/overlay';
import { smoothClosedBlob, TAU } from './blob';
import type { BlobPoint, FluidPalette } from './blob';

export class BlobMascot {
  readonly view = new PIXI.Container();
  private readonly body = new PIXI.Graphics();
  private readonly face = new PIXI.Graphics();
  private readonly points: BlobPoint[];
  private readonly profile: {
    eye: number;
    mouth: number;
    horns: number;
    limbs: number;
    spots: number;
    body: number;
    shade: number;
    accent: number;
  };
  private elapsed = 0;

  constructor(
    private readonly palette: FluidPalette,
    userColor: number,
    seed: number,
  ) {
    const rng = seedRng(seed ^ 0xa11faced);
    this.profile = {
      eye: seed % 6,
      mouth: Math.floor(seed / 17) % 5,
      horns: Math.floor(seed / 43) % 5,
      limbs: Math.floor(seed / 89) % 4,
      spots: Math.floor(seed / 131) % 7,
      body: mixColor(userColor, [palette.skin, palette.skin2, palette.warm, palette.cool][seed % 4], 0.46),
      shade: mixColor(userColor, palette.deep, 0.45),
      accent: [palette.warm, palette.cool, palette.foam, palette.accent][Math.floor(seed / 7) % 4],
    };
    const count = 12 + Math.floor(rng() * 4);
    this.points = Array.from({ length: count }, (_, index) => ({
      angle: (index / count) * TAU,
      rx: 0.78 + rng() * 0.30,
      ry: 0.78 + rng() * 0.32,
      phase: rng() * TAU,
      speed: 0.018 + rng() * 0.028,
      amp: 2.8 + rng() * 4.6,
    }));

    this.view.addChild(this.body);
    this.view.addChild(this.face);
    this.draw();
  }

  update(delta: number): void {
    this.elapsed += delta;
    this.view.rotation = Math.sin(this.elapsed * 0.022) * 0.04;
    this.view.y += Math.sin(this.elapsed * 0.035) * 0.016 * delta;
    this.draw();
  }

  private draw(): void {
    const g = this.body;
    const f = this.face;
    const time = this.elapsed;
    const cx = 29;
    const cy = 29;
    const rx = 25;
    const ry = 23;
    const points = this.points.map((point) => {
      const wobble = Math.sin(time * point.speed + point.phase) * point.amp;
      return {
        x: cx + Math.cos(point.angle) * (rx * point.rx + wobble),
        y: cy + Math.sin(point.angle) * (ry * point.ry + wobble * 0.75),
      };
    });

    g.clear();
    f.clear();
    g.ellipse(31, 55, 23, 5).fill(fillStyle(0x000000, 0.20));

    this.drawAppendages(g, time);
    smoothClosedBlob(g, points, fillStyle(this.profile.body, 0.98), {
      color: mixColor(this.profile.shade, 0x04040a, 0.24),
      alpha: 0.86,
      width: 4,
    });
    g.ellipse(19 + Math.sin(time * 0.025) * 2, 17, 12, 5)
      .fill(fillStyle(mixColor(this.profile.body, 0xffffff, 0.42), 0.50));

    for (let i = 0; i < this.profile.spots; i++) {
      const angle = i * 1.73 + this.profile.eye;
      const x = 30 + Math.cos(angle) * (8 + (i % 3) * 4);
      const y = 30 + Math.sin(angle * 1.2) * 10;
      g.circle(x, y, 2.4 + (i % 2) * 1.6).fill(fillStyle(this.profile.accent, 0.40));
    }

    this.drawFace(f, time);
  }

  private drawAppendages(g: PIXI.Graphics, time: number): void {
    if (this.profile.horns === 1 || this.profile.horns === 3) {
      g.moveTo(15, 13).quadraticCurveTo(14, -2, 25, 10).quadraticCurveTo(21, 13, 15, 13).fill(fillStyle(this.profile.accent, 0.94));
      g.moveTo(40, 12).quadraticCurveTo(45, -1, 49, 15).quadraticCurveTo(45, 13, 40, 12).fill(fillStyle(this.profile.accent, 0.94));
    } else if (this.profile.horns === 2) {
      g.circle(19, 9, 5).fill(fillStyle(this.profile.accent, 0.92));
      g.circle(42, 9, 5).fill(fillStyle(this.profile.accent, 0.92));
    } else if (this.profile.horns === 4) {
      g.moveTo(25, 8).quadraticCurveTo(31, -4, 36, 9).fill(fillStyle(this.profile.accent, 0.92));
    }

    if (this.profile.limbs > 0) {
      const sway = Math.sin(time * 0.04) * 3;
      g.ellipse(7, 33 + sway, 8, 4).fill(fillStyle(this.profile.shade, 0.96));
      g.ellipse(52, 34 - sway, 8, 4).fill(fillStyle(this.profile.shade, 0.96));
      if (this.profile.limbs > 1) {
        g.ellipse(22, 52, 5, 7).fill(fillStyle(this.profile.shade, 0.96));
        g.ellipse(39, 52, 5, 7).fill(fillStyle(this.profile.shade, 0.96));
      }
    }
  }

  private drawFace(g: PIXI.Graphics, time: number): void {
    const blink = Math.sin(time * 0.035 + this.profile.eye) > 0.965;
    const eyeColor = this.profile.eye % 2 ? this.palette.foam : 0xffffff;
    const pupil = 0x080a11;
    const y = this.profile.eye === 4 ? 25 : 24;

    if (this.profile.eye === 2) {
      this.eye(g, 24, 22, blink, eyeColor, pupil, 5);
      this.eye(g, 35, 27, blink, eyeColor, pupil, 4);
    } else if (this.profile.eye === 3) {
      this.eye(g, 30, 22, blink, eyeColor, pupil, 7);
    } else if (this.profile.eye === 5) {
      this.eye(g, 21, 23, blink, eyeColor, pupil, 4);
      this.eye(g, 31, 21, blink, eyeColor, pupil, 4);
      this.eye(g, 41, 23, blink, eyeColor, pupil, 4);
    } else {
      this.eye(g, 22, y, blink, eyeColor, pupil, 5);
      this.eye(g, 38, y, blink, eyeColor, pupil, 5);
    }

    const mouthY = 36;
    if (this.profile.mouth === 0) {
      g.roundRect(24, mouthY, 15, 8, 4).fill(fillStyle(0x130910, 0.92));
      g.circle(29, mouthY + 6, 3).fill(fillStyle(0xff7695, 0.88));
    } else if (this.profile.mouth === 1) {
      g.moveTo(24, mouthY).quadraticCurveTo(31, mouthY + 8, 39, mouthY).stroke({ color: 0x130910, width: 3, alpha: 0.9 });
    } else if (this.profile.mouth === 2) {
      g.roundRect(24, mouthY, 15, 4, 2).fill(fillStyle(0x130910, 0.92));
      g.rect(28, mouthY, 3, 4).fill(fillStyle(0xfff4c8, 0.95));
      g.rect(34, mouthY, 3, 4).fill(fillStyle(0xfff4c8, 0.95));
    } else if (this.profile.mouth === 3) {
      g.circle(31, mouthY + 2, 5).fill(fillStyle(0x130910, 0.92));
    } else {
      g.moveTo(25, mouthY + 2).quadraticCurveTo(31, mouthY - 2, 37, mouthY + 2).stroke({ color: 0x130910, width: 3, alpha: 0.9 });
    }
  }

  private eye(
    g: PIXI.Graphics,
    x: number,
    y: number,
    blink: boolean,
    eyeColor: number,
    pupil: number,
    radius: number,
  ): void {
    if (blink) {
      g.roundRect(x - radius, y - 1, radius * 2, 3, 2).fill(fillStyle(pupil, 0.9));
      return;
    }
    g.circle(x, y, radius).fill(fillStyle(eyeColor, 0.98));
    g.circle(x + radius * 0.22, y + radius * 0.18, Math.max(2, radius * 0.42)).fill(pupil);
    g.circle(x - radius * 0.25, y - radius * 0.24, Math.max(1, radius * 0.18)).fill(fillStyle(0xffffff, 0.72));
  }
}
