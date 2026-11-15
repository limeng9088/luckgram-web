/*
 * Luckgram Web (luckgram-specs#188, W8 需求 4): a reply's Markdown drawn by upstream's own
 * message renderer. The Markdown is turned into text with entities here (logic.ts:
 * markdownToEntities) — upstream's own Markdown is the one of the message field, which leaves
 * **marks** beside Chinese characters as they are.
 */

import mergeEntities from '@lib/richTextProcessor/mergeEntities';
import parseEntities from '@lib/richTextProcessor/parseEntities';
import wrapRichText from '@lib/richTextProcessor/wrapRichText';
import type {MessageEntity} from '@layer';
import {markdownToEntities} from '@/luckgram/assistant/logic';
import {drawTables} from '@/luckgram/assistant/tables';

export function renderMarkdown(markdown: string): DocumentFragment {
  try {
    const {text, entities: formatting} = markdownToEntities(markdown);
    // * links, mentions and the like that stand in the text as they are
    const entities = mergeEntities(formatting as MessageEntity[], parseEntities(text));
    const fragment = wrapRichText(text, {entities});
    drawTables(fragment, text, formatting);
    return fragment;
  } catch(err) {
    // * whatever the renderer chokes on is shown as it was written
    console.warn('[luckgram] assistant: a reply was not drawn as Markdown', (err as Error)?.message);
    const fragment = document.createDocumentFragment();
    fragment.append(markdown);
    return fragment;
  }
}

export function renderPlain(text: string): DocumentFragment {
  try {
    return wrapRichText(text, {entities: parseEntities(text)});
  } catch(err) {
    const fragment = document.createDocumentFragment();
    fragment.append(text);
    return fragment;
  }
}
