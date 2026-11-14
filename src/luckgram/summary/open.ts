/*
 * Luckgram Web (luckgram-specs#189, W9): one chat's summary put together — the messages from
 * Telegram (telegram.ts), the AI (the Luckgram server), the card. Loaded when a summary is asked
 * for, not with the chat.
 */

import type Chat from '@components/chat/chat';
import luckgramAI from '@/luckgram/core/instance';
import {remoteNumber} from '@/luckgram/core/remoteConfig';
import SummaryCard from '@/luckgram/summary/card';
import {DEFAULT_MAX_INPUT_CHARS, KEY_MAX_INPUT_CHARS} from '@/luckgram/summary/logic';
import SummarySession from '@/luckgram/summary/session';
import {UnreadSnapshot, loadSummaryLines} from '@/luckgram/summary/telegram';

export function createSummaryCard(chat: Chat, unread: UnreadSnapshot | undefined, onClose: () => void) {
  const session = new SummarySession({
    load: (range, options) => loadSummaryLines(chat, range, unread, options),
    chat: (options) => luckgramAI.chat(options),
    maxChars: () => remoteNumber(KEY_MAX_INPUT_CHARS, DEFAULT_MAX_INPUT_CHARS)
  });

  const card: SummaryCard = new SummaryCard({
    session,
    unreadCount: unread?.count,
    onJump: (messageId) => {
      // * out of the message's way: it is shown in the middle, where the card is
      card.fold();
      chat.setMessageId({lastMsgId: messageId});
    },
    onClose
  });

  return card;
}
