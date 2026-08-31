import * as PIXI from 'pixi.js';

import {
  bootstrapOverlay,
  clamp,
  flattenPartsToText,
  formatEventText,
  hashSeed,
  OverlayEventSocket,
  renderParts as renderMessageParts,
  seedRng,
} from '../../shared/overlay';
import type { VisualEventMsg } from '../../shared/overlay';
import { createOverlayApp } from '../../shared/pixi';
import { EmojiStickerChip } from './sticker';
import { MIN_TONE_CONFIDENCE, ToneClassifier } from './tone';

const CARD_GAP = 18;
const MAX_CARDS = 8;

// One sample per tone the classifier can produce, plus a few redemptions, so a
// single test key exercises the whole face set without a backend.
const TEST_EVENTS: Pick<VisualEventMsg, 'event' | 'text' | 'data'>[] = [
  { event: 'chat_message', text: 'Hello there!' },
  { event: 'chat_message', text: 'Good to see you' },
  { event: 'chat_message', text: 'I miss you' },
  { event: 'chat_message', text: 'Really?' },
  { event: 'chat_message', text: "I'm tired" },
  { event: 'chat_message', text: 'Oops, my bad' },
  { event: 'chat_message', text: "That's hilarious!" },
  { event: 'chat_message', text: 'Awesome!' },
  { event: 'chat_message', text: 'Just kidding' },
  { event: 'chat_message', text: "I'm so mad!" },
  { event: 'chat_message', text: 'Whew, close one' },
  { event: 'chat_message', text: 'Feeling cool' },
  { event: 'chat_message', text: 'So lovely' },
  { event: 'chat_message', text: 'Yikes!' },
  { event: 'chat_message', text: "I'm out" },
  { event: 'chat_message', text: 'Not impressed' },
  { event: 'chat_message', text: 'You got it' },
  { event: 'chat_message', text: 'Good night' },
  { event: 'chat_message', text: 'Whoa!' },
  { event: 'chat_message', text: 'Have a nice day' },
  { event: 'chat_message', text: "Can't wait!" },
  { event: 'chat_message', text: 'Oh no!' },
  { event: 'chat_message', text: 'Feeling down' },
  { event: 'chat_message', text: 'See you soon' },
  { event: 'redemption', data: { reward: 'Hydrate!', cost: 250 } },
  { event: 'redemption', data: { reward: 'Pick an emote', cost: 500, input: 'the happy one please' } },
  { event: 'redemption', data: { reward: 'Song request', cost: 1000, input: 'daft punk - around the world' } },
];

function messageText(msg: VisualEventMsg): string {
  return formatEventText(msg, 'sent a sticker');
}

function visibleText(msg: VisualEventMsg): string {
  return flattenPartsToText(renderMessageParts(msg, messageText(msg))) || messageText(msg);
}

class EmojiChatOverlay {
  private app: PIXI.Application | null = null;
  private readonly root = new PIXI.Container();
  private readonly classifier = new ToneClassifier();
  private readonly cards: EmojiStickerChip[] = [];
  private serial = 0;
  private readonly eventSocket = new OverlayEventSocket({
    label: 'EmojiChatOverlay',
    onEvent: (msg) => this.spawn(msg),
  });

  async init(): Promise<void> {
    const solidPreview = new URLSearchParams(location.search).get('solid') === '1';
    const app = await createOverlayApp({
      background: 0xf8f8f4,
      backgroundAlpha: solidPreview ? 1 : 0,
      antialias: true,
    });

    this.app = app;
    app.stage.addChild(this.root);
    this.seedPreview();
    window.addEventListener('resize', () => this.layoutCards());
    app.ticker.add(({ deltaTime }) => this.tick(deltaTime));
  }

  connectWebSocket(): void {
    this.eventSocket.connect();
  }

  spawn(msg: VisualEventMsg): void {
    if (!this.app) return;
    const text = visibleText(msg);
    const fastTone = this.classifier.classifyFast(text);
    const seed = this.nextSeed(msg, text);
    const card = new EmojiStickerChip({
      text,
      sender: msg.username,
      expression: fastTone.expression,
    }, seed);

    this.cards.unshift(card);
    this.root.addChild(card.view);
    while (this.cards.length > MAX_CARDS) {
      this.cards.pop()?.destroy();
    }
    this.layoutCards();

    void this.classifier.classify(text).then((tone) => {
      this.classifier.logDecision(text, tone);
      // A disagreement is worth showing even at lower confidence: the fast pass
      // is keyword-only, so a different expression means the model saw context
      // the dictionary could not.
      const overridesFastTone = tone.confidence >= MIN_TONE_CONFIDENCE
        && (tone.confidence >= fastTone.confidence || tone.expression !== fastTone.expression);
      if (overridesFastTone) card.applyTone(tone);
    });
  }

  private tick(delta: number): void {
    for (let i = this.cards.length - 1; i >= 0; i--) {
      if (this.cards[i].update(delta)) {
        this.cards[i].destroy();
        this.cards.splice(i, 1);
        this.layoutCards();
      }
    }
  }

  private layoutCards(): void {
    if (!this.app) return;
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    const margin = screenW < 720 ? 14 : 34;
    let y = screenH - margin;
    this.cards.forEach((card, index) => {
      y -= card.height;
      const range = Math.max(0, screenW - card.width - margin * 2);
      const center = (screenW - card.width) / 2;
      const rng = seedRng(card.layoutSeed ^ 0xfacefeed);
      const drift = range > 0 ? (rng() - 0.5) * Math.min(range, 220) : 0;
      const stackDrift = Math.sin(index * 1.7 + card.layoutSeed) * Math.min(34, range * 0.14);
      const x = clamp(center + drift + stackDrift, margin, Math.max(margin, screenW - card.width - margin));
      card.setTarget(Math.round(x), Math.round(y));
      y -= CARD_GAP;
    });
  }

  private nextSeed(msg: VisualEventMsg, text: string): number {
    this.serial += 1;
    return hashSeed([
      'emoji-chat',
      msg.username,
      msg.event,
      text,
      msg.seed ?? '',
      this.serial,
      performance.now().toFixed(3),
    ].join(':'));
  }

  private seedPreview(): void {
    const params = new URLSearchParams(location.search);
    if (params.get('preview') === '0') return;
    this.spawn({ event: 'chat_message', username: 'worxbend', text: 'Welcome!', seed: hashSeed('welcome:happy') });
  }
}

const overlay = new EmojiChatOverlay();
let testEventIndex = 0;
bootstrapOverlay(overlay, {
  label: 'EmojiChatOverlay',
  onTestKey: () => {
    overlay.spawn({
      ...TEST_EVENTS[testEventIndex++ % TEST_EVENTS.length],
      username: 'local_preview',
      seed: Math.floor(Math.random() * 0xffffffff),
    });
  },
});
