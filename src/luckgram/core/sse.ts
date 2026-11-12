/*
 * Luckgram Web (luckgram-specs#139, W3 需求 9): the events of a streamed answer of
 * `POST /v1/ai/chat` —
 *
 *   data: {"delta":"Hello"}
 *   data: {"delta":" there"}
 *   data: {"done":true,"finish_reason":"stop",…}        or        data: {"error":{"code":"…"}}
 *
 * — out of text that arrives in pieces cut anywhere. Pure logic, no imports.
 */

export type ChatStreamEvent = {delta?: string, done?: boolean, error?: {code?: string, message?: string, retry_after_seconds?: number}};

export function createSseParser(onEvent: (event: ChatStreamEvent) => void) {
  let buffer = '';

  const handleBlock = (block: string) => {
    const data: string[] = [];
    for(const line of block.split('\n')) {
      if(line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }

    if(!data.length) return;
    const text = data.join('\n');
    if(text === '[DONE]') {
      onEvent({done: true});
      return;
    }

    try {
      const event = JSON.parse(text);
      if(event && typeof(event) === 'object') onEvent(event);
    } catch(err) {}
  };

  return {
    /** A piece of the response's text, as it arrived. */
    push(chunk: string) {
      buffer += chunk.replace(/\r\n?/g, '\n');
      let end: number;
      while((end = buffer.indexOf('\n\n')) !== -1) {
        handleBlock(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
    },
    /** The response ended: an event without its closing blank line still counts. */
    end() {
      if(buffer.trim()) handleBlock(buffer);
      buffer = '';
    }
  };
}
