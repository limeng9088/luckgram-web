// * Luckgram Web (luckgram-specs#191, W12): keyword folders — the rules, and the last line before Telegram

import {LOCAL_FOLDER_ID_START, guardFolderRequest, isLocalFolderId} from '@/luckgram/folders/guard';
import {
  FoldersState, MAX_FOLDERS, addFolder, checkFolder, editFolder, findHit, isInScope, makeMatcher, nextFolderId, normalizeKeywords, normalizeScopes,
  removeFolder, reorderFolders, sanitizeFolders, splitFolderOrder
} from '@/luckgram/folders/logic';

const L = LOCAL_FOLDER_ID_START;

describe('luckgram keyword folders: no request carries a local folder\'s id', () => {
  test('Telegram\'s ids are not the local ones', () => {
    for(const id of [0, 1, 2, 255, 99999]) expect(isLocalFolderId(id)).toBe(false);
    for(const id of [L, L + 1, L + 500]) expect(isLocalFolderId(id)).toBe(true);
    for(const id of [undefined, null, '100000', NaN]) expect(isLocalFolderId(id)).toBe(false);
  });

  test('an order of folders is sent without them, the rest as it was', () => {
    const result = guardFolderRequest('messages.updateDialogFiltersOrder', {order: [0, 5, L, 2, L + 3, 9], other: 1});
    expect(result).toEqual({action: 'strip', params: {order: [0, 5, 2, 9], other: 1}, removed: [L, L + 3]});
    expect(guardFolderRequest('messages.updateDialogFiltersOrder', {order: [0, 5, 2]})).toEqual({action: 'pass'});
    expect(guardFolderRequest('messages.updateDialogFiltersOrder', {})).toEqual({action: 'pass'});
  });

  test('a change or a removal of one such folder is not sent at all', () => {
    expect(guardFolderRequest('messages.updateDialogFilter', {id: L + 1, filter: {id: L + 1}})).toEqual({action: 'block', id: L + 1});
    expect(guardFolderRequest('messages.updateDialogFilter', {id: L})).toEqual({action: 'block', id: L});
    // * an id that says one thing and a folder that says another: still not sent
    expect(guardFolderRequest('messages.updateDialogFilter', {id: 7, filter: {id: L}})).toEqual({action: 'block', id: L});
    expect(guardFolderRequest('messages.updateDialogFilter', {id: 7, filter: {id: 7}})).toEqual({action: 'pass'});
    expect(guardFolderRequest('messages.updateDialogFilter', {id: 7})).toEqual({action: 'pass'});
  });

  test('nor anything else that names one: shared folders\' links, a method to come', () => {
    expect(guardFolderRequest('chatlists.exportChatlistInvite', {chatlist: {_: 'inputChatlistDialogFilter', filter_id: L}})).toEqual({action: 'block', id: L});
    expect(guardFolderRequest('chatlists.getChatlistUpdates', {chatlist: {filter_id: 3}})).toEqual({action: 'pass'});
    expect(guardFolderRequest('messages.someFutureMethod', {filter_id: L + 2})).toEqual({action: 'block', id: L + 2});
  });

  test('what has nothing to do with folders passes untouched — a chat\'s id may be any number', () => {
    expect(guardFolderRequest('messages.getHistory', {peer: {user_id: 5000000}, offset_id: 123456, limit: 100})).toEqual({action: 'pass'});
    expect(guardFolderRequest('messages.sendMessage', {id: 9999999, message: 'x'})).toEqual({action: 'pass'});
    expect(guardFolderRequest('messages.getDialogs', {folder_id: 1})).toEqual({action: 'pass'});
    expect(guardFolderRequest('help.getConfig', undefined)).toEqual({action: 'pass'});
  });
});

