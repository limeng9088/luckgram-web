/*
 * Luckgram Web (luckgram-specs#139, W3): the one LuckgramApi of the page. The app's version is
 * upstream's ("2.3"), the same the version line shows; the server compares it with a feature's
 * `min_app_version`.
 */

import App from '@config/app';
import I18n from '@lib/langPack';
import {LUCKGRAM_API_ENDPOINTS, LuckgramApi} from '@/luckgram/core/api';

const luckgramApi = new LuckgramApi({
  endpoints: LUCKGRAM_API_ENDPOINTS,
  appVersion: App.version,
  locale: () => {
    const lang = I18n.getLastRequestedLangCode();
    // * the server speaks the device's language: Chinese for a Chinese interface, the browser's otherwise
    return lang && lang !== 'en' ? (/^zh/i.test(lang) ? 'zh-CN' : lang) : (navigator.language || 'en');
  }
});

export default luckgramApi;
