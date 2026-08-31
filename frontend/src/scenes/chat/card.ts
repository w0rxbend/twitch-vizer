import * as PIXI from 'pixi.js';

import { layoutMessageParts } from '../../shared/message-layout';
import {
  approach,
  clamp,
  fillStyle,
  formatEventLabel,
  formatEventText,
  mixColor,
  renderParts as renderMessageParts,
  seedRng,
} from '../../shared/overlay';
import type { MessagePart, VisualEventMsg } from '../../shared/overlay';
import { loadAvatarImage, makeStaticParticleContainer } from '../../shared/pixi';
import { PLATE_PIXEL, PX, snapPixel } from './palette';
import type { Palette } from './palette';
import { PixelMascot } from './pixel-mascot';
import { PixelPattern } from './pixel-pattern';

// Durations below are in Pixi ticker units: deltaTime is normalized so one
// unit equals one frame at 60fps, so 60 ticks is roughly one second.
const TICKS_PER_SECOND = 60;
export const CARD_LIFETIME = 30 * TICKS_PER_SECOND;
const ENTER_TICKS = 24;
const LEAVE_TICKS = 55;

const CARD_FONT = '"Courier New", monospace';

function cardTextStyle(overrides: Partial<PIXI.TextStyleOptions>): PIXI.TextStyleOptions {
  return {
    fontFamily: CARD_FONT,
    fontWeight: '900',
    letterSpacing: 0,
    ...overrides,
  };
}

function messageText(msg: VisualEventMsg): string {
  return formatEventText(msg, 'joined the signal');
}

function renderParts(msg: VisualEventMsg): MessagePart[] {
  return renderMessageParts(msg, messageText(msg));
}

export class ChatCard {
  readonly view = new PIXI.Container();
  readonly height: number;
  private readonly lifetime = CARD_LIFETIME;
  private age = 0;
  private targetY = 0;
  private positioned = false;
  private readonly width: number;
  private readonly bg = new PIXI.Graphics();
  private readonly glitch = new PIXI.Graphics();
  private readonly glitchSeed: number;
  private readonly glitchColors: number[];
  private disposeAvatar?: () => void;

  constructor(
    app: PIXI.Application,
    texture: PIXI.Texture,
    msg: VisualEventMsg,
    width: number,
    palette: Palette,
    userSeed: number,
    userAccent: number,
    mascotSeed: number,
    plateSeed: number,
  ) {
    this.width = width;
    this.glitchSeed = plateSeed;
    this.glitchColors = [palette.glow, userAccent, palette.pop, 0xffffff];
    this.view.label = `chat:${msg.username}`;
    this.view.x = 0;
    this.view.alpha = 0;

    const avatarSize = 32;
    const avatarRightPad = 24;
    const avatarX = width - avatarRightPad - avatarSize;
    const textX = 74;
    const wrap = Math.max(180, avatarX - textX - 18);
    const name = new PIXI.Text({
      text: msg.username || 'anonymous',
      style: cardTextStyle({
        fontSize: 18,
        fill: 0x08070b,
        stroke: {
          color: 0xffffff,
          width: 4,
        },
        dropShadow: {
          color: 0x000000,
          alpha: 0.55,
          distance: 2,
          blur: 0,
        },
      }),
    });
    const tag = new PIXI.Text({
      text: formatEventLabel(msg.event),
      style: cardTextStyle({
        fontSize: 11,
        fill: userAccent,
        stroke: {
          color: 0x0b0710,
          width: 2,
        },
      }),
    });
    const content = this.makeMessageContent(msg, palette, wrap);

    name.x = textX;
    name.y = 15;
    tag.x = Math.max(textX, avatarX - tag.width - 14);
    tag.y = 19;
    content.x = textX;
    content.y = 39;

    this.height = Math.max(76, Math.ceil(content.height + 56));
    this.drawFrame(palette, userAccent, plateSeed);

    const pattern = new PixelPattern(texture, width - 16, this.height - 14, palette, plateSeed);
    pattern.view.x = 8;
    pattern.view.y = 7;
    pattern.view.alpha = 0.9;
    const patternMask = new PIXI.Graphics();
    this.stainShapeFill(patternMask, 8, 7, width - 16, this.height - 14, plateSeed, 0xffffff);
    patternMask.renderable = false;
    pattern.view.mask = patternMask;

    const avatar = this.makeAvatar(texture, userSeed, palette, userAccent, msg.avatarUrl);
    avatar.x = avatarX;
    avatar.y = Math.round((this.height - avatarSize) / 2);

    const mascot = new PixelMascot(texture, palette, userAccent, mascotSeed);
    mascot.view.x = -14;
    mascot.view.y = Math.max(30, this.height - 58);

    this.view.addChild(this.bg);
    this.view.addChild(patternMask);
    this.view.addChild(pattern.view);
    this.view.addChild(mascot.view);
    this.view.addChild(avatar);
    this.view.addChild(name);
    this.view.addChild(tag);
    this.view.addChild(content);
    this.view.addChild(this.glitch);

    app.stage.addChild(this.view);
  }

