/*
 * Luckgram Web (luckgram-specs#139, W3): what the server side of Luckgram does as the page starts
 * — the remote config and the announcements — and what it undoes when the last account logs out.
 */

import rootScope from '@lib/rootScope';
import AccountController from '@lib/accounts/accountController';
import luckgramApi from '@/luckgram/core/client';
import LuckgramSettings from '@/luckgram/core/settings';
import {initRemoteConfig} from '@/luckgram/core/remoteConfig';
import {initAnnouncements} from '@/luckgram/core/announcements';
import {mountAnnouncementBanner} from '@/luckgram/ui/announcementBanner';

/**
 * 需求「退出全部账号时，Luckgram 的设置和令牌一并清除」: upstream says `logging_out` for every
 * account that leaves, after it has taken the account out of its list. When none is left — the
 * last one logged out, or all of them at once — Luckgram's values go too. With another account
 * still signed in they stay: they are the browser's, shared by the accounts.
 */
export function shouldClearOnLogout(accountsLeft: number | undefined) {
  return !(accountsLeft > 0);
}

export function initLuckgramCore() {
  rootScope.addEventListener('logging_out', () => {
    AccountController.getTotalAccounts().catch(() => AccountController.getUnencryptedTotalAccounts()).then((accountsLeft) => {
      if(shouldClearOnLogout(accountsLeft)) return LuckgramSettings.clear();
    }).catch(() => {});
  });

  // * the page is busy starting; none of this is needed for its first paint
  setTimeout(() => {
    initRemoteConfig(luckgramApi).then(() => initAnnouncements(luckgramApi));
    mountAnnouncementBanner();
  }, 1500);
}
