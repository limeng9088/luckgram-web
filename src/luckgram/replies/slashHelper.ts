/*
 * Luckgram Web (luckgram-specs#190, W11b 需求 10): the templates a "/…" at the field's start
 * asks for, in upstream's own panel of suggestions over the field — in every chat, under the
 * bot commands where there are any (the two are siblings: one does not hide the other).
 */

import AutocompleteHelper from '@components/chat/autocompleteHelper';
import type AutocompleteHelperController from '@components/chat/autocompleteHelperController';
import {lgText} from '@/luckgram/text';
import {QuickReply, VISIBLE_REPLIES, getReplyPreview} from '@/luckgram/replies/logic';

/** A template's row in a panel of suggestions: this helper's own, or the bot commands' (they come after the commands). */
export function makeReplyRow(item: QuickReply, ownerDocument: Document = document) {
  const row = ownerDocument.createElement('div');
  row.classList.add('luckgram-replies-helper-item');
  row.dataset.replyId = item.id;
  row.setAttribute('role', 'option');
  row.setAttribute('aria-selected', 'false');
  row.dir = 'auto';
  row.textContent = getReplyPreview(item.text);
  return row;
}

export default class RepliesSlashHelper extends AutocompleteHelper {
  private items: QuickReply[] = [];

  constructor(appendTo: HTMLElement, controller: AutocompleteHelperController, onPick: (reply: QuickReply) => void) {
    super({
      appendTo,
      controller,
      listType: 'y',
      onSelect: (target) => {
        const reply = this.items.find((item) => item.id === (target as HTMLElement)?.dataset?.replyId);
        if(reply) onPick(reply);
      }
    });

    this.container.classList.add('luckgram-replies-helper');
    this.container.setAttribute('role', 'listbox');
    this.container.setAttribute('aria-label', lgText('快捷回复', 'Quick replies'));
  }

  public init() {
    this.list = this.container.ownerDocument.createElement('div');
    this.list.classList.add('luckgram-replies-helper-list');
    this.list.style.setProperty('--luckgram-replies-rows', String(VISIBLE_REPLIES));
    this.container.append(this.list);
  }

  /** Shows these templates; hides when there are none. */
  public show(items: QuickReply[] | undefined) {
    if(!items?.length) {
      if(!this.init) this.toggle(true);
      return false;
    }

    if(this.init) {
      this.init();
      this.init = null;
    }

    this.items = items;
    this.list.replaceChildren(...items.map((item) => makeReplyRow(item, this.container.ownerDocument)));

    this.toggle(false);
    return true;
  }
}
