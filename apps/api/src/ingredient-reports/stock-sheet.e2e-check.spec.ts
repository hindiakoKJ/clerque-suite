import { PrismaClient } from '@prisma/client';
import { InventoryService } from '../inventory/inventory.service';
import { SubRecipesService } from '../sub-recipes/sub-recipes.service';
import { sheetDays } from './end-of-day.scheduler';
import { saveClosingBalances } from './stock-day-balances';
import { stationSheet } from './stock-sheet';

/**
 * The kitchen's daily inventory sheet, against a REAL database.
 *
 * The unit specs prove each reader against a fake of Prisma, which only
 * returns what its author believed the query returns. This runs the real
 * receipt, batch and write-off services and the real sheet queries against
 * real Postgres, then checks the one thing the kitchen will check by hand:
 * every row foots -- Beginning + In - Waste - Used = Ending -- with nothing
 * left over in Adjust, except the one movement the sheet deliberately does not
 * name (a cancelled transfer's stock coming back).
 *
 * Guarded on localhost like prep-pipeline.e2e-check.spec.ts: it creates and
 * deletes its own shop, and must never be pointed at a database that is not
 * local.
 */
const url = process.env.DATABASE_URL ?? '';
const LOCAL = /@localhost[:/]/.test(url) || /@127\.0\.0\.1[:/]/.test(url);
const maybe = LOCAL ? describe : describe.skip;

