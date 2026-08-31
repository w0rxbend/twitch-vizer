import * as PIXI from 'pixi.js';

import { layoutMessageParts } from '../../shared/message-layout';
import {
  approach,
  clamp,
  fillStyle,
  formatEventLabel,
  formatEventText,
  renderParts as renderMessageParts,
  seedRng,
} from '../../shared/overlay';
import type { MessagePart, VisualEventMsg, VisualEventName } from '../../shared/overlay';
import { AVATAR_SIZE, PixelAvatar } from './pixel-avatar';
import { COMPANION_HEIGHT, PixelCompanion } from './pixel-companion';
import { PX, snap, TILE } from './pixel-helpers';
import { TextilePlate } from './textile-plate';
import type { Palette, PixelChatTheme } from './theme';

// All ages/lifetimes below are in PIXI ticker deltaTime units: 1 unit = one
// frame at the assumed 60fps, so e.g. CARD_LIFETIME is ~34 seconds.
const CARD_LIFETIME_SECONDS = 34;
export const CARD_LIFETIME = CARD_LIFETIME_SECONDS * 60;
const ENTER_FRAMES = 20;
const LEAVE_FRAMES = 60;

const FONT = '"Courier New", "Lucida Console", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", monospace';
const TEXT_WHITE = 0xffffff;
const TEXT_BLACK = 0x050507;

// Card layout: [companion | text column | avatar], vertically padded.
const TEXT_X = 112;
const COMPANION_X = 24;
const AVATAR_RIGHT_MARGIN = 22;
const TEXT_AVATAR_GAP = 20;
const MIN_CARD_HEIGHT = 92;
const CONTENT_V_PADDING = 62;

function messageText(msg: VisualEventMsg): string {
  return formatEventText(msg, 'joined the pattern');
}

function eventLabel(event: VisualEventName): string {
  return formatEventLabel(event, { chatLabel: 'PIXEL', separator: ' ' });
}

function textParts(msg: VisualEventMsg): MessagePart[] {
  return renderMessageParts(msg, messageText(msg));
}

export interface PixelChatCardOptions {
  texture: PIXI.Texture;
  msg: VisualEventMsg;
  width: number;
  palette: Palette;
  userSeed: number;
  userAccent: number;
  seed: number;
  theme: PixelChatTheme;
}

export class PixelChatCard {
  readonly view = new PIXI.Container();
  readonly height: number;
  readonly width: number;
  readonly seed: number;
  /** Left edge chosen once at spawn; the overlay only restacks vertically. */
  left = 0;
  private readonly fx = new PIXI.Graphics();
  private readonly noise = new PIXI.Graphics();
  private readonly lifetime = CARD_LIFETIME;
  private readonly fxColors: number[];
  private readonly companion: PIXI.Container;
  private readonly companionBaseY: number;
  private readonly avatar: PixelAvatar;
  private age = 0;
  private targetX = 0;
  private targetY = 0;
  private positioned = false;

  constructor(options: PixelChatCardOptions) {
    const { texture, msg, width, palette, userSeed, userAccent, seed, theme } = options;
    this.width = width;
    this.seed = seed;
    this.fxColors = [
      TEXT_WHITE,
      userAccent,
      palette.line,
      palette.rose,
      palette.gold,
      palette.blue,
      palette.violet,
      palette.leaf,
    ];
    this.view.label = `pixel-chat:${msg.username}`;
    this.view.alpha = 0;

    const avatarX = width - AVATAR_SIZE - AVATAR_RIGHT_MARGIN;
    const wrap = Math.max(210, avatarX - TEXT_X - TEXT_AVATAR_GAP);
    const content = this.makeContent(msg, palette, wrap);
    const name = new PIXI.Text({
      text: msg.username || 'anonymous',
      style: {
        fontFamily: FONT,
        fontSize: 18,
        fontWeight: '900',
        fill: TEXT_BLACK,
        letterSpacing: 0,
        stroke: { color: TEXT_WHITE, width: 3 },
      },
    });
    const tag = new PIXI.Text({
      text: eventLabel(msg.event),
      style: {
        fontFamily: FONT,
        fontSize: 11,
        fontWeight: '900',
        fill: TEXT_BLACK,
        letterSpacing: 0,
        stroke: { color: TEXT_WHITE, width: 2 },
      },
    });

    this.height = Math.max(MIN_CARD_HEIGHT, Math.ceil(content.height + CONTENT_V_PADDING));
    const plate = new TextilePlate(width, this.height, palette, userAccent, seed, theme);
    const avatar = new PixelAvatar(texture, userSeed, palette, userAccent, theme, msg.avatarUrl ?? null);
    const companion = new PixelCompanion(texture, palette, userAccent, userSeed ^ seed);

    name.x = TEXT_X;
    name.y = 16;
    tag.x = Math.max(TEXT_X, avatarX - tag.width - 12);
    tag.y = 20;
    content.x = TEXT_X;
    content.y = 43;
    avatar.view.x = avatarX;
    avatar.view.y = Math.round((this.height - AVATAR_SIZE) / 2);
    companion.view.x = COMPANION_X;
    companion.view.y = Math.max(0, Math.round((this.height - COMPANION_HEIGHT) / 2));
    this.companion = companion.view;
    this.companionBaseY = companion.view.y;
    this.avatar = avatar;

    this.view.addChild(plate.view, this.fx, companion.view, name, tag, content, avatar.view, this.noise);
  }

