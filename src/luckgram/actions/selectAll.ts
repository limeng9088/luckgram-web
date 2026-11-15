/*
 * Luckgram Web (luckgram-specs#190, W11a 需求 4、5; specs/14-select-all.md): "全选 … 的消息" —
 * upstream's own multi-select entered, and filled with every message of one sender in this chat as
 * they are read from the server, page by page (`messages.search` by `from_id`, through upstream's
 * manager; in a private chat and in Saved Messages the history itself, filtered here). The line at the page's foot counts them and can cancel: the selection goes with it.
 */

import type Chat from '@components/chat/chat';
import type {Message} from '@layer';
import getPeerTitle from '@components/wrappers/getPeerTitle';
import rootScope from '@lib/rootScope';
import {lgText} from '@/luckgram/text';
import {BATCH_SIZE, collectSenderMessages, getSelectAllText, mergeTexts} from '@/luckgram/actions/logic';
import {installBatchDemo, openProgressLine} from '@/luckgram/actions/progress';

/** Whose the message is, for the selection: in Saved Messages everything is one's own. */
export function getSenderId(chat: Chat, message: Message.message): PeerId {
  if(chat.peerId === rootScope.myId) return rootScope.myId;
  return (message.fromId ?? message.peerId) as PeerId;
}

export async function getSelectAllLabel(chat: Chat, message: Message.message): Promise<string> {
  const senderId = getSenderId(chat, message);
  const isOwn = senderId === rootScope.myId || (!!message.pFlags?.out && chat.peerId.isUser());
  const isPrivate = chat.peerId.isUser();
  let name: string;
  if(!isOwn && !isPrivate) {
    name = await Promise.resolve(getPeerTitle({peerId: senderId, plainText: true, onlyFirstName: true}) as any as Promise<string>).catch((): string => undefined);
  }

  return lgText(...getSelectAllText({isOwn, isPrivate, name}));
}

let reading: {abort: () => void};

// * `lgBatchDemo()` is there as soon as the chat's menu is (this module comes with it)
if(typeof window !== 'undefined') installBatchDemo();

export async function selectAllFromSender(chat: Chat, message: Message.message) {
  reading?.abort();

  const {peerId, threadId, monoforumThreadId, managers, selection} = chat;
  const senderId = getSenderId(chat, message);
  const signal = {aborted: false};
  const line = openProgressLine();

  // * the selection left by other means (its count pressed, Esc, another chat): the reading stops too
  const onToggle = (isSelecting: boolean) => {
    if(!isSelecting) stop(false);
  };

  const stop = (cancelSelection: boolean) => {
    if(signal.aborted) return;
    signal.aborted = true;
    selection.removeEventListener('toggle', onToggle);
    if(reading === mine) reading = undefined;
    line.close();
    if(cancelSelection) selection.cancelSelection();
  };

  const mine = reading = {abort: () => stop(false)};
  const show = (total: number) => line.set(
    lgText(`已选 ${total} 条 · 正在加载…`, `${total} selected · Loading…`),
    [{text: lgText('取消', 'Cancel'), onClick: () => stop(true)}]
  );

  // * the message itself first: the mode is entered at once
  selection.luckgramSelectMids(peerId, [message.mid], true);
  selection.addEventListener('toggle', onToggle);
  show(1);

  try {
    const result = await collectSenderMessages({
      signal,
      loadPage: async(offsetId) => {
        // * a private chat (Saved Messages is one): the search by sender finds nothing there, so the
        // * history itself is read and the sender's are picked out of each page
        if(peerId.isUser()) {
          const page = await managers.appMessagesManager.getHistory({peerId, threadId, offsetId, limit: BATCH_SIZE});
          const raw = page?.history || [];
          const messages = await Promise.all(raw.map((mid) => managers.appMessagesManager.getMessageByPeer(peerId, mid)));
          const isSaved = peerId === rootScope.myId, wantOut = senderId === rootScope.myId;
          const mids = raw.filter((_mid, index) => {
            const item = messages[index] as Message.message;
            return item?._ === 'message' && (isSaved || !!item.pFlags?.out === wantOut);
          });
          return {mids, end: !raw.length || !!page.isEnd?.top, next: raw.length ? Math.min(...raw) : undefined};
        }

        const page = await managers.appMessagesManager.getHistory({
          peerId,
          threadId,
          monoforumThreadId,
          fromPeerId: senderId,
          inputFilter: {_: 'inputMessagesFilterEmpty'},
          offsetId,
          limit: BATCH_SIZE
        });
        const mids = page?.history || [];
        return {mids, end: !mids.length || !!page.isEnd?.top};
      },
      onPage: (mids) => {
        if(signal.aborted) return;
        selection.luckgramSelectMids(peerId, mids, true);
        show(selection.length());
      }
    });

    if(result.cancelled || signal.aborted) return;
    signal.aborted = true;
    selection.removeEventListener('toggle', onToggle);
    if(reading === mine) reading = undefined;
    const total = selection.length();
    line.set(lgText(`已选 ${total} 条`, `${total} selected`));
    line.close(2500);
  } catch(err) {
    if(signal.aborted) return;
    signal.aborted = true;
    selection.removeEventListener('toggle', onToggle);
    if(reading === mine) reading = undefined;
    // * what was read stays selected: it is still of use
    line.set(lgText(`加载失败，已选 ${selection.length()} 条`, `Loading failed; ${selection.length()} selected`));
    line.close(4000);
  }
}

/** The selection's texts for "复制所选": the oldest first, an empty line between, nothing else. */
export async function getSelectionText(chat: Chat): Promise<{text: string, count: number}> {
  const messages = await chat.selection.getSelectedMessages() as Message.message[];
  return mergeTexts(messages.map((message) => message && ({mid: message.mid, date: message.date, text: message.message})));
}
