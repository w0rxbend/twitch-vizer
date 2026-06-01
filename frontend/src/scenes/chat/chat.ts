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

interface Palette {
  base: number;
  panel: number;
  ink: number;
  dim: number;
  accent: number;
  pop: number;
  glow: number;
}

interface MovingParticle {
  particle: PIXI.Particle;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

const PX = 4;
const PLATE_PIXEL = PX * 2;
const CARD_GAP = 10;
const CARD_LIFETIME = 30 * 60;
const MAX_CARDS = 9;
const MOTIF_COUNT = 42;

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

function luminance(color: number): number {
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function makePalette(seed: number, userAccent: number): Palette {
  const rng = seedRng(seed ^ 0x9e3779b9);
  const hue = Math.floor(rng() * 360);
  const scheme = seed % 7;
  const panel = hslToRgb(hue, 0.74 + rng() * 0.22, 0.50 + rng() * 0.20);
  const accentHue = hue + [28, 58, 112, 154, 188, 226, 302][scheme];
  const popHue = hue + [176, 214, 268, 318, 92, 136, 42][scheme];
  const accent = mixColor(userAccent, hslToRgb(accentHue, 0.94, 0.58), 0.38);
  const pop = hslToRgb(popHue, 0.84 + rng() * 0.14, 0.54 + rng() * 0.20);
  const darkTint = hslToRgb(hue + 18, 0.48 + rng() * 0.24, 0.12 + rng() * 0.12);
  const base = mixColor(darkTint, hslToRgb(hue + 40, 0.68, 0.34), 0.18 + rng() * 0.18);
  const glow = hslToRgb(accentHue + 24, 0.86 + rng() * 0.12, 0.68 + rng() * 0.14);
  const dim = hslToRgb(hue + 96 + rng() * 88, 0.56 + rng() * 0.22, 0.36 + rng() * 0.16);
  const plateLight = luminance(mixColor(panel, userAccent, 0.45));
  const ink = plateLight > 0.58 ? mixColor(base, 0x050505, 0.42) : 0xf8fff4;

  return { base, panel, ink, dim, accent, pop, glow };
}

function rgba(color: number, alpha: number): { color: number; alpha: number } {
  return { color, alpha };
}

function snapPixel(value: number, grid = PLATE_PIXEL): number {
  return Math.round(value / grid) * grid;
}

function pixelSize(value: number, grid = PLATE_PIXEL): number {
  return Math.max(grid, Math.ceil(value / grid) * grid);
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

  const url = new URL(
    /^(https?|wss?):\/\//.test(value) ? value : `${proto}//${value}`,
  );
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
  if (msg.event === 'follow') return 'joined the signal';
  if (msg.event === 'sub') {
    const months = msg.data?.months;
    return months ? `subscribed for ${months} months` : 'subscribed';
  }
  if (msg.event === 'gift_sub') {
    return `gifted ${msg.data?.total ?? 1} subscription${(msg.data?.total ?? 1) === 1 ? '' : 's'}`;
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

class PixelPattern {
  readonly view: PIXI.ParticleContainer<PIXI.Particle>;

  constructor(
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    seed: number,
  ) {
    this.view = new PIXI.ParticleContainer<PIXI.Particle>({
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

    const rng = seedRng(seed);
    const particles: PIXI.Particle[] = [];
    const motif = seed % MOTIF_COUNT;
    const colors = this._plateColors(palette, seed);

    this._stainWash(particles, texture, width, height, palette, colors, rng);
    this._dotField(particles, texture, width, height, colors, rng);
    this._motif(motif, particles, texture, width, height, palette, rng);
    if (rng() > 0.28) {
      this._motif((motif + 11 + Math.floor(rng() * 7)) % MOTIF_COUNT, particles, texture, width, height, palette, rng);
    }
    if (rng() > 0.56) {
      this._motif((motif + 23 + Math.floor(rng() * 11)) % MOTIF_COUNT, particles, texture, width, height, palette, rng);
    }
    this._colorAccentBits(particles, texture, width, height, colors, rng);

    this.view.addParticle(...particles);
    this.view.update();
  }

  private _add(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    x: number,
    y: number,
    w: number,
    h: number,
    tint: number,
    alpha: number,
  ): void {
    out.push(new PIXI.Particle({
      texture,
      x: snapPixel(x),
      y: snapPixel(y),
      scaleX: pixelSize(w),
      scaleY: pixelSize(h),
      tint,
      alpha: clamp(alpha * 1.28, 0.12, 0.78),
    }));
  }

  private _plateColors(palette: Palette, seed: number): number[] {
    const rng = seedRng(seed ^ 0x51edc0de);
    const hue = Math.floor(rng() * 360);
    return [
      palette.panel,
      palette.accent,
      palette.pop,
      palette.glow,
      palette.dim,
      hslToRgb(hue + 54, 0.92, 0.62),
      hslToRgb(hue + 126, 0.86, 0.54),
      hslToRgb(hue + 202, 0.88, 0.58),
      hslToRgb(hue + 284, 0.82, 0.64),
      mixColor(palette.pop, 0xffffff, 0.28),
    ];
  }

  private _colorAccentBits(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    colors: number[],
    rng: () => number,
  ): void {
    const bits = 18 + Math.floor(rng() * 22);
    for (let i = 0; i < bits; i++) {
      const horizontal = rng() > 0.35;
      const size = PLATE_PIXEL * (1 + Math.floor(rng() * 3));
      this._add(
        out,
        texture,
        rng() * width,
        rng() * height,
        horizontal ? size * (1 + rng() * 3) : size,
        horizontal ? PLATE_PIXEL : size * (1 + rng() * 2),
        colors[Math.floor(rng() * colors.length)],
        0.24 + rng() * 0.28,
      );
    }
  }

  private _motif(
    motif: number,
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    rng: () => number,
  ): void {
    switch (motif) {
      case 0: this._diagonalBars(out, texture, width, height, palette, rng); break;
      case 1: this._rings(out, texture, width, height, palette, rng); break;
      case 2: this._pixelWaves(out, texture, width, height, palette, rng); break;
      case 3: this._blocks(out, texture, width, height, palette, rng); break;
      case 4: this._signalRunes(out, texture, width, height, palette, rng); break;
      case 5: this._edgeSpray(out, texture, width, height, palette, rng); break;
      case 6: this._bubbles(out, texture, width, height, palette, rng); break;
      case 7: this._chevrons(out, texture, width, height, palette, rng); break;
      case 8: this._circuit(out, texture, width, height, palette, rng); break;
      case 9: this._flameSweep(out, texture, width, height, palette, rng); break;
      case 10: this._slashStack(out, texture, width, height, palette, rng); break;
      case 11: this._scallops(out, texture, width, height, palette, rng); break;
      case 12: this._mountainPixels(out, texture, width, height, palette, rng); break;
      case 13: this._confettiLane(out, texture, width, height, palette, rng); break;
      case 14: this._zebraCuts(out, texture, width, height, palette, rng); break;
      case 15: this._sunbursts(out, texture, width, height, palette, rng); break;
      case 16: this._cloudBands(out, texture, width, height, palette, rng); break;
      case 17: this._leafBits(out, texture, width, height, palette, rng); break;
      case 18: this._equalizer(out, texture, width, height, palette, rng); break;
      case 19: this._checkerFade(out, texture, width, height, palette, rng); break;
      case 20: this._ribbonCut(out, texture, width, height, palette, rng); break;
      case 21: this._constellation(out, texture, width, height, palette, rng); break;
      case 22: this._stairSteps(out, texture, width, height, palette, rng); break;
      case 23: this._pixelSwirl(out, texture, width, height, palette, rng); break;
      case 24: this._xMarks(out, texture, width, height, palette, rng); break;
      case 25: this._honeycomb(out, texture, width, height, palette, rng); break;
      case 26: this._drips(out, texture, width, height, palette, rng); break;
      case 27: this._wideStripes(out, texture, width, height, palette, rng); break;
      case 28: this._barcode(out, texture, width, height, palette, rng); break;
      case 29: this._waveBlocks(out, texture, width, height, palette, rng); break;
      case 30: this._petalScatter(out, texture, width, height, palette, rng); break;
      case 31: this._glitch(out, texture, width, height, palette, rng); break;
      case 32: this._foam(out, texture, width, height, palette, rng); break;
      case 33: this._borderDots(out, texture, width, height, palette, rng); break;
      case 34: this._tileSlants(out, texture, width, height, palette, rng); break;
      case 35: this._paintScabs(out, texture, width, height, palette, rng); break;
      case 36: this._stainIslands(out, texture, width, height, palette, rng); break;
      case 37: this._inkPuddles(out, texture, width, height, palette, rng); break;
      case 38: this._offsetSwatches(out, texture, width, height, palette, rng); break;
      case 39: this._dryBrush(out, texture, width, height, palette, rng); break;
      case 40: this._splatterRail(out, texture, width, height, palette, rng); break;
      default: this._blockArrows(out, texture, width, height, palette, rng); break;
    }
  }

  private _stainWash(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    colors: number[],
    rng: () => number,
  ): void {
    const washColors = [palette.base, ...colors];
    const mode = Math.floor(rng() * 7);

    if (mode === 0) {
      this._stackedStains(out, texture, width, height, washColors, rng);
      return;
    }
    if (mode === 1) {
      this._offsetStains(out, texture, width, height, washColors, rng);
      return;
    }
    if (mode === 2) {
      this._splitStains(out, texture, width, height, washColors, rng);
      return;
    }
    if (mode === 3) {
      this._brushStreaks(out, texture, width, height, washColors, rng);
      return;
    }
    if (mode === 4) {
      this._stainIslands(out, texture, width, height, palette, rng);
      return;
    }
    if (mode === 5) {
      this._inkPuddles(out, texture, width, height, palette, rng);
      return;
    }

    this._offsetSwatches(out, texture, width, height, palette, rng);
  }

  private _stainBlob(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    cx: number,
    cy: number,
    w: number,
    h: number,
    tint: number,
    alpha: number,
    rng: () => number,
  ): void {
    const step = PLATE_PIXEL;
    const left = cx - w / 2;
    const top = cy - h / 2;
    const wobble = 0.10 + rng() * 0.22;
    for (let y = top; y <= top + h; y += step) {
      const ny = (y - cy) / (h / 2);
      const rowNoise = Math.sin(y * 0.17 + cx * 0.03) * wobble + (rng() - 0.5) * wobble;
      for (let x = left; x <= left + w; x += step) {
        const nx = (x - cx) / (w / 2);
        const edge = nx * nx + ny * ny * (1.35 + rowNoise);
        if (edge < 1.0 + rowNoise && rng() > 0.08 + Math.max(0, edge - 0.62) * 0.42) {
          const cellW = step * (1 + Math.floor(rng() * 3));
          this._add(out, texture, x, y, cellW, step, tint, alpha * (0.78 + rng() * 0.28));
        }
      }
    }

    const specks = 4 + Math.floor(rng() * 8);
    for (let i = 0; i < specks; i++) {
      const angle = rng() * Math.PI * 2;
      const dist = 0.42 + rng() * 0.66;
      const x = cx + Math.cos(angle) * w * 0.5 * dist;
      const y = cy + Math.sin(angle) * h * 0.5 * dist;
      const size = rng() > 0.65 ? step * 2 : step;
      this._add(out, texture, x, y, size, size, tint, alpha * (0.52 + rng() * 0.28));
    }
  }

  private _stackedStains(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, colors: number[], rng: () => number): void {
    const bands = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < bands; i++) {
      const bandH = height / (bands + 0.45);
      const cy = bandH * (i + 0.52) + (rng() - 0.5) * 10;
      const w = width * (0.62 + rng() * 0.34);
      const cx = width * (0.44 + rng() * 0.12);
      this._stainBlob(out, texture, cx, cy, w, bandH * (0.95 + rng() * 0.45), colors[i % colors.length], 0.22 + rng() * 0.2, rng);
    }
  }

  private _offsetStains(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, colors: number[], rng: () => number): void {
    const stains = 4 + Math.floor(rng() * 4);
    for (let i = 0; i < stains; i++) {
      const cy = height * (0.16 + i / Math.max(1, stains - 1) * 0.68) + (rng() - 0.5) * 12;
      const cx = width * (0.25 + rng() * 0.5);
      const w = width * (0.32 + rng() * 0.48);
      const h = 18 + rng() * Math.max(16, height * 0.24);
      this._stainBlob(out, texture, cx, cy, w, h, colors[(i + 1) % colors.length], 0.20 + rng() * 0.22, rng);
    }
  }

  private _splitStains(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, colors: number[], rng: () => number): void {
    for (let side = 0; side < 2; side++) {
      const cx = width * (side === 0 ? 0.28 : 0.72) + (rng() - 0.5) * 30;
      const cy = height * (0.38 + rng() * 0.24);
      this._stainBlob(out, texture, cx, cy, width * (0.34 + rng() * 0.22), height * (0.68 + rng() * 0.25), colors[(side * 2 + 1) % colors.length], 0.22 + rng() * 0.18, rng);
    }
    this._stainBlob(out, texture, width * 0.5, height * (0.48 + (rng() - 0.5) * 0.22), width * 0.48, height * 0.36, colors[3 % colors.length], 0.12 + rng() * 0.16, rng);
  }

  private _brushStreaks(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, colors: number[], rng: () => number): void {
    const lanes = 4 + Math.floor(rng() * 4);
    for (let i = 0; i < lanes; i++) {
      const y = height * (0.14 + rng() * 0.72);
      const x = -20 + rng() * width * 0.3;
      const w = width * (0.48 + rng() * 0.58);
      const h = 10 + rng() * 18;
      this._stainBlob(out, texture, x + w * 0.5, y, w, h, colors[i % colors.length], 0.22 + rng() * 0.2, rng);
    }
  }

  private _dotField(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    colors: number[],
    rng: () => number,
  ): void {
    const count = Math.floor(width / 18);
    for (let i = 0; i < count; i++) {
      const size = rng() > 0.7 ? PX * 2 : PX;
      this._add(
        out,
        texture,
        rng() * width,
        10 + rng() * (height - 20),
        size,
        size,
        colors[Math.floor(rng() * colors.length)],
        0.18 + rng() * 0.32,
      );
    }
  }

  private _diagonalBars(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    rng: () => number,
  ): void {
    for (let x = -width * 0.15; x < width; x += 26 + rng() * 12) {
      for (let step = 0; step < 7; step++) {
        this._add(out, texture, x + step * 7, height - 12 - step * 5, 24, PX, palette.accent, 0.24);
      }
    }
  }

  private _rings(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    rng: () => number,
  ): void {
    const cx = width * (0.2 + rng() * 0.6);
    const cy = height * (0.35 + rng() * 0.35);
    for (let r = 12; r < height * 1.5; r += 13) {
      for (let a = 0; a < Math.PI * 2; a += 0.35) {
        if (rng() < 0.42) {
          this._add(out, texture, cx + Math.cos(a) * r, cy + Math.sin(a) * r, PX, PX, palette.pop, 0.24);
        }
      }
    }
  }

  private _pixelWaves(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    rng: () => number,
  ): void {
    for (let lane = 0; lane < 4; lane++) {
      const y = 12 + lane * ((height - 24) / 4);
      const tint = lane % 2 === 0 ? palette.glow : palette.accent;
      for (let x = 0; x < width; x += PX * 2) {
        const wave = Math.sin(x * 0.035 + lane + rng() * 0.1);
        if (wave > 0.15) this._add(out, texture, x, y + wave * 11, PX, PX, tint, 0.22);
      }
    }
  }

  private _blocks(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    rng: () => number,
  ): void {
    const blockW = 30 + rng() * 48;
    for (let x = 0; x < width; x += blockW) {
      const tint = rng() > 0.5 ? palette.accent : palette.pop;
      this._add(out, texture, x, height - 18 - rng() * 12, blockW * (0.55 + rng() * 0.4), 14, tint, 0.18);
    }
  }

  private _signalRunes(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    rng: () => number,
  ): void {
    for (let x = 12; x < width - 12; x += 24 + rng() * 20) {
      const y = 12 + rng() * (height - 24);
      this._add(out, texture, x, y, PX * 3, PX, palette.glow, 0.32);
      this._add(out, texture, x + PX, y - PX, PX, PX * 3, palette.glow, 0.24);
      if (rng() > 0.45) this._add(out, texture, x + PX * 4, y + PX, PX, PX, palette.pop, 0.32);
    }
  }

  private _edgeSpray(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    width: number,
    height: number,
    palette: Palette,
    rng: () => number,
  ): void {
    for (let i = 0; i < 42; i++) {
      const side = rng() > 0.5;
      const x = side ? rng() * width * 0.26 : width - rng() * width * 0.26;
      this._add(out, texture, x, rng() * height, PX, PX, rng() > 0.5 ? palette.accent : palette.glow, 0.35);
    }
  }

  private _bubbles(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let i = 0; i < 18; i++) {
      const cx = rng() * width;
      const cy = rng() * height;
      const r = 6 + rng() * 18;
      for (let a = 0; a < Math.PI * 2; a += 0.55) {
        this._add(out, texture, cx + Math.cos(a) * r, cy + Math.sin(a) * r, PX, PX, rng() > 0.5 ? palette.glow : palette.accent, 0.22);
      }
    }
  }

  private _chevrons(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let x = -20; x < width; x += 44) {
      const y = 8 + rng() * (height - 20);
      const tint = rng() > 0.5 ? palette.accent : palette.pop;
      for (let i = 0; i < 6; i++) {
        this._add(out, texture, x + i * PX * 2, y + i * PX, PX * 3, PX, tint, 0.38);
        this._add(out, texture, x + i * PX * 2, y + (10 - i) * PX, PX * 3, PX, tint, 0.38);
      }
    }
  }

  private _circuit(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let y = 12; y < height; y += 16 + rng() * 10) {
      let x = rng() * 24;
      while (x < width - 20) {
        const len = 18 + rng() * 52;
        this._add(out, texture, x, y, len, PX, palette.accent, 0.32);
        if (rng() > 0.45) this._add(out, texture, x + len, y - 8, PX, 16, palette.glow, 0.28);
        if (rng() > 0.55) this._add(out, texture, x + len + 6, y - 2, PX * 2, PX * 2, palette.pop, 0.38);
        x += len + 18 + rng() * 22;
      }
    }
  }

  private _flameSweep(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let x = 0; x < width; x += PX * 2) {
      const flame = Math.sin(x * 0.035 + rng() * 0.3) * 0.5 + 0.5;
      const h = 14 + flame * (height - 18);
      const tint = rng() > 0.5 ? palette.pop : palette.accent;
      for (let y = height - h; y < height; y += PX * 2) {
        if (rng() > 0.22) this._add(out, texture, x, y, PX * 2, PX * 2, tint, 0.21 + flame * 0.22);
      }
    }
  }

  private _slashStack(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let x = -height; x < width; x += 18 + rng() * 18) {
      const tint = rng() > 0.5 ? palette.glow : palette.pop;
      for (let y = 0; y < height; y += PX) {
        this._add(out, texture, x + y * 0.9, y, 10 + rng() * 18, PX, tint, 0.20);
      }
    }
  }

