/*
 * Luckgram Web (luckgram-specs#180, #182): Simplified Chinese for interface strings that
 * Telegram's Chinese language pack does not have. The pack is made for Telegram's own web
 * client; this client has strings of its own, which stayed in English in a Chinese interface.
 *
 * Key → text, with the same placeholders as the English in src/lang.ts (a pluralized string is
 * an object with the same forms). Used only for a key the server's pack lacks (zhOverlay.ts) —
 * once Telegram translates one, theirs is shown. Loaded on demand, only for a Chinese interface.
 *
 * The texts are machine-made and were not reviewed. Their words are those of Telegram's own
 * Chinese pack: zh/GLOSSARY.md, to be read before adding any.
 */

import settings from '@/luckgram/zh/settings';
import chat from '@/luckgram/zh/chat';
import callsStories from '@/luckgram/zh/callsStories';
import communityEditors from '@/luckgram/zh/communityEditors';
import misc from '@/luckgram/zh/misc';

export type LuckgramZhTexts = {[key: string]: string | {[form: string]: string}};

/** The parts, for the tests: a key belongs to one of them only. */
export const LUCKGRAM_ZH_PARTS: {[name: string]: LuckgramZhTexts} = {settings, chat, callsStories, communityEditors, misc};

const zh: LuckgramZhTexts = Object.assign({}, ...Object.values(LUCKGRAM_ZH_PARTS));

export default zh;
