/*
 * Luckgram Web (luckgram-specs#185, W5): the rules of translation that need no browser —
 * the cache's keys and limits, what an error says, which language a draft is translated to.
 * The rules are the phones' (specs/01-translate-out.md). No imports.
 */

export const TRANSLATE_IN = 'translate_in';
export const TRANSLATE_OUT = 'translate_out';
/** LuckgramSettings: the language received messages are translated to; unset = the interface's */
export const KEY_TRANSLATE_TO = 'translate_to';
/** LuckgramSettings: JSON [[peerId, language], …], what each chat's drafts are translated to */
export const KEY_OUT_LANGS = 'translate_out_langs';

/** Telegram gets this long before the Luckgram server is asked. */
export const TELEGRAM_TIMEOUT_MS = 8000;
export const CACHE_MAX_ENTRIES = 2000;
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const OUT_LANGS_MAX = 300;
export const DEFAULT_OUT_LANG = 'en';

export type TranslationEntity = {_: string, offset: number, length: number, [name: string]: any};
export type Translation = {
  text: string,
  /** formatting, when Telegram translated; the Luckgram server answers in plain text */
  entities?: TranslationEntity[],
  from?: string,
  via: 'telegram' | 'luckgram'
};

export type CacheRecord = {t: string, e?: TranslationEntity[], f?: string, v: 't' | 'l', at: number};
export type StateRecord = {l: string, at: number};

// ------------------------------------------------------------------ cache keys

/** cyrb53: a 53-bit hash of the text, enough to tell 2000 messages apart */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for(let i = 0; i < text.length; ++i) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + '.' + text.length.toString(36);
}

/** A translation: by account, target language and the text itself — an edited message is another text. */
export const translationKey = (account: number | string, toLang: string, text: string) => `t:${account}:${toLang}:${hashText(text)}`;
/** That a message is shown translated: by account and message. */
export const stateKey = (account: number | string, peerId: number | string, mid: number | string) => `s:${account}:${peerId}_${mid}`;
/** Everything the `cache` store keeps for an account: translations (t), their states (s), transcriptions (v, W6). */
export const isKeyOfAccount = (key: string, account: number | string) => /^[a-z]:/.test(key) && key.slice(2).startsWith(account + ':');

/**
 * The keys to drop: older than 7 days, and the oldest beyond 2000 — per account and kind.
 * @param records key → the time it was written
 */
export function getKeysToPrune(records: Map<string, number>, now: number, maxEntries = CACHE_MAX_ENTRIES, maxAge = CACHE_MAX_AGE_MS): string[] {
  const drop: string[] = [];
  const groups = new Map<string, [string, number][]>();
  records.forEach((at, key) => {
    if(!(at > 0) || now - at > maxAge || at > now + 60e3) {
      drop.push(key);
      return;
    }

    // * "t:<account>" or "s:<account>"
    const group = key.split(':', 2).join(':');
    let list = groups.get(group);
    if(!list) groups.set(group, list = []);
    list.push([key, at]);
  });

  groups.forEach((list) => {
    if(list.length <= maxEntries) return;
    list.sort((a, b) => b[1] - a[1]);
    for(const [key] of list.slice(maxEntries)) drop.push(key);
  });

  return drop;
}

// ------------------------------------------------------------------ errors

export type TranslateFailure = 'network' | 'quota' | 'too_long' | 'other';

/** What both steps' errors come to. `luckgramCode` is a LuckgramApiError's code, undefined when that step was not taken. */
export function getTranslateFailure(luckgramCode: string | undefined, online: boolean, telegramErrorType?: string): TranslateFailure {
  if(luckgramCode === 'quota_exceeded') return 'quota';
  if(luckgramCode === 'input_too_large' || telegramErrorType === 'INPUT_TEXT_TOO_LONG' || telegramErrorType === 'MSG_TOO_LONG') return 'too_long';
  if(luckgramCode === 'network_error' || !online) return 'network';
  return 'other';
}

