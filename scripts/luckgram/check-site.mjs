#!/usr/bin/env node
// @ts-check
/**
 * Luckgram Web (luckgram-specs#137, W1) — checks the assembled site before it is deployed.
 *
 *  - the bundle carries the credentials of this build, not the pair upstream keeps in .env;
 *  - the page, the manifests and the notification code name Luckgram, not "Telegram Web";
 *  - a development build is marked noindex, a production build is not;
 *  - the version file is this build's.
 *
 * Usage: node scripts/luckgram/check-site.mjs [siteDir]     (default tmp/luckgram-site)
 */

import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {getLuckgramBuildInfo} from './vite-plugin.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const siteDir = path.resolve(rootDir, process.argv[2] || 'tmp/luckgram-site');
const info = getLuckgramBuildInfo();
const errors = [];

/** @param {string} name */
const read = (name) => fs.readFileSync(path.join(siteDir, name), 'utf8');

const scripts = fs.readdirSync(siteDir).filter((name) => name.endsWith('.js'));

// 1. credentials
const upstreamEnv = fs.readFileSync(path.join(rootDir, '.env'), 'utf8');
const upstreamHash = /^VITE_API_HASH=(.*)$/m.exec(upstreamEnv)?.[1].trim();
const ownHash = (process.env.TG_API_HASH || '').trim();
let withOwnHash = 0;
for(const name of scripts) {
  const text = read(name);
  if(upstreamHash && text.includes(upstreamHash)) errors.push(`${name} carries upstream's api_hash`);
  if(ownHash && text.includes(ownHash)) ++withOwnHash;
}

if(!ownHash) errors.push('TG_API_HASH is not set, the credentials of the bundle cannot be checked');
else if(!withOwnHash) errors.push('no script carries the api_hash of this build');

// 2. the name
const html = read('index.html');
if(!/<title>Luckgram<\/title>/.test(html)) errors.push('index.html: the title is not Luckgram');
if(/Telegram Web|WebK/.test(html)) errors.push('index.html names Telegram Web');
for(const name of ['site.webmanifest', 'site_apple.webmanifest']) {
  const manifest = JSON.parse(read(name));
  if(manifest.name !== 'Luckgram' || manifest.short_name !== 'Luckgram') errors.push(`${name}: the name is not Luckgram`);
  if(/Telegram Web|WebK|telegram\.org/.test(JSON.stringify(manifest))) errors.push(`${name} names Telegram Web`);
}

const serviceWorkers = scripts.filter((name) => /^sw-.*\.js$/.test(name));
if(serviceWorkers.length !== 1) errors.push(`expected one service worker, found ${serviceWorkers.length}`);
for(const name of serviceWorkers) {
  const text = read(name);
  if(/showNotification\(\s*[`'"]Telegram/.test(text)) errors.push(`${name}: a notification is titled Telegram`);
  if(!text.includes('luckgramAssets')) errors.push(`${name}: the assets cache is not Luckgram's`);
}

// 3. the channel
const noindex = /<meta name="robots" content="noindex/.test(html);
const headers = read('_headers');
if(info.channel === 'prod') {
  if(noindex || /X-Robots-Tag/.test(headers)) errors.push('a production build is marked noindex');
} else if(!noindex || !/X-Robots-Tag: noindex/.test(headers)) {
  errors.push('a development build is not marked noindex');
}

if(!/Content-Security-Policy: .*connect-src/.test(headers)) errors.push('_headers has no Content-Security-Policy');

// 4. the version file
const version = JSON.parse(read('luckgram-version'));
if(version.commit !== info.commit || !info.commit) errors.push('luckgram-version is not this commit');
if(version.channel !== info.channel) errors.push('luckgram-version is not this channel');
if(info.commit && !scripts.some((name) => read(name).includes(info.commit))) errors.push('no script carries the commit of this build');

if(errors.length) {
  console.error('[luckgram] check-site failed:\n' + errors.map((error) => '  - ' + error).join('\n'));
  process.exit(1);
}

console.log(`[luckgram] check-site passed: ${scripts.length} scripts, channel ${info.channel}, commit ${info.commit.slice(0, 7)}`);
