declare global {
  interface Window {
    VIZER_WS_URL?: string;
  }
}

export type VisualEventName =
  | 'chat_message'
  | 'follow'
  | 'sub'
  | 'cheer'
  | 'raid'
  | 'gift_sub';

export interface EmoteItem {
  name: string;
  url: string;
  /** Canonical animated-image URL, resolved by normalizeEventMsg. */
  animatedUrl?: string;
  /** Canonical static-image URL, resolved by normalizeEventMsg. */
  staticUrl?: string;
  /** @deprecated wire-format alias; use animatedUrl. */
  animated_url?: string;
  /** @deprecated wire-format alias; use staticUrl. */
  static_url?: string;
}

export interface MessagePart {
  type: 'text' | 'image';
  text?: string;
  name?: string;
  url?: string;
  /** Canonical animated-image URL, resolved by normalizeEventMsg. */
  animatedUrl?: string;
  /** Canonical static-image URL, resolved by normalizeEventMsg. */
  staticUrl?: string;
  /** @deprecated wire-format alias; use animatedUrl. */
  animated_url?: string;
  /** @deprecated wire-format alias; use staticUrl. */
  static_url?: string;
}

export interface VisualEventMsg {
  event: VisualEventName;
  username: string;
  text?: string;
  color?: string;
  seed?: number;
  /** Canonical avatar URL, resolved by normalizeEventMsg from all wire aliases. */
  avatarUrl?: string | null;
  /** @deprecated wire-format alias; use avatarUrl. */
  avatar_url?: string | null;
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

/**
 * Raw wire message as the backend may send it. The backend emits snake_case,
 * but older payloads and hand-written test events may use camelCase or one of
 * several avatar aliases, so parsing stays tolerant here — and only here.
 */
interface RawEventMsg extends VisualEventMsg {
  profile_image_url?: string | null;
  profileImageUrl?: string | null;
  profile_image?: string | null;
  profileImage?: string | null;
}

function normalizePart<T extends EmoteItem | MessagePart>(part: T): T {
  return {
    ...part,
    animatedUrl: part.animated_url ?? part.animatedUrl,
    staticUrl: part.static_url ?? part.staticUrl,
  };
}

/**
 * Collapses every wire-format alias into the canonical camelCase fields
 * (avatarUrl, animatedUrl, staticUrl). OverlayEventSocket applies this to
 * every incoming message, so scenes never need to coalesce aliases.
 */
export function normalizeEventMsg(raw: RawEventMsg): VisualEventMsg {
  return {
    ...raw,
    avatarUrl:
      raw.avatar_url
      ?? raw.avatarUrl
      ?? raw.profile_image_url
      ?? raw.profileImageUrl
      ?? raw.profile_image
      ?? raw.profileImage
      ?? null,
    emotes: raw.emotes?.map(normalizePart),
    parts: raw.parts?.map(normalizePart),
  };
}

interface OverlayEventSocketOptions {
  label: string;
  onEvent: (msg: VisualEventMsg) => void;
  retryDelayMs?: number;
  url?: string;
}

const MAX_RETRY_DELAY_MS = 30_000;

export class OverlayEventSocket {
  private readonly retryDelayMs: number;
  private readonly url?: string;
  private ws: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempts = 0;
  private closedByClient = false;

