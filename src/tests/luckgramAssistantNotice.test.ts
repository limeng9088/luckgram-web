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
import {errorFromResponse} from '@/luckgram/core/errors';

describe('luckgram assistant: the notice over the field', () => {
  const make = async(options: {maxInputChars?: number, reject?: any} = {}) => {
    const store = new AssistantStore(new LuckgramMemoryStorage());
    await store.ready;
    const sent: string[] = [];
    const page = new AssistantPage({
      account: 7 as any,
      store,
      maxInputChars: () => options.maxInputChars,
      chat: async(request: any) => {
        sent.push(request.messages[request.messages.length - 1].content);
        if(options.reject) throw options.reject;
        return '好的';
      }
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

  test('longer than a request may be: not sent, said over the field, the text stays to be shortened (specs#188)', async() => {
    const {page, notice, field, sent} = await make({maxInputChars: 100});
    const long = '字'.repeat(101);
    field.value = long;
    page.element.querySelector<HTMLElement>('.luckgram-ai-send').dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
    page.element.querySelector<HTMLElement>('.luckgram-ai-send').dispatchEvent(new MouseEvent('click', {bubbles: true}));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sent).toEqual([]);
    expect(field.value).toBe(long);
    expect(['内容超过 100 字，请删减后再发', 'The content is over 100 characters. Please shorten it before sending']).toContain(notice.textContent);
    expect(notice.classList.contains('hide')).toBe(false);
    // * nothing was added to the conversation: what is shown is what was sent
    expect(page.api.getConversation().messages.length).toBe(0);
    expect(page.element.querySelectorAll('.luckgram-ai-bubble').length).toBe(0);

    // * shortened: the notice goes with the edit, and it is sent
    field.value = '字'.repeat(100);
    field.dispatchEvent(new Event('input', {bubbles: true}));
    expect(notice.classList.contains('hide')).toBe(true);
    page.api.send(field.value);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toEqual(['字'.repeat(100)]);

    // * sent by a feature (not by the button): the same check
    page.api.send(long);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent.length).toBe(1);
    page.destroy();
  });

  test('the server refuses it as too long (413): said as that, not as a plain failure', async() => {
    const {page, sent} = await make({reject: errorFromResponse(413, JSON.stringify({error: {code: 'input_too_large', message: 'Input is longer than ai.max_input_chars'}}))});
    page.api.send('问题');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sent.length).toBe(1);
    const error = page.element.querySelector('.luckgram-ai-bubble-error');
    expect(error).not.toBeNull();
    expect(['内容太长，无法处理。', 'The content is too large to process.']).toContain(error.textContent);
    page.destroy();
  });
});
