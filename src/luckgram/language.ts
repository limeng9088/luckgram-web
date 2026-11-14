/*
 * Luckgram Web (luckgram-specs#137, W1 需求 8): a Chinese browser gets Simplified Chinese without
 * the user switching, the sign-in page included; any other browser stays in English.
 *
 * Only until a language was chosen: the first successful switch (ours, or the user's in Settings)
 * is remembered, and from then on the stored language pack is the user's. Logging the last account
 * out drops that pack: the language it was in is taken up again by the sign-in page.
 */

import {LUCKGRAM_ZH_LANG_CODE} from '@/luckgram/config';
import {LUCKGRAM_LANG_FOLLOWED_KEY as FOLLOWED_KEY, LUCKGRAM_LANG_RESTORE_KEY as RESTORE_KEY, isLuckgramBrowserChinese} from '@/luckgram/text';

type LangPackLike = {lang_code: string};
type I18nLike = {
  getLangPackAndApply: (langCode: string) => Promise<any>,
  getCacheLangPackAndApply: () => Promise<any>,
  getLastRequestedLangCode: () => string
};

async function apply(I18n: I18nLike, langCode: string) {
  await I18n.getLangPackAndApply(langCode);

  // * the sign-in page's "Continue in …" button applies the stored pack again while ours is on its way
  // * (languageChangeButton.tsx); the pack that then arrives is stored but skipped as not the current one.
  // * It is the stored one now, so applying the stored pack once more shows it.
  if(I18n.getLastRequestedLangCode() !== langCode) {
    await I18n.getCacheLangPackAndApply();
  }

  if(I18n.getLastRequestedLangCode() !== langCode) {
    throw new Error('LANG_NOT_APPLIED');
  }
}

/**
 * @returns the promise of the switch when it was started, otherwise undefined and the caller goes
 * on with its own language pack update
 */
export function followBrowserLanguage(langPack: LangPackLike, I18n: I18nLike): Promise<void> | undefined {
  let langCode: string;
  try {
    if(localStorage.getItem(FOLLOWED_KEY)) return;

    // * the bundled pack is English; anything else is a language somebody picked
    if(langPack.lang_code === 'en') {
      const remembered = localStorage.getItem(RESTORE_KEY);
      langCode = LANG_CODE_RE.test(remembered || '') ? remembered : (isLuckgramBrowserChinese() ? LUCKGRAM_ZH_LANG_CODE : undefined);
    }

    if(!langCode) {
      settle();
      return;
    }
  } catch(err) {
    return;
  }

  return apply(I18n, langCode).then(() => {
    try {
      settle();
    } catch(err) {}
  }, (err) => {
    // * asked again by the next start: no connection yet, or the pack could not be loaded
    console.warn('[luckgram] the language pack was not applied', langCode, err);
  });
}

const LANG_CODE_RE = /^[a-z0-9][a-z0-9-]{1,31}$/i;

function settle() {
  localStorage.setItem(FOLLOWED_KEY, '1');
  localStorage.removeItem(RESTORE_KEY);
}

/**
 * The last account is being logged out, and upstream drops the stored language pack with it: the
 * page would come back in the bundled English and, the language being settled, stay so
 * (luckgram-specs#139). The language in use is kept for the next start instead, which takes it up
 * as it once followed the browser. English needs nothing: it is what the page comes back in.
 */
export function rememberLanguageForSignIn(langCode: string, storage: Pick<Storage, 'setItem' | 'removeItem'>) {
  try {
    if(!langCode || langCode === 'en' || !LANG_CODE_RE.test(langCode)) return;
    storage.setItem(RESTORE_KEY, langCode);
    storage.removeItem(FOLLOWED_KEY);
  } catch(err) {}
}

/**
 * The language the sign-in page offers to continue in (languageChangeButton.tsx), or none.
 * Upstream offers the one Telegram suggests for the visitor's country, once, and has no way back:
 * a page that went Chinese — by the browser's language, or by that offer — stayed Chinese, and kept
 * offering Chinese when Telegram's code for it differs from the pack's (luckgram-specs#173).
 * Here the offer is always the other way: English from Chinese, Chinese (or what Telegram
 * suggests) from English, and it comes back after every switch.
 *
 * @param current the language pack in use
 * @param suggested Telegram's `suggested_lang_code`
 */
export function getSignInLanguageOffer(current: string, suggested: string, browserChinese = isLuckgramBrowserChinese()): string | undefined {
  const isChinese = (langCode: string) => /^zh\b/i.test(langCode || '');
  current ||= 'en';

  if(isChinese(current)) return 'en';
  if(current === 'en') {
    if(suggested && suggested !== 'en') return isChinese(suggested) ? LUCKGRAM_ZH_LANG_CODE : suggested;
    return browserChinese ? LUCKGRAM_ZH_LANG_CODE : undefined;
  }

  // * some other language: what Telegram suggests if it is not this one, else English
  return suggested && suggested !== current ? suggested : 'en';
}
