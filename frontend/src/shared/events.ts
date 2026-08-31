export type VisualEventName =
  | 'chat_message'
  | 'follow'
  | 'sub'
  | 'cheer'
  | 'raid'
  | 'gift_sub'
  | 'redemption';

export interface EmoteItem {
  name: string;
  url: string;
  /** Canonical animated-image URL, resolved by normalizeEventMsg. */
  animatedUrl?: string;
  /** Canonical static-image URL, resolved by normalizeEventMsg. */
  staticUrl?: string;
}

export interface MessagePart {
  type: 'text' | 'image';
  text?: string;
  name?: string;
  url?: string;
  /** Canonical animated-image URL, resolved by normalizeEventMsg. */
  animatedUrl?: string;
  /** Canonical static-image URL, resolved by normalizeEventMsg. */
  staticUrl?: string;
}

export interface VisualEventMsg {
  event: VisualEventName;
  username: string;
  text?: string;
  color?: string;
  seed?: number;
  /** Canonical avatar URL, resolved by normalizeEventMsg from all wire aliases. */
  avatarUrl?: string | null;
  emotes?: EmoteItem[];
  parts?: MessagePart[];
  data?: {
    bits?: number;
    viewers?: number;
    total?: number;
    tier?: string;
    months?: number;
    reward?: string;
    cost?: number;
    input?: string;
  };
}

/** Snake_case image-URL aliases as they appear on the wire. */
interface RawUrlAliases {
  animated_url?: string;
  static_url?: string;
}

/**
 * Raw wire message as the backend may send it. The backend emits snake_case,
 * but older payloads and hand-written test events may use camelCase or one of
 * several avatar aliases, so parsing stays tolerant here — and only here.
 * Not part of the public API: scenes only ever see the normalized
 * VisualEventMsg that OverlayEventSocket hands them.
 */
export interface RawEventMsg extends Omit<VisualEventMsg, 'emotes' | 'parts'> {
  avatar_url?: string | null;
  profile_image_url?: string | null;
  profileImageUrl?: string | null;
  profile_image?: string | null;
  profileImage?: string | null;
  emotes?: (EmoteItem & RawUrlAliases)[];
  parts?: (MessagePart & RawUrlAliases)[];
}

/**
 * Rewrites a Twitch emote CDN URL to its still-image variant. Only used when
 * the backend omitted static_url, so that scenes and the PIXI loaders always
 * receive a populated staticUrl and never have to know about the CDN.
 */
function deriveStaticUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.hostname === 'static-cdn.jtvnw.net' && url.pathname.includes('/emoticons/v2/')) {
      url.pathname = url.pathname.replace('/animated/', '/static/').replace('/default/', '/static/');
      return url.toString();
    }
  } catch {
    // Not an absolute URL; fall through to the plain string rewrite.
  }
  return rawUrl.replace('/animated/', '/static/').replace('/default/', '/static/');
}

function normalizePart<T extends EmoteItem | MessagePart>(part: T & RawUrlAliases): T {
  const { animated_url, static_url, ...rest } = part;
  const staticUrl = static_url || part.staticUrl;
  return {
    ...(rest as unknown as T),
    animatedUrl: animated_url || part.animatedUrl,
    staticUrl: staticUrl || (part.url ? deriveStaticUrl(part.url) : undefined),
  };
}

/**
 * Collapses every wire-format alias into the canonical camelCase fields
 * (avatarUrl, animatedUrl, staticUrl). OverlayEventSocket applies this to
 * every incoming message, so scenes never need to coalesce aliases.
 */
export function normalizeEventMsg(raw: RawEventMsg): VisualEventMsg {
  const {
    avatar_url,
    profile_image_url,
    profileImageUrl,
    profile_image,
    profileImage,
    ...rest
  } = raw;
  return {
    ...rest,
    avatarUrl:
      avatar_url
      || raw.avatarUrl
      || profile_image_url
      || profileImageUrl
      || profile_image
      || profileImage
      || null,
    emotes: raw.emotes?.map(normalizePart),
    parts: raw.parts?.map(normalizePart),
  };
}

export function formatEventText(msg: VisualEventMsg, followText: string): string {
  switch (msg.event) {
    case 'chat_message':
      return msg.text?.trim() || '...';
    case 'follow':
      return followText;
    case 'sub': {
      const months = msg.data?.months;
      return months ? `subscribed for ${months} months` : 'subscribed';
    }
    case 'gift_sub': {
      const total = msg.data?.total ?? 1;
      return `gifted ${total} subscription${total === 1 ? '' : 's'}`;
    }
    case 'cheer':
      return `cheered ${msg.data?.bits ?? 0} bits`;
    case 'raid':
      return `raided with ${msg.data?.viewers ?? 0} viewers`;
    case 'redemption': {
      const base = `redeemed ${msg.data?.reward ?? 'a reward'} for ${msg.data?.cost ?? 0} points`;
      const input = msg.data?.input?.trim();
      return input ? `${base}: "${input}"` : base;
    }
    default:
      // Unknown events from a newer backend degrade to the raw text or a stub
      // instead of being misreported as some specific event.
      return msg.text?.trim() || '...';
  }
}

export function formatEventLabel(
  event: VisualEventName,
  options: { chatLabel?: string; separator?: string } = {},
): string {
  const chatLabel = options.chatLabel ?? 'CHAT';
  const separator = options.separator ?? ' ';
  return event === 'chat_message' ? chatLabel : event.replace('_', separator).toUpperCase();
}

/** Converts an emote list entry into an image MessagePart, keeping every URL variant. */
export function emoteToPart(emote: EmoteItem): MessagePart {
  return {
    type: 'image',
    name: emote.name,
    url: emote.url,
    animatedUrl: emote.animatedUrl,
    staticUrl: emote.staticUrl,
  };
}

export function renderParts(
  msg: VisualEventMsg,
  fallbackText = formatEventText(msg, 'joined the stream'),
): MessagePart[] {
  const incoming = msg.parts?.filter((part) => part.type === 'text' || part.type === 'image') ?? [];
  if (incoming.length > 0) return incoming;

  const fallback: MessagePart[] = [{ type: 'text', text: fallbackText }];
  for (const emote of msg.emotes ?? []) {
    if (emote.url) fallback.push(emoteToPart(emote));
  }
  return fallback;
}

/** Flattens parts to plain text; image parts render as :name: placeholders. */
export function flattenPartsToText(parts: MessagePart[]): string {
  return parts
    .map((part) => (part.type === 'image' ? `:${part.name ?? 'emote'}:` : part.text ?? ''))
    .join('')
    .trim();
}
