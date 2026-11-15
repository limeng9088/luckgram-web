/*
 * Luckgram Web (luckgram-specs#190, W11b 需求 7、8、10): quick replies at the message field —
 *
 *   - the button beside the emoji button (a narrow window with the ✦ menu has the item there
 *     instead: the row has no room for a fourth button);
 *   - its list over the field: a press puts the template in at the caret, what was typed stays;
 *     Shift + press, or a long press on a touch screen, sends that template at once and leaves the
 *     field as it was; "管理" at the foot goes to the settings;
 *   - "/…" at the field's start: the templates that begin so, among upstream's suggestions.
 *
 * One of these for each field (input.ts makes it); the templates are the account's (store.ts).
 */

import type AutocompleteHelper from '@components/chat/autocompleteHelper';
import {attachClickEvent} from '@helpers/dom/clickEvent';
import {isFeatureEnabled} from '@/luckgram/core/features';
import {watchFeatures} from '@/luckgram/core/hooks';
import {lgText} from '@/luckgram/text';
import {holdEscape} from '@/luckgram/core/escape';
import {AI_WRITING} from '@/luckgram/writing/logic';
import {NARROW_QUERY, isNarrowWindow} from '@/luckgram/writing/narrow';
import {registerAiMenuItem} from '@/luckgram/writing/registry';
import {QUICK_REPLIES, QuickReply, VISIBLE_REPLIES, getReplyPreview, matchSlash} from '@/luckgram/replies/logic';
import {cleanRepliesOnce, getRepliesAccount, repliesStore} from '@/luckgram/replies/instance';
import {openRepliesManager} from '@/luckgram/replies/openManage';
import RepliesSlashHelper, {makeReplyRow} from '@/luckgram/replies/slashHelper';

const LONG_PRESS = 500;

/** Whether the ✦ menu has the item, and the row no button: a narrow window, with AI writing there. */
export const isRepliesInAiMenu = () => isNarrowWindow() && isFeatureEnabled(AI_WRITING);

// * the item of the ✦ menu: one for all fields, shown only where the button is not
registerAiMenuItem({
  key: 'quick_replies',
  title: ['快捷回复', 'Quick replies'],
  icon: 'message',
  order: 50,
  allowEmpty: true,
  visible: () => isFeatureEnabled(QUICK_REPLIES) && isRepliesInAiMenu(),
  onClick: (host) => {
    (host.chatInput?.luckgramQuickReplies as LuckgramQuickReplies)?.openMenu();
  }
});

export default class LuckgramQuickReplies {
  private button: HTMLElement;
  private menu: HTMLElement;
  private slashHelper: RepliesSlashHelper;
  private commandsHelper: AutocompleteHelper;
  /** the templates the field's "/…" asks for now */
  private slashFound: QuickReply[];
  private closeMenuListeners: () => void;

  // * `input`: upstream's ChatInput (typed loosely: this file is imported by it)
  constructor(private input: any) {}

  private get isOn() {
    return isFeatureEnabled(QUICK_REPLIES) && !!getRepliesAccount();
  }

  private getItems(): QuickReply[] {
    const account = getRepliesAccount();
    return account ? repliesStore.list(account) : [];
  }

  // ------------------------------------------------------------------ the button

  public mount() {
    const anchor: HTMLElement = this.input.btnToggleEmoticons;
    if(!anchor?.parentElement || this.button) return;
    cleanRepliesOnce();

    this.button = this.input.createButtonIcon('message luckgram-replies-button', {noRipple: true});
    this.button.classList.add('hide');
    this.button.title = lgText('快捷回复', 'Quick replies');
    this.button.setAttribute('aria-label', lgText('快捷回复', 'Quick replies'));
    this.button.setAttribute('aria-haspopup', 'listbox');
    attachClickEvent(this.button, (e) => {
      e.preventDefault();
      e.stopPropagation();
      if(this.menu) this.closeMenu();
      else this.openMenu();
    });
    anchor.after(this.button);

    // * the switches in the settings, and the window's width, take effect at once
    const stop = watchFeatures([QUICK_REPLIES, AI_WRITING], () => this.update());
    let media: MediaQueryList;
    const onMedia = () => this.update();
    try {
      media = window.matchMedia(NARROW_QUERY);
      media.addEventListener('change', onMedia);
    } catch(err) {}

    (this.input.chat as any)?.destroyMiddlewareHelper?.get().onDestroy(() => {
      stop();
      media?.removeEventListener('change', onMedia);
      this.closeMenu();
    });

    this.update();
  }

