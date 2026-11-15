/*
 * Luckgram Web: Esc for Luckgram's own layers (a panel over the field, a list, an editor, a card).
 *
 * Upstream's navigation controller takes Esc on the window, in the capture phase — before any
 * listener of ours on the document or on an element — and closes the topmost thing it knows:
 * with only a chat open, the chat. A layer it does not know has to say it is open: while one is
 * held here, upstream leaves Esc alone and the key closes the layer opened last — only that one —
 * and goes no further.
 */

import appNavigationController from '@components/appNavigationController';

type Layer = {close: () => void};

const layers: Layer[] = [];
let bound = false;

function onKeyDown(e: KeyboardEvent) {
  if(e.key !== 'Escape' || e.defaultPrevented || !layers.length) return;
  // * a text being composed (an input method's candidates) takes its own Esc
  if(e.isComposing || e.keyCode === 229) return;

  e.preventDefault();
  e.stopImmediatePropagation();
  const layer = layers.pop();
  try {
    layer.close();
  } catch(err) {
    console.warn('[luckgram] closing on Esc', (err as Error)?.message);
  }
}

function bind() {
  if(bound) return;
  bound = true;
  appNavigationController.registerEscapeHandler(() => !layers.length);
  window.addEventListener('keydown', onKeyDown, true);
}

/**
 * Says a layer is open: Esc calls `close` (once) instead of reaching upstream. Returns what to call
 * when the layer closes by any other way; calling it again, or after Esc, does nothing.
 */
export function holdEscape(close: () => void): () => void {
  bind();
  const layer: Layer = {close};
  layers.push(layer);
  return () => {
    const index = layers.indexOf(layer);
    if(index !== -1) layers.splice(index, 1);
  };
}

/** How many layers hold Esc now (for tests). */
export function heldEscapeCount() {
  return layers.length;
}
