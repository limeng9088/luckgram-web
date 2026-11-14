/*
 * Luckgram Web (luckgram-specs#187, W7): the rules of AI writing and AI reply that need no
 * browser — the effects, what is sent for a reply, the candidates in a stream, the menu's order.
 * The rules are the phones' (specs/21-ai-writing.md, specs/20-ai-reply.md). No imports.
 */

export const AI_WRITING = 'ai_writing';
export const AI_REPLY = 'ai_reply';

/** Longer than this is not sent ("这段文字太长"). */
export const MAX_WRITING_CHARS = 4000;
export const REPLY_MESSAGES = 20;
export const REPLY_CANDIDATES = 3;

export type WritingEffect = 'polish' | 'formal' | 'friendly' | 'shorter' | 'grammar';

/** In the menu's order. `done`: the bar's words once the field has the result. [中文, English] */
/** `icon`: a name of upstream's icon font — every item of the menu has one, so their texts line up. */
export const WRITING_EFFECTS: {effect: WritingEffect, icon: string, title: [string, string], done: [string, string]}[] = [
  {effect: 'polish', icon: 'edit_stars', title: ['润色', 'Polish'], done: ['已润色', 'Polished']},
  {effect: 'formal', icon: 'ai_style_tone', title: ['更正式', 'More formal'], done: ['已改得更正式', 'Made more formal']},
  {effect: 'friendly', icon: 'smile', title: ['更友好', 'Friendlier'], done: ['已改得更友好', 'Made friendlier']},
  {effect: 'shorter', icon: 'collapse', title: ['更简短', 'Shorter'], done: ['已改得更简短', 'Made shorter']},
  {effect: 'grammar', icon: 'check', title: ['修正语法', 'Fix grammar'], done: ['已修正语法', 'Grammar fixed']}
];

/** The order of the built-in items; an item registered from outside picks its own (smaller first). */
export const ORDER_REPLY = 0;
export const ORDER_EFFECTS = 100;
export const ORDER_TRANSLATE = 200;

export function isTooLong(text: string, max = MAX_WRITING_CHARS) {
  return (text || '').length > max;
}

// ------------------------------------------------------------------ the menu

export type MenuItemLike<Host> = {
  key: string,
  order: number,
  /** offered with an empty field too (AI reply) */
  allowEmpty?: boolean,
  /** offered when the field holds a rich message — a table, a formula (AI reply) */
  allowRich?: boolean,
  visible?: (host: Host) => boolean
};

/** The items to show, in order: by what the field holds and what each item says of the chat. */
export function getMenuItems<Host, Item extends MenuItemLike<Host>>(items: Item[], state: {empty: boolean, rich: boolean}, host: Host): Item[] {
  return items
  .filter((item) => (!state.empty || item.allowEmpty) && (!state.rich || item.allowRich))
  .filter((item) => {
    try {
      return item.visible ? !!item.visible(host) : true;
    } catch(err) {
      return false;
    }
  })
  .map((item, index) => [item, index] as const)
  .sort((a, b) => a[0].order - b[0].order || a[1] - b[1])
  .map(([item]) => item);
}

// ------------------------------------------------------------------ AI reply

export type ReplyLine = {out: boolean, name?: string, text: string};

/** "Me: …" / "Anna: …", the oldest first, the last 20 with text. */
export function buildTranscript(lines: ReplyLine[], me = 'Me', max = REPLY_MESSAGES): string {
  return lines
  .filter((line) => (line.text || '').trim())
  .slice(-max)
  .map((line) => `${line.out ? me : (line.name || 'Them').replace(/[\r\n:]+/g, ' ').trim() || 'Them'}: ${line.text.trim().replace(/\s*\n\s*/g, ' ')}`)
  .join('\n');
}

/** What is sent as the user's message of `task=reply`: the phones' wording (AiReplyText.java). */
export function buildReplyPrompt(transcript: string, draft: string | undefined, me = 'Me'): string {
  let prompt = `Recent messages (oldest first; "${me}" is me):\n` + (transcript || '(none)');
  if(draft && draft.trim()) prompt += '\n\nMy draft: ' + draft.trim();
  else prompt += '\n\nI have no draft; suggest what I could reply.';
  return prompt;
}

/** The candidates in a stream: the complete lines and the one being written, at most three. */
export function parseCandidates(text: string | undefined, max = REPLY_CANDIDATES): string[] {
  const out: string[] = [];
  for(const raw of (text || '').split('\n')) {
    let line = raw.trim().replace(/^(\d[.)、]|[-•*])\s*/, '');
    if(line.length >= 2 && ((line.startsWith('"') && line.endsWith('"')) || (line.startsWith('“') && line.endsWith('”')))) {
      line = line.slice(1, -1).trim();
    }

    if(line) out.push(line);
    if(out.length === max) break;
  }

  return out;
}

/** The three tones the server writes, in its order. [中文, English] */
export const REPLY_TONES: [string, string][] = [['简短', 'Short'], ['礼貌', 'Polite'], ['轻松', 'Casual']];
