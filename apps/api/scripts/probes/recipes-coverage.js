// Read-only: which products take ingredients off the shelf when sold (they have a recipe), split by where they
// are made. A product with no recipe moves no stock and books no ingredient cost.
//   bash apps/api/scripts/probes/run-in-container.sh apps/api/scripts/probes/recipes-coverage.js
// Optional: SHOP=<company code> (default cafe-carolina).
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const SHOP = process.env.SHOP || 'cafe-carolina';
(async () => {
  const t = await p.tenant.findUnique({ where: { slug: SHOP }, select: { id: true } });
  const prods = await p.product.findMany({
    where: { tenantId: t.id, isActive: true },
    select: { name: true, inventoryMode: true, category: { select: { name: true, station: { select: { name: true, hasKds: true } } } },
      _count: { select: { bomItems: true, variants: true } } },
  });
  const where = (x) => (x.category?.station?.hasKds ? x.category.station.name : 'Counter');
  const groups = {};
  for (const x of prods) {
    const g = (groups[where(x)] = groups[where(x)] || { withRecipe: 0, without: [] });
    if (x._count.bomItems > 0) g.withRecipe++; else g.without.push(`${x.name} [${x.category?.name ?? '-'}]${x.inventoryMode !== 'RECIPE_BASED' ? ' (' + x.inventoryMode + ')' : ''}`);
  }
  for (const [k, g] of Object.entries(groups)) {
    console.log(`${k}: ${g.withRecipe} with a recipe, ${g.without.length} without`);
    console.log('   without: ' + g.without.join('; '));
  }
  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
