/*
 * Luckgram Web (luckgram-specs#189, W9): the rules of the chat summary that need no browser —
 * the transcript the model sees, how a long range is cut into parts, the [#123] references of an
 * answer. The same rules as on the phones (ChatSummaryLogic.java / LuckgramChatSummaryLogic). No imports.
 */

export const AI_SUMMARY = 'ai_summary';
/** With this many unread messages a chat offers the summary at its top. */
export const UNREAD_THRESHOLD = 30;
export const RANGES = [100, 300, 500] as const;
export type SummaryRange = 'unread' | typeof RANGES[number];
/** The most a range can be: "未读" of a chat left for months is still the latest 500. */
export const MAX_MESSAGES = 500;
/** A line longer than this is cut, so that one long message cannot take a whole part. */
export const MAX_LINE_CHARS = 2000;
/** remote config: how long a request's text may be (the server's default) */
export const KEY_MAX_INPUT_CHARS = 'ai.max_input_chars';
export const DEFAULT_MAX_INPUT_CHARS = 60000;

/** One chat message as the model sees it. */
export type SummaryLine = {
  id: number,
  sender: string,
  /** "10-31 14:05" */
  time: string,
  /** the text, or a media placeholder with its caption: "[图片] caption" */
  text: string
};

/** How references must look; added to every request (the server's prompt does not ask for them). */
export const CITE_RULE = 'After each point, cite the IDs of the messages it is based on. Write every ID on its own in square brackets with a hash, exactly like [#123]; ' +
  'for several messages write them one after another, like [#123][#456]. Never put two IDs into one pair of brackets, and never use other brackets. ' +
  'Use only IDs that appear in the messages.';

export function formatLine(line: SummaryLine): string {
  let text = `[#${line.id}] ${line.sender} (${line.time}): ${(line.text || '').replace(/\s*\n\s*/g, ' ').trim()}`;
  if(text.length > MAX_LINE_CHARS) text = text.slice(0, MAX_LINE_CHARS) + '…';
  return text;
}

export function getHeader(merge: boolean): string {
  if(merge) {
    return 'These are summaries of consecutive parts of one chat. Merge them into 3 to 8 bullet points, keeping the [#ID] citations.\n' + CITE_RULE + '\n\n';
  }

  return 'Summarize these chat messages.\n' + CITE_RULE + '\n\nMessages (oldest first):\n';
}

/**
 * The lines (the oldest first) as transcripts of `maxChars` characters each at most, the header
 * included. At least one part when there are lines.
 */
export function splitTranscript(lines: SummaryLine[], maxChars = DEFAULT_MAX_INPUT_CHARS): string[] {
  const header = getHeader(false);
  const budget = Math.max(1000, maxChars - header.length - 200);
  const parts: string[] = [];
  let current = '';
  for(const line of lines) {
    const text = formatLine(line);
    if(current && current.length + text.length + 1 > budget) {
      parts.push(header + current);
      current = '';
    }

    current += (current ? '\n' : '') + text;
  }

  if(current) parts.push(header + current);
  return parts;
}

/** What is sent to merge the parts' summaries into one. */
export function buildMergeRequest(summaries: string[]): string {
  return getHeader(true) + summaries.map((summary, index) => `Part ${index + 1}:\n${summary.trim()}`).join('\n\n');
}

/**
 * A question about the range (`task=chat`): the latest messages that fit, then the question.
 * The phones' wording (ChatSummaryController.ask).
 */
export function buildQuestionRequest(lines: SummaryLine[], question: string, maxChars = DEFAULT_MAX_INPUT_CHARS): string {
  const head = 'Chat messages (oldest first):\n';
  const tail = '\n\nQuestion: ' + question.trim() + '\nAnswer briefly, in the language of the question. ' + CITE_RULE;
  const budget = Math.max(1000, maxChars - head.length - tail.length - 200);
  const picked: string[] = [];
  let length = 0;
  // * from the newest back, as many as fit
  for(let i = lines.length - 1; i >= 0; --i) {
    const text = formatLine(lines[i]);
    if(picked.length && length + text.length + 1 > budget) break;
    picked.unshift(text);
    length += text.length + 1;
  }

  return head + picked.join('\n') + tail;
}

// ------------------------------------------------------------------ the answer

/** A piece of an answer: plain text, or a reference to a message. */
export type SummarySegment = {text: string} | {messageId: number};