  /** The field or the chat changed (input.ts: updateSendBtn). */
  public update() {
    try {
      const recording = !!this.input.recording;
      const hidden = !this.isOn || isRepliesInAiMenu() || recording;
      this.button?.classList.toggle('hide', hidden);
      if(!this.isOn) this.closeMenu();
    } catch(err) {
      console.warn('[luckgram] quick replies: field', (err as Error)?.message);
    }
  }

  // ------------------------------------------------------------------ the list

  public openMenu() {
    if(!this.isOn) return;
    this.closeMenu();

    const menu = this.menu = document.createElement('div');
    menu.className = 'luckgram-replies-menu';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', lgText('快捷回复', 'Quick replies'));
    menu.style.setProperty('--luckgram-replies-rows', String(VISIBLE_REPLIES));

    const list = document.createElement('div');
    list.className = 'luckgram-replies-menu-list';
    const items = this.getItems();
    for(const item of items) list.append(this.makeRow(item));
    if(!items.length) {
      const empty = document.createElement('div');
      empty.className = 'luckgram-replies-menu-empty';
      empty.textContent = lgText('还没有快捷回复。点「管理」添加常用的回复。', 'No quick replies yet. Press "Manage" to add the ones you use.');
      list.append(empty);
    }

    const footer = document.createElement('div');
    footer.className = 'luckgram-replies-menu-footer';
    const hint = document.createElement('span');
    hint.className = 'luckgram-replies-menu-hint';
    hint.textContent = items.length ? lgText('点击填入 · Shift+点击或长按直接发送', 'Press to insert · Shift+press or long press to send') : '';
    const manage = document.createElement('button');
    manage.type = 'button';
    manage.className = 'luckgram-replies-menu-manage';
    manage.textContent = lgText('管理', 'Manage');
    attachClickEvent(manage, (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.closeMenu();
      openRepliesManager();
    });
    footer.append(hint, manage);
    menu.append(list, footer);

    (this.input.rowsWrapper as HTMLElement).append(menu);
    this.button?.setAttribute('aria-expanded', 'true');

    const onDown = (e: Event) => {
      const target = e.target as Node;
      if(!menu.contains(target) && !this.button?.contains(target)) this.closeMenu();
    };
    // * Esc closes the list and nothing behind it (upstream takes the key first and would close the chat)
    const releaseEscape = holdEscape(() => this.closeMenu());
    document.addEventListener('pointerdown', onDown, true);
    this.closeMenuListeners = () => {
      document.removeEventListener('pointerdown', onDown, true);
      releaseEscape();
    };
  }

  public closeMenu() {
    this.closeMenuListeners?.();
    this.closeMenuListeners = undefined;
    this.menu?.remove();
    this.menu = undefined;
    this.button?.setAttribute('aria-expanded', 'false');
  }

  private makeRow(item: QuickReply) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'luckgram-replies-menu-item';
    row.setAttribute('role', 'option');
    row.dir = 'auto';
    row.textContent = getReplyPreview(item.text);
    row.title = item.text;

    // * a long press on a touch screen sends; the press that follows it does nothing more
    let timer: number, sent = false;
    const cancel = () => clearTimeout(timer);
    row.addEventListener('touchstart', () => {
      sent = false;
      timer = window.setTimeout(() => {
        sent = true;
        this.closeMenu();
        this.send(item);
      }, LONG_PRESS);
    }, {passive: true});
    row.addEventListener('touchend', cancel);
    row.addEventListener('touchmove', cancel, {passive: true});
    row.addEventListener('touchcancel', cancel);
    row.addEventListener('contextmenu', (e) => e.preventDefault());

