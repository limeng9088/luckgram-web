/*
 * Luckgram Web (luckgram-specs#189, W9 需求 2–5): one summary of one chat — the range's
 * messages loaded, summarized (in parts and merged when they do not fit a request), and asked
 * about. Nothing here knows of Telegram or of the page: the messages and the AI come in as
 * functions (telegram.ts, the AI client), the card shows what this returns.
 *
 * Nothing is kept: a session lives as long as its card.
 */

import type {AiChatOptions} from '@/luckgram/core/ai';
import {
  DEFAULT_MAX_INPUT_CHARS, SummaryLine, SummaryRange, buildMergeRequest, buildQuestionRequest, splitTranscript
} from '@/luckgram/summary/logic';

export type SummaryProgress =
  {stage: 'loading', loaded: number, total: number} |
  {stage: 'summarizing', part: number, parts: number} |
  {stage: 'merging'};

export type SummaryDeps = {
  /** the range's messages, the oldest first */
  load: (range: SummaryRange, options: {signal: AbortSignal, onProgress: (loaded: number, total: number) => void}) => Promise<SummaryLine[]>,
  chat: (options: AiChatOptions) => Promise<string>,
  maxChars?: () => number
};

/** The range has no message with anything to summarize. */
export class EmptyRangeError extends Error {
  constructor() {
    super('summary_empty');
  }
}

export default class SummarySession {
  public lines: SummaryLine[] = [];
  private ids = new Set<number>();
  private abort: AbortController;

  constructor(private deps: SummaryDeps) {}

  /** The ids a reference may point to: the messages that were really sent to the model. */
  public get validIds() {
    return this.ids;
  }

  private get maxChars() {
    return this.deps.maxChars?.() || DEFAULT_MAX_INPUT_CHARS;
  }

  public cancel() {
    this.abort?.abort();
  }

  private begin() {
    this.cancel();
    return (this.abort = new AbortController()).signal;
  }

  /**
   * @param onText the summary as it is written (of the only part, or of the merge)
   * @returns the summary's text: bullet points with [#id] references
   */
  public async summarize(range: SummaryRange, callbacks: {onProgress?: (progress: SummaryProgress) => void, onText?: (text: string) => void} = {}): Promise<string> {
    const signal = this.begin();
    // * where the time goes, never what is said: for a summary that was slow to start
    const started = Date.now();
    let loadedAt = 0, firstTextAt = 0;
    const onText = callbacks.onText && ((text: string) => {
      if(!firstTextAt) {
        firstTextAt = Date.now();
        console.debug('[luckgram] summary', {range, messages: this.lines.length, loadMs: loadedAt - started, firstTextMs: firstTextAt - loadedAt});
      }

      callbacks.onText(text);
    });
    callbacks.onProgress?.({stage: 'loading', loaded: 0, total: 0});
    this.lines = await this.deps.load(range, {
      signal,
      onProgress: (loaded, total) => callbacks.onProgress?.({stage: 'loading', loaded, total})
    });
    loadedAt = Date.now();
    this.ids = new Set(this.lines.map((line) => line.id));
    if(!this.lines.length) throw new EmptyRangeError();

    const parts = splitTranscript(this.lines, this.maxChars);
    const ask = (content: string, stream: boolean, sourceMessages: number) => this.deps.chat({
      task: 'summary',
      params: {source_messages: sourceMessages},
      messages: [{role: 'user', content}],
      signal,
      onDelta: stream && onText ? (_delta, whole) => onText(whole) : undefined
    });

    if(parts.length === 1) {
      callbacks.onProgress?.({stage: 'summarizing', part: 1, parts: 1});
      return ask(parts[0], true, this.lines.length);
    }

    // * one after another: the parts are a conversation's, and the quota counts requests
    const summaries: string[] = [];
    for(let i = 0; i < parts.length; ++i) {
      callbacks.onProgress?.({stage: 'summarizing', part: i + 1, parts: parts.length});
      summaries.push(await ask(parts[i], false, (parts[i].match(/^\[#\d+\]/gm) || []).length));
    }

    callbacks.onProgress?.({stage: 'merging'});
    return ask(buildMergeRequest(summaries), true, this.lines.length);
  }

  /** A question about the loaded range: the answer's text, with [#id] references. */
  public ask(question: string, onText?: (text: string) => void): Promise<string> {
    const signal = this.begin();
    return this.deps.chat({
      task: 'chat',
      messages: [{role: 'user', content: buildQuestionRequest(this.lines, question, this.maxChars)}],
      signal,
      onDelta: onText ? (_delta, whole) => onText(whole) : undefined
    });
  }
}
