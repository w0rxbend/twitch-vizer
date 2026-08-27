import * as PIXI from 'pixi.js';

import type { Expression, ToneResult } from './tone';

export interface StickerData {
  text: string;
  expression: Expression;
  sender?: string;
}

const FONT = '"Trebuchet MS", "Avenir Next", "Segoe UI", sans-serif';
const INK = 0x1f1500;
const BROWN = 0x552400;
const TONGUE = 0xff5a78;
const BLUE = 0x39aef2;
const PINK = 0xff7d9d;
const YELLOW = 0xffd215;
const GOLD = 0xf7b700;
const LIGHT = 0xffea55;
const SAD_ORANGE = 0xffa631;
const SAD_EDGE = 0xf06024;
const SAD_LIGHT = 0xffcd63;
const ANGRY_RED = 0xff5a24;
const ANGRY_EDGE = 0xd9271c;
const ANGRY_LIGHT = 0xff8a35;
// Measured in Pixi ticker frames; all chip timing assumes a 60fps ticker.
export const CARD_LIFETIME = 26 * 60;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seedRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    return ((state >>> 0) / 0x100000000);
  };
}

function rgba(color: number, alpha: number): { color: number; alpha: number } {
  return { color, alpha };
}

function drawSoftPill(
  g: PIXI.Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: number | { color: number; alpha: number },
  seed: number,
): void {
  const rng = seedRng(seed);
  const r = height / 2;
  const topLift = (rng() - 0.5) * 3.5;
  const bottomLift = (rng() - 0.5) * 4.5;
  const leftBump = (rng() - 0.5) * 4;
  const rightBump = (rng() - 0.5) * 4;
  const c = 0.5522847498;

  g.moveTo(x + r * 0.98, y + topLift);
  g.bezierCurveTo(x + width * 0.32, y - 2 + topLift, x + width * 0.68, y + 2 - topLift, x + width - r * 0.98, y + topLift * 0.6);
  g.bezierCurveTo(x + width - r + r * c + rightBump, y, x + width + rightBump, y + r - r * c, x + width + rightBump, y + r);
  g.bezierCurveTo(x + width + rightBump, y + r + r * c, x + width - r + r * c, y + height, x + width - r, y + height + bottomLift);
  g.bezierCurveTo(x + width * 0.66, y + height + 2 + bottomLift, x + width * 0.32, y + height - 2 - bottomLift, x + r, y + height + bottomLift * 0.7);
  g.bezierCurveTo(x + r - r * c + leftBump, y + height, x + leftBump, y + r + r * c, x + leftBump, y + r);
  g.bezierCurveTo(x + leftBump, y + r - r * c, x + r - r * c, y, x + r, y + topLift);
  g.closePath();
  g.fill(fill);
}

function smile(g: PIXI.Graphics, x: number, y: number, w: number, depth: number, color = BROWN, stroke = 4): void {
  g.moveTo(x, y);
  g.quadraticCurveTo(x + w / 2, y + depth, x + w, y);
  g.stroke({ color, width: stroke, cap: 'round' });
}

function frown(g: PIXI.Graphics, x: number, y: number, w: number, depth: number, color = BROWN, stroke = 4): void {
  g.moveTo(x, y);
  g.quadraticCurveTo(x + w / 2, y - depth, x + w, y);
  g.stroke({ color, width: stroke, cap: 'round' });
}

function closedEye(g: PIXI.Graphics, x: number, y: number, flip = 1): void {
  g.moveTo(x - 8, y);
  g.quadraticCurveTo(x, y - 8 * flip, x + 8, y);
  g.stroke({ color: BROWN, width: 4, cap: 'round' });
}

function xEye(g: PIXI.Graphics, x: number, y: number): void {
  g.moveTo(x - 7, y - 7).lineTo(x + 7, y + 7).stroke({ color: BROWN, width: 4, cap: 'round' });
  g.moveTo(x + 7, y - 7).lineTo(x - 7, y + 7).stroke({ color: BROWN, width: 4, cap: 'round' });
}

