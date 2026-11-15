/*
 * Luckgram Web (luckgram-specs#191, W12 决定 1、5): the keyword folders of one account as
 * upstream's folder storage holds them (in the worker) — their definitions in order, what makes
 * each a folder upstream's code can list, and which chats each holds. No app imports: what it
 * needs of a chat comes in with the question.
 */

import {isLocalFolderId} from '@/luckgram/folders/guard';
import {ChatKind, KeywordFolder, KeywordMatcher, findHit, isInScope, makeMatcher, sanitizeFolders} from '@/luckgram/folders/logic';

export type KeywordHit = {index: number, keyword: string};

export type ChatForKeywords = {
  peerId: number,
  kind: ChatKind,
  archived: boolean,
  /** the id of the chat's latest message: what was found is kept until it changes */
  top: number,
  /** the texts of the chat's kept messages, the latest first; asked only when they are needed */
  getTexts: () => (string | undefined)[]
};

export type FoldersDiff = {added: KeywordFolder[], changed: KeywordFolder[], removed: number[], orderChanged: boolean};

/** A keyword folder in the shape of one of Telegram's: no chats of its own, no flags; marked as what it is. */
export function toDialogFilter(folder: KeywordFolder): any {
  return {
    _: 'dialogFilter',
    id: folder.id,
    title: {_: 'textWithEntities', text: folder.title, entities: []},
    pFlags: {},
    pinned_peers: [],
    include_peers: [],
    exclude_peers: [],
    pinnedPeerIds: [],
    includePeerIds: [],
    excludePeerIds: [],
    luckgramKeywords: {keywords: folder.keywords.slice(), scopes: folder.scopes.slice()}
  };
}

const same = (a: KeywordFolder, b: KeywordFolder) => a.title === b.title && a.keywords.join('\n') === b.keywords.join('\n') && a.scopes.join() === b.scopes.join();

export class KeywordFolderSet {
  private folders: KeywordFolder[] = [];
  private matchers = new Map<number, KeywordMatcher>();
  private found = new Map<number, Map<number, {top: number, hit: KeywordHit | undefined}>>();

  public get order(): number[] {
    return this.folders.map((folder) => folder.id);
  }

  public get all(): KeywordFolder[] {
    return this.folders;
  }

  public has(id: number) {
    return isLocalFolderId(id) && this.folders.some((folder) => folder.id === id);
  }

  public get(id: number) {
    return this.folders.find((folder) => folder.id === id);
  }

  /** Takes the account's keyword folders as they now are. @returns what changed */
  public set(value: KeywordFolder[]): FoldersDiff {
    const next = sanitizeFolders({folders: value}).folders;
    const before = new Map(this.folders.map((folder) => [folder.id, folder]));
    const diff: FoldersDiff = {added: [], changed: [], removed: [], orderChanged: false};
    for(const folder of next) {
      const old = before.get(folder.id);
      if(!old) diff.added.push(folder);
      else if(!same(old, folder)) diff.changed.push(folder);
      before.delete(folder.id);
    }

    diff.removed = [...before.keys()];
    diff.orderChanged = this.order.join() !== next.map((folder) => folder.id).join();

    // * what a folder found is of its keywords and scopes as they were
    for(const id of [...diff.removed, ...diff.changed.map((folder) => folder.id)]) {
      this.matchers.delete(id);
      this.found.delete(id);
    }

    this.folders = next;
    return diff;
  }

  private getMatcher(folder: KeywordFolder) {
    let matcher = this.matchers.get(folder.id);
    if(!matcher) this.matchers.set(folder.id, matcher = makeMatcher(folder.keywords));
    return matcher;
  }

  /** Whether the folder holds the chat: a kind it looks at, not archived, a keyword in its latest messages. */
  public test(id: number, chat: ChatForKeywords): boolean {
    const folder = this.get(id);
    if(!folder || !isInScope(folder, chat)) return false;

    let found = this.found.get(id);
    if(!found) this.found.set(id, found = new Map());
    const kept = found.get(chat.peerId);
    if(kept && kept.top === chat.top) return !!kept.hit;

    let hit: KeywordHit;
    try {
      hit = findHit(this.getMatcher(folder), chat.getTexts());
    } catch(err) {
      hit = undefined;
    }

    found.set(chat.peerId, {top: chat.top, hit});
    return !!hit;
  }

  /** What was found in the chat when it was last looked at. */
  public getHit(id: number, peerId: number): KeywordHit | undefined {
    return this.found.get(id)?.get(peerId)?.hit;
  }

  /** A chat is gone, or its messages changed without a new one coming (an edit, a deletion). */
  public forget(peerId: number) {
    for(const found of this.found.values()) found.delete(peerId);
  }
}
