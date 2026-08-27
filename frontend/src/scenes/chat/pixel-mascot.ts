import * as PIXI from 'pixi.js';

import { fillStyle, hslToRgb, mixColor, seedRng } from '../../shared/overlay';
import { PX } from './palette';
import type { Palette } from './palette';
import { makeStaticParticleContainer } from './particles';

interface MascotProfile {
  shape: number;
  eyes: number;
  mouth: number;
  accessory: number;
  limbs: number;
  spots: number;
  bodyColor: number;
  shade: number;
  dark: number;
  highlight: number;
  spotColor: number;
}

export class PixelMascot {
  readonly view = new PIXI.Container();

  constructor(
    texture: PIXI.Texture,
    palette: Palette,
    userColor: number,
    seed: number,
  ) {
    const rng = seedRng(seed ^ 0x5ca1ab1e);
    const body = makeStaticParticleContainer(texture);
    const particles: PIXI.Particle[] = [];
    const profile = this._profile(seed, palette, userColor);

    this._monsterBody(particles, texture, rng, profile);
    this._monsterExtras(particles, texture, rng, profile, true);
    this._monsterFace(particles, texture, rng, profile);
    this._monsterExtras(particles, texture, rng, profile, false);

    body.addParticle(...particles);
    body.update();

    const shadow = new PIXI.Graphics()
      .rect(7, 43, 36, 8)
      .fill(fillStyle(0x000000, 0.28))
      .rect(12, 47, 22, 4)
      .fill(fillStyle(0x000000, 0.22));

    this.view.addChild(shadow);
    this.view.addChild(body);
    this.view.scale.set(0.96);
  }

  private _profile(seed: number, palette: Palette, userColor: number): MascotProfile {
    const hue = seed % 360;
    const colors = [
      userColor,
      palette.accent,
      palette.pop,
      palette.glow,
      palette.dim,
      hslToRgb(hue + 43, 0.84, 0.56),
      hslToRgb(hue + 137, 0.78, 0.50),
      hslToRgb(hue + 221, 0.82, 0.62),
    ];
    const bodyColor = colors[Math.floor(seed / 7) % colors.length];
    const shade = mixColor(bodyColor, palette.base, 0.38);
    return {
      shape: seed % 14,
      eyes: Math.floor(seed / 13) % 10,
      mouth: Math.floor(seed / 37) % 8,
      accessory: Math.floor(seed / 73) % 14,
      limbs: Math.floor(seed / 131) % 8,
      spots: Math.floor(seed / 251) % 7,
      bodyColor,
      shade,
      dark: mixColor(shade, 0x05020a, 0.42),
      highlight: mixColor(bodyColor, 0xffffff, 0.42),
      spotColor: colors[Math.floor(seed / 409) % colors.length],
    };
  }

  private _add(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    x: number,
    y: number,
    w: number,
    h: number,
    tint: number,
    alpha = 1,
  ): void {
    out.push(new PIXI.Particle({
      texture,
      x: Math.round(x),
      y: Math.round(y),
      scaleX: Math.max(PX, Math.round(w)),
      scaleY: Math.max(PX, Math.round(h)),
      tint,
      alpha,
    }));
  }

