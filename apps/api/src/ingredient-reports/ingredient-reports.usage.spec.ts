import { IngredientReportsService } from './ingredient-reports.service';

/**
 * Days of cover has to count prep, or it lies about the ingredients that
 * matter most.
 *
 * Consumption was derived from paid orders × PRODUCT recipe. But a shop that
 * preps ahead consumes the other way too: a batch of syrup takes 1,200 g of
 * sugar in one go, and the sugar is not in any product recipe — the SYRUP is.
 *
 * So an ingredient used only for prep read as ZERO consumption, which made its
 * days-of-cover null, which reads as "infinite". Measured on real data before
 * the fix: 15,200 g of sugar on hand, consumed 0, cover NONE — while every
 * batch takes 1,200 g of it. The ingredient leaving the shelf in the biggest
 * lumps was the one the early-warning number said nothing about.
 */
describe('IngredientReportsService — days of cover counts prep', () => {
  const TENANT = 't1';
  const SUGAR = 'rm-sugar';
  const BEANS = 'rm-beans';

  function build(opts: { batches?: number; ordersOfLatte?: number } = {}) {
    const batches = opts.batches ?? 0;
    const prepEvents = Array.from({ length: batches }, () => ({
      payload: {
        kind: 'SUB_RECIPE_BATCH',
        branchId: 'b1',
        consumed: [{ rawMaterialId: SUGAR, name: 'Sugar', unit: 'g', quantity: 1200 }],
      },
    }));

    const prisma: any = {
      rawMaterial: {
        findMany: jest.fn().mockResolvedValue([
          { id: SUGAR, name: 'Sugar', unit: 'g', costPrice: 0.085, lowStockAlert: null },
          { id: BEANS, name: 'Beans', unit: 'g', costPrice: 1.8,   lowStockAlert: 2000 },
        ]),
      },
      rawMaterialInventory: {
        findMany: jest.fn().mockResolvedValue([
          { rawMaterialId: SUGAR, quantity: 15200 },
          { rawMaterialId: BEANS, quantity: 9000 },
        ]),
      },
      rawMaterialLot: { findMany: jest.fn().mockResolvedValue([]) },
      order: {
        findMany: jest.fn().mockResolvedValue(
          Array.from({ length: opts.ordersOfLatte ?? 0 }, () => ({
            items: [{ productId: 'p-latte', quantity: 1 }],
          })),
        ),
      },
      bomItem: {
        findMany: jest.fn().mockResolvedValue([
          { productId: 'p-latte', rawMaterialId: BEANS, quantity: 18 },
        ]),
      },
      accountingEvent: { findMany: jest.fn().mockResolvedValue(prepEvents) },
    };
    return new IngredientReportsService(prisma) as any;
  }

  const of = (rep: any, name: string) =>
    (rep.rows ?? rep.ingredients ?? rep).find((r: any) => r.name === name);

  it('counts sugar that only ever leaves the shelf as prep', async () => {
    const rep = await build({ batches: 3 }).getAggregatedReport(TENANT, {});
    expect(of(rep, 'Sugar').consumptionQty).toBe(3600);
  });

  it('so it stops reporting infinite cover on it', async () => {
    // The whole point: null days-of-cover reads as "never runs out".
    const rep = await build({ batches: 3 }).getAggregatedReport(TENANT, {});
    expect(of(rep, 'Sugar').daysOfStock).not.toBeNull();
    expect(of(rep, 'Sugar').daysOfStock).toBeGreaterThan(0);
  });

  it('still counts ingredients sold straight through a product recipe', async () => {
    const rep = await build({ ordersOfLatte: 10 }).getAggregatedReport(TENANT, {});
    expect(of(rep, 'Beans').consumptionQty).toBe(180);
  });

  it('adds the two together when an ingredient is used both ways', async () => {
    const svc = build({ batches: 2, ordersOfLatte: 5 });
    (svc as any).prisma.bomItem.findMany = jest.fn().mockResolvedValue([
      { productId: 'p-latte', rawMaterialId: SUGAR, quantity: 10 },
    ]);
    const rep = await svc.getAggregatedReport(TENANT, {});
    // 2 batches x 1,200 from prep, plus 5 lattes x 10 g sold.
    expect(of(rep, 'Sugar').consumptionQty).toBe(2450);
  });

  it('ignores batches made at another branch when a branch is asked for', async () => {
    const svc = build({ batches: 2 });
    const rep = await svc.getAggregatedReport(TENANT, { branchId: 'somewhere-else' });
    expect(of(rep, 'Sugar').consumptionQty).toBe(0);
  });

  it('ignores accounting events that are not batches', async () => {
    const svc = build({});
    (svc as any).prisma.accountingEvent.findMany = jest.fn().mockResolvedValue([
      { payload: { kind: 'RAW_MATERIAL_RECEIPT', rawMaterialId: SUGAR, quantity: 5000 } },
    ]);
    const rep = await svc.getAggregatedReport(TENANT, {});
    expect(of(rep, 'Sugar').consumptionQty).toBe(0);
  });

  it('reads no consumption as no cover figure, rather than as zero days', async () => {
    // Null means "we cannot say", which is honest. Zero would mean "it runs
    // out today", which would be a false alarm on everything unused.
    const rep = await build({}).getAggregatedReport(TENANT, {});
    expect(of(rep, 'Sugar').daysOfStock).toBeNull();
  });
});
