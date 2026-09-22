/**
 * Balance Sheet groups — which sub-heading an asset or liability account sits
 * under (Cash & Cash Equivalents, Receivables, Inventory, Property & Equipment
 * …), with a subtotal per group.
 *
 * The bands follow the SEEDED chart first (all assets 1010–1099, all
 * liabilities 2010–2096 — see DEFAULT_ACCOUNTS in accounts.service.ts), then
 * the older, wider numbering for a shop that built its own chart. They are the
 * same bands the web app's statement-rows.ts uses, so the screen and the
 * .xlsx agree.
 *
 * Why this lives on the API: the page used to group by bands that did not
 * match the seeded chart (1000–1099 = cash, 1100–1299 = receivables …), so
 * every asset landed under "Cash & Cash Equivalents" and every liability under
 * "Trade Payables" — inventory was totalled as cash. Each row now carries its
 * `group`, and the export prints the same sub-headings.
 */

export interface StatementBucket {
  label:  string;
  /** Inclusive code ranges; the first is the seeded chart. */
  ranges: Array<[number, number]>;
}

export const ASSET_GROUPS: StatementBucket[] = [
  { label: 'Cash & Cash Equivalents',        ranges: [[1000, 1029]] },
  { label: 'Receivables',                    ranges: [[1030, 1039], [1100, 1299]] },
  { label: 'Tax Assets',                     ranges: [[1040, 1049]] },
  { label: 'Inventory',                      ranges: [[1050, 1059], [1300, 1499]] },
  { label: 'Prepayments & Other Current',    ranges: [[1060, 1069], [1500, 1799]] },
  { label: 'Property & Equipment',           ranges: [[1070, 1089], [1800, 1899]] },
  { label: 'Intangible & Other Non-Current', ranges: [[1090, 1099], [1900, 1999]] },
];

export const LIABILITY_GROUPS: StatementBucket[] = [
  { label: 'Trade Payables',                  ranges: [[2000, 2019]] },
  { label: 'Tax & Government Payables',       ranges: [[2020, 2069], [2100, 2299]] },
  { label: 'Loans, Deposits & Other Current', ranges: [[2070, 2079]] },
  { label: 'Accrued Liabilities',             ranges: [[2080, 2089], [2300, 2499]] },
  { label: 'Long-term Liabilities',           ranges: [[2090, 2099], [2500, 2999]] },
];

const OTHER_ASSETS      = 'Other Assets';
const OTHER_LIABILITIES = 'Other Liabilities';

/** The sub-heading for one account. Equity has no sub-headings. */
export function balanceSheetGroup(type: string, code: string): string {
  const buckets =
    type === 'ASSET'     ? ASSET_GROUPS :
    type === 'LIABILITY' ? LIABILITY_GROUPS : null;
  if (!buckets) return type === 'EQUITY' ? 'Equity' : 'Other';

  const n = parseInt(String(code ?? '').trim(), 10);
  const hit = Number.isFinite(n)
    ? buckets.find((b) => b.ranges.some(([from, to]) => n >= from && n <= to))
    : undefined;
  if (hit) return hit.label;
  // A code that fits no band is still shown — under "Other", never dropped.
  return type === 'ASSET' ? OTHER_ASSETS : OTHER_LIABILITIES;
}

export interface StatementGroup<T> { label: string; rows: T[]; total: number }

/**
 * Put rows into their groups, in bucket order, then any "Other" group last.
 * Groups with no rows are left out.
 *
 * `amountOf` must give the DIRECTION-UNIFORM amount (debit − credit for an
 * asset, credit − debit for a liability), not the row's own-direction
 * balance, so a contra account (Accumulated Depreciation, Allowance for
 * Doubtful Accounts) REDUCES its group the way it reduces the section total.
 */
export function groupStatementRows<T extends { group: string }>(
  rows: T[],
  buckets: StatementBucket[],
  amountOf: (row: T) => number,
): StatementGroup<T>[] {
  const byLabel = new Map<string, StatementGroup<T>>();
  for (const row of rows) {
    let g = byLabel.get(row.group);
    if (!g) {
      g = { label: row.group, rows: [], total: 0 };
      byLabel.set(row.group, g);
    }
    g.rows.push(row);
    g.total += amountOf(row);
  }
  const order = buckets.map((b) => b.label);
  const extra = [...byLabel.keys()].filter((l) => !order.includes(l));
  return [...order, ...extra]
    .filter((l) => byLabel.has(l))
    .map((l) => byLabel.get(l)!);
}