  private _scallops(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let cx = 0; cx < width + 30; cx += 28) {
      const cy = rng() > 0.5 ? 0 : height;
      for (let a = 0; a < Math.PI; a += 0.22) {
        const yDir = cy === 0 ? 1 : -1;
        this._add(out, texture, cx + Math.cos(a) * 18, cy + Math.sin(a) * 18 * yDir, PX * 2, PX, palette.glow, 0.25);
      }
    }
  }

  private _mountainPixels(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let x = 0; x < width; x += PX * 2) {
      const ridge = height * (0.34 + 0.28 * Math.sin(x * 0.024 + rng()));
      for (let y = ridge; y < height; y += PX * 2) {
        if (rng() > 0.36) this._add(out, texture, x, y, PX * 2, PX * 2, rng() > 0.5 ? palette.dim : palette.accent, 0.24);
      }
    }
  }

  private _confettiLane(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    const colors = [palette.panel, palette.accent, palette.pop, palette.glow, palette.ink];
    for (let i = 0; i < 75; i++) {
      this._add(out, texture, rng() * width, rng() * height, PX * (1 + Math.floor(rng() * 4)), PX, colors[Math.floor(rng() * colors.length)], 0.26 + rng() * 0.28);
    }
  }

  private _zebraCuts(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let y = -height; y < height * 2; y += 12 + rng() * 10) {
      const tint = rng() > 0.5 ? 0xffffff : palette.dim;
      for (let x = 0; x < width; x += PX * 2) {
        this._add(out, texture, x, y + Math.sin(x * 0.04) * 10 + x * 0.14, PX * 2, PX * 2, tint, 0.18);
      }
    }
  }

  private _sunbursts(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    const cx = rng() * width;
    const cy = rng() * height;
    for (let a = 0; a < Math.PI * 2; a += 0.18) {
      const len = 18 + rng() * Math.max(width, height) * 0.38;
      for (let r = 8; r < len; r += PX * 3) {
        this._add(out, texture, cx + Math.cos(a) * r, cy + Math.sin(a) * r, PX * 2, PX, rng() > 0.5 ? palette.glow : palette.accent, 0.18);
      }
    }
  }

  private _cloudBands(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let x = -30; x < width; x += 22) {
      const cy = height * (0.28 + rng() * 0.44);
      const h = 16 + rng() * 28;
      this._add(out, texture, x, cy, 32 + rng() * 50, h, rng() > 0.5 ? palette.glow : palette.panel, 0.18);
      this._add(out, texture, x + 10, cy - h * 0.35, 22 + rng() * 35, h * 0.55, palette.accent, 0.16);
    }
  }

  private _leafBits(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let i = 0; i < 34; i++) {
      const x = rng() * width;
      const y = rng() * height;
      const tint = rng() > 0.5 ? palette.accent : palette.glow;
      this._add(out, texture, x, y, PX * 4, PX, tint, 0.30);
      this._add(out, texture, x + PX, y - PX, PX * 2, PX * 3, tint, 0.22);
    }
  }

  private _equalizer(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let x = 0; x < width; x += 10) {
      const h = 6 + rng() * (height - 12);
      this._add(out, texture, x, height - h, 5, h, rng() > 0.5 ? palette.pop : palette.glow, 0.32);
    }
  }

  private _checkerFade(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    const cell = 12 + Math.floor(rng() * 3) * 4;
    for (let y = 0; y < height; y += cell) {
      for (let x = 0; x < width; x += cell) {
        if (((x / cell + y / cell) | 0) % 2 === 0) this._add(out, texture, x, y, cell, cell, rng() > 0.5 ? palette.accent : palette.dim, 0.16 + (x / width) * 0.20);
      }
    }
  }

  private _ribbonCut(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let i = 0; i < 5; i++) {
      const y = rng() * height;
      const h = 8 + rng() * 14;
      this._add(out, texture, 0, y, width, h, i % 2 ? palette.pop : palette.accent, 0.17);
      this._add(out, texture, width * (0.2 + rng() * 0.5), y - PX, 18 + rng() * 30, h + PX * 2, palette.glow, 0.26);
    }
  }

  private _constellation(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    let px = rng() * width;
    let py = rng() * height;
    for (let i = 0; i < 24; i++) {
      const x = rng() * width;
      const y = rng() * height;
      this._add(out, texture, x, y, PX * 2, PX * 2, palette.glow, 0.48);
      this._add(out, texture, Math.min(px, x), Math.min(py, y), Math.abs(x - px) + PX, PX, palette.accent, 0.12);
      px = x;
      py = y;
    }
  }

  private _stairSteps(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let x = 0; x < width; x += 24) {
      const steps = 3 + Math.floor(rng() * 5);
      for (let s = 0; s < steps; s++) {
        this._add(out, texture, x + s * PX * 2, height - (s + 2) * PX * 2, 22, PX * 2, rng() > 0.5 ? palette.pop : palette.panel, 0.22);
      }
    }
  }

  private _pixelSwirl(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    const cx = width * (0.35 + rng() * 0.3);
    const cy = height * (0.25 + rng() * 0.5);
    for (let t = 0; t < 42; t++) {
      const a = t * 0.42;
      const r = 2 + t * 1.8;
      this._add(out, texture, cx + Math.cos(a) * r, cy + Math.sin(a) * r, PX * 3, PX, t % 2 ? palette.accent : palette.glow, 0.34);
    }
  }

  private _xMarks(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let i = 0; i < 18; i++) {
      const x = rng() * width;
      const y = rng() * height;
      const tint = rng() > 0.5 ? palette.pop : palette.accent;
      for (let s = 0; s < 5; s++) {
        this._add(out, texture, x + s * PX, y + s * PX, PX, PX, tint, 0.32);
        this._add(out, texture, x + (4 - s) * PX, y + s * PX, PX, PX, tint, 0.32);
      }
    }
  }

  private _honeycomb(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let y = 0; y < height; y += 18) {
      for (let x = (Math.floor(y / 18) % 2) * 12; x < width; x += 26) {
        const tint = rng() > 0.5 ? palette.glow : palette.dim;
        this._add(out, texture, x, y, 12, PX, tint, 0.20);
        this._add(out, texture, x - PX, y + PX, PX, 10, tint, 0.20);
        this._add(out, texture, x + 12, y + PX, PX, 10, tint, 0.20);
      }
    }
  }

  private _drips(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let x = 0; x < width; x += 12 + rng() * 24) {
      const h = 10 + rng() * (height * 0.7);
      this._add(out, texture, x, 0, 6 + rng() * 10, h, rng() > 0.5 ? palette.pop : palette.accent, 0.25);
      this._add(out, texture, x - PX, h, PX * 3, PX * 3, palette.glow, 0.24);
    }
  }

  private _wideStripes(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    const colors = [palette.panel, palette.accent, palette.pop, palette.glow];
    for (let x = 0; x < width; x += 28 + rng() * 26) {
      this._add(out, texture, x, 0, 18 + rng() * 35, height, colors[Math.floor(rng() * colors.length)], 0.20);
    }
  }

  private _barcode(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let x = 0; x < width; x += 5 + rng() * 9) {
      const w = 2 + rng() * 7;
      this._add(out, texture, x, 6 + rng() * 10, w, height - 12 - rng() * 20, rng() > 0.5 ? palette.ink : palette.glow, 0.25);
    }
  }

  private _waveBlocks(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let x = 0; x < width; x += 10) {
      const y = height * 0.5 + Math.sin(x * 0.035) * height * 0.28;
      this._add(out, texture, x, y, 18, height - y, rng() > 0.5 ? palette.accent : palette.panel, 0.22);
    }
  }

  private _petalScatter(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let i = 0; i < 36; i++) {
      const x = rng() * width;
      const y = rng() * height;
      const tint = rng() > 0.5 ? palette.pop : palette.glow;
      this._add(out, texture, x, y, PX * 3, PX, tint, 0.30);
      this._add(out, texture, x + PX, y + PX, PX, PX * 2, tint, 0.22);
    }
  }

  private _glitch(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let i = 0; i < 26; i++) {
      this._add(out, texture, rng() * width, rng() * height, 18 + rng() * 88, PX * (1 + Math.floor(rng() * 3)), rng() > 0.5 ? palette.accent : palette.pop, 0.28);
    }
  }

  private _foam(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let i = 0; i < 45; i++) {
      const s = PX * (1 + Math.floor(rng() * 3));
      this._add(out, texture, rng() * width, rng() * height, s, s, rng() > 0.5 ? palette.glow : 0xffffff, 0.20 + rng() * 0.28);
    }
  }

  private _paintScabs(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    const colors = [palette.accent, palette.pop, palette.glow, palette.panel];
    for (let i = 0; i < 9; i++) {
      this._stainBlob(
        out,
        texture,
        width * (0.12 + rng() * 0.76),
        height * (0.14 + rng() * 0.72),
        38 + rng() * 98,
        14 + rng() * 32,
        colors[Math.floor(rng() * colors.length)],
        0.20 + rng() * 0.24,
        rng,
      );
    }
  }

  private _stainIslands(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    const colors = [palette.panel, palette.accent, palette.dim, palette.pop, palette.glow];
    const islands = 5 + Math.floor(rng() * 5);
    for (let i = 0; i < islands; i++) {
      const w = width * (0.18 + rng() * 0.34);
      const h = height * (0.20 + rng() * 0.26);
      this._stainBlob(
        out,
        texture,
        rng() * width,
        height * (0.16 + rng() * 0.68),
        w,
        h,
        colors[i % colors.length],
        0.20 + rng() * 0.24,
        rng,
      );
    }
  }

  private _inkPuddles(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    const colors = [palette.ink, palette.dim, palette.accent, palette.panel];
    for (let i = 0; i < 4; i++) {
      this._stainBlob(
        out,
        texture,
        width * (0.18 + rng() * 0.64),
        height * (0.24 + rng() * 0.52),
        width * (0.28 + rng() * 0.36),
        height * (0.18 + rng() * 0.22),
        colors[i % colors.length],
        0.16 + rng() * 0.22,
        rng,
      );
    }
    this._dotField(out, texture, width, height, [palette.ink, palette.glow, palette.pop], rng);
  }

  private _offsetSwatches(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    const colors = [palette.accent, palette.panel, palette.pop, palette.glow, palette.dim];
    const rows = 3 + Math.floor(rng() * 3);
    for (let row = 0; row < rows; row++) {
      const y = height * ((row + 0.55) / rows) + (rng() - 0.5) * 10;
      const swatches = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < swatches; i++) {
        const w = width * (0.18 + rng() * 0.24);
        const x = width * ((i + 0.5) / swatches) + (rng() - 0.5) * 42;
        this._stainBlob(out, texture, x, y, w, 18 + rng() * 22, colors[(row + i) % colors.length], 0.18 + rng() * 0.20, rng);
      }
    }
  }

  private _dryBrush(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    const colors = [palette.glow, palette.accent, palette.pop, palette.panel];
    for (let line = 0; line < 9; line++) {
      const y = height * (0.12 + rng() * 0.74);
      let x = -rng() * 30;
      while (x < width) {
        if (rng() > 0.28) {
          this._add(out, texture, x, y + (rng() - 0.5) * 10, 18 + rng() * 46, PLATE_PIXEL, colors[line % colors.length], 0.16 + rng() * 0.22);
        }
        x += 18 + rng() * 30;
      }
    }
  }

  private _splatterRail(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    const colors = [palette.accent, palette.pop, palette.glow, palette.ink];
    const rails = 2 + Math.floor(rng() * 3);
    for (let rail = 0; rail < rails; rail++) {
      const y = height * ((rail + 0.65) / (rails + 0.3));
      this._stainBlob(out, texture, width * 0.5, y, width * (0.64 + rng() * 0.22), 12 + rng() * 18, colors[rail % colors.length], 0.22 + rng() * 0.18, rng);
      for (let i = 0; i < 18; i++) {
        const size = rng() > 0.62 ? PLATE_PIXEL * 2 : PLATE_PIXEL;
        this._add(out, texture, rng() * width, y + (rng() - 0.5) * 42, size, size, colors[Math.floor(rng() * colors.length)], 0.22 + rng() * 0.28);
      }
    }
  }

  private _borderDots(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let x = 4; x < width; x += 14) {
      this._add(out, texture, x, 4, PX, PX, palette.glow, 0.42);
      this._add(out, texture, x, height - 8, PX, PX, palette.pop, 0.34);
    }
    for (let y = 8; y < height; y += 14) {
      this._add(out, texture, 4, y, PX, PX, palette.accent, 0.34);
      this._add(out, texture, width - 8, y, PX, PX, palette.glow, 0.34);
    }
    if (rng() > 0.5) this._edgeSpray(out, texture, width, height, palette, rng);
  }

  private _tileSlants(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let y = 0; y < height; y += 18) {
      for (let x = -20; x < width; x += 34) {
        this._add(out, texture, x + y * 0.6, y, 24, 8, rng() > 0.5 ? palette.panel : palette.accent, 0.22);
      }
    }
  }

  private _blockArrows(out: PIXI.Particle[], texture: PIXI.Texture, width: number, height: number, palette: Palette, rng: () => number): void {
    for (let x = 0; x < width; x += 48) {
      const y = height * (0.25 + rng() * 0.4);
      const tint = rng() > 0.5 ? palette.pop : palette.glow;
      this._add(out, texture, x, y, 28, 14, tint, 0.28);
      this._add(out, texture, x + 28, y - 8, 12, 30, tint, 0.28);
      this._add(out, texture, x + 40, y, 10, 14, palette.accent, 0.32);
    }
  }
}

