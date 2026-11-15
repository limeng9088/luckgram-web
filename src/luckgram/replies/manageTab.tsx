/*
 * Luckgram Web (luckgram-specs#190, W11b 需求 9): "快捷回复 → 管理" — the account's templates:
 * added, edited, deleted, put in order by dragging (upstream's own sorting) or with the arrows.
 * 1 to 1000 characters each, 100 at most.
 */

import {JSX, createSignal, onCleanup, onMount} from 'solid-js';
import Section from '@components/section';
import {useSuperTab} from '@components/solidJsTabs/superTabProvider';
import {toast} from '@components/toast';
import {attachClickEvent} from '@helpers/dom/clickEvent';
import Sortable from '@helpers/dom/sortable';
import {getMiddleware} from '@helpers/middleware';
import {lgText} from '@/luckgram/text';
import {holdEscape} from '@/luckgram/core/escape';
import {countCharacters} from '@/luckgram/notes/logic';
import {MAX_REPLIES, MAX_REPLY_LENGTH, QuickReply, checkReply, getReplyErrorText} from '@/luckgram/replies/logic';
import {getRepliesAccount, repliesStore} from '@/luckgram/replies/instance';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  if(className) element.className = className;
  if(text !== undefined) element.textContent = text;
  return element;
};

const button = (className: string, text: string, label: string, onClick: () => void) => {
  const element = el('button', className, text);
  element.type = 'button';
  element.title = label;
  element.setAttribute('aria-label', label);
  attachClickEvent(element, (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return element;
};

/** A template's text being written: a field, how many characters are left, save and cancel. */
function makeEditor(options: {text: string, others: QuickReply[], adding: boolean, onSave: (text: string) => void, onCancel: () => void}) {
  const box = el('div', 'luckgram-replies-editor');
  const field = el('textarea', 'luckgram-replies-editor-field');
  field.dir = 'auto';
  field.rows = 3;
  field.value = options.text;
  field.placeholder = lgText('输入一条常用的回复…', 'Type a reply you use often…');
  field.setAttribute('aria-label', lgText('快捷回复的内容', 'The quick reply\'s text'));
  const counter = el('span', 'luckgram-replies-editor-counter');
  const save = button('luckgram-replies-editor-button is-primary', lgText('保存', 'Save'), lgText('保存', 'Save'), () => {
    const error = checkReply(field.value, options.others, options.adding);
    if(error) {
      toast(lgText(...getReplyErrorText(error)));
      return;
    }

    options.onSave(field.value);
  });
  const cancel = button('luckgram-replies-editor-button', lgText('取消', 'Cancel'), lgText('取消', 'Cancel'), options.onCancel);

  const update = () => {
    const left = MAX_REPLY_LENGTH - countCharacters(field.value.trim());
    counter.textContent = left <= 100 ? String(left) : '';
    counter.classList.toggle('is-over', left < 0);
    save.disabled = left < 0 || !field.value.trim();
  };

  field.addEventListener('input', update);
  field.addEventListener('keydown', (e) => {
    if(e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !save.disabled) {
      e.preventDefault();
      save.click();
    }
  });
  // * Esc in the field cancels the editing only (upstream takes the key first and would close the page)
  let releaseEscape: () => void;
  field.addEventListener('focus', () => {
    releaseEscape?.();
    releaseEscape = holdEscape(() => options.onCancel(), () => field.isConnected);
  });
  field.addEventListener('blur', () => {
    releaseEscape?.();
    releaseEscape = undefined;
  });

  const row = el('div', 'luckgram-replies-editor-row');
  row.append(counter, cancel, save);
  box.append(field, row);
  update();
  setTimeout(() => {
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, 0);
  return box;
}

export default function LuckgramRepliesManage(): JSX.Element {
  const account = getRepliesAccount();
  const [count, setCount] = createSignal(0);
  let tab: any;
  try {
    [tab] = useSuperTab();
  } catch(err) {}

  const listEl = el('div', 'luckgram-replies-list');
  const addHost = el('div', 'luckgram-replies-add');
  /** the template being edited, or 'new' */
  let editing: string;

  const render = () => {
    const items = account ? repliesStore.list(account) : [];
    setCount(items.length);

    listEl.replaceChildren(...items.map((item, index) => {
      if(editing === item.id) {
        return makeEditor({
          text: item.text,
          others: items.filter((other) => other.id !== item.id),
          adding: false,
          onSave: (text) => {
            editing = undefined;
            const error = repliesStore.edit(account, item.id, text);
            if(error) toast(lgText(...getReplyErrorText(error)));
            render();
          },
          onCancel: () => {
            editing = undefined;
            render();
          }
        });
      }

      const row = el('div', 'luckgram-replies-row');
      row.dataset.replyId = item.id;
      const handle = el('span', 'luckgram-replies-row-handle', '⋮⋮');
      handle.setAttribute('aria-hidden', 'true');
      const text = el('div', 'luckgram-replies-row-text', item.text);
      text.dir = 'auto';
      const up = button('luckgram-replies-row-button', '↑', lgText('上移', 'Move up'), () => repliesStore.move(account, item.id, index - 1));
      up.disabled = index === 0;
      const down = button('luckgram-replies-row-button', '↓', lgText('下移', 'Move down'), () => repliesStore.move(account, item.id, index + 1));
      down.disabled = index === items.length - 1;
      const edit = button('luckgram-replies-row-button', '✎', lgText('编辑', 'Edit'), () => {
        editing = item.id;
        render();
      });
      const remove = button('luckgram-replies-row-button is-danger', '✕', lgText('删除', 'Delete'), () => repliesStore.remove(account, item.id));
      row.append(handle, text, up, down, edit, remove);
      return row;
    }));

    if(editing === 'new') {
      addHost.replaceChildren(makeEditor({
        text: '',
        others: items,
        adding: true,
        onSave: (text) => {
          const error = repliesStore.add(account, text);
          if(error) {
            toast(lgText(...getReplyErrorText(error)));
            return;
          }

          editing = undefined;
          render();
        },
        onCancel: () => {
          editing = undefined;
          render();
        }
      }));
    } else {
      const add = button('luckgram-replies-add-button', lgText('＋ 新增快捷回复', '+ Add a quick reply'), lgText('新增快捷回复', 'Add a quick reply'), () => {
        if(items.length >= MAX_REPLIES) {
          toast(lgText(...getReplyErrorText('limit')));
          return;
        }

        editing = 'new';
        render();
      });
      addHost.replaceChildren(add);
    }
  };

  onCleanup(repliesStore.subscribe(render));
  repliesStore.ready.then(render);
  render();

  // * dragging: upstream's own sorting of a list; the arrows do the same without it
  const middlewareHelper = getMiddleware();
  onCleanup(() => middlewareHelper.destroy());
  onMount(() => {
    if(!tab?.scrollable) return;
    try {
      new Sortable({
        list: listEl,
        middleware: middlewareHelper.get(),
        scrollable: tab.scrollable,
        onSort: () => {
          const ids = Array.from(listEl.children).map((child) => (child as HTMLElement).dataset.replyId).filter(Boolean);
          repliesStore.reorder(account, ids);
        }
      });
    } catch(err) {
      console.warn('[luckgram] quick replies: sorting', (err as Error)?.message);
    }
  });

  return (
    <Section
      name={<span>{lgText(`快捷回复（${count()} / ${MAX_REPLIES}）`, `Quick replies (${count()} / ${MAX_REPLIES})`)}</span>}
      caption={<span>{lgText('在输入框旁的快捷回复按钮里点一条填入输入框；按住 Shift 点（手机上长按）直接发送。输入「/」加开头几个字也能找到。只存在这台设备。', 'Press one in the quick replies button by the message field to insert it; Shift+press (a long press on a phone) sends it at once. Typing "/" and its first letters finds it too. Kept on this device only.')}</span>}
    >
      {listEl}
      {addHost}
    </Section>
  );
}
