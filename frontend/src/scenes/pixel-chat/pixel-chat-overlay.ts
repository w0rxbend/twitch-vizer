import * as PIXI from 'pixi.js';

import {
  bootstrapOverlay,
  clamp,
  hashSeed,
  OverlayEventSocket,
  seedRng,
} from '../../shared/overlay';
import type { VisualEventMsg } from '../../shared/overlay';
import { createOverlayApp, makePixelTexture } from '../../shared/pixi';
import { PixelChatCard } from './pixel-chat-card';
import { PX, snap, TILE } from './pixel-helpers';
import { makePalette, userAccentColor } from './theme';
import type { Palette, PixelChatTheme } from './theme';

const CARD_GAP = 12;
const MAX_CARDS = 7;

interface Spark {
  particle: PIXI.Particle;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

export class PixelChatOverlay {
  private app: PIXI.Application | null = null;
  private pixelTexture: PIXI.Texture | null = null;
  private cards: PixelChatCard[] = [];
  private userAccents = new Map<string, number>();
  private serial = 0;
  private sparks: Spark[] = [];
  private sparkLayer: PIXI.ParticleContainer<PIXI.Particle> | null = null;
  private readonly eventSocket = new OverlayEventSocket({
    label: 'PixelChatOverlay',
    onEvent: (msg) => this.spawn(msg),
  });

  constructor(private readonly theme: PixelChatTheme) {}

  async init(): Promise<void> {
    const app = await createOverlayApp({
      antialias: false,
      resolution: 1,
      roundPixels: true,
    });
    app.canvas.style.imageRendering = 'pixelated';

    this.app = app;
    this.pixelTexture = makePixelTexture(app);
    this.sparkLayer = new PIXI.ParticleContainer<PIXI.Particle>({
      texture: this.pixelTexture,
      roundPixels: true,
      dynamicProperties: {
        position: true,
        vertex: false,
        rotation: false,
        uvs: false,
        color: true,
      },
    });
    app.stage.addChild(this.sparkLayer);
    app.ticker.add(({ deltaTime }) => this.tick(deltaTime));
    window.addEventListener('resize', () => this.layoutCards());
    this.seedPreview();
  }

  connectWebSocket(): void {
    this.eventSocket.connect();
  }

  spawn(msg: VisualEventMsg): void {
    if (!this.app || !this.pixelTexture) return;
    const userKey = this.userKey(msg.username);
    const userSeed = msg.seed ?? hashSeed(userKey);
    const userAccent = this.userAccent(msg, userKey, userSeed);
    const seed = this.nextSeed(msg, userKey, userSeed);
    const palette = makePalette(this.theme, seed, userAccent);
    const card = new PixelChatCard(
      this.app,
      this.pixelTexture,
      msg,
      this.cardWidth(),
      palette,
      userSeed,
      userAccent,
      seed,
      this.theme,
    );
    card.setInitialX(this.randomCardLeft(card));

    this.cards.unshift(card);
    while (this.cards.length > MAX_CARDS) {
      this.cards.pop()?.destroy();
    }
    this.layoutCards();
    this.burst(card, palette, seed);
  }

  private tick(delta: number): void {
    for (let i = this.cards.length - 1; i >= 0; i--) {
      if (this.cards[i].update(delta)) {
        this.cards[i].destroy();
        this.cards.splice(i, 1);
        this.layoutCards();
      }
    }
    this.updateSparks(delta);
  }

  // Restacks the column vertically. Horizontal positions are deliberately not
  // recomputed on resize: an OBS browser source has a fixed size, so existing
  // cards keep the x they spawned with.
  private layoutCards(): void {
    if (!this.app) return;
    let y = this.app.screen.height - 24;
    this.cards.forEach((card) => {
      y -= card.height;
      card.setTargetY(y);
      y -= CARD_GAP;
    });
  }

  private cardWidth(): number {
    const screenW = this.app?.screen.width ?? window.innerWidth;
    return snap(clamp(screenW * 0.38, 430, 690), PX);
  }

