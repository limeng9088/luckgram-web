/*
 * Luckgram Web (luckgram-specs#138, W2): a connection to Telegram that finds its own way —
 * Telegram's address or one of Luckgram's relays.
 *
 * It stands where upstream's WebSocket connection stands (dcConfigurator.ts wraps the class it
 * would use) and is one to the transport above: it opens, carries messages, closes. Inside, one
 * attempt may start several sockets (routes.ts says which and when); the first to open is the
 * connection and the others are dropped. When none opens within ATTEMPT_TIMEOUT the attempt
 * closes, the page is told that nothing works, and the transport retries as it always does.
 *
 * A socket to a relay is created only when its turn has come (gate.ts): the time an attempt
 * spends waiting for other connections' handshakes does not count against it.
 */

import EventListenerBase from '@helpers/eventListenerBase';
import ctx from '@environment/ctx';
import {MTConnection, MTConnectionConstructable, MTConnectionEvents} from '@lib/mtproto/transports/transport';
import {ATTEMPT_TIMEOUT, RouteCandidate, RouteConfig, getRouteCandidates, getStartDelays} from '@/luckgram/relay/routes';
import {GateTicket, RelayGate} from '@/luckgram/relay/gate';
import {RouteMessage, RouteStatus, emptyRouteTraffic, getDefaultRouteConfig, openRouteChannel, sanitizeRouteConfig} from '@/luckgram/relay/state';

const CONFIG_WAIT = 400;

let config: RouteConfig = getDefaultRouteConfig();
let status: RouteStatus = {mode: config.mode};
let channel: BroadcastChannel;
let configReady: Promise<void>;
const live = new Set<{forceClose: () => void}>();
/** One handshake at a time per relay, for the whole context (gate.ts). */
let gate = new RelayGate();
/** The accounts on screen in the tabs: their connections take their turn at a relay before the others'. */
const activeAccounts = new Set<number>();

/**
 * Who goes first at a relay (lower first). The page starts connections for every account slot,
 * signed in or not, and each keeps renewing its keys over connections of its own; when a handshake
 * takes seconds, the account the user is looking at must not wait behind the idle ones.
 *   0  the transport probe, and messages of an account on screen
 *   1  files of an account on screen
 *   2  messages of the other accounts          3  their files
 */
export function getGatePriority(account: number | undefined, isMedia: boolean, active: Set<number> = activeAccounts) {
  const onScreen = account === undefined || !active.size || active.has(account);
  return (onScreen ? 0 : 2) + (isMedia ? 1 : 0);
}

/** For tests: forgets what connected, what failed and who is on screen. */
export function resetRouteState(accounts: number[] = []) {
  gate = new RelayGate();
  activeAccounts.clear();
  accounts.forEach((account) => activeAccounts.add(account));
}

const traffic = emptyRouteTraffic();
let trafficTimer: number;

function postStatus(next: Partial<RouteStatus>) {
  status = {...status, ...next, mode: config.mode, traffic};
  channel?.postMessage({type: 'status', status} satisfies RouteMessage);
}

/** The counters reach the page with the next status, and at most every few seconds on their own. */
function trafficChanged() {
  trafficTimer ??= ctx.setTimeout(() => {
    trafficTimer = undefined;
    postStatus({});
  }, 3000);
}

export function getRouteTraffic() {
  return traffic;
}

/** The settings as the page sent them (and, in tests, as a test sets them). */
export function applyRouteConfig(value: any) {
  const modeChanged = config.mode !== value?.mode;
  config = sanitizeRouteConfig(value);
  postStatus({});

  // * another connection mode: what is open may be on a route it does not allow
  if(modeChanged) live.forEach((socket) => socket.forceClose());
}

function init() {
  if(configReady) return configReady;

  channel = openRouteChannel();
  if(!channel) return configReady = Promise.resolve();

  configReady = new Promise<void>((resolve) => {
    const timeout = ctx.setTimeout(resolve, CONFIG_WAIT);
    channel.addEventListener('message', (event) => {
      const message = event.data as RouteMessage;
      if(message?.type === 'config') {
        clearTimeout(timeout);
        if(typeof(message.account) === 'number') activeAccounts.add(message.account);
        applyRouteConfig(message.config);
        resolve();
      } else if(message?.type === 'retry') {
        live.forEach((socket) => socket.forceClose());
      } else if(message?.type === 'hello' && status.state) {
        // * a page that opened later asks the same channel for its settings; tell it where we are
        postStatus({});
      }
    });
  });

  channel.postMessage({type: 'hello'} satisfies RouteMessage);
  return configReady;
}