interface MascotProfile {
  shape: number;
  eyes: number;
  mouth: number;
  accessory: number;
  limbs: number;
  spots: number;
  bodyColor: number;
  shade: number;
  dark: number;
  highlight: number;
  spotColor: number;
}

class PixelMascot {
  readonly view = new PIXI.Container();

  constructor(
    texture: PIXI.Texture,
    palette: Palette,
    userColor: number,
    seed: number,
  ) {
    const rng = seedRng(seed ^ 0x5ca1ab1e);
    const body = new PIXI.ParticleContainer<PIXI.Particle>({
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
    const particles: PIXI.Particle[] = [];
    const profile = this._profile(seed, palette, userColor);

    this._monsterBody(particles, texture, rng, profile);
    this._monsterExtras(particles, texture, rng, profile, true);
    this._monsterFace(particles, texture, rng, profile);
    this._monsterExtras(particles, texture, rng, profile, false);

    body.addParticle(...particles);
    body.update();

    const shadow = new PIXI.Graphics()
      .rect(7, 43, 36, 8)
      .fill(rgba(0x000000, 0.28))
      .rect(12, 47, 22, 4)
      .fill(rgba(0x000000, 0.22));

    this.view.addChild(shadow);
    this.view.addChild(body);
    this.view.scale.set(0.96);
  }

  private _profile(seed: number, palette: Palette, userColor: number): MascotProfile {
    const hue = seed % 360;
    const colors = [
      userColor,
      palette.accent,
      palette.pop,
      palette.glow,
      palette.dim,
      hslToRgb(hue + 43, 0.84, 0.56),
      hslToRgb(hue + 137, 0.78, 0.50),
      hslToRgb(hue + 221, 0.82, 0.62),
    ];
    const bodyColor = colors[Math.floor(seed / 7) % colors.length];
    const shade = mixColor(bodyColor, palette.base, 0.38);
    return {
      shape: seed % 14,
      eyes: Math.floor(seed / 13) % 10,
      mouth: Math.floor(seed / 37) % 8,
      accessory: Math.floor(seed / 73) % 14,
      limbs: Math.floor(seed / 131) % 8,
      spots: Math.floor(seed / 251) % 7,
      bodyColor,
      shade,
      dark: mixColor(shade, 0x05020a, 0.42),
      highlight: mixColor(bodyColor, 0xffffff, 0.42),
      spotColor: colors[Math.floor(seed / 409) % colors.length],
    };
  }

  private _add(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    x: number,
    y: number,
    w: number,
    h: number,
    tint: number,
    alpha = 1,
  ): void {
    out.push(new PIXI.Particle({
      texture,
      x: Math.round(x),
      y: Math.round(y),
      scaleX: Math.max(PX, Math.round(w)),
      scaleY: Math.max(PX, Math.round(h)),
      tint,
      alpha,
    }));
  }

  private _monsterBody(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    rng: () => number,
    profile: MascotProfile,
  ): void {
    const cells: boolean[][] = [];
    const cx = 6;
    const cy = profile.shape === 6 ? 7.0 : profile.shape === 4 ? 6.0 : 6.5;
    const rx = [5.0, 3.8, 5.8, 4.6, 4.8, 4.2, 3.5, 5.2, 4.4, 5.6, 3.9, 4.7, 5.1, 4.1][profile.shape];
    const ry = [4.4, 5.4, 3.6, 4.7, 4.5, 5.0, 5.3, 3.9, 4.9, 3.4, 4.2, 5.6, 4.1, 4.7][profile.shape];

    for (let y = 0; y < 13; y++) {
      cells[y] = [];
      for (let x = 0; x < 13; x++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        const fuzz = Math.sin(x * 1.3 + y * 0.7) * 0.08 + (rng() - 0.5) * 0.12;
        let inside = nx * nx + ny * ny < 1 + fuzz;

        if (profile.shape === 3) {
          const lowerBoost = y > cy ? 1.24 : 0.72;
          inside = nx * nx + (ny / lowerBoost) * (ny / lowerBoost) < 1 + fuzz;
        } else if (profile.shape === 4) {
          const width = 1.0 - Math.abs(y - 7) / 7;
          inside = Math.abs(nx) < width * 0.92 && y > 1 && y < 12;
        } else if (profile.shape === 6) {
          const cap = ((x - cx) / 5.2) ** 2 + ((y - 4) / 2.8) ** 2 < 1.05;
          const stem = Math.abs(x - cx) < 2.6 && y >= 5 && y < 12;
          inside = cap || stem;
        } else if (profile.shape === 9) {
          inside = Math.abs(ny) < 0.95 && Math.abs(nx) < 0.9 + Math.sin(y * 0.8) * 0.08;
        } else if (profile.shape === 10) {
          inside = (nx * nx + ny * ny < 0.86 + fuzz) || (x === 6 && y < 3);
        }

        cells[y][x] = inside;
      }
    }

    for (let y = 0; y < 13; y++) {
      for (let x = 0; x < 13; x++) {
        if (!cells[y][x]) continue;
        const edge = !cells[y - 1]?.[x] || !cells[y + 1]?.[x] || !cells[y]?.[x - 1] || !cells[y]?.[x + 1];
        const baseTint = y > cy + 1.3 ? profile.shade : profile.bodyColor;
        const tint = edge ? profile.dark : baseTint;
        this._add(out, texture, x * PX, y * PX, PX, PX, tint, 0.98);
      }
    }

    if (profile.spots > 0) {
      const count = 2 + profile.spots;
      for (let i = 0; i < count; i++) {
        const x = 2 + Math.floor(rng() * 9);
        const y = 3 + Math.floor(rng() * 7);
        if (cells[y]?.[x]) {
          const tint = i % 2 === 0 ? profile.highlight : mixColor(profile.spotColor, profile.dark, 0.2);
          this._add(out, texture, x * PX, y * PX, PX, PX, tint, 0.62);
        }
      }
    }
  }

  private _monsterFace(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    rng: () => number,
    profile: MascotProfile,
  ): void {
    const eyeColor = profile.eyes % 3 === 0 ? 0xfaff77 : profile.eyes % 3 === 1 ? 0xafffff : 0xffffff;
    const pupil = 0x120715;
    const mouth = 0x13070c;
    const tooth = 0xfff0b5;

    if (profile.eyes === 0) {
      this._eye(out, texture, 3, 3, eyeColor, pupil);
      this._eye(out, texture, 7, 3, eyeColor, pupil);
    } else if (profile.eyes === 1) {
      this._eye(out, texture, 5, 3, eyeColor, pupil, 3);
      this._add(out, texture, 8 * PX, 2 * PX, PX, PX, profile.highlight, 0.78);
    } else if (profile.eyes === 2) {
      this._eye(out, texture, 2, 2, eyeColor, pupil);
      this._eye(out, texture, 8, 4, eyeColor, pupil);
    } else if (profile.eyes === 3) {
      this._add(out, texture, 3 * PX, 4 * PX, 3 * PX, PX, pupil, 0.92);
      this._add(out, texture, 7 * PX, 4 * PX, 3 * PX, PX, pupil, 0.92);
    } else if (profile.eyes === 4) {
      this._eye(out, texture, 2, 3, eyeColor, pupil);
      this._eye(out, texture, 5, 2, eyeColor, pupil);
      this._eye(out, texture, 8, 3, eyeColor, pupil);
    } else if (profile.eyes === 5) {
      this._eye(out, texture, 5, 2, eyeColor, pupil);
      this._add(out, texture, 3 * PX, 4 * PX, 2 * PX, PX, pupil, 0.9);
      this._add(out, texture, 8 * PX, 4 * PX, 2 * PX, PX, pupil, 0.9);
    } else if (profile.eyes === 6) {
      this._eye(out, texture, 4, 3, eyeColor, pupil);
      this._eye(out, texture, 8, 3, eyeColor, pupil);
      this._add(out, texture, 2 * PX, 2 * PX, 3 * PX, PX, profile.dark, 0.72);
      this._add(out, texture, 8 * PX, 2 * PX, 3 * PX, PX, profile.dark, 0.72);
    } else if (profile.eyes === 7) {
      this._eye(out, texture, 5, 2, eyeColor, pupil, 2);
      this._eye(out, texture, 5, 5, eyeColor, pupil, 2);
    } else {
      this._eye(out, texture, 3, 3, eyeColor, pupil);
      this._eye(out, texture, 8, 3, eyeColor, pupil);
      if (profile.eyes === 9) this._eye(out, texture, 6, 1, eyeColor, pupil);
    }

    const mouthY = profile.shape === 4 ? 8 : 7;
    if (profile.mouth === 0) {
      this._add(out, texture, 3 * PX, mouthY * PX, 6 * PX, 2 * PX, mouth, 0.96);
      this._add(out, texture, 4 * PX, mouthY * PX, PX, PX, tooth, 0.98);
      this._add(out, texture, 7 * PX, mouthY * PX, PX, PX, tooth, 0.98);
    } else if (profile.mouth === 1) {
      this._add(out, texture, 4 * PX, mouthY * PX, 4 * PX, 3 * PX, mouth, 0.96);
      this._add(out, texture, 5 * PX, (mouthY + 2) * PX, PX, PX, 0xff6b7d, 0.95);
    } else if (profile.mouth === 2) {
      this._add(out, texture, 4 * PX, mouthY * PX, 5 * PX, PX, mouth, 0.96);
    } else if (profile.mouth === 3) {
      this._add(out, texture, 3 * PX, mouthY * PX, 7 * PX, PX, mouth, 0.96);
      this._add(out, texture, 4 * PX, (mouthY + 1) * PX, PX, PX, tooth, 0.98);
      this._add(out, texture, 8 * PX, (mouthY + 1) * PX, PX, PX, tooth, 0.98);
    } else if (profile.mouth === 4) {
      this._add(out, texture, 5 * PX, mouthY * PX, 3 * PX, PX, mouth, 0.96);
      this._add(out, texture, 4 * PX, (mouthY + 1) * PX, PX, PX, mouth, 0.96);
      this._add(out, texture, 8 * PX, (mouthY + 1) * PX, PX, PX, mouth, 0.96);
    } else if (profile.mouth === 5) {
      this._add(out, texture, 4 * PX, mouthY * PX, 5 * PX, 3 * PX, mouth, 0.96);
      this._add(out, texture, 5 * PX, mouthY * PX, PX, PX, tooth, 0.98);
      this._add(out, texture, 7 * PX, mouthY * PX, PX, PX, tooth, 0.98);
    } else {
      this._add(out, texture, 4 * PX, mouthY * PX, 5 * PX, 2 * PX, mouth, 0.92);
      this._add(out, texture, 6 * PX, mouthY * PX, PX, PX, tooth, 0.98);
    }
    if (profile.mouth === 1 || profile.mouth === 5 || rng() > 0.82) {
      this._add(out, texture, 5 * PX, (mouthY + 2) * PX, 2 * PX, PX, 0xff6b7d, 0.95);
    }
  }

  private _eye(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    x: number,
    y: number,
    eyeColor: number,
    pupil: number,
    size = 2,
  ): void {
    this._add(out, texture, x * PX, y * PX, size * PX, size * PX, eyeColor, 0.98);
    this._add(out, texture, (x + size - 1) * PX, (y + size - 1) * PX, PX, PX, pupil, 1);
  }

  private _monsterExtras(
    out: PIXI.Particle[],
    texture: PIXI.Texture,
    rng: () => number,
    profile: MascotProfile,
    behindBody: boolean,
  ): void {
    if (behindBody) {
      if (profile.accessory === 4 || profile.accessory === 11) {
        this._add(out, texture, -2 * PX, 5 * PX, 4 * PX, 3 * PX, profile.shade, 0.84);
        this._add(out, texture, 11 * PX, 5 * PX, 4 * PX, 3 * PX, profile.shade, 0.84);
        this._add(out, texture, -PX, 4 * PX, 2 * PX, PX, profile.highlight, 0.5);
        this._add(out, texture, 12 * PX, 4 * PX, 2 * PX, PX, profile.highlight, 0.5);
      }
      if (profile.accessory === 5 || profile.accessory === 12) {
        this._add(out, texture, 11 * PX, 8 * PX, 4 * PX, PX, profile.dark, 0.9);
        this._add(out, texture, 14 * PX, 7 * PX, PX, 2 * PX, profile.shade, 0.9);
      }
      return;
    }

    if (profile.accessory === 0 || profile.accessory === 7) {
      this._add(out, texture, 2 * PX, 0, PX, 3 * PX, profile.dark, 0.95);
      this._add(out, texture, 9 * PX, 0, PX, 3 * PX, profile.dark, 0.95);
      this._add(out, texture, 2 * PX, 0, 2 * PX, PX, profile.highlight, 0.8);
      this._add(out, texture, 8 * PX, 0, 2 * PX, PX, profile.highlight, 0.8);
    } else if (profile.accessory === 1 || profile.accessory === 8) {
      for (let i = 0; i < 3; i++) {
        this._add(out, texture, (4 + i) * PX, (1 - i) * PX, PX, 4 * PX, profile.highlight, 0.86);
      }
    } else if (profile.accessory === 2) {
      for (let i = 0; i < 5; i++) {
        this._add(out, texture, (3 + i) * PX, (i % 2) * PX, PX, 2 * PX, profile.dark, 0.9);
      }
    } else if (profile.accessory === 3 || profile.accessory === 10) {
      this._add(out, texture, 0, 4 * PX, 2 * PX, 3 * PX, profile.shade, 0.9);
      this._add(out, texture, 11 * PX, 4 * PX, 2 * PX, 3 * PX, profile.shade, 0.9);
    } else if (profile.accessory === 6) {
      this._add(out, texture, 4 * PX, 0, 4 * PX, PX, profile.highlight, 0.8);
      this._add(out, texture, 5 * PX, -PX, 2 * PX, PX, profile.spotColor, 0.88);
    } else if (profile.accessory === 9) {
      this._add(out, texture, 4 * PX, -PX, 4 * PX, 2 * PX, 0xffb53d, 0.92);
      this._add(out, texture, 5 * PX, -2 * PX, 2 * PX, PX, 0xffef67, 0.92);
    } else if (profile.accessory === 13) {
      this._add(out, texture, 3 * PX, 0, 6 * PX, PX, profile.dark, 0.82);
      this._add(out, texture, 5 * PX, -PX, 2 * PX, PX, profile.dark, 0.82);
    }

    if (profile.limbs === 1 || profile.limbs === 4) {
      this._add(out, texture, 0, 7 * PX, 3 * PX, PX, profile.bodyColor, 0.95);
      this._add(out, texture, 10 * PX, 7 * PX, 3 * PX, PX, profile.bodyColor, 0.95);
      this._add(out, texture, 0, 8 * PX, PX, 2 * PX, profile.shade, 0.95);
      this._add(out, texture, 12 * PX, 8 * PX, PX, 2 * PX, profile.shade, 0.95);
    } else if (profile.limbs === 2 || profile.limbs === 6) {
      this._add(out, texture, PX, 8 * PX, 2 * PX, 2 * PX, profile.shade, 0.95);
      this._add(out, texture, 10 * PX, 8 * PX, 2 * PX, 2 * PX, profile.shade, 0.95);
    } else if (profile.limbs === 3) {
      this._add(out, texture, 0, 6 * PX, 2 * PX, PX, profile.dark, 0.9);
      this._add(out, texture, 11 * PX, 6 * PX, 2 * PX, PX, profile.dark, 0.9);
    }

    if (profile.limbs !== 0 || rng() > 0.58) {
      this._add(out, texture, 2 * PX, 11 * PX, 2 * PX, PX, profile.dark, 0.95);
      this._add(out, texture, 8 * PX, 11 * PX, 2 * PX, PX, profile.dark, 0.95);
    }
  }
}

class ChatCard {
  readonly view = new PIXI.Container();
  readonly height: number;
  private readonly lifetime = CARD_LIFETIME;
  private age = 0;
  private targetY = 0;
  private positioned = false;
  private readonly width: number;
  private readonly bg = new PIXI.Graphics();
  private readonly glitch = new PIXI.Graphics();
  private readonly glitchSeed: number;
  private readonly glitchColors: number[];

  constructor(
    app: PIXI.Application,
    texture: PIXI.Texture,
    msg: VisualEventMsg,
    width: number,
    palette: Palette,
    userSeed: number,
    userAccent: number,
    mascotSeed: number,
    plateSeed: number,
  ) {
    this.width = width;
    this.glitchSeed = plateSeed;
    this.glitchColors = [palette.glow, userAccent, palette.pop, 0xffffff];
    this.view.label = `chat:${msg.username}`;
    this.view.x = 0;
    this.view.alpha = 0;

    const avatarSize = 32;
    const avatarRightPad = 24;
    const avatarX = width - avatarRightPad - avatarSize;
    const textX = 74;
    const wrap = Math.max(180, avatarX - textX - 18);
    const name = new PIXI.Text({
      text: msg.username || 'anonymous',
      style: {
        fontFamily: '"Courier New", monospace',
        fontSize: 18,
        fontWeight: '900',
        fill: 0x08070b,
        letterSpacing: 0,
        stroke: {
          color: 0xffffff,
          width: 4,
        },
        dropShadow: {
          color: 0x000000,
          alpha: 0.55,
          distance: 2,
          blur: 0,
        },
      },
    });
    const tag = new PIXI.Text({
      text: eventLabel(msg.event),
      style: {
        fontFamily: '"Courier New", monospace',
        fontSize: 11,
        fontWeight: '900',
        fill: userAccent,
        letterSpacing: 0,
        stroke: {
          color: 0x0b0710,
          width: 2,
        },
      },
    });
    const content = this._makeMessageContent(msg, palette, wrap);

    name.x = textX;
    name.y = 15;
    tag.x = Math.max(textX, avatarX - tag.width - 14);
    tag.y = 19;
    content.x = textX;
    content.y = 39;

    this.height = Math.max(76, Math.ceil(content.height + 56));
    this._drawFrame(palette, userAccent, plateSeed);

    const pattern = new PixelPattern(texture, width - 16, this.height - 14, palette, plateSeed);
    pattern.view.x = 8;
    pattern.view.y = 7;
    pattern.view.alpha = 0.9;
    const patternMask = new PIXI.Graphics();
    this._stainShapeFill(patternMask, 8, 7, width - 16, this.height - 14, plateSeed, 0xffffff);
    patternMask.renderable = false;
    pattern.view.mask = patternMask;

    const avatar = this._makeAvatar(texture, userSeed, palette, userAccent, messageAvatarUrl(msg));
    avatar.x = avatarX;
    avatar.y = Math.round((this.height - avatarSize) / 2);

    const mascot = new PixelMascot(texture, palette, userAccent, mascotSeed);
    mascot.view.x = -14;
    mascot.view.y = Math.max(30, this.height - 58);

    this.view.addChild(this.bg);
    this.view.addChild(patternMask);
    this.view.addChild(pattern.view);
    this.view.addChild(mascot.view);
    this.view.addChild(avatar);
    this.view.addChild(name);
    this.view.addChild(tag);
    this.view.addChild(content);
    this.view.addChild(this.glitch);

    app.stage.addChild(this.view);
  }

  private _makeMessageContent(msg: VisualEventMsg, palette: Palette, wrap: number): PIXI.Container {
    const content = new PIXI.Container();
    const style = {
      fontFamily: '"Courier New", monospace',
      fontSize: 17,
      fontWeight: '900' as const,
      fill: 0xffffff,
      lineHeight: 24,
      letterSpacing: 0,
      stroke: {
        color: 0x0b0710,
        width: 3,
      },
      dropShadow: {
        color: 0x000000,
        alpha: 0.35,
        distance: 2,
        blur: 0,
      },
    };
    const imageSize = 24;
    const gap = 4;
    const lineHeight = 24;
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
        if (label.width > wrap) {
          label.scale.x = wrap / label.width;
        }
        place(label, Math.min(label.width, wrap), label.height);
      }
    };

    const addImage = (part: MessagePart) => {
      if (!part.url) return;
      const holder = new PIXI.Container();
      const backing = new PIXI.Graphics()
        .rect(0, 0, imageSize, imageSize)
        .fill(rgba(palette.base, 0.55))
        .rect(2, 2, imageSize - 4, imageSize - 4)
        .stroke({ color: palette.ink, width: 2, alpha: 0.38 });
      holder.addChild(backing);
      this._loadInlineImage(part.url, holder, imageSize);
      place(holder, imageSize, imageSize);
    };

    for (const part of renderParts(msg)) {
      if (part.type === 'image') {
        addImage(part);
      } else {
        addText(part.text ?? '');
      }
    }

    if (!hasContent) addText(messageText(msg));
    return content;
  }

