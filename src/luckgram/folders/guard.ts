/*
 * Luckgram Web (luckgram-specs#191, W12 决定 2): the last line before Telegram — no request
 * carries the id of a keyword folder. Keyword folders live in upstream's folder storage with
 * ids of their own range, and upstream's code is kept from sending them in several places; this
 * is what holds when one of those places is missed: at the one exit every request leaves by
 * (apiManager.invokeApi), an order of folders loses such ids, and a request about one such
 * folder is not sent at all. Telegram's side cannot be changed by a local folder.
 *
 * No imports: it is loaded with the network code.
 */

/** Telegram's own folder ids are 2…255; keyword folders start here. */
export const LOCAL_FOLDER_ID_START = 100000;

export const isLocalFolderId = (id: unknown): boolean => typeof id === 'number' && id >= LOCAL_FOLDER_ID_START;

export type GuardResult =
  /** nothing of a local folder in it: sent as it is */
  {action: 'pass'} |
  /** sent without the local ids */
  {action: 'strip', params: any, removed: number[]} |
  /** about a local folder: not sent */
  {action: 'block', id: number};

export function guardFolderRequest(method: string, params: any): GuardResult {
  if(!params || typeof params !== 'object') return {action: 'pass'};

  if(method === 'messages.updateDialogFiltersOrder') {
    const order: unknown[] = Array.isArray(params.order) ? params.order : [];
    const removed = order.filter(isLocalFolderId) as number[];
    if(!removed.length) return {action: 'pass'};
    return {action: 'strip', params: {...params, order: order.filter((id) => !isLocalFolderId(id))}, removed};
  }

  if(method === 'messages.updateDialogFilter') {
    const id = isLocalFolderId(params.id) ? params.id : isLocalFolderId(params.filter?.id) ? params.filter.id : undefined;
    return id !== undefined ? {action: 'block', id} : {action: 'pass'};
  }

  // * whatever else names a folder: shared folders' links and updates (chatlists.*), and any method to come
  for(const id of [params.filter_id, params.chatlist?.filter_id, params.filter?.id]) {
    if(isLocalFolderId(id)) return {action: 'block', id: id as number};
  }

  return {action: 'pass'};
}

/** What a blocked request is rejected with: upstream's code takes it for a refusal and changes nothing. */
export const LOCAL_FOLDER_ERROR = 'LUCKGRAM_LOCAL_FOLDER';
