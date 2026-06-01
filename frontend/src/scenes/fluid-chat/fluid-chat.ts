import * as PIXI from 'pixi.js';

declare global {
  interface Window {
    VIZER_WS_URL?: string;
  }
}

type VisualEventName = 'chat_message' | 'follow' | 'sub' | 'cheer' | 'raid' | 'gift_sub';

interface EmoteItem {
  name: string;
  url: string;
}

interface MessagePart {
  type: 'text' | 'image';
  text?: string;
  name?: string;
  url?: string;
}

interface VisualEventMsg {
  event: VisualEventName;
  username: string;
  text?: string;
  color?: string;
  seed?: number;
  avatar_url?: string | null;
  avatarUrl?: string | null;
  emotes?: EmoteItem[];
  parts?: MessagePart[];
  data?: {
    bits?: number;
    viewers?: number;
    total?: number;
    tier?: string;
    months?: number;
  };
}

interface FluidPalette {
  deep: number;
  skin: number;
  skin2: number;
  accent: number;
  warm: number;
  cool: number;
  ink: number;
  foam: number;
}

interface BlobPoint {
  angle: number;
  rx: number;
  ry: number;
  phase: number;
  speed: number;
  amp: number;
}

interface BlobParticle {
  view: PIXI.Graphics;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  radius: number;
  color: number;
}

const CARD_GAP = 13;
const CARD_LIFETIME = 30 * 60;
const MAX_CARDS = 7;
const TAU = Math.PI * 2;

function seedRng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function colorFromString(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const normalized = value.startsWith('#') ? value.slice(1) : value;
  const parsed = Number.parseInt(normalized, 16);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hslToRgb(h: number, s: number, l: number): number {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  return ((Math.round((r + m) * 255) << 16)
    | (Math.round((g + m) * 255) << 8)
    | Math.round((b + m) * 255));
}

function mixColor(a: number, b: number, t: number): number {
  const clamped = clamp(t, 0, 1);
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  return ((Math.round(ar + (br - ar) * clamped) << 16)
    | (Math.round(ag + (bg - ag) * clamped) << 8)
    | Math.round(ab + (bb - ab) * clamped));
}

function rgba(color: number, alpha: number): { color: number; alpha: number } {
  return { color, alpha };
}

function luminance(color: number): number {
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

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

function defaultWebSocketUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = location.host || 'localhost:8080';
  return `${proto}//${host}/ws`;
}

function normalizeWebSocketUrl(rawUrl: string | null | undefined): string {
  const value = rawUrl?.trim();
  if (!value) return defaultWebSocketUrl();

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (value.startsWith('/')) {
    const host = location.host || 'localhost:8080';
    return `${proto}//${host}${value}`;
  }

  const url = new URL(/^(https?|wss?):\/\//.test(value) ? value : `${proto}//${value}`);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.pathname === '/') url.pathname = '/ws';
  return url.toString();
}

function getWebSocketUrl(): string {
  const params = new URLSearchParams(location.search);
  return normalizeWebSocketUrl(
    params.get('ws') ?? params.get('wsUrl') ?? window.VIZER_WS_URL,
  );
}

function messageText(msg: VisualEventMsg): string {
  if (msg.event === 'chat_message') return msg.text?.trim() || '...';
  if (msg.event === 'follow') return 'joined the stream';
  if (msg.event === 'sub') {
    const months = msg.data?.months;
    return months ? `subscribed for ${months} months` : 'subscribed';
  }
  if (msg.event === 'gift_sub') {
    const total = msg.data?.total ?? 1;
    return `gifted ${total} subscription${total === 1 ? '' : 's'}`;
  }
  if (msg.event === 'cheer') return `cheered ${msg.data?.bits ?? 0} bits`;
  return `raided with ${msg.data?.viewers ?? 0} viewers`;
}

function renderParts(msg: VisualEventMsg): MessagePart[] {
  const incoming = msg.parts?.filter((part) => part.type === 'text' || part.type === 'image') ?? [];
  if (incoming.length > 0) return incoming;

  const fallback: MessagePart[] = [{ type: 'text', text: messageText(msg) }];
  for (const emote of msg.emotes ?? []) {
    if (emote.url) fallback.push({ type: 'image', name: emote.name, url: emote.url });
  }
  return fallback;
}

function messageAvatarUrl(msg: VisualEventMsg): string | null {
  return msg.avatar_url ?? msg.avatarUrl ?? null;
}

function eventLabel(event: VisualEventName): string {
  return event === 'chat_message' ? 'CHAT' : event.replace('_', ' ').toUpperCase();
}

function smoothClosedBlob(
  g: PIXI.Graphics,
  points: { x: number; y: number }[],
  fill: number | { color: number; alpha: number },
  stroke?: { color: number; alpha: number; width: number },
): void {
  if (points.length < 3) return;
  g.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const previous = points[(i - 1 + points.length) % points.length];
    const afterNext = points[(i + 2) % points.length];
    const cp1x = current.x + (next.x - previous.x) / 6;
    const cp1y = current.y + (next.y - previous.y) / 6;
    const cp2x = next.x - (afterNext.x - current.x) / 6;
    const cp2y = next.y - (afterNext.y - current.y) / 6;
    g.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, next.x, next.y);
  }
  g.closePath().fill(fill);
  if (stroke) g.stroke(stroke);
}

