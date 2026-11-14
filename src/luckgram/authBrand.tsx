/*
 * Luckgram Web (luckgram-specs#167): the sign-in screens say whose they are.
 *
 * Upstream's sign-in page is Telegram's own, down to the wallpaper; served from another domain it
 * is what a phishing page looks like, and Google Safe Browsing listed Luckgram's hosts as
 * deceptive. Here the page carries Luckgram's name and icon, a background of its own
 * (luckgram.scss), and under the name a line that says what Luckgram is, with a link to its site.
 */

import {createSignal, onCleanup} from 'solid-js';
import rootScope from '@lib/rootScope';
import {lgText} from '@/luckgram/text';

export const LUCKGRAM_SITE = 'https://luckgram.cc';

export function luckgramThirdPartyNotice() {
  return lgText(
    'Luckgram 是使用 Telegram API 的第三方客户端，不是 Telegram 官方应用。',
    'Luckgram is a third-party client that uses the Telegram API. It is not an official Telegram app.'
  );
}

/** Luckgram's icon and name, at the top of the sign-in screens. */
export function LuckgramAuthBrand() {
  return (
    <a class="luckgram-auth-brand" href={LUCKGRAM_SITE} target="_blank" rel="noopener">
      <img class="luckgram-auth-brand-icon" src="assets/img/icon_square_192.png" alt="" width="32" height="32" />
      <span class="luckgram-auth-brand-name">Luckgram</span>
    </a>
  );
}

/** What Luckgram is, under its name: in view without scrolling, whatever the card's height. */
export function LuckgramAuthNotice() {
  // * in the interface's language, also after it is switched on this page (luckgram-specs#173)
  const [language, setLanguage] = createSignal(0);
  const onLanguageApply = () => {
    setLanguage((count) => count + 1);
  };
  rootScope.addEventListener('language_apply', onLanguageApply);
  onCleanup(() => rootScope.removeEventListener('language_apply', onLanguageApply));

  return (
    <p class="luckgram-auth-notice">
      {(language(), luckgramThirdPartyNotice())}{' '}
      <a href={LUCKGRAM_SITE} target="_blank" rel="noopener">{(language(), lgText('了解 Luckgram', 'About Luckgram'))}</a>
    </p>
  );
}
