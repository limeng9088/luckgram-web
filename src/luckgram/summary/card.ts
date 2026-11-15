/*
 * Luckgram Web (luckgram-specs#189, W9 需求 1、3、4、6): the summary's card — a layer under the
 * chat's top bars, over the messages: it does not push them down, folds into one line, and closes.
 *
 *   header   聊天总结 · the range · fold · close
 *   body     choosing the range (from the ⋮ menu) → the progress, with 取消 → the points, each
 *            followed by its references (a press goes to the message) → questions and answers
 *   footer   "AI 生成，可能有误" · 问这些消息…
 *
 * Its own DOM; what it needs of the chat comes in as functions. Nothing is kept: closing the
 * card, or a reload, and it is gone.
 */

import {attachClickEvent} from '@helpers/dom/clickEvent';
import {LuckgramApiError, errorMessage} from '@/luckgram/core/errors';
import {lgText} from '@/luckgram/text';
import {holdEscape} from '@/luckgram/core/escape';
import {MAX_QUESTION_CHARS, RANGES, REFERENCE_MARK, SummaryRange, markReferences, parseBullets, parseSegments} from '@/luckgram/summary/logic';
import SummarySession, {EmptyRangeError, SummaryProgress} from '@/luckgram/summary/session';

export type SummaryCardOptions = {
  session: SummarySession,
  /** unread when the chat was opened: the "未读" range is offered with it */
  unreadCount?: number,
  /** goes to the message and marks it */
  onJump: (messageId: number) => void,
  onClose: () => void,
  /**
   * Draws an answer's Markdown, as the assistant's page does (bold, lists, code). Given, not
   * imported: the renderer is upstream's and a heavy thing to load. Without it the text is plain.
   */
  renderMarkdown?: (markdown: string) => DocumentFragment
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  if(className) element.className = className;
  if(text !== undefined) element.textContent = text;
  return element;
};

