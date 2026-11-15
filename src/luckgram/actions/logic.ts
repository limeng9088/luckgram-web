/*
 * Luckgram Web (luckgram-specs#190, W11a 需求 1–6; specs/14-select-all.md, 15-save-direct.md):
 * the rules of "收藏" and of "全选 … 的消息" — who may be selected, how the selection is read
 * page by page, how a long selection is acted on in batches. No imports: what talks to Telegram
 * comes in as functions.
 */

export const SAVE_TO_SAVED = 'save_to_saved';
export const SELECT_ALL_FROM_SENDER = 'select_all_from_sender';

/** Telegram takes this many messages in one request (forwarding, deleting); a search page is as long. */
export const BATCH_SIZE = 100;

// ------------------------------------------------------------------ 收藏

export type SaveCheck = {
  enabled: boolean,
  /** the chat or the message forbids forwarding */
  noForwards: boolean,
  /** the chat on screen is Saved Messages */
  isSavedMessages: boolean,
  /** the view of scheduled messages */
  isScheduled: boolean,
  isService: boolean,
  /** not sent yet, or failed to send */
  isPending: boolean
};

/** Whether "收藏" belongs in a message's menu. */
export function canSaveMessage(check: SaveCheck) {
  return check.enabled && !check.noForwards && !check.isSavedMessages && !check.isScheduled && !check.isService && !check.isPending;
}

/** The first of the messages a save made: the lowest id over what Saved Messages ended with before. */
export function findSavedMid(before: number | undefined, after: number[]): number | undefined {
  const made = after.filter((mid) => before === undefined || mid > before);
  return made.length ? Math.min(...made) : undefined;
}

// ------------------------------------------------------------------ 全选

export type SelectAllCheck = {
  enabled: boolean,
  /** the chat itself: not the view of scheduled or pinned messages, not a search's results */
  isChatView: boolean,
  /** a channel that broadcasts: every post is the channel's, "all of its messages" is the whole channel */
  isBroadcast: boolean,
  isService: boolean,
  /** who wrote the message; nothing when unknown */
  senderId: number | undefined
};

export function canSelectAllFrom(check: SelectAllCheck) {
  return check.enabled && check.isChatView && !check.isBroadcast && !check.isService && !!check.senderId;
}

/** [中文, English] of the menu's item. `name` is the sender's first name, in a group. */
export function getSelectAllText(of: {isOwn: boolean, isPrivate: boolean, name?: string}): [string, string] {
  if(of.isOwn) return ['全选我的消息', 'Select all my messages'];
  if(of.isPrivate || !of.name) return ['全选对方的消息', 'Select all their messages'];
  const name = Array.from(of.name).length > 20 ? Array.from(of.name).slice(0, 20).join('') + '…' : of.name;
  return [`全选 ${name} 的消息`, `Select all messages from ${name}`];
}

export type SenderPage = {mids: number[], end: boolean};

/**
 * Every message of one sender in a chat, read page by page from the newest (`messages.search` by
 * `from_id`). `onPage` is given each page as it comes; cancelling stops before the next one.
 * @returns how many were read, and whether it was cancelled
 */
export async function collectSenderMessages(options: {
  loadPage: (offsetId: number) => Promise<SenderPage>,
  onPage: (mids: number[], total: number) => void,
  signal?: {aborted: boolean},
  /** a safety stop: no chat is read for ever (pages) */
  maxPages?: number
}): Promise<{total: number, cancelled: boolean}> {
  const seen = new Set<number>();
  let offsetId = 0;
  for(let page = 0; page < (options.maxPages ?? 2000); ++page) {
    if(options.signal?.aborted) return {total: seen.size, cancelled: true};
    const result = await options.loadPage(offsetId);
    if(options.signal?.aborted) return {total: seen.size, cancelled: true};

    const fresh = (result?.mids || []).filter((mid) => !seen.has(mid));
    for(const mid of fresh) seen.add(mid);
    if(fresh.length) options.onPage(fresh, seen.size);
    // * a page with nothing new would be asked for again and again
    if(!fresh.length || result.end) break;
    offsetId = Math.min(...fresh);
  }

  return {total: seen.size, cancelled: false};
}

/** The texts of messages, the oldest first, an empty line between; messages without text are left out. */
export function mergeTexts(messages: {mid: number, date?: number, text?: string}[]): {text: string, count: number} {
  const texts = messages
  .filter((message) => message?.text?.trim())
  .sort((a, b) => (a.date || 0) - (b.date || 0) || a.mid - b.mid)
  .map((message) => message.text.trim());
  return {text: texts.join('\n\n'), count: texts.length};
}

