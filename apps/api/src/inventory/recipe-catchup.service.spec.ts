import { BadRequestException } from '@nestjs/common';
import { RecipeCatchupService } from './recipe-catchup.service';

/**
 * Replaying ingredient usage for sale lines that never deducted.
 *
 * The shop went live on the POS on day one and finished its recipe book weeks
 * later. Every sale in between deducted nothing, because the product had no
 * BOM to walk at the time.
 *
 * `OrderItem.ingredientsDeductedAt` is the safety mechanism, and it lives on
 * the LINE: one order routinely mixes a latte (recipe entered, deducted) with
 * a slice of cake (no recipe yet, did not). These tests pin the reconstruction
 * math and — more importantly — the invariant that the set of lines deducted
 * is exactly the set of lines stamped, so nothing can be drained twice or
 * silently closed without being drained.
 */
describe('RecipeCatchupService', () => {
  const TENANT = 't1';
  const BRANCH = 'br-1';
  const USER = 'owner-1';

  const LATTE = 'p-latte';
  const CAKE = 'p-cake';        // never has a recipe
  const MILK = 'rm-milk';
  const OAT = 'rm-oat';
  const BEANS = 'rm-beans';

  const OPT_OAT = 'opt-oat';        // cancels 150ml milk, pours 150ml oat
  const OPT_GRANDE = 'opt-grande';  // x1.5 on the base recipe

  let decremented: Record<string, number>;
  let stampedItemIds: string[];
  let lotDrains: Array<{ id: string; to: number }>;
  let auditRows: any[];

  function build(opts: {
    items?: any[];
    boms?: any[];
    stock?: Record<string, number>;
    lots?: any[];
    prior?: any[];
    alreadyDeducted?: number;
    pausedAt?: Date | null;
  } = {}) {
    decremented = {};
    stampedItemIds = [];
    lotDrains = [];
    auditRows = [];

    const stock = opts.stock ?? { [MILK]: 10_000, [OAT]: 10_000, [BEANS]: 5_000 };
    const items = opts.items ?? [];
    const boms = opts.boms ?? [
      { productId: LATTE, rawMaterialId: MILK, quantity: 150 },
      { productId: LATTE, rawMaterialId: BEANS, quantity: 18 },
    ];

    const db: any = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ recipeDeductionPausedAt: opts.pausedAt ?? null }),
      },
      // The service always filters lines on ingredientsDeductedAt: null.
      orderItem: {
        findMany: jest.fn().mockResolvedValue(items),
        count: jest.fn().mockResolvedValue(opts.alreadyDeducted ?? 0),
        updateMany: jest.fn(({ where }: any) => {
          stampedItemIds.push(...where.id.in);
          return Promise.resolve({ count: where.id.in.length });
        }),
      },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: BRANCH }) },
      bomItem: { findMany: jest.fn().mockResolvedValue(boms) },
      modifierOption: {
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(
            [
              {
                id: OPT_OAT,
                recipeMultiplier: 1,
                ingredients: [
                  { rawMaterialId: MILK, quantity: -150 },
                  { rawMaterialId: OAT, quantity: 150 },
                ],
              },
              { id: OPT_GRANDE, recipeMultiplier: 1.5, ingredients: [] },
            ].filter((o) => where.id.in.includes(o.id)),
          ),
        ),
      },
      rawMaterial: {
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(
            [
              { id: MILK, name: 'Fresh Milk', unit: 'ml' },
              { id: OAT, name: 'Oat Milk', unit: 'ml' },
              { id: BEANS, name: 'Coffee Beans', unit: 'g' },
            ].filter((m) => where.id.in.includes(m.id)),
          ),
        ),
      },
      rawMaterialInventory: {
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(
            where.rawMaterialId.in.map((id: string) => ({ rawMaterialId: id, quantity: stock[id] ?? 0 })),
          ),
        ),
        updateMany: jest.fn(({ where, data }: any) => {
          if (data.quantity?.decrement !== undefined) {
            decremented[where.rawMaterialId] = Number(data.quantity.decrement);
          }
          return Promise.resolve({ count: 1 });
        }),
      },
      rawMaterialLot: {
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve((opts.lots ?? []).filter((l: any) => l.rawMaterialId === where.rawMaterialId)),
        ),
        update: jest.fn(({ where, data }: any) => {
          lotDrains.push({ id: where.id, to: Number(data.qtyRemaining) });
          return Promise.resolve({});
        }),
      },
      auditLog: { findMany: jest.fn().mockResolvedValue(opts.prior ?? []) },
      $executeRaw: jest.fn().mockResolvedValue(1),   // the advisory lock
    };
    db.$transaction = jest.fn(async (cb: any) => cb(db));

    const audit: any = { log: jest.fn((row: any) => { auditRows.push(row); return Promise.resolve(); }) };
    return { svc: new RecipeCatchupService(db, audit), db };
  }

  /** One sale line. */
  const line = (
    id: string,
    productId: string,
    quantity: number,
    optionIds: string[] = [],
    refundedQty = 0,
    orderId = 'o-' + id,
  ) => ({
    id,
    orderId,
    productId,
    productName: productId === CAKE ? 'Cake' : 'Latte',
    quantity,
    refundedQty,
    modifiers: optionIds.map((oid) => ({ modifierOptionId: oid })),
  });

  // Window starts after the marker shipped, so PREDATES_MARKER stays quiet
  // except in the test that deliberately probes it.
  const RANGE = { from: '2026-09-01T00:00:00.000Z', to: '2026-09-24T23:59:59.999Z' };
  const lineFor = (p: any, rmId: string) => p.lines.find((l: any) => l.rawMaterialId === rmId);
  const warnText = (p: any) => p.warnings.map((w: any) => w.message).join(' ');
  const codes = (p: any) => p.warnings.map((w: any) => w.code);

  // ───────────────────────────── preview ─────────────────────────────

  it('reconstructs usage from lines that never deducted', async () => {
    const { svc } = build({ items: [line('i-1', LATTE, 4)] });
    const p = await svc.preview(TENANT, RANGE);

    expect(lineFor(p, MILK).quantityUsed).toBe(600);   // 150ml x 4
    expect(lineFor(p, BEANS).quantityUsed).toBe(72);   // 18g x 4
    expect(lineFor(p, MILK).stockAfter).toBe(9_400);
    expect(p.lineCount).toBe(1);
    expect(p.orderCount).toBe(1);
  });

  it('scopes to the per-line marker, not to a product tick-list', async () => {
    const { svc, db } = build({ items: [line('i-1', LATTE, 1)], alreadyDeducted: 37 });
    const p = await svc.preview(TENANT, RANGE);

    expect(db.orderItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ ingredientsDeductedAt: null }) }),
    );
    expect(p.alreadyDeductedCount).toBe(37);
    expect(warnText(p)).toContain('already deducted at sale time and are excluded automatically');
  });

  it('nets a substitution so the cancelled ingredient is never drained', async () => {
    const { svc } = build({ items: [line('i-1', LATTE, 2, [OPT_OAT])] });
    const p = await svc.preview(TENANT, RANGE);

    expect(lineFor(p, MILK)).toBeUndefined();
    expect(lineFor(p, OAT).quantityUsed).toBe(300);
    expect(lineFor(p, BEANS).quantityUsed).toBe(36);
  });

  it('scales the base recipe by the size multiplier', async () => {
    const { svc } = build({ items: [line('i-1', LATTE, 2, [OPT_GRANDE])] });
    const p = await svc.preview(TENANT, RANGE);

    expect(lineFor(p, MILK).quantityUsed).toBe(450);   // 150 x 1.5 x 2
    expect(lineFor(p, BEANS).quantityUsed).toBe(54);   // 18 x 1.5 x 2
  });

  it('nets refunded quantity out — a refunded drink consumed nothing', async () => {
    const { svc } = build({ items: [line('i-1', LATTE, 5, [], 2)] });
    const p = await svc.preview(TENANT, RANGE);

    expect(lineFor(p, MILK).quantityUsed).toBe(450);   // (5 - 2) x 150
  });

  it('warns loudly when the window predates the deduction marker', async () => {
    const { svc } = build({ items: [line('i-1', LATTE, 1)] });
    const p = await svc.preview(TENANT, { from: '2026-08-01T00:00:00.000Z', to: '2026-08-10T00:00:00.000Z' });

    expect(codes(p)).toContain('PREDATES_MARKER');
    expect(p.warnings.find((w: any) => w.code === 'PREDATES_MARKER')?.level).toBe('danger');
    expect(warnText(p)).toContain('deducted a second time');
  });

  it('warns while deduction is still paused, because new sales keep piling up', async () => {
    const { svc } = build({ items: [line('i-1', LATTE, 1)], pausedAt: new Date('2026-09-01T09:14:00.000Z') });
    const p = await svc.preview(TENANT, RANGE);

    expect(p.deductionPausedAt).toBe('2026-09-01T09:14:00.000Z');
    expect(warnText(p)).toContain('Turn deduction back on in Settings first');
  });

  it('reports nothing to do when every line already deducted', async () => {
    const { svc } = build({ items: [], alreadyDeducted: 120 });
    const p = await svc.preview(TENANT, RANGE);

    expect(p.lineCount).toBe(0);
    expect(warnText(p)).toContain('All 120 sale line(s) in this range already deducted');
  });

  it('floors at zero and flags a shortfall rather than going negative', async () => {
    const { svc } = build({ items: [line('i-1', LATTE, 100)], stock: { [MILK]: 500, [BEANS]: 5_000 } });
    const p = await svc.preview(TENANT, RANGE);

    expect(lineFor(p, MILK).quantityUsed).toBe(15_000);
    expect(lineFor(p, MILK).stockAfter).toBe(0);
    expect(lineFor(p, MILK).shortfall).toBe(true);
    expect(warnText(p)).toContain('more usage than the stock on hand');
  });

  it('rejects a backwards date range', async () => {
    const { svc } = build();
    await expect(svc.preview(TENANT, { from: RANGE.to, to: RANGE.from })).rejects.toThrow(BadRequestException);
  });

  // ────────────────────────────── apply ──────────────────────────────

  it('decrements relative to live stock so a concurrent sale is not overwritten', async () => {
    const { svc } = build({ items: [line('i-1', LATTE, 4)] });
    const out = await svc.apply(TENANT, USER, { ...RANGE, expectedLineCount: 1 });

    expect(out.applied).toBe(true);
    expect(decremented[MILK]).toBe(600);
    expect(decremented[BEANS]).toBe(72);
  });

  it('takes an advisory lock so two concurrent applies cannot both deduct', async () => {
    const { svc, db } = build({ items: [line('i-1', LATTE, 1)] });
    await svc.apply(TENANT, USER, { ...RANGE, expectedLineCount: 1 });

    expect(db.$executeRaw).toHaveBeenCalled();
  });

  it('stamps exactly the lines it deducted', async () => {
    const { svc } = build({ items: [line('i-1', LATTE, 4)] });
    const out = await svc.apply(TENANT, USER, { ...RANGE, expectedLineCount: 1 });

    expect(stampedItemIds).toEqual(['i-1']);
    expect(out.stampedLineCount).toBe(1);
  });

  it('closes the latte line and leaves the cake line open, in one mixed order', async () => {
    // The exact case an order-level marker cannot express.
    const { svc } = build({
      items: [
        line('i-latte', LATTE, 1, [], 0, 'o-1'),
        line('i-cake', CAKE, 1, [], 0, 'o-1'),
      ],
    });
    const out = await svc.apply(TENANT, USER, { ...RANGE, expectedLineCount: 1 });

    expect(decremented[MILK]).toBe(150);
    // Only the line that actually contributed usage is closed.
    expect(stampedItemIds).toEqual(['i-latte']);
    expect(out.stampedLineCount).toBe(1);
    // The cake is still waiting for its recipe.
    expect(out.skippedNoRecipe.map((s: any) => s.productId)).toEqual([CAKE]);
  });

  it('drains lot layers so FIFO/FEFO does not go stale', async () => {
    const { svc } = build({
      items: [line('i-1', LATTE, 1)],
      boms: [{ productId: LATTE, rawMaterialId: BEANS, quantity: 30 }],
      lots: [
        { id: 'lot-a', rawMaterialId: BEANS, qtyRemaining: 20, unitCost: 1 },
        { id: 'lot-b', rawMaterialId: BEANS, qtyRemaining: 80, unitCost: 5 },
      ],
    });
    await svc.apply(TENANT, USER, { ...RANGE, expectedLineCount: 1 });

    // 30g needed: lot-a drains to 0, lot-b takes the remaining 10.
    expect(lotDrains).toEqual([
      { id: 'lot-a', to: 0 },
      { id: 'lot-b', to: 70 },
    ]);
  });

  it('refuses when the line count moved since the preview', async () => {
    const { svc } = build({ items: [line('i-1', LATTE, 4), line('i-2', LATTE, 1)] });
    await expect(
      svc.apply(TENANT, USER, { ...RANGE, expectedLineCount: 1 }),
    ).rejects.toThrow(BadRequestException);
    expect(decremented).toEqual({});
    expect(stampedItemIds).toEqual([]);
  });

  it('is a no-op when re-run, because the marker already excludes everything', async () => {
    const { svc } = build({ items: [], alreadyDeducted: 1 });
    await expect(
      svc.apply(TENANT, USER, { ...RANGE, expectedLineCount: 0 }),
    ).rejects.toThrow(BadRequestException);
    expect(decremented).toEqual({});
    expect(stampedItemIds).toEqual([]);
  });

  it('no longer refuses merely because an earlier run overlapped these dates', async () => {
    const { svc } = build({
      items: [line('i-1', LATTE, 4)],
      prior: [{
        createdAt: new Date('2026-09-20T00:00:00.000Z'),
        after: { from: '2026-09-10T00:00:00.000Z', to: '2026-09-15T00:00:00.000Z', orderCount: 12 },
      }],
    });

    const out = await svc.apply(TENANT, USER, { ...RANGE, expectedLineCount: 1 });
    expect(out.applied).toBe(true);
  });

  it('records the run, including how many lines it closed', async () => {
    const { svc } = build({ items: [line('i-1', LATTE, 4)] });
    await svc.apply(TENANT, USER, { ...RANGE, expectedLineCount: 1 });

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].entityType).toBe('RECIPE_CATCHUP');
    expect(auditRows[0].after.stampedLineCount).toBe(1);
    expect(auditRows[0].performedBy).toBe(USER);
  });
});
