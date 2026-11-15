/*
 * Luckgram Web (luckgram-specs#186, W6 需求 1–3): a voice message or a round video turned into
 * text for an account that is not Premium's — downloaded, sent to the Luckgram server
 * (`/v1/ai/transcribe`, through the AI client: device token, consent the first time), kept by message.
 *
 * What is sent (logic.ts): the file as it is when the server takes its type and size and it is no
 * longer than three minutes; otherwise, and for every round video, its sound decoded here and cut
 * into WAV pieces of two minutes at most — each a request the server answers well within a minute.
 *
 * Upstream's own button and the text under the voice row show the result (audioTranscription.tsx,
 * roundVideoBubble.ts ask here). A Premium account never comes here: Telegram transcribes for it.
 */

import type {Document, Message} from '@layer';
import rootScope from '@lib/rootScope';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import {isTempId} from '@lib/appManagers/utils/messages/isTempId';
import getMediaFromMessage from '@lib/appManagers/utils/messages/getMediaFromMessage';
import appDownloadManager from '@lib/appDownloadManager';
import {isFeatureEnabled} from '@/luckgram/core/features';
import {LuckgramApiError} from '@/luckgram/core/errors';
import {remoteNumber} from '@/luckgram/core/remoteConfig';
import luckgramAI from '@/luckgram/core/instance';
import {lgText, luckgramChineseScript} from '@/luckgram/text';
import {getTranslateAccount, translationCache} from '@/luckgram/translate';
import {DecodeError, decodeToSpeech} from '@/luckgram/voice/decode';
import {
  DEFAULT_MAX_MB, FREE_TRANSCRIBE, KEY_MAX_MB, VoiceFailure, getMaxBytes, getVoiceFailure, getVoiceFailureText, voiceKey
} from '@/luckgram/voice/logic';
import {PartialTranscription, PieceResult, PiecesDone, transcribeInPieces} from '@/luckgram/voice/pieces';
import {waitForSentMessage} from '@/luckgram/voice/sent';

export class VoiceError extends Error {
  /** what was transcribed before a piece failed: shown, and kept to go on from */
  public partialText?: string;

  constructor(public failure: VoiceFailure) {
    super('voice_' + failure);
  }
}

/** Whether a tap on the transcribe button is Luckgram's to answer: the feature is on and the account is not Premium's. */
export const isFreeTranscribeOn = () => !rootScope.getPremium() && isFeatureEnabled(FREE_TRANSCRIBE);

export const getVoiceErrorText = (err: unknown) => lgText(...getVoiceFailureText(err instanceof VoiceError ? err.failure : 'other'));
/** @param partial a part is there already: the line stands after it */
export const getVoiceRetryText = (partial?: boolean) => partial ?
  lgText('转写未完成 · 重试', 'Transcription unfinished · Retry') :
  lgText('转写失败 · 重试', 'Transcription failed · Retry');

/**
 * @param forceDecode a round video: only its sound is sent
 * @param durationSeconds the recording's length, when the message says it
 * @param send the server's call, one piece at a time
 */
export function transcribeBlob(
  blob: Blob,
  options: {forceDecode?: boolean, maxBytes?: number, durationSeconds?: number, resume?: PiecesDone, send?: (piece: Blob, language?: string) => Promise<string | PieceResult>, decode?: (blob: Blob) => Promise<Float32Array>} = {}
): Promise<string> {
  return transcribeInPieces(blob, {
    forceDecode: options.forceDecode,
    durationSeconds: options.durationSeconds,
    resume: options.resume,
    maxBytes: options.maxBytes ?? getMaxBytes(remoteNumber(KEY_MAX_MB, DEFAULT_MAX_MB)),
    // * a Chinese interface says which script it reads: Simplified or Traditional
    send: options.send ?? ((piece: Blob, language?: string) => luckgramAI.transcribe(piece, {script: luckgramChineseScript(), language})),
    decode: options.decode ?? decodeToSpeech
  });
}

export function toVoiceError(err: unknown): VoiceError {
  if(err instanceof VoiceError) return err;
  if(err instanceof PartialTranscription) {
    const error = toVoiceError(err.cause);
    error.partialText = err.text;
    return error;
  }

  const code = err instanceof LuckgramApiError ? err.code : undefined;
  return new VoiceError(getVoiceFailure(code, navigator.onLine !== false, err instanceof DecodeError));
}

