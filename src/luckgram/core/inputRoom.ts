/*
 * Luckgram Web: room for what Luckgram puts over the message field — the AI panel ("帮我回复"),
 * the bars that give a text back ("已润色 · 撤销", "已翻译成 … · 撤销").
 *
 * The field's box grows upwards with them, over the messages. Upstream tells the chat how much
 * taller than its base the field is (a reply's bar, a long text), and the messages leave that
 * much room under themselves, the last one still in view; what Luckgram adds is counted in the
 * same sum (input.ts: luckgramSetExtraHeight).
 */

type FieldLike = {luckgramSetExtraHeight?: (px: number) => void, luckgramOverField?: Set<HTMLElement>};

function sync(input: FieldLike) {
  let height = 0;
  input.luckgramOverField?.forEach((element) => {
    if(element.isConnected) height += element.offsetHeight;
  });

  try {
    input.luckgramSetExtraHeight?.(height);
  } catch(err) {
    console.warn('[luckgram] field: room', (err as Error)?.message);
  }
}

/**
 * Counts `element` (already put over the field) into the room the messages leave, as tall as it
 * is and becomes. Returns what to call when it is taken away.
 */
export function trackOverField(input: FieldLike, element: HTMLElement): () => void {
  const elements = input.luckgramOverField ??= new Set();
  elements.add(element);

  let observer: ResizeObserver;
  if(typeof(ResizeObserver) !== 'undefined') {
    observer = new ResizeObserver(() => sync(input));
    observer.observe(element);
  }

  sync(input);
  let released = false;
  return () => {
    if(released) return;
    released = true;
    observer?.disconnect();
    elements.delete(element);
    sync(input);
  };
}
