/*
 * Luckgram Web (luckgram-specs#139, W3 需求 3): LuckgramSettings — Luckgram's switches and
 * values, by key. The same keys as on the phones (LuckgramSettings.java / .swift).
 *
 *  - kept in the browser (storage.ts), shared by every account;
 *  - read synchronously from memory once `ready` has resolved (before that every read is its default);
 *  - a change reaches every reader at once: `subscribe`, or `useSetting` in a component;
 *  - and every other tab of the browser, over a BroadcastChannel.
 *
 * Private values (the device token) go through `getPrivate` / `setPrivate`: stored beside the
 * settings, but never mirrored to other contexts' listeners and never listed.
 */

import {LuckgramIndexedDBStorage, LuckgramMemoryStorage, LuckgramStorage} from '@/luckgram/core/storage';

export type SettingValue = boolean | string | number | undefined;
type Listener = (key: string, value: SettingValue) => void;

type SyncMessage = {type: 'set', key: string, value: SettingValue} | {type: 'private', key: string, value: any} | {type: 'clear'};

const CHANNEL_NAME = 'luckgram-settings';

export class LuckgramSettingsStore {
  private values = new Map<string, SettingValue>();
  private privateValues = new Map<string, any>();
  private listeners = new Set<Listener>();
  private channel: BroadcastChannel;
  public ready: Promise<void>;

  constructor(private storage: LuckgramStorage, channelName: string | null = CHANNEL_NAME) {
    this.ready = this.load();

    try {
      if(channelName) this.channel = new BroadcastChannel(channelName);
    } catch(err) {}

    this.channel?.addEventListener('message', (event) => {
      const message = event.data as SyncMessage;
      if(message?.type === 'set' && typeof(message.key) === 'string') {
        this.apply(message.key, message.value);
      } else if(message?.type === 'private' && typeof(message.key) === 'string') {
        if(message.value === undefined) this.privateValues.delete(message.key);
        else this.privateValues.set(message.key, message.value);
      } else if(message?.type === 'clear') {
        this.applyClear();
      }
    });
  }

  private async load() {
    try {
      const [settings, privateValues] = await Promise.all([this.storage.getAll('settings'), this.storage.getAll('private')]);
      for(const key in settings) {
        // * what was set while the stored values were on their way is newer
        if(!this.values.has(key)) this.values.set(key, settings[key]);
      }

      for(const key in privateValues) {
        if(!this.privateValues.has(key)) this.privateValues.set(key, privateValues[key]);
      }

      this.values.forEach((value, key) => this.notify(key, value));
    } catch(err) {
      // * no IndexedDB for this page: the values live as long as the page does
      console.warn('[luckgram] settings are not stored:', (err as Error)?.message);
      this.storage = new LuckgramMemoryStorage();
    }
  }

  private notify(key: string, value: SettingValue) {
    this.listeners.forEach((listener) => {
      try {
        listener(key, value);
      } catch(err) {
        console.error('[luckgram] settings listener', err);
      }
    });
  }

  private apply(key: string, value: SettingValue) {
    if(this.values.get(key) === value) return;
    if(value === undefined) this.values.delete(key);
    else this.values.set(key, value);
    this.notify(key, value);
  }

  private applyClear() {
    const keys = [...this.values.keys()];
    this.values.clear();
    this.privateValues.clear();
    keys.forEach((key) => this.notify(key, undefined));
  }

  // ------------------------------------------------------------------ values

  public has(key: string) {
    return this.values.has(key);
  }

  public getBool(key: string, def: boolean): boolean {
    const value = this.values.get(key);
    return typeof(value) === 'boolean' ? value : def;
  }

  public getString(key: string, def?: string): string | undefined {
    const value = this.values.get(key);
    return typeof(value) === 'string' ? value : def;
  }

  public getInt(key: string, def: number): number {
    const value = this.values.get(key);
    return typeof(value) === 'number' && Number.isFinite(value) ? Math.trunc(value) : def;
  }

  /** `undefined` removes the value: the key reads as its default again. */
  public set(key: string, value: SettingValue): Promise<void> {
    if(typeof(value) === 'number') value = Math.trunc(value);
    this.apply(key, value);
    this.channel?.postMessage({type: 'set', key, value} satisfies SyncMessage);
    return (value === undefined ? this.storage.delete('settings', key) : this.storage.set('settings', key, value))
    .catch((err) => console.warn('[luckgram] a setting was not stored:', key, (err as Error)?.message));
  }

  /** @returns a function that stops the listening */
  public subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ------------------------------------------------------------------ private values

  public getPrivate<T = string>(key: string): T | undefined {
    return this.privateValues.get(key);
  }

  public setPrivate(key: string, value: any): Promise<void> {
    if(value === undefined) this.privateValues.delete(key);
    else this.privateValues.set(key, value);
    // * the other tabs keep using the same device, without reading the database again
    this.channel?.postMessage({type: 'private', key, value} satisfies SyncMessage);
    return (value === undefined ? this.storage.delete('private', key) : this.storage.set('private', key, value))
    .catch((err) => console.warn('[luckgram] a value was not stored:', (err as Error)?.message));
  }

  // ------------------------------------------------------------------ everything

  /** Every setting and private value, here and in the other tabs (all accounts logged out). */
  public async clear() {
    this.applyClear();
    this.channel?.postMessage({type: 'clear'} satisfies SyncMessage);
    await this.storage.clear().catch((err) => console.warn('[luckgram] settings were not cleared:', (err as Error)?.message));
  }
}

function makeDefaultStorage(): LuckgramStorage {
  return typeof(indexedDB) !== 'undefined' ? new LuckgramIndexedDBStorage() : new LuckgramMemoryStorage();
}

const LuckgramSettings = new LuckgramSettingsStore(makeDefaultStorage());
export default LuckgramSettings;
