/*
 * Luckgram Web (luckgram-specs#139, W3 需求 5): the Luckgram API has several entries to the same
 * backend. The rule is the phones' (luckgram-specs#81, LuckgramEndpoints.java):
 *
 *  - a request goes to the entry that worked last;
 *  - when an entry cannot be reached at the network level, the same request is tried on the next;
 *    an HTTP response of any status never switches;
 *  - while a backup is in use the first entry is probed (once per start, then every 6 hours) and
 *    taken back when it answers.
 *
 * Pure logic, no imports.
 */

export const PROBE_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const HEALTH_PATH = '/v1/health';

export function normalizeEndpoint(base: string | undefined | null): string | undefined {
  if(!base) return;
  let b = base.trim();
  while(b.endsWith('/')) b = b.slice(0, -1);
  if(!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(b)) return;
  return b.toLowerCase();
}

/** A comma / whitespace separated list: https only, duplicates dropped, order kept. */
export function parseEndpoints(list: string | undefined | null): string[] {
  const out: string[] = [];
  for(const part of (list || '').split(/[\s,]+/)) {
    const base = normalizeEndpoint(part);
    if(base && !out.includes(base)) out.push(base);
  }

  return out;
}

export class LuckgramEndpoints {
  private current: number;
  /** 0: not probed since the page started, so the first check probes */
  private lastProbeMs = 0;

  /**
   * @param bases entries in order of preference
   * @param remembered the entry that worked last, if it is still one of them
   */
  constructor(public readonly bases: readonly string[], remembered?: string | null) {
    if(!bases.length) throw new Error('no API entry');
    this.current = Math.max(0, bases.indexOf(normalizeEndpoint(remembered)));
  }

  public get primary() {
    return this.bases[0];
  }

  public get currentBase() {
    return this.bases[this.current];
  }

  public get usingBackup() {
    return this.current !== 0;
  }

  /** The entries to try for one request: the current one, then the others in list order. */
  public attemptOrder(): string[] {
    return [this.bases[this.current], ...this.bases.filter((_, index) => index !== this.current)];
  }

  /** `base` answered: use it from now on. @returns whether the current entry changed */
  public markWorking(base: string): boolean {
    const index = this.bases.indexOf(base);
    if(index < 0 || index === this.current) return false;
    this.current = index;
    return true;
  }

  public shouldProbe(nowMs: number) {
    return this.current !== 0 && (!this.lastProbeMs || nowMs - this.lastProbeMs >= PROBE_INTERVAL_MS || nowMs < this.lastProbeMs);
  }

  public markProbed(nowMs: number) {
    this.lastProbeMs = nowMs;
  }

  /** The entry `url` belongs to, if any. */
  public baseOf(url: string | undefined | null): string | undefined {
    if(!url) return;
    const lower = url.toLowerCase();
    return this.bases.find((base) => lower === base || (lower.startsWith(base) && '/?#'.includes(lower[base.length])));
  }

  /** A URL the server returned that points at another entry is moved to the one in use. */
  public rewrite(url: string): string {
    const base = this.baseOf(url);
    if(!base || base === this.currentBase) return url;
    return this.currentBase + url.slice(base.length);
  }
}
