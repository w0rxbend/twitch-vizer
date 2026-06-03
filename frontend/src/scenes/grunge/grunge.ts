import * as PIXI from 'pixi.js';

import { OverlayEventSocket, clamp } from '../../shared/overlay';

// ── Palette ───────────────────────────────────────────────────────────────────
// Cold industrial — no warmth, no sepia.

const BLACK      = 0x000000;
const GREY_DARK  = 0x111111;
const GREY_MID   = 0x4a4a4a;
const GREY_LITE  = 0xb8b8b8;
const WHITE      = 0xeeeeee;
const ACID       = 0x88ff20;   // rare acid-green accent, industrial warning

// ── Types ─────────────────────────────────────────────────────────────────────

interface DebrisMote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  alpha: number;
  phase: number;
}

interface Scratch {
  x: number;
  y: number;
  length: number;
  width: number;
  color: number;
  alpha: number;
  life: number;
  maxLife: number;
}

interface DistortBand {
  y: number;
  h: number;
  shiftX: number;
  color: number;
  alpha: number;
  life: number;
  maxLife: number;
}

// ── GrungeOverlay ─────────────────────────────────────────────────────────────

class GrungeOverlay {
  private app: PIXI.Application | null = null;
  private readonly staticGfx   = new PIXI.Graphics();  // drifting h-lines
  private readonly grainGfx    = new PIXI.Graphics();
  private readonly dustGfx     = new PIXI.Graphics();
  private readonly scratchGfx  = new PIXI.Graphics();
  private readonly distortGfx  = new PIXI.Graphics();
  private readonly flickerGfx  = new PIXI.Graphics();

  private debris:     DebrisMote[]  = [];
  private scratches:  Scratch[]     = [];
  private distortions: DistortBand[] = [];

  private elapsed      = 0;
  private grainClock   = 0;
  private scratchTimer = 160;
  private flashActive  = false;
  private flashAge     = 0;

