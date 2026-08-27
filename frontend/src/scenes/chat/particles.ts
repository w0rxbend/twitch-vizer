import * as PIXI from 'pixi.js';

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
