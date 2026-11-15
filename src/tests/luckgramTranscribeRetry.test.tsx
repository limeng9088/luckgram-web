// * Luckgram Web (luckgram-specs#186, W6): the voice row when a part of a long recording was
// * transcribed and a piece failed — what is shown, and that "转写未完成 · 重试" answers at once

import {vi} from 'vitest';
import {render} from 'solid-js/web';

vi.mock('@components/popups/premium', () => ({default: {show: () => {}}}));

// * the bubble makes its changes a moment later (bubbles.ts: after what is being shown): kept here until flushed
const changes: (() => void)[] = [];
vi.mock('@components/chat/changeBubble', () => ({default: (_element: HTMLElement, callback: () => void) => changes.push(callback)}));
const flush = () => changes.splice(0).forEach((change) => change());

// * upstream's toast, as far as presses go: while it shows, the first press anywhere in the page hides
// * it and goes no further (overlayClickHandler.ts: the document, the capture phase)
const toastState = vi.hoisted(() => ({open: false, swallowed: 0, listener: undefined as (e: Event) => void}));
vi.mock('@components/toast', () => {
  const hideToast = () => {
    if(!toastState.open) return;
    toastState.open = false;
    document.removeEventListener('click', toastState.listener, true);
  };
  const toast = () => {
    hideToast();
    toastState.open = true;
    toastState.listener = (e: Event) => {
      ++toastState.swallowed;
      e.stopPropagation();
      e.preventDefault();
      hideToast();
    };
    document.addEventListener('click', toastState.listener, true);
  };
  return {toast, toastNew: toast, hideToast};
});

const calls: {resolve: (text: string) => void, reject: (err: any) => void}[] = [];
vi.mock('@/luckgram/voice/transcribe', () => ({
  isFreeTranscribeOn: () => true,
  getCachedTranscriptionWhenReady: async(): Promise<string> => undefined,
  getVoiceErrorText: () => 'failed',
  getVoiceRetryText: (partial?: boolean) => partial ? '转写未完成 · 重试' : '转写失败 · 重试',
  transcribeMessage: () => new Promise<string>((resolve, reject) => calls.push({resolve, reject}))
}));

import rootScope from '@lib/rootScope';
import ListenerSetter from '@helpers/listenerSetter';
import createAudioTranscription from '@components/audioTranscription';

const tick = async() => {
  for(let i = 0; i < 10; ++i) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('luckgram voice row: a part transcribed, a piece failed', () => {
  test('the part keeps the text\'s own look, and the retry line answers the moment it shows', async() => {
    vi.spyOn(rootScope, 'getPremium').mockReturnValue(false);
    // * as in a bubble: the text is mounted beside the row, in its `.document-wrapper`
    const host = document.createElement('div');
    host.classList.add('document-wrapper');
    document.body.append(host);
    const row = Object.assign(document.createElement('div'), {message: {_: 'message', peerId: 1, mid: 2, pFlags: {}}}) as any;
    host.append(row);

    const transcription = createAudioTranscription({listenerSetter: new ListenerSetter(), getRow: () => row});
    const dispose = render(() => transcription.button(), row);
    await tick();

    row.querySelector('.audio-to-text-button').click();
    await tick();
    expect(calls.length).toBe(1);

    // * the second piece fails: the first one's text is there for the row
    calls[0].reject({partialText: '第一段的文字'});
    await tick();
    flush();
    await tick();

    const text = host.querySelector('.audio-transcribed-text');
    const retry = host.querySelector<HTMLElement>('.luckgram-transcribe-retry');
    expect(host.querySelector('.luckgram-transcribe-partial').textContent).toBe('第一段的文字');
    expect(retry.textContent).toBe('转写未完成 · 重试');
    // * the error's colour is the line's, not the whole text's
    expect(text.classList.contains('is-error')).toBe(false);

    // * pressed at once, while the toast that says the failure still shows: asked again all the same —
    // * the toast does not take the press, and goes
    expect(toastState.open).toBe(true);
    retry.click();
    await tick();
    expect(calls.length).toBe(2);
    expect(toastState.swallowed).toBe(0);
    expect(toastState.open).toBe(false);
    expect(host.querySelector('.audio-transcribed-text').textContent).toContain('第一段的文字');
    expect(host.querySelector('.luckgram-transcribe-retry')).toBeNull();

    // * pressed again while it is asked: not asked twice
    row.querySelector('.audio-to-text-button').click();
    await tick();
    expect(calls.length).toBe(2);

    // * it fails again, and the retry is pressed before the bubble has shown the failure: asked again all the same
    calls[1].reject({partialText: '第一段的文字'});
    await tick();
    flush();
    await tick();
    host.querySelector<HTMLElement>('.luckgram-transcribe-retry').click();
    await tick();
    expect(calls.length).toBe(3);
    expect(toastState.swallowed).toBe(0);

    calls[2].resolve('第一段的文字第二段的文字');
    await tick();
    flush();
    await tick();
    expect(host.querySelector('.audio-transcribed-text').textContent).toContain('第一段的文字第二段的文字');
    expect(host.querySelector('.luckgram-transcribe-retry')).toBeNull();
    expect(host.querySelector('.audio-transcribed-text').classList.contains('is-error')).toBe(false);

    dispose();
    host.remove();
  });

  test('nothing transcribed: the line alone, in the error\'s look', async() => {
    vi.spyOn(rootScope, 'getPremium').mockReturnValue(false);
    calls.length = 0;
    // * as in a bubble: the text is mounted beside the row, in its `.document-wrapper`
    const host = document.createElement('div');
    host.classList.add('document-wrapper');
    document.body.append(host);
    const row = Object.assign(document.createElement('div'), {message: {_: 'message', peerId: 1, mid: 3, pFlags: {}}}) as any;
    host.append(row);
    const transcription = createAudioTranscription({listenerSetter: new ListenerSetter(), getRow: () => row});
    const dispose = render(() => transcription.button(), row);
    await tick();
    row.querySelector('.audio-to-text-button').click();
    await tick();
    calls[0].reject({});
    await tick();
    flush();
    await tick();

    expect(host.querySelector('.luckgram-transcribe-partial')).toBeNull();
    expect(host.querySelector('.luckgram-transcribe-retry').textContent).toBe('转写失败 · 重试');
    expect(host.querySelector('.audio-transcribed-text').classList.contains('is-error')).toBe(true);

    // * a press elsewhere is still the toast's, as upstream has it: only the retry line is let through
    expect(toastState.open).toBe(true);
    const before = toastState.swallowed;
    host.click();
    expect(toastState.swallowed).toBe(before + 1);
    expect(calls.length).toBe(1);
    dispose();
    host.remove();
  });
});