  private readonly eventSocket = new OverlayEventSocket({
    label: 'GrungeOverlay',
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

    app.stage.addChild(this.buildVignette(w, h));
    app.stage.addChild(this.staticGfx);
    app.stage.addChild(this.grainGfx);
    app.stage.addChild(this.dustGfx);
    app.stage.addChild(this.scratchGfx);
    app.stage.addChild(this.distortGfx);
    app.stage.addChild(this.flickerGfx);

    // High-contrast cold filter — no warm cast, punchy blacks
    const contrast = new PIXI.ColorMatrixFilter();
    contrast.matrix = [
      1.28, -0.14, -0.08, 0, -0.12,
     -0.10,  1.22, -0.10, 0, -0.10,
     -0.10, -0.14,  1.16, 0, -0.08,
      0,     0,     0,    1,  0,
    ];
    app.stage.filters = [contrast];

    this.initDebris(w, h);
    app.ticker.add(({ deltaTime }) => this.tick(deltaTime));
  }

  connectWebSocket(): void {
    this.eventSocket.connect();
  }

  trigger(): void {
    if (!this.app) return;
    const { width: w, height: h } = this.app.screen;

    // Aggressive horizontal distortion bands
    const count = 4 + Math.floor(Math.random() * 5);
    for (let i = 0; i < count; i++) {
      this.distortions.push({
        y:       Math.random() * h,
        h:       4 + Math.floor(Math.random() * 6) * 4,
        shiftX:  (Math.random() - 0.5) * 130,
        color:   Math.random() > 0.15 ? WHITE : ACID,
        alpha:   0.22 + Math.random() * 0.44,
        life:    0,
        maxLife: 12 + Math.random() * 20,
      });
    }

    // Extra burst of vertical scratches
    for (let i = 0; i < 3; i++) {
      this.scratches.push({
        x:       Math.random() * w,
        y:       0,
        length:  h * (0.5 + Math.random() * 0.5),
        width:   1,
        color:   WHITE,
        alpha:   0.30 + Math.random() * 0.40,
        life:    0,
        maxLife: 8 + Math.random() * 10,
      });
    }

    this.flashActive = true;
    this.flashAge    = 0;
  }

  // ── Static layer builder ─────────────────────────────────────────────────────

  private buildVignette(w: number, h: number): PIXI.Graphics {
    const g   = new PIXI.Graphics();
    const dim = Math.min(w, h);
    for (let i = 0; i < 24; i++) {
      const t     = i / 24;
      const alpha = Math.pow(1 - t, 2) * 0.34;
      const inset = t * 0.34 * dim;
      g.rect(0,         0,         w,     inset).fill({ color: BLACK, alpha });
      g.rect(0,         h - inset, w,     inset).fill({ color: BLACK, alpha });
      g.rect(0,         0,         inset, h    ).fill({ color: BLACK, alpha });
      g.rect(w - inset, 0,         inset, h    ).fill({ color: BLACK, alpha });
    }
    return g;
  }

  private initDebris(w: number, h: number): void {
    for (let i = 0; i < 28; i++) {
      this.debris.push({
        x:     Math.random() * w,
        y:     Math.random() * h,
        vx:    (Math.random() - 0.5) * 0.18,
        vy:    -(0.25 + Math.random() * 0.55),
        r:     0.6 + Math.random() * 1.4,
        alpha: 0.06 + Math.random() * 0.18,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  // ── Per-tick effects ─────────────────────────────────────────────────────────

  private tickStatic(): void {
    if (!this.app) return;
    const { width: w, height: h } = this.app.screen;
    this.staticGfx.clear();
    // 3–5 drifting horizontal static lines
    for (let i = 0; i < 4; i++) {
      const y  = ((this.elapsed * (0.18 + i * 0.07) + i * h * 0.27) % h);
      const lw = w * (0.35 + Math.sin(this.elapsed * 0.012 + i) * 0.22);
      const lx = Math.sin(this.elapsed * 0.009 + i * 1.3) * (w - lw) * 0.5 + (w - lw) * 0.5;
      this.staticGfx
        .rect(lx, y, lw, 1)
        .fill({ color: GREY_LITE, alpha: 0.04 + Math.sin(this.elapsed * 0.03 + i) * 0.02 });
    }
  }

  private refreshGrain(): void {
    if (!this.app) return;
    const { width: w, height: h } = this.app.screen;
    this.grainGfx.clear();
    const count = Math.round((w * h) / 720);
    for (let i = 0; i < count; i++) {
      const r    = Math.random();
      const size = r < 0.55 ? 2 : r < 0.82 ? 3 : 4;
      const dark = Math.random() < 0.55;
      const color = dark ? GREY_DARK : GREY_MID;
      this.grainGfx
        .rect(Math.random() * w, Math.random() * h, size, size)
        .fill({ color, alpha: 0.10 + Math.random() * 0.22 });
    }
  }

  private tickDebris(delta: number): void {
    if (!this.app) return;
    const { width: w, height: h } = this.app.screen;
    this.dustGfx.clear();

    for (const d of this.debris) {
      d.x += d.vx * delta + Math.sin(this.elapsed * 0.018 + d.phase) * 0.12;
      d.y += d.vy * delta;
      if (d.y < -4)    { d.y = h + 4; d.x = Math.random() * w; }
      if (d.x < -4)    d.x = w + 4;
      if (d.x > w + 4) d.x = -4;
      const a = d.alpha * (0.65 + Math.sin(this.elapsed * 0.025 + d.phase) * 0.35);
      this.dustGfx.circle(d.x, d.y, d.r).fill({ color: GREY_LITE, alpha: clamp(a, 0, 1) });
    }
  }

  private tickScratch(delta: number): void {
    if (!this.app) return;
    const { width: w, height: h } = this.app.screen;

    this.scratchTimer -= delta;
    if (this.scratchTimer <= 0) {
      this.scratches.push({
        x:       Math.random() * w,
        y:       Math.random() * h * 0.4,
        length:  h * (0.18 + Math.random() * 0.55),
        width:   Math.random() > 0.75 ? 2 : 1,
        color:   Math.random() > 0.1 ? GREY_LITE : WHITE,
        alpha:   0.12 + Math.random() * 0.22,
        life:    0,
        maxLife: 7 + Math.random() * 14,
      });
      this.scratchTimer = 140 + Math.random() * 200;
    }

    this.scratchGfx.clear();
    for (let i = this.scratches.length - 1; i >= 0; i--) {
      const s = this.scratches[i];
      s.life += delta;
      if (s.life >= s.maxLife) { this.scratches.splice(i, 1); continue; }
      const fade = 1 - s.life / s.maxLife;
      this.scratchGfx
        .rect(s.x, s.y, s.width, s.length)
        .fill({ color: s.color, alpha: clamp(s.alpha * fade, 0, 1) });
    }
  }

  private tickDistort(delta: number): void {
    if (!this.app) return;
    const { width: w } = this.app.screen;
    this.distortGfx.clear();

    for (let i = this.distortions.length - 1; i >= 0; i--) {
      const d = this.distortions[i];
      d.life += delta;
      if (d.life >= d.maxLife) { this.distortions.splice(i, 1); continue; }
      const fade = 1 - d.life / d.maxLife;
      const bx   = Math.max(0, d.shiftX);
      const bw   = w - Math.abs(d.shiftX);
      this.distortGfx
        .rect(bx, d.y, bw, d.h)
        .fill({ color: d.color, alpha: clamp(d.alpha * fade, 0, 1) });
    }
  }

  private tickFlicker(delta: number): void {
    if (!this.app) return;
    const { width: w, height: h } = this.app.screen;
    this.flickerGfx.clear();

    // Ambient flicker — random brief darken
    if (Math.random() < 0.10) {
      this.flickerGfx
        .rect(0, 0, w, h)
        .fill({ color: BLACK, alpha: 0.04 + Math.random() * 0.07 });
    }

    if (!this.flashActive) return;
    this.flashAge += delta;

    if (this.flashAge <= 4) {
      // White flash on impact
      const a = (1 - this.flashAge / 4) * 0.28;
      this.flickerGfx.rect(0, 0, w, h).fill({ color: WHITE, alpha: a });
    } else if (this.flashAge <= 16) {
      // Brief dark afterburn
      const a = clamp((1 - (this.flashAge - 4) / 12) * 0.10, 0, 1);
      this.flickerGfx.rect(0, 0, w, h).fill({ color: BLACK, alpha: a });
    } else {
      this.flashActive = false;
    }
  }

  // ── Ticker ───────────────────────────────────────────────────────────────────

  private tick(delta: number): void {
    this.elapsed    += delta;
    this.grainClock += delta;

    this.tickStatic();

    if (this.grainClock >= 3) {
      this.grainClock = 0;
      this.refreshGrain();
    }

    this.tickDebris(delta);
    this.tickScratch(delta);
    this.tickDistort(delta);
    this.tickFlicker(delta);
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const overlay = new GrungeOverlay();
overlay.init().then(() => {
  overlay.connectWebSocket();
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === ' ') overlay.trigger();
  });
});