function tear(g: PIXI.Graphics, x: number, y: number, size = 12): void {
  g.moveTo(x, y - size);
  g.bezierCurveTo(x + size * 0.65, y - size * 0.1, x + size * 0.55, y + size * 0.75, x, y + size);
  g.bezierCurveTo(x - size * 0.55, y + size * 0.75, x - size * 0.65, y - size * 0.1, x, y - size);
  g.closePath();
  g.fill(BLUE);
  g.circle(x - size * 0.22, y - size * 0.10, size * 0.18).fill(rgba(0xffffff, 0.58));
}

function heart(g: PIXI.Graphics, x: number, y: number, size = 9, color = 0xf23a52): void {
  g.circle(x - size * 0.34, y - size * 0.18, size * 0.42).fill(color);
  g.circle(x + size * 0.34, y - size * 0.18, size * 0.42).fill(color);
  g.moveTo(x - size * 0.82, y - size * 0.08);
  g.lineTo(x + size * 0.82, y - size * 0.08);
  g.lineTo(x, y + size);
  g.closePath();
  g.fill(color);
}

function star(g: PIXI.Graphics, x: number, y: number, r: number): void {
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const radius = i % 2 === 0 ? r : r * 0.48;
    const px = x + Math.cos(a) * radius;
    const py = y + Math.sin(a) * radius;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fill(0xfff7b5);
}

// Shared animation values for one face redraw, derived from the chip's face
// time (in 60fps ticker frames) and seed.
interface FaceContext {
  cx: number;
  cy: number;
  eyeL: number;
  eyeR: number;
  t: number;
  bob: number;
  soft: number;
  quick: number;
  shake: number;
  tearDrop: number;
  pulse: number;
  blink: number;
}

type FaceDrawer = (g: PIXI.Graphics, ctx: FaceContext) => void;

function drawSurprised(g: PIXI.Graphics, ctx: FaceContext, scared: boolean): void {
  const { cx, cy, eyeL, eyeR, soft, quick, shake, pulse, blink } = ctx;
  const jitter = scared ? shake : 0;
  g.circle(eyeL + jitter, cy - 10 + soft * 0.25, 10 + Math.max(quick, 0) * 1.2).fill(0xffffff);
  g.circle(eyeR + jitter, cy - 10 + soft * 0.25, 10 + Math.max(quick, 0) * 1.2).fill(0xffffff);
  g.circle(eyeL + jitter, cy - 10 + blink * 0.35, 4).fill(BROWN);
  g.circle(eyeR + jitter, cy - 10 + blink * 0.35, 4).fill(BROWN);
  g.ellipse(cx + (scared ? shake * 0.4 : 0), cy + 15 + soft * 0.4, scared ? 11 + pulse : 8 + pulse * 0.7, scared ? 16 + pulse * 2 : 10 + pulse).fill(BROWN);
  if (scared) g.rect(cx - 5, cy + 18, 10, 6).fill(TONGUE);
}

function drawSleepy(g: PIXI.Graphics, ctx: FaceContext, night: boolean): void {
  const { cx, cy, eyeL, eyeR, t, soft, tearDrop } = ctx;
  closedEye(g, eyeL, cy - 9 + soft * 0.3, -1);
  closedEye(g, eyeR, cy - 9 + soft * 0.3, -1);
  g.rect(cx - 15, cy + 12 + soft * 0.45, 30, 4).fill(BROWN);
  if (!night) tear(g, eyeR + 16 + Math.sin(t * 0.08) * 1.5, cy + 13 + ((tearDrop + 5) % 13), 9);
  else {
    g.circle(cx + 21 + Math.sin(t * 0.08) * 2, cy - 24 - (t * 0.18) % 7, 5).fill(0x2f8bf3);
    g.circle(cx + 30 + Math.sin(t * 0.07 + 1) * 2, cy - 35 - (t * 0.15) % 7, 4).fill(0x2f8bf3);
    g.circle(cx + 39 + Math.sin(t * 0.06 + 2) * 2, cy - 45 - (t * 0.12) % 7, 3).fill(0x2f8bf3);
  }
}

