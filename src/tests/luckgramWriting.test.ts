// * Luckgram Web (luckgram-specs#187, W7): AI writing and AI reply — the rules and the extension points

import {
  MAX_WRITING_CHARS, ORDER_EFFECTS, ORDER_REPLY, REPLY_TONES, WRITING_EFFECTS, buildReplyPrompt, buildTranscript, getMenuItems,
  isTooLong, parseCandidates
} from '@/luckgram/writing/logic';
import {getAiMenuItems, registerAiMenuItem} from '@/luckgram/writing/registry';

describe('luckgram AI writing', () => {
  test('the five effects are the server\'s, in the menu\'s order, each with its bar text', () => {
    expect(WRITING_EFFECTS.map((item) => item.effect)).toEqual(['polish', 'formal', 'friendly', 'shorter', 'grammar']);
    expect(WRITING_EFFECTS.map((item) => item.title[0])).toEqual(['润色', '更正式', '更友好', '更简短', '修正语法']);
    expect(WRITING_EFFECTS[0].done[0]).toBe('已润色');
    for(const item of WRITING_EFFECTS) expect(item.title[1] && item.done[0] && item.done[1]).toBeTruthy();
  });

  test('over 4000 characters is too long', () => {
    expect(isTooLong('a'.repeat(MAX_WRITING_CHARS))).toBe(false);
    expect(isTooLong('a'.repeat(MAX_WRITING_CHARS + 1))).toBe(true);
    expect(isTooLong('')).toBe(false);
  });

  test('the menu: by order; an empty field keeps only what allows it, a rich message too', () => {
    type Host = {channel: boolean};
    const items = [
      {key: 'polish', order: ORDER_EFFECTS},
      {key: 'grammar', order: ORDER_EFFECTS + 40},
      {key: 'reply', order: ORDER_REPLY, allowEmpty: true, allowRich: true},
      {key: 'post', order: -1, allowEmpty: true, visible: (host: Host) => host.channel},
      {key: 'broken', order: 5, visible: () => { throw new Error('x'); }}
    ];
    const keys = (state: {empty: boolean, rich: boolean}, host: Host) => getMenuItems(items, state, host).map((item) => item.key);
    expect(keys({empty: false, rich: false}, {channel: false})).toEqual(['reply', 'polish', 'grammar']);
    expect(keys({empty: false, rich: false}, {channel: true})).toEqual(['post', 'reply', 'polish', 'grammar']);
    expect(keys({empty: true, rich: false}, {channel: false})).toEqual(['reply']);
    expect(keys({empty: false, rich: true}, {channel: true})).toEqual(['reply']);
  });

  test('items of the same order keep the order they were registered in', () => {
    const items = [{key: 'a', order: 1}, {key: 'b', order: 1}, {key: 'c', order: 0}];
    expect(getMenuItems(items, {empty: false, rich: false}, {}).map((item) => item.key)).toEqual(['c', 'a', 'b']);
  });

  test('the extension point: an item is registered once by its key, and can be taken out', () => {
    const before = getAiMenuItems().length;
    const remove = registerAiMenuItem({key: 'test_item', title: ['甲', 'A'], order: 3, onClick: () => {}});
    registerAiMenuItem({key: 'test_item', title: ['乙', 'B'], order: 3, onClick: () => {}});
    expect(getAiMenuItems().filter((item) => item.key === 'test_item').map((item) => item.title[0])).toEqual(['乙']);
    remove();
    const removeSecond = registerAiMenuItem({key: 'test_item', title: ['丙', 'C'], order: 3, onClick: () => {}});
    removeSecond();
    expect(getAiMenuItems().length).toBe(before);
  });
});

describe('luckgram AI reply', () => {
  test('the conversation: the last 20 messages with text, who wrote each, on one line each', () => {
    const lines = Array.from({length: 25}, (_, i) => ({out: i % 2 === 0, name: 'Anna', text: 'm' + i}));
    const transcript = buildTranscript([...lines, {out: false, name: 'Anna', text: '  '}, {out: false, name: 'An:na\nB', text: 'two\nlines'}], '我');
    const rows = transcript.split('\n');
    expect(rows.length).toBe(20);
    expect(rows[0]).toBe('我: m6');
    expect(rows[1]).toBe('Anna: m7');
    expect(rows[19]).toBe('An na B: two lines');
    expect(buildTranscript([{out: false, text: 'hi'}])).toBe('Them: hi');
    expect(buildTranscript([])).toBe('');
  });

  test('what is sent: the phones\' wording, with the draft or without', () => {
    expect(buildReplyPrompt('Anna: 明天的午饭还约吗？', '明天去不了 周五行不', '我'))
    .toBe('Recent messages (oldest first; "我" is me):\nAnna: 明天的午饭还约吗？\n\nMy draft: 明天去不了 周五行不');
    expect(buildReplyPrompt('', '  ', 'Me')).toBe('Recent messages (oldest first; "Me" is me):\n(none)\n\nI have no draft; suggest what I could reply.');
  });

  test('the candidates in a stream: complete lines and the one being written, three at most, without numbers or quotes', () => {
    expect(parseCandidates('好的')).toEqual(['好的']);
    expect(parseCandidates('好的，周五见\n抱歉明天')).toEqual(['好的，周五见', '抱歉明天']);
    expect(parseCandidates('1. 好的\n2) "没问题"\n- “周五见”\n4. 多余的一条')).toEqual(['好的', '没问题', '周五见']);
    expect(parseCandidates('\n\n  \n')).toEqual([]);
    expect(parseCandidates(undefined)).toEqual([]);
    expect(REPLY_TONES.map((tone) => tone[0])).toEqual(['简短', '礼貌', '轻松']);
  });
});
