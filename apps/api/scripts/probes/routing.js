// Read-only: a shop's stations, and where each category's items go when paid.
//   bash apps/api/scripts/probes/run-in-container.sh apps/api/scripts/probes/routing.js
// Optional: SHOP=<company code> (default cafe-carolina).
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const SHOP = process.env.SHOP || 'cafe-carolina';
(async () => {
  const t = await p.tenant.findUnique({ where: { slug: SHOP }, select: { id: true, slug: true } });
  if (!t) throw new Error('No shop ' + SHOP);
  const stations = await p.station.findMany({
    where: { tenantId: t.id },
    select: { id: true, name: true, kind: true, hasKds: true, isActive: true, branchId: true, _count: { select: { categories: true } } },
    orderBy: { sortOrder: 'asc' },
  });
  console.log('STATIONS');
  for (const s of stations) console.log(`  ${s.name} [${s.kind}] screen=${s.hasKds} active=${s.isActive} categories=${s._count.categories} id=${s.id}`);
  const cats = await p.category.findMany({
    where: { tenantId: t.id },
    select: { id: true, name: true, isActive: true, station: { select: { name: true, hasKds: true, isActive: true } },
      products: { where: { isActive: true }, select: { name: true, _count: { select: { bomItems: true } } }, take: 4 },
      _count: { select: { products: true } } },
    orderBy: { sortOrder: 'asc' },
  });
  console.log('CATEGORIES (goes to → products, with recipe or not)');
  for (const c of cats) {
    const to = c.station ? `${c.station.name}${c.station.hasKds && c.station.isActive ? ' (screen)' : ' (no screen: used at sale)'}` : 'NO STATION (used at sale, no screen)';
    console.log(`  ${c.isActive ? '' : '[inactive] '}${c.name} → ${to} | ${c._count.products} products: ${c.products.map((x) => x.name + (x._count.bomItems ? '' : ' [no recipe]')).join(', ')}`);
  }
  const noCat = await p.product.count({ where: { tenantId: t.id, isActive: true, categoryId: null } });
  console.log('active products with no category:', noCat);
  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
