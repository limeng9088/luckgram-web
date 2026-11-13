/*
 * Luckgram Web (luckgram-specs#167): the production site has one address.
 *
 * Cloudflare Pages also serves it as <project>.pages.dev and <deployment>.<project>.pages.dev.
 * A sign-in page on such a host looks like a copy of someone's sign-in page put up somewhere else —
 * what safe-browsing lists as deceptive, and those hosts were listed. A production build opened
 * there goes to the site's own address. Development builds stay: their previews live on pages.dev.
 *
 * No imports: it runs before anything else of the app.
 */

export const LUCKGRAM_PRODUCTION_ORIGIN = 'https://web.luckgram.cc';

/** Where a production build opened at `location` should be instead, or nothing when it is in place. */
export function getCanonicalRedirect(
  channel: string,
  location: {hostname: string, pathname: string, search: string, hash: string}
): string | undefined {
  if(channel !== 'prod' || !/(^|\.)pages\.dev$/i.test(location.hostname)) return;
  return LUCKGRAM_PRODUCTION_ORIGIN + location.pathname + location.search + location.hash;
}

/** @returns true when the page is leaving */
export function redirectToCanonical(channel: string) {
  const target = getCanonicalRedirect(channel, location);
  if(!target) return false;
  location.replace(target);
  return true;
}
