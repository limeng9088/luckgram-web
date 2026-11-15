import {beforeEach, describe, expect, it, vi} from 'vitest';

const handlers: Array<() => boolean> = [];
vi.mock('@components/appNavigationController', () => ({
  default: {
    registerEscapeHandler: (handler: () => boolean) => {
      handlers.push(handler);
    }
  }
}));

import {heldEscapeCount, holdEscape} from '@/luckgram/core/escape';

function press(key = 'Escape') {
  const event = new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true});
  document.body.dispatchEvent(event);
  return event;
}

/** What upstream asks before it closes the chat on Esc. */
const upstreamMayClose = () => handlers.every((handler) => handler());

describe('luckgram Esc for its own layers', () => {
  beforeEach(() => {
    while(heldEscapeCount()) press();
  });

  it('closes only the layer and keeps the key from upstream', () => {
    const close = vi.fn();
    holdEscape(close);
    expect(upstreamMayClose()).toBe(false);

    const later = vi.fn();
    document.addEventListener('keydown', later, true);
    const event = press();
    document.removeEventListener('keydown', later, true);

    expect(close).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(later).not.toHaveBeenCalled();
    expect(upstreamMayClose()).toBe(true);
  });

  it('closes the layer opened last, one per press', () => {
    const first = vi.fn(), second = vi.fn();
    holdEscape(first);
    holdEscape(second);

    press();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(upstreamMayClose()).toBe(false);

    press();
    expect(first).toHaveBeenCalledTimes(1);
    expect(upstreamMayClose()).toBe(true);
  });

  it('a layer closed another way no longer takes Esc', () => {
    const close = vi.fn();
    const release = holdEscape(close);
    release();
    release();

    const event = press();
    expect(close).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(upstreamMayClose()).toBe(true);
  });

  it('leaves other keys alone', () => {
    const close = vi.fn();
    holdEscape(close);
    const event = press('Enter');
    expect(close).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
