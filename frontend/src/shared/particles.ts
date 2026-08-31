import { clamp } from './math';

/** Minimum surface a burst body needs: a PIXI.Particle, Sprite or Graphics. */
export interface BurstBody {
  x: number;
  y: number;
  alpha: number;
}

export interface BurstParticle<T extends BurstBody> {
  body: T;
  vx: number;
  vy: number;
  /** Ticks elapsed; one tick unit is one frame at 60fps. */
  life: number;
  maxLife: number;
}

export interface ParticleBurstOptions<T extends BurstBody> {
  /** Downward acceleration added to vy per tick unit. */
  gravity: number;
  /** Detaches a spent body from whatever layer the scene added it to. */
  release: (body: T) => void;
  /**
   * Extra per-frame styling. `remaining` runs from 1 to 0 across the particle's
   * lifetime and has already been applied to `body.alpha`.
   */
  onUpdate?: (particle: BurstParticle<T>, remaining: number) => void;
}

/**
 * Ballistic particle pool shared by the scene bursts: the scene decides what a
 * particle looks like and where it starts, this owns the motion, the fade and
 * the removal of spent particles.
 */
export class ParticleBurst<T extends BurstBody> {
  private readonly particles: BurstParticle<T>[] = [];

  constructor(private readonly options: ParticleBurstOptions<T>) {}

  get size(): number {
    return this.particles.length;
  }

  /** Adds an already-positioned, already-parented body to the pool. */
  emit(body: T, velocity: { vx: number; vy: number; maxLife: number }): void {
    this.particles.push({ body, life: 0, ...velocity });
  }

  update(delta: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      particle.life += delta;
      particle.body.x += particle.vx * delta;
      particle.body.y += particle.vy * delta;
      particle.vy += this.options.gravity * delta;

      const remaining = clamp(1 - particle.life / particle.maxLife, 0, 1);
      particle.body.alpha = remaining;
      this.options.onUpdate?.(particle, remaining);

      if (particle.life >= particle.maxLife) {
        this.options.release(particle.body);
        this.particles.splice(i, 1);
      }
    }
  }

  /** Releases every live particle, e.g. when the scene tears down. */
  clear(): void {
    for (const particle of this.particles) this.options.release(particle.body);
    this.particles.length = 0;
  }
}
