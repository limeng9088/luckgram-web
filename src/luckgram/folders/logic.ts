/*
 * Luckgram Web (luckgram-specs#191, W12; specs/06-keyword-folders.md): the rules of keyword
 * folders — what one is, which chats it holds, where it stands. A keyword folder is a folder of
 * this device: the chats whose latest messages mention one of its keywords. No app imports.
 */

import {LOCAL_FOLDER_ID_START, isLocalFolderId} from '@/luckgram/folders/guard';
import {countCharacters} from '@/luckgram/notes/logic';

export const KEYWORD_FOLDERS = 'keyword_folders';
export const MAX_FOLDERS = 10;
export const MAX_KEYWORDS = 10;
export const MAX_KEYWORD_LENGTH = 30;
export const MAX_TITLE_LENGTH = 12;
/** how many of a chat's kept messages are looked at, the latest first */
export const MAX_MESSAGES = 50;

export type FolderScope = 'private' | 'groups' | 'channels';
export const ALL_SCOPES: FolderScope[] = ['private', 'groups', 'channels'];

export type KeywordFolder = {
  /** from LOCAL_FOLDER_ID_START up; never one of Telegram's */
  id: number,
  title: string,
  keywords: string[],
  /** empty or all three: every kind of chat */
  scopes: FolderScope[]
};

export type FoldersState = {folders: KeywordFolder[]};

export const foldersKey = (account: number | string) => `f:${account}`;
export const accountOfFoldersKey = (key: string) => key.split(':')[1];

// ------------------------------------------------------------------ a folder's definition

/** Keywords as kept: trimmed, without doubles (letter case aside), empty ones gone. */
export function normalizeKeywords(keywords: (string | undefined)[]): string[] {
  const out: string[] = [], seen = new Set<string>();
  for(const raw of keywords || []) {
    const keyword = (raw || '').replace(/\s+/g, ' ').trim();
    const key = keyword.toLowerCase();
    if(!keyword || seen.has(key)) continue;
    seen.add(key);
    out.push(keyword);
  }

  return out;
}

export function normalizeScopes(scopes: FolderScope[] | undefined): FolderScope[] {
  const chosen = ALL_SCOPES.filter((scope) => scopes?.includes(scope));
  return chosen.length ? chosen : ALL_SCOPES.slice();
}

export type FolderError = 'no_title' | 'title_too_long' | 'no_keywords' | 'too_many_keywords' | 'keyword_too_long' | 'limit';

/** Why this cannot be a keyword folder, or nothing. `count`: how many there are already (when adding). */
export function checkFolder(folder: {title?: string, keywords?: string[]}, count?: number): FolderError | undefined {
  const title = (folder.title || '').trim();
  if(!title) return 'no_title';
  if(countCharacters(title) > MAX_TITLE_LENGTH) return 'title_too_long';
  const keywords = normalizeKeywords(folder.keywords);
  if(!keywords.length) return 'no_keywords';
  if(keywords.length > MAX_KEYWORDS) return 'too_many_keywords';
  if(keywords.some((keyword) => countCharacters(keyword) > MAX_KEYWORD_LENGTH)) return 'keyword_too_long';
  if(count !== undefined && count >= MAX_FOLDERS) return 'limit';
}

/** [中文, English] */
export function getFolderErrorText(error: FolderError): [string, string] {
  switch(error) {
    case 'no_title': return ['请输入文件夹名称', 'Give the folder a name'];
    case 'title_too_long': return [`名称最多 ${MAX_TITLE_LENGTH} 个字`, `The name is ${MAX_TITLE_LENGTH} characters at most`];
    case 'no_keywords': return ['请至少添加一个关键词', 'Add at least one keyword'];
    case 'too_many_keywords': return [`最多 ${MAX_KEYWORDS} 个关键词`, `${MAX_KEYWORDS} keywords at most`];
    case 'keyword_too_long': return [`每个关键词最多 ${MAX_KEYWORD_LENGTH} 个字`, `A keyword is ${MAX_KEYWORD_LENGTH} characters at most`];
    case 'limit': return [`最多 ${MAX_FOLDERS} 个关键词文件夹`, `${MAX_FOLDERS} keyword folders at most`];
  }
}

/** The lowest id of the local range that no folder has. */
export function nextFolderId(folders: KeywordFolder[]): number {
  const used = new Set(folders.map((folder) => folder.id));
  let id = LOCAL_FOLDER_ID_START;
  while(used.has(id)) ++id;
  return id;
}

export function addFolder(state: FoldersState, folder: {title: string, keywords: string[], scopes?: FolderScope[]}): FoldersState {
  if(checkFolder(folder, state.folders.length)) return state;
  return {folders: [...state.folders, {
    id: nextFolderId(state.folders),
    title: folder.title.trim(),
    keywords: normalizeKeywords(folder.keywords),
    scopes: normalizeScopes(folder.scopes)
  }]};
}

export function editFolder(state: FoldersState, id: number, folder: {title: string, keywords: string[], scopes?: FolderScope[]}): FoldersState {
  if(checkFolder(folder) || !state.folders.some((existing) => existing.id === id)) return state;
  return {folders: state.folders.map((existing) => existing.id !== id ? existing : {
    id,
    title: folder.title.trim(),
    keywords: normalizeKeywords(folder.keywords),
    scopes: normalizeScopes(folder.scopes)
  })};
}

