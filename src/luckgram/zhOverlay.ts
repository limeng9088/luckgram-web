/*
 * Luckgram Web (luckgram-specs#180): Chinese for the strings Telegram's Chinese pack lacks
 * (zhStrings.ts), put under a language pack as it is applied (lib/langPack.ts).
 *
 * The texts are loaded on demand: the first Chinese pack is applied without them, and once more
 * when they have arrived. No other imports: this sits under the language pack, which every chunk loads.
 */

type Texts = {[key: string]: string | {[form: string]: string}};
type PackString = {_: string, key: string, local?: boolean, [name: string]: any};

let texts: Texts;
let loading: Promise<void>;
let onLoaded: () => void;

/** Simplified Chinese only: Telegram's "zh-hans-raw", or a plain "zh" / "zh-CN". */
export function isLuckgramZhOverlayLang(langCode: string) {
  return /^zh(-(hans|cn)(-|$)|$)/i.test(langCode || '');
}

/**
 * @param whenLoaded called once the texts are there, if they were not: the pack is applied again
 * @returns the texts, when the language is Chinese and they are loaded
 */
export function getLuckgramZhTexts(langCode: string, whenLoaded: () => void, load: () => Promise<{default: Texts}> = () => import('@/luckgram/zhStrings')): Texts | undefined {
  if(!isLuckgramZhOverlayLang(langCode)) {
    onLoaded = undefined;
    return;
  }

  if(texts) return texts;

  // * the latest pack is the one to apply again
  onLoaded = whenLoaded;
  loading ||= load().then((module) => {
    texts = module.default;
    const callback = onLoaded;
    onLoaded = undefined;
    callback?.();
  }, (err) => {
    loading = undefined; // * asked again with the next pack
    console.warn('[luckgram] Chinese texts were not loaded', (err as Error)?.message);
  });
}

/**
 * The string to show for one of the pack: Luckgram's Chinese for a bundled English string (`local`),
 * otherwise the string itself. The server's strings are never replaced.
 */
export function luckgramZhString<T extends PackString>(string: T, zh: Texts | undefined): T {
  const text = zh && string.local ? zh[string.key] : undefined;
  if(text === undefined) return string;
  return (typeof(text) === 'string' ?
    {_: 'langPackString', key: string.key, value: text} :
    {_: 'langPackStringPluralized', key: string.key, ...text}) as any as T;
}

/** For the tests. */
export function resetLuckgramZhTexts() {
  texts = loading = onLoaded = undefined;
}
