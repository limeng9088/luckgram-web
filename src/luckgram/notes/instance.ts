/*
 * Luckgram Web (luckgram-specs#192, W10 需求 4): the one store of private notes of this page,
 * and what turns upstream's peer ids into the notes' own (which say what the id is of).
 */

import {Accessor, createMemo, createSignal, onCleanup} from 'solid-js';
import rootScope from '@lib/rootScope';
import {luckgramStorage} from '@/luckgram/core/settings';
import {onAccountLeaving} from '@/luckgram/core/logout';
import {Note, NotePeer} from '@/luckgram/notes/logic';
import {NotesStore} from '@/luckgram/notes/store';

export const notesStore = new NotesStore(luckgramStorage);

// * this tab's account logs out: its notes go with it (the confirmation says so, popups/logOut)
onAccountLeaving((account) => notesStore.deleteAccount(account));

/** The account of this tab, as notes are kept by; nothing before the sign-in. */
export const getNotesAccount = () => rootScope.myId ? String(rootScope.myId) : undefined;

/** @param isChannel a supergroup or a channel (upstream's peer id does not tell them from a legacy group) */
export function toNotePeer(peerId: PeerId, isChannel: boolean): NotePeer | undefined {
  const id = Math.abs(+peerId);
  if(!id) return;
  return {type: +peerId > 0 ? 'user' : isChannel ? 'channel' : 'chat', id};
}

export const toPeerId = (peer: NotePeer) => (peer.type === 'user' ? peer.id : -peer.id) as PeerId;

/** The note of a peer, following every change of it. */
export function useNote(peer: Accessor<NotePeer | undefined>): Accessor<Note | undefined> {
  const [version, setVersion] = createSignal(0);
  onCleanup(notesStore.subscribe(() => setVersion((value) => value + 1)));
  return createMemo(() => {
    version();
    const of = peer(), account = getNotesAccount();
    const note = of && account ? notesStore.get(account, of) : undefined;
    // * a copy: the store changes its object in place (the bar's state), which a memo would not see
    return note && {...note};
  });
}

let cleaned = false;
/** Once, after the sign-in: notes of accounts that are gone (logged out in another tab, or from a phone). */
export async function cleanNotesOnce() {
  if(cleaned || !rootScope.myId) return;
  cleaned = true;
  try {
    const {default: AccountController} = await import('@lib/accounts/accountController');
    await notesStore.ready;
    const accounts = await AccountController.getUserIds();
    // * only when the accounts could be read: an empty answer is not "nobody is signed in"
    if(accounts.length) await notesStore.cleanOrphans(accounts as any);
  } catch(err) {
    console.warn('[luckgram] notes: start', (err as Error)?.message);
  }
}
