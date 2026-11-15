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
import {TABLE_LANGUAGE, markdownToEntities} from '@/luckgram/assistant/logic';

export function renderMarkdown(markdown: string): DocumentFragment {
  try {
    const {text, entities: formatting} = markdownToEntities(markdown);
    // * links, mentions and the like that stand in the text as they are
    const entities = mergeEntities(formatting as MessageEntity[], parseEntities(text));
    const fragment = wrapRichText(text, {entities});
    drawTables(fragment, text, formatting as MessageEntity[]);
    return fragment;
  } catch(err) {
    // * whatever the renderer chokes on is shown as it was written
    console.warn('[luckgram] assistant: a reply was not drawn as Markdown', (err as Error)?.message);
    const fragment = document.createDocumentFragment();
    fragment.append(markdown);
    return fragment;
  }
}

/**
 * A table is written as it came, in a fixed-width font: its lines never wrap (the box scrolls
 * sideways), so the columns stay columns. It reaches upstream's renderer as a block of code — the
 * only thing there that keeps lines as they are — and is taken out of that block's shell here:
 * no header, no language, no copy button, which are a block of code's.
 */
function drawTables(fragment: DocumentFragment, text: string, entities: MessageEntity[]) {
  const blocks = entities.filter((entity) => entity._ === 'messageEntityPre') as MessageEntity.messageEntityPre[];
  if(!blocks.some((block) => block.language === TABLE_LANGUAGE)) return;
  // * upstream draws a `pre.code` for each, in their order
  const drawn = fragment.querySelectorAll('pre.code');
  if(drawn.length !== blocks.length) return;
  blocks.forEach((block, index) => {
    if(block.language !== TABLE_LANGUAGE) return;
    const table = document.createElement('pre');
    table.classList.add('luckgram-ai-table');
    table.dir = 'ltr';
    table.textContent = text.slice(block.offset, block.offset + block.length).replace(/\n+$/, '');
    drawn[index].replaceWith(table);
  });
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
