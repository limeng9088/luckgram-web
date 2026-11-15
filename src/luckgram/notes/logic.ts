/*
 * Luckgram Web (luckgram-specs#192, W10 需求 1–5; specs/05-user-notes.md): the rules of private
 * notes — their text, their keys, the list's search, the file they are carried in. No imports.
 */

export const USER_NOTES = 'user_notes';
export const MAX_LENGTH = 2000;

export type NotePeerKind = 'user' | 'chat' | 'channel';
/** Who a note is about, in a form that means the same on every platform: the bare id and what it is of. */
export type NotePeer = {type: NotePeerKind, id: number};

export type Note = {
  /** the account that wrote it */
  account: string,
  peer: NotePeer,
  text: string,
  /** seconds */
  updatedAt: number,
  /** the bar in the chat shows the whole text */
  expanded?: boolean
};

// ------------------------------------------------------------------ the text

const segmenter = typeof Intl !== 'undefined' && (Intl as any).Segmenter ? new (Intl as any).Segmenter(undefined, {granularity: 'grapheme'}) : undefined;

/** The text's characters as a reader counts them: an emoji, a flag, a letter with its marks are one each. */
export function splitCharacters(text: string): string[] {
  if(!segmenter) return Array.from(text);
  const out: string[] = [];
  for(const part of segmenter.segment(text)) out.push(part.segment);
  return out;
}

export const countCharacters = (text: string | undefined) => text ? splitCharacters(text).length : 0;

/** The text as kept: trimmed, its line ends plain, cut to the limit. Empty means "no note". */
export function normalizeNote(text: string | undefined, max = MAX_LENGTH): string {
  let value = (text || '').replace(/\r\n?/g, '\n').trim();
  const characters = splitCharacters(value);
  if(characters.length > max) value = characters.slice(0, max).join('').trim();
  return value;
}

/** How many more characters fit (negative when over): the editor's counter. */
export const remainingCharacters = (text: string | undefined, max = MAX_LENGTH) => max - countCharacters(text);

/** What the bar and the list show: the first line that has anything in it. */
export function firstLine(text: string | undefined): string {
  return (text || '').split('\n').map((line) => line.trim()).find(Boolean) || '';
}

// ------------------------------------------------------------------ keys

/** `n:<account>:<type>:<id>` */
export const noteKey = (account: number | string, peer: NotePeer) => `n:${account}:${peer.type}:${peer.id}`;
export const accountOfNoteKey = (key: string) => key.split(':')[1];
export const samePeer = (a: NotePeer, b: NotePeer) => a.type === b.type && a.id === b.id;

export function isValidPeer(peer: any): peer is NotePeer {
  return !!peer && (peer.type === 'user' || peer.type === 'chat' || peer.type === 'channel') && Number.isSafeInteger(peer.id) && peer.id > 0;
}

// ------------------------------------------------------------------ the list

/** The newest first. */
export const sortNotes = (notes: Note[]) => notes.slice().sort((a, b) => b.updatedAt - a.updatedAt || a.peer.id - b.peer.id);

/** The notes whose text, or whose peer's name, has every word of the query (letter case aside). */
export function searchNotes(notes: Note[], query: string, getName: (note: Note) => string | undefined): Note[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if(!words.length) return notes;
  return notes.filter((note) => {
    const haystack = (note.text + '\n' + (getName(note) || '') + '\n' + note.peer.id).toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

// ------------------------------------------------------------------ the file

export const FILE_FORMAT = 'luckgram-notes';
export const FILE_VERSION = 1;

export type NotesFile = {
  format: typeof FILE_FORMAT,
  version: number,
  /** the account the notes were written in */
  account: number,
  /** seconds */
  exported_at: number,
  notes: {peer: NotePeer, text: string, updated_at: number}[]
};

export function buildNotesFile(account: number | string, notes: Note[], now: number): NotesFile {
  return {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    account: +account,
    exported_at: Math.floor(now / 1000),
    notes: sortNotes(notes).map((note) => ({peer: {type: note.peer.type, id: note.peer.id}, text: note.text, updated_at: note.updatedAt}))
  };
}

export type ParsedNotesFile =
  {ok: true, account: number, notes: {peer: NotePeer, text: string, updatedAt: number}[], skipped: number} |
  {ok: false, reason: 'not_json' | 'not_notes' | 'newer_version'};

/** Reads a file: what is not a notes file, or is of a version this build does not know, is refused whole. */
export function parseNotesFile(text: string): ParsedNotesFile {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch(err) {
    return {ok: false, reason: 'not_json'};
  }

  if(!data || data.format !== FILE_FORMAT || !Array.isArray(data.notes) || !Number.isInteger(data.version) || data.version < 1) {
    return {ok: false, reason: 'not_notes'};
  }

  if(data.version > FILE_VERSION) return {ok: false, reason: 'newer_version'};

  const notes: {peer: NotePeer, text: string, updatedAt: number}[] = [];
  let skipped = 0;
  for(const item of data.notes) {
    const text = typeof item?.text === 'string' ? normalizeNote(item.text) : '';
    if(!isValidPeer(item?.peer) || !text) {
      ++skipped;
      continue;
    }

    const duplicate = notes.findIndex((note) => samePeer(note.peer, item.peer));
    const updatedAt = Number.isFinite(item.updated_at) && item.updated_at > 0 ? Math.floor(item.updated_at) : 0;
    const note = {peer: {type: item.peer.type, id: item.peer.id}, text, updatedAt};
    if(duplicate === -1) notes.push(note);
    else {
      ++skipped;
      if(updatedAt > notes[duplicate].updatedAt) notes[duplicate] = note;
    }
  }

  return {ok: true, account: Number.isSafeInteger(data.account) ? data.account : 0, notes, skipped};
}

export type ImportPlan = {
  /** to be written */
  set: {peer: NotePeer, text: string, updatedAt: number}[],
  added: number,
  updated: number,
  /** the note here is as new or newer, or the same */
  kept: number
};

/** What an import changes: a note here stays unless the file's is newer and differs. */
export function planImport(existing: Note[], incoming: {peer: NotePeer, text: string, updatedAt: number}[]): ImportPlan {
  const plan: ImportPlan = {set: [], added: 0, updated: 0, kept: 0};
  for(const note of incoming) {
    const mine = existing.find((own) => samePeer(own.peer, note.peer));
    if(!mine) {
      plan.set.push(note);
      ++plan.added;
    } else if(note.updatedAt > mine.updatedAt && note.text !== mine.text) {
      plan.set.push(note);
      ++plan.updated;
    } else {
      ++plan.kept;
    }
  }

  return plan;
}
