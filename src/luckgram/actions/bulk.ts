/*
 * Luckgram Web (luckgram-specs#190, W11a 需求 6): what the selection's bar does with more than
 * 100 messages — forwarded and deleted 100 at a time, one batch after another, with the progress
 * told and a failed batch tried again (upstream sends its batches all at once and tells nothing).
 * 100 or fewer go upstream's own way, untouched.
 */

import rootScope from '@lib/rootScope';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import confirmationPopup from '@components/confirmationPopup';
import {isFeatureEnabled} from '@/luckgram/core/features';
import {lgText} from '@/luckgram/text';
import {BATCH_SIZE, SELECT_ALL_FROM_SENDER} from '@/luckgram/actions/logic';
import {runBatches} from '@/luckgram/actions/progress';

/** Whether a selection of this many is acted on in Luckgram's batches. */
export const isBulk = (count: number) => count > BATCH_SIZE && isFeatureEnabled(SELECT_ALL_FROM_SENDER);

const flat = (selection: {[fromPeerId: PeerId]: number[]}) => Object.keys(selection).flatMap((key) => {
  const fromPeerId = key.toPeerId();
  return selection[fromPeerId].slice().sort((a, b) => a - b).map((mid) => ({fromPeerId, mid}));
});

/** The messages of one chat in a batch go in one request; a batch of several chats in one for each. */
const byPeer = (batch: {fromPeerId: PeerId, mid: number}[]) => {
  const map = new Map<PeerId, number[]>();
  for(const {fromPeerId, mid} of batch) map.set(fromPeerId, [...(map.get(fromPeerId) || []), mid]);
  return [...map];
};

/**
 * Upstream's own picker of where to forward to; then the batches.
 * @param showForwardPopup upstream's, handed in by the selection (it is not imported here)
 */
export function forwardInBatches(
  selection: {[fromPeerId: PeerId]: number[]},
  showForwardPopup: (peerIdMids: undefined, onSelect: (peerId: PeerId, threadId?: number) => void) => unknown,
  onStart: () => void
) {
  showForwardPopup(undefined, (peerId, threadId) => {
    onStart();
    const managers = bindManagersToSession(rootScope.managers);
    runBatches('forward', flat(selection), async(batch) => {
      for(const [fromPeerId, mids] of byPeer(batch)) {
        await managers.appMessagesManager.forwardMessages({peerId, threadId, fromPeerId, mids});
      }
    });
  });
}

/**
 * After upstream's own confirmation (which asks for whom to delete): one more, for so many — and
 * then the batches.
 * @param canRevoke those that can be deleted for everyone
 */
export async function deleteInBatches(options: {peerId: PeerId, mids: number[], revoke: boolean, canRevoke: number[], onStart?: () => void}) {
  const {peerId, mids, revoke} = options;
  // * the account the selection was made in, whatever the tab shows by the time the batches go
  const managers = bindManagersToSession(rootScope.managers);
  const sure = await confirmationPopup({
    title: lgText(`删除 ${mids.length} 条消息？`, `Delete ${mids.length} messages?`),
    descriptionRaw: lgText(`将删除选中的 ${mids.length} 条消息，无法撤销。`, `The ${mids.length} selected messages will be deleted. This cannot be undone.`),
    button: {text: document.createTextNode(lgText(`删除 ${mids.length} 条`, `Delete ${mids.length}`)), isDanger: true}
  }).then(() => true, () => false);
  if(!sure) return;

  options.onStart?.();
  const forAll = new Set(options.canRevoke);
  runBatches('delete', mids.slice().sort((a, b) => a - b), async(batch) => {
    // * what cannot be deleted for everyone is deleted here alone, as upstream's confirmation does it
    const both = revoke ? batch.filter((mid) => forAll.has(mid)) : [];
    const mine = revoke ? batch.filter((mid) => !forAll.has(mid)) : batch;
    if(both.length) await managers.appMessagesManager.deleteMessages(peerId, both, true);
    if(mine.length) await managers.appMessagesManager.deleteMessages(peerId, mine, false);
  });
}