function drawLaugh(g: PIXI.Graphics, ctx: FaceContext, relieved: boolean): void {
  const { cx, cy, eyeL, eyeR, t, bob, quick, tearDrop } = ctx;
  closedEye(g, eyeL, cy - 10 + bob * 0.3, 1);
  closedEye(g, eyeR, cy - 10 + bob * 0.3, 1);
  g.ellipse(cx, cy + 10 + bob * 0.35, 22, 14 + Math.max(quick, 0) * 2).fill(BROWN);
  g.rect(cx - 18, cy + 8 + bob * 0.35, 36, 6).fill(0xffffff);
  if (!relieved) {
    tear(g, eyeL - 14, cy + 10 + ((tearDrop + 3) % 12), 8);
    tear(g, eyeR + 14, cy + 10 + ((tearDrop + 9) % 12), 8);
  } else {
    tear(g, eyeR + 15 + Math.sin(t * 0.1) * 1.4, cy - 18 + ((tearDrop + 5) % 10), 8);
  }
}

const FACE_DRAWERS: Record<Expression, FaceDrawer> = {
  happy: (g, { cx, cy, eyeL, eyeR, bob, pulse }) => {
    closedEye(g, eyeL, cy - 11 + bob * 0.25, 1);
    closedEye(g, eyeR, cy - 11 + bob * 0.25, 1);
    g.ellipse(cx, cy + 12 + bob * 0.45, 18, 11 + pulse).fill(BROWN);
    g.ellipse(cx, cy + 13 + bob * 0.45, 13, 6 + pulse * 0.35).fill(TONGUE);
  },
  kiss: (g, { cx, cy, eyeL, eyeR, t, bob, soft, quick, pulse }) => {
    g.circle(eyeL, cy - 11 + soft * 0.3, 5 + Math.max(quick, 0) * 0.6).fill(BROWN);
    closedEye(g, eyeR, cy - 12 + soft * 0.3, 1);
    g.moveTo(cx - 1, cy + 4);
    g.quadraticCurveTo(cx + 8, cy + 8, cx - 1, cy + 14);
    g.quadraticCurveTo(cx - 10, cy + 8, cx - 1, cy + 4);
    g.stroke({ color: BROWN, width: 4, cap: 'round' });
    heart(g, 62 + Math.sin(t * 0.1) * 1.8, cy + 11 - bob, 9 * pulse);
  },
  cry: (g, { cx, cy, eyeL, eyeR, soft, quick, tearDrop }) => {
    frown(g, eyeL - 10, cy - 15 + soft * 0.3, 18, 7);
    frown(g, eyeR - 8, cy - 15 + soft * 0.3, 18, 7);
    g.circle(eyeL, cy - 4, 4).fill(BROWN);
    g.circle(eyeR, cy - 4, 4).fill(BROWN);
    g.ellipse(cx, cy + 15 + soft * 0.5, 11, 15 + Math.max(quick, 0) * 2).fill(BROWN);
    g.rect(cx - 5, cy + 17, 10, 8).fill(TONGUE);
    tear(g, eyeL - 8, cy + 8 + tearDrop, 13);
    tear(g, eyeR + 8, cy + 13 + ((tearDrop + 8) % 19), 13);
  },
  surprised: (g, ctx) => drawSurprised(g, ctx, false),
  scared: (g, ctx) => drawSurprised(g, ctx, true),
  sleepy: (g, ctx) => drawSleepy(g, ctx, false),
  night: (g, ctx) => drawSleepy(g, ctx, true),
  awkward: (g, { cx, cy, eyeL, eyeR, soft, tearDrop }) => {
    frown(g, eyeL - 10, cy - 12 + soft * 0.4, 18, 7);
    g.circle(eyeL, cy - 3, 5).fill(BROWN);
    g.circle(eyeR, cy - 1, 5).fill(BROWN);
    frown(g, cx - 16, cy + 18 + soft * 0.4, 30, 11);
    tear(g, eyeR + 15, cy - 13 + ((tearDrop + 2) % 15), 8);
  },
  laugh: (g, ctx) => drawLaugh(g, ctx, false),
  relieved: (g, ctx) => drawLaugh(g, ctx, true),
  grin: (g, { cx, cy, eyeL, eyeR, bob, quick }) => {
    closedEye(g, eyeL, cy - 11 + bob * 0.25, 1);
    closedEye(g, eyeR, cy - 11 + bob * 0.25, 1);
    g.ellipse(cx, cy + 12 + bob * 0.3, 20, 12 + Math.max(quick, 0)).fill(BROWN);
    g.rect(cx - 16, cy + 10 + bob * 0.3, 32, 7).fill(0xffffff);
  },
  wink: (g, { cx, cy, eyeL, eyeR, soft, quick }) => {
    g.circle(eyeL, cy - 9, 5).fill(BROWN);
    g.moveTo(eyeR - 9, cy - 8 + quick * 0.7).lineTo(eyeR + 9, cy - 8 - quick * 0.7).stroke({ color: BROWN, width: 4, cap: 'round' });
    smile(g, cx - 16, cy + 12 + soft * 0.4, 29, 10 + Math.max(quick, 0));
  },
  angry: (g, { cx, cy, eyeL, eyeR, soft, quick, shake }) => {
    g.moveTo(eyeL - 11 + shake, cy - 18).lineTo(eyeL + 8 + shake, cy - 10 + quick).stroke({ color: BROWN, width: 5, cap: 'round' });
    g.moveTo(eyeR + 11 + shake, cy - 18).lineTo(eyeR - 8 + shake, cy - 10 - quick).stroke({ color: BROWN, width: 5, cap: 'round' });
    g.circle(eyeL + shake * 0.4, cy - 5, 5 + Math.max(quick, 0) * 0.5).fill(BROWN);
    g.circle(eyeR + shake * 0.4, cy - 5, 5 + Math.max(-quick, 0) * 0.5).fill(BROWN);
    frown(g, cx - 16 + shake * 0.35, cy + 20 + soft * 0.35, 32, 13 + Math.abs(quick), BROWN, 5);
  },
  cool: (g, { cx, cy, eyeL, eyeR, t, soft }) => {
    g.roundRect(eyeL - 15, cy - 19, 25, 15, 4).fill(0x141414);
    g.roundRect(eyeR - 10, cy - 19, 25, 15, 4).fill(0x141414);
    g.rect(eyeL + 8, cy - 14, 15, 4).fill(0x141414);
    g.rect(eyeL - 13 + (t * 0.18) % 15, cy - 17, 7, 3).fill(rgba(0xffffff, 0.32));
    g.rect(eyeR - 8 + (t * 0.18) % 15, cy - 17, 7, 3).fill(rgba(0xffffff, 0.32));
    smile(g, cx - 16, cy + 15 + soft * 0.3, 32, 9);
  },
  lovely: (g, { cx, cy, eyeL, eyeR, t, bob, quick, pulse }) => {
    closedEye(g, eyeL, cy - 10 + bob * 0.25, 1);
    closedEye(g, eyeR, cy - 10 + bob * 0.25, 1);
    smile(g, cx - 14, cy + 8 + bob * 0.2, 28, 8 + pulse * 0.5);
    g.circle(eyeL - 10, cy + 8, 7 + Math.max(quick, 0) * 0.7).fill(rgba(PINK, 0.58));
    g.circle(eyeR + 10, cy + 8, 7 + Math.max(quick, 0) * 0.7).fill(rgba(PINK, 0.58));
    heart(g, eyeR + 22 + Math.sin(t * 0.11) * 1.5, cy - 25 - bob, 8 * pulse);
    heart(g, eyeR + 18 + Math.sin(t * 0.09 + 1) * 1.2, cy + 20 - bob * 0.6, 7 * (1 + Math.sin(t * 0.17 + 2) * 0.12));
  },
  yikes: (g, { cx, cy, eyeL, eyeR, quick }) => {
    xEye(g, eyeL, cy - 10);
    xEye(g, eyeR, cy - 10);
    g.roundRect(cx - 10, cy + 7, 20, 15, 5).fill(BROWN);
    g.rect(cx - 7, cy + 16, 14, 16 + Math.max(quick, 0) * 4).fill(TONGUE);
  },
  dead: (g, { cx, cy, eyeL, eyeR, soft, quick, shake }) => {
    xEye(g, eyeL + shake * 0.3, cy - 12 + soft * 0.3);
    xEye(g, eyeR + shake * 0.3, cy - 12 - soft * 0.3);
    g.ellipse(cx, cy + 14 + soft * 0.4, 11, 15).fill(BROWN);
    g.rect(cx - 5, cy + 16 + soft * 0.5, 10, 7 + Math.max(quick, 0) * 2).fill(TONGUE);
  },
  unimpressed: (g, { cx, cy, eyeL, eyeR, t, soft }) => {
    g.rect(eyeL - 10, cy - 13 + soft * 0.2, 19, 5).fill(BROWN);
    g.rect(eyeR - 9, cy - 13 + soft * 0.2, 19, 5).fill(BROWN);
    g.circle(eyeL + Math.sin(t * 0.04) * 2.5, cy - 10, 4).fill(0xffffff);
    g.circle(eyeR + Math.sin(t * 0.04) * 2.5, cy - 10, 4).fill(0xffffff);
    frown(g, cx - 17, cy + 18 + soft * 0.2, 34, 10);
  },
  star: (g, { cx, cy, eyeL, eyeR, t, bob, quick, pulse }) => {
    star(g, eyeL, cy - 11, 12 * pulse);
    star(g, eyeR, cy - 11, 12 * (1 + Math.sin(t * 0.16 + 1.2) * 0.12));
    g.ellipse(cx, cy + 14 + bob * 0.25, 19, 12 + Math.max(quick, 0)).fill(BROWN);
    g.rect(cx - 14, cy + 12 + bob * 0.25, 28, 6).fill(0xffffff);
  },
  sad: (g, { cx, cy, eyeL, eyeR, soft, quick, tearDrop }) => {
    g.moveTo(eyeL - 10, cy - 15);
    g.quadraticCurveTo(eyeL - 1, cy - 21, eyeL + 9, cy - 14);
    g.stroke({ color: BROWN, width: 4, cap: 'round' });
    g.moveTo(eyeR - 9, cy - 14);
    g.quadraticCurveTo(eyeR + 1, cy - 21, eyeR + 10, cy - 15);
    g.stroke({ color: BROWN, width: 4, cap: 'round' });
    g.ellipse(eyeL, cy - 3 + soft * 0.25, 4, 6).fill(BROWN);
    g.ellipse(eyeR, cy - 3 + soft * 0.25, 4, 6).fill(BROWN);
    frown(g, cx - 15, cy + 18 + soft * 0.4, 30, 8 + Math.max(-quick, 0), BROWN, 4);
    tear(g, eyeR + 14, cy + 2 + ((tearDrop + 4) % 14), 7);
  },
  down: (g, { cx, cy, eyeL, eyeR, soft, quick }) => {
    g.moveTo(eyeL - 9, cy - 14);
    g.quadraticCurveTo(eyeL - 1, cy - 18, eyeL + 8, cy - 12);
    g.stroke({ color: BROWN, width: 4, cap: 'round' });
    g.moveTo(eyeR - 8, cy - 12);
    g.quadraticCurveTo(eyeR + 1, cy - 18, eyeR + 9, cy - 14);
    g.stroke({ color: BROWN, width: 4, cap: 'round' });
    g.circle(eyeL, cy - 3 + soft * 0.2, 4).fill(BROWN);
    g.circle(eyeR, cy - 3 + soft * 0.2, 4).fill(BROWN);
    frown(g, cx - 16, cy + 18 + soft * 0.4, 32, 10 + Math.max(-quick, 0), BROWN, 4);
  },
  neutral: (g, { cx, cy, eyeL, eyeR, soft, quick, blink }) => {
    g.ellipse(eyeL, cy - 9, 5, Math.max(1.5, 5 - blink)).fill(BROWN);
    g.ellipse(eyeR, cy - 9, 5, Math.max(1.5, 5 - blink)).fill(BROWN);
    smile(g, cx - 16, cy + 10 + soft * 0.25, 32, 9 + Math.max(quick, 0) * 0.6, BROWN, 4);
  },
};

