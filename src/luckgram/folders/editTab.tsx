/*
 * Luckgram Web (luckgram-specs#191, W12 决定 8): the page of one keyword folder, new or kept —
 * its name, 1 to 10 keywords, the kinds of chats it looks at. A page of the left column, opened
 * from "设置 → 聊天文件夹" and from a folder tab's menu.
 */

import {For, JSX, Show, createSignal} from 'solid-js';
import Section from '@components/section';
import {useSuperTab} from '@components/solidJsTabs/superTabProvider';
import {toast} from '@components/toast';
import {lgText} from '@/luckgram/text';
import {
  ALL_SCOPES, FolderScope, MAX_FOLDERS, MAX_KEYWORDS, MAX_KEYWORD_LENGTH, MAX_TITLE_LENGTH, checkFolder, getFolderErrorText, normalizeKeywords
} from '@/luckgram/folders/logic';
import {confirmRemoveKeywordFolder, foldersStore, getFoldersAccount} from '@/luckgram/folders/instance';

/** Which folder the page is of: set by whoever opens it, read once as it is built; nothing for a new one. */
let pending: number;
export function setEditedKeywordFolder(id?: number) {
  pending = id;
}

const SCOPE_TITLES: Record<FolderScope, [string, string]> = {
  private: ['私聊', 'Private chats'],
  groups: ['群组', 'Groups'],
  channels: ['频道', 'Channels']
};

export default function LuckgramKeywordFolderPage(): JSX.Element {
  const account = getFoldersAccount();
  const id = pending;
  pending = undefined;
  const folder = id !== undefined && account ? foldersStore.get(account, id) : undefined;

  let tab: any;
  try {
    [tab] = useSuperTab();
  } catch(err) {}

  const [title, setTitle] = createSignal(folder?.title || '');
  const [keywords, setKeywords] = createSignal<string[]>(folder?.keywords.slice() || []);
  const [scopes, setScopes] = createSignal<FolderScope[]>(folder?.scopes.slice() || ALL_SCOPES.slice());
  const [draft, setDraft] = createSignal('');

  const addKeyword = () => {
    // * several at once, apart by commas (either kind) or line breaks
    const parts = draft().split(/[,，\n]/);
    const next = normalizeKeywords([...keywords(), ...parts]);
    if(next.length > MAX_KEYWORDS) {
      toast(lgText(...getFolderErrorText('too_many_keywords')));
      return;
    }

    if(next.some((keyword) => Array.from(keyword).length > MAX_KEYWORD_LENGTH)) {
      toast(lgText(...getFolderErrorText('keyword_too_long')));
      return;
    }

    setKeywords(next);
    setDraft('');
  };

  const toggleScope = (scope: FolderScope) => {
    const has = scopes().includes(scope);
    // * at least one stays chosen
    if(has && scopes().length === 1) return;
    setScopes(ALL_SCOPES.filter((item) => item === scope ? !has : scopes().includes(item)));
  };

  const close = () => tab?.close?.();

  const save = () => {
    if(!account) return;
    // * a keyword typed and not yet added counts
    const all = normalizeKeywords([...keywords(), ...draft().split(/[,，\n]/)]);
    const value = {title: title(), keywords: all, scopes: scopes()};
    const error = folder ? checkFolder(value) : checkFolder(value, foldersStore.list(account).length);
    if(error) {
      toast(lgText(...getFolderErrorText(error)));
      return;
    }

    const result = folder ? foldersStore.edit(account, folder.id, value) : foldersStore.add(account, value);
    if(typeof result === 'string') {
      toast(lgText(...getFolderErrorText(result)));
      return;
    }

    close();
  };

  return (
    <>
      <Section name={<span>{lgText('名称', 'Name')}</span>}>
        <input
          class="luckgram-folder-input"
          type="text"
          dir="auto"
          maxLength={MAX_TITLE_LENGTH * 2}
          placeholder={lgText('例如：发票', 'For example: Invoices')}
          aria-label={lgText('文件夹名称', 'Folder name')}
          value={title()}
          onInput={(e) => setTitle(e.currentTarget.value)}
        />
      </Section>

      <Section
        name={<span>{lgText(`关键词（${keywords().length} / ${MAX_KEYWORDS}）`, `Keywords (${keywords().length} / ${MAX_KEYWORDS})`)}</span>}
        caption={<span>{lgText('最近的消息里出现任一关键词的聊天会进入这个文件夹。不区分大小写；中文按字词出现即算，英文按整个单词算（invoice 不算 invoices）。', 'Chats whose latest messages have any of the keywords come into this folder. Letter case does not matter; Chinese is found anywhere, other words whole ("invoice" is not "invoices").')}</span>}
      >
        <div class="luckgram-folder-chips">
          <For each={keywords()}>{(keyword) => (
            <span class="luckgram-folder-chip" dir="auto">
              {keyword}
              <button
                type="button"
                class="luckgram-folder-chip-remove"
                aria-label={lgText(`移除「${keyword}」`, `Remove "${keyword}"`)}
                onClick={() => setKeywords(keywords().filter((item) => item !== keyword))}
              >✕</button>
            </span>
          )}</For>
        </div>
        <Show when={keywords().length < MAX_KEYWORDS}>
          <div class="luckgram-folder-add">
            <input
              class="luckgram-folder-input"
              type="text"
              dir="auto"
              placeholder={lgText('输入关键词，回车添加', 'Type a keyword, press Enter')}
              aria-label={lgText('新的关键词', 'New keyword')}
              value={draft()}
              onInput={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if(e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
                  e.preventDefault();
                  addKeyword();
                }
              }}
            />
            <button type="button" class="luckgram-folder-button" disabled={!draft().trim()} onClick={addKeyword}>{lgText('添加', 'Add')}</button>
          </div>
        </Show>
      </Section>

      <Section name={<span>{lgText('范围', 'Chats to look at')}</span>}>
        <div class="luckgram-folder-scopes">
          <For each={ALL_SCOPES}>{(scope) => (
            <button
              type="button"
              class="luckgram-folder-scope"
              classList={{'is-on': scopes().includes(scope)}}
              aria-pressed={scopes().includes(scope)}
              onClick={() => toggleScope(scope)}
            >
              <span class="luckgram-folder-scope-mark" aria-hidden="true">{scopes().includes(scope) ? '✓' : ''}</span>
              {lgText(...SCOPE_TITLES[scope])}
            </button>
          )}</For>
        </div>
      </Section>

      <Section caption={<span>{lgText(`只统计最近的消息（每个聊天最近一条，以及这台设备上已经加载过的最近 50 条），不会搜索全部历史。已归档的聊天不会进入。文件夹只存在这台设备，不会出现在其他设备上，排在 Telegram 自己的文件夹之后。最多 ${MAX_FOLDERS} 个。`, `Only the latest messages count (each chat's last one, and the latest 50 already loaded on this device); the whole history is not searched. Archived chats are left out. The folder is kept on this device only, is not seen on other devices, and stands after Telegram's own folders. ${MAX_FOLDERS} at most.`)}</span>}>
        <div class="luckgram-folder-actions">
          <Show when={folder}>
            <button
              type="button"
              class="luckgram-folder-button is-danger"
              onClick={() => confirmRemoveKeywordFolder(folder.id).then((removed) => removed && close())}
            >{lgText('删除文件夹', 'Delete folder')}</button>
          </Show>
          <span class="luckgram-folder-space" />
          <button type="button" class="luckgram-folder-button is-primary" onClick={save}>{lgText(folder ? '保存' : '创建', folder ? 'Save' : 'Create')}</button>
        </div>
      </Section>
    </>
  );
}
