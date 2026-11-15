// * Luckgram Web (luckgram-specs#187, W7): what stands over the message field takes room from the messages

import {trackOverField} from '@/luckgram/core/inputRoom';

function makeElement(height: number) {
  const element = document.createElement('div');
  document.body.append(element);
  Object.defineProperty(element, 'offsetHeight', {configurable: true, get: () => height});
  return element;
}

describe('luckgram: room over the message field', () => {
  test('the panel and a bar are counted together, and given back when they go', () => {
    const heights: number[] = [];
    const input = {luckgramSetExtraHeight: (px: number) => heights.push(px)};

    const panel = makeElement(240);
    const releasePanel = trackOverField(input, panel);
    expect(heights[heights.length - 1]).toBe(240);

    const bar = makeElement(32);
    const releaseBar = trackOverField(input, bar);
    expect(heights[heights.length - 1]).toBe(272);

    releasePanel();
    expect(heights[heights.length - 1]).toBe(32);
    releasePanel();
    releaseBar();
    expect(heights[heights.length - 1]).toBe(0);
    panel.remove();
    bar.remove();
  });

  test('what was taken out of the page without a word counts for nothing', () => {
    const heights: number[] = [];
    const input = {luckgramSetExtraHeight: (px: number) => heights.push(px)};
    const gone = makeElement(100);
    trackOverField(input, gone);
    gone.remove();
    const bar = makeElement(32);
    const release = trackOverField(input, bar);
    expect(heights[heights.length - 1]).toBe(32);
    release();
    bar.remove();
  });

  test('a field that takes no room (another build of it) is left alone', () => {
    const element = makeElement(10);
    expect(() => trackOverField({}, element)()).not.toThrow();
    element.remove();
  });
});
