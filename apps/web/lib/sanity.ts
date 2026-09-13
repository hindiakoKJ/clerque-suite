/**
 * Helpers for the "are you sure this is the correct cost?" question.
 *
 * The question itself is asked by the API client (lib/api.ts) through
 * SanityConfirmModal. What a page needs to know is only this: when the person
 * chose to go back and fix a number, the save was deliberately abandoned, and
 * an error toast on top of that would be noise.
 */
export function isSanityCancel(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { sanityCancelled?: boolean }).sanityCancelled === true;
}

/**
 * Enter in a price or cost box means "done with this box", never "save".
 *
 * It moves to the next box marked `data-entry` inside the nearest
 * `data-entry-group`, which is where an inline hint about the number appears.
 * On the last box it only leaves the field: focusing the Save button would
 * turn a second Enter into exactly the save this exists to prevent.
 */
export function enterMovesNext(e: { key: string; preventDefault: () => void; currentTarget: HTMLElement }) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const here = e.currentTarget;
  const group = here.closest('[data-entry-group]') ?? here.ownerDocument;
  const boxes = Array.from(group.querySelectorAll<HTMLElement>('[data-entry]'))
    .filter((el) => !(el as HTMLInputElement).disabled && el.offsetParent !== null);
  const next = boxes[boxes.indexOf(here) + 1];
  if (next) next.focus();
  else here.blur();
}
