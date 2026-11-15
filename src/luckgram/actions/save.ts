/*
 * Luckgram Web (luckgram-specs#190, W11a 需求 1–3; specs/15-save-direct.md): "收藏" — messages
 * forwarded to Saved Messages in one press, their authors kept as a forward keeps them; then
 * "已保存到我的收藏 · 查看", where "查看" goes to what was saved.
 */

import rootScope from '@lib/rootScope';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import type {AppManagers} from '@lib/managers';
import {toast} from '@components/toast';
import {attachClickEvent} from '@helpers/dom/clickEvent';
import {lgText} from '@/luckgram/text';
import {BATCH_SIZE, findSavedMid} from '@/luckgram/actions/logic';
import {runBatches} from '@/luckgram/actions/progress';

async function getSavedTop(managers: AppManagers, myId: PeerId, limit: number): Promise<number[]> {
  try {
    const result = await managers.appMessagesManager.getHistory({peerId: myId, limit});
    return result?.history || [];
  } catch(err) {
    return [];
  }
}

function showSavedToast(managers: AppManagers, myId: PeerId, count: number, before: number | undefined, openSaved: (lastMsgId: number | undefined) => void) {
  const content = document.createElement('span');
  const link = document.createElement('a');
  link.className = 'luckgram-toast-link';
  link.textContent = lgText('查看', 'View');
  link.setAttribute('role', 'button');
  link.tabIndex = 0;
  content.append(count > 1 ? lgText(`${count} 条消息已保存到我的收藏`, `${count} messages saved to Saved Messages`) : lgText('已保存到我的收藏', 'Saved to Saved Messages'), ' · ', link);

  attachClickEvent(link, async(e) => {
    e.preventDefault();
    e.stopPropagation();
    // * the first of what this save made; the newest place when it cannot be told
    const lastMsgId = findSavedMid(before, await getSavedTop(managers, myId, Math.min(count, BATCH_SIZE)));
    openSaved(lastMsgId);
  });

  toast(content);
}

/**
 * @param mids of one chat
 * @param openSaved opens Saved Messages at that message (the app's shell is not imported here: this module is
 * imported by the chat's menu, which the shell imports)
 * @returns whether everything was saved
 */
export async function saveToSavedMessages(fromPeerId: PeerId, mids: number[], openSaved: (lastMsgId: number | undefined) => void): Promise<boolean> {
  mids = [...new Set(mids)].sort((a, b) => a - b);
  if(!mids.length || !rootScope.myId) return false;
  // * the account the messages are saved in, whatever the tab shows by the time the batches go
  const managers = bindManagersToSession(rootScope.managers);
  const myId = rootScope.myId;
  const before = (await getSavedTop(managers, myId, 1))[0];
  const forward = (batch: number[]) => managers.appMessagesManager.forwardMessages({peerId: myId, fromPeerId, mids: batch});

  if(mids.length <= BATCH_SIZE) {
    try {
      await forward(mids);
    } catch(err) {
      toast(lgText('保存失败，请重试。', 'Saving failed. Please try again.'));
      return false;
    }

    showSavedToast(managers, myId, mids.length, before, openSaved);
    return true;
  }

  // * the batches' own line tells of the progress and of the end
  const state = await runBatches('save', mids, (batch) => forward(batch).then(() => {}));
  if(state.done) showSavedToast(managers, myId, state.done, before, openSaved);
  return state.status === 'done';
}
