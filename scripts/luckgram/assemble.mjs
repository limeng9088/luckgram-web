#!/usr/bin/env node
// @ts-check
/**
 * Luckgram Web (luckgram-specs#137, W1) — puts together the folder that is deployed to Cloudflare Pages.
 *
 * `vite build` writes only the bundle to dist/ (copyPublicDir is off): upstream's own build.js then
 * copies it into public/, next to the static files kept there, and uploads public/. public/ also
 * holds upstream's last committed bundle, so this script leaves it alone and builds a clean folder:
 *
 *   dist/                         the bundle of this commit
 *   public/assets, changelogs …   the static files the app asks for (what keepAsset.js keeps)
 *   src/luckgram/brand/img/       Luckgram's icons, over Telegram's of the same names
 *   site*.webmanifest             renamed to Luckgram
 *   luckgram-version              this deployment's commit, read by src/luckgram/update.ts
 *   _headers, robots.txt          Content-Security-Policy; noindex on everything but production
 *
 * Usage: node scripts/luckgram/assemble.mjs [outDir]     (default tmp/luckgram-site)
 * Environment: LUCKGRAM_CHANNEL, LUCKGRAM_BUILD, LUCKGRAM_COMMIT — the same as the build's.
 */

import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {createRequire} from 'module';
import {getLuckgramBuildInfo, luckgramHtmlContext} from './vite-plugin.mjs';
import {buildHeadersFile} from './headers.mjs';
import {brandEmbedMessages, brandTileColor, extractShell, stripComments} from './fingerprint.mjs';

const require = createRequire(import.meta.url);
const keepAsset = require('../../keepAsset.js');

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const distDir = path.join(rootDir, 'dist');
const publicDir = path.join(rootDir, 'public');
const brandDir = path.join(rootDir, 'src', 'luckgram', 'brand', 'img');
const outDir = path.resolve(rootDir, process.argv[2] || 'tmp/luckgram-site');

// * debugging tools of upstream's own deployment
const SKIP_PUBLIC = new Set(['snapshot.html']);

/** @param {string} message @returns {never} */
function fail(message) {
  console.error('[luckgram] assemble: ' + message);
  process.exit(1);
}

if(!fs.existsSync(path.join(distDir, 'index.html'))) {
  fail('dist/index.html is missing — run the build first (pnpm build)');
}

const info = getLuckgramBuildInfo();

fs.rmSync(outDir, {recursive: true, force: true});
fs.mkdirSync(outDir, {recursive: true});

// 1. the static files
for(const entry of fs.readdirSync(publicDir, {withFileTypes: true})) {
  const from = path.join(publicDir, entry.name);
  if(entry.isDirectory()) {
    if(keepAsset(entry.name + '/')) fs.cpSync(from, path.join(outDir, entry.name), {recursive: true});
  } else if(keepAsset(entry.name) && !SKIP_PUBLIC.has(entry.name)) {
    fs.copyFileSync(from, path.join(outDir, entry.name));
  }
}

// 2. the bundle
fs.cpSync(distDir, outDir, {recursive: true});

// 3. Luckgram's icons
const imgDir = path.join(outDir, 'assets', 'img');
for(const name of fs.readdirSync(brandDir)) {
  if(!fs.existsSync(path.join(imgDir, name))) {
    fail(`src/luckgram/brand/img/${name} replaces nothing in public/assets/img — upstream renamed or dropped the icon`);
  }

  fs.copyFileSync(path.join(brandDir, name), path.join(imgDir, name));
}

// * Telegram's screenshot, shown by the install dialog
fs.rmSync(path.join(imgDir, 'screenshot.jpg'), {force: true});

// 4. the manifests
for(const name of ['site.webmanifest', 'site_apple.webmanifest']) {
  const file = path.join(outDir, name);
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.name = 'Luckgram';
  manifest.short_name = 'Luckgram';
  manifest.id = '/';
  manifest.description = luckgramHtmlContext().description;
  manifest.theme_color = '#ffffff';
  manifest.background_color = '#ffffff';
  // * links of t.me open in an installed app only when t.me says so about the app's origin, which it does not about ours
  delete manifest.scope_extensions;
  delete manifest.screenshots;
  // * Telegram's own sender; the push subscription goes by the VAPID key
  delete manifest.gcm_sender_id;
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
}

// 5. nothing of it reads as Telegram Web (fingerprint.mjs, luckgram-specs#167)
{
  const indexFile = path.join(outDir, 'index.html');
  const {html, shellName, shellCode} = extractShell(fs.readFileSync(indexFile, 'utf8'));
  fs.writeFileSync(indexFile, brandTileColor(html));
  fs.writeFileSync(path.join(outDir, shellName), shellCode);

  const browserconfig = path.join(outDir, 'browserconfig.xml');
  fs.writeFileSync(browserconfig, brandTileColor(fs.readFileSync(browserconfig, 'utf8')));

  // * the embed frame and the script that talks to it name their messages the same way, whatever the name
  const embed = path.join(outDir, 'embed.html');
  fs.writeFileSync(embed, brandEmbedMessages(stripComments(fs.readFileSync(embed, 'utf8')).replace(/^\s*\/\/.*$/gm, '')));
  let renamed = 0;
  for(const name of fs.readdirSync(outDir)) {
    if(!name.endsWith('.js')) continue;
    const file = path.join(outDir, name);
    const text = fs.readFileSync(file, 'utf8');
    if(!text.includes('tweb-embed-')) continue;
    fs.writeFileSync(file, brandEmbedMessages(text));
    ++renamed;
  }

  if(!renamed) fail('no script names the embed frame\'s messages (tweb-embed-…) — upstream changed them, update scripts/luckgram/fingerprint.mjs');
}

// 6. this deployment
fs.writeFileSync(path.join(outDir, 'luckgram-version'), JSON.stringify({
  commit: info.commit,
  build: info.build,
  channel: info.channel,
  time: new Date().toISOString()
}) + '\n');

fs.writeFileSync(path.join(outDir, '_headers'), buildHeadersFile(info.channel));
fs.writeFileSync(path.join(outDir, 'robots.txt'), info.channel === 'prod' ?
  'User-agent: *\nAllow: /\n' :
  'User-agent: *\nDisallow: /\n');

// 7. Cloudflare Pages' limits: 20 000 files, 25 MiB each
let files = 0, bytes = 0;
(function walk(dir) {
  for(const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, entry.name);
    if(entry.isDirectory()) {
      walk(p);
      continue;
    }

    const size = fs.statSync(p).size;
    if(size > 25 * 1024 * 1024) fail(`${path.relative(outDir, p)} is ${(size / 1048576).toFixed(1)} MiB, over Cloudflare Pages' 25 MiB`);
    ++files;
    bytes += size;
  }
})(outDir);

if(files > 20000) fail(`${files} files, over Cloudflare Pages' 20 000`);

console.log(`[luckgram] assembled ${path.relative(rootDir, outDir)}: ${files} files, ${(bytes / 1048576).toFixed(1)} MiB, ` +
  `channel ${info.channel}, build ${info.build}, commit ${info.commit.slice(0, 7) || '-'}`);
