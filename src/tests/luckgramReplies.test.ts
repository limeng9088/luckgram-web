// * Luckgram Web (luckgram-specs#190, W11b): quick replies — the templates' rules and their store

import {LuckgramMemoryStorage} from '@/luckgram/core/storage';
import {
  MAX_REPLIES, MAX_REPLY_LENGTH, PRESETS, QuickReply, RepliesState, addReply, checkReply, editReply, getReplyPreview, matchSlash, moveReply, normalizeReply,
  removeReply, reorderReplies, sanitizeState, seedReplies
} from '@/luckgram/replies/logic';
import {RepliesStore} from '@/luckgram/replies/store';

const ids = () => {
  let n = 0;
  return () => 'id' + (++n);
};

const list = (...texts: string[]): QuickReply[] => texts.map((text, i) => ({id: 'x' + i, text}));
const texts = (state: RepliesState) => state.items.map((item) => item.text);

describe('luckgram quick replies: the templates', () => {
  test('a first use starts with the four examples, in the interface\'s language, once', () => {
    const zh = seedReplies(undefined, true, ids());
    expect(texts(zh)).toEqual(['在路上了！', '10 分钟后给你回电话可以吗？', '谢谢，收到。', '抱歉，要晚 5 分钟！']);
    expect(zh.seeded).toBe(true);
    expect(texts(seedReplies(undefined, false, ids()))).toEqual(PRESETS.map((preset) => preset[1]));
    // * deleted examples do not come back
    const emptied = {items: [] as QuickReply[], seeded: true};
    expect(seedReplies(emptied, true, ids())).toBe(emptied);
  });

  test('1 to 1000 characters as a reader counts them, 100 templates, no two alike', () => {
    expect(checkReply('   ', [], true)).toBe('empty');
    expect(checkReply('字'.repeat(MAX_REPLY_LENGTH), [], true)).toBeUndefined();
    expect(checkReply('字'.repeat(MAX_REPLY_LENGTH + 1), [], true)).toBe('too_long');
    expect(checkReply('👨‍👩‍👧'.repeat(MAX_REPLY_LENGTH), [], true)).toBeUndefined();
    const full = list(...Array.from({length: MAX_REPLIES}, (_, i) => 't' + i));
    expect(checkReply('one more', full, true)).toBe('limit');
    expect(checkReply('edited', full.slice(1), false)).toBeUndefined();
    expect(checkReply(' t5 ', full, false)).toBe('duplicate');
  });

  test('added at the end, edited in place, removed, moved', () => {
    const makeId = ids();
    let state: RepliesState = {items: [], seeded: true};
    state = addReply(state, ' a ', makeId);
    state = addReply(state, 'b\r\nb', makeId);
    state = addReply(state, 'c', makeId);
    expect(state.items).toEqual([{id: 'id1', text: 'a'}, {id: 'id2', text: 'b\nb'}, {id: 'id3', text: 'c'}]);
    expect(addReply(state, 'a', makeId)).toBe(state);
    state = editReply(state, 'id2', 'B');
    expect(texts(state)).toEqual(['a', 'B', 'c']);
    expect(editReply(state, 'id2', 'c')).toBe(state);
    expect(editReply(state, 'nope', 'z')).toBe(state);
    expect(texts(moveReply(state, 'id3', 0))).toEqual(['c', 'a', 'B']);
    expect(texts(moveReply(state, 'id1', 99))).toEqual(['B', 'c', 'a']);
    expect(texts(reorderReplies(state, ['id3', 'ghost', 'id1']))).toEqual(['c', 'a', 'B']);
    expect(texts(removeReply(state, 'id1'))).toEqual(['B', 'c']);
  });

  test('"/…" at the field\'s start asks for the templates that begin so', () => {
    const items = list('在路上了！', '在开会，稍后回复', 'Thanks, got it.', '谢谢，收到。');
    expect(matchSlash('/在', items).map((item) => item.text)).toEqual(['在路上了！', '在开会，稍后回复']);
    expect(matchSlash('/THANKS', items).map((item) => item.text)).toEqual(['Thanks, got it.']);
    expect(matchSlash('/', items).length).toBe(4);
    expect(matchSlash('/没有', items)).toBeUndefined();
    expect(matchSlash('在', items)).toBeUndefined();
    expect(matchSlash(' /在', items)).toBeUndefined();
    expect(matchSlash('/在\n', items)).toBeUndefined();
    expect(matchSlash('/', [])).toBeUndefined();
  });

  test('a list shows one line of each', () => {
    expect(getReplyPreview('first\n  second')).toBe('first second');
    expect(getReplyPreview('字'.repeat(100), 10)).toBe('字'.repeat(10) + '…');
    expect(normalizeReply(undefined)).toBe('');
  });

  test('what was stored is read with care', () => {
    expect(sanitizeState(undefined)).toBeUndefined();
    expect(sanitizeState({items: 'x'})).toBeUndefined();
    expect(sanitizeState({seeded: 1, items: [{id: 'a', text: ' ok '}, {id: 'a', text: 'same id'}, {id: 5, text: 'bad id'}, {id: 'b', text: ''}, null]})).toEqual({
      items: [{id: 'a', text: 'ok'}], seeded: true
    });
  });
});

