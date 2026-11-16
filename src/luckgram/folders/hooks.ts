/*
 * Luckgram Web (luckgram-specs#191, W12): how upstream's code of folders (a tab's menu, the
 * settings page) reaches a keyword folder's own editing without importing it — the left column
 * puts the actions here as it is built. No imports (src/tests/importGraphBudget).
 */

export type KeywordFolderActions = {
  /** opens the page of a keyword folder; without an id, of a new one */
  edit: (id?: number) => void,
  /** asks, then deletes it */
  remove: (id: number) => void
};

let actions: KeywordFolderActions;

export function setKeywordFolderActions(next: KeywordFolderActions) {
  actions = next;
}

const run = (what: () => void) => {
  try {
    what();
  } catch(err) {
    console.warn('[luckgram] keyword folders', (err as Error)?.message);
  }
};

export const editKeywordFolder = (id?: number) => run(() => actions?.edit(id));
export const removeKeywordFolder = (id: number) => run(() => actions?.remove(id));
