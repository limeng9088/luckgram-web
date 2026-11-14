/*
 * Luckgram Web (luckgram-specs#188, W8 需求 8): the five extension points shown once each —
 * in a local development build only, and only when asked for (localStorage `lg_ai_demo=1`).
 * A production build does not carry this file's code (entries.ts loads it behind a build-time check).
 */

import {lgText} from '@/luckgram/text';
import {
  registerAssistantHeaderEntry, registerAssistantInterceptor, registerAssistantMessageType, registerAssistantQuickButton
} from '@/luckgram/assistant/registry';

export function registerAssistantDemo() {
  // * 1. a quick button over the field
  registerAssistantQuickButton({
    key: 'demo_button', title: ['[演示] 按钮', '[Demo] Button'], order: 900,
    onClick: (page) => page.setInput(lgText('演示按钮写进来的文字', 'Text written by the demo button'))
  });

  // * 2. a handler of messages with a prefix: "/echo text" is answered here, not by the server
  registerAssistantInterceptor({
    prefix: '/echo',
    handle: (rest, page) => {
      page.addMessage({role: 'assistant', type: 'text', text: lgText('（演示拦截）', '(demo interceptor) ') + (rest || '…')});
    }
  });

  // * 3. an entry at the top of the page, which — 4. conversation properties — opens the one
  // *    conversation with this key, made with a system instruction that goes with every request
  registerAssistantHeaderEntry({
    key: 'demo_agent', title: ['[演示] 海盗', '[Demo] Pirate'], order: 900,
    onClick: (page) => {
      page.openConversation({
        key: 'demo:pirate', task: 'chat', title: lgText('[演示] 海盗智能体', '[Demo] Pirate agent'),
        system: 'You are a cheerful pirate. Answer in one short sentence, in the user\'s language.'
      });
    }
  });

  // * 5. a message type: "/card text" adds a message of the type "demo_card", drawn by this
  registerAssistantMessageType({
    type: 'demo_card',
    render: (message) => {
      const card = document.createElement('div');
      card.style.cssText = 'padding:.5rem .75rem;border:1px dashed var(--primary-color);border-radius:.5rem';
      card.textContent = lgText('[演示消息类型] ', '[Demo message type] ') + (message.data?.note || message.text);
      return card;
    }
  });
  registerAssistantInterceptor({
    prefix: '/card',
    handle: (rest, page) => {
      page.addMessage({role: 'assistant', type: 'demo_card', text: rest, data: {note: rest || 'card'}});
    }
  });
}
