/*
 * Luckgram Web (luckgram-specs#139, W3 需求 3): LuckgramSettings in components — a value that
 * follows its key, whoever changes it: this tab, another tab, the remote config.
 */

import {Accessor, createEffect, createRoot, createSignal, on, onCleanup} from 'solid-js';
import LuckgramSettings from '@/luckgram/core/settings';
import {isFeatureEnabled, isFeatureLocallyEnabled} from '@/luckgram/core/features';
import {remoteConfig} from '@/luckgram/core/remoteConfig';

/** Re-runs `read` whenever `key` (or, without a key, any setting) changes. */
function useSettingValue<T>(key: string | undefined, read: () => T): Accessor<T> {
  const [version, setVersion] = createSignal(0);
  onCleanup(LuckgramSettings.subscribe((changed) => {
    if(!key || changed === key) setVersion((v) => v + 1);
  }));

  return () => {
    version();
    return read();
  };
}

export const useBoolSetting = (key: string, def: boolean) => useSettingValue(key, () => LuckgramSettings.getBool(key, def));
export const useStringSetting = (key: string, def?: string) => useSettingValue(key, () => LuckgramSettings.getString(key, def));

/** The row's switch: the user's own choice. */
export const useFeatureSwitch = (key: string) => useSettingValue(key, () => isFeatureLocallyEnabled(key));

/** Whether the feature is on: the switch and the server's say. */
export function useFeatureEnabled(key: string): Accessor<boolean> {
  const local = useSettingValue(key, () => isFeatureLocallyEnabled(key));
  return () => {
    remoteConfig();
    local();
    return isFeatureEnabled(key);
  };
}

/**
 * For what is not a component (a button built by hand): `onChange` runs when any of the features
 * goes on or off — the user's switch, the server's say, the preview list.
 * @returns a function that stops the watching
 */
export function watchFeatures(keys: string[], onChange: () => void): () => void {
  return createRoot((dispose) => {
    const states = keys.map((key) => useFeatureEnabled(key));
    createEffect(on(() => states.map((state) => state()).join(','), () => {
      try {
        onChange();
      } catch(err) {
        console.warn('[luckgram] feature watcher', (err as Error)?.message);
      }
    }, {defer: true}));
    return dispose;
  });
}
