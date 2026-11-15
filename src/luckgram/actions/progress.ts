/*
 * Luckgram Web (luckgram-specs#190, W11a 需求 5、6): the line that tells of a long action — the
 * selection being read ("已选 200 条 · 正在加载…  取消"), a batch run going on, failed ("重试") or
 * done. One line at the page's foot, over everything; its own DOM.
 */

import {attachClickEvent} from '@helpers/dom/clickEvent';
import {lgText} from '@/luckgram/text';
import {BatchRun, BatchState, getBatchText} from '@/luckgram/actions/logic';

export type ProgressLine = {
  set: (text: string, buttons?: {text: string, onClick: () => void, primary?: boolean}[]) => void,
  /** @param after milliseconds the last text stays for */
  close: (after?: number) => void
};

let current: {element: HTMLElement, timer?: number};

export function openProgressLine(): ProgressLine {
  if(current) {
    clearTimeout(current.timer);
    current.element.remove();
  }

  const element = document.createElement('div');
  element.className = 'luckgram-progress-line';
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  const mine: typeof current = current = {element};
  document.body.append(element);

  return {
    set: (text, buttons = []) => {
      const label = document.createElement('span');
      label.className = 'luckgram-progress-line-text';
      label.textContent = text;
      element.replaceChildren(label, ...buttons.map((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'luckgram-progress-line-button' + (item.primary ? ' is-primary' : '');
        button.textContent = item.text;
        attachClickEvent(button, (e) => {
          e.preventDefault();
          e.stopPropagation();
          item.onClick();
        });
        return button;
      }));
    },
    close: (after = 0) => {
      const remove = () => {
        element.remove();
        if(current === mine) current = undefined;
      };

      if(after) mine.timer = window.setTimeout(remove, after);
      else remove();
    }
  };
}

/**
 * Runs `perform` over the items, 100 at a time and in order, with the line showing how far it is.
 * A batch that fails stops it with "重试" and "放弃". Resolves when it is done or given up.
 */
export function runBatches<T>(
  action: 'forward' | 'save' | 'delete',
  items: T[],
  perform: (batch: T[], index: number) => Promise<number | void>
): Promise<BatchState> {
  const line = openProgressLine();
  const run: BatchRun<T> = new BatchRun(items, perform, (state) => {
    const text = lgText(...getBatchText(action, state));
    if(state.status === 'running') {
      line.set(text, [{text: lgText('取消', 'Cancel'), onClick: () => run.cancel()}]);
    } else if(state.status === 'failed') {
      line.set(text, [
        {text: lgText('重试', 'Retry'), primary: true, onClick: () => run.retry()},
        {text: lgText('放弃', 'Give up'), onClick: () => run.cancel()}
      ]);
    } else {
      line.set(text);
      line.close(4000);
    }
  });

  run.start();
  return run.finished;
}

/**
 * For a look at the line without anything being sent (the PR's acceptance steps): `lgBatchDemo()`
 * in the console plays a run of 357 made-up items whose third batch fails once.
 */
export function installBatchDemo() {
  (window as any).lgBatchDemo ??= (total = 357) => {
    let failed = false;
    return runBatches('forward', Array.from({length: total}, (_, i) => i), async(_batch, index) => {
      await new Promise((resolve) => setTimeout(resolve, 900));
      if(index === 2 && !failed) {
        failed = true;
        throw new Error('demo');
      }
    });
  };
}
