/*
 * Luckgram Web (luckgram-specs#185, W5 需求 6–8): a received message's translation, in its
 * own bubble under the original.
 *
 *  - the message menu's "翻译" / "撤销翻译" (contextMenu.ts asks here);
 *  - with `translate_in` on, an icon beside somebody else's message in a language that is not on
 *    the do-not-translate list: one tap does the same;
 *  - which messages show their translation is kept (cache.ts), so a reload shows them again.
 *
 * Upstream calls `decorateTranslatedBubble` as it draws a bubble; nothing else of the bubble's
 * code is touched. With the feature off or held back as a preview, upstream's own "Translate"
 * (a popup) is what the menu has.
 */

import {createEffect, createRoot, on} from 'solid-js';
import type {Message} from '@layer';
import Icon from '@components/icon';
import {toast} from '@components/toast';
import {attachClickEvent} from '@helpers/dom/clickEvent';
import getDoNotTranslateLanguages from '@helpers/getDoNotTranslateLanguages';
import wrapRichText from '@lib/richTextProcessor/wrapRichText';
import {useAppSettings} from '@stores/appSettings';
import {isFeatureEnabled} from '@/luckgram/core/features';
import {useFeatureEnabled, useStringSetting} from '@/luckgram/core/hooks';
import {lgText} from '@/luckgram/text';
import {KEY_TRANSLATE_TO, TRANSLATE_IN, isOwnSender, shouldOfferQuickTranslate} from '@/luckgram/translate/logic';
import {
  detectTextLanguage, getIncomingTarget, getLanguageName, getTranslateAccount, getTranslateErrorText, translate, translationCache
} from '@/luckgram/translate';

const BLOCK_CLASS = 'luckgram-translation';
const BUTTON_CLASS = 'luckgram-translate-button';

type Decorated = HTMLElement & {luckgramMessage?: Message.message, luckgramRun?: number, luckgramBusy?: boolean};

export const isIncomingTranslateOn = () => isFeatureEnabled(TRANSLATE_IN);

const getText = (message: Message.message) => (message?._ === 'message' && message.message) || '';

/**
 * Whether the message is the user's own. In Saved Messages a message has no `out` flag though it is
 * drawn as one of the user's: the bubble's side and the sender say it too.
 */
function isOwnMessage(bubble: HTMLElement, message: Message.message) {
  return !!message.pFlags.out || bubble.classList.contains('is-out') || isOwnSender(message, getTranslateAccount());
}


export function isMessageTranslated(message: Message.message) {
  return !!translationCache.getState(getTranslateAccount(), message.peerId, message.mid);
}

/** Whether the menu offers Luckgram's translation for this message (otherwise upstream's own item stays). */
export function canTranslateInBubble(message: Message.message | undefined, isTextSelected?: boolean) {
  return isIncomingTranslateOn() && !isTextSelected && !!getText(message) && message.media?._ !== 'messageMediaPoll';
}

export const getTranslateMenuText = (message: Message.message) => {
  return isMessageTranslated(message) ? lgText('撤销翻译', 'Undo translation') : lgText('翻译', 'Translate');
};

function getMessageDiv(bubble: HTMLElement) {
  return bubble.querySelector<HTMLElement>('.message');
}

function removeBlock(bubble: HTMLElement) {
  bubble.querySelectorAll('.' + BLOCK_CLASS).forEach((element) => element.remove());
  bubble.classList.remove('is-luckgram-translated');
}

function makeBlock(bubble: HTMLElement) {
  const messageDiv = getMessageDiv(bubble);
  if(!messageDiv) return;

  removeBlock(bubble);
  const block = document.createElement('div');
  block.classList.add(BLOCK_CLASS, 'is-loading');
  block.dir = 'auto';

  const header = document.createElement('div');
  header.classList.add(BLOCK_CLASS + '-header');
  header.textContent = lgText('正在翻译…', 'Translating…');

  const text = document.createElement('div');
  text.classList.add(BLOCK_CLASS + '-text');
  block.append(header, text);

  // * before the time, which floats at the end of the text
  const time = [...messageDiv.children].find((element) => element.classList.contains('time'));
  if(time) messageDiv.insertBefore(block, time);
  else messageDiv.append(block);

  bubble.classList.add('is-luckgram-translated');
  return {block, header, text};
}

