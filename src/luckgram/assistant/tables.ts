/*
 * Luckgram Web (luckgram-specs#188, W8 需求 4): a reply's tables, taken out of the shell upstream's
 * renderer draws around a block of code. Nothing of the app is imported here.
 */

import {MarkdownEntity, TABLE_LANGUAGE} from '@/luckgram/assistant/logic';

/**
 * A table is written as it came, in a fixed-width font: its lines never wrap (the box scrolls
 * sideways), so the columns stay columns. It reaches upstream's renderer as a block of code — the
 * only thing there that keeps lines as they are — and is taken out of that block's shell here:
 * no header, no language, no copy button, which are a block of code's.
 */
export function drawTables(fragment: DocumentFragment | HTMLElement, text: string, entities: MarkdownEntity[]) {
  const blocks = entities.filter((entity) => entity._ === 'messageEntityPre');
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
