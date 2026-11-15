/*
 * Luckgram Web (luckgram-specs#186, W6): a recording sent to be transcribed — as it is, or decoded
 * and cut into WAV pieces sent one after another (logic.ts says which). Nothing of the app is
 * imported here: the server's call and the decoder are given.
 */

import {encodeWav, getBaseType, getPieceRanges, getSamplesPerPiece, joinPieces, shouldSendAsIs} from '@/luckgram/voice/logic';

export type PieceResult = {text: string, language?: string};

const toResult = (value: string | PieceResult): PieceResult => typeof(value) === 'string' ? {text: value} : {text: value?.text || '', language: value?.language};

/** The language a piece was heard as, when it is one to pass on: a two-letter code, and the piece had words. */
export function getPieceLanguage(result: PieceResult): string | undefined {
  const code = (result.language || '').trim().toLowerCase();
  return /^[a-z]{2}$/.test(code) && result.text.trim() ? code : undefined;
}

/** The pieces that are done, to go on from: their texts in order, and the language they are asked in. */
export type PiecesDone = {texts: string[], language?: string, samplesPerPiece: number};

/**
 * Some pieces were transcribed and one was not: what is done is kept (`done`), to show and to go
 * on from when it is asked again. `cause` is what the piece failed with.
 */
export class PartialTranscription extends Error {
  constructor(public done: PiecesDone, public cause: unknown) {
    super('partial_transcription');
  }

  public get text() {
    return joinPieces(this.done.texts);
  }
}

/**
 * Whether a piece that failed is worth asking once more: the server did not answer in time, could
 * not be reached, or said the service behind it did not answer (503 upstream_unavailable: nothing
 * was counted). Not what asking again cannot change (the quota, a file too large, a refusal).
 */
export function isRetryablePieceError(err: unknown): boolean {
  const code = (err as any)?.code;
  return code === 'timeout' || code === 'network_error' || code === 'upstream_unavailable';
}

async function sendWithRetry(send: (piece: Blob, language?: string) => Promise<string | PieceResult>, piece: Blob, language?: string) {
  try {
    return toResult(await send(piece, language));
  } catch(err) {
    if(!isRetryablePieceError(err)) throw err;
    return toResult(await send(piece, language));
  }
}

export async function transcribeInPieces(blob: Blob, options: {
  /** a round video: only its sound is sent */
  forceDecode?: boolean,
  maxBytes: number,
  /** the recording's length, when it is known */
  durationSeconds?: number,
  /**
   * The server's call, one piece at a time. `language`: what the first piece was heard as, given
   * to the pieces after it. It answers with the text, and the language it heard when it says one.
   */
  send: (piece: Blob, language?: string) => Promise<string | PieceResult>,
  decode: (blob: Blob) => Promise<Float32Array>,
  /** what an earlier try of the same recording got done (PartialTranscription.done): not asked again */
  resume?: PiecesDone
}): Promise<string> {
  if(!options.forceDecode && shouldSendAsIs(blob.type, blob.size, options.maxBytes, options.durationSeconds)) {
    return (await sendWithRetry(options.send, new Blob([blob], {type: getBaseType(blob.type)}))).text.trim();
  }

  const samples = await options.decode(blob);
  const texts: string[] = [];
  // * one after another: the pieces are a recording's, and the quota counts minutes
  // * each piece would be heard on its own, and a piece that is mostly noise or a pause was once
  // * taken for another language and written as nonsense: the pieces after the first are told
  // * the language the first one was heard as
  let language: string;
  const samplesPerPiece = getSamplesPerPiece(options.maxBytes);
  const ranges = getPieceRanges(samples.length, samplesPerPiece);
  // * the pieces an earlier try got done stand, while they are the same pieces (cut the same way)
  const resume = options.resume;
  if(resume?.samplesPerPiece === samplesPerPiece && resume.texts.length < ranges.length) {
    texts.push(...resume.texts);
    language = resume.language;
  }

  for(let index = texts.length; index < ranges.length; ++index) {
    const [start, end] = ranges[index];
    let result: PieceResult;
    try {
      // * a piece the server did not answer in time, or that did not get through, is asked once more
      result = await sendWithRetry(options.send, new Blob([encodeWav(samples.subarray(start, end))], {type: 'audio/wav'}), language);
    } catch(err) {
      // * what is done is not thrown away with the piece that failed
      if(texts.length) throw new PartialTranscription({texts: texts.slice(), language, samplesPerPiece}, err);
      throw err;
    }

    texts.push(result.text);
    language ??= getPieceLanguage(result);
  }

  return joinPieces(texts);
}
