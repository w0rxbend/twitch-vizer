export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Frame-rate-independent "move `rate` of the way toward target each tick".
 *
 * The naive `current + (target - current) * rate * delta` overshoots once
 * delta grows past 1 / rate, which happens whenever a browser source is
 * throttled in a background tab or stalls on GC. Compounding the per-tick
 * rate over `delta` ticks instead stays inside [0, 1) for any delta.
 */
export function approach(current: number, target: number, rate: number, delta: number): number {
  return current + (target - current) * (1 - Math.pow(1 - rate, delta));
}
