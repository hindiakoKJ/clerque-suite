import { BadRequestException, ConflictException } from '@nestjs/common';
import { RecipeCatchupService } from './recipe-catchup.service';

/**
 * Replaying ingredient usage for orders that sold before their recipe existed.
 *
 * The shop went live on the POS on day one and finished its recipe book weeks
 * later. Every sale in between deducted nothing, because the product had no
 * BOM to walk at the time. These tests pin the reconstruction: it must apply
 * today's recipe to yesterday's orders with the same netting, multiplier and
 * zero-floor rules the live sale path uses, and it must refuse to run twice
 * over the same dates.
 */
describe('RecipeCatchupService', () => {
  const TENANT = 't1';
  const BRANCH = 'br-1';
  const USER = 'owner-1';

  const LATTE = 'p-latte';
  const MILK = 'rm-milk';
  const OAT = 'rm-oat';
  const BEANS = 'rm-beans';

  /** Modifier option that swaps dairy for oat: cancels 150ml milk, pours 150ml oat. */
  const OPT_OAT = 'opt-oat';
  /** Size upgrade — scales the base recipe by 1.5x, no ingredients of its own. */
  const OPT_GRANDE = 'opt-grande';

  let updated: Record<string, number>;
  let auditRows: any[];

  function build(opts: {
    orders?: any[];
    boms?: any[];
    stock?: Record<string, number>;
    prior?: any[];
  } = {}) {
    updated = {};
    auditRows = [];

    const stock = opts.stock ?? { [MILK]: 10_000, [OAT]: 10_000, [BEANS]: 5_000 };

    const prisma: any = {
      order: { findMany: jest.fn().mockResolvedValue(opts.orders ?? []) },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: BRANCH }) },
      bomItem: {
        findMany: jest.fn().mockResolvedValue(
          opts.boms ?? [
            { productId: LATTE, rawMaterialId: MILK, quantity: 150 },
            { productId: LATTE, rawMaterialId: BEANS, quantity: 18 },
          ],
        ),
      },
      modifierOption: {
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(
            [
              {
                id: OPT_OAT,
                recipeMultiplier: 1,
                ingredients: [
                  { rawMaterialId: MILK, quantity: -150 }, // substitution: cancel dairy
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
          updated[where.rawMaterialId] = Number(data.quantity);
          return Promise.resolve({ count: 1 });
        }),
      },
      auditLog: { findMany: jest.fn().mockResolvedValue(opts.prior ?? []) },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };

    const audit: any = { log: jest.fn((row: any) => { auditRows.push(row); return Promise.resolve(); }) };
    return { svc: new RecipeCatchupService(prisma, audit), prisma };
  }

  /** One order line: qty servings of `productId` with the given options. */
  const order = (productId: string, quantity: number, optionIds: string[] = [], refundedQty = 0) => ({
    id: 'o-' + Math.random(),
    items: [
      {
        productId,
        productName: 'Latte',
        quantity,
        refundedQty,
        modifiers: optionIds.map((id) => ({ modifierOptionId: id })),
      },
    ],
  });

  const RANGE = { from: '2026-08-01T00:00:00.000Z', to: '2026-08-24T23:59:59.999Z' };
  const lineFor = (p: any, rmId: string) => p.lines.find((l: any) => l.rawMaterialId === rmId);

  // ───────────────────────────── preview ─────────────────────────────

  it('reconstructs plain usage from historical orders', async () => {
    const { svc } = build({ orders: [order(LATTE, 4)] });
    const p = await svc.preview(TENANT, { ...RANGE, productIds: [LATTE] });

    expect(lineFor(p, MILK).quantityUsed).toBe(600);   // 150ml x 4
    expect(lineFor(p, BEANS).quantityUsed).toBe(72);   // 18g x 4
    expect(lineFor(p, MILK).stockAfter).toBe(9_400);
    expect(p.orderCount).toBe(1);
  });

  it('nets a substitution so the cancelled ingredient is never drained', async () => {
    const { svc } = build({ orders: [order(LATTE, 2, [OPT_OAT])] });
    const p = await svc.preview(TENANT, { ...RANGE, productIds: [LATTE] });

    // Oat replaced dairy: no milk left the building, oat did.
    expect(lineFor(p, MILK)).toBeUndefined();
    expect(lineFor(p, OAT).quantityUsed).toBe(300);
    expect(lineFor(p, BEANS).quantityUsed).toBe(36);
  });

  it('scales the base recipe by the size multiplier', async () => {
    const { svc } = build({ orders: [order(LATTE, 2, [OPT_GRANDE])] });
    const p = await svc.preview(TENANT, { ...RANGE, productIds: [LATTE] });

    expect(lineFor(p, MILK).quantityUsed).toBe(450);   // 150 x 1.5 x 2
    expect(lineFor(p, BEANS).quantityUsed).toBe(54);   // 18 x 1.5 x 2
  });

  it('nets refunded quantity out — a refunded drink consumed nothing', async () => {
    const { svc } = build({ orders: [order(LATTE, 5, [], 2)] });
    const p = await svc.preview(TENANT, { ...RANGE, productIds: [LATTE] });

    expect(lineFor(p, MILK).quantityUsed).toBe(450);   // (5 - 2) x 150
  });

  it('skips products still without a recipe, and says so', async () => {
    const { svc } = build({
      orders: [order('p-no-recipe', 9)],
      boms: [],
    });
    const p = await svc.preview(TENANT, RANGE);

    expect(p.lines).toHaveLength(0);
    expect(p.skippedNoRecipe[0]).toMatchObject({ productId: 'p-no-recipe', unitsSold: 9 });
    expect(p.warnings.join(' ')).toContain('still have no recipe');
  });

  it('only touches the products it was told to catch up', async () => {
    const { svc } = build({
      orders: [order(LATTE, 2), order('p-other', 10)],
      boms: [
        { productId: LATTE, rawMaterialId: MILK, quantity: 150 },
        { productId: 'p-other', rawMaterialId: BEANS, quantity: 30 },
      ],
    });
    const p = await svc.preview(TENANT, { ...RANGE, productIds: [LATTE] });

    expect(lineFor(p, MILK).quantityUsed).toBe(300);
    // p-other already had its recipe at sale time — replaying it would double-deduct.
    expect(lineFor(p, BEANS)).toBeUndefined();
  });

  it('warns when no product list is given, because that is the double-deduct case', async () => {
    const { svc } = build({ orders: [order(LATTE, 1)] });
    const p = await svc.preview(TENANT, RANGE);
    expect(p.warnings.join(' ')).toContain('drains that stock a second time');
  });

  it('floors at zero and flags a shortfall rather than going negative', async () => {
    const { svc } = build({ orders: [order(LATTE, 100)], stock: { [MILK]: 500, [BEANS]: 5_000 } });
    const p = await svc.preview(TENANT, { ...RANGE, productIds: [LATTE] });

    expect(lineFor(p, MILK).quantityUsed).toBe(15_000);
    expect(lineFor(p, MILK).stockAfter).toBe(0);
    expect(lineFor(p, MILK).shortfall).toBe(true);
    expect(p.warnings.join(' ')).toContain('more usage than the stock on hand');
  });

  it('rejects a backwards date range', async () => {
    const { svc } = build();
    await expect(svc.preview(TENANT, { from: RANGE.to, to: RANGE.from })).rejects.toThrow(BadRequestException);
  });

  // ────────────────────────────── apply ──────────────────────────────

  it('writes the reconstructed balances and records the run', async () => {
    const { svc } = build({ orders: [order(LATTE, 4)] });
    const out = await svc.apply(TENANT, USER, { ...RANGE, productIds: [LATTE], expectedOrderCount: 1 });

    expect(out.applied).toBe(true);
    expect(updated[MILK]).toBe(9_400);
    expect(updated[BEANS]).toBe(4_928);

    // The audit row IS the idempotency record.
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].entityType).toBe('RECIPE_CATCHUP');
    expect(auditRows[0].after.orderCount).toBe(1);
    expect(auditRows[0].performedBy).toBe(USER);
  });

  it('refuses when a prior catch-up already covered these dates', async () => {
    const { svc } = build({
      orders: [order(LATTE, 4)],
      prior: [{
        createdAt: new Date('2026-08-20T00:00:00.000Z'),
        after: { from: '2026-08-10T00:00:00.000Z', to: '2026-08-15T00:00:00.000Z', orderCount: 12 },
      }],
    });

    await expect(
      svc.apply(TENANT, USER, { ...RANGE, productIds: [LATTE], expectedOrderCount: 1 }),
    ).rejects.toThrow(ConflictException);
    expect(updated).toEqual({});   // nothing written
  });

  it('allows a run over dates a prior catch-up did not cover', async () => {
    const { svc } = build({
      orders: [order(LATTE, 4)],
      prior: [{
        createdAt: new Date('2026-07-05T00:00:00.000Z'),
        after: { from: '2026-07-01T00:00:00.000Z', to: '2026-07-31T00:00:00.000Z', orderCount: 30 },
      }],
    });

    const out = await svc.apply(TENANT, USER, { ...RANGE, productIds: [LATTE], expectedOrderCount: 1 });
    expect(out.applied).toBe(true);
  });

  it('refuses when the order count moved since the preview', async () => {
    const { svc } = build({ orders: [order(LATTE, 4), order(LATTE, 1)] });
    await expect(
      svc.apply(TENANT, USER, { ...RANGE, productIds: [LATTE], expectedOrderCount: 1 }),
    ).rejects.toThrow(ConflictException);
    expect(updated).toEqual({});
  });

  it('refuses an apply that would change nothing', async () => {
    const { svc } = build({ orders: [] });
    await expect(
      svc.apply(TENANT, USER, { ...RANGE, expectedOrderCount: 0 }),
    ).rejects.toThrow(BadRequestException);
  });
});