  private _monsterBody(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    rng: () => number,
    profile: MascotProfile,
  ): void {
    const cells: boolean[][] = [];
    const cx = 6;
    const cy = profile.shape === 6 ? 7.0 : profile.shape === 4 ? 6.0 : 6.5;
    const rx = [5.0, 3.8, 5.8, 4.6, 4.8, 4.2, 3.5, 5.2, 4.4, 5.6, 3.9, 4.7, 5.1, 4.1][profile.shape];
    const ry = [4.4, 5.4, 3.6, 4.7, 4.5, 5.0, 5.3, 3.9, 4.9, 3.4, 4.2, 5.6, 4.1, 4.7][profile.shape];

    for (let y = 0; y < 13; y++) {
      cells[y] = [];
      for (let x = 0; x < 13; x++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        const fuzz = Math.sin(x * 1.3 + y * 0.7) * 0.08 + (rng() - 0.5) * 0.12;
        let inside = nx * nx + ny * ny < 1 + fuzz;

        if (profile.shape === 3) {
          const lowerBoost = y > cy ? 1.24 : 0.72;
          inside = nx * nx + (ny / lowerBoost) * (ny / lowerBoost) < 1 + fuzz;
        } else if (profile.shape === 4) {
          const width = 1.0 - Math.abs(y - 7) / 7;
          inside = Math.abs(nx) < width * 0.92 && y > 1 && y < 12;
        } else if (profile.shape === 6) {
          const cap = ((x - cx) / 5.2) ** 2 + ((y - 4) / 2.8) ** 2 < 1.05;
          const stem = Math.abs(x - cx) < 2.6 && y >= 5 && y < 12;
          inside = cap || stem;
        } else if (profile.shape === 9) {
          inside = Math.abs(ny) < 0.95 && Math.abs(nx) < 0.9 + Math.sin(y * 0.8) * 0.08;
        } else if (profile.shape === 10) {
          inside = (nx * nx + ny * ny < 0.86 + fuzz) || (x === 6 && y < 3);
        }

        cells[y][x] = inside;
      }
    }

    for (let y = 0; y < 13; y++) {
      for (let x = 0; x < 13; x++) {
        if (!cells[y][x]) continue;
        const edge = !cells[y - 1]?.[x] || !cells[y + 1]?.[x] || !cells[y]?.[x - 1] || !cells[y]?.[x + 1];
        const baseTint = y > cy + 1.3 ? profile.shade : profile.bodyColor;
        const tint = edge ? profile.dark : baseTint;
        this._add(out, texture, x * PX, y * PX, PX, PX, tint, 0.98);
      }
    }

    if (profile.spots > 0) {
      const count = 2 + profile.spots;
      for (let i = 0; i < count; i++) {
        const x = 2 + Math.floor(rng() * 9);
        const y = 3 + Math.floor(rng() * 7);
        if (cells[y]?.[x]) {
          const tint = i % 2 === 0 ? profile.highlight : mixColor(profile.spotColor, profile.dark, 0.2);
          this._add(out, texture, x * PX, y * PX, PX, PX, tint, 0.62);
        }
      }
    }
  }

