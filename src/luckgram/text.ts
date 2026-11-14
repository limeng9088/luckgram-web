/*
 * Luckgram Web (luckgram-specs#137, W1): Luckgram's own interface texts, Chinese and English.
 * Chinese when the interface is in Chinese, or — before a language pack is there — the browser is.
 */

let appLangCode: string;

/** Set once the first language is settled — followed from the browser, or picked (language.ts). */
export const LUCKGRAM_LANG_FOLLOWED_KEY = 'lg_lang_followed';

function isLanguageSettled() {
  try {
    return !!localStorage.getItem(LUCKGRAM_LANG_FOLLOWED_KEY);
  } catch(err) {
    return false;
  }
}

export function setLuckgramLangCode(langCode: string) {
  appLangCode = langCode;
}

export function isLuckgramBrowserChinese() {
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  return /^zh\b/i.test(languages[0] || '');
}

export function isLuckgramChinese() {
  // * English is also what the bundled pack says before the browser's language was followed: only then
  // * does the browser decide. English that was settled on — "Continue in English" on a Chinese browser — is English
  if(appLangCode && (appLangCode !== 'en' || isLanguageSettled())) return /^zh\b/i.test(appLangCode);
  return isLuckgramBrowserChinese();
}

/**
 * The locale to count plurals by: Telegram's pack codes are not all language tags a browser knows
 * ("zh-hans-raw" is refused, and upstream logs an error before it falls back to "zh").
 */
export function luckgramPluralLocale(langCode: string) {
  return (langCode || 'en').replace(/-raw$/i, '');
}

export function lgText(zh: string, en: string) {
  return isLuckgramChinese() ? zh : en;
}
