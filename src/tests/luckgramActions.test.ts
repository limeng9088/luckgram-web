// * Luckgram Web (luckgram-specs#190, W11a): 收藏 and "全选 … 的消息" — the rules, the pages, the batches

import {
  BATCH_SIZE, BatchRun, BatchState, canSaveMessage, canSelectAllFrom, chunk, collectSenderMessages, findSavedMid, getBatchText, getSelectAllText, mergeTexts
} from '@/luckgram/actions/logic';

describe('luckgram actions: 收藏', () => {
  const ok = {enabled: true, noForwards: false, isSavedMessages: false, isScheduled: false, isService: false, isPending: false};

  test('offered for a message that can be forwarded, outside Saved Messages', () => {
    expect(canSaveMessage(ok)).toBe(true);
    for(const key of ['noForwards', 'isSavedMessages', 'isScheduled', 'isService', 'isPending'] as const) {
      expect(canSaveMessage({...ok, [key]: true})).toBe(false);
    }

    expect(canSaveMessage({...ok, enabled: false})).toBe(false);
  });

  test('"查看" goes to the first message the save made', () => {
    expect(findSavedMid(100, [103, 102, 101, 100, 99])).toBe(101);
    expect(findSavedMid(undefined, [5, 4])).toBe(4);
    expect(findSavedMid(100, [100, 99])).toBeUndefined();
    expect(findSavedMid(100, [])).toBeUndefined();
  });
});

describe('luckgram actions: whose messages can be selected', () => {
  const ok = {enabled: true, isChatView: true, isBroadcast: false, isService: false, senderId: 7};

  test('in a group or a private chat; not in a channel that broadcasts, not in other views', () => {
    expect(canSelectAllFrom(ok)).toBe(true);
    expect(canSelectAllFrom({...ok, isBroadcast: true})).toBe(false);
    expect(canSelectAllFrom({...ok, isChatView: false})).toBe(false);
    expect(canSelectAllFrom({...ok, isService: true})).toBe(false);
    expect(canSelectAllFrom({...ok, senderId: undefined})).toBe(false);
    expect(canSelectAllFrom({...ok, enabled: false})).toBe(false);
  });

  test('the item says whose', () => {
    expect(getSelectAllText({isOwn: true, isPrivate: false, name: 'Me'})[0]).toBe('全选我的消息');
    expect(getSelectAllText({isOwn: false, isPrivate: true, name: 'Noah'})[0]).toBe('全选对方的消息');
    expect(getSelectAllText({isOwn: false, isPrivate: false, name: 'Noah'})).toEqual(['全选 Noah 的消息', 'Select all messages from Noah']);
    expect(getSelectAllText({isOwn: false, isPrivate: false})[0]).toBe('全选对方的消息');
    expect(getSelectAllText({isOwn: false, isPrivate: false, name: '很'.repeat(30)})[0]).toBe('全选 ' + '很'.repeat(20) + '… 的消息');
  });
});

/** A sender with `count` messages (mids count…1), given in pages of `size`, the newest first. */
const pages = (count: number, size = BATCH_SIZE) => {
  const all = Array.from({length: count}, (_, i) => count - i);
  const asked: number[] = [];
  return {
    asked,
    loadPage: async(offsetId: number) => {
      asked.push(offsetId);
      const from = offsetId ? all.findIndex((mid) => mid < offsetId) : 0;
      const mids = from === -1 ? [] : all.slice(from, from + size);
      return {mids, end: from === -1 || from + size >= all.length};
    }
  };
};

describe('luckgram actions: reading all of a sender\'s messages', () => {
  test('page by page until the end, the count growing', async() => {
    const {asked, loadPage} = pages(357);
    const totals: number[] = [];
    const result = await collectSenderMessages({loadPage, onPage: (_mids, total) => totals.push(total)});
    expect(result).toEqual({total: 357, cancelled: false});
    expect(totals).toEqual([100, 200, 300, 357]);
    expect(asked).toEqual([0, 258, 158, 58]);
  });

  test('nothing, and exactly one page', async() => {
    expect((await collectSenderMessages({...pages(0), onPage: () => {}})).total).toBe(0);
    const one = pages(100);
    expect((await collectSenderMessages({loadPage: one.loadPage, onPage: () => {}})).total).toBe(100);
    expect(one.asked).toEqual([0]);
  });

  test('cancelled between pages: it stops, and says so', async() => {
    const {asked, loadPage} = pages(357);
    const signal = {aborted: false};
    const result = await collectSenderMessages({loadPage, signal, onPage: (_mids, total) => {
      if(total === 200) signal.aborted = true;
    }});
    expect(result).toEqual({total: 200, cancelled: true});
    expect(asked.length).toBe(2);
  });

  test('a server that repeats itself does not keep it going', async() => {
    let calls = 0;
    const result = await collectSenderMessages({
      loadPage: async() => (++calls, {mids: [3, 2, 1], end: false}),
      onPage: () => {}
    });
    expect(result.total).toBe(3);
    expect(calls).toBe(2);
  });
});

