/*
 * Luckgram Web (luckgram-specs#187, W7): the ✦ button of the message field and what hangs off
 * it — the menu (AI reply, the five effects, on a narrow window also W5's translation), the
 * rewriting of the field in place, the bar that gives the previous text back, and the panel over
 * the field that a feature can fill (registry.ts).
 *
 * Everything goes through the Luckgram server (`/v1/ai/chat`, the AI client: consent, the unified
 * error texts). Upstream's own AI editor — its button in a tall field, its popup — is not touched.
 * One controller per chat input; input.ts creates it, mounts it and tells it when the field changed.
 */

import type ChatInput from '@components/chat/input';
import {ButtonMenuItemOptionsVerifiable, ButtonMenuSync} from '@components/buttonMenu';
import {mountSendMenu} from '@components/chat/sendContextMenu';
import deriveEditorDraftContent from '@components/chat/inputEditor/draftContent';
import {toast} from '@components/toast';
import contextMenuController from '@helpers/contextMenuController';
import {attachClickEvent} from '@helpers/dom/clickEvent';
import getRichValueWithCaret from '@helpers/dom/getRichValueWithCaret';
import ListenerSetter from '@helpers/listenerSetter';
import {getMiddleware} from '@helpers/middleware';
import draftTextWithEntities from '@lib/richTextProcessor/draftTextWithEntities';
import {isFeatureEnabled} from '@/luckgram/core/features';
import {watchFeatures} from '@/luckgram/core/hooks';
import {LuckgramApiError} from '@/luckgram/core/errors';
import {getAiErrorText} from '@/luckgram/writing/errors';
import luckgramAI from '@/luckgram/core/instance';
import {lgText} from '@/luckgram/text';
import {TranslationEntity, isFormattingLost} from '@/luckgram/translate/logic';
import {AI_REPLY, AI_WRITING, ORDER_EFFECTS, ORDER_TRANSLATE, WRITING_EFFECTS, WritingEffect, getMenuItems, isTooLong} from '@/luckgram/writing/logic';
import {AiMenuItem, AiWritingHost, getAiMenuItems} from '@/luckgram/writing/registry';
import {registerAiWritingFeatures} from '@/luckgram/writing/features';
import {NARROW_QUERY, isTranslateInAiMenu} from '@/luckgram/writing/narrow';

type Draft = {text: string, entities: TranslationEntity[]};

export default class LuckgramAiWriting {
  private button: HTMLElement;
  private notice: HTMLElement;
  private panel: HTMLElement;
  private panelOnClose: () => void;
  private previous: Draft;
  private resultText: string;
  private peerId: PeerId;
  private busy = false;
  private run = 0;
  private abort: AbortController;
  private keysBound = false;

  constructor(private input: ChatInput) {}

  private get writingOn() {
    return isFeatureEnabled(AI_WRITING);
  }

  private get replyOn() {
    return isFeatureEnabled(AI_REPLY);
  }

  // ------------------------------------------------------------------ the field

  private get field(): HTMLElement {
    return (this.input as any).messageInputField?.input;
  }

  private getDraft(): Draft {
    if(!this.field) return {text: '', entities: []};
    const {value, entities} = getRichValueWithCaret(this.field, true, false);
    return {text: value || '', entities: (entities || []) as any};
  }

  /** A table, a formula, media in the text: what only upstream's rich editor can write back. */
  private isRichDraft() {
    try {
      return !!deriveEditorDraftContent((this.input as any).messageInputEditor).richMessage;
    } catch(err) {
      return false;
    }
  }

  private toValue(draft: Draft) {
    return draftTextWithEntities({_: 'draftMessage', message: draft.text, entities: draft.entities as any, pFlags: {}, date: 0} as any);
  }

  private setDraft(draft: Draft) {
    this.input.setInputValue(this.toValue(draft), false, true);
  }

  /** While a result is being written: the field shows it, nothing is saved or announced as typing. */
  private setDraftSilently(text: string) {
    try {
      (this.input as any).messageInputField.setValueSilently(this.toValue({text, entities: []}));
    } catch(err) {}
  }

  // ------------------------------------------------------------------ the host of the extension points

  public getHost(): AiWritingHost {
    const peerId = this.input.chat.peerId;
    const middleware = this.input.getMiddleware();
    const isCurrent = () => middleware() && this.input.chat.peerId === peerId;
    return {
      peerId,
      chatInput: this.input,
      getText: () => this.getDraft().text,
      isEmpty: () => this.input.isInputEmpty(),
      setText: (text, options) => {
        if(!isCurrent()) return;
        const previous = this.getDraft();
        this.setDraft({text, entities: []});
        if(options?.undoable) this.remember(previous, options.notice || lgText('已替换', 'Replaced'), false);
        else this.forget();
      },
      canUndo: () => !!this.previous,
      undo: () => this.undo(),
      showPanel: (element, onClose) => isCurrent() && this.showPanel(element, onClose),
      hidePanel: () => this.hidePanel(),
      isCurrent
    };
  }

  // ------------------------------------------------------------------ the button

