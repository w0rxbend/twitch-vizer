import * as PIXI from 'pixi.js';

import { animatedImageUrl, fitDisplayObject, loadEmoteDisplay, staticImageUrl } from '../../shared/emote-images';
import {
  bootstrapOverlay,
  clamp,
  colorFromString,
  emoteToPart,
  fillStyle,
  formatEventLabel,
  formatEventText,
  hashSeed,
  hslToRgb,
  mixColor,
  OverlayEventSocket,
  renderParts,
  seedRng,
} from '../../shared/overlay';
import type { MessagePart, VisualEventMsg } from '../../shared/overlay';
import { createOverlayApp } from '../../shared/pixi';

interface StatusConfig {
  height: number;
  idleMs: number;
  debug: boolean;
}

interface Ripple {
  x: number;
  y: number;
  radius: number;
  life: number;
  maxLife: number;
  color: number;
}

interface TickerItem {
  view: PIXI.Container;
  speed: number;
  seed: number;
}

const DEFAULT_HEIGHT = 108;
// Ticker text sits this far above the bottom edge: a fraction of the bar
// height, but never closer than the minimum inset.
const TICKER_MIN_INSET = 32;
const TICKER_BASELINE_RATIO = 0.42;
const TAU = Math.PI * 2;
const RAZER_GREEN = 0x54f044;
const TOXIC_GREEN = 0x38ff24;
const ACID_GREEN = 0x8cff68;
const DEEP_GREEN = 0x020802;
const LIQUID_BLACK = 0x000000;
const TOXIC_VIOLET = 0xb000ff;
const DARK_VIOLET = 0x250034;

interface WaveLayerSpec {
  yOffset: number;
  amplitudeScale: number;
  frequency: number;
  speed: number;
  phase: number;
  color: number;
  alpha: number;
}

function readConfig(): StatusConfig {
  const params = new URLSearchParams(location.search);
  const height = Number.parseInt(params.get('height') ?? '', 10);
  const idleMs = Number.parseInt(params.get('idleMs') ?? '', 10);
  return {
    height: clamp(Number.isFinite(height) ? height : DEFAULT_HEIGHT, 64, 180),
    idleMs: clamp(Number.isFinite(idleMs) ? idleMs : 6200, 1800, 20000),
    debug: params.get('debug') === '1',
  };
}

function ease(current: number, target: number, rate: number, delta: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * delta / 60));
}

function eventTickerText(msg: VisualEventMsg): string {
  const label = formatEventLabel(msg.event, { separator: ' ' });
  return `${label} | ${msg.username} ${formatEventText(msg, 'joined the stream')}`.trim();
}

function readableAccent(msg: VisualEventMsg): number {
  const seed = msg.seed ?? hashSeed(`${msg.username}:${msg.event}`);
  const base = colorFromString(msg.color, hslToRgb(seed % 360, 0.76, 0.58));
  const toxicBase = seed % 3 === 0 ? TOXIC_VIOLET : seed % 3 === 1 ? TOXIC_GREEN : ACID_GREEN;
  return mixColor(toxicBase, base, 0.22);
}

function makeTickerText(text: string): PIXI.Text {
  return new PIXI.Text({
    text,
    style: {
      fontFamily: '"Courier New", "Lucida Console", "Apple Color Emoji", "Segoe UI Emoji", monospace',
      fontSize: 25,
      fontWeight: '900',
      fill: 0xffffff,
      stroke: { color: 0x000000, width: 5 },
      letterSpacing: 0,
      dropShadow: {
        color: 0x000000,
        alpha: 0.55,
        blur: 4,
        distance: 0,
      },
    },
  });
}

function appendTickerText(container: PIXI.Container, text: string, x: number): number {
  if (!text) return x;
  const view = makeTickerText(text);
  view.x = x;
  view.y = 0;
  container.addChild(view);
  return x + view.width + 8;
}

