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
