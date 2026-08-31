import * as PIXI from 'pixi.js';

import {
  approach,
  bootstrapOverlay,
  clamp,
  colorFromString,
  fillStyle,
  formatEventLabel,
  formatEventText,
  hashSeed,
  hslToRgb,
  luminance,
  mixColor,
  OverlayEventSocket,
  ParticleBurst,
  renderParts as renderMessageParts,
  seedRng,
  UserStyles,
} from '../../shared/overlay';
import type { MessagePart, VisualEventMsg } from '../../shared/overlay';
import { layoutMessageParts } from '../../shared/message-layout';
import { createOverlayApp, loadAvatarImage } from '../../shared/pixi';
import { BlobMascot } from './blob-mascot';
import { WobblyBlob } from './blob';
import type { FluidPalette } from './blob';

const CARD_GAP = 13;
// Ages and lifetimes throughout this scene are in PIXI ticker deltaTime units,
// i.e. frames at the 60fps reference rate: 30 * 60 frames ~= 30 seconds.
const CARD_LIFETIME_FRAMES = 30 * 60;
const MAX_CARDS = 7;

function makePalette(seed: number, userAccent: number): FluidPalette {
  const rng = seedRng(seed ^ 0xb10bd00d);
  const hue = Math.floor(rng() * 360);
  const accentHue = hue + 30 + rng() * 90;
  const coolHue = hue + 142 + rng() * 58;
  const warmHue = hue - 56 + rng() * 42;
  const skin = mixColor(userAccent, hslToRgb(accentHue, 0.86, 0.62), 0.35);
  const skin2 = hslToRgb(coolHue, 0.72, 0.58 + rng() * 0.12);
  const warm = hslToRgb(warmHue, 0.88, 0.62);
  const cool = hslToRgb(coolHue + 38, 0.78, 0.68);
  const deep = mixColor(hslToRgb(hue + 12, 0.52, 0.14), userAccent, 0.18);
  const ink = luminance(skin) > 0.58 ? 0x10131a : 0xf8fff4;
  return {
    deep,
    skin,
    skin2,
    accent: mixColor(userAccent, 0xffffff, 0.12),
    warm,
    cool,
    ink,
    foam: mixColor(0xffffff, cool, 0.18),
  };
}

function messageText(msg: VisualEventMsg): string {
  return formatEventText(msg, 'joined the stream');
}

function renderParts(msg: VisualEventMsg): MessagePart[] {
  return renderMessageParts(msg, messageText(msg));
}

// Horizontal card layout: [mascot slot | text column | avatar], with the text
// column wrapping just short of the avatar. All values in px.
const CARD_LAYOUT = {
  avatarSize: 38,
  avatarRightPad: 28,
  mascotSlot: 74,
  textPad: 18, // gap on both sides of the text column
  minWrap: 190,
  headerY: 18,
  tagY: 24,
  contentY: 47,
  verticalChrome: 68, // header + padding above/below the message content
  minHeight: 94,
} as const;

class ChatCard {
  readonly view = new PIXI.Container();
  readonly height: number;
  private readonly lifetime = CARD_LIFETIME_FRAMES;
  private age = 0;
  private targetY = 0;
  private positioned = false;
  private readonly blob: WobblyBlob;
  private readonly mascot: BlobMascot;
  private disposeAvatar?: () => void;

  constructor(
    msg: VisualEventMsg,
    width: number,
    palette: FluidPalette,
    userSeed: number,
    userAccent: number,
    mascotSeed: number,
    plateSeed: number,
  ) {
    this.view.label = `fluid-chat:${msg.username}`;
    this.view.alpha = 0;

    const L = CARD_LAYOUT;
    const avatarX = width - L.avatarRightPad - L.avatarSize;
    const textX = L.mascotSlot + L.textPad;
    const wrap = Math.max(L.minWrap, avatarX - textX - L.textPad);
    const content = this.makeMessageContent(msg, palette, wrap);

    this.height = Math.max(L.minHeight, Math.ceil(content.height + L.verticalChrome));
    this.blob = new WobblyBlob(width, this.height, palette, plateSeed);
    this.mascot = new BlobMascot(palette, userAccent, mascotSeed);
    const name = this.makeNameText(msg, palette);
    const tag = this.makeTagText(msg, palette);
    const avatar = this.makeAvatar(userSeed, palette, userAccent, msg.avatarUrl);

    this.mascot.view.x = 14;
    this.mascot.view.y = Math.max(22, this.height - 72);
    name.x = textX;
    name.y = L.headerY;
    tag.x = Math.max(textX, avatarX - tag.width - 12);
    tag.y = L.tagY;
    content.x = textX;
    content.y = L.contentY;
    avatar.x = avatarX;
    avatar.y = Math.round((this.height - L.avatarSize) / 2);

    this.view.addChild(this.blob.view);
    this.view.addChild(this.mascot.view);
    this.view.addChild(name);
    this.view.addChild(tag);
    this.view.addChild(content);
    this.view.addChild(avatar);
  }

