/*
 * Luckgram Web (luckgram-specs#138, W2 需求 9): the traffic counters as text, for the connection
 * section — what went through the relay and past it since the app was opened.
 */

import {RouteTraffic} from '@/luckgram/relay/state';
import {lgText} from '@/luckgram/text';

export function formatBytes(bytes: number) {
  if(bytes < 1024) return bytes + ' B';
  if(bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(2) + ' MB';
}

/** What went through the relay and past it since the app was opened: the numbers for the relay's usage. */
export function describeRouteTraffic(traffic: RouteTraffic | undefined): string {
  if(!traffic) return '';
  const part = (counter: RouteTraffic['relayClient']) =>
    `${counter.connections} · ↑${formatBytes(counter.up)} ↓${formatBytes(counter.down)}`;
  return [
    lgText('中转 · 消息：', 'Relay · messages: ') + part(traffic.relayClient),
    lgText('中转 · 文件：', 'Relay · files: ') + part(traffic.relayMedia),
    lgText('官方 · 消息：', 'Telegram · messages: ') + part(traffic.officialClient),
    lgText('官方 · 文件：', 'Telegram · files: ') + part(traffic.officialMedia)
  ].join('\n');
}
