/*
 * Luckgram Web (luckgram-specs#139, W3): the page's LuckgramAI, with the consent dialog.
 *
 *   import luckgramAI from '@/luckgram/core/instance';
 *   const text = await luckgramAI.chat({task: 'summary', messages, onDelta: (delta, text) => …});
 */

import confirmationPopup from '@components/confirmationPopup';
import luckgramApi from '@/luckgram/core/client';
import {LuckgramAI} from '@/luckgram/core/ai';
import {lgText} from '@/luckgram/text';

export const AI_CONSENT_TEXT: [string, string] = [
  '你选中的内容会发送到 Luckgram 的 AI 服务，由 OpenAI 处理后返回。',
  'The content you select is sent to Luckgram\'s AI service and processed by OpenAI before it is returned.'
];

function askConsent(): Promise<boolean> {
  return confirmationPopup({
    title: lgText('使用 AI 服务', 'Use AI service'),
    descriptionRaw: lgText(...AI_CONSENT_TEXT),
    button: {text: document.createTextNode(lgText('同意', 'Agree'))},
    cancelButton: {text: document.createTextNode(lgText('不同意', 'Decline')), isCancel: true}
  }).then(() => true, () => false);
}

const luckgramAI = new LuckgramAI({api: luckgramApi, askConsent});
export default luckgramAI;
