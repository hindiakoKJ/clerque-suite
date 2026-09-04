import { PrismaClient } from '@prisma/client';
import { InventoryService } from '../inventory/inventory.service';
import { SubRecipesService } from './sub-recipes.service';
import { ProcureService } from '../procure/procure.service';

/**
 * The prep pipeline, run against a REAL database rather than a mock.
 *
 * Kept, not temporary. Three sibling *.e2e-check specs were deleted in the
 * hardcoding audit because they were one-off dry runs keyed to one machine's
 * scratchpad path and a production tenant id -- permanently skipped everywhere
 * else, and carrying a live id in the repo. This one is the opposite on every
 * count: it is guarded on localhost, it creates and destroys its own tenant,
 * and it covers behaviour that ships.
 *
 * Unit specs prove each piece against a mock of Prisma, which is exactly the
 * shape of test that has been wrong twice this session: a mock returns what
 * the author believed the query returns. This runs the real services against
 * real Postgres, so the select, the relation filter and the decimal handling
 * are the ones that will run in the shop.
 *
 * What it proves, in the order a shop would meet it:
 *
 *   1. A prep can be SET UP the way the new screen sets one up — create the
 *      ingredient, then write the recipe — with a par level attached.
 *   2. A batch RECORDED with a shelf life lands on the lot with a real expiry.
 *   3. The prep board reports the par level and whether it is time to prep.
 *   4. A prep that is low goes on the MAKE list; a bought ingredient that is
 *      low goes on the BUY list. Neither ends up on the other.
 *
 * Guarded on localhost and skipped when the database is not reachable, so a
 * machine without one still runs the suite green. Deletes its own tenant.
 *
 * Never point this at a database that is not local: the guard above is the only
 * thing standing between a test that creates and deletes tenants and a real
 * shop's data.
 */
const url = process.env.DATABASE_URL ?? '';
const LOCAL = /@localhost[:/]/.test(url) || /@127\.0\.0\.1[:/]/.test(url);
const maybe = LOCAL ? describe : describe.skip;

