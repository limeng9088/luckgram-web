/*
 * Luckgram Web (luckgram-specs#186, W6): the press on "转写失败 · 重试" / "转写未完成 · 重试".
 *
 * The failure is also said in a toast, and upstream's toast takes the first press anywhere in
 * the page while it shows (about three seconds: "a click anywhere hides the toast" — it is heard
 * on the document in the capture phase and stopped there). So the line, there from the same
 * moment, did nothing when pressed at once. The line's press is heard here the same way, by a
 * listener that is there before any toast's: it runs first, asks again, and hides the toast.
 */

import {hideToast} from '@components/toast';

const RETRY_CLASS = 'luckgram-transcribe-retry';
type RetryLine = HTMLElement & {luckgramRetry?: () => void};

let installed = false;

function onClick(e: MouseEvent) {
  const line = (e.target as Element)?.closest?.<RetryLine>('.' + RETRY_CLASS);
  const retry = line?.luckgramRetry;
  if(!retry) return;

  // * the press is the line's alone: neither the toast's nor the bubble's
  e.preventDefault();
  e.stopImmediatePropagation();
  try {
    hideToast();
  } catch(err) {}

  retry();
}

/**
 * To be called before a failure can be shown (as a voice row or a round video is drawn): the
 * listener has to be on the document before the toast's own, which is put there as it opens.
 */
export function installRetryLines() {
  if(installed || typeof(document) === 'undefined') return;
  installed = true;
  document.addEventListener('click', onClick, true);
}

/** What a press on this line does. */
export function bindRetryLine(line: HTMLElement, retry: () => void) {
  installRetryLines();
  (line as RetryLine).luckgramRetry = retry;
}
