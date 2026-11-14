/*
 * Luckgram Web (luckgram-specs#186, W6 需求 5–8): dictation — a button beside the emoji button;
 * a press starts recording (a bar over the field shows the level), another stops it, and what was
 * said is put at the cursor as text.
 *
 *  - its own MediaRecorder, apart from upstream's voice and round-video recorder; the two never
 *    run together: while upstream records this button does nothing, while this records upstream's
 *    does not start (recording.ts asks `isActive`);
 *  - the recording goes to `/v1/ai/transcribe` as the browser made it (WebM in Chrome and Edge,
 *    Ogg in Firefox, MP4 in Safari), in pieces when it is over the server's limit;
 *  - with "AI 整理" on, the text is tidied by `/v1/ai/chat` (`task=writing`, `effect=dictation`).
 *
 * One controller per chat input; input.ts creates and mounts it and tells it when the field changed.
 */

import type ChatInput from '@components/chat/input';
import {toast} from '@components/toast';
import {attachClickEvent} from '@helpers/dom/clickEvent';
import LuckgramSettings from '@/luckgram/core/settings';
import {isFeatureEnabled} from '@/luckgram/core/features';
import {watchFeatures} from '@/luckgram/core/hooks';
import luckgramAI from '@/luckgram/core/instance';
import {lgText} from '@/luckgram/text';
import {
  DICTATION, KEY_DICTATION_TIDY, getInsertion, getLevel, getMicFailure, getMicFailureText, getUploadType, pickRecorderType
} from '@/luckgram/voice/logic';
import {getVoiceErrorText, transcribeBlob, toVoiceError} from '@/luckgram/voice/transcribe';

const BARS = 5;

export default class LuckgramDictation {
  private button: HTMLElement;
  private bar: HTMLElement;
  private bars: HTMLElement[] = [];
  private stream: MediaStream;
  private recorder: MediaRecorder;
  private audioContext: AudioContext;
  private levelFrame: number;
  private chunks: Blob[] = [];
  private state: 'idle' | 'starting' | 'recording' | 'working' = 'idle';
  private peerId: PeerId;
  private run = 0;

  constructor(private input: ChatInput) {}

  /** Recording, or about to: upstream's recorder does not start meanwhile. */
  public get isActive() {
    return this.state === 'starting' || this.state === 'recording';
  }

  private get isOn() {
    return isFeatureEnabled(DICTATION);
  }

  // ------------------------------------------------------------------ the button

  /** After the row's buttons are there. */
  public mount() {
    const anchor = (this.input as any).btnToggleEmoticons as HTMLElement;
    if(!anchor?.parentElement || this.button) return;

    this.button = this.input.createButtonIcon('microphone luckgram-dictation', {noRipple: true});
    this.button.classList.add('hide');
    this.setLabel();
    attachClickEvent(this.button, (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggle();
    });
    anchor.after(this.button);
    // * the switch in the settings takes effect at once, not at the next key press
    const stop = watchFeatures([DICTATION], () => this.update());
    (this.input.chat as any)?.destroyMiddlewareHelper?.get().onDestroy(stop);
    this.update();
  }

  private setLabel() {
    if(!this.button) return;
    const label = this.state === 'recording' ? lgText('停止并转成文字', 'Stop and turn into text') : lgText('语音输入', 'Dictation');
    this.button.title = label;
    this.button.setAttribute('aria-label', label);
    this.button.classList.toggle('is-recording', this.state === 'recording' || this.state === 'starting');
    this.button.classList.toggle('is-loading', this.state === 'working');
  }

  /** The field or the chat changed (input.ts: updateSendBtn). */
  public update() {
    try {
      if(this.peerId !== this.input.chat?.peerId) {
        this.peerId = this.input.chat?.peerId;
        this.cancel();
      }

      const upstreamRecording = !!(this.input as any).recording;
      // * upstream's recording takes the row over; an edit and a forward keep the field, so dictation stays
      this.button?.classList.toggle('hide', !this.isOn || upstreamRecording);
      if(!this.isOn && this.state !== 'idle') this.cancel();
    } catch(err) {
      console.warn('[luckgram] dictation: field', (err as Error)?.message);
    }
  }

  // ------------------------------------------------------------------ recording

  private toggle() {
    if(this.state === 'recording') this.stop();
    else if(this.state === 'idle') this.start();
  }

  private async start() {
    if(!this.isOn || (this.input as any).recording) return;

    const run = ++this.run;
    this.state = 'starting';
    this.setLabel();

    const hasApi = !!navigator.mediaDevices?.getUserMedia && typeof(MediaRecorder) !== 'undefined';
    try {
      if(!hasApi) throw Object.assign(new Error('unsupported'), {name: 'Unsupported'});
      // * the browser asks for the microphone the first time; a refusal is remembered by it, not asked again here
      const stream = await navigator.mediaDevices.getUserMedia({audio: true});
      if(this.run !== run) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      this.stream = stream;
      const type = pickRecorderType((mimeType) => MediaRecorder.isTypeSupported(mimeType));
      this.recorder = new MediaRecorder(stream, type ? {mimeType: type} : undefined);
      this.chunks = [];
      this.recorder.addEventListener('dataavailable', (event) => {
        if(event.data?.size) this.chunks.push(event.data);
      });
      this.recorder.start(1000);
      this.state = 'recording';
      this.setLabel();
      this.showBar();
      this.watchLevel(stream);
    } catch(err) {
      if(this.run !== run) return;
      this.release();
      this.state = 'idle';
      this.setLabel();
      toast(lgText(...getMicFailureText(getMicFailure((err as Error)?.name, hasApi))));
    }
  }

