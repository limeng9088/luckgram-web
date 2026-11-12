/*
 * Luckgram Web (luckgram-specs#138, W2): the route settings and the route's state, shared between
 * the page and wherever the connections live (the MTProto worker, or the page itself).
 *
 * They talk over a BroadcastChannel, which every context of the origin has, so nothing is added to
 * upstream's worker protocol:
 *
 *   connections → page   {type: 'hello'}                 "send me the settings"
 *   page → connections   {type: 'config', config}        settings (mode, relays, relay_media, what connected last)
 *   connections → page   {type: 'status', status}        which route the main connection uses, or that none works
 *   page → connections   {type: 'retry'}                 the "Retry" button
 */

import {RouteConfig, RouteKind, RouteMode, isRouteMode, normalizeRelays} from '@/luckgram/relay/routes';

export const ROUTE_CHANNEL_NAME = 'luckgram-route';

export type RouteStatus = {
  /** undefined until a connection was tried */
  state?: 'connected' | 'failed',
  kind?: RouteKind,
  /** 'official' or the relay's base address */
  id?: string,
  mode: RouteMode
};

export type RouteMessage =
  {type: 'hello'} |
  {type: 'config', config: RouteConfig} |
  {type: 'status', status: RouteStatus} |
  {type: 'retry'};

// * set by scripts/luckgram/vite-plugin.mjs: the relays of this build, until remote config brings web.relays (W3)
const env = import.meta.env as any as Record<string, string | undefined>;
export const BUILT_IN_RELAYS = normalizeRelays(env.VITE_LG_RELAYS);

export function getDefaultRouteConfig(): RouteConfig {
  return {mode: 'auto', relays: BUILT_IN_RELAYS.slice(), relayMedia: true};
}

/** A config that came from storage or from another context: only what makes sense is taken. */
export function sanitizeRouteConfig(value: any): RouteConfig {
  const config = getDefaultRouteConfig();
  if(!value || typeof(value) !== 'object') return config;

  if(isRouteMode(value.mode)) config.mode = value.mode;
  if(Array.isArray(value.relays)) {
    const relays = normalizeRelays(value.relays.filter((relay: any) => typeof(relay) === 'string'));
    if(relays.length) config.relays = relays;
  }

  if(typeof(value.relayMedia) === 'boolean') config.relayMedia = value.relayMedia;
  if(typeof(value.preferred) === 'string') config.preferred = value.preferred;
  return config;
}

export function openRouteChannel(): BroadcastChannel | undefined {
  try {
    return new BroadcastChannel(ROUTE_CHANNEL_NAME);
  } catch(err) {}
}
