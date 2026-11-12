// @ts-check
/**
 * Luckgram Web relay (luckgram-specs#138, W2) — a Cloudflare Worker that lets Luckgram Web reach
 * Telegram where *.web.telegram.org cannot be reached.
 *
 * It forwards WebSocket connections and nothing else: binary frames go both ways as they are —
 * MTProto ciphertext the relay cannot read — and nothing of them is parsed, cached or logged.
 * No IP address is read or logged. What is kept is counts: connections, bytes, errors
 * (Workers Analytics Engine, binding STATS, when the deployment has it).
 */

import {allowedOrigins, decide} from './rules.js';

const SUBPROTOCOL = 'binary';

/**
 * @param {any} env
 * @param {{dc: number, media: boolean}} target
 * @param {string} outcome
 * @param {{up?: number, down?: number, ms?: number}} [numbers]
 */
function count(env, target, outcome, numbers = {}) {
  try {
    env.STATS?.writeDataPoint({
      indexes: [outcome],
      blobs: [outcome, 'dc' + target.dc, target.media ? 'media' : 'client'],
      doubles: [1, numbers.up || 0, numbers.down || 0, numbers.ms || 0]
    });
  } catch(err) {}
}

/** @param {number} [code] */
const closeCode = (code) => (code === 1000 || (code && code >= 3000 && code <= 4999) ? code : 1000);

export default {
  /**
   * @param {Request} request
   * @param {any} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    const decision = decide({
      method: request.method,
      pathname: url.pathname,
      upgrade: request.headers.get('Upgrade'),
      origin: request.headers.get('Origin')
    }, allowedOrigins(env.ALLOWED_ORIGINS));

    if(decision.status !== 101) {
      return new Response(null, {status: decision.status, headers: decision.status === 426 ? {Upgrade: 'websocket'} : {}});
    }

    const {target} = decision;

    /** @type {any} */
    let upstream;
    try {
      const response = await fetch(target.upstream, {
        headers: {'Upgrade': 'websocket', 'Sec-WebSocket-Protocol': SUBPROTOCOL}
      });
      upstream = /** @type {any} */ (response).webSocket;
      if(!upstream) {
        console.error('relay: Telegram did not upgrade', 'dc' + target.dc, target.media ? 'media' : 'client', response.status);
        count(env, target, 'upstream_refused');
        return new Response(null, {status: 502});
      }
    } catch(err) {
      console.error('relay: Telegram is unreachable', 'dc' + target.dc, target.media ? 'media' : 'client', String(/** @type {any} */ (err)?.message || err));
      count(env, target, 'upstream_unreachable');
      return new Response(null, {status: 502});
    }

    // @ts-ignore WebSocketPair is the Workers runtime's
    const pair = new WebSocketPair();
    /** @type {any} */
    const client = pair[0];
    /** @type {any} */
    const server = pair[1];
    // * frames are handed over as ArrayBuffers and sent on as they are; without this a runtime whose default
    // * is 'blob' (the standard's) gives Blobs, which the other socket cannot send
    server.binaryType = 'arraybuffer';
    upstream.binaryType = 'arraybuffer';
    server.accept();
    upstream.accept();

    const started = Date.now();
    let up = 0, down = 0, done = false;

    /**
     * @param {string} outcome
     * @param {number} [code]
     */
    const finish = (outcome, code) => {
      if(done) return;
      done = true;
      try { server.close(closeCode(code)); } catch(err) {}
      try { upstream.close(closeCode(code)); } catch(err) {}
      count(env, target, outcome, {up, down, ms: Date.now() - started});
    };

    /** @param {any} data */
    const size = (data) => typeof(data) === 'string' ? data.length : (data.byteLength ?? data.size ?? 0);

    server.addEventListener('message', (/** @type {any} */ event) => {
      up += size(event.data);
      try { upstream.send(event.data); } catch(err) { finish('error'); }
    });
    upstream.addEventListener('message', (/** @type {any} */ event) => {
      down += size(event.data);
      try { server.send(event.data); } catch(err) { finish('error'); }
    });
    server.addEventListener('close', (/** @type {any} */ event) => finish('closed', event.code));
    upstream.addEventListener('close', (/** @type {any} */ event) => finish('closed', event.code));
    server.addEventListener('error', () => finish('error'));
    upstream.addEventListener('error', () => finish('error'));

    return new Response(null, {
      status: 101,
      headers: {'Sec-WebSocket-Protocol': SUBPROTOCOL},
      // @ts-ignore the Workers runtime's
      webSocket: client
    });
  }
};