const button = (className: string, text: string, onClick: () => void) => {
  const element = el('button', className, text);
  element.type = 'button';
  attachClickEvent(element, (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return element;
};

export const getRangeTitle = (range: SummaryRange, unreadCount?: number) => range === 'unread' ?
  lgText(`${unreadCount || ''} 条未读`.trim(), `${unreadCount || ''} unread`.trim()) :
  lgText(`最近 ${range} 条`, `Latest ${range}`);

export function getProgressText(progress: SummaryProgress): string {
  if(progress.stage === 'loading') {
    return progress.total ?
      lgText(`正在读取消息 ${progress.loaded} / ${progress.total}…`, `Reading messages ${progress.loaded} / ${progress.total}…`) :
      lgText('正在读取消息…', 'Reading messages…');
  }

  if(progress.stage === 'merging') return lgText('正在合并各段的总结…', 'Merging the parts…');
  return progress.parts > 1 ?
    lgText(`正在总结第 ${progress.part} / ${progress.parts} 段…`, `Summarizing part ${progress.part} of ${progress.parts}…`) :
    lgText('正在总结…', 'Summarizing…');
}

export default class SummaryCard {
  public element: HTMLElement;
  private rangeEl: HTMLElement;
  private bodyEl: HTMLElement;
  private footerEl: HTMLElement;
  private field: HTMLInputElement;
  private askButton: HTMLButtonElement;
  private foldButton: HTMLButtonElement;
  private run = 0;
  private busy = false;
  private closed = false;
  private releaseEscape: () => void;

  constructor(private options: SummaryCardOptions) {
    const card = this.element = el('div', 'luckgram-summary-card');
    card.setAttribute('role', 'region');
    card.setAttribute('aria-label', lgText('聊天总结', 'Chat summary'));

    const header = el('div', 'luckgram-summary-header');
    this.rangeEl = el('span', 'luckgram-summary-range');
    this.foldButton = button('luckgram-summary-icon', '▾', () => this.toggleFold());
    this.foldButton.setAttribute('aria-label', lgText('收起', 'Fold'));
    const close = button('luckgram-summary-icon', '✕', () => this.close());
    close.setAttribute('aria-label', lgText('关闭', 'Close'));
    header.append(el('span', 'luckgram-summary-title', lgText('聊天总结', 'Chat summary')), this.rangeEl, this.foldButton, close);
    // * the folded line opens again by a press anywhere on it
    attachClickEvent(header, () => {
      if(card.classList.contains('is-folded')) this.toggleFold();
    });

    this.bodyEl = el('div', 'luckgram-summary-body');

    this.footerEl = el('div', 'luckgram-summary-footer hide');
    const row = el('div', 'luckgram-summary-ask');
    this.field = el('input', 'luckgram-summary-field');
    this.field.type = 'text';
    this.field.dir = 'auto';
    this.field.placeholder = lgText('问这些消息…', 'Ask about these messages…');
    // * a question, not a document: the request's room is for the messages it is asked about
    this.field.maxLength = MAX_QUESTION_CHARS;
    this.field.addEventListener('keydown', (e) => {
      if(e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        this.ask();
      }
    });
    this.askButton = button('luckgram-summary-send', '↑', () => this.ask());
    this.askButton.setAttribute('aria-label', lgText('提问', 'Ask'));
    row.append(this.field, this.askButton);
    this.footerEl.append(el('div', 'luckgram-summary-note', lgText('AI 生成，可能有误', 'Written by AI. It may be wrong')), row);

    card.append(header, this.bodyEl, this.footerEl);
    this.holdEscape(true);
  }

  // ------------------------------------------------------------------ states

  /** From the ⋮ menu: the range is picked first. */
  public showRanges() {
    this.rangeEl.textContent = '';
    this.footerEl.classList.add('hide');
    const list = el('div', 'luckgram-summary-ranges');
    list.append(el('div', 'luckgram-summary-hint', lgText('总结哪些消息？', 'Which messages?')));
    const ranges: SummaryRange[] = [...(this.options.unreadCount > 0 ? ['unread' as const] : []), ...RANGES];
    for(const range of ranges) {
      list.append(button('luckgram-summary-chip', getRangeTitle(range, this.options.unreadCount), () => this.summarize(range)));
    }

    this.bodyEl.replaceChildren(list);
  }

  private showProgress(text: string, onCancel: () => void) {
    const box = el('div', 'luckgram-summary-progress');
    box.append(el('span', 'luckgram-summary-progress-text', text), button('luckgram-summary-link', lgText('取消', 'Cancel'), onCancel));
    this.bodyEl.replaceChildren(box);
  }

  private showError(err: unknown, retry: () => void) {
    const text = err instanceof EmptyRangeError ?
      lgText('这个范围里没有可以总结的文字消息。', 'There are no text messages to summarize in this range.') :
      lgText(...errorMessage(err instanceof LuckgramApiError ? err.code : ''));
    const box = el('div', 'luckgram-summary-error');
    box.append(el('span', undefined, text), button('luckgram-summary-link', lgText('重试', 'Retry'), retry));
    this.bodyEl.replaceChildren(box);
  }

  private makeReference(messageId: number) {
    const reference = button('luckgram-summary-ref', '↗', () => this.options.onJump(messageId));
    reference.title = lgText('跳到原消息', 'Go to the message');
    reference.setAttribute('aria-label', reference.title);
    return reference;
  }

  /** Text with its references: each a small button that goes to its message. */
  private renderSegments(text: string, container: HTMLElement) {
    for(const segment of parseSegments(text, this.options.session.validIds)) {
      if('text' in segment) container.append(segment.text);
      else container.append(this.makeReference(segment.messageId));
    }
  }

  /**
   * An answer to a question: its Markdown drawn as the assistant's page draws it, the references
   * as buttons. The references go through the renderer as marks it leaves alone, and are put in
   * their places after it.
   */
  private renderAnswer(text: string, container: HTMLElement) {
    const render = this.options.renderMarkdown;
    if(!render) {
      this.renderSegments(text, container);
      return;
    }

    let fragment: DocumentFragment;
    try {
      fragment = render(markReferences(text, this.options.session.validIds));
    } catch(err) {
      this.renderSegments(text, container);
      return;
    }

    const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
    const marked: Text[] = [];
    for(let node = walker.nextNode(); node; node = walker.nextNode()) {
      if(node.nodeValue.includes('\uE000')) marked.push(node as Text);
    }

    for(const node of marked) {
      const parts: (string | HTMLElement)[] = [];
      let last = 0;
      const value = node.nodeValue;
      REFERENCE_MARK.lastIndex = 0;
      for(let match = REFERENCE_MARK.exec(value); match; match = REFERENCE_MARK.exec(value)) {
        if(match.index > last) parts.push(value.slice(last, match.index));
        parts.push(this.makeReference(Number(match[1])));
        last = match.index + match[0].length;
      }

      if(last < value.length) parts.push(value.slice(last));
      node.replaceWith(...parts);
    }

    container.append(fragment);
  }

  /** @param onStop while it is being written: "停止" under the points, which keeps what is there */
  private renderSummary(text: string, done: boolean, onStop?: () => void) {
    const list = el('ul', 'luckgram-summary-points');
    for(const bullet of parseBullets(text)) {
      const item = el('li', 'luckgram-summary-point');
      item.dir = 'auto';
      this.renderSegments(bullet, item);
      list.append(item);
    }

    list.classList.toggle('is-writing', !done);
    const answers = this.bodyEl.querySelector('.luckgram-summary-answers') || el('div', 'luckgram-summary-answers');
    if(!done && onStop) {
      const stop = el('div', 'luckgram-summary-stop');
      stop.append(button('luckgram-summary-link', lgText('停止', 'Stop'), onStop));
      this.bodyEl.replaceChildren(list, stop, answers);
      return;
    }

    this.bodyEl.replaceChildren(list, answers);
  }

  // ------------------------------------------------------------------ doing

  public async summarize(range: SummaryRange) {
    const run = ++this.run;
    this.busy = true;
    this.unfold();
    this.rangeEl.textContent = '· ' + getRangeTitle(range, this.options.unreadCount);
    this.footerEl.classList.add('hide');
    const cancel = () => {
      this.options.session.cancel();
      if(this.run !== run) return;
      ++this.run;
      this.busy = false;
      // * from the bar there was no choosing: cancelling leaves nothing to show
      this.showRanges();
    };

    this.showProgress(getProgressText({stage: 'loading', loaded: 0, total: 0}), cancel);
    let wrote = false, scheduled = false, latest = '', stopped = false;
    // * "停止" once the points are being written: the writing ends, what was written stays — the
    // * card is not closed for it, as ✕ would
    const stop = () => {
      if(this.run !== run || stopped) return;
      stopped = true;
      this.options.session.cancel();
    };
    try {
      const text = await this.options.session.summarize(range, {
        onProgress: (progress) => {
          if(this.run === run && !wrote) this.showProgress(getProgressText(progress), cancel);
        },
        onText: (whole) => {
          latest = whole;
          if(scheduled) return;
          scheduled = true;
          requestAnimationFrame(() => {
            scheduled = false;
            if(this.run !== run || stopped || !parseBullets(latest).length) return;
            wrote = true;
            this.renderSummary(latest, false, stop);
          });
        }
      });

      if(this.run !== run) return;
      if(!parseBullets(text).length) throw new LuckgramApiError(LuckgramApiError.UPSTREAM_UNAVAILABLE);
      this.renderSummary(text, true);
      this.footerEl.classList.remove('hide');
    } catch(err) {
      if(this.run !== run) return;
      // * stopped by the user: the points that were written are the summary, and can be asked about
      if(stopped && parseBullets(latest).length) {
        this.renderSummary(latest, true);
        this.footerEl.classList.remove('hide');
        return;
      }

      this.showError(err, () => this.summarize(range));
    } finally {
      if(this.run === run) this.busy = false;
    }
  }

  private async ask() {
    const question = this.field.value.trim();
    if(!question || this.busy) return;
    const run = ++this.run;
    this.busy = true;
    this.field.value = '';
    this.askButton.disabled = true;

    const answers = this.bodyEl.querySelector('.luckgram-summary-answers') as HTMLElement;
    const block = el('div', 'luckgram-summary-qa');
    const q = el('div', 'luckgram-summary-question', question);
    q.dir = 'auto';
    const a = el('div', 'luckgram-summary-answer', '…');
    a.dir = 'auto';
    block.append(q, a);
    answers?.append(block);
    block.scrollIntoView({block: 'nearest'});

    const write = (text: string) => {
      a.replaceChildren();
      this.renderAnswer(text, a);
    };

    let scheduled = false, latest = '';
    try {
      const text = await this.options.session.ask(question, (whole) => {
        latest = whole;
        if(scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
          scheduled = false;
          if(this.run === run) write(latest);
        });
      });
      if(this.run === run) write(text);
    } catch(err) {
      if(this.run === run) {
        a.classList.add('is-error');
        a.textContent = lgText(...errorMessage(err instanceof LuckgramApiError ? err.code : ''));
      }
    } finally {
      if(this.run === run) {
        this.busy = false;
        this.askButton.disabled = false;
      }
    }
  }

  // ------------------------------------------------------------------ folding, closing

  private setFolded(folded: boolean) {
    this.element.classList.toggle('is-folded', folded);
    this.foldButton.textContent = folded ? '▸' : '▾';
    this.foldButton.setAttribute('aria-label', folded ? lgText('展开', 'Unfold') : lgText('收起', 'Fold'));
    this.holdEscape(!folded);
  }

  /**
   * Esc folds the open card and goes no further (upstream would close the chat under it). It folds,
   * not closes: a summary that took a request to make should not go by a slip — ✕ closes it. The
   * folded line leaves Esc to the chat.
   */
  private holdEscape(hold: boolean) {
    this.releaseEscape?.();
    this.releaseEscape = hold && !this.closed ? holdEscape(() => this.setFolded(true)) : undefined;
  }

  public unfold() {
    this.setFolded(false);
  }

  public fold() {
    this.setFolded(true);
  }

  private toggleFold() {
    this.setFolded(!this.element.classList.contains('is-folded'));
  }

  public close() {
    if(this.closed) return;
    this.closed = true;
    this.holdEscape(false);
    ++this.run;
    this.options.session.cancel();
    this.element.remove();
    this.options.onClose();
  }
}
