/*
 * Luckgram Web (luckgram-specs#185, W5 需求 1–5): the translation every entry uses.
 *
 *   1. the cache: the same text to the same language is not asked for twice;
 *   2. Telegram's `messages.translateText`, for 8 seconds at most;
 *   3. on any error or no answer, the Luckgram server: `POST /v1/ai/chat`, `task=translate`,
 *      through the AI client (device token, consent asked the first time). Its answer is plain text.
 *
 * Telegram's own switch (`translations_manual_enabled`) and Premium are not looked at: whoever
 * Telegram does not translate for is served by the second step.
 */

import {LuckgramApiError} from '@/luckgram/core/errors';
import type {TranslationCache} from '@/luckgram/translate/cache';
import {
  TELEGRAM_TIMEOUT_MS, TranslateFailure, Translation, TranslationEntity, getTranslateFailure, normalizeLang
} from '@/luckgram/translate/logic';

export type TranslateRequest = {
  text: string,
  entities?: TranslationEntity[],
  toLang: string,
  /** a message of a chat: Telegram translates it by its id, which keeps its formatting */
  peerId?: number,
  mid?: number
};

export type TranslateDeps = {
  account: () => number | string,
  cache: TranslationCache,
  /** Telegram's translation: the text with its entities, or a rejection */
  telegram: (request: TranslateRequest) => Promise<{text: string, entities?: TranslationEntity[]} | undefined>,
  /** the Luckgram server's: the translated text */
  luckgram: (text: string, toLang: string) => Promise<string>,
  detect?: (text: string) => Promise<string | undefined>,
  isOnline?: () => boolean,
  timeoutMs?: number,
  log?: (entry: {via?: string, telegramError?: string, fallback: boolean, ms: number, failure?: TranslateFailure}) => void
};

export class TranslateError extends Error {
  constructor(public failure: TranslateFailure) {
    super('translate_' + failure);
  }
}

const withTimeout = <T>(promise: Promise<T>, ms: number) => new Promise<T>((resolve, reject) => {
  const timeout = setTimeout(() => reject(Object.assign(new Error('TIMEOUT'), {type: 'TIMEOUT'})), ms);
  promise.then((value) => {
    clearTimeout(timeout);
    resolve(value);
  }, (err) => {
    clearTimeout(timeout);
    reject(err);
  });
});

export function createTranslator(deps: TranslateDeps) {
  const inFlight = new Map<string, Promise<Translation>>();

  async function run(request: TranslateRequest, toLang: string): Promise<Translation> {
    const started = Date.now();
    let telegramError: string;
    let translation: Translation;

    try {
      const result = await withTimeout(deps.telegram({...request, toLang}), deps.timeoutMs ?? TELEGRAM_TIMEOUT_MS);
      if(!result?.text?.trim()) throw Object.assign(new Error('EMPTY'), {type: 'EMPTY'});
      translation = {text: result.text, entities: result.entities?.length ? result.entities : undefined, via: 'telegram'};
    } catch(err) {
      telegramError = (err as any)?.type || (err as Error)?.message || 'ERROR';
    }

    if(!translation) {
      try {
        const text = await deps.luckgram(request.text, toLang);
        if(!text?.trim()) throw new LuckgramApiError(LuckgramApiError.UPSTREAM_UNAVAILABLE, 0);
        translation = {text, via: 'luckgram'};
      } catch(err) {
        const code = err instanceof LuckgramApiError ? err.code : undefined;
        const failure = getTranslateFailure(code, deps.isOnline?.() ?? true, telegramError);
        deps.log?.({telegramError, fallback: true, ms: Date.now() - started, failure});
        throw new TranslateError(failure);
      }
    }

    translation.from = normalizeLang(await deps.detect?.(request.text).catch((): undefined => undefined));
    deps.log?.({via: translation.via, telegramError, fallback: translation.via === 'luckgram', ms: Date.now() - started});
    return translation;
  }

  /** @throws TranslateError, whose `failure` says what to tell the user */
  return async function translate(request: TranslateRequest): Promise<Translation> {
    const toLang = normalizeLang(request.toLang) || 'en';
    const account = deps.account();
    await deps.cache.ready;

    const cached = deps.cache.get(account, toLang, request.text);
    if(cached) return cached;

    // * two entries asking for the same thing at once share the request
    const key = account + ':' + toLang + ':' + request.text;
    let promise = inFlight.get(key);
    if(!promise) {
      promise = run(request, toLang).then((translation) => {
        deps.cache.put(account, toLang, request.text, translation);
        return translation;
      }).finally(() => inFlight.delete(key));
      inFlight.set(key, promise);
    }

    return promise;
  };
}