function appendTickerImage(container: PIXI.Container, part: MessagePart, x: number): number {
  const size = 34;
  const frame = new PIXI.Graphics()
    .roundRect(x, -3, size, size, 5)
    .fill(fillStyle(DEEP_GREEN, 0.72))
    .stroke({ color: ACID_GREEN, alpha: 0.65, width: 2 });
  container.addChild(frame);

  const animatedUrl = animatedImageUrl(part);
  const staticUrl = staticImageUrl(part);

  if (animatedUrl || staticUrl) {
    void loadEmoteDisplay(part)
      .then((sprite) => {
        if (frame.destroyed) return;
        fitDisplayObject(sprite, size);
        sprite.x += x;
        sprite.y += -3;
        container.addChild(sprite);
        frame.alpha = 0.18;
      })
      .catch(() => {
        frame.clear()
          .roundRect(x, -3, size, size, 5)
          .fill(fillStyle(DEEP_GREEN, 0.86))
          .stroke({ color: TOXIC_GREEN, alpha: 0.72, width: 2 });
      });
  }

  if (!animatedUrl && !staticUrl && part.name) {
    appendTickerText(container, `:${part.name}:`, x + size + 4);
    return x + size + Math.max(56, part.name.length * 12);
  }

  return x + size + 10;
}

function makeTickerItem(msg: VisualEventMsg): PIXI.Container {
  const container = new PIXI.Container();
  let cursor = 0;

  if (msg.event === 'chat_message') {
    cursor = appendTickerText(container, `${msg.username}: `, cursor);
    for (const part of renderParts(msg)) {
      if (part.type === 'image') {
        cursor = appendTickerImage(container, part, cursor);
      } else {
        cursor = appendTickerText(container, part.text ?? '', cursor);
      }
    }
    return container;
  }

  cursor = appendTickerText(container, eventTickerText(msg), cursor);
  for (const emote of msg.emotes ?? []) {
    if (emote.url) {
      cursor = appendTickerImage(container, emoteToPart(emote), cursor);
    }
  }
  return container;
}

class StatusLineOverlay {
  private readonly config = readConfig();
  private readonly wave = new PIXI.Graphics();
  private readonly glow = new PIXI.Graphics();
  private readonly ripplesLayer = new PIXI.Container();
  private readonly textMask = new PIXI.Graphics();
  private readonly textLayer = new PIXI.Container();
  private readonly eventSocket = new OverlayEventSocket({
    label: 'StatusLine',
    onEvent: (msg) => this.receive(msg),
  });

  private app: PIXI.Application | null = null;
  private elapsed = 0;
  private idleFor = 999999;
  private level = 0;
  private targetLevel = 0;
  private energy = 0;
  private accent = 0x28e4b0;
  private messageSeed = 1;
  private tickerSpeed = 2.2;
  private tickerItems: TickerItem[] = [];
  private ripples: Ripple[] = [];
  private debugText: PIXI.Text | null = null;

  async init(): Promise<void> {
    const app = await createOverlayApp({
      antialias: false,
      resolution: 1,
      autoDensity: false,
      roundPixels: true,
    });

    app.canvas.style.width = '100%';
    app.canvas.style.height = '100%';
    app.canvas.style.imageRendering = 'pixelated';

    this.app = app;
    app.stage.addChild(this.glow, this.wave, this.ripplesLayer, this.textMask, this.textLayer);
    this.textLayer.mask = this.textMask;
    this.textLayer.alpha = 0;

    if (this.config.debug) {
      this.debugText = new PIXI.Text({
        text: '',
        style: {
          fontFamily: '"Courier New", monospace',
          fontSize: 13,
          fill: 0xffffff,
          letterSpacing: 0,
        },
      });
      this.debugText.x = 10;
      this.debugText.y = app.screen.height - this.config.height - 20;
      app.stage.addChild(this.debugText);
    }

    this.layout();
    window.addEventListener('resize', () => this.layout());
    app.ticker.add(({ deltaTime }) => this.tick(deltaTime));
  }

  connectWebSocket(): void {
    this.eventSocket.connect();
  }

  private receive(msg: VisualEventMsg): void {
    if (!this.app) return;

    this.idleFor = 0;
    this.targetLevel = 1;
    this.energy = clamp(this.energy + 0.46, 0, 1.35);
    this.accent = readableAccent(msg);
    this.messageSeed = msg.seed ?? hashSeed(`${msg.username}:${Date.now()}`);
    this.tickerSpeed = msg.event === 'chat_message' ? 2.2 : 2.8;

    this.addTickerItem(msg, this.messageSeed, this.tickerSpeed);

    const rng = seedRng(this.messageSeed ^ 0x57a7);
    const count = msg.event === 'chat_message' ? 3 : 7;
    for (let i = 0; i < count; i++) {
      this.ripples.push({
        x: rng() * this.app.screen.width,
        y: this.app.screen.height - this.config.height * (0.22 + rng() * 0.56),
        radius: 4 + rng() * 14,
        life: 0,
        maxLife: 34 + rng() * 28,
        color: mixColor(this.accent, hslToRgb((this.messageSeed + i * 41) % 360, 0.84, 0.62), 0.35),
      });
    }
  }

