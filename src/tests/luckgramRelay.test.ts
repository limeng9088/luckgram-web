// Luckgram Web (luckgram-specs#138, W2): the relay's rules, the choice of a route, and the
// connection that tries the routes.

import EventListenerBase from '@helpers/eventListenerBase';
import {MTConnection, MTConnectionEvents} from '@lib/mtproto/transports/transport';
import {
  ATTEMPT_TIMEOUT, RouteConfig, getRouteCandidates, getStartDelays, normalizeRelays, parseOfficialUrl
} from '@/luckgram/relay/routes';
import {sanitizeRouteConfig} from '@/luckgram/relay/state';
import {applyRouteConfig, makeRoutedConnection} from '@/luckgram/relay/routedSocket';
import {allowedOrigins, decide, isOriginAllowed, parseRelayPath} from '../../relay/src/rules.js';
import {getLuckgramRelays} from '../../scripts/luckgram/vite-plugin.mjs';

const OFFICIAL = 'wss://kws2.web.telegram.org/apiws';
const MEDIA = 'wss://kws4-1.web.telegram.org/apiws_premium';
const RELAY = 'wss://ws.luckgram.cc';
const BACKUP = 'wss://lgws.cat158.com';

const config = (overrides: Partial<RouteConfig> = {}): RouteConfig => ({
  mode: 'auto', relays: [RELAY, BACKUP], relayMedia: true, ...overrides
});

describe('luckgram relay: the Worker\'s rules', () => {
  const allowed = allowedOrigins('');
  const request = (overrides: Partial<Parameters<typeof decide>[0]> = {}) => ({
    method: 'GET', pathname: '/2/apiws', upgrade: 'websocket', origin: 'https://web.luckgram.cc', ...overrides
  });

  test('forwards the addresses upstream uses, to the same DC and path at Telegram', () => {
    expect(parseRelayPath('/2/apiws')).toEqual({dc: 2, media: false, path: 'apiws', upstream: 'https://kws2.web.telegram.org/apiws'});
    expect(parseRelayPath('/4-1/apiws_premium').upstream).toBe('https://kws4-1.web.telegram.org/apiws_premium');
    expect(decide(request(), allowed)).toMatchObject({status: 101, target: {dc: 2}});
  });

  test('anything else is not found: DC 6, other paths, a host slipped into the path', () => {
    for(const pathname of ['/', '/6/apiws', '/0/apiws', '/2/apiws_test', '/2/foo', '/2-2/apiws', '/2/apiws/', '/2.evil.com/apiws', '//2/apiws', '/2/apiws%2f..']) {
      expect(parseRelayPath(pathname)).toBeUndefined();
      expect(decide(request({pathname}), allowed).status).toBe(404);
    }

    expect(decide(request({method: 'POST'}), allowed).status).toBe(404);
  });

  test('only Luckgram Web may use it', () => {
    for(const origin of ['https://web.luckgram.cc', 'https://web-dev.luckgram.cc', 'https://lgweb.cat158.com', 'https://feat-w2-relay.luckgram-web-dev.pages.dev']) {
      expect(isOriginAllowed(origin, allowed)).toBe(true);
    }

    for(const origin of [
      null, '', 'null', 'https://evil.example', 'http://web.luckgram.cc', 'https://web.luckgram.cc.evil.example',
      'https://evil.example/https://web.luckgram.cc', 'https://a.b.luckgram-web-dev.pages.dev', 'https://luckgram-web-dev.pages.dev.evil.example',
      'https://web.luckgram.cc:8443', 'http://localhost:8080'
    ]) {
      expect(isOriginAllowed(origin, allowed)).toBe(false);
      expect(decide(request({origin}), allowed).status).toBe(403);
    }

    expect(isOriginAllowed('http://localhost:8080', allowedOrigins('http://localhost:8080, http://localhost:8787'))).toBe(true);
  });

  test('a plain request to a relayed address is asked to upgrade', () => {
    expect(decide(request({upgrade: null}), allowed).status).toBe(426);
  });
});

