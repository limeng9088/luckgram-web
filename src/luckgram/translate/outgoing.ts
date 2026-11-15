/*
 * Luckgram Web (luckgram-specs#185, W5 需求 9–11): a draft translated before it is sent.
 *
 *  - with `translate_out` on and text in the field, a button left of the send button: the text is
 *    translated to the chat's language and replaced in place; a bar over the field says
 *    "已翻译成 西班牙语 · 撤销" and gives the original back;
 *  - the send button's menu has "翻译成…" (pick the language) and "翻译";
 *  - the language is remembered per chat; with none, the language of the other side's last
 *    message, then English.
 *
 * Upstream's own AI editor (its button in the field, translate / fix / style) is left as it is.
 * One controller per chat input; input.ts creates it, mounts it and tells it when the field changed.
 */

import type ChatInput from '@components/chat/input';
import type {ButtonMenuItemOptionsVerifiable} from '@components/buttonMenu';
import {pickLanguage} from '@components/chat/translation';
import {toast} from '@components/toast';
import {attachClickEvent} from '@helpers/dom/clickEvent';
import getRichValueWithCaret from '@helpers/dom/getRichValueWithCaret';
import draftTextWithEntities from '@lib/richTextProcessor/draftTextWithEntities';
import LuckgramSettings from '@/luckgram/core/settings';
import {isFeatureEnabled} from '@/luckgram/core/features';
import {watchFeatures} from '@/luckgram/core/hooks';
import {lgText} from '@/luckgram/text';
import {
  KEY_OUT_LANGS, TRANSLATE_OUT, TranslationEntity, getOutLang, getOutgoingTargetLang, isFormattingLost, parseOutLangs, rememberOutLang
} from '@/luckgram/translate/logic';
import {detectTextLanguage, getLanguageName, getTranslateErrorText, translate} from '@/luckgram/translate';
import {getLastIncomingText} from '@/luckgram/translate/incoming';
import {isTranslateInAiMenu} from '@/luckgram/writing/narrow';

type Draft = {text: string, entities: TranslationEntity[]};

export default class LuckgramTranslateOut {
  private button: HTMLElement;
  private bar: HTMLElement;
  private original: Draft;
  private translatedText: string;
  private peerId: PeerId;
  private busy = false;

  constructor(private input: ChatInput) {}

  private get isOn() {
    return isFeatureEnabled(TRANSLATE_OUT);
  }

  private getDraft(): Draft {
    const field = (this.input as any).messageInputField?.input as HTMLElement;
    if(!field) return {text: '', entities: []};
    const {value, entities} = getRichValueWithCaret(field, true, false);
    return {text: value || '', entities: (entities || []) as any};
  }

  private setDraft(draft: Draft) {
    this.input.setInputValue(draftTextWithEntities({
      _: 'draftMessage', message: draft.text, entities: draft.entities as any, pFlags: {}, date: 0
    } as any), false, true);
  }

  // ------------------------------------------------------------------ the button

  /** After the send button is in the row. */
  public mount() {
    const container = this.input.btnSendContainer;
    if(!container?.parentElement || this.button) return;

    this.button = this.input.createButtonIcon('premium_translate luckgram-translate-out', {noRipple: true});
    this.button.classList.add('hide');
    this.button.title = lgText('翻译', 'Translate');
    this.button.setAttribute('aria-label', this.button.title);
    attachClickEvent(this.button, (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.translateDraft();
    });
    container.parentElement.insertBefore(this.button, container);
    // * the switch in the settings takes effect at once, not at the next key press
    const stop = watchFeatures([TRANSLATE_OUT], () => this.update());
    (this.input.chat as any)?.destroyMiddlewareHelper?.get().onDestroy(stop);
    this.update();
  }

  /** The field or the chat changed (input.ts: updateSendBtn). */
  public update() {
    // * the field's own work never depends on this
    try {
      this.doUpdate();
    } catch(err) {
      console.warn('[luckgram] translate: field', (err as Error)?.message);
    }
  }

