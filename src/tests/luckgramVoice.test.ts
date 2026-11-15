// * Luckgram Web (luckgram-specs#186, W6): free transcription — what is sent, in how many pieces

import {
  PIECE_SAMPLE_RATE, encodeWav, getBaseType, getInsertion, getLevel, getMaxBytes, getMicFailure, getMicFailureText, getPieceRanges,
  getSamplesPerPiece, getUploadType, getVoiceFailure, getVoiceFailureText, joinPieces, pickRecorderType, shouldSendAsIs, voiceKey
} from '@/luckgram/voice/logic';
import {isKeyOfAccount} from '@/luckgram/translate/logic';

const MB = 1024 * 1024;

describe('luckgram voice: what is sent', () => {
  test('the limit is the server\'s, 4 MB at most, with a little room', () => {
    expect(getMaxBytes(4)).toBeLessThan(4 * MB);
    expect(getMaxBytes(4)).toBeGreaterThan(3.8 * MB);
    expect(getMaxBytes(1)).toBeLessThan(1 * MB);
    expect(getMaxBytes(25)).toBe(getMaxBytes(4));
    expect(getMaxBytes(undefined)).toBe(getMaxBytes(4));
    expect(getMaxBytes(0)).toBe(getMaxBytes(4));
  });

  test('a voice message under the limit goes as it is; a larger one, or a type the server does not take, is decoded', () => {
    const max = getMaxBytes(4);
    expect(getBaseType('audio/ogg; codecs=opus')).toBe('audio/ogg');
    expect(shouldSendAsIs('audio/ogg; codecs=opus', 1 * MB, max)).toBe(true);
    expect(shouldSendAsIs('audio/mp4', 1 * MB, max)).toBe(true);
    expect(shouldSendAsIs('audio/ogg', 5 * MB, max)).toBe(false);
    expect(shouldSendAsIs('video/mp4', 1 * MB, max)).toBe(false);
    expect(shouldSendAsIs(undefined, 1 * MB, max)).toBe(false);
    expect(shouldSendAsIs('audio/ogg', 0, max)).toBe(false);
  });

  test('a recording over three minutes is cut into pieces even when its file is small (specs#186)', () => {
    const max = getMaxBytes(4);
    // * Opus: twenty minutes fit 4 MB, and the server has a minute to answer a request
    expect(shouldSendAsIs('audio/ogg', 3 * MB, max, 20 * 60)).toBe(false);
    expect(shouldSendAsIs('audio/ogg', 400 * 1024, max, 181)).toBe(false);
    expect(shouldSendAsIs('audio/ogg', 400 * 1024, max, 180)).toBe(true);
    expect(shouldSendAsIs('audio/ogg', 3 * MB, max, 28)).toBe(true);
    // * the size limit still holds for a short one
    expect(shouldSendAsIs('audio/ogg', 5 * MB, max, 28)).toBe(false);
    // * no length known: as it is only while the file is small
    expect(shouldSendAsIs('audio/webm', 1 * MB, max)).toBe(true);
    expect(shouldSendAsIs('audio/webm', 1 * MB + 1, max)).toBe(false);
    expect(shouldSendAsIs('audio/webm', 2 * MB, max, 0)).toBe(false);

    // * a piece is two minutes at most, whatever size the server allows
    expect(getSamplesPerPiece(getMaxBytes(4)) / PIECE_SAMPLE_RATE).toBeLessThanOrEqual(120);
    expect(getSamplesPerPiece(25 * MB) / PIECE_SAMPLE_RATE).toBe(120);
    expect(getSamplesPerPiece(1 * MB) / PIECE_SAMPLE_RATE).toBeLessThan(40);
  });

  test('a long voice message: decoded and sent piece by piece, each two minutes at most', async() => {
    const {transcribeInPieces} = await import('@/luckgram/voice/pieces');
    const sent: Blob[] = [];
    const send = async(piece: Blob) => (sent.push(piece), 'p' + sent.length);
    // * 7 minutes of sound in a small Opus file
    const decode = async() => new Float32Array(7 * 60 * PIECE_SAMPLE_RATE);
    const blob = new Blob([new Uint8Array(900 * 1024)], {type: 'audio/ogg'});

    expect(await transcribeInPieces(blob, {maxBytes: getMaxBytes(4), durationSeconds: 7 * 60, send, decode})).toBe('p1 p2 p3 p4');
    expect(sent.map((piece) => piece.type)).toEqual(['audio/wav', 'audio/wav', 'audio/wav', 'audio/wav']);
    for(const piece of sent) expect((piece.size - 44) / 2 / PIECE_SAMPLE_RATE).toBeLessThanOrEqual(120);

    // * a short one of the same size goes as it is, in one request
    sent.length = 0;
    await transcribeInPieces(blob, {maxBytes: getMaxBytes(4), durationSeconds: 28, send, decode});
    expect(sent.length).toBe(1);
    expect(sent[0].type).toBe('audio/ogg');
  });

  test('the pieces after the first are told the language the first was heard as (specs#186: a piece taken for Welsh)', async() => {
    const {transcribeInPieces, getPieceLanguage} = await import('@/luckgram/voice/pieces');
    const decode = async() => new Float32Array(5 * 60 * PIECE_SAMPLE_RATE);
    const blob = new Blob([new Uint8Array(600 * 1024)], {type: 'audio/ogg'});
    const run = async(answers: {text: string, language?: string}[]) => {
      const asked: (string | undefined)[] = [];
      const text = await transcribeInPieces(blob, {maxBytes: getMaxBytes(4), durationSeconds: 300, decode, send: async(_piece, language) => {
        asked.push(language);
        return answers[asked.length - 1];
      }});
      return {asked, text};
    };

    // * the first says Chinese: the second and the third are asked in Chinese
    expect((await run([{text: '第一段', language: 'zh'}, {text: '第二段', language: 'zh'}, {text: '第三段', language: 'zh'}])).asked).toEqual([undefined, 'zh', 'zh']);
    // * what a later piece says of itself changes nothing
    expect((await run([{text: 'one', language: 'EN'}, {text: 'two', language: 'cy'}, {text: 'three'}])).asked).toEqual([undefined, 'en', 'en']);
    // * a first piece without words (a pause) says nothing to go by: the next one with words does
    expect((await run([{text: ' ', language: 'cy'}, {text: '第二段', language: 'zh'}, {text: '第三段'}])).asked).toEqual([undefined, undefined, 'zh']);
    // * no language in the answer, or not a two-letter code: the pieces are heard on their own, as before
    expect((await run([{text: 'a'}, {text: 'b', language: 'chinese'}, {text: 'c'}])).asked).toEqual([undefined, undefined, undefined]);

    expect(getPieceLanguage({text: '你好', language: 'zh'})).toBe('zh');
    expect(getPieceLanguage({text: '', language: 'zh'})).toBeUndefined();
    expect(getPieceLanguage({text: 'hi', language: ''})).toBeUndefined();
  });

  test('a piece that fails is asked once more; what is done is kept and gone on from (specs#186)', async() => {
    const {transcribeInPieces, PartialTranscription, isRetryablePieceError} = await import('@/luckgram/voice/pieces');
    const decode = async() => new Float32Array(5 * 60 * PIECE_SAMPLE_RATE);
    const blob = new Blob([new Uint8Array(600 * 1024)], {type: 'audio/ogg'});
    const fail = (code: string) => Object.assign(new Error(code), {code});
    /** `plan[n]`: what the n-th call does — a text, or an error's code */
    const make = (plan: (string | {error: string})[]) => {
      const asked: (string | undefined)[] = [];
      const send = async(_piece: Blob, language?: string) => {
        const step = plan[asked.length];
        asked.push(language);
        if(typeof(step) !== 'string') throw fail(step.error);
        return {text: step, language: 'zh'};
      };
      return {asked, send};
    };
    const base = {maxBytes: getMaxBytes(4), durationSeconds: 300, decode};

    expect(isRetryablePieceError(fail('timeout'))).toBe(true);
    expect(isRetryablePieceError(fail('network_error'))).toBe(true);
    expect(isRetryablePieceError(fail('upstream_unavailable'))).toBe(true);
    expect(isRetryablePieceError(fail('content_rejected'))).toBe(false);
    expect(isRetryablePieceError(fail('quota_exceeded'))).toBe(false);
    expect(isRetryablePieceError(fail('input_too_large'))).toBe(false);
    expect(isRetryablePieceError(new Error('x'))).toBe(false);

    // * the second piece gets a 503 once: asked again, and the whole is there — 4 calls for 3 pieces
    const once = make(['一', {error: 'upstream_unavailable'}, '二', '三']);
    expect(await transcribeInPieces(blob, {...base, send: once.send})).toBe('一二三');
    expect(once.asked).toEqual([undefined, 'zh', 'zh', 'zh']);

    // * it fails twice: the first piece is kept, with what it takes to go on
    const twice = make(['一', {error: 'timeout'}, {error: 'network_error'}]);
    const error: any = await transcribeInPieces(blob, {...base, send: twice.send}).catch((err) => err);
    expect(error).toBeInstanceOf(PartialTranscription);
    expect(error.text).toBe('一');
    expect(error.cause.code).toBe('network_error');
    expect(error.done.texts).toEqual(['一']);
    expect(error.done.language).toBe('zh');
    expect(twice.asked.length).toBe(3);

    // * asked again: only the second and the third piece are sent, in the first one's language
    const again = make(['二', '三']);
    expect(await transcribeInPieces(blob, {...base, send: again.send, resume: error.done})).toBe('一二三');
    expect(again.asked).toEqual(['zh', 'zh']);

    // * the quota is not asked twice, and what is done still stands
    const quota = make(['一', '二', {error: 'quota_exceeded'}]);
    const stopped: any = await transcribeInPieces(blob, {...base, send: quota.send}).catch((err) => err);
    expect(stopped).toBeInstanceOf(PartialTranscription);
    expect(stopped.text).toBe('一二');
    expect(quota.asked.length).toBe(3);

    // * the first piece fails for good: nothing is done, the error is the piece's own
    const first = make([{error: 'timeout'}, {error: 'timeout'}]);
    expect(await transcribeInPieces(blob, {...base, send: first.send}).catch((err) => err)).toMatchObject({code: 'timeout'});
    expect(first.asked.length).toBe(2);

    // * pieces cut another way (the server's size limit changed) are not gone on from: all over again
    const other = make(['a', 'b', 'c']);
    expect(await transcribeInPieces(blob, {...base, send: other.send, resume: {...error.done, samplesPerPiece: 1}})).toBe('a b c');
    expect(other.asked.length).toBe(3);

    // * a recording sent as it is: asked once more too
    const whole = make([{error: 'timeout'}, '整条']);
    expect(await transcribeInPieces(blob, {...base, durationSeconds: 28, send: whole.send})).toBe('整条');
    expect(whole.asked.length).toBe(2);
  });

  test('pieces of about two minutes, each under the limit, covering every sample once', () => {
    const max = getMaxBytes(4);
    const perPiece = getSamplesPerPiece(max);
    const seconds = perPiece / PIECE_SAMPLE_RATE;
    expect(seconds).toBeGreaterThan(110);
    expect(seconds).toBeLessThan(135);
    expect(encodeWav(new Float32Array(perPiece)).byteLength).toBeLessThanOrEqual(max);

    const total = perPiece * 2 + 1234;
    const ranges = getPieceRanges(total, perPiece);
    expect(ranges).toEqual([[0, perPiece], [perPiece, perPiece * 2], [perPiece * 2, total]]);
    expect(getPieceRanges(0, perPiece)).toEqual([]);
    expect(getPieceRanges(10, perPiece)).toEqual([[0, 10]]);
  });

  test('a piece is a mono 16-bit WAV at 16 kHz', () => {
    const wav = new DataView(encodeWav(new Float32Array([0, 1, -1, 0.5, 2, -2])));
    const ascii = (offset: number) => String.fromCharCode(wav.getUint8(offset), wav.getUint8(offset + 1), wav.getUint8(offset + 2), wav.getUint8(offset + 3));
    expect(ascii(0)).toBe('RIFF');
    expect(ascii(8)).toBe('WAVE');
    expect(ascii(36)).toBe('data');
    expect(wav.getUint16(20, true)).toBe(1);
    expect(wav.getUint16(22, true)).toBe(1);
    expect(wav.getUint32(24, true)).toBe(16000);
    expect(wav.getUint16(34, true)).toBe(16);
    expect(wav.getUint32(40, true)).toBe(12);
    expect(wav.byteLength).toBe(44 + 12);
    expect(wav.getInt16(44, true)).toBe(0);
    expect(wav.getInt16(46, true)).toBe(32767);
    expect(wav.getInt16(48, true)).toBe(-32768);
    // * louder than full scale is clipped, not wrapped
    expect(wav.getInt16(52, true)).toBe(32767);
    expect(wav.getInt16(54, true)).toBe(-32768);
  });

  test('the pieces\' texts become one: a space between words, none between Chinese', () => {
    expect(joinPieces(['Hello there', ' and more. ', ''])).toBe('Hello there and more.');
    expect(joinPieces(['你好，', '今天开会。'])).toBe('你好，今天开会。');
    expect(joinPieces(['今天', 'meeting'])).toBe('今天meeting');
    expect(joinPieces([])).toBe('');
  });

  test('errors: what the user is told', () => {
    expect(getVoiceFailure('quota_exceeded', true)).toBe('quota');
    expect(getVoiceFailure('network_error', true)).toBe('network');
    expect(getVoiceFailure('timeout', true)).toBe('timeout');
    expect(getVoiceFailureText('timeout')[0]).toBe('转写超时，请稍后重试');
    expect(getVoiceFailure('upstream_unavailable', false)).toBe('network');
    expect(getVoiceFailure('upstream_unavailable', true)).toBe('other');
    expect(getVoiceFailure(undefined, true, true)).toBe('unsupported');
    expect(getVoiceFailureText('unsupported')[0]).toBe('这个浏览器无法转写这条消息');
  });

  test('kept by account and message, and gone with the account', () => {
    expect(voiceKey(1, -100, 7)).toBe('v:1:-100_7');
    expect(isKeyOfAccount(voiceKey(1, 2, 3), 1)).toBe(true);
    expect(isKeyOfAccount(voiceKey(11, 2, 3), 1)).toBe(false);
    expect(isKeyOfAccount('t:1:zh:abc', 1)).toBe(true);
    expect(isKeyOfAccount('s:1:2_3', 1)).toBe(true);
  });
});

