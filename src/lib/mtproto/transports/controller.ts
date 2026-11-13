import App from '@config/app';
import deferredPromise from '@helpers/cancellablePromise';
import EventListenerBase from '@helpers/eventListenerBase';
import pause from '@helpers/schedulers/pause';
import {TransportType, DcConfigurator} from '@lib/mtproto/dcConfigurator';
import type HTTP from '@lib/mtproto/transports/http';
import type TcpObfuscated from '@lib/mtproto/transports/tcpObfuscated';
import MTTransport from '@lib/mtproto/transports/transport';
import {LUCKGRAM_WEBSOCKET_PROBE_TIMEOUT} from '@/luckgram/relay/routes';

export class MTTransportController extends EventListenerBase<{
  change: (opened: MTTransportController['opened']) => void,
  transport: (type: TransportType) => void
}> {
  private opened: Map<TransportType, number>;
  private transports: {[k in TransportType]?: MTTransport};
  private pinging: boolean;
  private dcConfigurator: DcConfigurator;

  constructor() {
    super(true);

    this.opened = new Map();
    /* this.addEventListener('change', (opened) => {
      this.dispatchEvent('transport', opened.get('websocket') || !opened.get('https') ? 'websocket' : 'https');
    }); */

    this.addEventListener('change', (opened) => {
      if(!opened.get('websocket')) {
        this.waitForWebSocket();
      }
    });

    // setTimeout(() => {
    // this.waitForWebSocket();
    // }, 200); // wait for first transport so won't have delay for first WS
  }

  // * Luckgram: one probe at a time, shared by everyone who asks while it runs. Upstream starts one per caller —
  // * the worker's own and one per account slot, five as a page opens — each with a WebSocket of its own to the
  // * same address, and a browser makes WebSocket handshakes to one address one after another. With a handshake
  // * of 2 s (a relay, a far network) the last ones waited past their time and were taken for "no WebSocket"
  // * (luckgram-specs#146).
  private pingPromise: ReturnType<MTTransportController['pingTransportsOnce']>;

  public pingTransports() {
    return this.pingPromise ??= this.pingTransportsOnce().finally(() => {
      this.pingPromise = undefined;
    });
  }

  private async pingTransportsOnce() {
    // * Luckgram: marked as the probe's, so that the WebSocket it opens is handed to the first connection that
    // * needs one instead of being thrown away (src/luckgram/relay/routedSocket.ts, luckgram-specs#148)
    const dcConfigurator = this.dcConfigurator ??= Object.assign(new DcConfigurator(), {luckgramProbe: true});
    const timeout = 2000;
    const transports: {[k in TransportType]?: MTTransport} = this.transports = {
      https: dcConfigurator.chooseServer(App.baseDcId, 'client', 'https', false),
      websocket: dcConfigurator.chooseServer(App.baseDcId, 'client', 'websocket', false)
    };

    const httpPromise = deferredPromise<boolean>();
    ((this.transports.https as HTTP)._send(new Uint8Array(), 'no-cors') as any as Promise<any>)
    .then(() => httpPromise.resolve(true), () => httpPromise.resolve(false));
    setTimeout(() => httpPromise.resolve(false), timeout);

    const websocketPromise = deferredPromise<boolean>();
    const socket = transports.websocket as TcpObfuscated;
    socket.setAutoReconnect(false);
    socket.connection.addEventListener('close', () => websocketPromise.resolve(false), {once: true});
    socket.connection.addEventListener('open', () => websocketPromise.resolve(true), {once: true});
    const giveUpOnWebSocket = () => {
      if(websocketPromise.isFulfilled || websocketPromise.isRejected) {
        return;
      }

      if(socket.connection) {
        socket.connection.close();
      }

      websocketPromise.resolve(false);
    };

    // * Luckgram: where Telegram's addresses cannot be reached, HTTPS does not answer either and the WebSocket
    // * that will open is the relay's, which may take longer than the 2 s a direct one gets. With no HTTPS to
    // * fall back to there is nothing to gain from giving up on it early (src/luckgram/relay).
    setTimeout(() => {
      httpPromise.then((isHttpAvailable) => {
        if(isHttpAvailable) giveUpOnWebSocket();
        else setTimeout(giveUpOnWebSocket, LUCKGRAM_WEBSOCKET_PROBE_TIMEOUT - timeout);
      });
    }, timeout);

    const [isHttpAvailable, isWebSocketAvailable] = await Promise.all([httpPromise, websocketPromise]);

    for(const transportType in transports) {
      const transport = transports[transportType as TransportType];
      transport.destroy();
    }

    const result = {
      https: isHttpAvailable || this.opened.get('https') > 0,
      websocket: isWebSocketAvailable || this.opened.get('websocket') > 0
    };

    // result.websocket = false;
    return result;
  }

  public async waitForWebSocket() {
    if(this.pinging) return;
    this.pinging = true;

    while(true) {
      const {https, websocket} = await this.pingTransports();
      if(https || websocket) {
        this.dispatchEvent('transport', websocket || !https ? 'websocket' : 'https');
      }

      if(websocket) {
        break;
      }

      await pause(10000);
    }

    this.pinging = false;
  }

  public setTransportValue(type: TransportType, value: boolean) {
    let length = this.opened.get(type) || 0;
    length += value ? 1 : -1;

    this.opened.set(type, length);
    this.dispatchEvent('change', this.opened);
  }

  public setTransportOpened(type: TransportType) {
    return this.setTransportValue(type, true);
  }

  public setTransportClosed(type: TransportType) {
    return this.setTransportValue(type, false);
  }
}

const transportController = new MTTransportController();
export default transportController;
