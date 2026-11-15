/*
 * Luckgram Web (luckgram-specs#192, W10 需求 4): what the log-out confirmation says of the
 * account's private notes — a sentence only when it has any.
 */

import {lgText} from '@/luckgram/text';
import {notesStore} from '@/luckgram/notes/instance';

export async function getLogoutNotesLine(account: number | string): Promise<string | undefined> {
  await notesStore.ready;
  return notesStore.count(account) ? lgText('本机的私人备注会被删除。', 'The private notes on this device will be deleted.') : undefined;
}
