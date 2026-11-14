/*
 * Luckgram Web (luckgram-specs#139, W3 需求 1、2): Settings → "Luckgram 功能". The page is
 * generated from the feature registry (core/features.ts): the phones' groups in the phones' order,
 * a row per feature — name, a line of description, a switch — and a tap on a feature with a page
 * of its own opens it. Then the connection mode (W2), the AI consent, the debug page on the
 * development address, and the version.
 */

import {For, JSX, Show} from 'solid-js';
import App from '@config/app';
import CheckboxFieldTsx from '@components/checkboxFieldTsx';
import confirmationPopup from '@components/confirmationPopup';
import Row from '@components/rowTsx';
import Section from '@components/section';
import {getLuckgramVersionText} from '@/luckgram/config';
import {
  FEATURE_GROUPS, FEATURE_GROUP_TITLES, FeatureGroup, LuckgramFeature, getVisibleFeatures, isDevToolsVisible, setFeatureEnabled
} from '@/luckgram/core/features';
import {useBoolSetting, useFeatureSwitch} from '@/luckgram/core/hooks';
import {KEY_AI_CONSENT} from '@/luckgram/core/ai';
import luckgramAI from '@/luckgram/core/instance';
import {remoteConfig} from '@/luckgram/core/remoteConfig';
import LuckgramConnectionSection from '@/luckgram/relay/connectionSection';
import {LuckgramSubpageTab, useLuckgramTabTitle} from '@/luckgram/ui/tabs';
import {lgText} from '@/luckgram/text';

function FeatureRow(props: {feature: LuckgramFeature, openSubpage: (feature: LuckgramFeature) => void}): JSX.Element {
  const enabled = useFeatureSwitch(props.feature.key);
  const hasSubpage = !!props.feature.subpage;

  return (
    <Row clickable={hasSubpage ? () => props.openSubpage(props.feature) : undefined}>
      <Row.CheckboxFieldToggle>
        <CheckboxFieldTsx
          toggle
          checked={enabled()}
          onChange={(checked) => checked !== enabled() && setFeatureEnabled(props.feature.key, checked)}
        />
      </Row.CheckboxFieldToggle>
      <Row.Title>{lgText(...props.feature.title)}</Row.Title>
      <Row.Subtitle>{lgText(...props.feature.description)}</Row.Subtitle>
    </Row>
  );
}

function AiConsentRow(): JSX.Element {
  const consent = useBoolSetting(KEY_AI_CONSENT, false);

  const onClick = () => {
    if(!consent()) return;
    confirmationPopup({
      title: lgText('撤回 AI 授权？', 'Revoke AI consent?'),
      descriptionRaw: lgText('撤回后下次使用 AI 功能时会重新询问。', 'You\'ll be asked again the next time you use an AI feature.'),
      button: {text: document.createTextNode(lgText('撤回', 'Revoke')), isDanger: true}
    }).then(() => luckgramAI.revokeConsent(), () => {});
  };

  return (
    <Row clickable={consent() ? onClick : undefined}>
      <Row.Title>{lgText('AI 服务授权', 'AI service consent')}</Row.Title>
      <Row.Subtitle>
        {consent() ?
          lgText('已同意，点按可撤回。撤回后下次使用 AI 功能时会重新询问。', 'Allowed. Tap to revoke; you\'ll be asked again the next time you use an AI feature.') :
          lgText('未同意，首次使用 AI 功能时会询问。', 'Not allowed. You\'ll be asked the first time you use an AI feature.')}
      </Row.Subtitle>
    </Row>
  );
}

export default function LuckgramFeaturesPage(): JSX.Element {
  const tab = useLuckgramTabTitle('Luckgram 功能', 'Luckgram Features');

  const openSubpage = (feature: LuckgramFeature) => {
    tab.slider.createTab(LuckgramSubpageTab).open({feature});
  };

  const openDebug = () => {
    // * a literal the bundler sees: the debug page is not in a production build at all
    if(import.meta.env.VITE_LG_CHANNEL !== 'prod') {
      tab.slider.createTab(LuckgramSubpageTab).open({feature: {
        key: 'debug_page', group: 'debug', default: false,
        title: ['调试页', 'Debug page'], description: ['', ''],
        subpage: () => import('./debugPage')
      }});
    }
  };

  // * the registry's rows follow the server's say as it arrives
  const features = (group: FeatureGroup) => {
    remoteConfig();
    return getVisibleFeatures(group);
  };

  const hasRows = (group: FeatureGroup) => features(group).length > 0 || group === 'ai' || (group === 'debug' && isDevToolsVisible());

  return (
    <>
      <For each={FEATURE_GROUPS.filter((group) => group !== 'ai' && group !== 'debug')}>{(group) => (
        <Show when={hasRows(group)}>
          <Section name={<span>{lgText(...FEATURE_GROUP_TITLES[group])}</span>}>
            <For each={features(group)}>{(feature) => <FeatureRow feature={feature} openSubpage={openSubpage} />}</For>
          </Section>
        </Show>
      )}</For>

      <LuckgramConnectionSection />

      <Section name={<span>{lgText(...FEATURE_GROUP_TITLES.ai)}</span>}>
        <For each={features('ai')}>{(feature) => <FeatureRow feature={feature} openSubpage={openSubpage} />}</For>
        <AiConsentRow />
      </Section>

      <Show when={isDevToolsVisible()}>
        <Section name={<span>{lgText(...FEATURE_GROUP_TITLES.debug)}</span>}>
          <For each={features('debug')}>{(feature) => <FeatureRow feature={feature} openSubpage={openSubpage} />}</For>
          <Row clickable={openDebug}>
            <Row.Title>{lgText('调试页', 'Debug page')}</Row.Title>
            <Row.Subtitle>{lgText('设备注册、远程配置、流式对话、转写', 'Device registration, remote config, streamed chat, transcription')}</Row.Subtitle>
          </Row>
        </Section>
      </Show>

      <div class="luckgram-features-footer" dir="auto">
        {getLuckgramVersionText(App.version)}
        {'\n'}
        {lgText('Luckgram 是基于 Telegram 开源代码的独立应用', 'Luckgram is an independent app based on Telegram\'s open-source code')}
      </div>
    </>
  );
}
