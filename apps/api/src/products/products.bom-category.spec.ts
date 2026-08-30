import { BadRequestException } from '@nestjs/common';
import { ProductsService } from './products.service';

/**
 * A supply cannot be part of a recipe.
 *
 * Bleach, tissue and trash bags are bought, counted and run out exactly like
 * coffee beans, which is why they sat in the same list and were indis-
 * tinguishable. The difference is what their cost IS: an ingredient's cost
 * belongs in what a drink costs, a supply's belongs in the cost of running
 * the shop. A supply inside a BOM silently inflates every margin computed
 * from that recipe, and nothing on screen would ever say so.
 *
 * The rule already existed on the spreadsheet import path. The app path let
 * the same row through, so the importer refused what the UI accepted.
 */
describe('ProductsService.saveBom — supplies stay out of recipes', () => {
  const TENANT = 't1';
  const PRODUCT = 'p-latte';

  function build(offenders: Array<{ name: string; category: string }>) {
    const prisma: any = {
      product: {
        findFirst: jest.fn().mockResolvedValue({ id: PRODUCT, tenantId: TENANT }),
        count:     jest.fn().mockResolvedValue(0),
        update:    jest.fn(),
      },
      rawMaterial: { findMany: jest.fn().mockResolvedValue(offenders) },
      bomItem:     { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      tenant:      { findUnique: jest.fn().mockResolvedValue({ planCode: 'CLERQUE' }) },
      $transaction: jest.fn((fn: any) => (typeof fn === 'function' ? fn(prisma) : Promise.all(fn))),
    };
    return { svc: new ProductsService(prisma) as any, prisma };
  }

  const LINES = [
    { rawMaterialId: 'rm-beans',  quantity: 18 },
    { rawMaterialId: 'rm-bleach', quantity: 5  },
  ];

  it('refuses a recipe containing a supply', async () => {
    const { svc } = build([{ name: 'Zonrox Bleach', category: 'OFFICE_SUPPLY' }]);
    await expect(svc.saveBom(TENANT, PRODUCT, LINES)).rejects.toThrow(BadRequestException);
  });

  it('names the offender and what to do, not just "invalid"', async () => {
    // A bare rejection on a 12-line recipe sends someone hunting.
    const { svc } = build([{ name: 'Zonrox Bleach', category: 'OFFICE_SUPPLY' }]);
    await expect(svc.saveBom(TENANT, PRODUCT, LINES))
      .rejects.toThrow(/Zonrox Bleach.*office supply.*is a supply, not an ingredient.*Stock on hand/s);
  });

  it('lists every offender at once rather than one per save', async () => {
    const { svc } = build([
      { name: 'Zonrox Bleach', category: 'OFFICE_SUPPLY' },
      { name: 'Trash Bags',    category: 'KITCHEN_SUPPLY' },
    ]);
    await expect(svc.saveBom(TENANT, PRODUCT, LINES)).rejects.toThrow(/Zonrox Bleach.*Trash Bags/s);
  });

  it('writes the recipe when every line is an ingredient', async () => {
    const { svc, prisma } = build([]);           // nothing non-INGREDIENT came back
    await svc.saveBom(TENANT, PRODUCT, LINES);
    expect(prisma.bomItem.createMany).toHaveBeenCalled();
  });

  it('checks the categories in ONE query, not one per line', async () => {
    // saveBom runs on every recipe save; a query per line would make a
    // 12-ingredient drink twelve round trips. (The method also reads raw
    // materials again afterwards to recompute the recipe cost — a different
    // lookup, so this asserts on the category check specifically rather than
    // on the total call count.)
    const { svc, prisma } = build([]);
    await svc.saveBom(TENANT, PRODUCT, LINES);

    const categoryChecks = prisma.rawMaterial.findMany.mock.calls
      .map((c: any[]) => c[0]?.where)
      .filter((w: any) => w?.category !== undefined);

    expect(categoryChecks).toHaveLength(1);
    const where = categoryChecks[0];
    expect(where.tenantId).toBe(TENANT);
    expect(where.id.in).toEqual(['rm-beans', 'rm-bleach']);
    expect(where.category).toEqual({ not: 'INGREDIENT' });
  });

  it('skips the check entirely when the recipe is being cleared', async () => {
    const { svc, prisma } = build([]);
    await svc.saveBom(TENANT, PRODUCT, []);
    expect(prisma.rawMaterial.findMany).not.toHaveBeenCalled();
    expect(prisma.bomItem.deleteMany).toHaveBeenCalled();
  });
});
