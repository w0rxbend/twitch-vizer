import * as PIXI from 'pixi.js';

import { fitDisplayObject, loadEmoteDisplay } from '../../shared/emote-images';
import {
  approach,
  bootstrapOverlay,
  clamp,
  colorFromString,
  fillStyle,
  formatEventLabel,
  formatEventText,
  hslToRgb,
  mixColor,
  OverlayEventSocket,
  ParticleBurst,
  renderParts,
  seedRng,
  UserStyles,
} from '../../shared/overlay';
import type { EmoteItem, VisualEventMsg, VisualEventName } from '../../shared/overlay';
import {
  createOverlayApp,
  loadAvatarImage,
  makePixelTexture,
  makeStaticParticleContainer,
} from '../../shared/pixi';

interface MatrixColumn {
  x: number;
  y: number;
  speed: number;
  chars: string[];
  length: number;
  phase: number;
  glyphs: PIXI.Text[];
}

const CARD_GAP = 10;
// Ticker deltaTime units, i.e. frames at the 60fps PIXI ticker baseline:
// 32 * 60 frames = 32 seconds on screen.
const CARD_LIFETIME = 32 * 60;
const MAX_CARDS = 8;
const FONT = '"Courier New", "Lucida Console", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", monospace';
const MATRIX_CHARS = '01#$%&*+-/<>{}[]ABCDEFGHIJKLMNOPQRSTUVWXYZ';
// Channel-points purple (#9147ff) pulled toward the terminal green so
// redemption cards stand out without leaving the scene's palette.
const REDEMPTION_ACCENT = mixColor(0x9147ff, 0x26ff63, 0.30);

function messageText(msg: VisualEventMsg): string {
  return formatEventText(msg, 'joined the node');
}

function eventLabel(event: VisualEventName): string {
  return formatEventLabel(event, { chatLabel: 'MSG', separator: '-' });
}

function terminalParts(msg: VisualEventMsg): { text: string; emotes: EmoteItem[] } {
  const emotes: EmoteItem[] = [];
  let text = '';
  // Emotes are drawn as a sprite strip below the message, so image parts
  // contribute nothing to the typed-out text.
  for (const part of renderParts(msg, messageText(msg))) {
    if (part.type === 'image') {
      if (part.url || part.animatedUrl) {
        emotes.push({
          name: part.name ?? 'emote',
          url: part.url ?? '',
          animatedUrl: part.animatedUrl,
          staticUrl: part.staticUrl,
        });
      }
    } else {
      text += part.text ?? '';
    }
  }
  return { text: text.trim() || messageText(msg), emotes };
}

class TerminalBackground {
  readonly view = new PIXI.Container();
  private readonly scanlines = new PIXI.Graphics();
  private readonly grid = new PIXI.Graphics();
  private readonly glyphLayer = new PIXI.Container();
  private columns: MatrixColumn[] = [];
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
    for (const glyph of this.glyphLayer.removeChildren()) {
      glyph.destroy();
    }

    const colGap = 22;
    const rows = Math.ceil(height / 16) + 8;
    for (let x = 0; x < width + colGap; x += colGap) {
      const length = 7 + Math.floor(rng() * 18);
      const chars = Array.from({ length: rows }, () => MATRIX_CHARS[Math.floor(rng() * MATRIX_CHARS.length)]);
      const column: MatrixColumn = {
        x,
        y: -rng() * height,
        speed: 0.35 + rng() * 1.25,
        chars,
        length,
        phase: rng() * 60,
        glyphs: [],
      };
      this.columns.push(column);
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
        column.glyphs.push(glyph);
      }
    }

    this.drawStatic(width, height);
  }

  update(delta: number, height: number): void {
    this.elapsed += delta;
    for (const column of this.columns) {
      column.y += column.speed * delta;
      if (column.y > height + column.length * 18) {
        column.y = -column.length * 18;
      }

      column.glyphs.forEach((glyph, i) => {
        glyph.x = column.x + Math.sin((this.elapsed + column.phase + i) * 0.04) * 2;
        glyph.y = column.y - i * 16;
        glyph.alpha = clamp(0.07 + (1 - i / column.length) * 0.24, 0.04, 0.34);
        if ((Math.floor(this.elapsed + column.phase + i * 3) % 40) === 0) {
          glyph.text = MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
        }
      });
    }

    this.scanlines.alpha = 0.48 + Math.sin(this.elapsed * 0.10) * 0.08;
    this.grid.alpha = 0.22 + Math.sin(this.elapsed * 0.033) * 0.05;
  }

  private drawStatic(width: number, height: number): void {
    this.grid.clear();
    this.scanlines.clear();

    this.grid.rect(0, 0, width, height).fill(fillStyle(0x001207, 0.10));
    for (let x = 0; x < width; x += 48) {
      this.grid.rect(x, 0, 1, height).fill(fillStyle(0x21ff68, 0.08));
    }
    for (let y = 0; y < height; y += 48) {
      this.grid.rect(0, y, width, 1).fill(fillStyle(0x21ff68, 0.06));
    }

    for (let y = 0; y < height; y += 4) {
      this.scanlines.rect(0, y, width, 1).fill(fillStyle(0x001607, 0.42));
    }
    this.scanlines.rect(0, 0, width, 14).fill(fillStyle(0x8cff9d, 0.05));
  }
}

