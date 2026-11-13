// Luckgram Web (luckgram-specs#139, W3): settings, the feature registry, the API's entries, the
// device token, the remote config, the AI client and the announcements.

import 'fake-indexeddb/auto';
import {IDBFactory} from 'fake-indexeddb';
import {LuckgramEndpoints, PROBE_INTERVAL_MS, parseEndpoints} from '@/luckgram/core/endpoints';
import {LuckgramIndexedDBStorage, LuckgramMemoryStorage, LuckgramStorage} from '@/luckgram/core/storage';
import {LuckgramSettingsStore} from '@/luckgram/core/settings';
import {
  REFRESH_INTERVAL_SECONDS, deserializeRemoteConfig, getRemoteBool, getRemoteNumber, getRemoteStrings, isFeatureAllowed,
  isRemoteConfigStale, parseRemoteConfig, serializeRemoteConfig
} from '@/luckgram/core/remoteConfigLogic';
import {LuckgramApi} from '@/luckgram/core/api';
import {LuckgramApiError, errorFromResponse, errorMessage} from '@/luckgram/core/errors';
import {LuckgramAI} from '@/luckgram/core/ai';
import {createSseParser} from '@/luckgram/core/sse';
import {
  MAX_DISMISSED, dismissAnnouncement, parseAnnouncements, parseDismissed, pickAnnouncement, shouldRefreshAnnouncements
} from '@/luckgram/core/announcementsLogic';
import {FEATURES, FEATURE_GROUPS, LuckgramFeature, getVisibleFeatures, isFeatureLocallyEnabled} from '@/luckgram/core/features';
import {shouldClearOnLogout} from '@/luckgram/core/init';
import {getLuckgramApiUrls} from '../../scripts/luckgram/vite-plugin.mjs';

const MAIN = 'https://api-dev.luckgram.cc';
const BACKUP = 'https://lg-dev.cat158.com';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async() => {
  for(let i = 0; i < 5; ++i) await tick();
};

