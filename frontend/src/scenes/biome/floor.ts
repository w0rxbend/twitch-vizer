import * as PIXI from 'pixi.js';
import type { SceneContext } from './types.js';

const PX = 2;
const GROUND_Y = 185;
const MAX_HEIGHT = 75;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

function lerpColor(a: number, b: number, t: number): number {
  const tc = Math.min(1, Math.max(0, t));
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  return (Math.round(ar + (br - ar) * tc) << 16)
       | (Math.round(ag + (bg - ag) * tc) << 8)
       |  Math.round(ab + (bb - ab) * tc);
}

interface Pulse {
  col: number;
  power: number;
  age: number;
}

export class BiomeFloor {
  private readonly cols: number;
  private life: Float32Array;
  private energy: Float32Array;
  private noiseA: Float32Array;
  private noiseB: Float32Array;
  // Pre-allocated per-frame work buffers — no GC pressure
  private readonly newLifeBuf: Float32Array;
  private readonly prefixBuf: Float32Array;
  private readonly smoothBuf: Float32Array;
  private g: PIXI.Graphics;
  private age = 0;
  private pulses: Pulse[] = [];
  private ambientTimer = 0;

  constructor(app: PIXI.Application) {
    const width = app.screen.width;
    this.cols = Math.ceil(width / PX);
    this.life      = new Float32Array(this.cols).fill(0.12);
    this.energy    = new Float32Array(this.cols).fill(0);
    this.newLifeBuf = new Float32Array(this.cols);
    this.prefixBuf  = new Float32Array(this.cols + 1);
    this.smoothBuf  = new Float32Array(this.cols);

    // Layered sine noise for permanent organic silhouette variation
    this.noiseA = new Float32Array(this.cols);
    this.noiseB = new Float32Array(this.cols);
    for (let c = 0; c < this.cols; c++) {
      const v = Math.sin(c / 14) * 0.45
              + Math.sin(c / 7.3 + 1.1) * 0.30
              + Math.sin(c / 3.2 + 2.6) * 0.15
              + Math.sin(c / 1.7 + 0.4) * 0.10;
      this.noiseA[c] = (v + 1) / 2;
      this.noiseB[c] = Math.random() * 0.35;
    }

    this.g = new PIXI.Graphics();
    app.stage.addChild(this.g);
  }

  // O(n) box blur via prefix sums — smooths spikes into rolling hills
  private _smooth(R: number): void {
    const cols   = this.cols;
    const prefix = this.prefixBuf;
    const out    = this.smoothBuf;
    prefix[0] = 0;
    for (let c = 0; c < cols; c++) prefix[c + 1] = prefix[c] + this.life[c];
    for (let c = 0; c < cols; c++) {
      const lo = Math.max(0, c - R);
      const hi = Math.min(cols, c + R + 1);
      out[c] = (prefix[hi] - prefix[lo]) / (hi - lo);
    }
  }

  /**
   * Inject energy at world position x with a cosine-falloff footprint.
   * radius is in world pixels; amount 0-1.
   */
  boost(x: number, radius: number, amount: number): void {
    const col = Math.round(x / PX);
    const r   = Math.round(radius / PX);
    for (let c = Math.max(0, col - r); c <= Math.min(this.cols - 1, col + r); c++) {
      const dist    = Math.abs(c - col);
      const falloff = Math.cos((dist / r) * Math.PI * 0.5);
      this.energy[c] = Math.min(1, this.energy[c] + amount * falloff * falloff);
    }
    this.pulses.push({ col, power: amount, age: 0 });
  }

  update(delta: number, ctx: SceneContext): void {
    this.age += delta;
    const dt   = delta / 16;
    const v    = ctx.vitality / 100;
    const cols = this.cols;

    // Advance pulse ring ages
    for (const p of this.pulses) p.age += delta;
    this.pulses = this.pulses.filter(p => p.age < 220);

    // --- Ambient metabolism: 2-4 scattered boosts at once ---
    this.ambientTimer -= delta;
    if (this.ambientTimer <= 0) {
      this.ambientTimer = lerp(700, 45, v * v) * (0.5 + Math.random() * 1.0);
      if (v > 0.05) {
        const burstCount = 2 + Math.floor(Math.random() * 3);
        for (let b = 0; b < burstCount; b++) {
          const ac = Math.floor(Math.random() * cols);
          const ar = Math.floor(20 + Math.random() * 40); // wide radius → smooth hills
          const aa = (0.06 + Math.random() * 0.14) * Math.pow(v, 0.6);
          for (let c = Math.max(0, ac - ar); c <= Math.min(cols - 1, ac + ar); c++) {
            const d = Math.abs(c - ac);
            const f = Math.cos((d / ar) * Math.PI * 0.5);
            this.energy[c] = Math.min(1, this.energy[c] + aa * f * f);
          }
          if (v > 0.25) {
            this.pulses.push({ col: ac, power: aa * 0.55, age: 0 });
          }
        }
      }
    }

    // --- Diffusion (slime spreading sideways) ---
    // Saturated columns (life near 1.0) spread faster — grows wider when at max height
    const newLife = this.newLifeBuf;
    for (let c = 0; c < cols; c++) {
      const lc = this.life[c];
      const saturation = Math.max(0, lc - 0.75) / 0.25; // 0 below 0.75, 1 at 1.0
      const rate = lerp(0.015, 0.07, v) + saturation * 0.12;
      const l = c > 0      ? this.life[c - 1] : lc;
      const r = c < cols-1 ? this.life[c + 1] : lc;
      newLife[c] = lc + rate * dt * (l + r - 2 * lc);
    }

    // --- Energy injection + gentle vitality pull + slow decay ---
    const globalTarget = v * 0.28;
    const pullStrength = 0.004 * dt;
    const energyAbsorb = 0.09 * dt;
    const energyDecay  = 0.025 * dt;
    const lifeDecay    = lerp(0.022, 0.007, v) * dt;  // ~8-25s to fully die

    for (let c = 0; c < cols; c++) {
      newLife[c] += this.energy[c] * energyAbsorb;
      newLife[c] += (globalTarget - newLife[c]) * pullStrength;
      newLife[c]  = Math.max(0, Math.min(1, newLife[c] - lifeDecay));
      this.energy[c] = Math.max(0, this.energy[c] - energyDecay);
      this.life[c]   = newLife[c];
    }

    this._render(ctx);
  }

