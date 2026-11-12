/*
 * Luckgram Web (luckgram-specs#139, W3 需求 3): where Luckgram's own values are kept — one
 * IndexedDB database of the origin, shared by every account, apart from upstream's databases so
 * that neither side's migrations or clean-ups touch the other.
 *
 * Two object stores:
 *   settings  switches and values (LuckgramSettings), mirrored between tabs
 *   private   the device token and the like: never mirrored, never shown
 */

export type LuckgramStoreName = 'settings' | 'private';

export interface LuckgramStorage {
  getAll(store: LuckgramStoreName): Promise<Record<string, any>>;
  set(store: LuckgramStoreName, key: string, value: any): Promise<void>;
  delete(store: LuckgramStoreName, key: string): Promise<void>;
  clear(): Promise<void>;
}

const DB_NAME = 'luckgram';
const DB_VERSION = 1;
const STORES: LuckgramStoreName[] = ['settings', 'private'];

const promisify = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export class LuckgramIndexedDBStorage implements LuckgramStorage {
  private dbPromise: Promise<IDBDatabase>;

  constructor(private factory: IDBFactory = indexedDB, private name = DB_NAME) {}

  private open() {
    return this.dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(this.name, DB_VERSION);
      request.onupgradeneeded = () => {
        for(const store of STORES) {
          if(!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
        }
      };
      request.onsuccess = () => {
        // * another tab deletes the database (all accounts logged out): let go of it
        request.result.onversionchange = () => {
          request.result.close();
          this.dbPromise = undefined;
        };
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('IDB_BLOCKED'));
    }).catch((err) => {
      this.dbPromise = undefined;
      throw err;
    });
  }

  private async store(name: LuckgramStoreName, mode: IDBTransactionMode) {
    return (await this.open()).transaction(name, mode).objectStore(name);
  }

  public async getAll(name: LuckgramStoreName) {
    const store = await this.store(name, 'readonly');
    const [keys, values] = await Promise.all([promisify(store.getAllKeys()), promisify(store.getAll())]);
    const out: Record<string, any> = {};
    keys.forEach((key, index) => out[String(key)] = values[index]);
    return out;
  }

  public async set(name: LuckgramStoreName, key: string, value: any) {
    await promisify((await this.store(name, 'readwrite')).put(value, key));
  }

  public async delete(name: LuckgramStoreName, key: string) {
    await promisify((await this.store(name, 'readwrite')).delete(key));
  }

  public async clear() {
    const db = await this.open();
    const transaction = db.transaction(STORES, 'readwrite');
    await Promise.all(STORES.map((name) => promisify(transaction.objectStore(name).clear())));
  }
}

/** Kept in memory only: the tests', and a browser that gives the page no IndexedDB (some private modes). */
export class LuckgramMemoryStorage implements LuckgramStorage {
  private data: Record<LuckgramStoreName, Record<string, any>> = {settings: {}, private: {}};

  public async getAll(name: LuckgramStoreName) {
    return {...this.data[name]};
  }

  public async set(name: LuckgramStoreName, key: string, value: any) {
    this.data[name][key] = value;
  }

  public async delete(name: LuckgramStoreName, key: string) {
    delete this.data[name][key];
  }

  public async clear() {
    this.data = {settings: {}, private: {}};
  }
}
