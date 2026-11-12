/*
 * Luckgram Web (luckgram-specs#137, W1): no "Telegram Web" / "WebK" in the interface.
 *
 * Strings come from two places — the bundled English ones (src/lang.ts) and the language pack
 * Telegram's server sends, which wins and cannot be edited here — so the product name is replaced
 * as a pack is applied. "Telegram" alone (the service, the account) is left as it is.
 *
 * No imports: this sits under the language pack, which every chunk loads.
 */

const NAME = 'Luckgram';

const REPLACEMENTS: [RegExp, string][] = [
  [/Telegram\s*Web\s*[KAZ]\b/g, NAME],
  [/Telegram\s*Web\b/g, NAME],
  [/\bWeb\s?[KA]\b(?=\s+(?:has|was|is|已|版))/g, NAME],
  [/\bWebK\b/g, NAME],
  [/Telegram\s*网页版/g, NAME + ' 网页版'],
  [/Telegram\s*網頁版/g, NAME + ' 網頁版']
];

export function luckgramBrandText(text: string): string {
  if(!text || (text.indexOf('Web') === -1 && text.indexOf('网页版') === -1 && text.indexOf('網頁版') === -1)) {
    return text;
  }

  for(const [regExp, replacement] of REPLACEMENTS) {
    text = text.replace(regExp, replacement);
  }

  return text;
}

const VALUE_KEYS = ['value', 'zero_value', 'one_value', 'two_value', 'few_value', 'many_value', 'other_value'];

/** A language pack string (plain or pluralized) with the product name replaced; the same object. */
export function luckgramBrandString<T extends object>(string: T): T {
  for(const key of VALUE_KEYS) {
    const value = (string as any)[key];
    if(typeof(value) === 'string') {
      const branded = luckgramBrandText(value);
      if(branded !== value) (string as any)[key] = branded;
    }
  }

  return string;
}
