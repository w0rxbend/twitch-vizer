import * as PIXI from 'pixi.js';

import { fitDisplayObject, loadEmoteDisplay } from './emote-images';
import type { MessagePart } from './events';

export interface MessageLayoutOptions {
  /** Maximum line width in px; a run that does not fit starts a new line. */
  wrap: number;
  textStyle: PIXI.TextStyleOptions;
  /** Square box each inline emote is laid out in. */
  imageSize: number;
  /** Horizontal gap between placed nodes. */
  gap: number;
  lineHeight: number;
  /** Cursor advance for a run of whitespace. */
  spaceWidth?: number;
  /** Drawn behind each inline emote, e.g. a plate or a circle. */
  makeImageBacking?: (size: number) => PIXI.Container;
  /** Shrinks the loaded emote inside its box, so a backing stays visible. */
  imageInset?: number;
  /** Nudge applied to the loaded emote inside its box. */
  imageOffset?: number;
  /** Text shown when an emote fails to load; defaults to a "?" glyph. */
  fallbackText?: (part: MessagePart) => string;
  /**
   * Style of the glyph shown when an emote fails to load. A function is
   * resolved per part, so the style can depend on the fallback text.
   */
  fallbackTextStyle?: PIXI.TextStyleOptions | ((part: MessagePart) => PIXI.TextStyleOptions);
  /** Runs on a loaded emote before it is added to its box. */
  onImageLoaded?: (sprite: PIXI.Container) => void;
  /** Laid out when the parts produce nothing renderable. */
  emptyText?: string;
}

/**
 * Lays message parts out as a wrapped run of word-sized text nodes and inline
 * emote boxes, and returns the container holding them. Emote images load
 * asynchronously into their box, so the container's size is final on return.
 */
export function layoutMessageParts(
  parts: MessagePart[],
  options: MessageLayoutOptions,
): PIXI.Container {
  const {
    wrap,
    textStyle,
    imageSize,
    gap,
    lineHeight,
    spaceWidth = 8,
    imageInset = 2,
    imageOffset = 1,
  } = options;

  const content = new PIXI.Container();
  let x = 0;
  let y = 0;
  let hasContent = false;

  const place = (node: PIXI.Container, width: number, height = lineHeight) => {
    if (x > 0 && x + width > wrap) {
      x = 0;
      y += lineHeight;
    }
    node.x = x;
    node.y = y + Math.max(0, Math.floor((lineHeight - height) / 2));
    content.addChild(node);
    x += width + gap;
    hasContent = true;
  };

  const addText = (text: string) => {
    for (const chunk of text.match(/\S+\s*|\s+/g) ?? []) {
      if (!chunk.trim()) {
        x = Math.min(wrap, x + spaceWidth);
        continue;
      }
      const label = new PIXI.Text({ text: chunk, style: textStyle });
      if (label.width > wrap) label.scale.x = wrap / label.width;
      place(label, Math.min(label.width, wrap), label.height);
    }
  };

  const addImage = (part: MessagePart) => {
    if (!part.url && !part.animatedUrl && !part.staticUrl) return;
    const holder = new PIXI.Container();
    const backing = options.makeImageBacking?.(imageSize);
    if (backing) holder.addChild(backing);
    loadInlineImage(part, holder, imageSize, imageInset, imageOffset, options);
    place(holder, imageSize, imageSize);
  };

  for (const part of parts) {
    if (part.type === 'image') addImage(part);
    else addText(part.text ?? '');
  }

  if (!hasContent && options.emptyText) addText(options.emptyText);
  return content;
}

function loadInlineImage(
  part: MessagePart,
  holder: PIXI.Container,
  size: number,
  inset: number,
  offset: number,
  options: MessageLayoutOptions,
): void {
  loadEmoteDisplay(part)
    .then((sprite) => {
      if (holder.destroyed) return;
      fitDisplayObject(sprite, size - inset);
      sprite.x += offset;
      sprite.y += offset;
      options.onImageLoaded?.(sprite);
      holder.addChild(sprite);
    })
    .catch(() => {
      if (holder.destroyed) return;
      const style = typeof options.fallbackTextStyle === 'function'
        ? options.fallbackTextStyle(part)
        : options.fallbackTextStyle;
      const fallback = new PIXI.Text({ text: options.fallbackText?.(part) ?? '?', style });
      if (fallback.width > size - inset) fallback.scale.x = (size - inset) / fallback.width;
      fallback.x = Math.round((size - fallback.width) / 2);
      fallback.y = Math.round((size - fallback.height) / 2);
      holder.addChild(fallback);
    });
}
