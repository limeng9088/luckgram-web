/*
 * Luckgram Web (luckgram-specs#188, W8 需求 1、2、6): the assistant's page put into the middle
 * column and taken out of it — the only part of the assistant that knows of upstream's columns.
 *
 *  - over the middle column, whatever chat is open under it; a narrow window is switched to that column;
 *  - the address says #/luckgram-ai while it is open (upstream's own routing leaves that value
 *    alone) and is upstream's again once a chat is opened or the page is closed;
 *  - opening a chat from the list closes it, and so does Back.
 */

import appImManager from '@lib/appImManager';
import {APP_TABS, LEFT_COLUMN_ACTIVE_CLASSNAME} from '@lib/appColumns';
import rootScope from '@lib/rootScope';
import appNavigationController, {NavigationItem} from '@components/appNavigationController';
import confirmationPopup from '@components/confirmationPopup';
import {copyTextToClipboard} from '@helpers/clipboard';
import mediaSizes from '@helpers/mediaSizes';
import {luckgramStorage} from '@/luckgram/core/settings';
import {isFeatureEnabled} from '@/luckgram/core/features';
import luckgramAI from '@/luckgram/core/instance';
import {lgText} from '@/luckgram/text';
import {AI_ASSISTANT, AI_HASH} from '@/luckgram/assistant/logic';
import AssistantPage from '@/luckgram/assistant/page';
import type {AssistantPageApi} from '@/luckgram/assistant/registry';
import {AssistantStore} from '@/luckgram/assistant/store';

export const assistantStore = new AssistantStore(luckgramStorage);

let page: AssistantPage;
let navigationItem: NavigationItem;
let listening = false;

/**
 * Whether the chat list is not a column of its own beside the page: a window of one column
 * (600px and less), or one where the list floats over the middle column (up to 925px —
 * upstream's $floating-left-sidebar). There the list and the page are not seen together: the page
 * is brought forward as it opens, and going back from it shows the list — always the list,
 * whatever chat was open before (upstream's own back button of a chat does the same at these widths).
 */
function isListFloating() {
  try {
    return !window.matchMedia('(min-width: 926px)').matches;
  } catch(err) {
    return mediaSizes.isMobile;
  }
}
/** what was typed and not sent as the page was closed (opening a chat closes it): there again when it is opened */
let draft: {account: PeerId, text: string};

export const isAssistantOpen = () => !!page;

function listenOnce() {
  if(listening) return;
  listening = true;

  // * a chat is opened: the page gives way, and the address is upstream's again
  appImManager.addEventListener('peer_changed', ({peerId}: {peerId?: PeerId}) => {
    if(peerId && page) closeAssistant({keepColumn: true});
  });

  // * also the chat that was open under the page all along, which changes nothing for upstream
  document.getElementById('folders-container')?.addEventListener('click', () => {
    if(page) closeAssistant({keepColumn: true});
  }, true);

  // * the window got narrow with the page open: one column is on screen now, and upstream leaves there
  // * the one it had marked as active — the chat list, when no chat was open under the page, with the
  // * page off screen beside it. The page's column is brought on screen, as when it is opened narrow
  mediaSizes.addEventListener('changeScreen', () => {
    if(!page || !isListFloating()) return;
    if(document.body.classList.contains(LEFT_COLUMN_ACTIVE_CLASSNAME)) appImManager.selectTab(APP_TABS.CHAT);
  });
}

/** Opens the assistant's page, or brings the open one forward. Nothing when the feature is off or held back. */
export async function openAssistant(): Promise<AssistantPageApi | undefined> {
  if(!isFeatureEnabled(AI_ASSISTANT) || !rootScope.myId) return;
  if(page) {
    // * pressed in a list that floats over the page (or is the one column): the page comes forward
    if(isListFloating() && document.body.classList.contains(LEFT_COLUMN_ACTIVE_CLASSNAME)) {
      appImManager.selectTab(APP_TABS.CHAT);
      appNavigationController.overrideHash(AI_HASH.slice(1), true);
    }

    page.focus();
    return page.api;
  }

  await assistantStore.ready;
  if(page) return page.api;

  listenOnce();
  page = new AssistantPage({
    account: rootScope.myId as any,
    store: assistantStore,
    chat: (options) => luckgramAI.chat(options),
    onBack: () => closeAssistant(),
    copy: (text) => {
      copyTextToClipboard(text);
    },
    confirmDelete: (title) => confirmationPopup({
      title: lgText('删除对话？', 'Delete conversation?'),
      descriptionRaw: lgText(`「${title}」将被删除，无法恢复。`, `"${title}" will be deleted for good.`),
      button: {text: document.createTextNode(lgText('删除', 'Delete')), isDanger: true}
    }).then(() => true, () => false)
  });

  if(draft?.account === rootScope.myId && draft.text) page.api.setInput(draft.text);
  draft = undefined;

  appImManager.columnEl.append(page.element);
  document.body.classList.add('luckgram-ai-open');

  // * the list is not beside the page (one column, or a list that floats over it): the page comes forward
  if(isListFloating()) appImManager.selectTab(APP_TABS.CHAT);
  // * after the column was chosen, which writes the address of the chat under the page
  appNavigationController.overrideHash(AI_HASH.slice(1), true);

  navigationItem = {
    type: 'luckgram-ai' as any,
    onPop: () => {
      navigationItem = undefined;
      closeAssistant();
    }
  };
  appNavigationController.pushItem(navigationItem);

  if(!mediaSizes.isMobile) page.focus();
  return page.api;
}

/** @param keepColumn a chat is being opened: the column and the address are its business */
export function closeAssistant(options: {keepColumn?: boolean} = {}) {
  if(!page) return;
  const closing = page;
  page = undefined;
  draft = {account: rootScope.myId, text: closing.api.getInput()};
  closing.destroy();
  document.body.classList.remove('luckgram-ai-open');

  if(navigationItem) {
    const item = navigationItem;
    navigationItem = undefined;
    appNavigationController.removeItem(item);
  }

  if(options.keepColumn) return;

  // * back from the page is back to the chat list, wherever the page was opened from and whatever chat
  // * is under it: shown as the one column, or floating over the middle one. With the list docked
  // * beside the page there is nothing to go back to — it is there
  if(isListFloating()) appImManager.selectTab(APP_TABS.CHATLIST);
  if(location.hash === AI_HASH) appNavigationController.overrideHash('', true);
}

/** The account logged out in this tab: its conversations go with it (需求 6). */
export function deleteAssistantAccount(account: number | string) {
  closeAssistant({keepColumn: true});
  draft = undefined;
  return assistantStore.deleteAccount(account);
}
