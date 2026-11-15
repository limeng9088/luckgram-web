// * Luckgram Web (luckgram-specs#192, W10): the profile's ID and registration rows; private notes' rules

import {displayId, estimateRegistration, formatEstimate, parseTable, userLink} from '@/luckgram/profile/logic';
import registrationDates from '@/luckgram/profile/registrationDates';
import {LuckgramMemoryStorage} from '@/luckgram/core/storage';
import {NotesStore} from '@/luckgram/notes/store';
import {
  FILE_VERSION, MAX_LENGTH, Note, buildNotesFile, countCharacters, firstLine, noteKey, accountOfNoteKey, normalizeNote, parseNotesFile, planImport,
  remainingCharacters, searchNotes, sortNotes
} from '@/luckgram/notes/logic';

describe('luckgram profile: the ID', () => {
  test('users as is, legacy groups -id, supergroups and channels -100id', () => {
    expect(displayId('user', 777000)).toBe('777000');
    expect(displayId('chat', 12345)).toBe('-12345');
    expect(displayId('channel', 1234567890)).toBe('-1001234567890');
    // * upstream's peer ids of chats are negative already
    expect(displayId('channel', -1234567890)).toBe('-1001234567890');
    expect(displayId('chat', '-12345')).toBe('-12345');
  });

  test('only a user has a link', () => {
    expect(userLink('user', 777000)).toBe('tg://user?id=777000');
    expect(userLink('channel', 1)).toBeUndefined();
    expect(userLink('chat', 1)).toBeUndefined();
  });
});

describe('luckgram profile: the registration month', () => {
  const table = parseTable(registrationDates);

  test('the table is the phones\': every row read, in order', () => {
    expect(table.length).toBe(50);
    expect(table[0]).toEqual({id: 2768409, monthIndex: 2013 * 12 + 10});
    expect(table[table.length - 1]).toEqual({id: 8700161147, monthIndex: 2026 * 12});
    for(let i = 1; i < table.length; ++i) {
      expect(table[i].id).toBeGreaterThan(table[i - 1].id);
      expect(table[i].monthIndex).toBeGreaterThanOrEqual(table[i - 1].monthIndex);
    }
  });

  test('malformed lines and lines out of order are left out', () => {
    expect(parseTable('# c\n\n10,2014-01\nx,2014-02\n5,2014-03\n20,2013-12\n30,2014-13\n40,2014-04')).toEqual([
      {id: 10, monthIndex: 2014 * 12}, {id: 40, monthIndex: 2014 * 12 + 3}
    ]);
    expect(parseTable(undefined)).toEqual([]);
  });

  test('between two rows: a straight line, rounded down', () => {
    const points = parseTable('100,2019-01\n200,2019-07');
    expect(estimateRegistration(points, 100)).toEqual({year: 2019, month: 1});
    expect(estimateRegistration(points, 150)).toEqual({year: 2019, month: 4});
    expect(estimateRegistration(points, 199)).toEqual({year: 2019, month: 6});
  });

  test('under the first row: before 2014; over the last, or without a table: nothing', () => {
    expect(estimateRegistration(table, 1000)).toEqual({before2014: true});
    expect(estimateRegistration(table, 2768409)).toEqual({before2014: true}); // 2013-11
    expect(estimateRegistration(table, 9000000000)).toBeUndefined();
    expect(estimateRegistration(table, 8700161147)).toBeUndefined();
    expect(estimateRegistration([], 5)).toBeUndefined();
    expect(estimateRegistration(table, 0)).toBeUndefined();
    expect(estimateRegistration(table, -5)).toBeUndefined();
  });

  test('known rows give their own month; the words say "about"', () => {
    expect(estimateRegistration(table, 487519953)).toEqual({year: 2018, month: 1});
    expect(formatEstimate({year: 2019, month: 10})).toEqual(['约 2019 年 10 月', 'about Oct 2019']);
    expect(formatEstimate({before2014: true})).toEqual(['早于 2014 年', 'before 2014']);
    expect(formatEstimate(undefined)).toBeUndefined();
  });
});

const note = (id: number, text: string, updatedAt = 100, type: Note['peer']['type'] = 'user'): Note => ({account: '1', peer: {type, id}, text, updatedAt});

