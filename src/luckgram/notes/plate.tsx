/*
 * Luckgram Web (luckgram-specs#192, W10 需求 2): the note at the chat's top — one of upstream's
 * bars (under the pinned message's, over the summary's), showing the note's first line. A press
 * unfolds it: the whole text, and "编辑", in a layer under the bars that lies over the messages
 * (a bar has a fixed height; a note may have 2000 characters). Folded or unfolded is remembered
 * for each chat, with its note. Not in the views of scheduled or pinned messages, or of a search.
 */

import {Show, createEffect, createMemo, createSignal, on} from 'solid-js';
import type Chat from '@components/chat/chat';
import {ChatType} from '@components/chat/chatType';
import type ChatTopbar from '@components/chat/topbar';
import {createTopbarPlate, TopbarPlateController} from '@components/chat/topbarPlate';
import {AppManagers} from '@lib/managers';
import {attachClickEvent} from '@helpers/dom/clickEvent';
import {useFeatureEnabled} from '@/luckgram/core/hooks';
import {lgText} from '@/luckgram/text';
import {NotePeer, USER_NOTES, firstLine} from '@/luckgram/notes/logic';
import {cleanNotesOnce, getNotesAccount, notesStore, toNotePeer, useNote} from '@/luckgram/notes/instance';
import {NOTE_HINT, openNoteEditor} from '@/luckgram/notes/editor';

export type LuckgramNotePlate = TopbarPlateController & {
  setPeerId: (peerId: PeerId) => void
};

const el = (tag: string, className: string, text?: string) => {
  const element = document.createElement(tag);
  element.className = className;
  if(text !== undefined) element.textContent = text;
  return element;
};

export default function createLuckgramNotePlate(
  topbar: ChatTopbar,
  chat: Chat,
  _managers: AppManagers
): LuckgramNotePlate {
  const [peer, setPeer] = createSignal<NotePeer>();
  let card: HTMLElement, cardText: HTMLElement;

  const edit = () => {
    const account = getNotesAccount(), of = peer();
    if(account && of) openNoteEditor({store: notesStore, account, peer: of});
  };

  const setExpanded = (expanded: boolean) => {
    const account = getNotesAccount(), of = peer();
    if(account && of) notesStore.setExpanded(account, of, expanded);
  };

  // * the whole text: a layer of the chat, under its bars
  const showCard = (text: string | undefined) => {
    if(!text) {
      card?.remove();
      return;
    }

    if(!card) {
      card = el('div', 'luckgram-note-card');
      card.setAttribute('role', 'region');
      card.setAttribute('aria-label', lgText('私人备注', 'Private note'));
      cardText = el('div', 'luckgram-note-card-text');
      cardText.dir = 'auto';
      const footer = el('div', 'luckgram-note-card-footer');
      const editButton = el('button', 'luckgram-note-card-button', lgText('编辑', 'Edit')) as HTMLButtonElement;
      editButton.type = 'button';
      attachClickEvent(editButton, edit);
      const foldButton = el('button', 'luckgram-note-card-button', lgText('收起', 'Fold')) as HTMLButtonElement;
      foldButton.type = 'button';
      attachClickEvent(foldButton, () => setExpanded(false));
      footer.append(el('span', 'luckgram-note-card-hint', lgText(...NOTE_HINT)), editButton, foldButton);
      card.append(cardText, footer);
    }

    cardText.textContent = text;
    if(card.parentElement !== chat.container) chat.container.append(card);
  };

  const plate = createTopbarPlate({
    modifier: 'luckgram-note',
    height: 40,
    onVisibilityChange: () => topbar.setFloating(),
    render: ({setHidden}) => {
      const enabled = useFeatureEnabled(USER_NOTES);
      const note = useNote(peer);
      const shown = createMemo(() => enabled() ? note() : undefined);

      createEffect(on(shown, (value) => {
        setHidden(!value);
        showCard(value?.expanded ? value.text : undefined);
      }));

      return (
        <Show when={shown()}>
          <button
            type="button"
            class="luckgram-note-bar"
            aria-expanded={!!shown().expanded}
            title={lgText(...NOTE_HINT)}
            onClick={() => setExpanded(!shown().expanded)}
          >
            <span class="luckgram-note-bar-label">{lgText('私人备注', 'Private note')}</span>
            <span class="luckgram-note-bar-text" dir="auto">{firstLine(shown().text)}</span>
            <span class="luckgram-note-bar-arrow" aria-hidden="true">{shown().expanded ? '▴' : '▾'}</span>
          </button>
        </Show>
      );
    }
  });

  return {
    ...plate,
    setPeerId: (peerId) => {
      cleanNotesOnce();
      const here = chat.type === ChatType.Chat && !chat.isPreview && !!peerId;
      setPeer(here ? toNotePeer(peerId, !!chat.isChannel) : undefined);
    },
    destroy: () => {
      card?.remove();
      plate.destroy();
    }
  };
}
