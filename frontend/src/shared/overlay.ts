/**
 * Shared overlay toolkit, split by responsibility:
 *   - socket.ts  — OverlayEventSocket, bootstrapOverlay, WebSocket URL resolution
 *   - events.ts  — event types, wire-format normalization, text formatters
 *   - color.ts   — packed-RGB color helpers
 *   - rng.ts     — seeded RNG, string hashing
 *   - math.ts    — clamp, frame-rate-independent easing
 *   - particles.ts  — ParticleBurst, the shared ballistic particle pool
 *   - user-style.ts — per-user accent memo and per-message seeds
 *
 * Scenes import from this barrel so the module layout can change without
 * touching every scene. RawEventMsg (the tolerant wire shape) is deliberately
 * not re-exported: scenes only ever see normalized VisualEventMsg values.
 * PIXI-dependent helpers (pixi.ts, emote-images.ts, message-layout.ts) stay
 * out of the barrel so it never drags PIXI into a scene that does not use it.
 */
export {
  emoteToPart,
  flattenPartsToText,
  formatEventLabel,
  formatEventText,
  renderParts,
} from './events';
export type {
  EmoteItem,
  MessagePart,
  VisualEventMsg,
  VisualEventName,
} from './events';
export {
  bootstrapOverlay,
  getWebSocketUrl,
  normalizeWebSocketUrl,
  OverlayEventSocket,
} from './socket';
export type { BootstrappableOverlay, OverlaySocketStatus } from './socket';
export { colorFromString, fillStyle, hslToRgb, luminance, mixColor } from './color';
export { hashSeed, seedRng } from './rng';
export { approach, clamp } from './math';
export { ParticleBurst } from './particles';
export type { BurstBody, BurstParticle, ParticleBurstOptions } from './particles';
export { UserStyles, userKey } from './user-style';
export type { UserStyle, UserStylesOptions } from './user-style';