  private _loadInlineImage(url: string, holder: PIXI.Container, size: number): void {
    PIXI.Assets.load<PIXI.Texture>({ src: url, parser: 'texture' })
      .then((texture) => {
        if ((holder as PIXI.Container & { destroyed?: boolean }).destroyed) return;
        const sprite = new PIXI.Sprite(texture);
        const maxSide = Math.max(sprite.width, sprite.height, 1);
        const scale = (size - 2) / maxSide;
        sprite.scale.set(scale);
        sprite.x = Math.round((size - sprite.width) / 2);
        sprite.y = Math.round((size - sprite.height) / 2);
        holder.addChild(sprite);
      })
      .catch(() => {
        const fallback = new PIXI.Text({
          text: '?',
          style: {
            fontFamily: '"Courier New", monospace',
            fontSize: 14,
            fontWeight: '700',
            fill: 0xffffff,
            letterSpacing: 0,
          },
        });
        fallback.x = Math.round((size - fallback.width) / 2);
        fallback.y = Math.round((size - fallback.height) / 2);
        holder.addChild(fallback);
      });
  }

  setTarget(x: number, y: number): void {
    this.targetY = y;
    this.view.x = x;
    if (!this.positioned) {
      this.view.y = y;
      this.view.alpha = 0;
      this.view.scale.set(1);
      this.positioned = true;
    }
  }

