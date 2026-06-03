import * as PIXI from 'pixi.js';

import { OverlayEventSocket, clamp } from '../../shared/overlay';
import type { VisualEventMsg } from '../../shared/overlay';

// ── Palette ───────────────────────────────────────────────────────────────────

const COLD_BLUE  = 0x4888b8;
const COLD_WHITE = 0xd8e4ec;
const BG_DARK    = 0x050810;
const GLITCH_RED = 0xff2838;
const GLITCH_CYN = 0x00d8ff;
const AMBER      = 0xc8a040;

// ── Types ─────────────────────────────────────────────────────────────────────

interface GlitchBand {
  y: number;
  h: number;
  shiftX: number;
  color: number;
  alpha: number;
}

interface Glitch {
  active: boolean;
  age: number;
  bands: GlitchBand[];
}

interface MicroBurst {
  x: number;
  y: number;
  w: number;
  color: number;
  alpha: number;
  life: number;
  maxLife: number;
}

// ── MrRobotOverlay ────────────────────────────────────────────────────────────

class MrRobotOverlay {
  private app: PIXI.Application | null = null;
  private readonly ambientGfx = new PIXI.Graphics();
  private readonly noiseGfx   = new PIXI.Graphics();
  private readonly glitchGfx  = new PIXI.Graphics();
  private elapsed      = 0;
  private noiseClock   = 0;
  private microTimer   = 180;
  private microBursts: MicroBurst[] = [];
  private glitch: Glitch = { active: false, age: 0, bands: [] };

  private readonly eventSocket = new OverlayEventSocket({
    label: 'MrRobotOverlay',
    onEvent: () => this.trigger(),
  });

  async init(): Promise<void> {
    const app = new PIXI.Application();
    await app.init({
      resizeTo: window,
      backgroundAlpha: 0,
      antialias: false,
      resolution: Math.min(devicePixelRatio, 2),
      autoDensity: true,
    });

    document.body.appendChild(app.canvas);
    app.canvas.style.position = 'fixed';
    app.canvas.style.inset    = '0';
    this.app = app;

    const { width: w, height: h } = app.screen;

    app.stage.addChild(this.buildScanlines(w, h));
    app.stage.addChild(this.buildVignette(w, h));
    app.stage.addChild(this.ambientGfx);
    app.stage.addChild(this.noiseGfx);
    app.stage.addChild(this.glitchGfx);

    // Subtle cool desaturation
    const tint = new PIXI.ColorMatrixFilter();
    tint.matrix = [
      0.88, 0.02, 0.06, 0, -0.02,
      0,    0.88, 0.04, 0, -0.01,
      0.04, 0.04, 1.06, 0,  0.02,
      0,    0,    0,    1,  0,
    ];
    app.stage.filters = [tint];

    app.ticker.add(({ deltaTime }) => this.tick(deltaTime));
  }

  connectWebSocket(): void {
    this.eventSocket.connect();
  }

  trigger(): void {
    if (!this.app) return;
    const { height: h } = this.app.screen;
    const palette = [COLD_BLUE, GLITCH_CYN, COLD_WHITE, GLITCH_RED, 0x000000, BG_DARK, AMBER];
    const bands: GlitchBand[] = [];
    const count = 10 + Math.floor(Math.random() * 12);

    for (let i = 0; i < count; i++) {
      bands.push({
        y:      Math.random() * h,
        h:      [1, 1, 1, 2, 2, 2, 4][Math.floor(Math.random() * 7)],
        shiftX: (Math.random() - 0.5) * 72,
        color:  palette[Math.floor(Math.random() * palette.length)],
        alpha:  0.14 + Math.random() * 0.58,
      });
    }

    this.glitch = { active: true, age: 0, bands };
  }

  // ── CRT layers ──────────────────────────────────────────────────────────────

  private buildScanlines(w: number, h: number): PIXI.Graphics {
    const g = new PIXI.Graphics();
    for (let y = 0; y < h; y += 3) {
      g.rect(0, y, w, 1).fill({ color: 0x000000, alpha: 0.16 });
    }
    return g;
  }

  private buildVignette(w: number, h: number): PIXI.Graphics {
    const g   = new PIXI.Graphics();
    const dim = Math.min(w, h);
    for (let i = 0; i < 22; i++) {
      const t     = i / 22;
      const alpha = Math.pow(1 - t, 2) * 0.32;
      const inset = t * 0.32 * dim;
      g.rect(0,         0,         w,     inset).fill({ color: 0x000000, alpha });
      g.rect(0,         h - inset, w,     inset).fill({ color: 0x000000, alpha });
      g.rect(0,         0,         inset, h    ).fill({ color: 0x000000, alpha });
      g.rect(w - inset, 0,         inset, h    ).fill({ color: 0x000000, alpha });
    }
    return g;
  }