describe('luckgram voice: dictation', () => {
  test('the recording\'s format is the browser\'s: WebM in Chrome and Edge, Ogg in Firefox, MP4 in Safari', () => {
    const chrome = (type: string) => type.startsWith('audio/webm');
    const firefox = (type: string) => type.startsWith('audio/ogg') || type.startsWith('audio/webm');
    const safari = (type: string) => type === 'audio/mp4';
    expect(pickRecorderType(chrome)).toBe('audio/webm;codecs=opus');
    expect(pickRecorderType(firefox)).toBe('audio/webm;codecs=opus');
    expect(pickRecorderType((type) => type.startsWith('audio/ogg'))).toBe('audio/ogg;codecs=opus');
    expect(pickRecorderType(safari)).toBe('audio/mp4');
    expect(pickRecorderType(() => false)).toBeUndefined();
    expect(pickRecorderType(() => { throw new Error('x'); })).toBeUndefined();
  });

  test('what is sent names the container the server takes', () => {
    expect(getUploadType('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(getUploadType('audio/ogg; codecs=opus')).toBe('audio/ogg');
    expect(getUploadType('audio/mp4')).toBe('audio/mp4');
    expect(getUploadType('video/webm;codecs=vp8,opus')).toBe('audio/webm');
    expect(getUploadType('')).toBe('audio/webm');
  });

  test('a refused microphone says where to allow it; no device and no support say so too', () => {
    expect(getMicFailure('NotAllowedError', true)).toBe('denied');
    expect(getMicFailure('NotFoundError', true)).toBe('no_device');
    expect(getMicFailure('AbortError', true)).toBe('other');
    expect(getMicFailure(undefined, false)).toBe('unsupported');
    expect(getMicFailureText('denied')[0]).toBe('没有麦克风权限，请在浏览器地址栏里允许');
  });

  test('the level: silence is nothing, a loud block is full', () => {
    expect(getLevel(new Uint8Array(64).fill(128))).toBe(0);
    expect(getLevel([])).toBe(0);
    expect(getLevel(new Uint8Array(64).fill(255))).toBe(1);
    const quiet = getLevel(Uint8Array.from({length: 64}, (_, i) => 128 + (i % 2 ? 8 : -8)));
    expect(quiet).toBeGreaterThan(0.1);
    expect(quiet).toBeLessThan(0.5);
  });

  test('put at the cursor: a space where two words would touch, none in Chinese or after a space', () => {
    expect(getInsertion(' hello ', '')).toBe('hello');
    expect(getInsertion('world', 'hello')).toBe(' world');
    expect(getInsertion('world', 'hello ')).toBe('world');
    expect(getInsertion('今天开会', '你好')).toBe('今天开会');
    expect(getInsertion('meeting', '今天')).toBe('meeting');
    expect(getInsertion('  ', 'hello')).toBe('');
  });
});
