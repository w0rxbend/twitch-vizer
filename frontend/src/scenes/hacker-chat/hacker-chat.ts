import * as PIXI from 'pixi.js';

import {
  clamp,
  colorFromString,
  formatEventLabel,
  formatEventText,
  hashSeed,
  hslToRgb,
  messageAvatarUrl,
  mixColor,
  OverlayEventSocket,
  rgba,
  seedRng,
} from '../../shared/overlay';
import type { VisualEventMsg, VisualEventName } from '../../shared/overlay';

interface MatrixColumn {
  x: number;
  y: number;
  speed: number;
  chars: string[];
  length: number;
  phase: number;
}

interface DataSpark {
  view: PIXI.Graphics;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

interface TerminalEmote {
  name: string;
  url: string;
}

const CARD_GAP = 10;
const CARD_LIFETIME = 32 * 60;
const MAX_CARDS = 8;
const FONT = '"Courier New", "Lucida Console", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", monospace';
const MATRIX_CHARS = '01#$%&*+-/<>{}[]ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function messageText(msg: VisualEventMsg): string {
  return formatEventText(msg, 'joined the node');
}

function eventLabel(event: VisualEventName): string {
  return formatEventLabel(event, { chatLabel: 'MSG', separator: '-' });
}

function terminalParts(msg: VisualEventMsg): { text: string; emotes: TerminalEmote[] } {
  const parts = msg.parts?.filter((part) => part.type === 'text' || part.type === 'image') ?? [];
  const emotes: TerminalEmote[] = [];
  if (parts.length > 0) {
    const rendered = parts.map((part) => {
      if (part.type === 'image') {
        if (part.url) emotes.push({ name: part.name ?? 'emote', url: part.url });
        return '';
      }
      return part.text ?? '';
    }).join('');
    return { text: rendered.trim() || messageText(msg), emotes };
  }

  return {
    text: messageText(msg),
    emotes: (msg.emotes ?? [])
      .filter((emote) => emote.url)
      .map((emote) => ({ name: emote.name, url: emote.url })),
  };
}

function makePixelTexture(app: PIXI.Application): PIXI.Texture {
  const g = new PIXI.Graphics();
  g.rect(0, 0, 1, 1).fill(0xffffff);
  const texture = app.renderer.generateTexture({
    target: g,
    frame: new PIXI.Rectangle(0, 0, 1, 1),
    resolution: 1,
  });
  g.destroy();
  return texture;
}

class TerminalBackground {
  readonly view = new PIXI.Container();
  private readonly scanlines = new PIXI.Graphics();
  private readonly grid = new PIXI.Graphics();
  private readonly glyphLayer = new PIXI.Container();
  private columns: MatrixColumn[] = [];
  private glyphs: PIXI.Text[] = [];
  private elapsed = 0;

  constructor() {
    this.view.addChild(this.grid);
    this.view.addChild(this.glyphLayer);
    this.view.addChild(this.scanlines);
    this.layout(window.innerWidth, window.innerHeight);
  }

  layout(width: number, height: number): void {
    const rng = seedRng(0xdec0de);
    this.columns = [];
    this.glyphLayer.removeChildren();
    this.glyphs = [];

    const colGap = 22;
    const rows = Math.ceil(height / 16) + 8;
    for (let x = 0; x < width + colGap; x += colGap) {
      const length = 7 + Math.floor(rng() * 18);
      const chars = Array.from({ length: rows }, () => MATRIX_CHARS[Math.floor(rng() * MATRIX_CHARS.length)]);
      this.columns.push({
        x,
        y: -rng() * height,
        speed: 0.35 + rng() * 1.25,
        chars,
        length,
        phase: rng() * 60,
      });
      for (let i = 0; i < length; i++) {
        const glyph = new PIXI.Text({
          text: chars[i % chars.length],
          style: {
            fontFamily: FONT,
            fontSize: 13,
            fontWeight: '900',
            fill: 0x2eff70,
            letterSpacing: 0,
          },
        });
        glyph.alpha = 0.18;
        glyph.x = x;
        this.glyphLayer.addChild(glyph);
        this.glyphs.push(glyph);
      }
    }

    this.drawStatic(width, height);
  }

