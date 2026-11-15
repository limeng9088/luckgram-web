/*
 * Luckgram Web (luckgram-specs#188, W8 需求 2–4、6–8): the AI assistant's page — a chat that
 * is not Telegram's. Its own DOM and logic, in the colours and shapes of upstream's chat; nothing
 * here knows of peers, managers or the middle column (open.ts puts the page there).
 *
 *   header    "AI" · Luckgram AI · 助手 · entries of features · 历史 · 新对话
 *   messages  bubbles: the user's at the end side, the assistant's at the start side; text can be
 *             selected, a right click offers 复制; a reply is Markdown and is written as it arrives
 *   history   the account's conversations, the newest first, each with 删除
 *   footer    the quick buttons, the field (Enter sends, Shift+Enter breaks the line), send / stop
 *
 * Every request goes to the Luckgram server through the AI client (`chat`), with the open
 * conversation's latest 20 messages; nothing is sent to Telegram.
 */

import Icon from '@components/icon';
import {attachClickEvent} from '@helpers/dom/clickEvent';
import {LuckgramApiError, errorMessage} from '@/luckgram/core/errors';
import type {AiChatOptions} from '@/luckgram/core/ai';
import {lgText} from '@/luckgram/text';
import {holdEscape} from '@/luckgram/core/escape';
import {
  AssistantMessage, Conversation, QUICK_BUTTONS, applyPrefix, buildContext, findInterceptor, makeId, makeTitle, newConversation
} from '@/luckgram/assistant/logic';
import {
  AssistantPageApi, getAssistantHeaderEntries, getAssistantInterceptors, getAssistantMessageType, getAssistantQuickButtons
} from '@/luckgram/assistant/registry';
import {renderMarkdown, renderPlain} from '@/luckgram/assistant/render';
import type {AssistantStore} from '@/luckgram/assistant/store';

export type AssistantPageOptions = {
  account: number | string,
  store: AssistantStore,
  chat: (options: AiChatOptions) => Promise<string>,
  /** the page's own way out: the back arrow of a narrow window */
  onBack?: () => void,
  copy?: (text: string) => void,
  confirmDelete?: (title: string) => Promise<boolean>,
  now?: () => number
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  if(className) element.className = className;
  if(text !== undefined) element.textContent = text;
  return element;
};

const button = (className: string, text: string, onClick: () => void) => {
  const element = el('button', className, text);
  element.type = 'button';
  attachClickEvent(element, (e) => {
    e.preventDefault();
    onClick();
  });
  return element;
};

export default class AssistantPage {
  public element: HTMLElement;
  public api: AssistantPageApi;

  private messagesEl: HTMLElement;
  private historyEl: HTMLElement;
  private quickEl: HTMLElement;
  private entriesEl: HTMLElement;
  private field: HTMLTextAreaElement;
  private noticeEl: HTMLElement;
  private sendButton: HTMLButtonElement;
  private historyButton: HTMLButtonElement;

  private conversation: Conversation;
  private bubbles = new Map<string, HTMLElement>();
  private abort: AbortController;
  private run = 0;
  private destroyed = false;
  private closeMenu: () => void;
  private historyEscape: () => void;
  private now: () => number;

  constructor(private options: AssistantPageOptions) {
    this.now = options.now || Date.now;
    this.conversation = newConversation(options.account, this.now());
    this.api = {
      getConversation: () => this.conversation,
      getInput: () => this.field.value,
      setInput: (text, notice) => this.setInput(text, notice),
      addMessage: (message) => this.addMessage(message).id,
      updateMessage: (id, patch) => this.updateMessage(id, patch),
      openConversation: (properties) => this.openConversation(properties),
      send: (text) => this.send(text)
    };

    this.build();
    // * the latest conversation is where the user left off
    options.store.ready.then(() => {
      if(this.destroyed || this.conversation.messages.length) return;
      const latest = options.store.list(options.account).find((conversation) => !conversation.key);
      if(latest) this.show(latest);
    });
  }

  // ------------------------------------------------------------------ building

