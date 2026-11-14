/*
 * Luckgram Web (luckgram-specs#186, W6): the rules of free transcription that need no browser —
 * whether a recording is sent as it is or in pieces, the pieces themselves (WAV), what an error
 * says. The rules are the phones' (specs/17-voice-text.md). No imports.
 */

export const FREE_TRANSCRIBE = 'free_transcribe';
export const DICTATION = 'dictation';
/** LuckgramSettings: tidy dictated text up with AI (off unless set) */
export const KEY_DICTATION_TIDY = 'dictation_tidy';
/** remote config: the largest body `/v1/ai/transcribe` takes, MB (the platform's cap is 4) */
export const KEY_MAX_MB = 'ai.transcribe_max_mb';
export const DEFAULT_MAX_MB = 4;

/** What the pieces are made of: speech needs no more, and a minute of it is under 2 MB */
export const PIECE_SAMPLE_RATE = 16000;
const WAV_HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;

/** The types the server takes as they are (ai.ts: TRANSCRIBE_TYPES). */
const DIRECT_TYPES = ['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/flac'];

export const voiceKey = (account: number | string, peerId: number | string, mid: number | string) => `v:${account}:${peerId}_${mid}`;

export function getMaxBytes(maxMb: number | undefined) {
  const mb = Number.isFinite(maxMb) && maxMb > 0 ? Math.min(maxMb, DEFAULT_MAX_MB) : DEFAULT_MAX_MB;
  // * a little under: the limit is on the whole request
  return Math.floor(mb * 1024 * 1024 * .97);
}

/** "audio/ogg; codecs=opus" → "audio/ogg" */
export function getBaseType(mimeType: string | undefined) {
  return (mimeType || '').split(';')[0].trim().toLowerCase();
}

/**
 * Sent as it is, when the server takes the type and the size; otherwise its sound is decoded in
 * the browser and sent as WAV pieces — a round video always is: it is a film, a minute of which is
 * larger than the limit, and only its sound is wanted.
 */
export function shouldSendAsIs(mimeType: string | undefined, size: number, maxBytes: number) {
  return DIRECT_TYPES.includes(getBaseType(mimeType)) && size > 0 && size <= maxBytes;
}

/** How many samples (16 kHz, mono, 16 bit) fit a piece. */
export function getSamplesPerPiece(maxBytes: number) {
  return Math.max(PIECE_SAMPLE_RATE, Math.floor((maxBytes - WAV_HEADER_BYTES) / BYTES_PER_SAMPLE));
}

/** [start, end) of each piece. */
export function getPieceRanges(totalSamples: number, samplesPerPiece: number): [number, number][] {
  const ranges: [number, number][] = [];
  for(let start = 0; start < totalSamples; start += samplesPerPiece) {
    ranges.push([start, Math.min(totalSamples, start + samplesPerPiece)]);
  }

  return ranges;
}

