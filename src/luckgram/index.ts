/*
 * Luckgram Web (luckgram-specs#137, W1): what Luckgram adds as the page starts.
 * Called once from src/index.ts.
 */

import {LUCKGRAM_IS_DEV} from '@/luckgram/config';
import {watchForLuckgramUpdate} from '@/luckgram/update';
import {initRoutePage} from '@/luckgram/relay/page';
import {connection} from '@/luckgram/relay/appConnection';
import './luckgram.scss';

function mountDevBadge() {
  const badge = document.createElement('div');
  badge.className = 'luckgram-dev-badge';
  badge.dir = 'ltr';
  badge.textContent = 'DEV';
  document.body.append(badge);
}

export function initLuckgram() {
  if(LUCKGRAM_IS_DEV) mountDevBadge();
  watchForLuckgramUpdate();
  initRoutePage(connection);
}
