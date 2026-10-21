/**
 * The tenant scope against a real database (opt-in, never in CI):
 *
 *   cd apps/api && TENANT_SCOPE_DB_TEST=1 npx jest --testRegex 'tenant-scope.db-spec.ts$'
 *
 * Needs a LOCAL database (DATABASE_URL in apps/api/.env) with at least two
 * shops that each have a product. It only reads; the one update it tries is
 * meant to find nothing, and the one create is refused before the database.
 * Never point it at production.
 */
import * as path from 'path';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { runAsSystem, runForTenant } from './tenant-context';

const run = process.env.TENANT_SCOPE_DB_TEST === '1' ? describe : describe.skip;

run('tenant scope on a real database', () => {
  let prisma: PrismaService;
  let shopA: string;
  let shopB: string;
  let productB: { id: string; name: string };

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('dotenv').config({ path: path.join(__dirname, '../../.env'), quiet: true });
    if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) throw new Error('Local database only.');
    prisma = new PrismaService();
    const shops = await prisma.product.groupBy({ by: ['tenantId'], _count: { _all: true } });
    if (shops.length < 2) throw new Error('Needs two shops with products.');
    [shopA, shopB] = [shops[0]!.tenantId, shops[1]!.tenantId];
    productB = (await prisma.product.findFirstOrThrow({ where: { tenantId: shopB }, select: { id: true, name: true } }));
  });

  afterAll(async () => { await prisma?.$disconnect(); });

  it('outside a request nothing changes: the row is found', async () => {
    expect(await prisma.product.findUnique({ where: { id: productB.id } })).not.toBeNull();
  });

  it('inside shop A, shop B’s product cannot be read by id', async () => {
    await runForTenant(shopA, async () => {
      expect(await prisma.product.findUnique({ where: { id: productB.id } })).toBeNull();
      expect(await prisma.product.findFirst({ where: { id: productB.id } })).toBeNull();
      expect(await prisma.product.findMany({ where: { id: productB.id } })).toEqual([]);
    });
  });

  it('a list with no filter returns only shop A', async () => {
    // Awaited inside the shop's context, as a request handler does: a Prisma
    // query runs when awaited, not when written.
    const all = await runForTenant(shopA, async () => await prisma.product.findMany({ select: { tenantId: true } }));
    expect(all.length).toBeGreaterThan(0);
    expect(new Set(all.map((p) => p.tenantId))).toEqual(new Set([shopA]));
    const count = await runForTenant(shopA, async () => await prisma.product.count());
    expect(count).toBe(await prisma.product.count({ where: { tenantId: shopA } }));
  });

  it('shop B’s product cannot be changed from shop A (nothing found, nothing written)', async () => {
    await expect(runForTenant(shopA, async () => await prisma.product.update({ where: { id: productB.id }, data: { name: productB.name } })))
      .rejects.toMatchObject({ code: 'P2025' });
    const res = await runForTenant(shopA, async () => await prisma.product.updateMany({ where: { id: productB.id }, data: { name: productB.name } }));
    expect(res.count).toBe(0);
  });

  it('a new row for shop B is refused from shop A, before the database', async () => {
    await expect(runForTenant(shopA, async () => await prisma.category.create({ data: { tenantId: shopB, name: 'never saved' } as any })))
      .rejects.toThrow('That record belongs to another shop.');
  });

  it('transactions are scoped too, both kinds', async () => {
    await runForTenant(shopA, async () => {
      expect(await prisma.$transaction((tx) => tx.product.findUnique({ where: { id: productB.id } }))).toBeNull();
      const [n] = await prisma.$transaction([prisma.product.count({ where: { id: productB.id } })]);
      expect(n).toBe(0);
    });
  });

  it('system work inside a shop’s request still sees every shop', async () => {
    const found = await runForTenant(shopA, () => runAsSystem(async () => await prisma.product.findUnique({ where: { id: productB.id } })));
    expect(found?.id).toBe(productB.id);
  });

  it('raw SQL and tables without their own tenantId are untouched', async () => {
    const table = Prisma.dmmf.datamodel.models.find((m) => m.name === 'Product')!.dbName ?? 'Product';
    const rows = await runForTenant(shopA, async () =>
      await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint AS n FROM "${table}" WHERE id = $1`, productB.id));
    expect(Number(rows[0]!.n)).toBe(1);
    expect(await runForTenant(shopA, async () => await prisma.tenant.findUnique({ where: { id: shopB }, select: { id: true } }))).not.toBeNull();
  });
});
