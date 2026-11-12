/*
 * Luckgram Web (luckgram-specs#139, W3 需求 7): a `GET /v1/config` response and when to ask for
 * it again. The data model and the rules are the phones' (LuckgramRemoteConfig.java,
 * LuckgramRemoteConfigLogic.java). Pure logic, no imports.
 *
 *   {"version": "…", "ttl": 3600,
 *    "values":   {"ai.transcribe_max_mb": 4, "web.relays": ["wss://…"], "features.x.enabled": false, …},
 *    "features": {"debug_demo": false, …}}
 *
 * `features` is what the server computed for this device (enabled, rollout, minimum version) and
 * wins over `values`. The server only says whether a feature is available and gives values their
 * defaults; a switch the user set stays the user's.
 */

/** The page asks again this often while it stays open (and when it is opened). */
export const REFRESH_INTERVAL_SECONDS = 6 * 60 * 60;
/** After a failed fetch, wait this long before trying again; the stored config stays in use. */
export const RETRY_AFTER_FAILURE_SECONDS = 300;

export type RemoteConfigData = {
  version?: string,
  ttl: number,
  /** wall-clock ms when the response was received */
  fetchedAt: number,
  values: Record<string, any>,
  features: Record<string, any>
};

export const EMPTY_REMOTE_CONFIG: RemoteConfigData = {ttl: 0, fetchedAt: 0, values: {}, features: {}};

const isObject = (value: any): value is Record<string, any> => !!value && typeof(value) === 'object' && !Array.isArray(value);

/** The server always sends the full set, so a response replaces what was there. */
export function parseRemoteConfig(response: any, now: number): RemoteConfigData {
  if(!isObject(response)) return EMPTY_REMOTE_CONFIG;

  let values = isObject(response.values) ? response.values : undefined;
  const features = isObject(response.features) ? response.features : undefined;
  // * not the documented shape: a flat "key": value object
  if(!values && !features) values = response;

  return {
    version: response.version !== undefined && response.version !== null ? String(response.version) : undefined,
    ttl: Math.max(0, Number(response.ttl) || 0),
    fetchedAt: now,
    values: values || {},
    features: features || {}
  };
}

export function serializeRemoteConfig(config: RemoteConfigData): string {
  return JSON.stringify({
    version: config.version, ttl: config.ttl, fetched_at: config.fetchedAt, values: config.values, features: config.features
  });
}

export function deserializeRemoteConfig(text: string | undefined): RemoteConfigData {
  if(!text) return EMPTY_REMOTE_CONFIG;
  try {
    const stored = JSON.parse(text);
    return parseRemoteConfig(stored, Number(stored?.fetched_at) || 0);
  } catch(err) {
    return EMPTY_REMOTE_CONFIG;
  }
}

/** Whether the server allows the feature; true when it says nothing about it. */
export function isFeatureAllowed(config: RemoteConfigData, featureKey: string): boolean {
  let value = config.features[featureKey];
  if(typeof(value) === 'boolean') return value;
  value = config.values[`features.${featureKey}.enabled`];
  if(typeof(value) === 'boolean') return value;
  return true;
}

export function getRemoteNumber(config: RemoteConfigData, key: string, def: number): number {
  const value = config.values[key];
  return typeof(value) === 'number' && Number.isFinite(value) ? value : def;
}

export function getRemoteString(config: RemoteConfigData, key: string, def?: string): string | undefined {
  const value = config.values[key];
  return typeof(value) === 'string' ? value : def;
}

export function getRemoteBool(config: RemoteConfigData, key: string, def: boolean): boolean {
  const value = config.values[key];
  return typeof(value) === 'boolean' ? value : def;
}

export function getRemoteStrings(config: RemoteConfigData, key: string): string[] | undefined {
  const value = config.values[key];
  return Array.isArray(value) ? value.filter((item) => typeof(item) === 'string') : undefined;
}

/**
 * Whether to ask the server now.
 * @param maxAgeSeconds how old the stored config may get (the refresh interval)
 */
export function isRemoteConfigStale(nowMs: number, fetchedAtMs: number, maxAgeSeconds: number, lastFailureMs: number): boolean {
  if(lastFailureMs > 0 && nowMs >= lastFailureMs && nowMs - lastFailureMs < RETRY_AFTER_FAILURE_SECONDS * 1000) {
    return false;
  }

  // * never fetched, or the clock went backwards
  if(fetchedAtMs <= 0 || nowMs < fetchedAtMs) return true;
  return nowMs - fetchedAtMs >= maxAgeSeconds * 1000;
}
