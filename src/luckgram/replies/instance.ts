/*
 * Luckgram Web (luckgram-specs#190, W11b 需求 11): the one store of quick replies of this page.
 */

import rootScope from '@lib/rootScope';
import {luckgramStorage} from '@/luckgram/core/settings';
import {onAccountLeaving} from '@/luckgram/core/logout';
import {lgText} from '@/luckgram/text';
import {RepliesStore} from '@/luckgram/replies/store';

export const repliesStore = new RepliesStore(luckgramStorage, () => lgText('zh', 'en') === 'zh');

// * this tab's account logs out: its templates go with it
onAccountLeaving((account) => repliesStore.deleteAccount(account));

/** The account of this tab, as templates are kept by; nothing before the sign-in. */
export const getRepliesAccount = () => rootScope.myId ? String(rootScope.myId) : undefined;

let cleaned = false;
/** Once, after the sign-in: templates of accounts that are gone. */
export async function cleanRepliesOnce() {
  if(cleaned || !rootScope.myId) return;
  cleaned = true;
  try {
    const {default: AccountController} = await import('@lib/accounts/accountController');
    await repliesStore.ready;
    const accounts = await AccountController.getUserIds();
    if(accounts.length) await repliesStore.cleanOrphans(accounts as any);
  } catch(err) {
    console.warn('[luckgram] quick replies: start', (err as Error)?.message);
  }
}
