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

type Layer = {close: () => void, alive?: () => boolean};

const layers: Layer[] = [];
let bound = false;

/** Drops the layers that went without saying so (their element was taken out of the page). */
function prune() {
  for(let i = layers.length - 1; i >= 0; --i) {
    let alive = true;
    try {
      alive = layers[i].alive?.() ?? true;
    } catch(err) {}

    if(!alive) layers.splice(i, 1);
  }

  return layers.length;
}

function onKeyDown(e: KeyboardEvent) {
  if(e.key !== 'Escape' || e.defaultPrevented || !prune()) return;
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
  appNavigationController.registerEscapeHandler(() => !prune());
  window.addEventListener('keydown', onKeyDown, true);
}

/**
 * Says a layer is open: Esc calls `close` (once) instead of reaching upstream. Returns what to call
 * when the layer closes by any other way; calling it again, or after Esc, does nothing.
 * @param alive for a layer that may leave the page without closing: whether it is still there
 */
export function holdEscape(close: () => void, alive?: () => boolean): () => void {
  bind();
  const layer: Layer = {close, alive};
  layers.push(layer);
  return () => {
    const index = layers.indexOf(layer);
    if(index !== -1) layers.splice(index, 1);
  };
}

/** How many layers hold Esc now (for tests). */
export function heldEscapeCount() {
  return prune();
}
