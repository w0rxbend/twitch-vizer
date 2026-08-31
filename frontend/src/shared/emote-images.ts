import * as PIXI from 'pixi.js';
import { GifSource, GifSprite } from 'pixi.js/gif';

import type { EmoteItem, MessagePart } from './events';

export type EmoteImageSource = Pick<
  MessagePart | EmoteItem,
  'url' | 'animatedUrl' | 'staticUrl'
>;

export function animatedImageUrl(source: EmoteImageSource): string {
  return source.animatedUrl || '';
}

export function staticImageUrl(source: EmoteImageSource): string {
  return source.staticUrl || source.url || '';
}

export function fitDisplayObject(view: PIXI.Container, size: number): void {
  const maxSide = Math.max(view.width, view.height, 1);
  const scale = size / maxSide;
  view.scale.set(scale);
  view.x = Math.round((size - view.width) / 2);
  view.y = Math.round((size - view.height) / 2);
}

async function loadAnimatedEmote(url: string): Promise<GifSprite> {
  const response = await fetch(url, { mode: 'cors', cache: 'force-cache' });
  if (!response.ok) {
    throw new Error(`Animated emote request failed: ${response.status}`);
  }
  const source = GifSource.from(await response.arrayBuffer());
  return new GifSprite({ source, autoPlay: true, loop: true });
}

async function loadStaticEmote(url: string): Promise<PIXI.Sprite> {
  const texture = await PIXI.Assets.load<PIXI.Texture>({ src: url, parser: 'texture' });
  return new PIXI.Sprite(texture);
}

export async function loadEmoteDisplay(source: EmoteImageSource): Promise<PIXI.Container> {
  const animatedUrl = animatedImageUrl(source);
  const fallbackUrl = staticImageUrl(source);

  if (animatedUrl) {
    try {
      return await loadAnimatedEmote(animatedUrl);
    } catch (error) {
      // Animated load failed; fall through to the static fallback below.
      if (!fallbackUrl) throw error;
    }
  }

  if (!fallbackUrl) {
    throw new Error('No emote URL available');
  }
  return loadStaticEmote(fallbackUrl);
}
