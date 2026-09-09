/**
 * The tags Procure keeps in PurchaseRequest.notes, and how to read them.
 *
 * Notes is the one free column a request has, and more than one thing now
 * rides in it: the receipt replay key, "ordered, on the way", which request
 * a balance belongs to, and the person's own line. One grammar, in one
 * place, so every screen reads them apart the same way.
 *
 *   [RCPT:<key>]        the receipt path's idempotency key (must stay FIRST:
 *                       the replay lookup is a startsWith on it)
 *   [ONTHEWAY:<date>]   ordered or paid for, not here yet
 *   [BALANCEOF:<REQ>]   this request holds what was short on another one
 *
 * Tags go in front, newest last, then the human text.
 */
const TAG = /\[([A-Z]+):([^\]]*)\]/g;
const MAX = 2000;

function tagsOf(notes: string | null | undefined): string[] {
  return [...(notes ?? '').matchAll(TAG)].map((m) => m[0]);
}

/** Everything that is not a tag: what a person would read. */
export function plainNotes(notes: string | null | undefined): string {
  return (notes ?? '').replace(TAG, '').replace(/\s{2,}/g, ' ').trim();
}

export function readTag(notes: string | null | undefined, name: string): string | null {
  for (const m of (notes ?? '').matchAll(TAG)) if (m[1] === name) return m[2];
  return null;
}

export function hasTag(notes: string | null | undefined, name: string): boolean {
  return readTag(notes, name) != null;
}

/** Set a tag (replacing one of the same name), keeping the others in order. */
export function withTag(notes: string | null | undefined, name: string, value: string): string {
  const kept = tagsOf(notes).filter((t) => !t.startsWith(`[${name}:`));
  const tags = [...kept, `[${name}:${value.replace(/[\][]/g, '')}]`].join(' ');
  const plain = plainNotes(notes);
  return [tags, plain].filter(Boolean).join(' ').slice(0, MAX);
}

/** Add a human line after whatever is there, tags untouched. */
export function appendNote(notes: string | null | undefined, line: string): string {
  const text = line.trim().replace(/\s{2,}/g, ' ');
  if (!text) return notes ?? '';
  const tags = tagsOf(notes).join(' ');
  const plain = plainNotes(notes);
  const body = [plain, text].filter(Boolean).join(' · ');
  return [tags, body].filter(Boolean).join(' ').slice(0, MAX);
}
