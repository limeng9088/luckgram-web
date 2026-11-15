/*
 * Luckgram Web (luckgram-specs#191, W12b): what the chat list and the chat ask of keyword
 * folders — a folder's keywords, by its id — without importing their store: the store puts the
 * lookup here as it starts. Only the rules are imported (src/tests/importGraphBudget).
 */

import {isLocalFolderId} from '@/luckgram/folders/guard';
import {KeywordFolder, KeywordMatcher, makeMatcher} from '@/luckgram/folders/logic';

let lookup: (id: number) => KeywordFolder | undefined;
const matchers = new WeakMap<KeywordFolder, KeywordMatcher>();

export function setKeywordFolderLookup(next: (id: number) => KeywordFolder | undefined) {
  lookup = next;
}

/** The matcher of a keyword folder that is there and switched on; nothing for any other folder. */
export function getKeywordMatcher(filterId: number | undefined): KeywordMatcher | undefined {
  if(!isLocalFolderId(filterId) || !lookup) return;
  let folder: KeywordFolder;
  try {
    folder = lookup(filterId);
  } catch(err) {}

  if(!folder) return;
  let matcher = matchers.get(folder);
  if(!matcher) matchers.set(folder, matcher = makeMatcher(folder.keywords));
  return matcher;
}