  // ── Ambient animation ────────────────────────────────────────────────────────

  private tickAmbient(delta: number): void {
    if (!this.app) return;
    const { width: w, height: h } = this.app.screen;
    this.ambientGfx.clear();

    // Slow CRT sweep line — scrolls top→bottom over ~10 seconds
    const scanY = (this.elapsed * 0.38) % h;
    this.ambientGfx.rect(0, scanY,       w, 1).fill({ color: 0x607890, alpha: 0.07 });
    this.ambientGfx.rect(0, scanY + 1,   w, 1).fill({ color: 0x607890, alpha: 0.03 });

    // Micro-static: schedule random tiny bursts
    this.microTimer -= delta;
    if (this.microTimer <= 0) {
      const count = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < count; i++) {
        const bw = 20 + Math.random() * 70;
        this.microBursts.push({
          x:       Math.random() * (w - bw),
          y:       Math.random() * h,
          w:       bw,
          color:   [COLD_BLUE, COLD_WHITE, AMBER, 0xffffff][Math.floor(Math.random() * 4)],
          alpha:   0.06 + Math.random() * 0.14,
          life:    0,
          maxLife: 8 + Math.random() * 12,
        });
      }
      this.microTimer = 180 + Math.random() * 300; // every 3–8 s at 60fps
    }

    // Draw and age micro bursts
    for (let i = this.microBursts.length - 1; i >= 0; i--) {
      const b = this.microBursts[i];
      b.life += delta;
      if (b.life >= b.maxLife) { this.microBursts.splice(i, 1); continue; }
      const fade = 1 - b.life / b.maxLife;
      this.ambientGfx.rect(b.x, b.y, b.w, 1).fill({ color: b.color, alpha: b.alpha * fade });
    }
  }

  // ── Film grain ──────────────────────────────────────────────────────────────

  private refreshNoise(): void {
    if (!this.app) return;
    const { width: w, height: h } = this.app.screen;
    this.noiseGfx.clear();
    const count = Math.round((w * h) / 3000);
    for (let i = 0; i < count; i++) {
      const dark  = Math.random() < 0.70;
      const color = dark ? 0x080c14 : 0x8aaac4;
      this.noiseGfx
        .rect(Math.random() * w, Math.random() * h, 2, 2)
        .fill({ color, alpha: 0.06 + Math.random() * 0.10 });
    }
  }

  // ── Glitch rendering ─────────────────────────────────────────────────────────

  private renderGlitch(delta: number): void {
    this.glitchGfx.clear();
    if (!this.glitch.active || !this.app) return;

    const DURATION = 52;
    this.glitch.age += delta;

    if (this.glitch.age >= DURATION) {
      this.glitch.active = false;
      return;
    }

    const { width: sw, height: sh } = this.app.screen;
    const progress = this.glitch.age / DURATION;
    const fade     = progress > 0.55 ? 1 - (progress - 0.55) / 0.45 : 1;

    // Cold-white flash at impact
    if (this.glitch.age < 6) {
      this.glitchGfx
        .rect(0, 0, sw, sh)
        .fill({ color: 0xe0eeff, alpha: (1 - this.glitch.age / 6) * 0.14 });
    }

    for (const band of this.glitch.bands) {
      if (progress > 0.5 && Math.random() < (progress - 0.5) * 2.4) continue;

      const bx = Math.max(0, band.shiftX);
      const bw = sw - Math.abs(band.shiftX);
      const a  = band.alpha * fade * (0.48 + Math.sin(this.elapsed * 4.4 + band.y * 0.09) * 0.46);

      this.glitchGfx
        .rect(bx, band.y, bw, band.h)
        .fill({ color: band.color, alpha: Math.max(0, a) });

      if (band.alpha > 0.22) {
        this.glitchGfx.rect(bx - 4, band.y,          bw, 1).fill({ color: GLITCH_RED, alpha: 0.22 * fade });
        this.glitchGfx.rect(bx + 4, band.y + band.h, bw, 1).fill({ color: GLITCH_CYN, alpha: 0.22 * fade });
      }
    }
  }

  // ── Ticker ───────────────────────────────────────────────────────────────────

  private tick(delta: number): void {
    this.elapsed    += delta;
    this.noiseClock += delta;

    if (this.noiseClock >= 5) {
      this.noiseClock = 0;
      this.refreshNoise();
    }

    this.tickAmbient(delta);
    this.renderGlitch(delta);
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const overlay = new MrRobotOverlay();
overlay.init().then(() => {
  overlay.connectWebSocket();
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === ' ') overlay.trigger();
  });
});
