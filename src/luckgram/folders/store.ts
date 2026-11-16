/*
 * Luckgram Web (luckgram-specs#191, W12 决定 6): keyword folders — their definitions and their
 * order among themselves, kept by account in IndexedDB `luckgram` (store `folders`). They are
 * not in what upstream keeps of folders, and nowhere on Telegram's side.
 */

import type {LuckgramStorage} from '@/luckgram/core/storage';
import {
  FolderError, FolderScope, FoldersState, KeywordFolder, accountOfFoldersKey, addFolder, checkFolder, editFolder, foldersKey, removeFolder,
  reorderFolders, sanitizeFolders
} from '@/luckgram/folders/logic';

export type FolderDraft = {title: string, keywords: string[], scopes?: FolderScope[]};

export class FoldersStore {
  private states = new Map<string, FoldersState>();
  private listeners = new Set<(account: string) => void>();
  public ready: Promise<void>;

  constructor(private storage: LuckgramStorage) {
    this.ready = this.load();
  }

  private async load() {
    try {
      const stored = await this.storage.getAll('folders');
      for(const key in stored) {
        if(!this.states.has(key)) this.states.set(key, sanitizeFolders(stored[key]));
      }
    } catch(err) {
      // * no IndexedDB for this page: the folders live as long as the page does
      console.warn('[luckgram] keyword folders are not stored:', (err as Error)?.message);
    }

    this.emit('');
  }

  private emit(account: string) {
    for(const listener of [...this.listeners]) {
      try {
        listener(account);
      } catch(err) {
        console.warn('[luckgram] keyword folders listener', (err as Error)?.message);
      }
    }
  }

  /** `account` is empty when everything may have changed (loaded, accounts cleaned). */
  public subscribe(listener: (account: string) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private state(account: number | string): FoldersState {
    return this.states.get(foldersKey(account)) || {folders: []};
  }

  private put(account: number | string, state: FoldersState) {
    const key = foldersKey(account);
    if(this.states.get(key) === state || (!this.states.has(key) && !state.folders.length)) return Promise.resolve();
    this.states.set(key, state);
    this.emit(String(account));
    return this.storage.update('folders', {[key]: JSON.parse(JSON.stringify(state))}).catch(() => {});
  }

  /** The account's keyword folders, in their order. */
  public list(account: number | string): KeywordFolder[] {
    return this.state(account).folders;
  }

  public get(account: number | string, id: number) {
    return this.list(account).find((folder) => folder.id === id);
  }

  /** @returns why it was not added, or the folder */
  public add(account: number | string, draft: FolderDraft): FolderError | KeywordFolder {
    const state = this.state(account);
    const error = checkFolder(draft, state.folders.length);
    if(error) return error;
    const next = addFolder(state, draft);
    this.put(account, next);
    return next.folders[next.folders.length - 1];
  }

  public edit(account: number | string, id: number, draft: FolderDraft): FolderError | undefined {
    const error = checkFolder(draft);
    if(!error) this.put(account, editFolder(this.state(account), id, draft));
    return error;
  }

  public remove(account: number | string, id: number) {
    return this.put(account, removeFolder(this.state(account), id));
  }

  public reorder(account: number | string, ids: number[]) {
    const state = this.state(account);
    const next = reorderFolders(state, ids);
    if(next.folders.map((folder) => folder.id).join() === state.folders.map((folder) => folder.id).join()) return Promise.resolve();
    return this.put(account, next);
  }

  /** The account logged out here: nothing of it stays. */
  public deleteAccount(account: number | string) {
    const key = foldersKey(account);
    if(!this.states.delete(key)) return Promise.resolve();
    this.emit(String(account));
    return this.storage.update('folders', {}, [key]).catch(() => {});
  }

  /** Folders of accounts that are no longer signed in. */
  public cleanOrphans(accounts: (number | string)[]) {
    const signedIn = new Set(accounts.map(String));
    const drop = [...this.states.keys()].filter((key) => !signedIn.has(accountOfFoldersKey(key)));
    for(const key of drop) this.states.delete(key);
    if(!drop.length) return Promise.resolve();
    this.emit('');
    return this.storage.update('folders', {}, drop).catch(() => {});
  }
}
