/*
 * Luckgram Web (luckgram-specs#139, W3 需求 9、10): LuckgramAI — the AI calls of the Luckgram API,
 * the same interface the phones have (LuckgramAI.java / .swift):
 *
 *   chat        POST /v1/ai/chat        an answer at once, or streamed piece by piece
 *   image       POST /v1/ai/image
 *   transcribe  POST /v1/ai/transcribe  the audio file itself is the request body
 *   me          GET  /v1/me             today's quota and the Pro state
 *
 * Consent. Before the first call that sends something of the user's, the user is asked once:
 * "你选中的内容会发送到 Luckgram 的 AI 服务，由 OpenAI 处理后返回。" Without an "同意" nothing is
 * sent — not even the device's registration — and the call fails with `consent_denied`. The
 * consent is kept in LuckgramSettings (`ai_consent`) and can be withdrawn under Luckgram 功能 → AI.
 * `me` sends nothing of the user's and needs no consent.
 *
 * Errors are LuckgramApiError; `errorMessage(code)` is the text to show.
 */

import LuckgramSettings from '@/luckgram/core/settings';
import {LuckgramApi, toApiError} from '@/luckgram/core/api';
import {LuckgramApiError, errorFromResponse} from '@/luckgram/core/errors';
import {createSseParser} from '@/luckgram/core/sse';

export const KEY_AI_CONSENT = 'ai_consent';

export type AiTask = 'chat' | 'summary' | 'reply' | 'writing' | 'agent' | 'post' | 'translate';
export type AiMessage = {role: 'system' | 'user' | 'assistant', content: string};

export type AiChatOptions = {
  task?: AiTask,
  messages: AiMessage[],
  /** more fields of the request body (`effect`, `agent_id`, `to_lang`, …); never `task`, `messages`, `stream` */
  params?: Record<string, any>,
  /** called with each piece of a streamed answer and the text so far; its presence asks for a stream */
  onDelta?: (delta: string, text: string) => void,
  signal?: AbortSignal
};

export type AiImage = {url: string, mime?: string, expires_at?: string};
export type AiTranscription = {text: string, language?: string};

export const TRANSCRIBE_TYPES = ['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/flac'];

export type LuckgramAIOptions = {
  api: LuckgramApi,
  /** shows the consent dialog; resolves true only when the user agreed */
  askConsent: () => Promise<boolean>,
  settings?: typeof LuckgramSettings
};

export class LuckgramAI {
  private api: LuckgramApi;
  private settings: typeof LuckgramSettings;
  private asking: Promise<boolean>;

  constructor(private options: LuckgramAIOptions) {
    this.api = options.api;
    this.settings = options.settings || LuckgramSettings;
  }

  // ------------------------------------------------------------------ consent

  public hasConsent() {
    return this.settings.getBool(KEY_AI_CONSENT, false);
  }

  /** Withdraws the consent: the next AI call asks again. */
  public revokeConsent() {
    return this.settings.set(KEY_AI_CONSENT, undefined);
  }

  /** Asks if needed; true only when the user has agreed, now or before. */
  public async requestConsent(): Promise<boolean> {
    await this.settings.ready;
    if(this.hasConsent()) return true;

    // * several calls at once get one dialog
    const granted = await (this.asking ??= this.options.askConsent().catch(() => false).finally(() => {
      this.asking = undefined;
    }));

    if(granted) await this.settings.set(KEY_AI_CONSENT, true);
    return granted;
  }

  private async withConsent<T>(work: () => Promise<T>): Promise<T> {
    if(!(await this.requestConsent())) throw new LuckgramApiError(LuckgramApiError.CONSENT_DENIED);
    try {
      return await work();
    } catch(err) {
      throw toApiError(err);
    }
  }

  // ------------------------------------------------------------------ calls

  /** The answer's whole text; with `onDelta`, also piece by piece as it is written. */
  public chat(options: AiChatOptions): Promise<string> {
    return this.withConsent(async() => {
      const stream = !!options.onDelta;
      const response = await this.api.request({
        path: '/v1/ai/chat',
        json: {...options.params, task: options.task || 'chat', messages: options.messages, stream},
        accept: stream ? 'text/event-stream' : 'application/json',
        signal: options.signal
      });

      if(!response.ok) throw errorFromResponse(response.status, await response.text().catch((): undefined => undefined));

      if(!stream || !response.body || !(response.headers.get('Content-Type') || '').includes('text/event-stream')) {
        const data = await response.json().catch((): any => undefined);
        if(typeof(data?.text) !== 'string') throw new LuckgramApiError(LuckgramApiError.UPSTREAM_UNAVAILABLE, response.status);
        options.onDelta?.(data.text, data.text);
        return data.text;
      }

      let text = '', failure: LuckgramApiError, done = false;
      const parser = createSseParser((event) => {
        if(event.error) {
          failure = errorFromResponse(response.status, JSON.stringify({error: event.error}));
        } else if(typeof(event.delta) === 'string' && event.delta) {
          text += event.delta;
          options.onDelta(event.delta, text);
        } else if(event.done) {
          done = true;
        }
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        while(!failure) {
          const {value, done: ended} = await reader.read();
          if(ended) break;
          parser.push(decoder.decode(value, {stream: true}));
        }

        parser.push(decoder.decode());
        parser.end();
      } catch(err) {
        if(options.signal?.aborted) throw new LuckgramApiError(LuckgramApiError.CANCELLED);
        // * cut off in the middle: what came is not an answer
        throw new LuckgramApiError(LuckgramApiError.NETWORK_ERROR);
      } finally {
        reader.cancel().catch(() => {});
      }

      if(failure) throw failure;
      if(!done && !text) throw new LuckgramApiError(LuckgramApiError.UPSTREAM_UNAVAILABLE, response.status);
      return text;
    });
  }

  /** A picture for the prompt. Its `url` is fetched with `fetchImage` (it needs the device's token). */
  public image(prompt: string, signal?: AbortSignal): Promise<AiImage> {
    return this.withConsent(async() => {
      const data = await this.api.requestJSON<AiImage>({path: '/v1/ai/image', json: {prompt}, signal});
      if(typeof(data?.url) !== 'string') throw new LuckgramApiError(LuckgramApiError.UPSTREAM_UNAVAILABLE);
      return {...data, url: this.api.rewriteUrl(data.url)};
    });
  }

  /** @param audio the audio file as it is; its type has to be one of TRANSCRIBE_TYPES */
  public transcribe(audio: Blob, options: {language?: string, signal?: AbortSignal} = {}): Promise<AiTranscription> {
    return this.withConsent(async() => {
      const type = (audio.type || '').split(';')[0].trim().toLowerCase();
      if(!TRANSCRIBE_TYPES.includes(type)) throw new LuckgramApiError(LuckgramApiError.INVALID_REQUEST);

      const language = options.language && /^[a-z]{2}$/i.test(options.language) ? `?language=${options.language.toLowerCase()}` : '';
      const data = await this.api.requestJSON<AiTranscription>({
        path: '/v1/ai/transcribe' + language, body: audio, contentType: type, signal: options.signal
      });
      if(typeof(data?.text) !== 'string') throw new LuckgramApiError(LuckgramApiError.UPSTREAM_UNAVAILABLE);
      return data;
    });
  }

  /** Today's quota, the Pro state. Nothing of the user's is sent, so no consent is asked. */
  public async me(signal?: AbortSignal): Promise<any> {
    try {
      return await this.api.requestJSON({path: '/v1/me', signal});
    } catch(err) {
      throw toApiError(err);
    }
  }
}
