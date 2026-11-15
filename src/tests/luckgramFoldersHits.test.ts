// * Luckgram Web (luckgram-specs#191, W12b): keywords marked in a chat's preview; going from one found message to the next

import {describe, expect, test} from 'vitest';
import {LOCAL_FOLDER_ID_START as L} from '@/luckgram/folders/guard';
import {getKeywordMatcher, setKeywordFolderLookup} from '@/luckgram/folders/current';
import {HIT_CLASS, clearKeywordMarks, markKeywords} from '@/luckgram/folders/highlight';
import {getJumpText, nextIndex} from '@/luckgram/folders/jumpBar';
import {makeMatcher} from '@/luckgram/folders/logic';
import {KeywordFolderSet} from '@/luckgram/folders/set';

const preview = (html: string) => {
  const span = document.createElement('span');
  span.innerHTML = html;
  return span;
};

const marked = (container: HTMLElement) => [...container.querySelectorAll('.' + HIT_CLASS)].map((mark) => mark.textContent);

describe('luckgram keyword folders: the preview', () => {
  const matcher = makeMatcher(['发票', 'invoice']);

  test('every keyword standing in the text is marked, the text itself unchanged', () => {
    const container = preview('请把发票发我，Invoice 也行，发票！');
    expect(markKeywords(container, matcher)).toBe(3);
    expect(marked(container)).toEqual(['发票', 'Invoice', '发票']);
    expect(container.textContent).toBe('请把发票发我，Invoice 也行，发票！');
  });

  test('inside the preview\'s own elements too; what is not a whole word is left', () => {
    const container = preview('<b>Anna:</b> <i>the invoice</i> and the invoices');
    expect(markKeywords(container, matcher)).toBe(1);
    expect(container.querySelector('i').innerHTML).toBe(`the <mark class="${HIT_CLASS}">invoice</mark>`);
    expect(container.querySelector('b').textContent).toBe('Anna:');
  });

  test('a preview without a keyword (the chat is in the folder for an earlier message) stays as it is', () => {
    const container = preview('<b>Anna:</b> see you tomorrow');
    const before = container.innerHTML;
    expect(markKeywords(container, matcher)).toBe(0);
    expect(container.innerHTML).toBe(before);
  });

  test('marked once however often it is asked; taken out again, the text is as it was', () => {
    const container = preview('发票 and <i>invoice</i>');
    const before = container.innerHTML;
    markKeywords(container, matcher);
    expect(markKeywords(container, matcher)).toBe(0);
    expect(marked(container).length).toBe(2);
    clearKeywordMarks(container);
    expect(container.innerHTML).toBe(before);
  });

  test('nothing without a matcher', () => {
    const container = preview('发票');
    expect(markKeywords(container, undefined)).toBe(0);
    expect(markKeywords(container, makeMatcher([]))).toBe(0);
    expect(markKeywords(undefined, matcher)).toBe(0);
  });
});

describe('luckgram keyword folders: a folder\'s keywords, asked by its id', () => {
  test('only a keyword folder that is there has a matcher', () => {
    const folder = {id: L, title: '发票', keywords: ['发票'], scopes: [] as any[]};
    setKeywordFolderLookup((id) => id === L ? folder : undefined);
    expect(getKeywordMatcher(L).find('发票')).toBe('发票');
    // * the same folder, the same matcher
    expect(getKeywordMatcher(L)).toBe(getKeywordMatcher(L));
    expect(getKeywordMatcher(L + 1)).toBeUndefined();
    expect(getKeywordMatcher(5)).toBeUndefined();
    expect(getKeywordMatcher(undefined)).toBeUndefined();
    setKeywordFolderLookup(() => {
      throw new Error('gone');
    });
    expect(getKeywordMatcher(L)).toBeUndefined();
  });
});

describe('luckgram keyword folders: from one found message to the next', () => {
  test('the messages a folder found, the latest first, each with its keyword', () => {
    const set = new KeywordFolderSet();
    set.set([{id: L, title: 'x', keywords: ['发票', 'invoice'], scopes: []}]);
    expect(set.findMessages(L, [
      {mid: 9, text: 'hello'},
      {mid: 8, text: 'Your invoice'},
      {mid: 7, text: undefined},
      {mid: 6, text: '发票在这'}
    ])).toEqual([{mid: 8, keyword: 'invoice'}, {mid: 6, keyword: '发票'}]);
    expect(set.findMessages(L + 3, [{mid: 1, text: '发票'}])).toEqual([]);
  });

  test('round and round', () => {
    expect([nextIndex(-1, 3), nextIndex(0, 3), nextIndex(2, 3)]).toEqual([0, 1, 0]);
    expect(nextIndex(-1, 0)).toBe(0);
    expect(getJumpText({mid: 6, keyword: '发票'}, 1, 5)).toEqual(['跳到下一个「发票」（2 / 5）', 'Next "发票" (2 of 5)']);
  });
});