export function makeRoutedConnection(Connection: MTConnectionConstructable, account?: number): MTConnectionConstructable {
  return class RoutedConnection extends EventListenerBase<MTConnectionEvents> implements MTConnection {
    private winner: MTConnection;
    private attempts = new Map<MTConnection, RouteCandidate>();
    private timers: number[] = [];
    private tickets = new Map<RouteCandidate, GateTicket>();
    private deadline: number;
    private deadlineSince: number;
    private budget = ATTEMPT_TIMEOUT;
    private closed = false;
    private opened = false;
    private isMain: boolean;
    private isMedia: boolean;
    private counter: {connections: number, up: number, down: number};

    constructor(private dcId: number, private url: string, private logSuffix: string) {
      super();
      // * the status the page shows is the main connection's, not a download's
      this.isMain = !logSuffix;
      this.isMedia = !!logSuffix;
      live.add(this);
      init().then(() => this.start());
    }

    private start() {
      if(this.closed) return;

      const candidates = getRouteCandidates(this.url, config);
      const hasPreferred = !!config.preferred && candidates[0].id === config.preferred;
      const delays = getStartDelays(candidates, hasPreferred);
      let next = 0, failed = 0;

      // * a candidate that did not open: the next one need not wait for its turn; none left — nothing works
      const onFailed = () => {
        if(this.opened || this.closed) return;
        if(++failed >= candidates.length) this.finish(true);
        else startNext();
      };

      const connectTo = (candidate: RouteCandidate, ticket?: GateTicket) => {
        const connection = new Connection(this.dcId, candidate.url, this.logSuffix);
        this.attempts.set(connection, candidate);
        this.syncDeadline();

        connection.addEventListener('open', () => {
          ticket?.done(true);
          if(this.closed || this.opened) {
            connection.close();
            return;
          }

          this.opened = true;
          this.winner = connection;
          this.clearTimers();
          this.attempts.forEach((_, other) => other !== connection && other.close());
          this.attempts.clear();
          this.cancelTickets();
          this.counter = traffic[`${candidate.kind}${this.isMedia ? 'Media' : 'Client'}`];
          ++this.counter.connections;
          trafficChanged();

          if(this.isMain) {
            config.preferred = candidate.id;
            postStatus({state: 'connected', kind: candidate.kind, id: candidate.id});
          }

          this.dispatchEvent('open');
        });

        connection.addEventListener('message', (buffer) => {
          if(this.winner !== connection) return;
          this.counter.down += buffer.byteLength;
          trafficChanged();
          this.dispatchEvent('message', buffer);
        });

        connection.addEventListener('close', () => {
          if(this.winner === connection) {
            this.finish(false);
            return;
          }

          const pending = this.attempts.delete(connection);
          // * closed by us (another candidate won, or the attempt is over) says nothing about the relay
          if(pending && !this.opened && !this.closed) ticket?.done(false);
          else ticket?.cancel();
          if(pending) {
            onFailed();
            this.syncDeadline();
          }
        });
      };

      const startNext = () => {
        if(this.closed || this.opened || next >= candidates.length) return;
        const candidate = candidates[next++];
        if(candidate.kind !== 'relay') {
          connectTo(candidate);
          return;
        }

        // * created only when no other connection is in the middle of its handshake with this relay
        let ran = false;
        const ticket = gate.enter(candidate.id, getGatePriority(account, this.isMedia), (down, ticket) => {
          ran = true;
          this.tickets.delete(candidate);
          if(this.closed || this.opened) ticket.cancel();
          else if(down) onFailed();
          else connectTo(candidate, ticket);
        });

        if(!ran) this.tickets.set(candidate, ticket);
        this.syncDeadline();
      };

      delays.forEach((delay, index) => {
        if(!delay) {
          if(index === next) startNext();
          return;
        }

        this.timers.push(ctx.setTimeout(() => {
          if(index === next) startNext();
        }, delay));
      });

      this.syncDeadline();
    }

    /**
     * The attempt's time: ATTEMPT_TIMEOUT in all, counted while a handshake of its own is under way
     * (or nothing of it is waiting either). Waiting for a turn at a relay, with no socket of its own
     * yet, stops the clock: that time is other connections' handshakes, not this one's.
     */
    private syncDeadline() {
      if(this.opened || this.closed) return;
      const waitingOnly = this.tickets.size > 0 && !this.attempts.size;

      if(waitingOnly) {
        if(this.deadline !== undefined) {
          clearTimeout(this.deadline);
          this.deadline = undefined;
          this.budget -= Date.now() - this.deadlineSince;
        }
      } else if(this.deadline === undefined) {
        this.deadlineSince = Date.now();
        this.deadline = ctx.setTimeout(() => {
          this.deadline = undefined;
          if(!this.opened && !this.closed) this.finish(true);
        }, Math.max(0, this.budget));
      }
    }

    private cancelTickets() {
      const tickets = [...this.tickets.values()];
      this.tickets.clear();
      tickets.forEach((ticket) => ticket.cancel());
    }

    private clearTimers() {
      this.timers.forEach((timer) => clearTimeout(timer));
      this.timers.length = 0;
      clearTimeout(this.deadline);
      this.deadline = undefined;
    }

    /** @param nothingWorked no address opened in this attempt */
    private finish(nothingWorked: boolean) {
      if(this.closed) return;
      this.closed = true;
      live.delete(this);
      this.clearTimers();

      const attempts = [...this.attempts.keys()];
      this.attempts.clear();
      this.cancelTickets();
      attempts.forEach((connection) => connection.close());

      if(nothingWorked && this.isMain) {
        // * what was remembered did not work either: the next attempt starts from scratch
        config.preferred = undefined;
        postStatus({state: 'failed', kind: undefined, id: undefined});
      }

      this.dispatchEvent('close');
    }

    public send = (body: Uint8Array) => {
      if(!this.winner) return;
      this.counter.up += body.byteLength;
      trafficChanged();
      this.winner.send(body);
    };

    public close() {
      const winner = this.winner;
      if(winner && !this.closed) {
        // * its close event finishes this connection, as it does for upstream's socket
        winner.close();
        return;
      }

      this.finish(false);
    }

    /** The page asked for a fresh attempt: the transport above reconnects when this closes. */
    public forceClose() {
      this.close();
    }
  };
}
