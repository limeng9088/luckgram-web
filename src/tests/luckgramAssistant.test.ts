import {vi} from 'vitest';
// * Luckgram Web (luckgram-specs#188, W8): the AI assistant — conversations, context, extension points, Markdown

import 'fake-indexeddb/auto';
import {IDBFactory} from 'fake-indexeddb';
import {LuckgramIndexedDBStorage, LuckgramMemoryStorage} from '@/luckgram/core/storage';
import {AssistantStore} from '@/luckgram/assistant/store';
import {
  AI_HASH, AssistantMessage, CONTEXT_MESSAGES, QUICK_BUTTONS, alignTable, applyPrefix, buildContext, conversationKey, findInterceptor,
  getConversationsToPrune, getOrphanKeys, makeId, makeTitle, markdownToEntities, newConversation, prepareMarkdown, sortConversations
} from '@/luckgram/assistant/logic';
import {
  getAssistantHeaderEntries, getAssistantInterceptors, getAssistantMessageType, getAssistantQuickButtons,
  registerAssistantHeaderEntry, registerAssistantInterceptor, registerAssistantMessageType, registerAssistantQuickButton
} from '@/luckgram/assistant/registry';

const message = (role: 'user' | 'assistant', text: string, extra: Partial<AssistantMessage> = {}): AssistantMessage => ({
  id: makeId(), role, type: 'text', text, at: 1, ...extra
});

