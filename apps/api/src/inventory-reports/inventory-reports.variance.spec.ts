import { InventoryReportsService } from './inventory-reports.service';

/**
 * A shrinkage report that can find shrinkage.
 *
 * The old arithmetic inferred the starting quantity from the ending one:
 *
 *   starting    = ending - receipts + expected use
 *   expectedEnd = starting + receipts - expected use
 *
 * Substitute the first into the second and everything cancels: expectedEnd is
 * ending, and the difference between them is zero. Every ingredient read no
 * variance, every day, however much walked out of the stockroom -- and the
 * report's existence was itself the damage, because an owner looking at a wall
 * of zeroes believes somebody is watching.
 *
 * There is no movement log for ingredients, so the only quantity this app ever
 * KNOWS is a posted physical count. That is the anchor now. An ingredient
 * nobody has counted says so instead of printing a confident zero.
 */
describe('Stock variance, measured from the last real count', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';

  const MILK  = { id: 'milk',  name: 'Fresh Milk', unit: 'ml' };
  const SUGAR = { id: 'sugar', name: 'White Sugar', unit: 'g' };

  function build(opts: {
    counts?: Array<{ rawMaterialId: string; countedQty: number; postedAt: string; countNumber: string }>;
    lots?: Array<{ rawMaterialId: string; qtyReceived: number; receivedAt: string }>;
    sold?: Array<{ productId: string; quantity: number; refundedQty?: number; at: string }>;
    boms?: Array<{ productId: string; rawMaterialId: string; quantity: number }>;
    onHand?: Array<{ rawMaterialId: string; quantity: number }>;
  } = {}) {
    const prisma: any = {
      rawMaterial: { findMany: jest.fn().mockResolvedValue([MILK, SUGAR]) },
      cycleCountLine: {
        findMany: jest.fn().mockResolvedValue(
          (opts.counts ?? []).map((c) => ({
            rawMaterialId: c.rawMaterialId,
            countedQty: c.countedQty,
            count: { postedAt: new Date(c.postedAt), countNumber: c.countNumber },
          })),
        ),
      },
      rawMaterialInventory: {
        findMany: jest.fn().mockResolvedValue((opts.onHand ?? []).map((r) => ({ ...r }))),
      },
      rawMaterialLot: {
        findMany: jest.fn().mockResolvedValue((opts.lots ?? []).map((l) => ({ ...l, receivedAt: new Date(l.receivedAt) }))),
      },
      orderItem: {
        // Nothing here waits at a screen, so the query for held stock finds nothing
        // (inventory-reports.waiting-tickets.spec.ts covers the tickets that do).
        findMany: jest.fn(({ where }: any) => Promise.resolve(where?.usageOnReady ? [] : (opts.sold ?? []).map((o) => ({
          productId: o.productId, quantity: o.quantity, refundedQty: o.refundedQty ?? 0,
          order: { createdAt: new Date(o.at) },
        })))),
      },
      bomItem: { findMany: jest.fn().mockResolvedValue(opts.boms ?? []) },
    };
    return { svc: new InventoryReportsService(prisma) as any, prisma };
  }

  const row = (rows: any[], id: string) => rows.find((r) => r.rawMaterialId === id);

  it('finds the milk that went missing', async () => {
    // Counted 10,000 ml on the 1st. Took in 4,000. The recipes say 6,000 was
    // poured. So 8,000 should be on the shelf, and 7,250 is.
    const rows = await build({
      counts:  [{ rawMaterialId: 'milk', countedQty: 10_000, postedAt: '2026-09-01T02:00:00Z', countNumber: 'CC-2026-000001' }],
      lots:    [{ rawMaterialId: 'milk', qtyReceived: 4_000, receivedAt: '2026-09-03T02:00:00Z' }],
      sold:    [{ productId: 'latte', quantity: 30, at: '2026-09-04T02:00:00Z' }],
      boms:    [{ productId: 'latte', rawMaterialId: 'milk', quantity: 200 }],
      onHand:  [{ rawMaterialId: 'milk', quantity: 7_250 }],
    }).svc.variance(TENANT, BRANCH, '2026-09-01', '2026-09-30');

    const milk = row(rows, 'milk');
    expect(milk.startingQty).toBe(10_000);
    expect(milk.receiptsQty).toBe(4_000);
    expect(milk.expectedConsumption).toBe(6_000);
    expect(milk.expectedEndingQty).toBe(8_000);
    expect(milk.actualEndingQty).toBe(7_250);
    expect(milk.deltaQty).toBe(-750);
    expect(milk.countNumber).toBe('CC-2026-000001');
  });

  it('does not report a confident zero for an ingredient nobody has counted', async () => {
    const rows = await build({
      onHand: [{ rawMaterialId: 'sugar', quantity: 3_000 }],
    }).svc.variance(TENANT, BRANCH, '2026-09-01', '2026-09-30');

    const sugar = row(rows, 'sugar');
    expect(sugar.deltaQty).toBeNull();
    expect(sugar.startingQty).toBeNull();
    expect(sugar.countedAt).toBeNull();
    expect(sugar.cannotTell).toMatch(/count/i);
    expect(sugar.actualEndingQty).toBe(3_000);   // what IS known is still shown
  });

  it('measures each ingredient from its own count, not from one shared date', async () => {
    // Milk counted on the 10th; the delivery on the 3rd is before that count
    // and is already inside the counted figure, so counting it again would
    // invent stock that was never received twice.
    const rows = await build({
      counts: [{ rawMaterialId: 'milk', countedQty: 5_000, postedAt: '2026-09-10T02:00:00Z', countNumber: 'CC-2026-000002' }],
      lots: [
        { rawMaterialId: 'milk', qtyReceived: 4_000, receivedAt: '2026-09-03T02:00:00Z' },
        { rawMaterialId: 'milk', qtyReceived: 1_000, receivedAt: '2026-09-12T02:00:00Z' },
      ],
      sold: [
        { productId: 'latte', quantity: 10, at: '2026-09-05T02:00:00Z' },   // before the count
        { productId: 'latte', quantity: 5,  at: '2026-09-11T02:00:00Z' },   // after it
      ],
      boms:   [{ productId: 'latte', rawMaterialId: 'milk', quantity: 200 }],
      onHand: [{ rawMaterialId: 'milk', quantity: 5_000 }],
    }).svc.variance(TENANT, BRANCH, '2026-09-01', '2026-09-30');

    const milk = row(rows, 'milk');
    expect(milk.receiptsQty).toBe(1_000);          // only the delivery after the count
    expect(milk.expectedConsumption).toBe(1_000);  // only the 5 lattes after it
    expect(milk.expectedEndingQty).toBe(5_000);
    expect(milk.deltaQty).toBe(0);
  });

  it('does not charge a refunded drink to the stockroom', async () => {
    const rows = await build({
      counts: [{ rawMaterialId: 'milk', countedQty: 2_000, postedAt: '2026-09-01T02:00:00Z', countNumber: 'CC-2026-000003' }],
      sold:   [{ productId: 'latte', quantity: 5, refundedQty: 2, at: '2026-09-04T02:00:00Z' }],
      boms:   [{ productId: 'latte', rawMaterialId: 'milk', quantity: 200 }],
      onHand: [{ rawMaterialId: 'milk', quantity: 1_400 }],
    }).svc.variance(TENANT, BRANCH, '2026-09-01', '2026-09-30');

    const milk = row(rows, 'milk');
    expect(milk.expectedConsumption).toBe(600);   // 3 poured, not 5
    expect(milk.deltaQty).toBe(0);
  });

  it('takes the most recent count when an ingredient has several', async () => {
    const rows = await build({
      counts: [
        { rawMaterialId: 'milk', countedQty: 9_000, postedAt: '2026-09-01T02:00:00Z', countNumber: 'CC-2026-000001' },
        { rawMaterialId: 'milk', countedQty: 3_000, postedAt: '2026-09-08T02:00:00Z', countNumber: 'CC-2026-000004' },
      ],
      onHand: [{ rawMaterialId: 'milk', quantity: 3_000 }],
    }).svc.variance(TENANT, BRANCH, '2026-09-01', '2026-09-30');

    expect(row(rows, 'milk').startingQty).toBe(3_000);
    expect(row(rows, 'milk').countNumber).toBe('CC-2026-000004');
  });
});
