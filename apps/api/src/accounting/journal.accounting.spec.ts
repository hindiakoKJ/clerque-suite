/**
 * Sprint 9 — Comprehensive accounting correctness tests across all business
 * types. Each test feeds a synthetic AccountingEvent into JournalService.
 * processEvent and asserts the exact debit/credit lines that get posted.
 *
 * Coverage:
 *   1. SALE handler                — cash + digital + VAT split
 *   2. COGS handler                — recipe / WAC / snapshot / overhead
 *   3. VOID handler FULL_VOID      — café (no COGS reversal) vs retail (full)
 *   4. VOID handler ITEM_REFUND    — partial proportional reversal
 *   5. INVENTORY_ADJUSTMENT        — stock-in (cash/credit/owner) + write-off
 *
 * Test approach:
 *   - PrismaService is mocked with just enough surface to satisfy
 *     processEvent: accountingEvent.findFirst/update, journalEntry.count/create,
 *     $transaction (passes through).
 *   - AccountsService is mocked to return predictable account IDs by code.
 *   - AccountingPeriodsService.assertDateIsOpen always succeeds.
 *   - We capture the `lines` argument passed to journalEntry.create and
 *     assert account codes + debits + credits.
 *
 * The spec verifies:
 *   - Books balance (debits == credits)
 *   - Right accounts are hit (1010 cash, 4010 sales, 2020 VAT, 5010 COGS,
 *     1050 inventory, 2010 AP, 3010 owner equity)
 *   - Café void doesn't reverse COGS (waste retention)
 *   - Retail void DOES reverse COGS (restocked items)
 *   - Item refund is proportional, not full
 */

import { Test, TestingModule } from '@nestjs/testing';
import { JournalService } from './journal.service';
import { AccountsService } from './accounts.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';
import { NumberingService } from '../numbering/numbering.service';

// ─── Account-code ↔ ID map ──────────────────────────────────────────────────

const ACCOUNT_IDS: Record<string, string> = {
  '1010': 'acct-1010-cash',
  '1030': 'acct-1030-ar',
  '1031': 'acct-1031-digital',
  '1034': 'acct-1034-driver-advance',
  '1037': 'acct-1037-retention',
  '1050': 'acct-1050-inventory',
  '2010': 'acct-2010-ap',
  '2020': 'acct-2020-vat',
  '3010': 'acct-3010-equity',
  '4010': 'acct-4010-sales',
  '5010': 'acct-5010-cogs',
  '6100': 'acct-6100-transport',
  '6101': 'acct-6101-fuel',
  '6102': 'acct-6102-vehicle-mtc',
  '6140': 'acct-6140-misc',
};

const ID_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(ACCOUNT_IDS).map(([code, id]) => [id, code]),
);

// ─── Spec helpers ───────────────────────────────────────────────────────────

interface CapturedLine {
  account: string;     // 4-digit code, e.g. '1010'
  debit:   number;
  credit:  number;
}

function summarise(lines: CapturedLine[]): { debits: Map<string, number>; credits: Map<string, number>; debitTotal: number; creditTotal: number } {
  const debits  = new Map<string, number>();
  const credits = new Map<string, number>();
  let debitTotal = 0;
  let creditTotal = 0;
  for (const l of lines) {
    if (l.debit > 0) {
      debits.set(l.account, (debits.get(l.account) ?? 0) + l.debit);
      debitTotal += l.debit;
    }
    if (l.credit > 0) {
      credits.set(l.account, (credits.get(l.account) ?? 0) + l.credit);
      creditTotal += l.credit;
    }
  }
  return { debits, credits, debitTotal: round(debitTotal), creditTotal: round(creditTotal) };
}

function round(n: number) { return Math.round(n * 100) / 100; }

// ─── Test harness ───────────────────────────────────────────────────────────

