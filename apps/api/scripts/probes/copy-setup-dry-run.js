// A dry run of "Copy setup" on the LIVE data: makes a throwaway shop inside a
// transaction, copies the named shop into it with the DEPLOYED code, prints
// what landed, then throws so the transaction rolls back. Nothing is kept.
//   bash apps/api/scripts/probes/run-in-container.sh apps/api/scripts/probes/copy-setup-dry-run.js
// Optional: COPY_FROM=<company code> (default cafe-carolina).
const { PrismaClient } = require('@prisma/client');
const { copyShopSetup } = require('/app/apps/api/dist/admin/copy-setup.js');
const p = new PrismaClient();
const FROM = process.env.COPY_FROM || 'cafe-carolina';
const ROLLBACK = 'DRY_RUN_ROLLBACK';
(async () => {
  const from = await p.tenant.findUnique({ where: { slug: FROM }, select: { id: true } });
  if (!from) throw new Error('No shop ' + FROM);
  let report = null;
  try {
    await p.$transaction(async (tx) => {
      const to = await tx.tenant.create({
        data: { name: 'Dry run', slug: 'dry-run-' + process.pid, branches: { create: { name: 'Main' } } },
        select: { id: true },
      });
      const t0 = Date.now();
      const result = await copyShopSetup(tx, from.id, to.id);
      const c = async (id) => ({
        products:    await tx.product.count({ where: { tenantId: id } }),
        ingredients: await tx.rawMaterial.count({ where: { tenantId: id } }),
        recipeLines: await tx.bomItem.count({ where: { product: { tenantId: id } } }),
        prepLines:   await tx.subRecipeItem.count({ where: { parent: { tenantId: id } } }),
        categories:  await tx.category.count({ where: { tenantId: id } }),
        routed:      await tx.category.count({ where: { tenantId: id, stationId: { not: null } } }),
        stations:    await tx.station.count({ where: { tenantId: id } }),
        withLevel:   await tx.rawMaterial.count({ where: { tenantId: id, lowStockAlert: { not: null } } }),
      });
      const cross = await tx.bomItem.count({ where: { product: { tenantId: to.id }, rawMaterial: { tenantId: { not: to.id } } } });
      report = { ms: Date.now() - t0, copied: result.copied, source: await c(from.id), copy: await c(to.id), crossTenantRecipeLines: cross };
      throw new Error(ROLLBACK);
    }, { timeout: 120000, maxWait: 10000 });
  } catch (e) {
    if (e.message !== ROLLBACK) throw e;
  }
  const left = await p.tenant.count({ where: { slug: { startsWith: 'dry-run-' } } });
  console.log(JSON.stringify(report, null, 1));
  console.log('rolled back; dry-run shops left in the database:', left);
  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