describe('luckgram actions: copying', () => {
  test('texts in the order of time, an empty line between, no text left out', () => {
    expect(mergeTexts([
      {mid: 3, date: 30, text: 'third'},
      {mid: 1, date: 10, text: ' first '},
      {mid: 2, date: 20, text: ''},
      {mid: 5, date: 20, text: 'second, later id'},
      {mid: 4, date: 20, text: 'second'},
      undefined
    ])).toEqual({text: 'first\n\nsecond\n\nsecond, later id\n\nthird', count: 4});
    expect(mergeTexts([])).toEqual({text: '', count: 0});
  });
});

describe('luckgram actions: batches', () => {
  const items = Array.from({length: 357}, (_, i) => i + 1);

  test('100 a batch, in order, the progress told after each', async() => {
    expect(chunk(items).map((batch) => batch.length)).toEqual([100, 100, 100, 57]);
    const order: number[] = [], states: BatchState[] = [];
    const run = new BatchRun(items, async(batch) => {
      order.push(batch[0]);
    }, (state) => states.push(state));
    const end = await run.start();
    expect(order).toEqual([1, 101, 201, 301]);
    expect(states.map((state) => [state.status, state.done])).toEqual([['running', 0], ['running', 100], ['running', 200], ['running', 300], ['done', 357]]);
    expect(end.succeeded).toBe(357);
    expect(await run.finished).toEqual(end);
  });

  test('a batch that fails stops the run; retry goes on from it, not from the start', async() => {
    const calls: number[] = [];
    let fail = true;
    const run = new BatchRun(items, async(_batch, index) => {
      calls.push(index);
      if(index === 2 && fail) throw new Error('FLOOD_WAIT_5');
    });
    const failed = await run.start();
    expect([failed.status, failed.done, failed.batch, (failed.error as Error).message]).toEqual(['failed', 200, 3, 'FLOOD_WAIT_5']);
    fail = false;
    const end = await run.retry();
    expect(end.status).toBe('done');
    expect(calls).toEqual([0, 1, 2, 2, 3]);
    expect(end.succeeded).toBe(357);
  });

  test('cancelled: the batches not started are left undone', async() => {
    const calls: number[] = [];
    const run: BatchRun<number> = new BatchRun(items, async(_batch, index) => {
      calls.push(index);
      if(index === 1) run.cancel();
    });
    await run.start();
    expect(calls).toEqual([0, 1]);
    expect(run.state.status).toBe('cancelled');
    expect((await run.finished).status).toBe('cancelled');
    // * and cancelling after a failure ends it
    const other = new BatchRun([1, 2], async() => {
      throw new Error('x');
    }, undefined, 1);
    await other.start();
    other.cancel();
    expect((await other.finished).status).toBe('cancelled');
  });

  test('a batch may do fewer than asked: the count says how many', async() => {
    const run = new BatchRun(items, async(batch, index) => index === 3 ? 50 : batch.length);
    const end = await run.start();
    expect(end.succeeded).toBe(350);
    expect(getBatchText('delete', end)[0]).toBe('已删除 350 条，7 条无权删除');
  });

  test('what the progress line says', () => {
    const state = (patch: Partial<BatchState>): BatchState => ({status: 'running', done: 200, total: 357, batch: 3, batches: 4, succeeded: 200, ...patch});
    expect(getBatchText('forward', state({}))[0]).toBe('正在转发 200 / 357…');
    expect(getBatchText('save', state({status: 'failed'}))[0]).toBe('收藏到第 201 条时失败，已完成 200 / 357');
    expect(getBatchText('forward', state({status: 'done', done: 357, succeeded: 357}))[0]).toBe('已转发 357 条消息');
    expect(getBatchText('delete', state({status: 'cancelled'}))[0]).toBe('已取消，完成了 200 / 357');
  });
});
