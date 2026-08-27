import * as PIXI from 'pixi.js';

import { fillStyle, seedRng } from '../../shared/overlay';
import { loadAvatarImage } from '../../shared/pixi';
import { PX } from './pixel-helpers';
import type { Palette } from './theme';

/** Outer frame size of the avatar box; PixelChatCard lays out against this. */
export const AVATAR_SIZE = 36;
/** Border thickness between the frame edge and the image area. */
export const AVATAR_INSET = 3;
/** Side length of the masked image area inside the frame. */
export const AVATAR_INNER = AVATAR_SIZE - AVATAR_INSET * 2;

export class PixelAvatar {
  readonly view = new PIXI.Container();

  constructor(texture: PIXI.Texture, seed: number, palette: Palette, userAccent: number, avatarUrl?: string | null) {
    const fallback = this.makeFallback(texture, seed, palette, userAccent);
    const mask = new PIXI.Graphics().rect(AVATAR_INSET, AVATAR_INSET, AVATAR_INNER, AVATAR_INNER).fill(0xffffff);
    const backplate = new PIXI.Graphics()
      .rect(0, 0, AVATAR_SIZE, AVATAR_SIZE).fill(fillStyle(0x05030a, 0.76))
      .rect(AVATAR_INSET, AVATAR_INSET, AVATAR_INNER, AVATAR_INNER).fill(fillStyle(palette.plateDeep, 0.90));
    const frame = new PIXI.Graphics()
      .rect(0, 0, AVATAR_SIZE, PX).fill(palette.edge)
      .rect(0, AVATAR_SIZE - PX, AVATAR_SIZE, PX).fill(palette.rose)
      .rect(0, 0, PX, AVATAR_SIZE).fill(userAccent)
      .rect(AVATAR_SIZE - PX, 0, PX, AVATAR_SIZE).fill(palette.gold)
      .rect(AVATAR_INSET, AVATAR_INSET, AVATAR_INNER, AVATAR_INNER).stroke({ color: palette.night, width: 2, alpha: 0.78 });

    fallback.x = AVATAR_INSET + 1;
    fallback.y = AVATAR_INSET + 1;
    fallback.mask = mask;
    this.view.addChild(backplate, mask, fallback, frame);
    if (avatarUrl) {
      loadAvatarImage(avatarUrl, this.view, fallback, {
        size: AVATAR_INNER,
        offset: AVATAR_INSET,
        mask,
        addAtIndex: 3,
        label: 'PixelChatOverlay',
      });
    }
  }

  private makeFallback(texture: PIXI.Texture, seed: number, palette: Palette, userAccent: number): PIXI.ParticleContainer<PIXI.Particle> {
    const rng = seedRng(seed ^ 0xabba);
    const layer = new PIXI.ParticleContainer<PIXI.Particle>({
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
    const colors = [palette.ink, userAccent, palette.line, palette.gold, palette.rose, palette.blue];
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const mirror = x > 3 ? 6 - x : x;
        if (rng() + mirror * 0.08 + y * 0.03 < 0.43) continue;
        particles.push(new PIXI.Particle({
          texture,
          x: x * PX,
          y: y * PX,
          scaleX: PX,
          scaleY: PX,
          tint: colors[Math.floor(rng() * colors.length)],
          alpha: 0.96,
        }));
      }
    }
    layer.addParticle(...particles);
    layer.update();
    return layer;
  }
}
