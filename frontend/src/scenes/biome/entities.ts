import * as PIXI from 'pixi.js';
import type { Entity, DeadEntity, SceneContext, RngFn } from './types';

export const PX = 2;
export const CANVAS_HEIGHT = 240;
export const GROUND_Y = 185;

export const C = {
  darkGreen:    0x1a4a1a,
  midGreen:     0x2d7a2d,
  brightGreen:  0x4CAF50,
  lime:         0x8BC34A,
  darkBrown:    0x3d2000,
  midBrown:     0x5a3410,
  tan:          0x8B6914,
  bark:         0x6B3A2A,
  leafDark:     0x1b5e20,
  leafMid:      0x388e3c,
  leafLight:    0x66bb6a,
  flowerPink:   0xFF69B4,
  flowerYellow: 0xFFD700,
  flowerWhite:  0xFFFFFF,
  flowerOrange: 0xFF6F00,
  skyBlue:      0x87CEEB,
  red:          0xCC2200,
  purple:       0x7B2FBE,
  black:        0x111111,
  antBody:      0x2a1500,
  beeYellow:    0xFFD600,
  beeBlack:     0x1a1a1a,
  firefly:      0xFFFF88,
  firflyGlow:   0xAAFF44,
  rainBlue:     0x90CAF9,
  puddleBlue:   0x42A5F5,
  dustGrey:     0xBBBBBB,
  pollenYellow: 0xFFF176,
  gold:         0xFFD700,
} as const;

export function seedRng(seed: number): RngFn {
  let s = (seed >>> 0) || 1;
  return function () {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0xFFFFFFFF;
  };
}

// =============================================================================
// GrassCluster
// =============================================================================
export class GrassCluster implements Entity {
  permanent: boolean;
  private container: PIXI.Container;
  private age = 0;
  private blades: Array<{
    g: PIXI.Graphics;
    phase: number;
    speed: number;
    swayAmp: number;
  }> = [];

  constructor(app: PIXI.Application, x: number, rng: RngFn, permanent = false) {
    this.permanent = permanent;
    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = GROUND_Y;

    const count = 3 + Math.floor(rng() * 5);
    const bladeColors = [C.darkGreen, C.midGreen, C.brightGreen, C.lime];

    for (let i = 0; i < count; i++) {
      const bx = Math.floor((rng() - 0.5) * 16);
      const height = 3 + Math.floor(rng() * 3);
      const color = bladeColors[Math.floor(rng() * bladeColors.length)];
      const lean = rng() > 0.5 ? 1 : -1;
      const phase = rng() * Math.PI * 2;
      const speed = 0.8 + rng() * 0.8;
      const g = new PIXI.Graphics();

      for (let row = 0; row < height; row++) {
        const leanOffset = row > height - 2 ? lean : 0;
        g.rect((bx + leanOffset) * PX, -(row + 1) * PX, PX, PX).fill(color);
      }

      this.blades.push({ g, phase, speed, swayAmp: 0.8 + rng() * 0.8 });
      this.container.addChild(g);
    }

    app.stage.addChild(this.container);
  }

