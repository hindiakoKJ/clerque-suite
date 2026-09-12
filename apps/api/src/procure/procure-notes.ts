/**
 * The tags Procure keeps in PurchaseRequest.notes, and how to read them.
 *
 * Notes is the one free column a request has, and more than one thing now
 * rides in it: the receipt replay key, "ordered, on the way", which request
 * a balance belongs to, what pocket paid ahead and how much. One grammar,
 * in one place, so every screen reads them apart the same way.
 *
 *   [RCPT:<key>]        the receipt path's idempotency key
 *   [ONTHEWAY:<date>]   ordered or paid for, not here yet
 *   [BALANCEOF:<REQ>]   this request holds what was short on another one
 *   [PREPAID:<pocket>]  paid before it arrived; the pocket that paid
 *   [ADV:<amount>]      how much of that advance is still waiting in 1063
 *   [FEES:<key>]        the receipt whose delivery fees have already posted
 *
 * Tags go in front, newest last, then the human text.
 *
 * A tag is only a tag when Procure itself wrote it. Two rules keep it that
 * way, because these tags decide which account the money comes out of:
 *
 *   - Only the run of tags at the FRONT is read. A bracket further along is
 *     somebody's sentence, not an instruction.
 *   - Brackets typed by a person are dropped on the way in, so a note
 *     reading "[PREPAID:CASH]" is stored, and shown, as "PREPAID:CASH".
 */
const TAG = /\[([A-Z]+):([^\]]*)\]/g;
/** The run of tags at the front -- the only part of notes Procure wrote. */
const HEAD = /^(?:\s*\[[A-Z]+:[^\]]*\])+/;
const MAX = 2000;

/** Tags in front, then everything a person would read. */
function split(notes: string | null | undefined): { tags: string[]; plain: string } {
  const all  = notes ?? '';
  const head = HEAD.exec(all)?.[0] ?? '';
  return {
    tags:  [...head.matchAll(TAG)].map((m) => m[0]),
    plain: all.slice(head.length).replace(/\s{2,}/g, ' ').trim(),
  };
}

/** A person's words, with nothing in them that could be read as a tag. */
function human(text: string): string {
  return text.replace(/[[\]]/g, '').replace(/\s{2,}/g, ' ').trim();
}

/** Everything that is not a tag: what a person would read. */
export function plainNotes(notes: string | null | undefined): string {
  return split(notes).plain;
}

export function readTag(notes: string | null | undefined, name: string): string | null {
  for (const t of split(notes).tags) {
    const m = /^\[([A-Z]+):([^\]]*)\]$/.exec(t);
    if (m && m[1] === name) return m[2];
  }
  return null;
}

export function hasTag(notes: string | null | undefined, name: string): boolean {
  return readTag(notes, name) != null;
}

/** Set a tag (replacing one of the same name), keeping the others in order. */
export function withTag(notes: string | null | undefined, name: string, value: string): string {
  const { tags, plain } = split(notes);
  const kept = tags.filter((t) => !t.startsWith(`[${name}:`));
  const head = [...kept, `[${name}:${value.replace(/[[\]]/g, '')}]`].join(' ');
  return [head, human(plain)].filter(Boolean).join(' ').slice(0, MAX);
}

/** Drop a tag, keeping the rest. */
export function withoutTag(notes: string | null | undefined, name: string): string | null {
  const { tags, plain } = split(notes);
  const kept = tags.filter((t) => !t.startsWith(`[${name}:`));
  return [kept.join(' '), plain].filter(Boolean).join(' ') || null;
}

/** Add a human line after whatever is there, tags untouched. */
export function appendNote(notes: string | null | undefined, line: string): string {
  const text = human(line);
  if (!text) return notes ?? '';
  const { tags, plain } = split(notes);
  const body = [human(plain), text].filter(Boolean).join(' · ');
  return [tags.join(' '), body].filter(Boolean).join(' ').slice(0, MAX);
}