/** A WAV file of mono 16-bit samples. */
export function encodeWav(samples: Float32Array, sampleRate = PIECE_SAMPLE_RATE): ArrayBuffer {
  const dataBytes = samples.length * BYTES_PER_SAMPLE;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for(let i = 0; i < text.length; ++i) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // the format chunk's size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * BYTES_PER_SAMPLE, true);
  view.setUint16(32, BYTES_PER_SAMPLE, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  for(let i = 0; i < samples.length; ++i) {
    const sample = Math.max(-1, Math.min(1, samples[i] || 0));
    view.setInt16(WAV_HEADER_BYTES + i * BYTES_PER_SAMPLE, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  return buffer;
}

/** The pieces' texts as one: a space between, none where the languages write without. */
export function joinPieces(texts: string[]): string {
  const parts = texts.map((text) => (text || '').trim()).filter(Boolean);
  let out = '';
  for(const part of parts) {
    const needsSpace = out && !/[぀-ヿ㐀-鿿＀-￯]$/.test(out) && !/^[぀-ヿ㐀-鿿＀-￯]/.test(part);
    out += (needsSpace ? ' ' : '') + part;
  }

  return out;
}

export type VoiceFailure = 'network' | 'quota' | 'unsupported' | 'other';

/** `code`: a LuckgramApiError's; `decodeFailed`: the browser could not read the recording's sound */
export function getVoiceFailure(code: string | undefined, online: boolean, decodeFailed?: boolean): VoiceFailure {
  if(decodeFailed) return 'unsupported';
  if(code === 'quota_exceeded') return 'quota';
  if(code === 'network_error' || !online) return 'network';
  return 'other';
}

/** [中文, English] of the toast; the bubble itself says "转写失败 · 重试" */
export function getVoiceFailureText(failure: VoiceFailure): [string, string] {
  switch(failure) {
    case 'network':
      return ['网络不通，请检查网络或代理', 'No connection. Please check your network or proxy'];
    case 'quota':
      return ['今日转写时长已用完，明天再来', 'You\'ve used up today\'s transcription minutes. Come back tomorrow'];
    case 'unsupported':
      return ['这个浏览器无法转写这条消息', 'This browser can\'t transcribe this message'];
    default:
      return ['转写失败，请稍后再试', 'Transcription failed. Please try again later'];
  }
}

// ------------------------------------------------------------------ dictation (需求 5–7)

/** What a MediaRecorder is asked for, in order: Chrome and Edge record WebM, Firefox Ogg, Safari MP4 (AAC). */
export const RECORDER_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'];

/** The first type the browser records; undefined lets it choose its own. */
export function pickRecorderType(isSupported: (type: string) => boolean): string | undefined {
  return RECORDER_TYPES.find((type) => {
    try {
      return isSupported(type);
    } catch(err) {
      return false;
    }
  });
}

/** The type a recording is sent as: the server takes the container, not the codec list. */
export function getUploadType(recordedType: string | undefined): string {
  const type = getBaseType(recordedType);
  if(type === 'video/webm') return 'audio/webm';
  if(type === 'video/mp4') return 'audio/mp4';
  return type || 'audio/webm';
}

export type MicFailure = 'denied' | 'no_device' | 'unsupported' | 'other';

/** What `getUserMedia` (or the lack of it) says. */
export function getMicFailure(errorName: string | undefined, hasApi: boolean): MicFailure {
  if(!hasApi) return 'unsupported';
  if(errorName === 'NotAllowedError' || errorName === 'SecurityError' || errorName === 'PermissionDeniedError') return 'denied';
  if(errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError' || errorName === 'OverconstrainedError') return 'no_device';
  return 'other';
}

/** [中文, English] */
export function getMicFailureText(failure: MicFailure): [string, string] {
  switch(failure) {
    case 'denied':
      return ['没有麦克风权限，请在浏览器地址栏里允许', 'No microphone access. Allow it in the browser\'s address bar'];
    case 'no_device':
      return ['没有找到麦克风', 'No microphone was found'];
    case 'unsupported':
      return ['这个浏览器不支持录音', 'This browser can\'t record audio'];
    default:
      return ['无法开始录音，请稍后再试', 'Couldn\'t start recording. Please try again'];
  }
}

/** The loudness of a block of time-domain bytes (128 = silence), 0…1, for the level bars. */
export function getLevel(bytes: ArrayLike<number>): number {
  if(!bytes.length) return 0;
  let sum = 0;
  for(let i = 0; i < bytes.length; ++i) {
    const value = (bytes[i] - 128) / 128;
    sum += value * value;
  }

  // * speech sits low on the scale: lifted so that talking moves the bars
  return Math.min(1, Math.sqrt(sum / bytes.length) * 3);
}

/** Dictated text put into what is already typed: a space where two words would touch. */
export function getInsertion(text: string, before: string): string {
  const trimmed = (text || '').trim();
  if(!trimmed) return '';
  const cjk = /[\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/;
  const last = before.slice(-1);
  const needsSpace = !!last && !/\s/.test(last) && !cjk.test(last) && !cjk.test(trimmed[0]);
  return (needsSpace ? ' ' : '') + trimmed;
}
