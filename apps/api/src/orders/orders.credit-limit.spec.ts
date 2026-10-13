import { OrdersService } from './orders.service';
import { TaxCalculatorService } from '../tax/tax.service';
import type { OfflineOrder } from '@repo/shared-types';

/**
 * Selling to mechanics on account.
 *
 * A customer's credit limit was stored and never read, so a cashier could keep
 * charging a shop that already owed far more than the owner meant to lend. A
 * live CHARGE sale now stops at the limit -- unless the owner rings it -- and a
 * CHARGE sale with nobody to collect from is refused outright.
 *
 * "Owes" is the same balance the Customers page shows: every CHARGE sale not
 * voided, less what was collected on it.
 */
describe('OrdersService.create -- credit limits on CHARGE sales', () => {
  const TENANT = 'tenant-1';

  const payload = (over: Partial<OfflineOrder> = {}): OfflineOrder => ({
    clientUuid: 'uuid-1',
    branchId:   'branch-1',
    customerId: 'cust-1',
    invoiceType: 'CHARGE' as any,
    items: [{
      productId: 'p1', productName: 'Brake pads', unitPrice: 1000,
      quantity: 1, discountAmount: 0, vatAmount: 0, lineTotal: 1000,
      isVatable: false,
    }],
    payments:  [],
    discounts: [],
    subtotal: 1000, discountAmount: 0, vatAmount: 0, totalAmount: 1000,
    isPwdScDiscount: false,
    createdAt: '2026-10-13T02:00:00.000Z',
    ...over,
  });

  /** A CHARGE sale to Mang Ben, owing on two earlier sales. */
  const build = (customer: { name: string; creditLimit: number | null } | null = { name: 'Mang Ben Auto', creditLimit: 5000 }) => {
    const prisma = {
      order: {
        findFirst: jest.fn().mockResolvedValue(null),
        // ₱3,000 sale with ₱500 collected (owes 2,500) + ₱1,000 untouched = owes ₱3,500.
        // A fully paid sale owes nothing and must not count against the limit.
        findMany: jest.fn().mockResolvedValue([
          { totalAmount: 3000, payments: [{ amount: 500 }] },
          { totalAmount: 1000, payments: [] },
          { totalAmount: 2000, payments: [{ amount: 2000 }] },
        ]),
      },
      tenant:   { findUniqueOrThrow: jest.fn().mockResolvedValue({ taxStatus: 'NON_VAT', isVatRegistered: false }) },
      branch:   { findFirst: jest.fn().mockResolvedValue({ id: 'branch-1' }) },
      customer: {
        count:     jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValue(customer),
      },
      // The step right after the credit check. Reaching it means the sale got through.
      product:  { findMany: jest.fn().mockRejectedValue(new Error('PAST_CREDIT_CHECK')) },
      $transaction: jest.fn(),
    } as any;
    const periods = { assertDateIsOpen: jest.fn() } as any;
    const svc = new OrdersService(
      prisma, periods, new TaxCalculatorService(),
      {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    return { svc, prisma };
  };

  const ring = (svc: OrdersService, p: OfflineOrder, opts: any = { callerRole: 'CASHIER' }) =>
    svc.create(TENANT, 'cashier-1', p, opts);

  it('refuses a sale that would take the customer past the limit, in words the cashier can act on', async () => {
    const { svc } = build();
    // Owes ₱3,500; ₱2,000 more makes ₱5,500 against a ₱5,000 limit.
    const sale = ring(svc, payload({ totalAmount: 2000, subtotal: 2000 }));
    await expect(sale).rejects.toMatchObject({ response: { code: 'OVER_CREDIT_LIMIT' } });
    await expect(ring(build().svc, payload({ totalAmount: 2000, subtotal: 2000 }))).rejects.toThrow(
      'This sale would put Mang Ben Auto over their ₱5,000.00 credit limit (owes ₱3,500.00 now). Take payment, or ask the owner.',
    );
  });

  it('lets a sale through that stays inside the limit', async () => {
    const { svc } = build();
    await expect(ring(svc, payload({ totalAmount: 1500, subtotal: 1500 }))).rejects.toThrow('PAST_CREDIT_CHECK');
  });

  it('lets a sale through that lands exactly on the limit', async () => {
    const { svc } = build();
    await expect(ring(svc, payload({ totalAmount: 1500, subtotal: 1500 }))).rejects.toThrow('PAST_CREDIT_CHECK');
    await expect(ring(build().svc, payload({ totalAmount: 1500.01, subtotal: 1500.01 })))
      .rejects.toMatchObject({ response: { code: 'OVER_CREDIT_LIMIT' } });
  });

  it('counts the balance the same way the Customers page does (voided sales left out)', async () => {
    const { svc, prisma } = build();
    await ring(svc, payload({ totalAmount: 100, subtotal: 100 })).catch(() => undefined);
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: TENANT, customerId: 'cust-1', invoiceType: 'CHARGE', status: { not: 'VOIDED' } },
    }));
  });

  it('does not check a customer with no limit set', async () => {
    const { svc, prisma } = build({ name: 'Mang Ben Auto', creditLimit: null });
    await expect(ring(svc, payload({ totalAmount: 999_999, subtotal: 999_999 }))).rejects.toThrow('PAST_CREDIT_CHECK');
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });

  it('lets the owner go over the limit -- it is their money to lend', async () => {
    const { svc, prisma } = build();
    await expect(ring(svc, payload({ totalAmount: 50_000, subtotal: 50_000 }), { callerRole: 'BUSINESS_OWNER' }))
      .rejects.toThrow('PAST_CREDIT_CHECK');
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
  });

  it('holds a manager to the limit too', async () => {
    const { svc } = build();
    await expect(ring(svc, payload({ totalAmount: 2000, subtotal: 2000 }), { callerRole: 'BRANCH_MANAGER' }))
      .rejects.toMatchObject({ response: { code: 'OVER_CREDIT_LIMIT' } });
  });

  it('does not refuse a sale replayed from an offline till -- it already happened', async () => {
    const { svc } = build();
    await expect(ring(svc, payload({ totalAmount: 50_000, subtotal: 50_000 }), { callerRole: 'CASHIER', replayedOffline: true }))
      .rejects.toThrow('PAST_CREDIT_CHECK');
  });

  it('leaves a cash sale alone, whatever the customer owes', async () => {
    const { svc, prisma } = build();
    await expect(ring(svc, payload({
      invoiceType: 'CASH_SALE' as any, totalAmount: 50_000, subtotal: 50_000,
      payments: [{ method: 'GCASH_BUSINESS', amount: 50_000 }],
    }))).rejects.toThrow('PAST_CREDIT_CHECK');
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
  });

  describe('a CHARGE sale with no customer account', () => {
    it('is refused: there is nobody to collect from', async () => {
      const { svc } = build();
      await expect(ring(svc, payload({ customerId: undefined })))
        .rejects.toMatchObject({ response: { code: 'CHARGE_NEEDS_CUSTOMER' } });
    });

    it('is refused for the owner too', async () => {
      const { svc } = build();
      await expect(ring(svc, payload({ customerId: undefined }), { callerRole: 'BUSINESS_OWNER' }))
        .rejects.toThrow(/needs the customer's account/);
    });
  });
});
