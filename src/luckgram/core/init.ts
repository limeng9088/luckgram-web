/*
 * Luckgram Web (luckgram-specs#139, W3): what the server side of Luckgram does as the page starts
 * — the remote config and the announcements — and the end of a log out that was cut short (logout.ts).
 */

import luckgramApi from '@/luckgram/core/client';
import {finishLuckgramLogout} from '@/luckgram/core/logout';
import {initRemoteConfig} from '@/luckgram/core/remoteConfig';
import {initAnnouncements} from '@/luckgram/core/announcements';
import {mountAnnouncementBanner} from '@/luckgram/ui/announcementBanner';

export function initLuckgramCore() {
  // * before the device token is read: a log out of the last account that the reload cut short
  const cleared = finishLuckgramLogout();

  // * the page is busy starting; none of this is needed for its first paint
  setTimeout(() => {
    cleared.then(() => initRemoteConfig(luckgramApi)).then(() => initAnnouncements(luckgramApi));
    mountAnnouncementBanner();
  }, 1500);
}