  update(delta: number, ctx: SceneContext): void {
    this.age += delta;
    const t = this.age * 0.04;

    if (ctx.phase === 'dying' || ctx.phase === 'dead') {
      this.container.alpha = 0.4 + (ctx.vitality / 100) * 0.6;
    } else {
      this.container.alpha = 1;
    }

    const droopTarget = ctx.vitality < 30 ? 0.12 * (1 - ctx.vitality / 30) : 0;
    this.container.rotation += (droopTarget - this.container.rotation) * 0.05 * delta;

    for (const b of this.blades) {
      b.g.x = Math.sin(t * b.speed + b.phase) * b.swayAmp * PX;
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

// =============================================================================
// Flower
// =============================================================================
export class Flower implements Entity {
  permanent: boolean;
  private container: PIXI.Container;
  private age = 0;
  private phase: number;
  private speed: number;
  private g: PIXI.Graphics;

  constructor(app: PIXI.Application, x: number, rng: RngFn, permanent = false, userColor?: number) {
    this.permanent = permanent;
    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = GROUND_Y;
    this.phase = rng() * Math.PI * 2;
    this.speed = 0.5 + rng() * 0.5;

    const petalColors = [C.flowerPink, C.flowerYellow, C.flowerWhite, C.flowerOrange];
    const petalColor = userColor ?? petalColors[Math.floor(rng() * petalColors.length)];
    const stemHeight = 4 + Math.floor(rng() * 3);

    const g = new PIXI.Graphics();

    for (let i = 0; i < stemHeight; i++) {
      g.rect(-PX / 2, -(i + 1) * PX, PX, PX).fill(C.brightGreen);
    }

    const ty = -(stemHeight + 1) * PX;
    g.rect(-PX / 2, ty - PX, PX, PX).fill(petalColor);
    g.rect(-PX / 2, ty + PX, PX, PX).fill(petalColor);
    g.rect(-PX / 2 - PX, ty, PX, PX).fill(petalColor);
    g.rect(-PX / 2 + PX, ty, PX, PX).fill(petalColor);
    g.rect(-PX / 2, ty, PX, PX).fill(C.flowerYellow);

    this.g = g;
    this.container.addChild(g);
    app.stage.addChild(this.container);
  }

  update(delta: number, ctx: SceneContext): void {
    this.age += delta;

    if (ctx.phase === 'dying' || ctx.phase === 'dead') {
      this.container.alpha = 0.4 + (ctx.vitality / 100) * 0.6;
    } else {
      this.container.alpha = 1;
    }

    if (ctx.vitality < 30) {
      this.container.rotation = Math.PI / 12;
    } else {
      this.container.rotation = 0;
      const bob = Math.sin(this.age * 0.03 * this.speed + this.phase) * PX * 0.5;
      this.g.y = bob;
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

// =============================================================================
// Mushroom
// =============================================================================
export class Mushroom implements Entity {
  permanent = true;
  private container: PIXI.Container;
  private age = 0;
  private phase: number;

  constructor(app: PIXI.Application, x: number, rng: RngFn, golden = false) {
    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = GROUND_Y;
    this.phase = rng() * Math.PI * 2;

    const capColor = golden ? C.gold : (rng() > 0.5 ? C.red : C.purple);
    const g = new PIXI.Graphics();

    for (let i = 0; i < 3; i++) {
      g.rect(-PX, -(i + 1) * PX, PX * 2, PX).fill(C.tan);
    }

    const capRows: Array<[number, number]> = [[1, 5], [3, 4], [5, 3]];
    for (const [w, yo] of capRows) {
      const xStart = -Math.floor(w / 2);
      g.rect(xStart * PX, -(3 + yo) * PX, w * PX, PX).fill(capColor);
    }

    if (golden) {
      g.rect(0, -(3 + 4) * PX, PX, PX).fill(C.flowerWhite);
      g.rect(-PX, -(3 + 3) * PX, PX, PX).fill(C.flowerWhite);
    }

    this.container.addChild(g);
    app.stage.addChild(this.container);
  }

  update(delta: number, _ctx: SceneContext): void {
    this.age += delta;
    const pulse = Math.sin(this.age * 0.025 + this.phase) * 0.05;
    this.container.scale.set(1 + pulse);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

// =============================================================================
// BacteriaColony
// =============================================================================
export class BacteriaColony implements Entity {
  permanent = false;
  private container: PIXI.Container;
  private age = 0;
  private phase: number;

  constructor(app: PIXI.Application, x: number, rng: RngFn) {
    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = GROUND_Y;
    this.phase = rng() * Math.PI * 2;

    const blobColors = [C.brightGreen, C.lime, C.flowerPink, C.midGreen];
    const count = 3 + Math.floor(rng() * 6);
    const g = new PIXI.Graphics();

    for (let i = 0; i < count; i++) {
      const bx = Math.floor((rng() - 0.5) * 10);
      const by = Math.floor(rng() * 4);
      const size = rng() > 0.5 ? 1 : 2;
      const color = blobColors[Math.floor(rng() * blobColors.length)];
      g.rect(bx * PX, -by * PX, size * PX, size * PX).fill(color);
    }

    this.container.addChild(g);
    app.stage.addChild(this.container);
  }

  update(delta: number, _ctx: SceneContext): void {
    this.age += delta;
    const pulse = 0.9 + 0.2 * Math.sin(this.age * 0.05 + this.phase);
    this.container.scale.set(pulse);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

// =============================================================================
// Tree
// =============================================================================
export class Tree implements Entity {
  permanent = true;
  private container: PIXI.Container;
  private g: PIXI.Graphics;
  private age = 0;
  private growthProgress = 0;
  private phase: number;

  constructor(app: PIXI.Application, x: number, rng: RngFn) {
    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = GROUND_Y;
    this.phase = rng() * Math.PI * 2;

    this.g = new PIXI.Graphics();
    this.container.addChild(this.g);
    app.stage.addChild(this.container);
    this._draw();
  }

  private _draw(): void {
    const g = this.g;
    g.clear();
    const p = this.growthProgress;

    if (p < 0.33) {
      // Sapling: 2px wide trunk, 6px tall, tiny 2-pixel crown
      const t = p / 0.33;
      const trunkH = Math.round(4 + t * 2);
      for (let i = 0; i < trunkH; i++) {
        g.rect(-PX, -(i + 1) * PX, PX * 2, PX).fill(C.bark);
      }
      g.rect(-PX, -(trunkH + 1) * PX, PX * 2, PX).fill(C.leafMid);
      g.rect(0, -(trunkH + 2) * PX, PX, PX).fill(C.leafLight);
    } else if (p < 0.66) {
      // Young tree: 2px trunk, 14px tall, small oval crown
      const t = (p - 0.33) / 0.33;
      const trunkH = Math.round(8 + t * 6);
      for (let i = 0; i < trunkH; i++) {
        g.rect(-PX, -(i + 1) * PX, PX * 2, PX).fill(C.bark);
      }
      const crownBase = -(trunkH + 1) * PX;
      const crownRows: Array<[number, number]> = [[1, 0], [3, -1], [3, -2], [1, -3]];
      for (const [w, yo] of crownRows) {
        g.rect(-w * PX, crownBase + yo * PX, w * 2 * PX, PX).fill(t > 0.5 ? C.leafMid : C.leafDark);
      }
    } else {
      // Mature: 4px trunk, up to 30px tall, dense dome crown
      const t = (p - 0.66) / 0.34;
      const trunkW = PX * 2;
      const trunkH = Math.round(16 + t * 14);
      for (let i = 0; i < trunkH; i++) {
        g.rect(-trunkW, -(i + 1) * PX, trunkW * 2, PX).fill(i < 4 ? C.darkBrown : C.bark);
      }
      const cb = -(trunkH + 1) * PX;
      const sway = Math.sin(this.age * 0.015 + this.phase) * t * PX * 0.5;
      const crownDome: Array<[number, number, number]> = [
        [1, 0, C.leafMid],
        [3, -1, C.leafDark],
        [5, -2, C.leafMid],
        [7, -3, C.leafDark],
        [7, -4, C.leafMid],
        [5, -5, C.leafLight],
        [5, -6, C.leafMid],
        [3, -7, C.leafLight],
        [3, -8, C.leafMid],
        [1, -9, C.leafLight],
      ];
      for (const [w, yo, col] of crownDome) {
        g.rect(sway - w * PX, cb + yo * PX, w * 2 * PX, PX).fill(col);
      }
    }
  }

  update(delta: number, _ctx: SceneContext): void {
    this.age += delta;
    if (this.growthProgress < 1) {
      this.growthProgress = Math.min(1, this.growthProgress + delta / 1200);
    }
    this._draw();
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

// =============================================================================
// Vine
// =============================================================================
export class Vine implements DeadEntity {
  permanent = false;
  private container: PIXI.Container;
  private age = 0;
  private readonly lifetime = 600;
  private length = 0;
  private rng: RngFn;
  private g: PIXI.Graphics;

  constructor(app: PIXI.Application, startX: number, rng: RngFn) {
    this.rng = rng;
    this.container = new PIXI.Container();
    this.container.x = startX;
    this.container.y = GROUND_Y - PX;

    this.g = new PIXI.Graphics();
    this.container.addChild(this.g);
    app.stage.addChild(this.container);
  }

  get dead(): boolean {
    return this.age >= this.lifetime;
  }

  update(delta: number, _ctx: SceneContext): void {
    this.age += delta;
    this.length += 0.3 * (delta / 16);

    const g = this.g;
    g.clear();

    const len = Math.floor(this.length);
    for (let i = 0; i < len; i++) {
      g.rect(i * PX, 0, PX, PX).fill(C.midGreen);
      if (i > 0 && i % 9 === 0) {
        const leafSide = this.rng() > 0.5 ? -1 : 1;
        g.rect(i * PX, leafSide * PX, PX, PX).fill(C.brightGreen);
        g.rect(i * PX, leafSide * PX * 2, PX, PX).fill(C.lime);
      }
    }

    const fadeRatio = this.age / this.lifetime;
    this.container.alpha = fadeRatio > 0.75 ? 1 - (fadeRatio - 0.75) / 0.25 : 1;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

// =============================================================================
// Ant
// =============================================================================
export class Ant implements Entity {
  permanent = true;
  private container: PIXI.Container;
  private age = 0;
  private x: number;
  private dir: 1 | -1;
  private speed: number;
  private g: PIXI.Graphics;

  constructor(app: PIXI.Application, startX: number) {
    this.container = new PIXI.Container();
    this.x = startX;
    this.container.x = this.x;
    this.container.y = GROUND_Y - 4 * PX;
    this.dir = Math.random() > 0.5 ? 1 : -1;
    this.speed = 0.4 + Math.random() * 0.3;

    this.g = new PIXI.Graphics();
    this.container.addChild(this.g);
    app.stage.addChild(this.container);
  }

  private _draw(legFrame: number): void {
    const g = this.g;
    g.clear();
    const c = C.antBody;

    // 3 body segments
    g.rect(-PX, -2 * PX, PX * 2, PX * 2).fill(c);
    g.rect(-PX, -4 * PX, PX * 2, PX * 2).fill(c);
    g.rect(-PX, -6 * PX, PX * 2, PX * 2).fill(c);

    // antennae
    g.rect(PX, -7 * PX, PX, PX).fill(c);
    g.rect(PX * 2, -8 * PX, PX, PX).fill(c);
    g.rect(0, -7 * PX, PX, PX).fill(c);
    g.rect(-PX, -8 * PX, PX, PX).fill(c);

    // 6 legs alternating
    const lp = legFrame % 2;
    g.rect(-PX * 2, -5 * PX + (lp === 0 ? 0 : PX), PX, PX).fill(c);
    g.rect(PX, -5 * PX + (lp === 1 ? 0 : PX), PX, PX).fill(c);
    g.rect(-PX * 2, -3 * PX + (lp === 1 ? 0 : PX), PX, PX).fill(c);
    g.rect(PX, -3 * PX + (lp === 0 ? 0 : PX), PX, PX).fill(c);
    g.rect(-PX * 2, -PX + (lp === 0 ? 0 : PX), PX, PX).fill(c);
    g.rect(PX, -PX + (lp === 1 ? 0 : PX), PX, PX).fill(c);
  }

  update(delta: number, ctx: SceneContext): void {
    this.age += delta;
    const speedMult = ctx.vitality / 100;
    this.x += this.dir * this.speed * speedMult * (delta / 16);

    if (this.x < 20) { this.x = 20; this.dir = 1; }
    if (this.x > ctx.canvasWidth - 20) { this.x = ctx.canvasWidth - 20; this.dir = -1; }

    this.container.x = this.x;
    this.container.scale.x = this.dir < 0 ? -1 : 1;
    this._draw(Math.floor(this.age / 8));
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

// =============================================================================
// Butterfly
// =============================================================================
export class Butterfly implements Entity {
  permanent = false;
  private container: PIXI.Container;
  private age = 0;
  private readonly lifetime: number;
  private _dead = false;
  private wingColor: number;
  private baseX: number;
  private baseY: number;
  private xSpeed: number;
  private yAmp: number;
  private yFreq: number;
  private yPhase: number;
  private flapSpeed: number;
  private flapPhase: number;
  private g: PIXI.Graphics;

  constructor(app: PIXI.Application, x: number, colorSet?: number) {
    this.container = new PIXI.Container();

    const colors = [0x00BCD4, C.flowerYellow, 0xFF9800, C.flowerPink, C.lime];
    this.wingColor = colorSet !== undefined
      ? colors[colorSet % colors.length]
      : colors[Math.floor(Math.random() * colors.length)];

    this.lifetime = 600 + Math.random() * 900; // 10-25s at 60fps
    this.baseX = x;
    this.baseY = GROUND_Y - 40 - Math.random() * 60;
    this.xSpeed = (0.5 + Math.random() * 0.8) * (Math.random() > 0.5 ? 1 : -1);
    this.yAmp = 8 + Math.random() * 12;
    this.yFreq = 0.03 + Math.random() * 0.02;
    this.yPhase = Math.random() * Math.PI * 2;
    this.flapSpeed = 0.15 + Math.random() * 0.1;
    this.flapPhase = Math.random() * Math.PI * 2;

    this.g = new PIXI.Graphics();
    this.container.addChild(this.g);
    this.container.x = this.baseX;
    this.container.y = this.baseY;
    app.stage.addChild(this.container);
  }

  private _draw(flapOffset: number): void {
    const g = this.g;
    g.clear();
    const wc = this.wingColor;
    const fo = Math.round(flapOffset);

    for (let i = 0; i < 3; i++) {
      g.rect(-PX / 2, (i - 1) * PX, PX, PX).fill(C.black);
    }

    g.rect(-3 * PX, -PX + fo, PX * 2, PX * 2).fill(wc);
    g.rect(-2 * PX, PX + fo, PX * 2, PX).fill(wc);
    g.rect(PX, -PX + fo, PX * 2, PX * 2).fill(wc);
    g.rect(PX, PX + fo, PX * 2, PX).fill(wc);
    g.rect(-PX, -2 * PX, PX, PX).fill(C.black);
    g.rect(0, -2 * PX, PX, PX).fill(C.black);
  }

  get dead(): boolean { return this._dead; }

  update(delta: number, ctx: SceneContext): void {
    this.age += delta;
    if (this.age >= this.lifetime) { this._dead = true; return; }

    const speedMult = 0.4 + (ctx.vitality / 100) * 0.6;
    this.baseX += this.xSpeed * speedMult * (delta / 16);

    if (this.baseX < -20) this.baseX = ctx.canvasWidth + 20;
    if (this.baseX > ctx.canvasWidth + 20) this.baseX = -20;

    const yOff = Math.sin(this.age * this.yFreq * speedMult + this.yPhase) * this.yAmp;
    this.container.x = this.baseX;
    this.container.y = this.baseY + yOff;

    // Fade out in last 20% of lifetime
    const fadeRatio = this.age / this.lifetime;
    this.container.alpha = fadeRatio > 0.8 ? 1 - (fadeRatio - 0.8) / 0.2 : 1;

    const flapY = Math.sin(this.age * this.flapSpeed + this.flapPhase) * 2;
    this._draw(flapY);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

// =============================================================================
// Bee
// =============================================================================
export class Bee implements Entity {
  permanent = true;
  private container: PIXI.Container;
  private age = 0;
  private baseX: number;
  private baseY: number;
  private target: { x: number; y: number } | null;
  private gBody: PIXI.Graphics;
  private gWing: PIXI.Graphics;
  private wingFrame = 0;
  private cx: number;
  private cy: number;

  constructor(app: PIXI.Application, x: number, targetFlower?: { x: number; y: number }) {
    this.container = new PIXI.Container();
    this.baseX = x;
    this.baseY = GROUND_Y - 40;
    this.cx = x;
    this.cy = this.baseY;
    this.target = targetFlower ?? null;

    this.gBody = new PIXI.Graphics();
    this.gWing = new PIXI.Graphics();
    this.container.addChild(this.gWing);
    this.container.addChild(this.gBody);

    this._drawBody();
    this.container.x = this.cx;
    this.container.y = this.cy;
    app.stage.addChild(this.container);
  }

  private _drawBody(): void {
    const g = this.gBody;
    g.clear();
    // 3px body with stripes
    g.rect(-PX, -PX, PX * 3, PX).fill(C.beeYellow);
    g.rect(0, -PX * 2, PX, PX).fill(C.beeBlack);
    g.rect(0, 0, PX, PX).fill(C.beeBlack);
    g.rect(-PX, -PX, PX, PX).fill(C.beeBlack);
    g.rect(PX * 2, -PX, PX, PX).fill(C.beeBlack);
  }

  private _drawWings(frame: number): void {
    const g = this.gWing;
    g.clear();
    const wo = frame % 2 === 0 ? -PX : 0;
    g.rect(-PX * 2, -PX * 2 + wo, PX * 2, PX).fill(0xCCEEFF);
    g.rect(PX * 3, -PX * 2 + wo, PX * 2, PX).fill(0xCCEEFF);
  }

  update(delta: number, ctx: SceneContext): void {
    this.age += delta;
    this.wingFrame = Math.floor(this.age / 3);
    this._drawWings(this.wingFrame);

    const minY = GROUND_Y - 60;
    const maxY = GROUND_Y - 20;

    if (this.target) {
      const tx = this.target.x;
      const ty = Math.max(minY, this.target.y - PX * 5);
      const dx = tx - this.cx;
      const dy = ty - this.cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 8) {
        const circleR = 10;
        this.cx = tx + Math.cos(this.age * 0.05) * circleR;
        this.cy = ty + Math.sin(this.age * 0.05) * circleR * 0.5;
      } else {
        const spd = 1.5 * (delta / 16);
        this.cx += (dx / dist) * spd;
        this.cy += (dy / dist) * spd;
      }
    } else {
      // Figure-8 wander above baseY
      const t = this.age * 0.018;
      this.cx = this.baseX + Math.sin(t) * 30;
      this.cy = this.baseY + Math.sin(t * 2) * 12;
    }

    this.cy = Math.max(minY, Math.min(maxY, this.cy));
    this.container.x = this.cx;
    this.container.y = this.cy;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

// =============================================================================
// Bird
// =============================================================================
export class Bird implements DeadEntity {
  permanent = false;
  private container: PIXI.Container;
  private age = 0;
  private x: number;
  private y: number;
  private dir: 1 | -1;
  private speed: number;
  private g: PIXI.Graphics;
  private wingFrame = 0;
  private _dead = false;

  constructor(app: PIXI.Application, startX: number, startY: number, dir: 1 | -1) {
    this.container = new PIXI.Container();
    this.x = startX;
    this.y = startY;
    this.dir = dir;
    this.speed = (2 + Math.random()) * PX;
    this.g = new PIXI.Graphics();
    this.container.addChild(this.g);
    this.container.x = this.x;
    this.container.y = this.y;
    app.stage.addChild(this.container);
  }

  get dead(): boolean {
    return this._dead;
  }

  private _draw(frame: number): void {
    const g = this.g;
    g.clear();
    const c = C.black;
    // body pixel
    g.rect(-PX, 0, PX * 2, PX).fill(c);
    // wings: 2 frames
    if (frame % 2 === 0) {
      g.rect(-PX * 3, -PX, PX * 2, PX).fill(c);
      g.rect(PX, -PX, PX * 2, PX).fill(c);
    } else {
      g.rect(-PX * 3, 0, PX * 2, PX).fill(c);
      g.rect(PX, 0, PX * 2, PX).fill(c);
    }
  }

  update(delta: number, ctx: SceneContext): void {
    this.age += delta;
    this.x += this.dir * this.speed * (delta / 16);
    this.y += Math.sin(this.age * 0.06) * 0.5;

    if (this.x < -30 || this.x > ctx.canvasWidth + 30) {
      this._dead = true;
    }

    this.container.x = this.x;
    this.container.y = this.y;
    this.container.scale.x = this.dir < 0 ? -1 : 1;
    this.wingFrame = Math.floor(this.age / 8);
    this._draw(this.wingFrame);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

// =============================================================================
// Firefly
// =============================================================================
export class Firefly implements Entity {
  permanent = false;
  private container: PIXI.Container;
  private age = 0;
  private readonly lifetime = 600;
  private glow: PIXI.Graphics;
  private dot: PIXI.Graphics;
  private blinkSpeed: number;
  private blinkPhase: number;
  private cx: number;
  private cy: number;
  private driftAngle: number;
  private driftSpeed: number;
  private blur: PIXI.BlurFilter;
  private trail: Array<{ x: number; y: number }> = [];
  private trailGfx: PIXI.Graphics;
  private _dead = false;

  constructor(app: PIXI.Application, x: number, rng: RngFn) {
    this.container = new PIXI.Container();
    this.cx = x;
    this.cy = GROUND_Y - 30 - rng() * 60;
    this.container.x = this.cx;
    this.container.y = this.cy;
    this.blinkSpeed = 0.04 + rng() * 0.04;
    this.blinkPhase = rng() * Math.PI * 2;
    this.driftAngle = rng() * Math.PI * 2;
    this.driftSpeed = 0.008 + rng() * 0.006;

    this.glow = new PIXI.Graphics();
    this.glow.circle(0, 0, PX * 3).fill({ color: C.firflyGlow, alpha: 0.3 });

    this.dot = new PIXI.Graphics();
    this.dot.rect(-PX / 2, -PX / 2, PX, PX).fill(C.firefly);

    this.blur = new PIXI.BlurFilter({ strength: 2, quality: 2 });
    this.glow.filters = [this.blur];

    this.trailGfx = new PIXI.Graphics();
    this.container.addChild(this.trailGfx);
    this.container.addChild(this.glow);
    this.container.addChild(this.dot);
    app.stage.addChild(this.container);
  }

  update(delta: number, ctx: SceneContext): void {
    this.age += delta;

    if (this.age >= this.lifetime) {
      this._dead = true;
      return;
    }

    this.driftAngle += this.driftSpeed * delta;
    this.cx += Math.cos(this.driftAngle) * 0.3 * (delta / 16);
    this.cy += Math.sin(this.driftAngle * 0.7) * 0.2 * (delta / 16);
    this.cy = Math.max(10, Math.min(GROUND_Y - 5, this.cy));

    const lit = Math.sin(this.age * this.blinkSpeed + this.blinkPhase) > 0.3;
    const fadeRatio = this.age / this.lifetime;
    const fadeAlpha = fadeRatio > 0.8 ? 1 - (fadeRatio - 0.8) / 0.2 : 1;

    if (lit) {
      this.trail.push({ x: this.cx, y: this.cy });
      if (this.trail.length > 6) this.trail.shift();

      this.trailGfx.clear();
      for (let i = 0; i < this.trail.length; i++) {
        const ta = (i / this.trail.length) * 0.35 * fadeAlpha;
        const tx = this.trail[i].x - this.cx;
        const ty = this.trail[i].y - this.cy;
        this.trailGfx.rect(tx - PX / 2, ty - PX / 2, PX, PX).fill({ color: C.firflyGlow, alpha: ta });
      }

      this.container.alpha = fadeAlpha;
      this.glow.alpha = 1;
      this.blur.strength = 2;
    } else {
      this.trail = [];
      this.trailGfx.clear();
      this.glow.alpha = 0;
      this.container.alpha = 0.1 * fadeAlpha;
    }

    if (ctx.isNight) {
      this.container.alpha = (this.container.alpha ?? 1);
    } else {
      this.container.alpha = (this.container.alpha ?? 1) * 0.5;
    }

    this.container.x = this.cx;
    this.container.y = this.cy;
  }

  get dead(): boolean {
    return this._dead;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

// =============================================================================
// Worm
// =============================================================================
export class Worm implements Entity {
  permanent = false;
  private container: PIXI.Container;
  private age = 0;
  private phase: number;
  private g: PIXI.Graphics;

  constructor(app: PIXI.Application, x: number, rng: RngFn) {
    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = GROUND_Y;
    this.phase = rng() * Math.PI * 2;

    this.g = new PIXI.Graphics();
    this.container.addChild(this.g);
    app.stage.addChild(this.container);
  }

  private _draw(emerge: number): void {
    const g = this.g;
    g.clear();
    if (emerge <= 0) return;

    const segments = 4;
    const wormColor = 0xC0836B;
    for (let i = 0; i < segments; i++) {
      const segY = -(i + 1) * PX * emerge;
      if (segY < 0) {
        g.rect(-PX, segY, PX * 2, PX).fill(wormColor);
      }
    }
    // head
    const headY = -(segments + 1) * PX * emerge;
    if (headY < 0) {
      g.rect(-PX, headY, PX * 2, PX * 2).fill(0xA0614A);
      g.rect(0, headY - PX, PX, PX).fill(0xA0614A);
    }
  }

  update(delta: number, _ctx: SceneContext): void {
    this.age += delta;
    const cycleDuration = 140;
    const cycleAge = (this.age + this.phase * (cycleDuration / (Math.PI * 2))) % cycleDuration;

    let emerge = 0;
    if (cycleAge < 20) {
      emerge = cycleAge / 20;
    } else if (cycleAge < 60) {
      emerge = 1;
    } else if (cycleAge < 80) {
      emerge = 1 - (cycleAge - 60) / 20;
    } else {
      emerge = 0;
    }

    this._draw(emerge);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

// =============================================================================
// Petal
// =============================================================================
export class Petal implements DeadEntity {
  permanent = false;
  private container: PIXI.Container;
  private age = 0;
  private readonly lifetime: number;
  private vy: number;
  private vx: number;
  private rotSpeed: number;

  constructor(app: PIXI.Application, x: number, windStrength: number) {
    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = -10;
    this.lifetime = 120 + Math.random() * 80;
    this.vy = 1 + Math.random() * 1.5;
    this.vx = windStrength * 1.5 + (Math.random() - 0.5) * 0.5;
    this.rotSpeed = (Math.random() - 0.5) * 0.1;

    const petalColors = [C.flowerPink, C.flowerYellow, C.flowerWhite, C.brightGreen, C.lime];
    const color = petalColors[Math.floor(Math.random() * petalColors.length)];
    const g = new PIXI.Graphics();
    g.rect(0, 0, PX * 2, PX).fill(color);
    this.container.addChild(g);
    app.stage.addChild(this.container);
  }

  get dead(): boolean {
    return this.age >= this.lifetime;
  }

  update(delta: number, ctx: SceneContext): void {
    this.age += delta;
    this.container.x += (this.vx + ctx.windStrength * 0.5) * (delta / 16);
    this.container.y += this.vy * (delta / 16) * 2;
    this.container.rotation += this.rotSpeed;
    if (this.container.y > CANVAS_HEIGHT) {
      this.age = this.lifetime + 1;
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

// =============================================================================
// Sparkle
// =============================================================================
export class Sparkle implements DeadEntity {
  permanent = false;
  private container: PIXI.Container;
  private age = 0;
  private readonly lifetime = 60;
  private particles: Array<{ g: PIXI.Graphics; vx: number; vy: number; x: number; y: number }> = [];

  constructor(app: PIXI.Application, x: number, palette?: number[]) {
    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = GROUND_Y;

    const count = 12;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const speed = 2 + Math.random() * 3.5;
      const defaultPalette = [C.flowerYellow, C.flowerWhite, C.lime, C.brightGreen];
      const activePalette = palette ?? defaultPalette;
      const color = activePalette[Math.floor(Math.random() * activePalette.length)];
      const g = new PIXI.Graphics();
      g.rect(0, 0, PX, PX).fill(color);
      this.container.addChild(g);
      this.particles.push({ g, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, x: 0, y: 0 });
    }

    app.stage.addChild(this.container);
  }

  get dead(): boolean {
    return this.age >= this.lifetime;
  }

  update(delta: number, _ctx: SceneContext): void {
    this.age += delta;
    this.container.alpha = 1 - this.age / this.lifetime;
    for (const p of this.particles) {
      p.x += p.vx * (delta / 16);
      p.y += p.vy * (delta / 16);
      p.g.x = p.x * PX;
      p.g.y = p.y * PX;
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

// =============================================================================
// RainDrop
// =============================================================================
export class RainDrop implements DeadEntity {
  permanent = false;
  private container: PIXI.Container;
  private age = 0;
  private vy: number;
  private vx: number;
  private _dead = false;

  constructor(app: PIXI.Application, x: number, windStrength: number) {
    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = -10;
    this.vy = (5 + Math.random() * 2) * PX;
    this.vx = windStrength * PX * 1.5;

    const g = new PIXI.Graphics();
    const angle = Math.atan2(this.vx, this.vy);
    g.rect(-1, 0, 2, PX * 3).fill(C.rainBlue);
    g.rotation = angle;
    this.container.addChild(g);
    app.stage.addChild(this.container);
  }

  get dead(): boolean {
    return this._dead;
  }

  update(delta: number, _ctx: SceneContext): void {
    this.age += delta;
    this.container.x += this.vx * (delta / 16);
    this.container.y += this.vy * (delta / 16);
    if (this.container.y > CANVAS_HEIGHT) {
      this._dead = true;
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

// =============================================================================
// DustMote
// =============================================================================
export class DustMote implements DeadEntity {
  permanent = false;
  private container: PIXI.Container;
  private age = 0;
  private readonly lifetime: number;

  constructor(app: PIXI.Application, x: number, rng: RngFn) {
    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = GROUND_Y - rng() * 40;
    this.lifetime = 200 + rng() * 100;

    const g = new PIXI.Graphics();
    g.rect(0, 0, PX, PX).fill(C.dustGrey);
    this.container.addChild(g);
    app.stage.addChild(this.container);
  }

  get dead(): boolean {
    return this.age >= this.lifetime;
  }

  update(delta: number, ctx: SceneContext): void {
    this.age += delta;
    this.container.x += (0.3 + ctx.windStrength * 0.5) * (delta / 16);
    this.container.y -= 0.1 * (delta / 16);
    this.container.alpha = 1 - this.age / this.lifetime;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

// =============================================================================
// Pollen
// =============================================================================
export class Pollen implements DeadEntity {
  permanent = false;
  private container: PIXI.Container;
  private age = 0;
  private readonly lifetime: number;
  private driftX: number;
  private driftY: number;
  private driftPhase: number;

  constructor(app: PIXI.Application, x: number, rng: RngFn) {
    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = GROUND_Y - 10 - rng() * 50;
    this.lifetime = 300 + rng() * 200;
    this.driftX = (rng() - 0.5) * 0.4;
    this.driftY = -(0.05 + rng() * 0.1);
    this.driftPhase = rng() * Math.PI * 2;

    const g = new PIXI.Graphics();
    g.rect(0, 0, PX, PX).fill(C.pollenYellow);
    this.container.addChild(g);
    app.stage.addChild(this.container);
  }

  get dead(): boolean {
    return this.age >= this.lifetime;
  }

  update(delta: number, ctx: SceneContext): void {
    this.age += delta;
    const wobble = Math.sin(this.age * 0.03 + this.driftPhase) * 0.2;
    this.container.x += (this.driftX + wobble + ctx.windStrength * 0.3) * (delta / 16);
    this.container.y += this.driftY * (delta / 16);
    const fadeRatio = this.age / this.lifetime;
    this.container.alpha = fadeRatio > 0.8 ? 1 - (fadeRatio - 0.8) / 0.2 : 1;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

// =============================================================================
// Wasp
// =============================================================================
export class Wasp implements Entity {
  permanent = false;
  private container: PIXI.Container;
  private age = 0;
  private readonly lifetime: number;
  private _dead = false;
  private cx: number;
  private cy: number;
  private vx: number;
  private vy: number;
  private dirTimer = 0;
  private gBody: PIXI.Graphics;
  private gWings: PIXI.Graphics;

  constructor(app: PIXI.Application, x: number) {
    this.container = new PIXI.Container();
    this.cx = x;
    this.cy = GROUND_Y - 25 - Math.random() * 55;
    this.lifetime = 450 + Math.random() * 600;
    this.vx = (Math.random() - 0.5) * 2.5;
    this.vy = (Math.random() - 0.5) * 1.2;
    this.dirTimer = 25 + Math.random() * 50;
    this.gBody  = new PIXI.Graphics();
    this.gWings = new PIXI.Graphics();
    this.container.addChild(this.gWings);
    this.container.addChild(this.gBody);
    this._drawBody();
    this.container.x = this.cx;
    this.container.y = this.cy;
    app.stage.addChild(this.container);
  }

  private _drawBody(): void {
    const g = this.gBody;
    g.clear();
    g.rect(-PX / 2, -PX,     PX,      PX     ).fill(0xFFDD00); // head
    g.rect(-PX,     -2 * PX, PX * 2,  PX     ).fill(C.beeBlack); // thorax
    g.rect(-PX / 2, -3 * PX, PX,      PX     ).fill(C.beeBlack); // waist
    g.rect(-PX,     -4 * PX, PX * 2,  PX     ).fill(0xFFDD00); // abd 1
    g.rect(-PX,     -5 * PX, PX * 2,  PX     ).fill(C.beeBlack); // abd 2
    g.rect(-PX,     -6 * PX, PX * 2,  PX     ).fill(0xFFDD00); // abd 3
    g.rect(-PX / 2, -7 * PX, PX,      PX / 2 ).fill(C.beeBlack); // stinger
  }

  private _drawWings(frame: number): void {
    const g = this.gWings;
    g.clear();
    const wo = frame % 2 === 0 ? -PX : 0;
    g.rect(-PX * 3, -3 * PX + wo, PX * 2, PX / 2).fill({ color: 0xCCEEFF, alpha: 0.75 });
    g.rect(PX,      -3 * PX + wo, PX * 2, PX / 2).fill({ color: 0xCCEEFF, alpha: 0.75 });
    g.rect(-PX * 2, -2 * PX + wo, PX,     PX / 2).fill({ color: 0xCCEEFF, alpha: 0.55 });
    g.rect(PX,      -2 * PX + wo, PX,     PX / 2).fill({ color: 0xCCEEFF, alpha: 0.55 });
  }

  get dead(): boolean { return this._dead; }

  update(delta: number, ctx: SceneContext): void {
    this.age += delta;
    if (this.age >= this.lifetime) { this._dead = true; return; }
    this._drawWings(Math.floor(this.age / 2));
    this.dirTimer -= delta;
    if (this.dirTimer <= 0) {
      this.vx = (Math.random() - 0.5) * 3;
      this.vy = (Math.random() - 0.5) * 1.8;
      this.dirTimer = 18 + Math.random() * 45;
    }
    const spd = 0.8 + (ctx.vitality / 100) * 0.8;
    this.cx += this.vx * spd * (delta / 16);
    this.cy += this.vy * spd * (delta / 16);
    if (this.cx < 8)                   { this.cx = 8;                   this.vx =  Math.abs(this.vx); }
    if (this.cx > ctx.canvasWidth - 8) { this.cx = ctx.canvasWidth - 8; this.vx = -Math.abs(this.vx); }
    if (this.cy < 8)                   { this.cy = 8;                   this.vy =  Math.abs(this.vy); }
    if (this.cy > GROUND_Y - 8)        { this.cy = GROUND_Y - 8;        this.vy = -Math.abs(this.vy); }
    this.container.x = this.cx;
    this.container.y = this.cy;
    this.container.scale.x = this.vx < 0 ? -1 : 1;
    const fr = this.age / this.lifetime;
    this.container.alpha = fr > 0.8 ? 1 - (fr - 0.8) / 0.2 : 1;
  }

  destroy(): void { this.container.destroy({ children: true }); }
}

// =============================================================================
// Dragonfly
// =============================================================================
export class Dragonfly implements Entity {
  permanent = false;
  private container: PIXI.Container;
  private age = 0;
  private readonly lifetime: number;
  private _dead = false;
  private cx: number;
  private cy: number;
  private tx: number;
  private ty: number;
  private stateTimer = 0;
  private hovering = true;
  private readonly bodyColor: number;
  private g: PIXI.Graphics;

  constructor(app: PIXI.Application, x: number) {
    this.container = new PIXI.Container();
    this.cx = x;
    this.cy = GROUND_Y - 45 - Math.random() * 65;
    this.tx = this.cx;
    this.ty = this.cy;
    this.lifetime = 700 + Math.random() * 900;
    this.stateTimer = 50 + Math.random() * 80;
    const palette = [0x3399FF, 0x44FF88, 0xFF4499, 0xFFAA22, 0x88AAFF, 0x22DDCC];
    this.bodyColor = palette[Math.floor(Math.random() * palette.length)];
    this.g = new PIXI.Graphics();
    this.container.addChild(this.g);
    this.container.x = this.cx;
    this.container.y = this.cy;
    app.stage.addChild(this.container);
  }

  private _draw(wPhase: number): void {
    const g = this.g;
    g.clear();
    const c  = this.bodyColor;
    const wo = Math.sin(wPhase) * 1.5;
    // Long horizontal body
    g.rect(-PX * 4, -PX / 2, PX * 8, PX    ).fill(c);
    // Head + compound eyes
    g.rect(-PX * 5, -PX,     PX * 2, PX * 2).fill(c);
    g.rect(-PX * 6, -PX,     PX,     PX    ).fill(0x00EEBB);
    g.rect(-PX * 6,  0,      PX,     PX    ).fill(0x00EEBB);
    // Tail taper
    g.rect( PX * 4, -PX / 2, PX,     PX / 2).fill(c);
    // 4 wings (2 pairs)
    g.rect(-PX * 4, -PX * 3 + wo, PX * 4, PX / 2).fill({ color: 0xCCEEFF, alpha: 0.70 });
    g.rect( 0,      -PX * 3 + wo, PX * 4, PX / 2).fill({ color: 0xCCEEFF, alpha: 0.70 });
    g.rect(-PX * 3,  PX     + wo, PX * 3, PX / 2).fill({ color: 0xBBDDFF, alpha: 0.55 });
    g.rect( 0,       PX     + wo, PX * 3, PX / 2).fill({ color: 0xBBDDFF, alpha: 0.55 });
  }

  get dead(): boolean { return this._dead; }

  update(delta: number, ctx: SceneContext): void {
    this.age += delta;
    if (this.age >= this.lifetime) { this._dead = true; return; }
    this.stateTimer -= delta;
    if (this.stateTimer <= 0) {
      this.hovering = !this.hovering;
      if (!this.hovering) {
        this.tx = 15 + Math.random() * (ctx.canvasWidth - 30);
        this.ty = 10 + Math.random() * (GROUND_Y - 20);
        this.stateTimer = 25 + Math.random() * 35;
      } else {
        this.stateTimer = 55 + Math.random() * 110;
      }
    }
    if (this.hovering) {
      this.cx += Math.sin(this.age * 0.055) * 0.35 * (delta / 16);
      this.cy += Math.sin(this.age * 0.08)  * 0.25 * (delta / 16);
    } else {
      const dx = this.tx - this.cx;
      const dy = this.ty - this.cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 3) {
        const spd = 5 + (ctx.vitality / 100) * 4;
        this.cx += (dx / dist) * spd * (delta / 16);
        this.cy += (dy / dist) * spd * (delta / 16);
        this.container.scale.x = dx < 0 ? -1 : 1;
      } else {
        this.hovering = true;
        this.stateTimer = 55 + Math.random() * 110;
      }
    }
    this.container.x = this.cx;
    this.container.y = this.cy;
    this._draw(this.age * 0.28);
    const fr = this.age / this.lifetime;
    this.container.alpha = fr > 0.8 ? 1 - (fr - 0.8) / 0.2 : 1;
  }

  destroy(): void { this.container.destroy({ children: true }); }
}

// =============================================================================
// Moth  (nocturnal butterfly variant)
// =============================================================================
export class Moth implements Entity {
  permanent = false;
  private container: PIXI.Container;
  private age = 0;
  private readonly lifetime: number;
  private _dead = false;
  private baseX: number;
  private baseY: number;
  private xSpeed: number;
  private yAmp: number;
  private yFreq: number;
  private yPhase: number;
  private flapPhase: number;
  private readonly wingColor: number;
  private g: PIXI.Graphics;

  constructor(app: PIXI.Application, x: number) {
    this.container = new PIXI.Container();
    this.baseX  = x;
    this.baseY  = GROUND_Y - 30 - Math.random() * 80;
    this.xSpeed = (0.3 + Math.random() * 0.5) * (Math.random() > 0.5 ? 1 : -1);
    this.yAmp   = 5 + Math.random() * 10;
    this.yFreq  = 0.025 + Math.random() * 0.015;
    this.yPhase = Math.random() * Math.PI * 2;
    this.flapPhase = Math.random() * Math.PI * 2;
    this.lifetime = 700 + Math.random() * 800;
    const palette = [0xBB9977, 0xCCAA88, 0x998866, 0xDDCCAA, 0xAA8877];
    this.wingColor = palette[Math.floor(Math.random() * palette.length)];
    this.g = new PIXI.Graphics();
    this.container.addChild(this.g);
    this.container.x = this.baseX;
    this.container.y = this.baseY;
    app.stage.addChild(this.container);
  }

  private _draw(flapY: number): void {
    const g = this.g;
    g.clear();
    const fo = Math.round(flapY);
    const wc = this.wingColor;
    // Body (slightly fatter than butterfly)
    for (let i = 0; i < 4; i++) g.rect(-PX / 2, (i - 2) * PX, PX, PX).fill(0x333322);
    // Wide triangular upper wings
    g.rect(-PX * 4, -PX * 2 + fo, PX * 3, PX * 2).fill(wc);
    g.rect( PX,     -PX * 2 + fo, PX * 3, PX * 2).fill(wc);
    // Smaller lower wings
    g.rect(-PX * 3,  fo,           PX * 2, PX    ).fill(wc);
    g.rect( PX,      fo,           PX * 2, PX    ).fill(wc);
    // Wing pattern dots
    g.rect(-PX * 3, -PX + fo, PX, PX / 2).fill({ color: 0x554433, alpha: 0.7 });
    g.rect( PX * 2, -PX + fo, PX, PX / 2).fill({ color: 0x554433, alpha: 0.7 });
  }

  get dead(): boolean { return this._dead; }

  update(delta: number, ctx: SceneContext): void {
    this.age += delta;
    if (this.age >= this.lifetime) { this._dead = true; return; }
    const spd = 0.3 + (ctx.vitality / 100) * 0.4;
    this.baseX += this.xSpeed * spd * (delta / 16);
    if (this.baseX < -20) this.baseX = ctx.canvasWidth + 20;
    if (this.baseX > ctx.canvasWidth + 20) this.baseX = -20;
    const yOff = Math.sin(this.age * this.yFreq * spd + this.yPhase) * this.yAmp;
    this.container.x = this.baseX;
    this.container.y = this.baseY + yOff;
    this.container.scale.x = this.xSpeed < 0 ? -1 : 1;
    const flapY = Math.sin(this.age * 0.10 + this.flapPhase) * 2;
    this._draw(flapY);
    const fr = this.age / this.lifetime;
    this.container.alpha = fr > 0.8 ? 1 - (fr - 0.8) / 0.2 : 1;
  }

  destroy(): void { this.container.destroy({ children: true }); }
}

// =============================================================================
// FogBank
// =============================================================================
export class FogBank implements DeadEntity {
  permanent = false;
  private container: PIXI.Container;
  private age = 0;
  private readonly lifetime = 800;
  private posX: number;
  private readonly driftDir: number;

  constructor(app: PIXI.Application, fromRight: boolean, rng: RngFn) {
    this.container = new PIXI.Container();
    this.driftDir = fromRight ? -1 : 1;
    this.posX = fromRight ? app.screen.width + 220 : -220;
    this.container.x = this.posX;

    const fogColor = 0xD8EEF4;
    const strips: Array<{ yo: number; alpha: number; count: number }> = [
      { yo: 0,   alpha: 0.22, count: 6 },
      { yo: -5,  alpha: 0.15, count: 5 },
      { yo: -10, alpha: 0.10, count: 4 },
      { yo: -15, alpha: 0.06, count: 3 },
    ];

    for (const strip of strips) {
      for (let i = 0; i < strip.count; i++) {
        const sx = (rng() - 0.5) * 40 + i * 45;
        const sw = 55 + rng() * 60;
        const sh = PX * (2 + Math.floor(rng() * 2));
        const g = new PIXI.Graphics();
        g.rect(sx, GROUND_Y + strip.yo, sw, sh).fill({ color: fogColor, alpha: strip.alpha });
        this.container.addChild(g);
      }
    }

    app.stage.addChild(this.container);
  }

  get dead(): boolean {
    return this.age >= this.lifetime;
  }

  update(delta: number, ctx: SceneContext): void {
    this.age += delta;
    this.posX += (this.driftDir * 0.35 + ctx.windStrength * 0.25 * this.driftDir) * (delta / 16);
    this.container.x = this.posX;
    const fadeRatio = this.age / this.lifetime;
    this.container.alpha = fadeRatio > 0.8 ? 1 - (fadeRatio - 0.8) / 0.2 : 1;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

// =============================================================================
// Aurora
// =============================================================================
export class Aurora implements DeadEntity {
  permanent = false;
  private container: PIXI.Container;
  private age = 0;
  private readonly lifetime = 1200;
  private waveAge = 0;
  private g: PIXI.Graphics;
  private readonly ribbons: Array<{ baseY: number; color: number; amplitude: number; phase: number }>;
  private _dead = false;

  constructor(app: PIXI.Application, rng: RngFn) {
    this.container = new PIXI.Container();

    this.ribbons = [
      { baseY: 15,  color: 0x00FF88, amplitude: 10, phase: rng() * Math.PI * 2 },
      { baseY: 30,  color: 0x00CCFF, amplitude: 8,  phase: rng() * Math.PI * 2 },
      { baseY: 44,  color: 0x8844FF, amplitude: 12, phase: rng() * Math.PI * 2 },
      { baseY: 58,  color: 0x44FFaa, amplitude: 6,  phase: rng() * Math.PI * 2 },
    ];

    this.g = new PIXI.Graphics();
    this.container.addChild(this.g);
    app.stage.addChild(this.container);
  }

  get dead(): boolean {
    return this._dead;
  }

  update(delta: number, ctx: SceneContext): void {
    this.age += delta;
    if (this.age >= this.lifetime) {
      this._dead = true;
      return;
    }

    if (!ctx.isNight) {
      this.container.alpha = 0;
      return;
    }

    this.waveAge += delta * 0.018;

    const fadeIn  = Math.min(1, this.age / (this.lifetime * 0.15));
    const fadeOut = this.age > this.lifetime * 0.85
      ? 1 - (this.age - this.lifetime * 0.85) / (this.lifetime * 0.15)
      : 1;
    this.container.alpha = fadeIn * fadeOut * 0.65;

    const g = this.g;
    g.clear();

    for (const ribbon of this.ribbons) {
      for (let x = 0; x < ctx.canvasWidth; x += PX * 2) {
        const y = ribbon.baseY + Math.sin(x / 38 + this.waveAge + ribbon.phase) * ribbon.amplitude;
        g.rect(x, y, PX, PX * 2).fill({ color: ribbon.color, alpha: 0.28 });
      }
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

// =============================================================================
// RainSplash
// =============================================================================
export class RainSplash implements DeadEntity {
  permanent = false;
  private container: PIXI.Container;
  private age = 0;
  private g: PIXI.Graphics;

  constructor(app: PIXI.Application, x: number, y: number) {
    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;
    this.g = new PIXI.Graphics();
    this.container.addChild(this.g);
    app.stage.addChild(this.container);
  }

  get dead(): boolean {
    return this.age >= 28;
  }

  update(delta: number, _ctx: SceneContext): void {
    this.age += delta;
    const g = this.g;
    g.clear();

    const alpha = Math.max(0, 1 - this.age / 28);
    const r = Math.min(3, Math.floor(this.age / 7) + 1);

    g.rect(-r * PX, 0,   PX, PX).fill({ color: C.rainBlue, alpha });
    g.rect( r * PX, 0,   PX, PX).fill({ color: C.rainBlue, alpha });
    g.rect(0, -r * PX,   PX, PX).fill({ color: C.rainBlue, alpha });
    g.rect(0,  r * PX,   PX, PX).fill({ color: C.rainBlue, alpha });
    if (r >= 2) {
      const d = Math.round((r - 1) * PX * 0.7);
      g.rect(-d, -d, PX, PX).fill({ color: C.puddleBlue, alpha: alpha * 0.5 });
      g.rect( d, -d, PX, PX).fill({ color: C.puddleBlue, alpha: alpha * 0.5 });
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
