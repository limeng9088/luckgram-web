/*
 * Luckgram Web (luckgram-specs#139, W3): the one LuckgramApi of the page. The app's version is
 * upstream's ("2.3"), the same the version line shows; the server compares it with a feature's
 * `min_app_version`.
 */

import App from '@config/app';
import I18n from '@lib/langPack';
import {LUCKGRAM_API_ENDPOINTS, LuckgramApi} from '@/luckgram/core/api';
import {luckgramDeviceLocale} from '@/luckgram/text';

const luckgramApi = new LuckgramApi({
  endpoints: LUCKGRAM_API_ENDPOINTS,
  appVersion: App.version,
  locale: () => {
    // * the server speaks the device's language, and writes Chinese in its script: the interface's
    // * language as a tag ("zh-Hans", "zh-Hant"), the browser's while the interface is not chosen
    return luckgramDeviceLocale(I18n.getLastRequestedLangCode(), navigator.language);
  }
});

export default luckgramApi;
