import * as PIXI from 'pixi.js';
import { env, pipeline } from '@huggingface/transformers';

import {
  formatEventText,
  OverlayEventSocket,
  renderParts as renderMessageParts,
} from '../../shared/overlay';
import type { MessagePart, VisualEventMsg } from '../../shared/overlay';

type Expression =
  | 'happy'
  | 'sad'
  | 'kiss'
  | 'cry'
  | 'surprised'
  | 'neutral'
  | 'sleepy'
  | 'awkward'
  | 'laugh'
  | 'wink'
  | 'angry'
  | 'relieved'
  | 'cool'
  | 'lovely'
  | 'yikes'
  | 'dead'
  | 'unimpressed'
  | 'grin'
  | 'night'
  | 'star'
  | 'scared'
  | 'down';

type Tone =
  | 'amusement'
  | 'caring'
  | 'confusion'
  | 'curiosity'
  | 'desire'
  | 'joy'
  | 'love'
  | 'optimism'
  | 'pride'
  | 'realization'
  | 'relief'
  | 'sadness'
  | 'disappointment'
  | 'disapproval'
  | 'embarrassment'
  | 'excitement'
  | 'gratitude'
  | 'grief'
  | 'remorse'
  | 'anger'
  | 'fear'
  | 'nervousness'
  | 'surprise'
  | 'neutral'
  | 'approval'
  | 'admiration'
  | 'annoyance'
  | 'disgust';

interface StickerData {
  text: string;
  expression: Expression;
  sender?: string;
  tone?: Tone;
  confidence?: number;
}

interface ToneResult {
  tone: Tone;
  expression: Expression;
  confidence: number;
  method: 'emoji' | 'dictionary' | 'transformers.js';
}

