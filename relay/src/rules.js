// @ts-check
/**
 * Luckgram Web relay (luckgram-specs#138, W2) — the rules of the relay, with nothing of the
 * Workers runtime in them, so they are tested in Node (src/tests/luckgramRelay.test.ts) and are
 * the reference for the nginx / Caddy configuration in relay/selfhost.
 *
 *   wss://<relay>/<dc>[-1]/apiws[_premium]  →  wss://kws<dc>[-1].web.telegram.org/apiws[_premium]
 *
 * dc is 1–5, "-1" marks Telegram's media (download / upload) endpoint; nothing else is forwarded.
 */

/** Origins of Luckgram Web: production, development, the backup entrance, pull request previews. */
export const DEFAULT_ALLOWED_ORIGINS = [
  'https://web.luckgram.cc',
  'https://web-dev.luckgram.cc',
  'https://lgweb.cat158.com',
  'https://*.luckgram-web-dev.pages.dev',
  'https://*.luckgram-web.pages.dev'
];

const PATH_RE = /^\/([1-5])(-1)?\/(apiws|apiws_premium)$/;

/**
 * @param {string} pathname
 * @returns {{dc: number, media: boolean, path: string, upstream: string} | undefined}
 */
export function parseRelayPath(pathname) {
  const match = PATH_RE.exec(pathname);
  if(!match) return;

  const dc = +match[1];
  const media = !!match[2];
  const path = match[3];
  return {dc, media, path, upstream: `https://kws${dc}${media ? '-1' : ''}.web.telegram.org/${path}`};
}

/**
 * @param {string} extra comma or space separated origins added by the deployment (ALLOWED_ORIGINS)
 * @returns {string[]}
 */
export function allowedOrigins(extra = '') {
  return [...DEFAULT_ALLOWED_ORIGINS, ...extra.split(/[\s,]+/).filter(Boolean)];
}

/**
 * @param {string | null | undefined} origin the request's Origin header
 * @param {string[]} allowed exact origins, or `https://*.example.com` for one label in place of the star
 */
export function isOriginAllowed(origin, allowed) {
  if(!origin) return false;

  let url;
  try {
    url = new URL(origin);
  } catch(err) {
    return false;
  }

  // * an Origin header is scheme://host[:port] and nothing more
  if(url.origin !== origin) return false;

  return allowed.some((pattern) => {
    const star = pattern.indexOf('://*.');
    if(star === -1) return pattern === origin;

    const scheme = pattern.slice(0, star + 3);
    const suffix = pattern.slice(star + 4); // ".example.com"
    if(!origin.startsWith(scheme) || !origin.endsWith(suffix)) return false;
    const label = origin.slice(scheme.length, origin.length - suffix.length);
    return /^[a-z0-9-]+$/.test(label);
  });
}

/**
 * What to answer before anything is forwarded.
 * @param {{method: string, pathname: string, upgrade: string | null, origin: string | null}} request
 * @param {string[]} allowed
 * @returns {{status: 404 | 403 | 426} | {status: 101, target: NonNullable<ReturnType<typeof parseRelayPath>>}}
 */
export function decide(request, allowed) {
  const target = request.method === 'GET' ? parseRelayPath(request.pathname) : undefined;
  if(!target) return {status: 404};
  if(!isOriginAllowed(request.origin, allowed)) return {status: 403};
  if((request.upgrade || '').toLowerCase() !== 'websocket') return {status: 426};
  return {status: 101, target};
}
