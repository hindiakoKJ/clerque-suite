import { OrdersService } from './orders.service';
import { TaxCalculatorService } from '../tax/tax.service';
import type { OfflineOrder } from '@repo/shared-types';

/**
 * The create path when the caller is another app rather than a cashier.
 *
 * Two things separate a machine caller from the till. Its arithmetic is not
 * trusted — a booking app that under-reports VAT corrupts the TENANT's BIR
 * filings, so we recompute and refuse rather than record what we were told.
 * And its retries must be free: an app that times out and tries again must
 * get the original sale back, never a second one.
 */
describe('OrdersService — platform (API-channel) creates', () => {
  const TENANT = 'tenant-1';

  const payload = (over: Partial<OfflineOrder> = {}): OfflineOrder => ({
    clientUuid: 'uuid-1',
    branchId:   'branch-1',
    items: [
      {
        productId: 'p1', productName: 'Court 3 — 1hr', unitPrice: 500,
        quantity: 2, discountAmount: 0, vatAmount: 0, lineTotal: 1000,
        isVatable: true,
      },
    ],
    payments:  [{ method: 'CASH', amount: 1000 }],
    discounts: [],
    subtotal:       1000,
    discountAmount: 0,
    vatAmount:      107.14,
    totalAmount:    1000,
    isPwdScDiscount: false,
    createdAt: '2026-07-23T10:00:00.000Z',
    ...over,
  });

  const build = (over: { quote?: any; existingOrder?: any } = {}) => {
    const prisma = {
      order:  { findFirst: jest.fn().mockResolvedValue(over.existingOrder ?? null) },
      tenant: { findUniqueOrThrow: jest.fn().mockResolvedValue({ taxStatus: 'VAT', isVatRegistered: true }) },
      $transaction: jest.fn(),
    } as any;
    const quotes = {
      quote: jest.fn().mockResolvedValue(over.quote ?? {
        subtotal: 1000, discountAmount: 0, vatAmount: 107.14, totalAmount: 1000,
      }),
    } as any;
    const periods = { assertDateIsOpen: jest.fn() } as any;
    const svc = new OrdersService(
      prisma, periods, new TaxCalculatorService(),
      {} as any, {} as any, {} as any, {} as any, quotes,
    );
    return { svc, prisma, quotes, periods };
  };

  const SERVICE_CALL = {
    channel: 'API' as const,
    createdByApiKeyId: 'key-1',
    enforceServerTotals: true,
  };

  /* ── Enforcement ─────────────────────────────────────────────────────── */

  it('rejects a sale whose total disagrees with the catalog', async () => {
    const { svc } = build({
      quote: { subtotal: 1000, discountAmount: 0, vatAmount: 107.14, totalAmount: 1000 },
    });
    // The app claims the customer owes ₱1 for two ₱500 court hours.
    await expect(
      svc.create(TENANT, null, payload({ totalAmount: 1, subtotal: 1, payments: [{ method: 'CASH', amount: 1 }] }), SERVICE_CALL),
    ).rejects.toMatchObject({ response: { code: 'ORDER_TOTALS_MISMATCH' } });
  });

  it('rejects a sale that under-reports VAT while getting the total right', async () => {
    // The subtler abuse: the customer pays the right amount, but the books
    // record less output VAT than the tenant actually owes BIR.
    const { svc } = build();
    await expect(
      svc.create(TENANT, null, payload({ vatAmount: 0 }), SERVICE_CALL),
    ).rejects.toMatchObject({ response: { code: 'ORDER_TOTALS_MISMATCH' } });
  });

  it('names what disagreed, so the caller can fix its request', async () => {
    const { svc } = build();
    await expect(
      svc.create(TENANT, null, payload({ totalAmount: 1, subtotal: 1, payments: [{ method: 'CASH', amount: 1 }] }), SERVICE_CALL),
    ).rejects.toMatchObject({
      response: {
        mismatches: expect.arrayContaining([expect.stringContaining('total')]),
        expected:   { totalAmount: 1000, vatAmount: 107.14, subtotal: 1000, discountAmount: 0 },
      },
    });
  });

  it('tolerates a one-centavo rounding difference', async () => {
    const { svc, periods } = build();
    // Gets past enforcement and on to the period check — which is as far as
    // this test needs to go; it proves the totals were accepted.
    await svc.create(TENANT, null, payload({ totalAmount: 1000.01 }), SERVICE_CALL)
      .catch(() => undefined);
    expect(periods.assertDateIsOpen).toHaveBeenCalled();
  });

  it('prices the quote from the catalog, ignoring the unit prices sent', async () => {
    const { svc, quotes } = build();
    await svc.create(TENANT, null, payload(), SERVICE_CALL).catch(() => undefined);

    const sent = quotes.quote.mock.calls[0][1];
    expect(sent.items[0]).toEqual({
      productId: 'p1', variantId: undefined, quantity: 2, modifierOptionIds: [],
    });
    expect(sent.items[0]).not.toHaveProperty('unitPrice');
  });

  it('leaves the POS path alone — a cashier\'s displayed totals are not re-derived', async () => {
    const { svc, quotes } = build();
    // Same wrong totals, but from the till. The POS shows the customer a
    // receipt before we ever see the payload; silently repricing it would
    // make the record disagree with what they were handed.
    await svc.create(TENANT, 'cashier-1', payload({ totalAmount: 1 })).catch(() => undefined);
    expect(quotes.quote).not.toHaveBeenCalled();
  });

  /* ── Payment reconciliation (phantom-cash guard) ─────────────────────── */

  it('rejects a CASH_SALE whose payments do not cover the total (the deposit / phantom-cash case)', async () => {
    const { svc } = build();
    // ₱1000 order, only ₱500 tendered — the exact shape that debited Cash for
    // ₱500 that never entered the drawer.
    await expect(
      svc.create(TENANT, 'cashier-1', payload({
        payments: [{ method: 'CASH', amount: 500 }],
      })),
    ).rejects.toMatchObject({ response: { code: 'PAYMENTS_DO_NOT_MATCH_TOTAL' } });
  });

  it('rejects an over-tender too — payments must equal the total, not merely cover it', async () => {
    const { svc } = build();
    await expect(
      svc.create(TENANT, 'cashier-1', payload({
        payments: [{ method: 'CASH', amount: 1500 }],
      })),
    ).rejects.toMatchObject({ response: { code: 'PAYMENTS_DO_NOT_MATCH_TOTAL' } });
  });

  it('rejects a CHARGE that carries a payment — a credit sale is billed, not tendered', async () => {
    const { svc } = build();
    await expect(
      svc.create(TENANT, 'cashier-1', payload({
        invoiceType: 'CHARGE' as any,
        payments: [{ method: 'CASH', amount: 1000 }],
      })),
    ).rejects.toMatchObject({ response: { code: 'CHARGE_HAS_PAYMENT' } });
  });

  it('accepts a CHARGE with no payment (the AR / subscription-billing shape)', async () => {
    const { svc, periods } = build();
    // Gets past the payment guard to the period check — proving the empty-
    // payments CHARGE that ar.service and subscription-billing emit is allowed.
    await svc.create(TENANT, 'cashier-1', payload({
      invoiceType: 'CHARGE' as any, payments: [],
    })).catch(() => undefined);
    expect(periods.assertDateIsOpen).toHaveBeenCalled();
  });

  it('accepts a split tender that sums to the total', async () => {
    const { svc, periods } = build();
    await svc.create(TENANT, 'cashier-1', payload({
      payments: [{ method: 'CASH', amount: 600 }, { method: 'GCASH_BUSINESS', amount: 400 }],
    })).catch(() => undefined);
    expect(periods.assertDateIsOpen).toHaveBeenCalled();
  });

  /* ── Idempotency ─────────────────────────────────────────────────────── */

  it('returns the original sale when an app replays the same externalRef', async () => {
    const original = { id: 'order-1', orderNumber: 'INV-000001' };
    const { svc, prisma } = build({ existingOrder: original });

    const result = await svc.create(
      TENANT, null, payload({ clientUuid: undefined as any }),
      { ...SERVICE_CALL, externalRef: 'booking-42' },
    );

    expect(result).toBe(original);
    expect(prisma.order.findFirst).toHaveBeenCalledWith({
      where: { externalRef: 'booking-42', tenantId: TENANT },
    });
  });

  it('scopes the externalRef lookup to the tenant, so one app cannot read another\'s sale', async () => {
    const { svc, prisma } = build({ existingOrder: null });
    await svc.create(TENANT, null, payload(), { ...SERVICE_CALL, externalRef: 'booking-42' })
      .catch(() => undefined);

    for (const call of prisma.order.findFirst.mock.calls) {
      expect(call[0].where.tenantId).toBe(TENANT);
    }
  });
});