    attachClickEvent(row, (e) => {
      e.preventDefault();
      e.stopPropagation();
      if(sent) return;
      this.closeMenu();
      if((e as MouseEvent).shiftKey) this.send(item);
      else this.insert(item);
    });
    return row;
  }

  // ------------------------------------------------------------------ what a template does

  /** Into the field at the caret; what was typed stays. Nothing is sent. */
  private insert(item: QuickReply) {
    this.input.insertAtCaret(item.text, undefined, false);
  }

  /** Sent at once as a message of its own; the field is left as it was. */
  private send(item: QuickReply) {
    const input = this.input;
    if(input.canSendPlain && !input.canSendPlain()) {
      // * upstream's own word for it
      input.insertAtCaret('', undefined, false);
      return;
    }

    const send = () => input.managers.appMessagesManager.sendText({
      ...input.chat.getMessageSendingParams(),
      text: item.text
    });

    // * what a send has to wait for (a paid message's confirmation, slow mode) is upstream's to ask
    if(input.getReadyToSend) input.getReadyToSend(send);
    else send();
  }

  // ------------------------------------------------------------------ "/…"

  /** Made by the field once its suggestions are (input.ts). */
  public attachSlashHelper(appendTo: HTMLElement, controller: any, commandsHelper?: AutocompleteHelper) {
    this.slashHelper = new RepliesSlashHelper(appendTo, controller, (reply) => this.fill(reply));
    this.commandsHelper = commandsHelper;
    if(commandsHelper) {
      this.slashHelper.addSibling(commandsHelper);
      // * a chat with a bot's commands: one panel for the two — the commands that match first, the
      // * templates that match after them, the arrow keys going through both
      const commands = commandsHelper as any;
      commands.luckgramAfterRender = (count: number) => this.followCommands(count);
      commands.luckgramPick = (target: HTMLElement) => this.pickFromCommands(target);
    }
  }

  /**
   * @param value the field's text up to the caret
   * @returns the helper, when it shows suggestions for this text
   */
  public checkSlash(value: string, wholeValue: string): AutocompleteHelper | undefined {
    if(!this.slashHelper) return;
    // * only while the caret is at the end of a field that holds nothing but the "/…"
    const found = this.isOn && value === wholeValue ? matchSlash(value, this.getItems()) : undefined;
    this.slashFound = found;
    return this.slashHelper.show(found) ? this.slashHelper : undefined;
  }

  /**
   * The bot commands for the same "/…" were drawn (they are asked for from the server's data, a
   * moment after the templates were found). With commands to show, the templates go into their
   * list, after them, and the templates' own panel gives way; with none, that panel stays.
   */
  private followCommands(commands: number) {
    try {
      const found = this.slashFound;
      const list: HTMLElement = (this.commandsHelper as any)?.list;
      if(!commands || !found?.length || !list || !this.isOn) return;
      list.querySelectorAll('.luckgram-replies-helper-item').forEach((element) => element.remove());
      // * rows only: every child of the list is something the arrow keys stop at. The first one is
      // * marked, to draw the line between the two kinds
      const rows = found.map((item) => makeReplyRow(item, list.ownerDocument));
      rows[0].classList.add('is-after-commands');
      list.append(...rows);
      // * the templates' own panel gives way — told as the controller tells it (`fromController`): a
      // * panel that hides by itself has the controller hide the others, and the commands went with it
      // * (specs#190: "/" in a bot's chat showed nothing). At once, without its fade: the commands'
      // * panel takes its place in the same moment
      this.slashHelper.toggle(true, true, true);
      this.showAtOnce((this.commandsHelper as any)?.container);
    } catch(err) {
      console.warn('[luckgram] quick replies: commands', (err as Error)?.message);
    }
  }

  /**
   * The panel that takes the place of another is there at once: the one coming in while the one
   * before goes out read as a jump (the two are of different heights).
   */
  private showAtOnce(container: HTMLElement | undefined) {
    if(!container) return;
    try {
      container.style.setProperty('transition', 'none', 'important');
      container.style.setProperty('animation', 'none', 'important');
      void container.offsetHeight;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        container.style.removeProperty('transition');
        container.style.removeProperty('animation');
      }));
    } catch(err) {}
  }

  /** A press, or Enter, on a row of the commands' list: one of the templates there is put into the field. */
  private pickFromCommands(target: HTMLElement): boolean {
    const id = target?.dataset?.replyId;
    if(!id) return false;
    const reply = this.getItems().find((item) => item.id === id);
    if(reply) this.fill(reply);
    return true;
  }

  /** The template in place of the "/…" that asked for it; not sent. */
  private fill(reply: QuickReply) {
    const length = (this.input.messageInputField?.value ?? '').length;
    this.input.messageInputEditor.replaceTextRange(0, length, reply.text);
  }

  /**
   * Enter on a "/…" that asks for a template (input.ts, before it sends). The suggestions take the
   * key themselves once they are up, but they come a moment after the typing, and Enter in that
   * moment sent the "/…" as it stood. The same templates are found here at once, from the
   * account's own list: the first takes the field's place, as its suggestion would, and nothing
   * is sent. Where a bot's commands are suggested for this text, the key is theirs.
   * @returns whether the key was taken
   */
  public takeEnter(): boolean {
    try {
      if(!this.slashHelper || !this.isOn) return false;
      if(this.commandsHelper && (this.commandsHelper as any).hidden === false) return false;
      const value: string = this.input.messageInputField?.value ?? '';
      const found = matchSlash(value, this.getItems());
      if(!found) return false;
      this.input.messageInputEditor.replaceTextRange(0, value.length, found[0].text);
      return true;
    } catch(err) {
      console.warn('[luckgram] quick replies: Enter', (err as Error)?.message);
      return false;
    }
  }
}