class HackerCard {
  private static readonly EMOTE_CHIP = 28;
  private static readonly EMOTE_GAP = 6;

  readonly view = new PIXI.Container();
  readonly height: number;
  private readonly backdrop = new PIXI.Graphics();
  private readonly chrome = new PIXI.Graphics();
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
  private readonly charAdvance: number;
  private readonly charRate: number;
  private readonly width: number;
  private readonly seed: number;
  private disposeAvatar?: () => void;

  constructor(
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
    // The monospace glyph advance, measured from the actual style (as the
    // width added by one extra character, so stroke padding cancels out),
    // used to position the typing cursor after the last visible character.
    const style = new PIXI.TextStyle(this.messageStyle(wrap));
    this.charAdvance = PIXI.CanvasTextMetrics.measureText('MM', style).width
      - PIXI.CanvasTextMetrics.measureText('M', style).width;
    const emoteHeight = this.emoteStripHeight(content.emotes.length, wrap);
    this.height = Math.max(98, Math.ceil(fullText.height + 65 + emoteHeight));
    this.emoteLayer.x = 18;
    this.emoteLayer.y = 44 + fullText.height + 7;
    this.emoteLayer.alpha = 0;
    this.makeEmoteStrip(content.emotes, wrap);
    fullText.destroy();

    const header = this.makeHeader(msg, width);
    const avatar = this.makeAvatar(texture, userSeed, userAccent, msg.avatarUrl);
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

    this.view.addChild(this.backdrop);
    this.view.addChild(this.frame);
    this.view.addChild(this.chrome);
    this.view.addChild(this.noise);
    this.view.addChild(header);
    this.view.addChild(this.typedText);
    this.view.addChild(this.emoteLayer);
    this.view.addChild(this.cursor);
    this.view.addChild(avatar);
    this.drawChrome();
    this.drawFrame(0);
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
    this.view.y = approach(this.view.y, this.targetY, 0.23, delta);
    this.view.alpha = eased * leave;
    this.view.scale.set(0.98 + eased * 0.02 - (1 - leave) * 0.03);

    this.drawFrame(this.age);
    this.drawCursor();
    return this.age >= this.lifetime;
  }

  destroy(): void {
    this.view.destroy({ children: true });
    this.disposeAvatar?.();
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

  private emoteStripHeight(count: number, wrap: number): number {
    if (count === 0) return 0;
    const slot = HackerCard.EMOTE_CHIP + HackerCard.EMOTE_GAP;
    const perRow = Math.max(1, Math.floor(wrap / slot));
    const rows = Math.ceil(count / perRow);
    return rows * slot + 8;
  }

  private makeEmoteStrip(emotes: EmoteItem[], wrap: number): void {
    const chip = HackerCard.EMOTE_CHIP;
    const gap = HackerCard.EMOTE_GAP;
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
        .fill(fillStyle(0x001804, 0.82))
        .rect(1, 1, chip - 2, chip - 2)
        .stroke({ color: 0x35ff6b, width: 1, alpha: 0.62 });
      holder.x = x;
      holder.y = y;
      holder.addChild(frame);
      this.loadEmoteImage(emote, holder, chip);
      this.emoteLayer.addChild(holder);
      x += chip + gap;
    }
  }

