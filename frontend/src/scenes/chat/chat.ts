import * as PIXI from 'pixi.js';

import {
  bootstrapOverlay,
  clamp,
  colorFromString,
  hashSeed,
  hslToRgb,
  OverlayEventSocket,
  seedRng,
} from '../../shared/overlay';
import type { VisualEventMsg } from '../../shared/overlay';
import { createOverlayApp, makePixelTexture } from '../../shared/pixi';
import { ChatCard } from './card';
import { makePalette, PX } from './palette';
import type { Palette } from './palette';

interface MovingParticle {
  particle: PIXI.Particle;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

const CARD_GAP = 10;
const MAX_CARDS = 9;
// Oldest color entries are evicted past this size so a busy always-on chat
// does not grow the accent map without bound.
const MAX_TRACKED_USERS = 500;

class ChatOverlay {
  private app: PIXI.Application | null = null;
  private pixelTexture: PIXI.Texture | null = null;
  private cards: ChatCard[] = [];
  private userAccents = new Map<string, number>();
  private messageSerial = 0;
  private readonly eventSocket = new OverlayEventSocket({
    label: 'ChatOverlay',
    onEvent: (msg) => this.spawn(msg),
  });
  private burstLayer: PIXI.ParticleContainer<PIXI.Particle> | null = null;
  private burstParticles: MovingParticle[] = [];

