import { ConflictException } from '@nestjs/common';
import { OrdersService } from './orders.service';

/**
 * A whole till sale of a tagged part, through OrdersService.create: the tag
 * is sold with the order, its number and engine number land on the line for
 * the receipt, and the cost of sale is that piece's own cost -- not the
 * product's average, which mixes a good engine with a tired one.
 */
describe('OrdersService — selling a tagged part', () => {
  const TENANT = 't1';
  const BRANCH = 'br-1';
  const PRODUCT = 'p-engine';
  const TAG = { id: 'tag-1', serialNumber: '000457', productId: PRODUCT, branchId: BRANCH, status: 'IN_STOCK', acquiredCost: 45000,
    conditionNotes: JSON.stringify({ engineNumber: '2NZ-1234567' }), product: { sku: 'ENG-2NZ' } };

  function build(opts: { soldAlready?: boolean } = {}) {
    const tx: any = {
      order: {
        create: jest.fn(async ({ data }: any) => ({
          id: 'o-1', orderNumber: 'ORD-1',
          items: data.items.create.map((it: any, i: number) => ({ id: `oi-${i}`, productId: it.productId, variantId: null, notes: it.notes ?? null, modifiers: [] })),
        })),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
      },
      orderItem: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn() },
      serializedUnit: { updateMany: jest.fn().mockResolvedValue({ count: opts.soldAlready ? 0 : 1 }) },
      bomItem: { findMany: jest.fn().mockResolvedValue([]) },
      modifierOption: { findMany: jest.fn().mockResolvedValue([]) },
      rawMaterialInventory: { updateMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      rawMaterialLot: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      accountingEvent: { create: jest.fn() },
      orderPayment: { createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      orderDiscount: { createMany: jest.fn() },
      // Two engines of this model on the shelf: average 40,000, but this one cost 45,000.
      inventoryItem: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue({ id: 'inv-1', quantity: 2, avgCost: 40000 }),
        update: jest.fn(), updateMany: jest.fn(),
      },
      inventoryLog: { create: jest.fn() },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ inventoryMode: 'UNIT_BASED', costingMethod: 'WAC', taxStatus: 'NON_VAT', planCode: 'CLERQUE', valuationMethod: 'WAC', businessType: 'RETAIL' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      product: { findMany: jest.fn().mockResolvedValue([{ id: PRODUCT, name: 'Engine 2NZ', inventoryMode: 'UNIT_BASED', costPrice: 40000 }]) },
      $executeRaw: jest.fn().mockResolvedValue(0),
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const prisma: any = {
      serializedUnit: {
        findFirst: jest.fn().mockResolvedValue({ id: TAG.id }),
        findMany: jest.fn().mockResolvedValue([TAG]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      document: { groupBy: jest.fn().mockResolvedValue([{ entityId: TAG.id, _count: { _all: 2 } }]) },
      shift: { count: jest.fn().mockResolvedValue(1), findFirst: jest.fn().mockResolvedValue({ cashierId: null, closedAt: null }) },
      order: { findFirst: jest.fn().mockResolvedValue(null) },
      tenant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ taxStatus: 'NON_VAT', planCode: 'CLERQUE', isPtuHolder: false }),
        findUnique: jest.fn().mockResolvedValue({ taxStatus: 'NON_VAT', planCode: 'CLERQUE', businessType: 'RETAIL' }),
      },
      branch: { count: jest.fn().mockResolvedValue(1), findFirst: jest.fn().mockResolvedValue({ id: BRANCH }) },
      user: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([]) },
      modifierGroup: { count: jest.fn().mockResolvedValue(1) },
      modifierOption: { count: jest.fn().mockResolvedValue(1) },
      product: { findMany: jest.fn(({ where }: any) => Promise.resolve(where?.isRxRequired ? [] : [{ id: PRODUCT, tenantId: TENANT, name: 'Engine 2NZ', drugClass: null }])) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const svc = new OrdersService(
      prisma,
      { assertDateIsOpen: jest.fn() } as any,
      { assertVatConsistency: jest.fn() } as any,
      { log: jest.fn(), logVoid: jest.fn() } as any,
      { next: jest.fn().mockResolvedValue('ORD-1') } as any,
      { accrue: jest.fn() } as any,
      {} as any,
      {} as any,
    );
    return { svc, tx };
  }

  const payload = (over: any = {}) => ({
    clientUuid: 'u-' + Math.random(),
    shiftId: 'shift-1',
    branchId: BRANCH,
    items: [{
      productId: PRODUCT, productName: 'Engine 2NZ', unitPrice: 60000, quantity: 1,
      discountAmount: 0, vatAmount: 0, lineTotal: 60000, isVatable: false, modifiers: [], serializedUnitId: TAG.id,
    }],
    payments: [{ method: 'CASH', amount: 60000 }],
    discounts: [], subtotal: 60000, discountAmount: 0, vatAmount: 0, totalAmount: 60000,
    isPwdScDiscount: false, createdAt: new Date().toISOString(),
    customerName: 'Juan Cruz', customerAddress: 'Banawe St, Quezon City',
    ...over,
  });

  const cogsLine = (tx: any) => (tx.accountingEvent.create as jest.Mock).mock.calls.find((c) => c[0]?.data?.type === 'COGS')?.[0].data.payload.lines[0];

  it('sells the tag with the order, prints its numbers, and books that engine\'s own cost', async () => {
    const { svc, tx } = build();
    await svc.create(TENANT, 'cashier-1', payload() as never);

    expect(tx.serializedUnit.updateMany).toHaveBeenCalledWith({
      where: { id: TAG.id, tenantId: TENANT, status: 'IN_STOCK', acquiredCost: { not: null } },
      data: { status: 'SOLD', soldOrderId: 'o-1' },
    });
    const line = tx.order.create.mock.calls[0][0].data.items.create[0];
    expect(line.notes).toBe('Tag 000457 · Engine No. 2NZ-1234567');
    expect(cogsLine(tx)).toMatchObject({ unitCost: 45000, costMethod: 'SPECIFIC', lineKey: `tag:${TAG.id}` });
    // The order line's cost of record is the same 45,000, not the 40,000 average.
    expect(tx.orderItem.update).toHaveBeenCalledWith({ where: { id: 'oi-0' }, data: { costPrice: expect.anything() } });
    expect(Number(tx.orderItem.update.mock.calls[0][0].data.costPrice)).toBe(45000);
  });

  it('a second phone selling the same engine live saves nothing', async () => {
    const { svc } = build({ soldAlready: true });
    await expect(svc.create(TENANT, 'cashier-1', payload() as never)).rejects.toThrow(ConflictException);
  });

  it('an engine sale without the buyer\'s name and address is refused before anything is saved', async () => {
    const { svc, tx } = build();
    await expect(svc.create(TENANT, 'cashier-1', payload({ customerName: undefined }) as never)).rejects.toThrow(/name and address/);
    expect(tx.order.create).not.toHaveBeenCalled();
  });
});
