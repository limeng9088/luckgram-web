/*
 * Luckgram Web (luckgram-specs#186, W6 需求 7): "AI 整理", under the 语音输入 switch of
 * "Luckgram 功能 → 消息与语言". Off unless switched on: dictated text is put in as it was heard.
 */

import {JSX} from 'solid-js';
import CheckboxFieldTsx from '@components/checkboxFieldTsx';
import Row from '@components/rowTsx';
import LuckgramSettings from '@/luckgram/core/settings';
import {useBoolSetting} from '@/luckgram/core/hooks';
import {lgText} from '@/luckgram/text';
import {KEY_DICTATION_TIDY} from '@/luckgram/voice/logic';

export default function DictationSettingsRows(): JSX.Element {
  const tidy = useBoolSetting(KEY_DICTATION_TIDY, false);
  return (
    <Row>
      <Row.CheckboxFieldToggle>
        <CheckboxFieldTsx
          toggle
          checked={tidy()}
          onChange={(checked) => checked !== tidy() && LuckgramSettings.set(KEY_DICTATION_TIDY, checked)}
        />
      </Row.CheckboxFieldToggle>
      <Row.Title>{lgText('语音输入后 AI 整理', 'Tidy dictation with AI')}</Row.Title>
      <Row.Subtitle>{lgText('去掉口头禅、补上标点，语言不变', 'Removes filler words and adds punctuation; the language stays')}</Row.Subtitle>
    </Row>
  );
}
