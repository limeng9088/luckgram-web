/*
 * Luckgram Web (luckgram-specs#185, W5): the translator of this page — the cache in IndexedDB
 * `luckgram`, Telegram's translation through the managers, the Luckgram server's through the AI
 * client. service.ts has the order and the rules.
 */

import rootScope from '@lib/rootScope';
import I18n from '@lib/langPack';
import detectLanguage from '@lib/tinyld/detect';
import LuckgramSettings, {luckgramStorage} from '@/luckgram/core/settings';
import luckgramAI from '@/luckgram/core/instance';
import {lgText} from '@/luckgram/text';
import {TranslationCache} from '@/luckgram/translate/cache';
import {TranslateError, createTranslator} from '@/luckgram/translate/service';
import {KEY_TRANSLATE_TO, getIncomingTargetLang, getTranslateFailureText} from '@/luckgram/translate/logic';

export const translationCache = new TranslationCache(luckgramStorage);
export const getTranslateAccount = () => rootScope.myId as any as number;

export const detectTextLanguage = (text: string): Promise<string | undefined> => {
  return Promise.resolve(text ? detectLanguage(text) : undefined).catch((): undefined => undefined);
};

export const translate = createTranslator({
  account: getTranslateAccount,
  cache: translationCache,
  telegram: (request) => {
    const manager = rootScope.managers.appTranslationsManager;
    if(request.peerId && request.mid) {
      return manager.translateText({peerId: request.peerId as any, mid: request.mid, lang: request.toLang}) as Promise<any>;
    }

    return manager.translateText({
      text: {_: 'textWithEntities', text: request.text, entities: (request.entities || []) as any},
      lang: request.toLang
    }) as Promise<any>;
  },
  luckgram: (text, toLang) => luckgramAI.chat({
    task: 'translate',
    params: {to_lang: toLang},
    messages: [{role: 'user', content: text}]
  }),
  detect: detectTextLanguage,
  isOnline: () => navigator.onLine !== false,
  // * the path and the time, never the text (specs/01, 翻译服务 7)
  log: (entry) => console.debug('[luckgram] translate', entry)
});

/** What received messages are translated to. */
export const getIncomingTarget = () => getIncomingTargetLang(LuckgramSettings.getString(KEY_TRANSLATE_TO), I18n.langCodeNormalized());

/** A language's name in the interface's language; its code when there is none. */
export function getLanguageName(langCode: string | undefined): string {
  if(!langCode) return '';
  const key = `Language.${langCode}`;
  const name = I18n.format(key as any, true);
  return name && name !== key ? name : langCode.toUpperCase();
}

export function getTranslateErrorText(err: unknown): string {
  return lgText(...getTranslateFailureText(err instanceof TranslateError ? err.failure : 'other'));
}
