/*
 * Luckgram Web (luckgram-specs#146): one WebSocket handshake at a time per relay.
 *
 * A browser opens WebSockets to one address one after another: a second `new WebSocket` to the
 * same host waits until the first has finished its handshake. Every connection of the app that
 * goes through a relay goes to the same host — every DC, messages and files, and one per account
 * slot as the page starts — so with a handshake of 2 s (a far network) they queue up inside the
 * browser, where each one's own connection timeout keeps running: the last ones time out before
 * their turn, are retried, and queue up again.
 *
 * The gate makes that queue ours. A connection asks for its turn and only then creates its
 * socket, so nothing times out while waiting; message connections go before file connections; and
 * when a relay has just failed, those waiting for it are told at once instead of each finding out
 * for itself, one timeout after another.
 *
 * Pure logic, no imports.
 */

/** After a failed handshake a relay is taken for down this long: those waiting are not made to try it. */
export const RELAY_DOWN_MS = 5000;
/**
 * A relay that opened and then hung up without a byte from Telegram (it answers before it has reached
 * Telegram, luckgram-specs#148) is left alone this long: its handshake would succeed again at once and
 * win over the routes that work.
 */
export const RELAY_SILENT_MS = 30000;

type Waiter = {priority: number, order: number, run: (down: boolean) => void};

export type GateTicket = {
  /** The handshake ended — `ok`: the socket opened. Lets the next one in. Safe to call twice. */
  done: (ok: boolean) => void,
  /** No longer wanted: leaves the queue, or lets the next one in if the turn had come. */
  cancel: () => void
};

export class RelayGate {
  private busy = new Set<string>();
  private queues = new Map<string, Waiter[]>();
  private downUntil = new Map<string, number>();
  private silentUntil = new Map<string, number>();
  private order = 0;

  constructor(private now: () => number = Date.now) {}

  public isDown(key: string) {
    return Math.max(this.downUntil.get(key) || 0, this.silentUntil.get(key) || 0) > this.now();
  }

  /**
   * The relay opened a connection and closed it with nothing from Telegram. A handshake that succeeds
   * does not lift this: only time, or bytes from Telegram (`heard`).
   */
  public silent(key: string) {
    this.silentUntil.set(key, this.now() + RELAY_SILENT_MS);
  }

  /** Something came from Telegram through the relay. */
  public heard(key: string) {
    this.silentUntil.delete(key);
  }

  /**
   * @param key the relay's base address
   * @param priority lower goes first (0: a message connection, 1: a file connection)
   * @param run called when the turn has come, with the ticket to hand back — `down`: the relay has
   *            just failed, do not try it (nothing to hand back then); called before `enter` returns
   *            when nobody is ahead
   */
  public enter(key: string, priority: number, run: (down: boolean, ticket: GateTicket) => void): GateTicket {
    let state: 'waiting' | 'running' | 'over' = 'waiting';

    const waiter: Waiter = {
      priority,
      order: ++this.order,
      run: (down) => {
        if(down) {
          state = 'over';
          run(true, ticket);
          return;
        }

        state = 'running';
        this.busy.add(key);
        run(false, ticket);
      }
    };

    const release = (ok: boolean | undefined) => {
      if(state !== 'running') return;
      state = 'over';
      this.busy.delete(key);
      if(ok === true) this.downUntil.delete(key);
      else if(ok === false) this.downUntil.set(key, this.now() + RELAY_DOWN_MS);
      this.next(key);
    };

    const ticket: GateTicket = {
      done: (ok) => release(ok),
      cancel: () => {
        if(state === 'waiting') {
          state = 'over';
          const queue = this.queues.get(key);
          const index = queue ? queue.indexOf(waiter) : -1;
          if(index !== -1) queue.splice(index, 1);
        } else {
          // * given up in the middle of its handshake: says nothing about the relay
          release(undefined);
        }
      }
    };

    if(this.isDown(key)) {
      waiter.run(true);
    } else if(!this.busy.has(key)) {
      waiter.run(false);
    } else {
      let queue = this.queues.get(key);
      if(!queue) this.queues.set(key, queue = []);
      queue.push(waiter);
    }

    return ticket;
  }

  private next(key: string) {
    const queue = this.queues.get(key);
    if(!queue?.length) return;

    if(this.isDown(key)) {
      // * everyone waiting is told; whoever tries again after RELAY_DOWN_MS finds out whether it is back
      this.queues.delete(key);
      queue.forEach((waiter) => waiter.run(true));
      return;
    }

    let best = 0;
    for(let i = 1; i < queue.length; ++i) {
      const a = queue[i], b = queue[best];
      if(a.priority < b.priority || (a.priority === b.priority && a.order < b.order)) best = i;
    }

    queue.splice(best, 1)[0].run(false);
  }
}
