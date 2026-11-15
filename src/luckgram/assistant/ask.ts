/*
 * Luckgram Web (luckgram-specs#188, W8 需求 5): "问 AI" in a message's menu — the message's
 * text, its links and its file's name (a text file of 1 MB or less: its content too) are put into
 * the assistant's field, for the user to add a question to. Nothing is sent until they do.
 */

import type {Document, Message, MessageEntity} from '@layer';
import appDownloadManager from '@lib/appDownloadManager';
import getMediaFromMessage from '@lib/appManagers/utils/messages/getMediaFromMessage';
import {remoteNumber} from '@/luckgram/core/remoteConfig';
import {DEFAULT_MAX_INPUT_CHARS, KEY_MAX_INPUT_CHARS, MIN_ASK_CHARS, canReadFile, composeAsk, getAskCutText} from '@/luckgram/assistant/logic';
import {openAssistant} from '@/luckgram/assistant/open';
import {lgText} from '@/luckgram/text';

function getFileName(doc: Document.document): string | undefined {
  return (doc.attributes || []).map((attribute: any) => attribute._ === 'documentAttributeFilename' ? attribute.file_name : undefined).find(Boolean) || (doc as any).file_name;
}

export async function askAboutMessage(message: Message.message) {
  const links = ((message.totalEntities || message.entities || []) as MessageEntity[])
  .map((entity) => entity._ === 'messageEntityTextUrl' ? entity.url : undefined)
  .filter(Boolean);

  const media = getMediaFromMessage(message, true);
  const doc = media?._ === 'document' ? media as Document.document : undefined;
  // * a voice message, a sticker, a video are not files to name
  const isFile = doc && (!doc.type || doc.type === 'pdf');
  const fileName = isFile ? getFileName(doc) : undefined;

  let fileContent: string;
  if(fileName && canReadFile(doc.mime_type, fileName, doc.size as number)) {
    try {
      const blob = await appDownloadManager.downloadMedia({media: doc});
      fileContent = await blob.text();
    } catch(err) {
      // * the name alone goes
    }
  }

  const page = await openAssistant();
  if(!page) return;
  // * what is in the field already stays, under what is brought: the room a request has is for the two
  // * together (brought twice, the field held twice what can be sent)
  const before = page.getInput();
  const maxChars = remoteNumber(KEY_MAX_INPUT_CHARS, DEFAULT_MAX_INPUT_CHARS);
  const {text, cut} = composeAsk({text: message.message, links, fileName, fileContent}, Math.max(MIN_ASK_CHARS, maxChars - before.length));
  // * said in words, in a line over the field: the "…" at the end alone does not tell that something was
  // * left out. Not a toast — upstream's takes the next press anywhere, and the next press is on the field
  const notice = getAskCutText(cut);
  page.setInput(text + before, notice && lgText(...notice));
}