  constructor(private readonly options: OverlayEventSocketOptions) {
    this.retryDelayMs = options.retryDelayMs ?? 3000;
    this.url = options.url;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    this.closedByClient = false;
    this.clearRetryTimer();

    try {
      const wsUrl = this.url ?? getWebSocketUrl();
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      ws.onopen = () => {
        this.retryAttempts = 0;
        console.log(`[${this.options.label}] WebSocket connected:`, wsUrl);
      };
      ws.onmessage = (evt: MessageEvent<string>) => this.handleMessage(evt);
      ws.onclose = () => this.handleClose(ws);
      ws.onerror = () => ws.close();
    } catch (error) {
      console.warn(`[${this.options.label}] WebSocket setup failed:`, error);
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.closedByClient = true;
    this.clearRetryTimer();
    this.ws?.close();
    this.ws = null;
  }

  private handleMessage(evt: MessageEvent<string>): void {
    try {
      this.options.onEvent(normalizeEventMsg(JSON.parse(evt.data) as RawEventMsg));
    } catch (error) {
      console.warn(`[${this.options.label}] WebSocket parse error:`, error);
    }
  }

  private handleClose(ws: WebSocket): void {
    if (this.ws !== ws) return;
    this.ws = null;
    if (!this.closedByClient) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.clearRetryTimer();
    // Capped exponential backoff with jitter, so many browser sources left
    // running against a downed backend do not all retry in sync.
    const base = Math.min(MAX_RETRY_DELAY_MS, this.retryDelayMs * 2 ** this.retryAttempts);
    const delay = base * (0.5 + Math.random() / 2);
    this.retryAttempts++;
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private clearRetryTimer(): void {
    if (!this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}

/**
 * Overlay classes bootstrapped by bootstrapOverlay: async setup, then a
 * WebSocket connection to the backend event stream.
 */
export interface BootstrappableOverlay {
  init(): Promise<void>;
  connectWebSocket(): void;
}

/**
 * Standard scene startup: init the overlay, connect its socket, wire the
 * spacebar test trigger, and log (rather than silently swallow) init failures.
 */
export function bootstrapOverlay(
  overlay: BootstrappableOverlay,
  options: { label?: string; onTestKey?: () => void } = {},
): void {
  const label = options.label ?? 'Overlay';
  overlay
    .init()
    .then(() => {
      overlay.connectWebSocket();
      if (options.onTestKey) {
        window.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === ' ') options.onTestKey!();
        });
      }
    })
    .catch((error: unknown) => {
      console.error(`[${label}] Failed to initialize overlay:`, error);
    });
}

export function seedRng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function colorFromString(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  let hex = value.startsWith('#') ? value.slice(1) : value;
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    hex = hex.replace(/./g, (ch) => ch + ch);
  }
  if (!/^[0-9a-f]{6}$/i.test(hex)) return fallback;
  return Number.parseInt(hex, 16);
}

/** Relative luminance (WCAG coefficients) of a packed 0xRRGGBB color, 0..1. */
export function luminance(color: number): number {
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function hslToRgb(h: number, s: number, l: number): number {
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

  return (
    (Math.round((r + m) * 255) << 16)
    | (Math.round((g + m) * 255) << 8)
    | Math.round((b + m) * 255)
  );
}

export function mixColor(a: number, b: number, t: number): number {
  const clamped = clamp(t, 0, 1);
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  return (
    (Math.round(ar + (br - ar) * clamped) << 16)
    | (Math.round(ag + (bg - ag) * clamped) << 8)
    | Math.round(ab + (bb - ab) * clamped)
  );
}

/** Builds a PIXI fill-style object from a packed 0xRRGGBB color and alpha. */
export function fillStyle(color: number, alpha: number): { color: number; alpha: number } {
  return { color, alpha };
}

/** @deprecated misleading name — use fillStyle. */
export const rgba = fillStyle;

function defaultWebSocketUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = location.host || 'localhost:8080';
  return `${proto}//${host}/ws`;
}

export function normalizeWebSocketUrl(rawUrl: string | null | undefined): string {
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

export function getWebSocketUrl(): string {
  const params = new URLSearchParams(location.search);
  return normalizeWebSocketUrl(
    params.get('ws') ?? params.get('wsUrl') ?? window.VIZER_WS_URL,
  );
}

/** @deprecated messages from OverlayEventSocket are normalized; read msg.avatarUrl. */
export function messageAvatarUrl(msg: VisualEventMsg): string | null {
  return msg.avatarUrl ?? msg.avatar_url ?? null;
}

export function formatEventText(msg: VisualEventMsg, followText: string): string {
  if (msg.event === 'chat_message') return msg.text?.trim() || '...';
  if (msg.event === 'follow') return followText;
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

export function formatEventLabel(
  event: VisualEventName,
  options: { chatLabel?: string; separator?: string } = {},
): string {
  const chatLabel = options.chatLabel ?? 'CHAT';
  const separator = options.separator ?? ' ';
  return event === 'chat_message' ? chatLabel : event.replace('_', separator).toUpperCase();
}

/** Converts an emote list entry into an image MessagePart, keeping every URL variant. */
export function emoteToPart(emote: EmoteItem): MessagePart {
  return {
    type: 'image',
    name: emote.name,
    url: emote.url,
    animatedUrl: emote.animatedUrl,
    staticUrl: emote.staticUrl,
    animated_url: emote.animated_url,
    static_url: emote.static_url,
  };
}

export function renderParts(
  msg: VisualEventMsg,
  fallbackText = formatEventText(msg, 'joined the stream'),
): MessagePart[] {
  const incoming = msg.parts?.filter((part) => part.type === 'text' || part.type === 'image') ?? [];
  if (incoming.length > 0) return incoming;

  const fallback: MessagePart[] = [{ type: 'text', text: fallbackText }];
  for (const emote of msg.emotes ?? []) {
    if (emote.url) fallback.push(emoteToPart(emote));
  }
  return fallback;
}

/** Flattens parts to plain text; image parts render as :name: placeholders. */
export function flattenPartsToText(parts: MessagePart[]): string {
  return parts
    .map((part) => (part.type === 'image' ? `:${part.name ?? 'emote'}:` : part.text ?? ''))
    .join('')
    .trim();
}