  update(delta: number, width: number, height: number): void {
    this.elapsed += delta;
    let glyphIndex = 0;
    for (const column of this.columns) {
      column.y += column.speed * delta;
      if (column.y > height + column.length * 18) {
        column.y = -column.length * 18;
      }

      for (let i = 0; i < column.length; i++) {
        const glyph = this.glyphs[glyphIndex++];
        const y = column.y - i * 16;
        glyph.x = column.x + Math.sin((this.elapsed + column.phase + i) * 0.04) * 2;
        glyph.y = y;
        glyph.alpha = clamp(0.07 + (1 - i / column.length) * 0.24, 0.04, 0.34);
        if ((Math.floor(this.elapsed + column.phase + i * 3) % 40) === 0) {
          glyph.text = MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
        }
      }
    }

    this.scanlines.alpha = 0.48 + Math.sin(this.elapsed * 0.10) * 0.08;
    this.grid.alpha = 0.22 + Math.sin(this.elapsed * 0.033) * 0.05;
    this.view.visible = width > 0 && height > 0;
  }

  private drawStatic(width: number, height: number): void {
    this.grid.clear();
    this.scanlines.clear();

    this.grid.rect(0, 0, width, height).fill(rgba(0x001207, 0.10));
    for (let x = 0; x < width; x += 48) {
      this.grid.rect(x, 0, 1, height).fill(rgba(0x21ff68, 0.08));
    }
    for (let y = 0; y < height; y += 48) {
      this.grid.rect(0, y, width, 1).fill(rgba(0x21ff68, 0.06));
    }

    for (let y = 0; y < height; y += 4) {
      this.scanlines.rect(0, y, width, 1).fill(rgba(0x001607, 0.42));
    }
    this.scanlines.rect(0, 0, width, 14).fill(rgba(0x8cff9d, 0.05));
  }
}

class HackerCard {
  readonly view = new PIXI.Container();
  readonly height: number;
  private readonly frame = new PIXI.Graphics();
  private readonly typedText: PIXI.Text;
  private readonly emoteLayer = new PIXI.Container();
  private readonly cursor = new PIXI.Graphics();
  private readonly noise = new PIXI.Graphics();
  private readonly code: string;
  private readonly emoteCount: number;
  private readonly lifetime = CARD_LIFETIME;
  private readonly userAccent: number;
  private age = 0;
  private targetY = 0;
  private positioned = false;
  private visibleChars = 0;
  private readonly charRate: number;
  private readonly width: number;
  private readonly seed: number;

  constructor(
    app: PIXI.Application,
    texture: PIXI.Texture,
    msg: VisualEventMsg,
    width: number,
    userSeed: number,
    userAccent: number,
    cardSeed: number,
  ) {
    this.width = width;
    this.seed = cardSeed;
    this.userAccent = userAccent;
    this.charRate = 1.35 + (cardSeed % 100) / 120;
    const content = terminalParts(msg);
    this.code = this.formatCode(msg, cardSeed, content.text);
    this.emoteCount = content.emotes.length;
    this.view.label = `hacker-chat:${msg.username}`;
    this.view.alpha = 0;

    const wrap = Math.max(210, width - 126);
    const fullText = new PIXI.Text({
      text: this.code,
      style: this.messageStyle(wrap),
    });
    const emoteHeight = content.emotes.length > 0 ? 34 * Math.ceil(content.emotes.length / Math.max(1, Math.floor(wrap / 34))) + 8 : 0;
    this.height = Math.max(98, Math.ceil(fullText.height + 65 + emoteHeight));
    this.emoteLayer.x = 18;
    this.emoteLayer.y = 44 + fullText.height + 7;
    this.emoteLayer.alpha = 0;
    this.makeEmoteStrip(content.emotes, wrap);
    fullText.destroy();

    const header = this.makeHeader(msg, width);
    const avatar = this.makeAvatar(texture, userSeed, userAccent, messageAvatarUrl(msg));
    this.typedText = new PIXI.Text({
      text: '',
      style: this.messageStyle(wrap),
    });
    this.typedText.x = 18;
    this.typedText.y = 44;

    avatar.x = width - 48;
    avatar.y = 18;
    header.x = 18;
    header.y = 16;

    this.view.addChild(this.frame);
    this.view.addChild(this.noise);
    this.view.addChild(header);
    this.view.addChild(this.typedText);
    this.view.addChild(this.emoteLayer);
    this.view.addChild(this.cursor);
    this.view.addChild(avatar);
    this.drawFrame(0);
    app.stage.addChild(this.view);
  }

