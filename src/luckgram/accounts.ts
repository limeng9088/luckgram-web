/*
 * Luckgram Web (luckgram-specs#140, W4): 20 accounts, with Telegram Premium or without.
 * The number itself is upstream's constant, raised (src/lib/accounts/constants.ts).
 */

import {MAX_ACCOUNTS} from '@lib/accounts/constants';
import {lgText} from '@/luckgram/text';

/** What is said when one more account is asked for at the limit. */
export function luckgramAccountsLimitText(max = MAX_ACCOUNTS) {
  return lgText(`最多登录 ${max} 个账号`, `You can sign in to ${max} accounts at most`);
}

/** From this many accounts on, their items in the main menu get a list of their own that scrolls. */
export const ACCOUNTS_SCROLL_FROM = 6;

/**
 * The accounts' items of the main menu, as the menu has laid them out one after another: put into
 * one container that scrolls, so that with 20 accounts the menu is not taller than the window and
 * what follows them (add account, settings…) is still there. The menu itself cannot scroll: its
 * submenus open beside it and would be cut off.
 */
export function luckgramScrollAccountItems(items: HTMLElement[], from = ACCOUNTS_SCROLL_FROM) {
  items = items.filter((item) => item?.parentElement);
  if(items.length < from) return;

  const first = items[0], parent = first.parentElement;
  if(items.some((item) => item.parentElement !== parent)) return;

  const container = document.createElement('div');
  container.classList.add('luckgram-accounts-scroll');
  parent.insertBefore(container, first);
  container.append(...items);

  // * the account on screen is in view when the menu opens
  const active = items.find((item) => item.querySelector('.active, .is-active')) || first;
  container.scrollTop = Math.max(0, active.offsetTop - container.offsetTop - container.clientHeight / 2);
  return container;
}