async function runProcessEvent(
  payload: Record<string, unknown>,
  type:
    | 'SALE' | 'COGS' | 'VOID' | 'INVENTORY_ADJUSTMENT'
    | 'TRIP_CASH_ADVANCE' | 'TRIP_LIQUIDATION'
    | 'PROGRESS_BILLING' | 'RETENTION_RELEASE',
  origSale?: { payload: Record<string, unknown>; lines: Array<{ accountId: string; debit: unknown; credit: unknown; description: string }> },
  tenantTaxStatus: 'VAT' | 'NON_VAT' | 'EXEMPT' | 'PERCENTAGE_TAX' = 'VAT',
): Promise<CapturedLine[] | { skipped: true }> {
  let captured: CapturedLine[] | { skipped: true } = { skipped: true };

  const accountingEventFindFirst = jest.fn().mockImplementation(({ where }) => {
    // The handler may call findFirst either to fetch the event being processed
    // (by id) or to look up the original SALE event for VOID reversal.
    if (where.id) {
      return Promise.resolve({
        id:        'evt-1',
        tenantId:  'tenant-1',
        type,
        status:    'PENDING',
        payload,
        orderId:   payload.orderId ?? 'order-1',
        createdAt: new Date(),
      });
    }
    if (where.type === 'SALE') {
      if (!origSale) return Promise.resolve(null);
      return Promise.resolve({
        id:           'evt-sale',
        type:         'SALE',
        status:       'SYNCED',
        payload:      origSale.payload,
        journalEntry: { lines: origSale.lines },
      });
    }
    return Promise.resolve(null);
  });

  const journalEntryCreate = jest.fn().mockImplementation(({ data }) => {
    const lines = (data.lines.create as Array<{ accountId: string; debit: unknown; credit: unknown }>);
    captured = lines.map((l) => ({
      account: ID_TO_CODE[l.accountId] ?? l.accountId,
      debit:   Number(l.debit  ?? 0),
      credit:  Number(l.credit ?? 0),
    }));
    return Promise.resolve({ id: 'je-1', lines: [] });
  });

  const prisma = {
    accountingEvent: {
      findFirst: accountingEventFindFirst,
      update:    jest.fn().mockResolvedValue({}),
    },
    journalEntry: {
      count:  jest.fn().mockResolvedValue(0),
      create: journalEntryCreate,
    },
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ taxStatus: tenantTaxStatus }),
    },
    $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      // Pass-through with the same mocks.
      return cb({
        journalEntry:    { create: journalEntryCreate },
        accountingEvent: { update: jest.fn().mockResolvedValue({}) },
      });
    }),
  };

  const accounts = {
    seedDefaultAccounts: jest.fn().mockResolvedValue(undefined),
    findByCode: jest.fn().mockImplementation((_tenantId: string, code: string) => {
      return Promise.resolve(ACCOUNT_IDS[code] ? { id: ACCOUNT_IDS[code], code, name: `Account ${code}` } : null);
    }),
  };

  const periods = {
    assertDateIsOpen: jest.fn().mockResolvedValue(undefined),
  };

  const numbering = { next: jest.fn().mockResolvedValue('JE-202605-0001') };

  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      JournalService,
      { provide: PrismaService,             useValue: prisma },
      { provide: AccountsService,           useValue: accounts },
      { provide: AccountingPeriodsService,  useValue: periods },
      { provide: NumberingService,          useValue: numbering },
    ],
  }).compile();

  const svc = moduleRef.get(JournalService);
  const result = await svc.processEvent('tenant-1', 'evt-1');
  if (result.skipped) return { skipped: true };
  return captured;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('JournalService — accounting correctness across business types', () => {

  // ── 1. SALE handler ────────────────────────────────────────────────────────

  describe('SALE event', () => {
    it('cash sale ₱120 with VAT 12% — café/retail/service all post identically', async () => {
      const lines = await runProcessEvent({
        orderId:     'order-1',
        orderNumber: 'ORD-2026-0001',
        completedAt: new Date().toISOString(),
        totalAmount: 120,
        vatAmount:   12.86,           // 12/112 of 120 (PH VAT-inclusive)
        payments:    [{ method: 'CASH', amount: 120 }],
      }, 'SALE') as CapturedLine[];

      const s = summarise(lines);
      expect(s.debits.get('1010')).toBeCloseTo(120, 2);    // Cash on Hand
      expect(s.credits.get('4010')).toBeCloseTo(107.14, 2); // Sales Revenue (net of VAT)
      expect(s.credits.get('2020')).toBeCloseTo(12.86, 2);  // Output VAT
      expect(s.debitTotal).toBeCloseTo(s.creditTotal, 2);   // Books balance
    });

    it('split cash + GCash — splits between 1010 and 1031', async () => {
      const lines = await runProcessEvent({
        orderId:     'order-2',
        orderNumber: 'ORD-2026-0002',
        completedAt: new Date().toISOString(),
        totalAmount: 200,
        vatAmount:   21.43,
        payments:    [
          { method: 'CASH',           amount: 100 },
          { method: 'GCASH_PERSONAL', amount: 100 },
        ],
      }, 'SALE') as CapturedLine[];

      const s = summarise(lines);
      expect(s.debits.get('1010')).toBeCloseTo(100, 2); // Cash portion
      expect(s.debits.get('1031')).toBeCloseTo(100, 2); // Digital portion
      expect(s.credits.get('4010')).toBeCloseTo(178.57, 2);
      expect(s.credits.get('2020')).toBeCloseTo(21.43, 2);
      expect(s.debitTotal).toBeCloseTo(s.creditTotal, 2);
    });

    it('non-VAT (UNREGISTERED) tenant sale — no Output VAT line', async () => {
      const lines = await runProcessEvent({
        orderId:     'order-3',
        orderNumber: 'ORD-2026-0003',
        completedAt: new Date().toISOString(),
        totalAmount: 120,
        vatAmount:   0,
        payments:    [{ method: 'CASH', amount: 120 }],
      }, 'SALE') as CapturedLine[];

      const s = summarise(lines);
      expect(s.debits.get('1010')).toBeCloseTo(120, 2);
      expect(s.credits.get('4010')).toBeCloseTo(120, 2);
      expect(s.credits.get('2020') ?? 0).toBe(0);
      expect(s.debitTotal).toBeCloseTo(s.creditTotal, 2);
    });
  });

  // ── 2. COGS handler ────────────────────────────────────────────────────────

  describe('COGS event', () => {
    it('café recipe — Dr COGS / Cr Inventory with derived cost', async () => {
      const lines = await runProcessEvent({
        orderId: 'order-1',
        lines:  [{ productId: 'p1', quantity: 1, unitCost: 30, totalCost: 30, costMethod: 'RECIPE_WAC' }],
      }, 'COGS') as CapturedLine[];

      const s = summarise(lines);
      expect(s.debits.get('5010')).toBeCloseTo(30, 2);   // COGS up
      expect(s.credits.get('1050')).toBeCloseTo(30, 2);  // Inventory down
      expect(s.debitTotal).toBeCloseTo(s.creditTotal, 2);
    });

    it('retail with WAC — same shape with Product.costPrice or InventoryItem.avgCost', async () => {
      const lines = await runProcessEvent({
        orderId: 'order-2',
        lines:  [{ productId: 'p1', quantity: 2, unitCost: 50, totalCost: 100, costMethod: 'WAC' }],
      }, 'COGS') as CapturedLine[];

      const s = summarise(lines);
      expect(s.debits.get('5010')).toBeCloseTo(100, 2);
      expect(s.credits.get('1050')).toBeCloseTo(100, 2);
    });

    it('manufacturing with overhead — totalCost includes overhead', async () => {
      // Manufacturing tenant with overheadRate=2 per unit, so 5 units = ₱10 overhead
      const lines = await runProcessEvent({
        orderId: 'order-3',
        overheadRate: 2,
        lines:  [{ productId: 'p1', quantity: 5, unitCost: 20, totalCost: 110, directCost: 100, overhead: 10, costMethod: 'WAC' }],
      }, 'COGS') as CapturedLine[];

      const s = summarise(lines);
      expect(s.debits.get('5010')).toBeCloseTo(110, 2);
      expect(s.credits.get('1050')).toBeCloseTo(110, 2);
    });

    it('zero-cost order (service business) — skipped, no JE posted', async () => {
      const result = await runProcessEvent({
        orderId: 'order-4',
        lines:  [],   // no items had a cost
      }, 'COGS');

      expect(result).toEqual({ skipped: true });
    });
  });

  // ── 3. VOID handler — FULL_VOID ────────────────────────────────────────────

  describe('VOID event — FULL_VOID', () => {
    it('café (RECIPE_BASED) — only revenue/VAT/cash reversed; COGS retained as wastage', async () => {
      const lines = await runProcessEvent({
        orderId:             'order-1',
        orderNumber:         'ORD-2026-0001',
        totalAmount:         120,
        vatAmount:           12.86,
        payments:            [{ method: 'CASH', amount: 120 }],
        restockedCogsTotal:  0,    // recipe items skipped — ingredients consumed
      }, 'VOID') as CapturedLine[];

      const s = summarise(lines);
      // Revenue + VAT + cash reversed (Dr revenue, Dr VAT, Cr cash)
      expect(s.debits.get('4010')).toBeCloseTo(107.14, 2);
      expect(s.debits.get('2020')).toBeCloseTo(12.86, 2);
      expect(s.credits.get('1010')).toBeCloseTo(120, 2);

      // CRITICAL: COGS NOT reversed for café (waste retention)
      expect(s.debits.get('1050') ?? 0).toBe(0);
      expect(s.credits.get('5010') ?? 0).toBe(0);

      expect(s.debitTotal).toBeCloseTo(s.creditTotal, 2);
    });

    it('retail (UNIT_BASED) — revenue AND COGS reversed; books reconcile to physical stock', async () => {
      const lines = await runProcessEvent({
        orderId:             'order-2',
        orderNumber:         'ORD-2026-0002',
        totalAmount:         300,
        vatAmount:           32.14,
        payments:            [{ method: 'CASH', amount: 300 }],
        restockedCogsTotal:  150,  // ₱150 of items physically restocked
      }, 'VOID') as CapturedLine[];

      const s = summarise(lines);
      // Revenue + VAT + cash reversed
      expect(s.debits.get('4010')).toBeCloseTo(267.86, 2);
      expect(s.debits.get('2020')).toBeCloseTo(32.14, 2);
      expect(s.credits.get('1010')).toBeCloseTo(300, 2);

      // CRITICAL: COGS reversed for restocked items
      expect(s.debits.get('1050')).toBeCloseTo(150, 2);   // Inventory up
      expect(s.credits.get('5010')).toBeCloseTo(150, 2);  // COGS down

      expect(s.debitTotal).toBeCloseTo(s.creditTotal, 2);
    });

    it('falls back to flat lines when original SALE event missing (out-of-order processing)', async () => {
      // No origSale provided → handler uses payload fallback
      const lines = await runProcessEvent({
        orderId:             'order-3',
        orderNumber:         'ORD-2026-0003',
        totalAmount:         120,
        vatAmount:           12.86,
        payments:            [{ method: 'CASH', amount: 120 }],
        restockedCogsTotal:  0,
      }, 'VOID') as CapturedLine[];

      const s = summarise(lines);
      expect(s.debits.get('4010')).toBeCloseTo(107.14, 2);
      expect(s.debits.get('2020')).toBeCloseTo(12.86, 2);
      expect(s.credits.get('1010')).toBeCloseTo(120, 2);
      expect(s.debitTotal).toBeCloseTo(s.creditTotal, 2);
    });
  });

  // ── 4. VOID handler — ITEM_REFUND mode ────────────────────────────────────

  describe('VOID event — ITEM_REFUND (partial)', () => {
    const origSaleLines = [
      { accountId: ACCOUNT_IDS['1010'], debit: 360, credit: 0,    description: 'Cash sales' },
      { accountId: ACCOUNT_IDS['4010'], debit: 0,   credit: 321.43, description: 'Sales revenue' },
      { accountId: ACCOUNT_IDS['2020'], debit: 0,   credit: 38.57,  description: 'Output VAT 12%' },
    ];
    const origSalePayload = { totalAmount: 360, vatAmount: 38.57 };

    it('café partial refund (1 of 3 drinks, no restock) — proportional revenue only', async () => {
      // 1 of 3 units returned: refundAmount = lineTotal × 1/3 = 120 (incl VAT)
      const lines = await runProcessEvent({
        mode:               'ITEM_REFUND',
        orderId:            'order-1',
        orderNumber:        'ORD-2026-0001',
        orderItemId:        'item-1',
        refundQty:          1,
        originalQty:        3,
        refundAmount:       120,    // pro-rata of ₱360 line total
        refundMethod:       'CASH',
        restocked:          false,  // café — drink consumed
        restockedCogsTotal: 0,
        reason:             'Customer didn\'t like the drink',
      }, 'VOID', { payload: origSalePayload, lines: origSaleLines }) as CapturedLine[];

      const s = summarise(lines);
      // Proportional revenue + VAT + cash (1/3 of original)
      expect(s.debits.get('4010')).toBeCloseTo(107.14, 2); // 321.43 × 1/3
      expect(s.debits.get('2020')).toBeCloseTo(12.86, 2);  // 38.57 × 1/3
      expect(s.credits.get('1010')).toBeCloseTo(120, 2);

      // No COGS reversal — café drink is gone
      expect(s.debits.get('1050') ?? 0).toBe(0);
      expect(s.credits.get('5010') ?? 0).toBe(0);

      expect(s.debitTotal).toBeCloseTo(s.creditTotal, 2);
    });

    it('retail partial refund (1 of 3 shirts, restocked) — proportional revenue + COGS', async () => {
      const lines = await runProcessEvent({
        mode:               'ITEM_REFUND',
        orderId:            'order-2',
        orderNumber:        'ORD-2026-0002',
        orderItemId:        'item-1',
        refundQty:          1,
        originalQty:        3,
        refundAmount:       120,
        refundMethod:       'CASH',
        restocked:          true,
        restockedCogsTotal: 50,    // 1 shirt cost ₱50 → goes back on shelf
        reason:             'Customer changed mind',
      }, 'VOID', { payload: origSalePayload, lines: origSaleLines }) as CapturedLine[];

      const s = summarise(lines);
      expect(s.debits.get('4010')).toBeCloseTo(107.14, 2);
      expect(s.debits.get('2020')).toBeCloseTo(12.86, 2);
      expect(s.credits.get('1010')).toBeCloseTo(120, 2);

      // COGS reversal for restocked item
      expect(s.debits.get('1050')).toBeCloseTo(50, 2);   // Inventory up
      expect(s.credits.get('5010')).toBeCloseTo(50, 2);  // COGS down

      expect(s.debitTotal).toBeCloseTo(s.creditTotal, 2);
    });

    it('GCash refund — credits 1031 Digital instead of 1010 Cash', async () => {
      const lines = await runProcessEvent({
        mode:               'ITEM_REFUND',
        orderId:            'order-3',
        orderItemId:        'item-1',
        refundQty:          1,
        originalQty:        1,
        refundAmount:       50,
        refundMethod:       'GCASH_PERSONAL',
        restocked:          false,
        restockedCogsTotal: 0,
      }, 'VOID', { payload: origSalePayload, lines: origSaleLines }) as CapturedLine[];

      const s = summarise(lines);
      expect(s.credits.get('1031')).toBeCloseTo(50, 2);
      expect(s.credits.get('1010') ?? 0).toBe(0);
      expect(s.debitTotal).toBeCloseTo(s.creditTotal, 2);
    });
  });

  // ── 5. INVENTORY_ADJUSTMENT handler ────────────────────────────────────────

  describe('INVENTORY_ADJUSTMENT event', () => {
    it('cash receipt — Dr Inventory / Cr Cash', async () => {
      const lines = await runProcessEvent({
        kind:           'RAW_MATERIAL_RECEIPT',
        productName:    'Espresso Beans',
        adjustmentType: 'STOCK_IN',
        quantity:       5,
        totalValue:     2500,
        paymentMethod:  'CASH',
        receivedAt:     new Date().toISOString(),
      }, 'INVENTORY_ADJUSTMENT') as CapturedLine[];

      const s = summarise(lines);
      expect(s.debits.get('1050')).toBeCloseTo(2500, 2);
      expect(s.credits.get('1010')).toBeCloseTo(2500, 2);
      expect(s.debitTotal).toBeCloseTo(s.creditTotal, 2);
    });

    it('credit receipt — Dr Inventory / Cr Accounts Payable', async () => {
      const lines = await runProcessEvent({
        kind:           'RAW_MATERIAL_RECEIPT',
        productName:    'Milk',
        adjustmentType: 'STOCK_IN',
        quantity:       10,
        totalValue:     1500,
        paymentMethod:  'CREDIT',
      }, 'INVENTORY_ADJUSTMENT') as CapturedLine[];

      const s = summarise(lines);
      expect(s.debits.get('1050')).toBeCloseTo(1500, 2);
      expect(s.credits.get('2010')).toBeCloseTo(1500, 2);  // AP accrual
      expect(s.debitTotal).toBeCloseTo(s.creditTotal, 2);
    });

    it('owner-funded receipt — Dr Inventory / Cr Owner\'s Capital', async () => {
      const lines = await runProcessEvent({
        kind:           'RAW_MATERIAL_RECEIPT',
        productName:    'Initial stock',
        adjustmentType: 'STOCK_IN',
        quantity:       100,
        totalValue:     5000,
        paymentMethod:  'OWNER_FUNDED',
      }, 'INVENTORY_ADJUSTMENT') as CapturedLine[];

      const s = summarise(lines);
      expect(s.debits.get('1050')).toBeCloseTo(5000, 2);
      expect(s.credits.get('3010')).toBeCloseTo(5000, 2); // Owner's capital
      expect(s.debitTotal).toBeCloseTo(s.creditTotal, 2);
    });

    it('write-off / negative adjustment — Dr COGS / Cr Inventory', async () => {
      const lines = await runProcessEvent({
        kind:           'WRITE_OFF',
        productName:    'Spoiled milk',
        adjustmentType: 'WRITE_OFF',
        quantity:       -5,
        totalValue:     -750,
        reason:         'Expired',
      }, 'INVENTORY_ADJUSTMENT') as CapturedLine[];

      const s = summarise(lines);
      expect(s.debits.get('5010')).toBeCloseTo(750, 2);   // COGS hit (loss)
      expect(s.credits.get('1050')).toBeCloseTo(750, 2);  // Inventory down
      expect(s.debitTotal).toBeCloseTo(s.creditTotal, 2);
    });

    it('zero-value adjustment (no cost set) — skipped, no JE posted', async () => {
      const result = await runProcessEvent({
        kind:           'RAW_MATERIAL_RECEIPT',
        productName:    'Free sample',
        adjustmentType: 'STOCK_IN',
        quantity:       10,
        totalValue:     0,
        paymentMethod:  'OWNER_FUNDED',
      }, 'INVENTORY_ADJUSTMENT');

      expect(result).toEqual({ skipped: true });
    });
  });

  // ── 6. Sprint 13 — Trucking events ─────────────────────────────────────────

  describe('TRIP_CASH_ADVANCE event', () => {
    it('₱5,000 advance to driver — DR 1034 / CR 1010', async () => {
      const lines = await runProcessEvent({
        tripId:     'trip-1',
        tripNumber: 'TRIP-2026-000001',
        driverId:   'user-driver',
        branchId:   'branch-1',
        amount:     5000,
        issuedAt:   new Date().toISOString(),
      }, 'TRIP_CASH_ADVANCE') as CapturedLine[];

      const s = summarise(lines);
      expect(s.debits.get('1034')).toBeCloseTo(5000, 2);
      expect(s.credits.get('1010')).toBeCloseTo(5000, 2);
      expect(s.debitTotal).toBeCloseTo(s.creditTotal, 2);
      expect(s.debitTotal).toBeCloseTo(5000, 2);
    });

    it('zero advance — skipped, no JE posted', async () => {
      const result = await runProcessEvent({
        tripId:     'trip-1',
        tripNumber: 'TRIP-2026-000002',
        driverId:   'user-driver',
        branchId:   'branch-1',
        amount:     0,
      }, 'TRIP_CASH_ADVANCE');

      expect(result).toEqual({ skipped: true });
    });
  });

  describe('TRIP_LIQUIDATION event', () => {
    it('exact-spend liquidation — DR fuel/toll/meals / CR 1034 (no residual)', async () => {
      // Driver got ₱5,000, spent ₱2,500 fuel + ₱500 toll + ₱200 meals = ₱3,200,
      // returned ₱1,800. We post the expensed portion only; the ₱1,800
      // variance stays on 1034 awaiting the cash-return JE (out of scope).
      const lines = await runProcessEvent({
        tripId:        'trip-1',
        tripNumber:    'TRIP-2026-000003',
        driverId:      'user-driver',
        branchId:      'branch-1',
        cashAdvance:   5000,
        receiptsTotal: 3200,
        variance:      1800,
        categoryBreakdown: { FUEL: 2500, TOLL: 500, MEALS: 200 },
        liquidatedAt:  new Date().toISOString(),
      }, 'TRIP_LIQUIDATION') as CapturedLine[];

      const s = summarise(lines);
      expect(s.debits.get('6101')).toBeCloseTo(2500, 2);  // FUEL
      expect(s.debits.get('6100')).toBeCloseTo(700,  2);  // TOLL + MEALS combined
      expect(s.credits.get('1034')).toBeCloseTo(3200, 2); // Settle the receipted portion
      expect(s.debitTotal).toBeCloseTo(s.creditTotal, 2);
    });

    it('overspend liquidation — receipts > advance, residual on 1034 negative', async () => {
      // Driver got ₱5,000, spent ₱5,800 (over by ₱800 — REPAIR cost).
      // The full ₱5,800 expensed; ₱5,800 credited to 1034.
      // 1034 ends at -₱800 forcing investigation (per locked policy).
      const lines = await runProcessEvent({
        tripId:        'trip-1',
        tripNumber:    'TRIP-2026-000004',
        driverId:      'user-driver',
        branchId:      'branch-1',
        cashAdvance:   5000,
        receiptsTotal: 5800,
        variance:      -800,
        categoryBreakdown: { FUEL: 3000, REPAIR: 2800 },
      }, 'TRIP_LIQUIDATION') as CapturedLine[];

      const s = summarise(lines);
      expect(s.debits.get('6101')).toBeCloseTo(3000, 2);
      expect(s.debits.get('6102')).toBeCloseTo(2800, 2);
      expect(s.credits.get('1034')).toBeCloseTo(5800, 2);
      expect(s.debitTotal).toBeCloseTo(s.creditTotal, 2);
    });

    it('OTHER category falls through to 6140 misc', async () => {
      const lines = await runProcessEvent({
        tripId:        'trip-1',
        tripNumber:    'TRIP-2026-000005',
        driverId:      'user-driver',
        branchId:      'branch-1',
        cashAdvance:   1000,
        receiptsTotal: 1000,
        variance:      0,
        categoryBreakdown: { OTHER: 1000 },
      }, 'TRIP_LIQUIDATION') as CapturedLine[];

      const s = summarise(lines);
      expect(s.debits.get('6140')).toBeCloseTo(1000, 2);
      expect(s.credits.get('1034')).toBeCloseTo(1000, 2);
    });

    it('empty liquidation (no receipts, no variance) — skipped', async () => {
      const result = await runProcessEvent({
        tripId:        'trip-1',
        tripNumber:    'TRIP-2026-000006',
        cashAdvance:   0,
        receiptsTotal: 0,
        variance:      0,
        categoryBreakdown: {},
      }, 'TRIP_LIQUIDATION');

      expect(result).toEqual({ skipped: true });
    });
  });

  // ── 7. Sprint 13 — Construction events ─────────────────────────────────────

  describe('PROGRESS_BILLING event', () => {
    it('VAT-registered: ₱100k gross / 10% retention → AR 90k + Retention 10k / Revenue + VAT', async () => {
      const lines = await runProcessEvent({
        billingId:        'pb-1',
        billingNumber:    'PB-2026-000001',
        projectId:        'proj-1',
        grossAmount:      100_000,
        retentionAmount:  10_000,
        netAmount:        90_000,
        stageDescription: 'Foundation works',
        percentComplete:  25,
      }, 'PROGRESS_BILLING', undefined, 'VAT') as CapturedLine[];

      const s = summarise(lines);
      expect(s.debits.get('1030')).toBeCloseTo(90_000, 2);    // AR (net to collect now)
      expect(s.debits.get('1037')).toBeCloseTo(10_000, 2);    // Retention Receivable
      // VAT split: vat = 100k − 100k/1.12 = 10,714.29; revenue = 89,285.71
      expect(s.credits.get('4010')).toBeCloseTo(89_285.71, 2);
      expect(s.credits.get('2020')).toBeCloseTo(10_714.29, 2);
      expect(s.debitTotal).toBeCloseTo(s.creditTotal, 2);
      expect(s.debitTotal).toBeCloseTo(100_000, 2);
    });

    it('non-VAT tenant: zero VAT, full gross goes to revenue', async () => {
      const lines = await runProcessEvent({
        billingId:        'pb-2',
        billingNumber:    'PB-2026-000002',
        projectId:        'proj-1',
        grossAmount:      50_000,
        retentionAmount:  5_000,
        netAmount:        45_000,
      }, 'PROGRESS_BILLING', undefined, 'NON_VAT') as CapturedLine[];

      const s = summarise(lines);
      expect(s.debits.get('1030')).toBeCloseTo(45_000, 2);
      expect(s.debits.get('1037')).toBeCloseTo(5_000, 2);
      expect(s.credits.get('4010')).toBeCloseTo(50_000, 2);
      expect(s.credits.get('2020') ?? 0).toBeCloseTo(0, 2);
      expect(s.debitTotal).toBeCloseTo(s.creditTotal, 2);
    });

    it('zero retention (final billing) — only AR + Revenue + VAT, no 1037 entry', async () => {
      const lines = await runProcessEvent({
        billingId:        'pb-3',
        billingNumber:    'PB-2026-000003',
        projectId:        'proj-1',
        grossAmount:      28_000,
        retentionAmount:  0,
        netAmount:        28_000,
      }, 'PROGRESS_BILLING', undefined, 'VAT') as CapturedLine[];

      const s = summarise(lines);
      expect(s.debits.get('1030')).toBeCloseTo(28_000, 2);
      expect(s.debits.get('1037')).toBeUndefined();
      expect(s.debitTotal).toBeCloseTo(s.creditTotal, 2);
    });

    it('zero gross — skipped', async () => {
      const result = await runProcessEvent({
        billingId:        'pb-4',
        billingNumber:    'PB-2026-000004',
        grossAmount:      0,
        retentionAmount:  0,
        netAmount:        0,
      }, 'PROGRESS_BILLING');

      expect(result).toEqual({ skipped: true });
    });
  });

  describe('RETENTION_RELEASE event', () => {
    it('AR_CREDIT (default) — DR 1030 / CR 1037 (move into current AR for collection)', async () => {
      const lines = await runProcessEvent({
        releaseId:         'rr-1',
        progressBillingId: 'pb-1',
        billingNumber:     'PB-2026-000001',
        projectId:         'proj-1',
        releasedAmount:    10_000,
        releaseMethod:     'AR_CREDIT',
      }, 'RETENTION_RELEASE') as CapturedLine[];

      const s = summarise(lines);
      expect(s.debits.get('1030')).toBeCloseTo(10_000, 2);
      expect(s.credits.get('1037')).toBeCloseTo(10_000, 2);
      expect(s.debitTotal).toBeCloseTo(s.creditTotal, 2);
    });

    it('CASH method — DR 1010 / CR 1037 (customer paid retention directly)', async () => {
      const lines = await runProcessEvent({
        releaseId:         'rr-2',
        progressBillingId: 'pb-1',
        billingNumber:     'PB-2026-000001',
        releasedAmount:    8_500,
        releaseMethod:     'CASH',
      }, 'RETENTION_RELEASE') as CapturedLine[];

      const s = summarise(lines);
      expect(s.debits.get('1010')).toBeCloseTo(8_500, 2);
      expect(s.credits.get('1037')).toBeCloseTo(8_500, 2);
      expect(s.debitTotal).toBeCloseTo(s.creditTotal, 2);
    });

    it('zero amount — skipped', async () => {
      const result = await runProcessEvent({
        releaseId:         'rr-3',
        progressBillingId: 'pb-1',
        releasedAmount:    0,
        releaseMethod:     'AR_CREDIT',
      }, 'RETENTION_RELEASE');

      expect(result).toEqual({ skipped: true });
    });
  });

});
