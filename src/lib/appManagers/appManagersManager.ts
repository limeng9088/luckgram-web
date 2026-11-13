import ServiceMessagePort from '@lib/serviceWorker/serviceMessagePort';
import App from '@config/app';
import {MOUNT_CLASS_TO} from '@config/debug';
import callbackify from '@helpers/callbackify';
import deferredPromise, {CancellablePromise} from '@helpers/cancellablePromise';
import cryptoMessagePort from '@lib/crypto/cryptoMessagePort';
import lottieMessagePort from '@lib/lottie/lottieMessagePort';
import {THREADED_WORKER_TYPES, ThreadedWorkerType} from '@lib/threadedWorkerTypes';
import MTProtoMessagePort from '@lib/mainWorker/mainMessagePort';
import {AppStoragesManager} from '@appManagers/appStoragesManager';
import createManagers from '@appManagers/createManagers';
import {ActiveAccountNumber} from '@lib/accounts/types';
import {ACCOUNT_NUMBERS} from '@lib/accounts/constants';
import AppStateManager from '@appManagers/appStateManager';
import rootScope from '@lib/rootScope';
import AccountController from '@lib/accounts/accountController';
import pushSingleManager from '@appManagers/pushSingleManager';
import Modes from '@config/modes';
import SuperMessagePort from '@lib/superMessagePort';
import objectUrlRegistry from '@lib/mainWorker/objectUrlRegistry';
import {makeObjectUrlOwner, parseObjectUrlOwner} from '@helpers/objectUrlUtils';
import {releaseSharedObjectURLsWhere} from '@lib/mainWorker/sharedObjectUrlCache';

type Managers = Awaited<ReturnType<typeof createManagers>>;

// for testing cases without video streaming
const CAN_USE_SERVICE_WORKER = !Modes.noServiceWorker;

// * Luckgram (W4): only the slots someone is signed in to, or works in, have managers (see createManagers)
type ManagersByAccount = Partial<Record<ActiveAccountNumber, Managers>>;
type StateManagersByAccount = Record<ActiveAccountNumber, AppStateManager>;

type ThreadedSharedWorker = {
  urls: string[],
  attached: number,
  promise: CancellablePromise<void>,
  superMessagePort?: SuperMessagePort<any, any, any>,
  threads: number
};

export class AppManagersManager {
  private managersByAccount: Promise<ManagersByAccount> | ManagersByAccount;
  public readonly stateManagersByAccount: StateManagersByAccount;
  private threadedSharedWorkers: {[type in ThreadedWorkerType]?: ThreadedSharedWorker};

  private _isServiceWorkerOnline: boolean;

  private serviceMessagePort: ServiceMessagePort<true>;
  private _serviceMessagePort: MessagePort

  constructor() {
    this._isServiceWorkerOnline = CAN_USE_SERVICE_WORKER;

    this.threadedSharedWorkers = {};
    for(
      const {type, superMessagePort, threads} of THREADED_WORKER_TYPES.map((type) => {
        return {
          type,
          superMessagePort: type === 'crypto' ? cryptoMessagePort : lottieMessagePort,
          threads: type === 'crypto' ? App.cryptoWorkers : App.lottieWorkers
        };
      })
    ) {
      this.threadedSharedWorkers[type] = {
        urls: [],
        attached: 0,
        promise: deferredPromise(),
        superMessagePort,
        threads
      };

      this.threadedSharedWorkers[type].promise.then(() => {
        this.threadedSharedWorkers[type].promise = undefined;
      });
    }

    this.stateManagersByAccount = Object.fromEntries(
      ACCOUNT_NUMBERS.map((accountNumber) => [accountNumber, new AppStateManager(accountNumber)])
    ) as StateManagersByAccount;

    const managersByAccountAsArray = Object.values(this.stateManagersByAccount)

    managersByAccountAsArray.forEach((stateManager) => {
      stateManager.onSettingsUpdate = (settingsValue) => {
        managersByAccountAsArray.forEach((stateManagerToUpdate) => {
          if(stateManager !== stateManagerToUpdate)
            stateManagerToUpdate.updateLocalState('settings', settingsValue);
        });
      }
    })
  }