describe('luckgram settings', () => {
  let channel = 0;
  const makeStore = (storage: LuckgramStorage = new LuckgramMemoryStorage(), name = 'test-settings-' + (++channel)) =>
    new LuckgramSettingsStore(storage, name);

  test('booleans, strings and integers by key, with defaults', async() => {
    const store = makeStore();
    await store.ready;
    expect(store.getBool('a', true)).toBe(true);
    expect(store.getString('b', 'x')).toBe('x');
    expect(store.getInt('c', 7)).toBe(7);

    await store.set('a', false);
    await store.set('b', 'hello');
    await store.set('c', 12.9);
    expect(store.getBool('a', true)).toBe(false);
    expect(store.getString('b')).toBe('hello');
    expect(store.getInt('c', 0)).toBe(12);

    // * a value of another type reads as the default
    expect(store.getBool('b', true)).toBe(true);
    expect(store.getInt('b', 5)).toBe(5);

    await store.set('a', undefined);
    expect(store.has('a')).toBe(false);
    expect(store.getBool('a', true)).toBe(true);
  });

  test('a change reaches listeners at once, and only when the value changed', async() => {
    const store = makeStore();
    await store.ready;
    const seen: any[] = [];
    const stop = store.subscribe((key, value) => seen.push([key, value]));
    store.set('debug_demo', true);
    store.set('debug_demo', true);
    store.set('debug_demo', false);
    expect(seen).toEqual([['debug_demo', true], ['debug_demo', false]]);
    stop();
    store.set('debug_demo', true);
    expect(seen.length).toBe(2);
  });

  test('kept in IndexedDB: a reopened page has the values', async() => {
    const factory = new IDBFactory();
    const first = makeStore(new LuckgramIndexedDBStorage(factory, 'lg-test'));
    await first.ready;
    await first.set('debug_demo', true);
    await first.set('name', 'x');
    await first.setPrivate('device_token', 'secret-token');

    const second = makeStore(new LuckgramIndexedDBStorage(factory, 'lg-test'));
    await second.ready;
    expect(second.getBool('debug_demo', false)).toBe(true);
    expect(second.getString('name')).toBe('x');
    expect(second.getPrivate('device_token')).toBe('secret-token');
  });

  test('another tab sees a change without reloading', async() => {
    const storage = new LuckgramMemoryStorage();
    const name = 'test-settings-tabs';
    const tabA = makeStore(storage, name), tabB = makeStore(storage, name);
    await Promise.all([tabA.ready, tabB.ready]);

    const seen: any[] = [];
    tabB.subscribe((key, value) => seen.push([key, value]));
    await tabA.set('debug_demo', true);
    await settle();
    expect(tabB.getBool('debug_demo', false)).toBe(true);
    expect(seen).toEqual([['debug_demo', true]]);

    // * the device token too, but not through the listeners
    await tabA.setPrivate('device_token', 't1');
    await settle();
    expect(tabB.getPrivate('device_token')).toBe('t1');
    expect(seen.length).toBe(1);
  });

  test('clear removes every setting and the token, here, in storage and in the other tabs', async() => {
    const factory = new IDBFactory();
    const name = 'test-settings-clear';
    const tabA = makeStore(new LuckgramIndexedDBStorage(factory, 'lg-clear'), name);
    const tabB = makeStore(new LuckgramIndexedDBStorage(factory, 'lg-clear'), name);
    await Promise.all([tabA.ready, tabB.ready]);
    await tabA.set('debug_demo', true);
    await tabA.setPrivate('device_token', 't1');
    await settle();

    await tabA.clear();
    await settle();
    for(const tab of [tabA, tabB]) {
      expect(tab.getBool('debug_demo', false)).toBe(false);
      expect(tab.getPrivate('device_token')).toBeUndefined();
    }

    const reopened = makeStore(new LuckgramIndexedDBStorage(factory, 'lg-clear'));
    await reopened.ready;
    expect(reopened.has('debug_demo')).toBe(false);
    expect(reopened.getPrivate('device_token')).toBeUndefined();
  });

  test('Luckgram\'s values go when no account is left, and stay while one is', () => {
    expect(shouldClearOnLogout(0)).toBe(true);
    expect(shouldClearOnLogout(undefined)).toBe(true);
    expect(shouldClearOnLogout(1)).toBe(false);
    expect(shouldClearOnLogout(3)).toBe(false);
  });
});

describe('luckgram features', () => {
  const sample: LuckgramFeature[] = [
    {key: 'quick_replies', group: 'messages', default: true, title: ['快捷回复', 'Quick replies'], description: ['', '']},
    {key: 'ai_summary', group: 'ai', default: true, title: ['总结', 'Summary'], description: ['', '']},
    {key: 'debug_demo', group: 'debug', default: false, devOnly: true, title: ['调试', 'Debug'], description: ['', '']}
  ];

  test('the page is generated from the registry, group by group, in the phones\' order', () => {
    expect(FEATURE_GROUPS).toEqual(['accounts', 'messages', 'media', 'profiles', 'discover', 'ai', 'debug']);
    const allow = () => true;
    expect(getVisibleFeatures('messages', sample, false, allow).map((f) => f.key)).toEqual(['quick_replies']);
    expect(getVisibleFeatures('accounts', sample, false, allow)).toEqual([]);
  });

  test('a debug feature has a row only on the development address', () => {
    const allow = () => true;
    expect(getVisibleFeatures('debug', sample, true, allow).map((f) => f.key)).toEqual(['debug_demo']);
    expect(getVisibleFeatures('debug', sample, false, allow)).toEqual([]);
  });

  test('a feature the server switched off has no row', () => {
    expect(getVisibleFeatures('ai', sample, false, (key) => key !== 'ai_summary')).toEqual([]);
  });

  test('the registry: unique snake_case keys, both languages, debug_demo off by default', () => {
    const keys = FEATURES.map((feature) => feature.key);
    expect(new Set(keys).size).toBe(keys.length);
    for(const feature of FEATURES) {
      expect(feature.key).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(FEATURE_GROUPS).toContain(feature.group);
      expect(feature.title[0] && feature.title[1]).toBeTruthy();
    }

    const demo = FEATURES.find((feature) => feature.key === 'debug_demo');
    expect(demo).toMatchObject({default: false, devOnly: true, group: 'debug'});
  });

  test('the switch is the user\'s, falling back to the registry\'s default', async() => {
    const store = new LuckgramSettingsStore(new LuckgramMemoryStorage(), null);
    await store.ready;
    expect(isFeatureLocallyEnabled('debug_demo', store)).toBe(false);
    await store.set('debug_demo', true);
    expect(isFeatureLocallyEnabled('debug_demo', store)).toBe(true);
  });
});