maybe('Daily inventory sheet -- against the real database', () => {
  jest.setTimeout(120_000);

  const prisma = new PrismaClient() as any;
  const inventory = new InventoryService(prisma, { assertDateIsOpen: async () => undefined } as any);
  const subRecipes = new SubRecipesService(prisma);
  /** Postgres keeps milliseconds: a short pause keeps "before the save" and "after the save" apart. */
  const tick = () => new Promise((resolve) => setTimeout(resolve, 25));

  const tag = `sheet-e2e-${Date.now()}`;
  let tenantId = '';
  let branchId = '';
  let userId = '';
  let stationId = '';
  let flourId = '';   // A: straight into the dish
  let sugarId = '';   // B: into the prep
  let syrupId = '';   // P: the prep, also in the dish
  let foilId = '';    // C: a kitchen supply
  let savedDay = '';
  let sheetDay = '';

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { name: tag, slug: tag, taxStatus: 'NON_VAT', businessType: 'COFFEE_SHOP', inventoryMode: 'RECIPE_BASED' },
      select: { id: true },
    });
    tenantId = tenant.id;
    // No closing time: the save falls at 23:55, the default.
    branchId = (await prisma.branch.create({ data: { tenantId, name: 'Main' }, select: { id: true } })).id;
    userId = (await prisma.user.create({
      data: { tenantId, branchId, email: `${tag}@example.test`, passwordHash: 'x', name: 'Cook', role: 'BUSINESS_OWNER' },
      select: { id: true },
    })).id;
    stationId = (await prisma.station.create({ data: { tenantId, kind: 'KITCHEN', name: 'Kitchen' }, select: { id: true } })).id;
    const category = await prisma.category.create({ data: { tenantId, name: 'Pastries', stationId }, select: { id: true } });

    flourId = (await inventory.createRawMaterial(tenantId, { name: 'Flour', unit: 'g' } as any)).id;
    sugarId = (await inventory.createRawMaterial(tenantId, { name: 'Sugar', unit: 'g' } as any)).id;
    syrupId = (await inventory.createRawMaterial(tenantId, { name: 'Sugar Syrup', unit: 'g' } as any)).id;
    foilId = (await inventory.createRawMaterial(tenantId, { name: 'Foil', unit: 'roll', category: 'KITCHEN_SUPPLY' } as any)).id;
    // One batch of syrup: 500 g sugar makes 1000 g.
    await subRecipes.setRecipe(tenantId, syrupId, 1000, [{ rawMaterialId: sugarId, quantity: 500 }]);

    const product = await prisma.product.create({
      data: { tenantId, name: 'Syrup Bun', price: 60, categoryId: category.id },
      select: { id: true },
    });
    await prisma.bomItem.createMany({
      data: [
        { productId: product.id, rawMaterialId: flourId, quantity: 10 },
        { productId: product.id, rawMaterialId: syrupId, quantity: 50 },
      ],
    });

    // Yesterday's stock, received the ordinary way.
    await inventory.receiveRawMaterial(tenantId, flourId, { branchId, quantity: 1000, costPrice: 0.05 } as any);
    await inventory.receiveRawMaterial(tenantId, sugarId, { branchId, quantity: 2000, costPrice: 0.08 } as any);
    await inventory.receiveRawMaterial(tenantId, foilId, { branchId, quantity: 10, costPrice: 90 } as any);
    await tick();

    // Close yesterday. The day just closed, and the day now running, by the scheduler's own rule.
    const days = sheetDays(null, new Date());
    savedDay = days.last;
    sheetDay = days.running;
    await saveClosingBalances(prisma, { id: branchId, tenantId }, savedDay, () => new Date());
    await tick();

    // Today. A real batch: 500 g sugar in, 1000 g syrup out.
    await subRecipes.makeBatch(tenantId, syrupId, { branchId, batches: 1, referenceNumber: `${tag}-batch` } as any, userId);

    // A sale of two buns, written the way the sale writes a line used at the till: stamped, and the stock taken.
    const order = await prisma.order.create({
      data: {
        tenantId, branchId, orderNumber: `${tag}-1`, status: 'COMPLETED', subtotal: 120, totalAmount: 120, paidAt: new Date(),
        items: { create: [{ productId: product.id, productName: 'Syrup Bun', unitPrice: 60, quantity: 2, lineTotal: 120, ingredientsDeductedAt: new Date() }] },
      },
      select: { id: true },
    });
    expect(order.id).toBeTruthy();
    await prisma.rawMaterialInventory.update({ where: { branchId_rawMaterialId: { branchId, rawMaterialId: flourId } }, data: { quantity: { decrement: 20 } } });
    await prisma.rawMaterialInventory.update({ where: { branchId_rawMaterialId: { branchId, rawMaterialId: syrupId } }, data: { quantity: { decrement: 100 } } });

    // A real write-off, and a delivery with no reference number.
    await inventory.writeOffRawMaterial(tenantId, flourId, userId, { branchId, quantity: 30, reasonCode: 'DAMAGE' } as any);
    await inventory.receiveRawMaterial(tenantId, flourId, { branchId, quantity: 100, costPrice: 0.05 } as any);

    // A cancelled transfer handing 5 rolls of foil back: stock up, and a -CANCELLED lot the sheet does not call In.
    await prisma.rawMaterialLot.create({
      data: {
        tenantId, branchId, rawMaterialId: foilId, qtyReceived: 5, qtyRemaining: 5, unitCost: 90,
        receivedAt: new Date(), referenceNumber: `${tag}-TR-CANCELLED`, paymentMethod: 'OWNER_FUNDED',
      },
    });
    await prisma.rawMaterialInventory.update({ where: { branchId_rawMaterialId: { branchId, rawMaterialId: foilId } }, data: { quantity: { increment: 5 } } });
    await tick();
  });

  afterAll(async () => {
    if (tenantId) {
      await prisma.stockDayBalance.deleteMany({ where: { tenantId } });
      await prisma.orderItem.deleteMany({ where: { order: { tenantId } } });
      await prisma.order.deleteMany({ where: { tenantId } });
      await prisma.bomItem.deleteMany({ where: { product: { tenantId } } });
      await prisma.product.deleteMany({ where: { tenantId } });
      await prisma.category.deleteMany({ where: { tenantId } });
      await prisma.station.deleteMany({ where: { tenantId } });
      await prisma.subRecipeItem.deleteMany({ where: { parent: { tenantId } } });
      await prisma.rawMaterialLot.deleteMany({ where: { tenantId } });
      await prisma.rawMaterialInventory.deleteMany({ where: { tenantId } });
      await prisma.accountingEvent.deleteMany({ where: { tenantId } });
      await prisma.aPBill.deleteMany({ where: { tenantId } });
      await prisma.rawMaterial.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.branch.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    await prisma.$disconnect();
  });

  it('the closing save holds every stock row of the branch, all read at one moment', async () => {
    const rows = await prisma.stockDayBalance.findMany({ where: { branchId, day: savedDay } });
    const stockRows = await prisma.rawMaterialInventory.count({ where: { tenantId, branchId } });
    // The syrup had no stock row yet at closing, so it is not in the save (and reads 0).
    expect(rows.map((r: any) => r.rawMaterialId).sort()).toEqual([flourId, sugarId, foilId].sort());
    expect(stockRows).toBe(4);
    expect(new Set(rows.map((r: any) => r.takenAt.getTime())).size).toBe(1);
    // A second save of the same day writes nothing.
    expect(await saveClosingBalances(prisma, { id: branchId, tenantId }, savedDay, () => new Date())).toBeNull();
  });

  it('every row of today\'s kitchen sheet foots, and only the cancelled transfer is left in Adjust', async () => {
    const ctx = {
      tenantId, station: { id: stationId, name: 'Kitchen', kind: 'KITCHEN' }, branch: { id: branchId, name: 'Main' },
      actorId: userId, actorLabel: 'Kitchen screen', isDevice: true,
    };
    const sheet = await stationSheet(prisma, ctx, sheetDay, new Date());
    expect(sheet.status).toBe('LIVE');
    expect(sheet.previousDay).toBe(savedDay);

    const rows = new Map(sheet.sections.flatMap((s) => s.rows.map((r) => [r.rawMaterialId, { ...r, section: s.key }])));
    expect(rows.get(flourId)).toMatchObject({ section: 'INGREDIENTS', beginning: 1000, in: 100, waste: 30, used: 20, ending: 1050, adjust: 0 });
    expect(rows.get(sugarId)).toMatchObject({ section: 'INGREDIENTS', beginning: 2000, in: 0, waste: 0, used: 500, ending: 1500, adjust: 0 });
    expect(rows.get(syrupId)).toMatchObject({ section: 'PREMADE', beginning: 0, in: 1000, waste: 0, used: 100, ending: 900, adjust: 0 });
    expect(rows.get(foilId)).toMatchObject({ section: 'SUPPLIES', beginning: 10, in: 0, ending: 15, adjust: 5 });
    for (const r of rows.values()) {
      expect(Math.abs(r.beginning + r.in - r.waste - r.used + r.adjust - r.ending)).toBeLessThan(0.0001);
    }
    expect(sheet.showAdjust).toBe(true);

    // No cost anywhere in what a kitchen screen is sent.
    const keys = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(keys)
      : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : []);
    expect(keys(JSON.parse(JSON.stringify(sheet))).filter((k) => /cost|price|value/i.test(k))).toEqual([]);
  });

  it('yesterday\'s sheet is closed, and today\'s movements are not on it', async () => {
    const ctx = {
      tenantId, station: { id: stationId, name: 'Kitchen', kind: 'KITCHEN' }, branch: { id: branchId, name: 'Main' },
      actorId: userId, actorLabel: 'Kitchen screen', isDevice: true,
    };
    const sheet = await stationSheet(prisma, ctx, savedDay, new Date());
    expect(sheet).toMatchObject({ status: 'CLOSED', nextDay: sheetDay, previousDay: null });
    const flour = sheet.sections.flatMap((s) => s.rows).find((r) => r.rawMaterialId === flourId)!;
    // Its Beginning is worked back (no save before it): the receipt that brought the flour in explains it all.
    expect(flour).toMatchObject({ beginning: 0, in: 1000, used: 0, waste: 0, ending: 1000, adjust: 0 });
  });
});
