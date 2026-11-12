/*
 * Luckgram Web (luckgram-specs#137, W1 需求 14): "有新版本 · 刷新".
 *
 * A deployment carries a small file with its commit (scripts/luckgram/assemble.mjs). An open page asks
 * for it when it comes back to the foreground, and when the commit is not its own it shows a
 * bar; only a click on the bar reloads, so nothing being typed is lost.
 */

import {LUCKGRAM_COMMIT, LUCKGRAM_VERSION_FILE} from '@/luckgram/config';
import {lgText} from '@/luckgram/text';

const MIN_INTERVAL = 60e3;
const BAR_ID = 'luckgram-update-bar';

let lastCheck = 0;
let found = false;

export type LuckgramVersionFile = {commit: string, build?: string, channel?: string, time?: string};

export function isNewerDeployment(file: LuckgramVersionFile | undefined, ownCommit: string) {
  return !!(file && typeof(file.commit) === 'string' && file.commit && ownCommit && file.commit !== ownCommit);
}

async function fetchVersionFile(): Promise<LuckgramVersionFile | undefined> {
  const response = await fetch(`${LUCKGRAM_VERSION_FILE}?t=${Date.now()}`, {cache: 'no-store'});
  if(!response.ok) return;
  const text = await response.text();
  // * a host that answers every address with the app's page has no such file
  if(/^\s*</.test(text)) return;
  return JSON.parse(text);
}

function showBar() {
  if(document.getElementById(BAR_ID)) return;

  const bar = document.createElement('button');
  bar.id = BAR_ID;
  bar.type = 'button';
  bar.className = 'luckgram-update-bar';
  bar.textContent = lgText('有新版本 · 刷新', 'New version available · Refresh');
  bar.addEventListener('click', () => {
    bar.disabled = true;
    location.reload();
  });
  document.body.append(bar);
}

async function check() {
  if(found || document.visibilityState !== 'visible') return;

  const now = Date.now();
  if(now - lastCheck < MIN_INTERVAL) return;
  lastCheck = now;

  try {
    if(isNewerDeployment(await fetchVersionFile(), LUCKGRAM_COMMIT)) {
      found = true;
      showBar();
    }
  } catch(err) {}
}

export function watchForLuckgramUpdate() {
  // * a dev server and a local build have no commit to compare
  if(!LUCKGRAM_COMMIT) return;

  lastCheck = Date.now();
  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
}