describe('luckgram relay: the choice of a route', () => {
  test('reads Telegram\'s addresses, and only those the relay forwards', () => {
    expect(parseOfficialUrl(OFFICIAL)).toEqual({dc: 2, media: false, path: 'apiws'});
    expect(parseOfficialUrl(MEDIA)).toEqual({dc: 4, media: true, path: 'apiws_premium'});
    expect(parseOfficialUrl('wss://kws2.web.telegram.org/apiws_test')).toBeUndefined();
    expect(parseOfficialUrl('wss://kws6.web.telegram.org/apiws')).toBeUndefined();
  });

  test('automatic: Telegram\'s address, then the relays in order', () => {
    expect(getRouteCandidates(OFFICIAL, config()).map((c) => c.url)).toEqual([
      OFFICIAL, 'wss://ws.luckgram.cc/2/apiws', 'wss://lgws.cat158.com/2/apiws'
    ]);
    expect(getRouteCandidates(MEDIA, config())[1].url).toBe('wss://ws.luckgram.cc/4-1/apiws_premium');
  });

  test('what connected last time goes first', () => {
    expect(getRouteCandidates(OFFICIAL, config({preferred: BACKUP})).map((c) => c.id)).toEqual([BACKUP, 'official', RELAY]);
    expect(getRouteCandidates(OFFICIAL, config({preferred: 'wss://gone.example'})).map((c) => c.id)).toEqual(['official', RELAY, BACKUP]);
  });

  test('the modes', () => {
    expect(getRouteCandidates(OFFICIAL, config({mode: 'official'})).map((c) => c.id)).toEqual(['official']);
    expect(getRouteCandidates(OFFICIAL, config({mode: 'relay'})).map((c) => c.id)).toEqual([RELAY, BACKUP]);
    // * nothing to relay through: better Telegram's address than no connection
    expect(getRouteCandidates(OFFICIAL, config({mode: 'relay', relays: []})).map((c) => c.id)).toEqual(['official']);
  });

  test('web.relay_media=false keeps media connections off the relays, in every mode', () => {
    expect(getRouteCandidates(MEDIA, config({relayMedia: false})).map((c) => c.id)).toEqual(['official']);
    expect(getRouteCandidates(MEDIA, config({relayMedia: false, mode: 'relay'})).map((c) => c.id)).toEqual(['official']);
    expect(getRouteCandidates(OFFICIAL, config({relayMedia: false})).length).toBe(3);
  });

  test('a test server\'s address is never relayed', () => {
    expect(getRouteCandidates('wss://kws2.web.telegram.org/apiws_test', config({mode: 'relay'})).map((c) => c.id)).toEqual(['official']);
  });

  test('nothing remembered: the first two start together; something remembered: it gets a head start', () => {
    const candidates = getRouteCandidates(OFFICIAL, config());
    expect(getStartDelays(candidates, false)).toEqual([0, 0, 2500]);
    expect(getStartDelays(candidates, true)).toEqual([0, 2500, 5000]);
    expect(Math.max(...getStartDelays(candidates, true))).toBeLessThan(ATTEMPT_TIMEOUT);
  });

  test('relay addresses are normalized, and nonsense is dropped', () => {
    expect(normalizeRelays('ws.luckgram.cc, wss://LGWS.cat158.com/ ws://localhost:8787')).toEqual([RELAY, BACKUP, 'ws://localhost:8787']);
    expect(normalizeRelays(['https://ws.luckgram.cc', 'wss://ws.luckgram.cc/path', 'javascript:alert(1)', '', RELAY, RELAY])).toEqual([RELAY]);
    expect(sanitizeRouteConfig({mode: 'nonsense', relays: 'x', relayMedia: 'no', preferred: 1})).toMatchObject({mode: 'auto', relayMedia: true});
    expect(sanitizeRouteConfig({mode: 'relay', relays: [RELAY], relayMedia: false, preferred: RELAY})).toEqual({mode: 'relay', relays: [RELAY], relayMedia: false, preferred: RELAY});
  });

  test('the relays built into a build', () => {
    expect(getLuckgramRelays({LUCKGRAM_CHANNEL: 'prod'})).toEqual(['wss://ws.luckgram.cc', 'wss://lgws.cat158.com']);
    expect(getLuckgramRelays({LUCKGRAM_CHANNEL: 'dev'})).toEqual(['wss://ws-dev.luckgram.cc', 'wss://lgws.cat158.com']);
    expect(getLuckgramRelays({})).toEqual([]);
    expect(getLuckgramRelays({LUCKGRAM_RELAYS: 'ws://localhost:8787'})).toEqual(['ws://localhost:8787']);
  });
});