  setTarget(x: number, y: number): void {
    this.targetY = y;
    this.view.x = x;
    if (!this.positioned) {
      this.view.y = y + 24;
      this.view.scale.set(0.98);
      this.positioned = true;
    }
  }

  update(delta: number, x: number): boolean {
    this.age += delta;
    const enter = clamp(this.age / 22, 0, 1);
    const leave = this.age > this.lifetime - 55 ? clamp((this.lifetime - this.age) / 55, 0, 1) : 1;
    const eased = 1 - Math.pow(1 - enter, 3);
    const jitter = (1 - enter) * Math.round(Math.sin(this.age * 3.7) * 5);

    this.visibleChars = Math.min(this.code.length, this.visibleChars + delta * this.charRate);
    this.typedText.text = this.code.slice(0, Math.floor(this.visibleChars));
    const emoteReveal = this.emoteCount === 0
      ? 0
      : clamp((this.visibleChars - this.code.length * 0.72) / Math.max(10, this.code.length * 0.22), 0, 1);
    this.emoteLayer.alpha = emoteReveal;
    this.emoteLayer.scale.set(0.92 + emoteReveal * 0.08);

    this.view.x = x + jitter + Math.sin(this.age * 0.07 + this.seed) * 1.2;
    this.view.y += (this.targetY - this.view.y) * 0.23 * delta;
    this.view.alpha = eased * leave;
    this.view.scale.set(0.98 + eased * 0.02 - (1 - leave) * 0.03);

    this.drawFrame(this.age);
    this.drawCursor();
    return this.age >= this.lifetime;
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }

  private formatCode(msg: VisualEventMsg, seed: number, body: string): string {
    const op = eventLabel(msg.event);
    const channel = ['stdin', 'socket', 'relay', 'node', 'daemon'][seed % 5];
    return `> recv --${channel} /${op.toLowerCase()}\n${body}`;
  }

  private messageStyle(wrap: number): Partial<PIXI.TextStyle> {
    return {
      fontFamily: FONT,
      fontSize: 16,
      fontWeight: '900',
      fill: 0xc8ffd1,
      lineHeight: 23,
      letterSpacing: 0,
      wordWrap: true,
      wordWrapWidth: wrap,
      breakWords: true,
      stroke: {
        color: 0x001804,
        width: 3,
      },
      dropShadow: {
        color: 0x26ff63,
        alpha: 0.36,
        angle: 0,
        distance: 0,
        blur: 4,
      },
    };
  }

  private makeHeader(msg: VisualEventMsg, width: number): PIXI.Container {
    const view = new PIXI.Container();
    const terminalUser = (msg.username || 'anonymous')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_') || 'anonymous';
    const label = new PIXI.Text({
      text: `${terminalUser}@twitch:~/${eventLabel(msg.event).toLowerCase()}`,
      style: {
        fontFamily: FONT,
        fontSize: 13,
        fontWeight: '900',
        fill: 0x77ff89,
        letterSpacing: 0,
      },
    });
    const tag = new PIXI.Text({
      text: `[${eventLabel(msg.event)}]`,
      style: {
        fontFamily: FONT,
        fontSize: 12,
        fontWeight: '900',
        fill: 0x2aff68,
        letterSpacing: 0,
      },
    });

    label.x = 0;
    label.y = 0;
    tag.x = Math.max(0, width - 164 - tag.width);
    tag.y = 0;
    view.addChild(label);
    view.addChild(tag);
    return view;
  }

