/*
 * Luckgram Web (luckgram-specs#137, W1): Luckgram's own interface texts, Chinese and English.
 * Chinese when the interface is in Chinese, or — before a language pack is there — the browser is.
 */

let appLangCode: string;

export function setLuckgramLangCode(langCode: string) {
  appLangCode = langCode;
}

export function isLuckgramBrowserChinese() {
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  return /^zh\b/i.test(languages[0] || '');
}

export function isLuckgramChinese() {
  if(appLangCode && appLangCode !== 'en') return /^zh\b/i.test(appLangCode);
  return isLuckgramBrowserChinese();
}

export function lgText(zh: string, en: string) {
  return isLuckgramChinese() ? zh : en;
}