// ------------------------------------------------------------------ batches

export function chunk<T>(items: T[], size = BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for(let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type BatchState = {
  status: 'running' | 'failed' | 'done' | 'cancelled',
  /** items of the batches that went through */
  done: number,
  total: number,
  /** the batch at work, or the one that failed (from 1) */
  batch: number,
  batches: number,
  /** what the batches reported as really done (deleted, of those asked for); `done` when they report nothing */
  succeeded: number,
  error?: unknown
};

/**
 * One long action in batches, one after another — in order, so that what is forwarded keeps its
 * order. A batch that fails stops the run: `retry()` goes on from that batch (those before it are
 * not done again), `cancel()` leaves the rest undone.
 */
export class BatchRun<T> {
  private chunks: T[][];
  private index = 0;
  private succeeded = 0;
  private status = 'running' as BatchState['status'];
  private working = false;
  private error: unknown;
  private settle: (state: BatchState) => void;
  /** resolves when the run ends: done or cancelled */
  public finished: Promise<BatchState>;

  constructor(
    private items: T[],
    /** @returns how many of the batch were really done, when that may be fewer than asked */
    private perform: (batch: T[], index: number) => Promise<number | void>,
    private onState: (state: BatchState) => void = () => {},
    size = BATCH_SIZE
  ) {
    this.chunks = chunk(items, size);
    this.finished = new Promise((resolve) => this.settle = resolve);
  }

  /** asked of the field anew: it changes while a batch is awaited */
  private isCancelled() {
    return this.status === 'cancelled';
  }

  public get state(): BatchState {
    const done = this.chunks.slice(0, this.index).reduce((sum, batch) => sum + batch.length, 0);
    return {
      status: this.status,
      done,
      total: this.items.length,
      batch: Math.min(this.index + 1, this.chunks.length),
      batches: this.chunks.length,
      succeeded: this.succeeded,
      error: this.status === 'failed' ? this.error : undefined
    };
  }

  private emit() {
    const state = this.state;
    try {
      this.onState(state);
    } catch(err) {}

    if(state.status === 'done' || state.status === 'cancelled') this.settle(state);
    return state;
  }

  public async start(): Promise<BatchState> {
    if(this.working || this.status === 'done' || this.status === 'cancelled') return this.state;
    this.working = true;
    this.status = 'running';
    this.emit();
    while(this.index < this.chunks.length) {
      const batch = this.chunks[this.index];
      try {
        const count = await this.perform(batch, this.index);
        this.succeeded += typeof count === 'number' ? count : batch.length;
      } catch(err) {
        this.working = false;
        if(this.isCancelled()) return this.state;
        this.status = 'failed';
        this.error = err;
        return this.emit();
      }

      ++this.index;
      if(this.isCancelled()) {
        this.working = false;
        return this.state;
      }

      if(this.index < this.chunks.length) this.emit();
    }

    this.working = false;
    this.status = 'done';
    return this.emit();
  }

  /** After a failure: on from the batch that failed. */
  public retry() {
    if(this.status !== 'failed') return Promise.resolve(this.state);
    return this.start();
  }

  /** The batches not yet started are left undone; one at work finishes on its own. */
  public cancel() {
    if(this.status === 'done' || this.status === 'cancelled') return;
    this.status = 'cancelled';
    this.emit();
  }
}

/** [中文, English] of what the progress line says. */
export function getBatchText(action: 'forward' | 'save' | 'delete', state: BatchState): [string, string] {
  const verbs = {forward: ['转发', 'Forwarding', 'forwarded'], save: ['收藏', 'Saving', 'saved'], delete: ['删除', 'Deleting', 'deleted']}[action];
  if(state.status === 'failed') {
    return [
      `${verbs[0]}到第 ${state.done + 1} 条时失败，已完成 ${state.done} / ${state.total}`,
      `${verbs[1]} failed at message ${state.done + 1}; ${state.done} of ${state.total} done`
    ];
  }

  if(state.status === 'done') {
    const missed = state.total - state.succeeded;
    if(action === 'delete' && missed > 0) {
      return [`已删除 ${state.succeeded} 条，${missed} 条无权删除`, `${state.succeeded} deleted, ${missed} could not be deleted`];
    }

    return [`已${verbs[0]} ${state.succeeded} 条消息`, `${state.succeeded} messages ${verbs[2]}`];
  }

  if(state.status === 'cancelled') return [`已取消，完成了 ${state.done} / ${state.total}`, `Cancelled; ${state.done} of ${state.total} done`];
  return [`正在${verbs[0]} ${state.done} / ${state.total}…`, `${verbs[1]} ${state.done} of ${state.total}…`];
}
