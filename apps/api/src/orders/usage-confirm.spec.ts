import { BadRequestException } from '@nestjs/common';
import { confirmLineUsage, returnLineUsage, manilaDay, usageOnReadyEnabled } from './usage-confirm';

/**
 * The ready tap: a waiting line's ingredients and cost, taken once, dated to
 * the sale; and the un-bump that gives exactly that back. The fake database
 * keeps real rows so the numbers can be read afterwards.
 */
describe('confirmLineUsage / returnLineUsage', () => {
  const TENANT = 't1';
  const SOLD = new Date('2026-09-15T09:00:00+08:00');
  const TAP = new Date('2026-09-15T09:06:00+08:00');

  function build(opts: {
    house?: 'RECIPE_BASED' | 'UNIT_BASED'; valuation?: 'WAC' | 'FIFO'; paused?: boolean;
    status?: string; quantity?: number; refundedQty?: number; usageOnReady?: boolean;
    lots?: Array<{ id: string; qtyRemaining: number; unitCost: number; receivedAt: string }>;
    avgCost?: number | null; costPrice?: number | null; closedPeriod?: boolean; milkRow?: number | null;
  } = {}) {
    const item: any = {
      id: 'li1', orderId: 'o1', productId: 'p-latte', variantId: null,
      quantity: opts.quantity ?? 2, refundedQty: opts.refundedQty ?? 0, costPrice: opts.costPrice ?? 55,
      usageOnReady: opts.usageOnReady ?? true, usagePostedAt: null, readyById: null, ingredientsDeductedAt: null,
      modifiers: [{ modifierOptionId: 'opt-oat' }],
      product: { inventoryMode: 'UNIT_BASED' },
      order: { branchId: 'b1', paidAt: SOLD, createdAt: SOLD, status: opts.status ?? 'PAID' },
    };
    const stock = new Map<string, number>([['rm-espresso', 100]]);
    if (opts.milkRow !== null) stock.set('rm-milk', opts.milkRow ?? 1000);
    stock.set('rm-oat', 500);
    const lots = (opts.lots ?? []).map((l) => ({ ...l, branchId: 'b1', rawMaterialId: 'rm-espresso' }));
    const events: any[] = [];

    const tx: any = {
      $queryRaw: jest.fn(async () => []),
      orderItem: {
        findFirst: jest.fn(async () => ({ ...item, modifiers: item.modifiers })),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (where.usageOnReady !== undefined && (item.usageOnReady !== where.usageOnReady || item.usagePostedAt !== null)) return { count: 0 };
          Object.assign(item, data);
          return { count: 1 };
        }),
        update: jest.fn(async ({ data }: any) => { Object.assign(item, data); return item; }),
      },
      tenant: {
        findUnique: jest.fn(async () => ({
          valuationMethod: opts.valuation ?? 'WAC', businessType: 'FNB',
          inventoryMode: opts.house ?? 'RECIPE_BASED',
          recipeDeductionPausedAt: opts.paused ? new Date() : null, overheadRatePerUnit: null,
        })),
      },
      bomItem: {
        findMany: jest.fn(async () => [
          { productId: 'p-latte', rawMaterialId: 'rm-espresso', quantity: 18, rawMaterial: { name: 'Espresso', unit: 'g', costPrice: 1.5, lotsTracked: false } },
          { productId: 'p-latte', rawMaterialId: 'rm-milk', quantity: 200, rawMaterial: { name: 'Milk', unit: 'ml', costPrice: 0.1, lotsTracked: false } },
        ]),
      },
      variantBomItem: { findMany: jest.fn(async () => []) },
      modifierOption: {
        findMany: jest.fn(async () => [{
          id: 'opt-oat', recipeMultiplier: null,
          ingredients: [
            { rawMaterialId: 'rm-milk', quantity: -200, rawMaterial: { name: 'Milk', unit: 'ml', costPrice: 0.1, lotsTracked: false } },
            { rawMaterialId: 'rm-oat', quantity: 180, rawMaterial: { name: 'Oat milk', unit: 'ml', costPrice: 0.2, lotsTracked: false } },
          ],
        }]),
      },
      rawMaterialInventory: {
        findUnique: jest.fn(async ({ where }: any) => {
          const q = stock.get(where.branchId_rawMaterialId.rawMaterialId);
          return q == null ? null : { quantity: q };
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (data.quantity?.decrement !== undefined) stock.set(where.rawMaterialId, (stock.get(where.rawMaterialId) ?? 0) - Number(data.quantity.decrement));
          else if (data.quantity?.increment !== undefined) stock.set(where.rawMaterialId, (stock.get(where.rawMaterialId) ?? 0) + Number(data.quantity.increment));
          else if (where.quantity?.lt !== undefined && (stock.get(where.rawMaterialId) ?? 0) < Number(where.quantity.lt)) stock.set(where.rawMaterialId, Number(data.quantity));
          return { count: 1 };
        }),
      },
      rawMaterialLot: {
        findMany: jest.fn(async ({ where }: any) => lots
          .filter((l) => l.rawMaterialId === where.rawMaterialId && l.qtyRemaining > 0)
          .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
          .map((l) => ({ id: l.id, qtyRemaining: l.qtyRemaining, unitCost: l.unitCost }))),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const lot = lots.find((l) => l.id === where.id)!;
          if (data.qtyRemaining.decrement !== undefined) {
            if (where.qtyRemaining && lot.qtyRemaining < Number(where.qtyRemaining.gte)) return { count: 0 };
            lot.qtyRemaining -= Number(data.qtyRemaining.decrement);
          } else {
            lot.qtyRemaining += Number(data.qtyRemaining.increment);
          }
          return { count: 1 };
        }),
      },
      inventoryItem: { findFirst: jest.fn(async () => (opts.avgCost != null ? { avgCost: opts.avgCost } : null)) },
      accountingEvent: {
        create: jest.fn(async ({ data }: any) => { const e = { id: `ev${events.length + 1}`, ...data }; events.unshift(e); return e; }),
        findMany: jest.fn(async ({ where }: any) => events.filter((e) => e.type === where.type)),
      },
      accountingPeriod: { findFirst: jest.fn(async () => (opts.closedPeriod ? { name: 'September 2026' } : null)) },
    };
    return { tx, item, stock, lots, events };
  }

  it('takes the recipe of what is left of the line, once, and books its cost dated to the sale', async () => {
    const { tx, item, stock, events } = build({ quantity: 3, refundedQty: 1 });
    await expect(confirmLineUsage(tx, TENANT, 'li1', { actorId: 'barista', trigger: 'READY', now: TAP })).resolves.toBe(true);

    // 2 units of an oat latte: espresso 36 g, oat 360 ml, and no dairy (the add-on cancels it).
    expect(stock.get('rm-espresso')).toBe(64);
    expect(stock.get('rm-oat')).toBe(140);
    expect(stock.get('rm-milk')).toBe(1000);
    expect(item).toMatchObject({ usagePostedAt: TAP, readyById: 'barista', ingredientsDeductedAt: TAP });

    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e).toMatchObject({ type: 'COGS', orderId: 'o1' });
    expect(e.payload).toMatchObject({ orderItemId: 'li1', completedAt: SOLD.toISOString(), trigger: 'READY', units: 2, stockTaken: true });
    // 18 g × ₱1.50 + 180 ml × ₱0.20 = ₱63 a unit.
    expect(e.payload.lines).toEqual([expect.objectContaining({ orderItemId: 'li1', quantity: 2, unitCost: 63, totalCost: 126, costMethod: 'RECIPE_WAC' })]);
    expect(Number(item.costPrice)).toBe(63);

    await expect(confirmLineUsage(tx, TENANT, 'li1', { actorId: 'other-tablet', trigger: 'READY', now: TAP })).resolves.toBe(false);
    expect(events).toHaveLength(1);
    expect(stock.get('rm-espresso')).toBe(64);
  });

  it('a voided order, or a line that never waited, takes nothing', async () => {
    const voided = build({ status: 'VOIDED' });
    await expect(confirmLineUsage(voided.tx, TENANT, 'li1', { actorId: null, trigger: 'NIGHTLY' })).resolves.toBe(false);
    expect(voided.events).toHaveLength(0);
    const usedAtSale = build({ usageOnReady: false });
    await expect(confirmLineUsage(usedAtSale.tx, TENANT, 'li1', { actorId: null, trigger: 'READY' })).resolves.toBe(false);
    expect(usedAtSale.stock.get('rm-espresso')).toBe(100);
  });

  it('refunded in full while it waited: counted as done, nothing used or booked', async () => {
    const { tx, item, stock, events } = build({ quantity: 1, refundedQty: 1 });
    await expect(confirmLineUsage(tx, TENANT, 'li1', { actorId: null, trigger: 'NIGHTLY', now: TAP })).resolves.toBe(true);
    expect(item.usagePostedAt).toBe(TAP);
    expect(events).toHaveLength(0);
    expect(stock.get('rm-espresso')).toBe(100);
  });

  it('while deduction is paused: the cost is booked, the stock is left for Recipe Catch-Up', async () => {
    const { tx, item, stock, events } = build({ paused: true });
    await confirmLineUsage(tx, TENANT, 'li1', { actorId: null, trigger: 'READY', now: TAP });
    expect(stock.get('rm-espresso')).toBe(100);
    expect(events[0].payload).toMatchObject({ stockTaken: false, ingredients: [] });
    expect(events[0].payload.lines[0].totalCost).toBe(126);
    expect(item.ingredientsDeductedAt).toBeNull();
  });

  it('a FIFO shop drains the oldest layers and costs from them, and writes down which', async () => {
    const { tx, lots, events } = build({
      valuation: 'FIFO', quantity: 1,
      lots: [
        { id: 'lot-new', qtyRemaining: 50, unitCost: 2, receivedAt: '2026-09-10' },
        { id: 'lot-old', qtyRemaining: 10, unitCost: 1, receivedAt: '2026-09-01' },
      ],
    });
    await confirmLineUsage(tx, TENANT, 'li1', { actorId: null, trigger: 'READY', now: TAP });
    expect(lots.find((l) => l.id === 'lot-old')!.qtyRemaining).toBe(0);
    expect(lots.find((l) => l.id === 'lot-new')!.qtyRemaining).toBe(42);
    const p = events[0].payload;
    expect(p.lots).toEqual([
      expect.objectContaining({ lotId: 'lot-old', qty: 10 }),
      expect.objectContaining({ lotId: 'lot-new', qty: 8 }),
    ]);
    // Espresso 10×₱1 + 8×₱2 = ₱26, oat 180 ml at ₱0.20 = ₱36 (no oat lots: running average).
    expect(p.lines[0]).toMatchObject({ unitCost: 62, costMethod: 'RECIPE_FIFO' });
  });

  it('a shop costing by product still takes the ingredients, and books the product cost', async () => {
    const withAverage = build({ house: 'UNIT_BASED', avgCost: 40, quantity: 1 });
    await confirmLineUsage(withAverage.tx, TENANT, 'li1', { actorId: null, trigger: 'READY', now: TAP });
    expect(withAverage.stock.get('rm-espresso')).toBe(82);
    expect(withAverage.events[0].payload.lines[0]).toMatchObject({ unitCost: 40, costMethod: 'WAC' });

    const snapshotOnly = build({ house: 'UNIT_BASED', avgCost: null, costPrice: 55, quantity: 1 });
    await confirmLineUsage(snapshotOnly.tx, TENANT, 'li1', { actorId: null, trigger: 'READY', now: TAP });
    expect(snapshotOnly.events[0].payload.lines[0]).toMatchObject({ unitCost: 55, costMethod: 'SNAPSHOT' });
  });

  it('never takes more than the shelf holds, and an ingredient with no stock row is still costed', async () => {
    const { tx, stock, events } = build({ quantity: 1, milkRow: null });
    stock.set('rm-espresso', 5);
    await confirmLineUsage(tx, TENANT, 'li1', { actorId: null, trigger: 'READY', now: TAP });
    expect(stock.get('rm-espresso')).toBe(0);
    expect(events[0].payload.ingredients).toEqual(expect.arrayContaining([{ rawMaterialId: 'rm-espresso', qty: 5 }]));
    expect(events[0].payload.lines[0].unitCost).toBe(63);
  });

  it('waits behind a sale being written before it touches stock, so a tap and a sale cannot deadlock', async () => {
    const { tx } = build({ quantity: 1 });
    await confirmLineUsage(tx, TENANT, 'li1', { actorId: null, trigger: 'READY', now: TAP });
    const sql = tx.$queryRaw.mock.calls[0][0].join('?');
    expect(sql).toContain('document_number_sequences');
    expect(sql).toContain('FOR UPDATE');
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.rawMaterialInventory.updateMany.mock.invocationCallOrder[0]);
  });

  it('records only what really came off when another write landed first, so an un-bump cannot make stock up', async () => {
    const { tx, stock, events } = build({ quantity: 1 });
    // A write-off of 95 g commits between the confirm's read (100 g) and its take (18 g).
    const take = tx.rawMaterialInventory.updateMany.getMockImplementation();
    tx.rawMaterialInventory.updateMany.mockImplementationOnce(async (args: any) => {
      stock.set('rm-espresso', stock.get('rm-espresso')! - 95);
      return take(args);
    });
    await confirmLineUsage(tx, TENANT, 'li1', { actorId: null, trigger: 'READY', now: TAP });
    expect(stock.get('rm-espresso')).toBe(0);
    expect(events[0].payload.ingredients).toEqual(expect.arrayContaining([{ rawMaterialId: 'rm-espresso', qty: 5 }]));

    await returnLineUsage(tx, TENANT, 'li1', TAP);
    expect(stock.get('rm-espresso')).toBe(5);
  });

  it('the kill switch takes the usual ways of writing "no"', () => {
    const before = process.env.USAGE_ON_READY;
    try {
      for (const v of ['off', 'OFF', 'false', '0', 'no', ' disabled ']) {
        process.env.USAGE_ON_READY = v;
        expect(usageOnReadyEnabled()).toBe(false);
      }
      for (const v of ['', 'on', 'true']) {
        process.env.USAGE_ON_READY = v;
        expect(usageOnReadyEnabled()).toBe(true);
      }
    } finally {
      if (before === undefined) delete process.env.USAGE_ON_READY; else process.env.USAGE_ON_READY = before;
    }
  });

  describe('un-bump', () => {
    it('gives back exactly what the tap took, with its own entry dated to the sale', async () => {
      const { tx, item, stock, lots, events } = build({
        valuation: 'FIFO', quantity: 1,
        lots: [{ id: 'lot-old', qtyRemaining: 30, unitCost: 1, receivedAt: '2026-09-01' }],
      });
      await confirmLineUsage(tx, TENANT, 'li1', { actorId: 'barista', trigger: 'READY', now: TAP });
      await expect(returnLineUsage(tx, TENANT, 'li1', new Date('2026-09-15T09:08:00+08:00'))).resolves.toBe(true);

      expect(stock.get('rm-espresso')).toBe(100);
      expect(stock.get('rm-oat')).toBe(500);
      expect(lots[0].qtyRemaining).toBe(30);
      expect(item).toMatchObject({ usagePostedAt: null, readyById: null, ingredientsDeductedAt: null });
      const back = events[0];
      expect(back).toMatchObject({ type: 'COGS_ADJUSTMENT' });
      expect(back.payload).toMatchObject({ kind: 'USAGE_RETURNED', orderItemId: 'li1', completedAt: SOLD.toISOString() });
      expect(back.payload.lines).toEqual(events[1].payload.lines);
    });

    it('refuses the next day, in a closed period, or after part of the line was refunded', async () => {
      const nextDay = build({ quantity: 1 });
      await confirmLineUsage(nextDay.tx, TENANT, 'li1', { actorId: null, trigger: 'READY', now: TAP });
      await expect(returnLineUsage(nextDay.tx, TENANT, 'li1', new Date('2026-09-16T00:30:00+08:00'))).rejects.toThrow(/earlier day/);
      expect(manilaDay(new Date('2026-09-15T23:59:00+08:00'))).toBe('2026-09-15');

      const closed = build({ quantity: 1, closedPeriod: true });
      await confirmLineUsage(closed.tx, TENANT, 'li1', { actorId: null, trigger: 'READY', now: TAP });
      await expect(returnLineUsage(closed.tx, TENANT, 'li1', TAP)).rejects.toThrow(/September 2026.*closed/);

      const refunded = build({ quantity: 2 });
      await confirmLineUsage(refunded.tx, TENANT, 'li1', { actorId: null, trigger: 'READY', now: TAP });
      refunded.item.refundedQty = 1;
      await expect(returnLineUsage(refunded.tx, TENANT, 'li1', TAP)).rejects.toThrow(BadRequestException);
      expect(refunded.stock.get('rm-espresso')).toBe(64);
    });

    it('refuses when the tap was made while paused and Recipe Catch-Up has since taken the ingredients', async () => {
      const { tx, item, stock } = build({ paused: true, quantity: 1 });
      await confirmLineUsage(tx, TENANT, 'li1', { actorId: null, trigger: 'READY', now: TAP });
      // Catch-Up replays the line after the pause is lifted.
      stock.set('rm-espresso', 82);
      item.ingredientsDeductedAt = TAP;
      await expect(returnLineUsage(tx, TENANT, 'li1', TAP)).rejects.toThrow(/Recipe Catch-Up/);
      expect(item.usagePostedAt).toBe(TAP);
      expect(stock.get('rm-espresso')).toBe(82);
    });

    it('a line that was never confirmed has nothing to give back', async () => {
      const { tx, events } = build();
      await expect(returnLineUsage(tx, TENANT, 'li1', TAP)).resolves.toBe(false);
      expect(events).toHaveLength(0);
    });
  });
});