describe('luckgram quick replies: the store', () => {
  const make = async(storage = new LuckgramMemoryStorage(), chinese = true) => {
    const store = new RepliesStore(storage, () => chinese);
    await store.ready;
    return {store, storage};
  };

  test('each account has its own; the examples come with the first look and are kept', async() => {
    const {store, storage} = await make();
    expect(store.list(1).length).toBe(4);
    expect(store.add(1, '新的一条')).toBeUndefined();
    expect(store.list(1).length).toBe(5);
    expect(store.list(2).length).toBe(4);
    expect(Object.keys(await storage.getAll('replies')).sort()).toEqual(['r:1', 'r:2']);

    const again = new RepliesStore(storage);
    await again.ready;
    expect(again.list(1).map((item) => item.text).pop()).toBe('新的一条');
  });

  test('deleted examples stay deleted across a reload', async() => {
    const {store, storage} = await make();
    for(const item of store.list(1).slice()) await store.remove(1, item.id);
    expect(store.list(1)).toEqual([]);
    const again = new RepliesStore(storage);
    await again.ready;
    expect(again.list(1)).toEqual([]);
  });

  test('the 101st is refused and says why; an edit and a move are kept', async() => {
    const {store, storage} = await make();
    for(let i = 4; i < MAX_REPLIES; ++i) expect(store.add(1, 'reply ' + i)).toBeUndefined();
    expect(store.add(1, 'one too many')).toBe('limit');
    expect(store.list(1).length).toBe(MAX_REPLIES);
    const first = store.list(1)[0];
    expect(store.edit(1, first.id, '改过的')).toBeUndefined();
    expect(store.edit(1, first.id, '  ')).toBe('empty');
    await store.move(1, first.id, 2);
    expect(store.list(1)[2].text).toBe('改过的');
    expect((await storage.getAll('replies'))['r:1'].items[2].text).toBe('改过的');
  });

  test('listeners hear of changes; an account that leaves takes its templates', async() => {
    const {store, storage} = await make();
    let heard = 0;
    const stop = store.subscribe(() => ++heard);
    store.list(1);
    store.add(1, 'a');
    await store.reorder(1, store.list(1).map((item) => item.id).reverse());
    expect(heard).toBe(2);
    stop();
    store.list(2);
    store.list(3);
    await store.deleteAccount(1);
    await store.cleanOrphans([3]);
    expect(Object.keys(await storage.getAll('replies'))).toEqual(['r:3']);
    expect(heard).toBe(2);
  });

  test('an English interface gets the English examples', async() => {
    const {store} = await make(new LuckgramMemoryStorage(), false);
    expect(store.list(1)[0].text).toBe('On my way!');
  });
});