describe('luckgram keyword folders: a folder\'s definition', () => {
  const ok = {title: '发票', keywords: ['发票', 'invoice']};

  test('a name, 1 to 10 keywords, 10 folders', () => {
    expect(checkFolder(ok)).toBeUndefined();
    expect(checkFolder({...ok, title: '  '})).toBe('no_title');
    expect(checkFolder({...ok, title: '字'.repeat(13)})).toBe('title_too_long');
    expect(checkFolder({...ok, keywords: [' ', '']})).toBe('no_keywords');
    expect(checkFolder({...ok, keywords: Array.from({length: 11}, (_, i) => 'k' + i)})).toBe('too_many_keywords');
    expect(checkFolder({...ok, keywords: ['x'.repeat(31)]})).toBe('keyword_too_long');
    expect(checkFolder(ok, MAX_FOLDERS)).toBe('limit');
    expect(checkFolder(ok, MAX_FOLDERS - 1)).toBeUndefined();
  });

  test('keywords without doubles, letter case aside; no scope chosen is every scope', () => {
    expect(normalizeKeywords([' Invoice ', 'invoice', '', '发 票', undefined])).toEqual(['Invoice', '发 票']);
    expect(normalizeScopes([])).toEqual(['private', 'groups', 'channels']);
    expect(normalizeScopes(['channels', 'private'])).toEqual(['private', 'channels']);
  });

  test('added with an id of the local range, edited, removed, put in order', () => {
    let state: FoldersState = {folders: []};
    state = addFolder(state, ok);
    state = addFolder(state, {title: 'Work', keywords: ['deadline'], scopes: ['groups']});
    expect(state.folders.map((folder) => folder.id)).toEqual([L, L + 1]);
    expect(state.folders[1].scopes).toEqual(['groups']);
    expect(addFolder(state, {title: '', keywords: ['x']})).toBe(state);

    state = editFolder(state, L, {title: '票据', keywords: ['发票', '收据']});
    expect(state.folders[0]).toEqual({id: L, title: '票据', keywords: ['发票', '收据'], scopes: ['private', 'groups', 'channels']});
    expect(editFolder(state, L + 9, ok)).toBe(state);

    expect(reorderFolders(state, [L + 1, 7, L]).folders.map((folder) => folder.id)).toEqual([L + 1, L]);
    state = removeFolder(state, L);
    // * a freed id is taken again; never one of Telegram's
    expect(nextFolderId(state.folders)).toBe(L);
  });

  test('the 11th is refused', () => {
    let state: FoldersState = {folders: []};
    for(let i = 0; i < MAX_FOLDERS; ++i) state = addFolder(state, {title: 'f' + i, keywords: ['k']});
    expect(state.folders.length).toBe(MAX_FOLDERS);
    expect(addFolder(state, ok)).toBe(state);
  });

  test('what was stored is read with care: Telegram\'s ids, doubles and broken ones are dropped', () => {
    expect(sanitizeFolders(undefined)).toEqual({folders: []});
    expect(sanitizeFolders({folders: [
      {id: L, title: 'a', keywords: ['x']},
      {id: L, title: 'same id', keywords: ['x']},
      {id: 5, title: 'a cloud id', keywords: ['x']},
      {id: L + 1, title: '', keywords: ['x']},
      {id: L + 2, title: 'b', keywords: []},
      null
    ]}).folders.map((folder) => folder.id)).toEqual([L]);
  });
});

describe('luckgram keyword folders: where they stand', () => {
  test('after all of Telegram\'s, in their own order — never among them', () => {
    expect(splitFolderOrder([0, 1, 5, 2], [L + 1, L])).toEqual({cloud: [0, 1, 5, 2], local: [L + 1, L], all: [0, 1, 5, 2, L + 1, L]});
  });

  test('a drag that put one among Telegram\'s changes only the keyword folders\' own order', () => {
    const result = splitFolderOrder([0, L, 5, L + 1, 2], [L + 1, L]);
    expect(result.cloud).toEqual([0, 5, 2]);
    expect(result.local).toEqual([L, L + 1]);
    expect(result.all).toEqual([0, 5, 2, L, L + 1]);
  });

  test('what Telegram is told never has a local id, whatever comes in', () => {
    for(const order of [[L], [L, L + 1, 3], [3, L + 7], []]) {
      expect(splitFolderOrder(order, [L, L + 1]).cloud.some(isLocalFolderId)).toBe(false);
    }

    // * an id of the local range that is no folder of ours is not kept either
    expect(splitFolderOrder([3, L + 7], [L]).all).toEqual([3, L]);
  });
});

