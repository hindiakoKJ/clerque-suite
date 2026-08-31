import { SubRecipesService } from './sub-recipes.service';

/**
 * What a prep is actually FOR: servings.
 *
 * "Fifteen batches" is a number about the recipe. Nobody on the floor thinks
 * that way — a cook thinks "enough sauce for ten more plates" and a barista
 * thinks "enough syrup for forty lattes". That is the number that decides
 * whether to start prepping now or wait until after the rush.
 *
 * The station comes with it for free. Category already routes to Station —
 * the same routing that sends a ticket to the kitchen printer or the bar — so
 * a prep used only by pasta belongs to the kitchen and one used only by drinks
 * belongs to the bar, with nobody tagging anything.
 */
describe('SubRecipesService.list — available servings, by station', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';

  const KITCHEN = { id: 'st-k', name: 'Kitchen', kind: 'KITCHEN' };
  const BAR     = { id: 'st-b', name: 'Bar',     kind: 'BAR' };

  const SAUCE = {
    id: 'sauce', name: 'Spag Sauce READY', unit: 'g', costPrice: 0.227, batchYield: 2000,
    inventory: [{ quantity: 2000 }],
    subRecipeItems: [
      { quantity: 1200, rawMaterial: { id: 'tom', name: 'Tomato', unit: 'g', costPrice: 0.12 } },
    ],
  };
  const SYRUP = {
    id: 'syrup', name: 'Vanilla Syrup', unit: 'ml', costPrice: 0.08, batchYield: 1000,
    inventory: [{ quantity: 900 }],
    subRecipeItems: [
      { quantity: 800, rawMaterial: { id: 'sug', name: 'Sugar', unit: 'g', costPrice: 0.085 } },
    ],
  };

  function build(bom: any[], rows: any[] = [SAUCE, SYRUP], stock: Record<string, number> = {}) {
    const prisma: any = {
      rawMaterial: { findMany: jest.fn().mockResolvedValue(rows) },
      bomItem: { findMany: jest.fn().mockResolvedValue(bom) },
      rawMaterialInventory: {
        findMany: jest.fn().mockResolvedValue(
          Object.entries(stock).map(([rawMaterialId, quantity]) => ({ rawMaterialId, quantity })),
        ),
      },
    };
    return new SubRecipesService(prisma) as any;
  }

  const line = (rmId: string, qty: number, product: string, station: any) => ({
    rawMaterialId: rmId,
    quantity: qty,
    product: {
      id: 'p-' + product, name: product,
      category: { id: 'c', name: 'cat', station },
    },
  });

  const of = (rows: any[], id: string) => rows.find((r) => r.id === id);

  it('says how many plates the prepped sauce still covers', async () => {
    // 2,000 g on hand, 200 g a plate.
    const svc = build([line('sauce', 200, 'Spaghetti', KITCHEN)]);
    const rows = await svc.list(TENANT, BRANCH);
    expect(of(rows, 'sauce').serves[0]).toMatchObject({
      productName: 'Spaghetti', perServing: 200, servingsLeft: 10,
    });
  });

  it('lists every dish the prep feeds, worst first', async () => {
    // Lasagna takes more per plate, so it runs out first — that is the one a
    // cook needs to see at the top.
    const svc = build([
      line('sauce', 200, 'Spaghetti', KITCHEN),
      line('sauce', 500, 'Lasagna',   KITCHEN),
    ]);
    const rows = await svc.list(TENANT, BRANCH);
    expect(of(rows, 'sauce').serves.map((s: any) => [s.productName, s.servingsLeft]))
      .toEqual([['Lasagna', 4], ['Spaghetti', 10]]);
  });

  it('gives each dish its own ceiling, not a share of the total', async () => {
    // 10 plates of spaghetti OR 4 lasagna, not both. Stated per dish, because
    // that is the question being asked; making one really does reduce the
    // other, and the sale path is what enforces it.
    const svc = build([
      line('sauce', 200, 'Spaghetti', KITCHEN),
      line('sauce', 500, 'Lasagna',   KITCHEN),
    ]);
    const rows = await svc.list(TENANT, BRANCH);
    const total = of(rows, 'sauce').serves.reduce((s: number, x: any) => s + x.servingsLeft, 0);
    expect(total).toBe(14);   // deliberately NOT a meaningful total
  });

  it('routes a kitchen prep to the kitchen', async () => {
    const svc = build([line('sauce', 200, 'Spaghetti', KITCHEN)]);
    const rows = await svc.list(TENANT, BRANCH);
    expect(of(rows, 'sauce').station).toMatchObject({ name: 'Kitchen', kind: 'KITCHEN' });
  });

  it('routes a bar prep to the bar — the bar preps too', async () => {
    const svc = build([line('syrup', 20, 'Vanilla Latte', BAR)]);
    const rows = await svc.list(TENANT, BRANCH);
    expect(of(rows, 'syrup').station).toMatchObject({ name: 'Bar', kind: 'BAR' });
    expect(of(rows, 'syrup').serves[0].servingsLeft).toBe(45);
  });

  it('claims no station when a prep feeds both', async () => {
    // A syrup used in a dessert AND a drink belongs to neither; guessing one
    // would hide it from the other.
    const svc = build([
      line('syrup', 20, 'Vanilla Latte', BAR),
      line('syrup', 50, 'Panna Cotta',   KITCHEN),
    ]);
    const rows = await svc.list(TENANT, BRANCH);
    expect(of(rows, 'syrup').station).toBeNull();
  });

  it('claims no station when the products have none set', async () => {
    const svc = build([line('sauce', 200, 'Spaghetti', null)]);
    const rows = await svc.list(TENANT, BRANCH);
    expect(of(rows, 'sauce').station).toBeNull();
  });

  it('says zero servings when the prep is used up, without hiding the dish', async () => {
    const empty = { ...SAUCE, inventory: [{ quantity: 0 }] };
    const svc = build([line('sauce', 200, 'Spaghetti', KITCHEN)], [empty]);
    const rows = await svc.list(TENANT, BRANCH);
    expect(of(rows, 'sauce').serves[0].servingsLeft).toBe(0);
  });

  it('leaves serves empty for a prep that feeds another prep, not a dish', async () => {
    // A base stock nothing sells directly. It still belongs on the board, but
    // there are no servings to quote for it.
    const svc = build([]);
    const rows = await svc.list(TENANT, BRANCH);
    expect(of(rows, 'sauce').serves).toEqual([]);
  });

  it('ignores a recipe line of zero, rather than dividing by it', async () => {
    const svc = build([line('sauce', 0, 'Broken Dish', KITCHEN)]);
    const rows = await svc.list(TENANT, BRANCH);
    expect(of(rows, 'sauce').serves).toEqual([]);
  });
});
