// luckgram-specs#146: upstream's transport probe (controller.ts `pingTransports`) where Telegram
// cannot be reached over HTTPS and the WebSocket — a relay's — takes longer than 2 s to open.

import EventListenerBase from '@helpers/eventListenerBase';
import {chooseProbedTransport, LUCKGRAM_WEBSOCKET_PROBE_TIMEOUT} from '@/luckgram/relay/routes';

type FakeOptions = {httpsAnswers: boolean, webSocketOpensAfter?: number};
const state = vi.hoisted(() => ({options: undefined as any, created: [] as string[], destroyed: [] as string[]}));

vi.mock('@lib/mtproto/dcConfigurator', () => {
  class DcConfigurator {
    chooseServer(_dcId: number, _connectionType: string, transportType: string) {
      const options: FakeOptions = state.options;
      state.created.push(transportType);

      if(transportType === 'https') {
        return {
          _send: () => options.httpsAnswers ? Promise.resolve() : Promise.reject(new TypeError('Failed to fetch')),
          destroy: () => state.destroyed.push('https')
        };
      }

      const connection = new EventListenerBase<{open: () => void, close: () => void}>() as any;
      connection.close = () => connection.dispatchEvent('close');
      if(options.webSocketOpensAfter !== undefined) {
        setTimeout(() => connection.dispatchEvent('open'), options.webSocketOpensAfter);
      }

      return {
        connection,
        setAutoReconnect: () => {},
        destroy: () => state.destroyed.push('websocket')
      };
    }
  }

  return {DcConfigurator};
});

describe('luckgram: the transport probe (specs#146)', () => {
  const probe = async(options: FakeOptions) => {
    state.options = options;
    state.created = [];
    state.destroyed = [];
    const {MTTransportController} = await import('@lib/mtproto/transports/controller');
    return new MTTransportController();
  };

  const settled = async<T>(promise: Promise<T>) => {
    let result: T, done = false;
    promise.then((value) => {
      result = value;
      done = true;
    });
    return {get done() { return done; }, get result() { return result; }};
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('HTTPS does not answer and the WebSocket opens after 2.5 s: the WebSocket is there', async() => {
    const controller = await probe({httpsAnswers: false, webSocketOpensAfter: 2500});
    const result = await settled(controller.pingTransports());

    await vi.advanceTimersByTimeAsync(2400);
    expect(result.done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(result.done).toBe(true);
    expect(result.result).toEqual({https: false, websocket: true});
    expect(chooseProbedTransport(result.result)).toBe('websocket');
    expect(state.destroyed.sort()).toEqual(['https', 'websocket']);
  });

  test('HTTPS does not answer and the WebSocket never opens: given up after the long wait, and still not HTTPS', async() => {
    const controller = await probe({httpsAnswers: false});
    const result = await settled(controller.pingTransports());

    await vi.advanceTimersByTimeAsync(LUCKGRAM_WEBSOCKET_PROBE_TIMEOUT - 100);
    expect(result.done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(result.result).toEqual({https: false, websocket: false});
    // * upstream took HTTPS here and kept it: with neither there, the WebSocket is the one that will come
    expect(chooseProbedTransport(result.result)).toBe('websocket');
  });

  test('HTTPS answers: as upstream — the WebSocket gets 2 s, then HTTPS it is', async() => {
    const slow = await probe({httpsAnswers: true, webSocketOpensAfter: 2500});
    const slowResult = await settled(slow.pingTransports());
    await vi.advanceTimersByTimeAsync(1900);
    expect(slowResult.done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(slowResult.result).toEqual({https: true, websocket: false});
    expect(chooseProbedTransport(slowResult.result)).toBe('https');

    const fast = await probe({httpsAnswers: true, webSocketOpensAfter: 300});
    const fastResult = await settled(fast.pingTransports());
    await vi.advanceTimersByTimeAsync(400);
    expect(fastResult.result).toEqual({https: true, websocket: true});
    expect(chooseProbedTransport(fastResult.result)).toBe('websocket');
  });

  test('everyone who asks while a probe runs shares it: one WebSocket, not one each', async() => {
    const controller = await probe({httpsAnswers: false, webSocketOpensAfter: 2500});
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => settled(controller.pingTransports())));
    await vi.advanceTimersByTimeAsync(2600);

    expect(results.every((result) => result.done && result.result.websocket)).toBe(true);
    expect(state.created).toEqual(['https', 'websocket']);

    // * and the next one asks anew
    const again = await settled(controller.pingTransports());
    await vi.advanceTimersByTimeAsync(2600);
    expect(again.done).toBe(true);
    expect(state.created.length).toBe(4);
  });

  test('the transport after a probe', () => {
    expect(chooseProbedTransport({websocket: true, https: true})).toBe('websocket');
    expect(chooseProbedTransport({websocket: true, https: false})).toBe('websocket');
    expect(chooseProbedTransport({websocket: false, https: true})).toBe('https');
    expect(chooseProbedTransport({websocket: false, https: false})).toBe('websocket');
  });
});
