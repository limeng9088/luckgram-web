/*
 * Luckgram Web (luckgram-specs#137, W1 需求 8): a Chinese browser gets Simplified Chinese without
 * the user switching, the sign-in page included; any other browser stays in English.
 *
 * Only until a language was chosen: the first successful switch (ours, or the user's in Settings)
 * is remembered, and from then on the stored language pack is the user's.
 */

import {LUCKGRAM_ZH_LANG_CODE} from '@/luckgram/config';
import {isLuckgramBrowserChinese} from '@/luckgram/text';

const FOLLOWED_KEY = 'lg_lang_followed';

type LangPackLike = {lang_code: string};
type Apply = (langCode: string) => Promise<any>;

/**
 * @returns the promise of the switch when it was started, otherwise undefined and the caller goes
 * on with its own language pack update
 */
export function followBrowserLanguage(langPack: LangPackLike, apply: Apply): Promise<void> | undefined {
  try {
    if(localStorage.getItem(FOLLOWED_KEY)) return;

    // * the bundled pack is English; anything else is a language somebody picked
    if(langPack.lang_code !== 'en' || !isLuckgramBrowserChinese()) {
      localStorage.setItem(FOLLOWED_KEY, '1');
      return;
    }
  } catch(err) {
    return;
  }

  return apply(LUCKGRAM_ZH_LANG_CODE).then(() => {
    try {
      localStorage.setItem(FOLLOWED_KEY, '1');
    } catch(err) {}
  }, (err) => {
    // * asked again by the next start: no connection yet, or the pack could not be loaded
    console.warn('[luckgram] the Chinese language pack was not applied', err);
  });
}