  update(delta: number, x: number): boolean {
    this.age += delta;
    const enter = clamp(this.age / 24, 0, 1);
    const leave = this.age > this.lifetime - 55 ? clamp((this.lifetime - this.age) / 55, 0, 1) : 1;
    const entering = 1 - Math.pow(1 - enter, 3);
    const exitGlitch = leave < 1 ? 1 - leave : 0;
    const enterGlitch = 1 - enter;
    const glitchAmount = Math.max(exitGlitch, enterGlitch);
    const pulse = Math.sin((this.age + this.glitchSeed % 41) * 1.7);
    const snap = Math.sin((this.age + this.glitchSeed % 67) * 5.2);
    const jitter = Math.round((pulse * 5 + snap * 2) * glitchAmount / PX) * PX;

    this.view.x = x + jitter;
    this.view.y += (this.targetY - this.view.y) * 0.22 * delta;
    this.view.alpha = entering * leave * (0.72 + 0.28 * clamp(1 - glitchAmount + Math.abs(pulse) * glitchAmount, 0, 1));
    this.view.scale.set(1 + glitchAmount * 0.015 * (snap > 0 ? 1 : -1));
    this._drawGlitch(glitchAmount);

    return this.age >= this.lifetime;
  }

  private _drawGlitch(amount: number): void {
    const g = this.glitch;
    g.clear();
    if (amount < 0.04) return;

    const rng = seedRng(this.glitchSeed ^ Math.floor(this.age * 13));
    const strips = 3 + Math.floor(amount * 9);
    for (let i = 0; i < strips; i++) {
      const y = snapPixel(rng() * this.height, PX);
      const h = PX * (1 + Math.floor(rng() * 2));
      const w = this.width * (0.12 + rng() * 0.46);
      const x = snapPixel((rng() - 0.08) * this.width, PX);
      const color = this.glitchColors[Math.floor(rng() * this.glitchColors.length)];
      g.rect(x, y, w, h).fill(rgba(color, 0.18 + amount * 0.34));
      if (rng() > 0.45) {
        g.rect(x + PX * (2 + Math.floor(rng() * 8)), y + h, w * (0.35 + rng() * 0.45), PX)
          .fill(rgba(0xffffff, 0.14 + amount * 0.24));
      }
    }
  }