  private makeMessageContent(msg: VisualEventMsg, palette: Palette, wrap: number): PIXI.Container {
    return layoutMessageParts(renderParts(msg), {
      wrap,
      textStyle: cardTextStyle({
        fontSize: 17,
        fill: 0xffffff,
        lineHeight: 24,
        stroke: {
          color: 0x0b0710,
          width: 3,
        },
        dropShadow: {
          color: 0x000000,
          alpha: 0.35,
          distance: 2,
          blur: 0,
        },
      }),
      imageSize: 24,
      gap: 4,
      lineHeight: 24,
      imageInset: 2,
      makeImageBacking: (size) => new PIXI.Graphics()
        .rect(0, 0, size, size)
        .fill(fillStyle(palette.base, 0.55))
        .rect(2, 2, size - 4, size - 4)
        .stroke({ color: palette.ink, width: 2, alpha: 0.38 }),
      fallbackTextStyle: cardTextStyle({ fontSize: 14, fontWeight: '700', fill: 0xffffff }),
      emptyText: messageText(msg),
    });
  }

  setTarget(x: number, y: number): void {
    this.targetY = y;
    this.view.x = x;
    if (!this.positioned) {
      this.view.y = y;
      this.view.alpha = 0;
      this.view.scale.set(1);
      this.positioned = true;
    }
  }

  update(delta: number, x: number): boolean {
    this.age += delta;
    const enter = clamp(this.age / ENTER_TICKS, 0, 1);
    const leave = this.age > this.lifetime - LEAVE_TICKS
      ? clamp((this.lifetime - this.age) / LEAVE_TICKS, 0, 1)
      : 1;
    const entering = 1 - Math.pow(1 - enter, 3);
    const exitGlitch = leave < 1 ? 1 - leave : 0;
    const enterGlitch = 1 - enter;
    const glitchAmount = Math.max(exitGlitch, enterGlitch);
    const pulse = Math.sin((this.age + this.glitchSeed % 41) * 1.7);
    const snap = Math.sin((this.age + this.glitchSeed % 67) * 5.2);
    const jitter = Math.round((pulse * 5 + snap * 2) * glitchAmount / PX) * PX;

    this.view.x = x + jitter;
    this.view.y = approach(this.view.y, this.targetY, 0.22, delta);
    this.view.alpha = entering * leave * (0.72 + 0.28 * clamp(1 - glitchAmount + Math.abs(pulse) * glitchAmount, 0, 1));
    this.view.scale.set(1 + glitchAmount * 0.015 * (snap > 0 ? 1 : -1));
    this.drawGlitch(glitchAmount);

    return this.age >= this.lifetime;
  }