  /** After the send button is in the row. */
  public mount() {
    const container = this.input.btnSendContainer;
    if(!container?.parentElement || this.button) return;

    // * a glyph of the icon font's own size, like the row's other buttons
    this.button = this.input.createButtonIcon('edit_stars luckgram-ai-button', {noRipple: true});
    this.button.classList.add('hide');
    this.button.title = lgText('AI', 'AI');
    this.button.setAttribute('aria-label', lgText('AI 写作与回复', 'AI writing and reply'));
    attachClickEvent(this.button, (e) => {
      e.preventDefault();
      e.stopPropagation();
      if(this.busy) this.stop();
      else this.openMenu();
    });
    container.parentElement.insertBefore(this.button, container);
    registerAiWritingFeatures();
    // * the switches in the settings take effect at once; W5's translate one too, for the narrow window's menu
    const stop = watchFeatures([AI_WRITING, AI_REPLY, 'translate_out'], () => {
      this.input.luckgramTranslateOut?.update();
      this.update();
    });
    (this.input.chat as any)?.destroyMiddlewareHelper?.get().onDestroy(stop);

    // * the window got narrow or wide: W5's translate button moves into the menu or out of it
    try {
      window.matchMedia(NARROW_QUERY).addEventListener('change', () => {
        this.input.luckgramTranslateOut?.update();
        this.update();
      });
    } catch(err) {}

    this.update();
  }

  /** The items the menu would show now. */
  private getItems(): AiMenuItem[] {
    const empty = this.input.isInputEmpty();
    const rich = !empty && this.isRichDraft();
    const builtIn: AiMenuItem[] = this.writingOn ? WRITING_EFFECTS.map(({effect, title, icon}, index) => ({
      key: 'writing_' + effect, title, icon: icon as Icon, order: ORDER_EFFECTS + index * 10, onClick: () => this.applyEffect(effect)
    })) : [];

    // * AI reply is on its own switch; anything else registered rides on AI writing
    const registered = getAiMenuItems().filter((item) => item.key === 'reply' ? this.replyOn : this.writingOn);
    return getMenuItems([...registered, ...builtIn], {empty, rich}, this.getHost());
  }

  /** W5's "翻译" and "翻译成…", when a narrow window has no button for them. */
  private getTranslateButtons(): ButtonMenuItemOptionsVerifiable[] {
    if(!isTranslateInAiMenu() || this.input.isInputEmpty()) return [];
    // * "翻译" first, then "翻译成…": the send button's menu has them the other way round
    return (this.input.luckgramTranslateOut?.getMenuButtons() || []).filter((button) => button.verify?.() !== false).reverse();
  }

  /** The field or the chat changed (input.ts: updateSendBtn). */
  public update() {
    try {
      if(this.peerId !== this.input.chat?.peerId) {
        this.peerId = this.input.chat?.peerId;
        this.reset();
      }

      const recording = !!(this.input as any).recording;
      const visible = !recording && (this.busy || this.getItems().length > 0 || this.getTranslateButtons().length > 0);
      this.button?.classList.toggle('hide', !visible);

      // * the bar goes with the text it was about
      if(this.notice && !this.busy && this.input.isInputEmpty()) this.forget();
    } catch(err) {
      console.warn('[luckgram] ai writing: field', (err as Error)?.message);
    }
  }

  /** The message was sent, or another chat opened. */
  public reset() {
    this.stop();
    this.forget();
    this.hidePanel();
  }

  // ------------------------------------------------------------------ the menu

  private openMenu() {
    const items = this.getItems();
    const translate = this.getTranslateButtons();
    if(!items.length && !translate.length) return;

    const host = this.getHost();
    const buttons: ButtonMenuItemOptionsVerifiable[] = items.map((item) => ({
      // * an item registered without one gets a plain mark, so that every text starts at the same place
      icon: item.icon || 'edit_stars',
      regularText: lgText(...item.title),
      onClick: () => {
        try {
          item.onClick(host);
        } catch(err) {
          console.warn('[luckgram] ai menu item', item.key, (err as Error)?.message);
        }
      },
      verify: () => true
    }));
    translate.forEach((button, index) => buttons.push({...button, separator: index === 0 && buttons.length > 0}));

    const listenerSetter = new ListenerSetter();
    const middlewareHelper = getMiddleware();
    const element = ButtonMenuSync({buttons, listenerSetter});
    element.classList.add('menu-send', 'top-left', 'luckgram-ai-menu');
    mountSendMenu(element, this.button, 'top-left', middlewareHelper.get());
    contextMenuController.openBtnMenu(element, () => {
      listenerSetter.removeAll();
      middlewareHelper.destroy();
      setTimeout(() => element.remove(), 400);
    }, this.button);
  }

  // ------------------------------------------------------------------ the five effects

  private setBusy(busy: boolean) {
    this.busy = busy;
    this.button?.classList.toggle('is-loading', busy);
    this.field?.classList.toggle('luckgram-ai-working', busy);
    if(this.button) this.button.title = busy ? lgText('停止', 'Stop') : lgText('AI', 'AI');
  }

