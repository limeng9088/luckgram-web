/*
 * Luckgram Web (luckgram-specs#139, W3 需求 5、6): the client of the Luckgram API — the entry in
 * use (endpoints.ts), the device token, and one way to send an authorized request.
 *
 * The device token. `POST /v1/devices` gives every browser an anonymous token; it is kept in
 * IndexedDB and sent as `Authorization: Bearer …`. A browser has no secure storage: any script of
 * the origin, and anyone with the device, can read it. That is acceptable because the token is not
 * a credential for anything of the user's — it only tells the server which browser is asking, for
 * rate limits and the daily AI quota. It never goes into a URL and is never logged.
 */

import LuckgramSettings from '@/luckgram/core/settings';
import {HEALTH_PATH, LuckgramEndpoints, parseEndpoints} from '@/luckgram/core/endpoints';
import {LuckgramApiError, errorFromResponse} from '@/luckgram/core/errors';

const KEY_TOKEN = 'device_token';
const KEY_ENDPOINT = 'api_endpoint';
// * registration is limited per IP address and the server says for how long (hours, when a whole office or a
// * VPN exit shares the address): until then asking again only prolongs it, in this tab or another
const KEY_REGISTER_RETRY_AT = 'device_register_retry_at';
const REGISTER_RETRY_MAX_MS = 24 * 60 * 60 * 1000;
/** Until the response's headers: an entry that does not answer by then is taken for unreachable. */
const CONNECT_TIMEOUT_MS = 10000;
const APP_VERSION_HEADER = 'X-Luckgram-App-Version';

// * set by scripts/luckgram/vite-plugin.mjs: the entries of this build, the main one first
const env = import.meta.env as any as Record<string, string | undefined>;

export type LuckgramRequest = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  /** a JSON value, or bytes sent as they are with `contentType` */
  json?: any,
  body?: Blob | ArrayBuffer,
  contentType?: string,
  headers?: Record<string, string>,
  accept?: string,
  signal?: AbortSignal,
  /** false for the registration itself */
  authorized?: boolean
};

export type LuckgramApiOptions = {
  endpoints: string[],
  appVersion: string,
  fetch?: typeof fetch,
  locale?: () => string,
  settings?: typeof LuckgramSettings,
  now?: () => number
};

export class LuckgramApi {
  private endpoints: LuckgramEndpoints;
  private fetch: typeof fetch;
  private settings: typeof LuckgramSettings;
  private registering: Promise<string>;
  private now: () => number;

  constructor(private options: LuckgramApiOptions) {
    this.fetch = options.fetch || ((...args) => fetch(...args));
    this.settings = options.settings || LuckgramSettings;
    this.now = options.now || Date.now;
  }

  public get isConfigured() {
    return this.options.endpoints.length > 0;
  }

  private getEndpoints() {
    return this.endpoints ??= new LuckgramEndpoints(this.options.endpoints, this.settings.getString(KEY_ENDPOINT));
  }

  /** The entry in use, for showing. */
  public get currentEndpoint() {
    return this.isConfigured ? this.getEndpoints().currentBase : undefined;
  }

  /** A URL the server returned (an AI image) on the entry in use. */
  public rewriteUrl(url: string) {
    return this.isConfigured ? this.getEndpoints().rewrite(url) : url;
  }

  public get isRegistered() {
    return !!this.settings.getPrivate(KEY_TOKEN);
  }

  // ------------------------------------------------------------------ transport

  /**
   * One request over the entries: the one in use, then the others, moving on only when an entry
   * cannot be reached. Any HTTP response is the answer, whatever its status.
   */
  private async send(request: LuckgramRequest, token?: string): Promise<Response> {
    if(!this.isConfigured) throw new LuckgramApiError(LuckgramApiError.NETWORK_ERROR);
    await this.settings.ready;

    const endpoints = this.getEndpoints();
    const headers: Record<string, string> = {
      'Accept': request.accept || 'application/json',
      [APP_VERSION_HEADER]: this.options.appVersion,
      ...request.headers
    };

    let body: BodyInit;
    if(request.json !== undefined) {
      body = JSON.stringify(request.json);
      headers['Content-Type'] = 'application/json';
    } else if(request.body) {
      body = request.body;
      if(request.contentType) headers['Content-Type'] = request.contentType;
    }

    if(token) headers['Authorization'] = 'Bearer ' + token;

    for(const base of endpoints.attemptOrder()) {
      if(request.signal?.aborted) throw new LuckgramApiError(LuckgramApiError.CANCELLED);

      const controller = new AbortController();
      const onAbort = () => controller.abort();
      request.signal?.addEventListener('abort', onAbort);
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, CONNECT_TIMEOUT_MS);

      try {
        const response = await this.fetch(base + request.path, {
          method: request.method || (body ? 'POST' : 'GET'),
          headers,
          body,
          signal: controller.signal,
          // * no cookies, no cache of ours: the token is the only thing that identifies the browser
          credentials: 'omit',
          cache: 'no-store'
        });

        if(endpoints.markWorking(base)) this.settings.set(KEY_ENDPOINT, base);
        this.maybeProbe();
        // * the body (a stream of an AI answer) may take as long as it takes; the caller's signal still ends it
        clearTimeout(timeout);
        return response;
      } catch(err) {
        if(request.signal?.aborted && !timedOut) throw new LuckgramApiError(LuckgramApiError.CANCELLED);
        // * the entry could not be reached (DNS, connection, TLS, no answer in time): the next one
      } finally {
        clearTimeout(timeout);
        request.signal?.removeEventListener('abort', onAbort);
      }
    }

