/*
 * Luckgram Web (luckgram-specs#190, W11b): how the field's list reaches "管理" without importing
 * the left column — the column puts the opener here as it is built (sidebarLeft). No imports:
 * the field is imported by the chat, the column imports the chat (src/tests/importGraphBudget).
 */

let opener: () => void;

export function setRepliesManagerOpener(next: () => void) {
  opener = next;
}

export function openRepliesManager() {
  try {
    opener?.();
  } catch(err) {
    console.warn('[luckgram] quick replies: manage', (err as Error)?.message);
  }
}