class WobblyBlob {
  readonly view = new PIXI.Graphics();
  private readonly points: BlobPoint[];
  private readonly seed: number;
  private elapsed = 0;

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly palette: FluidPalette,
    seed: number,
  ) {
    this.seed = seed;
    const rng = seedRng(seed ^ 0x5f17b10b);
    const count = 15 + Math.floor(rng() * 5);
    this.points = Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * TAU;
      return {
        angle,
        rx: 0.86 + rng() * 0.24,
        ry: 0.80 + rng() * 0.28,
        phase: rng() * TAU,
        speed: 0.010 + rng() * 0.018,
        amp: 6 + rng() * 11,
      };
    });
    this.draw(0);
  }

  update(delta: number): void {
    this.elapsed += delta;
    this.draw(this.elapsed);
  }

  private draw(time: number): void {
    const g = this.view;
    const w = this.width;
    const h = this.height;
    const cx = w * 0.52;
    const cy = h * 0.50;
    const rx = w * 0.48;
    const ry = h * 0.48;
    const liquid = this.points.map((point) => {
      const wobble = Math.sin(time * point.speed + point.phase) * point.amp
        + Math.sin(time * point.speed * 0.62 + point.phase * 1.7) * point.amp * 0.45;
      return {
        x: cx + Math.cos(point.angle) * (rx * point.rx + wobble),
        y: cy + Math.sin(point.angle) * (ry * point.ry + wobble * 0.72),
      };
    });
    const rng = seedRng(this.seed ^ 0xca7d);

    g.clear();
    smoothClosedBlob(g, liquid, rgba(0x030409, 0.36));

    const shadow = liquid.map((p) => ({ x: p.x + 8, y: p.y + 10 }));
    smoothClosedBlob(g, shadow, rgba(0x000000, 0.20));
    smoothClosedBlob(g, liquid, rgba(this.palette.deep, 0.88), {
      color: mixColor(this.palette.foam, this.palette.accent, 0.2),
      alpha: 0.40,
      width: 2,
    });

    for (let i = 0; i < 5; i++) {
      const lx = w * (0.16 + rng() * 0.70) + Math.sin(time * 0.013 + i) * 9;
      const ly = h * (0.18 + rng() * 0.56) + Math.cos(time * 0.011 + i * 1.8) * 6;
      g.ellipse(lx, ly, 42 + rng() * 82, 10 + rng() * 28)
        .fill(rgba(i % 2 ? this.palette.skin : this.palette.skin2, 0.17 + rng() * 0.18));
    }

    g.ellipse(w * 0.30 + Math.sin(time * 0.018) * 8, h * 0.18, w * 0.24, 18)
      .fill(rgba(this.palette.foam, 0.16));
    g.circle(w * 0.86, h * 0.22 + Math.sin(time * 0.02) * 4, 8)
      .fill(rgba(this.palette.warm, 0.50));
    g.circle(w * 0.91, h * 0.58 + Math.cos(time * 0.016) * 4, 5)
      .fill(rgba(this.palette.cool, 0.48));
  }
}