  private async stop() {
    const recorder = this.recorder;
    if(!recorder || this.state !== 'recording') return;

    const run = this.run;
    const peerId = this.input.chat.peerId;
    this.state = 'working';
    this.setLabel();
    this.setBarText(lgText('正在转成文字…', 'Turning into text…'));

    try {
      const stopped = new Promise<void>((resolve) => recorder.addEventListener('stop', () => resolve(), {once: true}));
      recorder.stop();
      await stopped;
      const recordedType = recorder.mimeType || this.chunks[0]?.type;
      const blob = new Blob(this.chunks, {type: getUploadType(recordedType)});
      this.release();
      if(!blob.size) throw toVoiceError(undefined);

      let text = await transcribeBlob(blob);
      if(text && LuckgramSettings.getBool(KEY_DICTATION_TIDY, false)) {
        this.setBarText(lgText('正在整理…', 'Tidying up…'));
        // * the words as they were said, if the tidying fails
        text = (await luckgramAI.chat({
          task: 'writing',
          params: {effect: 'dictation'},
          messages: [{role: 'user', content: text}]
        }).catch((): string => undefined))?.trim() || text;
      }

      // * the chat was left meanwhile: the words were for the other one
      if(this.run !== run || this.input.chat.peerId !== peerId) return;
      if(text) this.insert(text);
      else toast(lgText('没有听到说话', 'No speech was heard'));
    } catch(err) {
      if(this.run === run) toast(getVoiceErrorText(toVoiceError(err)));
    } finally {
      if(this.run === run) {
        this.release();
        this.hideBar();
        this.state = 'idle';
        this.setLabel();
      }
    }
  }

  private insert(text: string) {
    const selection = window.getSelection();
    const field = this.input.messageInput;
    let before = '';
    // * what stands before the cursor decides whether a space goes first
    if(selection?.rangeCount && field?.contains(selection.anchorNode)) {
      const range = selection.getRangeAt(0).cloneRange();
      range.collapse(true);
      range.setStart(field, 0);
      before = range.toString();
    } else {
      before = field?.textContent || '';
    }

    const insertion = getInsertion(text, before);
    if(insertion) this.input.insertAtCaret(insertion, undefined, false);
  }

  /** Leaves without a word: another chat was opened, or the feature was switched off. */
  public cancel() {
    if(this.state === 'idle') return;
    ++this.run;
    try {
      if(this.recorder?.state !== 'inactive') this.recorder?.stop();
    } catch(err) {}

    this.release();
    this.hideBar();
    this.state = 'idle';
    this.setLabel();
  }

  private release() {
    cancelAnimationFrame(this.levelFrame);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.audioContext?.close?.().catch(() => {});
    this.stream = this.recorder = this.audioContext = undefined;
  }

  // ------------------------------------------------------------------ the bar over the field

  private showBar() {
    this.hideBar();
    const bar = this.bar = document.createElement('div');
    bar.classList.add('luckgram-dictation-bar');

    const level = document.createElement('div');
    level.classList.add('luckgram-dictation-level');
    level.setAttribute('aria-hidden', 'true');
    this.bars = [];
    for(let i = 0; i < BARS; ++i) {
      const item = document.createElement('span');
      level.append(item);
      this.bars.push(item);
    }

    const text = document.createElement('span');
    text.classList.add('luckgram-dictation-text');
    text.textContent = lgText('正在听…再点一次按钮结束', 'Listening… press the button again to finish');

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.classList.add('luckgram-dictation-cancel');
    cancel.textContent = lgText('取消', 'Cancel');
    attachClickEvent(cancel, (e) => {
      e.preventDefault();
      this.cancel();
    });

    bar.append(level, text, cancel);
    const row = this.button?.parentElement;
    if(row?.parentElement) row.parentElement.insertBefore(bar, row);
  }

  private setBarText(text: string) {
    const element = this.bar?.querySelector('.luckgram-dictation-text');
    if(element) element.textContent = text;
    this.bar?.classList.add('is-working');
  }

  private hideBar() {
    this.bar?.remove();
    this.bar = undefined;
    this.bars = [];
  }

  private watchLevel(stream: MediaStream) {
    try {
      const Context: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      const context = this.audioContext = new Context();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      const bytes = new Uint8Array(analyser.fftSize);
      const history: number[] = new Array(BARS).fill(0);
      let tick = 0;
      const draw = () => {
        if(this.state !== 'recording') return;
        analyser.getByteTimeDomainData(bytes);
        // * a bar every few frames, the newest at the end: the level moves across
        if(tick++ % 4 === 0) {
          history.push(getLevel(bytes));
          history.shift();
          this.bars.forEach((bar, index) => bar.style.transform = `scaleY(${.2 + history[index] * .8})`);
        }

        this.levelFrame = requestAnimationFrame(draw);
      };
      draw();
    } catch(err) {
      // * no level, the recording goes on
    }
  }
}