describe('luckgram API entries', () => {
  test('https only, in order, without duplicates', () => {
    expect(parseEndpoints(` ${MAIN}/ , ${BACKUP} http://insecure.example ${MAIN} javascript:x`)).toEqual([MAIN, BACKUP]);
    expect(parseEndpoints('')).toEqual([]);
    expect(() => new LuckgramEndpoints([])).toThrow();
  });

  test('the entry that worked last is used first; the others follow in list order', () => {
    const endpoints = new LuckgramEndpoints([MAIN, BACKUP, 'https://third.example']);
    expect(endpoints.attemptOrder()).toEqual([MAIN, BACKUP, 'https://third.example']);
    expect(endpoints.markWorking(BACKUP)).toBe(true);
    expect(endpoints.markWorking(BACKUP)).toBe(false);
    expect(endpoints.usingBackup).toBe(true);
    expect(endpoints.attemptOrder()).toEqual([BACKUP, MAIN, 'https://third.example']);

    expect(new LuckgramEndpoints([MAIN, BACKUP], BACKUP).currentBase).toBe(BACKUP);
    expect(new LuckgramEndpoints([MAIN, BACKUP], 'https://gone.example').currentBase).toBe(MAIN);
  });

  test('the main entry is probed while a backup is in use: once per start, then every 6 hours', () => {
    const endpoints = new LuckgramEndpoints([MAIN, BACKUP]);
    expect(endpoints.shouldProbe(1000)).toBe(false);
    endpoints.markWorking(BACKUP);
    expect(endpoints.shouldProbe(1000)).toBe(true);
    endpoints.markProbed(1000);
    expect(endpoints.shouldProbe(1000 + PROBE_INTERVAL_MS - 1)).toBe(false);
    expect(endpoints.shouldProbe(1000 + PROBE_INTERVAL_MS)).toBe(true);
  });

  test('a URL of another entry is moved to the one in use', () => {
    const endpoints = new LuckgramEndpoints([MAIN, BACKUP], BACKUP);
    expect(endpoints.rewrite(MAIN + '/v1/files/a.png?x=1')).toBe(BACKUP + '/v1/files/a.png?x=1');
    expect(endpoints.rewrite('https://api-dev.luckgram.cc.evil.example/a')).toBe('https://api-dev.luckgram.cc.evil.example/a');
    expect(endpoints.rewrite('https://elsewhere.example/a')).toBe('https://elsewhere.example/a');
  });

  test('the entries of a build', () => {
    expect(getLuckgramApiUrls({LUCKGRAM_CHANNEL: 'dev'})).toEqual([MAIN, BACKUP]);
    expect(getLuckgramApiUrls({LUCKGRAM_CHANNEL: 'prod'})).toEqual(['https://api.luckgram.cc', 'https://lg.cat158.com']);
  });
});

