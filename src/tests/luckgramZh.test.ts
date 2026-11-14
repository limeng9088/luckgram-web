// * Luckgram Web (luckgram-specs#180): Chinese for the strings Telegram's Chinese pack lacks

import lang from '@/lang';
import langSign from '@/langSign';
import zh from '@/luckgram/zhStrings';
import {getLuckgramZhTexts, isLuckgramZhOverlayLang, luckgramZhString, resetLuckgramZhTexts} from '@/luckgram/zhOverlay';

const english: {[key: string]: any} = {...lang, ...langSign};
const marks = (text: string) => (text.match(/%(\d+\$)?[sd@]|\*\*|\[|\]\(\)/g) || []).sort().join(' ');

describe('luckgram: Chinese texts for what the Chinese pack lacks', () => {
  beforeEach(() => resetLuckgramZhTexts());

  test('every text is for a string the client has, of the same kind', () => {
    for(const key in zh) {
      expect(english[key], key).toBeDefined();
      expect(typeof(zh[key]), key).toBe(typeof(english[key]));
    }
  });

  test('the placeholders and the formatting marks are those of the English', () => {
    for(const key in zh) {
      const text = zh[key], source = english[key];
      if(typeof(text) === 'string') {
        expect(marks(text), key).toBe(marks(source));
      } else {
        for(const form in text) expect(marks(text[form]), key).toBe(marks(source.other_value));
      }
    }
  });

  test('the texts are Chinese, and none is empty', () => {
    for(const key in zh) {
      const text = typeof(zh[key]) === 'string' ? zh[key] as string : Object.values(zh[key]).join('');
      expect(/[一-鿿]/.test(text), key).toBe(true);
    }
  });

  test('Simplified Chinese only', () => {
    for(const langCode of ['zh-hans-raw', 'zh-hans', 'zh', 'zh-CN']) expect(isLuckgramZhOverlayLang(langCode)).toBe(true);
    for(const langCode of ['zh-hant-raw', 'zh-TW', 'en', 'ru', '', undefined]) expect(isLuckgramZhOverlayLang(langCode)).toBe(false);
  });

  test('a bundled English string gets its Chinese; the server\'s string is left as it is', () => {
    const texts = {'A': '甲', 'P': {one_value: '%d 个', other_value: '%d 个'}};
    expect(luckgramZhString({_: 'langPackString', key: 'A', value: 'A', local: true}, texts)).toEqual({_: 'langPackString', key: 'A', value: '甲'});
    expect(luckgramZhString({_: 'langPackStringPluralized', key: 'P', other_value: '%d things', local: true}, texts))
    .toEqual({_: 'langPackStringPluralized', key: 'P', one_value: '%d 个', other_value: '%d 个'});

    const server = {_: 'langPackString', key: 'A', value: '服务器的'};
    expect(luckgramZhString(server, texts)).toBe(server);
    const untranslated = {_: 'langPackString', key: 'B', value: 'B', local: true};
    expect(luckgramZhString(untranslated, texts)).toBe(untranslated);
    expect(luckgramZhString(untranslated, undefined)).toBe(untranslated);
  });

  test('the texts are loaded once, for a Chinese pack, and the latest pack is applied again', async() => {
    const load = vi.fn(async() => ({default: {'A': '甲'}}));
    const first = vi.fn(), second = vi.fn();

    expect(getLuckgramZhTexts('en', first, load)).toBeUndefined();
    expect(load).not.toHaveBeenCalled();

    expect(getLuckgramZhTexts('zh-hans-raw', first, load)).toBeUndefined();
    expect(getLuckgramZhTexts('zh-hans-raw', second, load)).toBeUndefined();
    await Promise.resolve();
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    expect(getLuckgramZhTexts('zh-hans-raw', first, load)).toEqual({'A': '甲'});
    expect(first).not.toHaveBeenCalled();
  });

  test('a switch to another language meanwhile: nothing is applied again', async() => {
    const load = vi.fn(async() => ({default: {'A': '甲'}}));
    const again = vi.fn();
    getLuckgramZhTexts('zh-hans-raw', again, load);
    getLuckgramZhTexts('en', vi.fn(), load);
    await Promise.resolve();
    await Promise.resolve();
    expect(again).not.toHaveBeenCalled();
  });

  test('texts that could not be loaded are asked for with the next pack', async() => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = vi.fn(async(): Promise<any> => { throw new Error('offline'); });
    getLuckgramZhTexts('zh-hans-raw', vi.fn(), failing);
    await Promise.resolve();
    await Promise.resolve();
    const load = vi.fn(async() => ({default: {'A': '甲'}}));
    getLuckgramZhTexts('zh-hans-raw', vi.fn(), load);
    expect(load).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
