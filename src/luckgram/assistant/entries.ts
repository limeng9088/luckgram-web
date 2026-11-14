/*
 * Luckgram Web (luckgram-specs#188, W8 需求 1、6): the ways into the assistant from the chat
 * list — the "AI" button right of the search field, and the "Luckgram AI" row over the list
 * (in "All chats" only; LuckgramSettings `ai_assistant_pin` hides it). Also what happens once as
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
  options.chatList.prepend(row);

  const update = () => {
    const enabled = isFeatureEnabled(AI_ASSISTANT);
    button.classList.toggle('hide', !enabled);
    let filterId: number;
    try {
      filterId = options.getFilterId();
    } catch(err) {}

    row.classList.toggle('hide', !isPinVisible({enabled, pinned: LuckgramSettings.getBool(KEY_PIN, true), filterId}));
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
