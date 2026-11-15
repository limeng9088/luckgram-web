/*
 * Luckgram Web (luckgram-specs#192, W10 需求 4): private notes — kept by account in IndexedDB
 * `luckgram` (store `notes`), never sent anywhere. Read into memory once; what changes is told
 * to those who listen (the profile's row, the chat's bar, the list).
 *
 * When an account leaves: this tab logging its own account out deletes its notes at once
 * (`deleteAccount`); an account that left elsewhere is cleaned up as the page starts
 * (`cleanOrphans`), as the assistant's conversations are.
 */

import type {LuckgramStorage} from '@/luckgram/core/storage';
import {Note, NotePeer, accountOfNoteKey, isValidPeer, noteKey, normalizeNote, sortNotes} from '@/luckgram/notes/logic';

type Listener = (account: string, peer: NotePeer | undefined) => void;

export class NotesStore {
  private notes = new Map<string, Note>();
  private listeners = new Set<Listener>();
  public ready: Promise<void>;

  constructor(private storage: LuckgramStorage, private now: () => number = Date.now) {
    this.ready = this.load();
  }

  private async load() {
    try {
      const stored = await this.storage.getAll('notes');
      for(const key in stored) {
        const note = stored[key] as Note;
        if(note && typeof note.text === 'string' && isValidPeer(note.peer) && !this.notes.has(key)) this.notes.set(key, note);
      }
    } catch(err) {
      // * no IndexedDB for this page: the notes live as long as the page does
      console.warn('[luckgram] notes are not stored:', (err as Error)?.message);
    }

    this.emit('', undefined);
  }

  private write(set: Record<string, Note>, remove: string[] = []) {
    return this.storage.update('notes', set, remove).catch(() => {});
  }

  private emit(account: string, peer: NotePeer | undefined) {
    for(const listener of [...this.listeners]) {
      try {
        listener(account, peer);
      } catch(err) {
        console.warn('[luckgram] notes listener', (err as Error)?.message);
      }
    }
  }

  /** `peer` is undefined when everything may have changed (loaded, imported, an account gone). */
  public subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public get(account: number | string, peer: NotePeer): Note | undefined {
    return this.notes.get(noteKey(account, peer));
  }

  /** The account's notes, the newest first. */
  public list(account: number | string): Note[] {
    const own = String(account);
    return sortNotes([...this.notes.values()].filter((note) => note.account === own));
  }

  public count(account: number | string) {
    const own = String(account);
    let count = 0;
    for(const note of this.notes.values()) if(note.account === own) ++count;
    return count;
  }

  /** Writes the note; an empty text deletes it. `updatedAt` only for what comes from a file. */
  public set(account: number | string, peer: NotePeer, text: string, updatedAt?: number) {
    const key = noteKey(account, peer);
    const value = normalizeNote(text);
    const before = this.notes.get(key);
    let done: Promise<void>;
    if(!value) {
      if(!before) return Promise.resolve();
      this.notes.delete(key);
      done = this.write({}, [key]);
    } else {
      if(before?.text === value && updatedAt === undefined) return Promise.resolve();
      const note: Note = {
        account: String(account),
        peer: {type: peer.type, id: peer.id},
        text: value,
        updatedAt: updatedAt ?? Math.floor(this.now() / 1000),
        expanded: before?.expanded
      };
      this.notes.set(key, note);
      done = this.write({[key]: {...note}});
    }

    this.emit(String(account), peer);
    return done;
  }

  public delete(account: number | string, peer: NotePeer) {
    return this.set(account, peer, '');
  }

  /** Whether the chat's bar shows the whole text: remembered with the note, not a change of it. */
  public setExpanded(account: number | string, peer: NotePeer, expanded: boolean) {
    const key = noteKey(account, peer);
    const note = this.notes.get(key);
    if(!note || !!note.expanded === expanded) return Promise.resolve();
    note.expanded = expanded || undefined;
    this.emit(String(account), peer);
    return this.write({[key]: {...note}});
  }

  /** Several notes at once, from a file. */
  public async setMany(account: number | string, notes: {peer: NotePeer, text: string, updatedAt: number}[]) {
    const set: Record<string, Note> = {};
    for(const item of notes) {
      const text = normalizeNote(item.text);
      if(!text || !isValidPeer(item.peer)) continue;
      const key = noteKey(account, item.peer);
      const note: Note = {
        account: String(account),
        peer: {type: item.peer.type, id: item.peer.id},
        text,
        updatedAt: item.updatedAt || Math.floor(this.now() / 1000),
        expanded: this.notes.get(key)?.expanded
      };
      this.notes.set(key, note);
      set[key] = {...note};
    }

    if(!Object.keys(set).length) return;
    this.emit(String(account), undefined);
    await this.write(set);
  }

  /** The account logged out here: nothing of it stays. */
  public deleteAccount(account: number | string) {
    const own = String(account);
    const drop = [...this.notes.keys()].filter((key) => accountOfNoteKey(key) === own);
    for(const key of drop) this.notes.delete(key);
    if(!drop.length) return Promise.resolve();
    this.emit(own, undefined);
    return this.write({}, drop);
  }

  /** Notes of accounts that are no longer signed in. */
  public cleanOrphans(accounts: (number | string)[]) {
    const signedIn = new Set(accounts.map(String));
    const drop = [...this.notes.keys()].filter((key) => !signedIn.has(accountOfNoteKey(key)));
    for(const key of drop) this.notes.delete(key);
    if(!drop.length) return Promise.resolve();
    this.emit('', undefined);
    return this.write({}, drop);
  }
}
