import type { VisualEventMsg } from './events';
import { hashSeed } from './rng';

/** Oldest entries are evicted past this size so a busy always-on chat scene
 * does not grow its accent map without bound. */
const DEFAULT_MAX_TRACKED_USERS = 500;

/** The per-user identity a card is built from: stable across a user's messages. */
export interface UserStyle {
  /** Case-folded username, 'anonymous' when the wire message has none. */
  key: string;
  /** Stable per-user seed: msg.seed when present, else a hash of the key. */
  seed: number;
  /** Accent color, resolved once per user and reused for later messages. */
  accent: number;
}

export interface UserStylesOptions {
  /**
   * Scene name mixed into every per-message seed, so two scenes running side
   * by side never derive the same value for the same message.
   */
  scope: string;
  /** Resolves a first-seen user's accent from the message and their seed. */
  accent: (msg: VisualEventMsg, seed: number) => number;
  maxTracked?: number;
}

/**
 * Per-user accent memo plus the seed derivations every chat-style scene needs.
 * Accents are cached so a user keeps one color, while message seeds are fresh
 * every time so repeated messages never render identical artwork.
 */
export class UserStyles {
  private readonly accents = new Map<string, number>();
  private readonly maxTracked: number;
  private messageSerial = 0;

  constructor(private readonly options: UserStylesOptions) {
    this.maxTracked = options.maxTracked ?? DEFAULT_MAX_TRACKED_USERS;
  }

  /** Key, seed and accent for the sender of `msg`. */
  for(msg: VisualEventMsg): UserStyle {
    const key = userKey(msg.username);
    const seed = msg.seed ?? hashSeed(key);
    return { key, seed, accent: this.accentFor(msg, key, seed) };
  }

  /** A fresh seed for one message, unique even for identical repeated text. */
  messageSeed(msg: VisualEventMsg, style: UserStyle): number {
    this.messageSerial += 1;
    return hashSeed([
      this.options.scope,
      style.key,
      style.seed,
      msg.event,
      msg.text ?? '',
      this.messageSerial,
      performance.now().toFixed(3),
      Math.random().toFixed(6),
    ].join(':'));
  }

  private accentFor(msg: VisualEventMsg, key: string, seed: number): number {
    const existing = this.accents.get(key);
    if (existing !== undefined) return existing;

    const accent = this.options.accent(msg, seed);
    if (this.accents.size >= this.maxTracked) {
      const oldest = this.accents.keys().next().value;
      if (oldest !== undefined) this.accents.delete(oldest);
    }
    this.accents.set(key, accent);
    return accent;
  }
}

/** Case-folded username used as the per-user cache key. */
export function userKey(username: string): string {
  return username.trim().toLowerCase() || 'anonymous';
}
