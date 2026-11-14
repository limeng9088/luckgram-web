// @ts-check
/**
 * Luckgram Web (luckgram-specs#167) — what is sent to a browser does not read as Telegram Web.
 *
 * Upstream's index.html is Telegram Web K's page: its static skeleton (whole page-chats,
 * chatlist-container, sidebar-left …), its comments, its tile colour. Anything that judges a
 * site by its HTML — a safe-browsing crawler first of all — sees a copy of Telegram's page on
 * another domain. The functions here take that out of the files that are sent, after the build
 * and without touching upstream's sources (scripts/luckgram/assemble.mjs calls them):
 *
 *  - the skeleton moves out of index.html into a script that puts it back, unchanged, before the
 *    app's own script runs — the app finds the document it expects, the HTML carries none of it;
 *  - comments go, the tile colour is Luckgram's;
 *  - the name upstream gives the embed frame's messages is Luckgram's.
 *
 * File names are the bundler's business ("f" and a hash, vite.config.ts), source maps too.
 * `findFingerprints` is the check that none of it comes back (scripts/luckgram/check-site.mjs).
 *
 * No imports but node:crypto: tested in src/tests/luckgram.test.ts.
 */

import {createHash} from 'node:crypto';

export const LUCKGRAM_TILE_COLOR = '#2481eb';
const UPSTREAM_TILE_COLOR = /#2d89ef/gi;

/** Class names and ids of upstream's skeleton: none may be in the HTML that is sent. */
export const SKELETON_MARKS = [
  'page-chats', 'chatlist-container', 'sidebar-left', 'sidebar-right', 'main-columns', 'column-left',
  'column-center', 'column-right', 'folders-container', 'stories-viewer', 'has-auth-pages', 'tabs-tab'
];

/**
 * @param {string} html the built index.html
 * @returns {{html: string, shellName: string, shellCode: string}}
 */
export function extractShell(html) {
  const bodyOpen = /<body([^>]*)>/.exec(html);
  const bodyClose = html.lastIndexOf('</body>');
  if(!bodyOpen || bodyClose === -1) throw new Error('[luckgram] index.html has no <body>');

  const inner = html.slice(bodyOpen.index + bodyOpen[0].length, bodyClose);
  if(/<script\b/i.test(inner)) {
    // * a script inside the skeleton would not run when the skeleton is put back as markup
    throw new Error('[luckgram] index.html has a <script> inside <body>, update scripts/luckgram/fingerprint.mjs');
  }

  const className = /\bclass="([^"]*)"/.exec(bodyOpen[1])?.[1] || '';
  const otherAttributes = bodyOpen[1].replace(/\s*\bclass="[^"]*"/, '');
  const markup = stripComments(inner).trim();

  const shellCode =
    `document.body.className=${JSON.stringify(className)};` +
    `document.body.insertAdjacentHTML("afterbegin",${JSON.stringify(markup)});\n`;
  const shellName = 'f' + createHash('sha256').update(shellCode).digest('base64url').slice(0, 8) + '.js';

  // * before the app's script: module scripts run in the order they are written
  const entry = /<script type="module"[^>]*src="[^"]+"[^>]*><\/script>/.exec(html);
  if(!entry || entry.index > bodyOpen.index) {
    throw new Error('[luckgram] the app\'s <script type="module"> is not in <head>, update scripts/luckgram/fingerprint.mjs');
  }

  const shellTag = `<script type="module" crossorigin src="./${shellName}"></script>\n    `;
  html = html.slice(0, bodyOpen.index) + `<body${otherAttributes}>\n  ` + html.slice(bodyClose);
  html = html.slice(0, entry.index) + shellTag + html.slice(entry.index);
  return {html: stripComments(html), shellName, shellCode};
}

/** @param {string} html */
export function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/\n[ \t]*\n+/g, '\n');
}

/** Upstream's tile colour (the favicon generator's default, in index.html and browserconfig.xml). @param {string} text */
export function brandTileColor(text) {
  return text.replace(UPSTREAM_TILE_COLOR, LUCKGRAM_TILE_COLOR);
}

/** The type of the messages between the app and its embed frame (embed.html, telegramWebView.ts). @param {string} text */
export function brandEmbedMessages(text) {
  return text.replace(/tweb-embed-/g, 'lg-embed-');
}

/**
 * What still reads as Telegram Web in a site that is about to be deployed.
 * @param {{
 *   html: string,
 *   files: string[],
 *   texts?: {[name: string]: string},
 *   channel: string
 * }} site `files`: every path of the site; `texts`: the small text files (manifests, browserconfig.xml, embed.html)
 * @returns {string[]} one line per finding, empty when there is none
 */
export function findFingerprints({html, files, texts = {}, channel}) {
  const found = [];

  // * "Telegram" is said in one place: the description, which says that Luckgram is not Telegram's
  const withoutDescriptions = html.replace(/<meta\b[^>]*\bcontent="[^"]*third-party client[^"]*"[^>]*>/g, '');
  const mention = /.{0,40}telegram.{0,40}/i.exec(withoutDescriptions);
  if(mention) found.push(`index.html says "Telegram" outside the description: …${mention[0].replace(/\s+/g, ' ')}…`);
  if(/<!--/.test(html)) found.push('index.html has comments');
  if(/tweb|webk\b|webogram/i.test(html)) found.push('index.html names upstream (tweb / WebK)');
  if(UPSTREAM_TILE_COLOR.test(html)) found.push('index.html has upstream\'s tile colour');
  UPSTREAM_TILE_COLOR.lastIndex = 0;

  for(const mark of SKELETON_MARKS) {
    if(html.includes(mark)) found.push(`index.html carries upstream's skeleton (${mark})`);
  }

  for(const file of files) {
    const name = file.split('/').pop() || '';
    if(/telegram|tweb|webk/i.test(name)) found.push(`a file is named after upstream: ${file}`);
    if(channel === 'prod' && name.endsWith('.map')) found.push(`a production site carries a source map: ${file}`);
    // * a script or a style sheet of the bundle named for what it is, instead of by its hash
    if(!file.includes('/') && /^[A-Za-z][A-Za-z0-9_.@~]*-[A-Za-z0-9_-]{8}\.(js|css)$/.test(name)) {
      found.push(`a bundle file carries upstream's name: ${file}`);
    }
  }

  for(const [name, text] of Object.entries(texts)) {
    if(/telegram\s*web|webk|tweb|webogram/i.test(text)) found.push(`${name} names upstream`);
    if(UPSTREAM_TILE_COLOR.test(text)) found.push(`${name} has upstream's tile colour`);
    UPSTREAM_TILE_COLOR.lastIndex = 0;
    if(/\.webmanifest$/.test(name) && /telegram/i.test(text.replace(/"description":\s*"[^"]*third-party client[^"]*"/, ''))) {
      found.push(`${name} says "Telegram" outside the description`);
    }
  }

  return found;
}
