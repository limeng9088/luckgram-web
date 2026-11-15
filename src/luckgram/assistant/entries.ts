/*
 * Luckgram Web (luckgram-specs#188, W8 需求 1、6): the ways into the assistant from the chat
 * list — the "AI" button right of the search field, and the "Luckgram AI" row over the list
 * (in "All chats" only; LuckgramSettings `ai_assistant_pin` hides it). The row is one of the panels
 * of upstream's `.chatlist-overlay` — the layer over the list that holds the suggestion bar and the
 * folder tabs, whose height the list leaves free: anything put into the list's own container lies
 * under that layer. With the column narrowed to icons, where the header keeps only its menu button,
 * the row is the way in: its picture alone, in whatever folder, pinned or not. Also what happens once as
 * the app starts: a page reloaded at #/luckgram-ai opens the assistant again, and conversations
 * of accounts that are no longer signed in are deleted.
 *
 * sidebarLeft calls `mountAssistantEntries` once; everything heavy is loaded on the first press.
 */

import LuckgramSettings from '@/luckgram/core/settings';
import {isFeatureEnabled} from '@/luckgram/core/features';
import {watchFeatures} from '@/luckgram/core/hooks';
import {onAccountLeaving} from '@/luckgram/core/logout';
import {lgText} from '@/luckgram/text';
import {AI_ASSISTANT, KEY_PIN} from '@/luckgram/assistant/logic';
import {takeStartedAtAssistant} from '@/luckgram/assistant/start';
import {setAskAiHandler} from '@/luckgram/assistant/askHook';

const open = () => import('@/luckgram/assistant/open').then((module) => module.openAssistant());

/** `filterId`: the folder the chat list shows; 0 is "All chats". */
export function isPinVisible(state: {enabled: boolean, pinned: boolean, filterId: number | undefined}) {
  return state.enabled && state.pinned && (state.filterId === 0 || state.filterId === undefined);
}

export function mountAssistantEntries(options: {
  header: Element,
  chatList: HTMLElement,
  /** the folder on screen (appDialogsManager.filterId) */
  getFilterId: () => number,
  /** upstream's round icon button */
  createButton: (className: string) => HTMLElement
}) {
  // * the button
  const button = options.createButton('ai_filled luckgram-ai-entry');
  button.title = 'Luckgram AI';
  button.setAttribute('aria-label', lgText('打开 Luckgram AI 助手', 'Open the Luckgram AI assistant'));
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    open();
  });
  options.header.append(button);

  // * the row over the list
  const row = document.createElement('div');
  row.classList.add('luckgram-ai-row');
  row.setAttribute('role', 'button');
  row.tabIndex = 0;
  const avatar = document.createElement('div');
  avatar.classList.add('luckgram-ai-avatar');
  avatar.textContent = 'AI';
  const texts = document.createElement('div');
  texts.classList.add('luckgram-ai-row-texts');
  const title = document.createElement('div');
  title.classList.add('luckgram-ai-row-title');
  title.textContent = 'Luckgram AI';
  const subtitle = document.createElement('div');
  subtitle.classList.add('luckgram-ai-row-subtitle');
  subtitle.textContent = lgText('提问、总结、改写、解题', 'Ask, summarize, rewrite, solve');
  texts.append(title, subtitle);
  row.append(avatar, texts);
  row.addEventListener('click', () => open());
  row.addEventListener('keydown', (e) => {
    if(e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  });

  const update = () => {
    // * the layer is built by the chat list, which may come after this
    if(!row.isConnected) options.chatList.querySelector('.chatlist-overlay')?.append(row);

    const enabled = isFeatureEnabled(AI_ASSISTANT);
    button.classList.toggle('hide', !enabled);
    let filterId: number;
    try {
      filterId = options.getFilterId();
    } catch(err) {}

    row.classList.toggle('hide', !enabled);
    // * not shown in the wide column; the column of icons shows it all the same (luckgram.scss)
    row.classList.toggle('is-unpinned', !isPinVisible({enabled, pinned: LuckgramSettings.getBool(KEY_PIN, true), filterId}));
  };

  watchFeatures([AI_ASSISTANT], update);
  LuckgramSettings.subscribe((key) => {
    if(key === KEY_PIN) update();
  });

  // * the folder on screen changes with a class somewhere in the list: looked at once a frame at most
  let scheduled = false;
  new MutationObserver(() => {
    if(scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      update();
    });
  }).observe(options.chatList, {attributes: true, attributeFilter: ['class'], subtree: true, childList: true});

  LuckgramSettings.ready.then(update);
  update();

  // * this tab's account logs out: its conversations go with it, whether the page was ever opened or not
  onAccountLeaving((account) => import('@/luckgram/assistant/open').then((module) => module.deleteAssistantAccount(account)));

  // * "问 AI" of a message's menu comes here (askHook.ts says why not directly)
  setAskAiHandler((message) => import('@/luckgram/assistant/ask').then((module) => module.askAboutMessage(message)));

  // * the extension points shown once each: a local development build that asks for it (lg_ai_demo=1)
  if(import.meta.env.VITE_LG_CHANNEL !== 'prod') {
    try {
      if(localStorage.getItem('lg_ai_demo') === '1') import('@/luckgram/assistant/demo').then((module) => module.registerAssistantDemo());
    } catch(err) {}
  }

  startOnce();
}

let started = false;
/** Once the account is known: back to the assistant after a reload at its address; the orphans go. */
function startOnce() {
  if(started) return;
  started = true;

  const reopen = takeStartedAtAssistant();
  let tries = 0;
  const whenSignedIn = async() => {
    const {default: rootScope} = await import('@lib/rootScope');
    if(!rootScope.myId) {
      if(++tries < 120) setTimeout(whenSignedIn, 500);
      return;
    }

    try {
      const [{assistantStore}, {default: AccountController}] = await Promise.all([
        import('@/luckgram/assistant/open'),
        import('@lib/accounts/accountController')
      ]);
      await assistantStore.ready;
      const accounts = await AccountController.getUserIds();
      // * only when the accounts could be read: an empty answer is not "nobody is signed in"
      if(accounts.length) await assistantStore.cleanOrphans(accounts as any);
    } catch(err) {
      console.warn('[luckgram] assistant: start', (err as Error)?.message);
    }

    if(reopen) open();
  };

  setTimeout(whenSignedIn, 1500);
}
