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

/*
 * The sign-in screens (luckgram-specs#167). Upstream's say "Sign in to Telegram" on a page that is not
 * Telegram's, which is what a phishing page says: browsers' safe-browsing took the page for one. They
 * name Luckgram here, and say plainly that the account is a Telegram account. Chinese and English are
 * written out; in any other language "Telegram" in the two titles becomes "Luckgram".
 */
const SIGN_IN_TEXTS: {[key: string]: {zh: string, en: string}} = {
  'Login.Title': {zh: '登录 Luckgram', en: 'Sign in to Luckgram'},
  'Login.StartText': {zh: '用你的 Telegram 账号登录。\n请选择国家并输入手机号码。', en: 'Sign in with your Telegram account.\nConfirm your country code and enter your phone number.'},
  'Login.QR.Title': {zh: '扫码登录 Luckgram', en: 'Log in to Luckgram by QR code'},
  'Login.QR.Subtitle': {zh: '用手机上的 Telegram 或 Luckgram 扫码', en: 'Scan with Telegram or Luckgram on your phone'},
  'Login.QR.Help1': {zh: '在手机上打开 Telegram 或 Luckgram', en: 'Open Telegram or Luckgram on your phone'}
};
const SIGN_IN_TITLES = ['Login.Title', 'Login.QR.Title'];

/** The text of a sign-in string for Luckgram, or nothing when the string is not one of them. */
export function luckgramSignInText(key: string, langCode: string, value?: string): string | undefined {
  const texts = SIGN_IN_TEXTS[key];
  if(!texts) return;
  if(/^zh\b/i.test(langCode || '')) return texts.zh;
  if(!langCode || /^en\b/i.test(langCode)) return texts.en;
  if(SIGN_IN_TITLES.includes(key) && value) return value.replace(/Telegram/g, NAME);
}

const VALUE_KEYS = ['value', 'zero_value', 'one_value', 'two_value', 'few_value', 'many_value', 'other_value'];

/**
 * A language pack string (plain or pluralized) with the product name replaced, and the sign-in
 * screens' texts made Luckgram's; the same object.
 */
export function luckgramBrandString<T extends object>(string: T, langCode?: string): T {
  const key = (string as any).key;
  if(typeof(key) === 'string' && typeof((string as any).value) === 'string') {
    const signIn = luckgramSignInText(key, langCode, (string as any).value);
    if(signIn !== undefined) {
      (string as any).value = signIn;
      return string;
    }
  }

  for(const key of VALUE_KEYS) {
    const value = (string as any)[key];
    if(typeof(value) === 'string') {
      const branded = luckgramBrandText(value);
      if(branded !== value) (string as any)[key] = branded;
    }
  }

  return string;
}
