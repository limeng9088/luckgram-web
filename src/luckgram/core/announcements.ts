/*
 * Luckgram Web (luckgram-specs#139, W3 需求 8): announcements — asked from the server for
 * `platform=web` (the device's) when the page opens and at most every 30 minutes while it is in
 * the foreground; one is shown at a time, over the chat list (ui/announcementBanner.ts); a closed
 * one never comes back in this browser. Rules: announcementsLogic.ts.
 *
 * Only the device's state is sent (platform, version, language), so no AI consent is needed.
 */

import {createSignal} from 'solid-js';
import LuckgramSettings from '@/luckgram/core/settings';
import type {LuckgramApi} from '@/luckgram/core/api';
import {remoteBool} from '@/luckgram/core/remoteConfig';
import {
  Announcement, dismissAnnouncement, parseAnnouncements, parseDismissed, pickAnnouncement, shouldRefreshAnnouncements
} from '@/luckgram/core/announcementsLogic';
import {isLuckgramChinese} from '@/luckgram/text';

const KEY_DISMISSED = 'announcements_dismissed';

const [items, setItems] = createSignal<Announcement[]>([]);
const [dismissed, setDismissed] = createSignal<string[]>([]);
let api: LuckgramApi;
let lastSuccessMs = 0, lastFailureMs = 0, inFlight = false;

/** The announcement to show now, if any. Reactive. */
export function currentAnnouncement(): Announcement | undefined {
  if(!remoteBool('announcements.enabled', true)) return;
  return pickAnnouncement(items(), dismissed(), Date.now());
}

/** The user closed the banner: this announcement is not shown again in this browser. */
export function closeAnnouncement(id: string) {
  const next = dismissAnnouncement(dismissed(), id);
  setDismissed(next);
  return LuckgramSettings.set(KEY_DISMISSED, JSON.stringify(next));
}

/** For the debug page: shows `announcement` as if the server had sent it. */
export function previewAnnouncement(announcement: Announcement) {
  setItems([announcement, ...items().filter((item) => item.id !== announcement.id)]);
}

export async function refreshAnnouncements(force = false) {
  if(!api?.isConfigured || inFlight) return;
  if(!remoteBool('announcements.enabled', true)) return;
  if(!force && !shouldRefreshAnnouncements(Date.now(), lastSuccessMs, lastFailureMs)) return;

  inFlight = true;
  try {
    const response = await api.requestJSON({path: '/v1/announcements?lang=' + (isLuckgramChinese() ? 'zh' : 'en')});
    setItems(parseAnnouncements(response));
    lastSuccessMs = Date.now();
    lastFailureMs = 0;
  } catch(err) {
    lastFailureMs = Date.now();
  } finally {
    inFlight = false;
  }
}

export async function initAnnouncements(luckgramApi: LuckgramApi) {
  api = luckgramApi;
  await LuckgramSettings.ready;
  setDismissed(parseDismissed(LuckgramSettings.getString(KEY_DISMISSED)));
  LuckgramSettings.subscribe((key, value) => {
    if(key === KEY_DISMISSED) setDismissed(parseDismissed(typeof(value) === 'string' ? value : undefined));
  });

  refreshAnnouncements();
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible') refreshAnnouncements();
  });
}