  private loadEmoteImage(emote: EmoteItem, holder: PIXI.Container, size: number): void {
    loadEmoteDisplay(emote)
      .then((sprite) => {
        if (holder.destroyed) return;
        (sprite as PIXI.Container & { roundPixels?: boolean }).roundPixels = true;
        fitDisplayObject(sprite, size - 4);
        sprite.x += 2;
        sprite.y += 2;
        holder.addChild(sprite);
      })
      .catch(() => {
        const fallback = new PIXI.Text({
          text: emote.name.slice(0, 2).toUpperCase(),
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
    const fallback = makeStaticParticleContainer(texture);
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

    if (avatarUrl) {
      this.disposeAvatar = loadAvatarImage(avatarUrl, view, fallback, {
        size: 30,
        offset: 1,
        mask,
        addAtIndex: 2,
        label: 'HackerChatOverlay',
      });
    }
    return view;
  }

  private makeAvatarFrame(userAccent: number): PIXI.Graphics {
    return new PIXI.Graphics()
      .circle(16, 16, 16)
      .stroke({ color: 0x001804, width: 5, alpha: 0.9 })
      .circle(16, 16, 13)
      .stroke({ color: mixColor(0x35ff6b, userAccent, 0.32), width: 3, alpha: 0.96 })
      .rect(3, 15, 26, 1)
      .fill(fillStyle(0xd3ffdb, 0.30));
  }

  /**
   * Static card chrome, drawn once (backdrop below the pulse border, strokes
   * and bars above it). drawFrame handles only the animated parts.
   */
  private drawChrome(): void {
    const w = this.width;
    const h = this.height;
    const glow = mixColor(0x26ff63, this.userAccent, 0.28);

    this.backdrop.rect(5, 5, w, h).fill(fillStyle(0x001104, 0.42));
    this.backdrop.rect(0, 0, w, h).fill(fillStyle(0x000b03, 0.88));

    const g = this.chrome;
    g.rect(8, 8, w - 16, h - 16).stroke({ color: 0x0b6125, width: 1, alpha: 0.72 });
    g.rect(0, 0, 38, 3).fill(fillStyle(0xc4ffd0, 0.86));
    g.rect(44, 0, 74, 3).fill(fillStyle(glow, 0.64));
    g.rect(w - 92, h - 3, 88, 3).fill(fillStyle(glow, 0.58));
    g.rect(20, 39, w - 40, 1).fill(fillStyle(0x38ff6b, 0.36));
  }

  private drawFrame(time: number): void {
    const n = this.noise;
    const w = this.width;
    const h = this.height;
    const glow = mixColor(0x26ff63, this.userAccent, 0.28);
    const pulse = 0.58 + Math.sin(time * 0.08 + this.seed) * 0.16;

    this.frame.clear();
    this.frame.rect(2, 2, w - 4, h - 4).stroke({ color: glow, width: 2, alpha: pulse });

    n.clear();
    n.rect(20, h - 14, Math.max(24, (w - 40) * clamp(this.visibleChars / this.code.length, 0, 1)), 2)
      .fill(fillStyle(0x9dffae, 0.62));
    const rng = seedRng(this.seed ^ Math.floor(time * 13));
    for (let i = 0; i < 12; i++) {
      const y = Math.floor(rng() * h);
      const x = Math.floor(rng() * w);
      const len = 8 + rng() * 70;
      n.rect(x, y, len, 1).fill(fillStyle(i % 2 ? 0xc8ffd1 : glow, 0.08 + rng() * 0.12));
    }
  }

  private drawCursor(): void {
    const visible = Math.floor(this.age / 16) % 2 === 0 || this.visibleChars < this.code.length;
    const bounds = this.typedText.getLocalBounds();
    this.cursor.clear();
    if (!visible) return;

    const text = this.typedText.text;
    const lastLine = text.split('\n').pop() ?? '';
    const estimatedX = this.typedText.x + Math.min(bounds.width, Math.max(0, lastLine.length * this.charAdvance));
    const estimatedY = this.typedText.y + Math.max(0, this.typedText.height - 20);
    this.cursor.rect(estimatedX + 3, estimatedY + 2, 9, 16).fill(fillStyle(0xc8ffd1, 0.82));
  }
}

class HackerChatOverlay {
  private app: PIXI.Application | null = null;
  private pixelTexture: PIXI.Texture | null = null;
  private cards: HackerCard[] = [];
  private background: TerminalBackground | null = null;
  private readonly userStyles = new UserStyles({
    scope: 'hacker',
    accent: (msg, seed) => mixColor(
      colorFromString(msg.color, hslToRgb(118 + (seed % 42), 0.92, 0.55)),
      0x26ff63,
      0.62,
    ),
  });
  private readonly eventSocket = new OverlayEventSocket({
    label: 'HackerChatOverlay',
    onEvent: (msg) => this.spawn(msg),
  });
  private sparkLayer: PIXI.Container | null = null;
  private readonly sparks = new ParticleBurst<PIXI.Graphics>({
    gravity: 0.018,
    release: (view) => view.destroy(),
  });
  private resizeFrame = 0;

  async init(): Promise<void> {
    const app = await createOverlayApp({
      antialias: false,
      resolution: 1,
      roundPixels: true,
    });
    app.canvas.style.imageRendering = 'pixelated';

    this.app = app;
    this.pixelTexture = makePixelTexture(app);
    this.background = new TerminalBackground();
    this.sparkLayer = new PIXI.Container();
    app.stage.addChild(this.background.view);
    app.stage.addChild(this.sparkLayer);
    app.ticker.add(({ deltaTime }) => this.tick(deltaTime));

    // A window drag fires resize continuously and every layout() rebuilds
    // hundreds of Text objects, so relayout at most once per painted frame.
    window.addEventListener('resize', () => {
      cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = requestAnimationFrame(() => {
        this.background?.layout(window.innerWidth, window.innerHeight);
        this.layoutCards();
      });
    });
    this.seedPreview();
  }

  connectWebSocket(): void {
    this.eventSocket.connect();
  }

  spawn(msg: VisualEventMsg): void {
    if (!this.app || !this.pixelTexture) return;
    const style = this.userStyles.for(msg);
    const userAccent = msg.event === 'redemption' ? REDEMPTION_ACCENT : style.accent;
    const cardSeed = this.userStyles.messageSeed(msg, style);
    const card = new HackerCard(
      this.pixelTexture,
      msg,
      this.cardWidth(),
      style.seed,
      userAccent,
      cardSeed,
    );
    this.app.stage.addChild(card.view);
    this.cards.unshift(card);

    while (this.cards.length > MAX_CARDS) {
      this.cards.pop()?.destroy();
    }

    this.layoutCards();
    this.spark(card, userAccent, cardSeed);
  }

  private tick(delta: number): void {
    const height = this.app?.screen.height ?? window.innerHeight;
    this.background?.update(delta, height);

    const x = this.left();
    for (let i = this.cards.length - 1; i >= 0; i--) {
      if (this.cards[i].update(delta, x)) {
        this.cards[i].destroy();
        this.cards.splice(i, 1);
        this.layoutCards();
      }
    }
    this.sparks.update(delta);
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

  private spark(card: HackerCard, userAccent: number, seed: number): void {
    if (!this.sparkLayer) return;
    const rng = seedRng(seed ^ 0x5a5a);
    const x = this.left() + 18 + rng() * 120;
    const y = card.view.y + 16 + rng() * Math.max(30, card.height - 28);
    for (let i = 0; i < 20; i++) {
      const view = new PIXI.Graphics()
        .rect(0, 0, 3 + rng() * 16, 2)
        .fill(fillStyle(i % 2 ? 0xc8ffd1 : userAccent, 0.78));
      const angle = -Math.PI * 0.86 + rng() * Math.PI * 1.05;
      const speed = 1.2 + rng() * 3.4;
      view.x = x;
      view.y = y;
      this.sparkLayer.addChild(view);
      this.sparks.emit(view, {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        maxLife: 28 + rng() * 34,
      });
    }
  }

  private seedPreview(): void {
    const params = new URLSearchParams(location.search);
    if (params.get('preview') === '0') return;
    this.spawn({ event: 'chat_message', username: 'worxbend', text: 'Welcome!', color: '#35ff6b', seed: 1 });
  }
}

const overlay = new HackerChatOverlay();
// Spacebar cycles through synthetic events so every card variant can be
// inspected without a live backend.
const TEST_EVENTS: Array<Pick<VisualEventMsg, 'event' | 'text' | 'data'>> = [
  { event: 'chat_message', text: 'manual packet injected through keyboard' },
  { event: 'redemption', data: { reward: 'Hydrate!', cost: 500, input: 'stay hydrated' } },
  { event: 'redemption', data: { reward: 'First!', cost: 100 } },
];
let testEventIndex = 0;
bootstrapOverlay(overlay, {
  label: 'HackerChatOverlay',
  onTestKey: () => {
    const seed = Math.floor(Math.random() * 0xffffff);
    overlay.spawn({
      ...TEST_EVENTS[testEventIndex++ % TEST_EVENTS.length],
      username: `user${seed % 99}`,
      color: `#${seed.toString(16).padStart(6, '0')}`,
      seed,
    });
  },
});
