import * as PIXI from 'pixi.js';
import type { VitalityPhase, SceneContext } from './types.js';

const CANVAS_HEIGHT = 240;
const GROUND_Y = 185;
const PX = 2;

// ---------------------------------------------------------------------------
// VitalityEngine
// ---------------------------------------------------------------------------

export class VitalityEngine {
  private vitality: number = 50;
  private readonly decayRate: number = 2.5;
  private frameAccum: number = 0;

  boost(amount: number): void {
    this.vitality = Math.min(100, this.vitality + amount);
  }

  tick(delta: number): void {
    this.frameAccum += delta;
    const seconds = Math.floor(this.frameAccum / 60);
    if (seconds > 0) {
      this.frameAccum -= seconds * 60;
      this.vitality = Math.max(0, Math.min(100, this.vitality - this.decayRate * seconds));
    }
  }

  get value(): number {
    return this.vitality;
  }

  get phase(): VitalityPhase {
    if (this.vitality < 10) return 'dead';
    if (this.vitality < 30) return 'dying';
    if (this.vitality < 55) return 'struggling';
    if (this.vitality < 80) return 'alive';
    return 'thriving';
  }
}

// ---------------------------------------------------------------------------
// DayNightCycle
// ---------------------------------------------------------------------------

interface ColorStop {
  t: number;
  top: number;
  bottom: number;
}

const SKY_STOPS: ColorStop[] = [
  { t: 0.00, top: 0x0a0a1a, bottom: 0x1a1a3e },
  { t: 0.20, top: 0x1a1a2e, bottom: 0xFF6B35 },
  { t: 0.30, top: 0x87CEEB, bottom: 0xFFF9C4 },
  { t: 0.50, top: 0x1565C0, bottom: 0x90CAF9 },
  { t: 0.75, top: 0x4A148C, bottom: 0xFF6B35 },
  { t: 1.00, top: 0x0a0a1a, bottom: 0x1a1a3e },
];

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const blue = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | blue;
}

function sampleSky(time: number): { top: number; bottom: number } {
  for (let i = 0; i < SKY_STOPS.length - 1; i++) {
    const s0 = SKY_STOPS[i];
    const s1 = SKY_STOPS[i + 1];
    if (time >= s0.t && time <= s1.t) {
      const t = (time - s0.t) / (s1.t - s0.t);
      return {
        top: lerpColor(s0.top, s1.top, t),
        bottom: lerpColor(s0.bottom, s1.bottom, t),
      };
    }
  }
  return { top: SKY_STOPS[0].top, bottom: SKY_STOPS[0].bottom };
}

export class DayNightCycle {
  private time: number = 0.33;
  private readonly baseSpeed: number = 1 / 36000;

  tick(delta: number, vitality: number): void {
    const speedMult = vitality > 60 ? 1 + ((vitality - 60) / 40) : 1;
    this.time = (this.time + this.baseSpeed * speedMult * delta) % 1;
  }

  get timeOfDay(): number {
    return this.time;
  }

  get isNight(): boolean {
    return this.time < 0.2 || this.time > 0.85;
  }

  get skyColors(): { top: number; bottom: number } {
    return sampleSky(this.time);
  }

  get ambientAlpha(): number {
    if (this.time <= 0.2) {
      return 0.5 - (this.time / 0.2) * 0.5;
    }
    if (this.time >= 0.85) {
      return ((this.time - 0.85) / 0.15) * 0.5;
    }
    const mid = 0.5;
    const dist = Math.abs(this.time - mid);
    const halfRange = mid - 0.2;
    return (dist / halfRange) * 0.25;
  }
}

// ---------------------------------------------------------------------------
// WeatherSystem
// ---------------------------------------------------------------------------

export class WeatherSystem {
  private intensity: number = 0;
  private windStrength: number = 0;
  private windTarget: number = 0;
  private windChangeTimer: number = 0;
  private lastVitality: number = 50;

  tick(delta: number, vitality: number): void {
    this.lastVitality = vitality;
    const intensityTarget = vitality > 70 ? (vitality - 70) / 30 : 0;
    this.intensity += (intensityTarget - this.intensity) * 0.002 * delta;

    this.windChangeTimer -= delta;
    if (this.windChangeTimer <= 0) {
      this.windTarget = (Math.random() * 2 - 1);
      this.windChangeTimer = 300 + Math.random() * 300;
    }
    this.windStrength += (this.windTarget - this.windStrength) * 0.005 * delta;
  }

  get currentIntensity(): number {
    return this.intensity;
  }

  get currentWind(): number {
    return this.windStrength;
  }

  get shouldSpawnRain(): boolean {
    return this.intensity > 0.3 && Math.random() < this.intensity * 0.3;
  }

  get shouldSpawnDust(): boolean {
    return this.lastVitality < 20 && Math.random() < 0.02;
  }

  get shouldSpawnPollen(): boolean {
    return this.lastVitality > 60 && Math.random() < 0.015;
  }
}

// ---------------------------------------------------------------------------
// FogSystem
// ---------------------------------------------------------------------------

export class FogSystem {
  private _density: number = 0;

  tick(delta: number, vitality: number): void {
    const densityTarget = vitality < 25 ? (25 - vitality) / 25 : 0;
    this._density += (densityTarget - this._density) * 0.003 * delta;
  }

  get density(): number {
    return this._density;
  }
}

// ---------------------------------------------------------------------------
// BackgroundRenderer
// ---------------------------------------------------------------------------

function drawHills(g: PIXI.Graphics, width: number, vitality: number = 50): void {
  g.clear();
  const color = lerpColor(0x0d1a0d, 0x0d3b0d, vitality / 100);
  const hillY = GROUND_Y - 30;
  const hillCount = 4;
  const amplitude = 28;
  const strips = 4;

  for (let strip = 0; strip < strips; strip++) {
    const stripY = hillY + strip * PX;
    for (let px = 0; px < width; px += PX) {
      let minY = GROUND_Y;
      for (let h = 0; h < hillCount; h++) {
        const offset = (h / hillCount) * Math.PI * 2;
        const freq = (2 + h * 0.7);
        const localY = hillY + amplitude - Math.sin((px / width) * Math.PI * freq + offset) * amplitude;
        if (localY < minY) minY = localY;
      }
      if (stripY >= minY) {
        g.rect(px, stripY, PX, PX).fill(color);
      }
    }
  }

  g.rect(0, GROUND_Y - PX, width, GROUND_Y + PX).fill(color);
}

export class BackgroundRenderer {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_app: PIXI.Application) {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(_delta: number, _ctx: SceneContext): void {}
}