  private tick(delta: number): void {
    if (!this.app) return;

    this.elapsed += delta;
    this.idleFor += delta * (1000 / 60);

    if (this.idleFor > this.config.idleMs && this.tickerItems.length === 0) {
      this.targetLevel = 0;
    }

    this.energy = ease(this.energy, this.targetLevel, this.targetLevel > 0 ? 0.09 : 0.045, delta);
    this.level = ease(this.level, this.targetLevel, this.targetLevel > 0 ? 0.15 : 0.055, delta);

    this.drawWave();
    this.updateText(delta);
    this.updateRipples(delta);

    if (this.debugText) {
      this.debugText.text = `status-line level=${this.level.toFixed(2)} energy=${this.energy.toFixed(2)} messages=${this.tickerItems.length} ripples=${this.ripples.length}`;
      this.debugText.y = this.app.screen.height - this.config.height - 20;
    }
  }

  private layout(): void {
    if (!this.app) return;
    this.textMask.clear();
    this.textMask
      .rect(18, this.app.screen.height - this.config.height + 8, this.app.screen.width - 36, this.config.height - 18)
      .fill(0xffffff);
    this.layoutTextItems();
  }

  private tickerBaselineY(): number {
    if (!this.app) return 0;
    return this.app.screen.height - Math.max(TICKER_MIN_INSET, this.config.height * TICKER_BASELINE_RATIO);
  }

  private addTickerItem(msg: VisualEventMsg, seed: number, speed: number): void {
    if (!this.app) return;
    const view = makeTickerItem(msg);
    const y = this.tickerBaselineY();
    const rightmost = this.tickerItems.reduce(
      (max, item) => Math.max(max, item.view.x + item.view.width),
      this.app.screen.width,
    );

    view.x = Math.max(this.app.screen.width + 18, rightmost + 80);
    view.y = Math.round(y);
    view.alpha = 1;
    this.textLayer.addChild(view);
    this.tickerItems.push({ view, speed, seed });
  }

  private layoutTextItems(): void {
    if (!this.app) return;
    const y = this.tickerBaselineY();
    for (const item of this.tickerItems) {
      item.view.y = Math.round(y);
    }
  }

  private updateText(delta: number): void {
    if (!this.app) return;

    this.textLayer.alpha = this.tickerItems.length > 0 ? 1 : 0;
    if (this.tickerItems.length === 0) return;

    for (let i = this.tickerItems.length - 1; i >= 0; i--) {
      const item = this.tickerItems[i];
      const bob = Math.sin(this.elapsed * 0.075 + item.seed) * 1.2 * this.level;
      item.view.y = Math.round(this.tickerBaselineY() + bob);
      item.view.x -= item.speed * delta;

      if (item.view.x < -item.view.width - 48) {
        item.view.destroy();
        this.tickerItems.splice(i, 1);
      }
    }
  }

