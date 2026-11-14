// Luckgram Web (luckgram-specs#138, W2): the relay's rules, the choice of a route, and the
// connection that tries the routes.

import EventListenerBase from '@helpers/eventListenerBase';
import {MTConnection, MTConnectionEvents} from '@lib/mtproto/transports/transport';
import {
  ATTEMPT_TIMEOUT, OFFICIAL_HEAD_START, RouteConfig, getRouteCandidates, getStartDelays, normalizeRelays, parseOfficialUrl
} from '@/luckgram/relay/routes';
import {sanitizeRouteConfig} from '@/luckgram/relay/state';
import {
  IDLE_HOLD, IDLE_HOLD_MAX, SILENT_WINDOW, SPARE_MS, applyRouteConfig, getGatePriority, getRouteTraffic, makeRoutedConnection, resetRouteState
} from '@/luckgram/relay/routedSocket';
import {RELAY_DOWN_MS, RELAY_SILENT_MS, RelayGate} from '@/luckgram/relay/gate';
import {describeRouteTraffic, formatBytes} from '@/luckgram/relay/traffic';
import {allowedOrigins, decide, isOriginAllowed, parseRelayPath} from '../../relay/src/rules.js';
import {CLOSE_PENDING_OVERFLOW, CLOSE_UPSTREAM_FAILED, UPSTREAM_TIMEOUT, bridge} from '../../relay/src/bridge.js';
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
    for(const origin of ['https://web.luckgram.cc', 'https://lgweb.cat158.com', 'https://3f2a1b0c.luckgram-web.pages.dev']) {
      expect(isOriginAllowed(origin, allowed)).toBe(true);
    }

    for(const origin of [
      null, '', 'null', 'https://evil.example', 'http://web.luckgram.cc', 'https://web.luckgram.cc.evil.example',
      'https://evil.example/https://web.luckgram.cc', 'https://a.b.luckgram-web.pages.dev', 'https://luckgram-web.pages.dev.evil.example',
      // * the development site and its previews are gone (specs#167)
      'https://web-dev.luckgram.cc', 'https://feat-w2-relay.luckgram-web-dev.pages.dev',
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

// ---- luckgram-specs#148: the Worker answers the browser before it has reached Telegram
describe('luckgram relay: the Worker\'s two sockets', () => {
  class FakeWebSocket extends EventTarget {
    public sent: any[] = [];
    public closedWith: number;
    public accepted = false;
    public binaryType = 'blob';

    public accept() {
      this.accepted = true;
    }

    public send(data: any) {
      if(this.closedWith !== undefined) throw new Error('closed');
      this.sent.push(data);
    }

    public close(code?: number) {
      this.closedWith ??= code;
    }

    public receive(data: any) {
      this.dispatchEvent(Object.assign(new Event('message'), {data}));
    }

    public hangUp(code: number) {
      this.dispatchEvent(Object.assign(new Event('close'), {code}));
    }
  }

  const bytes = (...values: number[]) => new Uint8Array(values).buffer;
  const setup = (connect: (upstream: FakeWebSocket) => Promise<any>, limit?: number) => {
    const server = new FakeWebSocket(), upstream = new FakeWebSocket();
    const finished: [string, {up: number, down: number, ms: number}][] = [];
    const settled = bridge(server, () => connect(upstream), {limit, onFinish: (outcome, numbers) => finished.push([outcome, numbers])});
    return {server, upstream, finished, settled};
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('what the browser sends before Telegram is reached is held, and passed on in order', async() => {
    let reached: (socket: FakeWebSocket) => void;
    const {server, upstream, finished, settled} = setup(() => new Promise((resolve) => reached = resolve));
    const first = bytes(1, 2, 3), second = bytes(4);
    server.receive(first);
    server.receive(second);
    await vi.advanceTimersByTimeAsync(1);
    expect(upstream.sent).toEqual([]);

    reached(upstream);
    await settled;
    expect(upstream.accepted).toBe(true);
    expect(upstream.binaryType).toBe('arraybuffer');
    expect(upstream.sent).toEqual([first, second]);

    // * from here on frames go both ways as they are
    const third = bytes(5, 6), answer = bytes(7, 8, 9, 10);
    server.receive(third);
    upstream.receive(answer);
    expect(upstream.sent[2]).toBe(third);
    expect(server.sent).toEqual([answer]);

    // * the wait for Telegram is over: nothing is closed when its time passes
    await vi.advanceTimersByTimeAsync(UPSTREAM_TIMEOUT * 2);
    expect(finished).toEqual([]);

    upstream.hangUp(1000);
    expect(server.closedWith).toBe(1000);
    expect(finished).toEqual([['closed', {up: 6, down: 4, ms: expect.any(Number)}]]);
  });

  test('Telegram cannot be reached after the browser was answered: its socket is closed with 4502, nothing passed on', async() => {
    const unreachable = setup(() => Promise.reject(new Error('connect failed')));
    unreachable.server.receive(bytes(1));
    await unreachable.settled;
    expect(unreachable.server.closedWith).toBe(CLOSE_UPSTREAM_FAILED);
    expect(unreachable.finished.map(([outcome]) => outcome)).toEqual(['upstream_unreachable']);
    expect(unreachable.upstream.sent).toEqual([]);

    const refused = setup(() => Promise.resolve(undefined));
    await refused.settled;
    expect(refused.server.closedWith).toBe(CLOSE_UPSTREAM_FAILED);
    expect(refused.finished.map(([outcome]) => outcome)).toEqual(['upstream_refused']);
  });

  test('Telegram does not answer in time: closed with 4502; a socket that comes later is closed too', async() => {
    let reached: (socket: FakeWebSocket) => void;
    const {server, upstream, finished, settled} = setup(() => new Promise((resolve) => reached = resolve));
    server.receive(bytes(1));
    await vi.advanceTimersByTimeAsync(UPSTREAM_TIMEOUT - 1);
    expect(server.closedWith).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(server.closedWith).toBe(CLOSE_UPSTREAM_FAILED);
    expect(finished.map(([outcome]) => outcome)).toEqual(['upstream_timeout']);

    reached(upstream);
    await settled;
    expect(upstream.closedWith).toBe(1000);
    expect(upstream.sent).toEqual([]);
    expect(finished.length).toBe(1);
  });

  test('the browser leaves before Telegram is reached: Telegram\'s socket is closed, nothing passed on', async() => {
    let reached: (socket: FakeWebSocket) => void;
    const {server, upstream, finished, settled} = setup(() => new Promise((resolve) => reached = resolve));
    server.receive(bytes(1, 2));
    server.hangUp(1001);
    await vi.advanceTimersByTimeAsync(1);
    reached(upstream);
    await settled;
    expect(upstream.closedWith).toBe(1000);
    expect(upstream.sent).toEqual([]);
    expect(finished).toEqual([['closed', {up: 2, down: 0, ms: expect.any(Number)}]]);
  });

  test('no more is held than the limit', async() => {
    const {server, upstream, finished} = setup(() => new Promise(() => {}), 8);
    server.receive(bytes(1, 2, 3, 4, 5));
    expect(server.closedWith).toBeUndefined();
    server.receive(bytes(6, 7, 8, 9));
    expect(server.closedWith).toBe(CLOSE_PENDING_OVERFLOW);
    expect(finished.map(([outcome]) => outcome)).toEqual(['pending_overflow']);
    expect(upstream.sent).toEqual([]);
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

  test('nothing remembered: Telegram first, the relays after a moment; something remembered: it gets a head start', () => {
    const candidates = getRouteCandidates(OFFICIAL, config());
    // * a relay answers the handshake before it has reached Telegram: in an even race it would always win (specs#148)
    expect(getStartDelays(candidates, false)).toEqual([0, OFFICIAL_HEAD_START, OFFICIAL_HEAD_START + 2500]);
    expect(Math.max(...getStartDelays(candidates, false))).toBeLessThan(ATTEMPT_TIMEOUT);
    // * relays only: nothing to hold them back for
    expect(getStartDelays(getRouteCandidates(OFFICIAL, config({mode: 'relay'})), false)).toEqual([0, 0]);
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

  test('nothing remembered: Telegram\'s address alone for a moment, then the first relay joins and the faster one is the connection', async() => {
    const {connection, events} = await connect();
    expect(FakeSocket.all.map((socket) => socket.url)).toEqual([OFFICIAL]);
    await vi.advanceTimersByTimeAsync(OFFICIAL_HEAD_START - 600);
    expect(FakeSocket.all.length).toBe(1);
    await vi.advanceTimersByTimeAsync(600);
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

  test('Telegram\'s address opens within its moment: no relay is contacted at all', async() => {
    const {events} = await connect();
    byUrl('telegram.org').open();
    expect(events).toEqual(['open']);
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT);
    expect(FakeSocket.all.map((socket) => socket.url)).toEqual([OFFICIAL]);
  });

  test('the connection that opened is remembered and goes first, alone, the next time', async() => {
    (await connect()).connection;
    await vi.advanceTimersByTimeAsync(OFFICIAL_HEAD_START);
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
    // * Telegram's address fails: the relay does not wait for its moment
    byUrl('telegram.org').close();
    expect(FakeSocket.all.length).toBe(2);
    byUrl('ws.luckgram.cc').close();
    expect(FakeSocket.all.length).toBe(3);
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
    await vi.advanceTimersByTimeAsync(OFFICIAL_HEAD_START);
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

    for(let i = 0; i < 3; ++i) {
      FakeSocket.all[FakeSocket.all.length - 1].open();
      await vi.advanceTimersByTimeAsync(1);
    }

    // * the idle slots keep away for a while after the account on screen last connected (luckgram-specs#148):
    // * a connection it starts in that time finds the relay free
    expect(order).toEqual(['probe', 'account 1', 'account 1 files']);
    expect(FakeSocket.all.length).toBe(3);
    await vi.advanceTimersByTimeAsync(IDLE_HOLD - 1000);
    await start('account 1 again', 1, 'wss://kws4.web.telegram.org/apiws');
    expect(FakeSocket.all.length).toBe(4);
    FakeSocket.all[3].open();

    // * …and that moves their wait along, though not for ever
    await vi.advanceTimersByTimeAsync(IDLE_HOLD - 1);
    expect(FakeSocket.all.length).toBe(4);
    await vi.advanceTimersByTimeAsync(1);
    for(let i = 0; i < 2; ++i) {
      FakeSocket.all[FakeSocket.all.length - 1].open();
      await vi.advanceTimersByTimeAsync(1);
    }

    expect(order).toEqual(['probe', 'account 1', 'account 1 files', 'account 1 again', 'account 3', 'account 2']);
    expect(getGatePriority(undefined, false, new Set([1]))).toBe(0);
    expect(getGatePriority(2, true, new Set([1]))).toBe(3);
    // * before any tab has said which account it shows, nobody is put behind
    expect(getGatePriority(2, false, new Set())).toBe(0);
  });

  test('an idle slot does not wait for the account on screen longer than the limit, and its attempt\'s time does not run meanwhile', async() => {
    resetRouteState([1]);
    applyRouteConfig(config({mode: 'relay', relays: [RELAY]}));
    const user = makeRoutedConnection(FakeSocket, 1), idle = makeRoutedConnection(FakeSocket, 2);
    const events: string[] = [];

    new user(2, OFFICIAL, '');
    await vi.advanceTimersByTimeAsync(500);
    FakeSocket.all[0].open();
    const waiting = new idle(2, OFFICIAL, '');
    waiting.addEventListener('open', () => events.push('open'));
    waiting.addEventListener('close', () => events.push('close'));

    // * the account on screen keeps opening connections
    for(let elapsed = 0; elapsed < IDLE_HOLD_MAX - 2000; elapsed += 2000) {
      await vi.advanceTimersByTimeAsync(2000);
      new user(2, OFFICIAL, '');
      await vi.advanceTimersByTimeAsync(0);
      FakeSocket.all[FakeSocket.all.length - 1].open();
    }

    const before = FakeSocket.all.length;
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(FakeSocket.all.length).toBe(before + 1);
    FakeSocket.all[before].open();
    expect(events).toEqual(['open']);
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

  // ---- luckgram-specs#148: the probe's connection is kept for the first connection that needs one

  describe('the probe\'s connection', () => {
    const Probe = makeRoutedConnection(FakeSocket, undefined, true);
    const RoutedOf = (account: number) => makeRoutedConnection(FakeSocket, account);

    const probe = async(url = OFFICIAL) => {
      const connection = new Probe(2, url, '');
      const events: string[] = [];
      connection.addEventListener('open', () => events.push('open'));
      connection.addEventListener('close', () => events.push('close'));
      await vi.advanceTimersByTimeAsync(500);
      return {connection, events};
    };

    const start = async(account: number, url = OFFICIAL, suffix = '') => {
      const connection = new (RoutedOf(account))(2, url, suffix);
      const events: string[] = [];
      connection.addEventListener('open', () => events.push('open'));
      connection.addEventListener('close', () => events.push('close'));
      connection.addEventListener('message', () => events.push('message'));
      await vi.advanceTimersByTimeAsync(1);
      return {connection, events};
    };

    beforeEach(() => {
      resetRouteState([1]);
      applyRouteConfig(config({mode: 'relay', relays: [RELAY]}));
    });

    test('is taken over by the connection of the account on screen: no second handshake, and nothing was sent over it before', async() => {
      const probed = await probe();
      const socket = FakeSocket.all[0];
      socket.open();
      // * upstream's transport sends the first packet of its session as the socket opens: the probe's stays here
      probed.connection.send(new Uint8Array(64));
      probed.connection.close();
      expect(probed.events).toEqual(['open', 'close']);
      expect(socket.closed).toBe(false);
      expect(socket.sent).toEqual([]);

      // * an idle slot comes first: the spare is not for it
      const idle = await start(2);
      expect(idle.events).toEqual([]);

      const user = await start(1);
      expect(FakeSocket.all.length).toBe(1);
      expect(user.events).toEqual(['open']);

      const packet = new Uint8Array([1, 2, 3]);
      user.connection.send(packet);
      expect(socket.sent).toEqual([packet]);
      socket.dispatchEvent('message', new ArrayBuffer(8));
      expect(user.events).toEqual(['open', 'message']);

      // * it is the user's connection now, not a spare: it outlives the time a spare is kept, and closes with it
      await vi.advanceTimersByTimeAsync(SPARE_MS * 2);
      expect(socket.closed).toBe(false);
      // * (the idle slot has made a connection of its own meanwhile)
      expect(FakeSocket.all.length).toBe(2);
      expect(idle.events).toEqual([]);
      user.connection.close();
      expect(socket.closed).toBe(true);
      expect(user.events).toEqual(['open', 'message', 'close']);
    });

    test('a connection already waiting for its turn at the relay takes it the moment the probe is done', async() => {
      const probed = await probe();
      const user = await start(1);
      const other = await start(1);
      expect(FakeSocket.all.length).toBe(1);

      FakeSocket.all[0].open();
      // * the probe's handshake is over, so the first in line has started its own
      expect(FakeSocket.all.length).toBe(2);
      probed.connection.close();
      expect(user.events).toEqual(['open']);
      // * its own handshake is given up, and the next in line gets the turn
      expect(FakeSocket.all[1].closed).toBe(true);
      expect(FakeSocket.all.length).toBe(3);
      expect(other.events).toEqual([]);
      FakeSocket.all[2].open();
      expect(other.events).toEqual(['open']);
    });

    test('nobody takes it: closed after a moment', async() => {
      const probed = await probe();
      FakeSocket.all[0].open();
      probed.connection.close();
      await vi.advanceTimersByTimeAsync(SPARE_MS - 1);
      expect(FakeSocket.all[0].closed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeSocket.all[0].closed).toBe(true);

      const user = await start(1);
      expect(FakeSocket.all.length).toBe(2);
      expect(user.events).toEqual([]);
    });

    test('not for another address, not for a route the mode no longer allows, not once it has closed', async() => {
      let probed = await probe();
      FakeSocket.all[0].open();
      probed.connection.close();
      // * a file connection, another DC
      await start(1, MEDIA, '-D');
      await start(1, 'wss://kws4.web.telegram.org/apiws');
      expect(FakeSocket.all.length).toBe(2); // the second waits for its turn at the relay
      expect(FakeSocket.all[0].sent).toEqual([]);

      // * the mode changes: the spare is on a relay, and is dropped
      applyRouteConfig(config({mode: 'official'}));
      expect(FakeSocket.all[0].closed).toBe(true);

      FakeSocket.all = [];
      resetRouteState([1]);
      applyRouteConfig(config({mode: 'relay', relays: [RELAY]}));
      probed = await probe();
      FakeSocket.all[0].open();
      probed.connection.close();
      FakeSocket.all[0].close(); // the server hung up meanwhile: a relay that did not reach Telegram
      const user = await start(1);
      expect(FakeSocket.all.length).toBe(1);
      expect(user.events).toEqual(['close']);
    });

    test('a probe that never opened leaves nothing behind', async() => {
      const probed = await probe();
      probed.connection.close();
      expect(probed.events).toEqual(['close']);
      expect(FakeSocket.all[0].closed).toBe(true);
      const user = await start(1);
      expect(user.events).toEqual([]);
      expect(FakeSocket.all.length).toBe(2);
    });
  });

  // ---- luckgram-specs#148: a relay that answers before it has reached Telegram

  describe('a relay that opens and hangs up with nothing from Telegram', () => {
    test('is not tried again for a while: the next attempt goes to the next route, although its handshake would succeed', async() => {
      applyRouteConfig(config({mode: 'relay'}));
      const first = await connect();
      byUrl('ws.luckgram.cc').open();
      first.connection.send(new Uint8Array(64));
      byUrl('ws.luckgram.cc').close(); // 4502 from the Worker: Telegram was not reached
      expect(first.events).toEqual(['open', 'close']);

      // * the transport above reconnects at once: the relay that was remembered is passed over
      FakeSocket.all = [];
      const second = await connect();
      expect(FakeSocket.all.map((socket) => socket.url)).toEqual(['wss://lgws.cat158.com/2/apiws']);
      FakeSocket.all[0].open();
      FakeSocket.all[0].dispatchEvent('message', new ArrayBuffer(8));
      expect(second.events).toEqual(['open', 'message']);

      // * and after a while it gets its chance again
      await vi.advanceTimersByTimeAsync(RELAY_SILENT_MS);
      FakeSocket.all = [];
      await connect();
      await vi.advanceTimersByTimeAsync(2500);
      expect(FakeSocket.all.map((socket) => socket.url)).toEqual(['wss://lgws.cat158.com/2/apiws', 'wss://ws.luckgram.cc/2/apiws']);
    });

    test('every relay does it: the connection closes as when nothing works, and the page is told', async() => {
      applyRouteConfig(config({mode: 'relay'}));
      for(const host of ['ws.luckgram.cc', 'lgws.cat158.com']) {
        FakeSocket.all = [];
        const {events} = await connect();
        byUrl(host).open();
        byUrl(host).close();
        expect(events).toEqual(['open', 'close']);
      }

      FakeSocket.all = [];
      const {events} = await connect();
      expect(FakeSocket.all).toEqual([]);
      expect(events).toEqual(['close']);
    });

    test('not when we closed it, not after something was received, not long after it opened', async() => {
      applyRouteConfig(config({mode: 'relay', relays: [RELAY]}));
      const again = async() => {
        FakeSocket.all = [];
        await connect();
        return FakeSocket.all.length;
      };

      const {connection} = await connect();
      FakeSocket.all[0].open();
      connection.close();
      expect(await again()).toBe(1);

      FakeSocket.all[0].open();
      FakeSocket.all[0].dispatchEvent('message', new ArrayBuffer(8));
      FakeSocket.all[0].close();
      expect(await again()).toBe(1);

      FakeSocket.all[0].open();
      await vi.advanceTimersByTimeAsync(SILENT_WINDOW);
      FakeSocket.all[0].close();
      expect(await again()).toBe(1);

      // * and the one that counts
      FakeSocket.all[0].open();
      FakeSocket.all[0].close();
      expect(await again()).toBe(0);
    });

    test('the gate: a handshake that succeeds does not lift it, bytes from Telegram do', () => {
      let now = 1000;
      const gate = new RelayGate(() => now);
      const log: string[] = [];
      const enter = (name: string) => gate.enter('r', 0, (down) => log.push(name + (down ? ' down' : '')));

      const a = enter('a');
      gate.silent('r');
      a.done(true);
      expect(gate.isDown('r')).toBe(true);
      enter('b');
      expect(log).toEqual(['a', 'b down']);

      gate.heard('r');
      expect(gate.isDown('r')).toBe(false);

      gate.silent('r');
      now += RELAY_SILENT_MS;
      expect(gate.isDown('r')).toBe(false);
    });
  });

  test('web.relay_media=false: a download goes to Telegram only', async() => {
    applyRouteConfig(config({relayMedia: false}));
    await connect(MEDIA, '-D');
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT - 1000);
    expect(FakeSocket.all.map((socket) => socket.url)).toEqual([MEDIA]);
  });
});

describe('luckgram relay: the page\'s settings', () => {
  beforeEach(() => localStorage.clear());

  // * the module reads the settings as it loads: importing it must not throw (it once did, in a built bundle only)
  test('the settings as stored, before and after the server has spoken', async() => {
    const {readRouteConfig, initRoutePage, routeStatus} = await import('@/luckgram/relay/page');
    expect(routeStatus().mode).toBe('auto');
    expect(readRouteConfig()).toMatchObject({mode: 'auto', relayMedia: true});

    localStorage.setItem('lg_route_mode', 'relay');
    localStorage.setItem('lg_route_preferred', RELAY);
    expect(readRouteConfig()).toMatchObject({mode: 'relay', preferred: RELAY});

    let relays = [BACKUP], relayMedia = true;
    initRoutePage({relays: () => relays, relayMedia: () => relayMedia});
    expect(readRouteConfig().relays).toEqual([BACKUP]);
    relayMedia = false;
    expect(readRouteConfig().relayMedia).toBe(false);

    // * nothing from the server: the build's list stays; a list set by hand wins over both
    relays = undefined;
    expect(readRouteConfig().relays).toEqual([]);
    localStorage.setItem('lg_relays', 'ws.luckgram.cc');
    expect(readRouteConfig().relays).toEqual([RELAY]);
  });
});