  private build() {
    const page = this.element = el('div', 'luckgram-ai-page');
    page.setAttribute('role', 'region');
    page.setAttribute('aria-label', 'Luckgram AI');

    // * header
    const header = el('div', 'luckgram-ai-header');
    if(this.options.onBack) {
      // * upstream's own arrow, as in a chat's header
      const back = button('luckgram-ai-icon-button luckgram-ai-back', '', () => this.options.onBack());
      back.append(Icon('left'));
      back.setAttribute('aria-label', lgText('返回', 'Back'));
      header.append(back);
    }

    const avatar = el('div', 'luckgram-ai-avatar', 'AI');
    avatar.setAttribute('aria-hidden', 'true');
    const titles = el('div', 'luckgram-ai-titles');
    titles.append(el('div', 'luckgram-ai-title', 'Luckgram AI'), el('div', 'luckgram-ai-subtitle', lgText('助手', 'Assistant')));
    this.entriesEl = el('div', 'luckgram-ai-entries');
    this.historyButton = button('luckgram-ai-text-button', lgText('历史', 'History'), () => this.toggleHistory());
    const fresh = button('luckgram-ai-text-button', lgText('新对话', 'New chat'), () => this.openConversation());
    header.append(avatar, titles, this.entriesEl, this.historyButton, fresh);

    // * messages and the history over them
    const body = el('div', 'luckgram-ai-body');
    this.messagesEl = el('div', 'luckgram-ai-messages');
    this.messagesEl.setAttribute('role', 'log');
    this.messagesEl.setAttribute('aria-live', 'polite');
    this.historyEl = el('div', 'luckgram-ai-history hide');
    body.append(this.messagesEl, this.historyEl);

    this.messagesEl.addEventListener('contextmenu', (e) => this.onContextMenu(e));

    // * footer
    const footer = el('div', 'luckgram-ai-footer');
    this.quickEl = el('div', 'luckgram-ai-quick');
    const row = el('div', 'luckgram-ai-input-row');
    this.field = el('textarea', 'luckgram-ai-field');
    this.field.rows = 1;
    this.field.dir = 'auto';
    this.field.placeholder = lgText('问点什么…', 'Ask anything…');
    this.field.setAttribute('aria-label', lgText('给 Luckgram AI 的消息', 'Message to Luckgram AI'));
    this.field.addEventListener('input', () => {
      // * the text is the user's own from here on: what was said of what was brought goes
      this.setNotice();
      this.onInput();
    });
    this.field.addEventListener('keydown', (e) => {
      // * as in a chat: Enter sends, Shift+Enter breaks the line; not while an input method is composing
      if(e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        this.onSendButton();
      }
    });

    this.sendButton = button('luckgram-ai-send', '', () => this.onSendButton());
    row.append(this.field, this.sendButton);
    this.noticeEl = el('div', 'luckgram-ai-field-notice hide');
    this.noticeEl.setAttribute('role', 'status');
    footer.append(this.quickEl, this.noticeEl, row);

    page.append(header, body, footer);
    this.renderExtensions();
    this.renderMessages();
    this.updateSendButton();
  }

  /** The quick buttons and the header's entries: the built-in four, then what features registered. */
  public renderExtensions() {
    const quick = [
      ...QUICK_BUTTONS.map((item, index) => ({
        key: item.key, title: item.title, order: index, onClick: (page: AssistantPageApi) => {
          page.setInput(applyPrefix(lgText(...item.prefix), page.getInput()));
        }
      })),
      ...getAssistantQuickButtons()
    ].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

    this.quickEl.replaceChildren(...quick.map((item) => button('luckgram-ai-chip', lgText(...item.title), () => {
      try {
        item.onClick(this.api);
      } catch(err) {
        console.warn('[luckgram] assistant quick button', item.key, (err as Error)?.message);
      }
    })));

    this.entriesEl.replaceChildren(...getAssistantHeaderEntries().map((entry) => button('luckgram-ai-text-button', lgText(...entry.title), () => {
      try {
        entry.onClick(this.api);
      } catch(err) {
        console.warn('[luckgram] assistant header entry', entry.key, (err as Error)?.message);
      }
    })));
  }

  // ------------------------------------------------------------------ the field

