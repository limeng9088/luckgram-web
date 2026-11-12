/*
 * Luckgram Web (luckgram-specs#137, W1 需求 6): the link to the source under the version line of
 * Settings. The app is a modified Telegram Web K, GPL-3.0, so its source has to be offered.
 */

import {JSX} from 'solid-js';
import {LUCKGRAM_SOURCE_URL} from '@/luckgram/config';
import {lgText} from '@/luckgram/text';

export default function LuckgramSourceLink(): JSX.Element {
  return (
    <a
      class="luckgram-source-link"
      href={LUCKGRAM_SOURCE_URL}
      target="_blank"
      rel="noopener noreferrer"
    >
      {lgText('源代码（GPL-3.0）', 'Source code (GPL-3.0)')}
    </a>
  );
}
