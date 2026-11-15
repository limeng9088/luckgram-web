// * Luckgram Web (luckgram-specs#191, W12a): keyword folders inside upstream's folder storage —
// * they stand after Telegram's folders, outlive a rebuild from the server, and never reach a request

import {describe, expect, test, vi} from 'vitest';
import FiltersStorage, {MyDialogFilter} from '@lib/storages/filters';
import {ApiManager} from '@appManagers/apiManager';
import {START_LOCAL_ID} from '@appManagers/constants';
import {LOCAL_FOLDER_ERROR, LOCAL_FOLDER_ID_START as L, isLocalFolderId} from '@/luckgram/folders/guard';
import type {KeywordFolder} from '@/luckgram/folders/logic';
import {KeywordFolderSet} from '@/luckgram/folders/set';

const cloudFilter = (id: number, title = 'Cloud ' + id): any => ({
  _: 'dialogFilter', id, title: {_: 'textWithEntities', text: title, entities: []}, pFlags: {},
  pinned_peers: [], include_peers: [], exclude_peers: [], pinnedPeerIds: [], includePeerIds: [], excludePeerIds: []
});

const keyword = (id: number, title: string, keywords: string[], scopes: any[] = []): KeywordFolder => ({id, title, keywords, scopes});
const INVOICES = keyword(L, '发票', ['发票', 'invoice']);
const WORK = keyword(L + 1, 'Work', ['deadline'], ['groups']);

/** The storage as it stands once the page is up: "All chats", the archive and Telegram's folders `cloudIds`. */
function makeStorage(cloudIds: number[] = [5, 7]) {
  const events: [string, any][] = [];
  const requests: [string, any][] = [];
  const states: any[][] = [];
  const messages = new Map<string, any>();
  const histories = new Map<number, number[]>();

  const storage: any = new (FiltersStorage as any)();
  storage.rootScope = {dispatchEvent: (name: string, value: any) => events.push([name, value]), addEventListener: () => {}};
  storage.appStateManager = {pushToState: (_key: string, value: any[]) => states.push(value.map((filter) => filter.id)), getState: async() => ({filtersArr: [] as any[]})};
  storage.apiManager = {
    invokeApi: vi.fn((method: string, params: any) => {
      requests.push([method, params]);
      return Promise.resolve(true);
    }),
    invokeApiSingle: vi.fn(),
    getLimit: async() => 5
  };
  storage.appPeersManager = {getPeerId: (peer: any) => peer.user_id, isBroadcast: (peerId: number) => peerId < -1000, getInputPeerById: (peerId: number) => ({user_id: peerId})};
  storage.appMessagesManager = {
    getDialogOnly: () => ({}),
    getHistoryStorage: (peerId: number) => ({history: {first: histories.get(peerId) || []}}),
    getMessageByPeer: (peerId: number, mid: number) => messages.get(peerId + '_' + mid)
  };
  storage.dialogsStorage = {getPinnedOrders: (): number[] => []};
  storage.apiUpdatesManager = {addMultipleEventsListeners: () => {}};

  storage.clear(true);
  for(const filter of storage.prependFilters(cloudIds.map((id) => cloudFilter(id)))) storage.saveDialogFilter(filter, false, true);
  events.length = states.length = 0;

  const order = () => Object.values(storage.filters as {[id: string]: MyDialogFilter}).sort((a, b) => a.localId - b.localId).map((filter) => filter.id);
  const say = (peerId: number, mid: number, text: string) => messages.set(peerId + '_' + mid, {_: 'message', mid, message: text});
  return {storage, events, requests, states, order, say, histories};
}

const names = (events: [string, any][]) => events.map(([name, value]) => name + ':' + (Array.isArray(value) ? value.join(',') : value.id));