describe('luckgram assistant: conversations', () => {
  test('the address is not a user name or a peer id, which upstream would take for a chat', () => {
    expect(AI_HASH).toBe('#/luckgram-ai');
    expect(AI_HASH[1]).not.toBe('@');
    expect(Number.isNaN(+AI_HASH.slice(1))).toBe(true);
  });

  test('ids are unique; a conversation is named after the first question', () => {
    const ids = new Set(Array.from({length: 500}, () => makeId(1e12)));
    expect(ids.size).toBe(500);
    expect(makeTitle('  用两句话解释\n太阳能板怎么发电  ')).toBe('用两句话解释 太阳能板怎么发电');
    expect(makeTitle('a'.repeat(100)).length).toBe(40);
    expect(makeTitle('a'.repeat(100)).endsWith('…')).toBe(true);
    expect(makeTitle('')).toBe('');
  });

  test('the context: the latest 20 text messages, starting with a question; errors and other types are left out', () => {
    const conversation = newConversation(1, 1);
    for(let i = 0; i < 15; ++i) {
      conversation.messages.push(message('user', 'q' + i), message('assistant', 'a' + i));
    }
    conversation.messages.push(message('user', 'failed'), message('assistant', '', {error: 'network_error'}));
    conversation.messages.push(message('assistant', 'picture', {type: 'image'}), message('user', '  '));

    const context = buildContext(conversation);
    expect(context.length).toBeLessThanOrEqual(CONTEXT_MESSAGES);
    expect(context[0]).toEqual({role: 'user', content: 'q6'});
    expect(context[context.length - 1]).toEqual({role: 'user', content: 'failed'});
    expect(context.some((item) => item.content === 'picture' || !item.content.trim())).toBe(false);
  });

  test('a conversation\'s system instruction goes first with every request', () => {
    const conversation = newConversation(1, 1, {system: ' You are a pirate. ', task: 'agent'});
    conversation.messages.push(message('user', 'hi'));
    expect(buildContext(conversation)).toEqual([{role: 'system', content: 'You are a pirate.'}, {role: 'user', content: 'hi'}]);
    expect(conversation.task).toBe('agent');
  });

  test('the newest first; with too many the oldest go, never a feature\'s own', () => {
    const list = [{id: 'a', updatedAt: 1}, {id: 'b', updatedAt: 3}, {id: 'c', updatedAt: 2, key: 'agent:1'}, {id: 'd', updatedAt: 0}];
    expect(sortConversations(list).map((item) => item.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(getConversationsToPrune(list, 3)).toEqual(['d']);
    expect(getConversationsToPrune(list, 2)).toEqual(['a', 'd']);
    expect(getConversationsToPrune(list, 10)).toEqual([]);
  });

  test('conversations of an account that is no longer signed in are orphans', () => {
    const keys = [conversationKey(1, 'x'), conversationKey(2, 'y'), conversationKey(22, 'z'), 'something-else'];
    expect(getOrphanKeys(keys, [2])).toEqual([conversationKey(1, 'x'), conversationKey(22, 'z')]);
    expect(getOrphanKeys(keys, [1, '2', 22])).toEqual([]);
    expect(getOrphanKeys(keys, [])).toEqual(keys.slice(0, 3));
  });
});

describe('luckgram assistant: the store', () => {
  test('kept across a reload, by account; deleted one by one', async() => {
    const factory = new IDBFactory();
    const store = new AssistantStore(new LuckgramIndexedDBStorage(factory, 'lg-ai'));
    await store.ready;
    const mine = newConversation(1, 10, {title: 'mine'});
    mine.messages.push(message('user', 'hello'));
    const other = newConversation(2, 20, {title: 'other'});
    await store.save(mine);
    await store.save(other);

    const reopened = new AssistantStore(new LuckgramIndexedDBStorage(factory, 'lg-ai'));
    await reopened.ready;
    expect(reopened.list(1).map((item) => item.title)).toEqual(['mine']);
    expect(reopened.list(1)[0].messages[0].text).toBe('hello');
    expect(reopened.list(2).map((item) => item.title)).toEqual(['other']);
    expect(reopened.list(3)).toEqual([]);

    await reopened.delete(1, mine.id);
    const third = new AssistantStore(new LuckgramIndexedDBStorage(factory, 'lg-ai'));
    await third.ready;
    expect(third.list(1)).toEqual([]);
    expect(third.list(2).length).toBe(1);
  });

  test('what is stored does not follow later changes that were not saved', async() => {
    const storage = new LuckgramMemoryStorage();
    const store = new AssistantStore(storage);
    await store.ready;
    const conversation = newConversation(1, 1);
    await store.save(conversation);
    conversation.messages.push(message('user', 'not saved'));
    expect(Object.values(await storage.getAll('ai'))[0].messages).toEqual([]);
  });

  test('an account that logs out here takes its conversations with it; one that left elsewhere is cleaned up at the start', async() => {
    const storage = new LuckgramMemoryStorage();
    const store = new AssistantStore(storage);
    await store.ready;
    await store.save(newConversation(1, 1));
    await store.save(newConversation(1, 2));
    await store.save(newConversation(2, 3));
    await store.save(newConversation(3, 4));

    await store.deleteAccount(1);
    expect(store.list(1)).toEqual([]);
    expect(store.size).toBe(2);

    const next = new AssistantStore(storage);
    await next.ready;
    await next.cleanOrphans([3]);
    expect(next.list(2)).toEqual([]);
    expect(next.list(3).length).toBe(1);
    expect(Object.keys(await storage.getAll('ai')).length).toBe(1);
  });

  test('a feature finds its conversation again by its key', async() => {
    const store = new AssistantStore(new LuckgramMemoryStorage());
    await store.ready;
    const agent = newConversation(1, 1, {key: 'agent:42', task: 'agent', system: 'Be brief.'});
    await store.save(agent);
    await store.save(newConversation(1, 2));
    expect(store.findByKey(1, 'agent:42')?.id).toBe(agent.id);
    expect(store.findByKey(2, 'agent:42')).toBeUndefined();
  });

  test('a database that cannot be read: the page goes on without one', async() => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken: any = {getAll: () => Promise.reject(new Error('no')), update: () => Promise.reject(new Error('no'))};
    const store = new AssistantStore(broken);
    await store.ready;
    await store.save(newConversation(1, 1));
    expect(store.list(1).length).toBe(1);
    warn.mockRestore();
  });
});

describe('luckgram assistant: quick buttons and the extension points', () => {
  test('the four quick buttons put their prefix before what is typed, once', () => {
    expect(QUICK_BUTTONS.map((button) => button.title[0])).toEqual(['总结', '改写', '讲解', '解题']);
    const prefix = QUICK_BUTTONS[0].prefix[0];
    expect(applyPrefix(prefix, '一段长文')).toBe(prefix + '一段长文');
    expect(applyPrefix(prefix, prefix + '一段长文')).toBe(prefix + '一段长文');
    expect(applyPrefix(prefix, '')).toBe(prefix);
  });

  test('a message with a registered prefix goes to its handler: a command ends at a space, a word needs none', () => {
    const interceptors = [{prefix: '/image-edit'}, {prefix: '/image'}, {prefix: '画'}];
    expect(findInterceptor(interceptors, '/image a cat')).toEqual({interceptor: interceptors[1], rest: 'a cat'});
    expect(findInterceptor(interceptors, '  /IMAGE')).toEqual({interceptor: interceptors[1], rest: ''});
    expect(findInterceptor(interceptors, '/image-edit make it red')).toEqual({interceptor: interceptors[0], rest: 'make it red'});
    expect(findInterceptor(interceptors, '/imagery of the war')).toBeUndefined();
    expect(findInterceptor(interceptors, '画一只猫')).toEqual({interceptor: interceptors[2], rest: '一只猫'});
    expect(findInterceptor(interceptors, '这幅画不错')).toBeUndefined();
    expect(findInterceptor([], '/image x')).toBeUndefined();
  });

  test('registering: once by its key, in order, and taken out again', () => {
    const before = getAssistantQuickButtons().length;
    const removeB = registerAssistantQuickButton({key: 't_b', title: ['乙', 'B'], order: 20, onClick: () => {}});
    const removeA = registerAssistantQuickButton({key: 't_a', title: ['甲', 'A'], order: 10, onClick: () => {}});
    registerAssistantQuickButton({key: 't_a', title: ['甲二', 'A2'], order: 10, onClick: () => {}})();
    expect(getAssistantQuickButtons().filter((button) => button.key.startsWith('t_')).map((button) => button.key)).toEqual(['t_b']);
    removeA();
    removeB();
    expect(getAssistantQuickButtons().length).toBe(before);

    const removeEntry = registerAssistantHeaderEntry({key: 't_agents', title: ['智能体', 'Agents'], onClick: () => {}});
    expect(getAssistantHeaderEntries().some((entry) => entry.key === 't_agents')).toBe(true);
    removeEntry();

    const removeShort = registerAssistantInterceptor({prefix: '/t', handle: () => {}});
    const removeLong = registerAssistantInterceptor({prefix: '/t-long', handle: () => {}});
    expect(getAssistantInterceptors().filter((item) => item.prefix.startsWith('/t')).map((item) => item.prefix)).toEqual(['/t-long', '/t']);
    removeShort();
    removeLong();

    expect(getAssistantMessageType('t_image')).toBeUndefined();
    const removeType = registerAssistantMessageType({type: 't_image', render: () => undefined as any});
    expect(getAssistantMessageType('t_image')).toBeDefined();
    removeType();
  });
});

describe('luckgram assistant: Markdown for upstream\'s message renderer', () => {
  test('a heading becomes a bold line, a bullet keeps a mark, numbers stay', () => {
    expect(prepareMarkdown('# Title\n## **Sub** title ##\ntext\n- one\n* two\n  + nested\n1. first')).toBe(
      '**Title**\n**Sub title**\ntext\n• one\n• two\n  • nested\n1. first'
    );
  });

  test('a table goes into a fence with its columns in line; bars that are no table stay as they are', () => {
    const out = prepareMarkdown('before\n| 名称 | Price |\n|---|---:|\n| 苹果 | 3 |\n| Watermelon | 12 |\nafter').split('\n');
    expect(out[0]).toBe('before');
    // * a fence of its own kind: render.ts draws it as plain fixed-width lines, not as a block of code
    expect(out[1]).toBe('```lgtable');
    expect(out[out.length - 2]).toBe('```');
    expect(out[out.length - 1]).toBe('after');
    const rows = out.slice(2, -2);
    // * every bar of a column stands at the same place, a Chinese character counting for two
    const bar = (row: string) => [...row].reduce((sum, ch, index, all) => ch === '|' && sum === -1 ? all.slice(0, index).reduce((w, c) => w + (/[一-鿿]/.test(c) ? 2 : 1), 0) : sum, -1);
    expect(new Set(rows.map(bar)).size).toBe(1);
    expect(rows[1]).toMatch(/^-+ \| -+$/);

    expect(prepareMarkdown('| not a table |')).toBe('| not a table |');
    expect(alignTable(['| a | b |', '|--|--|', '| ccc | d |'])).toEqual(['a   | b', '--- | --', 'ccc | d']);
  });

  test('code that is fenced is left alone, and a reply cut off inside a fence still shows as code', () => {
    const code = '```js\n# not a heading\n- not a list\n| not | a table |\n```';
    expect(prepareMarkdown(code)).toBe(code);
    expect(prepareMarkdown('text\n```python\nprint(1)')).toBe('text\n```python\nprint(1)\n```');
    expect(prepareMarkdown('~~~\nx\n~~~')).toBe('```\nx\n```');
    expect(prepareMarkdown('')).toBe('');
  });
});

describe('luckgram assistant: Markdown as text with entities', () => {
  const at = (result: {text: string, entities: any[]}, type: string) => result.entities.filter((entity) => entity._ === type).map((entity) => result.text.substr(entity.offset, entity.length));

  test('bold, italic, code and strike beside Chinese characters, which upstream\'s own Markdown leaves alone', () => {
    const result = markdownToEntities('太阳能板里的**硅片**吸收光子，形成 *直流电*；用 `power(2, 1000)` 算，~~不对~~。');
    expect(result.text).toBe('太阳能板里的硅片吸收光子，形成 直流电；用 power(2, 1000) 算，不对。');
    expect(at(result, 'messageEntityBold')).toEqual(['硅片']);
    expect(at(result, 'messageEntityItalic')).toEqual(['直流电']);
    expect(at(result, 'messageEntityCode')).toEqual(['power(2, 1000)']);
    expect(at(result, 'messageEntityStrike')).toEqual(['不对']);
  });

  test('one inside another; a link with its address; a heading and a list from the preparation', () => {
    const result = markdownToEntities('# Title\n**bold and *italic* inside** see [the **docs**](https://example.com/a_b)\n- item');
    expect(result.text).toBe('Title\nbold and italic inside see the docs\n• item');
    expect(at(result, 'messageEntityBold')).toEqual(['Title', 'bold and italic inside', 'docs']);
    expect(at(result, 'messageEntityItalic')).toEqual(['italic']);
    const link = result.entities.find((entity) => entity._ === 'messageEntityTextUrl');
    expect(link.url).toBe('https://example.com/a_b');
    expect(result.text.substr(link.offset, link.length)).toBe('the docs');
  });

  test('what is not a mark stays: snake_case, 2 * 3 * 4, a lone star, an escaped one, a script link', () => {
    for(const text of ['use snake_case_names here', '2 * 3 * 4 = 24', 'a * lone star', 'rated 5* by all', '[x](javascript:alert(1))']) {
      const result = markdownToEntities(text);
      expect(result.text, text).toBe(text);
      expect(result.entities, text).toEqual([]);
    }

    expect(markdownToEntities('\\*not italic\\*').text).toBe('*not italic*');
    expect(markdownToEntities('**unclosed bold').text).toBe('**unclosed bold');
  });

  test('fenced code keeps its text and its language; marks inside it are not marks', () => {
    const result = markdownToEntities('before\n```python\ndef f(a_b):\n    return a_b ** 2\n```\nafter `x`');
    const pre = result.entities.find((entity) => entity._ === 'messageEntityPre');
    expect(pre.language).toBe('python');
    expect(result.text.substr(pre.offset, pre.length)).toBe('def f(a_b):\n    return a_b ** 2');
    expect(result.text).toBe('before\ndef f(a_b):\n    return a_b ** 2\nafter x');
    expect(at(result, 'messageEntityBold')).toEqual([]);
    expect(at(result, 'messageEntityCode')).toEqual(['x']);
  });

  test('a table becomes a block of code, a reply cut off inside a fence too; offsets are right after emoji', () => {
    const table = markdownToEntities('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(table.entities.map((entity) => entity._)).toEqual(['messageEntityPre']);
    // * a block without a language still names one, an empty one: upstream's renderer reads it
    expect(table.entities[0].language).toBe('lgtable');
    expect(table.text).toBe('a  | b\n-- | --\n1  | 2');

    const cut = markdownToEntities('look:\n```js\nconst a = 1');
    expect(cut.entities[0]).toMatchObject({_: 'messageEntityPre', language: 'js'});
    expect(cut.text.substr(cut.entities[0].offset, cut.entities[0].length)).toBe('const a = 1');

    const emoji = markdownToEntities('🙂🙂 **粗**');
    expect(emoji.text.substr(emoji.entities[0].offset, emoji.entities[0].length)).toBe('粗');
    expect(markdownToEntities('').text).toBe('');
  });
});

describe('luckgram assistant: the row over the chat list', () => {
  test('in "All chats" only, with the feature on and the row not switched off', async() => {
    const {isPinVisible} = await import('@/luckgram/assistant/entries');
    expect(isPinVisible({enabled: true, pinned: true, filterId: 0})).toBe(true);
    expect(isPinVisible({enabled: true, pinned: true, filterId: undefined})).toBe(true);
    expect(isPinVisible({enabled: true, pinned: true, filterId: 1})).toBe(false);
    expect(isPinVisible({enabled: true, pinned: true, filterId: 5})).toBe(false);
    expect(isPinVisible({enabled: true, pinned: false, filterId: 0})).toBe(false);
    expect(isPinVisible({enabled: false, pinned: true, filterId: 0})).toBe(false);
  });
});

describe('luckgram assistant: a table is drawn as its own lines, not as a block of code (specs#188)', () => {
  /** What upstream's renderer draws for a block of code (wrapRichText.ts: messageEntityPre). */
  const codeBlock = (text: string) => {
    const pre = document.createElement('pre');
    pre.classList.add('quote-like', 'code');
    pre.innerHTML = '<div class="code-header"><span class="code-header-name">复制</span></div><div class="code-content"><code class="code-code"></code></div>';
    pre.querySelector('code').textContent = text;
    return pre;
  };

  test('no shell of a code block around it; a block of code the model wrote keeps its own', async() => {
    const {drawTables} = await import('@/luckgram/assistant/tables');
    const {text, entities} = markdownToEntities('对比如下：\n\n| 项目 | Price |\n|---|---|\n| 苹果 | 3 |\n| Banana | 12 |\n\n```js\nconst a = 1;\n```\n完。');
    const blocks = entities.filter((entity) => entity._ === 'messageEntityPre');
    expect(blocks.map((block) => block.language)).toEqual(['lgtable', 'js']);

    const host = document.createElement('div');
    host.append('对比如下：', ...blocks.map((block) => codeBlock(text.slice(block.offset, block.offset + block.length))), '完。');
    drawTables(host, text, entities);

    const table = host.querySelector('pre.luckgram-ai-table');
    expect(table).not.toBeNull();
    expect(table.querySelector('.code-header')).toBeNull();
    const lines = table.textContent.split('\n');
    expect(lines.length).toBe(4);
    expect(lines[0]).toContain('项目');
    expect(lines[3]).toContain('Banana');
    expect(table.textContent).not.toContain('```');
    expect(host.textContent).not.toContain('lgtable');

    // * the code is still a block of code, with its header; the table is not one of them
    const code = host.querySelectorAll('pre.code');
    expect(code.length).toBe(1);
    expect(code[0].querySelector('.code-header')).not.toBeNull();
    expect(code[0].textContent).toContain('const a = 1;');
  });

  test('blocks that do not match what was drawn are left as they are', async() => {
    const {drawTables} = await import('@/luckgram/assistant/tables');
    const {text, entities} = markdownToEntities('| a | b |\n|---|---|\n| 1 | 2 |');
    const host = document.createElement('div');
    drawTables(host, text, entities);
    expect(host.children.length).toBe(0);
  });
});
