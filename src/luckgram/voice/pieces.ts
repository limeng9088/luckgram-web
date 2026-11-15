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
  decode: (blob: Blob) => Promise<Float32Array>
}): Promise<string> {
  if(!options.forceDecode && shouldSendAsIs(blob.type, blob.size, options.maxBytes, options.durationSeconds)) {
    return toResult(await options.send(new Blob([blob], {type: getBaseType(blob.type)}))).text.trim();
  }

  const samples = await options.decode(blob);
  const texts: string[] = [];
  // * one after another: the pieces are a recording's, and the quota counts minutes
  // * each piece would be heard on its own, and a piece that is mostly noise or a pause was once
  // * taken for another language and written as nonsense: the pieces after the first are told
  // * the language the first one was heard as
  let language: string;
  for(const [start, end] of getPieceRanges(samples.length, getSamplesPerPiece(options.maxBytes))) {
    const result = toResult(await options.send(new Blob([encodeWav(samples.subarray(start, end))], {type: 'audio/wav'}), language));
    texts.push(result.text);
    language ??= getPieceLanguage(result);
  }

  return joinPieces(texts);
}