  private _drawFrame(palette: Palette, userColor: number, plateSeed: number): void {
    const g = this.bg;
    const w = this.width;
    const h = this.height;
    g.clear();

    this._stainShapeFill(g, PX, PX, w, h, plateSeed ^ 0x3001, rgba(0x000000, 0.48));
    this._stainShapeFill(g, 0, 0, w, h, plateSeed ^ 0x100d13, 0x100d13);
    this._stainShapeFill(g, PX, PX, w - PX * 2, h - PX * 2, plateSeed, rgba(palette.base, 0.90));
    this._stainShapeFill(g, PX * 2, PX * 2, w - PX * 4, h - PX * 4, plateSeed ^ 0x517a, rgba(palette.panel, 0.38));
    this._stainShapeFill(g, PX * 3, PX * 3, w - PX * 6, h - PX * 6, plateSeed ^ 0xb10b, rgba(palette.base, 0.58));
    this._stainStripe(g, PX * 4, PX * 2, w - PX * 8, 10, plateSeed ^ 0xa11, rgba(userColor, 0.94));
    this._stainStripe(g, PX * 5, h - 12, w - PX * 10, PX * 2, plateSeed ^ 0x6100, rgba(palette.glow, 0.48));
    this._stainShapeFill(g, 10, 10, 44, h - 20, plateSeed ^ 0x44, rgba(0xffffff, 0.13));
    this._stainShapeFill(g, 14, 14, 36, h - 28, plateSeed ^ 0x22, rgba(userColor, 0.22));
  }

