/*
 * Luckgram Web (luckgram-specs#192, W10 需求 6、7; specs/07-profile-info.md): the rules of the
 * profile's ID and registration rows — the same as the phones' `ProfileInfoLogic`. No imports.
 */

export const PROFILE_DETAILS = 'profile_details';

export type PeerKind = 'user' | 'chat' | 'channel';

/** The ID as shown and copied: users and bots as is, legacy groups `-id`, supergroups and channels `-100id`. */
export function displayId(kind: PeerKind, id: number | string): string {
  const bare = String(id).replace(/^-/, '');
  return kind === 'channel' ? '-100' + bare : kind === 'chat' ? '-' + bare : bare;
}

/** "复制链接": only users and bots have one. */
export function userLink(kind: PeerKind, id: number | string): string | undefined {
  return kind === 'user' ? 'tg://user?id=' + String(id).replace(/^-/, '') : undefined;
}

/** One row of the table: the first user id seen in that month. `monthIndex` is year × 12 + month − 1. */
export type DatePoint = {id: number, monthIndex: number};

export type RegistrationEstimate = {before2014: true, year?: undefined, month?: undefined, after?: undefined} |
  {before2014?: false, year: number, month: number, /** newer than the table: its last month, or later */ after?: boolean};

/** "id,YYYY-MM" a line, `#` for comments. A malformed line, or one out of order, is left out. */
export function parseTable(text: string | undefined): DatePoint[] {
  const points: DatePoint[] = [];
  for(const raw of (text || '').split('\n')) {
    const line = raw.trim();
    if(!line || line.startsWith('#')) continue;
    const match = /^(\d+)\s*,\s*(\d{4})-(\d{2})$/.exec(line);
    if(!match) continue;
    const id = +match[1], month = +match[3];
    if(!Number.isSafeInteger(id) || month < 1 || month > 12) continue;
    const point = {id, monthIndex: +match[2] * 12 + month - 1};
    const last = points[points.length - 1];
    if(last && (point.id <= last.id || point.monthIndex < last.monthIndex)) continue;
    points.push(point);
  }

  return points;
}

/**
 * The month a user id was registered in, about: a straight line between the table's rows.
 * Under the first row: "before 2014". From the last row on (an id newer than the table knows):
 * "the table's last month, or later" — no month is guessed past what the table was built from, but
 * the row does not vanish for the newest accounts either. With no table: nothing.
 */
export function estimateRegistration(points: DatePoint[] | undefined, userId: number): RegistrationEstimate | undefined {
  if(!points || points.length < 2 || !(userId > 0)) return;
  if(userId < points[0].id) return {before2014: true};
  for(let i = 0; i + 1 < points.length; ++i) {
    const a = points[i], b = points[i + 1];
    if(userId >= a.id && userId < b.id) {
      const t = (userId - a.id) / (b.id - a.id);
      const m = a.monthIndex + Math.floor(t * (b.monthIndex - a.monthIndex));
      if(m < 2014 * 12) return {before2014: true};
      return {year: Math.floor(m / 12), month: m % 12 + 1};
    }
  }

  const last = points[points.length - 1];
  return {year: Math.floor(last.monthIndex / 12), month: last.monthIndex % 12 + 1, after: true};
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** [中文, English]: "约 2019 年 10 月" / "about Oct 2019"; "早于 2014 年" / "before 2014"; "约 2026 年 1 月之后" / "Jan 2026 or later". */
export function formatEstimate(estimate: RegistrationEstimate | undefined): [string, string] | undefined {
  if(!estimate) return;
  if(estimate.before2014) return ['早于 2014 年', 'before 2014'];
  if(estimate.after) return [`约 ${estimate.year} 年 ${estimate.month} 月之后`, `about ${MONTHS_EN[estimate.month - 1]} ${estimate.year} or later`];
  return [`约 ${estimate.year} 年 ${estimate.month} 月`, `about ${MONTHS_EN[estimate.month - 1]} ${estimate.year}`];
}