  /** A press on the button while it writes: the field gets its text back. */
  private stop() {
    if(!this.busy) return;
    ++this.run;
    this.abort?.abort();
  }

  private async applyEffect(effect: WritingEffect) {
    if(this.busy || !this.writingOn) return;

    const draft = this.getDraft();
    if(!draft.text.trim()) return;
    if(isTooLong(draft.text)) {
      toast(lgText('这段文字太长，无法处理', 'This text is too long to rewrite'));
      return;
    }

    const run = ++this.run;
    const peerId = this.input.chat.peerId;
    const abort = this.abort = new AbortController();
    const isCurrent = () => this.run === run && this.input.chat.peerId === peerId;
    let wrote = false;
    this.forget();
    this.setBusy(true);

    try {
      let pending: string, scheduled = false;
      const text = await luckgramAI.chat({
        task: 'writing',
        params: {effect},
        messages: [{role: 'user', content: draft.text}],
        signal: abort.signal,
        // * as it is written, a frame at a time: the original stays, greyed, until the first words come
        onDelta: (_delta, whole) => {
          pending = whole;
          if(scheduled) return;
          scheduled = true;
          requestAnimationFrame(() => {
            scheduled = false;
            if(!isCurrent() || !this.busy || !pending.trim()) return;
            wrote = true;
            this.field?.classList.remove('luckgram-ai-working');
            this.setDraftSilently(pending);
          });
        }
      });

      if(!isCurrent()) return;
      const result = (text || '').trim();
      if(!result) throw new LuckgramApiError(LuckgramApiError.UPSTREAM_UNAVAILABLE);

      this.setBusy(false);
      this.setDraft({text: result, entities: []});
      const done = WRITING_EFFECTS.find((item) => item.effect === effect).done;
      this.remember(draft, lgText(...done), isFormattingLost(draft.entities, {text: result, via: 'luckgram'}));
    } catch(err) {
      // * stopped, failed, or the chat was left: what was typed is back
      if(this.input.chat.peerId === peerId && (wrote || this.run === run)) {
        if(wrote) this.setDraft(draft);
      }

      const cancelled = this.run !== run || (err instanceof LuckgramApiError && err.code === LuckgramApiError.CANCELLED);
      if(!cancelled) toast(getAiErrorText(err));
    } finally {
      if(this.abort === abort) {
        this.abort = undefined;
        this.setBusy(false);
        this.update();
      }
    }
  }

  // ------------------------------------------------------------------ "已润色 · 撤销"

  private remember(previous: Draft, text: string, formattingLost: boolean) {
    this.previous = previous;
    this.resultText = this.getDraft().text;
    this.showNotice(text + (formattingLost ? lgText(' · 格式未保留', ' · formatting not kept') : ''));
    this.bindKeys();
  }

  private forget() {
    this.previous = this.resultText = undefined;
    this.notice?.remove();
    this.notice = undefined;
  }

  private undo() {
    const previous = this.previous;
    this.forget();
    if(previous) this.setDraft(previous);
  }

  private showNotice(text: string) {
    this.notice?.remove();
    const notice = this.notice = document.createElement('div');
    notice.classList.add('luckgram-translate-bar', 'luckgram-ai-notice');

    const label = document.createElement('span');
    label.classList.add('luckgram-translate-bar-text');
    label.textContent = text;

    const undo = document.createElement('button');
    undo.type = 'button';
    undo.classList.add('luckgram-translate-bar-undo');
    undo.textContent = lgText('撤销', 'Undo');
    attachClickEvent(undo, (e) => {
      e.preventDefault();
      this.undo();
    });

    notice.append(label, undo);
    this.insertOverField(notice);
  }

  private insertOverField(element: HTMLElement) {
    const row = this.button?.parentElement;
    if(row?.parentElement) row.parentElement.insertBefore(element, row);
  }

  /** Ctrl/⌘+Z right after a rewrite gives the previous text back; Esc closes the panel. */
  private bindKeys() {
    if(this.keysBound || !this.input.rowsWrapper) return;
    this.keysBound = true;
    this.input.rowsWrapper.addEventListener('keydown', (e: KeyboardEvent) => {
      if(e.key === 'Escape' && this.panel) {
        e.preventDefault();
        e.stopPropagation();
        this.hidePanel();
        return;
      }

      const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z';
      // * only while the field still holds the result untouched: after that the keys are the editor's own
      if(isUndo && this.previous && this.getDraft().text === this.resultText) {
        e.preventDefault();
        e.stopPropagation();
        this.undo();
      }
    }, true);
  }

  // ------------------------------------------------------------------ the panel over the field

  private showPanel(content: HTMLElement, onClose?: () => void) {
    this.hidePanel();
    const panel = this.panel = document.createElement('div');
    panel.classList.add('luckgram-ai-panel');
    panel.append(content);
    this.panelOnClose = onClose;
    this.insertOverField(panel);
    this.bindKeys();
  }

  private hidePanel() {
    const onClose = this.panelOnClose;
    this.panelOnClose = undefined;
    this.panel?.remove();
    this.panel = undefined;
    try {
      onClose?.();
    } catch(err) {}
  }
}
