/*
 * Luckgram Web (luckgram-specs#139, W3 需求 8): the announcement banner's rules — reading
 * `GET /v1/announcements`, choosing the one to show, remembering the closed ones. The same as on
 * the phones (AnnouncementLogic.java, luckgram-specs#33). Pure logic, no imports.
 */

/** Ask again at most this often while the page is open. */
export const ANNOUNCEMENTS_REFRESH_MS = 30 * 60 * 1000;
export const ANNOUNCEMENTS_RETRY_MS = 5 * 60 * 1000;
/** How many closed announcements are remembered. */
export const MAX_DISMISSED = 50;

export type Announcement = {id: string, title: string, body: string, url: string, endsAtMs: number};

/** The server has already filtered them for this device and sorted them, the most important first. */
export function parseAnnouncements(response: any): Announcement[] {
  const out: Announcement[] = [];
  if(!Array.isArray(response?.announcements)) return out;

  for(const item of response.announcements) {
    if(!item || typeof(item) !== 'object') continue;
    const id = typeof(item.id) === 'string' ? item.id : '';
    const title = typeof(item.title) === 'string' ? item.title : '';
    if(!id || !title) continue;

    const url = typeof(item.url) === 'string' && item.url.startsWith('https://') ? item.url : '';
    const endsAtMs = typeof(item.ends_at) === 'string' ? Date.parse(item.ends_at) || 0 : 0;
    out.push({id, title, body: typeof(item.body) === 'string' ? item.body : '', url, endsAtMs});
  }

  return out;
}

/** The one to show: the first that was not closed and has not ended. */
export function pickAnnouncement(items: Announcement[], dismissed: string[], nowMs: number): Announcement | undefined {
  return items.find((item) => !dismissed.includes(item.id) && !(item.endsAtMs > 0 && nowMs >= item.endsAtMs));
}

/** `id` added to the closed ones (the newest last), at most MAX_DISMISSED of them. */
export function dismissAnnouncement(dismissed: string[], id: string): string[] {
  return [...dismissed.filter((other) => other !== id), id].slice(-MAX_DISMISSED);
}

export function shouldRefreshAnnouncements(nowMs: number, lastSuccessMs: number, lastFailureMs: number) {
  if(lastFailureMs > 0 && nowMs - lastFailureMs < ANNOUNCEMENTS_RETRY_MS) return false;
  return !lastSuccessMs || nowMs - lastSuccessMs >= ANNOUNCEMENTS_REFRESH_MS;
}

export function parseDismissed(json: string | undefined): string[] {
  try {
    const list = JSON.parse(json || '[]');
    return Array.isArray(list) ? list.filter((id) => typeof(id) === 'string' && id) : [];
  } catch(err) {
    return [];
  }
}