// * what a model writes for references, however it was asked: one id or several in a pair of brackets
// * — square, round, lenticular 【】, tortoise-shell 〔〕, half or full width — with or without "#",
// * the ids apart by commas (, ， 、 ; ；) or spaces
const CITATION = /[[［【〔（(]\s*[#＃]?\d+(?:(?:\s*[,，、;；]\s*|\s+)[#＃]?\d+)*\s*[\]］】〕）)]/g;
const SQUARE_OPENING = /^[[［【〔]/;

/**
 * The text cut into plain text and references. A reference to an id that is not in the range is
 * dropped: the client checks that the model did not make it up (需求 3).
 */
export function parseSegments(text: string | undefined, validIds: {has: (id: number) => boolean}): SummarySegment[] {
  const out: SummarySegment[] = [];
  if(!text) return out;

  let last = 0;
  CITATION.lastIndex = 0;
  let match: RegExpExecArray;
  while((match = CITATION.exec(text))) {
    const token = match[0];
    const hasHash = /[#＃]/.test(token);
    // * "(2024)" in a sentence is not a reference
    if(!hasHash && !SQUARE_OPENING.test(token)) continue;

    const ids = [...new Set((token.match(/\d+/g) || []).map(Number))].filter((id) => validIds.has(id));
    // * "[1]" that is none of the ids: left as text
    if(!ids.length && !hasHash) continue;

    const before = text.slice(last, match.index).replace(/ +$/, '');
    if(before) out.push({text: before});
    for(const id of ids) out.push({messageId: id});
    last = match.index + token.length;
  }

  if(last < text.length) out.push({text: text.slice(last)});
  return out;
}

/** A reference's place in a text that goes through the Markdown renderer: characters no text has, the id between them. */
export const REFERENCE_MARK = /\uE000(\d+)\uE001/g;

/** The text with each reference as a mark (REFERENCE_MARK) the renderer leaves alone, to be drawn as a button after it. */
export function markReferences(text: string | undefined, validIds: {has: (id: number) => boolean}): string {
  return parseSegments(text, validIds).map((segment) => 'text' in segment ? segment.text : `\uE000${segment.messageId}\uE001`).join('');
}

/** The points of a summary, without their "- " / "• " / "1. " marks; a line without one continues the point before. */
export function parseBullets(text: string | undefined): string[] {
  const out: string[] = [];
  for(const raw of (text || '').split('\n')) {
    let line = raw.trim();
    if(!line) continue;
    if(/^[-*•]\s+/.test(line)) {
      line = line.replace(/^[-*•]\s+/, '').trim();
    } else if(/^\d{1,2}[.)、]\s*/.test(line)) {
      line = line.replace(/^\d{1,2}[.)、]\s*/, '');
    } else if(out.length) {
      out[out.length - 1] += ' ' + line;
      continue;
    }

    if(line) out.push(line);
  }

  return out;
}

// ------------------------------------------------------------------ the range

/** Whether the chat offers the summary at its top: enough was unread when it was opened. */
export function shouldOfferUnreadSummary(unreadCount: number | undefined, threshold = UNREAD_THRESHOLD) {
  return unreadCount >= threshold;
}

/** What was unread as the chat was opened: Telegram marks messages read while they are looked at. */
export type UnreadSnapshot = {count: number, readMaxId?: number};

/** The snapshot of a chat's (or a topic's) dialog as upstream keeps it; nothing without one. */
export function takeUnreadSnapshot(dialog: {unread_count?: number, read_inbox_max_id?: number} | undefined): UnreadSnapshot | undefined {
  if(!dialog) return;
  return {count: Math.max(0, dialog.unread_count || 0), readMaxId: dialog.read_inbox_max_id || undefined};
}

/**
 * Whether the bar "N 条未读消息 · 总结聊天" stands at the chat's top: the feature is on, the chat
 * is one the summary is for, it is not Saved Messages, and enough was unread as it was opened.
 */
export function shouldShowUnreadBar(state: {enabled: boolean, canOpen: boolean, isSaved: boolean, snapshot: UnreadSnapshot | undefined}) {
  return state.enabled && state.canOpen && !state.isSaved && !!state.snapshot && shouldOfferUnreadSummary(state.snapshot.count);
}

/** How many messages a range asks for. */
export function getRangeLimit(range: SummaryRange, unreadCount: number | undefined): number {
  if(range === 'unread') return Math.max(1, Math.min(unreadCount || 0, MAX_MESSAGES));
  return range;
}

/** "10-31 14:05" in the browser's own time zone. `date`: seconds, as Telegram's. */
export function formatLineTime(date: number): string {
  const d = new Date(date * 1000);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** [中文, English] of what a message is when it has no text of its own. */
export const MEDIA_PLACEHOLDERS: {[kind: string]: [string, string]} = {
  photo: ['[图片]', '[Photo]'],
  video: ['[视频]', '[Video]'],
  round: ['[视频消息]', '[Video message]'],
  voice: ['[语音]', '[Voice message]'],
  audio: ['[音频]', '[Audio]'],
  gif: ['[动图]', '[GIF]'],
  sticker: ['[贴纸]', '[Sticker]'],
  file: ['[文件]', '[File]'],
  poll: ['[投票]', '[Poll]'],
  location: ['[位置]', '[Location]'],
  contact: ['[联系人]', '[Contact]'],
  other: ['[媒体]', '[Media]']
};

/** The line's text: the placeholder of its media, then its caption or text. */
export function getLineText(placeholder: string | undefined, text: string | undefined, extra?: string): string {
  return [placeholder, extra, (text || '').trim()].filter(Boolean).join(' ');
}