describe('luckgram notes: the text', () => {
  test('trimmed, line ends plain, cut at 2000 characters as a reader counts them', () => {
    expect(normalizeNote('  a\r\nb\r  ')).toBe('a\nb');
    expect(normalizeNote(undefined)).toBe('');
    expect(countCharacters(normalizeNote('字'.repeat(2500)))).toBe(MAX_LENGTH);
    const flags = '🇩🇪'.repeat(2100);
    const cut = normalizeNote(flags);
    expect(countCharacters(cut)).toBe(MAX_LENGTH);
    expect(cut.length).toBe(MAX_LENGTH * 4);
    expect(remainingCharacters('👨‍👩‍👧')).toBe(MAX_LENGTH - 1);
    expect(remainingCharacters('x'.repeat(2003))).toBe(-3);
  });

  test('the first line with anything in it is what the bar shows', () => {
    expect(firstLine('\n  \n 柏林设计周认识的。 \n欠我 40 欧元')).toBe('柏林设计周认识的。');
    expect(firstLine('')).toBe('');
  });

  test('a key is of an account and a peer', () => {
    expect(noteKey(42, {type: 'channel', id: 7})).toBe('n:42:channel:7');
    expect(accountOfNoteKey('n:42:channel:7')).toBe('42');
  });
});

describe('luckgram notes: the list', () => {
  const notes = [note(1, '柏林设计周认识的。欠我 40 欧元', 100), note(2, 'Plumber, cheap', 300), note(3, '家长群', 200, 'chat')];
  const names: {[id: number]: string} = {1: 'Noah', 2: 'Bob the Builder', 3: '三年二班'};
  const getName = (item: Note) => names[item.peer.id];

  test('the newest first', () => {
    expect(sortNotes(notes).map((item) => item.peer.id)).toEqual([2, 3, 1]);
  });

  test('searched by text and by name, every word, letter case aside', () => {
    expect(searchNotes(notes, '欧元', getName).map((item) => item.peer.id)).toEqual([1]);
    expect(searchNotes(notes, 'noah', getName).map((item) => item.peer.id)).toEqual([1]);
    expect(searchNotes(notes, 'BUILDER cheap', getName).map((item) => item.peer.id)).toEqual([2]);
    expect(searchNotes(notes, '三年', getName).map((item) => item.peer.id)).toEqual([3]);
    expect(searchNotes(notes, 'nobody', getName)).toEqual([]);
    expect(searchNotes(notes, '  ', getName)).toBe(notes);
  });
});

describe('luckgram notes: the file', () => {
  const notes = [note(1, 'one', 100), note(7, 'seven', 300, 'channel')];

  test('carries the format, its version, the account, the notes — and nothing else of them', () => {
    const file = buildNotesFile('42', [{...notes[0], expanded: true}, notes[1]], 1763164800500);
    expect(file).toEqual({
      format: 'luckgram-notes', version: FILE_VERSION, account: 42, exported_at: 1763164800,
      notes: [
        {peer: {type: 'channel', id: 7}, text: 'seven', updated_at: 300},
        {peer: {type: 'user', id: 1}, text: 'one', updated_at: 100}
      ]
    });
  });

  test('read back: the same notes', () => {
    const parsed = parseNotesFile(JSON.stringify(buildNotesFile(42, notes, 0)));
    expect(parsed.ok).toBe(true);
    if(!parsed.ok) return;
    expect(parsed.account).toBe(42);
    expect(parsed.skipped).toBe(0);
    expect(parsed.notes).toEqual([
      {peer: {type: 'channel', id: 7}, text: 'seven', updatedAt: 300},
      {peer: {type: 'user', id: 1}, text: 'one', updatedAt: 100}
    ]);
  });

  test('what is not a notes file, or is of a newer version, is refused whole', () => {
    expect(parseNotesFile('{nope')).toEqual({ok: false, reason: 'not_json'});
    expect(parseNotesFile('[]')).toEqual({ok: false, reason: 'not_notes'});
    expect(parseNotesFile('{"format":"other","version":1,"notes":[]}')).toEqual({ok: false, reason: 'not_notes'});
    expect(parseNotesFile('{"format":"luckgram-notes","notes":[]}')).toEqual({ok: false, reason: 'not_notes'});
    expect(parseNotesFile('{"format":"luckgram-notes","version":2,"notes":[]}')).toEqual({ok: false, reason: 'newer_version'});
  });

  test('bad entries are skipped, long texts cut, a peer told twice kept once (the newer)', () => {
    const parsed = parseNotesFile(JSON.stringify({format: 'luckgram-notes', version: 1, account: 'x', notes: [
      {peer: {type: 'user', id: 1}, text: 'old', updated_at: 10},
      {peer: {type: 'user', id: 1}, text: 'new', updated_at: 20},
      {peer: {type: 'bot', id: 2}, text: 'x'},
      {peer: {type: 'user', id: -3}, text: 'x'},
      {peer: {type: 'user', id: 4}, text: '   '},
      {peer: {type: 'user', id: 5}, text: 'y'.repeat(3000)},
      null
    ]}));
    expect(parsed.ok).toBe(true);
    if(!parsed.ok) return;
    expect(parsed.account).toBe(0);
    expect(parsed.skipped).toBe(5);
    expect(parsed.notes.map((item) => [item.peer.id, item.text.length, item.updatedAt])).toEqual([[1, 3, 20], [5, MAX_LENGTH, 0]]);
  });

  test('importing: new ones are added, a newer and different one replaces, the rest stay', () => {
    const plan = planImport(notes, [
      {peer: {type: 'user', id: 1}, text: 'one, later', updatedAt: 200},
      {peer: {type: 'channel', id: 7}, text: 'older', updatedAt: 50},
      {peer: {type: 'user', id: 7}, text: 'a user with the channel\'s number', updatedAt: 1},
      {peer: {type: 'chat', id: 9}, text: 'nine', updatedAt: 0}
    ]);
    expect([plan.added, plan.updated, plan.kept]).toEqual([2, 1, 1]);
    expect(plan.set.map((item) => item.peer.type + item.peer.id)).toEqual(['user1', 'user7', 'chat9']);
    // * the same text with a newer date changes nothing
    expect(planImport(notes, [{peer: {type: 'user', id: 1}, text: 'one', updatedAt: 999}]).kept).toBe(1);
  });
});

