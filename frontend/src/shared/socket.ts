import { normalizeEventMsg } from './events';
import type { RawEventMsg, VisualEventMsg } from './events';

declare global {
  interface Window {
    VIZER_WS_URL?: string;
  }
}

/** Connection lifecycle states surfaced through the onStatus callback. */
export type OverlaySocketStatus = 'connecting' | 'connected' | 'disconnected';

interface OverlayEventSocketOptions {
  label: string;
  onEvent: (msg: VisualEventMsg) => void;
  /**
   * Invoked on every connection state change, so a scene can show a subtle
   * "stream events offline" hint on a long-running OBS source.
   */
  onStatus?: (status: OverlaySocketStatus) => void;
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
  private status: OverlaySocketStatus = 'disconnected';

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
      this.setStatus('connecting');
      ws.onopen = () => {
        this.retryAttempts = 0;
        this.setStatus('connected');
        console.log(`[${this.options.label}] WebSocket connected:`, wsUrl);
      };
      ws.onmessage = (evt: MessageEvent<string>) => this.handleMessage(evt);
      ws.onclose = () => this.handleClose(ws);
      ws.onerror = () => ws.close();
    } catch (error) {
      console.warn(`[${this.options.label}] WebSocket setup failed:`, error);
      this.setStatus('disconnected');
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.closedByClient = true;
    this.clearRetryTimer();
    this.ws?.close();
    this.ws = null;
    this.setStatus('disconnected');
  }

  private setStatus(status: OverlaySocketStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatus?.(status);
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
    this.setStatus('disconnected');
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
 *
 * The spacebar trigger is opt-in via ?debug=1 so a stray keypress in an
 * interactive OBS browser source cannot inject a fake event on stream. Every
 * scene gets the same rule from here rather than gating it for itself.
 */
export function bootstrapOverlay(
  overlay: BootstrappableOverlay,
  options: { label?: string; onTestKey?: () => void } = {},
): void {
  const label = options.label ?? 'Overlay';
  const onTestKey = options.onTestKey;
  overlay
    .init()
    .then(() => {
      overlay.connectWebSocket();
      if (onTestKey && new URLSearchParams(location.search).get('debug') === '1') {
        console.info(`[${label}] spacebar test events enabled`);
        // Page-lifetime listener: the overlay lives as long as the browser source.
        window.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === ' ') onTestKey();
        });
      } else if (onTestKey) {
        console.info(`[${label}] spacebar test events disabled; add ?debug=1 to the scene URL`);
      }
    })
    .catch((error: unknown) => {
      console.error(`[${label}] Failed to initialize overlay:`, error);
    });
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