  /** The line over the field; nothing takes it away. */
  private setNotice(text?: string) {
    if(!this.noticeEl) return;
    this.noticeEl.textContent = text || '';
    this.noticeEl.classList.toggle('hide', !text);
  }

  private setInput(text: string, notice?: string) {
    this.setNotice(notice);
    this.field.value = text;
    this.onInput();
    this.field.focus();
    this.field.setSelectionRange(text.length, text.length);
  }

  private onInput() {
    // * grows with its text, up to a third of the page
    this.field.style.height = 'auto';
    this.field.style.height = Math.min(this.field.scrollHeight, Math.max(120, this.element.clientHeight / 3)) + 'px';
    this.updateSendButton();
  }

  private get busy() {
    return !!this.abort;
  }

  private updateSendButton() {
    const busy = this.busy;
    this.sendButton.classList.toggle('is-stop', busy);
    this.sendButton.disabled = !busy && !this.field.value.trim();
    const label = busy ? lgText('停止', 'Stop') : lgText('发送', 'Send');
    this.sendButton.textContent = busy ? '■' : '↑';
    this.sendButton.title = label;
    this.sendButton.setAttribute('aria-label', label);
  }

  private onSendButton() {
    if(this.busy) {
      this.stop();
      return;
    }

    const text = this.field.value.trim();
    if(!text) return;
    this.field.value = '';
    this.onInput();
    this.send(text);
  }

  // ------------------------------------------------------------------ messages

  private save() {
    this.conversation.updatedAt = this.now();
    return this.options.store.save(this.conversation);
  }

  private addMessage(partial: Pick<AssistantMessage, 'role' | 'type' | 'text'> & {data?: any, partial?: boolean}): AssistantMessage {
    this.toggleHistory(false);
    const message: AssistantMessage = {id: makeId(this.now()), at: this.now(), ...partial};
    if(!this.conversation.messages.length && !this.conversation.title && message.role === 'user') {
      this.conversation.title = makeTitle(message.text);
    }

    this.conversation.messages.push(message);
    this.messagesEl.querySelector('.luckgram-ai-empty')?.remove();
    this.messagesEl.append(this.renderBubble(message));
    this.scrollToEnd();
    if(!message.partial) this.save();
    return message;
  }

  private updateMessage(id: string, patch: Partial<AssistantMessage>, persist = true) {
    const message = this.conversation.messages.find((item) => item.id === id);
    if(!message) return;
    Object.assign(message, patch);
    const old = this.bubbles.get(id);
    const stick = this.isAtEnd();
    const next = this.renderBubble(message);
    if(old?.isConnected) old.replaceWith(next);
    if(stick) this.scrollToEnd();
    if(persist && !message.partial) this.save();
  }

  private renderBubble(message: AssistantMessage): HTMLElement {
    const bubble = el('div', 'luckgram-ai-bubble ' + (message.role === 'user' ? 'is-out' : 'is-in'));
    bubble.dataset.id = message.id;
    bubble.dir = 'auto';
    const content = el('div', 'luckgram-ai-bubble-content');

    if(message.error) {
      bubble.classList.add('is-error');
      if(message.text) content.append(renderMarkdown(message.text));
      content.append(el('div', 'luckgram-ai-bubble-error', lgText(...errorMessage(message.error))));
    } else if(message.type !== 'text') {
      // * a type a feature registered draws itself; one nobody knows shows that it is there
      const type = getAssistantMessageType(message.type);
      let custom: HTMLElement;
      try {
        custom = type?.render(message, this.api);
      } catch(err) {
        console.warn('[luckgram] assistant message type', message.type, (err as Error)?.message);
      }

      content.append(custom || el('div', 'luckgram-ai-bubble-unknown', lgText('[此版本无法显示这条消息]', '[This version can\'t show this message]')));
    } else if(message.role === 'assistant') {
      if(message.text) content.append(renderMarkdown(message.text));
      if(message.partial && this.busy) content.append(el('span', 'luckgram-ai-typing', '▍'));
    } else {
      content.append(renderPlain(message.text));
    }

    bubble.append(content);
    this.bubbles.set(message.id, bubble);
    return bubble;
  }

