import { readTag, withTag } from './procure-notes';

/**
 * Who asked for which line, for lines staff asked for in Telegram (KJ,
 * 2026-11-19: the end-of-day buy list says who asked). Kept in the request's
 * notes as one Procure tag, [ASKEDBY:<itemId>=Ana+Ben;<itemId>=Ben], because a
 * name per line is not worth a database change. Read only from the front run
 * of tags, like every Procure tag, so nothing typed by a person can forge it.
 */

const TAG = 'ASKEDBY';
/** Enough for a shop's whole supplies list; past it the oldest entries give way. */
const MAX_ENTRIES = 40;
const MAX_NAMES = 4;

/** A name as it can sit inside the tag: none of the tag's own separators. */
function clean(name: string): string {
  return name.replace(/[[\]=;+:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
}

export function readAskedBy(notes: string | null | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const raw = readTag(notes, TAG);
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const [id, names] = part.split('=');
    if (!id || !names || !/^[a-z0-9]+$/i.test(id)) continue;
    out.set(id, names.split('+').map((n) => n.trim()).filter(Boolean));
  }
  return out;
}

/** The notes with `who` added as an asker of each of these items. */
export function withAskedBy(notes: string | null | undefined, itemIds: string[], who: string): string | null {
  const name = clean(who);
  if (!name || itemIds.length === 0) return notes ?? null;
  const map = readAskedBy(notes);
  for (const id of itemIds) {
    const names = map.get(id) ?? [];
    if (!names.includes(name)) names.push(name);
    map.delete(id);
    map.set(id, names.slice(-MAX_NAMES));
  }
  const entries = [...map.entries()].slice(-MAX_ENTRIES);
  return withTag(notes, TAG, entries.map(([id, names]) => `${id}=${names.join('+')}`).join(';'));
}

/** "Ana", "Ana and Ben", "Ana, Ben and Cy". */
export function askersInWords(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