  setTarget(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
    if (!this.positioned) {
      this.view.x = x;
      this.view.y = y + 16;
      this.positioned = true;
    }
  }

  update(delta: number): boolean {
    this.age += delta;
    const enter = clamp(this.age / ENTER_FRAMES, 0, 1);
    const leave = this.age > this.lifetime - LEAVE_FRAMES
      ? clamp((this.lifetime - this.age) / LEAVE_FRAMES, 0, 1)
      : 1;
    const ease = 1 - Math.pow(1 - enter, 3);
    const shimmer = Math.sin((this.age + this.seed % 53) * 0.22) * 0.04;
    const glitch = Math.max(1 - enter, 1 - leave);
    const jitter = snap((Math.sin(this.age * 3.8 + this.seed) + Math.cos(this.age * 1.7)) * glitch * PX, PX);
    const hoverX = snap(Math.sin((this.age + this.seed % 101) * 0.032) * PX, PX);
    const hoverY = snap(Math.sin((this.age + this.seed % 89) * 0.045) * PX * 1.5, PX);

    this.view.x = approach(this.view.x, this.targetX + hoverX + jitter, 0.22, delta);
    this.view.y = approach(this.view.y, this.targetY + hoverY, 0.24, delta);
    this.view.alpha = ease * leave * (0.94 + shimmer);
    this.view.scale.x = 1 + glitch * 0.012 + Math.sin(this.age * 0.035 + this.seed) * 0.003;
    this.view.scale.y = 1 - glitch * 0.008 + Math.cos(this.age * 0.031 + this.seed) * 0.003;
    this.companion.y = this.companionBaseY + snap(Math.sin((this.age + this.seed % 37) * 0.12) * 2, PX);
    this.companion.x = COMPANION_X + snap(Math.sin((this.age + this.seed % 71) * 0.07) * 1.5, PX);
    this.drawEffects(enter, leave);
    this.drawNoise(glitch);

    return this.age >= this.lifetime;
  }

  destroy(): void {
    this.view.destroy({ children: true });
    this.avatar.destroy();
  }

  private makeContent(msg: VisualEventMsg, palette: Palette, wrap: number): PIXI.Container {
    return layoutMessageParts(textParts(msg), {
      wrap,
      textStyle: {
        fontFamily: FONT,
        fontSize: 17,
        fontWeight: '900',
        fill: TEXT_WHITE,
        lineHeight: 24,
        letterSpacing: 0,
        stroke: { color: TEXT_BLACK, width: 3 },
        dropShadow: {
          color: 0x000000,
          alpha: 0.42,
          distance: 2,
          blur: 0,
        },
      },
      imageSize: 24,
      gap: 4,
      lineHeight: 24,
      imageInset: 4,
      imageOffset: 2,
      makeImageBacking: (size) => new PIXI.Graphics()
        .rect(0, 0, size, size).fill(fillStyle(palette.night, 0.70))
        .rect(PX, PX, size - PX * 2, size - PX * 2).stroke({ color: palette.gold, width: 2, alpha: 0.78 }),
      onImageLoaded: (sprite) => {
        // The display is a Sprite or AnimatedSprite; Container's type lacks roundPixels.
        (sprite as PIXI.Container & { roundPixels?: boolean }).roundPixels = true;
      },
      fallbackText: (part) => part.name?.trim() || '?',
      fallbackTextStyle: (part) => ({
        fontFamily: FONT,
        fontSize: part.name && part.name.length <= 2 ? 18 : 10,
        fontWeight: '900',
        fill: 0xffffff,
        letterSpacing: 0,
      }),
      emptyText: messageText(msg),
    });
  }

  private drawNoise(amount: number): void {
    this.noise.clear();
    if (amount < 0.04) return;
    const rng = seedRng(this.seed ^ Math.floor(this.age * 19));
    for (let i = 0; i < 8 + amount * 12; i++) {
      const y = snap(rng() * this.height);
      const x = snap(rng() * this.width);
      const w = TILE * (1 + Math.floor(rng() * 6));
      this.noise.rect(x, y, w, PX).fill(fillStyle(rng() > 0.5 ? 0xffffff : 0x000000, 0.12 + amount * 0.18));
    }
  }

  private drawEffects(enter: number, leave: number): void {
    this.fx.clear();
    const rng = seedRng(this.seed ^ 0xeffec7);
    this.drawSparkles(rng, enter, leave);
    this.drawSparks(rng, enter, leave);
    this.drawSplashes(rng, enter);
    this.drawBleeding(rng, enter, leave);
    this.drawEvaporation(rng, leave);
  }

