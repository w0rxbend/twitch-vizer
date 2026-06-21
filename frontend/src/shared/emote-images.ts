import * as PIXI from 'pixi.js';
import { GifSource, GifSprite } from 'pixi.js/gif';

import type { EmoteItem, MessagePart } from './overlay';

export type EmoteImageSource = Pick<
  MessagePart | EmoteItem,
  'url' | 'animated_url' | 'animatedUrl' | 'static_url' | 'staticUrl'
>;

export function plainImageUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.hostname === 'static-cdn.jtvnw.net' && url.pathname.includes('/emoticons/v2/')) {
      url.pathname = url.pathname.replace('/animated/', '/static/').replace('/default/', '/static/');
      return url.toString();
    }
  } catch {
    return rawUrl.replace('/animated/', '/static/').replace('/default/', '/static/');
  }
  return rawUrl.replace('/animated/', '/static/').replace('/default/', '/static/');
}

export function animatedImageUrl(source: EmoteImageSource): string {
  return source.animated_url ?? source.animatedUrl ?? '';
}

export function staticImageUrl(source: EmoteImageSource): string {
  return source.static_url ?? source.staticUrl ?? (source.url ? plainImageUrl(source.url) : '');
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
    } catch {
      if (!fallbackUrl) throw new Error('Animated emote failed and no static fallback exists');
    }
  }

  if (!fallbackUrl) {
    throw new Error('No emote URL available');
  }
  return loadStaticEmote(fallbackUrl);
}
