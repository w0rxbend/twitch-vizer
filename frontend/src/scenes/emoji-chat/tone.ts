export type Expression =
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

export type Tone =
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

export interface ToneResult {
  tone: Tone;
  expression: Expression;
  confidence: number;
  method: 'emoji' | 'dictionary' | 'transformers.js';
}

export const TONE_TO_EXPRESSION: Record<Tone, Expression> = {
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

const KNOWN_TONES = new Set<string>(Object.keys(TONE_TO_EXPRESSION));

function isTone(value: string): value is Tone {
  return KNOWN_TONES.has(value);
}

// Sentiment-bucket models (positive/negative/neutral) map onto representative tones.
const SENTIMENT_TO_TONE: [match: string, tone: Tone][] = [
  ['very negative', 'anger'],
  ['negative', 'sadness'],
  ['very positive', 'excitement'],
  ['positive', 'joy'],
  ['neutral', 'neutral'],
];

const TONE_MODEL = 'maximka608/multilingual-sentiment-analysis-ONNX';

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

// First matching rule wins, so a term must appear in only one rule.
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
    terms: ['kidding', 'just kidding', 'jk', 'teasing', 'жарт', 'жартую', 'прикол', 'рофл', 'пожартував', 'пожартувала'],
  },
  {
    tone: 'embarrassment',
    expression: 'awkward',
    confidence: 0.78,
    terms: ['oops', 'my bad', 'awkward', 'embarrassing', 'вибач', 'сорі', 'перепрошую', 'незручно', 'ой', 'моя помилка', 'мій косяк'],
  },
];

// Below this score a prediction is not trusted to name a tone. The model's own
// output is collapsed to 'neutral' under it, and the scene uses the same bar
// before letting a late ML result replace the fast keyword guess.
export const MIN_TONE_CONFIDENCE = 0.55;

function neutralTone(method: ToneResult['method']): ToneResult {
  return { tone: 'neutral', expression: 'neutral', confidence: MIN_TONE_CONFIDENCE + 0.01, method };
}

export function emojiTone(text: string): ToneResult {
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

export function normalizeDictionaryText(text: string): { lower: string; tokens: Set<string> } {
  const lower = text
    .toLocaleLowerCase('uk-UA')
    .replace(/[’`´]/g, "'")
    .replace(/ё/g, 'е');
  const tokens = new Set(lower.split(/[^\p{L}\p{N}']+/u).filter(Boolean));
  return { lower, tokens };
}

export function termMatches(term: string, lower: string, tokens: Set<string>): boolean {
  const normalized = term.toLocaleLowerCase('uk-UA');
  if (/[\s'-]/.test(normalized)) return lower.includes(normalized);
  return tokens.has(normalized);
}

export function dictionaryTone(text: string): ToneResult {
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

export function localTone(text: string): ToneResult {
  const emoji = emojiTone(text);
  return emoji.expression !== 'neutral' ? emoji : dictionaryTone(text);
}

export function normalizeTone(predictions: unknown): ToneResult | null {
  const list = Array.isArray(predictions) && Array.isArray(predictions[0])
    ? predictions[0] as unknown[]
    : Array.isArray(predictions)
      ? predictions as unknown[]
      : [];
  const best = list
    .map((item) => item as { label?: unknown; score?: unknown })
    .filter((item) => typeof item.label === 'string' && typeof item.score === 'number')
    .sort((a, b) => (b.score as number) - (a.score as number))[0];

  // Unparseable model output: report failure so the caller keeps its local result.
  if (!best) return null;

  if ((best.score as number) < MIN_TONE_CONFIDENCE) {
    return { tone: 'neutral', expression: 'neutral', confidence: best.score as number, method: 'transformers.js' };
  }

  const rawLabel = (best.label as string)
    .toLowerCase()
    .replace(/[_-]/g, ' ')
    .replace(/^label \d+$/, 'neutral');
  const sentiment = SENTIMENT_TO_TONE.find(([match]) => rawLabel.includes(match));
  const label: Tone = sentiment ? sentiment[1] : isTone(rawLabel) ? rawLabel : 'neutral';
  return {
    tone: label,
    expression: TONE_TO_EXPRESSION[label] ?? 'neutral',
    confidence: best.score as number,
    method: 'transformers.js',
  };
}

// Consecutive inference failures tolerated before ML is disabled for the session.
const MAX_INFERENCE_FAILURES = 3;

export class ToneClassifier {
  private classifier: ((text: string) => Promise<unknown>) | null = null;
  private loading: Promise<void> | null = null;
  private disabled = new URLSearchParams(location.search).get('ml') === '0';
  private inferenceFailures = 0;
  readonly debug = new URLSearchParams(location.search).get('debugTone') === '1';

  classifyFast(text: string): ToneResult {
    return localTone(text);
  }

  async classify(text: string): Promise<ToneResult> {
    const local = this.classifyFast(text);
    if (local.expression !== 'neutral') return local;
    if (this.disabled) return local;
    await this.load();
    if (!this.classifier) return local;

    try {
      const result = normalizeTone(await this.classifier(text)) ?? local;
      this.inferenceFailures = 0;
      if (this.debug) console.log('[EmojiChatOverlay] raw classifier result:', { text, ...result });
      return result;
    } catch (error) {
      this.inferenceFailures += 1;
      if (this.inferenceFailures >= MAX_INFERENCE_FAILURES) {
        console.warn('[EmojiChatOverlay] Tone inference failed repeatedly, disabling ML for this session:', error);
        this.disabled = true;
      } else {
        console.warn('[EmojiChatOverlay] Tone inference failed, using fallback:', error);
      }
      return local;
    }
  }

  logDecision(text: string, result: ToneResult): void {
    if (!this.debug) return;
    console.log('[EmojiChatOverlay] tone', {
      mode: result.method,
      tone: result.tone,
      expression: result.expression,
      confidence: Number(result.confidence.toFixed(3)),
      text,
    });
  }

  private async load(): Promise<void> {
    if (this.classifier || this.disabled) return;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      try {
        // Dynamic import keeps the ~900kB transformers chunk out of the initial
        // page load; the dictionary fallback covers messages until it arrives.
        const { env, pipeline } = await import('@huggingface/transformers');
        env.allowRemoteModels = true;
        env.allowLocalModels = false;
        env.remoteHost = 'https://huggingface.co/';
        env.remotePathTemplate = '{model}/resolve/{revision}/';

        const classifier = await pipeline('text-classification', TONE_MODEL, { dtype: 'q8' });
        this.classifier = (text: string) => classifier(text, { top_k: 1 });
      } catch (error) {
        console.warn('[EmojiChatOverlay] Could not load browser tone model, using local emoji/dictionary fallback:', error);
        this.disabled = true;
      }
    })();

    return this.loading;
  }
}
