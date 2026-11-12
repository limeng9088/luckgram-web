/*
 * Luckgram Web (luckgram-specs#139, W3 需求 11): the debug page of the development address —
 * one go at each part of the server side: the device's registration, the remote config, a streamed
 * chat, a transcription, the quota. A production build does not contain it (featuresTab.tsx
 * imports it behind a build-time check).
 */

import {JSX, Show, createSignal} from 'solid-js';
import Section from '@components/section';
import luckgramApi from '@/luckgram/core/client';
import luckgramAI from '@/luckgram/core/instance';
import {TRANSCRIBE_TYPES} from '@/luckgram/core/ai';
import {toApiError} from '@/luckgram/core/api';
import {errorMessage} from '@/luckgram/core/errors';
import {DEBUG_DEMO} from '@/luckgram/core/features';
import {useBoolSetting, useFeatureEnabled} from '@/luckgram/core/hooks';
import {previewAnnouncement} from '@/luckgram/core/announcements';
import {refreshRemoteConfig, remoteConfig} from '@/luckgram/core/remoteConfig';
import {KEY_AI_CONSENT} from '@/luckgram/core/ai';
import {lgText} from '@/luckgram/text';

const describeError = (err: any) => {
  const error = toApiError(err);
  return `${lgText(...errorMessage(error.code))} (${error.code}${error.status ? ', HTTP ' + error.status : ''})`;
};

function Result(props: {text: string, id: string}): JSX.Element {
  return <pre class="luckgram-debug-result" id={props.id} dir="auto">{props.text || '—'}</pre>;
}

