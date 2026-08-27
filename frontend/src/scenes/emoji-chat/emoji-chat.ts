import * as PIXI from 'pixi.js';

import {
  bootstrapOverlay,
  flattenPartsToText,
  formatEventText,
  OverlayEventSocket,
  renderParts as renderMessageParts,
} from '../../shared/overlay';
import type { VisualEventMsg } from '../../shared/overlay';
import { ToneClassifier } from './tone';
import type { Expression } from './tone';
import { clamp, EmojiStickerChip, hashSeed, seedRng } from './sticker';

const CARD_GAP = 18;
const MAX_CARDS = 8;

const CHIPS: { text: string; expression: Expression }[] = [
  { text: 'Hello there!', expression: 'happy' },
  { text: 'Good to see you', expression: 'kiss' },
  { text: 'I miss you', expression: 'cry' },
  { text: 'Really?', expression: 'surprised' },
  { text: "I'm tired", expression: 'sleepy' },
  { text: 'Oops, my bad', expression: 'awkward' },
  { text: "That's hilarious!", expression: 'laugh' },
  { text: 'Awesome!', expression: 'grin' },
  { text: 'Just kidding', expression: 'wink' },
  { text: "I'm so mad!", expression: 'angry' },
  { text: 'Whew, close one', expression: 'relieved' },
  { text: 'Feeling cool', expression: 'cool' },
  { text: 'So lovely', expression: 'lovely' },
  { text: 'Yikes!', expression: 'yikes' },
  { text: "I'm out", expression: 'dead' },
  { text: 'Not impressed', expression: 'unimpressed' },
  { text: 'You got it', expression: 'happy' },
  { text: 'Good night', expression: 'night' },
  { text: 'Whoa!', expression: 'scared' },
  { text: 'Have a nice day', expression: 'grin' },
  { text: "Can't wait!", expression: 'star' },
  { text: 'Oh no!', expression: 'surprised' },
  { text: 'Feeling down', expression: 'down' },
  { text: 'See you soon', expression: 'wink' },
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
    const app = new PIXI.Application();
    await app.init({
      resizeTo: window,
      background: 0xf8f8f4,
      backgroundAlpha: solidPreview ? 1 : 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });

    document.body.appendChild(app.canvas);
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
      if (tone.confidence >= 0.55 && (tone.confidence >= fastTone.confidence || tone.expression !== fastTone.expression)) {
        card.applyTone(tone);
      }
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
bootstrapOverlay(overlay, { label: 'EmojiChatOverlay' });
window.addEventListener('keydown', (evt) => {
  if (evt.key.toLowerCase() !== 'n') return;
  const sample = CHIPS[Math.floor(Math.random() * CHIPS.length)];
  overlay.spawn({
    event: 'chat_message',
    username: 'local_preview',
    text: sample.text,
    seed: Math.floor(Math.random() * 0xffffffff),
  });
});