  private makeNameText(msg: VisualEventMsg, palette: FluidPalette): PIXI.Text {
    return new PIXI.Text({
      text: msg.username || 'anonymous',
      style: {
        fontFamily: '"Trebuchet MS", "Avenir Next", "Segoe UI", sans-serif',
        fontSize: 19,
        fontWeight: '900',
        fill: palette.foam,
        letterSpacing: 0,
        stroke: { color: 0x05060b, width: 4 },
        dropShadow: { color: 0x000000, alpha: 0.45, distance: 2, blur: 4 },
      },
    });
  }

  private makeTagText(msg: VisualEventMsg, palette: FluidPalette): PIXI.Text {
    return new PIXI.Text({
      text: formatEventLabel(msg.event),
      style: {
        fontFamily: '"Trebuchet MS", "Avenir Next", "Segoe UI", sans-serif',
        fontSize: 11,
        fontWeight: '900',
        fill: palette.warm,
        letterSpacing: 0,
        stroke: { color: 0x05060b, width: 2 },
      },
    });
  }

  setTarget(x: number, y: number): void {
    this.targetY = y;
    this.view.x = x;
    if (!this.positioned) {
      this.view.y = y + 28;
      this.view.scale.set(0.96);
      this.positioned = true;
    }
  }

  update(delta: number, x: number): boolean {
    this.age += delta;
    const enter = clamp(this.age / 26, 0, 1);
    const leave = this.age > this.lifetime - 70 ? clamp((this.lifetime - this.age) / 70, 0, 1) : 1;
    const eased = 1 - Math.pow(1 - enter, 3);
    const wobble = Math.sin(this.age * 0.032) * 2.5;

    this.view.x = approach(this.view.x, x + wobble, 0.22, delta);
    this.view.y = approach(this.view.y, this.targetY, 0.18, delta);
    this.view.alpha = eased * leave;
    this.view.scale.set(0.96 + eased * 0.04 - (1 - leave) * 0.05);
    this.blob.update(delta);
    this.mascot.update(delta);
    return this.age >= this.lifetime;
  }

  destroy(): void {
    this.view.destroy({ children: true });
    this.disposeAvatar?.();
  }

  private makeMessageContent(msg: VisualEventMsg, palette: FluidPalette, wrap: number): PIXI.Container {
    return layoutMessageParts(renderParts(msg), {
      wrap,
      textStyle: {
        fontFamily: '"Trebuchet MS", "Avenir Next", "Segoe UI", sans-serif',
        fontSize: 18,
        fontWeight: '800',
        fill: 0xffffff,
        lineHeight: 25,
        letterSpacing: 0,
        stroke: { color: 0x04050b, width: 3 },
        dropShadow: { color: 0x000000, alpha: 0.28, distance: 1, blur: 3 },
      },
      imageSize: 25,
      gap: 5,
      lineHeight: 26,
      imageInset: 3,
      makeImageBacking: (size) => new PIXI.Graphics()
        .circle(size / 2, size / 2, size / 2)
        .fill(fillStyle(palette.foam, 0.18))
        .stroke({ color: palette.foam, width: 1.5, alpha: 0.42 }),
      fallbackTextStyle: {
        fontFamily: '"Trebuchet MS", sans-serif',
        fontSize: 14,
        fontWeight: '900',
        fill: 0xffffff,
        letterSpacing: 0,
      },
      emptyText: messageText(msg),
    });
  }

  private makeAvatar(
    seed: number,
    palette: FluidPalette,
    userColor: number,
    avatarUrl?: string | null,
  ): PIXI.Container {
    const view = new PIXI.Container();
    const fallback = new PIXI.Graphics();
    const ring = this.avatarRing(palette, userColor);
    const rng = seedRng(seed ^ 0xfaceb10b);
    fallback.circle(19, 19, 19).fill(fillStyle(mixColor(userColor, palette.deep, 0.24), 0.96));
    fallback.circle(16 + rng() * 6, 14 + rng() * 5, 8).fill(fillStyle(palette.foam, 0.30));
    fallback.circle(23, 23, 10).fill(fillStyle(palette.warm, 0.22));
    view.addChild(fallback);
    view.addChild(ring);

    if (avatarUrl) {
      this.disposeAvatar = loadAvatarImage(avatarUrl, view, fallback, {
        size: CARD_LAYOUT.avatarSize,
        addAtIndex: 1,
        roundPixels: false,
        label: 'FluidChatOverlay',
      });
    }
    return view;
  }

  private avatarRing(palette: FluidPalette, userColor: number): PIXI.Graphics {
    return new PIXI.Graphics()
      .circle(19, 19, 20)
      .stroke({ color: 0x05060b, width: 5, alpha: 0.58 })
      .circle(19, 19, 18)
      .stroke({ color: mixColor(palette.foam, userColor, 0.26), width: 2.5, alpha: 0.96 })
      .circle(13, 10, 3)
      .fill(fillStyle(0xffffff, 0.58));
  }
}

