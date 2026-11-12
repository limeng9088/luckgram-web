/*
 * Luckgram Web (luckgram-specs#146): diagnostics for a connection problem that shows on a machine
 * we cannot look into. Every context (the page, the MTProto worker) keeps its last lines in
 * memory; a page opened with `?lgdiag=1` asks the others for theirs over a BroadcastChannel and
 * shows everything in a panel with a Copy button, with each context's heartbeat — a worker that
 * stops answering is seen as one.
 *
 * Nothing is sent anywhere and nothing of a message's content is logged: only what the
 * connection code did and when. No imports.
 */

const CHANNEL = 'luckgram-diag';
const MAX_LINES = 1500;
const isPage = typeof(document) !== 'undefined';
const context = isPage ? 'page' : ((self as any).name || (typeof((self as any).SharedWorkerGlobalScope) !== 'undefined' ? 'shared-worker' : 'worker'));
const id = context + '#' + Math.random().toString(36).slice(2, 6);
const born = Date.now();

type Line = {t: number, ctx: string, text: string};
type Message = {type: 'on'} | {type: 'lines', lines: Line[]} | {type: 'beat', ctx: string, t: number, lag: number, born: number};

const lines: Line[] = [];
let streaming = false;
let channel: BroadcastChannel;
try {
  channel = new BroadcastChannel(CHANNEL);
} catch(err) {}

const format = (value: any): string => {
  if(value instanceof Error) return value.name + ': ' + value.message;
  if(typeof(value) === 'object' && value !== null) {
    try {
      return JSON.stringify(value);
    } catch(err) {
      return String(value);
    }
  }

  return String(value);
};

export function diag(tag: string, ...args: any[]) {
  const line: Line = {t: Date.now(), ctx: id, text: `[${tag}] ` + args.map(format).join(' ')};
  lines.push(line);
  if(lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  if(streaming) channel?.postMessage({type: 'lines', lines: [line]} satisfies Message);
  onLine?.(line);
}

/** Who called: a few frames of the stack, for "who closed this". */
export function diagStack(skip = 2, depth = 5) {
  return (new Error().stack || '').split('\n').slice(skip, skip + depth)
  .map((frame) => frame.trim().replace(/^at /, '').replace(/\(?https?:\/\/[^/]+\//, '(').replace(/\?[^:)]*/, '').slice(0, 70)).join(' < ');
}

let onLine: (line: Line) => void;
const beats = new Map<string, {t: number, lag: number, born: number, seenAt: number}>();
const remote: Line[] = [];
const seen = new Set<string>();

channel?.addEventListener('message', (event) => {
  const message = event.data as Message;
  if(message?.type === 'on') {
    streaming = true;
    channel.postMessage({type: 'lines', lines: lines.slice()} satisfies Message);
  } else if(message?.type === 'lines' && isPage) {
    // * a context answers every request with all it has: the same line comes more than once
    for(const line of message.lines) {
      const key = line.ctx + '|' + line.t + '|' + line.text;
      if(seen.has(key)) continue;
      seen.add(key);
      remote.push(line);
      onLine?.(line);
    }

    if(remote.length > MAX_LINES * 3) remote.splice(0, remote.length - MAX_LINES * 3);
  } else if(message?.type === 'beat' && isPage) {
    beats.set(message.ctx, {t: message.t, lag: message.lag, born: message.born, seenAt: Date.now()});
  }
});

// * the heartbeat: how late each tick comes says how busy the context's thread is; no tick at all, that it hangs
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const lag = now - lastTick - 500;
  lastTick = now;
  if(lag > 400) diag('lag', `the thread was busy for ${lag} ms`);
  if(streaming || isPage) channel?.postMessage({type: 'beat', ctx: id, t: now, lag, born} satisfies Message);
}, 500);

self.addEventListener('error', (event: any) => diag('error', event?.message || event, event?.filename ? `${String(event.filename).split('/').pop()}:${event.lineno}` : ''));
self.addEventListener('unhandledrejection', (event: any) => diag('unhandledrejection', event?.reason?.stack ? String(event.reason.stack).slice(0, 300) : event?.reason));

diag('start', context, isPage ? location.pathname + location.search : String((self as any).location?.href || '').split('/').pop().slice(0, 80), navigator.userAgent.replace(/^.*?(Chrome\/[\d.]+).*$/, '$1'));

export function getDiagText() {
  const all = [...lines, ...remote].sort((a, b) => a.t - b.t);
  const t0 = all.length ? all[0].t : born;
  const now = Date.now();
  const head = [
    `Luckgram diag ${new Date(now).toISOString()} ${isPage ? location.href : ''}`,
    `UA: ${navigator.userAgent}`,
    `contexts: page ${id}` + [...beats].map(([ctx, beat]) => ` | ${ctx}: last heartbeat ${((now - beat.seenAt) / 1000).toFixed(1)}s ago, lag ${beat.lag}ms, alive ${((beat.t - beat.born) / 1000).toFixed(0)}s`).join(''),
    isPage ? `storage: lg_route_preferred=${localStorage.getItem('lg_route_preferred')} lg_route_mode=${localStorage.getItem('lg_route_mode')}` : '',
    '----'
  ];
  return head.concat(all.map((line) => `${((line.t - t0) / 1000).toFixed(3).padStart(8)} ${line.ctx.padEnd(18)} ${line.text}`)).join('\n');
}

function mountPanel() {
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;inset:auto 0 0 0;height:45vh;z-index:2147483600;background:#111;color:#ddd;font:11px/1.35 monospace;display:flex;flex-direction:column';
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:8px;padding:4px 8px;background:#222;align-items:center';
  const status = document.createElement('span');
  status.style.cssText = 'flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
  const copy = document.createElement('button');
  copy.textContent = '复制全部 / Copy all';
  copy.style.cssText = 'font:inherit;padding:2px 10px';
  const area = document.createElement('textarea');
  area.readOnly = true;
  area.style.cssText = 'flex:1;background:#111;color:#ddd;border:0;font:inherit;padding:6px 8px;white-space:pre;resize:none';
  copy.addEventListener('click', () => {
    area.value = getDiagText();
    area.select();
    navigator.clipboard?.writeText(area.value).then(() => copy.textContent = '已复制 / Copied', () => document.execCommand('copy'));
  });
  bar.append(status, copy);
  panel.append(bar, area);
  const attach = () => document.body ? document.body.append(panel) : setTimeout(attach, 50);
  attach();

  let dirty = true;
  onLine = () => dirty = true;
  setInterval(() => {
    const now = Date.now();
    status.textContent = 'lgdiag · ' + ([...beats].map(([ctx, beat]) => `${ctx} ♥ ${((now - beat.seenAt) / 1000).toFixed(1)}s ago`).join(' · ') || 'no other context has answered yet');
    if(!dirty) return;
    dirty = false;
    const atEnd = area.scrollTop + area.clientHeight >= area.scrollHeight - 30;
    area.value = getDiagText();
    if(atEnd) area.scrollTop = area.scrollHeight;
  }, 1000);
}

if(isPage) {
  (window as any).luckgramDiag = getDiagText;
  if(/[?&]lgdiag=1/.test(location.search)) {
    streaming = true;
    channel?.postMessage({type: 'on'} satisfies Message);
    // * a worker that starts later has not heard the request
    setInterval(() => channel?.postMessage({type: 'on'} satisfies Message), 2000);
    mountPanel();
  }
}
