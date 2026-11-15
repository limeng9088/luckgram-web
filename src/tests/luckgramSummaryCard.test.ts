// * Luckgram Web (luckgram-specs#189, W9): the summary card — stopping while the points are written,
// * an answer's Markdown, references of several ids

import {vi} from 'vitest';
import SummaryCard from '@/luckgram/summary/card';

const tick = async() => {
  for(let i = 0; i < 10; ++i) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 30));
};

/** A press as the card's buttons hear it (upstream listens for the mouse going down where touch is known, for a click elsewhere). */
function press(element: HTMLElement) {
  element.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true}));
  element.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
}

/** A session whose answers are written from here. */
function makeSession() {
  let write: (text: string) => void, finish: (text: string) => void, fail: (err: any) => void;
  const session = {
    validIds: new Set([123, 456, 789]),
    cancelled: 0,
    cancel() {
      ++this.cancelled;
      fail?.(Object.assign(new Error('cancelled'), {code: 'cancelled'}));
    },
    summarize: (_range: any, callbacks: any) => new Promise<string>((resolve, reject) => {
      write = callbacks.onText;
      finish = resolve;
      fail = reject;
    }),
    ask: (_question: string, onText: (text: string) => void) => new Promise<string>((resolve, reject) => {
      write = onText;
      finish = resolve;
      fail = reject;
    })
  };
  return {session, write: (text: string) => write(text), finish: (text: string) => finish(text)};
}

/** Enough of a Markdown renderer for the card: **bold**, the rest as text. */
function renderMarkdown(markdown: string) {
  const fragment = document.createDocumentFragment();
  markdown.split(/(\*\*[^*]+\*\*)/).forEach((piece) => {
    if(piece.startsWith('**')) {
      const strong = document.createElement('strong');
      strong.textContent = piece.slice(2, -2);
      fragment.append(strong);
    } else if(piece) {
      fragment.append(piece);
    }
  });
  return fragment;
}

function makeCard() {
  const {session, write, finish} = makeSession();
  const jumps: number[] = [];
  const card = new SummaryCard({session: session as any, unreadCount: 127, onJump: (id) => jumps.push(id), onClose: () => {}, renderMarkdown});
  document.body.append(card.element);
  return {card, session, write, finish, jumps};
}

describe('luckgram summary card', () => {
  // * the test's page lays nothing out: scrolling to the new answer is a no-op there
  beforeAll(() => {
    Element.prototype.scrollIntoView ??= () => {};
  });

  test('"停止" while the points are written keeps what is there, and the card stays (specs#189)', async() => {
    const {card, session, write} = makeCard();
    card.summarize('unread');
    await tick();
    // * nothing written yet: "取消", as before
    expect(card.element.querySelector('.luckgram-summary-stop')).toBeNull();

    write('- 酒吧在招聘【#123, #456】\n- 周五交');
    await tick();
    const stop = card.element.querySelector<HTMLElement>('.luckgram-summary-stop button');
    expect(['停止', 'Stop']).toContain(stop.textContent);
    expect(card.element.querySelectorAll('.luckgram-summary-point').length).toBe(2);

    press(stop);
    await tick();
    expect(session.cancelled).toBe(1);
    // * the points are still there, no longer "being written"; no error, no "停止"; the question field is offered
    const points = card.element.querySelectorAll('.luckgram-summary-point');
    expect(points.length).toBe(2);
    expect(card.element.querySelector('.luckgram-summary-points').classList.contains('is-writing')).toBe(false);
    expect(card.element.querySelector('.luckgram-summary-stop')).toBeNull();
    expect(card.element.querySelector('.luckgram-summary-error')).toBeNull();
    expect(card.element.querySelector('.luckgram-summary-footer').classList.contains('hide')).toBe(false);
    expect(card.element.isConnected).toBe(true);
    card.close();
  });

  test('a point that names several messages in one pair of brackets: a button for each', async() => {
    const {card, write, finish, jumps} = makeCard();
    card.summarize(100);
    await tick();
    write('- 酒吧在招聘【#123, #456, #789】');
    await tick();
    finish('- 酒吧在招聘【#123, #456, #789】\n- 另一条 [#456]');
    await tick();

    const points = card.element.querySelectorAll('.luckgram-summary-point');
    expect(points[0].querySelectorAll('.luckgram-summary-ref').length).toBe(3);
    expect(points[0].textContent).not.toContain('【');
    expect(points[1].querySelectorAll('.luckgram-summary-ref').length).toBe(1);
    press(points[0].querySelectorAll<HTMLElement>('.luckgram-summary-ref')[2]);
    expect(jumps).toEqual([789]);
    // * written to its end: nothing to stop
    expect(card.element.querySelector('.luckgram-summary-stop')).toBeNull();
    card.close();
  });

  test('an answer to a question: its Markdown is drawn, its references are buttons', async() => {
    const {card, finish, jumps} = makeCard();
    card.summarize(100);
    await tick();
    finish('- 一条 [#123]');
    await tick();

    const field = card.element.querySelector<HTMLInputElement>('.luckgram-summary-field');
    field.value = '有人在招聘吗？';
    press(card.element.querySelector<HTMLElement>('.luckgram-summary-send'));
    await tick();
    finish('**有**，酒吧在招 [#456, #789]。');
    await tick();

    const answer = card.element.querySelector('.luckgram-summary-answer');
    expect(answer.querySelector('strong').textContent).toBe('有');
    expect(answer.textContent).not.toContain('**');
    expect(answer.textContent).not.toMatch(/[\uE000\uE001]/);
    const refs = answer.querySelectorAll<HTMLElement>('.luckgram-summary-ref');
    expect(refs.length).toBe(2);
    press(refs[0]);
    expect(jumps).toEqual([456]);
    card.close();
  });

  test('without a renderer an answer is plain text with its references', async() => {
    const {session, finish} = makeSession();
    const card = new SummaryCard({session: session as any, onJump: vi.fn(), onClose: () => {}});
    document.body.append(card.element);
    card.summarize(100);
    await tick();
    finish('- 一条 [#123]');
    await tick();
    card.element.querySelector<HTMLInputElement>('.luckgram-summary-field').value = '问题';
    press(card.element.querySelector<HTMLElement>('.luckgram-summary-send'));
    await tick();
    finish('**有** [#456]');
    await tick();
    const answer = card.element.querySelector('.luckgram-summary-answer');
    expect(answer.textContent).toContain('**有**');
    expect(answer.querySelectorAll('.luckgram-summary-ref').length).toBe(1);
    card.close();
  });
});