  private _stainStripe(
    g: PIXI.Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    seed: number,
    fill: number | { color: number; alpha: number },
  ): void {
    const rng = seedRng(seed);
    const step = PX;
    for (let px = x; px < x + w; px += step * (1 + Math.floor(rng() * 3))) {
      const blockW = step * (2 + Math.floor(rng() * 6));
      const blockH = Math.max(step, h + (rng() - 0.5) * step * 2);
      g.rect(px, y + (rng() - 0.5) * step, blockW, blockH).fill(fill);
    }
  }

  private _stainShapeFill(
    g: PIXI.Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    seed: number,
    fill: number | { color: number; alpha: number },
  ): void {
    const rng = seedRng(seed);
    const step = PLATE_PIXEL;
    const rows = Math.max(3, Math.ceil(h / step));
    const phaseA = rng() * Math.PI * 2;
    const phaseB = rng() * Math.PI * 2;
    const maxInset = Math.min(w * 0.16, 34 + rng() * 18);

    for (let row = 0; row < rows; row++) {
      const t = rows <= 1 ? 0.5 : row / (rows - 1);
      const edge = Math.abs(t - 0.5) * 2;
      const rowY = y + row * step;
      const rowH = Math.min(step, y + h - rowY);
      const leftWave = Math.sin(row * 0.88 + phaseA) * 9 + Math.sin(row * 0.37 + phaseB) * 7;
      const rightWave = Math.cos(row * 0.74 + phaseB) * 10 + Math.sin(row * 0.29 + phaseA) * 6;
      const taper = Math.pow(edge, 1.55) * maxInset;
      const left = snapPixel(Math.max(0, taper + leftWave + (rng() - 0.5) * 12), PX);
      const right = snapPixel(Math.max(0, taper + rightWave + (rng() - 0.5) * 12), PX);
      const rowW = Math.max(step * 4, w - left - right);
      g.rect(x + left, rowY, rowW, rowH).fill(fill);

      if (rng() > 0.50) {
        const blobW = step * (1 + Math.floor(rng() * 3));
        g.rect(x + left - blobW, rowY, blobW, rowH).fill(fill);
      }
      if (rng() > 0.50) {
        const blobW = step * (1 + Math.floor(rng() * 3));
        g.rect(x + left + rowW, rowY, blobW, rowH).fill(fill);
      }
    }

    const specks = 10 + Math.floor(rng() * 14);
    for (let i = 0; i < specks; i++) {
      const side = rng();
      const px = side < 0.33 ? x + rng() * w : side < 0.66 ? x - step + rng() * step * 2 : x + w - rng() * step;
      const py = side < 0.33 ? y + (rng() > 0.5 ? -step : h) + (rng() - 0.5) * step : y + rng() * h;
      const size = step * (rng() > 0.72 ? 2 : 1);
      g.rect(snapPixel(px, PX), snapPixel(py, PX), size, size).fill(fill);
    }
  }