  private _getPulseBoost(col: number): number {
    let boost = 0;
    for (const p of this.pulses) {
      const dist       = Math.abs(col - p.col);
      const waveRadius = p.age * 0.18;           // ring expands outward (slower)
      const waveWidth  = 22;
      const distToWave = Math.abs(dist - waveRadius);
      if (distToWave < waveWidth) {
        const strength = (1 - distToWave / waveWidth) * p.power * (1 - p.age / 220);
        if (strength > boost) boost = strength;
      }
    }
    return boost;
  }

  private _render(ctx: SceneContext): void {
    const g    = this.g;
    g.clear();

    const v      = ctx.vitality / 100;
    const t      = this.age;
    const cols   = this.cols;
    const gY     = GROUND_Y;

    // --- Soil base (replaces drawGround) ---
    const soilTop  = lerpColor(0x120800, 0x0e1a06, v);
    const soilBody = lerpColor(0x1a0e00, 0x0a2200, v);
    g.rect(0, gY, cols * PX, 8).fill(soilTop);
    g.rect(0, gY + 8, cols * PX, 60).fill(soilBody);

    // Smooth raw life into rolling hills (radius 55 cols ≈ 110 px)
    this._smooth(55);

    // --- Per-column organic growth ---
    for (let c = 0; c < cols; c++) {
      const smoothLife = this.smoothBuf[c];
      if (smoothLife < 0.015) continue;

      const pulseBoost = this._getPulseBoost(c);
      const breathe    = Math.sin(t * 0.022 + c * 0.09) * 0.020 * v;
      const noise      = this.noiseA[c] * 0.30 + this.noiseB[c] * 0.15;
      const effective  = Math.min(1, smoothLife + pulseBoost * 0.30 + breathe);
      const heightPx   = Math.round(effective * (0.70 + noise * 0.35) * MAX_HEIGHT / PX) * PX;
      if (heightPx <= 0) continue;

      // Use raw life for color hotspot intensity (peaks glow brighter)
      const baseLife = this.life[c];

      const x = c * PX;

      // Color palette shifts with vitality:
      //   dead  → dark grey-brown
      //   alive → deep green → neon slime
      const rootC = lerpColor(0x0a0c08, 0x071a04, v);
      const midC  = lerpColor(0x151a10, 0x1a5508, v);
      const topC  = lerpColor(0x223320, 0x44aa11, Math.pow(v, 0.6));
      const tipC  = lerpColor(0x3a5530, 0xaaff44, Math.pow(v, 0.35) * Math.min(1, 0.6 + baseLife * 0.6 + pulseBoost * 0.6));

      for (let h = 0; h < heightPx; h += PX) {
        const ht = h / MAX_HEIGHT;
        let color: number;
        if      (ht < 0.25) color = lerpColor(rootC, midC, ht / 0.25);
        else if (ht < 0.60) color = lerpColor(midC,  topC, (ht - 0.25) / 0.35);
        else                color = lerpColor(topC,  tipC, (ht - 0.60) / 0.40);
        g.rect(x, gY - h, PX, PX).fill(color);
      }

      // Tip glow — brighter pixel at the very top, pulsing
      if (v > 0.25 && heightPx >= PX * 3) {
        const glowAlpha = v * 0.65 * (0.5 + 0.5 * Math.sin(t * 0.045 + c * 0.22 + pulseBoost * 3));
        g.rect(x, gY - heightPx, PX, PX).fill({ color: tipC, alpha: glowAlpha });
      }
    }

    // --- Horizontal vein / mycelium lines within the mass ---
    if (v > 0.35) {
      const veinColor = lerpColor(0x1a3300, 0x33aa00, v);
      const veinAlpha = (v - 0.35) * 0.18;
      const veinYs    = [gY - 10, gY - 22, gY - 36];
      for (const vy of veinYs) {
        for (let c = 0; c < cols; c++) {
          const minH = (gY - vy) / MAX_HEIGHT;
          if (this.life[c] * 0.9 > minH) {
            g.rect(c * PX, vy, PX, 1).fill({ color: veinColor, alpha: veinAlpha });
          }
        }
      }
    }
  }
}
