/*
 * Luckgram Web (luckgram-specs#187, W7 需求 9; specs/21 需求 6): the two extension points of
 * AI writing — the same shape as on the phones (AiWritingRegistry.java). A feature adds itself
 * with one registration and never changes the field's code (20 AI reply does; 24 AI post will).
 *
 * Menu items, in the ✦ menu of the message field:
 *
 *   registerAiMenuItem({
 *     key: 'reply', title: ['帮我回复', 'Help me reply'], icon: 'reply', order: 0,   // smaller first; the effects use 100…
 *     allowEmpty: true,                             // also offered when the field is empty
 *     visible: (host) => host.peerId.isUser(),      // by the chat that is open
 *     onClick: (host) => { … }
 *   });
 *
 * The panel over the field, and writing to the field with undo — what `host` gives an item:
 *
 *   host.showPanel(element);            // replaces any other panel; Esc closes it
 *   host.setText('new text', {undoable: true, notice: '已替换'});   // "… · 撤销" gives the previous text back
 *   host.hidePanel();
 */

import type {MenuItemLike} from '@/luckgram/writing/logic';

export type AiWritingHost = {
  peerId: PeerId,
  /** the chat's input (components/chat/input.ts), e.g. to read the chat's messages or rights */
  chatInput: any,
  getText: () => string,
  isEmpty: () => boolean,
  /** Replaces the field's text. `undoable`: a bar over the field offers the previous text back, as does Ctrl/⌘+Z. */
  setText: (text: string, options?: {undoable?: boolean, notice?: string}) => void,
  canUndo: () => boolean,
  undo: () => void,
  /** Puts a view over the field, in place of any other. `onClose` is told when it goes, however it goes. */
  showPanel: (element: HTMLElement, onClose?: () => void) => void,
  hidePanel: () => void,
  /** whether this is still the chat and the field the item was pressed in */
  isCurrent: () => boolean
};

export type AiMenuItem = MenuItemLike<AiWritingHost> & {
  /** [中文, English] */
  title: [string, string],
  icon?: Icon,
  onClick: (host: AiWritingHost) => void
};

const items: AiMenuItem[] = [];

/** @returns a function that takes the item out again */
export function registerAiMenuItem(item: AiMenuItem) {
  const index = items.findIndex((existing) => existing.key === item.key);
  if(index !== -1) items.splice(index, 1);
  items.push(item);
  return () => {
    const at = items.indexOf(item);
    if(at !== -1) items.splice(at, 1);
  };
}

export const getAiMenuItems = () => items.slice();
