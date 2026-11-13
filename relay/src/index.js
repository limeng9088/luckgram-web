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
import {bridge} from './bridge.js';

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

export default {
  /**
   * @param {Request} request
   * @param {any} env
   * @param {any} ctx
   */
  async fetch(request, env, ctx) {
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

    // @ts-ignore WebSocketPair is the Workers runtime's
    const pair = new WebSocketPair();
    /** @type {any} */
    const client = pair[0];
    /** @type {any} */
    const server = pair[1];
    server.binaryType = 'arraybuffer';
    server.accept();

    // * the browser is answered now and Telegram is reached meanwhile (bridge.js, luckgram-specs#148)
    const bridged = bridge(server, async() => {
      try {
        const response = await fetch(target.upstream, {
          headers: {'Upgrade': 'websocket', 'Sec-WebSocket-Protocol': SUBPROTOCOL}
        });
        const upstream = /** @type {any} */ (response).webSocket;
        if(!upstream) console.error('relay: Telegram did not upgrade', 'dc' + target.dc, target.media ? 'media' : 'client', response.status);
        return upstream;
      } catch(err) {
        console.error('relay: Telegram is unreachable', 'dc' + target.dc, target.media ? 'media' : 'client', String(/** @type {any} */ (err)?.message || err));
        throw err;
      }
    }, {onFinish: (outcome, numbers) => count(env, target, outcome, numbers)});
    ctx.waitUntil(bridged);

    return new Response(null, {
      status: 101,
      headers: {'Sec-WebSocket-Protocol': SUBPROTOCOL},
      // @ts-ignore the Workers runtime's
      webSocket: client
    });
  }
};
