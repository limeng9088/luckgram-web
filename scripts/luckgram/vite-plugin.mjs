// @ts-check
/**
 * Luckgram Web (luckgram-specs#137, W1) — what a Luckgram build adds to upstream's Vite config.
 *
 * 1. Telegram API credentials. A build takes them from TG_API_ID / TG_API_HASH (the repository's
 *    Actions secrets, the same pair as the phone apps) and fails without them: it never falls back
 *    to the pair upstream keeps in .env. Neither value is in the repository.
 * 2. Build information for the version line and the update check: VITE_LG_BUILD (CI run number),
 *    VITE_LG_COMMIT, VITE_LG_CHANNEL ('dev' for web-dev.luckgram.cc and previews, 'prod' for
 *    web.luckgram.cc, 'local' otherwise).
 * 3. index.html: the Luckgram logo in place of Telegram's on the sign-in page, and noindex on
 *    everything that is not the production address.
 *
 * Environment: TG_API_ID, TG_API_HASH, LUCKGRAM_CHANNEL, LUCKGRAM_BUILD, LUCKGRAM_COMMIT.
 */

import {execSync} from 'child_process';
import {readFileSync} from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const LUCKGRAM_ORIGINS = {
  prod: 'https://web.luckgram.cc/',
  dev: 'https://web-dev.luckgram.cc/',
  local: 'http://localhost:8080/'
};

export function getLuckgramChannel(env = process.env) {
  const channel = env.LUCKGRAM_CHANNEL || 'local';
  if(!(channel in LUCKGRAM_ORIGINS)) {
    throw new Error(`[luckgram] LUCKGRAM_CHANNEL must be dev, prod or local, got "${channel}"`);
  }

  return /** @type {'dev' | 'prod' | 'local'} */ (channel);
}

/** The values upstream's index.html template is filled with. */
export function luckgramHtmlContext(env = process.env) {
  const origin = LUCKGRAM_ORIGINS[getLuckgramChannel(env)];
  return {
    title: 'Luckgram',
    description: 'Luckgram — a fast, secure messenger for your Telegram account, with AI built in.',
    url: origin,
    origin
  };
}

function readUpstreamCredentials() {
  const out = {id: '', hash: ''};
  try {
    const text = readFileSync(path.join(rootDir, '.env'), 'utf8');
    out.id = /^VITE_API_ID=(.*)$/m.exec(text)?.[1].trim() ?? '';
    out.hash = /^VITE_API_HASH=(.*)$/m.exec(text)?.[1].trim() ?? '';
  } catch(err) {}
  return out;
}

/**
 * The credentials of a build, or an error that says what to configure.
 * @param {NodeJS.ProcessEnv} env
 * @param {{id: string, hash: string}} upstream
 */
export function resolveLuckgramCredentials(env, upstream) {
  const id = (env.TG_API_ID || '').trim();
  const hash = (env.TG_API_HASH || '').trim();
  const hint = ' Set the repository secrets TG_API_ID and TG_API_HASH (Settings → Secrets and variables → Actions); ' +
    'for a local build export both variables. A Luckgram build never uses the credentials upstream keeps in .env.';

  if(!id || !hash) {
    throw new Error('[luckgram] TG_API_ID / TG_API_HASH are not set.' + hint);
  }

  if(!/^[1-9]\d{0,9}$/.test(id)) {
    throw new Error('[luckgram] TG_API_ID is not a number.' + hint);
  }

  if(!/^[0-9a-f]{32}$/i.test(hash)) {
    throw new Error('[luckgram] TG_API_HASH is not 32 hex characters.' + hint);
  }

  if(id === upstream.id || hash.toLowerCase() === upstream.hash.toLowerCase()) {
    throw new Error('[luckgram] TG_API_ID / TG_API_HASH are upstream\'s (Telegram Web K\'s) credentials.' + hint);
  }

  return {id, hash};
}

/** @param {NodeJS.ProcessEnv} env */
function getCommit(env) {
  if(env.LUCKGRAM_COMMIT) return env.LUCKGRAM_COMMIT.trim();
  try {
    return execSync('git rev-parse HEAD', {cwd: rootDir, stdio: ['ignore', 'pipe', 'ignore']}).toString().trim();
  } catch(err) {
    return '';
  }
}

/**
 * The relays built into a build (luckgram-specs#138, W2), used until remote config brings
 * `web.relays` (W3): the channel's own relay first, then the backup one. LUCKGRAM_RELAYS replaces
 * them (a local relay: `LUCKGRAM_RELAYS=ws://localhost:8787`).
 */