class BlobMascot {
  readonly view = new PIXI.Container();
  private readonly body = new PIXI.Graphics();
  private readonly face = new PIXI.Graphics();
  private readonly points: BlobPoint[];
  private readonly profile: {
    eye: number;
    mouth: number;
    horns: number;
    limbs: number;
    spots: number;
    body: number;
    shade: number;
    accent: number;
  };
  private elapsed = 0;

  constructor(
    private readonly palette: FluidPalette,
    userColor: number,
    seed: number,
  ) {
    const rng = seedRng(seed ^ 0xa11faced);
    this.profile = {
      eye: seed % 6,
      mouth: Math.floor(seed / 17) % 5,
      horns: Math.floor(seed / 43) % 5,
      limbs: Math.floor(seed / 89) % 4,
      spots: Math.floor(seed / 131) % 7,
      body: mixColor(userColor, [palette.skin, palette.skin2, palette.warm, palette.cool][seed % 4], 0.46),
      shade: mixColor(userColor, palette.deep, 0.45),
      accent: [palette.warm, palette.cool, palette.foam, palette.accent][Math.floor(seed / 7) % 4],
    };
    const count = 12 + Math.floor(rng() * 4);
    this.points = Array.from({ length: count }, (_, index) => ({
      angle: (index / count) * TAU,
      rx: 0.78 + rng() * 0.30,
      ry: 0.78 + rng() * 0.32,
      phase: rng() * TAU,
      speed: 0.018 + rng() * 0.028,
      amp: 2.8 + rng() * 4.6,
    }));

    this.view.addChild(this.body);
    this.view.addChild(this.face);
    this.draw();
  }

  update(delta: number): void {
    this.elapsed += delta;
    this.view.rotation = Math.sin(this.elapsed * 0.022) * 0.04;
    this.view.y += Math.sin(this.elapsed * 0.035) * 0.016 * delta;
    this.draw();
  }

  private draw(): void {
    const g = this.body;
    const f = this.face;
    const time = this.elapsed;
    const cx = 29;
    const cy = 29;
    const rx = 25;
    const ry = 23;
    const points = this.points.map((point) => {
      const wobble = Math.sin(time * point.speed + point.phase) * point.amp;
      return {
        x: cx + Math.cos(point.angle) * (rx * point.rx + wobble),
        y: cy + Math.sin(point.angle) * (ry * point.ry + wobble * 0.75),
      };
    });

    g.clear();
    f.clear();
    g.ellipse(31, 55, 23, 5).fill(rgba(0x000000, 0.20));

    this.drawAppendages(g, time);
    smoothClosedBlob(g, points, rgba(this.profile.body, 0.98), {
      color: mixColor(this.profile.shade, 0x04040a, 0.24),
      alpha: 0.86,
      width: 4,
    });
    g.ellipse(19 + Math.sin(time * 0.025) * 2, 17, 12, 5)
      .fill(rgba(mixColor(this.profile.body, 0xffffff, 0.42), 0.50));

    for (let i = 0; i < this.profile.spots; i++) {
      const angle = i * 1.73 + this.profile.eye;
      const x = 30 + Math.cos(angle) * (8 + (i % 3) * 4);
      const y = 30 + Math.sin(angle * 1.2) * 10;
      g.circle(x, y, 2.4 + (i % 2) * 1.6).fill(rgba(this.profile.accent, 0.40));
    }

    this.drawFace(f, time);
  }