  private _pixelRoundFill(
    g: PIXI.Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    radius: number,
    fill: number | { color: number; alpha: number },
  ): void {
    const step = PX;
    const steps = Math.max(0, Math.floor(radius / step));
    if (steps === 0 || w <= radius * 2 || h <= radius * 2) {
      g.rect(x, y, w, h).fill(fill);
      return;
    }

    g.rect(x, y + radius, w, h - radius * 2).fill(fill);
    for (let i = 0; i < steps; i++) {
      const inset = (steps - i) * step;
      const rowY = y + i * step;
      const rowW = w - inset * 2;
      g.rect(x + inset, rowY, rowW, step).fill(fill);
      g.rect(x + inset, y + h - rowY + y - step, rowW, step).fill(fill);
    }
  }

  private _makeAvatar(
    texture: PIXI.Texture,
    seed: number,
    palette: Palette,
    userColor: number,
    avatarUrl?: string | null,
  ): PIXI.Container {
    const view = new PIXI.Container();
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
    const rng = seedRng(seed ^ 0xfeedbabe);
    const colors = [palette.ink, userColor, palette.glow, palette.pop, palette.base];
    const particles: PIXI.Particle[] = [];
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const mirrorX = x > 3 ? 6 - x : x;
        const filled = rng() + mirrorX * 0.08 + y * 0.025 > 0.42;
        if (!filled) continue;
        particles.push(new PIXI.Particle({
          texture,
          x: x * PX,
          y: y * PX,
          scaleX: PX,
          scaleY: PX,
          tint: colors[Math.floor(rng() * colors.length)],
          alpha: 0.92,
        }));
      }
    }
    fallback.addParticle(...particles);
    fallback.update();
    view.addChild(fallback);

    if (avatarUrl) {
      this._loadAvatarImage(avatarUrl, view, fallback);
    }
    return view;
  }

  private _loadAvatarImage(
    url: string,
    view: PIXI.Container,
    fallback: PIXI.Container,
  ): void {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.referrerPolicy = 'no-referrer';

    image.onload = () => {
      if ((view as PIXI.Container & { destroyed?: boolean }).destroyed) return;
      fallback.alpha = 0;

      const sprite = new PIXI.Sprite(PIXI.Texture.from(image));
      sprite.roundPixels = true;
      const size = 28;
      const scale = size / Math.max(image.naturalWidth, image.naturalHeight, 1);
      sprite.scale.set(scale);
      sprite.x = Math.round((size - sprite.width) / 2);
      sprite.y = Math.round((size - sprite.height) / 2);

      view.addChild(sprite);
    };
    image.onerror = () => {
      console.warn('[ChatOverlay] avatar image failed to load:', url);
      fallback.alpha = 1;
    };
    image.src = url;
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

class ChatOverlay {
  private app: PIXI.Application | null = null;
  private pixelTexture: PIXI.Texture | null = null;
  private cards: ChatCard[] = [];
  private userAccents = new Map<string, number>();
  private userMascotSeeds = new Map<string, number>();
  private messageSerial = 0;
  private ws: WebSocket | null = null;
  private wsRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private burstLayer: PIXI.ParticleContainer<PIXI.Particle> | null = null;
  private burstParticles: MovingParticle[] = [];

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

    window.addEventListener('resize', () => this._layoutCards());
    this._seedPreview();
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
      ws.onopen = () => console.log('[ChatOverlay] WebSocket connected:', wsUrl);
      ws.onmessage = (evt: MessageEvent<string>) => {
        try {
          this.spawn(JSON.parse(evt.data) as VisualEventMsg);
        } catch (error) {
          console.warn('[ChatOverlay] WebSocket parse error:', error);
        }
      };
      ws.onclose = () => {
        this.wsRetryTimer = setTimeout(() => this.connectWebSocket(), 3000);
      };
      ws.onerror = () => ws.close();
    } catch (error) {
      console.warn('[ChatOverlay] WebSocket setup failed:', error);
      this.wsRetryTimer = setTimeout(() => this.connectWebSocket(), 3000);
    }
  }

  spawn(msg: VisualEventMsg): void {
    if (!this.app || !this.pixelTexture) return;
    const userKey = this._userKey(msg.username);
    const userSeed = msg.seed ?? hashSeed(userKey);
    const userAccent = this._userAccent(msg, userKey, userSeed);
    const mascotSeed = this._mascotSeed(userKey);
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
    this.userAccents.set(userKey, accent);
    return accent;
  }

  private _mascotSeed(userKey: string): number {
    const existing = this.userMascotSeeds.get(userKey);
    if (existing !== undefined) return existing;

    const seed = hashSeed(`mascot:${userKey}`);
    this.userMascotSeeds.set(userKey, seed);
    return seed;
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
    const examples: VisualEventMsg[] = [
      {
        event: 'chat_message',
        username: 'pixelwitch',
        text: 'this overlay is crisp and loud in exactly the right way',
        color: '#18d4ad',
        seed: 1042,
        avatar_url: 'https://static-cdn.jtvnw.net/jtv_user_pictures/xarth/404_user_70x70.png',
      },
      {
        event: 'chat_message',
        username: 'worxbend',
        text: 'procedural cards with emotes inline',
        color: '#ff9e88',
        seed: 2024,
        parts: [
          { type: 'text', text: 'procedural cards ' },
          {
            type: 'image',
            name: '❤️',
            url: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/2764.png',
          },
          { type: 'text', text: ' with emotes ' },
          {
            type: 'image',
            name: 'Kappa',
            url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/3.0',
          },
          { type: 'text', text: ' inline' },
        ],
      },
      {
        event: 'chat_message',
        username: 'neonforge',
        text: 'every banner rolls a different procedural plate',
        color: '#7cf7ff',
        seed: 3911,
      },
      {
        event: 'cheer',
        username: 'arcadeghost',
        color: '#ffd35a',
        seed: 7337,
        data: { bits: 420 },
      },
    ];
    this.spawn(examples[0]);
    setTimeout(() => this.spawn(examples[1]), 550);
    setTimeout(() => this.spawn(examples[2]), 1100);
    setTimeout(() => this.spawn(examples[3]), 1650);
  }
}

const overlay = new ChatOverlay();
overlay.init().then(() => {
  overlay.connectWebSocket();
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key !== ' ') return;
    const seed = Math.floor(Math.random() * 0xffffff);
    overlay.spawn({
      event: 'chat_message',
      username: `viewer${seed % 97}`,
      text: 'fresh chat signal rendered as pixel-card energy',
      color: `#${seed.toString(16).padStart(6, '0')}`,
      seed,
    });
  });
});
