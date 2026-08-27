import * as PIXI from 'pixi.js';

/** Logical pixel size — every drawn coordinate snaps to this grid. */
export const PX = 4;
export const TILE = PX * 2;

export function snap(value: number, grid = PX): number {
  return Math.round(value / grid) * grid;
}

/**
 * Pushes a grid-snapped rectangle particle, normalizing negative widths and
 * heights so callers can draw in any direction.
 */
export function addPixelParticle(
  out: PIXI.Particle[],
  texture: PIXI.Texture,
  x: number,
  y: number,
  w: number,
  h: number,
  tint: number,
  alpha = 1,
): void {
  let drawX = x;
  let drawY = y;
  let drawW = w;
  let drawH = h;
  if (drawW < 0) {
    drawX += drawW;
    drawW = Math.abs(drawW);
  }
  if (drawH < 0) {
    drawY += drawH;
    drawH = Math.abs(drawH);
  }
  out.push(new PIXI.Particle({
    texture,
    x: snap(drawX),
    y: snap(drawY),
    scaleX: Math.max(PX, snap(drawW)),
    scaleY: Math.max(PX, snap(drawH)),
    tint,
    alpha,
  }));
}