/** @type {Record<string, string[]>} */
export const LUCKGRAM_RELAYS = {
  prod: ['wss://ws.luckgram.cc', 'wss://lgws.cat158.com'],
  dev: ['wss://ws-dev.luckgram.cc', 'wss://lgws.cat158.com'],
  local: []
};

export function getLuckgramRelays(env = process.env) {
  if(env.LUCKGRAM_RELAYS !== undefined) return env.LUCKGRAM_RELAYS.split(/[\s,]+/).filter(Boolean);
  return LUCKGRAM_RELAYS[getLuckgramChannel(env)];
}

/**
 * The entries of the Luckgram API a build talks to (luckgram-specs#139, W3 需求 5): the main one,
 * then the backup for when luckgram.cc cannot be reached. The development address and a local build
 * use the dev server; LUCKGRAM_API_URLS replaces them.
 */
/** @type {Record<string, string[]>} */
export const LUCKGRAM_API_URLS = {
  prod: ['https://api.luckgram.cc', 'https://lg.cat158.com'],
  dev: ['https://api-dev.luckgram.cc', 'https://lg-dev.cat158.com'],
  local: ['https://api-dev.luckgram.cc', 'https://lg-dev.cat158.com']
};

export function getLuckgramApiUrls(env = process.env) {
  if(env.LUCKGRAM_API_URLS !== undefined) return env.LUCKGRAM_API_URLS.split(/[\s,]+/).filter(Boolean);
  return LUCKGRAM_API_URLS[getLuckgramChannel(env)];
}

export function getLuckgramBuildInfo(env = process.env) {
  return {
    channel: getLuckgramChannel(env),
    build: (env.LUCKGRAM_BUILD || '0').trim(),
    commit: getCommit(env)
  };
}

// The plane of the Luckgram icon (src/luckgram/brand/plane.path, a 512 box) centred in the 160 box of
// upstream's <path id="logo">, which the sign-in page draws in the accent colour.
function luckgramLogoPath() {
  const d = readFileSync(path.join(rootDir, 'src', 'luckgram', 'brand', 'plane.path'), 'utf8').trim();
  return `<path id="logo" fill-rule="evenodd" transform="translate(-14 -12.2) scale(0.376)" d="${d}"/>`;
}

/** @returns {import('vite').Plugin} */
export default function luckgramPlugin() {
  /** @type {ReturnType<typeof getLuckgramBuildInfo>} */
  let info;

  return {
    name: 'luckgram',
    config(_config, {command}) {
      info = getLuckgramBuildInfo();
      /** @type {Record<string, string>} */
      const define = {
        'import.meta.env.VITE_LG_BUILD': JSON.stringify(info.build),
        'import.meta.env.VITE_LG_COMMIT': JSON.stringify(command === 'build' ? info.commit : ''),
        'import.meta.env.VITE_LG_CHANNEL': JSON.stringify(info.channel),
        'import.meta.env.VITE_LG_RELAYS': JSON.stringify(getLuckgramRelays().join(',')),
        'import.meta.env.VITE_LG_API_URLS': JSON.stringify(process.env.VITEST ? '' : getLuckgramApiUrls().join(','))
      };

      const isTest = !!process.env.VITEST;
      if(command === 'build' && !isTest) {
        const {id, hash} = resolveLuckgramCredentials(process.env, readUpstreamCredentials());
        // * process.env wins over .env when Vite loads the environment, which happens after this hook
        process.env.VITE_API_ID = id;
        process.env.VITE_API_HASH = hash;
        define['import.meta.env.VITE_API_ID'] = JSON.stringify(id);
        define['import.meta.env.VITE_API_HASH'] = JSON.stringify(hash);
      } else if(!isTest && process.env.TG_API_ID && process.env.TG_API_HASH) {
        // * a dev server with Luckgram's credentials; without them it runs on upstream's, locally only
        process.env.VITE_API_ID = process.env.TG_API_ID.trim();
        process.env.VITE_API_HASH = process.env.TG_API_HASH.trim();
      }

      return {define};
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const logoRe = /<path id="logo"[^>]*\/>/;
        if(!logoRe.test(html)) {
          throw new Error('[luckgram] <path id="logo"> is gone from index.html, update scripts/luckgram/vite-plugin.mjs');
        }

        html = html.replace(logoRe, luckgramLogoPath());
        if(info.channel !== 'prod') {
          html = html.replace('<title>', '<meta name="robots" content="noindex, nofollow">\n    <title>');
        }

        return html;
      }
    }
  };
}
