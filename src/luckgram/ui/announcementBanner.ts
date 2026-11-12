/*
 * Luckgram Web (luckgram-specs#139, W3 需求 8): the announcement, a banner over the chat list as
 * on the phones — title, a line or two of text, a cross that closes it for good; a click opens its
 * link in a new tab.
 */

import {createEffect, createRoot} from 'solid-js';
import {closeAnnouncement, currentAnnouncement} from '@/luckgram/core/announcements';
import {lgText} from '@/luckgram/text';

const BANNER_ID = 'luckgram-announcement';

function findHost(): HTMLElement | undefined {
  return document.getElementById('chatlist-container') || undefined;
}

function render(announcement: NonNullable<ReturnType<typeof currentAnnouncement>>) {
  const banner = document.createElement(announcement.url ? 'a' : 'div');
  banner.id = BANNER_ID;
  banner.className = 'luckgram-announcement';
  banner.dataset.id = announcement.id;
  if(announcement.url) {
    (banner as HTMLAnchorElement).href = announcement.url;
    (banner as HTMLAnchorElement).target = '_blank';
    (banner as HTMLAnchorElement).rel = 'noopener noreferrer';
  }

  const text = document.createElement('div');
  text.className = 'luckgram-announcement-text';
  text.dir = 'auto';

  const title = document.createElement('div');
  title.className = 'luckgram-announcement-title';
  title.textContent = announcement.title;
  text.append(title);

  if(announcement.body) {
    const body = document.createElement('div');
    body.className = 'luckgram-announcement-body';
    body.textContent = announcement.body;
    text.append(body);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'luckgram-announcement-close';
  close.setAttribute('aria-label', lgText('关闭', 'Close'));
  close.textContent = '×';
  close.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeAnnouncement(announcement.id);
  });

  banner.append(text, close);
  return banner;
}

export function mountAnnouncementBanner() {
  createRoot(() => {
    createEffect(() => {
      const announcement = currentAnnouncement();
      const existing = document.getElementById(BANNER_ID);
      if(existing?.dataset.id === announcement?.id) return;
      existing?.remove();
      if(!announcement) return;

      const host = findHost();
      host?.prepend(render(announcement));
    });
  });
}