  private drawAppendages(g: PIXI.Graphics, time: number): void {
    if (this.profile.horns === 1 || this.profile.horns === 3) {
      g.moveTo(15, 13).quadraticCurveTo(14, -2, 25, 10).quadraticCurveTo(21, 13, 15, 13).fill(rgba(this.profile.accent, 0.94));
      g.moveTo(40, 12).quadraticCurveTo(45, -1, 49, 15).quadraticCurveTo(45, 13, 40, 12).fill(rgba(this.profile.accent, 0.94));
    } else if (this.profile.horns === 2) {
      g.circle(19, 9, 5).fill(rgba(this.profile.accent, 0.92));
      g.circle(42, 9, 5).fill(rgba(this.profile.accent, 0.92));
    } else if (this.profile.horns === 4) {
      g.moveTo(25, 8).quadraticCurveTo(31, -4, 36, 9).fill(rgba(this.profile.accent, 0.92));
    }

    if (this.profile.limbs > 0) {
      const sway = Math.sin(time * 0.04) * 3;
      g.ellipse(7, 33 + sway, 8, 4).fill(rgba(this.profile.shade, 0.96));
      g.ellipse(52, 34 - sway, 8, 4).fill(rgba(this.profile.shade, 0.96));
      if (this.profile.limbs > 1) {
        g.ellipse(22, 52, 5, 7).fill(rgba(this.profile.shade, 0.96));
        g.ellipse(39, 52, 5, 7).fill(rgba(this.profile.shade, 0.96));
      }
    }
  }

  private drawFace(g: PIXI.Graphics, time: number): void {
    const blink = Math.sin(time * 0.035 + this.profile.eye) > 0.965;
    const eyeColor = this.profile.eye % 2 ? this.palette.foam : 0xffffff;
    const pupil = 0x080a11;
    const y = this.profile.eye === 4 ? 25 : 24;

    if (this.profile.eye === 2) {
      this.eye(g, 24, 22, blink, eyeColor, pupil, 5);
      this.eye(g, 35, 27, blink, eyeColor, pupil, 4);
    } else if (this.profile.eye === 3) {
      this.eye(g, 30, 22, blink, eyeColor, pupil, 7);
    } else if (this.profile.eye === 5) {
      this.eye(g, 21, 23, blink, eyeColor, pupil, 4);
      this.eye(g, 31, 21, blink, eyeColor, pupil, 4);
      this.eye(g, 41, 23, blink, eyeColor, pupil, 4);
    } else {
      this.eye(g, 22, y, blink, eyeColor, pupil, 5);
      this.eye(g, 38, y, blink, eyeColor, pupil, 5);
    }

    const mouthY = 36;
    if (this.profile.mouth === 0) {
      g.roundRect(24, mouthY, 15, 8, 4).fill(rgba(0x130910, 0.92));
      g.circle(29, mouthY + 6, 3).fill(rgba(0xff7695, 0.88));
    } else if (this.profile.mouth === 1) {
      g.moveTo(24, mouthY).quadraticCurveTo(31, mouthY + 8, 39, mouthY).stroke({ color: 0x130910, width: 3, alpha: 0.9 });
    } else if (this.profile.mouth === 2) {
      g.roundRect(24, mouthY, 15, 4, 2).fill(rgba(0x130910, 0.92));
      g.rect(28, mouthY, 3, 4).fill(rgba(0xfff4c8, 0.95));
      g.rect(34, mouthY, 3, 4).fill(rgba(0xfff4c8, 0.95));
    } else if (this.profile.mouth === 3) {
      g.circle(31, mouthY + 2, 5).fill(rgba(0x130910, 0.92));
    } else {
      g.moveTo(25, mouthY + 2).quadraticCurveTo(31, mouthY - 2, 37, mouthY + 2).stroke({ color: 0x130910, width: 3, alpha: 0.9 });
    }
  }

