/*
 * Luckgram Web (luckgram-specs#191, W12b 需求 4): a chat opened from a keyword folder gets a
 * bar over the message field — "跳到下一个「发票」(2 / 5)" — that goes from one message with a
 * keyword to the next, among the chat's messages kept on this device (the ones the folder looked
 * at; nothing is searched on the server). One of these for each field (input.ts makes it).
 */

import {hotReloadGuard} from '@lib/solidjs/hotReloadGuardProvider';
import {attachClickEvent} from '@helpers/dom/clickEvent';
import {isFeatureEnabled} from '@/luckgram/core/features';
import {lgText} from '@/luckgram/text';
import {isLocalFolderId} from '@/luckgram/folders/guard';
import {KEYWORD_FOLDERS} from '@/luckgram/folders/logic';

export type KeywordMessage = {mid: number, keyword: string};

/** The place after `index` among `count` hits, going round. */
export const nextIndex = (index: number, count: number) => count ? (index + 1) % count : 0;

/** [中文, English] */
export function getJumpText(hit: KeywordMessage | undefined, index: number, count: number): [string, string] {
  const keyword = hit?.keyword || '';
  return [`跳到下一个「${keyword}」（${index + 1} / ${count}）`, `Next "${keyword}" (${index + 1} of ${count})`];
}

export default class LuckgramKeywordJump {
  private bar: HTMLElement;
  private label: HTMLElement;
  private hits: KeywordMessage[] = [];
  private index = -1;
  private peerId: PeerId;
  private token = 0;

  // * `input`: upstream's ChatInput (typed loosely: this file is imported by it)
  constructor(private input: any) {}

  /** The field or the chat changed (input.ts: updateSendBtn): a new chat is looked at once. */
  public update() {
    try {
      const chat = this.input.chat;
      const peerId: PeerId = chat?.peerId;
      if(peerId === this.peerId) return;
      this.peerId = peerId;
      this.hide();
      if(!peerId || !chat.isMainChat || chat.isPreview || chat.threadId) return;

      const filterId: number = hotReloadGuard.appDialogsManager?.filterId;
      if(!isLocalFolderId(filterId) || !isFeatureEnabled(KEYWORD_FOLDERS)) return;

      const token = ++this.token;
      Promise.resolve(chat.managers.filtersStorage.luckgramGetKeywordMessages(filterId, peerId)).then((hits: KeywordMessage[]) => {
        if(token !== this.token || this.peerId !== peerId || !hits?.length) return;
        this.show(hits);
      }, () => {});
    } catch(err) {
      console.warn('[luckgram] keyword folders: jump', (err as Error)?.message);
    }
  }

  private show(hits: KeywordMessage[]) {
    this.hits = hits;
    this.index = -1;
    if(!this.bar) {
      const bar = this.bar = document.createElement('div');
      bar.className = 'luckgram-keyword-jump';
      const jump = document.createElement('button');
      jump.type = 'button';
      jump.className = 'luckgram-keyword-jump-button';
      this.label = jump;
      attachClickEvent(jump, (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.jump();
      });
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'luckgram-keyword-jump-close';
      close.textContent = '✕';
      close.setAttribute('aria-label', lgText('关闭', 'Close'));
      attachClickEvent(close, (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
      });
      bar.append(jump, close);
    }

    this.setLabel();
    const row: HTMLElement = this.input.rowsWrapper;
    if(row?.parentElement && this.bar.parentElement !== row.parentElement) row.parentElement.insertBefore(this.bar, row);
  }

  private setLabel() {
    // * what a press goes to
    const next = nextIndex(this.index, this.hits.length);
    this.label.textContent = lgText(...getJumpText(this.hits[next], next, this.hits.length));
  }

  private jump() {
    if(!this.hits.length) return;
    this.index = nextIndex(this.index, this.hits.length);
    const hit = this.hits[this.index];
    this.input.chat.setMessageId({lastMsgId: hit.mid, highlight: {type: 'search', query: hit.keyword}});
    this.setLabel();
  }

  private hide() {
    ++this.token;
    this.bar?.remove();
    this.hits = [];
    this.index = -1;
  }
}