  private drawWave(): void {
    if (!this.app) return;

    const width = this.app.screen.width;
    const height = this.app.screen.height;
    const barHeight = this.config.height;
    const active = clamp(this.level, 0, 1);
    const energy = clamp(this.energy, 0, 1.2);
    const baseY = height - 7 - active * (barHeight * 0.18);
    const crest = height - barHeight * (0.18 + active * 0.72);
    const amp = 2 + active * (7 + energy * 10);
    const step = 14;
    const time = this.elapsed;
    const deep = mixColor(LIQUID_BLACK, RAZER_GREEN, 0.46 + active * 0.24);
    const bright = mixColor(ACID_GREEN, TOXIC_GREEN, 0.48);

    this.glow.clear();
    if (active > 0.015) {
      this.glow
        .rect(0, crest - 8, width, 7 + active * 8)
        .fill(fillStyle(bright, 0.24 + active * 0.30));
    }

    this.wave.clear();
    if (active < 0.01 && this.textLayer.alpha < 0.02) return;

    const layers: WaveLayerSpec[] = [
      {
        yOffset: barHeight * 0.30,
        amplitudeScale: 0.32,
        frequency: 1.45,
        speed: 0.032,
        phase: 1.7,
        color: mixColor(LIQUID_BLACK, DEEP_GREEN, 0.62),
        alpha: 1,
      },
      {
        yOffset: barHeight * 0.20,
        amplitudeScale: 0.42,
        frequency: 1.90,
        speed: -0.040,
        phase: 4.2,
        color: mixColor(DEEP_GREEN, RAZER_GREEN, 0.58),
        alpha: 0.96,
      },
      {
        yOffset: barHeight * 0.11,
        amplitudeScale: 0.55,
        frequency: 2.55,
        speed: 0.052,
        phase: 2.4,
        color: mixColor(TOXIC_GREEN, ACID_GREEN, 0.36),
        alpha: 0.90,
      },
    ];

    for (const layer of layers) {
      const layerBase = Math.min(height + 4, crest + layer.yOffset + active * 8);
      this.wave.moveTo(0, height + 4);
      this.wave.lineTo(0, layerBase);
      for (let x = 0; x <= width + step; x += step) {
        const normalized = x / Math.max(width, 1);
        const y = layerBase
          + Math.sin(normalized * TAU * layer.frequency + time * layer.speed + layer.phase) * amp * layer.amplitudeScale
          + Math.sin(normalized * TAU * (layer.frequency + 2.1) - time * layer.speed * 0.7 + this.messageSeed) * amp * layer.amplitudeScale * 0.28;
        this.wave.lineTo(x, Math.round(y));
      }
      this.wave.lineTo(width, height + 4);
      this.wave.closePath();
      this.wave.fill(fillStyle(layer.color, active > 0.02 ? layer.alpha : active));
    }

    this.wave.moveTo(0, height + 4);
    this.wave.lineTo(0, baseY);

    for (let x = 0; x <= width + step; x += step) {
      const normalized = x / Math.max(width, 1);
      const y = crest
        + Math.sin(normalized * TAU * 2.2 + time * 0.06) * amp
        + Math.sin(normalized * TAU * 5.3 - time * 0.035 + this.messageSeed) * amp * 0.35;
      this.wave.lineTo(x, Math.round(y));
    }

    this.wave.lineTo(width, height + 4);
    this.wave.closePath();
    this.wave.fill(fillStyle(deep, active > 0.02 ? 1 : active));

    this.wave
      .rect(0, height - 10 - active * 4, width, 8 + active * 4)
      .fill(fillStyle(mixColor(TOXIC_GREEN, ACID_GREEN, 0.38), active > 0.02 ? 0.96 : active));

    for (let lane = 0; lane < 3; lane++) {
      const offset = lane * 13 + Math.sin(time * 0.035 + lane) * 4;
      const laneAlpha = (lane === 0 ? 0.28 : 0.16 + lane * 0.035) * active;
      this.wave.moveTo(0, crest + offset);
      for (let x = 0; x <= width + step; x += step) {
        const normalized = x / Math.max(width, 1);
        const y = crest + offset
          + Math.sin(normalized * TAU * (1.7 + lane * 0.8) + time * (0.04 + lane * 0.009)) * (amp * (0.26 + lane * 0.08));
        this.wave.lineTo(x, Math.round(y));
      }
      const laneColor = lane === 0
        ? bright
        : lane === 1
          ? mixColor(ACID_GREEN, TOXIC_GREEN, 0.52)
          : mixColor(RAZER_GREEN, ACID_GREEN, 0.42);
      this.wave.stroke({ color: laneColor, alpha: laneAlpha, width: lane === 0 ? 3 : 2 });
    }
  }

  private updateRipples(delta: number): void {
    if (!this.app) return;

    this.ripplesLayer.removeChildren().forEach((child) => child.destroy());
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const ripple = this.ripples[i];
      ripple.life += delta;
      if (ripple.life >= ripple.maxLife) {
        this.ripples.splice(i, 1);
        continue;
      }

      const t = ripple.life / ripple.maxLife;
      const g = new PIXI.Graphics();
      g.circle(ripple.x, ripple.y, ripple.radius + t * 46)
        .stroke({ color: ripple.color, alpha: (1 - t) * 0.42 * this.level, width: 2 });
      g.circle(ripple.x, ripple.y, 2 + t * 5)
        .fill(fillStyle(mixColor(ripple.color, 0xffffff, 0.25), (1 - t) * 0.25 * this.level));
      this.ripplesLayer.addChild(g);
    }
  }
}

const overlay = new StatusLineOverlay();
bootstrapOverlay(overlay, { label: 'StatusLine' });