export default function LuckgramDebugPage(): JSX.Element {
  const [busy, setBusy] = createSignal('');
  const [device, setDevice] = createSignal('');
  const [chat, setChat] = createSignal('');
  const [prompt, setPrompt] = createSignal(lgText('用一句话介绍你自己。', 'Introduce yourself in one sentence.'));
  const [transcript, setTranscript] = createSignal('');
  const [quota, setQuota] = createSignal('');
  const demo = useFeatureEnabled(DEBUG_DEMO);
  const consent = useBoolSetting(KEY_AI_CONSENT, false);

  const run = (name: string, work: () => Promise<void>, onError: (text: string) => void) => async() => {
    if(busy()) return;
    setBusy(name);
    try {
      await work();
    } catch(err) {
      onError(describeError(err));
    } finally {
      setBusy('');
    }
  };

  const register = run('device', async() => {
    const had = luckgramApi.isRegistered;
    await luckgramApi.ensureRegistered();
    setDevice(lgText(
      `${had ? '已注册过' : '注册成功'}，platform=web，入口 ${luckgramApi.currentEndpoint}`,
      `${had ? 'Already registered' : 'Registered'}, platform=web, entry ${luckgramApi.currentEndpoint}`
    ));
  }, setDevice);

  const registerAgain = run('device', async() => {
    await luckgramApi.forgetDevice();
    await luckgramApi.ensureRegistered();
    setDevice(lgText(`已重新注册，入口 ${luckgramApi.currentEndpoint}`, `Registered again, entry ${luckgramApi.currentEndpoint}`));
  }, setDevice);

  const sendChat = run('chat', async() => {
    setChat('');
    const text = await luckgramAI.chat({
      task: 'chat',
      messages: [{role: 'user', content: prompt()}],
      onDelta: (_delta, soFar) => setChat(soFar)
    });
    setChat(text);
  }, setChat);

  const onAudio = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if(!file) return;

    run('transcribe', async() => {
      setTranscript(lgText('转写中…', 'Transcribing…'));
      const result = await luckgramAI.transcribe(file);
      setTranscript(result.text + (result.language ? `\n(${result.language})` : ''));
    }, setTranscript)();
  };

  const loadQuota = run('quota', async() => {
    const me = await luckgramAI.me();
    const line = (name: string, q: any) => q ? `${name}: ${q.used}/${q.limit}` : '';
    setQuota([
      `tier: ${me.tier}`,
      line('chat', me.quota?.chat), line('image', me.quota?.image), line('transcribe_minutes', me.quota?.transcribe_minutes)
    ].filter(Boolean).join('\n'));
  }, setQuota);

  const configSummary = () => {
    const config = remoteConfig();
    if(!config.fetchedAt) return lgText('还没有拉到', 'Not fetched yet');
    return [
      `version: ${config.version}`,
      `fetched: ${new Date(config.fetchedAt).toLocaleString()}`,
      `values: ${Object.keys(config.values).length}, features: ${Object.keys(config.features).length}`,
      `web.relays: ${JSON.stringify(config.values['web.relays'] ?? null)}`,
      `web.relay_media: ${JSON.stringify(config.values['web.relay_media'] ?? null)}`
    ].join('\n');
  };

  const showAnnouncement = () => previewAnnouncement({
    id: 'debug-' + Date.now(),
    title: lgText('示例公告', 'Sample announcement'),
    body: lgText('这是调试页生成的公告，用来看样式。', 'Made by the debug page to check the banner.'),
    url: 'https://luckgram.cc',
    endsAtMs: 0
  });

  return (
    <div class="luckgram-debug">
      <Section name={<span>{lgText('设备', 'Device')}</span>}>
        <div class="luckgram-debug-actions">
          <button type="button" id="lg-debug-register" disabled={!!busy()} onClick={register}>{lgText('注册设备', 'Register device')}</button>
          <button type="button" disabled={!!busy()} onClick={registerAgain}>{lgText('重新注册', 'Register again')}</button>
        </div>
        <Result id="lg-debug-device" text={device()} />
      </Section>

      <Section name={<span>{lgText('远程配置', 'Remote config')}</span>}>
        <div class="luckgram-debug-actions">
          <button type="button" id="lg-debug-config" disabled={!!busy()} onClick={() => refreshRemoteConfig()}>{lgText('立即刷新', 'Refresh now')}</button>
        </div>
        <Result id="lg-debug-config-result" text={configSummary()} />
        <Result id="lg-debug-demo" text={`${DEBUG_DEMO}: ${demo() ? 'on' : 'off'}`} />
      </Section>

      <Section
        name={<span>{lgText('流式对话', 'Streamed chat')}</span>}
        caption={<span>{lgText(`AI 授权：${consent() ? '已同意' : '未同意，发送时会询问'}`, `AI consent: ${consent() ? 'allowed' : 'not allowed, you will be asked'}`)}</span>}
      >
        <textarea
          class="luckgram-debug-input"
          id="lg-debug-prompt"
          rows="2"
          value={prompt()}
          onInput={(event) => setPrompt(event.currentTarget.value)}
        />
        <div class="luckgram-debug-actions">
          <button type="button" id="lg-debug-chat" disabled={!!busy() || !prompt().trim()} onClick={sendChat}>{lgText('发送', 'Send')}</button>
        </div>
        <Result id="lg-debug-chat-result" text={chat()} />
      </Section>

      <Section
        name={<span>{lgText('语音转写', 'Transcription')}</span>}
        caption={<span>{lgText('选一个音频文件（ogg、mp3、m4a、wav、webm、flac，4 MB 以内）', 'Pick an audio file (ogg, mp3, m4a, wav, webm, flac, up to 4 MB)')}</span>}
      >
        <div class="luckgram-debug-actions">
          <input type="file" id="lg-debug-audio" accept={TRANSCRIBE_TYPES.join(',')} disabled={!!busy()} onChange={onAudio} />
        </div>
        <Result id="lg-debug-transcript" text={transcript()} />
      </Section>

      <Section name={<span>{lgText('额度', 'Quota')}</span>}>
        <div class="luckgram-debug-actions">
          <button type="button" id="lg-debug-quota" disabled={!!busy()} onClick={loadQuota}>GET /v1/me</button>
        </div>
        <Result id="lg-debug-quota-result" text={quota()} />
      </Section>

      <Section name={<span>{lgText('公告', 'Announcements')}</span>}>
        <div class="luckgram-debug-actions">
          <button type="button" id="lg-debug-announcement" onClick={showAnnouncement}>{lgText('显示示例公告', 'Show a sample announcement')}</button>
        </div>
      </Section>

      <Show when={busy()}>
        <div class="luckgram-debug-busy">{lgText('请求中…', 'Working…')}</div>
      </Show>
    </div>
  );
}
