/*
 * Luckgram Web (luckgram-specs#137, W1): what Luckgram adds as the page starts.
 * Called once from src/index.ts.
 */

import {LUCKGRAM_CHANNEL, LUCKGRAM_IS_DEV} from '@/luckgram/config';
import {redirectToCanonical} from '@/luckgram/canonical';
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
  // * a production build under a *.pages.dev address goes to the site's own (specs#167)
  if(redirectToCanonical(LUCKGRAM_CHANNEL)) return;
  if(LUCKGRAM_IS_DEV) mountDevBadge();
  watchForLuckgramUpdate();
  initRoutePage(connection);
}
