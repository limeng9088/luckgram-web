// * Luckgram Web (luckgram-specs#185, W5): translation — the rules, the cache, the two steps; the preview list

import 'fake-indexeddb/auto';
import {IDBFactory} from 'fake-indexeddb';
import {LuckgramIndexedDBStorage, LuckgramMemoryStorage} from '@/luckgram/core/storage';
import {LuckgramApiError} from '@/luckgram/core/errors';
import {isHiddenByPreviewList} from '@/luckgram/core/preview';
import {TranslationCache} from '@/luckgram/translate/cache';
import {TranslateDeps, TranslateError, createTranslator} from '@/luckgram/translate/service';
import {
  CACHE_MAX_AGE_MS, getIncomingTargetLang, getKeysToPrune, getOutLang, getOutgoingTargetLang, getTranslateFailure, getTranslateFailureText,
  hashText, isFormattingLost, normalizeLang, parseOutLangs, rememberOutLang, shouldOfferQuickTranslate, stateKey, translationKey
} from '@/luckgram/translate/logic';

describe('luckgram: the preview list', () => {
  test('a feature on the list is hidden from everybody but a preview browser', () => {
    expect(isHiddenByPreviewList('translate_in', ['translate_in'], false)).toBe(true);
    expect(isHiddenByPreviewList('translate_in', ['translate_in'], true)).toBe(false);
  });

  test('a feature not on it, an empty list and a server that says nothing hide nothing', () => {
    expect(isHiddenByPreviewList('translate_out', ['translate_in'], false)).toBe(false);
    expect(isHiddenByPreviewList('translate_in', [], false)).toBe(false);
    expect(isHiddenByPreviewList('translate_in', undefined, false)).toBe(false);
  });
});

describe('luckgram translation: the rules', () => {
  test('languages: Telegram\'s pack codes and regional tags come down to the language', () => {
    expect(normalizeLang('zh-hans-raw')).toBe('zh');
    expect(normalizeLang('pt-BR')).toBe('pt');
    expect(normalizeLang('en')).toBe('en');
    expect(normalizeLang('')).toBeUndefined();
    expect(normalizeLang('<script>')).toBeUndefined();
  });

  test('received messages go to the chosen language, else the interface\'s', () => {
    expect(getIncomingTargetLang('es', 'zh-hans-raw')).toBe('es');
    expect(getIncomingTargetLang(undefined, 'zh-hans-raw')).toBe('zh');
    expect(getIncomingTargetLang(undefined, undefined)).toBe('en');
  });

  test('a draft goes to the chat\'s remembered language, else the other side\'s, else English', () => {
    expect(getOutgoingTargetLang('es', 'ru')).toBe('es');
    expect(getOutgoingTargetLang(undefined, 'ru')).toBe('ru');
    expect(getOutgoingTargetLang(undefined, undefined)).toBe('en');
  });

  test('each chat keeps its own language; the oldest go when there are too many', () => {
    let langs = parseOutLangs(undefined);
    langs = rememberOutLang(langs, 1, 'es');
    langs = rememberOutLang(langs, 2, 'ru');
    expect(getOutLang(langs, 1)).toBe('es');
    expect(getOutLang(langs, 2)).toBe('ru');
    expect(getOutLang(langs, 3)).toBeUndefined();
    langs = rememberOutLang(langs, 1, 'fr', 2);
    langs = rememberOutLang(langs, 3, 'de', 2);
    expect(langs).toEqual([['1', 'fr'], ['3', 'de']]);
    expect(parseOutLangs(JSON.stringify(langs))).toEqual(langs);
    expect(parseOutLangs('not json')).toEqual([]);
    expect(parseOutLangs('{"1":"es"}')).toEqual([]);
  });

  test('the one-tap icon: somebody else\'s text in a language that is not skipped', () => {
    const base = {out: false, hasText: true, detected: 'en', doNotTranslate: ['zh'], target: 'zh'};
    expect(shouldOfferQuickTranslate(base)).toBe(true);
    expect(shouldOfferQuickTranslate({...base, out: true})).toBe(false);
    expect(shouldOfferQuickTranslate({...base, hasText: false})).toBe(false);
    expect(shouldOfferQuickTranslate({...base, detected: undefined})).toBe(false);
    expect(shouldOfferQuickTranslate({...base, doNotTranslate: ['zh', 'en']})).toBe(false);
    expect(shouldOfferQuickTranslate({...base, detected: 'zh'})).toBe(false);
  });

  test('errors: the phones\' four texts', () => {
    expect(getTranslateFailure('quota_exceeded', true)).toBe('quota');
    expect(getTranslateFailure('input_too_large', true)).toBe('too_long');
    expect(getTranslateFailure('network_error', true)).toBe('network');
    expect(getTranslateFailure('upstream_unavailable', false)).toBe('network');
    expect(getTranslateFailure('upstream_unavailable', true)).toBe('other');
    expect(getTranslateFailure('consent_denied', true)).toBe('other');
    expect(getTranslateFailureText('quota')[0]).toBe('今日翻译次数已用完，明天再来');
    expect(getTranslateFailureText('network')[0]).toBe('网络不通，请检查网络或代理');
    expect(getTranslateFailureText('too_long')[0]).toBe('这段文字太长，无法翻译');
    expect(getTranslateFailureText('other')[0]).toBe('翻译失败，请稍后再试');
  });

  test('formatting is lost only when the server answered in plain text and there was some', () => {
    const bold = [{_: 'messageEntityBold', offset: 0, length: 2}];
    const mention = [{_: 'messageEntityMention', offset: 0, length: 2}];
    expect(isFormattingLost(bold, {text: 'x', via: 'luckgram'})).toBe(true);
    expect(isFormattingLost(bold, {text: 'x', via: 'telegram'})).toBe(false);
    expect(isFormattingLost(mention, {text: 'x', via: 'luckgram'})).toBe(false);
    expect(isFormattingLost(undefined, {text: 'x', via: 'luckgram'})).toBe(false);
  });

  test('the cache: by account, language and text; old and surplus entries go, per account and kind', () => {
    expect(hashText('hello')).toBe(hashText('hello'));
    expect(hashText('hello')).not.toBe(hashText('hellp'));
    expect(translationKey(1, 'zh', 'hello')).not.toBe(translationKey(2, 'zh', 'hello'));
    expect(translationKey(1, 'zh', 'hello')).not.toBe(translationKey(1, 'es', 'hello'));

    const now = 1e12;
    const records = new Map<string, number>([
      ['t:1:zh:a', now - 1], ['t:1:zh:b', now - 2], ['t:1:zh:c', now - 3],
      ['t:2:zh:a', now - 4], ['s:1:5_6', now - 5],
      ['t:1:zh:old', now - CACHE_MAX_AGE_MS - 1], ['t:1:zh:broken', NaN]
    ]);
    expect(getKeysToPrune(records, now, 2).sort()).toEqual(['t:1:zh:broken', 't:1:zh:c', 't:1:zh:old']);
    expect(stateKey(1, -100, 7)).toBe('s:1:-100_7');
  });
});

