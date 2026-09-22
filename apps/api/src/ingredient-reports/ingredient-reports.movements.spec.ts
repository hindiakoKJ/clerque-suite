import { IngredientReportsService } from './ingredient-reports.service';

/**
 * One ingredient's page: what is on the shelf, and everything that moved it.
 *
 * The page used to show deliveries and the sales of products whose OWN recipe
 * named the ingredient, and nothing else. A syrup used only through add-ons
 * read "consumed 0", the 100 ml just written off was not on the timeline, the
 * 760 g a batch took was missing, and "On hand" was the lots' leftovers added
 * up (1,969 ml) while the shelf held 1,829 ml.
 */
describe('IngredientReportsService — one ingredient\'s movements', () => {
  const TENANT = 't1';
  const AGAVE  = 'rm-agave';
  const at = (s: string) => new Date(s);

  function build(opts: { branchId?: string } = {}) {
    const calls: Record<string, any[]> = { lots: [], events: [], orders: [] };
    const prisma: any = {
      rawMaterial: {
        findFirst: jest.fn().mockResolvedValue({ id: AGAVE, name: 'Agave Syrup', unit: 'ml', costPrice: 1.5 }),
      },
      rawMaterialLot: {
        findMany: jest.fn((args: any) => {
          calls.lots.push(args);
          return Promise.resolve([
            // A delivery.
            { id: 'lot-1', qtyReceived: 2000, qtyRemaining: 1969, unitCost: 1.4, receivedAt: at('2026-09-10T06:00:00+08:00'),
              referenceNumber: 'SI-10442', paymentMethod: 'CASH', branchId: 'b1' },
            // The write-off's marker: negative, no reference (the owner typed none).
            { id: 'lot-2', qtyReceived: -100, qtyRemaining: 0, unitCost: 1.486, receivedAt: at('2026-09-20T10:00:00+08:00'),
              referenceNumber: null, paymentMethod: 'OWNER_FUNDED', branchId: 'b1' },
          ]);
        }),
      },
      accountingEvent: {
        findMany: jest.fn((args: any) => {
          calls.events.push(args);
          return Promise.resolve([
            // The count's correction, last night.
            { id: 'ev-count', createdAt: at('2026-09-21T20:00:00+08:00'), payload: {
              kind: 'RAW_MATERIAL_RECEIPT', rawMaterialId: AGAVE, adjustmentType: 'COUNT_CORRECTION',
              quantity: -20, unitCost: 1.486, referenceNumber: 'CC-0003', branchId: 'b1', reason: 'Physical count CC-0003',
            } },
            // The write-off's books entry, stamped five seconds after its lot.
            { id: 'ev-wo', createdAt: at('2026-09-20T10:00:05+08:00'), payload: {
              kind: 'RAW_MATERIAL_RECEIPT', rawMaterialId: AGAVE, adjustmentType: 'WRITE_OFF',
              quantity: -100, unitCost: 1.486, totalValue: -148.6, reasonCode: 'DAMAGE', reason: 'DAMAGE',
              referenceNumber: null, branchId: 'b1',
            } },
            // A batch of teriyaki that took 300 ml of agave (and some sugar).
            { id: 'ev-batch', createdAt: at('2026-09-19T09:30:00+08:00'), payload: {
              kind: 'SUB_RECIPE_BATCH', rawMaterialId: 'rm-teriyaki', rawMaterialName: 'Teriyaki Sauce',
              batches: 2, madeAt: '2026-09-19T09:00:00+08:00', stationName: 'Kitchen', branchId: 'b1',
              consumed: [
                { rawMaterialId: AGAVE,      name: 'Agave Syrup', unit: 'ml', quantity: 300, unitCost: 1.486 },
                { rawMaterialId: 'rm-sugar', name: 'Sugar',       unit: 'g',  quantity: 760, unitCost: 0.09 },
              ],
            } },
          ]);
        }),
      },
      order: {
        findMany: jest.fn((args: any) => {
          calls.orders.push(args);
          return Promise.resolve([
            // Two lattes with an agave add-on: the latte's own recipe has no agave.
            { id: 'o1', orderNumber: 'ORD-2026-000088', paidAt: at('2026-09-18T12:00:00+08:00'), completedAt: null, branchId: 'b1',
              items: [{
                id: 'oi1', productId: 'p-latte', variantId: null, quantity: 2, refundedQty: 0,
                usageOnReady: false, usagePostedAt: null,
                modifiers: [{ modifierOptionId: 'opt-agave' }],
                product: { name: 'Latte' },
              }] },
          ]);
        }),
      },
      bomItem:        { findMany: jest.fn().mockResolvedValue([]) },
      variantBomItem: { findMany: jest.fn().mockResolvedValue([]) },
      modifierOption: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'opt-agave', recipeMultiplier: null,
          ingredients: [{ rawMaterialId: AGAVE, quantity: 15, rawMaterial: { name: 'Agave Syrup', unit: 'ml', costPrice: 1.5, lotsTracked: false } }],
        }]),
      },
      rawMaterialInventory: {
        findMany: jest.fn().mockResolvedValue([{ quantity: 1829 }]),
      },
    };
    return { svc: new IngredientReportsService(prisma), prisma, calls, branchId: opts.branchId };
  }

  it('puts the write-off, the prep batch, the count and the add-on sale on the timeline', async () => {
    const { svc } = build();
    const r = await svc.getMovements(TENANT, AGAVE, { from: '2026-09-01', to: '2026-09-30', branchId: 'b1' });

    const byKind = Object.fromEntries(r.movements.map((m) => [m.kind, m]));
    expect(r.movements.map((m) => m.kind)).toEqual(['COUNT', 'WRITE_OFF', 'PREP', 'CONSUMPTION', 'RECEIPT']);   // newest first

    expect(byKind.RECEIPT).toMatchObject({ quantity: 2000, totalValue: 2800, reference: 'SI-10442' });

    // The 100 ml written off, in plain words, with what it was worth.
    expect(byKind.WRITE_OFF).toMatchObject({ quantity: -100, totalValue: -148.6, reason: 'Dropped, spilled or spoiled' });

    // The batch: only this ingredient's share, priced as the batch recorded it.
    expect(byKind.PREP).toMatchObject({ quantity: -300, totalValue: -445.8, reference: 'Teriyaki Sauce (2 batches) · Kitchen' });
    expect(byKind.PREP.occurredAt).toBe(new Date('2026-09-19T09:00:00+08:00').toISOString());   // when it was made, not recorded

    // The count: signed, with the count's number.
    expect(byKind.COUNT).toMatchObject({ quantity: -20, reference: 'CC-0003', reason: 'Physical count' });

    // Two lattes × 15 ml through the add-on, which the product's own recipe never named.
    expect(byKind.CONSUMPTION).toMatchObject({ quantity: -30, totalValue: -45, orderNumber: 'ORD-2026-000088', reference: '2× Latte' });
  });

  it('asks for whole Manila days, the last day included', async () => {
    const { svc, calls } = build();
    await svc.getMovements(TENANT, AGAVE, { from: '2026-09-01', to: '2026-09-30' });

    const window = calls.lots[0].where.receivedAt;
    expect(window.gte.toISOString()).toBe('2026-08-31T16:00:00.000Z');   // 00:00 on the 1st, Manila
    expect(window.lte.toISOString()).toBe('2026-09-30T15:59:59.999Z');   // 23:59:59.999 on the 30th, Manila
    expect(calls.orders[0].where.paidAt).toEqual(window);
    // The books are read from the start of the window with no upper bound: a
    // write-off's entry can land after its lot, and a batch after it was made.
    expect(calls.events[0].where.createdAt).toEqual({ gte: window.gte });
  });

  it('leaves out a batch made before the window even when it was recorded inside it', async () => {
    const { svc } = build();
    const r = await svc.getMovements(TENANT, AGAVE, { from: '2026-09-19T02:00:00.000Z', to: '2026-09-30' });
    // Made 01:00Z on the 19th, recorded 01:30Z: before the window's start.
    expect(r.movements.find((m) => m.kind === 'PREP')).toBeUndefined();
  });

  it('refuses a date that is not a date instead of asking the database for it', async () => {
    const { svc } = build();
    await expect(svc.getMovements(TENANT, AGAVE, { from: 'last tuesday' })).rejects.toThrow('not valid dates');
  });

  it('says what is on the shelf from the stock book, not the lots\' leftovers', async () => {
    const { svc, prisma } = build();
    const r = await svc.getLots(TENANT, AGAVE, 'b1');
    expect(r.onHand).toEqual({ quantity: 1829, value: 1829 * 1.5 });
    expect(prisma.rawMaterialInventory.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: TENANT, rawMaterialId: AGAVE, branchId: 'b1' });
    // The lots themselves stay: purchases only, the write-off's marker left out.
    expect(prisma.rawMaterialLot.findMany.mock.calls[0][0].where.qtyReceived).toEqual({ gt: 0 });
  });
});
