/*
 * Luckgram Web (luckgram-specs#187, W7 需求 8): a narrow window has no room in the field's row
 * for a translate button of its own — the ✦ menu has "翻译" and "翻译成…" there instead.
 */

import {isFeatureEnabled} from '@/luckgram/core/features';
import {AI_WRITING} from '@/luckgram/writing/logic';

/** At this width and less the row has no room for a translate button of its own (需求 8). */
export const NARROW_QUERY = '(max-width: 600px)';
export const isNarrowWindow = () => {
  try {
    return window.matchMedia(NARROW_QUERY).matches;
  } catch(err) {
    return false;
  }
};

/** Whether the ✦ menu takes W5's translation in: a narrow window, with AI writing there. */
export const isTranslateInAiMenu = () => isNarrowWindow() && isFeatureEnabled(AI_WRITING);
