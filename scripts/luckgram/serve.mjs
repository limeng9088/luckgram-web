#!/usr/bin/env node
// @ts-check
/**
 * Luckgram Web — serves an assembled site (tmp/luckgram-site, or the one of a build's artifact) on
 * this computer, the way Cloudflare Pages serves it: the same files, content types and headers
 * (the site's own `_headers`, so the Content-Security-Policy is the deployed one). No dependencies.
 *
 *   node serve.mjs [directory] [port]        default: ./site or tmp/luckgram-site, port 8080
 *
 * It listens on this computer only (127.0.0.1). http://localhost is a secure context to a browser,
 * so the service worker, notifications and the rest work as they do on the site.
 *
 * There is no development site (luckgram-specs#167): this is how a build of a pull request is tried
 * with a real account before it is merged — see README.md, "Trying a pull request".
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.xml': 'text/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.glsl': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm'
};

/**
 * The headers `_headers` gives a path: the sections whose pattern is the path itself or ends in a
 * star that covers it. Sections for other hosts (https://…) are not this server's.
 * @param {string} file the text of `_headers`
 * @param {string} pathname
 * @returns {Record<string, string>}
 */
export function headersFor(file, pathname) {
  /** @type {Record<string, string>} */
  const headers = {};
  let applies = false;
  for(const line of file.split('\n')) {
    if(!line.trim()) continue;
    if(!/^\s/.test(line)) {
      const pattern = line.trim();
      applies = pattern.startsWith('/') &&
        (pattern.endsWith('*') ? pathname.startsWith(pattern.slice(0, -1)) : pattern === pathname);
      continue;
    }

    const colon = line.indexOf(':');
    if(applies && colon !== -1) headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }

  return headers;
}

/**
 * The file a request path stands for, or nothing: a path out of the directory, a directory without
 * an index.html, a file that is not there.
 * @param {string} root an absolute directory
 * @param {string} pathname
 */
export function resolveFile(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch(err) {
    return;
  }

  if(decoded.includes('\0')) return;
  let file = path.resolve(root, '.' + path.posix.normalize('/' + decoded));
  if(file !== root && !file.startsWith(root + path.sep)) return;
  if(fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : undefined;
}

/** @param {string} root @param {number} port */
export function serve(root, port) {
  const headersFile = fs.existsSync(path.join(root, '_headers')) ? fs.readFileSync(path.join(root, '_headers'), 'utf8') : '';

  return http.createServer((request, response) => {
    const {pathname} = new URL(request.url || '/', 'http://localhost');
    const file = request.method === 'GET' || request.method === 'HEAD' ? resolveFile(root, pathname) : undefined;
    // * the deployment's own files (_headers, _worker.js …) are not pages of the site
    if(!file || path.basename(file).startsWith('_')) {
      response.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
      response.end('404\n');
      return;
    }

    const servedPath = pathname.endsWith('/') ? pathname : pathname;
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[/** @type {keyof typeof CONTENT_TYPES} */ (path.extname(file).toLowerCase())] || 'application/octet-stream',
      'Content-Length': fs.statSync(file).size,
      'Cache-Control': 'no-cache',
      ...headersFor(headersFile, servedPath)
    });

    if(request.method === 'HEAD') response.end();
    else fs.createReadStream(file).pipe(response);
  }).listen(port, '127.0.0.1');
}

if(process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const given = process.argv[2];
  const candidates = given ? [given] : [path.join(here, 'site'), path.join(process.cwd(), 'site'), path.join(process.cwd(), 'tmp', 'luckgram-site')];
  const root = candidates.map((candidate) => path.resolve(candidate)).find((candidate) => fs.existsSync(path.join(candidate, 'index.html')));
  const port = Number(process.argv[3] || process.env.PORT || 8080);

  if(!root) {
    console.error(`No site found (looked for index.html in: ${candidates.join(', ')}).\nUsage: node serve.mjs [directory] [port]`);
    process.exit(1);
  }

  const version = fs.existsSync(path.join(root, 'luckgram-version')) ? fs.readFileSync(path.join(root, 'luckgram-version'), 'utf8').trim() : '';
  serve(root, port).on('error', (err) => {
    console.error(/** @type {any} */ (err).code === 'EADDRINUSE' ? `Port ${port} is in use: node serve.mjs ${given || '<directory>'} <another port>` : String(err));
    process.exit(1);
  }).on('listening', () => {
    console.log(`Luckgram Web: ${root}\n${version}\nOpen http://localhost:${port}/   (Ctrl+C stops it)`);
  });
}