describe('luckgram translation: the cache', () => {
  test('kept across a reload, in IndexedDB luckgram', async() => {
    const factory = new IDBFactory();
    const cache = new TranslationCache(new LuckgramIndexedDBStorage(factory, 'lg-tr'));
    await cache.ready;
    await cache.put(1, 'zh', 'hello', {text: '你好', via: 'telegram', from: 'en', entities: [{_: 'messageEntityBold', offset: 0, length: 2}]});
    await cache.setState(1, 10, 20, 'zh');

    const reopened = new TranslationCache(new LuckgramIndexedDBStorage(factory, 'lg-tr'));
    await reopened.ready;
    expect(reopened.get(1, 'zh', 'hello')).toEqual({text: '你好', via: 'telegram', from: 'en', entities: [{_: 'messageEntityBold', offset: 0, length: 2}]});
    expect(reopened.get(2, 'zh', 'hello')).toBeUndefined();
    expect(reopened.getState(1, 10, 20)).toBe('zh');

    await reopened.setState(1, 10, 20, undefined);
    const third = new TranslationCache(new LuckgramIndexedDBStorage(factory, 'lg-tr'));
    await third.ready;
    expect(third.getState(1, 10, 20)).toBeUndefined();
  });

  test('7 days, and an account\'s entries go with it', async() => {
    let now = 1e12;
    const storage = new LuckgramMemoryStorage();
    const cache = new TranslationCache(storage, () => now);
    await cache.ready;
    await cache.put(1, 'zh', 'a', {text: '甲', via: 'luckgram'});
    await cache.put(2, 'zh', 'a', {text: '甲', via: 'luckgram'});
    await cache.setState(1, 1, 1, 'zh');

    await cache.clearAccount(1);
    expect(cache.get(1, 'zh', 'a')).toBeUndefined();
    expect(cache.getState(1, 1, 1)).toBeUndefined();
    expect(cache.get(2, 'zh', 'a')).toBeDefined();

    now += CACHE_MAX_AGE_MS + 1;
    const later = new TranslationCache(storage, () => now);
    await later.ready;
    expect(later.get(2, 'zh', 'a')).toBeUndefined();
    expect(Object.keys(await storage.getAll('cache'))).toEqual([]);
  });

  test('a database that cannot be read: the page goes on without one', async() => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken: any = {getAll: () => Promise.reject(new Error('no')), update: () => Promise.reject(new Error('no'))};
    const cache = new TranslationCache(broken);
    await cache.ready;
    await cache.put(1, 'zh', 'a', {text: '甲', via: 'luckgram'});
    expect(cache.get(1, 'zh', 'a')?.text).toBe('甲');
    warn.mockRestore();
  });
});

