/*
 * Luckgram Web (luckgram-specs#190, W11b 需求 9、11): quick replies — kept by account in
 * IndexedDB `luckgram` (store `replies`), never sent anywhere. Read into memory once; what
 * changes is told to those who listen (the field's list, the settings page).
 */

import type {LuckgramStorage} from '@/luckgram/core/storage';
import {
  QuickReply, RepliesState, accountOfRepliesKey, addReply, checkReply, editReply, moveReply, removeReply, reorderReplies, repliesKey, sanitizeState,
  seedReplies, ReplyError
} from '@/luckgram/replies/logic';

export class RepliesStore {
  private states = new Map<string, RepliesState>();
  private listeners = new Set<() => void>();
  private counter = 0;
  public ready: Promise<void>;

  constructor(private storage: LuckgramStorage, private isChinese: () => boolean = () => true, private now: () => number = Date.now) {
    this.ready = this.load();
  }

  private async load() {
    try {
      const stored = await this.storage.getAll('replies');
      for(const key in stored) {
        const state = sanitizeState(stored[key]);
        if(state && !this.states.has(key)) this.states.set(key, state);
      }
    } catch(err) {
      // * no IndexedDB for this page: the templates live as long as the page does
      console.warn('[luckgram] quick replies are not stored:', (err as Error)?.message);
    }

    this.emit();
  }

  private makeId = () => `${this.now().toString(36)}${(++this.counter).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  private emit() {
    for(const listener of [...this.listeners]) {
      try {
        listener();
      } catch(err) {
        console.warn('[luckgram] quick replies listener', (err as Error)?.message);
      }
    }
  }

  public subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private put(account: number | string, state: RepliesState) {
    const key = repliesKey(account);
    if(this.states.get(key) === state) return Promise.resolve();
    this.states.set(key, state);
    this.emit();
    return this.storage.update('replies', {[key]: JSON.parse(JSON.stringify(state))}).catch(() => {});
  }

  /** The account's templates in their order. A first use gets the examples (kept from then on). */
  public list(account: number | string): QuickReply[] {
    const key = repliesKey(account);
    const state = this.states.get(key);
    if(state?.seeded) return state.items;
    const seeded = seedReplies(state, this.isChinese(), this.makeId);
    this.states.set(key, seeded);
    this.storage.update('replies', {[key]: JSON.parse(JSON.stringify(seeded))}).catch(() => {});
    return seeded.items;
  }

  private state(account: number | string): RepliesState {
    this.list(account);
    return this.states.get(repliesKey(account));
  }

  /** @returns why it was not added, or nothing */
  public add(account: number | string, text: string): ReplyError | undefined {
    const state = this.state(account);
    const error = checkReply(text, state.items, true);
    if(!error) this.put(account, addReply(state, text, this.makeId));
    return error;
  }

  public edit(account: number | string, id: string, text: string): ReplyError | undefined {
    const state = this.state(account);
    const error = checkReply(text, state.items.filter((item) => item.id !== id), false);
    if(!error) this.put(account, editReply(state, id, text));
    return error;
  }

  public remove(account: number | string, id: string) {
    return this.put(account, removeReply(this.state(account), id));
  }

  public move(account: number | string, id: string, index: number) {
    return this.put(account, moveReply(this.state(account), id, index));
  }

  public reorder(account: number | string, ids: string[]) {
    return this.put(account, reorderReplies(this.state(account), ids));
  }

  /** The account logged out here: nothing of it stays. */
  public deleteAccount(account: number | string) {
    const key = repliesKey(account);
    if(!this.states.delete(key)) return Promise.resolve();
    this.emit();
    return this.storage.update('replies', {}, [key]).catch(() => {});
  }

  /** Templates of accounts that are no longer signed in. */
  public cleanOrphans(accounts: (number | string)[]) {
    const signedIn = new Set(accounts.map(String));
    const drop = [...this.states.keys()].filter((key) => !signedIn.has(accountOfRepliesKey(key)));
    for(const key of drop) this.states.delete(key);
    if(!drop.length) return Promise.resolve();
    this.emit();
    return this.storage.update('replies', {}, drop).catch(() => {});
  }
}