  private renderMessages() {
    this.bubbles.clear();
    const messages = this.conversation.messages;
    if(!messages.length) {
      const empty = el('div', 'luckgram-ai-empty');
      empty.append(
        el('div', 'luckgram-ai-empty-title', lgText('有什么可以帮你？', 'How can I help?')),
        el('div', 'luckgram-ai-empty-text', lgText('提问、讲解、总结或改写长文、解题。这里的对话不会发到 Telegram。', 'Ask, explain, summarize or rewrite, solve. Nothing here is sent to Telegram.'))
      );
      this.messagesEl.replaceChildren(empty);
      return;
    }

    this.messagesEl.replaceChildren(...messages.map((message) => this.renderBubble(message)));
    this.scrollToEnd();
  }

  private isAtEnd() {
    const {scrollTop, scrollHeight, clientHeight} = this.messagesEl;
    return scrollHeight - scrollTop - clientHeight < 80;
  }

  private scrollToEnd() {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private onContextMenu(e: MouseEvent) {
    const bubble = (e.target as HTMLElement).closest<HTMLElement>('.luckgram-ai-bubble');
    const message = bubble && this.conversation.messages.find((item) => item.id === bubble.dataset.id);
    // * a selection is copied by the browser's own menu
    if(!message?.text || !window.getSelection()?.isCollapsed) return;

    e.preventDefault();
    this.closeMenu?.();
    const menu = el('div', 'luckgram-ai-menu');
    const copy = button('luckgram-ai-menu-item', lgText('复制', 'Copy'), () => {
      close();
      this.options.copy ? this.options.copy(message.text) : navigator.clipboard?.writeText(message.text).catch(() => {});
    });
    menu.append(copy);
    const rect = this.element.getBoundingClientRect();
    menu.style.insetInlineStart = Math.max(8, Math.min(e.clientX - rect.left, rect.width - 140)) + 'px';
    menu.style.insetBlockStart = Math.max(8, Math.min(e.clientY - rect.top, rect.height - 56)) + 'px';
    this.element.append(menu);

    // * Esc closes the menu, not the page under it
    const close = () => {
      menu.remove();
      document.removeEventListener('pointerdown', onDown, true);
      release();
      if(this.closeMenu === close) this.closeMenu = undefined;
    };
    const onDown = (event: Event) => {
      if(!menu.contains(event.target as Node)) close();
    };
    const release = holdEscape(close);
    this.closeMenu = close;
    document.addEventListener('pointerdown', onDown, true);
  }

  // ------------------------------------------------------------------ asking

  /** The user's message, then the answer as it is written. A registered prefix goes to its handler instead. */
  public send(text: string) {
    text = (text || '').trim();
    if(!text || this.busy) return;
    this.setNotice();

    const intercepted = findInterceptor(getAssistantInterceptors(), text);
    if(intercepted) {
      this.addMessage({role: 'user', type: 'text', text});
      Promise.resolve().then(() => intercepted.interceptor.handle(intercepted.rest, this.api)).catch((err) => {
        this.addMessage({role: 'assistant', type: 'text', text: ''});
        const last = this.conversation.messages[this.conversation.messages.length - 1];
        this.updateMessage(last.id, {error: err instanceof LuckgramApiError ? err.code : LuckgramApiError.UPSTREAM_UNAVAILABLE});
      });
      return;
    }

    this.addMessage({role: 'user', type: 'text', text});
    this.ask();
  }

  private async ask() {
    const conversation = this.conversation;
    const run = ++this.run;
    const abort = this.abort = new AbortController();
    const context = buildContext(conversation);
    const answer = this.addMessage({role: 'assistant', type: 'text', text: '', partial: true});
    this.updateSendButton();
    const isCurrent = () => !this.destroyed && this.conversation === conversation;

    let scheduled = false, latest = '';
    try {
      const text = await this.options.chat({
        task: (conversation.task as any) || 'chat',
        messages: context,
        signal: abort.signal,
        onDelta: (_delta, whole) => {
          latest = whole;
          if(scheduled) return;
          scheduled = true;
          requestAnimationFrame(() => {
            scheduled = false;
            if(this.run === run && isCurrent() && this.abort === abort) this.updateMessage(answer.id, {text: latest}, false);
          });
        }
      });

      answer.text = text || latest;
      answer.partial = false;
      if(!answer.text.trim()) answer.error = LuckgramApiError.UPSTREAM_UNAVAILABLE;
    } catch(err) {
      // * stopped is stopped, whatever the request's own end says of it
      const code = abort.signal.aborted ? LuckgramApiError.CANCELLED :
        (err instanceof LuckgramApiError ? err.code : LuckgramApiError.UPSTREAM_UNAVAILABLE);
      answer.text = latest;
      answer.partial = false;
      // * stopped by the user: what was written so far is the answer
      if(code !== LuckgramApiError.CANCELLED) answer.error = code;
      else if(!answer.text.trim()) conversation.messages.splice(conversation.messages.indexOf(answer), 1);
    } finally {
      if(this.abort === abort) this.abort = undefined;
      // * the conversation is kept whichever one is on screen by now
      conversation.updatedAt = this.now();
      this.options.store.save(conversation);
      if(isCurrent()) {
        if(conversation.messages.includes(answer)) this.updateMessage(answer.id, {}, false);
        else this.bubbles.get(answer.id)?.remove();
        this.updateSendButton();
      }
    }
  }

  public stop() {
    this.abort?.abort();
  }

  // ------------------------------------------------------------------ conversations

  private show(conversation: Conversation) {
    this.stop();
    this.abort = undefined;
    this.conversation = conversation;
    this.toggleHistory(false);
    this.renderMessages();
    this.updateSendButton();
  }

  /** The conversation with this key, made with these properties when there is none; without a key, a new one. */
  public async openConversation(properties: {key?: string, task?: string, system?: string, title?: string} = {}): Promise<Conversation> {
    await this.options.store.ready;
    let conversation = properties.key ? this.options.store.findByKey(this.options.account, properties.key) : undefined;
    if(!conversation) {
      // * an untouched new conversation is not kept: nothing was said in it
      conversation = newConversation(this.options.account, this.now(), properties);
      if(properties.key) await this.options.store.save(conversation);
    }

    this.show(conversation);
    this.field.focus();
    return conversation;
  }

  private toggleHistory(open = this.historyEl.classList.contains('hide')) {
    this.historyEl.classList.toggle('hide', !open);
    // * Esc goes back from the history to the conversation before it leaves the page
    this.historyEscape?.();
    this.historyEscape = open ? holdEscape(() => this.toggleHistory(false)) : undefined;
    this.historyButton.classList.toggle('is-active', open);
    this.historyButton.setAttribute('aria-expanded', String(open));
    if(open) this.renderHistory();
  }

  private renderHistory() {
    const conversations = this.options.store.list(this.options.account);
    if(!conversations.length) {
      this.historyEl.replaceChildren(el('div', 'luckgram-ai-history-empty', lgText('还没有对话', 'No conversations yet')));
      return;
    }

    this.historyEl.replaceChildren(...conversations.map((conversation) => {
      const row = el('div', 'luckgram-ai-history-row');
      row.classList.toggle('is-current', conversation.id === this.conversation.id);
      const title = conversation.title || lgText('新对话', 'New chat');
      const open = button('luckgram-ai-history-open', '', () => this.show(conversation));
      open.append(
        el('span', 'luckgram-ai-history-title', title),
        el('span', 'luckgram-ai-history-date', new Date(conversation.updatedAt).toLocaleString(undefined, {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'}))
      );
      const remove = button('luckgram-ai-text-button is-danger', lgText('删除', 'Delete'), async() => {
        const confirmed = this.options.confirmDelete ? await this.options.confirmDelete(title) : true;
        if(!confirmed) return;
        await this.options.store.delete(this.options.account, conversation.id);
        if(conversation.id === this.conversation.id) {
          this.conversation = newConversation(this.options.account, this.now());
          this.renderMessages();
        }

        this.renderHistory();
      });
      row.append(open, remove);
      return row;
    }));
  }

  public focus() {
    this.field.focus();
  }

  public destroy() {
    this.destroyed = true;
    this.closeMenu?.();
    this.historyEscape?.();
    this.stop();
    this.element.remove();
  }
}
