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
import {isHiddenByPreview} from '@/luckgram/core/preview';
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
  // ---- 消息与语言 / Messages & Language
  {
    key: 'translate_in', group: 'messages', default: true,
    title: ['翻译收到的消息', 'Translate received messages'],
    description: ['消息旁显示翻译图标，译文显示在原文下方', 'A translate icon beside messages; the translation appears under the original']
  },
  {
    key: 'translate_out', group: 'messages', default: true,
    title: ['发送前翻译', 'Translate before sending'],
    description: ['输入框旁显示翻译按钮，把要发的话翻成对方的语言', 'A translate button by the message field turns what you wrote into the other side\'s language']
  },
  {
    key: 'free_transcribe', group: 'messages', default: true,
    title: ['免费语音转文字', 'Free voice-to-text'],
    description: ['没有 Telegram Premium 也能把语音消息和圆形视频转成文字', 'Turn voice messages and round videos into text without Telegram Premium']
  },
  {
    key: 'dictation', group: 'messages', default: true,
    title: ['语音输入', 'Dictation'],
    description: ['输入框旁的按钮：说话，转成文字插入光标处', 'A button by the message field: speak, and the words are inserted at the cursor']
  },

  // ---- AI
  {
    key: 'ai_writing', group: 'ai', default: true,
    title: ['AI 写作', 'AI writing'],
    description: ['输入框的 ✦ 按钮：润色、更正式、更友好、更简短、修正语法', 'The ✦ button of the message field: polish, more formal, friendlier, shorter, fix grammar']
  },
  {
    key: 'ai_reply', group: 'ai', default: true,
    title: ['AI 回复', 'AI reply'],
    description: ['「帮我回复」：根据对话给出三条不同语气的回复供挑选', '"Help me reply": three replies in different tones to pick from, fitting the conversation']
  },

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
 * switched off by the server, and not held back on the preview list (preview.ts). Entry points read
 * this, so a remotely disabled or not yet released feature is gone everywhere.
 */
export function isFeatureEnabled(key: string) {
  const feature = findFeature(key);
  if(feature?.devOnly && !isDevToolsVisible()) return false;
  return isFeatureAvailable(key) && isFeatureLocallyEnabled(key);
}

/** Whether the feature exists for this browser at all: allowed by the server and not hidden as a preview. */
export function isFeatureAvailable(key: string) {
  return isRemotelyAllowed(key) && !isHiddenByPreview(key);
}

export function setFeatureEnabled(key: string, enabled: boolean) {
  return LuckgramSettings.set(key, enabled);
}

/** The features of a group that have a row: not hidden by the server or the preview list, not a debug one in production. */
export function getVisibleFeatures(group: FeatureGroup, features = FEATURES, devTools = isDevToolsVisible(), allowed = isFeatureAvailable) {
  return features.filter((feature) => feature.group === group && (!feature.devOnly || devTools) && allowed(feature.key));
}