  private _monsterFace(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    rng: () => number,
    profile: MascotProfile,
  ): void {
    const eyeColor = profile.eyes % 3 === 0 ? 0xfaff77 : profile.eyes % 3 === 1 ? 0xafffff : 0xffffff;
    const pupil = 0x120715;
    const mouth = 0x13070c;
    const tooth = 0xfff0b5;

    if (profile.eyes === 0) {
      this._eye(out, texture, 3, 3, eyeColor, pupil);
      this._eye(out, texture, 7, 3, eyeColor, pupil);
    } else if (profile.eyes === 1) {
      this._eye(out, texture, 5, 3, eyeColor, pupil, 3);
      this._add(out, texture, 8 * PX, 2 * PX, PX, PX, profile.highlight, 0.78);
    } else if (profile.eyes === 2) {
      this._eye(out, texture, 2, 2, eyeColor, pupil);
      this._eye(out, texture, 8, 4, eyeColor, pupil);
    } else if (profile.eyes === 3) {
      this._add(out, texture, 3 * PX, 4 * PX, 3 * PX, PX, pupil, 0.92);
      this._add(out, texture, 7 * PX, 4 * PX, 3 * PX, PX, pupil, 0.92);
    } else if (profile.eyes === 4) {
      this._eye(out, texture, 2, 3, eyeColor, pupil);
      this._eye(out, texture, 5, 2, eyeColor, pupil);
      this._eye(out, texture, 8, 3, eyeColor, pupil);
    } else if (profile.eyes === 5) {
      this._eye(out, texture, 5, 2, eyeColor, pupil);
      this._add(out, texture, 3 * PX, 4 * PX, 2 * PX, PX, pupil, 0.9);
      this._add(out, texture, 8 * PX, 4 * PX, 2 * PX, PX, pupil, 0.9);
    } else if (profile.eyes === 6) {
      this._eye(out, texture, 4, 3, eyeColor, pupil);
      this._eye(out, texture, 8, 3, eyeColor, pupil);
      this._add(out, texture, 2 * PX, 2 * PX, 3 * PX, PX, profile.dark, 0.72);
      this._add(out, texture, 8 * PX, 2 * PX, 3 * PX, PX, profile.dark, 0.72);
    } else if (profile.eyes === 7) {
      this._eye(out, texture, 5, 2, eyeColor, pupil, 2);
      this._eye(out, texture, 5, 5, eyeColor, pupil, 2);
    } else {
      this._eye(out, texture, 3, 3, eyeColor, pupil);
      this._eye(out, texture, 8, 3, eyeColor, pupil);
      if (profile.eyes === 9) this._eye(out, texture, 6, 1, eyeColor, pupil);
    }

    const mouthY = profile.shape === 4 ? 8 : 7;
    if (profile.mouth === 0) {
      this._add(out, texture, 3 * PX, mouthY * PX, 6 * PX, 2 * PX, mouth, 0.96);
      this._add(out, texture, 4 * PX, mouthY * PX, PX, PX, tooth, 0.98);
      this._add(out, texture, 7 * PX, mouthY * PX, PX, PX, tooth, 0.98);
    } else if (profile.mouth === 1) {
      this._add(out, texture, 4 * PX, mouthY * PX, 4 * PX, 3 * PX, mouth, 0.96);
      this._add(out, texture, 5 * PX, (mouthY + 2) * PX, PX, PX, 0xff6b7d, 0.95);
    } else if (profile.mouth === 2) {
      this._add(out, texture, 4 * PX, mouthY * PX, 5 * PX, PX, mouth, 0.96);
    } else if (profile.mouth === 3) {
      this._add(out, texture, 3 * PX, mouthY * PX, 7 * PX, PX, mouth, 0.96);
      this._add(out, texture, 4 * PX, (mouthY + 1) * PX, PX, PX, tooth, 0.98);
      this._add(out, texture, 8 * PX, (mouthY + 1) * PX, PX, PX, tooth, 0.98);
    } else if (profile.mouth === 4) {
      this._add(out, texture, 5 * PX, mouthY * PX, 3 * PX, PX, mouth, 0.96);
      this._add(out, texture, 4 * PX, (mouthY + 1) * PX, PX, PX, mouth, 0.96);
      this._add(out, texture, 8 * PX, (mouthY + 1) * PX, PX, PX, mouth, 0.96);
    } else if (profile.mouth === 5) {
      this._add(out, texture, 4 * PX, mouthY * PX, 5 * PX, 3 * PX, mouth, 0.96);
      this._add(out, texture, 5 * PX, mouthY * PX, PX, PX, tooth, 0.98);
      this._add(out, texture, 7 * PX, mouthY * PX, PX, PX, tooth, 0.98);
    } else {
      this._add(out, texture, 4 * PX, mouthY * PX, 5 * PX, 2 * PX, mouth, 0.92);
      this._add(out, texture, 6 * PX, mouthY * PX, PX, PX, tooth, 0.98);
    }
    if (profile.mouth === 1 || profile.mouth === 5 || rng() > 0.82) {
      this._add(out, texture, 5 * PX, (mouthY + 2) * PX, 2 * PX, PX, 0xff6b7d, 0.95);
    }
  }

  private _eye(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    x: number,
    y: number,
    eyeColor: number,
    pupil: number,
    size = 2,
  ): void {
    this._add(out, texture, x * PX, y * PX, size * PX, size * PX, eyeColor, 0.98);
    this._add(out, texture, (x + size - 1) * PX, (y + size - 1) * PX, PX, PX, pupil, 1);
  }