class FluidChatOverlay {
  private app: PIXI.Application | null = null;
  private cards: ChatCard[] = [];
  private readonly userStyles = new UserStyles({
    scope: 'fluid',
    accent: (msg, seed) => colorFromString(msg.color, hslToRgb(seed % 360, 0.72, 0.60)),
  });
  private readonly eventSocket = new OverlayEventSocket({
    label: 'FluidChatOverlay',
    onEvent: (msg) => this.spawn(msg),
  });
  private burstLayer: PIXI.Container | null = null;
  private readonly burstPool = new ParticleBurst<PIXI.Graphics>({
    gravity: 0.030,
    release: (view) => view.destroy(),
    onUpdate: (item, remaining) => item.body.scale.set(0.70 + (1 - remaining) * 1.15),
  });

  async init(): Promise<void> {
    const app = await createOverlayApp({ antialias: true });

    this.app = app;
    this.burstLayer = new PIXI.Container();
    app.stage.addChild(this.burstLayer);
    app.ticker.add(({ deltaTime }) => this.tick(deltaTime));

    window.addEventListener('resize', () => this.layoutCards());
    this.seedPreview();
  }

  connectWebSocket(): void {
    this.eventSocket.connect();
  }

  spawn(msg: VisualEventMsg): void {
    if (!this.app) return;
    const style = this.userStyles.for(msg);
    const plateSeed = this.userStyles.messageSeed(msg, style);
    const palette = makePalette(plateSeed, style.accent);
    const width = this.cardWidth();
    const card = new ChatCard(
      msg,
      width,
      palette,
      style.seed,
      style.accent,
      hashSeed(`fluid-mascot:${style.key}`),
      plateSeed,
    );
    this.app.stage.addChild(card.view);
    this.cards.unshift(card);

    while (this.cards.length > MAX_CARDS) {
      this.cards.pop()?.destroy();
    }

    this.layoutCards();
    this.burst(card, palette, plateSeed);
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
    this.burstPool.update(delta);
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
    const maxWidth = Math.max(280, screenW - 24);
    return Math.round(Math.min(clamp(screenW * 0.39, 430, 690), maxWidth));
  }

  private left(): number {
    const screenW = this.app?.screen.width ?? window.innerWidth;
    return screenW < 720 ? 12 : 30;
  }

  private burst(card: ChatCard, palette: FluidPalette, seed: number): void {
    if (!this.burstLayer) return;
    const rng = seedRng(seed ^ 0x57e11a);
    const x = this.left() + 44 + rng() * 128;
    const y = card.view.y + 20 + rng() * Math.max(38, card.height - 26);
    const colors = [palette.skin, palette.skin2, palette.warm, palette.cool, palette.foam];

    for (let i = 0; i < 16; i++) {
      const speed = 1.0 + rng() * 2.7;
      const angle = -Math.PI * 0.9 + rng() * Math.PI * 1.0;
      const radius = 3 + rng() * 10;
      const color = colors[Math.floor(rng() * colors.length)];
      const view = new PIXI.Graphics()
        .circle(0, 0, radius)
        .fill(fillStyle(color, 0.58));
      view.x = x;
      view.y = y;
      this.burstLayer.addChild(view);
      this.burstPool.emit(view, {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        maxLife: 48 + rng() * 44,
      });
    }
  }

  private seedPreview(): void {
    const params = new URLSearchParams(location.search);
    if (params.get('preview') === '0') return;
    this.spawn({ event: 'chat_message', username: 'worxbend', text: 'Welcome!', color: '#ff8aa3', seed: 1 });
  }
}

const overlay = new FluidChatOverlay();

// Spacebar test events cycle through every event shape the scene can receive,
// so each press exercises a different card layout.
const TEST_EVENTS: Array<Pick<VisualEventMsg, 'event' | 'text' | 'data'>> = [
  { event: 'chat_message', text: 'fresh chat rendered as soft-body blob motion' },
  { event: 'follow' },
  { event: 'sub', data: { months: 7 } },
  { event: 'cheer', data: { bits: 500 } },
  { event: 'raid', data: { viewers: 42 } },
  { event: 'gift_sub', data: { total: 5 } },
  { event: 'redemption', data: { reward: 'Hydrate!', cost: 250, input: 'stay moist' } },
];
let testEventIndex = 0;

bootstrapOverlay(overlay, {
  label: 'FluidChatOverlay',
  onTestKey: () => {
    const seed = Math.floor(Math.random() * 0xffffff);
    const base = TEST_EVENTS[testEventIndex % TEST_EVENTS.length];
    testEventIndex += 1;
    overlay.spawn({
      ...base,
      username: `viewer${seed % 97}`,
      color: `#${seed.toString(16).padStart(6, '0')}`,
      seed,
    });
  },
});