  async init(): Promise<void> {
    const app = await createOverlayApp({
      antialias: false,
      resolution: 1,
      autoDensity: false,
      roundPixels: true,
    });

    this.app = app;
    this.pixelTexture = makePixelTexture(app);
    this.burstLayer = new PIXI.ParticleContainer<PIXI.Particle>({
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
    app.stage.addChild(this.burstLayer);
    app.ticker.add(({ deltaTime }) => this._tick(deltaTime));

    // Only existing cards' positions are updated on resize: their width was
    // baked in at spawn time and stays stale, which is acceptable because
    // every card expires within CARD_LIFETIME anyway.
    window.addEventListener('resize', () => this._layoutCards());
    this._seedPreview();
  }

  connectWebSocket(): void {
    this.eventSocket.connect();
  }

  spawn(msg: VisualEventMsg): void {
    if (!this.app || !this.pixelTexture) return;
    const userKey = this._userKey(msg.username);
    const userSeed = msg.seed ?? hashSeed(userKey);
    const userAccent = this._userAccent(msg, userKey, userSeed);
    const mascotSeed = hashSeed(`mascot:${userKey}`);
    const plateSeed = this._nextPlateSeed(msg, userKey, userSeed);
    const palette = makePalette(plateSeed, userAccent);
    const width = this._cardWidth();
    const card = new ChatCard(
      this.app,
      this.pixelTexture,
      msg,
      width,
      palette,
      userSeed,
      userAccent,
      mascotSeed,
      plateSeed,
    );
    this.cards.unshift(card);

    while (this.cards.length > MAX_CARDS) {
      this.cards.pop()?.destroy();
    }

    this._layoutCards();
    this._burst(card, palette, plateSeed);
  }

  private _userKey(username: string): string {
    return username.trim().toLowerCase() || 'anonymous';
  }

  private _userAccent(msg: VisualEventMsg, userKey: string, userSeed: number): number {
    const existing = this.userAccents.get(userKey);
    if (existing !== undefined) return existing;

    const fallbackHue = userSeed % 360;
    const fallback = hslToRgb(fallbackHue, 0.78, 0.58);
    const accent = colorFromString(msg.color, fallback);
    if (this.userAccents.size >= MAX_TRACKED_USERS) {
      const oldest = this.userAccents.keys().next().value;
      if (oldest !== undefined) this.userAccents.delete(oldest);
    }
    this.userAccents.set(userKey, accent);
    return accent;
  }

  private _nextPlateSeed(msg: VisualEventMsg, userKey: string, userSeed: number): number {
    this.messageSerial += 1;
    const randomBits = Math.floor(Math.random() * 0xffffffff);
    return hashSeed([
      userKey,
      userSeed,
      msg.event,
      msg.text ?? '',
      this.messageSerial,
      performance.now().toFixed(3),
      randomBits,
    ].join(':'));
  }

  private _tick(delta: number): void {
    const x = this._left();
    for (let i = this.cards.length - 1; i >= 0; i--) {
      if (this.cards[i].update(delta, x)) {
        this.cards[i].destroy();
        this.cards.splice(i, 1);
        this._layoutCards();
      }
    }
    this._updateBurst(delta);
  }

  private _layoutCards(): void {
    if (!this.app) return;
    let y = this.app.screen.height - 24;
    const x = this._left();
    for (const card of this.cards) {
      y -= card.height;
      card.setTarget(x, y);
      y -= CARD_GAP;
    }
  }

  private _cardWidth(): number {
    const screenW = this.app?.screen.width ?? window.innerWidth;
    return Math.round(clamp(screenW * 0.36, 420, 640) / PX) * PX;
  }

  private _left(): number {
    const screenW = this.app?.screen.width ?? window.innerWidth;
    return screenW < 700 ? 12 : 28;
  }

  private _burst(card: ChatCard, palette: Palette, seed: number): void {
    if (!this.pixelTexture || !this.burstLayer) return;
    const rng = seedRng(seed ^ 0x4c415345);
    const x = this._left() + 28 + rng() * 120;
    const y = card.view.y + 14 + rng() * Math.max(42, card.height - 20);
    const colors = [palette.accent, palette.pop, palette.glow, palette.panel, palette.ink];

    for (let i = 0; i < 34; i++) {
      const speed = 1.4 + rng() * 3.2;
      const angle = -Math.PI * 0.85 + rng() * Math.PI * 0.95;
      const size = rng() > 0.75 ? PX * 2 : PX;
      const particle = new PIXI.Particle({
        texture: this.pixelTexture,
        x,
        y,
        scaleX: size,
        scaleY: size,
        tint: colors[Math.floor(rng() * colors.length)],
        alpha: 0.85,
      });
      this.burstLayer.addParticle(particle);
      this.burstParticles.push({
        particle,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 42 + rng() * 34,
      });
    }
  }

  private _updateBurst(delta: number): void {
    if (!this.burstLayer) return;
    for (let i = this.burstParticles.length - 1; i >= 0; i--) {
      const item = this.burstParticles[i];
      item.life += delta;
      item.particle.x += item.vx * delta;
      item.particle.y += item.vy * delta;
      item.vy += 0.055 * delta;
      item.particle.alpha = clamp(1 - item.life / item.maxLife, 0, 1);
      if (item.life >= item.maxLife) {
        this.burstLayer.removeParticle(item.particle);
        this.burstParticles.splice(i, 1);
      }
    }
  }

  private _seedPreview(): void {
    const params = new URLSearchParams(location.search);
    if (params.get('preview') === '0') return;
    this.spawn({ event: 'chat_message', username: 'worxbend', text: 'Welcome!', color: '#ff9e88', seed: 1 });
  }
}

const overlay = new ChatOverlay();
const debugSpawner = new URLSearchParams(location.search).get('debug') === '1';
bootstrapOverlay(overlay, {
  label: 'ChatOverlay',
  // The spacebar test spawner is opt-in via ?debug=1 so a stray keypress in
  // an interactive OBS source cannot inject a fake chat card on stream.
  onTestKey: debugSpawner
    ? () => {
        const seed = Math.floor(Math.random() * 0xffffff);
        overlay.spawn({
          event: 'chat_message',
          username: `viewer${seed % 97}`,
          text: 'fresh chat signal rendered as pixel-card energy',
          color: `#${seed.toString(16).padStart(6, '0')}`,
          seed,
        });
      }
    : undefined,
});
