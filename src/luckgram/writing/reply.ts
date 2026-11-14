/*
 * Luckgram Web (luckgram-specs#187, W7 需求 4–6; specs/20-ai-reply.md): "帮我回复" — three
 * replies fitting the conversation, to pick one from and edit before sending.
 *
 * It is not part of the field's code: it registers one menu item (registry.ts) and uses the panel
 * over the field, as 24 (AI post) will. Sent to the Luckgram server (`task=reply`): the chat's last
 * 20 messages with text, who wrote each, and the draft. Nothing is sent to Telegram, and nothing
 * is sent as a message: a candidate only goes into the field.
 */

import type {Message} from '@layer';
import getPeerTitle from '@components/wrappers/getPeerTitle';
import {attachClickEvent} from '@helpers/dom/clickEvent';
import {LuckgramApiError} from '@/luckgram/core/errors';
import luckgramAI from '@/luckgram/core/instance';
import {lgText} from '@/luckgram/text';
import {getAiErrorText} from '@/luckgram/writing/errors';
import {ORDER_REPLY, REPLY_CANDIDATES, REPLY_MESSAGES, REPLY_TONES, ReplyLine, buildReplyPrompt, buildTranscript, parseCandidates} from '@/luckgram/writing/logic';
import {AiWritingHost, registerAiMenuItem} from '@/luckgram/writing/registry';

type Bubble = HTMLElement & {luckgramMessage?: Message.message};

/** The chat's messages that are on screen, the oldest first: who wrote each, and its text. */
async function readConversation(host: AiWritingHost): Promise<ReplyLine[]> {
  const container: HTMLElement = host.chatInput?.chat?.bubbles?.container;
  const bubbles = [...(container?.querySelectorAll<Bubble>('.bubble') || [])];
  const messages = bubbles
  .map((bubble) => ({bubble, message: bubble.luckgramMessage}))
  .filter(({message}) => message?._ === 'message' && message.message)
  .sort((a, b) => a.message.mid - b.message.mid)
  .slice(-REPLY_MESSAGES);

  const names = new Map<string, string>();
  const lines: ReplyLine[] = [];
  for(const {bubble, message} of messages) {
    const out = !!message.pFlags.out || bubble.classList.contains('is-out');
    let name: string;
    if(!out) {
      const from = (message.fromId ?? message.peerId) as PeerId;
      const key = String(from);
      if(!names.has(key)) {
        names.set(key, await Promise.resolve(getPeerTitle({peerId: from, plainText: true, onlyFirstName: true}) as any as Promise<string>).catch((): string => undefined));
      }

      name = names.get(key);
    }

    lines.push({out, name, text: message.message});
  }

  return lines;
}

function openReplyPanel(host: AiWritingHost) {
  const panel = document.createElement('div');
  panel.classList.add('luckgram-ai-reply');

  const header = document.createElement('div');
  header.classList.add('luckgram-ai-reply-header');
  const title = document.createElement('span');
  title.classList.add('luckgram-ai-reply-title');
  title.textContent = lgText('帮我回复', 'Help me reply');
  const again = document.createElement('button');
  again.type = 'button';
  again.classList.add('luckgram-ai-reply-action');
  again.textContent = lgText('换一批', 'Try again');
  const close = document.createElement('button');
  close.type = 'button';
  close.classList.add('luckgram-ai-reply-action');
  close.textContent = lgText('关闭', 'Close');
  close.setAttribute('aria-label', lgText('关闭（Esc）', 'Close (Esc)'));
  header.append(title, again, close);

  const list = document.createElement('div');
  list.classList.add('luckgram-ai-reply-list');
  panel.append(header, list);

  let run = 0;
  let abort: AbortController;
  const draft = host.getText();

  const render = (candidates: string[], writing: boolean) => {
    list.replaceChildren(...Array.from({length: REPLY_CANDIDATES}, (_, index) => {
      const text = candidates[index];
      const item = document.createElement('button');
      item.type = 'button';
      item.classList.add('luckgram-ai-reply-item');
      item.dir = 'auto';
      // * the one being written is not to be picked yet
      const ready = !!text && (!writing || index < candidates.length - 1);
      item.disabled = !ready;
      item.classList.toggle('is-writing', !ready);

      const tone = document.createElement('span');
      tone.classList.add('luckgram-ai-reply-tone');
      tone.textContent = lgText(...REPLY_TONES[index]);
      const body = document.createElement('span');
      body.classList.add('luckgram-ai-reply-text');
      body.textContent = text || '…';
      item.append(tone, body);

      if(ready) {
        attachClickEvent(item, (e) => {
          e.preventDefault();
          // * into the field, to be read and changed: never sent from here
          host.setText(text, {undoable: true, notice: lgText('已填入回复', 'Reply filled in')});
          host.hidePanel();
        });
      }

      return item;
    }));
  };

  const generate = async() => {
    const current = ++run;
    abort?.abort();
    abort = new AbortController();
    again.disabled = true;
    render([], true);

    try {
      const me = lgText('我', 'Me');
      const transcript = buildTranscript(await readConversation(host), me);
      if(run !== current) return;

      let scheduled = false, latest = '';
      const text = await luckgramAI.chat({
        task: 'reply',
        messages: [{role: 'user', content: buildReplyPrompt(transcript, draft, me)}],
        signal: abort.signal,
        onDelta: (_delta, whole) => {
          latest = whole;
          if(scheduled) return;
          scheduled = true;
          requestAnimationFrame(() => {
            scheduled = false;
            if(run === current) render(parseCandidates(latest), true);
          });
        }
      });

      if(run !== current) return;
      const candidates = parseCandidates(text);
      if(!candidates.length) throw new LuckgramApiError(LuckgramApiError.UPSTREAM_UNAVAILABLE);
      render(candidates, false);
    } catch(err) {
      if(run !== current || (err instanceof LuckgramApiError && err.code === LuckgramApiError.CANCELLED)) return;
      const error = document.createElement('div');
      error.classList.add('luckgram-ai-reply-error');
      error.textContent = getAiErrorText(err);
      list.replaceChildren(error);
    } finally {
      if(run === current) again.disabled = false;
    }
  };

  attachClickEvent(again, (e) => {
    e.preventDefault();
    generate();
  });
  attachClickEvent(close, (e) => {
    e.preventDefault();
    host.hidePanel();
  });

  host.showPanel(panel, () => {
    ++run;
    abort?.abort();
  });
  generate();
}

let registered = false;
/** One line of registration, as 21's extension point asks. */
export function registerAiReply() {
  if(registered) return;
  registered = true;
  registerAiMenuItem({
    key: 'reply',
    title: ['帮我回复', 'Help me reply'],
    icon: 'reply',
    order: ORDER_REPLY,
    allowEmpty: true,
    allowRich: true,
    onClick: openReplyPanel
  });
}
