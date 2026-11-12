// Luckgram Web (luckgram-specs#138, W2): the relay's rules, the choice of a route, and the
// connection that tries the routes.

import EventListenerBase from '@helpers/eventListenerBase';
import {MTConnection, MTConnectionEvents} from '@lib/mtproto/transports/transport';
import {
  ATTEMPT_TIMEOUT, RouteConfig, getRouteCandidates, getStartDelays, normalizeRelays, parseOfficialUrl
} from '@/luckgram/relay/routes';
import {sanitizeRouteConfig} from '@/luckgram/relay/state';
import {applyRouteConfig, getGatePriority, getRouteTraffic, makeRoutedConnection, resetRouteState} from '@/luckgram/relay/routedSocket';
import {RELAY_DOWN_MS, RelayGate} from '@/luckgram/relay/gate';
import {describeRouteTraffic, formatBytes} from '@/luckgram/relay/traffic';
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
    resetRouteState();
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

  test('bytes are counted per route and kind of connection', async() => {
    const before = JSON.parse(JSON.stringify(getRouteTraffic()));
    const {connection} = await connect();
    byUrl('ws.luckgram.cc').open();
    connection.send(new Uint8Array(100));
    byUrl('ws.luckgram.cc').dispatchEvent('message', new ArrayBuffer(2000));
    // * a socket that lost the race is not counted
    byUrl('telegram.org').dispatchEvent('message', new ArrayBuffer(7));

    FakeSocket.all = [];
    applyRouteConfig(config({mode: 'official'}));
    await connect(MEDIA, '-D');
    FakeSocket.all[0].open();
    FakeSocket.all[0].dispatchEvent('message', new ArrayBuffer(5000));

    const after = getRouteTraffic();
    expect(after.relayClient.connections - before.relayClient.connections).toBe(1);
    expect(after.relayClient.up - before.relayClient.up).toBe(100);
    expect(after.relayClient.down - before.relayClient.down).toBe(2000);
    expect(after.officialMedia.down - before.officialMedia.down).toBe(5000);
    expect(after.officialClient.down - before.officialClient.down).toBe(0);

    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1048576)).toBe('5.00 MB');
    expect(describeRouteTraffic(after).split('\n').length).toBe(4);
  });

  // ---- luckgram-specs#146: a browser makes WebSocket handshakes to one address one after another

  test('one handshake at a time per relay: the others create their socket when their turn comes', async() => {
    applyRouteConfig(config({mode: 'relay', relays: [RELAY]}));
    const first = await connect();
    const second = await connect();
    const third = await connect();
    expect(FakeSocket.all.length).toBe(1);

    // * nothing times out while it waits for its turn, however long the handshakes ahead of it take
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT - 2000);
    FakeSocket.all[0].open();
    expect(first.events).toEqual(['open']);
    expect(FakeSocket.all.length).toBe(2);

    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT - 1000);
    expect(second.events).toEqual([]);
    expect(third.events).toEqual([]);
    FakeSocket.all[1].open();
    expect(second.events).toEqual(['open']);

    // * its own handshake gets the attempt's whole time, and no more
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT - 100);
    expect(third.events).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(third.events).toEqual(['close']);
  });

  test('the account on screen goes before the idle ones, messages before files', async() => {
    resetRouteState([1]);
    applyRouteConfig(config({mode: 'relay', relays: [RELAY]}));
    const RoutedOf = (account: number) => makeRoutedConnection(FakeSocket, account);
    const order: string[] = [];
    const start = async(name: string, account: number, url = OFFICIAL, suffix = '') => {
      const connection = new (RoutedOf(account))(2, url, suffix);
      connection.addEventListener('open', () => order.push(name));
      await vi.advanceTimersByTimeAsync(1);
      return connection;
    };

    await start('probe', undefined);
    await vi.advanceTimersByTimeAsync(500);
    await start('account 3', 3);
    await start('account 2', 2);
    await start('account 1 files', 1, MEDIA, '-D');
    await start('account 1', 1);
    await vi.advanceTimersByTimeAsync(500);

    for(let i = 0; i < 5; ++i) {
      FakeSocket.all[FakeSocket.all.length - 1].open();
      await vi.advanceTimersByTimeAsync(1);
    }

    expect(order).toEqual(['probe', 'account 1', 'account 1 files', 'account 3', 'account 2']);
    expect(getGatePriority(undefined, false, new Set([1]))).toBe(0);
    expect(getGatePriority(2, true, new Set([1]))).toBe(3);
    // * before any tab has said which account it shows, nobody is put behind
    expect(getGatePriority(2, false, new Set())).toBe(0);
  });

  test('a relay that has just failed is not tried by those who waited for it', async() => {
    applyRouteConfig(config({mode: 'relay', relays: [RELAY]}));
    const first = await connect();
    const second = await connect();
    const third = await connect();
    FakeSocket.all[0].close();
    await vi.advanceTimersByTimeAsync(1);

    // * each would otherwise have found out for itself, one timeout after another
    expect(FakeSocket.all.length).toBe(1);
    expect(first.events).toEqual(['close']);
    expect(second.events).toEqual(['close']);
    expect(third.events).toEqual(['close']);

    // * and it is tried again once that time has passed
    await vi.advanceTimersByTimeAsync(RELAY_DOWN_MS);
    FakeSocket.all = [];
    const later = await connect();
    FakeSocket.all[0].open();
    expect(later.events).toEqual(['open']);
  });

  test('a connection given up while it waits leaves the queue', async() => {
    applyRouteConfig(config({mode: 'relay', relays: [RELAY]}));
    await connect();
    const second = await connect();
    const third = await connect();
    second.connection.close();
    expect(second.events).toEqual(['close']);

    FakeSocket.all[0].open();
    expect(FakeSocket.all.length).toBe(2);
    FakeSocket.all[1].open();
    expect(third.events).toEqual(['open']);
  });

  test('the gate itself', () => {
    let now = 1000;
    const gate = new RelayGate(() => now);
    const log: string[] = [];
    const enter = (name: string, priority: number) => gate.enter('r', priority, (down) => log.push(name + (down ? ' down' : '')));

    const a = enter('a', 0);
    enter('b', 1);
    const c = enter('c', 0);
    const d = enter('d', 0);
    expect(log).toEqual(['a']);

    d.cancel();
    a.done(true);
    a.done(true);
    expect(log).toEqual(['a', 'c']);
    c.done(false);
    expect(log).toEqual(['a', 'c', 'b down']);
    expect(gate.isDown('r')).toBe(true);

    enter('e', 0);
    expect(log[log.length - 1]).toBe('e down');
    now += RELAY_DOWN_MS;
    const f = enter('f', 0);
    expect(log[log.length - 1]).toBe('f');

    // * given up in the middle of its handshake: the next one is let in, the relay is not blamed
    enter('g', 0);
    f.cancel();
    expect(log[log.length - 1]).toBe('g');
    expect(gate.isDown('r')).toBe(false);

    // * another relay has a turn of its own
    gate.enter('other', 0, () => log.push('other'));
    expect(log[log.length - 1]).toBe('other');
  });

  test('web.relay_media=false: a download goes to Telegram only', async() => {
    applyRouteConfig(config({relayMedia: false}));
    await connect(MEDIA, '-D');
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT - 1000);
    expect(FakeSocket.all.map((socket) => socket.url)).toEqual([MEDIA]);
  });
});