  private drawGlitch(amount: number): void {
    const g = this.glitch;
    g.clear();
    if (amount < 0.04) return;

    const rng = seedRng(this.glitchSeed ^ Math.floor(this.age * 13));
    const strips = 3 + Math.floor(amount * 9);
    for (let i = 0; i < strips; i++) {
      const y = snapPixel(rng() * this.height, PX);
      const h = PX * (1 + Math.floor(rng() * 2));
      const w = this.width * (0.12 + rng() * 0.46);
      const x = snapPixel((rng() - 0.08) * this.width, PX);
      const color = this.glitchColors[Math.floor(rng() * this.glitchColors.length)];
      g.rect(x, y, w, h).fill(fillStyle(color, 0.18 + amount * 0.34));
      if (rng() > 0.45) {
        g.rect(x + PX * (2 + Math.floor(rng() * 8)), y + h, w * (0.35 + rng() * 0.45), PX)
          .fill(fillStyle(0xffffff, 0.14 + amount * 0.24));
      }
    }
  }

  private drawFrame(palette: Palette, userColor: number, plateSeed: number): void {
    const g = this.bg;
    const w = this.width;
    const h = this.height;
    g.clear();

    this.stainShapeFill(g, PX, PX, w, h, plateSeed ^ 0x3001, fillStyle(0x000000, 0.48));
    this.stainShapeFill(g, 0, 0, w, h, plateSeed ^ 0x100d13, 0x100d13);
    this.stainShapeFill(g, PX, PX, w - PX * 2, h - PX * 2, plateSeed, fillStyle(palette.base, 0.90));
    this.stainShapeFill(g, PX * 2, PX * 2, w - PX * 4, h - PX * 4, plateSeed ^ 0x517a, fillStyle(palette.panel, 0.38));
    this.stainShapeFill(g, PX * 3, PX * 3, w - PX * 6, h - PX * 6, plateSeed ^ 0xb10b, fillStyle(palette.base, 0.58));
    this.stainStripe(g, PX * 4, PX * 2, w - PX * 8, 10, plateSeed ^ 0xa11, fillStyle(userColor, 0.94));
    this.stainStripe(g, PX * 5, h - 12, w - PX * 10, PX * 2, plateSeed ^ 0x6100, fillStyle(palette.glow, 0.48));
    this.stainShapeFill(g, 10, 10, 44, h - 20, plateSeed ^ 0x44, fillStyle(0xffffff, 0.13));
    this.stainShapeFill(g, 14, 14, 36, h - 28, plateSeed ^ 0x22, fillStyle(userColor, 0.22));
  }

  private stainStripe(
    g: PIXI.Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    seed: number,
    fill: number | { color: number; alpha: number },
  ): void {
    const rng = seedRng(seed);
    const step = PX;
    for (let px = x; px < x + w; px += step * (1 + Math.floor(rng() * 3))) {
      const blockW = step * (2 + Math.floor(rng() * 6));
      const blockH = Math.max(step, h + (rng() - 0.5) * step * 2);
      g.rect(px, y + (rng() - 0.5) * step, blockW, blockH).fill(fill);
    }
  }