describe('luckgram API client', () => {
  type Call = {url: string, init: RequestInit};
  const json = (status: number, body: any, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json', ...headers}});

  const setup = async(handler: (call: Call, calls: Call[]) => Response | Promise<Response>, now?: () => number) => {
    const calls: Call[] = [];
    const settings = new LuckgramSettingsStore(new LuckgramMemoryStorage(), null);
    await settings.ready;
    const api = new LuckgramApi({
      endpoints: [MAIN, BACKUP],
      appVersion: '2.3',
      locale: () => 'zh-CN',
      now,
      settings: settings as any,
      fetch: (async(url: any, init: any) => {
        const call = {url: String(url), init};
        calls.push(call);
        return handler(call, calls);
      }) as any
    });
    return {api, calls, settings};
  };

  const header = (call: Call, name: string) => (call.init.headers as Record<string, string>)[name];

  test('registers the browser as platform=web, then sends the token in the Authorization header only', async() => {
    const {api, calls, settings} = await setup((call) =>
      call.url.endsWith('/v1/devices') ? json(201, {token: 'tok-1', device: {platform: 'web'}}) : json(200, {ok: true}));

    expect(await api.requestJSON({path: '/v1/me'})).toEqual({ok: true});
    expect(calls.map((call) => call.url)).toEqual([MAIN + '/v1/devices', MAIN + '/v1/me']);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({platform: 'web', app_version: '2.3', locale: 'zh-CN'});
    expect(header(calls[0], 'Authorization')).toBeUndefined();
    expect(header(calls[1], 'Authorization')).toBe('Bearer tok-1');
    expect(header(calls[1], 'X-Luckgram-App-Version')).toBe('2.3');
    expect(calls[1].init.credentials).toBe('omit');
    expect(settings.getPrivate('device_token')).toBe('tok-1');

    // * never in a URL
    expect(calls.some((call) => call.url.includes('tok-1'))).toBe(false);

    // * and the next request does not register again
    await api.requestJSON({path: '/v1/config'});
    expect(calls.length).toBe(3);
  });

  test('registration refused for a while: nothing is asked again until the time the server gave', async() => {
    let time = 1000_000, limited = true;
    const {api, calls, settings} = await setup((call) => {
      if(!call.url.endsWith('/v1/devices')) return json(200, {ok: true});
      return limited ? json(429, {error: {code: 'rate_limited', retry_after_seconds: 3600}}) : json(201, {token: 'tok-1'});
    }, () => time);

    await expect(api.requestJSON({path: '/v1/config'})).rejects.toMatchObject({code: 'rate_limited', status: 429, retryAfterSeconds: 3600});
    expect(calls.length).toBe(1);

    // * the config, the announcements, another tab: none of them reaches the server
    time += 60_000;
    await expect(api.requestJSON({path: '/v1/announcements'})).rejects.toMatchObject({code: 'rate_limited', retryAfterSeconds: 3540});
    expect(calls.length).toBe(1);

    // * once the time has passed it registers, and forgets the wait
    time += 3540_000;
    limited = false;
    expect(await api.requestJSON({path: '/v1/config'})).toEqual({ok: true});
    expect(settings.getPrivate('device_token')).toBe('tok-1');
    expect(settings.getPrivate('device_register_retry_at')).toBeUndefined();
  });

  test('a refusal without a time is not remembered; a clock set back does not lock registration', async() => {
    let time = 5000_000, status = 429;
    const {api, calls, settings} = await setup((call) =>
      call.url.endsWith('/v1/devices') ? (status === 429 ? json(429, {error: {code: 'rate_limited'}}) : json(201, {token: 'tok-1'})) : json(200, {}), () => time);

    await expect(api.requestJSON({path: '/v1/me'})).rejects.toMatchObject({code: 'rate_limited'});
    await expect(api.requestJSON({path: '/v1/me'})).rejects.toMatchObject({code: 'rate_limited'});
    expect(calls.length).toBe(2);

    await settings.setPrivate('device_register_retry_at', time + 30 * 24 * 60 * 60 * 1000);
    status = 201;
    await api.requestJSON({path: '/v1/me'});
    expect(settings.getPrivate('device_token')).toBe('tok-1');
  });

  test('requests at the same moment share one registration', async() => {
    const {api, calls} = await setup(async(call) => {
      await tick();
      return call.url.endsWith('/v1/devices') ? json(201, {token: 'tok-1'}) : json(200, {});
    });

    await Promise.all([api.requestJSON({path: '/v1/me'}), api.requestJSON({path: '/v1/config'})]);
    expect(calls.filter((call) => call.url.endsWith('/v1/devices')).length).toBe(1);
  });

  test('a token the server no longer knows: registers once more, then gives up', async() => {
    let token = 0;
    const {api, calls, settings} = await setup((call) => {
      if(call.url.endsWith('/v1/devices')) return json(201, {token: 'tok-' + (++token)});
      return header(call, 'Authorization') === 'Bearer tok-2' ? json(200, {ok: true}) : json(401, {error: {code: 'invalid_token'}});
    });

    expect(await api.requestJSON({path: '/v1/me'})).toEqual({ok: true});
    expect(settings.getPrivate('device_token')).toBe('tok-2');
    expect(calls.length).toBe(4);

    const always401 = await setup((call) => call.url.endsWith('/v1/devices') ? json(201, {token: 'x'}) : json(401, {}));
    await expect(always401.api.requestJSON({path: '/v1/me'})).rejects.toMatchObject({code: 'invalid_token', status: 401});
    expect(always401.calls.filter((call) => call.url.endsWith('/v1/devices')).length).toBe(2);
  });

  test('an entry that cannot be reached: the same request goes to the backup, which is then remembered', async() => {
    const {api, calls, settings} = await setup((call) => {
      if(call.url.startsWith(MAIN)) throw new TypeError('Failed to fetch');
      return call.url.endsWith('/v1/devices') ? json(201, {token: 'tok-1'}) : json(200, {ok: true});
    });

    expect(await api.requestJSON({path: '/v1/me'})).toEqual({ok: true});
    expect(calls.map((call) => call.url)).toEqual([
      MAIN + '/v1/devices', BACKUP + '/v1/devices',
      // * the backup is in use now, and the main entry is asked for its health in the background
      MAIN + '/v1/health', BACKUP + '/v1/me'
    ]);
    expect(api.currentEndpoint).toBe(BACKUP);
    expect(settings.getString('api_endpoint')).toBe(BACKUP);
  });

  test('the main entry is taken back when its health check answers', async() => {
    let mainUp = false;
    const {api, settings} = await setup((call) => {
      if(call.url.startsWith(MAIN) && !mainUp) throw new TypeError('Failed to fetch');
      if(call.url.endsWith('/v1/health')) return json(200, {status: 'ok'});
      return call.url.endsWith('/v1/devices') ? json(201, {token: 'tok-1'}) : json(200, {});
    });

    await api.requestJSON({path: '/v1/me'});
    expect(api.currentEndpoint).toBe(BACKUP);
    mainUp = true;
    // * the probe of this start has been spent; a new page probes again
    const again = new LuckgramApi({endpoints: [MAIN, BACKUP], appVersion: '2.3', settings: settings as any, fetch: (async(url: any) => {
      return String(url).endsWith('/v1/health') ? json(200, {status: 'ok'}) : json(200, {});
    }) as any});
    await again.requestJSON({path: '/v1/me'});
    await settle();
    expect(again.currentEndpoint).toBe(MAIN);
    expect(settings.getString('api_endpoint')).toBe(MAIN);
  });

  test('an HTTP error is an answer: it never switches the entry', async() => {
    const {api, calls} = await setup((call) =>
      call.url.endsWith('/v1/devices') ? json(201, {token: 'tok-1'}) : json(503, {error: {code: 'upstream_unavailable'}}));

    await expect(api.requestJSON({path: '/v1/me'})).rejects.toMatchObject({code: 'upstream_unavailable', status: 503});
    expect(calls.every((call) => call.url.startsWith(MAIN))).toBe(true);
    expect(api.currentEndpoint).toBe(MAIN);
  });

  test('no entry can be reached: a network error', async() => {
    const {api, calls} = await setup(() => {
      throw new TypeError('Failed to fetch');
    });

    await expect(api.requestJSON({path: '/v1/me'})).rejects.toMatchObject({code: 'network_error'});
    expect(calls.map((call) => call.url)).toEqual([MAIN + '/v1/devices', BACKUP + '/v1/devices']);
  });

  test('errors by the server\'s code, with a text in both languages', () => {
    expect(errorFromResponse(429, '{"error":{"code":"quota_exceeded","retry_after_seconds":30}}')).toMatchObject({code: 'quota_exceeded', retryAfterSeconds: 30});
    expect(errorFromResponse(401, '{"error":{"code":"unauthorized"}}').code).toBe('invalid_token');
    expect(errorFromResponse(429, 'not json').code).toBe('rate_limited');
    expect(errorFromResponse(413, undefined).code).toBe('input_too_large');
    expect(errorFromResponse(502, '').code).toBe('upstream_unavailable');

    expect(errorMessage('quota_exceeded')[0]).toBe('今天的 AI 额度已用完，请明天再试。');
    expect(errorMessage('content_rejected')[0]).toBe('内容被 AI 服务拒绝。');
    expect(errorMessage('rate_limited')[0]).toBe('请求太频繁，请稍后再试。');
    expect(errorMessage('network_error')[0]).toBe('网络错误，请检查网络后重试。');
    expect(errorMessage('upstream_unavailable')[0]).toBe('AI 服务暂时不可用，请稍后再试。');
    expect(errorMessage('something_new')).toEqual(errorMessage('upstream_unavailable'));
    for(const code of ['quota_exceeded', 'content_rejected', 'rate_limited', 'network_error', 'consent_denied']) {
      expect(errorMessage(code)[1]).toMatch(/[a-z]/);
    }
  });
});

describe('luckgram AI client', () => {
  const sse = (chunks: string[]) => new Response(new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    }
  }), {status: 200, headers: {'Content-Type': 'text/event-stream; charset=utf-8'}});

  const setup = async(consent: boolean | 'agreed', chatResponse: () => Response) => {
    const urls: string[] = [];
    const bodies: any[] = [];
    const settings = new LuckgramSettingsStore(new LuckgramMemoryStorage(), null);
    await settings.ready;
    if(consent === 'agreed') await settings.set('ai_consent', true);
    const api = new LuckgramApi({endpoints: [MAIN], appVersion: '2.3', settings: settings as any, fetch: (async(url: any, init: any) => {
      urls.push(String(url));
      bodies.push(init.body);
      if(String(url).endsWith('/v1/devices')) return new Response('{"token":"tok"}', {status: 201});
      if(String(url).endsWith('/v1/me')) return new Response('{"tier":"free"}', {status: 200});
      return chatResponse();
    }) as any});
    const askConsent = vi.fn(async() => consent === true);
    return {ai: new LuckgramAI({api, askConsent, settings: settings as any}), urls, bodies, askConsent, settings};
  };

  test('declined: nothing is sent, not even the registration', async() => {
    const {ai, urls, askConsent, settings} = await setup(false, () => new Response('{"text":"hi"}'));
    await expect(ai.chat({messages: [{role: 'user', content: 'secret'}]})).rejects.toMatchObject({code: 'consent_denied'});
    await expect(ai.transcribe(new Blob(['x'], {type: 'audio/ogg'}))).rejects.toMatchObject({code: 'consent_denied'});
    await expect(ai.image('a cat')).rejects.toMatchObject({code: 'consent_denied'});
    expect(askConsent).toHaveBeenCalledTimes(3);
    expect(urls).toEqual([]);
    expect(settings.getBool('ai_consent', false)).toBe(false);
  });

  test('agreed: asked once, remembered, and can be withdrawn', async() => {
    const {ai, askConsent, settings} = await setup(true, () => new Response('{"text":"hi"}', {headers: {'Content-Type': 'application/json'}}));
    expect(await ai.chat({messages: [{role: 'user', content: 'hello'}]})).toBe('hi');
    expect(await ai.chat({messages: [{role: 'user', content: 'hello'}]})).toBe('hi');
    expect(askConsent).toHaveBeenCalledTimes(1);
    expect(settings.getBool('ai_consent', false)).toBe(true);

    await ai.revokeConsent();
    expect(ai.hasConsent()).toBe(false);
    await ai.chat({messages: [{role: 'user', content: 'hello'}]});
    expect(askConsent).toHaveBeenCalledTimes(2);
  });

  test('a streamed answer arrives piece by piece, whatever way the stream is cut', async() => {
    const {ai, bodies} = await setup('agreed', () => sse([
      'data: {"delta":"Hel', 'lo"}\n\ndata: {"delta":" there"}\n', '\ndata: {"done":true,"finish_reason":"stop"}\n\n'
    ]));

    const pieces: string[] = [];
    const text = await ai.chat({task: 'summary', messages: [{role: 'user', content: 'x'}], params: {to_lang: 'zh', task: 'hack', stream: false}, onDelta: (delta, soFar) => pieces.push(delta + '|' + soFar)});
    expect(text).toBe('Hello there');
    expect(pieces).toEqual(['Hello|Hello', ' there|Hello there']);
    // * extra parameters never replace the task, the messages or the stream flag
    expect(JSON.parse(bodies[bodies.length - 1])).toEqual({to_lang: 'zh', task: 'summary', messages: [{role: 'user', content: 'x'}], stream: true});
  });

  test('an error in the middle of a stream is the call\'s error', async() => {
    const {ai} = await setup('agreed', () => sse(['data: {"delta":"par"}\n\n', 'data: {"error":{"code":"content_rejected"}}\n\n']));
    await expect(ai.chat({messages: [{role: 'user', content: 'x'}], onDelta: () => {}})).rejects.toMatchObject({code: 'content_rejected'});
  });

  test('an HTTP error by its code', async() => {
    const {ai} = await setup('agreed', () => new Response('{"error":{"code":"quota_exceeded"}}', {status: 429}));
    await expect(ai.chat({messages: [{role: 'user', content: 'x'}]})).rejects.toMatchObject({code: 'quota_exceeded', status: 429});
  });

  test('transcription sends the audio file itself, with its type; other files are refused before sending', async() => {
    const {ai, urls, bodies} = await setup('agreed', () => new Response('{"text":"你好","language":"zh"}', {headers: {'Content-Type': 'application/json'}}));
    const audio = new Blob([new Uint8Array(10)], {type: 'audio/ogg; codecs=opus'});
    expect(await ai.transcribe(audio, {language: 'ZH'})).toEqual({text: '你好', language: 'zh'});
    expect(urls[urls.length - 1]).toBe(MAIN + '/v1/ai/transcribe?language=zh');
    expect(bodies[bodies.length - 1]).toBe(audio);

    const before = urls.length;
    await expect(ai.transcribe(new Blob(['x'], {type: 'video/mp4'}))).rejects.toMatchObject({code: 'invalid_request'});
    expect(urls.length).toBe(before);
  });

  test('the quota is asked without consent: nothing of the user\'s is sent', async() => {
    const {ai, askConsent} = await setup(false, () => new Response('{}'));
    expect(await ai.me()).toEqual({tier: 'free'});
    expect(askConsent).not.toHaveBeenCalled();
  });

  test('the stream parser: comments, CRLF, an event without its closing line', () => {
    const events: any[] = [];
    const parser = createSseParser((event) => events.push(event));
    parser.push(': ping\r\n\r\ndata: {"delta":"a"}\r\n\r\ndata: not json\n\ndata: [DONE]');
    parser.end();
    expect(events).toEqual([{delta: 'a'}, {done: true}]);
  });
});

