// Luckgram Web (luckgram-specs#140, W4): 20 account slots where upstream has 4.

const storage = vi.hoisted(() => {
  const values: Record<string, any> = {};
  const clone = (value: any) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  return {
    values,
    get: vi.fn(async(key: string) => clone(values[key])),
    set: vi.fn(async(obj: Record<string, any>) => {
      for(const key in obj) values[key] = clone(obj[key]);
    }),
    delete: vi.fn(async(key: string) => {
      delete values[key];
    })
  };
});

const made = vi.hoisted(() => ({accounts: [] as number[]}));

vi.mock('@lib/sessionStorage', () => ({default: storage}));
vi.mock('@lib/passcode/deferredIsUsingPasscode', () => ({default: {isUsingPasscode: async() => false, resolveDeferred: () => {}}}));
// * what a slot costs upstream: its managers (connections to Telegram) and its storages (databases)
vi.mock('@appManagers/createManagers', () => ({
  default: async(_storages: any, _state: any, accountNumber: number, userId: number) => {
    made.accounts.push(accountNumber);
    return {accountNumber, userId};
  }
}));
vi.mock('@appManagers/appStoragesManager', () => ({
  AppStoragesManager: class {
    constructor(_accountNumber: number, private state: Promise<any>) {}
    loadStorages() {
      return this.state;
    }
  }
}));

import '@helpers/peerIdPolyfill';
import AccountController from '@lib/accounts/accountController';
import {ACCOUNT_NUMBERS, MAX_ACCOUNTS, MAX_ACCOUNTS_FREE, MAX_ACCOUNTS_PREMIUM} from '@lib/accounts/constants';
import {getValidatedAccount} from '@lib/accounts/getValidatedAccount';
import type {ActiveAccountNumber} from '@lib/accounts/types';
import {ACCOUNTS_SCROLL_FROM, luckgramAccountsLimitText, luckgramScrollAccountItems} from '@/luckgram/accounts';
import {setLuckgramLangCode} from '@/luckgram/text';

const AUTH_KEY = 'ab'.repeat(256);
const signIn = (accountNumber: number, userId = 1000 + accountNumber) => {
  storage.values[`account${accountNumber}`] = {userId: '' + userId, dcId: 2, dc2_auth_key: AUTH_KEY, auth_key_fingerprint: 'abababab', push_key: 'cd'};
};

describe('luckgram accounts: 20 slots', () => {
  beforeEach(() => {
    for(const key in storage.values) delete storage.values[key];
  });

  test('the limit is 20, the same with Telegram Premium and without', () => {
    expect(MAX_ACCOUNTS).toBe(20);
    expect(MAX_ACCOUNTS_FREE).toBe(20);
    expect(MAX_ACCOUNTS_PREMIUM).toBe(20);
    expect(ACCOUNT_NUMBERS).toEqual(Array.from({length: 20}, (_, index) => index + 1));

    // * the type lists the same numbers: this would not compile with a slot the type does not have
    const last: ActiveAccountNumber = 20;
    expect(ACCOUNT_NUMBERS[ACCOUNT_NUMBERS.length - 1]).toBe(last);
  });

  test('the `account` address parameter: 1 to 20, anything else is the first account', () => {
    expect(getValidatedAccount('5')).toBe(5);
    expect(getValidatedAccount(20)).toBe(20);
    for(const input of ['21', '0', '-3', 'abc', '', undefined as any, 1e9]) {
      expect(getValidatedAccount(input)).toBe(1);
    }
  });

  test('every slot is read: 20 accounts are 20 accounts, and then there is no free slot', async() => {
    for(let i = 1; i <= 19; ++i) signIn(i);
    expect(await AccountController.getTotalAccounts()).toBe(19);
    expect(await AccountController.getFreeAccountNumber()).toBe(20);

    signIn(20);
    expect(await AccountController.getAccountNumbers()).toEqual(ACCOUNT_NUMBERS);
    expect(await AccountController.getFreeAccountNumber()).toBeUndefined();
    expect((await AccountController.get(20)).userId).toBe(1020);
  });

  test('an account signs out: the ones after it move down by one, up to the twentieth', async() => {
    for(let i = 1; i <= 20; ++i) signIn(i);
    await AccountController.shiftAccounts(7);

    expect(await AccountController.getTotalAccounts()).toBe(19);
    expect((await AccountController.getUserIds())).toEqual([
      ...Array.from({length: 6}, (_, index) => 1001 + index),
      ...Array.from({length: 13}, (_, index) => 1008 + index)
    ]);
    expect(storage.values.account20).toBeUndefined();
    expect(await AccountController.getFreeAccountNumber()).toBe(20);
  });

  test('what is said at the limit: the number, and nothing about Premium', () => {
    setLuckgramLangCode('zh-hans');
    expect(luckgramAccountsLimitText()).toBe('最多登录 20 个账号');
    setLuckgramLangCode('en');
    // * English interface, whatever the browser's language is
    const english = luckgramAccountsLimitText();
    setLuckgramLangCode(undefined);
    for(const text of [english, luckgramAccountsLimitText()]) {
      expect(text).toContain('20');
      expect(text).not.toMatch(/premium/i);
    }
  });
});