async function showTranslation(bubble: Decorated, message: Message.message, toLang: string, byUser: boolean) {
  const run = bubble.luckgramRun = (bubble.luckgramRun || 0) + 1;
  const parts = makeBlock(bubble);
  if(!parts) return;

  const source = getText(message);
  bubble.luckgramBusy = true;
  try {
    const translation = await translate({
      text: source,
      entities: message.totalEntities as any,
      toLang,
      peerId: message.peerId as any,
      mid: message.mid
    });

    // * not `isConnected`: a bubble is drawn before it is put into the page
    if(bubble.luckgramRun !== run || !bubble.contains(parts.block)) return;
    const from = getLanguageName(translation.from);
    const to = getLanguageName(toLang);
    parts.header.textContent = from && from !== to ?
      lgText(`已翻译 · ${from} → ${to}`, `Translated · ${from} → ${to}`) :
      lgText(`已翻译 · ${to}`, `Translated · ${to}`);
    parts.text.replaceChildren(wrapRichText(translation.text, {entities: translation.entities as any}));
    parts.block.classList.remove('is-loading');
  } catch(err) {
    if(bubble.luckgramRun !== run) return;
    removeBlock(bubble);
    translationCache.setState(getTranslateAccount(), message.peerId, message.mid, undefined);
    updateButton(bubble, message);
    // * a translation that only comes back with the page says nothing when it fails
    if(byUser) toast(getTranslateErrorText(err));
  } finally {
    if(bubble.luckgramRun === run) bubble.luckgramBusy = false;
  }
}

/** The menu's item and the icon: translate, or take the translation back. */
export function toggleMessageTranslation(bubble: HTMLElement | undefined, message: Message.message) {
  const account = getTranslateAccount();
  if(isMessageTranslated(message)) {
    translationCache.setState(account, message.peerId, message.mid, undefined);
    if(bubble) {
      (bubble as Decorated).luckgramRun = ((bubble as Decorated).luckgramRun || 0) + 1;
      removeBlock(bubble);
      updateButton(bubble, message);
    }

    return;
  }

  const toLang = getIncomingTarget();
  translationCache.setState(account, message.peerId, message.mid, toLang);
  if(bubble) {
    showTranslation(bubble, message, toLang, true);
    updateButton(bubble, message);
  }
}

// ------------------------------------------------------------------ the one-tap icon

function removeButton(bubble: HTMLElement) {
  bubble.querySelectorAll('.' + BUTTON_CLASS).forEach((element) => element.remove());
}

async function updateButton(bubble: Decorated, message: Message.message) {
  const text = getText(message);
  const [appSettings] = useAppSettings();
  // * nothing is looked at while the feature is off or held back
  if(!isIncomingTranslateOn()) {
    removeButton(bubble);
    return;
  }

  const own = isOwnMessage(bubble, message);
  const detected = !own && text ? await detectTextLanguage(text) : undefined;
  if(bubble.luckgramMessage !== message) return;

  const offered = isIncomingTranslateOn() && shouldOfferQuickTranslate({
    out: own,
    hasText: !!text,
    detected,
    doNotTranslate: getDoNotTranslateLanguages(appSettings.translations.doNotTranslate),
    target: getIncomingTarget()
  });

  // * a translated message keeps its icon, to take the translation back
  if(!offered && !(isIncomingTranslateOn() && !own && isMessageTranslated(message))) {
    removeButton(bubble);
    return;
  }

  let button = bubble.querySelector<HTMLElement>('.' + BUTTON_CLASS);
  if(!button) {
    const container = bubble.querySelector<HTMLElement>('.bubble-content') || bubble;
    button = document.createElement('div');
    button.classList.add(BUTTON_CLASS);
    button.setAttribute('role', 'button');
    button.tabIndex = -1;
    button.append(Icon('premium_translate'));
    attachClickEvent(button, (e) => {
      e.stopPropagation();
      e.preventDefault();
      const current = (bubble as Decorated).luckgramMessage;
      if(current) toggleMessageTranslation(bubble, current);
    });
    container.append(button);
  }

  const translated = isMessageTranslated(message);
  button.classList.toggle('is-active', translated);
  const label = translated ? lgText('撤销翻译', 'Undo translation') : lgText('翻译', 'Translate');
  button.title = label;
  button.setAttribute('aria-label', label);
}