  private drawSparkles(rng: () => number, enter: number, leave: number): void {
    const count = 12;
    for (let i = 0; i < count; i++) {
      const edge = rng();
      const x = edge < 0.5 ? rng() * this.width : (rng() > 0.5 ? -PX * 2 : this.width + PX);
      const y = edge < 0.5 ? (rng() > 0.5 ? -PX : this.height + PX) : rng() * this.height;
      const pulse = Math.max(0, Math.sin(this.age * 0.12 + i * 1.7 + this.seed));
      const alpha = pulse * 0.82 * enter * leave;
      if (alpha < 0.08) continue;
      const color = this.fxColors[i % this.fxColors.length];
      this.fx.rect(snap(x), snap(y), PX, PX * 3).fill(fillStyle(color, alpha));
      this.fx.rect(snap(x - PX), snap(y + PX), PX * 3, PX).fill(fillStyle(color, alpha));
    }
  }

  private drawSparks(rng: () => number, enter: number, leave: number): void {
    for (let i = 0; i < 14; i++) {
      const phase = (this.age * (0.018 + rng() * 0.018) + rng() * 80) % 1;
      const side = rng() > 0.5 ? 1 : -1;
      const originX = side > 0 ? this.width - PX * 4 : PX * 4;
      const originY = this.height * (0.18 + rng() * 0.64);
      const x = originX + side * phase * (PX * (8 + rng() * 13));
      const y = originY - phase * (PX * (3 + rng() * 11)) + Math.sin(phase * Math.PI * 2) * PX;
      const alpha = (1 - phase) * enter * leave * 0.72;
      const color = this.fxColors[(i + 2) % this.fxColors.length];
      this.fx.rect(snap(x), snap(y), PX * (rng() > 0.72 ? 2 : 1), PX).fill(fillStyle(color, alpha));
    }
  }

  private drawSplashes(rng: () => number, enter: number): void {
    const splash = clamp(1 - this.age / 54, 0, 1) * enter;
    if (splash <= 0.02) return;
    for (let cluster = 0; cluster < 4; cluster++) {
      const cx = cluster % 2 === 0 ? PX * (6 + rng() * 12) : this.width - PX * (6 + rng() * 12);
      const cy = this.height * (0.22 + rng() * 0.58);
      const color = this.fxColors[(cluster + 3) % this.fxColors.length];
      for (let i = 0; i < 8; i++) {
        const angle = rng() * Math.PI * 2;
        const dist = (1 - splash) * PX * (6 + rng() * 14);
        this.fx.rect(
          snap(cx + Math.cos(angle) * dist),
          snap(cy + Math.sin(angle) * dist),
          PX * (rng() > 0.62 ? 2 : 1),
          PX * (rng() > 0.78 ? 2 : 1),
        ).fill(fillStyle(color, splash * (0.38 + rng() * 0.42)));
      }
    }
  }

  private drawBleeding(rng: () => number, enter: number, leave: number): void {
    const count = 9;
    for (let i = 0; i < count; i++) {
      const x = this.width * (0.08 + (i / Math.max(1, count - 1)) * 0.84) + (rng() - 0.5) * PX * 4;
      const pulse = 0.5 + 0.5 * Math.sin(this.age * (0.025 + rng() * 0.035) + i * 1.9);
      const length = snap(PX * (2 + pulse * 5 + rng() * 3), PX);
      const color = this.fxColors[(i + 1) % this.fxColors.length];
      const alpha = enter * leave * (0.20 + pulse * 0.32);
      this.fx.rect(snap(x), this.height - PX, PX * (rng() > 0.72 ? 2 : 1), length).fill(fillStyle(color, alpha));
      if (pulse > 0.72) this.fx.rect(snap(x), this.height + length + PX, PX, PX).fill(fillStyle(color, alpha * 0.8));
    }
  }

  private drawEvaporation(rng: () => number, leave: number): void {
    const evaporate = Math.max(0.18, 1 - leave);
    for (let i = 0; i < 12; i++) {
      const phase = (this.age * (0.006 + rng() * 0.010) + rng() * 30) % 1;
      const x = this.width * (0.08 + rng() * 0.84) + Math.sin(phase * Math.PI * 2 + i) * PX * 3;
      const y = -PX - phase * PX * (7 + rng() * 13);
      const alpha = (1 - phase) * evaporate * 0.42;
      const color = this.fxColors[(i + 5) % this.fxColors.length];
      this.fx.rect(snap(x), snap(y), PX * (rng() > 0.68 ? 2 : 1), PX).fill(fillStyle(color, alpha));
      if (rng() > 0.64) this.fx.rect(snap(x + PX * 2), snap(y - PX * 2), PX, PX).fill(fillStyle(TEXT_WHITE, alpha * 0.62));
    }
  }
}