describe('luckgram accounts: the main menu with many accounts', () => {
  const menu = (accounts: number) => {
    const element = document.createElement('div');
    const items = Array.from({length: accounts}, (_, index) => {
      const item = document.createElement('div');
      item.textContent = 'account ' + (index + 1);
      return item;
    });
    const rest = document.createElement('div');
    rest.textContent = 'Add Account';
    element.append(...items, rest);
    return {element, items, rest};
  };

  test('few accounts: the menu is left as it is', () => {
    const {element, items} = menu(ACCOUNTS_SCROLL_FROM - 1);
    expect(luckgramScrollAccountItems(items)).toBeUndefined();
    expect(element.children.length).toBe(ACCOUNTS_SCROLL_FROM);
  });

  test('20 accounts: their items go into one list that scrolls, in order, ahead of the rest of the menu', () => {
    const {element, items, rest} = menu(20);
    const container = luckgramScrollAccountItems(items);
    expect(container.classList.contains('luckgram-accounts-scroll')).toBe(true);
    expect([...element.children]).toEqual([container, rest]);
    expect([...container.children]).toEqual(items);
  });

  test('items that are not in the menu (yet) are no reason to break it', () => {
    const {element, items} = menu(8);
    expect(luckgramScrollAccountItems([...items, undefined, document.createElement('div')])).toBeDefined();
    expect(element.querySelectorAll('.luckgram-accounts-scroll').length).toBe(1);
    expect(luckgramScrollAccountItems([])).toBeUndefined();
  });
});

describe('luckgram accounts: an empty slot costs nothing', () => {
  test('managers are made for the slots with an account, and for a slot when someone works in it', async() => {
    const {default: appManagersManager} = await import('@appManagers/appManagersManager');
    const arrive = (accountNumber: ActiveAccountNumber, userId?: number) => {
      const stateManager = appManagersManager.stateManagersByAccount[accountNumber];
      stateManager.userId = userId as any;
      stateManager.resetStoragesPromise.resolve({storages: new Map(), callback: async() => {}} as any);
    };

    expect(Object.keys(appManagersManager.stateManagersByAccount).length).toBe(20);
    // * no crypto worker in a test: what the managers wait for is there
    (appManagersManager as any).threadedSharedWorkers.crypto.promise?.resolve();
    const all = appManagersManager.getManagersByAccount();

    // * the tab sends the state of every slot: two have an account
    for(const accountNumber of ACCOUNT_NUMBERS) {
      arrive(accountNumber, accountNumber === 1 || accountNumber === 14 ? 1000 + accountNumber : undefined);
    }

    const managersByAccount = await all;
    expect(Object.keys(managersByAccount)).toEqual(['1', '14']);
    expect(made.accounts.sort((a, b) => a - b)).toEqual([1, 14]);

    // * a tab opens the first free slot to sign in there
    const managers = await appManagersManager.getManagers(2);
    expect(managers).toMatchObject({accountNumber: 2});
    expect(Object.keys(await appManagersManager.getManagersByAccount())).toEqual(['1', '2', '14']);

    // * and asking again makes nothing new
    expect(appManagersManager.getManagers(2)).toBe(managers);
    await appManagersManager.getManagers(14);
    expect(made.accounts.length).toBe(3);
  });
});

// ---- a pull request's site is tried on the tester's computer (scripts/luckgram/serve.mjs, specs#167)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CONTENT_TYPES, headersFor, resolveFile} from '../../scripts/luckgram/serve.mjs';

describe('luckgram: the server that tries a built site locally', () => {
  const HEADERS = [
    '/*',
    '  Content-Security-Policy: default-src \'self\'; connect-src \'self\' https://*.telegram.org',
    '  X-Content-Type-Options: nosniff',
    '',
    'https://:project.pages.dev/*',
    '  X-Robots-Tag: noindex, nofollow',
    '',
    '/luckgram-version',
    '  Cache-Control: no-store',
    ''
  ].join('\n');

  test('the site\'s own headers: the policy on every path, a path\'s own on that path, another host\'s on none', () => {
    expect(headersFor(HEADERS, '/')).toEqual({
      'Content-Security-Policy': 'default-src \'self\'; connect-src \'self\' https://*.telegram.org',
      'X-Content-Type-Options': 'nosniff'
    });
    expect(headersFor(HEADERS, '/luckgram-version')['Cache-Control']).toBe('no-store');
    expect(headersFor(HEADERS, '/fAbCdEfGh.js')['Cache-Control']).toBeUndefined();
    expect(headersFor(HEADERS, '/')['X-Robots-Tag']).toBeUndefined();
    expect(headersFor('', '/')).toEqual({});
  });

  test('files of the site and nothing outside it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-serve-'));
    try {
      fs.mkdirSync(path.join(root, 'site', 'assets'), {recursive: true});
      fs.writeFileSync(path.join(root, 'site', 'index.html'), '<html></html>');
      fs.writeFileSync(path.join(root, 'site', 'assets', 'a b.png'), 'x');
      fs.writeFileSync(path.join(root, 'secret.txt'), 'x');
      const site = path.join(root, 'site');

      expect(resolveFile(site, '/')).toBe(path.join(site, 'index.html'));
      expect(resolveFile(site, '/index.html')).toBe(path.join(site, 'index.html'));
      expect(resolveFile(site, '/assets/a%20b.png')).toBe(path.join(site, 'assets', 'a b.png'));
      for(const pathname of ['/../secret.txt', '/..%2Fsecret.txt', '/%2e%2e/secret.txt', '/assets/../../secret.txt', '/nope.js', '/assets/', '/%E0%A4%A', '/a%00b']) {
        expect(resolveFile(site, pathname)).toBeUndefined();
      }
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  test('scripts, styles, the manifest and WebAssembly go out as what they are: a browser refuses them otherwise', () => {
    expect(CONTENT_TYPES['.js']).toMatch(/^text\/javascript/);
    expect(CONTENT_TYPES['.css']).toMatch(/^text\/css/);
    expect(CONTENT_TYPES['.wasm']).toBe('application/wasm');
    expect(CONTENT_TYPES['.webmanifest']).toMatch(/^application\/manifest\+json/);
  });
});
