/*
 * Luckgram Web (luckgram-specs#138, W2): what the route's page side asks of the app — is it
 * connected, tell me when that changes, reconnect now. Kept apart from page.ts so that page.ts
 * has no part of upstream in it.
 */

import App from '@config/app';
import rootScope from '@lib/rootScope';
import {ConnectionStatus} from '@lib/mtproto/connectionStatus';
import type {RoutePageOptions} from '@/luckgram/relay/page';

export const connection: RoutePageOptions = {
  onRetry: () => {
    rootScope.managers?.networkerFactory.forceReconnectTimeout();
  },
  isConnected: async() => {
    if(!rootScope.managers) return false;
    const [baseDcId, statuses] = await Promise.all([
      rootScope.managers.apiManager.getBaseDcId(),
      rootScope.managers.rootScope.getConnectionStatus()
    ]);
    return statuses['NET-' + (baseDcId || App.baseDcId)]?.status === ConnectionStatus.Connected;
  },
  onConnectionChange: (callback) => {
    rootScope.addEventListener('connection_status_change', callback);
  }
};
