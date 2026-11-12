/*
 * Luckgram Web (luckgram-specs#138, W2): which addresses a connection to Telegram may use, and in
 * which order. Pure logic, no imports — the socket (routedSocket.ts), the page (page.ts) and the
 * tests all go by it.
 *
 *   official  wss://kws<dc>[-1].web.telegram.org/<path>      (upstream's dcConfigurator.ts)
 *   relay     wss://<relay>/<dc>[-1]/<path>                  (relay/, the same rule on the other side)
 */

export type RouteMode = 'auto' | 'official' | 'relay';
export type RouteKind = 'official' | 'relay';

export type RouteCandidate = {
  kind: RouteKind,
  /** 'official', or the relay's base address */
  id: string,
  url: string
};

export type RouteConfig = {
  mode: RouteMode,
  /** base addresses of the relays, in order: 'wss://ws.luckgram.cc' */
  relays: string[],
  /** false: media connections (download, upload) never go through a relay — remote config web.relay_media */
  relayMedia: boolean,
  /** what connected last time: 'official' or a relay's base address */
  preferred?: string
};

export const OFFICIAL_ID = 'official';

/** How long one attempt to connect may take before it is given up: under the 10 s in which the page has to say so. */
export const ATTEMPT_TIMEOUT = 8000;
/** How long upstream's transport probe waits for a WebSocket when HTTPS does not answer either (controller.ts). */
export const LUCKGRAM_WEBSOCKET_PROBE_TIMEOUT = ATTEMPT_TIMEOUT + 500;

const OFFICIAL_RE = /^wss:\/\/kws([1-5])(-1)?\.web\.telegram\.org\/(apiws|apiws_premium)$/;

export type ParsedOfficialUrl = {dc: number, media: boolean, path: string};

/** Only what the relay forwards; a test server's address (apiws_test) is nobody's but Telegram's. */
export function parseOfficialUrl(url: string): ParsedOfficialUrl | undefined {
  const match = OFFICIAL_RE.exec(url);
  if(!match) return;
  return {dc: +match[1], media: !!match[2], path: match[3]};
}

export function normalizeRelay(relay: string): string | undefined {
  relay = (relay || '').trim().replace(/\/+$/, '');
  if(!relay) return;
  if(!/^wss?:\/\//.test(relay)) relay = 'wss://' + relay;
  return /^wss?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(relay) ? relay.toLowerCase() : undefined;
}

export function normalizeRelays(relays: string[] | string | undefined): string[] {
  const list = typeof(relays) === 'string' ? relays.split(/[\s,]+/) : (relays || []);
  const out: string[] = [];
  for(const relay of list) {
    const normalized = normalizeRelay(relay);
    if(normalized && !out.includes(normalized)) out.push(normalized);
  }

  return out;
}

export function toRelayUrl(relay: string, parsed: ParsedOfficialUrl) {
  return `${relay}/${parsed.dc}${parsed.media ? '-1' : ''}/${parsed.path}`;
}

/**
 * The addresses to try for one connection, the first being the one to start with.
 * Never empty: a mode that leaves nothing (only relays, and none configured or allowed for this
 * connection) falls back to the official address rather than to no connection at all.
 */
export function getRouteCandidates(officialUrl: string, config: RouteConfig): RouteCandidate[] {
  const official: RouteCandidate = {kind: 'official', id: OFFICIAL_ID, url: officialUrl};
  const parsed = parseOfficialUrl(officialUrl);
  if(!parsed) return [official];

  const relaysAllowed = config.mode !== 'official' && (!parsed.media || config.relayMedia);
  const relays: RouteCandidate[] = relaysAllowed ? config.relays.map((relay) => ({
    kind: 'relay',
    id: relay,
    url: toRelayUrl(relay, parsed)
  })) : [];

  // * web.relay_media=false is there to stop the relay's traffic, so it outweighs "relays only"
  const officialAllowed = config.mode !== 'relay' || !relays.length;
  const candidates = officialAllowed ? [official, ...relays] : relays;

  const preferred = candidates.findIndex((candidate) => candidate.id === config.preferred);
  if(preferred > 0) candidates.unshift(...candidates.splice(preferred, 1));
  return candidates;
}

/**
 * When each candidate is started, in ms from the beginning of the attempt.
 * Nothing remembered: the official address and the first relay start together and the faster
 * one wins. Something remembered: it gets a head start, the others follow only if it is slow —
 * and at once when it fails (routedSocket.ts).
 */
export function getStartDelays(candidates: RouteCandidate[], hasPreferred: boolean, step = 2500): number[] {
  return candidates.map((_, index) => {
    if(hasPreferred) return index * step;
    return index < 2 ? 0 : (index - 1) * step;
  });
}

export function isRouteMode(value: any): value is RouteMode {
  return value === 'auto' || value === 'official' || value === 'relay';
}
