import { OrdersService } from './orders.service';
import { TaxCalculatorService } from '../tax/tax.service';
import type { OfflineOrder } from '@repo/shared-types';

/**
 * Cash needs a till, and a till is a shift.
 *
 * KJ's rule for the shop: owners have no shift, and the cashier is the only
 * one who handles cash.
 *
 * Supervisors bypass the shift gate on purpose (ShiftGate.tsx), so before this
 * an owner ringing a cash sale put money in the barista's drawer with no
 * shiftId on the order. At close she counted OVER, the surplus posted to the
 * GL as income, and she was asked to explain a windfall that was not hers.
 *
 * So the control is not "make the owner open a shift". It is that cash cannot
 * be taken without a drawer to put it in. Non-cash is deliberately untouched —
 * a GCash sale opens no drawer, so an owner can still ring one.
 */
describe('OrdersService.create — cash needs a till', () => {
  const TENANT = 'tenant-1';

  const payload = (over: Partial<OfflineOrder> = {}): OfflineOrder => ({
    clientUuid: 'uuid-1',
    branchId:   'branch-1',
    items: [{
      productId: 'p1', productName: 'Latte', unitPrice: 150,
      quantity: 1, discountAmount: 0, vatAmount: 16.07, lineTotal: 150,
      isVatable: true,
    }],
    payments:  [{ method: 'CASH', amount: 150 }],
    discounts: [],
    subtotal: 150, discountAmount: 0, vatAmount: 16.07, totalAmount: 150,
    isPwdScDiscount: false,
    createdAt: '2026-08-31T02:00:00.000Z',
    ...over,
  });

  const build = () => {
    const prisma = {
      order:  { findFirst: jest.fn().mockResolvedValue(null) },
      shift:  { count: jest.fn().mockResolvedValue(1) },
      tenant: { findUniqueOrThrow: jest.fn().mockResolvedValue({ taxStatus: 'VAT', isVatRegistered: true }) },
      $transaction: jest.fn(),
    } as any;
    const quotes = {
      quote: jest.fn().mockResolvedValue({
        subtotal: 150, discountAmount: 0, vatAmount: 16.07, totalAmount: 150,
      }),
    } as any;
    const periods = { assertDateIsOpen: jest.fn() } as any;
    const svc = new OrdersService(
      prisma, periods, new TaxCalculatorService(),
      {} as any, {} as any, {} as any, {} as any, quotes,
    );
    return { svc, prisma, periods };
  };

  /** The sale is refused before anything downstream is touched. */
  const rang = (svc: any, p: OfflineOrder, opts?: any) =>
    svc.create(TENANT, 'owner-1', p, opts);

  describe('an owner, who has no shift', () => {
    it('cannot take cash', async () => {
      const { svc } = build();
      await expect(rang(svc, payload())).rejects.toMatchObject({
        response: { code: 'CASH_WITHOUT_SHIFT' },
      });
    });

    it('is told what to do instead, not just refused', async () => {
      const { svc } = build();
      await expect(rang(svc, payload())).rejects.toThrow(
        /have the cashier ring this sale, or take GCash/i,
      );
    });

    it('is stopped before the period check, so nothing downstream runs', async () => {
      const { svc, periods } = build();
      await rang(svc, payload()).catch(() => undefined);
      expect(periods.assertDateIsOpen).not.toHaveBeenCalled();
    });

    it('can still ring GCash, which opens no drawer', async () => {
      const { svc, periods } = build();
      await rang(svc, payload({
        payments: [{ method: 'GCASH_BUSINESS', amount: 150 }],
      })).catch(() => undefined);
      expect(periods.assertDateIsOpen).toHaveBeenCalled();
    });

    it('is refused on the cash HALF of a split tender', async () => {
      // Half the money still has nowhere to go.
      const { svc } = build();
      await expect(rang(svc, payload({
        payments: [
          { method: 'GCASH_BUSINESS', amount: 100 },
          { method: 'CASH', amount: 50 },
        ],
      }))).rejects.toThrow(/Cash needs an open till/i);
    });

    it('can still ring a CHARGE sale, which is collected later', async () => {
      const { svc, periods } = build();
      await rang(svc, payload({
        invoiceType: 'CHARGE' as any, payments: [],
      })).catch(() => undefined);
      expect(periods.assertDateIsOpen).toHaveBeenCalled();
    });
  });

  describe('a cashier, who has one', () => {
    it('rings cash exactly as before', async () => {
      const { svc, periods } = build();
      await rang(svc, payload({ shiftId: 'shift-1' } as any)).catch(() => undefined);
      expect(periods.assertDateIsOpen).toHaveBeenCalled();
    });

    it('is not required to have that shift still OPEN', async () => {
      /*
        The Counter app queues sales offline and syncs them later, sometimes
        after the cashier has gone home. The cash was in a drawer when it was
        taken; rejecting the sync would lose a real sale. Presence is the
        control, openness is a timing accident — which is why the check never
        looks at closedAt.
      */
      const { svc, periods } = build();
      await rang(svc, payload({ shiftId: 'shift-closed-yesterday' } as any)).catch(() => undefined);
      expect(periods.assertDateIsOpen).toHaveBeenCalled();
    });
  });

  describe('other channels', () => {
    it('leaves an ecosystem app alone', async () => {
      // An API order settling in cash has no till of ours behind it, and
      // refusing it would break a working integration over a rule about our
      // own counter.
      const { svc, periods } = build();
      await svc.create(TENANT, null, payload(), {
        channel: 'API', createdByApiKeyId: 'key-1', enforceServerTotals: true,
      } as any).catch(() => undefined);
      expect(periods.assertDateIsOpen).toHaveBeenCalled();
    });
  });
});
