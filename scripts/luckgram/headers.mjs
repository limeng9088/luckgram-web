// @ts-check
/**
 * Luckgram Web (luckgram-specs#137, W1 需求 9) — the response headers of the deployed site
 * (Cloudflare Pages' `_headers` file).
 *
 * The page talks to Telegram's servers and Luckgram's own domains and to nobody else, and the
 * Content-Security-Policy enforces it: a request anywhere else is refused by the browser.
 *
 * Frames stay open to https: — a mini app, a game, a payment form or an Instant View embed is a
 * third party's page the user opened, shown in a sandboxed frame; it is not a request of the app.
 */

export const TELEGRAM_SOURCES = ['https://*.telegram.org', 'wss://*.telegram.org'];
export const LUCKGRAM_SOURCES = ['https://*.luckgram.cc', 'wss://*.luckgram.cc'];

export function buildContentSecurityPolicy() {
  const directives = {
    'default-src': ['\'self\''],
    // * wasm: rlottie, opus, QuickJS, noise suppression; blob: — workers made from a blob
    'script-src': ['\'self\'', '\'wasm-unsafe-eval\'', 'blob:'],
    'worker-src': ['\'self\'', 'blob:'],
    'style-src': ['\'self\'', '\'unsafe-inline\''],
    'img-src': ['\'self\'', 'data:', 'blob:'],
    'media-src': ['\'self\'', 'data:', 'blob:'],
    'font-src': ['\'self\'', 'data:'],
    'connect-src': ['\'self\'', 'data:', 'blob:', ...TELEGRAM_SOURCES, ...LUCKGRAM_SOURCES],
    'frame-src': ['\'self\'', 'https:', 'blob:', 'data:'],
    'manifest-src': ['\'self\''],
    'form-action': ['\'none\''],
    'object-src': ['\'none\''],
    'base-uri': ['\'self\''],
    'frame-ancestors': ['\'self\'']
  };

  return Object.entries(directives).map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ');
}

/** @param {'dev' | 'prod' | 'local'} channel */
export function buildHeadersFile(channel) {
  const lines = [
    '/*',
    `  Content-Security-Policy: ${buildContentSecurityPolicy()}`,
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: no-referrer'
  ];

  if(channel !== 'prod') {
    lines.push('  X-Robots-Tag: noindex, nofollow');
  }

  lines.push(
    '',
    '/luckgram-version',
    '  Cache-Control: no-store',
    '',
    '/',
    '  Cache-Control: no-cache',
    '',
    '/index.html',
    '  Cache-Control: no-cache',
    ''
  );

  return lines.join('\n');
}