export function removeFolder(state: FoldersState, id: number): FoldersState {
  return {folders: state.folders.filter((folder) => folder.id !== id)};
}

/** The folders in the order of `ids`; ids unknown are left out, folders not named stay at the end. */
export function reorderFolders(state: FoldersState, ids: number[]): FoldersState {
  const byId = new Map(state.folders.map((folder) => [folder.id, folder]));
  const folders: KeywordFolder[] = [];
  for(const id of ids) {
    const folder = byId.get(id);
    if(folder) {
      folders.push(folder);
      byId.delete(id);
    }
  }

  return {folders: [...folders, ...byId.values()]};
}

/** What a stored value holds, read with care: what is not a keyword folder is dropped. */
export function sanitizeFolders(value: any): FoldersState {
  const folders: KeywordFolder[] = [], seen = new Set<number>();
  for(const item of Array.isArray(value?.folders) ? value.folders : []) {
    if(!item || !isLocalFolderId(item.id) || !Number.isSafeInteger(item.id) || seen.has(item.id) || folders.length >= MAX_FOLDERS) continue;
    if(checkFolder(item)) continue;
    seen.add(item.id);
    folders.push({id: item.id, title: String(item.title).trim(), keywords: normalizeKeywords(item.keywords), scopes: normalizeScopes(item.scopes)});
  }

  return {folders};
}

// ------------------------------------------------------------------ where folders stand

/**
 * The order of all folders: Telegram's in the order given, then the keyword folders in theirs —
 * never mixed (决定 3). `order` is any list of ids (a drag's result may have put a keyword folder
 * among Telegram's).
 * @returns `cloud`: what Telegram is told; `local`: the keyword folders' own order; `all`: both
 */
export function splitFolderOrder(order: number[], localOrder: number[]): {cloud: number[], local: number[], all: number[]} {
  const cloud = order.filter((id) => !isLocalFolderId(id));
  const known = new Set(localOrder);
  const named = order.filter((id) => isLocalFolderId(id) && known.has(id));
  const local = [...new Set([...named, ...localOrder])];
  return {cloud, local, all: [...cloud, ...local]};
}

// ------------------------------------------------------------------ which chats a folder holds

// * Han, kana, hangul: scripts written without spaces between words
const CJK = /[⺀-⿟぀-ヿ㐀-䶿一-鿿가-힯豈-﫿ｦ-ﾟ]/;
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export type KeywordMatcher = {
  keywords: string[],
  /** the first keyword the text has, or nothing */
  find: (text: string | undefined) => string | undefined,
  /** every place a keyword stands at in the text, in order, none overlapping */
  findAll: (text: string | undefined) => {start: number, end: number, keyword: string}[]
};

/**
 * Letter case aside. A keyword with Chinese, Japanese or Korean characters is found anywhere in
 * the text; any other is found as a whole word ("invoice" is not in "invoices").
 */
export function makeMatcher(keywords: string[]): KeywordMatcher {
  const list = normalizeKeywords(keywords);
  const parts = list.map((keyword) => {
    const escaped = escapeRegExp(keyword).replace(/ /g, '\\s+');
    return CJK.test(keyword) ? escaped : `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`;
  });
  const source = parts.map((part) => `(${part})`).join('|');
  const make = (flags: string) => list.length ? new RegExp(source, flags) : undefined;
  const one = make('iu');

  const keywordOf = (match: RegExpExecArray) => {
    for(let i = 0; i < list.length; ++i) if(match[i + 1] !== undefined) return list[i];
    return list[0];
  };

  return {
    keywords: list,
    find: (text) => {
      const match = text && one ? one.exec(text) : undefined;
      return match ? keywordOf(match) : undefined;
    },
    findAll: (text) => {
      const out: {start: number, end: number, keyword: string}[] = [];
      const all = text ? make('giu') : undefined;
      if(!all) return out;
      let match: RegExpExecArray;
      while((match = all.exec(text))) {
        if(!match[0].length) {
          ++all.lastIndex;
          continue;
        }

        out.push({start: match.index, end: match.index + match[0].length, keyword: keywordOf(match)});
      }

      return out;
    }
  };
}

export type ChatKind = 'private' | 'group' | 'channel';

/** Whether a chat of this kind is one the folder looks at; archived chats are not. */
export function isInScope(folder: {scopes: FolderScope[]}, chat: {kind: ChatKind, archived: boolean}): boolean {
  if(chat.archived) return false;
  const scopes = normalizeScopes(folder.scopes);
  return scopes.includes(chat.kind === 'private' ? 'private' : chat.kind === 'group' ? 'groups' : 'channels');
}

/** The first of the texts (the latest message first) that has a keyword: its index and the keyword. */
export function findHit(matcher: KeywordMatcher, texts: (string | undefined)[], max = MAX_MESSAGES): {index: number, keyword: string} | undefined {
  const count = Math.min(texts.length, max);
  for(let index = 0; index < count; ++index) {
    const keyword = matcher.find(texts[index]);
    if(keyword) return {index, keyword};
  }
}
