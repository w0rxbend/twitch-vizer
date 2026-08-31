import * as PIXI from 'pixi.js';

/**
 * PIXI helpers shared by the scene overlays: app bootstrap, pixel texture,
 * vignette, and avatar loading. Pure color/formatting helpers live in
 * ./overlay so it stays free of a PIXI dependency.
 */

/**
 * Creates the full-window transparent PIXI application every scene starts
 * from and mounts its canvas as a fixed, inset-0 element on document.body.
 * Pass init options to override the defaults (e.g. antialias: false).
 */
export async function createOverlayApp(
  init: Partial<PIXI.ApplicationOptions> = {},
): Promise<PIXI.Application> {
  const app = new PIXI.Application();
  await app.init({
    resizeTo: window,
    backgroundAlpha: 0,
    resolution: Math.min(devicePixelRatio, 2),
    autoDensity: true,
    ...init,
  });

  document.body.appendChild(app.canvas);
  app.canvas.style.position = 'fixed';
  app.canvas.style.inset = '0';
  return app;
}

/** A 1x1 white texture, useful as a particle/pixel building block. */
export function makePixelTexture(app: PIXI.Application): PIXI.Texture {
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

/**
 * A ParticleContainer for artwork that is drawn once and never animated:
 * every per-particle property is static so PIXI can bake the geometry.
 */
export function makeStaticParticleContainer(
  texture: PIXI.Texture,
): PIXI.ParticleContainer<PIXI.Particle> {
  return new PIXI.ParticleContainer<PIXI.Particle>({
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
}

export interface VignetteOptions {
  /** Number of concentric rectangle rings. */
  steps?: number;
  /** Peak edge darkness (also scales how far the vignette reaches inward). */
  strength?: number;
  color?: number;
}

/**
 * Darkened-edge vignette built from concentric rectangle rings, fading
 * quadratically toward the center.
 */
export function buildVignette(
  w: number,
  h: number,
  { steps = 22, strength = 0.32, color = 0x000000 }: VignetteOptions = {},
): PIXI.Graphics {
  const g = new PIXI.Graphics();
  const dim = Math.min(w, h);
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const alpha = Math.pow(1 - t, 2) * strength;
    const inset = t * strength * dim;
    g.rect(0, 0, w, inset).fill({ color, alpha });
    g.rect(0, h - inset, w, inset).fill({ color, alpha });
    g.rect(0, 0, inset, h).fill({ color, alpha });
    g.rect(w - inset, 0, inset, h).fill({ color, alpha });
  }
  return g;
}

export interface AvatarImageOptions {
  /** Square box (in px) the avatar is scaled to fit. */
  size: number;
  /** Offset of the box inside the view (e.g. to sit inside a frame border). */
  offset?: number;
  /**
   * Mask applied to the avatar sprite. When omitted, a circular mask covering
   * the box is created and added to the view.
   */
  mask?: PIXI.Graphics;
  /** Child index the sprite is inserted at (clamped to the child count). */
  addAtIndex?: number;
  roundPixels?: boolean;
  /** Scene name used in the load-failure console warning. */
  label?: string;
}

/**
 * Loads an avatar image and, on success, hides the fallback graphic and adds
 * a masked, box-fitted sprite to the view. On failure the fallback is shown
 * and a warning logged. Safe against the view being destroyed mid-load.
 *
 * Returns a disposer that the owning card must call from its own destroy():
 * `view.destroy({ children: true })` does not release textures in Pixi v8, so
 * without it every avatar leaks one GPU texture for the life of the source.
 * The disposer only ever frees the texture created here, never a
 * caller-supplied mask or a shared texture parented under the same view.
 */
export function loadAvatarImage(
  url: string,
  view: PIXI.Container,
  fallback: PIXI.Container,
  options: AvatarImageOptions,
): () => void {
  const { size, offset = 0, addAtIndex = view.children.length, label = 'Overlay' } = options;

  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.referrerPolicy = 'no-referrer';

  let texture: PIXI.Texture | null = null;
  let disposed = false;

  image.onload = () => {
    if (disposed || (view as PIXI.Container & { destroyed?: boolean }).destroyed) return;
    fallback.alpha = 0;

    texture = PIXI.Texture.from(image);
    const sprite = new PIXI.Sprite(texture);
    sprite.roundPixels = options.roundPixels ?? true;
    const scale = size / Math.max(image.naturalWidth, image.naturalHeight, 1);
    sprite.scale.set(scale);
    sprite.x = offset + Math.round((size - sprite.width) / 2);
    sprite.y = offset + Math.round((size - sprite.height) / 2);

    let mask = options.mask;
    if (!mask) {
      mask = new PIXI.Graphics()
        .circle(offset + size / 2, offset + size / 2, size / 2)
        .fill(0xffffff);
      view.addChild(mask);
    }
    sprite.mask = mask;
    view.addChildAt(sprite, Math.min(addAtIndex, view.children.length));
  };
  image.onerror = () => {
    if (disposed) return;
    console.warn(`[${label}] avatar image failed to load:`, url);
    fallback.alpha = 1;
  };
  image.src = url;

  return () => {
    if (disposed) return;
    disposed = true;
    image.onload = null;
    image.onerror = null;
    image.src = '';
    texture?.destroy(true);
    texture = null;
  };
}
