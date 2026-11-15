/*
 * Luckgram Web (luckgram-specs#188, W8 需求 8; specs/18 需求 8): the five extension points of
 * the AI assistant. 22 (agents) and 23 (images) add themselves here with a registration each and
 * never change the assistant's own code.
 *
 *  1. a quick button over the field           registerAssistantQuickButton({key, title, order, onClick(page)})
 *  2. a handler of messages with a prefix     registerAssistantInterceptor({prefix: '/image', handle(rest, page)})
 *  3. an entry at the top of the page         registerAssistantHeaderEntry({key, title, icon, onClick(page)})
 *  4. conversation properties                 page.openConversation({key: 'agent:42', task: 'agent', system: '…', title: '…'})
 *                                             — the task and the system instruction go with every request of it;
 *                                             the same key opens the same conversation again
 *  5. a message type                          registerAssistantMessageType({type: 'image', render(message, page)})
 *                                             — a stored message of a type nobody registered shows a placeholder
 *
 * `page` is what an extension may do with the open assistant page (AssistantPageApi).
 */

import type {AssistantMessage, Conversation} from '@/luckgram/assistant/logic';

export type AssistantPageApi = {
  /** the conversation that is open */
  getConversation: () => Conversation,
  getInput: () => string,
  /** @param notice a line shown over the field until the user edits the text or sends it (what was left out of what was brought) */
  setInput: (text: string, notice?: string) => void,
  /** Adds a message to the open conversation and shows it. @returns its id */
  addMessage: (message: Pick<AssistantMessage, 'role' | 'type' | 'text'> & {data?: any, partial?: boolean}) => string,
  /** Changes a message that is there (a result arrived, an error) and draws it again. */
  updateMessage: (id: string, patch: Partial<Pick<AssistantMessage, 'text' | 'data' | 'error' | 'partial' | 'type'>>) => void,
  /** Opens the conversation with this key, making it with these properties when there is none; no key: a new one. */
  openConversation: (properties?: {key?: string, task?: string, system?: string, title?: string}) => Promise<Conversation>,
  /** Sends the text as the user's message and asks the server, as the send button does. */
  send: (text: string) => void
};

type Titled = {key: string, /** [中文, English] */ title: [string, string], icon?: string, order?: number};

export type AssistantQuickButton = Titled & {onClick: (page: AssistantPageApi) => void};
export type AssistantHeaderEntry = Titled & {onClick: (page: AssistantPageApi) => void};
export type AssistantInterceptor = {
  /** what the message starts with: "/image", "画" */
  prefix: string,
  /** `rest`: the message without the prefix. The message itself is not sent to the chat model. */
  handle: (rest: string, page: AssistantPageApi) => void | Promise<void>
};
export type AssistantMessageType = {
  type: string,
  render: (message: AssistantMessage, page: AssistantPageApi) => HTMLElement
};

function makeRegistry<T>(same: (a: T, b: T) => boolean) {
  const items: T[] = [];
  return {
    /** @returns a function that takes the item out again */
    register(item: T) {
      const index = items.findIndex((existing) => same(existing, item));
      if(index !== -1) items.splice(index, 1);
      items.push(item);
      return () => {
        const at = items.indexOf(item);
        if(at !== -1) items.splice(at, 1);
      };
    },
    list: () => items.slice()
  };
}

const byOrder = <T extends {order?: number}>(items: T[]) => items
.map((item, index) => [item, index] as const)
.sort((a, b) => (a[0].order ?? 100) - (b[0].order ?? 100) || a[1] - b[1])
.map(([item]) => item);

const quickButtons = makeRegistry<AssistantQuickButton>((a, b) => a.key === b.key);
const interceptors = makeRegistry<AssistantInterceptor>((a, b) => a.prefix === b.prefix);
const headerEntries = makeRegistry<AssistantHeaderEntry>((a, b) => a.key === b.key);
const messageTypes = makeRegistry<AssistantMessageType>((a, b) => a.type === b.type);

export const registerAssistantQuickButton = quickButtons.register;
export const registerAssistantInterceptor = interceptors.register;
export const registerAssistantHeaderEntry = headerEntries.register;
export const registerAssistantMessageType = messageTypes.register;

export const getAssistantQuickButtons = () => byOrder(quickButtons.list());
/** The longest prefix first: "/image-edit" before "/image". */
export const getAssistantInterceptors = () => interceptors.list().sort((a, b) => b.prefix.length - a.prefix.length);
export const getAssistantHeaderEntries = () => byOrder(headerEntries.list());
export const getAssistantMessageType = (type: string) => messageTypes.list().find((item) => item.type === type);
