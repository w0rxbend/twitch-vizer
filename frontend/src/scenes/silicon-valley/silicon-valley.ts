import * as PIXI from 'pixi.js';

import { bootstrapOverlay, clamp, OverlayEventSocket } from '../../shared/overlay';
import type { VisualEventMsg } from '../../shared/overlay';
import { createOverlayApp } from '../../shared/pixi';

// ── Palette ───────────────────────────────────────────────────────────────────

const PP_RED      = 0xcc2229;
const PP_RED_GLOW = 0xe8473f;
const TEAL        = 0x22d3ee;
const WHITE       = 0xf5f5f5;
// Channel-points purple pair, mirroring the red/glow structure.
const CP_PURPLE      = 0x9147ff;
const CP_PURPLE_GLOW = 0xb07aff;

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
  /** Which trigger() call spawned this particle; connection lines stay within one burst. */
  burst: number;
}

// A chat flood can land several bursts inside one particle lifetime, and the
// connection pass below is quadratic, so the list is capped from the front
// (oldest and most faded first).
const MAX_PARTICLES = 200;

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
  private burstCount = 0;
  private flashAge = 0;
  private flashActive = false;
  private flashColor = PP_RED_GLOW;

  private readonly eventSocket = new OverlayEventSocket({
    label: 'SiliconValleyOverlay',
    onEvent: (msg) => this.trigger(msg),
  });

  async init(): Promise<void> {
    const app = await createOverlayApp({ antialias: true });
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

  trigger(msg?: VisualEventMsg): void {
    if (!this.app) return;
    const { width: w, height: h } = this.app.screen;

    // Random origin — favour spread across the screen
    const ox = 80 + Math.random() * (w - 160);
    const oy = 80 + Math.random() * (h - 160);

    // Redemption bursts glow channel-points purple instead of brand red.
    const palette = msg?.event === 'redemption'
      ? [CP_PURPLE, CP_PURPLE_GLOW, TEAL, WHITE, CP_PURPLE]
      : [PP_RED, PP_RED_GLOW, TEAL, WHITE, PP_RED];
    const count   = 28 + Math.floor(Math.random() * 18);
    const burst   = this.burstCount++;

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
        burst,
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
        burst,
      });
    }

    if (this.particles.length > MAX_PARTICLES) {
      this.particles.splice(0, this.particles.length - MAX_PARTICLES);
    }

    this.flashAge    = 0;
    this.flashActive = true;
    this.flashColor  = palette[1];
  }

  private tick(delta: number): void {
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

    // Faint lines between nearby particles (mimics the network aesthetic). Pairs
    // are only formed within a burst: particles stay in spawn order, so each
    // burst is a contiguous run, and pairing across runs would make the pass
    // quadratic in the whole list rather than in one burst.
    for (let start = 0; start < this.particles.length;) {
      let end = start + 1;
      while (end < this.particles.length && this.particles[end].burst === this.particles[start].burst) end++;
      this.strokeConnections(start, end);
      start = end;
    }
  }

  private strokeConnections(start: number, end: number): void {
    for (let i = start; i < end; i++) {
      for (let j = i + 1; j < end; j++) {
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
      this.flashGfx.rect(0, 0, w, h).fill({ color: this.flashColor, alpha: (1 - this.flashAge / 8) * 0.09 });
    } else {
      this.flashActive = false;
    }
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const overlay = new SiliconValleyOverlay();

// Spacebar alternates a generic burst with a synthetic redemption, so both
// visual variants can be checked without a live backend.
const TEST_EVENTS: (VisualEventMsg | undefined)[] = [
  undefined,
  { event: 'redemption', username: 'test_user', data: { reward: 'Hydrate!', cost: 250 } },
];
let testIndex = 0;

bootstrapOverlay(overlay, {
  label: 'SiliconValleyOverlay',
  onTestKey: () => overlay.trigger(TEST_EVENTS[testIndex++ % TEST_EVENTS.length]),
});
