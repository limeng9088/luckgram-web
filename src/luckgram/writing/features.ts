/*
 * Luckgram Web (luckgram-specs#187, W7 需求 9): what is registered at the extension points of
 * AI writing — one line per feature, as on the phones (AiWritingFeatures.java).
 */

import {lgText} from '@/luckgram/text';
import {registerAiReply} from '@/luckgram/writing/reply';
import {registerAiMenuItem} from '@/luckgram/writing/registry';

let done = false;

export function registerAiWritingFeatures() {
  if(done) return;
  done = true;

  registerAiReply(); // 20 AI reply
  // 24 AI post goes here

  // * a demonstration of both extension points, in a local development build only and only when
  // * asked for (localStorage lg_ai_demo=1): an item placed first and shown in channels only,
  // * whose panel writes into the field with undo
  if(import.meta.env.VITE_LG_CHANNEL !== 'prod') {
    let wanted = false;
    try {
      wanted = localStorage.getItem('lg_ai_demo') === '1';
    } catch(err) {}

    if(wanted) {
      registerAiMenuItem({
        key: 'demo',
        title: ['[演示] 只在频道里显示的菜单项', '[Demo] An item shown in channels only'],
        order: -1,
        allowEmpty: true,
        visible: (host) => !!host.chatInput?.chat?.isBroadcast,
        onClick: (host) => {
          const panel = document.createElement('div');
          panel.style.padding = '.5rem 1rem';
          const write = document.createElement('button');
          write.type = 'button';
          write.textContent = lgText('[演示] 往输入框写字（可撤销）', '[Demo] Write into the field (undoable)');
          write.addEventListener('click', () => host.setText('Written by the demo panel', {undoable: true, notice: lgText('演示面板已写入', 'Written by the demo panel')}));
          const close = document.createElement('button');
          close.type = 'button';
          close.textContent = lgText('关闭', 'Close');
          close.style.marginInlineStart = '1rem';
          close.addEventListener('click', () => host.hidePanel());
          panel.append(write, close);
          host.showPanel(panel);
        }
      });
    }
  }
}
