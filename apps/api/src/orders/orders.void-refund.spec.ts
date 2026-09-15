import { ForbiddenException } from '@nestjs/common';
import { OrdersService } from './orders.service';

/**
 * Voids and refunds, the parts that decide stock and the books:
 *   - a void puts back only what a refund had not already dealt with, and
 *     tells the journal how much was already refunded;
 *   - "same day" is the shop's day in Manila, not the server's;
 *   - a refund books stock value back only when something went back on a shelf;
 *   - refunding the last thing the kitchen was still making ends the wait.
 */
describe('OrdersService — void and refund', () => {
  const TENANT = 't1';

  function build(opts: {
    order: Record<string, unknown>;
    items?: any[];
    inventory?: { id: string; quantity: number } | null;
    refunded?: number;
    waiting?: Array<{ quantity: number; refundedQty: number }>;
  }) {
    const events: any[] = [];
    const tx: any = {
      order: {
        findFirst: jest.fn().mockResolvedValue({ id: 'o1', tenantId: TENANT, branchId: 'b1', orderNumber: 'ORD-1', totalAmount: 360, vatAmount: 38.57, discountAmount: 0, ...opts.order }),
        update: jest.fn().mockResolvedValue({ id: 'o1', status: 'VOIDED' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orderItem: {
        findMany: jest.fn(({ where }: any) => Promise.resolve(where.prepStatus ? (opts.waiting ?? []) : (opts.items ?? []))),
        findFirst: jest.fn().mockResolvedValue(opts.items?.[0] ?? null),
        update: jest.fn().mockResolvedValue({}),
      },
      inventoryItem: {
        findUnique: jest.fn().mockResolvedValue(opts.inventory ?? null),
        findFirst: jest.fn().mockResolvedValue(opts.inventory ?? null),
        update: jest.fn().mockResolvedValue({}),
      },
      inventoryLog: { create: jest.fn().mockResolvedValue({}) },
      orderPayment: { findMany: jest.fn().mockResolvedValue([{ method: 'CASH', amount: 360 }]) },
      orderItemRefund: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { refundAmount: opts.refunded ?? null } }),
        create: jest.fn(({ data }: any) => Promise.resolve({ id: 'rf1', ...data })),
      },
      product: { findUnique: jest.fn().mockResolvedValue({ costPrice: 40 }) },
      accountingEvent: { create: jest.fn(({ data }: any) => { events.push(data); return Promise.resolve(data); }) },
    };
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ planCode: 'CLERQUE', voidApprovalThresholdCents: 0, returnsOwnerOnly: false }) },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    const svc = new OrdersService(
      prisma,
      { assertDateIsOpen: jest.fn() } as any,
      { assertVatConsistency: jest.fn() } as any,
      { log: jest.fn(), logVoid: jest.fn() } as any,
      { next: jest.fn() } as any,
      { accrue: jest.fn() } as any,
      { hasApprovedFor: jest.fn().mockResolvedValue(true) } as any,
      {} as any,
    );
    return { svc, tx, events };
  }

  afterEach(() => jest.useRealTimers());

  it('a void after a partial refund puts back only the units not refunded, and tells the journal what was refunded', async () => {
    const { svc, tx, events } = build({
      order: { status: 'COMPLETED', paidAt: new Date() },
      items: [{ id: 'it1', productId: 'p-shirt', quantity: 3, refundedQty: 1, costPrice: 40, product: { inventoryMode: 'UNIT_BASED' } }],
      inventory: { id: 'inv1', quantity: 10 },
      refunded: 120,
    });
    await svc.void(TENANT, 'o1', 'owner', 'BUSINESS_OWNER', 'Customer changed mind');
    expect(Number(tx.inventoryItem.update.mock.calls[0][0].data.quantity)).toBe(12);
    const voidEvent = events.find((e) => e.type === 'VOID');
    expect(voidEvent.payload).toMatchObject({ restockedCogsTotal: 80, refundedAmount: 120 });
  });

  it('"same day" is the shop\'s day in Manila', async () => {
    jest.useFakeTimers();
    // 12:10 AM in Manila on the 15th is still the 14th in UTC.
    jest.setSystemTime(new Date('2026-09-15T00:10:00+08:00'));
    const lateLastNight = build({ order: { status: 'COMPLETED', paidAt: new Date('2026-09-14T23:30:00+08:00') }, items: [] });
    await expect(lateLastNight.svc.void(TENANT, 'o1', 'owner', 'BUSINESS_OWNER', 'x')).rejects.toThrow(ForbiddenException);

    // 9 AM in Manila; the 7 AM sale was the previous day in UTC but is today at the shop.
    jest.setSystemTime(new Date('2026-09-15T09:00:00+08:00'));
    const thisMorning = build({ order: { status: 'COMPLETED', paidAt: new Date('2026-09-15T07:00:00+08:00') }, items: [] });
    await expect(thisMorning.svc.void(TENANT, 'o1', 'owner', 'BUSINESS_OWNER', 'x')).resolves.toBeDefined();
  });

  it('a refund asked to restock a product with no shelf row puts nothing back and books no stock value', async () => {
    const { svc, tx, events } = build({
      order: { status: 'COMPLETED' },
      items: [{
        id: 'it1', orderId: 'o1', productId: 'p-latte', quantity: 2, refundedQty: 0, lineTotal: 200, costPrice: 60,
        order: { status: 'COMPLETED', branchId: 'b1', orderNumber: 'ORD-1' },
        product: { id: 'p-latte', costPrice: 60, name: 'Latte', inventoryMode: 'UNIT_BASED' },
      }],
      inventory: null,
    });
    await svc.refundItem({ tenantId: TENANT, orderId: 'o1', orderItemId: 'it1', quantity: 1, reason: 'Spilled', refundMethod: 'CASH', restock: true, refundedById: 'owner', callerRole: 'BUSINESS_OWNER' });
    expect(tx.orderItemRefund.create.mock.calls[0][0].data.restocked).toBe(false);
    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
    expect(events.find((e) => e.type === 'VOID').payload).toMatchObject({ restocked: false, restockedCogsTotal: 0 });
  });

  it('refunding the last thing the kitchen was still making ends the order\'s wait; anything left keeps it', async () => {
    const line = {
      id: 'it1', orderId: 'o1', productId: 'p-latte', quantity: 1, refundedQty: 0, lineTotal: 150, costPrice: 60,
      order: { status: 'PAID', branchId: 'b1', orderNumber: 'ORD-1' },
      product: { id: 'p-latte', costPrice: 60, name: 'Latte', inventoryMode: 'RECIPE_BASED' },
    };
    const last = build({ order: { status: 'PAID' }, items: [line], waiting: [{ quantity: 1, refundedQty: 1 }] });
    await last.svc.refundItem({ tenantId: TENANT, orderId: 'o1', orderItemId: 'it1', quantity: 1, reason: 'Changed mind', refundMethod: 'CASH', restock: false, refundedById: 'owner', callerRole: 'BUSINESS_OWNER' });
    expect(last.tx.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'o1', status: 'PAID' }, data: expect.objectContaining({ status: 'COMPLETED' }) }));

    const more = build({ order: { status: 'PAID' }, items: [line], waiting: [{ quantity: 1, refundedQty: 1 }, { quantity: 2, refundedQty: 0 }] });
    await more.svc.refundItem({ tenantId: TENANT, orderId: 'o1', orderItemId: 'it1', quantity: 1, reason: 'Changed mind', refundMethod: 'CASH', restock: false, refundedById: 'owner', callerRole: 'BUSINESS_OWNER' });
    expect(more.tx.order.updateMany).not.toHaveBeenCalled();
  });
});