const inFlight = new Map<string, Promise<string>>();
// * the pieces of a long recording that are done, when one of them failed: asking again goes on from
// * there. Kept while the page is open — a reload starts the recording over
const partials = new Map<string, PiecesDone>();

/** The transcription a message already has here, if any (a bubble asks as it is drawn). */
export function getCachedTranscription(message: Message.message): string | undefined {
  return translationCache.getText(voiceKey(getTranslateAccount(), message.peerId, message.mid));
}

export async function getCachedTranscriptionWhenReady(message: Message.message): Promise<string | undefined> {
  await translationCache.ready;
  return getCachedTranscription(message);
}

/** How long a message that is being sent is waited for before its transcription is given up. */
const SENDING_TIMEOUT_MS = 120000;

/**
 * The message as the server has it. A bubble drawn while its message was being sent may still
 * hold what it was drawn from — a local message with a temporary id, whose file the server does
 * not know — and nothing can be downloaded by that: asked for a transcription a moment after a
 * round video was sent, it failed at once. The bubble is given the new id when the message is
 * sent (bubbles.ts), so `element` says where the message is now; one still on its way is waited for.
 */
export function resolveSentMessage(message: Message.message, element?: HTMLElement, timeoutMs = SENDING_TIMEOUT_MS): Promise<Message.message> {
  const managers = bindManagersToSession(rootScope.managers);
  return waitForSentMessage<Message.message>({
    message,
    isTempId,
    timeoutMs,
    getBubbleMid: () => Number(element?.closest<HTMLElement>('[data-mid]')?.dataset.mid) || undefined,
    getMessage: async(mid) => {
      const sent = await managers.appMessagesManager.getMessageByPeer(message.peerId, mid) as Message.message;
      return sent?._ === 'message' ? sent : undefined;
    },
    subscribe: (listener) => {
      const onSent = (e: {tempId: number, message: any}) => listener(e.tempId, e.message);
      rootScope.addEventListener('message_sent', onSent);
      return () => rootScope.removeEventListener('message_sent', onSent);
    }
  }).then((sent) => {
    if(!sent) throw new VoiceError('other');
    return sent;
  });
}

/**
 * The message's voice or round video as text.
 * @param element the message's bubble or something in it: where a message drawn while it was sent is now
 * @throws VoiceError, whose `failure` says what to tell the user
 */
export async function transcribeMessage(message: Message.message, element?: HTMLElement): Promise<string> {
  try {
    message = await resolveSentMessage(message, element);
  } catch(err) {
    throw toVoiceError(err);
  }

  return transcribeSentMessage(message);
}

function transcribeSentMessage(message: Message.message): Promise<string> {
  const key = voiceKey(getTranslateAccount(), message.peerId, message.mid);
  let promise = inFlight.get(key);
  if(promise) return promise;

  promise = (async() => {
    await translationCache.ready;
    const cached = translationCache.getText(key);
    if(cached) return cached;

    const started = Date.now();
    try {
      const doc = getMediaFromMessage(message, true) as Document.document;
      if(doc?._ !== 'document') throw new VoiceError('other');

      const downloaded = await appDownloadManager.downloadMedia({media: doc});
      const blob = new Blob([downloaded], {type: doc.mime_type || downloaded.type});
      // * the message says how long it is: a long one is cut into pieces even when its file is small
      const text = await transcribeBlob(blob, {
        forceDecode: doc.type === 'round' || doc.type === 'video', durationSeconds: doc.duration, resume: partials.get(key)
      });
      partials.delete(key);
      if(!text) throw new VoiceError('other');

      translationCache.putText(key, text);
      // * the path and the time, never the text
      console.debug('[luckgram] transcribe', {type: doc.type, bytes: blob.size, ms: Date.now() - started});
      return text;
    } catch(err) {
      if(err instanceof PartialTranscription) partials.set(key, err.done);
      const error = toVoiceError(err);
      console.debug('[luckgram] transcribe', {failure: error.failure, partial: !!error.partialText, ms: Date.now() - started});
      throw error;
    }
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, promise);
  return promise;
}