  private doUpdate() {
    if(this.peerId !== this.input.chat?.peerId) {
      this.peerId = this.input.chat?.peerId;
      this.reset();
    }

    const empty = this.input.isInputEmpty();
    // * a narrow window with AI writing: the ✦ menu has "翻译" and "翻译成…" instead (W7 需求 8)
    const visible = this.isOn && !empty && !(this.input as any).recording && !isTranslateInAiMenu();
    this.button?.classList.toggle('hide', !visible);

    // * the bar goes with the text it was about
    if(this.bar && (empty || !this.isOn)) this.reset();
  }

  /** The message was sent, or another chat opened: nothing to give back. */
  public reset() {
    this.original = this.translatedText = undefined;
    this.bar?.remove();
    this.bar = undefined;
  }

  // ------------------------------------------------------------------ the language

  private async getTargetLang() {
    const remembered = getOutLang(parseOutLangs(LuckgramSettings.getString(KEY_OUT_LANGS)), this.input.chat.peerId as any);
    if(remembered) return remembered;

    const lastIncoming = getLastIncomingText((this.input.chat as any).bubbles?.container);
    return getOutgoingTargetLang(undefined, lastIncoming ? await detectTextLanguage(lastIncoming) : undefined);
  }

  private rememberTargetLang(lang: string) {
    const langs = rememberOutLang(parseOutLangs(LuckgramSettings.getString(KEY_OUT_LANGS)), this.input.chat.peerId as any, lang);
    return LuckgramSettings.set(KEY_OUT_LANGS, JSON.stringify(langs));
  }

  // ------------------------------------------------------------------ translating

  /** @param lang a language picked now ("翻译成…"): remembered for the chat */
  public async translateDraft(lang?: string) {
    if(this.busy || !this.isOn) return;

    // * a second press translates the original again, not the translation
    const current = this.getDraft();
    const draft = this.original && current.text === this.translatedText ? this.original : current;
    if(!draft.text.trim()) return;

    const peerId = this.input.chat.peerId;
    this.busy = true;
    this.button?.classList.add('is-loading');
    try {
      if(lang) await this.rememberTargetLang(lang);
      const toLang = lang || await this.getTargetLang();
      const translation = await translate({text: draft.text, entities: draft.entities, toLang});

      // * the chat was left, or the text was changed while the answer was on its way
      if(this.input.chat.peerId !== peerId || this.getDraft().text !== current.text) return;

      this.setDraft({text: translation.text, entities: translation.entities || []});
      this.original = draft;
      this.translatedText = this.getDraft().text;
      this.showBar(toLang, isFormattingLost(draft.entities, translation));
    } catch(err) {
      // * the field keeps what was typed
      toast(getTranslateErrorText(err));
    } finally {
      this.busy = false;
      this.button?.classList.remove('is-loading');
    }
  }

  private undo() {
    const original = this.original;
    this.reset();
    if(original) this.setDraft(original);
  }

  private showBar(toLang: string, formattingLost: boolean) {
    this.bar?.remove();
    const bar = this.bar = document.createElement('div');
    bar.classList.add('luckgram-translate-bar');

    const name = getLanguageName(toLang);
    const text = document.createElement('span');
    text.classList.add('luckgram-translate-bar-text');
    text.textContent = lgText(`已翻译成 ${name}`, `Translated to ${name}`) +
      (formattingLost ? lgText(' · 格式未保留', ' · formatting not kept') : '');

    const undo = document.createElement('button');
    undo.type = 'button';
    undo.classList.add('luckgram-translate-bar-undo');
    undo.textContent = lgText('撤销', 'Undo');
    attachClickEvent(undo, (e) => {
      e.preventDefault();
      this.undo();
    });

    bar.append(text, undo);
    const row = this.button?.parentElement;
    if(row?.parentElement) row.parentElement.insertBefore(bar, row);
  }

  // ------------------------------------------------------------------ the send button's menu

  public getMenuButtons(): ButtonMenuItemOptionsVerifiable[] {
    const verify = () => this.isOn && !this.input.isInputEmpty() && !(this.input as any).recording;
    return [{
      icon: 'premium_translate',
      regularText: lgText('翻译成…', 'Translate to…'),
      onClick: async() => {
        const lang = await pickLanguage(false);
        if(lang) this.translateDraft(lang);
      },
      verify
    }, {
      icon: 'premium_translate',
      regularText: lgText('翻译', 'Translate'),
      onClick: () => {
        this.translateDraft();
      },
      verify
    }];
  }
}
