/*
 * Luckgram Web (luckgram-specs#188, W8 需求 6): the assistant's conversations — kept by
 * account in IndexedDB `luckgram` (store `ai`), not expiring. Read into memory once.
 *
 * When an account leaves: this tab logging its own account out deletes its conversations at once
 * (`deleteAccount`); an account that left elsewhere — another tab, a session ended from the
 * phone — is cleaned up as the page starts (`cleanOrphans`: whatever belongs to nobody signed in).
 */

import type {LuckgramStorage} from '@/luckgram/core/storage';
import {
  Conversation, accountOfKey, conversationKey, getConversationsToPrune, getOrphanKeys, sortConversations
} from '@/luckgram/assistant/logic';

export class AssistantStore {
  private conversations = new Map<string, Conversation>();
  public ready: Promise<void>;

  constructor(private storage: LuckgramStorage) {
    this.ready = this.load();
  }

  private async load() {
    try {
      const stored = await this.storage.getAll('ai');
      for(const key in stored) {
        const conversation = stored[key] as Conversation;
        if(conversation && Array.isArray(conversation.messages) && !this.conversations.has(key)) this.conversations.set(key, conversation);
      }
    } catch(err) {
      // * no IndexedDB for this page: the conversations live as long as the page does
      console.warn('[luckgram] assistant conversations are not stored:', (err as Error)?.message);
    }
  }

  private write(set: Record<string, Conversation>, remove: string[] = []) {
    return this.storage.update('ai', set, remove).catch(() => {});
  }

  /** The account's conversations, the newest first. */
  public list(account: number | string): Conversation[] {
    const own = String(account);
    return sortConversations([...this.conversations.values()].filter((conversation) => conversation.account === own));
  }

  public get(account: number | string, id: string): Conversation | undefined {
    return this.conversations.get(conversationKey(account, id));
  }

  /** The conversation a feature made with this key (22: one per agent). */
  public findByKey(account: number | string, key: string): Conversation | undefined {
    return this.list(account).find((conversation) => conversation.key === key);
  }

  public save(conversation: Conversation) {
    const key = conversationKey(conversation.account, conversation.id);
    this.conversations.set(key, conversation);

    const drop = getConversationsToPrune(this.list(conversation.account)).filter((id) => id !== conversation.id)
    .map((id) => conversationKey(conversation.account, id));
    for(const dropped of drop) this.conversations.delete(dropped);

    // * a copy: what is stored must not follow later changes of the object in memory
    return this.write({[key]: JSON.parse(JSON.stringify(conversation))}, drop);
  }

  public delete(account: number | string, id: string) {
    const key = conversationKey(account, id);
    if(!this.conversations.delete(key)) return Promise.resolve();
    return this.write({}, [key]);
  }

  /** The account logged out here: nothing of it stays. */
  public deleteAccount(account: number | string) {
    const own = String(account);
    const drop = [...this.conversations.keys()].filter((key) => accountOfKey(key) === own);
    for(const key of drop) this.conversations.delete(key);
    return drop.length ? this.write({}, drop) : Promise.resolve();
  }

  /** As the page starts: the conversations of accounts that are no longer signed in go. */
  public cleanOrphans(accounts: (number | string)[]) {
    const drop = getOrphanKeys([...this.conversations.keys()], accounts);
    for(const key of drop) this.conversations.delete(key);
    return drop.length ? this.write({}, drop) : Promise.resolve();
  }

  public get size() {
    return this.conversations.size;
  }
}
