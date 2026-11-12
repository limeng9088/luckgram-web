/*
 * Luckgram Web (luckgram-specs#138, W2 需求 8): "连接方式" — automatic, Telegram's address only,
 * relay only — and the route in use. In Settings → Experimental until the Luckgram settings page
 * is there (W3), which will show this same section.
 */

import {For, JSX} from 'solid-js';
import RadioFieldTsx from '@components/radioFieldTsx';
import Row from '@components/rowTsx';
import Section from '@components/section';
import {RouteMode} from '@/luckgram/relay/routes';
import {RouteStatus} from '@/luckgram/relay/state';
import {routeStatus, setRouteMode} from '@/luckgram/relay/page';
import {lgText} from '@/luckgram/text';

const MODES: {value: RouteMode, title: () => string, subtitle: () => string}[] = [{
  value: 'auto',
  title: () => lgText('自动', 'Automatic'),
  subtitle: () => lgText('官方地址和中转谁先连上用谁', 'Telegram\'s address or the relay, whichever connects first')
}, {
  value: 'official',
  title: () => lgText('只用官方', 'Telegram only'),
  subtitle: () => lgText('只连 Telegram 的地址', 'Connect to Telegram\'s address only')
}, {
  value: 'relay',
  title: () => lgText('只用中转', 'Relay only'),
  subtitle: () => lgText('只经 Luckgram 中转连接', 'Connect through the Luckgram relay only')
}];

export function describeRouteStatus(status: RouteStatus): string {
  if(status.state === 'failed') return lgText('当前：无法连接', 'Now: can\'t connect');
  if(status.state !== 'connected') return lgText('当前：连接中…', 'Now: connecting…');
  if(status.kind === 'official') return lgText('当前：官方', 'Now: Telegram');
  const host = (status.id || '').replace(/^wss?:\/\//, '');
  return lgText(`当前：中转（${host}）`, `Now: relay (${host})`);
}

export default function LuckgramConnectionSection(): JSX.Element {
  return (
    <Section
      name={<span>{lgText('连接方式', 'Connection')}</span>}
      caption={<span class="luckgram-route-status">{describeRouteStatus(routeStatus())}</span>}
    >
      <For each={MODES}>{(item) => (
        <Row>
          <Row.RadioField>
            <RadioFieldTsx
              name="luckgram-route-mode"
              value={item.value}
              checked={routeStatus().mode === item.value}
              onChange={(checked) => checked && setRouteMode(item.value)}
            />
          </Row.RadioField>
          <Row.Title>{item.title()}</Row.Title>
          <Row.Subtitle>{item.subtitle()}</Row.Subtitle>
        </Row>
      )}</For>
    </Section>
  );
}
