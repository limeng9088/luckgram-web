/*
 * Luckgram Web (luckgram-specs#186, W6): the message as the server has it, for what was asked of
 * a bubble drawn while its message was being sent (transcribe.ts says why). Nothing of the app is
 * imported here: where the bubble is now, the stored message and the "sent" event are given.
 */

type SentLike = {mid?: number, peerId?: any, pFlags?: any};

export async function waitForSentMessage<T extends SentLike>(options: {
  message: T,
  isTempId: (mid: number) => boolean,
  /** the id the message's bubble has now: the new one once the message is sent */
  getBubbleMid: () => number | undefined,
  /** the stored message of this id */
  getMessage: (mid: number) => Promise<T | undefined>,
  /** hears every message that is sent (its temporary id, what it became); returns how to stop */
  subscribe: (listener: (tempId: number, message: T) => void) => () => void,
  timeoutMs: number
}): Promise<T | undefined> {
  const {message} = options;
  const isLocal = (item: SentLike) => !!item?.pFlags?.is_outgoing || options.isTempId(item?.mid);
  if(!isLocal(message)) return message;

  const fromBubble = async() => {
    const mid = options.getBubbleMid();
    if(!mid || mid === message.mid || options.isTempId(mid)) return;
    const sent = await options.getMessage(mid);
    return sent && !isLocal(sent) ? sent : undefined;
  };

  // * listened for before the bubble is looked at: a message sent in between is not missed
  let stop: () => void, timer: ReturnType<typeof setTimeout>;
  const waited = new Promise<T | undefined>((resolve) => {
    stop = options.subscribe((tempId, sent) => {
      if(tempId === message.mid && (sent?.peerId === undefined || sent.peerId === message.peerId)) resolve(sent);
    });
    timer = setTimeout(() => resolve(undefined), options.timeoutMs);
  });

  try {
    return await fromBubble() || await waited || await fromBubble();
  } finally {
    clearTimeout(timer);
    stop();
  }
}
