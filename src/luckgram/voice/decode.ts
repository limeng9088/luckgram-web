/*
 * Luckgram Web (luckgram-specs#186, W6 需求 2): a recording's sound, read by the browser itself —
 * what a round video (a film) and a voice message over the server's limit are sent as.
 * Only `logic.ts` is imported: this is also run alone, in each browser, by the check of the formats.
 */

import {PIECE_SAMPLE_RATE} from '@/luckgram/voice/logic';

/** The browser cannot read the recording: "这个浏览器无法转写这条消息". */
export class DecodeError extends Error {}

/** The recording's sound, mono at 16 kHz: the browser decodes and resamples it. */
export async function decodeToSpeech(blob: Blob): Promise<Float32Array> {
  const Context: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
  const Offline: typeof OfflineAudioContext = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  if(!Context || !Offline) throw new DecodeError('no AudioContext');

  let decoded: AudioBuffer;
  const context = new Context();
  try {
    const bytes = await blob.arrayBuffer();
    // * the callback form too: an old Safari has no promise here
    decoded = await new Promise<AudioBuffer>((resolve, reject) => {
      const promise = context.decodeAudioData(bytes, resolve, reject);
      promise?.then(resolve, reject);
    });
  } catch(err) {
    throw new DecodeError((err as Error)?.message || 'decode');
  } finally {
    context.close?.().catch(() => {});
  }

  if(!decoded?.length) throw new DecodeError('empty');

  const frames = Math.max(1, Math.ceil(decoded.duration * PIECE_SAMPLE_RATE));
  const offline = new Offline(1, frames, PIECE_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}
