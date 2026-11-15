/*
 * Luckgram Web (luckgram-specs#192, W10 需求 6、7): what the profile's rows need of Luckgram —
 * the ID in the form the feature shows it (upstream's own ID row is reused, peerProfile.tsx), and
 * the row of the registration month, estimated from the phones' table on this device.
 */

import {JSX, Show, createMemo} from 'solid-js';
import Row from '@components/rowTsx';
import {copyTextToClipboard} from '@helpers/clipboard';
import {toastNew} from '@components/toast';
import {useFeatureEnabled} from '@/luckgram/core/hooks';
import {lgText} from '@/luckgram/text';
import {DatePoint, PROFILE_DETAILS, PeerKind, displayId, estimateRegistration, formatEstimate, parseTable, userLink} from '@/luckgram/profile/logic';
import registrationDates from '@/luckgram/profile/registrationDates';

let table: DatePoint[];
const getTable = () => table ??= parseTable(registrationDates);

export const useProfileDetails = () => useFeatureEnabled(PROFILE_DETAILS);

export const getPeerKind = (peerId: PeerId, isChannel: boolean): PeerKind => +peerId > 0 ? 'user' : isChannel ? 'channel' : 'chat';

/** The ID as the feature shows and copies it. */
export const getDisplayId = (peerId: PeerId, isChannel: boolean) => displayId(getPeerKind(peerId, isChannel), Math.abs(+peerId));

/** "复制链接" of the ID row's menu: users and bots only. */
export function copyUserLink(peerId: PeerId) {
  const link = userLink(getPeerKind(peerId, false), Math.abs(+peerId));
  if(!link) return;
  copyTextToClipboard(link);
  toastNew({langPackKey: 'LinkCopied'});
}

export const COPY_LINK_TEXT = () => lgText('复制链接', 'Copy link');

/** "约 2019 年 10 月" of a user or a bot; nothing for an id newer than the table. */
export function getRegistrationText(peerId: PeerId): string | undefined {
  if(!(+peerId > 0)) return;
  const texts = formatEstimate(estimateRegistration(getTable(), +peerId));
  return texts && lgText(...texts);
}

export function LuckgramRegistrationRow(props: {peerId: PeerId}): JSX.Element {
  const enabled = useProfileDetails();
  const text = createMemo(() => enabled() ? getRegistrationText(props.peerId) : undefined);
  return (
    <Show when={text()}>
      <Row>
        <Row.Icon icon="calendar" />
        <Row.Title>{text()}</Row.Title>
        <Row.Subtitle>{lgText('注册时间（按 ID 估算）', 'Registered (estimated from the ID)')}</Row.Subtitle>
      </Row>
    </Show>
  );
}