/** [中文, English] — the phones' wording */
export function getTranslateFailureText(failure: TranslateFailure): [string, string] {
  switch(failure) {
    case 'network':
      return ['网络不通，请检查网络或代理', 'No connection. Please check your network or proxy'];
    case 'quota':
      return ['今日翻译次数已用完，明天再来', 'You\'ve used up today\'s translations. Come back tomorrow'];
    case 'too_long':
      return ['这段文字太长，无法翻译', 'This text is too long to translate'];
    default:
      return ['翻译失败，请稍后再试', 'Translation failed. Please try again later'];
  }
}

// ------------------------------------------------------------------ languages

/** "zh-hans-raw", "pt-BR" → "zh", "pt": what Telegram's translation and the server take */
export function normalizeLang(langCode: string | undefined): string | undefined {
  const lang = (langCode || '').toLowerCase().split(/[-_]/, 1)[0];
  return /^[a-z]{2,3}$/.test(lang) ? lang : undefined;
}

/** What received messages are translated to: the setting, else the interface's language. */
export function getIncomingTargetLang(setting: string | undefined, interfaceLang: string | undefined): string {
  return normalizeLang(setting) || normalizeLang(interfaceLang) || 'en';
}

/** [peerId, language] pairs, the oldest first — an object's numeric keys would not keep that order. */
export type OutLangs = [string, string][];

export function parseOutLangs(json: string | undefined): OutLangs {
  try {
    const value = json ? JSON.parse(json) : undefined;
    if(!Array.isArray(value)) return [];
    return value.filter((pair) => Array.isArray(pair) && typeof(pair[0]) === 'string' && typeof(pair[1]) === 'string');
  } catch(err) {
    return [];
  }
}

export function getOutLang(langs: OutLangs, peerId: number | string): string | undefined {
  const key = String(peerId);
  return langs.find((pair) => pair[0] === key)?.[1];
}

/** The chat's language is remembered; the newest are kept. */
export function rememberOutLang(langs: OutLangs, peerId: number | string, lang: string, max = OUT_LANGS_MAX): OutLangs {
  const key = String(peerId);
  const rest = langs.filter((pair) => pair[0] !== key);
  return [...rest.slice(Math.max(0, rest.length - (max - 1))), [key, lang]];
}

/**
 * What a draft is translated to: the language remembered for the chat, else the language of the
 * other side's messages, else English.
 */
export function getOutgoingTargetLang(remembered: string | undefined, peerLanguage: string | undefined): string {
  return normalizeLang(remembered) || normalizeLang(peerLanguage) || DEFAULT_OUT_LANG;
}

/**
 * Whether a received message gets the one-tap icon: somebody else's, with text, in a language
 * that is known and not on the do-not-translate list, and not the language it would be translated to.
 */
export function shouldOfferQuickTranslate(options: {
  out: boolean, hasText: boolean, detected: string | undefined, doNotTranslate: string[], target: string
}) {
  const detected = normalizeLang(options.detected);
  if(options.out || !options.hasText || !detected) return false;
  if(detected === options.target) return false;
  return !options.doNotTranslate.map(normalizeLang).includes(detected);
}

/** Whether the sender is the account itself (Saved Messages: such a message has no `out` flag). */
export function isOwnSender(message: {fromId?: any, peerId?: any, fwd_from?: any}, account: number | string) {
  const from = message.fromId ?? message.peerId;
  // * forwarded into Saved Messages from somebody else: theirs
  return String(from) === String(account) && !message.fwd_from;
}

/** Whether formatting would be lost: the original had some, the translation is plain text. */
export function isFormattingLost(original: TranslationEntity[] | undefined, translation: Translation) {
  if(translation.via !== 'luckgram') return false;
  // * mentions, links, hashtags and the like are words of the text itself and survive
  const formatting = /^messageEntity(Bold|Italic|Underline|Strike|Spoiler|Code|Pre|TextUrl|Blockquote|CustomEmoji|MentionName)$/;
  return !!original?.some((entity) => formatting.test(entity._));
}