  public start() {
    const port = MTProtoMessagePort.getInstance<false>();

    port.addEventListener('manager', ({name, method, args, accountNumber}) => {
      return callbackify(this.getManagersByAccount(), (managersByAccount) => {
        if(accountNumber === undefined) {
          const results: any[] = [];
          for(const accountNumber in managersByAccount) {
            const managers = managersByAccount[+accountNumber as any as ActiveAccountNumber];
            const manager = managers[name as keyof Managers];
            // @ts-ignore
            results.push(manager[method](...args));
          }

          return results.some((result) => result instanceof Promise) ? Promise.all(results) : results;
        }

        return callbackify(this.getManagers(accountNumber), (managers) => {
          const manager = managers[name as keyof Managers];
          // @ts-ignore
          return manager[method](...args);
        });
      });
    });

    port.addEventListener('threadedPort', (type, source, event) => {
      const threadedWorker = this.threadedSharedWorkers[type];
      const port = event.ports[0];
      // A threaded worker can post its MessagePort before createProxyWorkerURLs
      // has populated urls, so cap by the configured thread count instead.
      if(threadedWorker.attached >= threadedWorker.threads) {
        port.close();
        return;
      }

      ++threadedWorker.attached;
      threadedWorker.superMessagePort.attachPort(port);
      threadedWorker.promise?.resolve();
    });

    port.addEventListener('createProxyWorkerURLs', ({originalUrl, blob, type}) => {
      const {urls, threads} = this.threadedSharedWorkers[type];
      let length = urls.length;
      if(!length) {
        urls.push(originalUrl);
        ++length;
      }

      const maxLength = threads;
      if(length === maxLength) {
        return urls;
      }

      const newURLs = new Array(maxLength - length).fill(undefined).map((_, index) => {
        const owner = makeObjectUrlOwner('threaded-worker', type, length + index);
        return objectUrlRegistry.createShared(blob, owner);
      });
      urls.push(...newURLs);
      return urls;
    });

    rootScope.addEventListener('account_logged_in', async({accountNumber, userId}) => {
      // * a new account goes to the first free slot, and Web A leaves gaps: the same one may be after it
      const existing = (await AccountController.getAccounts()).find(([otherAccountNumber, accountData]) => {
        return otherAccountNumber !== accountNumber && accountData.userId === userId;
      });
      if(existing) {
        const [otherAccountNumber] = existing;
        const managers = await this.getManagers(accountNumber);
        // * the slots after the one signed out move down by one
        managers.apiManager.logOut(
          (otherAccountNumber > accountNumber ? otherAccountNumber - 1 : otherAccountNumber) as ActiveAccountNumber
        );
      }
    });

    rootScope.addEventListener('logging_out', ({accountNumber}) => {
      releaseSharedObjectURLsWhere((owner) => {
        const details = parseObjectUrlOwner(owner);
        return !!details &&
          details.namespace !== 'threaded-worker' &&
          (accountNumber === undefined || details.parts[0] === accountNumber);
      });
    });
  }

  // * Luckgram (luckgram-specs#140, W4). Upstream makes the managers of every slot as the worker starts, and
  // * each set connects to Telegram and opens its databases whether anyone is signed in there or not: fine
  // * with 4 slots, not with 20. Here a slot gets its managers when it has an account — known from the state
  // * its tab sends — or when someone asks for them: the tab that shows the slot, to sign in there.
  private createdManagers: ManagersByAccount = {};
  private managersPromises: Partial<Record<ActiveAccountNumber, Promise<Managers>>> = {};

  private createManagersFor(accountNumber: ActiveAccountNumber) {
    return this.managersPromises[accountNumber] ??= (async() => {
      const stateManager = this.stateManagersByAccount[accountNumber]
      const appStoragesManager = new AppStoragesManager(accountNumber, stateManager.resetStoragesPromise);

      await Promise.all([
        // new Promise(() => {}),
        appStoragesManager.loadStorages(),
        // In Modes.noWorker the crypto worker is never spawned — the registry
        // is imported into the main realm and cryptoMessagePort short-circuits
        // same-realm callers via invokeCryptoNew's early-out. There's nothing
        // to wait for and the threadedPort handshake never resolves, so skip.
        Modes.noWorker ? Promise.resolve() : this.threadedSharedWorkers.crypto.promise
      ]);

      const managers = await createManagers(
        appStoragesManager,
        stateManager,
        accountNumber,
        stateManager.userId
      );

      return this.createdManagers[accountNumber] = managers;
    })();
  }