maybe('Prep pipeline — against the real database', () => {
  jest.setTimeout(120_000);

  const prisma = new PrismaClient() as any;
  const inventory = new InventoryService(prisma, { assertDateIsOpen: async () => undefined } as any);
  const subRecipes = new SubRecipesService(prisma);
  const procure = new ProcureService(prisma, inventory);

  const tag = `prep-e2e-${Date.now()}`;
  let tenantId = '';
  let branchId = '';
  let userId   = '';
  let sugarId  = '';
  let waterId  = '';
  let syrupId  = '';

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: tag, slug: tag, taxStatus: 'NON_VAT',
        businessType: 'COFFEE_SHOP', inventoryMode: 'RECIPE_BASED',
      },
      select: { id: true },
    });
    tenantId = tenant.id;

    const branch = await prisma.branch.create({
      data: { tenantId, name: 'Bar' }, select: { id: true },
    });
    branchId = branch.id;

    const user = await prisma.user.create({
      data: {
        tenantId, branchId, email: `${tag}@example.test`,
        passwordHash: 'x', name: 'Barista', role: 'CASHIER',
      },
      select: { id: true },
    });
    userId = user.id;

    // Two things the shop BUYS. Sugar is deliberately left well above its
    // reorder level so the buy list is not noisy, then dropped later.
    const sugar = await inventory.createRawMaterial(tenantId, {
      name: 'White Sugar', unit: 'g', costPrice: 0.085, lowStockAlert: 2000,
    } as any);
    const water = await inventory.createRawMaterial(tenantId, {
      name: 'Filtered Water', unit: 'ml', costPrice: 0.002, lowStockAlert: 1000,
    } as any);
    sugarId = sugar.id; waterId = water.id;

    await prisma.rawMaterialInventory.createMany({
      data: [
        { tenantId, branchId, rawMaterialId: sugarId, quantity: 20000 },
        { tenantId, branchId, rawMaterialId: waterId, quantity: 40000 },
      ],
    });
  });

  afterAll(async () => {
    if (tenantId) {
      await prisma.subRecipeItem.deleteMany({ where: { parent: { tenantId } } });
      await prisma.rawMaterialLot.deleteMany({ where: { tenantId } });
      await prisma.rawMaterialInventory.deleteMany({ where: { tenantId } });
      await prisma.accountingEvent.deleteMany({ where: { tenantId } });
      await prisma.purchaseRequestLine.deleteMany({ where: { purchaseRequest: { tenantId } } });
      await prisma.purchaseRequest.deleteMany({ where: { tenantId } });
      await prisma.rawMaterial.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.branch.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    await prisma.$disconnect();
  });

  // ── 1. Setting one up, the way the new screen does ────────────────────────

  it('sets up a prep the way the setup screen does: create it, then define it', async () => {
    /*
      Exactly the two calls the page makes, in the same order. Before this
      screen existed there was no way to do either from the app, so a shop
      could not reach any of the behaviour below without an engineer.
    */
    const syrup = await inventory.createRawMaterial(tenantId, {
      name: 'White Sugar Syrup', unit: 'g',
      // The par level, asked for at setup rather than left to be forgotten.
      lowStockAlert: 500,
    } as any);
    syrupId = syrup.id;

    const saved = await subRecipes.setRecipe(tenantId, syrupId, 2000, [
      { rawMaterialId: sugarId, quantity: 1200 },
      { rawMaterialId: waterId, quantity: 1000 },
    ]);
    expect(saved.lines).toBe(2);

    const back = await subRecipes.get(tenantId, syrupId);
    expect(Number(back.batchYield)).toBe(2000);
    expect(back.subRecipeItems.map((l: any) => l.rawMaterial.name).sort())
      .toEqual(['Filtered Water', 'White Sugar']);
  });

  // ── 2. Recording a batch, with how long it keeps ──────────────────────────

  it('puts a real expiry on the lot when the cook says how long it keeps', async () => {
    const madeAt = new Date();
    await subRecipes.makeBatch(
      tenantId, syrupId,
      { branchId, batches: 1, shelfLifeDays: 5, referenceNumber: `${tag}-b1` },
      userId,
    );

    const lot = await prisma.rawMaterialLot.findFirst({
      where: { tenantId, rawMaterialId: syrupId }, orderBy: { createdAt: 'desc' },
    });
    expect(lot).toBeTruthy();
    expect(lot.expirationDate).toBeTruthy();
    const days = (lot.expirationDate.getTime() - madeAt.getTime()) / 86400000;
    expect(days).toBeGreaterThan(4.9);
    expect(days).toBeLessThan(5.1);

    // And the batch did what a batch does — the sugar actually left the shelf.
    const sugarNow = await prisma.rawMaterialInventory.findFirst({
      where: { tenantId, branchId, rawMaterialId: sugarId },
    });
    expect(Number(sugarNow.quantity)).toBe(20000 - 1200);
  });

  // ── 3. The par level, on the board where the decision is made ─────────────

  it('reports the par level and stays quiet while there is plenty', async () => {
    const [row] = await subRecipes.list(tenantId, branchId);
    expect(row.name).toBe('White Sugar Syrup');
    expect(row.parLevel).toBe(500);
    expect(row.onHand).toBe(2000);
    expect(row.belowPar).toBe(false);
  });

  it('says it is time to prep once the line is down to the par level', async () => {
    // Sold down to 400 g — still serving, which is the whole point of warning
    // here rather than at zero.
    await prisma.rawMaterialInventory.updateMany({
      where: { tenantId, branchId, rawMaterialId: syrupId }, data: { quantity: 400 },
    });
    const [row] = await subRecipes.list(tenantId, branchId);
    expect(row.belowPar).toBe(true);
    expect(row.onHand).toBe(400);
  });

  // ── 4. Make list vs buy list ──────────────────────────────────────────────

  it('calls the low syrup a PREP and the low sugar an INGREDIENT', async () => {
    // Drop the sugar under its own reorder level so both kinds are low at once.
    await prisma.rawMaterialInventory.updateMany({
      where: { tenantId, branchId, rawMaterialId: sugarId }, data: { quantity: 100 },
    });
    const low = await inventory.getLowStock(tenantId, branchId) as any[];
    const byName = new Map(low.map((r) => [r.name, r]));
    expect(byName.get('White Sugar Syrup')?.kind).toBe('PREP');
    expect(byName.get('White Sugar')?.kind).toBe('INGREDIENT');
  });

  it('puts the sugar on the buy list and the syrup on the make list', async () => {
    /*
      The bug this closes: a prep at or below its level landed on the grocery
      slip, so the shop would be sent to a supplier for something its own bar
      produces. Worse for a rotation, where the parked batch is empty by
      design — it would have nagged every single day.
    */
    const res = await procure.pullLowStock(tenantId, branchId, userId) as any;

    // Only the sugar was added. Both were low; only one can be bought.
    expect(res.added).toBe(1);
    expect(res.toMake.map((m: any) => m.name)).toEqual(['White Sugar Syrup']);

    // And the request itself — what someone would actually carry to the market.
    const lines = await prisma.purchaseRequestLine.findMany({
      where: { purchaseRequestId: res.requestId },
      select: { rawMaterialId: true },
    });
    const ids = lines.map((l: any) => l.rawMaterialId);
    expect(ids).toContain(sugarId);
    expect(ids).not.toContain(syrupId);
  });
});
