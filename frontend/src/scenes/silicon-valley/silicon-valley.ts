import * as PIXI from 'pixi.js';

import { clamp, OverlayEventSocket } from '../../shared/overlay';

// ── Palette ───────────────────────────────────────────────────────────────────

const PP_RED      = 0xcc2229;
const PP_RED_GLOW = 0xe8473f;
const TEAL        = 0x22d3ee;
const WHITE       = 0xf5f5f5;

// ── Types ─────────────────────────────────────────────────────────────────────

interface NetworkNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: number;
  life: number;
  maxLife: number;
}

// ── NetworkBackground ─────────────────────────────────────────────────────────

class NetworkBackground {
  readonly view = new PIXI.Graphics();
  private readonly nodes: NetworkNode[];

  constructor(w: number, h: number) {
    this.nodes = Array.from({ length: 18 }, () => ({
      x:  Math.random() * w,
      y:  Math.random() * h,
      vx: (Math.random() < 0.5 ? -1 : 1) * (0.15 + Math.random() * 0.25),
      vy: (Math.random() < 0.5 ? -1 : 1) * (0.15 + Math.random() * 0.25),
      r:  1.5 + Math.random() * 1.5,
    }));
  }

  update(delta: number, w: number, h: number): void {
    const g = this.view;
    g.clear();

    for (const n of this.nodes) {
      n.x = clamp(n.x + n.vx * delta, 0, w);
      n.y = clamp(n.y + n.vy * delta, 0, h);
      if (n.x <= 0 || n.x >= w) n.vx *= -1;
      if (n.y <= 0 || n.y >= h) n.vy *= -1;
    }

    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i];
        const b = this.nodes[j];
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        if (dist < 170) {
          g.moveTo(a.x, a.y)
           .lineTo(b.x, b.y)
           .stroke({ color: PP_RED, width: 1, alpha: (1 - dist / 170) * 0.10 });
        }
      }
    }

    for (const n of this.nodes) {
      g.circle(n.x, n.y, n.r).fill({ color: PP_RED, alpha: 0.22 });
    }
  }
}

// ── SiliconValleyOverlay ──────────────────────────────────────────────────────

class SiliconValleyOverlay {
  private app: PIXI.Application | null = null;
  private network: NetworkBackground | null = null;
  private readonly burstGfx = new PIXI.Graphics();
  private readonly flashGfx = new PIXI.Graphics();
  private particles: Particle[] = [];
  private elapsed    = 0;
  private flashAge   = 0;
  private flashActive = false;

  private readonly eventSocket = new OverlayEventSocket({
    label: 'SiliconValleyOverlay',
    onEvent: () => this.trigger(),
  });

  async init(): Promise<void> {
    const app = new PIXI.Application();
    await app.init({
      resizeTo: window,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(devicePixelRatio, 2),
      autoDensity: true,
    });

    document.body.appendChild(app.canvas);
    app.canvas.style.position = 'fixed';
    app.canvas.style.inset    = '0';
    this.app = app;

    const { width: w, height: h } = app.screen;
    this.network = new NetworkBackground(w, h);

    app.stage.addChild(this.network.view);
    app.stage.addChild(this.burstGfx);
    app.stage.addChild(this.flashGfx);

    app.ticker.add(({ deltaTime }) => this.tick(deltaTime));
  }

  connectWebSocket(): void {
    this.eventSocket.connect();
  }

  trigger(): void {
    if (!this.app) return;
    const { width: w, height: h } = this.app.screen;

    // Random origin — favour spread across the screen
    const ox = 80 + Math.random() * (w - 160);
    const oy = 80 + Math.random() * (h - 160);

    const palette = [PP_RED, PP_RED_GLOW, TEAL, WHITE, PP_RED];
    const count   = 28 + Math.floor(Math.random() * 18);

    for (let i = 0; i < count; i++) {
      const angle  = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const speed  = 1.8 + Math.random() * 5.5;
      const maxLife = 38 + Math.random() * 36;
      this.particles.push({
        x:       ox,
        y:       oy,
        vx:      Math.cos(angle) * speed,
        vy:      Math.sin(angle) * speed,
        r:       1.2 + Math.random() * 3.2,
        color:   palette[Math.floor(Math.random() * palette.length)],
        life:    0,
        maxLife,
      });
    }

    // Short connection-line flash at origin — a few extra near-zero-velocity particles
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      this.particles.push({
        x: ox, y: oy,
        vx: Math.cos(angle) * 0.4, vy: Math.sin(angle) * 0.4,
        r: 0.8, color: WHITE,
        life: 0, maxLife: 18 + Math.random() * 12,
      });
    }

    this.flashAge    = 0;
    this.flashActive = true;
  }

  private tick(delta: number): void {
    this.elapsed += delta;
    const { width: w, height: h } = this.app?.screen ?? { width: window.innerWidth, height: window.innerHeight };

    this.network?.update(delta, w, h);
    this.tickParticles(delta);
    this.tickFlash(delta, w, h);
  }

  private tickParticles(delta: number): void {
    this.burstGfx.clear();

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += delta;
      if (p.life >= p.maxLife) { this.particles.splice(i, 1); continue; }

      // Decelerate
      p.vx *= Math.pow(0.92, delta);
      p.vy *= Math.pow(0.92, delta);
      p.x  += p.vx * delta;
      p.y  += p.vy * delta;

      const t     = p.life / p.maxLife;
      const alpha = clamp((1 - t) * (t < 0.15 ? t / 0.15 : 1), 0, 1);

      this.burstGfx.circle(p.x, p.y, p.r).fill({ color: p.color, alpha });
    }

    // Draw faint lines between nearby burst particles (mimics the network aesthetic)
    for (let i = 0; i < this.particles.length; i++) {
      for (let j = i + 1; j < this.particles.length; j++) {
        const a = this.particles[i];
        const b = this.particles[j];
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        if (dist < 80) {
          const lt = Math.max(a.life / a.maxLife, b.life / b.maxLife);
          this.burstGfx
            .moveTo(a.x, a.y).lineTo(b.x, b.y)
            .stroke({ color: PP_RED, width: 0.8, alpha: (1 - dist / 80) * (1 - lt) * 0.35 });
        }
      }
    }
  }

  private tickFlash(delta: number, w: number, h: number): void {
    if (!this.flashActive) return;
    this.flashAge += delta;
    this.flashGfx.clear();
    if (this.flashAge < 8) {
      this.flashGfx.rect(0, 0, w, h).fill({ color: PP_RED_GLOW, alpha: (1 - this.flashAge / 8) * 0.09 });
    } else {
      this.flashActive = false;
    }
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const overlay = new SiliconValleyOverlay();
overlay.init().then(() => {
  overlay.connectWebSocket();
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === ' ') overlay.trigger();
  });
});
