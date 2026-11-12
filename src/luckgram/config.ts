/*
 * Luckgram Web (luckgram-specs#137, W1).
 * Luckgram's own code lives in src/luckgram/; upstream files only get the few lines that call into it.
 */

export const LUCKGRAM_NAME = 'Luckgram';
export const LUCKGRAM_SOURCE_URL = 'https://github.com/limeng9088/luckgram-web';

/** Telegram's language pack for Simplified Chinese, loaded when the browser is in Chinese. */
export const LUCKGRAM_ZH_LANG_CODE = 'zh-hans-raw';

/** The file a deployment answers with its own build; see scripts/luckgram/assemble.mjs. */
export const LUCKGRAM_VERSION_FILE = 'luckgram-version';

export type LuckgramChannel = 'dev' | 'prod' | 'local';

// * set by scripts/luckgram/vite-plugin.mjs; a dev server and the tests have none of them
const env = import.meta.env as any as Record<string, string | undefined>;

export const LUCKGRAM_BUILD: string = env.VITE_LG_BUILD || '0';
export const LUCKGRAM_COMMIT: string = env.VITE_LG_COMMIT || '';
export const LUCKGRAM_CHANNEL: LuckgramChannel = (env.VITE_LG_CHANNEL as LuckgramChannel) || 'local';
export const LUCKGRAM_IS_DEV = LUCKGRAM_CHANNEL === 'dev';

/**
 * The version line under Settings and in the main menu, the same shape as on the phones (spec 28):
 * upstream's version, the CI run number, the commit. "Luckgram 2.3 (57) · 1a2b3c4".
 */
export function getLuckgramVersionText(upstreamVersion: string) {
  let text = `${LUCKGRAM_NAME} ${upstreamVersion} (${LUCKGRAM_BUILD})`;
  if(LUCKGRAM_COMMIT) text += ` · ${LUCKGRAM_COMMIT.slice(0, 7)}`;
  if(LUCKGRAM_IS_DEV) text += ' · DEV';
  return text;
}
