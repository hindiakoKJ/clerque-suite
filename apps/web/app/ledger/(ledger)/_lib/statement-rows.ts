/**
 * Row helpers for the Income Statement and the Balance Sheet. Pure, so they can
 * be tested without a browser.
 *
 * Two problems lived here:
 *
 *  1. Every tenant is seeded with the full chart of accounts, about 190 lines,
 *     including court-rental income for a sports facility. Both statements
 *     printed all of them at ₱0.00, so a coffee shop's Income Statement was
 *     ninety empty lines around nine real ones. Rows with no balance are now
 *     hidden unless the reader asks for them. Totals are untouched: a zero row
 *     adds nothing.
 *
 *  2. The Balance Sheet grouped accounts by code bands (1000-1099 cash,
 *     1100-1299 receivables ...) that do not match the seeded chart, where ALL
 *     assets sit in 1010-1099 and ALL liabilities in 2010-2096. Everything
 *     landed in the first group, so inventory was totalled as "Cash & Cash
 *     Equivalents" and every liability as "Trade Payables". The bands below
 *     follow apps/api/src/accounting/accounts.service.ts (the same cash band
 *     the API's cash-flow statement uses: 1000-1029).
 */

export interface StatementRow {
  id:      string;
  code:    string;
  name:    string;
  balance: number;
}

/** Less than half a centavo either way is nothing. */
export function hasBalance(row: { balance: number }): boolean {
  return Math.abs(Number(row.balance) || 0) >= 0.005;
}

/** The rows to print: all of them when asked, otherwise only the ones with a balance. */
export function visibleRows<T extends { balance: number }>(rows: T[], showEmpty: boolean): T[] {
  return showEmpty ? rows : rows.filter(hasBalance);
}

/** How many rows `visibleRows` is hiding, for the "Show empty accounts (87)" label. */
export function emptyCount(...lists: Array<Array<{ balance: number }>>): number {
  return lists.reduce((n, rows) => n + rows.filter((r) => !hasBalance(r)).length, 0);
}

export interface Bucket {
  label:  string;
  /** Inclusive code ranges. The first range is the seeded chart; any others keep
   *  a shop that built its own chart on the older, wider numbering in the right group. */
  ranges: Array<[number, number]>;
}

export const ASSET_BUCKETS: Bucket[] = [
  { label: 'Cash & Cash Equivalents',        ranges: [[1000, 1029]] },
  { label: 'Receivables',                    ranges: [[1030, 1039], [1100, 1299]] },
  { label: 'Tax Assets',                     ranges: [[1040, 1049]] },
  { label: 'Inventory',                      ranges: [[1050, 1059], [1300, 1499]] },
  { label: 'Prepayments & Other Current',    ranges: [[1060, 1069], [1500, 1799]] },
  { label: 'Property & Equipment',           ranges: [[1070, 1089], [1800, 1899]] },
  { label: 'Intangible & Other Non-Current', ranges: [[1090, 1099], [1900, 1999]] },
];

export const LIABILITY_BUCKETS: Bucket[] = [
  { label: 'Trade Payables',                  ranges: [[2000, 2019]] },
  { label: 'Tax & Government Payables',       ranges: [[2020, 2069], [2100, 2299]] },
  { label: 'Loans, Deposits & Other Current', ranges: [[2070, 2079]] },
  { label: 'Accrued Liabilities',             ranges: [[2080, 2089], [2300, 2499]] },
  { label: 'Long-term Liabilities',           ranges: [[2090, 2099], [2500, 2999]] },
];

/**
 * Is this account code real cash or a bank account (1000-1029)? Bank
 * Reconciliation used `code.startsWith('10')`, which is every asset in the
 * seeded chart: the picker offered Accounts Receivable, Inventory and
 * Accumulated Depreciation as "bank accounts".
 */
export function isCashOrBankCode(code: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  const n = parseInt(code, 10);
  return n >= 1000 && n <= 1029;
}

export interface RowGroup<T> { label: string; rows: T[]; total: number }

/**
 * Put rows into their groups. A group with no rows is left out; a row whose
 * code fits no group comes back in `overflow` so nothing silently disappears.
 */
export function segmentRows<T extends { code: string; balance: number }>(
  rows: T[],
  buckets: Bucket[],
): { groups: RowGroup<T>[]; overflow: T[] } {
  const out: RowGroup<T>[] = buckets.map((b) => ({ label: b.label, rows: [], total: 0 }));
  const overflow: T[] = [];
  for (const r of rows) {
    const code = parseInt(r.code, 10);
    const idx = buckets.findIndex((b) => b.ranges.some(([from, to]) => code >= from && code <= to));
    if (idx >= 0) { out[idx].rows.push(r); out[idx].total += r.balance; }
    else overflow.push(r);
  }
  return { groups: out.filter((g) => g.rows.length > 0), overflow };
}

/**
 * The Balance Sheet groups to print, from the groups the API sends.
 *
 * The API's group totals are direction-uniform: a contra account (Accumulated
 * Depreciation, Allowance for Doubtful Accounts) REDUCES its group. Adding up
 * the rows here instead would add those accounts' own-direction balances, so
 * Property & Equipment came out too high once depreciation was booked. The
 * totals are kept as sent; only the rows shown follow the "hide empty" rule,
 * and a group with nothing left to show is left out.
 */
export function shownGroups<T extends { balance: number }>(
  groups: Array<RowGroup<T>>,
  showEmpty: boolean,
): RowGroup<T>[] {
  return groups
    .map((g) => ({ label: g.label, rows: visibleRows(g.rows, showEmpty), total: g.total }))
    .filter((g) => g.rows.length > 0);
}
