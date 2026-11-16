/*
 * Luckgram Web (luckgram-specs#191, W12b 需求 4): in a keyword folder, the keywords that stand
 * in a chat's preview are marked. Only what is really there: a chat that is in the folder for an
 * earlier message keeps its preview as it is.
 */

import type {KeywordMatcher} from '@/luckgram/folders/logic';

export const HIT_CLASS = 'luckgram-keyword-hit';

/** Takes the marks out again: the text as it was. */
export function clearKeywordMarks(container: HTMLElement) {
  for(const mark of [...container.querySelectorAll('.' + HIT_CLASS)]) {
    mark.replaceWith(...mark.childNodes);
  }

  container.normalize();
}

/**
 * Marks every place a keyword stands at in the container's text. Each text node by itself: a
 * keyword cut by an emoji's image is not one.
 * @returns how many were marked
 */
export function markKeywords(container: HTMLElement, matcher: KeywordMatcher | undefined): number {
  if(!container || !matcher?.keywords.length) return 0;
  const document = container.ownerDocument;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for(let node = walker.nextNode(); node; node = walker.nextNode()) {
    if(!(node.parentElement?.closest('.' + HIT_CLASS))) nodes.push(node as Text);
  }

  let count = 0;
  for(const node of nodes) {
    const text = node.data;
    const hits = matcher.findAll(text);
    if(!hits.length) continue;

    const fragment = document.createDocumentFragment();
    let at = 0;
    for(const hit of hits) {
      if(hit.start > at) fragment.append(text.slice(at, hit.start));
      const mark = document.createElement('mark');
      mark.className = HIT_CLASS;
      mark.textContent = text.slice(hit.start, hit.end);
      fragment.append(mark);
      at = hit.end;
      ++count;
    }

    if(at < text.length) fragment.append(text.slice(at));
    node.replaceWith(fragment);
  }

  return count;
}
