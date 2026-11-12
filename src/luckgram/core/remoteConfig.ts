/*
 * Luckgram Web (luckgram-specs#139, W3 需求 7): the remote config of this browser — fetched when
 * the page opens and every 6 hours while it stays open, kept in LuckgramSettings so that it is
 * there at the next start and in the other tabs. Rules and model: remoteConfigLogic.ts.
 *
 * Fetching registers the anonymous device and sends nothing of the user's, so it needs no AI consent.
 */

import {createSignal} from 'solid-js';
import LuckgramSettings from '@/luckgram/core/settings';
import type {LuckgramApi} from '@/luckgram/core/api';
import {
  EMPTY_REMOTE_CONFIG, REFRESH_INTERVAL_SECONDS, RemoteConfigData, deserializeRemoteConfig, getRemoteBool,
  getRemoteNumber, getRemoteString, getRemoteStrings, isFeatureAllowed, isRemoteConfigStale, parseRemoteConfig,
  serializeRemoteConfig
} from '@/luckgram/core/remoteConfigLogic';

const KEY = 'remote_config';

const [config, setConfig] = createSignal<RemoteConfigData>(EMPTY_REMOTE_CONFIG);
let api: LuckgramApi;
let inFlight: Promise<void>;
let lastFailureMs = 0;

/** The config in use: reactive, so a row or an entry point follows a change at once. */
export const remoteConfig = config;

export const isRemotelyAllowed = (featureKey: string) => isFeatureAllowed(config(), featureKey);
export const remoteNumber = (key: string, def: number) => getRemoteNumber(config(), key, def);
export const remoteString = (key: string, def?: string) => getRemoteString(config(), key, def);
export const remoteBool = (key: string, def: boolean) => getRemoteBool(config(), key, def);
export const remoteStrings = (key: string) => getRemoteStrings(config(), key);

function store(data: RemoteConfigData) {
  setConfig(data);
  return LuckgramSettings.set(KEY, serializeRemoteConfig(data));
}

async function fetchConfig() {
  const current = config();
  const headers: Record<string, string> = {};
  if(current.version) headers['If-None-Match'] = `"${current.version}"`;

  const response = await api.request({path: '/v1/config', headers});
  if(response.status === 304) {
    // * unchanged: only its age starts again
    await store({...current, fetchedAt: Date.now()});
    return;
  }

  if(response.status !== 200) throw new Error('HTTP ' + response.status);
  await store(parseRemoteConfig(await response.json(), Date.now()));
}

/** Asks the server now, unless a request is on its way. Failures keep the stored config. */
export function refreshRemoteConfig(): Promise<void> {
  if(!api?.isConfigured) return Promise.resolve();
  return inFlight ??= fetchConfig().then(() => {
    lastFailureMs = 0;
  }, (err) => {
    lastFailureMs = Date.now();
    console.warn('[luckgram] remote config:', (err as Error)?.message);
  }).finally(() => {
    inFlight = undefined;
  });
}

export function refreshRemoteConfigIfStale() {
  if(isRemoteConfigStale(Date.now(), config().fetchedAt, REFRESH_INTERVAL_SECONDS, lastFailureMs)) {
    return refreshRemoteConfig();
  }
}

export async function initRemoteConfig(luckgramApi: LuckgramApi) {
  api = luckgramApi;
  await LuckgramSettings.ready;
  setConfig(deserializeRemoteConfig(LuckgramSettings.getString(KEY)));

  // * another tab fetched it, or everything was cleared
  LuckgramSettings.subscribe((key, value) => {
    if(key !== KEY) return;
    const next = deserializeRemoteConfig(typeof(value) === 'string' ? value : undefined);
    if(next.fetchedAt !== config().fetchedAt || next.version !== config().version) setConfig(next);
  });

  // * when the page opens, whatever the age of what is stored
  refreshRemoteConfig();
  setInterval(refreshRemoteConfigIfStale, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible') refreshRemoteConfigIfStale();
  });
}