  private randomCardLeft(card: PixelChatCard): number {
    const screenW = this.app?.screen.width ?? window.innerWidth;
    const margin = screenW < 720 ? 10 : 24;
    const maxLeft = Math.max(margin, screenW - card.width - margin);
    const range = Math.max(0, maxLeft - margin);
    if (range <= 0) return margin;

    const rng = seedRng(card.seed ^ (card.width * 17) ^ Math.floor(card.height * 31));
    const lanes = Math.max(1, Math.floor(range / Math.max(140, card.width * 0.28)));
    const lane = lanes <= 1 ? 0 : Math.floor(rng() * lanes);
    const laneWidth = range / lanes;
    const laneJitter = Math.max(0, laneWidth - card.width * 0.12);
    return snap(margin + lane * laneWidth + rng() * laneJitter, PX);
  }

  private userKey(username: string): string {
    return username.trim().toLowerCase() || 'anonymous';
  }

  private userAccent(msg: VisualEventMsg, userKey: string, userSeed: number): number {
    const existing = this.userAccents.get(userKey);
    if (existing !== undefined) return existing;
    const color = userAccentColor(this.theme, userSeed, msg.color);
    this.userAccents.set(userKey, color);
    return color;
  }

  private nextSeed(msg: VisualEventMsg, userKey: string, userSeed: number): number {
    this.serial += 1;
    return hashSeed([
      'pixel-chat',
      userKey,
      userSeed,
      msg.event,
      msg.text ?? '',
      this.serial,
      performance.now().toFixed(3),
      Math.floor(Math.random() * 0xffffffff),
    ].join(':'));
  }

  private burst(card: PixelChatCard, palette: Palette, seed: number): void {
    if (!this.sparkLayer || !this.pixelTexture) return;
    const rng = seedRng(seed ^ 0x5f1ce);
    const colors = [palette.line, palette.rose, palette.gold, palette.blue, palette.violet, palette.leaf];
    const x = card.view.x + 44 + rng() * 110;
    const y = card.view.y + 18 + rng() * Math.max(36, card.height - 24);

    for (let i = 0; i < 38; i++) {
      const speed = 1.3 + rng() * 3.4;
      const angle = -Math.PI * 0.88 + rng() * Math.PI * 0.95;
      const size = rng() > 0.76 ? TILE : PX;
      const particle = new PIXI.Particle({
        texture: this.pixelTexture,
        x,
        y,
        scaleX: size,
        scaleY: size,
        tint: colors[Math.floor(rng() * colors.length)],
        alpha: 0.92,
      });
      this.sparkLayer.addParticle(particle);
      this.sparks.push({
        particle,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 42 + rng() * 36,
      });
    }
  }

  private updateSparks(delta: number): void {
    if (!this.sparkLayer) return;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const spark = this.sparks[i];
      spark.life += delta;
      spark.particle.x += spark.vx * delta;
      spark.particle.y += spark.vy * delta;
      spark.vy += 0.052 * delta;
      spark.particle.alpha = clamp(1 - spark.life / spark.maxLife, 0, 1);
      if (spark.life >= spark.maxLife) {
        this.sparkLayer.removeParticle(spark.particle);
        this.sparks.splice(i, 1);
      }
    }
  }

  private seedPreview(): void {
    const params = new URLSearchParams(location.search);
    if (params.get('preview') === '0') return;
    this.spawn({ event: 'chat_message', username: 'worxbend', text: 'Welcome!', color: '#ff5fa8', seed: 1 });
  }
}

/**
 * Boots the scene. Each entry file calls this with its theme: pixel-chat with
 * 'default', razer-pixel-chat with 'razer'.
 */
export function startPixelChat(theme: PixelChatTheme): void {
  const overlay = new PixelChatOverlay(theme);
  bootstrapOverlay(overlay, {
    label: 'PixelChatOverlay',
    onTestKey: () => {
      const seed = Math.floor(Math.random() * 0xffffff);
      overlay.spawn({
        event: 'chat_message',
        username: `viewer${seed % 97}`,
        text: 'fresh procedural pixel plate',
        color: `#${seed.toString(16).padStart(6, '0')}`,
        seed,
      });
    },
  });
}