  private makeEmoteStrip(emotes: TerminalEmote[], wrap: number): void {
    const chip = 28;
    const gap = 6;
    let x = 0;
    let y = 0;

    for (const emote of emotes) {
      if (x > 0 && x + chip > wrap) {
        x = 0;
        y += chip + gap;
      }

      const holder = new PIXI.Container();
      const frame = new PIXI.Graphics()
        .rect(0, 0, chip, chip)
        .fill(rgba(0x001804, 0.82))
        .rect(1, 1, chip - 2, chip - 2)
        .stroke({ color: 0x35ff6b, width: 1, alpha: 0.62 });
      holder.x = x;
      holder.y = y;
      holder.addChild(frame);
      this.loadEmoteImage(emote.url, holder, chip, emote.name);
      this.emoteLayer.addChild(holder);
      x += chip + gap;
    }
  }

  private loadEmoteImage(url: string, holder: PIXI.Container, size: number, name: string): void {
    PIXI.Assets.load<PIXI.Texture>({ src: url, parser: 'texture' })
      .then((texture) => {
        if ((holder as PIXI.Container & { destroyed?: boolean }).destroyed) return;
        const sprite = new PIXI.Sprite(texture);
        sprite.roundPixels = true;
        const maxSide = Math.max(sprite.width, sprite.height, 1);
        const scale = (size - 4) / maxSide;
        sprite.scale.set(scale);
        sprite.x = Math.round((size - sprite.width) / 2);
        sprite.y = Math.round((size - sprite.height) / 2);
        holder.addChild(sprite);
      })
      .catch(() => {
        const fallback = new PIXI.Text({
          text: name.slice(0, 2).toUpperCase(),
          style: {
            fontFamily: FONT,
            fontSize: 9,
            fontWeight: '900',
            fill: 0xc8ffd1,
            letterSpacing: 0,
          },
        });
        fallback.x = Math.round((size - fallback.width) / 2);
        fallback.y = Math.round((size - fallback.height) / 2);
        holder.addChild(fallback);
      });
  }

