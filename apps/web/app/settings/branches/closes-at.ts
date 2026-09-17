/**
 * The closing time to save from the branch form's "Closes at" box.
 *
 * While any part of a time box is still blank (the hour, the minutes or
 * AM/PM), the browser reports its value as "", the same as an empty box. Saving
 * that as "no closing time" used to remove a branch's closing time with a
 * "Branch updated" toast, and the end-of-day report quietly stopped. The box
 * does flag itself as badInput in that state, so that is checked first.
 *
 * Kept free of React so it can be tested on its own.
 */
export function closesAtToSave(
  box: { validity: { badInput: boolean } } | null | undefined,
  value: string,
): { ok: true; closesAt: string | null } | { ok: false; message: string } {
  if (box?.validity.badInput) return { ok: false, message: 'Finish the closing time or clear it' };
  // The time box gives "HH:mm"; slice guards a browser that adds seconds, which
  // the API refuses. Empty means not set: null.
  return { ok: true, closesAt: value.slice(0, 5) || null };
}
