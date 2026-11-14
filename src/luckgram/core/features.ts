/*
 * Luckgram Web (luckgram-specs#139, W3 需求 4): the Luckgram feature registry.
 *
 * Adding a feature = adding one entry to FEATURES below; the "Luckgram 功能" settings page is
 * generated from this list (rows keep the order of the entries inside each group). Keys, names,
 * descriptions, groups and defaults are the phones' (LuckgramFeatures.java / .swift) — the server's
 * `features.<key>` is the same key on every platform. A feature the web app does not have yet is
 * not listed.
 *
 *   {
 *     key: 'quick_replies', group: 'messages', default: true,
 *     title: ['快捷回复', 'Quick replies'],
 *     description: ['把常用回复存成模板，输入框里一点就填入', 'Save frequent replies as templates and insert them with one tap'],
 *     subpage: () => import('@/luckgram/quickReplies/settingsTab')      // optional: its own settings page
 *   }
 *
 * Read a switch anywhere with `isFeatureEnabled('quick_replies')`, or `useFeatureEnabled` in a component.
 */

import LuckgramSettings from '@/luckgram/core/settings';
import {isRemotelyAllowed} from '@/luckgram/core/remoteConfig';
import {LUCKGRAM_CHANNEL} from '@/luckgram/config';

/** The groups of the settings page, in display order; the same as on the phones. */
export const FEATURE_GROUPS = ['accounts', 'messages', 'media', 'profiles', 'discover', 'ai', 'debug'] as const;
export type FeatureGroup = typeof FEATURE_GROUPS[number];

export const FEATURE_GROUP_TITLES: Record<FeatureGroup, [string, string]> = {
  accounts: ['账号与隐私', 'Accounts & Privacy'],
  messages: ['消息与语言', 'Messages & Language'],
  media: ['媒体、通话与存储', 'Media, Calls & Storage'],
  profiles: ['资料与整理', 'Profiles & Organization'],
  discover: ['发现', 'Discover'],
  ai: ['AI', 'AI'],
  debug: ['调试', 'Debug']
};

export type LuckgramFeature = {
  /** the storage key and the server's `features.<key>`, snake_case, the same as on the phones */
  key: string,
  group: FeatureGroup,
  /** the switch's state until the user sets it, as written in the feature's spec */
  default: boolean,
  /** [中文, English] */
  title: [string, string],
  description: [string, string],
  /** the feature's own settings page: a module whose default export is the page's component */
  subpage?: () => Promise<{default: () => any}>,
  /** only on the development address and a local build */
  devOnly?: boolean
};

export const DEBUG_DEMO = 'debug_demo';

export const FEATURES: LuckgramFeature[] = [
  // ---- 调试 / Debug
  {
    key: DEBUG_DEMO, group: 'debug', default: false, devOnly: true,
    title: ['调试演示开关', 'Debug demo switch'],
    description: ['只用于验证开关框架：状态会保存，并在其他标签页同步', 'Only to check the switch framework: the state is kept and mirrored in other tabs']
  }
];

export const isDevToolsVisible = () => LUCKGRAM_CHANNEL !== 'prod';

export function findFeature(key: string) {
  return FEATURES.find((feature) => feature.key === key);
}

/** The user's own switch (what the settings row shows). */
export function isFeatureLocallyEnabled(key: string, settings = LuckgramSettings) {
  return settings.getBool(key, !!findFeature(key)?.default);
}

/**
 * Whether a feature is on: the user's switch, falling back to the registry's default, and not
 * switched off by the server. Entry points read this, so a remotely disabled feature is gone everywhere.
 */
export function isFeatureEnabled(key: string) {
  const feature = findFeature(key);
  if(feature?.devOnly && !isDevToolsVisible()) return false;
  return isRemotelyAllowed(key) && isFeatureLocallyEnabled(key);
}

export function setFeatureEnabled(key: string, enabled: boolean) {
  return LuckgramSettings.set(key, enabled);
}

/** The features of a group that have a row: not hidden by the server, not a debug one in production. */
export function getVisibleFeatures(group: FeatureGroup, features = FEATURES, devTools = isDevToolsVisible(), allowed = isRemotelyAllowed) {
  return features.filter((feature) => feature.group === group && (!feature.devOnly || devTools) && allowed(feature.key));
}
