/*
 * Luckgram Web (luckgram-specs#139, W3): Luckgram's settings pages as tabs of the left column,
 * made the way upstream makes its own (scaffoldSolidJSTab). Upstream titles a tab with a language
 * pack key; Luckgram's texts are its own, so a page sets its title itself (`useLuckgramTabTitle`).
 */

import {scaffoldSolidJSTab} from '@components/solidJsTabs/scaffoldSolidJSTab';
import {useSuperTab} from '@components/solidJsTabs/superTabProvider';
import type {LuckgramFeature} from '@/luckgram/core/features';
import {lgText} from '@/luckgram/text';

export const LuckgramFeaturesTab = scaffoldSolidJSTab({
  title: 'Settings',
  getComponentModule: () => import('./featuresTab')
});

export type LuckgramSubpagePayload = {feature: LuckgramFeature};

/** The settings page of one feature: the registry entry's `subpage`. */
export const LuckgramSubpageTab = scaffoldSolidJSTab<LuckgramSubpagePayload>({
  title: 'Settings',
  getComponentModule: () => import('./subpageTab')
});

export function useLuckgramTabTitle(zh: string, en: string) {
  const [tab] = useSuperTab();
  ((tab as any).title as HTMLElement)?.replaceChildren(lgText(zh, en));
  return tab;
}
