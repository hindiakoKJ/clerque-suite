/**
 * Cash Flow Statement — which section an account's movement belongs in.
 *
 * The old rule sent 1030–1799 to Operating, so buying an espresso machine
 * (1075 Machinery & Equipment) showed as a working-capital change instead of
 * an investment; and every liability under 2500 to Operating, so a bank loan
 * (2071 / 2090) looked like money the shop earned from trading.
 */
import { cashFlowSection } from './accounts.service';

describe('cashFlowSection', () => {
  it.each([
    // Real cash and bank: opening / ending balance, not a section.
    [1010, 'CASH'], [1011, 'CASH'], [1020, 'CASH'], [1025, 'CASH'],
    // Working capital (seeded chart).
    [1030, 'OPERATING'], [1031, 'OPERATING'], [1040, 'OPERATING'], [1051, 'OPERATING'], [1063, 'OPERATING'],
    // Equipment and other long-term assets are INVESTING.
    [1070, 'INVESTING'], [1075, 'INVESTING'], [1076, 'INVESTING'], [1077, 'INVESTING'], [1081, 'INVESTING'],
    [1090, 'INVESTING'], [1097, 'INVESTING'], [1099, 'INVESTING'],
    // Payables, taxes, accruals, customer deposits: operating.
    [2010, 'OPERATING'], [2020, 'OPERATING'], [2030, 'OPERATING'], [2065, 'OPERATING'],
    [2074, 'OPERATING'], [2075, 'OPERATING'], [2080, 'OPERATING'], [2081, 'OPERATING'],
    // Loans, lease liabilities, dividends: financing.
    [2070, 'FINANCING'], [2071, 'FINANCING'], [2072, 'FINANCING'], [2073, 'FINANCING'], [2076, 'FINANCING'],
    [2090, 'FINANCING'], [2091, 'FINANCING'], [2093, 'FINANCING'],
    // Owner's money in and out.
    [3010, 'FINANCING'], [3020, 'FINANCING'],
    // P&L and retained earnings arrive through Net Income.
    [3900, 'SKIP'], [4010, 'SKIP'], [5010, 'SKIP'], [6010, 'SKIP'],
    // Older, wider numbering for a shop that built its own chart.
    [1200, 'OPERATING'], [1850, 'INVESTING'], [2600, 'FINANCING'],
  ] as Array<[number, string]>)('%s → %s', (code, section) => {
    expect(cashFlowSection(code)).toBe(section);
  });

  it('skips a code it cannot read rather than guessing', () => {
    expect(cashFlowSection(Number.NaN)).toBe('SKIP');
  });
});
