/*
 * Luckgram Web (luckgram-specs#192, W10 需求 1、2): writing a private note — one box over the
 * page, used from the profile's row and from the chat's bar. Plain text, line breaks kept,
 * 2000 characters at most. Its own DOM.
 */

import {attachClickEvent} from '@helpers/dom/clickEvent';
import {lgText} from '@/luckgram/text';
import {holdEscape} from '@/luckgram/core/escape';
import {MAX_LENGTH, NotePeer, normalizeNote, remainingCharacters} from '@/luckgram/notes/logic';
import type {NotesStore} from '@/luckgram/notes/store';

export const NOTE_HINT: [string, string] = ['只存在这台设备 · 只有您能看到', 'Kept on this device only · Only you can see it'];

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
    e.stopPropagation();
    onClick();
  });
  return element;
};

let open: {close: () => void};

export function openNoteEditor(options: {store: NotesStore, account: string, peer: NotePeer, onClose?: () => void}) {
  open?.close();

  const before = options.store.get(options.account, options.peer)?.text || '';
  const backdrop = el('div', 'luckgram-note-editor-backdrop');
  const box = el('div', 'luckgram-note-editor');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', lgText('私人备注', 'Private note'));

  const field = el('textarea', 'luckgram-note-editor-field');
  field.dir = 'auto';
  field.value = before;
  field.placeholder = lgText('添加私人备注…', 'Add a private note…');
  field.setAttribute('aria-label', lgText('私人备注', 'Private note'));

  const counter = el('span', 'luckgram-note-editor-counter');
  const footer = el('div', 'luckgram-note-editor-footer');
  footer.append(el('span', 'luckgram-note-editor-hint', lgText(...NOTE_HINT)), counter);

  let closed = false;
  const close = () => {
    if(closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown, true);
    releaseEscape();
    backdrop.remove();
    if(open === handle) open = undefined;
    options.onClose?.();
  };
  const handle = open = {close};

  const save = () => {
    if(remainingCharacters(field.value.trim()) < 0) return;
    options.store.set(options.account, options.peer, field.value);
    close();
  };

  const saveButton = button('luckgram-note-editor-button is-primary', lgText('保存', 'Save'), save);
  const buttons = el('div', 'luckgram-note-editor-buttons');
  if(before) {
    buttons.append(button('luckgram-note-editor-button is-danger', lgText('删除备注', 'Delete note'), () => {
      options.store.delete(options.account, options.peer);
      close();
    }));
  }

  buttons.append(el('span', 'luckgram-note-editor-space'), button('luckgram-note-editor-button', lgText('取消', 'Cancel'), close), saveButton);

  const update = () => {
    const left = remainingCharacters(field.value.trim());
    counter.textContent = left <= 200 ? String(left) : '';
    counter.classList.toggle('is-over', left < 0);
    saveButton.disabled = left < 0 || normalizeNote(field.value) === before;
  };

  field.addEventListener('input', update);
  function onKeyDown(e: KeyboardEvent) {
    if(e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !saveButton.disabled) {
      e.preventDefault();
      e.stopPropagation();
      save();
    }
  }

  document.addEventListener('keydown', onKeyDown, true);
  // * Esc closes the editor and nothing behind it (upstream takes the key first and would close the chat)
  const releaseEscape = holdEscape(close);
  attachClickEvent(backdrop, (e) => {
    // * a press outside closes only what was not changed: a slip must not lose the text
    if(e.target === backdrop && normalizeNote(field.value) === before) close();
  });

  box.append(el('div', 'luckgram-note-editor-title', lgText('私人备注', 'Private note')), field, footer, buttons);
  backdrop.append(box);
  document.body.append(backdrop);
  update();
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
  return handle;
}

export {MAX_LENGTH};
