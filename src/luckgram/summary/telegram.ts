/*
 * Luckgram Web (luckgram-specs#189, W9 需求 2): the range's messages, read from the chat — what
 * the app has already, and Telegram's history page by page for the rest (`messages.getHistory`,
 * through upstream's own manager: the pages land in its cache as scrolling up would put them).
 * Each message becomes one line for the model: who, when, its id, its text or what it is.
 */

import type Chat from '@components/chat/chat';
import type {Message} from '@layer';
import getPeerTitle from '@components/wrappers/getPeerTitle';
import {lgText} from '@/luckgram/text';
import {
  MEDIA_PLACEHOLDERS, SummaryLine, SummaryRange, UnreadSnapshot, formatLineTime, getLineText, getRangeLimit
} from '@/luckgram/summary/logic';

export type {UnreadSnapshot};

const PAGE = 100;

/** What a message is when it is not (only) text, and what there is to say of it. */
export function describeMedia(message: Message.message): {kind?: string, extra?: string} {
  const media: any = message.media;
  if(!media) return {};
  switch(media._) {
    case 'messageMediaPhoto':
      return {kind: 'photo'};
    case 'messageMediaDocument': {
      const doc = media.document;
      const type: string = doc?.type;
      if(type === 'video' || type === 'round' || type === 'voice' || type === 'audio' || type === 'gif' || type === 'sticker') {
        return {kind: type, extra: type === 'audio' ? doc.file_name : undefined};
      }

      return {kind: 'file', extra: doc?.file_name};
    }
    case 'messageMediaPoll':
      return {kind: 'poll', extra: media.poll?.question?.text};
    case 'messageMediaGeo':
    case 'messageMediaGeoLive':
      return {kind: 'location'};
    case 'messageMediaVenue':
      return {kind: 'location', extra: media.title};
    case 'messageMediaContact':
      return {kind: 'contact', extra: [media.first_name, media.last_name].filter(Boolean).join(' ')};
    case 'messageMediaWebPage':
    case 'messageMediaEmpty':
      return {};
    default:
      return {kind: 'other'};
  }
}

/** The message's line without its sender, or nothing when there is nothing to tell of it. */
export function getMessageText(message: Message.message): string {
  const {kind, extra} = describeMedia(message);
  const placeholder = kind ? lgText(...(MEDIA_PLACEHOLDERS[kind] || MEDIA_PLACEHOLDERS.other)) : undefined;
  return getLineText(placeholder, message.message, extra);
}

const aborted = () => new DOMException('Aborted', 'AbortError');

export async function loadSummaryLines(
  chat: Chat,
  range: SummaryRange,
  unread: UnreadSnapshot | undefined,
  options: {signal: AbortSignal, onProgress: (loaded: number, total: number) => void}
): Promise<SummaryLine[]> {
  const {peerId, threadId, monoforumThreadId, managers} = chat;
  const limit = getRangeLimit(range, unread?.count);
  const minId = range === 'unread' ? unread?.readMaxId : undefined;

  // * the newest first, as the history comes
  const mids: number[] = [];
  let offsetId = 0, end = false;
  while(mids.length < limit && !end) {
    const result = await managers.appMessagesManager.getHistory({
      peerId,
      threadId,
      monoforumThreadId,
      offsetId,
      limit: Math.min(PAGE, limit - mids.length)
    });
    if(options.signal.aborted) throw aborted();

    const page = result?.history || [];
    for(const mid of page) {
      if(minId && mid <= minId) {
        end = true;
        break;
      }

      if(mids.length < limit) mids.push(mid);
    }

    if(!page.length || result.isEnd?.top) end = true;
    else offsetId = page[page.length - 1];
    options.onProgress(mids.length, limit);
  }

  const names = new Map<string, string>();
  const getName = async(peer: PeerId) => {
    const key = String(peer);
    if(!names.has(key)) {
      names.set(key, await Promise.resolve(getPeerTitle({peerId: peer, plainText: true}) as any as Promise<string>).catch((): string => undefined) || key);
    }

    return names.get(key);
  };

  const me = lgText('我', 'Me');
  const lines: SummaryLine[] = [];
  let lastGroup: string;
  for(const mid of mids.reverse()) {
    let message = chat.getMessageByPeer(peerId, mid) as Message.message;
    if(!message) {
      message = await managers.appMessagesManager.getMessageByPeer(peerId, mid) as Message.message;
      if(options.signal.aborted) throw aborted();
    }

    if(message?._ !== 'message') continue;

    // * an album is one thing sent: its photos after the first say nothing more, unless one has the caption
    const group = message.grouped_id as any as string;
    const repeated = group && group === lastGroup && !message.message;
    lastGroup = group;
    if(repeated) continue;

    const text = getMessageText(message);
    if(!text) continue;

    const sender = message.pFlags?.out && !chat.isBroadcast ? me : await getName((message.fromId ?? message.peerId) as PeerId);
    if(options.signal.aborted) throw aborted();
    lines.push({id: mid, sender, time: formatLineTime(message.date), text});
  }

  return lines;
}
