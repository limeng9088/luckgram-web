/*
 * Luckgram Web (luckgram-specs#192, W10 需求 1): the profile's "私人备注" row, under the
 * description — the note, or "添加私人备注…"; a press opens the editor. It stands beside
 * Telegram's own contact note (upstream's row, kept in Telegram's cloud): the two do not touch.
 */

import {JSX, Show, createMemo} from 'solid-js';
import {resolveFirst} from '@solid-primitives/refs';
import Section from '@components/section';
import type SolidJSHotReloadGuardProvider from '@lib/solidjs/hotReloadGuardProvider';
import Row from '@components/rowTsx';
import {copyTextToClipboard} from '@helpers/clipboard';
import {toastNew} from '@components/toast';
import {useFeatureEnabled} from '@/luckgram/core/hooks';
import {lgText} from '@/luckgram/text';
import {USER_NOTES} from '@/luckgram/notes/logic';
import {cleanNotesOnce, getNotesAccount, notesStore, toNotePeer, useNote} from '@/luckgram/notes/instance';
import {NOTE_HINT, openNoteEditor} from '@/luckgram/notes/editor';

export default function LuckgramNoteRow(props: {peerId: PeerId, isChannel: boolean}): JSX.Element {
  const enabled = useFeatureEnabled(USER_NOTES);
  const peer = createMemo(() => toNotePeer(props.peerId, props.isChannel));
  const note = useNote(peer);
  cleanNotesOnce();

  const edit = () => {
    const account = getNotesAccount(), of = peer();
    if(account && of) openNoteEditor({store: notesStore, account, peer: of});
  };

  return (
    <Show when={enabled() && peer()}>
      <Row
        clickable={edit}
        class="luckgram-note-row"
        contextMenu={{
          buttons: [{
            icon: 'edit',
            regularText: lgText('编辑备注', 'Edit note') as any,
            onClick: edit
          }, {
            icon: 'copy',
            regularText: lgText('复制备注', 'Copy note') as any,
            onClick: () => {
              copyTextToClipboard(note().text);
              toastNew({langPackKey: 'TextCopied'});
            },
            verify: () => !!note()
          }, {
            icon: 'delete',
            danger: true,
            regularText: lgText('删除备注', 'Delete note') as any,
            onClick: () => notesStore.delete(getNotesAccount(), peer()),
            verify: () => !!note()
          }]
        }}
      >
        <Row.Icon icon="edit" />
        <Row.Title class="pre-wrap">
          <Show when={note()} fallback={<span class="luckgram-note-row-empty">{lgText('添加私人备注…', 'Add a private note…')}</span>}>
            <span dir="auto" class="luckgram-note-row-text">{note().text}</span>
          </Show>
        </Row.Title>
        <Row.Subtitle>{lgText('私人备注', 'Private note') + ' · ' + lgText(...NOTE_HINT)}</Row.Subtitle>
      </Row>
    </Show>
  );
}

/**
 * The row for Saved Messages' panel: upstream draws no profile there (only the tabs of what was
 * saved), so the row comes in a card of its own over the tabs. Nothing while the feature is off.
 */
export function renderSavedNoteSection(peerId: PeerId, HotReloadGuardProvider: typeof SolidJSHotReloadGuardProvider) {
  const Card = () => {
    const enabled = useFeatureEnabled(USER_NOTES);
    return (
      <div class="luckgram-note-saved" classList={{hide: !enabled()}}>
        <Section noDelimiter>
          <LuckgramNoteRow peerId={peerId} isChannel={false} />
        </Section>
      </div>
    );
  };

  const ret = (
    <HotReloadGuardProvider>
      <Card />
    </HotReloadGuardProvider>
  );

  return resolveFirst(() => ret)() as HTMLElement;
}