  private eye(
    g: PIXI.Graphics,
    x: number,
    y: number,
    blink: boolean,
    eyeColor: number,
    pupil: number,
    radius: number,
  ): void {
    if (blink) {
      g.roundRect(x - radius, y - 1, radius * 2, 3, 2).fill(rgba(pupil, 0.9));
      return;
    }
    g.circle(x, y, radius).fill(rgba(eyeColor, 0.98));
    g.circle(x + radius * 0.22, y + radius * 0.18, Math.max(2, radius * 0.42)).fill(pupil);
    g.circle(x - radius * 0.25, y - radius * 0.24, Math.max(1, radius * 0.18)).fill(rgba(0xffffff, 0.72));
  }
}

class ChatCard {
  readonly view = new PIXI.Container();
  readonly height: number;
  private readonly lifetime = CARD_LIFETIME;
  private age = 0;
  private targetY = 0;
  private positioned = false;
  private readonly blob: WobblyBlob;
  private readonly mascot: BlobMascot;
  private readonly width: number;

  constructor(
    app: PIXI.Application,
    msg: VisualEventMsg,
    width: number,
    palette: FluidPalette,
    userSeed: number,
    userAccent: number,
    mascotSeed: number,
    plateSeed: number,
  ) {
    this.width = width;
    this.view.label = `fluid-chat:${msg.username}`;
    this.view.alpha = 0;

    const avatarSize = 38;
    const avatarRightPad = 28;
    const avatarX = width - avatarRightPad - avatarSize;
    const mascotSlot = 74;
    const textX = mascotSlot + 18;
    const wrap = Math.max(190, avatarX - textX - 18);
    const content = this.makeMessageContent(msg, palette, wrap);

    this.height = Math.max(94, Math.ceil(content.height + 68));
    this.blob = new WobblyBlob(width, this.height, palette, plateSeed);
    this.mascot = new BlobMascot(palette, userAccent, mascotSeed);
    this.mascot.view.x = 14;
    this.mascot.view.y = Math.max(22, this.height - 72);

    const name = new PIXI.Text({
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
    const tag = new PIXI.Text({
      text: eventLabel(msg.event),
      style: {
        fontFamily: '"Trebuchet MS", "Avenir Next", "Segoe UI", sans-serif',
        fontSize: 11,
        fontWeight: '900',
        fill: palette.warm,
        letterSpacing: 0,
        stroke: { color: 0x05060b, width: 2 },
      },
    });
    const avatar = this.makeAvatar(userSeed, palette, userAccent, messageAvatarUrl(msg));

    name.x = textX;
    name.y = 18;
    tag.x = Math.max(textX, avatarX - tag.width - 12);
    tag.y = 24;
    content.x = textX;
    content.y = 47;
    avatar.x = avatarX;
    avatar.y = Math.round((this.height - avatarSize) / 2);

    this.view.addChild(this.blob.view);
    this.view.addChild(this.mascot.view);
    this.view.addChild(name);
    this.view.addChild(tag);
    this.view.addChild(content);
    this.view.addChild(avatar);

    app.stage.addChild(this.view);
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

    this.view.x += (x + wobble - this.view.x) * 0.22 * delta;
    this.view.y += (this.targetY - this.view.y) * 0.18 * delta;
    this.view.alpha = eased * leave;
    this.view.scale.set(0.96 + eased * 0.04 - (1 - leave) * 0.05);
    this.blob.update(delta);
    this.mascot.update(delta);
    return this.age >= this.lifetime;
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }

  private makeMessageContent(msg: VisualEventMsg, palette: FluidPalette, wrap: number): PIXI.Container {
    const content = new PIXI.Container();
    const style = {
      fontFamily: '"Trebuchet MS", "Avenir Next", "Segoe UI", sans-serif',
      fontSize: 18,
      fontWeight: '800' as const,
      fill: 0xffffff,
      lineHeight: 25,
      letterSpacing: 0,
      stroke: { color: 0x04050b, width: 3 },
      dropShadow: { color: 0x000000, alpha: 0.28, distance: 1, blur: 3 },
    };
    const imageSize = 25;
    const gap = 5;
    const lineHeight = 26;
    let x = 0;
    let y = 0;
    let hasContent = false;

    const newline = () => {
      x = 0;
      y += lineHeight;
    };

    const place = (node: PIXI.Container | PIXI.Text, width: number, height = lineHeight) => {
      if (x > 0 && x + width > wrap) newline();
      node.x = x;
      node.y = y + Math.max(0, Math.floor((lineHeight - height) / 2));
      content.addChild(node);
      x += width + gap;
      hasContent = true;
    };

    const addText = (text: string) => {
      for (const chunk of text.match(/\S+\s*|\s+/g) ?? []) {
        if (!chunk.trim()) {
          x = Math.min(wrap, x + 8);
          continue;
        }
        const label = new PIXI.Text({ text: chunk, style });
        if (label.width > wrap) label.scale.x = wrap / label.width;
        place(label, Math.min(label.width, wrap), label.height);
      }
    };

    const addImage = (part: MessagePart) => {
      if (!part.url) return;
      const holder = new PIXI.Container();
      const backing = new PIXI.Graphics()
        .circle(imageSize / 2, imageSize / 2, imageSize / 2)
        .fill(rgba(palette.foam, 0.18))
        .stroke({ color: palette.foam, width: 1.5, alpha: 0.42 });
      holder.addChild(backing);
      this.loadInlineImage(part.url, holder, imageSize);
      place(holder, imageSize, imageSize);
    };

    for (const part of renderParts(msg)) {
      if (part.type === 'image') addImage(part);
      else addText(part.text ?? '');
    }

    if (!hasContent) addText(messageText(msg));
    return content;
  }

  private loadInlineImage(url: string, holder: PIXI.Container, size: number): void {
    PIXI.Assets.load<PIXI.Texture>({ src: url, parser: 'texture' })
      .then((texture) => {
        if ((holder as PIXI.Container & { destroyed?: boolean }).destroyed) return;
        const sprite = new PIXI.Sprite(texture);
        const maxSide = Math.max(sprite.width, sprite.height, 1);
        const scale = (size - 3) / maxSide;
        sprite.scale.set(scale);
        sprite.x = Math.round((size - sprite.width) / 2);
        sprite.y = Math.round((size - sprite.height) / 2);
        holder.addChild(sprite);
      })
      .catch(() => {
        const fallback = new PIXI.Text({
          text: '?',
          style: {
            fontFamily: '"Trebuchet MS", sans-serif',
            fontSize: 14,
            fontWeight: '900',
            fill: 0xffffff,
            letterSpacing: 0,
          },
        });
        fallback.x = Math.round((size - fallback.width) / 2);
        fallback.y = Math.round((size - fallback.height) / 2);
        holder.addChild(fallback);
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
    fallback.circle(19, 19, 19).fill(rgba(mixColor(userColor, palette.deep, 0.24), 0.96));
    fallback.circle(16 + rng() * 6, 14 + rng() * 5, 8).fill(rgba(palette.foam, 0.30));
    fallback.circle(23, 23, 10).fill(rgba(palette.warm, 0.22));
    view.addChild(fallback);
    view.addChild(ring);

    if (avatarUrl) this.loadAvatarImage(avatarUrl, view, fallback);
    return view;
  }

  private avatarRing(palette: FluidPalette, userColor: number): PIXI.Graphics {
    return new PIXI.Graphics()
      .circle(19, 19, 20)
      .stroke({ color: 0x05060b, width: 5, alpha: 0.58 })
      .circle(19, 19, 18)
      .stroke({ color: mixColor(palette.foam, userColor, 0.26), width: 2.5, alpha: 0.96 })
      .circle(13, 10, 3)
      .fill(rgba(0xffffff, 0.58));
  }

  private loadAvatarImage(url: string, view: PIXI.Container, fallback: PIXI.Container): void {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.referrerPolicy = 'no-referrer';
    image.onload = () => {
      if ((view as PIXI.Container & { destroyed?: boolean }).destroyed) return;
      fallback.alpha = 0;
      const sprite = new PIXI.Sprite(PIXI.Texture.from(image));
      const size = 38;
      const scale = size / Math.max(image.naturalWidth, image.naturalHeight, 1);
      sprite.scale.set(scale);
      sprite.x = Math.round((size - sprite.width) / 2);
      sprite.y = Math.round((size - sprite.height) / 2);

      const mask = new PIXI.Graphics().circle(size / 2, size / 2, size / 2).fill(0xffffff);
      sprite.mask = mask;
      view.addChild(mask);
      view.addChildAt(sprite, Math.min(1, view.children.length));
    };
    image.onerror = () => {
      console.warn('[FluidChatOverlay] avatar image failed to load:', url);
      fallback.alpha = 1;
    };
    image.src = url;
  }
}

class FluidChatOverlay {
  private app: PIXI.Application | null = null;
  private cards: ChatCard[] = [];
  private userAccents = new Map<string, number>();
  private userMascotSeeds = new Map<string, number>();
  private messageSerial = 0;
  private ws: WebSocket | null = null;
  private wsRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private burstLayer: PIXI.Container | null = null;
  private burstParticles: BlobParticle[] = [];

  async init(): Promise<void> {
    const app = new PIXI.Application();
    await app.init({
      resizeTo: window,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });

    document.body.appendChild(app.canvas);
    app.canvas.style.position = 'fixed';
    app.canvas.style.inset = '0';

    this.app = app;
    this.burstLayer = new PIXI.Container();
    app.stage.addChild(this.burstLayer);
    app.ticker.add(({ deltaTime }) => this.tick(deltaTime));

    window.addEventListener('resize', () => this.layoutCards());
    this.seedPreview();
  }

  connectWebSocket(): void {
    if (this.wsRetryTimer) {
      clearTimeout(this.wsRetryTimer);
      this.wsRetryTimer = null;
    }

    try {
      const wsUrl = getWebSocketUrl();
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      ws.onopen = () => console.log('[FluidChatOverlay] WebSocket connected:', wsUrl);
      ws.onmessage = (evt: MessageEvent<string>) => {
        try {
          this.spawn(JSON.parse(evt.data) as VisualEventMsg);
        } catch (error) {
          console.warn('[FluidChatOverlay] WebSocket parse error:', error);
        }
      };
      ws.onclose = () => {
        this.wsRetryTimer = setTimeout(() => this.connectWebSocket(), 3000);
      };
      ws.onerror = () => ws.close();
    } catch (error) {
      console.warn('[FluidChatOverlay] WebSocket setup failed:', error);
      this.wsRetryTimer = setTimeout(() => this.connectWebSocket(), 3000);
    }
  }

  spawn(msg: VisualEventMsg): void {
    if (!this.app) return;
    const userKey = this.userKey(msg.username);
    const userSeed = msg.seed ?? hashSeed(userKey);
    const userAccent = this.userAccent(msg, userKey, userSeed);
    const mascotSeed = this.mascotSeed(userKey);
    const plateSeed = this.nextPlateSeed(msg, userKey, userSeed);
    const palette = makePalette(plateSeed, userAccent);
    const width = this.cardWidth();
    const card = new ChatCard(
      this.app,
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
    this.updateBurst(delta);
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

  private userKey(username: string): string {
    return username.trim().toLowerCase() || 'anonymous';
  }

  private userAccent(msg: VisualEventMsg, userKey: string, userSeed: number): number {
    const existing = this.userAccents.get(userKey);
    if (existing !== undefined) return existing;
    const fallback = hslToRgb(userSeed % 360, 0.72, 0.60);
    const accent = colorFromString(msg.color, fallback);
    this.userAccents.set(userKey, accent);
    return accent;
  }

  private mascotSeed(userKey: string): number {
    const existing = this.userMascotSeeds.get(userKey);
    if (existing !== undefined) return existing;
    const seed = hashSeed(`fluid-mascot:${userKey}`);
    this.userMascotSeeds.set(userKey, seed);
    return seed;
  }

  private nextPlateSeed(msg: VisualEventMsg, userKey: string, userSeed: number): number {
    this.messageSerial += 1;
    const randomBits = Math.floor(Math.random() * 0xffffffff);
    return hashSeed([
      'fluid',
      userKey,
      userSeed,
      msg.event,
      msg.text ?? '',
      this.messageSerial,
      performance.now().toFixed(3),
      randomBits,
    ].join(':'));
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
        .fill(rgba(color, 0.58));
      view.x = x;
      view.y = y;
      this.burstLayer.addChild(view);
      this.burstParticles.push({
        view,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 48 + rng() * 44,
        radius,
        color,
      });
    }
  }

  private updateBurst(delta: number): void {
    for (let i = this.burstParticles.length - 1; i >= 0; i--) {
      const item = this.burstParticles[i];
      item.life += delta;
      item.view.x += item.vx * delta;
      item.view.y += item.vy * delta;
      item.vy += 0.030 * delta;
      const life = clamp(1 - item.life / item.maxLife, 0, 1);
      item.view.alpha = life;
      item.view.scale.set(0.70 + (1 - life) * 1.15);
      if (item.life >= item.maxLife) {
        item.view.destroy();
        this.burstParticles.splice(i, 1);
      }
    }
  }

  private seedPreview(): void {
    const params = new URLSearchParams(location.search);
    if (params.get('preview') === '0') return;
    const examples: VisualEventMsg[] = [
      {
        event: 'chat_message',
        username: 'softsignal',
        text: 'the chat bubbles are alive now',
        color: '#46d9bf',
        seed: 2048,
        avatar_url: 'https://static-cdn.jtvnw.net/jtv_user_pictures/xarth/404_user_70x70.png',
      },
      {
        event: 'chat_message',
        username: 'worxbend',
        color: '#ff8aa3',
        seed: 9001,
        parts: [
          { type: 'text', text: 'no pixels, just blobby little friends ' },
          {
            type: 'image',
            name: 'heart',
            url: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/2764.png',
          },
          { type: 'text', text: ' floating through chat' },
        ],
      },
      {
        event: 'chat_message',
        username: 'liquidmage',
        text: 'each message gets its own soft-body membrane and mascot',
        color: '#79b7ff',
        seed: 4242,
      },
      {
        event: 'cheer',
        username: 'gummyspark',
        color: '#ffd35a',
        seed: 7117,
        data: { bits: 880 },
      },
    ];
    this.spawn(examples[0]);
    setTimeout(() => this.spawn(examples[1]), 520);
    setTimeout(() => this.spawn(examples[2]), 1080);
    setTimeout(() => this.spawn(examples[3]), 1660);
  }
}

const overlay = new FluidChatOverlay();
overlay.init().then(() => {
  overlay.connectWebSocket();
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key !== ' ') return;
    const seed = Math.floor(Math.random() * 0xffffff);
    overlay.spawn({
      event: 'chat_message',
      username: `viewer${seed % 97}`,
      text: 'fresh chat rendered as soft-body blob motion',
      color: `#${seed.toString(16).padStart(6, '0')}`,
      seed,
    });
  });
});
