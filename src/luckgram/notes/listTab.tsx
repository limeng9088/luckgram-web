/*
 * Luckgram Web (luckgram-specs#192, W10 需求 3、5): "全部备注" — every private note of this
 * account: whose it is, its first line; searched by text and by name; a press opens that chat
 * with its profile. "导出" writes them into a JSON file, "导入" reads such a file (the format is
 * in the spec and in logic.ts) — the way to carry them to another browser. Nothing leaves the
 * device otherwise.
 */

import {For, JSX, Show, createMemo, createSignal, onCleanup} from 'solid-js';
import {AvatarNewTsx} from '@components/avatarNew';
import confirmationPopup from '@components/confirmationPopup';
import {PeerTitleTsx} from '@components/peerTitleTsx';
import Row from '@components/rowTsx';
import Section from '@components/section';
import appSidebarRight from '@components/sidebarRight';
import {toast} from '@components/toast';
import getPeerTitle from '@components/wrappers/getPeerTitle';
import appImManager from '@lib/appImManager';
import apiManagerProxy from '@lib/apiManagerProxy';
import {lgText} from '@/luckgram/text';
import {displayId} from '@/luckgram/profile/logic';
import {Note, buildNotesFile, firstLine, noteKey, parseNotesFile, planImport, searchNotes} from '@/luckgram/notes/logic';
import {getNotesAccount, notesStore, toPeerId} from '@/luckgram/notes/instance';
import {openNoteEditor} from '@/luckgram/notes/editor';

/** Whether the app knows the peer (a group that was left may be gone): a name and a picture can be shown. */
function isKnown(note: Note) {
  try {
    const peerId = toPeerId(note.peer);
    return !!(note.peer.type === 'user' ? apiManagerProxy.getUser(peerId.toUserId()) : apiManagerProxy.getChat(peerId.toChatId()));
  } catch(err) {
    return false;
  }
}

const getId = (note: Note) => displayId(note.peer.type, note.peer.id);

export default function LuckgramNotesList(): JSX.Element {
  const account = getNotesAccount();
  const [version, setVersion] = createSignal(0);
  const [query, setQuery] = createSignal('');
  const [names, setNames] = createSignal<{[key: string]: string}>({});
  onCleanup(notesStore.subscribe(() => setVersion((value) => value + 1)));
  notesStore.ready.then(() => setVersion((value) => value + 1));

  const all = createMemo(() => {
    version();
    return account ? notesStore.list(account) : [];
  });

  // * the names the search goes through: asked once for each note
  const asked = new Set<string>();
  const shown = createMemo(() => {
    for(const note of all()) {
      const key = noteKey(account, note.peer);
      if(asked.has(key) || !isKnown(note)) continue;
      asked.add(key);
      Promise.resolve(getPeerTitle({peerId: toPeerId(note.peer), plainText: true}) as any as Promise<string>)
      .then((name) => name && setNames((before) => ({...before, [key]: name})), () => {});
    }

    return searchNotes(all(), query(), (note) => names()[noteKey(account, note.peer)]);
  });

  const openPeer = (note: Note) => {
    if(!isKnown(note)) {
      openNoteEditor({store: notesStore, account, peer: note.peer});
      return;
    }

    appImManager.setInnerPeer({peerId: toPeerId(note.peer)}).then(() => {
      appSidebarRight.toggleSidebar(true);
    }, () => {});
  };

  const exportNotes = () => {
    const file = buildNotesFile(account, all(), Date.now());
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], {type: 'application/json'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = `luckgram-notes-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(lgText(`已导出 ${file.notes.length} 条备注`, `${file.notes.length} notes exported`));
  };

  const importText = async(text: string) => {
    const parsed = parseNotesFile(text);
    if(parsed.ok === false) {
      toast(parsed.reason === 'newer_version' ?
        lgText('这个文件来自更新的版本，当前版本无法导入。', 'This file was made by a newer version and cannot be imported here.') :
        lgText('这不是 Luckgram 的备注文件。', 'This is not a Luckgram notes file.'));
      return;
    }

    if(String(parsed.account) !== account) {
      const go = await confirmationPopup({
        title: lgText('导入备注', 'Import notes'),
        descriptionRaw: lgText('这份备注来自另一个账号，仍要导入到当前账号吗？', 'These notes come from another account. Import them into this one anyway?'),
        button: {text: document.createTextNode(lgText('导入', 'Import'))}
      }).then(() => true, () => false);
      if(!go) return;
    }

    const plan = planImport(notesStore.list(account), parsed.notes);
    await notesStore.setMany(account, plan.set);
    const skipped = plan.kept + parsed.skipped;
    toast(lgText(`新增 ${plan.added} 条，更新 ${plan.updated} 条，跳过 ${skipped} 条`, `${plan.added} added, ${plan.updated} updated, ${skipped} skipped`));
  };

  const importNotes = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if(!file) return;
      // * a notes file is small; anything large is not one
      if(file.size > 8 * 1024 * 1024) {
        toast(lgText('这不是 Luckgram 的备注文件。', 'This is not a Luckgram notes file.'));
        return;
      }

      file.text().then(importText, () => toast(lgText('读取文件失败。', 'The file could not be read.')));
    });
    input.click();
  };

  return (
    <>
      <Section caption={<span>{lgText('备注只存在这台设备，只有您能看到。换浏览器时用「导出」和「导入」带走。', 'Notes are kept on this device only, and only you can see them. Use Export and Import to carry them to another browser.')}</span>}>
        <Row clickable={exportNotes} disabled={!all().length}>
          <Row.Icon icon="download" />
          <Row.Title>{lgText('导出', 'Export')}</Row.Title>
          <Row.Subtitle>{lgText('把全部备注存成一个 JSON 文件', 'Save all notes into one JSON file')}</Row.Subtitle>
        </Row>
        <Row clickable={importNotes}>
          <Row.Icon icon="upload" />
          <Row.Title>{lgText('导入', 'Import')}</Row.Title>
          <Row.Subtitle>{lgText('从导出的文件读入；两边都有的，保留较新的', 'Read an exported file; where both have a note, the newer stays')}</Row.Subtitle>
        </Row>
      </Section>

      <Section name={<span>{lgText(`全部备注（${all().length}）`, `All notes (${all().length})`)}</span>}>
        <Show when={all().length > 0}>
          <input
            type="search"
            class="luckgram-notes-search"
            dir="auto"
            placeholder={lgText('搜索备注内容和名字', 'Search notes and names')}
            aria-label={lgText('搜索备注', 'Search notes')}
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
        </Show>
        <For each={shown()} fallback={
          <div class="luckgram-notes-empty">{all().length ?
            lgText('没有符合的备注', 'No notes match') :
            lgText('还没有备注。在任何人、群组或频道的资料里可以添加。', 'No notes yet. Add one in the profile of any person, group or channel.')}</div>
        }>{(note) => (
          <Row clickable={() => openPeer(note)} class="luckgram-notes-item">
            <Row.Media size="abitbigger">
              <Show when={isKnown(note)} fallback={<div class="luckgram-notes-unknown" aria-hidden="true">?</div>}>
                <AvatarNewTsx peerId={toPeerId(note.peer)} size={42} />
              </Show>
            </Row.Media>
            <Row.Title>
              <Show when={isKnown(note)} fallback={<span dir="ltr">{'ID ' + getId(note)}</span>}>
                <PeerTitleTsx peerId={toPeerId(note.peer)} />
              </Show>
            </Row.Title>
            <Row.Subtitle><span dir="auto">{firstLine(note.text)}</span></Row.Subtitle>
          </Row>
        )}</For>
      </Section>
    </>
  );
}