  private stainShapeFill(
    g: PIXI.Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    seed: number,
    fill: number | { color: number; alpha: number },
  ): void {
    const rng = seedRng(seed);
    const step = PLATE_PIXEL;
    const rows = Math.max(3, Math.ceil(h / step));
    const phaseA = rng() * Math.PI * 2;
    const phaseB = rng() * Math.PI * 2;
    const maxInset = Math.min(w * 0.16, 34 + rng() * 18);

    for (let row = 0; row < rows; row++) {
      const t = rows <= 1 ? 0.5 : row / (rows - 1);
      const edge = Math.abs(t - 0.5) * 2;
      const rowY = y + row * step;
      const rowH = Math.min(step, y + h - rowY);
      const leftWave = Math.sin(row * 0.88 + phaseA) * 9 + Math.sin(row * 0.37 + phaseB) * 7;
      const rightWave = Math.cos(row * 0.74 + phaseB) * 10 + Math.sin(row * 0.29 + phaseA) * 6;
      const taper = Math.pow(edge, 1.55) * maxInset;
      const left = snapPixel(Math.max(0, taper + leftWave + (rng() - 0.5) * 12), PX);
      const right = snapPixel(Math.max(0, taper + rightWave + (rng() - 0.5) * 12), PX);
      const rowW = Math.max(step * 4, w - left - right);
      g.rect(x + left, rowY, rowW, rowH).fill(fill);

      if (rng() > 0.50) {
        const blobW = step * (1 + Math.floor(rng() * 3));
        g.rect(x + left - blobW, rowY, blobW, rowH).fill(fill);
      }
      if (rng() > 0.50) {
        const blobW = step * (1 + Math.floor(rng() * 3));
        g.rect(x + left + rowW, rowY, blobW, rowH).fill(fill);
      }
    }

    const specks = 10 + Math.floor(rng() * 14);
    for (let i = 0; i < specks; i++) {
      const side = rng();
      const px = side < 0.33 ? x + rng() * w : side < 0.66 ? x - step + rng() * step * 2 : x + w - rng() * step;
      const py = side < 0.33 ? y + (rng() > 0.5 ? -step : h) + (rng() - 0.5) * step : y + rng() * h;
      const size = step * (rng() > 0.72 ? 2 : 1);
      g.rect(snapPixel(px, PX), snapPixel(py, PX), size, size).fill(fill);
    }
  }

  private makeAvatar(
    texture: PIXI.Texture,
    seed: number,
    palette: Palette,
    userColor: number,
    avatarUrl?: string | null,
  ): PIXI.Container {
    const view = new PIXI.Container();
    const mask = new PIXI.Graphics().circle(16, 16, 14).fill(0xffffff);
    const fallback = makeStaticParticleContainer(texture);
    const rng = seedRng(seed ^ 0xfeedbabe);
    const colors = [palette.ink, userColor, palette.glow, palette.pop, palette.base];
    const particles: PIXI.Particle[] = [];
    fallback.x = 2;
    fallback.y = 2;
    fallback.mask = mask;
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const mirrorX = x > 3 ? 6 - x : x;
        const filled = rng() + mirrorX * 0.08 + y * 0.025 > 0.42;
        if (!filled) continue;
        particles.push(new PIXI.Particle({
          texture,
          x: x * PX,
          y: y * PX,
          scaleX: PX,
          scaleY: PX,
          tint: colors[Math.floor(rng() * colors.length)],
          alpha: 0.92,
        }));
      }
    }
    fallback.addParticle(...particles);
    fallback.update();
    view.addChild(mask);
    view.addChild(fallback);
    view.addChild(this.makeAvatarFrame(palette, userColor));

    if (avatarUrl) {
      this.disposeAvatar = loadAvatarImage(avatarUrl, view, fallback, {
        size: 28,
        offset: 2,
        mask,
        addAtIndex: 2,
        label: 'ChatOverlay',
      });
    }
    return view;
  }

  private makeAvatarFrame(palette: Palette, userColor: number): PIXI.Graphics {
    const frame = new PIXI.Graphics();
    frame.circle(16, 16, 16).stroke({ color: 0x07050b, width: 4, alpha: 0.74 });
    frame.circle(16, 16, 13).stroke({ color: mixColor(palette.glow, userColor, 0.42), width: 3, alpha: 0.92 });
    frame.rect(7, 5, 6, 3).fill(fillStyle(0xffffff, 0.55));
    frame.rect(11, 4, 3, 3).fill(fillStyle(0xffffff, 0.38));
    return frame;
  }

  destroy(): void {
    this.view.destroy({ children: true });
    this.disposeAvatar?.();
  }
}
