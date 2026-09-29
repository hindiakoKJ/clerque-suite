import { PrismaClient } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { copyShopSetup } from './copy-setup';

/**
 * Start a new shop from an existing one, against a real database.
 *
 * Runs only against a LOCAL database (skipped in CI and never against
 * production). It makes an empty shop, copies the local Carolina test shop
 * into it, checks every count and every recipe line matches, checks a second
 * copy onto the same shop is refused, and deletes the new shop again.
 */
const url = process.env.DATABASE_URL ?? '';
const LOCAL = /@localhost[:/]/.test(url) || /@127\.0\.0\.1[:/]/.test(url);
const maybe = LOCAL ? describe : describe.skip;

maybe('copyShopSetup — a new shop from an existing one (local database)', () => {
  const prisma = new PrismaClient();
  let fromId = '';
  let toId = '';
  jest.setTimeout(180_000);

  const setupCounts = async (id: string) => ({
    stations:     await prisma.station.count({ where: { tenantId: id } }),
    categories:   await prisma.category.count({ where: { tenantId: id } }),
    routed:       await prisma.category.count({ where: { tenantId: id, stationId: { not: null } } }),
    units:        await prisma.unitOfMeasure.count({ where: { tenantId: id } }),
    products:     await prisma.product.count({ where: { tenantId: id } }),
    sizes:        await prisma.productVariant.count({ where: { product: { tenantId: id } } }),
    ingredients:  await prisma.rawMaterial.count({ where: { tenantId: id } }),
    withLevel:    await prisma.rawMaterial.count({ where: { tenantId: id, lowStockAlert: { not: null } } }),
    recipeLines:  await prisma.bomItem.count({ where: { product: { tenantId: id } } }),
    prepLines:    await prisma.subRecipeItem.count({ where: { parent: { tenantId: id } } }),
    addOnGroups:  await prisma.modifierGroup.count({ where: { tenantId: id } }),
    addOnOptions: await prisma.modifierOption.count({ where: { group: { tenantId: id } } }),
  });

  beforeAll(async () => {
    const from = await prisma.tenant.findUnique({ where: { slug: 'carolina-test' }, select: { id: true } });
    if (!from) throw new Error('This check needs the local carolina-test shop.');
    fromId = from.id;
    const stamp = `copy-check-${Date.now()}`;
    const to = await prisma.tenant.create({
      data: { name: 'Copy check', slug: stamp, branches: { create: { name: 'Main' } } },
      select: { id: true },
    });
    toId = to.id;
  });

  afterAll(async () => {
    if (toId) await prisma.tenant.delete({ where: { id: toId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('copies the whole setup, and every recipe line points at the new shop\'s own rows', async () => {
    const result = await prisma.$transaction((tx) => copyShopSetup(tx, fromId, toId), { timeout: 120_000, maxWait: 10_000 });
    expect(await setupCounts(toId)).toEqual(await setupCounts(fromId));
    expect(result.copied.products).toBeGreaterThan(0);

    // Not one recipe line of the new shop reaches back into the old one.
    const crossBom = await prisma.bomItem.count({ where: { product: { tenantId: toId }, rawMaterial: { tenantId: { not: toId } } } });
    const crossPrep = await prisma.subRecipeItem.count({ where: { parent: { tenantId: toId }, rawMaterial: { tenantId: { not: toId } } } });
    const crossCat = await prisma.product.count({ where: { tenantId: toId, category: { tenantId: { not: toId } } } });
    expect({ crossBom, crossPrep, crossCat }).toEqual({ crossBom: 0, crossPrep: 0, crossCat: 0 });

    // A drink costs the same in both shops: same ingredients, same quantities.
    const sample = await prisma.product.findFirst({
      where: { tenantId: fromId, bomItems: { some: {} } },
      select: { name: true, price: true, bomItems: { select: { quantity: true, rawMaterial: { select: { name: true } } } } },
    });
    const twin = await prisma.product.findFirst({
      where: { tenantId: toId, name: sample!.name },
      select: { price: true, bomItems: { select: { quantity: true, rawMaterial: { select: { name: true } } } } },
    });
    const lines = (b: Array<{ quantity: unknown; rawMaterial: { name: string } }>) =>
      b.map((l) => `${l.rawMaterial.name}:${Number(l.quantity)}`).sort();
    expect(Number(twin!.price)).toBe(Number(sample!.price));
    expect(lines(twin!.bomItems)).toEqual(lines(sample!.bomItems));

    // Nothing that happened in the old shop came along.
    expect(await prisma.order.count({ where: { tenantId: toId } })).toBe(0);
    expect(await prisma.rawMaterialInventory.count({ where: { rawMaterial: { tenantId: toId } } })).toBe(0);
  });

  it('refuses to copy onto a shop that already has a menu', async () => {
    await expect(prisma.$transaction((tx) => copyShopSetup(tx, fromId, toId), { timeout: 120_000 }))
      .rejects.toBeInstanceOf(ConflictException);
  });
});
