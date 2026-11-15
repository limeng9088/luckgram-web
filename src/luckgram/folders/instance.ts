/*
 * Luckgram Web (luckgram-specs#191, W12 决定 4、6): the one store of keyword folders of this
 * page, and what tells upstream's folder storage (in the worker) of them — as the page starts
 * and whenever they change. That storage forgets them with every start (they are not in what
 * upstream keeps), and gets them from here again: after a rebuild from the server they are there.
 */

import confirmationPopup from '@components/confirmationPopup';
import rootScope from '@lib/rootScope';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import {isFeatureEnabled} from '@/luckgram/core/features';
import {watchFeatures} from '@/luckgram/core/hooks';
import {onAccountLeaving} from '@/luckgram/core/logout';
import {luckgramStorage} from '@/luckgram/core/settings';
import {lgText} from '@/luckgram/text';
import {setKeywordFolderLookup} from '@/luckgram/folders/current';
import {KEYWORD_FOLDERS} from '@/luckgram/folders/logic';
import {FoldersStore} from '@/luckgram/folders/store';

export const foldersStore = new FoldersStore(luckgramStorage);

// * the chat list and the chat ask for a folder's keywords here (current.ts), without importing this
setKeywordFolderLookup((id) => {
  const account = getFoldersAccount();
  return account && isFeatureEnabled(KEYWORD_FOLDERS) ? foldersStore.get(account, id) : undefined;
});

// * this tab's account logs out: its keyword folders go with it
onAccountLeaving((account) => foldersStore.deleteAccount(account));

/** The account of this tab, as the folders are kept by; nothing before the sign-in. */
export const getFoldersAccount = () => rootScope.myId ? String(rootScope.myId) : undefined;

/** Tells the worker of the account's keyword folders as they now are; none while the feature is off. */
export async function syncKeywordFolders() {
  const account = getFoldersAccount();
  if(!account) return;
  const managers = bindManagersToSession(rootScope.managers);
  await foldersStore.ready;
  const folders = isFeatureEnabled(KEYWORD_FOLDERS) ? foldersStore.list(account) : [];
  try {
    await managers.filtersStorage.luckgramSetKeywordFolders(folders.map((folder) => ({...folder, keywords: folder.keywords.slice(), scopes: folder.scopes.slice()})));
  } catch(err) {
    console.warn('[luckgram] keyword folders: sync', (err as Error)?.message);
  }
}

let started = false;
/** Once, when the left column is built: the folders go to the worker once the account is known, and follow every change. */
export function startKeywordFolders() {
  if(started) return;
  started = true;

  foldersStore.subscribe(() => syncKeywordFolders());
  watchFeatures([KEYWORD_FOLDERS], () => syncKeywordFolders());

  let tries = 0;
  const whenSignedIn = async() => {
    if(!rootScope.myId) {
      if(++tries < 120) setTimeout(whenSignedIn, 500);
      return;
    }

    try {
      const {default: AccountController} = await import('@lib/accounts/accountController');
      await foldersStore.ready;
      const accounts = await AccountController.getUserIds();
      // * only when the accounts could be read: an empty answer is not "nobody is signed in"
      if(accounts.length) await foldersStore.cleanOrphans(accounts as any);
    } catch(err) {
      console.warn('[luckgram] keyword folders: start', (err as Error)?.message);
    }

    syncKeywordFolders();
  };

  whenSignedIn();
}

/** Asks, then deletes the folder: its chats are not touched. */
export async function confirmRemoveKeywordFolder(id: number) {
  const account = getFoldersAccount();
  const folder = account && foldersStore.get(account, id);
  if(!folder) return false;
  const sure = await confirmationPopup({
    title: lgText('删除关键词文件夹？', 'Delete the keyword folder?'),
    descriptionRaw: lgText(`「${folder.title}」会被删除，里面的聊天不受影响。`, `"${folder.title}" will be deleted. Its chats are not affected.`),
    button: {text: document.createTextNode(lgText('删除', 'Delete')), isDanger: true}
  }).then(() => true, () => false);
  if(sure) await foldersStore.remove(account, id);
  return sure;
}