const CHIPS: StickerData[] = [
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

const TONE_TO_EXPRESSION: Record<string, Expression> = {
  joy: 'happy',
  amusement: 'laugh',
  approval: 'happy',
  admiration: 'happy',
  gratitude: 'happy',
  excitement: 'star',
  optimism: 'happy',
  pride: 'happy',
  relief: 'relieved',
  love: 'lovely',
  caring: 'lovely',
  desire: 'star',
  sadness: 'sad',
  disappointment: 'sad',
  disapproval: 'unimpressed',
  grief: 'cry',
  remorse: 'awkward',
  embarrassment: 'awkward',
  anger: 'angry',
  annoyance: 'angry',
  disgust: 'unimpressed',
  fear: 'scared',
  nervousness: 'scared',
  surprise: 'surprised',
  confusion: 'surprised',
  curiosity: 'surprised',
  realization: 'surprised',
  neutral: 'neutral',
};

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
const TAU = Math.PI * 2;
const CARD_GAP = 18;
const CARD_LIFETIME = 26 * 60;
const MAX_CARDS = 8;
const TONE_MODEL = 'maximka608/multilingual-sentiment-analysis-ONNX';

interface TransformersEnv {
  allowRemoteModels?: boolean;
  allowLocalModels?: boolean;
  remoteHost?: string;
  remotePathTemplate?: string;
}

type TextClassificationPipeline = (text: string, options?: Record<string, unknown>) => Promise<unknown>;

function messageText(msg: VisualEventMsg): string {
  return formatEventText(msg, 'sent a sticker');
}

function visibleText(msg: VisualEventMsg): string {
  return renderMessageParts(msg, messageText(msg))
    .map((part: MessagePart) => part.type === 'text' ? part.text ?? '' : part.name ?? '')
    .join('')
    .replace(/\s+/g, ' ')
    .trim() || messageText(msg);
}

function normalizeTone(predictions: unknown): ToneResult | null {
  const list = Array.isArray(predictions) && Array.isArray(predictions[0])
    ? predictions[0] as unknown[]
    : Array.isArray(predictions)
      ? predictions as unknown[]
      : [];
  const best = list
    .map((item) => item as { label?: unknown; score?: unknown })
    .filter((item) => typeof item.label === 'string' && typeof item.score === 'number')
    .sort((a, b) => (b.score as number) - (a.score as number))[0];

  if (!best || (best.score as number) < 0.55) {
    return { tone: 'neutral', expression: 'neutral', confidence: typeof best?.score === 'number' ? best.score : 0, method: 'transformers.js' };
  }

  const rawLabel = (best.label as string)
    .toLowerCase()
    .replace(/[_-]/g, ' ')
    .replace(/^label \d+$/, 'neutral');
  const label = rawLabel.includes('very negative')
    ? 'anger'
    : rawLabel.includes('negative')
      ? 'sadness'
      : rawLabel.includes('very positive')
        ? 'excitement'
        : rawLabel.includes('positive')
          ? 'joy'
          : rawLabel.includes('neutral')
            ? 'neutral'
            : rawLabel as Tone;
  return {
    tone: label,
    expression: TONE_TO_EXPRESSION[label] ?? 'neutral',
    confidence: best.score as number,
    method: 'transformers.js',
  };
}

interface ToneRule {
  tone: Tone;
  expression?: Expression;
  confidence: number;
  terms: string[];
}

const EMOJI_RULES: ToneRule[] = [
  { tone: 'amusement', expression: 'laugh', confidence: 0.98, terms: ['😂', '🤣', '😆', '😹', '😝', '😜'] },
  { tone: 'love', expression: 'lovely', confidence: 0.98, terms: ['😍', '😘', '🥰', '😻', '❤️', '❤', '🫶', '🧡', '💛', '💚', '💙', '💜', '🤍', '🖤', '💖', '💕', '💗', '💓', '💞', '💘'] },
  { tone: 'anger', expression: 'angry', confidence: 0.98, terms: ['😡', '😠', '🤬', '😤', '💢', '👿'] },
  { tone: 'sadness', expression: 'cry', confidence: 0.98, terms: ['😭', '😢', '🥲', '😿'] },
  { tone: 'sadness', expression: 'sad', confidence: 0.96, terms: ['☹️', '☹', '🙁', '😞', '😔', '😟', '🥺', '😕', '😣', '😖', '😫', '😩', '💔'] },
  { tone: 'fear', expression: 'scared', confidence: 0.96, terms: ['😱', '😨', '😰', '😥', '😓', '🫣'] },
  { tone: 'surprise', expression: 'surprised', confidence: 0.96, terms: ['😮', '😯', '😲', '🤯', '😳', '🙀', '🫢', '👀'] },
  { tone: 'disgust', expression: 'unimpressed', confidence: 0.95, terms: ['🤢', '🤮', '😒', '🙄', '😑', '😐', '🫤', '👎'] },
  { tone: 'joy', expression: 'cool', confidence: 0.94, terms: ['😎', '🤙'] },
  { tone: 'neutral', expression: 'sleepy', confidence: 0.94, terms: ['😴', '🥱', '💤'] },
  { tone: 'joy', expression: 'wink', confidence: 0.94, terms: ['😉'] },
  { tone: 'joy', expression: 'happy', confidence: 0.93, terms: ['😀', '😃', '😄', '😁', '😊', '🙂', '☺️', '☺', '🤗', '😺', '😸', '👍', '👌'] },
  { tone: 'excitement', expression: 'star', confidence: 0.93, terms: ['🤩', '🥳', '🎉', '✨', '⭐', '🌟', '🔥'] },
  { tone: 'embarrassment', expression: 'awkward', confidence: 0.91, terms: ['😅', '😬', '🙃'] },
];

const DICTIONARY_RULES: ToneRule[] = [
  {
    tone: 'anger',
    expression: 'angry',
    confidence: 0.88,
    terms: ['mad', 'angry', 'rage', 'furious', 'hate', 'annoyed', 'pissed', 'wtf', 'terrible', 'awful', 'stupid', 'idiot', 'trash', 'злий', 'зла', 'злюсь', 'злюся', 'злість', 'лють', 'лютий', 'люта', 'бісить', 'дратує', 'дратуюсь', 'дратуюся', 'ненавиджу', 'задовбало', 'задовбав', 'дістало', 'розлючений', 'розлючена', 'скажений', 'скажена'],
  },
  {
    tone: 'sadness',
    expression: 'sad',
    confidence: 0.86,
    terms: ['sad', 'miss', 'down', 'lonely', 'sorry', 'bad', 'hurt', 'depressed', 'upset', 'sorrow', 'heartbroken', 'unhappy', 'miserable', 'сумно', 'сумний', 'сумна', 'сумую', 'скучив', 'скучила', 'скучаю', 'погано', 'боляче', 'самотньо', 'журба', 'прикро', 'невесело', 'депресія', 'депресивно', 'розбитий', 'розбита'],
  },
  {
    tone: 'grief',
    expression: 'cry',
    confidence: 0.88,
    terms: ['cry', 'crying', 'tears', 'sob', 'weeping', 'плачу', 'плакати', 'сльози', 'сльоза', 'ридаю', 'ридати', 'плак', 'заплакав', 'заплакала'],
  },
  {
    tone: 'fear',
    expression: 'scared',
    confidence: 0.84,
    terms: ['scared', 'afraid', 'fear', 'yikes', 'terrified', 'panic', 'nervous', 'worried', 'anxious', 'oh no', 'страшно', 'боюсь', 'боюся', 'боїшся', 'лячно', 'жах', 'жахливо', 'паніка', 'панікую', 'тривожно', 'тривога', 'переживаю', 'моторошно'],
  },
  {
    tone: 'surprise',
    expression: 'surprised',
    confidence: 0.83,
    terms: ['wow', 'whoa', 'really', 'omg', 'surprise', 'shocked', 'unexpected', "can't believe", 'no way', 'ого', 'вау', 'нічого собі', 'серйозно', 'шок', 'шокований', 'шокована', 'не вірю', 'офігів', 'офігіла', 'капец', 'неочікувано'],
  },
  {
    tone: 'amusement',
    expression: 'laugh',
    confidence: 0.87,
    terms: ['haha', 'ahah', 'hehe', 'lol', 'lmao', 'rofl', 'hilarious', 'funny', 'joke', 'смішно', 'ахаха', 'хаха', 'хехе', 'ор', 'ору', 'ржу', 'угар', 'жиза', 'сміх', 'сміюсь', 'сміюся'],
  },
  {
    tone: 'joy',
    expression: 'happy',
    confidence: 0.84,
    terms: ['happy', 'awesome', 'great', 'nice', 'good', 'hello', 'yay', 'glad', 'wonderful', 'perfect', 'радість', 'радію', 'щасливий', 'щаслива', 'клас', 'супер', 'топ', 'добре', 'гарно', 'чудово', 'прекрасно', 'привіт', 'ура', 'кайф'],
  },
  {
    tone: 'love',
    expression: 'lovely',
    confidence: 0.88,
    terms: ['love', 'lovely', 'cute', 'sweet', 'adorable', 'beautiful', 'люблю', 'кохаю', 'милий', 'мила', 'милота', 'серденько', 'серце', 'обіймаю', 'обійми', 'гарнюня'],
  },
  {
    tone: 'approval',
    expression: 'happy',
    confidence: 0.78,
    terms: ['yes', 'ok', 'okay', 'sure', 'got it', 'thanks', 'thank you', 'agree', 'yep', 'так', 'ок', 'окей', 'гаразд', 'дякую', 'спасибі', 'згоден', 'згодна', 'домовились', 'підтримую', 'плюсую'],
  },
  {
    tone: 'disgust',
    expression: 'unimpressed',
    confidence: 0.82,
    terms: ['disgust', 'gross', 'cringe', 'meh', 'boring', 'not impressed', 'ew', 'фу', 'бридко', 'гидко', 'крінж', 'нудно', 'байдуже', 'таке собі', 'мерзенно', 'не вражає'],
  },
  {
    tone: 'neutral',
    expression: 'sleepy',
    confidence: 0.80,
    terms: ['sleep', 'sleepy', 'tired', 'exhausted', 'good night', 'night', 'спати', 'сон', 'сплю', 'добраніч', 'ніч', 'втомився', 'втомилась', 'втома', 'сонний', 'сонна', 'виснажений', 'виснажена'],
  },
  {
    tone: 'joy',
    expression: 'cool',
    confidence: 0.80,
    terms: ['cool', 'chill', 'swag', 'based', 'круто', 'чил', 'чилю', 'стильно', 'імба'],
  },
  {
    tone: 'amusement',
    expression: 'wink',
    confidence: 0.78,
    terms: ['kidding', 'joke', 'just kidding', 'jk', 'teasing', 'жарт', 'жартую', 'прикол', 'рофл', 'пожартував', 'пожартувала'],
  },
  {
    tone: 'embarrassment',
    expression: 'awkward',
    confidence: 0.78,
    terms: ['oops', 'my bad', 'awkward', 'embarrassing', 'sorry', 'вибач', 'сорі', 'перепрошую', 'незручно', 'ой', 'моя помилка', 'мій косяк'],
  },
];

function neutralTone(method: ToneResult['method']): ToneResult {
  return { tone: 'neutral', expression: 'neutral', confidence: 0.56, method };
}

function emojiTone(text: string): ToneResult {
  for (const rule of EMOJI_RULES) {
    if (rule.terms.some((emoji) => text.includes(emoji))) {
      return {
        tone: rule.tone,
        expression: rule.expression ?? TONE_TO_EXPRESSION[rule.tone] ?? 'neutral',
        confidence: rule.confidence,
        method: 'emoji',
      };
    }
  }
  return neutralTone('emoji');
}

function normalizeDictionaryText(text: string): { lower: string; tokens: Set<string> } {
  const lower = text
    .toLocaleLowerCase('uk-UA')
    .replace(/[’`´]/g, "'")
    .replace(/ё/g, 'е');
  const tokens = new Set(lower.split(/[^\p{L}\p{N}']+/u).filter(Boolean));
  return { lower, tokens };
}

function termMatches(term: string, lower: string, tokens: Set<string>): boolean {
  const normalized = term.toLocaleLowerCase('uk-UA');
  if (/[\s'-]/.test(normalized)) return lower.includes(normalized);
  return tokens.has(normalized);
}

function dictionaryTone(text: string): ToneResult {
  const { lower, tokens } = normalizeDictionaryText(text);
  for (const rule of DICTIONARY_RULES) {
    if (rule.terms.some((term) => termMatches(term, lower, tokens))) {
      return {
        tone: rule.tone,
        expression: rule.expression ?? TONE_TO_EXPRESSION[rule.tone] ?? 'neutral',
        confidence: rule.confidence,
        method: 'dictionary',
      };
    }
  }
  return neutralTone('dictionary');
}

function localTone(text: string): ToneResult {
  const emoji = emojiTone(text);
  if (emoji.expression !== 'neutral') return emoji;

  const dictionary = dictionaryTone(text);
  if (dictionary.expression !== 'neutral') return dictionary;

  return dictionary;
}

function keywordTone(text: string): ToneResult {
  return localTone(text);
}

function printToneDecision(text: string, result: ToneResult): void {
  console.log('[EmojiChatOverlay] tone', {
    mode: result.method,
    tone: result.tone,
    expression: result.expression,
    confidence: Number(result.confidence.toFixed(3)),
    text,
  });
}

class ToneClassifier {
  private classifier: ((text: string) => Promise<unknown>) | null = null;
  private loading: Promise<void> | null = null;
  private disabled = new URLSearchParams(location.search).get('ml') === '0';
  private readonly debug = new URLSearchParams(location.search).get('debugTone') === '1';

  classifyFast(text: string): ToneResult {
    return keywordTone(text);
  }

  async classify(text: string): Promise<ToneResult> {
    const local = this.classifyFast(text);
    if (local.expression !== 'neutral') return local;
    if (this.disabled) return local;
    await this.load();
    if (!this.classifier) return local;

    try {
      const result = normalizeTone(await this.classifier(text)) ?? local;
      if (this.debug) console.log('[EmojiChatOverlay] raw classifier result:', { text, ...result });
      return result;
    } catch (error) {
      console.warn('[EmojiChatOverlay] Tone inference failed, using fallback:', error);
      this.disabled = true;
      return local;
    }
  }

  private async load(): Promise<void> {
    if (this.classifier || this.disabled) return;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      try {
        const transformersEnv = env as unknown as TransformersEnv;
        transformersEnv.allowRemoteModels = true;
        transformersEnv.allowLocalModels = false;
        transformersEnv.remoteHost = 'https://huggingface.co/';
        transformersEnv.remotePathTemplate = '{model}/resolve/{revision}/';

        const classifier = await (pipeline as unknown as (
          task: 'text-classification',
          model: string,
          options?: Record<string, unknown>,
        ) => Promise<TextClassificationPipeline>)(
          'text-classification',
          TONE_MODEL,
          { dtype: 'q8' },
        );
        this.classifier = (text: string) => classifier(text, { top_k: 1 });
      } catch (error) {
        console.warn('[EmojiChatOverlay] Could not load browser tone model, using local emoji/dictionary fallback:', error);
        this.disabled = true;
      }
    })();

    return this.loading;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seedRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    return ((state >>> 0) / 0x100000000);
  };
}

function mixColor(a: number, b: number, amount: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const t = clamp(amount, 0, 1);
  return (
    (Math.round(ar + (br - ar) * t) << 16)
    | (Math.round(ag + (bg - ag) * t) << 8)
    | Math.round(ab + (bb - ab) * t)
  );
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

class EmojiStickerChip {
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
    this.data = {
      ...this.data,
      tone: result.tone,
      expression: result.expression,
      confidence: result.confidence,
    };
    this.faceTime = 0;
    this.redraw();
  }

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
    this.shine.ellipse(this.width * 0.24, 13, this.width * 0.18, 7, -0.04, 0, TAU).fill(rgba(0xffffff, 0.20));
    this.shine.ellipse(this.width * 0.62, 11, this.width * 0.12, 5, 0.04, 0, TAU).fill(rgba(0xffffff, 0.10));

    this.redrawFaceAnimation();
    this.drawSenderBadge();
  }

  private redrawFaceAnimation(): void {
    this.face.clear();
    this.drawFace(this.face, this.data.expression, this.faceTime);
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

  private drawFace(g: PIXI.Graphics, expression: Expression, time = 0): void {
    const cx = 38;
    const cy = 32;
    const eyeL = 24;
    const eyeR = 48;
    const t = time + (this.seed % 997) * 0.013;
    const bob = Math.sin(t * 0.12) * 2.2;
    const soft = Math.sin(t * 0.08) * 1.4;
    const quick = Math.sin(t * 0.32);
    const shake = Math.round(Math.sin(t * 0.72) * 1.8);
    const tearDrop = (t * 0.65) % 19;
    const pulse = 1 + Math.sin(t * 0.14) * 0.12;
    const blink = Math.sin(t * 0.055) > 0.965 ? 3 : 0;

    switch (expression) {
      case 'happy':
        closedEye(g, eyeL, cy - 11 + bob * 0.25, 1);
        closedEye(g, eyeR, cy - 11 + bob * 0.25, 1);
        g.ellipse(cx, cy + 12 + bob * 0.45, 18, 11 + pulse, 0, 0, Math.PI).fill(BROWN);
        g.ellipse(cx, cy + 13 + bob * 0.45, 13, 6 + pulse * 0.35, 0, 0, Math.PI).fill(TONGUE);
        break;
      case 'kiss':
        g.circle(eyeL, cy - 11 + soft * 0.3, 5 + Math.max(quick, 0) * 0.6).fill(BROWN);
        closedEye(g, eyeR, cy - 12 + soft * 0.3, 1);
        g.moveTo(cx - 1, cy + 4);
        g.quadraticCurveTo(cx + 8, cy + 8, cx - 1, cy + 14);
        g.quadraticCurveTo(cx - 10, cy + 8, cx - 1, cy + 4);
        g.stroke({ color: BROWN, width: 4, cap: 'round' });
        heart(g, 62 + Math.sin(t * 0.1) * 1.8, cy + 11 - bob, 9 * pulse);
        break;
      case 'cry':
        frown(g, eyeL - 10, cy - 15 + soft * 0.3, 18, 7);
        frown(g, eyeR - 8, cy - 15 + soft * 0.3, 18, 7);
        g.circle(eyeL, cy - 4, 4).fill(BROWN);
        g.circle(eyeR, cy - 4, 4).fill(BROWN);
        g.ellipse(cx, cy + 15 + soft * 0.5, 11, 15 + Math.max(quick, 0) * 2, 0, 0, TAU).fill(BROWN);
        g.rect(cx - 5, cy + 17, 10, 8).fill(TONGUE);
        tear(g, eyeL - 8, cy + 8 + tearDrop, 13);
        tear(g, eyeR + 8, cy + 13 + ((tearDrop + 8) % 19), 13);
        break;
      case 'surprised':
      case 'scared':
        g.circle(eyeL + (expression === 'scared' ? shake : 0), cy - 10 + soft * 0.25, 10 + Math.max(quick, 0) * 1.2).fill(0xffffff);
        g.circle(eyeR + (expression === 'scared' ? shake : 0), cy - 10 + soft * 0.25, 10 + Math.max(quick, 0) * 1.2).fill(0xffffff);
        g.circle(eyeL + (expression === 'scared' ? shake : 0), cy - 10 + blink * 0.35, 4).fill(BROWN);
        g.circle(eyeR + (expression === 'scared' ? shake : 0), cy - 10 + blink * 0.35, 4).fill(BROWN);
        g.ellipse(cx + (expression === 'scared' ? shake * 0.4 : 0), cy + 15 + soft * 0.4, expression === 'scared' ? 11 + pulse : 8 + pulse * 0.7, expression === 'scared' ? 16 + pulse * 2 : 10 + pulse, 0, 0, TAU).fill(BROWN);
        if (expression === 'scared') g.rect(cx - 5, cy + 18, 10, 6).fill(TONGUE);
        break;
      case 'sleepy':
      case 'night':
        closedEye(g, eyeL, cy - 9 + soft * 0.3, -1);
        closedEye(g, eyeR, cy - 9 + soft * 0.3, -1);
        g.rect(cx - 15, cy + 12 + soft * 0.45, 30, 4).fill(BROWN);
        if (expression === 'sleepy') tear(g, eyeR + 16 + Math.sin(t * 0.08) * 1.5, cy + 13 + ((tearDrop + 5) % 13), 9);
        else {
          g.circle(cx + 21 + Math.sin(t * 0.08) * 2, cy - 24 - (t * 0.18) % 7, 5).fill(0x2f8bf3);
          g.circle(cx + 30 + Math.sin(t * 0.07 + 1) * 2, cy - 35 - (t * 0.15) % 7, 4).fill(0x2f8bf3);
          g.circle(cx + 39 + Math.sin(t * 0.06 + 2) * 2, cy - 45 - (t * 0.12) % 7, 3).fill(0x2f8bf3);
        }
        break;
      case 'awkward':
        frown(g, eyeL - 10, cy - 12 + soft * 0.4, 18, 7);
        g.circle(eyeL, cy - 3, 5).fill(BROWN);
        g.circle(eyeR, cy - 1, 5).fill(BROWN);
        frown(g, cx - 16, cy + 18 + soft * 0.4, 30, 11);
        tear(g, eyeR + 15, cy - 13 + ((tearDrop + 2) % 15), 8);
        break;
      case 'laugh':
      case 'relieved':
        closedEye(g, eyeL, cy - 10 + bob * 0.3, 1);
        closedEye(g, eyeR, cy - 10 + bob * 0.3, 1);
        g.ellipse(cx, cy + 10 + bob * 0.35, 22, 14 + Math.max(quick, 0) * 2, 0, 0, Math.PI).fill(BROWN);
        g.rect(cx - 18, cy + 8 + bob * 0.35, 36, 6).fill(0xffffff);
        if (expression === 'laugh') {
          tear(g, eyeL - 14, cy + 10 + ((tearDrop + 3) % 12), 8);
          tear(g, eyeR + 14, cy + 10 + ((tearDrop + 9) % 12), 8);
        } else {
          tear(g, eyeR + 15 + Math.sin(t * 0.1) * 1.4, cy - 18 + ((tearDrop + 5) % 10), 8);
        }
        break;
      case 'grin':
        closedEye(g, eyeL, cy - 11 + bob * 0.25, 1);
        closedEye(g, eyeR, cy - 11 + bob * 0.25, 1);
        g.ellipse(cx, cy + 12 + bob * 0.3, 20, 12 + Math.max(quick, 0), 0, 0, Math.PI).fill(BROWN);
        g.rect(cx - 16, cy + 10 + bob * 0.3, 32, 7).fill(0xffffff);
        break;
      case 'wink':
        g.circle(eyeL, cy - 9, 5).fill(BROWN);
        g.moveTo(eyeR - 9, cy - 8 + quick * 0.7).lineTo(eyeR + 9, cy - 8 - quick * 0.7).stroke({ color: BROWN, width: 4, cap: 'round' });
        smile(g, cx - 16, cy + 12 + soft * 0.4, 29, 10 + Math.max(quick, 0));
        break;
      case 'angry':
        g.moveTo(eyeL - 11 + shake, cy - 18).lineTo(eyeL + 8 + shake, cy - 10 + quick).stroke({ color: BROWN, width: 5, cap: 'round' });
        g.moveTo(eyeR + 11 + shake, cy - 18).lineTo(eyeR - 8 + shake, cy - 10 - quick).stroke({ color: BROWN, width: 5, cap: 'round' });
        g.circle(eyeL + shake * 0.4, cy - 5, 5 + Math.max(quick, 0) * 0.5).fill(BROWN);
        g.circle(eyeR + shake * 0.4, cy - 5, 5 + Math.max(-quick, 0) * 0.5).fill(BROWN);
        frown(g, cx - 16 + shake * 0.35, cy + 20 + soft * 0.35, 32, 13 + Math.abs(quick), BROWN, 5);
        break;
      case 'cool':
        g.roundRect(eyeL - 15, cy - 19, 25, 15, 4).fill(0x141414);
        g.roundRect(eyeR - 10, cy - 19, 25, 15, 4).fill(0x141414);
        g.rect(eyeL + 8, cy - 14, 15, 4).fill(0x141414);
        g.rect(eyeL - 13 + (t * 0.18) % 15, cy - 17, 7, 3).fill(rgba(0xffffff, 0.32));
        g.rect(eyeR - 8 + (t * 0.18) % 15, cy - 17, 7, 3).fill(rgba(0xffffff, 0.32));
        smile(g, cx - 16, cy + 15 + soft * 0.3, 32, 9);
        break;
      case 'lovely':
        closedEye(g, eyeL, cy - 10 + bob * 0.25, 1);
        closedEye(g, eyeR, cy - 10 + bob * 0.25, 1);
        smile(g, cx - 14, cy + 8 + bob * 0.2, 28, 8 + pulse * 0.5);
        g.circle(eyeL - 10, cy + 8, 7 + Math.max(quick, 0) * 0.7).fill(rgba(PINK, 0.58));
        g.circle(eyeR + 10, cy + 8, 7 + Math.max(quick, 0) * 0.7).fill(rgba(PINK, 0.58));
        heart(g, eyeR + 22 + Math.sin(t * 0.11) * 1.5, cy - 25 - bob, 8 * pulse);
        heart(g, eyeR + 18 + Math.sin(t * 0.09 + 1) * 1.2, cy + 20 - bob * 0.6, 7 * (1 + Math.sin(t * 0.17 + 2) * 0.12));
        break;
      case 'yikes':
        xEye(g, eyeL, cy - 10);
        xEye(g, eyeR, cy - 10);
        g.roundRect(cx - 10, cy + 7, 20, 15, 5).fill(BROWN);
        g.rect(cx - 7, cy + 16, 14, 16 + Math.max(quick, 0) * 4).fill(TONGUE);
        break;
      case 'dead':
        xEye(g, eyeL + shake * 0.3, cy - 12 + soft * 0.3);
        xEye(g, eyeR + shake * 0.3, cy - 12 - soft * 0.3);
        g.ellipse(cx, cy + 14 + soft * 0.4, 11, 15, 0, 0, TAU).fill(BROWN);
        g.rect(cx - 5, cy + 16 + soft * 0.5, 10, 7 + Math.max(quick, 0) * 2).fill(TONGUE);
        break;
      case 'unimpressed':
        g.rect(eyeL - 10, cy - 13 + soft * 0.2, 19, 5).fill(BROWN);
        g.rect(eyeR - 9, cy - 13 + soft * 0.2, 19, 5).fill(BROWN);
        g.circle(eyeL + Math.sin(t * 0.04) * 2.5, cy - 10, 4).fill(0xffffff);
        g.circle(eyeR + Math.sin(t * 0.04) * 2.5, cy - 10, 4).fill(0xffffff);
        frown(g, cx - 17, cy + 18 + soft * 0.2, 34, 10);
        break;
      case 'star':
        this.star(g, eyeL, cy - 11, 12 * pulse);
        this.star(g, eyeR, cy - 11, 12 * (1 + Math.sin(t * 0.16 + 1.2) * 0.12));
        g.ellipse(cx, cy + 14 + bob * 0.25, 19, 12 + Math.max(quick, 0), 0, 0, Math.PI).fill(BROWN);
        g.rect(cx - 14, cy + 12 + bob * 0.25, 28, 6).fill(0xffffff);
        break;
      case 'sad':
        g.moveTo(eyeL - 10, cy - 15);
        g.quadraticCurveTo(eyeL - 1, cy - 21, eyeL + 9, cy - 14);
        g.stroke({ color: BROWN, width: 4, cap: 'round' });
        g.moveTo(eyeR - 9, cy - 14);
        g.quadraticCurveTo(eyeR + 1, cy - 21, eyeR + 10, cy - 15);
        g.stroke({ color: BROWN, width: 4, cap: 'round' });
        g.ellipse(eyeL, cy - 3 + soft * 0.25, 4, 6, 0, 0, TAU).fill(BROWN);
        g.ellipse(eyeR, cy - 3 + soft * 0.25, 4, 6, 0, 0, TAU).fill(BROWN);
        frown(g, cx - 15, cy + 18 + soft * 0.4, 30, 8 + Math.max(-quick, 0), BROWN, 4);
        tear(g, eyeR + 14, cy + 2 + ((tearDrop + 4) % 14), 7);
        break;
      case 'down':
        g.moveTo(eyeL - 9, cy - 14);
        g.quadraticCurveTo(eyeL - 1, cy - 18, eyeL + 8, cy - 12);
        g.stroke({ color: BROWN, width: 4, cap: 'round' });
        g.moveTo(eyeR - 8, cy - 12);
        g.quadraticCurveTo(eyeR + 1, cy - 18, eyeR + 9, cy - 14);
        g.stroke({ color: BROWN, width: 4, cap: 'round' });
        g.circle(eyeL, cy - 3 + soft * 0.2, 4).fill(BROWN);
        g.circle(eyeR, cy - 3 + soft * 0.2, 4).fill(BROWN);
        frown(g, cx - 16, cy + 18 + soft * 0.4, 32, 10 + Math.max(-quick, 0), BROWN, 4);
        break;
      case 'neutral':
        g.ellipse(eyeL, cy - 9, 5, Math.max(1.5, 5 - blink), 0, 0, TAU).fill(BROWN);
        g.ellipse(eyeR, cy - 9, 5, Math.max(1.5, 5 - blink), 0, 0, TAU).fill(BROWN);
        smile(g, cx - 16, cy + 10 + soft * 0.25, 32, 9 + Math.max(quick, 0) * 0.6, BROWN, 4);
        break;
    }
  }

  private star(g: PIXI.Graphics, x: number, y: number, r: number): void {
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
      tone: fastTone.tone,
      expression: fastTone.expression,
      confidence: fastTone.confidence,
    }, seed);

    this.cards.unshift(card);
    this.root.addChild(card.view);
    while (this.cards.length > MAX_CARDS) {
      this.cards.pop()?.destroy();
    }
    this.layoutCards();

    void this.classifier.classify(text).then((tone) => {
      printToneDecision(text, tone);
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
void overlay.init().then(() => {
  overlay.connectWebSocket();
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
});
