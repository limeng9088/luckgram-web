// * Luckgram Web (luckgram-specs#188, W8b): the line over the assistant's field that says what "问 AI" left out

import {vi} from 'vitest';

// * upstream's message renderer is not what is looked at here, and loading it asks the network for things
vi.mock('@/luckgram/assistant/render', () => {
  const plain = (text: string) => {
    const fragment = document.createDocumentFragment();
    fragment.append(text);
    return fragment;
  };
  return {renderMarkdown: plain, renderPlain: plain};
});

import {AssistantStore} from '@/luckgram/assistant/store';
import {LuckgramMemoryStorage} from '@/luckgram/core/storage';
import AssistantPage from '@/luckgram/assistant/page';

describe('luckgram assistant: the notice over the field', () => {
  const make = async() => {
    const store = new AssistantStore(new LuckgramMemoryStorage());
    await store.ready;
    const sent: string[] = [];
    const page = new AssistantPage({
      account: 7 as any,
      store,
      chat: async(options: any) => (sent.push(options.messages[options.messages.length - 1].content), '好的')
    } as any);
    document.body.append(page.element);
    const notice = page.element.querySelector<HTMLElement>('.luckgram-ai-field-notice');
    const field = page.element.querySelector<HTMLTextAreaElement>('.luckgram-ai-field');
    return {page, notice, field, sent};
  };

  test('shown with what was brought; gone once the user edits the text', async() => {
    const {page, notice, field} = await make();
    expect(notice.classList.contains('hide')).toBe(true);

    page.api.setInput('很长的内容…\n\n', '内容较长，已截取前 999 字');
    expect(notice.classList.contains('hide')).toBe(false);
    expect(notice.textContent).toBe('内容较长，已截取前 999 字');
    // * what was brought is there to be edited
    expect(field.value).toBe('很长的内容…\n\n');

    field.value += '总结一下';
    field.dispatchEvent(new Event('input', {bubbles: true}));
    expect(notice.classList.contains('hide')).toBe(true);
    expect(notice.textContent).toBe('');
    page.destroy();
  });

  test('gone once it is sent as it is; nothing shown when nothing was cut', async() => {
    const {page, notice} = await make();
    page.api.setInput('内容\n\n');
    expect(notice.classList.contains('hide')).toBe(true);

    page.api.setInput('很长的内容…\n\n', '文件内容较长，已截取前 600 字');
    expect(notice.classList.contains('hide')).toBe(false);
    page.api.send(page.api.getInput());
    expect(notice.classList.contains('hide')).toBe(true);
    page.destroy();
  });
});
