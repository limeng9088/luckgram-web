/*
 * Luckgram Web (luckgram-specs#188, W8 需求 1): whether the "Luckgram AI" row stands over the
 * chat list — under the AI 助手 switch of "Luckgram 功能 → AI", as its part: set in from it, and
 * not to be changed while that switch is off. Shown unless switched off.
 */

import {JSX} from 'solid-js';
import CheckboxFieldTsx from '@components/checkboxFieldTsx';
import Row from '@components/rowTsx';
import LuckgramSettings from '@/luckgram/core/settings';
import {useBoolSetting, useFeatureEnabled} from '@/luckgram/core/hooks';
import {lgText} from '@/luckgram/text';
import {AI_ASSISTANT, KEY_PIN} from '@/luckgram/assistant/logic';

export default function AssistantSettingsRows(): JSX.Element {
  const pinned = useBoolSetting(KEY_PIN, true);
  const enabled = useFeatureEnabled(AI_ASSISTANT);
  return (
    <Row class="luckgram-sub-row" disabled={!enabled()}>
      <Row.CheckboxFieldToggle>
        <CheckboxFieldTsx
          toggle
          disabled={!enabled()}
          checked={pinned()}
          onChange={(checked) => enabled() && checked !== pinned() && LuckgramSettings.set(KEY_PIN, checked)}
        />
      </Row.CheckboxFieldToggle>
      <Row.Title>{lgText('在聊天列表顶部显示', 'Show at the top of the chat list')}</Row.Title>
      <Row.Subtitle>{lgText('「所有聊天」上方固定一行 Luckgram AI', 'A Luckgram AI row over "All chats"')}</Row.Subtitle>
    </Row>
  );
}