describe('luckgram keyword folders in the folder storage', () => {
  test('put after Telegram\'s folders, in their own order; the chat list hears of each', () => {
    const {storage, events, order, states} = makeStorage();
    expect(order()).toEqual([0, 1, 5, 7]);
    expect(storage.luckgramSetKeywordFolders([INVOICES, WORK])).toEqual([L, L + 1]);
    expect(order()).toEqual([0, 1, 5, 7, L, L + 1]);
    expect(names(events)).toEqual([`filter_new:${L}`, `filter_new:${L + 1}`, `filter_order:0,1,5,7,${L},${L + 1}`]);
    expect(storage.filters[L].title.text).toBe('发票');
    // * what upstream keeps of folders never has them
    expect(states.length).toBeGreaterThan(0);
    expect(states.flat().some(isLocalFolderId)).toBe(false);
  });

  test('changed, reordered among themselves, removed', () => {
    const {storage, events, order} = makeStorage();
    storage.luckgramSetKeywordFolders([INVOICES, WORK]);
    events.length = 0;

    storage.luckgramSetKeywordFolders([{...INVOICES, title: '票据'}, WORK]);
    expect(names(events)).toEqual([`filter_update:${L}`]);
    expect(storage.filters[L].title.text).toBe('票据');

    events.length = 0;
    storage.luckgramSetKeywordFolders([WORK, {...INVOICES, title: '票据'}]);
    expect(names(events)).toEqual([`filter_order:0,1,5,7,${L + 1},${L}`]);
    expect(order()).toEqual([0, 1, 5, 7, L + 1, L]);

    events.length = 0;
    storage.luckgramSetKeywordFolders([]);
    expect(names(events).slice(0, 2).sort()).toEqual([`filter_delete:${L}`, `filter_delete:${L + 1}`]);
    expect(order()).toEqual([0, 1, 5, 7]);
    expect(Object.keys(storage.filters).some((id) => isLocalFolderId(+id))).toBe(false);
  });

  test('the same list again changes nothing and tells nobody', () => {
    const {storage, events} = makeStorage();
    storage.luckgramSetKeywordFolders([INVOICES]);
    events.length = 0;
    storage.luckgramSetKeywordFolders([{...INVOICES}]);
    expect(events).toEqual([]);
  });

  test('Telegram is told the order of its own folders alone, however the order is given', async() => {
    const {storage, requests, order} = makeStorage();
    storage.luckgramSetKeywordFolders([INVOICES, WORK]);
    await storage.updateDialogFiltersOrder([0, 7, L, 5, L + 1]);
    expect(requests).toEqual([['messages.updateDialogFiltersOrder', {order: [0, 7, 5]}]]);
    // * Telegram's folders took the new order; the keyword folders stay after them
    expect(order()).toEqual([0, 1, 7, 5, L, L + 1]);
  });

  test('a new folder of Telegram\'s takes an id among Telegram\'s', async() => {
    const {storage, requests} = makeStorage();
    storage.luckgramSetKeywordFolders([INVOICES, WORK]);
    const created = await storage.createDialogFilter(cloudFilter(0, 'New'));
    expect(created.id).toBe(8);
    expect(requests[0][0]).toBe('messages.updateDialogFilter');
    expect(requests[0][1].id).toBe(8);
  });

  test('an edit, a removal or a pin of a keyword folder is refused before any request', async() => {
    const {storage, requests} = makeStorage();
    storage.luckgramSetKeywordFolders([INVOICES]);
    const filter = storage.filters[L];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(storage.updateDialogFilter(filter)).rejects.toMatchObject({type: LOCAL_FOLDER_ERROR});
    await expect(storage.updateDialogFilter(filter, true)).rejects.toMatchObject({type: LOCAL_FOLDER_ERROR});
    await expect(storage.toggleDialogsPin(L, [42], true)).rejects.toMatchObject({type: LOCAL_FOLDER_ERROR});
    await expect(storage.toggleDialogPin(42, L)).rejects.toMatchObject({type: LOCAL_FOLDER_ERROR});
    warn.mockRestore();
    expect(requests).toEqual([]);
    expect(storage.filters[L].pinnedPeerIds).toEqual([]);
  });

  test('they are not what is compared with the server: the same folders there is "nothing changed"', () => {
    const {storage} = makeStorage();
    storage.luckgramSetKeywordFolders([INVOICES, WORK]);
    expect(storage.isKeptAsServer([{_: 'dialogFilterDefault'}, cloudFilter(5), cloudFilter(7)])).toBe(true);
    expect(storage.isKeptAsServer([{_: 'dialogFilterDefault'}, cloudFilter(7), cloudFilter(5)])).toBe(false);
  });

  test('rebuilt from the server\'s answer (another device changed the folders): Telegram\'s are the server\'s, the keyword folders are still there, after them', async() => {
    const {storage, order, events, requests} = makeStorage();
    storage.luckgramSetKeywordFolders([INVOICES, WORK]);
    events.length = 0;

    // * elsewhere: folder 5 removed, 9 made, 7 put last
    await storage.reloadDialogFilters({_: 'messages.dialogFilters', pFlags: {}, filters: [{_: 'dialogFilterDefault'}, cloudFilter(9), cloudFilter(7)]});
    expect(order()).toEqual([0, 1, 9, 7, L, L + 1]);
    expect(storage.filters[5]).toBeUndefined();
    expect(storage.filters[L].luckgramKeywords.keywords).toEqual(['发票', 'invoice']);
    expect(names(events).filter((name) => name.startsWith('filter_delete'))).toEqual(['filter_delete:5']);
    expect(names(events).pop()).toBe(`filter_order:0,1,9,7,${L},${L + 1}`);
    // * and nothing was sent for it
    expect(requests).toEqual([]);
  });

  test('an order from the server reorders Telegram\'s folders; one naming a folder not had asks for them all again', () => {
    const {storage, order} = makeStorage();
    storage.luckgramSetKeywordFolders([INVOICES]);
    storage.onUpdateDialogFilterOrder({_: 'updateDialogFilterOrder', order: [0, 7, 5]});
    expect(order()).toEqual([0, 1, 7, 5, L]);

    const reload = vi.fn();
    storage.onUpdateDialogFilters = reload;
    storage.onUpdateDialogFilterOrder({_: 'updateDialogFilterOrder', order: [0, 7, 5, 33]});
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('a folder made on another device comes while the page is open: it stands before the keyword folders at once (specs#191)', () => {
    const {storage, events, order, states} = makeStorage();
    storage.luckgramSetKeywordFolders([INVOICES, WORK]);
    events.length = states.length = 0;

    // * `updateDialogFilter` of a folder this client did not have
    storage.saveDialogFilter(cloudFilter(9), true);
    expect(order()).toEqual([0, 1, 5, 7, 9, L, L + 1]);
    // * the chat list hears of the new folder, then of the places — the keyword folders' tabs move after it
    // * (as an update, which is how one made elsewhere arrives; the chat list makes its tab for either)
    expect(names(events)).toEqual(['filter_update:9', `filter_order:0,1,5,7,9,${L},${L + 1}`]);
    // * what upstream keeps of folders still never has a keyword folder
    expect(states.flat().some(isLocalFolderId)).toBe(false);

    // * a second one, and a change of one that is there: no reordering to tell of for the change
    storage.saveDialogFilter(cloudFilter(11), true);
    expect(order()).toEqual([0, 1, 5, 7, 9, 11, L, L + 1]);
    events.length = 0;
    storage.saveDialogFilter({...cloudFilter(9), title: {_: 'textWithEntities', text: 'renamed', entities: []}}, true);
    expect(order()).toEqual([0, 1, 5, 7, 9, 11, L, L + 1]);
    expect(names(events)).toEqual(['filter_update:9']);

    // * without keyword folders nothing is said beyond upstream's own
    const plain = makeStorage();
    plain.storage.saveDialogFilter(cloudFilter(9), true);
    expect(names(plain.events)).toEqual(['filter_update:9']);
  });

  test('all folders cleared (the account leaving): the same list given again puts them back', () => {
    const {storage, order} = makeStorage();
    storage.luckgramSetKeywordFolders([INVOICES]);
    storage.clearFilters();
    expect(Object.keys(storage.filters).map(Number).sort()).toEqual([0, 1]);
    storage.luckgramSetKeywordFolders([INVOICES]);
    expect(order()).toEqual([0, 1, L]);
  });

  test('a keyword folder found in the state upstream keeps is not taken for one of Telegram\'s', async() => {
    const {storage} = makeStorage([]);
    storage.appStateManager.getState = async() => ({filtersArr: [cloudFilter(5), cloudFilter(L, 'stray')]});
    storage.rootScope.addEventListener = () => {};
    await storage.after();
    expect(Object.keys(storage.filters).map(Number).sort((a, b) => a - b)).toEqual([0, 1, 5]);
    expect(START_LOCAL_ID).toBeGreaterThan(1);
  });
});

describe('luckgram keyword folders: the chats one holds', () => {
  const dialog = (peerId: number, top: number, folderId = 0): any => ({_: 'dialog', peerId, top_message: top, folder_id: folderId});

  test('a chat whose latest message, or one of those kept, has a keyword', () => {
    const {storage, say, histories} = makeStorage();
    storage.luckgramSetKeywordFolders([INVOICES]);
    const filter = storage.filters[L];

    say(10, 3, '请把发票发我');
    expect(storage.testDialogForFilter(dialog(10, 3), filter)).toBe(true);

    say(11, 9, 'hello');
    say(11, 8, 'Your INVOICE is ready');
    histories.set(11, [9, 8]);
    expect(storage.testDialogForFilter(dialog(11, 9), filter)).toBe(true);
    expect(storage.luckgramGetKeywordHit(L, 11)).toEqual({index: 1, keyword: 'invoice'});

    say(12, 5, 'the invoices are late');
    expect(storage.testDialogForFilter(dialog(12, 5), filter)).toBe(false);
  });

  test('a new message is looked at; the same latest message is not read twice', () => {
    const {storage, say} = makeStorage();
    storage.luckgramSetKeywordFolders([INVOICES]);
    const filter = storage.filters[L];
    const read = vi.spyOn(storage.appMessagesManager, 'getMessageByPeer');

    say(10, 3, 'hello');
    expect(storage.testDialogForFilter(dialog(10, 3), filter)).toBe(false);
    expect(storage.testDialogForFilter(dialog(10, 3), filter)).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);

    say(10, 4, '发票来了');
    expect(storage.testDialogForFilter(dialog(10, 4), filter)).toBe(true);
  });

  test('the folder\'s scopes; archived chats never; other folders as before', () => {
    const {storage, say} = makeStorage();
    storage.luckgramSetKeywordFolders([INVOICES, WORK]);
    say(10, 1, 'deadline tomorrow');
    say(-20, 1, 'deadline tomorrow');
    say(-2000, 1, 'deadline tomorrow');
    const work = storage.filters[L + 1];
    expect(storage.testDialogForFilter(dialog(10, 1), work)).toBe(false);
    expect(storage.testDialogForFilter(dialog(-20, 1), work)).toBe(true);
    expect(storage.testDialogForFilter(dialog(-2000, 1), work)).toBe(false);
    expect(storage.testDialogForFilter(dialog(-20, 1, 1), work)).toBe(false);

    say(30, 1, '发票');
    expect(storage.testDialogForFilter(dialog(30, 1, 1), storage.filters[L])).toBe(false);
    // * a changed definition forgets what the old one found
    storage.luckgramSetKeywordFolders([INVOICES, {...WORK, scopes: []}]);
    expect(storage.testDialogForFilter(dialog(10, 1), storage.filters[L + 1])).toBe(true);
  });

  test('the set alone: what it is asked with is all it knows of a chat', () => {
    const set = new KeywordFolderSet();
    set.set([INVOICES]);
    const getTexts = vi.fn(() => ['发票']);
    expect(set.test(L, {peerId: 1, kind: 'private', archived: false, top: 1, getTexts})).toBe(true);
    expect(set.test(L + 5, {peerId: 1, kind: 'private', archived: false, top: 1, getTexts})).toBe(false);
    set.forget(1);
    expect(set.test(L, {peerId: 1, kind: 'private', archived: false, top: 1, getTexts})).toBe(true);
    expect(getTexts).toHaveBeenCalledTimes(2);
  });
});

describe('luckgram keyword folders: the last line, at the exit every request leaves by', () => {
  test('a request about a keyword folder is refused there, before anything else is done', async() => {
    const api: any = Object.create(ApiManager.prototype);
    api.log = {warn: vi.fn(), error: vi.fn()};
    await expect(api.invokeApi('messages.updateDialogFilter', {id: L})).rejects.toMatchObject({type: LOCAL_FOLDER_ERROR});
    await expect(api.invokeApi('chatlists.exportChatlistInvite', {chatlist: {filter_id: L + 1}})).rejects.toMatchObject({type: LOCAL_FOLDER_ERROR});
    expect(api.log.warn).toHaveBeenCalledTimes(2);
  });
});
