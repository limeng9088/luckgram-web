// @ts-check
/**
 * Luckgram Web relay (luckgram-specs#148) — the two sockets of one relayed connection, with nothing
 * of the Workers runtime in it, so it is tested in Node (src/tests/luckgramRelay.test.ts).
 *
 * The browser is answered before Telegram is reached: what it sends meanwhile is held and passed
 * on, in order, once Telegram's socket is there. The browser then waits for one network path
 * instead of two before it may send, and its next handshake to the relay may start that much
 * sooner (a browser makes them one at a time).
 *
 * If Telegram cannot be reached the browser's socket, already open, is closed with
 * CLOSE_UPSTREAM_FAILED and nothing was passed on; Luckgram Web takes a relay that opens and hangs
 * up with nothing received for a route that does not work (src/luckgram/relay/routedSocket.ts).
 */

/** Telegram could not be reached, refused the WebSocket, or took longer than UPSTREAM_TIMEOUT. */
export const CLOSE_UPSTREAM_FAILED = 4502;
/** More was sent before Telegram's socket was there than is held. */
export const CLOSE_PENDING_OVERFLOW = 4413;
/** Bytes held for one connection while Telegram is being reached: a few upload parts (512 KiB each). */
export const PENDING_LIMIT = 4 * 1024 * 1024;
/** How long Telegram may take to answer; under the 8 s Luckgram Web gives a connection attempt. */
export const UPSTREAM_TIMEOUT = 6000;

/** @param {number} [code] */
const closeCode = (code) => (code === 1000 || (code && code >= 3000 && code <= 4999) ? code : 1000);

/** @param {any} data */
const size = (data) => typeof(data) === 'string' ? data.length : (data.byteLength ?? data.size ?? 0);

/**
 * @param {any} server the Worker's end of the browser's socket, accepted
 * @param {() => Promise<any>} connect gives Telegram's socket, not accepted yet; nothing, or a rejection, when there is none
 * @param {{
 *   onFinish?: (outcome: string, numbers: {up: number, down: number, ms: number}) => void,
 *   limit?: number,
 *   timeout?: number
 * }} [options]
 * @returns {Promise<void>} settles when Telegram's socket is there or is known not to come
 */
export function bridge(server, connect, options = {}) {
  const {onFinish = () => {}, limit = PENDING_LIMIT, timeout = UPSTREAM_TIMEOUT} = options;
  const started = Date.now();
  /** @type {any} */
  let upstream;
  /** @type {any[]} */
  let pending = [];
  let pendingBytes = 0, up = 0, down = 0, done = false;

  /**
   * @param {string} outcome
   * @param {number} [code]
   */
  const finish = (outcome, code) => {
    if(done) return;
    done = true;
    clearTimeout(timer);
    pending = [];
    try { server.close(closeCode(code)); } catch(err) {}
    try { upstream?.close(closeCode(code)); } catch(err) {}
    onFinish(outcome, {up, down, ms: Date.now() - started});
  };

  const timer = setTimeout(() => finish('upstream_timeout', CLOSE_UPSTREAM_FAILED), timeout);

  server.addEventListener('message', (/** @type {any} */ event) => {
    if(done) return;
    const bytes = size(event.data);
    up += bytes;

    if(upstream) {
      try { upstream.send(event.data); } catch(err) { finish('error'); }
      return;
    }

    pendingBytes += bytes;
    if(pendingBytes > limit) finish('pending_overflow', CLOSE_PENDING_OVERFLOW);
    else pending.push(event.data);
  });
  server.addEventListener('close', (/** @type {any} */ event) => finish('closed', event.code));
  server.addEventListener('error', () => finish('error'));

  return Promise.resolve().then(connect).then((socket) => {
    if(!socket) {
      finish('upstream_refused', CLOSE_UPSTREAM_FAILED);
      return;
    }

    // * frames are handed over as ArrayBuffers and sent on as they are; without this a runtime whose default
    // * is 'blob' (the standard's) gives Blobs, which the other socket cannot send
    socket.binaryType = 'arraybuffer';
    socket.accept();

    if(done) {
      // * the browser left, or the wait was over, before Telegram answered
      try { socket.close(1000); } catch(err) {}
      return;
    }

    clearTimeout(timer);
    upstream = socket;
    upstream.addEventListener('message', (/** @type {any} */ event) => {
      if(done) return;
      down += size(event.data);
      try { server.send(event.data); } catch(err) { finish('error'); }
    });
    upstream.addEventListener('close', (/** @type {any} */ event) => finish('closed', event.code));
    upstream.addEventListener('error', () => finish('error'));

    const held = pending;
    pending = [];
    try {
      for(const data of held) upstream.send(data);
    } catch(err) {
      finish('error');
    }
  }, () => finish('upstream_unreachable', CLOSE_UPSTREAM_FAILED));
}