export class EmojiStickerChip {
  readonly view = new PIXI.Container();
  readonly width: number;
  readonly height: number;
  readonly layoutSeed: number;
  private readonly seed: number;
  private readonly body = new PIXI.Graphics();
  private readonly shine = new PIXI.Graphics();
  private readonly face = new PIXI.Graphics();
  private readonly senderBadge = new PIXI.Graphics();
  private readonly shadow = new PIXI.Graphics();
  private readonly label: PIXI.Text;
  private readonly senderLabel: PIXI.Text;
  private readonly lifetime = CARD_LIFETIME;
  private age = 0;
  private faceTime = 0;
  private baseX = 0;
  private baseY = 0;
  private targetX = 0;
  private targetY = 0;
  private positioned = false;
  private destroyed = false;

  constructor(private data: StickerData, seed: number) {
    this.seed = seed;
    this.layoutSeed = seed;
    this.height = 64;
    const faceWidth = 74;
    this.label = new PIXI.Text({
      text: data.text,
      style: {
        fontFamily: FONT,
        fontSize: 21,
        fontWeight: '900',
        fill: INK,
        letterSpacing: 0,
      },
    });
    const maxLabelWidth = 420;
    if (this.label.width > maxLabelWidth) this.label.scale.x = maxLabelWidth / this.label.width;
    this.label.x = faceWidth + 12;
    this.label.y = Math.round((this.height - this.label.height) / 2) - 1;
    this.width = Math.ceil(clamp(faceWidth + 28 + this.label.width, 156, 540));
    this.senderLabel = new PIXI.Text({
      text: this.senderText(),
      style: {
        fontFamily: FONT,
        fontSize: 12,
        fontWeight: '900',
        fill: 0x5a3700,
        letterSpacing: 0,
      },
    });
    this.view.alpha = 0;
    this.view.scale.set(0.96);
    this.view.addChild(this.shadow, this.body, this.shine, this.face, this.label, this.senderBadge, this.senderLabel);
    this.redraw();
  }

