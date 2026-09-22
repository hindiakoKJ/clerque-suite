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

  /*
    A weekly count from a kitchen or bar screen is RECORDED when it is sent:
    the shelf was counted, the books were not changed. It anchors nothing --
    "Never counted" stays true of the books -- but the report can say when
    the shelf was last counted. Once the owner adjusts the books from it, it
    anchors at the moment it was counted, not at the post days later.
  */
  describe('weekly counts from the kitchen and bar screens', () => {
    /** Answers the posted and the recorded query apart, the way the database would. */
    function withLines(h: ReturnType<typeof build>, posted: any[], recorded: any[]) {
      h.prisma.cycleCountLine.findMany.mockImplementation(async ({ where }: any) =>
        (where.count.status === 'RECORDED' ? recorded : posted));
      return h.svc.variance(TENANT, BRANCH, '2026-09-01', '2026-09-30');
    }
    const at = (iso: string) => `[BY:Joy] [AT:${new Date(iso).toISOString()}] [ST:s-kitchen]`;

    it('a recorded count does not anchor the variance, but says when the shelf was last counted', async () => {
      const h = build({ onHand: [{ rawMaterialId: 'milk', quantity: 3_000 }] });
      const rows = await withLines(h, [], [
        { rawMaterialId: 'milk', notes: at('2026-09-21T13:12:00Z'), count: { createdAt: new Date('2026-09-21T13:00:00Z') } },
      ]);
      const milk = row(rows, 'milk');
      expect(milk.countedAt).toBeNull();
      expect(milk.countNumber).toBeNull();
      expect(milk.cannotTell).toMatch(/^Never counted/);
      expect(milk.lastCountedOn).toBe('2026-09-21T13:12:00.000Z');
      expect(milk.lastCountedStatus).toBe('RECORDED');
      expect(row(rows, 'sugar').lastCountedOn).toBeNull();
      expect(h.prisma.cycleCountLine.findMany.mock.calls.map((c: any[]) => c[0].where.count.status)).toEqual(['POSTED', 'RECORDED']);
    });

    it('a posted count stays the anchor; a newer recorded count only moves lastCountedOn', async () => {
      const h = build({ onHand: [{ rawMaterialId: 'milk', quantity: 3_000 }] });
      const rows = await withLines(h,
        [{ rawMaterialId: 'milk', countedQty: 3_000, notes: null, count: { postedAt: new Date('2026-09-08T02:00:00Z'), countNumber: 'CC-2026-000004' } }],
        [{ rawMaterialId: 'milk', notes: at('2026-09-21T13:12:00Z'), count: { createdAt: new Date('2026-09-21T13:00:00Z') } }],
      );
      const milk = row(rows, 'milk');
      expect(milk.countedAt).toBe('2026-09-08T02:00:00.000Z');
      expect(milk.countNumber).toBe('CC-2026-000004');
      expect([milk.lastCountedOn, milk.lastCountedStatus]).toEqual(['2026-09-21T13:12:00.000Z', 'RECORDED']);
    });

    it('a weekly count adjusted days later anchors when it was counted, so the sales in between are not read as missing', async () => {
      // Counted 10,000 on the 1st, posted on the 4th. 30 lattes (6,000 ml) sold on the 2nd; 4,000 on the shelf now.
      const h = build({
        sold:   [{ productId: 'latte', quantity: 30, at: '2026-09-02T02:00:00Z' }],
        boms:   [{ productId: 'latte', rawMaterialId: 'milk', quantity: 200 }],
        onHand: [{ rawMaterialId: 'milk', quantity: 4_000 }],
      });
      const rows = await withLines(h, [{
        rawMaterialId: 'milk', countedQty: 10_000, notes: at('2026-09-01T02:00:00Z'),
        count: { postedAt: new Date('2026-09-04T02:00:00Z'), countNumber: 'CC-2026-000007' },
      }], []);
      const milk = row(rows, 'milk');
      expect(milk.countedAt).toBe('2026-09-01T02:00:00.000Z');
      expect(milk.expectedConsumption).toBe(6_000);
      expect(milk.deltaQty).toBe(0);
      expect([milk.lastCountedOn, milk.lastCountedStatus]).toEqual(['2026-09-01T02:00:00.000Z', 'POSTED']);
    });

    it('of two posted weekly lines, the one counted later wins, whatever order they were posted in', async () => {
      const h = build({ onHand: [{ rawMaterialId: 'milk', quantity: 2_900 }] });
      const rows = await withLines(h, [
        // Posted first: the bar's newer count.
        { rawMaterialId: 'milk', countedQty: 2_900, notes: at('2026-09-22T13:00:00Z'), count: { postedAt: new Date('2026-09-22T14:00:00Z'), countNumber: 'CC-2026-000009' } },
        // Posted after it: the kitchen's older record, whose milk line the post left out.
        { rawMaterialId: 'milk', countedQty: 2_800, notes: at('2026-09-21T13:00:00Z'), count: { postedAt: new Date('2026-09-23T02:00:00Z'), countNumber: 'CC-2026-000008' } },
      ], []);
      expect(row(rows, 'milk').countNumber).toBe('CC-2026-000009');
      expect(row(rows, 'milk').startingQty).toBe(2_900);
    });
  });
});
