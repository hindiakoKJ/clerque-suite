// Read-only: a shop's state before a session of test transactions -- people and roles, supervisor PINs, open
// shifts, what the shelf holds, and which recipe products it can make right now.
//   bash apps/api/scripts/probes/run-in-container.sh apps/api/scripts/probes/shop-state.js
// Optional: SHOP=<company code> (default cafe-carolina).
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const SHOP = process.env.SHOP || 'cafe-carolina';
(async () => {
  const t = await p.tenant.findUnique({ where: { slug: SHOP }, select: { id: true, taxStatus: true, ledgerMode: true, allowSaleWhenOutOfStock: true, showPurchaseCostsToStaff: true } });
  console.log('shop', SHOP, JSON.stringify(t));
  const users = await p.user.findMany({ where: { tenantId: t.id }, select: { name: true, role: true, isActive: true, supervisorPinHash: true, kioskPin: true } });
  for (const u of users) console.log(`  user ${u.name} ${u.role}${u.isActive ? '' : ' (inactive)'} supervisorPin=${u.supervisorPinHash ? 'set' : 'none'} kioskPin=${u.kioskPin ? 'set' : 'none'}`);
  const branches = await p.branch.findMany({ where: { tenantId: t.id }, select: { id: true, name: true, closesAt: true } });
  console.log('branches', JSON.stringify(branches));
  const open = await p.shift.findMany({ where: { tenantId: t.id, closedAt: null }, select: { openedAt: true, cashierId: true } });
  console.log('open shifts', JSON.stringify(open));
  const rows = await p.rawMaterialInventory.findMany({ where: { rawMaterial: { tenantId: t.id } }, select: { rawMaterialId: true, quantity: true, rawMaterial: { select: { name: true } } } });
  const zero = rows.filter((s) => Number(s.quantity) <= 0).map((s) => s.rawMaterial.name);
  console.log(`shelf rows ${rows.length}; at or below zero ${zero.length}: ${zero.slice(0, 20).join(', ')}`);
  const onHand = new Map(rows.map((r) => [r.rawMaterialId, Number(r.quantity)]));
  const prods = await p.product.findMany({ where: { tenantId: t.id, isActive: true, bomItems: { some: {} } }, select: { name: true, price: true, bomItems: { select: { rawMaterialId: true, quantity: true, rawMaterial: { select: { name: true } } } } } });
  const makeable = [];
  const blocked = [];
  for (const x of prods) {
    const n = Math.min(...x.bomItems.map((b) => Math.floor((onHand.get(b.rawMaterialId) ?? 0) / Number(b.quantity))));
    if (n > 0) makeable.push(`${x.name} x${n} @${Number(x.price)}`);
    else blocked.push(`${x.name} (short: ${x.bomItems.filter((b) => (onHand.get(b.rawMaterialId) ?? 0) < Number(b.quantity)).map((b) => b.rawMaterial.name).join('/')})`);
  }
  console.log(`makeable now ${makeable.length}: ${makeable.slice(0, 25).join('; ')}`);
  console.log(`blocked ${blocked.length}: ${blocked.slice(0, 15).join('; ')}`);
  const orders = await p.order.groupBy({ by: ['status'], where: { tenantId: t.id }, _count: { _all: true } });
  console.log('orders so far', JSON.stringify(orders.map((o) => [o.status, o._count._all])));
  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
