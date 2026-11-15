/*
 * Luckgram Web (luckgram-specs#189, W9 需求 1): the chat's ways into its summary.
 *
 *   - the bar "128 条未读消息 · 总结聊天": one of upstream's bars at the chat's top (under the
 *     pinned message's; upstream counts its height and moves the messages). Shown when 30 or more
 *     were unread as the chat was opened — a snapshot: Telegram marks them read while they are
 *     looked at — until it is pressed, closed, or the chat is left. Not in Saved Messages.
 *   - `open()`: for "⋮ → 总结聊天"; the card asks for the range.
 *
 * The card (card.ts) and what it needs are loaded when first asked for.
 */

import {createSignal, Show} from 'solid-js';
import type Chat from '@components/chat/chat';
import {ChatType} from '@components/chat/chatType';
import type ChatTopbar from '@components/chat/topbar';
import TopbarPlate, {createTopbarPlate, TopbarPlateController} from '@components/chat/topbarPlate';
import {AppManagers} from '@lib/managers';
import rootScope from '@lib/rootScope';
import {isFeatureEnabled} from '@/luckgram/core/features';
import {watchFeatures} from '@/luckgram/core/hooks';
import {lgText} from '@/luckgram/text';
import {AI_SUMMARY, UnreadSnapshot, shouldShowUnreadBar, takeUnreadSnapshot} from '@/luckgram/summary/logic';
import type SummaryCard from '@/luckgram/summary/card';

export type LuckgramSummaryPlate = TopbarPlateController & {
  setPeerId: (peerId: PeerId) => void,
  /** whether "总结聊天" belongs in this chat's menu */
  canOpen: () => boolean,
  /** the card, asking for the range */
  open: () => void
};

export default function createLuckgramSummaryPlate(
  topbar: ChatTopbar,
  chat: Chat,
  managers: AppManagers
): LuckgramSummaryPlate {
  const [unread, setUnread] = createSignal<UnreadSnapshot>();
  let card: SummaryCard;
  let token = 0;
  let setPlateHidden: (hidden: boolean) => void;

  // * the chat itself: not its scheduled or pinned messages, not a search's results
  const canOpen = () => isFeatureEnabled(AI_SUMMARY) && chat.type === ChatType.Chat && !chat.isPreview && !!chat.peerId;

  const closeCard = () => {
    const closing = card;
    card = undefined;
    closing?.close();
  };

  const openCard = async(fromBar: boolean) => {
    if(!canOpen()) return;
    const mine = token;
    const snapshot = unread();
    setPlateHidden(true);
    if(card) {
      card.unfold();
      if(fromBar) card.summarize('unread');
      return;
    }

    const {createSummaryCard} = await import('@/luckgram/summary/open');
    if(mine !== token || card) return;
    const created = card = createSummaryCard(chat, snapshot, () => {
      if(card === created) card = undefined;
    });
    chat.container.append(created.element);
    if(fromBar) created.summarize('unread');
    else created.showRanges();
  };

  const plate = createTopbarPlate({
    modifier: 'luckgram-summary',
    height: 48,
    onVisibilityChange: () => topbar.setFloating(),
    render: ({setHidden}) => {
      setPlateHidden = setHidden;
      return (
        <Show when={unread()}>
          <TopbarPlate.PrimaryButton onClick={() => openCard(true)}>
            {lgText(`${unread().count} 条未读消息 · 总结聊天`, `${unread().count} unread messages · Summarize`)}
          </TopbarPlate.PrimaryButton>
          <TopbarPlate.CloseButton onClick={(e) => {
            e.stopPropagation();
            setHidden(true);
          }} />
        </Show>
      );
    }
  });

  const setPeerId = (peerId: PeerId) => {
    const mine = ++token;
    closeCard();
    setPlateHidden(true);
    setUnread();

    // * for looking at the bar where nothing is unread (the PR's acceptance steps): `lgSummaryBar(128)` in
    // * the console shows it over the chat on screen as if that many were unread. Nothing is changed in
    // * the chat or kept; leaving the chat takes it away
    if(!chat.isPreview) {
      (window as any).lgSummaryBar = (count = 128) => {
        if(!canOpen()) return false;
        setUnread({count});
        setPlateHidden(false);
        return true;
      };
    }

    const isSaved = peerId === rootScope.myId;
    if(!canOpen() || !peerId || isSaved) return;

    // * asked before the chat is drawn: what is read by looking at it comes after
    const {threadId} = chat;
    Promise.resolve(managers.dialogsStorage.getAnyDialog(peerId, threadId)).then((dialog: any) => {
      if(mine !== token) return;
      const snapshot = takeUnreadSnapshot(dialog);
      setUnread(snapshot);
      if(shouldShowUnreadBar({enabled: isFeatureEnabled(AI_SUMMARY), canOpen: canOpen(), isSaved, snapshot})) setPlateHidden(false);
    }, () => {});
  };

  // * switched off: the bar and the card go at once
  const unwatch = watchFeatures([AI_SUMMARY], () => {
    if(isFeatureEnabled(AI_SUMMARY)) return;
    setPlateHidden(true);
    closeCard();
  });

  return {
    ...plate,
    setPeerId,
    canOpen,
    open: () => openCard(false),
    destroy: () => {
      ++token;
      unwatch();
      closeCard();
      plate.destroy();
    }
  };
}
