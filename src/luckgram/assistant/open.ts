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
/** a narrow window showed the chat list as the page was opened: Back goes there, whatever chat is under the page */
let cameFromList = false;
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
    if(!page || !mediaSizes.isMobile) return;
    if(document.body.classList.contains(LEFT_COLUMN_ACTIVE_CLASSNAME)) {
      // * Back then goes to the list, where a narrow window would have come from
      cameFromList = true;
      appImManager.selectTab(APP_TABS.CHAT);
    }
  });
}

/** Opens the assistant's page, or brings the open one forward. Nothing when the feature is off or held back. */
export async function openAssistant(): Promise<AssistantPageApi | undefined> {
  if(!isFeatureEnabled(AI_ASSISTANT) || !rootScope.myId) return;
  if(page) {
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

  cameFromList = mediaSizes.isMobile && document.body.classList.contains(LEFT_COLUMN_ACTIVE_CLASSNAME);
  appImManager.columnEl.append(page.element);
  document.body.classList.add('luckgram-ai-open');

  // * one column on screen: it has to be the middle one
  if(mediaSizes.isMobile) appImManager.selectTab(APP_TABS.CHAT);
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

  const openPeerId = appImManager.chat?.peerId;
  // * a narrow window goes back where it came from: to the list, when the page was opened from it (a chat
  // * opened before is still under the page) or there is no chat; the chat's own address otherwise
  if(mediaSizes.isMobile && (cameFromList || !openPeerId)) appImManager.selectTab(APP_TABS.CHATLIST);
  if(location.hash === AI_HASH) appNavigationController.overrideHash('', true);
}

/** The account logged out in this tab: its conversations go with it (需求 6). */
export function deleteAssistantAccount(account: number | string) {
  closeAssistant({keepColumn: true});
  draft = undefined;
  return assistantStore.deleteAccount(account);
}
