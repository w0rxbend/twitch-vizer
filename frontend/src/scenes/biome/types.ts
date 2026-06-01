import type * as PIXI from 'pixi.js';

export type VitalityPhase = 'dead' | 'dying' | 'struggling' | 'alive' | 'thriving';

export interface SceneContext {
  app: PIXI.Application;
  vitality: number;        // 0–100
  phase: VitalityPhase;
  isNight: boolean;
  timeOfDay: number;       // 0–1 (0=midnight, 0.5=noon)
  windStrength: number;    // -1 to 1 (negative = left)
  canvasWidth: number;
  canvasHeight: number;
}

export interface Entity {
  permanent: boolean;
  update(delta: number, ctx: SceneContext): void;
  destroy(): void;
}

export interface DeadEntity extends Entity {
  readonly dead: boolean;
}

export type RngFn = () => number;

export interface VisualEventMsg {
  event: 'chat_message' | 'follow' | 'sub' | 'cheer' | 'raid' | 'gift_sub';
  username: string;
  text?: string;
  color?: string;
  seed?: number;
  data?: {
    bits?: number;
    viewers?: number;
    total?: number;
    tier?: string;
    months?: number;
  };
}
