/*
 * Luckgram Web (luckgram-specs#191, W12 决定 3、7): keyword folders in "设置 → 聊天文件夹",
 * under upstream's own list — a list of their own (they are not mixed with Telegram's folders:
 * that list's order is what Telegram is told), put in order with the arrows, and the way to a
 * new one.
 */

import {For, JSX, Show, createSignal, onCleanup} from 'solid-js';
import Row from '@components/rowTsx';
import Section from '@components/section';
import {toast} from '@components/toast';
import {useFeatureEnabled} from '@/luckgram/core/hooks';
import {lgText} from '@/luckgram/text';
import {editKeywordFolder} from '@/luckgram/folders/hooks';
import {KEYWORD_FOLDERS, KeywordFolder, MAX_FOLDERS, getFolderErrorText} from '@/luckgram/folders/logic';
import {foldersStore, getFoldersAccount} from '@/luckgram/folders/instance';

export default function LuckgramKeywordFoldersSection(): JSX.Element {
  const enabled = useFeatureEnabled(KEYWORD_FOLDERS);
  const account = getFoldersAccount();
  const [folders, setFolders] = createSignal<KeywordFolder[]>([]);
  const read = () => setFolders(account ? foldersStore.list(account).slice() : []);
  onCleanup(foldersStore.subscribe(read));
  foldersStore.ready.then(read);
  read();

  const move = (id: number, by: number) => {
    const ids = folders().map((folder) => folder.id);
    const from = ids.indexOf(id), to = from + by;
    if(from === -1 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    foldersStore.reorder(account, ids);
  };

  const create = () => {
    if(folders().length >= MAX_FOLDERS) {
      toast(lgText(...getFolderErrorText('limit')));
      return;
    }

    editKeywordFolder();
  };

  return (
    <Show when={enabled() && account}>
      <Section
        name={<span>{lgText('关键词文件夹', 'Keyword folders')}</span>}
        caption={<span>{lgText('最近的消息里提到关键词的聊天自动归进来。只存在这台设备，排在上面那些文件夹之后。', 'Chats whose latest messages mention a keyword come in by themselves. Kept on this device only, after the folders above.')}</span>}
      >
        <For each={folders()}>{(folder, index) => (
          <div class="luckgram-folder-row">
            <button
              type="button"
              class="luckgram-folder-row-main"
              aria-label={lgText(`编辑「${folder.title}」`, `Edit "${folder.title}"`)}
              onClick={() => editKeywordFolder(folder.id)}
            >
              <span class="luckgram-folder-row-title" dir="auto">{folder.title}</span>
              <span class="luckgram-folder-row-keywords" dir="auto">{folder.keywords.join('、')}</span>
            </button>
            <div class="luckgram-folder-row-moves">
              <button
                type="button"
                class="luckgram-folder-move"
                disabled={index() === 0}
                aria-label={lgText('上移', 'Move up')}
                title={lgText('上移', 'Move up')}
                onClick={(e) => {
                  e.stopPropagation();
                  move(folder.id, -1);
                }}
              >↑</button>
              <button
                type="button"
                class="luckgram-folder-move"
                disabled={index() === folders().length - 1}
                aria-label={lgText('下移', 'Move down')}
                title={lgText('下移', 'Move down')}
                onClick={(e) => {
                  e.stopPropagation();
                  move(folder.id, 1);
                }}
              >↓</button>
            </div>
          </div>
        )}</For>
        <Row clickable={create} class="luckgram-folder-new">
          <Row.Icon icon="add" />
          <Row.Title>{lgText('新建关键词文件夹', 'New keyword folder')}</Row.Title>
        </Row>
      </Section>
    </Show>
  );
}
