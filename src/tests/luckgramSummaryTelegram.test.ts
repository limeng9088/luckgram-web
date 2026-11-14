// * Luckgram Web (luckgram-specs#189, W9 需求 2): the range's messages read from the chat, page by page

vi.mock('@components/wrappers/getPeerTitle', () => ({default: async({peerId}: {peerId: number}) => 'user' + peerId}));

import {describeMedia, getMessageText, loadSummaryLines} from '@/luckgram/summary/telegram';

type Fake = {_: string, mid: number, date: number, message?: string, fromId?: number, peerId?: number, pFlags?: any, media?: any, grouped_id?: string};

/** A chat of `count` messages (mids 1…count), its history given in pages, the newest first. */
function makeChat(messages: Fake[], isBroadcast = false) {
  const byMid = new Map(messages.map((message) => [message.mid, message]));
  const requests: any[] = [];
  const chat: any = {
    peerId: -100,
    isBroadcast,
    getMessageByPeer: (_peerId: number, mid: number) => byMid.get(mid),
    managers: {
      appMessagesManager: {
        getHistory: async(options: any) => {
          requests.push(options);
          const all = [...byMid.keys()].sort((a, b) => b - a);
          const from = options.offsetId ? all.findIndex((mid) => mid < options.offsetId) : 0;
          const history = from === -1 ? [] : all.slice(from, from + options.limit);
          return {history, isEnd: {top: from === -1 || from + options.limit >= all.length}};
        },
        getMessageByPeer: async(_peerId: number, mid: number) => byMid.get(mid)
      }
    }
  };
  return {chat, requests};
}

const text = (mid: number, extra: Partial<Fake> = {}): Fake => ({_: 'message', mid, date: 1700000000 + mid * 60, message: 'text ' + mid, fromId: 7, peerId: -100, pFlags: {}, ...extra});
const many = (count: number) => Array.from({length: count}, (_, i) => text(i + 1));
const run = (chat: any, range: any, unread?: any, signal = new AbortController().signal) => {
  const progress: [number, number][] = [];
  return loadSummaryLines(chat, range, unread, {signal, onProgress: (loaded, total) => progress.push([loaded, total])}).then((lines) => ({lines, progress}));
};

describe('luckgram summary: reading the chat', () => {
  test('what a message is, when it is not only text', () => {
    expect(describeMedia({media: {_: 'messageMediaPhoto'}} as any)).toEqual({kind: 'photo'});
    expect(describeMedia({media: {_: 'messageMediaDocument', document: {type: 'voice'}}} as any).kind).toBe('voice');
    expect(describeMedia({media: {_: 'messageMediaDocument', document: {file_name: 'a.pdf'}}} as any)).toEqual({kind: 'file', extra: 'a.pdf'});
    expect(describeMedia({media: {_: 'messageMediaPoll', poll: {question: {text: 'Lunch?'}}}} as any)).toEqual({kind: 'poll', extra: 'Lunch?'});
    expect(describeMedia({media: {_: 'messageMediaWebPage'}} as any)).toEqual({});
    expect(describeMedia({media: {_: 'messageMediaDice'}} as any)).toEqual({kind: 'other'});
    expect(getMessageText({message: 'look', media: {_: 'messageMediaPhoto'}} as any)).toMatch(/^\[.+\] look$/);
    expect(getMessageText({message: ''} as any)).toBe('');
  });

  test('the latest 300, asked for in pages, come the oldest first', async() => {
    const {chat, requests} = makeChat(many(450));
    const {lines, progress} = await run(chat, 300);
    expect(lines.length).toBe(300);
    expect(lines[0].id).toBe(151);
    expect(lines[299].id).toBe(450);
    expect(requests.map((request) => [request.offsetId, request.limit])).toEqual([[0, 100], [351, 100], [251, 100]]);
    expect(progress[progress.length - 1]).toEqual([300, 300]);
    expect(lines[0].sender).toBe('user7');
  });

  test('a chat shorter than the range gives what it has', async() => {
    const {chat} = makeChat(many(42));
    expect((await run(chat, 100)).lines.length).toBe(42);
  });

  test('the unread: down to what was read as the chat was opened, and no more than their count', async() => {
    const {chat} = makeChat(many(200));
    const byId = await run(chat, 'unread', {count: 60, readMaxId: 150});
    expect(byId.lines.map((line) => line.id)).toEqual(Array.from({length: 50}, (_, i) => 151 + i));
    const byCount = await run(chat, 'unread', {count: 35});
    expect(byCount.lines.length).toBe(35);
    expect(byCount.lines[0].id).toBe(166);
  });

  test('service messages and empty ones are left out; an album is told once', async() => {
    const {chat} = makeChat([
      text(1),
      {_: 'messageService', mid: 2, date: 1},
      text(3, {message: '', media: {_: 'messageMediaPhoto'}, grouped_id: 'g'}),
      text(4, {message: '', media: {_: 'messageMediaPhoto'}, grouped_id: 'g'}),
      text(5, {message: 'the caption', media: {_: 'messageMediaPhoto'}, grouped_id: 'g'}),
      text(6, {message: ''}),
      text(7, {pFlags: {out: true}})
    ]);
    const {lines} = await run(chat, 100);
    expect(lines.map((line) => line.id)).toEqual([1, 3, 5, 7]);
    expect(lines[2].text).toMatch(/the caption$/);
    expect(lines[3].sender).not.toBe('user7');
  });

  test('a channel\'s posts are the channel\'s, not "me"', async() => {
    const {chat} = makeChat([text(1, {fromId: undefined, pFlags: {out: true}})], true);
    expect((await run(chat, 100)).lines[0].sender).toBe('user-100');
  });

  test('cancelled while reading: it stops', async() => {
    const {chat, requests} = makeChat(many(450));
    const abort = new AbortController();
    const getHistory = chat.managers.appMessagesManager.getHistory;
    chat.managers.appMessagesManager.getHistory = async(options: any) => {
      const result = await getHistory(options);
      abort.abort();
      return result;
    };
    await expect(run(chat, 300, undefined, abort.signal)).rejects.toThrow();
    expect(requests.length).toBe(1);
  });
});
