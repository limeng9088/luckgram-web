/*
 * Luckgram Web (luckgram-specs#185, W5 需求 3、8): translations that were made, and which
 * messages show theirs — kept in IndexedDB `luckgram` (store `cache`), by account, 2000 of each
 * and 7 days at most. Read into memory once; a bubble asks synchronously as it is drawn.
 *
 * Upstream's own cache of translations lives in the worker's memory and is gone with a reload.
 */

import type {LuckgramStorage} from '@/luckgram/core/storage';
import {
  CacheRecord, StateRecord, Translation, getKeysToPrune, isKeyOfAccount, stateKey, translationKey
} from '@/luckgram/translate/logic';

type AnyRecord = CacheRecord | StateRecord;

export class TranslationCache {
  private records = new Map<string, AnyRecord>();
  public ready: Promise<void>;

  constructor(private storage: LuckgramStorage, private now: () => number = Date.now) {
    this.ready = this.load();
  }

  private async load() {
    try {
      const stored = await this.storage.getAll('cache');
      for(const key in stored) {
        const record = stored[key];
        // * what was written while the stored ones were on their way is newer
        if(record && typeof(record) === 'object' && !this.records.has(key)) this.records.set(key, record);
      }

      this.prune();
    } catch(err) {
      // * no IndexedDB for this page: the translations live as long as the page does
      console.warn('[luckgram] translations are not stored:', (err as Error)?.message);
    }
  }

  private write(set: Record<string, AnyRecord>, remove: string[] = []) {
    return this.storage.update('cache', set, remove).catch(() => {});
  }

  private prune() {
    const times = new Map<string, number>();
    this.records.forEach((record, key) => times.set(key, record.at));
    const drop = getKeysToPrune(times, this.now());
    for(const key of drop) this.records.delete(key);
    if(drop.length) this.write({}, drop);
  }

  // ------------------------------------------------------------------ translations

  public get(account: number | string, toLang: string, text: string): Translation | undefined {
    const record = this.records.get(translationKey(account, toLang, text)) as CacheRecord;
    if(!record || typeof(record.t) !== 'string') return;
    return {text: record.t, entities: record.e, from: record.f, via: record.v === 't' ? 'telegram' : 'luckgram'};
  }

  public put(account: number | string, toLang: string, text: string, translation: Translation) {
    const key = translationKey(account, toLang, text);
    const record: CacheRecord = {t: translation.text, at: this.now(), v: translation.via === 'telegram' ? 't' : 'l'};
    if(translation.entities?.length) record.e = translation.entities;
    if(translation.from) record.f = translation.from;
    this.records.set(key, record);
    this.prune();
    return this.write({[key]: record});
  }

  // ------------------------------------------------------------------ which messages show a translation

  /** The language a message is shown translated to, or nothing. */
  public getState(account: number | string, peerId: number | string, mid: number | string): string | undefined {
    const record = this.records.get(stateKey(account, peerId, mid)) as StateRecord;
    return typeof(record?.l) === 'string' ? record.l : undefined;
  }

  /** `toLang` undefined: the translation was taken back. */
  public setState(account: number | string, peerId: number | string, mid: number | string, toLang: string | undefined) {
    const key = stateKey(account, peerId, mid);
    if(!toLang) {
      if(!this.records.delete(key)) return Promise.resolve();
      return this.write({}, [key]);
    }

    const record: StateRecord = {l: toLang, at: this.now()};
    this.records.set(key, record);
    this.prune();
    return this.write({[key]: record});
  }

  /** An account logged out: nothing of it stays. */
  public clearAccount(account: number | string) {
    const drop = [...this.records.keys()].filter((key) => isKeyOfAccount(key, account));
    for(const key of drop) this.records.delete(key);
    return drop.length ? this.write({}, drop) : Promise.resolve();
  }

  public get size() {
    return this.records.size;
  }
}