  private makeAvatar(
    texture: PIXI.Texture,
    seed: number,
    userAccent: number,
    avatarUrl?: string | null,
  ): PIXI.Container {
    const view = new PIXI.Container();
    const mask = new PIXI.Graphics().circle(16, 16, 15).fill(0xffffff);
    const fallback = new PIXI.ParticleContainer<PIXI.Particle>({
      texture,
      roundPixels: true,
      dynamicProperties: {
        position: false,
        vertex: false,
        rotation: false,
        uvs: false,
        color: false,
      },
    });
    const rng = seedRng(seed ^ 0x7091);
    const colors = [0x001804, 0x0bff51, 0x7eff99, userAccent, 0xd9ffe0];
    const particles: PIXI.Particle[] = [];
    fallback.x = 2;
    fallback.y = 2;
    fallback.mask = mask;
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const mirrorX = x > 3 ? 6 - x : x;
        const filled = rng() + mirrorX * 0.08 + y * 0.025 > 0.38;
        if (!filled) continue;
        particles.push(new PIXI.Particle({
          texture,
          x: x * 4,
          y: y * 4,
          scaleX: 4,
          scaleY: 4,
          tint: colors[Math.floor(rng() * colors.length)],
          alpha: 0.96,
        }));
      }
    }
    fallback.addParticle(...particles);
    fallback.update();
    view.addChild(mask);
    view.addChild(fallback);
    view.addChild(this.makeAvatarFrame(userAccent));

    if (avatarUrl) this.loadAvatarImage(avatarUrl, view, fallback, mask);
    return view;
  }

  private makeAvatarFrame(userAccent: number): PIXI.Graphics {
    return new PIXI.Graphics()
      .circle(16, 16, 16)
      .stroke({ color: 0x001804, width: 5, alpha: 0.9 })
      .circle(16, 16, 13)
      .stroke({ color: mixColor(0x35ff6b, userAccent, 0.32), width: 3, alpha: 0.96 })
      .rect(3, 15, 26, 1)
      .fill(rgba(0xd3ffdb, 0.30));
  }

  private loadAvatarImage(
    url: string,
    view: PIXI.Container,
    fallback: PIXI.Container,
    mask: PIXI.Graphics,
  ): void {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.referrerPolicy = 'no-referrer';

    image.onload = () => {
      if ((view as PIXI.Container & { destroyed?: boolean }).destroyed) return;
      fallback.alpha = 0;
      const sprite = new PIXI.Sprite(PIXI.Texture.from(image));
      sprite.roundPixels = true;
      const size = 30;
      const scale = size / Math.max(image.naturalWidth, image.naturalHeight, 1);
      sprite.scale.set(scale);
      sprite.x = 1 + Math.round((size - sprite.width) / 2);
      sprite.y = 1 + Math.round((size - sprite.height) / 2);
      sprite.mask = mask;
      view.addChildAt(sprite, Math.min(2, view.children.length));
    };
    image.onerror = () => {
      console.warn('[HackerChatOverlay] avatar image failed to load:', url);
      fallback.alpha = 1;
    };
    image.src = url;
  }

  private drawFrame(time: number): void {
    const g = this.frame;
    const n = this.noise;
    const w = this.width;
    const h = this.height;
    const glow = mixColor(0x26ff63, this.userAccent, 0.28);
    const pulse = 0.58 + Math.sin(time * 0.08 + this.seed) * 0.16;

    g.clear();
    g.rect(5, 5, w, h).fill(rgba(0x001104, 0.42));
    g.rect(0, 0, w, h).fill(rgba(0x000b03, 0.88));
    g.rect(2, 2, w - 4, h - 4).stroke({ color: glow, width: 2, alpha: pulse });
    g.rect(8, 8, w - 16, h - 16).stroke({ color: 0x0b6125, width: 1, alpha: 0.72 });
    g.rect(0, 0, 38, 3).fill(rgba(0xc4ffd0, 0.86));
    g.rect(44, 0, 74, 3).fill(rgba(glow, 0.64));
    g.rect(w - 92, h - 3, 88, 3).fill(rgba(glow, 0.58));
    g.rect(20, 39, w - 40, 1).fill(rgba(0x38ff6b, 0.36));
    g.rect(20, h - 14, Math.max(24, (w - 40) * clamp(this.visibleChars / this.code.length, 0, 1)), 2)
      .fill(rgba(0x9dffae, 0.62));

    n.clear();
    const rng = seedRng(this.seed ^ Math.floor(time * 13));
    for (let i = 0; i < 12; i++) {
      const y = Math.floor(rng() * h);
      const x = Math.floor(rng() * w);
      const len = 8 + rng() * 70;
      n.rect(x, y, len, 1).fill(rgba(i % 2 ? 0xc8ffd1 : glow, 0.08 + rng() * 0.12));
    }
  }

  private drawCursor(): void {
    const visible = Math.floor(this.age / 16) % 2 === 0 || this.visibleChars < this.code.length;
    const bounds = this.typedText.getLocalBounds();
    this.cursor.clear();
    if (!visible) return;

    const text = this.typedText.text;
    const lastLine = text.split('\n').pop() ?? '';
    const estimatedX = this.typedText.x + Math.min(bounds.width, Math.max(0, lastLine.length * 9.4));
    const estimatedY = this.typedText.y + Math.max(0, this.typedText.height - 20);
    this.cursor.rect(estimatedX + 3, estimatedY + 2, 9, 16).fill(rgba(0xc8ffd1, 0.82));
  }
}

class HackerChatOverlay {
  private app: PIXI.Application | null = null;
  private pixelTexture: PIXI.Texture | null = null;
  private cards: HackerCard[] = [];
  private background: TerminalBackground | null = null;
  private userAccents = new Map<string, number>();
  private messageSerial = 0;
  private readonly eventSocket = new OverlayEventSocket({
    label: 'HackerChatOverlay',
    onEvent: (msg) => this.spawn(msg),
  });
  private sparkLayer: PIXI.Container | null = null;
  private sparks: DataSpark[] = [];

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
    app.canvas.style.imageRendering = 'pixelated';

    this.app = app;
    this.pixelTexture = makePixelTexture(app);
    this.background = new TerminalBackground();
    this.sparkLayer = new PIXI.Container();
    app.stage.addChild(this.background.view);
    app.stage.addChild(this.sparkLayer);
    app.ticker.add(({ deltaTime }) => this.tick(deltaTime));