describe('luckgram notes: the store', () => {
  const user: Note['peer'] = {type: 'user', id: 5};
  const channel: Note['peer'] = {type: 'channel', id: 5};

  const make = async(storage = new LuckgramMemoryStorage(), now = {value: 1000000}) => {
    const store = new NotesStore(storage, () => now.value);
    await store.ready;
    return {store, storage, now};
  };

  test('kept by account and peer; a user and a channel of one number are two', async() => {
    const {store, storage} = await make();
    await store.set(1, user, '  hello  ');
    await store.set(1, channel, 'a channel');
    await store.set(2, user, 'another account');
    expect(store.get(1, user).text).toBe('hello');
    expect(store.get(1, user).updatedAt).toBe(1000);
    expect(store.get(1, channel).text).toBe('a channel');
    expect(store.get(2, user).text).toBe('another account');
    expect(store.list(1).length).toBe(2);
    expect(store.count(2)).toBe(1);
    expect(Object.keys(await storage.getAll('notes')).sort()).toEqual(['n:1:channel:5', 'n:1:user:5', 'n:2:user:5']);

    const again = new NotesStore(storage);
    await again.ready;
    expect(again.get(1, user).text).toBe('hello');
  });

  test('an empty text deletes; the same text changes nothing', async() => {
    const {store, storage, now} = await make();
    await store.set(1, user, 'hello');
    now.value = 5000000;
    await store.set(1, user, 'hello');
    expect(store.get(1, user).updatedAt).toBe(1000);
    await store.set(1, user, '   ');
    expect(store.get(1, user)).toBeUndefined();
    expect(await storage.getAll('notes')).toEqual({});
  });

  test('the bar\'s state is remembered with the note and is not a change of it', async() => {
    const {store, storage, now} = await make();
    await store.set(1, user, 'hello');
    now.value = 9000000;
    await store.setExpanded(1, user, true);
    expect(store.get(1, user).expanded).toBe(true);
    expect(store.get(1, user).updatedAt).toBe(1000);
    await store.set(1, user, 'hello again');
    expect(store.get(1, user).expanded).toBe(true);
    expect((await storage.getAll('notes'))['n:1:user:5'].expanded).toBe(true);
    await store.setExpanded(1, channel, true); // * no note: nothing
    expect(store.get(1, channel)).toBeUndefined();
  });

  test('listeners hear of each change, and stop when they ask to', async() => {
    const {store} = await make();
    const heard: string[] = [];
    const stop = store.subscribe((account, peer) => heard.push(account + ':' + (peer ? peer.type + peer.id : '*')));
    await store.set(1, user, 'a');
    await store.setExpanded(1, user, true);
    await store.delete(1, user);
    await store.setMany(1, [{peer: channel, text: 'b', updatedAt: 7}]);
    stop();
    await store.set(1, user, 'c');
    expect(heard).toEqual(['1:user5', '1:user5', '1:user5', '1:*']);
    expect(store.get(1, channel).updatedAt).toBe(7);
  });

  test('an account that leaves takes its notes; so do accounts that are gone at the start', async() => {
    const {store, storage} = await make();
    await store.set(1, user, 'one');
    await store.set(2, user, 'two');
    await store.set(3, user, 'three');
    await store.deleteAccount(1);
    expect(store.list(1)).toEqual([]);
    await store.cleanOrphans([3]);
    expect(store.list(2)).toEqual([]);
    expect(Object.keys(await storage.getAll('notes'))).toEqual(['n:3:user:5']);
  });
});
