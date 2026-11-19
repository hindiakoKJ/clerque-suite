import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

jest.mock('../ingredient-reports/daily-usage', () => {
  const actual = jest.requireActual('../ingredient-reports/daily-usage');
  return { ...actual, usedByDay: jest.fn() };
});
import { usedByDay } from '../ingredient-reports/daily-usage';
import { InventorySnapshotService } from './inventory-snapshot.service';

/**
 * The inventory snapshot's contract: one branch, one range, numbers as
 * strings (quantities 4 decimals, pesos 2), days YYYY-MM-DD and times in
 * Manila's offset, and nothing from another tenant.
 */
describe('InventorySnapshotService', () => {
  const T = 't1';
  const B = 'b1';
  const D = (n: number | string) => new Prisma.Decimal(n);
  const NOW = new Date('2026-11-30T15:59:59Z'); // 23:59:59 Manila

  function build(over: { branch?: unknown } = {}) {
    (usedByDay as jest.Mock).mockResolvedValue({
      days: [{ day: '2026-11-20', rows: [{ rawMaterialId: 'rm_1', sold: 11, wasted: 0.25 }] }],
    });
    const prisma: any = {
      branch: { findFirst: jest.fn().mockResolvedValue(over.branch === undefined ? { id: B, name: 'Main' } : over.branch) },
      tenant: { findUnique: jest.fn().mockResolvedValue({ id: T, name: 'slug-name', businessName: 'Business name', inventoryMode: 'RECIPE_BASED', valuationMethod: 'WAC' }) },
      rawMaterial: { findMany: jest.fn().mockResolvedValue([
        { id: 'rm_1', name: 'Fresh milk', unit: 'L', category: 'INGREDIENT', costPrice: D('92'), lowStockAlert: D('6'), lotsTracked: false },
      ]) },
      rawMaterialInventory: { findMany: jest.fn().mockResolvedValue([{ rawMaterialId: 'rm_1', quantity: D('12.5') }]) },
      inventoryItem: { findMany: jest.fn().mockResolvedValue([
        { id: 'ii1', productId: 'p_1', quantity: D('3'), avgCost: D('40.1234'), lowStockAlert: 2, lotsTracked: false,
          product: { name: 'Bottled water', sku: 'WTR-500', costPrice: null, category: { name: 'Drinks' }, unitOfMeasure: { abbreviation: 'pc' } } },
      ]) },
      rawMaterialLot: { findMany: jest.fn()
        // lots
        .mockResolvedValueOnce([{ rawMaterialId: 'rm_1', qtyReceived: D('24'), qtyRemaining: D('12.5'), unitCost: D('92'),
          receivedAt: new Date('2026-11-20T00:10:00Z'), expirationDate: new Date('2026-11-26T16:00:00Z'), referenceNumber: 'DR-1042' }])
        // movements: a receipt, a transfer in, a write-off marker
        .mockResolvedValueOnce([
          { id: 'l1', rawMaterialId: 'rm_1', qtyReceived: D('24'), unitCost: D('92'), receivedAt: new Date('2026-11-20T00:10:00Z'), referenceNumber: 'PO-0031' },
          { id: 'l2', rawMaterialId: 'rm_1', qtyReceived: D('2'), unitCost: D('92'), receivedAt: new Date('2026-11-21T00:00:00Z'), referenceNumber: 'ST-2026-000004' },
          { id: 'l3', rawMaterialId: 'rm_1', qtyReceived: D('-0.5'), unitCost: D('92'), receivedAt: new Date('2026-11-22T00:00:00Z'), referenceNumber: null },
        ]) },
      inventoryLot: { findMany: jest.fn().mockResolvedValue([]) },
      inventoryLog: { findMany: jest.fn().mockResolvedValue([
        { id: 'g1', productId: 'p_1', type: 'SALE_DEDUCTION', quantityBefore: D('5'), quantityAfter: D('3'), reason: null, note: null,
          referenceId: 'ord1', createdById: 'u_2', createdAt: new Date('2026-11-23T03:00:00Z') },
      ]) },
      stockTransfer: { findMany: jest.fn().mockResolvedValue([]) },
      cycleCount: { findMany: jest.fn()
        // posted counts (movements)
        .mockResolvedValueOnce([{ countNumber: 'CC-2026-000012', postedAt: new Date('2026-11-15T13:00:00Z'), postedById: 'u_1',
          lines: [{ id: 'cl1', rawMaterialId: 'rm_1', varianceQty: D('-0.5'), notes: null }] }])
        // counts section
        .mockResolvedValueOnce([{ id: 'cc_1', countNumber: 'CC-2026-000012', status: 'POSTED', createdAt: new Date('2026-11-15T10:00:00Z'),
          postedAt: new Date('2026-11-15T13:00:00Z'), startedById: 'u_3', postedById: 'u_1',
          lines: [{ rawMaterialId: 'rm_1', expectedQty: D('8'), countedQty: D('7.5') }] }]) },
      accountingEvent: { findMany: jest.fn().mockResolvedValue([]) },
      stockDayBalance: { findMany: jest.fn().mockResolvedValue([
        { rawMaterialId: 'rm_1', day: '2026-11-20', endingQty: D('12'), takenAt: new Date('2026-11-20T14:05:00Z') },
      ]) },
      purchaseOrder: { findMany: jest.fn().mockResolvedValue([
        { id: 'po_1', poNumber: 'PO-0032', expectedAt: new Date('2026-12-01T16:00:00Z'), vendor: { name: 'Dairy Co' },
          items: [{ rawMaterialId: 'rm_1', productId: null, qtyOrdered: D('24'), qtyReceived: D('0') }] },
      ]) },
      purchaseRequest: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { prisma, svc: new InventorySnapshotService(prisma) };
  }

  const ask = { branchId: B, from: '2026-11-01', to: '2026-11-30' };

  it('answers in the contract shape, numbers as strings with their decimals', async () => {
    const { svc } = build();
    const s = await svc.snapshot(T, ask, NOW);

    expect(s.tenant).toEqual({ id: T, name: 'Business name' });
    expect(s.branch).toEqual({ id: B, name: 'Main' });
    expect(s).toMatchObject({ from: '2026-11-01', to: '2026-11-30', asOf: '2026-11-30T23:59:59+08:00', valuationMethod: 'WAC', inventoryMode: 'RECIPE_BASED' });

    expect(s.items[0]).toEqual({
      kind: 'raw', id: 'rm_1', sku: null, name: 'Fresh milk', uom: 'L', qty: '12.5000',
      avgCost: '92.0000', lowStockAlert: '6.0000', category: 'INGREDIENT', lotsTracked: false,
    });
    expect(s.items[1]).toMatchObject({ kind: 'product', id: 'p_1', sku: 'WTR-500', qty: '3.0000', avgCost: '40.1234', lowStockAlert: '2.0000' });

    expect(s.lots[0]).toEqual({
      itemId: 'rm_1', kind: 'raw', qtyReceived: '24.0000', qtyRemaining: '12.5000', unitCost: '92.0000',
      receivedAt: '2026-11-20T08:10:00+08:00', expiresOn: '2026-11-27', reference: 'DR-1042',
    });

    expect(s.usage).toEqual([{ itemId: 'rm_1', day: '2026-11-20', expectedQty: '11.2500' }]);
    expect(s.dayBalances).toEqual([{ itemId: 'rm_1', day: '2026-11-20', endingQty: '12.0000', takenAt: '2026-11-20T22:05:00+08:00', by: null }]);
    expect(s.counts[0]).toMatchObject({
      id: 'cc_1', number: 'CC-2026-000012', status: 'POSTED', postedAt: '2026-11-15T21:00:00+08:00', startedBy: 'u_3', postedBy: 'u_1',
      lines: [{ itemId: 'rm_1', kind: 'raw', systemQty: '8.0000', countedQty: '7.5000' }],
    });
    expect(s.openPurchaseOrders).toEqual([{
      id: 'po_1', number: 'PO-0032', supplier: 'Dairy Co', expectedOn: '2026-12-02',
      lines: [{ itemId: 'rm_1', kind: 'raw', qtyOrdered: '24.0000', qtyReceived: '0.0000' }],
    }]);
    // No lead time is recorded anywhere, so none is invented.
    expect(s).not.toHaveProperty('suppliersLeadDays');
  });

  it('types every movement and signs its quantity, oldest first', async () => {
    const { svc } = build();
    const s = await svc.snapshot(T, ask, NOW);
    expect(s.movements.map((m) => [m.type, m.qty])).toEqual([
      ['COUNT', '-0.5000'],
      ['STOCK_IN', '24.0000'],
      ['TRANSFER_IN', '2.0000'],
      ['WRITE_OFF', '-0.5000'],
      ['SALE_DEDUCTION', '-2.0000'],
    ]);
    const sale = s.movements.find((m) => m.type === 'SALE_DEDUCTION')!;
    expect(sale).toMatchObject({ kind: 'product', itemId: 'p_1', qtyBefore: '5.0000', qtyAfter: '3.0000', by: 'u_2' });
    const receipt = s.movements.find((m) => m.type === 'STOCK_IN')!;
    expect(receipt).toMatchObject({ unitCost: '92.0000', at: '2026-11-20T08:10:00+08:00', reference: 'PO-0031', qtyBefore: null });
  });

  it('reads only the key tenant: every query is filtered by its tenant id', async () => {
    const { prisma, svc } = build();
    await svc.snapshot(T, ask, NOW);
    expect(prisma.branch.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: B, tenantId: T } }));
    for (const model of ['rawMaterial', 'rawMaterialInventory', 'inventoryItem', 'rawMaterialLot', 'inventoryLot', 'inventoryLog',
      'stockTransfer', 'cycleCount', 'stockDayBalance', 'purchaseOrder', 'purchaseRequest', 'accountingEvent']) {
      for (const call of prisma[model].findMany.mock.calls) expect(call[0].where.tenantId).toBe(T);
    }
    expect((usedByDay as jest.Mock).mock.calls[0][1]).toBe(T);
  });

  it("refuses another tenant's branch as not found, before reading anything else", async () => {
    const { prisma, svc } = build({ branch: null });
    await expect(svc.snapshot(T, ask, NOW)).rejects.toThrow(NotFoundException);
    expect(prisma.rawMaterial.findMany).not.toHaveBeenCalled();
  });

  it.each([
    [{ branchId: B, from: '2026-11-31', to: '2026-11-30' }],
    [{ branchId: B, from: '2026-11-30', to: '2026-11-01' }],
    [{ branchId: B, from: '2026-01-01', to: '2026-12-31' }],
    [{ from: '2026-11-01', to: '2026-11-30' }],
  ])('refuses a bad question: %j', async (q) => {
    const { svc } = build();
    await expect(svc.snapshot(T, q, NOW)).rejects.toThrow(BadRequestException);
  });
});
