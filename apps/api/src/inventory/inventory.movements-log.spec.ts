import { InventoryService } from './inventory.service';

/**
 * What the Stock Movements log says about an ingredient event.
 *
 * Every ingredient event is written under one payload kind, and the log used
 * to call all of them "STOCK_IN": a write-off read "Stock In -100 ml" with no
 * reason (the write-off says why in `reason`, not `note`), the ingredients a
 * prep batch took showed "stock after 0" for a shelf holding 8 kg, and every
 * ingredient row said the system did it although the payload names the
 * person.
 */
describe('InventoryService.getAllMovements — ingredient events', () => {
  const TENANT = 't1';

  function build(events: Array<Record<string, unknown>>, users: Array<{ id: string; name: string }> = []) {
    const prisma: any = {
      inventoryLog:    { findMany: jest.fn().mockResolvedValue([]) },
      accountingEvent: {
        findMany: jest.fn().mockResolvedValue(
          events.map((payload, i) => ({ id: `ev${i + 1}`, createdAt: new Date(`2026-09-21T0${i + 1}:00:00.000Z`), payload })),
        ),
      },
      user: { findMany: jest.fn().mockResolvedValue(users) },
    };
    return { svc: new InventoryService(prisma, {} as any), prisma };
  }

  const list = (svc: InventoryService) => svc.getAllMovements(TENANT, { kind: 'RAW_MATERIAL', limit: 50 });

  it('a write-off is stock OUT with its reason, value and who did it — never "Stock In"', async () => {
    const { svc, prisma } = build([{
      kind: 'RAW_MATERIAL_RECEIPT', rawMaterialName: 'Agave Syrup', unit: 'ml',
      quantity: -100, totalValue: -148.6, branchId: 'b1',
      adjustmentType: 'WRITE_OFF', reasonCode: 'DAMAGE', reason: 'DAMAGE', writtenOffById: 'u-anne',
    }], [{ id: 'u-anne', name: 'Anne' }]);

    const [row] = await list(svc);
    expect(row).toMatchObject({
      type: 'WRITE_OFF', itemName: 'Agave Syrup', quantity: -100, totalValue: -148.6,
      reason: 'DAMAGE', createdById: 'u-anne', createdByName: 'Anne',
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith({ where: { id: { in: ['u-anne'] } }, select: { id: true, name: true } });
  });

  it('a delivery is still stock in, with its note as the reason', async () => {
    const { svc } = build([{
      kind: 'RAW_MATERIAL_RECEIPT', rawMaterialName: 'Fresh Milk', unit: 'ml',
      quantity: 2000, totalValue: 196, adjustmentType: 'RAW_MATERIAL_RECEIPT',
      note: 'Puregold', reason: 'Puregold', paymentMethod: 'CASH', referenceNumber: 'DR-1',
    }]);
    const [row] = await list(svc);
    expect(row).toMatchObject({ type: 'STOCK_IN', quantity: 2000, reason: 'Puregold', reference: 'DR-1', paymentMethod: 'CASH' });
  });

  it('a count correction and an opening count keep their own names; a bare minus is stock out', async () => {
    const { svc } = build([
      { kind: 'RAW_MATERIAL_RECEIPT', rawMaterialName: 'Sugar', unit: 'g', quantity: -50, adjustmentType: 'COUNT_CORRECTION', reason: 'Physical count CC-1' },
      { kind: 'RAW_MATERIAL_RECEIPT', rawMaterialName: 'Beans', unit: 'g', quantity: 5000, adjustmentType: 'OPENING_BALANCE', reason: 'Opening stock CC-1' },
      { kind: 'RAW_MATERIAL_RECEIPT', rawMaterialName: 'Cups', unit: 'pc', quantity: -3 },
    ]);
    const rows = await list(svc);
    expect(rows.map((r) => [r.itemName, r.type, r.reason])).toEqual([
      ['Cups',  'STOCK_OUT',        null],
      ['Beans', 'OPENING_BALANCE',  'Opening stock CC-1'],
      ['Sugar', 'COUNT_CORRECTION', 'Physical count CC-1'],
    ]);
  });

  it('the ingredients a batch took have no stock-after figure, not 0, and name the cook', async () => {
    const { svc, prisma } = build([{
      kind: 'SUB_RECIPE_BATCH', rawMaterialName: 'Teriyaki Sauce', unit: 'ml', quantity: 1400,
      quantityBefore: 0, quantityAfter: 1400, batches: 1, madeById: 'u-cook', branchId: 'b1',
      consumed: [{ rawMaterialId: 'rm-sugar', name: 'Sugar', unit: 'g', quantity: 760 }],
    }], [{ id: 'u-cook', name: 'Ramon' }]);

    const rows = await list(svc);
    const made = rows.find((r) => r.itemName === 'Teriyaki Sauce')!;
    const used = rows.find((r) => r.itemName === 'Sugar')!;
    expect(made).toMatchObject({ type: 'STOCK_IN', quantity: 1400, quantityAfter: 1400, createdByName: 'Ramon' });
    expect(used).toMatchObject({ type: 'STOCK_OUT', quantity: -760, quantityBefore: null, quantityAfter: null, createdByName: 'Ramon' });
    // One query for every name on the page, not one per row.
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
  });

  it('asks for no names when nothing names a person', async () => {
    const { svc, prisma } = build([{ kind: 'RAW_MATERIAL_RECEIPT', rawMaterialName: 'Ice', unit: 'kg', quantity: 10, adjustmentType: 'STOCK_IN' }]);
    const [row] = await list(svc);
    expect(row).toMatchObject({ type: 'STOCK_IN', createdById: null, createdByName: null });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