describe('luckgram remote config', () => {
  const response = {
    version: 'v1', ttl: 3600,
    values: {'ai.transcribe_max_mb': 4, 'features.ai_summary.enabled': false, 'web.relays': ['wss://ws.luckgram.cc', 7], 'web.relay_media': false},
    features: {debug_demo: false, ai_summary: true}
  };

  test('the server\'s per-device result wins over the plain value; silence means allowed', () => {
    const config = parseRemoteConfig(response, 1000);
    expect(isFeatureAllowed(config, 'debug_demo')).toBe(false);
    expect(isFeatureAllowed(config, 'ai_summary')).toBe(true);
    expect(isFeatureAllowed(config, 'never_mentioned')).toBe(true);
    expect(isFeatureAllowed(parseRemoteConfig({values: {'features.x.enabled': false}}, 1), 'x')).toBe(false);
  });

  test('values with the built-in default of the same name', () => {
    const config = parseRemoteConfig(response, 1000);
    expect(getRemoteNumber(config, 'ai.transcribe_max_mb', 1)).toBe(4);
    expect(getRemoteNumber(config, 'missing', 9)).toBe(9);
    expect(getRemoteBool(config, 'web.relay_media', true)).toBe(false);
    expect(getRemoteStrings(config, 'web.relays')).toEqual(['wss://ws.luckgram.cc']);
    expect(getRemoteStrings(config, 'missing')).toBeUndefined();
  });

  test('survives storage, and nonsense reads as empty', () => {
    const config = parseRemoteConfig(response, 123456);
    expect(deserializeRemoteConfig(serializeRemoteConfig(config))).toEqual(config);
    expect(deserializeRemoteConfig('{broken').fetchedAt).toBe(0);
    expect(deserializeRemoteConfig(undefined).values).toEqual({});
    expect(parseRemoteConfig('nonsense', 1).features).toEqual({});
  });

  test('asked again every 6 hours, and not for 5 minutes after a failure', () => {
    const hour = 3600 * 1000;
    expect(REFRESH_INTERVAL_SECONDS).toBe(6 * 3600);
    expect(isRemoteConfigStale(10 * hour, 0, REFRESH_INTERVAL_SECONDS, 0)).toBe(true);
    expect(isRemoteConfigStale(10 * hour, 5 * hour, REFRESH_INTERVAL_SECONDS, 0)).toBe(false);
    expect(isRemoteConfigStale(11 * hour, 5 * hour, REFRESH_INTERVAL_SECONDS, 0)).toBe(true);
    expect(isRemoteConfigStale(11 * hour, 5 * hour, REFRESH_INTERVAL_SECONDS, 11 * hour - 60000)).toBe(false);
    expect(isRemoteConfigStale(11 * hour, 5 * hour, REFRESH_INTERVAL_SECONDS, 11 * hour - 6 * 60000)).toBe(true);
    // * the clock went backwards
    expect(isRemoteConfigStale(1 * hour, 5 * hour, REFRESH_INTERVAL_SECONDS, 0)).toBe(true);
  });
});

