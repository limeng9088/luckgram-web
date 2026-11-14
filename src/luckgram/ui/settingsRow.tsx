/*
 * Luckgram Web (luckgram-specs#139, W3 需求 1): the "Luckgram 功能" row of Settings, above
 * Telegram Premium, with the Luckgram plane for its icon.
 */

import {JSX} from 'solid-js';
import Row from '@components/rowTsx';
import Section from '@components/section';
import {useSuperTab} from '@components/solidJsTabs/superTabProvider';
import {LuckgramFeaturesTab} from '@/luckgram/ui/tabs';
import {lgText} from '@/luckgram/text';

export default function LuckgramSettingsRow(): JSX.Element {
  const [tab] = useSuperTab();

  return (
    <Section class="luckgram-settings-section">
      <Row clickable={() => tab.slider.createTab(LuckgramFeaturesTab).open()}>
        <Row.Icon icon="premium_badge" class="luckgram-row-icon" />
        <Row.Title>{lgText('Luckgram 功能', 'Luckgram Features')}</Row.Title>
      </Row>
    </Section>
  );
}
