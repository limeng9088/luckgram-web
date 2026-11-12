/*
 * Luckgram Web (luckgram-specs#139, W3 需求 2): a feature's own settings page — whatever
 * component its registry entry names, under the feature's name.
 */

import {JSX, Show, createResource} from 'solid-js';
import {Dynamic} from 'solid-js/web';
import {useSuperTab} from '@components/solidJsTabs/superTabProvider';
import type {LuckgramSubpageTab} from '@/luckgram/ui/tabs';
import {useLuckgramTabTitle} from '@/luckgram/ui/tabs';

export default function LuckgramSubpage(): JSX.Element {
  const [tab] = useSuperTab<typeof LuckgramSubpageTab>();
  const feature = tab.payload.feature;
  useLuckgramTabTitle(...feature.title);

  const [module] = createResource(() => feature.subpage());
  return (
    <Show when={module()}>
      <Dynamic component={module().default} />
    </Show>
  );
}
