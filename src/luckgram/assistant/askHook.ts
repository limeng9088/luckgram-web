/*
 * Luckgram Web (luckgram-specs#188, W8 需求 5): how a message's menu reaches "问 AI" without
 * importing the assistant — the menu is imported by the chat, the assistant imports the chat's
 * column, and an import between them, even a lazy one, makes one import cycle of the two
 * (src/tests/importGraphBudget). The assistant's entries put the handler here as the app starts.
 * No imports.
 */

type AskHandler = (message: any) => unknown;
let handler: AskHandler;

export function setAskAiHandler(next: AskHandler) {
  handler = next;
}

/** Whether "问 AI" can do anything yet: the assistant's entries are mounted. */
export const hasAskAiHandler = () => !!handler;

export function askAi(message: any) {
  try {
    return handler?.(message);
  } catch(err) {
    console.warn('[luckgram] ask AI', (err as Error)?.message);
  }
}
