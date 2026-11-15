/*
 * Luckgram Web (luckgram-specs#186, W6): a recording sent to be transcribed — as it is, or decoded
 * and cut into WAV pieces sent one after another (logic.ts says which). Nothing of the app is
 * imported here: the server's call and the decoder are given.
 */

import {encodeWav, getBaseType, getPieceRanges, getSamplesPerPiece, joinPieces, shouldSendAsIs} from '@/luckgram/voice/logic';

export async function transcribeInPieces(blob: Blob, options: {
  /** a round video: only its sound is sent */
  forceDecode?: boolean,
  maxBytes: number,
  /** the recording's length, when it is known */
  durationSeconds?: number,
  /** the server's call, one piece at a time */
  send: (piece: Blob) => Promise<string>,
  decode: (blob: Blob) => Promise<Float32Array>
}): Promise<string> {
  if(!options.forceDecode && shouldSendAsIs(blob.type, blob.size, options.maxBytes, options.durationSeconds)) {
    return (await options.send(new Blob([blob], {type: getBaseType(blob.type)}))).trim();
  }

  const samples = await options.decode(blob);
  const texts: string[] = [];
  // * one after another: the pieces are a recording's, and the quota counts minutes
  for(const [start, end] of getPieceRanges(samples.length, getSamplesPerPiece(options.maxBytes))) {
    texts.push(await options.send(new Blob([encodeWav(samples.subarray(start, end))], {type: 'audio/wav'})));
  }

  return joinPieces(texts);
}