  private _monsterExtras(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    rng: () => number,
    profile: MascotProfile,
    behindBody: boolean,
  ): void {
    if (behindBody) {
      if (profile.accessory === 4 || profile.accessory === 11) {
        this._add(out, texture, -2 * PX, 5 * PX, 4 * PX, 3 * PX, profile.shade, 0.84);
        this._add(out, texture, 11 * PX, 5 * PX, 4 * PX, 3 * PX, profile.shade, 0.84);
        this._add(out, texture, -PX, 4 * PX, 2 * PX, PX, profile.highlight, 0.5);
        this._add(out, texture, 12 * PX, 4 * PX, 2 * PX, PX, profile.highlight, 0.5);
      }
      if (profile.accessory === 5 || profile.accessory === 12) {
        this._add(out, texture, 11 * PX, 8 * PX, 4 * PX, PX, profile.dark, 0.9);
        this._add(out, texture, 14 * PX, 7 * PX, PX, 2 * PX, profile.shade, 0.9);
      }
      return;
    }

    if (profile.accessory === 0 || profile.accessory === 7) {
      this._add(out, texture, 2 * PX, 0, PX, 3 * PX, profile.dark, 0.95);
      this._add(out, texture, 9 * PX, 0, PX, 3 * PX, profile.dark, 0.95);
      this._add(out, texture, 2 * PX, 0, 2 * PX, PX, profile.highlight, 0.8);
      this._add(out, texture, 8 * PX, 0, 2 * PX, PX, profile.highlight, 0.8);
    } else if (profile.accessory === 1 || profile.accessory === 8) {
      for (let i = 0; i < 3; i++) {
        this._add(out, texture, (4 + i) * PX, (1 - i) * PX, PX, 4 * PX, profile.highlight, 0.86);
      }
    } else if (profile.accessory === 2) {
      for (let i = 0; i < 5; i++) {
        this._add(out, texture, (3 + i) * PX, (i % 2) * PX, PX, 2 * PX, profile.dark, 0.9);
      }
    } else if (profile.accessory === 3 || profile.accessory === 10) {
      this._add(out, texture, 0, 4 * PX, 2 * PX, 3 * PX, profile.shade, 0.9);
      this._add(out, texture, 11 * PX, 4 * PX, 2 * PX, 3 * PX, profile.shade, 0.9);
    } else if (profile.accessory === 6) {
      this._add(out, texture, 4 * PX, 0, 4 * PX, PX, profile.highlight, 0.8);
      this._add(out, texture, 5 * PX, -PX, 2 * PX, PX, profile.spotColor, 0.88);
    } else if (profile.accessory === 9) {
      this._add(out, texture, 4 * PX, -PX, 4 * PX, 2 * PX, 0xffb53d, 0.92);
      this._add(out, texture, 5 * PX, -2 * PX, 2 * PX, PX, 0xffef67, 0.92);
    } else if (profile.accessory === 13) {
      this._add(out, texture, 3 * PX, 0, 6 * PX, PX, profile.dark, 0.82);
      this._add(out, texture, 5 * PX, -PX, 2 * PX, PX, profile.dark, 0.82);
    }

    if (profile.limbs === 1 || profile.limbs === 4) {
      this._add(out, texture, 0, 7 * PX, 3 * PX, PX, profile.bodyColor, 0.95);
      this._add(out, texture, 10 * PX, 7 * PX, 3 * PX, PX, profile.bodyColor, 0.95);
      this._add(out, texture, 0, 8 * PX, PX, 2 * PX, profile.shade, 0.95);
      this._add(out, texture, 12 * PX, 8 * PX, PX, 2 * PX, profile.shade, 0.95);
    } else if (profile.limbs === 2 || profile.limbs === 6) {
      this._add(out, texture, PX, 8 * PX, 2 * PX, 2 * PX, profile.shade, 0.95);
      this._add(out, texture, 10 * PX, 8 * PX, 2 * PX, 2 * PX, profile.shade, 0.95);
    } else if (profile.limbs === 3) {
      this._add(out, texture, 0, 6 * PX, 2 * PX, PX, profile.dark, 0.9);
      this._add(out, texture, 11 * PX, 6 * PX, 2 * PX, PX, profile.dark, 0.9);
    }

    if (profile.limbs !== 0 || rng() > 0.58) {
      this._add(out, texture, 2 * PX, 11 * PX, 2 * PX, PX, profile.dark, 0.95);
      this._add(out, texture, 8 * PX, 11 * PX, 2 * PX, PX, profile.dark, 0.95);
    }
  }
}
