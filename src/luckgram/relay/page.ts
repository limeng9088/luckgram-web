/*
 * Luckgram Web (luckgram-specs#138, W2): the page's side of the route — it keeps the settings,
 * hands them to the connections (state.ts), remembers what connected, and says so when nothing does.
 *
 * Until the Luckgram settings and remote config are there (W3) the settings live in localStorage
 * and are changed from Settings → Experimental (connectionSection.tsx):
 *   lg_route_mode       auto | official | relay
 *   lg_route_preferred  what connected last time
 *   lg_relays           relays instead of the build's (testing)            — later remote config web.relays
 *   lg_relay_media      "0": media connections never use a relay (testing) — later remote config web.relay_media
 */

import {createSignal} from 'solid-js';
import {RouteConfig, RouteMode, isRouteMode, normalizeRelays} from '@/luckgram/relay/routes';
import {RouteMessage, RouteStatus, getDefaultRouteConfig, openRouteChannel} from '@/luckgram/relay/state';
import {lgText} from '@/luckgram/text';

const MODE_KEY = 'lg_route_mode';
const PREFERRED_KEY = 'lg_route_preferred';
const RELAYS_KEY = 'lg_relays';
const RELAY_MEDIA_KEY = 'lg_relay_media';
const BAR_ID = 'luckgram-offline-bar';

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch(err) {
    return null;
  }
};

const write = (key: string, value: string | undefined) => {
  try {
    if(value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch(err) {}
};

export function readRouteConfig(): RouteConfig {
  const config = getDefaultRouteConfig();
  const mode = read(MODE_KEY);
  if(isRouteMode(mode)) config.mode = mode;

  const relays = normalizeRelays(read(RELAYS_KEY) || undefined);
  if(relays.length) config.relays = relays;

  if(read(RELAY_MEDIA_KEY) === '0') config.relayMedia = false;
  config.preferred = read(PREFERRED_KEY) || undefined;
  return config;
}

const [routeStatus, setRouteStatus] = createSignal<RouteStatus>({mode: readRouteConfig().mode});
export {routeStatus};

let channel: BroadcastChannel;
let onRetry: () => void;
let getAccount: () => number;
let isConnected: () => Promise<boolean>;

function sendConfig() {
  channel?.postMessage({type: 'config', config: readRouteConfig(), account: getAccount?.()} satisfies RouteMessage);
}

export function setRouteMode(mode: RouteMode) {
  write(MODE_KEY, mode === 'auto' ? undefined : mode);
  // * what connected under another mode says nothing about this one
  write(PREFERRED_KEY, undefined);
  setRouteStatus({mode});
  hideBar();
  sendConfig();
}

function hideBar() {
  document.getElementById(BAR_ID)?.remove();
}

function showBar() {
  if(document.getElementById(BAR_ID)) return;

  const bar = document.createElement('div');
  bar.id = BAR_ID;
  bar.className = 'luckgram-offline-bar';
  bar.setAttribute('role', 'alert');

  const text = document.createElement('span');
  text.textContent = lgText('无法连接，请检查网络', 'Can\'t connect. Please check your network.');

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = lgText('重试', 'Retry');
  button.addEventListener('click', () => {
    hideBar();
    channel?.postMessage({type: 'retry'} satisfies RouteMessage);
    onRetry?.();
  });

  bar.append(text, button);
  document.body.append(bar);
}

function onStatus(status: RouteStatus) {
  setRouteStatus(status);

  if(status.state === 'connected') {
    hideBar();
    if(status.id) write(PREFERRED_KEY, status.id);
  } else if(status.state === 'failed') {
    write(PREFERRED_KEY, undefined);
    // * upstream may be connected all the same, over HTTPS (a network that lets no WebSocket through)
    Promise.resolve(isConnected?.()).catch(() => false).then((connected) => {
      if(!connected && routeStatus().state === 'failed') showBar();
    });
  }
}

export type RoutePageOptions = {
  /** reconnects at once instead of at the transport's next retry */
  onRetry?: () => void,
  /** whether the app is connected by any transport */
  isConnected?: () => Promise<boolean>,
  /** calls back whenever the app's connection changes */
  onConnectionChange?: (callback: () => void) => void,
  /** the account on screen in this tab */
  account?: () => number,
  /** calls back when this tab shows another account */
  onAccountChange?: (callback: () => void) => void
};

export function initRoutePage(options: RoutePageOptions = {}) {
  if(channel) return;
  onRetry = options.onRetry;
  getAccount = options.account;
  options.onAccountChange?.(() => sendConfig());
  isConnected = options.isConnected;
  options.onConnectionChange?.(() => {
    if(!document.getElementById(BAR_ID)) return;
    Promise.resolve(isConnected?.()).catch(() => false).then((connected) => connected && hideBar());
  });

  channel = openRouteChannel();
  if(!channel) return;

  channel.addEventListener('message', (event) => {
    const message = event.data as RouteMessage;
    if(message?.type === 'hello') sendConfig();
    else if(message?.type === 'status' && message.status) onStatus(message.status);
  });

  // * the connections may have started before this page did (a shared worker): they answer with their status
  sendConfig();
  channel.postMessage({type: 'hello'} satisfies RouteMessage);
}
