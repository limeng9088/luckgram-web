/*
 * Luckgram Web (luckgram-specs#188, W8): the rules of the AI assistant that need no browser —
 * a conversation and its messages, what is sent as context, the quick buttons, how a reply's
 * Markdown is prepared for upstream's message renderer. The rules are the phones'
 * (specs/18-ai-chat.md). No imports.
 */

export const AI_ASSISTANT = 'ai_assistant';
/** LuckgramSettings: the "Luckgram AI" row over the chat list (shown unless set to false) */
export const KEY_PIN = 'ai_assistant_pin';
/** The address of the page: not a user name, not a peer id — upstream's own routing leaves it alone. */
export const AI_HASH = '#/luckgram-ai';

/** How many of the conversation's latest messages go with a request. */
export const CONTEXT_MESSAGES = 20;
export const TITLE_MAX = 40;
/** A conversation list is not a log: the oldest go when an account has this many. */
export const MAX_CONVERSATIONS = 200;

export type AssistantRole = 'user' | 'assistant';

export type AssistantMessage = {
  id: string,
  role: AssistantRole,
  /** 'text', or a type a feature registered (23: an image); an unknown one shows a placeholder */
  type: string,
  text: string,
  at: number,
  /** a LuckgramApiError's code: the bubble shows its text instead */
  error?: string,
  /** still being written, or stopped before its end */
  partial?: boolean,
  /** whatever a registered type keeps */
  data?: any
};

export type Conversation = {
  id: string,
  /** the Telegram user the conversation belongs to */
  account: string,
  title: string,
  createdAt: number,
  updatedAt: number,
  /** conversation properties (extension point): the task and the system instruction every request carries */
  task?: string,
  system?: string,
  /** a feature's own handle to find its conversation again (22: one per agent) */
  key?: string,
  messages: AssistantMessage[]
};

export const conversationKey = (account: number | string, id: string) => `c:${account}:${id}`;
export const accountOfKey = (key: string) => /^c:([^:]+):/.exec(key)?.[1];

let counter = 0;
/** Unique within the browser, sortable by time. */
export function makeId(now: number = Date.now()) {
  return now.toString(36) + '-' + (counter++ % 1296).toString(36).padStart(2, '0') + Math.floor(Math.random() * 46656).toString(36).padStart(3, '0');
}

export function newConversation(account: number | string, now: number, properties: {task?: string, system?: string, key?: string, title?: string} = {}): Conversation {
  return {
    id: makeId(now), account: String(account), title: properties.title || '', createdAt: now, updatedAt: now,
    task: properties.task, system: properties.system, key: properties.key, messages: []
  };
}

/** A conversation is named after what was asked first. */
export function makeTitle(text: string, max = TITLE_MAX): string {
  const line = (text || '').replace(/\s+/g, ' ').trim();
  return line.length > max ? line.slice(0, max - 1).trimEnd() + '…' : line;
}

/**
 * What goes with a request: the system instruction, if the conversation has one, and its latest
 * 20 messages that are plain text and are answers or questions — not errors, not other types.
 */
export function buildContext(conversation: Pick<Conversation, 'system' | 'messages'>, max = CONTEXT_MESSAGES): {role: 'system' | AssistantRole, content: string}[] {
  const messages = conversation.messages
  .filter((message) => message.type === 'text' && !message.error && (message.text || '').trim())
  .slice(-max)
  .map((message) => ({role: message.role, content: message.text}));

  // * the first one is the user's: an answer whose question fell off the window explains nothing
  while(messages.length && messages[0].role !== 'user') messages.shift();
  return conversation.system?.trim() ? [{role: 'system' as const, content: conversation.system.trim()}, ...messages] : messages;
}