describe('luckgram announcements', () => {
  const response = {announcements: [
    {id: 'a', title: '维护通知', body: '今晚维护', url: 'https://luckgram.cc/x', ends_at: '2026-12-01T00:00:00Z'},
    {id: 'b', title: 'B', url: 'http://insecure.example'},
    {id: '', title: 'no id'}, {id: 'c'}, 'nonsense'
  ]};

  test('reads the server\'s list; only https links are kept', () => {
    const items = parseAnnouncements(response);
    expect(items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(items[0]).toMatchObject({title: '维护通知', body: '今晚维护', url: 'https://luckgram.cc/x', endsAtMs: Date.parse('2026-12-01T00:00:00Z')});
    expect(items[1].url).toBe('');
    expect(parseAnnouncements({})).toEqual([]);
  });

  test('shows the first that was not closed and has not ended', () => {
    const items = parseAnnouncements(response);
    const now = Date.parse('2026-11-12T00:00:00Z');
    expect(pickAnnouncement(items, [], now).id).toBe('a');
    expect(pickAnnouncement(items, ['a'], now).id).toBe('b');
    expect(pickAnnouncement(items, [], Date.parse('2026-12-02T00:00:00Z')).id).toBe('b');
    expect(pickAnnouncement(items, ['a', 'b'], now)).toBeUndefined();
  });

  test('a closed one stays closed; the list of them is bounded', () => {
    expect(dismissAnnouncement(['a', 'b'], 'a')).toEqual(['b', 'a']);
    let dismissed: string[] = [];
    for(let i = 0; i < MAX_DISMISSED + 10; ++i) dismissed = dismissAnnouncement(dismissed, 'id' + i);
    expect(dismissed.length).toBe(MAX_DISMISSED);
    expect(dismissed[dismissed.length - 1]).toBe('id' + (MAX_DISMISSED + 9));
    expect(parseDismissed('["a", 1, ""]')).toEqual(['a']);
    expect(parseDismissed('{broken')).toEqual([]);
  });

  test('asked at most every 30 minutes, and not for 5 after a failure', () => {
    const minute = 60000;
    expect(shouldRefreshAnnouncements(100 * minute, 0, 0)).toBe(true);
    expect(shouldRefreshAnnouncements(100 * minute, 80 * minute, 0)).toBe(false);
    expect(shouldRefreshAnnouncements(111 * minute, 80 * minute, 0)).toBe(true);
    expect(shouldRefreshAnnouncements(111 * minute, 80 * minute, 108 * minute)).toBe(false);
  });
});