  setTarget(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
    if (!this.positioned) {
      this.baseX = x;
      this.baseY = y + 20;
      this.view.x = this.baseX;
      this.view.y = this.baseY;
      this.positioned = true;
    }
  }

  applyTone(result: ToneResult): void {
    if (this.destroyed) return;
    this.data = { ...this.data, expression: result.expression };
    this.faceTime = 0;
    this.redraw();
  }

  // delta is Pixi ticker deltaTime (frames); pacing assumes a 60fps ticker.
  update(delta: number): boolean {
    this.age += delta;
    this.faceTime += delta;
    const enter = clamp(this.age / 22, 0, 1);
    const leave = this.age > this.lifetime - 54 ? clamp((this.lifetime - this.age) / 54, 0, 1) : 1;
    const ease = 1 - Math.pow(1 - enter, 3);
    const wobble = Math.sin(this.age * 0.035 + this.seed) * 1.8;
    const float = Math.sin(this.age * 0.027 + this.seed * 0.33) * 3.2;
    this.baseX += (this.targetX - this.baseX) * 0.22 * delta;
    this.baseY += (this.targetY - this.baseY) * 0.24 * delta;
    this.view.x = this.baseX + wobble;
    this.view.y = this.baseY + float;
    this.view.rotation = Math.sin(this.age * 0.018 + this.seed) * 0.01;
    this.view.alpha = ease * leave;
    const scale = 0.96 + ease * 0.04;
    this.view.scale.set(scale * (1 + Math.sin(this.age * 0.031 + this.seed) * 0.006), scale);
    this.redrawFaceAnimation();
    return this.age >= this.lifetime;
  }

