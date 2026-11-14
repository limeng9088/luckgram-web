/*
 * Luckgram Web (luckgram-specs#139, W3): what Luckgram undoes when the last account leaves —
 * 需求「退出全部账号时，Luckgram 的设置和令牌一并清除」— and what it keeps: the language.
 *
 * Upstream says `logging_out` for every account that leaves: logged out in the page, or its session
 * ended from another device (the server's 401 takes the same road). The worker that did the log out
 * counts the accounts still signed in and sends the number along; a tab cannot count them by then,
 * its storage is turned off as the event arrives. Upstream's listener (apiManagerProxy.ts) waits
 * for the promise returned here before it reloads the page.
 *
 * With another account still signed in everything stays: the values are the browser's, shared by
 * the accounts.
 */

import LuckgramSettings from '@/luckgram/core/settings';
import {rememberLanguageForSignIn} from '@/luckgram/language';
import {getLuckgramLangCode} from '@/luckgram/text';

/** Set while the values are to be cleared: a page that went away before it was done finishes at its next start. */
export const LUCKGRAM_CLEAR_PENDING_KEY = 'lg_clear_pending';

type Clearable = {clear: () => Promise<void>, ready?: Promise<void>};
type KeyValue = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function shouldClearOnLogout(accountsLeft: number | undefined) {
  return !(accountsLeft > 0);
}

const getLocalStorage = (): KeyValue => {
  try {
    return localStorage;
  } catch(err) {}
};

async function clear(settings: Clearable, storage: KeyValue) {
  try {
    storage?.setItem(LUCKGRAM_CLEAR_PENDING_KEY, '1');
  } catch(err) {}

  await settings.clear();

  try {
    storage?.removeItem(LUCKGRAM_CLEAR_PENDING_KEY);
  } catch(err) {}
}

/** @returns done when there is nothing left to clear; never rejects */
export function onLuckgramLoggingOut(
  accountsLeft: number | undefined,
  settings: Clearable = LuckgramSettings,
  storage: KeyValue = getLocalStorage(),
  langCode: string = getLuckgramLangCode()
): Promise<void> {
  if(!shouldClearOnLogout(accountsLeft)) return Promise.resolve();

  // * upstream drops the stored language pack with the last account: the sign-in page comes back in the same language
  rememberLanguageForSignIn(langCode, storage);
  return clear(settings, storage).catch((err) => console.warn('[luckgram] log out:', (err as Error)?.message));
}

/** As the page starts: finishes a clearing that the reload cut short. */
export function finishLuckgramLogout(settings: Clearable = LuckgramSettings, storage: KeyValue = getLocalStorage()): Promise<void> {
  try {
    if(!storage?.getItem(LUCKGRAM_CLEAR_PENDING_KEY)) return Promise.resolve();
  } catch(err) {
    return Promise.resolve();
  }

  // * after the stored values were read: read later, they would be back in memory
  return Promise.resolve(settings.ready).then(() => clear(settings, storage))
  .catch((err) => console.warn('[luckgram] log out:', (err as Error)?.message));
}
