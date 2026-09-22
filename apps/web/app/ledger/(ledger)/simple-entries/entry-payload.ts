/**
 * What Record Entry sends to POST /simple-entries. Pure, so it can be tested
 * without a browser. Mirrors apps/api/src/simple-entries/dto/simple-entry.dto.ts.
 *
 * Two kinds were added for the cafe: "Bought equipment" and "Paid wages". Both
 * can be paid from the till, from the bank, or by the owner out of her own
 * pocket, so they use `paidFrom` (CASH | BANK | OWNER). The older kinds keep
 * `source` (CASH | BANK): the API refuses OWNER for them.
 */

export type EntryType =
  | 'EXPENSE' | 'OTHER_INCOME' | 'OWNER_CONTRIBUTION'
  | 'OWNER_DRAWING' | 'DEPOSIT_TO_BANK' | 'WITHDRAW_TO_CASH'
  | 'EQUIPMENT_PURCHASE' | 'WAGES_PAID';

export type PaidFrom = 'CASH' | 'BANK' | 'OWNER';

export interface EntryForm {
  type:      EntryType;
  amount:    string;
  date:      string;
  paidFrom:  PaidFrom;
  category:  string;
  note:      string;
  assetName: string;
}

export interface EntryPayload {
  type:       EntryType;
  amount:     number;
  date:       string;
  source?:    'CASH' | 'BANK';
  paidFrom?:  PaidFrom;
  category?:  string;
  assetName?: string;
  note?:      string;
}

/** Cash <-> bank moves: both sides are fixed, there is nothing to choose. */
export function isTransfer(type: EntryType): boolean {
  return type === 'DEPOSIT_TO_BANK' || type === 'WITHDRAW_TO_CASH';
}

/** The kinds the owner may have paid for out of her own pocket. */
export function allowsOwnerPaid(type: EntryType): boolean {
  return type === 'EQUIPMENT_PURCHASE' || type === 'WAGES_PAID';
}

/** The pockets offered for a kind. Empty for a transfer. */
export function paidFromOptions(type: EntryType): PaidFrom[] {
  if (isTransfer(type)) return [];
  return allowsOwnerPaid(type) ? ['CASH', 'BANK', 'OWNER'] : ['CASH', 'BANK'];
}

/** Keep the chosen pocket when the kind changes, unless the new kind cannot use it. */
export function paidFromFor(type: EntryType, current: PaidFrom): PaidFrom {
  return current === 'OWNER' && !allowsOwnerPaid(type) ? 'CASH' : current;
}

/** "Paid from" when money leaves, "Received in" when it arrives. */
export function pocketLabel(type: EntryType): string {
  return type === 'OTHER_INCOME' || type === 'OWNER_CONTRIBUTION' ? 'Received in' : 'Paid from';
}

/** The first thing wrong with the form, in words for the person filling it in; null when it can be saved. */
export function entryProblem(form: EntryForm): string | null {
  const amt = Number(form.amount);
  if (!Number.isFinite(amt) || amt <= 0) return 'Enter an amount greater than zero.';
  // The API refuses a third decimal with a message written for programmers.
  if (Math.abs(amt * 100 - Math.round(amt * 100)) > 1e-6) return 'Use centavos only: at most two decimal places, like 1500.50.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) return 'Choose the date.';
  if (form.type === 'EQUIPMENT_PURCHASE' && !form.assetName.trim()) {
    return 'Say what was bought, for example "Espresso machine".';
  }
  return null;
}

export function buildEntryPayload(form: EntryForm): EntryPayload {
  const payload: EntryPayload = { type: form.type, amount: Number(form.amount), date: form.date };

  if (allowsOwnerPaid(form.type)) {
    payload.paidFrom = form.paidFrom;
  } else if (!isTransfer(form.type)) {
    // OWNER cannot reach here through the form (paidFromFor), but never send it.
    payload.source = form.paidFrom === 'BANK' ? 'BANK' : 'CASH';
  }

  if (form.type === 'EXPENSE') payload.category = form.category;
  if (form.type === 'EQUIPMENT_PURCHASE') payload.assetName = form.assetName.trim().slice(0, 120);

  const note = form.note.trim();
  if (note) payload.note = note;
  return payload;
}

/** "Reverse JE-0464: Rent expense, ₱15,000.00?" -- name the entry, so the wrong row is not reversed. */
export function reverseQuestion(entry: { entryNumber: string; description: string }, amountText: string): string {
  return `Reverse ${entry.entryNumber}: ${entry.description}, ${amountText}?\n\n`
    + 'This records an opposite entry to undo it. The original stays for your records.';
}