  destroy(): void {
    this.destroyed = true;
    this.view.destroy({ children: true });
  }

  private redraw(): void {
    const angry = this.data.expression === 'angry';
    const sad = this.data.expression === 'sad' || this.data.expression === 'down' || this.data.expression === 'cry';
    const base = angry ? ANGRY_RED : sad ? SAD_ORANGE : YELLOW;
    const edge = angry ? ANGRY_EDGE : sad ? SAD_EDGE : GOLD;
    const highlight = angry ? ANGRY_LIGHT : sad ? SAD_LIGHT : LIGHT;
    const rSeed = this.seed ^ this.width ^ (this.data.expression.length * 317);

    this.shadow.clear();
    drawSoftPill(this.shadow, 3, 9, this.width, this.height, rgba(0x3c2c00, 0.16), rSeed);

    this.body.clear();
    drawSoftPill(this.body, 0, 0, this.width, this.height, base, rSeed);
    drawSoftPill(this.body, 2, 3, this.width - 4, this.height * 0.48, rgba(highlight, 0.34), rSeed ^ 0xaaa);
    this.body.rect(18, this.height - 8, this.width - 42, 4).fill(rgba(edge, 0.18));

    this.shine.clear();
    this.shine.ellipse(this.width * 0.24, 13, this.width * 0.18, 7).fill(rgba(0xffffff, 0.20));
    this.shine.ellipse(this.width * 0.62, 11, this.width * 0.12, 5).fill(rgba(0xffffff, 0.10));

    this.redrawFaceAnimation();
    this.drawSenderBadge();
  }