describe('luckgram translation: Telegram first, then the Luckgram server', () => {
  const make = async(overrides: Partial<TranslateDeps> = {}) => {
    const cache = new TranslationCache(new LuckgramMemoryStorage());
    await cache.ready;
    const deps: TranslateDeps = {
      account: () => 1,
      cache,
      telegram: vi.fn(async() => ({text: '你好', entities: [] as any[]})),
      luckgram: vi.fn(async() => '你好（服务端）'),
      detect: async() => 'en',
      timeoutMs: 30,
      ...overrides
    };
    return {deps, translate: createTranslator(deps)};
  };

  test('Telegram answers: the server is not asked', async() => {
    const {deps, translate} = await make();
    expect(await translate({text: 'hello', toLang: 'zh-hans-raw', peerId: 5, mid: 6})).toEqual({text: '你好', entities: undefined, via: 'telegram', from: 'en'});
    expect(deps.telegram).toHaveBeenCalledWith({text: 'hello', toLang: 'zh', peerId: 5, mid: 6});
    expect(deps.luckgram).not.toHaveBeenCalled();
  });

  test('the same text a second time makes no request', async() => {
    const {deps, translate} = await make();
    await translate({text: 'hello', toLang: 'zh'});
    await translate({text: 'hello', toLang: 'zh'});
    expect(deps.telegram).toHaveBeenCalledTimes(1);
    await translate({text: 'hello', toLang: 'es'});
    expect(deps.telegram).toHaveBeenCalledTimes(2);
  });

  test('two entries asking at once share the request', async() => {
    const {deps, translate} = await make();
    await Promise.all([translate({text: 'hello', toLang: 'zh'}), translate({text: 'hello', toLang: 'zh'})]);
    expect(deps.telegram).toHaveBeenCalledTimes(1);
  });

  test('Telegram refuses (any error): the Luckgram server translates, in plain text', async() => {
    const {deps, translate} = await make({telegram: vi.fn(async() => { throw Object.assign(new Error('x'), {type: 'TRANSLATIONS_DISABLED_ALT'}); })});
    expect(await translate({text: 'hello', toLang: 'zh'})).toEqual({text: '你好（服务端）', via: 'luckgram', from: 'en'});
    expect(deps.luckgram).toHaveBeenCalledWith('hello', 'zh');
  });

  test('Telegram says nothing for 8 seconds, or answers with nothing: the same', async() => {
    const silent = await make({telegram: () => new Promise(() => {})});
    expect((await silent.translate({text: 'hello', toLang: 'zh'})).via).toBe('luckgram');
    const empty = await make({telegram: async() => ({text: '  '})});
    expect((await empty.translate({text: 'hello', toLang: 'zh'})).via).toBe('luckgram');
  });

  test('both fail: the reason, and nothing is cached', async() => {
    const telegram = vi.fn(async() => { throw new Error('x'); });
    for(const [code, online, failure] of [['quota_exceeded', true, 'quota'], ['network_error', true, 'network'], ['input_too_large', true, 'too_long'], ['upstream_unavailable', true, 'other'], ['consent_denied', true, 'other'], ['upstream_unavailable', false, 'network']] as const) {
      const {deps, translate} = await make({telegram, luckgram: vi.fn(async() => { throw new LuckgramApiError(code); }), isOnline: () => online});
      const error = await translate({text: 'hello', toLang: 'zh'}).catch((err) => err);
      expect(error).toBeInstanceOf(TranslateError);
      expect(error.failure, code).toBe(failure);
      expect(deps.cache.size).toBe(0);
    }
  });

  test('the log says the entry\'s path and time, never the text', async() => {
    const log = vi.fn();
    const {translate} = await make({log, telegram: async() => { throw Object.assign(new Error('x'), {type: 'FLOOD_WAIT_3'}); }});
    await translate({text: 'secret words', toLang: 'zh'});
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatchObject({via: 'luckgram', telegramError: 'FLOOD_WAIT_3', fallback: true});
    expect(JSON.stringify(log.mock.calls[0][0])).not.toContain('secret');
  });
});