    throw new LuckgramApiError(LuckgramApiError.NETWORK_ERROR);
  }

  /** While a backup entry is in use, the main one is asked for its health and taken back when it answers. */
  private maybeProbe() {
    const endpoints = this.getEndpoints();
    const now = this.now();
    if(!endpoints.shouldProbe(now)) return;
    endpoints.markProbed(now);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
    this.fetch(endpoints.primary + HEALTH_PATH, {signal: controller.signal, credentials: 'omit', cache: 'no-store'})
    .then((response) => {
      if(response.status === 200 && endpoints.markWorking(endpoints.primary)) {
        this.settings.set(KEY_ENDPOINT, endpoints.primary);
      }
    }, () => {})
    .finally(() => clearTimeout(timeout));
  }

  // ------------------------------------------------------------------ the device

  private register(signal?: AbortSignal): Promise<string> {
    return this.registering ??= (async() => {
      const retryAt = Number(this.settings.getPrivate(KEY_REGISTER_RETRY_AT)) || 0, now = this.now();
      if(retryAt > now && retryAt - now <= REGISTER_RETRY_MAX_MS) {
        const error = new LuckgramApiError(LuckgramApiError.RATE_LIMITED, 429);
        error.retryAfterSeconds = Math.ceil((retryAt - now) / 1000);
        throw error;
      }

      const response = await this.send({
        path: '/v1/devices',
        json: {platform: 'web', app_version: this.options.appVersion, locale: this.options.locale?.() || navigator.language || 'en'},
        signal
      });

      if(!response.ok) {
        const error = errorFromResponse(response.status, await response.text().catch((): undefined => undefined));
        if(error.code === LuckgramApiError.RATE_LIMITED) {
          error.retryAfterSeconds ||= Math.max(0, Number(response.headers.get('Retry-After')) || 0);
          const wait = Math.min(error.retryAfterSeconds * 1000, REGISTER_RETRY_MAX_MS);
          if(wait > 0) await this.settings.setPrivate(KEY_REGISTER_RETRY_AT, this.now() + wait);
        }

        throw error;
      }

      const data = await response.json().catch((): any => undefined);
      const token: string = typeof(data?.token) === 'string' && data.token ? data.token : data?.device_token;
      if(typeof(token) !== 'string' || !token) throw new LuckgramApiError(LuckgramApiError.UPSTREAM_UNAVAILABLE, response.status);

      await this.settings.setPrivate(KEY_TOKEN, token);
      if(retryAt) await this.settings.setPrivate(KEY_REGISTER_RETRY_AT, undefined);
      return token;
    })().finally(() => {
      this.registering = undefined;
    });
  }

  /** The device token, registering the browser first if it has none. */
  public async ensureRegistered(signal?: AbortSignal): Promise<void> {
    await this.settings.ready;
    if(!this.settings.getPrivate(KEY_TOKEN)) await this.register(signal);
  }

  /** Forgets the device: the next request registers a new one. */
  public forgetDevice() {
    return this.settings.setPrivate(KEY_TOKEN, undefined);
  }

  // ------------------------------------------------------------------ requests

  /**
   * An authorized request: registers the browser if needed, and once more when the server no
   * longer knows the token. The response is returned whatever its status.
   */
  public async request(request: LuckgramRequest): Promise<Response> {
    if(request.authorized === false) return this.send(request);

    for(let attempt = 0; ; ++attempt) {
      await this.settings.ready;
      const token = this.settings.getPrivate<string>(KEY_TOKEN) || await this.register(request.signal);
      const response = await this.send(request, token);
      if(response.status === 401 && attempt === 0) {
        // * unless another tab has registered again meanwhile, in which case its token is tried
        if(this.settings.getPrivate(KEY_TOKEN) === token) await this.settings.setPrivate(KEY_TOKEN, undefined);
        continue;
      }

      return response;
    }
  }

  /** An authorized request whose answer is JSON; any other status than a success is thrown as its error. */
  public async requestJSON<T = any>(request: LuckgramRequest): Promise<T> {
    const response = await this.request(request);
    const text = await response.text().catch((): undefined => undefined);
    if(!response.ok) throw errorFromResponse(response.status, text);

    try {
      return JSON.parse(text);
    } catch(err) {
      throw new LuckgramApiError(LuckgramApiError.UPSTREAM_UNAVAILABLE, response.status);
    }
  }
}

/** What an API call threw, as a LuckgramApiError. */
export function toApiError(err: any): LuckgramApiError {
  if(err instanceof LuckgramApiError) return err;
  if(err?.name === 'AbortError') return new LuckgramApiError(LuckgramApiError.CANCELLED);
  return new LuckgramApiError(LuckgramApiError.NETWORK_ERROR);
}

export const LUCKGRAM_API_ENDPOINTS = parseEndpoints(env.VITE_LG_API_URLS);