/** The newest first. */
export function sortConversations<T extends Pick<Conversation, 'updatedAt'>>(conversations: T[]): T[] {
  return conversations.slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

/** The ids to drop when an account has too many: the oldest, never one with a feature's key. */
export function getConversationsToPrune(conversations: Pick<Conversation, 'id' | 'updatedAt' | 'key'>[], max = MAX_CONVERSATIONS): string[] {
  const plain = sortConversations(conversations.filter((conversation) => !conversation.key));
  return plain.slice(Math.max(0, max - (conversations.length - plain.length))).map((conversation) => conversation.id);
}

/** The stored keys that belong to nobody who is signed in: an account that left elsewhere. */
export function getOrphanKeys(keys: string[], accounts: (number | string)[]): string[] {
  const signedIn = new Set(accounts.map(String));
  return keys.filter((key) => {
    const account = accountOfKey(key);
    return account !== undefined && !signedIn.has(account);
  });
}

// ------------------------------------------------------------------ quick buttons

export type QuickButtonText = {key: string, title: [string, string], prefix: [string, string]};

/** Over the field: a press puts the prefix into it, the cursor after. [中文, English] */
export const QUICK_BUTTONS: QuickButtonText[] = [
  {key: 'summarize', title: ['总结', 'Summarize'], prefix: ['总结下面的内容：\n', 'Summarize the following:\n']},
  {key: 'rewrite', title: ['改写', 'Rewrite'], prefix: ['改写下面的内容，让它更清楚：\n', 'Rewrite the following to make it clearer:\n']},
  {key: 'explain', title: ['讲解', 'Explain'], prefix: ['讲解一下：', 'Explain: ']},
  {key: 'solve', title: ['解题', 'Solve'], prefix: ['一步一步解这道题：\n', 'Solve this step by step:\n']}
];

/** The field after a quick button: its prefix before what was typed, unless it is there already. */
export function applyPrefix(prefix: string, text: string): string {
  return text.startsWith(prefix) ? text : prefix + text;
}

/** The handler of the first registered prefix the text starts with (extension point: 23's "画" and "/image"). */
export function findInterceptor<T extends {prefix: string}>(interceptors: T[], text: string): {interceptor: T, rest: string} | undefined {
  const trimmed = text.trimStart();
  for(const interceptor of interceptors) {
    const prefix = interceptor.prefix;
    if(!prefix || !trimmed.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    const rest = trimmed.slice(prefix.length);
    // * "/image cat" and "/image", not "/imagery": a command ends at a space; a word like "画" needs none
    if(/^[/!]/.test(prefix) && rest && !/^\s/.test(rest)) continue;
    return {interceptor, rest: rest.trim()};
  }
}

// ------------------------------------------------------------------ Markdown, for upstream's message renderer

/**
 * A reply's Markdown made ready for upstream's own message Markdown (bold, italic, code, links,
 * fenced code with its copy button), which knows no headings, lists or tables:
 *   - a heading becomes a bold line;
 *   - a list item keeps its mark as text ("• item", "1. item");
 *   - a table goes into a fence of its own kind (TABLE_LANGUAGE): render.ts draws it as plain lines
 *     in a fixed-width font, which keeps its columns in line — not as a block of code.
 * Code that is already fenced is left as it is.
 */
export function prepareMarkdown(markdown: string): string {
  const lines = (markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let inFence = false;
  let table: string[] = [];

  const flushTable = () => {
    if(!table.length) return;
    // * a real table has its line of dashes; anything else was just text with bars
    if(table.length >= 2 && /^\s*\|?\s*:?-{2,}/.test(table[1])) out.push('```' + TABLE_LANGUAGE, ...alignTable(table), '```');
    else out.push(...table);
    table = [];
  };

  for(const line of lines) {
    if(/^\s*(```|~~~)/.test(line)) {
      flushTable();
      inFence = !inFence;
      out.push(line.replace(/^\s*~~~/, '```'));
      continue;
    }

    if(inFence) {
      out.push(line);
      continue;
    }

    if(/^\s*\|.*\|\s*$/.test(line)) {
      table.push(line.trim());
      continue;
    }

    flushTable();

    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if(heading) {
      out.push('**' + heading[1].replace(/\*\*/g, '') + '**');
      continue;
    }

    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if(bullet) {
      out.push(bullet[1] + '• ' + bullet[2]);
      continue;
    }

    out.push(line);
  }

  flushTable();
  // * a reply cut off inside a fence still shows as code
  if(inFence) out.push('```');
  return out.join('\n');
}

/** The "language" of the fence a table is put in: what tells it from a block of code the model wrote. */
export const TABLE_LANGUAGE = 'lgtable';

/** The table's cells padded to their column's width; the line of dashes is drawn to match. */
export function alignTable(rows: string[]): string[] {
  const cells = rows.map((row) => row.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()));
  const widths: number[] = [];
  const width = (text: string) => [...text].reduce((sum, ch) => sum + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1), 0);
  cells.forEach((row, index) => {
    if(index === 1) return;
    row.forEach((cell, column) => widths[column] = Math.max(widths[column] || 0, width(cell)));
  });

  // * the line of dashes is two at least: so is every column, or the bars would not stand in line
  for(let column = 0; column < widths.length; ++column) widths[column] = Math.max(widths[column] || 0, 2);

  return cells.map((row, index) => widths.map((size, column) => {
    if(index === 1) return '-'.repeat(size);
    const cell = row[column] || '';
    return cell + ' '.repeat(Math.max(0, size - width(cell)));
  }).join(' | ').trimEnd());
}

// ------------------------------------------------------------------ Markdown → text with entities

export type MarkdownEntity = {_: string, offset: number, length: number, language?: string, url?: string};

const INLINE_RULES: {open: string, close: string, type: string}[] = [
  {open: '**', close: '**', type: 'messageEntityBold'},
  {open: '__', close: '__', type: 'messageEntityBold'},
  {open: '~~', close: '~~', type: 'messageEntityStrike'},
  {open: '*', close: '*', type: 'messageEntityItalic'},
  {open: '_', close: '_', type: 'messageEntityItalic'}
];

const isWordChar = (ch: string | undefined) => !!ch && /[A-Za-z0-9]/.test(ch);

/** A line of text: `code`, **bold**, *italic*, ~~strike~~, [text](url), one inside another. */
function parseInline(source: string, base: number): {text: string, entities: MarkdownEntity[]} {
  let text = '';
  const entities: MarkdownEntity[] = [];
  let i = 0;

  outer: while(i < source.length) {
    const ch = source[i];

    // * a backslash keeps the next mark as it is
    if(ch === '\\' && i + 1 < source.length && /[\\`*_~[\]()]/.test(source[i + 1])) {
      text += source[i + 1];
      i += 2;
      continue;
    }

    if(ch === '`') {
      const end = source.indexOf('`', i + 1);
      if(end > i + 1 && !source.slice(i + 1, end).includes('\n')) {
        const code = source.slice(i + 1, end);
        entities.push({_: 'messageEntityCode', offset: base + text.length, length: code.length});
        text += code;
        i = end + 1;
        continue;
      }
    }

    if(ch === '[') {
      const link = /^\[([^\]\n]+)\]\(([^()\s]+)\)/.exec(source.slice(i));
      if(link && /^(https?:\/\/|mailto:|tg:\/\/)/i.test(link[2])) {
        const inner = parseInline(link[1], base + text.length);
        entities.push({_: 'messageEntityTextUrl', offset: base + text.length, length: inner.text.length, url: link[2]}, ...inner.entities);
        text += inner.text;
        i += link[0].length;
        continue;
      }
    }

    for(const rule of INLINE_RULES) {
      if(!source.startsWith(rule.open, i)) continue;
      const start = i + rule.open.length;
      // * a mark opens before something that is not a space; "_" not inside a word (snake_case)
      if(start >= source.length || /\s/.test(source[start])) continue;
      if(rule.open[0] === '_' && isWordChar(source[i - 1])) continue;

      let end = source.indexOf(rule.close, start + 1);
      while(end !== -1) {
        const closesWord = rule.close[0] === '_' && isWordChar(source[end + rule.close.length]);
        // * "*" must not be half of a "**"
        const partOfLonger = rule.close.length === 1 && (source[end + 1] === rule.close || source[end - 1] === rule.close);
        if(!/\s/.test(source[end - 1]) && !closesWord && !partOfLonger && !source.slice(start, end).includes('\n\n')) break;
        end = source.indexOf(rule.close, end + 1);
      }

      if(end === -1) continue;
      const inner = parseInline(source.slice(start, end), base + text.length);
      if(!inner.text) continue;
      entities.push({_: rule.type, offset: base + text.length, length: inner.text.length}, ...inner.entities);
      text += inner.text;
      i = end + rule.close.length;
      continue outer;
    }

    text += ch;
    ++i;
  }

  return {text, entities};
}

/**
 * A reply's Markdown as text with entities, which upstream's message renderer draws: fenced code
 * (with its language), `code`, **bold**, *italic*, ~~strike~~, [links](url). Headings, lists and
 * tables are prepared first (prepareMarkdown). Offsets count UTF-16 units, as Telegram's do.
 */
export function markdownToEntities(markdown: string): {text: string, entities: MarkdownEntity[]} {
  const prepared = prepareMarkdown(markdown);
  let text = '';
  const entities: MarkdownEntity[] = [];
  const fence = /```([^\n`]*)\n([\s\S]*?)\n?```[^\n]*(\n|$)/g;
  let last = 0;
  let match: RegExpExecArray;

  const addInline = (source: string) => {
    const inline = parseInline(source, text.length);
    text += inline.text;
    entities.push(...inline.entities);
  };

  while((match = fence.exec(prepared))) {
    addInline(prepared.slice(last, match.index));
    const code = match[2];
    if(code) {
      // * always a string: upstream's renderer reads the language of every block of code
      const language = match[1].trim().split(/\s+/)[0] || '';
      entities.push({_: 'messageEntityPre', offset: text.length, length: code.length, language});
      text += code + match[3];
    }

    last = fence.lastIndex;
  }

  addInline(prepared.slice(last));
  entities.sort((a, b) => a.offset - b.offset || b.length - a.length);
  return {text: text.replace(/\s+$/, ''), entities};
}
