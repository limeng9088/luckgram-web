// * Luckgram Web (luckgram-specs#189, W9): the chat summary — the transcript, its parts, the references

import {
  CITE_RULE, MAX_LINE_CHARS, MAX_MESSAGES, SummaryLine, buildMergeRequest, buildQuestionRequest, formatLine, formatLineTime, getLineText,
  getRangeLimit, parseBullets, parseSegments, shouldOfferUnreadSummary, splitTranscript
} from '@/luckgram/summary/logic';

const line = (id: number, text: string, sender = 'Anna'): SummaryLine => ({id, sender, time: '10-31 14:05', text});

describe('luckgram summary: what the model is given', () => {
  test('a message is one line: its id, who, when, the text', () => {
    expect(formatLine(line(123, 'first\n  second'))).toBe('[#123] Anna (10-31 14:05): first second');
    const long = formatLine(line(1, 'x'.repeat(5000)));
    expect(long.length).toBe(MAX_LINE_CHARS + 1);
    expect(long.endsWith('…')).toBe(true);
  });

  test('media says what it is, with its caption', () => {
    expect(getLineText('[图片]', 'caption')).toBe('[图片] caption');
    expect(getLineText('[文件]', '', 'report.pdf')).toBe('[文件] report.pdf');
    expect(getLineText(undefined, ' hello ')).toBe('hello');
  });

  test('one part when it fits, with the rule for references', () => {
    const parts = splitTranscript([line(1, 'a'), line(2, 'b')]);
    expect(parts.length).toBe(1);
    expect(parts[0]).toContain(CITE_RULE);
    expect(parts[0].endsWith('[#1] Anna (10-31 14:05): a\n[#2] Anna (10-31 14:05): b')).toBe(true);
    expect(splitTranscript([])).toEqual([]);
  });

  test('a long range is cut at message boundaries, every message in exactly one part', () => {
    const lines = Array.from({length: 300}, (_, i) => line(i + 1, 'word '.repeat(40)));
    const parts = splitTranscript(lines, 5000);
    expect(parts.length).toBeGreaterThan(3);
    for(const part of parts) expect(part.length).toBeLessThanOrEqual(5000);
    const ids = parts.flatMap((part) => [...part.matchAll(/^\[#(\d+)\]/gm)].map((match) => +match[1]));
    expect(ids).toEqual(lines.map((l) => l.id));
  });

  test('the parts\' summaries are merged with their references kept', () => {
    const request = buildMergeRequest(['- a [#1]', '- b [#200]\n']);
    expect(request).toContain('Merge them into 3 to 8 bullet points, keeping the [#ID] citations.');
    expect(request.endsWith('Part 1:\n- a [#1]\n\nPart 2:\n- b [#200]')).toBe(true);
  });

  test('a question carries the latest messages that fit, and asks for references', () => {
    const lines = Array.from({length: 200}, (_, i) => line(i + 1, 'word '.repeat(40)));
    const request = buildQuestionRequest(lines, ' 客户最后答应了什么 ', 3000);
    expect(request.length).toBeLessThanOrEqual(3000);
    expect(request).toContain('[#200] ');
    expect(request).not.toContain('[#1] ');
    expect(request).toContain('\n\nQuestion: 客户最后答应了什么\nAnswer briefly, in the language of the question. ' + CITE_RULE);
  });
});

describe('luckgram summary: the answer', () => {
  const valid = new Set([123, 456, 789]);

  test('references become links to messages; an id that is not in the range is dropped', () => {
    expect(parseSegments('周五交付 [#123, #456]。价格未定 [#999]', valid)).toEqual([
      {text: '周五交付'}, {messageId: 123}, {messageId: 456}, {text: '。价格未定'}
    ]);
    expect(parseSegments('决定了（#789）', valid)).toEqual([{text: '决定了'}, {messageId: 789}]);
    expect(parseSegments('[#123][#123]', valid)).toEqual([{messageId: 123}, {messageId: 123}]);
  });

  test('what is not a reference stays text: a year in brackets, a footnote number that is no id', () => {
    expect(parseSegments('去年 (2024) 的事 [1]', valid)).toEqual([{text: '去年 (2024) 的事 [1]'}]);
    expect(parseSegments('', valid)).toEqual([]);
    expect(parseSegments(undefined, valid)).toEqual([]);
    // * a bare number in square brackets that is one of the ids is a reference
    expect(parseSegments('见 [456]', valid)).toEqual([{text: '见'}, {messageId: 456}]);
  });

  test('the points, without their marks; a line without one continues the point before', () => {
    expect(parseBullets('- one [#1]\n* two\n• three\n1. four\n2) five\n continued\n\n')).toEqual(['one [#1]', 'two', 'three', 'four', 'five continued']);
    expect(parseBullets('no mark at all')).toEqual(['no mark at all']);
    expect(parseBullets(undefined)).toEqual([]);
  });
});

describe('luckgram summary: the range', () => {
  test('offered at the top with 30 unread and more', () => {
    expect(shouldOfferUnreadSummary(29)).toBe(false);
    expect(shouldOfferUnreadSummary(30)).toBe(true);
    expect(shouldOfferUnreadSummary(undefined)).toBe(false);
  });

  test('"未读" is the unread ones, 500 at most; the others say their number', () => {
    expect(getRangeLimit('unread', 128)).toBe(128);
    expect(getRangeLimit('unread', 5000)).toBe(MAX_MESSAGES);
    expect(getRangeLimit('unread', 0)).toBe(1);
    expect(getRangeLimit(300, 128)).toBe(300);
  });

  test('the time of a line', () => {
    const date = new Date(2026, 9, 31, 14, 5).getTime() / 1000;
    expect(formatLineTime(date)).toBe('10-31 14:05');
  });
});

import SummarySession, {EmptyRangeError} from '@/luckgram/summary/session';

describe('luckgram summary: a session', () => {
  const make = (lines: SummaryLine[], maxChars?: number) => {
    const requests: {task: string, content: string, stream: boolean, source: number}[] = [];
    const session = new SummarySession({
      load: async(_range, {onProgress}) => {
        onProgress(lines.length, lines.length);
        return lines;
      },
      chat: async(options) => {
        const content = options.messages[0].content;
        requests.push({task: options.task, content, stream: !!options.onDelta, source: options.params?.source_messages});
        const text = content.startsWith('These are summaries') ? '- merged [#1] [#300]' : '- part about ' + /^\[#(\d+)\]/m.exec(content)[1];
        options.onDelta?.(text, text);
        return text;
      },
      maxChars: maxChars ? () => maxChars : undefined
    });
    return {session, requests};
  };

  test('a range that fits: one request, written as it arrives; references may point to its messages only', async() => {
    const {session, requests} = make([line(1, 'a'), line(2, 'b')]);
    const texts: string[] = [], stages: string[] = [];
    const summary = await session.summarize(100, {onText: (text) => texts.push(text), onProgress: (progress) => stages.push(progress.stage)});
    expect(summary).toBe('- part about 1');
    expect(texts).toEqual(['- part about 1']);
    expect(requests).toMatchObject([{task: 'summary', stream: true, source: 2}]);
    expect(stages).toEqual(['loading', 'loading', 'summarizing']);
    expect([...session.validIds]).toEqual([1, 2]);
  });

  test('a long range: each part summarized, then merged; only the merge is written out', async() => {
    const lines = Array.from({length: 300}, (_, i) => line(i + 1, 'word '.repeat(40)));
    const {session, requests} = make(lines, 5000);
    const texts: string[] = [];
    const progress: any[] = [];
    const summary = await session.summarize(500, {onText: (text) => texts.push(text), onProgress: (p) => progress.push(p)});
    expect(summary).toBe('- merged [#1] [#300]');
    expect(texts).toEqual(['- merged [#1] [#300]']);
    const parts = requests.filter((request) => !request.content.startsWith('These are summaries'));
    expect(parts.length).toBeGreaterThan(3);
    expect(parts.every((request) => request.task === 'summary' && !request.stream)).toBe(true);
    expect(parts.reduce((sum, request) => sum + request.source, 0)).toBe(300);
    expect(requests[requests.length - 1]).toMatchObject({task: 'summary', stream: true, source: 300});
    expect(progress[progress.length - 1]).toEqual({stage: 'merging'});
    expect(progress.filter((p) => p.stage === 'summarizing').map((p) => p.part)).toEqual(parts.map((_, i) => i + 1));
  });

  test('a question goes with the loaded messages, as a chat', async() => {
    const {session, requests} = make([line(1, 'a'), line(2, 'b')]);
    await session.summarize('unread');
    await session.ask('谁答应了什么');
    const last = requests[requests.length - 1];
    expect(last.task).toBe('chat');
    expect(last.content).toContain('[#2] Anna');
    expect(last.content).toContain('Question: 谁答应了什么');
  });

  test('nothing to summarize says so, and asks the server nothing', async() => {
    const {session, requests} = make([]);
    await expect(session.summarize(100)).rejects.toBeInstanceOf(EmptyRangeError);
    expect(requests).toEqual([]);
  });

  test('cancelling stops the request that is under way', async() => {
    let signal: AbortSignal;
    const session = new SummarySession({
      load: async() => [line(1, 'a')],
      chat: (options) => new Promise((_resolve, reject) => {
        signal = options.signal;
        options.signal.addEventListener('abort', () => reject(new Error('cancelled')));
      })
    });
    const pending = session.summarize(100);
    await new Promise((resolve) => setTimeout(resolve, 0));
    session.cancel();
    await expect(pending).rejects.toThrow('cancelled');
    expect(signal.aborted).toBe(true);
  });
});