describe('luckgram keyword folders: which chats', () => {
  test('Chinese is found anywhere; other words whole, letter case aside', () => {
    const matcher = makeMatcher(['发票', 'invoice', 'due date']);
    expect(matcher.find('请把发票发我')).toBe('发票');
    expect(matcher.find('Your INVOICE is ready')).toBe('invoice');
    expect(matcher.find('the invoices are late')).toBeUndefined();
    expect(matcher.find('pre-invoice, sent')).toBe('invoice');
    expect(matcher.find('reinvoice')).toBeUndefined();
    expect(matcher.find('the due   date is Monday')).toBe('due date');
    expect(matcher.find('nothing here')).toBeUndefined();
    expect(matcher.find(undefined)).toBeUndefined();
    expect(makeMatcher([]).find('anything')).toBeUndefined();
  });

  test('characters that mean something in a pattern are plain text', () => {
    const matcher = makeMatcher(['c++', '$100', '(urgent)']);
    expect(matcher.find('I know c++ well')).toBe('c++');
    expect(matcher.find('pay $100 now')).toBe('$100');
    expect(matcher.find('it is (urgent)!')).toBe('(urgent)');
    expect(matcher.find('ccc')).toBeUndefined();
  });

  test('every place a keyword stands at, for the highlight', () => {
    const matcher = makeMatcher(['发票', 'invoice']);
    expect(matcher.findAll('发票 invoice 发票')).toEqual([
      {start: 0, end: 2, keyword: '发票'}, {start: 3, end: 10, keyword: 'invoice'}, {start: 11, end: 13, keyword: '发票'}
    ]);
    expect(matcher.findAll('none')).toEqual([]);
  });

  test('the scopes: private chats (bots too), groups, channels; archived chats never', () => {
    expect(isInScope({scopes: ['private']}, {kind: 'private', archived: false})).toBe(true);
    expect(isInScope({scopes: ['private']}, {kind: 'group', archived: false})).toBe(false);
    expect(isInScope({scopes: ['groups', 'channels']}, {kind: 'channel', archived: false})).toBe(true);
    expect(isInScope({scopes: []}, {kind: 'group', archived: false})).toBe(true);
    expect(isInScope({scopes: []}, {kind: 'group', archived: true})).toBe(false);
  });

  test('the latest message first, 50 of them at most', () => {
    const matcher = makeMatcher(['发票']);
    expect(findHit(matcher, ['你好', undefined, '发票在这'])).toEqual({index: 2, keyword: '发票'});
    expect(findHit(matcher, ['发票', '发票'])).toEqual({index: 0, keyword: '发票'});
    expect(findHit(matcher, [])).toBeUndefined();
    const far = Array.from({length: 60}, (_, i) => i === 55 ? '发票' : 'x');
    expect(findHit(matcher, far)).toBeUndefined();
    far[49] = '发票';
    expect(findHit(matcher, far)).toEqual({index: 49, keyword: '发票'});
  });

  test('a long chat list is matched quickly', () => {
    const matcher = makeMatcher(['发票', 'invoice', 'deadline', '合同', 'payment']);
    const texts = Array.from({length: 50}, (_, i) => `message number ${i} with some ordinary words 普通的一句话 and nothing else`);
    const start = performance.now();
    for(let chat = 0; chat < 1000; ++chat) findHit(matcher, texts);
    // * 1000 chats of 50 messages each, none matching (the worst case): well under a frame budget's hundredfold
    expect(performance.now() - start).toBeLessThan(1500);
  });
});
