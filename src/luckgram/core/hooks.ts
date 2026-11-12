/*
 * Luckgram Web (luckgram-specs#139, W3 需求 3): LuckgramSettings in components — a value that
 * follows its key, whoever changes it: this tab, another tab, the remote config.
 */

import {Accessor, createSignal, onCleanup} from 'solid-js';
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