  /** The managers of one slot; made now if the slot had none. */
  public getManagers(accountNumber: ActiveAccountNumber): MaybePromise<Managers> {
    return this.createdManagers[accountNumber] ?? this.createManagersFor(accountNumber);
  }

  private async createManagers() {
    await Promise.all(ACCOUNT_NUMBERS.map(async(accountNumber) => {
      const stateManager = this.stateManagersByAccount[accountNumber];
      // * the slot's state has come from a tab: it says whether an account is signed in there
      await stateManager.resetStoragesPromise;
      if(stateManager.userId || this.managersPromises[accountNumber]) {
        await this.createManagersFor(accountNumber);
      }
    }));

    // * the same object the slots made later are added to
    return this.createdManagers;
  }

  public getManagersByAccount() {
    return this.managersByAccount ??= this.createManagers();
  }

  // * For diagnostics only (see memoryStats): reading a report must never be what CREATES the
  // * managers - getManagersByAccount() would do exactly that.
  public get areManagersCreated() {
    return !!this.managersByAccount;
  }

  public get isServiceWorkerOnline() {
    return this._isServiceWorkerOnline;
  }

  public set isServiceWorkerOnline(value) {
    this._isServiceWorkerOnline = CAN_USE_SERVICE_WORKER ? value : false;
  }

  public getServiceMessagePort() {
    return this._isServiceWorkerOnline ? this.serviceMessagePort : undefined;
  }

  public onServiceWorkerPort(event: MessageEvent<any>) {
    if(this.serviceMessagePort) {
      this.serviceMessagePort.detachPort(this._serviceMessagePort);
      this._serviceMessagePort = undefined;
    } else {
      this.serviceMessagePort = new ServiceMessagePort();
      this.serviceMessagePort.addMultipleEventsListeners({
        requestFilePart: (payload) => {
          return callbackify(appManagersManager.getManagers(payload.accountNumber), (managers) => {
            const {docId, dcId, offset, limit, accountNumber} = payload;
            return managers.appDocsManager.requestDocPart(docId, dcId, offset, limit);
          });
        },
        cancelFilePartRequests: ({docId, accountNumber}) => {
          return callbackify(appManagersManager.getManagers(accountNumber), (managers) => {
            return managers.appDocsManager.cancelDocPartsRequests(docId);
          });
        },
        requestRtmpState({call, accountNumber}) {
          return callbackify(appManagersManager.getManagers(accountNumber), (managers) => {
            return managers.appGroupCallsManager.fetchRtmpState(call);
          });
        },
        requestRtmpPart(payload) {
          return callbackify(appManagersManager.getManagers(payload.accountNumber), (managers) => {
            const {request, dcId, accountNumber} = payload;
            return managers.appGroupCallsManager.fetchRtmpPart(request, dcId);
          });
        },
        requestDoc(payload) {
          return callbackify(appManagersManager.getManagers(payload.accountNumber), (managers) => {
            const {docId, accountNumber} = payload;
            return managers.appDocsManager.getDoc(docId);
          });
        },
        downloadDoc(payload) {
          return callbackify(appManagersManager.getManagers(payload.accountNumber), (managers) => {
            const {docId, accountNumber} = payload;
            const appDocsManager = managers.appDocsManager;
            const doc = appDocsManager.getDoc(docId);
            return appDocsManager.downloadDoc(doc);
          });
        },
        requestAltDocsByDoc(payload) {
          return callbackify(appManagersManager.getManagers(payload.accountNumber), (managers) => {
            const {docId, accountNumber} = payload;
            const {appDocsManager} = managers;
            return appDocsManager.getAltDocsByDocument(docId);
          });
        },
        decryptPush(payload) {
          return pushSingleManager.decryptPush(payload.p, payload.keyIdBase64);
        }
      });
    }

    // * port can be undefined in the future
    if(this._serviceMessagePort = event.ports[0]) {
      this.serviceMessagePort.attachPort(this._serviceMessagePort);
    }
  }
}

const appManagersManager = new AppManagersManager();
MOUNT_CLASS_TO && (MOUNT_CLASS_TO.appManagersManager = appManagersManager);
export default appManagersManager;
