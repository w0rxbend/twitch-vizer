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
}

export interface MessagePart {
  type: 'text' | 'image';
  text?: string;
  name?: string;
  url?: string;
}

export interface VisualEventMsg {
  event: VisualEventName;
  username: string;
  text?: string;
  color?: string;
  seed?: number;
  avatar_url?: string | null;
  avatarUrl?: string | null;
  profile_image_url?: string | null;
  profileImageUrl?: string | null;
  profile_image?: string | null;
  profileImage?: string | null;
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

interface OverlayEventSocketOptions {
  label: string;
  onEvent: (msg: VisualEventMsg) => void;
  retryDelayMs?: number;
  url?: string;
}

export class OverlayEventSocket {
  private readonly retryDelayMs: number;
  private readonly url?: string;
  private ws: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
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
      ws.onopen = () => console.log(`[${this.options.label}] WebSocket connected:`, wsUrl);
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
      this.options.onEvent(JSON.parse(evt.data) as VisualEventMsg);
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
    this.retryTimer = setTimeout(() => this.connect(), this.retryDelayMs);
  }

  private clearRetryTimer(): void {
    if (!this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
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
  const normalized = value.startsWith('#') ? value.slice(1) : value;
  const parsed = Number.parseInt(normalized, 16);
  return Number.isFinite(parsed) ? parsed : fallback;
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

export function rgba(color: number, alpha: number): { color: number; alpha: number } {
  return { color, alpha };
}

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

export function messageAvatarUrl(msg: VisualEventMsg): string | null {
  return (
    msg.avatar_url
    ?? msg.avatarUrl
    ?? msg.profile_image_url
    ?? msg.profileImageUrl
    ?? msg.profile_image
    ?? msg.profileImage
    ?? null
  );
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

export function renderParts(
  msg: VisualEventMsg,
  fallbackText = formatEventText(msg, 'joined the stream'),
): MessagePart[] {
  const incoming = msg.parts?.filter((part) => part.type === 'text' || part.type === 'image') ?? [];
  if (incoming.length > 0) return incoming;

  const fallback: MessagePart[] = [{ type: 'text', text: fallbackText }];
  for (const emote of msg.emotes ?? []) {
    if (emote.url) fallback.push({ type: 'image', name: emote.name, url: emote.url });
  }
  return fallback;
}