    window.addEventListener('resize', () => {
      this.background?.layout(window.innerWidth, window.innerHeight);
      this.layoutCards();
    });
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
    const cardSeed = this.nextCardSeed(msg, userKey, userSeed);
    const card = new HackerCard(
      this.app,
      this.pixelTexture,
      msg,
      this.cardWidth(),
      userSeed,
      userAccent,
      cardSeed,
    );
    this.cards.unshift(card);

    while (this.cards.length > MAX_CARDS) {
      this.cards.pop()?.destroy();
    }

    this.layoutCards();
    this.spark(card, userAccent, cardSeed);
  }

  private tick(delta: number): void {
    const width = this.app?.screen.width ?? window.innerWidth;
    const height = this.app?.screen.height ?? window.innerHeight;
    this.background?.update(delta, width, height);

    const x = this.left();
    for (let i = this.cards.length - 1; i >= 0; i--) {
      if (this.cards[i].update(delta, x)) {
        this.cards[i].destroy();
        this.cards.splice(i, 1);
        this.layoutCards();
      }
    }
    this.updateSparks(delta);
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
    const maxWidth = Math.max(300, screenW - 24);
    return Math.round(Math.min(clamp(screenW * 0.40, 430, 680), maxWidth));
  }

  private left(): number {
    const screenW = this.app?.screen.width ?? window.innerWidth;
    return screenW < 720 ? 12 : 30;
  }

  private userKey(username: string): string {
    return username.trim().toLowerCase() || 'anonymous';
  }

  private userAccent(msg: VisualEventMsg, userKey: string, userSeed: number): number {
    const existing = this.userAccents.get(userKey);
    if (existing !== undefined) return existing;
    const fallback = hslToRgb(118 + (userSeed % 42), 0.92, 0.55);
    const raw = colorFromString(msg.color, fallback);
    const accent = mixColor(raw, 0x26ff63, 0.62);
    this.userAccents.set(userKey, accent);
    return accent;
  }

  private nextCardSeed(msg: VisualEventMsg, userKey: string, userSeed: number): number {
    this.messageSerial += 1;
    return hashSeed([
      'hacker',
      userKey,
      userSeed,
      msg.event,
      msg.text ?? '',
      this.messageSerial,
      performance.now().toFixed(3),
      Math.random().toFixed(6),
    ].join(':'));
  }

  private spark(card: HackerCard, userAccent: number, seed: number): void {
    if (!this.sparkLayer) return;
    const rng = seedRng(seed ^ 0x5a5a);
    const x = this.left() + 18 + rng() * 120;
    const y = card.view.y + 16 + rng() * Math.max(30, card.height - 28);
    for (let i = 0; i < 20; i++) {
      const view = new PIXI.Graphics()
        .rect(0, 0, 3 + rng() * 16, 2)
        .fill(rgba(i % 2 ? 0xc8ffd1 : userAccent, 0.78));
      const angle = -Math.PI * 0.86 + rng() * Math.PI * 1.05;
      const speed = 1.2 + rng() * 3.4;
      view.x = x;
      view.y = y;
      this.sparkLayer.addChild(view);
      this.sparks.push({
        view,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 28 + rng() * 34,
      });
    }
  }

  private updateSparks(delta: number): void {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const spark = this.sparks[i];
      spark.life += delta;
      spark.view.x += spark.vx * delta;
      spark.view.y += spark.vy * delta;
      spark.vy += 0.018 * delta;
      spark.view.alpha = clamp(1 - spark.life / spark.maxLife, 0, 1);
      if (spark.life >= spark.maxLife) {
        spark.view.destroy();
        this.sparks.splice(i, 1);
      }
    }
  }

  private seedPreview(): void {
    const params = new URLSearchParams(location.search);
    if (params.get('preview') === '0') return;
    this.spawn({ event: 'chat_message', username: 'worxbend', text: 'Welcome!', color: '#35ff6b', seed: 1 });
  }
}

const overlay = new HackerChatOverlay();
overlay.init().then(() => {
  overlay.connectWebSocket();
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key !== ' ') return;
    const seed = Math.floor(Math.random() * 0xffffff);
    overlay.spawn({
      event: 'chat_message',
      username: `user${seed % 99}`,
      text: 'manual packet injected through keyboard',
      color: `#${seed.toString(16).padStart(6, '0')}`,
      seed,
    });
  });
});
