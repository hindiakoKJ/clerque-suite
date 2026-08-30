import { BadRequestException } from '@nestjs/common';
import { InventoryService } from './inventory.service';

/**
 * Reclassifying an item must not strand a recipe.
 *
 * Recipes may only contain ingredients — saveBom enforces that, and so does
 * the spreadsheet importer. Nothing enforced the reverse: an item already
 * sitting in a BOM could be relabelled a supply, and the recipe would keep
 * working right up until the next save, which would then be refused with a
 * reason pointing at a line the owner had not touched.
 *
 * It bites on packaging first. Cups, lids and straws are in the BOMs today —
 * each is consumed per drink exactly like milk — so calling one a bar supply
 * would break every drink containing it. Refusing at the moment of
 * reclassification puts the question where somebody can actually answer it.
 */
describe('InventoryService.updateRawMaterial — reclassification guard', () => {
  const TENANT = 't1';
  const ID = 'rm-cup';

  function build(opts: { category?: string; bom?: number; variant?: number; sub?: number } = {}) {
    const prisma: any = {
      rawMaterial: {
        findFirst: jest.fn().mockResolvedValue({
          id: ID, tenantId: TENANT, name: 'CH Cold Cup 16oz',
          category: opts.category ?? 'INGREDIENT', costPrice: null,
        }),
        update: jest.fn().mockResolvedValue({ id: ID, costPrice: null }),
      },
      bomItem:        { count: jest.fn().mockResolvedValue(opts.bom     ?? 0) },
      variantBomItem: { count: jest.fn().mockResolvedValue(opts.variant ?? 0) },
      subRecipeItem:  { count: jest.fn().mockResolvedValue(opts.sub     ?? 0) },
      $transaction: jest.fn((fn: any) => (typeof fn === 'function' ? fn(prisma) : Promise.all(fn))),
    };
    const svc = new InventoryService(prisma, {} as any) as any;
    return { svc, prisma };
  }

  it('refuses to mark a recipe ingredient as a supply', async () => {
    const { svc } = build({ bom: 1 });
    await expect(svc.updateRawMaterial(TENANT, ID, { category: 'BAR_SUPPLY' }))
      .rejects.toThrow(BadRequestException);
  });

  it('says which item, how many recipes, and what the two answers are', async () => {
    // "Invalid" would send the owner hunting through every drink.
    const { svc } = build({ bom: 3 });
    await expect(svc.updateRawMaterial(TENANT, ID, { category: 'BAR_SUPPLY' }))
      .rejects.toThrow(/CH Cold Cup 16oz.*3 recipes.*leave it as an ingredient/s);
  });

  it('counts variant recipes and sub-recipes too, not just the main BOM', async () => {
    const { svc } = build({ bom: 0, variant: 1, sub: 1 });
    await expect(svc.updateRawMaterial(TENANT, ID, { category: 'KITCHEN_SUPPLY' }))
      .rejects.toThrow(/2 recipes/);
  });

  it('allows the change when nothing uses it — the bleach case', async () => {
    const { svc, prisma } = build({ bom: 0 });
    await svc.updateRawMaterial(TENANT, ID, { category: 'OFFICE_SUPPLY' });
    expect(prisma.rawMaterial.update).toHaveBeenCalled();
  });

  it('does not block ordinary edits that leave the category alone', async () => {
    // A rename on an item used in 40 recipes must not be refused.
    const { svc, prisma } = build({ bom: 40 });
    await svc.updateRawMaterial(TENANT, ID, { name: 'CH Cold Cup 16oz (new supplier)' });
    expect(prisma.bomItem.count).not.toHaveBeenCalled();
    expect(prisma.rawMaterial.update).toHaveBeenCalled();
  });

  it('does not block moving a supply BACK to being an ingredient', async () => {
    // That direction only ever makes more recipes legal, never fewer.
    const { svc, prisma } = build({ category: 'OFFICE_SUPPLY', bom: 0 });
    await svc.updateRawMaterial(TENANT, ID, { category: 'INGREDIENT' });
    expect(prisma.rawMaterial.update).toHaveBeenCalled();
  });
});