describe('luckgram relay: the connection that tries the routes', () => {
  class FakeSocket extends EventListenerBase<MTConnectionEvents> implements MTConnection {
    public static all: FakeSocket[] = [];
    public closed = false;
    public sent: Uint8Array[] = [];

    constructor(public dcId: number, public url: string, public logSuffix: string) {
      super();
      FakeSocket.all.push(this);
    }

    public open() {
      this.dispatchEvent('open');
    }

    public send = (body: Uint8Array) => {
      this.sent.push(body);
    };

    public close() {
      if(this.closed) return;
      this.closed = true;
      this.dispatchEvent('close');
    }
  }

  const Routed = makeRoutedConnection(FakeSocket);
  const byUrl = (part: string) => FakeSocket.all.find((socket) => socket.url.includes(part));

  const connect = async(url = OFFICIAL, logSuffix = '') => {
    const connection = new Routed(2, url, logSuffix);
    const events: string[] = [];
    connection.addEventListener('open', () => events.push('open'));
    connection.addEventListener('close', () => events.push('close'));
    connection.addEventListener('message', () => events.push('message'));
    await vi.advanceTimersByTimeAsync(500); // the settings: sent by the page, or the defaults after a moment
    return {connection, events};
  };

  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.all = [];
    applyRouteConfig(config());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('nothing remembered: Telegram and the first relay race, the faster one is the connection', async() => {
    const {connection, events} = await connect();
    expect(FakeSocket.all.map((socket) => socket.url)).toEqual([OFFICIAL, 'wss://ws.luckgram.cc/2/apiws']);

    byUrl('ws.luckgram.cc').open();
    expect(events).toEqual(['open']);
    expect(byUrl('telegram.org').closed).toBe(true);

    byUrl('ws.luckgram.cc').dispatchEvent('message', new ArrayBuffer(4));
    connection.send(new Uint8Array([1]));
    expect(events).toEqual(['open', 'message']);
    expect(byUrl('ws.luckgram.cc').sent.length).toBe(1);

    // * and no third address was started
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT);
    expect(FakeSocket.all.length).toBe(2);
    expect(events).toEqual(['open', 'message']);
  });

  test('the connection that opened is remembered and goes first, alone, the next time', async() => {
    (await connect()).connection;
    byUrl('ws.luckgram.cc').open();

    FakeSocket.all = [];
    await connect();
    expect(FakeSocket.all.map((socket) => socket.url)).toEqual(['wss://ws.luckgram.cc/2/apiws']);

    // * slow: the next address joins without waiting for it to fail
    await vi.advanceTimersByTimeAsync(2500);
    expect(FakeSocket.all.map((socket) => socket.url)).toEqual(['wss://ws.luckgram.cc/2/apiws', OFFICIAL]);
  });

  test('an address that fails hands over to the next at once', async() => {
    const {events} = await connect();
    byUrl('telegram.org').close();
    expect(FakeSocket.all.length).toBe(3);
    byUrl('ws.luckgram.cc').close();
    expect(events).toEqual([]);

    byUrl('lgws.cat158.com').open();
    expect(events).toEqual(['open']);
  });

  test('all fail: the connection closes, once', async() => {
    const {events} = await connect();
    byUrl('telegram.org').close();
    byUrl('ws.luckgram.cc').close();
    byUrl('lgws.cat158.com').close();
    expect(events).toEqual(['close']);
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT);
    expect(events).toEqual(['close']);
  });

  test('nothing answers: given up within the attempt\'s time, every socket closed', async() => {
    const {events} = await connect();
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT - 600);
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(events).toEqual(['close']);
    expect(FakeSocket.all.length).toBe(3);
    expect(FakeSocket.all.every((socket) => socket.closed)).toBe(true);
  });

  test('the open connection closing, from either side, closes it', async() => {
    const first = await connect();
    byUrl('telegram.org').open();
    byUrl('telegram.org').close();
    expect(first.events).toEqual(['open', 'close']);

    FakeSocket.all = [];
    const second = await connect();
    FakeSocket.all[0].open();
    second.connection.close();
    expect(second.events).toEqual(['open', 'close']);
    expect(FakeSocket.all[0].closed).toBe(true);
  });

  test('closed before anything opened: every socket is dropped, a late open is ignored', async() => {
    const {connection, events} = await connect();
    connection.close();
    expect(events).toEqual(['close']);
    expect(FakeSocket.all.every((socket) => socket.closed)).toBe(true);
  });

  test('"Telegram only" and "relay only"', async() => {
    applyRouteConfig(config({mode: 'official'}));
    await connect();
    expect(FakeSocket.all.map((socket) => socket.url)).toEqual([OFFICIAL]);

    FakeSocket.all = [];
    applyRouteConfig(config({mode: 'relay'}));
    await connect();
    expect(FakeSocket.all.map((socket) => socket.url)).toEqual(['wss://ws.luckgram.cc/2/apiws', 'wss://lgws.cat158.com/2/apiws']);
  });

  test('a change of the mode drops the open connection, so that it reconnects on an allowed route', async() => {
    const {events} = await connect();
    byUrl('telegram.org').open();
    applyRouteConfig(config({mode: 'relay'}));
    expect(events).toEqual(['open', 'close']);
  });

  test('web.relay_media=false: a download goes to Telegram only', async() => {
    applyRouteConfig(config({relayMedia: false}));
    await connect(MEDIA, '-D');
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT - 1000);
    expect(FakeSocket.all.map((socket) => socket.url)).toEqual([MEDIA]);
  });
});
