/*
 * Luckgram Web (luckgram-specs#185, W5 需求 10; docs/web.md「二期怎么上线」): the preview list.
 *
 * There is no development site: a merge releases the production site. So a feature is merged with
 * its key in remote config `web.preview_features`, which hides it from everybody — no switch on the
 * settings page, `isFeatureEnabled` says no — except a browser where localStorage has
 * `lg_preview=1`, the testers'. Once it passed, the key is taken off the list and everybody has it,
 * without a reload: the config is reactive (remoteConfig.ts).
 *
 * `lg_preview` has no entry in the interface and is not in the help pages.
 */

import {createSignal} from 'solid-js';
import {remoteStrings} from '@/luckgram/core/remoteConfig';

export const PREVIEW_FEATURES_KEY = 'web.preview_features';
export const PREVIEW_STORAGE_KEY = 'lg_preview';

function readPreviewFlag() {
  try {
    return localStorage.getItem(PREVIEW_STORAGE_KEY) === '1';
  } catch(err) {
    return false;
  }
}

const [previewBrowser, setPreviewBrowser] = createSignal(readPreviewFlag());

try {
  // * set in another tab (or cleared): this one follows
  window.addEventListener('storage', (event) => {
    if(event.key === PREVIEW_STORAGE_KEY || event.key === null) setPreviewBrowser(readPreviewFlag());
  });
} catch(err) {}

/** Whether this browser sees the features on the preview list. */
export const isPreviewBrowser = previewBrowser;

/** Pure: a feature on the list is hidden, unless the browser is a preview one. */
export function isHiddenByPreviewList(featureKey: string, list: string[] | undefined, preview: boolean) {
  return !preview && !!list && list.includes(featureKey);
}

/** Reactive: follows the remote config and the browser's flag. */
export function isHiddenByPreview(featureKey: string) {
  return isHiddenByPreviewList(featureKey, remoteStrings(PREVIEW_FEATURES_KEY), previewBrowser());
}
