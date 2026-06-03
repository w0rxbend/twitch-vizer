import * as PIXI from 'pixi.js';

import { clamp, OverlayEventSocket } from '../../shared/overlay';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PixelBlock {
  x: number;
  y: number;
  w: number;
  h: number;
  phase: number;
  speed: number;
}

interface GlitchBurst {
  view: PIXI.Graphics;
  blocks: PixelBlock[];
  colors: number[];
  life: number;
  maxLife: number;
}

interface ScanLine {
  view: PIXI.Graphics;
  x: number;
  y: number;
  speed: number;
  life: number;
  maxLife: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const NEON_PALETTE: number[] = [
  0x00ff41, 0xff00ff, 0x00ffff, 0xffff00, 0xff6600,
  0xff0066, 0x66ff00, 0x0066ff, 0xff3300, 0x33ff00,
  0xff00aa, 0xaaff00, 0x00aaff, 0xff5500, 0x55ff00,
];

const PX = 4;

function snap(val: number): number {
  return Math.round(val / PX) * PX;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickColors(count: number): number[] {
  return [...NEON_PALETTE].sort(() => Math.random() - 0.5).slice(0, count);
}

// ─── Main class ───────────────────────────────────────────────────────────────

class GlitchOverlay {
  private app: PIXI.Application | null = null;
  private bursts: GlitchBurst[] = [];
  private lines: ScanLine[] = [];
  private elapsed = 0;
  private readonly eventSocket = new OverlayEventSocket({
    label: 'GlitchOverlay',
    onEvent: () => this.trigger(),
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
    app.canvas.style.width = '100%';
    app.canvas.style.height = '100%';
    app.canvas.style.imageRendering = 'pixelated';

    this.app = app;
    app.ticker.add(({ deltaTime }) => this.tick(deltaTime));
  }

  connectWebSocket(): void {
    this.eventSocket.connect();
  }

  private trigger(): void {
    if (!this.app) return;

    const width = this.app.screen.width;
    const height = this.app.screen.height;

    // Random Y position for the horizontal glitch band
    const bandY = snap(randInt(40, height - 40));
    // 2–6 scanline rows per burst — thin horizontal band like a TV artifact
    const rowCount = randInt(2, 6);
    const colors = pickColors(randInt(5, 9));
    const blocks: PixelBlock[] = [];

    for (let row = 0; row < rowCount; row++) {
      const rowY = bandY + row * PX;
      // Each row has a random horizontal displacement (VHS tear effect)
      const displacement = snap((Math.random() - 0.5) * 40);
      let x = displacement;

      while (x < width) {
        // Segment widths vary: mostly medium, some wide, some narrow
        const segRoll = Math.random();
        const segW = segRoll < 0.4 ? PX * randInt(1, 3)       // 4–12 px narrow
          : segRoll < 0.75 ? PX * randInt(4, 10)               // 16–40 px medium
          : PX * randInt(11, 22);                               // 44–88 px wide

        const clampedX = Math.max(0, snap(x));
        const clampedW = Math.min(segW, width - clampedX);
        const hRoll = Math.random();
        const segH = hRoll < 0.50 ? PX
          : hRoll < 0.76 ? PX * 2
          : hRoll < 0.91 ? PX * 3
          : PX * 4;
        if (clampedW > 0) {
          blocks.push({
            x: clampedX,
            y: rowY,
            w: clampedW,
            h: segH,
            phase: Math.random() * colors.length,
            speed: 1.8 + Math.random() * 4.0,
          });
        }

        x += segW;
        // Occasional small gap between segments
        if (Math.random() < 0.18) x += PX;
      }
    }

    const view = new PIXI.Graphics();
    this.app.stage.addChild(view);
    this.bursts.push({ view, blocks, colors, life: 0, maxLife: randInt(38, 60) });

    // 1–3 thin full-width scan lines sweeping away from the band (CRT artifact)
    const lineCount = randInt(1, 3);
    for (let i = 0; i < lineCount; i++) {
      const dir = Math.random() < 0.5 ? -1 : 1; // sweep up or down
      const startY = snap(bandY + dir * randInt(0, rowCount) * PX);
      const lineView = new PIXI.Graphics();
      lineView.rect(0, startY, width, 2).fill({
        color: NEON_PALETTE[randInt(0, NEON_PALETTE.length - 1)],
        alpha: 0.75,
      });
      this.app.stage.addChild(lineView);
      this.lines.push({
        view: lineView,
        x: 0,
        y: startY,
        speed: dir * randInt(4, 10),
        life: 0,
        maxLife: randInt(14, 24),
      });
    }
  }

  private tick(delta: number): void {
    if (!this.app) return;
    this.elapsed += delta;

    const width = this.app.screen.width;

    // Update bursts
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i];
      burst.life += delta;

      if (burst.life >= burst.maxLife) {
        burst.view.destroy();
        this.bursts.splice(i, 1);
        continue;
      }

      const fadeStart = burst.maxLife - 14;
      const fadeFactor = burst.life >= fadeStart
        ? clamp((burst.maxLife - burst.life) / 14, 0, 1)
        : 1;

      burst.view.clear();
      for (const block of burst.blocks) {
        const idx = Math.floor(this.elapsed * block.speed + block.phase) % burst.colors.length;
        const alpha = clamp(
          (0.62 + Math.sin(this.elapsed * 1.6 + block.phase * 2.9) * 0.36) * fadeFactor,
          0,
          1,
        );
        burst.view.rect(block.x, block.y, block.w, block.h).fill({
          color: burst.colors[idx],
          alpha,
        });
      }
    }

    // Update scan lines
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const line = this.lines[i];
      line.life += delta;

      if (line.life >= line.maxLife) {
        line.view.destroy();
        this.lines.splice(i, 1);
        continue;
      }

      line.y += line.speed * delta;
      const fadeAlpha = clamp(1 - line.life / line.maxLife, 0, 1);
      line.view.clear();
      line.view.rect(0, line.y, width, 2).fill({
        color: NEON_PALETTE[Math.floor(line.life * 4) % NEON_PALETTE.length],
        alpha: fadeAlpha * 0.75,
      });
    }
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const overlay = new GlitchOverlay();
overlay.init().then(() => {
  overlay.connectWebSocket();
  window.addEventListener('keydown', (e) => {
    if (e.key === ' ') overlay['trigger']();
  });
});
