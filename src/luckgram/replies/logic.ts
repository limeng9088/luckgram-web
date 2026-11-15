/*
 * Luckgram Web (luckgram-specs#190, W11b 需求 7–11; specs/02-quick-replies.md): the rules of
 * quick replies — templates kept on this device, put into the message field with one press.
 * They are not Telegram Business's "快速回复" and never touch it. No app imports.
 */

import {countCharacters, splitCharacters} from '@/luckgram/notes/logic';

export const QUICK_REPLIES = 'quick_replies';
export const MAX_REPLIES = 100;
export const MAX_REPLY_LENGTH = 1000;
/** how many the list and the suggestions show before they scroll */
export const VISIBLE_REPLIES = 8;

export type QuickReply = {id: string, text: string};

/** What an account has: its templates in their order; `seeded` once the examples were given. */
export type RepliesState = {items: QuickReply[], seeded?: boolean};

/** [中文, English] of the four examples a first use starts with. */
export const PRESETS: [string, string][] = [
  ['在路上了！', 'On my way!'],
  ['10 分钟后给你回电话可以吗？', 'Can I call you back in 10 minutes?'],
  ['谢谢，收到。', 'Thanks, got it.'],
  ['抱歉，要晚 5 分钟！', 'Sorry, running 5 minutes late!']
];

export const repliesKey = (account: number | string) => `r:${account}`;
export const accountOfRepliesKey = (key: string) => key.split(':')[1];

/** A template's text as kept: trimmed, line ends plain. Empty is no template. */
export function normalizeReply(text: string | undefined): string {
  return (text || '').replace(/\r\n?/g, '\n').trim();
}

export type ReplyError = 'empty' | 'too_long' | 'limit' | 'duplicate';

/** Why a text cannot be a template, or nothing. `existing`: the others (when editing, without the one edited). */
export function checkReply(text: string | undefined, existing: QuickReply[], adding: boolean): ReplyError | undefined {
  const value = normalizeReply(text);
  if(!value) return 'empty';
  if(countCharacters(value) > MAX_REPLY_LENGTH) return 'too_long';
  if(adding && existing.length >= MAX_REPLIES) return 'limit';
  if(existing.some((item) => item.text === value)) return 'duplicate';
}

/** [中文, English] */
export function getReplyErrorText(error: ReplyError): [string, string] {
  switch(error) {
    case 'empty': return ['请输入内容', 'Type something'];
    case 'too_long': return [`每条最多 ${MAX_REPLY_LENGTH} 字`, `${MAX_REPLY_LENGTH} characters at most`];
    case 'limit': return [`最多 ${MAX_REPLIES} 条快捷回复`, `${MAX_REPLIES} quick replies at most`];
    case 'duplicate': return ['已经有一条相同的了', 'There is one like this already'];
  }
}

/** The state a first use starts with: the examples, once. */
export function seedReplies(state: RepliesState | undefined, chinese: boolean, makeId: () => string): RepliesState {
  if(state?.seeded) return state;
  const items = state?.items?.length ? state.items : PRESETS.map((texts) => ({id: makeId(), text: texts[chinese ? 0 : 1]}));
  return {items, seeded: true};
}

export function addReply(state: RepliesState, text: string, makeId: () => string): RepliesState {
  if(checkReply(text, state.items, true)) return state;
  return {...state, items: [...state.items, {id: makeId(), text: normalizeReply(text)}]};
}

export function editReply(state: RepliesState, id: string, text: string): RepliesState {
  const others = state.items.filter((item) => item.id !== id);
  if(others.length === state.items.length || checkReply(text, others, false)) return state;
  return {...state, items: state.items.map((item) => item.id === id ? {id, text: normalizeReply(text)} : item)};
}

export function removeReply(state: RepliesState, id: string): RepliesState {
  return {...state, items: state.items.filter((item) => item.id !== id)};
}

/** Moves a template to `index` (of the list without it). */
export function moveReply(state: RepliesState, id: string, index: number): RepliesState {
  const from = state.items.findIndex((item) => item.id === id);
  if(from === -1) return state;
  const items = state.items.slice();
  const [item] = items.splice(from, 1);
  items.splice(Math.max(0, Math.min(index, items.length)), 0, item);
  return {...state, items};
}

/** The order after a drag: the ids as they now stand; ids unknown are left out, ones missing stay at the end. */
export function reorderReplies(state: RepliesState, ids: string[]): RepliesState {
  const byId = new Map(state.items.map((item) => [item.id, item]));
  const items: QuickReply[] = [];
  for(const id of ids) {
    const item = byId.get(id);
    if(item) {
      items.push(item);
      byId.delete(id);
    }
  }

  return {...state, items: [...items, ...byId.values()]};
}

/**
 * The templates a "/…" typed at the field's start asks for: those that begin with what follows
 * the slash, letter case aside; all of them for a slash alone. Nothing when the field holds
 * anything else (a line break, a space before the slash).
 */
export function matchSlash(value: string, items: QuickReply[]): QuickReply[] | undefined {
  if(!value.startsWith('/') || value.includes('\n')) return;
  const query = value.slice(1).toLowerCase();
  const found = query ? items.filter((item) => item.text.toLowerCase().startsWith(query)) : items;
  return found.length ? found : undefined;
}

/** One line for a list: the text's line breaks as spaces, cut with "…". */
export function getReplyPreview(text: string, max = 80): string {
  const line = text.replace(/\s+/g, ' ').trim();
  const characters = splitCharacters(line);
  return characters.length > max ? characters.slice(0, max).join('') + '…' : line;
}

/** Whether what a stored value holds is an account's templates; what is not is dropped piece by piece. */
export function sanitizeState(value: any): RepliesState | undefined {
  if(!value || !Array.isArray(value.items)) return;
  const seen = new Set<string>();
  const items: QuickReply[] = [];
  for(const item of value.items) {
    const text = normalizeReply(item?.text);
    if(typeof item?.id !== 'string' || !text || seen.has(item.id) || items.length >= MAX_REPLIES) continue;
    seen.add(item.id);
    items.push({id: item.id, text: countCharacters(text) > MAX_REPLY_LENGTH ? splitCharacters(text).slice(0, MAX_REPLY_LENGTH).join('') : text});
  }

  return {items, seeded: !!value.seeded};
}
