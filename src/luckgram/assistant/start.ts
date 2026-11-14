/*
 * Luckgram Web (luckgram-specs#188, W8 需求 2): whether the page was opened at the assistant's
 * address. Read as the first thing (luckgram/index.ts): upstream tidies the address up as it starts.
 * No imports but the constant.
 */

import {AI_HASH} from '@/luckgram/assistant/logic';

let startedAtAssistant = false;
try {
  startedAtAssistant = location.hash === AI_HASH;
} catch(err) {}

/** True once: the page that was reloaded at #/luckgram-ai goes back to it. */
export function takeStartedAtAssistant() {
  const value = startedAtAssistant;
  startedAtAssistant = false;
  return value;
}