// ------------------------------------------------------------------ drawing a bubble

/**
 * Called by upstream when a bubble of a message was drawn (again): shows the translation the
 * message had, and the icon. Safe to call any number of times.
 */
export function decorateTranslatedBubble(bubble: HTMLElement, message: Message.message | Message.messageService, tries = 0) {
  // * drawing the bubble never depends on this
  try {
    decorate(bubble, message, tries);
  } catch(err) {
    console.warn('[luckgram] translate: bubble', (err as Error)?.message);
  }
}

function decorate(bubble: HTMLElement, message: Message.message | Message.messageService, tries: number) {
  const decorated = bubble as Decorated;
  if(message?._ !== 'message') {
    decorated.luckgramMessage = undefined;
    return;
  }

  decorated.luckgramMessage = message;
  watchSettings();

  // * the text arrives a moment after the bubble does
  if(!getMessageDiv(bubble) && getText(message) && tries < 20) {
    requestAnimationFrame(() => {
      if(decorated.luckgramMessage === message && (bubble.isConnected || tries < 5)) decorateTranslatedBubble(bubble, message, tries + 1);
    });
    return;
  }

  translationCache.ready.then(() => {
    if(decorated.luckgramMessage !== message) return;

    const toLang = isIncomingTranslateOn() && getText(message) ?
      translationCache.getState(getTranslateAccount(), message.peerId, message.mid) :
      undefined;
    if(toLang) {
      // * also when a block was left waiting by a drawing that was thrown away
      const block = bubble.querySelector('.' + BLOCK_CLASS);
      if(!block || (block.classList.contains('is-loading') && !decorated.luckgramBusy)) showTranslation(decorated, message, toLang, false);
    } else {
      removeBlock(bubble);
    }

    updateButton(decorated, message);
  }).catch((err) => console.warn('[luckgram] translate: bubble', (err as Error)?.message));
}

/** The last message of the other side that is on screen: the language a draft is translated to by default. */
export function getLastIncomingText(container: HTMLElement | undefined): string | undefined {
  const bubbles = container?.querySelectorAll<Decorated>('.bubble.is-in');
  for(let i = (bubbles?.length || 0) - 1; i >= 0; --i) {
    const text = getText(bubbles[i].luckgramMessage);
    if(text) return text;
  }
}

// ------------------------------------------------------------------ a setting changed: the bubbles on screen follow

let watching = false;
function watchSettings() {
  if(watching) return;
  watching = true;

  createRoot(() => {
    const [appSettings] = useAppSettings();
    const target = useStringSetting(KEY_TRANSLATE_TO);
    // * the switch, the server's say and the preview list
    const enabled = useFeatureEnabled(TRANSLATE_IN);
    createEffect(on(
      () => [enabled(), target(), appSettings.translations.doNotTranslate.join(',')],
      () => {
        document.querySelectorAll<Decorated>('.bubbles .bubble').forEach((bubble) => {
          if(bubble.luckgramMessage) decorateTranslatedBubble(bubble, bubble.luckgramMessage);
        });
      },
      {defer: true}
    ));
  });
}
