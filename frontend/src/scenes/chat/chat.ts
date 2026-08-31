import * as PIXI from 'pixi.js';

import {
  bootstrapOverlay,
  clamp,
  colorFromString,
  hashSeed,
  hslToRgb,
  OverlayEventSocket,
  ParticleBurst,
  seedRng,
  UserStyles,
} from '../../shared/overlay';
import type { VisualEventMsg } from '../../shared/overlay';
import { createOverlayApp, makePixelTexture } from '../../shared/pixi';
import { ChatCard } from './card';
import { makePalette, PX } from './palette';
import type { Palette } from './palette';

const CARD_GAP = 10;
const MAX_CARDS = 9;

class ChatOverlay {
  private app: PIXI.Application | null = null;
  private pixelTexture: PIXI.Texture | null = null;
  private cards: ChatCard[] = [];
  private readonly userStyles = new UserStyles({
    scope: 'chat',
    accent: (msg, seed) => colorFromString(msg.color, hslToRgb(seed % 360, 0.78, 0.58)),
  });
  private readonly eventSocket = new OverlayEventSocket({
    label: 'ChatOverlay',
    onEvent: (msg) => this.spawn(msg),
    onStatus: (status) => {
      this.socketConnected = status === 'connected';
      this.updateStatusDot();
    },
  });
  private burstLayer: PIXI.ParticleContainer<PIXI.Particle> | null = null;
  private readonly burst = new ParticleBurst<PIXI.Particle>({
    gravity: 0.055,
    release: (particle) => this.burstLayer?.removeParticle(particle),
  });
  private statusDot: PIXI.Graphics | null = null;
  private socketConnected = false;

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
    app.ticker.add(({ deltaTime }) => this.tick(deltaTime));

    // Only existing cards' positions are updated on resize: their width was
    // baked in at spawn time and stays stale, which is acceptable because
    // every card expires within CARD_LIFETIME anyway.
    window.addEventListener('resize', () => {
      this.layoutCards();
      this.updateStatusDot();
    });

    // Debug-only connection indicator: a faint pixel square in the bottom-left
    // corner while the event socket is down. Gated behind ?debug=1 (the same
    // flag bootstrapOverlay uses for the spacebar test spawner) so it can never
    // appear on the composited stream output.
    if (new URLSearchParams(location.search).get('debug') === '1') {
      this.statusDot = new PIXI.Graphics();
      this.statusDot.rect(0, 0, PX * 2, PX * 2).fill({ color: 0xd8523f, alpha: 0.55 });
      app.stage.addChild(this.statusDot);
      this.updateStatusDot();
    }

    this.seedPreview();
  }

  connectWebSocket(): void {
    this.eventSocket.connect();
  }

  spawn(msg: VisualEventMsg): void {
    if (!this.app || !this.pixelTexture) return;
    const style = this.userStyles.for(msg);
    const mascotSeed = hashSeed(`mascot:${style.key}`);
    const plateSeed = this.userStyles.messageSeed(msg, style);
    const palette = makePalette(plateSeed, style.accent);
    const width = this.cardWidth();
    const card = new ChatCard(
      this.app,
      this.pixelTexture,
      msg,
      width,
      palette,
      style.seed,
      style.accent,
      mascotSeed,
      plateSeed,
    );
    this.cards.unshift(card);

    while (this.cards.length > MAX_CARDS) {
      this.cards.pop()?.destroy();
    }

    this.layoutCards();
    this.spawnBurst(card, palette, plateSeed);
  }

  private updateStatusDot(): void {
    if (!this.statusDot || !this.app) return;
    this.statusDot.visible = !this.socketConnected;
    this.statusDot.x = PX * 2;
    this.statusDot.y = this.app.screen.height - PX * 4;
  }

  private tick(delta: number): void {
    const x = this.left();
    for (let i = this.cards.length - 1; i >= 0; i--) {
      if (this.cards[i].update(delta, x)) {
        this.cards[i].destroy();
        this.cards.splice(i, 1);
        this.layoutCards();
      }
    }
    this.burst.update(delta);
  }

  private layoutCards(): void {
    if (!this.app) return;
    let y = this.app.screen.height - 24;
    const x = this.left();
    for (const card of this.cards) {
      y -= card.height;
      card.setTarget(x, y);
      y -= CARD_GAP;
    }
  }

  private cardWidth(): number {
    const screenW = this.app?.screen.width ?? window.innerWidth;
    return Math.round(clamp(screenW * 0.36, 420, 640) / PX) * PX;
  }

  private left(): number {
    const screenW = this.app?.screen.width ?? window.innerWidth;
    return screenW < 700 ? 12 : 28;
  }

  private spawnBurst(card: ChatCard, palette: Palette, seed: number): void {
    if (!this.pixelTexture || !this.burstLayer) return;
    const rng = seedRng(seed ^ 0x4c415345);
    const x = this.left() + 28 + rng() * 120;
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
      this.burst.emit(particle, {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        maxLife: 42 + rng() * 34,
      });
    }
  }

  private seedPreview(): void {
    const params = new URLSearchParams(location.search);
    if (params.get('preview') === '0') return;
    this.spawn({ event: 'chat_message', username: 'worxbend', text: 'Welcome!', color: '#ff9e88', seed: 1 });
  }
}

const overlay = new ChatOverlay();
// Each spacebar press cycles to the next synthetic event so every card
// variant (chat plus system events, redemptions included) can be checked.
const testEvents: Array<Partial<VisualEventMsg> & { event: VisualEventMsg['event'] }> = [
  { event: 'chat_message', text: 'fresh chat signal rendered as pixel-card energy' },
  { event: 'redemption', data: { reward: 'Hydrate!', cost: 500 } },
  { event: 'redemption', data: { reward: 'Song Request', cost: 1000, input: 'play something synthy' } },
  { event: 'follow' },
  { event: 'sub', data: { months: 4 } },
  { event: 'cheer', data: { bits: 300 } },
  { event: 'raid', data: { viewers: 42 } },
  { event: 'gift_sub', data: { total: 5 } },
];
let testEventIndex = 0;
bootstrapOverlay(overlay, {
  label: 'ChatOverlay',
  onTestKey: () => {
    const seed = Math.floor(Math.random() * 0xffffff);
    overlay.spawn({
      username: `viewer${seed % 97}`,
      color: `#${seed.toString(16).padStart(6, '0')}`,
      seed,
      ...testEvents[testEventIndex++ % testEvents.length],
    });
  },
});
