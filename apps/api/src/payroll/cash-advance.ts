/**
 * Cash advance (CA) rules that do not touch the database, so they can be
 * tested on their own.
 *
 * A small shop lends a staff member part of their pay ahead of payday. Each
 * pay run then takes some of it back off the payslip until it is paid off.
 */

export interface OpenAdvance {
  id:        string;
  balance:   number;
  perPayday: number;
  givenAt:   Date;
}

export interface AdvanceTake {
  id:     string;
  amount: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * What this payslip takes back, advance by advance.
 *
 * - Oldest advance first.
 * - Each advance gives up at most its `perPayday`, and never more than its
 *   balance.
 * - All of it together never takes more than `netAvailable` (the pay left
 *   after SSS, PhilHealth, Pag-IBIG and tax), so nobody is handed a payslip
 *   that says they owe money. What is not taken stays on the balance for the
 *   next payday.
 */
export function planAdvanceDeductions(advances: OpenAdvance[], netAvailable: number): AdvanceTake[] {
  let room = round2(Math.max(0, netAvailable));
  const out: AdvanceTake[] = [];
  const oldestFirst = [...advances].sort((a, b) => a.givenAt.getTime() - b.givenAt.getTime());
  for (const a of oldestFirst) {
    if (room <= 0) break;
    const take = round2(Math.min(a.perPayday, a.balance, room));
    if (take <= 0) continue;
    out.push({ id: a.id, amount: take });
    room = round2(room - take);
  }
  return out;
}

/** GL accounts a cash advance may be paid out of. */
export const CA_PAID_FROM = {
  '1010': 'Cash on hand',
  '1011': 'Petty cash',
  '1020': 'Bank (current account)',
  '1022': 'Bank (payroll account)',
} as const;
export type CaPaidFrom = keyof typeof CA_PAID_FROM;

/** The account the advance sits on until payslips pay it back. */
export const CA_ACCOUNT = '1034'; // Advances to Employees

export const CA_MAX_AMOUNT = 500_000;

/** Checks shared by a staff request and an advance given directly. */
export function validateAdvanceTerms(amount: number, perPayday: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return 'Enter how much the advance is.';
  if (amount > CA_MAX_AMOUNT) return `An advance can't be more than ₱${CA_MAX_AMOUNT.toLocaleString('en-PH')}.`;
  if (round2(amount) !== amount) return 'Use at most 2 decimal places.';
  if (!Number.isFinite(perPayday) || perPayday <= 0) return 'Enter how much to take back each payday.';
  if (round2(perPayday) !== perPayday) return 'Use at most 2 decimal places.';
  if (perPayday > amount) return "Each payday can't take back more than the advance itself.";
  return null;
}