  private redrawFaceAnimation(): void {
    this.face.clear();
    const t = this.faceTime + (this.seed % 997) * 0.013;
    const ctx: FaceContext = {
      cx: 38,
      cy: 32,
      eyeL: 24,
      eyeR: 48,
      t,
      bob: Math.sin(t * 0.12) * 2.2,
      soft: Math.sin(t * 0.08) * 1.4,
      quick: Math.sin(t * 0.32),
      shake: Math.round(Math.sin(t * 0.72) * 1.8),
      tearDrop: (t * 0.65) % 19,
      pulse: 1 + Math.sin(t * 0.14) * 0.12,
      blink: Math.sin(t * 0.055) > 0.965 ? 3 : 0,
    };
    FACE_DRAWERS[this.data.expression](this.face, ctx);
  }

  private senderText(): string {
    const raw = this.data.sender?.trim() || 'anonymous';
    return raw.length > 18 ? `${raw.slice(0, 16)}..` : raw;
  }

  private drawSenderBadge(): void {
    const text = this.senderText();
    this.senderLabel.text = text;
    this.senderLabel.scale.set(1);
    const maxTextWidth = 118;
    if (this.senderLabel.width > maxTextWidth) this.senderLabel.scale.x = maxTextWidth / this.senderLabel.width;

    const badgeW = Math.ceil(clamp(this.senderLabel.width + 22, 54, 142));
    const badgeH = 24;
    const x = this.width - badgeW - 16;
    const y = -11;
    const seed = this.seed ^ hashSeed(text) ^ 0x51a7e;

    this.senderBadge.clear();
    drawSoftPill(this.senderBadge, x + 2, y + 3, badgeW, badgeH, rgba(0x3c2c00, 0.14), seed);
    drawSoftPill(this.senderBadge, x, y, badgeW, badgeH, 0xffec7a, seed);
    drawSoftPill(this.senderBadge, x + 3, y + 2, badgeW - 6, badgeH * 0.46, rgba(0xffffff, 0.24), seed ^ 0x99);
    this.senderBadge.rect(x + 13, y + badgeH - 5, badgeW - 26, 3).fill(rgba(0xe3a600, 0.28));

    this.senderLabel.x = Math.round(x + (badgeW - this.senderLabel.width) / 2);
    this.senderLabel.y = Math.round(y + (badgeH - this.senderLabel.height) / 2) - 1;
  }
}
